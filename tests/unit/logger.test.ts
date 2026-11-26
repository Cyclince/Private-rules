import { describe, expect, it } from 'vitest';
import { createLogger, redactString, redactValue } from '../../src/infrastructure/logging/logger';

describe('structured JSON logger with redaction', () => {
  it('emits single-line JSON records filtered by log level and child component', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      component: 'sync',
      sink: (line) => lines.push(line),
    });

    logger.debug('ignored debug');
    logger.child('worker').info('sync completed', { count: 42 });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed.level).toBe('info');
    expect(parsed.component).toBe('sync:worker');
    expect(parsed.message).toBe('sync completed');
    expect(parsed.count).toBe(42);
    expect(typeof parsed.timestamp).toBe('string');
  });

  it('redacts tokens, subscription URL query strings, Authorization, cookies, and API keys', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'debug', sink: (line) => lines.push(line) });

    logger.error(
      'Failed fetching https://airport.example.com/sub?token=supersecret&flag=clash with Authorization: Bearer topsecret-jwt and Cookie: private_rules_session=abc.def',
      {
        authorization: 'Bearer header-secret',
        cookie: 'private_rules_session=cookie-secret',
        ruleToken: 'rule-token-secret',
        subscriptionUrl: 'https://airport.example.com/api/sub?token=url-secret',
        nested: {
          apiKey: 'prk_secret_12345',
          path: '/sub/my-secret-token/rules.yaml',
          templatePath: '/t/my-secret-token/home/mihomo.yaml',
          err: new Error('upstream rejected prk_leaked_999 at https://a.example/s?key=k123&sig=s456'),
        },
      },
    );

    const raw = lines[0];
    expect(raw).not.toContain('supersecret');
    expect(raw).not.toContain('topsecret-jwt');
    expect(raw).not.toContain('abc.def');
    expect(raw).not.toContain('header-secret');
    expect(raw).not.toContain('cookie-secret');
    expect(raw).not.toContain('rule-token-secret');
    expect(raw).not.toContain('url-secret');
    expect(raw).not.toContain('prk_secret_12345');
    expect(raw).not.toContain('my-secret-token');
    expect(raw).not.toContain('prk_leaked_999');
    expect(raw).not.toContain('k123');
    expect(raw).not.toContain('s456');

    const record = JSON.parse(raw) as Record<string, unknown>;
    expect(record.authorization).toBe('[REDACTED]');
    expect(record.cookie).toBe('[REDACTED]');
    expect(record.ruleToken).toBe('[REDACTED]');
    expect(record.subscriptionUrl).toBe('[REDACTED]');
    expect((record.nested as Record<string, unknown>).path).toBe('/sub/[REDACTED]/rules.yaml');
    expect((record.nested as Record<string, unknown>).templatePath).toBe('/t/[REDACTED]/home/mihomo.yaml');
  });

  it('handles circular references safely', () => {
    const obj: Record<string, unknown> = { ok: true };
    obj.self = obj;
    expect(redactValue(obj)).toEqual({ ok: true, self: '[Circular]' });
    expect(redactString('https://sub.example/download?token=abc&user=bob')).toBe(
      'https://sub.example/download?token=[REDACTED]&user=[REDACTED]',
    );
  });
});
