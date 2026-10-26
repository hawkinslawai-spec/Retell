/**
 * Outbound SMS alerts via Twilio.
 *
 * Sent from the same Twilio number the agent calls from, so the notification
 * lands in the same thread the client already recognises.
 */
const API = "https://api.twilio.com/2010-04-01";

function creds(): { sid: string; token: string } | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return { sid, token };
}

export function isSmsConfigured(): boolean {
  return Boolean(creds() && process.env.TWILIO_SMS_FROM);
}

/**
 * Never throws. An alert failing must not break a live call or a booking —
 * the appointment matters more than the notification about it.
 */
export async function sendSms(to: string, body: string, from?: string): Promise<boolean> {
  const c = creds();
  const sender = from || process.env.TWILIO_SMS_FROM || "";

  if (!c || !sender || !to) {
    console.error("[sms] not configured — skipping alert");
    return false;
  }

  try {
    const res = await fetch(`${API}/Accounts/${c.sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${c.sid}:${c.token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: sender, Body: body.slice(0, 1500) }).toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[sms] Twilio rejected the message:", text.slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error("[sms] send failed:", err);
    return false;
  }
}

/** Trim a summary so the alert stays inside one or two SMS segments. */
function clip(text: string, max = 220): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function hotLeadMessage(input: {
  name: string;
  phone: string;
  interest: string;
  notes: string;
  brand: string;
}): string {
  return [
    `${input.brand}: interested lead`,
    input.name ? `Name: ${input.name}` : "",
    input.phone ? `Phone: ${input.phone}` : "",
    input.interest ? `Wants: ${clip(input.interest, 90)}` : "",
    input.notes ? clip(input.notes) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function bookingMessage(input: {
  name: string;
  phone: string;
  whenLabel: string;
  service: string;
  brand: string;
}): string {
  return [
    `${input.brand}: appointment booked`,
    input.whenLabel,
    input.name ? `Name: ${input.name}` : "",
    input.phone ? `Phone: ${input.phone}` : "",
    input.service ? `For: ${clip(input.service, 90)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
