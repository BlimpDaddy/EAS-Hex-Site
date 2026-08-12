/**
 * Conceptual Design access gate — POST /api/gate  { password }
 *   → { ok: true,  url }      correct password; url is the document link
 *   → { ok: false }           wrong password ("Access Denied" is client copy)
 *   → { ok: false, error: 'server' }   gate not configured
 *
 * The password and the document URL both live as Pages secrets, so neither
 * ever appears in page source — view-source reveals nothing. The gate is
 * deliberately marketing theatre, not security (the document is published);
 * the point is the request-access funnel next to it.
 *
 * Comparison is CASE-SENSITIVE by explicit decision: the exact spelling of
 * the password is part of the game. No hints on failure.
 *
 * Secrets required on the website Pages project:
 *   GATE_PASSWORD — the access code
 *   GATE_DOC_URL  — where a correct entry leads
 */

export async function onRequestPost({ request, env }) {
    if (!env.GATE_PASSWORD || !env.GATE_DOC_URL) {
        return Response.json({ ok: false, error: 'server' }, { status: 500 });
    }

    let password;
    try {
        password = String((await request.json()).password ?? '');
    } catch {
        return Response.json({ ok: false }, { status: 400 });
    }

    if (password.length > 128 || password !== env.GATE_PASSWORD) {
        return Response.json({ ok: false }, { status: 403 });
    }

    return Response.json({ ok: true, url: env.GATE_DOC_URL });
}
