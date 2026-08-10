import { config } from './config.js';

/** Format a number as money, e.g. LKR 1,500 or LKR 450.50 */
export function money(n: number | string): string {
  const v = Number(n);
  const formatted = Number.isInteger(v)
    ? v.toLocaleString('en-US')
    : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${config.currency} ${formatted}`;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Break a date into the parts of the user's local timezone. */
export function getLocalParts(tz: string, d: Date = new Date()): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0; // some engines render midnight as "24"
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
  };
}

export function toDateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Today's date string ('YYYY-MM-DD') in the user's timezone. */
export function localDateString(tz: string, d: Date = new Date()): string {
  const p = getLocalParts(tz, d);
  return toDateStr(p.year, p.month, p.day);
}

/** '2026-08-09' → '09 Aug 2026' */
export function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** '2026-08-09' → '09 AUG' */
export function shortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
  })
    .format(new Date(Date.UTC(y, m - 1, d)))
    .toUpperCase();
}

/** Monday → Sunday range of the current local week. */
export function weekRange(tz: string, d: Date = new Date()): { from: string; to: string } {
  const p = getLocalParts(tz, d);
  const today = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dow = (today.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - dow);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    from: toDateStr(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate()),
    to: toDateStr(sunday.getUTCFullYear(), sunday.getUTCMonth() + 1, sunday.getUTCDate()),
  };
}

/** First → last day of the current local month. */
export function monthRange(tz: string, d: Date = new Date()): { from: string; to: string } {
  const p = getLocalParts(tz, d);
  const daysInMonth = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  return { from: toDateStr(p.year, p.month, 1), to: toDateStr(p.year, p.month, daysInMonth) };
}

/** 'AUGUST 2026' for the current local month. */
export function monthLabel(tz: string, d: Date = new Date()): string {
  const p = getLocalParts(tz, d);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  })
    .format(new Date(Date.UTC(p.year, p.month - 1, 1)))
    .toUpperCase();
}

export function isSunday(tz: string, d: Date = new Date()): boolean {
  const p = getLocalParts(tz, d);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() === 0;
}

export function isLastDayOfMonth(tz: string, d: Date = new Date()): boolean {
  const p = getLocalParts(tz, d);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return next.getUTCMonth() !== p.month - 1;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a user-typed amount: '450', '450.50', '1,500', 'LKR 450' → number.
 * Returns null when invalid. Rejects junk like '1e5' or '450 500'.
 */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  s = s.replace(/^(rs\.?|lkr|usd|eur|gbp|inr|[$€£₹])\s*/i, ''); // optional currency prefix
  s = s.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000_000) return null;
  return n;
}
