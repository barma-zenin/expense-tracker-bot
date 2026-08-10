import { Bot, Context, InlineKeyboard } from 'grammy';
import { config } from './config';
import * as db from './db';
import { isValidTimezone, localDateString, money, parseAmount } from './format';
import * as msg from './messages';

export function registerUserBotHandlers(adminBot: Bot, userBot: Bot): void {
  userBot.catch((err) => console.error('[user-bot] error:', err));

  // ─── Helpers ────────────────────────────────────────────────────────

  /** Returns the user when they exist and are 'active'; otherwise replies & returns null. */
  async function requireActive(ctx: Context): Promise<db.User | null> {
    const tgId = ctx.from?.id;
    if (!tgId) return null;
    const user = await db.findByTelegramId(tgId);
    if (!user) {
      await ctx.reply('👋 Welcome! Send /start to begin.');
      return null;
    }
    if (user.status === 'blocked') {
      await ctx.reply('🚫 Access Denied\n\nYour account has been blocked by the administrator.');
      return null;
    }
    if (user.status === 'pending') {
      await ctx.reply('⏳ Your account is awaiting approval by the administrator.\n\nPlease check back later.');
      return null;
    }
    await db.touchActivity(user.id);
    return user;
  }

  async function editOrReply(ctx: Context, text: string, kb?: InlineKeyboard): Promise<void> {
    try {
      await ctx.editMessageText(text, kb ? { reply_markup: kb } : undefined);
    } catch {
      await ctx.reply(text, kb ? { reply_markup: kb } : undefined);
    }
  }

  /** Edit a previously tapped message; fall back to a fresh reply. */
  async function confirmUpdated(
    ctx: Context,
    user: db.User,
    messageId: number | undefined,
    text: string,
  ): Promise<void> {
    if (messageId) {
      try {
        await ctx.api.editMessageText(user.telegram_id, messageId, text);
        return;
      } catch {
        // fall through to reply
      }
    }
    await ctx.reply(text);
  }

  async function startAddFlow(ctx: Context, user: db.User): Promise<void> {
    await db.setState(user.id, 'add:amount', {});
    await ctx.reply('💰 Enter amount\n\nSend a number, e.g. 450 or 450.50\nSend /cancel to abort');
  }

  async function categoriesKb(): Promise<InlineKeyboard> {
    const cats = await db.getCategories();
    const kb = new InlineKeyboard();
    cats.forEach((c, i) => {
      kb.text(`${c.icon} ${c.name}`, `cat:${c.id}`);
      if (i % 2 === 1) kb.row();
    });
    return kb;
  }

  async function renderExpenses(
    ctx: Context,
    user: db.User,
    offset: number,
    tappedMessageId?: number,
  ): Promise<void> {
    const rows = await db.listExpenses(user.id, 8, offset);
    const totalCount = await db.countExpensesForUser(user.id);
    const text = msg.expensesListText(rows, offset, totalCount);
    const kb = new InlineKeyboard();
    for (const r of rows) {
      kb.text(`✏️ ${r.id}`, `exp:edit:${r.id}`).text(`🗑 ${r.id}`, `exp:del:${r.id}`).row();
    }
    if (offset > 0 || offset + rows.length < totalCount) {
      if (offset > 0) kb.text('◀️ Back', `exp:page:${Math.max(0, offset - 8)}`);
      if (offset + rows.length < totalCount) kb.text('Next ▶️', `exp:page:${offset + 8}`);
      kb.row();
    }
    kb.text('🏠 Menu', 'main-menu');
    if (tappedMessageId !== undefined) {
      try {
        await ctx.api.editMessageText(user.telegram_id, tappedMessageId, text, { reply_markup: kb });
        return;
      } catch {
        // fall through to fresh reply
      }
    }
    await ctx.reply(text, { reply_markup: kb });
  }

  async function sendToday(ctx: Context, user: db.User): Promise<void> {
    const today = localDateString(user.timezone);
    const rows = await db.expensesOn(user.id, today);
    await ctx.reply(msg.todaySummaryText(user, rows, today));
  }

  async function notifyAdminsNewUser(newUser: db.User): Promise<void> {
    const text = [
      '🔔 NEW USER',
      '',
      `👤 Name: ${newUser.first_name ?? '—'}`,
      `🔹 Username: ${newUser.username ? '@' + newUser.username : '—'}`,
      `🆔 Telegram ID: ${newUser.telegram_id}`,
      '',
      'Status: ⏳ Pending',
    ].join('\n');
    const kb = new InlineKeyboard()
      .text('✅ Approve', `admin:approve:${newUser.telegram_id}`)
      .text('🚫 Block', `admin:block:${newUser.telegram_id}`);
    for (const adminId of config.adminIds) {
      try {
        await adminBot.api.sendMessage(adminId, text, { reply_markup: kb });
      } catch (e) {
        console.warn('[user-bot] failed to notify admin', adminId, e);
      }
    }
  }

  // ─── Commands ───────────────────────────────────────────────────────

  userBot.command('start', async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const status = config.autoApprove ? 'active' : 'pending';
    const { user, isNew } = await db.createUser({
      telegramId: from.id,
      username: from.username ?? null,
      firstName: from.first_name ?? null,
      status,
    });
    await db.touchActivity(user.id);
    if (user.status === 'blocked') {
      return ctx.reply('🚫 Access Denied\n\nYour account has been blocked by the administrator.');
    }
    if (isNew && !config.autoApprove) await notifyAdminsNewUser(user);
    if (user.status === 'pending') {
      return ctx.reply(
        `⏳ Pending Approval\n\nWelcome${user.first_name ? ', ' + user.first_name : ''}! Your account is awaiting approval by the administrator.\n\nYou'll be able to track your expenses as soon as you're approved. ✅`,
      );
    }
    await ctx.reply(msg.welcomeText(user));
  });

  userBot.command('help', async (ctx) => {
    const user = await requireActive(ctx);
    if (!user) return;
    await ctx.reply(msg.helpText());
  });

  userBot.command('cancel', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    // clearState keys on the internal users.id, so resolve it via telegram_id
    const user = await db.findByTelegramId(tgId);
    if (user) await db.clearState(user.id);
    await ctx.reply('✅ Cancelled.');
  });

  userBot.command('add', async (ctx) => {
    const user = await requireActive(ctx);
    if (!user) return;
    const arg = (ctx.match as string | undefined)?.trim();
    if (arg) {
      const amount = parseAmount(arg);
      if (amount === null) {
        return ctx.reply('❌ Invalid amount. Try /add, or a valid number like /add 450');
      }
      await db.setState(user.id, 'add:category', { amount });
      return ctx.reply(`💸 Amount: ${money(amount)}\n\n📂 Choose category:`, { reply_markup: await categoriesKb() });
    }
    await startAddFlow(ctx, user);
  });

  userBot.command('today', async (ctx) => {
    const user = await requireActive(ctx);
    if (!user) return;
    await sendToday(ctx, user);
  });

  userBot.command('expenses', async (ctx) => {
    const user = await requireActive(ctx);
    if (!user) return;
    await renderExpenses(ctx, user, 0);
  });

  userBot.command('report', async (ctx) => {
    const user = await requireActive(ctx);
    if (!user) return;
    const kb = new InlineKeyboard()
      .text('📅 Daily', 'report:daily')
      .text('📆 Weekly', 'report:weekly')
      .row()
      .text('🗓 Monthly', 'report:monthly');
    await ctx.reply('📊 SELECT REPORT\n\nChoose a report:', { reply_markup: kb });
  });

  userBot.command('timezone', async (ctx) => {
    const user = await requireActive(ctx);
    if (!user) return;
    await db.setState(user.id, 'tz', {});
    await ctx.reply(msg.timezonePromptText());
  });

  userBot.command('reminders', async (ctx) => {
    const user = await requireActive(ctx);
    if (!user) return;
    await ctx.reply(msg.remindersText(user), { reply_markup: msg.remindersKb(user) });
  });

  userBot.command('skip', async (ctx) => {
    const user = await requireActive(ctx);
    if (!user) return;
    const st = await db.getState(user.id);
    if (st?.state === 'add:description') {
      const data = st.data as { amount: number; categoryId: number };
      await db.clearState(user.id);
      const expense = await db.insertExpense(user.id, data.amount, data.categoryId, null, localDateString(user.timezone));
      return ctx.reply(msg.expenseAddedText(expense));
    }
    if (st?.state === 'edit:description') {
      const { expenseId, msgId } = st.data as { expenseId: number; msgId?: number };
      await db.clearState(user.id);
      const exp = await db.updateExpenseDescription(expenseId, user.id, null);
      if (!exp) return ctx.reply('❌ Expense not found.');
      return confirmUpdated(ctx, user, msgId, `✅ Description removed\n\n${msg.expenseLine(exp)}`);
    }
    await ctx.reply('❌ Nothing to skip right now.');
  });

  // ─── Free-text input (state machine for /add, edit & timezone) ─────

  userBot.on('message:text', async (ctx) => {
    const text = ctx.message.text ?? '';
    if (text.startsWith('/')) return; // commands are handled above
    const user = await requireActive(ctx);
    if (!user) return;
    const st = await db.getState(user.id);
    if (!st) return;

    if (st.state === 'add:amount') {
      const amount = parseAmount(text);
      if (amount === null) {
        return ctx.reply('❌ Invalid amount. Please enter a positive number, e.g. 450 or 450.50');
      }
      await db.setState(user.id, 'add:category', { amount });
      return ctx.reply('📂 Choose category:', { reply_markup: await categoriesKb() });
    }

    if (st.state === 'add:description') {
      const data = st.data as { amount: number; categoryId: number };
      await db.clearState(user.id);
      const description = text.trim().slice(0, 200) || null;
      const expense = await db.insertExpense(
        user.id,
        data.amount,
        data.categoryId,
        description,
        localDateString(user.timezone),
      );
      return ctx.reply(msg.expenseAddedText(expense));
    }

    if (st.state === 'edit:amount') {
      const { expenseId, msgId } = st.data as { expenseId: number; msgId?: number };
      const amount = parseAmount(text);
      if (amount === null) {
        return ctx.reply('❌ Invalid amount. Please enter a positive number, e.g. 450 or 450.50');
      }
      await db.clearState(user.id);
      const exp = await db.updateExpenseAmount(expenseId, user.id, amount);
      if (!exp) return ctx.reply('❌ Expense not found.');
      return confirmUpdated(ctx, user, msgId, `✅ Amount updated\n\n${msg.expenseLine(exp)}`);
    }

    if (st.state === 'edit:description') {
      const { expenseId, msgId } = st.data as { expenseId: number; msgId?: number };
      await db.clearState(user.id);
      const description = text.trim().slice(0, 200) || null;
      const exp = await db.updateExpenseDescription(expenseId, user.id, description);
      if (!exp) return ctx.reply('❌ Expense not found.');
      return confirmUpdated(ctx, user, msgId, `✅ Description updated\n\n${msg.expenseLine(exp)}`);
    }

    if (st.state === 'tz') {
      const tz = text.trim();
      if (!isValidTimezone(tz)) {
        return ctx.reply(
          '❌ Invalid timezone. Use the IANA format, e.g. Asia/Colombo.\nSee https://en.wikipedia.org/wiki/List_of_tz_database_time_zones',
        );
      }
      await db.clearState(user.id);
      await db.setTimezone(user.id, tz);
      return ctx.reply(`✅ Timezone set to ${tz}.\n\nReminders and reports will now follow your local time. 🕐`);
    }
  });

  // ─── Inline buttons ─────────────────────────────────────────────────

  userBot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();
    const user = await requireActive(ctx);
    if (!user) return;

    try {
      // Main menu
      if (data === 'main-menu') {
        return ctx.reply(msg.helpText());
      }

      // Category picker (add + edit flows)
      if (data.startsWith('cat:')) {
        const categoryId = Number(data.slice(4));
        const st = await db.getState(user.id);
        if (st?.state === 'add:category') {
          const { amount } = st.data as { amount: number };
          await db.setState(user.id, 'add:description', { amount, categoryId });
          return ctx.reply('📝 Description?\n\nSend the description (or /skip to leave it empty)');
        }
        if (st?.state === 'edit:category') {
          const { expenseId, msgId } = st.data as { expenseId: number; msgId?: number };
          await db.clearState(user.id);
          const exp = await db.updateExpenseCategory(expenseId, user.id, categoryId);
          if (!exp) return ctx.reply('❌ Expense not found.');
          return confirmUpdated(ctx, user, msgId, `✅ Category updated\n\n${msg.expenseLine(exp)}`);
        }
        return ctx.reply('❌ No active flow. Send /add to record an expense.');
      }

      // Report menu
      if (data.startsWith('report:')) {
        const kind = data.split(':')[1] as 'daily' | 'weekly' | 'monthly';
        return ctx.reply(await msg.buildReportMessage(user, kind));
      }

      // Buttons attached to scheduled reminders
      if (data === 'rem:add') return startAddFlow(ctx, user);
      if (data === 'rem:today') return sendToday(ctx, user);
      if (data === 'rem:done') return ctx.reply('🎉 Great job! See you at the next check-in. 👋');

      // Reminder settings toggles
      if (data.startsWith('rem:set:')) {
        const which = data.slice(8) as '4' | '8';
        await db.toggleReminder(user.id, which);
        const fresh = await db.findById(user.id);
        if (!fresh) return;
        return editOrReply(ctx, msg.remindersText(fresh), msg.remindersKb(fresh));
      }
      if (data === 'rem:settings-done') {
        return ctx.reply('✅ Settings saved.');
      }

      // Expense list pagination
      if (data.startsWith('exp:page:')) {
        const offset = Number(data.split(':')[2]);
        return renderExpenses(ctx, user, offset, ctx.callbackQuery.message?.message_id);
      }

      // Edit flow
      if (data.startsWith('exp:edit:')) {
        const expenseId = Number(data.slice(9));
        const expense = await db.getExpense(expenseId, user.id);
        if (!expense) return editOrReply(ctx, '❌ Expense not found.');
        const kb = new InlineKeyboard()
          .text('💰 Amount', `edit:opt:amount:${expenseId}`)
          .row()
          .text('📂 Category', `edit:opt:category:${expenseId}`)
          .row()
          .text('📝 Description', `edit:opt:description:${expenseId}`)
          .row()
          .text('❌ Cancel', 'exp:edit-cancel');
        return editOrReply(ctx, `✏️ EDIT EXPENSE\n\n${msg.expenseLine(expense)}\n\nWhat would you like to change?`, kb);
      }

      if (data.startsWith('edit:opt:')) {
        const [, , field, rawId] = data.split(':');
        const expenseId = Number(rawId);
        const tappedId = ctx.callbackQuery.message?.message_id;
        if (field === 'category') {
          await db.setState(user.id, 'edit:category', { expenseId, msgId: tappedId });
          return ctx.reply('📂 Choose a new category:', { reply_markup: await categoriesKb() });
        }
        if (field === 'amount') {
          await db.setState(user.id, 'edit:amount', { expenseId, msgId: tappedId });
          return ctx.reply('💰 Enter new amount:');
        }
        if (field === 'description') {
          await db.setState(user.id, 'edit:description', { expenseId, msgId: tappedId });
          return ctx.reply('📝 Enter new description: (or /skip to remove it)');
        }
        return ctx.reply('❌ Unknown option.');
      }
      if (data === 'exp:edit-cancel') return editOrReply(ctx, '❌ Edit cancelled.');

      // Delete flow
      if (data.startsWith('exp:del:')) {
        const expenseId = Number(data.slice(8));
        const expense = await db.getExpense(expenseId, user.id);
        if (!expense) return editOrReply(ctx, '❌ Expense not found.');
        const kb = new InlineKeyboard()
          .text('✅ Yes, Delete', `exp:del-yes:${expenseId}`)
          .text('❌ Cancel', 'exp:del-no');
        return editOrReply(ctx, `⚠️ Delete this expense?\n\n${msg.expenseLine(expense)}\n\nThis cannot be undone.`, kb);
      }

      if (data.startsWith('exp:del-yes:')) {
        const expenseId = Number(data.slice(12)); // 'exp:del-yes:' is 12 chars
        await db.deleteExpense(expenseId, user.id);
        return editOrReply(ctx, '🗑 Expense deleted.');
      }
      if (data === 'exp:del-no') return editOrReply(ctx, '❌ Cancelled.');
    } catch (e) {
      console.error('[user-bot] callback error:', e);
      try {
        await ctx.reply('⚠️ Something went wrong. Please try again.');
      } catch {
        // ignore
      }
    }
  });
}
