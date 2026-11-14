// Goko Downloader - YouTube page button (classic content script, no imports).
(function () {
  'use strict';
  // Re-injection (extension reload/update re-injects into open tabs): an earlier instance may be
  // orphaned ("context invalidated") yet still running its MutationObserver - tell it to tear down
  // (DOM events cross isolated worlds) and take over. Same-generation duplicates are also replaced.
  try { document.dispatchEvent(new CustomEvent('goko-yt-teardown')); } catch (e) { /* ignore */ }
  window.__gokoYT = true;

  var MSG = { VIDEO_DOWNLOAD: 'VIDEO_DOWNLOAD', THUMB_DOWNLOAD: 'THUMB_DOWNLOAD', VIDEO_CANCEL: 'VIDEO_CANCEL', OPEN_FOLDER: 'OPEN_FOLDER' };
  var KEYS = { SETTINGS: 'goko.settings', DOWNLOADS: 'goko.downloads' };

  var WATCH_SELECTORS = [
    'ytd-watch-metadata #top-level-buttons-computed',
    '#top-level-buttons-computed',
    'ytd-watch-metadata #actions-inner #menu',
    '#actions #menu'
  ];
  var SHORTS_SELECTORS = [
    'ytd-reel-video-renderer[is-active] #actions',
    'ytd-shorts #actions',
    'reel-action-bar-view-model'
  ];

  var ICON_DL = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path class="goko-accent" d="M12 3a1 1 0 0 1 1 1v9.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.4L11 13.6V4a1 1 0 0 1 1-1z"/><path fill="currentColor" d="M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"/></svg>';

  var enabled = true;
  var dead = false;
  var btn = null;          // root element
  var labelEl = null;
  var fillEl = null;
  var menuEl = null;
  var toastEl = null;
  var toastTimer = null;
  var flash = null;        // {text, title, until, cls}
  var flashTimer = null;
  var trackedId = null;    // download id started from this page
  var seen = {};           // download id -> last status
  var lastItems = null;
  var ensureTimer = null;
  var lastHref = '';

  // ---- helpers ----
  function isInvalid(e) {
    return e && /context invalidated/i.test(String(e.message || e));
  }
  function die() {
    if (dead) return;
    dead = true;
    try {
      closeMenu(); removeBtn(); if (toastEl) toastEl.remove(); if (mo) mo.disconnect();
      clearTimeout(ensureTimer); clearTimeout(flashTimer); clearTimeout(toastTimer);
      document.removeEventListener('yt-navigate-finish', onNav);
      document.removeEventListener('yt-page-data-updated', schedule);
      window.removeEventListener('popstate', onNav);
    } catch (e) { /* ignore */ }
  }
  function safe(fn) {
    try { return fn(); } catch (e) { if (isInvalid(e)) die(); return undefined; }
  }
  function contextAlive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }

  function getVideoId() {
    var p = location.pathname;
    if (p === '/watch') {
      var v = new URLSearchParams(location.search).get('v');
      return v && /^[\w-]{6,}$/.test(v) ? v : null;
    }
    var m = p.match(/^\/(?:shorts|live)\/([\w-]{11})/);
    return m ? m[1] : null;
  }
  function pageKind() {
    if (location.pathname === '/watch' || /^\/live\/[\w-]{11}/.test(location.pathname)) return 'watch';
    if (/^\/shorts\//.test(location.pathname)) return 'shorts';
    return null;
  }
  function getTitle() {
    var t = '';
    var el = document.querySelector('ytd-watch-metadata h1 yt-formatted-string') ||
      document.querySelector('h1.ytd-watch-metadata');
    if (el && pageKind() === 'watch') t = (el.textContent || '').trim();
    if (!t && pageKind() === 'shorts') {
      var h = document.querySelector('ytd-reel-video-renderer[is-active] h2') ||
        document.querySelector('ytd-reel-video-renderer[is-active] .ytShortsVideoTitleViewModelShortsVideoTitle');
      if (h) t = (h.textContent || '').trim();
    }
    if (!t) t = (document.title || '').replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '').trim();
    if (!t || t === 'YouTube') t = 'YouTube ' + (getVideoId() || 'video');
    return t;
  }
  function idFromUrl(u) {
    var m = String(u || '').match(/[?&]v=([\w-]+)|\/(?:shorts|live)\/([\w-]+)|youtu\.be\/([\w-]+)/);
    return m ? (m[1] || m[2] || m[3]) : null;
  }

  // ---- button ----
  function buildBtn(kind) {
    var root = document.createElement('div');
    root.className = 'goko-root goko-' + kind;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'goko-btn';
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-label', 'Goko ile indir');
    var fill = document.createElement('span');
    fill.className = 'goko-fill';
    var icon = document.createElement('span');
    icon.className = 'goko-icon';
    icon.innerHTML = ICON_DL;
    var label = document.createElement('span');
    label.className = 'goko-label';
    label.textContent = 'İndir';
    if (kind === 'watch') {
      b.appendChild(fill); b.appendChild(icon); b.appendChild(label);
      root.appendChild(b);
    } else {
      b.appendChild(fill); b.appendChild(icon);
      root.appendChild(b); root.appendChild(label);
    }
    b.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (menuEl) closeMenu(); else openMenu(b);
    });
    fillEl = fill; labelEl = label;
    return root;
  }

  function removeBtn() {
    if (btn) { btn.remove(); btn = null; labelEl = null; fillEl = null; }
  }

  function findTarget(kind) {
    var sels = kind === 'watch' ? WATCH_SELECTORS : SHORTS_SELECTORS;
    for (var i = 0; i < sels.length; i++) {
      var els = document.querySelectorAll(sels[i]);
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        if (kind === 'watch' && el.closest('ytd-miniplayer, #secondary, ytd-comments')) continue;
        if (el.offsetParent !== null || el.getClientRects().length) return el;
      }
    }
    return null;
  }

  function ensure() {
    if (dead) return;
    if (!contextAlive()) { die(); return; }
    safe(function () {
      var kind = pageKind();
      var id = getVideoId();
      if (!enabled || !kind || !id) { closeMenuIfNav(); removeBtn(); return; }
      if (btn && btn.dataset.gokoKind !== kind) removeBtn();
      var target = findTarget(kind);
      if (!target) return;
      if (!btn) {
        btn = buildBtn(kind);
        btn.dataset.gokoKind = kind;
      }
      if (btn.dataset.gokoVid !== id) {
        btn.dataset.gokoVid = id;
        trackedId = null;
        flash = null;
        closeMenu();
      }
      if (btn.parentElement !== target || target.firstElementChild !== btn) {
        target.insertBefore(btn, target.firstChild);
      }
      // drop duplicates left behind by YouTube re-renders
      var all = document.querySelectorAll('.goko-root');
      for (var i = 0; i < all.length; i++) if (all[i] !== btn) all[i].remove();
      render();
    });
  }
  function closeMenuIfNav() { if (menuEl) closeMenu(); }

  // ---- progress ----
  function currentItem() {
    var id = btn && btn.dataset.gokoVid;
    if (!id || !lastItems) return null;
    var found = null;
    for (var i = 0; i < lastItems.length; i++) {
      var it = lastItems[i];
      if (!it) continue;
      if (trackedId && it.id === trackedId) return it;
      if (!found && idFromUrl(it.url) === id) found = it;
    }
    return found;
  }

  function setFill(p) {
    if (!fillEl) return;
    fillEl.style.width = p == null ? '0' : Math.max(0, Math.min(100, p)) + '%';
  }

  function render() {
    if (!btn || !labelEl) return;
    var text = 'İndir', title = '', state = 'idle', pct = null;
    var it = currentItem();
    var now = Date.now();
    if (flash && flash.until > now) {
      text = flash.text; title = flash.title || ''; state = flash.cls;
    } else if (it && (it.status === 'queued' || it.status === 'downloading')) {
      pct = Math.round(it.percent || 0);
      text = it.status === 'queued' ? '…' : '%' + pct;
      state = 'busy';
    } else if (it && it.status === 'processing') {
      text = 'İşleniyor…'; state = 'busy'; pct = 100;
    }
    labelEl.textContent = text;
    btn.classList.toggle('goko-busy', state === 'busy');
    btn.classList.toggle('goko-done', state === 'done');
    btn.classList.toggle('goko-error', state === 'error');
    var b = btn.querySelector('.goko-btn');
    if (b) b.title = title;
    setFill(state === 'busy' ? pct : state === 'done' ? 100 : null);
  }

  function startFlash(text, cls, ms, title) {
    flash = { text: text, cls: cls, title: title, until: Date.now() + ms };
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flash = null; render(); }, ms + 20);
  }

  function onDownloads(items) {
    lastItems = Array.isArray(items) ? items : [];
    var id = btn && btn.dataset.gokoVid;
    for (var i = 0; i < lastItems.length; i++) {
      var it = lastItems[i];
      if (!it) continue;
      var prev = seen[it.id];
      seen[it.id] = it.status;
      if (id && prev !== undefined && prev !== it.status && (it.id === trackedId || idFromUrl(it.url) === id)) {
        if (it.status === 'done') startFlash('İndirildi ✓', 'done', 4000);
        else if (it.status === 'error') startFlash('Hata', 'error', 6000, it.error || 'İndirme başarısız');
      }
    }
    render();
  }

  // ---- menu ----
  var ITEMS = [
    { label: 'En iyi kalite (MP4)', mode: 'video', quality: 'best' },
    { label: '1080p', mode: 'video', quality: '1080' },
    { label: '720p', mode: 'video', quality: '720' },
    { label: '480p', mode: 'video', quality: '480' },
    { label: 'Sadece ses (MP3)', mode: 'audio', audioFormat: 'mp3' },
    { label: 'Sadece ses (M4A)', mode: 'audio', audioFormat: 'm4a' },
    'sep',
    { label: 'Küçük resmi indir (en yüksek)', thumb: true }
  ];

  function openMenu(anchor) {
    closeMenu();
    var m = document.createElement('div');
    m.className = 'goko-menu';
    m.setAttribute('role', 'menu');
    ITEMS.forEach(function (d) {
      if (d === 'sep') {
        var s = document.createElement('div'); s.className = 'goko-sep'; m.appendChild(s); return;
      }
      var el = document.createElement('button');
      el.type = 'button'; el.className = 'goko-item'; el.setAttribute('role', 'menuitem');
      el.textContent = d.label;
      el.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        closeMenu();
        if (d.thumb) doThumb(); else doVideo(d);
      });
      m.appendChild(el);
    });
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    var mw = m.offsetWidth, mh = m.offsetHeight;
    var left = btn && btn.dataset.gokoKind === 'shorts' ? r.left - mw - 8 : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    if (btn && btn.dataset.gokoKind === 'shorts') top = Math.max(8, Math.min(r.top, window.innerHeight - mh - 8));
    m.style.left = left + 'px';
    m.style.top = top + 'px';
    menuEl = m;
    setTimeout(function () {
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', closeMenu);
    }, 0);
  }
  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', closeMenu);
  }
  function onDocClick(e) {
    if (menuEl && !menuEl.contains(e.target) && !(btn && btn.contains(e.target))) closeMenu();
  }
  function onKey(e) { if (e.key === 'Escape') closeMenu(); }

  // ---- actions ----
  function send(msg) {
    try {
      return Promise.resolve(chrome.runtime.sendMessage(msg)).catch(function (e) {
        if (isInvalid(e)) { die(); return null; }
        return { ok: false, error: String(e && e.message || e) };
      });
    } catch (e) {
      if (isInvalid(e)) die();
      return Promise.resolve(null);
    }
  }

  function doVideo(d) {
    var id = getVideoId();
    if (!id) return;
    var msg = {
      type: MSG.VIDEO_DOWNLOAD,
      url: 'https://www.youtube.com/watch?v=' + id,
      title: getTitle(),
      mode: d.mode,
      source: 'page'
    };
    if (d.quality) msg.quality = d.quality;
    if (d.audioFormat) msg.audioFormat = d.audioFormat;
    send(msg).then(function (res) {
      if (dead || !res) return;
      if (res.ok) {
        trackedId = res.id || null;
        if (res.id) seen[res.id] = 'queued';
        flash = null;
        render();
      } else if (res.error === 'not_installed') {
        toast('Video indirmek için Goko yardımcı uygulamasını kurun (GokoDownloaderSetup.exe)', 6000);
      } else {
        toast(res.error || 'İndirme başlatılamadı', 4000);
      }
    });
  }

  function doThumb() {
    var id = getVideoId();
    if (!id) return;
    send({ type: MSG.THUMB_DOWNLOAD, videoId: id, title: getTitle() }).then(function (res) {
      if (dead || !res) return;
      toast(res.ok ? 'Küçük resim indirildi' : (res.error || 'Küçük resim indirilemedi'), 3000);
    });
  }

  function toast(text, ms) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'goko-toast';
      toastEl.setAttribute('role', 'status');
    }
    toastEl.textContent = text;
    if (!toastEl.isConnected) document.body.appendChild(toastEl);
    // force reflow so the transition runs
    void toastEl.offsetWidth;
    toastEl.classList.add('goko-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (toastEl) toastEl.classList.remove('goko-show');
    }, ms || 3000);
  }

  // ---- wiring ----
  function schedule() {
    if (ensureTimer || dead) return;
    ensureTimer = setTimeout(function () { ensureTimer = null; ensure(); }, 350);
  }
  function onNav() {
    if (location.href !== lastHref) { lastHref = location.href; closeMenu(); }
    schedule();
    // YouTube renders the action row a bit after navigation finishes
    setTimeout(ensure, 800);
    setTimeout(ensure, 2000);
  }

  var mo = null;
  function init() {
    lastHref = location.href;
    document.addEventListener('goko-yt-teardown', function onTeardown() {
      document.removeEventListener('goko-yt-teardown', onTeardown);
      die();
    });
    // Leftovers of a previous instance that could not hear the teardown event.
    var old = document.querySelectorAll('.goko-root, .goko-menu, .goko-toast');
    for (var i = 0; i < old.length; i++) old[i].remove();
    document.addEventListener('yt-navigate-finish', onNav);
    document.addEventListener('yt-page-data-updated', schedule);
    window.addEventListener('popstate', onNav);
    mo = new MutationObserver(function () {
      if (location.href !== lastHref) { lastHref = location.href; closeMenu(); }
      schedule();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    safe(function () {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (dead) return;
        safe(function () {
          if (area === 'sync' && changes[KEYS.SETTINGS]) {
            var v = changes[KEYS.SETTINGS].newValue;
            enabled = !v || v.pageButton !== false;
            if (!enabled) { closeMenu(); removeBtn(); } else ensure();
          } else if (area === 'session' && changes[KEYS.DOWNLOADS]) {
            onDownloads(changes[KEYS.DOWNLOADS].newValue);
          }
        });
      });
      chrome.storage.sync.get(KEYS.SETTINGS).then(function (r) {
        var s = (r && r[KEYS.SETTINGS]) || {};
        enabled = s.pageButton !== false;
        ensure();
      }).catch(function (e) { if (isInvalid(e)) die(); else ensure(); });
      if (chrome.storage.session) {
        chrome.storage.session.get(KEYS.DOWNLOADS).then(function (r) {
          var items = r && r[KEYS.DOWNLOADS];
          if (Array.isArray(items)) {
            items.forEach(function (it) { if (it) seen[it.id] = it.status; });
            lastItems = items;
            render();
          }
        }).catch(function (e) { if (isInvalid(e)) die(); });
      }
    });
    ensure();
  }

  init();
})();
