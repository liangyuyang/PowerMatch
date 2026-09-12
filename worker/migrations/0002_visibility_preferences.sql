ALTER TABLE revisions ADD COLUMN scope TEXT NOT NULL DEFAULT 'public' CHECK(scope IN ('public','company','private'));
ALTER TABLE users ADD COLUMN locale_mode TEXT NOT NULL DEFAULT 'auto';
