'use strict';

(function () {
  const loader = document.getElementById('app-loader');
  if (!loader) return;

  const MIN_SHOW_MS = 1000;
  const pageStart = Date.now();

  // Hide loader at least MIN_SHOW_MS after the page started loading
  window.addEventListener('load', () => {
    const elapsed = Date.now() - pageStart;
    const remaining = Math.max(0, MIN_SHOW_MS - elapsed);
    setTimeout(() => {
      loader.style.opacity = '0';
      loader.style.pointerEvents = 'none';
      setTimeout(() => { loader.style.display = 'none'; }, 420);
    }, remaining);
  });

  // Show loader on any nav-link click that navigates away
  document.querySelectorAll('a.app-nav-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      // Skip same-page anchors or javascript: links
      if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
      // Prevent navigating to the current page (avoids unwanted reload)
      if (link.classList.contains('is-active')) { e.preventDefault(); return; }

      e.preventDefault();
      loader.style.display = 'flex';
      loader.style.opacity = '1';
      loader.style.pointerEvents = 'auto';
      // If navigating away from editor/preview context, clear the session flag
      if (href !== '/editor' && href !== '/preview') {
        sessionStorage.removeItem('rm_recipe_active');
      }
      // Small delay so the browser paints the loader before unloading
      setTimeout(() => { window.location.href = href; }, 80);
    });
  });
})();
