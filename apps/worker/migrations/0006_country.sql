-- Which country a run was in, worked out from Strava's time zone for the activity (never a location).
-- NULL = unknown (older rows, or Strava gave no time zone): treated as "not abroad".
ALTER TABLE activities ADD COLUMN country TEXT;
