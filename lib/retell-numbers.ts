import { getRetell, unwrapList } from "./retell-client";

export type RetellNumber = {
  phone_number: string;
  nickname: string;
  type: string;
  inbound_agent_id: string;
  outbound_agent_id: string;
  last_modified: number;
};

export type RetellAgent = {
  agent_id: string;
  agent_name: string;
};

export async function listNumbers(): Promise<RetellNumber[]> {
  const retell = getRetell();
  const res = await retell.phoneNumber.list();
  const rows = unwrapList<unknown>(res);

  return rows.map((row) => {
    const n = row as Record<string, unknown>;
    const inbound = Array.isArray(n.inbound_agents) ? n.inbound_agents : [];
    const outbound = Array.isArray(n.outbound_agents) ? n.outbound_agents : [];

    const firstAgent = (list: unknown[]): string => {
      const first = list[0] as Record<string, unknown> | undefined;
      return typeof first?.agent_id === "string" ? first.agent_id : "";
    };

    return {
      phone_number: String(n.phone_number ?? ""),
      nickname: String(n.nickname ?? ""),
      type: String(n.phone_number_type ?? ""),
      inbound_agent_id: String(n.inbound_agent_id ?? "") || firstAgent(inbound),
      outbound_agent_id: String(n.outbound_agent_id ?? "") || firstAgent(outbound),
      last_modified:
        typeof n.last_modification_timestamp === "number" ? n.last_modification_timestamp : 0,
    };
  });
}

export async function listAgents(): Promise<RetellAgent[]> {
  const retell = getRetell();
  const res = await retell.agent.list({ limit: 100 });
  const rows = unwrapList<unknown>(res);

  const seen = new Set<string>();
  const agents: RetellAgent[] = [];

  for (const row of rows) {
    const a = row as Record<string, unknown>;
    const id = String(a.agent_id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    agents.push({ agent_id: id, agent_name: String(a.agent_name ?? id) });
  }

  return agents;
}

/**
 * The trunk Retell sends outbound calls to. It's also the only reliable way to
 * work out which of several Twilio trunks a number is supposed to be using,
 * which is what the inbound diagnostics need.
 */
export async function terminationUriFor(phoneNumber: string): Promise<string> {
  const retell = getRetell();
  const row = (await retell.phoneNumber.retrieve(phoneNumber)) as unknown as Record<
    string,
    unknown
  >;
  return String(row.termination_uri ?? "");
}

export type ImportInput = {
  phoneNumber: string;
  terminationUri: string;
  sipUsername?: string;
  sipPassword?: string;
  nickname?: string;
  inboundAgentId?: string;
  outboundAgentId?: string;
};

/**
 * Import a number that lives in a Twilio elastic SIP trunk.
 *
 * Nothing here is persisted — the SIP credentials are passed straight through
 * to Retell, which is the only place they're stored.
 */
/**
 * Import, or update in place if Retell already knows the number.
 *
 * Retell rejects a second import of the same number, which is what produces the
 * "already listed" error when you re-run setup after fixing something upstream.
 * Updating is the right move — it refreshes the termination URI and credentials
 * without you having to delete and start over.
 */
export async function importNumber(input: ImportInput) {
  const retell = getRetell();

  let exists = false;
  try {
    await retell.phoneNumber.retrieve(input.phoneNumber);
    exists = true;
  } catch {
    exists = false;
  }

  if (exists) {
    return retell.phoneNumber.update(input.phoneNumber, {
      termination_uri: input.terminationUri,
      auth_username: input.sipUsername || undefined,
      auth_password: input.sipPassword || undefined,
      nickname: input.nickname || undefined,
      inbound_agents: input.inboundAgentId
        ? [{ agent_id: input.inboundAgentId, weight: 1 }]
        : undefined,
      outbound_agents: input.outboundAgentId
        ? [{ agent_id: input.outboundAgentId, weight: 1 }]
        : undefined,
    });
  }

  return retell.phoneNumber.import({
    phone_number: input.phoneNumber,
    termination_uri: input.terminationUri,
    sip_trunk_auth_username: input.sipUsername || undefined,
    sip_trunk_auth_password: input.sipPassword || undefined,
    nickname: input.nickname || undefined,
    // Weights must total 1, and a single bound agent is the normal case.
    inbound_agents: input.inboundAgentId
      ? [{ agent_id: input.inboundAgentId, weight: 1 }]
      : undefined,
    outbound_agents: input.outboundAgentId
      ? [{ agent_id: input.outboundAgentId, weight: 1 }]
      : undefined,
  });
}

export async function deleteNumber(phoneNumber: string): Promise<void> {
  const retell = getRetell();
  await retell.phoneNumber.delete(phoneNumber);
}
