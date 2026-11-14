# Goko Downloader — Interface Contract

Every component MUST follow this file. UI text is **Turkish only**. Vanilla JS, no build step, no npm deps.
Extension ID (fixed by `key` in manifest): `ckhglpifnfloifbggnfbgecaeiaacjbf`
Native host name: `com.goko.downloader`

## Files and owners
| Path | Kind | Notes |
|---|---|---|
| `extension/manifest.json` | done | do not change permissions without reason |
| `extension/lib/messages.js` | done (ES module) | message type constants `MSG`, storage keys `KEYS` |
| `extension/lib/settings.js` | done (ES module) | `DEFAULT_SETTINGS`, `getSettings()`, `saveSettings()` |
| `extension/lib/youtube.js` | ES module | `extractVideoId(url) -> string|null`, `isYouTubeVideoPage(url) -> bool`, `thumbnailCandidates(videoId, format='jpg') -> [{url, name, width, height}]` best→worst (maxresdefault 1280x720, sddefault 640x480, hqdefault 480x360, mqdefault 320x180; webp variant uses `https://i.ytimg.com/vi_webp/ID/NAME.webp`, jpg uses `https://i.ytimg.com/vi/ID/NAME.jpg`) |
| `extension/lib/imageResolver.js` | ES module, pure | `buildCandidates(info) -> string[]` best→worst, deduped, absolute URLs; `upgradeUrl(url) -> string[]` site rules only |
| `extension/content/scanner.js` | classic script, injected with `chrome.scripting.executeScript({files:['content/scanner.js']})` | defines `window.__gokoScan(opts)` and `window.__gokoImageInfo(srcUrl)`; idempotent (guard on `window.__gokoScan`) |
| `extension/content/youtube.js` + `.css` | classic content script (cannot import modules; inline what it needs) | page "İndir" button |
| `extension/background.js` | ES module service worker | hub |
| `extension/popup/*` | ES module page | UI |
| `extension/options/*` | ES module page | settings UI |
| `helper/host.py` | Python 3 stdlib only | native host |

## ImageInfo (produced by scanner.js, consumed by buildCandidates)
```js
{
  src: string,            // img.src (absolute)
  currentSrc: string,     // img.currentSrc
  srcset: string,         // img.srcset or data-srcset
  sources: [{srcset, type, media}], // <picture><source>
  dataAttrs: {            // any of: data-src, data-original, data-lazy-src, data-full, data-large, data-hi-res, data-zoom-image, data-orig-file, data-large-file
    "data-src": "...", ...
  },
  parentHref: string|null, // closest <a href> if it looks like an image file (jpg|jpeg|png|gif|webp|avif|bmp|svg) — else null
  bgImage: string|null,    // for elements with CSS background-image
  width: number, height: number,   // naturalWidth/naturalHeight (0 if unknown)
  alt: string
}
```
`window.__gokoScan({minSize})` returns:
```js
{ pageUrl, title,
  images: [ImageInfo & {preview: string /* url to show in grid */}],   // deduped by best candidate, includes <img>, <picture>, CSS bg images ≥ minSize, og:image meta
  videos: [{src, type, kind: 'direct'|'hls'|'dash'|'blob', width, height, poster}] } // from <video>, <source>, og:video meta
```
`window.__gokoImageInfo(srcUrl)` returns the ImageInfo for the element whose src/currentSrc/srcset/bg matches `srcUrl`, or `{src: srcUrl, ...empty}` if not found.

## Runtime messages (chrome.runtime.sendMessage → background, reply via sendResponse; all replies have `ok: boolean`, `error?: string` Turkish)
Constants are in `lib/messages.js` (`MSG.*`). Content scripts inline the same string values.
| type | payload | reply |
|---|---|---|
| `GET_STATE` | – | `{ok, helper: HelperState, downloads: DownloadItem[]}` |
| `HELPER_PING` | – | `{ok, helper: HelperState}` (forces reconnect + ping) |
| `VIDEO_DOWNLOAD` | `{url, title?, mode:'video'|'audio', quality?:'best'|'2160'|'1440'|'1080'|'720'|'480'|'360', audioFormat?:'mp3'|'m4a', source?:'popup'|'page'|'menu'}` (missing fields → settings defaults) | `{ok, id}` |
| `VIDEO_CANCEL` | `{id}` | `{ok}` |
| `CLEAR_FINISHED` | – | `{ok}` (removes done/error/cancelled items) |
| `OPEN_FOLDER` | `{path?}` (file path → opens its folder; empty → output dir) | `{ok}` |
| `YTDLP_UPDATE` | – | `{ok, output, version}` |
| `THUMB_DOWNLOAD` | `{videoId, format?:'jpg'|'webp', title?}` | `{ok, url, name}` (best available that returns HTTP 200 and is not the 120x90 placeholder) |
| `THUMB_PROBE` | `{videoId, format?}` | `{ok, url, name, width, height}` (no download) |
| `IMAGE_DOWNLOAD` | `{info?: ImageInfo, candidates?: string[], filenameHint?}` | `{ok, url}` |
| `IMAGES_DOWNLOAD` | `{items: [{info?, candidates?}]}` | `{ok, count, failed}` |
| `DIRECT_DOWNLOAD` | `{url, filename?}` | `{ok, downloadId}` |

## Session state (chrome.storage.session; background sets access level TRUSTED_AND_UNTRUSTED_CONTEXTS so content scripts can read)
- `KEYS.HELPER` = `goko.helper` → HelperState `{connected: bool, checked: bool, hostVersion, ytdlpVersion, ffmpegFound: bool, outDir, error: string|null}`
- `KEYS.DOWNLOADS` = `goko.downloads` → `DownloadItem[]` newest first, max 30 kept:
```js
{ id, url, title, mode, quality, audioFormat, source,
  status: 'queued'|'downloading'|'processing'|'done'|'error'|'cancelled',
  percent: number /*0-100*/, speed: number|null /*bytes/s*/, eta: number|null /*s*/,
  filepath: string|null, error: string|null, createdAt: number }
```
UI reacts via `chrome.storage.onChanged` (area `session`).

## Settings (chrome.storage.sync key `goko.settings`, see lib/settings.js)
`{ outDir:'' /*helper abs dir, ''=~/Downloads/GokoDownloader*/, subfolder:'GokoDownloader' /*chrome.downloads relative folder for images/thumbs*/, videoQuality:'best', audioFormat:'mp3', filenameTemplate:'%(title)s [%(id)s].%(ext)s', thumbFormat:'jpg', notify:true, minImageSize:200, pageButton:true, useCookies:true /*send browser cookies to helper for login-gated videos*/ }`

## Native messaging protocol (Chrome ⇄ helper/host.py), 4-byte little-endian length + UTF-8 JSON
Requests may carry `reqId`; non-download replies echo it.
| request | replies |
|---|---|
| `{cmd:'ping', reqId}` | `{type:'pong', reqId, ok:true, host_version, ytdlp_version, ffmpeg_found, out_dir, js_runtime}` (`js_runtime`: `'deno'`\|`'node'`\|`null`) |
| `{cmd:'download', id, url, mode, quality, audioFormat, outDir?, template?, cookies?}` (`cookies`: `chrome.cookies.Cookie[]`, sent when setting `useCookies`; helper first tries without them and retries once with a temp Netscape cookies.txt only if yt-dlp's error asks for `--cookies`, e.g. age-restricted videos; the file is deleted afterwards) | `{type:'started', id}` → many `{type:'progress', id, percent, downloaded, total, speed, eta}` → optional `{type:'status', id, status:'processing'}` (merge/convert) → `{type:'title', id, title}` (when known) → `{type:'done', id, filepath}` or `{type:'error', id, message}` |
| `{cmd:'cancel', id}` | `{type:'cancelled', id}` |
| `{cmd:'open_folder', path?, reqId}` | `{type:'ok', reqId}` |
| `{cmd:'update', reqId}` | `{type:'update_result', reqId, ok, output, ytdlp_version}` |
| unknown | `{type:'error', reqId, message}` |

Helper locates `yt-dlp.exe`, `ffmpeg.exe` next to the running executable (frozen) or in `helper/vendor/` (dev, when running host.py from source).
