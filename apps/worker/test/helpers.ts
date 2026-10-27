import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { vi } from 'vitest';
import { getClub } from '../../../config/clubs/index.ts';
import { Repository } from '../src/db.ts';
import type { Env } from '../src/env.ts';

export const CLUB = getClub('hawley-runners')!;

type Params = Array<string | number | null>;

class FakeStatement {
    constructor(
        private readonly db: DatabaseSync,
        private readonly sql: string,
        private readonly params: Params = [],
    ) {}

    bind(...params: Params): FakeStatement {
        return new FakeStatement(this.db, this.sql, params);
    }

    // Statements are synchronous under the hood; the async signatures match D1.
    async run() {
        const result = this.db.prepare(this.sql).run(...this.params);
        return { success: true, meta: { changes: Number(result.changes) } };
    }

    async first<T>(): Promise<T | null> {
        return ((this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null) as T | null;
    }

    async all<T>() {
        return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
    }
}

/** A D1 stand-in on node:sqlite with the real migrations applied, so the SQL under test is the SQL we ship. */
export function fakeD1(): { d1: D1Database; sqlite: DatabaseSync } {
    const sqlite = new DatabaseSync(':memory:');
    const dir = new URL('../migrations/', import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
        sqlite.exec(readFileSync(new URL(file, dir), 'utf-8'));
    }
    const d1 = {
        prepare: (sql: string) => new FakeStatement(sqlite, sql),
        async batch(statements: FakeStatement[]) {
            sqlite.exec('BEGIN');
            try {
                const results = [];
                for (const statement of statements) {
                    results.push(await statement.run());
                }
                sqlite.exec('COMMIT');
                return results;
            } catch (error) {
                sqlite.exec('ROLLBACK');
                throw error;
            }
        },
    } as unknown as D1Database;
    return { d1, sqlite };
}

export function makeEnv(overrides: Partial<Env> = {}) {
    const { d1, sqlite } = fakeD1();
    const env: Env = {
        DB: d1,
        STRAVA_CLIENT_ID: '12345',
        STRAVA_CLIENT_SECRET: 'client-secret',
        STRAVA_VERIFY_TOKEN: 'verify',
        APP_SECRET: 'test-secret-test-secret-test-secret',
        ADMIN_TOKEN: 'admin-token-admin-token-admin',
        WEB_BASE_URL: 'https://web.test',
        ALLOWED_ORIGINS: 'https://web.test',
        ...overrides,
    };
    return { env, sqlite, repo: new Repository(env) };
}

export const nowS = () => Math.floor(Date.now() / 1000);

export function tokenResponse(n: number, expiresInS = 6 * 3600, athleteId = 1) {
    return {
        access_token: `access-${n}`,
        refresh_token: `refresh-${n}`,
        expires_at: nowS() + expiresInS,
        athlete: { id: athleteId, firstname: 'Sarah', lastname: 'Kent' },
    };
}

/** Connects an athlete to the club with tokens `access-1` / `refresh-1`. */
export async function seedAthlete(
    repo: Repository,
    id = 1,
    { expiresInS = 6 * 3600, firstname = 'Sarah', lastname = 'Kent' } = {},
): Promise<void> {
    await repo.saveAthlete(
        { id, firstname, lastname },
        { access_token: 'access-1', refresh_token: 'refresh-1', expires_at: nowS() + expiresInS },
        'read,activity:read',
    );
    await repo.joinClub(CLUB.slug, id);
}

export interface Call {
    method: string;
    path: string;
    url: string;
    headers: Headers;
    body: string;
}

export const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(body === null ? null : JSON.stringify(body), { status, headers });

/**
 * Replaces fetch with a table of routes keyed "METHOD /path" (the /api/v3 prefix is dropped).
 * Anything unrouted answers 404, so a test can assert on `calls` to prove what was or wasn't requested.
 */
export function stubStrava(routes: Record<string, (call: Call) => Response>): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        const call: Call = {
            method: init.method ?? 'GET',
            path: url.pathname.replace(/^\/api\/v3/, ''),
            url: url.href,
            headers: new Headers(init.headers),
            body: init.body ? String(init.body) : '',
        };
        calls.push(call);
        return (routes[`${call.method} ${call.path}`] ?? (() => reply({ message: 'Not found' }, 404)))(call);
    });
    return calls;
}

export const count = (sqlite: DatabaseSync, table: string): number =>
    Number((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);

export function stravaActivity(id: number, sportType: string, extra: Record<string, unknown> = {}) {
    return {
        id,
        athlete: { id: 1 },
        // Legacy `type` deliberately says Run: filtering must use sport_type only.
        type: 'Run',
        sport_type: sportType,
        start_date_local: '2026-09-22T07:30:00Z',
        distance: 5000,
        moving_time: 1500,
        total_elevation_gain: 20,
        ...extra,
    };
}
