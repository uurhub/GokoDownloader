// YouTube URL helpers (pure, ES module).
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

function parse(url) {
  if (typeof url !== 'string' || !url) return null;
  let s = url.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/\//, '');
  try { return new URL(s); } catch { return null; }
}

function hostKind(host) {
  host = host.toLowerCase();
  if (host === 'youtu.be' || host === 'www.youtu.be') return 'short';
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) return 'yt';
  if (host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) return 'nocookie';
  return null;
}

export function extractVideoId(url) {
  const u = parse(url);
  if (!u) return null;
  const kind = hostKind(u.hostname);
  if (!kind) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  let id = null;
  if (kind === 'short') {
    id = parts[0];
  } else if (kind === 'yt' && parts[0] === 'watch') {
    id = u.searchParams.get('v');
  } else if (['shorts', 'live', 'embed', 'v'].includes(parts[0]) && (kind === 'yt' || parts[0] === 'embed')) {
    id = parts[1];
  }
  return id && ID_RE.test(id) ? id : null;
}

export function isYouTubeVideoPage(url) {
  return extractVideoId(url) !== null;
}

export function canonicalWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

const SIZES = [
  { name: 'maxresdefault', width: 1280, height: 720 },
  { name: 'sddefault', width: 640, height: 480 },
  { name: 'hqdefault', width: 480, height: 360 },
  { name: 'mqdefault', width: 320, height: 180 },
];

export function thumbnailCandidates(videoId, format = 'jpg') {
  const build = (dir, ext) => SIZES.map((s) => ({
    url: `https://i.ytimg.com/${dir}/${videoId}/${s.name}.${ext}`,
    name: s.name, width: s.width, height: s.height,
  }));
  const jpg = build('vi', 'jpg');
  return format === 'webp' ? build('vi_webp', 'webp').concat(jpg) : jpg;
}
