import { pilot, startAutopilot } from "./autopilot.js";
import { diffWords } from "./diff.js";
import "./landing.js";
import { documents } from "./documents.js";
import { SAMPLE } from "./sample.js";
import { createSound } from "./sound.js";
import { isLive, request as api, settings } from "./llm/index.js";

const NAMES = { edit: ["", "slight", "medium", "strong"], write: ["", "phrase", "sentence", "paragraph"] };
const KEYS = ["", "slight", "medium", "strong"];
const MEANINGS = 6, MAX_MEANINGS = 8;
const INNER = 0.42, OUTER = 0.96;
const BLEND_DEGREES = 7;
const SCROLL_PAUSE = 450;
const PANEL = 330, EDGE = 26;
const COMBO_WINDOW = 320;
const MAX_PINS = 4;

const $ = (id) => document.getElementById(id);
const canvas = $("screen"), ctx = canvas.getContext("2d");
const textEl = $("text"), hintEl = $("hint"), statusEl = $("status"), toastEl = $("toast"), askEl = $("ask"), askInput = $("askInput"), askedEl = $("asked");
const refsEl = $("refs"), meterEl = $("meter");

let W = 0, H = 0, RX = 0, RY = 0, CX = 0, CY = 0;
const TEXT_STORAGE = "feeling-text";
/** Inside the front page's tour the app runs on the sample letter and the simulator, and leaves the saved text alone. */
const DEMO = new URLSearchParams(location.search).has("demo");
/** A clip is the tour showing one interaction by itself, on just the paragraph it needs. */
const CLIP = new URLSearchParams(location.search).get("clip");
const DEMO_TEXT = CLIP ? SAMPLE.split("\n\n")[CLIP === "shorter" ? 2 : 1] : SAMPLE.split("\n\n").slice(1, 3).join("\n\n");
if (DEMO) { settings.simulate = true; document.body.classList.add("demo"); }
if (CLIP) { document.body.classList.add("clip"); document.body.dataset.clip = CLIP; }
let text = DEMO ? DEMO_TEXT : stored();
const undone = { past: [], future: [] };
/** The front page shows when there is no text yet, or when the name in the corner is clicked. */
let home = !text;
let seg = null;
let changes = 0;
let mouse = { x: -1, y: -1 };
let trail = [];
let aim = null;
let openT = 0, labelT = 0, refsT = 0;
let glow = [];
let flashes = [], planted = [], particles = [];
let collapse = null;
let scrollLock = 0;
let downAt = null;
const shrinkState = { pending: 0, combo: 0, lastAt: 0, timer: null, busy: false };
const sound = createSound();

buildDocs();
resize();
addEventListener("resize", resize);
render();
requestAnimationFrame(frame);

function isOpen() { return !!seg && !seg.done && !!currentSet()?.length; }
function currentSet() { return seg?.sets?.[seg.setIndex] ?? null; }
function names() { return NAMES[seg?.mode === "write" && !seg?.prompt ? "write" : "edit"]; }

function resize() {
  const dpr = devicePixelRatio || 1;
  W = innerWidth; H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layoutRing();
}

/** The ring shrinks to the left while the references panel is out. */
function layoutRing() {
  CX = W / 2; CY = H / 2;
  RX = Math.max(60, W / 2 - Math.max(110, W * 0.1));
  RY = Math.max(60, H / 2 - 64);
}

function buildDocs() {
  $("docs").innerHTML = documents.all.map((d, i) => `<div class="doc"><h3>${esc(d.title)}<button class="remove" data-doc="${i}" title="delete this document">×</button></h3>${d.paragraphs.map((p, j) => `<p data-doc="${i}" data-para="${j}">${esc(p)}</p>`).join("")}</div>`).join("") || `<p class="note">no documents yet</p>`;
  renderPanel();
}

function stored() {
  try { return localStorage.getItem(TEXT_STORAGE) ?? ""; } catch { return ""; }
}

/** Changes the text, keeping the old one for undo. */
function setText(next) {
  if (next === text) return;
  undone.past.push(text);
  undone.future = [];
  text = next;
}

function undo(back) {
  const [from, to] = back ? [undone.past, undone.future] : [undone.future, undone.past];
  if (!from.length) return toast(back ? "nothing to undo" : "nothing to redo");
  if (seg) { clearTimeout(seg.fadeTimer); seg = null; }
  to.push(text);
  text = from.pop();
  render();
}

/** Tells the front page what just happened, so its tour can tick the step off. */
function notify(step) {
  if (DEMO && !pilot.running) parent.postMessage({ feeling: step }, location.origin);
}

/** Keeps the text for the next visit. A passage still being shaped is not part of it until it is saved. */
function remember() {
  if (DEMO || remember.last === text) return;
  remember.last = text;
  try { text ? localStorage.setItem(TEXT_STORAGE, text) : localStorage.removeItem(TEXT_STORAGE); } catch {}
}

function render() {
  remember();
  if (!text && !document.body.classList.contains("editing")) home = true;
  document.body.classList.toggle("home", home);
  renderText();
  statusEl.textContent = changes ? `  ·  ${changes} change${changes > 1 ? "s" : ""}` : "";
  document.body.classList.toggle("open", isOpen());
  const set = currentSet();
  if (!seg || seg.done) hintEl.innerHTML = "<b>select</b> words to reshape them  ·  <b>click</b> between words to write there  ·  scroll to read";
  else if (!set) hintEl.textContent = seg.mode === "write" ? "thinking about what could go here…" : "reading the passage…";
  else if (DEMO) hintEl.innerHTML = "<b>move</b> toward a meaning · <b>click</b> to pin · <b>↵</b> save · <b>type</b> to ask · <b>←</b> shorter · <b>esc</b> cancel";
  else {
    const what = seg.mode === "write" ? "a move, further out writes more" : "a meaning, nearer the edge is stronger";
    const pins = seg.pins.length ? ` (${seg.pins.length} pinned)` : "";
    const arrows = seg.mode === "edit" ? " · <b>← ↓</b> shorter, tap fast for more · <b>→ ↑</b> back (when the ask bar is empty)" : "";
    hintEl.innerHTML = `<b>move</b> toward ${what} · <b>click</b> to pin${pins} · <b>↵</b> save${arrows}<br><b>scroll</b> ↓ new ${seg.mode === "write" ? "moves" : "meanings"} ↑ back (${seg.setIndex + 1}/${seg.sets.length}) · push the <b>right edge</b> for references · <b>type</b> to ask (↵ changes the text, ⇧↵ only the ring) · <b>esc</b> cancel`;
  }
  renderPanel();
  renderAsk();
}

function renderAsk() {
  const prompt = seg?.prompt;
  askedEl.classList.toggle("show", !!prompt);
  askedEl.textContent = prompt ? `asked: ${prompt.query} ×` : "";
  askEl.classList.toggle("thinking", !!seg?.asking);
  askInput.placeholder = seg?.asking ? "thinking…" : prompt ? "ask again to refine · ⇧↵ only adds it to the ring" : `type what you want · ↵ ${seg?.mode === "write" ? "writes it" : "changes the text"} · ⇧↵ only adds it to the ring`;
}

function renderText() {
  textEl.innerHTML = "";
  if (!seg) { textEl.append(span(text)); return; }
  const before = span(text.slice(0, seg.start)), after = span(text.slice(seg.end));
  const mid = document.createElement("span");
  if (seg.mode === "write") {
    const shown = seg.preview ?? seg.current;
    mid.className = "ghost" + (seg.waiting ? " waiting" : "") + (seg.done ? " fading" : "");
    mid.textContent = shown;
    if (!shown && !seg.done) mid.innerHTML = '<span class="caret"></span>';
  } else {
    mid.className = "seg" + (seg.waiting ? " waiting" : "") + (seg.done ? " fading" : "");
    const parts = seg.doomedFrom ? diffWords(seg.original, seg.doomedFrom, true) : diffWords(seg.original, seg.preview ?? seg.current);
    for (const part of parts) {
      const w = span(part.text);
      if (part.changed) w.className = seg.doomedFrom ? "doomed" : "new";
      if (part.born) w.className = "born";
      mid.append(w);
    }
  }
  textEl.append(before, mid, after);
}

function span(t) { const s = document.createElement("span"); s.textContent = t; return s; }

function toast(message) {
  toastEl.textContent = message;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (toastEl.textContent = ""), 4000);
}

/* ---------- starting: select to edit, click to write ---------- */

textEl.addEventListener("mousedown", (e) => { downAt = { x: e.clientX, y: e.clientY }; });

textEl.addEventListener("mouseup", (e) => {
  if (isOpen()) return;
  if (seg?.waiting) { getSelection().removeAllRanges(); return toast("one moment, the last change is still being written"); }
  const sel = getSelection();
  const dragged = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4;
  if (!sel.isCollapsed && dragged) {
    const range = sel.getRangeAt(0);
    if (!textEl.contains(range.commonAncestorContainer)) return;
    const from = offsetOf(range.startContainer, range.startOffset), to = offsetOf(range.endContainer, range.endOffset);
    sel.removeAllRanges();
    forget();
    const [s, t] = snapToWords(text, Math.min(from, to), Math.max(from, to));
    if (t - s < 2) return render();
    open({ mode: "edit", start: s, end: t, original: text.slice(s, t) });
  } else if (!dragged) {
    const caret = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (!caret || !textEl.contains(caret.startContainer)) return;
    let at = offsetOf(caret.startContainer, caret.startOffset);
    sel.removeAllRanges();
    forget();
    while (at < text.length && /[\w'’-]/.test(text[at])) at++;
    while (at < text.length && /[.,;:!?)]/.test(text[at])) at++;
    open({ mode: "write", start: at, end: at, original: "" });
  }
});

function open(fields) {
  seg = { ...fields, current: fields.original, preview: null, sets: [], setIndex: 0, pins: [], history: [] };
  openT = 0;
  sound.wake();
  notify(seg.mode === "write" ? "write" : "select");
  if (!isLive() && !DEMO && !SAMPLE.includes(text.slice(0, 60)) && !open.warned) {
    open.warned = true;
    toast("simulator: it only knows the sample letter, so changes here are rough. Add a key for a real model.");
  }
  if (seg.mode === "edit") ahead(ladderOf(seg).versions);
  render();
  centerOn(textEl.querySelector(".seg, .ghost"));
  loadSet(seg);
}

function centerOn(el) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  window.scrollBy({ top: r.top + r.height / 2 - innerHeight / 2, behavior: "smooth" });
}

function offsetOf(node, offset) {
  const r = document.createRange();
  r.setStart(textEl, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

function snapToWords(str, s, t) {
  while (s > 0 && /\S/.test(str[s - 1])) s--;
  while (t < str.length && /[^\s.,;:!?]/.test(str[t])) t++;
  while (s < t && /\s/.test(str[s])) s++;
  while (t > s && /\s/.test(str[t - 1])) t--;
  return [s, t];
}

/** Writes the passage's current wording into the text and drops the selection, so the next selection can cover anything. */
function forget() {
  if (!seg) return;
  clearTimeout(seg.fadeTimer);
  if (seg.done) setText(text.slice(0, seg.start) + seg.current + text.slice(seg.end));
  seg = null;
}

async function loadSet(target) {
  const replacing = !!target.stale;
  const seen = replacing ? [] : target.sets.flat().map((d) => d.label);
  target.loading = true;
  render();
  const route = target.mode === "write" ? "moves" : "bloom";
  try {
    const { directions } = await api(route, { text, start: target.start, end: target.end, count: MEANINGS, exclude: seen });
    if (seg !== target) return;
    if (replacing) { target.sets = []; target.stale = false; }
    target.sets.push(directions.slice(0, MAX_MEANINGS).map((d) => ({ ...d, kind: "suggested", basis: basisOf(target) })));
    target.setIndex = target.sets.length - 1;
    labelT = 0;
    glow = [];
    ahead(api(route, { text, start: target.start, end: target.end, count: MEANINGS, exclude: target.sets.flat().map((d) => d.label) }));
  } catch (error) {
    toast(error.message);
    if (!target.sets.length && seg === target) seg = null;
  }
  target.loading = false;
  render();
}


/** Marks a request as made ahead of need: its reply is remembered, and a failure can wait until it is asked for again. */
function ahead(reply) { reply.catch(() => {}); }

/* ---------- aiming, pins and combining ---------- */

function aimAt(x, y) {
  const set = currentSet();
  const n = set?.length ?? 0;
  if (!n || overPanel(x)) return null;
  const nx = (x - CX) / RX, ny = (y - CY) / RY;
  const q = Math.hypot(nx, ny);
  const u = (q - INNER) / (OUTER - INNER);
  const level = u <= 0 ? 0 : u < 1 / 3 ? 1 : u < 2 / 3 ? 2 : 3;
  let deg = (Math.atan2(ny, nx) * 180) / Math.PI + 90;
  deg = ((deg % 360) + 360) % 360;
  const span = 360 / n;
  const index = Math.floor(deg / span) % n;
  const within = deg - index * span;
  let blendWith = null;
  if (within < BLEND_DEGREES) blendWith = (index - 1 + n) % n;
  else if (span - within < BLEND_DEGREES) blendWith = (index + 1) % n;
  return { index, level, q, deg, blendWith: level ? blendWith : null };
}

function overPanel(x) { return refsEl.classList.contains("show") && x > W - PANEL; }

function updateAim() {
  if (!isOpen()) return;
  const next = aimAt(mouse.x, mouse.y);
  const same = (a, b) => (!a && !b) || (a && b && a.index === b.index && a.level === b.level && a.blendWith === b.blendWith);
  if (next && aim && next.level && next.index !== aim.index) sound.meaning(next.index);
  if (next && next.level !== (aim?.level ?? 0) && next.level) {
    sound.tick(next.level);
    flashes.push({ index: next.index, q: INNER + ((OUTER - INNER) * (next.level - 1)) / 3, born: performance.now() });
  }
  const changed = !same(next, aim);
  aim = next;
  if (changed) refreshPreview();
}

function pullOf(a) {
  const set = currentSet();
  return { kind: "meaning", dir: set[a.index], partner: a.blendWith != null ? set[a.blendWith] : null, level: a.level };
}

function pullsNow() {
  const pulls = [...seg.pins];
  if (aim?.level && !nearPin(mouse.x, mouse.y)) pulls.push(pullOf(aim));
  return pulls;
}

/** Spaces a piece of new text so it reads naturally at the cursor; a paragraph at the end of a paragraph becomes its own paragraph. */
function placed(str, level) {
  if (!str) return "";
  const prev = text[seg.start - 1] ?? "", next = text[seg.start] ?? "";
  if (level === 3 && (next === "\n" || next === "")) return `\n\n${str.trim()}`;
  let out = str.trim();
  if (prev && !/\s/.test(prev) && !/^[.,;:!?]/.test(out)) out = ` ${out}`;
  if (next && !/[\s.,;:!?]/.test(next)) out = `${out} `;
  return out;
}

/** What the ring's options start from: the writer's prompted version when there is one, otherwise the original. */
function basisOf(target) { return target.prompt?.text ?? target.original; }

function lengthOf(str) {
  const sentences = (str.match(/[.!?](\s|$)/g) ?? []).length;
  return sentences > 1 ? 3 : str.split(/\s+/).length > 8 ? 2 : 1;
}

/** The document as the model should see it: with the prompted version already in place, so steering refines it. */
function contextOf(target) {
  if (!target.prompt) return { mode: target.mode, text, start: target.start, end: target.end };
  const inserted = target.mode === "write" ? placed(target.prompt.text, lengthOf(target.prompt.text)) : target.prompt.text;
  return { mode: "edit", text: text.slice(0, target.start) + inserted + text.slice(target.end), start: target.start, end: target.start + inserted.length };
}

const refsOf = (pulls) => pulls.filter((p) => p.kind === "ref").map((p) => ({ title: p.doc.title, text: p.text }));

/** Pulls as the model reads them: one weight per label, the strongest pull on it. */
function weighed(pulls, mode) {
  const weights = new Map();
  for (const p of pulls.filter((p) => p.kind === "meaning")) for (const d of [p.dir, p.partner].filter(Boolean)) weights.set(d.label, Math.max(weights.get(d.label) ?? 0, p.level / 3));
  return [...weights].map(([label, weight]) => ({ label, weight, length: mode === "write" ? NAMES.write[Math.round(weight * 3)] : undefined }));
}

/**
 * Every pull together. Three ways to answer, fastest first:
 * a single plain pull is already in the ring's options; the pins plus one more plain pull come from the grid,
 * which is asked for as soon as the pins change, before the cursor gets anywhere; anything else asks on the spot.
 */
async function combine(target, pulls) {
  const meanings = pulls.filter((p) => p.kind === "meaning");
  const level = Math.max(1, ...meanings.map((p) => p.level));
  const base = basisOf(target);
  const done = (t) => (target.mode === "write" ? placed(t, target.prompt ? lengthOf(t) : level) : t);
  if (!pulls.length) return target.prompt ? done(base) : target.original;
  if (pulls.length === 1 && meanings.length === 1 && !meanings[0].partner && meanings[0].dir.basis === base) return done(meanings[0].dir[KEYS[meanings[0].level]]);

  const context = contextOf(target);
  const pinned = pulls.filter((p) => target.pins.includes(p)), extra = pulls.filter((p) => !target.pins.includes(p));
  const set = currentSet() ?? [];
  if (!extra.length || (extra.length === 1 && !extra[0].partner && set.includes(extra[0].dir))) {
    const pins = weighed(pinned, context.mode), taken = new Set(pins.map((pin) => pin.label));
    const grid = await api("grid", { ...context, refs: refsOf(pinned), pins, options: set.map((d) => d.label).filter((label) => !taken.has(label)) });
    const row = extra.length ? grid.options.find((option) => option.label === extra[0].dir.label) : null;
    if (!extra.length) return done(grid.text);
    if (row) return done(row[KEYS[extra[0].level]]);
  }
  const { text: out } = await api("compose", { ...context, refs: refsOf(pulls), pulls: weighed(pulls, context.mode) });
  return done(out);
}

/** The writer's own words: rewrites (or writes) what they ask, then swaps in ring options that steer from that result. */
async function askFor(query, apply = true) {
  const target = seg;
  if (!target || target.asking) return;
  if (!query) return clearPrompt();
  target.asking = true; target.waiting = apply;
  render();
  try {
    const keep = (currentSet() ?? []).map((d) => d.label);
    const asked = { ...contextOf(target), mode: target.prompt ? "edit" : target.mode, prompt: query, keep, refs: refsOf(target.pins), library: documents.all.map((d) => ({ title: d.title, text: d.paragraphs.join(" ") })), count: MEANINGS, apply };
    const { text: result, directions } = await api("prompt", asked);
    if (seg !== target) return;
    notify("ask");
    if (!apply) {
      target.sets.push(directions.map((d) => ({ ...d, kind: d.kept ? "kept" : "suggested", basis: basisOf(target) })));
      target.setIndex = target.sets.length - 1;
      labelT = 0; glow = []; aim = null;
      sound.swap();
      return;
    }
    if (target.promptFrom == null) target.promptFrom = target.setIndex;
    target.prompt = { query: target.prompt ? `${target.prompt.query} → ${query}` : query, text: result };
    target.pins = target.pins.filter((p) => p.kind === "ref");
    target.sets.push(directions.map((d) => ({ ...d, kind: d.kept ? "kept" : "suggested", basis: result })));
    target.setIndex = target.sets.length - 1;
    labelT = 0; glow = []; aim = null;
    sound.swap();
  } catch (error) { toast(error.message); }
  finally {
    target.asking = false; target.waiting = false;
    if (seg === target) { render(); updateAim(); refreshPreview(); }
  }
}

function clearPrompt() {
  const target = seg;
  if (!target?.prompt) return;
  target.prompt = null;
  target.pins = target.pins.filter((p) => p.kind === "ref");
  target.setIndex = target.promptFrom ?? 0;
  target.promptFrom = null;
  sound.unpin();
  swapped();
}

let previewToken = 0, previewTimer = null;
function refreshPreview() {
  if (!seg) return;
  const target = seg, pulls = pullsNow(), token = ++previewToken;
  const current = () => token === previewToken && seg === target;
  clearTimeout(previewTimer);
  const run = async () => {
    const slow = setTimeout(() => { if (current()) { target.waiting = true; renderText(); } }, 150);
    try {
      const t = await combine(target, pulls);
      if (current()) { target.preview = pulls.length || target.prompt ? t : null; target.waiting = !!target.asking; renderText(); }
    } catch (error) { if (current()) toast(error.message); }
    clearTimeout(slow);
  };
  const betweenTwo = pulls.some((p) => p.partner && !target.pins.includes(p));
  if (betweenTwo) previewTimer = setTimeout(run, 140);
  else run();
}

function nearPin(x, y) {
  return seg?.pins.find((p) => Math.hypot(p.x - x, p.y - y) < 14) ?? null;
}

addEventListener("mousemove", (e) => {
  mouse = { x: e.clientX, y: e.clientY };
  trail.push({ x: mouse.x, y: mouse.y, at: performance.now() });
  if (isOpen()) {
    const wantPanel = mouse.x > W - EDGE || (refsEl.classList.contains("show") && mouse.x > W - PANEL - 40) || refsEl.contains(document.activeElement);
    refsEl.classList.toggle("show", wantPanel);
  }
  updateAim();
});

addEventListener("wheel", (e) => {
  if (!isOpen() || seg.loading || e.target.closest("#refs")) return;
  e.preventDefault();
  const now = performance.now();
  if (now < scrollLock || Math.abs(e.deltaY) < 4) return;
  scrollLock = now + SCROLL_PAUSE;
  if (e.deltaY > 0) {
    if (seg.setIndex < seg.sets.length - 1) { seg.setIndex++; swapped(); }
    else loadSet(seg);
  } else if (seg.setIndex > 0) { seg.setIndex--; swapped(); }
  sound.swap();
}, { passive: false });

function swapped() {
  labelT = 0;
  glow = [];
  aim = null;
  render();
  updateAim();
  refreshPreview();
}

addEventListener("mousedown", (e) => {
  if (!isOpen() || e.target.closest("#ask, #top")) return;
  const para = e.target.closest("#refs .doc p");
  if (e.target.closest("#refs") && !para) return;
  e.preventDefault();
  const pin = nearPin(e.clientX, e.clientY);
  if (pin) {
    seg.pins = seg.pins.filter((p) => p !== pin);
    sound.unpin();
  } else if (para) {
    const doc = documents.all[+para.dataset.doc], passage = doc.paragraphs[+para.dataset.para];
    const existing = seg.pins.find((p) => p.kind === "ref" && p.text === passage);
    if (existing) { seg.pins = seg.pins.filter((p) => p !== existing); sound.unpin(); }
    else {
      seg.pins.push({ kind: "ref", doc, text: passage, homeY: e.clientY, born: performance.now(), level: 1,
        get x() { return W - 8 - PANEL * easeOut(refsT); },
        get y() {
          const el = refsT > 0.5 && [...refsEl.querySelectorAll(".doc p")].find((p) => p.textContent === this.text);
          if (!el) return this.homeY;
          const r = el.getBoundingClientRect();
          return Math.max(24, Math.min(H - 24, r.top + Math.min(r.height / 2, 14)));
        } });
      planted.push({ x: e.clientX, y: e.clientY, born: performance.now(), level: 1 });
      sound.plant(2);
    }
  } else {
    const a = aimAt(e.clientX, e.clientY);
    if (!a?.level) return;
    if (seg.pins.filter((p) => p.kind === "meaning").length >= MAX_PINS) return toast(`up to ${MAX_PINS} pins: click one to remove it`);
    seg.pins.push({ ...pullOf(a), q: a.q, deg: a.deg, born: performance.now(),
      get x() { return ellipsePoint(this.q, this.deg)[0]; },
      get y() { return ellipsePoint(this.q, this.deg)[1]; } });
    planted.push({ x: e.clientX, y: e.clientY, born: performance.now(), level: a.level });
    sound.plant(a.level);
    notify("pin");
  }
  render();
  refreshPreview();
});

async function save() {
  const target = seg;
  const pulls = target.pins.length ? target.pins : aim?.level ? [pullOf(aim)] : [];
  if (!pulls.length && !target.prompt) return toast(target.mode === "write" ? "pin a move, point at one, or type what you want" : "pin a meaning, point at one, or type what you want");
  collapse = { set: currentSet(), born: performance.now(), x: CX, y: CY, pins: target.pins.map((p) => ({ x: p.x, y: p.y })) };
  sound.save(pulls.length);
  notify("save");
  target.preview = null;
  const instant = !pulls.length || (pulls.length === 1 && pulls[0].kind === "meaning" && !pulls[0].partner && pulls[0].dir.basis === basisOf(target));
  if (!instant) { target.waiting = true; finish(target, false); }
  try { target.current = await combine(target, pulls); }
  catch (error) { toast(error.message); }
  target.waiting = false;
  finish(target, true);
}

function finish(target, fade) {
  target.done = true;
  aim = null;
  askInput.blur(); askInput.value = "";
  refsEl.classList.remove("show");
  if (fade) {
    changes++;
    target.fadeTimer = setTimeout(() => { if (seg === target) { forget(); render(); } }, 1700);
  }
  render();
}

function cancel() {
  collapse = { set: currentSet(), born: performance.now(), x: CX, y: CY, pins: [] };
  seg = null;
  aim = null;
  askInput.blur(); askInput.value = "";
  refsEl.classList.remove("show");
  render();
}

/* ---------- shorter with the arrow keys ---------- */

function shrinkKey(direction) {
  if (seg.mode !== "edit") return;
  if (direction > 0) return grow();
  const now = performance.now();
  shrinkState.combo = now - shrinkState.lastAt < COMBO_WINDOW ? shrinkState.combo + 1 : 1;
  shrinkState.lastAt = now;
  shrinkState.pending += 0.5 + 0.5 * Math.min(shrinkState.combo, 3);
  showMeter();
  sound.charge(shrinkState.combo);
  clearTimeout(shrinkState.timer);
  shrinkState.timer = setTimeout(runShrink, 170);
}

/** Five shorter versions of the passage, asked for when it is selected so the arrows answer at once. */
function ladderOf(target) {
  target.ladder ??= { rung: 0, versions: api("shrinks", { text, start: target.start, end: target.end }).then((reply) => reply.versions) };
  return target.ladder;
}

async function runShrink() {
  if (shrinkState.busy || !seg || seg.mode !== "edit") return;
  const steps = Math.max(1, Math.round(shrinkState.pending));
  shrinkState.pending = 0;
  shrinkState.busy = true;
  const target = seg, before = target.original;
  try {
    let ladder = ladderOf(target), versions = await ladder.versions;
    if (ladder.rung >= versions.length) {
      target.ladder = null;
      ladder = ladderOf(target);
      versions = await ladder.versions;
    }
    const rung = Math.min(versions.length, ladder.rung + steps);
    const shorter = versions.slice(ladder.rung, rung).findLast((version) => version && version.length < before.length);
    if (seg === target && shorter) {
      target.history.push({ text: before, rung: ladder.rung });
      ladder.rung = rung;
      await shatter(target, before, shorter);
      notify("shorter");
    }
  } catch (error) { toast(error.message); }
  shrinkState.busy = false;
  showMeter();
  if (shrinkState.pending) runShrink();
}

/** The words that go turn into white boxes, then break apart; the new wording flashes in. */
async function shatter(target, before, after) {
  target.prompt = null;
  target.promptFrom = null;
  target.pins = [];
  target.preview = null;
  target.doomedFrom = after;
  renderText();
  sound.crack();
  await wait(150);
  const boxes = [...textEl.querySelectorAll(".doomed")].flatMap((el) => [...el.getClientRects()]);
  for (const r of boxes) burst(r);
  sound.shatter(boxes.length);
  setText(text.slice(0, target.start) + after + text.slice(target.end));
  target.end = target.start + after.length;
  target.doomedFrom = null;
  target.bornFrom = before;
  target.original = target.current = after;
  renderBorn(target, before, after);
  reloadSoon(target);
}

function renderBorn(target, before, after) {
  renderText();
  const mid = textEl.querySelector(".seg");
  if (!mid) return;
  mid.innerHTML = "";
  for (const part of diffWords(before, after)) {
    const w = span(part.text);
    if (part.changed) w.className = "born";
    mid.append(w);
  }
}

function grow() {
  const target = seg;
  const entry = target.history.pop();
  if (!entry) return toast("nothing to bring back");
  const previous = entry.text;
  if (target.ladder) target.ladder.rung = entry.rung;
  setText(text.slice(0, target.start) + previous + text.slice(target.end));
  target.end = target.start + previous.length;
  const before = target.original;
  target.original = target.current = previous;
  target.pins = []; target.preview = null;
  sound.grow();
  renderBorn(target, before, previous);
  showMeter();
  reloadSoon(target);
}

function reloadSoon(target) {
  clearTimeout(target.reloadTimer);
  target.reloadTimer = setTimeout(() => {
    if (seg !== target) return;
    target.stale = true;
    loadSet(target);
  }, 700);
}

function showMeter() {
  if (!seg) return;
  const base = seg.history[0]?.text ?? seg.original;
  const words = (t) => t.split(/\s+/).filter(Boolean).length;
  const ratio = 1 - words(seg.original) / Math.max(1, words(base));
  const blocks = Math.min(10, Math.round(ratio * 10));
  const combo = shrinkState.combo > 1 && performance.now() - shrinkState.lastAt < COMBO_WINDOW * 2 ? `  combo ×${shrinkState.combo}` : "";
  meterEl.textContent = `shorter ${"■".repeat(blocks)}${"□".repeat(10 - blocks)} −${Math.round(ratio * 100)}%${combo}`;
  meterEl.classList.toggle("show", ratio > 0 || shrinkState.pending > 0);
  clearTimeout(showMeter.timer);
  showMeter.timer = setTimeout(() => meterEl.classList.remove("show"), 1800);
}

function burst(r) {
  const count = Math.max(6, Math.min(40, Math.round((r.width * r.height) / 60)));
  for (let i = 0; i < count; i++) {
    particles.push({
      x: r.left + Math.random() * r.width, y: r.top + Math.random() * r.height,
      vx: (Math.random() - 0.5) * 7, vy: -Math.random() * 5 - 1,
      size: 2 + Math.random() * 4, born: performance.now(), life: 600 + Math.random() * 600, spin: Math.random() * 0.4 - 0.2, angle: 0,
    });
  }
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ---------- keys ---------- */

/** Arrows shorten (← ↓) or bring back (→ ↑) the passage, but only while nothing is typed in the ask bar; otherwise they move through what you typed. */
const ARROWS = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };

function moveInAsk(key) {
  askInput.focus();
  const at = askInput.selectionStart ?? askInput.value.length;
  const to = key === "ArrowLeft" ? at - 1 : key === "ArrowRight" ? at + 1 : key === "ArrowUp" ? 0 : askInput.value.length;
  const clamped = Math.max(0, Math.min(askInput.value.length, to));
  askInput.setSelectionRange(clamped, clamped);
}

addEventListener("keydown", (e) => {
  if (document.body.classList.contains("editing") || e.target === askInput || e.target.closest?.("#refs")) return;
  if (!isOpen()) return;
  if (e.key === "Escape") return cancel();
  if (e.key === "Enter") { e.preventDefault(); return save(); }
  if (ARROWS[e.key]) {
    e.preventDefault();
    if (askInput.value) return moveInAsk(e.key);
    return shrinkKey(ARROWS[e.key]);
  }
  if (e.key === "/" || (e.key.length === 1 && /\p{L}|\p{N}/u.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey)) {
    e.preventDefault();
    if (e.key !== "/") askInput.value += e.key;
    askInput.focus();
  }
});

askInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { askInput.value = ""; askInput.blur(); return; }
  if (ARROWS[e.key] && !askInput.value) { e.preventDefault(); return shrinkKey(ARROWS[e.key]); }
  if (e.key !== "Enter") return;
  e.preventDefault();
  const query = askInput.value.trim();
  askInput.value = "";
  askInput.blur();
  askFor(query, !e.shiftKey);
});
askedEl.addEventListener("mousedown", (e) => { e.preventDefault(); clearPrompt(); });

/** The plain editor for pasting or typing the text. Leaving it empty brings back the front page. */
function setEditing(on, starting = text) {
  const editor = $("editor");
  document.body.classList.toggle("editing", on);
  $("edit").textContent = on ? "done" : "edit text";
  if (on) {
    forget();
    editor.value = starting;
    editor.focus();
  } else {
    setText(editor.value.trim() || text);
    changes = 0;
    home = !text;
    render();
  }
}

function leaveHome() {
  home = false;
  render();
  scrollTo(0, 0);
}

/** The first time someone starts without a key, asks whether they want a real model or the simulator. */
const CHOSEN_STORAGE = "feeling-mode-chosen";
let afterChoice = null;
function begin(action) {
  let chosen = true;
  try { chosen = !!localStorage.getItem(CHOSEN_STORAGE); } catch {}
  if (settings.apiKey || chosen) return action();
  afterChoice = action;
  openKeyDialog(true);
}

$("edit").addEventListener("click", () => setEditing(!document.body.classList.contains("editing")));
$("home").addEventListener("click", () => {
  if (document.body.classList.contains("editing")) setEditing(false);
  forget();
  home = true;
  render();
  scrollTo(0, 0);
});
$("startOwn").addEventListener("click", () => begin(() => setEditing(true)));
$("startSample").addEventListener("click", () => begin(() => { setText(SAMPLE); leaveHome(); }));
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(text); toast("copied"); } catch { toast("could not copy: select the text and copy it by hand"); }
});

addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || e.target.closest?.("input, textarea") || isOpen()) return;
  e.preventDefault();
  undo(!e.shiftKey);
});
const keyDialog = $("keyDialog");
/** As a first-time choice the dialog offers the simulator instead of "cancel"; from the top bar it manages the key. */
function openKeyDialog(asChoice) {
  $("keyTitle").textContent = asChoice ? "a real model, or the simulator?" : "go live with Cerebras";
  $("keyCancel").textContent = asChoice ? "use the simulator" : "cancel";
  $("keySave").textContent = asChoice ? "use this key" : "save";
  $("keyRemove").hidden = asChoice;
  $("keyInput").value = settings.apiKey;
  $("modelInput").value = settings.model;
  keyDialog.returnValue = "";
  keyDialog.showModal();
}
$("live").addEventListener("click", () => openKeyDialog(false));
keyDialog.addEventListener("close", () => {
  if (keyDialog.returnValue === "save") settings.save({ apiKey: $("keyInput").value, model: $("modelInput").value });
  if (keyDialog.returnValue === "remove") settings.save({ apiKey: "", model: "" });
  renderLive();
  if (!afterChoice) return;
  const action = afterChoice;
  afterChoice = null;
  try { localStorage.setItem(CHOSEN_STORAGE, "yes"); } catch {}
  action();
});
renderLive();
function renderLive() { $("live").textContent = isLive() ? `live · ${settings.model}` : "simulator · add key"; }

$("sound").addEventListener("click", () => { sound.toggle(); renderSound(); });
renderSound();
function renderSound() { $("sound").textContent = sound.muted ? "sound off" : "sound on"; }

function renderPanel() {
  const pinned = new Set(seg?.pins.filter((p) => p.kind === "ref").map((p) => p.text) ?? []);
  for (const p of refsEl.querySelectorAll(".doc p")) p.classList.toggle("pinned", pinned.has(p.textContent));
}

/* ---------- the tour ---------- */

if (CLIP) {
  startAutopilot({
    text: () => text,
    isOpen,
    isBusy: () => !!seg && (seg.waiting || seg.asking || seg.loading),
    select(start, end) { forget(); open({ mode: "edit", start, end, original: text.slice(start, end) }); },
    writeAt(offset) { forget(); open({ mode: "write", start: offset, end: offset, original: "" }); },
    /** A spot in a strength band on one arc of the ring; `across` runs from one side of the arc (0) to the other (1). */
    point(index, level, across = 0.5) {
      const count = currentSet().length;
      return ellipsePoint(INNER + ((OUTER - INNER) * (level - 0.5)) / 3, ((index + across) * 360) / count);
    },
    /** Where a stretch of the text sits on screen. Closes any open passage first, so the text is one plain run. */
    rects(start, end) {
      forget();
      render();
      const node = textEl.firstChild.firstChild, range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      return [...range.getClientRects()];
    },
    reset() {
      if (seg) clearTimeout(seg.fadeTimer);
      seg = null; aim = null; changes = 0;
      text = DEMO_TEXT;
      undone.past = []; undone.future = [];
      askInput.value = "";
      refsEl.classList.remove("show");
      sound.silence(pilot.running);
      render();
    },
  }, CLIP);
}

/* ---------- your documents ---------- */

$("documents").addEventListener("click", () => refsEl.classList.toggle("show"));
$("refsClose").addEventListener("click", () => refsEl.classList.remove("show"));

$("docs").addEventListener("click", (e) => {
  const button = e.target.closest(".remove");
  if (!button) return;
  if (!button.classList.contains("armed")) {
    button.classList.add("armed");
    button.textContent = "delete?";
    return;
  }
  const doc = documents.all[+button.dataset.doc];
  if (seg) seg.pins = seg.pins.filter((p) => p.doc !== doc);
  documents.remove(+button.dataset.doc);
  buildDocs();
  if (seg) refreshPreview();
});

const docForm = $("docForm");
$("docAdd").addEventListener("click", () => { docForm.hidden = false; $("docAdd").hidden = true; $("docTitle").focus(); });
$("docCancel").addEventListener("click", closeDocForm);
docForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!documents.add($("docTitle").value, $("docBody").value)) return toast("paste or type some text first");
  buildDocs();
  closeDocForm();
});
function closeDocForm() { docForm.reset(); docForm.hidden = true; $("docAdd").hidden = false; }

/* ---------- drawing ---------- */

function frame(t) {
  requestAnimationFrame(frame);
  document.body.classList.toggle("typing", isOpen() && !!askInput.value);
  try { draw(t); } catch (error) { console.error(error); }
}

function draw(t) {
  const time = t / 1000;
  const open = isOpen();
  openT += ((open ? 1 : 0) - openT) * (open ? 0.07 : 0.2);
  if (open && openT > 0.995) openT = 1;
  labelT = Math.min(1, labelT + 0.035);
  refsT += ((refsEl.classList.contains("show") ? 1 : 0) - refsT) * 0.12;
  layoutRing();
  ctx.clearRect(0, 0, W, H);
  if (open) drawRing(currentSet(), openT, time);
  drawCollapse();
  if (open) drawPins(time);
  drawPlanted();
  drawParticles();
  if (open && !overPanel(mouse.x)) drawCursor();
  
}

function ellipsePoint(q, deg) {
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
    const target = !aim?.level ? 0 : aim.index === i ? 1 : aim.blendWith === i ? 0.7 : 0;
    glow[i] += (target - glow[i]) * 0.18;
    const g = glow[i];
    const end = Math.min(to, sweep);
    if (end <= from) return;

    if (g > 0.02 && aim?.level) {
      const qc = Math.min(aim.q, OUTER);
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
        const passed = aim.level > k;
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
    if (g > 0.5 && aim?.level && aim.index === i) ctx.fillText(`${"■".repeat(aim.level)}${"□".repeat(3 - aim.level)} ${names()[aim.level]}`, lx, strengthY);
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
  const idle = !aim?.level ? 1 : 0;
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
  if (mouse.x < 0) return;
  const now = performance.now();
  trail = trail.filter((p) => now - p.at < 220);
  trail.forEach((p) => {
    const k = 1 - (now - p.at) / 220;
    ctx.fillStyle = `rgba(255,255,255,${0.25 * k})`;
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  });
  const level = aim?.level ?? 0;
  if (level) {
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.setLineDash([2, 5]);
    const [ix, iy] = ellipsePoint(INNER, aim.deg);
    ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
    ctx.setLineDash([]);
  }
  const size = 4 + level * 2;
  ctx.fillStyle = "#fff";
  ctx.fillRect(mouse.x - size / 2, mouse.y - size / 2, size, size);
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
  const pins = seg.pins;
  for (let i = 1; i < pins.length; i++) bond(pins[i - 1], pins[i], 1);
  if (pins.length > 2) bond(pins[pins.length - 1], pins[0], 0.45);
  if (pins.length && aim?.level && !nearPin(mouse.x, mouse.y)) bond(pins[pins.length - 1], mouse, 0.4);
  ctx.font = "400 10px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  for (const p of pins) {
    const hovered = Math.hypot(p.x - mouse.x, p.y - mouse.y) < 14;
    const size = 5 + p.level * 2 + 0.8 * Math.sin(time * 2.4 + p.born);
    ctx.fillStyle = hovered ? "rgba(255,255,255,0.45)" : "#fff";
    if (p.kind === "ref") { ctx.beginPath(); ctx.arc(p.x, p.y, size / 1.6, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.strokeRect(p.x - size, p.y - size, size * 2, size * 2);
    if (p.kind === "ref") {
      if (refsT < 0.5) { ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillText(hovered ? "× remove" : p.doc.title, p.x - 12, p.y + 3); ctx.textAlign = "center"; }
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

function easeOut(x) { return 1 - (1 - Math.min(1, Math.max(0, x))) ** 3; }

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
