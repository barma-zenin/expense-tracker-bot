import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  /** Token of the user (expense tracker) bot. */
  userBotToken: required('TELEGRAM_BOT_TOKEN'),
  /** Token of the admin bot. */
  adminBotToken: required('TELEGRAM_ADMIN_BOT_TOKEN'),
  /** Telegram numeric IDs allowed to use the admin bot. */
  adminIds: (process.env.ADMIN_IDS ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0),
  /** Neon serverless Postgres connection string. */
  databaseUrl: required('DATABASE_URL'),
  /** Currency code shown in messages, e.g. LKR. */
  currency: process.env.CURRENCY ?? 'LKR',
  /** Default IANA timezone for new users. */
  defaultTimezone: process.env.DEFAULT_TIMEZONE ?? 'Asia/Colombo',
  /** When true, new users skip the admin approval step. */
  autoApprove: (process.env.AUTO_APPROVE ?? 'false').toLowerCase() === 'true',
  /** Secret that must be passed to the /api/cron endpoint. */
  cronSecret: process.env.CRON_SECRET ?? 'change-me',
};
