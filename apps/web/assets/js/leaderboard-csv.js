/**
 * The archive format: one CSV per week, one row per runner, exactly as the Strava leaderboard showed it.
 * Everyone is kept (opt-outs are hidden at build time), so the archive stays a faithful record.
 */

export const CSV_COLUMNS = ['week_start', 'rank', 'name', 'distance_km', 'runs', 'longest_km', 'avg_pace_per_km', 'elevation_m'];

const round = (value, digits) => Number(value.toFixed(digits));

export function formatPace(seconds) {
    if (!seconds) {
        return '';
    }
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function parsePace(text) {
    const parts = String(text ?? '').replace(/\/.*$/, '').trim().split(':').map(Number);
    if (parts.length < 2 || parts.some(Number.isNaN)) {
        return null;
    }
    return parts.reduce((total, part) => total * 60 + part, 0);
}

function quote(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows, weekStart) {
    const lines = [CSV_COLUMNS.join(',')];
    for (const r of rows) {
        lines.push(
            [
                weekStart,
                r.rank,
                r.name,
                round(r.distanceM / 1000, 2),
                r.runs,
                round(r.longestM / 1000, 2),
                formatPace(r.paceSPerKm),
                Math.round(r.elevationM),
            ]
                .map(quote)
                .join(','),
        );
    }
    // BOM so Excel shows names with emoji or accents correctly.
    return `﻿${lines.join('\r\n')}\r\n`;
}

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF or LF. */
function parseCsvText(text) {
    const records = [];
    let field = '';
    let record = [];
    let quoted = false;
    const input = String(text).replace(/^﻿/, '');
    for (let i = 0; i < input.length; i++) {
        const c = input[i];
        if (quoted) {
            if (c === '"' && input[i + 1] === '"') {
                field += '"';
                i++;
            } else if (c === '"') {
                quoted = false;
            } else {
                field += c;
            }
        } else if (c === '"') {
            quoted = true;
        } else if (c === ',') {
            record.push(field);
            field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && input[i + 1] === '\n') {
                i++;
            }
            record.push(field);
            records.push(record);
            record = [];
            field = '';
        } else {
            field += c;
        }
    }
    if (field || record.length) {
        record.push(field);
        records.push(record);
    }
    return records.filter((r) => r.some((v) => v.trim()));
}

/** CSV text → { weekStart, rows } in the same shape parseLeaderboard() returns. */
export function fromCsv(text) {
    const [header, ...records] = parseCsvText(text);
    if (!header) {
        return { weekStart: null, rows: [] };
    }
    const col = Object.fromEntries(header.map((name, i) => [name.trim(), i]));
    const get = (rec, name) => (col[name] === undefined ? '' : (rec[col[name]] ?? '').trim());
    const rows = records.map((rec) => {
        const distanceM = Number(get(rec, 'distance_km')) * 1000 || 0;
        const paceSPerKm = parsePace(get(rec, 'avg_pace_per_km'));
        return {
            rank: Number(get(rec, 'rank')) || 0,
            name: get(rec, 'name'),
            distanceM,
            runs: Number(get(rec, 'runs')) || 0,
            longestM: Number(get(rec, 'longest_km')) * 1000 || 0,
            paceSPerKm,
            movingTimeS: paceSPerKm ? Math.round((distanceM / 1000) * paceSPerKm) : 0,
            elevationM: Number(get(rec, 'elevation_m')) || 0,
        };
    });
    return { weekStart: records[0] ? get(records[0], 'week_start') : null, rows: rows.filter((r) => r.name) };
}
