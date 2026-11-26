import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import packageMetadata from '../../package.json';
import { APP_VERSION } from '../../src/version';

describe('release version', () => {
  it('uses package.json as the runtime source of truth', () => {
    expect(APP_VERSION).toBe(packageMetadata.version);
  });

  it('pins the default Compose deployment to the application version, or the last stable one during a prerelease', async () => {
    const compose = await readFile(new URL('../../docker-compose.yml', import.meta.url), 'utf8');
    const pinned = compose.match(/cyclince\/private-rules:([^\s]+)/)?.[1];
    expect(pinned, 'docker-compose.yml must pin an explicit stable version').toMatch(/^\d+\.\d+\.\d+$/);
    if (/^\d+\.\d+\.\d+$/.test(packageMetadata.version)) expect(pinned).toBe(packageMetadata.version);
  });
});
