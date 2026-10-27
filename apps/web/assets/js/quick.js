/**
 * Paste page for the quick recap. Two modes:
 * - Archive mode (served by `python scripts/recap.py serve`): Save writes recaps/<week>/leaderboard.csv
 *   and the app builds the PNGs and caption there. Settings and last week's data come from the archive.
 * - Standalone (GitHub Pages or any static server): Save downloads the CSV; PNGs download from the browser.
 */
import { applyBrand, clubSlug, fetchClub } from './api.js';
import { applyCardTheme, renderCard } from './card.js';
import { detectWeek, parseLeaderboard } from './leaderboard.js';
import { fromCsv, toCsv } from './leaderboard-csv.js';
import { buildCaption } from './quick-caption.js';
import { fitRoll, renderExtrasCard } from './quick-card.js';
import { addDays, buildQuickSummary, groupRunners, guessWeek, mondayOf, spotlightTitle } from './quick-summary.js';

window.quickLoaded = true;
/** The "What's happening" panel at the bottom of the page (set up by a plain script in quick.html). */
const debug = window.quickDebug ?? { set() {}, clear() {} };
debug.set('loaded', 'good', "The page's code is running.");

const $ = (id) => document.getElementById(id);
const card = $('card');
const card2 = $('card2');
const previews = [
    [$('preview'), $('scaler')],
    [$('preview2'), $('scaler2')],
];
const statusEl = $('status');
const resultEl = $('result');
const inputs = {
    paste: $('paste'),
    week: $('week'),
    places: $('places'),
    minPace: $('min-pace'),
    hidden: $('hidden'),
    caption: $('caption'),
    load: $('load'),
};
const buttons = { save: $('save'), download: $('download'), download2: $('download2'), copy: $('copy') };
const groupsEl = $('groups');
const audienceEl = $('audience');

let archive = false;
let club = null;
let current = null;
let currentRows = [];
/** Once someone picks a week by hand, stop guessing it from the paste (until the next paste). */
let weekChosen = false;
/**
 * Hand-kept lists such as who goes on the women's recap: [{ id, label, members: ['Full Name', …] }].
 * Nobody is added automatically; only names ticked on this page are included.
 */
let groups = [{ id: 'women', label: 'Women', title: "Women's leaders", members: [] }];
/** Which recap the preview shows: 'all' or a group id. */
let audience = 'all';
/** Week start → rows, for week-on-week. Filled from the archive or from loaded CSVs. */
const weeks = new Map();

/* ---------- Local storage: standalone-mode conveniences only ---------- */

const storeKey = `club-recap:quick:${clubSlug}`;

function readStore() {
    try {
        return JSON.parse(localStorage.getItem(storeKey)) ?? {};
    } catch {
        return {};
    }
}

function writeStore(patch) {
    try {
        localStorage.setItem(storeKey, JSON.stringify({ ...readStore(), ...patch }));
    } catch {
        // Private window or storage disabled.
    }
}

/* ---------- Archive API (scripts/recap.py) ---------- */

async function api(path, options = {}) {
    const response = await fetch(`api/${path}`, options);
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${response.status})`);
    }
    return response;
}

async function detectArchive() {
    try {
        const status = await (await api('status')).json();
        return status.ok === true;
    } catch {
        return false;
    }
}

async function weekRows(week) {
    if (weeks.has(week)) {
        return weeks.get(week);
    }
    if (!archive) {
        return [];
    }
    try {
        const { rows } = fromCsv(await (await api(`weeks/${week}`)).text());
        weeks.set(week, rows);
        return rows;
    } catch {
        weeks.set(week, []);
        return [];
    }
}

let settingsTimer;
function saveSettings() {
    const settings = {
        hidden: hiddenNames(),
        groups,
        minPaceKm: Number(inputs.minPace.value) || 0,
        places: Number(inputs.places.value) || 5,
    };
    if (!archive) {
        writeStore({ settings });
        return;
    }
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(async () => {
        try {
            await api('settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
            $('settings-note').textContent = 'Saved to recaps/settings.json.';
            debug.clear('settings-save');
        } catch (error) {
            $('settings-note').textContent = `Couldn't save settings: ${error.message}`;
            debug.set('settings-save', 'bad', `Couldn't save the settings (hide list, women's list): ${error.message}. Is the black window still open?`);
        }
    }, 500);
}

function applySettings(settings = {}) {
    if (Array.isArray(settings.hidden)) {
        inputs.hidden.value = settings.hidden.join('\n');
    }
    if (settings.minPaceKm !== undefined) {
        inputs.minPace.value = settings.minPaceKm;
    }
    if (settings.places) {
        inputs.places.value = String(settings.places);
    }
    if (Array.isArray(settings.groups) && settings.groups.length) {
        groups = settings.groups.map((g) => ({ id: g.id, label: g.label, title: g.title, members: [...(g.members ?? [])] }));
    }
}

/* ---------- Groups (e.g. the women's recap) ---------- */

const fold = (name) => name.toLocaleLowerCase('en-GB').replace(/\s+/g, ' ').trim();

function selectedGroup() {
    return groups.find((g) => g.id === audience) ?? null;
}

function setMember(group, name, on) {
    const others = group.members.filter((m) => fold(m) !== fold(name));
    group.members = on ? [...others, name].sort((a, b) => a.localeCompare(b, 'en-GB')) : others;
    saveSettings();
    scheduleRender();
}

function checkbox(group, name, checked, absent) {
    const label = document.createElement('label');
    if (absent) {
        label.className = 'is-absent';
    }
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => setMember(group, name, input.checked));
    label.append(input, document.createTextNode(name));
    return label;
}

/** One tick list per group: this week's runners, plus anyone already on the list who isn't on this board. */
function renderGroups(rows) {
    const scroll = [...groupsEl.querySelectorAll('.checks')].map((el) => el.scrollTop);
    const hidden = new Set(hiddenNames().map(fold));
    const names = [...new Set(rows.map((r) => r.name))]
        .filter((n) => !hidden.has(fold(n)))
        .sort((a, b) => a.localeCompare(b, 'en-GB'));
    const onBoard = new Set(names.map(fold));

    groupsEl.replaceChildren(
        ...groups.map((group) => {
            const members = new Set(group.members.map(fold));
            const section = document.createElement('section');
            section.className = 'group';
            const ran = names.filter((n) => members.has(fold(n))).length;
            section.innerHTML = `
                <h3></h3>
                <p class="small" style="margin: 0">
                    Tick the runners for the <span class="g-title"></span> panel on the second card.
                    Nothing is guessed: only the people you tick are included, and the list is remembered for next week.
                    <strong class="g-count"></strong>
                </p>`;
            section.querySelector('h3').textContent = `${group.label} list`;
            section.querySelector('.g-title').textContent = `"${spotlightTitle(group)}"`;
            section.querySelector('.g-count').textContent = `${group.members.length} on the list, ${ran} on this week's board.`;
            const checks = document.createElement('div');
            checks.className = 'checks';
            checks.append(...names.map((n) => checkbox(group, n, members.has(fold(n)), false)));
            const away = group.members.filter((m) => !onBoard.has(fold(m)));
            if (away.length) {
                const divider = document.createElement('p');
                divider.className = 'checks__divider';
                divider.textContent = 'On the list, not on this board';
                checks.append(divider, ...away.map((m) => checkbox(group, m, true, true)));
            }
            if (!names.length && !away.length) {
                checks.innerHTML = '<p class="small" style="margin: 4px 0">Paste a leaderboard to pick runners.</p>';
            }
            section.append(checks);
            return section;
        }),
    );
    groupsEl.querySelectorAll('.checks').forEach((el, i) => (el.scrollTop = scroll[i] ?? 0));
}

/** Everyone / Women / … switch above the preview. */
function renderAudience(rows) {
    if (!groups.length) {
        audienceEl.hidden = true;
        return;
    }
    if (audience !== 'all' && !groups.some((g) => g.id === audience)) {
        audience = 'all';
    }
    const options = [{ id: 'all', label: 'Everyone' }, ...groups];
    audienceEl.replaceChildren(
        ...options.map((option) => {
            const button = document.createElement('button');
            button.type = 'button';
            const count = option.id === 'all' ? null : groupRunners(rows, option, hiddenNames());
            button.textContent = count === null ? option.label : `${option.label} · ${count}`;
            button.setAttribute('aria-pressed', String(option.id === audience));
            button.addEventListener('click', () => {
                audience = option.id;
                render();
            });
            return button;
        }),
    );
    audienceEl.hidden = !rows.length;
}

/* ---------- Rendering ---------- */

function fitPreview() {
    for (const [preview, scaler] of previews) {
        const scale = preview.clientWidth / 1080;
        scaler.style.transform = `scale(${scale})`;
        preview.style.height = `${1350 * scale}px`;
    }
}

function hiddenNames() {
    return inputs.hidden.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function setReady(ready) {
    Object.values(buttons).forEach((b) => (b.disabled = !ready));
}

/* ---------- Debug panel reports ---------- */

function reportPaste(rows, unreadable, detected) {
    const text = inputs.paste.value.trim();
    if (!text) {
        debug.set('paste', 'info', 'Waiting for you to paste the leaderboard into box 1.');
        ['week', 'unreadable', 'previous', 'groups'].forEach((k) => debug.clear(k));
        return;
    }
    if (!rows.length) {
        const sample = text.split(/\r?\n/).slice(0, 6).join('\n');
        debug.set(
            'paste',
            'bad',
            "Couldn't find any runners in what was pasted. Go back to Strava and select from the \"Last Week's Leaderboard\" heading down to the last runner, so the rank numbers, names and distances are all included, then copy and paste again. The start of what was pasted:",
            sample,
        );
        debug.clear('unreadable');
        return;
    }
    debug.set('paste', 'good', `Read ${rows.length} runners from the paste.`);
    if (unreadable.length) {
        debug.set(
            'unreadable',
            'warn',
            `${unreadable.length} line(s) looked like runners but couldn't be read, so they're left out. If someone's missing, check these:`,
            unreadable.slice(0, 8).join('\n'),
        );
    } else {
        debug.clear('unreadable');
    }
    if (weekChosen) {
        debug.set('week', 'info', `Week picked by hand: starting ${inputs.week.value}.`);
    } else if (detected) {
        debug.set('week', 'good', `Week taken from the "${detected === 'this' ? 'This' : 'Last'} Week's Leaderboard" heading: starting ${inputs.week.value}.`);
    } else {
        debug.set('week', 'warn', `No leaderboard heading in the paste, so the week (${inputs.week.value}) is a guess from today's date. Check "Week starting" is right, or copy again including the heading.`);
    }
}

function reportGroups(rows) {
    const notes = groups.map((g) => `${g.label}: ${g.members.length} on the list, ${groupRunners(rows, g, hiddenNames())} ran this week`);
    const empty = groups.filter((g) => !g.members.length);
    if (empty.length) {
        debug.set('groups', 'warn', `${notes.join('; ')}. Nobody is ticked for ${empty.map((g) => `"${spotlightTitle(g)}"`).join(' / ')} yet, so the Men's and Women's leaders won't appear on the first card. Tick names in Settings.`);
    } else if (current?.spotlight) {
        debug.set('groups', 'good', `${notes.join('; ')}. "${current.spotlight.title}" and "Men's leaders" are on the first card; anyone not ticked shows as a man.`);
    } else {
        debug.set('groups', 'info', `${notes.join('; ')}. Nobody on the list ran this week, so there's no panel.`);
    }
}

let renderToken = 0;
async function render() {
    if (!club) {
        return;
    }
    const token = ++renderToken;
    const detected = detectWeek(inputs.paste.value);
    if (!weekChosen) {
        inputs.week.value = guessWeek(detected);
    }
    const weekStart = mondayOf(inputs.week.value || guessWeek(detected));
    const { rows, unreadable } = parseLeaderboard(inputs.paste.value);
    currentRows = rows;
    resultEl.textContent = '';

    renderGroups(rows);
    audienceEl.hidden = true;

    reportPaste(rows, unreadable, detected);

    if (!rows.length) {
        current = null;
        setReady(false);
        card.innerHTML = '<p class="empty">Paste the leaderboard to see the cards.</p>';
        card2.innerHTML = '';
        inputs.caption.value = '';
        statusEl.textContent = inputs.paste.value.trim()
            ? "Couldn't find any leaderboard rows in that. Copy the whole table, including the rank numbers."
            : '';
        return;
    }

    // The four weeks before this one, oldest first, for the club distance chart.
    const history = await Promise.all(
        [4, 3, 2, 1].map(async (n) => {
            const start = addDays(weekStart, -7 * n);
            return { weekStart: start, rows: await weekRows(start) };
        }),
    );
    const previous = history.at(-1).rows;
    if (token !== renderToken) {
        return; // A newer render started while we waited.
    }
    if (previous.length) {
        debug.set('previous', 'good', `Found the week before (${addDays(weekStart, -7)}), so week-on-week changes and "Biggest step up" are included.`);
    } else {
        debug.set('previous', 'info', `No saved week before (${addDays(weekStart, -7)}), so there's no week-on-week change or "Biggest step up" this time. That's fine.`);
    }
    const top = Number(inputs.places.value) || 5;
    const group = selectedGroup();
    current = buildQuickSummary({
        group,
        groups: groups.filter((g) => g.members.length),
        club,
        rows,
        previousRows: previous,
        history,
        weekStart,
        hiddenNames: hiddenNames(),
        minPaceKm: Math.max(0, Number(inputs.minPace.value) || 0),
        top,
    });
    for (const el of [card, card2]) {
        applyCardTheme(el, club.branding);
        el.classList.toggle('is-compact', top > 3);
    }
    try {
        card.innerHTML = renderCard(current);
        card2.innerHTML = renderExtrasCard(current);
        fitRoll(card2);
        document.fonts.ready.then(() => fitRoll(card2));
        inputs.caption.value = buildCaption(current);
        debug.clear('render');
    } catch (error) {
        debug.set('render', 'bad', `The data was read but drawing the cards failed: ${error.message}. Use Copy details and send it over.`, error.stack ?? '');
        throw error;
    }
    setReady(true);
    reportGroups(rows);

    let source = "Week guessed from today's date: check it.";
    if (weekChosen) {
        source = 'Week chosen by hand.';
    } else if (detected) {
        source = `Week taken from the "${detected === 'this' ? 'This' : 'Last'} Week's Leaderboard" heading.`;
    }
    const notes = [
        group
            ? `${current.week.label}, ${group.label}'s recap: ${current.group.week.runners} runners from the list.`
            : `${current.week.label}: ${current.group.week.runners} runners, ${rows.length - current.group.week.runners} hidden or on 0 km.`,
        source,
        previous.length ? 'Compared with the week before.' : 'No data for the week before, so no week-on-week change.',
    ];
    if (unreadable.length) {
        notes.push(`${unreadable.length} row(s) couldn't be read: ${unreadable.slice(0, 2).join(' | ')}`);
    }
    statusEl.textContent = notes.join(' ');
}

let timer;
const scheduleRender = () => {
    clearTimeout(timer);
    timer = setTimeout(render, 150);
};

/* ---------- Actions ---------- */

async function save() {
    if (!current) {
        return;
    }
    const weekStart = current.week.start;
    const csv = toCsv(currentRows, weekStart);
    if (!archive) {
        const link = document.createElement('a');
        link.download = `${clubSlug}-${weekStart}.csv`;
        link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        weeks.set(weekStart, currentRows);
        resultEl.textContent = 'CSV downloaded. To file it and build the PNGs: python scripts/recap.py add <the file>';
        return;
    }
    buttons.save.disabled = true;
    resultEl.classList.remove('is-error');
    resultEl.textContent = 'Saving and building the PNGs…';
    try {
        const response = await api(`weeks/${weekStart}`, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv });
        const body = await response.json();
        weeks.set(weekStart, currentRows);
        const lines = [`Saved to ${body.folder}`, ...body.files.map((f) => `• ${f}`)];
        if (body.warnings?.length) {
            lines.push('', 'Check:', ...body.warnings.map((w) => `• ${w}`));
        }
        resultEl.textContent = lines.join('\n');
        debug.set('save', body.warnings?.length ? 'warn' : 'good', `Saved and built ${body.files.length} file(s) in ${body.folder}.${body.warnings?.length ? ' Some things to check:' : ''}`, (body.warnings ?? []).join('\n'));
    } catch (error) {
        resultEl.classList.add('is-error');
        resultEl.textContent = `Save failed: ${error.message}`;
        debug.set('save', 'bad', `Save failed: ${error.message}. If it says "Failed to fetch", the black window has been closed: double-click Weekly recap.bat again.`);
    } finally {
        buttons.save.disabled = false;
    }
}

async function download(el, button, name) {
    if (!current) {
        return;
    }
    button.disabled = true;
    try {
        await document.fonts.ready;
        const dataUrl = await window.htmlToImage.toPng(el, {
            width: 1080,
            height: 1350,
            pixelRatio: 1,
            cacheBust: true,
            style: { transform: 'none' },
        });
        const link = document.createElement('a');
        const suffix = current.audience ? `-${current.audience.id}` : '';
        link.download = `${clubSlug}-${name}${suffix}-${current.week.start}.png`;
        link.href = dataUrl;
        link.click();
    } catch (error) {
        statusEl.textContent = `Export failed: ${error.message}`;
    } finally {
        button.disabled = false;
    }
}

async function loadFiles(files) {
    const loaded = [];
    for (const file of files) {
        try {
            const text = await file.text();
            let weekStart;
            let rows;
            if (/\.json$/i.test(file.name)) {
                const data = JSON.parse(text);
                ({ weekStart, rows } = data);
            } else {
                ({ weekStart, rows } = fromCsv(text));
            }
            if (weekStart && rows?.length) {
                weeks.set(mondayOf(weekStart), rows);
                loaded.push(weekStart);
            }
        } catch {
            // Not one of ours; skip it.
        }
    }
    statusEl.textContent = loaded.length ? `Loaded ${loaded.join(', ')}.` : "Those files weren't saved weeks.";
    render();
}

/* ---------- Wiring ---------- */

inputs.paste.addEventListener('paste', () => {
    weekChosen = false;
});
inputs.paste.addEventListener('input', scheduleRender);
inputs.week.addEventListener('change', () => {
    weekChosen = Boolean(inputs.week.value);
    if (inputs.week.value) {
        inputs.week.value = mondayOf(inputs.week.value);
    }
    render();
});
for (const el of [inputs.places, inputs.minPace, inputs.hidden]) {
    el.addEventListener('input', () => {
        saveSettings();
        scheduleRender();
    });
}
inputs.load.addEventListener('change', () => loadFiles([...inputs.load.files]));
buttons.save.addEventListener('click', save);
buttons.download.addEventListener('click', () => download(card, buttons.download, 'recap'));
buttons.download2.addEventListener('click', () => download(card2, buttons.download2, 'more'));
buttons.copy.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(inputs.caption.value);
        statusEl.textContent = 'Caption copied.';
    } catch {
        inputs.caption.select();
        statusEl.textContent = 'Press Ctrl+C to copy.';
    }
});

inputs.week.value = guessWeek(null);
previews.forEach(([preview]) => new ResizeObserver(fitPreview).observe(preview));
fitPreview();

archive = await detectArchive();
const modeEl = $('mode');
try {
    if (archive) {
        modeEl.textContent = 'Recap app connected: Save files the week and builds the PNGs';
        debug.set('app', 'good', 'Connected to the recap app (the black window). "Save and build PNGs" will put everything in the recaps folder.');
        modeEl.classList.add('is-archive');
        buttons.save.textContent = 'Save and build PNGs';
        $('png-actions').hidden = true;
        $('history-panel').hidden = true;
        club = await (await api('club')).json();
        applySettings(await (await api('settings')).json());
    } else {
        modeEl.textContent = 'Standalone: Save downloads a CSV';
        debug.set(
            'app',
            'warn',
            'Not connected to the recap app, so Save only downloads a CSV and no PNGs are built in the recaps folder. To fix: close this tab, double-click "Weekly recap.bat" and keep its black window open.',
        );
        club = await fetchClub();
        const stored = readStore();
        applySettings(stored.settings);
        // Older versions kept weeks in the browser; still use them for week-on-week.
        for (const [week, rows] of Object.entries(stored.weeks ?? {})) {
            weeks.set(week, rows);
        }
    }
    applyBrand(club);
    debug.set('settings', 'good', `Settings loaded: ${hiddenNames().length} hidden, ${groups.map((g) => `${g.members.length} on the ${g.label} list`).join(', ') || 'no groups'}.`);
    render();
} catch (error) {
    statusEl.textContent = `Couldn't load the club settings: ${error.message}`;
    debug.set('settings', 'bad', `Couldn't load the club settings: ${error.message}`);
}
