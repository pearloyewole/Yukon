import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ---------- CONFIG ----------

const CSV_FOLDER = 'cross_section_csvs';
const NUM_SLICES = 16;      // how many stations you exported
const SLICE_SPACING = 15;   // distance between slices along flow (x)
const DOWNSAMPLE = 2;       // 1 = full, 2 = every 2nd cell

// ----------------------------

let scene, camera, renderer, controls;
let particleSystem = null;
let velocityData = null;

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
  if (particleSystem) {
    updateParticles(dt);
  }
  
  controls.update();
  renderer.render(scene, camera);
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
  const sliceWidth = 40;   // across-channel
  const sliceHeight = 20;  // vertical

  sliceVelocityGrids.forEach((velGrid, idx) => {
    const maskGrid = sliceMaskGrids[idx];

    const dsVel = downsampleGrid(velGrid, DOWNSAMPLE);
    const dsMask = downsampleGrid(maskGrid, DOWNSAMPLE);

    const rows = dsVel.length;
    const cols = dsVel[0].length;

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

    scene.add(mesh);
  });

  // Build river boundary walls connecting the cross-sections (with cutouts)
  buildRiverBoundary(sliceVelocityGrids, sliceMaskGrids, sliceWidth, sliceHeight);

  // Add particle system for flow visualization
  buildParticleSystem(sliceVelocityGrids, sliceMaskGrids, sliceWidth, sliceHeight);

  console.log('Finished building river slices with rock boundaries.');
}

// ---------- RIVER BOUNDARY WALLS ----------

function buildRiverBoundary(velSlices, maskSlices, sliceWidth, sliceHeight) {
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

// ---------- PARTICLE SYSTEM ----------

function buildParticleSystem(velSlices, maskSlices, sliceWidth, sliceHeight) {
  // Store velocity data for interpolation
  velocityData = {
    slices: velSlices.map(v => downsampleGrid(v, DOWNSAMPLE)),
    masks: maskSlices.map(m => downsampleGrid(m, DOWNSAMPLE)),
    sliceWidth,
    sliceHeight,
    sliceCenterY: 5,
    sliceSpacing: SLICE_SPACING,
    numSlices: velSlices.length
  };

  const particleCount = 500;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const velocities = new Float32Array(particleCount); // Store speed for each particle

  // Initialize particles randomly in water areas
  for (let i = 0; i < particleCount; i++) {
    let placed = false;
    let attempts = 0;
    
    while (!placed && attempts < 50) {
      // Random slice
      const sliceIdx = Math.floor(Math.random() * velSlices.length);
      const velGrid = velocityData.slices[sliceIdx];
      const maskGrid = velocityData.masks[sliceIdx];
      
      if (!velGrid.length || !maskGrid.length) {
        attempts++;
        continue;
      }
      
      const rows = velGrid.length;
      const cols = velGrid[0].length;
      
      // Random position in slice
      const r = Math.floor(Math.random() * rows);
      const c = Math.floor(Math.random() * cols);
      
      // Check if it's water
      if (maskGrid[r] && maskGrid[r][c] > 0.5 && Number.isFinite(velGrid[r][c])) {
        const x = (sliceIdx - velSlices.length / 2) * SLICE_SPACING;
        const yFrac = r / (rows - 1);
        const y = velocityData.sliceCenterY + (yFrac - 0.5) * sliceHeight;
        const zFrac = c / (cols - 1);
        const z = (zFrac - 0.5) * sliceWidth;
        
        const vel = velGrid[r][c];
        
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        velocities[i] = vel;
        
        // Color based on velocity - make brighter/more visible
        const globalMin = Math.min(...velSlices.flat().flat().filter(v => Number.isFinite(v)));
        const globalMax = Math.max(...velSlices.flat().flat().filter(v => Number.isFinite(v)));
        const color = colorForVelocity(vel, globalMin, globalMax);
        // Brighten the colors for visibility
        colors[i * 3] = Math.min(1, color.r * 1.5);
        colors[i * 3 + 1] = Math.min(1, color.g * 1.5);
        colors[i * 3 + 2] = Math.min(1, color.b * 1.5);
        
        placed = true;
      }
      attempts++;
    }
    
    // If couldn't place, put at default position
    if (!placed) {
      const sliceIdx = Math.floor(velSlices.length / 2);
      positions[i * 3] = (sliceIdx - velSlices.length / 2) * SLICE_SPACING;
      positions[i * 3 + 1] = velocityData.sliceCenterY;
      positions[i * 3 + 2] = 0;
      velocities[i] = 0;
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.userData.velocities = velocities;

  const material = new THREE.PointsMaterial({
    size: 1.0,
    vertexColors: true,
    transparent: true,
    opacity: 1.0,
    sizeAttenuation: true,
  });

  particleSystem = new THREE.Points(geometry, material);
  particleSystem.renderOrder = 10; // Render on top
  scene.add(particleSystem);
  console.log(`Created particle system with ${particleCount} particles`);
}

function updateParticles(dt) {
  if (!particleSystem || !velocityData) return;

  const positions = particleSystem.geometry.attributes.position;
  const velocities = particleSystem.geometry.userData.velocities;
  const numParticles = positions.count;

  for (let i = 0; i < numParticles; i++) {
    let x = positions.getX(i);
    let y = positions.getY(i);
    let z = positions.getZ(i);
    
    // Find which slice we're in or between
    const sliceIdx = Math.floor((x + (velocityData.numSlices / 2) * velocityData.sliceSpacing) / velocityData.sliceSpacing);
    const sliceIdx0 = Math.max(0, Math.min(velocityData.numSlices - 1, sliceIdx));
    const sliceIdx1 = Math.max(0, Math.min(velocityData.numSlices - 1, sliceIdx + 1));
    
    // Interpolate velocity between slices
    const t = ((x - (sliceIdx0 - velocityData.numSlices / 2) * velocityData.sliceSpacing) / velocityData.sliceSpacing);
    const tClamped = Math.max(0, Math.min(1, t));
    
    // Get velocity at current position in both slices
    const vel0 = getVelocityAtPosition(x, y, z, sliceIdx0);
    const vel1 = getVelocityAtPosition(x, y, z, sliceIdx1);
    const vel = vel0 * (1 - tClamped) + vel1 * tClamped;
    
    if (vel > 0 && Number.isFinite(vel)) {
      // Move particle forward based on velocity
      const speed = vel * 0.5; // Scale factor for visualization
      x += speed * dt;
      
      // Wrap around if past the end
      const maxX = (velocityData.numSlices - 1 - velocityData.numSlices / 2) * velocityData.sliceSpacing + 20;
      if (x > maxX) {
        x = -(velocityData.numSlices / 2) * velocityData.sliceSpacing - 20;
        // Respawn at random position
        const newSliceIdx = Math.floor(Math.random() * velocityData.numSlices);
        const velGrid = velocityData.slices[newSliceIdx];
        const maskGrid = velocityData.masks[newSliceIdx];
        if (velGrid.length && maskGrid.length) {
          const rows = velGrid.length;
          const cols = velGrid[0].length;
          const r = Math.floor(Math.random() * rows);
          const c = Math.floor(Math.random() * cols);
          if (maskGrid[r] && maskGrid[r][c] > 0.5) {
            x = (newSliceIdx - velocityData.numSlices / 2) * velocityData.sliceSpacing;
            const yFrac = r / (rows - 1);
            y = velocityData.sliceCenterY + (yFrac - 0.5) * velocityData.sliceHeight;
            const zFrac = c / (cols - 1);
            z = (zFrac - 0.5) * velocityData.sliceWidth;
            velocities[i] = velGrid[r][c];
          }
        }
      }
      
      positions.setX(i, x);
      positions.setY(i, y);
      positions.setZ(i, z);
    }
  }

  positions.needsUpdate = true;
}

function getVelocityAtPosition(x, y, z, sliceIdx) {
  if (sliceIdx < 0 || sliceIdx >= velocityData.numSlices) return 0;
  
  const velGrid = velocityData.slices[sliceIdx];
  const maskGrid = velocityData.masks[sliceIdx];
  
  if (!velGrid.length || !maskGrid.length) return 0;
  
  const rows = velGrid.length;
  const cols = velGrid[0].length;
  
  // Convert world position to grid coordinates
  const sliceX = (sliceIdx - velocityData.numSlices / 2) * velocityData.sliceSpacing;
  const yFrac = (y - (velocityData.sliceCenterY - velocityData.sliceHeight / 2)) / velocityData.sliceHeight;
  const zFrac = (z + velocityData.sliceWidth / 2) / velocityData.sliceWidth;
  
  const r = Math.floor(yFrac * (rows - 1));
  const c = Math.floor(zFrac * (cols - 1));
  
  const rClamped = Math.max(0, Math.min(rows - 1, r));
  const cClamped = Math.max(0, Math.min(cols - 1, c));
  
  if (maskGrid[rClamped] && maskGrid[rClamped][cClamped] > 0.5) {
    return velGrid[rClamped][cClamped] || 0;
  }
  
  return 0;
}