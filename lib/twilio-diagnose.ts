/**
 * Why isn't the phone ringing?
 *
 * Importing a number into Retell only configures one direction. Retell stores a
 * termination URI so it knows where to send *outbound* calls — and that part
 * tends to work first time, because Retell's own "Test SIP Connection" button
 * exercises it.
 *
 * Inbound is configured entirely on the Twilio side, in two places that are
 * easy to miss: the trunk needs an origination URL pointing back at Retell, and
 * the number has to actually be sitting on that trunk. Miss either and the
 * caller hears ringing, or silence, and nothing whatsoever appears in Retell's
 * call history — which makes it look like the agent is broken when the call
 * never reached it.
 *
 * This module answers that question against the live Twilio account, and can
 * repair what it finds. Credentials are used for the duration of the request
 * and never stored.
 */

import {
  API,
  RETELL_SIP_URI,
  TRUNKING,
  TwilioCreds,
  twilio,
  verifyAccount,
} from "./twilio-provision";

export type CheckStatus = "pass" | "fail" | "warn";

export type TrunkCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Shown only when something is wrong, and only when it isn't self-evident. */
  fix?: string;
};

export type Diagnosis = {
  account_name: string;
  phone_number: string;
  /** The trunk Retell is pointed at, derived from its termination URI. */
  termination_uri: string;
  trunk_sid: string | null;
  trunk_name: string | null;
  checks: TrunkCheck[];
  /** True when inbound calls will reach Retell. */
  inbound_ready: boolean;
  /** True when there is something this module can fix on its own. */
  repairable: boolean;
};

type TwilioNumber = {
  sid: string;
  phone_number: string;
  trunk_sid: string | null;
  voice_url?: string | null;
  friendly_name?: string;
};

type Trunk = { sid: string; friendly_name: string; domain_name: string };

/**
 * Retell stores the termination URI with no scheme and sometimes with a
 * transport parameter appended. Twilio stores a bare domain. Compare hosts.
 */
function hostOf(uri: string): string {
  return uri
    .trim()
    .toLowerCase()
    .replace(/^sips?:/, "")
    .replace(/^\/\//, "")
    .split(/[;?]/)[0]
    .split("@")
    .pop()!
    .split(":")[0];
}

async function findNumber(creds: TwilioCreds, phone: string): Promise<TwilioNumber | null> {
  const query = new URLSearchParams({ PhoneNumber: phone, PageSize: "20" });
  const res = await twilio<{ incoming_phone_numbers?: TwilioNumber[] }>(
    creds,
    "GET",
    `${API}/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json?${query}`
  );
  return (res.incoming_phone_numbers || []).find((n) => n.phone_number === phone) ?? null;
}

async function listTrunks(creds: TwilioCreds): Promise<Trunk[]> {
  const res = await twilio<{ trunks?: Trunk[] }>(creds, "GET", `${TRUNKING}/Trunks?PageSize=100`);
  return res.trunks || [];
}

async function originationUrls(
  creds: TwilioCreds,
  trunkSid: string
): Promise<{ sid: string; sip_url: string; enabled: boolean }[]> {
  const res = await twilio<{
    origination_urls?: { sid: string; sip_url: string; enabled: boolean }[];
  }>(creds, "GET", `${TRUNKING}/Trunks/${trunkSid}/OriginationUrls`);
  return res.origination_urls || [];
}

export async function diagnose(
  creds: TwilioCreds,
  phone: string,
  terminationUri: string
): Promise<Diagnosis> {
  const checks: TrunkCheck[] = [];

  const accountName = await verifyAccount(creds);
  checks.push({
    id: "account",
    label: "Twilio account",
    status: "pass",
    detail: accountName,
  });

  const number = await findNumber(creds, phone);
  checks.push({
    id: "number_in_account",
    label: "Number in this account",
    status: number ? "pass" : "fail",
    detail: number
      ? `${phone}${number.friendly_name ? ` — ${number.friendly_name}` : ""}`
      : `${phone} isn't in this Twilio account`,
    fix: number
      ? undefined
      : "Check the Account SID — a number bought under a subaccount won't show up under the parent, and vice versa.",
  });

  // Retell's termination URI is the authority on which trunk this number is
  // meant to use. Matching on it means we repair the trunk the firm actually
  // configured rather than quietly building a second one beside it.
  const wantedHost = hostOf(terminationUri);
  const trunks = await listTrunks(creds);
  const trunk = trunks.find((t) => hostOf(t.domain_name) === wantedHost) ?? null;

  checks.push({
    id: "trunk_exists",
    label: "Trunk Retell points at",
    status: trunk ? "pass" : "fail",
    detail: trunk
      ? `${trunk.friendly_name || "(unnamed)"} — ${trunk.domain_name}`
      : `No trunk in this account has the domain ${wantedHost || "(none set)"}`,
    fix: trunk
      ? undefined
      : "Retell's termination URI doesn't match any trunk here. Either the number belongs to a different Twilio account, or the trunk was deleted.",
  });

  let origination: { sid: string; sip_url: string; enabled: boolean }[] = [];
  if (trunk) {
    origination = await originationUrls(creds, trunk.sid);
  }

  const retellOrigination = origination.find((u) => /sip\.retellai\.com/i.test(u.sip_url));
  const originationOk = Boolean(retellOrigination?.enabled);

  checks.push({
    id: "origination",
    label: "Inbound route to Retell",
    status: !trunk ? "fail" : originationOk ? "pass" : "fail",
    detail: !trunk
      ? "No trunk to check"
      : retellOrigination
      ? retellOrigination.enabled
        ? retellOrigination.sip_url
        : `${retellOrigination.sip_url} — present but disabled`
      : origination.length > 0
      ? `Points at ${origination.map((u) => u.sip_url).join(", ")} — not Retell`
      : "The trunk has no origination URL at all",
    fix:
      !trunk || originationOk
        ? undefined
        : `This is why calls don't arrive. The trunk needs an origination URL of ${RETELL_SIP_URI}.`,
  });

  const onRightTrunk = Boolean(trunk && number && number.trunk_sid === trunk.sid);
  const onOtherTrunk = Boolean(
    trunk && number && number.trunk_sid && number.trunk_sid !== trunk.sid
  );

  checks.push({
    id: "number_on_trunk",
    label: "Number attached to the trunk",
    status: !trunk || !number ? "fail" : onRightTrunk ? "pass" : "fail",
    detail: !number
      ? "No number to check"
      : !trunk
      ? "No trunk to check"
      : onRightTrunk
      ? "Routing through the trunk"
      : onOtherTrunk
      ? `Attached to a different trunk (${number.trunk_sid})`
      : number.voice_url
      ? `Not on any trunk — still routing to a Voice webhook (${number.voice_url})`
      : "Not attached to any trunk",
    fix:
      !trunk || !number || onRightTrunk
        ? undefined
        : "Until the number sits on the trunk, Twilio never consults the origination URL.",
  });

  // Termination auth is a separate concern: it governs Retell's *outbound*
  // calls into Twilio, which is the direction that already works if Retell's
  // own SIP test passes. Worth reporting, never worth blocking on.
  let authDetail = "Not checked";
  let authStatus: CheckStatus = "warn";
  if (trunk) {
    const [creds_, acls] = await Promise.all([
      twilio<{ credential_lists?: { sid: string }[] }>(
        creds,
        "GET",
        `${TRUNKING}/Trunks/${trunk.sid}/CredentialLists`
      ),
      twilio<{ ip_access_control_lists?: { sid: string }[] }>(
        creds,
        "GET",
        `${TRUNKING}/Trunks/${trunk.sid}/IpAccessControlLists`
      ),
    ]);

    const hasCreds = (creds_.credential_lists || []).length > 0;
    const hasAcl = (acls.ip_access_control_lists || []).length > 0;

    authStatus = hasCreds || hasAcl ? "pass" : "warn";
    authDetail = hasCreds
      ? hasAcl
        ? "SIP credentials and an IP access control list"
        : "SIP credentials"
      : hasAcl
      ? "IP access control list"
      : "No credential list or IP allowlist — outbound calls from Retell will be rejected";
  }

  checks.push({
    id: "termination_auth",
    label: "Outbound authentication",
    status: authStatus,
    detail: authDetail,
    fix:
      authStatus === "warn" && trunk
        ? "Only affects outbound calls. Re-running the automatic setup on this number adds fresh SIP credentials."
        : undefined,
  });

  const inboundReady = originationOk && onRightTrunk;

  return {
    account_name: accountName,
    phone_number: phone,
    termination_uri: terminationUri,
    trunk_sid: trunk?.sid ?? null,
    trunk_name: trunk?.friendly_name ?? null,
    checks,
    inbound_ready: inboundReady,
    // We can only fix things once we know which trunk and which number.
    repairable: Boolean(trunk && number) && !inboundReady,
  };
}

/**
 * Fix the two inbound faults, then re-diagnose so the caller sees proven state
 * rather than our optimism about what we just did.
 */
export async function repair(
  creds: TwilioCreds,
  phone: string,
  terminationUri: string
): Promise<{ steps: string[]; diagnosis: Diagnosis }> {
  const steps: string[] = [];

  const before = await diagnose(creds, phone, terminationUri);

  if (!before.trunk_sid) {
    throw new Error(
      `No trunk in this Twilio account matches Retell's termination URI (${terminationUri}). Nothing to repair — re-import the number instead.`
    );
  }

  const number = await findNumber(creds, phone);
  if (!number) {
    throw new Error(`${phone} isn't in this Twilio account, so it can't be attached to a trunk.`);
  }

  const trunkSid = before.trunk_sid;

  // 1. Origination. An existing-but-disabled entry is re-enabled rather than
  //    duplicated; Twilio happily accepts two URLs pointing at the same host
  //    and then forks every inbound call down both.
  const existing = await originationUrls(creds, trunkSid);
  const retellUrl = existing.find((u) => /sip\.retellai\.com/i.test(u.sip_url));

  if (!retellUrl) {
    await twilio(creds, "POST", `${TRUNKING}/Trunks/${trunkSid}/OriginationUrls`, {
      FriendlyName: "Retell",
      SipUrl: RETELL_SIP_URI,
      Priority: "1",
      Weight: "1",
      Enabled: "true",
    });
    steps.push(`Added origination URL ${RETELL_SIP_URI}`);
  } else if (!retellUrl.enabled) {
    await twilio(creds, "POST", `${TRUNKING}/Trunks/${trunkSid}/OriginationUrls/${retellUrl.sid}`, {
      Enabled: "true",
    });
    steps.push("Re-enabled the existing Retell origination URL");
  } else {
    steps.push("Origination URL was already correct");
  }

  // 2. Attachment. Setting TrunkSid on the number itself moves it in one call —
  //    the trunking API refuses when the number is parked on another trunk, and
  //    detaching first leaves a window where the number routes nowhere.
  if (number.trunk_sid === trunkSid) {
    steps.push("Number was already on the trunk");
  } else {
    await twilio(
      creds,
      "POST",
      `${API}/Accounts/${creds.accountSid}/IncomingPhoneNumbers/${number.sid}.json`,
      { TrunkSid: trunkSid }
    );
    steps.push(
      number.trunk_sid
        ? "Moved the number off its old trunk and onto this one"
        : "Attached the number to the trunk"
    );
  }

  const after = await diagnose(creds, phone, terminationUri);
  return { steps, diagnosis: after };
}
