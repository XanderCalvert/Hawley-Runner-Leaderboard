/**
 * Works out roughly which country a run was in from the time zone Strava reports for it, e.g. "(GMT+01:00) Europe/Madrid".
 * No coordinates are ever read or kept, just this two-letter code.
 *   null  : no time zone given, so we don't know
 *   "GB"  : the UK (Europe/London, Europe/Belfast)
 *   "XX"  : somewhere outside the UK that we haven't got a country for
 */
const ZONES: Record<string, string> = {
    'Europe/London': 'GB', 'Europe/Belfast': 'GB',
    'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Madrid': 'ES', 'Atlantic/Canary': 'ES', 'Africa/Ceuta': 'ES',
    'Europe/Lisbon': 'PT', 'Atlantic/Madeira': 'PT', 'Atlantic/Azores': 'PT',
    'Europe/Rome': 'IT', 'Europe/Berlin': 'DE', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Luxembourg': 'LU',
    'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT', 'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ', 'Europe/Bratislava': 'SK',
    'Europe/Budapest': 'HU', 'Europe/Zagreb': 'HR', 'Europe/Ljubljana': 'SI', 'Europe/Athens': 'GR', 'Asia/Nicosia': 'CY',
    'Europe/Malta': 'MT', 'Europe/Istanbul': 'TR', 'Atlantic/Reykjavik': 'IS', 'Europe/Oslo': 'NO', 'Europe/Stockholm': 'SE',
    'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI', 'Europe/Tallinn': 'EE', 'Europe/Riga': 'LV', 'Europe/Vilnius': 'LT',
    'Europe/Bucharest': 'RO', 'Europe/Sofia': 'BG', 'Asia/Dubai': 'AE', 'Africa/Johannesburg': 'ZA', 'Pacific/Auckland': 'NZ',
    'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US', 'America/Phoenix': 'US',
    'America/Anchorage': 'US', 'Pacific/Honolulu': 'US', 'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA',
    'America/Halifax': 'CA', 'America/Winnipeg': 'CA', 'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU',
    'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU',
};

export function countryFromTimezone(timezone: string | null | undefined): string | null {
    if (!timezone) {
        return null;
    }
    const zone = timezone.replace(/^\(GMT[^)]*\)\s*/, '').trim();
    return ZONES[zone] ?? 'XX';
}
