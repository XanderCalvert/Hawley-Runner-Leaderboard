-- Why a runner's last sync failed (cleared by the next good one), so the admin page can say instead of leaving it to the logs.
ALTER TABLE athletes ADD COLUMN sync_error TEXT;
ALTER TABLE athletes ADD COLUMN sync_error_at TEXT;
