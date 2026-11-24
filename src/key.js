/** The connection to a real model: the key dialog, the label in the top bar, and the first-time choice. */

import { $, toast } from "./dom.js";
import { MODELS, isLive, settings } from "./llm/index.js";

const CHOSEN_STORAGE = "feeling-mode-chosen";
const dialog = $("keyDialog");
let afterChoice = null;

/** Runs `action`; the first time someone starts without a key, asks first whether they want a real model or the simulator. */
export function begin(action) {
  let chosen = true;
  try { chosen = !!localStorage.getItem(CHOSEN_STORAGE); } catch {}
  if (settings.apiKey || chosen) return action();
  afterChoice = action;
  open(true);
}

/** As a first-time choice the dialog offers the simulator instead of "cancel"; from the top bar it manages the key. */
function open(asChoice) {
  $("keyTitle").textContent = asChoice ? "a real model, or the simulator?" : "go live with Cerebras";
  $("keyCancel").textContent = asChoice ? "use the simulator" : "cancel";
  $("keySave").textContent = asChoice ? "use this key" : "save";
  $("keyRemove").hidden = asChoice;
  $("keyInput").value = settings.apiKey;
  // A model saved by hand earlier stays selectable, even if it is not one of the listed ones.
  const ids = [...new Set([...MODELS.map((model) => model.id), settings.model])];
  $("modelInput").replaceChildren(...ids.map((id) => new Option(id, id)));
  $("modelInput").value = settings.model;
  dialog.returnValue = "";
  dialog.showModal();
}

function renderLive() { $("live").textContent = isLive() ? `live · ${settings.model}` : "simulator · add key"; }

$("live").addEventListener("click", () => open(false));
dialog.addEventListener("close", () => {
  if (dialog.returnValue === "save") settings.save({ apiKey: $("keyInput").value, model: $("modelInput").value });
  if (dialog.returnValue === "remove") settings.save({ apiKey: "", model: "" });
  renderLive();
  if (!afterChoice) return;
  const action = afterChoice;
  afterChoice = null;
  try { localStorage.setItem(CHOSEN_STORAGE, "yes"); } catch {}
  action();
});
settings.onPause = (ms) => toast(`rate limit reached: trying again in ${Math.ceil(ms / 1000)}s`);
renderLive();
