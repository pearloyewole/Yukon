// Simple client-side router for separate pages
import { initCrossSectionViewer, destroyCrossSectionViewer } from './crossSectionViewer.js';
import { initErosionMigrationExplorer, destroyErosionMigrationExplorer } from './erosionMigrationExplorer.js';

let currentPage = null;

const routes = {
  '/': '3d-view',
  '/3d-view': '3d-view',
  '/erosion-migration': 'erosion-migration'
};

function showPage(pageId) {
  console.log('Showing page:', pageId);
  
  // Hide all pages
  const allPages = document.querySelectorAll('.page');
  console.log('Found pages:', allPages.length);
  allPages.forEach(page => {
    page.classList.remove('active');
  });

  // Update nav links
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    link.classList.remove('active');
    const linkPath = link.getAttribute('data-nav');
    if (routes[linkPath] === pageId) {
      link.classList.add('active');
    }
  });

  // Show the requested page
  const targetPage = document.getElementById(`page-${pageId}`);
  if (targetPage) {
    targetPage.classList.add('active');
    console.log('Page activated:', pageId);
  } else {
    console.error('Page not found:', `page-${pageId}`);
  }

  // Clean up previous page
  if (currentPage && currentPage !== pageId) {
    if (currentPage === 'cross-section') {
      destroyCrossSectionViewer();
    } else if (currentPage === 'erosion-migration') {
      destroyErosionMigrationExplorer();
    }
  }

  // Initialize new page
  if (pageId === 'cross-section') {
    setTimeout(() => {
      initCrossSectionViewer();
    }, 100);
  } else if (pageId === 'erosion-migration') {
    setTimeout(() => {
      initErosionMigrationExplorer();
    }, 100);
  } else if (pageId === '3d-view') {
    // Show three.js canvas
    const renderer = document.querySelector('canvas');
    if (renderer) {
      renderer.style.display = 'block';
    }
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.style.display = 'block';
  } else {
    // Hide three.js canvas for other pages
    const renderer = document.querySelector('canvas');
    if (renderer) {
      renderer.style.display = 'none';
    }
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.style.display = 'none';
  }

  currentPage = pageId;
}

function navigateTo(path) {
  const pageId = routes[path] || routes['/'];
  showPage(pageId);
  window.history.pushState({ page: pageId }, '', path);
}

function initRouter() {
  console.log('Initializing router...');
  
  // Wait a bit to ensure DOM is fully ready
  setTimeout(() => {
    // Handle browser back/forward buttons
    window.addEventListener('popstate', (event) => {
      const path = window.location.pathname;
      const pageId = routes[path] || routes['/'];
      showPage(pageId);
    });

    // Handle initial load (don't push state, just show the page)
    const initialPath = window.location.pathname;
    const initialPageId = routes[initialPath] || routes['/'];
    console.log('Initial path:', initialPath, 'Page ID:', initialPageId);
    showPage(initialPageId);

    // Set up navigation links
    const navLinks = document.querySelectorAll('[data-nav]');
    console.log('Found nav links:', navLinks.length);
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const path = link.getAttribute('data-nav');
        navigateTo(path);
      });
    });
  }, 50);
}

export { initRouter, navigateTo };

