import { config } from '../src/config.js';
import { runScheduledJobs } from '../src/scheduler.js';

/**
 * Scheduled-tasks endpoint. Call it every 15 minutes from cron-job.org:
 *   POST https://<your-app>.vercel.app/api/cron?secret=<CRON_SECRET>
 */
export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }
  const secret = (req.query?.secret as string | undefined) ?? (req.headers['x-cron-secret'] as string | undefined);
  if (!secret || secret !== config.cronSecret) {
    res.status(401).json({ ok: false, error: 'bad secret' });
    return;
  }
  const result = await runScheduledJobs();
  res.status(200).json({ ok: true, ...result });
}
