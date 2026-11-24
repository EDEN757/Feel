/** The mode dialog: demo or live, and for live the key and the model. Also the mode label in the top bar. */

import { $, toast } from "./dom.js";
import { MODELS, isLive, settings } from "./llm/index.js";

const dialog = $("keyDialog"), fields = $("liveFields"), note = $("keyNote");
const choice = (mode) => dialog.querySelector(`input[name="mode"][value="${mode}"]`);

function open() {
  // A model saved by hand earlier stays selectable, even if it is not one of the listed ones.
  const ids = [...new Set([...MODELS.map((model) => model.id), settings.model])];
  $("modelInput").replaceChildren(...ids.map((id) => new Option(id, id)));
  $("modelInput").value = settings.model;
  $("keyInput").value = settings.apiKey;
  choice(settings.live ? "live" : "demo").checked = true;
  dialog.returnValue = "";
  show();
  dialog.showModal();
}

/** The key and model appear only once live is chosen. */
function show() {
  const live = choice("live").checked;
  fields.hidden = !live;
  $("keyRemove").hidden = !live || !settings.apiKey;
  note.classList.remove("missing");
}

function renderLive() { $("live").textContent = isLive() ? `mode: live · ${settings.model}` : "mode: demo"; }

$("live").addEventListener("click", open);
$("modes").addEventListener("change", () => { show(); if (choice("live").checked) $("keyInput").focus(); });

/** Live needs a key: without one the dialog stays open and says so. */
$("keySave").addEventListener("click", (e) => {
  if (!choice("live").checked || $("keyInput").value.trim()) return;
  e.preventDefault();
  note.classList.add("missing");
  $("keyInput").placeholder = "paste your key here to go live";
  $("keyInput").focus();
});

dialog.addEventListener("close", () => {
  if (dialog.returnValue === "save") settings.save({ apiKey: $("keyInput").value, model: $("modelInput").value, live: choice("live").checked });
  if (dialog.returnValue === "remove") settings.save({ apiKey: "", model: "" });
  renderLive();
  dispatchEvent(new Event("feel:mode"));
});
settings.onPause = (ms) => toast(`rate limit reached: trying again in ${Math.ceil(ms / 1000)}s`);
renderLive();
