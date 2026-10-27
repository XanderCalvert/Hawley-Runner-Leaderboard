/**
 * MVP data source: parses the "This Week's / Last Week's Leaderboard" table copied from a
 * Strava club page and turns it into the same WeeklySummary shape the Worker produces.
 * No Strava API, no OAuth: it only uses what every club member can already see.
 */

const MI = 1609.344;
const FT = 0.3048;

const ROW = new RegExp(
    [
        '^\\s*(\\d+)',                                  // rank
        '\\s+(.+?)',                                    // athlete (often repeated: avatar alt + name)
        '\\s+([\\d.,]+)\\s*(km|mi)',                    // total distance
        '\\s+(\\d+)',                                   // runs
        '\\s+([\\d.,]+)\\s*(km|mi)',                    // longest run
        '\\s+(?:(?:(\\d+):)?(\\d+):(\\d{2})\\s*\\/(km|mi)|--)', // average pace
        '\\s+(--|[\\d.,]+\\s*(?:m|ft))\\s*$',           // elevation gain
    ].join(''),
);

const toNumber = (value) => Number(String(value).replace(/,/g, ''));
const toMetres = (value, unit) => toNumber(value) * (unit === 'mi' ? MI : 1000);

/** "Matt Calvert Matt Calvert" → "Matt Calvert" (Strava repeats the name in the avatar's alt text). */
export function cleanName(raw) {
    const words = raw.replace(/\s+/g, ' ').trim().split(' ');
    if (words.length % 2 === 0) {
        const half = words.length / 2;
        if (words.slice(0, half).join(' ') === words.slice(half).join(' ')) {
            return words.slice(0, half).join(' ');
        }
    }
    return words.join(' ');
}

function titleCase(word) {
    return word.charAt(0).toLocaleUpperCase('en-GB') + word.slice(1);
}

/** Letters only, title-cased: "Shane Morel🐙🐡" → ["Shane", "Morel"]. */
function nameWords(name) {
    return name
        .replace(/[^\p{L}\s'-]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map(titleCase);
}

/** Public display name, "First L.", matching the full product's privacy rule. */
export function shortName(name) {
    const words = nameWords(name);
    if (!words.length) {
        return 'Runner';
    }
    if (words.length === 1) {
        return words[0];
    }
    return `${words[0]} ${words.at(-1).charAt(0)}.`;
}

/**
 * Which leaderboard was copied: Strava heads the table "This Week's Leaderboard" or "Last Week's Leaderboard".
 * ("Last Week's Leaders", the top-three box above it, is deliberately not matched.)
 */
export function detectWeek(text) {
    const match = String(text).match(/\b(this|last) week['’]s leaderboard\b/i);
    return match ? match[1].toLowerCase() : null;
}

export function parseLeaderboard(text) {
    const rows = [];
    const unreadable = [];
    for (const line of String(text).split(/\r?\n/)) {
        if (!line.trim()) {
            continue;
        }
        const m = line.match(ROW);
        if (!m) {
            // A line starting "<number><tab>" that still didn't parse is worth flagging.
            if (/^\s*\d+\t/.test(line)) {
                unreadable.push(line.trim());
            }
            continue;
        }
        const [, rank, athlete, dist, distUnit, runs, longest, longestUnit, h, min, sec, paceUnit, elev] = m;
        const distanceM = toMetres(dist, distUnit);
        let paceSPerKm = null;
        if (min !== undefined) {
            const perUnit = toNumber(h ?? 0) * 3600 + toNumber(min) * 60 + toNumber(sec);
            paceSPerKm = paceUnit === 'mi' ? perUnit / (MI / 1000) : perUnit;
        }
        let elevationM = 0;
        if (elev !== '--') {
            const value = toNumber(elev.replace(/[^\d.,]/g, ''));
            elevationM = /ft$/.test(elev) ? value * FT : value;
        }
        rows.push({
            rank: Number(rank),
            name: cleanName(athlete),
            distanceM,
            runs: Number(runs),
            longestM: toMetres(longest, longestUnit),
            paceSPerKm,
            // Strava's average pace is moving time ÷ distance, so this recovers moving time (to the second, give or take rounding).
            movingTimeS: paceSPerKm ? Math.round((distanceM / 1000) * paceSPerKm) : 0,
            elevationM,
        });
    }
    return { rows, unreadable };
}
