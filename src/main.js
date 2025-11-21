import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildParticleSystem, updateParticles } from './particles.jsx';

// ---------- CONFIG ----------

const CSV_FOLDER = 'cross_section_csvs';
const NUM_SLICES = 16;      // how many stations you exported
const SLICE_SPACING = 15;   // distance between slices along flow (x)
const DOWNSAMPLE = 2;       // 1 = full, 2 = every 2nd cell

// ----------------------------

let scene, camera, renderer, controls;
let crossSectionMeshes = []; // Store references to cross-section meshes for click detection
let crossSectionData = []; // Store velocity data for each cross-section

init();
loadAndBuild().catch(err => console.error(err));
animate();

// ---------- CORE SETUP ----------

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);
  // Flip scene vertically (top becomes bottom)
  scene.scale.y = -1;

  const width = window.innerWidth;
  const height = window.innerHeight;

  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.set(60, 40, 80);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // Add click detection for cross-sections
  renderer.domElement.addEventListener('click', onCrossSectionClick);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 0.9);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(50, 80, 40);
  scene.add(dir);

  // Grid removed for cleaner view
  // const gridHelper = new THREE.GridHelper(200, 20, 0x444444, 0x222222);
  // gridHelper.position.y = -5;
  // scene.add(gridHelper);

  window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
    camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = 0.016; // Approximate 60fps
  
  // Update particles
  updateParticles(dt, colorForVelocity);

  // Update connector line if plot is visible
  updateConnectorLine();

  controls.update();
  renderer.render(scene, camera);
}

function updateConnectorLine() {
  const modal = document.getElementById('plot-modal');
  const connector = document.getElementById('plot-connector');
  
  if (!modal || !connector || modal.style.display === 'none') {
    if (connector) connector.style.display = 'none';
    return;
  }
  
  // Get the stored intersection point from the modal
  const intersectionPoint = modal.userData?.intersectionPoint;
  if (!intersectionPoint) return;
  
  // Get plot position (center top of modal)
  const rect = modal.getBoundingClientRect();
  const plotX = rect.left + rect.width / 2;
  const plotY = rect.top;
  
  drawConnectorLine(connector, intersectionPoint, plotX, plotY);
}

// ---------- DATA HELPERS ----------

async function loadCsvGrid(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  const rows = text.trim().split(/\r?\n/);

  const grid = rows.map(row =>
      row
        .split(/[,;\s]+/)
      .filter(s => s.length > 0)
      .map(v => {
          const n = Number(v);
          return Number.isFinite(n) ? n : NaN;
        })
    );
  return grid;
}

function getMinMax(grid) {
  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const v = grid[r][c];
      if (Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  return { min, max };
}

function downsampleGrid(grid, factor) {
  if (factor <= 1) return grid;
  const rows = grid.length;
  const cols = grid[0].length;
  const ds = [];
  for (let r = 0; r < rows; r += factor) {
    const row = [];
    for (let c = 0; c < cols; c += factor) {
      row.push(grid[r][c]);
    }
    ds.push(row);
  }
  return ds;
}

// Velocity color (river water) - rainbow palette: blue (slow) -> red (fast)
function colorForVelocity(v, min, max) {
  // if velocity is NaN but inside the river, just clamp to min
  if (!Number.isFinite(v)) v = min;

  const t = (v - min) / (max - min || 1); // 0..1
  const hue = (1 - t) * 0.65; // blue (0.65) -> red (0) as velocity increases
  const color = new THREE.Color();
  color.setHSL(hue, 1.0, 0.5);
  return color;
}

// Rock color (banks / outside channel)
function rockColor() {
  // slightly varied rock color using a bit of randomness
  const base = new THREE.Color(0x777777);
  const hsl = {};
  base.getHSL(hsl);
  const jitter = (Math.random() - 0.5) * 0.08;
  const color = new THREE.Color();
  color.setHSL(hsl.h + jitter, hsl.s * 0.6, hsl.l * 0.8);
  return color;
}

// ---------- BUILD ----------

async function loadAndBuild() {
  const sliceVelocityGrids = [];
  const sliceMaskGrids = [];

  // Load velocity + mask for each slice
  for (let i = 1; i <= NUM_SLICES; i++) {
    const indexStr = String(i).padStart(2, '0');
    const qUrl = `${CSV_FOLDER}/huslia_Qgrid_${indexStr}.csv`;
    const mUrl = `${CSV_FOLDER}/huslia_mask_${indexStr}.csv`;

    try {
      const [qGrid, mGrid] = await Promise.all([
        loadCsvGrid(qUrl),
        loadCsvGrid(mUrl)
      ]);

      if (qGrid.length && mGrid.length) {
        sliceVelocityGrids.push(qGrid);
        sliceMaskGrids.push(mGrid);
        console.log(`Loaded slice ${i}`);
      } else {
        console.warn(`Slice ${i} has empty grid(s)`);
      }
    } catch (err) {
      console.warn(`Skipping slice ${i}: ${err.message}`);
    }
  }

  if (!sliceVelocityGrids.length) {
    console.error('No slices loaded — check paths/filenames.');
    return;
  }

  // Global min/max for consistent velocity color scale
  let globalMin = Infinity;
  let globalMax = -Infinity;
  for (const g of sliceVelocityGrids) {
    const { min, max } = getMinMax(g);
    if (min < globalMin) globalMin = min;
    if (max > globalMax) globalMax = max;
  }

  // Visual dimensions
  const baseSliceWidth = 40;   // base width for scaling
  const sliceHeight = 20;  // vertical
  
  // Calculate actual widths for each slice
  const sliceWidths = [];
  sliceVelocityGrids.forEach((velGrid, idx) => {
    const maskGrid = sliceMaskGrids[idx];
    const dsMask = downsampleGrid(maskGrid, DOWNSAMPLE);
    const cols = dsMask[0].length;
    
    // Find the actual water channel width for this slice
    let minWaterCol = cols;
    let maxWaterCol = -1;
    
    for (let r = 0; r < dsMask.length; r++) {
      for (let c = 0; c < cols; c++) {
        if (dsMask[r][c] > 0.5) {
          if (c < minWaterCol) minWaterCol = c;
          if (c > maxWaterCol) maxWaterCol = c;
        }
      }
    }
    
    // Calculate actual width as fraction of total columns
    const actualWidthFrac = maxWaterCol >= minWaterCol ? (maxWaterCol - minWaterCol + 1) / cols : 1.0;
    const actualWidth = baseSliceWidth * actualWidthFrac;
    sliceWidths.push(actualWidth);
  });

  sliceVelocityGrids.forEach((velGrid, idx) => {
    const maskGrid = sliceMaskGrids[idx];

    const dsVel = downsampleGrid(velGrid, DOWNSAMPLE);
    const dsMask = downsampleGrid(maskGrid, DOWNSAMPLE);

    const rows = dsVel.length;
    const cols = dsVel[0].length;
    const sliceWidth = sliceWidths[idx]; // Use actual width for this slice

    // Create separate geometry for just the water portions
    const waterVertices = [];
    const waterColors = [];
    const waterIndices = [];
    let vertexIndex = 0;

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        // Check if this quad has any water
        const hasWater = 
          (Number.isFinite(dsMask[r][c]) && dsMask[r][c] > 0.5) ||
          (Number.isFinite(dsMask[r][c + 1]) && dsMask[r][c + 1] > 0.5) ||
          (Number.isFinite(dsMask[r + 1][c]) && dsMask[r + 1][c] > 0.5) ||
          (Number.isFinite(dsMask[r + 1][c + 1]) && dsMask[r + 1][c + 1] > 0.5);

        if (hasWater) {
          // Calculate positions for this quad
          const positions = [];
          const colors = [];
          
          for (let dr = 0; dr <= 1; dr++) {
            for (let dc = 0; dc <= 1; dc++) {
              const rr = r + dr;
              const cc = c + dc;
              
              // Position
              const xFrac = cc / (cols - 1);
              const yFrac = (rows - 1 - rr) / (rows - 1); // Flip vertically
              const x = (xFrac - 0.5) * sliceWidth;
              const y = (yFrac - 0.5) * sliceHeight;
              
              positions.push(x, y, 0);
              
              // Color
              const m = dsMask[rr][cc];
              const v = dsVel[rr][cc];
        let col;
        if (Number.isFinite(m) && m > 0.5) {
          col = colorForVelocity(v, globalMin, globalMax);
              } else {
                col = new THREE.Color(0x555555); // Darker gray for edges
              }
              colors.push(col.r, col.g, col.b);
            }
          }
          
          // Add vertices
          waterVertices.push(...positions);
          waterColors.push(...colors);
          
          // Add indices for two triangles
          const i0 = vertexIndex;
          const i1 = vertexIndex + 1;
          const i2 = vertexIndex + 2;
          const i3 = vertexIndex + 3;
          
          waterIndices.push(i0, i2, i1);
          waterIndices.push(i1, i2, i3);
          
          vertexIndex += 4;
        }
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(waterVertices, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(waterColors, 3));
    geom.setIndex(waterIndices);
    geom.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geom, mat);

    // Make plane vertical & perpendicular to flow (flow along x)
    mesh.rotation.y = Math.PI / 2;
    
    // Flip upside down by rotating 180 degrees around X
    mesh.rotation.x = Math.PI;

    // Position along x (flow direction)
    mesh.position.x =
      (idx - sliceVelocityGrids.length / 2) * SLICE_SPACING;
    
    // All slices at same height
    mesh.position.y = 5;
    
    // Store mesh and data for click detection
    mesh.userData.sliceIndex = idx;
    mesh.userData.velocityData = dsVel;
    mesh.userData.maskData = dsMask;
    crossSectionMeshes.push(mesh);
    crossSectionData.push({ vel: dsVel, mask: dsMask, idx });

    scene.add(mesh);
  });

  // Build river boundary walls connecting the cross-sections (with cutouts)
  buildRiverBoundary(sliceVelocityGrids, sliceMaskGrids, sliceWidths, sliceHeight);

  // Add particle system for flow visualization
  buildParticleSystem(
    sliceVelocityGrids, 
    sliceMaskGrids, 
    sliceWidths, 
    sliceHeight,
    scene,
    {
      DOWNSAMPLE,
      SLICE_SPACING,
      colorForVelocity,
      downsampleGrid
    }
  );

  // Add legends, markers, and annotations
  // Use max width for positioning markers
  const maxSliceWidth = Math.max(...sliceWidths);
  addLegendsAndMarkers(sliceVelocityGrids, maxSliceWidth, sliceHeight);

  console.log('Finished building river slices with rock boundaries.');
}

// ---------- RIVER BOUNDARY WALLS ----------

function buildRiverBoundary(velSlices, maskSlices, sliceWidths, sliceHeight) {
  const boundaryPoints = [];
  const slicePositions = [];
  const sliceCenterY = 5;
  const staircaseStep = 0; // No staircase - all at same level

  // First pass: find the common Y levels across all slices
  const allYLevels = new Set();
  for (let sliceIndex = 0; sliceIndex < velSlices.length; sliceIndex++) {
    const maskGrid = downsampleGrid(maskSlices[sliceIndex], DOWNSAMPLE);
    if (!maskGrid.length || !maskGrid[0] || !maskGrid[0].length) continue;
    
    const rows = maskGrid.length;
    for (let r = 0; r < rows; r++) {
      // Try without flip - CSV might be ordered top to bottom
      const yFrac = r / (rows - 1); // No flip - row 0 = top, row (rows-1) = bottom
      const y = sliceCenterY + (yFrac - 0.5) * sliceHeight;
      allYLevels.add(y);
    }
  }
  
  // Convert to sorted array for consistent sampling
  const sortedYLevels = Array.from(allYLevels).sort((a, b) => a - b);
  const numYLevels = sortedYLevels.length;
  
  if (numYLevels < 2) return;

  // Extract boundary points at consistent Y levels for each slice
  for (let sliceIndex = 0; sliceIndex < velSlices.length; sliceIndex++) {
    const maskGrid = downsampleGrid(maskSlices[sliceIndex], DOWNSAMPLE);
    
    if (!maskGrid.length || !maskGrid[0] || !maskGrid[0].length) {
      continue;
    }
    
    const rows = maskGrid.length;
    const cols = maskGrid[0].length;
    const xPos = (sliceIndex - velSlices.length / 2) * SLICE_SPACING;
    slicePositions.push(xPos);
    
    const leftBank = [];
    const rightBank = [];
    
    // For each consistent Y level, find the boundary
    for (let yLevel of sortedYLevels) {
      // Find which row in this slice corresponds to this Y level
      // Try without flip - CSV might be ordered top to bottom
      let closestRow = 0;
      let minDiff = Infinity;
      for (let r = 0; r < rows; r++) {
        const yFrac = r / (rows - 1); // No flip - row 0 = top, row (rows-1) = bottom
        const y = sliceCenterY + (yFrac - 0.5) * sliceHeight;
        const diff = Math.abs(y - yLevel);
        if (diff < minDiff) {
          minDiff = diff;
          closestRow = r;
        }
      }
      
      // Find left bank at this row - find the leftmost water cell
      let leftC = 0;
      let foundLeft = false;
      for (let c = 0; c < cols; c++) {
        if (maskGrid[closestRow][c] > 0.5) {
          leftC = c;
          foundLeft = true;
          break;
        }
      }
      if (!foundLeft) {
        leftC = 0;
      }
      
      // Find right bank at this row - find the rightmost water cell
      let rightC = cols - 1;
      let foundRight = false;
      for (let c = cols - 1; c >= 0; c--) {
        if (maskGrid[closestRow][c] > 0.5) {
          rightC = c;
          foundRight = true;
          break;
        }
      }
      if (!foundRight) {
        rightC = cols - 1;
      }
      
      // Convert column indices to Z coordinates matching cross-section geometry
      // Use the actual width for this slice
      const sliceWidth = sliceWidths[sliceIndex];
      // Cross-section uses: x = (xFrac - 0.5) * sliceWidth where xFrac = cc / (cols - 1)
      // After rotation.y = PI/2 and rotation.x = PI, local X becomes world -Z
      // So we need to negate the coordinate to match
      const leftFrac = leftC / (cols - 1);
      const rightFrac = rightC / (cols - 1);
      const leftZ = -((leftFrac - 0.5) * sliceWidth);  // Negate to match cross-section
      const rightZ = -((rightFrac - 0.5) * sliceWidth); // Negate to match cross-section
      
      // Use yLevel directly - it should match cross-section Y coordinates
      leftBank.push({ z: leftZ, y: yLevel });
      rightBank.push({ z: rightZ, y: yLevel });
    }
    
    boundaryPoints.push({ left: leftBank, right: rightBank });
  }

  // Build left and right bank surfaces
  if (boundaryPoints.length >= 2) {
    buildBankSurface(boundaryPoints, slicePositions, 'left', numYLevels);
    buildBankSurface(boundaryPoints, slicePositions, 'right', numYLevels);
  }
}

function buildBankSurface(boundaryPoints, slicePositions, side, numYLevels) {
  const bankKey = side === 'left' ? 'left' : 'right';
  const numSlices = boundaryPoints.length;
  
  if (numSlices < 2 || numYLevels < 2) return;
  
  const vertices = [];
  const indices = [];
  
  // Create vertex array - but only connect BETWEEN slices, not at slice positions
  // This creates cutouts for the cross-sections
  for (let sliceIdx = 0; sliceIdx < numSlices; sliceIdx++) {
    const x = slicePositions[sliceIdx];
    const bankPoints = boundaryPoints[sliceIdx][bankKey];
    
    // All slices should have the same number of points now
    // Mirror horizontally by negating Z coordinates
    for (let rowIdx = 0; rowIdx < numYLevels; rowIdx++) {
      if (rowIdx < bankPoints.length) {
        vertices.push(x, bankPoints[rowIdx].y, -bankPoints[rowIdx].z);
      } else {
        // Fallback if somehow we don't have enough points
        const lastPoint = bankPoints[bankPoints.length - 1];
        vertices.push(x, lastPoint.y, -lastPoint.z);
      }
    }
  }
  
  // Create indices for triangles connecting adjacent slices
  // Only connect between slices, leaving gaps at slice positions
  for (let sliceIdx = 0; sliceIdx < numSlices - 1; sliceIdx++) {
    for (let rowIdx = 0; rowIdx < numYLevels - 1; rowIdx++) {
      const i0 = sliceIdx * numYLevels + rowIdx;
      const i1 = sliceIdx * numYLevels + (rowIdx + 1);
      const i2 = (sliceIdx + 1) * numYLevels + rowIdx;
      const i3 = (sliceIdx + 1) * numYLevels + (rowIdx + 1);
      
      // Two triangles per quad
      if (side === 'left') {
        // Left bank faces inward (toward positive Z)
        indices.push(i0, i1, i2);
        indices.push(i1, i3, i2);
      } else {
        // Right bank faces inward (toward negative Z)
        indices.push(i0, i2, i1);
        indices.push(i1, i2, i3);
      }
    }
  }
  
  // Create geometry
  const bankGeometry = new THREE.BufferGeometry();
  bankGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  bankGeometry.setIndex(indices);
  bankGeometry.computeVertexNormals();
  
  // Create material - semi-transparent so cross sections show through
  const bankMaterial = new THREE.MeshLambertMaterial({
    color: 0x666666,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.3, // Side walls more transparent
  });
  
  const bankMesh = new THREE.Mesh(bankGeometry, bankMaterial);
  bankMesh.renderOrder = 0; // Render behind cross sections
  scene.add(bankMesh);
}


// ---------- LEGENDS AND MARKERS ----------

function addLegendsAndMarkers(velSlices, sliceWidth, sliceHeight) {
  // Get global min/max for legend
  let globalMin = Infinity;
  let globalMax = -Infinity;
  for (const g of velSlices) {
    const { min, max } = getMinMax(g);
    if (min < globalMin) globalMin = min;
    if (max > globalMax) globalMax = max;
  }

  // Update HTML legend labels with tick values
  const tickValues = document.querySelectorAll('.tick-value');
  if (tickValues.length >= 5) {
    const range = globalMax - globalMin;
    tickValues[0].textContent = globalMin.toFixed(2); // 0% - min
    tickValues[1].textContent = (globalMin + range * 0.25).toFixed(2); // 25%
    tickValues[2].textContent = (globalMin + range * 0.5).toFixed(2); // 50%
    tickValues[3].textContent = (globalMin + range * 0.75).toFixed(2); // 75%
    tickValues[4].textContent = globalMax.toFixed(2); // 100% - max
  }

  // 1. Flow Arrow
  const flowArrowLength = 30;
  const flowArrowStart = new THREE.Vector3(
    -(velSlices.length / 2) * SLICE_SPACING - 10,
    5,
    -sliceWidth / 2 - 5
  );
  const flowArrowDir = new THREE.Vector3(1, 0, 0).normalize();
  const flowArrow = new THREE.ArrowHelper(
    flowArrowDir,
    flowArrowStart,
    flowArrowLength,
    0x000000,
    flowArrowLength * 0.2,
    flowArrowLength * 0.1
  );
  scene.add(flowArrow);

  // 2. 3D Coordinate System
  const axisLength = 15;
  const axesHelper = new THREE.AxesHelper(axisLength);
  axesHelper.position.set(
    (velSlices.length / 2) * SLICE_SPACING + 10,
    5,
    sliceWidth / 2 + 10
  );
  scene.add(axesHelper);

  // 3. Scale Bars
  // Horizontal scale bar (100m)
  const scaleBar100 = new THREE.Mesh(
    new THREE.BoxGeometry(100, 0.2, 0.2),
    new THREE.MeshBasicMaterial({ color: 0x000000 })
  );
  scaleBar100.position.set(0, -10, -sliceWidth / 2 - 3);
  scene.add(scaleBar100);

  // Add label for 100m scale bar
  const scaleLabel100 = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  scaleLabel100.position.set(50, -10, -sliceWidth / 2 - 3);
  scene.add(scaleLabel100);

  // Vertical scale bar (50m)
  const scaleBar50 = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 50, 0.2),
    new THREE.MeshBasicMaterial({ color: 0x000000 })
  );
  scaleBar50.position.set(
    -(velSlices.length / 2) * SLICE_SPACING - 3,
    5,
    -sliceWidth / 2 - 3
  );
  scene.add(scaleBar50);

  // Add label for 50m scale bar
  const scaleLabel50 = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  scaleLabel50.position.set(
    -(velSlices.length / 2) * SLICE_SPACING - 3,
    30,
    -sliceWidth / 2 - 3
  );
  scene.add(scaleLabel50);
}

// ---------- CLICK DETECTION AND PLOT POPUP ----------

function onCrossSectionClick(event) {
  // Calculate mouse position in normalized device coordinates
  const mouse = new THREE.Vector2();
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  // Raycasting to detect clicked object
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(crossSectionMeshes);
  
  if (intersects.length > 0) {
    const clickedMesh = intersects[0].object;
    const sliceIndex = clickedMesh.userData.sliceIndex;
    const velData = clickedMesh.userData.velocityData;
    const maskData = clickedMesh.userData.maskData;
    const intersectionPoint = intersects[0].point;
    
    showCrossSectionPlot(sliceIndex, velData, maskData, clickedMesh, intersectionPoint);
  }
}

function showCrossSectionPlot(sliceIndex, velData, maskData, mesh, intersectionPoint) {
  // Convert 3D position to screen coordinates
  const worldPosition = intersectionPoint.clone();
  worldPosition.y += 15; // Position above the cross-section
  worldPosition.z += 20; // Position to the right
  
  const vector = worldPosition.project(camera);
  const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-vector.y * 0.5 + 0.5) * window.innerHeight;
  
  // Create or show popup modal
  let modal = document.getElementById('plot-modal');
  let connector = document.getElementById('plot-connector');
  
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'plot-modal';
    modal.innerHTML = `
      <div class="plot-modal-content">
        <div class="plot-modal-header">
          <h2>Cross-Section ${sliceIndex + 1}</h2>
          <button class="plot-close-btn">&times;</button>
        </div>
        <canvas id="plot-canvas"></canvas>
        <div class="plot-resize-handle"></div>
      </div>
    `;
    
    // Make modal resizable and draggable
    makeModalResizable(modal);
    makeModalDraggable(modal);
    document.body.appendChild(modal);
    
    // Create connector line
    connector = document.createElement('canvas');
    connector.id = 'plot-connector';
    connector.style.position = 'fixed';
    connector.style.top = '0';
    connector.style.left = '0';
    connector.style.pointerEvents = 'none';
    connector.style.zIndex = '999';
    document.body.appendChild(connector);
    
    // Close button handler (attach after makeModalDraggable which may clone the header)
    const closeBtn = modal.querySelector('.plot-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modal.style.display = 'none';
        if (connector) connector.style.display = 'none';
      });
    }
    
    // Close on outside click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
        if (connector) connector.style.display = 'none';
      }
    });
    
    // Make modal draggable (only once)
    makeModalDraggable(modal);
  }
  
  // Ensure modal is draggable even if it already exists
  if (!modal.hasAttribute('data-draggable-setup')) {
    makeModalDraggable(modal);
    modal.setAttribute('data-draggable-setup', 'true');
  }
  
  // Position modal near the cross-section, but ensure it's visible and draggable
  modal.style.position = 'fixed';
  // Calculate position accounting for modal size
  const modalContentEl = modal.querySelector('.plot-modal-content');
  const initialRect = modalContentEl.getBoundingClientRect();
  const modalWidth = initialRect.width || 800;
  const modalHeight = initialRect.height || 600;
  
  // Position to the right and slightly below the click point, ensuring it stays on screen
  const offsetX = 30; // Offset to the right
  const offsetY = 50; // Offset downward
  let modalX = x + offsetX;
  let modalY = y + offsetY;
  
  // Ensure modal stays within viewport bounds
  const maxX = window.innerWidth - modalWidth - 20;
  const maxY = window.innerHeight - modalHeight - 20;
  modalX = Math.min(modalX, maxX);
  modalY = Math.min(modalY, maxY);
  modalX = Math.max(20, modalX); // At least 20px from left edge
  modalY = Math.max(20, modalY); // At least 20px from top edge
  
  modal.style.left = `${modalX}px`;
  modal.style.top = `${modalY}px`;
  modal.style.transform = 'none'; // No transform for easier dragging
  
  // Update title
  modal.querySelector('h2').textContent = `Cross-Section ${sliceIndex + 1}`;
  modal.style.display = 'block';
  
  // Store intersection point for connector line updates
  modal.userData = { intersectionPoint };
  
  // Position and draw connector line
  if (connector) {
    connector.width = window.innerWidth;
    connector.height = window.innerHeight;
    connector.style.display = 'block';
    // Update connector line after positioning
    setTimeout(() => {
      const modalRect = modal.getBoundingClientRect();
      const plotX = modalRect.left + modalRect.width / 2;
      const plotY = modalRect.top;
      drawConnectorLine(connector, intersectionPoint, plotX, plotY);
    }, 0);
  }
  
  // Draw plot - use modal size for canvas
  const canvas = document.getElementById('plot-canvas');
  const finalRect = modalContentEl.getBoundingClientRect();
  
  canvas.width = finalRect.width - 40; // Account for padding
  canvas.height = finalRect.height - 80; // Account for header and padding
  
  const ctx = canvas.getContext('2d');
  drawMatlabPlot(ctx, canvas, velData, maskData, sliceIndex);
}

function makeModalDraggable(modal) {
  const header = modal.querySelector('.plot-modal-header');
  if (!header) return;
  
  // Check if already set up
  if (header.hasAttribute('data-drag-enabled')) return;
  header.setAttribute('data-drag-enabled', 'true');
  
  // Use a unique identifier for this modal's drag state
  const dragState = {
    isDragging: false,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0
  };
  
  const headerEl = header;
  
  headerEl.addEventListener('mousedown', (e) => {
    // Don't drag if clicking the close button
    if (e.target.classList.contains('plot-close-btn') || e.target.closest('.plot-close-btn')) {
      return;
    }
    
    dragState.isDragging = true;
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
    
    // Get current position
    const rect = modal.getBoundingClientRect();
    dragState.startLeft = rect.left;
    dragState.startTop = rect.top;
    
    // Ensure no transform is applied
    modal.style.transform = 'none';
    
    e.preventDefault();
    e.stopPropagation();
    headerEl.style.cursor = 'grabbing';
    headerEl.style.userSelect = 'none';
  });
  
  const handleMouseMove = (e) => {
    if (!dragState.isDragging) return;
    
    const deltaX = e.clientX - dragState.startX;
    const deltaY = e.clientY - dragState.startY;
    
    modal.style.left = `${dragState.startLeft + deltaX}px`;
    modal.style.top = `${dragState.startTop + deltaY}px`;
    
    // Update connector line
    updateConnectorLine();
  };
  
  const handleMouseUp = () => {
    if (dragState.isDragging) {
      dragState.isDragging = false;
      const headerEl = modal.querySelector('.plot-modal-header');
      if (headerEl) {
        headerEl.style.cursor = 'grab';
        headerEl.style.userSelect = '';
      }
    }
  };
  
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
  
  // Store handlers for cleanup if needed
  modal._dragHandlers = { handleMouseMove, handleMouseUp };
  
  // Set initial cursor
  headerEl.style.cursor = 'grab';
}

function makeModalResizable(modal) {
  const content = modal.querySelector('.plot-modal-content');
  const resizeHandle = modal.querySelector('.plot-resize-handle');
  
  let isResizing = false;
  let startX, startY, startWidth, startHeight, startLeft, startTop;
  
  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = content.getBoundingClientRect();
    startWidth = rect.width;
    startHeight = rect.height;
    startLeft = rect.left;
    startTop = rect.top;
    e.preventDefault();
    e.stopPropagation(); // Prevent dragging when resizing
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    
    const newWidth = Math.max(400, startWidth + deltaX);
    const newHeight = Math.max(300, startHeight + deltaY);
    
    content.style.width = `${newWidth}px`;
    content.style.height = `${newHeight}px`;
    
    // Redraw plot with new size
    const canvas = document.getElementById('plot-canvas');
    if (canvas && modal.style.display !== 'none') {
      canvas.width = newWidth - 40;
      canvas.height = newHeight - 80;
      const sliceIndex = parseInt(modal.querySelector('h2').textContent.match(/\d+/)[0]) - 1;
      const velData = crossSectionData[sliceIndex]?.vel;
      const maskData = crossSectionData[sliceIndex]?.mask;
      if (velData && maskData) {
        const ctx = canvas.getContext('2d');
        drawMatlabPlot(ctx, canvas, velData, maskData, sliceIndex);
      }
    }
    
    // Update connector line
    updateConnectorLine();
  });
  
  document.addEventListener('mouseup', () => {
    isResizing = false;
  });
}

function drawConnectorLine(connectorCanvas, worldPoint, plotX, plotY) {
  const ctx = connectorCanvas.getContext('2d');
  ctx.clearRect(0, 0, connectorCanvas.width, connectorCanvas.height);
  
  // Convert 3D point to screen coordinates
  const vector = worldPoint.clone().project(camera);
  const x1 = (vector.x * 0.5 + 0.5) * window.innerWidth;
  const y1 = (-vector.y * 0.5 + 0.5) * window.innerHeight;
  
  // Draw line from cross-section to plot
  ctx.strokeStyle = '#ffff00';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]); // Dashed line
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(plotX, plotY);
  ctx.stroke();
  ctx.setLineDash([]); // Reset dash
}

function drawMatlabPlot(ctx, canvas, velData, maskData, sliceIndex) {
  const width = canvas.width;
  const height = canvas.height;
  const padding = { top: 60, right: 60, bottom: 60, left: 80 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  
  // Dark theme background
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, width, height);
  
  // Draw grid (dark theme - dark gray)
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 1;
  
  // Vertical grid lines
  const numVerticalGrid = 10;
  for (let i = 0; i <= numVerticalGrid; i++) {
    const x = padding.left + (i / numVerticalGrid) * plotWidth;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + plotHeight);
    ctx.stroke();
  }
  
  // Horizontal grid lines
  const numHorizontalGrid = 8;
  for (let i = 0; i <= numHorizontalGrid; i++) {
    const y = padding.top + (i / numHorizontalGrid) * plotHeight;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + plotWidth, y);
    ctx.stroke();
  }
  
  // Draw axes (dark theme - light gray)
  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 2;
  
  // X axis
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top + plotHeight);
  ctx.lineTo(padding.left + plotWidth, padding.top + plotHeight);
  ctx.stroke();
  
  // Y axis
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + plotHeight);
  ctx.stroke();
  
  // Calculate data range
  let minVel = Infinity;
  let maxVel = -Infinity;
  const rows = velData.length;
  const cols = velData[0].length;
  
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (maskData[r][c] > 0.5 && Number.isFinite(velData[r][c])) {
        const v = velData[r][c];
        if (v < minVel) minVel = v;
        if (v > maxVel) maxVel = v;
      }
    }
  }
  
  if (!Number.isFinite(minVel)) minVel = 0;
  if (!Number.isFinite(maxVel)) maxVel = 1;
  
  // Draw velocity data as a 2D heatmap/contour - match 3D view orientation
  const cellWidth = plotWidth / cols;
  const cellHeight = plotHeight / rows;
  
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (maskData[r][c] > 0.5 && Number.isFinite(velData[r][c])) {
        const vel = velData[r][c];
        const t = (vel - minVel) / (maxVel - minVel || 1);
        
        // Color based on velocity (rainbow)
        const hue = (1 - t) * 0.65; // blue -> red
        const color = new THREE.Color();
        color.setHSL(hue, 1.0, 0.5);
        
        ctx.fillStyle = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
        // Normal orientation (not flipped) to match 3D view
        ctx.fillRect(
          padding.left + c * cellWidth,
          padding.top + r * cellHeight, // Not flipped vertically
          cellWidth,
          cellHeight
        );
      }
    }
  }
  
  // Draw axis labels (dark theme - light text)
  ctx.fillStyle = '#ffffff';
  ctx.font = '14px Arial';
  ctx.textAlign = 'center';
  
  // X axis label
  ctx.fillText('Channel Width (columns)', padding.left + plotWidth / 2, height - 20);
  
  // Y axis label (rotated)
  ctx.save();
  ctx.translate(20, padding.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Depth (rows)', 0, 0);
  ctx.restore();
  
  // X axis ticks
  ctx.textAlign = 'center';
  for (let i = 0; i <= 5; i++) {
    const x = padding.left + (i / 5) * plotWidth;
    const value = Math.round((i / 5) * (cols - 1));
    ctx.fillText(value.toString(), x, padding.top + plotHeight + 40);
  }
  
  // Y axis ticks
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const y = padding.top + (i / 5) * plotHeight;
    const value = Math.round((i / 5) * (rows - 1)); // Not flipped
    ctx.fillText(value.toString(), padding.left - 10, y + 5);
  }
  
  // Title (dark theme - light text)
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`Velocity Magnitude (m s⁻¹) - Cross-Section ${sliceIndex + 1}`, width / 2, 30);
  
  // Colorbar
  const colorbarWidth = 30;
  const colorbarHeight = plotHeight;
  const colorbarX = padding.left + plotWidth + 20;
  const colorbarY = padding.top;
  
  // Draw colorbar gradient
  for (let i = 0; i < colorbarHeight; i++) {
    const t = 1 - (i / colorbarHeight);
    const hue = (1 - t) * 0.65;
    const color = new THREE.Color();
    color.setHSL(hue, 1.0, 0.5);
    ctx.fillStyle = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
    ctx.fillRect(colorbarX, colorbarY + i, colorbarWidth, 1);
  }
  
  // Colorbar border
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.strokeRect(colorbarX, colorbarY, colorbarWidth, colorbarHeight);
  
  // Colorbar labels
  ctx.fillStyle = '#000000';
  ctx.font = '12px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(maxVel.toFixed(2), colorbarX + colorbarWidth + 10, colorbarY + 10);
  ctx.fillText(minVel.toFixed(2), colorbarX + colorbarWidth + 10, colorbarY + colorbarHeight - 5);
  ctx.fillText((minVel + (maxVel - minVel) / 2).toFixed(2), colorbarX + colorbarWidth + 10, colorbarY + colorbarHeight / 2);
}
