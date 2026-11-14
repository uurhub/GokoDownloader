// Image URL resolver (pure, no DOM / chrome APIs).
// parseSrcset(srcset), upgradeUrl(url), buildCandidates(info)

const MAX_CANDIDATES = 12;

export function parseSrcset(srcset) {
  const out = [];
  if (typeof srcset !== 'string') return out;
  const s = srcset;
  let i = 0;
  const n = s.length;
  const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
  while (i < n) {
    while (i < n && (isWs(s[i]) || s[i] === ',')) i++;
    if (i >= n) break;
    let start = i;
    while (i < n && !isWs(s[i])) i++;
    let url = s.slice(start, i);
    let desc = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      let paren = 0;
      const ds = i;
      while (i < n) {
        const c = s[i];
        if (c === '(') paren++;
        else if (c === ')') paren = Math.max(0, paren - 1);
        else if (c === ',' && paren === 0) break;
        i++;
      }
      desc = s.slice(ds, i).trim();
    }
    if (!url) continue;
    const e = { url, w: 0, x: 0 };
    const tokens = desc.split(/\s+/).filter(Boolean);
    for (const t of tokens) {
      let m;
      if ((m = /^(\d+(?:\.\d+)?)w$/i.exec(t))) e.w = parseFloat(m[1]);
      else if ((m = /^(\d+(?:\.\d+)?)x$/i.exec(t))) e.x = parseFloat(m[1]);
    }
    out.push(e);
  }
  return out;
}

const SIGNED_RE = /[?&](?:oh|oe|sig|signature|x-amz-[a-z-]+|x-goog-signature|token|hdnts)=/i;
const SKIP_HOST_RE = /(^|\.)(fbcdn\.net|cdninstagram\.com|instagram\.com|facebook\.com|redditmedia\.com|yandex\.[a-z]+|yandex\.net)$/i;

function tryUrl(u) {
  try { return new URL(u); } catch { return null; }
}

const GENERIC_PARAMS = ['w', 'width', 'h', 'height', 'size', 'resize', 'fit', 'q', 'quality', 'dpr', 'crop', 'auto'];

function stripParams(u, names) {
  const c = new URL(u.href);
  let changed = false;
  for (const k of [...c.searchParams.keys()]) {
    if (names.includes(k.toLowerCase())) { c.searchParams.delete(k); changed = true; }
  }
  return changed ? c : null;
}

function fmt(u) {
  let s = u.toString();
  return s.endsWith('?') ? s.slice(0, -1) : s;
}

function rules(u) {
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  const res = [];
  const add = (x) => { if (x) res.push(typeof x === 'string' ? x : fmt(x)); };
  const withPath = (p, keepSearch = true) => {
    const c = new URL(u.href);
    c.pathname = p;
    if (!keepSearch) c.search = '';
    return c;
  };

  // Twitter / X
  if (host === 'pbs.twimg.com') {
    const m = /^(.*\.(?:jpe?g|png|gif|webp)):[a-z0-9]+$/i.exec(path);
    if (m) {
      add(withPath(m[1] + ':orig'));
    } else if (path.startsWith('/media/') || /\.(?:jpe?g|png|gif|webp)$/i.test(path)) {
      const c = new URL(u.href);
      c.searchParams.set('name', 'orig');
      add(c);
    }
    return { handled: true, res };
  }

  // Wikimedia thumbs
  // (upload.wikimedia.org, and thumb.wikimedia.org which serves thumbs with utm_* query params)
  if (host === 'upload.wikimedia.org' || host === 'thumb.wikimedia.org') {
    const m = /^(\/wikipedia\/[^/]+)\/thumb\/([0-9a-f]\/[0-9a-f]{2}\/[^/]+)\/[^/]+$/.exec(path);
    if (m) add(`https://upload.wikimedia.org${m[1]}/${m[2]}`);
    return { handled: true, res };
  }

  // Google user content
  if (/(^|\.)googleusercontent\.com$/.test(host) || /(^|\.)ggpht\.com$/.test(host) || host === 'lh3.google.com') {
    if (/=(?:[whs]\d+)[^/=]*$/.test(path)) {
      add(withPath(path.replace(/=(?:[whs]\d+)[^/=]*$/, '=s0')));
    } else if (/\/(?:[swh]\d+)(?:-[A-Za-z0-9]+)*\//.test(path) && !/\/s0\//.test(path)) {
      add(withPath(path.replace(/\/(?:[swh]\d+)(?:-[A-Za-z0-9]+)*\//, '/s0/')));
    }
    return { handled: true, res };
  }

  // YouTube thumbnails
  if (host === 'i.ytimg.com' || host === 'img.youtube.com' || /^i\d*\.ytimg\.com$/.test(host)) {
    const m = /^\/(vi|vi_webp)\/([^/]+)\/([^/.]+)\.(jpg|webp)$/.exec(path);
    if (m) {
      const [, dir, id, name, ext] = m;
      const base = `${u.origin}/${dir}/${id}/`;
      const cur = fmt(withPath(path, false));
      for (const n of ['maxresdefault', 'sddefault', 'hqdefault']) {
        const cand = `${base}${n}.${ext}`;
        if (cand === u.href) continue;
        if (name === 'maxresdefault' && n !== 'maxresdefault') continue;
        res.push(cand);
      }
      void cur;
    }
    return { handled: true, res };
  }

  // Pinterest
  if (host === 'i.pinimg.com') {
    const m = /^\/(\d+x(?:\d+)?(?:_[A-Za-z0-9]+)?)\/(.+)\.([A-Za-z0-9]+)$/.exec(path);
    if (m) {
      const ext = m[3];
      const p = `/originals/${m[2]}`;
      add(withPath(`${p}.${ext}`, false));
      if (/^jpe?g$/i.test(ext)) add(withPath(`${p}.png`, false));
    }
    return { handled: true, res };
  }

  // Shopify
  if (host === 'cdn.shopify.com' || /\/cdn\/shop\//.test(path)) {
    const c = new URL(u.href);
    let changed = false;
    const re = /(_(?:\d+x\d*|x\d+|pico|icon|thumb|small|compact|medium|large|grande|master)(?:_crop_[a-z]+)?)?(@\d+x)?(\.[A-Za-z0-9]+)$/;
    const fm = re.exec(c.pathname);
    if (fm && (fm[1] || fm[2])) {
      c.pathname = c.pathname.replace(re, '$3');
      changed = true;
    }
    for (const k of ['width', 'height', 'crop']) {
      if (c.searchParams.has(k)) { c.searchParams.delete(k); changed = true; }
    }
    if (changed) add(c);
    return { handled: true, res };
  }

  // WordPress
  if (/\/wp-content\//.test(path)) {
    const m = /^(.*)-\d+x\d+(\.(?:jpe?g|png|gif|webp|avif))$/i.exec(path);
    if (m) {
      add(withPath(m[1] + m[2]));
      const sm = /^(.*)-scaled$/.exec(m[1]);
      if (sm) add(withPath(sm[1] + m[2]));
      return { handled: true, res };
    }
    const sm = /^(.*)-scaled(\.(?:jpe?g|png|gif|webp|avif))$/i.exec(path);
    if (sm) {
      add(withPath(sm[1] + sm[2]));
      return { handled: true, res };
    }
  }

  // Wikia / Fandom
  if (host === 'static.wikia.nocookie.net') {
    const re = /\/revision\/latest\/(?:scale-to-width-down|scale-to-height-down|smart|zoom-crop|top-crop|thumbnail|window-crop|fixed-aspect-ratio)(?:\/.*)?$/;
    if (re.test(path)) add(withPath(path.replace(re, '/revision/latest')));
    return { handled: true, res };
  }

  // Imgur
  if (host === 'i.imgur.com') {
    const m = /^\/([A-Za-z0-9]{7})[sbtmlh](\.[A-Za-z0-9]+)$/.exec(path);
    if (m) add(withPath(`/${m[1]}${m[2]}`, false));
    return { handled: true, res };
  }

  // Reddit previews
  if (host === 'preview.redd.it' || host === 'external-preview.redd.it') {
    const m = /^\/([^/]+\.[A-Za-z0-9]+)$/.exec(path);
    if (m) add(`https://i.redd.it/${m[1]}`);
    return { handled: true, res };
  }

  // Unsplash
  if (host === 'images.unsplash.com') {
    add(stripParams(u, ['w', 'h', 'q', 'fit', 'crop', 'dpr', 'auto', 'ixlib', 'cs', 'fm', 'ar', 'fp-x', 'fp-y', 'fp-z']));
    return { handled: true, res };
  }

  // Cloudinary
  if (/(^|\.)cloudinary\.com$/.test(host) || /\/(?:image|video)\/upload\//.test(path)) {
    const m = /^(.*?\/(?:image|video)\/upload\/)(.+)$/.exec(path);
    if (m) {
      const segs = m[2].split('/');
      const tkey = '(?:w|h|c|f|q|g|ar|dpr|e|t|x|y|z|r|a|b|l|o|fl|bo|co|dn|so|eo|pg|du|vc|ac|if|fn|u|bl|cs|d)';
      const tseg = new RegExp(`^${tkey}_[^,/]+(?:,${tkey}_[^,/]+)*$`);
      let i = 0;
      const vIdx = segs.findIndex((s) => /^v\d+$/.test(s));
      const limit = vIdx >= 0 ? vIdx : segs.length - 1;
      while (i < limit && tseg.test(segs[i])) i++;
      if (i > 0) add(withPath(m[1] + segs.slice(i).join('/')));
    }
    return { handled: true, res };
  }

  // Amazon
  if (/(^|\.)(media-amazon|images-amazon|ssl-images-amazon)\.com$/.test(host)) {
    const re = /\._[A-Za-z0-9,_-]+_\.(jpe?g|png|gif|webp)$/i;
    if (re.test(path)) add(withPath(path.replace(re, '.$1')));
    return { handled: true, res };
  }

  // Bing thumbnails
  if (host === 'th.bing.com' || /^tse\d*\.mm\.bing\.net$/.test(host)) {
    add(stripParams(u, ['w', 'h', 'c', 'rs', 'qlt', 'dpr', 'o', 'pid', 'r']));
    return { handled: true, res };
  }

  return { handled: false, res };
}

export function upgradeUrl(url) {
  const u = typeof url === 'string' ? tryUrl(url) : null;
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) return [];
  if (SKIP_HOST_RE.test(u.hostname)) return [];
  let res;
  try {
    const r = rules(u);
    res = r.res;
    if (!r.handled && !SIGNED_RE.test(u.search)) {
      const c = stripParams(u, GENERIC_PARAMS);
      if (c) res.push(fmt(c));
    }
  } catch {
    return [];
  }
  const seen = new Set([url]);
  return res.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
}

const HIGH_RES_ATTRS = ['data-full', 'data-orig-file', 'data-large-file', 'data-hi-res', 'data-zoom-image', 'data-large', 'data-original'];
const LAZY_ATTRS = ['data-src', 'data-lazy-src'];
const IMG_EXT_RE = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg)$/i;

function absolutize(u) {
  if (typeof u !== 'string') return null;
  u = u.trim();
  if (!u) return null;
  if (u.startsWith('//')) u = 'https:' + u;
  if (/^data:/i.test(u)) return u;
  const p = tryUrl(u);
  if (!p || (p.protocol !== 'http:' && p.protocol !== 'https:')) return null;
  return p.href;
}

function srcsetBases(srcset) {
  const entries = parseSrcset(srcset || '');
  const score = (e) => (e.w || (e.x ? e.x * 1000 : 0));
  return entries.sort((a, b) => score(b) - score(a)).map((e) => e.url);
}

export function buildCandidates(info) {
  info = info || {};
  const bases = [];
  const da = info.dataAttrs || {};

  if (info.parentHref) {
    const p = tryUrl(info.parentHref);
    if (p && IMG_EXT_RE.test(p.pathname)) bases.push(info.parentHref);
  }
  for (const k of HIGH_RES_ATTRS) if (da[k]) bases.push(da[k]);
  const ss = srcsetBases(info.srcset);
  for (const s of ss.slice(0, 3)) bases.push(s);
  for (const src of info.sources || []) {
    for (const s of srcsetBases(src && src.srcset).slice(0, 2)) bases.push(s);
  }
  bases.push(info.currentSrc, info.src);
  for (const k of LAZY_ATTRS) if (da[k]) bases.push(da[k]);
  bases.push(info.bgImage);

  const out = [];
  const seen = new Set();
  let dataFallback = null;
  const push = (u) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  for (const b of bases) {
    const abs = absolutize(b);
    if (!abs) continue;
    if (abs.startsWith('data:')) { if (!dataFallback) dataFallback = abs; continue; }
    for (const v of upgradeUrl(abs)) push(v);
    push(abs);
  }
  if (!out.length && dataFallback) out.push(dataFallback);
  return out.slice(0, MAX_CANDIDATES);
}
