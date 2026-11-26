import { HTTPException } from 'hono/http-exception';
import { createLogger } from '../../infrastructure/logging/logger';
import { AppError, type ErrorBody } from '../../shared/errors';

const errorLogger = createLogger({ component: 'http' });

function respond(body: ErrorBody, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function handleError(err: unknown) {
  if (err instanceof AppError) return respond(err.toBody(), err.status);
  if (err instanceof HTTPException && err.status === 400) {
    return respond({ ok: false, error: '请求体 JSON 格式错误。', code: 'VALIDATION_FAILED' }, 400);
  }
  const correlationId = crypto.randomUUID().slice(0, 12);
  errorLogger.error('unhandled request error', {
    correlationId,
    message: err instanceof Error ? err.message : 'unknown error',
  });
  return respond(
    { ok: false, error: `服务器处理失败。错误编号：${correlationId}`, code: 'INTERNAL', details: { correlationId } },
    500,
  );
}
