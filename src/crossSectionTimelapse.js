const SOURCES_URL = '/timelapse-sources.json';
const TIMELAPSE_RESULT_MESSAGE = 'yukon-timelapse-result';

let sourcesPromise = null;
let sourcesConfig = null;
/** @type {Map<string, Array<{ section: object, mapping: object }>>} */
const timelapseSiteRegistry = new Map();
/** @type {Map<string, object>} */
const timelapseResultsByKey = new Map();
let activeTimelapseContext = null;
let onTimelapseSidebarRefresh = null;
/** @type {Map<string, { url: string, title: string, source: string }>} */
const analysisTimelapseByKey = new Map();
/** @type {Map<string, { url: string, title: string, source: string, isBlob?: boolean }>} */
const pendingTimelapseByKey = new Map();

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
  if (sourcesConfig) return sourcesConfig;
  if (sourcesPromise) return sourcesPromise;
  if (!sourcesPromise) {
    sourcesPromise = fetch(SOURCES_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load timelapse sources (${response.status})`);
        return response.json();
      })
      .then((payload) => {
        sourcesConfig = payload || {};
        return sourcesConfig;
      })
      .catch((error) => {
        console.warn('[timelapse]', error);
        sourcesConfig = {};
        return sourcesConfig;
      });
  }
  return sourcesPromise;
}

function sectionAlongRiverCoord(section) {
  const line = section?.line;
  if (!line?.has_geometry) return null;
  const sx = Number(line.start_x);
  const sz = Number(line.start_y);
  const ex = Number(line.end_x);
  const ez = Number(line.end_y);
  if (![sx, sz, ex, ez].every(Number.isFinite)) return null;
  if (section.center && Number.isFinite(section.center.x) && Number.isFinite(section.center.y)) {
    return { x: section.center.x, y: section.center.y };
  }
  return { x: (sx + ex) / 2, y: (sz + ez) / 2 };
}

function sortSectionsAlongRiver(sections) {
  const withCoord = sections
    .map((section) => {
      const c = sectionAlongRiverCoord(section);
      if (!c) return null;
      return { section, ...c };
    })
    .filter(Boolean);

  if (withCoord.length === 0) return [];

  const xs = withCoord.map((item) => item.x);
  const ys = withCoord.map((item) => item.y);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  const ySpan = Math.max(...ys) - Math.min(...ys);
  const useY = ySpan >= xSpan;

  withCoord.sort((a, b) => (useY ? a.y - b.y : a.x - b.x));
  return withCoord;
}

function pickSectionAtRank(sortedSections, alongRiver) {
  if (!sortedSections.length) return null;
  const t = clamp(Number(alongRiver) || 0, 0, 1);
  const index = Math.min(
    sortedSections.length - 1,
    Math.max(0, Math.round(t * (sortedSections.length - 1))),
  );
  return sortedSections[index]?.section || null;
}

function mergeAnalysisTimelapseSites(riverKey, sections, sites) {
  const allSections = Array.isArray(sections) ? sections : [];

  const keyPrefix = `${riverKey}:`;
  for (const [key, attachment] of analysisTimelapseByKey.entries()) {
    if (!key.startsWith(keyPrefix)) continue;
    const sectionId = Number(key.slice(keyPrefix.length));
    if (!Number.isFinite(sectionId)) continue;

    const section = allSections.find((item) => Number(item?.id) === sectionId);
    if (!section?.line?.has_geometry) continue;

    const mapping = {
      mode: 'video',
      label: attachment.title || 'Timelapse',
      custom_url: attachment.url,
      video_index: attachment.video_index,
      section_id: section.id,
      in_analysis: true,
    };
    const entry = { section, mapping };
    const existingIndex = sites.findIndex((site) => Number(site.section?.id) === sectionId);
    if (existingIndex >= 0) {
      sites[existingIndex] = entry;
    } else {
      sites.push(entry);
    }
  }

  return sites;
}

export function rebuildTimelapseSiteRegistry(riverId, sections) {
  const riverKey = String(riverId || '').trim().toLowerCase();
  timelapseSiteRegistry.delete(riverKey);

  if (!riverKey) return [];

  const riverConfig = sourcesConfig?.rivers?.[riverKey];
  const siteDefs = Array.isArray(riverConfig?.sites) ? riverConfig.sites : [];
  const sorted = sortSectionsAlongRiver(sections || []);
  const sites = [];

  for (const def of siteDefs) {
    const section = pickSectionAtRank(sorted, def.along_river);
    if (!section) continue;
    const mapping = {
      mode: def.mode === 'video' ? 'video' : 'aligner',
      label: def.label || 'Timelapse site',
      image_root: def.image_root || '',
      date_folders: Array.isArray(def.date_folders) ? def.date_folders : [],
      video_index: Number.isFinite(Number(def.video_index)) ? Number(def.video_index) : 0,
      along_river: def.along_river,
      section_id: section.id,
    };
    sites.push({ section, mapping });
  }

  mergeAnalysisTimelapseSites(riverKey, sections, sites);
  timelapseSiteRegistry.set(riverKey, sites);
  return sites;
}

export function getTimelapseSitesForRiver(riverId) {
  const riverKey = String(riverId || '').trim().toLowerCase();
  return timelapseSiteRegistry.get(riverKey) || [];
}

export function countTimelapseSitesForRiver(riverId) {
  return getTimelapseSitesForRiver(riverId).length;
}

export function isAlignerTimelapseSite(mapping) {
  return mapping?.mode === 'aligner' && Boolean(mapping?.image_root);
}

export function isVideoTimelapseSite(mapping) {
  return mapping?.mode === 'video';
}

export function findTimelapseMapping(riverId, section) {
  if (!section) return null;
  const sites = getTimelapseSitesForRiver(riverId);
  const sectionId = Number(section.id);
  if (!Number.isFinite(sectionId)) return null;
  const hit = sites.find((site) => Number(site.section?.id) === sectionId);
  return hit?.mapping || null;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
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

export function getStoredTimelapseResult(riverId, section) {
  if (!section) return null;
  return timelapseResultsByKey.get(timelapseResultKey(riverId, section.id)) || null;
}

export function getAnalysisTimelapseAttachment(riverId, section) {
  if (!section) return null;
  return analysisTimelapseByKey.get(timelapseResultKey(riverId, section.id)) || null;
}

function getPendingTimelapsePreview(riverId, section) {
  if (!section) return null;
  return pendingTimelapseByKey.get(timelapseResultKey(riverId, section.id)) || null;
}

function setPendingTimelapsePreview(riverId, section, preview) {
  if (!section) return;
  const key = timelapseResultKey(riverId, section.id);
  const previous = pendingTimelapseByKey.get(key);
  if (previous?.isBlob && previous.url) {
    URL.revokeObjectURL(previous.url);
  }
  if (!preview?.url) {
    pendingTimelapseByKey.delete(key);
    return;
  }
  pendingTimelapseByKey.set(key, preview);
}

function resolveDemoVideoUrl(mapping, videoAssets = []) {
  if (!mapping || !isVideoTimelapseSite(mapping) || mapping.in_analysis) return '';
  if (mapping.custom_url) return mapping.custom_url;
  const idx = Number(mapping.video_index) || 0;
  const asset = Array.isArray(videoAssets) && videoAssets.length > 0
    ? videoAssets[idx % videoAssets.length]
    : null;
  return asset?.url || '';
}

export function resolveTimelapsePlaybackUrl(mapping, videoAssets = []) {
  if (!mapping) return '';
  if (mapping.custom_url) return mapping.custom_url;
  return resolveDemoVideoUrl(mapping, videoAssets);
}

export function canAddTimelapseToAnalysis(riverId, section) {
  if (!section) return false;
  const pending = getPendingTimelapsePreview(riverId, section);
  if (pending?.url) return true;
  const generated = getStoredTimelapseResult(riverId, section);
  return Boolean(generated?.file);
}

export function attachTimelapseToAnalysis(riverId, section) {
  if (!section) return false;
  const key = timelapseResultKey(riverId, section.id);
  const pending = getPendingTimelapsePreview(riverId, section);
  const generated = getStoredTimelapseResult(riverId, section);

  let attachment = null;
  if (pending?.url) {
    attachment = {
      url: pending.url,
      title: pending.title || 'Timelapse',
      source: pending.source || 'file',
    };
  } else if (generated?.file) {
    const fileName = String(generated.file).split('/').pop() || 'Generated timelapse';
    attachment = {
      url: buildTimelapseStreamUrl(generated.file),
      title: fileName,
      source: 'generated',
    };
  }

  if (!attachment?.url) return false;

  analysisTimelapseByKey.set(key, attachment);
  if (pending?.isBlob && pending.url) {
    URL.revokeObjectURL(pending.url);
  }
  pendingTimelapseByKey.delete(key);
  return true;
}

function buildTimelapseVideoPreviewBlock(url, caption) {
  if (!url) return '';
  return `
    <div class="cs-timelapse-preview-figure">
      <video class="cs-timelapse-preview-video" controls playsinline loop muted preload="metadata" src="${escapeHtml(url)}"></video>
      <p class="cs-timelapse-preview-caption">${escapeHtml(caption)}</p>
    </div>
  `;
}

function buildCrossSectionTimelapsePreviewHtml(riverId, section, mapping, videoAssets = []) {
  const pending = getPendingTimelapsePreview(riverId, section);
  if (pending?.url) {
    return buildTimelapseVideoPreviewBlock(pending.url, pending.title || 'Preview — not yet added to analysis');
  }

  const attached = getAnalysisTimelapseAttachment(riverId, section);
  if (attached?.url) {
    return buildTimelapseVideoPreviewBlock(attached.url, `${attached.title} — in analysis`);
  }

  const demoUrl = resolveDemoVideoUrl(mapping, videoAssets);
  if (demoUrl) {
    const title = mapping?.label || 'Preloaded timelapse';
    return buildTimelapseVideoPreviewBlock(demoUrl, `${title} — preloaded demo`);
  }

  const generated = getStoredTimelapseResult(riverId, section);
  if (generated) {
    return buildTimelapsePreviewInnerHtml(generated);
  }

  return '';
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

export function buildCrossSectionTimelapseMarkup(section, riverId, videoAssets = []) {
  const mapping = findTimelapseMapping(riverId, section);
  const sectionName = String(section?.transect || section?.mat_file || `XS-${section?.id || ''}`);
  const dates = Array.isArray(mapping?.date_folders) ? mapping.date_folders : [];
  const hasAlignerFolder = isAlignerTimelapseSite(mapping);
  const inAnalysis = Boolean(getAnalysisTimelapseAttachment(riverId, section));
  const canAdd = canAddTimelapseToAnalysis(riverId, section);
  const previewHtml = buildCrossSectionTimelapsePreviewHtml(riverId, section, mapping, videoAssets);
  const hasPreview = Boolean(previewHtml.trim());

  const configWarning = hasAlignerFolder && !getTimelapseDataRoot()
    ? '<p class="cs-timelapse-warning">Timelapse data path is not configured. Run <code>npm run setup</code> or set <code>VITE_DATA_ROOT</code>.</p>'
    : '';

  const dateField = hasAlignerFolder && dates.length > 1
    ? `
      <label class="cs-timelapse-label" for="csTimelapseDate">Capture date</label>
      <select id="csTimelapseDate" class="cs-timelapse-select">
        ${dates.map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.label || d.id)}</option>`).join('')}
      </select>
    `
    : hasAlignerFolder && dates.length === 1
      ? `<p class="cs-timelapse-meta">Date: ${escapeHtml(dates[0].label || dates[0].id)}</p>`
      : '';

  const chip = inAnalysis ? 'in-analysis' : hasAlignerFolder ? 'aligner' : hasPreview ? 'timelapse' : 'timelapse';

  return `
    <section class="cs-card cs-timelapse-card" id="csTimelapseCard">
      <div class="cs-card-head">
        <div>
          <h4 class="cs-card-title">Timelapse</h4>
          <p class="cs-card-subtitle">${escapeHtml(sectionName)}${mapping?.label ? ` — ${escapeHtml(mapping.label)}` : ''}</p>
        </div>
        <span class="cs-chip${inAnalysis ? ' cs-chip-video' : ''}">${chip}</span>
      </div>
      <p class="cs-timelapse-meta">Generate a timelapse from field photos, load a pre-recorded video, then add it to this analysis to show a marker on the map.</p>
      ${dateField}
      ${configWarning}
      <div class="cross-section-actions cs-timelapse-actions">
        <button id="csGenerateTimelapseBtn" type="button" class="inline-btn cs-timelapse-btn">Generate timelapse</button>
        <button id="csLoadTimelapseBtn" type="button" class="inline-btn cs-timelapse-btn-secondary">Load pre-recorded timelapse</button>
        <input id="csLoadTimelapseFileInput" class="hidden-file-input" type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.ogg" hidden />
        <button id="csAddTimelapseToAnalysisBtn" type="button" class="inline-btn cs-timelapse-btn" ${canAdd ? '' : 'disabled'}>
          ${inAnalysis ? 'Update analysis timelapse' : 'Add to analysis'}
        </button>
      </div>
      <div id="csTimelapsePreview" class="cs-timelapse-preview-wrap${hasPreview ? '' : ' is-empty'}" ${hasPreview ? '' : 'hidden'}>
        ${previewHtml}
      </div>
    </section>
  `;
}

export function buildVideoTimelapseCardMarkup(mapping, section, videoAssets = []) {
  if (!mapping || !isVideoTimelapseSite(mapping)) return '';

  const sectionName = String(section?.transect || section?.mat_file || `XS-${section?.id || ''}`);
  const idx = Number(mapping.video_index) || 0;
  const asset = Array.isArray(videoAssets) && videoAssets.length > 0
    ? videoAssets[idx % videoAssets.length]
    : null;
  const url = asset?.url || '';
  const title = asset?.title || mapping.label || 'River timelapse';

  const videoBlock = url
    ? `
      <div class="cs-timelapse-preview-figure">
        <video class="cs-timelapse-preview-video" controls autoplay muted loop playsinline preload="metadata" src="${escapeHtml(url)}"></video>
        <p class="cs-timelapse-preview-caption">${escapeHtml(title)} — preloaded demo video</p>
      </div>
    `
    : '<p class="cs-empty">No preloaded video configured for this site.</p>';

  return `
    <section class="cs-card cs-timelapse-card cs-timelapse-card-video">
      <div class="cs-card-head">
        <div>
          <h4 class="cs-card-title">Timelapse (preloaded)</h4>
          <p class="cs-card-subtitle">${escapeHtml(sectionName)} — ${escapeHtml(mapping.label || title)}</p>
        </div>
        <span class="cs-chip cs-chip-video">demo-video</span>
      </div>
      <p class="cs-timelapse-meta">Bank-camera timelapse already compiled for this demo cross-section.</p>
      ${videoBlock}
    </section>
  `;
}

export function buildTimelapseCardMarkup(mapping, section, riverId) {
  if (!mapping || !isAlignerTimelapseSite(mapping)) return '';

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

export function refreshTimelapsePreviewInCard(root, { riverId, section, videoAssets = [] }) {
  if (!root || !section) return;
  const card = root.querySelector('#csTimelapseCard');
  if (!card) return;

  const mapping = findTimelapseMapping(riverId, section);
  const previewHtml = buildCrossSectionTimelapsePreviewHtml(riverId, section, mapping, videoAssets);
  let slot = card.querySelector('#csTimelapsePreview');
  const addBtn = card.querySelector('#csAddTimelapseToAnalysisBtn');
  const inAnalysis = Boolean(getAnalysisTimelapseAttachment(riverId, section));
  const canAdd = canAddTimelapseToAnalysis(riverId, section);

  if (addBtn) {
    addBtn.disabled = !canAdd;
    addBtn.textContent = inAnalysis ? 'Update analysis timelapse' : 'Add to analysis';
  }

  if (!previewHtml.trim()) {
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
  slot.innerHTML = previewHtml;

  const generated = getStoredTimelapseResult(riverId, section);
  const gifImg = slot.querySelector('.cs-timelapse-preview-gif');
  if (gifImg && generated?.preview) {
    fetch(`/aligner-api/preview_result?path=${encodeURIComponent(generated.preview)}`)
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
    refreshTimelapsePreviewInCard(ctx.root, {
      riverId: ctx.riverId,
      section: ctx.section,
      videoAssets: ctx.videoAssets || [],
    });
    onTimelapseSidebarRefresh?.('Timelapse ready — click Add to analysis to place a cyan map marker.');
  }
}

function buildAlignerEmbedUrl(folder, sectionLabel, { riverId, sectionId } = {}) {
  const params = new URLSearchParams({
    embed: '1',
    autopreview: '1',
    section: sectionLabel,
  });
  if (folder) params.set('folder', folder);
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
    refreshTimelapsePreviewInCard(ctx.root, {
      riverId: ctx.riverId,
      section: ctx.section,
      videoAssets: ctx.videoAssets || [],
    });
    const result = getStoredTimelapseResult(ctx.riverId, ctx.section);
    if (result) {
      onTimelapseSidebarRefresh?.('Timelapse ready — click Add to analysis to place a cyan map marker.');
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

function openGenerateTimelapseModal({ root, mapping, section, riverId, videoAssets = [], onError }) {
  const dateSelect = root?.querySelector('#csTimelapseDate');
  const dateFolderId = dateSelect ? dateSelect.value : '';
  const folder = mapping && isAlignerTimelapseSite(mapping)
    ? resolveTimelapseFolder(mapping, dateFolderId)
    : '';

  if (mapping && isAlignerTimelapseSite(mapping) && !folder) {
    notifyTimelapseError(
      'Timelapse data path is not configured. Restart npm run dev (default uses Yukon/data) or set VITE_DATA_ROOT in .env.',
      onError,
    );
    return false;
  }

  const sectionLabel = [
    String(riverId || '').toUpperCase(),
    String(section?.transect || section?.mat_file || `XS-${section?.id || ''}`),
    mapping?.label,
  ].filter(Boolean).join(' · ');

  activeTimelapseContext = { root, riverId, section, videoAssets };

  const opened = openTimelapseModal({
    folder: folder || undefined,
    sectionLabel,
    riverId,
    sectionId: section?.id,
  });
  if (!opened) {
    activeTimelapseContext = null;
    notifyTimelapseError('Timelapse workspace could not open. Reload the page and try again.', onError);
    return false;
  }
  return true;
}

export function bindTimelapseCard(root, { mapping, section, riverId, videoAssets, onError, onStatus, onMarkersChange }) {
  if (!root || !section) return;
  bindCrossSectionTimelapseCard(root, { mapping, section, riverId, videoAssets, onError, onStatus, onMarkersChange });
}

export function bindCrossSectionTimelapseCard(root, {
  mapping,
  section,
  riverId,
  videoAssets = [],
  onError,
  onStatus,
  onMarkersChange,
}) {
  if (!root || !section) return;
  ensureModalEvents();
  onTimelapseSidebarRefresh = onStatus || null;

  const generateBtn = root.querySelector('#csGenerateTimelapseBtn');
  const loadBtn = root.querySelector('#csLoadTimelapseBtn');
  const fileInput = root.querySelector('#csLoadTimelapseFileInput');
  const addBtn = root.querySelector('#csAddTimelapseToAnalysisBtn');
  if (!generateBtn) return;

  refreshTimelapsePreviewInCard(root, { riverId, section, videoAssets });

  generateBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openGenerateTimelapseModal({ root, mapping, section, riverId, videoAssets, onError });
  });

  loadBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    fileInput?.click();
  });

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    setPendingTimelapsePreview(riverId, section, {
      url: objectUrl,
      title: file.name || 'Pre-recorded timelapse',
      source: 'file',
      isBlob: true,
    });
    refreshTimelapsePreviewInCard(root, { riverId, section, videoAssets });
    onStatus?.('Pre-recorded timelapse loaded — click Add to analysis to place a map marker.');
  });

  addBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!canAddTimelapseToAnalysis(riverId, section)) {
      notifyTimelapseError('Load or generate a timelapse first, then add it to the analysis.', onError);
      return;
    }

    const attached = attachTimelapseToAnalysis(riverId, section);
    if (!attached) {
      notifyTimelapseError('Could not add timelapse to this analysis.', onError);
      return;
    }

    onMarkersChange?.();
    refreshTimelapsePreviewInCard(root, { riverId, section, videoAssets });
    onStatus?.('Timelapse added to analysis — cyan marker shown on the map.');
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureTimelapseModalMounted);
  } else {
    ensureTimelapseModalMounted();
  }
}
