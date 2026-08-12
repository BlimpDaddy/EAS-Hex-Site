/**
 * Analytics counter — POST /api/event  (body: the event name, plain text)
 *   → 204 always on accepted names, 400 otherwise. No response body.
 *
 * Counts clicks and milestones, nothing else. Each row is a timestamp and an
 * event name — no IP, no user agent, no cookie, no identifier of any kind.
 * That is deliberate: the table cannot identify anyone, so it needs no
 * consent banner and the data lives in EAS's own D1, not a third party.
 *
 * The allowlist is the schema: junk names bounce, so the table stays
 * queryable. Sent via navigator.sendBeacon from assets/analytics.js.
 *
 * Reading it (D1 console):
 *   -- daily counts per event
 *   SELECT date(ts) d, event, COUNT(*) n FROM events
 *   GROUP BY d, event ORDER BY d DESC, n DESC;
 *   -- deck completion vs entry
 *   SELECT (SELECT COUNT(*) FROM events WHERE event='deck_end') * 100.0
 *        / MAX(1, (SELECT COUNT(*) FROM events WHERE event='explore'))
 *        AS pct_reached_end;
 */

const EVENTS = new Set([
    'explore',      // hero: EXPLORE THE EAS PROJECT
    'kb',           // any EXPLORE THE KNOWLEDGE BASE button
    'deck_end',     // slide 15 actually seen
    'contact',      // CONTACT, top bar or closing panel
    'receive',      // RECEIVE opened
    'gate_ask',     // hex 6: ASK NICELY submitted
    'gate_unlock',  // hex 6: correct password entered
]);

export async function onRequestPost({ request, env }) {
    let name;
    try {
        name = (await request.text()).trim();
    } catch {
        return new Response(null, { status: 400 });
    }
    if (!EVENTS.has(name)) return new Response(null, { status: 400 });

    try {
        await env.DB.exec(
            'CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, event TEXT NOT NULL)'
        );
        await env.DB
            .prepare("INSERT INTO events (ts, event) VALUES (datetime('now'), ?1)")
            .bind(name)
            .run();
    } catch {
        // A lost count is not worth an error a visitor could ever notice.
    }
    return new Response(null, { status: 204 });
}
