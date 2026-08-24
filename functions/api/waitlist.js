/**
 * Signup endpoint — Cloudflare Pages Function.
 *
 * POST /api/waitlist  { email, tsToken, source?, nlConsent? }
 *   source: 'newsletter' (default — the RECEIVE modal)
 *         | 'design-doc' (the hex-6 gate's ASK NICELY)
 *   nlConsent: design-doc only — the explicit, unticked-by-default box.
 *              RECEIVE signups are newsletter consent by definition.
 *
 *   → { ok: true,  status: 'sent' }       new signup, confirmation email sent
 *   → { ok: true,  status: 'resent' }     unconfirmed — confirmation re-sent
 *   → { ok: true,  status: 'already' }    newsletter: already confirmed
 *   → { ok: true,  status: 'code-sent' }  design-doc: already confirmed, the
 *                                         access code was emailed (never
 *                                         shown on screen — a stranger
 *                                         entering your address gets nothing)
 *   → { ok: false, error: 'invalid' | 'turnstile' | 'email' | 'server' }
 *
 * CONSENT MODEL — two independent flags, never conflated:
 *   verified   — the address's owner clicked the confirmation link
 *   nl_consent — the person explicitly asked for the newsletter
 * Newsletter sends go ONLY to rows with BOTH:
 *   SELECT email FROM newsletter WHERE verified = 1 AND nl_consent = 1;
 * Requesting the design document is NOT newsletter consent. Consent can be
 * added by a later request with the box ticked, never silently removed.
 *
 * Double opt-in: a signup stores verified=0 plus a one-time token and emails
 * a confirmation link (/api/confirm?t=TOKEN). Design-doc confirmations show
 * the access code on the confirmation page — behind the click on purpose, so
 * every request becomes a verified address (the Spam Act trail and the
 * lead-gen moment are the same mechanism).
 *
 * Bindings/secrets on the WEBSITE Pages project:
 *   DB               — D1 database (eas_newsletter)
 *   TURNSTILE_SECRET — Turnstile secret key
 *   RESEND_API_KEY   — Resend sending-access key
 *   GATE_PASSWORD    — the access code (for the code-sent email)
 */

async function ensureSchema(db) {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS newsletter (email TEXT PRIMARY KEY, added_utc TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, token TEXT, confirmed_utc TEXT)'
  );
  // Migrate-in-place; "duplicate column" just means the work is done.
  // nl_consent defaults to 1: every pre-existing row signed up through
  // RECEIVE, which is explicit newsletter consent.
  for (const col of [
    'verified INTEGER NOT NULL DEFAULT 0',
    'token TEXT',
    'confirmed_utc TEXT',
    "source TEXT DEFAULT 'newsletter'",
    'nl_consent INTEGER NOT NULL DEFAULT 1',
    'doc_alert_utc TEXT',
  ]) {
    try { await db.exec(`ALTER TABLE newsletter ADD COLUMN ${col}`); } catch { /* exists */ }
  }
}

const wrap = (inner) =>
  '<div style="font-family:Arial,sans-serif;max-width:34em;margin:0 auto;color:#222">' +
  '<h2 style="color:#c428a3">Electric Air Shipping</h2>' + inner + '</div>';

async function sendEmail(env, to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: 'EAS Newsletter <newsletter@electricairshipping.com>',
      reply_to: 'contact@electricairshipping.com',
      to: [to],
      subject,
      html,
    }),
  });
  return res.ok;
}

function confirmationEmail(env, email, token, source) {
  const link = `https://electricairshipping.com/api/confirm?t=${token}`;
  const button =
    `<p><a href="${link}" style="display:inline-block;background:#c428a3;color:#fff;padding:0.6em 1.2em;border-radius:4px;text-decoration:none">Confirm</a></p>` +
    `<p style="font-size:0.85em;color:#666">Or paste this link into your browser:<br>${link}</p>` +
    '<p style="font-size:0.85em;color:#666">If this wasn\'t you, simply ignore this email — the address will never be mailed again.</p>';
  return source === 'design-doc'
    ? sendEmail(env, email, 'Your EAS access code',
        wrap('<p>You asked nicely. Confirm this address and your access code appears on the very next page.</p>' + button))
    : sendEmail(env, email, 'EAS Newsletter',
        wrap('<p>Hi there legend — you (or someone using this address) asked to receive the EAS newsletter.</p>' + button));
}

// The warmest lead the site produces, delivered instead of sitting silently
// in D1. Fire-and-forget via waitUntil — a slow or failed alert must never
// delay or break the visitor's own request.
//
// Deduped to ONE alert per address per 24h (doc_alert_utc): a prankster
// re-requesting 400 times produces one email, not 400. The stamp is written
// only after a successful send, so a failed alert retries on the next
// request instead of going silent for a day.
function shouldAlert(existing) {
  if (!existing || !existing.doc_alert_utc) return true;
  const last = Date.parse(existing.doc_alert_utc.replace(' ', 'T') + 'Z');
  return !Number.isFinite(last) || Date.now() - last > 24 * 3600 * 1000;
}

function alertToby(context, env, email, nlConsent, status) {
  const detail = {
    'sent': 'New requester — confirmation email pending their click.',
    'resent': 'Repeat request from a still-unconfirmed address — confirmation re-sent.',
    'code-sent': 'Already-verified address — the access code went straight to them.',
  }[status] ?? status;
  context.waitUntil((async () => {
    const sent = await sendEmail(env, 'contact@electricairshipping.com',
      `Ask nicely: ${email}`,
      wrap(
        '<p>Someone asked nicely for the conceptual design.</p>' +
        `<p><b>${email}</b></p>` +
        `<p>${detail}<br>Newsletter box: ${nlConsent ? 'ticked' : 'not ticked'}.</p>`
      ));
    if (sent) {
      await env.DB
        .prepare("UPDATE newsletter SET doc_alert_utc = datetime('now') WHERE email = ?1")
        .bind(email)
        .run();
    }
  })().catch(() => { /* the lead is still in D1 */ }));
}

function codeEmail(env, email, joinToken) {
  // No "again" — this path serves anyone already verified, including
  // newsletter subscribers asking for the document the FIRST time.
  //
  // joinToken (present only when the row lacks newsletter consent) makes the
  // invitation genuinely one-click: the address is already verified as this
  // recipient's, so clicking IS express consent — no form, no re-entry.
  const join = joinToken
    ? `<p style="margin-top:1.5em">Want the story as it unfolds? <a href="https://electricairshipping.com/api/join?t=${joinToken}">Join the EAS newsletter</a> — one click, that's it.</p>`
    : '';
  return sendEmail(env, email, 'Your EAS access code',
    wrap(
      '<p>You asked nicely. Your access code:</p>' +
      `<p style="font-size:1.4em"><b>${env.GATE_PASSWORD}</b></p>` +
      '<p>Use it on the <a href="https://electricairshipping.com/knowledgebase">EAS knowledge base</a>, point 6.</p>' +
      join
    ));
}

export async function onRequestPost(context) {
  const { request, env } = context;   // full context kept for waitUntil
  let email, tsToken, source, nlConsent;
  try {
    const body = await request.json();
    email = String(body.email ?? '').trim().toLowerCase();
    tsToken = String(body.tsToken ?? '');
    source = body.source === 'design-doc' ? 'design-doc' : 'newsletter';
    // RECEIVE is newsletter consent by definition; the gate's box is explicit.
    nlConsent = source === 'newsletter' ? 1 : (body.nlConsent ? 1 : 0);
  } catch {
    return Response.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return Response.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  // Turnstile — no secret configured means closed, not open.
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
      .prepare('SELECT verified, nl_consent, doc_alert_utc FROM newsletter WHERE email = ?1')
      .bind(email)
      .first();

    // Consent and doc-interest only ever ratchet upward here — a design-doc
    // request never cancels a newsletter subscription, and vice versa.
    if (existing) {
      await env.DB
        .prepare('UPDATE newsletter SET nl_consent = MAX(nl_consent, ?2), source = CASE WHEN ?3 = \'design-doc\' THEN \'design-doc\' ELSE source END WHERE email = ?1')
        .bind(email, nlConsent, source)
        .run();
    }

    if (existing && existing.verified) {
      if (source === 'design-doc') {
        // If the row still lacks newsletter consent, the code email carries a
        // one-click join link. The token is minted only for a verified row,
        // so /api/join can treat the click as the address owner's consent.
        let joinToken = null;
        if (!Math.max(existing.nl_consent ?? 0, nlConsent)) {
          joinToken = crypto.randomUUID();
          await env.DB
            .prepare('UPDATE newsletter SET token = ?2 WHERE email = ?1')
            .bind(email, joinToken)
            .run();
        }
        if (!env.GATE_PASSWORD || !(await codeEmail(env, email, joinToken))) {
          return Response.json({ ok: false, error: 'email' }, { status: 502 });
        }
        if (shouldAlert(existing)) alertToby(context, env, email, nlConsent, 'code-sent');
        return Response.json({ ok: true, status: 'code-sent' });
      }
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
        .prepare("INSERT INTO newsletter (email, added_utc, verified, token, source, nl_consent) VALUES (?1, datetime('now'), 0, ?2, ?3, ?4)")
        .bind(email, token, source, nlConsent)
        .run();
    }

    if (!(await confirmationEmail(env, email, token, source))) {
      return Response.json({ ok: false, error: 'email' }, { status: 502 });
    }
    if (source === 'design-doc' && shouldAlert(existing)) {
      alertToby(context, env, email, nlConsent, existing ? 'resent' : 'sent');
    }
    return Response.json({ ok: true, status: existing ? 'resent' : 'sent' });
  } catch {
    return Response.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
