/*
 * Filter settings shared by the popup and every Kariyer.net tab, kept in
 * chrome.storage.local under one key. Changing a switch in the popup reaches
 * all open tabs through chrome.storage.onChanged.
 */
(function (root) {
  'use strict';

  const KEY = 'kn:settings';
  const DEFAULTS = Object.freeze({
    hideApplied: false,   // Kariyer.net "Başvuruldu"
    hideInspected: false, // Kariyer.net "İncelendi"
  });

  let current = { ...DEFAULTS };
  const listeners = new Set();

  function area() {
    try {
      return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local ? chrome.storage.local : null;
    } catch (_) { return null; }
  }

  function emit() {
    for (const fn of listeners) {
      try { fn(current); } catch (_) {}
    }
  }

  const ready = new Promise((resolve) => {
    const s = area();
    if (!s) return resolve(current);
    try {
      s.get(KEY, (o) => {
        current = { ...DEFAULTS, ...((o && o[KEY]) || {}) };
        resolve(current);
      });
    } catch (_) { resolve(current); }
  });

  try {
    chrome.storage.onChanged.addListener((changes, a) => {
      if (a !== 'local' || !changes[KEY]) return;
      current = { ...DEFAULTS, ...(changes[KEY].newValue || {}) };
      emit();
    });
  } catch (_) {}

  function set(patch) {
    current = { ...current, ...patch };
    const s = area();
    if (s) { try { s.set({ [KEY]: current }); } catch (_) {} }
    emit();
  }

  root.KariyerSettings = {
    DEFAULTS,
    ready,
    get: () => current,
    set,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
