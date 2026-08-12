/**
 * RECEIVE — newsletter signup modal.
 *
 * Extracted from the knowledge base's inline script so the homepage and the
 * knowledge base share one copy. Injects its own markup, so a page only needs
 * to include this file and provide a trigger with [data-nl-open] (the RECEIVE
 * link in the top bar).
 *
 * Unchanged behaviour: Turnstile bot check -> POST /api/waitlist -> D1 ->
 * Resend double opt-in email -> /api/confirm. Only the address's owner can
 * confirm it, which is both the anti-forgery step and the Spam Act consent
 * trail. Styles live in site.css.
 */

(() => {
    const TURNSTILE_SITEKEY = '0x4AAAAAAEKubehZQp3K3TbK';

    document.body.insertAdjacentHTML('beforeend', `
<div class="nl-overlay" data-nl-overlay role="dialog" aria-modal="true" aria-label="Receive the EAS newsletter">
  <div class="nl-box">
    <div>Receive the EAS newsletter</div>
    <label class="visually-hidden" for="nl-email">Your email address</label>
    <input id="nl-email" type="email" placeholder="your@email.com" data-nl-email>
    <div data-nl-turnstile></div>
    <div class="nl-msg" data-nl-msg role="status" aria-live="polite"></div>
    <div class="nl-actions">
      <a data-nl-cancel tabindex="0" role="button">CANCEL</a>
      <a data-nl-ok tabindex="0" role="button">OK</a>
    </div>
  </div>
</div>`);

    const overlay = document.querySelector('[data-nl-overlay]');
    const emailIn = document.querySelector('[data-nl-email]');
    const msg = document.querySelector('[data-nl-msg]');
    const okBtn = document.querySelector('[data-nl-ok]');
    let busy = false;
    let lastFocus = null;

    // Turnstile is rendered on first open — the widget dislikes rendering
    // inside a display:none container. Managed mode: invisible for normal
    // humans, shows a check only when something looks automated.
    let tsWidget = null;
    const renderTurnstile = () => {
        if (tsWidget !== null || !window.turnstile) return;
        tsWidget = window.turnstile.render(document.querySelector('[data-nl-turnstile]'), {
            sitekey: TURNSTILE_SITEKEY,
            theme: 'dark',
        });
    };

    const open = () => {
        lastFocus = document.activeElement;
        overlay.classList.add('open');
        msg.textContent = '';
        renderTurnstile();
        emailIn.focus();
    };
    const close = () => {
        if (busy) return;
        overlay.classList.remove('open');
        if (lastFocus) lastFocus.focus();
    };

    document.querySelectorAll('[data-nl-open]').forEach((el) => {
        el.addEventListener('click', (e) => { e.preventDefault(); open(); });
    });
    document.querySelector('[data-nl-cancel]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    emailIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') okBtn.click(); });

    okBtn.addEventListener('click', async () => {
        if (busy) return;
        const email = emailIn.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
            msg.textContent = 'Please enter a valid email address.';
            return;
        }
        const tsToken = window.turnstile && tsWidget !== null
            ? window.turnstile.getResponse(tsWidget) : '';
        if (!tsToken) {
            msg.textContent = 'Please complete the verification check.';
            return;
        }
        busy = true;
        msg.textContent = 'Submitting…';
        try {
            const res = await fetch('/api/waitlist', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email, tsToken, source: 'newsletter' }),
            });
            const data = await res.json();
            if (data.ok) {
                msg.textContent = data.status === 'already'
                    ? 'Already on the list ✓'
                    : 'Check your inbox to confirm ✓';
                emailIn.value = '';
                setTimeout(() => { busy = false; close(); }, 2600);
                return;
            }
            msg.textContent = data.error === 'invalid'
                ? 'Please enter a valid email address.'
                : data.error === 'turnstile'
                    ? 'Verification failed — please try again.'
                    : data.error === 'email'
                        ? 'Couldn’t send the confirmation email — please try again later.'
                        : 'Something went wrong — please try again later.';
            if (window.turnstile && tsWidget !== null) window.turnstile.reset(tsWidget);
        } catch {
            msg.textContent = 'Something went wrong — please try again later.';
        }
        busy = false;
    });
})();
