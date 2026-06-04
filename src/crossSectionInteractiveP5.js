import p5 from 'p5';

let activePanel = null;
const MIN_CANVAS_WIDTH = 280;
const MEASUREMENT_COLORS = [
  '#6EC5FF',
  '#56B36B',
  '#2F3A8F',
  '#DC4A7D',
  '#E39B3D',
  '#B58CFF',
];
const FIELD_OPTIONS = [
  { key: 'streamwise', label: 'Streamwise velocity (m/s)' },
  { key: 'total', label: 'Total velocity (m/s)' },
  { key: 'shear', label: 'Shear velocity (total) (m/s)' },
  { key: 'crosswise', label: 'Cross-wise velocity (m/s)' },
];

export function mountCrossSectionInteractivePlot(container, section, options = {}) {
  destroyCrossSectionInteractivePlot();

  const velocityGrid = section?.mat_summary?.velocity?.sample;
  const maskGrid = section?.mat_summary?.mask?.sample;
  const controlsHost = options?.controlsHost instanceof Element
    ? options.controlsHost
    : null;
  const layoutControlsHost = options?.layoutControlsHost instanceof Element
    ? options.layoutControlsHost
    : null;
  const onLayoutExpandChange = typeof options?.onLayoutExpandChange === 'function'
    ? options.onLayoutExpandChange
    : null;

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
  const fieldGrids = buildFieldGrids(velocityGrid, maskGrid);
  const fieldMeta = buildFieldMeta(fieldGrids, maskGrid);
  const activeFieldKey = fieldMeta.streamwise ? 'streamwise' : Object.keys(fieldMeta)[0];
  const activeField = fieldMeta[activeFieldKey];

  const state = {
    section,
    baseVelocityGrid: velocityGrid,
    velocityGrid,
    maskGrid,
    rows,
    cols,
    depthStepM: estimateDepthStepMeters(section, rows),
    fieldGrids,
    fieldMeta,
    activeFieldKey,
    vMin: activeField.vMin,
    vMax: activeField.vMax,
    depthAveraged: buildDepthAveragedVelocity(activeField.grid, maskGrid),
    showCrosswiseArrows: true,
    selectedRow: clamp(Math.floor(rows * 0.42), 0, rows - 1),
    selectedCol: clamp(Math.floor(cols * 0.5), 0, cols - 1),
    measurementMode: false,
    measurementDraft: null,
    measurements: [],
    measurementSeq: 0,
    selectedMeasurementId: null,
    showSelectedOnly: false,
    layoutExpanded: false,
  };

  const layoutControlMarkup = `
    <div class="measure-toolbar measure-toolbar-header measure-toolbar-layout">
      <button type="button" class="measure-layout-toggle" data-layout-toggle>Expand side panel</button>
    </div>
  `;
  const measureControlsMarkup = `
    <div class="measure-toolbar measure-toolbar-header">
      <button type="button" data-measure-toggle>Start measurement mode</button>
      <button type="button" data-measure-clear>Clear all</button>
      <button type="button" data-measure-export>Export to Excel</button>
      <button type="button" data-measure-prev>Prev transect</button>
      <button type="button" data-measure-next>Next transect</button>
      <label class="plot-control plot-control-check">
        <input data-measure-show-selected-only type="checkbox" />
        Show only selected transect
      </label>
    </div>
    <div class="plot-readout plot-readout-measure-top" data-measure-readout>No measurements yet</div>
  `;

  if (controlsHost) {
    controlsHost.innerHTML = layoutControlsHost ? measureControlsMarkup : `${layoutControlMarkup}${measureControlsMarkup}`;
  }

  if (layoutControlsHost) {
    layoutControlsHost.innerHTML = layoutControlMarkup;
  }

  container.innerHTML = `
    <div class="cross-section-interactive">
      <div class="cross-section-interactive-grid">
        <section class="plot-panel">
          <div class="plot-head">
            <h4 class="plot-title">Velocity Cross-Section (Hover to inspect)</h4>
            <div class="plot-readout" data-heat-readout></div>
          </div>
          <div class="plot-controls">
            <label class="plot-control">
              <span>Field</span>
              <select data-field-select>
                ${FIELD_OPTIONS.map((item) => `<option value="${item.key}">${escapeHtml(item.label)}</option>`).join('')}
              </select>
            </label>
            <label class="plot-control plot-control-check">
              <input data-arrow-toggle type="checkbox" checked />
              Show cross-wise arrows
            </label>
          </div>
          <p class="plot-hint">Cross-wise and shear fields are prototype-derived from the available velocity grid.</p>
          <div data-heat-host class="cross-p5-host cross-p5-host-heat"></div>
        </section>

        <section class="plot-panel plot-panel-measurements">
          <div class="plot-head plot-head-measure">
            <h4 class="plot-title">Velocity vs Height Above Bed</h4>
            ${controlsHost ? '' : `<div class="plot-head-actions plot-head-actions-measure">${layoutControlMarkup}${measureControlsMarkup}</div>`}
          </div>
          <div data-measure-list class="measure-list"></div>
          <div data-measure-profile-host class="cross-p5-host cross-p5-host-measure"></div>
        </section>
      </div>
    </div>
  `;

  const queryControl = (selector) => {
    if (layoutControlsHost) {
      const hit = layoutControlsHost.querySelector(selector);
      if (hit) return hit;
    }
    if (controlsHost) {
      const hit = controlsHost.querySelector(selector);
      if (hit) return hit;
    }
    return container.querySelector(selector);
  };

  const refs = {
    heatReadout: container.querySelector('[data-heat-readout]'),
    measureReadout: queryControl('[data-measure-readout]'),
    heatHost: container.querySelector('[data-heat-host]'),
    measureToggleBtn: queryControl('[data-measure-toggle]'),
    measureClearBtn: queryControl('[data-measure-clear]'),
    measureExportBtn: queryControl('[data-measure-export]'),
    measurePrevBtn: queryControl('[data-measure-prev]'),
    measureNextBtn: queryControl('[data-measure-next]'),
    measureShowSelectedOnly: queryControl('[data-measure-show-selected-only]'),
    layoutToggleBtn: queryControl('[data-layout-toggle]'),
    fieldSelect: container.querySelector('[data-field-select]'),
    arrowToggle: container.querySelector('[data-arrow-toggle]'),
    measureList: container.querySelector('[data-measure-list]'),
    measureProfileHost: container.querySelector('[data-measure-profile-host]'),
  };

  const syncSelectedMeasurement = () => {
    if (state.measurements.length === 0) {
      state.selectedMeasurementId = null;
      return null;
    }

    const selected = state.measurements.find((m) => m.id === state.selectedMeasurementId);
    if (selected) return selected;

    state.selectedMeasurementId = state.measurements[0].id;
    return state.measurements[0];
  };

  const cycleSelectedMeasurement = (direction) => {
    if (state.measurements.length === 0) return;
    const currentIndex = state.measurements.findIndex((m) => m.id === state.selectedMeasurementId);
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    const step = direction >= 0 ? 1 : -1;
    const nextIndex = (startIndex + step + state.measurements.length) % state.measurements.length;
    state.selectedMeasurementId = state.measurements[nextIndex].id;
    redrawAll();
  };

  const redrawAll = () => {
    if (!activePanel) return;
    activePanel.instances.heat?.redraw();
    activePanel.instances.measure?.redraw();
    updateReadouts();
    updateMeasurementsUi();
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

    const fieldLabel = state.fieldMeta[state.activeFieldKey]?.label || 'Velocity';
    refs.heatReadout.textContent = wet && Number.isFinite(cellV)
      ? `${fieldLabel} at row ${row + 1}, col ${col + 1}: ${formatNumber(cellV)} m/s`
      : `${fieldLabel} at row ${row + 1}, col ${col + 1}: dry/no-data`;

    const selected = syncSelectedMeasurement();
    const visibilityLabel = state.showSelectedOnly && selected
      ? `showing ${selected.label} only`
      : 'showing all transects';

    if (refs.measureReadout) {
      refs.measureReadout.textContent = state.measurements.length > 0
        ? `${state.measurements.length} line(s) collected • ${visibilityLabel}`
        : 'No measurements yet';
    }

    if (refs.layoutToggleBtn) {
      refs.layoutToggleBtn.textContent = state.layoutExpanded ? 'Collapse side panel' : 'Expand side panel';
      refs.layoutToggleBtn.classList.toggle('is-active', state.layoutExpanded);
    }
  };

  const setActiveField = (fieldKey) => {
    const nextField = state.fieldMeta[fieldKey];
    if (!nextField) return;

    state.activeFieldKey = fieldKey;
    state.velocityGrid = nextField.grid;
    state.vMin = nextField.vMin;
    state.vMax = nextField.vMax;
    state.depthAveraged = buildDepthAveragedVelocity(nextField.grid, state.maskGrid);
    redrawAll();
  };

  const addMeasurement = (start, end) => {
    if (Math.hypot(end.col - start.col, end.row - start.row) < 0.8) return false;
    const samples = sampleMeasurementLine(state, start, end);
    if (samples.length < 2) return false;

    state.measurementSeq += 1;
    const id = state.measurementSeq;
    state.measurements.push({
      id,
      label: `M${id}`,
      color: MEASUREMENT_COLORS[(id - 1) % MEASUREMENT_COLORS.length],
      fieldKey: state.activeFieldKey,
      fieldLabel: state.fieldMeta[state.activeFieldKey]?.label || 'Velocity',
      start,
      end,
      samples,
    });
    state.selectedMeasurementId = id;
    redrawAll();
    return true;
  };

  const setMeasurementDraft = (start, end) => {
    if (!start || !end) {
      state.measurementDraft = null;
      return;
    }
    state.measurementDraft = { start, end };
  };

  const heatPlot = createHeatmapPlot(refs.heatHost, state, setSelection, addMeasurement, setMeasurementDraft);
  const measurePlot = createMeasurementProfilePlot(refs.measureProfileHost, state);

  refs.measureToggleBtn?.addEventListener('click', () => {
    state.measurementMode = !state.measurementMode;
    state.measurementDraft = null;
    redrawAll();
  });

  refs.measureClearBtn?.addEventListener('click', () => {
    state.measurements = [];
    state.selectedMeasurementId = null;
    state.measurementDraft = null;
    redrawAll();
  });

  refs.measureExportBtn?.addEventListener('click', () => {
    if (state.measurements.length === 0) return;
    exportMeasurementsWorkbook(state, section?.transect || section?.mat_file || 'cross_section');
  });

  refs.measurePrevBtn?.addEventListener('click', () => {
    cycleSelectedMeasurement(-1);
  });

  refs.measureNextBtn?.addEventListener('click', () => {
    cycleSelectedMeasurement(1);
  });

  refs.measureShowSelectedOnly?.addEventListener('change', () => {
    state.showSelectedOnly = Boolean(refs.measureShowSelectedOnly.checked);
    redrawAll();
  });

  refs.layoutToggleBtn?.addEventListener('click', () => {
    state.layoutExpanded = !state.layoutExpanded;
    onLayoutExpandChange?.(state.layoutExpanded);
    updateReadouts();
  });

  refs.fieldSelect?.addEventListener('change', () => {
    setActiveField(refs.fieldSelect.value);
  });

  refs.arrowToggle?.addEventListener('change', () => {
    state.showCrosswiseArrows = Boolean(refs.arrowToggle.checked);
    redrawAll();
  });

  const updateMeasurementsUi = () => {
    if (!refs.measureList) return;
    syncSelectedMeasurement();

    if (refs.measureToggleBtn) {
      refs.measureToggleBtn.textContent = state.measurementMode ? 'Stop measurement mode' : 'Start measurement mode';
      refs.measureToggleBtn.classList.toggle('is-active', state.measurementMode);
    }
    if (refs.measureShowSelectedOnly) refs.measureShowSelectedOnly.checked = state.showSelectedOnly;
    if (refs.measurePrevBtn) refs.measurePrevBtn.disabled = state.measurements.length < 2;
    if (refs.measureNextBtn) refs.measureNextBtn.disabled = state.measurements.length < 2;
    if (refs.measureClearBtn) refs.measureClearBtn.disabled = state.measurements.length === 0;
    if (refs.measureExportBtn) refs.measureExportBtn.disabled = state.measurements.length === 0;

    if (state.measurements.length === 0) {
      refs.measureList.innerHTML = '<p class="plot-hint">Enable measurement mode, then click-drag on the heatmap to capture a line.</p>';
      return;
    }

    refs.measureList.innerHTML = state.measurements.map((m) => `
      <div class="measure-item ${m.id === state.selectedMeasurementId ? 'is-selected' : ''}" data-measure-id="${m.id}">
        <span class="measure-swatch" style="background:${escapeHtml(m.color)}"></span>
        <button type="button" class="measure-select">${escapeHtml(m.label)}</button>
        <span class="measure-meta">${escapeHtml(m.fieldLabel)} • ${formatNumber(measurementLength(m))} m • ${m.samples.length} samples</span>
        <button type="button" class="measure-delete" data-action="delete">Remove</button>
      </div>
    `).join('');

    refs.measureList.querySelectorAll('[data-measure-id]').forEach((item) => {
      const id = Number(item.getAttribute('data-measure-id'));
      item.querySelector('.measure-select')?.addEventListener('click', () => {
        state.selectedMeasurementId = id;
        redrawAll();
      });
      item.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
        state.measurements = state.measurements.filter((m) => m.id !== id);
        if (state.selectedMeasurementId === id) {
          state.selectedMeasurementId = state.measurements[0]?.id ?? null;
        }
        redrawAll();
      });
    });
  };

  let resizeObserver = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      resizePlot(heatPlot);
      resizePlot(measurePlot);
      redrawAll();
    });
    resizeObserver.observe(container);
  }

  activePanel = {
    state,
    refs,
    controlsHost,
    instances: {
      heat: heatPlot,
      measure: measurePlot,
    },
    resizeObserver,
    onLayoutExpandChange,
    updateReadouts,
    redrawAll,
  };

  onLayoutExpandChange?.(false);
  updateReadouts();
  updateMeasurementsUi();
  if (refs.fieldSelect) refs.fieldSelect.value = state.activeFieldKey;
  if (refs.arrowToggle) refs.arrowToggle.checked = state.showCrosswiseArrows;
  if (refs.measureShowSelectedOnly) refs.measureShowSelectedOnly.checked = state.showSelectedOnly;
  redrawAll();
  return true;
}

export function refreshCrossSectionInteractivePlot() {
  if (!activePanel) return;

  resizePlot(activePanel.instances.heat);
  resizePlot(activePanel.instances.measure);
  activePanel.redrawAll();
}

export function destroyCrossSectionInteractivePlot() {
  if (!activePanel) return;

  if (activePanel.state?.layoutExpanded) {
    activePanel.onLayoutExpandChange?.(false);
  }
  if (activePanel.controlsHost) {
    activePanel.controlsHost.innerHTML = '';
  }
  activePanel.resizeObserver?.disconnect();
  activePanel.instances.heat?.remove();
  activePanel.instances.measure?.remove();
  activePanel = null;
}

function createHeatmapPlot(host, state, setSelection, addMeasurement, setMeasurementDraft) {
  const metrics = {
    x: 44,
    y: 22,
    w: 0,
    h: 0,
    cellW: 0,
    cellH: 0,
  };

  const sketch = (p) => {
    let dragStart = null;

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
            const [rr, gg, bb] = colorForActiveField(state, v);
            p.fill(rr, gg, bb);
          }

          p.rect(px, py, metrics.cellW + 0.5, metrics.cellH + 0.5);
        }
      }

      if (state.showCrosswiseArrows) {
        p.stroke(12, 12, 12, 165);
        p.strokeWeight(1);
        const stride = cols >= 20 ? 2 : 1;
        for (let r = 0; r < rows; r += stride) {
          for (let c = 0; c < cols; c += stride) {
            const v = Number(state.baseVelocityGrid[r][c]);
            if (!isWater(state.maskGrid, state.baseVelocityGrid, r, c) || !Number.isFinite(v)) continue;
            const field = slopeFieldAt(state.baseVelocityGrid, state.maskGrid, r, c);
            if (!field) continue;

            const t = clamp((Math.abs(v) - state.vMin) / (Math.abs(state.vMax - state.vMin) || 1), 0, 1);
            const len = 3.8 + t * 4.8;
            const cx = metrics.x + (c + 0.5) * metrics.cellW;
            const cy = metrics.y + (r + 0.5) * metrics.cellH;
            const dx = field.vx * len;
            const dy = field.vy * len;
            drawArrow(p, cx - dx * 0.5, cy - dy * 0.5, dx, dy);
          }
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

      const selectedMeasurement = state.measurements.find((m) => m.id === state.selectedMeasurementId) || state.measurements[0] || null;
      const measurementsToDraw = state.showSelectedOnly && selectedMeasurement ? [selectedMeasurement] : state.measurements;
      measurementsToDraw.forEach((m) => {
        drawMeasurementLine(p, metrics, m.start, m.end, m.color, m.id === state.selectedMeasurementId ? 2.8 : 1.6);
      });
      if (state.measurementDraft?.start && state.measurementDraft?.end) {
        drawMeasurementLine(p, metrics, state.measurementDraft.start, state.measurementDraft.end, '#ffffff', 1.2);
      }

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
        const value = lerp(state.vMax, state.vMin, i / Math.max(1, metrics.h));
        const [rr, gg, bb] = colorForActiveField(state, value);
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
      if (state.activeFieldKey === 'crosswise') {
        p.textAlign(p.LEFT, p.CENTER);
        p.text('0.000', cbX + cbW + 5, metrics.y + metrics.h * 0.5);
        p.textAlign(p.LEFT, p.TOP);
        p.text('(-) left bank', cbX - 3, metrics.y + metrics.h + 8);
        p.text('(+) right bank', cbX - 3, metrics.y + metrics.h + 20);
      }

      const selectedV = Number(state.velocityGrid[state.selectedRow][state.selectedCol]);
      const selectedWet = isWater(state.maskGrid, state.velocityGrid, state.selectedRow, state.selectedCol);
      p.textAlign(p.LEFT, p.TOP);
      p.fill(20);
      p.textSize(11);
      const sampleLabel = selectedWet && Number.isFinite(selectedV)
        ? `v=${formatNumber(selectedV)} m/s`
        : 'dry/no-data';
      p.text(sampleLabel, metrics.x + 4, 3);
      if (state.showCrosswiseArrows) {
        p.text('black arrows = cross-wise direction proxy', metrics.x + 128, 3);
      }
    };

    p.mouseMoved = () => {
      if (state.measurementMode) return;
      const hit = projectCellFromMouse(p, metrics, state.rows, state.cols);
      if (!hit) return;
      setSelection(hit.row, hit.col);
    };

    p.mousePressed = () => {
      const hit = projectCellFromMouse(p, metrics, state.rows, state.cols);
      if (!hit) return;
      if (state.measurementMode) {
        dragStart = { row: hit.row, col: hit.col };
        setMeasurementDraft(dragStart, dragStart);
        return;
      }
      setSelection(hit.row, hit.col);
    };

    p.mouseDragged = () => {
      if (!state.measurementMode || !dragStart) return;
      const hit = projectCellFromMouse(p, metrics, state.rows, state.cols);
      if (!hit) return;
      setMeasurementDraft(dragStart, { row: hit.row, col: hit.col });
      p.redraw();
    };

    p.mouseReleased = () => {
      if (!state.measurementMode || !dragStart) return;
      const hit = projectCellFromMouse(p, metrics, state.rows, state.cols);
      if (hit) {
        addMeasurement(dragStart, { row: hit.row, col: hit.col });
      }
      dragStart = null;
      setMeasurementDraft(null, null);
      p.redraw();
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

function createMeasurementProfilePlot(host, state) {
  const metrics = { x: 62, y: 20, w: 0, h: 0 };
  const sketch = (p) => {
    p.setup = () => {
      const width = Math.max(MIN_CANVAS_WIDTH, Math.floor(host.clientWidth || 640));
      const canvas = p.createCanvas(width, 300);
      canvas.parent(host);
      p.noLoop();
      p.textFont('IBM Plex Sans, sans-serif');
    };

    p.draw = () => {
      metrics.w = p.width - metrics.x - 20;
      metrics.h = p.height - metrics.y - 32;
      p.background(3, 19, 36);
      drawGrid(p, metrics, 6, 5);

      const selected = state.measurements.find((m) => m.id === state.selectedMeasurementId) || state.measurements[0];
      if (!selected) {
        p.noStroke();
        p.fill(185);
        p.textSize(12);
        p.textAlign(p.CENTER, p.CENTER);
        p.text('No measurement selected', p.width / 2, p.height / 2);
        return;
      }

      const xRange = findFiniteRange(selected.samples.map((s) => s.value), state.vMin, state.vMax);
      const yRange = findFiniteRange(selected.samples.map((s) => s.distanceFromBed), 0, state.rows * state.depthStepM);

      p.noFill();
      p.strokeWeight(2.2);
      p.stroke(...hexToRgb(selected.color));
      p.beginShape();
      selected.samples.forEach((s) => {
        if (!Number.isFinite(s.value) || !Number.isFinite(s.distanceFromBed)) return;
        const px = metrics.x + ((s.value - xRange.min) / (xRange.max - xRange.min || 1)) * metrics.w;
        const py = metrics.y + metrics.h - ((s.distanceFromBed - yRange.min) / (yRange.max - yRange.min || 1)) * metrics.h;
        p.vertex(px, py);
      });
      p.endShape();

      p.noStroke();
      p.fill(205);
      p.textSize(11);
      p.textAlign(p.LEFT, p.TOP);
      p.text(selected.fieldLabel || 'Velocity (m/s)', metrics.x + 6, 3);
      p.textAlign(p.LEFT, p.BOTTOM);
      p.text('Distance from bed (m)', 8, metrics.y + metrics.h);
      p.textAlign(p.CENTER, p.BOTTOM);
      p.text('Value (m/s)', metrics.x + metrics.w * 0.5, p.height - 6);
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
      p.text(`Selected row: ${state.fieldMeta[state.activeFieldKey]?.label || 'Velocity'}`, metrics.x + 3, 3);
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
      const yRange = findFiniteRange(state.depthAveraged, state.vMin, state.vMax);
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
      p.text(`Depth-averaged: ${state.fieldMeta[state.activeFieldKey]?.label || 'Velocity'}`, metrics.x + 4, 3);
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

function sampleMeasurementLine(state, start, end) {
  const span = Math.hypot(end.col - start.col, end.row - start.row);
  const steps = Math.max(12, Math.ceil(span * 4));
  const out = [];
  const xCoords = sectionXCoords(state.section, state.cols);
  let cumulative = 0;
  let prevXPos = null;
  let prevYPos = null;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const row = lerp(start.row, end.row, t);
    const col = lerp(start.col, end.col, t);
    const value = sampleVelocityBilinear(state.velocityGrid, state.maskGrid, row, col);
    const colInt = clamp(Math.round(col), 0, state.cols - 1);
    const bedRow = estimateBedRowAtCol(state.velocityGrid, state.maskGrid, colInt);
    const xPosition = sampleCrossSectionX(xCoords, col);
    const yPosition = row * state.depthStepM;
    if (prevXPos !== null && prevYPos !== null) {
      cumulative += Math.hypot(xPosition - prevXPos, yPosition - prevYPos);
    }
    prevXPos = xPosition;
    prevYPos = yPosition;

    out.push({
      sampleIndex: i + 1,
      t,
      distanceAlongLine: cumulative,
      xPosition,
      yPosition,
      row,
      col,
      distanceFromBed: Number.isFinite(bedRow) ? (bedRow - row) * state.depthStepM : NaN,
      value,
    });
  }
  return out;
}

function sampleVelocityBilinear(velocityGrid, maskGrid, row, col) {
  const r0 = clamp(Math.floor(row), 0, velocityGrid.length - 1);
  const c0 = clamp(Math.floor(col), 0, velocityGrid[0].length - 1);
  const r1 = clamp(r0 + 1, 0, velocityGrid.length - 1);
  const c1 = clamp(c0 + 1, 0, velocityGrid[0].length - 1);
  const tr = row - r0;
  const tc = col - c0;
  const candidates = [
    { r: r0, c: c0, w: (1 - tr) * (1 - tc) },
    { r: r0, c: c1, w: (1 - tr) * tc },
    { r: r1, c: c0, w: tr * (1 - tc) },
    { r: r1, c: c1, w: tr * tc },
  ];
  let weighted = 0;
  let weightSum = 0;
  candidates.forEach(({ r, c, w }) => {
    const v = Number(velocityGrid[r][c]);
    if (!isWater(maskGrid, velocityGrid, r, c) || !Number.isFinite(v)) return;
    weighted += v * w;
    weightSum += w;
  });
  return weightSum > 0 ? weighted / weightSum : NaN;
}

function estimateBedRowAtCol(velocityGrid, maskGrid, col) {
  for (let r = velocityGrid.length - 1; r >= 0; r--) {
    if (isWater(maskGrid, velocityGrid, r, col)) return r + 1;
  }
  return NaN;
}

function sectionXCoords(section, cols) {
  const xinterp = Array.isArray(section?.mat_summary?.xinterp) ? section.mat_summary.xinterp : null;
  if (xinterp && xinterp.length > 1) return xinterp.map((v) => Number(v));
  return Array.from({ length: cols }, (_, i) => i);
}

function estimateDepthStepMeters(section, rows) {
  const zStats = section?.mat_summary?.z_stats || {};
  const zMin = Number(zStats.min);
  const zMax = Number(zStats.max);
  if (Number.isFinite(zMin) && Number.isFinite(zMax) && rows > 1) {
    const span = Math.abs(zMax - zMin);
    if (span > 0.001) return span / rows;
  }
  return 1;
}

function sampleCrossSectionX(xs, colFloat) {
  const c = clamp(colFloat, 0, xs.length - 1);
  const lo = Math.floor(c);
  const hi = Math.min(xs.length - 1, lo + 1);
  const t = c - lo;
  const a = Number(xs[lo]);
  const b = Number(xs[hi]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return c;
  return lerp(a, b, t);
}

function drawMeasurementLine(p, metrics, start, end, colorHex, strokeW) {
  const x1 = metrics.x + (start.col + 0.5) * metrics.cellW;
  const y1 = metrics.y + (start.row + 0.5) * metrics.cellH;
  const x2 = metrics.x + (end.col + 0.5) * metrics.cellW;
  const y2 = metrics.y + (end.row + 0.5) * metrics.cellH;
  const [r, g, b] = hexToRgb(colorHex);
  p.stroke(r, g, b, 240);
  p.strokeWeight(strokeW);
  p.line(x1, y1, x2, y2);
  p.noStroke();
  p.fill(r, g, b, 240);
  p.circle(x1, y1, 6);
  p.circle(x2, y2, 6);
}

function measurementLength(m) {
  const lastSample = Array.isArray(m?.samples) ? m.samples[m.samples.length - 1] : null;
  return Number.isFinite(Number(lastSample?.distanceAlongLine))
    ? Number(lastSample.distanceAlongLine)
    : Math.hypot(m.end.col - m.start.col, m.end.row - m.start.row);
}

function hexToRgb(hex) {
  const raw = String(hex || '#66ccff').replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw.padEnd(6, '0').slice(0, 6);
  const intVal = Number.parseInt(full, 16);
  return [(intVal >> 16) & 255, (intVal >> 8) & 255, intVal & 255];
}

function exportMeasurementsWorkbook(state, sectionName) {
  const workbook = buildExcelXmlWorkbook(state);
  const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const link = document.createElement('a');
  const safeName = sanitizeFilename(sectionName || 'cross_section');
  link.href = URL.createObjectURL(blob);
  link.download = `${safeName}_measurements.xls`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function buildExcelXmlWorkbook(state) {
  const sheets = state.measurements.map((m) => {
    const rows = [
      ['measurement', m.label, 'field', m.fieldLabel || 'Velocity'],
      ['sample_index', 'x_position', 'y_position', 'distance_from_bed', 'value', 'distance_along_line', 'row', 'col', 't'],
      ...m.samples.map((s) => [
        s.sampleIndex,
        s.xPosition,
        s.yPosition,
        s.distanceFromBed,
        s.value,
        s.distanceAlongLine,
        s.row,
        s.col,
        s.t,
      ]),
    ];
    const table = rows.map((cells) => `<Row>${cells.map((cell) => buildExcelCell(cell)).join('')}</Row>`).join('');
    const sheetName = sanitizeWorksheetName(m.label);
    return `<Worksheet ss:Name="${escapeXml(sheetName)}"><Table>${table}</Table></Worksheet>`;
  }).join('');

  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">${sheets}</Workbook>`;
}

function buildExcelCell(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${escapeXml(value == null ? '' : String(value))}</Data></Cell>`;
}

function sanitizeWorksheetName(name) {
  const cleaned = String(name || 'Sheet').replace(/[\\/:*?[\]]/g, '_').trim();
  return cleaned.slice(0, 31) || 'Sheet';
}

function sanitizeFilename(name) {
  return String(name || 'cross_section').replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'cross_section';
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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

function buildFieldGrids(streamwiseGrid, maskGrid) {
  const totalGrid = streamwiseGrid.map((row) => row.map((v) => {
    const numeric = Number(v);
    return Number.isFinite(numeric) ? Math.abs(numeric) : NaN;
  }));
  const shearGrid = buildShearVelocityProxyGrid(streamwiseGrid, maskGrid);
  const crosswiseGrid = buildCrosswiseVelocityProxyGrid(streamwiseGrid, maskGrid);

  return {
    streamwise: streamwiseGrid,
    total: totalGrid,
    shear: shearGrid,
    crosswise: crosswiseGrid,
  };
}

function buildFieldMeta(fieldGrids, maskGrid) {
  const out = {};
  FIELD_OPTIONS.forEach((option) => {
    const grid = fieldGrids[option.key];
    if (!Array.isArray(grid) || !Array.isArray(grid[0])) return;
    const [vMin, vMax] = option.key === 'crosswise'
      ? findSymmetricVelocityRange(grid, maskGrid)
      : findVelocityRange(grid, maskGrid);
    out[option.key] = {
      key: option.key,
      label: option.label,
      grid,
      vMin,
      vMax,
      colorMode: option.key === 'crosswise' ? 'diverging' : 'continuous',
    };
  });
  return out;
}

function buildShearVelocityProxyGrid(velocityGrid, maskGrid) {
  const rows = velocityGrid.length;
  const cols = velocityGrid[0].length;
  const out = Array.from({ length: rows }, () => new Array(cols).fill(NaN));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isWater(maskGrid, velocityGrid, r, c)) continue;
      const center = Number(velocityGrid[r][c]);
      if (!Number.isFinite(center)) continue;

      const left = sampleWetVelocity(velocityGrid, maskGrid, r, c - 1);
      const right = sampleWetVelocity(velocityGrid, maskGrid, r, c + 1);
      const up = sampleWetVelocity(velocityGrid, maskGrid, r - 1, c);
      const down = sampleWetVelocity(velocityGrid, maskGrid, r + 1, c);
      const dx = Number.isFinite(left) && Number.isFinite(right)
        ? (right - left) * 0.5
        : Number.isFinite(right)
          ? right - center
          : Number.isFinite(left)
            ? center - left
            : 0;
      const dy = Number.isFinite(up) && Number.isFinite(down)
        ? (down - up) * 0.5
        : Number.isFinite(down)
          ? down - center
          : Number.isFinite(up)
            ? center - up
            : 0;
      out[r][c] = Math.hypot(dx, dy);
    }
  }
  return out;
}

function buildCrosswiseVelocityProxyGrid(velocityGrid, maskGrid) {
  const rows = velocityGrid.length;
  const cols = velocityGrid[0].length;
  const out = Array.from({ length: rows }, () => new Array(cols).fill(NaN));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isWater(maskGrid, velocityGrid, r, c)) continue;
      const speed = Number(velocityGrid[r][c]);
      if (!Number.isFinite(speed)) continue;
      const field = slopeFieldAt(velocityGrid, maskGrid, r, c);
      if (!field) continue;
      out[r][c] = speed * field.vx;
    }
  }
  return out;
}

function findSymmetricVelocityRange(velocityGrid, maskGrid) {
  let maxAbs = 0;
  for (let r = 0; r < velocityGrid.length; r++) {
    for (let c = 0; c < velocityGrid[0].length; c++) {
      const v = Number(velocityGrid[r][c]);
      if (!isWater(maskGrid, velocityGrid, r, c) || !Number.isFinite(v)) continue;
      const absV = Math.abs(v);
      if (absV > maxAbs) maxAbs = absV;
    }
  }
  if (!(maxAbs > 0)) return [-1, 1];
  return [-maxAbs, maxAbs];
}

function colorForActiveField(state, value) {
  if (!Number.isFinite(value)) return [11, 34, 56];
  const meta = state.fieldMeta[state.activeFieldKey];
  if (meta?.colorMode === 'diverging') {
    const maxAbs = Math.max(Math.abs(state.vMin), Math.abs(state.vMax), 1e-6);
    const t = clamp(value / maxAbs, -1, 1);
    return divergingRgb(t);
  }
  const t = clamp((value - state.vMin) / (state.vMax - state.vMin || 1), 0, 1);
  return continuousRgb(t);
}

function continuousRgb(t) {
  const stops = [
    { t: 0.0, hex: 0x12395f },
    { t: 0.35, hex: 0x2f86c9 },
    { t: 0.65, hex: 0x45b58f },
    { t: 0.85, hex: 0xcfd46e },
    { t: 1.0, hex: 0xffefb2 },
  ];
  return sampleRampRgb(stops, t);
}

function divergingRgb(tSigned) {
  // negative (left-bank) = blue, near-zero = white, positive (right-bank) = red
  const t = clamp((tSigned + 1) * 0.5, 0, 1);
  const stops = [
    { t: 0.0, hex: 0x2b6cb0 },
    { t: 0.5, hex: 0xf5f7fb },
    { t: 1.0, hex: 0xc9303e },
  ];
  return sampleRampRgb(stops, t);
}

function sampleRampRgb(stops, t) {
  const u = clamp(t, 0, 1);
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (u > b.t) continue;
    const localT = (u - a.t) / Math.max(1e-6, b.t - a.t);
    const c = colorLerpHex(a.hex, b.hex, localT);
    return [c.r, c.g, c.b];
  }
  const last = hexToRgb(`#${stops[stops.length - 1].hex.toString(16).padStart(6, '0')}`);
  return last;
}

function colorLerpHex(aHex, bHex, t) {
  const a = {
    r: (aHex >> 16) & 255,
    g: (aHex >> 8) & 255,
    b: aHex & 255,
  };
  const b = {
    r: (bHex >> 16) & 255,
    g: (bHex >> 8) & 255,
    b: bHex & 255,
  };
  return {
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
  };
}

function isWater(maskGrid, velocityGrid, r, c) {
  const m = Number(maskGrid?.[r]?.[c]);
  if (Number.isFinite(m)) return m > 0.5;

  const v = Number(velocityGrid?.[r]?.[c]);
  return Number.isFinite(v) && v !== 0;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function formatNumber(v) {
  if (!Number.isFinite(v)) return 'NA';
  return Number(v).toFixed(3);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
