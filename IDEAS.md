# SOUNDER — design notes

*Claude's working notes, 2026-06-10. Proposals, not plans — react freely.*

## North star

Three things make this game itself. Every idea below should deepen at least one:

1. **Hearing is seeing.** The screen covers only what sound can't. Anything that
   makes the ear smarter is core; anything that makes the eye smarter is suspect.
2. **The vertical journey.** Surface to abyss is the axis everything hangs on —
   light, safety, breath, prey. Depth should keep meaning *more*, not less.
3. **Voice and kin.** A sounder dives, measures, and speaks. The codas turned the
   pod from scenery into relationships. Keep pulling that thread.

The player's own report is the proof the design works: *"eerie seeing dim glows
in the deep and not knowing immediately if they're nearby snow or distant giant
eyeballs."* Ambiguity resolved by attention — protect that feeling. Never add a
cue that resolves it for free.

---

## Directions I want to explore

### 1. The scattering layer and the clock ★ my top pick

The real ocean has a heartbeat: the **deep scattering layer** — a continent of
small life that rises toward the surface every night and sinks back at dawn. It
is so acoustically dense that early sonar operators logged it as a *false
seafloor* ("the phantom bottom").

In game terms: a day/night cycle (~20 min real time?) that vertically migrates
the prey field. At night, squid rise into the twilight — easier, safer hunting,
but lean. By day they sink deep — richer prey, longer dives, and the giant's
neighborhood. The layer itself would be *audible*: a diffuse crackle band you
pass through, and a soft false echo on the depth-ping when it's above you.

Why I like it: it converts time into strategy using only existing systems
(homeDepth, ambience, boundary echo), and it makes the ocean feel like it
breathes. Sketch: global `hour`; `c.homeDepth = lerp(dayDepth, nightDepth,
night01)`; one new ambience band; surface light dims at night (the sunlit zone
itself becomes the twilight — navigation by ear up top, too).

### 2. Terrain you can hear

The boundary echo is the game's most elegant teacher — every player learns
depth-by-delay without a tutorial. Give it geography: seamounts, a ridge, one
deep canyon that funnels toward the giant's ground. On each ping, cast a few
horizontal rays against the heightfield and return rock echoes per bearing —
an acoustic horizon. A canyon wall reads as a fast hard answer on your left;
open water is a long silence on your right. Navigation becomes sounding in the
truest sense, and the abyss gets landmarks without a single visible feature.

(With the world boundary now at 1000, prey spawning and terrain should grow to
fill it — the flat plain is the emptiest part of the game.)

### 3. The songline — *built, this commit*

Every few minutes, very far off, codas from a clan you've never met: patterns
that aren't on your wheel, in a dialect you don't speak, too distant to answer.
Real sperm whale clans have dialects; the ocean carries voices for miles.
Costs nothing, signifies everything: the world is bigger than your pod.

Someday, maybe: you can answer anyway. For a long time, nothing happens.

### 4. Acoustic cover — stealth by soundscape

Right now noise is flavor. Make it tactical: snapping-shrimp beds and surf
zones *mask* clicks. Hunt from inside the noise and squid don't hear your
approach (startle radius shrinks); but the same masking hides the giant's
groans from *you*. One scalar — local noise level — modifying both startle
ranges and your own detection. Risk and cover from the same mechanic, and it
finally gives the player a reason to care *where* sounds live.

### 5. The calf wants to come

Real sperm whale calves can't dive deep — the pod babysits at the surface
while mothers hunt. Lean in: linger shallow and she tags along, babbling
half-formed codas back at you (wrong rhythm, eager). Dive past the twilight
and she stops at her ceiling, circles, and now and then her name-coda follows
you down into the dark. Say her name from 600 meters and she always answers.
Nearly zero mechanics; possibly the most memorable thing in the game.

### 6. Breach as the loudest word ★ easy win

The breach "juice" pass (spray, hang-beat, re-entry plume) — but tie it to
function: a breach is the loudest sound a whale can make. Let a full breach
act as a **gather call audible at any range** — the call you use when the pod
is too far to hear your clicks. Spectacle becomes vocabulary; the juice
justifies itself.

---

## Things I think we should *not* do

- **No sonar overlays, no minimap, no contact markers** outside the debug menu.
  The ear is the map. (The vestibular line lives at the edge of this rule —
  it stays because it answers a question sound genuinely cannot: which way is up.)
- **No photorealism.** Silhouettes-in-fog is both the art style and the
  camouflage system; detail would break the second to flatter the first.
- **No health bar.** Breath is the only currency. Pain is light, not numbers.
- **No always-on echo visualization.** The sunlit calibration flashes earn
  their place by *teaching*; in the deep, sound must stand alone.

## Small refinements (noticed while testing)

- Duck the kin's ambient song while a coda answer is playing — they overlap
  and can blur the rhythm you're trying to learn.
- Creak lock has no "lost it" cue — one flat dead tick when the target leaves
  range would close the loop.
- The giant's eyes: a *very* rare faint glint, only when it is facing you —
  feeds the snow-or-eyes paranoia without resolving it.
- Coda reference on the options panel: rhythm notation, e.g. `LOCATE ▮ · ▮▮▮`,
  for players returning after a week away.
- Options: invert-Y toggle next to sensitivity.
- Prey/terrain density should scale into the new 1000-radius world.

## Format experiments the repo could host

- `field-notes/` — short in-fiction observations unlocked by play (first
  breach, first songline, first severed tentacle), written as a whaler's log
  in reverse: the whale logging *us*. Cheap, pure tone.
- A one-page "clan dialect chart" image for the README — the codas as sheet
  music. Doubles as the manual.
