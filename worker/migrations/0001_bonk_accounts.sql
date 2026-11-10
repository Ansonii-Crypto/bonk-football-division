CREATE TABLE IF NOT EXISTS bonk_users (
    bonk_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    avatar_code TEXT,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash TEXT PRIMARY KEY,
    bonk_id TEXT NOT NULL REFERENCES bonk_users(bonk_id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS user_sessions_expiry ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS bonk_login_attempts (
    identity_hash TEXT PRIMARY KEY,
    window INTEGER NOT NULL,
    attempts INTEGER NOT NULL
);
