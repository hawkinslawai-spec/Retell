/**
 * Turns "Account SID + Auth Token + phone number" into a working elastic SIP
 * trunk, then hands the resulting termination URI and credentials to Retell.
 *
 * This is the plumbing Retell doesn't do for you. Vapi talks to Twilio's REST
 * API directly; Retell only speaks SIP, so a trunk has to exist first.
 *
 * Nothing is persisted. The Twilio credentials are used for the duration of
 * this request and discarded.
 */

const TRUNKING = "https://trunking.twilio.com/v1";
const API = "https://api.twilio.com/2010-04-01";

/** Retell's inbound SIP server. Calls to your Twilio number get sent here. */
const RETELL_SIP_URI = "sip:sip.retellai.com";

export type TwilioCreds = { accountSid: string; authToken: string };

function authHeader({ accountSid, authToken }: TwilioCreds): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

async function twilio<T>(
  creds: TwilioCreds,
  method: "GET" | "POST" | "DELETE",
  url: string,
  form?: Record<string, string>
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(creds),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });

  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (!res.ok) {
    const err = json as { message?: string; more_info?: string; code?: number };
    throw new Error(err.message || `Twilio returned ${res.status}`);
  }

  return json as T;
}

/** Twilio requires 12+ chars with upper, lower and a digit. */
function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;

  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);

  const chars = [
    upper[bytes[0] % upper.length],
    lower[bytes[1] % lower.length],
    digits[bytes[2] % digits.length],
  ];
  for (let i = 3; i < 20; i++) chars.push(all[bytes[i] % all.length]);

  return chars.join("");
}

function slug(input: string): string {
  const base = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base ? base.slice(0, 24) : "retell"}-${suffix}`;
}

export async function verifyAccount(creds: TwilioCreds): Promise<string> {
  const account = await twilio<{ friendly_name?: string; status?: string }>(
    creds,
    "GET",
    `${API}/Accounts/${creds.accountSid}.json`
  );
  if (account.status && account.status !== "active") {
    throw new Error(`Twilio account status is "${account.status}", not active`);
  }
  return account.friendly_name || creds.accountSid;
}

export async function findNumberSid(creds: TwilioCreds, phone: string): Promise<string> {
  const query = new URLSearchParams({ PhoneNumber: phone, PageSize: "20" });
  const res = await twilio<{ incoming_phone_numbers?: { sid: string; phone_number: string }[] }>(
    creds,
    "GET",
    `${API}/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json?${query}`
  );

  const match = (res.incoming_phone_numbers || []).find((n) => n.phone_number === phone);
  if (!match) {
    throw new Error(
      `${phone} isn't in this Twilio account. Check the number, or that the SID belongs to the right account or subaccount.`
    );
  }
  return match.sid;
}

type Trunk = { sid: string; friendly_name: string; domain_name: string };

export async function findOrCreateTrunk(
  creds: TwilioCreds,
  label: string
): Promise<{ sid: string; domainName: string; created: boolean }> {
  const existing = await twilio<{ trunks?: Trunk[] }>(
    creds,
    "GET",
    `${TRUNKING}/Trunks?PageSize=50`
  );

  // Reuse the trunk we made earlier rather than creating one per number.
  const reusable = (existing.trunks || []).find((t) => t.friendly_name === "Retell");
  if (reusable) {
    return { sid: reusable.sid, domainName: reusable.domain_name, created: false };
  }

  const trunk = await twilio<Trunk>(creds, "POST", `${TRUNKING}/Trunks`, {
    FriendlyName: "Retell",
    DomainName: `${slug(label || "retell")}.pstn.twilio.com`,
  });

  return { sid: trunk.sid, domainName: trunk.domain_name, created: true };
}

export async function createCredentials(
  creds: TwilioCreds
): Promise<{ listSid: string; username: string; password: string; reusedList: boolean }> {
  const username = `retell${Math.random().toString(36).slice(2, 10)}`;
  const password = generatePassword();

  // Reuse the list we made last time. Creating a fresh one per import leaves a
  // pile of orphaned credential lists in the Twilio console.
  const existing = await twilio<{ credential_lists?: { sid: string; friendly_name: string }[] }>(
    creds,
    "GET",
    `${API}/Accounts/${creds.accountSid}/SIP/CredentialLists.json?PageSize=50`
  );

  const found = (existing.credential_lists || []).find((l) => l.friendly_name === "Retell auto");

  const listSid =
    found?.sid ??
    (
      await twilio<{ sid: string }>(
        creds,
        "POST",
        `${API}/Accounts/${creds.accountSid}/SIP/CredentialLists.json`,
        { FriendlyName: "Retell auto" }
      )
    ).sid;

  // A fresh credential each time — we can't read an existing password back.
  await twilio(
    creds,
    "POST",
    `${API}/Accounts/${creds.accountSid}/SIP/CredentialLists/${listSid}/Credentials.json`,
    { Username: username, Password: password }
  );

  return { listSid, username, password, reusedList: Boolean(found) };
}

export async function attachCredentialList(
  creds: TwilioCreds,
  trunkSid: string,
  listSid: string
): Promise<void> {
  const attached = await twilio<{ credential_lists?: { sid: string }[] }>(
    creds,
    "GET",
    `${TRUNKING}/Trunks/${trunkSid}/CredentialLists`
  );
  if ((attached.credential_lists || []).some((l) => l.sid === listSid)) return;

  await twilio(creds, "POST", `${TRUNKING}/Trunks/${trunkSid}/CredentialLists`, {
    CredentialListSid: listSid,
  });
}

export async function ensureOrigination(creds: TwilioCreds, trunkSid: string): Promise<void> {
  const existing = await twilio<{ origination_urls?: { sip_url: string }[] }>(
    creds,
    "GET",
    `${TRUNKING}/Trunks/${trunkSid}/OriginationUrls`
  );

  if ((existing.origination_urls || []).some((u) => u.sip_url.includes("sip.retellai.com"))) {
    return;
  }

  await twilio(creds, "POST", `${TRUNKING}/Trunks/${trunkSid}/OriginationUrls`, {
    FriendlyName: "Retell",
    SipUrl: RETELL_SIP_URI,
    Priority: "1",
    Weight: "1",
    Enabled: "true",
  });
}

export async function attachNumber(
  creds: TwilioCreds,
  trunkSid: string,
  numberSid: string
): Promise<{ alreadyAttached: boolean }> {
  const onTrunk = await twilio<{ phone_numbers?: { sid: string }[] }>(
    creds,
    "GET",
    `${TRUNKING}/Trunks/${trunkSid}/PhoneNumbers?PageSize=100`
  );
  if ((onTrunk.phone_numbers || []).some((n) => n.sid === numberSid)) {
    return { alreadyAttached: true };
  }

  try {
    await twilio(creds, "POST", `${TRUNKING}/Trunks/${trunkSid}/PhoneNumbers`, {
      PhoneNumberSid: numberSid,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    // Twilio refuses to move a number that's sitting on a different trunk.
    if (/trunk/i.test(message) && /already|associated|assigned/i.test(message)) {
      throw new Error(
        "That number is already attached to a different SIP trunk in Twilio. Remove it from that trunk first, or delete the trunk if it's unused."
      );
    }
    throw err;
  }

  return { alreadyAttached: false };
}

export type ProvisionResult = {
  accountName: string;
  trunkSid: string;
  terminationUri: string;
  username: string;
  password: string;
  trunkCreated: boolean;
  steps: string[];
};

/**
 * Full provisioning run. Each step is recorded so a partial failure tells you
 * exactly how far it got — half-built trunks are otherwise painful to diagnose.
 */
export async function provisionTwilioNumber(
  creds: TwilioCreds,
  phone: string,
  label: string
): Promise<ProvisionResult> {
  const steps: string[] = [];

  const accountName = await verifyAccount(creds);
  steps.push(`Connected to Twilio account "${accountName}"`);

  const numberSid = await findNumberSid(creds, phone);
  steps.push(`Found ${phone} in the account`);

  const trunk = await findOrCreateTrunk(creds, label || "retell");
  steps.push(
    trunk.created
      ? `Created SIP trunk ${trunk.domainName}`
      : `Reusing existing "Retell" trunk ${trunk.domainName}`
  );

  const credentials = await createCredentials(creds);
  await attachCredentialList(creds, trunk.sid, credentials.listSid);
  steps.push(
    credentials.reusedList
      ? "Added fresh SIP credentials to the existing credential list"
      : "Created SIP credentials and attached them to the trunk"
  );

  await ensureOrigination(creds, trunk.sid);
  steps.push("Inbound calls point at sip.retellai.com");

  const attach = await attachNumber(creds, trunk.sid, numberSid);
  steps.push(
    attach.alreadyAttached ? "Number was already on the trunk" : "Moved the number onto the trunk"
  );

  return {
    accountName,
    trunkSid: trunk.sid,
    terminationUri: trunk.domainName,
    username: credentials.username,
    password: credentials.password,
    trunkCreated: trunk.created,
    steps,
  };
}
