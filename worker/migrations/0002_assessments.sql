CREATE TABLE IF NOT EXISTS assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_name TEXT NOT NULL,
    player_bonk_id TEXT,
    class_name TEXT NOT NULL DEFAULT '',
    assessment_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    control INTEGER NOT NULL CHECK (control BETWEEN 0 AND 300),
    execution INTEGER NOT NULL CHECK (execution BETWEEN 0 AND 300),
    defending INTEGER NOT NULL CHECK (defending BETWEEN 0 AND 300),
    reaction_time INTEGER NOT NULL CHECK (reaction_time BETWEEN 0 AND 300),
    chemistry INTEGER NOT NULL CHECK (chemistry BETWEEN 0 AND 300),
    game_sense INTEGER NOT NULL CHECK (game_sense BETWEEN 0 AND 300),
    total INTEGER NOT NULL CHECK (total BETWEEN 0 AND 1800),
    tier TEXT NOT NULL CHECK (tier IN ('S', 'A', 'B', 'C', 'D', 'E', 'F')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    created_by_bonk_id TEXT NOT NULL REFERENCES bonk_users(bonk_id),
    created_by_name TEXT NOT NULL,
    updated_by_bonk_id TEXT NOT NULL REFERENCES bonk_users(bonk_id),
    updated_by_name TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS assessments_total ON assessments(total, assessment_date);
CREATE INDEX IF NOT EXISTS assessments_updated ON assessments(updated_at);
CREATE INDEX IF NOT EXISTS assessments_name ON assessments(player_name COLLATE NOCASE);
