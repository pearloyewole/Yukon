import { getLoggedAnalyses } from './analysisStore.js';

const HOME_WELCOME_IMAGE_URL = new URL('../assets/home screen image.jpg', import.meta.url).href;

const els = {
  openSetupPage: document.getElementById('openSetupPage'),
  openLoggedAnalyses: document.getElementById('openLoggedAnalyses'),
  loggedAnalysesMeta: document.getElementById('loggedAnalysesMeta'),
  homeWelcomeImage: document.getElementById('homeWelcomeImage'),
};

initHomePage();

function initHomePage() {
  if (els.homeWelcomeImage) {
    // Use a bundled asset URL so image updates follow source-file changes.
    els.homeWelcomeImage.src = HOME_WELCOME_IMAGE_URL;
  }

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
    els.loggedAnalysesMeta.textContent = 'No saved sessions yet - 3 preloaded rivers available';
    return;
  }

  const latest = analyses[0];
  const latestName = latest?.name?.trim() || 'Untitled';
  els.loggedAnalysesMeta.textContent = `${analyses.length} saved session${analyses.length === 1 ? '' : 's'} - Latest: ${latestName}`;
}
