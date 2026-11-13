/*
 * Kariyer.net İlan Önizleme — content script.
 * Hovering a job card loads that ad in the background and shows its
 * "İş İlanı Hakkında" section in a floating panel next to the card.
 * Previewed ads are colored yellow, opened ads green (see history.js).
 */
(() => {
  'use strict';
  // Only in visible tabs: the hidden preview iframe must not count as "opened".
  if (window.top !== window || window.__kariyerNitelikLoaded) return;
  window.__kariyerNitelikLoaded = true;

  const { extract, isBlockedDocument, sanitize, parseInert } = window.KariyerNitelik;
  const History = window.KariyerHistory;

  // Opening a job detail page in a tab, however it was opened
  // (click, new tab from the context menu, link from elsewhere), counts as opened.
  const ownId = History.jobIdFromUrl(location.href);
  if (ownId) History.mark(ownId, History.CLICKED);
  window.KariyerHighlight.start();

  const SEEN_DWELL_MS = 1500;
  const HOVER_DELAY_MS = 350;
  const HIDE_DELAY_MS = 250;
  const IFRAME_TIMEOUT_MS = 15000;
  const CACHE_PREFIX = 'kn:v3:';
  const MODE_KEY = 'kn:mode';
  const JOB_PATH_RE = /^\/is-ilani\/[^/]+-(\d+)\/?$/;

  // ---------------------------------------------------------------- cache

  const memory = new Map(); // jobId -> Promise<result>

  function readCache(id) {
    try {
      const raw = sessionStorage.getItem(CACHE_PREFIX + id);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function writeCache(id, value) {
    try { sessionStorage.setItem(CACHE_PREFIX + id, JSON.stringify(value)); } catch (_) {}
  }
  function getMode() {
    try { return sessionStorage.getItem(MODE_KEY) || 'fetch'; } catch (_) { return 'fetch'; }
  }
  function setMode(m) {
    try { sessionStorage.setItem(MODE_KEY, m); } catch (_) {}
  }

  // -------------------------------------------------------------- loading

  async function viaFetch(url) {
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'text/html' } });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (res.status === 403 || isBlockedDocument(doc)) return { status: 'blocked' };
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return extract(doc);
  }

  // Only one background iframe at a time; a newer hover cancels the older load.
  let activeFrame = null;

  function viaIframe(url) {
    if (activeFrame) activeFrame.cancel();
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      // Same origin is needed to read the document; no top navigation or popups.
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      frame.style.cssText =
        'position:fixed;left:-12000px;top:0;width:1280px;height:900px;' +
        'opacity:0;pointer-events:none;border:0;';

      let done = false, loadedAt = 0, last = null, poll = 0, timeout = 0;
      const finish = (fn, val) => {
        if (done) return;
        done = true;
        clearInterval(poll);
        clearTimeout(timeout);
        frame.remove();
        if (activeFrame && activeFrame.frame === frame) activeFrame = null;
        fn(val);
      };

      const check = () => {
        let doc;
        try { doc = frame.contentDocument; } catch (_) { return; }
        if (!doc || !doc.body || doc.URL === 'about:blank') return;
        const r = extract(doc);
        last = r;
        if (r.status === 'ok' || r.status === 'blocked') return finish(resolve, r);
        // Without a heading, give client-side rendering a moment after load before settling.
        if (loadedAt && Date.now() - loadedAt > 2500) finish(resolve, r);
      };

      frame.addEventListener('load', () => { loadedAt = Date.now(); check(); });
      poll = setInterval(check, 300);
      timeout = setTimeout(() => {
        if (last) finish(resolve, last);
        else finish(reject, new Error('Zaman aşımı'));
      }, IFRAME_TIMEOUT_MS);

      activeFrame = { frame, cancel: () => finish(reject, Object.assign(new Error('cancelled'), { cancelled: true })) };
      frame.src = url;
      document.documentElement.appendChild(frame);
    });
  }

  async function loadQualifications(url) {
    if (getMode() === 'fetch') {
      try {
        const r = await viaFetch(url);
        if (r.status === 'ok') return r;
        // Blocked, or the server HTML has no ad text (rendered client side):
        // use the background iframe for the rest of this session.
        setMode('iframe');
      } catch (_) {
        setMode('iframe');
      }
    }
    return viaIframe(url);
  }

  function getQualifications(id, url) {
    if (memory.has(id)) return memory.get(id);
    const cached = readCache(id);
    if (cached) {
      const p = Promise.resolve(cached);
      memory.set(id, p);
      return p;
    }
    const p = loadQualifications(url).then(
      (r) => {
        if (r.status === 'ok' || r.status === 'notfound') writeCache(id, r);
        else memory.delete(id); // retry "blocked" on the next hover
        return r;
      },
      (err) => { memory.delete(id); throw err; }
    );
    memory.set(id, p);
    return p;
  }

  // -------------------------------------------------------------- tooltip

  const host = document.createElement('div');
  host.id = 'kariyer-nitelik-host';
  host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483646;display:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .panel {
        box-sizing: border-box; width: 440px; max-width: calc(100vw - 24px);
        max-height: min(78vh, 680px); display: flex; flex-direction: column;
        background: #fff; color: #1f2430; border-radius: 12px;
        border: 1px solid rgba(20, 20, 40, .08);
        box-shadow: 0 12px 32px rgba(20, 20, 50, .18), 0 2px 6px rgba(20, 20, 50, .08);
        font: 13px/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
        overflow: hidden; animation: in .12s ease-out;
      }
      @keyframes in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      header { padding: 12px 14px 10px; border-bottom: 1px solid #eef0f4; }
      .label { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #7a3fd1; }
      .title { margin-top: 2px; font-weight: 600; font-size: 14px; color: #1f2430;
               white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .body { padding: 10px 14px 12px; overflow-y: auto; }
      .ad { overflow-wrap: anywhere; }
      .ad p { margin: 0 0 8px; }
      .ad ul, .ad ol { margin: 0 0 8px; padding: 0 0 0 18px; }
      .ad li { margin: 2px 0; }
      .ad li::marker { color: #7a3fd1; }
      .ad h4, .ad h5 { margin: 12px 0 6px; font-size: 13px; font-weight: 700; color: #1f2430; }
      .ad > :first-child, .ad > div > :first-child { margin-top: 0; }
      .ad strong { font-weight: 700; }
      .ad a { font-weight: 500; }
      .ad hr { border: 0; border-top: 1px solid #eef0f4; margin: 10px 0; }
      .ad table { border-collapse: collapse; margin: 0 0 8px; }
      .ad td, .ad th { border: 1px solid #e6e8ee; padding: 3px 6px; vertical-align: top; }
      .ad .alignment-list { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; }
      .ad .alignment-title { font-weight: 600; }
      .ad .bullet { color: #7a3fd1; margin-right: 4px; }
      .msg { color: #4a5060; }
      .loading { display: flex; align-items: center; gap: 10px; color: #6b7180; }
      .spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #e3d6f7;
              border-top-color: #7a3fd1; animation: spin .8s linear infinite; flex: none; }
      @keyframes spin { to { transform: rotate(360deg); } }
      footer { padding: 8px 14px; border-top: 1px solid #eef0f4; font-size: 12px; color: #8a8f9c;
               display: flex; justify-content: space-between; align-items: center; }
      a { color: #7a3fd1; text-decoration: none; font-weight: 600; }
      a:hover { text-decoration: underline; }
      @media (prefers-color-scheme: dark) {
        .panel { background: #1e2029; color: #e6e8ee; border-color: rgba(255,255,255,.08); }
        .title { color: #f1f2f6; }
        header, footer { border-color: #2c2f3a; }
        .ad h4, .ad h5 { color: #f1f2f6; }
        .ad hr, .ad td, .ad th { border-color: #2c2f3a; }
        .loading, footer { color: #9aa0ad; }
        .msg { color: #c3c7d1; }
        .label, a, .ad li::marker, .ad .bullet { color: #b08cf0; }
      }
    </style>
    <div class="panel" part="panel" lang="tr">
      <header><div class="label">İş İlanı Hakkında</div><div class="title"><span class="src"></span><a target="_blank" rel="noopener">İlanı aç ↗</a></div></header>
      <div class="body"></div>
      <footer><span class="src"></span><a target="_blank" rel="noopener">İlanı aç ↗</a></footer>
    </div>`;
  document.documentElement.appendChild(host);

  const panel = shadow.querySelector('.panel');
  const titleEl = shadow.querySelector('.title');
  const bodyEl = shadow.querySelector('.body');
  const srcEl = shadow.querySelector('.src');
  const linkEl = shadow.querySelector('footer a');

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderLoading(card) {
    titleEl.textContent = cardTitle(card);
    bodyEl.replaceChildren(el('div', 'loading'));
    bodyEl.firstChild.append(el('div', 'spin'), el('span', null, 'İlan arka planda açılıyor…'));
    srcEl.textContent = '';
  }

  function renderResult(card, r) {
    titleEl.textContent = cardTitle(card) || r.title || '';
    bodyEl.scrollTop = 0;
    if (r.status === 'ok' && typeof r.html === 'string') {
      // The cached HTML is sanitized again before it is inserted (it comes from sessionStorage).
      const box = el('div', 'ad');
      box.innerHTML = sanitize(parseInert(document, r.html));
      bodyEl.replaceChildren(box);
      srcEl.textContent = '';
    } else if (r.status === 'blocked') {
      bodyEl.replaceChildren(el('p', 'msg',
        'Kariyer.net bir doğrulama istiyor. İlanı bir kez yeni sekmede açıp doğrulamayı tamamlayın, sonra tekrar deneyin.'));
      srcEl.textContent = '';
    } else {
      bodyEl.replaceChildren(el('p', 'msg', 'Bu ilanda "İş İlanı Hakkında" bölümü bulunamadı.'));
      srcEl.textContent = '';
    }
  }

  function renderError(err) {
    bodyEl.replaceChildren(el('p', 'msg', 'İlan yüklenemedi' + (err && err.message ? ` (${err.message})` : '') + '.'));
    srcEl.textContent = '';
  }

  function cardTitle(card) {
    const t = card.querySelector('[data-test="ad-card-title"], .k-ad-card-title');
    return (t ? t.textContent : card.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
  }

  function position(card) {
    const r = card.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const gap = 12;
    let left;
    let top = r.top;
    if (r.right + gap + w <= vw - 8) {
      left = r.right + gap; // right of the card
    } else if (r.left - gap - w >= 8) {
      left = r.left - gap - w; // left of the card
    } else {
      // Narrow window: below the card, or above if there is no room.
      left = Math.max(8, Math.min(vw - w - 8, r.left));
      top = r.bottom + 8 + h <= vh - 8 ? r.bottom + 8 : r.top - 8 - h;
    }
    top = Math.max(8, Math.min(vh - h - 8, top));
    host.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  // --------------------------------------------------------------- hover

  let currentCard = null;
  let currentJob = null;
  let showTimer = 0;
  let hideTimer = 0;
  let dwellTimer = 0;
  let requestSeq = 0;

  function jobFromAnchor(a) {
    if (!a || !a.href) return null;
    let u;
    try { u = new URL(a.href, location.href); } catch (_) { return null; }
    if (u.origin !== location.origin) return null;
    const m = u.pathname.match(JOB_PATH_RE);
    if (!m) return null;
    return { id: m[1], url: u.origin + u.pathname };
  }

  function cardFor(target) {
    if (!(target instanceof Element)) return null;
    const a = target.closest('a[href*="/is-ilani/"]');
    return a && jobFromAnchor(a) ? a : null;
  }

  function show(card) {
    const job = jobFromAnchor(card);
    if (!job) return;
    currentCard = card;
    currentJob = job;
    clearTimeout(dwellTimer);
    const seq = ++requestSeq;
    linkEl.href = job.url;
    renderLoading(card);
    host.style.display = 'block';
    position(card);

    getQualifications(job.id, job.url).then(
      (r) => {
        if (seq !== requestSeq) return;
        renderResult(card, r);
        position(card);
        // Yellow only after the ad text has been on screen for a moment,
        // so sweeping the mouse across the list does not mark everything.
        if (r.status === 'ok') {
          dwellTimer = setTimeout(() => {
            if (seq === requestSeq) History.mark(job.id, History.SEEN);
          }, SEEN_DWELL_MS);
        }
      },
      (err) => {
        if (err && err.cancelled) return;
        if (seq === requestSeq) { renderError(err); position(card); }
      }
    );
  }

  function hide() {
    clearTimeout(showTimer);
    clearTimeout(dwellTimer);
    host.style.display = 'none';
    currentCard = null;
    currentJob = null;
    requestSeq++;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, HIDE_DELAY_MS);
  }

  document.addEventListener('mouseover', (e) => {
    if (e.target === host) { clearTimeout(hideTimer); return; }
    const card = cardFor(e.target);
    if (!card) return;
    clearTimeout(hideTimer);
    if (card === currentCard) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(card), HOVER_DELAY_MS);
  }, true);

  document.addEventListener('mouseout', (e) => {
    const to = e.relatedTarget;
    if (e.target === host) {
      // Moves inside the shadow tree are retargeted to host -> host.
      if (to === host) return;
      if (currentCard && to instanceof Node && currentCard.contains(to)) return;
      scheduleHide();
      return;
    }
    const card = cardFor(e.target);
    if (!card) return;
    if (to instanceof Node && (card.contains(to) || to === host)) return;
    clearTimeout(showTimer);
    if (card === currentCard) scheduleHide();
  }, true);

  // ----------------------------------------------------------- opened ads

  // Left click, Ctrl/Cmd/Shift+click (click) and middle click (auxclick) on a card.
  function onOpen(e) {
    if (e.type === 'auxclick' && e.button !== 1) return;
    const card = cardFor(e.target);
    const job = card && jobFromAnchor(card);
    if (job) History.mark(job.id, History.CLICKED);
  }
  document.addEventListener('click', onOpen, true);
  document.addEventListener('auxclick', onOpen, true);

  // "İlanı aç ↗" in the panel.
  const openFromPanel = (e) => {
    if (e.type === 'auxclick' && e.button !== 1) return;
    if (currentJob) History.mark(currentJob.id, History.CLICKED);
  };
  linkEl.addEventListener('click', openFromPanel);
  linkEl.addEventListener('auxclick', openFromPanel);

  window.addEventListener('scroll', () => { if (currentCard) position(currentCard); }, { passive: true });
  window.addEventListener('resize', () => { if (currentCard) position(currentCard); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  // Vue may remove the hovered card when the list re-renders (filters, paging).
  setInterval(() => { if (currentCard && !currentCard.isConnected) hide(); }, 1000);
})();
