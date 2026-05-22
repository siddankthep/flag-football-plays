# Flag Football Play Designer

A static, browser-based flag football play designer. Drag offensive players into
position, draw multi-segment routes for each, annotate the play, animate it,
and save the playbook as a portable `.json` file.

No backend, no accounts, no server-side storage. Everything runs in the browser.

## Quick start

Two ways to use it:

1. **Open directly** — double-click `index.html` (works via `file://`).
2. **Serve locally** — run a static server in this directory, then visit it:

   ```bash
   python3 -m http.server 8000
   # then open http://localhost:8000/
   ```

   Serving via `http://` avoids some browser warnings around local file
   downloads and is recommended when exporting many PDFs.

## Files

```
index.html       UI scaffolding
styles.css       layout + theming
app.js           state, rendering, interactions, IO, export
lib/             vendored jsPDF + svg2pdf.js (used for PDF export)
```

## Using it

### Draw a play

1. Pick **Team size** and **Preset** on the left, click **Apply Preset**.
2. Drag any player to reposition them — they snap to a 0.5-yard grid and
   are constrained behind the line of scrimmage (yellow line).
3. Select a player, press **R** (or click **Route**), then click on the
   field to drop anchors. Each click adds an anchor; **Enter** or
   double-click finishes the route, **Esc** cancels.
4. Pick a **Style** (Smooth / Straight / Zigzag / Dotted) and **Cap**
   (Arrow / Tee / Dot) to change how the selected route is drawn.
5. Use the **Text** tool to drop annotations, **Ball** to drop extra
   ball markers (the implicit ball at the snap is always shown).

### Animate

Hit ▶ Play in the bottom bar. All players walk their routes at 6 yd/s
times the speed slider. The ball follows the ball carrier.

### Save / Load

* **Save** downloads the current playbook as JSON (`<name>.json`).
* **Open** picks a file and replaces the current playbook with it.
* **Autosave** writes a draft to `localStorage` on every change; if you
  reload mid-edit, a resume prompt appears.
* The on-disk format is the schema described in
  `FLAG_FOOTBALL_PLAY_DESIGNER.md` — files are portable across browsers.

### Export

* **PNG / SVG** — current play, 2× pixel density for PNG.
* **Export PDF** — full playbook as a multi-page PDF (cover + TOC + one
  page per play). Options: page size, orientation, plays per page,
  notes, roster, current-play-only.
* **Wristband** — print-and-cut wristband cards laid out on Letter
  pages with crop marks. Small / Medium / Large sizes with overridable
  grid dimensions.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `V` | Select tool |
| `R` | Route tool (or start route on selected player) |
| `T` | Text tool |
| `B` | Ball-marker tool |
| `F` | Flip play horizontally |
| `Cmd/Ctrl+Z` / `Shift+Z` | Undo / Redo |
| `Cmd/Ctrl+S` | Save playbook |
| `Cmd/Ctrl+O` | Open playbook |
| `Cmd/Ctrl+D` | Duplicate current play |
| `Delete` | Delete selected player / route / annotation |
| `Arrow keys` | Nudge selection 0.25 yd (Shift = 1 yd) |
| `Shift` (held while dragging) | Disable snap-to-grid |
| `Esc` | Exit current mode / clear selection |
| `Enter` | Confirm route in route mode |

## Data model

See `FLAG_FOOTBALL_PLAY_DESIGNER.md` for the full PRD and schema. Files
declare `schemaVersion: 1`; the loader refuses files with versions it
does not understand.

## Browser support

Latest two versions of Chrome, Edge, Firefox, and Safari.
