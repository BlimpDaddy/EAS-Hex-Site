/**
 * Unsubscribe — /api/unsubscribe?e=EMAIL_B64URL&s=SIGNATURE
 *
 * Every Jellyfish email carries this link (in the footer, and in the
 * List-Unsubscribe header that Gmail, Outlook and Apple Mail turn into their
 * own "Unsubscribe" button). The Spam Act requires a working one.
 *
 *   GET  — shows a page with one button. It does NOT unsubscribe by itself:
 *          mail scanners open every link in an email, and a GET that acted
 *          would quietly unsubscribe people who never clicked anything.
 *   POST — the button, or a mail provider's one-click request (RFC 8058,
 *          body "List-Unsubscribe=One-Click"). Sets nl_consent = 0.
 *
 * The link is signed (HMAC-SHA256 of the address with UNSUB_SECRET), so
 * nobody can unsubscribe an address they don't hold a link for. No token is
 * stored; the same secret signs the links in /api/broadcast.
 *
 * Signing up again through RECEIVE sets nl_consent back to 1 (waitlist.js
 * ratchets it upward), so leaving is never permanent against someone's will.
 *
 * Secrets on the WEBSITE Pages project:
 *   DB           — D1 database (eas_newsletter), already bound
 *   UNSUB_SECRET — any long random string; must match what broadcast.js uses
 */

const page = (title, body) =>
  new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
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

const esc = (s) => s.replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fromB64url(s) {
  try {
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
  } catch { return null; }
}

async function sign(secret, email) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time compare, so the signature can't be guessed a byte at a time.
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function check(request, env) {
  const url = new URL(request.url);
  const email = fromB64url(url.searchParams.get('e') ?? '');
  const sig = url.searchParams.get('s') ?? '';
  if (!env.UNSUB_SECRET || !email || !/^[0-9a-f]{64}$/.test(sig)) return null;
  return same(await sign(env.UNSUB_SECRET, email), sig) ? email : null;
}

const invalid = () => page('Link not valid',
  p('This unsubscribe link is incomplete. Email <a href="mailto:contact@electricairshipping.com" style="color:#ff9900">contact@electricairshipping.com</a> and we\'ll take you off the list by hand.'));

export async function onRequestGet({ request, env }) {
  const email = await check(request, env);
  if (!email) return invalid();
  return page('Unsubscribe',
    p(`Stop sending Jellyfish to <b>${esc(email)}</b>?`) +
    '<form method="post"><button type="submit" style="font:inherit;background:#c428a3;color:#fff;border:0;padding:0.6em 1.2em;border-radius:4px;cursor:pointer">Unsubscribe</button></form>');
}

export async function onRequestPost({ request, env }) {
  const email = await check(request, env);
  if (!email) return invalid();
  try {
    try { await env.DB.exec('ALTER TABLE newsletter ADD COLUMN unsub_utc TEXT'); } catch { /* exists */ }
    await env.DB
      .prepare("UPDATE newsletter SET nl_consent = 0, unsub_utc = datetime('now') WHERE email = ?1")
      .bind(email)
      .run();
  } catch {
    return page('Something went wrong', p('Please try the link again in a minute.'));
  }
  return page('Unsubscribed ✓',
    p(`Jellyfish won't be sent to <b>${esc(email)}</b> any more.`) +
    p('Changed your mind? RECEIVE on any page signs you back up.'));
}
