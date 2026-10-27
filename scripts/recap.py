#!/usr/bin/env python3
"""
Quick recap: archive each week's Strava club leaderboard as a CSV and build the recap PNGs from it.
No Strava API, no sign-ups, no AI: just the leaderboard every club member can already see.

    python scripts/recap.py serve             Open the paste page. "Save and build PNGs" files the week and builds it.
    python scripts/recap.py build             Rebuild the latest week (or --week 2026-09-21, or --all).
    python scripts/recap.py add FILE [FILE]   File downloaded CSVs (or older .json exports) into week folders and build.

The archive (default: a "recaps" folder next to this repo) looks like:

    recaps/
        settings.json                 hide list, groups (e.g. women), pace/hill minimum km, places per award
        2026-09-21/
            leaderboard.csv           everyone on the board, as Strava showed it
            hawley-runners-recap-2026-09-21.png
            hawley-runners-more-2026-09-21.png
            caption.txt                          the post text
            caption.md                           the same text as Markdown

One-off setup for building PNGs (saving CSVs works without it). Two separate commands:

    py -m pip install playwright
    py -m playwright install chromium
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import threading
import webbrowser
from datetime import date, timedelta
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
WEB = REPO / 'apps' / 'web'
CLUBS = REPO / 'config' / 'clubs'
DEFAULT_ARCHIVE = REPO.parent / 'recaps'
DEFAULT_PORT = 5174

COLUMNS = ['week_start', 'rank', 'name', 'distance_km', 'runs', 'longest_km', 'avg_pace_per_km', 'elevation_m']
DEFAULT_GROUPS = [{'id': 'women', 'label': 'Women', 'title': "Women's leaders", 'members': []}]
DEFAULT_SETTINGS = {'club': 'hawley-runners', 'hidden': [], 'groups': DEFAULT_GROUPS, 'minPaceKm': 10, 'places': 5}
GROUP_ID_RE = re.compile(r'^[a-z0-9-]{1,30}$')
WEEK_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')

# Anything outside these is almost certainly not a run (a ride saved as a run, a watch left running).
PACE_FASTEST_S = 150   # 2:30 /km
PACE_SLOWEST_S = 1200  # 20:00 /km


# ---------------------------------------------------------------------------
# Weeks and settings
# ---------------------------------------------------------------------------

def monday_of(value: str) -> str:
    if not WEEK_RE.match(value or ''):
        raise ValueError(f'Not a date: {value!r} (expected YYYY-MM-DD)')
    d = date.fromisoformat(value)
    return (d - timedelta(days=d.weekday())).isoformat()


def previous_week(week: str) -> str:
    return (date.fromisoformat(week) - timedelta(days=7)).isoformat()


def load_settings(archive: Path) -> dict:
    path = archive / 'settings.json'
    settings = json.loads(json.dumps(DEFAULT_SETTINGS))  # deep copy
    if path.exists():
        settings.update(json.loads(path.read_text(encoding='utf-8')))
    settings['groups'] = clean_groups(settings.get('groups'))
    return settings


def clean_names(names) -> list[str]:
    seen, out = set(), []
    for name in names or []:
        name = ' '.join(str(name).split())
        if name and name.casefold() not in seen:
            seen.add(name.casefold())
            out.append(name)
    return out


def clean_groups(groups) -> list[dict]:
    """Groups are opt-in lists kept by hand (e.g. who goes on the women's recap). Nothing is guessed."""
    out = []
    for g in groups if isinstance(groups, list) else []:
        gid = str(g.get('id', '')).strip().lower()
        label = ' '.join(str(g.get('label', '')).split())
        if GROUP_ID_RE.match(gid) and label and gid not in {x['id'] for x in out}:
            group = {'id': gid, 'label': label}
            title = ' '.join(str(g.get('title', '')).split()) or ("Women's leaders" if gid == 'women' else '')
            if title:
                group['title'] = title
            group['members'] = sorted(clean_names(g.get('members')), key=str.casefold)
            out.append(group)
    return out


def save_settings(archive: Path, patch: dict) -> dict:
    settings = load_settings(archive)
    for key in ('hidden', 'groups', 'minPaceKm', 'places', 'club'):
        if key in patch:
            settings[key] = patch[key]
    settings['hidden'] = clean_names(settings.get('hidden', []))
    settings['groups'] = clean_groups(settings.get('groups'))
    archive.mkdir(parents=True, exist_ok=True)
    (archive / 'settings.json').write_text(json.dumps(settings, indent=4, ensure_ascii=False) + '\n', encoding='utf-8')
    return settings


def load_club(slug: str) -> dict:
    path = CLUBS / f'{slug}.json'
    if not path.exists():
        raise SystemExit(f'No club config at {path}')
    config = json.loads(path.read_text(encoding='utf-8'))
    # Only what the card needs (the same public subset the Worker sends).
    return {
        'slug': config['slug'],
        'name': config['name'],
        'locale': config.get('locale', 'en-GB'),
        'stravaUrl': config.get('stravaUrl'),
        'branding': config.get('branding', {}),
    }


# ---------------------------------------------------------------------------
# CSV: read, clean, write
# ---------------------------------------------------------------------------

def parse_pace(text: str) -> int | None:
    text = (text or '').split('/')[0].strip()
    if not text or text == '--':
        return None
    try:
        parts = [int(p) for p in text.split(':')]
    except ValueError:
        return None
    if len(parts) < 2:
        return None
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + part
    return seconds


def format_pace(seconds: int | None) -> str:
    if not seconds:
        return ''
    h, rest = divmod(round(seconds), 3600)
    m, s = divmod(rest, 60)
    return f'{h}:{m:02d}:{s:02d}' if h else f'{m}:{s:02d}'


def undouble(name: str) -> str:
    """'Matt Calvert Matt Calvert' → 'Matt Calvert' (Strava repeats the name in the avatar's alt text)."""
    words = name.split()
    half = len(words) // 2
    if words and len(words) % 2 == 0 and words[:half] == words[half:]:
        words = words[:half]
    return ' '.join(words)


def number(value, default: float = 0.0) -> float:
    value = str(value if value is not None else '').replace(',', '').strip()
    if value in ('', '--'):
        return default
    return float(value)


def clean_rows(records: list[dict]) -> tuple[list[dict], list[str]]:
    """Normalise CSV records into card rows. Returns (rows, warnings)."""
    rows: list[dict] = []
    warnings: list[str] = []
    seen: set[str] = set()
    for i, rec in enumerate(records, start=2):  # row 1 is the header
        name = undouble(' '.join((rec.get('name') or '').split()))
        if not name:
            continue
        key = name.casefold()
        if key in seen:
            warnings.append(f'{name} appears twice; kept the first row.')
            continue
        seen.add(key)
        try:
            distance_km = number(rec.get('distance_km'))
            longest_km = number(rec.get('longest_km'))
            runs = int(number(rec.get('runs')))
            elevation_m = number(rec.get('elevation_m'))
            rank = int(number(rec.get('rank'), default=len(rows) + 1))
        except ValueError:
            warnings.append(f'Row {i} ({name}) has a value that isn\'t a number; skipped.')
            continue
        pace = parse_pace(rec.get('avg_pace_per_km', ''))
        if distance_km <= 0:
            warnings.append(f'{name}: 0 km, left off the card.')
        elif pace and not PACE_FASTEST_S <= pace <= PACE_SLOWEST_S:
            warnings.append(f'{name}: average pace {format_pace(pace)} /km looks wrong (a ride or a paused watch?). Hide them if so.')
        if longest_km > distance_km + 0.05:
            warnings.append(f'{name}: longest run is more than their total distance.')
        rows.append({
            'rank': rank,
            'name': name,
            'distanceM': round(distance_km * 1000),
            'runs': runs,
            'longestM': round(longest_km * 1000),
            'paceSPerKm': pace,
            'movingTimeS': round(distance_km * pace) if pace else 0,
            'elevationM': round(elevation_m),
        })
    return rows, warnings


def read_csv_text(text: str) -> tuple[str | None, list[dict], list[str]]:
    reader = csv.DictReader(io.StringIO(text.lstrip('﻿')))
    missing = [c for c in ('name', 'distance_km', 'runs') if c not in (reader.fieldnames or [])]
    if missing:
        raise ValueError(f'CSV is missing column(s): {", ".join(missing)}')
    records = list(reader)
    week = next((r.get('week_start', '').strip() for r in records if r.get('week_start', '').strip()), None)
    rows, warnings = clean_rows(records)
    return week, rows, warnings


def read_week(archive: Path, week: str) -> tuple[list[dict], list[str]]:
    path = archive / week / 'leaderboard.csv'
    if not path.exists():
        return [], []
    _, rows, warnings = read_csv_text(path.read_text(encoding='utf-8-sig'))
    return rows, warnings


def write_week(archive: Path, week: str, rows: list[dict]) -> Path:
    folder = archive / week
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / 'leaderboard.csv'
    with path.open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(COLUMNS)
        for r in rows:
            writer.writerow([
                week,
                r['rank'],
                r['name'],
                f"{r['distanceM'] / 1000:g}",
                r['runs'],
                f"{r['longestM'] / 1000:g}",
                format_pace(r['paceSPerKm']),
                r['elevationM'],
            ])
    return path


def legacy_json(text: str) -> tuple[str | None, list[dict]]:
    """Older 'Save week data' exports from the paste page."""
    data = json.loads(text)
    records = [{
        'rank': r.get('rank'),
        'name': r.get('name'),
        'distance_km': str((r.get('distanceM') or 0) / 1000),
        'runs': str(r.get('runs') or 0),
        'longest_km': str((r.get('longestM') or 0) / 1000),
        'avg_pace_per_km': format_pace(r.get('paceSPerKm')),
        'elevation_m': str(r.get('elevationM') or 0),
    } for r in data.get('rows', [])]
    return data.get('weekStart'), records


# ---------------------------------------------------------------------------
# Building the PNGs (headless Chromium drawing apps/web/render.html)
# ---------------------------------------------------------------------------

class PlaywrightMissing(RuntimeError):
    pass


def build_week(archive: Path, week: str, base_url: str) -> tuple[list[str], list[str]]:
    """Render both cards and the caption for one archived week. Returns (files written, warnings)."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise PlaywrightMissing(
            'PNGs need Playwright. In a terminal in the club-recap folder, run these two commands one at a time: '
            '(1) py -m pip install playwright   (2) py -m playwright install chromium'
        ) from error

    settings = load_settings(archive)
    club = load_club(settings['club'])
    rows, warnings = read_week(archive, week)
    if not rows:
        raise ValueError(f'No leaderboard.csv for {week} in {archive}')
    previous_rows, _ = read_week(archive, previous_week(week))
    # The four weeks before this one (oldest first) for the club distance chart; weeks not archived are skipped there.
    history, earlier = [], week
    for _ in range(4):
        earlier = previous_week(earlier)
        history.insert(0, {'weekStart': earlier, 'rows': read_week(archive, earlier)[0]})

    payload = {
        'club': club,
        'rows': rows,
        'previousRows': previous_rows,
        'history': history,
        'weekStart': week,
        'hiddenNames': settings.get('hidden', []),
        'minPaceKm': settings.get('minPaceKm', 10),
        'top': settings.get('places', 5),
        # Hand-kept lists (e.g. women): the first with runners this week gets a top-3 panel on the second card.
        'groups': [g for g in settings.get('groups', []) if g['members']],
    }
    folder = archive / week
    slug = club['slug']
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={'width': 1100, 'height': 1400}, device_scale_factor=1)
            page.goto(f'{base_url}/render.html')
            page.wait_for_function('window.renderReady === true')
            result = page.evaluate('input => window.renderRecap(input)', payload)
            page.locator('#card').screenshot(path=str(folder / f'{slug}-recap-{week}.png'))
            page.locator('#card2').screenshot(path=str(folder / f'{slug}-more-{week}.png'))
        finally:
            browser.close()
    (folder / 'caption.txt').write_text(result['caption'] + '\n', encoding='utf-8')
    # Same text as Markdown; two trailing spaces keep each line break when it's rendered.
    (folder / 'caption.md').write_text(re.sub(r'(?<=\S)\n(?=\S)', '  \n', result['caption']) + '\n', encoding='utf-8')
    files = [f'{slug}-recap-{week}.png', f'{slug}-more-{week}.png', 'caption.txt', 'caption.md']
    print(f"  {result['label']}: {result['runners']} runners, {result['distanceKm']} km → {folder}")
    groups = settings.get('groups', [])
    if groups and not any(g['members'] for g in groups):
        warnings.append(f"No one is ticked for the {groups[0]['label']} list yet, so there's no {groups[0].get('title', groups[0]['label'])} panel.")
    elif payload['groups'] and not result.get('spotlight'):
        warnings.append(f"No one on the {payload['groups'][0]['label']} list ran this week, so there's no panel for them.")
    if not previous_rows:
        warnings.append(f'No {previous_week(week)} folder, so no week-on-week change or step-up award.')
    return files, warnings


# ---------------------------------------------------------------------------
# Local server: serves apps/web plus a tiny API for the paste page
# ---------------------------------------------------------------------------

class Handler(SimpleHTTPRequestHandler):
    archive: Path = DEFAULT_ARCHIVE
    base_url: str = ''
    # Python takes file types from the Windows registry, which often says .js is text/plain.
    # Browsers refuse to run module scripts served like that, so the page would silently do nothing.
    extensions_map = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.csv': 'text/csv; charset=utf-8',
        '.txt': 'text/plain; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
        '': 'application/octet-stream',
    }

    def log_message(self, fmt, *args):  # Keep the console for things that matter.
        if '/api/' in (self.path or '') and self.command != 'GET':
            sys.stderr.write(f'  {self.command} {self.path}\n')

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_json(self, data, status=HTTPStatus.OK):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self) -> str:
        length = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(length).decode('utf-8')

    def week_from_path(self) -> str:
        return monday_of(self.path.split('?')[0].rstrip('/').rsplit('/', 1)[-1])

    def do_GET(self):
        path = self.path.split('?')[0]
        try:
            if path == '/api/status':
                return self.send_json({'ok': True, 'archive': str(self.archive)})
            if path == '/api/settings':
                return self.send_json(load_settings(self.archive))
            if path == '/api/club':
                return self.send_json(load_club(load_settings(self.archive)['club']))
            if path.startswith('/api/weeks/'):
                csv_path = self.archive / self.week_from_path() / 'leaderboard.csv'
                if not csv_path.exists():
                    return self.send_json({'error': 'No data for that week'}, HTTPStatus.NOT_FOUND)
                body = csv_path.read_bytes()
                self.send_response(HTTPStatus.OK)
                self.send_header('Content-Type', 'text/csv; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return None
        except (ValueError, SystemExit) as error:
            return self.send_json({'error': str(error)}, HTTPStatus.BAD_REQUEST)
        return super().do_GET()

    def do_PUT(self):
        if self.path.split('?')[0] != '/api/settings':
            return self.send_json({'error': 'Not found'}, HTTPStatus.NOT_FOUND)
        try:
            return self.send_json(save_settings(self.archive, json.loads(self.read_body())))
        except ValueError as error:
            return self.send_json({'error': str(error)}, HTTPStatus.BAD_REQUEST)

    def do_POST(self):
        if not self.path.startswith('/api/weeks/'):
            return self.send_json({'error': 'Not found'}, HTTPStatus.NOT_FOUND)
        try:
            week = self.week_from_path()
            _, rows, warnings = read_csv_text(self.read_body())
            if not rows:
                raise ValueError('No runners in that CSV')
            write_week(self.archive, week, rows)
            files = ['leaderboard.csv']
            try:
                built, build_warnings = build_week(self.archive, week, self.base_url)
                files += built
                warnings = warnings + [w for w in build_warnings if w not in warnings]
            except PlaywrightMissing as error:
                warnings.append(str(error))
            return self.send_json({'folder': str(self.archive / week), 'files': files, 'warnings': warnings})
        except (ValueError, SystemExit) as error:
            return self.send_json({'error': str(error)}, HTTPStatus.BAD_REQUEST)
        except Exception as error:  # Show anything unexpected on the page rather than hanging it.
            return self.send_json({'error': f'{type(error).__name__}: {error}'}, HTTPStatus.INTERNAL_SERVER_ERROR)


def start_server(archive: Path, port: int) -> tuple[ThreadingHTTPServer, str]:
    Handler.archive = archive
    server = ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=str(WEB)))
    base_url = f'http://127.0.0.1:{server.server_address[1]}'
    Handler.base_url = base_url
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, base_url


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_serve(args) -> None:
    args.archive.mkdir(parents=True, exist_ok=True)
    server, base_url = start_server(args.archive, args.port)
    settings = load_settings(args.archive)
    url = f"{base_url}/quick.html?club={settings['club']}"
    print(f'Quick recap running at {url}')
    print(f'Archive: {args.archive}')
    print('Leave this window open while you use the page. Press Ctrl+C to stop.')
    if not args.no_browser:
        webbrowser.open(url)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        print('\nStopped.')
        server.shutdown()


def print_warnings(warnings: list[str]) -> None:
    for w in warnings:
        print(f'    ! {w}')


def build_many(archive: Path, weeks: list[str]) -> int:
    server, base_url = start_server(archive, 0)
    failed = 0
    try:
        for week in weeks:
            try:
                _, warnings = build_week(archive, week, base_url)
                print_warnings(warnings)
            except PlaywrightMissing as error:
                print(error)
                return 1
            except ValueError as error:
                print(f'  {week}: {error}')
                failed += 1
    finally:
        server.shutdown()
    return 1 if failed else 0


def archived_weeks(archive: Path) -> list[str]:
    if not archive.exists():
        return []
    return sorted(p.parent.name for p in archive.glob('*/leaderboard.csv') if WEEK_RE.match(p.parent.name))


def cmd_build(args) -> int:
    weeks = archived_weeks(args.archive)
    if not weeks:
        print(f'No weeks in {args.archive} yet. Save one from the paste page first.')
        return 1
    if args.all:
        targets = weeks
    elif args.week:
        targets = [monday_of(args.week)]
    else:
        targets = [weeks[-1]]
    print(f'Building {len(targets)} week(s) from {args.archive}')
    return build_many(args.archive, targets)


def cmd_add(args) -> int:
    added = []
    for name in args.files:
        path = Path(name)
        text = path.read_text(encoding='utf-8-sig')
        if path.suffix.lower() == '.json':
            week, records = legacy_json(text)
            rows, warnings = clean_rows(records)
        else:
            week, rows, warnings = read_csv_text(text)
        week = monday_of(args.week or week or '')
        if not rows:
            print(f'{path.name}: no runners found, skipped.')
            continue
        out = write_week(args.archive, week, rows)
        print(f'{path.name} → {out}')
        print_warnings(warnings)
        added.append(week)
    if not added:
        return 1
    if args.no_build:
        return 0
    # Oldest first, so each week can compare with the one before.
    return build_many(args.archive, sorted(set(added)))


def main() -> int:
    parser = argparse.ArgumentParser(description='Quick recap: archive weekly leaderboards and build the recap PNGs.')
    parser.add_argument('--archive', type=Path, default=DEFAULT_ARCHIVE, help=f'Archive folder (default: {DEFAULT_ARCHIVE})')
    sub = parser.add_subparsers(dest='command', required=True)

    serve = sub.add_parser('serve', help='Open the paste page with saving to the archive')
    serve.add_argument('--port', type=int, default=DEFAULT_PORT)
    serve.add_argument('--no-browser', action='store_true')

    build = sub.add_parser('build', help='Rebuild PNGs and caption from archived CSVs')
    build.add_argument('--week', help='Any date in the week to build (default: the latest week)')
    build.add_argument('--all', action='store_true', help='Rebuild every archived week')

    add = sub.add_parser('add', help='File CSVs (or old .json exports) into the archive and build them')
    add.add_argument('files', nargs='+')
    add.add_argument('--week', help='Override the week (if the file has none)')
    add.add_argument('--no-build', action='store_true')

    args = parser.parse_args()
    args.archive = args.archive.resolve()
    if args.command == 'serve':
        cmd_serve(args)
        return 0
    if args.command == 'build':
        return cmd_build(args)
    return cmd_add(args)


if __name__ == '__main__':
    sys.exit(main())
