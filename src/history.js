/*
 * Per-ad viewing history, kept in chrome.storage.local so it survives
 * browser restarts and is shared by all Kariyer.net tabs.
 *
 *   key "h:<ilanId>"  ->  { s: 1 | 2, t: <last change, ms> }
 *   1 = SEEN    (the hover panel showed the ad for a while)  -> yellow
 *   2 = CLICKED (the ad itself was opened)                   -> green
 *
 * One key per ad, so two tabs writing at the same time never overwrite each
 * other. A state only goes up (seen -> clicked), never down.
 */
(function (root) {
  'use strict';

  const PREFIX = 'h:';
  const KEEP_DAYS = 60;
  const SEEN = 1;
  const CLICKED = 2;
  const JOB_PATH_RE = /^\/is-ilani\/[^/]+-(\d+)\/?$/;

  const states = new Map(); // id -> level
  const listeners = new Set();

  // After the extension is reloaded, scripts already running in open tabs lose
  // access to chrome.* ("Extension context invalidated"); fail quietly then.
  function store() {
    try {
      return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local ? chrome.storage.local : null;
    } catch (_) { return null; }
  }

  function notify(id, level) {
    for (const fn of listeners) {
      try { fn(id, level); } catch (_) {}
    }
  }

  function setLocal(id, level) {
    if ((states.get(id) || 0) >= level) return false;
    states.set(id, level);
    notify(id, level);
    return true;
  }

  const ready = new Promise((resolve) => {
    const s = store();
    if (!s) return resolve();
    try {
      s.get(null, (all) => {
        const expired = [];
        const cutoff = Date.now() - KEEP_DAYS * 864e5;
        for (const [key, v] of Object.entries(all || {})) {
          if (!key.startsWith(PREFIX) || !v || typeof v.s !== 'number') continue;
          if (v.t < cutoff) { expired.push(key); continue; }
          const id = key.slice(PREFIX.length);
          states.set(id, Math.max(states.get(id) || 0, v.s));
        }
        if (expired.length) { try { s.remove(expired); } catch (_) {} }
        resolve();
      });
    } catch (_) { resolve(); }
  });

  // Changes made in other tabs.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const [key, ch] of Object.entries(changes)) {
        if (!key.startsWith(PREFIX)) continue;
        const id = key.slice(PREFIX.length);
        if (ch.newValue && typeof ch.newValue.s === 'number') {
          setLocal(id, ch.newValue.s);
        } else if (!ch.newValue && states.has(id)) {
          states.delete(id); // removed (e.g. history cleared)
          notify(id, 0);
        }
      }
    });
  } catch (_) {}

  function get(id) {
    return states.get(String(id)) || 0;
  }

  function mark(id, level) {
    id = String(id);
    if (!setLocal(id, level)) return;
    const s = store();
    if (!s) return;
    try { s.set({ [PREFIX + id]: { s: level, t: Date.now() } }); } catch (_) {}
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // Returns the ilan id for a job detail URL (absolute or relative), or null.
  function jobIdFromUrl(href, base) {
    try {
      const u = new URL(href, base || location.href);
      if (!/(^|\.)kariyer\.net$/.test(u.hostname) && u.origin !== location.origin) return null;
      const m = u.pathname.match(JOB_PATH_RE);
      return m ? m[1] : null;
    } catch (_) { return null; }
  }

  root.KariyerHistory = { SEEN, CLICKED, ready, get, mark, onChange, jobIdFromUrl };
})(typeof globalThis !== 'undefined' ? globalThis : this);
