/**
 * Confirmation endpoint — GET /api/confirm?t=TOKEN
 *
 * The link from the confirmation email lands here. A valid token flips its
 * row to verified=1 and is cleared (single use).
 *
 * Design-doc rows land here when the asker ticked the newsletter box (the
 * confirm button in their copy-of-the-link email), or from an access-code
 * email sent before 2026-10-13, when the gate still had a password. Both get
 * the document link itself; there is no code any more.
 */

const page = (title, body) =>
  new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${title} — Electric Air Shipping</title></head>` +
    '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#111;font-family:Arial,sans-serif">' +
    '<div style="text-align:center;padding:2rem;border:0.25rem solid #222;border-radius:0.25rem;max-width:26rem">' +
    `<h1 style="color:#c428a3;font-weight:normal">${title}</h1>` +
    `${body}` +
    '<p><a href="https://electricairshipping.com" style="color:#ff9900">electricairshipping.com</a></p>' +
    '</div></body></html>',
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );

const p = (text) => `<p style="color:#eaeaea">${text}</p>`;

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get('t') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(token)) {
    return page('Link not valid', p('This confirmation link is incomplete or malformed.'));
  }
  try {
    const row = await env.DB
      .prepare("UPDATE newsletter SET verified = 1, confirmed_utc = datetime('now'), token = NULL WHERE token = ?1 RETURNING source, nl_consent")
      .bind(token)
      .first();

    if (!row) {
      return page('Link not valid',
        p('This link was already used or has been superseded by a newer signup. Signing up again sends a fresh one.'));
    }

    if (row.source === 'design-doc') {
      const doc = env.GATE_DOC_URL ?? 'https://electricairshipping.com/knowledgebase';
      return page('You asked nicely ✓',
        p(`Here's the <a href="${doc}" style="color:#ff9900">Sunship Conceptual Design</a>.`) +
        (row.nl_consent ? p('You\'ll also receive the EAS newsletter at this address.') : ''));
    }

    return page("You're confirmed ✓", p('Thanks — you\'ll receive the EAS newsletter at this address.'));
  } catch {
    return page('Something went wrong', p('Please try the link again in a minute.'));
  }
}
