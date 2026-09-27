/**
 * Deterministic fake club data for local development and design work.
 * Produces Strava-shaped activities so it can feed both the mock Strava server and the sample generator.
 * All names are invented.
 */

export interface FakeAthlete {
    id: number;
    firstname: string;
    lastname: string;
}

export interface FakeActivity {
    id: number;
    athlete: { id: number };
    name: string;
    sport_type: string;
    start_date: string;
    start_date_local: string;
    distance: number;
    moving_time: number;
    elapsed_time: number;
    total_elevation_gain: number;
    manual: boolean;
    trainer: boolean;
    flagged: boolean;
    private: boolean;
    best_efforts: Array<{ name: string; distance: number; elapsed_time: number; moving_time: number }>;
}

const FIRST = [
    'Sarah', 'Tom', 'Priya', 'James', 'Emma', 'Dan', 'Aisha', 'Luke', 'Hannah', 'Ollie',
    'Grace', 'Ben', 'Chloe', 'Ravi', 'Katie', 'Sam', 'Lucy', 'Jack', 'Megan', 'Alex',
    'Zoe', 'Chris', 'Nina', 'Matt', 'Beth', 'Josh', 'Ellie', 'Kieran', 'Fran', 'Will',
];
const LAST = [
    'Kent', 'Barker', 'Shah', 'Holt', 'Wright', 'Price', 'Khan', 'Moss', 'Ford', 'Hughes',
    'Lane', 'Carter', 'Dean', 'Patel', 'Rowe', 'Hale', 'Ward', 'Cole', 'Bishop', 'Reid',
    'Young', 'Walsh', 'Grant', 'Pike', 'Stone', 'Mills', 'Frost', 'Nash', 'Lloyd', 'Webb',
];

function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function fakeAthletes(count = 30): FakeAthlete[] {
    return Array.from({ length: count }, (_, i) => ({
        id: 1000 + i,
        firstname: FIRST[i % FIRST.length] as string,
        lastname: LAST[(i * 7) % LAST.length] as string,
    }));
}

function iso(date: Date): string {
    return date.toISOString().slice(0, 19);
}

export function fakeActivities(athletes: FakeAthlete[], from: string, to: string, seed = 42): FakeActivity[] {
    const rand = mulberry32(seed);
    const activities: FakeActivity[] = [];
    let nextId = 9_000_000;
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T23:59:59Z`);

    for (const athlete of athletes) {
        const basePace = 250 + rand() * 170; // 4:10 to 7:00 per km
        const runsPerWeek = 1 + Math.floor(rand() * 5);
        const typical = 4.5 + rand() * 6; // km
        const hilly = rand() > 0.7;

        for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
            const weekday = day.getUTCDay();
            const isWeekend = weekday === 0 || weekday === 6;
            const chance = (runsPerWeek / 7) * (isWeekend ? 1.5 : 0.85);
            if (rand() > chance) {
                continue;
            }

            let km = typical * (0.7 + rand() * 0.6);
            if (weekday === 0 && rand() > 0.5) {
                km = typical * (1.6 + rand() * 1.4); // Sunday long run
            }
            if (weekday === 6 && rand() > 0.6) {
                km = 5.0 + rand() * 0.1; // Saturday 5K
            }
            km = Math.round(km * 100) / 100;

            const pace = basePace * (0.93 + rand() * 0.14) * (km > 15 ? 1.06 : 1);
            const movingTime = Math.round(km * pace);
            const hour = isWeekend ? 8 + Math.floor(rand() * 2) : rand() > 0.5 ? 6 : 18;
            const local = new Date(day);
            local.setUTCHours(hour, Math.floor(rand() * 60), 0, 0);

            const efforts: FakeActivity['best_efforts'] = [];
            if (km >= 5) {
                const t = Math.round(5 * pace * (0.96 + rand() * 0.03));
                efforts.push({ name: '5K', distance: 5000, elapsed_time: t, moving_time: t });
            }
            if (km >= 10) {
                const t = Math.round(10 * pace * (0.97 + rand() * 0.03));
                efforts.push({ name: '10K', distance: 10000, elapsed_time: t, moving_time: t });
            }

            activities.push({
                id: nextId++,
                athlete: { id: athlete.id },
                name: 'Morning Run',
                sport_type: rand() > 0.9 ? 'TrailRun' : 'Run',
                start_date: `${iso(local)}Z`,
                start_date_local: `${iso(local)}Z`,
                distance: km * 1000,
                moving_time: movingTime,
                elapsed_time: movingTime + Math.floor(rand() * 120),
                total_elevation_gain: Math.round(km * (hilly ? 18 + rand() * 20 : 4 + rand() * 8)),
                manual: false,
                trainer: false,
                flagged: false,
                private: false,
                best_efforts: efforts,
            });
        }
    }

    return activities.sort((a, b) => a.start_date.localeCompare(b.start_date));
}
