-- Per-source coverage deduplication toggle (design §9.3.1).
-- Defaults to 0 so existing 1.0.x / pre-M4.3a sources keep byte-identical output;
-- newly created 1.1.0 sources explicitly store 1 (opt-out with 0).

ALTER TABLE category_sources ADD COLUMN coverage_dedup INTEGER NOT NULL DEFAULT 0;
