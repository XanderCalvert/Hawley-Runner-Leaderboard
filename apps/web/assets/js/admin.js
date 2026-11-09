import { adminApi, applyBrand, fetchClub, isSample } from './api.js';

const form = document.getElementById('login');
const tokenInput = document.getElementById('token');
const statusEl = document.getElementById('status');
const panel = document.getElementById('members-panel');
const rows = document.getElementById('rows');
const filter = document.getElementById('filter');

const STORAGE_KEY = 'club-recap-admin-token';
const STATUS_LABELS = { active: 'Showing', hidden: 'Hidden' };
const APPROVAL_LABELS = { pending: 'Pending approval', guest: 'Guest' };

let api = null;
let members = [];
let groups = [];

function remember(token) {
    try {
        sessionStorage.setItem(STORAGE_KEY, token);
    } catch {
        // Storage can be unavailable (private mode); the page still works without it.
    }
}

function recall() {
    try {
        return sessionStorage.getItem(STORAGE_KEY) ?? '';
    } catch {
        return '';
    }
}

function formatDate(value) {
    if (!value) {
        return '—';
    }
    return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/** "20 Oct 2026 (15 days ago)" from a local start time, or a plain note when no run is stored. */
function formatLastRun(value) {
    if (!value) {
        return 'No runs stored';
    }
    const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    const ago = Math.floor((Date.now() - day.getTime()) / 86400000);
    const when = ago <= 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`;
    return `${day.toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: 'UTC' })} (${when})`;
}

function cell(text, className = '') {
    const td = document.createElement('td');
    td.textContent = text;
    if (className) {
        td.className = className;
    }
    return td;
}

function render() {
    const query = filter.value.trim().toLowerCase();
    rows.replaceChildren(
        ...members
            .filter((m) => `${m.name ?? ''} ${m.athleteId}`.toLowerCase().includes(query))
            .map((member) => {
                const tr = document.createElement('tr');
                tr.append(cell(member.name ?? 'Disconnected'));

                // Admin only: the ID tells two "Matt C."s apart, and the link opens their Strava profile.
                const idTd = document.createElement('td');
                const link = document.createElement('a');
                link.href = member.profileUrl;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = String(member.athleteId);
                idTd.append(link);
                tr.append(idTd);

                const statusTd = document.createElement('td');
                const pill = document.createElement('span');
                pill.className = `pill pill--${member.approval === 'pending' ? 'hidden' : member.status}`;
                pill.textContent = APPROVAL_LABELS[member.approval] ?? STATUS_LABELS[member.status] ?? member.status;
                statusTd.append(pill);
                tr.append(statusTd);

                // Which leaders panel they appear in on the first card (e.g. Women). Everyone else shows as Men's.
                const groupTd = document.createElement('td');
                if (member.connected && groups.length) {
                    const select = document.createElement('select');
                    select.className = 'input';
                    select.setAttribute('aria-label', `Group for ${member.name}`);
                    select.append(new Option('Men', ''), ...groups.map((g) => new Option(g.label, g.id)));
                    select.value = member.group ?? '';
                    select.addEventListener('change', () => setGroup(member, select.value || null));
                    groupTd.append(select);
                }
                tr.append(groupTd);

                tr.append(cell(String(member.runsThisYear), 'num'));
                tr.append(cell(formatDate(member.joinedAt)));
                const lastRunCell = cell(member.connected ? formatLastRun(member.lastRun) : '—');
                if (member.syncError) {
                    const warn = document.createElement('div');
                    warn.className = 'small';
                    warn.textContent = `⚠ Sync problem: ${member.syncError}`;
                    lastRunCell.append(warn);
                } else if (member.approval !== 'pending' && member.connected && !member.lastSyncedAt) {
                    const warn = document.createElement('div');
                    warn.className = 'small';
                    warn.textContent = '⚠ Not synced yet';
                    lastRunCell.append(warn);
                }
                tr.append(lastRunCell);

                // The buttons live in a collapsed "Manage" section so the row stays short enough to scan for who has stopped running.
                const actionsTd = document.createElement('td');
                const manage = document.createElement('details');
                manage.className = 'manage';
                const summary = document.createElement('summary');
                summary.textContent = 'Manage';
                const actions = document.createElement('div');
                actions.className = 'row-actions';
                const synced = document.createElement('p');
                synced.className = 'small';
                synced.textContent = `Last synced: ${formatDate(member.lastSyncedAt)}${member.syncError ? `. Last problem (${formatDate(member.syncErrorAt)}): ${member.syncError}` : ''}`;
                manage.append(summary, synced, actions);
                actionsTd.append(manage);
                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'button button--ghost';
                toggle.textContent = member.status === 'hidden' ? 'Show on recap' : 'Hide from recap';
                toggle.addEventListener('click', () => setStatus(member, member.status === 'hidden' ? 'active' : 'hidden'));
                const resync = document.createElement('button');
                resync.type = 'button';
                resync.className = 'button button--ghost';
                resync.textContent = 'Resync';
                resync.addEventListener('click', () => resyncMember(member));
                const button = (label, onClick) => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'button button--ghost';
                    b.textContent = label;
                    b.addEventListener('click', onClick);
                    return b;
                };
                if (member.approval === 'pending') {
                    // Someone outside the Strava club asking to join: nothing about their runs is held or shown until approved.
                    actions.append(button('Approve', () => approve(member)), button('Reject', () => remove(member, true)));
                    tr.append(actionsTd);
                    return tr;
                }
                actions.append(toggle);
                if (member.connected) {
                    actions.append(resync, button('Load history', () => loadHistory(member)), button('Check club', () => checkClub(member)), button('Remove', () => remove(member, false)));
                }
                tr.append(actionsTd);

                return tr;
            }),
    );
}

async function loadMembers() {
    statusEl.textContent = 'Loading…';
    try {
        const [{ members: list }, info] = await Promise.all([api.members(), api.status()]);
        members = list;
        panel.hidden = false;
        offerToSave(tokenInput.value.trim());
        const showing = members.filter((m) => m.status === 'active' && m.approval !== 'pending').length;
        const waiting = members.filter((m) => m.approval === 'pending').length;
        statusEl.textContent = `${waiting ? `${waiting} waiting for your approval. ` : ''}${members.filter((m) => m.connected && m.approval !== 'pending').length} connected, ${showing} showing on the recap. ${info.activities} runs stored.${info.backingOff ? ' Strava rate limit hit: syncing paused briefly.' : ''}`;
        render();
    } catch (error) {
        panel.hidden = true;
        statusEl.textContent = `Couldn't load members: ${error.message}`;
    }
}

async function setStatus(member, status) {
    try {
        await api.setStatus(member.athleteId, status);
        member.status = status;
        statusEl.textContent = `${member.name ?? member.athleteId} is now ${status === 'hidden' ? 'hidden from' : 'showing on'} the recap.`;
        render();
    } catch (error) {
        statusEl.textContent = `Update failed: ${error.message}`;
    }
}

async function setGroup(member, group) {
    try {
        await api.setGroup(member.athleteId, group);
        member.group = group;
        statusEl.textContent = `${member.name} is now in ${group ? groups.find((g) => g.id === group)?.label : "the Men's"} leaders.`;
    } catch (error) {
        statusEl.textContent = `Update failed: ${error.message}`;
        render();
    }
}

async function approve(member) {
    try {
        await api.approve(member.athleteId);
        statusEl.textContent = `${member.name} is approved as a guest. Their runs are loading.`;
        await loadMembers();
    } catch (error) {
        statusEl.textContent = `Approve failed: ${error.message}`;
    }
}

async function remove(member, isRequest) {
    const what = isRequest ? `Reject ${member.name}'s request` : `Remove ${member.name}`;
    if (!confirm(`${what}? Everything we hold about them is deleted and their Strava access is revoked. They can ask again.`)) {
        return;
    }
    try {
        await api.remove(member.athleteId);
        statusEl.textContent = `${member.name} has been removed.`;
        await loadMembers();
    } catch (error) {
        statusEl.textContent = `Remove failed: ${error.message}`;
    }
}

async function checkClub(member) {
    statusEl.textContent = `Asking Strava about ${member.name}…`;
    try {
        const { inClub } = await api.checkClub(member.athleteId);
        statusEl.textContent = inClub
            ? `${member.name} IS in the club's Strava group.`
            : `${member.name} is NOT in the club's Strava group. Use Remove if they shouldn't be here (they can ask again and you can approve them as a guest).`;
    } catch (error) {
        statusEl.textContent = `Check failed: ${error.message}`;
    }
}

/** Loads this runner's runs and best efforts back to 1 Jan 2025, a batch at a time, until none are left or Strava asks us to slow down. */
async function loadHistory(member) {
    if (!confirm(`Load ${member.name}'s runs back to 1 January 2025? Only do this for runners who have agreed to a year-end review. It uses a fair chunk of the Strava rate limit and can take several minutes.`)) {
        return;
    }
    try {
        for (;;) {
            statusEl.textContent = `Loading ${member.name}'s history…`;
            const { missing, paused } = await api.history(member.athleteId, '2025-01-01');
            if (paused) {
                statusEl.textContent = `Strava's rate limit is nearly used up. ${missing} runs still to load for ${member.name}: try again in 15 minutes.`;
                return;
            }
            if (missing === 0) {
                statusEl.textContent = `${member.name}'s history is loaded.`;
                await loadMembers();
                return;
            }
            statusEl.textContent = `Loading ${member.name}'s history… ${missing} runs to go.`;
        }
    } catch (error) {
        statusEl.textContent = `Load failed: ${error.message}`;
    }
}

async function resyncMember(member) {
    statusEl.textContent = `Syncing ${member.name ?? member.athleteId}…`;
    try {
        const { ok, error } = await api.resync(member.athleteId);
        await loadMembers(); // redraws the status line, so say the result after it
        statusEl.textContent = ok ? `${member.name ?? member.athleteId} is synced.` : `Sync problem for ${member.name ?? member.athleteId}: ${error}`;
    } catch (error) {
        statusEl.textContent = `Resync failed: ${error.message}`;
    }
}

/** Asks Chrome (and other Chromium browsers) to save the token in the password manager, once it is known to work. */
function offerToSave(token) {
    try {
        if (token && window.PasswordCredential) {
            navigator.credentials.store(new PasswordCredential({ id: 'recap-admin', password: token, name: 'Recap admin' }));
        }
    } catch {
        // Not supported or blocked: the page still works, the browser just won't offer to remember it.
    }
}

form.addEventListener('submit', (event) => {
    event.preventDefault();
    const token = tokenInput.value.trim();
    remember(token);
    api = adminApi(token);
    loadMembers();
});

filter.addEventListener('input', render);

if (isSample) {
    statusEl.textContent = 'Admin needs a live Worker: set apiBase in assets/js/config.js.';
    form.querySelector('button').disabled = true;
} else {
    const saved = recall();
    if (saved) {
        tokenInput.value = saved;
        api = adminApi(saved);
        loadMembers();
    }
}

fetchClub()
    .then((club) => {
        groups = club.groups ?? [];
        applyBrand(club);
        render();
    })
    .catch(() => {});
