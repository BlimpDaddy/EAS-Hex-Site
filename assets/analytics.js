/**
 * Event counting — the whole client side.
 *
 * Counts a handful of things and knows nothing about anyone: each beacon is an
 * event name, full stop. No cookies, no IDs, no page URLs. sendBeacon is
 * fire-and-forget — it cannot slow a click or a page load, and it survives
 * the page being left mid-navigation.
 *
 * Each event counts once per session (sessionStorage), so one enthusiastic
 * scroller is one visitor, not ten.
 *
 * Usage: any element with data-track="name" counts its clicks; the gate
 * script calls window.easTrack directly for its two events. A name must be
 * on the allowlist in functions/api/event.js, or the server refuses it.
 */

(() => {
    const track = (name) => {
        try {
            if (sessionStorage.getItem('evt_' + name)) return;
            sessionStorage.setItem('evt_' + name, '1');
        } catch { /* private mode: count every time rather than never */ }
        try {
            navigator.sendBeacon('/api/event', name);
        } catch { /* an uncounted click is nobody's problem */ }
    };
    window.easTrack = track;

    document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-track]');
        if (el) track(el.dataset.track);
    });
})();
