/* icons.js - one stroke icon set, replacing emoji used as UI iconography.
 *
 * WHY: the app used 647 emoji as icons. Emoji render differently on every OS
 * (and differently again on Android vs iOS vs Windows), ignore currentColor so
 * an icon in a disabled button still looks enabled, cannot be aligned
 * reliably against text, and carry a colour palette nobody chose.
 *
 * These are 24x24 stroke paths on a shared grid. They inherit currentColor
 * through .lt-icon in base.css, so an icon is the colour of the thing it sits
 * in - including when that thing is disabled, active, or destructive.
 *
 * USE
 *   markup: <svg class="lt-icon" aria-hidden="true"><use href="#i-close"></use></svg>
 *   in JS:  icon('close')            -> the same markup as a string
 *
 * Icons are decorative: every one is aria-hidden, and the control around it
 * carries the accessible name via its title or aria-label. Never put an icon
 * in a control that has no text and no title.
 */
(function () {
  'use strict';

  // path data only - every icon shares fill:none, stroke:currentColor,
  // stroke-width:1.75, round caps and joins, set once in base.css
  var P = {
    close:        '<path d="M18 6 6 18M6 6l12 12"/>',
    check:        '<path d="m20 6-11 11-5-5"/>',
    plus:         '<path d="M12 5v14M5 12h14"/>',
    minus:        '<path d="M5 12h14"/>',

    'arrow-left':  '<path d="M19 12H5m7-7-7 7 7 7"/>',
    'arrow-right': '<path d="M5 12h14m-7-7 7 7-7 7"/>',
    'arrow-up':    '<path d="M12 19V5m-7 7 7-7 7 7"/>',
    'arrow-down':  '<path d="M12 5v14m7-7-7 7-7-7"/>',
    'chevron-up':    '<path d="m18 15-6-6-6 6"/>',
    'chevron-down':  '<path d="m6 9 6 6 6-6"/>',
    'chevron-left':  '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    external:     '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',

    play:         '<path d="M6 4l14 8-14 8z"/>',
    pause:        '<path d="M8 4v16M16 4v16"/>',
    next:         '<path d="M5 4l10 8-10 8zM19 5v14"/>',
    prev:         '<path d="M19 4 9 12l10 8zM5 5v14"/>',
    stop:         '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    refresh:      '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>',
    undo:         '<path d="M3 10h12a5 5 0 0 1 0 10h-6M3 10l5-5M3 10l5 5"/>',

    bell:         '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0"/>',
    music:        '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    chat:         '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.4-9h.6a8.5 8.5 0 0 1 8 8z"/>',
    trash:        '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    pencil:       '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    save:         '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    upload:       '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    download:     '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    camera:       '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    image:        '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    document:     '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    book:         '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    clipboard:    '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
    map:          '<path d="m1 6 7-3 8 3 7-3v15l-7 3-8-3-7 3zM8 3v15M16 6v15"/>',
    pin:          '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    ruler:        '<path d="M2 15 15 2l7 7L9 22z"/><path d="M6 11l2 2M9 8l2 2M12 5l2 2"/>',
    hand:         '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v7M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8v-1a2 2 0 0 1 4 0"/>',
    move:         '<path d="M12 2v20M2 12h20M12 2 9 5M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>',
    square:       '<rect x="3" y="3" width="18" height="18" rx="2"/>',
    circle:       '<circle cx="12" cy="12" r="9"/>',
    line:         '<path d="M4 20 20 4"/>',
    dice:         '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
    swords:       '<path d="M14.5 14.5 21 21M3 3l7 7M3 8V3h5M21 3h-5v5"/><path d="M9.5 14.5 3 21M16 3l-6 6"/>',
    key:          '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.5 12.5 8-8M17 5l3 3M14 8l3 3"/>',
    lock:         '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    gear:         '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    exit:         '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    coins:        '<circle cx="8" cy="8" r="5"/><path d="M15.5 5.3a5 5 0 0 1 0 13.4M12 14a5 5 0 0 1-8 0"/>',
    calendar:     '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
    eye:          '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off':    '<path d="M9.9 5A10 10 0 0 1 12 4.8c7 0 11 7.2 11 7.2a19 19 0 0 1-2.6 3.7M6.6 6.6A19 19 0 0 0 1 12s4 7.2 11 7.2a10 10 0 0 0 5.4-1.6M2 2l20 20"/>',
    popout:       '<rect x="9" y="3" width="12" height="12" rx="2"/><path d="M15 21H5a2 2 0 0 1-2-2V9"/>',
    cursor:       '<path d="m4 3 7 17 2.5-6.5L20 11z"/>',
    target:       '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
    shield:       '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    heart:        '<path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21.4l8.8-8.7a5 5 0 0 0 0-7.1z"/>',
    folder:       '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    paperclip:    '<path d="M21.4 11.1 12.3 20a5.5 5.5 0 0 1-7.8-7.8l9.2-9.1a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.1a1.8 1.8 0 0 1-2.6-2.6l8.5-8.4"/>',
    search:       '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    more:         '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>'
  };

  var NS = 'http://www.w3.org/2000/svg';

  function spriteMarkup() {
    var s = '<svg xmlns="' + NS + '" style="display:none" aria-hidden="true" data-icon-sprite>';
    for (var k in P) {
      if (!Object.prototype.hasOwnProperty.call(P, k)) continue;
      s += '<symbol id="i-' + k + '" viewBox="0 0 24 24">' + P[k] + '</symbol>';
    }
    return s + '</svg>';
  }

  // Returns icon markup for building HTML in JS.
  function icon(name, extraClass) {
    if (!P[name]) return '';
    return '<svg class="lt-icon' + (extraClass ? ' ' + extraClass : '') +
           '" aria-hidden="true" focusable="false"><use href="#i-' + name + '"></use></svg>';
  }

  function inject() {
    if (document.querySelector('[data-icon-sprite]')) return;
    var d = document.createElement('div');
    d.innerHTML = spriteMarkup();
    var svg = d.firstChild;
    if (document.body) document.body.insertBefore(svg, document.body.firstChild);
  }

  if (typeof window !== 'undefined') {
    window.icon = icon;
    window.iconNames = function () { return Object.keys(P); };
    if (typeof document !== 'undefined' && document.addEventListener) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
      else inject();
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { icon: icon, names: Object.keys(P) };
})();
