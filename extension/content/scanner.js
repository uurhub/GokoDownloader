/*
 * Goko Downloader - page scanner (classic script, no import/export).
 * Inject with chrome.scripting.executeScript({ target, files: ['content/scanner.js'] }).
 * Idempotent: defines
 *   window.__gokoScan({minSize})  -> { pageUrl, title, images: [ImageInfo & {preview}], videos: [...] }
 *   window.__gokoImageInfo(srcUrl) -> ImageInfo
 * See docs/CONTRACT.md. Returns plain JSON-serializable objects only.
 */
if (!window.__gokoScan) {
  (function () {
    'use strict';

    var DATA_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-full', 'data-large',
      'data-hi-res', 'data-zoom-image', 'data-orig-file', 'data-large-file'];
    var IMG_EXT_RE = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg)$/i;
    var MAX_ELEMENTS = 60000;
    var MAX_SHADOW_ROOTS = 300;
    var MAX_STYLE_SCAN = 3000;
    var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, HEAD: 1, NOSCRIPT: 1, IMG: 1, BR: 1, HR: 1, SVG: 1, PATH: 1 };

    function abs(u) {
      if (!u || typeof u !== 'string') return '';
      u = u.trim();
      if (!u) return '';
      if (/^data:/i.test(u)) return u;
      try { return new URL(u, document.baseURI).href; } catch (e) { return ''; }
    }

    function parseSrcset(srcset) {
      var out = [];
      if (!srcset) return out;
      var s = String(srcset), i = 0, n = s.length;
      function ws(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'; }
      while (i < n) {
        while (i < n && (ws(s[i]) || s[i] === ',')) i++;
        if (i >= n) break;
        var st = i;
        while (i < n && !ws(s[i])) i++;
        var url = s.slice(st, i), desc = '';
        if (url.charAt(url.length - 1) === ',') {
          url = url.replace(/,+$/, '');
        } else {
          var ds = i, paren = 0;
          while (i < n) {
            var c = s[i];
            if (c === '(') paren++;
            else if (c === ')') paren = Math.max(0, paren - 1);
            else if (c === ',' && paren === 0) break;
            i++;
          }
          desc = s.slice(ds, i).trim();
        }
        if (!url) continue;
        var w = 0, x = 0, m;
        if ((m = /(\d+(?:\.\d+)?)w\b/i.exec(desc))) w = parseFloat(m[1]);
        else if ((m = /(\d+(?:\.\d+)?)x\b/i.exec(desc))) x = parseFloat(m[1]);
        out.push({ url: url, w: w, x: x });
      }
      return out;
    }

    function largestSrcset(srcset) {
      var list = parseSrcset(srcset), best = null, bs = -1;
      for (var i = 0; i < list.length; i++) {
        var sc = list[i].w || (list[i].x ? list[i].x * 1000 : 0);
        if (sc > bs) { bs = sc; best = list[i]; }
      }
      return best ? abs(best.url) : '';
    }

    function srcsetUrls(srcset) {
      return parseSrcset(srcset).map(function (e) { return abs(e.url); }).filter(Boolean);
    }

    // Collect all elements, descending into open shadow roots (capped).
    function allElements() {
      var out = [], roots = [document], shadows = 0;
      while (roots.length) {
        var r = roots.pop(), els;
        try { els = r.querySelectorAll('*'); } catch (e) { continue; }
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          out.push(el);
          if (el.shadowRoot && shadows < MAX_SHADOW_ROOTS) { shadows++; roots.push(el.shadowRoot); }
          if (out.length >= MAX_ELEMENTS) return out;
        }
      }
      return out;
    }

    function bgUrl(el) {
      var bg;
      try { bg = getComputedStyle(el).backgroundImage; } catch (e) { return ''; }
      if (!bg || bg === 'none') return '';
      var m = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/.exec(bg);
      if (!m) return '';
      return abs(m[1] || m[2] || m[3] || '');
    }

    function parentHrefOf(el) {
      try {
        var a = el.closest && el.closest('a[href]');
        if (!a) return null;
        var u = new URL(a.getAttribute('href'), document.baseURI);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        return IMG_EXT_RE.test(u.pathname) ? u.href : null;
      } catch (e) { return null; }
    }

    function emptyInfo(src) {
      return { src: src || '', currentSrc: '', srcset: '', sources: [], dataAttrs: {}, parentHref: null,
        bgImage: null, width: 0, height: 0, alt: '' };
    }

    function collectDataAttrs(el) {
      var d = {};
      for (var i = 0; i < DATA_ATTRS.length; i++) {
        var v = el.getAttribute(DATA_ATTRS[i]);
        if (v && v.trim()) d[DATA_ATTRS[i]] = abs(v.split(/\s+/)[0]) || v;
      }
      return d;
    }

    function pictureSources(img) {
      var out = [], p = img.parentElement;
      if (!p || p.tagName !== 'PICTURE') return out;
      var ss = p.querySelectorAll('source');
      for (var i = 0; i < ss.length; i++) {
        var srcset = ss[i].getAttribute('srcset') || ss[i].getAttribute('data-srcset') || '';
        if (!srcset) continue;
        out.push({ srcset: srcset, type: ss[i].getAttribute('type') || '', media: ss[i].getAttribute('media') || '' });
      }
      return out;
    }

    function renderedSize(el) {
      try {
        var r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      } catch (e) { return { w: 0, h: 0 }; }
    }

    function infoFromImg(img) {
      var info = emptyInfo(abs(img.getAttribute('src') || img.src || ''));
      info.currentSrc = abs(img.currentSrc || '');
      info.srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
      info.sources = pictureSources(img);
      info.dataAttrs = collectDataAttrs(img);
      info.parentHref = parentHrefOf(img);
      info.width = img.naturalWidth || 0;
      info.height = img.naturalHeight || 0;
      if (!info.width && !info.height) {
        var rs = renderedSize(img);
        info.width = rs.w; info.height = rs.h;
      }
      info.alt = img.alt || '';
      return info;
    }

    function infoFromBg(el, url) {
      var info = emptyInfo('');
      info.bgImage = url;
      info.dataAttrs = collectDataAttrs(el);
      info.parentHref = parentHrefOf(el);
      var rs = renderedSize(el);
      info.width = rs.w; info.height = rs.h;
      info.alt = el.getAttribute('aria-label') || el.getAttribute('title') || '';
      return info;
    }

    function infoKey(info) {
      var ss = largestSrcset(info.srcset);
      if (!ss) {
        for (var i = 0; i < info.sources.length && !ss; i++) ss = largestSrcset(info.sources[i].srcset);
      }
      return ss || info.currentSrc || info.src || info.bgImage || '';
    }

    function scanImages(minSize, els) {
      var results = [], seen = {};
      function add(info, force) {
        var key = infoKey(info);
        if (!key || seen[key]) return;
        var known = info.width || info.height;
        var ok = force || (known ? (info.width >= minSize || info.height >= minSize)
          : (!!info.srcset || info.sources.length > 0 || Object.keys(info.dataAttrs).length > 0));
        if (!ok) return;
        seen[key] = 1;
        info.preview = info.currentSrc || info.src || info.bgImage || key;
        results.push(info);
      }
      var i, el;
      for (i = 0; i < els.length; i++) {
        el = els[i];
        if (el.tagName === 'IMG') add(infoFromImg(el), false);
      }
      // Background images: prefer elements that are big enough, cap computed-style scans.
      var cands = [];
      for (i = 0; i < els.length; i++) {
        el = els[i];
        if (SKIP_TAGS[el.tagName] || SKIP_TAGS[String(el.tagName).toUpperCase()]) continue;
        cands.push(el);
      }
      var big = [], small = [];
      for (i = 0; i < cands.length && i < MAX_STYLE_SCAN * 4; i++) {
        var rs = renderedSize(cands[i]);
        (rs.w >= minSize || rs.h >= minSize ? big : small).push(cands[i]);
      }
      var scan = big.concat(small).slice(0, MAX_STYLE_SCAN);
      for (i = 0; i < scan.length; i++) {
        var u = bgUrl(scan[i]);
        if (u && !/^data:/i.test(u)) add(infoFromBg(scan[i], u), false);
      }
      // Meta images
      var metas = document.querySelectorAll('meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"], meta[name="twitter:image"]');
      for (i = 0; i < metas.length; i++) {
        var mu = abs(metas[i].getAttribute('content'));
        if (!mu) continue;
        var mi = emptyInfo(mu);
        add(mi, true);
      }
      var links = document.querySelectorAll('link[rel="image_src"]');
      for (i = 0; i < links.length; i++) {
        var lu = abs(links[i].getAttribute('href'));
        if (lu) add(emptyInfo(lu), true);
      }
      return results;
    }

    function videoKind(src) {
      if (/^blob:/i.test(src)) return 'blob';
      if (/\.m3u8(?:$|[?#])/i.test(src)) return 'hls';
      if (/\.mpd(?:$|[?#])/i.test(src)) return 'dash';
      return 'direct';
    }

    function guessType(src, declared) {
      if (declared) return declared;
      var m = /\.([a-z0-9]{2,4})(?:$|[?#])/i.exec(src);
      var ext = m ? m[1].toLowerCase() : '';
      var map = { mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
        m3u8: 'application/vnd.apple.mpegurl', mpd: 'application/dash+xml', m4v: 'video/mp4' };
      return map[ext] || '';
    }

    function scanVideos(els) {
      var out = [], seen = {};
      function add(src, type, w, h, poster) {
        src = abs(src);
        if (!src || /^data:/i.test(src) || seen[src]) return;
        seen[src] = 1;
        out.push({ src: src, type: guessType(src, type), kind: videoKind(src), width: w || 0, height: h || 0, poster: poster || '' });
      }
      for (var i = 0; i < els.length; i++) {
        var v = els[i];
        if (v.tagName !== 'VIDEO') continue;
        var poster = abs(v.getAttribute('poster') || '');
        var w = v.videoWidth || renderedSize(v).w, h = v.videoHeight || renderedSize(v).h;
        add(v.currentSrc || v.getAttribute('src') || '', v.getAttribute('type') || '', w, h, poster);
        var ss = v.querySelectorAll('source');
        for (var j = 0; j < ss.length; j++) add(ss[j].getAttribute('src') || '', ss[j].getAttribute('type') || '', w, h, poster);
      }
      var metas = document.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]');
      var ogW = 0, ogH = 0, ogPoster = '';
      try {
        ogW = parseInt((document.querySelector('meta[property="og:video:width"]') || {}).content, 10) || 0;
        ogH = parseInt((document.querySelector('meta[property="og:video:height"]') || {}).content, 10) || 0;
        var op = document.querySelector('meta[property="og:image"]');
        ogPoster = op ? abs(op.getAttribute('content')) : '';
      } catch (e) { /* ignore */ }
      for (var k = 0; k < metas.length; k++) {
        add(metas[k].getAttribute('content') || '', '', ogW, ogH, ogPoster);
      }
      return out;
    }

    window.__gokoScan = function (opts) {
      var minSize = (opts && typeof opts.minSize === 'number') ? opts.minSize : 200;
      var result = { pageUrl: location.href, title: document.title || '', images: [], videos: [] };
      var els = [];
      try { els = allElements(); } catch (e) { /* ignore */ }
      try { result.images = scanImages(minSize, els); } catch (e) { /* keep partial */ }
      try { result.videos = scanVideos(els); } catch (e) { /* keep partial */ }
      return JSON.parse(JSON.stringify(result));
    };

    function sameUrl(a, b) {
      if (!a || !b) return false;
      if (a === b) return true;
      return a.split('#')[0] === b.split('#')[0];
    }

    window.__gokoImageInfo = function (srcUrl) {
      var target = abs(srcUrl) || srcUrl || '';
      var els = [];
      try { els = allElements(); } catch (e) { /* ignore */ }
      var i, el, info;
      var bgMatch = null;
      for (i = 0; i < els.length; i++) {
        el = els[i];
        if (el.tagName !== 'IMG') continue;
        var found = sameUrl(abs(el.getAttribute('src') || el.src), target) || sameUrl(abs(el.currentSrc), target);
        if (!found) {
          var urls = srcsetUrls(el.getAttribute('srcset') || el.getAttribute('data-srcset') || '');
          var ps = pictureSources(el);
          for (var p = 0; p < ps.length; p++) urls = urls.concat(srcsetUrls(ps[p].srcset));
          for (var u = 0; u < urls.length && !found; u++) found = sameUrl(urls[u], target);
        }
        if (found) return JSON.parse(JSON.stringify(infoFromImg(el)));
      }
      var scanned = 0;
      for (i = 0; i < els.length && scanned < MAX_STYLE_SCAN * 2; i++) {
        el = els[i];
        if (SKIP_TAGS[el.tagName]) continue;
        scanned++;
        var b = bgUrl(el);
        if (b && sameUrl(b, target)) { bgMatch = el; break; }
      }
      if (bgMatch) return JSON.parse(JSON.stringify(infoFromBg(bgMatch, target)));
      info = emptyInfo(target);
      return info;
    };
  })();
}
