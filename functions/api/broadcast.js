/**
 * Jellyfish broadcast — POST /api/broadcast
 *
 * Emails a published Jellyfish issue to everyone on the list. Run it AFTER
 * the issue is live on the site, with Newsletter/send-issue.py (which reads
 * the issue's card from news/index.html, so the email says exactly what the
 * card says and no new words get written).
 *
 *   Authorization: Bearer BROADCAST_KEY
 *   { issue: "004", month: "November 2026",
 *     summaryHtml: "...", summaryText: "...",
 *     mode: "dry" | "test" | "send", test?: "you@example.com" }
 *
 *   dry  — sends nothing. Returns how many addresses would get it.
 *   test — sends one copy to `test` only. Records nothing.
 *   send — sends to every address with verified = 1 AND nl_consent = 1 that
 *          has not already had this issue. Works in chunks; returns
 *          { sent, remaining } and the script calls again until remaining
 *          is 0. Safe to re-run: each send is recorded per address per
 *          issue, so nobody gets an issue twice.
 *
 * Refuses to send if the issue page isn't live yet (it must contain
 * "No. NNN"), so an email can never point at a missing page.
 *
 * Every email has a signed unsubscribe link in the footer and in the
 * List-Unsubscribe headers (one-click, RFC 8058) - see unsubscribe.js.
 *
 * Secrets on the WEBSITE Pages project:
 *   DB             — D1 database (eas_newsletter), already bound
 *   RESEND_API_KEY — already set
 *   BROADCAST_KEY  — any long random string; also set on your computer as
 *                    the EAS_BROADCAST_KEY environment variable for the script
 *   UNSUB_SECRET   — any long random string; must match unsubscribe.js
 */

const SITE = 'https://electricairshipping.com';
const FROM = 'EAS Newsletter <newsletter@electricairshipping.com>';
const BATCH = 100;          // Resend's batch maximum
const BATCHES_PER_CALL = 10; // keeps one call well inside the Functions limits

const json = (obj, status = 200) => Response.json(obj, { status });

function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const b64url = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function unsubLink(env, email) {
  return `${SITE}/api/unsubscribe?e=${b64url(email)}&s=${await hmacHex(env.UNSUB_SECRET, email)}`;
}

function emailHtml({ issue, month, summaryHtml, unsub }) {
  const page = `${SITE}/news/jellyfish/${issue}/`;
  return '<div style="font-family:Arial,sans-serif;max-width:34em;margin:0 auto;color:#222">' +
    '<h2 style="color:#c428a3">Electric Air Shipping</h2>' +
    `<p><a href="${page}"><img src="${page}cover.jpg" width="420" alt="Jellyfish No. ${issue} cover" style="width:100%;max-width:420px;height:auto;border:0;display:block"></a></p>` +
    `<p style="font-size:1.2em;margin:1em 0 0.2em"><b>Jellyfish No. ${issue}</b></p>` +
    `<p style="color:#666;margin:0 0 1em">${month}</p>` +
    `<p style="line-height:1.5">${summaryHtml}</p>` +
    `<p><a href="${page}" style="display:inline-block;background:#c428a3;color:#fff;padding:0.6em 1.2em;border-radius:4px;text-decoration:none">Read it</a>` +
    ` &nbsp; <a href="${page}jellyfish-${issue}.pdf" style="color:#c428a3">Download PDF</a></p>` +
    '<p style="font-size:0.8em;color:#888;margin-top:2.5em;border-top:1px solid #eee;padding-top:1em">' +
    'Electric Air Shipping Pty Ltd, Adelaide, South Australia &middot; ' +
    '<a href="mailto:contact@electricairshipping.com" style="color:#888">contact@electricairshipping.com</a> &middot; ' +
    `<a href="${unsub}" style="color:#888">Unsubscribe</a></p>` +
    '</div>';
}

function emailText({ issue, month, summaryText, unsub }) {
  const page = `${SITE}/news/jellyfish/${issue}/`;
  return `Jellyfish No. ${issue}\n${month}\n\n${summaryText}\n\nRead it: ${page}\n` +
    `Download PDF: ${page}jellyfish-${issue}.pdf\n\n--\n` +
    'Electric Air Shipping Pty Ltd, Adelaide, South Australia\n' +
    `contact@electricairshipping.com\nUnsubscribe: ${unsub}\n`;
}

async function buildEmail(env, msg, to) {
  const unsub = await unsubLink(env, to);
  return {
    from: FROM,
    reply_to: 'contact@electricairshipping.com',
    to: [to],
    subject: `Jellyfish No. ${msg.issue} – ${msg.month}`,
    html: emailHtml({ ...msg, unsub }),
    text: emailText({ ...msg, unsub }),
    headers: {
      'List-Unsubscribe': `<${unsub}>, <mailto:contact@electricairshipping.com?subject=Unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

async function sendBatch(env, emails, idemKey) {
  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      'idempotency-key': idemKey,
    },
    body: JSON.stringify(emails),
  });
  return { ok: res.ok, status: res.status, body: res.ok ? null : await res.text() };
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function onRequestPost({ request, env }) {
  const auth = request.headers.get('authorization') ?? '';
  if (!env.BROADCAST_KEY || !same(auth, `Bearer ${env.BROADCAST_KEY}`)) {
    return json({ ok: false, error: 'unauthorised' }, 401);
  }
  if (!env.RESEND_API_KEY || !env.UNSUB_SECRET) {
    return json({ ok: false, error: 'missing RESEND_API_KEY or UNSUB_SECRET' }, 500);
  }

  let msg, mode, test;
  try {
    const b = await request.json();
    msg = {
      issue: String(b.issue ?? ''),
      month: String(b.month ?? ''),
      summaryHtml: String(b.summaryHtml ?? ''),
      summaryText: String(b.summaryText ?? ''),
    };
    mode = ['dry', 'test', 'send'].includes(b.mode) ? b.mode : 'dry';
    test = String(b.test ?? '').trim().toLowerCase();
  } catch {
    return json({ ok: false, error: 'bad json' }, 400);
  }
  if (!/^\d{3}$/.test(msg.issue) || !msg.month || !msg.summaryHtml) {
    return json({ ok: false, error: 'need issue (e.g. "004"), month and summary' }, 400);
  }

  // The issue page must be live. Status codes can't be trusted (the site
  // answers 200 for anything), so look for the issue's own number.
  try {
    const live = await fetch(`${SITE}/news/jellyfish/${msg.issue}/`, { redirect: 'follow' });
    if (!(await live.text()).includes(`No. ${msg.issue}`)) {
      return json({ ok: false, error: `issue page /news/jellyfish/${msg.issue}/ is not live yet` }, 409);
    }
  } catch {
    return json({ ok: false, error: 'could not reach the issue page' }, 502);
  }

  const db = env.DB;
  await db.exec('CREATE TABLE IF NOT EXISTS newsletter_sends (issue TEXT NOT NULL, email TEXT NOT NULL, sent_utc TEXT NOT NULL, PRIMARY KEY (issue, email))');

  if (mode === 'test') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(test)) return json({ ok: false, error: 'test needs an address' }, 400);
    const r = await sendBatch(env, [await buildEmail(env, msg, test)], `jf-${msg.issue}-test-${Date.now()}`);
    return r.ok ? json({ ok: true, mode, sentTo: test }) : json({ ok: false, error: 'resend', detail: r.body }, 502);
  }

  const pendingSql =
    'SELECT email FROM newsletter WHERE verified = 1 AND nl_consent = 1 ' +
    'AND email NOT IN (SELECT email FROM newsletter_sends WHERE issue = ?1) ORDER BY email';

  if (mode === 'dry') {
    const { results } = await db.prepare(pendingSql).bind(msg.issue).all();
    return json({ ok: true, mode, wouldSend: results.length });
  }

  // mode === 'send'
  const { results } = await db.prepare(pendingSql + ` LIMIT ${BATCH * BATCHES_PER_CALL}`).bind(msg.issue).all();
  let sent = 0;
  for (let i = 0; i < results.length; i += BATCH) {
    const chunk = results.slice(i, i + BATCH).map((r) => r.email);
    const emails = await Promise.all(chunk.map((to) => buildEmail(env, msg, to)));
    // Same addresses + same issue = same key, so a retry after a crash
    // between "sent" and "recorded" can't double-send (Resend keeps keys 24h).
    const key = `jf-${msg.issue}-${(await hmacHex(env.UNSUB_SECRET, chunk.join(','))).slice(0, 32)}`;
    const r = await sendBatch(env, emails, key);
    if (!r.ok) return json({ ok: false, error: 'resend', status: r.status, detail: r.body, sent }, 502);
    await db.batch(chunk.map((e) =>
      db.prepare("INSERT OR IGNORE INTO newsletter_sends (issue, email, sent_utc) VALUES (?1, ?2, datetime('now'))").bind(msg.issue, e)));
    sent += chunk.length;
    if (i + BATCH < results.length) await pause(600); // Resend allows ~2 requests a second
  }
  const left = await db.prepare(`SELECT COUNT(*) AS n FROM (${pendingSql})`).bind(msg.issue).first();
  return json({ ok: true, mode, sent, remaining: left?.n ?? 0 });
}
