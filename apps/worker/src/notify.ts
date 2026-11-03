import type { Env } from './env.ts';

/**
 * Emails the club owner (via Resend's free tier). Off unless both RESEND_API_KEY and NOTIFY_EMAIL_TO are set.
 * Never throws: a failed notification must not break someone connecting. Keep the content minimal: it leaves our systems.
 */
export async function notifyOwner(env: Env, subject: string, text: string): Promise<void> {
    if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL_TO) {
        return;
    }
    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                // onboarding@resend.dev works without a domain, but can only send to the Resend account owner's address.
                from: env.NOTIFY_EMAIL_FROM ?? 'Club Recap <onboarding@resend.dev>',
                to: [env.NOTIFY_EMAIL_TO],
                subject,
                text,
            }),
        });
        if (!response.ok) {
            console.error('Owner notification failed', response.status, (await response.text()).slice(0, 200));
        }
    } catch (error) {
        console.error('Owner notification failed', error);
    }
}
