/**
 * One-click newsletter join — GET /api/join?t=TOKEN
 *
 * The link arrives in the access-code email, which only ever goes to an
 * already-verified address; the token is minted per-send for that row. So a
 * click here is the address owner expressly asking for the newsletter — no
 * form, no re-entry, and a clean consent trail (nl_consent flips on the
 * owner's own click, single use).
 *
 * verified = 1 is required in the WHERE: a pending confirmation token can
 * never be spent as a join.
 */

const page = (title, body) =>
  new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${title} — Electric Air Shipping</title></head>` +
    '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#111;font-family:Arial,sans-serif">' +
    '<div style="text-align:center;padding:2rem;border:0.25rem solid #222;border-radius:0.25rem;max-width:26rem">' +
    `<h1 style="color:#c428a3;font-weight:normal">${title}</h1>` +
    `<p style="color:#eaeaea">${body}</p>` +
    '<p><a href="https://electricairshipping.com" style="color:#ff9900">electricairshipping.com</a></p>' +
    '</div></body></html>',
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get('t') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(token)) {
    return page('Link not valid', 'This link is incomplete or malformed.');
  }
  try {
    const r = await env.DB
      .prepare('UPDATE newsletter SET nl_consent = 1, token = NULL WHERE token = ?1 AND verified = 1')
      .bind(token)
      .run();
    return r.meta.changes > 0
      ? page("You're on the list ✓", 'The EAS newsletter will arrive at this address. Welcome aboard.')
      : page('Link not valid', 'This link was already used or has expired. Asking nicely again sends a fresh one.');
  } catch {
    return page('Something went wrong', 'Please try the link again in a minute.');
  }
}
