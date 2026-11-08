import { expect, it } from 'vitest';
import { countryFromTimezone } from '../src/index.ts';

it('reads the country from a Strava time zone', () => {
    expect(countryFromTimezone('(GMT+00:00) Europe/London')).toBe('GB');
    expect(countryFromTimezone('(GMT+01:00) Europe/Madrid')).toBe('ES');
    expect(countryFromTimezone('Europe/Paris')).toBe('FR');
});

it('says "abroad, unknown country" for a zone we have no country for, and null for no zone', () => {
    expect(countryFromTimezone('(GMT+09:00) Asia/Tokyo')).toBe('XX');
    expect(countryFromTimezone(undefined)).toBeNull();
    expect(countryFromTimezone('')).toBeNull();
});
