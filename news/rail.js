/* Electric Air Shipping — arrows for the news rails.
 *
 * Injects its own markup, the way assets/menu.js does, so a new strand gets
 * arrows with no extra HTML: give it a .strand-head and a .rail and this finds
 * it. A rail that fits on screen hides its arrows entirely rather than showing
 * two dead buttons — which is the state the page is in today, with one card in
 * each rail.
 *
 * PROGRESSIVE: the rails are native overflow-x. Touch swipe, trackpad, the
 * scrollbar and the keyboard all work whether or not this file loads. The
 * arrows are the desktop affordance on top, not the mechanism.
 */
(function () {
    'use strict';

    var SVG = 'http://www.w3.org/2000/svg';

    function arrow(dir) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'rail-arrow';
        b.setAttribute('aria-label', dir < 0 ? 'Scroll back to newer' : 'Scroll on to older');
        var svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('aria-hidden', 'true');
        var path = document.createElementNS(SVG, 'path');
        path.setAttribute('d', dir < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7');
        svg.appendChild(path);
        b.appendChild(svg);
        return b;
    }

    /* One card plus one gap — so a click lands cleanly on the next snap point
     * instead of drifting out of step with the scroll-snap. */
    function step(rail) {
        var li = rail.querySelector('li');
        if (!li) return rail.clientWidth;
        var gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
        return li.getBoundingClientRect().width + gap;
    }

    function build(strand) {
        var rail = strand.querySelector('.rail');
        var head = strand.querySelector('.strand-head');
        if (!rail || !head || head.querySelector('.rail-nav')) return;

        var nav = document.createElement('div');
        nav.className = 'rail-nav';
        var prev = arrow(-1);
        var next = arrow(1);
        nav.appendChild(prev);
        nav.appendChild(next);
        head.appendChild(nav);

        var reduced = matchMedia('(prefers-reduced-motion: reduce)');

        function go(dir) {
            rail.scrollBy({
                left: dir * step(rail),
                behavior: reduced.matches ? 'auto' : 'smooth'
            });
        }
        prev.addEventListener('click', function () { go(-1); });
        next.addEventListener('click', function () { go(1); });

        function sync() {
            /* Sub-pixel widths mean scrollLeft never quite reaches the end, so
             * both edges get a pixel of slack. */
            var max = rail.scrollWidth - rail.clientWidth;
            nav.hidden = max <= 1;
            prev.disabled = rail.scrollLeft <= 1;
            next.disabled = rail.scrollLeft >= max - 1;
        }
        rail.addEventListener('scroll', sync, { passive: true });
        addEventListener('resize', sync);
        /* Cards are sized off images that may not have arrived yet, so the
         * overflow test is re-run once everything has loaded. */
        addEventListener('load', sync);
        sync();
    }

    function init() {
        document.querySelectorAll('.strand').forEach(build);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
