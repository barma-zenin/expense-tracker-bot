import { webhookCallback } from 'grammy';
import { userBot } from '../src/bots';

const handleUpdate = webhookCallback(userBot, 'http');

/** Vercel function — Telegram posts user-bot updates here. */
export default async function handler(req: any, res: any): Promise<void> {
  if (req.method === 'POST') {
    await handleUpdate(req, res);
  } else {
    res.status(200).json({ ok: true });
  }
}
