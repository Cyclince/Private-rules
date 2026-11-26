import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES } from '../../src/shared/errors';
import { handleError } from '../../src/server/middleware/errors';

describe('error handling', () => {
  it('maps AppError codes to status and the canonical flat error body', async () => {
    const response = handleError(new AppError('RULESET_NOT_FOUND', '规则集不存在。', { id: 'x' }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: '规则集不存在。',
      code: 'RULESET_NOT_FOUND',
      details: { id: 'x' },
    });
  });

  it('defines status codes for CSRF and explicit SESSION_SECRET enforcement', () => {
    expect(ERROR_CODES.CSRF_REJECTED).toBe(403);
    expect(ERROR_CODES.CARD_NOT_FOUND).toBe(404);
    expect(ERROR_CODES.SESSION_SECRET_REQUIRED).toBe(503);
  });

  it('keeps legacy user-facing errors as 400', async () => {
    const response = handleError(new Error('分类不存在。'));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('VALIDATION_FAILED');
  });

  it('hides internal error details behind a correlation id', async () => {
    const response = handleError(new Error('SQLITE_CONSTRAINT: secret detail'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe('INTERNAL');
    expect(body.error).not.toContain('secret detail');
    expect(body.details.correlationId).toMatch(/^[0-9a-f-]{12}$/);
  });
});
