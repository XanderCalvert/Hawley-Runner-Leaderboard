/**
 * The quick recap's second card ("More from the week"): extra awards the leaderboard can support,
 * a club distance trend, new faces and a roll call of everyone who ran.
 */
import { escapeHtml, renderAward, renderHeader } from './card.js';

/** Club distance, this week and up to four before, as a line chart (this week highlighted). */
function renderYtdTrend(trend) {
    const W = 940;
    const H = 150;
    const pad = { l: 20, r: 20, t: 34, b: 26 };
    const km = trend.map((p) => p.distanceM / 1000);
    const max = Math.max(...km) || 1;
    const x = (i) => pad.l + (i * (W - pad.l - pad.r)) / (trend.length - 1);
    const y = (v) => pad.t + (1 - v / (max * 1.05)) * (H - pad.t - pad.b);
    const pts = trend.map((p, i) => ({ ...p, cx: x(i), cy: y(km[i]), km: km[i] }));
    const line = pts.map((p) => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ');
    const peak = pts.reduce((best, p) => (p.km > best.km ? p : best));
    const now = pts.find((p) => p.current) ?? pts.at(-1);
    // The peak and this week get a number; the months along the bottom mark where each starts.
    const labelled = peak === now ? [now] : [peak, now];
    return `
        <section class="rc-award rc-span">
            <h3 class="rc-award__label">Club distance each week (km)</h3>
            <svg class="rc-trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Club distance by week this year">
                <polygon class="rc-trend__area" points="${pad.l},${H - pad.b} ${line} ${W - pad.r},${H - pad.b}"/>
                <polyline class="rc-trend__line" points="${line}"/>
                ${labelled
                    .map(
                        (p) => `
                <circle class="rc-trend__dot${p === now ? ' is-current' : ''}" cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="7"/>
                <text class="rc-trend__val${p === now ? ' is-current' : ''}" x="${Math.min(W - 24, Math.max(24, p.cx)).toFixed(1)}" y="${(p.cy - 14).toFixed(1)}">${Math.round(p.km).toLocaleString('en-GB')}</text>`,
                    )
                    .join('')}
                ${pts
                    .filter((p) => p.label)
                    .map((p) => `<text class="rc-trend__week" x="${Math.min(W - 18, Math.max(18, p.cx)).toFixed(1)}" y="${H - 4}">${escapeHtml(p.label)}</text>`)
                    .join('')}
            </svg>
        </section>`;
}

function renderTrend(trend) {
    if (trend[0]?.ytd) {
        return renderYtdTrend(trend);
    }
    const W = 420;
    const H = 170;
    const pad = { l: 34, r: 34, t: 38, b: 30 };
    const km = trend.map((p) => p.distanceM / 1000);
    const min = Math.min(...km);
    const max = Math.max(...km);
    const span = max - min || 1;
    const x = (i) => pad.l + (i * (W - pad.l - pad.r)) / (trend.length - 1);
    // Not drawn from zero, so a 10% change is visible; the labels carry the real numbers.
    const y = (v) => pad.t + (1 - (v - min + span * 0.1) / (span * 1.2)) * (H - pad.t - pad.b);
    const pts = trend.map((p, i) => ({ ...p, cx: x(i), cy: y(km[i]), km: km[i] }));
    const dots = pts
        .map(
            (p) => `
            <circle class="rc-trend__dot${p.current ? ' is-current' : ''}" cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${p.current ? 9 : 6}"/>
            <text class="rc-trend__val${p.current ? ' is-current' : ''}" x="${p.cx.toFixed(1)}" y="${(p.cy - 16).toFixed(1)}">${Math.round(p.km).toLocaleString('en-GB')}</text>
            <text class="rc-trend__week${p.current ? ' is-current' : ''}" x="${p.cx.toFixed(1)}" y="${H - 6}">${escapeHtml(p.current ? 'This week' : p.label)}</text>`,
        )
        .join('');
    return `
        <section class="rc-award">
            <h3 class="rc-award__label">Club distance (km)</h3>
            <svg class="rc-trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Club distance by week">
                <polyline class="rc-trend__line" points="${pts.map((p) => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ')}"/>
                ${dots}
            </svg>
        </section>`;
}

/** Shrinks the roll call's text until every name fits in the space left on the card. */
export function fitRoll(cardEl) {
    const roll = cardEl.querySelector('.rc-roll');
    if (!roll) {
        return;
    }
    for (const size of ['', 'is-small', 'is-tiny', 'is-micro']) {
        roll.classList.remove('is-small', 'is-tiny', 'is-micro');
        if (size) {
            roll.classList.add(size);
        }
        if (roll.scrollHeight <= roll.clientHeight + 1) {
            return;
        }
    }
}

export function renderExtrasCard(summary, banner = '') {
    const { extras } = summary;
    const branding = summary.club.branding ?? {};
    const tiles = extras.awards.map(renderAward);
    // Keep the grid even: a lone last tile spans both columns.
    if (tiles.length % 2) {
        tiles[tiles.length - 1] = tiles.at(-1).replace('class="rc-award', 'class="rc-award rc-span');
    }
    // The year chart sits on its own full-width row; the short five-week chart is a tile like the others.
    if (extras.trend.length) {
        const trend = renderTrend(extras.trend);
        if (extras.trend[0].ytd) {
            tiles.push(trend);
        } else {
            tiles.push(trend);
            if (tiles.length % 2) {
                tiles[tiles.length - 1] = tiles.at(-1).replace('class="rc-award', 'class="rc-award rc-span');
            }
        }
    }
    const count = extras.rollCall.length;
    const rollSize = count > 70 ? 'is-tiny' : count > 45 ? 'is-small' : '';

    return `
        ${renderHeader(summary, 'More from<br><span>the week</span>', 'rc-title--small')}

        <div class="rc-grid rc-grid--extras">${tiles.join('')}</div>

        <section class="rc-roll ${rollSize}">
            <div class="rc-roll__head">
                <h3 class="rc-award__label">Everyone who ran · ${count}</h3>
                ${extras.newFaces?.length ? `<span class="rc-roll__key"><i></i>Not on last week's board · ${extras.newFaces.length}</span>` : ''}
            </div>
            <p class="rc-names">${extras.rollCall.map((r) => `<span${r.isNew ? ' class="is-new"' : ''}>${escapeHtml(r.name)}</span>`).join('')}</p>
        </section>
${banner}
        <footer class="rc-foot">
            <span class="rc-foot__tag">${escapeHtml(branding.hashtag ?? '')}</span>
            <span>${escapeHtml(branding.footer ?? '')}</span>
            <span class="rc-foot__powered">Data from Strava</span>
        </footer>`;
}
