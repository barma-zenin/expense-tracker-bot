import { webhookCallback } from 'grammy';
import { adminBot } from '../src/bots.js';

const handleUpdate = webhookCallback(adminBot, 'http');

/** Vercel function — Telegram posts admin-bot updates here. */
export default async function handler(req: any, res: any): Promise<void> {
  if (req.method === 'POST') {
    await handleUpdate(req, res);
  } else {
    res.status(200).json({ ok: true });
  }
}
