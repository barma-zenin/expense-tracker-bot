/**
 * Register the Telegram webhooks after deploying to Vercel.
 *
 * Usage:
 *   npm run webhook:set -- https://your-app.vercel.app
 *
 * Requires TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_BOT_TOKEN in .env
 */
import 'dotenv/config';

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error('Usage: npm run webhook:set -- https://your-app.vercel.app');
  process.exit(1);
}

async function setWebhook(token, url) {
  if (!token) {
    console.log(`⚠️  Skipping ${url} — token not set in .env`);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(url)}`);
  const json = await res.json();
  console.log(`${url} →`, json.ok ? '✅ ok' : `❌ ${JSON.stringify(json)}`);
}

console.log(`Setting webhooks for base URL: ${baseUrl}\n`);
await setWebhook(process.env.TELEGRAM_BOT_TOKEN, `${baseUrl}/api/webhook`);
await setWebhook(process.env.TELEGRAM_ADMIN_BOT_TOKEN, `${baseUrl}/api/admin-webhook`);
console.log('\nDone.');
