-- Data minimisation, and a hide list that outlives a disconnect.

-- 1. Keep only the surname initial, never the full surname.
ALTER TABLE athletes ADD COLUMN lastname_initial TEXT;
UPDATE athletes SET lastname_initial = upper(substr(trim(coalesce(lastname, '')), 1, 1));
ALTER TABLE athletes DROP COLUMN lastname;

-- 2. The 10K best effort is not used by any award.
ALTER TABLE activities DROP COLUMN best_10k_s;

-- 3. Hidden runners, keyed by club + Strava athlete ID. Deliberately not tied to athletes or memberships:
--    it is the only thing kept after someone disconnects, so an admin's decision survives a reconnect.
CREATE TABLE hidden (
    club_slug TEXT NOT NULL,
    athlete_id INTEGER NOT NULL,
    hidden_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (club_slug, athlete_id)
);
INSERT INTO hidden (club_slug, athlete_id) SELECT club_slug, athlete_id FROM memberships WHERE status = 'excluded';

-- 4. People who had left their Strava club are now deleted rather than flagged.
DELETE FROM memberships WHERE status = 'left';
DELETE FROM activities WHERE athlete_id NOT IN (SELECT athlete_id FROM memberships);
DELETE FROM athletes WHERE id NOT IN (SELECT athlete_id FROM memberships);

-- 5. Memberships no longer need a status (hiding lives in `hidden`). SQLite cannot drop a column that has a CHECK, so rebuild.
CREATE TABLE memberships_new (
    club_slug TEXT NOT NULL,
    athlete_id INTEGER NOT NULL REFERENCES athletes (id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    verified_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (club_slug, athlete_id)
);
INSERT INTO memberships_new (club_slug, athlete_id, joined_at, verified_at)
    SELECT club_slug, athlete_id, joined_at, verified_at FROM memberships;
DROP TABLE memberships;
ALTER TABLE memberships_new RENAME TO memberships;
