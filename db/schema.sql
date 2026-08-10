-- ============================================================
--  Telegram Private Expense Tracker — PostgreSQL schema
--  Paste this whole file into the Neon SQL Editor and run it.
-- ============================================================

-- Users: one row per Telegram account. Every query in the app
-- is scoped by user_id / telegram_id so data is fully isolated.
CREATE TABLE IF NOT EXISTS users (
  id               BIGSERIAL PRIMARY KEY,
  telegram_id      BIGINT UNIQUE NOT NULL,
  username         TEXT,
  first_name       TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('active', 'pending', 'blocked')),
  timezone         TEXT NOT NULL DEFAULT 'Asia/Colombo',
  reminder_4pm     BOOLEAN NOT NULL DEFAULT TRUE,
  reminder_8pm     BOOLEAN NOT NULL DEFAULT TRUE,
  last_4pm_sent    DATE,
  last_8pm_sent    DATE,
  last_weekly_sent DATE,
  last_monthly_sent DATE,
  last_activity    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fixed categories (can be extended later without affecting data).
CREATE TABLE IF NOT EXISTS categories (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL
);

INSERT INTO categories (name, icon) VALUES
  ('Food',          '🍔'),
  ('Transport',     '🚌'),
  ('Shopping',      '🛒'),
  ('Housing',       '🏠'),
  ('Bills',         '📱'),
  ('Entertainment', '🎮'),
  ('Health',        '💊'),
  ('Education',     '📚'),
  ('Other',         '📦')
ON CONFLICT (name) DO NOTHING;

-- Expenses: always linked to a user. amount > 0 enforced in SQL too.
CREATE TABLE IF NOT EXISTS expenses (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  category_id  INT NOT NULL REFERENCES categories(id),
  description  TEXT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses (user_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_user      ON expenses (user_id);

-- Conversation state for the multi-step /add & edit flows.
-- Needed because serverless functions are stateless.
CREATE TABLE IF NOT EXISTS user_states (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state      TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
