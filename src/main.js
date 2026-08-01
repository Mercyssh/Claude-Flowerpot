import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import GUI from "lil-gui";

// ---------------------------------------------------------------------------
// Tunable visual parameters
// ---------------------------------------------------------------------------
const params = {
  aoIntensity: 0.4,         // strength of shading darkening (0..1)
  shadingSoftness: 1.0,     // runtime light wrap when no AO map is present
  bloomSpeed: 2.5,          // how fast a flower blooms/closes on hover
  flowerAttachScale: 0.35,  // scale the chosen flower shrinks to on the head
  flowerSpacing: 1.27,      // x-distance of the outer flowers from center
  orbitAmountX: 0.08,       // portrait mouse-look: vertical tilt range as cursor moves top↔bottom (radians)
  orbitAmountY: 0.35,       // portrait mouse-look: horizontal turn range as cursor moves left↔right (radians)
  paintSpeed: 0.3,          // paint-in dissolve speed (progress/sec)
  flowerSnapSpeed: 0.25,     // flower-snap speed (progress/sec); matches paintSpeed by default
  appearDir: "back",          // direction the paint stroke travels across the head
  appearNoiseScale: 2.0,    // grain of the brush streaks (higher = finer bristles)
  appearJitter: 0.35,       // how ragged/broken the wet paint front is (0 = clean wipe)
  appearEdgeSoft: 0.06,     // feather width of the wet edge (0 = hard cut, >0 = soft fade)
  fovBefore: 45,            // camera FOV while choosing (before a flower is picked)
  fovAfter: 22,             // camera FOV in the portrait (after selection)
  noiseFreq: 0.2,           // spatial frequency of the petal-wobble noise
  noiseClosed: 0.03,        // wobble amplitude while a flower is closed
  noiseOpen: 0.04,          // wobble amplitude while a flower is bloomed
  bobAmount: 0.05,          // vertical bob height once flowers settle (world units)
  bobSpeed: 1.2,            // vertical bob frequency (cycles ~ radians/sec)
  bloomSpin: 1.15,           // radians a flower turns as it blooms (stops when open)
  backsideOverlay: true,   // tint one side of the petals
  backsideFace: "back",     // winding flip: swap if the tint lands on the wrong side
  backsideColor: "#8a2f2f", // color blended into the tinted-side texture
  backsideStrength: 0.6,    // peak tint strength at full closed/open (0..1)
  headScale: 3.9,           // uniform scale of the person model
  personBobAmount: 0.04,    // vertical bob height of the person model (world units)
  personBobSpeed: 0.9,      // vertical bob frequency of the person (radians/sec)
  personInvertX: true,      // invert mouse-look tilt (X axis): head tilts away from cursor
  personInvertY: false,      // invert mouse-look turn (Y axis): head turns away from cursor
};

// Paint-stroke travel directions (object space) for the head reveal.
const APPEAR_DIRS = {
  up: [0, 1, 0], down: [0, -1, 0],
  left: [-1, 0, 0], right: [1, 0, 0],
  front: [0, 0, 1], back: [0, 0, -1],
};

// Intro fly-in tuning (finalized — no longer GUI-exposed)
const INTRO_TRAVEL = 3.8;      // seconds each flower spends travelling the path
const INTRO_STAGGER = 0.2;     // seconds between successive flowers entering
const INTRO_SPIN_TURNS = 0.8;  // full rotations each flower does while flying in
const CURVE_TYPE = "catmullrom"; // intro spline type
const CURVE_TENSION = 0.75;      // intro spline corner roundness

const POPUP_TEXT = [
  "Beautiful, as you are..",
  "Clever, like your mind..",
  "Comfort, that you give..",
];

// One poem per flower — index matches the flower's layout index (0 = left,
// 1 = center, 2 = right), same order as POPUP_TEXT above. The chosen flower's
// poem is built into #poem on selection. `signature` may contain <br>.
const POEMS = [
  {
    // 0 — Beautiful
    lines: [
      "Look how beautiful you are!",
      "So much that my day feels lighter the moment I look at you",
      "Its a face I will always want to see the next day because..",
      "Your eyes are the stars I'd gladly fall asleep beneath every night,",
      "And your smile is the warm morning sun that makes everything feel alive.",
      "And this bloom is a small mirror of that grace,",
      "Know I find you beautiful even in the ordinary hours.",
    ],
    signature: "Happy Girlfriend Day! <br>love, omu",
  },
  {
    // 1 — Clever
    lines: [
      "I don't think I know anyone as clever as you.",
      "Every problem feels a little smaller after I've talked to you.",
      "You somehow always have an answer, even to questions I didn't know I was asking",
      "People spend years looking for answers to life's biggest questions",
      "But one of them became wonderfully simple when I met you, because..",
      "you are my answer to love."
    ],
    signature: "Happy Girlfriend Day! <br>love, omu",
  },
  {
    // 2 — Funny
    lines: [
      "The comfort we share is something special,",
      "Where you can make the silliest faces without a second thought,",
      "And I can show the same side in me without any fear",
      "With you, I never have to hide that side of myself",
      "Because I know that we are goofballs together",
      "That can laugh at the silliest of things.",
    ],
    signature: "Happy Girlfriend Day! <br>love, omu",
  },
];

// ---------------------------------------------------------------------------
// Core three.js setup
// ---------------------------------------------------------------------------
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0); // transparent — page bg shows through

const scene = new THREE.Scene();
scene.background = null; // transparent so the HTML text behind can be masked by flowers

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0.4, 6);

// Lights — the runtime shading fallback when AO maps aren't supplied yet
const hemi = new THREE.HemisphereLight(0xffffff, 0x8d8577, 1.0);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 1.2);
key.position.set(2, 3, 4);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.4);
fill.position.set(-3, 1, 2);
scene.add(fill);

function applyShadingParams() {
  // Without AO maps, "depth shading" == directional lighting contrast.
  hemi.intensity = THREE.MathUtils.lerp(1.4, 1.0, params.shadingSoftness);
  key.intensity = 1.2 * (0.5 + params.aoIntensity);
  fill.intensity = 0.4;
}
applyShadingParams();

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------
const PHASE = { INTRO: "intro", CHOOSING: "choosing", TRANSITION: "transition", PORTRAIT: "portrait" };
let phase = PHASE.INTRO;

const flowers = [];        // { group, morphMeshes[], target, current, homePos, homeScale }
let hovered = null;
let selected = null;

let paintProgress = 0;     // 0 = head invisible, 1 = fully painted in
let headReplay = false;    // true while a GUI-triggered reveal replay is running
let head = null;           // container for the person model
let headMaterials = [];    // per-mesh materials whose uProgress drives paint-in
let flowerAnchor = null;   // empty pulled from the GLB; flower flies + faces here

// Edit mode: force the head fully visible and enable the drag gizmo so the
// person model can be scaled/positioned/rotated by hand.
const headEdit = { show: false, mode: "translate" };

// ---------------------------------------------------------------------------
// Load the flower and clone it into 3 instances
// ---------------------------------------------------------------------------
const loader = new GLTFLoader();

// Hand-painted base colors — one texture per distinct flower model.
const texLoader = new THREE.TextureLoader();
function loadFlowerTex(url) {
  const t = texLoader.load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false; // glTF UV convention
  return t;
}
const flower1Tex = loadFlowerTex("./flower1/flower1_basecolor.png");
const flower2Tex = loadFlowerTex("./flower2/DefaultMaterial_BaseColor.png");
const flower3Tex = loadFlowerTex("./flower3/DefaultMaterial_BaseColor.png");

// Ashima 3D simplex noise — used in the vertex stage to add smooth, organic
// wobble to every petal. Returns roughly [-1, 1].
const NOISE_GLSL = /* glsl */`
  vec3 mod289(vec3 x){ return x - floor(x*(1.0/289.0))*289.0; }
  vec4 mod289(vec4 x){ return x - floor(x*(1.0/289.0))*289.0; }
  vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314*r; }
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
`;

// Backside tint — shared across every flower material (global controls). Back
// faces multiply their texture by uBacksideColor, blended by uBacksideStrength.
const backsideUniforms = {
  uBacksideOn: { value: 0 },
  uBacksideFront: { value: 0 }, // 1 = tint front faces instead of back faces
  uBacksideColor: { value: new THREE.Color(0x8a2f2f) },
  uBacksideStrength: { value: 0.6 },
};

// Build a flower material that injects the noise wobble into the vertex stage.
// uBloom (1 = closed, 0 = open) selects between the closed/open amplitudes so
// each instance breathes independently. Returns the material; its live uniforms
// are stashed on userData.noiseUniforms for per-frame updates.
function makeFlowerMaterial(tex) {
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    // NOTE: keep transparent:false. transparent:true + DoubleSide makes the
    // renderer do a 2-pass draw that breaks gl_FrontFacing (three.js #25149),
    // which is what stops the backside tint from ever firing. The petal cutout
    // comes from alphaTest, which works fine on an opaque material.
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  const u = {
    uTime: { value: 0 },
    uBloom: { value: 1 },
    uNoiseFreq: { value: params.noiseFreq },
    uNoiseAmpClosed: { value: params.noiseClosed },
    uNoiseAmpOpen: { value: params.noiseOpen },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, backsideUniforms);

    // Multiply the tint into back-facing fragments only.
    shader.fragmentShader =
      "uniform float uBacksideOn;\n" +
      "uniform float uBacksideFront;\n" +
      "uniform vec3 uBacksideColor;\n" +
      "uniform float uBacksideStrength;\n" +
      "uniform float uBloom;\n" +
      shader.fragmentShader.replace(
        "#include <map_fragment>",
        /* glsl */`#include <map_fragment>
        // Bloom-driven side crossfade. uBloom: 1 = closed, 0 = open.
        // Closed -> tint the FRONT face; as the flower opens the tint fades
        // across to the BACK face. uBacksideFront flips which gl side counts
        // as "front" (use it if winding puts the effect on the wrong side).
        // Blend the texture *toward* the flat color so it reads on dark texels.
        float _open = 1.0 - clamp(uBloom, 0.0, 1.0);            // 0 closed .. 1 open
        bool _isFront = (uBacksideFront > 0.5) ? !gl_FrontFacing : gl_FrontFacing;
        float _sideAmt = _isFront ? (1.0 - _open) : _open;      // front strong closed, back strong open
        diffuseColor.rgb = mix(diffuseColor.rgb, uBacksideColor,
                               uBacksideStrength * uBacksideOn * _sideAmt);`
      );

    shader.vertexShader =
      "uniform float uTime;\n" +
      "uniform float uBloom;\n" +
      "uniform float uNoiseFreq;\n" +
      "uniform float uNoiseAmpClosed;\n" +
      "uniform float uNoiseAmpOpen;\n" +
      NOISE_GLSL +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        /* glsl */`#include <begin_vertex>
        {
          vec3 _p = position * uNoiseFreq;
          vec3 _disp = vec3(
            snoise(_p + vec3(0.0, 0.0, uTime * 0.40)),
            snoise(_p + vec3(11.3, 5.1, uTime * 0.37)),
            snoise(_p + vec3(3.7, 9.2, uTime * 0.43))
          );
          float _amp = mix(uNoiseAmpOpen, uNoiseAmpClosed, clamp(uBloom, 0.0, 1.0));
          transformed += _disp * _amp;
        }`
      );
  };
  mat.userData.noiseUniforms = u;
  return mat;
}

function collectMorphMeshes(root) {
  const list = [];
  root.traverse((o) => {
    if (o.isMesh && o.morphTargetDictionary && "bloom" in o.morphTargetDictionary) {
      list.push({ mesh: o, index: o.morphTargetDictionary.bloom });
    }
  });
  return list;
}

function setBloom(entry, value) {
  // value: 1 = closed, 0 = open (per the model's authoring)
  for (const m of entry.morphMeshes) {
    m.mesh.morphTargetInfluences[m.index] = value;
  }
}

// Per-flower controls (index = layout slot: 0 left, 1 center, 2 right). All are
// live-editable in the GUI. closedShrink/openScale are the scales before/after
// bloom; rx/ry/rz are the resting orientation each flower holds once the intro
// fly-in ends (bloom spin composes on top); offsetY nudges the home spot up (+)
// or down (-) from the shared base height.
const FLOWER_BASE_Y = -1.2; // shared home height before per-flower offsetY
const flowerCfg = [
  { closedShrink: 0.7, openScale: 0.8, rx: 0.681, ry: -0.15, rz: 0.35, offsetY: 0 },
  { closedShrink: 0.46, openScale: 0.8, rx: 0.838, ry: -1.55, rz: 0.18, offsetY: 0.3 },
  { closedShrink: 0.7, openScale: 1.22, rx: 0.75, ry: 0.15, rz: -0.35, offsetY: 0 },
];

// Fan layout: position basics per slot. `src` picks the GLB + texture — centre
// (2nd) is flower3, right (3rd) is flower2, left (1st) is flower1. Scale +
// rotation live in flowerCfg.
const layout = [
  { dir: -1, z: -0.4, src: "f1" },
  { dir: 0, z: 0, src: "f3" },
  { dir: 1, z: -0.4, src: "f2" },
];

Promise.all([
  loader.loadAsync("./flower1/flower1.glb"),
  loader.loadAsync("./flower2/flower2.glb"),
  loader.loadAsync("./flower3/flower3.glb"),
]).then(([g1, g2, g3]) => {
  // Each source pairs a base scene to clone with its own base-color texture.
  const bases = {
    f1: { scene: g1.scene, tex: flower1Tex },
    f2: { scene: g2.scene, tex: flower2Tex },
    f3: { scene: g3.scene, tex: flower3Tex },
  };

  layout.forEach((L, i) => {
    const base = bases[L.src];
    const cfg = flowerCfg[i];
    const group = base.scene.clone(true);
    // Clone morph arrays + materials so instances animate/texture independently
    const noiseUniforms = [];
    group.traverse((o) => {
      if (o.isMesh) {
        if (o.morphTargetInfluences) o.morphTargetInfluences = o.morphTargetInfluences.slice();
        o.material = makeFlowerMaterial(base.tex); // unlit + vertex wobble
        noiseUniforms.push(o.material.userData.noiseUniforms);
      }
    });
    group.position.set(L.dir * params.flowerSpacing, FLOWER_BASE_Y + cfg.offsetY, L.z);
    group.rotation.set(cfg.rx, cfg.ry, cfg.rz);
    group.scale.setScalar(cfg.closedShrink); // start closed = shrunk

    const entry = {
      group,
      morphMeshes: collectMorphMeshes(group),
      target: 1,   // start closed
      current: 1,
      spacingDir: L.dir,
      homePos: group.position.clone(),
      homeScale: group.scale.clone(),
      homeQuat: group.quaternion.clone(), // base orientation; spin composes on top
      noiseUniforms,
      index: i,
    };
    setBloom(entry, 1);
    scene.add(group);
    flowers.push(entry);
  });

  buildIntroCurve();
}).catch((err) => console.error("Failed to load flower GLBs:", err));

// ---------------------------------------------------------------------------
// Intro fly-in: the flowers stream down an S-shaped path (matching the mockup
// stem) and peel off one-by-one at their home positions. The path's tail runs
// through the three home points in left→center→right order, so each flower
// simply rides the curve up to its own stop parameter.
// ---------------------------------------------------------------------------
let introCurve = null;
let introTime = 0;
let chooseStart = 0;       // elapsed time when flowers settle → bob eases in from here
const BOB_RAMP = 1.5;      // seconds for the bob to fade from still to full amplitude
let introStopT = [];
let introStopS = [];
const introTmp = new THREE.Vector3();

// The 5 baked path points (the tail 3 are pinned to the flower homes at runtime).
const introPathPoints = [
  new THREE.Vector3(0.800, 5.500, 0.000),   // enters off the top
  new THREE.Vector3(2.700, 3.200, 0.000),   // bulges right
  new THREE.Vector3(1.737, 1.202, 0.000),   // curls back toward center
  new THREE.Vector3(-1.572, 1.549, 0.000),  // sweeps up-left
  new THREE.Vector3(-3.070, -0.263, -0.200),// drops down the far left
];

function buildIntroCurve() {
  const hp = flowers.map((f) => f.homePos);
  introCurve = new THREE.CatmullRomCurve3(
    [
      ...introPathPoints.map((p) => p.clone()),
      hp[0].clone(), // left flower home
      hp[1].clone(), // center flower home
      hp[2].clone(), // right flower home
    ],
    false,
    CURVE_TYPE,
    CURVE_TENSION,
  );
  // 8 control points → 7 segments; CatmullRom passes through point i at t=i/7,
  // so the three homes sit at these curve parameters (indices 5, 6, 7).
  introStopT = [5 / 7, 6 / 7, 7 / 7];

  // Convert those parameters to arc-length fractions so the flowers travel at a
  // constant on-screen speed (raw parameter steps cover uneven distance because
  // the control points are far apart up top and bunched near the flowers).
  introCurve.arcLengthDivisions = 600;
  const lengths = introCurve.getLengths();
  const total = lengths[lengths.length - 1];
  introStopS = introStopT.map((t) => {
    const f = t * (lengths.length - 1);
    const i = Math.min(Math.floor(f), lengths.length - 2);
    const l = THREE.MathUtils.lerp(lengths[i], lengths[i + 1], f - i);
    return l / total;
  });
}

// Smooth accel + decel so each flower eases off the top and settles gently.
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Reposition the outer flowers when the spacing slider changes (phase 1 only —
// after selection the flowers fly to the head and are no longer laid out here).
function applyFlowerSpacing() {
  if (phase !== PHASE.CHOOSING) return;
  for (const f of flowers) {
    f.group.position.x = f.spacingDir * params.flowerSpacing;
    f.homePos.x = f.group.position.x;
  }
}

// Push a flower's edited resting rotation (flowerCfg[i]) into its homeQuat — the
// base pose applySpin composes bloom/fly-in spin onto, so the flower settles into
// this orientation once the intro ends. GUI hook; takes effect next frame.
const _cfgEuler = new THREE.Euler();
function applyFlowerRotation(i) {
  const f = flowers.find((fl) => fl.index === i);
  if (!f) return;
  const c = flowerCfg[i];
  f.homeQuat.setFromEuler(_cfgEuler.set(c.rx, c.ry, c.rz));
}

// Push a flower's edited vertical offset (flowerCfg[i].offsetY) into its homePos.
// The choosing-phase bob is anchored to homePos.y, so this shifts the whole rest
// spot up/down. GUI hook; takes effect next frame.
function applyFlowerOffset(i) {
  const f = flowers.find((fl) => fl.index === i);
  if (!f) return;
  f.homePos.y = FLOWER_BASE_Y + flowerCfg[i].offsetY;
}

// ---------------------------------------------------------------------------
// Person model — unlit (MeshBasicMaterial, like the flowers) with a "paint-in"
// dissolve injected into the fragment stage so the head still reveals gradually.
// The GLB carries a "floweranchor" empty; the chosen flower flies to it and
// takes its orientation so it faces along the anchor's local Z.
// ---------------------------------------------------------------------------
const personTex = new THREE.TextureLoader().load("./person%20model/base_color.png");
personTex.colorSpace = THREE.SRGBColorSpace;
personTex.flipY = false; // glTF UV convention

// Unlit head material. uProgress (0 → 1) drives a directional "paint" reveal: a
// gradient sweeps a wet front across the head along uAppearDir, and simplex noise
// (stretched along the stroke, so it streaks like bristles) breaks that front into
// a ragged brushy edge instead of texels popping in place. Center/radius come from
// the mesh bounding sphere so the sweep spans the model regardless of its units.
function makeHeadMaterial(map) {
  // transparent so the feathered reveal edge can fade in via alpha; once fully
  // painted (uProgress=1) alpha is 1 everywhere, so it renders opaque.
  const mat = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, transparent: true });
  const u = {
    uProgress: { value: 0 },
    uAppearScale: { value: params.appearNoiseScale },              // brush-streak grain
    uAppearSoft: { value: params.appearEdgeSoft },                 // wet-edge feather
    uAppearJitter: { value: params.appearJitter },                 // how ragged the front is
    uAppearDir: { value: new THREE.Vector3(...APPEAR_DIRS[params.appearDir]) }, // stroke travel
    uCenter: { value: new THREE.Vector3() },                       // set from bounding sphere
    uRadius: { value: 1 },                                         // set from bounding sphere
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader =
      "varying vec3 vObjPos;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n  vObjPos = position;"
      );
    shader.fragmentShader =
      "uniform float uProgress;\nuniform float uAppearScale;\nuniform float uAppearSoft;\n" +
      "uniform float uAppearJitter;\nuniform float uRadius;\nuniform vec3 uAppearDir;\nuniform vec3 uCenter;\n" +
      "varying vec3 vObjPos;\n" +
      NOISE_GLSL +
      shader.fragmentShader.replace(
        "#include <map_fragment>",
        /* glsl */`#include <map_fragment>
        vec3 _rel = vObjPos - uCenter;
        // 0..1 position along the stroke direction across the model
        float _g = dot(_rel, uAppearDir) / (2.0 * uRadius) + 0.5;
        // noise sampled with its component along the stroke compressed → streaks
        // elongate in the direction of travel, reading as bristle marks.
        vec3 _np = _rel * uAppearScale;
        _np -= uAppearDir * dot(_np, uAppearDir) * 0.7;
        float _field = _g + snoise(_np) * uAppearJitter; // ragged wet front
        // sweep the reveal threshold from before the front to past it as progress runs
        float _t = mix(-uAppearJitter - 0.05, 1.0 + uAppearJitter + 0.05, uProgress);
        float _a = 1.0 - smoothstep(_t - uAppearSoft, _t + uAppearSoft, _field);
        if (_a <= 0.001) discard;      // not yet painted in
        diffuseColor.a *= _a;`
      );
  };
  mat.userData.progressUniform = u.uProgress;
  mat.userData.appearUniforms = u;
  return mat;
}

// Push live appear-noise params into every head material's uniforms.
function applyAppearNoise() {
  for (const m of headMaterials) {
    const u = m.userData.appearUniforms;
    if (!u) continue;
    u.uAppearScale.value = params.appearNoiseScale;
    u.uAppearSoft.value = params.appearEdgeSoft;
    u.uAppearJitter.value = params.appearJitter;
    u.uAppearDir.value.set(...APPEAR_DIRS[params.appearDir]);
  }
}

// Restart the head paint-in reveal from scratch (GUI button).
function replayHeadAppear() {
  head.visible = true;
  paintProgress = 0;
  for (const m of headMaterials) m.userData.progressUniform.value = 0;
  headReplay = true;
}

head = new THREE.Group();
head.position.set(-2.909, -2.230, -6.550);   // baked from the edit gizmo
head.rotation.set(0.032, 0.280, -0.005);
head.scale.setScalar(params.headScale);
head.visible = false;
scene.add(head);

// Drag gizmo for hand-placing the person model. Hidden until "edit" is toggled.
let headFolder = null; // GUI folder, wired below; refreshed as the gizmo drags
const headGizmo = new TransformControls(camera, renderer.domElement);
headGizmo.attach(head);
headGizmo.setMode(headEdit.mode);
headGizmo.enabled = false;
headGizmo.visible = false;
scene.add(headGizmo);
// Mirror live drag changes back into the numeric GUI fields.
headGizmo.addEventListener("objectChange", () => {
  if (headFolder) headFolder.controllers.forEach((c) => c.updateDisplay());
});

function setHeadEdit(on) {
  headEdit.show = on;
  headGizmo.enabled = on;
  headGizmo.visible = on;
  if (on) {
    head.visible = true; // reveal fully so it can be positioned
    for (const m of headMaterials) m.userData.progressUniform.value = 1;
  }
}

function logHeadTransform() {
  const p = head.position, r = head.rotation, s = head.scale;
  console.log(
    `head.position.set(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)});\n` +
    `head.rotation.set(${r.x.toFixed(3)}, ${r.y.toFixed(3)}, ${r.z.toFixed(3)});\n` +
    `head.scale.set(${s.x.toFixed(3)}, ${s.y.toFixed(3)}, ${s.z.toFixed(3)});`
  );
}

loader.load("./person%20model/person.glb", (gltf) => {
  const model = gltf.scene;
  model.traverse((o) => {
    if (o.isMesh) {
      o.material = makeHeadMaterial(personTex); // unlit + paint-in
      headMaterials.push(o.material);
      // feed the reveal sweep the mesh extent so the gradient spans the model
      o.geometry.computeBoundingSphere();
      const bs = o.geometry.boundingSphere;
      const u = o.material.userData.appearUniforms;
      u.uCenter.value.copy(bs.center);
      u.uRadius.value = bs.radius;
    }
    if (o.name && o.name.toLowerCase() === "floweranchor") flowerAnchor = o;
  });
  head.add(model);
}, undefined, (err) => console.error("Failed to load person.glb:", err));

// ---------------------------------------------------------------------------
// Interaction — raycasting for hover/select
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const mouseNDC = new THREE.Vector2();
const popup = document.getElementById("popup");
const poemEl = document.getElementById("poem");
const bgText = document.getElementById("bg-text");

// Hover popup follow behaviour.
//   POPUP_FOLLOW — 0..1 easing per frame toward the cursor. Lower = laggier/smoother, higher = snappier.
//   (Vertical offset lives in CSS: --popup-offset-y)
const POPUP_FOLLOW = 0.15;
let popupX = 0, popupY = 0;       // eased position
let popupTargetX = 0, popupTargetY = 0; // cursor target

// ---------------------------------------------------------------------------
// Landing headline — cascade-in + magnetic mouse-avoidance per character
// ---------------------------------------------------------------------------
const CHAR_FX = {
  enabled: true,      // master toggle for the mouse-avoidance behaviour
  radius: 130,        // px — how close the cursor must be before a char reacts
  push: 12,           // px — max displacement a char is pushed away from cursor
  stiffness: 0.07,    // spring pull back toward origin (0..1, higher = snappier)
  cascadeStep: 0.045, // s — delay added per character in the intro cascade
  bobAmp: 2,          // px — vertical bob height per character
  bobSpeed: 1.6,      // rad/s — bob oscillation speed
  bobStagger: 0.5,    // rad of phase offset added per character (the "wave")
};

// Split the headline into per-character spans (preserving <br> and spaces),
// wiring up the staggered cascade delay as we go.
const chars = [];
(function splitBgText() {
  if (!bgText) return;
  const nodes = [...bgText.childNodes];
  bgText.textContent = "";
  let i = 0;
  for (const node of nodes) {
    if (node.nodeName === "BR") { bgText.appendChild(document.createElement("br")); continue; }
    for (const ch of node.textContent) {
      const outer = document.createElement("span");
      outer.className = ch === " " ? "char space" : "char";
      const inner = document.createElement("span");
      inner.className = "char-inner";
      inner.textContent = ch;
      inner.style.setProperty("--char-delay", (i * CHAR_FX.cascadeStep).toFixed(3) + "s");
      outer.appendChild(inner);
      bgText.appendChild(outer);
      chars.push({ el: outer, dx: 0, dy: 0, phase: i * CHAR_FX.bobStagger });
      i++;
    }
  }
})();

// Magnetic avoidance loop: each char is pushed away from the cursor when close,
// then spring-pulled back to its layout origin every frame. Origins are read
// from offsetLeft/Top so self-transforms never contaminate the measurement.
let charMouseX = -9999, charMouseY = -9999;
// Toggle the avoidance on/off with the "T" key (chars still animate back to rest
// when disabled). Also exposed as window.CHAR_FX for live tweaking in the console.
window.CHAR_FX = CHAR_FX;
window.addEventListener("keydown", (e) => {
  if (e.key === "t" || e.key === "T") CHAR_FX.enabled = !CHAR_FX.enabled;
});
(function charFxLoop() {
  requestAnimationFrame(charFxLoop);
  if (!bgText || bgText.classList.contains("faded")) return;
  const base = bgText.getBoundingClientRect();
  const active = CHAR_FX.enabled;
  const now = performance.now() / 1000;
  for (const c of chars) {
    // avoidance target — sprung toward smoothly, so pushes ease in and out
    let tx = 0, ty = 0;
    if (active) {
      const cx = base.left + c.el.offsetLeft + c.el.offsetWidth / 2;
      const cy = base.top + c.el.offsetTop + c.el.offsetHeight / 2;
      const vx = cx - charMouseX, vy = cy - charMouseY;
      const dist = Math.hypot(vx, vy);
      if (dist < CHAR_FX.radius && dist > 0.001) {
        // smoothstep falloff so the push eases in/out instead of a linear ramp
        const t = 1 - dist / CHAR_FX.radius;
        const force = t * t * (3 - 2 * t) * CHAR_FX.push;
        tx = (vx / dist) * force;
        ty = (vy / dist) * force;
      }
    }
    c.dx += (tx - c.dx) * CHAR_FX.stiffness;
    c.dy += (ty - c.dy) * CHAR_FX.stiffness;
    // staggered vertical bob — same wave for every char, phase-shifted; added
    // on top of the sprung avoidance so it keeps its full amplitude
    const bob = Math.sin(now * CHAR_FX.bobSpeed + c.phase) * CHAR_FX.bobAmp;
    c.el.style.transform = `translate(${c.dx.toFixed(2)}px, ${(c.dy + bob).toFixed(2)}px)`;
  }
})();

let mouseX = 0, mouseY = 0;
window.addEventListener("pointermove", (e) => {
  mouseX = e.clientX; mouseY = e.clientY;
  charMouseX = e.clientX; charMouseY = e.clientY;
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  mouseNDC.set(pointer.x, pointer.y);
  popupTargetX = e.clientX;
  popupTargetY = e.clientY;
});

function flowerUnderPointer() {
  raycaster.setFromCamera(pointer, camera);
  for (const f of flowers) {
    const hits = raycaster.intersectObject(f.group, true);
    if (hits.length) return f;
  }
  return null;
}

window.addEventListener("pointermove", () => {
  if (phase !== PHASE.CHOOSING || headEdit.show) return;
  const f = flowerUnderPointer();
  hovered = f;
  if (f) {
    popup.textContent = POPUP_TEXT[f.index] || "";
    popup.classList.add("visible");
  } else {
    popup.classList.remove("visible");
  }
});

window.addEventListener("pointerdown", () => {
  if (phase !== PHASE.CHOOSING || headEdit.show) return;
  const f = flowerUnderPointer();
  if (!f) return;
  selected = f;
  buildPoem(f.index); // swap in the poem matching the chosen flower
  phase = PHASE.TRANSITION;
  popup.classList.remove("visible");
  head.visible = true;
  headRestQuat.copy(head.quaternion); // capture rest pose now so mouse-look can start immediately
  paintProgress = 0;
  flowerSnapT = 0;
  snapCaptured = false;
  bgText?.classList.add("faded"); // fade the landing headline out
});

// Scroll-reveal for the poem. Lines are built dynamically per selected flower
// (see buildPoem), then split + observed here.
const poemInner = poemEl.querySelector(".poem-inner");

// Split a poem line word -> character, then group the words into VISUAL rows and
// wrap each row in its own .p-row. Each word is an atomic inline-block (.p-word,
// nowrap) so it can never break mid-word — only the spaces between words are wrap
// points. The per-char running index drives the left-to-right darkening (via
// --poem-sweep-step in CSS); the per-row index drives the staggered slide, so a
// wrapped sentence no longer shifts as one rigid block — each line-break slides in
// on its own. Original text is stashed on dataset.text so a re-split is possible.
function splitPoemLine(line) {
  // Preserve explicit <br> breaks as a "\n" token so an author-forced line break
  // survives the split (textContent would silently drop the tag). The newline is
  // not itself darkened — it only forces the row grouping below to start a new row.
  if (line.dataset.text == null) {
    line.dataset.text = line.innerHTML.replace(/<br\s*\/?>/gi, "\n");
  }
  const words = line.dataset.text.split(/[ ]+|(\n)/).filter((w) => w != null && w !== "");
  line.textContent = "";
  const wordEls = [];
  let idx = 0;
  words.forEach((word) => {
    if (word === "\n") {
      // A forced break: emit a real <br> so the word after it measures onto a new
      // row (offsetTop differs), which the grouping pass below turns into a .p-row.
      line.appendChild(document.createElement("br"));
      return;
    }
    const wordEl = document.createElement("span");
    wordEl.className = "p-word";
    wordEl._first = idx; // char index of this word's first glyph
    for (const ch of word) {
      const span = document.createElement("span");
      span.className = "p-char";
      span.textContent = ch;
      span.style.setProperty("--poem-char-index", idx);
      wordEl.appendChild(span);
      idx++;
    }
    wordEl._last = idx - 1; // char index of this word's last glyph
    line.appendChild(wordEl);
    line.appendChild(document.createTextNode(" ")); // measure wrapping with real gaps
    wordEls.push(wordEl);
    idx++; // the gap keeps the darkening sweep evenly paced between words
  });

  // Group consecutive words that share a vertical position into one visual row,
  // then re-wrap each row so the slide can target it individually.
  const rows = [];
  let lastTop = null;
  for (const wEl of wordEls) {
    if (wEl.offsetTop !== lastTop) { rows.push([]); lastTop = wEl.offsetTop; }
    rows[rows.length - 1].push(wEl);
  }
  line.textContent = "";
  rows.forEach((row) => {
    const rowEl = document.createElement("span");
    rowEl.className = "p-row";
    // First/last char index of this row — CSS derives the slide's start delay and
    // duration from these so the slide spans exactly the darkening of this row.
    rowEl.style.setProperty("--poem-row-first", row[0]._first);
    rowEl.style.setProperty("--poem-row-last", row[row.length - 1]._last);
    row.forEach((wEl, wi) => {
      rowEl.appendChild(wEl);
      if (wi < row.length - 1) rowEl.appendChild(document.createTextNode(" "));
    });
    line.appendChild(rowEl);
  });
}

// Reveal a line only as it crosses the vertical centre of the screen. The
// negative top/bottom rootMargin shrinks the observer's viewport to a thin band
// at the panel's middle, so lines light up one-by-one as you scroll them through
// centre — nothing pre-reveals on open except the first line, which is parked
// there by the panel's top padding (see .poem in styles.css).
const io = new IntersectionObserver((entries) => {
  entries.forEach((en) => { if (en.isIntersecting) en.target.classList.add("revealed"); });
}, { root: poemEl, rootMargin: "-48% 0px -48% 0px", threshold: 0 });

// Build the chosen flower's poem into #poem, then split each line (per-char
// darkening + row grouping) and wire the scroll-reveal observer. Row grouping
// depends on final wrapping, so this is gated on the webfonts being ready —
// fallback-font metrics wrap differently and would mis-group the rows. Selection
// happens long after load, so document.fonts.ready is already resolved in practice.
function buildPoem(index) {
  const poem = POEMS[index] || POEMS[0];
  document.fonts.ready.then(() => {
    poemInner.innerHTML = "";
    poem.lines.forEach((text) => {
      const p = document.createElement("p");
      p.className = "line";
      p.textContent = text;
      poemInner.appendChild(p);
    });
    const sig = document.createElement("p");
    sig.className = "signature";
    sig.innerHTML = poem.signature;
    poemInner.appendChild(sig);

    const lines = [...poemInner.querySelectorAll(".line, .signature")];
    lines.forEach(splitPoemLine);
    lines.forEach((l) => io.observe(l));
  });
}

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

// Spin composes on top of each flower's base orientation (homeQuat) so its
// layout pose is preserved. Fly-in tumbles about the screen normal (world Z);
// blooming twirls about the flower's own stem axis (local Y).
const FLYIN_AXIS = new THREE.Vector3(0, 0, 1);
const BLOOM_AXIS = new THREE.Vector3(0, 1, 0);
const _spinQuat = new THREE.Quaternion();

// Portrait mouse-look: the head's orientation the instant the portrait begins,
// plus scratch quats for composing the soft mouse-driven rotation on top of it.
const headRestQuat = new THREE.Quaternion();
// Person bob is applied as a delta on top of head.position.y so it never fights
// the edit gizmo / numeric fields (which write the *base* y). We remove last
// frame's offset before adding this frame's, keeping the base recoverable.
let personBobOffset = 0;
const _headLookEuler = new THREE.Euler();
const _headLookOffset = new THREE.Quaternion();
const _headLookTarget = new THREE.Quaternion();

// Timed flower-snap: 0→1 over the transition, driven at params.flowerSnapSpeed so
// it can share (or diverge from) the head's appear duration. The flower is parented
// to `head` (clean positive scale) rather than to flowerAnchor, whose baked -1,-1,-1
// mirror would inject a phantom 180° rotation on decompose. Start pose is captured
// once in head-local space; the anchor supplies only the target position.
let flowerSnapT = 0;
let snapCaptured = false;
const _snapStartPos = new THREE.Vector3();
const _snapStartQuat = new THREE.Quaternion();
let _snapStartScale = 1;
const _snapTargetPos = new THREE.Vector3();  // anchor position expressed in head-local space
const _snapTargetQuat = new THREE.Quaternion(); // anchor orientation in head-local space
const _tmpV = new THREE.Vector3();
const _tmpScale = new THREE.Vector3();
const _qTmp = new THREE.Quaternion();

// Parent the flower to `head` and capture its start pose (head-local) once, plus
// the target position (the anchor's spot, expressed in head-local space). Parenting
// to head — not flowerAnchor — sidesteps the anchor's baked -1,-1,-1 mirror, which
// would otherwise decompose into a phantom 180° flip.
function captureFlowerSnap() {
  if (!selected || snapCaptured) return;
  if (selected.group.parent !== head) head.attach(selected.group); // preserves world pose
  _snapStartPos.copy(selected.group.position);
  _snapStartQuat.copy(selected.group.quaternion);
  _snapStartScale = selected.group.scale.x;
  if (flowerAnchor) {
    // Position: the anchor spot in head-local space.
    flowerAnchor.getWorldPosition(_tmpV);
    head.worldToLocal(_tmpV);
    _snapTargetPos.copy(_tmpV);
    // Orientation: the anchor's aim as a *proper* rotation (getWorldQuaternion
    // drops the -1,-1,-1 mirror), re-expressed in head-local space. Because both
    // start and target now live in head's clean frame, the slerp is a shortest-arc
    // rotation — no mirror, no phantom 180° flip.
    flowerAnchor.getWorldQuaternion(_qTmp);
    head.getWorldQuaternion(_snapTargetQuat).invert().multiply(_qTmp);
  } else {
    _snapTargetPos.set(0, 0, 0);
    _snapTargetQuat.copy(_snapStartQuat); // no anchor → keep the click orientation
  }
  snapCaptured = true;
}

// Ease the flower from its captured start pose to the rest pose by factor e (0→1):
// the anchor's position + aim, at flowerAttachScale (divide out the head's world
// scale). Idempotent at e=1, so the portrait can keep calling it to hold the pose
// with flowerAttachScale live.
function applyFlowerSnap(e) {
  if (!selected || selected.group.parent !== head) return;
  selected.group.position.lerpVectors(_snapStartPos, _snapTargetPos, e);
  selected.group.quaternion.copy(_snapStartQuat).slerp(_snapTargetQuat, e);
  head.getWorldScale(_tmpScale);
  const target = params.flowerAttachScale / _tmpScale.x;
  selected.group.scale.setScalar(THREE.MathUtils.lerp(_snapStartScale, target, e));
}

function applySpin(f, angle, axis, worldSpace) {
  _spinQuat.setFromAxisAngle(axis, angle);
  if (worldSpace) f.group.quaternion.copy(_spinQuat).multiply(f.homeQuat); // world
  else f.group.quaternion.copy(f.homeQuat).multiply(_spinQuat);            // local
}

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.damp(current, target, lambda, dt);
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.getElapsedTime();

  // Smoothly ease the hover popup toward the cursor.
  popupX += (popupTargetX - popupX) * POPUP_FOLLOW;
  popupY += (popupTargetY - popupY) * POPUP_FOLLOW;
  popup.style.left = popupX + "px";
  popup.style.top = popupY + "px";

  // While editing, keep the head fully painted-in and visible regardless of phase.
  if (headEdit.show) {
    head.visible = true;
    for (const m of headMaterials) m.userData.progressUniform.value = 1;
  }

  // GUI "replay" — re-run the paint-in reveal in any phase (e.g. the portrait).
  if (headReplay && !headEdit.show) {
    paintProgress = Math.min(1, paintProgress + params.paintSpeed * dt);
    for (const m of headMaterials) m.userData.progressUniform.value = paintProgress;
    if (paintProgress >= 1) headReplay = false;
  }

  // --- Petal wobble: feed live uniforms to every flower material ---
  for (const f of flowers) {
    for (const u of f.noiseUniforms) {
      u.uTime.value = elapsed;
      u.uBloom.value = f.current;
      u.uNoiseFreq.value = params.noiseFreq;
      u.uNoiseAmpClosed.value = params.noiseClosed;
      u.uNoiseAmpOpen.value = params.noiseOpen;
    }
  }

  // --- Phase 0: intro fly-in along the path ---
  if (phase === PHASE.INTRO && introCurve) {
    introTime += dt;
    let allLanded = true;
    for (const f of flowers) {
      // Right flower (index 2) enters first, then center, then left.
      const order = 2 - f.index;
      const local = clamp01((introTime - order * INTRO_STAGGER) / INTRO_TRAVEL);
      const e = easeInOutCubic(local); // shared easing → position + spin stay in sync
      // Travel by arc-length fraction → even speed along the whole path.
      introCurve.getPointAt(e * introStopS[f.index], introTmp);
      f.group.position.copy(introTmp);
      f.group.scale.setScalar(flowerCfg[f.index].closedShrink); // stay closed while flying
      // Eased spin, decelerating to the resting pose on landing.
      applySpin(f, INTRO_SPIN_TURNS * Math.PI * 2 * (1 - e), FLYIN_AXIS, true);
      if (local < 1) allLanded = false;
    }
    if (allLanded) {
      for (const f of flowers) f.group.position.copy(f.homePos);
      phase = PHASE.CHOOSING;
      chooseStart = elapsed; // anchor the bob ramp-in to the moment they settle
    }
  }

  // --- Phase 1: bloom the hovered flower, close the rest ---
  if (phase === PHASE.CHOOSING) {
    for (const f of flowers) {
      f.target = (f === hovered) ? 0 : 1; // 0 = open
      f.current = damp(f.current, f.target, params.bloomSpeed, dt);
      setBloom(f, f.current);
      // closed (current→1) shrinks; open (current→0) grows to openScale
      const cfg = flowerCfg[f.index];
      const s = THREE.MathUtils.lerp(cfg.openScale, cfg.closedShrink, f.current);
      f.group.scale.setScalar(s);
      // Twirl about the stem while blooming; hold once fully open or closed.
      applySpin(f, params.bloomSpin * (1 - f.current), BLOOM_AXIS, false);
      // Gentle vertical bob around the home spot; phase-offset per flower so
      // they don't rise/fall in lockstep. Anchored to homePos.y so it can't drift.
      // Amplitude eases in from 0 over BOB_RAMP so they don't snap into motion.
      const ramp = easeInOutCubic(clamp01((elapsed - chooseStart) / BOB_RAMP));
      const bob = Math.sin(elapsed * params.bobSpeed + f.index * 2.1) * params.bobAmount * ramp;
      f.group.position.y = f.homePos.y + bob;
    }
  }

  // --- Phase 2: transition — head appears while the chosen flower snaps in ---
  if (phase === PHASE.TRANSITION) {
    // keep the selected flower open
    selected.current = damp(selected.current, 0, params.bloomSpeed, dt);
    setBloom(selected, selected.current);

    // Parent to head + capture the flower's start pose once, so the timed snap
    // eases from a fixed point toward the anchor spot.
    captureFlowerSnap();

    // shrink the unselected flowers away
    for (const f of flowers) {
      if (f === selected) continue;
      f.group.scale.setScalar(damp(f.group.scale.x, 0.0001, 8, dt));
    }

    // Drive head reveal and flower snap on their own timelines — same default
    // duration (matched speeds), both starting now so they run simultaneously.
    paintProgress = Math.min(1, paintProgress + params.paintSpeed * dt);
    for (const m of headMaterials) m.userData.progressUniform.value = paintProgress;
    flowerSnapT = Math.min(1, flowerSnapT + params.flowerSnapSpeed * dt);
    applyFlowerSnap(easeInOutCubic(flowerSnapT));

    if (paintProgress >= 0.999 && flowerSnapT >= 0.999) {
      phase = PHASE.PORTRAIT;
      poemEl.classList.add("active");
      poemEl.setAttribute("aria-hidden", "false");
    }
  }

  // --- Phase 3: hold the flower locked on the head; keep flowerAttachScale live. ---
  if (phase === PHASE.PORTRAIT && selected) {
    applyFlowerSnap(1);
  }

  // Soft mouse-look runs from the moment the head appears (transition) onward, so
  // the head can be rotated while it's still painting in — not only afterwards.
  if ((phase === PHASE.TRANSITION || phase === PHASE.PORTRAIT) && !headEdit.show) {
    _headLookEuler.set(
      (params.personInvertX ? -1 : 1) * mouseNDC.y * params.orbitAmountX,
      (params.personInvertY ? -1 : 1) * mouseNDC.x * params.orbitAmountY,
      0,
      "YXZ",
    );
    _headLookOffset.setFromEuler(_headLookEuler);
    _headLookTarget.copy(headRestQuat).multiply(_headLookOffset);
    head.quaternion.slerp(_headLookTarget, 1 - Math.exp(-4 * dt));
  }

  // Gentle vertical bob for the person. Disabled during edit so the gizmo/GUI
  // see a clean base y; the delta is peeled off first so the base is preserved.
  head.position.y -= personBobOffset;
  personBobOffset = headEdit.show
    ? 0
    : Math.sin(elapsed * params.personBobSpeed) * params.personBobAmount;
  head.position.y += personBobOffset;

  // --- Camera framing ---
  // The camera is fully static and always aims at a FIXED point. In the portrait,
  // the mouse rotates the head instead of orbiting the camera (see above), so the
  // head's world position maps directly to where it appears and stays put.
  camera.lookAt(0, 0.2, 0);

  // Ease the FOV toward the phase's target (before vs after a flower is chosen).
  const targetFov = (phase === PHASE.TRANSITION || phase === PHASE.PORTRAIT)
    ? params.fovAfter : params.fovBefore;
  if (Math.abs(camera.fov - targetFov) > 0.001) {
    camera.fov = damp(camera.fov, targetFov, 3, dt);
    camera.updateProjectionMatrix();
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// ---------------------------------------------------------------------------
// GUI + resize
// ---------------------------------------------------------------------------
// Note: GUI labels are left as the raw property names (no .name() overrides) so
// the control label always matches the params key it maps to.
const gui = new GUI({ title: "Flowerpot params" });
gui.add(params, "bloomSpeed", 1, 15, 0.1);
gui.add(params, "flowerSpacing", 0, 2.5, 0.01).onChange(applyFlowerSpacing);
gui.add(params, "flowerAttachScale", 0.05, 1, 0.01);
gui.add(params, "orbitAmount", 0, 0.5, 0.01);

// Per-flower scale (before/after bloom) + resting rotation. flowerCfg exists at
// load, so these controls bind directly; rotation needs applyFlowerRotation to
// refresh the flower's homeQuat, scale is read live each frame so it needs no hook.
const perFlower = gui.addFolder("per-flower");
const slotNames = ["left (1st)", "center (2nd)", "right (3rd)"];
flowerCfg.forEach((cfg, i) => {
  const sub = perFlower.addFolder(slotNames[i]);
  sub.add(cfg, "closedShrink", 0.3, 1.5, 0.01).name("scale before bloom");
  sub.add(cfg, "openScale", 0.3, 2.0, 0.01).name("scale after bloom");
  sub.add(cfg, "offsetY", -1.5, 1.5, 0.01).name("offset y").onChange(() => applyFlowerOffset(i));
  sub.add(cfg, "rx", -Math.PI, Math.PI, 0.01).name("rot x").onChange(() => applyFlowerRotation(i));
  sub.add(cfg, "ry", -Math.PI, Math.PI, 0.01).name("rot y").onChange(() => applyFlowerRotation(i));
  sub.add(cfg, "rz", -Math.PI, Math.PI, 0.01).name("rot z").onChange(() => applyFlowerRotation(i));
  sub.close();
});
perFlower.close();

const appear = gui.addFolder("person appear");
appear.add(params, "paintSpeed", 0.1, 2, 0.05).name("speed");
appear.add(params, "flowerSnapSpeed", 0.1, 2, 0.05).name("flower snap speed");
appear.add(params, "appearDir", Object.keys(APPEAR_DIRS)).name("stroke direction").onChange(applyAppearNoise);
appear.add(params, "appearNoiseScale", 0.5, 12, 0.1).name("brush grain").onChange(applyAppearNoise);
appear.add(params, "appearJitter", 0, 1, 0.01).name("edge raggedness").onChange(applyAppearNoise);
appear.add(params, "appearEdgeSoft", 0, 0.5, 0.005).name("edge softness").onChange(applyAppearNoise);
appear.add({ replay: replayHeadAppear }, "replay").name("▶ replay reveal");
appear.close();

const cam = gui.addFolder("camera");
cam.add(params, "fovBefore", 10, 90, 1).name("fov (before select)");
cam.add(params, "fovAfter", 10, 90, 1).name("fov (after select)");
cam.close();

// Person model placement — draggable gizmo + exact numeric fields.
headFolder = gui.addFolder("person model");
headFolder.add(headEdit, "show").name("edit (show + gizmo)").onChange(setHeadEdit);
headFolder.add(headEdit, "mode", ["translate", "rotate", "scale"]).name("gizmo mode")
  .onChange((m) => headGizmo.setMode(m));
headFolder.add(head.position, "x", -8, 8, 0.01).name("pos x").listen();
headFolder.add(head.position, "y", -8, 8, 0.01).name("pos y").listen();
headFolder.add(head.position, "z", -8, 8, 0.01).name("pos z").listen();
headFolder.add(head.rotation, "x", -Math.PI, Math.PI, 0.01).name("rot x").listen();
headFolder.add(head.rotation, "y", -Math.PI, Math.PI, 0.01).name("rot y").listen();
headFolder.add(head.rotation, "z", -Math.PI, Math.PI, 0.01).name("rot z").listen();
headFolder.add(params, "headScale", 0.05, 5, 0.01).name("scale (uniform)")
  .onChange((v) => head.scale.setScalar(v));
headFolder.add(params, "personBobAmount", 0, 0.4, 0.005).name("bob amount");
headFolder.add(params, "personBobSpeed", 0, 4, 0.05).name("bob speed");
headFolder.add(params, "orbitAmountX", 0, 1.2, 0.01).name("mouse range X (tilt)");
headFolder.add(params, "orbitAmountY", 0, 1.2, 0.01).name("mouse range Y (turn)");
headFolder.add(params, "personInvertX").name("invert mouse X");
headFolder.add(params, "personInvertY").name("invert mouse Y");
headFolder.add({ log: logHeadTransform }, "log").name("log transform → console");
headFolder.close();

const motion = gui.addFolder("petal motion");
motion.add(params, "noiseFreq", 0.2, 6, 0.05);
motion.add(params, "noiseClosed", 0, 0.2, 0.005);
motion.add(params, "noiseOpen", 0, 0.2, 0.005);
motion.add(params, "bloomSpin", 0, Math.PI, 0.05);
motion.add(params, "bobAmount", 0, 0.3, 0.005);
motion.add(params, "bobSpeed", 0, 4, 0.05);
motion.close();

function updateBackside() {
  backsideUniforms.uBacksideOn.value = params.backsideOverlay ? 1 : 0;
  backsideUniforms.uBacksideFront.value = params.backsideFace === "front" ? 1 : 0;
  backsideUniforms.uBacksideColor.value.set(params.backsideColor);
  backsideUniforms.uBacksideStrength.value = params.backsideStrength;
}
updateBackside();

const back = gui.addFolder("backside overlay");
back.add(params, "backsideOverlay").onChange(updateBackside);
back.add(params, "backsideFace", ["back", "front"]).onChange(updateBackside);
back.addColor(params, "backsideColor").onChange(updateBackside);
back.add(params, "backsideStrength", 0, 1, 0.02).onChange(updateBackside);
back.close();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
