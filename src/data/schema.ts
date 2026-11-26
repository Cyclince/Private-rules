import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// 1.0.x tables retained and extended in 1.1.0 (design §8.2)
// ---------------------------------------------------------------------------

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    icon: text('icon'),
    description: text('description'),
    note: text('note'),
    sortOrder: integer('sort_order').default(0),
    enabled: integer('enabled').default(1),
    publicLinksEnabled: integer('public_links_enabled').default(0),
    tokenLinksEnabled: integer('token_links_enabled').default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_categories_slug').on(table.slug)],
);

export const rules = sqliteTable(
  'rules',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    value: text('value').notNull(),
    type: text('type').notNull(),
    displayType: text('display_type'),
    options: text('options'),
    note: text('note'),
    enabled: integer('enabled').default(1),
    sortOrder: integer('sort_order').default(0),
    sourceId: text('source_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_rules_category_id').on(table.categoryId),
    index('idx_rules_enabled').on(table.enabled),
    index('idx_rules_source').on(table.sourceId),
    uniqueIndex('idx_rules_unique_source_value').on(
      table.categoryId,
      sql`IFNULL(${table.sourceId}, '')`,
      table.type,
      table.value,
    ),
    index('idx_rules_category_source').on(table.categoryId, table.sourceId),
    index('idx_rules_type_value').on(table.type, table.value),
  ],
);

export const categorySources = sqliteTable(
  'category_sources',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    enabled: integer('enabled').default(1),
    lastSyncedAt: text('last_synced_at'),
    lastStatus: text('last_status').default('pending'),
    lastCount: integer('last_count').default(0),
    lastOriginalCount: integer('last_original_count').default(0),
    lastError: text('last_error'),
    syncIntervalMinutes: integer('sync_interval_minutes').default(60),
    userAgent: text('user_agent').default('clash-verge/v2.5.1'),
    sourceType: text('source_type').default('url'),
    geositeName: text('geosite_name'),
    geoipName: text('geoip_name'),
    ruleOptimization: text('rule_optimization').default('none'),
    coverageDedup: integer('coverage_dedup').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_sources_category').on(table.categoryId)],
);

export const sourceRuleStaging = sqliteTable(
  'source_rule_staging',
  {
    syncId: text('sync_id').notNull(),
    id: text('id').notNull(),
    sourceId: text('source_id').notNull(),
    categoryId: text('category_id').notNull(),
    value: text('value').notNull(),
    type: text('type').notNull(),
    displayType: text('display_type'),
    note: text('note'),
    sortOrder: integer('sort_order').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.syncId, table.id] }),
    index('idx_source_rule_staging_sync').on(table.syncId),
  ],
);

export const syncLeases = sqliteTable(
  'sync_leases',
  {
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    ownerId: text('owner_id').notNull(),
    acquiredAt: text('acquired_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.resourceType, table.resourceId] }),
    index('idx_sync_leases_expires').on(table.expiresAt),
  ],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_sessions_expires').on(table.expiresAt)],
);

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    note: text('note').notNull().default(''),
    keyHash: text('key_hash').notNull().unique(),
    keyPrefix: text('key_prefix').notNull(),
    scopes: text('scopes').notNull().default('full'),
    createdAt: text('created_at').notNull(),
    lastUsedAt: text('last_used_at'),
  },
  (table) => [index('idx_api_keys_hash').on(table.keyHash)],
);

export const iconPackCache = sqliteTable('icon_pack_cache', {
  url: text('url').primaryKey(),
  payload: text('payload'),
  iconCount: integer('icon_count').notNull().default(0),
  lastStatus: text('last_status').notNull().default('pending'),
  lastError: text('last_error'),
  updatedAt: text('updated_at').notNull(),
});

export const rateLimits = sqliteTable(
  'rate_limits',
  {
    identity: text('identity').notNull(),
    operation: text('operation').notNull(),
    windowStartedAt: text('window_started_at').notNull(),
    hits: integer('hits').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.identity, table.operation] })],
);

// ---------------------------------------------------------------------------
// Telegram integration tables (retained from 1.0.x)
// ---------------------------------------------------------------------------

export const telegramUsers = sqliteTable(
  'telegram_users',
  {
    id: text('id').primaryKey(),
    telegramUserId: text('telegram_user_id').notNull().unique(),
    username: text('username'),
    displayName: text('display_name'),
    role: text('role').notNull().default('admin'),
    enabled: integer('enabled').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastSeenAt: text('last_seen_at'),
  },
  (table) => [
    check('chk_telegram_users_role', sql`${table.role} = 'admin'`),
    check('chk_telegram_users_enabled', sql`${table.enabled} = 1`),
  ],
);

export const telegramProcessedUpdates = sqliteTable(
  'telegram_processed_updates',
  {
    updateId: text('update_id').primaryKey(),
    processedAt: text('processed_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [index('idx_telegram_updates_expires').on(table.expiresAt)],
);

export const telegramSessions = sqliteTable(
  'telegram_sessions',
  {
    id: text('id').primaryKey(),
    telegramUserId: text('telegram_user_id')
      .notNull()
      .references(() => telegramUsers.telegramUserId, { onDelete: 'cascade' }),
    sessionTokenHash: text('session_token_hash').notNull().unique(),
    role: text('role').notNull().default('admin'),
    scope: text('scope').notNull().default('["admin"]'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
  },
  (table) => [
    check('chk_telegram_sessions_role', sql`${table.role} = 'admin'`),
    index('idx_telegram_sessions_user').on(table.telegramUserId),
    index('idx_telegram_sessions_expires').on(table.expiresAt),
  ],
);

export const telegramAuditLogs = sqliteTable(
  'telegram_audit_logs',
  {
    id: text('id').primaryKey(),
    telegramUserId: text('telegram_user_id').notNull(),
    chatId: text('chat_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    summary: text('summary').notNull().default(''),
    result: text('result').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    check('chk_telegram_audit_result', sql`${table.result} IN ('success', 'failure', 'denied', 'started')`),
    index('idx_telegram_audit_created').on(table.createdAt),
  ],
);

export const telegramNotifications = sqliteTable('telegram_notifications', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull().unique(),
  syncFailed: integer('sync_failed').notNull().default(1),
  syncCompleted: integer('sync_completed').notNull().default(1),
  securityAlerts: integer('security_alerts').notNull().default(1),
  enabled: integer('enabled').notNull().default(1),
  notificationMode: text('notification_mode').notNull().default('digest'),
  digestTime: text('digest_time').notNull().default('09:00'),
  lastDigestDate: text('last_digest_date'),
  muted: integer('muted').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const telegramNotificationEvents = sqliteTable(
  'telegram_notification_events',
  {
    id: text('id').primaryKey(),
    chatId: text('chat_id').notNull(),
    summary: text('summary').notNull(),
    failed: integer('failed').notNull().default(0),
    createdAt: text('created_at').notNull(),
    deliveredAt: text('delivered_at'),
  },
  (table) => [index('idx_telegram_notification_events_pending').on(table.chatId, table.deliveredAt, table.createdAt)],
);

export const telegramMessageDeletions = sqliteTable(
  'telegram_message_deletions',
  {
    id: text('id').primaryKey(),
    chatId: text('chat_id').notNull(),
    messageId: integer('message_id').notNull(),
    deleteAfter: text('delete_after').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    unique('uq_telegram_message_deletions_chat_msg').on(table.chatId, table.messageId),
    index('idx_telegram_message_deletions_due').on(table.deleteAfter, table.attempts),
  ],
);

export const telegramConversations = sqliteTable(
  'telegram_conversations',
  {
    telegramUserId: text('telegram_user_id').notNull(),
    chatId: text('chat_id').notNull(),
    kind: text('kind').notNull(),
    state: text('state').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.telegramUserId, table.chatId] }),
    index('idx_telegram_conversations_expires').on(table.expiresAt),
  ],
);

export const telegramConfirmations = sqliteTable(
  'telegram_confirmations',
  {
    nonce: text('nonce').primaryKey(),
    telegramUserId: text('telegram_user_id').notNull(),
    chatId: text('chat_id').notNull(),
    action: text('action').notNull(),
    targetId: text('target_id').notNull(),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
  },
  (table) => [index('idx_telegram_confirmations_expires').on(table.expiresAt)],
);

export const telegramInitDataReplays = sqliteTable('telegram_init_data_replays', {
  replayHash: text('replay_hash').primaryKey(),
  telegramUserId: text('telegram_user_id').notNull(),
  expiresAt: text('expires_at').notNull(),
});

// ---------------------------------------------------------------------------
// 1.1.0 new tables (design §8.3)
// ---------------------------------------------------------------------------

export const catalogEntries = sqliteTable(
  'catalog_entries',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    aliases: text('aliases').notNull().default('[]'),
    category: text('category').notNull(),
    defaultRoute: text('default_route').notNull(),
    sourceUrl: text('source_url').notNull(),
    ruleCount: integer('rule_count'),
  },
  (table) => [
    index('idx_catalog_entries_provider').on(table.provider),
    index('idx_catalog_entries_category').on(table.category),
    index('idx_catalog_entries_parent').on(table.parentId),
  ],
);

export const appCards = sqliteTable(
  'app_cards',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    icon: text('icon'),
    category: text('category').notNull(),
    body: text('body').notNull(),
    origin: text('origin').notNull().default('user'),
    forkedFrom: text('forked_from'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_app_cards_category').on(table.category)],
);

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  baseKind: text('base_kind').notNull(),
  baseSourceUrl: text('base_source_url'),
  baseBody: text('base_body').notNull(),
  overlay: text('overlay').notNull().default('[]'),
  currentVersion: integer('current_version').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const templateVersions = sqliteTable(
  'template_versions',
  {
    templateId: text('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    resolvedBody: text('resolved_body').notNull(),
    note: text('note').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.templateId, table.version] })],
);

export const publications = sqliteTable(
  'publications',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    templateId: text('template_id')
      .notNull()
      .references(() => templates.id),
    pinnedVersion: integer('pinned_version'),
    clients: text('clients').notNull(),
    access: text('access').notNull().default('token'),
    output: text('output'),
    experimentalFullConfig: integer('experimental_full_config').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_publications_template').on(table.templateId)],
);

export const nodeBindings = sqliteTable(
  'node_bindings',
  {
    publicationId: text('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    slotId: text('slot_id').notNull(),
    subscriptionUrlEnc: text('subscription_url_enc').notNull(),
    userAgent: text('user_agent'),
    lastFetchedAt: text('last_fetched_at'),
    lastStatus: text('last_status'),
    lastNodeCount: integer('last_node_count'),
  },
  (table) => [primaryKey({ columns: [table.publicationId, table.slotId] })],
);

export const nodeSnapshots = sqliteTable(
  'node_snapshots',
  {
    publicationId: text('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    slotId: text('slot_id').notNull(),
    nodesEnc: text('nodes_enc').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.publicationId, table.slotId] })],
);

export const schema = {
  categories,
  rules,
  categorySources,
  sourceRuleStaging,
  syncLeases,
  settings,
  sessions,
  apiKeys,
  iconPackCache,
  rateLimits,
  telegramUsers,
  telegramProcessedUpdates,
  telegramSessions,
  telegramAuditLogs,
  telegramNotifications,
  telegramNotificationEvents,
  telegramMessageDeletions,
  telegramConversations,
  telegramConfirmations,
  telegramInitDataReplays,
  catalogEntries,
  appCards,
  templates,
  templateVersions,
  publications,
  nodeBindings,
  nodeSnapshots,
};
