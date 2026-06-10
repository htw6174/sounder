// SOUNDER — the hunt. A deep-sea hunting game meant to be playable
// with sound alone. The screen covers only what sound can't.
import * as THREE from 'three';
import { AudioEngine, SOUND_SPEED } from './audio.js';

// ------------------------------------------------------------------ setup
const FOG_BASE = new THREE.Color(0x0a4d77);
const SUNLIT = 90, TWILIGHT = 300;      // zone boundaries (m of depth)
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

// ------------------------------------------------------------- water visuals
const waterUniforms = { uBrightness: { value: 1 } };
{
  const mat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uBrightness; varying vec3 vDir;
      void main(){
        float up = vDir.y * 0.5 + 0.5;
        vec3 down = vec3(0.005,0.045,0.09), mid = vec3(0.039,0.30,0.47), top = vec3(0.13,0.46,0.65);
        vec3 col = mix(down, mid, smoothstep(0.05,0.5,up));
        col = mix(col, top, smoothstep(0.5,0.95,up));
        gl_FragColor = vec4(col * uBrightness, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 24), mat);
  sky.renderOrder = -1;
  scene.add(sky);
  // keep it centered on the player so the gradient never "ends"
  sky.onBeforeRender = () => sky.position.copy(camera.position);
}

let surfaceMesh;
const surfaceUniforms = {
  uTime: { value: 0 },
  uSunPos: { value: new THREE.Vector3(22, 0, -95) },
  uFogColor: { value: FOG_BASE.clone().convertLinearToSRGB() },
  uFogDensity: { value: 0.026 },
  uBrightness: { value: 1 },
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
      uniform vec3 uSunPos; uniform vec3 uFogColor; uniform float uFogDensity; uniform float uBrightness;
      varying vec3 vWorldPos; varying vec3 vNormal; varying float vViewDist;
      void main(){
        float sunDist = distance(vWorldPos.xz, uSunPos.xz);
        float glow = exp(-sunDist/70.0); float halo = exp(-sunDist/220.0);
        float shimmer = 0.5 + 0.6*pow(abs(vNormal.x*3.2+vNormal.z*2.4),1.4);
        vec3 deep = vec3(0.10,0.36,0.55), mid = vec3(0.34,0.70,0.88), bright = vec3(1.25,1.35,1.32);
        vec3 col = mix(deep, mid, clamp(halo*shimmer,0.0,1.0));
        col = mix(col, bright, clamp(glow*1.4*shimmer,0.0,1.0));
        float near = exp(-vViewDist/26.0);
        col += vec3(0.16,0.30,0.36)*near*shimmer;
        col *= uBrightness;
        float fogF = 1.0 - exp(-uFogDensity*vViewDist);
        col = mix(col, uFogColor, fogF);
        gl_FragColor = vec4(col, 1.0); }`,
  });
  const geo = new THREE.PlaneGeometry(900, 900, 140, 140);
  geo.rotateX(Math.PI / 2);
  surfaceMesh = new THREE.Mesh(geo, mat);
  scene.add(surfaceMesh);
  surfaceMesh.onBeforeRender = () => { surfaceMesh.position.x = camera.position.x; surfaceMesh.position.z = camera.position.z; };
}

// seafloor (you will almost never see it; you will hear it).
// hidden until the fog has gone black, so its fogged-to-blue distant
// expanse never washes out the open-water gradient from above.
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
// how fast you're moving in the dark). Particles live in a wrap-around
// cube centered on the player and fade with depth.
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

// ------------------------------------------------------------------ fauna
const contacts = [];   // anything that returns an echo

function makeWhaleMesh() {
  const profile = [
    [0.02,0],[0.18,0.5],[0.38,1.4],[0.70,2.8],[1.05,4.4],[1.30,6.0],[1.42,7.6],
    [1.45,9.0],[1.42,10.4],[1.30,11.4],[0.95,12.1],[0.30,12.45],[0.0,12.5],
  ].map(([r,y]) => new THREE.Vector2(r,y));
  const mat = new THREE.MeshBasicMaterial({ color: 0x2b4257 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 20), mat);
  body.rotation.z = -Math.PI/2; g.add(body);
  const blob = new THREE.SphereGeometry(1, 10, 7);
  for (const s of [-1,1]) {
    const fl = new THREE.Mesh(blob, mat);
    fl.scale.set(1.7,0.14,0.75); fl.position.set(-0.4,0,s*1.15); fl.rotation.y = s*-0.55; g.add(fl);
  }
  return g;
}

function makeSquidMesh(size) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x2e2531 });
  const g = new THREE.Group();
  const mantle = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.4, 10), mat);
  mantle.rotation.x = Math.PI/2; mantle.position.z = -0.6; g.add(mantle);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), mat);
  head.position.z = 0.7; g.add(head);
  for (let i = 0; i < 6; i++) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 1.6, 5), mat);
    arm.rotation.x = Math.PI/2 + (Math.random()-0.5)*0.5;
    arm.rotation.z = (i/6) * Math.PI*2;
    arm.position.set(Math.sin(i)*0.18, Math.cos(i)*0.18, 1.6);
    g.add(arm);
  }
  g.scale.setScalar(size);
  return g;
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
  });
}

function addSquid(depth, opts = {}) {
  const size = opts.size ?? (0.8 + Math.random()*1.6);
  const mesh = makeSquidMesh(size);
  const a = Math.random()*Math.PI*2, r = 40 + Math.random()*240;
  mesh.position.set(Math.cos(a)*r, -depth, Math.sin(a)*r);
  scene.add(mesh);
  const c = {
    kind: opts.giant ? 'giant' : 'squid', mesh, pos: mesh.position,
    vel: new THREE.Vector3(), size, jetT: 0, bites: 0,
    homeDepth: -depth, seed: Math.random()*100,
    passiveRange: opts.giant ? 600 : 0,
  };
  contacts.push(c);
  return c;
}

function addWhale(x, y, z) {
  const mesh = makeWhaleMesh();
  mesh.position.set(x, y, z);
  scene.add(mesh);
  contacts.push({
    kind: 'whale', mesh, pos: mesh.position, vel: new THREE.Vector3(),
    size: 11, seed: Math.random()*100, passiveRange: 350, heading: Math.random()*Math.PI*2,
  });
}

for (let i = 0; i < 7; i++) addSchool((Math.random()-0.5)*420, -15 - Math.random()*105, (Math.random()-0.5)*420);
for (let i = 0; i < 10; i++) addSquid(160 + Math.random()*360);
for (let i = 0; i < 4; i++) addSquid(520 + Math.random()*280);
const giant = addSquid(770, { giant: true, size: 9 });
giant.pos.set(120, -770, -80);
addWhale(-60, -30, -90);
addWhale(-40, -45, -120);

// ------------------------------------------------------------------ player
const player = {
  vel: new THREE.Vector3(),
  o2: 1, score: 0, bestDepth: 0,
  lungeT: 0, pingCd: 0, creaking: false,
  dead: false,
};
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const keys = {};
let debugOpen = false, gizmos = false, fpsEma = 60;

const gate = document.getElementById('gate');
let started = false;
function start() {
  if (!started) {
    audio.init();
    started = true;
    gate.classList.add('gone');
    say('the light is yours for ninety meters. learn fast.', 5);
  }
  try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch (e) { /* synthetic clicks can't lock */ }
}
gate.addEventListener('click', start);
canvas.addEventListener('click', start);
addEventListener('contextmenu', (e) => e.preventDefault());

addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  euler.y -= e.movementX * 0.0021;
  euler.x = THREE.MathUtils.clamp(euler.x - e.movementY * 0.0021, -1.45, 1.45);
  camera.quaternion.setFromEuler(euler);
});
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();      // space = rise
  if (e.code === 'KeyF') bite();
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
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (e.button === 0) ping();
  if (e.button === 2) player.creaking = true;
});
addEventListener('mouseup', (e) => { if (e.button === 2) player.creaking = false; });

// ------------------------------------------------------------------ sonar
// Emissions are SILENT — you are the click. You hear only the returns.
const flashes = [];
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
    // calibration: while there is light, see what you hear, when you hear it
    if (depth < SUNLIT + 40) scheduleFlash(c, delay);
  }
  audio.boundaryEcho(depth, camera.position.y - floorY(camera.position.x, camera.position.z), camera.position);
  // squid hear a close loud click and may bolt
  for (const c of contacts) {
    if (c.kind !== 'squid' || c.jetT > 0) continue;
    if (c.pos.distanceTo(camera.position) < 70 && Math.random() < 0.4) startJet(c);
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
  let hit = null;
  for (const c of contacts) {
    if (c.kind !== 'squid' && c.kind !== 'giant') continue;
    const to = c.pos.clone().sub(camera.position);
    const d = to.length();
    const reach = c.kind === 'giant' ? 14 : 7.5;
    if (d < reach && to.normalize().dot(fwd) > 0.55) { hit = c; break; }
  }
  audio.bite(!!hit);
  if (!hit) return;
  if (hit.kind === 'giant') {
    hit.bites++;
    if (hit.bites < 3) { say(`it recoils — ${3 - hit.bites} more`, 3); hit.vel.add(new THREE.Vector3((Math.random()-0.5), 0.3, (Math.random()-0.5)).multiplyScalar(8)); return; }
    player.score += 10;
    say('the abyss is yours. the name fits.', 8);
    audio.stopPassive(hit);
  } else {
    player.score += 1;
    say('caught.', 1.5);
  }
  audio.dropPanner(hit);
  scene.remove(hit.mesh);
  contacts.splice(contacts.indexOf(hit), 1);
  if (hit.kind === 'squid') addSquid(200 + Math.random()*550);
  updateScore();
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
// A faint inner-ear overlay: a world-level horizon line that drifts with
// pitch, carrying dim cardinal ticks. Brighter in the dark, where it's
// the only orientation you have besides sound.
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
  let hy = H / 2 + (pitch / fovY) * H;     // horizon: look up → line slides down
  let clamped = false;
  if (hy < H * 0.08) { hy = H * 0.08; clamped = true; }
  if (hy > H * 0.92) { hy = H * 0.92; clamped = true; }
  const a = clamped ? alpha * 0.35 : alpha;

  // horizon line, fading at the edges
  const grad = nctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(150,215,250,0)');
  grad.addColorStop(0.18, `rgba(150,215,250,${a})`);
  grad.addColorStop(0.82, `rgba(150,215,250,${a})`);
  grad.addColorStop(1, 'rgba(150,215,250,0)');
  nctx.strokeStyle = grad;
  nctx.lineWidth = 1;
  nctx.beginPath(); nctx.moveTo(0, hy); nctx.lineTo(W, hy); nctx.stroke();

  // cardinal ticks slide along the horizon as you turn
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

  // pitch dashes on the center column every 30°
  nctx.textAlign = 'left';
  for (const pm of [-1.047, -0.524, 0.524, 1.047]) {
    const y = H / 2 + ((pitch - pm) / fovY) * H;
    if (y < H * 0.1 || y > H * 0.9) continue;
    nctx.strokeStyle = `rgba(150,215,250,${alpha * 0.6})`;
    nctx.beginPath(); nctx.moveTo(W / 2 - 14, y); nctx.lineTo(W / 2 + 14, y); nctx.stroke();
  }
}

// the body's gauge: lungs that drain from blue to red. imprecise on purpose.
function drawLungs(t) {
  if (!started || camera.position.y > 0) return;
  const H = nav.height;
  const u = 1 - player.o2;
  let scale = 1;
  if (player.o2 < 0.10) scale = 1 + 0.10 * Math.sin(t * 8);   // pounding with the heart
  const r = Math.round(110 + 145 * u), gc = Math.round(190 - 110 * u), b = Math.round(235 - 165 * u);
  const a = 0.25 + 0.45 * u;
  nctx.save();
  nctx.translate(46, H / 2);
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
    nctx.fillText(`${c.kind} ${Math.round(c.pos.distanceTo(camera.position))}m`, x + 14, y + 4);
  }
}

const debugEl = document.getElementById('debug');
function updateDebug(dt, depth, alt) {
  const p = camera.position;
  debugEl.innerHTML =
    `pos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}<br>` +
    `depth ${depth.toFixed(1)} · alt ${alt.toFixed(1)}<br>` +
    `o2 ${(player.o2 * 100).toFixed(1)}% · vel ${player.vel.length().toFixed(2)}<br>` +
    `contacts ${contacts.length} · panners ${audio.panners.size} · fps ${fpsEma.toFixed(0)}<br>` +
    `[G] gizmos ${gizmos ? 'ON' : 'off'} · [O] refill O₂ · [1/2/3] teleport`;
}

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
let firstPing = false, creakTimer = 0, wasUnder = true;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const depth = -camera.position.y;
  const under = camera.position.y < 0;

  // ---- movement
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  let thrust = 0;
  if (keys.KeyW) thrust = 11;
  if (keys.KeyS) thrust = -4;
  if (player.lungeT > 0) { player.lungeT -= dt; thrust += 26 * (player.lungeT / 0.35); }
  player.vel.addScaledVector(fwd, thrust * dt);
  if (under) {
    if (keys.Space) player.vel.y += 9 * dt;                      // rise
    if (keys.ShiftLeft || keys.ShiftRight) player.vel.y -= 9 * dt; // sink
    player.vel.multiplyScalar(Math.pow(0.45, dt));               // water drag
  } else {
    player.vel.y -= 16 * dt;                                     // gravity: what goes up
    player.vel.multiplyScalar(Math.pow(0.92, dt));               // thin air
  }
  camera.position.addScaledVector(player.vel, dt);
  const fy = floorY(camera.position.x, camera.position.z) + 2;
  camera.position.y = Math.max(camera.position.y, fy);
  const horiz = Math.hypot(camera.position.x, camera.position.z);
  if (horiz > 430) {
    camera.position.x *= 430/horiz; camera.position.z *= 430/horiz;
  }

  // breaching
  if (under !== wasUnder) {
    audio.splash(under ? 0.5 : Math.min(Math.abs(player.vel.y) / 10, 1));
    if (!under) audio.breath();
    wasUnder = under;
  }

  // ---- oxygen (the clock starts when the hunt does)
  if (started && !player.dead) {
    if (depth < 3.5) {
      if (player.o2 < 0.98 && Math.floor(t*2)%4===0) audio.breath();
      player.o2 = Math.min(1, player.o2 + dt * 0.25);
    } else {
      player.o2 -= dt / 600;     // ten minutes of breath
      if (player.o2 <= 0) blackout();
    }
  }

  // ---- creak: hold right-click (or C). Locks the nearest prey in ANY
  // direction; tick interval IS the round-trip time, so the buzz itself
  // is the rangefinder. Each tick returns from the target's true bearing.
  if ((player.creaking || keys.KeyC) && started && !player.dead) {
    let target = null, bd = 90, school = null, sd = 90;
    for (const c of contacts) {
      if (c.kind === 'whale') continue;
      const d = c.pos.distanceTo(camera.position);
      if (c.kind === 'school') { if (d < sd) { school = c; sd = d; } }
      else if (d < bd) { target = c; bd = d; }
    }
    if (!target) { target = school; bd = sd; }   // prey outranks fish for the lock
    creakTimer -= dt;
    if (creakTimer <= 0 && target) {
      creakTimer = Math.max((2 * bd) / SOUND_SPEED, 0.045);
      audio.creakEcho(target, { pos: camera.position, vel: player.vel, fwd });
    }
    if (!target) creakTimer = 0;
  } else creakTimer = 0;

  // ---- contacts behavior
  for (const c of contacts) {
    if (c.kind === 'school') {
      c.pos.x += Math.sin(t*0.07 + c.seed) * dt * 3;
      c.pos.z += Math.cos(t*0.05 + c.seed) * dt * 3;
      c.vel.set(Math.sin(t*0.07+c.seed)*3, 0, Math.cos(t*0.05+c.seed)*3);
      c.mesh.rotation.y += dt * 0.1;
    } else if (c.kind === 'whale') {
      c.heading += dt * 0.05;
      c.vel.set(Math.cos(c.heading)*2.4, Math.sin(t*0.2+c.seed)*0.5, Math.sin(c.heading)*2.4);
      c.pos.addScaledVector(c.vel, dt);
      c.mesh.rotation.y = -c.heading;
    } else { // squid & giant
      const d = c.pos.distanceTo(camera.position);
      if (c.kind === 'squid' && d < 13 && c.jetT <= 0) startJet(c);
      if (c.jetT > 0) {
        c.jetT -= dt;
      } else {
        // languid drift back toward home depth
        c.vel.multiplyScalar(Math.pow(0.3, dt));
        c.vel.y += (c.homeDepth - c.pos.y) * 0.01 * dt * 60;
        c.vel.x += Math.sin(t*0.3 + c.seed) * dt * 0.8;
        c.vel.z += Math.cos(t*0.27 + c.seed) * dt * 0.8;
      }
      c.vel.y *= Math.pow(0.5, dt);
      c.pos.addScaledVector(c.vel, dt);
      if (c.vel.lengthSq() > 0.1) c.mesh.lookAt(c.pos.clone().add(c.vel));
    }

    // passive sound management
    if (started && (c.passiveRange || c.kind === 'school')) {
      const d = c.pos.distanceTo(camera.position);
      if (d < (c.passiveRange || 100)) {
        audio.startPassive(c);
        audio.pannerFor(c, c.pos);
        const to = c.pos.clone().sub(camera.position).normalize();
        audio.setPassiveMuffle(c, 0.5 + 0.5 * to.dot(fwd));
      } else audio.stopPassive(c);
    }
  }

  // ---- environment by depth
  const dark = THREE.MathUtils.clamp((depth - 25) / (TWILIGHT - 25), 0, 1);
  const black = THREE.MathUtils.clamp((depth - SUNLIT) / (TWILIGHT * 1.6), 0, 1);
  const fogC = FOG_BASE.clone().multiplyScalar(Math.max(1 - dark, 0.0));
  scene.fog.color.copy(fogC);
  scene.background.copy(fogC);
  scene.fog.density = under ? 0.026 + black * 0.05 : 0.002;
  waterUniforms.uBrightness.value = Math.max(1 - dark * 1.1, 0);
  surfaceUniforms.uBrightness.value = Math.max(1 - dark, 0);
  surfaceUniforms.uTime.value = t;
  surfaceUniforms.uFogColor.value.copy(fogC).convertLinearToSRGB();
  floorMesh.visible = depth > TWILIGHT;        // only once the fog is truly black
  surfaceMesh.visible = depth < 200;            // below that it's just a black silhouette

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
      // wrap into the cube around the player without disturbing world-anchoring
      if (x - cp.x >  SNOW_R) x -= SNOW_R*2; else if (x - cp.x < -SNOW_R) x += SNOW_R*2;
      if (y - cp.y >  SNOW_R) y -= SNOW_R*2; else if (y - cp.y < -SNOW_R) y += SNOW_R*2;
      if (z - cp.z >  SNOW_R) z -= SNOW_R*2; else if (z - cp.z < -SNOW_R) z += SNOW_R*2;
      p.setXYZ(i, x, y, z);
    }
    p.needsUpdate = true;
    snowMat.opacity = 0.5 * (1 - dark) + 0.05;   // barely-there in the deep
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
    audio.body(dt, player.o2);
    audio.ambient(under ? THREE.MathUtils.clamp(1 - depth / 15, 0, 1) : 1, black);
  }

  // ---- HUD
  player.pingCd -= dt;
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
  renderer.render(scene, camera);
}

function startJet(c) {
  c.jetT = 1.1;
  const away = c.pos.clone().sub(camera.position).normalize();
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
  contacts, camera, player, audio, scene, euler, keys,
  ping, bite,
  state: () => ({
    depth: -camera.position.y,
    o2: player.o2, score: player.score,
    audioState: audio.ctx?.state,
    panners: audio.panners.size,
    contacts: contacts.map(c => ({ kind: c.kind, d: Math.round(c.pos.distanceTo(camera.position)), size: +c.size.toFixed(1) })),
  }),
  start,
};
console.log('[SOUNDER] game module loaded');
