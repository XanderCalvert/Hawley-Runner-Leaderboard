import { adminApi, applyBrand, fetchClub, isSample } from './api.js';

const form = document.getElementById('login');
const tokenInput = document.getElementById('token');
const statusEl = document.getElementById('status');
const panel = document.getElementById('members-panel');
const rows = document.getElementById('rows');
const filter = document.getElementById('filter');

const STORAGE_KEY = 'club-recap-admin-token';
const STATUS_LABELS = { active: 'Showing', excluded: 'Hidden', left: 'Left' };

let api = null;
let members = [];

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
            .filter((m) => m.name.toLowerCase().includes(query))
            .map((member) => {
                const tr = document.createElement('tr');
                tr.append(cell(member.name));

                const statusTd = document.createElement('td');
                const pill = document.createElement('span');
                pill.className = `pill pill--${member.status}`;
                pill.textContent = STATUS_LABELS[member.status] ?? member.status;
                statusTd.append(pill);
                tr.append(statusTd);

                tr.append(cell(String(member.runsThisYear), 'num'));
                tr.append(cell(formatDate(member.joinedAt)));
                tr.append(cell(formatDate(member.lastSyncedAt)));

                const actionsTd = document.createElement('td');
                const actions = document.createElement('div');
                actions.className = 'row-actions';
                actionsTd.append(actions);
                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'button button--ghost';
                toggle.textContent = member.status === 'excluded' ? 'Show on recap' : 'Hide from recap';
                toggle.addEventListener('click', () => setStatus(member, member.status === 'excluded' ? 'active' : 'excluded'));
                const resync = document.createElement('button');
                resync.type = 'button';
                resync.className = 'button button--ghost';
                resync.textContent = 'Resync';
                resync.addEventListener('click', () => resyncMember(member));
                actions.append(toggle, resync);
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
        const showing = members.filter((m) => m.status === 'active').length;
        statusEl.textContent = `${members.length} connected, ${showing} showing on the recap. ${info.activities} runs stored.${info.backingOff ? ' Strava rate limit hit: syncing paused briefly.' : ''}`;
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
        statusEl.textContent = `${member.name} is now ${status === 'excluded' ? 'hidden from' : 'showing on'} the recap.`;
        render();
    } catch (error) {
        statusEl.textContent = `Update failed: ${error.message}`;
    }
}

async function resyncMember(member) {
    try {
        await api.resync(member.athleteId);
        statusEl.textContent = `Resync started for ${member.name}. It can take a minute.`;
    } catch (error) {
        statusEl.textContent = `Resync failed: ${error.message}`;
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

fetchClub().then(applyBrand).catch(() => {});
