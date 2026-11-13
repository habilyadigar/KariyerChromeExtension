(() => {
  'use strict';

  const S = window.KariyerSettings;
  const $ = (id) => document.getElementById(id);
  const hideApplied = $('hide-applied');
  const hideInspected = $('hide-inspected');
  const statusEl = $('status');

  S.ready.then((s) => {
    hideApplied.checked = !!s.hideApplied;
    hideInspected.checked = !!s.hideInspected;
    refreshCounts();
  });

  hideApplied.addEventListener('change', () => {
    S.set({ hideApplied: hideApplied.checked });
    refreshCounts(250);
  });
  hideInspected.addEventListener('change', () => {
    S.set({ hideInspected: hideInspected.checked });
    refreshCounts(250);
  });

  function showCounts(c) {
    $('count-applied').textContent = String(c.applied);
    $('count-inspected').textContent = String(c.inspected);
    if (!c.total) {
      statusEl.textContent = 'Bu sayfada ilan kartı yok.';
    } else if (c.hidden) {
      statusEl.textContent = `Bu sayfada ${c.total} ilandan ${c.hidden} tanesi gizli.`;
    } else {
      statusEl.textContent = `Bu sayfada ${c.total} ilan var, hiçbiri gizli değil.`;
    }
  }

  function noPage() {
    $('count-applied').textContent = '';
    $('count-inspected').textContent = '';
    statusEl.textContent = 'Ayar tüm Kariyer.net sekmelerine uygulanır. Sayılar Kariyer.net sekmesinde görünür.';
  }

  // Asks the content script in the active tab how many cards it sees.
  function refreshCounts(delay = 0) {
    setTimeout(() => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs && tabs[0];
          if (!tab || tab.id == null) return noPage();
          chrome.tabs.sendMessage(tab.id, { type: 'kn:counts' }, (res) => {
            if (chrome.runtime.lastError || !res) return noPage();
            showCounts(res);
          });
        });
      } catch (_) {
        noPage();
      }
    }, delay);
  }
})();
