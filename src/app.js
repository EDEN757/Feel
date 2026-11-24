/**
 * The writing surface: the text, the passage being shaped, and what each gesture does to it.
 * Selecting or clicking opens a passage; moving on the ring aims at a meaning; clicking pins it;
 * typing asks in words; Enter saves. The ring itself is drawn by ring.js from what is decided here.
 */

import { pilot, startAutopilot } from "./autopilot.js";
import { diffWords } from "./diff.js";
import { documents } from "./documents.js";
import { $, span, toast } from "./dom.js";
import "./key.js";
import "./landing.js";
import { isLive, request as api, settings } from "./llm/index.js";
import { createPanel } from "./panel.js";
import { H, PANEL, W, bandPoint, draw, easeOut, ellipsePoint, flash, fold, locate, panelOut, plant, relabel, trace, unfold } from "./ring.js";
import { SAMPLE } from "./sample.js";
import { createShortener } from "./shorten.js";
import { createSound } from "./sound.js";

const NAMES = { edit: ["", "slight", "medium", "strong"], write: ["", "phrase", "sentence", "paragraph"] };
const KEYS = ["", "slight", "medium", "strong"];
const MEANINGS = 6, MAX_MEANINGS = 8;
const SCROLL_PAUSE = 450;
/** Pushing the cursor this close to the right edge slides the documents out. */
const EDGE = 26;
const MAX_PINS = 4;

const textEl = $("text"), hintEl = $("hint"), statusEl = $("status"), askEl = $("ask"), askInput = $("askInput"), askedEl = $("asked");
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
/** Phones and narrow windows stay on the front page: the editor needs a mouse, a keyboard and room for the ring. */
const SMALL = !DEMO && matchMedia("(max-width: 760px), (hover: none) and (pointer: coarse)").matches;
let home = !text || SMALL;
let seg = null;
let changes = 0;
let mouse = { x: -1, y: -1 };
let aim = null;
let scrollLock = 0;
let downAt = null;
const sound = createSound();

const panel = createPanel({
  pinned: () => seg?.pins.filter((p) => p.kind === "ref").map((p) => p.text) ?? [],
  onDelete(doc) {
    if (!seg) return;
    seg.pins = seg.pins.filter((p) => p.doc !== doc);
    refreshPreview();
  },
});
const refsEl = panel.el;
const shortener = createShortener({ passage: () => seg, text: () => text, setText, renderText, reload: loadSet, sound });

render();
requestAnimationFrame(frame);
function isOpen() { return !!seg && !seg.done && !!currentSet()?.length; }
function currentSet() { return seg?.sets?.[seg.setIndex] ?? null; }
function names() { return NAMES[seg?.mode === "write" && !seg?.prompt ? "write" : "edit"]; }

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
  $("heroStart").firstChild.textContent = text ? "back to your text " : "try it ";
  renderText();
  statusEl.textContent = changes ? `  ·  ${changes} change${changes > 1 ? "s" : ""}` : "";
  document.body.classList.toggle("open", isOpen());
  const set = currentSet();
  if (!seg || seg.done) hintEl.innerHTML = `<b>select</b> words to reshape them  ·  <b>click</b> between words to write there  ·  scroll to read${isLive() || DEMO ? "" : "<br>demo mode: pre-written answers for the sample letter · <b>edit text</b> for your own · switch the <b>mode</b> to live for a real model"}`;
  else if (!set) hintEl.textContent = seg.mode === "write" ? "thinking about what could go here…" : "reading the passage…";
  else if (DEMO) hintEl.innerHTML = "<b>move</b> toward a meaning · <b>click</b> to pin · <b>↵</b> save · <b>type</b> to ask · <b>←</b> shorter · <b>esc</b> cancel";
  else {
    const what = seg.mode === "write" ? "a move, further out writes more" : "a meaning, nearer the edge is stronger";
    const pins = seg.pins.length ? ` (${seg.pins.length} pinned)` : "";
    const arrows = seg.mode === "edit" ? " · <b>← ↓</b> shorter, tap fast for more · <b>→ ↑</b> back (when the ask bar is empty)" : "";
    hintEl.innerHTML = `<b>move</b> toward ${what} · <b>click</b> to pin${pins} · <b>↵</b> save${arrows}<br><b>scroll</b> ↓ new ${seg.mode === "write" ? "moves" : "meanings"} ↑ back (${seg.setIndex + 1}/${seg.sets.length}) · push the <b>right edge</b> for references · <b>type</b> to ask (↵ changes the text, ⇧↵ only the ring) · <b>esc</b> cancel`;
  }
  panel.render();
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
  unfold();
  sound.wake();
  if (!isLive() && !DEMO && !SAMPLE.includes(text.slice(0, 60)) && !open.warned) {
    open.warned = true;
    toast("demo mode: the answers only fit the sample letter, so changes here are rough. Switch the mode to live for a real model.");
  }
  if (seg.mode === "edit") shortener.prepare(seg);
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
    relabel();
    ahead(api(route, { text, start: target.start, end: target.end, count: MEANINGS, exclude: target.sets.flat().map((d) => d.label) }, { ahead: true }));
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
  const count = currentSet()?.length ?? 0;
  if (!count || overPanel(x)) return null;
  return locate(x, y, count);
}

function overPanel(x) { return refsEl.classList.contains("show") && x > W - PANEL; }

function updateAim() {
  if (!isOpen()) return;
  const next = aimAt(mouse.x, mouse.y);
  const same = (a, b) => (!a && !b) || (a && b && a.index === b.index && a.level === b.level && a.blendWith === b.blendWith);
  if (next && aim && next.level && next.index !== aim.index) sound.meaning(next.index);
  if (next && next.level !== (aim?.level ?? 0) && next.level) {
    sound.tick(next.level);
    flash(next.index, next.level);
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
    if (!apply) {
      target.sets.push(directions.map((d) => ({ ...d, kind: d.kept ? "kept" : "suggested", basis: basisOf(target) })));
      target.setIndex = target.sets.length - 1;
      relabel(); aim = null;
      sound.swap();
      return;
    }
    if (target.promptFrom == null) target.promptFrom = target.setIndex;
    target.prompt = { query: target.prompt ? `${target.prompt.query} → ${query}` : query, text: result };
    target.pins = target.pins.filter((p) => p.kind === "ref");
    target.sets.push(directions.map((d) => ({ ...d, kind: d.kept ? "kept" : "suggested", basis: result })));
    target.setIndex = target.sets.length - 1;
    relabel(); aim = null;
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
  return seg?.pins.find((p) => (p.kind !== "ref" || panelOut() < 0.5) && Math.hypot(p.x - x, p.y - y) < 14) ?? null;
}

addEventListener("mousemove", (e) => {
  mouse = { x: e.clientX, y: e.clientY };
  trace(mouse.x, mouse.y);
  if (isOpen()) {
    const wantPanel = mouse.x > W - EDGE || (refsEl.classList.contains("show") && mouse.x > W - PANEL - 40) || refsEl.contains(document.activeElement);
    refsEl.classList.toggle("show", wantPanel);
  }
  updateAim();
});

addEventListener("wheel", (e) => {
  if (!isOpen() || seg.loading || e.target.closest?.("#refs")) return;
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
  relabel();
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
        get x() { return W - 8 - PANEL * easeOut(panelOut()); },
        get y() {
          const el = panelOut() > 0.5 && [...refsEl.querySelectorAll(".doc p")].find((p) => p.textContent === this.text);
          if (!el) return this.homeY;
          const r = el.getBoundingClientRect();
          return Math.max(24, Math.min(H - 24, r.top + Math.min(r.height / 2, 14)));
        } });
      sound.plant(2);
    }
  } else {
    const a = aimAt(e.clientX, e.clientY);
    if (!a?.level) return;
    if (seg.pins.filter((p) => p.kind === "meaning").length >= MAX_PINS) return toast(`up to ${MAX_PINS} pins: click one to remove it`);
    seg.pins.push({ ...pullOf(a), q: a.q, deg: a.deg, born: performance.now(),
      get x() { return ellipsePoint(this.q, this.deg)[0]; },
      get y() { return ellipsePoint(this.q, this.deg)[1]; } });
    plant(e.clientX, e.clientY, a.level);
    sound.plant(a.level);
  }
  render();
  refreshPreview();
});

async function save() {
  const target = seg;
  const pulls = target.pins.length ? target.pins : aim?.level ? [pullOf(aim)] : [];
  if (!pulls.length && !target.prompt) return toast(target.mode === "write" ? "pin a move, point at one, or type what you want" : "pin a meaning, point at one, or type what you want");
  fold(currentSet(), target.pins.map((p) => ({ x: p.x, y: p.y })));
  sound.save(pulls.length);
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
  fold(currentSet(), []);
  seg = null;
  aim = null;
  askInput.blur(); askInput.value = "";
  refsEl.classList.remove("show");
  render();
}

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
    return shortener.key(ARROWS[e.key]);
  }
  if (e.key === "/" || (e.key.length === 1 && /\p{L}|\p{N}/u.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey)) {
    e.preventDefault();
    if (e.key !== "/") askInput.value += e.key;
    askInput.focus();
  }
});

askInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { askInput.value = ""; askInput.blur(); return; }
  if (ARROWS[e.key] && !askInput.value) { e.preventDefault(); return shortener.key(ARROWS[e.key]); }
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

$("edit").addEventListener("click", () => setEditing(!document.body.classList.contains("editing")));
$("editDone").addEventListener("click", () => setEditing(false));
/** Cancel leaves the text as it was before the editor opened. */
$("editCancel").addEventListener("click", () => { $("editor").value = text; setEditing(false); });
$("editor").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setEditing(false); } });
$("home").addEventListener("click", () => {
  if (document.body.classList.contains("editing")) setEditing(false);
  forget();
  home = true;
  render();
  scrollTo(0, 0);
});
/** The button on the first screen: opens on the sample letter, or goes back to the text when there already is one. */
$("heroStart").addEventListener("click", () => {
  if (!text) setText(SAMPLE);
  leaveHome();
});
addEventListener("feel:mode", render);
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(text); toast("copied"); } catch { toast("could not copy: select the text and copy it by hand"); }
});

addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || e.target.closest?.("input, textarea") || isOpen()) return;
  e.preventDefault();
  undo(!e.shiftKey);
});

$("sound").addEventListener("click", () => { sound.toggle(); renderSound(); });
renderSound();
function renderSound() { $("sound").textContent = sound.muted ? "sound off" : "sound on"; }

/* ---------- the tour ---------- */

if (CLIP) {
  startAutopilot({
    text: () => text,
    isOpen,
    isBusy: () => !!seg && (seg.waiting || seg.asking || seg.loading),
    select(start, end) { forget(); open({ mode: "edit", start, end, original: text.slice(start, end) }); },
    writeAt(offset) { forget(); open({ mode: "write", start: offset, end: offset, original: "" }); },
    point(index, level, across = 0.5) {
      return bandPoint(index, level, across, currentSet().length);
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

/* ---------- every frame ---------- */

function frame(t) {
  requestAnimationFrame(frame);
  const typing = isOpen() && !!askInput.value;
  document.body.classList.toggle("typing", typing);
  // The ask bar grows with what is typed. Measured every frame while typing, because its text size is animated.
  if (typing || askInput.style.height) {
    askInput.style.height = "";
    if (typing) askInput.style.height = `${askInput.scrollHeight}px`;
  }
  const view = { open: isOpen(), set: currentSet(), aim, mouse, pins: seg?.pins ?? [], names: names(), panel: refsEl.classList.contains("show"), overPanel: overPanel(mouse.x), onPin: !!nearPin(mouse.x, mouse.y), busy: !!seg && !!(seg.waiting || seg.asking || seg.loading) };
  try { draw(t, view); } catch (error) { console.error(error); }
}
