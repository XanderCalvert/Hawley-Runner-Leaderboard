-- Manual approval for people who are not in the club's Strava club.
--   member  : verified in the Strava club (checked weekly). The default, so existing rows are unchanged.
--   pending : asked to join but not approved. We keep only their name, ID and token: no runs are fetched or shown.
--   guest   : approved by an admin although not in the Strava club. Never removed by the weekly club check.
ALTER TABLE memberships ADD COLUMN approval TEXT NOT NULL DEFAULT 'member';
