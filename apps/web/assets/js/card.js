/**
 * Renders a WeeklySummary (from the Worker or /sample) into the recap card markup.
 * Pure string templating: no framework, and every value from the API is escaped.
 */

const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const safeColour = (value, fallback) => (/^#[0-9a-f]{3,8}$/i.test(value ?? '') ? value : fallback);

function number(value, locale, digits = 0) {
    return Number(value).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function km(metres, locale, digits = 0) {
    return number(metres / 1000, locale, digits);
}

function hours(seconds, locale) {
    return number(Math.round(seconds / 3600), locale);
}

function delta(current, previous) {
    if (!previous) {
        return '';
    }
    const change = Math.round(((current - previous) / previous) * 100);
    if (change === 0) {
        return 'Same as last week';
    }
    return `${change > 0 ? '▲' : '▼'} ${Math.abs(change)}% on last week`;
}

/** ISO week number, e.g. 2026-09-21 → 39. */
function isoWeek(date) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - firstThursday) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

function renderAward(award) {
    const [first, ...rest] = award.entries;
    if (!first) {
        return `
            <section class="rc-award">
                <h3 class="rc-award__label">${escapeHtml(award.label)}</h3>
                <p class="rc-empty">Up for grabs next week</p>
            </section>`;
    }
    const tied = (entry) => award.entries.filter((e) => e.rank === entry.rank).length > 1 || (award.moreTied > 0 && entry === award.entries.at(-1));
    const row = (entry, extraClass = '') => `
        <li class="${extraClass}">
            <span class="rc-rank">${tied(entry) ? '=' : ''}${entry.rank}</span>
            <span class="rc-name">${escapeHtml(entry.name)}</span>
            <span class="rc-value">${escapeHtml(entry.display)}</span>
        </li>`;
    const more = award.moreTied > 0 ? `<p class="rc-more">+${award.moreTied} more tied</p>` : '';
    return `
        <section class="rc-award">
            <h3 class="rc-award__label">${escapeHtml(award.label)}</h3>
            <ol class="rc-podium">
                ${row(first, 'is-first')}
                ${rest.map((entry) => row(entry)).join('')}
            </ol>
            ${more}
        </section>`;
}

function renderYtd(summary, locale) {
    const { ytd } = summary.group;
    const goalKm = ytd.goalKm;
    const doneKm = ytd.distanceM / 1000;
    const pct = goalKm ? Math.min(100, Math.round((doneKm / goalKm) * 100)) : null;
    const goal = goalKm
        ? `<div class="rc-goal">
                <div class="rc-goal__track" role="img" aria-label="${pct}% of the ${number(goalKm, locale)} km goal">
                    <div class="rc-goal__fill" style="width: ${pct}%"></div>
                </div>
                <p class="rc-goal__label">${pct}% of our ${number(goalKm, locale)} km goal</p>
            </div>`
        : '';
    return `
        <section class="rc-ytd">
            <h3 class="rc-ytd__label">${summary.week.year} so far</h3>
            <div class="rc-ytd__distance">${km(ytd.distanceM, locale)}<small>km</small></div>
            <div class="rc-ytd__meta">
                ${number(ytd.runs, locale)} runs · ${number(ytd.elevationM, locale)} m climbed · ${hours(ytd.movingTimeS, locale)} hrs
            </div>
            ${goal}
        </section>`;
}

export function applyCardTheme(card, branding = {}) {
    const map = {
        '--c-bg': branding.background,
        '--c-surface': branding.surface,
        '--c-text': branding.text,
        '--c-muted': branding.muted,
        '--c-primary': branding.primary,
        '--c-accent': branding.accent,
    };
    for (const [prop, value] of Object.entries(map)) {
        if (value) {
            card.style.setProperty(prop, safeColour(value, ''));
        }
    }
}

export function renderCard(summary) {
    const locale = summary.club.locale || 'en-GB';
    const { week, previousWeek } = summary.group;
    const branding = summary.club.branding ?? {};
    const logo = branding.logo ? `<img class="rc-logo" src="${escapeHtml(branding.logo)}" alt="">` : '';

    const milestones = summary.milestones?.length
        ? `<div class="rc-milestones"><strong>Milestones</strong>
                <span>${summary.milestones
                    .slice(0, 4)
                    .map((m) => `${escapeHtml(m.name)} passed ${number(m.km, locale)} km`)
                    .join(' · ')}</span>
            </div>`
        : '';

    return `
        <header class="rc-head">
            <div>
                <p class="rc-club">${escapeHtml(summary.club.name)}</p>
                <h2 class="rc-title">Weekly<br><span>Recap</span></h2>
                <p class="rc-week">${escapeHtml(summary.week.label)}</p>
            </div>
            ${logo || `<div class="rc-weekno" aria-label="Week ${isoWeek(summary.week.start)}"><small>Week</small>${isoWeek(summary.week.start)}</div>`}
        </header>

        <div class="rc-stats">
            <div class="rc-stat">
                <span class="rc-stat__value">${km(week.distanceM, locale, week.distanceM < 1_000_000 ? 1 : 0)}<small>km</small></span>
                <span class="rc-stat__label">Distance</span>
                <span class="rc-stat__delta">${delta(week.distanceM, previousWeek.distanceM)}</span>
            </div>
            <div class="rc-stat">
                <span class="rc-stat__value">${number(week.runs, locale)}</span>
                <span class="rc-stat__label">Runs</span>
                <span class="rc-stat__delta">${delta(week.runs, previousWeek.runs)}</span>
            </div>
            <div class="rc-stat">
                <span class="rc-stat__value">${number(week.runners, locale)}</span>
                <span class="rc-stat__label">Runners</span>
                <span class="rc-stat__delta">${hours(week.movingTimeS, locale)} hrs on feet</span>
            </div>
            <div class="rc-stat">
                <span class="rc-stat__value">${number(week.elevationM, locale)}<small>m</small></span>
                <span class="rc-stat__label">Climbed</span>
                <span class="rc-stat__delta">${delta(week.elevationM, previousWeek.elevationM)}</span>
            </div>
        </div>

        <div class="rc-grid">
            ${summary.awards.slice(0, 5).map(renderAward).join('')}
            ${renderYtd(summary, locale)}
        </div>

        ${milestones}

        <footer class="rc-foot">
            <span class="rc-foot__tag">${escapeHtml(branding.hashtag ?? '')}</span>
            <span>${escapeHtml(branding.footer ?? '')}</span>
            <span class="rc-foot__powered">Data from Strava</span>
        </footer>`;
}
