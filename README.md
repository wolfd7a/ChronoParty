# ChronoParty

A React + Vite app containing two games:

- **Chrono-Party** — the original three-round, two-team card-guessing party game.
- **P.O.N.** — a browser clone of the first-person stealth heist horror game, added under `src/games/pon/`.

```bash
npm install
npm run dev      # http://localhost:5173/ChronoParty/
npm run build
npm run lint
```

---

## P.O.N.

A single-player, browser-native take on [P.O.N.](https://store.steampowered.com/app/3864580),
the co-op stealth crime-horror game in which you are the criminal and the thing
hunting you is the closest thing the city has to a superhero. The original is a
1–4 player first-person heist game against an AI "super predator"; this clone
keeps the premise and the pressure, and drops the co-op.

You are inside Meridian Trust at 03:40. Take **six pieces** out of the building,
at least **two of them data**, and reach the fire stairwell.

### Three tiers of threat

| | Behaviour | What it costs you |
|---|---|---|
| **Cameras** | Sweep a fixed arc; fill a detection meter rather than tripping instantly | Information |
| **Drones** | Patrol corridors, hear every noise event, chase on sight | Your position |
| **The predator** | patrol → investigate → stalk → hunt → perch | The run |

The predator is **faster than a sprinting player, on purpose.** You cannot win a
footrace. You break line of sight, kill the torch, crouch, and let it lose the
thread. Its signature move is to close in a wide arc, stop somewhere you can
just barely see it, hold for a beat, and be gone — then reappear somewhere you
were not looking.

Being caught is not death. It takes the bag, puts everything back where it was,
and leaves you at the loading dock for the police. Run out of strikes and you
are arrested.

### Controls

| Key | |
|---|---|
| `W A S D` / `Z Q S D` | Move |
| Mouse | Look — click the canvas to capture the pointer |
| `Shift` | Sprint. Loud, and it burns stamina |
| `Ctrl` / `C` | Crouch. Quiet, slow |
| `F` | Torch. It lets you see; it also lets you be seen |
| `E` | Take loot / hold to hack a terminal / extract |
| `G` | Throw a bolt — a loud noise somewhere you are not |
| `Tab` | Tactical tablet: floorplan, remaining take, contact sector |
| `Esc` | Pause |

On coarse-pointer devices a touch layer appears: the left half of the screen is
a virtual stick, the right half is look, and the action buttons sit bottom-right.

### How it is built

No engine, no game library, and **no binary assets** — every wall texture,
sprite and sound is generated at runtime.

```
src/games/pon/
  PonGame.jsx        React shell: briefing, HUD, pause, results
  TabletMap.jsx      the in-fiction floorplan
  pon.css            all styling, scoped under .pon
  engine/
    textures.js      procedural wall/floor/sprite atlas painted onto canvases
    level.js         the building — rooms carved from solid, baked lightmap
    pathfind.js      binary-heap grid A*
    renderer.js      per-pixel software raycaster
    ai.js            predator FSM, drones, cameras
    audio.js         WebAudio synthesis — oscillators and one noise buffer
    game.js          simulation, input, objectives, HUD bridge
```

**Renderer.** A software raycaster drawing into an `ImageData` buffer at a low
internal resolution (220/300/400 px tall, selectable) and upscaled with
smoothing off. Working per pixel rather than per column is what makes the
lighting real: a baked RGB lightmap with line-of-sight occlusion, a flashlight
cone evaluated as a 3D angle, distance fog, and sprite blending against a
per-column depth buffer. Floor and ceiling lighting is sampled every fourth row
and interpolated, which removes three quarters of the bilinear work for no
visible difference. It holds 60 fps at 1120×700.

**Light is a mechanic, not decoration.** `brightnessAt()` reads the same baked
lightmap the renderer draws from, and feeds straight into how easily the
predator picks you up. The lobby is the brightest room in the building and the
worst place to stand; the vault is emergency red; the service shaft is one dying
sodium fixture and a lot of nothing.

**Audio** is synthesised from oscillators and a single white-noise buffer, so
the mix can respond continuously to game state — the drone bed detunes and opens
its filter as dread rises, and the heartbeat rate is a direct function of how
close the thing is.

**The map** is carved from a solid grid rather than typed as ASCII: three
vertical service corridors crossed by three horizontal ones, with nine rooms in
the gaps. Every room has at least two ways out so a chase always has somewhere
to go — except the vault, whose second exit is a maintenance hatch most players
never find.

In development, `window.__PON__` exposes the running `Game` instance for
poking at from the console.
