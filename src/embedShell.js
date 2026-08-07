;(function () {
  'use strict'

  /**
   * The game's own DOM shell (the #app subtree) + its full stylesheet, for the
   * EMBEDDED (mounted) path only. mount.js builds SHELL_HTML inside a Shadow
   * DOM root and injects EMBED_CSS as that shadow root's own <style> — Shadow
   * DOM gives full style encapsulation in BOTH directions, so this can be a
   * verbatim copy of styles/main.css (including its `*`/`html,body` rules,
   * which simply match nothing inside a shadow tree — there is no <html>/
   * <body> element in there) with no risk of leaking onto the embedding host
   * page, and no risk of the host page's own styles bleeding in.
   *
   * The ONE real change from main.css: #app is `position:fixed; inset:0` there
   * (the standalone page IS the viewport), which would make an embedded
   * instance cover the whole browser window instead of just its widget. The
   * override at the bottom gives it a normal, bounded, in-flow box instead —
   * RenderEngine already sizes/letterboxes purely off the canvas's own
   * offsetWidth/offsetHeight via ResizeObserver, so no game logic depends on
   * this box being any particular size.
   *
   * Mirrors index.html's own #app markup + styles/main.css exactly (this is
   * the embedded path; the standalone page is untouched and keeps using its
   * own copies directly) — keep the two in sync when either changes.
   */

  const SHELL_HTML = `
<div id="app">
  <canvas id="game-canvas"></canvas>

  <div id="ui-root">
    <div id="screen-menu" class="screen screen--visible">
      <div class="menu-panel">
        <h1 id="menu-title" class="menu-title"></h1>
        <p id="menu-subtitle" class="menu-subtitle"></p>
        <p id="menu-keys" class="keys"></p>
        <p id="menu-difficulty-heading" class="menu-heading-small"></p>
        <div id="difficulty-select" class="difficulty-select"></div>
        <div class="menu-actions">
          <button type="button" id="btn-start" class="btn"><span class="btn__label"></span></button>
        </div>
      </div>
    </div>

    <div id="screen-setup" class="screen" hidden>
      <div class="menu-panel">
        <h2 id="setup-title" class="menu-title menu-title--small"></h2>
        <p id="setup-subtitle" class="menu-subtitle"></p>
        <p id="setup-shape-heading" class="menu-heading-small"></p>
        <div id="formation-select" class="difficulty-select"></div>
        <p id="setup-power-heading" class="menu-heading-small"></p>
        <div id="star-power-select" class="difficulty-select"></div>
        <p id="setup-power-blurb" class="power-blurb"></p>
        <div class="menu-actions">
          <button type="button" id="btn-kickoff" class="btn"><span class="btn__label"></span></button>
          <button type="button" id="btn-setup-back" class="btn btn--secondary"><span class="btn__label"></span></button>
        </div>
      </div>
    </div>

    <div id="screen-over" class="screen" hidden>
      <div class="menu-panel over-panel">
        <h2 id="over-heading" class="over-heading"></h2>
        <p id="over-score" class="over-score"></p>
        <div class="menu-actions">
          <button type="button" id="btn-rematch" class="btn"><span class="btn__label"></span></button>
          <button type="button" id="btn-menu" class="btn btn--secondary"><span class="btn__label"></span></button>
        </div>
      </div>
    </div>

    <div id="hud" hidden>
      <div id="hud-legend"></div>
      <div id="hud-score"></div>
      <div id="hud-clock"></div>
      <div id="hud-formation"></div>
      <div id="hud-star"><div id="hud-star-fill"></div><span id="hud-star-hint" hidden></span></div>
      <div id="hud-star-enemy"><div id="hud-star-enemy-fill"></div></div>
    </div>
    <div id="fx-layer"></div>
  </div>
</div>`

  const EMBED_CSS = `
/* Footie — cute irreverent pixel look. Chunky system fonts, no webfonts
   (must work offline over file://), no filters heavier than a text-shadow. */

:root {
  --grass: #79b043;
  --grass-dark: #4c7a28;
  --night: #12240f;
  --paper: #fdf6e3;
  --ink: #23301c;
  --red: #d5382f;
  --teal: #2fa7a0;
  --gold: #f4b942;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

html, body {
  height: 100%;
  overflow: hidden;
  background: var(--night);
  font-family: "Verdana", "Tahoma", sans-serif;
  user-select: none;
  -webkit-user-select: none;
}

#app { position: fixed; inset: 0; }

#game-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  cursor: crosshair;
  touch-action: none;
}

#ui-root { position: absolute; inset: 0; pointer-events: none; }
#ui-root .screen { pointer-events: auto; }

/* ── Screens ─────────────────────────────────────────────────────────── */

.screen {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(18, 36, 15, 0.55);
  opacity: 0;
  transition: opacity 160ms ease-out;
}
.screen--visible { opacity: 1; }
.screen[hidden] { display: none; }

.menu-panel {
  background: var(--paper);
  color: var(--ink);
  border: 4px solid var(--ink);
  border-radius: 4px;
  box-shadow: 0 6px 0 rgba(0, 0, 0, 0.45);
  padding: 28px 40px 32px;
  text-align: center;
  max-width: 420px;
}

.menu-title {
  font-size: 52px;
  letter-spacing: 6px;
  color: var(--grass-dark);
  text-shadow: 3px 3px 0 var(--gold), 6px 6px 0 rgba(0,0,0,0.15);
  margin-bottom: 4px;
}

/* Sub-screen headings (Team Management) — same look, less shouting. */
.menu-title--small { font-size: 30px; letter-spacing: 3px; }

.menu-subtitle { font-size: 13px; margin-bottom: 16px; opacity: 0.75; font-style: italic; }

.menu-heading-small {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 2px;
  opacity: 0.6;
  margin: 14px 0 6px;
}

.keys { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
.keys__line { display: flex; justify-content: space-between; gap: 24px; }
.keys__line strong { text-transform: uppercase; letter-spacing: 1px; }
.keys__line span { opacity: 0.75; }

.difficulty-select { display: flex; gap: 8px; justify-content: center; margin-bottom: 8px; }

.diff-btn {
  font: inherit;
  font-size: 12px;
  padding: 6px 14px;
  border: 2px solid var(--ink);
  border-radius: 3px;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
}
.diff-btn--active { background: var(--grass); color: #fff; box-shadow: inset 0 -2px 0 rgba(0,0,0,0.25); }

/* Star Power blurb under the power picker (Team Management). */
.power-blurb { font-size: 11px; font-style: italic; opacity: 0.7; margin-top: 6px; min-height: 14px; }

.menu-actions { display: flex; gap: 10px; justify-content: center; margin-top: 16px; }

.btn {
  font: inherit;
  font-weight: bold;
  font-size: 16px;
  padding: 12px 26px;
  border: 3px solid var(--ink);
  border-radius: 4px;
  background: var(--red);
  color: #fff;
  cursor: pointer;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.4);
  text-shadow: 1px 1px 0 rgba(0,0,0,0.35);
}
.btn:active { transform: translateY(2px); box-shadow: 0 2px 0 rgba(0, 0, 0, 0.4); }
.btn--secondary { background: #6b7261; }

/* ── Game over ───────────────────────────────────────────────────────── */

.over-heading { font-size: 38px; color: var(--grass-dark); text-shadow: 2px 2px 0 var(--gold); }
.over-heading--lose { color: var(--red); text-shadow: 2px 2px 0 rgba(0,0,0,0.2); }
.over-heading--draw { color: var(--ink); text-shadow: 2px 2px 0 rgba(0,0,0,0.15); }
.over-score { font-size: 22px; font-weight: bold; margin-top: 8px; }

/* ── HUD ─────────────────────────────────────────────────────────────── */

#hud {
  position: absolute;
  top: 10px;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  pointer-events: none;
  color: #fff;
  text-shadow: 2px 2px 0 rgba(0, 0, 0, 0.55);
}
#hud-legend {
  position: absolute;
  top: 0;
  left: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 10px;
  opacity: 0.75;
}
#hud-legend .keys__line { display: flex; justify-content: space-between; gap: 14px; }
#hud-legend strong { text-transform: uppercase; letter-spacing: 1px; }

#hud-score { font-size: 20px; font-weight: bold; letter-spacing: 1px; }
#hud-clock { font-size: 15px; font-weight: bold; color: var(--gold); }
#hud-formation { font-size: 11px; opacity: 0.85; text-transform: uppercase; letter-spacing: 1px; }

/* Star Power meters — chunky pixel bars, hard borders, no gradients. */
#hud-star {
  position: relative;
  width: 180px;
  height: 10px;
  margin-top: 4px;
  border: 2px solid rgba(0, 0, 0, 0.55);
  background: rgba(18, 36, 15, 0.6);
  pointer-events: none;
}
#hud-star-fill { height: 100%; width: 0%; background: var(--gold); }
#hud-star.hud-star--ready { animation: star-pulse 0.7s steps(2) infinite; }
#hud-star-hint {
  position: absolute;
  right: -46px;
  top: -2px;
  font-size: 9px;
  font-weight: bold;
  letter-spacing: 1px;
  color: var(--gold);
}
#hud-star-enemy {
  width: 120px;
  height: 4px;
  margin-top: 2px;
  border: 2px solid rgba(0, 0, 0, 0.45);
  background: rgba(18, 36, 15, 0.6);
  pointer-events: none;
}
#hud-star-enemy-fill { height: 100%; width: 0%; background: var(--teal); }
@keyframes star-pulse { 50% { box-shadow: 0 0 0 2px var(--gold); } }

/* ── FX toasts ───────────────────────────────────────────────────────── */

#fx-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }

.fx-toast {
  position: absolute;
  left: 50%;
  top: 42%;
  transform: translate(-50%, -50%) scale(1);
  font-size: 56px;
  font-weight: bold;
  letter-spacing: 4px;
  color: #fff;
  text-shadow: 3px 3px 0 rgba(0, 0, 0, 0.5);
  animation: toast-pop 180ms ease-out;
  transition: opacity 350ms ease-out, transform 350ms ease-out;
}
.fx-toast--out { opacity: 0; transform: translate(-50%, -60%) scale(1.15); }

.fx-toast--goal        { color: var(--gold); font-size: 72px; }
.fx-toast--enemy-goal  { color: #ff6a5e; }
.fx-toast--count       { color: #fff; font-size: 64px; }
.fx-toast--golden      { color: var(--gold); font-size: 48px; }
.fx-toast--star        { color: var(--gold); font-size: 44px; }
.fx-toast--star-enemy  { color: #7ee4dd; font-size: 30px; }
.fx-toast--paused      { color: #fff; font-size: 40px; }
.fx-toast--formation {
  top: 24%;
  font-size: 22px;
  letter-spacing: 2px;
  color: #eaf6d9;
}

@keyframes toast-pop {
  from { transform: translate(-50%, -50%) scale(0.4); }
  to   { transform: translate(-50%, -50%) scale(1); }
}

/* ── Embedded-only override ─────────────────────────────────────────────
   Standalone's #app is position:fixed;inset:0 because that page IS the
   viewport. An embedding host's container is not the viewport — give #app a
   normal, bounded, in-flow box instead so the game only occupies its own
   widget area. 16:9 at three-pointer's own 960px width, for visual
   consistency across games embedded in the same arcade context; footie has
   no "native" size of its own to match (RenderEngine letterboxes to
   whatever box the canvas actually gets, so this figure is a presentation
   choice, not a functional constraint). */
#app {
  position: relative;
  width: 960px;
  max-width: 100%;
  aspect-ratio: 16 / 9;
  margin: 0 auto;
}`

  window.Footie.embedShell = { SHELL_HTML, EMBED_CSS }
})()
