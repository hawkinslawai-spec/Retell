/**
 * Rebuild Amy in Retell from code + saved settings, publish her, and check
 * the result.
 *
 * This is the one place that writes Amy. The provision endpoint and the Amy
 * settings page both call it, so a save on the page goes live by exactly the
 * same route as a deliberate rebuild.
 *
 * Why it publishes: Retell keeps a draft and published versions. Calls are
 * answered by whichever version the phone number points at, and before this
 * a rebuild only ever wrote the latest version — the "it keeps loading the
 * old version" problem. Each run now writes a draft, publishes that draft,
 * and moves any phone number that is pinned to an older version of Amy onto
 * the new one.
 */

import { getRetell, unwrapList } from "../retell-client";
import { appBaseUrl } from "../retell-agents";
import {
  upsertScreener,
  pruneScreeners,
  findScreeners,
  amyTools,
  amyAgentIds,
  SCREENER_NAME,
} from "./agent";
import { amyPrompt } from "./prompt";
import { FIRM } from "./firm";
import { getAmySettings, type AmySettings } from "./settings";

export const AMY_NAME = "Amy — Hawkins Law reception";

type Rec = Record<string, unknown>;

export type RebuildResult = {
  ok: boolean;
  message?: string;
  agentId: string;
  llmId: string;
  screenAgentId: string;
  publishedVersion?: number;
  screenerVersion?: number;
  removedScreeners: string[];
  numbersUpdated: string[];
  tools: { expected: string[]; missing: string[]; present: string[] };
  warnings: string[];
};

/**
 * Get a version of the agent that may be written to.
 *
 * Published versions are fixed. If the latest one is published, branch a new
 * draft from it; otherwise the latest is already a draft.
 */
async function writableVersion(agentId: string): Promise<{
  version: number | undefined;
  llmId: string;
  llmVersion: number | undefined;
}> {
  const retell = getRetell();
  let agent = (await retell.agent.retrieve(agentId)) as unknown as Rec;

  if (agent.is_published === true && typeof agent.version === "number") {
    try {
      agent = (await retell.agent.createVersion(agentId, {
        base_version: agent.version,
      })) as unknown as Rec;
    } catch (err) {
      // Older accounts without versioning: fall through and write the
      // latest, which is what every build before this one did.
      console.warn("[hawkins] could not create a draft version:", err);
    }
  }

  const engine = (agent.response_engine || {}) as Rec;
  return {
    version: typeof agent.version === "number" ? agent.version : undefined,
    llmId: String(engine.llm_id ?? ""),
    llmVersion: typeof engine.version === "number" ? engine.version : undefined,
  };
}

async function publish(agentId: string, version: number | undefined, title: string, warnings: string[]) {
  if (version === undefined) return undefined;
  try {
    await getRetell().agent.publish(agentId, {
      version,
      version_title: title,
      version_description: `Published by the reception console, ${new Date().toISOString()}`,
    });
    return version;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Retell refuses to publish a version that is already published. That's
    // the outcome we wanted, so it isn't a failure.
    if (/already published/i.test(msg)) return version;
    // Retell answers a successful publish with an empty body, which the SDK
    // fails to parse ("Unexpected end of JSON input"). Ask Retell whether
    // the version is now published rather than trusting the error.
    try {
      const v = (await getRetell().agent.retrieve(agentId, { version })) as unknown as Rec;
      if (v.is_published === true) return version;
    } catch {
      // fall through to the warning
    }
    warnings.push(`Could not publish version ${version}: ${msg}`);
    return undefined;
  }
}

/** Every agent name Amy's prompt depends on, so the page can show a gap at once. */
export function expectedTools(settings: AmySettings): string[] {
  return [
    "note_caller_details",
    ...settings.staff.map((s) => `transfer_to_${s.id}`),
    "send_message",
    "get_client_account_details",
    "end_call",
  ];
}

export async function readLiveTools(agentId: string, version?: number): Promise<string[]> {
  const retell = getRetell();
  const agent = (await retell.agent.retrieve(
    agentId,
    version !== undefined ? { version } : undefined
  )) as unknown as Rec;
  const engine = (agent.response_engine || {}) as Rec;
  const llmId = String(engine.llm_id ?? "");
  if (!llmId) return [];
  const llm = (await retell.llm.retrieve(
    llmId,
    typeof engine.version === "number" ? { version: engine.version } : undefined
  )) as unknown as Rec;
  return (Array.isArray(llm.general_tools) ? llm.general_tools : []).map((t) =>
    String((t as Rec).name ?? "")
  );
}

/**
 * Point every number that answers with a pinned old version of Amy at the
 * new one. Numbers following "latest" or "latest_published" need nothing.
 */
async function repinNumbers(agentId: string, version: number): Promise<string[]> {
  const retell = getRetell();
  const updated: string[] = [];
  const rows = unwrapList<Rec>(await retell.phoneNumber.list());

  for (const n of rows) {
    const inbound = (Array.isArray(n.inbound_agents) ? n.inbound_agents : []) as Rec[];
    const pinned = inbound.some(
      (a) => a.agent_id === agentId && typeof a.agent_version === "number" && a.agent_version !== version
    );
    const legacyPinned =
      n.inbound_agent_id === agentId &&
      typeof n.inbound_agent_version === "number" &&
      n.inbound_agent_version !== version;
    if (!pinned && !legacyPinned) continue;

    const next = inbound.length
      ? inbound.map((a) =>
          a.agent_id === agentId ? { ...a, agent_version: version } : a
        )
      : [{ agent_id: agentId, weight: 1, agent_version: version }];

    await retell.phoneNumber.update(String(n.phone_number), { inbound_agents: next as never });
    updated.push(String(n.phone_number));
  }

  return updated;
}

export async function rebuildAmy(opts: {
  agentId?: string;
  voiceId?: string;
  screenAgentId?: string;
  settings?: AmySettings;
}): Promise<RebuildResult> {
  const retell = getRetell();
  const warnings: string[] = [];
  const settings = opts.settings || (await getAmySettings({ fresh: true }));

  const result: RebuildResult = {
    ok: false,
    agentId: "",
    llmId: "",
    screenAgentId: "",
    removedScreeners: [],
    numbersUpdated: [],
    tools: { expected: expectedTools(settings), missing: [], present: [] },
    warnings,
  };

  const base = appBaseUrl();
  if (!base) {
    return { ...result, message: "APP_BASE_URL is not set, so the tool URLs would point nowhere." };
  }

  // Find Amy by name when not told which agent she is.
  let agentId = opts.agentId || "";
  if (!agentId) {
    const ids = await amyAgentIds();
    if (ids.length > 1) {
      warnings.push(`More than one agent is named Amy (${ids.join(", ")}). Updated the first.`);
    }
    agentId = ids[0] || "";
  }

  // A British female voice is a requirement of Section 3, not a preference.
  // With none chosen, keep the voice she already has.
  let voiceId = opts.voiceId || settings.voiceId || process.env.AMY_VOICE_ID || "";
  if (!voiceId && agentId) {
    const current = (await retell.agent.retrieve(agentId).catch(() => ({}))) as unknown as Rec;
    voiceId = String(current.voice_id ?? "");
  }
  if (!voiceId) {
    return {
      ...result,
      message: "No voice chosen. Pick one on the Amy settings page, or set AMY_VOICE_ID.",
    };
  }

  // Used only when the inbound webhook doesn't supply a value — most likely
  // because the webhook has come unset on the phone number, which has already
  // happened several times. Without these Amy would see the raw placeholder
  // text; with them she falls back to "closed" and the standard hours.
  const defaultVariables = {
    office_open: "false",
    opening_hours_spoken: FIRM.hoursSpoken,
    next_working_day_spoken: "the next working day",
    // Without the webhook there's no reliable time of day, and v3 says to
    // fall back to "Hello" rather than guess.
    greeting: "Hello",
    now_spoken: "",
    caller_id_number: "",
  };

  // 1. The screener that does the whisper, written and published first so
  //    Amy's transfer tools can point at a version that exists.
  const screenAgentId = await upsertScreenerVersioned(opts.screenAgentId || "", voiceId, warnings);
  result.screenAgentId = screenAgentId.id;
  result.screenerVersion = screenAgentId.version;
  if (!screenAgentId.id) {
    warnings.push(
      "The screening agent could not be created, so transfers fall back to a plain warm transfer " +
        "with NO keypress guard. Section 7 requires the keypress — do not go live like this."
    );
  }

  // 2. Amy's tools and prompt.
  const tools = amyTools(screenAgentId.id, settings.staff, screenAgentId.version ?? 0);
  const prompt = amyPrompt(settings);
  const llmBody = {
    model: (process.env.AMY_MODEL || "gpt-5.4") as never,
    general_prompt: prompt,
    begin_message: null,
    // Low, because almost everything Amy says is prescribed wording and the
    // guardrails must not be paraphrased into something softer.
    model_temperature: 0.3,
    general_tools: tools as never,
    default_dynamic_variables: defaultVariables,
  };
  const agentBody = {
    agent_name: AMY_NAME,
    voice_id: voiceId,
    voice_speed: settings.voiceSpeed ?? 1,
    voice_temperature: settings.voiceTemperature ?? 1,
    language: "en-GB" as never,
    webhook_url: `${base}/api/retell/webhook`,
  };

  if (agentId) {
    const draft = await writableVersion(agentId);
    if (!draft.llmId) {
      return { ...result, agentId, message: "That agent isn't a Retell LLM agent, so its prompt can't be updated here." };
    }
    await retell.llm.update(draft.llmId, { ...llmBody, version: draft.llmVersion } as never);
    await retell.agent.update(agentId, { ...agentBody, version: draft.version } as never);
    result.llmId = draft.llmId;
    result.publishedVersion = await publish(agentId, draft.version, "Console rebuild", warnings);
  } else {
    const llm = await retell.llm.create(llmBody as never);
    const agent = (await retell.agent.create({
      ...agentBody,
      response_engine: { type: "retell-llm", llm_id: llm.llm_id },
    } as never)) as unknown as Rec;
    agentId = String(agent.agent_id ?? "");
    result.llmId = llm.llm_id;
    result.publishedVersion = await publish(
      agentId,
      typeof agent.version === "number" ? agent.version : 0,
      "Console rebuild",
      warnings
    );
  }
  result.agentId = agentId;

  // 3. Numbers pinned to an older version of Amy.
  if (result.publishedVersion !== undefined) {
    try {
      result.numbersUpdated = await repinNumbers(agentId, result.publishedVersion);
    } catch (err) {
      warnings.push(
        `Could not check which version the phone numbers use: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // 4. Tidy up, last, once Amy's tools point at the keeper.
  result.removedScreeners = await pruneScreeners(screenAgentId.id).catch(() => [] as string[]);

  // 5. Read back what Retell now holds — the check that matters.
  try {
    const present = await readLiveTools(agentId, result.publishedVersion);
    result.tools.present = present;
    result.tools.missing = result.tools.expected.filter((n) => !present.includes(n));
  } catch (err) {
    warnings.push(`Could not read Amy's tools back: ${err instanceof Error ? err.message : String(err)}`);
  }

  result.ok = result.tools.missing.length === 0 && result.publishedVersion !== undefined;
  if (!result.ok && !result.message) {
    result.message =
      result.tools.missing.length > 0
        ? `Saved, but Retell is missing ${result.tools.missing.join(", ")}.`
        : "Saved, but publishing did not complete.";
  }
  return result;
}

/**
 * Write the screener into a draft, publish it, and say which version Amy's
 * transfer tools should point at.
 */
async function upsertScreenerVersioned(
  existingId: string,
  voiceId: string,
  warnings: string[]
): Promise<{ id: string; version?: number }> {
  // upsertScreener writes the latest version. If that is published, branch a
  // draft first so the write lands somewhere it can take effect.
  let id = existingId;
  if (!id) {
    const found = await findScreeners().catch(() => []);
    id = found.find((f) => f.isTransferAgent)?.agentId || "";
  }

  let version: number | undefined;
  let draft: { version?: number; llmVersion?: number } | undefined;
  if (id) {
    try {
      const w = await writableVersion(id);
      draft = { version: w.version, llmVersion: w.llmVersion };
      version = w.version;
    } catch (err) {
      console.warn("[hawkins] screener version lookup failed:", err);
    }
  }

  const screenerId = await upsertScreener(id, voiceId, draft);
  if (!screenerId) return { id: "" };

  if (screenerId !== id) {
    // A brand-new screener: its first version is the one to publish.
    const fresh = (await getRetell().agent.retrieve(screenerId)) as unknown as Rec;
    version = typeof fresh.version === "number" ? fresh.version : 0;
  }

  const published = await publish(screenerId, version, SCREENER_NAME, warnings);
  return { id: screenerId, version: published ?? version };
}

export type LiveStatus = {
  agentId: string;
  agentName: string;
  voiceId: string;
  latestVersion?: number;
  latestIsPublished?: boolean;
  publishedVersion?: number;
  publishedAt?: number;
  numbers: { phoneNumber: string; nickname: string; version: string }[];
  tools: { expected: string[]; missing: string[]; present: string[] };
  error?: string;
};

/** What Retell holds for Amy right now, for the settings page header. */
export async function amyLiveStatus(settings: AmySettings): Promise<LiveStatus> {
  const status: LiveStatus = {
    agentId: "",
    agentName: "",
    voiceId: "",
    numbers: [],
    tools: { expected: expectedTools(settings), missing: [], present: [] },
  };

  try {
    const retell = getRetell();
    const ids = await amyAgentIds();
    status.agentId = ids[0] || "";
    if (!status.agentId) {
      status.error = "No agent named Amy found in Retell.";
      return status;
    }

    const agent = (await retell.agent.retrieve(status.agentId)) as unknown as Rec;
    status.agentName = String(agent.agent_name ?? "");
    status.voiceId = String(agent.voice_id ?? "");
    status.latestVersion = typeof agent.version === "number" ? agent.version : undefined;
    status.latestIsPublished = agent.is_published === true;

    try {
      const versions = (await retell.agent.listVersions(status.agentId)) as unknown as {
        items?: { version: number; is_published: boolean; last_modification_timestamp: number }[];
      };
      const published = (versions.items || [])
        .filter((v) => v.is_published)
        .sort((a, b) => b.version - a.version)[0];
      if (published) {
        status.publishedVersion = published.version;
        status.publishedAt = published.last_modification_timestamp;
      }
    } catch {
      if (status.latestIsPublished) status.publishedVersion = status.latestVersion;
    }

    const rows = unwrapList<Rec>(await retell.phoneNumber.list());
    for (const n of rows) {
      const inbound = (Array.isArray(n.inbound_agents) ? n.inbound_agents : []) as Rec[];
      const mine = inbound.find((a) => a.agent_id === status.agentId);
      if (!mine && n.inbound_agent_id !== status.agentId) continue;
      const v = mine?.agent_version ?? n.inbound_agent_version;
      status.numbers.push({
        phoneNumber: String(n.phone_number ?? ""),
        nickname: String(n.nickname ?? ""),
        version: v === undefined || v === null || v === "" ? "default" : String(v),
      });
    }

    // The published version is the one answering calls, so check that.
    const present = await readLiveTools(status.agentId, status.publishedVersion);
    status.tools.present = present;
    status.tools.missing = status.tools.expected.filter((n) => !present.includes(n));
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err);
  }

  return status;
}
