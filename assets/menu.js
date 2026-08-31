/* Electric Air Shipping — the top bar's sections menu.
 *
 * Injects its own markup, the same way newsletter.js does, so the button and
 * its panel exist in exactly ONE place. A page opts in with a single script
 * tag; it does not carry any menu markup of its own. Adding a section later
 * means adding one line to SECTIONS below, and every page gets it.
 *
 * Why a menu at all, for one link: the bar already holds CONTACT and RECEIVE,
 * and a third word overflows a 390px phone (measured). The menu keeps the bar
 * fixed-width no matter how many sections there are.
 */
(function () {
    'use strict';

    var SECTIONS = [
        { label: 'NEWS', href: '/news/', track: 'news' }
    ];

    function build() {
        var nav = document.querySelector('.topbar-nav');
        if (!nav || nav.querySelector('.menu-btn')) return;

        var wrap = document.createElement('div');
        wrap.className = 'menu-wrap';

        var btn = document.createElement('button');
        btn.className = 'menu-btn';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Sections');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-haspopup', 'true');
        btn.innerHTML = '<span></span><span></span><span></span>';

        var panel = document.createElement('div');
        panel.className = 'menu-panel';
        panel.hidden = true;
        SECTIONS.forEach(function (s) {
            var a = document.createElement('a');
            a.href = s.href;
            a.textContent = s.label;
            if (s.track) a.setAttribute('data-track', s.track);
            panel.appendChild(a);
        });

        wrap.appendChild(btn);
        wrap.appendChild(panel);
        nav.appendChild(wrap);

        function close() {
            panel.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
            wrap.classList.remove('open');
        }
        function open() {
            panel.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
            wrap.classList.add('open');
        }

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            panel.hidden ? open() : close();
        });
        document.addEventListener('click', function (e) {
            if (!wrap.contains(e.target)) close();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !panel.hidden) { close(); btn.focus(); }
        });
        // A link inside the panel should not leave the panel open behind it.
        panel.addEventListener('click', close);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build);
    } else {
        build();
    }
})();
