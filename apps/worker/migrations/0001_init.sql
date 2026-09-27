-- Athletes who have connected their Strava account. Tokens are AES-GCM encrypted.
CREATE TABLE athletes (
    id INTEGER PRIMARY KEY,
    firstname TEXT,
    lastname TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    scope TEXT NOT NULL,
    connected_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_synced_at TEXT
);

-- One row per athlete per club. Consent is per club: connecting via a club's link opts in to that club only.
-- status: active = on the recap, excluded = hidden by an admin, left = no longer in the Strava club.
CREATE TABLE memberships (
    club_slug TEXT NOT NULL,
    athlete_id INTEGER NOT NULL REFERENCES athletes (id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'excluded', 'left')),
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    verified_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (club_slug, athlete_id)
);

-- Deliberately minimal: no titles, descriptions, maps, locations or heart rate.
CREATE TABLE activities (
    id INTEGER PRIMARY KEY,
    athlete_id INTEGER NOT NULL REFERENCES athletes (id) ON DELETE CASCADE,
    sport_type TEXT NOT NULL,
    start_date_local TEXT NOT NULL,
    distance_m REAL NOT NULL,
    moving_time_s INTEGER NOT NULL,
    elevation_gain_m REAL NOT NULL DEFAULT 0,
    manual INTEGER NOT NULL DEFAULT 0,
    trainer INTEGER NOT NULL DEFAULT 0,
    flagged INTEGER NOT NULL DEFAULT 0,
    best_5k_s INTEGER,
    best_10k_s INTEGER,
    detail_fetched_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX activities_athlete_date ON activities (athlete_id, start_date_local);

-- Small key/value store for operational state (e.g. Strava rate-limit backoff).
CREATE TABLE app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
