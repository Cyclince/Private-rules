ALTER TABLE category_sources ADD COLUMN source_type TEXT DEFAULT 'url';
ALTER TABLE category_sources ADD COLUMN geosite_name TEXT;
