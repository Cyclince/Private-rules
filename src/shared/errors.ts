/**
 * Error codes shared by server and web. The web maps each code to a localized
 * message; the server never relies on matching message text.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  BACKUP_INVALID: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RULESET_NOT_FOUND: 404,
  SOURCE_NOT_FOUND: 404,
  RULE_NOT_FOUND: 404,
  TEMPLATE_NOT_FOUND: 404,
  PUBLICATION_NOT_FOUND: 404,
  CONFLICT: 409,
  RULE_CONFLICT: 409,
  SYNC_IN_PROGRESS: 409,
  RATE_LIMITED: 429,
  LOGIN_LOCKED: 429,
  UPSTREAM_FAILED: 502,
  NOT_CONFIGURED: 503,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export type ErrorBody = {
  ok: false;
  /** Human-readable message; kept as `error` for compatibility with 1.0.x clients. */
  error: string;
  code: ErrorCode;
  details?: unknown;
};

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = ERROR_CODES[code];
  }

  toBody(): ErrorBody {
    return {
      ok: false,
      error: this.message,
      code: this.code,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export const isAppError = (value: unknown): value is AppError => value instanceof AppError;
