import { Bot, Context, InlineKeyboard } from 'grammy';
import { config } from './config.js';
import * as db from './db.js';
import { formatDate } from './format.js';

const STATUS_LABEL: Record<string, string> = {
  active: '🟢 Active',
  pending: '⏳ Pending',
  blocked: '🔴 Blocked',
};

const PAGE_SIZE = 8;

export function registerAdminBotHandlers(adminBot: Bot, userBot: Bot): void {
  adminBot.catch((err) => console.error('[admin-bot] error:', err));

  // Only configured admins may use this bot.
  adminBot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (!id || !config.adminIds.includes(id)) {
      console.warn('[admin-bot] ignored update from non-admin id:', id ?? 'unknown');
      // Answer stray callback queries so the client doesn't spin, then refuse.
      try {
        if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      } catch {
        // ignore
      }
      if (ctx.message) {
        await ctx.reply('🔒 Unauthorized.\n\nThis bot is for administrators only.').catch(() => {});
      }
      return;
    }
    await next();
  });

  // ─── Helpers ────────────────────────────────────────────────────────

  async function editOrReply(ctx: Context, text: string, kb?: InlineKeyboard): Promise<void> {
    try {
      await ctx.editMessageText(text, kb ? { reply_markup: kb } : undefined);
    } catch {
      await ctx.reply(text, kb ? { reply_markup: kb } : undefined);
    }
  }

  async function notifyUser(telegramId: number, text: string): Promise<void> {
    try {
      await userBot.api.sendMessage(telegramId, text);
    } catch (e) {
      console.warn('[admin-bot] failed to notify user', telegramId, e);
    }
  }

  function panelKb(): InlineKeyboard {
    return new InlineKeyboard()
      .text('👥 Users', 'admin:users')
      .text('⏳ Pending', 'admin:list:pending')
      .text('🚫 Blocked', 'admin:list:blocked')
      .row()
      .text('📊 Statistics', 'admin:stats');
  }

  async function statsText(): Promise<string> {
    const c = await db.countByStatus();
    const expenses = await db.countExpensesTotal();
    return [
      '📊 BOT STATISTICS',
      '',
      `👥 Total Users: ${c.total}`,
      `🟢 Active: ${c.active}`,
      `⏳ Pending: ${c.pending}`,
      `🔴 Blocked: ${c.blocked}`,
      '',
      `💸 Expenses Recorded: ${expenses}`,
    ].join('\n');
  }

  async function usersOverviewText(): Promise<string> {
    const c = await db.countByStatus();
    return [
      '👥 USERS',
      '',
      `Total: ${c.total}`,
      `🟢 Active: ${c.active}`,
      `⏳ Pending: ${c.pending}`,
      `🔴 Blocked: ${c.blocked}`,
    ].join('\n');
  }

  function usersOverviewKb(): InlineKeyboard {
    return new InlineKeyboard()
      .text('🟢 Active Users', 'admin:list:active')
      .text('⏳ Pending Users', 'admin:list:pending')
      .row()
      .text('🔴 Blocked Users', 'admin:list:blocked')
      .row()
      .text('🏠 Menu', 'admin:panel');
  }

  async function renderList(ctx: Context, status: string, page: number): Promise<void> {
    const total = await db.countUsersByStatus(status);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const users = await db.listUsersByStatus(status, PAGE_SIZE, page * PAGE_SIZE);
    const label = (STATUS_LABEL[status] ?? status).toUpperCase();
    const lines = [`👥 ${label} USERS`, `Page ${page + 1} of ${pages}`, ''];
    if (users.length === 0) {
      lines.push('(none)');
    } else {
      users.forEach((u, i) => {
        lines.push(`${page * PAGE_SIZE + i + 1}. ${u.first_name ?? '—'}${u.username ? ' @' + u.username : ''} — ${STATUS_LABEL[u.status] ?? u.status}`);
      });
    }
    const kb = new InlineKeyboard();
    users.forEach((u) => {
      kb.text(`${u.first_name ?? u.username ?? u.telegram_id}`, `admin:user:${u.telegram_id}`).row();
    });
    if (page > 0 || page + 1 < pages) {
      if (page > 0) kb.text('◀️', `admin:page:${status}:${page - 1}`);
      if (page + 1 < pages) kb.text('▶️', `admin:page:${status}:${page + 1}`);
      kb.row();
    }
    kb.text('🏠 Menu', 'admin:panel');
    await editOrReply(ctx, lines.join('\n'), kb);
  }

  async function renderDetails(ctx: Context, telegramId: number): Promise<void> {
    const u = await db.findByTelegramId(telegramId);
    if (!u) return editOrReply(ctx, '❌ User not found.');
    const expenses = await db.countExpensesForUser(u.id);
    const text = [
      '👤 USER DETAILS',
      '',
      `Name: ${u.first_name ?? '—'}`,
      `Username: ${u.username ? '@' + u.username : '—'}`,
      `🆔 Telegram ID: ${u.telegram_id}`,
      '',
      `Status: ${STATUS_LABEL[u.status] ?? u.status}`,
      `Joined: ${formatDate(u.created_at.slice(0, 10))}`,
      `Expenses: ${expenses}`,
      `Last Activity: ${u.last_activity ? formatDate(u.last_activity.slice(0, 10)) : '—'}`,
    ].join('\n');
    const kb = new InlineKeyboard()
      .text(
        u.status === 'blocked' ? '🔓 Unblock' : '🚫 Block',
        u.status === 'blocked' ? `admin:unblock:${telegramId}` : `admin:block:${telegramId}`,
      )
      .row()
      .text('🏠 Menu', 'admin:panel');
    await editOrReply(ctx, text, kb);
  }

  async function confirmBlock(ctx: Context, telegramId: number): Promise<void> {
    const u = await db.findByTelegramId(telegramId);
    if (!u) return editOrReply(ctx, '❌ User not found.');
    const kb = new InlineKeyboard()
      .text('✅ Yes, Block', `admin:blockyes:${telegramId}`)
      .text('❌ Cancel', 'admin:blockno');
    await editOrReply(ctx, `⚠️ Block ${u.first_name ?? 'this user'}?\n\nThey will no longer be able to use the Expense Bot.`, kb);
  }

  // ─── Commands ───────────────────────────────────────────────────────

  adminBot.command('start', async (ctx) => {
    await ctx.reply('🔐 ADMIN PANEL\n\nWhat would you like to do?', { reply_markup: panelKb() });
  });

  adminBot.command('stats', async (ctx) => {
    await ctx.reply(await statsText());
  });

  // ─── Callbacks ──────────────────────────────────────────────────────

  adminBot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    console.log('[admin-bot] callback received:', data);

    // Answer the button immediately so it never spins forever; if the answer
    // itself fails (network blip), keep going — the action must still run.
    try {
      await ctx.answerCallbackQuery();
    } catch (e) {
      console.error('[admin-bot] failed to answer callback:', e);
    }

    try {
      if (data === 'admin:panel') return ctx.reply('🔐 ADMIN PANEL\n\nWhat would you like to do?', { reply_markup: panelKb() });
      if (data === 'admin:users') return ctx.reply(await usersOverviewText(), { reply_markup: usersOverviewKb() });
      if (data === 'admin:stats') return ctx.reply(await statsText());

      if (data.startsWith('admin:list:')) {
        const status = data.split(':')[2];
        return renderList(ctx, status, 0);
      }
      if (data.startsWith('admin:page:')) {
        const [, , status, pageRaw] = data.split(':');
        return renderList(ctx, status, Number(pageRaw));
      }
      if (data.startsWith('admin:user:')) {
        return renderDetails(ctx, Number(data.split(':')[2]));
      }

      // Block: confirm → execute. Order matters: 'admin:block:' prefix must be checked
      // before 'admin:blockyes:' because both start with 'admin:block'.
      if (data.startsWith('admin:blockyes:')) {
        const telegramId = Number(data.split(':')[2]);
        await db.setStatusByTelegramId(telegramId, 'blocked');
        await notifyUser(telegramId, '🚫 Access Denied\n\nYour account has been blocked by the administrator.');
        return editOrReply(ctx, '🔴 User Blocked\n\nThis user can no longer use the Expense Bot.');
      }
      if (data === 'admin:blockno') return editOrReply(ctx, '❌ Cancelled.');
      if (data.startsWith('admin:block:')) {
        return confirmBlock(ctx, Number(data.split(':')[2]));
      }

      if (data.startsWith('admin:unblock:')) {
        const telegramId = Number(data.split(':')[2]);
        await db.setStatusByTelegramId(telegramId, 'active');
        await notifyUser(telegramId, '✅ Your account has been re-activated by the administrator.\n\nYou can use the Expense Bot again!');
        return editOrReply(ctx, '🔓 User Unblocked\n\nThis user can use the Expense Bot again.');
      }

      if (data.startsWith('admin:approve:')) {
        const telegramId = Number(data.split(':')[2]);
        console.log('[admin-bot] approving user', telegramId);
        await db.setStatusByTelegramId(telegramId, 'active');
        await notifyUser(telegramId, '✅ Your account has been approved!\n\nWelcome to the Expense Tracker. Send /start to begin.');
        try {
          await ctx.answerCallbackQuery('✅ User approved');
        } catch {
          // ignore
        }
        return editOrReply(ctx, '✅ User Approved\n\nThis user can now use the Expense Bot.');
      }
    } catch (e) {
      console.error('[admin-bot] callback error:', e);
      try {
        await ctx.reply('⚠️ Something went wrong.');
      } catch {
        // ignore
      }
    }
  });
}
