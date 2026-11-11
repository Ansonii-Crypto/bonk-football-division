CREATE TABLE IF NOT EXISTS divisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    draft_json TEXT NOT NULL,
    published_json TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    published_version INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    published_at INTEGER,
    created_by_bonk_id TEXT NOT NULL REFERENCES bonk_users(bonk_id)
);

CREATE TABLE IF NOT EXISTS division_members (
    division_id INTEGER NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
    bonk_id TEXT NOT NULL REFERENCES bonk_users(bonk_id),
    role TEXT NOT NULL CHECK (role IN ('director', 'organizer', 'editor')),
    assigned_by_bonk_id TEXT NOT NULL REFERENCES bonk_users(bonk_id),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (division_id, bonk_id)
);

CREATE INDEX IF NOT EXISTS divisions_published ON divisions(published_at, id);
CREATE INDEX IF NOT EXISTS division_members_user ON division_members(bonk_id, division_id);
