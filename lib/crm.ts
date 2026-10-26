import { getSupabase, normalisePhone } from "./supabase";

export type Contact = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  company: string | null;
  status: string;
  source: string | null;
  notes: string | null;
  last_call_at: string | null;
  last_summary: string | null;
  call_count: number;
  booked_at: string | null;
  created_at: string;
};

export const STATUSES = ["new", "contacted", "qualified", "booked", "won", "lost", "dnc"];

/**
 * Create or enrich a contact. Called from the voice endpoints, so it must
 * never throw — a CRM write failing should not break a live phone call.
 */
export async function upsertContact(input: {
  phone: string;
  name?: string;
  email?: string;
  source?: string;
  summary?: string;
  booked?: boolean;
  countCall?: boolean;
}): Promise<void> {
  const phone = normalisePhone(input.phone);
  if (!phone) return;

  try {
    const supabase = getSupabase();
    const { data: existing } = await supabase
      .from("contacts")
      .select("id, name, email, call_count, status")
      .eq("phone", phone)
      .maybeSingle();

    const patch: Record<string, unknown> = {
      phone,
      // Never overwrite a known name with a blank one.
      name: input.name || existing?.name || null,
      email: input.email || existing?.email || null,
      source: input.source || undefined,
    };

    if (input.countCall) {
      patch.last_call_at = new Date().toISOString();
      patch.call_count = (existing?.call_count ?? 0) + 1;
    }
    if (input.summary) patch.last_summary = input.summary;
    if (input.booked) {
      patch.booked_at = new Date().toISOString();
      patch.status = "booked";
    } else if (!existing) {
      patch.status = "new";
    } else if (existing.status === "new" && input.countCall) {
      patch.status = "contacted";
    }

    if (existing) {
      await supabase.from("contacts").update(patch).eq("id", existing.id);
    } else {
      await supabase.from("contacts").insert(patch);
    }
  } catch (err) {
    console.error("[crm] upsert failed:", err);
  }
}

export async function listContacts(status?: string, search?: string): Promise<Contact[]> {
  const supabase = getSupabase();
  let query = supabase.from("contacts").select("*").order("created_at", { ascending: false }).limit(500);

  if (status && status !== "all") query = query.eq("status", status);
  if (search) {
    const q = `%${search}%`;
    query = query.or(`name.ilike.${q},phone.ilike.${q},email.ilike.${q},company.ilike.${q}`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as Contact[];
}

export async function updateContact(id: string, patch: Record<string, unknown>): Promise<Contact> {
  const supabase = getSupabase();
  const allowed: Record<string, unknown> = {};
  for (const key of ["name", "email", "company", "status", "notes"]) {
    if (patch[key] !== undefined) allowed[key] = patch[key];
  }

  const { data, error } = await supabase
    .from("contacts")
    .update(allowed)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Contact;
}

export async function deleteContact(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("contacts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
