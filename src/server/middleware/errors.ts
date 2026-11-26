import { AppError, type ErrorBody } from '../../shared/errors';

/**
 * 1.0.x code throws plain Errors and relied on matching message text to tell
 * user errors from server faults. New code throws AppError with a code; the
 * legacy pattern stays only until every throw site is migrated (design §12.1).
 */
const LEGACY_USER_ERROR =
  /不存在|无效|格式|请输入|请选择|只读|不能|必须|重复|正在同步|任务正在执行|SSRF|上游|GeoSite|GeoIP|来源/;

function respond(body: ErrorBody, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function handleError(err: unknown) {
  if (err instanceof AppError) return respond(err.toBody(), err.status);
  const correlationId = crypto.randomUUID().slice(0, 12);
  console.error(`[request:${correlationId}]`, err instanceof Error ? err.message : 'unknown error');
  if (err instanceof Error && LEGACY_USER_ERROR.test(err.message)) {
    return respond({ ok: false, error: err.message, code: 'VALIDATION_FAILED' }, 400);
  }
  return respond(
    { ok: false, error: `服务器处理失败。错误编号：${correlationId}`, code: 'INTERNAL', details: { correlationId } },
    500,
  );
}
