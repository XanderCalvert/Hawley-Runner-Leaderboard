/**
 * Headless entry point for scripts/recap.py: window.renderRecap(input) draws both cards
 * and returns the caption. Uses exactly the same code as the paste page.
 */
import { applyCardTheme, renderCard } from './card.js';
import { fitRoll, renderExtrasCard } from './quick-card.js';
import { buildCaption } from './quick-caption.js';
import { buildQuickSummary, groupRunners } from './quick-summary.js';

const card = document.getElementById('card');
const card2 = document.getElementById('card2');

window.renderRecap = async (input) => {
    const summary = buildQuickSummary(input);
    const compact = (input.top ?? 5) > 3;
    for (const el of [card, card2]) {
        applyCardTheme(el, input.club.branding);
        el.classList.toggle('is-compact', compact);
    }
    card.innerHTML = renderCard(summary);
    card2.innerHTML = renderExtrasCard(summary);
    await document.fonts.ready;
    fitRoll(card2);
    return {
        caption: buildCaption(summary),
        audience: summary.audience,
        spotlight: summary.spotlight ? summary.spotlight.title : null,
        label: summary.week.label,
        runners: summary.group.week.runners,
        distanceKm: Math.round(summary.group.week.distanceM / 100) / 10,
    };
};

window.groupRunners = (input) => groupRunners(input.rows, input.group, input.hiddenNames);

window.renderReady = true;
