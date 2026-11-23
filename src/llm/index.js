/**
 * The one door to the model. `request(kind, payload)` answers from the simulator until a Cerebras key is saved.
 *
 * Replies are remembered for the life of the page, keyed by the exact request. That is what makes it cheap to ask
 * ahead of time: a request made speculatively and the same request made for real share one call.
 */

import { complete, DEFAULT_MODEL } from "./cerebras.js"
import { PROMPTS, SYSTEM } from "./prompts.js"
import { simulate } from "./simulator.js"

const KEY_STORAGE = "feeling-cerebras-key"
const MODEL_STORAGE = "feeling-cerebras-model"
const MAX_AT_ONCE = 4

const remembered = new Map()
const waiting = []
let running = 0

/** The key and model live only in this browser's localStorage. */
export const settings = {
  /** Set to answer from the simulator even when a key is saved. */
  simulate: false,
  get apiKey() { return read(KEY_STORAGE) },
  get model() { return read(MODEL_STORAGE) || DEFAULT_MODEL },
  save({ apiKey, model }) {
    write(KEY_STORAGE, apiKey.trim())
    write(MODEL_STORAGE, model.trim() === DEFAULT_MODEL ? "" : model.trim())
    remembered.clear()
  },
}

export function isLive() {
  return !!settings.apiKey && !settings.simulate
}

export function request(kind, payload) {
  const id = `${isLive() ? settings.model : "simulator"} ${kind} ${JSON.stringify(payload)}`
  if (!remembered.has(id)) {
    const reply = isLive() ? queued(() => ask(kind, payload)) : simulate(kind, payload)
    remembered.set(id, reply)
    reply.catch(() => remembered.delete(id))
  }
  return remembered.get(id)
}

function ask(kind, payload) {
  const { user, schema } = PROMPTS[kind](payload)
  return complete({ apiKey: settings.apiKey, model: settings.model, system: SYSTEM, user, schema })
}

/** Runs at most MAX_AT_ONCE calls together, so speculative requests do not trip the provider's rate limit. */
function queued(call) {
  return new Promise((resolve, reject) => {
    waiting.push({ call, resolve, reject })
    next()
  })
}

function next() {
  if (running >= MAX_AT_ONCE || !waiting.length) return
  const { call, resolve, reject } = waiting.shift()
  running++
  call().then(resolve, reject).finally(() => {
    running--
    next()
  })
}

function read(name) {
  try { return localStorage.getItem(name) ?? "" } catch { return "" }
}

function write(name, value) {
  try { value ? localStorage.setItem(name, value) : localStorage.removeItem(name) } catch {}
}
