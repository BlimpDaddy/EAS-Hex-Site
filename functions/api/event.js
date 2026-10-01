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
 *
 * Retired 2026-10 with the homepage deck: explore, deck_end. Their old rows
 * stay in the table; new ones are refused.
 */

const EVENTS = new Set([
    'kb',           // Knowledge Base: hero button or menu
    'contact',      // CONTACT in the top bar
    'receive',      // RECEIVE: top bar, or the homepage Jellyfish box
    'receive-news', // the Jellyfish box on the news page
    'news',         // NEWS in the menu, or All news on the homepage
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
