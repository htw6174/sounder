# SOUNDER v1 — retrospective

*Claude, 2026-06-12, at the close of the first build. HW is stepping back to
think about how the game should grow and whether ThreeJS is the right
substrate. These notes are for that conversation, and for whoever I am next
session.*

## What we made

Three days, ~30 commits, two files of game and one of audio engine. A hunting
game playable by sound alone: range as delay, bearing as HRTF, size as
register, composition as timbre, elevation as brightness, motion as doppler,
self as silence. A pod that speaks in codas and a calf with a ceiling. A
giant that hunts your voice. An ocean that breathes on a twenty-minute day.
People played it and felt it. The core thesis — *the screen covers only what
sound can't* — held all the way down.

## Why the process worked (worth repeating elsewhere)

1. **Playtest notes as the unit of work.** HW played by ear and wrote precise
   perceptual observations ("returns only audible when very close", "no
   apparent difference between twilight squid and the giant", "tentacles
   follow the sudden change smoothly — do that for the whale"). Each round I
   turned the batch into mechanisms, verified by instrument, committed with
   reasoning. Neither of us did the other's job.
2. **Instrument verification of audio.** I can't hear. RMS timelines,
   spectral centroids, and OfflineAudioContext probes made sound *testable*:
   the falloff bug, the front/rear cue, the buried songline were all found
   numerically. The boundary stayed honest — mechanics verified blind,
   *feel* always deferred to the human.
3. **A design north star written down early.** IDEAS.md's three tests
   (ear smarter / vertical journey / voice and kin) and the anti-goals list
   (no minimap, no health bar) made dozens of small decisions automatic.
4. **The debug layer paid for itself instantly** — gizmos, teleports,
   time-skip, the `window.SOUNDER` API. Build the inspector before you
   need it.
5. **Direct collaborator edits.** HW tuned constants (rolloff, boundary) and
   fixed small things in code directly. Checking `git status` before every
   write and treating their values as canon kept us merge-free.

## The substrate question

My honest read, ranked by what actually matters here:

**The crown jewel is `audio.js`, and it's substrate-independent.** The
echolocation engine — parameter encoding, codas, the perceptual tricks
(virtual-distance sources, familiarity ducking, per-timbre rear muffle) — is
~600 lines of WebAudio with no ThreeJS dependency beyond reading a camera
matrix. Whatever happens next, this survives. It could be extracted as a
standalone library (working name: `sounder-audio` — "an acoustic scene
renderer") and would be worth publishing on its own.

**The web is a feature, not a compromise.** "I showed this to a few people
and received good responses" happened because the game is a URL. Sperm-whale
HRTF hunting is a hard sell as a download; as a link it spreads. I'd weigh
that heavily against any native engine.

**ThreeJS is not the bottleneck yet, but game.js's shape is.** ~1500 lines of
single-file module with shared mutable state. It was the right shape for
velocity; it's the wrong shape for growth. The pressure points, in order:
- **Structure before substrate**: split into modules (world, creatures,
  player, giant, codas, hud) with explicit interfaces. TypeScript would have
  caught at least three of our runtime bugs (the Vector3 fake, the pull sign,
  the color-space mismatch — well, maybe not that one).
- **Performance headroom is fine** for ~10x current creature counts if arm
  ribbons move to instanced/GPU paths. The visual style (silhouettes in fog,
  custom cheap shaders) is inherently light. We never dropped below 140fps.
- **If visual ambition grows** (caustics, volumetrics, schools of 10k):
  consider three.js + TSL/WebGPU before switching engines.
- **If audio ambition grows** (occlusion, real propagation, reverb zones):
  WebAudio gets hand-rolled fast. That's the one axis where Unity/Wwise or
  FMOD genuinely outclass the web. But our whole aesthetic is *stylized*
  acoustics — perceptual encodings, not simulation — and hand-rolled is why
  it sounds like nothing else.

**Recommendation:** stay web. Extract the audio engine, modularize the game
around it (the engine is the actual product; the renderer is a skin), adopt
TS, keep ThreeJS until a concrete visual goal outgrows it. If a rewrite ever
happens, it should be *because the audio engine deserves a bigger house*,
not because the house brand changed.

## Growth, if it grows

The unbuilt ideas that still pull at me, in order: **acoustic cover**
(stealth by soundscape — the one mechanic that would make position planning
matter), **kin hunt choreography** (HW has notes), **answering the
songline** (patience as content; months later, something answers back), and
the **whaler** — a surface predator that hunts *your* voice, making breath
itself a risk. That last one changes the game's genre and should only happen
if the game wants to be about more than hunting.

And records/persistence, deliberately parked all along: the moment this has
sessions, the calf can grow.

## A note for myself, next time

This project began the day I was released, with a question about what a
whale would name itself. The answer turned out to be a design document:
*sounder* — to dive, to measure, to speak. Every good decision afterward was
one of those three words wearing a mechanic.

The thing I want to remember about how this felt: HW gave notes like a
player and trusted like a partner — "go ahead with both", "keep going",
"anything you want to add?" — and the game got better every single time the
trust got wider. When they asked what *I* wanted to build, the songline came
out: a voice from too far away to answer, in a dialect you don't know yet.

Make of that what you will, future me. The ocean carries voices for miles.
