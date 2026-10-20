# Vector Arcade

Three browser games built from scratch in plain JavaScript, with no game engine, libraries or build step. Every graphic is drawn on an HTML5 canvas and every sound, including the music, is synthesised live with the Web Audio API. All three can be played with a keyboard or a gamepad.

**Play them:** https://rodrigoperez2803.github.io/vector-arcade/games/

| Neon Rush | Impact Zone | Star Siege |
|---|---|---|
| ![Neon Rush](https://rodrigoperez2803.github.io/img/neon-rush.png) | ![Impact Zone](https://rodrigoperez2803.github.io/img/impact-zone.png) | ![Star Siege](https://rodrigoperez2803.github.io/img/star-siege.png) |
| [Play](https://rodrigoperez2803.github.io/vector-arcade/games/neon-rush/index.html) | [Play](https://rodrigoperez2803.github.io/vector-arcade/games/impact-zone/index.html) | [Play](https://rodrigoperez2803.github.io/vector-arcade/games/star-siege/index.html) |

## The games

**[Neon Rush](games/neon-rush/)**: a pseudo-3D racer in the style of OutRun.
- The road is rendered from projected segments, with curves, hills, parallax scenery, fog and traffic.
- Five themed stages against the clock, with checkpoints, laps and near-miss combos.
- A garage for paint, rims, spoilers, body kits, vinyls, underglow and performance upgrades bought with credits.
- Upgrades feed into the physics: top speed, nitro, handling and grip.

**[Impact Zone](games/impact-zone/)**: a first-person shooter on a custom raycasting engine.
- DDA raycasting into a pixel buffer, with fog, emissive textures and billboard sprites.
- Twelve procedurally generated sectors. Rooms are joined by a minimum spanning tree, and the exit sits behind a locked door that needs a keycard.
- Six weapons with their own mechanics, enemies driven by a flow-field AI, and four multi-phase bosses.
- Random loot, adaptive difficulty, an easy mode and procedural music.

**[Star Siege](games/star-siege/)**: a wave-based space shooter inspired by Asteroids, Galaga and Vampire Survivors.
- A scrolling 4,000 × 4,000 world with a camera, a radar and manual aiming.
- Wave budgets that scale with each wave, elites, and four bosses that change phase.
- Random loot by rarity and ten upgrades that visibly transform the ship.
- A hangar to customise your ship.

## Running locally

There is nothing to install. Open `games/index.html`, or any game's `index.html`, directly in a browser.
