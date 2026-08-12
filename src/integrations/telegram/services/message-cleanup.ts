import { TelegramRepository } from '../../../application/telegram/repository';
import type { Env } from '../../../types';

export const TELEGRAM_EPHEMERAL_TTL_SECONDS = 60;

export async function cleanupTelegramMessages(env: Env, currentTime = Date.now()) {
  if (!env.TELEGRAM?.enabled || !env.TELEGRAM_CLIENT) return { deleted: 0, failed: 0 };
  const repository = new TelegramRepository(env.DB);
  const pending = await repository.dueMessageDeletions(currentTime);
  let deleted = 0;
  let failed = 0;
  for (const item of pending) {
    try {
      await env.TELEGRAM_CLIENT.deleteMessage(item.chat_id, item.message_id);
      await repository.completeMessageDeletion(item.id);
      deleted += 1;
    } catch (cause) {
      await repository.failMessageDeletion(item.id, item.attempts + 1, cause, currentTime);
      failed += 1;
    }
  }
  return { deleted, failed };
}
