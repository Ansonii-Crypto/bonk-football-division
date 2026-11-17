CREATE TABLE IF NOT EXISTS division_poll_votes (
    division_id INTEGER NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
    poll_id TEXT NOT NULL,
    revision TEXT NOT NULL,
    bonk_id TEXT NOT NULL REFERENCES bonk_users(bonk_id) ON DELETE CASCADE,
    option_index INTEGER NOT NULL CHECK (option_index BETWEEN 0 AND 7),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (division_id, poll_id, revision, bonk_id)
);

CREATE INDEX IF NOT EXISTS division_poll_vote_counts
ON division_poll_votes(division_id, poll_id, revision, option_index);
