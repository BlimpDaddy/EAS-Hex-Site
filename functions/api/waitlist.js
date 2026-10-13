/**
 * Signup endpoint — Cloudflare Pages Function.
 *
 * POST /api/waitlist  { email, tsToken, source?, nlConsent? }
 *   source: 'newsletter' (default — the RECEIVE modal)
 *         | 'design-doc' (knowledge base point 5's ASK NICELY)
 *   nlConsent: design-doc only — the explicit, unticked-by-default box.
 *              RECEIVE signups are newsletter consent by definition.
 *
 *   newsletter:
 *   → { ok: true,  status: 'sent' }       new signup, confirmation email sent
 *   → { ok: true,  status: 'resent' }     unconfirmed — confirmation re-sent
 *   → { ok: true,  status: 'already' }    already confirmed
 *   design-doc:
 *   → { ok: true,  url }                  the document opens at once; a copy
 *                                         of the link is emailed (at most
 *                                         once a day per address)
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
 * a confirmation link (/api/confirm?t=TOKEN).
 *
 * Design-doc requests are NOT verified before the document opens (decided
 * 2026-10-13: the old password-by-email loop cost more leads than it
 * protected). The address is stored unverified; the copy-of-the-link email is
 * what a real address is for. Ticking the newsletter box adds a confirm
 * button to that email — newsletter consent still needs the owner's click.
 *
 * Bindings/secrets on the WEBSITE Pages project:
 *   DB               — D1 database (eas_newsletter)
 *   TURNSTILE_SECRET — Turnstile secret key
 *   RESEND_API_KEY   — Resend sending-access key
 *   GATE_DOC_URL     — the Conceptual Design link (never in page source)
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
    'doc_sent_utc TEXT',
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

const confirmButton = (token) => {
  const link = `https://electricairshipping.com/api/confirm?t=${token}`;
  return `<p><a href="${link}" style="display:inline-block;background:#c428a3;color:#fff;padding:0.6em 1.2em;border-radius:4px;text-decoration:none">Confirm</a></p>` +
    `<p style="font-size:0.85em;color:#666">Or paste this link into your browser:<br>${link}</p>`;
};

function confirmationEmail(env, email, token) {
  return sendEmail(env, email, 'EAS Newsletter',
    wrap('<p>Hi there legend — you (or someone using this address) asked to receive the EAS newsletter.</p>' +
      confirmButton(token) +
      '<p style="font-size:0.85em;color:#666">If this wasn\'t you, simply ignore this email — the address will never be mailed again.</p>'));
}

// The warmest lead the site produces, delivered instead of sitting silently
// in D1. Fire-and-forget via waitUntil — a slow or failed alert must never
// delay or break the visitor's own request.
//
// Deduped to ONE alert per address per 24h (doc_alert_utc): a prankster
// re-requesting 400 times produces one email, not 400. The stamp is written
// only after a successful send, so a failed alert retries on the next
// request instead of going silent for a day.
function olderThanADay(stamp) {
  if (!stamp) return true;
  const last = Date.parse(stamp.replace(' ', 'T') + 'Z');
  return !Number.isFinite(last) || Date.now() - last > 24 * 3600 * 1000;
}

function alertToby(context, env, email, nlConsent, verified) {
  const detail = verified
    ? 'Known, verified address — the document opened.'
    : 'Document opened. Address NOT verified (it may be made up); a copy of the link was emailed to it.';
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

// The copy-of-the-link email. `extra` is one of:
//   { confirmToken } — unverified address that wants the newsletter: the
//                      confirm button is the double opt-in, same as RECEIVE.
//   { joinToken }    — verified address without consent: a one-click join
//                      (the address is already proven theirs, so the click
//                      IS express consent — see /api/join).
//   {}               — nothing to add.
function docEmail(env, email, extra) {
  const tail = extra.confirmToken
    ? '<p style="margin-top:1.5em">You also asked for the EAS newsletter — confirm this address and it\'s on its way:</p>' +
      confirmButton(extra.confirmToken)
    : extra.joinToken
      ? `<p style="margin-top:1.5em">Want the story as it unfolds? <a href="https://electricairshipping.com/api/join?t=${extra.joinToken}">Join the EAS newsletter</a> — one click, that's it.</p>`
      : '';
  return sendEmail(env, email, 'Your copy: Sunship Conceptual Design',
    wrap(
      '<p>You asked nicely. Here\'s your copy, to keep:</p>' +
      `<p style="font-size:1.2em"><a href="${env.GATE_DOC_URL}" style="color:#c428a3">Sunship Conceptual Design</a></p>` +
      tail +
      '<p style="font-size:0.85em;color:#666">If this wasn\'t you, simply ignore this email.</p>'
    ));
}

// Point 5's ASK NICELY. The visitor gets the URL in the response whatever
// happens to the emails — those run after the reply, via waitUntil.
async function designDoc(context, env, email, nlConsent, existing) {
  if (!env.GATE_DOC_URL) {
    return Response.json({ ok: false, error: 'server' }, { status: 500 });
  }
  const verified = !!(existing && existing.verified);
  const consent = Math.max(existing?.nl_consent ?? 0, nlConsent);

  if (existing) {
    // Consent and doc-interest only ever ratchet upward.
    await env.DB
      .prepare("UPDATE newsletter SET nl_consent = ?2, source = 'design-doc' WHERE email = ?1")
      .bind(email, consent)
      .run();
  } else {
    await env.DB
      .prepare("INSERT INTO newsletter (email, added_utc, verified, source, nl_consent) VALUES (?1, datetime('now'), 0, 'design-doc', ?2)")
      .bind(email, nlConsent)
      .run();
  }

  // One copy email per address per 24h, so the form can't be used to flood
  // a stranger's inbox. A token is minted only when that email will carry it.
  if (olderThanADay(existing?.doc_sent_utc)) {
    const extra = {};
    if (!verified && consent) extra.confirmToken = crypto.randomUUID();
    else if (verified && !consent) extra.joinToken = crypto.randomUUID();
    const token = extra.confirmToken ?? extra.joinToken;
    if (token) {
      await env.DB
        .prepare('UPDATE newsletter SET token = ?2 WHERE email = ?1')
        .bind(email, token)
        .run();
    }
    context.waitUntil((async () => {
      if (await docEmail(env, email, extra)) {
        await env.DB
          .prepare("UPDATE newsletter SET doc_sent_utc = datetime('now') WHERE email = ?1")
          .bind(email)
          .run();
      }
    })().catch(() => { /* the visitor already has the document */ }));
  }

  if (olderThanADay(existing?.doc_alert_utc)) alertToby(context, env, email, nlConsent, verified);
  return Response.json({ ok: true, url: env.GATE_DOC_URL });
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
      .prepare('SELECT verified, nl_consent, doc_alert_utc, doc_sent_utc FROM newsletter WHERE email = ?1')
      .bind(email)
      .first();

    if (source === 'design-doc') return await designDoc(context, env, email, nlConsent, existing);

    // Newsletter (RECEIVE). Consent only ever ratchets upward — a newsletter
    // signup never cancels a design-doc row's history, and vice versa.
    if (existing) {
      await env.DB
        .prepare('UPDATE newsletter SET nl_consent = MAX(nl_consent, ?2) WHERE email = ?1')
        .bind(email, nlConsent)
        .run();
    }

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
        .prepare("INSERT INTO newsletter (email, added_utc, verified, token, source, nl_consent) VALUES (?1, datetime('now'), 0, ?2, ?3, ?4)")
        .bind(email, token, source, nlConsent)
        .run();
    }

    if (!(await confirmationEmail(env, email, token))) {
      return Response.json({ ok: false, error: 'email' }, { status: 502 });
    }
    return Response.json({ ok: true, status: existing ? 'resent' : 'sent' });
  } catch {
    return Response.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
