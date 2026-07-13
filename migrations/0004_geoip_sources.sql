ALTER TABLE category_sources ADD COLUMN geoip_name TEXT;

INSERT OR IGNORE INTO settings (key, value) VALUES ('customIconPackNames', '{}');
