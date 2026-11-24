/**
 * Shorter with the arrow keys. ← or ↓ cuts the open passage, → or ↑ brings the last cut back; quick taps cut more.
 * The shorter versions are asked for when the passage is selected, so each tap only shows one that is already there.
 */

import { diffWords } from "./diff.js";
import { $, span, toast, wait } from "./dom.js";
import { request } from "./llm/index.js";
import { burst } from "./ring.js";

/** Taps closer together than this build a combo, and each one cuts more. */
const COMBO_WINDOW = 320;

/**
 * @param app what this needs from the app: passage() the open passage or null; text() and setText(next);
 *   renderText(); reload(passage) to fetch meanings for the new wording; notify(step); sound.
 */
export function createShortener({ passage, text, setText, renderText, reload, notify, sound }) {
  const textEl = $("text"), meterEl = $("meter");
  const taps = { pending: 0, combo: 0, lastAt: 0, timer: null, busy: false };
  let meterTimer = null;

  function key(direction) {
    if (passage().mode !== "edit") return;
    if (direction > 0) return grow();
    const now = performance.now();
    taps.combo = now - taps.lastAt < COMBO_WINDOW ? taps.combo + 1 : 1;
    taps.lastAt = now;
    taps.pending += 0.5 + 0.5 * Math.min(taps.combo, 3);
    showMeter();
    sound.charge(taps.combo);
    clearTimeout(taps.timer);
    taps.timer = setTimeout(run, 170);
  }

  /** Five shorter versions of the passage as it was when first selected; `rung` is how far down them it has gone. */
  function ladderOf(target, early = false) {
    target.ladder ??= { rung: 0, passage: { text: text(), start: target.start, end: target.end } };
    target.ladder.versions = request("shrinks", target.ladder.passage, { ahead: early }).then((reply) => reply.versions);
    return target.ladder;
  }

  async function run() {
    const target = passage();
    if (taps.busy || !target || target.mode !== "edit") return;
    const steps = Math.max(1, Math.round(taps.pending));
    taps.pending = 0;
    taps.busy = true;
    const before = target.original;
    try {
      let ladder = ladderOf(target), versions = await ladder.versions;
      if (ladder.rung >= versions.length) {
        target.ladder = null;
        ladder = ladderOf(target);
        versions = await ladder.versions;
      }
      const rung = Math.min(versions.length, ladder.rung + steps);
      const shorter = versions.slice(ladder.rung, rung).findLast((version) => version && version.length < before.length);
      if (passage() === target && shorter) {
        target.history.push({ text: before, rung: ladder.rung });
        ladder.rung = rung;
        await shatter(target, before, shorter);
        notify("shorter");
      }
    } catch (error) { toast(error.message); }
    taps.busy = false;
    showMeter();
    if (taps.pending) run();
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
    for (const box of boxes) burst(box);
    sound.shatter(boxes.length);
    replace(target, after);
    target.doomedFrom = null;
    target.bornFrom = before;
    renderBorn(before, after);
    reloadSoon(target);
  }

  function grow() {
    const target = passage();
    const entry = target.history.pop();
    if (!entry) return toast("nothing to bring back");
    if (target.ladder) target.ladder.rung = entry.rung;
    const before = target.original;
    replace(target, entry.text);
    target.pins = []; target.preview = null;
    sound.grow();
    renderBorn(before, entry.text);
    showMeter();
    reloadSoon(target);
  }

  /** Puts new wording in the passage's place and makes it the passage's starting point. */
  function replace(target, wording) {
    const all = text();
    setText(all.slice(0, target.start) + wording + all.slice(target.end));
    target.end = target.start + wording.length;
    target.original = target.current = wording;
  }

  /** Shows the passage with the words that changed marked as newly arrived. */
  function renderBorn(before, after) {
    renderText();
    const mid = textEl.querySelector(".seg");
    if (!mid) return;
    mid.innerHTML = "";
    for (const part of diffWords(before, after)) {
      const word = span(part.text);
      if (part.changed) word.className = "born";
      mid.append(word);
    }
  }

  /** Once the taps stop, the ring's meanings are fetched again for the new wording. */
  function reloadSoon(target) {
    clearTimeout(target.reloadTimer);
    target.reloadTimer = setTimeout(() => {
      if (passage() !== target) return;
      target.stale = true;
      reload(target);
    }, 700);
  }

  function showMeter() {
    const target = passage();
    if (!target) return;
    const base = target.history[0]?.text ?? target.original;
    const words = (wording) => wording.split(/\s+/).filter(Boolean).length;
    const ratio = 1 - words(target.original) / Math.max(1, words(base));
    const blocks = Math.min(10, Math.round(ratio * 10));
    const combo = taps.combo > 1 && performance.now() - taps.lastAt < COMBO_WINDOW * 2 ? `  combo ×${taps.combo}` : "";
    meterEl.textContent = `shorter ${"■".repeat(blocks)}${"□".repeat(10 - blocks)} −${Math.round(ratio * 100)}%${combo}`;
    meterEl.classList.toggle("show", ratio > 0 || taps.pending > 0);
    clearTimeout(meterTimer);
    meterTimer = setTimeout(() => meterEl.classList.remove("show"), 1800);
  }

  return {
    key,
    /** Asks for the shorter versions ahead of need. A failure here can wait until an arrow is pressed. */
    prepare(target) { ladderOf(target, true).versions.catch(() => {}); },
  };
}
