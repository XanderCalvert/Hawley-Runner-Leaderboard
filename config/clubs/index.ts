import type { ClubConfig } from '../../packages/core/src/types.ts';
import hawleyRunners from './hawley-runners.json' with { type: 'json' };

/**
 * Registry of every club this deployment serves.
 * White-labelling a new club = add a JSON file alongside this one and register it here.
 */
export const clubs: Record<string, ClubConfig> = {
    [hawleyRunners.slug]: hawleyRunners as ClubConfig,
};

export function getClub(slug: string): ClubConfig | undefined {
    return clubs[slug];
}
