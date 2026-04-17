import p5 from 'p5';

let activePanel = null;
const MIN_CANVAS_WIDTH = 280;

export function mountCrossSectionInteractivePlot(container, section) {
  destroyCrossSectionInteractivePlot();

  const velocityGrid = section?.mat_summary?.velocity?.sample;
  const maskGrid = section?.mat_summary?.mask?.sample;

  if (
    !Array.isArray(velocityGrid) ||
    velocityGrid.length === 0 ||
    !Array.isArray(velocityGrid[0]) ||
    velocityGrid[0].length === 0
  ) {
    return false;
  }

  const rows = velocityGrid.length;
  const cols = velocityGrid[0].length;
  const [vMin, vMax] = findVelocityRange(velocityGrid, maskGrid);
  const depthAveraged = buildDepthAveragedVelocity(velocityGrid, maskGrid);

  const state = {
    section,
    velocityGrid,
    maskGrid,
    rows,
    cols,
    vMin,
    vMax,
    depthAveraged,
    selectedRow: clamp(Math.floor(rows * 0.42), 0, rows - 1),
    selectedCol: clamp(Math.floor(cols * 0.5), 0, cols - 1),
  };

  container.innerHTML = `
    <div class="cross-section-interactive">
      <section class="plot-panel">
        <div class="plot-head">
          <h4 class="plot-title">Velocity Cross-Section (Hover to inspect)</h4>
          <div class="plot-readout" data-heat-readout></div>
        </div>
        <div data-heat-host class="cross-p5-host cross-p5-host-heat"></div>
      </section>

      <section class="plot-panel">
        <div class="plot-head">
          <h4 class="plot-title">Selected Depth Row Profile (Hover to probe)</h4>
          <div class="plot-readout" data-row-readout></div>
        </div>
        <div data-row-host class="cross-p5-host cross-p5-host-row"></div>
      </section>

      <section class="plot-panel">
        <div class="plot-head">
          <h4 class="plot-title">Depth-Averaged Streamwise Velocity</h4>
          <div class="plot-readout" data-stream-readout></div>
        </div>
        <p class="plot-hint">Drag the vertical cursor left/right to explore values.</p>
        <div data-stream-host class="cross-p5-host cross-p5-host-stream"></div>
      </section>
    </div>
  `;

  const refs = {
    heatReadout: container.querySelector('[data-heat-readout]'),
    rowReadout: container.querySelector('[data-row-readout]'),
    streamReadout: container.querySelector('[data-stream-readout]'),
    heatHost: container.querySelector('[data-heat-host]'),
    rowHost: container.querySelector('[data-row-host]'),
    streamHost: container.querySelector('[data-stream-host]'),
  };

  const redrawAll = () => {
    if (!activePanel) return;
    activePanel.instances.heat?.redraw();
    activePanel.instances.row?.redraw();
    activePanel.instances.stream?.redraw();
    updateReadouts();
  };

  const setSelection = (row, col) => {
    const nextRow = clamp(Math.round(row), 0, rows - 1);
    const nextCol = clamp(Math.round(col), 0, cols - 1);

    const changed = nextRow !== state.selectedRow || nextCol !== state.selectedCol;
    state.selectedRow = nextRow;
    state.selectedCol = nextCol;

    if (changed) redrawAll();
  };

  const updateReadouts = () => {
    const row = state.selectedRow;
    const col = state.selectedCol;
    const cellV = Number(state.velocityGrid[row][col]);
    const wet = isWater(state.maskGrid, state.velocityGrid, row, col);

    refs.heatReadout.textContent = wet && Number.isFinite(cellV)
      ? `row ${row + 1}, col ${col + 1}: ${formatNumber(cellV)} m/s`
      : `row ${row + 1}, col ${col + 1}: dry/no-data`;

    const rowStats = summarizeRow(state.velocityGrid, state.maskGrid, row);
    refs.rowReadout.textContent = rowStats.count > 0
      ? `row ${row + 1} mean ${formatNumber(rowStats.mean)} m/s, selected col ${col + 1}`
      : `row ${row + 1}: no wet cells`;

    const streamVal = state.depthAveraged[col];
    refs.streamReadout.textContent = Number.isFinite(streamVal)
      ? `cursor col ${col + 1}: ${formatNumber(streamVal)} m/s`
      : `cursor col ${col + 1}: no-data`;
  };

  const heatPlot = createHeatmapPlot(refs.heatHost, state, setSelection);
  const rowPlot = createRowProfilePlot(refs.rowHost, state, setSelection);
  const streamPlot = createDepthAveragedPlot(refs.streamHost, state, setSelection);

  let resizeObserver = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      resizePlot(heatPlot);
      resizePlot(rowPlot);
      resizePlot(streamPlot);
      redrawAll();
    });
    resizeObserver.observe(container);
  }

  activePanel = {
    state,
    refs,
    instances: {
      heat: heatPlot,
      row: rowPlot,
      stream: streamPlot,
    },
    resizeObserver,
    updateReadouts,
    redrawAll,
  };

  updateReadouts();
  redrawAll();
  return true;
}

export function refreshCrossSectionInteractivePlot() {
  if (!activePanel) return;

  resizePlot(activePanel.instances.heat);
  resizePlot(activePanel.instances.row);
  resizePlot(activePanel.instances.stream);
  activePanel.redrawAll();
}

export function destroyCrossSectionInteractivePlot() {
  if (!activePanel) return;

  activePanel.resizeObserver?.disconnect();
  activePanel.instances.heat?.remove();
  activePanel.instances.row?.remove();
  activePanel.instances.stream?.remove();
  activePanel = null;
}

function createHeatmapPlot(host, state, setSelection) {
  const metrics = {
    x: 44,
    y: 22,
    w: 0,
    h: 0,
    cellW: 0,
    cellH: 0,
  };

  const sketch = (p) => {
    p.setup = () => {
      const width = Math.max(MIN_CANVAS_WIDTH, Math.floor(host.clientWidth || 640));
      const height = Math.max(320, Math.round(width * 0.58));
      const canvas = p.createCanvas(width, height);
      canvas.parent(host);
      p.noLoop();
      p.textFont('IBM Plex Sans, sans-serif');
    };

    p.draw = () => {
      const rows = state.rows;
      const cols = state.cols;
      const rightPad = 68;

      metrics.w = p.width - metrics.x - rightPad;
      metrics.h = p.height - metrics.y - 28;
      metrics.cellW = metrics.w / cols;
      metrics.cellH = metrics.h / rows;

      p.background(3, 19, 36);
      p.noStroke();
      p.fill(5, 25, 48);
      p.rect(metrics.x, metrics.y, metrics.w, metrics.h);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = Number(state.velocityGrid[r][c]);
          const px = metrics.x + c * metrics.cellW;
          const py = metrics.y + r * metrics.cellH;

          if (!isWater(state.maskGrid, state.velocityGrid, r, c) || !Number.isFinite(v)) {
            p.fill(11, 34, 56);
          } else {
            const t = clamp((v - state.vMin) / (state.vMax - state.vMin || 1), 0, 1);
            const [rr, gg, bb] = jetRgb(t);
            p.fill(rr, gg, bb);
          }

          p.rect(px, py, metrics.cellW + 0.5, metrics.cellH + 0.5);
        }
      }

      p.stroke(82, 159, 218, 135);
      p.strokeWeight(1);
      const stride = cols >= 20 ? 2 : 1;
      for (let r = 0; r < rows; r += stride) {
        for (let c = 0; c < cols; c += stride) {
          const v = Number(state.velocityGrid[r][c]);
          if (!isWater(state.maskGrid, state.velocityGrid, r, c) || !Number.isFinite(v)) continue;
          const field = slopeFieldAt(state.velocityGrid, state.maskGrid, r, c);
          if (!field) continue;

          const t = clamp((v - state.vMin) / (state.vMax - state.vMin || 1), 0, 1);
          const len = 3.8 + t * 4.8;
          const cx = metrics.x + (c + 0.5) * metrics.cellW;
          const cy = metrics.y + (r + 0.5) * metrics.cellH;
          const dx = field.vx * len;
          const dy = field.vy * len;
          drawArrow(p, cx - dx * 0.5, cy - dy * 0.5, dx, dy);
        }
      }

      p.noFill();
      p.stroke(32, 199, 255, 210);
      p.strokeWeight(2);
      p.beginShape();
      for (let c = 0; c < cols; c++) {
        let bedRow = rows - 1;
        for (let r = rows - 1; r >= 0; r--) {
          if (isWater(state.maskGrid, state.velocityGrid, r, c)) {
            bedRow = r + 1;
            break;
          }
        }
        const px = metrics.x + (c + 0.5) * metrics.cellW;
        const py = metrics.y + Math.min(rows, bedRow) * metrics.cellH;
        p.vertex(px, py);
      }
      p.endShape();

      const crossX = metrics.x + (state.selectedCol + 0.5) * metrics.cellW;
      const crossY = metrics.y + (state.selectedRow + 0.5) * metrics.cellH;
      p.stroke(111, 220, 255, 215);
      p.strokeWeight(1.2);
      p.line(metrics.x, crossY, metrics.x + metrics.w, crossY);
      p.stroke(111, 220, 255, 165);
      p.line(crossX, metrics.y, crossX, metrics.y + metrics.h);

      p.stroke(76, 134, 178);
      p.strokeWeight(1.1);
      p.noFill();
      p.rect(metrics.x, metrics.y, metrics.w, metrics.h);

      const cbW = 10;
      const cbX = metrics.x + metrics.w + 12;
      for (let i = 0; i < metrics.h; i++) {
        const t = 1 - i / metrics.h;
        const [rr, gg, bb] = jetRgb(t);
        p.stroke(rr, gg, bb);
        p.line(cbX, metrics.y + i, cbX + cbW, metrics.y + i);
      }
      p.noStroke();
      p.fill(169, 212, 244);
      p.textSize(10);
      p.textAlign(p.LEFT, p.TOP);
      p.text(`${formatNumber(state.vMax)} m/s`, cbX + cbW + 5, metrics.y + 2);
      p.textAlign(p.LEFT, p.BOTTOM);
      p.text(`${formatNumber(state.vMin)} m/s`, cbX + cbW + 5, metrics.y + metrics.h - 2);

      const selectedV = Number(state.velocityGrid[state.selectedRow][state.selectedCol]);
      const selectedWet = isWater(state.maskGrid, state.velocityGrid, state.selectedRow, state.selectedCol);
      p.textAlign(p.LEFT, p.TOP);
      p.fill(20);
      p.textSize(11);
      const sampleLabel = selectedWet && Number.isFinite(selectedV)
        ? `v=${formatNumber(selectedV)} m/s`
        : 'dry/no-data';
      p.text(sampleLabel, metrics.x + 4, 3);
      p.text('arrows = streamline-velocity slope field', metrics.x + 128, 3);
    };

    p.mouseMoved = () => {
      const hit = projectCellFromMouse(p, metrics, state.rows, state.cols);
      if (!hit) return;
      setSelection(hit.row, hit.col);
    };

    p.mousePressed = () => {
      const hit = projectCellFromMouse(p, metrics, state.rows, state.cols);
      if (!hit) return;
      setSelection(hit.row, hit.col);
    };
  };

  const p5Instance = new p5(sketch, host);

  return {
    redraw: () => p5Instance.redraw(),
    resize: () => {
      const width = Math.max(MIN_CANVAS_WIDTH, Math.floor(host.clientWidth || 640));
      const height = Math.max(320, Math.round(width * 0.58));
      p5Instance.resizeCanvas(width, height, false);
    },
    remove: () => p5Instance.remove(),
  };
}

function createRowProfilePlot(host, state, setSelection) {
  const metrics = {
    x: 36,
    y: 20,
    w: 0,
    h: 0,
  };

  const sketch = (p) => {
    p.setup = () => {
      const width = Math.max(MIN_CANVAS_WIDTH, Math.floor(host.clientWidth || 640));
      const height = 240;
      const canvas = p.createCanvas(width, height);
      canvas.parent(host);
      p.noLoop();
      p.textFont('IBM Plex Sans, sans-serif');
    };

    p.draw = () => {
      metrics.w = p.width - metrics.x - 16;
      metrics.h = p.height - metrics.y - 26;

      p.background(3, 19, 36);
      p.stroke(76, 134, 178, 190);
      p.strokeWeight(1);
      p.noFill();
      p.rect(metrics.x, metrics.y, metrics.w, metrics.h);

      const row = state.selectedRow;
      p.noFill();
      p.stroke(32, 199, 255);
      p.strokeWeight(2);

      let started = false;
      for (let c = 0; c < state.cols; c++) {
        const v = Number(state.velocityGrid[row][c]);
        if (!isWater(state.maskGrid, state.velocityGrid, row, c) || !Number.isFinite(v)) {
          started = false;
          continue;
        }

        const px = metrics.x + (c / Math.max(1, state.cols - 1)) * metrics.w;
        const py = metrics.y + metrics.h - ((v - state.vMin) / (state.vMax - state.vMin || 1)) * metrics.h;
        if (!started) {
          p.beginShape();
          p.vertex(px, py);
          started = true;
        } else {
          p.vertex(px, py);
        }

        const isEnd = c === state.cols - 1 || !isWater(state.maskGrid, state.velocityGrid, row, c + 1);
        if (isEnd && started) {
          p.endShape();
          started = false;
        }
      }

      const cursorX = metrics.x + (state.selectedCol / Math.max(1, state.cols - 1)) * metrics.w;
      p.stroke(245, 172, 61, 190);
      p.strokeWeight(1.4);
      p.line(cursorX, metrics.y, cursorX, metrics.y + metrics.h);

      const cursorV = Number(state.velocityGrid[row][state.selectedCol]);
      if (isWater(state.maskGrid, state.velocityGrid, row, state.selectedCol) && Number.isFinite(cursorV)) {
        const cursorY = metrics.y + metrics.h - ((cursorV - state.vMin) / (state.vMax - state.vMin || 1)) * metrics.h;
        p.noStroke();
        p.fill(245, 172, 61);
        p.circle(cursorX, cursorY, 6);
      }

      p.noStroke();
      p.fill(173, 215, 245);
      p.textSize(10);
      p.textAlign(p.LEFT, p.TOP);
      p.text(`${formatNumber(state.vMax)} m/s`, metrics.x + 3, metrics.y + 2);
      p.textAlign(p.LEFT, p.BOTTOM);
      p.text(`${formatNumber(state.vMin)} m/s`, metrics.x + 3, metrics.y + metrics.h - 2);
      p.textAlign(p.LEFT, p.TOP);
      p.text('Selected row velocity vs cross-stream index', metrics.x + 3, 3);
    };

    p.mouseMoved = () => {
      const hit = projectColFromMouse(p, metrics, state.cols);
      if (hit === null) return;
      setSelection(state.selectedRow, hit);
    };

    p.mousePressed = () => {
      const hit = projectColFromMouse(p, metrics, state.cols);
      if (hit === null) return;
      setSelection(state.selectedRow, hit);
    };
  };

  const p5Instance = new p5(sketch, host);

  return {
    redraw: () => p5Instance.redraw(),
    resize: () => {
      const width = Math.max(MIN_CANVAS_WIDTH, Math.floor(host.clientWidth || 640));
      p5Instance.resizeCanvas(width, 240, false);
    },
    remove: () => p5Instance.remove(),
  };
}

function createDepthAveragedPlot(host, state, setSelection) {
  const metrics = {
    x: 52,
    y: 24,
    w: 0,
    h: 0,
  };

  const yRange = findFiniteRange(state.depthAveraged, state.vMin, state.vMax);
  let dragging = false;

  const sketch = (p) => {
    p.setup = () => {
      const width = Math.max(MIN_CANVAS_WIDTH, Math.floor(host.clientWidth || 640));
      const height = 300;
      const canvas = p.createCanvas(width, height);
      canvas.parent(host);
      p.noLoop();
      p.textFont('IBM Plex Sans, sans-serif');
    };

    p.draw = () => {
      metrics.w = p.width - metrics.x - 22;
      metrics.h = p.height - metrics.y - 38;

      p.background(7, 10, 14);
      drawGrid(p, metrics, 6, 5);

      p.noFill();
      p.stroke(47, 156, 245);
      p.strokeWeight(2.2);

      let started = false;
      p.beginShape();
      for (let c = 0; c < state.cols; c++) {
        const v = state.depthAveraged[c];
        if (!Number.isFinite(v)) {
          if (started) {
            p.endShape();
            p.beginShape();
            started = false;
          }
          continue;
        }

        const px = metrics.x + (c / Math.max(1, state.cols - 1)) * metrics.w;
        const py = mapVelocityToY(v, yRange.min, yRange.max, metrics.y, metrics.h);
        p.vertex(px, py);
        started = true;
      }
      p.endShape();

      const cursorX = metrics.x + (state.selectedCol / Math.max(1, state.cols - 1)) * metrics.w;
      p.stroke(241, 198, 77, 220);
      p.strokeWeight(1.6);
      p.line(cursorX, metrics.y, cursorX, metrics.y + metrics.h);

      const cursorV = state.depthAveraged[state.selectedCol];
      if (Number.isFinite(cursorV)) {
        const cursorY = mapVelocityToY(cursorV, yRange.min, yRange.max, metrics.y, metrics.h);
        p.noStroke();
        p.fill(241, 198, 77);
        p.circle(cursorX, cursorY, 7);
      }

      p.noStroke();
      p.fill(205);
      p.textAlign(p.LEFT, p.TOP);
      p.textSize(11);
      p.text('Depth-averaged streamwise velocity', metrics.x + 4, 3);
      p.text(`${formatNumber(yRange.max)} m/s`, 8, metrics.y + 2);
      p.text(`${formatNumber(yRange.min)} m/s`, 8, metrics.y + metrics.h - 12);
      p.textAlign(p.CENTER, p.BOTTOM);
      p.text('Cross-stream index', metrics.x + metrics.w * 0.5, p.height - 6);
    };

    p.mousePressed = () => {
      const hitCol = projectColFromMouse(p, metrics, state.cols);
      if (hitCol === null) return;

      const lineX = metrics.x + (state.selectedCol / Math.max(1, state.cols - 1)) * metrics.w;
      if (Math.abs(p.mouseX - lineX) < 10 || inPlotRect(p, metrics)) {
        dragging = true;
        setSelection(state.selectedRow, hitCol);
      }
    };

    p.mouseDragged = () => {
      if (!dragging) return;
      const hitCol = projectColFromMouse(p, metrics, state.cols);
      if (hitCol === null) return;
      setSelection(state.selectedRow, hitCol);
    };

    p.mouseReleased = () => {
      dragging = false;
    };
  };

  const p5Instance = new p5(sketch, host);

  return {
    redraw: () => p5Instance.redraw(),
    resize: () => {
      const width = Math.max(MIN_CANVAS_WIDTH, Math.floor(host.clientWidth || 640));
      p5Instance.resizeCanvas(width, 300, false);
    },
    remove: () => p5Instance.remove(),
  };
}

function resizePlot(plot) {
  if (!plot) return;
  plot.resize();
}

function drawArrow(p, x, y, dx, dy) {
  const x2 = x + dx;
  const y2 = y + dy;
  const angle = Math.atan2(dy, dx || 1e-6);
  const head = 2.6;

  p.line(x, y, x2, y2);
  p.line(x2, y2, x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  p.line(x2, y2, x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
}

function slopeFieldAt(velocityGrid, maskGrid, row, col) {
  const left = sampleWetVelocity(velocityGrid, maskGrid, row, col - 1);
  const right = sampleWetVelocity(velocityGrid, maskGrid, row, col + 1);
  const up = sampleWetVelocity(velocityGrid, maskGrid, row - 1, col);
  const down = sampleWetVelocity(velocityGrid, maskGrid, row + 1, col);

  let dUx = 0;
  let dUy = 0;
  let hasX = false;
  let hasY = false;

  if (Number.isFinite(left) && Number.isFinite(right)) {
    dUx = (right - left) * 0.5;
    hasX = true;
  } else if (Number.isFinite(right)) {
    const center = sampleWetVelocity(velocityGrid, maskGrid, row, col);
    if (Number.isFinite(center)) {
      dUx = right - center;
      hasX = true;
    }
  } else if (Number.isFinite(left)) {
    const center = sampleWetVelocity(velocityGrid, maskGrid, row, col);
    if (Number.isFinite(center)) {
      dUx = center - left;
      hasX = true;
    }
  }

  if (Number.isFinite(up) && Number.isFinite(down)) {
    dUy = (down - up) * 0.5;
    hasY = true;
  } else if (Number.isFinite(down)) {
    const center = sampleWetVelocity(velocityGrid, maskGrid, row, col);
    if (Number.isFinite(center)) {
      dUy = down - center;
      hasY = true;
    }
  } else if (Number.isFinite(up)) {
    const center = sampleWetVelocity(velocityGrid, maskGrid, row, col);
    if (Number.isFinite(center)) {
      dUy = center - up;
      hasY = true;
    }
  }

  if (!hasX && !hasY) return null;

  // Tangent to velocity contours: rotate local gradient 90deg.
  let vx = dUy;
  let vy = -dUx;
  const mag = Math.hypot(vx, vy);
  if (mag < 1e-6) return { vx: 1, vy: 0 };

  vx /= mag;
  vy /= mag;
  return { vx, vy };
}

function sampleWetVelocity(velocityGrid, maskGrid, row, col) {
  if (row < 0 || col < 0 || row >= velocityGrid.length || col >= velocityGrid[0].length) return NaN;
  if (!isWater(maskGrid, velocityGrid, row, col)) return NaN;

  const v = Number(velocityGrid[row][col]);
  return Number.isFinite(v) ? v : NaN;
}

function drawGrid(p, metrics, xTicks, yTicks) {
  p.noFill();
  p.stroke(50, 102, 149, 170);
  p.strokeWeight(1);

  for (let i = 0; i <= xTicks; i++) {
    const x = metrics.x + (i / xTicks) * metrics.w;
    p.line(x, metrics.y, x, metrics.y + metrics.h);
  }
  for (let i = 0; i <= yTicks; i++) {
    const y = metrics.y + (i / yTicks) * metrics.h;
    p.line(metrics.x, y, metrics.x + metrics.w, y);
  }

  p.stroke(88, 154, 207, 180);
  p.rect(metrics.x, metrics.y, metrics.w, metrics.h);
}

function mapVelocityToY(v, vMin, vMax, y, h) {
  return y + h - ((v - vMin) / (vMax - vMin || 1)) * h;
}

function projectCellFromMouse(p, metrics, rows, cols) {
  if (!inPlotRect(p, metrics)) return null;

  const col = clamp(Math.floor(((p.mouseX - metrics.x) / Math.max(1e-6, metrics.w)) * cols), 0, cols - 1);
  const row = clamp(Math.floor(((p.mouseY - metrics.y) / Math.max(1e-6, metrics.h)) * rows), 0, rows - 1);
  return { row, col };
}

function projectColFromMouse(p, metrics, cols) {
  if (!inPlotRect(p, metrics)) return null;

  return clamp(Math.round(((p.mouseX - metrics.x) / Math.max(1e-6, metrics.w)) * (cols - 1)), 0, cols - 1);
}

function inPlotRect(p, metrics) {
  return (
    p.mouseX >= metrics.x &&
    p.mouseX <= metrics.x + metrics.w &&
    p.mouseY >= metrics.y &&
    p.mouseY <= metrics.y + metrics.h
  );
}

function buildDepthAveragedVelocity(velocityGrid, maskGrid) {
  const rows = velocityGrid.length;
  const cols = velocityGrid[0].length;
  const out = new Array(cols).fill(NaN);

  for (let c = 0; c < cols; c++) {
    let sum = 0;
    let count = 0;
    for (let r = 0; r < rows; r++) {
      const v = Number(velocityGrid[r][c]);
      if (!isWater(maskGrid, velocityGrid, r, c) || !Number.isFinite(v)) continue;
      sum += v;
      count += 1;
    }
    out[c] = count > 0 ? sum / count : NaN;
  }

  return out;
}

function summarizeRow(velocityGrid, maskGrid, row) {
  let sum = 0;
  let count = 0;

  for (let c = 0; c < velocityGrid[0].length; c++) {
    const v = Number(velocityGrid[row][c]);
    if (!isWater(maskGrid, velocityGrid, row, c) || !Number.isFinite(v)) continue;
    sum += v;
    count += 1;
  }

  return {
    count,
    mean: count > 0 ? sum / count : NaN,
  };
}

function findVelocityRange(velocityGrid, maskGrid) {
  let vMin = Infinity;
  let vMax = -Infinity;

  for (let r = 0; r < velocityGrid.length; r++) {
    for (let c = 0; c < velocityGrid[0].length; c++) {
      const v = Number(velocityGrid[r][c]);
      if (!isWater(maskGrid, velocityGrid, r, c) || !Number.isFinite(v)) continue;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
  }

  if (!Number.isFinite(vMin) || !Number.isFinite(vMax)) return [0, 1];
  return [vMin, vMax];
}

function findFiniteRange(values, fallbackMin, fallbackMax) {
  let min = Infinity;
  let max = -Infinity;

  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: fallbackMin, max: fallbackMax };
  }

  const pad = (max - min) * 0.08 || 0.05;
  return { min: min - pad, max: max + pad };
}

function isWater(maskGrid, velocityGrid, r, c) {
  const m = Number(maskGrid?.[r]?.[c]);
  if (Number.isFinite(m)) return m > 0.5;

  const v = Number(velocityGrid?.[r]?.[c]);
  return Number.isFinite(v) && v !== 0;
}

function jetRgb(t) {
  const tc = clamp(t, 0, 1);
  const r = clamp(1.5 - Math.abs(4 * tc - 3), 0, 1);
  const g = clamp(1.5 - Math.abs(4 * tc - 2), 0, 1);
  const b = clamp(1.5 - Math.abs(4 * tc - 1), 0, 1);

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function formatNumber(v) {
  if (!Number.isFinite(v)) return 'NA';
  return Number(v).toFixed(3);
}
