// Shared message types and storage keys. See docs/CONTRACT.md.
// Content scripts cannot import modules; they inline the same string values.

export const NATIVE_HOST = 'com.goko.downloader';

export const MSG = Object.freeze({
  GET_STATE: 'GET_STATE',
  HELPER_PING: 'HELPER_PING',
  VIDEO_DOWNLOAD: 'VIDEO_DOWNLOAD',
  VIDEO_CANCEL: 'VIDEO_CANCEL',
  CLEAR_FINISHED: 'CLEAR_FINISHED',
  OPEN_FOLDER: 'OPEN_FOLDER',
  YTDLP_UPDATE: 'YTDLP_UPDATE',
  THUMB_DOWNLOAD: 'THUMB_DOWNLOAD',
  THUMB_PROBE: 'THUMB_PROBE',
  IMAGE_DOWNLOAD: 'IMAGE_DOWNLOAD',
  IMAGES_DOWNLOAD: 'IMAGES_DOWNLOAD',
  DIRECT_DOWNLOAD: 'DIRECT_DOWNLOAD',
});

export const KEYS = Object.freeze({
  HELPER: 'goko.helper',
  DOWNLOADS: 'goko.downloads',
  SETTINGS: 'goko.settings',
});

export const QUALITIES = Object.freeze([
  { value: 'best', label: 'En iyi' },
  { value: '2160', label: '2160p (4K)' },
  { value: '1440', label: '1440p (2K)' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
]);

/** Promise wrapper around chrome.runtime.sendMessage. */
export function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}
