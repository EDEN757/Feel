/** The writer's reference documents, kept in this browser. Starts with the placeholders from sample.js. */

import { DOCS } from "./sample.js"

const STORAGE = "feeling-documents"

let all = load()

export const documents = {
  get all() { return all },

  /** Adds a document; blank lines in `body` separate its passages. Returns false when there is nothing to add. */
  add(title, body) {
    const paragraphs = body.split(/\n\s*\n/).map((passage) => passage.replace(/\s+/g, " ").trim()).filter(Boolean)
    if (!paragraphs.length) return false
    all = [...all, { title: title.trim() || `document ${all.length + 1}`, paragraphs }]
    save()
    return true
  },

  remove(index) {
    all = all.filter((_, i) => i !== index)
    save()
  },
}

function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE))
    if (Array.isArray(stored)) return stored
  } catch {}
  return DOCS
}

function save() {
  try { localStorage.setItem(STORAGE, JSON.stringify(all)) } catch {}
}
