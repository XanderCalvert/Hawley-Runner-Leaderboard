/**
 * Builds a WeeklySummary (see packages/core/src/types.ts) from parsed leaderboard rows,
 * so the existing card renderer and PNG export work unchanged.
 */
import { shortName } from './leaderboard.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function addDays(date, days) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `date` (YYYY-MM-DD). */
export function mondayOf(date) {
    const d = new Date(`${date}T00:00:00Z`);
    return addDays(date, -((d.getUTCDay() + 6) % 7));
}

function localDate(now) {
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Monday of the week in progress, in the viewer's local time. */
export function currentWeek(now = new Date()) {
    return mondayOf(localDate(now));
}

/** Monday of the last completed week, in the viewer's local time. */
export function lastCompletedWeek(now = new Date()) {
    return addDays(currentWeek(now), -7);
}

/**
 * Best guess at the week a paste covers: the table's own heading if it was copied,
 * otherwise this week on a Sunday (the week's all but done) and last week on any other day.
 */
export function guessWeek(detected, now = new Date()) {
    if (detected === 'this') {
        return currentWeek(now);
    }
    if (detected === 'last') {
        return lastCompletedWeek(now);
    }
    return now.getDay() === 0 ? currentWeek(now) : lastCompletedWeek(now);
}

function shortDate(date) {
    const [, m, d] = date.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]}`;
}

function weekLabel(start) {
    const end = addDays(start, 6);
    const [y1, m1, d1] = start.split('-').map(Number);
    const [y2, m2, d2] = end.split('-').map(Number);
    if (y1 !== y2) {
        return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
    }
    if (m1 !== m2) {
        return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
    }
    return `${d1}–${d2} ${MONTHS[m2 - 1]} ${y2}`;
}

const km1 = (m) => `${(m / 1000).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;

function pace(seconds) {
    const s = Math.round(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /km`;
}

function duration(seconds) {
    const mins = Math.round(seconds / 60);
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

/**
 * Awards available from the leaderboard table. There's no per-run data, so "Fastest 5K" becomes
 * "Quickest average pace" with a minimum weekly distance so a single short blast can't win it.
 */
export function quickAwards(minPaceKm) {
    return [
        { id: 'most-distance', label: 'Most distance', value: (r) => r.distanceM, display: km1 },
        { id: 'longest-run', label: 'Longest run', value: (r) => r.longestM, display: km1 },
        {
            id: 'quickest-pace',
            label: `Quickest pace (${minPaceKm} km+)`,
            value: (r) => (r.paceSPerKm && r.distanceM >= minPaceKm * 1000 ? r.paceSPerKm : null),
            display: pace,
            lowerIsBetter: true,
        },
        { id: 'most-climbing', label: 'Most climbing', value: (r) => r.elevationM, display: (m) => `${Math.round(m).toLocaleString('en-GB')} m` },
        { id: 'most-runs', label: 'Most runs', value: (r) => r.runs, display: (n) => `${n} run${n === 1 ? '' : 's'}` },
        { id: 'time-on-feet', label: 'Most time on feet', value: (r) => r.movingTimeS, display: duration },
    ];
}

/** Same ranking rules as packages/core: shared places for ties, "+N more tied" beyond the podium. */
function rankAward(award, rows, top) {
    const scored = rows
        .map((row) => ({ row, value: award.value(row) }))
        .filter(({ value }) => value !== null && value > 0)
        .sort((a, b) => (award.lowerIsBetter ? a.value - b.value : b.value - a.value) || a.row.displayName.localeCompare(b.row.displayName));

    const entries = [];
    let moreTied = 0;
    let previous = null;
    let rank = 0;
    scored.forEach(({ row, value }, index) => {
        // Compare displayed values, so 10.46 km and 10.54 km aren't "tied" while both reading 10.5 km.
        const shown = award.display(value);
        if (shown !== previous) {
            rank = index + 1;
            previous = shown;
        }
        if (rank > top) {
            return;
        }
        if (entries.length >= top) {
            moreTied++;
            return;
        }
        entries.push({ rank, athleteId: index, name: row.displayName, value, display: shown });
    });
    return { id: award.id, label: award.label, metric: award.id, entries, moreTied };
}

function totals(rows) {
    const active = rows.filter((r) => r.distanceM > 0);
    return {
        runners: active.length,
        runs: active.reduce((sum, r) => sum + r.runs, 0),
        distanceM: active.reduce((sum, r) => sum + r.distanceM, 0),
        movingTimeS: active.reduce((sum, r) => sum + r.movingTimeS, 0),
        elevationM: Math.round(active.reduce((sum, r) => sum + r.elevationM, 0)),
    };
}

const normalise = (name) => name.toLocaleLowerCase('en-GB').replace(/[^\p{L}\s]/gu, '').replace(/\s+/g, ' ').trim();

/** Rows minus hidden runners, with "First L." names (full name where two runners would clash). */
export function prepareRows(rows, hiddenNames = []) {
    const hidden = new Set(hiddenNames.map(normalise).filter(Boolean));
    const visible = rows.filter((r) => !hidden.has(normalise(r.name)));
    const counts = new Map();
    for (const r of visible) {
        const short = shortName(r.name);
        counts.set(short, (counts.get(short) ?? 0) + 1);
    }
    return visible.map((r) => {
        const short = shortName(r.name);
        return { ...r, displayName: counts.get(short) > 1 ? r.name : short };
    });
}

/** Keeps only rows whose full name is on the group's member list (same matching as the hide list). */
export function inGroup(rows, group) {
    if (!group) {
        return rows;
    }
    const members = new Set((group.members ?? []).map(normalise).filter(Boolean));
    return rows.filter((r) => members.has(normalise(r.name)));
}

/** How many of a group's members ran this week (after hiding). */
export function groupRunners(rows, group, hiddenNames = []) {
    return prepareRows(inGroup(rows, group), hiddenNames).filter((r) => r.distanceM > 0).length;
}

/** Awards shown in the group panels on the first card (e.g. "Women's leaders" and "Men's leaders"). */
const SPOTLIGHT_AWARDS = ['most-distance', 'longest-run', 'most-climbing'];

/** Places per award in each group panel: as many as the first card has room for. */
const PANEL_TOP = 7;

/** Overall awards the group panels replace on the first card; the second card carries them instead. */
const MOVED_AWARDS = ['time-on-feet'];

/** Heading for a group's panel: its own `title`, else e.g. "V50 leaders". */
export function spotlightTitle(group) {
    return group.title || `${group.label} leaders`;
}

function buildPanel(id, title, members, minPaceKm, top) {
    const defs = quickAwards(minPaceKm);
    return {
        id,
        title,
        runners: members.length,
        distanceM: members.reduce((sum, r) => sum + r.distanceM, 0),
        awards: SPOTLIGHT_AWARDS.map((awardId) => rankAward(defs.find((a) => a.id === awardId), members, top)),
    };
}

/**
 * Top 3 for a hand-kept group (e.g. women), drawn from the same rows and names as the main card,
 * plus the same for everyone not on that list ("Men's leaders").
 * Uses the first group in the list that has someone on this week's board.
 */
function buildSpotlight(visible, groups, minPaceKm, top) {
    for (const g of groups ?? []) {
        const members = inGroup(visible, g).filter((r) => r.distanceM > 0);
        if (!members.length) {
            continue;
        }
        const listed = new Set(members.map((r) => r.name));
        const rest = visible.filter((r) => r.distanceM > 0 && !listed.has(r.name));
        return {
            spotlight: buildPanel(g.id, spotlightTitle(g), members, minPaceKm, top),
            // ponytail: "everyone else" stands in for a men's list, so a new woman not yet ticked shows here until she's ticked.
            rest: rest.length ? buildPanel('rest', "Men's leaders", rest, minPaceKm, top) : null,
        };
    }
    return { spotlight: null, rest: null };
}

/**
 * `group` (optional) narrows everything, including last week's comparison, to a members list,
 * e.g. { id: 'women', label: 'Women', members: ['Full Name', …] }.
 * `groups` (optional) adds a top-3 panel for the first group with runners this week to the second card.
 */
export function buildQuickSummary({ club, rows, previousRows = [], history = [], weekStart, hiddenNames = [], minPaceKm = 10, top = 5, group = null, groups = [] }) {
    const visible = prepareRows(inGroup(rows, group), hiddenNames);
    const previous = prepareRows(inGroup(previousRows, group), hiddenNames);
    const { spotlight, rest } = group ? { spotlight: null, rest: null } : buildSpotlight(visible, groups, minPaceKm, PANEL_TOP);
    const awards = quickAwards(minPaceKm);
    // With group panels on the first card, the overall awards they displace move to the second.
    const moved = spotlight ? awards.filter((a) => MOVED_AWARDS.includes(a.id)) : [];
    return {
        version: 1,
        source: 'leaderboard',
        club,
        audience: group ? { id: group.id, label: group.label } : null,
        week: {
            start: weekStart,
            end: addDays(weekStart, 6),
            label: weekLabel(weekStart),
            year: Number(addDays(weekStart, 6).slice(0, 4)),
        },
        generatedAt: new Date().toISOString(),
        group: {
            week: totals(visible),
            previousWeek: totals(previous),
            // The leaderboard only covers one week, so there's no year-to-date panel in the MVP.
            ytd: null,
        },
        awards: awards.map((award) => rankAward(award, visible, top)),
        milestones: [],
        spotlight,
        rest,
        extras: buildExtras({ visible, previous, minPaceKm, top, moved, trend: buildTrend(history, visible, weekStart, group, hiddenNames) }),
    };
}

/** Club distance for the weeks before this one (those with data) and this week, oldest first. */
function buildTrend(history, visible, weekStart, group, hiddenNames) {
    const past = history
        .map((h) => ({ weekStart: h.weekStart, distanceM: totals(prepareRows(inGroup(h.rows, group), hiddenNames)).distanceM }))
        .filter((w) => w.distanceM > 0);
    const points = [...past, { weekStart, distanceM: totals(visible).distanceM }];
    return points.length > 1
        ? points.map((w) => ({ label: shortDate(w.weekStart), distanceM: w.distanceM, current: w.weekStart === weekStart }))
        : [];
}

/** The second card: more ways to get a mention, plus the whole club. */
function buildExtras({ visible, previous, minPaceKm, top, moved = [], trend = [] }) {
    const active = visible.filter((r) => r.distanceM > 0);
    const lastWeek = new Map(previous.filter((r) => r.distanceM > 0).map((r) => [normalise(r.name), r]));
    const hasHistory = lastWeek.size > 0;

    const awards = [
        ...moved,
        {
            id: 'average-run',
            label: 'Longest average run',
            value: (r) => (r.runs >= 2 ? r.distanceM / r.runs : null),
            display: km1,
        },
        {
            id: 'hill-seeker',
            label: `Hill seeker (${minPaceKm} km+)`,
            value: (r) => (r.distanceM >= minPaceKm * 1000 && r.elevationM > 0 ? r.elevationM / (r.distanceM / 1000) : null),
            display: (v) => `${v.toLocaleString('en-GB', { maximumFractionDigits: 1 })} m/km`,
        },
    ];
    if (minPaceKm > 5) {
        awards.push({
            id: 'short-pace',
            label: `Quickest pace (5–${minPaceKm} km)`,
            value: (r) => (r.paceSPerKm && r.distanceM >= 5000 && r.distanceM < minPaceKm * 1000 ? r.paceSPerKm : null),
            display: pace,
            lowerIsBetter: true,
        });
    }
    if (hasHistory) {
        awards.push({
            id: 'step-up',
            label: 'Biggest step up',
            value: (r) => {
                const before = lastWeek.get(normalise(r.name));
                return before ? r.distanceM - before.distanceM : null;
            },
            display: (m) => `+${km1(m)}`,
        });
    }

    const byName = (a, b) => a.displayName.localeCompare(b.displayName, 'en-GB');
    return {
        awards: awards.map((award) => rankAward(award, active, top)),
        trend,
        // Only meaningful when last week's board is known.
        newFaces: hasHistory ? active.filter((r) => !lastWeek.has(normalise(r.name))).sort(byName).map((r) => r.displayName) : null,
        rollCall: [...active].sort(byName).map((r) => ({
            name: r.displayName,
            isNew: hasHistory && !lastWeek.has(normalise(r.name)),
        })),
    };
}
