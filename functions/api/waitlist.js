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
  let email;
  try {
    email = String((await request.json()).email ?? '').trim().toLowerCase();
  } catch {
    return Response.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return Response.json({ ok: false, error: 'invalid' }, { status: 400 });
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
