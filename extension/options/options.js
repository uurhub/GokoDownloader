import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../lib/settings.js';
import { KEYS, MSG, QUALITIES, send } from '../lib/messages.js';

const $ = (id) => document.getElementById(id);

const TEXT_KEYS = ['outDir', 'subfolder', 'filenameTemplate'];
const SELECT_KEYS = ['videoQuality', 'audioFormat', 'thumbFormat'];
const BOOL_KEYS = ['notify', 'pageButton', 'useCookies'];
const MIN_SIZE_MAX = 10000;

const toastEl = $('toast');
let toastTimer = null;

function toast(text = 'Kaydedildi ✓', isError = false) {
  toastEl.textContent = text;
  toastEl.classList.toggle('error', isError);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

const NOT_INSTALLED_TEXT = "Yardımcı uygulama kurulu değil. GokoDownloaderSetup.exe'yi çalıştırın.";
const JS_RUNTIME_TEXT = { deno: 'Deno', node: 'Node.js' };
const helperErrorText = (e) => (e === 'not_installed' ? NOT_INSTALLED_TEXT : e);

function errorMessage(err) {
  return (err && err.message) || String(err) || 'Bilinmeyen hata';
}

// ---------- Settings ----------

function populateSelects() {
  const quality = $('videoQuality');
  quality.replaceChildren(...QUALITIES.map(({ value, label }) => new Option(label, value)));
}

function renderSettings(s) {
  for (const key of TEXT_KEYS) $(key).value = s[key] ?? '';
  for (const key of SELECT_KEYS) $(key).value = s[key];
  for (const key of BOOL_KEYS) $(key).checked = Boolean(s[key]);
  $('minImageSize').value = s.minImageSize;
  setMinSizeError('');
}

async function saveField(key, value) {
  try {
    await saveSettings({ [key]: value });
    toast();
  } catch (err) {
    toast(`Kaydedilemedi: ${errorMessage(err)}`, true);
  }
}

function bindSettingsInputs() {
  for (const key of TEXT_KEYS) {
    const input = $(key);
    input.addEventListener('change', () => {
      let value = input.value.trim();
      if (key === 'filenameTemplate' && !value) {
        value = DEFAULT_SETTINGS.filenameTemplate;
      }
      if (key === 'subfolder') {
        // Keep it a plain relative folder name for chrome.downloads.
        value = value
          .replace(/[<>:"|?*]/g, '')
          .replace(/\.\.+/g, '')
          .replace(/^[\\/]+|[\\/]+$/g, '')
          .trim();
      }
      input.value = value;
      saveField(key, value);
    });
  }

  for (const key of SELECT_KEYS) {
    $(key).addEventListener('change', () => saveField(key, $(key).value));
  }

  for (const key of BOOL_KEYS) {
    $(key).addEventListener('change', () => saveField(key, $(key).checked));
  }

  $('minImageSize').addEventListener('change', () => {
    const input = $('minImageSize');
    const raw = input.value.trim();
    const num = Number(raw);
    if (raw === '' || !Number.isInteger(num) || num < 0 || num > MIN_SIZE_MAX) {
      setMinSizeError(`Lütfen 0 ile ${MIN_SIZE_MAX} arasında bir tam sayı girin.`);
      return;
    }
    setMinSizeError('');
    saveField('minImageSize', num);
  });
}

function setMinSizeError(text) {
  const el = $('minImageSizeError');
  el.textContent = text;
  el.hidden = !text;
}

function bindReset() {
  $('resetDefaults').addEventListener('click', async () => {
    if (!confirm('Tüm ayarlar varsayılan değerlere dönsün mü?')) return;
    try {
      await chrome.storage.sync.set({ [KEYS.SETTINGS]: { ...DEFAULT_SETTINGS } });
      renderSettings(DEFAULT_SETTINGS);
      toast('Varsayılanlara dönüldü ✓');
    } catch (err) {
      toast(`Sıfırlanamadı: ${errorMessage(err)}`, true);
    }
  });
}

// ---------- Helper ----------

let helperBusy = false;

function setHelperBusy(busy) {
  helperBusy = busy;
  $('helperRetry').disabled = busy;
  $('ytdlpUpdate').disabled = busy;
}

function setHelperStatus(kind, text) {
  const box = $('helperStatus');
  box.querySelector('.dot').className = `dot ${kind}`;
  box.querySelector('.status-text').textContent = text;
}

function renderHelperDetails(helper) {
  const dl = $('helperDetails');
  if (!helper) {
    dl.hidden = true;
    dl.replaceChildren();
    return;
  }
  const rows = [
    ['yt-dlp sürümü', helper.ytdlpVersion || '—'],
    ['ffmpeg', helper.ffmpegFound ? 'Bulundu' : 'Bulunamadı'],
    ['Çıktı klasörü', helper.outDir || '—'],
  ];
  if (helper.connected && 'jsRuntime' in helper) {
    rows.push(['JavaScript çalışma ortamı', JS_RUNTIME_TEXT[helper.jsRuntime] || 'Bulunamadı (YouTube indirmeleri başarısız olabilir)']);
  }
  if (helper.error) rows.push(['Hata', helperErrorText(helper.error)]);

  const nodes = [];
  for (const [term, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    nodes.push(dt, dd);
  }
  dl.replaceChildren(...nodes);
  dl.hidden = false;
}

function renderHelper(res) {
  const helper = res && res.helper;
  if (!helper) {
    setHelperStatus('bad', 'Yardımcı uygulamaya ulaşılamadı');
    renderHelperDetails({
      error: (res && res.error) || 'Yanıt alınamadı. Yardımcı uygulamanın kurulu olduğundan emin olun.',
    });
    return;
  }
  if (helper.connected) {
    setHelperStatus('ok', 'Bağlı');
  } else {
    setHelperStatus('bad', 'Bağlı değil');
  }
  renderHelperDetails(helper);
}

async function pingHelper() {
  if (helperBusy) return;
  setHelperBusy(true);
  setHelperStatus('wait', 'Kontrol ediliyor…');
  let res;
  try {
    res = await send(MSG.HELPER_PING);
  } catch (err) {
    res = { ok: false, error: errorMessage(err) };
  }
  renderHelper(res);
  setHelperBusy(false);
}

async function updateYtdlp() {
  if (helperBusy) return;
  setHelperBusy(true);
  setHelperStatus('wait', "yt-dlp güncelleniyor… (birkaç dakika sürebilir)");
  const result = $('ytdlpResult');
  const output = $('ytdlpOutput');
  let res;
  try {
    res = await send(MSG.YTDLP_UPDATE);
  } catch (err) {
    res = { ok: false, error: errorMessage(err) };
  }

  if (res && res.ok) {
    result.textContent = `Güncelleme tamamlandı. Sürüm: ${res.version || '—'}`;
    toast('yt-dlp güncellendi ✓');
  } else {
    const reason = (res && res.error) || 'Güncelleme başarısız oldu.';
    result.textContent = `Güncelleme başarısız: ${reason}`;
    toast('Güncelleme başarısız', true);
  }
  result.hidden = false;

  if (res && res.output) {
    output.textContent = res.output;
    output.hidden = false;
  } else {
    output.textContent = '';
    output.hidden = true;
  }

  setHelperBusy(false);
  pingHelper();
}

function bindHelper() {
  $('helperRetry').addEventListener('click', pingHelper);
  $('ytdlpUpdate').addEventListener('click', updateYtdlp);
}

// ---------- Init ----------

async function init() {
  populateSelects();
  bindSettingsInputs();
  bindReset();
  bindHelper();

  try {
    renderSettings(await getSettings());
  } catch (err) {
    toast(`Ayarlar yüklenemedi: ${errorMessage(err)}`, true);
    renderSettings(DEFAULT_SETTINGS);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[KEYS.SETTINGS]) {
      getSettings().then(renderSettings).catch(() => {});
    }
  });

  pingHelper();
}

init();
