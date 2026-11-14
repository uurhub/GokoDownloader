// Goko Downloader — popup UI (ES module). See docs/CONTRACT.md.
import { MSG, KEYS, QUALITIES } from '../lib/messages.js';
import { getSettings, DEFAULT_SETTINGS } from '../lib/settings.js';
import { extractVideoId, isYouTubeVideoPage } from '../lib/youtube.js';

/* =========================================================================
 * Small helpers
 * ====================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);

/** Tiny element factory: h('div', {class, onClick, ...attrs}, ...children) */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'disabled' || k === 'checked') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const ICONS = {
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  images: '<path d="M18 22H4a2 2 0 0 1-2-2V6"/><rect x="6" y="2" width="16" height="16" rx="2"/><circle cx="12" cy="8" r="2"/><path d="m22 13-1.3-1.3a2 2 0 0 0-2.8 0L10 19.6"/>',
  video: '<rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  wand: '<path d="m15 4-1 1M19 8l1-1M17 3v2M21 7h-2M3 21 14 10M12 8l4 4"/>',
};
function icon(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
  return t.content.firstChild;
}
const spinner = (cls = '') => h('span', { class: `spinner ${cls}`, 'aria-hidden': 'true' });

const ERROR_TEXT = {
  not_installed: 'Goko Yardımcı Uygulaması kurulu değil.',
  disconnected: 'Yardımcı uygulama ile bağlantı koptu.',
};
const errText = (res, fallback = 'Bir hata oluştu.') =>
  (res && (ERROR_TEXT[res.error] || res.error)) || fallback;
const isNotInstalled = (res) => !!res && (res.error === 'not_installed' || res.code === 'not_installed');

/** Safe wrapper around chrome.runtime.sendMessage — always resolves to an object. */
async function send(type, payload = {}) {
  try {
    const res = await chrome.runtime.sendMessage({ type, ...payload });
    if (res && typeof res === 'object') return res;
    return { ok: false, error: 'Arka plan hizmeti yanıt vermedi.' };
  } catch {
    return { ok: false, error: 'Arka plan hizmetine ulaşılamadı.' };
  }
}

const nf1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
function fmtBytes(b) {
  if (!(b > 0)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return `${nf1.format(b)} ${units[i]}`;
}
const fmtSpeed = (b) => (b > 0 ? `${fmtBytes(b)}/s` : '');
function fmtEta(s) {
  if (!(s >= 0) || !Number.isFinite(s)) return '';
  s = Math.round(s);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}
const qualityLabel = (q) => (!q || q === 'best' ? 'En iyi' : `${q}p`);

function fileNameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return last || u.hostname;
  } catch { return String(url || '').slice(0, 80); }
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }

function cleanYouTubeTitle(t) {
  return String(t || '').replace(/^\(\d+\+?\)\s*/, '').replace(/\s*-\s*YouTube\s*$/i, '').trim();
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text; document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

/* =========================================================================
 * State
 * ====================================================================== */

const state = {
  tab: null,
  url: '',
  ctx: 'restricted', // 'youtube' | 'web' | 'file' | 'restricted'
  restrictReason: 'generic',
  videoId: null,
  title: '',
  settings: { ...DEFAULT_SETTINGS },
  helper: null,
  downloads: [],
  activeTab: null,
  video: { mode: 'video', quality: 'best', audioFormat: 'mp3' },
  thumb: { format: 'jpg', loading: false, data: null, error: null, token: 0, probed: false },
  scanPromise: null,
  scan: null, // {ok, images, videos, error}
  img: { minSize: 200, selected: new Set() },
  dlOpen: false,
  dlKnown: new Set(),
};
const els = { panels: {}, tabs: {}, dlRows: new Map() };

/* =========================================================================
 * Toast
 * ====================================================================== */

let toastTimer = 0;
function toast(msg, type = 'info') {
  const t = $('#toast');
  if (!t) return;
  t.replaceChildren(icon(type === 'error' ? 'alert' : type === 'success' ? 'check' : 'info'), h('span', { text: msg }));
  t.dataset.type = type;
  // restart transition
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), type === 'error' ? 3500 : 2500);
}

/* =========================================================================
 * Button state helpers
 * ====================================================================== */

function btnLoading(btn, on, label) {
  if (!btn) return;
  if (on) {
    if (btn._html == null) btn._html = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.replaceChildren(spinner(), label ? h('span', { text: label }) : null);
  } else {
    btn.classList.remove('is-loading');
    btn.disabled = false;
    if (btn._html != null) { btn.innerHTML = btn._html; btn._html = null; }
  }
}
function btnSuccess(btn, label, ms = 1700) {
  if (!btn) return;
  if (btn._html == null) btn._html = btn.innerHTML;
  btn.classList.remove('is-loading');
  btn.classList.add('is-success');
  btn.disabled = true;
  btn.replaceChildren(h('span', { text: label }), icon('check'));
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    btn.classList.remove('is-success');
    btn.disabled = false;
    if (btn._html != null) { btn.innerHTML = btn._html; btn._html = null; }
  }, ms);
}

/* =========================================================================
 * Generic controls
 * ====================================================================== */

/** Two-or-more option toggle with aria-pressed. */
function segmented(options, value, onChange, { label, compact = false } = {}) {
  const wrap = h('div', { class: `seg${compact ? ' compact' : ''}`, role: 'group', 'aria-label': label });
  const buttons = options.map((o) => h('button', {
    class: 'seg-btn', type: 'button', 'aria-pressed': String(o.value === value),
    onClick: (e) => {
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      onChange(o.value);
    },
  }, o.icon ? icon(o.icon) : null, h('span', { text: o.label })));
  append(wrap, buttons);
  return wrap;
}

function chipGroup(options, value, onChange, { label, cls = '' } = {}) {
  const wrap = h('div', { class: `chips ${cls}`, role: 'group', 'aria-label': label });
  const chips = options.map((o) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(o.value === value), title: o.title,
    onClick: (e) => {
      chips.forEach((c) => c.setAttribute('aria-pressed', String(c === e.currentTarget)));
      onChange(o.value);
    },
  }, h('span', { text: o.label }), o.sub ? h('span', { class: 'chip-sub', text: o.sub }) : null));
  append(wrap, chips);
  return wrap;
}

function emptyState(iconName, title, text, { big = false, boxed = false, action = null } = {}) {
  return h('div', { class: `empty${big ? ' big' : ''}${boxed ? ' boxed' : ''}` },
    h('div', { class: 'empty-ico' }, icon(iconName)),
    h('strong', { text: title }),
    text ? h('p', { text }) : null,
    action);
}

/* =========================================================================
 * Helper status
 * ====================================================================== */

const helperNotInstalled = () => {
  const hs = state.helper;
  return !!hs && !hs.connected && hs.error === 'not_installed';
};
const helperKey = (hs) => (hs ? [hs.connected, hs.checked, hs.error, hs.ffmpegFound].join('|') : 'none');

function updateHelperUI() {
  const el = $('#helperStatus');
  const lbl = $('#helperLabel');
  if (!el || !lbl) return;
  const hs = state.helper;
  let st, text, tip;
  if (!hs || (!hs.checked && !hs.connected)) {
    st = 'checking'; text = 'Kontrol ediliyor'; tip = 'Yardımcı uygulama kontrol ediliyor…';
  } else if (hs.connected) {
    st = 'ready'; text = 'Yardımcı hazır';
    tip = [
      `yt-dlp ${hs.ytdlpVersion || 'sürümü bilinmiyor'}`,
      hs.hostVersion ? `Yardımcı sürümü ${hs.hostVersion}` : null,
      hs.ffmpegFound ? 'ffmpeg bulundu' : 'ffmpeg bulunamadı',
      'Yeniden kontrol için tıklayın',
    ].filter(Boolean).join('\n');
  } else {
    st = 'none'; text = 'Yardımcı yok';
    tip = `${hs.error === 'not_installed' ? 'Yardımcı uygulama kurulu değil' : (ERROR_TEXT[hs.error] || hs.error || 'Yardımcı uygulamaya bağlanılamadı')}\nYeniden kontrol için tıklayın`;
  }
  el.dataset.state = st;
  el.title = tip;
  el.setAttribute('aria-label', `Yardımcı uygulama durumu: ${text}`);
  lbl.textContent = text;
}

function setHelper(hs) {
  const changed = helperKey(hs) !== helperKey(state.helper);
  state.helper = hs && typeof hs === 'object' ? hs : null;
  updateHelperUI();
  if (changed) { renderVideoAction(); renderSources(); }
}

async function recheckHelper(btn) {
  btnLoading(btn, true, btn && btn.classList.contains('btn') ? 'Kontrol ediliyor…' : '');
  const el = $('#helperStatus');
  if (el) el.dataset.state = 'checking';
  const res = await send(MSG.HELPER_PING);
  btnLoading(btn, false);
  if (res.helper) setHelper(res.helper); else updateHelperUI();
  if (res.helper && res.helper.connected) toast('Yardımcı uygulama hazır', 'success');
  else toast(res.helper ? 'Yardımcı uygulama bulunamadı' : errText(res), 'error');
}

/* =========================================================================
 * Context (active tab)
 * ====================================================================== */

async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch { return null; }
}
async function hasFileAccess() {
  try { return !!(await chrome.extension.isAllowedFileSchemeAccess()); } catch { return false; }
}
function safeIsYouTube(url) {
  try { return !!isYouTubeVideoPage(url) && !!extractVideoId(url); } catch { return false; }
}

function classify(url, fileAccess) {
  let u;
  try { u = new URL(url); } catch { return ['restricted', 'generic']; }
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    if (u.hostname === 'chromewebstore.google.com' ||
        (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'))) return ['restricted', 'store'];
    return [safeIsYouTube(url) ? 'youtube' : 'web', ''];
  }
  if (u.protocol === 'file:') return fileAccess ? ['file', ''] : ['restricted', 'file'];
  return ['restricted', 'generic'];
}

const watchUrl = () => `https://www.youtube.com/watch?v=${state.videoId}`;
const hqThumb = () => `https://i.ytimg.com/vi/${state.videoId}/hqdefault.jpg`;

/* =========================================================================
 * Shell rendering
 * ====================================================================== */

function renderContext() {
  const box = $('#context');
  box.replaceChildren();
  if (state.ctx === 'youtube') {
    box.append(h('div', { class: 'media' },
      h('div', { class: 'media-thumb' },
        h('img', { src: hqThumb(), alt: '', decoding: 'async' }),
        h('span', { class: 'play' }, icon('play'))),
      h('div', { class: 'media-body' },
        h('div', { class: 'media-title', title: state.title, text: state.title || 'YouTube videosu' }),
        h('div', { class: 'media-sub', text: `YouTube · ${state.videoId}` }))));
  } else if (state.ctx === 'web' || state.ctx === 'file') {
    const fav = state.tab && state.tab.favIconUrl && /^https?:|^data:/.test(state.tab.favIconUrl)
      ? h('img', { src: state.tab.favIconUrl, alt: '' }) : icon('globe');
    if (fav.tagName === 'IMG') fav.addEventListener('error', () => fav.replaceWith(icon('globe')));
    box.append(h('div', { class: 'media' },
      h('div', { class: 'media-fav' }, fav),
      h('div', { class: 'media-body' },
        h('div', { class: 'media-title', title: state.title, text: state.title || hostOf(state.url) || 'Sayfa' }),
        h('div', { class: 'media-sub', text: state.ctx === 'file' ? 'Yerel dosya' : hostOf(state.url) }))));
  }
}

const TAB_DEFS = {
  video: { label: 'Video', icon: 'video' },
  thumb: { label: 'Küçük Resim', icon: 'image' },
  images: { label: 'Görseller', icon: 'images' },
};

function renderTabs(ids) {
  const bar = $('#tabs');
  const main = $('#main');
  bar.replaceChildren(); main.replaceChildren();
  bar.hidden = ids.length < 2;
  for (const id of ids) {
    const def = TAB_DEFS[id];
    const tab = h('button', {
      class: 'tab', type: 'button', role: 'tab', id: `tab-${id}`,
      'aria-controls': `panel-${id}`, 'aria-selected': 'false', tabindex: '-1',
      onClick: () => switchTab(id),
    }, icon(def.icon), h('span', { text: def.label }));
    els.tabs[id] = tab;
    bar.append(tab);
    const panel = h('section', {
      class: `panel ${id}`, role: 'tabpanel', id: `panel-${id}`, 'aria-labelledby': `tab-${id}`, hidden: true,
    });
    els.panels[id] = panel;
    main.append(panel);
  }
  bar.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = ids.indexOf(state.activeTab);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1
      : (i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
    switchTab(ids[n]);
    els.tabs[ids[n]].focus();
  });
}

const builtPanels = new Set();
function switchTab(id) {
  if (!els.panels[id]) return;
  state.activeTab = id;
  for (const [tid, tab] of Object.entries(els.tabs)) {
    const on = tid === id;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    els.panels[tid].hidden = !on;
  }
  $('#main').scrollTop = 0;
  if (!builtPanels.has(id)) {
    builtPanels.add(id);
    if (id === 'video') buildVideoPanel(els.panels.video);
    else if (id === 'thumb') buildThumbPanel(els.panels.thumb);
    else if (id === 'images') buildImagesPanel(els.panels.images);
  }
}

function renderRestricted() {
  $('#tabs').hidden = true;
  const texts = {
    store: ['Bu sayfada indirme yapılamaz', 'Chrome Web Mağazası sayfalarında eklentiler çalışamaz. Başka bir sayfa açıp tekrar deneyin.'],
    file: ['Bu sayfada indirme yapılamaz', 'Yerel dosyalar için eklenti ayrıntılarından “Dosya URL’lerine erişime izin ver” seçeneğini açın.'],
    generic: ['Bu sayfada indirme yapılamaz', 'Tarayıcı sayfalarında ve yeni sekmede eklentiler çalışamaz. Bir web sayfası açıp tekrar deneyin.'],
  };
  const [title, text] = texts[state.restrictReason] || texts.generic;
  $('#main').replaceChildren(h('div', { class: 'panel' }, emptyState('lock', title, text, { big: true })));
}

/* =========================================================================
 * Video tab
 * ====================================================================== */

function buildVideoPanel(p) {
  if (state.ctx === 'web') {
    p.append(h('div', { class: 'card intro' },
      h('div', { class: 'intro-ico' }, icon('globe')),
      h('div', {},
        h('h2', { text: 'Bu sayfadaki videoyu indir' }),
        h('p', { text: 'yt-dlp; Vimeo, X, Instagram, TikTok, Twitch dahil 1000’den fazla siteyi destekler. Sayfa adresi yardımcı uygulamaya gönderilir.' }))));
  }
  els.fmtWrap = h('div', { class: 'stack' });
  p.append(h('div', { class: 'card stack' },
    segmented([
      { value: 'video', label: 'Video', icon: 'video' },
      { value: 'audio', label: 'Sadece Ses', icon: 'music' },
    ], state.video.mode, (v) => { state.video.mode = v; renderFormatOptions(); }, { label: 'İndirme türü' }),
    els.fmtWrap));
  els.videoAction = h('div', { class: 'action' });
  p.append(els.videoAction);

  if (state.ctx === 'web') {
    els.sources = h('div', { class: 'sources' });
    p.append(h('div', { class: 'section' },
      h('div', { class: 'section-head' },
        h('h3', { text: 'Sayfada bulunan video kaynakları' }),
        h('button', {
          class: 'icon-btn sm', type: 'button', title: 'Yeniden tara', 'aria-label': 'Sayfayı yeniden tara',
          onClick: () => rescan(),
        }, icon('refresh'))),
      els.sources));
    renderSources();
    ensureScan().then(renderSources);
  }
  renderFormatOptions();
  renderVideoAction();
}

function renderFormatOptions() {
  const wrap = els.fmtWrap;
  if (!wrap) return;
  wrap.replaceChildren();
  if (state.video.mode === 'video') {
    wrap.append(
      h('div', { class: 'field-label', text: 'Kalite' }),
      chipGroup(QUALITIES.map((q) => ({ value: q.value, label: q.label, title: q.value === 'best' ? 'Mevcut en yüksek kalite' : `En fazla ${q.value}p` })),
        state.video.quality, (v) => { state.video.quality = v; }, { label: 'Video kalitesi' }));
  } else {
    wrap.append(
      h('div', { class: 'field-label', text: 'Ses biçimi' }),
      chipGroup([
        { value: 'mp3', label: 'MP3', sub: 'En uyumlu' },
        { value: 'm4a', label: 'M4A', sub: 'Orijinal kalite' },
      ], state.video.audioFormat, (v) => { state.video.audioFormat = v; }, { label: 'Ses biçimi', cls: 'two' }));
  }
}

function helperCard() {
  const btn = h('button', { class: 'btn btn-primary', type: 'button' }, icon('refresh'), h('span', { text: 'Tekrar kontrol et' }));
  btn.addEventListener('click', () => recheckHelper(btn));
  return h('div', { class: 'helper-card', role: 'note' },
    h('div', { class: 'helper-card-head' }, icon('info'),
      h('strong', { text: 'Video indirmek için Goko Yardımcı Uygulaması gerekli' })),
    h('ol', { class: 'steps' },
      h('li', {}, h('span', {}, h('code', { text: 'GokoDownloaderSetup.exe' }), '’yi çalıştırın')),
      h('li', { text: 'Tarayıcıyı yeniden başlatın' })),
    h('p', { class: 'muted small', text: 'Küçük resim ve görsel indirme yardımcı uygulama olmadan da çalışır.' }),
    btn);
}

function renderVideoAction() {
  const el = els.videoAction;
  if (!el) return;
  el.replaceChildren();
  const missing = helperNotInstalled();
  el.classList.toggle('sticky-bottom', !missing);
  if (missing) { el.append(helperCard()); return; }
  const btn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button' },
    icon('download'), h('span', { text: 'İndir' }));
  btn.addEventListener('click', () => {
    const url = state.ctx === 'youtube' ? watchUrl() : state.url;
    startVideoDownload(btn, url, state.title);
  });
  el.append(btn);
  const hs = state.helper;
  if (hs && hs.connected && hs.ffmpegFound === false) {
    el.append(h('div', { class: 'hint' }, icon('alert'),
      h('span', { text: 'ffmpeg bulunamadı: yüksek kaliteli video birleştirme ve MP3 dönüştürme çalışmayabilir.' })));
  }
}

async function startVideoDownload(btn, url, title) {
  if (!url || (btn && btn.disabled)) return;
  btnLoading(btn, true);
  const res = await send(MSG.VIDEO_DOWNLOAD, {
    url,
    title: title || undefined,
    mode: state.video.mode,
    quality: state.video.quality,
    audioFormat: state.video.audioFormat,
    source: 'popup',
  });
  btnLoading(btn, false);
  if (res.ok) {
    btnSuccess(btn, 'Kuyruğa eklendi');
    if (res.id) state.dlKnown.add(res.id);
    setDlOpen(true);
    // Pull fresh state in case the storage event is slow.
    const st = await send(MSG.GET_STATE);
    if (Array.isArray(st.downloads)) setDownloads(st.downloads);
  } else if (isNotInstalled(res)) {
    setHelper({ ...(state.helper || {}), connected: false, checked: true, error: 'not_installed' });
    toast('Video indirmek için yardımcı uygulama gerekli', 'error');
  } else {
    toast(errText(res, 'İndirme başlatılamadı.'), 'error');
  }
}

/* ---------- Video sources found on the page ---------- */

const KIND_LABEL = { hls: 'HLS', dash: 'DASH', blob: 'AKIŞ' };
function directExt(v) {
  const t = String(v.type || '').split('/')[1];
  if (t) return t.split(';')[0].toUpperCase().slice(0, 5);
  const m = /\.([a-z0-9]{2,4})(?:$|[?#])/i.exec(v.src || '');
  return m ? m[1].toUpperCase() : 'VIDEO';
}

function renderSources() {
  const box = els.sources;
  if (!box) return;
  box.replaceChildren();
  if (!state.scan) {
    box.append(h('div', { class: 'empty boxed' }, spinner(), h('p', { text: 'Sayfa taranıyor…' })));
    return;
  }
  if (!state.scan.ok) {
    box.append(emptyState('alert', 'Sayfa taranamadı', state.scan.error, { boxed: true }));
    return;
  }
  const vids = state.scan.videos;
  if (!vids.length) {
    box.append(emptyState('video', 'Doğrudan video kaynağı bulunamadı',
      'Yukarıdaki “İndir” butonu sayfayı yt-dlp ile yine de deneyebilir.', { boxed: true }));
    return;
  }
  const needHelper = helperNotInstalled();
  for (const v of vids) {
    const kind = ['direct', 'hls', 'dash', 'blob'].includes(v.kind) ? v.kind : 'direct';
    const size = v.width && v.height ? `${v.width}×${v.height}` : '';
    let name, meta, action;
    if (kind === 'blob') {
      name = 'Sayfa içi akış videosu';
      meta = 'Akış videosu: yukarıdaki butonu kullanın';
      action = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: true, title: 'Akış videosu: yukarıdaki butonu kullanın' }, icon('download'), 'İndir');
    } else {
      name = fileNameFromUrl(v.src);
      meta = [size, hostOf(v.src)].filter(Boolean).join(' · ');
      if (kind === 'direct') {
        action = h('button', { class: 'btn btn-soft btn-sm', type: 'button', title: 'Tarayıcı ile indir' }, icon('download'), h('span', { text: 'İndir' }));
        action.addEventListener('click', () => directDownload(action, v.src));
      } else {
        action = h('button', {
          class: 'btn btn-soft btn-sm', type: 'button', disabled: needHelper,
          title: needHelper ? 'Yardımcı uygulama gerekli' : 'yt-dlp ile indir',
        }, h('span', { text: 'yt-dlp ile indir' }));
        action.addEventListener('click', () => startVideoDownload(action, v.src, state.title));
      }
    }
    box.append(h('div', { class: 'source' },
      h('span', { class: `kind ${kind}`, text: kind === 'direct' ? directExt(v) : KIND_LABEL[kind] }),
      h('div', { class: 'source-body' },
        h('div', { class: 'source-name', title: v.src || name, text: name }),
        meta ? h('div', { class: 'source-meta', text: meta }) : null),
      action));
  }
}

async function directDownload(btn, url) {
  btnLoading(btn, true);
  const res = await send(MSG.DIRECT_DOWNLOAD, { url });
  btnLoading(btn, false);
  if (res.ok) { btnSuccess(btn, 'Başladı'); toast('İndirme başladı', 'success'); }
  else toast(errText(res, 'İndirme başlatılamadı.'), 'error');
}

/* =========================================================================
 * Thumbnail tab (YouTube)
 * ====================================================================== */

function buildThumbPanel(p) {
  const t = state.thumb;
  els.thumbImg = h('img', { src: hqThumb(), alt: 'Küçük resim önizlemesi', decoding: 'async' });
  els.thumbSpin = h('div', { class: 'thumb-spinner' }, spinner('lg'));
  els.thumbLabel = h('span', { class: 'thumb-label', hidden: true });
  els.thumbFrame = h('div', { class: 'thumb-frame' }, els.thumbImg, els.thumbSpin, els.thumbLabel);
  els.thumbErr = h('div');
  els.thumbDl = h('button', { class: 'btn btn-primary btn-lg grow', type: 'button' }, icon('download'), h('span', { text: 'Küçük Resmi İndir' }));
  els.thumbCp = h('button', { class: 'btn btn-secondary btn-lg', type: 'button', title: 'Görsel bağlantısını kopyala' }, icon('copy'), h('span', { text: 'Kopyala' }));
  els.thumbDl.addEventListener('click', downloadThumb);
  els.thumbCp.addEventListener('click', async () => {
    if (!t.data || !t.data.url) return;
    if (await copyText(t.data.url)) { btnSuccess(els.thumbCp, 'Kopyalandı', 1300); }
    else toast('Bağlantı kopyalanamadı', 'error');
  });
  p.append(
    els.thumbFrame,
    els.thumbErr,
    h('div', { class: 'row between' },
      h('span', { class: 'field-label', text: 'Dosya biçimi' }),
      segmented([{ value: 'jpg', label: 'JPG' }, { value: 'webp', label: 'WebP' }], t.format,
        (v) => { if (v !== t.format) { t.format = v; probeThumb(); } }, { label: 'Dosya biçimi', compact: true })),
    h('div', { class: 'row sticky-bottom' }, els.thumbDl, els.thumbCp));
  probeThumb();
}

function updateThumb() {
  const t = state.thumb;
  if (!els.thumbFrame) return;
  els.thumbFrame.classList.toggle('loading', t.loading);
  els.thumbSpin.hidden = !t.loading;
  if (t.data && t.data.url && els.thumbImg.getAttribute('src') !== t.data.url) els.thumbImg.src = t.data.url;
  const showLabel = !t.loading && t.data;
  els.thumbLabel.hidden = !showLabel;
  if (showLabel) {
    const dims = t.data.width && t.data.height ? `${t.data.width}×${t.data.height}` : '';
    els.thumbLabel.textContent = [dims, t.data.name].filter(Boolean).join(' · ') || 'Küçük resim';
  }
  els.thumbErr.replaceChildren();
  if (t.error && !t.loading) {
    const retry = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: probeThumb }, 'Tekrar dene');
    els.thumbErr.append(h('div', { class: 'inline-error' }, icon('alert'), h('span', { text: t.error }), retry));
  }
  els.thumbDl.disabled = t.loading;
  els.thumbCp.disabled = t.loading || !t.data;
}

async function probeThumb() {
  const t = state.thumb;
  const token = ++t.token;
  t.loading = true; t.error = null;
  updateThumb();
  const res = await send(MSG.THUMB_PROBE, { videoId: state.videoId, format: t.format });
  if (token !== t.token) return;
  t.loading = false;
  if (res.ok && res.url) t.data = res;
  else { t.data = null; t.error = errText(res, 'Küçük resim bulunamadı.'); els.thumbImg.src = hqThumb(); }
  updateThumb();
}

async function downloadThumb() {
  const btn = els.thumbDl;
  btnLoading(btn, true);
  const res = await send(MSG.THUMB_DOWNLOAD, { videoId: state.videoId, format: state.thumb.format, title: state.title });
  btnLoading(btn, false);
  if (res.ok) { btnSuccess(btn, 'İndirildi'); toast('Küçük resim indiriliyor', 'success'); }
  else toast(errText(res, 'Küçük resim indirilemedi.'), 'error');
  updateThumb();
}

/* =========================================================================
 * Page scan (shared by Video sources + Görseller)
 * ====================================================================== */

function ensureScan() {
  if (!state.scanPromise) {
    const p = runScan().then((r) => {
      // A rescan may have replaced this promise meanwhile: never let a stale result win.
      if (state.scanPromise === p) state.scan = r;
      return r;
    });
    state.scanPromise = p;
  }
  return state.scanPromise;
}
function rescan() {
  state.scanPromise = null; state.scan = null;
  state.img.selected.clear();
  renderSources(); renderImages();
  return ensureScan().then(() => { renderSources(); renderImages(); });
}

async function runScan() {
  const tabId = state.tab && state.tab.id;
  if (tabId == null) return { ok: false, error: 'Etkin sekme bulunamadı.', images: [], videos: [] };
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/scanner.js'] });
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (o) => (typeof window.__gokoScan === 'function' ? window.__gokoScan(o) : null),
      args: [{ minSize: 0 }], // filter client-side so "Tümü" works without re-scanning
    });
    const r = results && results[0] && results[0].result;
    if (!r || typeof r !== 'object') throw new Error('empty');
    return {
      ok: true,
      images: Array.isArray(r.images) ? r.images.filter((i) => i && (i.preview || i.src || i.currentSrc || i.bgImage)) : [],
      videos: Array.isArray(r.videos) ? r.videos.filter((v) => v && (v.src || v.kind === 'blob')) : [],
    };
  } catch {
    return { ok: false, error: 'Bu sayfanın içeriğine erişilemedi. Sayfayı yenileyip tekrar deneyin.', images: [], videos: [] };
  }
}

/* =========================================================================
 * Images tab
 * ====================================================================== */

const MIN_SIZES = [0, 100, 200, 400, 800];

function buildImagesPanel(p) {
  const im = state.img;
  const opts = MIN_SIZES.includes(im.minSize) ? MIN_SIZES : [...MIN_SIZES, im.minSize].sort((a, b) => a - b);
  els.minSel = h('select', { class: 'select', 'aria-label': 'En küçük görsel boyutu', title: 'En küçük görsel boyutu' },
    opts.map((v) => h('option', { value: String(v), text: v ? `${v}px` : 'Tümü' })));
  els.minSel.value = String(im.minSize);
  els.minSel.addEventListener('change', () => {
    im.minSize = Number(els.minSel.value) || 0;
    renderImages();
  });
  els.imgCount = h('span', { class: 'img-count', 'aria-live': 'polite' });
  els.selAll = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: toggleSelectAll }, 'Tümünü seç');
  els.grid = h('div', { class: 'grid', role: 'group', 'aria-label': 'Sayfadaki görseller' });
  els.imgDl = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onClick: downloadSelected });
  els.imgBar = h('div', { class: 'img-bar' }, els.imgDl);
  p.append(
    h('div', { class: 'img-toolbar' },
      els.imgCount, h('div', { class: 'spacer' }), els.minSel, els.selAll,
      h('button', { class: 'icon-btn sm', type: 'button', title: 'Yeniden tara', 'aria-label': 'Sayfayı yeniden tara', onClick: () => rescan() }, icon('refresh'))),
    els.grid, els.imgBar);
  renderImages();
  ensureScan().then(renderImages);
}

function sizeOk(img) {
  const min = state.img.minSize;
  if (!min) return true;
  const w = Number(img.width) || 0, hgt = Number(img.height) || 0;
  if (!w || !hgt) return true; // unknown size → keep
  return Math.min(w, hgt) >= min;
}
const visibleIdx = () => (state.scan && state.scan.ok ? state.scan.images.map((img, i) => (sizeOk(img) ? i : -1)).filter((i) => i >= 0) : []);

function renderImages() {
  if (!els.grid) return;
  const grid = els.grid;
  grid.replaceChildren();
  if (!state.scan) {
    grid.append(...Array.from({ length: 9 }, () => h('div', { class: 'skeleton', 'aria-hidden': 'true' })));
    els.imgCount.textContent = 'Taranıyor…';
    els.imgBar.hidden = true; els.selAll.hidden = true;
    return;
  }
  if (!state.scan.ok) {
    grid.append(h('div', { style: 'grid-column:1/-1' }, emptyState('alert', 'Sayfa taranamadı', state.scan.error, {
      action: h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => rescan() }, icon('refresh'), 'Tekrar dene'),
    })));
    els.imgCount.textContent = '0 görsel';
    els.imgBar.hidden = true; els.selAll.hidden = true;
    return;
  }
  const vis = visibleIdx();
  const visSet = new Set(vis);
  for (const i of [...state.img.selected]) if (!visSet.has(i)) state.img.selected.delete(i);
  if (!vis.length) {
    const total = state.scan.images.length;
    grid.append(h('div', { style: 'grid-column:1/-1' }, total
      ? emptyState('image', 'Bu boyutta görsel yok', `${total} görsel daha küçük. Boyut filtresini düşürün.`)
      : emptyState('image', 'Görsel bulunamadı', 'Bu sayfada indirilebilir görsel bulunamadı. Sayfayı aşağı kaydırıp yeniden tarayabilirsiniz.')));
  } else {
    for (const i of vis) grid.append(imageCell(i));
  }
  els.imgBar.hidden = !vis.length;
  els.selAll.hidden = !vis.length;
  updateImagesToolbar();
}

function imageCell(i) {
  const info = state.scan.images[i];
  const sel = state.img.selected.has(i);
  const preview = info.preview || info.currentSrc || info.src || info.bgImage;
  const w = Number(info.width) || 0, hgt = Number(info.height) || 0;
  const name = info.alt || fileNameFromUrl(info.src || preview);
  const cell = h('div', { class: `cell${sel ? ' selected' : ''}` });
  const img = h('img', { src: preview, alt: '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => cell.classList.add('is-broken'), { once: true });
  const hit = h('div', {
    class: 'cell-hit', role: 'checkbox', tabindex: '0', 'aria-checked': String(sel),
    'aria-label': name, title: [name, w && hgt ? `${w}×${hgt}` : ''].filter(Boolean).join(' · '),
  }, img, h('span', { class: 'broken' }, icon('image')),
  w && hgt ? h('span', { class: 'badge', text: `${w}×${hgt}` }) : null,
  h('span', { class: 'check' }, icon('check')));
  const toggle = () => {
    const on = !state.img.selected.has(i);
    if (on) state.img.selected.add(i); else state.img.selected.delete(i);
    cell.classList.toggle('selected', on);
    hit.setAttribute('aria-checked', String(on));
    updateImagesToolbar();
  };
  hit.addEventListener('click', toggle);
  hit.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
  });
  const dl = h('button', { class: 'cell-dl', type: 'button', title: 'Bu görseli indir', 'aria-label': `İndir: ${name}` }, icon('download'));
  dl.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (dl.classList.contains('busy')) return;
    dl.classList.add('busy'); dl.replaceChildren(spinner());
    const res = await send(MSG.IMAGE_DOWNLOAD, { info });
    dl.classList.remove('busy');
    if (res.ok) {
      dl.classList.add('done'); dl.replaceChildren(icon('check'));
      setTimeout(() => { dl.classList.remove('done'); dl.replaceChildren(icon('download')); }, 1800);
      toast('Görsel indiriliyor', 'success');
    } else {
      dl.replaceChildren(icon('download'));
      toast(errText(res, 'Görsel indirilemedi.'), 'error');
    }
  });
  cell.append(hit, dl);
  return cell;
}

function updateImagesToolbar() {
  if (!els.imgCount || !state.scan || !state.scan.ok) return;
  const vis = visibleIdx();
  const total = state.scan.images.length;
  const hidden = total - vis.length;
  els.imgCount.replaceChildren(...[`${vis.length} görsel`, hidden > 0 ? h('small', { text: ` · ${hidden} gizli` }) : null].filter(Boolean));
  const n = state.img.selected.size;
  const allSel = vis.length > 0 && n >= vis.length;
  els.selAll.textContent = allSel ? 'Seçimi kaldır' : 'Tümünü seç';
  if (!els.imgDl.classList.contains('is-loading') && !els.imgDl.classList.contains('is-success')) {
    els.imgDl.replaceChildren(icon('download'), h('span', { text: `Seçilenleri indir (${n})` }));
    els.imgDl.disabled = n === 0;
  }
}

function toggleSelectAll() {
  const vis = visibleIdx();
  const allSel = vis.length > 0 && state.img.selected.size >= vis.length;
  state.img.selected = allSel ? new Set() : new Set(vis);
  for (const cell of els.grid.querySelectorAll('.cell')) {
    cell.classList.toggle('selected', !allSel);
    const hit = cell.querySelector('.cell-hit');
    if (hit) hit.setAttribute('aria-checked', String(!allSel));
  }
  updateImagesToolbar();
}

async function downloadSelected() {
  const idx = [...state.img.selected].sort((a, b) => a - b);
  if (!idx.length || !state.scan) return;
  const btn = els.imgDl;
  btnLoading(btn, true, `${idx.length} görsel indiriliyor…`);
  const res = await send(MSG.IMAGES_DOWNLOAD, { items: idx.map((i) => ({ info: state.scan.images[i] })) });
  btn._html = null; // toolbar re-renders the label itself
  btnLoading(btn, false);
  const failed = Array.isArray(res.failed) ? res.failed.length : Number(res.failed) || 0;
  const count = Number.isFinite(Number(res.count)) ? Number(res.count) : (res.ok ? idx.length - failed : 0);
  if (res.ok && count > 0) {
    toast(failed ? `${count} görsel indirildi · ${failed} başarısız` : `${count} görsel indirildi`, failed ? 'info' : 'success');
    state.img.selected.clear();
    for (const cell of els.grid.querySelectorAll('.cell.selected')) {
      cell.classList.remove('selected');
      const hit = cell.querySelector('.cell-hit');
      if (hit) hit.setAttribute('aria-checked', 'false');
    }
    updateImagesToolbar();
    btnSuccess(btn, `${count} görsel indirildi`);
    btn._html = null;
    setTimeout(updateImagesToolbar, 1750);
  } else {
    updateImagesToolbar();
    toast(res.ok ? `Görseller indirilemedi (${failed} başarısız)` : errText(res, 'Görseller indirilemedi.'), 'error');
  }
}

/* =========================================================================
 * Downloads panel
 * ====================================================================== */

const ACTIVE = new Set(['queued', 'downloading', 'processing']);

function buildDownloads() {
  const root = $('#dl');
  root.dataset.open = 'false';
  els.dlBadge = h('span', { class: 'dl-badge', hidden: true });
  els.dlSummary = h('span', { class: 'dl-summary' });
  els.dlToggle = h('button', {
    class: 'dl-head', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'dl-body',
    onClick: () => setDlOpen(!state.dlOpen),
  }, icon('download'), h('span', { text: 'İndirmeler' }), els.dlBadge, els.dlSummary, icon('chevron', 'dl-chevron'));
  els.dlList = h('ul', { class: 'dl-list' });
  els.dlEmpty = h('div', { class: 'dl-empty', text: 'Henüz video indirmesi yok. Başlattığınız indirmeler burada görünür.' });
  const clearBtn = h('button', { class: 'link-btn', type: 'button' }, icon('x'), 'Bitenleri temizle');
  clearBtn.addEventListener('click', clearFinished);
  const folderBtn = h('button', { class: 'link-btn', type: 'button' }, icon('folder'), 'İndirme klasörünü aç');
  folderBtn.addEventListener('click', () => openFolder());
  els.dlClear = clearBtn;
  els.dlBody = h('div', { class: 'dl-body', id: 'dl-body' },
    h('div', { class: 'dl-inner' }, els.dlList, els.dlEmpty, h('div', { class: 'dl-foot' }, clearBtn, folderBtn)));
  els.dlBody.inert = true;
  root.append(els.dlToggle, els.dlBody);
}

function setDlOpen(open) {
  state.dlOpen = !!open;
  const root = $('#dl');
  root.dataset.open = String(state.dlOpen);
  els.dlToggle.setAttribute('aria-expanded', String(state.dlOpen));
  els.dlBody.inert = !state.dlOpen;
}

function setDownloads(list, fromEvent = false) {
  const items = Array.isArray(list) ? list.filter((x) => x && x.id != null) : [];
  let newActive = false;
  for (const it of items) {
    if (!state.dlKnown.has(it.id)) {
      state.dlKnown.add(it.id);
      if (fromEvent && ACTIVE.has(it.status)) newActive = true;
    }
  }
  state.downloads = items;
  renderDownloads();
  if (newActive) setDlOpen(true);
}

function renderDownloads() {
  if (!els.dlList) return;
  const items = state.downloads;
  const seen = new Set();
  items.forEach((it, idx) => {
    let li = els.dlRows.get(it.id);
    if (!li) { li = createRow(); els.dlRows.set(it.id, li); }
    updateRow(li, it);
    if (els.dlList.children[idx] !== li) els.dlList.insertBefore(li, els.dlList.children[idx] || null);
    seen.add(it.id);
  });
  for (const [id, li] of els.dlRows) if (!seen.has(id)) { li.remove(); els.dlRows.delete(id); }
  els.dlEmpty.hidden = items.length > 0;
  els.dlList.hidden = items.length === 0;
  const active = items.filter((i) => ACTIVE.has(i.status));
  els.dlBadge.hidden = active.length === 0;
  els.dlBadge.textContent = String(active.length);
  els.dlClear.disabled = !items.some((i) => !ACTIVE.has(i.status));
  let summary = '';
  if (active.length === 1 && active[0].status === 'downloading' && active[0].percent > 0) summary = `%${Math.floor(active[0].percent)}`;
  else if (active.length) summary = `${active.length} etkin`;
  else if (items.length) summary = `${items.length} öğe`;
  els.dlSummary.textContent = summary;
}

function createRow() {
  const r = {};
  r.ico = h('span', { class: 'dl-ico' });
  r.title = h('span', { class: 'dl-title' });
  r.chip = h('span', { class: 'chip-sm' });
  r.cancel = h('button', { class: 'dl-x', type: 'button', title: 'İptal et', 'aria-label': 'İndirmeyi iptal et' }, icon('x'));
  r.bar = h('div', { class: 'bar' });
  r.progress = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, r.bar);
  r.meta = h('span', { class: 'dl-meta' });
  r.actions = h('div', { class: 'dl-actions' });
  const li = h('li', { class: 'dl-item' },
    h('div', { class: 'dl-row' }, r.ico, r.title, r.chip, r.cancel),
    r.progress,
    h('div', { class: 'dl-meta-row' }, r.meta, r.actions));
  r.cancel.addEventListener('click', async () => {
    const it = li._item;
    if (!it) return;
    r.cancel.disabled = true;
    const res = await send(MSG.VIDEO_CANCEL, { id: it.id });
    r.cancel.disabled = false;
    if (!res.ok) toast(errText(res, 'İptal edilemedi.'), 'error');
  });
  li._r = r;
  return li;
}

function updateRow(li, it) {
  const r = li._r;
  const prev = li._item;
  li._item = it;
  li.dataset.status = it.status || 'queued';
  const mode = it.mode === 'audio' ? 'audio' : 'video';
  if (!prev || prev.mode !== it.mode) r.ico.replaceChildren(icon(mode === 'audio' ? 'music' : 'video'));
  const title = it.title || fileNameFromUrl(it.url) || 'İndirme';
  r.title.textContent = title;
  r.title.title = [title, it.url].filter(Boolean).join('\n');
  r.chip.textContent = mode === 'audio' ? String(it.audioFormat || 'mp3').toUpperCase() : qualityLabel(it.quality);

  const active = ACTIVE.has(it.status);
  r.cancel.hidden = !active;
  const pct = Number(it.percent);
  const known = Number.isFinite(pct) && pct > 0;
  const indeterminate = it.status === 'processing' || (it.status === 'downloading' && !known) || it.status === 'queued';
  r.progress.hidden = !active;
  r.progress.classList.toggle('indeterminate', indeterminate);
  r.bar.style.width = indeterminate ? '' : `${Math.max(0, Math.min(100, pct))}%`;
  if (indeterminate) r.progress.removeAttribute('aria-valuenow'); else r.progress.setAttribute('aria-valuenow', String(Math.round(pct)));

  let meta = '';
  r.meta.title = '';
  switch (it.status) {
    case 'queued': meta = 'Sırada bekliyor…'; break;
    case 'downloading':
      meta = known
        ? [`%${Math.floor(pct)}`, fmtSpeed(it.speed), it.eta != null && fmtEta(it.eta) ? `${fmtEta(it.eta)} kaldı` : ''].filter(Boolean).join(' · ')
        : 'İndiriliyor…';
      break;
    case 'processing': meta = 'İşleniyor… (birleştirme / dönüştürme)'; break;
    case 'done': meta = 'Tamamlandı'; r.meta.title = it.filepath || ''; break;
    case 'error': meta = it.error || 'Hata oluştu'; r.meta.title = it.error || ''; break;
    case 'cancelled': meta = 'İptal edildi'; break;
    default: meta = '';
  }
  r.meta.textContent = meta;

  const actKey = `${it.status}|${it.filepath || ''}`;
  if (li._actKey !== actKey) {
    li._actKey = actKey;
    r.actions.replaceChildren();
    if (it.status === 'done') {
      const b = h('button', { class: 'link-btn', type: 'button', title: it.filepath || '' }, icon('folder'), 'Klasörde göster');
      b.addEventListener('click', () => openFolder(it.filepath || undefined));
      r.actions.append(b);
    } else if (it.status === 'error' || it.status === 'cancelled') {
      const b = h('button', { class: 'link-btn', type: 'button' }, icon('refresh'), 'Tekrar dene');
      b.addEventListener('click', () => retryDownload(li._item, b));
      r.actions.append(b);
    }
  }
}

async function retryDownload(it, btn) {
  if (!it || !it.url) return;
  btn.disabled = true;
  const res = await send(MSG.VIDEO_DOWNLOAD, {
    url: it.url, title: it.title || undefined, mode: it.mode, quality: it.quality, audioFormat: it.audioFormat, source: it.source || 'popup',
  });
  btn.disabled = false;
  if (res.ok) toast('Yeniden kuyruğa eklendi', 'success');
  else toast(errText(res, 'İndirme başlatılamadı.'), 'error');
}

async function clearFinished() {
  const res = await send(MSG.CLEAR_FINISHED);
  if (res.ok) setDownloads(state.downloads.filter((i) => ACTIVE.has(i.status)));
  else toast(errText(res, 'Temizlenemedi.'), 'error');
}

async function openFolder(path) {
  const res = await send(MSG.OPEN_FOLDER, path ? { path } : {});
  if (res.ok) return;
  if (!path) {
    // Fallback: Chrome's own download folder (images / thumbnails land there).
    try { chrome.downloads.showDefaultFolder(); return; } catch { /* ignore */ }
  }
  toast(isNotInstalled(res) ? 'Klasörü açmak için yardımcı uygulama gerekli' : errText(res, 'Klasör açılamadı.'), 'error');
}

/* =========================================================================
 * Init
 * ====================================================================== */

async function loadSettings() {
  try { return await getSettings(); } catch { return { ...DEFAULT_SETTINGS }; }
}

async function loadState() {
  const res = await send(MSG.GET_STATE);
  if (res && (res.helper || Array.isArray(res.downloads))) return { helper: res.helper || null, downloads: res.downloads || [] };
  // Fallback: read session storage directly (popup is a trusted context).
  try {
    const s = await chrome.storage.session.get([KEYS.HELPER, KEYS.DOWNLOADS]);
    return { helper: s[KEYS.HELPER] || null, downloads: s[KEYS.DOWNLOADS] || [] };
  } catch { return { helper: null, downloads: [] }; }
}

function wireHeader() {
  $('#settingsBtn')?.addEventListener('click', () => {
    try { chrome.runtime.openOptionsPage(); } catch { toast('Ayarlar açılamadı', 'error'); }
  });
  const status = $('#helperStatus');
  status?.addEventListener('click', () => recheckHelper(null));
}

function listenStorage() {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'session') return;
      if (changes[KEYS.DOWNLOADS]) setDownloads(changes[KEYS.DOWNLOADS].newValue || [], true);
      if (changes[KEYS.HELPER]) setHelper(changes[KEYS.HELPER].newValue || null);
    });
  } catch { /* storage API unavailable */ }
}

async function init() {
  wireHeader();
  buildDownloads();

  const [tab, settings, fileAccess, st] = await Promise.all([getActiveTab(), loadSettings(), hasFileAccess(), loadState()]);
  state.tab = tab;
  state.url = (tab && (tab.url || tab.pendingUrl)) || '';
  state.settings = settings;
  state.video.quality = QUALITIES.some((q) => q.value === settings.videoQuality) ? settings.videoQuality : 'best';
  state.video.audioFormat = settings.audioFormat === 'm4a' ? 'm4a' : 'mp3';
  state.thumb.format = settings.thumbFormat === 'webp' ? 'webp' : 'jpg';
  state.img.minSize = Math.max(0, Number(settings.minImageSize) || 0);

  const [ctx, reason] = classify(state.url, fileAccess);
  state.ctx = ctx;
  state.restrictReason = reason;
  if (ctx === 'youtube') {
    try { state.videoId = extractVideoId(state.url); } catch { state.videoId = null; }
    state.title = cleanYouTubeTitle(tab && tab.title);
  } else {
    state.title = (tab && tab.title) || '';
  }

  setHelper(st.helper);
  for (const it of Array.isArray(st.downloads) ? st.downloads : []) if (it && it.id != null) state.dlKnown.add(it.id);
  setDownloads(st.downloads);
  if (state.downloads.some((i) => ACTIVE.has(i.status))) setDlOpen(true);
  listenStorage();

  renderContext();
  if (ctx === 'restricted') {
    renderRestricted();
  } else {
    const ids = ctx === 'youtube' ? ['video', 'thumb', 'images'] : ctx === 'web' ? ['video', 'images'] : ['images'];
    renderTabs(ids);
    switchTab(ids[0]);
  }

  // Helper state not determined yet → ask the background to check (non-blocking).
  if (!state.helper || !state.helper.checked) {
    send(MSG.HELPER_PING).then((res) => {
      if (res && res.helper) setHelper(res.helper);
      else if (!state.helper || !state.helper.checked) {
        setHelper({ ...(state.helper || {}), connected: false, checked: true, error: (res && res.error) || null });
      }
    });
  }
}

init().catch((e) => {
  console.error('[Goko] popup init failed', e);
  try {
    $('#main').replaceChildren(h('div', { class: 'panel' },
      emptyState('alert', 'Bir şeyler ters gitti', 'Eklenti penceresi yüklenemedi. Pencereyi kapatıp yeniden açın.', { big: true })));
  } catch { /* nothing else to do */ }
});
