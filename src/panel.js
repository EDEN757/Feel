/** The documents panel on the right: the writer's own documents, to add, delete and reference. */

import { documents } from "./documents.js";
import { $, esc, toast } from "./dom.js";

/**
 * @param pinned returns the passages referenced right now, so they can be shown highlighted
 * @param onDelete called with a document after it has been deleted
 */
export function createPanel({ pinned, onDelete }) {
  const el = $("refs"), form = $("docForm");

  function build() {
    $("docs").innerHTML = documents.all.map((doc, i) => `<div class="doc"><h3>${esc(doc.title)}<button class="remove" data-doc="${i}" title="delete this document">×</button></h3>${doc.paragraphs.map((p, j) => `<p data-doc="${i}" data-para="${j}">${esc(p)}</p>`).join("")}</div>`).join("") || `<p class="note">no documents yet</p>`;
    render();
  }

  function render() {
    const texts = new Set(pinned());
    for (const p of el.querySelectorAll(".doc p")) p.classList.toggle("pinned", texts.has(p.textContent));
  }

  function closeForm() { form.reset(); form.hidden = true; $("docAdd").hidden = false; }

  $("documents").addEventListener("click", () => el.classList.toggle("show"));
  $("refsClose").addEventListener("click", () => el.classList.remove("show"));

  /** Deleting takes two clicks: the first arms the button. */
  $("docs").addEventListener("click", (e) => {
    const button = e.target.closest(".remove");
    if (!button) return;
    if (!button.classList.contains("armed")) {
      button.classList.add("armed");
      button.textContent = "delete?";
      return;
    }
    const doc = documents.all[+button.dataset.doc];
    documents.remove(+button.dataset.doc);
    build();
    onDelete(doc);
  });

  $("docAdd").addEventListener("click", () => { form.hidden = false; $("docAdd").hidden = true; $("docTitle").focus(); });
  $("docCancel").addEventListener("click", closeForm);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!documents.add($("docTitle").value, $("docBody").value)) return toast("paste or type some text first");
    build();
    closeForm();
  });

  build();
  return { el, render };
}
