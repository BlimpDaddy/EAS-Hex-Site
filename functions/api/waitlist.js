/**
 * Newsletter signup endpoint — Cloudflare Pages Function.
 *
 * POST /api/waitlist  { email, tsToken }
 *   → { ok: true,  status: 'sent' }      new signup, confirmation email sent
 *   → { ok: true,  status: 'resent' }    already signed up but unconfirmed — email re-sent
 *   → { ok: true,  status: 'already' }   already confirmed
 *   → { ok: false, error: 'invalid' | 'turnstile' | 'email' | 'server' }
 *
 * Double opt-in: a signup stores verified=0 plus a one-time token and emails a
 * confirmation link (/api/confirm?t=TOKEN). Only clicked addresses flip to
 * verified=1 — anything unverified never gets mailed a newsletter. This is both
 * the anti-forgery step (nobody can subscribe someone else's address) and the
 * Spam Act consent trail.
 *
 * Bindings/secrets required on the WEBSITE Pages project:
 *   DB               — D1 database (eas_newsletter)
 *   TURNSTILE_SECRET — Turnstile secret key
 *   RESEND_API_KEY   — Resend sending-access key (domain verified 2026-08-09)
 *
 * Reading the list: D1 console → SELECT * FROM newsletter ORDER BY added_utc;
 * Mail ONLY WHERE verified = 1.
 */

async function ensureSchema(db) {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS newsletter (email TEXT PRIMARY KEY, added_utc TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, token TEXT, confirmed_utc TEXT)'
  );
  // Older deployments created the table without the opt-in columns — add them
  // in place; "duplicate column" errors just mean the work is already done.
  for (const col of ['verified INTEGER NOT NULL DEFAULT 0', 'token TEXT', 'confirmed_utc TEXT']) {
    try { await db.exec(`ALTER TABLE newsletter ADD COLUMN ${col}`); } catch { /* exists */ }
  }
}

async function sendConfirmation(env, email, token) {
  const link = `https://electricairshipping.com/api/confirm?t=${token}`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: 'EAS Newsletter <newsletter@electricairshipping.com>',
      reply_to: 'contact@electricairshipping.com',
      to: [email],
      subject: 'EAS Newsletter',
      html:
        '<div style="font-family:Arial,sans-serif;max-width:34em;margin:0 auto;color:#222">' +
        '<h2 style="color:#c628a5">Electric Air Shipping</h2>' +
        '<p>Hi there legend — you (or someone using this address) asked to receive the EAS newsletter.</p>' +
        `<p><a href="${link}" style="display:inline-block;background:#c628a5;color:#fff;padding:0.6em 1.2em;border-radius:4px;text-decoration:none">Confirm signup</a></p>` +
        `<p style="font-size:0.85em;color:#666">Or paste this link into your browser:<br>${link}</p>` +
        '<p style="font-size:0.85em;color:#666">If this wasn\'t you, simply ignore this email — the address will never be mailed again.</p>' +
        '</div>',
    }),
  });
  return res.ok;
}

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
  if (!env.TURNSTILE_SECRET || !env.RESEND_API_KEY) {
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
    await ensureSchema(env.DB);
    const existing = await env.DB
      .prepare('SELECT verified FROM newsletter WHERE email = ?1')
      .bind(email)
      .first();

    if (existing && existing.verified) {
      return Response.json({ ok: true, status: 'already' });
    }

    const token = crypto.randomUUID();
    if (existing) {
      await env.DB
        .prepare('UPDATE newsletter SET token = ?2 WHERE email = ?1')
        .bind(email, token)
        .run();
    } else {
      await env.DB
        .prepare("INSERT INTO newsletter (email, added_utc, verified, token) VALUES (?1, datetime('now'), 0, ?2)")
        .bind(email, token)
        .run();
    }

    if (!(await sendConfirmation(env, email, token))) {
      return Response.json({ ok: false, error: 'email' }, { status: 502 });
    }
    return Response.json({ ok: true, status: existing ? 'resent' : 'sent' });
  } catch {
    return Response.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
