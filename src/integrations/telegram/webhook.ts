import type { Context } from 'hono';
import type { AppVariables, Env } from '../../types';
import { id } from '../../lib/slug';
import { TelegramRepository } from '../../application/telegram/repository';
import { TelegramBotApplication } from './bot';
import type { TelegramUpdate } from './types';
import { cleanupTelegramMessages } from './services/message-cleanup';

const MAX_BODY_BYTES = 1_048_576;

function sameSecret(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function telegramWebhook(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  const config = c.env.TELEGRAM;
  if (!config?.enabled || !c.env.TELEGRAM_CLIENT) return c.notFound();
  if (!sameSecret(c.req.header('x-telegram-bot-api-secret-token') ?? '', config.webhookSecret)) {
    return c.json({ ok: false, error: 'Webhook secret 无效。' }, 401);
  }
  if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return c.json({ ok: false, error: 'Content-Type 必须是 application/json。' }, 415);
  }
  const declaredLength = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return c.json({ ok: false, error: '请求体过大。' }, 413);
  const body = await c.req.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return c.json({ ok: false, error: '请求体过大。' }, 413);
  let update: TelegramUpdate;
  try { update = JSON.parse(body) as TelegramUpdate; } catch { return c.json({ ok: false, error: 'JSON 格式错误。' }, 400); }
  if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) return c.json({ ok: false, error: 'update_id 无效。' }, 400);
  // A callback's message date is the age of the keyboard-bearing message, not
  // the time of the click. Telegram can legitimately deliver a fresh click on
  // an old message, so only reject stale incoming message updates here.
  const updateDate = update.message?.date;
  if (updateDate && Math.floor(Date.now() / 1000) - updateDate > config.updateMaxAgeSeconds) {
    return c.json({ ok: true, ignored: 'expired' });
  }
  const repository = new TelegramRepository(c.env.DB);
  if (!await repository.claimUpdate(String(update.update_id), Math.max(3600, config.updateMaxAgeSeconds * 4))) {
    return c.json({ ok: true, duplicate: true });
  }
  const correlationId = id('tg-request');
  const task = Promise.all([
    new TelegramBotApplication(c.env, c.env.TELEGRAM_CLIENT).handleUpdate(update, correlationId),
    cleanupTelegramMessages(c.env),
  ]).then(() => undefined);
  c.env.BACKGROUND_TASKS?.schedule(task);
  if (!c.env.BACKGROUND_TASKS) await task;
  return c.json({ ok: true, correlationId });
}
