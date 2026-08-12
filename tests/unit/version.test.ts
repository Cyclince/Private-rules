import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import packageMetadata from '../../package.json';
import { APP_VERSION } from '../../src/version';

describe('release version', () => {
  it('uses package.json as the runtime source of truth', () => {
    expect(APP_VERSION).toBe(packageMetadata.version);
  });

  it('pins the default Compose deployment to the application version', async () => {
    const compose = await readFile(new URL('../../docker-compose.yml', import.meta.url), 'utf8');
    expect(compose).toContain(`cyclince/private-rules:${packageMetadata.version}`);
  });
});
