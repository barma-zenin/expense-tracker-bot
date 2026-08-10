import { neon } from '@neondatabase/serverless';
import { config } from './config.js';

export const sql = neon(config.databaseUrl);

// ─── Types ────────────────────────────────────────────────────────────

export interface User {
  id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  status: 'active' | 'pending' | 'blocked';
  timezone: string;
  reminder_4pm: boolean;
  reminder_8pm: boolean;
  last_4pm_sent: string | null;
  last_8pm_sent: string | null;
  last_weekly_sent: string | null;
  last_monthly_sent: string | null;
  last_activity: string | null;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  icon: string;
}

export interface ExpenseRow {
  id: number;
  amount: number;
  description: string | null;
  expense_date: string;
  category_id: number;
  category_name: string;
  icon: string;
  created_at: string;
}

export interface CategoryTotal {
  icon: string;
  name: string;
  total: number;
}

export interface Report {
  total: number;
  count: number;
  byCategory: CategoryTotal[];
}

export interface UserState {
  user_id: number;
  state: string;
  data: Record<string, unknown>;
}

// ─── Users ────────────────────────────────────────────────────────────

export async function findByTelegramId(telegramId: number): Promise<User | null> {
  const rows = await sql`
    SELECT id, telegram_id, username, first_name, status, timezone,
           reminder_4pm, reminder_8pm,
           last_4pm_sent::text    AS last_4pm_sent,
           last_8pm_sent::text    AS last_8pm_sent,
           last_weekly_sent::text AS last_weekly_sent,
           last_monthly_sent::text AS last_monthly_sent,
           last_activity::text    AS last_activity,
           created_at::text       AS created_at
    FROM users WHERE telegram_id = ${telegramId} LIMIT 1`;
  return (rows[0] as User) ?? null;
}

export async function findById(userId: number): Promise<User | null> {
  const rows = await sql`
    SELECT id, telegram_id, username, first_name, status, timezone,
           reminder_4pm, reminder_8pm,
           last_4pm_sent::text    AS last_4pm_sent,
           last_8pm_sent::text    AS last_8pm_sent,
           last_weekly_sent::text AS last_weekly_sent,
           last_monthly_sent::text AS last_monthly_sent,
           last_activity::text    AS last_activity,
           created_at::text       AS created_at
    FROM users WHERE id = ${userId} LIMIT 1`;
  return (rows[0] as User) ?? null;
}

export async function createUser(input: {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  status: string;
}): Promise<{ user: User; isNew: boolean }> {
  // Single atomic statement: safe against concurrent /start from parallel
  // serverless invocations. `xmax = 0` is true only for a fresh insert, so
  // we can tell whether this is a new user (for admin notifications).
  const rows = await sql`
    INSERT INTO users (telegram_id, username, first_name, status, timezone)
    VALUES (${input.telegramId}, ${input.username}, ${input.firstName}, ${input.status}, ${config.defaultTimezone})
    ON CONFLICT (telegram_id)
    DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name
    RETURNING id, telegram_id, username, first_name, status, timezone,
              reminder_4pm, reminder_8pm,
              last_4pm_sent::text    AS last_4pm_sent,
              last_8pm_sent::text    AS last_8pm_sent,
              last_weekly_sent::text AS last_weekly_sent,
              last_monthly_sent::text AS last_monthly_sent,
              last_activity::text    AS last_activity,
              created_at::text       AS created_at,
              (xmax = 0) AS is_new`;
  const row = rows[0] as User & { is_new: boolean };
  return { user: row, isNew: row.is_new };
}

export async function setStatusByTelegramId(telegramId: number, status: string): Promise<void> {
  await sql`UPDATE users SET status = ${status} WHERE telegram_id = ${telegramId}`;
}

export async function setTimezone(userId: number, timezone: string): Promise<void> {
  await sql`UPDATE users SET timezone = ${timezone} WHERE id = ${userId}`;
}

export async function toggleReminder(userId: number, which: '4' | '8'): Promise<boolean> {
  if (which === '4') {
    const rows = await sql`UPDATE users SET reminder_4pm = NOT reminder_4pm WHERE id = ${userId} RETURNING reminder_4pm`;
    return Boolean(rows[0]?.reminder_4pm);
  }
  const rows = await sql`UPDATE users SET reminder_8pm = NOT reminder_8pm WHERE id = ${userId} RETURNING reminder_8pm`;
  return Boolean(rows[0]?.reminder_8pm);
}

export async function touchActivity(userId: number): Promise<void> {
  await sql`UPDATE users SET last_activity = now() WHERE id = ${userId}`;
}

export async function listActiveUsers(): Promise<User[]> {
  // Cast the DATE dedupe columns to text so the scheduler can compare them
  // to 'YYYY-MM-DD' strings regardless of how the driver serialises dates.
  return (await sql`
    SELECT id, telegram_id, username, first_name, status, timezone,
           reminder_4pm, reminder_8pm,
           last_4pm_sent::text    AS last_4pm_sent,
           last_8pm_sent::text    AS last_8pm_sent,
           last_weekly_sent::text AS last_weekly_sent,
           last_monthly_sent::text AS last_monthly_sent,
           last_activity, created_at
    FROM users WHERE status = 'active' ORDER BY id
  `) as User[];
}

export async function countByStatus(): Promise<{ total: number; active: number; pending: number; blocked: number }> {
  const rows = await sql`SELECT status, COUNT(*)::int AS count FROM users GROUP BY status`;
  const totalRows = await sql`SELECT COUNT(*)::int AS count FROM users`;
  const map: Record<string, number> = {};
  for (const r of rows) map[r.status] = r.count;
  return {
    total: totalRows[0].count,
    active: map['active'] ?? 0,
    pending: map['pending'] ?? 0,
    blocked: map['blocked'] ?? 0,
  };
}

export async function countUsersByStatus(status: string): Promise<number> {
  const rows = await sql`SELECT COUNT(*)::int AS count FROM users WHERE status = ${status}`;
  return rows[0].count;
}

export async function listUsersByStatus(status: string, limit = 8, offset = 0): Promise<User[]> {
  return (await sql`
    SELECT id, telegram_id, username, first_name, status, timezone,
           reminder_4pm, reminder_8pm,
           last_4pm_sent::text    AS last_4pm_sent,
           last_8pm_sent::text    AS last_8pm_sent,
           last_weekly_sent::text AS last_weekly_sent,
           last_monthly_sent::text AS last_monthly_sent,
           last_activity::text    AS last_activity,
           created_at::text       AS created_at
    FROM users WHERE status = ${status}
    ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
  `) as User[];
}

// ─── Categories ───────────────────────────────────────────────────────

let categoryCache: { at: number; cats: Category[] } | null = null;

export async function getCategories(): Promise<Category[]> {
  if (categoryCache && Date.now() - categoryCache.at < 5 * 60 * 1000) {
    return categoryCache.cats;
  }
  const cats = (await sql`SELECT * FROM categories ORDER BY id`) as Category[];
  categoryCache = { at: Date.now(), cats };
  return cats;
}

export async function getCategory(id: number): Promise<Category | null> {
  const rows = await sql`SELECT * FROM categories WHERE id = ${id} LIMIT 1`;
  return (rows[0] as Category) ?? null;
}

// ─── Expenses (all queries scoped by user_id — data isolation) ────────

export async function insertExpense(
  userId: number,
  amount: number,
  categoryId: number,
  description: string | null,
  expenseDate: string,
): Promise<ExpenseRow> {
  const rows = await sql`
    INSERT INTO expenses (user_id, amount, category_id, description, expense_date)
    VALUES (${userId}, ${amount}, ${categoryId}, ${description}, ${expenseDate})
    RETURNING id`;
  const expense = await getExpense(rows[0].id, userId);
  if (!expense) throw new Error('Failed to load inserted expense');
  return expense;
}

export async function getExpense(id: number, userId: number): Promise<ExpenseRow | null> {
  const rows = await sql`
    SELECT e.id, e.amount::float8 AS amount, e.description, e.expense_date::text AS expense_date, e.category_id,
           c.name AS category_name, c.icon, e.created_at::text AS created_at
    FROM expenses e
    JOIN categories c ON c.id = e.category_id
    WHERE e.id = ${id} AND e.user_id = ${userId}
    LIMIT 1`;
  return (rows[0] as ExpenseRow) ?? null;
}

export async function listExpenses(userId: number, limit = 8, offset = 0): Promise<ExpenseRow[]> {
  return (await sql`
    SELECT e.id, e.amount::float8 AS amount, e.description, e.expense_date::text AS expense_date, e.category_id,
           c.name AS category_name, c.icon, e.created_at::text AS created_at
    FROM expenses e
    JOIN categories c ON c.id = e.category_id
    WHERE e.user_id = ${userId}
    ORDER BY e.expense_date DESC, e.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `) as ExpenseRow[];
}

export async function expensesOn(userId: number, date: string): Promise<ExpenseRow[]> {
  return (await sql`
    SELECT e.id, e.amount::float8 AS amount, e.description, e.expense_date::text AS expense_date, e.category_id,
           c.name AS category_name, c.icon, e.created_at::text AS created_at
    FROM expenses e
    JOIN categories c ON c.id = e.category_id
    WHERE e.user_id = ${userId} AND e.expense_date = ${date}
    ORDER BY e.created_at DESC, e.id DESC
  `) as ExpenseRow[];
}

export async function reportBetween(userId: number, from: string, to: string): Promise<Report> {
  const totals = await sql`
    SELECT COALESCE(SUM(e.amount)::float8, 0) AS total, COUNT(*)::int AS count
    FROM expenses e
    WHERE e.user_id = ${userId} AND e.expense_date BETWEEN ${from} AND ${to}`;
  const byCategory = (await sql`
    SELECT c.icon, c.name, SUM(e.amount)::float8 AS total
    FROM expenses e
    JOIN categories c ON c.id = e.category_id
    WHERE e.user_id = ${userId} AND e.expense_date BETWEEN ${from} AND ${to}
    GROUP BY c.id, c.name, c.icon
    ORDER BY total DESC
  `) as CategoryTotal[];
  return { total: Number(totals[0].total), count: totals[0].count, byCategory };
}

export async function countExpensesForUser(userId: number): Promise<number> {
  const rows = await sql`SELECT COUNT(*)::int AS count FROM expenses WHERE user_id = ${userId}`;
  return rows[0].count;
}

export async function countExpensesTotal(): Promise<number> {
  const rows = await sql`SELECT COUNT(*)::int AS count FROM expenses`;
  return rows[0].count;
}

export async function updateExpenseAmount(id: number, userId: number, amount: number): Promise<ExpenseRow | null> {
  const rows = await sql`
    UPDATE expenses e SET amount = ${amount}
    FROM categories c
    WHERE e.id = ${id} AND e.user_id = ${userId} AND c.id = e.category_id
    RETURNING e.id, e.amount::float8 AS amount, e.description, e.expense_date::text AS expense_date, e.category_id,
              c.name AS category_name, c.icon, e.created_at::text AS created_at`;
  return (rows[0] as ExpenseRow) ?? null;
}

export async function updateExpenseCategory(id: number, userId: number, categoryId: number): Promise<ExpenseRow | null> {
  const rows = await sql`
    UPDATE expenses e SET category_id = ${categoryId}
    FROM categories c
    WHERE e.id = ${id} AND e.user_id = ${userId} AND c.id = e.category_id
    RETURNING e.id, e.amount::float8 AS amount, e.description, e.expense_date::text AS expense_date, e.category_id,
              c.name AS category_name, c.icon, e.created_at::text AS created_at`;
  return (rows[0] as ExpenseRow) ?? null;
}

export async function updateExpenseDescription(id: number, userId: number, description: string | null): Promise<ExpenseRow | null> {
  const rows = await sql`
    UPDATE expenses e SET description = ${description}
    FROM categories c
    WHERE e.id = ${id} AND e.user_id = ${userId} AND c.id = e.category_id
    RETURNING e.id, e.amount::float8 AS amount, e.description, e.expense_date::text AS expense_date, e.category_id,
              c.name AS category_name, c.icon, e.created_at::text AS created_at`;
  return (rows[0] as ExpenseRow) ?? null;
}

export async function deleteExpense(id: number, userId: number): Promise<void> {
  await sql`DELETE FROM expenses WHERE id = ${id} AND user_id = ${userId}`;
}

/**
 * Permanently delete every expense dated before `months` months ago.
 * Global (not per-user) — used by the monthly auto-prune retention policy.
 * Returns the number of rows deleted.
 */
export async function pruneOldExpenses(months: number): Promise<number> {
  const rows = await sql`
    DELETE FROM expenses
    WHERE expense_date < CURRENT_DATE - make_interval(months => ${months})
    RETURNING id`;
  return rows.length;
}

// ─── Conversation state (stateless serverless friendly) ──────────────

export async function getState(userId: number): Promise<UserState | null> {
  const rows = await sql`SELECT * FROM user_states WHERE user_id = ${userId} LIMIT 1`;
  return (rows[0] as UserState) ?? null;
}

export async function setState(userId: number, state: string, data: Record<string, unknown> = {}): Promise<void> {
  await sql`
    INSERT INTO user_states (user_id, state, data, updated_at)
    VALUES (${userId}, ${state}, ${JSON.stringify(data)}::jsonb, now())
    ON CONFLICT (user_id)
    DO UPDATE SET state = EXCLUDED.state, data = EXCLUDED.data, updated_at = now()`;
}

export async function clearState(userId: number): Promise<void> {
  await sql`DELETE FROM user_states WHERE user_id = ${userId}`;
}

// ─── Scheduled-send tracking (prevents double-sends) ─────────────────

const REMINDER_COLUMNS = {
  fourPm: 'last_4pm_sent',
  eightPm: 'last_8pm_sent',
  weekly: 'last_weekly_sent',
  monthly: 'last_monthly_sent',
} as const;

export async function touchReminder(userId: number, kind: keyof typeof REMINDER_COLUMNS, date: string): Promise<void> {
  const col = REMINDER_COLUMNS[kind];
  if (col === 'last_4pm_sent') await sql`UPDATE users SET last_4pm_sent = ${date} WHERE id = ${userId}`;
  else if (col === 'last_8pm_sent') await sql`UPDATE users SET last_8pm_sent = ${date} WHERE id = ${userId}`;
  else if (col === 'last_weekly_sent') await sql`UPDATE users SET last_weekly_sent = ${date} WHERE id = ${userId}`;
  else await sql`UPDATE users SET last_monthly_sent = ${date} WHERE id = ${userId}`;
}
