import { hc } from 'hono/client';
import type { AppType } from '../../server/app';
import { ERROR_CODES, type ErrorBody, type ErrorCode } from '../../shared/errors';
import { translateErrorCode, type Locale } from '../i18n';

export type ApiClient = ReturnType<typeof hc<AppType>>;

function isKnownErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export function createApiClient(baseUrl = '', customFetch?: typeof fetch): ApiClient {
  const fetchImpl = customFetch ?? globalThis.fetch.bind(globalThis);
  return hc<AppType>(baseUrl, {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      return fetchImpl(input, {
        credentials: 'same-origin',
        ...init,
        headers,
      });
    },
  });
}

export const api: ApiClient = createApiClient();

export type ApiResponseLike = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export async function parseApiError(response: ApiResponseLike): Promise<ApiClientError> {
  const payload = (await response.json().catch(() => null)) as Partial<ErrorBody> | null;
  const code: ErrorCode = isKnownErrorCode(payload?.code)
    ? payload.code
    : response.status === 401
      ? 'UNAUTHENTICATED'
      : response.status === 403
        ? 'FORBIDDEN'
        : response.status === 404
          ? 'NOT_FOUND'
          : response.status === 429
            ? 'RATE_LIMITED'
            : response.status === 400
              ? 'VALIDATION_FAILED'
              : 'INTERNAL';
  const message =
    typeof payload?.error === 'string' && payload.error.trim().length > 0
      ? payload.error
      : `Request failed with status ${response.status}`;
  return new ApiClientError(response.status, code, message, payload?.details);
}

export async function readApiJson<T>(response: ApiResponseLike): Promise<T> {
  if (!response.ok) {
    throw await parseApiError(response);
  }
  return (await response.json()) as T;
}

export function formatApiError(error: unknown, locale: Locale = 'zh-CN'): string {
  if (error instanceof ApiClientError) {
    return translateErrorCode(error.code, locale);
  }
  return translateErrorCode('INTERNAL', locale);
}
