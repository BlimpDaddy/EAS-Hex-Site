/**
 * Event counting — the whole client side.
 *
 * Counts seven things and knows nothing about anyone: each beacon is an
 * event name, full stop. No cookies, no IDs, no page URLs. sendBeacon is
 * fire-and-forget — it cannot slow a click or a page load, and it survives
 * the page being left mid-navigation.
 *
 * Each event counts once per session (sessionStorage), so one enthusiastic
 * scroller is one visitor, not ten.
 *
 * Usage: any element with data-track="name" counts its clicks; slide 15
 * counts itself when actually seen; the gate script calls window.easTrack
 * directly for its two events.
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

    // "Reached the end of the deck" — slide 15 genuinely on screen, not
    // merely present in the document.
    const last = document.getElementById('slide-15');
    if (last && 'IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            if (entries.some((x) => x.isIntersecting)) {
                track('deck_end');
                io.disconnect();
            }
        }, { threshold: 0.5 });
        io.observe(last);
    }
})();
