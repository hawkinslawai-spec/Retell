import { getSupabase, isSupabaseConfigured } from "./supabase";
import { parseLogs, CustomLog } from "./custom-logs";
import { TIMEZONE } from "./config";

export type AgentSettings = {
  agentId: string;
  agentName: string;
  timezone: string;
  alertNumber: string;
  alertOnBook: boolean;
  alertOnLead: boolean;
  customLogs: CustomLog[];
  transferNumber: string;
  transferMode: "warm" | "cold" | "screen";
  transferNote: string;
  /** Retell agent that screens the human. Provisioned automatically. */
  screenAgentId: string;
  screenPrompt: string;
  screenRingSeconds: number;
  screenDecideSeconds: number;
  screenOnTimeout: "bridge" | "cancel";
  summaryEmail: string;
  emailEveryCall: boolean;
  emailOnTransfer: boolean;
};

function int(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function mode(value: unknown): "warm" | "cold" | "screen" {
  if (value === "cold") return "cold";
  if (value === "screen") return "screen";
  return "warm";
}

/** Environment defaults, used when an agent has no row of its own. */
export function defaultSettings(agentId = ""): AgentSettings {
  return {
    agentId,
    agentName: "",
    timezone: TIMEZONE,
    alertNumber: process.env.ALERT_NUMBER || "",
    alertOnBook: true,
    alertOnLead: true,
    customLogs: [],
    transferNumber: process.env.TRANSFER_NUMBER || "",
    transferMode: "warm",
    transferNote: "",
    screenAgentId: "",
    screenPrompt: "",
    screenRingSeconds: 25,
    screenDecideSeconds: 30,
    screenOnTimeout: "cancel",
    summaryEmail: process.env.SUMMARY_EMAIL || "",
    emailEveryCall: false,
    emailOnTransfer: true,
  };
}

/**
 * Where should this agent's data go?
 *
 * Falls back to the environment defaults for anything the agent hasn't
 * overridden, so a single-client deployment needs no rows at all.
 */
export async function getAgentSettings(agentId: string): Promise<AgentSettings> {
  const fallback = defaultSettings(agentId);
  if (!agentId || !isSupabaseConfigured()) return fallback;

  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("agent_settings")
      .select("*")
      .eq("agent_id", agentId)
      .maybeSingle();

    if (!data) return fallback;

    return {
      agentId,
      agentName: data.agent_name || "",
      timezone: data.timezone || fallback.timezone,
      alertNumber: data.alert_number || fallback.alertNumber,
      alertOnBook: data.alert_on_book !== false,
      alertOnLead: data.alert_on_lead !== false,
      customLogs: parseLogs(data.custom_logs),
      transferNumber: data.transfer_number || fallback.transferNumber,
      transferMode: mode(data.transfer_mode),
      transferNote: data.transfer_note || "",
      screenAgentId: data.screen_agent_id || "",
      screenPrompt: data.screen_prompt || "",
      screenRingSeconds: int(data.screen_ring_seconds, fallback.screenRingSeconds),
      screenDecideSeconds: int(data.screen_decide_seconds, fallback.screenDecideSeconds),
      screenOnTimeout: data.screen_on_timeout === "bridge" ? "bridge" : "cancel",
      summaryEmail: data.summary_email || fallback.summaryEmail,
      emailEveryCall: data.email_every_call === true,
      // Defaults on. The whole point of the screening flow is that someone
      // wanted a human and may not have got one — that always deserves an email.
      emailOnTransfer: data.email_on_transfer !== false,
    };
  } catch (err) {
    console.error("[agent-settings] lookup failed, using defaults:", err);
    return fallback;
  }
}

export async function saveAgentSettings(input: {
  agentId: string;
  agentName?: string;
  timezone?: string;
  alertNumber?: string;
  alertOnBook?: boolean;
  alertOnLead?: boolean;
  customLogs?: unknown;
  transferNumber?: string;
  transferMode?: string;
  transferNote?: string;
  screenAgentId?: string;
  screenPrompt?: string;
  screenRingSeconds?: number;
  screenDecideSeconds?: number;
  screenOnTimeout?: string;
  summaryEmail?: string;
  emailEveryCall?: boolean;
  emailOnTransfer?: boolean;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const supabase = getSupabase();
  await supabase.from("agent_settings").upsert(
    {
      agent_id: input.agentId,
      agent_name: input.agentName || null,
      timezone: input.timezone || null,
      alert_number: input.alertNumber || null,
      alert_on_book: input.alertOnBook !== false,
      alert_on_lead: input.alertOnLead !== false,
      custom_logs: parseLogs(input.customLogs),
      transfer_number: input.transferNumber || null,
      transfer_mode: mode(input.transferMode),
      transfer_note: input.transferNote || null,
      screen_agent_id: input.screenAgentId || null,
      screen_prompt: input.screenPrompt || null,
      screen_ring_seconds: int(input.screenRingSeconds, 25),
      screen_decide_seconds: int(input.screenDecideSeconds, 30),
      screen_on_timeout: input.screenOnTimeout === "bridge" ? "bridge" : "cancel",
      summary_email: input.summaryEmail || null,
      email_every_call: input.emailEveryCall === true,
      email_on_transfer: input.emailOnTransfer !== false,
    },
    { onConflict: "agent_id" }
  );
}
