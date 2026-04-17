import { getLoggedAnalyses } from './analysisStore.js';

const els = {
  openSetupPage: document.getElementById('openSetupPage'),
  openLoggedAnalyses: document.getElementById('openLoggedAnalyses'),
  loggedAnalysesMeta: document.getElementById('loggedAnalysesMeta'),
};

initHomePage();

function initHomePage() {
  renderLoggedMeta();

  els.openSetupPage?.addEventListener('click', () => {
    window.location.href = '/log-analysis.html?mode=setup';
  });

  els.openLoggedAnalyses?.addEventListener('click', () => {
    window.location.href = '/logged-analyses.html';
  });
}

function renderLoggedMeta() {
  if (!els.loggedAnalysesMeta) return;

  const analyses = getLoggedAnalyses();
  if (!analyses.length) {
    els.loggedAnalysesMeta.textContent = 'No saved sessions yet - Huslia demo available';
    return;
  }

  const latest = analyses[0];
  const latestName = latest?.name?.trim() || 'Untitled';
  els.loggedAnalysesMeta.textContent = `${analyses.length} saved session${analyses.length === 1 ? '' : 's'} - Latest: ${latestName}`;
}
