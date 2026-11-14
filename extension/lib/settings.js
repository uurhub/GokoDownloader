import { KEYS } from './messages.js';

export const DEFAULT_SETTINGS = Object.freeze({
  outDir: '',
  subfolder: 'GokoDownloader',
  videoQuality: 'best',
  audioFormat: 'mp3',
  filenameTemplate: '%(title)s [%(id)s].%(ext)s',
  thumbFormat: 'jpg',
  notify: true,
  minImageSize: 200,
  pageButton: true,
});

export async function getSettings() {
  const stored = (await chrome.storage.sync.get(KEYS.SETTINGS))[KEYS.SETTINGS] || {};
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.sync.set({ [KEYS.SETTINGS]: next });
  return next;
}
