/** Small helpers for the page itself, shared by the modules that touch it. */

export const $ = (id) => document.getElementById(id);

export function span(text) {
  const el = document.createElement("span");
  el.textContent = text;
  return el;
}

export function esc(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A short message in the corner that clears itself. */
export function toast(message) {
  const el = $("toast");
  el.textContent = message;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.textContent = ""), 4000);
}
