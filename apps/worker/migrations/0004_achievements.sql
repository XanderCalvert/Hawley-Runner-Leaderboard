-- Achievements: personal bests Strava ranked on a run, and a lifetime distance baseline per runner.

-- Comma-separated distances where the run was a new personal best (e.g. '5K,10K'). Only from the detailed activity.
ALTER TABLE activities ADD COLUMN pr_efforts TEXT;

-- Strava's lifetime run total minus what we hold from the stored runs: lifetime distance before our first stored run.
-- Refreshed weekly. With it, lifetime distance on any date = base + stored runs before that date.
ALTER TABLE athletes ADD COLUMN lifetime_base_m REAL;
ALTER TABLE athletes ADD COLUMN lifetime_checked_at TEXT;
