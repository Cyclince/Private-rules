ALTER TABLE category_sources ADD COLUMN rule_optimization TEXT DEFAULT 'none';
ALTER TABLE category_sources ADD COLUMN last_original_count INTEGER DEFAULT 0;

UPDATE category_sources
SET rule_optimization = 'none', last_original_count = COALESCE(last_count, 0)
WHERE rule_optimization IS NULL OR last_original_count IS NULL;
