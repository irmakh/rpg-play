// Offers the Windows desktop client to browser users.
//
// The Electron client injects window.rpgDesktop before any page script runs, so
// the app never advertises itself to someone who is already running it. The
// offer is also limited to Windows, which is the only build that exists.
//
// Markup opts in by carrying data-desktop-link and starting hidden, so a browser
// that never reaches this script simply shows nothing rather than a dead link.
(function () {
  function inDesktopApp() {
    return !!(window.rpgDesktop && window.rpgDesktop.isDesktop);
  }

  function onWindows() {
    var data = navigator.userAgentData;
    if (data && data.platform) return data.platform === 'Windows';
    return /Windows NT/i.test(navigator.userAgent || '');
  }

  function reveal() {
    if (inDesktopApp() || !onWindows()) return;
    var links = document.querySelectorAll('[data-desktop-link]');
    for (var i = 0; i < links.length; i++) links[i].style.display = '';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reveal);
  else reveal();
})();
