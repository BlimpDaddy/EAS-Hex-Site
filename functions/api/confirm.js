/**
 * Confirmation endpoint — GET /api/confirm?t=TOKEN
 *
 * The link from the confirmation email lands here. A valid token flips its
 * row to verified=1 and is cleared (single use).
 *
 * Design-doc requests get their ACCESS CODE on this page — deliberately
 * behind the click, so receiving the code and becoming a verified address
 * are the same act. Newsletter confirmations look exactly as before.
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
      const code = env.GATE_PASSWORD
        ? `<p style="color:#eaeaea">Your access code:</p><p style="color:#c428a3;font-size:1.6em"><b>${env.GATE_PASSWORD}</b></p>`
        : p('Your access code is on its way by email.');
      return page('You asked nicely ✓',
        code +
        p('Use it at <a href="https://electricairshipping.com/knowledgebase" style="color:#ff9900">the knowledge base</a>, point 6.') +
        (row.nl_consent ? p('You\'ll also receive the EAS newsletter at this address.') : ''));
    }

    return page("You're confirmed ✓", p('Thanks — you\'ll receive the EAS newsletter at this address.'));
  } catch {
    return page('Something went wrong', p('Please try the link again in a minute.'));
  }
}
