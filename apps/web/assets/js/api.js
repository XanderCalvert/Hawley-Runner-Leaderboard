import { config } from './config.js';

const params = new URLSearchParams(location.search);

export const clubSlug = (params.get('club') || config.defaultClub).replace(/[^a-z0-9-]/g, '');

/** Sample mode: no Worker configured yet, or ?sample=1 in the URL. */
export const isSample = !config.apiBase || params.get('sample') === '1';

async function getJson(url, options = {}) {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.error || `Request failed (${response.status})`);
    }
    return body;
}

export function connectUrl(intent = 'join') {
    if (!config.apiBase) {
        return null;
    }
    const query = new URLSearchParams({ club: clubSlug });
    if (intent === 'leave') {
        query.set('intent', 'leave');
    }
    return `${config.apiBase}/auth/start?${query}`;
}

export async function fetchSummary(weekStart) {
    if (isSample) {
        return getJson(`sample/${clubSlug}.json`);
    }
    const query = weekStart ? `?week=${encodeURIComponent(weekStart)}` : '';
    return getJson(`${config.apiBase}/api/clubs/${clubSlug}/summary${query}`);
}

export async function fetchClub() {
    if (isSample) {
        const summary = await getJson(`sample/${clubSlug}.json`);
        return summary.club;
    }
    return getJson(`${config.apiBase}/api/clubs/${clubSlug}`);
}

export function adminApi(token) {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    return {
        members: () => getJson(`${config.apiBase}/admin/clubs/${clubSlug}/members`, { headers }),
        setStatus: (athleteId, status) =>
            getJson(`${config.apiBase}/admin/clubs/${clubSlug}/members/${athleteId}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({ status }),
            }),
        resync: (athleteId) => getJson(`${config.apiBase}/admin/athletes/${athleteId}/resync`, { method: 'POST', headers }),
        status: () => getJson(`${config.apiBase}/admin/status`, { headers }),
    };
}

/** Applies a club's brand colour to page chrome so each white-label site feels like theirs. */
export function applyBrand(club) {
    const primary = club?.branding?.primary;
    if (primary && /^#[0-9a-f]{6}$/i.test(primary)) {
        const [r, g, b] = [1, 3, 5].map((i) => {
            const c = parseInt(primary.slice(i, i + 2), 16) / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        document.documentElement.style.setProperty('--brand', primary);
        // Pick whichever text colour reads better on the club's colour.
        document.documentElement.style.setProperty('--brand-text', luminance > 0.18 ? '#14100d' : '#ffffff');
    }
    document.querySelectorAll('[data-club-name]').forEach((el) => {
        el.textContent = club?.name ?? 'Your club';
    });
    if (club?.name) {
        document.title = `${document.title} · ${club.name}`;
    }
}
