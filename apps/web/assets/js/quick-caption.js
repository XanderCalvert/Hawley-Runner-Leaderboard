/** The post caption that goes with the quick recap cards. Shared by the paste page and the Python build. */

export function buildCaption(summary) {
    const { week, previousWeek } = summary.group;
    const km = (m) => (m / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 });
    const lines = [
        summary.audience
            ? `${summary.club.name} weekly recap (${summary.audience.label}): ${summary.week.label}`
            : `${summary.club.name} weekly recap: ${summary.week.label}`,
        '',
        `${week.runners} of us ran ${km(week.distanceM)} km over ${week.runs} runs and climbed ${week.elevationM.toLocaleString('en-GB')} m.`,
    ];
    if (previousWeek.distanceM) {
        const diff = week.distanceM - previousWeek.distanceM;
        lines.push(`That's ${km(Math.abs(diff))} km ${diff >= 0 ? 'more' : 'less'} than the week before.`);
    }
    lines.push('');
    // "Most distance: A & B (12.3 km)" for each award that has a winner.
    const leaders = (awards) =>
        awards
            .map((award) => {
                const winners = award.entries.filter((e) => e.rank === 1);
                return winners.length ? `${award.label}: ${winners.map((w) => w.name).join(' & ')} (${winners[0].display})` : null;
            })
            .filter(Boolean);
    // With group panels, the first card shows each group's leaders instead of the overall awards.
    const sections = summary.spotlight
        ? [summary.rest, summary.spotlight].filter(Boolean).map((p) => [p.title, ...leaders(p.awards)])
        : [leaders(summary.awards)];
    for (const section of sections) {
        lines.push(...section, '');
    }
    const more = leaders(summary.extras?.awards ?? []);
    if (more.length) {
        lines.push(...more, '');
    }
    if (summary.extras?.newFaces?.length) {
        lines.push(`Good to see ${summary.extras.newFaces.length} of you on the board who weren't there last week.`);
    }
    const join = summary.club.stravaUrl
        ? `Join the ${summary.club.name} club on Strava: ${summary.club.stravaUrl}`
        : `Join the ${summary.club.name} club on Strava.`;
    lines.push('', `Thanks to all ${week.runners} of you who got out there. Want to be on it? ${join}`);
    if (summary.club.branding?.hashtag) {
        lines.push('', summary.club.branding.hashtag);
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
