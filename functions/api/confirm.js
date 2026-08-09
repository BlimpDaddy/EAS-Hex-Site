/**
 * Newsletter confirmation endpoint — GET /api/confirm?t=TOKEN
 *
 * The link from the confirmation email lands here. A valid token flips its row
 * to verified=1 and is cleared (single use). The response is a tiny standalone
 * page in the site's palette; no JS, no assets.
 */

const page = (title, body) =>
  new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${title} — Electric Air Shipping</title></head>` +
    '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#111;font-family:Arial,sans-serif">' +
    '<div style="text-align:center;padding:2rem;border:0.25rem solid #222;border-radius:0.25rem;max-width:26rem">' +
    `<h1 style="color:#c628a5;font-weight:normal">${title}</h1>` +
    `<p style="color:#eaeaea">${body}</p>` +
    '<p><a href="https://electricairshipping.com" style="color:#ff9900">electricairshipping.com</a></p>' +
    '</div></body></html>',
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get('t') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(token)) {
    return page('Link not valid', 'This confirmation link is incomplete or malformed.');
  }
  try {
    const r = await env.DB
      .prepare("UPDATE newsletter SET verified = 1, confirmed_utc = datetime('now'), token = NULL WHERE token = ?1")
      .bind(token)
      .run();
    return r.meta.changes > 0
      ? page("You're confirmed ✓", 'Thanks — you\'ll receive the EAS newsletter at this address.')
      : page('Link not valid', 'This link was already used or has been superseded by a newer signup. Signing up again sends a fresh one.');
  } catch {
    return page('Something went wrong', 'Please try the link again in a minute.');
  }
}
