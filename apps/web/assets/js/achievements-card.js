/**
 * The third card, "Achievements": personal bests set this week, lifetime distance milestones and running streaks.
 * Same header, tiles and footer as the other two cards.
 */
import { escapeHtml, renderAward, renderHeader } from './card.js';

const MAX_LINES = 8;

/** A tile of plain lines (name on the left, detail on the right), or an encouraging empty state. */
function renderList(label, lines, empty) {
    if (!lines.length) {
        return `
            <section class="rc-award">
                <h3 class="rc-award__label">${escapeHtml(label)}</h3>
                <p class="rc-empty">${escapeHtml(empty)}</p>
            </section>`;
    }
    const shown = lines.slice(0, MAX_LINES);
    const more = lines.length - shown.length;
    return `
        <section class="rc-award">
            <h3 class="rc-award__label">${escapeHtml(label)}</h3>
            <ol class="rc-podium">
                ${shown
                    .map(
                        (line) => `
                <li>
                    <span class="rc-rank">★</span>
                    <span class="rc-name">${escapeHtml(line.name)}</span>
                    <span class="rc-value">${escapeHtml(line.detail)}</span>
                </li>`,
                    )
                    .join('')}
            </ol>
            ${more > 0 ? `<p class="rc-more">+${more} more</p>` : ''}
        </section>`;
}

const km = (value) => `${value.toLocaleString('en-GB')} km`;

/** Names for a banner line: up to two, then "+N". */
const names = (list) => (list.length > 2 ? `${list.slice(0, 2).join(', ')} +${list.length - 2}` : list.join(', '));

/** The orange strip at the foot of card 2: this week's achievement highlights, or nothing when there are none. */
export function renderBanner(achievements) {
    const lines = [];
    if (achievements.prs.length) {
        lines.push(['New PBs', names(achievements.prs.map((p) => `${p.name} (${p.efforts.at(-1)})`))]);
    }
    if (achievements.milestones.length) {
        // Only the biggest milestone crossed, so the one distance named is true for every name beside it.
        const top = Math.max(...achievements.milestones.map((m) => m.km));
        lines.push(['Milestone', `${names(achievements.milestones.filter((m) => m.km === top).map((m) => m.name))} passed ${km(top)}`]);
    }
    const streak = achievements.dayStreak.entries[0];
    if (streak) {
        lines.push(['Streak', `${streak.name}, ${streak.display}`]);
    }
    if (!lines.length) {
        return '';
    }
    return `
        <section class="rc-banner">
            ${lines.map(([label, text]) => `<p><strong>${escapeHtml(label)}</strong>${escapeHtml(text)}</p>`).join('')}
        </section>`;
}

export function renderAchievementsCard(summary, achievements) {
    const branding = summary.club.branding ?? {};
    const tiles = [
        renderList(
            'New personal bests',
            achievements.prs.map((p) => ({ name: p.name, detail: p.efforts.join(' · ') })),
            'None this week. Next week?',
        ),
        renderList(
            'Lifetime milestones',
            achievements.milestones.map((m) => ({ name: m.name, detail: km(m.km) })),
            'Nobody crossed one this week.',
        ),
        renderAward(achievements.dayStreak),
        renderAward(achievements.weekStreak),
    ];

    return `
        ${renderHeader(summary, 'Achievements<br><span>this week</span>', 'rc-title--small')}

        <div class="rc-grid rc-grid--extras rc-grid--achievements">${tiles.join('')}</div>

        <footer class="rc-foot">
            <span class="rc-foot__tag">${escapeHtml(branding.hashtag ?? '')}</span>
            <span>${escapeHtml(branding.footer ?? '')}</span>
            <span class="rc-foot__powered">Data from Strava</span>
        </footer>`;
}
