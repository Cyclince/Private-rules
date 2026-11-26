import { createRepositories, type ApiKeySummary, type RateLimitStatus } from '../../data/repositories';
import { id } from '../../domain/rules/slug';
import type { Env } from '../../types';
import type { DatabasePort } from '../ports/database';

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function generateApiKeyToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `prk_${token}`;
}

export async function hasAnyApiKey(env: Env): Promise<boolean> {
  return createRepositories(env.DB).apiKeys.hasAny();
}

export async function listApiKeys(env: Env): Promise<{ keys: ApiKeySummary[] }> {
  return { keys: await createRepositories(env.DB).apiKeys.list() };
}

export async function createApiKeyRecord(env: Env, note = '', scopes = 'full') {
  const apiKey = generateApiKeyToken();
  const keyId = id('key');
  const createdAt = new Date().toISOString();
  const cleanNote = note.trim().slice(0, 80);
  const keyPrefix = `${apiKey.slice(0, 12)}…`;
  await createRepositories(env.DB).apiKeys.create({
    id: keyId,
    note: cleanNote,
    keyHash: await sha256Hex(apiKey),
    keyPrefix,
    scopes,
    createdAt,
    lastUsedAt: null,
  });
  return { id: keyId, apiKey, note: cleanNote, keyPrefix, scopes, createdAt };
}

export async function deleteApiKeyRecord(env: Env, keyId: string): Promise<void> {
  await createRepositories(env.DB).apiKeys.deleteById(keyId);
}

export async function updateApiKeyNoteRecord(env: Env, keyId: string, note: string): Promise<void> {
  await createRepositories(env.DB).apiKeys.updateNote(keyId, note.trim().slice(0, 80));
}

export async function authenticateApiKeyToken(env: Env, rawToken: string): Promise<boolean> {
  const { apiKeys } = createRepositories(env.DB);
  const row = await apiKeys.findByHash(await sha256Hex(rawToken));
  if (!row) return false;
  await apiKeys.touchLastUsed(row.id, new Date().toISOString());
  return true;
}

export async function createSessionRecord(database: DatabasePort, maxAgeSeconds: number) {
  const sessionId = id('sess');
  const created = new Date();
  const expires = new Date(created.getTime() + maxAgeSeconds * 1000);
  await createRepositories(database).sessions.create({
    id: sessionId,
    expiresAt: expires.toISOString(),
    createdAt: created.toISOString(),
  });
  return { sessionId, createdAt: created.toISOString(), expiresAt: expires.toISOString() };
}

export async function findValidSessionRecord(
  database: DatabasePort,
  sessionId: string,
  nowIso = new Date().toISOString(),
) {
  return createRepositories(database).sessions.findValid(sessionId, nowIso);
}

export async function deleteSessionRecord(database: DatabasePort, sessionId: string): Promise<void> {
  await createRepositories(database).sessions.deleteById(sessionId);
}

/** Scheduled maintenance task: removes expired admin sessions (design §8.2). */
export async function cleanupExpiredSessions(
  database: DatabasePort,
  nowIso = new Date().toISOString(),
): Promise<number> {
  return createRepositories(database).sessions.cleanupExpired(nowIso);
}

export async function consumeRateLimit(
  database: DatabasePort,
  identity: string,
  operation: string,
  limit: number,
  windowSeconds = 60,
): Promise<RateLimitStatus> {
  return createRepositories(database).rateLimits.consume(identity, operation, limit, windowSeconds);
}

export async function peekRateLimit(
  database: DatabasePort,
  identity: string,
  operation: string,
  limit: number,
  windowSeconds = 60,
): Promise<RateLimitStatus> {
  return createRepositories(database).rateLimits.peek(identity, operation, limit, windowSeconds);
}

export async function resetRateLimit(database: DatabasePort, identity: string, operation: string): Promise<void> {
  return createRepositories(database).rateLimits.reset(identity, operation);
}
