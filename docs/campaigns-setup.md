# Outbound campaigns — setup

Four things to configure: Twilio, Supabase, environment variables, and the cron job.

---

## 1. Twilio → Retell (elastic SIP trunk)

A Twilio number can't just be typed into Retell. It has to be connected through
an elastic SIP trunk, then imported. Retell's guide is at
docs.retellai.com/deploy/twilio — the shape of it:

**In Twilio console → Elastic SIP Trunking → Trunks → Create:**

1. **Termination** (outbound — Retell calling out through Twilio). Set a
   termination SIP URI. Note it down; it ends in `.pstn.twilio.com` and you'll
   need it during the Retell import.
2. **Authentication.** Retell's SIP server has no static IP, so use credential
   auth rather than IP allowlisting. Create a credential list with a username
   and password.
3. **Origination** (inbound — Twilio handing calls to Retell). Add an
   origination URI pointing at Retell's SIP server.
4. **Numbers.** Add your purchased Twilio number to the trunk.

**In Retell → Phone Numbers → Import:**

Enter the number in E.164, the termination URI, the SIP username and password,
and bind it to your agent.

Then place one test outbound call before building a campaign on top of it. A
half-working trunk is a well-known failure mode — calls connect intermittently
rather than failing cleanly, which is much harder to spot once a campaign is
running.

**Before any real volume:** US carriers will mark unregistered outbound traffic
as spam. Twilio requires A2P 10DLC brand and campaign registration, and Retell
has a Branded Caller ID feature on top. Both take review time. Start them early.

---

## 2. Supabase

Create a project, then **SQL Editor → New query**, paste the contents of
`supabase-schema.sql` from the repo root, and Run.

That creates three tables:

- `campaigns` — one row per campaign: from number, timezone, calling window, batch size, retry rules
- `campaign_leads` — one row per number, with attempt count, status and call outcome
- `dnc_list` — suppression list, checked before every batch

RLS is enabled with no policies, so the anon key can read nothing. All access
goes through the service role key from server code.

**Get the credentials:** Project Settings → Data API for `SUPABASE_URL`, and
Project Settings → API Keys for the `service_role` key. Use the service role
key, not the anon key.

---

## 3. Environment variables

Add these in Vercel and redeploy:

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_TOKEN=<long random string>
CRON_SECRET=<different long random string>
```

`ADMIN_TOKEN` unlocks `/campaigns`. Unlike `SETUP_TOKEN`, this one stays
permanently.

---

## 4. The cron job

Vercel Hobby only allows one cron run per day, so use cron-job.org (free):

- **URL:** `https://YOUR-APP.vercel.app/api/cron/campaign-tick?secret=YOUR_CRON_SECRET`
- **Schedule:** every 5 minutes
- **Method:** GET

If you'd rather not put the secret in the URL, send it as an `x-cron-secret`
header or a Bearer token instead — the endpoint accepts any of the three.

Five minutes is frequent enough. Retell handles the actual call pacing and
respects the calling window itself, so the cron only reconciles finished calls
and hands over the next batch.

---

## How a campaign runs

1. Create a campaign in `/campaigns` — from number, timezone, calling window, days, batch size, retry rules.
2. Add leads: pull from the `Leads` sheet tab, or paste `phone, name, email` lines.
3. Press **Start**. That flips status to active and fires one tick immediately, so the first batch goes out without waiting for the cron.

From there, every tick does three things:

- **Reconciles.** Calls `List Calls` filtered by `batch_call_id`, matches each call back to its lead via the `lead_id` metadata, and records the disposition, summary and recording URL.
- **Retries.** Anything that didn't reach a human — busy, no answer, dial failure, voicemail — goes back to pending with `next_attempt_at` set. Terminal outcomes don't.
- **Queues.** Takes the next `batch_size` due leads, drops anyone on the DNC list, and creates a new batch call with the campaign's time window attached.

When nothing is pending or in flight, the campaign marks itself completed.

**Pause** stops new batches being queued. It does not cancel a batch already
handed to Retell — those calls will still go out. To stop calls that are already
queued, cancel the batch in Retell's Batch Call tab.

---

## Dynamic variables in your agent prompt

Every task is sent with these, so you can reference them directly:

| Variable | Value |
|---|---|
| `{{customer_name}}` | Lead's name, or "there" if unknown |
| `{{customer_phone}}` | The number being called |
| `{{customer_email}}` | Email, or empty |
| `{{attempt}}` | Attempt number — useful for "I tried you earlier" on retries |
| `{{interest}}` | Set when imported from the Leads sheet |

---

## Adding someone to the DNC list

No UI for this yet. In Supabase → Table Editor → `dnc_list` → Insert row, with
the phone in E.164 format. It's checked before every batch, and matching leads
in any campaign get marked suppressed rather than called.

---

## Testing checklist

- [ ] One test outbound call through the Twilio trunk before building a campaign
- [ ] Create a campaign with your own number as the only lead, batch size 1
- [ ] Confirm the call arrives and `{{customer_name}}` is spoken correctly
- [ ] Check the lead row in Supabase gets a disposition, summary and recording URL
- [ ] Decline the call and confirm it flips back to pending with a future `next_attempt_at`
- [ ] Add your number to `dnc_list`, re-import, confirm it's suppressed not called
- [ ] Set a calling window that has already passed today and confirm nothing dials
