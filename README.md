# 💰 Telegram Private Expense Tracker

A **multi-user private expense tracker** for Telegram — plus a separate **Admin Bot** for you.

- Each user talks to the **same bot** but sees **only their own data** (isolation is enforced in every SQL query via `user_id`).
- No AI, no income tracking — just fast expense recording in **LKR**.
- **100% free hosting**: Vercel (serverless webhooks) + Neon (PostgreSQL) + cron-job.org (scheduling).

---

## ✨ Features

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

Every user is stored by their **Telegram ID** (never username), with `pending → active → blocked` statuses. When a new person starts the bot, the admin bot receives a **🔔 NEW USER** notification with **Approve / Block** buttons.

---

## 🧱 Architecture

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

Why this combo?

- **Vercel free tier**: perfect for Telegram webhooks (stateless, event-driven).
- **Vercel cron is limited to 1×/day on the free plan** → we use **cron-job.org** (free, any interval) to hit `/api/cron`, which computes each user's **local time** and fires reminders/reports at the right moment for every timezone.
- **Neon**: serverless Postgres with a generous free tier; the HTTP driver is ideal for serverless functions.

---

## 🚀 Deploy (step by step)

### 1. Create the two bots

1. Open **@BotFather** in Telegram.
2. Create the user bot → e.g. `ExpenseTrackerBot` → copy its token.
3. Create the admin bot → e.g. `ExpenseAdminBot` → copy its token.
4. Get **your numeric Telegram ID** from **@userinfobot**.

### 2. Create the database (Neon)

1. Sign up at [neon.tech](https://neon.tech) (free) and create a project.
2. Open **SQL Editor** and paste the contents of [`db/schema.sql`](db/schema.sql), then run it.
3. Copy the **connection string for the serverless driver** from **Connection Details**.

### 3. Local development (optional)

```bash
npm install
cp .env.example .env        # fill in the values
npm run dev                 # long-polling both bots locally
```

### 4. Deploy to Vercel

1. Push this repo to GitHub, then import it at [vercel.com/new](https://vercel.com/new).
2. Add these **Environment Variables** (Settings → Environment Variables):

| Variable | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | token of the user bot |
| `TELEGRAM_ADMIN_BOT_TOKEN` | token of the admin bot |
| `ADMIN_IDS` | your numeric Telegram ID(s), comma-separated |
| `DATABASE_URL` | Neon serverless connection string |
| `CURRENCY` | `LKR` (default) |
| `DEFAULT_TIMEZONE` | `Asia/Colombo` (default) |
| `AUTO_APPROVE` | `false` (default) — `true` skips the approval step |
| `CRON_SECRET` | any long random string (used by cron-job.org) |

3. Deploy. Note your URL, e.g. `https://expense-tracker.vercel.app`.

### 5. Point Telegram at your webhooks

```bash
npm run webhook:set -- https://expense-tracker.vercel.app
```

This registers:
- `https://…/api/webhook` → user bot
- `https://…/api/admin-webhook` → admin bot

### 6. Schedule the reminders with cron-job.org

1. Sign up at [cron-job.org](https://cron-job.org) (free).
2. **Create cronjob** → request type `POST`, URL:
   `https://expense-tracker.vercel.app/api/cron?secret=YOUR_CRON_SECRET`
3. Set it to run **every 15 minutes**.
4. Save — done. 🎉

The scheduler only acts at the start of each user's local hour, so 15-minute precision is plenty. Sunday weekly reports and month-end reports also fire automatically at 8 PM local time.

> 📌 cron-job.org auto-disables a job after 25 consecutive failures — if reminders stop, check the job's "Last run" status.

---

## 🤖 Bot usage

**User bot**
```
/start       welcome + approval handling
/add         record an expense
/today       today's summary
/expenses    view / edit / delete
/report      daily · weekly · monthly
/timezone    set your timezone
/reminders   toggle 4 PM / 8 PM reminders
/help        help
/cancel      cancel current action
/skip        skip description
```

**Admin bot** (only your `ADMIN_IDS` can use it)
```
/start   🔐 Admin panel: Users · Pending · Blocked · Statistics
```
- Approve/Block right from the **🔔 NEW USER** notification
- Tap any user for details (joined, expense count, last activity)
- Block with a confirmation step, unblock anytime

---

## 🔐 Security notes

- **Data isolation at the database level**: every query filters `WHERE user_id = ?` — a user's report or expense list can never include another user's rows.
- Users are identified by `telegram_id`, never by username.
- Amounts are validated (`> 0`, max 2 decimals, max 1B) in both the app and the DB (`CHECK (amount > 0)`).
- Bot tokens & DB credentials live only in Vercel environment variables.
- `/api/cron` is protected by a secret.
- Expense details are never logged.

---

## 📁 Project structure

```
api/
  webhook.ts          user-bot webhook endpoint
  admin-webhook.ts    admin-bot webhook endpoint
  cron.ts             scheduled-jobs endpoint (cron-job.org)
db/
  schema.sql          PostgreSQL schema (run in Neon SQL editor)
scripts/
  set-webhook.mjs     registers both webhooks with Telegram
src/
  config.ts           environment variables
  format.ts           money / timezone / date helpers
  db.ts               all SQL (user-scoped)
  messages.ts         message templates & keyboards
  userBot.ts          user bot handlers
  adminBot.ts         admin bot handlers
  scheduler.ts        reminders + auto reports
  bots.ts             shared bot instances
  dev.ts              local long-polling runner
```

---

## 🧪 Testing multi-user isolation

With three test accounts (A, B, C):

1. `/add` an expense as A → B and C must **not** see it in `/today`, `/expenses` or `/report`.
2. Check the admin bot: all three appear, with per-user expense counts.
3. Block B → B gets "Access Denied"; A and C are unaffected.
