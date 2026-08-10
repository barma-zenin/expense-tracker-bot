# 📘 Full Walkthrough — Telegram Private Expense Tracker

> A complete, step-by-step guide: what this project is, how it works, how to run it locally, how to deploy it to production, and how to keep it running — all in one place.

---

## 1. What you're building

A **multi-user private expense tracker** for Telegram, plus a separate **Admin Bot** for the owner.

- Each friend uses the **same user bot**, but sees **only their own data** — isolation is enforced in **every SQL query** via `user_id`, never by hiding rows after the fact.
- **No AI, no income tracking** — just fast expense recording in **LKR**.
- **100% free hosting**: Vercel (serverless webhooks) + Neon (PostgreSQL) + cron-job.org (scheduling).

| Feature | Details |
|---|---|
| `/add` | Amount → category → description, saved with date |
| `/today` | Today's expenses grouped by category + total |
| `/expenses` | Recent expenses with ✏️ Edit and 🗑 Delete |
| `/report` | 📅 Daily · 📆 Weekly · 🗓️ Monthly reports |
| Reminders | ⏰ 4:00 PM + 8:00 PM daily (8 PM shows today's total) |
| Auto reports | 📆 Weekly every Sunday 8 PM · 🗓️ Monthly on the last day at 8 PM |
| Timezones | Per-user IANA timezone (`/timezone`); reminders follow it |
| Admin bot | Approve / block / unblock users, view details & statistics |

Every user is stored by their **Telegram ID** (never username), with a `pending → active → blocked` status lifecycle. When a new person starts the bot, the admin bot receives a **🔔 NEW USER** notification with **Approve / Block** buttons.

---

## 2. Architecture

```
                     ┌────────────────────────────┐
   User  ──/add──▶   │   Vercel (serverless)      │
   User  ─/report─▶  │  /api/webhook  (user bot)  │
                     │  /api/admin-webhook        │  ──▶  Neon
   Admin ─/start─▶   │  /api/cron     (scheduler) │       PostgreSQL
                     └──────────────┬─────────────┘
                                    │ triggers every 15 min
                             cron-job.org (free)
```

### Why this combination?

- **Vercel free tier** — perfect for Telegram webhooks: stateless, event-driven serverless functions.
- **cron-job.org** — Vercel's own cron is limited to 1×/day on the free plan, so we use cron-job.org (free, any interval) to hit `/api/cron` every 15 minutes. The scheduler computes **each user's local time** and fires reminders/reports at the right moment for every timezone.
- **Neon** — serverless Postgres; its HTTP driver fits serverless functions perfectly (no connection pooling to manage).

---

## 3. Tech stack

| Layer | Technology |
|---|---|
| Language | TypeScript (ESM, Node ≥ 20) |
| Telegram framework | [grammY](https://grammy.dev) v1.30 |
| Database | PostgreSQL via [@neondatabase/serverless](https://www.npmjs.com/package/@neondatabase/serverless) (HTTP driver) |
| Hosting | Vercel serverless functions |
| Local runner | `tsx` (long-polling) |
| Scheduler | cron-job.org |

---

## 4. Project structure

```
api/
  webhook.ts          user-bot webhook endpoint (Telegram → Vercel)
  admin-webhook.ts    admin-bot webhook endpoint
  cron.ts             scheduled-jobs endpoint (hit by cron-job.org)
db/
  schema.sql          PostgreSQL schema (paste into Neon SQL Editor)
scripts/
  set-webhook.mjs     registers both bots' webhooks with Telegram
src/
  config.ts           reads environment variables (throws if required ones are missing)
  format.ts           money / timezone / date / amount-validation helpers
  db.ts               ALL SQL — every query is scoped by user_id
  messages.ts         message templates & inline keyboards
  userBot.ts          user bot handlers (commands, state machine, callbacks)
  adminBot.ts         admin bot handlers (panel, approve/block/unblock, stats)
  scheduler.ts        reminders + automatic weekly/monthly reports
  bots.ts             shared bot instances (registers both bots' handlers)
  dev.ts              local long-polling runner (starts BOTH bots)
vercel.json           function settings (60 s max duration)
walkthrough.md        this document
```

---

## 5. Prerequisites

1. **Node.js ≥ 20** installed locally (project was built and tested on Node 24).
2. A **Neon** account (free) — [neon.tech](https://neon.tech).
3. A **GitHub** account to host the repo.
4. A **Vercel** account (free) — [vercel.com](https://vercel.com).
5. A **cron-job.org** account (free) — [cron-job.org](https://cron-job.org).
6. Telegram — for testing.

---

## 6. Part 1 — Local development

> 🧪 **Local = long-polling.** `npm run dev` runs both bots with grammY's built-in long polling — it pulls updates directly from Telegram. **No webhook, no Vercel, no cron needed.**

### 6.1 Get your credentials

| # | What | Where |
|---|------|-------|
| 1 | **User bot token** | Create bot #1 with [@BotFather](https://t.me/BotFather) |
| 2 | **Admin bot token** | Create a *second* bot with @BotFather |
| 3 | **Your numeric Telegram ID** | Message [@userinfobot](https://t.me/userinfobot) |

### 6.2 Create the database (Neon)

1. Sign up at [neon.tech](https://neon.tech) → create a project (any region).
2. Open the **SQL Editor** → paste the whole of [`db/schema.sql`](db/schema.sql) → **Run**.
3. Copy the **serverless driver** connection string (Connection Details).

### 6.3 Create `.env`

```bash
cp .env.example .env
```

Fill in the required values (see [Appendix A](#appendix-a--environment-variables) for the full list). Minimum for local dev:

```
TELEGRAM_BOT_TOKEN=123456789:AA...
TELEGRAM_ADMIN_BOT_TOKEN=123456789:BB...
ADMIN_IDS=123456789
DATABASE_URL=postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require
```

### 6.4 Install & run

```bash
npm install
npm run dev
```

Expected output:

```
Starting user bot (long polling)...
Starting admin bot (long polling)...
```

> ⚠️ **Both bots must start.** The old `dev.ts` used to `await userBot.start()`, which never resolves — so the admin bot never started. It now starts both in parallel. If one token is wrong, the process exits with code 1.

### 6.5 What works locally vs. only after deploy

| Feature | Locally? | Notes |
|---|---|---|
| All commands (`/add`, `/today`, `/expenses`, `/report`, `/timezone`, `/reminders`) | ✅ Yes | Full interaction, database-backed |
| Admin bot (approve/block/stats) | ✅ Yes | Long-polling, same as production |
| ⏰ 4 PM / 8 PM reminders | ❌ No | Only fired by `/api/cron` after deploy |
| 📆 Sunday weekly / 📅 month-end reports | ❌ No | Only fired by `/api/cron` after deploy |
| 🗑 Monthly auto-prune (3-month retention) | ❌ No | Only fired by `/api/cron` after deploy |

### 6.6 Local test checklist

1. **User bot** → `/start` → you're registered as **⏳ Pending**.
2. **Admin bot** → `/start` → tap **🔔 NEW USER** → **✅ Approve** (or from 👥 Users).
3. Back in the **user bot** → `/start` → welcome message.
4. `/add` → amount → category buttons → description → **✅ Expense Added** confirmation.
5. `/today` → today's grouped summary. `/expenses` → ✏️ edit / 🗑 delete. `/report` → Daily / Weekly / Monthly.
6. `/timezone` → `Asia/Colombo`. `/reminders` → toggle 4 PM / 8 PM.

> 💡 For faster testing set `AUTO_APPROVE=true` in `.env` to skip approval entirely.

> 🐛 **Known bug already fixed:** the Neon driver returns `DATE` columns as **JavaScript `Date` objects**, not strings. The app casts every date to `::text` in SQL so formatting never crashes (this used to silently swallow the "✅ Expense Added" reply and admin user-details).

---

## 7. Part 2 — Production deployment

### 7.1 Push the code to GitHub

```bash
git init -b main
git add -A
git commit -m "Initial commit"
git remote add origin https://github.com/<your-username>/<repo>.git
git push -u origin main
```

> ⚠️ Make sure `.env` is in `.gitignore` (it is) — **never commit real secrets**. `.env.example` holds only placeholders.

### 7.2 Import to Vercel

1. [vercel.com/new](https://vercel.com/new) → **Add New Project** → connect GitHub → import the repo.
2. Leave settings at defaults (the framework is auto-detected; there is **no build step** — `tsc --noEmit` is only used as a typecheck script).
3. Add **Environment Variables** (Settings → Environment Variables — make sure **Production** is selected for each):

| Variable | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | token of the user bot |
| `TELEGRAM_ADMIN_BOT_TOKEN` | token of the admin bot |
| `ADMIN_IDS` | your numeric Telegram ID(s), comma-separated |
| `DATABASE_URL` | Neon serverless connection string |
| `CURRENCY` | `LKR` (optional, default) |
| `DEFAULT_TIMEZONE` | `Asia/Colombo` (optional, default) |
| `AUTO_APPROVE` | `false` (optional, default) |
| `CRON_SECRET` | **any long random string** — keep it secret, cron-job.org uses it |

4. **Deploy.** Note your URL, e.g. `https://expense-tracker-bot-five.vercel.app`.

> 💡 Environment variables only apply on the **next deployment** — after saving them, hit **Redeploy** on the latest deployment.

### 7.3 Verify the deployment

```bash
curl https://<your-app>.vercel.app/api/webhook
```

Expected: `{"ok":true}` — and the same for `/api/admin-webhook`. If you see `FUNCTION_INVOCATION_FAILED`, the function is crashing at startup — almost always a missing/typo'd environment variable (see [Troubleshooting](#10-troubleshooting)).

### 7.4 Point Telegram at your webhooks

```bash
npm run webhook:set -- https://<your-app>.vercel.app
```

This registers:
- `https://…/api/webhook` → user bot
- `https://…/api/admin-webhook` → admin bot

### 7.5 Schedule the reminders with cron-job.org

1. Sign up at [cron-job.org](https://cron-job.org) (free).
2. **Create cronjob**:
   - **Title**: `ExpenseBot scheduler`
   - **Request method**: `POST` (GET also works — the secret is in the URL)
   - **URL**: `https://<your-app>.vercel.app/api/cron?secret=YOUR_CRON_SECRET`
   - **Execution**: every **15 minutes**
3. Hit **Test Run** — a healthy response looks like:
   ```json
   {"ok":true,"processed":3,"sent":0}
   ```
4. **Save.** Done. 🎉

The scheduler only acts during the first 10 minutes of each user's local hour, so 15-minute precision is plenty. Sunday weekly reports and month-end reports fire automatically at 8 PM local time.

> 📌 cron-job.org **auto-disables a job after 25 consecutive failures** — if reminders ever stop, check the job's "Last run" status first.

### 7.6 Production verification checklist

- [ ] `GET /api/webhook` → `{"ok":true}`
- [ ] `GET /api/admin-webhook` → `{"ok":true}`
- [ ] `GET /api/cron?secret=<wrong>` → `{"ok":false,"error":"bad secret"}` (HTTP 401)
- [ ] `GET /api/cron?secret=<right>` → `{"ok":true,"processed":N,"sent":0}` (HTTP 200) — also proves the Neon connection
- [ ] First days of a month: the cron response also includes `"pruned":K` (auto-cleanup ran)

---

## 8. Part 3 — Using the bots

### 8.1 User bot commands

```
/start       welcome + approval handling
/add         record an expense (also: /add 450 skips the amount step)
/today       today's summary
/expenses    view / edit / delete (paged, 8 per page)
/report      daily · weekly · monthly (inline buttons)
/timezone    set your IANA timezone, e.g. Asia/Colombo
/reminders   toggle 4 PM / 8 PM reminders
/help        help text
/cancel      cancel the current action
/skip        skip the description while adding/editing
```

**The `/add` flow:** `amount → category buttons → description (or /skip)` → "✅ Expense Added" with amount, category, description and date. Amounts accept `450`, `450.50`, `1,500`, even `LKR 450` (validated: > 0, ≤ 1,000,000,000, max 2 decimals).

**The reminder buttons** (attached to 4 PM / 8 PM messages): `➕ Add Expense` · `📅 View Today` · `✅ Done for Today`.

### 8.2 Admin bot

Only your `ADMIN_IDS` can use it (anyone else gets "🔒 Unauthorized").

```
/start   🔐 ADMIN PANEL: 👥 Users · ⏳ Pending · 🚫 Blocked · 📊 Statistics
/stats   quick statistics
```

- **🔔 NEW USER** notification arrives automatically when someone starts the user bot → **✅ Approve** / **🚫 Block** right from it.
- **👥 Users** → overview counts → tap **Active / Pending / Blocked** to list users → tap a user for **details** (joined date, expense count, last activity).
- **Block** always asks for confirmation (**Yes, Block / Cancel**); **Unblock** is one tap from a blocked user's details.
- Approving/blocking sends the affected user an immediate Telegram message (✅ approved / 🚫 Access Denied / 🔓 re-activated).

### 8.3 The status lifecycle

```
/start  →  ⏳ pending  →  admin approves  →  🟢 active  →  admin blocks  →  🔴 blocked
                     └── if AUTO_APPROVE=true, new users skip straight to 🟢
```

Blocked users get **🚫 Access Denied** on every attempt; pending users get **⏳ awaiting approval**.

---

## 9. Part 4 — Data, isolation & retention

### 9.1 Database tables

| Table | Purpose |
|---|---|
| `users` | one row per Telegram account (id, telegram_id, username, status, timezone, reminder toggles, last-sent tracking, activity) |
| `categories` | fixed set: 🍔 Food, 🚌 Transport, 🛒 Shopping, 🏠 Housing, 📱 Bills, 🎮 Entertainment, 💊 Health, 📚 Education, 📦 Other |
| `expenses` | every expense: user_id, amount, category_id, description, expense_date, created_at |
| `user_states` | conversation state for the multi-step `/add` & edit flows (serverless functions are stateless) |

### 9.2 Privacy / isolation rules (enforced in code)

- **Every query is user-scoped**: `SELECT … WHERE user_id = ?` — never "fetch everything and hide".
- Users are identified by **`telegram_id`**, never by username.
- Amounts are validated in the app **and** in SQL (`CHECK (amount > 0)`, `NUMERIC(12,2)`).
- Bot tokens & DB credentials live **only** in environment variables.
- `/api/cron` is protected by a secret.
- Expense details are never logged.

### 9.3 Retention policy — the auto-prune 🌿

Since Neon's free tier caps storage, the bot self-cleans:

- **Window:** expenses **older than 3 months** are permanently deleted.
- **When:** on the **1st–3rd of every month** (UTC), automatically, via the existing cron endpoint.
- **Safe:** the DELETE is idempotent (re-runs find nothing), runs in its own try/catch, and **never blocks reminders or reports**.
- **Untouched:** user accounts, approval status, categories, and all expenses newer than 3 months.

Everything a user can view (daily/weekly/monthly reports, `/today`, `/expenses`) fits inside the window, so nothing they can see ever disappears — but **an expense older than 3 months is unrecoverable**.

### 9.4 Why storage is a non-issue (the math)

- One expense row ≈ **~200 bytes** (with indexes).
- Realistic usage: 3 users × ~10 expenses/day ≈ 30/day ≈ **2.5 MB/year**.
- Neon free tier: **0.5 GB** storage, **100 CU-hours/month**, 6-hour/1 GB point-in-time history.
- At that pace the free limit would take **~200 years** to fill — the prune is a cheap safety net, not a necessity.

**Monitoring:** the Neon dashboard shows Storage / History / Compute. Check it occasionally; if `Storage` ever approached ~90%, the prune (or a manual delete in the SQL editor) fixes it.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Vercel build fails: `No Output Directory named "public"` | A `build` script makes Vercel expect a static site | Already fixed: the project has **no** `build` script (typechecking is `npm run typecheck`) — a current clone deploys cleanly |
| `FUNCTION_INVOCATION_FAILED` on every endpoint | Function crashes at startup — a required env var missing/typo'd, or only set for Preview/Development | Check Settings → Environment Variables: exact names, Production selected, then **Redeploy** |
| `ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/src/bots'` | ESM requires explicit file extensions; Vercel doesn't rewrite them | All relative imports use `.js` extensions (already fixed) — don't remove them |
| Expense saves but **no "✅ Expense Added" reply** | Neon returns `DATE` columns as JS `Date` objects; `formatDate()` crashed on `.split()` | Already fixed: every date is cast `::text` in SQL (see `src/db.ts`) |
| Admin bot user details crash | Same date-object issue on `created_at` / `last_activity` | Already fixed via `::text` casts in `findByTelegramId` |
| Reminders/reports never arrive | Cron not running, wrong secret, or job disabled | Check cron-job.org "Last run" (auto-disabled after 25 failures); confirm `CRON_SECRET` matches Vercel exactly; verify `GET /api/cron?secret=…` returns 200 |
| `/add` replies "👋 Welcome! Send /start" | User pressed the bot's buttons without ever pressing **Start**, is pending, or blocked | Have the user press Start on the bot; approve them from the admin bot |
| Admin bot says nothing | Wrong token in `.env`/Vercel (points at the user bot), or your ID not in `ADMIN_IDS` | Verify `TELEGRAM_ADMIN_BOT_TOKEN` is from the **second** BotFather bot; confirm your numeric ID is in `ADMIN_IDS` |
| `npm run dev` only starts one bot | Old `dev.ts` awaited `bot.start()` (never resolves) | Both bots start in parallel now; a bad token sets exit code 1 |
| Webhook returns `{"ok":true}` on GET but bot doesn't respond | Webhook not registered, or registered against a different URL | Re-run `npm run webhook:set -- https://<your-app>.vercel.app` |
| `{"ok":false,"error":"bad secret"}` from `/api/cron` | `CRON_SECRET` mismatch between Vercel and your cron job | Copy the exact value into cron-job.org URL |
| Storage meter not shrinking after deletes | Postgres reuses dead-tuple space; it doesn't return to the OS | Normal — at this scale it's irrelevant; `VACUUM FULL` exists but is unnecessary |

---

## 11. Useful commands (reference)

```bash
npm install            # install dependencies
npm run dev            # run both bots locally (long-polling)
npm run typecheck      # TypeScript check (no output = all good)
npm run webhook:set -- https://<your-app>.vercel.app   # register webhooks after deploy
```

---

## Appendix A — Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | — | User bot token (from @BotFather) |
| `TELEGRAM_ADMIN_BOT_TOKEN` | ✅ | — | Admin bot token (from @BotFather) |
| `ADMIN_IDS` | ⚠️ | `[]` | Comma-separated numeric Telegram IDs allowed to use the admin bot (leave unset if you never use it) |
| `DATABASE_URL` | ✅ | — | Neon **serverless** connection string |
| `CURRENCY` | — | `LKR` | Currency code shown in messages |
| `DEFAULT_TIMEZONE` | — | `Asia/Colombo` | IANA timezone for new users |
| `AUTO_APPROVE` | — | `false` | `true` = new users skip the admin approval step |
| `CRON_SECRET` | — | `change-me` | Protects `/api/cron`; **must** match cron-job.org |

---

## Appendix B — API endpoints

| Endpoint | Purpose | Auth |
|---|---|---|
| `POST /api/webhook` | Telegram → user bot updates | Telegram secret (webhook URL) |
| `GET /api/webhook` | Health check | — |
| `POST /api/admin-webhook` | Telegram → admin bot updates | Telegram secret (webhook URL) |
| `GET /api/admin-webhook` | Health check | — |
| `POST/GET /api/cron?secret=…` | Scheduled jobs (reminders, reports, prune) | `CRON_SECRET` in query or `x-cron-secret` header |

---

*Walkthrough covers every part of the project — local dev, deployment, operations, and troubleshooting. If a section is unclear, the source files are small and well-commented; `src/db.ts`, `src/userBot.ts` and `src/adminBot.ts` are the best starting points.*
