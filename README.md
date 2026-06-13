*Disclaimer: 100% vibe coded and AI-documented*

# SOUNDER

*a sperm whale odyssey*

They named him for the oil they found in his head. The scientific name —
*Physeter macrocephalus*, "big-headed blower" — was the same insult in a toga.
But **to sound** is the old whaling word for diving deep, the mariner's word
for measuring the depths, and the plainest word for making a noise. One word,
three meanings, all of them the whale.

SOUNDER is a deep-sea hunting game meant to be playable with sound alone.
You are a sperm whale. Your clicks are silent in your own ears; you hear only
what the world says back. The screen covers only what sound can't.

**Headphones required.** Not recommended — required. The game is HRTF audio.

## Run

```sh
python3 -m http.server
# open http://localhost:8000
```

No build, no dependencies beyond the vendored `three.module.js`.

## The language of returns

Click, and everything answers. What you hear *is* the information:

| property of the echo | what it tells you |
| --- | --- |
| delay | range — near answers come fast, far answers late (sound here is slow on purpose) |
| bearing (HRTF) | direction |
| brightness | elevation — above you rings bright, below rings dull |
| register | size — big is low, small is high |
| timbre | composition — a granular **shimmer** is a school of fish; a warm **thump** is a whale; a faint breathy **blub** is squid (that's dinner); a hard **crack** is the surface above or the floor below |
| pitch bend | motion — closing contacts answer sharp, fleeing ones flat |
| muffling | behind you — every voice drops an octave astern |

The surface and seafloor answer every click: an acoustic depth gauge and
altimeter. There is no depth readout. You won't miss it.

## Controls

| input | action |
| --- | --- |
| mouse | steer |
| W / S | swim / brake |
| Space / Shift | rise / sink |
| left click | click (ping) |
| hold right click (or C) | creak — a rangefinder buzz on the nearest prey; the tick rate *is* the distance |
| hold E + flick | coda wheel (speak to your pod) |
| F | bite |
| Esc | options |
| ` | debug |

## The codas

Your clan's dialect — rhythmic click patterns. Kin answer in kind, from
wherever they truly are.

| coda | rhythm | meaning |
| --- | --- | --- |
| locate | ▮ · ▮▮▮ | where are you? — the pod answers, a social compass |
| gather | ▮▮▮▮▮ | come to me |
| hunt | ▮▮▮ · ▮ | drive my prey toward me |
| rest | ▮ — ▮ — ▮ | as you were |
| corral | ▮▮ · ▮▮ | circle my prey, let nothing leave |
| name | ▮ · ▮ · ▮▮▮ | it's me. the calf always answers |

A full breach — leaping clear and crashing down — is the loudest word you
have: a gather call the whole sea hears.

## The world

The ocean breathes on a twenty-minute day. At night the deep scattering
layer rises and the hunting is shallow and easy; by day it sinks, and the
rich prey waits down where the light doesn't. Around 580 meters lies the
deep sound channel — a seam in the sea where sound bends and carries
forever. Hold that depth and listen: other clans are out there.

Below 600 meters, something vast listens back. It hunts your voice. If a
long arm takes hold, the pain on the screen tells you the bearing — find
the strain by ear, turn, and bite it off before it hauls you in.

Surface to breathe. Mind the lungs.

---

Built by H.T. Whitney and Claude (Anthropic Fable 5) in conversation,
June 2026. Design notes in [IDEAS.md](IDEAS.md).
