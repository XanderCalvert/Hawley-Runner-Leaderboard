// Prints a random 32-byte secret, base64url-encoded. Use for APP_SECRET, ADMIN_TOKEN and STRAVA_VERIFY_TOKEN.
import { randomBytes } from 'node:crypto';

console.log(randomBytes(32).toString('base64url'));
