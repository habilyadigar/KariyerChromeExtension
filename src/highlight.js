/*
 * Job card layer, on every Kariyer.net page that lists ads:
 *
 *  - Frames cards by the extension's own history: yellow = previewed in the
 *    hover panel, green = opened (data-kn-state on the card link).
 *  - Hides cards Kariyer.net itself marks as "Başvuruldu" / "İncelendi" when
 *    the popup filter says so (data-kn-hide on the card's outer box).
 *  - Answers the popup's "how many on this page" question.
 *
 * Attributes instead of classes: Vue rewrites the class attribute when it
 * re-renders a card, but leaves unknown data-* attributes alone. A
 * MutationObserver repaints cards added later (filters, paging) and cards
 * whose href or class Vue changed in place.
 */
(function (root) {
  'use strict';

  const H = root.KariyerHistory;
  const S = root.KariyerSettings;
  const ATTR = 'data-kn-state';
  const HIDE_ATTR = 'data-kn-hide';
  const NAMES = { 1: 'seen', 2: 'clicked' };

  const CSS = `
    a[${ATTR}] { position: relative !important; }
    a[${ATTR}]::after {
      content: ""; position: absolute; inset: 0; z-index: 1;
      border-radius: inherit; pointer-events: none;
    }
    a[${ATTR}="seen"]::after {
      box-shadow: inset 0 0 0 2px #f5c400;
    }
    a[${ATTR}="clicked"]::after {
      box-shadow: inset 0 0 0 2px #2e9d4b;
    }
    [${HIDE_ATTR}] { display: none !important; }`;

  let counts = { total: 0, applied: 0, inspected: 0, hidden: 0 };

  function injectStyle() {
    if (document.getElementById('kn-highlight-style')) return;
    const style = document.createElement('style');
    style.id = 'kn-highlight-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // Kariyer.net's own marks on a listing card.
  function siteMarks(a) {
    const cl = a.classList;
    return {
      applied: cl.contains('applied') ||
        !!a.querySelector('[data-type="applied"], .badge-item--applied'),
      inspected: cl.contains('inspacted-badge') || cl.contains('inspected-badge') ||
        !!a.querySelector('[data-type="inspected"], .badge-item--inspected'),
    };
  }

  // The box to hide: the card link plus wrappers that hold nothing else
  // (Vue puts each card in its own <div>), so no empty gap is left behind.
  function outerBox(a) {
    let el = a;
    for (let i = 0; i < 3; i++) {
      const p = el.parentElement;
      if (!p || p === document.body || p.children.length !== 1) break;
      el = p;
    }
    return el;
  }

  // Cards in horizontal sliders ("Bu İlanla Birlikte Görüntülenenler") stay
  // visible; removing slides breaks the slider layout.
  const inSlider = (a) => !!a.closest('.v-hl-container, .vue-horizontal, .k-horizontal');

  function paint(a, settings, next) {
    const id = H.jobIdFromUrl(a.getAttribute('href') || '', location.href);
    if (!id) return;

    const name = NAMES[H.get(id)];
    if (name) {
      if (a.getAttribute(ATTR) !== name) a.setAttribute(ATTR, name);
    } else if (a.hasAttribute(ATTR)) {
      a.removeAttribute(ATTR);
    }

    if (a.getAttribute('data-test') !== 'ad-card-item' && !a.classList.contains('k-ad-card')) return;
    const marks = siteMarks(a);
    next.total++;
    if (marks.applied) next.applied++;
    if (marks.inspected) next.inspected++;

    const hide = !inSlider(a) &&
      ((settings.hideApplied && marks.applied) || (settings.hideInspected && marks.inspected));
    const box = outerBox(a);
    if (hide) {
      next.hidden++;
      if (!box.hasAttribute(HIDE_ATTR)) box.setAttribute(HIDE_ATTR, '');
    } else if (box.hasAttribute(HIDE_ATTR)) {
      box.removeAttribute(HIDE_ATTR);
    }
  }

  function paintAll() {
    const settings = S.get();
    const next = { total: 0, applied: 0, inspected: 0, hidden: 0 };
    for (const a of document.querySelectorAll('a[href*="/is-ilani/"]')) paint(a, settings, next);
    // A wrapper left hidden after Vue moved its card elsewhere.
    for (const box of document.querySelectorAll(`[${HIDE_ATTR}]`)) {
      if (!box.querySelector('a[href*="/is-ilani/"]') && !box.matches('a')) box.removeAttribute(HIDE_ATTR);
    }
    counts = next;
  }

  // Batches bursts of changes into one repaint. requestAnimationFrame does not
  // fire in tabs that are not being drawn (background tabs), so a timer is the
  // fallback; whichever comes first runs the repaint.
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      if (!scheduled) return;
      scheduled = false;
      paintAll();
    };
    requestAnimationFrame(run);
    setTimeout(run, 120);
  }

  function listenForPopup() {
    try {
      chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
        if (msg && msg.type === 'kn:counts') {
          paintAll();
          reply({ ...counts, settings: S.get() });
        }
      });
    } catch (_) {}
  }

  function start() {
    injectStyle();
    Promise.all([H.ready, S.ready]).then(paintAll);
    H.onChange(schedule);
    S.onChange(schedule);
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'class'], // our own data-* changes do not retrigger
    });
    listenForPopup();
  }

  root.KariyerHighlight = { start, paintAll, getCounts: () => counts };
})(typeof globalThis !== 'undefined' ? globalThis : this);
