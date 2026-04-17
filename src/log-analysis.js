const url = new URL(window.location.href);
if (!url.searchParams.has('mode')) {
  url.searchParams.set('mode', 'setup');
  window.history.replaceState({}, '', url);
}

void import('./main.js');
