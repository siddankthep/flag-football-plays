# PRD: Flag Football Play Designer (Web)

**Document owner:** [you]
**Target builder:** Claude Code
**Status:** Draft v2
**Last updated:** 2026-05-22

---

## 1. Summary

A static, browser-based flag football play designer inspired by Flag Football Playmaker X. Coaches load the page, drag offensive players into position behind the line of scrimmage, draw multi-segment routes for each player with click-to-anchor mechanics, annotate the play, optionally animate it, and save the play to a JSON file on their local machine.

There is **no backend, no auth, no server-side storage**. The entire app ships as static HTML/CSS/JS. Playbooks live as `.json` files the user downloads and re-imports (drawio model: file-in / file-out, user owns the file).

---

## 2. Goals & non-goals

### Goals

- Let a coach build a single offensive play end-to-end in under 60 seconds.
- Provide the core Playmaker X drawing primitives: drag-and-drop positions, multi-anchor routes, multiple route styles, multiple end caps, text annotations, ball marker, animation playback.
- Persist plays as portable `.json` files the user explicitly saves and loads. No silent server sync.
- Export to **PDF** (full playbook or single play) and **printable wristbands** (grid of plays sized for game-day wear).
- Run as a single static page (open `index.html` directly or host on any static file server / GitHub Pages).

### Non-goals (v1)

- Cloud sync, accounts, multi-device sync.
- Defensive playbook (offense only in v1; design data model so defense can be added later).
- Mobile-first touch UX. (Mouse/trackpad first. Touch should _work_ but won't be optimized.)
- Real-time multiplayer / collaboration.
- A built-in route library ("Run a slant," "Run a post"). Routes are drawn freehand in v1.

---

## 3. Users & primary use cases

**Primary user:** A flag football coach (youth or adult rec league) who wants to draw plays on a laptop and share JSON files with assistant coaches.

**Top use cases**

1. **Draw a new play.** Pick formation size, drop 5 offensive players behind the LOS, draw a route for each eligible receiver, save the file.
2. **Edit an existing play.** Open a saved `.json`, move a player, redraw a route, save (overwrite or save-as).
3. **Animate a play to explain it.** Hit play, watch each player traverse their route at adjustable speed.
4. **Build a playbook.** Save many plays into one `.json` file, browse them in a sidebar, pick one to load into the canvas.

---

## 4. Tech stack & architecture

### Required

- **Vanilla HTML + CSS + JavaScript**, or **React + Vite** producing a static build. Pick one and stick to it — no framework mixing.
- **SVG** for the field, players, and routes. (Not Canvas — SVG gives free hit-testing, easier debugging, easy PNG export, and crisp lines at any zoom.)
- **No backend.** Everything runs in the browser. The page must work when opened via `file://` as well as via `http(s)://`.
- **No external runtime dependencies** beyond what bundles into the static output. Build-time deps are fine.

### Recommended

- If using React: Vite + React 18 + TypeScript. Keep the dependency tree small.
- A small state library is OK (Zustand) but plain React state is enough for v1.
- For drag-and-drop: native pointer events. **Do not** pull in a heavy DnD library — the interactions are simple and need fine control.
- For PDF generation: **jsPDF** + **svg2pdf.js** (renders SVG directly into the PDF, preserving vector quality). Both are client-side and bundle into the static output. Alternative: rasterize SVG to PNG via canvas and embed the PNG — simpler but lossy; use only as fallback.

### Project layout

```
/
  index.html
  src/
    main.{ts,tsx}            # entry
    components/
      Field.tsx              # SVG field + grid + LOS
      Player.tsx             # draggable player token
      Route.tsx              # SVG path renderer for a route
      RouteEditor.tsx        # click-to-anchor drawing controller
      Toolbar.tsx            # mode switcher, route style/cap pickers
      RosterPanel.tsx        # left panel: positions & assignments
      PlaybookPanel.tsx      # right panel: list of plays in current playbook
      AnimationControls.tsx  # play / pause / speed / scrub
      TextAnnotation.tsx
      BallMarker.tsx
    state/
      store.ts               # single source of truth for current play + playbook
      schema.ts              # zod or hand-written validators for JSON files
    io/
      save.ts                # download .json
      load.ts                # parse + validate .json from file picker
      exportPng.ts           # rasterize current play to PNG
      exportPdf.ts           # render playbook / single play to PDF (jsPDF + svg2pdf)
      exportWristband.ts     # render wristband sheet to PDF
    util/
      geometry.ts            # path math, hit testing, snapping
  public/                    # static assets (mascot icons, favicon)
  README.md
```

---

## 5. Data model

The save file is JSON. One file can contain a whole playbook (multiple plays) or just one play. Both shapes are valid; the loader normalizes.

```ts
type Playbook = {
  schemaVersion: 1;
  name: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
  settings: {
    playersPerSide: 4 | 5 | 6 | 7 | 8 | 9;
    fieldUnits: "yards"; // future-proof
    showFieldLines: boolean;
    teamColor: string; // hex, e.g. "#1d4ed8"
    wristband: {
      size: "small" | "medium" | "large"; // see §6.8 for dimensions
      columns: number; // plays across (default 3)
      rows: number; // plays down (default depends on size)
      showPlayNumbers: boolean; // overlay 1, 2, 3 ... for huddle calls
    };
  };
  roster: RosterEntry[]; // optional, can be bunch
  plays: Play[];
};

type RosterEntry = {
  id: string; // uuid
  jerseyNumber?: string;
  name?: string;
  defaultPositionLabel?: string; // "QB", "WR1"
};

type Play = {
  id: string; // uuid
  name: string;
  category?: string; // "Red Zone", "3rd & Short"
  notes?: string;
  playCallCode?: string; // short label printed on wristband, e.g. "R-22"
  includeOnWristband: boolean; // default true
  losYards: number; // distance from bottom of field to LOS, default 10
  ballStart: { x: number; y: number }; // where the ball sits at snap
  players: Player[];
  annotations: Annotation[];
};

type Player = {
  id: string; // uuid
  positionLabel: string; // "QB", "C", "WR1", "RB" — user editable
  color: string; // hex
  shape: "circle" | "square" | "triangle"; // for visual differentiation
  rosterId?: string; // optional link to RosterEntry
  start: { x: number; y: number };
  isBallCarrier: boolean; // true for QB at snap by default
  route?: Route; // optional — linemen / blockers may have no route
};

type Route = {
  // anchors[0] is implicitly the player's start position. Stored separately
  // so moving the player moves the route origin without rewriting anchors.
  anchors: Array<{ x: number; y: number }>;
  style: "smooth" | "straight" | "zigzag" | "dotted";
  // smooth  = curved (Catmull-Rom through anchors)
  // straight = polyline through anchors
  // zigzag   = pre-snap motion
  // dotted   = pitch / pass / hand-off
  endCap: "arrow" | "tee" | "dot"; // "tee" = block, "dot" = stop/settle
  color?: string; // overrides player color if set
  isIntendedReceiver?: boolean; // emphasize visually
};

type Annotation =
  | {
      kind: "text";
      id: string;
      x: number;
      y: number;
      text: string;
      fontSize: number;
    }
  | { kind: "ball"; id: string; x: number; y: number }; // extra ball marker
```

### Coordinate system

- The field is a fixed logical coordinate space: **25 yards wide × 25 yards tall**. The visible window shows **10 yards behind the LOS and 15 yards downfield**. Routes drawn past the visible window are clipped by the SVG viewBox — keep plays inside the window. (Field height was 70 yd in earlier drafts; v1 shrinks it to focus on the area where flag football plays actually develop.)
- All coordinates are stored in **yards**, not pixels. The renderer scales yards → pixels based on viewport size. This keeps files portable across screen sizes and makes "depth" meaningful for animation timing.
- Origin `(0, 0)` is the bottom-left corner of the visible field. The LOS is a horizontal line at `y = losYards` (default `10`, i.e. 10 yards above the bottom edge → 15 yards of downfield space above it).

### Backwards-compat rule

Every file includes `schemaVersion`. The loader refuses files with a version it doesn't understand and shows a clear error. When the schema changes, add a migration function from `vN` → `vN+1`.

---

## 6. Functional requirements

### 6.1 Field rendering

- SVG field rendered at viewport width minus side panels. The visible field shows 10 yards behind the LOS and 15 yards downfield (25 yd × 25 yd square).
- Field background is **white**.
- **5-yard lines** drawn in **grey** (`#9ca3af`). Hash marks (every yard) drawn in lighter grey (`#d1d5db`). Yard-depth numbers (`+5`, `+10`, `+15`) labelled in medium grey. All toggleable via the `showFieldLines` setting.
- **LOS** drawn as a thick dark horizontal line, clearly labeled.
- **Behind-the-LOS zone** very subtly shaded (`rgba(0,0,0,0.04)`) so the constraint is visible without dominating the diagram.
- **Zoom & pan**: pinch / cmd-scroll to zoom, space+drag to pan. Reset-view button in the toolbar. (Nice-to-have for v1; not currently required since the visible window matches the playable area.)

### 6.2 Players: placement & dragging

- A roster panel on the left lists the players for the selected team size (e.g. 5-on-5 → 5 player slots).
- Each player has a default starting position based on a chosen formation preset. Ship these 4 presets in v1: **Base Right**, **Spread (2x2)**, **Bunch (4 wide + QB)**, **Singleback (RB behind QB + 3 WRs)**. User can override by dragging.
- Drag-and-drop rule: **a player's `start` must satisfy `y ≤ losYards`.** If the user releases above the LOS, snap back to the LOS or to the previous valid position. Show a brief visual hint (red dashed LOS line) while dragging illegally.
- Snap-to-grid (0.5 yard increments) by default; hold `Shift` for free placement.
- Players are rendered as colored shapes (circle by default) with the `positionLabel` text inside.
- Double-click a player → opens a small popover to edit `positionLabel`, `color`, `shape`, toggle `isBallCarrier`, and (optionally) link to a roster entry.
- Selected player is highlighted with a ring; arrow keys nudge by 0.25 yards; `Delete` removes them (with confirm if they have a route).

### 6.3 Route drawing (the headline interaction)

This is the most important interaction. Get it right.

**Entering route mode**

- Select a player → toolbar shows a "Draw Route" button (or press `R`).
- Entering route mode locks the canvas: only route-related clicks register. ESC exits without saving the partial route. Enter / double-click finishes the route.

**Drawing**

- **Click** to add an anchor at the cursor location.
- **Click-and-drag** to add an anchor _and_ immediately reposition it before release (useful for precise placement).
- The route's first anchor is **implicit** — it's the player's current `start` position. The user does not click on the player to begin.
- As the user moves the mouse, a **preview segment** is drawn from the last committed anchor to the cursor, styled per the current route style.
- A live readout shows the route length in yards and the depth of the current segment relative to the LOS (useful for "go to 5 yards then break out").

**Editing an existing route**

- Clicking a route selects it. Anchors become draggable handles.
- **Insert anchor**: click on an bunch span of a selected route → inserts an anchor at that point, splitting the segment.
- **Delete anchor**: select an anchor and press `Delete`. (At least 1 anchor must remain or the route is removed entirely.)
- **Right-click an anchor** → context menu: Delete anchor, Convert next segment to {smooth, straight, dotted, zigzag} — _no, scratch that_: route style is a property of the whole route in v1 to keep the schema simple. Per-segment styles are v2.
- **Drag a route's mid-line** moves the whole route relative to the player.

**Style & end cap controls**

- Toolbar exposes 4 style buttons: Smooth, Straight, Zigzag, Dotted.
- And 3 end-cap buttons: Arrow (default — pass route), Tee (block), Dot (stop/settle).
- Changing style/cap applies to the **currently selected** route, or sets the default for the next route drawn if none is selected.
- An "Intended receiver" toggle thickens the route line and brightens its color.

**Rendering rules**

| Style    | SVG output                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------- |
| straight | `<polyline>` through all anchors                                                                      |
| smooth   | Cubic Bézier path; Catmull-Rom interpolation through anchors                                          |
| zigzag   | Replace each segment with a wave path (5–7 oscillations per segment, perpendicular amplitude ~0.4 yd) |
| dotted   | `<polyline>` with `stroke-dasharray="2 2"`                                                            |

End caps render as SVG marker symbols at the last anchor, rotated to match the final segment's angle.

### 6.4 Annotations

- **Text annotation**: click "Text" tool, click on the field, type. Drag to reposition. Double-click to edit. Font size: 8 / 12 / 16 pt.
- **Ball marker**: a small football icon that can be dropped anywhere (in addition to the implicit ball at `ballStart`). Used for showing pitch destinations, fumble points, etc.

### 6.5 Play-level actions

- **New play** — clear canvas (with unsaved-changes confirm).
- **Flip play** — mirror everything horizontally across the field's vertical center line. Players and route anchors all flip; `positionLabel` text is _not_ reversed.
- **Duplicate play** — clone current play into the playbook with name `"<name> (copy)"`.
- **Rename play**, **set category**, **edit notes** — header bar.

### 6.6 Animation

- "Play" button animates every player along their route.
- **Timing model**: each player's animation duration = `routeLengthInYards / speedYardsPerSecond`. Default speed = 6 yd/s. A global speed slider scales all routes from 0.25× to 4×.
- Players without a route remain stationary.
- The ball follows the `isBallCarrier` player; if the ball is "thrown" (a route with style=dotted from QB to a receiver in v2), it follows the dotted path. _v1: ball just follows the ball carrier._
- Scrub bar lets the user drag through the animation timeline.
- "Replay" loops the animation. "Pause" freezes mid-animation. "Reset" returns all players to `start`.

### 6.7 Save / load

- **Save**: serializes the current playbook to JSON and triggers a browser download via a blob URL. Filename: `<playbook-name>.json`.
- **Save current play to new file**: same as save, but exports a playbook containing only the current play. Filename: `<play-name>.json`.
- **Open**: a file picker (`<input type="file" accept=".json">`). On select, parse, validate against the schema, replace current state. If validation fails, show the validation error and refuse to load.
- **Recent files**: list the last N opened filenames in `localStorage` and offer them in the Open menu. _(Note: browsers cannot re-open a previously chosen file without a fresh user gesture. The "recent" list just remembers names; clicking one re-opens the file picker pre-hinted with the name.)_
- **Autosave to localStorage**: every change writes the in-progress playbook to a `localStorage` key (`ffpd:draft`). On page load, if a draft exists, prompt: "Resume unsaved playbook?" This protects against accidental refresh — it is _not_ a substitute for the user explicitly saving a `.json`.

### 6.8 Export

All export operations run client-side and trigger a browser download. No server.

**Image export**

- **Export current play to PNG** — serialize the SVG, draw to a canvas, download as PNG. 2x pixel density.
- **Export current play to SVG** — download the raw SVG of the current play.

**PDF playbook export**

- **Export single play to PDF** — one US Letter (8.5" × 11") page. Top of page: play name, category, play call code, and notes. Center: the play diagram, scaled to fit the page width. Bottom: the playbook name and page number.
- **Export full playbook to PDF** — a cover page (playbook name, team color band, date generated), followed by a table of contents grouped by category, followed by one page per play (same layout as single-play export). Plays are ordered by category, then by their order in the playbook panel.
- **Layout options** in an export dialog:
  - Page size: Letter (default) or A4.
  - Orientation: portrait (default) or landscape.
  - Plays per page: 1 (default), 2, or 4. When >1, plays tile in a grid with smaller diagrams.
  - Include notes: yes / no.
  - Include roster page: yes / no (lists roster with jersey numbers and default positions).
- **Implementation**: use `jsPDF` for the page and text, `svg2pdf.js` to embed each play's SVG as vector content. The output PDF must remain crisp at any zoom — no rasterization unless the SVG contains a non-rasterizable element.

**Wristband export**

A "wristband" is a printed card a player wears on their wrist showing a grid of plays. Each cell shows a small diagram, a play number, and the play name / call code. Coach yells "Play 7" in the huddle, players look at cell 7.

- **Export wristbands to PDF** — produces a PDF sheet sized to print, cut, and laminate. Three wristband sizes (matching common youth/adult flag football wristband holders):

  | Size   | Card dimensions | Default grid    | Plays/card |
  | ------ | --------------- | --------------- | ---------- |
  | Small  | 2.5" × 3.5"     | 3 cols × 4 rows | 12         |
  | Medium | 3" × 4"         | 3 cols × 5 rows | 15         |
  | Large  | 3.5" × 5"       | 4 cols × 6 rows | 24         |

  Grid dimensions are also overridable via `settings.wristband.columns` / `rows`.

- The PDF lays out as many wristband cards as fit per page (2–4 cards per Letter page depending on size), with crop marks on the page so the user can trim them cleanly.
- Each cell contains:
  - Play number in the top-left (1, 2, 3 ... or the user-defined `playCallCode` if `showPlayNumbers` is false).
  - Play name in small text along the top edge.
  - Mini diagram filling the rest of the cell.
- Only plays where `includeOnWristband === true` are included, in the order they appear in the playbook panel.
- If there are more plays than fit on one wristband, generate multiple wristbands on subsequent pages, each labeled "Wristband 1 of N" in the footer.
- **Export dialog** lets the coach: pick size, override grid, choose which categories to include, reorder plays via drag, and preview the wristband layout before downloading.

---

## 7. UI layout

The on-screen chrome is a **full-bleed dark field** with everything else
floating as compact icon-based controls. There are no persistent side
panels — secondary surfaces (plays list, roster, formations, play info,
file operations) open as small right-side drawers anchored under the
relevant top-bar icon, and close on Esc or click-outside.

```
┌────────────────────────────────────────────────────────────────────┐
│ ← Play 1            ⓘ 🔒 ▦ ⇄ ↗ 👤 ▶                       ☁         │  top bar
├────────────────────────────────────────────────────────────────────┤
│ ┌─┐                                                                │
│ │↗│                                                                │
│ │T│              [thin grey yard lines]                            │
│ │●│           X         C         Z         Y                     │  field
│ │↶│                     Q                                          │  (full-bleed)
│ │↷│                                                                │
│ └─┘                                                                │
│ ‹      [✓  smooth straight zigzag dotted │ arrow tee dot │ ★ ✕ ]  ›│  floating
│                                                                    │  route panel
└────────────────────────────────────────────────────────────────────┘
```

- **Top bar** (left → right): back to playbook · play-name input · info ·
  lock-positions · formations · mirror (flip) · route tool · roster ·
  play-animation · file menu (save / open / export / wristband).
- **Field stage**: the SVG field fills the area beneath the top bar.
  Dark background (`#1c1f24`), thin grey yard lines (`#4a4f57`) every
  5 yd. No depth-number labels. The LOS is **not visually highlighted** —
  it is implicitly the line at `y = losYards`. Drag constraints still
  enforce "behind LOS only" via geometry, not visual cue.
- **Left-edge fab toolbar** (vertical pill): Select / Route / Text / Ball
  plus Undo / Redo. Active tool tinted with the accent color.
- **Floating route panel** (bottom-center, appears only when a player or
  route is selected): style buttons (smooth / straight / zigzag / dotted),
  end-cap buttons (arrow / tee / dot), intended-receiver toggle,
  clear-route, and a green confirm to deselect.
- **Page-flip arrows** in the bottom corners navigate between plays in
  the playbook without opening the drawer.
- **Animation bar** appears above the route panel only while playback
  is active.

### Visual style

- **Dark-theme primary.** On-screen field is dark grey (`#1c1f24`)
  with thin lighter-grey yard lines. The look puts the player tokens
  at the centre of attention and lets the routes — drawn in each
  player's color — dominate the readout.
- **Per-position player palette.** Each standard label has its own
  default color so a coach can read the play at a glance without
  consulting a key. Default mapping:

  | Label   | Role             | Color                 | Shape  |
  | ------- | ---------------- | --------------------- | ------ |
  | `Q`     | Quarterback      | `#dc2626`             | circle |
  | `C`     | Center / snapper | `#6b7280`             | square |
  | `X`     | Split end        | `#ea7c1c`             | circle |
  | `Y`     | Flanker          | `#9333ea`             | circle |
  | `Z`     | Slot             | `#0d9488`             | circle |
  | `H`     | H-back           | `#3b82f6`             | circle |
  | `A`/`B` | Additional WR    | `#f59e0b` / `#84cc16` | circle |
  | `R`     | Running back     | `#ec4899`             | circle |
  | `G`/`T` | Lineman          | `#6b7280`             | square |

  Linemen and the centre are grey squares; all skill positions are
  circles. Labels are bold white single letters inside the token.
  Adding a player with a known label auto-applies its color and shape.

- **Routes inherit the player's color.** A route's default render color
  is the assigned player's color. The user can override per-route via
  `Route.color`. Per-color marker symbols (arrow / tee / dot) are
  generated on demand so end caps always match the line.
- **Print-friendly exports.** On-screen rendering is dark; PNG / SVG /
  PDF exports inline a print-friendly stylesheet (white field, grey
  yard lines, dark text annotations) so paper output stays readable
  and ink-cheap.
- **Iconography.** All icons are minimal SVG drawn as part of this
  project (no external icon font, no third-party icon assets).
  Consistent 22 px stroke icons in the top bar, 20 px inside the
  floating route panel.
- **Typography.** Inter or system-ui. The field itself carries no
  textual chrome beyond the player labels — keep the play the focus.

---

## 8. Keyboard shortcuts

| Shortcut                   | Action                            |
| -------------------------- | --------------------------------- |
| `V`                        | Select tool                       |
| `R`                        | Route tool (with player selected) |
| `T`                        | Text tool                         |
| `B`                        | Ball-marker tool                  |
| `Space + drag`             | Pan canvas                        |
| `Cmd/Ctrl + scroll`        | Zoom                              |
| `Cmd/Ctrl + S`             | Save playbook                     |
| `Cmd/Ctrl + O`             | Open playbook                     |
| `Cmd/Ctrl + Z` / `Shift+Z` | Undo / Redo                       |
| `Cmd/Ctrl + D`             | Duplicate selected element        |
| `F`                        | Flip play                         |
| `Delete`                   | Delete selected                   |
| `Esc`                      | Exit current mode                 |
| `Enter`                    | Confirm route in route mode       |
| `Shift` (held)             | Disable snap-to-grid              |

Undo/redo is required and operates on every mutation (player moves, route edits, annotations, settings changes).

---

## 9. Non-functional requirements

- **Performance**: a play with 10 players and 10 routes (≈100 anchors total) must drag/animate at 60fps on a 2019-era laptop. Use `requestAnimationFrame`, avoid re-rendering the entire field on every pointer move.
- **No dependencies on online assets at runtime.** Once the page is loaded (or the static bundle is on disk), it must work offline.
- **File-system safety**: never silently overwrite. Save always triggers a browser download — the user chooses where it lands.
- **Schema validation**: invalid `.json` shows a useful error, doesn't crash the app.
- **Accessibility**: all toolbar buttons keyboard-reachable, focus rings visible. SVG elements have `aria-label`s describing the play. _(Note: drawing routes via keyboard alone is out of scope for v1.)_
- **Browser support**: latest 2 versions of Chrome, Edge, Firefox, Safari. No IE.

---

## 10. Acceptance criteria

The v1 is "done" when a coach can, in a fresh browser session:

1. Open `index.html`.
2. Choose 5-on-5, pick the "Base Right" preset → see 5 players on the field behind the LOS.
3. Drag the slot receiver 2 yards inside → it stays behind the LOS, snaps to grid.
4. Select that receiver, press `R`, click to draw an anchor 5 yards downfield, click again 3 yards to the sideline → a smooth route with an arrow end-cap is drawn.
5. Change the route style to dotted and end cap to dot.
6. Add a text annotation "Hot read" near the receiver.
7. Press the Play button → all players animate along their routes; ball follows the QB.
8. Click Save → a `.json` file downloads.
9. Refresh the page → "Resume unsaved playbook?" prompt appears; either resume or open the saved `.json` and see the play restored exactly.
10. Flip the play → all elements mirror across the vertical centerline.
11. Open in a different browser → file loads identically.
12. Add 2 more plays to the playbook, then click Export PDF → a multi-page PDF downloads with a cover page, table of contents, and one diagram per play, rendered as crisp vectors (no blurry rasterization at zoom).
13. Click Wristband → choose Medium, default 3×5 grid → a Letter-sized PDF downloads with wristband cards laid out with crop marks, each cell containing a numbered mini-diagram of one play.

Every step above should be doable in under ~10 seconds by someone who has used the app once.

---

## 11. Open questions / decisions for the builder

1. **Vanilla JS vs React?** React is faster to build with given the panel/state complexity; vanilla keeps the bundle tiny. Recommendation: React + Vite + TS, but vanilla is acceptable.
2. **Should routes support per-segment styles in v1?** Decision in this PRD: **no.** One style per route. Revisit in v2.
3. **Curve smoothing algorithm**: Catmull-Rom is the recommended default for `smooth` routes (passes through every anchor, no tangent handles needed). Bezier with user-controllable handles is v2.
4. **Defensive plays**: data model leaves room (`Play.players` doesn't enforce side), but v1 UI is offense-only.

---

## 12. Future (v2+)

- Defensive playbook with zone-coverage shading.
- Built-in route library (slant, post, corner, out, dig, wheel, etc.) selectable by name.
- Animated ball: dotted-style routes from QB to receivers trigger ball animation along that path.
- Per-segment route styles.
- Cloud sync (optional, opt-in).
- Touch/iPad-optimized UI.
- Playbook merge: import another `.json` and append its plays into the current playbook.
