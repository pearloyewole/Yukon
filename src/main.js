import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  mountCrossSectionInteractivePlot,
  refreshCrossSectionInteractivePlot,
  destroyCrossSectionInteractivePlot,
} from './crossSectionInteractiveP5.js';
import {
  getLoggedAnalyses,
  loadLoggedAnalysisPackage,
  saveLoggedAnalysisEntry,
} from './analysisStore.js';

const PRELOADED_RIVER_SPOTS = [
  {
    id: 'huslia',
    label: 'Huslia',
    packageUrl: '/river-packages/huslia.json',
    description: 'Default Huslia package',
  },
  {
    id: 'alakanuk',
    label: 'Alakanuk',
    packageUrl: '/river-packages/alakanuk.json',
    description: 'Alakanuk package',
  },
  {
    id: 'beaver',
    label: 'Beaver',
    packageUrl: '/river-packages/beaver.json',
    description: 'Beaver package',
  },
];
const DEFAULT_PRELOADED_RIVER_ID = 'huslia';
const DEFAULT_PACKAGE_URL = getPreloadedRiverById(DEFAULT_PRELOADED_RIVER_ID)?.packageUrl || '/river-packages/huslia.json';
const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/g, '');
const IS_LOCAL_HOST = (() => {
  const host = String(window.location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
})();
const UPLOAD_PIPELINE_ENABLED = String(import.meta.env.VITE_ENABLE_UPLOAD_PIPELINE || '').trim().toLowerCase() === 'true'
  || IS_LOCAL_HOST;
const TIMELAPSE_VIDEO_ASSETS = [
  {
    title: 'Timelapse Camera 1',
    url: new URL('../assets/timelapse_general_1776447579.mov', import.meta.url).href,
  },
  {
    title: 'Timelapse Camera 2',
    url: new URL('../assets/timelapse_general_1776447650.mov', import.meta.url).href,
  },
];
const DEMO_RIVER_VIDEO_ICON_COUNT = 14;

function getPreloadedRiverById(riverId) {
  const key = String(riverId || '').trim().toLowerCase();
  return PRELOADED_RIVER_SPOTS.find((item) => item.id === key) || null;
}

const els = {
  onboardingRoot: document.getElementById('onboardingRoot'),
  startPage: document.getElementById('startPage'),
  setupPage: document.getElementById('setupPage'),
  processingScreen: document.getElementById('processingScreen'),
  processingTitle: document.getElementById('processingTitle'),
  processingSubtitle: document.getElementById('processingSubtitle'),
  topHeaderActions: document.getElementById('topHeaderActions'),
  openSetupPage: document.getElementById('openSetupPage'),
  openLoggedAnalyses: document.getElementById('openLoggedAnalyses'),
  loggedAnalysesMeta: document.getElementById('loggedAnalysesMeta'),
  setupBackBtn: document.getElementById('setupBackBtn'),
  setupOverviewFile: document.getElementById('setupOverviewFile'),
  setupMatFile: document.getElementById('setupMatFile'),
  setupSonarFile: document.getElementById('setupSonarFile'),
  setupElevationFile: document.getElementById('setupElevationFile'),
  setupSonarFileMeta: document.getElementById('setupSonarFileMeta'),
  setupElevationFileMeta: document.getElementById('setupElevationFileMeta'),
  setupOverviewFileMeta: document.getElementById('setupOverviewFileMeta'),
  setupMatFileMeta: document.getElementById('setupMatFileMeta'),
  setupShpFile: document.getElementById('setupShpFile'),
  setupShpFileMeta: document.getElementById('setupShpFileMeta'),
  sonarDropzone: document.getElementById('sonarDropzone'),
  elevationDropzone: document.getElementById('elevationDropzone'),
  overviewDropzone: document.getElementById('overviewDropzone'),
  matDropzone: document.getElementById('matDropzone'),
  shpDropzone: document.getElementById('shpDropzone'),
  analysisName: document.getElementById('analysisName'),
  analysisInvestigator: document.getElementById('analysisInvestigator'),
  analysisDescription: document.getElementById('analysisDescription'),
  analysisDate: document.getElementById('analysisDate'),
  setupErrorText: document.getElementById('setupErrorText'),
  setupStartAnalysisBtn: document.getElementById('setupStartAnalysisBtn'),
  sceneWrap: document.getElementById('scene'),
  riverName: document.getElementById('riverName'),
  status: document.getElementById('statusText'),
  counts: document.getElementById('counts'),
  details: document.getElementById('crossSectionDetails'),
  detailsPanel: document.getElementById('detailsPanel'),
  closeSidebar: document.getElementById('closeSidebar'),
  sidebarResizer: document.getElementById('sidebarResizer'),
  openUploadPanel: document.getElementById('openUploadPanel'),
  toggleCrossSections: document.getElementById('toggleCrossSections'),
  toggleEarthTerrainColors: document.getElementById('toggleEarthTerrainColors'),
  toggleVegetationTerrain: document.getElementById('toggleVegetationTerrain'),
  toggleSedimentSamples: document.getElementById('toggleSedimentSamples'),
  preloadedRiverSpots: document.getElementById('preloadedRiverSpots'),
  resetView: document.getElementById('resetView'),
  viewerHomeBtn: document.getElementById('viewerHomeBtn'),
  viewerToolbar: document.getElementById('viewerToolbar'),
  toolSheetBtn: document.getElementById('toolSheetBtn'),
  toolMeasureBtn: document.getElementById('toolMeasureBtn'),
  sheetCountBadge: document.getElementById('sheetCountBadge'),
  sheetPanel: document.getElementById('sheetPanel'),
  sheetTableWrap: document.getElementById('sheetTableWrap'),
  measurementTableWrap: document.getElementById('measurementTableWrap'),
  exportSheetBtn: document.getElementById('exportSheetBtn'),
  closeSheetPanelBtn: document.getElementById('closeSheetPanelBtn'),
  clearSheetBtn: document.getElementById('clearSheetBtn'),
  measureReadout: document.getElementById('measureReadout'),
};

const setupState = {
  files: {
    overview: null,
    mat: [],
    sonar: [],
    elevation: [],
    shp: null,
  },
};

let scene;
let camera;
let renderer;
let controls;
let raycaster;
let mouse;
let clock;
let groundBasePlane = null;

let clickableMarkers = [];
let riverVideoPickTargets = [];
let sedimentSamplePickTargets = [];
let curtainMeshes = [];
let bankMigrationArrowLayer = null;
let sedimentSampleLayer = null;
let currentRiverGroup = null;
let worldCenter = { x: 0, y: 0 };
let selectedSection = null;
let sidebarRedrawRaf = 0;
let showColoredCrossSections = true;
let useEarthTerrainColors = false;
let useVegetationElevation = false;
let currentElevationVariantKey = 'geg';
let showSedimentSamples = false;
let keyNavEnabled = true;
let sheetRows = [];
let measurementRows = [];
let measurementRowSeq = 0;
let crossSectionNotesByKey = new Map();
let measurementModeEnabled = false;
let measurementDragActive = false;
let measurementPointerId = null;
let measurementStart = null;
let measurementEnd = null;
let measurementLine = null;
let currentPackageData = null;
let currentPreloadedRiverId = DEFAULT_PRELOADED_RIVER_ID;
let mapMeasurementSegments = [];
const keyState = {
  ArrowUp: false,
  ArrowDown: false,
  ArrowLeft: false,
  ArrowRight: false,
  Shift: false,
};
const startupParams = new URLSearchParams(window.location.search);
const startupMode = startupParams.get('mode');
const startupRiverId = startupParams.get('river') || DEFAULT_PRELOADED_RIVER_ID;

initScene();
setupUiEvents();
if (startupMode !== 'analysis' && startupMode !== 'demo') {
  const startupRiver = getPreloadedRiverById(startupRiverId) || getPreloadedRiverById(DEFAULT_PRELOADED_RIVER_ID);
  currentPreloadedRiverId = startupRiver?.id || DEFAULT_PRELOADED_RIVER_ID;
  const startupUrl = startupRiver?.packageUrl || DEFAULT_PACKAGE_URL;
  loadPackageFromUrl(startupUrl).catch((err) => {
    setStatus(`Failed to load default package: ${err.message}`);
  });
}
animate();

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1f35);

  const width = els.sceneWrap.clientWidth;
  const height = els.sceneWrap.clientHeight;

  camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000000);
  camera.position.set(0, 600, 1200);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  els.sceneWrap.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);
  controls.keyPanSpeed = 0;

  const hemi = new THREE.HemisphereLight(0xaad3ff, 0x0a1018, 0.85);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(450, 800, 300);
  scene.add(dir);

  groundBasePlane = createGroundBasePlane({
    center: new THREE.Vector3(0, 0, 0),
    y: -1.35,
    size: 6000,
  });
  scene.add(groundBasePlane);

  raycaster = new THREE.Raycaster();
  raycaster.params.Line.threshold = 12;
  mouse = new THREE.Vector2();
  clock = new THREE.Clock();
  measurementLine = createMeasurementLine();
  scene.add(measurementLine);

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  window.addEventListener('resize', onResize);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp);
}

function setupUiEvents() {
  els.resetView.addEventListener('click', () => {
    resetCamera();
  });

  els.openUploadPanel.addEventListener('click', () => {
    showOnboardingPage('setup');
    setOnboardingVisible(true);
  });

  els.viewerHomeBtn?.addEventListener('click', () => {
    window.location.href = '/';
  });

  els.closeSidebar.addEventListener('click', () => {
    closeDetailsPanel();
  });

  showColoredCrossSections = Boolean(els.toggleCrossSections.checked);
  els.toggleCrossSections.addEventListener('change', () => {
    showColoredCrossSections = Boolean(els.toggleCrossSections.checked);
    setCurtainVisibility(showColoredCrossSections);
  });

  useEarthTerrainColors = Boolean(els.toggleEarthTerrainColors?.checked ?? true);
  els.toggleEarthTerrainColors?.addEventListener('change', () => {
    useEarthTerrainColors = Boolean(els.toggleEarthTerrainColors.checked);
    rebuildElevationTerrainMesh();
    const label = useEarthTerrainColors ? 'earth terrain colors' : 'blue terrain colors';
    setStatus(`Terrain palette set to ${label}.`);
  });

  useVegetationElevation = Boolean(els.toggleVegetationTerrain?.checked ?? false);
  els.toggleVegetationTerrain?.addEventListener('change', () => {
    useVegetationElevation = Boolean(els.toggleVegetationTerrain.checked);
    rebuildElevationTerrainMesh();
    const usingVegetation = currentElevationVariantKey === 'gef';
    if (useVegetationElevation && !usingVegetation) {
      setStatus('GEF terrain is not available for this river. Keeping GEG terrain.');
      return;
    }
    const label = usingVegetation ? 'GEF vegetation terrain' : 'GEG terrain';
    setStatus(`Terrain source set to ${label}.`);
  });

  showSedimentSamples = Boolean(els.toggleSedimentSamples?.checked ?? false);
  els.toggleSedimentSamples?.addEventListener('change', () => {
    showSedimentSamples = Boolean(els.toggleSedimentSamples.checked);
    if (sedimentSampleLayer) {
      sedimentSampleLayer.visible = showSedimentSamples;
    }
    const label = showSedimentSamples ? 'shown' : 'hidden';
    setStatus(`Sediment samples ${label}.`);
  });

  els.toolSheetBtn?.addEventListener('click', () => {
    setSheetPanelVisible(els.sheetPanel?.classList.contains('is-hidden'));
  });

  els.closeSheetPanelBtn?.addEventListener('click', () => {
    setSheetPanelVisible(false);
  });

  els.clearSheetBtn?.addEventListener('click', () => {
    if (sheetRows.length === 0 && measurementRows.length === 0) return;
    sheetRows = [];
    measurementRows = [];
    measurementRowSeq = 0;
    clearMapMeasurementSegments();
    renderSheetTable();
    setStatus('Cleared analysis sheet tables.');
    if (selectedSection) {
      renderCrossSectionDetails(selectedSection);
    }
  });

  els.exportSheetBtn?.addEventListener('click', () => {
    exportSheetTablesCsv();
  });

  els.toolMeasureBtn?.addEventListener('click', () => {
    setMeasurementMode(!measurementModeEnabled);
  });

  renderPreloadedRiverSpots();
  renderSheetTable();
  setSheetPanelVisible(false);

  configureDemoHeaderControls();
  initSidebarResizer();
  initOnboardingUi();
}

function configureDemoHeaderControls() {
  if (startupMode !== 'demo') return;
  if (!els.topHeaderActions) return;

  document.body.classList.add('demo-mode');

  const demoButtons = [els.openUploadPanel, els.resetView, els.viewerHomeBtn].filter(Boolean);
  for (const button of demoButtons) {
    els.topHeaderActions.appendChild(button);
  }
}

function initOnboardingUi() {
  if (els.analysisDate && !els.analysisDate.value) {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    els.analysisDate.value = `${y}-${m}-${d}`;
  }

  bindSetupFileInput(els.setupOverviewFile, 'overview', els.setupOverviewFileMeta, 'Required');
  bindSetupFileInput(els.setupMatFile, 'mat', els.setupMatFileMeta, 'Required');
  bindSetupFileInput(els.setupSonarFile, 'sonar', els.setupSonarFileMeta, 'Optional');
  bindSetupFileInput(els.setupElevationFile, 'elevation', els.setupElevationFileMeta, 'Optional');
  bindSetupFileInput(els.setupShpFile, 'shp', els.setupShpFileMeta, 'Required');

  bindDropzone(els.overviewDropzone, 'overview', els.setupOverviewFileMeta, 'Required');
  bindDropzone(els.matDropzone, 'mat', els.setupMatFileMeta, 'Required');
  bindDropzone(els.sonarDropzone, 'sonar', els.setupSonarFileMeta, 'Optional');
  bindDropzone(els.elevationDropzone, 'elevation', els.setupElevationFileMeta, 'Optional');
  bindDropzone(els.shpDropzone, 'shp', els.setupShpFileMeta, 'Required');

  els.openSetupPage?.addEventListener('click', () => {
    clearSetupError();
    showOnboardingPage('setup');
  });

  els.openLoggedAnalyses?.addEventListener('click', () => {
    void openPreloadedRiver(DEFAULT_PRELOADED_RIVER_ID);
  });

  els.setupBackBtn?.addEventListener('click', () => {
    clearSetupError();
    if (els.startPage) {
      showOnboardingPage('start');
    } else {
      window.location.href = '/';
    }
  });

  els.setupStartAnalysisBtn?.addEventListener('click', () => {
    void startAnalysisFromSetup();
  });

  renderLoggedAnalysesMeta();
  applyUploadPipelineAvailability();
  applyInitialRouteMode();
}

function applyUploadPipelineAvailability() {
  if (UPLOAD_PIPELINE_ENABLED) return;
  if (els.setupStartAnalysisBtn) {
    els.setupStartAnalysisBtn.disabled = true;
    els.setupStartAnalysisBtn.title = 'Upload compile is disabled in no-backend deployments.';
  }
  setSetupError('Upload compile is disabled in this hosted build. Use the preloaded rivers (Huslia, Alakanuk, Beaver).');
}

function bindSetupFileInput(input, key, metaEl, emptyLabel) {
  if (!input) return;
  input.addEventListener('change', (event) => {
    const files = Array.from(event.target.files || []);
    const value = key === 'mat' || key === 'sonar' || key === 'elevation' || key === 'shp'
      ? files
      : (files[0] || null);
    setSetupFile(key, value, metaEl, emptyLabel);
  });
}

function bindDropzone(dropzone, key, metaEl, emptyLabel) {
  if (!dropzone) return;

  const prevent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  dropzone.addEventListener('dragenter', (event) => {
    prevent(event);
    dropzone.classList.add('is-dragover');
  });

  dropzone.addEventListener('dragover', (event) => {
    prevent(event);
    dropzone.classList.add('is-dragover');
  });

  dropzone.addEventListener('dragleave', (event) => {
    prevent(event);
    dropzone.classList.remove('is-dragover');
  });

  dropzone.addEventListener('drop', (event) => {
    prevent(event);
    dropzone.classList.remove('is-dragover');
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length === 0) return;
    const value = key === 'mat' || key === 'sonar' || key === 'elevation' || key === 'shp' ? files : files[0];
    setSetupFile(key, value, metaEl, emptyLabel);
  });
}

function setSetupFile(key, fileValue, metaEl, emptyLabel) {
  setupState.files[key] = fileValue;
  if (metaEl) {
    metaEl.textContent = formatFileMeta(fileValue, emptyLabel);
  }
  clearSetupError();
}

function formatFileMeta(fileValue, emptyLabel) {
  if (Array.isArray(fileValue)) {
    if (fileValue.length === 0) return emptyLabel;
    if (fileValue.length === 1) return formatSingleFileMeta(fileValue[0]);
    const totalBytes = fileValue.reduce((sum, file) => sum + (file?.size || 0), 0);
    const totalMb = totalBytes / (1024 * 1024);
    if (totalMb >= 1) return `${fileValue.length} files - ${totalMb.toFixed(2)} MB`;
    const totalKb = totalBytes / 1024;
    return `${fileValue.length} files - ${totalKb.toFixed(1)} KB`;
  }
  if (!fileValue) return emptyLabel;
  return formatSingleFileMeta(fileValue);
}

function formatSingleFileMeta(file) {
  const sizeMb = file.size / (1024 * 1024);
  if (sizeMb >= 1) {
    return `${file.name} - ${sizeMb.toFixed(2)} MB`;
  }
  const sizeKb = file.size / 1024;
  return `${file.name} - ${sizeKb.toFixed(1)} KB`;
}

function showOnboardingPage(page) {
  const showStart = page === 'start';
  els.startPage?.classList.toggle('is-active', showStart);
  els.setupPage?.classList.toggle('is-active', !showStart);
}

function applyInitialRouteMode() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const hasStartPage = Boolean(els.startPage);
  const analysisId = params.get('analysisId');
  const routeRiverId = params.get('river') || DEFAULT_PRELOADED_RIVER_ID;

  if (mode === 'analysis' && analysisId) {
    void openLoggedAnalysis(analysisId);
    return;
  }

  if (mode === 'demo') {
    void openPreloadedRiver(routeRiverId);
    return;
  }

  if (mode === 'setup') {
    showOnboardingPage('setup');
    setOnboardingVisible(true);
    if (analysisId) {
      prefillSetupFromLoggedAnalysis(analysisId);
    }
    return;
  }

  if (!hasStartPage) {
    showOnboardingPage('setup');
    setOnboardingVisible(true);
    return;
  }

  showOnboardingPage('start');
  setOnboardingVisible(true);
}

function prefillSetupFromLoggedAnalysis(analysisId) {
  const analyses = getLoggedAnalyses();
  const match = analyses.find((entry) => String(entry.id) === String(analysisId));
  if (!match) return;

  if (els.analysisName) els.analysisName.value = match.name || '';
  if (els.analysisInvestigator) els.analysisInvestigator.value = match.investigator || '';
  if (els.analysisDescription) els.analysisDescription.value = match.description || '';
  if (els.analysisDate) els.analysisDate.value = match.dateLabel || els.analysisDate.value;
  setSetupError(`Loaded logged session metadata for "${match.name || 'Untitled'}". Upload files to compile and run.`);
}

function setOnboardingVisible(visible) {
  if (!els.onboardingRoot) return;
  els.onboardingRoot.classList.toggle('is-hidden', !visible);
  keyNavEnabled = !visible;
  if (visible) {
    setSheetPanelVisible(false);
    setMeasurementMode(false);
    closeDetailsPanel();
  }
}

function setProcessingVisible(visible) {
  if (!els.processingScreen) return;
  els.processingScreen.hidden = !visible;
}

function setProcessingText(title, subtitle) {
  if (els.processingTitle) els.processingTitle.textContent = title;
  if (els.processingSubtitle) els.processingSubtitle.textContent = subtitle;
}

function clearSetupError() {
  if (els.setupErrorText) els.setupErrorText.textContent = '';
}

function setSetupError(text) {
  if (els.setupErrorText) els.setupErrorText.textContent = text;
}

async function startAnalysisFromSetup() {
  clearSetupError();

  if (!UPLOAD_PIPELINE_ENABLED) {
    setSetupError('Upload compile is disabled in this hosted build. Open a preloaded river from Saved spots or Logged Analyses.');
    return;
  }

  const overviewFile = setupState.files.overview;
  const matFiles = Array.isArray(setupState.files.mat) ? setupState.files.mat : [];
  const shpFiles = Array.isArray(setupState.files.shp)
    ? setupState.files.shp.filter(Boolean)
    : (setupState.files.shp ? [setupState.files.shp] : []);
  if (!overviewFile || matFiles.length === 0 || shpFiles.length === 0) {
    setSetupError('Overview sheet, MATLAB zip/file input, and river shapefile are required to start analysis.');
    return;
  }

  setProcessingVisible(true);
  setProcessingText('Compiling Files and Setting Up Analysis', 'Parsing river shapefile...');

  try {
    const primaryShpName = shpFiles[0].name || 'river';
    const riverId = els.analysisName?.value?.trim() || primaryShpName.replace(/\.(shp|dbf|shx|zip)$/i, '');
    const sonarFiles = Array.isArray(setupState.files.sonar) ? setupState.files.sonar : [];
    const elevationFiles = Array.isArray(setupState.files.elevation) ? setupState.files.elevation : [];
    const compiled = await compileRiverPackageFromUploads({
      riverId,
      overviewFile,
      matFiles,
      shpFiles,
      sonarFiles,
      elevationFiles,
    });
    const packageData = compiled.packageData;
    const sonarWarning = compiled.sonarWarning || '';
    const elevationWarning = compiled.elevationWarning || '';
    const crossSectionCount = Array.isArray(packageData.cross_sections) ? packageData.cross_sections.length : 0;
    const shapefileLabel = compiled?.packageData?.source?.shp || primaryShpName;

    setProcessingText('Compiling Files and Setting Up Analysis', 'Building 3D river scene...');
    loadPackage(packageData);
    const sonarLabel = sonarFiles.length > 0 ? `, sonar ${sonarFiles.length} file(s)` : '';
    const elevationLabel = elevationFiles.length > 0 ? `, elevation ${elevationFiles.length} file(s)` : '';
    const sonarStatus = sonarWarning ? ` Sonar skipped: ${sonarWarning}` : '';
    const elevationStatus = elevationWarning ? ` Elevation skipped: ${elevationWarning}` : '';
    setStatus(
      `Compiled JSON package and loaded ${shapefileLabel} with ${crossSectionCount} cross-sections, `
      + `${matFiles.length} MAT bundle/file input(s), overview ${overviewFile.name}${sonarLabel}${elevationLabel}.`
      + `${sonarStatus}${elevationStatus}`
    );

    const analysisEntry = {
      id: Date.now(),
      name: els.analysisName?.value?.trim() || riverId,
      investigator: els.analysisInvestigator?.value?.trim() || '',
      description: els.analysisDescription?.value?.trim() || '',
      dateLabel: els.analysisDate?.value || '',
    };
    try {
      await saveLoggedAnalysisEntry(analysisEntry, packageData);
    } catch (storageErr) {
      setStatus(`Analysis loaded, but save failed: ${storageErr?.message || String(storageErr)}`);
    }
    renderLoggedAnalysesMeta();

    setOnboardingVisible(false);
    if (els.startPage) {
      showOnboardingPage('start');
    } else {
      showOnboardingPage('setup');
    }
  } catch (err) {
    setSetupError(err?.message || String(err));
    setStatus(`Failed to start analysis: ${err?.message || String(err)}`);
    showOnboardingPage('setup');
  } finally {
    setProcessingVisible(false);
  }
}

async function parseSonarSupplementFiles(files) {
  const sonarFiles = Array.isArray(files) ? files.filter(Boolean) : [];
  if (sonarFiles.length === 0) {
    throw new Error('No sonar files were provided.');
  }

  const mergedPoints = [];
  let usedSources = 0;
  let skippedSources = 0;

  for (const file of sonarFiles) {
    const name = String(file.name || '').toLowerCase();
    if (name === '.ds_store') {
      skippedSources += 1;
      continue;
    }

    if (!name.endsWith('.zip')) {
      skippedSources += 1;
      continue;
    }

    try {
      const zipPoints = await parseSonarZipFile(file);
      if (zipPoints.length > 0) {
        mergedPoints.push(...zipPoints);
        usedSources += 1;
      } else {
        skippedSources += 1;
      }
    } catch {
      skippedSources += 1;
    }
  }

  if (mergedPoints.length === 0) {
    throw new Error('No usable sonar points were found in the uploaded sonar zip file(s).');
  }

  const maxPoints = 220000;
  const stride = Math.max(1, Math.ceil(mergedPoints.length / maxPoints));
  const sampled = [];
  for (let i = 0; i < mergedPoints.length; i += stride) {
    sampled.push(mergedPoints[i]);
  }

  return {
    point_fields: ['x', 'y', 'depth_m'],
    points: sampled,
    point_count_input: mergedPoints.length,
    point_count_sampled: sampled.length,
    source_files_used: usedSources,
    source_files_skipped: skippedSources,
  };
}

async function collectMatSourceNames(files) {
  const inputFiles = Array.isArray(files) ? files.filter(Boolean) : [];
  const names = [];

  for (const file of inputFiles) {
    const lowerName = String(file.name || '').toLowerCase();
    if (lowerName.endsWith('.mat')) {
      names.push(file.name);
      continue;
    }

    if (!lowerName.endsWith('.zip')) continue;

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const entries = readZipEntries(bytes);
      for (const entry of entries) {
        const entryLower = entry.fileName.toLowerCase();
        if (!entryLower.endsWith('.mat') || entryLower.endsWith('/')) continue;
        const leaf = entry.fileName.split('/').filter(Boolean).pop() || entry.fileName;
        names.push(leaf);
      }
    } catch (error) {
      throw new Error(`Unable to read MAT zip "${file.name}": ${error?.message || String(error)}`);
    }
  }

  return Array.from(new Set(names));
}

async function compileRiverPackageFromUploads({
  riverId,
  overviewFile,
  matFiles,
  shpFiles,
  sonarFiles,
  elevationFiles,
}) {
  const formData = new FormData();
  formData.append('riverId', String(riverId || '').trim());
  formData.append('overviewFile', overviewFile);
  for (const file of matFiles || []) {
    if (file) formData.append('matFiles', file);
  }
  for (const file of shpFiles || []) {
    if (file) formData.append('shpFiles', file);
  }
  for (const file of sonarFiles || []) {
    if (file) formData.append('sonarFiles', file);
  }
  for (const file of elevationFiles || []) {
    if (file) formData.append('tifFiles', file);
  }

  let response;
  try {
    response = await fetch(apiUrl('/api/compile-river-package'), {
      method: 'POST',
      body: formData,
    });
  } catch (error) {
    throw new Error(
      'Could not reach compile API. In no-backend deployments this feature is disabled; locally, start "npm run dev:backend".'
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        'Compile API route was not found. This deployment may be preloaded-only with no backend compile route.'
      );
    }
    const message = payload?.error || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  if (!payload || typeof payload !== 'object' || !payload.packageData) {
    throw new Error('Upload pipeline did not return a compiled package.');
  }

  return {
    packageData: payload.packageData,
    sonarWarning: payload.sonarWarning || '',
    elevationWarning: payload.elevationWarning || '',
  };
}

function apiUrl(pathname) {
  if (!pathname) return API_BASE_URL || '/';
  return API_BASE_URL ? `${API_BASE_URL}${pathname}` : pathname;
}

function buildCrossSectionsFromOverviewRows({ overviewRows, matSourceNames, riverEnvelope, riverBbox }) {
  const rows = Array.isArray(overviewRows) ? overviewRows : [];
  const matNames = resolveCrossSectionMatNames(rows, matSourceNames);
  if (matNames.length === 0) return [];

  const byName = indexOverviewRowsByMatName(rows);
  const sections = [];

  for (let i = 0; i < matNames.length; i++) {
    const matFile = matNames[i];
    const row = lookupOverviewRowForMat(byName, matFile) || rows[i] || {};
    const rawLine = readOverviewLine(row);
    const clippedLine = clipSectionLineToRiver(rawLine, riverEnvelope, riverBbox);
    const hasGeometry = Boolean(clippedLine);
    const lineForSummary = clippedLine || rawLine || null;
    const centerX = hasGeometry ? (clippedLine.start_x + clippedLine.end_x) * 0.5 : null;
    const centerY = hasGeometry ? (clippedLine.start_y + clippedLine.end_y) * 0.5 : null;

    sections.push({
      id: i + 1,
      mat_file: matFile,
      transect: pickRowValue(row, ['transect']),
      description: pickRowValue(row, ['description']),
      date: pickRowValue(row, ['date']),
      time_local: pickRowValue(row, ['time__local', 'time_local']),
      start_lat: pickRowValue(row, ['start_latitude']),
      start_lon: pickRowValue(row, ['start_longitude']),
      end_lat: pickRowValue(row, ['end_latitude']),
      end_lon: pickRowValue(row, ['end_longitude']),
      Q_m3s: pickRowValue(row, ['q__m3_s', 'q_m3s']),
      B_m: pickRowValue(row, ['b__m', 'b_m']),
      T_m: pickRowValue(row, ['t__m', 't_m']),
      U_ms: pickRowValue(row, ['u__m_s', 'u_ms']),
      line: {
        start_x: clippedLine?.start_x ?? null,
        start_y: clippedLine?.start_y ?? null,
        end_x: clippedLine?.end_x ?? null,
        end_y: clippedLine?.end_y ?? null,
        has_geometry: hasGeometry,
      },
      center: {
        x: centerX,
        y: centerY,
      },
      mat_summary: buildFallbackMatSummary({
        matFile,
        row,
        index: i,
        line: lineForSummary,
      }),
    });
  }

  return sections;
}

function synthesizeCrossSectionsFromEnvelope(envelope, matSourceNames, riverBbox) {
  if (!envelope || !Array.isArray(envelope.centerline) || envelope.centerline.length < 2) {
    return [];
  }

  const names = resolveCrossSectionMatNames([], matSourceNames);
  const targetCount = clamp(names.length || 24, 8, 240);
  const centers = envelope.centerline;
  const sections = [];

  for (let i = 0; i < targetCount; i++) {
    const t = targetCount === 1 ? 0.5 : i / (targetCount - 1);
    const pos = t * (centers.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(centers.length - 1, lo + 1);
    const frac = pos - lo;

    const c0 = centers[lo];
    const c1 = centers[hi];
    const cx = lerp(c0.x, c1.x, frac);
    const cy = lerp(c0.y, c1.y, frac);

    const prev = centers[Math.max(0, lo - 1)];
    const next = centers[Math.min(centers.length - 1, hi + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    let tangentLen = Math.hypot(tx, ty);
    if (!(tangentLen > 0)) {
      tx = envelope.axisX || 1;
      ty = envelope.axisY || 0;
      tangentLen = Math.hypot(tx, ty) || 1;
    }
    tx /= tangentLen;
    ty /= tangentLen;

    const nx = -ty;
    const ny = tx;
    const width = Math.max(40, lerp(c0.width || 180, c1.width || 180, frac));
    const halfWidth = width * 0.5;
    const matFile = names[i] || `generated_cross_section_${String(i + 1).padStart(3, '0')}.mat`;
    const rawLine = {
      start_x: cx - nx * halfWidth,
      start_y: cy - ny * halfWidth,
      end_x: cx + nx * halfWidth,
      end_y: cy + ny * halfWidth,
    };
    const clippedLine = clipSectionLineToRiver(rawLine, envelope, riverBbox);
    const hasGeometry = Boolean(clippedLine);
    const centerX = hasGeometry ? (clippedLine.start_x + clippedLine.end_x) * 0.5 : null;
    const centerY = hasGeometry ? (clippedLine.start_y + clippedLine.end_y) * 0.5 : null;

    sections.push({
      id: i + 1,
      mat_file: matFile,
      transect: `S-${String(i + 1).padStart(3, '0')}`,
      description: 'Compiled from uploaded river geometry and MAT bundle metadata',
      line: {
        start_x: clippedLine?.start_x ?? null,
        start_y: clippedLine?.start_y ?? null,
        end_x: clippedLine?.end_x ?? null,
        end_y: clippedLine?.end_y ?? null,
        has_geometry: hasGeometry,
      },
      center: { x: centerX, y: centerY },
      mat_summary: buildFallbackMatSummary({
        matFile,
        row: {},
        index: i,
        line: clippedLine || rawLine,
      }),
    });
  }

  return sections;
}

async function parseOverviewWorkbook(file) {
  const lowerName = String(file?.name || '').toLowerCase();
  if (!lowerName.endsWith('.xlsx')) {
    throw new Error('Overview workbook must be an .xlsx file.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = readZipEntries(bytes);
  const parser = new DOMParser();

  const workbookPath = 'xl/workbook.xml';
  const workbookXml = await readZipEntryTextByPath(bytes, entries, workbookPath);
  const workbookDoc = parser.parseFromString(workbookXml, 'application/xml');
  throwIfXmlParseError(workbookDoc, 'workbook.xml');

  const sheetNodes = Array.from(workbookDoc.getElementsByTagName('sheet'));
  if (sheetNodes.length === 0) {
    throw new Error('Overview workbook has no sheets.');
  }

  const selectedSheet = sheetNodes.find((node) => String(node.getAttribute('name') || '').trim().toLowerCase() === 'data')
    || sheetNodes[0];
  const selectedSheetName = String(selectedSheet.getAttribute('name') || 'Sheet1');
  const relId = selectedSheet.getAttribute('r:id')
    || selectedSheet.getAttribute('id')
    || selectedSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  if (!relId) {
    throw new Error(`Overview sheet "${selectedSheetName}" is missing a relationship id.`);
  }

  const relsPath = 'xl/_rels/workbook.xml.rels';
  const relsXml = await readZipEntryTextByPath(bytes, entries, relsPath);
  const relsDoc = parser.parseFromString(relsXml, 'application/xml');
  throwIfXmlParseError(relsDoc, 'workbook.xml.rels');

  const relNodes = Array.from(relsDoc.getElementsByTagName('Relationship'));
  const relNode = relNodes.find((node) => node.getAttribute('Id') === relId);
  if (!relNode) {
    throw new Error(`Overview workbook relationship "${relId}" was not found.`);
  }

  const target = relNode.getAttribute('Target');
  const sheetPath = resolveXlsxPath(workbookPath, target);
  const sheetXml = await readZipEntryTextByPath(bytes, entries, sheetPath);
  const sheetDoc = parser.parseFromString(sheetXml, 'application/xml');
  throwIfXmlParseError(sheetDoc, sheetPath);

  let sharedStrings = [];
  try {
    const sharedXml = await readZipEntryTextByPath(bytes, entries, 'xl/sharedStrings.xml');
    const sharedDoc = parser.parseFromString(sharedXml, 'application/xml');
    throwIfXmlParseError(sharedDoc, 'sharedStrings.xml');
    sharedStrings = parseSharedStrings(sharedDoc);
  } catch {
    sharedStrings = [];
  }

  const worksheetRows = parseWorksheetRows(sheetDoc, sharedStrings);
  const parsedRows = parseOverviewRows(worksheetRows);
  return {
    sheetName: selectedSheetName,
    rows: parsedRows,
  };
}

function parseOverviewRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const headerRow = Array.isArray(rows[0]) ? rows[0] : [];
  const headers = headerRow.map((value) => String(value ?? '').trim());
  const normalizedHeaders = headers.map((value) => normalizeOverviewHeader(value));
  const parsed = [];

  for (let i = 1; i < rows.length; i++) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    const record = {};
    let empty = true;

    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      const normalized = normalizedHeaders[c];
      if (!header && !normalized) continue;

      const value = sanitizeOverviewCellValue(row[c]);
      if (header) record[header] = value;
      if (normalized) record[normalized] = value;
      if (value !== null && value !== '') empty = false;
    }

    if (!empty) parsed.push(record);
  }

  return parsed;
}

function normalizeOverviewHeader(name) {
  const text = String(name || '');
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    out += (isDigit || isUpper || isLower) ? ch.toLowerCase() : '_';
  }
  return out.replace(/^_+|_+$/g, '');
}

function sanitizeOverviewCellValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim();
  if (text === '') return null;
  const asNumber = Number(text);
  if (Number.isFinite(asNumber) && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(text)) {
    return asNumber;
  }
  return text;
}

function parseWorksheetRows(sheetDoc, sharedStrings) {
  const rowNodes = Array.from(sheetDoc.getElementsByTagName('row'));
  const rows = [];

  for (const rowNode of rowNodes) {
    const cells = Array.from(rowNode.getElementsByTagName('c'));
    if (cells.length === 0) continue;

    const values = [];
    let nextColIndex = 0;
    for (const cell of cells) {
      const ref = String(cell.getAttribute('r') || '');
      const match = /^([A-Za-z]+)/.exec(ref);
      let colIndex = match ? columnLettersToIndex(match[1]) : nextColIndex;
      if (!Number.isFinite(colIndex) || colIndex < 0) colIndex = nextColIndex;
      values[colIndex] = parseWorksheetCellValue(cell, sharedStrings);
      nextColIndex = colIndex + 1;
    }

    for (let i = 0; i < values.length; i++) {
      if (values[i] === undefined) values[i] = null;
    }

    rows.push(values);
  }

  return rows;
}

function parseWorksheetCellValue(cell, sharedStrings) {
  const type = String(cell.getAttribute('t') || '');
  if (type === 'inlineStr') {
    const textNodes = Array.from(cell.getElementsByTagName('t'));
    return textNodes.map((node) => node.textContent || '').join('');
  }

  const valueNode = cell.getElementsByTagName('v')[0];
  const raw = valueNode?.textContent?.trim() ?? '';
  if (raw === '') return null;

  if (type === 's') {
    const idx = Number(raw);
    if (Number.isInteger(idx) && idx >= 0 && idx < sharedStrings.length) {
      return sharedStrings[idx];
    }
    return raw;
  }
  if (type === 'b') return raw === '1';
  if (type === 'str' || type === 'e') return raw;

  const asNumber = Number(raw);
  return Number.isFinite(asNumber) ? asNumber : raw;
}

function parseSharedStrings(sharedDoc) {
  const siNodes = Array.from(sharedDoc.getElementsByTagName('si'));
  return siNodes.map((node) => {
    const textNodes = Array.from(node.getElementsByTagName('t'));
    if (textNodes.length === 0) return '';
    return textNodes.map((textNode) => textNode.textContent || '').join('');
  });
}

function resolveXlsxPath(basePath, target) {
  const base = String(basePath || '').replaceAll('\\', '/').split('/');
  base.pop();
  const targetPath = String(target || '').replaceAll('\\', '/');
  const targetParts = targetPath.startsWith('/')
    ? targetPath.slice(1).split('/')
    : [...base, ...targetPath.split('/')];
  const resolved = [];

  for (const part of targetParts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  return resolved.join('/');
}

function columnLettersToIndex(letters) {
  const text = String(letters || '').trim().toUpperCase();
  if (!text) return -1;
  let idx = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 65 || code > 90) return -1;
    idx = idx * 26 + (code - 64);
  }
  return idx - 1;
}

async function readZipEntryTextByPath(bytes, entries, path) {
  const normalizedTarget = normalizeZipPath(path);
  const entry = entries.find((item) => normalizeZipPath(item.fileName) === normalizedTarget);
  if (!entry) throw new Error(`Workbook entry missing: ${path}`);
  const data = await unzipZipEntry(bytes.subarray(entry.dataOffset, entry.dataEnd), entry.compression);
  return new TextDecoder('utf-8').decode(data).replace(/^\uFEFF/, '');
}

function normalizeZipPath(path) {
  return String(path || '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function throwIfXmlParseError(doc, label) {
  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    const message = parserError.textContent?.trim() || 'XML parse failure';
    throw new Error(`Invalid workbook XML (${label}): ${message}`);
  }
}

function resolveCrossSectionMatNames(overviewRows, matSourceNames) {
  const uploadNames = Array.isArray(matSourceNames)
    ? matSourceNames.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  const overviewNames = [];
  for (const row of overviewRows || []) {
    const key = pickRowValue(row, ['processed_mat_file_name']);
    if (typeof key !== 'string') continue;
    const normalized = key.trim();
    if (normalized) overviewNames.push(normalized);
  }

  const merged = uploadNames.length > 0 ? uploadNames : overviewNames;
  return Array.from(new Set(merged)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function indexOverviewRowsByMatName(rows) {
  const byName = new Map();
  for (const row of rows) {
    const raw = pickRowValue(row, ['processed_mat_file_name']);
    if (typeof raw !== 'string') continue;
    for (const key of matNameLookupKeys(raw)) {
      if (!byName.has(key)) {
        byName.set(key, row);
      }
    }
  }
  return byName;
}

function lookupOverviewRowForMat(byName, matFile) {
  for (const key of matNameLookupKeys(matFile)) {
    const row = byName.get(key);
    if (row) return row;
  }
  return null;
}

function matNameLookupKeys(name) {
  const raw = String(name || '').trim();
  if (!raw) return [];
  const lowered = raw.toLowerCase();
  const leaf = lowered.split('/').pop()?.split('\\').pop() || lowered;
  const leafNoExt = leaf.replace(/\.mat$/i, '');
  return Array.from(new Set([lowered, leaf, leafNoExt]));
}

function readOverviewLine(row) {
  const sx = pickRowNumber(row, ['cross_section_start_x__utm', 'cross_section_start_x_utm']);
  const sy = pickRowNumber(row, ['cross_section_start_y__utm', 'cross_section_start_y_utm']);
  const ex = pickRowNumber(row, ['cross_section_end_x__utm', 'cross_section_end_x_utm']);
  const ey = pickRowNumber(row, ['cross_section_end_y__utm', 'cross_section_end_y_utm']);
  if (![sx, sy, ex, ey].every((v) => Number.isFinite(v))) return null;
  return {
    start_x: sx,
    start_y: sy,
    end_x: ex,
    end_y: ey,
  };
}

function clipSectionLineToRiver(line, riverEnvelope, riverBbox) {
  if (!line) return null;
  const clippedToBbox = clipLineToBbox(line, riverBbox);
  if (!clippedToBbox) return null;
  if (!riverEnvelope) return clippedToBbox;

  const clippedToEnvelope = clipLineToEnvelope(clippedToBbox, riverEnvelope);
  return clippedToEnvelope || clippedToBbox;
}

function clipLineToBbox(line, bbox) {
  const minX = Number(bbox?.min_x);
  const maxX = Number(bbox?.max_x);
  const minY = Number(bbox?.min_y);
  const maxY = Number(bbox?.max_y);
  if (![minX, maxX, minY, maxY].every((v) => Number.isFinite(v))) return line;

  let u1 = 0;
  let u2 = 1;
  const dx = line.end_x - line.start_x;
  const dy = line.end_y - line.start_y;
  const p = [-dx, dx, -dy, dy];
  const q = [
    line.start_x - minX,
    maxX - line.start_x,
    line.start_y - minY,
    maxY - line.start_y,
  ];

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > u2) return null;
      if (t > u1) u1 = t;
    } else {
      if (t < u1) return null;
      if (t < u2) u2 = t;
    }
  }

  if (u2 < u1) return null;
  return {
    start_x: line.start_x + dx * u1,
    start_y: line.start_y + dy * u1,
    end_x: line.start_x + dx * u2,
    end_y: line.start_y + dy * u2,
  };
}

function clipLineToEnvelope(line, envelope) {
  const sampleCount = 96;
  let firstInside = -1;
  let lastInside = -1;

  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    if (!isLinePointInsideEnvelope(line, envelope, t)) continue;
    if (firstInside < 0) firstInside = i;
    lastInside = i;
  }

  if (firstInside < 0 || lastInside < 0) return null;

  let t0 = firstInside / sampleCount;
  let t1 = lastInside / sampleCount;
  if (firstInside > 0) {
    t0 = refineInsideBoundaryT(line, envelope, t0, (firstInside - 1) / sampleCount);
  }
  if (lastInside < sampleCount) {
    t1 = refineInsideBoundaryT(line, envelope, t1, (lastInside + 1) / sampleCount);
  }

  if (!(t1 > t0)) return null;

  return {
    start_x: lerp(line.start_x, line.end_x, t0),
    start_y: lerp(line.start_y, line.end_y, t0),
    end_x: lerp(line.start_x, line.end_x, t1),
    end_y: lerp(line.start_y, line.end_y, t1),
  };
}

function refineInsideBoundaryT(line, envelope, insideT, outsideT) {
  let inside = insideT;
  let outside = outsideT;
  for (let i = 0; i < 20; i++) {
    const mid = (inside + outside) * 0.5;
    if (isLinePointInsideEnvelope(line, envelope, mid)) {
      inside = mid;
    } else {
      outside = mid;
    }
  }
  return inside;
}

function isLinePointInsideEnvelope(line, envelope, t) {
  const x = lerp(line.start_x, line.end_x, t);
  const y = lerp(line.start_y, line.end_y, t);
  return sampleRiverEnvelope(envelope, x, y).inside;
}

function buildFallbackMatSummary({ matFile, row, index, line }) {
  const rows = 24;
  const cols = 24;
  const lineLength = line
    ? Math.hypot(line.end_x - line.start_x, line.end_y - line.start_y)
    : clamp(pickRowNumber(row, ['b__m', 'b_m']) || 220, 80, 1200);
  const uHint = pickRowNumber(row, ['u__m_s', 'u_ms']);
  const tHint = pickRowNumber(row, ['t__m', 't_m']);
  const meanVelocity = Number.isFinite(uHint) ? clamp(uHint, 0.2, 2.8) : clamp(0.68 + lineLength * 0.0003, 0.32, 1.75);
  const depthMean = Number.isFinite(tHint) ? clamp(tHint * 0.42, 3.5, 18) : clamp(lineLength * 0.055, 4, 18);
  const velocityBase = Math.max(0.05, meanVelocity * 0.12);
  const velocitySpan = Math.max(0.22, meanVelocity * 1.55);
  const seed = hashString32(`${matFile}:${index}`);

  const velocitySample = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const maskSample = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const xinterp = Array.from({ length: cols }, (_, c) => (c / Math.max(1, cols - 1)) * lineLength);
  const zinterp = new Array(cols).fill(0);

  let wetCount = 0;
  let vMin = Infinity;
  let vMax = -Infinity;
  let vSum = 0;

  for (let c = 0; c < cols; c++) {
    const across = cols === 1 ? 0 : (c / (cols - 1)) * 2 - 1;
    const channelShape = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(across), 1.3)), 0.86);
    const bedFrac = clamp(0.12 + 0.86 * channelShape, 0.08, 1);
    zinterp[c] = depthMean * bedFrac * 1.9;

    for (let r = 0; r < rows; r++) {
      const depthFrac = rows === 1 ? 0 : r / (rows - 1);
      const wet = depthFrac <= bedFrac;
      maskSample[r][c] = wet ? 1 : 0;
      if (!wet) {
        velocitySample[r][c] = 0;
        continue;
      }

      const localDepth = clamp(depthFrac / Math.max(1e-6, bedFrac), 0, 1);
      const verticalShape = clamp(1 - Math.pow(localDepth, 1.16), 0.05, 1);
      const coreShape = 0.34 + 0.66 * channelShape;
      const oscillation = 0.055 * Math.sin(seed * 0.001 + index * 0.77 + r * 0.29 + c * 0.19);
      const speed = Math.max(0, velocityBase + velocitySpan * coreShape * verticalShape + oscillation);
      velocitySample[r][c] = speed;
      wetCount += 1;
      vSum += speed;
      if (speed < vMin) vMin = speed;
      if (speed > vMax) vMax = speed;
    }
  }

  if (!Number.isFinite(vMin) || !Number.isFinite(vMax)) {
    vMin = 0;
    vMax = 1;
  }

  const zMin = Math.min(...zinterp);
  const zMax = Math.max(...zinterp);
  const zMean = zinterp.reduce((acc, value) => acc + value, 0) / Math.max(1, zinterp.length);
  const waterFraction = wetCount / Math.max(1, rows * cols);

  return {
    source_file: matFile,
    available_keys: ['xsGridQs', 'mask_temp', 'xinterp', 'zinterp'],
    velocity: {
      rows,
      cols,
      stats: {
        min: vMin,
        max: vMax,
        mean: wetCount > 0 ? vSum / wetCount : null,
      },
      sample: velocitySample,
    },
    mask: {
      rows,
      cols,
      water_fraction: waterFraction,
      sample: maskSample,
    },
    xinterp,
    zinterp,
    z_stats: {
      min: zMin,
      max: zMax,
      mean: zMean,
    },
  };
}

function hashString32(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickRowValue(row, keys) {
  for (const key of keys) {
    if (!row || row[key] === undefined) continue;
    return row[key];
  }
  return null;
}

function pickRowNumber(row, keys) {
  const raw = pickRowValue(row, keys);
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function parseSonarZipFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = readZipEntries(bytes);
  const decoder = new TextDecoder('utf-8');
  const points = [];

  for (const entry of entries) {
    const lower = entry.fileName.toLowerCase();
    if (!lower.endsWith('.csv') || lower.endsWith('/')) continue;

    const textBytes = await unzipZipEntry(bytes.subarray(entry.dataOffset, entry.dataEnd), entry.compression);
    const csvText = decoder.decode(textBytes).replace(/^\uFEFF/, '');
    const csvPoints = parseSonarCsvText(csvText);
    if (csvPoints.length > 0) {
      points.push(...csvPoints);
    }
  }

  return points;
}

function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.byteLength;
  const eocdSig = 0x06054b50;
  const centralSig = 0x02014b50;
  const localSig = 0x04034b50;

  const searchStart = Math.max(0, len - 65557);
  let eocdOffset = -1;
  for (let i = len - 22; i >= searchStart; i--) {
    if (view.getUint32(i, true) === eocdSig) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('Invalid zip archive: end of central directory not found.');

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  if (centralDirOffset >= len) throw new Error('Invalid zip archive: bad central directory offset.');

  const nameDecoder = new TextDecoder('utf-8');
  const entries = [];
  let offset = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > len || view.getUint32(offset, true) !== centralSig) {
      throw new Error('Invalid zip archive: central directory entry is corrupted.');
    }

    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLen;
    if (nameEnd > len) throw new Error('Invalid zip archive: filename block out of range.');

    const fileName = nameDecoder.decode(bytes.subarray(nameStart, nameEnd));

    if (localHeaderOffset + 30 > len || view.getUint32(localHeaderOffset, true) !== localSig) {
      throw new Error('Invalid zip archive: local file header missing.');
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > len) throw new Error('Invalid zip archive: compressed data block out of range.');

    entries.push({
      fileName,
      compression,
      dataOffset,
      dataEnd,
    });

    offset = nameEnd + extraLen + commentLen;
  }

  return entries;
}

async function unzipZipEntry(compressedData, compression) {
  if (compression === 0) return compressedData;
  if (compression !== 8) {
    throw new Error(`Unsupported zip compression method: ${compression}`);
  }
  return inflateZipDeflateRaw(compressedData);
}

async function inflateZipDeflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Browser does not support zip decompression. Use uncompressed archives or CSV files.');
  }

  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const arrayBuffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (error) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    const arrayBuffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
}

function parseSonarCsvText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) return [];

  const header = splitCsvRow(lines[0]).map((v) => v.trim().toLowerCase());
  const xIdx = pickColumn(header, ['x', 'utm_x', 'easting', 'east', 'lon', 'longitude']);
  const yIdx = pickColumn(header, ['y', 'utm_y', 'northing', 'north', 'lat', 'latitude']);
  const depthIdx = pickColumn(header, ['depth', 'depth_m', 'z', 'bed_depth', 'bottom_depth']);

  const fallback = xIdx < 0 || yIdx < 0 || depthIdx < 0;
  const out = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvRow(lines[i]);
    const xi = fallback ? 0 : xIdx;
    const yi = fallback ? 1 : yIdx;
    const di = fallback ? 2 : depthIdx;
    if (cells.length <= Math.max(xi, yi, di)) continue;

    const x = Number(cells[xi]);
    const y = Number(cells[yi]);
    const depth = Number(cells[di]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(depth)) continue;
    out.push([x, y, depth]);
  }

  return out;
}

function splitCsvRow(row) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function pickColumn(header, candidates) {
  for (const name of candidates) {
    const idx = header.indexOf(name);
    if (idx >= 0) return idx;
  }
  return -1;
}

function renderPreloadedRiverSpots() {
  if (!els.preloadedRiverSpots) return;

  const html = PRELOADED_RIVER_SPOTS.map((spot) => {
    const isActive = currentPreloadedRiverId === spot.id;
    const activeClass = isActive ? ' is-active' : '';
    return `<button type="button" class="hud-spot-btn${activeClass}" data-river-id="${escapeHtml(spot.id)}" title="${escapeHtml(spot.description)}">${escapeHtml(spot.label)}</button>`;
  }).join('');

  els.preloadedRiverSpots.innerHTML = html;
  const buttons = Array.from(els.preloadedRiverSpots.querySelectorAll('button[data-river-id]'));
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const riverId = button.getAttribute('data-river-id') || '';
      if (!riverId) return;
      void openPreloadedRiver(riverId);
    });
  }
}

async function openPreloadedRiver(riverId) {
  const river = getPreloadedRiverById(riverId);
  if (!river) {
    setSetupError(`Unknown preloaded river: ${riverId}`);
    return;
  }

  clearSetupError();
  setProcessingVisible(true);
  setProcessingText(`Loading ${river.label}`, `Opening preloaded ${river.label} river package...`);
  try {
    currentPreloadedRiverId = river.id;
    renderPreloadedRiverSpots();
    await loadPackageFromUrl(river.packageUrl);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('mode', 'demo');
    nextUrl.searchParams.set('river', river.id);
    window.history.replaceState({}, '', nextUrl);
    setStatus(`Loaded preloaded ${river.label} river.`);
    setOnboardingVisible(false);
    if (els.startPage) {
      showOnboardingPage('start');
    } else {
      showOnboardingPage('setup');
    }
  } catch (err) {
    setSetupError(`Failed to load ${river.label}: ${err?.message || String(err)}`);
    setStatus(`Failed to load ${river.label}: ${err?.message || String(err)}`);
    if (els.startPage) {
      showOnboardingPage('start');
    } else {
      showOnboardingPage('setup');
    }
    setOnboardingVisible(true);
  } finally {
    setProcessingVisible(false);
  }
}

async function openLoggedAnalysis(analysisId) {
  clearSetupError();
  setProcessingVisible(true);
  setProcessingText('Loading Logged Analysis', 'Opening saved river JSON package...');

  try {
    const packageData = await loadLoggedAnalysisPackage(analysisId);
    if (!packageData) {
      throw new Error('This logged analysis does not have a saved river JSON package. Re-run the analysis from setup.');
    }
    loadPackage(packageData);
    setStatus(`Loaded logged analysis ${analysisId}.`);
    setOnboardingVisible(false);
    if (els.startPage) {
      showOnboardingPage('start');
    } else {
      showOnboardingPage('setup');
    }
  } catch (err) {
    setStatus(`Failed to open logged analysis: ${err?.message || String(err)}`);
    setSetupError(err?.message || String(err));
    showOnboardingPage('setup');
    setOnboardingVisible(true);
    prefillSetupFromLoggedAnalysis(analysisId);
  } finally {
    setProcessingVisible(false);
  }
}

async function parseShpRiverBanks(input) {
  const shapefile = await resolveShapefileUpload(input);
  if (!shapefile.dbf) {
    throw new Error('Missing shapefile attributes (.dbf). Upload a zip with .shp/.dbf/.shx or select all shapefile components.');
  }

  const shpData = parseShpGeometryRecords(shapefile.shp.buffer);
  const dbfData = parseDbfTable(shapefile.dbf.buffer);

  const rawPoints = [];
  for (let i = 0; i < shpData.records.length; i++) {
    const shapeRecord = shpData.records[i];
    if (!shapeRecord || !Array.isArray(shapeRecord.points) || shapeRecord.points.length === 0) continue;

    const attrs = dbfData.records[i] || {};
    for (const point of shapeRecord.points) {
      rawPoints.push({
        x: point.x,
        y: point.y,
        attrs,
      });
    }
  }

  if (rawPoints.length === 0) {
    throw new Error('No coordinates were found in the uploaded .shp file.');
  }

  const maxPoints = 220000;
  const stride = Math.max(1, Math.ceil(rawPoints.length / maxPoints));
  const points = [];
  for (let i = 0; i < rawPoints.length; i += stride) {
    points.push(rawPoints[i]);
  }

  let minX = shpData.bbox.min_x;
  let minY = shpData.bbox.min_y;
  let maxX = shpData.bbox.max_x;
  let maxY = shpData.bbox.max_y;
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    for (const point of points) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
  }

  return {
    point_count: points.length,
    fields: dbfData.fields,
    bbox: {
      min_x: minX,
      min_y: minY,
      max_x: maxX,
      max_y: maxY,
    },
    points,
    source: {
      shp: shapefile.shp.name,
      dbf: shapefile.dbf.name,
      shx: shapefile.shx?.name || null,
    },
  };
}

async function resolveShapefileUpload(input) {
  const files = normalizeUploadFiles(input);
  if (files.length === 0) {
    throw new Error('River shapefile input is empty.');
  }

  const zipFiles = files.filter((file) => fileExtLower(file.name) === '.zip');
  const shpFiles = files.filter((file) => fileExtLower(file.name) === '.shp');

  if (shpFiles.length === 0 && zipFiles.length > 0) {
    return parseShapefileFromZip(zipFiles[0]);
  }

  if (shpFiles.length !== 1) {
    if (zipFiles.length > 0) {
      return parseShapefileFromZip(zipFiles[0]);
    }
    throw new Error('Upload one .zip shapefile bundle or exactly one .shp file.');
  }

  const shpFile = shpFiles[0];
  const stemLower = fileStemLower(shpFile.name);
  const dbfFile = pickShapefileSidecarFile(files, '.dbf', stemLower);
  const shxFile = pickShapefileSidecarFile(files, '.shx', stemLower);

  return {
    shp: {
      name: shpFile.name,
      buffer: new Uint8Array(await shpFile.arrayBuffer()),
    },
    dbf: dbfFile ? {
      name: dbfFile.name,
      buffer: new Uint8Array(await dbfFile.arrayBuffer()),
    } : null,
    shx: shxFile ? {
      name: shxFile.name,
      buffer: new Uint8Array(await shxFile.arrayBuffer()),
    } : null,
  };
}

function normalizeUploadFiles(input) {
  if (Array.isArray(input)) {
    return input.filter(Boolean);
  }
  if (!input) return [];
  return [input];
}

async function parseShapefileFromZip(zipFile) {
  const bytes = new Uint8Array(await zipFile.arrayBuffer());
  const entries = readZipEntries(bytes);
  const shapefileEntries = entries.filter((entry) => {
    if (!entry || typeof entry.fileName !== 'string') return false;
    if (entry.fileName.endsWith('/')) return false;
    return !normalizeZipPath(entry.fileName).startsWith('__macosx/');
  });

  const shpEntry = pickZipShapefileEntry(shapefileEntries, '.shp');
  if (!shpEntry) {
    throw new Error('Shapefile zip must contain a .shp file.');
  }

  const stemLower = zipPathStemLower(shpEntry.fileName);
  const dbfEntry = pickZipShapefileEntry(shapefileEntries, '.dbf', stemLower);
  const shxEntry = pickZipShapefileEntry(shapefileEntries, '.shx', stemLower);

  return {
    shp: {
      name: zipPathLeafName(shpEntry.fileName),
      buffer: await unzipZipEntry(bytes.subarray(shpEntry.dataOffset, shpEntry.dataEnd), shpEntry.compression),
    },
    dbf: dbfEntry ? {
      name: zipPathLeafName(dbfEntry.fileName),
      buffer: await unzipZipEntry(bytes.subarray(dbfEntry.dataOffset, dbfEntry.dataEnd), dbfEntry.compression),
    } : null,
    shx: shxEntry ? {
      name: zipPathLeafName(shxEntry.fileName),
      buffer: await unzipZipEntry(bytes.subarray(shxEntry.dataOffset, shxEntry.dataEnd), shxEntry.compression),
    } : null,
  };
}

function fileExtLower(name) {
  const text = String(name || '').trim().toLowerCase();
  const idx = text.lastIndexOf('.');
  return idx >= 0 ? text.slice(idx) : '';
}

function fileStemLower(name) {
  const text = String(name || '').trim();
  return text.replace(/\.[^.]+$/, '').toLowerCase();
}

function pickShapefileSidecarFile(files, ext, stemLower) {
  const normalizedExt = String(ext || '').toLowerCase();
  const candidates = files.filter((file) => fileExtLower(file.name) === normalizedExt);
  if (candidates.length === 0) return null;
  const matched = candidates.find((file) => fileStemLower(file.name) === stemLower);
  return matched || candidates[0];
}

function pickZipShapefileEntry(entries, ext, stemLower = null) {
  const normalizedExt = String(ext || '').toLowerCase();
  const candidates = entries.filter((entry) => entry.fileName.toLowerCase().endsWith(normalizedExt));
  if (candidates.length === 0) return null;
  if (stemLower) {
    const matched = candidates.find((entry) => zipPathStemLower(entry.fileName) === stemLower);
    if (matched) return matched;
  }
  return candidates[0];
}

function zipPathLeafName(path) {
  const normalized = String(path || '').replaceAll('\\', '/');
  return normalized.split('/').filter(Boolean).pop() || normalized;
}

function zipPathStemLower(path) {
  const leaf = zipPathLeafName(path);
  return fileStemLower(leaf);
}

function parseShpGeometryRecords(bufferBytes) {
  if (!(bufferBytes instanceof Uint8Array) || bufferBytes.byteLength < 100) {
    throw new Error('River shapefile appears invalid (header too small).');
  }

  const view = new DataView(bufferBytes.buffer, bufferBytes.byteOffset, bufferBytes.byteLength);
  const fileCode = view.getInt32(0, false);
  if (fileCode !== 9994) {
    throw new Error('River shapefile header is invalid.');
  }

  const bbox = {
    min_x: view.getFloat64(36, true),
    min_y: view.getFloat64(44, true),
    max_x: view.getFloat64(52, true),
    max_y: view.getFloat64(60, true),
  };

  const records = [];
  let offset = 100;

  while (offset + 8 <= view.byteLength) {
    const contentLengthWords = view.getInt32(offset + 4, false);
    const contentLengthBytes = contentLengthWords * 2;
    const recordStart = offset + 8;
    const recordEnd = recordStart + contentLengthBytes;

    if (contentLengthBytes <= 0 || recordEnd > view.byteLength) break;
    if (recordStart + 4 > recordEnd) break;

    const shapeType = view.getInt32(recordStart, true);
    const recordPoints = [];

    if (shapeType === 1 || shapeType === 11 || shapeType === 21) {
      if (recordStart + 20 <= recordEnd) {
        const x = view.getFloat64(recordStart + 4, true);
        const y = view.getFloat64(recordStart + 12, true);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          recordPoints.push({ x, y });
        }
      }
    } else if (shapeType === 8 || shapeType === 18 || shapeType === 28) {
      if (recordStart + 40 <= recordEnd) {
        const numPoints = view.getInt32(recordStart + 36, true);
        const pointsStart = recordStart + 40;
        for (let i = 0; i < numPoints; i++) {
          const pointOffset = pointsStart + i * 16;
          if (pointOffset + 16 > recordEnd) break;
          const x = view.getFloat64(pointOffset, true);
          const y = view.getFloat64(pointOffset + 8, true);
          if (Number.isFinite(x) && Number.isFinite(y)) {
            recordPoints.push({ x, y });
          }
        }
      }
    } else if (
      shapeType === 3 ||
      shapeType === 5 ||
      shapeType === 13 ||
      shapeType === 15 ||
      shapeType === 23 ||
      shapeType === 25
    ) {
      if (recordStart + 44 <= recordEnd) {
        const numParts = view.getInt32(recordStart + 36, true);
        const numPoints = view.getInt32(recordStart + 40, true);
        const pointsStart = recordStart + 44 + numParts * 4;
        for (let i = 0; i < numPoints; i++) {
          const pointOffset = pointsStart + i * 16;
          if (pointOffset + 16 > recordEnd) break;
          const x = view.getFloat64(pointOffset, true);
          const y = view.getFloat64(pointOffset + 8, true);
          if (Number.isFinite(x) && Number.isFinite(y)) {
            recordPoints.push({ x, y });
          }
        }
      }
    }

    records.push({
      shapeType,
      points: recordPoints,
    });

    if (recordEnd <= offset) break;
    offset = recordEnd;
  }

  return { bbox, records };
}

function parseDbfTable(bufferBytes) {
  if (!(bufferBytes instanceof Uint8Array) || bufferBytes.byteLength < 32) {
    throw new Error('Shapefile .dbf is missing or invalid.');
  }

  const view = new DataView(bufferBytes.buffer, bufferBytes.byteOffset, bufferBytes.byteLength);
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  if (!(headerLength > 32) || !(recordLength > 1) || headerLength > bufferBytes.byteLength) {
    throw new Error('Shapefile .dbf header is invalid.');
  }

  let decoder;
  try {
    decoder = new TextDecoder('windows-1252');
  } catch {
    decoder = new TextDecoder('utf-8');
  }

  const fields = [];
  let fieldOffset = 32;
  while (fieldOffset + 32 <= headerLength) {
    const firstByte = view.getUint8(fieldOffset);
    if (firstByte === 0x0d) break;

    const nameBytes = bufferBytes.subarray(fieldOffset, fieldOffset + 11);
    let zeroIdx = nameBytes.indexOf(0);
    if (zeroIdx < 0) zeroIdx = nameBytes.length;
    const name = decoder.decode(nameBytes.subarray(0, zeroIdx)).trim() || `field_${fields.length + 1}`;
    const fieldType = String.fromCharCode(view.getUint8(fieldOffset + 11) || 67).toUpperCase();
    const fieldLen = view.getUint8(fieldOffset + 16);

    fields.push({
      name,
      type: fieldType,
      length: fieldLen,
    });
    fieldOffset += 32;
  }

  const maxRecordsBySize = Math.max(0, Math.floor((bufferBytes.byteLength - headerLength) / recordLength));
  const recordLimit = Math.min(recordCount, maxRecordsBySize);
  const records = [];

  for (let i = 0; i < recordLimit; i++) {
    const rowOffset = headerLength + i * recordLength;
    if (rowOffset + recordLength > bufferBytes.byteLength) break;

    const deletedFlag = view.getUint8(rowOffset);
    const attrs = {};
    let cursor = rowOffset + 1;

    for (const field of fields) {
      const fieldStart = cursor;
      const fieldEnd = Math.min(bufferBytes.byteLength, fieldStart + field.length);
      const rawText = decoder.decode(bufferBytes.subarray(fieldStart, fieldEnd));
      attrs[field.name] = parseDbfFieldValue(rawText, field.type);
      cursor += field.length;
    }

    if (deletedFlag === 0x2a) {
      records.push({});
      continue;
    }
    records.push(attrs);
  }

  return {
    fields: fields.map((field) => field.name),
    records,
  };
}

function parseDbfFieldValue(rawText, fieldType) {
  const text = String(rawText || '').trim();
  if (text === '') return null;

  if (fieldType === 'N' || fieldType === 'F' || fieldType === 'I' || fieldType === 'B' || fieldType === 'Y') {
    const numeric = Number(text.replaceAll(',', ''));
    return Number.isFinite(numeric) ? numeric : null;
  }

  if (fieldType === 'L') {
    const flag = text[0]?.toUpperCase?.() || '';
    if (flag === 'Y' || flag === 'T') return true;
    if (flag === 'N' || flag === 'F') return false;
    return null;
  }

  if (fieldType === 'D' && /^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }

  return text;
}

function renderLoggedAnalysesMeta() {
  if (!els.loggedAnalysesMeta) return;
  const analyses = getLoggedAnalyses();
  if (analyses.length === 0) {
    els.loggedAnalysesMeta.textContent = '3 preloaded rivers ready (Huslia, Alakanuk, Beaver)';
    return;
  }
  const latest = analyses[0];
  els.loggedAnalysesMeta.textContent = `${analyses.length} session${analyses.length === 1 ? '' : 's'} - Latest: ${latest.name || 'Untitled'} (plus 3 preloaded rivers)`;
}

async function loadPackageFromUrl(url) {
  setStatus(`Fetching ${url}...`);
  const data = await fetchPackageJson(url);
  const dataWithElevation = await mergeElevationSidecar(url, data);
  loadPackage(dataWithElevation);
  setStatus(`Loaded ${url}`);
}

async function fetchPackageJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function mergeElevationSidecar(packageUrl, packageData) {
  if (!packageData) {
    return packageData;
  }

  let sidecarUrl = null;
  if (typeof packageUrl === 'string' && packageUrl.includes('.json')) {
    sidecarUrl = packageUrl.replace(/\.json(\?.*)?$/i, '.elevation.json$1');
  }
  if (!sidecarUrl || sidecarUrl === packageUrl) {
    return packageData;
  }

  try {
    const sidecar = await fetchPackageJson(sidecarUrl);
    if (sidecar && typeof sidecar === 'object') {
      const next = { ...packageData };
      if (sidecar.elevation_raster) {
        next.elevation_raster = sidecar.elevation_raster;
      }
      if (sidecar.elevation_variants && typeof sidecar.elevation_variants === 'object') {
        next.elevation_variants = sidecar.elevation_variants;
      }
      if (typeof sidecar.default_elevation_key === 'string') {
        next.default_elevation_key = sidecar.default_elevation_key;
      }
      return {
        ...next,
      };
    }
  } catch {
    // Optional sidecar; ignore missing/invalid files.
  }
  return packageData;
}

function getElevationVariants(packageData) {
  const out = {};
  const variants = packageData?.elevation_variants;
  if (variants && typeof variants === 'object') {
    if (variants.geg && typeof variants.geg === 'object') out.geg = variants.geg;
    if (variants.gef && typeof variants.gef === 'object') out.gef = variants.gef;
  }
  if (!out.geg && packageData?.elevation_raster && typeof packageData.elevation_raster === 'object') {
    out.geg = packageData.elevation_raster;
  }
  return out;
}

function getActiveElevationRaster(packageData) {
  const variants = getElevationVariants(packageData);
  const preferredKey = useVegetationElevation ? 'gef' : 'geg';
  if (variants[preferredKey]) {
    currentElevationVariantKey = preferredKey;
    return variants[preferredKey];
  }
  if (variants.geg) {
    currentElevationVariantKey = 'geg';
    return variants.geg;
  }
  if (variants.gef) {
    currentElevationVariantKey = 'gef';
    return variants.gef;
  }
  currentElevationVariantKey = '';
  return null;
}

function updateElevationVariantToggle(packageData) {
  if (!els.toggleVegetationTerrain) return;
  const variants = getElevationVariants(packageData);
  const hasGef = Boolean(variants.gef);
  if (!hasGef) {
    useVegetationElevation = false;
  }
  els.toggleVegetationTerrain.disabled = !hasGef;
  els.toggleVegetationTerrain.checked = Boolean(useVegetationElevation && hasGef);
}

function loadPackage(data) {
  if (!data || !data.river_banks || !Array.isArray(data.river_banks.points)) {
    throw new Error('Invalid package: missing river_banks.points');
  }

  if (currentRiverGroup) {
    clearMapMeasurementSegments();
    scene.remove(currentRiverGroup);
  }

  currentRiverGroup = new THREE.Group();
  currentPackageData = data;
  clickableMarkers = [];
  riverVideoPickTargets = [];
  sedimentSamplePickTargets = [];
  curtainMeshes = [];
  bankMigrationArrowLayer = null;
  sedimentSampleLayer = null;
  selectedSection = null;
  sheetRows = [];
  measurementRows = [];
  measurementRowSeq = 0;
  mapMeasurementSegments = [];
  crossSectionNotesByKey = new Map();
  setMeasurementMode(false);
  renderSheetTable();

  const bbox = data.river_banks.bbox || {};
  worldCenter = {
    x: meanOrZero(bbox.min_x, bbox.max_x),
    y: meanOrZero(bbox.min_y, bbox.max_y),
  };
  const matchedPreloaded = getPreloadedRiverById(data.river_id);
  currentPreloadedRiverId = matchedPreloaded?.id || null;
  renderPreloadedRiverSpots();

  const bankPoints = data.river_banks.points;
  const bankPointCloud = buildBankPointCloud(bankPoints);
  currentRiverGroup.add(bankPointCloud);
  const bankMigrationArrows = buildBankMigrationArrows(bankPoints);
  if (bankMigrationArrows) {
    bankMigrationArrowLayer = bankMigrationArrows;
    currentRiverGroup.add(bankMigrationArrows);
  }
  const riverVideoGroup = buildRiverVideoIcons(bankPoints);
  if (riverVideoGroup) {
    currentRiverGroup.add(riverVideoGroup);
  }
  const sedimentSamples = parseSedimentSamples(data?.sediment_samples || []);
  const sedimentLayer = buildSedimentSampleLayer(sedimentSamples);
  if (sedimentLayer) {
    sedimentSampleLayer = sedimentLayer;
    sedimentSampleLayer.visible = showSedimentSamples;
    currentRiverGroup.add(sedimentSampleLayer);
  }
  if (els.toggleSedimentSamples) {
    els.toggleSedimentSamples.disabled = sedimentSamples.length === 0;
    els.toggleSedimentSamples.checked = sedimentSamples.length > 0 && showSedimentSamples;
  }
  const riverEnvelope = buildRiverEnvelopeFromBankPoints(bankPoints);
  updateElevationVariantToggle(data);
  const elevationRaster = getActiveElevationRaster(data);
  if (elevationRaster) {
    const elevationMesh = buildElevationTerrainMesh(elevationRaster);
    if (elevationMesh) {
      currentRiverGroup.add(elevationMesh);
    } else {
      setStatus('Elevation raster was present but could not be rendered.');
    }
  }

  const sonarBottomPoints = Array.isArray(data.sonar_bottom?.points) ? data.sonar_bottom.points : [];
  if (sonarBottomPoints.length > 0) {
    const sonarDepthCalibration = buildSonarDepthCalibration(data.sonar_bottom, data.cross_sections || []);
    const sonarBottomPointCloud = buildSonarBottomPointCloud(
      data.sonar_bottom,
      riverEnvelope,
      sonarDepthCalibration
    );
    if (sonarBottomPointCloud) {
      currentRiverGroup.add(sonarBottomPointCloud);
    } else {
      setStatus('Sonar bottom points could not be generated for this package.');
    }
  }

  const crossSectionGroup = buildCrossSections(data.cross_sections || []);
  currentRiverGroup.add(crossSectionGroup);

  scene.add(currentRiverGroup);
  updateGroundGridForRiver(currentRiverGroup);

  const riverName = data.river_id || 'unknown-river';
  const sectionCount = (data.cross_sections || []).length;
  const mappedCount = (data.cross_sections || []).filter((s) => s.line?.has_geometry).length;
  const videoCameraCount = riverVideoPickTargets.length;
  const sonarCount = sonarBottomPoints.length;
  const sedimentCount = sedimentSamples.length;
  const elevationSampleRows = Number(data.elevation_raster?.sample?.rows) || 0;
  const elevationSampleCols = Number(data.elevation_raster?.sample?.cols) || 0;
  const elevationCellCount = elevationSampleRows > 0 && elevationSampleCols > 0
    ? elevationSampleRows * elevationSampleCols
    : 0;

  els.riverName.textContent = riverName;
  const sonarLabel = sonarCount > 0 ? `, ${sonarCount.toLocaleString()} sonar bottom points` : '';
  const videoLabel = videoCameraCount > 0 ? `, ${videoCameraCount} river video cameras` : '';
  const sedimentLabel = sedimentCount > 0 ? `, ${sedimentCount.toLocaleString()} sediment samples` : '';
  const elevationLabel = elevationCellCount > 0 ? `, ${elevationCellCount.toLocaleString()} elevation cells` : '';
  els.counts.textContent = `${bankPoints.length.toLocaleString()} bank points, ${mappedCount}/${sectionCount} mapped cross-sections${videoLabel}${sonarLabel}${sedimentLabel}${elevationLabel}`;
  els.details.innerHTML = '<p>Click a cross-section marker to view a MATLAB-style cross-section plot and metadata.</p>';
  setCurtainVisibility(showColoredCrossSections);
  closeDetailsPanel();

  fitCameraToObject(currentRiverGroup);
}

function buildBankPointCloud(points) {
  const maxPoints = 150000;
  const stride = Math.max(1, Math.floor(points.length / maxPoints));

  const positions = [];
  const colors = [];

  for (let i = 0; i < points.length; i += stride) {
    const p = points[i];
    const attrs = p.attrs || {};

    const x = Number(p.x) - worldCenter.x;
    const z = Number(p.y) - worldCenter.y;

    const dispMag = numericAttr(attrs, ['disp_mag', 'disp_mag_']);
    const isErosion = numericAttr(attrs, ['isErosion', 'isErosion_']);
    const isOuter = numericAttr(attrs, ['isOuter', 'isOuter_']);

    const y = Number.isFinite(dispMag)
      ? (isErosion === 1 ? 1 : -1) * dispMag * 1.5
      : 0;

    positions.push(x, y, z);

    const color = new THREE.Color(isOuter === 1 ? 0x7dc8ff : 0x2d7fb8);
    if (isErosion === 1) {
      color.offsetHSL(0, 0, 0.08);
    }

    colors.push(color.r, color.g, color.b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 5,
    vertexColors: true,
    opacity: 0.9,
    transparent: true,
    depthWrite: false,
  });

  return new THREE.Points(geometry, material);
}

function buildBankMigrationArrows(points) {
  const candidates = [];
  const magnitudes = [];

  for (const point of points) {
    const attrs = point?.attrs || {};
    const dispX = numericAttr(attrs, ['disp_x', 'disp_x_']);
    const dispY = numericAttr(attrs, ['disp_y', 'disp_y_']);
    if (!Number.isFinite(dispX) || !Number.isFinite(dispY)) continue;

    const magFromField = numericAttr(attrs, ['disp_mag', 'disp_mag_']);
    const magnitude = Number.isFinite(magFromField) ? Math.abs(magFromField) : Math.hypot(dispX, dispY);
    if (!(magnitude > 0.05)) continue;

    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    candidates.push({
      x,
      y,
      dispX,
      dispY,
      magnitude,
    });
    magnitudes.push(magnitude);
  }

  if (candidates.length === 0) return null;

  const maxArrows = 2200;
  const stride = Math.max(1, Math.ceil(candidates.length / maxArrows));
  const magP90 = percentile(magnitudes, 0.9);
  const magP97 = percentile(magnitudes, 0.97);
  const targetP90Length = 56;
  const scale = Number.isFinite(magP90) && magP90 > 0
    ? clamp(targetP90Length / magP90, 0.65, 4.8)
    : 1;
  const maxLength = Number.isFinite(magP97) && magP97 > 0
    ? Math.max(24, magP97 * scale * 1.3)
    : 90;

  const positions = [];
  const colors = [];
  const arrowData = [];
  const color = new THREE.Color();

  for (let i = 0; i < candidates.length; i += stride) {
    const point = candidates[i];
    const vectorLength = Math.hypot(point.dispX, point.dispY);
    if (!(vectorLength > 0.0001)) continue;

    const dirX = point.dispX / vectorLength;
    const dirZ = point.dispY / vectorLength;

    const shaftLength = clamp(point.magnitude * scale, 7, maxLength);
    const headLength = clamp(shaftLength * 0.24, 4.5, 18);
    const wingSpan = headLength * 0.52;

    const startX = point.x - worldCenter.x;
    const startZ = point.y - worldCenter.y;
    const startY = 12;

    const tipX = startX + dirX * shaftLength;
    const tipZ = startZ + dirZ * shaftLength;

    const backX = tipX - dirX * headLength;
    const backZ = tipZ - dirZ * headLength;
    const perpX = -dirZ;
    const perpZ = dirX;
    const leftX = backX + perpX * wingSpan;
    const leftZ = backZ + perpZ * wingSpan;
    const rightX = backX - perpX * wingSpan;
    const rightZ = backZ - perpZ * wingSpan;

    const t = Number.isFinite(magP97) && magP97 > 0 ? clamp(point.magnitude / magP97, 0, 1) : 0;
    color.setHSL(0.58 - 0.52 * t, 0.84, 0.6 - 0.1 * t);

    positions.push(startX, startY, startZ, tipX, startY, tipZ);
    positions.push(tipX, startY, tipZ, leftX, startY, leftZ);
    positions.push(tipX, startY, tipZ, rightX, startY, rightZ);

    arrowData.push({
      rawX: point.x,
      rawY: point.y,
      dispX: point.dispX,
      dispY: point.dispY,
      magnitude: point.magnitude,
      shaftLength,
    });

    for (let j = 0; j < 6; j++) {
      colors.push(color.r, color.g, color.b);
    }
  }

  if (positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });

  const arrows = new THREE.LineSegments(geometry, material);
  arrows.userData = {
    type: 'bank-migration-arrows',
    arrowData,
  };
  arrows.renderOrder = 4;
  return arrows;
}

function buildSonarDepthCalibration(sonarBottom, sections) {
  const rawPoints = Array.isArray(sonarBottom?.points) ? sonarBottom.points : [];
  const sonarDepths = [];
  for (const point of rawPoints) {
    if (!Array.isArray(point) || point.length < 3) continue;
    const depth = Number(point[2]);
    if (!Number.isFinite(depth) || depth <= 0) continue;
    sonarDepths.push(depth);
  }

  const crossDepths = [];
  const lineLevels = [];
  const depthScaleRatios = [];
  for (const section of sections || []) {
    const meanDepth = Number(section?.mat_summary?.z_stats?.mean);
    if (!Number.isFinite(meanDepth) || meanDepth <= 0) continue;
    crossDepths.push(meanDepth);
    lineLevels.push(meanDepth * 0.08);

    const sx = Number(section?.line?.start_x);
    const sy = Number(section?.line?.start_y);
    const ex = Number(section?.line?.end_x);
    const ey = Number(section?.line?.end_y);
    if (!section?.line?.has_geometry) continue;
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) continue;

    const lineLength = Math.hypot(ex - sx, ey - sy);
    const curtainDepthScale = clamp(lineLength * 0.58, 34, 180);
    depthScaleRatios.push(curtainDepthScale / meanDepth);
  }

  const sonarRef = percentile(sonarDepths, 0.7);
  const crossRef = percentile(crossDepths, 0.7);
  const ratio = Number.isFinite(sonarRef) && sonarRef > 0 && Number.isFinite(crossRef)
    ? crossRef / sonarRef
    : 1.0;

  const verticalExaggerationRaw = percentile(depthScaleRatios, 0.5);
  const verticalExaggeration = Number.isFinite(verticalExaggerationRaw)
    ? clamp(verticalExaggerationRaw, 3, 35)
    : 3.0;

  const waterSurface = percentile(lineLevels, 0.5);

  return {
    depthMultiplier: clamp(ratio, 0.4, 3.5),
    waterSurfaceY: Number.isFinite(waterSurface) ? waterSurface : 0,
    verticalExaggeration,
  };
}

function normalizeSonarDepth(depth, depthCalibration) {
  const multiplier = depthCalibration?.depthMultiplier ?? 1.0;
  return Math.max(0, Number(depth) * multiplier);
}

function buildSonarBottomPointCloud(sonarBottom, riverEnvelope, depthCalibration) {
  const sonarPoints = parseSonarPoints(sonarBottom?.points || []);
  if (sonarPoints.length === 0) return null;

  const sampled = [];
  const maxPoints = 180000;
  const stride = Math.max(1, Math.ceil(sonarPoints.length / maxPoints));
  const waterSurfaceY = depthCalibration?.waterSurfaceY ?? 0;
  const verticalScale = depthCalibration?.verticalExaggeration ?? 1.0;

  let minDepth = Infinity;
  let maxDepth = -Infinity;
  for (let i = 0; i < sonarPoints.length; i += stride) {
    const point = sonarPoints[i];
    if (riverEnvelope && !sampleRiverEnvelope(riverEnvelope, point.x, point.y).inside) continue;

    const depth = normalizeSonarDepth(point.depth, depthCalibration);
    if (!Number.isFinite(depth)) continue;

    sampled.push({
      x: point.x,
      y: point.y,
      depth,
    });
    if (depth < minDepth) minDepth = depth;
    if (depth > maxDepth) maxDepth = depth;
  }

  if (sampled.length === 0) return null;

  const depthRange = Math.max(0.001, maxDepth - minDepth);
  const positions = [];
  const colors = [];

  for (const point of sampled) {
    positions.push(
      point.x - worldCenter.x,
      waterSurfaceY - point.depth * verticalScale,
      point.y - worldCenter.y
    );

    const t = clamp((point.depth - minDepth) / depthRange, 0, 1);
    const color = new THREE.Color().setHSL(0.58 - 0.16 * t, 0.45, 0.62 - 0.18 * t);
    colors.push(color.r, color.g, color.b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 3.6,
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });

  const cloud = new THREE.Points(geometry, material);
  cloud.renderOrder = 1;
  return cloud;
}

function buildElevationTerrainMesh(elevationRaster) {
  const sample = elevationRaster?.sample;
  const georef = elevationRaster?.georeference;
  const display = elevationRaster?.display || {};
  const values = Array.isArray(sample?.values) ? sample.values : [];
  const rowIndices = Array.isArray(sample?.row_indices) ? sample.row_indices.map((v) => Number(v)) : [];
  const colIndices = Array.isArray(sample?.col_indices) ? sample.col_indices.map((v) => Number(v)) : [];

  if (values.length < 2 || rowIndices.length < 2 || colIndices.length < 2) return null;
  if (values.length !== rowIndices.length) return null;

  const xOrigin = Number(georef?.x_origin);
  const yOrigin = Number(georef?.y_origin);
  const pixelSizeX = Number(georef?.pixel_size_x);
  const pixelSizeY = Number(georef?.pixel_size_y);
  if (
    !Number.isFinite(xOrigin)
    || !Number.isFinite(yOrigin)
    || !Number.isFinite(pixelSizeX)
    || !Number.isFinite(pixelSizeY)
    || pixelSizeX === 0
    || pixelSizeY === 0
  ) {
    return null;
  }

  const elevationRef = Number.isFinite(Number(display?.elevation_reference_m))
    ? Number(display.elevation_reference_m)
    : 0;
  const verticalScale = Number.isFinite(Number(display?.vertical_scale))
    ? clamp(Number(display.vertical_scale), 0.08, 12)
    : 1;
  const baseY = 0;

  let minElev = Infinity;
  let maxElev = -Infinity;
  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < colIndices.length; c++) {
      const elevation = Number(row[c]);
      if (!Number.isFinite(elevation)) continue;

      if (elevation < minElev) minElev = elevation;
      if (elevation > maxElev) maxElev = elevation;
    }
  }
  if (!Number.isFinite(minElev) || !Number.isFinite(maxElev)) return null;

  const clipLow = Number.isFinite(Number(display?.clip_percentile_low_m))
    ? Number(display.clip_percentile_low_m)
    : minElev;
  const clipHigh = Number.isFinite(Number(display?.clip_percentile_high_m))
    ? Number(display.clip_percentile_high_m)
    : maxElev;
  const clipRange = Math.max(0.001, clipHigh - clipLow);
  const positions = [];
  const colors = [];
  const vertexIndex = Array.from({ length: rowIndices.length }, () => new Int32Array(colIndices.length).fill(-1));

  for (let r = 0; r < rowIndices.length; r++) {
    const row = values[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < colIndices.length; c++) {
      const elevation = Number(row[c]);
      if (!Number.isFinite(elevation)) continue;

      const xRaw = xOrigin + colIndices[c] * pixelSizeX;
      const yRaw = yOrigin + rowIndices[r] * pixelSizeY;

      const x = xRaw - worldCenter.x;
      const z = yRaw - worldCenter.y;
      const y = (elevation - elevationRef) * verticalScale + baseY;

      const vertex = positions.length / 3;
      vertexIndex[r][c] = vertex;
      positions.push(x, y, z);

      // Color terrain by elevation with an earth-like topographic ramp.
      const t = clamp((elevation - clipLow) / clipRange, 0, 1);
      const color = useEarthTerrainColors
        ? colorFromEarthTopographicRamp(t)
        : colorFromBlueTopographicRamp(t);
      colors.push(color.r, color.g, color.b);
    }
  }

  if (positions.length < 9) return null;

  const indices = [];
  for (let r = 0; r < rowIndices.length - 1; r++) {
    for (let c = 0; c < colIndices.length - 1; c++) {
      const a = vertexIndex[r][c];
      const b = vertexIndex[r][c + 1];
      const d = vertexIndex[r + 1][c];
      const e = vertexIndex[r + 1][c + 1];
      if (a < 0 || b < 0 || d < 0 || e < 0) continue;
      indices.push(a, d, b);
      indices.push(b, d, e);
    }
  }

  if (indices.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.86,
    roughness: 0.96,
    metalness: 0.02,
    depthWrite: false,
  });

  const terrain = new THREE.Mesh(geometry, material);
  terrain.userData.objectType = 'elevation-terrain';
  terrain.renderOrder = -1;
  return terrain;
}

function colorFromEarthTopographicRamp(t) {
  const stops = [
    { t: 0.00, hex: 0x234a9f }, // deep water
    { t: 0.12, hex: 0x3f74b5 }, // shallow water
    { t: 0.20, hex: 0xcbb98a }, // sand / banks
    { t: 0.42, hex: 0x6b9f52 }, // lowland vegetation
    { t: 0.65, hex: 0x4f7f3f }, // denser vegetation
    { t: 0.82, hex: 0x8b6a4b }, // upland / rock
    { t: 0.94, hex: 0xaca396 }, // high rocky terrain
    { t: 1.00, hex: 0xf0ece2 }, // highest peaks
  ];

  const u = clamp(t, 0, 1);
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (u > b.t) continue;
    const localT = (u - a.t) / Math.max(1e-6, b.t - a.t);
    return new THREE.Color(a.hex).lerp(new THREE.Color(b.hex), localT);
  }

  return new THREE.Color(stops[stops.length - 1].hex);
}

function colorFromBlueTopographicRamp(t) {
  const stops = [
    { t: 0.0, hex: 0x0e3158 },
    { t: 0.28, hex: 0x1e5f96 },
    { t: 0.58, hex: 0x2d92ce },
    { t: 0.82, hex: 0x5fc8f3 },
    { t: 1.0, hex: 0xb5ecff },
  ];

  const u = clamp(t, 0, 1);
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (u > b.t) continue;
    const localT = (u - a.t) / Math.max(1e-6, b.t - a.t);
    return new THREE.Color(a.hex).lerp(new THREE.Color(b.hex), localT);
  }

  return new THREE.Color(stops[stops.length - 1].hex);
}

function rebuildElevationTerrainMesh() {
  if (!currentRiverGroup) return;
  currentRiverGroup.children
    .filter((child) => child?.userData?.objectType === 'elevation-terrain')
    .forEach((mesh) => currentRiverGroup.remove(mesh));

  const elevationRaster = getActiveElevationRaster(currentPackageData);
  if (!elevationRaster) return;
  const elevationMesh = buildElevationTerrainMesh(elevationRaster);
  if (elevationMesh) {
    currentRiverGroup.add(elevationMesh);
  }
}

function buildSonarBottomSurfaceFromBanks(sonarBottom, riverEnvelope, depthCalibration) {
  const sonarPoints = parseSonarPoints(sonarBottom?.points || []);
  if (sonarPoints.length < 400) return null;
  const envelope = riverEnvelope;
  if (!envelope || envelope.centerline.length < 16) return null;

  const filteredSonar = [];
  for (const point of sonarPoints) {
    const env = sampleRiverEnvelope(envelope, point.x, point.y);
    if (!env.inside) continue;
    filteredSonar.push({
      x: point.x,
      y: point.y,
      depth: normalizeSonarDepth(point.depth, depthCalibration),
    });
  }

  if (filteredSonar.length < 600) return null;

  const spanX = envelope.bbox.maxX - envelope.bbox.minX;
  const spanY = envelope.bbox.maxY - envelope.bbox.minY;
  if (!(spanX > 1) || !(spanY > 1)) return null;

  const targetCells = 42000;
  const cols = clamp(
    Math.round(Math.sqrt((targetCells * spanX) / Math.max(1, spanY))),
    120,
    360
  );
  const rows = clamp(Math.round(targetCells / cols), 120, 360);

  const sonarIndex = buildSonarSpatialIndex(filteredSonar, Math.max(spanX / cols, spanY / rows) * 2.2);
  const depthGrid = Array.from({ length: rows }, () => new Array(cols).fill(null));
  const insideGrid = Array.from({ length: rows }, () => new Array(cols).fill(false));

  const maxSearchDist = Math.max(180, Math.min(360, Math.max(spanX / cols, spanY / rows) * 4.5));
  for (let r = 0; r < rows; r++) {
    const v = rows === 1 ? 0 : r / (rows - 1);
    const y = lerp(envelope.bbox.minY, envelope.bbox.maxY, v);

    for (let c = 0; c < cols; c++) {
      const u = cols === 1 ? 0 : c / (cols - 1);
      const x = lerp(envelope.bbox.minX, envelope.bbox.maxX, u);
      const env = sampleRiverEnvelope(envelope, x, y);
      if (!env.inside) continue;

      insideGrid[r][c] = true;
      const depth = estimateDepthKnnKernel(sonarIndex, x, y, maxSearchDist, 24, 8);
      if (!Number.isFinite(depth)) continue;

      // Force the bed to taper toward banks using shapefile-derived width.
      const boundedDepth = depth * Math.pow(env.edgeFactor, 0.45);
      depthGrid[r][c] = Math.max(0, boundedDepth);
    }
  }

  fillDepthHolesMasked(depthGrid, insideGrid, 4);
  smoothDepthGridMasked(depthGrid, insideGrid, 3);

  let dMin = Infinity;
  let dMax = -Infinity;
  let validCount = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const depth = depthGrid[r][c];
      if (!insideGrid[r][c] || !Number.isFinite(depth)) continue;
      validCount += 1;
      if (depth < dMin) dMin = depth;
      if (depth > dMax) dMax = depth;
    }
  }
  if (validCount < 500 || !Number.isFinite(dMin) || !Number.isFinite(dMax)) return null;

  const depthRange = Math.max(0.001, dMax - dMin);
  const waterSurfaceY = depthCalibration?.waterSurfaceY ?? 0;
  const verticalScale = depthCalibration?.verticalExaggeration ?? 1.0;
  const positions = [];
  const colors = [];
  const vertexIndex = Array.from({ length: rows }, () => new Int32Array(cols).fill(-1));

  for (let r = 0; r < rows; r++) {
    const v = rows === 1 ? 0 : r / (rows - 1);
    const yWorld = lerp(envelope.bbox.minY, envelope.bbox.maxY, v);
    for (let c = 0; c < cols; c++) {
      const depth = depthGrid[r][c];
      if (!insideGrid[r][c] || !Number.isFinite(depth)) continue;

      const u = cols === 1 ? 0 : c / (cols - 1);
      const xWorld = lerp(envelope.bbox.minX, envelope.bbox.maxX, u);
      const vertex = positions.length / 3;
      vertexIndex[r][c] = vertex;

      positions.push(xWorld - worldCenter.x, waterSurfaceY - depth * verticalScale, yWorld - worldCenter.y);

      const t = clamp((depth - dMin) / depthRange, 0, 1);
      const color = new THREE.Color().setHSL(0.56 - 0.2 * t, 0.6, 0.34 - 0.11 * t);
      colors.push(color.r, color.g, color.b);
    }
  }

  const indices = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = vertexIndex[r][c];
      const b = vertexIndex[r][c + 1];
      const d = vertexIndex[r + 1][c];
      const e = vertexIndex[r + 1][c + 1];
      if (a < 0 || b < 0 || d < 0 || e < 0) continue;
      indices.push(a, d, b);
      indices.push(b, d, e);
    }
  }

  if (indices.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.48,
    roughness: 0.92,
    metalness: 0.02,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

function buildSonarBottomSurfaceFromPoints(sonarBottom, depthCalibration, riverEnvelope) {
  const sonarPoints = parseSonarPoints(sonarBottom?.points || []);
  if (sonarPoints.length < 250) return null;

  const filtered = [];
  for (const point of sonarPoints) {
    if (riverEnvelope && !sampleRiverEnvelope(riverEnvelope, point.x, point.y).inside) continue;
    filtered.push({
      x: point.x,
      y: point.y,
      depth: normalizeSonarDepth(point.depth, depthCalibration),
    });
  }
  if (filtered.length < 250) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of filtered) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (!(spanX > 1) || !(spanY > 1)) return null;

  const targetCells = 28000;
  const cols = clamp(
    Math.round(Math.sqrt((targetCells * spanX) / Math.max(1, spanY))),
    100,
    300
  );
  const rows = clamp(Math.round(targetCells / cols), 100, 300);

  const sonarIndex = buildSonarSpatialIndex(filtered, Math.max(spanX / cols, spanY / rows) * 2.4);
  const depthGrid = Array.from({ length: rows }, () => new Array(cols).fill(null));
  const insideGrid = Array.from({ length: rows }, () => new Array(cols).fill(false));

  const maxSearchDist = Math.max(220, Math.min(520, Math.max(spanX / cols, spanY / rows) * 5.5));
  for (let r = 0; r < rows; r++) {
    const v = rows === 1 ? 0 : r / (rows - 1);
    const y = lerp(minY, maxY, v);
    for (let c = 0; c < cols; c++) {
      const u = cols === 1 ? 0 : c / (cols - 1);
      const x = lerp(minX, maxX, u);

      let edgeFactor = 1;
      if (riverEnvelope) {
        const env = sampleRiverEnvelope(riverEnvelope, x, y);
        if (!env.inside) continue;
        edgeFactor = env.edgeFactor;
      }

      insideGrid[r][c] = true;
      const depth = estimateDepthKnnKernel(sonarIndex, x, y, maxSearchDist, 24, 6);
      if (!Number.isFinite(depth)) continue;

      const boundedDepth = riverEnvelope ? depth * Math.pow(edgeFactor, 0.45) : depth;
      depthGrid[r][c] = Math.max(0, boundedDepth);
    }
  }

  fillDepthHolesMasked(depthGrid, insideGrid, 5);
  smoothDepthGridMasked(depthGrid, insideGrid, 3);

  let dMin = Infinity;
  let dMax = -Infinity;
  let validCount = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const depth = depthGrid[r][c];
      if (!insideGrid[r][c] || !Number.isFinite(depth)) continue;
      validCount += 1;
      if (depth < dMin) dMin = depth;
      if (depth > dMax) dMax = depth;
    }
  }
  if (validCount < 200 || !Number.isFinite(dMin) || !Number.isFinite(dMax)) return null;

  const depthRange = Math.max(0.001, dMax - dMin);
  const waterSurfaceY = depthCalibration?.waterSurfaceY ?? 0;
  const verticalScale = depthCalibration?.verticalExaggeration ?? 1.0;
  const positions = [];
  const colors = [];
  const vertexIndex = Array.from({ length: rows }, () => new Int32Array(cols).fill(-1));

  for (let r = 0; r < rows; r++) {
    const v = rows === 1 ? 0 : r / (rows - 1);
    const yWorld = lerp(minY, maxY, v);
    for (let c = 0; c < cols; c++) {
      const depth = depthGrid[r][c];
      if (!insideGrid[r][c] || !Number.isFinite(depth)) continue;

      const u = cols === 1 ? 0 : c / (cols - 1);
      const xWorld = lerp(minX, maxX, u);
      const vertex = positions.length / 3;
      vertexIndex[r][c] = vertex;

      positions.push(
        xWorld - worldCenter.x,
        waterSurfaceY - depth * verticalScale,
        yWorld - worldCenter.y
      );

      const t = clamp((depth - dMin) / depthRange, 0, 1);
      const color = new THREE.Color().setHSL(0.56 - 0.2 * t, 0.6, 0.34 - 0.11 * t);
      colors.push(color.r, color.g, color.b);
    }
  }

  const indices = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = vertexIndex[r][c];
      const b = vertexIndex[r][c + 1];
      const d = vertexIndex[r + 1][c];
      const e = vertexIndex[r + 1][c + 1];
      if (a < 0 || b < 0 || d < 0 || e < 0) continue;
      indices.push(a, d, b);
      indices.push(b, d, e);
    }
  }
  if (indices.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.48,
    roughness: 0.92,
    metalness: 0.02,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

function buildRiverEnvelopeFromBankPoints(bankPoints) {
  if (!Array.isArray(bankPoints) || bankPoints.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const centerAcc = new Map();
  for (const point of bankPoints) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const attrs = point?.attrs || {};
    const cx = numericAttr(attrs, ['channel_x', 'channel_x_']);
    const cy = numericAttr(attrs, ['channel_y', 'channel_y_']);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;

    const width = numericAttr(attrs, ['channel_wi', 'channel_wi_', 'width', 'width_']);
    const isRight = numericAttr(attrs, ['isRight', 'isRight_']);
    const offsetDist = (Number.isFinite(x) && Number.isFinite(y))
      ? Math.hypot(x - cx, y - cy)
      : NaN;
    const key = `${Math.round(cx)}:${Math.round(cy)}`;
    const existing = centerAcc.get(key);
    if (existing) {
      existing.xSum += cx;
      existing.ySum += cy;
      existing.n += 1;
      if (Number.isFinite(width) && width > 0) {
        existing.widthSum += width;
        existing.widthN += 1;
      }
      if (Number.isFinite(offsetDist) && offsetDist > 0) {
        if (isRight === 1) {
          existing.rightMax = Math.max(existing.rightMax, offsetDist);
        } else {
          existing.leftMax = Math.max(existing.leftMax, offsetDist);
        }
      }
    } else {
      centerAcc.set(key, {
        xSum: cx,
        ySum: cy,
        n: 1,
        widthSum: Number.isFinite(width) && width > 0 ? width : 0,
        widthN: Number.isFinite(width) && width > 0 ? 1 : 0,
        leftMax: Number.isFinite(offsetDist) && offsetDist > 0 && isRight !== 1 ? offsetDist : 0,
        rightMax: Number.isFinite(offsetDist) && offsetDist > 0 && isRight === 1 ? offsetDist : 0,
      });
    }
  }

  if (!(Number.isFinite(minX) && Number.isFinite(maxX) && Number.isFinite(minY) && Number.isFinite(maxY))) {
    return null;
  }

  const centerline = Array.from(centerAcc.values()).map((entry) => {
    const xMean = entry.xSum / entry.n;
    const yMean = entry.ySum / entry.n;

    const widthFromBanks = entry.leftMax > 0 && entry.rightMax > 0
      ? entry.leftMax + entry.rightMax
      : (entry.leftMax > 0 || entry.rightMax > 0 ? 2 * Math.max(entry.leftMax, entry.rightMax) : NaN);

    const widthFromAttr = entry.widthN > 0 ? entry.widthSum / entry.widthN : NaN;
    const widthFinal = Number.isFinite(widthFromBanks) && widthFromBanks > 0
      ? widthFromBanks
      : (Number.isFinite(widthFromAttr) && widthFromAttr > 0 ? widthFromAttr : 220);

    return {
      x: xMean,
      y: yMean,
      width: widthFinal,
      s: 0,
    };
  });

  if (centerline.length < 16) {
    const fallbackCenterline = buildFallbackCenterlineFromPointCloud(bankPoints);
    if (!fallbackCenterline || fallbackCenterline.length < 16) return null;
    centerline.length = 0;
    centerline.push(...fallbackCenterline);
  }

  const pca = principalAxis2D(centerline);
  for (const point of centerline) {
    point.s = (point.x - pca.meanX) * pca.axisX + (point.y - pca.meanY) * pca.axisY;
  }
  centerline.sort((a, b) => a.s - b.s);

  // Smooth width fluctuations from noisy bank attributes.
  for (let i = 0; i < centerline.length; i++) {
    let w = 0;
    let n = 0;
    for (let k = -3; k <= 3; k++) {
      const idx = i + k;
      if (idx < 0 || idx >= centerline.length) continue;
      w += centerline[idx].width;
      n += 1;
    }
    centerline[i].width = n > 0 ? w / n : centerline[i].width;
  }

  return {
    bbox: { minX, maxX, minY, maxY },
    centerline,
    axisX: pca.axisX,
    axisY: pca.axisY,
    meanX: pca.meanX,
    meanY: pca.meanY,
  };
}

function buildFallbackCenterlineFromPointCloud(bankPoints) {
  const points = [];
  for (const point of bankPoints || []) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({ x, y });
  }
  if (points.length < 100) return null;

  const pca = principalAxis2D(points);
  const bins = clamp(Math.round(Math.sqrt(points.length) * 0.35), 24, 180);
  let sMin = Infinity;
  let sMax = -Infinity;
  const projected = [];

  for (const point of points) {
    const dx = point.x - pca.meanX;
    const dy = point.y - pca.meanY;
    const s = dx * pca.axisX + dy * pca.axisY;
    const t = -dx * pca.axisY + dy * pca.axisX;
    if (s < sMin) sMin = s;
    if (s > sMax) sMax = s;
    projected.push({ s, t });
  }

  if (!(sMax > sMin)) return null;
  const span = sMax - sMin;
  const accum = Array.from({ length: bins }, () => ({
    sSum: 0,
    tSum: 0,
    n: 0,
    tMin: Infinity,
    tMax: -Infinity,
  }));

  for (const point of projected) {
    const u = clamp((point.s - sMin) / span, 0, 1);
    const idx = Math.min(bins - 1, Math.floor(u * bins));
    const bin = accum[idx];
    bin.sSum += point.s;
    bin.tSum += point.t;
    bin.n += 1;
    if (point.t < bin.tMin) bin.tMin = point.t;
    if (point.t > bin.tMax) bin.tMax = point.t;
  }

  const centerline = [];
  for (const bin of accum) {
    if (bin.n < 3) continue;
    const s = bin.sSum / bin.n;
    const t = bin.tSum / bin.n;
    const width = Math.max(42, (bin.tMax - bin.tMin) * 1.15);
    const x = pca.meanX + pca.axisX * s - pca.axisY * t;
    const y = pca.meanY + pca.axisY * s + pca.axisX * t;
    centerline.push({ x, y, width, s });
  }

  if (centerline.length < 16) return null;
  centerline.sort((a, b) => a.s - b.s);
  return centerline;
}

function principalAxis2D(points) {
  let meanX = 0;
  let meanY = 0;
  for (const point of points) {
    meanX += point.x;
    meanY += point.y;
  }
  meanX /= points.length;
  meanY /= points.length;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= points.length;
  syy /= points.length;
  sxy /= points.length;

  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return {
    meanX,
    meanY,
    axisX: Math.cos(theta),
    axisY: Math.sin(theta),
  };
}

function sampleRiverEnvelope(envelope, x, y) {
  const s = (x - envelope.meanX) * envelope.axisX + (y - envelope.meanY) * envelope.axisY;
  const centers = envelope.centerline;
  if (centers.length === 0) return { inside: false, edgeFactor: 0 };

  const idx = lowerBoundCenterline(centers, s);
  let nearestDist2 = Infinity;
  let nearestHalfWidth = 0;

  const start = Math.max(0, idx - 8);
  const end = Math.min(centers.length - 1, idx + 8);
  for (let i = start; i <= end; i++) {
    const center = centers[i];
    const dx = x - center.x;
    const dy = y - center.y;
    const dist2 = dx * dx + dy * dy;
    if (dist2 < nearestDist2) {
      nearestDist2 = dist2;
      nearestHalfWidth = Math.max(14, center.width * 0.5);
    }
  }

  const dist = Math.sqrt(nearestDist2);
  const margin = 0;
  const inside = dist <= nearestHalfWidth + margin;
  const edgeFactor = clamp(1 - dist / Math.max(1, nearestHalfWidth), 0, 1);
  return { inside, edgeFactor };
}

function lowerBoundCenterline(sortedCenters, s) {
  let lo = 0;
  let hi = sortedCenters.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sortedCenters[mid].s < s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function buildSonarSpatialIndex(points, cellSize) {
  const buckets = new Map();
  const size = Math.max(30, cellSize);

  for (const point of points) {
    const ix = Math.floor(point.x / size);
    const iy = Math.floor(point.y / size);
    const key = `${ix},${iy}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(point);
    } else {
      buckets.set(key, [point]);
    }
  }

  return { buckets, cellSize: size };
}

function estimateDepthKnnKernel(index, x, y, maxDist, k = 24, minNeighbors = 8) {
  const size = index.cellSize;
  const baseX = Math.floor(x / size);
  const baseY = Math.floor(y / size);
  const maxRing = Math.max(1, Math.ceil(maxDist / size));
  const maxDist2 = maxDist * maxDist;
  const candidates = [];

  for (let ring = 0; ring <= maxRing; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const key = `${baseX + dx},${baseY + dy}`;
        const bucket = index.buckets.get(key);
        if (!bucket) continue;

        for (const point of bucket) {
          const ddx = point.x - x;
          const ddy = point.y - y;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 > maxDist2) continue;
          candidates.push({ depth: point.depth, d2 });
        }
      }
    }
    if (candidates.length >= k * 2 && ring >= 1) break;
  }

  if (candidates.length < minNeighbors) return null;
  candidates.sort((a, b) => a.d2 - b.d2);

  const neighborCount = Math.min(k, candidates.length);
  const neighbors = candidates.slice(0, neighborCount);
  const kthDist = Math.sqrt(neighbors[neighborCount - 1].d2);
  const bandwidth = Math.max(6, kthDist * 0.9);

  let weightedDepth = 0;
  let weightSum = 0;
  for (const candidate of neighbors) {
    const distance = Math.sqrt(candidate.d2);
    const gaussian = Math.exp(-0.5 * (distance / bandwidth) ** 2);
    const localDensity = 1 / (candidate.d2 + 25);
    const weight = gaussian * localDensity;
    weightedDepth += candidate.depth * weight;
    weightSum += weight;
  }

  if (weightSum <= 0) return null;
  return weightedDepth / weightSum;
}

function fillDepthHolesMasked(depthGrid, insideGrid, passes = 1) {
  const rows = depthGrid.length;
  const cols = depthGrid[0]?.length || 0;
  if (rows === 0 || cols === 0) return;

  for (let pass = 0; pass < passes; pass++) {
    const source = depthGrid.map((row) => row.slice());
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!insideGrid[r][c] || Number.isFinite(source[r][c])) continue;
        let sum = 0;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
            const val = source[rr][cc];
            if (!Number.isFinite(val)) continue;
            sum += val;
            n += 1;
          }
        }
        if (n >= 3) {
          depthGrid[r][c] = sum / n;
        }
      }
    }
  }
}

function smoothDepthGridMasked(depthGrid, insideGrid, passes = 1) {
  const rows = depthGrid.length;
  const cols = depthGrid[0]?.length || 0;
  if (rows === 0 || cols === 0) return;

  for (let pass = 0; pass < passes; pass++) {
    const source = depthGrid.map((row) => row.slice());
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!insideGrid[r][c]) continue;
        const center = source[r][c];
        if (!Number.isFinite(center)) continue;

        let sum = center * 0.5;
        let n = 0.5;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
            const val = source[rr][cc];
            if (!Number.isFinite(val)) continue;
            sum += val * 0.0625;
            n += 0.0625;
          }
        }
        depthGrid[r][c] = sum / n;
      }
    }
  }
}

function parseSonarPoints(rawPoints) {
  const out = [];
  for (const point of rawPoints) {
    if (!Array.isArray(point) || point.length < 3) continue;
    const x = Number(point[0]);
    const y = Number(point[1]);
    const depth = Number(point[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(depth)) continue;
    out.push({ x, y, depth });
  }
  return out;
}

function buildCrossSections(sections) {
  const group = new THREE.Group();

  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x8dd8ff, transparent: true, opacity: 0.72 });
  const curtainMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
  });
  const markerGeometry = new THREE.SphereGeometry(9, 16, 12);

  sections.forEach((section) => {
    if (!section.line?.has_geometry) return;

    const sx = Number(section.line.start_x) - worldCenter.x;
    const sz = Number(section.line.start_y) - worldCenter.y;
    const ex = Number(section.line.end_x) - worldCenter.x;
    const ez = Number(section.line.end_y) - worldCenter.y;

    const depthMean = section.mat_summary?.z_stats?.mean;
    const y = Number.isFinite(depthMean) ? depthMean * 0.08 : 0;

    const lineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(sx, y, sz),
      new THREE.Vector3(ex, y, ez),
    ]);

    const line = new THREE.Line(lineGeom, lineMaterial);
    group.add(line);

    const curtain = createCrossSectionCurtainMesh(section, sx, sz, ex, ez, y, curtainMaterial);
    if (curtain) {
      curtain.visible = showColoredCrossSections;
      curtainMeshes.push(curtain);
      group.add(curtain);
    }

    const cx = (sx + ex) / 2;
    const cz = (sz + ez) / 2;

    const markerMaterial = new THREE.MeshStandardMaterial({
      color: 0x56c3ff,
      emissive: 0x061d35,
      roughness: 0.45,
      metalness: 0.05,
    });

    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.set(cx, y + 5, cz);
    marker.userData = { section, objectType: 'cross-section-marker' };
    marker.name = section.mat_file || 'cross-section';

    clickableMarkers.push(marker);
    group.add(marker);
  });

  return group;
}

function buildRiverVideoIcons(bankPoints) {
  if (!Array.isArray(bankPoints) || bankPoints.length === 0) return null;
  if (TIMELAPSE_VIDEO_ASSETS.length === 0) return null;

  const coords = bankPoints
    .map((point) => ({
      x: Number(point?.x),
      y: Number(point?.y),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (coords.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of coords) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return null;
  }

  const group = new THREE.Group();
  const xSpan = Math.max(1, maxX - minX);
  const ySpan = Math.max(1, maxY - minY);
  const sideOffset = clamp(xSpan * 0.02, 16, 110);
  const iconHeight = clamp(ySpan * 0.005, 28, 48);
  const cameraCount = clamp(
    DEMO_RIVER_VIDEO_ICON_COUNT,
    Math.min(6, TIMELAPSE_VIDEO_ASSETS.length),
    48
  );

  for (let i = 0; i < cameraCount; i++) {
    const source = TIMELAPSE_VIDEO_ASSETS[i % TIMELAPSE_VIDEO_ASSETS.length];
    const sideSign = i % 2 === 0 ? 1 : -1;
    const t = (i + 1) / (cameraCount + 1);
    const yTarget = minY + ySpan * t;
    const anchor = pickRiverVideoAnchorPoint(coords, yTarget, minX, maxX, sideSign);
    if (!anchor) continue;

    const iconX = anchor.x - worldCenter.x + sideOffset * sideSign;
    const iconZ = anchor.y - worldCenter.y;
    const iconY = iconHeight;

    const videoBadge = createVideoBadgeSprite();
    videoBadge.position.set(iconX, iconY, iconZ);
    videoBadge.userData = {
      objectType: 'river-video-site',
      source,
      cameraIndex: i + 1,
    };
    videoBadge.name = `river-video-camera-${i + 1}`;
    riverVideoPickTargets.push(videoBadge);
    group.add(videoBadge);

    const stemGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(iconX, 2, iconZ),
      new THREE.Vector3(iconX, iconY - 8, iconZ),
    ]);
    const stemMaterial = new THREE.LineBasicMaterial({
      color: 0x63caff,
      transparent: true,
      opacity: 0.74,
    });
    const stem = new THREE.Line(stemGeometry, stemMaterial);
    group.add(stem);
  }

  return riverVideoPickTargets.length > 0 ? group : null;
}

function parseSedimentSamples(rawSamples) {
  if (!Array.isArray(rawSamples)) return [];

  const out = [];
  for (let i = 0; i < rawSamples.length; i++) {
    const sample = rawSamples[i];
    if (Array.isArray(sample) && sample.length >= 2) {
      const x = Number(sample[0]);
      const y = Number(sample[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      out.push({
        id: i + 1,
        x,
        y,
        date: '',
        description: '',
        grainSizeDistribution: [],
      });
      continue;
    }
    if (!sample || typeof sample !== 'object') continue;

    const x = firstFiniteNumberFromSample(sample, ['x', 'map_x', 'easting']);
    const y = firstFiniteNumberFromSample(sample, ['y', 'map_y', 'northing']);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    out.push({
      id: sample.id ?? (i + 1),
      x,
      y,
      date: String(sample.date || sample.sample_date || sample.collected_at || '').trim(),
      description: String(sample.description || sample.notes || sample.label || '').trim(),
      grainSizeDistribution: normalizeGrainSizeDistribution(sample.grain_size_distribution || sample.grainSizeDistribution),
    });
  }
  return out;
}

function firstFiniteNumberFromSample(sample, keys) {
  for (const key of keys) {
    const value = Number(sample?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return NaN;
}

function normalizeGrainSizeDistribution(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const size = Number(item.size ?? item.bin ?? item.class ?? item.diameter_mm);
    const pct = Number(item.percent ?? item.pct ?? item.fraction ?? item.value);
    if (!Number.isFinite(size) || !Number.isFinite(pct)) continue;
    out.push({ size, percent: pct });
  }
  return out.sort((a, b) => a.size - b.size);
}

function buildSedimentSampleLayer(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;

  const group = new THREE.Group();
  const markerGeometry = new THREE.SphereGeometry(7, 14, 10);
  const stemMaterial = new THREE.LineBasicMaterial({
    color: 0xe0c97a,
    transparent: true,
    opacity: 0.68,
  });

  for (const sample of samples) {
    const markerMaterial = new THREE.MeshStandardMaterial({
      color: 0xf8d371,
      emissive: 0x2a1d02,
      roughness: 0.45,
      metalness: 0.06,
    });

    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    const sx = Number(sample.x) - worldCenter.x;
    const sz = Number(sample.y) - worldCenter.y;
    marker.position.set(sx, 12, sz);
    marker.userData = { ...sample, objectType: 'sediment-sample' };
    marker.name = `sediment-sample-${sample.id}`;
    sedimentSamplePickTargets.push(marker);
    group.add(marker);

    const stemGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(sx, 1.5, sz),
      new THREE.Vector3(sx, 9, sz),
    ]);
    const stem = new THREE.Line(stemGeometry, stemMaterial);
    group.add(stem);
  }

  return group;
}

function pickRiverVideoAnchorPoint(points, yTarget, minX, maxX, sideSign) {
  let bestPoint = null;
  let bestScore = Infinity;

  for (const point of points) {
    const sideDistance = sideSign > 0 ? (maxX - point.x) : (point.x - minX);
    const yDistance = Math.abs(point.y - yTarget);
    const score = yDistance + sideDistance * 0.35;
    if (score < bestScore) {
      bestScore = score;
      bestPoint = point;
    }
  }

  return bestPoint;
}

function createVideoBadgeSprite() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallback = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x4ec4ff }));
    fallback.scale.set(28, 28, 1);
    fallback.renderOrder = 12;
    return fallback;
  }

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.34;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(52, 176, 236, 0.96)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(183, 234, 255, 0.9)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy - 16);
  ctx.lineTo(cx - 10, cy + 16);
  ctx.lineTo(cx + 17, cy);
  ctx.closePath();
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(30, 30, 1);
  sprite.renderOrder = 12;
  return sprite;
}

function createCrossSectionCurtainMesh(section, sx, sz, ex, ez, baseY, material) {
  const velocityGrid = section.mat_summary?.velocity?.sample;
  const maskGrid = section.mat_summary?.mask?.sample;

  if (
    !Array.isArray(velocityGrid) ||
    velocityGrid.length < 2 ||
    !Array.isArray(velocityGrid[0]) ||
    velocityGrid[0].length < 2
  ) {
    return null;
  }

  const rows = velocityGrid.length;
  const cols = velocityGrid[0].length;
  const lineLength = Math.hypot(ex - sx, ez - sz);
  const depthScale = clamp(lineLength * 0.58, 34, 180);
  const topY = baseY + 1.8;

  const bedRows = Array.from({ length: cols }, (_, c) => findBedRow(velocityGrid, maskGrid, c));
  const [vMin, vMax] = findVelocityRange(velocityGrid, maskGrid);

  const positions = new Float32Array(rows * cols * 3);
  const colors = new Float32Array(rows * cols * 3);
  const indices = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const p = idx * 3;

      const tAcross = cols === 1 ? 0 : c / (cols - 1);
      const x = sx + (ex - sx) * tAcross;
      const z = sz + (ez - sz) * tAcross;
      const bedRow = bedRows[c];
      const depthRow = Math.min(r, bedRow);
      const depthFrac = rows <= 1 ? 0 : depthRow / (rows - 1);
      const y = topY - depthFrac * depthScale;

      positions[p] = x;
      positions[p + 1] = y;
      positions[p + 2] = z;

      const v = Number(velocityGrid[r][c]);
      const wet = isWetCell(velocityGrid, maskGrid, r, c);
      if (!wet || !Number.isFinite(v)) {
        colors[p] = 0.12;
        colors[p + 1] = 0.45;
        colors[p + 2] = 0.6;
      } else {
        const [rr, gg, bb] = jetColorRgb((v - vMin) / (vMax - vMin || 1));
        colors[p] = rr;
        colors[p + 1] = gg;
        colors[p + 2] = bb;
      }
    }
  }

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = (r + 1) * cols + c;
      const e = d + 1;

      const qa = Math.min(r, bedRows[c]);
      const qb = Math.min(r, bedRows[c + 1]);
      const qd = Math.min(r + 1, bedRows[c]);
      const qe = Math.min(r + 1, bedRows[c + 1]);
      const hasArea = !(qa === qb && qb === qd && qd === qe);
      if (!hasArea) continue;

      indices.push(a, d, b);
      indices.push(b, d, e);
    }
  }

  if (indices.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  return mesh;
}

function findBedRow(velocityGrid, maskGrid, colIndex) {
  for (let r = velocityGrid.length - 1; r >= 0; r--) {
    if (isWetCell(velocityGrid, maskGrid, r, colIndex)) {
      return r;
    }
  }
  return 0;
}

function findVelocityRange(velocityGrid, maskGrid) {
  let vMin = Infinity;
  let vMax = -Infinity;

  for (let r = 0; r < velocityGrid.length; r++) {
    for (let c = 0; c < velocityGrid[0].length; c++) {
      const v = Number(velocityGrid[r][c]);
      if (!isWetCell(velocityGrid, maskGrid, r, c) || !Number.isFinite(v)) continue;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
  }

  if (!Number.isFinite(vMin) || !Number.isFinite(vMax)) return [0, 1];
  return [vMin, vMax];
}

function isWetCell(velocityGrid, maskGrid, row, col) {
  const mask = Number(maskGrid?.[row]?.[col]);
  if (Number.isFinite(mask)) return mask > 0.5;
  const v = Number(velocityGrid?.[row]?.[col]);
  return Number.isFinite(v) && v !== 0;
}

function jetColorRgb(t) {
  const tc = clamp(t, 0, 1);
  const r = clamp(1.5 - Math.abs(4 * tc - 3), 0, 1);
  const g = clamp(1.5 - Math.abs(4 * tc - 2), 0, 1);
  const b = clamp(1.5 - Math.abs(4 * tc - 1), 0, 1);
  return [r, g, b];
}

function onPointerDown(event) {
  if (measurementModeEnabled) {
    const point = projectPointerToMeasurementPlane(event);
    if (!point) return;
    beginMeasurementDrag(event, point);
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const pickTargets = [...clickableMarkers, ...riverVideoPickTargets, ...sedimentSamplePickTargets];
  if (bankMigrationArrowLayer) pickTargets.push(bankMigrationArrowLayer);
  const hits = raycaster.intersectObjects(pickTargets, false);

  if (hits.length === 0) {
    closeDetailsPanel();
    return;
  }

  const topHit = hits[0];
  if (topHit.object === bankMigrationArrowLayer) {
    if (renderMigrationArrowDetails(topHit)) {
      openDetailsPanel();
    }
    return;
  }

  const hit = topHit.object;
  const objectType = hit?.userData?.objectType;
  if (objectType === 'river-video-site') {
    if (renderRiverVideoDetails(hit.userData)) {
      openDetailsPanel();
    }
    return;
  }
  if (objectType === 'sediment-sample') {
    highlightMarker(hit);
    if (renderSedimentSampleDetails(hit.userData)) {
      openDetailsPanel();
    }
    return;
  }

  const section = hit.userData.section;
  if (!section) return;

  selectedSection = section;
  highlightMarker(hit);
  renderCrossSectionDetails(section);
  openDetailsPanel();
}

function onPointerMove(event) {
  if (!measurementDragActive) return;
  if (measurementPointerId !== null && event.pointerId !== measurementPointerId) return;

  const point = projectPointerToMeasurementPlane(event);
  if (!point) return;
  measurementEnd = point.clone();
  updateMeasurementLine();

  const distance = measurementStart.distanceTo(measurementEnd);
  showMeasurementReadout(event.clientX, event.clientY, `${formatNum(distance)} m`);
}

function onPointerUp(event) {
  if (!measurementDragActive) return;
  if (measurementPointerId !== null && event.pointerId !== measurementPointerId) return;

  measurementDragActive = false;
  measurementPointerId = null;
  controls.enabled = true;
  if (renderer.domElement.releasePointerCapture && Number.isFinite(event.pointerId)) {
    try {
      renderer.domElement.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore pointer-capture release errors.
    }
  }
  hideMeasurementReadout();

  const finalDistance = measurementStart && measurementEnd
    ? measurementStart.distanceTo(measurementEnd)
    : null;
  if (Number.isFinite(finalDistance) && measurementStart && measurementEnd) {
    if (finalDistance <= 0.01) {
      setStatus('Measurement was too short to save. Click and drag farther to measure.');
      return;
    }
    addMeasurementToSheet({
      distance: finalDistance,
      start: measurementStart,
      end: measurementEnd,
    });
    setStatus(`Measured distance: ${formatNum(finalDistance)} m (saved to sheet).`);
  }
}

function projectPointerToMeasurementPlane(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const planeY = getGroundReferenceY() + 2;
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
  const intersection = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, intersection)) {
    return null;
  }
  return intersection;
}

function beginMeasurementDrag(event, point) {
  measurementDragActive = true;
  measurementPointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
  measurementStart = point.clone();
  measurementEnd = point.clone();
  controls.enabled = false;
  updateMeasurementLine();

  if (renderer.domElement.setPointerCapture && measurementPointerId !== null) {
    try {
      renderer.domElement.setPointerCapture(measurementPointerId);
    } catch {
      // Ignore browsers that reject pointer capture for this event target.
    }
  }
}

function createMeasurementLine() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const material = new THREE.LineBasicMaterial({
    color: 0x67e8ff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const line = new THREE.Line(geometry, material);
  line.visible = false;
  line.renderOrder = 6;
  return line;
}

function updateMeasurementLine() {
  if (!measurementLine || !measurementStart || !measurementEnd) return;
  const lineY = getGroundReferenceY() + 3;
  const attr = measurementLine.geometry.getAttribute('position');
  const arr = attr.array;
  arr[0] = measurementStart.x;
  arr[1] = lineY;
  arr[2] = measurementStart.z;
  arr[3] = measurementEnd.x;
  arr[4] = lineY;
  arr[5] = measurementEnd.z;
  attr.needsUpdate = true;
  measurementLine.visible = true;
}

function clearMeasurementVisual() {
  measurementDragActive = false;
  measurementPointerId = null;
  measurementStart = null;
  measurementEnd = null;
  if (measurementLine) {
    measurementLine.visible = false;
  }
  hideMeasurementReadout();
}

function createPersistentMapMeasurementLine(row) {
  const lineY = getGroundReferenceY() + 3;
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(row.startX, lineY, row.startY),
    new THREE.Vector3(row.endX, lineY, row.endY),
  ]);
  const material = new THREE.LineBasicMaterial({
    color: 0x8cf6ff,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 7;
  return line;
}

function setMapMeasurementHighlight(id) {
  mapMeasurementSegments.forEach((segment) => {
    const isActive = Number(segment?.rowId) === Number(id);
    segment.mesh.material.color.setHex(isActive ? 0xffd166 : 0x8cf6ff);
    segment.mesh.material.opacity = isActive ? 0.98 : 0.88;
  });
}

function clearMapMeasurementSegments() {
  mapMeasurementSegments.forEach((segment) => {
    if (segment?.mesh && currentRiverGroup) {
      currentRiverGroup.remove(segment.mesh);
    }
  });
  mapMeasurementSegments = [];
}

function removeMapMeasurementSegmentById(id) {
  const target = mapMeasurementSegments.find((segment) => Number(segment.rowId) === Number(id));
  if (target?.mesh && currentRiverGroup) {
    currentRiverGroup.remove(target.mesh);
  }
  mapMeasurementSegments = mapMeasurementSegments.filter((segment) => Number(segment.rowId) !== Number(id));
}

function focusMapMeasurement(row) {
  if (!row) return;
  const center = new THREE.Vector3(
    (row.startX + row.endX) * 0.5,
    getGroundReferenceY() + 2.5,
    (row.startY + row.endY) * 0.5
  );
  controls.target.copy(center);
  camera.position.set(center.x + 230, center.y + 180, center.z + 230);
  controls.update();
  setMapMeasurementHighlight(row.id);
  setStatus(`Focused measurement ${row.id}.`);
}

function showMeasurementReadout(screenX, screenY, text) {
  if (!els.measureReadout) return;
  els.measureReadout.textContent = text;
  els.measureReadout.style.left = `${Math.round(screenX)}px`;
  els.measureReadout.style.top = `${Math.round(screenY)}px`;
  els.measureReadout.classList.remove('is-hidden');
}

function hideMeasurementReadout() {
  if (!els.measureReadout) return;
  els.measureReadout.classList.add('is-hidden');
}

function setMeasurementMode(enabled) {
  const next = Boolean(enabled);
  if (measurementModeEnabled === next) return;
  measurementModeEnabled = next;
  if (els.toolMeasureBtn) {
    els.toolMeasureBtn.classList.toggle('is-active', measurementModeEnabled);
  }

  if (!measurementModeEnabled) {
    controls.enabled = true;
    clearMeasurementVisual();
    return;
  }

  setStatus('Measurement mode enabled: click and drag on the map to measure distance.');
}

function renderMigrationArrowDetails(hit) {
  const arrowLayer = hit?.object;
  if (!arrowLayer) return false;

  const arrowData = Array.isArray(arrowLayer.userData?.arrowData) ? arrowLayer.userData.arrowData : [];
  if (arrowData.length === 0) return false;

  const segmentIndex = Number(hit?.index);
  if (!Number.isFinite(segmentIndex)) return false;

  // Each arrow contributes 3 line segments = 6 vertices in non-indexed geometry.
  const arrowIndex = Math.floor(segmentIndex / 6);
  const arrow = arrowData[arrowIndex];
  if (!arrow) return false;

  selectedSection = null;
  highlightMarker(null);
  destroyCrossSectionInteractivePlot();

  const heading = (Math.atan2(arrow.dispY, arrow.dispX) * 180) / Math.PI;
  const heading360 = (heading + 360) % 360;

  const rows = [
    ['Selection', `Migration arrow ${arrowIndex + 1}`],
    ['Magnitude', formatNum(arrow.magnitude)],
    ['disp_x', formatNum(arrow.dispX)],
    ['disp_y', formatNum(arrow.dispY)],
    ['Direction (deg from +X)', formatNum(heading360)],
    ['Source X', formatNum(arrow.rawX)],
    ['Source Y', formatNum(arrow.rawY)],
  ];

  els.details.innerHTML = rows
    .map(([label, value]) => `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`)
    .join('');
  return true;
}

function highlightMarker(active) {
  clickableMarkers.forEach((marker) => {
    marker.material.color.setHex(marker === active ? 0x8ce8ff : 0x56c3ff);
  });
  sedimentSamplePickTargets.forEach((marker) => {
    marker.material.color.setHex(marker === active ? 0xffefac : 0xf8d371);
  });
}

function renderRiverVideoDetails(videoSiteData) {
  const source = videoSiteData?.source;
  const title = String(source?.title || `River Camera ${videoSiteData?.cameraIndex || ''}`).trim();
  const url = String(source?.url || '').trim();

  selectedSection = null;
  highlightMarker(null);
  destroyCrossSectionInteractivePlot();

  const videoContent = url
    ? `
      <div class="cs-video-grid">
        <article class="cs-video-item">
          <video class="cs-video-player" controls autoplay muted loop preload="metadata" playsinline src="${escapeHtml(url)}"></video>
          <p class="cs-video-caption">Side-bank view of river channel flow and bank behavior.</p>
        </article>
      </div>
    `
    : '<p class="cs-empty">No video source is configured for this camera.</p>';

  els.details.innerHTML = `
    <div class="cross-section-workspace">
      <section class="cs-card cs-video-card">
        <div class="cs-card-head">
          <div>
            <h4 class="cs-card-title">River Timelapse Camera</h4>
            <p class="cs-card-subtitle">${escapeHtml(title)} - Side-of-river perspective</p>
          </div>
          <span class="cs-chip cs-chip-video">river-video</span>
        </div>
        ${videoContent}
      </section>
    </div>
  `;
  return true;
}

function renderSedimentSampleDetails(sampleData) {
  if (!sampleData) return false;

  selectedSection = null;
  destroyCrossSectionInteractivePlot();

  const grainPlot = buildSedimentGrainSizePlot(sampleData.grainSizeDistribution || []);
  const sampleDate = sampleData.date || 'NA';
  const sampleDescription = sampleData.description || 'No description provided.';

  els.details.innerHTML = `
    <div class="cross-section-workspace">
      <section class="cs-card cs-metrics-card">
        <div class="cs-card-head">
          <div>
            <h4 class="cs-card-title">Sediment Sample</h4>
            <p class="cs-card-subtitle">Sample ${escapeHtml(String(sampleData.id))}</p>
          </div>
          <span class="cs-chip">sediment</span>
        </div>
        <div class="cs-metrics-grid">
          <article class="cs-metric-card">
            <span class="cs-metric-label">Date</span>
            <strong class="cs-metric-value">${escapeHtml(sampleDate)}</strong>
          </article>
          <article class="cs-metric-card">
            <span class="cs-metric-label">Location (x, y)</span>
            <strong class="cs-metric-value">${escapeHtml(`${formatNum(sampleData.x)}, ${formatNum(sampleData.y)}`)}</strong>
          </article>
          <article class="cs-metric-card">
            <span class="cs-metric-label">Description</span>
            <strong class="cs-metric-value">${escapeHtml(sampleDescription)}</strong>
          </article>
        </div>
        <div style="margin-top:10px;">
          ${grainPlot}
        </div>
      </section>
    </div>
  `;
  return true;
}

function buildSedimentGrainSizePlot(distribution) {
  if (!Array.isArray(distribution) || distribution.length === 0) {
    return '<p class="cs-empty">No grain size distribution available for this sample.</p>';
  }

  const values = distribution
    .map((item) => ({
      size: Number(item.size),
      percent: Number(item.percent),
    }))
    .filter((item) => Number.isFinite(item.size) && Number.isFinite(item.percent));
  if (values.length === 0) {
    return '<p class="cs-empty">No grain size distribution available for this sample.</p>';
  }

  const maxPct = Math.max(...values.map((item) => item.percent), 1);
  const width = 560;
  const height = 220;
  const left = 42;
  const right = 20;
  const top = 20;
  const bottom = 28;
  const plotW = width - left - right;
  const plotH = height - top - bottom;

  const minSize = values[0].size;
  const maxSize = values[values.length - 1].size;
  const span = Math.max(1e-6, maxSize - minSize);

  const bars = values.map((item) => {
    const x = left + ((item.size - minSize) / span) * plotW;
    const barW = Math.max(2, plotW / Math.max(20, values.length * 1.5));
    const barH = (item.percent / maxPct) * plotH;
    const y = top + plotH - barH;
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${barH.toFixed(2)}" fill="#8fd6ff"></rect>`;
  }).join('');

  return `
    <div class="cs-profile-figure">
      <svg class="cs-profile-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Grain size distribution">
        <rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="rgba(5,21,39,0.55)" stroke="rgba(120,196,255,0.35)"></rect>
        ${bars}
        <text x="${left + plotW / 2}" y="${height - 6}" class="cs-profile-label" text-anchor="middle">Grain size class</text>
        <text x="8" y="${top + plotH / 2}" class="cs-profile-label">% Fraction</text>
      </svg>
    </div>
  `;
}

function renderCrossSectionDetails(section) {
  const stats = section.mat_summary?.velocity?.stats || {};
  const zStats = section.mat_summary?.z_stats || {};
  const velocityGrid = section.mat_summary?.velocity?.sample;
  const hasPlotData =
    Array.isArray(velocityGrid) &&
    velocityGrid.length > 0 &&
    Array.isArray(velocityGrid[0]) &&
    velocityGrid[0].length > 0;

  const sectionName = String(section?.transect || section?.mat_file || `XS-${String(section?.id || '')}`);
  const sectionSubtitle = String(section?.description || section?.date || 'Cross-section analysis');
  const noteValue = getCrossSectionNote(section);
  const noteLen = noteValue.trim().length;

  const rows = [
    ['MAT file', section.mat_file],
    ['Transect', section.transect],
    ['Date', section.date],
    ['Time (local)', section.time_local],
    ['Description', section.description],
    ['Discharge Q (m3/s)', formatNum(section.Q_m3s)],
    ['Top width T (m)', formatNum(section.T_m)],
    ['Mean velocity U (m/s)', formatNum(section.U_ms)],
    ['Velocity min/max (m/s)', `${formatNum(stats.min)} / ${formatNum(stats.max)}`],
    ['Velocity mean (m/s)', formatNum(stats.mean)],
    ['Bed min/max z', `${formatNum(zStats.min)} / ${formatNum(zStats.max)}`],
  ];

  const metricsHtml = rows
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([label, value]) => `
      <article class="cs-metric-card">
        <span class="cs-metric-label">${escapeHtml(label)}</span>
        <strong class="cs-metric-value">${escapeHtml(String(value))}</strong>
      </article>
    `)
    .join('');

  const profileMarkup = buildCrossSectionProfileMarkup(section);
  const addButtonHtml = `
    <div class="cross-section-actions">
      <button id="addSectionToSheetBtn" type="button">Add cross-section to sheet</button>
    </div>
  `;

  destroyCrossSectionInteractivePlot();
  els.details.innerHTML = `
    <div class="cross-section-workspace">
      <section class="cs-card cs-notes-card">
        <div class="cs-card-head">
          <div>
            <h4 class="cs-card-title">Cross-Section Notes</h4>
            <p class="cs-card-subtitle">${escapeHtml(sectionName)} - ${escapeHtml(sectionSubtitle)}</p>
          </div>
          <span class="cs-chip">field-notes</span>
        </div>
        <textarea
          id="crossSectionNotesInput"
          class="cs-notes-input"
          placeholder="Write observations, anomalies, and interpretation notes for this cross-section..."
        >${escapeHtml(noteValue)}</textarea>
        <p id="crossSectionNotesStatus" class="cs-note-status">${noteLen > 0 ? `${noteLen} chars saved` : 'No notes yet'}</p>
      </section>

      <section class="cs-card cs-profile-card">
        <div class="cs-card-head">
          <div>
            <h4 class="cs-card-title">Cross-Section Profile</h4>
            <p class="cs-card-subtitle">${escapeHtml(sectionName)} - River Bed Geometry</p>
          </div>
          <span class="cs-chip">velocity-cross</span>
        </div>
        ${profileMarkup}
      </section>

      <section class="cs-card cs-plot-card">
        <div class="cs-card-head">
          <div>
            <h4 class="cs-card-title">Lateral Velocity (m/s) vs Position (m)</h4>
            <p class="cs-card-subtitle">${escapeHtml(sectionName)} - Cross-section visualization</p>
          </div>
          <span class="cs-chip">interactive</span>
        </div>
        ${
          hasPlotData
            ? '<div class="cross-section-plot-wrap"><div id="crossSectionInteractiveMount"></div></div>'
            : '<p class="cs-empty">No gridded velocity data available for this section.</p>'
        }
      </section>

      <section class="cs-card cs-metrics-card">
        <div class="cs-card-head">
          <div>
            <h4 class="cs-card-title">Cross-Section Metadata</h4>
            <p class="cs-card-subtitle">Hydraulics and metadata aligned in one style</p>
          </div>
          <span class="cs-chip">metrics</span>
        </div>
        <div class="cs-metrics-grid">
          ${metricsHtml || '<p class="cs-empty">No details available for this section.</p>'}
        </div>
        ${addButtonHtml}
      </section>
    </div>
  `;

  if (hasPlotData) {
    const interactiveMount = document.getElementById('crossSectionInteractiveMount');
    if (interactiveMount) {
      mountCrossSectionInteractivePlot(interactiveMount, section, {
        onLayoutExpandChange: (nextExpanded) => {
          setMeasurementLayoutExpanded(nextExpanded);
        },
      });
    }
  }

  bindCrossSectionNotesInput(section);
  bindAddSectionToSheetButton(section);
}

function bindCrossSectionNotesInput(section) {
  const input = document.getElementById('crossSectionNotesInput');
  const statusEl = document.getElementById('crossSectionNotesStatus');
  if (!input) return;

  const sync = () => {
    setCrossSectionNote(section, input.value);
    const len = input.value.trim().length;
    if (statusEl) {
      statusEl.textContent = len > 0 ? `${len} chars saved` : 'No notes yet';
    }
  };

  input.addEventListener('input', sync);
}

function getCrossSectionNote(section) {
  const key = sectionSheetKey(section);
  return crossSectionNotesByKey.get(key) || '';
}

function setCrossSectionNote(section, noteText) {
  const key = sectionSheetKey(section);
  const raw = String(noteText ?? '');
  if (raw.trim().length === 0) {
    crossSectionNotesByKey.delete(key);
  } else {
    crossSectionNotesByKey.set(key, raw);
  }

  const sheetRow = sheetRows.find((row) => row.key === key);
  if (sheetRow) {
    sheetRow.note = raw.trim().length > 0 ? raw : '';
    renderSheetTable();
  }
}

function buildCrossSectionProfileMarkup(section) {
  const series = extractCrossSectionProfileSeries(section);
  if (!Array.isArray(series) || series.length < 2) {
    return '<p class="cs-empty">No profile geometry found for this cross-section.</p>';
  }

  const sorted = series.slice().sort((a, b) => a.x - b.x);
  const xMin = sorted[0].x;
  const xMax = sorted[sorted.length - 1].x;
  const xSpan = Math.max(1e-6, xMax - xMin);

  let zMin = Infinity;
  let zMax = -Infinity;
  for (const point of sorted) {
    if (!Number.isFinite(point.z)) continue;
    if (point.z < zMin) zMin = point.z;
    if (point.z > zMax) zMax = point.z;
  }
  if (!Number.isFinite(zMin) || !Number.isFinite(zMax)) {
    return '<p class="cs-empty">Profile values are present but not numeric.</p>';
  }
  const zSpan = Math.max(1e-6, zMax - zMin);

  const normalized = sorted.map((point) => ({
    x: clamp((point.x - xMin) / xSpan, 0, 1),
    d: clamp((point.z - zMin) / zSpan, 0, 1),
  }));
  normalized[0].d = 0;
  normalized[normalized.length - 1].d = 0;

  const svgW = 760;
  const svgH = 248;
  const chartLeft = 64;
  const chartRight = 56;
  const chartTop = 28;
  const chartBottom = 24;
  const plotW = svgW - chartLeft - chartRight;
  const plotH = svgH - chartTop - chartBottom;
  const waterY = chartTop + plotH * 0.34;
  const bedScale = Math.max(26, plotH * 0.58);

  const mapped = normalized.map((point) => ({
    x: chartLeft + point.x * plotW,
    y: waterY + point.d * bedScale,
  }));

  const fmt = (value) => Number(value).toFixed(2);
  const linePath = mapped
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${fmt(point.x)} ${fmt(point.y)}`)
    .join(' ');
  const fillPath = `M ${fmt(chartLeft)} ${fmt(waterY)} ${mapped.map((point) => `L ${fmt(point.x)} ${fmt(point.y)}`).join(' ')} L ${fmt(chartLeft + plotW)} ${fmt(waterY)} Z`;

  const deepestPoint = mapped.reduce((deepest, point) => (point.y > deepest.y ? point : deepest), mapped[0]);
  const widthFromLine =
    Number.isFinite(Number(section?.line?.start_x)) &&
    Number.isFinite(Number(section?.line?.start_y)) &&
    Number.isFinite(Number(section?.line?.end_x)) &&
    Number.isFinite(Number(section?.line?.end_y))
      ? Math.hypot(
          Number(section.line.end_x) - Number(section.line.start_x),
          Number(section.line.end_y) - Number(section.line.start_y)
        )
      : null;

  const zStatMax = Number(section?.mat_summary?.z_stats?.max);
  const zStatMin = Number(section?.mat_summary?.z_stats?.min);
  const zStatSpan = Number.isFinite(zStatMax) && Number.isFinite(zStatMin) ? Math.abs(zStatMax - zStatMin) : null;
  const widthMeters = firstFiniteNumber([Number(section?.T_m), xSpan > 1 ? xSpan : null, widthFromLine]);
  const depthMeters = firstFiniteNumber([
    Number.isFinite(zStatSpan) && zStatSpan > 0.01 ? zStatSpan : null,
    Number.isFinite(zStatMax) ? zStatMax : null,
    zSpan,
  ]);

  const widthLabel = Number.isFinite(widthMeters) ? `${formatCompactNum(widthMeters, 1)}m` : 'NA';
  const depthLabel = Number.isFinite(depthMeters) ? `${formatCompactNum(depthMeters, 1)}m` : 'NA';

  return `
    <div class="cs-profile-figure">
      <svg class="cs-profile-svg" viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="none" aria-label="Cross-section profile">
        <line x1="${fmt(chartLeft)}" y1="${fmt(waterY)}" x2="${fmt(chartLeft + plotW)}" y2="${fmt(waterY)}" class="cs-profile-waterline"></line>
        <path d="${fillPath}" class="cs-profile-fill"></path>
        <path d="${linePath}" class="cs-profile-line"></path>
        <line x1="${fmt(deepestPoint.x)}" y1="${fmt(waterY)}" x2="${fmt(deepestPoint.x)}" y2="${fmt(deepestPoint.y)}" class="cs-profile-depthline"></line>
        <line x1="${fmt(chartLeft + 4)}" y1="${fmt(chartTop + 14)}" x2="${fmt(chartLeft + plotW - 4)}" y2="${fmt(chartTop + 14)}" class="cs-profile-widthline"></line>
        <text x="${fmt(chartLeft + plotW * 0.5)}" y="${fmt(chartTop + 10)}" class="cs-profile-label" text-anchor="middle">Width: ${escapeHtml(widthLabel)}</text>
        <text x="${fmt(deepestPoint.x + 10)}" y="${fmt((waterY + deepestPoint.y) * 0.5)}" class="cs-profile-label">Depth: ${escapeHtml(depthLabel)}</text>
        <text x="${fmt(chartLeft + plotW + 8)}" y="${fmt(waterY + 4)}" class="cs-profile-water-label">Water</text>
      </svg>
    </div>
  `;
}

function extractCrossSectionProfileSeries(section) {
  const xinterp = Array.isArray(section?.mat_summary?.xinterp) ? section.mat_summary.xinterp : null;
  const zinterp = Array.isArray(section?.mat_summary?.zinterp) ? section.mat_summary.zinterp : null;

  if (xinterp && zinterp && xinterp.length === zinterp.length && xinterp.length >= 2) {
    const points = [];
    for (let i = 0; i < xinterp.length; i++) {
      const x = Number(xinterp[i]);
      const z = Number(zinterp[i]);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      points.push({ x, z });
    }
    if (points.length >= 2) return points;
  }

  return buildProfileSeriesFromVelocityMask(section);
}

function buildProfileSeriesFromVelocityMask(section) {
  const velocityGrid = section?.mat_summary?.velocity?.sample;
  const maskGrid = section?.mat_summary?.mask?.sample;
  if (
    !Array.isArray(velocityGrid) ||
    velocityGrid.length === 0 ||
    !Array.isArray(velocityGrid[0]) ||
    velocityGrid[0].length === 0
  ) {
    return null;
  }

  const rows = velocityGrid.length;
  const cols = velocityGrid[0].length;
  const points = [];

  for (let c = 0; c < cols; c++) {
    let bedRow = null;
    for (let r = rows - 1; r >= 0; r--) {
      if (isWetCell(velocityGrid, maskGrid, r, c)) {
        bedRow = r + 1;
        break;
      }
    }
    if (!Number.isFinite(bedRow)) continue;
    points.push({ x: c, z: bedRow / Math.max(1, rows) });
  }

  return points.length >= 2 ? points : null;
}

function firstFiniteNumber(values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function sectionSheetKey(section) {
  const idPart = section?.id ?? '';
  const filePart = section?.mat_file ?? '';
  return `${idPart}:${filePart}`;
}

function isSectionInSheet(section) {
  const key = sectionSheetKey(section);
  return sheetRows.some((row) => row.key === key);
}

function bindAddSectionToSheetButton(section) {
  const button = document.getElementById('addSectionToSheetBtn');
  if (!button) return;

  const alreadyAdded = isSectionInSheet(section);
  if (alreadyAdded) {
    button.disabled = true;
    button.textContent = 'Already in sheet';
    return;
  }

  button.disabled = false;
  button.textContent = 'Add cross-section to sheet';
  button.addEventListener('click', () => {
    addCrossSectionToSheet(section);
    button.disabled = true;
    button.textContent = 'Added to sheet';
  });
}

function addCrossSectionToSheet(section) {
  const key = sectionSheetKey(section);
  if (sheetRows.some((row) => row.key === key)) {
    setStatus('That cross-section is already in the sheet.');
    return;
  }

  const velocityStats = section?.mat_summary?.velocity?.stats || {};
  const zStats = section?.mat_summary?.z_stats || {};
  const notes = getCrossSectionNote(section);
  sheetRows.push({
    key,
    matFile: section?.mat_file || 'NA',
    transect: section?.transect || 'NA',
    date: section?.date || 'NA',
    timeLocal: section?.time_local || 'NA',
    q: section?.Q_m3s,
    topWidth: section?.T_m,
    meanVelocity: section?.U_ms,
    velocityMeanGrid: velocityStats?.mean,
    bedMean: zStats?.mean,
    note: notes || '',
  });

  renderSheetTable();
  setStatus(`Added ${section?.mat_file || `cross-section ${section?.id || ''}`} to sheet.`);
}

function renderSheetTable() {
  if (!els.sheetTableWrap || !els.measurementTableWrap) return;

  const rowCount = sheetRows.length;
  const measurementCount = measurementRows.length;
  const totalCount = rowCount + measurementCount;
  if (els.sheetCountBadge) {
    els.sheetCountBadge.textContent = String(totalCount);
  }

  if (rowCount === 0) {
    els.sheetTableWrap.innerHTML = '<p class="sheet-empty">Click a cross-section marker, then add it to the sheet.</p>';
  } else {
    const head = `
      <thead>
        <tr>
          <th>MAT file</th>
          <th>Transect</th>
          <th>Date</th>
          <th>Time</th>
          <th>Q (m3/s)</th>
          <th>T (m)</th>
          <th>U (m/s)</th>
          <th>Grid U mean (m/s)</th>
          <th>Bed mean z</th>
          <th>Notes</th>
        </tr>
      </thead>
    `;
    const body = sheetRows.map((row) => `
      <tr>
        <td>${escapeHtml(String(row.matFile))}</td>
        <td>${escapeHtml(String(row.transect))}</td>
        <td>${escapeHtml(String(row.date))}</td>
        <td>${escapeHtml(String(row.timeLocal))}</td>
        <td>${escapeHtml(formatNum(row.q))}</td>
        <td>${escapeHtml(formatNum(row.topWidth))}</td>
        <td>${escapeHtml(formatNum(row.meanVelocity))}</td>
        <td>${escapeHtml(formatNum(row.velocityMeanGrid))}</td>
        <td>${escapeHtml(formatNum(row.bedMean))}</td>
        <td>${escapeHtml(String(row.note || ''))}</td>
      </tr>
    `).join('');

    els.sheetTableWrap.innerHTML = `<table class="sheet-table">${head}<tbody>${body}</tbody></table>`;
  }

  if (measurementCount === 0) {
    setMapMeasurementHighlight(null);
    els.measurementTableWrap.innerHTML = '<p class="sheet-empty">Use the ruler tool, click-drag on the map, and each measurement is saved here.</p>';
    return;
  }

  const measurementHead = `
    <thead>
      <tr>
        <th>#</th>
        <th>Measured At</th>
        <th>Distance (m)</th>
        <th>disp_x</th>
        <th>disp_y</th>
        <th>Start (x, y)</th>
        <th>End (x, y)</th>
        <th>Actions</th>
      </tr>
    </thead>
  `;
  const measurementBody = measurementRows.map((row) => `
    <tr>
      <td>${escapeHtml(String(row.id))}</td>
      <td>${escapeHtml(String(row.measuredAt))}</td>
      <td>${escapeHtml(formatNum(row.distance))}</td>
      <td>${escapeHtml(formatNum(row.dispX))}</td>
      <td>${escapeHtml(formatNum(row.dispY))}</td>
      <td>${escapeHtml(`${formatNum(row.startX)}, ${formatNum(row.startY)}`)}</td>
      <td>${escapeHtml(`${formatNum(row.endX)}, ${formatNum(row.endY)}`)}</td>
      <td>
        <button type="button" class="inline-btn" data-measure-action="focus" data-measure-id="${row.id}">Focus</button>
        <button type="button" class="inline-btn" data-measure-action="delete" data-measure-id="${row.id}">Delete</button>
      </td>
    </tr>
  `).join('');

  els.measurementTableWrap.innerHTML = `<table class="sheet-table">${measurementHead}<tbody>${measurementBody}</tbody></table>`;
  els.measurementTableWrap.querySelectorAll('[data-measure-action]').forEach((button) => {
    const id = Number(button.getAttribute('data-measure-id'));
    const action = button.getAttribute('data-measure-action');
    button.addEventListener('click', () => {
      const row = measurementRows.find((item) => Number(item.id) === id);
      if (!row) return;
      if (action === 'delete') {
        deleteMapMeasurementRow(id);
      } else if (action === 'focus') {
        focusMapMeasurement(row);
      }
    });
  });
}

function setSheetPanelVisible(visible) {
  if (!els.sheetPanel) return;
  const nextVisible = Boolean(visible);
  els.sheetPanel.classList.toggle('is-hidden', !nextVisible);
  els.sheetPanel.setAttribute('aria-hidden', String(!nextVisible));
  if (els.toolSheetBtn) {
    els.toolSheetBtn.classList.toggle('is-active', nextVisible);
  }
}

function deleteMapMeasurementRow(id) {
  measurementRows = measurementRows.filter((row) => Number(row.id) !== Number(id));
  removeMapMeasurementSegmentById(id);
  renderSheetTable();
  setStatus(`Removed measurement ${id}.`);
}

function exportSheetTablesCsv() {
  if (measurementRows.length === 0 && sheetRows.length === 0) {
    setStatus('No rows to export yet.');
    return;
  }

  const head = measurementRows.length > 0
    ? ['id', 'measured_at', 'distance_m', 'disp_x', 'disp_y', 'start_x', 'start_y', 'end_x', 'end_y']
    : ['mat_file', 'transect', 'date', 'time_local', 'q_m3s', 'top_width_m', 'mean_velocity_ms', 'grid_u_mean_ms', 'bed_mean_z', 'note'];
  const rows = measurementRows.length > 0
    ? measurementRows.map((row) => [
      row.id,
      row.measuredAt,
      row.distance,
      row.dispX,
      row.dispY,
      row.startX,
      row.startY,
      row.endX,
      row.endY,
    ])
    : sheetRows.map((row) => [
      row.matFile,
      row.transect,
      row.date,
      row.timeLocal,
      row.q,
      row.topWidth,
      row.meanVelocity,
      row.velocityMeanGrid,
      row.bedMean,
      row.note || '',
    ]);
  const csv = [head, ...rows]
    .map((cells) => cells.map((value) => csvEscape(value)).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = measurementRows.length > 0 ? 'map_measurements.csv' : 'cross_sections.csv';
  link.click();
  URL.revokeObjectURL(link.href);
  setStatus(measurementRows.length > 0 ? 'Exported map measurements to CSV.' : 'Exported cross-sections to CSV.');
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function addMeasurementToSheet({ distance, start, end }) {
  if (!Number.isFinite(distance) || !start || !end) return;
  const dispX = end.x - start.x;
  const dispY = end.z - start.z;

  measurementRowSeq += 1;
  const row = {
    id: measurementRowSeq,
    measuredAt: new Date().toLocaleString(),
    distance,
    dispX,
    dispY,
    startX: start.x,
    startY: start.z,
    endX: end.x,
    endY: end.z,
  };
  measurementRows.push(row);

  if (currentRiverGroup) {
    const mesh = createPersistentMapMeasurementLine(row);
    currentRiverGroup.add(mesh);
    mapMeasurementSegments.push({ rowId: row.id, mesh });
    setMapMeasurementHighlight(row.id);
  }

  renderSheetTable();
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function percentile(values, q) {
  if (!Array.isArray(values) || values.length === 0) return NaN;
  const sorted = values
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];

  const qc = clamp(q, 0, 1);
  const pos = qc * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const t = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * t;
}

function openDetailsPanel() {
  els.detailsPanel.classList.remove('is-hidden');
  els.detailsPanel.setAttribute('aria-hidden', 'false');
  requestPlotRedraw();
}

function setMeasurementLayoutExpanded(nextExpanded) {
  const expanded = Boolean(nextExpanded);
  els.detailsPanel.classList.toggle('sidebar-measurements-expanded', expanded);

  if (!expanded) {
    els.detailsPanel.style.removeProperty('width');
  }

  if (window.matchMedia('(max-width: 980px)').matches) {
    return;
  }

  if (expanded) {
    const minWidth = 760;
    const maxWidth = Math.max(minWidth, Math.floor(window.innerWidth * 0.88));
    const targetWidth = clamp(Math.floor(window.innerWidth * 0.78), minWidth, maxWidth);
    els.detailsPanel.style.width = `${targetWidth}px`;
  }
}

function closeDetailsPanel() {
  els.detailsPanel.classList.add('is-hidden');
  els.detailsPanel.setAttribute('aria-hidden', 'true');
  setMeasurementLayoutExpanded(false);
  selectedSection = null;
  destroyCrossSectionInteractivePlot();
  highlightMarker(null);
}

function initSidebarResizer() {
  if (!els.sidebarResizer) return;

  let resizing = false;

  const onPointerMove = (event) => {
    if (!resizing) return;
    if (window.matchMedia('(max-width: 980px)').matches) return;

    const minWidth = 320;
    const maxWidth = Math.max(420, Math.floor(window.innerWidth * 0.72));
    const nextWidth = clamp(window.innerWidth - event.clientX, minWidth, maxWidth);
    els.detailsPanel.style.width = `${nextWidth}px`;
    requestPlotRedraw();
  };

  const onPointerUp = () => {
    if (!resizing) return;
    resizing = false;
    document.body.classList.remove('is-resizing-sidebar');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };

  els.sidebarResizer.addEventListener('pointerdown', (event) => {
    if (window.matchMedia('(max-width: 980px)').matches) return;
    event.preventDefault();
    resizing = true;
    document.body.classList.add('is-resizing-sidebar');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  });
}

function requestPlotRedraw() {
  if (!selectedSection) return;
  if (els.detailsPanel.classList.contains('is-hidden')) return;
  if (sidebarRedrawRaf) return;

  sidebarRedrawRaf = requestAnimationFrame(() => {
    sidebarRedrawRaf = 0;
    refreshCrossSectionInteractivePlot();
  });
}

function setCurtainVisibility(visible) {
  for (const mesh of curtainMeshes) {
    if (mesh) mesh.visible = visible;
  }
}

function fitCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = Math.max(600, maxDim * 1.2);

  camera.position.set(center.x + distance * 0.5, center.y + distance * 0.45, center.z + distance * 0.7);
  controls.target.copy(center);
  controls.update();
}

function updateGroundGridForRiver(object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.z);

  const targetSize = clamp(Math.ceil((span * 1.12) / 200) * 200, 2000, 140000);
  if (groundBasePlane) {
    disposeGroundBasePlane(groundBasePlane);
    scene.remove(groundBasePlane);
    groundBasePlane = null;
  }

  groundBasePlane = createGroundBasePlane({
    center,
    y: box.min.y - 2.35,
    size: targetSize,
  });
  scene.add(groundBasePlane);
}

function getGroundReferenceY() {
  return Number.isFinite(groundBasePlane?.position?.y)
    ? groundBasePlane.position.y
    : -1.35;
}

function createGroundBasePlane({ center, y, size }) {
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0x0f2b47,
    roughness: 0.98,
    metalness: 0.0,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(center.x, y, center.z);
  mesh.renderOrder = -4;
  return mesh;
}

function disposeGroundBasePlane(plane) {
  plane.geometry?.dispose?.();
  const materials = Array.isArray(plane.material) ? plane.material : [plane.material];
  for (const material of materials) {
    if (!material) continue;
    material.dispose?.();
  }
}

function resetCamera() {
  if (!currentRiverGroup) return;
  fitCameraToObject(currentRiverGroup);
}

function onResize() {
  const width = els.sceneWrap.clientWidth;
  const height = els.sceneWrap.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  requestPlotRedraw();
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  updateKeyboardNavigation(delta);
  controls.update();
  renderer.render(scene, camera);
}

function setStatus(text) {
  els.status.textContent = text;
}

function onKeyDown(event) {
  if (!keyNavEnabled) return;
  if (isTypingContext(event.target)) return;

  if (event.key === 'Shift') {
    keyState.Shift = true;
    return;
  }

  if (!(event.key in keyState)) return;
  keyState[event.key] = true;
  event.preventDefault();
}

function onKeyUp(event) {
  if (event.key === 'Shift') {
    keyState.Shift = false;
    return;
  }

  if (!(event.key in keyState)) return;
  keyState[event.key] = false;
}

function updateKeyboardNavigation(deltaSeconds) {
  if (!keyNavEnabled) return;
  if (!(keyState.ArrowUp || keyState.ArrowDown || keyState.ArrowLeft || keyState.ArrowRight)) return;

  const toCamera = new THREE.Vector3().subVectors(camera.position, controls.target);
  const distance = toCamera.length();
  const speed = clamp(distance * (keyState.Shift ? 2.2 : 1.1), 28, 1700);
  const step = speed * deltaSeconds;

  const forward = new THREE.Vector3(-toCamera.x, 0, -toCamera.z);
  if (forward.lengthSq() < 1e-6) {
    forward.set(0, 0, -1);
  } else {
    forward.normalize();
  }

  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const move = new THREE.Vector3();

  if (keyState.ArrowUp) move.add(forward);
  if (keyState.ArrowDown) move.sub(forward);
  if (keyState.ArrowRight) move.add(right);
  if (keyState.ArrowLeft) move.sub(right);

  if (move.lengthSq() === 0) return;
  move.normalize().multiplyScalar(step);

  camera.position.add(move);
  controls.target.add(move);
}

function isTypingContext(target) {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName;
  if (target.isContentEditable) return true;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return true;
  return false;
}

function numericAttr(attrs, keys) {
  for (const key of keys) {
    if (attrs[key] !== undefined && attrs[key] !== null && Number.isFinite(Number(attrs[key]))) {
      return Number(attrs[key]);
    }
  }
  return null;
}

function formatNum(value) {
  if (!Number.isFinite(Number(value))) return 'NA';
  return Number(value).toFixed(3);
}

function formatCompactNum(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'NA';
  return numeric.toFixed(digits);
}

function meanOrZero(a, b) {
  const av = Number(a);
  const bv = Number(b);
  if (Number.isFinite(av) && Number.isFinite(bv)) return (av + bv) / 2;
  return 0;
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
