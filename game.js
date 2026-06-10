// SOUNDER — the hunt. A deep-sea hunting game meant to be playable
// with sound alone. The screen covers only what sound can't.
import * as THREE from 'three';
import { AudioEngine, SOUND_SPEED } from './audio.js';

// ------------------------------------------------------------------ setup
const FOG_BASE = new THREE.Color(0x0a4d77);
const SUNLIT = 90, TWILIGHT = 300;      // zone boundaries (m of depth)
const DAY_LEN = 1200;                   // seconds per full day
let worldT = DAY_LEN * 0.12;            // begin mid-morning
let curLight01 = 1, curLayerDepth = 300;
const FLOOR_Y = -850;
const floorY = (x, z) => FLOOR_Y + 12 * Math.sin(x * 0.01) + 10 * Math.cos(z * 0.013);

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = FOG_BASE.clone();
scene.fog = new THREE.FogExp2(FOG_BASE.clone(), 0.026);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 700);
camera.position.set(0, -6, 0);

const audio = new AudioEngine();

// player options, persisted
const opts = JSON.parse(localStorage.getItem('sounder-opts') || '{}');
let sens = opts.sens ?? 0.0021;
let invertY = opts.invertY ?? false;
audio.setVolume(opts.vol ?? 0.9);
function saveOpts() { localStorage.setItem('sounder-opts', JSON.stringify({ sens, vol: audio.vol, invertY })); }

// scratch objects for per-frame math
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const dummy = new THREE.Object3D();

// ------------------------------------------------------------- water visuals
const waterUniforms = { uBrightness: { value: 1 } };
const aboveU = { value: 0 };           // 0 underwater → 1 in air (breaching)
{
  const mat = new THREE.ShaderMaterial({
    uniforms: { uBrightness: waterUniforms.uBrightness, uAbove: { value: 0 }, uLight: { value: 1 } },
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uBrightness; uniform float uAbove; uniform float uLight; varying vec3 vDir;
      void main(){
        // beneath: the water column gradient
        float up = vDir.y * 0.5 + 0.5;
        vec3 down = vec3(0.005,0.045,0.09), mid = vec3(0.039,0.30,0.47), top = vec3(0.13,0.46,0.65);
        vec3 water = mix(down, mid, smoothstep(0.05,0.5,up));
        water = mix(water, top, smoothstep(0.5,0.95,up));
        water *= uBrightness;
        // above: open sky, a sun, and the sea seen from over the waves
        float upS = clamp(vDir.y, 0.0, 1.0);
        vec3 sky = mix(vec3(0.78,0.88,0.94), vec3(0.28,0.55,0.85), pow(upS, 0.55));
        sky *= mix(0.07, 1.0, uLight);          // night sky keeps only a trace
        vec3 sunDir = normalize(vec3(0.22, 0.42, -0.88));
        float s = max(dot(vDir, sunDir), 0.0);
        sky += vec3(1.0,0.95,0.78) * (pow(s, 700.0) * 1.4 + pow(s, 9.0) * 0.13) * uLight;
        vec3 sea = vec3(0.05,0.20,0.33) * (0.7 + 0.3 * clamp(-vDir.y * 5.0, 0.0, 1.0)) * mix(0.1, 1.0, uLight);
        vec3 air = mix(sea, sky, smoothstep(-0.015, 0.02, vDir.y));
        gl_FragColor = vec4(mix(water, air, uAbove), 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 24), mat);
  sky.renderOrder = -1;
  scene.add(sky);
  sky.onBeforeRender = () => {
    sky.position.copy(camera.position);
    mat.uniforms.uAbove.value = aboveU.value;
    mat.uniforms.uLight.value = curLight01;
  };
}

let surfaceMesh;
const surfaceUniforms = {
  uTime: { value: 0 },
  uSunPos: { value: new THREE.Vector3(22, 0, -95) },
  uFogColor: { value: FOG_BASE.clone().convertLinearToSRGB() },
  uFogDensity: { value: 0.026 },
  uBrightness: { value: 1 },
  uAbove: aboveU,
};
{
  const mat = new THREE.ShaderMaterial({
    uniforms: surfaceUniforms,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime; varying vec3 vWorldPos; varying vec3 vNormal; varying float vViewDist;
      float waveH(vec2 p, float t){
        return sin(p.x*0.085+t*0.9)*0.55 + sin(p.y*0.110+t*0.7)*0.45
             + sin((p.x+p.y)*0.060+t*1.3)*0.35 + sin(p.x*0.300-t*1.8)*0.12; }
      void main(){
        vec3 pos = position;
        float h = waveH(pos.xz, uTime); pos.y += h;
        float e = 1.5;
        float hx = waveH(pos.xz+vec2(e,0.0), uTime);
        float hz = waveH(pos.xz+vec2(0.0,e), uTime);
        vNormal = normalize(vec3(h-hx, e, h-hz));
        vec4 wp = modelMatrix * vec4(pos,1.0); vWorldPos = wp.xyz;
        vec4 mv = viewMatrix * wp; vViewDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      uniform vec3 uSunPos; uniform vec3 uFogColor; uniform float uFogDensity; uniform float uBrightness; uniform float uAbove;
      varying vec3 vWorldPos; varying vec3 vNormal; varying float vViewDist;
      void main(){
        float sunDist = distance(vWorldPos.xz, uSunPos.xz);
        float glow = exp(-sunDist/70.0); float halo = exp(-sunDist/220.0);
        float shimmer = 0.5 + 0.6*pow(abs(vNormal.x*3.2+vNormal.z*2.4),1.4);
        // from below: Snell window and downwelling light
        vec3 deep = vec3(0.10,0.36,0.55), mid = vec3(0.34,0.70,0.88), bright = vec3(1.25,1.35,1.32);
        vec3 col = mix(deep, mid, clamp(halo*shimmer,0.0,1.0));
        col = mix(col, bright, clamp(glow*1.4*shimmer,0.0,1.0));
        float near = exp(-vViewDist/26.0);
        col += vec3(0.16,0.30,0.36)*near*shimmer;
        col *= uBrightness;
        float fogF = 1.0 - exp(-uFogDensity*vViewDist);
        col = mix(col, uFogColor, fogF);
        // from above: dark sea with sun glitter, hazing to the horizon
        vec3 seaTop = mix(vec3(0.06,0.22,0.35), vec3(0.70,0.80,0.86), clamp(glow*1.5*shimmer,0.0,1.0));
        seaTop = mix(seaTop, vec3(0.78,0.88,0.94), 1.0 - exp(-0.004 * vViewDist));
        gl_FragColor = vec4(mix(col, seaTop, uAbove), 1.0); }`,
  });
  const geo = new THREE.PlaneGeometry(900, 900, 140, 140);
  geo.rotateX(Math.PI / 2);
  surfaceMesh = new THREE.Mesh(geo, mat);
  scene.add(surfaceMesh);
  surfaceMesh.onBeforeRender = () => { surfaceMesh.position.x = camera.position.x; surfaceMesh.position.z = camera.position.z; };
}

// seafloor (you will almost never see it; you will hear it).
let floorMesh;
{
  const geo = new THREE.PlaneGeometry(1600, 1600, 80, 80);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, floorY(p.getX(i), p.getZ(i)) - FLOOR_Y);
  geo.computeVertexNormals();
  floorMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1a1410 }));
  floorMesh.position.y = FLOOR_Y;
  floorMesh.visible = false;
  scene.add(floorMesh);
}

// marine snow — fixed in the WORLD (it's the only thing that tells you
// how fast you're moving in the dark), recycled around the player.
let snow, snowSink, snowMat;
const SNOW_R = 55;
{
  const N = 1200;
  const pos = new Float32Array(N * 3); snowSink = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i*3]   = (Math.random()-0.5)*SNOW_R*2;
    pos[i*3+1] = -6 + (Math.random()-0.5)*SNOW_R*2;
    pos[i*3+2] = (Math.random()-0.5)*SNOW_R*2;
    snowSink[i] = 0.1 + Math.random()*0.3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  snowMat = new THREE.PointsMaterial({ size: 0.35, map: dotTexture(), transparent: true, opacity: 0.5, depthWrite: false, color: 0xbfe3ff });
  snow = new THREE.Points(geo, snowMat);
  snow.frustumCulled = false;
  scene.add(snow);
}

function dotTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.4,'rgba(220,240,255,0.5)'); g.addColorStop(1,'rgba(200,230,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(cv);
}

// --------------------------------------------------------- creature material
// Fogs toward the water's directional gradient along the view ray, and
// carries the procedural swim deformation.
const envU = {
  uTime: { value: 0 },
  uDark: { value: 0 },
  uFogDensity: { value: 0.026 },
};

function waterMat(hex, opts = {}) {
  return new THREE.ShaderMaterial({
    side: opts.side ?? THREE.FrontSide,
    uniforms: {
      uColor: { value: new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255) },
      uTime: envU.uTime, uDark: envU.uDark, uFogDensity: envU.uFogDensity,
      uWaterBright: waterUniforms.uBrightness,
      uSwimAmp: { value: opts.swimAmp ?? 0 },
      uSwimFreq: { value: opts.swimFreq ?? 2 },
      uSwimPhase: { value: opts.swimPhase ?? Math.random() * 6.28 },
      uAxisY: { value: opts.vertical ? 1 : 0 },
      uBendOrigin: { value: opts.bendOrigin ?? 0 },
      uBendSpan: { value: opts.bendSpan ?? 10 },
    },
    vertexShader: `
      uniform float uTime, uSwimAmp, uSwimFreq, uSwimPhase, uAxisY, uBendOrigin, uBendSpan;
      varying vec3 vWorld;
      void main() {
        vec3 pos = position;
        float w = clamp((uBendOrigin - pos.x) / uBendSpan, 0.0, 1.0);
        float off = uSwimAmp * w * w * sin(uTime * uSwimFreq + uSwimPhase - pos.x * 0.3);
        pos.y += off * uAxisY;
        pos.z += off * (1.0 - uAxisY);
        vec4 wp = modelMatrix * vec4(pos, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uDark, uFogDensity, uWaterBright;
      varying vec3 vWorld;
      void main() {
        vec3 rel = vWorld - cameraPosition;
        float dist = length(rel);
        vec3 dir = rel / dist;
        float up = dir.y * 0.5 + 0.5;
        vec3 down = vec3(0.005,0.045,0.09), mid = vec3(0.039,0.30,0.47), top = vec3(0.13,0.46,0.65);
        vec3 water = mix(down, mid, smoothstep(0.05,0.5,up));
        water = mix(water, top, smoothstep(0.5,0.95,up));
        water *= uWaterBright;
        float fogF = 1.0 - exp(-uFogDensity * dist);
        vec3 col = mix(uColor * max(1.0 - uDark, 0.05), water, fogF);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ------------------------------------------------------------------ fauna
const contacts = [];   // anything that returns an echo

// whale: origin at center of mass, fin/fluke transforms baked into
// geometry so every vertex lives in body coordinates — one material,
// one bend, everything in sync.
function makeWhaleMesh() {
  const phase = Math.random() * 6.28;
  const freq = 1.5 + Math.random() * 0.4;
  const mat = waterMat(0x2b4257, { swimAmp: 0.5, swimFreq: freq, swimPhase: phase, vertical: true, bendOrigin: 3, bendSpan: 11 });
  const profile = [
    [0.02,0],[0.18,0.5],[0.38,1.4],[0.70,2.8],[1.05,4.4],[1.30,6.0],[1.42,7.6],
    [1.45,9.0],[1.42,10.4],[1.30,11.4],[0.95,12.1],[0.30,12.45],[0.0,12.5],
  ].map(([r,y]) => new THREE.Vector2(r,y));
  const g = new THREE.Group();
  const bodyGeo = new THREE.LatheGeometry(profile, 20);
  bodyGeo.rotateZ(-Math.PI / 2);          // nose +x
  bodyGeo.translate(-6.25, 0, 0);          // origin to center of mass
  g.add(new THREE.Mesh(bodyGeo, mat));
  for (const s of [-1,1]) {
    const flGeo = new THREE.SphereGeometry(1, 10, 7);
    flGeo.scale(1.7, 0.14, 0.75);
    flGeo.rotateY(s * 0.55);
    flGeo.translate(-6.65, 0, s * 1.15);   // baked: flukes live in body space
    g.add(new THREE.Mesh(flGeo, mat));
  }
  g.rotation.order = 'YZX';                // yaw, pitch, roll
  return g;
}

// squid: mantle leads (+z), arms trail. arms are simulated ribbons.
function makeSquidMesh(size, giant = false) {
  const color = giant ? 0x31222b : 0x2e2531;
  const mat = waterMat(color);
  const g = new THREE.Group();
  const prof = [
    [0.34,0],[0.46,0.5],[0.52,1.0],[0.44,1.6],[0.30,2.05],[0.14,2.4],[0.01,2.65],
  ].map(([r,y]) => new THREE.Vector2(r,y));
  const mantleGeo = new THREE.LatheGeometry(prof, 12);
  mantleGeo.rotateX(Math.PI / 2);          // axis +z, tip forward
  g.add(new THREE.Mesh(mantleGeo, mat));
  const finGeo = new THREE.SphereGeometry(1, 8, 6);
  finGeo.scale(0.55, 0.07, 0.42);
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(finGeo, mat);
    fin.position.set(s * 0.30, 0, 2.05);
    fin.rotation.z = s * 0.25;
    g.add(fin);
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.30, 10, 8), mat);
  head.position.z = -0.28; g.add(head);
  const eyeMat = waterMat(0x9fb8c8);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 6), eyeMat);
    eye.position.set(s * 0.25, 0.06, -0.30);
    g.add(eye);
  }
  g.scale.setScalar(size);
  return g;
}

// smoothly face the direction of travel (squid snap-turns looked jarring)
function faceVelocity(c, dt, rate = 3.5) {
  if (c.vel.lengthSq() < 0.2) return;
  dummy.position.copy(c.pos);
  _v1.copy(c.pos).add(c.vel);
  dummy.lookAt(_v1);
  c.mesh.quaternion.slerp(dummy.quaternion, Math.min(dt * rate, 1));
}

// arm chains: 8 arms + 2 long tentacles, lagged kinematic chains.
function buildArms(c) {
  const giant = c.kind === 'giant';
  const arms = [];
  const back = _v1.set(0, 0, -1).applyQuaternion(c.mesh.quaternion);
  for (let i = 0; i < 10; i++) {
    const tentacle = i >= 8;
    const segs = tentacle ? 8 : 6;
    const len = (tentacle ? 2.9 : 1.7) * c.size;
    const ang = tentacle ? (i === 8 ? 0.4 : Math.PI - 0.4) : (i / 8) * Math.PI * 2 + 0.39;
    const arm = {
      ang, segs, segLen: len / segs,
      width: (tentacle ? 0.05 : 0.09) * c.size,
      phase: Math.random() * 6.28,
      tentacle, gone: false,
      pts: [], dirs: [],
    };
    const base = _v2.set(Math.cos(ang) * 0.18, Math.sin(ang) * 0.18, -0.45)
      .multiplyScalar(c.size).applyQuaternion(c.mesh.quaternion).add(c.pos);
    for (let s = 0; s <= segs; s++) arm.pts.push(base.clone().addScaledVector(back, s * arm.segLen));
    for (let s = 0; s < segs; s++) arm.dirs.push(back.clone());
    arms.push(arm);
  }
  const vertCount = arms.reduce((n, a) => n + (a.segs + 1) * 2, 0);
  const posArr = new Float32Array(vertCount * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  let vbase = 0;
  for (const a of arms) {
    for (let s = 0; s < a.segs; s++) {
      const r = vbase + s * 2;
      idx.push(r, r + 1, r + 2, r + 1, r + 3, r + 2);
    }
    vbase += (a.segs + 1) * 2;
  }
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, waterMat(giant ? 0x31222b : 0x2e2531, { side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  scene.add(mesh);
  c.arms = arms; c.armGeo = geo; c.armPos = posArr; c.armMesh = mesh;
}

function updateArms(c, dt) {
  const t = envU.uTime.value;
  const q = c.mesh.quaternion;
  const speed = c.vel.length();
  const speedK = THREE.MathUtils.clamp(speed / 9, 0, 1);
  if (speed > 0.3) _v1.copy(c.vel).multiplyScalar(-1 / speed);
  else _v1.set(0, 0, -1).applyQuaternion(q);
  const ts = c.kind === 'giant' ? 0.5 : 1.5;
  const pos = c.armPos;
  let vi = 0;
  for (let ai = 0; ai < c.arms.length; ai++) {
    const a = c.arms[ai];
    _v2.set(Math.cos(a.ang) * 0.18, Math.sin(a.ang) * 0.18, -0.45)
      .multiplyScalar(c.size).applyQuaternion(q).add(c.pos);
    a.pts[0].copy(_v2);
    if (a.gone) {
      // a severed stump: collapse the ribbon to the attach point
      for (let i = 0; i <= a.segs; i++) {
        pos[vi++] = _v2.x; pos[vi++] = _v2.y; pos[vi++] = _v2.z;
        pos[vi++] = _v2.x; pos[vi++] = _v2.y; pos[vi++] = _v2.z;
      }
      continue;
    }
    const latched = c.latchArm === ai && c.state === 'latch';
    const flare = 0.30 + 0.20 * Math.sin(t * ts + a.phase);
    _v3.set(Math.cos(a.ang) * flare, Math.sin(a.ang) * flare, -1).normalize().applyQuaternion(q);
    for (let i = 0; i < a.segs; i++) {
      if (latched) {
        // the long arm strains toward its prize: you
        _v4.subVectors(camera.position, a.pts[i]).normalize();
        a.dirs[i].lerp(_v4, Math.min(8 * dt, 1)).normalize();
      } else {
        const drift = 0.10 * Math.sin(t * ts * 1.7 + a.phase + i * 0.9);
        _v4.copy(_v3).lerp(_v1, speedK);
        _v4.x += drift * 0.6; _v4.y += drift;
        _v4.normalize();
        const stiff = 4.5 * (1 - i / (a.segs + 2)) + 0.5;
        a.dirs[i].lerp(_v4, Math.min(stiff * dt, 1)).normalize();
      }
      a.pts[i + 1].copy(a.pts[i]).addScaledVector(a.dirs[i], a.segLen);
    }
    for (let i = 0; i <= a.segs; i++) {
      const p = a.pts[i];
      _v5.subVectors(a.pts[Math.min(i + 1, a.segs)], a.pts[Math.max(i - 1, 0)]).normalize();
      _v6.subVectors(p, camera.position).normalize();
      _v6.crossVectors(_v5, _v6).normalize();
      const w = a.width * (1 - (i / a.segs) * 0.85) * (latched ? 1.4 : 1);
      pos[vi++] = p.x + _v6.x * w; pos[vi++] = p.y + _v6.y * w; pos[vi++] = p.z + _v6.z * w;
      pos[vi++] = p.x - _v6.x * w; pos[vi++] = p.y - _v6.y * w; pos[vi++] = p.z - _v6.z * w;
    }
  }
  c.armGeo.attributes.position.needsUpdate = true;
}

function addSchool(x, y, z) {
  const size = 2 + Math.random()*2.5;          // acoustic size of the whole school
  const spread = 5 + Math.random()*9;
  const density = 0.5 + Math.random();
  const n = Math.round(120*density);
  const pts = new Float32Array(n*3);
  for (let i = 0; i < n; i++) {
    const r = spread * Math.cbrt(Math.random());
    const th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1);
    pts[i*3] = r*Math.sin(ph)*Math.cos(th);
    pts[i*3+1] = r*Math.cos(ph)*0.5;
    pts[i*3+2] = r*Math.sin(ph)*Math.sin(th);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const mesh = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.28, map: dotTexture(), transparent: true, opacity: 0.9, depthWrite: false, color: 0x9db8c4 }));
  mesh.position.set(x, y, z);
  scene.add(mesh);
  contacts.push({
    kind: 'school', mesh, pos: mesh.position, vel: new THREE.Vector3(),
    size, density, spread, seed: Math.random()*100, passiveRange: 100,
    fishBase: pts.slice(), dayY: y,
  });
}

function addSquid(depth, opts = {}) {
  const size = opts.size ?? (0.8 + Math.random()*1.6);
  const giantFlag = !!opts.giant;
  const mesh = makeSquidMesh(size, giantFlag);
  const a = Math.random()*Math.PI*2, r = 40 + Math.random()*240;
  mesh.position.set(Math.cos(a)*r, -depth, Math.sin(a)*r);
  scene.add(mesh);
  const c = {
    kind: giantFlag ? 'giant' : 'squid', mesh, pos: mesh.position,
    vel: new THREE.Vector3(), size, jetT: 0,
    homeDepth: -depth, dayDepth: depth, seed: Math.random()*100,
    passiveRange: giantFlag ? 600 : 0,
    aggro: 0, state: 'lurk', gripSide: null,
    windT: 4, modeT: 0, struggle: 0, tentaclesLeft: 2, latchArm: null,
    latchAnchor: new THREE.Vector3(),
  };
  buildArms(c);
  contacts.push(c);
  return c;
}

function addWhale(x, y, z, opts = {}) {
  const mesh = makeWhaleMesh();
  if (opts.scale) mesh.scale.setScalar(opts.scale);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  const c = {
    kind: 'whale', mesh, pos: mesh.position, vel: new THREE.Vector3(),
    size: opts.scale ? 11 * opts.scale : 11,
    seed: Math.random()*100, passiveRange: 350, heading: Math.random()*Math.PI*2,
    mode: 'wander', modeT: 0, huntTarget: null, follow: opts.follow ?? null, jetCd: 0,
    pitch: 0, roll: 0, prevHeading: 0, orbitA: Math.random() * 6.28, orbitOff: 0,
  };
  c.prevHeading = c.heading;
  contacts.push(c);
  return c;
}

for (let i = 0; i < 7; i++) addSchool((Math.random()-0.5)*420, -15 - Math.random()*105, (Math.random()-0.5)*420);
for (let i = 0; i < 10; i++) addSquid(160 + Math.random()*360);
for (let i = 0; i < 4; i++) addSquid(520 + Math.random()*280);
const giant = addSquid(770, { giant: true, size: 9 });
giant.pos.set(120, -770, -80);
const kinA = addWhale(-60, -30, -90);
addWhale(-40, -45, -120);
addWhale(-70, -28, -85, { scale: 0.5, follow: kinA });   // the calf

// ------------------------------------------------------------------ player
const player = {
  vel: new THREE.Vector3(),
  o2: 1, score: 0, bestDepth: 0,
  lungeT: 0, pingCd: 0, creaking: false, callCd: 0,
  dead: false,
};
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const keys = {};
let debugOpen = false, gizmos = false, fpsEma = 60;
let prevYaw = 0, prevPitch = 0;
let lastCreakTarget = null;

const gate = document.getElementById('gate');
let started = false;
function start() {
  if (!started) {
    audio.init();
    audio.setVolume(audio.vol);
    started = true;
    gate.classList.add('gone');
    say('the light is yours for ninety meters. learn fast.', 5);
  }
  try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch (e) { /* synthetic clicks can't lock */ }
}
gate.addEventListener('click', start);
canvas.addEventListener('click', start);
addEventListener('contextmenu', (e) => e.preventDefault());

// ------------------------------------------------------------- options (esc)
const optionsEl = document.getElementById('options');
{
  const vol = document.getElementById('opt-vol'), sn = document.getElementById('opt-sens');
  vol.value = Math.round((opts.vol ?? 0.9) * 100);
  sn.value = Math.round(sens * 10000);
  vol.addEventListener('input', () => { audio.setVolume(vol.value / 100); saveOpts(); });
  sn.addEventListener('input', () => { sens = sn.value / 10000; saveOpts(); });
  const inv = document.getElementById('opt-inv');
  inv.checked = invertY;
  inv.addEventListener('change', () => { invertY = inv.checked; saveOpts(); });
  document.getElementById('opt-resume').addEventListener('click', () => {
    try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch (e) {}
  });
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    optionsEl.classList.toggle('on', started && !locked);
  });
}

// -------------------------------------------------------------- call wheel
// Sperm whales speak in codas — rhythmic click patterns shared by a clan.
// Your calls are the one emission you hear; identity is meant to be heard.
const wheelEl = document.getElementById('wheel');
const CODAS = {
  locate: [0, 0.35, 0.12, 0.12],          // 1+3: where are you?
  gather: [0, 0.18, 0.18, 0.18, 0.18],    // five regular: come
  hunt:   [0, 0.12, 0.12, 0.42],          // 3+1: drive my prey
  rest:   [0, 0.5, 0.5],                  // three slow: as you were
  corral: [0, 0.25, 0.1, 0.25, 0.1],      // paired: circle my prey
  name:   [0, 0.30, 0.30, 0.11, 0.11],    // 1+1+3: it's me
};
const WHEEL_OPTS = ['locate', 'gather', 'hunt', 'rest', 'corral', 'name'];
let wheelOpen = false;
const selVec = { x: 0, y: 0 };

function pickWheel() {
  if (Math.hypot(selVec.x, selVec.y) < 35) return null;
  // six sectors, locate at top, clockwise: gather, hunt, rest, corral, name
  let a = Math.atan2(selVec.y, selVec.x) + Math.PI / 2;   // 0 at top
  a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return WHEEL_OPTS[Math.floor(((a + Math.PI / 6) % (Math.PI * 2)) / (Math.PI / 3))];
}

function updateWheelSel() {
  const sel = pickWheel();
  for (const o of WHEEL_OPTS) document.getElementById('w-' + o).classList.toggle('sel', o === sel);
}

function pickPrey() {
  return lastCreakTarget && lastCreakTarget.kind !== 'whale' && lastCreakTarget.kind !== 'giant' && contacts.includes(lastCreakTarget)
    ? lastCreakTarget
    : contacts.filter(c => (c.kind === 'squid' || c.kind === 'school') && c.pos.distanceTo(camera.position) < 140)
        .sort((a,b) => a.pos.distanceTo(camera.position) - b.pos.distanceTo(camera.position))[0];
}

function emitCall(name) {
  audio.coda(CODAS[name]);
  player.callCd = 3;
  const kin = contacts.filter(c => c.kind === 'whale');
  let adultIdx = 0;
  kin.forEach((k, i) => {
    const d = k.pos.distanceTo(camera.position);
    const isCalf = !!k.follow;
    let answers = true, extraWait = 0;
    if (name === 'name') {
      answers = isCalf || Math.random() < 0.4;        // the calf ALWAYS answers
      extraWait = isCalf ? 0 : 1.6;
    }
    if (answers) {
      setTimeout(() => {
        let pos = k.pos;
        const dd = k.pos.distanceTo(camera.position);
        if (dd > 350) {
          pos = camera.position.clone()
            .addScaledVector(k.pos.clone().sub(camera.position).normalize(), 170);
        }
        audio.coda(CODAS[name], k, pos);
      }, (0.8 + i * 0.9 + extraWait + (2 * d) / SOUND_SPEED) * 1000);
    }
    if (isCalf) return;                               // she only answers; she stays with mother
    if (name === 'gather') { k.mode = 'gather'; k.modeT = 60; }
    if (name === 'rest') { k.mode = 'wander'; k.huntTarget = null; }
    if (name === 'hunt' || name === 'corral') {
      const tgt = pickPrey();
      if (tgt) {
        k.mode = name; k.modeT = 45; k.huntTarget = tgt;
        k.orbitOff = adultIdx * Math.PI;              // corral from opposite sides
      }
    }
    adultIdx++;
  });
  const flavor = {
    locate: 'you ask the dark: where are you?',
    gather: 'come, you call. the pod turns.',
    hunt: 'drive them to me.',
    rest: 'enough. the pod drifts apart.',
    corral: 'circle them. let nothing leave.',
    name: 'you say your name into the deep.',
  };
  say(flavor[name], 3.5);
}

// ------------------------------------------------------------------ input
addEventListener('mousemove', (e) => {
  if (wheelOpen) {
    selVec.x += e.movementX; selVec.y += e.movementY;
    updateWheelSel();
    return;                                           // concentrating: the body holds still
  }
  if (document.pointerLockElement !== canvas) return;
  euler.y -= e.movementX * sens;
  euler.x = THREE.MathUtils.clamp(euler.x - e.movementY * sens * (invertY ? -1 : 1), -1.45, 1.45);
});
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();      // space = rise
  if (e.code === 'KeyF') bite();
  if (e.code === 'KeyE' && !e.repeat && started && !player.dead && player.callCd <= 0 && !wheelOpen) {
    wheelOpen = true; selVec.x = 0; selVec.y = 0;
    updateWheelSel();
    wheelEl.classList.add('on');
  }
  if (e.code === 'Backquote') {
    debugOpen = !debugOpen;
    debugEl.style.display = debugOpen ? 'block' : 'none';
  }
  if (debugOpen) {
    if (e.code === 'KeyG') gizmos = !gizmos;
    if (e.code === 'KeyO') player.o2 = 1;
    if (e.code === 'Digit1') { camera.position.set(0, -2, 0); player.vel.set(0,0,0); }
    if (e.code === 'Digit2') { camera.position.set(0, -250, 0); player.vel.set(0,0,0); }
    if (e.code === 'Digit3') { camera.position.set(100, -740, -60); player.vel.set(0,0,0); }
    if (e.code === 'KeyT') worldT += DAY_LEN / 6;    // skip four hours
  }
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'KeyE' && wheelOpen) {
    wheelOpen = false;
    wheelEl.classList.remove('on');
    const sel = pickWheel();
    if (sel) emitCall(sel);
  }
});
addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (e.button === 0) ping();
  if (e.button === 2) player.creaking = true;
});
addEventListener('mouseup', (e) => { if (e.button === 2) player.creaking = false; });

// ------------------------------------------------------------------ sonar
// Emissions are SILENT — you are the click. You hear only the returns.
const flashes = [];
const spray = [];
let fovPopT = 0, breachCallCd = 0;
const sprayTex = dotTexture();
function spawnSpray(at, n, power) {
  for (let i = 0; i < n; i++) {
    const mat = new THREE.SpriteMaterial({ map: sprayTex, color: 0xeaf6ff, transparent: true, opacity: 0.85, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.position.copy(at);
    s.position.x += (Math.random() - 0.5) * 2;
    s.position.z += (Math.random() - 0.5) * 2;
    s.scale.setScalar(0.4 + Math.random() * 0.9);
    const a = Math.random() * Math.PI * 2;
    const r = (2 + Math.random() * 4) * power;
    scene.add(s);
    spray.push({ s, t: 0, vel: new THREE.Vector3(Math.cos(a) * r, (3 + Math.random() * 8) * power, Math.sin(a) * r) });
  }
}
function ping() {
  if (!started || player.pingCd > 0 || player.dead) return;
  player.pingCd = 0.9;
  const obs = { pos: camera.position, vel: player.vel, fwd: camera.getWorldDirection(new THREE.Vector3()) };
  const depth = -camera.position.y;
  let nearest = null, nearestD = 1e9;
  for (const c of contacts) {
    const d = c.pos.distanceTo(camera.position);
    if (d > 420) continue;
    const delay = audio.echo(c, obs);
    if (d < nearestD) { nearest = c; nearestD = d; }
    if (depth < SUNLIT + 40) scheduleFlash(c, delay);
  }
  audio.boundaryEcho(depth, camera.position.y - floorY(camera.position.x, camera.position.z), camera.position);
  if (Math.abs(curLayerDepth - depth) > 25) {
    audio.echo({ key: 'dsl', kind: 'school', size: 3, density: 0.5, spread: 40,
      pos: { x: camera.position.x, y: -curLayerDepth, z: camera.position.z } }, obs);
  }
  // squid hear a close loud click and may bolt; the giant only listens
  for (const c of contacts) {
    if (c.kind === 'squid' && c.jetT <= 0 && c.pos.distanceTo(camera.position) < 70 && Math.random() < 0.4) startJet(c);
    if (c.kind === 'giant' && c.pos.distanceTo(camera.position) < 240) c.aggro += 0.3;
  }
  if (depth < SUNLIT && nearest) {
    const names = { school: 'a school of fish', squid: 'squid', whale: 'kin', giant: 'something vast' };
    say(`${names[nearest.kind]} — ${Math.round(nearestD)}m`, 2.2);
  }
}

function scheduleFlash(contact, delay) {
  setTimeout(() => {
    const mat = new THREE.SpriteMaterial({ map: dotTexture(), color: 0xaee4ff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(mat);
    s.position.copy(contact.pos);
    s.scale.setScalar(contact.size * 2.5);
    scene.add(s);
    flashes.push({ s, t: 0 });
  }, delay * 1000);
}

function bite() {
  if (!started || player.dead) return;
  player.lungeT = 0.35;
  const fwd = camera.getWorldDirection(new THREE.Vector3());

  // the giant first: severing a latched arm, or the final blow
  if (contacts.includes(giant)) {
    if (giant.state === 'latch') {
      const to = giant.latchAnchor.clone().sub(camera.position);
      const dA = to.length();
      if (dA < 15 && to.normalize().dot(fwd) > 0.90) {
        severTentacle(giant);
        audio.bite(true);
      } else audio.bite(false);                      // snapped at dark water
      return;
    }
    if (giant.tentaclesLeft <= 0 && giant.state !== 'dead') {
      const to = giant.pos.clone().sub(camera.position);
      if (to.length() < 18 && to.normalize().dot(fwd) > 0.45) {
        finishGiant(giant);
        audio.bite(true);
        return;
      }
    }
  }

  let hit = null;
  for (const c of contacts) {
    if (c.kind !== 'squid') continue;
    const to = c.pos.clone().sub(camera.position);
    const d = to.length();
    if (d < 7.5 && to.normalize().dot(fwd) > 0.55) { hit = c; break; }
  }
  audio.bite(!!hit);
  if (!hit) return;
  player.score += 1;
  say('caught.', 1.5);
  removeContact(hit);
  addSquid(200 + Math.random()*550);
  updateScore();
}

function removeContact(c) {
  audio.dropPanner(c);
  scene.remove(c.mesh);
  if (c.armMesh) { scene.remove(c.armMesh); c.armGeo.dispose(); }
  const i = contacts.indexOf(c);
  if (i >= 0) contacts.splice(i, 1);
}

// ------------------------------------------------------------- giant fight
// It hunts your voice, arms-first, keeping its distance — until a long
// tentacle takes hold. Turn toward the pain and bite the arm off before
// it drags you into the shorter arms.
const gripEls = { L: document.getElementById('gripL'), R: document.getElementById('gripR'),
                  T: document.getElementById('gripT'), B: document.getElementById('gripB') };
function setGripOverlay(side) {
  for (const k of Object.keys(gripEls)) gripEls[k].classList.toggle('on', side === 'ALL' || k === side);
}

function pickGripSide(c) {
  _v1.subVectors(c.pos, camera.position).applyQuaternion(_q1.copy(camera.quaternion).invert());
  return Math.abs(_v1.x) > Math.abs(_v1.y) ? (_v1.x > 0 ? 'R' : 'L') : (_v1.y > 0 ? 'T' : 'B');
}

const SIDE_WORDS = { L: 'LEFT', R: 'RIGHT', T: 'UP', B: 'DOWN' };

function severTentacle(c) {
  const arm = c.arms[c.latchArm];
  if (arm) arm.gone = true;
  c.tentaclesLeft--;
  c.latchArm = null;
  audio.stopStrain();
  c.state = 'flee'; c.modeT = 9;
  c.aggro = 0;                                       // a grab broken resets its nerve
  setGripOverlay(null);
  audio.jet(c);
  _v1.subVectors(c.pos, camera.position).normalize();
  _v1.y += 0.2;
  c.vel.copy(_v1.normalize().multiplyScalar(24));
  say(c.tentaclesLeft > 0
    ? 'severed. it flees — one long arm remains.'
    : 'both long arms gone. now it must come to you.', 5);
}

function finishGiant(c) {
  c.state = 'dead';
  setGripOverlay(null);
  player.score += 10;
  say('the abyss is yours. the name fits.', 8);
  audio.stopPassive(c);
  removeContact(c);
  updateScore();
}

function giantBehavior(c, dt, t) {
  const d = c.pos.distanceTo(camera.position);
  c.aggro = Math.max(0, c.aggro - dt * 0.01);
  const toPlayer = _v3.subVectors(camera.position, c.pos);

  if (c.state === 'lurk') {
    c.vel.multiplyScalar(Math.pow(0.3, dt));
    c.vel.y += (c.homeDepth - c.pos.y) * 0.5 * dt;
    c.vel.x += Math.sin(t*0.2 + c.seed) * dt * 0.5;
    c.vel.z += Math.cos(t*0.17 + c.seed) * dt * 0.5;
    c.pos.addScaledVector(c.vel, dt);
    faceVelocity(c, dt, 2);
    if ((c.aggro > 1 && d < 220) || d < 16) {
      c.state = 'stalk';
      c.windT = 3 + Math.random() * 3;
      say('something vast turns toward your voice.', 5);
    }
  } else if (c.state === 'stalk') {
    // keep a tentacle's reach of distance, arms toward you
    const standoff = c.tentaclesLeft > 0 ? 27 : 13;
    const err = d - standoff;
    _v1.copy(toPlayer).normalize().multiplyScalar(THREE.MathUtils.clamp(err * 0.4, -6, 7.5));
    _v1.x += Math.sin(t * 0.6 + c.seed) * 1.5;       // restless strafe
    _v1.y += Math.cos(t * 0.5 + c.seed) * 0.8;
    c.vel.lerp(_v1, dt * 1.4);
    c.pos.addScaledVector(c.vel, dt);
    // mantle away, arms toward the prey
    dummy.position.copy(c.pos);
    _v2.copy(c.pos).sub(toPlayer);
    dummy.lookAt(_v2);
    c.mesh.quaternion.slerp(dummy.quaternion, Math.min(dt * 2.5, 1));
    c.windT -= dt;
    if (c.tentaclesLeft > 0) {
      if (c.windT <= 0 && d < 36) beginLatch(c);
    } else if (c.windT <= 0 && d < 30) {
      c.state = 'lunge';
      c.vel.copy(toPlayer).normalize().multiplyScalar(17);
      say('it comes for you, arms wide.', 3);
    }
    if (d > 320 || -camera.position.y < 420) {
      c.state = 'lurk'; c.aggro = 0.3;
      say('the presence sinks away.', 4);
    }
  } else if (c.state === 'latch') {
    // anchored, hauling you in by one long arm
    c.vel.multiplyScalar(Math.pow(0.2, dt));
    c.pos.addScaledVector(c.vel, dt);
    _v1.copy(toPlayer).normalize().multiplyScalar(-6.5);   // pull: toward the giant
    player.vel.addScaledVector(_v1, dt);
    player.o2 -= dt / 70;
    if (d > 55) {                                    // hauled beyond its reach: it loses hold
      c.state = 'stalk'; c.windT = 3; c.latchArm = null;
      setGripOverlay(null);
      audio.stopStrain();
      say('the arm slips loose.', 3);
    }
    // the strain creaks from the arm itself — aim at the sound
    const arm = c.arms[c.latchArm];
    if (arm) c.latchAnchor.copy(arm.pts[Math.max(arm.segs - 2, 0)]);   // mid-arm: the tip converges on you
    _v2.subVectors(c.latchAnchor, camera.position);
    const dA = _v2.length();
    _v2.normalize();
    const fwdNow = camera.getWorldDirection(_v4);
    const aim01 = THREE.MathUtils.clamp((_v2.dot(fwdNow) - 0.6) / 0.38, 0, 1);
    audio.updateStrain(c.latchAnchor, aim01);
    if (d < 14) {
      // dragged into the crown of short arms
      c.state = 'grasp'; c.struggle = 0;
      setGripOverlay('ALL');
      audio.stopStrain();
      audio.seize();
      say('GRASPED — thrash to break free', 4);
    }
  } else if (c.state === 'grasp') {
    c.pos.copy(camera.position).add(_v1.set(0, -2, -9).applyQuaternion(camera.quaternion));
    c.vel.set(0, 0, 0);
    player.o2 -= dt / 24;                            // it is crushing the breath out of you
    player.vel.multiplyScalar(Math.pow(0.2, dt));
    c.struggle += Math.abs(euler.y - prevYaw) + Math.abs(euler.x - prevPitch);
    if (c.struggle > 1.3) {
      c.state = 'flee'; c.modeT = 9; c.aggro = 0;
      setGripOverlay(null);
      audio.jet(c);
      _v1.subVectors(c.pos, camera.position).normalize();
      c.vel.copy(_v1.multiplyScalar(26));
      say('you wrench free of it.', 4);
    }
  } else if (c.state === 'lunge') {
    c.pos.addScaledVector(c.vel, dt);
    c.vel.multiplyScalar(Math.pow(0.6, dt));
    faceVelocity(c, dt, 4);
    if (d < 11) {
      c.state = 'grasp'; c.struggle = 0;
      setGripOverlay('ALL');
      audio.seize();
      say('GRASPED — thrash to break free', 4);
    } else if (c.vel.length() < 4) {
      c.state = 'stalk'; c.windT = 2 + Math.random() * 2;
    }
  } else if (c.state === 'flee') {
    c.modeT -= dt;
    c.pos.addScaledVector(c.vel, dt);
    c.vel.multiplyScalar(Math.pow(0.55, dt));
    faceVelocity(c, dt, 3);
    if (c.modeT <= 0) { c.state = 'lurk'; c.windT = 4; }
  }
}

function beginLatch(c) {
  // pick a long arm that still exists
  c.latchArm = !c.arms[8].gone ? 8 : (!c.arms[9].gone ? 9 : null);
  if (c.latchArm === null) { c.tentaclesLeft = 0; return; }
  c.state = 'latch';
  c.gripSide = pickGripSide(c);
  setGripOverlay(c.gripSide);
  audio.seize();
  audio.startStrain();
  say(`a long arm takes hold from the ${SIDE_WORDS[c.gripSide]} — find the strain and bite it off`, 4.5);
}

// ------------------------------------------------------------------ HUD
const $ = (id) => document.getElementById(id);
const msgEl = $('msg'), zoneEl = $('zone');
let msgT = 0, zoneT = 0, curZone = '';
function say(text, secs = 3) { msgEl.textContent = text; msgEl.style.opacity = 1; msgT = secs; }
function updateScore() {
  $('score').textContent = player.score === 0 ? '∅' : `✦ ${player.score}`;
}

const fade = document.createElement('div');
fade.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;transition:opacity 3s ease;pointer-events:none';
document.body.appendChild(fade);

// ------------------------------------------------- vestibular sense (nav)
const nav = document.getElementById('nav');
const nctx = nav.getContext('2d');
function sizeNav() { nav.width = innerWidth; nav.height = innerHeight; }
sizeNav();

const CARDINALS = [];
for (let i = 0; i < 16; i++) {
  CARDINALS.push({ a: i * Math.PI / 8, label: ['N','','NE','','E','','SE','','S','','SW','','W','','NW',''][i] });
}
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function drawNav(dark) {
  const W = nav.width, H = nav.height;
  nctx.clearRect(0, 0, W, H);
  if (camera.position.y > 0 || !started) return;

  const alpha = 0.10 + dark * 0.3;
  const fovY = camera.fov * Math.PI / 180;
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * camera.aspect);
  const pitch = euler.x;
  let hy = H / 2 + (pitch / fovY) * H;
  let clamped = false;
  if (hy < H * 0.08) { hy = H * 0.08; clamped = true; }
  if (hy > H * 0.92) { hy = H * 0.92; clamped = true; }
  const a = clamped ? alpha * 0.35 : alpha;

  const grad = nctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(150,215,250,0)');
  grad.addColorStop(0.18, `rgba(150,215,250,${a})`);
  grad.addColorStop(0.82, `rgba(150,215,250,${a})`);
  grad.addColorStop(1, 'rgba(150,215,250,0)');
  nctx.strokeStyle = grad;
  nctx.lineWidth = 1;
  nctx.beginPath(); nctx.moveTo(0, hy); nctx.lineTo(W, hy); nctx.stroke();

  const heading = -euler.y;
  nctx.font = '13px "Cormorant Garamond", Georgia, serif';
  nctx.textAlign = 'center';
  for (const c of CARDINALS) {
    const rel = wrapPi(c.a - heading);
    if (Math.abs(rel) > fovX / 2) continue;
    const x = W / 2 + (rel / fovX) * W;
    const major = c.label.length === 1;
    nctx.strokeStyle = `rgba(150,215,250,${a * (major ? 1 : 0.5)})`;
    nctx.beginPath(); nctx.moveTo(x, hy - (major ? 7 : 4)); nctx.lineTo(x, hy + (major ? 7 : 4)); nctx.stroke();
    if (c.label) {
      nctx.fillStyle = `rgba(180,225,250,${a * 1.4})`;
      nctx.fillText(c.label, x, hy - 12);
    }
  }

  nctx.textAlign = 'left';
  for (const pm of [-1.047, -0.524, 0.524, 1.047]) {
    const y = H / 2 + ((pitch - pm) / fovY) * H;
    if (y < H * 0.1 || y > H * 0.9) continue;
    nctx.strokeStyle = `rgba(150,215,250,${alpha * 0.6})`;
    nctx.beginPath(); nctx.moveTo(W / 2 - 14, y); nctx.lineTo(W / 2 + 14, y); nctx.stroke();
  }
}

// the body's gauge: lungs that drain from blue to red. imprecise on purpose.
// they pound when the giant has you.
function drawLungs(t) {
  if (!started || camera.position.y > 0) return;
  const W = nav.width, H = nav.height;
  const u = 1 - player.o2;
  const giantAlive = contacts.includes(giant);
  const latched = giantAlive && giant.state === 'latch';
  const grasped = giantAlive && giant.state === 'grasp';
  let scale = 1.7;
  if (grasped) scale *= 1 + 0.30 * Math.sin(t * 16) + (Math.random() - 0.5) * 0.07;
  else if (latched) scale *= 1 + 0.15 * Math.sin(t * 9);
  else if (player.o2 < 0.10) scale *= 1 + 0.10 * Math.sin(t * 8);
  const panicU = Math.max(u, grasped ? 0.75 : latched ? 0.45 : 0);
  const r = Math.round(110 + 145 * panicU), gc = Math.round(190 - 110 * panicU), b = Math.round(235 - 165 * panicU);
  const a = 0.25 + 0.45 * panicU;
  nctx.save();
  nctx.translate(W / 2, H - 192);
  nctx.scale(scale, scale);
  nctx.fillStyle = `rgba(${r},${gc},${b},${a})`;
  nctx.shadowColor = `rgba(${r},${gc},${b},0.8)`;
  nctx.shadowBlur = 12;
  for (const s of [-1, 1]) {
    nctx.beginPath();
    nctx.ellipse(s * 8, 5, 6.5, 12, s * 0.3, 0, Math.PI * 2);
    nctx.fill();
  }
  nctx.strokeStyle = `rgba(${r},${gc},${b},${a})`;
  nctx.lineWidth = 2.5;
  nctx.beginPath(); nctx.moveTo(0, -16); nctx.lineTo(0, -4); nctx.stroke();
  nctx.restore();
}

const GIZMO_COLORS = { school: '#8fd0ff', squid: '#ff9fb0', giant: '#ff5560', whale: '#ffd28f' };
const gizmoV = new THREE.Vector3();
function drawGizmos() {
  const W = nav.width, H = nav.height;
  nctx.font = '12px monospace';
  nctx.textAlign = 'left';
  for (const c of contacts) {
    gizmoV.copy(c.pos).project(camera);
    if (gizmoV.z > 1 || gizmoV.z < -1) continue;
    const x = (gizmoV.x * 0.5 + 0.5) * W, y = (-gizmoV.y * 0.5 + 0.5) * H;
    if (x < -50 || x > W + 50 || y < -50 || y > H + 50) continue;
    const col = GIZMO_COLORS[c.kind] ?? '#fff';
    nctx.strokeStyle = col;
    nctx.lineWidth = 1;
    nctx.beginPath(); nctx.arc(x, y, 10, 0, Math.PI * 2); nctx.stroke();
    nctx.fillStyle = col;
    const extra = c.kind === 'giant' ? ` ${c.state} t${c.tentaclesLeft} a${c.aggro.toFixed(1)}` : (c.mode && c.mode !== 'wander' ? ` ${c.mode}` : '');
    nctx.fillText(`${c.kind} ${Math.round(c.pos.distanceTo(camera.position))}m${extra}`, x + 14, y + 4);
  }
}

const debugEl = document.getElementById('debug');
function updateDebug(dt, depth, alt) {
  const p = camera.position;
  const g = contacts.includes(giant) ? `${giant.state} tent ${giant.tentaclesLeft} aggro ${giant.aggro.toFixed(2)}` : 'dead';
  debugEl.innerHTML =
    `pos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}<br>` +
    `depth ${depth.toFixed(1)} · alt ${alt.toFixed(1)}<br>` +
    `o2 ${(player.o2 * 100).toFixed(1)}% · vel ${player.vel.length().toFixed(2)}<br>` +
    `contacts ${contacts.length} · panners ${audio.panners.size} · fps ${fpsEma.toFixed(0)}<br>` +
    `day ${((worldT / DAY_LEN) % 1).toFixed(2)} · light ${curLight01.toFixed(2)} · layer ${Math.round(curLayerDepth)}m<br>` +
    `giant: ${g}<br>` +
    `[G] gizmos ${gizmos ? 'ON' : 'off'} · [O] refill O₂ · [1/2/3] teleport`;
}

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
let firstPing = false, creakTimer = 0, wasUnder = true;
let songlineT = 75 + Math.random() * 60, heardSongline = false, heardChannel = false, sawNight = false;
let saidNameFromAbove = false;
const CALF_CEILING = 140;               // the calf's depth limit
const CHANNEL_DEPTH = 580, CHANNEL_HALF = 70;   // the deep sound channel

function lerpAngle(a, b, k) {
  return a + wrapPi(b - a) * k;
}

// shared whale posture: bank into turns, pitch with vertical motion
function whalePosture(c, dt) {
  const turnRate = wrapPi(c.heading - c.prevHeading) / Math.max(dt, 1e-3);
  c.prevHeading = c.heading;
  const horiz = Math.hypot(c.vel.x, c.vel.z);
  const tgtPitch = Math.atan2(c.vel.y, Math.max(horiz, 0.6)) * 0.7;
  const tgtRoll = THREE.MathUtils.clamp(-turnRate * 1.1, -0.45, 0.45);
  c.pitch += (tgtPitch - c.pitch) * Math.min(dt * 2.2, 1);
  c.roll += (tgtRoll - c.roll) * Math.min(dt * 2.2, 1);
  c.mesh.rotation.set(c.roll, -c.heading, c.pitch);   // order YZX: yaw, pitch, roll
}

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const depth = -camera.position.y;
  const under = camera.position.y < 0;
  const giantAlive = contacts.includes(giant);
  const grasped = giantAlive && giant.state === 'grasp';
  const latched = giantAlive && giant.state === 'latch';

  // ---- orientation (mousemove only writes euler; grip shake lives here)
  euler.z = grasped ? (Math.random() - 0.5) * 0.07 : latched ? (Math.random() - 0.5) * 0.02 : 0;
  camera.quaternion.setFromEuler(euler);

  // ---- movement
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  let thrust = 0;
  if (keys.KeyW) thrust = 11;
  if (keys.KeyS) thrust = -4;
  if (player.lungeT > 0) { player.lungeT -= dt; thrust += 26 * (player.lungeT / 0.35); }
  player.vel.addScaledVector(fwd, thrust * dt);
  if (under) {
    if (keys.Space) player.vel.y += 9 * dt;
    if (keys.ShiftLeft || keys.ShiftRight) player.vel.y -= 9 * dt;
    player.vel.multiplyScalar(Math.pow(0.45, dt));
  } else {
    player.vel.y -= 16 * dt;
    player.vel.multiplyScalar(Math.pow(0.92, dt));
  }
  camera.position.addScaledVector(player.vel, dt);
  const fy = floorY(camera.position.x, camera.position.z) + 2;
  camera.position.y = Math.max(camera.position.y, fy);
	const horiz = Math.hypot(camera.position.x, camera.position.z);
  // World boundary to prevent getting completely lost
  if (horiz > 1000) {
    camera.position.x *= 1000/horiz; camera.position.z *= 1000/horiz;
  }

  // breaching
  if (under !== wasUnder) {
    const vy = Math.abs(player.vel.y);
    audio.splash(under ? Math.min(vy / 10, 1) : Math.min(vy / 10, 1));
    if (!under) {
      audio.breath();
      if (vy > 5) { spawnSpray(camera.position, Math.round(8 + vy * 1.6), Math.min(vy / 11, 1.2)); fovPopT = 0.8; }
    } else if (vy > 7) {
      // a full breach come down hard: the boom every kin hears
      spawnSpray(_v5.copy(camera.position).setY(0.5), 26, 1);
      audio.breachBoom(Math.min(vy / 13, 1));
      if (breachCallCd <= 0) {
        breachCallCd = 30;
        for (const k of contacts) {
          if (k.kind === 'whale' && !k.follow) { k.mode = 'gather'; k.modeT = 50; }
        }
        say('the crash carries — the pod turns toward you.', 5);
      }
    }
    wasUnder = under;
  }
  breachCallCd -= dt;
  if (fovPopT > 0) {
    fovPopT -= dt;
    camera.fov = 68 + 7 * Math.max(fovPopT / 0.8, 0) * Math.sin((1 - fovPopT / 0.8) * Math.PI);
    camera.updateProjectionMatrix();
  }
  aboveU.value += ((under ? 0 : 1) - aboveU.value) * Math.min(dt * 8, 1);

  // ---- oxygen (the clock starts when the hunt does)
  if (started && !player.dead) {
    if (depth < 3.5) {
      if (player.o2 < 0.98 && Math.floor(t*2)%4===0) audio.breath();
      player.o2 = Math.min(1, player.o2 + dt * 0.25);
    } else {
      player.o2 -= dt / 600;
      if (player.o2 <= 0) blackout();
    }
  }

  // ---- creak (rate = round-trip time; prey outranks fish for the lock)
  const hadCreakTarget = lastCreakTarget;
  lastCreakTarget = null;
  if ((player.creaking || keys.KeyC) && started && !player.dead) {
    let target = null, bd = 90, school = null, sd = 90;
    for (const c of contacts) {
      if (c.kind === 'whale') continue;
      const d = c.pos.distanceTo(camera.position);
      if (c.kind === 'school') { if (d < sd) { school = c; sd = d; } }
      else if (d < bd) { target = c; bd = d; }
    }
    if (!target) { target = school; bd = sd; }
    lastCreakTarget = target;
    creakTimer -= dt;
    if (creakTimer <= 0 && target) {
      creakTimer = Math.max((2 * bd) / SOUND_SPEED, 0.045);
      audio.creakEcho(target, { pos: camera.position, vel: player.vel, fwd });
      if (giantAlive) {
        if (target === giant) giant.aggro += 0.1;
        else if (giant.pos.distanceTo(camera.position) < 240) giant.aggro += 0.03;
      }
    }
    if (!target) {
      creakTimer = 0;
      if (hadCreakTarget) audio.deadTick();   // the lock slipped away
    }
  } else creakTimer = 0;

  // ---- contacts behavior
  for (const c of contacts) {
    if (c.kind === 'school') {
      const targetY = c.dayY * THREE.MathUtils.lerp(0.45, 1, curLight01);
      c.pos.y += (targetY - c.pos.y) * dt * 0.05;
      c.pos.x += Math.sin(t*0.07 + c.seed) * dt * 3;
      c.pos.z += Math.cos(t*0.05 + c.seed) * dt * 3;
      c.vel.set(Math.sin(t*0.07+c.seed)*3, 0, Math.cos(t*0.05+c.seed)*3);
      c.mesh.rotation.y += dt * 0.1;
      // individual fish wiggle when anyone is close enough to see them
      if (c.pos.distanceTo(camera.position) < 90) {
        const p = c.mesh.geometry.attributes.position, base = c.fishBase;
        for (let i = 0; i < p.count; i++) {
          p.array[i*3]   = base[i*3]   + Math.sin(t * 3.1 + i * 1.7) * 0.16;
          p.array[i*3+1] = base[i*3+1] + Math.sin(t * 2.3 + i * 2.9) * 0.10;
          p.array[i*3+2] = base[i*3+2] + Math.cos(t * 2.7 + i * 1.3) * 0.16;
        }
        p.needsUpdate = true;
      }
    } else if (c.kind === 'whale') {
      if (c.follow) {
        // the calf: she shadows her mother — unless you linger shallow,
        // and then she tags along with you, babbling
        const m = c.follow;
        const playerNear = camera.position.distanceTo(c.pos) < 70 && depth < 110 && under;
        if (playerNear) c.curiousT = 14; else if (c.curiousT > 0) c.curiousT -= dt;
        const tagging = c.curiousT > 0 && depth < 130;
        if (tagging) {
          _v1.copy(camera.position).addScaledVector(fwd, -7);
          _v1.x += Math.sin(t * 0.5 + c.seed) * 4;
          _v1.y = Math.max(_v1.y + 2, -CALF_CEILING);
          _v1.z += Math.cos(t * 0.45 + c.seed) * 4;
          c.babbleT = (c.babbleT ?? 6) - dt;
          if (c.babbleT <= 0) {
            c.babbleT = 9 + Math.random() * 8;
            // half-learned codas: the name, with the rhythm not quite right
            const wrong = CODAS.name.map(g0 => g0 * (0.7 + Math.random() * 0.7));
            audio.coda(wrong, c);
          }
        } else {
          _v1.set(m.pos.x - Math.cos(m.heading) * 9 + Math.cos(m.heading + Math.PI/2) * 5,
                  m.pos.y - 2 + Math.sin(t * 0.4 + c.seed) * 1.2,
                  m.pos.z - Math.sin(m.heading) * 9 + Math.sin(m.heading + Math.PI/2) * 5);
        }
        _v1.y = Math.max(_v1.y, -CALF_CEILING);          // she cannot follow you down
        _v2.subVectors(_v1, c.pos);
        const d = _v2.length();
        c.vel.lerp(_v2.normalize().multiplyScalar(Math.min(d * 0.8, 7)), dt * 2);
        c.pos.addScaledVector(c.vel, dt);
        if (c.pos.y < -CALF_CEILING) c.pos.y += (-CALF_CEILING - c.pos.y) * dt * 2;
        c.heading = tagging ? lerpAngle(c.heading, -euler.y - Math.PI / 2, Math.min(dt, 1)) : lerpAngle(c.heading, m.heading, Math.min(dt * 2, 1));
        // while you hunt the dark, now and then she says your name from above
        if (depth > 300) {
          c.nameT = (c.nameT ?? 50) - dt;
          if (c.nameT <= 0) {
            c.nameT = 80 + Math.random() * 60;
            const pos = camera.position.clone()
              .addScaledVector(c.pos.clone().sub(camera.position).normalize(), 160);
            audio.coda(CODAS.name, c, pos);
            if (!saidNameFromAbove) {
              saidNameFromAbove = true;
              setTimeout(() => say('far above, the calf says your name.', 6), 1800);
            }
          }
        }
      } else if (c.mode === 'gather') {
        c.modeT -= dt;
        const az = Math.atan2(camera.position.z - c.pos.z, camera.position.x - c.pos.x);
        c.heading = lerpAngle(c.heading, az, dt * 1.2);
        const d = c.pos.distanceTo(camera.position);
        const sp = 3.8 * THREE.MathUtils.clamp((d - 18) / 30, 0, 1);
        c.vel.set(Math.cos(c.heading) * sp, THREE.MathUtils.clamp((camera.position.y - c.pos.y) * 0.08, -2.5, 2.5), Math.sin(c.heading) * sp);
        c.pos.addScaledVector(c.vel, dt);
        if (c.modeT <= 0) c.mode = 'wander';
      } else if (c.mode === 'hunt' || c.mode === 'corral') {
        c.modeT -= dt;
        const tgt = c.huntTarget;
        if (!tgt || !contacts.includes(tgt) || c.modeT <= 0) { c.mode = 'wander'; c.huntTarget = null; }
        else {
          let gx, gz;
          if (c.mode === 'corral') {
            // orbit the prey, opposite sides — let nothing leave the ring
            c.orbitA += dt * 0.55;
            gx = tgt.pos.x + Math.cos(c.orbitA + c.orbitOff) * 20;
            gz = tgt.pos.z + Math.sin(c.orbitA + c.orbitOff) * 20;
          } else { gx = tgt.pos.x; gz = tgt.pos.z; }
          const az = Math.atan2(gz - c.pos.z, gx - c.pos.x);
          c.heading = lerpAngle(c.heading, az, dt * 1.5);
          const dg = Math.hypot(gx - c.pos.x, gz - c.pos.z);
          const sp = c.mode === 'corral' ? Math.min(dg * 0.4, 6) : (c.pos.distanceTo(tgt.pos) > 25 ? 4.5 : 2.0);
          c.vel.set(Math.cos(c.heading) * sp, THREE.MathUtils.clamp((tgt.pos.y - c.pos.y) * 0.10, -3, 3), Math.sin(c.heading) * sp);
          c.pos.addScaledVector(c.vel, dt);
          c.jetCd -= dt;
          const dPrey = c.pos.distanceTo(tgt.pos);
          if (dPrey < (c.mode === 'corral' ? 17 : 35) && c.jetCd <= 0) {
            c.jetCd = 1.6;
            if (tgt.kind === 'squid' && tgt.jetT <= 0) startJet(tgt, c.pos);
            if (tgt.kind === 'school') {
              _v1.subVectors(tgt.pos, c.pos).normalize().multiplyScalar(6);
              tgt.pos.addScaledVector(_v1, 0.5);
            }
          }
        }
      } else {
        c.heading += dt * 0.05;
        c.vel.set(Math.cos(c.heading)*2.4, Math.sin(t*0.2+c.seed)*0.5, Math.sin(c.heading)*2.4);
        c.pos.addScaledVector(c.vel, dt);
      }
      whalePosture(c, dt);
    } else if (c.kind === 'giant') {
      giantBehavior(c, dt, t);
      updateArms(c, dt);
      // once in a long while, in the dark, its eye catches what light there isn't
      if (depth > 380 && Math.random() < dt * 0.045) {
        const dG = c.pos.distanceTo(camera.position);
        _v1.set(0, 0, -1).applyQuaternion(c.mesh.quaternion);          // its facing (arms-first)
        _v2.subVectors(camera.position, c.pos).normalize();
        if (dG < 220 && _v1.dot(_v2) > 0.86) {
          const mat = new THREE.SpriteMaterial({ map: dotTexture(), color: 0x8fa8b8, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
          const s = new THREE.Sprite(mat);
          _v3.set(0.25 * c.size, 0.06 * c.size, -0.30 * c.size).applyQuaternion(c.mesh.quaternion);
          s.position.copy(c.pos).add(_v3);
          s.scale.setScalar(0.9);
          scene.add(s);
          flashes.push({ s, t: 0.35 });
        }
      }
    } else { // squid
      const d = c.pos.distanceTo(camera.position);
      if (d < 13 && c.jetT <= 0) startJet(c);
      if (c.jetT > 0) {
        c.jetT -= dt;
      } else {
        // vertical migration: the deep rises at night
        const targetHome = -c.dayDepth * THREE.MathUtils.lerp(0.4, 1, curLight01);
        c.homeDepth += (targetHome - c.homeDepth) * dt * 0.03;
        c.vel.multiplyScalar(Math.pow(0.3, dt));
        c.vel.y += (c.homeDepth - c.pos.y) * 0.01 * dt * 60;
        c.vel.x += Math.sin(t*0.3 + c.seed) * dt * 0.8;
        c.vel.z += Math.cos(t*0.27 + c.seed) * dt * 0.8;
      }
      c.vel.y *= Math.pow(0.5, dt);
      const hc = Math.hypot(c.pos.x, c.pos.z);
      if (hc > 480) {                       // drift home; the herd is the terrain
        c.vel.x -= (c.pos.x / hc) * dt * 3;
        c.vel.z -= (c.pos.z / hc) * dt * 3;
      }
      c.pos.addScaledVector(c.vel, dt);
      faceVelocity(c, dt, 3.5);
      updateArms(c, dt);
    }

    // passive sound management (with facing-dependent muffle)
    if (started && (c.passiveRange || c.kind === 'school')) {
      const d = c.pos.distanceTo(camera.position);
      if (d < (c.passiveRange || 100)) {
        audio.startPassive(c);
        audio.pannerFor(c, c.pos);
        _v1.subVectors(c.pos, camera.position).normalize();
        audio.setPassiveMuffle(c, 0.5 + 0.5 * _v1.dot(fwd));
      } else audio.stopPassive(c);
    }
  }

  // ---- the clock: light, the layer, the breathing ocean
  worldT += dt;
  const sunEl = Math.cos((worldT / DAY_LEN) * Math.PI * 2);
  curLight01 = THREE.MathUtils.smoothstep(sunEl, -0.25, 0.25);
  const lightK = 0.22 + 0.78 * curLight01;
  curLayerDepth = THREE.MathUtils.lerp(150, 430, curLight01);
  if (curLight01 < 0.08 && !sawNight) {
    sawNight = true;
    say('night. the deep rises to meet you.', 6);
  }

  // ---- environment by depth
  const dark = THREE.MathUtils.clamp((depth - 25) / (TWILIGHT - 25), 0, 1);
  const black = THREE.MathUtils.clamp((depth - SUNLIT) / (TWILIGHT * 1.6), 0, 1);
  const fogC = FOG_BASE.clone().multiplyScalar(Math.max(1 - dark, 0.0) * lightK);
  scene.fog.color.copy(fogC);
  scene.background.copy(fogC);
  scene.fog.density = under ? 0.026 + black * 0.05 : 0.002;
  waterUniforms.uBrightness.value = Math.max(1 - dark * 1.1, 0) * lightK;
  surfaceUniforms.uBrightness.value = Math.max(1 - dark, 0) * lightK;
  surfaceUniforms.uTime.value = t;
  surfaceUniforms.uFogColor.value.copy(fogC).convertLinearToSRGB();
  floorMesh.visible = depth > TWILIGHT;
  surfaceMesh.visible = depth < 200;
  envU.uTime.value = t;
  envU.uDark.value = dark;
  envU.uFogDensity.value = scene.fog.density;

  const zone = depth < SUNLIT ? 'THE SUNLIT ZONE' : depth < TWILIGHT ? 'THE TWILIGHT' : 'THE ABYSS';
  if (zone !== curZone) {
    curZone = zone; zoneEl.textContent = zone; zoneEl.style.opacity = 1; zoneT = 3.5;
    if (zone === 'THE TWILIGHT') say('the light thins. trust your voice.', 5);
    if (zone === 'THE ABYSS') say('blind now. everything is sound.', 5);
  }

  // ---- marine snow: world-fixed, recycled around the player, depth-faded
  {
    const p = snow.geometry.attributes.position;
    const cp = camera.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i) - snowSink[i] * dt, z = p.getZ(i);
      if (x - cp.x >  SNOW_R) x -= SNOW_R*2; else if (x - cp.x < -SNOW_R) x += SNOW_R*2;
      if (y - cp.y >  SNOW_R) y -= SNOW_R*2; else if (y - cp.y < -SNOW_R) y += SNOW_R*2;
      if (z - cp.z >  SNOW_R) z -= SNOW_R*2; else if (z - cp.z < -SNOW_R) z += SNOW_R*2;
      if (y > -0.4) y -= SNOW_R * 2;     // no snow in the sky
      p.setXYZ(i, x, y, z);
    }
    p.needsUpdate = true;
    snowMat.opacity = 0.5 * (1 - dark) + 0.05;
  }

  // ---- breach spray
  for (let i = spray.length - 1; i >= 0; i--) {
    const p = spray[i];
    p.t += dt;
    p.vel.y -= 15 * dt;
    p.s.position.addScaledVector(p.vel, dt);
    p.s.material.opacity = Math.max(0.85 - p.t * 0.8, 0);
    if (p.t > 1.3 || (p.s.position.y < 0 && p.vel.y < 0)) {
      scene.remove(p.s); p.s.material.dispose(); spray.splice(i, 1);
    }
  }

  // ---- flashes (sound made visible, sunlit calibration)
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.t += dt;
    f.s.material.opacity = Math.max(0.9 - f.t * 1.4, 0);
    f.s.scale.multiplyScalar(1 + dt * 1.2);
    if (f.t > 0.7) { scene.remove(f.s); f.s.material.dispose(); flashes.splice(i, 1); }
  }

  // ---- audio frame work
  if (started) {
    audio.updateListener(camera);
    const giantHold = contacts.includes(giant) ? (giant.state === 'grasp' ? 1 : giant.state === 'latch' ? 0.5 : 0) : 0;
    audio.body(dt, player.o2, giantHold);
    const layer01 = THREE.MathUtils.clamp(1 - Math.abs(depth - curLayerDepth) / 70, 0, 1);
    audio.ambient(under ? THREE.MathUtils.clamp(1 - depth / 15, 0, 1) : 1, black, layer01);
    // the songline: another clan, somewhere beyond the dark.
    // in the deep sound channel the sea is a waveguide — voices arrive
    // clearer and far more often there.
    const channel01 = THREE.MathUtils.clamp(1 - Math.abs(depth - CHANNEL_DEPTH) / CHANNEL_HALF, 0, 1);
    if (channel01 > 0.5 && !heardChannel) {
      heardChannel = true;
      say('a seam in the sea — sound bends here, and carries forever.', 6);
    }
    songlineT -= dt * (1 + channel01 * 5);          // the channel teems with voices
    if (songlineT <= 0) {
      songlineT = 110 + Math.random() * 130;
      if (under && depth > 25) {
        const az = Math.random() * Math.PI * 2;
        // virtual source sits nearer than it "is" — the panner carries the
        // bearing while the muffling and wash carry the distance
        const R = 130 + Math.random() * 60 - channel01 * 40;
        audio.songline({
          x: camera.position.x + Math.cos(az) * R,
          y: THREE.MathUtils.clamp(camera.position.y + (Math.random() - 0.5) * 70, -800, -40),
          z: camera.position.z + Math.sin(az) * R,
        }, channel01);
        if (!heardSongline) {
          heardSongline = true;
          setTimeout(() => say('another clan, somewhere beyond the dark. you don\'t know their words.', 6), 2500);
        }
      }
    }
  }

  // ---- HUD
  player.pingCd -= dt;
  player.callCd -= dt;
  player.bestDepth = Math.max(player.bestDepth, depth);
  const alt = camera.position.y - floorY(camera.position.x, camera.position.z);
  if (msgT > 0 && (msgT -= dt) <= 0) msgEl.style.opacity = 0;
  if (zoneT > 0 && (zoneT -= dt) <= 0) zoneEl.style.opacity = 0;
  if (!firstPing && started && player.pingCd > 0) {
    firstPing = true;
    setTimeout(() => say('near answers come fast. far answers come late.', 5), 1500);
  }

  drawNav(dark);
  drawLungs(t);
  if (gizmos) drawGizmos();
  fpsEma = fpsEma * 0.95 + 0.05 / Math.max(dt, 1e-4);
  if (debugOpen) updateDebug(dt, depth, alt);

  prevYaw = euler.y; prevPitch = euler.x;
  renderer.render(scene, camera);
}

function startJet(c, from = camera.position) {
  c.jetT = 1.1;
  const away = c.pos.clone().sub(from).normalize();
  away.y += (Math.random() - 0.4) * 0.8;
  c.vel.copy(away.normalize().multiplyScalar(20 + Math.random()*8));
  audio.jet(c);
  // bioluminescent startle — the abyss's only light
  const mat = new THREE.SpriteMaterial({ map: dotTexture(), color: 0x66ffe9, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
  const s = new THREE.Sprite(mat);
  s.position.copy(c.pos);
  s.scale.setScalar(c.size * 1.6);
  scene.add(s);
  flashes.push({ s, t: 0.2 });
}

function blackout() {
  player.dead = true;
  fade.style.opacity = 1;
  say('', 0);
  if (contacts.includes(giant) && giant.state !== 'lurk') {
    giant.state = 'lurk'; giant.aggro = 0; giant.latchArm = null;
    giant.pos.set(120, -770, -80);
    setGripOverlay(null);
    audio.stopStrain();
  }
  setTimeout(() => {
    camera.position.set(0, -2, 0);
    player.vel.set(0,0,0);
    player.o2 = 1;
    player.dead = false;
    fade.style.opacity = 0;
    say('you woke at the surface. the deep kept your prey.', 6);
  }, 3500);
}

updateScore();
tick();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  sizeNav();
});

// ------------------------------------------------------------------ debug
window.SOUNDER = {
  contacts, camera, player, audio, scene, euler, keys, giant,
  ping, bite, emitCall,
  state: () => ({
    depth: -camera.position.y,
    o2: player.o2, score: player.score,
    audioState: audio.ctx?.state,
    panners: audio.panners.size,
    giant: contacts.includes(giant)
      ? { state: giant.state, aggro: +giant.aggro.toFixed(2), tentacles: giant.tentaclesLeft, d: Math.round(giant.pos.distanceTo(camera.position)) }
      : 'dead',
    contacts: contacts.map(c => ({ kind: c.kind, d: Math.round(c.pos.distanceTo(camera.position)), size: +c.size.toFixed(1), mode: c.mode })),
  }),
  start,
};
console.log('[SOUNDER] game module loaded');
