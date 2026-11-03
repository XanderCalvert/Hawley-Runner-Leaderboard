import { applyBrand, clubSlug, fetchClub, fetchWeekRows, isSample } from './api.js';
import { renderAchievementsCard } from './achievements-card.js';
import { applyCardTheme, renderCard } from './card.js';
import { fitRoll, renderExtrasCard } from './quick-card.js';
import { buildCaption } from './quick-caption.js';
import { addDays, buildQuickSummary } from './quick-summary.js';

const cards = [
    { card: document.getElementById('card'), scaler: document.getElementById('scaler'), preview: document.getElementById('preview') },
    { card: document.getElementById('card2'), scaler: document.getElementById('scaler2'), preview: document.getElementById('preview2') },
    { card: document.getElementById('card3'), scaler: document.getElementById('scaler3'), preview: document.getElementById('preview3') },
];
const weekInput = document.getElementById('week');
const statusEl = document.getElementById('status');
const caption = document.getElementById('caption');
const buttons = {
    prev: document.getElementById('prev'),
    next: document.getElementById('next'),
    download: document.getElementById('download'),
    download2: document.getElementById('download2'),
    download3: document.getElementById('download3'),
    copy: document.getElementById('copy'),
};

/** The same settings the quick recap uses by default: seven-place panels, five-place extras, 10 km minimum for pace awards. */
const TOP = 5;
const MIN_PACE_KM = 10;

let current = null;
let club = null;
let branded = false;

function fitPreviews() {
    for (const { scaler, preview } of cards) {
        const scale = preview.clientWidth / 1080;
        scaler.style.transform = `scale(${scale})`;
        preview.style.height = `${1350 * scale}px`;
    }
}

async function load(weekStart) {
    statusEl.textContent = 'Loading…';
    try {
        club ??= await fetchClub();
        const data = await fetchWeekRows(weekStart);
        // The rows arrive as "First L." names, and the API has already left out anyone an admin hid.
        const summary = buildQuickSummary({
            club,
            rows: data.rows,
            previousRows: data.previousRows,
            history: data.history,
            weekStart: data.weekStart,
            groups: (data.groups ?? []).filter((g) => g.members.length),
            minPaceKm: MIN_PACE_KM,
            top: TOP,
        });
        current = summary;
        if (!branded) {
            applyBrand(club);
            branded = true;
        }
        cards.forEach(({ card }, i) => {
            applyCardTheme(card, club.branding);
            // The first two cards are packed with places; the achievements card has room for full-size tiles.
            card.classList.toggle('is-compact', TOP > 3 && i < 2);
        });
        cards[0].card.innerHTML = renderCard(summary);
        cards[1].card.innerHTML = renderExtrasCard(summary);
        fitRoll(cards[1].card);
        document.fonts.ready.then(() => fitRoll(cards[1].card));
        // An older Worker may not send achievements yet: show two cards rather than fail.
        const hasAchievements = Boolean(data.achievements);
        cards[2].preview.hidden = !hasAchievements;
        buttons.download3.hidden = !hasAchievements;
        cards[2].card.innerHTML = hasAchievements ? renderAchievementsCard(summary, data.achievements) : '';
        weekInput.value = summary.week.start;
        caption.value = buildCaption(summary);
        statusEl.textContent = `Showing ${summary.week.label}. ${summary.group.week.runners} ${summary.group.week.runners === 1 ? 'runner' : 'runners'} on the board.`;
        const url = new URL(location.href);
        url.searchParams.set('week', summary.week.start);
        history.replaceState(null, '', url);
    } catch (error) {
        statusEl.textContent = `Couldn't load that week: ${error.message}`;
    }
}

async function download(el, button, name) {
    if (!current) {
        return;
    }
    button.disabled = true;
    statusEl.textContent = 'Rendering image…';
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
        link.download = `${clubSlug}-${name}-${current.week.start}.png`;
        link.href = dataUrl;
        link.click();
        statusEl.textContent = 'Downloaded.';
    } catch (error) {
        statusEl.textContent = `Export failed: ${error.message}`;
    } finally {
        button.disabled = false;
    }
}

document.getElementById('mode').textContent = isSample
    ? 'Sample data: set apiBase in assets/js/config.js to use your real club.'
    : '';

buttons.prev.addEventListener('click', () => current && load(addDays(current.week.start, -7)));
buttons.next.addEventListener('click', () => current && load(addDays(current.week.start, 7)));
weekInput.addEventListener('change', () => weekInput.value && load(weekInput.value));
buttons.download.addEventListener('click', () => download(cards[0].card, buttons.download, 'recap'));
buttons.download2.addEventListener('click', () => download(cards[1].card, buttons.download2, 'more'));
buttons.download3.addEventListener('click', () => download(cards[2].card, buttons.download3, 'achievements'));
buttons.copy.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(caption.value);
        statusEl.textContent = 'Caption copied.';
    } catch {
        caption.select();
        statusEl.textContent = 'Press Ctrl+C to copy.';
    }
});

if (isSample) {
    [buttons.prev, buttons.next, weekInput].forEach((el) => (el.disabled = true));
}

for (const { preview } of cards) {
    new ResizeObserver(fitPreviews).observe(preview);
}
fitPreviews();
load(new URLSearchParams(location.search).get('week') || undefined);
