import type { DatabasePort } from '../../application/ports/database';
import { createDrizzle, type AppDatabase } from '../db';
import { ApiKeysRepository } from './api-keys';
import { CardsRepository } from './cards';
import { CatalogRepository } from './catalog';
import { IconPacksRepository } from './icon-packs';
import { NodeBindingsRepository } from './node-bindings';
import { PublicationsRepository } from './publications';
import { RateLimitsRepository } from './rate-limits';
import { RulesRepository } from './rules';
import { RuleSetsRepository } from './rulesets';
import { SessionsRepository } from './sessions';
import { SettingsRepository } from './settings';
import { SourcesRepository } from './sources';
import { TemplatesRepository } from './templates';

export type Repositories = {
  db: AppDatabase;
  rulesets: RuleSetsRepository;
  rules: RulesRepository;
  sources: SourcesRepository;
  settings: SettingsRepository;
  sessions: SessionsRepository;
  apiKeys: ApiKeysRepository;
  rateLimits: RateLimitsRepository;
  iconPacks: IconPacksRepository;
  catalog: CatalogRepository;
  cards: CardsRepository;
  templates: TemplatesRepository;
  publications: PublicationsRepository;
  nodeBindings: NodeBindingsRepository;
};

export function createRepositories(database: DatabasePort): Repositories {
  const db = createDrizzle(database);
  return {
    db,
    rulesets: new RuleSetsRepository(db),
    rules: new RulesRepository(db, database),
    sources: new SourcesRepository(db, database),
    settings: new SettingsRepository(db),
    sessions: new SessionsRepository(db, database),
    apiKeys: new ApiKeysRepository(db),
    rateLimits: new RateLimitsRepository(db),
    iconPacks: new IconPacksRepository(db),
    catalog: new CatalogRepository(db, database),
    cards: new CardsRepository(db),
    templates: new TemplatesRepository(db, database),
    publications: new PublicationsRepository(db),
    nodeBindings: new NodeBindingsRepository(db, database),
  };
}

export * from './api-keys';
export * from './cards';
export * from './catalog';
export * from './icon-packs';
export * from './node-bindings';
export * from './publications';
export * from './rate-limits';
export * from './rules';
export * from './rulesets';
export * from './sessions';
export * from './settings';
export * from './sources';
export * from './templates';
