import * as db from './db';
import {
  getLocalParts,
  isLastDayOfMonth,
  isSunday,
  localDateString,
} from './format';
import * as msg from './messages';
import { userBot } from './bots';

/**
 * Triggered by cron-job.org (e.g. every 15 minutes).
 *
 * Each user's local time is computed from their own timezone, so a single
 * UTC-triggered endpoint correctly fires 4 PM / 8 PM reminders, the Sunday
 * weekly report and the month-end monthly report for every timezone.
 *
 * A `last_*_sent` date column on the user row prevents double sends.
 */
export async function runScheduledJobs(): Promise<{ processed: number; sent: number }> {
  const users = await db.listActiveUsers();
  let sent = 0;
  for (const user of users) {
    try {
      sent += await runForUser(user);
    } catch (e) {
      console.error(`[cron] user ${user.id} (${user.telegram_id}):`, e);
    }
  }
  return { processed: users.length, sent };
}

async function runForUser(user: db.User): Promise<number> {
  const now = new Date();
  const p = getLocalParts(user.timezone, now);
  // Only act during the first 10 minutes of a local hour, so overlapping
  // cron triggers (15/30-min intervals, delays) never double-send.
  if (p.minute > 10) return 0;

  const today = localDateString(user.timezone, now);
  let sent = 0;

  if (p.hour === 16 && user.reminder_4pm && user.last_4pm_sent !== today) {
    await userBot.api.sendMessage(user.telegram_id, msg.reminder4pmText(), {
      reply_markup: msg.reminderKb(),
    });
    await db.touchReminder(user.id, 'fourPm', today);
    sent++;
  }

  if (p.hour === 20) {
    if (user.reminder_8pm && user.last_8pm_sent !== today) {
      const rows = await db.expensesOn(user.id, today);
      const total = rows.reduce((sum, r) => sum + r.amount, 0);
      await userBot.api.sendMessage(user.telegram_id, msg.reminder8pmText(total), {
        reply_markup: msg.reminderKb(),
      });
      await db.touchReminder(user.id, 'eightPm', today);
      sent++;
    }

    if (isSunday(user.timezone, now) && user.last_weekly_sent !== today) {
      await userBot.api.sendMessage(user.telegram_id, await msg.buildReportMessage(user, 'weekly'));
      await db.touchReminder(user.id, 'weekly', today);
      sent++;
    }

    if (isLastDayOfMonth(user.timezone, now) && user.last_monthly_sent !== today) {
      await userBot.api.sendMessage(user.telegram_id, await msg.buildReportMessage(user, 'monthly'));
      await db.touchReminder(user.id, 'monthly', today);
      sent++;
    }
  }

  return sent;
}
