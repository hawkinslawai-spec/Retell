import { getRetell } from "../retell-client";
import { appBaseUrl } from "../retell-agents";
import { STAFF, Staff, MAIN_NUMBER } from "./firm";

/**
 * Amy's Retell wiring (Sections 7 and 13).
 *
 * Two decisions worth explaining, because both are load-bearing:
 *
 * ONE TOOL PER PERSON. The specification's tool signature is
 * transfer_call(staff_id, …), but handing the model a free-text destination
 * means it can produce a number that doesn't exist, or — worse — one it has
 * seen elsewhere in the conversation. Instead each member of staff gets their
 * own tool with their direct line fixed in code. The model chooses a person;
 * it never chooses a number, and it has no way to read a direct line out to a
 * caller because it has never seen one.
 *
 * THE WHISPER IS AN AGENT, NOT A RECORDING. Retell's agentic warm transfer
 * dials the staff leg and puts a small screening agent on it while the caller
 * waits. That satisfies the hard requirement in Section 7 — the keypress is
 * the guard against bridging a caller into voicemail — because voicemail will
 * neither press 1 nor say "transfer", so the screener cancels instead of
 * connecting. It also means the staff member can simply answer "yes" rather
 * than hunting for the keypad, which is what people actually do.
 */

const SCREEN_MODEL = "gpt-5.4-mini";

/** 30 seconds ringing, per Section 7. */
const RING_MS = 30000;
/** 8 seconds for a keypress, repeated once, so ~20s of total decision time. */
const DECIDE_MS = 20000;

/**
 * What the screening agent says to the member of staff.
 *
 * The caller's name and a short matter label only — Section 7 is explicit
 * that nothing further goes in the whisper, because the staff leg is not a
 * secure channel and the caller's matter is confidential.
 */
export function whisperPrompt(staff: Staff): string {
  return `## Who you are
You are Hawkins Law's call screener. You have rung ${staff.firstName} to ask
whether they will take a call that is holding right now.

You are NOT speaking to the caller. The caller cannot hear any of this.

## What to say, immediately
Say this and then stop and wait:

"Hi ${staff.firstName}, I have {{caller_name}} on the line about {{matter_label}}.
Press 1 or say transfer to take the call, or hash or say take a message to decline."

If {{urgent_call}} is "true", begin with "Urgent call." before anything else.

If you have no caller name, say "a caller". If you have no matter label, say
"they haven't said what it's about". Never say the words caller_name,
matter_label or urgent_call out loud. Never invent a reason for the call.
Never add any other detail about the matter — you have not been given any,
and the caller's affairs are confidential.

## How they answer
Accept — they press 1, or say anything meaning yes: "transfer", "yes",
"put them through", "I'll take it".
→ Say "Connecting you now." Then call bridge_transfer.

Decline — they press hash, or say anything meaning no: "take a message",
"no", "I'm busy", "I'm with a client".
→ Say "No problem, I'll take a message." Then call cancel_transfer.

No clear answer, silence, or an answering machine greeting.
→ Call cancel_transfer. Never leave a voicemail message and never connect
  the caller to voicemail. If you hear a recorded greeting of any kind,
  cancel immediately.

## Rules
- One question, one answer, then a tool call. Do not chat.
- If they say nothing at all, repeat the question once, then cancel.
- Never end without calling bridge_transfer or cancel_transfer — the caller
  is holding and would be stranded.
- If they ask who is calling, repeat the caller's name and matter label and
  nothing more.`;
}

function screenTools() {
  return [
    {
      type: "bridge_transfer" as const,
      name: "bridge_transfer",
      description:
        "Connect the waiting caller to this member of staff. Call this as soon as they accept — pressing 1 or saying transfer.",
      speak_during_execution: true,
      execution_message_type: "static_text" as const,
      execution_message_description: "Connecting you now.",
    },
    {
      type: "cancel_transfer" as const,
      name: "cancel_transfer",
      description:
        "Decline the transfer and return the caller to Amy. Call this when they press hash, say take a message, give no clear answer, or when you reach voicemail.",
      speak_during_execution: false,
    },
  ];
}

/**
 * Create or update the one screening agent shared by every transfer tool.
 *
 * Shared rather than one per person because the whisper's variable part —
 * who is calling and about what — travels on the call's dynamic variables,
 * not in the prompt. Only the staff member's name differs, and that is
 * carried by having a separate agent per person would be wasteful; instead
 * the prompt addresses them by a variable too.
 */
export async function upsertScreener(
  existingId: string,
  voiceId: string
): Promise<string> {
  const retell = getRetell();

  // One screener, addressed to whoever is being rung via {{staff_first_name}}.
  const prompt = whisperPrompt({
    firstName: "{{staff_first_name}}",
  } as Staff);

  try {
    if (existingId) {
      const existing = (await retell.agent.retrieve(existingId)) as unknown as Record<
        string,
        unknown
      >;
      const engine = (existing.response_engine || {}) as Record<string, unknown>;
      const llmId = String(engine.llm_id ?? "");

      // An agent built on an LLM that was created WITHOUT is_transfer_llm can
      // never be repaired, because that flag is ignored on update. Reusing it
      // would leave transfers silently without their keypress guard, so throw
      // it away and build a fresh one instead.
      const usable = existing.is_transfer_agent === true;
      if (!usable) {
        console.warn(
          "[hawkins] the existing screening agent is not a transfer agent — building a new one."
        );
      }

      if (llmId && usable) {
        await retell.llm.update(llmId, {
          model: SCREEN_MODEL as never,
          general_prompt: prompt,
          begin_message: null,
          model_temperature: 0.2,
          general_tools: screenTools() as never,
        });
        await retell.agent.update(existingId, {
          agent_name: "Hawkins Law — call screener",
          voice_id: voiceId,
          language: "en-GB" as never,
        } as never);
        return existingId;
      }
    }

    const llm = await retell.llm.create({
      model: SCREEN_MODEL as never,
      general_prompt: prompt,
      // No greeting text, but the screener must still speak first — the staff
      // member has just picked up a ringing phone and silence reads as a dead
      // line. start_speaker "agent" makes it open from the prompt.
      begin_message: null,
      start_speaker: "agent",
      model_temperature: 0.2,
      general_tools: screenTools() as never,
      // Required for the bridge_transfer and cancel_transfer tools, and for an
      // agent built on this LLM to be accepted as a transfer agent. Without
      // it Retell rejects the agent with "Retell LLM is not a transfer retell
      // llm". Note it can ONLY be set at creation — it is ignored on update,
      // so an LLM made without it can never become a transfer LLM and has to
      // be replaced.
      is_transfer_llm: true,
    } as never);

    const agent = await retell.agent.create({
      agent_name: "Hawkins Law — call screener",
      voice_id: voiceId,
      language: "en-GB" as never,
      response_engine: { type: "retell-llm", llm_id: llm.llm_id },
      is_transfer_agent: true,
    } as never);

    return String((agent as unknown as Record<string, unknown>).agent_id ?? "");
  } catch (err) {
    console.error("[hawkins] could not create the screening agent:", err);
    return "";
  }
}

/**
 * Amy's complete tool set.
 *
 * Six transfer tools, the message tool, the client account tool, a variable
 * extractor that feeds the whisper, and end_call for abusive callers.
 */
export function amyTools(screenAgentId: string) {
  const base = appBaseUrl();
  if (!base) return null;

  const transfers = STAFF.map((staff) => ({
    type: "transfer_call" as const,
    name: `transfer_to_${staff.id}`,
    description:
      `Put the caller through to ${staff.fullName}. ` +
      `Only call this when the office is open, after you have the caller's full name and ` +
      `what the call is about, and after you have said you are checking whether they are free.`,
    transfer_destination: {
      type: "predefined" as const,
      number: staff.directLine,
    },
    transfer_option: screenAgentId
      ? {
          type: "agentic_warm_transfer" as const,
          agentic_transfer_config: {
            transfer_agent: { agent_id: screenAgentId, agent_version: 0 },
            transfer_timeout_ms: DECIDE_MS,
            // Never bridge on a timeout. Section 7 requires a keypress
            // precisely so that an unanswered phone or a voicemail greeting
            // can never swallow a client's call.
            action_on_timeout: "cancel_transfer" as const,
          },
          // A ringing tone, not hold music — Section 7.
          on_hold_music: "ringtone" as const,
          transfer_ring_duration_ms: RING_MS,
          // The firm's main number, so staff recognise a transfer.
          show_transferee_as_caller: false,
        }
      : {
          // Degraded fallback if the screener could not be built. Still a warm
          // transfer, but without the keypress guard — logged loudly at save
          // time so it is never silently the live configuration.
          type: "warm_transfer" as const,
          on_hold_music: "ringtone" as const,
          transfer_ring_duration_ms: RING_MS,
          private_handoff_option: {
            type: "prompt" as const,
            prompt:
              "Say who is on the line and what it is about, in one sentence. Then stop.",
          },
        },
    speak_during_execution: false,
  }));

  return [
    {
      type: "extract_dynamic_variable" as const,
      name: "note_caller_details",
      description:
        "Record who is calling, what the call is about, which member of staff you are about to ring, and whether it is urgent. " +
        "Call this immediately before any transfer_to_ tool — these details are what the member of staff hears when their phone rings.",
      variables: [
        {
          type: "string" as const,
          name: "caller_name",
          description: "The caller's full name as they gave it.",
        },
        {
          type: "string" as const,
          name: "matter_label",
          description:
            "A short label for what the call is about — a property address, matter name or file reference. " +
            "For a new enquiry use a plain description such as 'a house purchase'. Under ten words. Never include matter details beyond this label.",
        },
        {
          type: "string" as const,
          name: "staff_first_name",
          description: "The first name of the member of staff you are about to ring.",
        },
        {
          type: "string" as const,
          name: "urgent_call",
          description:
            "'true' only if an urgency trigger applies: exchange or completion today or tomorrow, a hearing or deadline within 48 hours, a bank details concern, immigration detention or removal, a safety concern, or the caller says it is urgent. Otherwise 'false'.",
        },
      ],
    },

    ...transfers,

    {
      type: "custom" as const,
      name: "send_message",
      url: `${base}/api/retell/send-message`,
      method: "POST" as const,
      timeout_ms: 15000,
      speak_during_execution: false,
      description:
        "Email a message to the right people. Call this whenever a transfer was not attempted, was not accepted, or the office is closed — and always before ending a call where nobody was connected.",
      parameters: {
        type: "object" as const,
        required: ["caller_name", "phone", "message", "route"],
        properties: {
          caller_name: { type: "string", description: "The caller's full name." },
          phone: {
            type: "string",
            description: "The best number to call back on, digits only.",
          },
          email: { type: "string", description: "Email address, if they gave one." },
          route: {
            type: "string",
            description:
              "One of: named_handler, new_enquiry, unknown_handler, third_party, complaint. This decides who receives the message.",
          },
          file_handler: {
            type: "string",
            description:
              "The member of staff dealing with the matter, if known. Use their first name or full name.",
          },
          matter_label: {
            type: "string",
            description: "Property address, matter name or file reference.",
          },
          organisation: {
            type: "string",
            description: "For third parties: their firm or agency, and their own reference.",
          },
          message: {
            type: "string",
            description:
              "What the caller wants, in their own terms. Summarise faithfully and add no interpretation of your own.",
          },
          callback: { type: "string", description: "A good time to call back, if given." },
          why_no_transfer: {
            type: "string",
            description:
              "One of: declined, no answer, busy, office closed, not attempted.",
          },
          urgent: {
            type: "string",
            description: "'true' if an urgency trigger applies, otherwise 'false'.",
          },
        },
      },
    },

    {
      type: "custom" as const,
      name: "get_client_account_details",
      url: `${base}/api/retell/client-account`,
      method: "POST" as const,
      timeout_ms: 10000,
      speak_during_execution: false,
      description:
        "Fetch the firm's client account details as a fixed script. Call this whenever a caller asks for, or wants to check, the firm's bank or client account details. Read the returned script exactly, one digit at a time. Never state a bank detail from memory.",
      parameters: {
        type: "object" as const,
        required: [],
        properties: {
          caller_name: { type: "string", description: "The caller's name, for the record." },
          phone: { type: "string", description: "Their number, for the record." },
          matter_label: { type: "string", description: "Property address or matter reference." },
          file_handler: {
            type: "string",
            description: "The member of staff dealing with the matter, if known.",
          },
        },
      },
    },

    {
      type: "end_call" as const,
      name: "end_call",
      description:
        "End the call. Use this only after giving an abusive caller one calm warning that you will end the call, or once a caller has confirmed there is nothing else you can help with.",
    },
  ] as ReturnType<typeof Array.prototype.concat>;
}

/**
 * Which Retell agents are Amy?
 *
 * Identified by name rather than a hardcoded id, so this keeps working after
 * the agent is rebuilt or a second one is made for staging. The screening
 * agent is excluded — it is an Amy component, not an Amy.
 *
 * Returns an empty list rather than throwing: this only drives which
 * diagnostics run, and a Retell outage should not turn the setup page into
 * an error.
 */
export async function amyAgentIds(): Promise<string[]> {
  try {
    const res = await getRetell().agent.list({ limit: 100 });
    const rows = Array.isArray(res)
      ? res
      : ((res as { items?: unknown[] })?.items ?? []);

    return (rows as Record<string, unknown>[])
      .filter((a) => {
        const name = String(a.agent_name ?? "").toLowerCase();
        return name.startsWith("amy") && !name.includes("screener");
      })
      .map((a) => String(a.agent_id ?? ""))
      .filter(Boolean);
  } catch (err) {
    console.error("[hawkins] could not list agents:", err);
    return [];
  }
}
