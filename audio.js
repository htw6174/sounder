// SOUNDER — echolocation audio engine.
// Every contact in the world is rendered as sound with parameters that
// encode range (echo delay), bearing (HRTF), elevation (brightness),
// size (pitch register + loudness), composition (timbre), and motion
// (doppler). The aim is full spatial awareness through audio alone.
//
// Your own emissions are silent — you are the click; you hear only
// what the world says back.

export const SOUND_SPEED = 220;       // game units/sec — slow sound, readable echoes

const TIMBRES = {
  // dense school of fish: hundreds of tiny scatterers — a shimmering
  // granular cloud, bright, spread in time by the school's depth
  school: { base: 4200, q: 1.2, decay: 0.05, gain: 1.3, grains: true },
  // blubbery whale: soft, warm, enormous — a low dull thump that lingers
  whale:  { base: 110,  q: 0.8, decay: 0.55, gain: 1.5,  tonal: true },
  // squid: barely there — watery, breathy, a faint downward "blub"
  squid:  { base: 1500, q: 3.5, decay: 0.14, gain: 0.75, sweep: -0.4 },
  // terrain / hard surfaces: sharp broadband crack
  rock:   { base: 2600, q: 0.6, decay: 0.25, gain: 1.1 },
};
TIMBRES.giant = { ...TIMBRES.squid, base: 700, decay: 0.3, gain: 0.6 };

export class AudioEngine {
  constructor() {
    this.ready = false;
    this.vol = 0.9;
    this.panners = new Map();     // key -> PannerNode
    this.passive = new Map();     // contact -> {gain, stop()}
    this.heartTimer = 0;
  }

  init() {
    if (this.ready) return;
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createDynamicsCompressor();
    this.master.threshold.value = -18;
    this.master.ratio.value = 6;
    this.out = ctx.createGain();
    this.out.gain.value = this.vol;
    this.master.connect(this.out).connect(ctx.destination);

    // shared noise buffer
    const len = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;

    // gentle abyssal room: a touch of feedback-delay "wash" behind echoes.
    // kept quiet — a diffuse tail blurs the HRTF bearing cue.
    this.wash = ctx.createGain(); this.wash.gain.value = 0.10;
    const dly = ctx.createDelay(1); dly.delayTime.value = 0.23;
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    this.wash.connect(dly).connect(lp).connect(fb).connect(dly);
    lp.connect(this.master);

    // ambient bed: surf hiss up top, sub-bass pressure down deep.
    // both are depth gauges you don't have to ping for.
    const mkLoop = (filterType, freq, q, dest) => {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true; src.playbackRate.value = 0.5;
      const f = ctx.createBiquadFilter();
      f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(dest);
      src.start();
      return g;
    };
    // surf: the wave swell (LFO) and the per-frame depth fade live on
    // SEPARATE gain stages in series, so they multiply instead of fighting
    const swell = ctx.createGain(); swell.gain.value = 1;     // 1 ± 0.45
    const lfoAmp = ctx.createGain(); lfoAmp.gain.value = 0.45;
    this.surfLfo = ctx.createOscillator();
    this.surfLfo.frequency.value = 0.13;
    this.surfLfo.connect(lfoAmp).connect(swell.gain);
    this.surfLfo.start();
    swell.connect(this.master);
    this.surfGain = mkLoop('bandpass', 650, 0.5, swell);
    this.rumbleGain = mkLoop('lowpass', 65, 0.7, this.master);

    this.ready = true;
  }

  // call every frame with how shallow / how deep the player is (0..1 each)
  ambient(shallowFrac, deepFrac) {
    if (!this.ready) return;
    this.surfGain.gain.value = 0.07 * shallowFrac;
    this.rumbleGain.gain.value = 0.09 * deepFrac;
  }

  setVolume(v) {
    this.vol = v;
    if (this.out) this.out.gain.value = v;
  }

  now() { return this.ctx.currentTime; }

  // ------------------------------------------------------------ listener
  updateListener(camera) {
    if (!this.ready) return;
    const l = this.ctx.listener, p = camera.position;
    // forward = -Z column, up = +Y column of the camera's world matrix.
    // direct value sets — ramp-event pileup lags the HRTF and smears bearing.
    const e = camera.matrixWorld.elements;
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = -e[8]; l.forwardY.value = -e[9]; l.forwardZ.value = -e[10];
      l.upX.value = e[4]; l.upY.value = e[5]; l.upZ.value = e[6];
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }

  pannerFor(contact, pos) {
    const key = contact.key ?? contact;     // boundary echoes share keyed panners
    let pan = this.panners.get(key);
    if (!pan) {
      pan = this.ctx.createPanner();
      pan.panningModel = 'HRTF';
      pan.distanceModel = 'exponential';
      pan.refDistance = 6;
      pan.rolloffFactor = 0.85;             // hear the whole water column, not just arm's reach
      pan.connect(this.master);
      pan.connect(this.wash);
      this.panners.set(key, pan);
    }
    if (pan.positionX) {
      pan.positionX.value = pos.x; pan.positionY.value = pos.y; pan.positionZ.value = pos.z;
    } else pan.setPosition(pos.x, pos.y, pos.z);
    return pan;
  }

  dropPanner(contact) {
    const key = contact.key ?? contact;
    const pan = this.panners.get(key);
    if (pan) { pan.disconnect(); this.panners.delete(key); }
    this.stopPassive(contact);
  }

  // ------------------------------------------------------------ echoes
  // Schedule the return from one contact. All the perception encoding
  // happens here.
  //   contact: { kind, pos, size, density?, spread?, vel?, key? }
  //   observer: { pos, vel }
  echo(contact, observer) {
    if (!this.ready) return 0;
    const dx = contact.pos.x - observer.pos.x;
    const dy = contact.pos.y - observer.pos.y;
    const dz = contact.pos.z - observer.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.5 || dist > 420) return 0;

    const delay = (2 * dist) / SOUND_SPEED;
    const t = this.now() + delay;
    const T = TIMBRES[contact.kind] ?? TIMBRES.rock;

    // elevation → brightness: contacts above you ring brighter, below duller
    const elev = dy / dist;                          // -1..1
    const brightness = Math.pow(2, elev * 0.9);

    // absorption: distance dulls everything — gently
    const absorb = 9000 * Math.exp(-dist / 300) + 1200;

    // size → register: big = deep. loudness grows with size too.
    const size = contact.size ?? 1;
    const reg = 1 / Math.pow(size, 0.55);

    // doppler: closing contacts return sharp, fleeing ones flat
    let dop = 1;
    if (contact.vel) {
      const vr = (contact.vel.x * dx + contact.vel.y * dy + contact.vel.z * dz) / dist
               - ((observer.vel?.x ?? 0) * dx + (observer.vel?.y ?? 0) * dy + (observer.vel?.z ?? 0) * dz) / dist;
      dop = Math.min(Math.max(1 - (vr / SOUND_SPEED) * 2.5, 0.75), 1.3);
    }

    // facing → muffle: HRTF alone is weak front/back, so encode it hard.
    // a return from dead astern is much duller and a touch quieter.
    let front01 = 1;
    if (observer.fwd) {
      const dot = (observer.fwd.x * dx + observer.fwd.y * dy + observer.fwd.z * dz) / dist;
      front01 = 0.5 + 0.5 * dot;
    }
    // behind you, every voice drops by more than half an octave — a timbre
    // cue that survives whatever band the contact speaks in
    const dirMul = 0.55 + 0.45 * front01;

    // mild extra spreading loss on top of the panner's — slow by design:
    // range is told by DELAY, not by silence
    const loss = 1 / (1 + dist * 0.004);
    const gain = T.gain * loss * Math.min(Math.pow(size, 0.8), 3) * (0.75 + 0.25 * front01);

    const pan = this.pannerFor(contact, contact.pos);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = absorb * (0.35 + 0.65 * front01);
    lp.connect(pan);
    setTimeout(() => lp.disconnect(), (delay + 2) * 1000);

    if (T.grains) {
      // fish school: a cloud of micro-echoes. density → grain count,
      // physical spread → time smear. You can HEAR the school's texture.
      const density = contact.density ?? 1;
      const n = Math.round(12 + 40 * density * Math.min(size, 2));
      const smear = 0.03 + (contact.spread ?? size * 4) / SOUND_SPEED;
      for (let i = 0; i < n; i++) {
        const gt = t + Math.random() * smear;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noise;
        src.playbackRate.value = (1.5 + Math.random()) * dop;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = T.base * brightness * reg * dirMul * (0.6 + Math.random() * 0.9);
        bp.Q.value = 6;
        const g = this.ctx.createGain();
        const gv = (gain / Math.sqrt(n)) * (0.4 + Math.random() * 0.6) * 1.4;
        g.gain.setValueAtTime(gv, gt);
        g.gain.exponentialRampToValueAtTime(0.0008, gt + T.decay * (0.5 + Math.random()));
        src.connect(bp).connect(g).connect(lp);
        src.start(gt, Math.random(), 0.05);
      }
    } else if (T.tonal) {
      // whale: warm tonal thump
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = T.base * reg * brightness * dop;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain * 0.8, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + T.decay);
      osc.connect(g).connect(lp);
      osc.start(t); osc.stop(t + T.decay + 0.1);
      // blubber body: dull noise behind the tone
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise; src.playbackRate.value = 0.4 * dop;
      const lp2 = this.ctx.createBiquadFilter();
      lp2.type = 'lowpass'; lp2.frequency.value = 320 * brightness * dirMul;
      const g2 = this.ctx.createGain();
      g2.gain.setValueAtTime(gain * 0.35, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + T.decay * 0.8);
      src.connect(lp2).connect(g2).connect(lp);
      src.start(t, Math.random(), T.decay);
    } else {
      // squid / rock: filtered noise burst, optional pitch sweep
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = dop;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = T.q;
      const f0 = T.base * reg * brightness * dirMul;
      bp.frequency.setValueAtTime(f0, t);
      if (T.sweep) bp.frequency.exponentialRampToValueAtTime(f0 * (1 + T.sweep), t + T.decay);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain * 0.6, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + T.decay);
      src.connect(bp).connect(g).connect(lp);
      src.start(t, Math.random(), T.decay + 0.05);
    }
    return delay;
  }

  // creak return: one micro-echo from the locked target. The tick RATE is
  // the rangefinder (the caller times ticks at the round-trip interval);
  // each tick arrives from the target's true bearing with its timbre.
  creakEcho(contact, observer) {
    if (!this.ready) return 0;
    const dx = contact.pos.x - observer.pos.x;
    const dy = contact.pos.y - observer.pos.y;
    const dz = contact.pos.z - observer.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.5 || dist > 120) return 0;

    const delay = (2 * dist) / SOUND_SPEED;
    const t = this.now() + delay;
    const T = TIMBRES[contact.kind] ?? TIMBRES.rock;
    const brightness = Math.pow(2, (dy / dist) * 0.9);
    const reg = 1 / Math.pow(contact.size ?? 1, 0.55);
    let front01 = 1;
    if (observer.fwd) {
      const dot = (observer.fwd.x * dx + observer.fwd.y * dy + observer.fwd.z * dz) / dist;
      front01 = 0.5 + 0.5 * dot;
    }
    const pan = this.pannerFor(contact, contact.pos);

    const grains = T.grains ? 3 : 1;
    for (let i = 0; i < grains; i++) {
      const gt = t + i * 0.008;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = 1.2 + Math.random() * 0.6;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = Math.max(T.q, 2);
      bp.frequency.value = T.base * brightness * reg * (0.8 + Math.random() * 0.4) * (0.5 + 0.5 * front01);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime((0.32 / grains) * (0.8 + 0.2 * front01), gt);
      g.gain.exponentialRampToValueAtTime(0.001, gt + 0.045);
      src.connect(bp).connect(g).connect(pan);
      src.start(gt, Math.random(), 0.05);
    }
    return delay;
  }

  // mirror flashes from the surface above and the seafloor below —
  // an acoustic depth gauge and altimeter. keyed panners, reused per ping.
  boundaryEcho(depthBelowSurface, altitudeAboveFloor, observerPos) {
    if (!this.ready) return;
    if (depthBelowSurface > 1) {
      this.echo(
        { key: 'surface', kind: 'rock', pos: { x: observerPos.x, y: observerPos.y + depthBelowSurface, z: observerPos.z }, size: 1.4 },
        { pos: observerPos }
      );
    }
    if (altitudeAboveFloor > 1 && altitudeAboveFloor < 420) {
      this.echo(
        { key: 'floor', kind: 'rock', pos: { x: observerPos.x, y: observerPos.y - altitudeAboveFloor, z: observerPos.z }, size: 6 },
        { pos: observerPos }
      );
    }
  }

  // ------------------------------------------------------------ passive layer
  // sounds the world makes on its own, attached per contact while in range
  startPassive(contact) {
    if (!this.ready || this.passive.has(contact)) return;
    const pan = this.pannerFor(contact, contact.pos);
    const master = this.ctx.createGain();
    master.gain.value = 0;
    const muffle = this.ctx.createBiquadFilter();
    muffle.type = 'lowpass'; muffle.frequency.value = 12000;
    master.connect(muffle).connect(pan);
    let alive = true;
    const entry = { gain: master, muffle, stop: () => { alive = false; master.disconnect(); muffle.disconnect(); } };

    if (contact.kind === 'school') {
      // faint static crackle, like rain on the hull
      const loop = () => {
        if (!alive) return;
        const t = this.now();
        const src = this.ctx.createBufferSource();
        src.buffer = this.noise; src.playbackRate.value = 2 + Math.random();
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 5000 + Math.random() * 3000; bp.Q.value = 8;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.05 + Math.random() * 0.05, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
        src.connect(bp).connect(g).connect(master);
        src.start(t, Math.random(), 0.04);
        entry.timer = setTimeout(loop, 30 + Math.random() * 120 / (contact.density ?? 1));
      };
      loop();
    } else if (contact.kind === 'whale') {
      // slow moaning phrases
      const phrase = () => {
        if (!alive) return;
        const t = this.now();
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        const f = 90 + Math.random() * 120;
        osc.frequency.setValueAtTime(f, t);
        osc.frequency.linearRampToValueAtTime(f * (0.7 + Math.random() * 0.7), t + 2.2);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.4, t + 0.7);
        g.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
        osc.connect(g).connect(master);
        osc.start(t); osc.stop(t + 2.8);
        entry.timer = setTimeout(phrase, 4000 + Math.random() * 9000);
      };
      entry.timer = setTimeout(phrase, Math.random() * 4000);
    } else if (contact.kind === 'giant') {
      // something enormous breathing in the dark
      const groan = () => {
        if (!alive) return;
        const t = this.now();
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(38, t);
        osc.frequency.linearRampToValueAtTime(26, t + 3.5);
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 120;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.65, t + 1.4);
        g.gain.exponentialRampToValueAtTime(0.001, t + 4);
        osc.connect(lp).connect(g).connect(master);
        osc.start(t); osc.stop(t + 4.2);
        entry.timer = setTimeout(groan, 9000 + Math.random() * 14000);
      };
      entry.timer = setTimeout(groan, 2000 + Math.random() * 6000);
    }

    const stop0 = entry.stop;
    entry.stop = () => { clearTimeout(entry.timer); stop0(); };
    this.passive.set(contact, entry);
    master.gain.linearRampToValueAtTime(1, this.now() + 1.5);
  }

  // facing-dependent dullness for a contact's passive sound (front01: 0 rear, 1 front)
  setPassiveMuffle(contact, front01) {
    const e = this.passive.get(contact);
    if (e?.muffle) e.muffle.frequency.value = 700 + front01 * 8000;
  }

  stopPassive(contact) {
    const e = this.passive.get(contact);
    if (e) { e.stop(); this.passive.delete(contact); }
  }

  // squid jetting right past you — a watery whoosh at its position
  jet(contact) {
    if (!this.ready) return;
    const t = this.now();
    const pan = this.pannerFor(contact, contact.pos);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.playbackRate.value = 0.7;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(1400, t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(bp).connect(g).connect(pan);
    src.start(t, Math.random(), 0.55);
  }

  // ------------------------------------------------------------ codas
  // gaps: seconds between clicks. contact null = your own voice (in-skull);
  // otherwise the answer arrives spatialized from the speaker.
  coda(gaps, contact = null) {
    if (!this.ready) return;
    let t = this.now() + 0.02;
    const dest = contact ? this.pannerFor(contact, contact.pos) : this.master;
    for (const gap of gaps) {
      t += gap;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise; src.playbackRate.value = contact ? 1.9 : 1.4;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = contact ? 2300 : 1600; bp.Q.value = 1.4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(contact ? 0.5 : 0.26, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
      src.connect(bp).connect(g).connect(dest);
      src.start(t, Math.random(), 0.05);
      // low body under each click
      const th = this.ctx.createOscillator();
      th.type = 'sine'; th.frequency.value = contact ? 220 : 150;
      const tg = this.ctx.createGain();
      tg.gain.setValueAtTime(contact ? 0.16 : 0.12, t);
      tg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      th.connect(tg).connect(dest);
      th.start(t); th.stop(t + 0.07);
    }
  }

  // the giant takes hold — wet, low, final
  seize() {
    if (!this.ready) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.playbackRate.value = 0.45;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.85, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random(), 1.0);
    const th = this.ctx.createOscillator();
    th.type = 'sine';
    th.frequency.setValueAtTime(70, t);
    th.frequency.exponentialRampToValueAtTime(34, t + 0.7);
    const tg = this.ctx.createGain();
    tg.gain.setValueAtTime(0.5, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    th.connect(tg).connect(this.master);
    th.start(t); th.stop(t + 0.9);
  }

  // ------------------------------------------------------------ body sounds
  bite(hit) {
    if (!this.ready) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.playbackRate.value = hit ? 0.9 : 1.4;
    const f = this.ctx.createBiquadFilter();
    f.type = hit ? 'lowpass' : 'bandpass';
    f.frequency.value = hit ? 700 : 2000; f.Q.value = 1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(hit ? 0.8 : 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (hit ? 0.3 : 0.12));
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random(), 0.35);
  }

  breath() {
    if (!this.ready) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.playbackRate.value = 0.9;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random(), 1.2);
  }

  // breaking the surface, either direction
  splash(strength = 1) {
    if (!this.ready) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.playbackRate.value = 0.8;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7 * strength, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random(), 0.65);
  }

  // call every frame: the heart is silent until the tank runs low —
  // it pounds inside your skull (deliberately non-spatial)
  body(dt, o2Frac) {
    if (!this.ready || o2Frac >= 0.10) return;
    const urgency = (0.10 - o2Frac) / 0.10;          // 0..1 as o2 10% → 0
    const rate = 1.2 + urgency * 1.5;
    this.heartTimer -= dt * rate;
    if (this.heartTimer <= 0) {
      this.heartTimer = 1;
      const t = this.now();
      const lub = (at, f, v) => {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine'; osc.frequency.value = f;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(v, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
        osc.connect(g).connect(this.master);
        osc.start(at); osc.stop(at + 0.15);
      };
      const v = 0.12 + urgency * 0.3;
      lub(t, 55, v); lub(t + 0.18, 45, v * 0.7);
    }
  }
}
