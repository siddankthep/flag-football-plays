/* Thin glue between the new chrome (drawers, top-bar icons, floating panels)
 * and the existing state IDs in app.js. Keeps app.js untouched as much as possible. */
(function () {
'use strict';

function $(id) { return document.getElementById(id); }

// ---- Mirror visible drawer inputs ↔ canonical hidden inputs ----
const mirrors = [
  ['playbookNameVisible', 'playbookName'],
  ['teamSizeVisible', 'teamSize'],
  ['formationPresetVisible', 'formationPreset'],
  ['showFieldLinesVisible', 'showFieldLines'],
  ['playCategoryVisible', 'playCategory'],
  ['playCallCodeVisible', 'playCallCode'],
  ['playNotesVisible', 'playNotes'],
  ['includeOnWristbandVisible', 'includeOnWristband']
];

function syncVisibleFromHidden() {
  for (const [vis, hid] of mirrors) {
    const v = $(vis), h = $(hid);
    if (!v || !h) continue;
    if (v.type === 'checkbox') v.checked = h.checked;
    else v.value = h.value;
  }
}

function bindMirrors() {
  for (const [vis, hid] of mirrors) {
    const v = $(vis), h = $(hid);
    if (!v || !h) continue;
    v.addEventListener('input', () => {
      if (v.type === 'checkbox') h.checked = v.checked;
      else h.value = v.value;
    });
    v.addEventListener('change', () => {
      if (v.type === 'checkbox') h.checked = v.checked;
      else h.value = v.value;
      h.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
}

// ---- Drawer open/close ----
function openDrawer(id) {
  closeAllDrawers();
  syncVisibleFromHidden();
  $(id).hidden = false;
}
function closeDrawer(id) { $(id).hidden = true; }
function closeAllDrawers() {
  document.querySelectorAll('.drawer').forEach(d => d.hidden = true);
  $('filesMenu').hidden = true;
}

document.addEventListener('click', (e) => {
  const closer = e.target.closest('[data-close]');
  if (closer) { closeDrawer(closer.dataset.close); return; }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Let app.js handle ESC for route/selection first; only close drawers if nothing else happened.
    setTimeout(closeAllDrawers, 0);
  }
});

$('infoBtn').addEventListener('click', () => openDrawer('infoDrawer'));
$('formationsBtn').addEventListener('click', () => openDrawer('formationsDrawer'));
$('rosterBtn').addEventListener('click', () => openDrawer('rosterDrawer'));
$('backBtn').addEventListener('click', () => openDrawer('playsDrawer'));
$('filesBtn').addEventListener('click', () => {
  const m = $('filesMenu');
  m.hidden = !m.hidden;
});

// Close files menu when clicking elsewhere
document.addEventListener('pointerdown', (e) => {
  const fm = $('filesMenu');
  if (!fm.hidden && !fm.contains(e.target) && !$('filesBtn').contains(e.target)) fm.hidden = true;
});

// Mirror button: trigger flip
$('mirrorBtn').addEventListener('click', () => $('flipPlayBtn').click());

// Route tool button in top bar
$('routeBtn').addEventListener('click', () => {
  document.querySelector('.fab-tools .tool[data-tool="route"]').click();
});

// Lock toggle (visual only for v1)
let locked = false;
$('lockBtn').addEventListener('click', () => {
  locked = !locked;
  $('lockBtn').classList.toggle('active', locked);
  document.body.classList.toggle('locked', locked);
});

// Top-bar play button starts animation + shows the anim bar
$('animPlayBtn').addEventListener('click', () => {
  $('animBar').hidden = false;
  $('playBtn').click();
});

// Prev / Next play
$('prevPlayBtn').addEventListener('click', () => {
  const items = Array.from(document.querySelectorAll('#playsList li'));
  const idx = items.findIndex(li => li.classList.contains('active'));
  if (idx > 0) items[idx - 1].click();
});
$('nextPlayBtn').addEventListener('click', () => {
  const items = Array.from(document.querySelectorAll('#playsList li'));
  const idx = items.findIndex(li => li.classList.contains('active'));
  if (idx >= 0 && idx < items.length - 1) items[idx + 1].click();
});

// ---- Route panel visibility (driven by selection state in app.js) ----
// app.js sets/clears CSS class .has-route-selection on document.body via renderToolbarState.
// Hook by observing the .route-panel state and showing/hiding accordingly.

function syncRoutePanel() {
  const body = document.body;
  const show = body.classList.contains('sel-player') || body.classList.contains('sel-route');
  $('routePanel').hidden = !show;
  // Highlight the active style and cap on the panel
  const styleNow = body.dataset.routeStyle || 'smooth';
  const capNow = body.dataset.routeCap || 'arrow';
  const intended = body.dataset.routeIntended === '1';
  document.querySelectorAll('#routePanel .style').forEach(b => b.classList.toggle('active', b.dataset.style === styleNow));
  document.querySelectorAll('#routePanel .cap').forEach(b => b.classList.toggle('active', b.dataset.cap === capNow));
  $('rpIntended').classList.toggle('active', intended);
}

const obs = new MutationObserver(syncRoutePanel);
obs.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-route-style', 'data-route-cap', 'data-route-intended'] });

$('rpClose').addEventListener('click', () => {
  // Mimic Esc / deselect
  document.querySelector('.fab-tools .tool[data-tool="select"]').click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
});
$('rpIntended').addEventListener('click', () => {
  const cb = $('intendedReceiver');
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
});
$('rpClearRoute').addEventListener('click', () => {
  // Trigger Delete via keyboard on selected route
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
});

// Sync once after load
window.addEventListener('load', () => { syncVisibleFromHidden(); bindMirrors(); });

})();
