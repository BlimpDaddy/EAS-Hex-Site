/**
 * Newsletter signup endpoint — Cloudflare Pages Function.
 *
 * POST /api/waitlist  { email: "someone@example.com" }
 *   → { ok: true, added: true }    stored
 *   → { ok: true, added: false }   was already on the list
 *   → { ok: false, error: ... }    invalid input or server trouble
 *
 * Storage: D1 database bound to this Pages project as `DB` (decided in
 * AGENTS/INFRASTRUCTURE.md — D1 over KV because a mailing list wants querying,
 * deduping and exporting). The table is created on first use, so no console SQL
 * is ever needed:
 *   newsletter(email TEXT PRIMARY KEY, added_utc TEXT)
 *
 * Reading the list: Cloudflare dashboard → Storage & Databases → D1 →
 * eas-newsletter → Console → SELECT * FROM newsletter ORDER BY added_utc;
 */
export async function onRequestPost({ request, env }) {
  let email, tsToken;
  try {
    const body = await request.json();
    email = String(body.email ?? '').trim().toLowerCase();
    tsToken = String(body.tsToken ?? '');
  } catch {
    return Response.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return Response.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  // Turnstile verification — a signup only counts if Cloudflare vouches the
  // token came from a real visitor. No TURNSTILE_SECRET configured = closed,
  // not open: better a broken form we notice than a silently unguarded list.
  if (!env.TURNSTILE_SECRET) {
    return Response.json({ ok: false, error: 'server' }, { status: 500 });
  }
  try {
    const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET,
        response: tsToken,
        remoteip: request.headers.get('cf-connecting-ip') ?? undefined,
      }),
    });
    if (!(await verify.json()).success) {
      return Response.json({ ok: false, error: 'turnstile' }, { status: 403 });
    }
  } catch {
    return Response.json({ ok: false, error: 'server' }, { status: 500 });
  }
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS newsletter (email TEXT PRIMARY KEY, added_utc TEXT NOT NULL)'
    );
    const r = await env.DB
      .prepare("INSERT OR IGNORE INTO newsletter (email, added_utc) VALUES (?1, datetime('now'))")
      .bind(email)
      .run();
    return Response.json({ ok: true, added: r.meta.changes > 0 });
  } catch {
    return Response.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
