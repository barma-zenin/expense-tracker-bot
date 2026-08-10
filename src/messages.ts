import { InlineKeyboard } from 'grammy';
import * as db from './db';
import { formatDate, getLocalParts, localDateString, money, monthLabel, monthRange, shortDate, weekRange } from './format';

// ─── Small building blocks ────────────────────────────────────────────

export function expenseLine(e: db.ExpenseRow): string {
  return `${e.icon} ${e.category_name} — ${money(e.amount)}${e.description ? ` · ${e.description}` : ''}`;
}

export function expenseAddedText(e: db.ExpenseRow): string {
  return [
    '✅ Expense Added',
    '',
    `💸 Amount: ${money(e.amount)}`,
    `📂 Category: ${e.icon} ${e.category_name}`,
    `📝 Description: ${e.description ?? '—'}`,
    `📅 Date: ${formatDate(e.expense_date)}`,
  ].join('\n');
}

export function todaySummaryText(user: db.User, rows: db.ExpenseRow[], today: string): string {
  if (rows.length === 0) {
    return `📅 No expenses recorded today.\n\nAdd one with /add 🙂`;
  }
  const byCat = new Map<string, db.ExpenseRow[]>();
  for (const r of rows) {
    const key = `${r.icon} ${r.category_name}`;
    const list = byCat.get(key) ?? [];
    list.push(r);
    byCat.set(key, list);
  }
  const lines: string[] = [`📅 TODAY — ${shortDate(today)}`, ''];
  let total = 0;
  for (const [cat, items] of byCat) {
    lines.push(cat);
    for (const it of items) {
      total += it.amount;
      lines.push(`• ${it.description ?? 'No description'} — ${money(it.amount)}`);
    }
    lines.push('');
  }
  lines.push('━━━━━━━━━━━━');
  lines.push(`💸 TOTAL: ${money(total)}`);
  lines.push(`🧾 Expenses: ${rows.length}`);
  return lines.join('\n');
}

export function expensesListText(rows: db.ExpenseRow[], offset: number, totalCount: number): string {
  if (rows.length === 0) {
    return '📭 No expenses found.\n\nAdd your first expense with /add 🙂';
  }
  const lines = ['📝 RECENT EXPENSES', ''];
  rows.forEach((r, i) => {
    lines.push(`${offset + i + 1}. ${r.icon} ${r.category_name} — ${money(r.amount)}${r.description ? ` · ${r.description}` : ''}`);
  });
  lines.push('', `Showing ${offset + 1}–${offset + rows.length} of ${totalCount}`);
  return lines.join('\n');
}

export function categoryLine(c: db.CategoryTotal): string {
  return `${c.icon} ${c.name}`.padEnd(20) + money(c.total).padStart(12);
}

// ─── Reports ──────────────────────────────────────────────────────────

export async function buildReportMessage(user: db.User, kind: 'daily' | 'weekly' | 'monthly'): Promise<string> {
  const tz = user.timezone;

  if (kind === 'daily') {
    const today = localDateString(tz);
    const rep = await db.reportBetween(user.id, today, today);
    if (rep.count === 0) return `📊 DAILY REPORT\n${formatDate(today).toUpperCase()}\n\nNo expenses on this day.`;
    return [
      '📊 DAILY REPORT',
      formatDate(today).toUpperCase(),
      '',
      `💸 Total: ${money(rep.total)}`,
      `🧾 Expenses: ${rep.count}`,
      '',
      ...rep.byCategory.map(categoryLine),
    ].join('\n');
  }

  if (kind === 'weekly') {
    const { from, to } = weekRange(tz);
    const rep = await db.reportBetween(user.id, from, to);
    const avg = Math.round(rep.total / 7);
    if (rep.count === 0) return `📊 WEEKLY REPORT\n${shortDate(from)} — ${shortDate(to)}\n\nNo expenses this week.`;
    return [
      '📊 WEEKLY REPORT',
      `${shortDate(from)} — ${shortDate(to)}`,
      '',
      `💸 Total: ${money(rep.total)}`,
      `🧾 Expenses: ${rep.count}`,
      '',
      '📂 CATEGORIES',
      ...rep.byCategory.map(categoryLine),
      '',
      '📅 Daily Average',
      money(avg),
    ].join('\n');
  }

  const { from, to } = monthRange(tz);
  const rep = await db.reportBetween(user.id, from, to);
  const p = getLocalParts(tz);
  const daysInMonth = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  const avg = Math.round(rep.total / daysInMonth);
  if (rep.count === 0) return `📊 MONTHLY REPORT\n${monthLabel(tz)}\n\nNo expenses this month.`;
  const top = rep.byCategory[0];
  return [
    '📊 MONTHLY REPORT',
    monthLabel(tz),
    '',
    `💸 Total: ${money(rep.total)}`,
    `🧾 Expenses: ${rep.count}`,
    '',
    '📂 CATEGORIES',
    ...rep.byCategory.map(categoryLine),
    '',
    '🏆 Top Category',
    `${top.icon} ${top.name} — ${money(top.total)}`,
    '',
    '📅 Daily Average',
    money(avg),
  ].join('\n');
}

// ─── Welcome / help / settings ────────────────────────────────────────

export function welcomeText(user: db.User): string {
  const name = user.first_name ?? 'there';
  return [
    `👋 Welcome, ${name}!`,
    '',
    'This is your private expense tracker. 📊',
    'Only you can see your expenses — every user\'s data is fully isolated. 🔒',
    '',
    'Commands:',
    '➕ /add — record an expense',
    '📅 /today — today\'s summary',
    '📝 /expenses — view & manage expenses',
    '📊 /report — daily, weekly & monthly reports',
    '🌍 /timezone — set your timezone',
    '⏰ /reminders — manage reminders',
    '❓ /help — show help',
  ].join('\n');
}

export function helpText(): string {
  return [
    '📖 HELP',
    '',
    '➕ /add — record an expense (amount → category → description)',
    '📅 /today — see everything you spent today',
    '📝 /expenses — recent expenses, with ✏️ edit and 🗑 delete',
    '📊 /report — daily, weekly or monthly report',
    '🌍 /timezone — set your timezone (reminders follow it)',
    '⏰ /reminders — toggle the 4 PM / 8 PM reminders',
    '❌ /cancel — cancel the current action',
    '/skip — skip the description while adding/editing',
    '',
    '💰 Currency: LKR',
  ].join('\n');
}

export function timezonePromptText(): string {
  return [
    '🌍 SEND YOUR TIMEZONE',
    '',
    'Use the IANA format, e.g.:',
    'Asia/Colombo · Asia/Kolkata · Asia/Dubai · Europe/London · America/New_York',
    '',
    'Reminders and reports will follow this timezone.',
    'Send /cancel to abort.',
  ].join('\n');
}

export function remindersText(user: db.User): string {
  return [
    '⏰ REMINDER SETTINGS',
    '',
    `⏰ 4:00 PM reminder: ${user.reminder_4pm ? '✅ ON' : '❌ OFF'}`,
    `⏰ 8:00 PM reminder: ${user.reminder_8pm ? '✅ ON' : '❌ OFF'}`,
    '',
    'Tap a button to toggle.',
  ].join('\n');
}

export function remindersKb(user: db.User): InlineKeyboard {
  return new InlineKeyboard()
    .text(`⏰ 4 PM: ${user.reminder_4pm ? 'ON' : 'OFF'}`, 'rem:set:4')
    .text(`⏰ 8 PM: ${user.reminder_8pm ? 'ON' : 'OFF'}`, 'rem:set:8')
    .row()
    .text('❌ Done', 'rem:settings-done');
}

// ─── Scheduled reminders ──────────────────────────────────────────────

export function reminderKb(): InlineKeyboard {
  return new InlineKeyboard()
    .text('➕ Add Expense', 'rem:add')
    .text('📅 View Today', 'rem:today')
    .text('✅ Done for Today', 'rem:done');
}

export function reminder4pmText(): string {
  return ['⏰ EXPENSE REMINDER', '', 'Have you recorded all your expenses so far today?', ''].join('\n');
}

export function reminder8pmText(todayTotal: number): string {
  return [
    '⏰ FINAL EXPENSE CHECK',
    '',
    'Before ending your day, remember to record today\'s expenses.',
    '',
    'Today\'s total:',
    `💸 ${money(todayTotal)}`,
    '',
  ].join('\n');
}
