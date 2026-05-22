/* Flag Football Play Designer
 * Vanilla JS. Single-file app.
 */
(function () {
'use strict';

// ============================================================
// Constants & helpers
// ============================================================
const FIELD_WIDTH_YD = 25;
const FIELD_HEIGHT_YD = 25;            // 10 yd behind LOS + 15 yd downfield
const PX_PER_YD = 20;
const VIEW_W = FIELD_WIDTH_YD * PX_PER_YD;       // 500
const VIEW_H = FIELD_HEIGHT_YD * PX_PER_YD;      // 500
const DEFAULT_LOS = 10;
const MAX_DOWNFIELD_YD = FIELD_HEIGHT_YD - DEFAULT_LOS;  // 15
const GRID_SNAP = 0.5;
const SCHEMA_VERSION = 1;
const DRAFT_KEY = 'ffpd:draft';
const HISTORY_LIMIT = 100;

const SVG_NS = 'http://www.w3.org/2000/svg';

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function snap(v, step) { return Math.round(v / step) * step; }
function nowIso() { return new Date().toISOString(); }

// Convert logical yards to SVG pixels. Origin (0,0) = bottom-left of field.
function xToSvg(xYd) { return xYd * PX_PER_YD; }
function yToSvg(yYd) { return (FIELD_HEIGHT_YD - yYd) * PX_PER_YD; }
function svgPointFromEvent(evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}
function svgToYards(pt) {
  return { x: pt.x / PX_PER_YD, y: FIELD_HEIGHT_YD - pt.y / PX_PER_YD };
}
function eventToYards(evt) {
  return svgToYards(svgPointFromEvent(evt));
}

function el(tag, attrs = {}, children = []) {
  const isSvg = ['svg','g','path','circle','rect','line','polyline','polygon','text','marker','defs','ellipse'].includes(tag);
  const node = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.setAttribute('class', v);
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.hidden = false;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { t.hidden = true; }, 2400);
}

// ============================================================
// Position metadata: per-label color + shape
// (Defined before state init because createBlankPlaybook() → makeDefaultPlayers()
//  → metaFor() reads it during initial evaluation.)
// ============================================================
const POSITION_META = {
  Q: { color: '#dc2626', shape: 'circle' },   // QB
  C: { color: '#6b7280', shape: 'square' },   // Center
  X: { color: '#ea7c1c', shape: 'circle' },   // X receiver
  Y: { color: '#9333ea', shape: 'circle' },   // Y receiver
  Z: { color: '#0d9488', shape: 'circle' },   // Slot
  H: { color: '#3b82f6', shape: 'circle' },
  A: { color: '#f59e0b', shape: 'circle' },
  B: { color: '#84cc16', shape: 'circle' },
  R: { color: '#ec4899', shape: 'circle' },
  F: { color: '#06b6d4', shape: 'circle' },
  G: { color: '#6b7280', shape: 'square' },
  T: { color: '#6b7280', shape: 'square' }
};
function metaFor(label) {
  if (!label) return { color: '#6b7280', shape: 'circle' };
  return POSITION_META[label] || POSITION_META[label[0]] || { color: '#6b7280', shape: 'circle' };
}

// ============================================================
// State
// ============================================================
let playbook = createBlankPlaybook();
let currentPlayId = playbook.plays[0].id;
let selection = null; // { kind: 'player'|'route'|'annotation'|'anchor', id, anchorIndex? }
let currentTool = 'select';
let toolDefaults = {
  routeStyle: 'smooth',
  routeCap: 'arrow',
  intended: false
};

let drawingRoute = null;   // { playerId, anchors: [{x,y}], cursor: {x,y} | null }
let dragState = null;      // { kind, id, startPt, originalStart, [anchorIndex] }

let history = [];
let future = [];
let suppressHistory = false;

let animation = { playing: false, startTime: 0, durationMs: 0, paused: false, pausedAt: 0, scrubT: 0 };

// ============================================================
// Factory functions
// ============================================================
function createBlankPlaybook() {
  const play = createBlankPlay('Play 1');
  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'Untitled Playbook',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    settings: {
      playersPerSide: 5,
      fieldUnits: 'yards',
      showFieldLines: true,
      teamColor: '#1d4ed8',
      wristband: { size: 'medium', columns: 3, rows: 5, showPlayNumbers: true }
    },
    roster: [],
    plays: [play]
  };
}

function createBlankPlay(name = 'New Play') {
  const losYards = DEFAULT_LOS;
  return {
    id: uuid(),
    name,
    category: '',
    notes: '',
    playCallCode: '',
    includeOnWristband: true,
    losYards,
    ballStart: { x: FIELD_WIDTH_YD / 2, y: losYards - 1 },
    players: makeDefaultPlayers(5, 'trips-right', losYards),
    annotations: []
  };
}

// ============================================================
// Formation presets
// ============================================================
function makeDefaultPlayers(teamSize, preset, los) {
  const positions = getFormationPositions(teamSize, preset, los);
  return positions.map(p => {
    const meta = metaFor(p.label);
    return {
      id: uuid(),
      positionLabel: p.label,
      color: meta.color,
      shape: meta.shape,
      rosterId: undefined,
      start: { x: p.x, y: p.y },
      isBallCarrier: p.label === 'Q',
      route: undefined
    };
  });
}

function getFormationPositions(teamSize, preset, los) {
  const cx = FIELD_WIDTH_YD / 2;
  const onLOS = los - 0.2;
  const backfield = los - 3;
  // Receiver letters in order, used to label additional WRs when teams scale up.
  const RECEIVER_LETTERS = ['X', 'Y', 'Z', 'H', 'A', 'B'];

  const map = {
    'trips-right': {
      4: [
        { label: 'Q', x: cx, y: backfield },
        { label: 'C', x: cx, y: onLOS },
        { label: 'Y', x: cx + 5, y: onLOS },
        { label: 'Z', x: cx + 8, y: onLOS - 0.3 }
      ],
      5: [
        { label: 'Q', x: cx, y: backfield },
        { label: 'C', x: cx, y: onLOS },
        { label: 'X', x: cx - 7, y: onLOS },
        { label: 'Z', x: cx + 4, y: onLOS - 0.3 },
        { label: 'Y', x: cx + 8, y: onLOS }
      ],
      6: [
        { label: 'Q', x: cx, y: backfield },
        { label: 'C', x: cx, y: onLOS },
        { label: 'X', x: cx - 8, y: onLOS },
        { label: 'H', x: cx - 3, y: onLOS - 0.3 },
        { label: 'Z', x: cx + 4, y: onLOS - 0.3 },
        { label: 'Y', x: cx + 8, y: onLOS }
      ],
      7: [
        { label: 'Q', x: cx, y: backfield },
        { label: 'C', x: cx, y: onLOS },
        { label: 'G', x: cx + 1.5, y: onLOS },
        { label: 'X', x: cx - 7, y: onLOS },
        { label: 'H', x: cx - 3, y: onLOS - 0.3 },
        { label: 'Z', x: cx + 4, y: onLOS - 0.3 },
        { label: 'Y', x: cx + 8, y: onLOS }
      ],
      8: [
        { label: 'Q', x: cx, y: backfield },
        { label: 'C', x: cx, y: onLOS },
        { label: 'G', x: cx + 1.5, y: onLOS },
        { label: 'T', x: cx - 1.5, y: onLOS },
        { label: 'X', x: cx - 7, y: onLOS },
        { label: 'Z', x: cx + 4, y: onLOS - 0.3 },
        { label: 'Y', x: cx + 8, y: onLOS },
        { label: 'R', x: cx - 1.5, y: backfield - 1 }
      ],
      9: [
        { label: 'Q', x: cx, y: backfield },
        { label: 'C', x: cx, y: onLOS },
        { label: 'G', x: cx + 1.5, y: onLOS },
        { label: 'T', x: cx - 1.5, y: onLOS },
        { label: 'H', x: cx + 3, y: onLOS },
        { label: 'A', x: cx - 3, y: onLOS },
        { label: 'X', x: cx - 7, y: onLOS - 0.3 },
        { label: 'Y', x: cx + 7, y: onLOS },
        { label: 'R', x: cx, y: backfield - 1 }
      ]
    },
    'spread': {
      4: [
        { label: 'Q', x: cx, y: backfield },
        { label: 'C', x: cx, y: onLOS },
        { label: 'X', x: cx - 6, y: onLOS },
        { label: 'Y', x: cx + 6, y: onLOS }
      ],
      5: [
        { label: 'Q', x: cx, y: backfield },
        { label: 'C', x: cx, y: onLOS },
        { label: 'X', x: cx - 7, y: onLOS },
        { label: 'Z', x: cx + 3, y: onLOS - 0.3 },
        { label: 'Y', x: cx + 7, y: onLOS }
      ],
      6: [
        { label: 'Q', x: cx, y: backfield },
        { label: 'C', x: cx, y: onLOS },
        { label: 'X', x: cx - 8, y: onLOS },
        { label: 'H', x: cx - 3, y: onLOS - 0.3 },
        { label: 'Z', x: cx + 3, y: onLOS - 0.3 },
        { label: 'Y', x: cx + 8, y: onLOS }
      ],
      7: [
        { label: 'Q', x: cx, y: backfield },
        { label: 'C', x: cx, y: onLOS },
        { label: 'G', x: cx + 1.5, y: onLOS },
        { label: 'X', x: cx - 8, y: onLOS },
        { label: 'H', x: cx - 3, y: onLOS - 0.3 },
        { label: 'Z', x: cx + 4, y: onLOS - 0.3 },
        { label: 'Y', x: cx + 8, y: onLOS }
      ],
      8: [
        { label: 'Q', x: cx, y: backfield },
        { label: 'C', x: cx, y: onLOS },
        { label: 'G', x: cx + 1.5, y: onLOS },
        { label: 'T', x: cx - 1.5, y: onLOS },
        { label: 'X', x: cx - 9, y: onLOS },
        { label: 'H', x: cx - 4, y: onLOS - 0.3 },
        { label: 'Z', x: cx + 4, y: onLOS - 0.3 },
        { label: 'Y', x: cx + 9, y: onLOS }
      ],
      9: [
        { label: 'Q', x: cx, y: backfield },
        { label: 'C', x: cx, y: onLOS },
        { label: 'G', x: cx + 1.5, y: onLOS },
        { label: 'T', x: cx - 1.5, y: onLOS },
        { label: 'H', x: cx + 3, y: onLOS },
        { label: 'A', x: cx - 3, y: onLOS },
        { label: 'X', x: cx - 8, y: onLOS - 0.3 },
        { label: 'Y', x: cx + 8, y: onLOS },
        { label: 'R', x: cx, y: backfield - 1 }
      ]
    }
  };

  // Empty: spread wide receivers + QB + C
  function emptyN(n) {
    const arr = [
      { label: 'Q', x: cx, y: backfield },
      { label: 'C', x: cx, y: onLOS }
    ];
    const wrCount = Math.max(0, n - 2);
    const left = Math.ceil(wrCount / 2);
    const right = wrCount - left;
    let li = 0;
    for (let i = 0; i < left; i++) {
      arr.push({ label: RECEIVER_LETTERS[li++] || 'X', x: cx - 3 - i * 3, y: onLOS - (i * 0.2) });
    }
    for (let i = 0; i < right; i++) {
      arr.push({ label: RECEIVER_LETTERS[li++] || 'Y', x: cx + 3 + i * 3, y: onLOS - (i * 0.2) });
    }
    return arr;
  }
  function singlebackN(n) {
    const arr = [
      { label: 'Q', x: cx, y: backfield },
      { label: 'C', x: cx, y: onLOS },
      { label: 'R', x: cx, y: backfield - 1.5 }
    ];
    const wrCount = Math.max(0, n - 3);
    const left = Math.floor(wrCount / 2);
    const right = wrCount - left;
    let li = 0;
    for (let i = 0; i < left; i++) {
      arr.push({ label: RECEIVER_LETTERS[li++] || 'X', x: cx - 4 - i * 3, y: onLOS });
    }
    for (let i = 0; i < right; i++) {
      arr.push({ label: RECEIVER_LETTERS[li++] || 'Y', x: cx + 4 + i * 3, y: onLOS });
    }
    return arr;
  }

  if (preset === 'empty') return emptyN(teamSize);
  if (preset === 'singleback') return singlebackN(teamSize);
  const layout = map[preset]?.[teamSize];
  return layout || emptyN(teamSize);
}

// ============================================================
// History / undo
// ============================================================
function snapshot() {
  if (suppressHistory) return;
  history.push(JSON.stringify(playbook));
  if (history.length > HISTORY_LIMIT) history.shift();
  future = [];
  saveDraft();
  playbook.updatedAt = nowIso();
}

function undo() {
  if (history.length === 0) return;
  future.push(JSON.stringify(playbook));
  const prev = history.pop();
  playbook = JSON.parse(prev);
  if (!playbook.plays.find(p => p.id === currentPlayId)) {
    currentPlayId = playbook.plays[0]?.id;
  }
  selection = null;
  drawingRoute = null;
  renderAll();
}
function redo() {
  if (future.length === 0) return;
  history.push(JSON.stringify(playbook));
  const next = future.pop();
  playbook = JSON.parse(next);
  if (!playbook.plays.find(p => p.id === currentPlayId)) {
    currentPlayId = playbook.plays[0]?.id;
  }
  selection = null;
  drawingRoute = null;
  renderAll();
}

// ============================================================
// Current play accessor
// ============================================================
function currentPlay() {
  return playbook.plays.find(p => p.id === currentPlayId);
}
function findPlayer(id) {
  return currentPlay().players.find(p => p.id === id);
}
function findAnnotation(id) {
  return currentPlay().annotations.find(a => a.id === id);
}

// ============================================================
// Schema validation
// ============================================================
function validatePlaybook(obj) {
  if (!obj || typeof obj !== 'object') return 'Not an object';
  if (obj.schemaVersion !== SCHEMA_VERSION) return `Unsupported schema version: ${obj.schemaVersion}`;
  if (!Array.isArray(obj.plays)) return 'Missing plays array';
  for (const play of obj.plays) {
    if (!play.id || !Array.isArray(play.players)) return `Invalid play "${play.name || '?'}"`;
    for (const pl of play.players) {
      if (!pl.id || !pl.start || typeof pl.start.x !== 'number') return `Invalid player in "${play.name}"`;
    }
  }
  return null;
}

function normalizeLoadedPlaybook(obj) {
  // accept single Play or Playbook
  if (Array.isArray(obj.plays)) return obj;
  if (obj.players && obj.id) {
    return {
      schemaVersion: SCHEMA_VERSION,
      name: obj.name || 'Imported Play',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      settings: {
        playersPerSide: obj.players.length,
        fieldUnits: 'yards',
        showFieldLines: true,
        teamColor: '#1d4ed8',
        wristband: { size: 'medium', columns: 3, rows: 5, showPlayNumbers: true }
      },
      roster: [],
      plays: [obj]
    };
  }
  return obj;
}

// ============================================================
// Field rendering
// ============================================================
const svg = document.getElementById('field');
const fieldLayer = document.getElementById('fieldLayer');
const annotationLayer = document.getElementById('annotationLayer');
const routeLayer = document.getElementById('routeLayer');
const playerLayer = document.getElementById('playerLayer');
const previewLayer = document.getElementById('previewLayer');

function renderField() {
  fieldLayer.innerHTML = '';
  const play = currentPlay();
  const showLines = playbook.settings.showFieldLines;
  if (!showLines) return;

  // Uniform yard lines every 5 yards, including the LOS.
  // The LOS is the line at y = losYards — no special highlight.
  for (let y = 5; y < FIELD_HEIGHT_YD; y += 5) {
    fieldLayer.appendChild(el('line', {
      class: 'yard-line',
      x1: 0, y1: yToSvg(y), x2: VIEW_W, y2: yToSvg(y)
    }));
  }
}

// ============================================================
// Player rendering
// ============================================================
const PLAYER_RADIUS = 15;

function renderPlayers() {
  playerLayer.innerHTML = '';
  const play = currentPlay();
  for (const player of play.players) {
    const g = el('g', {
      class: 'player'
        + (selection?.kind === 'player' && selection.id === player.id ? ' selected' : '')
        + (player.isBallCarrier ? ' ball-carrier' : ''),
      'data-id': player.id,
      transform: `translate(${xToSvg(player.start.x)}, ${yToSvg(player.start.y)})`
    });
    let token;
    const r = PLAYER_RADIUS;
    if (player.shape === 'square') {
      token = el('rect', { class: 'player-token', x: -r, y: -r, width: r*2, height: r*2, rx: 3, fill: player.color });
    } else if (player.shape === 'triangle') {
      token = el('polygon', { class: 'player-token', points: `0,${-r} ${r},${r} ${-r},${r}`, fill: player.color });
    } else {
      token = el('circle', { class: 'player-token', cx: 0, cy: 0, r, fill: player.color });
    }
    g.appendChild(token);
    g.appendChild(el('text', { class: 'player-label', x: 0, y: 0, text: player.positionLabel }));
    playerLayer.appendChild(g);
  }
}

// ============================================================
// Route rendering
// ============================================================
// Dynamic per-color markers. Reuses an existing one if already added.
function ensureMarker(kind, color) {
  const safeColor = color.replace('#', '');
  const id = `mk-${kind}-${safeColor}`;
  if (document.getElementById(id)) return id;
  const defs = svg.querySelector('defs');
  const m = document.createElementNS(SVG_NS, 'marker');
  m.setAttribute('id', id);
  m.setAttribute('markerWidth', '10');
  m.setAttribute('markerHeight', '10');
  m.setAttribute('orient', 'auto');
  m.setAttribute('markerUnits', 'strokeWidth');
  if (kind === 'arrow') {
    m.setAttribute('refX', '8');
    m.setAttribute('refY', '3');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', 'M0,0 L0,6 L9,3 z');
    p.setAttribute('fill', color);
    m.appendChild(p);
  } else if (kind === 'tee') {
    m.setAttribute('refX', '1');
    m.setAttribute('refY', '5');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', 'M0,0 L0,10');
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', '2');
    m.appendChild(p);
  } else if (kind === 'dot') {
    m.setAttribute('refX', '5');
    m.setAttribute('refY', '5');
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', '5');
    c.setAttribute('cy', '5');
    c.setAttribute('r', '3');
    c.setAttribute('fill', color);
    m.appendChild(c);
  }
  defs.appendChild(m);
  return id;
}

function buildPath(anchors, style) {
  if (anchors.length === 0) return '';
  if (anchors.length === 1) return `M ${anchors[0].x} ${anchors[0].y}`;

  if (style === 'smooth' && anchors.length >= 2) {
    // Catmull-Rom to Bezier
    let d = `M ${anchors[0].x} ${anchors[0].y}`;
    for (let i = 0; i < anchors.length - 1; i++) {
      const p0 = anchors[i - 1] || anchors[i];
      const p1 = anchors[i];
      const p2 = anchors[i + 1];
      const p3 = anchors[i + 2] || anchors[i + 1];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }

  if (style === 'zigzag') {
    let d = `M ${anchors[0].x} ${anchors[0].y}`;
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i], b = anchors[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.1) { d += ` L ${b.x} ${b.y}`; continue; }
      const oscPerYard = 0.7;
      const oscCount = Math.max(2, Math.round(len / PX_PER_YD * oscPerYard));
      const ux = dx / len, uy = dy / len;
      const px = -uy, py = ux;
      const amp = PX_PER_YD * 0.5;
      const steps = oscCount * 2;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const cx = a.x + dx * t;
        const cy = a.y + dy * t;
        const off = (s % 2 === 1 ? 1 : -1) * amp;
        d += ` L ${cx + px * off} ${cy + py * off}`;
      }
      d += ` L ${b.x} ${b.y}`;
    }
    return d;
  }

  // straight or dotted: polyline
  let d = `M ${anchors[0].x} ${anchors[0].y}`;
  for (let i = 1; i < anchors.length; i++) d += ` L ${anchors[i].x} ${anchors[i].y}`;
  return d;
}

function getRouteAnchorsAbs(player) {
  if (!player.route) return [];
  const start = { x: xToSvg(player.start.x), y: yToSvg(player.start.y) };
  const rest = player.route.anchors.map(a => ({ x: xToSvg(a.x), y: yToSvg(a.y) }));
  return [start, ...rest];
}

function renderRoutes() {
  routeLayer.innerHTML = '';
  const play = currentPlay();
  for (const player of play.players) {
    if (!player.route) continue;
    const abs = getRouteAnchorsAbs(player);
    const d = buildPath(abs, player.route.style);
    const isSelected = selection?.kind === 'route' && selection.id === player.id;
    const color = player.route.color || player.color || '#dc2626';

    let markerAttr = '';
    if (player.route.endCap === 'arrow') markerAttr = `url(#${ensureMarker('arrow', color)})`;
    else if (player.route.endCap === 'tee') markerAttr = `url(#${ensureMarker('tee', color)})`;
    else if (player.route.endCap === 'dot') markerAttr = `url(#${ensureMarker('dot', color)})`;

    const path = el('path', {
      class: 'route-path'
        + (player.route.style === 'dotted' ? ' dotted' : '')
        + (player.route.isIntendedReceiver ? ' intended' : '')
        + (isSelected ? ' selected' : ''),
      d,
      stroke: color,
      'marker-end': markerAttr,
      'data-player-id': player.id
    });
    path.style.fill = 'none';
    routeLayer.appendChild(path);

    // Anchors when selected
    if (isSelected) {
      for (let i = 1; i < abs.length; i++) {
        const a = abs[i];
        const isAnchorSel = selection.anchorIndex === i - 1;
        routeLayer.appendChild(el('circle', {
          class: 'route-anchor' + (isAnchorSel ? ' selected' : ''),
          cx: a.x, cy: a.y, r: 5,
          'data-player-id': player.id,
          'data-anchor': i - 1
        }));
      }
    }
  }
}

// ============================================================
// Annotation rendering
// ============================================================
function renderAnnotations() {
  annotationLayer.innerHTML = '';
  const play = currentPlay();
  for (const a of play.annotations) {
    const isSel = selection?.kind === 'annotation' && selection.id === a.id;
    if (a.kind === 'text') {
      const t = el('text', {
        class: 'text-annotation' + (isSel ? ' selected' : ''),
        x: xToSvg(a.x), y: yToSvg(a.y),
        'font-size': a.fontSize || 14,
        'data-id': a.id
      });
      t.textContent = a.text;
      annotationLayer.appendChild(t);
    } else if (a.kind === 'ball') {
      const g = el('g', {
        class: 'ball-marker' + (isSel ? ' selected' : ''),
        transform: `translate(${xToSvg(a.x)}, ${yToSvg(a.y)})`,
        'data-id': a.id
      });
      g.appendChild(el('ellipse', { cx: 0, cy: 0, rx: 7, ry: 4.5, fill: '#8b5a2b', stroke: '#fff', 'stroke-width': 1 }));
      g.appendChild(el('line', { x1: -3, y1: 0, x2: 3, y2: 0, stroke: '#fff', 'stroke-width': 0.8 }));
      annotationLayer.appendChild(g);
    }
  }
  // Render ball start marker (the implicit ball at ballStart)
  const ballStart = play.ballStart;
  if (ballStart) {
    const g = el('g', { transform: `translate(${xToSvg(ballStart.x)}, ${yToSvg(ballStart.y)})`, id: 'ballStartMarker' });
    g.appendChild(el('ellipse', { cx: 0, cy: 0, rx: 6, ry: 4, fill: '#8b5a2b', stroke: '#fff', 'stroke-width': 1 }));
    annotationLayer.appendChild(g);
  }
}

// ============================================================
// Render-all
// ============================================================
function renderAll() {
  if (!currentPlay()) {
    if (playbook.plays.length === 0) {
      playbook.plays.push(createBlankPlay('Play 1'));
    }
    currentPlayId = playbook.plays[0].id;
  }
  renderField();
  renderRoutes();
  renderAnnotations();
  renderPlayers();
  renderRosterList();
  renderPlaysList();
  renderPlayMeta();
  renderToolbarState();
}

function renderRosterList() {
  const ul = document.getElementById('rosterList');
  ul.innerHTML = '';
  const play = currentPlay();
  for (const p of play.players) {
    const li = el('li', {
      class: 'roster-item' + (selection?.kind === 'player' && selection.id === p.id ? ' selected' : ''),
      'data-id': p.id,
      onclick: () => { selectPlayer(p.id); }
    });
    li.appendChild(el('span', { class: 'swatch', style: `background:${p.color}` }));
    const label = document.createElement('span');
    label.textContent = p.positionLabel;
    label.style.flex = '1';
    li.appendChild(label);
    if (p.isBallCarrier) {
      const tag = document.createElement('span');
      tag.textContent = '🏈';
      tag.style.fontSize = '11px';
      li.appendChild(tag);
    }
    if (p.route) {
      const tag = document.createElement('span');
      tag.textContent = '↗';
      tag.style.fontSize = '12px';
      tag.style.color = '#fbbf24';
      li.appendChild(tag);
    }
    ul.appendChild(li);
  }
}

function renderPlaysList() {
  const ul = document.getElementById('playsList');
  ul.innerHTML = '';
  playbook.plays.forEach((play, i) => {
    const li = document.createElement('li');
    li.className = play.id === currentPlayId ? 'active' : '';
    li.dataset.id = play.id;
    li.onclick = () => switchPlay(play.id);
    const num = document.createElement('span');
    num.className = 'play-num';
    num.textContent = `${i + 1}.`;
    const title = document.createElement('span');
    title.className = 'play-title';
    title.textContent = play.name;
    li.appendChild(num);
    li.appendChild(title);
    ul.appendChild(li);
  });
}

function renderPlayMeta() {
  const play = currentPlay();
  document.getElementById('playName').value = play.name;
  document.getElementById('playCategory').value = play.category || '';
  document.getElementById('playCallCode').value = play.playCallCode || '';
  document.getElementById('playNotes').value = play.notes || '';
  document.getElementById('includeOnWristband').checked = play.includeOnWristband !== false;
  document.getElementById('playbookName').value = playbook.name;
  document.getElementById('teamSize').value = String(playbook.settings.playersPerSide);
  document.getElementById('showFieldLines').checked = playbook.settings.showFieldLines;
  document.getElementById('teamColor').value = playbook.settings.teamColor;
}

function renderToolbarState() {
  document.querySelectorAll('.tool').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === currentTool);
  });
  document.querySelectorAll('.style').forEach(b => {
    b.classList.toggle('active', b.dataset.style === toolDefaults.routeStyle);
  });
  document.querySelectorAll('.cap').forEach(b => {
    b.classList.toggle('active', b.dataset.cap === toolDefaults.routeCap);
  });
  const intendedEl = document.getElementById('intendedReceiver');
  if (intendedEl) intendedEl.checked = toolDefaults.intended;
  const fieldArea = document.querySelector('.field-stage');
  if (fieldArea) fieldArea.className = 'field-stage tool-' + currentTool;
  // Expose selection + tool defaults on body for outside listeners (bind.js floating panel).
  const body = document.body;
  body.classList.toggle('sel-player', selection?.kind === 'player');
  body.classList.toggle('sel-route', selection?.kind === 'route');
  body.classList.toggle('sel-annotation', selection?.kind === 'annotation');
  body.classList.toggle('drawing-route', !!drawingRoute);
  body.dataset.routeStyle = toolDefaults.routeStyle;
  body.dataset.routeCap = toolDefaults.routeCap;
  body.dataset.routeIntended = toolDefaults.intended ? '1' : '0';
}

// ============================================================
// Selection
// ============================================================
function selectPlayer(id) {
  selection = { kind: 'player', id };
  renderAll();
}
function selectRoute(id, anchorIndex) {
  selection = { kind: 'route', id, anchorIndex };
  // Sync style/cap to the selected route
  const p = findPlayer(id);
  if (p?.route) {
    toolDefaults.routeStyle = p.route.style;
    toolDefaults.routeCap = p.route.endCap;
    toolDefaults.intended = !!p.route.isIntendedReceiver;
  }
  renderAll();
}
function selectAnnotation(id) {
  selection = { kind: 'annotation', id };
  renderAll();
}
function clearSelection() {
  selection = null;
  renderAll();
}

// ============================================================
// Tool handling
// ============================================================
function setTool(name) {
  if (drawingRoute) finishRoute(false);
  currentTool = name;
  renderToolbarState();
}

// ============================================================
// SVG event delegation
// ============================================================
svg.addEventListener('pointerdown', onSvgPointerDown);
svg.addEventListener('pointermove', onSvgPointerMove);
svg.addEventListener('pointerup', onSvgPointerUp);
svg.addEventListener('dblclick', onSvgDblClick);
svg.addEventListener('contextmenu', (e) => e.preventDefault());

function findClickedPlayer(evt) {
  const target = evt.target.closest('.player');
  return target ? findPlayer(target.dataset.id) : null;
}
function findClickedRoute(evt) {
  if (evt.target.classList.contains('route-anchor')) {
    return { player: findPlayer(evt.target.dataset.playerId), anchorIndex: parseInt(evt.target.dataset.anchor, 10) };
  }
  if (evt.target.classList.contains('route-path')) {
    return { player: findPlayer(evt.target.dataset.playerId), anchorIndex: -1 };
  }
  return null;
}
function findClickedAnnotation(evt) {
  const text = evt.target.closest('.text-annotation');
  if (text) return findAnnotation(text.dataset.id);
  const ball = evt.target.closest('.ball-marker');
  if (ball) return findAnnotation(ball.dataset.id);
  return null;
}

function onSvgPointerDown(evt) {
  if (animation.playing) return;
  const ptYd = eventToYards(evt);

  // Route drawing mode
  if (drawingRoute) {
    // Click adds anchor; drag will start positioning
    addRouteAnchor(ptYd, evt);
    return;
  }

  // Tool-specific behavior
  if (currentTool === 'text') {
    const text = prompt('Annotation text:');
    if (text) {
      snapshot();
      const ann = { kind: 'text', id: uuid(), x: ptYd.x, y: ptYd.y, text, fontSize: 14 };
      currentPlay().annotations.push(ann);
      renderAll();
    }
    return;
  }
  if (currentTool === 'ball') {
    snapshot();
    const ann = { kind: 'ball', id: uuid(), x: ptYd.x, y: ptYd.y };
    currentPlay().annotations.push(ann);
    selectAnnotation(ann.id);
    return;
  }

  // Select tool: hit-testing
  const annHit = findClickedAnnotation(evt);
  if (annHit) {
    selectAnnotation(annHit.id);
    dragState = {
      kind: 'annotation', id: annHit.id,
      startPt: { ...ptYd },
      original: { x: annHit.x, y: annHit.y }
    };
    return;
  }

  const routeHit = findClickedRoute(evt);
  if (routeHit && routeHit.player) {
    selectRoute(routeHit.player.id, routeHit.anchorIndex >= 0 ? routeHit.anchorIndex : undefined);
    if (routeHit.anchorIndex >= 0) {
      dragState = {
        kind: 'anchor',
        id: routeHit.player.id,
        anchorIndex: routeHit.anchorIndex,
        startPt: { ...ptYd },
        original: { ...routeHit.player.route.anchors[routeHit.anchorIndex] }
      };
    }
    return;
  }

  const playerHit = findClickedPlayer(evt);
  if (playerHit) {
    if (currentTool === 'route') {
      startRoute(playerHit.id);
      return;
    }
    selectPlayer(playerHit.id);
    dragState = {
      kind: 'player',
      id: playerHit.id,
      startPt: { ...ptYd },
      original: { ...playerHit.start }
    };
    return;
  }

  // Click on empty area
  clearSelection();
}

function onSvgPointerMove(evt) {
  const ptYd = eventToYards(evt);
  updateReadout(ptYd);

  if (drawingRoute) {
    drawingRoute.cursor = ptYd;
    renderRoutePreview();
    return;
  }

  if (!dragState) return;

  const dx = ptYd.x - dragState.startPt.x;
  const dy = ptYd.y - dragState.startPt.y;
  // Snapshot once on the first real movement so undo can revert the drag.
  if (!dragState.snapshotted) {
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return;
    snapshot();
    dragState.snapshotted = true;
  }
  const useSnap = !evt.shiftKey;

  if (dragState.kind === 'player') {
    const p = findPlayer(dragState.id);
    if (!p) return;
    let nx = dragState.original.x + dx;
    let ny = dragState.original.y + dy;
    if (useSnap) { nx = snap(nx, GRID_SNAP); ny = snap(ny, GRID_SNAP); }
    nx = clamp(nx, 0.5, FIELD_WIDTH_YD - 0.5);
    ny = clamp(ny, 0.5, currentPlay().losYards);
    p.start.x = nx;
    p.start.y = ny;
    renderPlayers();
    renderRoutes();
  } else if (dragState.kind === 'annotation') {
    const a = findAnnotation(dragState.id);
    if (!a) return;
    let nx = dragState.original.x + dx;
    let ny = dragState.original.y + dy;
    if (useSnap) { nx = snap(nx, GRID_SNAP); ny = snap(ny, GRID_SNAP); }
    a.x = nx; a.y = ny;
    renderAnnotations();
  } else if (dragState.kind === 'anchor') {
    const player = findPlayer(dragState.id);
    if (!player?.route) return;
    let nx = dragState.original.x + dx;
    let ny = dragState.original.y + dy;
    if (useSnap) { nx = snap(nx, GRID_SNAP); ny = snap(ny, GRID_SNAP); }
    player.route.anchors[dragState.anchorIndex].x = nx;
    player.route.anchors[dragState.anchorIndex].y = ny;
    renderRoutes();
  }
}

function onSvgPointerUp() {
  if (dragState) dragState = null;
}

function onSvgDblClick(evt) {
  if (drawingRoute) {
    finishRoute(true);
    return;
  }
  const playerHit = findClickedPlayer(evt);
  if (playerHit) {
    openPlayerPopover(playerHit, evt);
    return;
  }
  const annHit = findClickedAnnotation(evt);
  if (annHit && annHit.kind === 'text') {
    const newText = prompt('Edit text:', annHit.text);
    if (newText !== null) {
      snapshot();
      annHit.text = newText;
      renderAnnotations();
    }
  }
}

function updateReadout(ptYd) {
  const losYards = currentPlay().losYards;
  const depth = ptYd.y - losYards;
  document.getElementById('readout').textContent =
    `(${ptYd.x.toFixed(1)}, ${ptYd.y.toFixed(1)}) yd · depth ${depth >= 0 ? '+' : ''}${depth.toFixed(1)}`;
}

// ============================================================
// Route drawing
// ============================================================
function startRoute(playerId) {
  const player = findPlayer(playerId);
  if (!player) return;
  selection = { kind: 'player', id: playerId };
  drawingRoute = { playerId, anchors: [], cursor: null };
  // If player already has a route, start from existing — but per PRD, route mode replaces.
  // For convenience we'll preserve and let user add anchors. Actually PRD says ESC = cancel,
  // Enter = finish. We'll start a fresh route if none exists, else continue editing existing.
  if (player.route) {
    drawingRoute.anchors = player.route.anchors.map(a => ({ ...a }));
  }
  toast('Click to add anchors. Enter or double-click to finish. Esc to cancel.');
  renderRoutePreview();
}

function addRouteAnchor(ptYd, evt) {
  const useSnap = !evt.shiftKey;
  let x = ptYd.x, y = ptYd.y;
  if (useSnap) { x = snap(x, GRID_SNAP); y = snap(y, GRID_SNAP); }
  drawingRoute.anchors.push({ x, y });
  renderRoutePreview();
}

function finishRoute(commit) {
  if (!drawingRoute) return;
  if (!commit || drawingRoute.anchors.length === 0) {
    drawingRoute = null;
    previewLayer.innerHTML = '';
    renderAll();
    return;
  }
  snapshot();
  const player = findPlayer(drawingRoute.playerId);
  player.route = {
    anchors: drawingRoute.anchors,
    style: toolDefaults.routeStyle,
    endCap: toolDefaults.routeCap,
    isIntendedReceiver: toolDefaults.intended
  };
  drawingRoute = null;
  previewLayer.innerHTML = '';
  selectRoute(player.id);
  setTool('select');
  renderAll();
}

function renderRoutePreview() {
  previewLayer.innerHTML = '';
  if (!drawingRoute) return;
  const player = findPlayer(drawingRoute.playerId);
  if (!player) return;
  const color = player.color || '#dc2626';
  const startAbs = { x: xToSvg(player.start.x), y: yToSvg(player.start.y) };
  const anchorsAbs = drawingRoute.anchors.map(a => ({ x: xToSvg(a.x), y: yToSvg(a.y) }));
  const all = [startAbs, ...anchorsAbs];
  const previewPath = buildPath(all, toolDefaults.routeStyle);
  if (previewPath) {
    previewLayer.appendChild(el('path', { class: 'route-path' + (toolDefaults.routeStyle === 'dotted' ? ' dotted' : ''), d: previewPath, stroke: color, fill: 'none' }));
  }
  // Live preview of cursor segment
  if (drawingRoute.cursor && all.length > 0) {
    const last = all[all.length - 1];
    const cursorAbs = { x: xToSvg(drawingRoute.cursor.x), y: yToSvg(drawingRoute.cursor.y) };
    previewLayer.appendChild(el('line', {
      class: 'route-preview',
      x1: last.x, y1: last.y, x2: cursorAbs.x, y2: cursorAbs.y,
      stroke: color, 'stroke-opacity': '0.55'
    }));
  }
  // Anchor dots
  for (const a of anchorsAbs) {
    previewLayer.appendChild(el('circle', { class: 'route-anchor', cx: a.x, cy: a.y, r: 5, stroke: color }));
  }
}

// ============================================================
// Player popover
// ============================================================
let popoverPlayerId = null;
function openPlayerPopover(player, evt) {
  popoverPlayerId = player.id;
  const pop = document.getElementById('playerPopover');
  pop.style.left = (evt.clientX + 12) + 'px';
  pop.style.top = (evt.clientY + 12) + 'px';
  document.getElementById('popPosition').value = player.positionLabel;
  document.getElementById('popColor').value = player.color;
  document.getElementById('popShape').value = player.shape;
  document.getElementById('popBallCarrier').checked = player.isBallCarrier;
  pop.hidden = false;
}
function closePlayerPopover() {
  document.getElementById('playerPopover').hidden = true;
  popoverPlayerId = null;
}

document.getElementById('popPosition').addEventListener('change', (e) => {
  if (!popoverPlayerId) return;
  snapshot();
  findPlayer(popoverPlayerId).positionLabel = e.target.value;
  renderAll();
});
document.getElementById('popColor').addEventListener('change', (e) => {
  if (!popoverPlayerId) return;
  snapshot();
  findPlayer(popoverPlayerId).color = e.target.value;
  renderAll();
});
document.getElementById('popShape').addEventListener('change', (e) => {
  if (!popoverPlayerId) return;
  snapshot();
  findPlayer(popoverPlayerId).shape = e.target.value;
  renderAll();
});
document.getElementById('popBallCarrier').addEventListener('change', (e) => {
  if (!popoverPlayerId) return;
  snapshot();
  // Only one ball carrier
  const play = currentPlay();
  for (const p of play.players) p.isBallCarrier = false;
  findPlayer(popoverPlayerId).isBallCarrier = e.target.checked;
  renderAll();
});
document.getElementById('popClose').addEventListener('click', closePlayerPopover);
document.getElementById('popDelete').addEventListener('click', () => {
  if (!popoverPlayerId) return;
  const p = findPlayer(popoverPlayerId);
  if (p?.route && !confirm('This player has a route. Delete anyway?')) return;
  snapshot();
  const play = currentPlay();
  play.players = play.players.filter(x => x.id !== popoverPlayerId);
  closePlayerPopover();
  selection = null;
  renderAll();
});

// Close popover when clicking outside
document.addEventListener('pointerdown', (e) => {
  const pop = document.getElementById('playerPopover');
  if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.player')) {
    closePlayerPopover();
  }
});

// ============================================================
// Play management
// ============================================================
function switchPlay(id) {
  if (drawingRoute) finishRoute(false);
  currentPlayId = id;
  selection = null;
  renderAll();
}
function addPlay() {
  snapshot();
  const newPlay = {
    id: uuid(),
    name: `Play ${playbook.plays.length + 1}`,
    category: '',
    notes: '',
    playCallCode: '',
    includeOnWristband: true,
    losYards: DEFAULT_LOS,
    ballStart: { x: FIELD_WIDTH_YD / 2, y: DEFAULT_LOS - 1 },
    players: makeDefaultPlayers(playbook.settings.playersPerSide, 'trips-right', DEFAULT_LOS),
    annotations: []
  };
  playbook.plays.push(newPlay);
  currentPlayId = newPlay.id;
  selection = null;
  renderAll();
}
function duplicatePlay() {
  snapshot();
  const p = currentPlay();
  const copy = JSON.parse(JSON.stringify(p));
  copy.id = uuid();
  copy.name = `${p.name} (copy)`;
  for (const pl of copy.players) pl.id = uuid();
  for (const a of copy.annotations) a.id = uuid();
  playbook.plays.push(copy);
  currentPlayId = copy.id;
  renderAll();
}
function deletePlay() {
  if (playbook.plays.length <= 1) { toast('Cannot delete the last play', true); return; }
  if (!confirm('Delete this play?')) return;
  snapshot();
  const idx = playbook.plays.findIndex(p => p.id === currentPlayId);
  playbook.plays.splice(idx, 1);
  currentPlayId = playbook.plays[Math.max(0, idx - 1)].id;
  selection = null;
  renderAll();
}
function flipPlay() {
  snapshot();
  const p = currentPlay();
  const w = FIELD_WIDTH_YD;
  for (const pl of p.players) {
    pl.start.x = w - pl.start.x;
    if (pl.route) {
      for (const a of pl.route.anchors) a.x = w - a.x;
    }
  }
  for (const a of p.annotations) a.x = w - a.x;
  p.ballStart.x = w - p.ballStart.x;
  renderAll();
}

// ============================================================
// Animation
// ============================================================
function getRouteLength(player) {
  if (!player.route) return 0;
  const pts = [player.start, ...player.route.anchors];
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
  }
  return len;
}

function getPlayDuration() {
  const play = currentPlay();
  const speed = parseFloat(document.getElementById('speedRange').value);
  const baseYdPerS = 6;
  let maxDur = 0.5; // minimum
  for (const p of play.players) {
    const len = getRouteLength(p);
    if (len === 0) continue;
    const dur = len / baseYdPerS / speed;
    if (dur > maxDur) maxDur = dur;
  }
  return maxDur * 1000; // ms
}

function interpolateRoute(player, t) {
  if (!player.route || player.route.anchors.length === 0) return { x: player.start.x, y: player.start.y };
  const pts = [player.start, ...player.route.anchors];
  let totalLen = 0;
  const segLens = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
    segLens.push(d);
    totalLen += d;
  }
  if (totalLen === 0) return { x: player.start.x, y: player.start.y };
  const target = t * totalLen;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (acc + segLens[i] >= target) {
      const local = (target - acc) / segLens[i];
      return {
        x: pts[i].x + (pts[i+1].x - pts[i].x) * local,
        y: pts[i].y + (pts[i+1].y - pts[i].y) * local
      };
    }
    acc += segLens[i];
  }
  return { ...pts[pts.length - 1] };
}

function animationStep() {
  if (!animation.playing) return;
  const elapsed = animation.paused ? animation.pausedAt - animation.startTime : Date.now() - animation.startTime;
  const dur = animation.durationMs;
  let t = Math.min(1, elapsed / dur);

  renderAnimationFrame(t);
  document.getElementById('scrubber').value = String(t * 1000);
  document.getElementById('timeReadout').textContent = `${(t * dur / 1000).toFixed(1)}s / ${(dur / 1000).toFixed(1)}s`;

  if (t >= 1) {
    animation.playing = false;
    return;
  }
  if (!animation.paused) requestAnimationFrame(animationStep);
}

function renderAnimationFrame(t) {
  const play = currentPlay();
  const baseYdPerS = 6;
  const speed = parseFloat(document.getElementById('speedRange').value);
  const totalDur = animation.durationMs;
  // Re-render players at interpolated positions
  playerLayer.innerHTML = '';
  let ballCarrier = null;
  for (const p of play.players) {
    let pos = { x: p.start.x, y: p.start.y };
    if (p.route && getRouteLength(p) > 0) {
      const playerDurMs = getRouteLength(p) / baseYdPerS / speed * 1000;
      const localT = Math.min(1, (t * totalDur) / playerDurMs);
      pos = interpolateRoute(p, localT);
    }
    const g = el('g', {
      class: 'player' + (p.isBallCarrier ? ' ball-carrier' : ''),
      transform: `translate(${xToSvg(pos.x)}, ${yToSvg(pos.y)})`
    });
    const r = PLAYER_RADIUS;
    let token;
    if (p.shape === 'square') token = el('rect', { class: 'player-token', x: -r, y: -r, width: r*2, height: r*2, rx: 3, fill: p.color });
    else if (p.shape === 'triangle') token = el('polygon', { class: 'player-token', points: `0,${-r} ${r},${r} ${-r},${r}`, fill: p.color });
    else token = el('circle', { class: 'player-token', cx: 0, cy: 0, r, fill: p.color });
    g.appendChild(token);
    g.appendChild(el('text', { class: 'player-label', x: 0, y: 0, text: p.positionLabel }));
    playerLayer.appendChild(g);
    if (p.isBallCarrier) ballCarrier = { x: pos.x, y: pos.y };
  }
  // Move ball with the ball carrier
  const ballMarker = document.getElementById('ballStartMarker');
  if (ballMarker && ballCarrier) {
    ballMarker.setAttribute('transform', `translate(${xToSvg(ballCarrier.x)}, ${yToSvg(ballCarrier.y)})`);
  }
}

function playAnimation() {
  if (animation.playing && !animation.paused) return;
  if (animation.paused) {
    // resume
    const pausedFor = Date.now() - animation.pausedAt;
    animation.startTime += pausedFor;
    animation.paused = false;
    animation.playing = true;
    requestAnimationFrame(animationStep);
    return;
  }
  animation.durationMs = getPlayDuration();
  animation.startTime = Date.now();
  animation.playing = true;
  animation.paused = false;
  requestAnimationFrame(animationStep);
}
function pauseAnimation() {
  if (!animation.playing) return;
  animation.paused = true;
  animation.pausedAt = Date.now();
}
function resetAnimation() {
  animation.playing = false;
  animation.paused = false;
  document.getElementById('scrubber').value = '0';
  document.getElementById('timeReadout').textContent = '0.0s / 0.0s';
  renderAll();
}

// ============================================================
// Save / load
// ============================================================
function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(playbook));
  } catch (e) {
    // localStorage might be full; silently ignore.
  }
}
function loadDraft() {
  try {
    const s = localStorage.getItem(DRAFT_KEY);
    return s ? JSON.parse(s) : null;
  } catch (e) { return null; }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) { }
}

function savePlaybookToFile() {
  playbook.updatedAt = nowIso();
  const blob = new Blob([JSON.stringify(playbook, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (playbook.name || 'playbook').replace(/[^a-z0-9_\-]+/gi, '_') + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Saved ' + a.download);
}

function loadPlaybookFromFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const obj = JSON.parse(e.target.result);
      const normalized = normalizeLoadedPlaybook(obj);
      const err = validatePlaybook(normalized);
      if (err) {
        toast('Invalid file: ' + err, true);
        return;
      }
      history = [];
      future = [];
      playbook = normalized;
      currentPlayId = playbook.plays[0]?.id;
      selection = null;
      drawingRoute = null;
      renderAll();
      toast('Loaded ' + file.name);
    } catch (err) {
      toast('Parse error: ' + err.message, true);
    }
  };
  reader.readAsText(file);
}

// ============================================================
// Export: PNG / SVG
// ============================================================
function serializeCurrentPlaySvg(extraWidth, extraHeight) {
  // Build a standalone SVG containing only the current play.
  const w = extraWidth || VIEW_W;
  const h = extraHeight || VIEW_H;
  const cloned = svg.cloneNode(true);
  cloned.removeAttribute('id');
  cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  cloned.setAttribute('width', String(w));
  cloned.setAttribute('height', String(h));
  // White field background
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#ffffff');
  cloned.insertBefore(bg, cloned.firstChild);
  // Inline styles (since the print/export environment may not have stylesheet)
  inlineStyles(cloned);
  // Remove preview layer
  const prev = cloned.querySelector('#previewLayer');
  if (prev) prev.innerHTML = '';
  return cloned;
}

function inlineStyles(rootSvg) {
  // Inline class-based styles for export. Switch to print-friendly palette
  // (white field, dark lines/text) since printed playbooks live on paper.
  const rules = {
    '.yard-line': { stroke: '#9ca3af', 'stroke-width': '0.5' },
    '.player-token': { stroke: '#111827', 'stroke-width': '1.5' },
    '.player.ball-carrier .player-token': { stroke: '#111827', 'stroke-width': '2.5', 'stroke-dasharray': '3 2' },
    '.player-label': { fill: '#fff', 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': '14px', 'font-weight': '700' },
    '.route-path': { fill: 'none', 'stroke-width': '3', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    '.route-path.dotted': { 'stroke-dasharray': '4 4' },
    '.route-path.intended': { 'stroke-width': '4.5' },
    '.text-annotation': { fill: '#111827', 'font-family': 'Inter, sans-serif', 'font-weight': '600' }
  };
  for (const [sel, attrs] of Object.entries(rules)) {
    rootSvg.querySelectorAll(sel).forEach(node => {
      for (const [k, v] of Object.entries(attrs)) {
        if (!node.hasAttribute(k)) node.setAttribute(k, v);
      }
    });
  }
}

function exportSvg() {
  const cloned = serializeCurrentPlaySvg();
  const xml = new XMLSerializer().serializeToString(cloned);
  const blob = new Blob([xml], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (currentPlay().name || 'play').replace(/[^a-z0-9_\-]+/gi, '_') + '.svg';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('SVG downloaded');
}

function exportPng() {
  const cloned = serializeCurrentPlaySvg();
  const xml = new XMLSerializer().serializeToString(cloned);
  const blob = new Blob([xml], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = VIEW_W * scale;
    canvas.height = VIEW_H * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((b) => {
      const url2 = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url2;
      a.download = (currentPlay().name || 'play').replace(/[^a-z0-9_\-]+/gi, '_') + '.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url2), 1000);
      toast('PNG downloaded');
    }, 'image/png');
  };
  img.onerror = () => { toast('PNG export failed', true); };
  img.src = url;
}

// ============================================================
// PDF Export
// ============================================================
async function exportPdf(options) {
  if (!window.jspdf) {
    toast('jsPDF not loaded — load the page with internet first or run a local server', true);
    return;
  }
  const { jsPDF } = window.jspdf;

  const pageSize = options.pageSize === 'a4' ? 'a4' : 'letter';
  const orientation = options.orientation || 'portrait';
  const doc = new jsPDF({ unit: 'in', format: pageSize, orientation });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const plays = options.singlePlay ? [currentPlay()] : playbook.plays.slice();

  // Cover page (only for full export)
  if (!options.singlePlay && plays.length > 1) {
    doc.setFillColor(playbook.settings.teamColor || '#1d4ed8');
    doc.rect(0, 0, pageW, 0.5, 'F');
    doc.setFontSize(28);
    doc.setTextColor(20, 20, 20);
    doc.text(playbook.name, pageW / 2, pageH / 3, { align: 'center' });
    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(`Generated ${new Date().toLocaleDateString()}`, pageW / 2, pageH / 3 + 0.4, { align: 'center' });
    doc.text(`${plays.length} plays`, pageW / 2, pageH / 3 + 0.7, { align: 'center' });

    // Table of contents
    doc.addPage();
    doc.setFontSize(18); doc.setTextColor(20);
    doc.text('Contents', 0.5, 0.7);
    doc.setFontSize(11);
    let y = 1.1;
    const byCat = {};
    plays.forEach((p, i) => {
      const cat = p.category || 'Uncategorized';
      (byCat[cat] = byCat[cat] || []).push({ play: p, num: i + 1 });
    });
    for (const [cat, items] of Object.entries(byCat)) {
      if (y > pageH - 1) { doc.addPage(); y = 0.7; }
      doc.setFont(undefined, 'bold');
      doc.text(cat, 0.5, y); y += 0.25;
      doc.setFont(undefined, 'normal');
      for (const { play, num } of items) {
        if (y > pageH - 0.5) { doc.addPage(); y = 0.7; }
        doc.text(`  ${num}. ${play.name}${play.playCallCode ? ` (${play.playCallCode})` : ''}`, 0.5, y);
        y += 0.22;
      }
      y += 0.15;
    }
  }

  // Roster page
  if (options.includeRoster && playbook.roster?.length) {
    doc.addPage();
    doc.setFontSize(18); doc.text('Roster', 0.5, 0.7);
    doc.setFontSize(11);
    let y = 1.1;
    for (const r of playbook.roster) {
      doc.text(`${r.jerseyNumber || '--'}  ${r.name || ''}  ${r.defaultPositionLabel || ''}`, 0.5, y);
      y += 0.22;
    }
  }

  // Plays — handle plays per page
  const pp = parseInt(options.playsPerPage || '1', 10);
  for (let i = 0; i < plays.length; i++) {
    if (i % pp === 0 || (i === 0 && (!options.singlePlay))) doc.addPage();
    const slotIndex = i % pp;
    await renderPlayToPdf(doc, plays[i], i + 1, pageW, pageH, pp, slotIndex, options);
  }

  // Footer with page numbers
  const pageCount = doc.internal.getNumberOfPages();
  for (let n = 1; n <= pageCount; n++) {
    doc.setPage(n);
    doc.setFontSize(9); doc.setTextColor(150);
    doc.text(`${playbook.name}  ·  Page ${n} of ${pageCount}`, pageW / 2, pageH - 0.25, { align: 'center' });
  }

  doc.save((playbook.name || 'playbook').replace(/[^a-z0-9_\-]+/gi, '_') + '.pdf');
  toast('PDF downloaded');
}

async function renderPlayToPdf(doc, play, num, pageW, pageH, perPage, slotIndex, options) {
  // Compute slot rect
  let cols = 1, rows = 1;
  if (perPage === 2) { cols = 1; rows = 2; }
  if (perPage === 4) { cols = 2; rows = 2; }
  const margin = 0.4;
  const slotW = (pageW - margin * 2) / cols;
  const slotH = (pageH - margin * 2) / rows;
  const col = slotIndex % cols;
  const row = Math.floor(slotIndex / cols);
  const x0 = margin + col * slotW;
  const y0 = margin + row * slotH;

  // Header
  doc.setFontSize(14); doc.setTextColor(20);
  doc.text(`${num}. ${play.name}`, x0, y0 + 0.25);
  doc.setFontSize(10); doc.setTextColor(80);
  let metaLine = [];
  if (play.category) metaLine.push(play.category);
  if (play.playCallCode) metaLine.push(`Call: ${play.playCallCode}`);
  if (metaLine.length) doc.text(metaLine.join(' · '), x0, y0 + 0.45);

  // Diagram area
  const topPad = 0.55;
  const bottomPad = options.includeNotes && play.notes ? 0.8 : 0.2;
  const diagW = slotW - 0.2;
  const diagH = slotH - topPad - bottomPad;
  // Field aspect ratio = VIEW_W/VIEW_H = 500/1400 ≈ 0.357
  const ratio = VIEW_W / VIEW_H;
  let dw, dh;
  if (diagW / diagH < ratio) {
    dw = diagW; dh = dw / ratio;
  } else {
    dh = diagH; dw = dh * ratio;
  }
  const dx = x0 + (slotW - dw) / 2;
  const dy = y0 + topPad;

  // Render this play to a temp SVG then embed
  const tempPlayId = currentPlayId;
  const tempSel = selection;
  currentPlayId = play.id;
  selection = null;
  renderField(); renderRoutes(); renderAnnotations(); renderPlayers();
  const cloned = serializeCurrentPlaySvg();
  // Restore
  currentPlayId = tempPlayId;
  selection = tempSel;
  renderAll();

  if (window.svg2pdf) {
    try {
      await window.svg2pdf.svg2pdf(cloned, doc, { x: dx, y: dy, width: dw, height: dh });
    } catch (e) {
      console.error('svg2pdf error:', e);
      // Fallback: rasterize
      await drawSvgAsImage(doc, cloned, dx, dy, dw, dh);
    }
  } else {
    await drawSvgAsImage(doc, cloned, dx, dy, dw, dh);
  }

  // Notes
  if (options.includeNotes && play.notes) {
    doc.setFontSize(9); doc.setTextColor(50);
    const lines = doc.splitTextToSize(play.notes, slotW - 0.2);
    doc.text(lines, x0, y0 + slotH - 0.35);
  }
}

function drawSvgAsImage(doc, svgNode, x, y, w, h) {
  return new Promise((resolve) => {
    const xml = new XMLSerializer().serializeToString(svgNode);
    const blob = new Blob([xml], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = VIEW_W * 2; canvas.height = VIEW_H * 2;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, w, h);
      URL.revokeObjectURL(url);
      resolve();
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    img.src = url;
  });
}

// ============================================================
// Wristband export
// ============================================================
async function exportWristband(options) {
  if (!window.jspdf) {
    toast('jsPDF not loaded', true);
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const sizes = {
    small: { w: 2.5, h: 3.5 },
    medium: { w: 3, h: 4 },
    large: { w: 3.5, h: 5 }
  };
  const sz = sizes[options.size] || sizes.medium;
  const cols = options.columns;
  const rows = options.rows;
  const cellsPerCard = cols * rows;

  const plays = playbook.plays.filter(p => p.includeOnWristband !== false);
  const totalCards = Math.max(1, Math.ceil(plays.length / cellsPerCard));

  // Layout cards on page: as many fit
  const margin = 0.5;
  const gap = 0.4;
  const cardsPerRow = Math.max(1, Math.floor((pageW - margin * 2 + gap) / (sz.w + gap)));
  const cardsPerCol = Math.max(1, Math.floor((pageH - margin * 2 + gap) / (sz.h + gap)));
  const cardsPerPage = cardsPerRow * cardsPerCol;

  for (let cardIdx = 0; cardIdx < totalCards; cardIdx++) {
    if (cardIdx > 0 && cardIdx % cardsPerPage === 0) doc.addPage();
    const pageSlot = cardIdx % cardsPerPage;
    const cr = pageSlot % cardsPerRow;
    const cc = Math.floor(pageSlot / cardsPerRow);
    const x0 = margin + cr * (sz.w + gap);
    const y0 = margin + cc * (sz.h + gap);

    // Crop marks
    drawCropMarks(doc, x0, y0, sz.w, sz.h);

    // Card border
    doc.setDrawColor(180);
    doc.setLineWidth(0.005);
    doc.rect(x0, y0, sz.w, sz.h);

    // Header
    doc.setFontSize(8);
    doc.setTextColor(40);
    doc.text(`${playbook.name}  ·  Wristband ${cardIdx + 1} of ${totalCards}`, x0 + sz.w / 2, y0 + 0.18, { align: 'center' });

    // Grid of plays
    const headerH = 0.25;
    const gridY = y0 + headerH;
    const gridH = sz.h - headerH - 0.1;
    const gridW = sz.w - 0.1;
    const gridX = x0 + 0.05;
    const cellW = gridW / cols;
    const cellH = gridH / rows;

    for (let cell = 0; cell < cellsPerCard; cell++) {
      const playIdx = cardIdx * cellsPerCard + cell;
      if (playIdx >= plays.length) break;
      const play = plays[playIdx];
      const cellCol = cell % cols;
      const cellRow = Math.floor(cell / cols);
      const cx = gridX + cellCol * cellW;
      const cy = gridY + cellRow * cellH;
      // cell border
      doc.setDrawColor(220);
      doc.setLineWidth(0.005);
      doc.rect(cx, cy, cellW, cellH);
      // play number / call code
      doc.setFontSize(7);
      doc.setTextColor(20);
      const label = options.showNumbers ? String(playIdx + 1) : (play.playCallCode || String(playIdx + 1));
      doc.text(label, cx + 0.04, cy + 0.1);
      // play name
      doc.setFontSize(5);
      doc.setTextColor(60);
      const nameLines = doc.splitTextToSize(play.name, cellW - 0.1);
      doc.text(nameLines.slice(0, 1), cx + cellW - 0.04, cy + 0.1, { align: 'right' });
      // Diagram
      const diagX = cx + 0.05;
      const diagY = cy + 0.13;
      const diagW = cellW - 0.1;
      const diagH = cellH - 0.18;
      const tempPlayId = currentPlayId;
      const tempSel = selection;
      currentPlayId = play.id;
      selection = null;
      renderField(); renderRoutes(); renderAnnotations(); renderPlayers();
      const cloned = serializeCurrentPlaySvg();
      currentPlayId = tempPlayId;
      selection = tempSel;
      renderAll();
      if (window.svg2pdf) {
        try {
          await window.svg2pdf.svg2pdf(cloned, doc, { x: diagX, y: diagY, width: diagW, height: diagH });
        } catch (e) {
          await drawSvgAsImage(doc, cloned, diagX, diagY, diagW, diagH);
        }
      } else {
        await drawSvgAsImage(doc, cloned, diagX, diagY, diagW, diagH);
      }
    }
  }

  doc.save((playbook.name || 'playbook').replace(/[^a-z0-9_\-]+/gi, '_') + '_wristband.pdf');
  toast('Wristband PDF downloaded');
}

function drawCropMarks(doc, x, y, w, h) {
  doc.setDrawColor(120);
  doc.setLineWidth(0.005);
  const len = 0.1;
  const off = 0.04;
  // 4 corners
  [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]].forEach(([cx, cy, sx, sy]) => {
    doc.line(cx + off * sx, cy, cx + (off + len) * sx, cy);
    doc.line(cx, cy + off * sy, cx, cy + (off + len) * sy);
  });
}

// ============================================================
// Event wiring
// ============================================================
document.getElementById('newPlaybookBtn').addEventListener('click', () => {
  if (!confirm('Discard the current playbook and start fresh?')) return;
  history = []; future = [];
  playbook = createBlankPlaybook();
  currentPlayId = playbook.plays[0].id;
  selection = null;
  renderAll();
});

document.getElementById('openBtn').addEventListener('click', () => {
  document.getElementById('fileInput').click();
});
document.getElementById('fileInput').addEventListener('change', (e) => {
  if (e.target.files[0]) loadPlaybookFromFile(e.target.files[0]);
  e.target.value = '';
});

document.getElementById('saveBtn').addEventListener('click', savePlaybookToFile);
document.getElementById('exportPngBtn').addEventListener('click', exportPng);
document.getElementById('exportSvgBtn').addEventListener('click', exportSvg);
document.getElementById('exportPdfBtn').addEventListener('click', () => {
  document.getElementById('pdfDialog').hidden = false;
});
document.getElementById('wristbandBtn').addEventListener('click', () => {
  document.getElementById('wristbandDialog').hidden = false;
  document.getElementById('wbSize').value = playbook.settings.wristband.size;
  document.getElementById('wbCols').value = playbook.settings.wristband.columns;
  document.getElementById('wbRows').value = playbook.settings.wristband.rows;
  document.getElementById('wbShowNumbers').checked = playbook.settings.wristband.showPlayNumbers;
});

// PDF dialog
document.getElementById('pdfCancel').addEventListener('click', () => { document.getElementById('pdfDialog').hidden = true; });
document.getElementById('pdfGo').addEventListener('click', () => {
  const opts = {
    pageSize: document.getElementById('pdfPageSize').value,
    orientation: document.getElementById('pdfOrientation').value,
    playsPerPage: document.getElementById('pdfPlaysPerPage').value,
    includeNotes: document.getElementById('pdfIncludeNotes').checked,
    includeRoster: document.getElementById('pdfIncludeRoster').checked,
    singlePlay: document.getElementById('pdfSinglePlay').checked
  };
  document.getElementById('pdfDialog').hidden = true;
  exportPdf(opts);
});

// Wristband dialog
document.getElementById('wbCancel').addEventListener('click', () => { document.getElementById('wristbandDialog').hidden = true; });
document.getElementById('wbGo').addEventListener('click', () => {
  const opts = {
    size: document.getElementById('wbSize').value,
    columns: parseInt(document.getElementById('wbCols').value, 10),
    rows: parseInt(document.getElementById('wbRows').value, 10),
    showNumbers: document.getElementById('wbShowNumbers').checked
  };
  playbook.settings.wristband.size = opts.size;
  playbook.settings.wristband.columns = opts.columns;
  playbook.settings.wristband.rows = opts.rows;
  playbook.settings.wristband.showPlayNumbers = opts.showNumbers;
  document.getElementById('wristbandDialog').hidden = true;
  exportWristband(opts);
});

// Resume prompt
document.getElementById('resumeKeep').addEventListener('click', () => {
  const draft = loadDraft();
  if (draft) {
    const err = validatePlaybook(draft);
    if (!err) {
      playbook = draft;
      currentPlayId = playbook.plays[0]?.id;
    }
  }
  document.getElementById('resumePrompt').hidden = true;
  renderAll();
});
document.getElementById('resumeDiscard').addEventListener('click', () => {
  clearDraft();
  document.getElementById('resumePrompt').hidden = true;
});

// Tools
document.querySelectorAll('.tool').forEach(b => {
  b.addEventListener('click', () => setTool(b.dataset.tool));
});
document.querySelectorAll('.style').forEach(b => {
  b.addEventListener('click', () => {
    toolDefaults.routeStyle = b.dataset.style;
    if (selection?.kind === 'route') {
      snapshot();
      findPlayer(selection.id).route.style = b.dataset.style;
    }
    renderAll();
  });
});
document.querySelectorAll('.cap').forEach(b => {
  b.addEventListener('click', () => {
    toolDefaults.routeCap = b.dataset.cap;
    if (selection?.kind === 'route') {
      snapshot();
      findPlayer(selection.id).route.endCap = b.dataset.cap;
    }
    renderAll();
  });
});
document.getElementById('intendedReceiver').addEventListener('change', (e) => {
  toolDefaults.intended = e.target.checked;
  if (selection?.kind === 'route') {
    snapshot();
    findPlayer(selection.id).route.isIntendedReceiver = e.target.checked;
  }
  renderAll();
});

// Undo/redo
document.getElementById('undoBtn').addEventListener('click', undo);
document.getElementById('redoBtn').addEventListener('click', redo);

// Animation
document.getElementById('playBtn').addEventListener('click', playAnimation);
document.getElementById('pauseBtn').addEventListener('click', pauseAnimation);
document.getElementById('resetBtn').addEventListener('click', resetAnimation);
document.getElementById('speedRange').addEventListener('input', (e) => {
  document.getElementById('speedLabel').textContent = parseFloat(e.target.value).toFixed(2) + '×';
});
document.getElementById('scrubber').addEventListener('input', (e) => {
  const t = parseInt(e.target.value, 10) / 1000;
  if (animation.durationMs === 0) animation.durationMs = getPlayDuration();
  renderAnimationFrame(t);
  document.getElementById('timeReadout').textContent = `${(t * animation.durationMs / 1000).toFixed(1)}s / ${(animation.durationMs / 1000).toFixed(1)}s`;
});

// Formation preset
document.getElementById('applyPreset').addEventListener('click', () => {
  if (!confirm('Replace current players with this preset?')) return;
  snapshot();
  const teamSize = parseInt(document.getElementById('teamSize').value, 10);
  const preset = document.getElementById('formationPreset').value;
  playbook.settings.playersPerSide = teamSize;
  const play = currentPlay();
  play.players = makeDefaultPlayers(teamSize, preset, play.losYards);
  selection = null;
  renderAll();
});
document.getElementById('teamSize').addEventListener('change', (e) => {
  playbook.settings.playersPerSide = parseInt(e.target.value, 10);
  saveDraft();
});
document.getElementById('showFieldLines').addEventListener('change', (e) => {
  snapshot();
  playbook.settings.showFieldLines = e.target.checked;
  renderAll();
});
document.getElementById('teamColor').addEventListener('change', (e) => {
  snapshot();
  playbook.settings.teamColor = e.target.value;
  renderAll();
});

// Play meta
document.getElementById('playbookName').addEventListener('change', (e) => {
  snapshot();
  playbook.name = e.target.value;
});
document.getElementById('playName').addEventListener('change', (e) => {
  snapshot();
  currentPlay().name = e.target.value;
  renderPlaysList();
});
document.getElementById('playCategory').addEventListener('change', (e) => {
  snapshot();
  currentPlay().category = e.target.value;
});
document.getElementById('playCallCode').addEventListener('change', (e) => {
  snapshot();
  currentPlay().playCallCode = e.target.value;
});
document.getElementById('playNotes').addEventListener('change', (e) => {
  snapshot();
  currentPlay().notes = e.target.value;
});
document.getElementById('includeOnWristband').addEventListener('change', (e) => {
  snapshot();
  currentPlay().includeOnWristband = e.target.checked;
});

// Play list actions
document.getElementById('addPlayBtn').addEventListener('click', addPlay);
document.getElementById('duplicatePlayBtn').addEventListener('click', duplicatePlay);
document.getElementById('flipPlayBtn').addEventListener('click', flipPlay);
document.getElementById('deletePlayBtn').addEventListener('click', deletePlay);

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  const isMod = e.ctrlKey || e.metaKey;
  if (isMod && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (isMod && e.key === 's') { e.preventDefault(); savePlaybookToFile(); return; }
  if (isMod && e.key === 'o') { e.preventDefault(); document.getElementById('fileInput').click(); return; }
  if (isMod && e.key === 'd') { e.preventDefault(); duplicatePlay(); return; }
  switch (e.key) {
    case 'v': case 'V': setTool('select'); break;
    case 'r': case 'R':
      if (selection?.kind === 'player') startRoute(selection.id);
      else setTool('route');
      break;
    case 't': case 'T': setTool('text'); break;
    case 'b': case 'B': setTool('ball'); break;
    case 'f': case 'F': flipPlay(); break;
    case 'Escape':
      if (drawingRoute) finishRoute(false);
      else clearSelection();
      closePlayerPopover();
      break;
    case 'Enter':
      if (drawingRoute) finishRoute(true);
      break;
    case 'Delete': case 'Backspace':
      handleDelete();
      break;
    case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight':
      handleNudge(e.key, e.shiftKey);
      e.preventDefault();
      break;
  }
});

function handleDelete() {
  if (!selection) return;
  if (selection.kind === 'player') {
    const p = findPlayer(selection.id);
    if (!p) return;
    if (p.route && !confirm('Delete player with route?')) return;
    snapshot();
    const play = currentPlay();
    play.players = play.players.filter(x => x.id !== p.id);
    selection = null;
  } else if (selection.kind === 'route') {
    snapshot();
    const p = findPlayer(selection.id);
    if (p) p.route = undefined;
    selection = null;
  } else if (selection.kind === 'annotation') {
    snapshot();
    const play = currentPlay();
    play.annotations = play.annotations.filter(a => a.id !== selection.id);
    selection = null;
  }
  renderAll();
}

function handleNudge(key, big) {
  if (!selection) return;
  const step = big ? 1 : 0.25;
  let dx = 0, dy = 0;
  if (key === 'ArrowUp') dy = step;
  if (key === 'ArrowDown') dy = -step;
  if (key === 'ArrowLeft') dx = -step;
  if (key === 'ArrowRight') dx = step;
  snapshot();
  if (selection.kind === 'player') {
    const p = findPlayer(selection.id);
    if (!p) return;
    p.start.x = clamp(p.start.x + dx, 0.5, FIELD_WIDTH_YD - 0.5);
    p.start.y = clamp(p.start.y + dy, 0.5, currentPlay().losYards);
  } else if (selection.kind === 'annotation') {
    const a = findAnnotation(selection.id);
    if (a) { a.x += dx; a.y += dy; }
  } else if (selection.kind === 'route' && selection.anchorIndex !== undefined) {
    const p = findPlayer(selection.id);
    const a = p?.route?.anchors[selection.anchorIndex];
    if (a) { a.x += dx; a.y += dy; }
  }
  renderAll();
}

// ============================================================
// Init
// ============================================================
function init() {
  const draft = loadDraft();
  if (draft && validatePlaybook(draft) === null) {
    document.getElementById('resumePrompt').hidden = false;
  }
  renderAll();
}

init();

})();
