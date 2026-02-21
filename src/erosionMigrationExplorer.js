// Erosion and Migration Cross-section Explorer
// Based on the demo design with hardcoded data (to be replaced with processed shapefile data)

let p5Instance = null;
let series = [];
let state = {
  showEvents: false,
  showPosCurv: true,
  showNegCurv: true,
  showLeft: true,
  showRight: true,
  showRiver: true,
  cursorKm: null
};

// Demo events along the river (for markers)
const demoEvents = [
  { km: 320, label: "Field note" },
  { km: 610, label: "Bank slough" },
  { km: 915, label: "Ice jam" },
  { km: 1220, label: "High flow" },
];

// Legend items
const legendItems = [
  { key: "showPosCurv", label: "Positive Angle Change", color: "#C084FC" },
  { key: "showNegCurv", label: "Negative Angle Change", color: "#F59E0B" },
  { key: "showLeft", label: "Left Bank Erosion", color: "#34D399" },
  { key: "showRight", label: "Right Bank Erosion", color: "#FB7185" },
  { key: "showRiver", label: "River", color: "#60A5FA" },
];

// Initialize when tab becomes active
export function initErosionMigrationExplorer() {
  console.log('initErosionMigrationExplorer called');
  
  if (p5Instance) {
    console.log('p5 already running for erosion explorer');
    return; // Already initialized
  }
  
  // Check if page is active
  const page = document.getElementById('page-erosion-migration');
  console.log('erosion-migration page:', page);
  if (!page || !page.classList.contains('active')) {
    console.warn('erosion-migration page is not active yet');
    return;
  }
  
  // Wait for p5 to be available (CDN might still be loading)
  function tryInit() {
    if (typeof p5 === 'undefined') {
      console.warn('p5.js not loaded yet, retrying...');
      setTimeout(tryInit, 100);
      return;
    }
    
    console.log('p5.js is available, creating erosion explorer instance...');
    try {
      // Initialize with demo data
      series = makeDemoSeries();
      setupUI();
      p5Instance = new p5(sketch);
    } catch (error) {
      console.error('Error creating p5 instance:', error);
    }
  }
  
  tryInit();
}

export function destroyErosionMigrationExplorer() {
  if (p5Instance) {
    p5Instance.remove();
    p5Instance = null;
  }
  series = [];
  state.cursorKm = null;
}

// Generate demo series data
function makeDemoSeries(n = 320, kmMax = 1450) {
  const series = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const km = t * kmMax;

    // Curvature: smooth trend with gentle decay and a few bumps
    const curvature =
      0.9 * Math.exp(-2.2 * t) * (0.6 + 0.4 * Math.sin(2.2 * Math.PI * t + 0.3))
      + 0.18 * Math.sin(0.45 * Math.PI * t)
      - 0.22 * (t - 0.65);

    // Bank migration: alternating lobes (designy "blobs")
    const leftErosion =
      0.55 * gauss(t, 0.10, 0.035) +
      0.95 * gauss(t, 0.33, 0.045) +
      0.70 * gauss(t, 0.60, 0.040) +
      0.85 * gauss(t, 0.86, 0.050);

    const rightErosion =
      0.75 * gauss(t, 0.16, 0.050) +
      0.45 * gauss(t, 0.48, 0.040) +
      0.65 * gauss(t, 0.72, 0.055) +
      0.35 * gauss(t, 0.94, 0.030);

    series.push({
      km,
      curvature,
      leftErosion: leftErosion * 1.2,    // scale to ~m/yr look
      rightErosion: rightErosion * 1.0
    });
  }
  return series;
}

function gauss(t, mu, sigma) {
  const z = (t - mu) / sigma;
  return Math.exp(-0.5 * z * z);
}

// Setup UI controls
function setupUI() {
  // Setup legend pills
  const legendEl = document.getElementById('erosion-legend');
  if (!legendEl) return;
  
  function renderLegend() {
    legendEl.innerHTML = "";
    legendItems.forEach(item => {
      const pill = document.createElement("div");
      pill.className = "pill" + (state[item.key] ? "" : " off");
      pill.onclick = () => {
        state[item.key] = !state[item.key];
        renderLegend();
        if (p5Instance) p5Instance.redraw();
      };
      const dot = document.createElement("div");
      dot.className = "dot";
      dot.style.background = item.color;
      const text = document.createElement("div");
      text.textContent = item.label;
      pill.appendChild(dot);
      pill.appendChild(text);
      legendEl.appendChild(pill);
    });
  }
  renderLegend();

  // Toggle events button
  const toggleEventsBtn = document.getElementById('toggleEvents');
  if (toggleEventsBtn) {
    toggleEventsBtn.onclick = () => {
      state.showEvents = !state.showEvents;
      toggleEventsBtn.textContent = state.showEvents ? "Hide events" : "Show events";
      if (p5Instance) p5Instance.redraw();
    };
  }

  // Download button
  const downloadBtn = document.getElementById('downloadChart');
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      if (p5Instance) {
        p5Instance.saveCanvas("huslia_demo_chart", "png");
      }
    };
  }

  // Cursor slider
  const cursor = document.getElementById('erosionCursor');
  if (cursor) {
    cursor.oninput = () => {
      const t = Number(cursor.value) / 1000;
      state.cursorKm = t * (series.length > 0 ? series[series.length - 1].km : 0);
      if (p5Instance) p5Instance.redraw();
    };
  }
}

// p5.js sketch
function sketch(p) {
  let W, H;
  const pad = { l: 70, r: 30, t: 24, b: 48 };
  const panelGap = 26;

  p.setup = function() {
    const container = document.getElementById('erosionSketchWrap');
    if (!container) {
      console.error('Erosion sketch wrap container not found');
      return;
    }
    
    W = Math.min(1200, window.innerWidth * 0.96) - 24;
    H = 560;
    const c = p.createCanvas(W, H);
    c.parent(container);
    p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
    p.noLoop();
    p.redraw();
  };

  p.windowResized = function() {
    const page = document.getElementById('page-erosion-migration');
    if (page && page.classList.contains('active')) {
      W = Math.min(1200, window.innerWidth * 0.96) - 24;
      p.resizeCanvas(W, H);
      p.redraw();
    }
  };

  p.draw = function() {
    p.clear();
    p.background(255);

    if (series.length === 0) {
      p.fill(0);
      p.textAlign(p.CENTER, p.CENTER);
      p.text('No data available', p.width / 2, p.height / 2);
      return;
    }

    // Two stacked panels
    const panel1 = { x: 0, y: 0, w: W, h: H * 0.42 };
    const panel2 = { x: 0, y: panel1.h + panelGap, w: W, h: H * 0.42 };

    drawAxes(panel1, "Curvature (W/R)");
    drawCurvature(panel1);

    drawAxes(panel2, "Bank Migration (m/yr)");
    drawMigration(panel2);

    drawXAxisLabel(p, "River Distance (km)");

    // Readout
    const readout = document.getElementById('erosionReadout');
    if (readout) {
      if (state.cursorKm != null) {
        readout.textContent = `km: ${state.cursorKm.toFixed(0)}`;
      } else {
        readout.textContent = `km: —`;
      }
    }
  };

  function xScale(km, panel) {
    const x0 = pad.l;
    const x1 = panel.w - pad.r;
    const kmMax = series[series.length - 1].km;
    return p.map(km, 0, kmMax, x0, x1);
  }

  function drawAxes(panel, title) {
    p.push();
    p.translate(panel.x, panel.y);

    // subtle grid
    p.stroke(243);
    p.strokeWeight(1);
    const gridN = 6;
    for (let i = 0; i <= gridN; i++) {
      const gx = p.lerp(pad.l, panel.w - pad.r, i / gridN);
      p.line(gx, pad.t, gx, panel.h - pad.b);
    }

    // title
    p.noStroke();
    p.fill(17, 24, 39);
    p.textSize(12);
    p.textStyle(p.BOLD);
    p.text(title, pad.l, 14);

    // baseline
    p.stroke(230);
    p.line(pad.l, panel.h - pad.b, panel.w - pad.r, panel.h - pad.b);

    p.pop();
  }

  function drawCurvature(panel) {
    p.push();
    p.translate(panel.x, panel.y);

    // Determine y scale from data (curvature is signed)
    let cMin = Infinity, cMax = -Infinity;
    series.forEach(d => {
      cMin = Math.min(cMin, d.curvature);
      cMax = Math.max(cMax, d.curvature);
    });
    // pad for aesthetics
    const padY = 0.15 * (cMax - cMin || 1);
    cMin -= padY;
    cMax += padY;

    const y0 = panel.h - pad.b;        // baseline
    const yTop = pad.t + 10;

    const yScale = (v) => p.map(v, cMin, cMax, y0, yTop);

    // Draw filled positive and negative areas (soft ribbon feel)
    if (state.showPosCurv) {
      drawArea(panel, d => Math.max(0, d.curvature), yScale, y0, p.color(192, 132, 252, 140));
    }
    if (state.showNegCurv) {
      drawArea(panel, d => Math.min(0, d.curvature), yScale, y0, p.color(245, 158, 11, 140));
    }

    // cursor line
    if (state.cursorKm != null) {
      const cx = xScale(state.cursorKm, panel);
      p.stroke(17, 24, 39, 60);
      p.line(cx, pad.t, cx, panel.h - pad.b);
    }

    p.pop();
  }

  function drawMigration(panel) {
    p.push();
    p.translate(panel.x, panel.y);

    // y scale for migration (plot left up, right down)
    let mMax = 0;
    series.forEach(d => {
      mMax = Math.max(mMax, d.leftErosion, d.rightErosion);
    });
    mMax = mMax * 1.25;

    const mid = (pad.t + (panel.h - pad.b)) / 2; // center baseline for +/- visual
    const yUp = pad.t + 8;
    const yDown = panel.h - pad.b - 8;

    const yScaleUp = (v) => p.map(v, 0, mMax, mid, yUp);
    const yScaleDown = (v) => p.map(v, 0, mMax, mid, yDown);

    if (state.showRiver) {drawRiverRibbon(panel, mid, 44); // thickness ~44px (tweak)
}

    // river baseline
    if (state.showRiver) {
      p.stroke(96, 165, 250, 160);
      p.strokeWeight(2);
      p.line(pad.l, mid, panel.w - pad.r, mid);
    }

    // left erosion (positive)
    if (state.showLeft) {
      drawAreaCustom(panel, d => d.leftErosion, (v) => yScaleUp(v), mid, p.color(52, 211, 153, 150));
    }

    // right erosion (negative -> down)
    if (state.showRight) {
      drawAreaCustom(panel, d => d.rightErosion, (v) => yScaleDown(v), mid, p.color(251, 113, 133, 150));
    }

    // events markers
    if (state.showEvents) {
      demoEvents.forEach(ev => {
        const ex = xScale(ev.km, panel);
        p.stroke(17, 24, 39, 60);
        p.strokeWeight(1);
        p.line(ex, pad.t, ex, panel.h - pad.b);
        p.noStroke();
        p.fill(17, 24, 39, 180);
        p.textSize(11);
        p.text(ev.label, ex + 6, pad.t + 14);
      });
    }

    // cursor line
    if (state.cursorKm != null) {
      const cx = xScale(state.cursorKm, panel);
      p.stroke(17, 24, 39, 60);
      p.line(cx, pad.t, cx, panel.h - pad.b);
    }

    p.pop();
  }

  function drawXAxisLabel(label) {
    p.push();
    p.noStroke();
    p.fill(107, 114, 128);
    p.textSize(12);
    p.textStyle(p.BOLD);
    p.textAlign(p.CENTER);
    p.text(label, W / 2, H - 14);
    p.pop();
  }

  // Generic area helper for signed values (curvature)
  function drawArea(panel, yFn, yScale, baselineY, fillCol) {
    p.noStroke();
    p.fill(fillCol);
    p.beginShape();
    // top boundary
    for (let i = 0; i < series.length; i++) {
      const d = series[i];
      const x = xScale(d.km, panel);
      const y = yScale(yFn(d));
      p.curveVertex(x, y);
    }
    // close down to baseline
    for (let i = series.length - 1; i >= 0; i--) {
      const d = series[i];
      const x = xScale(d.km, panel);
      p.curveVertex(x, baselineY);
    }
    p.endShape(p.CLOSE);
  }

  // Area helper for positive magnitude with a custom scaler (migration)
  function drawAreaCustom(panel, yFn, yScale, baselineY, fillCol) {
    p.noStroke();
    p.fill(fillCol);
    p.beginShape();
    for (let i = 0; i < series.length; i++) {
      const d = series[i];
      const x = xScale(d.km, panel);
      const y = yScale(yFn(d));
      p.curveVertex(x, y);
    }
    for (let i = series.length - 1; i >= 0; i--) {
      const d = series[i];
      const x = xScale(d.km, panel);
      p.curveVertex(x, baselineY);
    }
    p.endShape(p.CLOSE);
  }

  // Expose function to update series data
  p.setSeries = function(newSeries) {
    series = newSeries.slice().sort((a, b) => a.km - b.km);
    state.cursorKm = null;
    const cursor = document.getElementById('erosionCursor');
    if (cursor) cursor.value = 0;
    p.redraw();
  };
}

// Expose function to set series from outside
export function setSeries(newSeries) {
  if (p5Instance && p5Instance.setSeries) {
    p5Instance.setSeries(newSeries);
  } else {
    // Store for when p5 instance is created
    series = newSeries.slice().sort((a, b) => a.km - b.km);
  }
}

