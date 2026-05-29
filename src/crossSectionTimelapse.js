const SOURCES_URL = '/timelapse-sources.json';
const TIMELAPSE_RESULT_MESSAGE = 'yukon-timelapse-result';

let sourcesPromise = null;
let cachedMappings = null;
/** @type {Map<string, object>} */
const timelapseResultsByKey = new Map();
let activeTimelapseContext = null;
let onTimelapseSidebarRefresh = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

export function timelapseResultKey(riverId, sectionId) {
  return `${String(riverId || '').toLowerCase()}:${String(sectionId ?? '')}`;
}

export function getTimelapseDataRoot() {
  return String(import.meta.env.VITE_DATA_ROOT || '').trim().replace(/\/+$/g, '');
}

export async function initCrossSectionTimelapse() {
  if (cachedMappings) return cachedMappings;
  if (!sourcesPromise) {
    sourcesPromise = fetch(SOURCES_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load timelapse sources (${response.status})`);
        return response.json();
      })
      .then((payload) => {
        cachedMappings = Array.isArray(payload?.mappings) ? payload.mappings : [];
        return cachedMappings;
      })
      .catch((error) => {
        console.warn('[timelapse]', error);
        cachedMappings = [];
        return cachedMappings;
      });
  }
  return sourcesPromise;
}

export function findTimelapseMapping(riverId, section) {
  if (!cachedMappings || !section) return null;
  const riverKey = String(riverId || '').trim().toLowerCase();
  const sectionId = Number(section.id);
  if (!riverKey || !Number.isFinite(sectionId)) return null;

  return (
    cachedMappings.find(
      (entry) =>
        String(entry.river_id || '').toLowerCase() === riverKey
        && Number(entry.section_id) === sectionId,
    ) || null
  );
}

export function resolveTimelapseFolder(mapping, dateFolderId = '') {
  const root = getTimelapseDataRoot();
  if (!root || !mapping?.image_root) return null;

  const parts = [root, String(mapping.image_root).replace(/^\/+/, '')];
  const dates = Array.isArray(mapping.date_folders) ? mapping.date_folders : [];
  const chosen = String(dateFolderId || '').trim()
    || (dates.length === 1 ? String(dates[0].id || '') : '');

  if (chosen) parts.push(chosen.replace(/^\/+/, ''));
  return parts.join('/');
}

function buildTimelapseStreamUrl(filePath) {
  return `/aligner-api/stream?path=${encodeURIComponent(filePath)}`;
}

function getStoredTimelapseResult(riverId, section) {
  if (!section) return null;
  return timelapseResultsByKey.get(timelapseResultKey(riverId, section.id)) || null;
}

function buildTimelapsePreviewInnerHtml(result) {
  if (!result?.file) return '';

  const fileName = String(result.file).split('/').pop();
  const frameLabel = result.count ? `${result.count} frames` : 'Timelapse';
  const fpsLabel = result.fps ? ` · ${result.fps} fps` : '';

  if (String(result.file).toLowerCase().endsWith('.mp4')) {
    return `
      <div class="cs-timelapse-preview-figure">
        <video
          class="cs-timelapse-preview-video"
          controls
          playsinline
          loop
          muted
          preload="metadata"
          src="${escapeHtml(buildTimelapseStreamUrl(result.file))}"
        ></video>
        <p class="cs-timelapse-preview-caption">${escapeHtml(fileName)} · ${escapeHtml(frameLabel)}${escapeHtml(fpsLabel)}</p>
      </div>
    `;
  }

  if (result.preview) {
    return `
      <div class="cs-timelapse-preview-figure">
        <img class="cs-timelapse-preview-gif" alt="Timelapse preview" />
        <p class="cs-timelapse-preview-caption">${escapeHtml(fileName)} · ${escapeHtml(frameLabel)}</p>
      </div>
    `;
  }

  return `
    <div class="cs-timelapse-preview-figure">
      <p class="cs-timelapse-preview-caption">Timelapse saved: ${escapeHtml(fileName)}</p>
    </div>
  `;
}

function buildTimelapsePreviewSlotHtml(riverId, section) {
  const result = getStoredTimelapseResult(riverId, section);
  if (!result) {
    return '<div id="csTimelapsePreview" class="cs-timelapse-preview-wrap is-empty" hidden></div>';
  }
  return `
    <div id="csTimelapsePreview" class="cs-timelapse-preview-wrap">
      ${buildTimelapsePreviewInnerHtml(result)}
    </div>
  `;
}

export function buildTimelapseCardMarkup(mapping, section, riverId) {
  if (!mapping) return '';

  const sectionName = String(section?.transect || section?.mat_file || `XS-${section?.id || ''}`);
  const dates = Array.isArray(mapping.date_folders) ? mapping.date_folders : [];
  const configWarning = getTimelapseDataRoot()
    ? ''
    : '<p class="cs-timelapse-warning">Timelapse data path is not configured. Run <code>npm run setup</code> and ensure <code>data/timelapse/</code> exists.</p>';

  const dateField = dates.length > 1
    ? `
      <label class="cs-timelapse-label" for="csTimelapseDate">Capture date</label>
      <select id="csTimelapseDate" class="cs-timelapse-select">
        ${dates.map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.label || d.id)}</option>`).join('')}
      </select>
    `
    : dates.length === 1
      ? `<p class="cs-timelapse-meta">Date: ${escapeHtml(dates[0].label || dates[0].id)}</p>`
      : '<p class="cs-timelapse-meta">All images in folder</p>';

  const previewSlot = buildTimelapsePreviewSlotHtml(riverId, section);

  return `
    <section class="cs-card cs-timelapse-card" id="csTimelapseCard">
      <div class="cs-card-head">
        <div>
          <h4 class="cs-card-title">Timelapse</h4>
          <p class="cs-card-subtitle">${escapeHtml(sectionName)} — ${escapeHtml(mapping.label || 'Image sequence')}</p>
        </div>
        <span class="cs-chip">aligner</span>
      </div>
      <p class="cs-timelapse-meta">Generate an aligned timelapse from field photos for this cross-section.</p>
      ${dateField}
      ${configWarning}
      <div class="cross-section-actions cs-timelapse-actions">
        <button id="csGenerateTimelapseBtn" type="button" class="inline-btn cs-timelapse-btn">
          Generate timelapse
        </button>
      </div>
      ${previewSlot}
    </section>
  `;
}

export function refreshTimelapsePreviewInCard(root, { riverId, section }) {
  if (!root || !section) return;
  const card = root.querySelector('#csTimelapseCard');
  if (!card) return;

  const result = getStoredTimelapseResult(riverId, section);
  let slot = card.querySelector('#csTimelapsePreview');

  if (!result) {
    if (slot) {
      slot.innerHTML = '';
      slot.hidden = true;
      slot.classList.add('is-empty');
    }
    return;
  }

  if (!slot) {
    slot = document.createElement('div');
    slot.id = 'csTimelapsePreview';
    slot.className = 'cs-timelapse-preview-wrap';
    card.appendChild(slot);
  }

  slot.hidden = false;
  slot.classList.remove('is-empty');
  slot.innerHTML = buildTimelapsePreviewInnerHtml(result);

  const gifImg = slot.querySelector('.cs-timelapse-preview-gif');
  if (gifImg && result.preview) {
    fetch(`/aligner-api/preview_result?path=${encodeURIComponent(result.preview)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.b64) gifImg.src = `data:image/gif;base64,${d.b64}`;
      })
      .catch(() => {});
  }
}

function storeTimelapseResult({ riverId, sectionId, result }) {
  if (!result?.file) return;
  const key = timelapseResultKey(riverId, sectionId);
  timelapseResultsByKey.set(key, result);
}

function handleTimelapseResultMessage(event) {
  if (event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || data.type !== TIMELAPSE_RESULT_MESSAGE) return;

  storeTimelapseResult({
    riverId: data.river_id,
    sectionId: data.section_id,
    result: data.result,
  });

  const ctx = activeTimelapseContext;
  if (
    ctx
    && timelapseResultKey(ctx.riverId, ctx.section?.id)
      === timelapseResultKey(data.river_id, data.section_id)
  ) {
    refreshTimelapsePreviewInCard(ctx.root, { riverId: ctx.riverId, section: ctx.section });
    onTimelapseSidebarRefresh?.('Timelapse ready — preview updated in sidebar.');
  }
}

function buildAlignerEmbedUrl(folder, sectionLabel, { riverId, sectionId } = {}) {
  const params = new URLSearchParams({
    embed: '1',
    autopreview: '1',
    folder,
    section: sectionLabel,
  });
  if (riverId) params.set('river_id', String(riverId));
  if (sectionId !== undefined && sectionId !== null && sectionId !== '') {
    params.set('section_id', String(sectionId));
  }
  return `/river-aligner.html?${params.toString()}`;
}

function ensureTimelapseModalMounted() {
  const modal = document.getElementById('timelapseModal');
  if (modal && modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
  return modal;
}

function setTimelapseModalStatus(message, visible = true) {
  const status = document.getElementById('timelapseModalStatus');
  if (!status) return;
  if (!visible || !message) {
    status.textContent = '';
    status.classList.add('is-hidden');
    return;
  }
  status.textContent = message;
  status.classList.remove('is-hidden');
}

export function openTimelapseModal({ folder, sectionLabel, riverId, sectionId }) {
  const modal = ensureTimelapseModalMounted();
  const frame = document.getElementById('timelapseAlignerFrame');
  const title = document.getElementById('timelapseModalTitle');
  if (!modal || !frame) {
    console.error('[timelapse] Modal elements missing from log-analysis.html');
    return false;
  }

  if (title) title.textContent = sectionLabel || 'Cross-section';
  setTimelapseModalStatus('Loading aligner…', true);

  modal.classList.remove('is-hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('timelapse-modal-open');

  const embedUrl = buildAlignerEmbedUrl(folder, sectionLabel || '', { riverId, sectionId });
  frame.onload = () => {
    setTimelapseModalStatus('', false);
  };
  frame.onerror = () => {
    setTimelapseModalStatus('Could not load aligner view. Try opening /river-aligner.html directly.', true);
  };
  frame.src = embedUrl;

  return true;
}

export function closeTimelapseModal() {
  const modal = document.getElementById('timelapseModal');
  const frame = document.getElementById('timelapseAlignerFrame');
  if (!modal) return;

  const ctx = activeTimelapseContext;

  modal.classList.add('is-hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('timelapse-modal-open');
  setTimelapseModalStatus('', false);
  if (frame) {
    frame.onload = null;
    frame.onerror = null;
    frame.src = 'about:blank';
  }

  if (ctx) {
    refreshTimelapsePreviewInCard(ctx.root, { riverId: ctx.riverId, section: ctx.section });
    const result = getStoredTimelapseResult(ctx.riverId, ctx.section);
    if (result) {
      onTimelapseSidebarRefresh?.('Timelapse preview shown below Generate timelapse.');
    }
  }

  activeTimelapseContext = null;
}

let modalEventsBound = false;

function ensureModalEvents() {
  if (modalEventsBound) return;
  modalEventsBound = true;
  ensureTimelapseModalMounted();

  const modal = document.getElementById('timelapseModal');
  const closeBtn = document.getElementById('closeTimelapseModal');
  const backdrop = modal?.querySelector('.timelapse-modal-backdrop');

  closeBtn?.addEventListener('click', closeTimelapseModal);
  backdrop?.addEventListener('click', closeTimelapseModal);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.classList.contains('is-hidden')) {
      closeTimelapseModal();
    }
  });

  window.addEventListener('message', handleTimelapseResultMessage);
}

function notifyTimelapseError(message, onError) {
  onError?.(message);
  window.alert(message);
}

export function bindTimelapseCard(root, { mapping, section, riverId, onError, onStatus }) {
  if (!root || !mapping) return;
  ensureModalEvents();
  onTimelapseSidebarRefresh = onStatus || null;

  const button = root.querySelector('#csGenerateTimelapseBtn');
  const dateSelect = root.querySelector('#csTimelapseDate');
  if (!button) return;

  refreshTimelapsePreviewInCard(root, { riverId, section });

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const dateFolderId = dateSelect ? dateSelect.value : '';
    const folder = resolveTimelapseFolder(mapping, dateFolderId);
    if (!folder) {
      notifyTimelapseError(
        'Timelapse data path is not configured. Restart npm run dev (default uses Yukon/data) or set VITE_DATA_ROOT in .env.',
        onError,
      );
      return;
    }

    const sectionLabel = [
      String(riverId || '').toUpperCase(),
      String(section?.transect || section?.mat_file || `XS-${section?.id || ''}`),
      mapping.label,
    ].filter(Boolean).join(' · ');

    activeTimelapseContext = { root, riverId, section };

    const opened = openTimelapseModal({
      folder,
      sectionLabel,
      riverId,
      sectionId: section?.id,
    });
    if (!opened) {
      activeTimelapseContext = null;
      notifyTimelapseError('Timelapse workspace could not open. Reload the page and try again.', onError);
    }
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureTimelapseModalMounted);
  } else {
    ensureTimelapseModalMounted();
  }
}
