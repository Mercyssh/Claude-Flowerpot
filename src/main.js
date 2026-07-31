import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import GUI from "lil-gui";

// ---------------------------------------------------------------------------
// Tunable visual parameters
// ---------------------------------------------------------------------------
const params = {
  enableDepthShading: true, // master toggle: AO/shading vs. flat painted look
  aoIntensity: 0.4,         // strength of shading darkening (0..1)
  shadingSoftness: 1.0,     // runtime light wrap when no AO map is present
  bloomSpeed: 2.5,          // how fast a flower blooms/closes on hover
  closedShrink: 0.7,        // scale of a fully-closed flower
  openScale: 0.8,           // scale of a fully-bloomed flower
  flowerSpacing: 1.27,      // x-distance of the outer flowers from center
  orbitAmount: 0.12,        // camera orbit magnitude in phase 2
  paintSpeed: 0.5,          // paint-in dissolve speed (progress/sec)
  noiseFreq: 2.0,           // spatial frequency of the petal-wobble noise
  noiseClosed: 0.03,        // wobble amplitude while a flower is closed
  noiseOpen: 0.06,          // wobble amplitude while a flower is bloomed
};

// Intro fly-in tuning
const INTRO_TRAVEL = 3.8;   // seconds each flower spends travelling the path
const INTRO_STAGGER = 0.55; // seconds between successive flowers entering

const POPUP_TEXT = [
  "for the quiet days",
  "for beginning again",
  "for you, mostly",
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
  const on = params.enableDepthShading;
  // Without AO maps, "depth shading" == directional lighting contrast.
  hemi.intensity = on ? THREE.MathUtils.lerp(1.4, 1.0, params.shadingSoftness) : 2.0;
  key.intensity = on ? 1.2 * (0.5 + params.aoIntensity) : 0.0;
  fill.intensity = on ? 0.4 : 0.0;
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
let head = null;
let headMaterial = null;
let flowerAnchor = new THREE.Object3D();

// ---------------------------------------------------------------------------
// Load the flower and clone it into 3 instances
// ---------------------------------------------------------------------------
const loader = new GLTFLoader();

// Hand-painted base color for the flowers
const flowerTex = new THREE.TextureLoader().load("./flower1_basecolor.png");
flowerTex.colorSpace = THREE.SRGBColorSpace;
flowerTex.flipY = false; // glTF UV convention

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

// Build a flower material that injects the noise wobble into the vertex stage.
// uBloom (1 = closed, 0 = open) selects between the closed/open amplitudes so
// each instance breathes independently. Returns the material; its live uniforms
// are stashed on userData.noiseUniforms for per-frame updates.
function makeFlowerMaterial() {
  const mat = new THREE.MeshBasicMaterial({
    map: flowerTex,
    transparent: true,
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
    Object.assign(shader.uniforms, u);
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

loader.load("./flower1.glb", (gltf) => {
  const base = gltf.scene;
  // Fan layout: baked from live tuning
  const layout = [
    { dir: -1, z: -0.4, rx: 0.681, ry: -0.15, rz: 0.35 },
    { dir: 0, z: 0, rx: 0.838, ry: 0, rz: 0 },
    { dir: 1, z: -0.4, rx: 0.75, ry: 0.15, rz: -0.35 },
  ];

  layout.forEach((L, i) => {
    const group = base.clone(true);
    // Clone morph arrays + materials so instances animate/texture independently
    const noiseUniforms = [];
    group.traverse((o) => {
      if (o.isMesh) {
        if (o.morphTargetInfluences) o.morphTargetInfluences = o.morphTargetInfluences.slice();
        o.material = makeFlowerMaterial(); // unlit + vertex wobble
        noiseUniforms.push(o.material.userData.noiseUniforms);
      }
    });
    group.position.set(L.dir * params.flowerSpacing, -1.2, L.z);
    group.rotation.set(L.rx, L.ry, L.rz);
    group.scale.setScalar(params.closedShrink); // start closed = shrunk

    const entry = {
      group,
      morphMeshes: collectMorphMeshes(group),
      target: 1,   // start closed
      current: 1,
      spacingDir: L.dir,
      homePos: group.position.clone(),
      homeScale: group.scale.clone(),
      noiseUniforms,
      index: i,
    };
    setBloom(entry, 1);
    scene.add(group);
    flowers.push(entry);
  });

  buildIntroCurve();
}, undefined, (err) => console.error("Failed to load flower1.glb:", err));

// ---------------------------------------------------------------------------
// Intro fly-in: the flowers stream down an S-shaped path (matching the mockup
// stem) and peel off one-by-one at their home positions. The path's tail runs
// through the three home points in left→center→right order, so each flower
// simply rides the curve up to its own stop parameter.
// ---------------------------------------------------------------------------
let introCurve = null;
let introTime = 0;
let introStopT = [];
let introStopS = [];
const introTmp = new THREE.Vector3();

function buildIntroCurve() {
  const hp = flowers.map((f) => f.homePos);
  introCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.8, 5.5, 0.0),   // enters off the top
    new THREE.Vector3(2.7, 3.2, 0.0),   // bulges right
    new THREE.Vector3(1.1, 1.3, 0.0),   // curls back toward center
    new THREE.Vector3(-2.5, 0.3, 0.0),  // sweeps far left
    new THREE.Vector3(-2.3, -0.9, -0.2),// drops down the left side
    hp[0].clone(),                       // left flower home
    hp[1].clone(),                       // center flower home
    hp[2].clone(),                       // right flower home
  ]);
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

// ---------------------------------------------------------------------------
// Placeholder head with a "paint-in" dissolve shader (swap for head.glb later)
// ---------------------------------------------------------------------------
function makePlaceholderHead() {
  const geo = new THREE.IcosahedronGeometry(1.1, 4);
  headMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uColor: { value: new THREE.Color(0xe9d9c5) },
      uLightDir: { value: new THREE.Vector3(2, 3, 4).normalize() },
    },
    vertexShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uProgress;
      uniform vec3 uColor;
      uniform vec3 uLightDir;
      varying vec3 vNormal;
      varying vec3 vPos;
      // cheap value noise for a brushy reveal edge
      float hash(vec3 p){ return fract(sin(dot(p, vec3(17.1,113.5,71.7)))*43758.5453); }
      float noise(vec3 p){
        vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        float n=mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
                        mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                        mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
        return n;
      }
      void main(){
        float n = noise(vPos * 3.0);
        float edge = uProgress * 1.2 - 0.1;
        if (n > edge) discard;                 // not yet painted
        float rim = smoothstep(edge - 0.08, edge, n);
        float light = max(dot(normalize(vNormal), uLightDir), 0.0) * 0.6 + 0.4;
        vec3 col = mix(uColor, vec3(0.42,0.31,0.22), rim * 0.6) * light;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, headMaterial);
  mesh.position.set(-2.2, 0.1, 0);   // left half of the page
  mesh.visible = false;
  scene.add(mesh);

  flowerAnchor.position.set(0.5, 0.9, 0.4); // "hair" spot, relative to head
  mesh.add(flowerAnchor);
  return mesh;
}
head = makePlaceholderHead();

// ---------------------------------------------------------------------------
// Interaction — raycasting for hover/select
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const mouseNDC = new THREE.Vector2();
const popup = document.getElementById("popup");
const poemEl = document.getElementById("poem");

let mouseX = 0, mouseY = 0;
window.addEventListener("pointermove", (e) => {
  mouseX = e.clientX; mouseY = e.clientY;
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  mouseNDC.set(pointer.x, pointer.y);
  popup.style.left = e.clientX + "px";
  popup.style.top = e.clientY + "px";
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
  if (phase !== PHASE.CHOOSING) return;
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
  if (phase !== PHASE.CHOOSING) return;
  const f = flowerUnderPointer();
  if (!f) return;
  selected = f;
  phase = PHASE.TRANSITION;
  popup.classList.remove("visible");
  head.visible = true;
});

// Scroll-reveal for the poem
const lines = [...document.querySelectorAll(".poem .line, .poem .signature")];
const io = new IntersectionObserver((entries) => {
  entries.forEach((en) => { if (en.isIntersecting) en.target.classList.add("revealed"); });
}, { root: poemEl, threshold: 0.6 });
lines.forEach((l) => io.observe(l));

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.damp(current, target, lambda, dt);
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.getElapsedTime();

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
      // Travel by arc-length fraction → even speed along the whole path.
      const s = easeInOutCubic(local) * introStopS[f.index];
      introCurve.getPointAt(s, introTmp);
      f.group.position.copy(introTmp);
      f.group.scale.setScalar(params.closedShrink); // stay closed while flying
      if (local < 1) allLanded = false;
    }
    if (allLanded) {
      for (const f of flowers) f.group.position.copy(f.homePos);
      phase = PHASE.CHOOSING;
    }
  }

  // --- Phase 1: bloom the hovered flower, close the rest ---
  if (phase === PHASE.CHOOSING) {
    for (const f of flowers) {
      f.target = (f === hovered) ? 0 : 1; // 0 = open
      f.current = damp(f.current, f.target, params.bloomSpeed, dt);
      setBloom(f, f.current);
      // closed (current→1) shrinks; open (current→0) grows to openScale
      const s = THREE.MathUtils.lerp(params.openScale, params.closedShrink, f.current);
      f.group.scale.setScalar(s);
    }
  }

  // --- Phase 2: transition ---
  if (phase === PHASE.TRANSITION) {
    // keep selected flower open
    setBloom(selected, damp(selected.current, 0, params.bloomSpeed, dt));
    selected.current = damp(selected.current, 0, params.bloomSpeed, dt);

    // scale unselected flowers to 0
    let othersGone = true;
    for (const f of flowers) {
      if (f === selected) continue;
      const s = damp(f.group.scale.x, 0.0001, 8, dt);
      f.group.scale.setScalar(s);
      if (s > 0.02) othersGone = false;
    }

    // paint in the head
    if (othersGone) {
      paintProgress = Math.min(1, paintProgress + params.paintSpeed * dt);
      headMaterial.uniforms.uProgress.value = paintProgress;
    }

    // move selected flower toward the hair anchor (world position)
    const targetPos = new THREE.Vector3();
    flowerAnchor.getWorldPosition(targetPos);
    selected.group.position.lerp(targetPos, 1 - Math.exp(-3 * dt));
    const s = damp(selected.group.scale.x, 0.5, 4, dt);
    selected.group.scale.setScalar(s);

    // slide camera to frame the head on the left
    camera.position.x = damp(camera.position.x, -1.1, 3, dt);

    if (paintProgress >= 0.999) {
      phase = PHASE.PORTRAIT;
      poemEl.classList.add("active");
      poemEl.setAttribute("aria-hidden", "false");
      // parent the flower to the head so it tracks orbit
      head.attach(selected.group);
    }
  }

  // --- Phase 3: soft camera orbit driven by mouse ---
  if (phase === PHASE.PORTRAIT) {
    const targetX = -1.1 + mouseNDC.x * params.orbitAmount;
    const targetY = 0.4 + mouseNDC.y * params.orbitAmount * 0.6;
    camera.position.x = damp(camera.position.x, targetX, 3, dt);
    camera.position.y = damp(camera.position.y, targetY, 3, dt);
    camera.lookAt(head.position);
  } else {
    camera.lookAt(0, 0.2, 0);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// ---------------------------------------------------------------------------
// GUI + resize
// ---------------------------------------------------------------------------
const gui = new GUI({ title: "Flowerpot params" });
gui.add(params, "enableDepthShading").name("depth shading").onChange(applyShadingParams);
gui.add(params, "bloomSpeed", 1, 15, 0.1).name("bloom speed");
gui.add(params, "flowerSpacing", 0, 2.5, 0.01).name("flower spacing").onChange(applyFlowerSpacing);
gui.add(params, "closedShrink", 0.5, 1, 0.01).name("closed shrink");
gui.add(params, "openScale", 0.8, 1.8, 0.01).name("bloom scale");
gui.add(params, "orbitAmount", 0, 0.5, 0.01).name("orbit amount");
gui.add(params, "paintSpeed", 0.1, 2, 0.05).name("paint speed");

const motion = gui.addFolder("petal motion");
motion.add(params, "noiseFreq", 0.2, 6, 0.05).name("wobble scale");
motion.add(params, "noiseClosed", 0, 0.2, 0.005).name("wobble (closed)");
motion.add(params, "noiseOpen", 0, 0.2, 0.005).name("wobble (bloomed)");

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
