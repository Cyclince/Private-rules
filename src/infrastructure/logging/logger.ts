import type { LogLevel } from '../config/types';

export type LogRecord = {
  timestamp: string;
  level: LogLevel;
  component?: string;
  message: string;
  [key: string]: unknown;
};

export type LogSink = (line: string, level: LogLevel) => void;

export type Logger = {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(component: string): Logger;
};

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY_PATTERN =
  /^(?:authorization|cookie|set-cookie|x-telegram-bot-api-secret-token|.*(?:token|password|secret|apikey|api_key|subscription_?url|init_?data).*)$/i;

const REDACTED = '[REDACTED]';

function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username) parsed.username = REDACTED;
    if (parsed.password) parsed.password = REDACTED;
    parsed.pathname = parsed.pathname.replace(/^\/(sub|t)\/[^/]+(\/|$)/i, `/$1/${REDACTED}$2`);
    if (parsed.search) {
      const sanitizedParams: string[] = [];
      for (const [key] of parsed.searchParams.entries()) {
        sanitizedParams.push(`${encodeURIComponent(key)}=${REDACTED}`);
      }
      return `${parsed.origin}${parsed.pathname}?${sanitizedParams.join('&')}`;
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return rawUrl.replace(/\?[^\s'"`)]+/, `?${REDACTED}`);
  }
}

/**
 * Redacts sensitive tokens, subscription URL query strings, Authorization
 * headers, cookies, and API keys from arbitrary strings before logging.
 */
export function redactString(input: string): string {
  return (
    input
      // Redact full http(s) URLs (credentials, query strings, /sub/<token>/, /t/<token>/)
      .replace(/https?:\/\/[^\s'"`<>)]+/gi, (match) => redactUrl(match))
      // Redact /sub/<token>/ or /t/<token>/ relative paths
      .replace(/(^|[\s"'`])\/(sub|t)\/[^/\s"'`]+(\/|$)/gi, `$1/$2/${REDACTED}$3`)
      // Redact Bearer / Basic authorization values
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`)
      // Redact Authorization / Cookie / Set-Cookie header lines
      .replace(/\b(authorization|cookie|set-cookie)\s*:\s*[^\r\n]+/gi, `$1: ${REDACTED}`)
      // Redact Private Rules API keys
      .replace(/\bprk_[A-Za-z0-9_-]+/g, `prk_${REDACTED}`)
      // Redact session cookie or key=value pairs containing secrets
      .replace(
        /\b(private_rules_session|token|key|auth|signature|secret|password)\s*=\s*[^&\s;,'"]+/gi,
        `$1=${REDACTED}`,
      )
  );
}

/**
 * Recursively redacts sensitive fields and strings in arbitrary log payloads.
 */
export function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    };
  }

  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = REDACTED;
    } else {
      output[key] = redactValue(entry, seen);
    }
  }
  return output;
}

function defaultSink(line: string, level: LogLevel): void {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

export function createLogger(options: { level?: LogLevel; component?: string; sink?: LogSink } = {}): Logger {
  const minPriority = LEVEL_PRIORITY[options.level ?? 'info'];
  const component = options.component;
  const sink = options.sink ?? defaultSink;

  const emit = (level: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (LEVEL_PRIORITY[level] < minPriority) return;
    const redactedFields = fields ? (redactValue(fields) as Record<string, unknown>) : {};
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      ...(component ? { component } : {}),
      message: redactString(message),
      ...redactedFields,
    };
    sink(JSON.stringify(record), level);
  };

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (childComponent) =>
      createLogger({
        level: options.level,
        component: component ? `${component}:${childComponent}` : childComponent,
        sink,
      }),
  };
}
