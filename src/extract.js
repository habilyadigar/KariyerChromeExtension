/*
 * Copies the "İş İlanı Hakkında" box of a Kariyer.net job detail page as-is,
 * without images. The box is [data-test="qualifications-and-job-description"]
 * (the ad text) inside .job-detail-content (which also holds "Aday Kriterleri").
 * The "Daha Fazla Göster" part is already in the DOM, only hidden by CSS.
 *
 * The markup is rebuilt from an allowlist: only text-formatting tags survive,
 * every attribute is dropped (except http(s) links and a few layout classes),
 * and images, media, scripts, styles and form controls are removed.
 */
(function (root) {
  'use strict';

  const MAX_HTML = 60000;

  // Source tag -> output tag. Tags not listed are unwrapped (children kept).
  const ALLOWED = {
    P: 'p', DIV: 'div', SPAN: 'span', SECTION: 'div', ARTICLE: 'div', HEADER: 'div', CENTER: 'div',
    UL: 'ul', OL: 'ol', LI: 'li', DL: 'dl', DT: 'dt', DD: 'dd',
    STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', U: 'u', S: 's', DEL: 's', MARK: 'mark',
    SMALL: 'small', SUB: 'sub', SUP: 'sup', CODE: 'code', PRE: 'pre', BLOCKQUOTE: 'blockquote',
    FONT: 'span', BR: 'br', HR: 'hr', A: 'a',
    H1: 'h4', H2: 'h4', H3: 'h4', H4: 'h4', H5: 'h5', H6: 'h5',
    TABLE: 'table', THEAD: 'thead', TBODY: 'tbody', TFOOT: 'tfoot', TR: 'tr', TD: 'td', TH: 'th',
  };
  // Removed together with their content.
  const DROP = new Set([
    'IMG', 'PICTURE', 'FIGURE', 'SVG', 'VIDEO', 'AUDIO', 'SOURCE', 'TRACK', 'CANVAS', 'IFRAME',
    'OBJECT', 'EMBED', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'BUTTON',
    'INPUT', 'SELECT', 'TEXTAREA', 'FORM', 'LABEL', 'MAP', 'AREA', 'MATH',
  ]);
  const VOID = new Set(['br', 'hr']);
  // Classes kept for the "Aday Kriterleri" two-column layout.
  const KEEP_CLASSES = new Set(['alignment-list', 'alignment-title', 'alignment-value', 'bullet']);

  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const hasText = (html) => /[^\s ]/.test(
    html.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ')
  );

  function safeHref(raw) {
    if (!raw) return '';
    try {
      const u = new URL(raw, 'https://www.kariyer.net/');
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
    } catch (_) { return ''; }
  }

  // Returns sanitized HTML for the children of `node`.
  function sanitizeChildren(node) {
    let out = '';
    for (const c of node.childNodes) out += sanitizeNode(c);
    return out;
  }

  function sanitizeNode(n) {
    if (n.nodeType === 3) return esc(n.nodeValue);
    if (n.nodeType === 11) return sanitizeChildren(n);
    if (n.nodeType !== 1) return '';
    const src = String(n.tagName || '').toUpperCase();
    if (DROP.has(src) || n.getAttribute('aria-hidden') === 'true' || n.hidden) return '';
    const tag = ALLOWED[src];
    if (!tag) return sanitizeChildren(n);
    if (VOID.has(tag)) return '<' + tag + '>';

    const inner = sanitizeChildren(n);
    if (!hasText(inner)) return ''; // drop empty <p>, <p><br></p>, image-only wrappers

    let attrs = '';
    const classes = String(n.getAttribute('class') || '').split(/\s+/).filter((c) => KEEP_CLASSES.has(c));
    if (classes.length) attrs += ' class="' + esc(classes.join(' ')) + '"';
    if (tag === 'a') {
      const href = safeHref(n.getAttribute('href'));
      if (!href) return inner;
      attrs += ' href="' + esc(href) + '" target="_blank" rel="noopener noreferrer"';
    }
    return '<' + tag + attrs + '>' + inner + '</' + tag + '>';
  }

  /** Sanitizes a node (or fragment) into safe HTML using the allowlist above. */
  function sanitize(node) {
    return sanitizeChildren(node).trim().slice(0, MAX_HTML);
  }

  function findSection(doc) {
    const ad = doc.querySelector('[data-test="qualifications-and-job-description"]') ||
      doc.querySelector('.job-detail-qualifications');
    if (!ad || !ad.textContent.trim()) return null;
    // Includes "Aday Kriterleri", which sits next to the ad text in the same box.
    return ad.closest('.job-detail-content') || ad;
  }

  function jsonLdJobPosting(doc) {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      let data;
      try { data = JSON.parse(s.textContent); } catch (_) { continue; }
      const stack = [data];
      while (stack.length) {
        const o = stack.pop();
        if (!o || typeof o !== 'object') continue;
        if (Array.isArray(o)) { stack.push(...o); continue; }
        const type = o['@type'];
        if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return o;
        if (o['@graph']) stack.push(o['@graph']);
      }
    }
    return null;
  }

  // Parses an HTML string inertly (a template does not run scripts or load images).
  function parseInert(doc, html) {
    const tpl = doc.createElement('template');
    tpl.innerHTML = String(html);
    return tpl.content;
  }

  function isBlockedDocument(doc) {
    const title = String(doc.title || '').toLowerCase();
    return title.includes('access to this page has been denied') ||
      !!doc.querySelector('#px-captcha, [id^="px-captcha"], meta[content="px-captcha"]');
  }

  function jobTitle(doc) {
    const el = doc.querySelector('[data-test="job-title"]') || doc.querySelector('h1');
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  /**
   * @returns {{status:'ok'|'notfound'|'blocked', html?:string, title?:string, source?:string}}
   */
  function extract(doc) {
    if (isBlockedDocument(doc)) return { status: 'blocked' };
    const title = jobTitle(doc);

    const section = findSection(doc);
    if (section) {
      const html = sanitize(section);
      if (hasText(html)) return { status: 'ok', html, title, source: 'section' };
    }

    // Same ad text from structured data, if the page ever ships it.
    const ld = jsonLdJobPosting(doc);
    if (ld && ld.description) {
      let frag = parseInert(doc, ld.description);
      // Descriptions are sometimes entity-encoded HTML.
      if (!frag.children.length && /<\w+[^>]*>/.test(frag.textContent)) frag = parseInert(doc, frag.textContent);
      const html = sanitize(frag);
      if (hasText(html)) return { status: 'ok', html, title, source: 'jsonld' };
    }
    return { status: 'notfound', title };
  }

  const api = { extract, sanitize, isBlockedDocument, parseInert };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KariyerNitelik = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
