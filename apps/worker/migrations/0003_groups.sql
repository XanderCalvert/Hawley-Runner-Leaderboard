-- Admin-assigned group per club member (e.g. 'women'), used for the Men's / Women's leaders panels.
-- Lives on the membership, so disconnecting deletes it with everything else about the runner.
ALTER TABLE memberships ADD COLUMN group_id TEXT;
