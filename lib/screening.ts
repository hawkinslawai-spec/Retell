import { getRetell } from "./retell-client";

/**
 * The screening agent — the small AI that rings the human and asks whether
 * they'll take the call.
 *
 * How Retell's agentic warm transfer works, because the naming hides it:
 *
 *   1. Caller asks the main agent for a person.
 *   2. Main agent calls transfer_to_team. The caller goes on hold.
 *   3. Retell dials the human and puts THIS agent on that leg — not the main
 *      agent. The two legs are separate; this one talks only to the human.
 *   4. This agent states who's calling and why, then waits for a decision.
 *   5. It calls bridge_transfer (connect the two) or cancel_transfer (send the
 *      caller back to the main agent).
 *
 * The human can answer by voice or by keypad. Retell captures RFC 2833 DTMF on
 * every agent by default, so "press one" arrives as ordinary user input and the
 * model treats it like any other answer — no IVR configuration needed. We offer
 * both because a human answering a mobile in a noisy place will reach for the
 * keypad, and one sitting at a desk will just talk.
 *
 * This agent is created once per main agent and reused. It is marked
 * is_transfer_agent so Retell allows it the bridge/cancel tools, which are
 * rejected on an ordinary agent.
 */

const SCREEN_MODEL = "gpt-5.4-mini";

/** What the screener says and how it decides. */
export function defaultScreenPrompt(businessName = "the team"): string {
  return `## Who you are
You are the call screener for ${businessName}. You have rung a colleague to ask
whether they will take a call that is waiting on hold right now.

You are NOT speaking to the customer. You are speaking to your colleague. The
customer cannot hear any of this.

## What to say first
Keep it to two sentences, then stop and wait:

"Hi, I've got {{caller_name}} on the line for you — it's about
{{caller_purpose}}. Press one to take it, or two if you can't right now."

If you don't have a name, say "a caller". If you don't know what it's about,
say "they haven't said what it's about". Never say the words "caller_name" or
"caller_purpose" out loud, and never invent a reason for the call.

## How they answer
Accept — they press 1, or say anything meaning yes: "yes", "put them through",
"sure", "go ahead", "I'll take it".
→ Say "Connecting you now." Then call bridge_transfer.

Decline — they press 2, or say anything meaning no: "no", "can't right now",
"I'm in a meeting", "take a message", "tell them to call back".
→ Ask once, briefly: "No problem — what should I tell them?" Wait for the
  answer, then call cancel_transfer and pass what they said as the reason.
  If they give no reason, use "they're not available right now".

Unclear — they're confused, or it's a voicemail greeting, or nobody says
anything useful.
→ Treat it as a decline. Call cancel_transfer with the reason
  "couldn't reach them".

## Rules
- Never let the decision drift. One question, one answer, then a tool call.
- Do not chat, do not explain yourself, do not pitch.
- Do not hang up without calling bridge_transfer or cancel_transfer. Ending
  without one of them leaves the customer stranded on hold.
- If they ask who you are, say you're the automated line for ${businessName},
  then repeat the question.
- If you reach an IVR or switchboard rather than a person, call
  cancel_transfer with the reason "couldn't get through".`;
}

/** The two tools only a transfer agent may hold. */
function screenTools() {
  return [
    {
      type: "bridge_transfer" as const,
      name: "bridge_transfer",
      description:
        "Connect the waiting caller to this colleague. Call this the moment they accept — by pressing 1 or by saying yes.",
      speak_during_execution: true,
      execution_message_type: "static_text" as const,
      execution_message_description: "Connecting you now.",
    },
    {
      type: "cancel_transfer" as const,
      name: "cancel_transfer",
      description:
        "Decline the transfer and send the caller back to the AI assistant. Call this when the colleague presses 2, says no, cannot take the call, or when you reach voicemail or cannot get a clear answer.",
      speak_during_execution: true,
      // Spoken on the way out. Keep it short — the caller is coming off hold
      // and the main agent picks the conversation back up immediately after.
      execution_message_type: "prompt" as const,
      execution_message_description:
        "In one short sentence, tell the caller the colleague isn't available right now and give the reason you were told, if you were given one. Do not apologise twice and do not promise a specific callback time.",
    },
  ];
}

export type ScreenAgentInput = {
  /** Shown in the Retell dashboard. Prefixed so it's obvious what it is. */
  name: string;
  prompt: string;
  voiceId: string;
  language: string;
};

/**
 * Create the screening agent, or update it in place if we already made one.
 *
 * Returns the agent ID to store against the main agent's settings. Returns ""
 * on failure rather than throwing — a broken screener should degrade the
 * transfer to a plain warm transfer, not stop the whole agent from saving.
 */
export async function upsertScreenAgent(
  existingAgentId: string,
  input: ScreenAgentInput
): Promise<string> {
  const retell = getRetell();

  try {
    if (existingAgentId) {
      const existing = (await retell.agent.retrieve(existingAgentId)) as unknown as Record<
        string,
        unknown
      >;
      const engine = (existing.response_engine || {}) as Record<string, unknown>;
      const llmId = String(engine.llm_id ?? "");

      if (llmId) {
        await retell.llm.update(llmId, {
          model: SCREEN_MODEL as never,
          general_prompt: input.prompt,
          begin_message: null,
          model_temperature: 0.2,
          general_tools: screenTools() as never,
        });

        await retell.agent.update(existingAgentId, {
          agent_name: input.name,
          voice_id: input.voiceId,
          language: input.language as never,
        } as never);

        return existingAgentId;
      }
      // No LLM on it (someone converted it to a conversation flow by hand).
      // Fall through and build a fresh one.
    }

    const llm = await retell.llm.create({
      model: SCREEN_MODEL as never,
      general_prompt: input.prompt,
      // No greeting: the human has just picked up a ringing phone, so the
      // screener must speak first and immediately. A begin_message would be
      // spoken before the line is settled and gets talked over.
      begin_message: null,
      // Low temperature on purpose. This agent has exactly one job and two
      // outcomes; creativity here produces a screener that chats instead of
      // deciding, while a real customer sits on hold.
      model_temperature: 0.2,
      general_tools: screenTools() as never,
    });

    // is_transfer_agent is required for the bridge/cancel tools to be accepted
    // but is not yet in the SDK's typed params, so it goes through as an extra
    // body field. If a future SDK types it, this cast becomes unnecessary.
    const agent = await retell.agent.create({
      agent_name: input.name,
      voice_id: input.voiceId,
      language: input.language as never,
      response_engine: { type: "retell-llm", llm_id: llm.llm_id },
      is_transfer_agent: true,
    } as never);

    return String((agent as unknown as Record<string, unknown>).agent_id ?? "");
  } catch (err) {
    console.error("[screening] could not create or update the screening agent:", err);
    return "";
  }
}

export async function deleteScreenAgent(agentId: string): Promise<void> {
  if (!agentId) return;
  try {
    await getRetell().agent.delete(agentId);
  } catch (err) {
    console.error("[screening] delete failed (ignored):", err);
  }
}
