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

### It comes through the ceiling

Its entrance is not a walk down the corridor. When it has a fix on you and a
clear spot ahead of you, the building starts to complain overhead — dust comes
down, the concrete groans, and you get about a second to work out that the
ceiling is the problem. Then it drops, cape flared, into a three-point landing
two metres in front of you: screen shake, a dust and ember burst, and the room
flashing cold blue off its eyes.

The one-second warning is the whole design. A jump scare you could not have
seen coming is just a noise; one you *could* have read is a mistake you made.

### Wren

The real game is 1-4 player co-op, so rather than pretend a solo run is the
whole thing, you get a partner. Wren is physically in the level with you. She
talks — actual speech, via the browser's own speech synthesis, with subtitles
and a radio click either side — and she acts:

- calls what she sees: loot, drones, cameras, your torch, how lit up you are,
  and the ceiling when it starts moving
- pockets anything she walks over, which counts toward the take
- freezes and goes quiet on her own when it gets close
- **on `3`, goes and makes noise somewhere else.** The predator hears it and
  goes to look. This is the only way to move it off you on purpose.

She is a target too, which is what makes any of that matter. If it reaches her
she goes down; hold `E` over her to bring her round. Leave her there and it
comes back for her, and then you have lost the eyes, the second pair of hands,
and the only thing in the building that is on your side.

Her voice can be turned down to subtitles-only in the pause menu, which is also
the accessible path when speech synthesis is unavailable.

### Controls

| Key | |
|---|---|
| `W A S D` / `Z Q S D` | Move |
| Mouse | Look — click the canvas to capture the pointer |
| `Shift` | Sprint. Loud, and it burns stamina |
| `Ctrl` / `C` | Crouch. Quiet, slow |
| `F` | Torch. It lets you see; it also lets you be seen |
| `E` | Take loot / hold to hack a terminal or revive Wren / extract |
| `G` | Throw a bolt — a loud noise somewhere you are not |
| `1` `2` `3` | Wren: follow / hold position / go make noise elsewhere |
| `Tab` | Tactical tablet: floorplan, remaining take, contact sector |
| `Esc` | Pause |

On coarse-pointer devices a touch layer appears: the left half of the screen is
a virtual stick, the right half is look, and the action buttons sit bottom-right.

### How it is built

No engine, no game library, and **no binary assets** — every wall texture,
normal map, sprite and sound is generated at runtime.

```
src/games/pon/
  PonGame.jsx        React shell: briefing, HUD, pause, results
  TabletMap.jsx      the in-fiction floorplan
  pon.css            all styling, scoped under .pon
  engine/
    textures.js      procedural albedo atlas + derived normal/roughness/emissive
    level.js         the building — rooms carved from solid, baked lightmap
    pathfind.js      binary-heap grid A*
    glrenderer.js    WebGL2 renderer (Ultra)
    renderer.js      per-pixel software raycaster (Retro, and the fallback)
    gl/glutil.js     small WebGL2 helpers
    gl/shaders.js    GLSL: scene, sprites, bloom, composite
    ai.js            predator FSM (incl. the ceiling drop), drones, cameras
    companion.js     Wren: behaviour, orders, and her bark book
    voice.js         speech synthesis with priorities, cooldowns and subtitles
    particles.js     dust, sparks and debris
    audio.js         WebAudio synthesis — oscillators and one noise buffer
    game.js          simulation, input, objectives, HUD bridge
```

#### Two renderers

**Ultra — WebGL2.** The scene is one fullscreen fragment shader that raycasts
the grid directly. That is an unusual choice and the right one here: the world
is a uniform grid of unit-height boxes, so a DDA gives *exact* primary
visibility with no geometry, no z-fighting and no LOD — and the same DDA is
reusable for reflection rays and shadow rays, which is where most of the visual
gain comes from.

- Normal-mapped GGX surfaces. Normals are Sobel-derived from each texture's own
  luminance at load; roughness and metalness are per material.
- The baked lightmap has no direction, so its *spatial gradient* stands in for
  one — that is what makes brick and grating read as geometry rather than
  wallpaper.
- The torch is a real spotlight with diffuse, specular and a raymarched
  volumetric cone. Because the light sits at the eye, nothing along the view ray
  can occlude it, so the volumetrics need no shadow march.
- Reflections come nearly free: reflect the view ray, run the DDA again,
  Fresnel-mix. Polished marble and wet grating actually mirror the room.
- Dynamic point lights — the predator's eye glow, Wren's visor, drone strobes —
  cast real shadows via a third DDA.
- Ambient occlusion read straight off the grid. No screen-space pass and no
  temporal filter: the world is boxes, so the occluders are known exactly and a
  few neighbour lookups buy creases and contact darkening.
- Volumetric haze lit by sampling the same baked lightmap the surfaces use,
  which means a doorway with a lit room behind it throws a real shaft for free —
  the occlusion is already baked in. Dust drifts through it.
- Soft contact shadows under characters, which is the difference between a
  sprite standing in the room and a sticker floating in front of it.
- HDR throughout, then bright-pass bloom, ACES filmic tonemapping, chromatic
  aberration, vignette, grain and pre-quantisation dither.
- Renders at native resolution, so no upscale blur.

**Retro — software.** The original per-pixel raycaster into an `ImageData`
buffer at a low internal resolution, upscaled with smoothing off. Still a real
lighting model — baked lightmap, 3D flashlight cone, fog, sprite z-buffer — and
it holds 60 fps at 1120×700 on the CPU alone. It is both a deliberate look and
the automatic fallback when WebGL2 or float render targets are unavailable.

Both consume an identical scene object; sprites are named rather than carrying a
texture, so either renderer can resolve them.

**Adaptive detail.** There is no way to know in advance what GPU the page landed
on, so the engine watches its own frame time and steps the preset down (twice at
most, never up, so it cannot oscillate) if it stays bad for a couple of seconds.

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
