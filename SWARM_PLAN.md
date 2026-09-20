# Rat Run — Swarm Build Plan

## Coordinator brief
Build a browser-playable, cinematic 2D faux-3D endless runner: a rat races through a moonlit sewer while a cat closes in. The game must have a start screen, pause screen, game-over screen, responsive keyboard controls, escalating chase set pieces, and atmospheric audio feedback without external assets.

## Org chart

- **Swarm Coordinator / Game Director** — owns the experience contract, state flow, and integration gate.
  - **Lead Gameplay Engineer**
    - Specialist: runner simulation, lane physics, hazards, scoring, cat pressure, input handling.
    - Specialist: audio feedback and persistence.
  - **Lead Visual Systems Engineer**
    - Specialist: canvas renderer, sewer perspective, lighting, particles, character animation.
    - Specialist: responsive HUD and scene panels.
  - **Lead Quality Engineer**
    - Specialist: manual/browser smoke checks, accessibility pass, and documentation.

## Shared contracts

- `index.html` owns semantic controls and the canvas mount point.
- `styles.css` owns presentation, responsive layout, and panel states; gameplay must not depend on CSS geometry.
- `game.js` owns all simulation and rendering in a single `Game` object with explicit `start`, `pause`, `resume`, `restart`, and `gameOver` state transitions.
- Virtual canvas is 1280x720; all world coordinates are virtual and the renderer scales to the actual viewport.
- A run starts from a user gesture so Web Audio can be unlocked safely.
- Keyboard: ArrowLeft/ArrowRight or A/D lane changes, ArrowUp/W/Space jump, ArrowDown/S slide, P/Escape pause.
- No third-party runtime dependency or remote asset is required; visuals and audio are generated locally.

## Acceptance gate

1. Launch panel is immediately usable and explains controls.
2. Start -> playing -> pause/resume -> game over -> retry transitions work.
3. The rat changes lanes, jumps, and slides; hazards can be avoided or collided with.
4. Speed, score, cat pressure, atmosphere, and hazard density escalate over time.
5. Responsive layout works for desktop and narrow screens; touch/mouse buttons are optional enhancements, not required.
6. Best score persists locally, no uncaught runtime errors, and `index.html` can be served with a plain static server.
