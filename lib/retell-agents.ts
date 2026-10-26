import { getRetell, unwrapList } from "./retell-client";
import { CustomLog } from "./custom-logs";
import { getAgentSettings, saveAgentSettings } from "./agent-settings";
import { upsertScreenAgent, defaultScreenPrompt } from "./screening";
import { BUSINESS_NAME } from "./config";

/**
 * Models Retell exposes for its own LLM engine. Pulled from the SDK's own
 * union type rather than typed by hand, so it can't drift into inventing an
 * ID that doesn't exist.
 */
export const MODELS: { id: string; label: string; group: string }[] = [
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", group: "OpenAI" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", group: "OpenAI" },
  { id: "gpt-5.5", label: "GPT-5.5", group: "OpenAI" },
  { id: "gpt-5.4", label: "GPT-5.4", group: "OpenAI" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", group: "OpenAI" },
  { id: "gpt-5.4-nano", label: "GPT-5.4 Nano", group: "OpenAI" },
  { id: "gpt-5.2", label: "GPT-5.2", group: "OpenAI" },
  { id: "gpt-5.1", label: "GPT-5.1", group: "OpenAI" },
  { id: "gpt-5", label: "GPT-5", group: "OpenAI" },
  { id: "gpt-5-mini", label: "GPT-5 Mini", group: "OpenAI" },
  { id: "gpt-5-nano", label: "GPT-5 Nano", group: "OpenAI" },
  { id: "gpt-4.1", label: "GPT-4.1", group: "OpenAI" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", group: "OpenAI" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 Nano", group: "OpenAI" },
  { id: "claude-5-sonnet", label: "Claude Sonnet 5", group: "Anthropic" },
  { id: "claude-4.6-sonnet", label: "Claude Sonnet 4.6", group: "Anthropic" },
  { id: "claude-4.5-sonnet", label: "Claude Sonnet 4.5", group: "Anthropic" },
  { id: "claude-4.5-haiku", label: "Claude Haiku 4.5", group: "Anthropic" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", group: "Google" },
  { id: "gemini-3.0-flash", label: "Gemini 3.0 Flash", group: "Google" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", group: "Google" },
  { id: "gpt-realtime-2.1", label: "GPT Realtime 2.1", group: "Realtime (speech-to-speech)" },
  { id: "gpt-realtime-2.1-mini", label: "GPT Realtime 2.1 Mini", group: "Realtime (speech-to-speech)" },
  { id: "gpt-realtime-2", label: "GPT Realtime 2", group: "Realtime (speech-to-speech)" },
  { id: "gpt-realtime-1.5", label: "GPT Realtime 1.5", group: "Realtime (speech-to-speech)" },
  { id: "gpt-realtime", label: "GPT Realtime", group: "Realtime (speech-to-speech)" },
  { id: "gpt-realtime-mini", label: "GPT Realtime Mini", group: "Realtime (speech-to-speech)" },
];

/** All 61 language options Retell accepts, "multi" included. */
export const LANGUAGES: { id: string; label: string }[] = [
  { id: "multi", label: "Multilingual (auto-detect)" },
  { id: "en-US", label: "English (US)" },
  { id: "en-GB", label: "English (UK)" },
  { id: "en-AU", label: "English (Australia)" },
  { id: "en-IN", label: "English (India)" },
  { id: "en-NZ", label: "English (New Zealand)" },
  { id: "es-ES", label: "Spanish (Spain)" },
  { id: "fr-FR", label: "French (France)" },
  { id: "fr-CA", label: "French (Canada)" },
  { id: "de-DE", label: "German" },
  { id: "it-IT", label: "Italian" },
  { id: "pt-PT", label: "Portuguese (Portugal)" },
  { id: "pt-BR", label: "Portuguese (Brazil)" },
  { id: "nl-NL", label: "Dutch" },
  { id: "nl-BE", label: "Dutch (Belgium)" },
  { id: "hi-IN", label: "Hindi" },
  { id: "ur-IN", label: "Urdu" },
  { id: "mr-IN", label: "Marathi" },
  { id: "ta-IN", label: "Tamil" },
  { id: "kn-IN", label: "Kannada" },
  { id: "ar-SA", label: "Arabic" },
  { id: "fa-IR", label: "Persian" },
  { id: "he-IL", label: "Hebrew" },
  { id: "tr-TR", label: "Turkish" },
  { id: "ru-RU", label: "Russian" },
  { id: "uk-UA", label: "Ukrainian" },
  { id: "pl-PL", label: "Polish" },
  { id: "cs-CZ", label: "Czech" },
  { id: "sk-SK", label: "Slovak" },
  { id: "hu-HU", label: "Hungarian" },
  { id: "ro-RO", label: "Romanian" },
  { id: "bg-BG", label: "Bulgarian" },
  { id: "hr-HR", label: "Croatian" },
  { id: "sr-RS", label: "Serbian" },
  { id: "sl-SI", label: "Slovenian" },
  { id: "bs-BA", label: "Bosnian" },
  { id: "mk-MK", label: "Macedonian" },
  { id: "el-GR", label: "Greek" },
  { id: "sv-SE", label: "Swedish" },
  { id: "no-NO", label: "Norwegian" },
  { id: "da-DK", label: "Danish" },
  { id: "fi-FI", label: "Finnish" },
  { id: "is-IS", label: "Icelandic" },
  { id: "lt-LT", label: "Lithuanian" },
  { id: "lv-LV", label: "Latvian" },
  { id: "et-EE", label: "Estonian" },
  { id: "ja-JP", label: "Japanese" },
  { id: "ko-KR", label: "Korean" },
  { id: "zh-CN", label: "Chinese (Mandarin)" },
  { id: "vi-VN", label: "Vietnamese" },
  { id: "th-TH", label: "Thai" },
  { id: "id-ID", label: "Indonesian" },
  { id: "ms-MY", label: "Malay" },
  { id: "ne-NP", label: "Nepali" },
  { id: "sw-KE", label: "Swahili" },
  { id: "af-ZA", label: "Afrikaans" },
  { id: "ca-ES", label: "Catalan" },
  { id: "gl-ES", label: "Galician" },
  { id: "cy-GB", label: "Welsh" },
  { id: "hy-AM", label: "Armenian" },
  { id: "az-AZ", label: "Azerbaijani" },
  { id: "kk-KZ", label: "Kazakh" },
].filter((l) => l.id !== "et-EE"); // not in Retell's list

export type Voice = {
  voice_id: string;
  voice_name: string;
  provider: string;
  gender: string;
  accent: string;
  preview_audio_url: string;
};

export async function listVoices(): Promise<Voice[]> {
  const retell = getRetell();
  const res = await retell.voice.list();
  const rows = unwrapList<unknown>(res);

  return rows.map((row) => {
    const v = row as unknown as Record<string, unknown>;
    return {
      voice_id: String(v.voice_id ?? ""),
      voice_name: String(v.voice_name ?? ""),
      provider: String(v.provider ?? ""),
      gender: String(v.gender ?? ""),
      accent: String(v.accent ?? ""),
      preview_audio_url: String(v.preview_audio_url ?? ""),
    };
  });
}

export type AgentSummary = {
  agent_id: string;
  agent_name: string;
  voice_id: string;
  language: string;
  llm_id: string;
  engine_type: string;
};

function toSummary(row: unknown): AgentSummary {
  const a = row as unknown as Record<string, unknown>;
  const engine = (a.response_engine || {}) as Record<string, unknown>;
  return {
    agent_id: String(a.agent_id ?? ""),
    agent_name: String(a.agent_name ?? "") || String(a.agent_id ?? ""),
    voice_id: String(a.voice_id ?? ""),
    language: String(a.language ?? ""),
    llm_id: String(engine.llm_id ?? ""),
    engine_type: String(engine.type ?? ""),
  };
}

export async function listAgents(): Promise<AgentSummary[]> {
  const retell = getRetell();
  const res = await retell.agent.list({ limit: 100 });
  const rows = unwrapList<unknown>(res);

  const seen = new Set<string>();
  const agents: AgentSummary[] = [];
  for (const row of rows) {
    const summary = toSummary(row);
    if (!summary.agent_id || seen.has(summary.agent_id)) continue;
    seen.add(summary.agent_id);
    agents.push(summary);
  }
  return agents;
}

export type AgentDetail = AgentSummary & {
  model: string;
  general_prompt: string;
  begin_message: string;
  model_temperature: number | null;
  tool_names: string[];
  webhook_url: string;
};

export async function getAgent(agentId: string): Promise<AgentDetail> {
  const retell = getRetell();
  const agent = await retell.agent.retrieve(agentId);
  const summary = toSummary(agent);

  let model = "";
  let generalPrompt = "";
  let beginMessage = "";
  let temperature: number | null = null;
  let toolNames: string[] = [];
  const webhookUrl = String(
    (agent as unknown as Record<string, unknown>).webhook_url ?? ""
  );

  // Prompt and greeting live on the LLM, not the agent — a Retell split that
  // trips people up. Conversation-flow agents have no LLM to read.
  if (summary.llm_id && summary.engine_type === "retell-llm") {
    const llm = (await retell.llm.retrieve(summary.llm_id)) as unknown as Record<string, unknown>;
    model = String(llm.model ?? "");
    generalPrompt = String(llm.general_prompt ?? "");
    beginMessage = String(llm.begin_message ?? "");
    temperature = typeof llm.model_temperature === "number" ? llm.model_temperature : null;
    const tools = Array.isArray(llm.general_tools) ? llm.general_tools : [];
    toolNames = tools
      .map((t) => String((t as Record<string, unknown>).name ?? ""))
      .filter(Boolean);
  }

  return {
    ...summary,
    model,
    general_prompt: generalPrompt,
    begin_message: beginMessage,
    model_temperature: temperature,
    tool_names: toolNames,
    webhook_url: webhookUrl,
  };
}

/**
 * Public base URL of this deployment. Retell calls these endpoints from its own
 * servers, so localhost and private IPs are rejected.
 */
export function appBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "";
}

/**
 * The custom functions plus the post-call webhook.
 *
 * Without these an agent can talk, but it cannot check the diary, book
 * anything, or record an enquiry — which looks exactly like "nothing is
 * updating".
 */
type TransferConfig = {
  number: string;
  mode: "warm" | "cold" | "screen";
  note: string;
  /** Only used in "screen" mode. Without it, screen falls back to warm. */
  screenAgentId?: string;
  ringSeconds?: number;
  decideSeconds?: number;
  onTimeout?: "bridge" | "cancel";
};

function buildTools(customLogs: CustomLog[] = [], transfer?: TransferConfig) {
  const base = appBaseUrl();
  if (!base) return null;

  /**
   * Hands the live caller to a human.
   *
   * Warm transfer rings the destination while the caller waits on hold, and the
   * agent gives whoever answers a short verbal summary before bridging. Cold
   * transfer just forwards the call — faster, but the human picks up with no
   * idea who is on the line or why.
   */
  function transferOption() {
    if (!transfer) return undefined;

    const ringMs = Math.round((transfer.ringSeconds ?? 25) * 1000);

    if (transfer.mode === "cold") {
      return {
        type: "cold_transfer" as const,
        show_transferee_as_caller: true,
        transfer_ring_duration_ms: ringMs,
      };
    }

    // Screened transfer: ring the human, let a screening agent state who is
    // calling and why, and accept or decline on their behalf. Falls back to a
    // plain warm transfer if the screening agent is missing, so a failed
    // screener provision never silently disables transfers altogether.
    if (transfer.mode === "screen" && transfer.screenAgentId) {
      return {
        type: "agentic_warm_transfer" as const,
        agentic_transfer_config: {
          transfer_agent: {
            agent_id: transfer.screenAgentId,
            // "latest" would drift if someone edits the screener in the Retell
            // dashboard mid-campaign. 0 pins the published version.
            agent_version: 0,
          },
          transfer_timeout_ms: Math.round((transfer.decideSeconds ?? 30) * 1000),
          // Default to cancelling. Bridging on timeout dumps a confused human
          // onto a live customer with no idea who they are, which is worse
          // than the caller being told nobody could take it.
          action_on_timeout:
            transfer.onTimeout === "bridge"
              ? ("bridge_transfer" as const)
              : ("cancel_transfer" as const),
        },
        on_hold_music: "relaxing_sound" as const,
        transfer_ring_duration_ms: ringMs,
        public_handoff_option: {
          type: "prompt" as const,
          prompt:
            "Briefly introduce the two sides to each other: say the caller's name to your colleague, and your colleague is now on the line. One sentence, then stop.",
        },
      };
    }

    return {
      type: "warm_transfer" as const,
      on_hold_music: "relaxing_sound" as const,
      transfer_ring_duration_ms: ringMs,
      public_handoff_option: {
        type: "prompt" as const,
        prompt: "Tell the caller you're connecting them now and to hold for a moment.",
      },
      private_handoff_option: {
        type: "prompt" as const,
        prompt:
          "In one or two sentences, tell your colleague who is on the line, what they need, and anything urgent. Then stop talking.",
      },
    };
  }

  /**
   * Captures the two things the screening agent needs to say to the human.
   *
   * These are set on the main call before the transfer runs, so the screener
   * can open with "I've got Sarah on the line about a damaged delivery" rather
   * than "someone is calling". Harmless in warm and cold mode — the variables
   * are simply never read.
   */
  const screenVariableTool =
    transfer && transfer.number && transfer.mode === "screen"
      ? [
          {
            type: "extract_dynamic_variable" as const,
            name: "note_caller_details",
            description:
              "Record who is calling and what they want. Call this as soon as you know both, and always before transfer_to_team — the colleague you are transferring to hears these details when their phone rings.",
            variables: [
              {
                type: "string" as const,
                name: "caller_name",
                description: "The caller's first name, or their full name if they gave it.",
              },
              {
                type: "string" as const,
                name: "caller_purpose",
                description:
                  "What the caller wants, in under ten words, phrased so a colleague can understand it instantly. For example 'a damaged delivery' or 'rescheduling Friday's appointment'.",
              },
            ],
          },
        ]
      : [];

  const transferTool =
    transfer && transfer.number
      ? [
          {
            type: "transfer_call" as const,
            name: "transfer_to_team",
            description:
              transfer.note ||
              "Transfer the caller to a human on the team. Use this for complaints, damaged or missed deliveries, cancellations, weddings, funerals, guaranteed timing requests, or whenever the caller asks to speak to a person.",
            transfer_destination: { type: "predefined" as const, number: transfer.number },
            transfer_option: transferOption(),
            speak_during_execution: true,
            execution_message_description:
              transfer.mode === "screen"
                ? "Tell the caller you're seeing if a colleague is free, and ask them to hold for a moment. Do not promise that someone will definitely pick up."
                : "Say you're connecting them to the team now, warmly and in a few words.",
          },
        ]
      : [];

  // One generated tool per custom log. The log key rides in the query string,
  // so the agent only supplies the fields you defined.
  const customTools = customLogs
    .filter((log) => log.label && log.fields.length > 0)
    .map((log) => {
      const properties: Record<string, { type: string; description: string }> = {};
      for (const field of log.fields) {
        properties[field.name] = {
          type: "string",
          description: field.description || field.name,
        };
      }

      return {
        type: "custom" as const,
        name: `log_${log.key}`,
        url: `${base}/api/retell/log-entry?log=${encodeURIComponent(log.key)}`,
        method: "POST" as const,
        timeout_ms: 10000,
        speak_during_execution: false,
        description:
          log.description ||
          `Record a ${log.label}. Call this when the conversation produces information that belongs in the ${log.label} record.`,
        parameters: {
          type: "object" as const,
          required: [log.fields[0].name],
          properties,
        },
      };
    });

  return [...screenVariableTool, ...transferTool, ...customTools,
    {
      type: "custom" as const,
      name: "check_availability",
      url: `${base}/api/retell/check-availability`,
      method: "POST" as const,
      timeout_ms: 10000,
      speak_during_execution: true,
      execution_message_description: "Say you're checking the diary, in a few words.",
      description:
        "Check which appointment times are open on a given day. Call this whenever the caller asks about availability or suggests a day, before offering any time. Never guess or invent available times.",
      parameters: {
        type: "object" as const,
        required: ["date"],
        properties: {
          date: {
            type: "string",
            description:
              "The day the caller wants. Use 'today', 'tomorrow', a weekday name like 'thursday', or an exact date as YYYY-MM-DD.",
          },
          preferred_time: {
            type: "string",
            description: "Optional. One of: morning, afternoon, evening.",
          },
        },
      },
    },
    {
      type: "custom" as const,
      name: "book_appointment",
      url: `${base}/api/retell/book-appointment`,
      method: "POST" as const,
      timeout_ms: 15000,
      speak_during_execution: true,
      execution_message_description: "Say you're locking that in, in a few words.",
      description:
        "Book the appointment. Only call this after the caller confirms a specific time that check_availability returned, and you have their name and phone number.",
      parameters: {
        type: "object" as const,
        required: ["name", "phone", "start_time"],
        properties: {
          name: { type: "string", description: "The caller's full name." },
          phone: { type: "string", description: "The caller's phone number, digits only." },
          email: { type: "string", description: "Optional email address." },
          start_time: {
            type: "string",
            description:
              "The exact chosen slot in ISO 8601 format with offset, copied verbatim from the slots_iso list returned by check_availability. Never construct this yourself.",
          },
          service: { type: "string", description: "What the appointment is for." },
          notes: { type: "string", description: "Anything else worth passing on." },
        },
      },
    },
    {
      type: "custom" as const,
      name: "save_lead",
      url: `${base}/api/retell/save-lead`,
      method: "POST" as const,
      timeout_ms: 10000,
      speak_during_execution: false,
      description:
        "Save the caller's details. Call this whenever the caller gives a name and number but does not book — a callback request, an enquiry, or a do-not-call request.",
      parameters: {
        type: "object" as const,
        required: ["name"],
        properties: {
          name: { type: "string", description: "The caller's name." },
          phone: { type: "string", description: "Phone number, digits only." },
          email: { type: "string", description: "Optional email address." },
          interest: { type: "string", description: "What they were asking about." },
          notes: {
            type: "string",
            description:
              "One-line summary of what they need. Use 'DO NOT CALL — requested removal' for opt-outs.",
          },
          interested: {
            type: "string",
            description:
              "'yes' if the caller showed genuine interest and wants to be contacted, 'no' otherwise. Setting yes sends an instant text alert to the team, so only use it for real interest.",
          },
        },
      },
    },
  ] as ReturnType<typeof Array.prototype.concat>;
}

export type AgentInput = {
  agentName: string;
  voiceId: string;
  language: string;
  model: string;
  generalPrompt: string;
  beginMessage: string;
  temperature: number;
};

export async function createAgent(
  input: AgentInput,
  customLogs: CustomLog[] = [],
  transfer?: TransferConfig
): Promise<string> {
  const retell = getRetell();

  // Two calls: the LLM holds the brain, the agent holds the voice.
  const tools = buildTools(customLogs, transfer);
  const base = appBaseUrl();

  const llm = await retell.llm.create({
    model: input.model as never,
    general_prompt: input.generalPrompt,
    begin_message: input.beginMessage || null,
    model_temperature: input.temperature,
    general_tools: (tools as never) ?? undefined,
  });

  const agent = await retell.agent.create({
    agent_name: input.agentName,
    voice_id: input.voiceId,
    language: input.language as never,
    response_engine: { type: "retell-llm", llm_id: llm.llm_id },
    webhook_url: base ? `${base}/api/retell/webhook` : undefined,
  });

  return agent.agent_id;
}

export async function updateAgent(
  agentId: string,
  llmId: string,
  input: AgentInput
): Promise<void> {
  const retell = getRetell();

  // Read back what was just saved, so newly added logs get their tools.
  const settings = await getAgentSettings(agentId);

  // The screening agent is a second Retell agent, created on demand the first
  // time someone switches this agent to screened transfers and reused after
  // that. Doing it here rather than in the UI means the client never has to
  // know it exists — they tick a box and it appears.
  let screenAgentId = settings.screenAgentId;
  if (settings.transferMode === "screen" && settings.transferNumber) {
    screenAgentId = await upsertScreenAgent(screenAgentId, {
      name: `${input.agentName || "Agent"} — screener`,
      prompt: settings.screenPrompt || defaultScreenPrompt(BUSINESS_NAME),
      voiceId: input.voiceId,
      language: input.language,
    });

    if (screenAgentId !== settings.screenAgentId) {
      await saveAgentSettings({ ...settings, screenAgentId });
    }
  }

  const tools = buildTools(settings.customLogs, {
    number: settings.transferNumber,
    mode: settings.transferMode,
    note: settings.transferNote,
    screenAgentId,
    ringSeconds: settings.screenRingSeconds,
    decideSeconds: settings.screenDecideSeconds,
    onTimeout: settings.screenOnTimeout,
  });
  const base = appBaseUrl();

  if (llmId) {
    await retell.llm.update(llmId, {
      model: input.model as never,
      general_prompt: input.generalPrompt,
      begin_message: input.beginMessage || null,
      model_temperature: input.temperature,
      // Re-attach every save, so an agent created before this existed gets
      // repaired the moment you press Save.
      general_tools: (tools as never) ?? undefined,
    });
  }

  await retell.agent.update(agentId, {
    agent_name: input.agentName,
    voice_id: input.voiceId,
    language: input.language as never,
    webhook_url: base ? `${base}/api/retell/webhook` : undefined,
  });
}

export async function deleteAgent(agentId: string): Promise<void> {
  const retell = getRetell();
  await retell.agent.delete(agentId);
}
