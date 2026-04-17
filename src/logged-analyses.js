import {
  deleteLoggedAnalysis,
  getLoggedAnalyses,
} from './analysisStore.js';

const els = {
  grid: document.getElementById('loggedAnalysesGrid'),
  backHome: document.getElementById('loggedBackHome'),
  newAnalysis: document.getElementById('loggedNewAnalysis'),
};

initLoggedAnalysesPage();

function initLoggedAnalysesPage() {
  els.backHome?.addEventListener('click', () => {
    window.location.href = '/';
  });

  els.newAnalysis?.addEventListener('click', () => {
    window.location.href = '/log-analysis.html?mode=setup';
  });

  renderLoggedAnalyses();
}

function renderLoggedAnalyses() {
  if (!els.grid) return;

  const analyses = getLoggedAnalyses();
  const cards = [];

  cards.push(`
    <article class="logged-card logged-card-demo">
      <div class="logged-card-top">
        <div class="logged-hero"></div>
      </div>
      <h2>Huslia Demo River</h2>
      <p class="logged-date">Default demo</p>
      <p class="logged-investigator">Ready to explore</p>
      <p class="logged-description">Open the preloaded Huslia package to preview the 3D scene and bottom sonar mesh.</p>
      <div class="logged-actions">
        <button type="button" class="logged-open-btn" data-action="open-demo">Open</button>
      </div>
    </article>
  `);

  if (analyses.length === 0) {
    cards.push(`
      <article class="logged-card logged-card-empty">
        <div class="logged-card-top">
          <div class="logged-hero"></div>
        </div>
        <h2>No Logged Rivers Yet</h2>
        <p class="logged-date">Create one from Load River Analysis</p>
        <p class="logged-investigator">Saved sessions will appear here.</p>
        <div class="logged-actions">
          <button type="button" class="logged-open-btn" data-action="new-analysis">New Analysis</button>
        </div>
      </article>
    `);
  } else {
    for (const entry of analyses) {
      const analysisId = entry?.id != null ? String(entry.id) : '';
      const name = sanitize(entry?.name || 'Untitled');
      const dateLabel = sanitize(entry?.dateLabel || 'Date not set');
      const investigator = sanitize(entry?.investigator || 'Investigator not set');
      const description = sanitize(entry?.description || 'Saved uploaded analysis package');

      cards.push(`
        <article class="logged-card" data-analysis-id="${analysisId}">
          <div class="logged-card-top">
            <div class="logged-hero"></div>
          </div>
          <h2>${name}</h2>
          <p class="logged-date">${dateLabel}</p>
          <p class="logged-investigator">${investigator}</p>
          <p class="logged-description">${description}</p>
          <div class="logged-actions">
            <button type="button" class="logged-open-btn" data-action="open" data-analysis-id="${analysisId}">Open</button>
            <button type="button" class="logged-delete-btn" data-action="delete" data-analysis-id="${analysisId}">Delete</button>
          </div>
        </article>
      `);
    }
  }

  els.grid.innerHTML = cards.join('');

  const actionButtons = Array.from(els.grid.querySelectorAll('button[data-action]'));
  for (const button of actionButtons) {
    button.addEventListener('click', async () => {
      const action = button.getAttribute('data-action');
      const analysisId = button.getAttribute('data-analysis-id');

      if (action === 'open-demo') {
        window.location.href = '/log-analysis.html?mode=demo';
        return;
      }

      if (action === 'new-analysis') {
        window.location.href = '/log-analysis.html?mode=setup';
        return;
      }

      if (action === 'open' && analysisId) {
        const nextUrl = new URL('/log-analysis.html', window.location.origin);
        nextUrl.searchParams.set('mode', 'analysis');
        nextUrl.searchParams.set('analysisId', analysisId);
        window.location.href = nextUrl.toString();
        return;
      }

      if (action === 'delete' && analysisId) {
        const card = button.closest('.logged-card');
        const label = card?.querySelector('h2')?.textContent || 'this analysis';
        const shouldDelete = window.confirm(`Delete ${label}? This removes the saved river JSON package.`);
        if (!shouldDelete) return;

        try {
          await deleteLoggedAnalysis(analysisId);
          renderLoggedAnalyses();
        } catch (error) {
          window.alert(error?.message || String(error));
        }
      }
    });
  }
}

function sanitize(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
