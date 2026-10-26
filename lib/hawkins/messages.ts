import { DateTime } from "luxon";
import nodemailer, { Transporter } from "nodemailer";
import { getSupabase, isSupabaseConfigured } from "../supabase";
import { GENERAL_EMAIL, SENDING_MAILBOX } from "./firm";

/**
 * Call messages and their emails (Section 8).
 *
 * The governing rule is the last line of that section: a message must never
 * be lost silently. So every message is written to the database first and
 * emailed second. If the email fails we retry, then alert info@, and the row
 * stays in the database marked unsent either way — a message that exists in
 * the console but not in an inbox is recoverable; one that exists nowhere is
 * a client who rang a law firm and was never called back.
 */

export type CallMessage = {
  callerName: string;
  phone: string;
  email: string;
  callerType: "existing client" | "new enquiry" | "third party" | "complaint";
  organisation: string;
  matterLabel: string;
  fileHandler: string;
  whyNoTransfer: "declined" | "no answer" | "busy" | "office closed" | "not attempted";
  callback: string;
  message: string;
  urgent: boolean;
  to: string[];
  cc: string[];
  callId: string;
  recordingUrl: string;
};

function transport(): Transporter {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!user || !pass) throw new Error("SMTP_USER / SMTP_PASSWORD not set");

  const port = Number(process.env.SMTP_PORT) || 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user, pass: pass.replace(/\s+/g, "") },
  });
}

function stamp(): { date: string; time: string; iso: string } {
  const now = DateTime.now().setZone("Europe/London");
  return {
    date: now.toFormat("ccc d LLL yyyy"),
    time: now.toFormat("HH:mm"),
    iso: now.toISO() || new Date().toISOString(),
  };
}

/** The fixed plain-text body from Section 8. Staff read these in seconds. */
function body(m: CallMessage, date: string, time: string): string {
  const pad = (label: string) => `${label}:`.padEnd(18, " ");

  return [
    "CALL MESSAGE (taken by Amy)",
    "",
    `${pad("Date/time")}${date} ${time}`,
    `${pad("Caller")}${m.callerName}`,
    `${pad("Phone")}${m.phone}`,
    `${pad("Email")}${m.email || "not given"}`,
    `${pad("Caller type")}${m.callerType}`,
    m.organisation ? `${pad("Organisation")}${m.organisation}` : "",
    `${pad("Matter")}${m.matterLabel || "not given"}`,
    `${pad("File handler")}${m.fileHandler || "not known"}`,
    `${pad("Why no transfer")}${m.whyNoTransfer}`,
    `${pad("Callback")}${m.callback || "as soon as possible"}`,
    "",
    "Message:",
    m.message,
    "",
    `Transcript / recording: ${m.recordingUrl || "attached to the call record in the console"}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function subjectFor(m: CallMessage, date: string, time: string): string {
  const prefix = m.urgent ? "[URGENT] " : "";
  // Complaints carry the word in the subject so they are filterable, which
  // Section 10 requires.
  const kind = m.callerType === "complaint" ? "Complaint" : "Call message";
  const re = m.matterLabel || (m.callerType === "new enquiry" ? "New enquiry" : "no matter given");
  return `${prefix}${kind}: ${m.callerName} re ${re} (${date} ${time})`;
}

async function record(
  m: CallMessage,
  subject: string,
  sent: boolean,
  error?: string
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    await getSupabase().from("call_messages").insert({
      call_id: m.callId || null,
      caller_name: m.callerName || null,
      phone: m.phone || null,
      email: m.email || null,
      caller_type: m.callerType,
      organisation: m.organisation || null,
      matter_label: m.matterLabel || null,
      file_handler: m.fileHandler || null,
      why_no_transfer: m.whyNoTransfer,
      callback: m.callback || null,
      message: m.message || null,
      urgent: m.urgent,
      recipients: m.to,
      cc: m.cc,
      subject,
      email_sent: sent,
      email_error: error || null,
    });
  } catch (err) {
    console.error("[messages] could not record the message:", err);
  }
}

/**
 * Send the message and record it.
 *
 * Returns true only when an email actually left. The agent is told it was
 * passed on either way, because from the caller's point of view it has been —
 * the firm now has it in the console and info@ has been alerted.
 */
export async function sendCallMessage(m: CallMessage): Promise<{ sent: boolean; error?: string }> {
  const { date, time } = stamp();
  const subject = subjectFor(m, date, time);
  const text = body(m, date, time);

  const to = m.to.filter(Boolean);
  const cc = m.cc.filter((c) => Boolean(c) && !to.includes(c));

  if (to.length === 0) {
    await record(m, subject, false, "no recipients resolved");
    return { sent: false, error: "no recipients" };
  }

  let lastError = "";

  // Two attempts. A transient SMTP refusal is common enough to be worth one
  // retry, and rare enough that more would just delay the alert.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await transport().sendMail({
        from: `"Hawkins Law reception" <${process.env.SMTP_USER || SENDING_MAILBOX}>`,
        to: to.join(", "),
        cc: cc.length > 0 ? cc.join(", ") : undefined,
        subject,
        text,
      });

      await record(m, subject, true);
      return { sent: true };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[messages] send attempt ${attempt} failed:`, lastError);
    }
  }

  // Both attempts failed. Alert the general mailbox with the whole message in
  // the body, so it is recoverable from an inbox even if nobody opens the
  // console.
  try {
    await transport().sendMail({
      from: `"Hawkins Law reception" <${process.env.SMTP_USER || SENDING_MAILBOX}>`,
      to: GENERAL_EMAIL,
      subject: `[DELIVERY FAILED] ${subject}`,
      text:
        `This message could not be delivered to ${to.join(", ")}.\n` +
        `Error: ${lastError}\n\n` +
        `Please forward it to the right person.\n\n${text}`,
    });
  } catch (err) {
    console.error("[messages] the failure alert also failed:", err);
  }

  await record(m, subject, false, lastError);
  return { sent: false, error: lastError };
}

/**
 * The record email sent after the client account details are read out
 * (Section 10). Not a message — a compliance record.
 */
export async function recordAccountReadout(input: {
  callerName: string;
  phone: string;
  matterLabel: string;
  fileHandler: string;
  handlerEmail: string;
  callId: string;
}): Promise<void> {
  const { date, time, iso } = stamp();
  const to = input.handlerEmail || GENERAL_EMAIL;

  if (isSupabaseConfigured()) {
    try {
      await getSupabase().from("account_readouts").insert({
        call_id: input.callId || null,
        caller_name: input.callerName || null,
        phone: input.phone || null,
        matter_label: input.matterLabel || null,
        file_handler: input.fileHandler || null,
        sent_to: to,
        read_at: iso,
      });
    } catch (err) {
      console.error("[messages] could not record the account read-out:", err);
    }
  }

  try {
    await transport().sendMail({
      from: `"Hawkins Law reception" <${process.env.SMTP_USER || SENDING_MAILBOX}>`,
      to,
      subject: `Client account details read to ${input.callerName || "a caller"} (${date} ${time})`,
      text: [
        "RECORD OF CLIENT ACCOUNT READ-OUT",
        "",
        "Amy read the firm's client account details to this caller.",
        "",
        `Date/time:    ${date} ${time}`,
        `Caller:       ${input.callerName || "not given"}`,
        `Phone:        ${input.phone || "not given"}`,
        `Matter:       ${input.matterLabel || "not given"}`,
        `File handler: ${input.fileHandler || "not known"}`,
        "",
        "The fixed script was read, including the payment reference, the name-check",
        "and the fraud warning. Amy did not confirm any details the caller read out.",
      ].join("\n"),
    });
  } catch (err) {
    console.error("[messages] account read-out record email failed:", err);
  }
}
