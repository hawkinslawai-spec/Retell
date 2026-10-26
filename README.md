# Hawkings Law — AI phone agent console

A Next.js app that gives a Retell AI voice agent the ability to answer the
firm's phone, book appointments, take down enquiries, put callers through to a
real person when they ask, and email a summary of every call.

```
Caller ⇄ Retell agent → this app → appointments, enquiries and
                                   custom records (its own database)
                                 → a person's mobile (screened transfer)
                                 → the firm's inbox (call summaries)
```

Everything a call produces is stored in this app's own database. There is no
spreadsheet to share and no external calendar to connect.

---

## 1. Database

Create a Supabase project, then open **SQL Editor → New query**, paste the whole
of `database-schema.sql`, and run it.

That one file is the entire schema. Ignore the numbered
`supabase-migration-*.sql` files — those upgrade older deployments and partly
contradict each other.

From **Project Settings**: copy the URL from **Data API**, and the
**`service_role`** key from **API Keys**. Not the `anon` key — the app needs to
bypass row level security, which is exactly why that key must never reach a
browser.

## 2. Email

Call summaries go out over Gmail SMTP, which needs an **App Password**:

1. `myaccount.google.com` → Security → turn on **2-Step Verification**
2. Security → **App passwords** → create one
3. Google shows 16 characters like `abcd efgh ijkl mnop`

Use the Gmail address as `SMTP_USER` and those 16 characters as
`SMTP_PASSWORD`. Paste them with the spaces — they're stripped automatically.
The account password will not work and Google's rejection message doesn't
explain why.

## 3. Deploy

Import the repo into Vercel and add every variable from `.env.example`.

**Order matters on the first deploy.** Set `APP_BASE_URL` to the real
deployment URL, redeploy, and only then press **Save** on each agent. The tool
and webhook URLs are baked into the agent when it's saved, so an agent saved
before `APP_BASE_URL` was right keeps calling the wrong host.

### `RETELL_API_KEY` — the one that catches everybody

Retell issues more than one API key and **only one of them signs webhooks** —
it has a webhook badge beside it in the dashboard. Use that one.

With any other key the agent still answers the phone and holds a normal
conversation, but every tool call and webhook returns 401, so nothing is ever
booked, recorded or emailed. Nothing in the console looks wrong; the failures
only appear in Retell's own call log.

## 4. Check it

Set `SETUP_TOKEN`, open `/setup`, and run the checks. They exercise the real
code paths — the availability lookup, a booking write, the records tables, the
SMTP login — and name the exact fix for anything that fails.

**Remove `SETUP_TOKEN` once the firm is live.**

## 5. Outbound calling (optional)

If the firm runs follow-up campaigns, point a cron job at:

```
POST https://<deployment>/api/cron/campaign-tick
Header: x-cron-secret: <CRON_SECRET>
```

Every 1–5 minutes. cron-job.org is fine. Each client needs its own job and its
own `CRON_SECRET`.

---

## The pages

| Page | What it's for |
|---|---|
| Overview | Call volume, bookings, enquiries at a glance |
| Appointments | The diary, grouped by day. Cancelling frees the slot immediately |
| Enquiries | Callers who left details without booking, plus any custom logs |
| Call history | Every call with its summary and recording |
| Contacts | One record per phone number, with call history and status |
| Phone agents | Prompt, voice, model, transfer behaviour, custom logs, summary email |
| Outbound calling | Campaigns, lead import, calling windows, retries |
| Phone numbers | Import a number from Twilio or any SIP carrier |
| Setup checks | Build the environment variables and verify the deployment |

## Screened transfer

When a caller asks for a person, the agent can ring a real number and have a
screening agent ask whether they'll take it — stating who's calling and what
it's about — before connecting anyone. Press **1** to accept, **2** to decline,
or just answer out loud. On a decline the caller is told why and carries on
with the agent.

Turn it on under **Transfer to a human** on any agent. Saving creates a second
agent in Retell called `<Agent name> — screener`; leave that one alone in the
Retell dashboard, the app manages it.

## Local development

```bash
npm install
cp .env.example .env.local   # fill it in
npm run dev
```

Retell calls these endpoints from its own servers, so localhost is unreachable
for tool calls. Use a tunnel and set `APP_BASE_URL` to the tunnel URL if you
need to test tools locally.
