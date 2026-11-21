// Cats Track – 3D site model (Plan › Site › 3D).
// A construction-site view of Haus 2: the building by section (A, B, C) and level, built up to where the
// plan says it is. Every task is a pin on the part of the building it works on, coloured by its state.
// The app (app.js) re-renders its HTML on every change; this module keeps ONE WebGL canvas alive and
// re-attaches it to the new #site3d element, so the camera stays where the user left it.

import * as THREE from "three";
import { OrbitControls } from "/app/vendor/OrbitControls.js";

// ------------------------------------------------------------------ dimensions (metres)
const SEC_W = 12; // section width along x
const DEPTH = 14; // building depth along z
const STOREY = 3; // storey height
const SLAB = 0.25;
const WALL = 0.3;
const LEVELS = ["Foundation", "Basement", "Ground", "Floor 1", "Floor 2", "Floor 3"];
// bottom of each level's walls (top of its floor slab); the foundation is the slab itself
const LEVEL_Y = { Foundation: -3.4, Basement: -3.0, Ground: 0, "Floor 1": STOREY, "Floor 2": 2 * STOREY, "Floor 3": 3 * STOREY };
const PIT = { x: 2.5, z: 2.5, depth: 3.4 }; // excavation margin around the building

export const CAT = {
  problem: { color: "#dc2626", label: "Problem · act today" },
  delay: { color: "#f59e0b", label: "Delayed" },
  blocked: { color: "#3f3f46", label: "Blocked" },
  progress: { color: "#2563eb", label: "In progress" },
  planned: { color: "#a1a1aa", label: "Planned" },
  done: { color: "#16a34a", label: "Done" },
};

// ------------------------------------------------------------------ materials
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });
const M = {
  concrete: mat("#d6d3d1"),
  slab: mat("#e7e5e4"),
  concreteFresh: mat("#cfcac4"),
  ghost: new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.18, depthWrite: false }),
  formwork: mat("#f2b33d"), // formwork panels are the yellow you see on every German site
  formworkBack: mat("#c98a1a"),
  rebar: new THREE.LineBasicMaterial({ color: "#7c3aed" }),
  earth: mat("#b7a48a"),
  earthDark: mat("#9c8a70"),
  pit: mat("#a8957a"),
  grass: mat("#e9ece4"),
  road: mat("#cfd2d6"),
  gravel: mat("#bdb6a9"),
  steel: mat("#f06a6a", { roughness: 0.6 }), // crane in the app's accent colour
  steelDark: mat("#3f3f46", { roughness: 0.6 }),
  container: mat("#ffffff"),
  containerEdge: mat("#9ca3af"),
  glass: mat("#93c5fd", { transparent: true, opacity: 0.55 }),
  wood: mat("#c8a46e"),
  scaffold: mat("#9ca3af", { roughness: 0.5, metalness: 0.3 }),
  plank: mat("#e2c9a0"),
  leaf: mat("#9cc79a"),
  trunk: mat("#7c5a3a"),
  vest: mat("#e8ff3a"),
  skin: mat("#e0b48f"),
  trousers: mat("#3f4a5a"),
  pick: new THREE.MeshBasicMaterial({ visible: false }),
  edge: new THREE.LineBasicMaterial({ color: "#a8a29e", transparent: true, opacity: 0.55 }),
  ghostEdge: new THREE.LineDashedMaterial({ color: "#78716c", dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.7 }),
  select: new THREE.LineBasicMaterial({ color: "#f06a6a" }),
};

// ------------------------------------------------------------------ module state
let renderer, scene, camera, controls, world, raf, tooltip, host;
let pins = []; // { mesh, halo, task, base }
let walkers = []; // animated people
let picks = []; // section pick volumes
let crane;
let lastKey = "";
let handlers = {};
let hovered = null;
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const HOME = { pos: new THREE.Vector3(44, 36, 56), target: new THREE.Vector3(4, 2, 3) };

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";

  scene = new THREE.Scene();
  scene.background = new THREE.Color("#ffffff");
  scene.fog = new THREE.Fog("#ffffff", 120, 220);

  camera = new THREE.PerspectiveCamera(35, 1, 0.5, 500);
  camera.position.copy(HOME.pos);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.06;
  controls.minDistance = 14;
  controls.maxDistance = 140;
  controls.screenSpacePanning = true;

  scene.add(new THREE.HemisphereLight("#ffffff", "#d9d4cc", 1.6));
  const sun = new THREE.DirectionalLight("#ffffff", 2.2);
  sun.position.set(-30, 50, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 140 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  tooltip = document.createElement("div");
  tooltip.style.cssText = "position:absolute;pointer-events:none;z-index:5;display:none;max-width:240px;padding:6px 9px;border-radius:8px;background:#1e1f21;color:#fff;font:12px/1.35 ui-sans-serif,system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.18)";

  const el = renderer.domElement;
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerleave", () => setHover(null));
  let down = null;
  el.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
  el.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; // a drag, not a click
    const hit = pick(e);
    if (hit?.pin) handlers.openTask?.(hit.pin.task.id);
    else if (hit?.section) handlers.selectSection?.(hit.section);
  });
  new ResizeObserver(resize).observe(el);
}

function resize() {
  if (!host) return;
  const w = host.clientWidth || 600;
  const h = host.clientHeight || 420;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------ picking + tooltip
function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hitPin = raycaster.intersectObjects(pins.filter((p) => p.mesh.visible).map((p) => p.mesh), false)[0];
  if (hitPin) return { pin: pins.find((p) => p.mesh === hitPin.object), x: e.clientX - r.left, y: e.clientY - r.top };
  const hitSec = raycaster.intersectObjects(picks, false)[0];
  if (hitSec) return { section: hitSec.object.userData.section, x: e.clientX - r.left, y: e.clientY - r.top };
  return null;
}
function onMove(e) {
  const hit = pick(e);
  setHover(hit?.pin || null, hit);
  renderer.domElement.style.cursor = hit ? "pointer" : "grab";
}
function setHover(p, hit) {
  if (hovered && hovered !== p) hovered.mesh.scale.setScalar(1);
  hovered = p;
  if (!p) return (tooltip.style.display = "none");
  p.mesh.scale.setScalar(1.25);
  const t = p.task;
  tooltip.innerHTML = `<b>${esc(t.label)}</b><br><span style="color:${CAT[t.cat].color === "#3f3f46" ? "#d4d4d8" : CAT[t.cat].color}">● ${CAT[t.cat].label}</span><br><span style="color:#d4d4d8">${esc(t.sub)}</span>`;
  tooltip.style.display = "block";
  const x = Math.min(hit.x + 14, (host?.clientWidth || 600) - 250);
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${Math.max(hit.y - 10, 4)}px`;
}
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ------------------------------------------------------------------ geometry helpers
function box(w, h, d, material, x, y, z, { edges = true, shadow = true, group = world, dashed = false } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = shadow && material !== M.ghost;
  m.receiveShadow = shadow;
  group.add(m);
  if (edges) {
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), dashed ? M.ghostEdge : M.edge);
    if (dashed) l.computeLineDistances();
    m.add(l);
  }
  return m;
}
function cyl(r, h, material, x, y, z, group = world, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  group.add(m);
  return m;
}
function label(text, x, y, z, { size = 1, color = "#1e1f21", bg = "rgba(255,255,255,.92)", border = "#d4d4d4", bold = true, group = world } = {}) {
  const c = document.createElement("canvas");
  const px = 48;
  const g = c.getContext("2d");
  g.font = `${bold ? 600 : 400} ${px}px ui-sans-serif, system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 36;
  c.width = w;
  c.height = px + 28;
  g.font = `${bold ? 600 : 400} ${px}px ui-sans-serif, system-ui, sans-serif`;
  if (bg) {
    g.fillStyle = bg;
    g.strokeStyle = border;
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(2, 2, w - 4, c.height - 4, 12);
    g.fill();
    if (border) g.stroke();
  }
  g.fillStyle = color;
  g.textBaseline = "middle";
  g.fillText(text, 18, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.renderOrder = 10;
  const h = 1.3 * size;
  s.scale.set((h * c.width) / c.height, h, 1);
  s.position.set(x, y, z);
  group.add(s);
  return s;
}

/** A wall along x (dir "x") or z (dir "z") with window openings as gaps. */
function wallWithWindows(dir, a0, a1, fixed, y0, h, material, windows, group) {
  const len = a1 - a0;
  const n = windows;
  const sill = 0.9;
  const winH = 1.4;
  const segs = [];
  if (!n) segs.push([a0, a1, y0, h]);
  else {
    const winW = Math.min(1.6, len / (n * 2.2));
    const step = len / n;
    let cur = a0;
    for (let i = 0; i < n; i++) {
      const c = a0 + step * (i + 0.5);
      segs.push([cur, c - winW / 2, y0, h]); // pier
      segs.push([c - winW / 2, c + winW / 2, y0, sill]); // below the window
      segs.push([c - winW / 2, c + winW / 2, y0 + sill + winH, h - sill - winH]); // lintel
      cur = c + winW / 2;
    }
    segs.push([cur, a1, y0, h]);
  }
  segs.forEach(([s0, s1, yb, hh]) => {
    const l = s1 - s0;
    if (l <= 0.01 || hh <= 0.01) return;
    const mid = (s0 + s1) / 2;
    if (dir === "x") box(l, hh, WALL, material, mid, yb + hh / 2, fixed, { group });
    else box(WALL, hh, l, material, fixed, yb + hh / 2, mid, { group });
  });
}

/** A rebar cage: a grid of thin lines in a vertical (wall) or horizontal (slab) plane. */
function rebarGrid(group, { x0, x1, y0, y1, z0, z1, step = 0.45 }) {
  const pts = [];
  const flat = Math.abs(y1 - y0) < 0.01;
  if (flat) {
    for (let x = x0; x <= x1 + 1e-6; x += step) pts.push(x, y0, z0, x, y0, z1);
    for (let z = z0; z <= z1 + 1e-6; z += step) pts.push(x0, y0, z, x1, y0, z);
  } else if (Math.abs(z1 - z0) < 0.01) {
    for (let x = x0; x <= x1 + 1e-6; x += step) pts.push(x, y0, z0, x, y1, z0);
    for (let y = y0; y <= y1 + 1e-6; y += step) pts.push(x0, y, z0, x1, y, z0);
  } else {
    for (let z = z0; z <= z1 + 1e-6; z += step) pts.push(x0, y0, z, x0, y1, z);
    for (let y = y0; y <= y1 + 1e-6; y += step) pts.push(x0, y, z0, x0, y, z1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  group.add(new THREE.LineSegments(g, M.rebar));
}

// ------------------------------------------------------------------ the building
const kindOf = (name) => {
  const s = String(name).toLowerCase();
  const op = /excavat|aushub/.test(s) ? "excavation" : /backfill|verfüll/.test(s) ? "backfill" : /gravel|road|schotter/.test(s) ? "road"
    : /formwork|schal/.test(s) ? "formwork" : /rebar|beweh/.test(s) ? "rebar" : /pour|concrete|betonage|beton/.test(s) ? "pour" : "other";
  const part = /slab|decke/.test(s) ? "slab" : /wall|wand|wände/.test(s) ? "walls" : /foundation|fundament/.test(s) ? "foundation" : "other";
  return { op, part };
};
const STRUCT = ["formwork", "rebar", "pour"];

/** How far one element (walls / slab / foundation) has got, from its formwork → rebar → pour tasks. */
function elementStage(tasks) {
  const by = (op) => tasks.find((t) => kindOf(t.name).op === op);
  const f = by("formwork"), r = by("rebar"), p = by("pour");
  const st = (t) => t?.status;
  if (!f && !r && !p) return "none";
  if (st(p) === "done") return "concrete";
  if (st(p) === "in-progress") return "pouring";
  if (st(r) === "done" || st(r) === "in-progress") return "rebar";
  if (st(f) === "done") return "formwork";
  if (st(f) === "in-progress") return "formwork-partial";
  return "planned";
}

function sectionX(i, n) {
  return (i - (n - 1) / 2) * SEC_W;
}

function buildSection(sec, i, n, tasks, model, floorOf) {
  const g = new THREE.Group();
  world.add(g);
  const cx = sectionX(i, n);
  const x0 = cx - SEC_W / 2, x1 = cx + SEC_W / 2, z0 = -DEPTH / 2, z1 = DEPTH / 2;
  const isWestEnd = i === 0, isEastEnd = i === n - 1;
  const mine = tasks.filter((t) => t.section === sec);
  const struct = mine.filter((t) => STRUCT.includes(kindOf(t.name).op));
  const levelIdx = (l) => LEVELS.indexOf(l);
  const top = Math.max(-1, ...mine.map((t) => levelIdx(t.level)));
  const groups = {}; // level → floor group (for the floor filter)

  for (let li = 0; li <= Math.max(top, 0); li++) {
    const lvl = LEVELS[li];
    const lg = new THREE.Group();
    lg.userData.level = lvl;
    groups[lvl] = lg;
    g.add(lg);
    const lt = struct.filter((t) => t.level === lvl);
    const y0 = LEVEL_Y[lvl];

    if (lvl === "Foundation") {
      const stage = lt.length ? elementStage(lt) : "concrete";
      const y = LEVEL_Y.Foundation;
      if (stage === "concrete") box(SEC_W, 0.4, DEPTH, M.concrete, cx, y + 0.2, 0, { group: lg });
      else if (stage === "pouring") box(SEC_W, 0.25, DEPTH, M.concreteFresh, cx, y + 0.12, 0, { group: lg });
      if (["formwork", "formwork-partial", "rebar", "pouring"].includes(stage)) {
        const full = stage !== "formwork-partial";
        box(full ? SEC_W : SEC_W / 2, 0.5, 0.06, M.formwork, full ? cx : x0 + SEC_W / 4, y + 0.25, z1, { group: lg });
        box(full ? SEC_W : SEC_W / 2, 0.5, 0.06, M.formwork, full ? cx : x0 + SEC_W / 4, y + 0.25, z0, { group: lg });
        box(0.06, 0.5, DEPTH, M.formwork, x0, y + 0.25, 0, { group: lg });
        if (full) box(0.06, 0.5, DEPTH, M.formwork, x1, y + 0.25, 0, { group: lg });
      }
      if (stage === "rebar" || stage === "pouring") rebarGrid(lg, { x0: x0 + 0.3, x1: x1 - 0.3, y0: y + 0.3, y1: y + 0.3, z0: z0 + 0.3, z1: z1 - 0.3, step: 0.6 });
      if (stage === "planned" || stage === "formwork-partial") box(SEC_W, 0.4, DEPTH, M.ghost, cx, y + 0.2, 0, { group: lg, dashed: true, shadow: false });
      continue;
    }

    // walls of this level + the slab on top of it
    const wallT = lt.filter((t) => kindOf(t.name).part === "walls");
    const slabT = lt.filter((t) => kindOf(t.name).part === "slab");
    const done = !lt.length; // no structural work planned here = already built
    const wallStage = done ? "concrete" : wallT.length ? elementStage(wallT) : "concrete";
    const slabStage = done ? "concrete" : slabT.length ? elementStage(slabT) : wallStage === "concrete" ? "concrete" : "planned";
    const h = STOREY - SLAB;
    const windows = lvl === "Basement" ? 0 : 3;
    const sides = [
      ["x", x0, x1, z1, windows], // south
      ["x", x0, x1, z0, windows], // north
      ...(isWestEnd ? [["z", z0, z1, x0, lvl === "Basement" ? 0 : 2]] : []),
      ...(isEastEnd ? [["z", z0, z1, x1, lvl === "Basement" ? 0 : 2]] : []),
    ];
    const inner = !isEastEnd ? [["z", z0 + 2, z1 - 2, x1 - 0.15, 0]] : []; // party wall to the next section

    const drawWalls = (stage) => {
      if (stage === "concrete" || stage === "pouring") {
        [...sides, ...inner].forEach(([d, a0, a1, f, w]) => wallWithWindows(d, a0, a1, f, y0, stage === "pouring" ? h * 0.55 : h, stage === "pouring" ? M.concreteFresh : M.concrete, w, lg));
      }
      if (["formwork", "formwork-partial", "rebar", "pouring"].includes(stage)) {
        // panels on both faces of each wall; partial = the first half of the run is set
        [...sides, ...inner].forEach(([d, a0, a1, f]) => {
          const end = stage === "formwork-partial" ? a0 + (a1 - a0) * 0.5 : a1;
          const len = end - a0, mid = (a0 + end) / 2;
          for (const off of [-0.32, 0.32]) {
            if (d === "x") box(len, h, 0.08, off < 0 ? M.formworkBack : M.formwork, mid, y0 + h / 2, f + off, { group: lg });
            else box(0.08, h, len, off < 0 ? M.formworkBack : M.formwork, f + off, y0 + h / 2, mid, { group: lg });
          }
        });
      }
      if (stage === "rebar") {
        [...sides, ...inner].forEach(([d, a0, a1, f]) =>
          rebarGrid(lg, d === "x" ? { x0: a0 + 0.2, x1: a1 - 0.2, y0: y0 + 0.1, y1: y0 + h - 0.1, z0: f, z1: f } : { x0: f, x1: f, y0: y0 + 0.1, y1: y0 + h - 0.1, z0: a0 + 0.2, z1: a1 - 0.2 }));
      }
      if (stage === "planned" || stage === "formwork-partial") {
        [...sides, ...inner].forEach(([d, a0, a1, f]) => {
          const len = a1 - a0, mid = (a0 + a1) / 2;
          if (d === "x") box(len, h, WALL, M.ghost, mid, y0 + h / 2, f, { group: lg, dashed: true, shadow: false });
          else box(WALL, h, len, M.ghost, f, y0 + h / 2, mid, { group: lg, dashed: true, shadow: false });
        });
      }
    };
    drawWalls(wallStage);
    // stair core so finished storeys don't look empty
    if (wallStage === "concrete") box(2.6, h, 3.2, M.concrete, cx + 3, y0 + h / 2, -3.6, { group: lg });

    const sy = y0 + h; // underside of the slab on top
    const opened = model.floor === lvl; // the chosen floor is shown without its ceiling, so you can look in
    if (opened && slabStage === "concrete") box(SEC_W, SLAB, DEPTH, M.ghost, cx, sy + SLAB / 2, 0, { group: lg, dashed: true, shadow: false });
    else if (slabStage === "concrete") box(SEC_W, SLAB, DEPTH, M.slab, cx, sy + SLAB / 2, 0, { group: lg });
    else if (slabStage === "pouring") box(SEC_W, SLAB * 0.7, DEPTH, M.concreteFresh, cx, sy + SLAB * 0.35, 0, { group: lg });
    if (["formwork", "formwork-partial", "rebar", "pouring"].includes(slabStage)) {
      const full = slabStage !== "formwork-partial";
      const w = full ? SEC_W : SEC_W / 2;
      box(w, 0.08, DEPTH, M.formwork, full ? cx : x0 + w / 2, sy - 0.04, 0, { group: lg });
      for (let px = x0 + 1; px < x0 + w; px += 2) for (let pz = z0 + 1.5; pz < z1; pz += 3) cyl(0.05, h - 0.1, M.scaffold, px, y0 + (h - 0.1) / 2, pz, lg, 6);
    }
    if (slabStage === "rebar" || slabStage === "pouring") rebarGrid(lg, { x0: x0 + 0.3, x1: x1 - 0.3, y0: sy + 0.08, y1: sy + 0.08, z0: z0 + 0.3, z1: z1 - 0.3, step: 0.5 });
    if (slabStage === "planned" || slabStage === "formwork-partial") box(SEC_W, SLAB, DEPTH, M.ghost, cx, sy + SLAB / 2, 0, { group: lg, dashed: true, shadow: false });

    // scaffolding along the south face of the storey that is being built
    if (wallStage !== "concrete" || slabStage !== "concrete") scaffold(lg, x0, x1, z1 + 1.1, y0, STOREY);
  }

  // pick volume for the whole section (click = open its task list below the model)
  const hTop = top < 0 ? 0.5 : LEVEL_Y[LEVELS[top]] + STOREY;
  const yBot = LEVEL_Y.Foundation;
  const pickBox = new THREE.Mesh(new THREE.BoxGeometry(SEC_W, hTop - yBot, DEPTH), M.pick);
  pickBox.position.set(cx, (hTop + yBot) / 2, 0);
  pickBox.userData.section = sec;
  world.add(pickBox);
  picks.push(pickBox);
  if (model.selected === sec) {
    const sel = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(SEC_W + 0.6, hTop - yBot + 0.6, DEPTH + 0.6)), M.select);
    sel.position.copy(pickBox.position);
    world.add(sel);
  }

  // section letter on the ground in front of the building
  label(`Section ${sec}`, cx, 1.2, z1 + PIT.z + 3, { size: 1.1 });

  // floor filter: hide what is above the chosen level, fade what is below
  const fi = model.floor === "all" ? 99 : levelIdx(model.floor);
  Object.entries(groups).forEach(([lvl, lg]) => {
    const k = levelIdx(lvl);
    if (k > fi) lg.visible = false;
    else if (k < fi && fi !== 99) fade(lg, 0.28);
  });
  floorOf[sec] = groups;
  return { cx, top };
}

function fade(group, opacity) {
  group.traverse((o) => {
    if (!o.material || o.material === M.pick) return;
    const m = o.material.clone();
    m.transparent = true;
    m.opacity = (m.opacity ?? 1) * opacity;
    m.depthWrite = false;
    o.material = m;
    o.castShadow = false;
  });
}

function scaffold(group, x0, x1, z, y0, h) {
  const top = y0 + h + 1;
  for (let x = x0; x <= x1 + 0.01; x += 2.4) {
    cyl(0.04, top - y0 + 0.2, M.scaffold, x, (top + y0) / 2, z - 0.35, group, 5);
    cyl(0.04, top - y0 + 0.2, M.scaffold, x, (top + y0) / 2, z + 0.35, group, 5);
  }
  for (let y = y0 + 1; y <= top; y += 1.5) {
    box(x1 - x0, 0.04, 0.6, M.plank, (x0 + x1) / 2, y, z, { group, edges: false });
    box(x1 - x0, 0.04, 0.04, M.scaffold, (x0 + x1) / 2, y + 1, z + 0.4, { group, edges: false, shadow: false });
  }
}

// ------------------------------------------------------------------ site: ground, pit, crane, facilities
function buildSite(n, model) {
  const bw = n * SEC_W;
  const hx = bw / 2 + PIT.x, hz = DEPTH / 2 + PIT.z; // pit half-size
  const G = 70; // site half-size
  const t = 0.6;
  // ground around the pit (four slabs leave the excavation open)
  const ground = (w, d, x, z) => box(w, t, d, M.grass, x, -t / 2, z, { edges: false });
  ground(2 * G, G - hz, 0, -(hz + (G - hz) / 2));
  ground(2 * G, G - hz, 0, hz + (G - hz) / 2);
  ground(G - hx, 2 * hz, -(hx + (G - hx) / 2), 0);
  ground(G - hx, 2 * hz, hx + (G - hx) / 2, 0);
  // pit walls and floor
  box(2 * hx, PIT.depth - t, 0.05, M.earthDark, 0, -t - (PIT.depth - t) / 2, -hz, { edges: false });
  box(2 * hx, PIT.depth - t, 0.05, M.earthDark, 0, -t - (PIT.depth - t) / 2, hz, { edges: false });
  box(0.05, PIT.depth - t, 2 * hz, M.earthDark, -hx, -t - (PIT.depth - t) / 2, 0, { edges: false });
  box(0.05, PIT.depth - t, 2 * hz, M.earthDark, hx, -t - (PIT.depth - t) / 2, 0, { edges: false });
  box(2 * hx, 0.1, 2 * hz, M.pit, 0, -PIT.depth - 0.05, 0, { edges: false });
  // pit edge rail
  const rail = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * hx + 0.4, 0.01, 2 * hz + 0.4)), new THREE.LineBasicMaterial({ color: "#f06a6a" }));
  rail.position.y = 0.9;
  world.add(rail);

  // street along the south, site road from the gate
  box(2 * G, 0.05, 9, M.road, 0, 0.03, hz + 22, { edges: false });
  const roadTask = model.tasks.find((x) => !x.section && kindOf(x.name).op === "road");
  const roadMat = !roadTask || roadTask.status === "done" ? M.gravel : roadTask.status === "in-progress" ? M.gravel : M.ghost;
  box(5, 0.06, 15, roadMat, hx - 6, 0.04, hz + 10, { edges: !!roadTask, dashed: roadTask && roadTask.status !== "done", shadow: false });
  label("Gate", hx - 6, 1.6, hz + 17.2, { size: 0.8, bold: false });
  // fence
  const fz = hz + 17, fx = hx + 18;
  const fencePts = [];
  for (const [ax, az, bx, bz] of [[-fx, -hz - 10, fx, -hz - 10], [fx, -hz - 10, fx, fz], [-fx, fz, hx - 9, fz], [hx - 3, fz, fx, fz], [-fx, -hz - 10, -fx, fz]]) {
    fencePts.push(ax, 0, az, bx, 0, bz, ax, 1.8, az, bx, 1.8, bz);
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute("position", new THREE.Float32BufferAttribute(fencePts, 3));
  world.add(new THREE.LineSegments(fg, new THREE.LineBasicMaterial({ color: "#9ca3af" })));

  // site office: two stacked containers + one beside
  const ox = hx + 9, oz = hz + 9;
  const cont = (x, y, z) => {
    box(6, 2.6, 2.4, M.container, x, y + 1.3, z);
    box(1.4, 0.9, 0.05, M.glass, x - 1.4, y + 1.6, z + 1.23, { edges: false });
    box(1.4, 0.9, 0.05, M.glass, x + 1.4, y + 1.6, z + 1.23, { edges: false });
  };
  cont(ox, 0, oz);
  cont(ox, 2.6, oz);
  cont(ox, 0, oz - 3);
  label("Site office", ox, 7.2, oz, { size: 0.8 });

  // storage yard: formwork stacks + rebar bundles
  const sx = -hx - 10, sz = hz + 8;
  box(9, 0.05, 6, M.gravel, sx, 0.03, sz, { edges: false });
  for (let k = 0; k < 3; k++) box(2.6, 0.9, 1.3, M.formwork, sx - 2.5, 0.45 + k * 0.92, sz - 1.4);
  for (let k = 0; k < 2; k++) box(2.6, 0.9, 1.3, M.formwork, sx - 2.5, 0.45 + k * 0.92, sz + 1.2);
  for (let k = 0; k < 5; k++) {
    const bar = cyl(0.25, 6, mat("#7c3aed"), sx + 2.2, 0.3 + (k % 2) * 0.45, sz - 2 + k * 0.8, world, 8);
    bar.rotation.z = Math.PI / 2;
    bar.rotation.y = Math.PI / 2;
  }
  label("Storage", sx, 3.6, sz, { size: 0.8 });

  // tower crane on the north side, jib sweeping slowly over the building
  crane = new THREE.Group();
  const cxp = SEC_W / 2, czp = -hz - 5;
  const mastH = 24;
  for (let y = 0; y < mastH; y += 2) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2, 1.6), new THREE.MeshStandardMaterial({ color: "#f06a6a", wireframe: true }));
    seg.position.set(cxp, y + 1, czp);
    world.add(seg);
  }
  cyl(0.15, mastH, M.steel, cxp, mastH / 2, czp);
  box(3.2, 0.6, 3.2, M.steelDark, cxp, 0.3, czp);
  crane.position.set(cxp, mastH, czp);
  const jib = new THREE.Mesh(new THREE.BoxGeometry(34, 0.9, 0.9), new THREE.MeshStandardMaterial({ color: "#f06a6a", wireframe: true }));
  jib.position.set(10, 0.9, 0);
  crane.add(jib);
  const jibCore = new THREE.Mesh(new THREE.BoxGeometry(34, 0.12, 0.12), M.steel);
  jibCore.position.set(10, 0.5, 0);
  crane.add(jibCore);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(8, 0.6, 1.4), M.steel);
  counter.position.set(-10, 0.6, 0);
  crane.add(counter);
  const weight = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1.6), M.steelDark);
  weight.position.set(-12.5, 0.2, 0);
  crane.add(weight);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 1.6), M.container);
  cab.position.set(1.2, -0.4, 1.4);
  crane.add(cab);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4, 4), M.steel);
  tip.position.set(0, 2.6, 0);
  crane.add(tip);
  const trolley = new THREE.Group();
  trolley.position.set(18, 0.2, 0);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 14, 4), M.steelDark);
  cable.position.y = -7;
  trolley.add(cable);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.5), M.steelDark);
  hook.position.y = -14.2;
  trolley.add(hook);
  const load = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 1.2), M.formwork);
  load.position.y = -14.9;
  trolley.add(load);
  crane.add(trolley);
  crane.userData.base = -Math.PI / 2.4;
  crane.rotation.y = crane.userData.base;
  world.add(crane);
  label("Crane", cxp, mastH + 4.2, czp, { size: 0.8 });

  // trees outside the fence
  [[-fx - 6, -6], [-fx - 5, 10], [fx + 6, -12], [fx + 5, 6], [-20, fz + 11], [24, fz + 11]].forEach(([x, z]) => {
    cyl(0.25, 2.4, M.trunk, x, 1.2, z);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(2, 16, 12), M.leaf);
    crown.position.set(x, 3.8, z);
    crown.castShadow = true;
    world.add(crown);
  });
}

function excavator(x, z, y) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const body = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 2.2), mat("#f59e0b"));
  body.position.y = 1.3;
  body.castShadow = true;
  g.add(body);
  const tracks = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.7, 2.6), M.steelDark);
  tracks.position.y = 0.35;
  g.add(tracks);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), M.glass);
  cabin.position.set(-0.6, 2.5, 0.4);
  g.add(cabin);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.35, 0.35), mat("#f59e0b"));
  arm.position.set(2.4, 2.4, -0.4);
  arm.rotation.z = -0.5;
  g.add(arm);
  const stick = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.2, 0.3), mat("#f59e0b"));
  stick.position.set(4.1, 1.4, -0.4);
  g.add(stick);
  world.add(g);
  return g;
}

// ------------------------------------------------------------------ people
function person(teamColor, x, y, z, { manager = false } = {}) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.8, 0.22), M.trousers);
  legs.position.y = 0.4;
  g.add(legs);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.26), manager ? M.container : M.vest);
  body.position.y = 1.1;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), M.skin);
  head.position.y = 1.56;
  g.add(head);
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(manager ? "#ffffff" : teamColor));
  hat.position.y = 1.62;
  g.add(hat);
  world.add(g);
  return g;
}

// ------------------------------------------------------------------ task pins
function pinFor(task, pos, model) {
  const c = CAT[task.cat].color;
  const g = new THREE.Group();
  g.position.copy(pos);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), new THREE.MeshBasicMaterial({ color: "#71717a" }));
  stem.position.y = 0.8;
  g.add(stem);
  const geo = task.milestone ? new THREE.OctahedronGeometry(0.7) : new THREE.SphereGeometry(0.55, 20, 14);
  const head = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, emissive: c, emissiveIntensity: 0.15 }));
  head.position.y = 2.1;
  head.castShadow = true;
  g.add(head);
  let ring = null;
  if (task.missing) {
    // missing readiness item (drawings, material, crane slot …): an amber ring around the pin
    ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.08, 8, 28), new THREE.MeshBasicMaterial({ color: "#f59e0b" }));
    ring.position.y = 2.1;
    g.add(ring);
  }
  let halo = null;
  if (task.cat === "problem" && model.pulse) {
    halo = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 14), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, depthWrite: false }));
    halo.position.y = 2.1;
    g.add(halo);
  }
  const dim = (model.team !== "all" && task.team !== model.team) || (model.cat !== "all" && task.cat !== model.cat);
  if (dim) g.visible = false;
  world.add(g);
  pins.push({ mesh: head, halo, ring, task, group: g });
  return g;
}

// ------------------------------------------------------------------ build everything from the model
function build(model) {
  if (world) {
    scene.remove(world);
    world.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material && !Object.values(M).includes(o.material)) {
        o.material.map?.dispose?.();
        o.material.dispose?.();
      }
    });
  }
  world = new THREE.Group();
  scene.add(world);
  pins = [];
  walkers = [];
  picks = [];
  hovered = null;
  if (tooltip) tooltip.style.display = "none";

  const secs = model.sections.length ? model.sections : ["A", "B", "C"];
  const n = secs.length;
  buildSite(n, model);
  const floorOf = {};
  const info = {};
  secs.forEach((s, i) => (info[s] = buildSection(s, i, n, model.tasks, model, floorOf)));
  const topAll = Math.max(...Object.values(info).map((x) => x.top));
  const fiAll = model.floor === "all" ? 99 : LEVELS.indexOf(model.floor);
  for (let li = 1; li <= Math.min(topAll, fiAll); li++) {
    const lvl = LEVELS[li];
    label(lvl === "Ground" ? "Ground floor" : lvl, -(n * SEC_W) / 2 - 3.4, LEVEL_Y[lvl] + 1.4, DEPTH / 2, { size: 1, bold: model.floor === lvl, bg: model.floor === lvl ? "#fde3e3" : "rgba(255,255,255,.85)", border: model.floor === lvl ? "#f06a6a" : "#e5e5e5" });
  }

  // pins: spread the tasks of one section + level over the floor, at the height of the work
  const slots = {};
  const visibleLevel = (lvl) => model.floor === "all" || LEVELS.indexOf(lvl) <= LEVELS.indexOf(model.floor);
  model.tasks.forEach((t) => {
    const k = `${t.section}|${t.level}`;
    const idx = (slots[k] = (slots[k] ?? -1) + 1);
    let pos;
    if (t.section && info[t.section]) {
      const cx = info[t.section].cx;
      const { part, op } = kindOf(t.name);
      const yBase = t.level === "Foundation" ? LEVEL_Y.Foundation + 0.5 : LEVEL_Y[t.level] + (part === "slab" ? STOREY : op === "backfill" ? -0.2 : STOREY - 0.6);
      const offs = [[-3.6, 3], [0, 3], [3.6, 3], [-3.6, -2.5], [0, -2.5], [3.6, -2.5]];
      const [ox, oz] = offs[idx % offs.length];
      const extra = op === "backfill" ? -(SEC_W / 2 + 1.4) - ox : 0; // backfill sits in the pit beside the walls
      pos = new THREE.Vector3(cx + ox + extra, yBase + 0.2, oz);
      if (!visibleLevel(t.level)) return;
    } else {
      // site-wide tasks (road, access) along the site road
      pos = new THREE.Vector3((n * SEC_W) / 2 + PIT.x - 6, 0.2, DEPTH / 2 + PIT.z + 6 + idx * 3);
    }
    pinFor(t, pos, model);

    // crews at work: up to four people per running task, helmets in the team colour
    if (model.people && t.status === "in-progress" && t.section && info[t.section]) {
      const crew = Math.min(4, t.crew || 2);
      for (let k = 0; k < crew; k++) {
        const p = person(t.teamColor, pos.x - 1.6 + k * 1.1, pos.y - 0.2, pos.z + (k % 2 ? 1.2 : -1.2));
        walkers.push({ obj: p, home: p.position.clone(), phase: Math.random() * 6.28, mode: "work" });
      }
    }
    if (t.status === "in-progress" && kindOf(t.name).op === "excavation" && info[t.section]) excavator(pos.x + 2.5, pos.z - 3.5, LEVEL_Y.Foundation);
  });

  // the site manager walks along the pit edge to below each problem (or patrols when there are none)
  if (model.people) {
    const front = DEPTH / 2 + PIT.z + 1.2;
    const xs = pins.filter((p) => p.task.cat === "problem" && p.group.visible).map((p) => p.group.position.x);
    const route = (xs.length ? xs : [-SEC_W, SEC_W]).map((x) => new THREE.Vector3(x, 0, front));
    if (route.length === 1) route.push(route[0].clone().add(new THREE.Vector3(3, 0, 0)));
    const sm = person("#ffffff", route[0].x, 0, front, { manager: true });
    walkers.push({ obj: sm, route, leg: 0, t: 0, mode: "walk" });
  }
}

// ------------------------------------------------------------------ animation
function loop() {
  raf = requestAnimationFrame(loop);
  if (!host || !document.body.contains(renderer.domElement)) {
    cancelAnimationFrame(raf);
    raf = null;
    return;
  }
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  controls.update();
  if (crane) crane.rotation.y = crane.userData.base + Math.sin(t * 0.18) * 0.55;
  pins.forEach((p) => {
    if (p.halo) {
      const k = (t * 0.9) % 1;
      p.halo.scale.setScalar(1 + k * 1.8);
      p.halo.material.opacity = 0.45 * (1 - k);
    }
    if (p.ring) p.ring.rotation.y = t * 1.2;
  });
  walkers.forEach((w) => {
    if (w.mode === "work") {
      w.obj.position.y = w.home.y + Math.abs(Math.sin(t * 2 + w.phase)) * 0.06;
      w.obj.rotation.y = Math.sin(t * 0.6 + w.phase) * 0.8;
    } else {
      const target = w.route[(w.leg + 1) % w.route.length];
      const dir = target.clone().sub(w.obj.position).setY(0);
      const dist = dir.length();
      if (dist < 0.2) {
        w.t += dt; // pause at each problem, then walk on
        if (w.t > 1.6) { w.t = 0; w.leg++; }
        w.obj.position.y = 0;
      } else {
        dir.normalize();
        w.obj.position.addScaledVector(dir, Math.min(dist, 3 * dt));
        w.obj.rotation.y = Math.atan2(dir.x, dir.z);
        w.obj.position.y = Math.abs(Math.sin(t * 8)) * 0.05;
      }
    }
  });
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ public API
function mount(el, model, h) {
  if (!el || !model) return;
  if (!renderer) init();
  handlers = h || handlers;
  host = el;
  el.style.position = "relative";
  if (renderer.domElement.parentNode !== el) {
    el.appendChild(renderer.domElement);
    el.appendChild(tooltip);
  }
  resize();
  const key = JSON.stringify(model);
  if (key !== lastKey) {
    lastKey = key;
    build(model);
  }
  if (!raf) loop();
}

function reset() {
  camera.position.copy(HOME.pos);
  controls.target.copy(HOME.target);
  controls.update();
}

window.Site3D = { mount, reset, CAT };
// The app may have rendered before this module finished loading.
const pending = document.getElementById("site3d");
if (pending && window.__site3d) mount(pending, window.__site3d.model, window.__site3d.handlers);
