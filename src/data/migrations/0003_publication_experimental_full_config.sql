-- Experimental full-config toggle on publications for Loon / Quantumult X (design §20).
-- Defaults to 0 (safe rules-only resource mode) so existing and newly created publications
-- never overwrite client node subscriptions unless explicitly opted in.

ALTER TABLE publications ADD COLUMN experimental_full_config INTEGER NOT NULL DEFAULT 0;
