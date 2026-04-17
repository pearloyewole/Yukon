const LOGGED_ANALYSES_KEY = 'yukon_logged_analyses_v1';
const ANALYSIS_DB_NAME = 'yukon_river_analysis_db';
const ANALYSIS_DB_VERSION = 1;
const ANALYSIS_STORE_NAME = 'river_packages';
const MAX_LOGGED_ANALYSES = 20;

export function getLoggedAnalyses() {
  try {
    const raw = window.localStorage.getItem(LOGGED_ANALYSES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLoggedAnalysisMeta(entry) {
  const analyses = getLoggedAnalyses();
  const next = [entry, ...analyses.filter((item) => String(item?.id) !== String(entry?.id))].slice(0, MAX_LOGGED_ANALYSES);
  try {
    window.localStorage.setItem(LOGGED_ANALYSES_KEY, JSON.stringify(next));
  } catch {
    // no-op if storage unavailable
  }
}

export function deleteLoggedAnalysisMeta(analysisId) {
  const analyses = getLoggedAnalyses();
  const next = analyses.filter((item) => String(item?.id) !== String(analysisId));
  try {
    window.localStorage.setItem(LOGGED_ANALYSES_KEY, JSON.stringify(next));
  } catch {
    // no-op if storage unavailable
  }
}

export async function saveLoggedAnalysisEntry(entry, packageData) {
  saveLoggedAnalysisMeta(entry);
  await saveLoggedAnalysisPackage(entry?.id, packageData);
}

export async function loadLoggedAnalysisPackage(analysisId) {
  const db = await openAnalysisDb();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(ANALYSIS_STORE_NAME, 'readonly');
    const store = tx.objectStore(ANALYSIS_STORE_NAME);
    const req = store.get(String(analysisId));

    req.onsuccess = () => {
      resolve(req.result?.packageData || null);
    };
    req.onerror = () => {
      reject(new Error('Unable to read saved analysis package.'));
    };
  });
}

export async function deleteLoggedAnalysis(analysisId) {
  deleteLoggedAnalysisMeta(analysisId);

  const db = await openAnalysisDb();
  if (!db) return;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(ANALYSIS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(ANALYSIS_STORE_NAME);
    const req = store.delete(String(analysisId));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(new Error('Unable to delete saved analysis package.'));
  });
}

async function saveLoggedAnalysisPackage(analysisId, packageData) {
  const db = await openAnalysisDb();
  if (!db) return;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(ANALYSIS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(ANALYSIS_STORE_NAME);
    const req = store.put({
      id: String(analysisId),
      packageData,
      savedAt: new Date().toISOString(),
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(new Error('Unable to persist analysis package.'));
  });
}

let openDbPromise = null;

function openAnalysisDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  if (openDbPromise) return openDbPromise;

  openDbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(ANALYSIS_DB_NAME, ANALYSIS_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ANALYSIS_STORE_NAME)) {
        db.createObjectStore(ANALYSIS_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Unable to open analysis package database.'));
  });

  return openDbPromise;
}
