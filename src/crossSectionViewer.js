// Import erosion/migration explorer
import { initErosionMigrationExplorer, destroyErosionMigrationExplorer } from './erosionMigrationExplorer.js';


const VALUE_FIELD = 'xsGridQs';   // or 'Q' if that's what you have
// column name for mask (1 = water, 0 = bank)
// If mask column doesn't exist, we'll derive it from valid velocity values
const MASK_FIELD = null;   // Set to column name if it exists, or null to derive from velocity

// path to the CSV
const CSV_PATH = 'cross_section_csvs/huslia_ALL_variables.csv';

// ---------------------------------------------------------------

let table;                 // p5.Table
let slices = {};           // sliceId -> {vel, mask, ny, nx}
let sliceIds = [];         // sorted list of slice IDs
let maxRowsGlobal = 0;

// UI
let sliceSlider;
let depthSlider;
let sliceLabelSpan;
let rowLabelSpan;
let p5Instance = null;

// Tab management
let isActive = false;

// Initialize when tab becomes active
export function initCrossSectionViewer() {
  console.log('initCrossSectionViewer called');
  
  if (p5Instance) {
    console.log('p5 already running');
    return; // Already initialized
  }
  
  // Check if page is active
  const page = document.getElementById('page-cross-section');
  console.log('cross-section page:', page);
  if (!page || !page.classList.contains('active')) {
    console.warn('cross-section page is not active yet');
    return;
  }
  
  // Wait for p5 to be available (CDN might still be loading)
  function tryInit() {
    if (typeof p5 === 'undefined') {
      console.warn('p5.js not loaded yet, retrying...');
      setTimeout(tryInit, 100);
      return;
    }
    
    console.log('p5.js is available, creating instance...');
    try {
      p5Instance = new p5(sketch);
    } catch (error) {
      console.error('Error creating p5 instance:', error);
    }
  }
  
  tryInit();
}

export function destroyCrossSectionViewer() {
  if (p5Instance) {
    p5Instance.remove();
    p5Instance = null;
  }
  slices = {};
  sliceIds = [];
  maxRowsGlobal = 0;
}

function sketch(p) {
  p.preload = function() {
    // load CSV with header row
    console.log('Loading CSV from:', CSV_PATH);
    try {
      table = p.loadTable(CSV_PATH, 'csv', 'header');
      if (!table) {
        console.error('Failed to load CSV table - table is null/undefined');
      } else {
        console.log('CSV loaded successfully, rows:', table.getRowCount());
      }
    } catch (error) {
      console.error('Error loading CSV:', error);
    }
  };

  p.setup = function() {
    const container = document.getElementById('page-cross-section');
    if (!container) {
      console.error('Cross-section page container not found');
      return;
    }
    const canvas = p.createCanvas(container.clientWidth, container.clientHeight);
    canvas.parent(container);
    p.colorMode(p.HSB, 1); // easier for rainbow colors

    // Debug: Log CSV columns
    console.log('CSV columns:', table.columns);
    console.log('CSV row count:', table.getRowCount());

    // Grab label spans from HTML
    sliceLabelSpan = document.getElementById('sliceLabel');
    rowLabelSpan = document.getElementById('rowLabel');

    parseTableToSlices();

    // ------- create sliders --------
    const minSlice = 0;
    const maxSlice = sliceIds.length - 1;

    sliceSlider = p.createSlider(minSlice, maxSlice, 0, 1);
    sliceSlider.position(110, 18); // visually near "Slice:" label
    sliceSlider.style('width', '200px');
    sliceSlider.style('z-index', '1000');

    depthSlider = p.createSlider(0, maxRowsGlobal - 1, 0, 1);
    depthSlider.position(110, 40);
    depthSlider.style('width', '200px');
    depthSlider.style('z-index', '1000');

    updateUILabels();
  };

  p.windowResized = function() {
    const container = document.getElementById('page-cross-section');
    if (container && container.classList.contains('active')) {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      p.resizeCanvas(newWidth, newHeight);
    }
  };

  p.draw = function() {
    p.background(0.1); // dark background

    if (!table) {
      p.fill(1, 0, 1);
      p.textAlign(p.CENTER, p.CENTER);
      p.text('CSV not loaded. Check console for errors.', p.width / 2, p.height / 2);
      return;
    }

    if (sliceIds.length === 0) {
      p.fill(1, 0, 1);
      p.textAlign(p.CENTER, p.CENTER);
      p.text('No slices parsed from CSV. Check console for column name issues.', p.width / 2, p.height / 2);
      return;
    }

    const sliceIndex = sliceSlider.value();
    const sliceId = sliceIds[sliceIndex];
    const depthRow = depthSlider.value();

    const slice = slices[sliceId];
    if (!slice) return;
    
    const ny = slice.ny;
    const nx = slice.nx;

    updateUILabels();

    // clamp depthRow to available rows in this slice
    const r = p.constrain(depthRow, 0, ny - 1);

    // layout
    const margin = 40;
    const midX = p.width * 0.5;

    // ---- LEFT: heatmap of velocity ----
    p.push();
    const heatW = midX - margin * 1.5;
    const heatH = p.height - margin * 2;

    p.translate(margin, margin);

    drawHeatmap(p, slice, heatW, heatH);

    p.pop();

    // ---- RIGHT: line plot velocity vs channel width at selected depth ----
    p.push();
    const plotW = midX - margin * 1.5;
    const plotH = p.height - margin * 2;

    p.translate(midX + margin * 0.5, margin);

    drawDepthProfile(p, slice, r, plotW, plotH);

    p.pop();
  };

  // ---------------------------------------------------------
  // Parse flat table into slices[sliceId].vel[row][col], etc.
  // ---------------------------------------------------------
  function parseTableToSlices() {
    if (!table) {
      console.error('Table not loaded, cannot parse slices');
      return;
    }
    
    const n = table.getRowCount();
    if (n === 0) {
      console.error('Table has no rows');
      return;
    }
    
    // Check for required columns
    const requiredCols = ['slice', 'row', 'col'];
    const missingCols = requiredCols.filter(col => !table.columns.includes(col));
    if (missingCols.length > 0) {
      console.error('Missing required columns:', missingCols);
      console.log('Available columns:', table.columns);
      return;
    }
    
    if (!table.columns.includes(VALUE_FIELD)) {
      console.error(`Velocity field "${VALUE_FIELD}" not found in CSV columns`);
      console.log('Available columns:', table.columns);
      console.log('Please update VALUE_FIELD constant to match one of the columns above');
      return;
    }

    // First pass: determine dimensions
    for (let i = 0; i < n; i++) {
      const row = table.getRow(i);

      const sliceId = row.getNum('slice');
      const iRow = row.getNum('row'); // 1-based
      const iCol = row.getNum('col'); // 1-based

      if (!slices[sliceId]) {
        slices[sliceId] = {
          vel: [],
          mask: [],
          ny: 0,
          nx: 0,
        };
      }

      const s = slices[sliceId];

      if (iRow > s.ny) s.ny = iRow;
      if (iCol > s.nx) s.nx = iCol;
    }

    // initialize 2D arrays
    for (const id in slices) {
      const s = slices[id];
      s.vel = Array.from({ length: s.ny }, () => Array(s.nx).fill(NaN));
      s.mask = Array.from({ length: s.ny }, () => Array(s.nx).fill(0));
      if (s.ny > maxRowsGlobal) maxRowsGlobal = s.ny;
    }

    // fill values
    for (let i = 0; i < n; i++) {
      const row = table.getRow(i);

      const sliceId = row.getNum('slice');
      const r = row.getNum('row') - 1; // 0-based
      const c = row.getNum('col') - 1;

      const s = slices[sliceId];
      if (!s) continue;

      const v = row.getNum(VALUE_FIELD);
      
      // Get mask value or derive from velocity
      let m = 0;
      if (MASK_FIELD) {
        m = row.getNum(MASK_FIELD);
      } else {
        // Derive mask from valid velocity values
        m = (Number.isFinite(v) && v !== 0) ? 1 : 0;
      }

      s.vel[r][c] = v;
      s.mask[r][c] = m;
    }

    // store sorted slice IDs
    sliceIds = Object.keys(slices)
      .map(Number)
      .sort((a, b) => a - b);
    
    // Debug: Log parsed slices
    console.log('Parsed slices:', sliceIds);
    if (sliceIds.length > 0) {
      console.log('First slice dimensions:', slices[sliceIds[0]]);
      console.log('First slice sample values:', {
        vel: slices[sliceIds[0]].vel[0]?.slice(0, 5),
        mask: slices[sliceIds[0]].mask[0]?.slice(0, 5)
      });
    }
  }

  // ---------------------------------------------------------
  // Draw heatmap: full cross-section velocity field
  // ---------------------------------------------------------
  function drawHeatmap(p, slice, w, h) {
    const ny = slice.ny;
    const nx = slice.nx;

    // find min/max velocity over water
    let vMin = Infinity;
    let vMax = -Infinity;
    for (let r = 0; r < ny; r++) {
      for (let c = 0; c < nx; c++) {
        if (slice.mask[r][c] > 0.5 && isFinite(slice.vel[r][c])) {
          const v = slice.vel[r][c];
          if (v < vMin) vMin = v;
          if (v > vMax) vMax = v;
        }
      }
    }
    if (!isFinite(vMin) || !isFinite(vMax)) {
      vMin = 0;
      vMax = 1;
    }

    const cellW = w / nx;
    const cellH = h / ny;

    p.noStroke();
    for (let r = 0; r < ny; r++) {
      for (let c = 0; c < nx; c++) {
        if (slice.mask[r][c] > 0.5 && isFinite(slice.vel[r][c])) {
          const v = slice.vel[r][c];
          const t = (v - vMin) / (vMax - vMin || 1); // 0..1
          const hue = (1 - t) * 0.65; // blue -> red
          p.fill(hue, 1, 1);
        } else {
          // bank / no data
          p.fill(0, 0, 0.2);
        }
        p.rect(c * cellW, r * cellH, cellW + 0.5, cellH + 0.5);
      }
    }

    // outline
    p.noFill();
    p.stroke(0, 0, 1);
    p.strokeWeight(1.5);
    p.rect(0, 0, w, h);

    // label
    p.noStroke();
    p.fill(0, 0, 1);
    p.textSize(14);
    p.textAlign(p.LEFT, p.TOP);
    p.text('Velocity heatmap (m/s)', 4, 4);
  }

  // ---------------------------------------------------------
  // Draw velocity vs channel width at a given depth row
  // ---------------------------------------------------------
  function drawDepthProfile(p, slice, r, w, h) {
    const ny = slice.ny;
    const nx = slice.nx;

    // gather data along row r
    const xs = [];
    const vs = [];
    for (let c = 0; c < nx; c++) {
      if (slice.mask[r][c] > 0.5 && isFinite(slice.vel[r][c])) {
        xs.push(c);
        vs.push(slice.vel[r][c]);
      }
    }

    // axes box
    const margin = 40;
    const x0 = margin;
    const y0 = margin;
    const plotW = w - margin * 2;
    const plotH = h - margin * 2;

    // background
    p.noStroke();
    p.fill(0, 0, 0.15);
    p.rect(0, 0, w, h);

    // draw axes
    p.stroke(0, 0, 1);
    p.strokeWeight(1.2);
    // x axis
    p.line(x0, y0 + plotH, x0 + plotW, y0 + plotH);
    // y axis
    p.line(x0, y0, x0, y0 + plotH);

    if (xs.length === 0) {
      p.noStroke();
      p.fill(0, 0, 1);
      p.textAlign(p.CENTER, p.CENTER);
      p.text('No water cells at this depth row', x0 + plotW / 2, y0 + plotH / 2);
      return;
    }

    // min/max vel
    let vMin = Math.min(...vs);
    let vMax = Math.max(...vs);
    if (vMin === vMax) {
      vMin -= 0.5;
      vMax += 0.5;
    }

    // plot line
    p.noFill();
    p.stroke(0.6, 1, 1);
    p.strokeWeight(2);
    p.beginShape();
    for (let i = 0; i < xs.length; i++) {
      const c = xs[i];
      const v = vs[i];

      const xp = p.map(c, 0, nx - 1, x0, x0 + plotW);
      const yp = p.map(v, vMin, vMax, y0 + plotH, y0); // invert y
      p.vertex(xp, yp);
    }
    p.endShape();

    // axis labels
    p.noStroke();
    p.fill(0, 0, 1);
    p.textSize(13);
    p.textAlign(p.CENTER, p.TOP);
    p.text('Across-channel index (col)', x0 + plotW / 2, y0 + plotH + 8);

    p.textAlign(p.LEFT, p.BOTTOM);
    p.text(`Velocity (m/s)`, x0 + 4, y0 - 8);

    p.textAlign(p.LEFT, p.TOP);
    p.textSize(14);
    p.text(
      `Depth row: ${r} / ${ny - 1}`,
      x0 + 4,
      y0 + 4
    );
  }

  // ---------------------------------------------------------
  // Update text labels next to sliders
  // ---------------------------------------------------------
  function updateUILabels() {
    if (!sliceLabelSpan || !rowLabelSpan) return;

    const sliceIndex = sliceSlider?.value() ?? 0;
    const sliceId = sliceIds[sliceIndex] ?? '?';
    const depthRow = depthSlider?.value() ?? 0;

    sliceLabelSpan.textContent = `${sliceId} (index ${sliceIndex})`;
    rowLabelSpan.textContent = depthRow;
  }
}

// Tab switching logic removed - now handled by router.js

