// Goko Downloader - service worker hub. See docs/CONTRACT.md.
import { MSG, KEYS, NATIVE_HOST } from './lib/messages.js';
import { getSettings } from './lib/settings.js';
import { extractVideoId, thumbnailCandidates } from './lib/youtube.js';
import { buildCandidates, upgradeUrl } from './lib/imageResolver.js';

const MAX_ITEMS = 30;
const IDLE_MS = 60000;
const ACTIVE = ['queued', 'downloading', 'processing'];
const NOT_INSTALLED_MSG = "Yardımcı uygulama kurulu değil. GokoDownloaderSetup.exe'yi çalıştırın.";
const DISCONNECT_MSG = 'Yardımcı uygulama bağlantısı koptu';

// Let content scripts / UI read session storage.
try {
  Promise.resolve(chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })).catch(() => {});
} catch (_) {}

const errMsg = (e) => (e && e.message) ? e.message : String(e || 'Bilinmeyen hata');

/** Map Chrome's (English) native-messaging errors to 'not_installed' or Turkish text. */
function nativeError(raw) {
  const s = String(raw || '');
  if (!s) return DISCONNECT_MSG;
  if (/native messaging host not found/i.test(s)) return 'not_installed';
  if (/forbidden/i.test(s)) return 'Yardımcı uygulamaya erişim izni yok. Kurulumu yeniden çalıştırın.';
  if (/failed to start/i.test(s)) return 'Yardımcı uygulama başlatılamadı. Kurulumu yeniden çalıştırın.';
  if (/exited/i.test(s)) return 'Yardımcı uygulama beklenmedik şekilde kapandı.';
  if (/communicating|invalid native messaging/i.test(s)) return 'Yardımcı uygulama ile iletişim hatası.';
  return s;
}

/* ------------------------------------------------------------------ */
/* Session state (serialized through a promise queue)                  */
/* ------------------------------------------------------------------ */

let queue = Promise.resolve();
function enqueue(fn) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

const DEFAULT_HELPER = {
  connected: false, checked: false, hostVersion: null, ytdlpVersion: null,
  ffmpegFound: false, outDir: '', jsRuntime: null, error: null,
};

const readHelper = async () => ({ ...DEFAULT_HELPER, ...((await chrome.storage.session.get(KEYS.HELPER))[KEYS.HELPER] || {}) });
const readDownloads = async () => (await chrome.storage.session.get(KEYS.DOWNLOADS))[KEYS.DOWNLOADS] || [];

function setHelper(patch) {
  return enqueue(async () => {
    const next = { ...(await readHelper()), ...patch };
    await chrome.storage.session.set({ [KEYS.HELPER]: next });
    return next;
  });
}

/** Run `mutate(list)` (returns new list or mutates in place) and persist + refresh badge. */
function mutateDownloads(mutate) {
  return enqueue(async () => {
    const list = await readDownloads();
    const out = mutate(list) || list;
    const trimmed = out.slice(0, MAX_ITEMS);
    await chrome.storage.session.set({ [KEYS.DOWNLOADS]: trimmed });
    updateBadge(trimmed);
    return trimmed;
  });
}

function updateBadge(list) {
  const n = list.filter((d) => ACTIVE.includes(d.status)).length;
  chrome.action.setBadgeBackgroundColor({ color: '#E0245E' }).catch(() => {});
  chrome.action.setBadgeText({ text: n ? String(n) : '' }).catch(() => {});
}

const progressBuf = new Map(); // id -> coalesced patch
let flushTimer = null;

function applyPatches(entries) {
  return mutateDownloads((list) => {
    for (const [id, patch] of entries) {
      const it = list.find((d) => d.id === id);
      if (it) Object.assign(it, patch);
    }
  });
}

/** Update one item. Progress updates pass throttle=true (coalesced ~250ms). */
function updateItem(id, patch, throttle = false) {
  if (throttle) {
    progressBuf.set(id, { ...(progressBuf.get(id) || {}), ...patch });
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        const entries = [...progressBuf.entries()];
        progressBuf.clear();
        applyPatches(entries);
      }, 250);
    }
    return Promise.resolve();
  }
  const merged = { ...(progressBuf.get(id) || {}), ...patch };
  progressBuf.delete(id);
  return applyPatches([[id, merged]]);
}

async function markActiveAsError(message) {
  progressBuf.clear();
  await mutateDownloads((list) => {
    for (const d of list) if (ACTIVE.includes(d.status)) { d.status = 'error'; d.error = message; d.speed = null; d.eta = null; }
  });
}

/* ------------------------------------------------------------------ */
/* Native host connection                                              */
/* ------------------------------------------------------------------ */

let port = null;
let idleTimer = null;
const pending = new Map(); // reqId -> {resolve, reject, timer}

function connectPort() {
  if (port) return port;
  const p = chrome.runtime.connectNative(NATIVE_HOST);
  port = p;
  p.onMessage.addListener(onHostMessage);
  p.onDisconnect.addListener(() => onHostDisconnect(p));
  return p;
}

async function onHostDisconnect(p) {
  const raw = chrome.runtime.lastError?.message || null; // must be read synchronously-ish
  if (port !== p) return; // intentional/stale disconnect
  port = null;
  const error = nativeError(raw);
  for (const [, r] of pending) { clearTimeout(r.timer); r.reject(new Error(error)); }
  pending.clear();
  await setHelper({ connected: false, checked: true, error });
  await markActiveAsError(DISCONNECT_MSG);
}

function disconnectPort() {
  if (!port) return;
  const p = port;
  port = null; // so onDisconnect handler ignores it
  try { p.disconnect(); } catch (_) {}
}

function touchIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const list = await readDownloads();
    if (list.some((d) => ACTIVE.includes(d.status)) || pending.size) return touchIdle();
    disconnectPort();
  }, IDLE_MS);
}

/** Send a request with reqId and wait for the matching reply. */
function request(msg, timeoutMs) {
  return new Promise((resolve, reject) => {
    let p;
    try { p = connectPort(); } catch (e) { return reject(e); }
    const reqId = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(reqId); reject(new Error('Yardımcı uygulama yanıt vermedi')); }, timeoutMs);
    pending.set(reqId, { resolve, reject, timer });
    try { p.postMessage({ ...msg, reqId }); } catch (e) { clearTimeout(timer); pending.delete(reqId); reject(e); }
    touchIdle();
  });
}

function postToHost(msg) {
  connectPort().postMessage(msg);
  touchIdle();
}

/** Connect + ping; updates HelperState. Returns {ok, error?, helper}. */
async function ensureHelper(force = false) {
  try {
    // Never drop a live port while downloads run: the helper kills them on stdin EOF.
    if (force && !pending.size && !(await readDownloads()).some((d) => ACTIVE.includes(d.status))) disconnectPort();
    const r = await request({ cmd: 'ping' }, 20000);
    const helper = await setHelper({
      connected: true, checked: true, error: null,
      hostVersion: r.host_version ?? null, ytdlpVersion: r.ytdlp_version ?? null,
      ffmpegFound: !!r.ffmpeg_found, outDir: r.out_dir || '', jsRuntime: r.js_runtime ?? null,
    });
    return { ok: true, helper };
  } catch (e) {
    const error = nativeError(errMsg(e));
    const helper = await setHelper({ connected: false, checked: true, error });
    return { ok: false, error, helper };
  }
}

const helperFail = (r) => ({ ok: false, error: r.error });

function onHostMessage(m) {
  touchIdle();
  if (!m) return;
  if (m.reqId && pending.has(m.reqId)) {
    const r = pending.get(m.reqId);
    pending.delete(m.reqId);
    clearTimeout(r.timer);
    if (m.type === 'error') r.reject(new Error(m.message || 'Yardımcı uygulama hatası'));
    else r.resolve(m);
    return;
  }
  const id = m.id;
  if (!id) return; // stray/late reply (e.g. reqId already timed out) - not a download event
  switch (m.type) {
    case 'started': updateItem(id, { status: 'downloading' }); break;
    case 'progress':
      updateItem(id, {
        status: 'downloading',
        percent: Number(m.percent) || 0, speed: m.speed ?? null, eta: m.eta ?? null,
      }, true);
      break;
    case 'status': if (m.status) updateItem(id, { status: m.status, speed: null, eta: null }); break;
    case 'title': if (m.title) updateItem(id, { title: m.title }); break;
    case 'done':
      updateItem(id, { status: 'done', percent: 100, speed: null, eta: null, filepath: m.filepath || null, error: null })
        .then(() => notifyResult(id, true, m.filepath));
      break;
    case 'error':
      updateItem(id, { status: 'error', speed: null, eta: null, error: m.message || 'Bilinmeyen hata' })
        .then(() => notifyResult(id, false, m.message));
      break;
    case 'cancelled': updateItem(id, { status: 'cancelled', speed: null, eta: null }); break;
  }
}

async function notifyResult(id, ok, detail) {
  try {
    const s = await getSettings();
    if (!s.notify) return;
    const item = (await readDownloads()).find((d) => d.id === id);
    await chrome.notifications.create(ok ? `goko-done-${id}` : `goko-err-${id}`, {
      type: 'basic', iconUrl: 'icons/icon128.png',
      title: ok ? 'İndirme tamamlandı' : 'İndirme başarısız',
      message: ok ? (item?.title || item?.url || 'Dosya indirildi') : (detail || item?.title || 'Bilinmeyen hata'),
    });
  } catch (_) {}
}

chrome.notifications.onClicked.addListener(async (nid) => {
  if (!nid.startsWith('goko-done-')) return;
  const id = nid.slice('goko-done-'.length);
  const item = (await readDownloads()).find((d) => d.id === id);
  chrome.notifications.clear(nid);
  openFolder(item?.filepath || '').catch(() => {});
});

function notify(message, title = 'Goko Downloader') {
  if (message === 'not_installed') message = NOT_INSTALLED_MSG;
  try {
    Promise.resolve(chrome.notifications.create({
      type: 'basic', iconUrl: 'icons/icon128.png', title, message: String(message || 'Bilinmeyen hata'),
    })).catch(() => {});
  } catch (_) {}
}

/* ------------------------------------------------------------------ */
/* Video / helper commands                                             */
/* ------------------------------------------------------------------ */

/**
 * Browser cookies for a video URL, handed to the helper. It only uses them (as a temp cookies.txt for
 * yt-dlp) when a cookie-less attempt fails with a login wall: age restriction, bot check, members-only.
 */
async function browserCookiesFor(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch (_) { return []; }
  const isYouTube = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host);
  try {
    const list = await chrome.cookies.getAll(isYouTube ? { domain: 'youtube.com' } : { url });
    return list.map(({ name, value, domain, path, secure, hostOnly, session, expirationDate }) =>
      ({ name, value, domain, path, secure, hostOnly, session, expirationDate }));
  } catch (_) {
    return [];
  }
}

async function startVideo(p = {}) {
  if (!p.url) return { ok: false, error: 'Geçerli bir bağlantı yok' };
  const s = await getSettings();
  const h = await ensureHelper();
  if (!h.ok) return helperFail(h);
  const item = {
    id: crypto.randomUUID(), url: p.url, title: p.title || p.url,
    mode: p.mode === 'audio' ? 'audio' : 'video',
    quality: p.quality || s.videoQuality || 'best',
    audioFormat: p.audioFormat || s.audioFormat || 'mp3',
    source: p.source || 'popup',
    status: 'queued', percent: 0, speed: null, eta: null,
    filepath: null, error: null, createdAt: Date.now(),
  };
  await mutateDownloads((list) => { list.unshift(item); });
  const cmd = { cmd: 'download', id: item.id, url: item.url, mode: item.mode, quality: item.quality, audioFormat: item.audioFormat };
  if (s.outDir) cmd.outDir = s.outDir;
  if (s.filenameTemplate) cmd.template = s.filenameTemplate;
  if (s.useCookies) {
    const cookies = await browserCookiesFor(item.url);
    if (cookies.length) cmd.cookies = cookies;
  }
  try { postToHost(cmd); }
  catch (e) {
    await updateItem(item.id, { status: 'error', error: errMsg(e) });
    return { ok: false, error: errMsg(e) };
  }
  return { ok: true, id: item.id };
}

async function cancelVideo(id) {
  try { postToHost({ cmd: 'cancel', id }); }
  catch (_) { await updateItem(id, { status: 'cancelled', speed: null, eta: null }); }
  return { ok: true };
}

async function openFolder(path) {
  const h = await ensureHelper();
  if (!h.ok) return helperFail(h);
  await request({ cmd: 'open_folder', ...(path ? { path } : {}) }, 5000);
  return { ok: true };
}

async function updateYtdlp() {
  const h = await ensureHelper();
  if (!h.ok) return helperFail(h);
  const r = await request({ cmd: 'update' }, 200000); // helper allows yt-dlp -U up to 180 s
  if (r.ytdlp_version) await setHelper({ ytdlpVersion: r.ytdlp_version });
  return { ok: r.ok !== false, output: r.output || '', version: r.ytdlp_version || null, ...(r.ok === false ? { error: r.output || 'Güncelleme başarısız' } : {}) };
}

/* ------------------------------------------------------------------ */
/* Filenames + chrome.downloads helpers                                */
/* ------------------------------------------------------------------ */

// Chrome (base::i18n::IsFilenameLegal / IsReservedNameOnWindows) rejects these with "Invalid filename".
const RESERVED_RE = /^(con|prn|aux|nul|clock\$|com\d|lpt\d|desktop\.ini|thumbs\.db)(\.|$)/i;

function safeName(s) {
  let n = String(s ?? '')
    .replace(/[\\/:*?"<>|~\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Noncharacter_Code_Point}]/gu, '')
    .replace(/\s+/g, ' ').trim();
  n = n.slice(0, 120).replace(/[.\s]+$/u, '').replace(/^[.\s]+/u, '');
  if (RESERVED_RE.test(n)) n = '_' + n;
  return n;
}

/** Build a relative download path "subfolder/name" (no leading slash, no ..). */
function relPath(subfolder, name) {
  const parts = String(subfolder || '').split(/[\\/]+/).map(safeName).filter((x) => x && x !== '..');
  parts.push(name);
  return parts.join('/');
}

/** chrome.downloads.download with fallbacks when Chrome rejects the filename ("Invalid filename"). */
async function saveUrl(url, filename, subfolder = '') {
  const tries = [];
  if (filename) {
    tries.push(filename);
    const ext = (filename.match(/\.([a-z0-9]{1,5})$/i) || [])[1];
    tries.push(relPath(subfolder, `goko-${Date.now()}${ext ? '.' + ext : ''}`));
  }
  tries.push(undefined); // let Chrome pick the name
  let lastErr;
  for (const fn of tries) {
    try {
      return await chrome.downloads.download({ url, conflictAction: 'uniquify', ...(fn ? { filename: fn } : {}) });
    } catch (e) {
      lastErr = e;
      if (!/filename/i.test(errMsg(e))) break; // not a filename problem: don't retry
    }
  }
  throw new Error(`İndirme başlatılamadı: ${errMsg(lastErr)}`);
}

async function directDownload({ url, filename } = {}) {
  if (!url) return { ok: false, error: 'Geçerli bir bağlantı yok' };
  const s = await getSettings();
  const fn = safeName(filename);
  return { ok: true, downloadId: await saveUrl(url, fn ? relPath(s.subfolder, fn) : undefined, s.subfolder) };
}

/* ------------------------------------------------------------------ */
/* YouTube thumbnails                                                  */
/* ------------------------------------------------------------------ */

async function probeThumb(videoId, format = 'jpg') {
  if (!videoId) throw new Error('Video kimliği bulunamadı');
  const fmt = format === 'webp' ? 'webp' : 'jpg';
  for (const c of thumbnailCandidates(videoId, fmt)) {
    try {
      const res = await fetch(c.url, { method: 'GET', cache: 'no-store' });
      if (!res.ok) continue;
      const len = Number(res.headers.get('content-length'));
      if (len && len < 2000) continue; // 120x90 placeholder
      const blob = await res.blob();
      if (blob.size < 2000) continue;
      return { ...c, ext: fmt };
    } catch (_) { /* try next */ }
  }
  throw new Error('Küçük resim bulunamadı');
}

async function thumbProbe(p = {}) {
  const s = await getSettings();
  const c = await probeThumb(p.videoId, p.format || s.thumbFormat);
  return { ok: true, url: c.url, name: c.name, width: c.width, height: c.height };
}

async function thumbDownload(p = {}) {
  const s = await getSettings();
  const c = await probeThumb(p.videoId, p.format || s.thumbFormat);
  const base = safeName(p.title || p.videoId) || p.videoId;
  await saveUrl(c.url, relPath(s.subfolder, `${base} [${p.videoId}] ${c.name}.${c.ext}`), s.subfolder);
  return { ok: true, url: c.url, name: c.name };
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/pjpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
};
const IMG_EXT_RE = /\.(jpe?g|png|gif|webp|avif|svg|bmp)(?:$|[?#])/i;

async function fetchT(url, opts = {}, ms = 6000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal, credentials: 'include' }); }
  finally { clearTimeout(t); }
}

function acceptImage(res, url) {
  if (res.status !== 200 && res.status !== 206) return null;
  const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (ct.startsWith('image/')) return ct;
  if (!ct && IMG_EXT_RE.test(url)) return 'image/' + (url.match(IMG_EXT_RE)[1].toLowerCase().replace('jpg', 'jpeg'));
  return null;
}

/** Returns content-type if the URL serves an image, else null. */
async function probeImage(url) {
  let needGet = false;
  try {
    const res = await fetchT(url, { method: 'HEAD' });
    const ct = acceptImage(res, url);
    if (ct) return ct;
    needGet = [0, 400, 403, 405, 501].includes(res.status) || res.status === 200; // 200 w/o image type: GET may differ
  } catch (_) { needGet = true; }
  if (!needGet) return null;
  try {
    const res = await fetchT(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
    const ct = acceptImage(res, url);
    try { await res.body?.cancel(); } catch (_) {}
    return ct;
  } catch (_) { return null; }
}

/** Test candidates sequentially (best first). Returns {url, type} or null. */
async function resolveBestImage(candidates) {
  const list = [...new Set((candidates || []).filter(Boolean))];
  const remote = list.filter((u) => !u.startsWith('data:'));
  const data = list.filter((u) => u.startsWith('data:'));
  for (const url of remote) {
    const type = await probeImage(url);
    if (type) return { url, type };
  }
  if (data.length) return { url: data[0], type: (data[0].match(/^data:([^;,]+)/) || [])[1] || null };
  // Nothing verified (hotlink protection etc.): let chrome.downloads try the last remote candidate.
  if (remote.length) return { url: remote[remote.length - 1], type: null, unverified: true };
  return null;
}

function imageFilename(url, type, hint) {
  let base = '';
  if (hint) base = safeName(hint);
  if (!base && !url.startsWith('data:')) {
    try {
      let seg = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
      try { seg = decodeURIComponent(seg); } catch (_) {}
      base = safeName(seg.replace(/\.[a-z0-9]{2,5}$/i, ''));
    } catch (_) {}
  }
  if (!base) base = `image-${Date.now()}`;
  let ext = EXT_BY_TYPE[type || ''];
  if (!ext) { const m = url.match(IMG_EXT_RE); ext = m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg'; }
  return `${base}.${ext}`;
}

async function downloadImage(candidates, hint) {
  const best = await resolveBestImage(candidates);
  if (!best) throw new Error('Görsel adresi bulunamadı');
  const s = await getSettings();
  await saveUrl(best.url, relPath(s.subfolder, imageFilename(best.url, best.type, hint)), s.subfolder);
  return best.url;
}

const candidatesOf = (it = {}) => it.candidates || (it.info ? buildCandidates(it.info) : []);

async function imageDownload(p = {}) {
  return { ok: true, url: await downloadImage(candidatesOf(p), p.filenameHint) };
}

async function imagesDownload({ items = [] } = {}) {
  let count = 0, failed = 0, i = 0;
  const worker = async () => {
    while (i < items.length) {
      const it = items[i++];
      try { await downloadImage(candidatesOf(it), it.filenameHint); count++; } catch (_) { failed++; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
  return { ok: failed === 0 || count > 0, count, failed };
}

/* ------------------------------------------------------------------ */
/* Message router                                                      */
/* ------------------------------------------------------------------ */

const handlers = {
  [MSG.GET_STATE]: async () => ({ ok: true, helper: await readHelper(), downloads: await readDownloads() }),
  [MSG.HELPER_PING]: async () => { const r = await ensureHelper(true); return { ok: r.ok, helper: r.helper, ...(r.ok ? {} : { error: r.error }) }; },
  [MSG.VIDEO_DOWNLOAD]: (m) => startVideo(m),
  [MSG.VIDEO_CANCEL]: (m) => cancelVideo(m.id),
  [MSG.CLEAR_FINISHED]: async () => { await mutateDownloads((l) => l.filter((d) => ACTIVE.includes(d.status))); return { ok: true }; },
  [MSG.OPEN_FOLDER]: (m) => openFolder(m.path),
  [MSG.YTDLP_UPDATE]: () => updateYtdlp(),
  [MSG.THUMB_DOWNLOAD]: (m) => thumbDownload(m),
  [MSG.THUMB_PROBE]: (m) => thumbProbe(m),
  [MSG.IMAGE_DOWNLOAD]: (m) => imageDownload(m),
  [MSG.IMAGES_DOWNLOAD]: (m) => imagesDownload(m),
  [MSG.DIRECT_DOWNLOAD]: (m) => directDownload(m),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const h = msg && handlers[msg.type];
  if (!h) return false;
  Promise.resolve().then(() => h(msg)).then(sendResponse, (e) => sendResponse({ ok: false, error: errMsg(e) }));
  return true;
});

/* ------------------------------------------------------------------ */
/* Context menus                                                       */
/* ------------------------------------------------------------------ */

const YT_PATTERNS = ['*://*.youtube.com/*', '*://youtu.be/*'];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    const c = (o) => chrome.contextMenus.create(o, () => void chrome.runtime.lastError);
    c({ id: 'goko-image', title: 'Görseli en yüksek kalitede indir', contexts: ['image'] });
    c({ id: 'goko-video-page', title: 'Bu sayfadaki videoyu indir (en iyi kalite)', contexts: ['page', 'video'] });
    c({ id: 'goko-video-link', title: 'Bağlantıdaki videoyu indir', contexts: ['link'] });
    // Two entries: page/video context is filtered by the document URL, link context by the link target.
    c({ id: 'goko-thumb', title: 'YouTube küçük resmini indir (en yüksek kalite)', contexts: ['page', 'video'], documentUrlPatterns: YT_PATTERNS });
    c({ id: 'goko-thumb-link', title: 'YouTube küçük resmini indir (en yüksek kalite)', contexts: ['link'], targetUrlPatterns: YT_PATTERNS });
  });
  injectIntoOpenYouTubeTabs();
});

// Manifest content scripts are not injected into tabs that were already open at install/update/reload
// time; inject the page button there (youtube.js tears down any orphaned previous instance itself).
async function injectIntoOpenYouTubeTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ['*://*.youtube.com/*'] });
    for (const t of tabs) {
      if (t.id == null || t.discarded) continue;
      const target = { tabId: t.id };
      chrome.scripting.insertCSS({ target, files: ['content/youtube.css'] })
        .then(() => chrome.scripting.executeScript({ target, files: ['content/youtube.js'] }))
        .catch(() => {});
    }
  } catch (_) {}
}

// Wake the worker at browser start so the session access level is set early for content scripts.
chrome.runtime.onStartup.addListener(() => {});

async function menuVideo(url) {
  const r = await startVideo({ url, source: 'menu' });
  if (!r.ok) notify(r.error === 'not_installed' ? NOT_INSTALLED_MSG : r.error);
}

async function menuImage(info, tab) {
  const src = info.srcUrl;
  if (!src) return;
  let candidates;
  try {
    const target = { tabId: tab.id, frameIds: [info.frameId || 0] };
    await chrome.scripting.executeScript({ target, files: ['content/scanner.js'] });
    const [res] = await chrome.scripting.executeScript({ target, func: (u) => window.__gokoImageInfo(u), args: [src] });
    candidates = buildCandidates(res?.result || { src });
  } catch (_) {
    candidates = [...upgradeUrl(src), src]; // restricted page etc.
  }
  try { await downloadImage(candidates); }
  catch (e) { notify(errMsg(e)); }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    switch (info.menuItemId) {
      case 'goko-image': return await menuImage(info, tab || {});
      case 'goko-video-page': {
        const direct = info.mediaType === 'video' && /^https?:/i.test(info.srcUrl || '');
        return await menuVideo(direct ? info.srcUrl : (info.pageUrl || tab?.url));
      }
      case 'goko-video-link': return await menuVideo(info.linkUrl);
      case 'goko-thumb':
      case 'goko-thumb-link': {
        // frameUrl: right-click inside an embedded YouTube player on another site.
        const videoId = [info.linkUrl, info.frameUrl, info.pageUrl, tab?.url].map((u) => extractVideoId(u || '')).find(Boolean);
        if (!videoId) return notify('Video kimliği bulunamadı');
        const pageId = extractVideoId(info.pageUrl || tab?.url || '');
        const title = tab?.title && pageId === videoId ? tab.title.replace(/^\(\d+\+?\)\s*/, '').replace(/ - YouTube$/, '') : undefined;
        await thumbDownload({ videoId, title });
        return;
      }
    }
  } catch (e) { notify(errMsg(e)); }
});

// Worker (re)start: the native port (if any) died with the previous worker instance and the helper
// kills its downloads on stdin EOF, so items still marked active can never finish - mark them failed.
// Runs first in the queue (module evaluation precedes event dispatch), so new items are never touched.
enqueue(async () => {
  const list = await readDownloads();
  let stale = false;
  for (const d of list) {
    if (ACTIVE.includes(d.status)) { stale = true; d.status = 'error'; d.error = DISCONNECT_MSG; d.speed = null; d.eta = null; }
  }
  if (stale) await chrome.storage.session.set({ [KEYS.DOWNLOADS]: list });
  updateBadge(list);
}).catch(() => {});
