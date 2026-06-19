'use strict';

(function () {
  const loader = document.getElementById('app-loader');
  if (!loader) return;

  // Hide loader once the current page has fully painted
  window.addEventListener('load', () => {
    loader.style.opacity = '0';
    loader.style.pointerEvents = 'none';
    setTimeout(() => { loader.style.display = 'none'; }, 420);
  });

  // Show loader on any nav-link click that navigates away
  document.querySelectorAll('a.app-nav-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      // Skip same-page anchors or javascript: links
      if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
      // Skip if already on this page
      if (link.classList.contains('is-active')) return;

      e.preventDefault();
      loader.style.display = 'flex';
      loader.style.opacity = '1';
      loader.style.pointerEvents = 'auto';
      // Small delay so the browser paints the loader before unloading
      setTimeout(() => { window.location.href = href; }, 80);
    });
  });
})();
