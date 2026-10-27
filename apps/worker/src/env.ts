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
    /** Strava API base. Default https://www.strava.com/api/v3; https://api-v3.strava.com is required from 1 Jun 2027. */
    STRAVA_API_BASE?: string;
    /** OAuth host (authorize, token, revoke). Default https://www.strava.com. Only changed to point at a local mock. */
    STRAVA_OAUTH_BASE?: string;
}
