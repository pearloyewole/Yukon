import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const DEFAULT_PACKAGE_URL = '/river-packages/huslia.json';

const els = {
  sceneWrap: document.getElementById('scene'),
  riverName: document.getElementById('riverName'),
  status: document.getElementById('statusText'),
  counts: document.getElementById('counts'),
  details: document.getElementById('crossSectionDetails'),
  packageFile: document.getElementById('packageFile'),
  resetView: document.getElementById('resetView'),
};

let scene;
let camera;
let renderer;
let controls;
let raycaster;
let mouse;

let clickableMarkers = [];
let currentRiverGroup = null;
let worldCenter = { x: 0, y: 0 };

initScene();
setupUiEvents();
loadPackageFromUrl(DEFAULT_PACKAGE_URL).catch((err) => {
  setStatus(`Failed to load default package: ${err.message}`);
});
animate();

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060b11);

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

  const hemi = new THREE.HemisphereLight(0xaad3ff, 0x0a1018, 0.85);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(450, 800, 300);
  scene.add(dir);

  const grid = new THREE.GridHelper(6000, 60, 0x2a3d50, 0x142233);
  grid.position.y = -1;
  scene.add(grid);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('resize', onResize);
}

function setupUiEvents() {
  els.resetView.addEventListener('click', () => {
    resetCamera();
  });

  els.packageFile.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setStatus(`Loading ${file.name}...`);
      const text = await file.text();
      const data = JSON.parse(text);
      loadPackage(data);
      setStatus(`Loaded ${file.name}`);
    } catch (err) {
      setStatus(`Failed to load local package: ${err.message}`);
    }
  });
}

async function loadPackageFromUrl(url) {
  setStatus(`Fetching ${url}...`);
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  loadPackage(data);
  setStatus(`Loaded ${url}`);
}

function loadPackage(data) {
  if (!data || !data.river_banks || !Array.isArray(data.river_banks.points)) {
    throw new Error('Invalid package: missing river_banks.points');
  }

  if (currentRiverGroup) {
    scene.remove(currentRiverGroup);
  }

  currentRiverGroup = new THREE.Group();
  clickableMarkers = [];

  const bbox = data.river_banks.bbox || {};
  worldCenter = {
    x: meanOrZero(bbox.min_x, bbox.max_x),
    y: meanOrZero(bbox.min_y, bbox.max_y),
  };

  const bankPoints = data.river_banks.points;
  const bankPointCloud = buildBankPointCloud(bankPoints);
  currentRiverGroup.add(bankPointCloud);

  const crossSectionGroup = buildCrossSections(data.cross_sections || []);
  currentRiverGroup.add(crossSectionGroup);

  scene.add(currentRiverGroup);

  const riverName = data.river_id || 'unknown-river';
  const sectionCount = (data.cross_sections || []).length;
  const mappedCount = (data.cross_sections || []).filter((s) => s.line?.has_geometry).length;

  els.riverName.textContent = riverName;
  els.counts.textContent = `${bankPoints.length.toLocaleString()} bank points, ${mappedCount}/${sectionCount} mapped cross-sections`;
  els.details.innerHTML = '<p>Click a cross-section marker to inspect metadata and flow/depth summary.</p>';

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

    const color = new THREE.Color(
      isOuter === 1 ? 0xf77474 : 0x67b6ff
    );
    if (isErosion === 1) {
      color.offsetHSL(0.02, 0.0, 0.05);
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

function buildCrossSections(sections) {
  const group = new THREE.Group();

  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.6 });
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

    const cx = (sx + ex) / 2;
    const cz = (sz + ez) / 2;

    const markerMaterial = new THREE.MeshStandardMaterial({
      color: 0xffc74f,
      emissive: 0x241a07,
      roughness: 0.45,
      metalness: 0.05,
    });

    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.set(cx, y + 5, cz);
    marker.userData = { section };
    marker.name = section.mat_file || 'cross-section';

    clickableMarkers.push(marker);
    group.add(marker);
  });

  return group;
}

function onPointerDown(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(clickableMarkers, false);

  if (hits.length === 0) return;

  const hit = hits[0].object;
  const section = hit.userData.section;
  if (!section) return;

  highlightMarker(hit);
  renderCrossSectionDetails(section);
}

function highlightMarker(active) {
  clickableMarkers.forEach((marker) => {
    marker.material.color.setHex(marker === active ? 0xff8f2e : 0xffc74f);
  });
}

function renderCrossSectionDetails(section) {
  const stats = section.mat_summary?.velocity?.stats || {};
  const zStats = section.mat_summary?.z_stats || {};

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

  const html = rows
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([label, value]) => `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`)
    .join('');

  els.details.innerHTML = html || '<p>No details available for this section.</p>';
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
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function setStatus(text) {
  els.status.textContent = text;
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
