/**
 * Hawkins Law — firm configuration.
 *
 * Sections 2, 5 and 10 of the Amy specification, held as data rather than
 * written into the agent's prompt. Three reasons that matters:
 *
 *  - The client account details must come back from a tool, never from the
 *    model's memory (Section 10). A model that has seen a sort code in its
 *    prompt can paraphrase or misremember it; one that has to call a tool
 *    cannot.
 *  - Direct lines are routing data. The agent is told a person's *name*, and
 *    the number is attached to the tool in code, so there is no way for the
 *    model to read a direct line out to a caller even if asked.
 *  - Staff and routing change. Editing this file is a deploy, not a prompt
 *    rewrite that risks disturbing the guardrails.
 */

export type StaffId =
  | "mohshin"
  | "aqilah"
  | "aqeel"
  | "rafka"
  | "muhammed"
  | "subrata"
  | "bilkis";

export type Staff = {
  id: StaffId;
  firstName: string;
  fullName: string;
  /** E.164, used for the transfer leg. Never spoken to a caller. */
  directLine: string;
  email: string;
  /**
   * Spellings and mishearings that should resolve to this person. Used to
   * build the agent's name-matching guidance; the agent still confirms the
   * full name aloud before transferring (Section 5).
   */
  variants: string[];
};

export const STAFF: Staff[] = [
  {
    id: "mohshin",
    firstName: "Mohshin",
    fullName: "Mohshin Patel",
    directLine: "+442035041612",
    email: "mpatel@hawkinslaw.co.uk",
    variants: ["mohsin", "mohsheen", "muhammad", "mohammed", "mohamed", "moshin", "mr patel"],
  },
  {
    id: "aqilah",
    firstName: "Aqilah",
    fullName: "Aqilah Patel",
    directLine: "+442035041617",
    email: "apatel@hawkinslaw.co.uk",
    variants: ["aqeelah", "akila", "aqila", "akeela", "mrs patel", "ms patel"],
  },
  {
    id: "aqeel",
    firstName: "Aqeel",
    fullName: "Aqeel Ramzan",
    directLine: "+442035041623",
    email: "aramzan@hawkinslaw.co.uk",
    variants: ["akeel", "aqil", "aqeel ramzan", "ramzan"],
  },
  {
    id: "rafka",
    firstName: "Rafka",
    fullName: "Rafka Nawaz",
    directLine: "+442035041626",
    email: "rnawaz@hawkinslaw.co.uk",
    variants: ["rafqa", "rafka nawaz", "nawaz"],
  },
  {
    id: "muhammed",
    firstName: "Muhammed",
    fullName: "Muhammed Gheewala",
    directLine: "+442035041625",
    email: "mgheewala@hawkinslaw.co.uk",
    variants: ["gheewala", "muhammed gheewala"],
  },
  {
    id: "subrata",
    firstName: "Subrata",
    fullName: "Subrata Sarker",
    directLine: "+442035041615",
    email: "ssarker@hawkinslaw.co.uk",
    variants: ["sarker", "subrata sarker"],
  },
  {
    id: "bilkis",
    firstName: "Bilkis",
    fullName: "Bilkis Mahmood",
    // A mobile, unlike the others' 020 3504 direct lines. The transfer works
    // the same, but a mobile can divert to its own voicemail before our ring
    // timeout — see the note in agent.ts about never leaving a voicemail.
    directLine: "+447815935588",
    email: "bmahmood@hawkinslaw.co.uk",
    variants: ["bilquis", "bilqis", "bilkees", "belkis", "mahmood", "mahmoud", "mehmood"],
  },
];

export function staffById(id: string): Staff | undefined {
  return STAFF.find((s) => s.id === id.toLowerCase().trim());
}

/**
 * Resolve whatever the agent passed — an id, a first name, a full name or a
 * known mishearing — to one member of staff.
 *
 * Returns undefined rather than guessing when nothing matches. The caller is
 * then routed as "asked for someone not on the list", which is what the
 * routing table says to do.
 */
export function resolveStaff(input: string): Staff | undefined {
  const needle = (input || "").toLowerCase().trim();
  if (!needle) return undefined;

  const exact = STAFF.find(
    (s) =>
      s.id === needle ||
      s.firstName.toLowerCase() === needle ||
      s.fullName.toLowerCase() === needle
  );
  if (exact) return exact;

  // "Mr Patel" and "Mrs Patel" are listed as variants of a specific person,
  // but the spec is explicit that a bare "Patel" must never be guessed — the
  // agent has to ask which one. Returning undefined here keeps that true even
  // if the model skips the question.
  if (needle === "patel" || needle === "mr. patel") return undefined;

  return STAFF.find((s) => s.variants.includes(needle));
}

/** How a call is categorised, which decides the transfer order and recipients. */
export type Route =
  | "named_handler"
  | "new_enquiry"
  | "unknown_handler"
  | "third_party"
  | "complaint"
  | "sales";

export const GENERAL_EMAIL = "info@hawkinslaw.co.uk";
export const SENDING_MAILBOX = "reception@hawkinslaw.co.uk";

/** Caller ID presented on the staff leg so staff recognise a transfer. */
export const MAIN_NUMBER = "+442071777579";

/**
 * Who to ring, in order, and who to email if nobody accepts (Section 5).
 *
 * `handler` is the person the caller named, where there is one — it only
 * applies to the named_handler route.
 */
export function routeFor(
  route: Route,
  handler?: Staff
): { order: Staff[]; to: string[]; cc: string[] } {
  const mohshin = staffById("mohshin")!;
  const aqilah = staffById("aqilah")!;
  const aqeel = staffById("aqeel")!;

  switch (route) {
    case "named_handler":
      // Message only if they don't pick up — the spec is explicit that we do
      // not shop the caller around to a colleague they didn't ask for.
      return handler
        ? { order: [handler], to: [handler.email], cc: [] }
        : { order: [aqeel, mohshin], to: [aqeel.email, mohshin.email], cc: [GENERAL_EMAIL] };

    case "new_enquiry":
      return {
        order: [mohshin, aqilah],
        to: [mohshin.email, aqilah.email],
        cc: [GENERAL_EMAIL],
      };

    case "unknown_handler":
    case "third_party":
      return {
        order: [aqeel, mohshin],
        to: [aqeel.email, mohshin.email],
        cc: [GENERAL_EMAIL],
      };

    case "complaint":
      return { order: [mohshin], to: [mohshin.email], cc: [GENERAL_EMAIL] };

    case "sales":
      // No transfer and nothing sent. The agent asks them to email info@.
      return { order: [], to: [], cc: [] };
  }
}

// ---------------------------------------------------------------------------
//  Firm facts (Section 2). These are the ONLY facts about the firm the agent
//  may state. Anything else is answered with an offer of a call back.
// ---------------------------------------------------------------------------

export const FIRM = {
  name: "Hawkins Law",
  address: "448 Romford Road, London, E7 8DF",
  hoursSpoken: "Monday to Friday, 9:30am to 5:30pm",
  websiteSpoken: "hawkinslaw dot co dot uk",
  emailSpoken: "info at hawkinslaw dot co dot uk",
  sraNumber: "641732",
  practiceAreasSpoken:
    "property and conveyancing, personal injury, immigration, family law, debt recovery, litigation, and wills, trusts and probate",
  descriptionSpoken:
    "Hawkins Law is an SRA regulated solicitors firm located in London. Our experienced team handles property, personal injury, immigration, family, debt recovery, litigation, and wills and probate, and we offer fixed-price services for many matters.",
};

// ---------------------------------------------------------------------------
//  Client account details (Section 10).
//
//  Returned verbatim by the get_client_account_details tool and never placed
//  in the prompt. Every read-out ends with the reference line, the name-check
//  line and the fraud warning — they are part of the script, not optional
//  additions the model can drop for brevity.
// ---------------------------------------------------------------------------

export const CLIENT_ACCOUNT_SCRIPT =
  "Of course. Our client account details are: account name, Hawkins Law Limited. " +
  "Sort code, two-oh, five-five, four-one. " +
  "Account number, one-three-eight-nine, three-eight-seven-one. " +
  "Please use your matter reference as the payment reference. " +
  "When you set up the payment, your bank should confirm the name Hawkins Law Limited; " +
  "if it doesn't, please stop and speak to your solicitor. " +
  "Hawkins Law will never change its bank details by email, text or phone, so if anything " +
  "you have is different, or you've had a message saying our details have changed, " +
  "please don't send any money.";

export const FRAUD_WARNING =
  "Thank you for checking. Hawkins Law will never change its bank details by email, " +
  "text or phone. Please don't send any money until you've confirmed the details " +
  "directly with your solicitor. Let me try to put you through to them now.";
