import { userBot, adminBot } from './bots';

// `bot.start()` returns a promise that never resolves until the bot is
// stopped, so we must NOT await it — otherwise the second bot would never
// start. Fire both and keep the process alive on the polling loops.
function startBot(name: string, bot: { start: () => Promise<void> }): void {
  console.log(`Starting ${name} (long polling)...`);
  bot.start().catch((err) => {
    console.error(`[dev] ${name} failed to start or stopped with an error:`, err);
    // Mark the process as failed; it exits when the other bot stops (or right
    // away if neither bot started).
    process.exitCode = 1;
  });
}

startBot('user bot', userBot);
startBot('admin bot', adminBot);
