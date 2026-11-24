/**
 * The ring: where it sits on screen, and everything drawn on the canvas over the text.
 *
 * The app decides what is open, aimed at and pinned; each frame it hands that to `draw` as a view.
 * This module owns the canvas, the ring's geometry and the animations that only exist to be looked at.
 */

import { $ } from "./dom.js";

/** The ring's bands run from INNER to OUTER, as fractions of its radius. */
export const INNER = 0.42, OUTER = 0.96;
/** Width of the documents panel, which the ring's pins and the cursor have to know about. */
export const PANEL = 330;
/** Within this many degrees of an arc's edge, the cursor blends it with its neighbour. */
const BLEND_DEGREES = 7;

const canvas = $("screen"), ctx = canvas.getContext("2d");

export let W = 0, H = 0;
let RX = 0, RY = 0, CX = 0, CY = 0;
let openT = 0, labelT = 0, refsT = 0;
let glow = [], flashes = [], planted = [], particles = [], trail = [];
let collapse = null;
/** When the current wait began, and how visible its waves are (0 to 1). */
let waitingSince = 0, waitT = 0;
/** A wait shorter than this shows nothing: most answers are already there. */
const PATIENCE_MS = 350;
/** What the app is showing this frame: { open, set, aim, pins, mouse, names, panel, overPanel, onPin, busy }. */
let view = null;

resize();
addEventListener("resize", resize);

function resize() {
  const dpr = devicePixelRatio || 1;
  W = innerWidth; H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  CX = W / 2; CY = H / 2;
  RX = Math.max(60, W / 2 - Math.max(110, W * 0.1));
  RY = Math.max(60, H / 2 - 64);
}

/* ---------- geometry ---------- */

/** What a point on screen means on a ring of `count` arcs: which arc, how strong, and whether it blends with a neighbour. */
export function locate(x, y, count) {
  const nx = (x - CX) / RX, ny = (y - CY) / RY;
  const q = Math.hypot(nx, ny);
  const u = (q - INNER) / (OUTER - INNER);
  const level = u <= 0 ? 0 : u < 1 / 3 ? 1 : u < 2 / 3 ? 2 : 3;
  let deg = (Math.atan2(ny, nx) * 180) / Math.PI + 90;
  deg = ((deg % 360) + 360) % 360;
  const span = 360 / count;
  const index = Math.floor(deg / span) % count;
  const within = deg - index * span;
  let blendWith = null;
  if (within < BLEND_DEGREES) blendWith = (index - 1 + count) % count;
  else if (span - within < BLEND_DEGREES) blendWith = (index + 1) % count;
  return { index, level, q, deg, blendWith: level ? blendWith : null };
}

/** A spot in a strength band on one arc; `across` runs from one side of the arc (0) to the other (1). */
export function bandPoint(index, level, across, count) {
  return ellipsePoint(INNER + ((OUTER - INNER) * (level - 0.5)) / 3, ((index + across) * 360) / count);
}

/** How far the documents panel has slid out, from 0 to 1. */
export function panelOut() { return refsT; }

/* ---------- animations the app sets off ---------- */

/** The ring opens from nothing. */
export function unfold() { openT = 0; }

/** The labels type themselves in again, for a new set of options. */
export function relabel() { labelT = 0; glow = []; }

/** A band lights up as the cursor crosses into it. */
export function flash(index, level) {
  flashes.push({ index, q: INNER + ((OUTER - INNER) * (level - 1)) / 3, born: performance.now() });
}

/** Rings spread from where a pin was placed. */
export function plant(x, y, level) {
  planted.push({ x, y, born: performance.now(), level });
}

/** The ring and its pins fold into the centre, on save or cancel. */
export function fold(set, pins) {
  collapse = { set, born: performance.now(), x: CX, y: CY, pins };
}

/** The cursor leaves a short trail. */
export function trace(x, y) {
  trail.push({ x, y, at: performance.now() });
}

/** A box on screen breaks into falling pieces. */
export function burst(r) {
  const count = Math.max(6, Math.min(40, Math.round((r.width * r.height) / 60)));
  for (let i = 0; i < count; i++) {
    particles.push({
      x: r.left + Math.random() * r.width, y: r.top + Math.random() * r.height,
      vx: (Math.random() - 0.5) * 7, vy: -Math.random() * 5 - 1,
      size: 2 + Math.random() * 4, born: performance.now(), life: 600 + Math.random() * 600, spin: Math.random() * 0.4 - 0.2, angle: 0,
    });
  }
}

/* ---------- drawing ---------- */

export function draw(t, showing) {
  view = showing;
  const time = t / 1000;
  const open = view.open;
  openT += ((open ? 1 : 0) - openT) * (open ? 0.07 : 0.2);
  if (open && openT > 0.995) openT = 1;
  labelT = Math.min(1, labelT + 0.035);
  refsT += ((view.panel ? 1 : 0) - refsT) * 0.12;
  ctx.clearRect(0, 0, W, H);
  if (open) drawRing(view.set, openT, time);
  drawCollapse();
  if (open) drawPins(time);
  drawPlanted();
  drawParticles();
  if (open && !view.overPanel) drawCursor();
  drawWaiting(time);
}

/** Waves spread from the cursor, like a radar, while an answer is taking long enough to notice. */
function drawWaiting(time) {
  const now = performance.now();
  if (!view.busy) waitingSince = 0;
  else if (!waitingSince) waitingSince = now;
  const shown = view.busy && now - waitingSince > PATIENCE_MS ? 1 : 0;
  waitT += (shown - waitT) * 0.1;
  if (waitT < 0.02 || view.mouse.x < 0) return;
  ctx.lineWidth = 1;
  for (let k = 0; k < 3; k++) {
    const phase = (time * 0.8 + k / 3) % 1;
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - phase) * waitT})`;
    ctx.beginPath(); ctx.arc(view.mouse.x, view.mouse.y, 9 + easeOut(phase) * 38, 0, Math.PI * 2); ctx.stroke();
  }
}

export function ellipsePoint(q, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [CX + Math.cos(a) * RX * q, CY + Math.sin(a) * RY * q];
}

function arcPath(q, from, to) {
  ctx.beginPath();
  const step = Math.max(0.5, (to - from) / 60);
  for (let d = from; d <= to + 0.001; d += step) {
    const [x, y] = ellipsePoint(q, Math.min(d, to));
    d === from ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
}

function sectorPath(q0, q1, from, to) {
  ctx.beginPath();
  for (let d = from; d <= to; d += 1) { const [x, y] = ellipsePoint(q1, d); d === from ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
  for (let d = to; d >= from; d -= 1) { const [x, y] = ellipsePoint(q0, d); ctx.lineTo(x, y); }
  ctx.closePath();
}

function drawRing(set, t, time) {
  if (!set?.length) return;
  const n = set.length, span = 360 / n, gap = 1.4;
  const sweep = easeOut(t) * 360;
  const now = performance.now();
  while (glow.length < n) glow.push(0);
  drawIdleSweep(time, n, span);

  set.forEach((d, i) => {
    const from = i * span + gap, to = (i + 1) * span - gap;
    const target = !view.aim?.level ? 0 : view.aim.index === i ? 1 : view.aim.blendWith === i ? 0.7 : 0;
    glow[i] += (target - glow[i]) * 0.18;
    const g = glow[i];
    const end = Math.min(to, sweep);
    if (end <= from) return;

    if (g > 0.02 && view.aim?.level) {
      const qc = Math.min(view.aim.q, OUTER);
      const grad = ctx.createRadialGradient(CX, CY, 0, CX, CY, Math.max(RX, RY) * qc);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(1, `rgba(255,255,255,${0.07 * g})`);
      sectorPath(INNER, qc, from, to); ctx.fillStyle = grad; ctx.fill();
      const stepQ = 0.05, phase = (time * 0.08) % stepQ;
      for (let q = INNER + phase; q < qc; q += stepQ) {
        const k = (q - INNER) / Math.max(0.001, qc - INNER);
        ctx.strokeStyle = `rgba(255,255,255,${(0.04 + 0.3 * k * k) * g})`;
        ctx.lineWidth = 1;
        arcPath(q, from + 1, to - 1); ctx.stroke();
      }
      for (let k = 1; k <= 2; k++) {
        const qq = INNER + ((OUTER - INNER) * k) / 3;
        const passed = view.aim.level > k;
        ctx.strokeStyle = `rgba(255,255,255,${(passed ? 0.55 : 0.18) * g})`;
        ctx.setLineDash(passed ? [] : [2, 6]); ctx.lineWidth = passed ? 1.2 : 1;
        arcPath(qq, from, to); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    ctx.strokeStyle = `rgba(255,255,255,${(0.24 + 0.76 * g) * Math.min(1, t * 1.4)})`;
    ctx.lineWidth = 1 + 1.6 * g;
    arcPath(OUTER, from, end); ctx.stroke();

    const mid = (from + to) / 2;
    const reached = Math.max(0, Math.min(1, (sweep - from) / Math.max(1, to - from)));
    const label = d.label;
    const typed = label.slice(0, Math.ceil(label.length * Math.min(reached, labelT * 1.4)));
    const [lx, ly] = ellipsePoint(OUTER + 0.045, mid);
    ctx.font = `${g > 0.5 ? 500 : 400} 12px 'IBM Plex Mono', monospace`;
    ctx.textAlign = Math.abs(lx - CX) < 30 ? "center" : lx < CX ? "right" : "left";
    ctx.fillStyle = `rgba(255,255,255,${0.45 + 0.55 * g})`;
    ctx.fillText(typed + (typed.length < label.length && typed.length ? "█" : ""), lx, ly + 4);
    /* The strength goes on the label's far side from the ring: above it for arcs in the top half, below it otherwise. */
    const strengthY = ly < CY - RY * 0.3 ? ly - 14 : ly + 22;
    if (g > 0.5 && view.aim?.level && view.aim.index === i) ctx.fillText(`${"■".repeat(view.aim.level)}${"□".repeat(3 - view.aim.level)} ${view.names[view.aim.level]}`, lx, strengthY);
  });

  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i], age = (now - f.born) / 450;
    if (age > 1 || f.index >= n) { flashes.splice(i, 1); continue; }
    const from = f.index * span + gap, to = (f.index + 1) * span - gap;
    ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - age)})`;
    ctx.lineWidth = 2 * (1 - age) + 0.5;
    arcPath(f.q + age * 0.03, from, to); ctx.stroke();
  }

  ctx.strokeStyle = `rgba(255,255,255,${0.09 * t})`;
  ctx.setLineDash([1, 7]);
  ctx.beginPath(); ctx.ellipse(CX, CY, RX * INNER, RY * INNER, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
}

function drawIdleSweep(time, n, span) {
  const idle = !view.aim?.level ? 1 : 0;
  drawIdleSweep.a = (drawIdleSweep.a ?? 0) + (idle - (drawIdleSweep.a ?? 0)) * 0.05;
  const a = drawIdleSweep.a;
  if (a < 0.02) return;
  const head = (time * 36) % 360;
  for (let k = 0; k < 18; k++) {
    const deg = head - k * 1.6;
    const [x0, y0] = ellipsePoint(INNER, deg), [x1, y1] = ellipsePoint(OUTER, deg);
    ctx.strokeStyle = `rgba(255,255,255,${0.09 * (1 - k / 18) * a})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  const lit = Math.floor((((head % 360) + 360) % 360) / span) % n;
  ctx.strokeStyle = `rgba(255,255,255,${0.12 * a})`;
  ctx.lineWidth = 1.5;
  arcPath(OUTER, lit * span + 1.4, (lit + 1) * span - 1.4); ctx.stroke();
}

function drawCursor() {
  if (view.mouse.x < 0) return;
  const now = performance.now();
  trail = trail.filter((p) => now - p.at < 220);
  trail.forEach((p) => {
    const k = 1 - (now - p.at) / 220;
    ctx.fillStyle = `rgba(255,255,255,${0.25 * k})`;
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  });
  const level = view.aim?.level ?? 0;
  if (level) {
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.setLineDash([2, 5]);
    const [ix, iy] = ellipsePoint(INNER, view.aim.deg);
    ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(view.mouse.x, view.mouse.y); ctx.stroke();
    ctx.setLineDash([]);
  }
  const size = 4 + level * 2;
  ctx.fillStyle = "#fff";
  ctx.fillRect(view.mouse.x - size / 2, view.mouse.y - size / 2, size, size);
}

/** A bond between two points: bright at both ends, fading to nothing in the middle so it never covers the text. */
function bond(a, b, strength) {
  const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  g.addColorStop(0, `rgba(255,255,255,${0.75 * strength})`);
  g.addColorStop(0.22, `rgba(255,255,255,${0.12 * strength})`);
  g.addColorStop(0.5, "rgba(255,255,255,0)");
  g.addColorStop(0.78, `rgba(255,255,255,${0.12 * strength})`);
  g.addColorStop(1, `rgba(255,255,255,${0.75 * strength})`);
  ctx.strokeStyle = g;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

function drawPins(time) {
  const pins = view.pins;
  for (let i = 1; i < pins.length; i++) bond(pins[i - 1], pins[i], 1);
  if (pins.length > 2) bond(pins[pins.length - 1], pins[0], 0.45);
  if (pins.length && view.aim?.level && !view.onPin) bond(pins[pins.length - 1], view.mouse, 0.4);
  ctx.font = "400 10px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  for (const p of pins) {
    // While the documents are open, the highlighted passage is the pin; the dot appears once the panel is away.
    if (p.kind === "ref" && refsT >= 0.5) continue;
    const hovered = Math.hypot(p.x - view.mouse.x, p.y - view.mouse.y) < 14;
    const size = 5 + p.level * 2 + 0.8 * Math.sin(time * 2.4 + p.born);
    ctx.fillStyle = hovered ? "rgba(255,255,255,0.45)" : "#fff";
    if (p.kind === "ref") { ctx.beginPath(); ctx.arc(p.x, p.y, size / 1.6, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.strokeRect(p.x - size, p.y - size, size * 2, size * 2);
    if (p.kind === "ref") {
      ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillText(hovered ? "× remove" : p.doc.title, p.x - 12, p.y + 3); ctx.textAlign = "center";
      continue;
    }
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    const label = p.partner ? `${p.dir.label} + ${p.partner.label}` : p.dir.label;
    ctx.fillText(hovered ? "× remove" : `${label} ${"■".repeat(p.level)}`, p.x, p.y + size + 14);
  }
}

function drawCollapse() {
  if (!collapse) return;
  const age = (performance.now() - collapse.born) / 450;
  if (age > 1) { collapse = null; return; }
  const n = collapse.set?.length ?? 0;
  const e = easeOut(age), span = 360 / Math.max(1, n);
  ctx.save();
  ctx.translate(collapse.x, collapse.y);
  ctx.scale(1 - e * 0.85, 1 - e * 0.85);
  ctx.translate(-collapse.x, -collapse.y);
  for (let i = 0; i < n; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - e)})`;
    ctx.lineWidth = 1;
    arcPath(OUTER, i * span + 1.4, (i + 1) * span - 1.4); ctx.stroke();
  }
  ctx.restore();
  for (const p of collapse.pins ?? []) {
    const x = p.x + (collapse.x - p.x) * e, y = p.y + (collapse.y - p.y) * e, size = 6 * (1 - e) + 1;
    ctx.fillStyle = `rgba(255,255,255,${1 - e})`;
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }
}

function drawPlanted() {
  const now = performance.now();
  planted = planted.filter((p) => now - p.born < 1600);
  for (const p of planted) {
    const age = (now - p.born) / 1600;
    const fade = 1 - age;
    for (let k = 0; k < 3; k++) {
      const wave = Math.max(0, age - k * 0.1);
      if (wave <= 0) continue;
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - wave) * fade})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 8 + easeOut(wave) * (70 + p.level * 30), 0, Math.PI * 2); ctx.stroke();
    }
  }
}

function drawParticles() {
  const now = performance.now();
  particles = particles.filter((p) => now - p.born < p.life);
  for (const p of particles) {
    const k = (now - p.born) / p.life;
    p.vy += 0.32; p.vx *= 0.985;
    p.x += p.vx; p.y += p.vy; p.angle += p.spin;
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(p.angle);
    ctx.fillStyle = `rgba(255,255,255,${1 - k})`;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  }
}

export function easeOut(x) { return 1 - (1 - Math.min(1, Math.max(0, x))) ** 3; }
