export interface Env {
    DB: D1Database;
    STRAVA_CLIENT_ID: string;
    STRAVA_CLIENT_SECRET: string;
    STRAVA_VERIFY_TOKEN: string;
    STRAVA_SUBSCRIPTION_ID?: string;
    APP_SECRET: string;
    ADMIN_TOKEN: string;
    WEB_BASE_URL: string;
    ALLOWED_ORIGINS: string;
    /** Test-only override for https://www.strava.com (e.g. a local mock). */
    STRAVA_BASE_URL?: string;
}
