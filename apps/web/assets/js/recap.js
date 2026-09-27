import { applyBrand, clubSlug, fetchSummary, isSample } from './api.js';
import { applyCardTheme, renderCard } from './card.js';

const card = document.getElementById('card');
const scaler = document.getElementById('scaler');
const preview = document.getElementById('preview');
const weekInput = document.getElementById('week');
const statusEl = document.getElementById('status');
const caption = document.getElementById('caption');
const buttons = {
    prev: document.getElementById('prev'),
    next: document.getElementById('next'),
    download: document.getElementById('download'),
    copy: document.getElementById('copy'),
};

let current = null;
let branded = false;

function addDays(date, days) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function fitPreview() {
    const scale = preview.clientWidth / 1080;
    scaler.style.transform = `scale(${scale})`;
    preview.style.height = `${1350 * scale}px`;
}

function buildCaption(summary) {
    const locale = summary.club.locale || 'en-GB';
    const km = (m) => (m / 1000).toLocaleString(locale, { maximumFractionDigits: 1 });
    const lines = [
        `${summary.club.name} weekly recap: ${summary.week.label}`,
        '',
        `${summary.group.week.runners} of us ran ${km(summary.group.week.distanceM)} km over ${summary.group.week.runs} runs and climbed ${Math.round(summary.group.week.elevationM).toLocaleString(locale)} m.`,
        '',
    ];
    for (const award of summary.awards) {
        const winners = award.entries.filter((e) => e.rank === 1);
        if (winners.length) {
            lines.push(`${award.label}: ${winners.map((w) => w.name).join(' & ')} (${winners[0].display})`);
        }
    }
    if (summary.milestones.length) {
        lines.push('', `Milestones: ${summary.milestones.map((m) => `${m.name} passed ${m.km} km this year`).join(', ')}. Well done!`);
    }
    lines.push('', `${summary.week.year} so far: ${km(summary.group.ytd.distanceM)} km together.`);
    if (summary.club.branding.hashtag) {
        lines.push('', summary.club.branding.hashtag);
    }
    return lines.join('\n');
}

async function load(weekStart) {
    statusEl.textContent = 'Loading…';
    try {
        const summary = await fetchSummary(weekStart);
        current = summary;
        if (!branded) {
            applyBrand(summary.club);
            branded = true;
        }
        applyCardTheme(card, summary.club.branding);
        card.innerHTML = renderCard(summary);
        weekInput.value = summary.week.start;
        caption.value = buildCaption(summary);
        statusEl.textContent = `Showing ${summary.week.label}. ${summary.group.week.runners} runners on the board.`;
        const url = new URL(location.href);
        url.searchParams.set('week', summary.week.start);
        history.replaceState(null, '', url);
    } catch (error) {
        statusEl.textContent = `Couldn't load that week: ${error.message}`;
    }
}

async function download() {
    if (!current) {
        return;
    }
    buttons.download.disabled = true;
    statusEl.textContent = 'Rendering image…';
    try {
        await document.fonts.ready;
        const dataUrl = await window.htmlToImage.toPng(card, {
            width: 1080,
            height: 1350,
            pixelRatio: 1,
            cacheBust: true,
            style: { transform: 'none' },
        });
        const link = document.createElement('a');
        link.download = `${clubSlug}-recap-${current.week.start}.png`;
        link.href = dataUrl;
        link.click();
        statusEl.textContent = 'Downloaded.';
    } catch (error) {
        statusEl.textContent = `Export failed: ${error.message}`;
    } finally {
        buttons.download.disabled = false;
    }
}

document.getElementById('mode').textContent = isSample
    ? 'Sample data: set apiBase in assets/js/config.js to use your real club.'
    : '';

buttons.prev.addEventListener('click', () => current && load(addDays(current.week.start, -7)));
buttons.next.addEventListener('click', () => current && load(addDays(current.week.start, 7)));
weekInput.addEventListener('change', () => weekInput.value && load(weekInput.value));
buttons.download.addEventListener('click', download);
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

new ResizeObserver(fitPreview).observe(preview);
fitPreview();
load(new URLSearchParams(location.search).get('week') || undefined);
