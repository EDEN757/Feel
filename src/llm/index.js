/**
 * The one door to the model. `request(kind, payload)` answers from the simulator until a Cerebras key is saved.
 *
 * Replies are remembered for the life of the page, keyed by the exact request. That is what makes it cheap to ask
 * ahead of time: a request made speculatively and the same request made for real share one call.
 *
 * When the provider says the rate limit is reached, the queue pauses and then tries again. Requests made ahead of
 * time are the first to go: they are dropped, and none are started until the pause is over.
 */

import { complete, DEFAULT_MODEL, MODELS } from "./cerebras.js"
import { PROMPTS, SYSTEM } from "./prompts.js"
import { simulate } from "./simulator.js"

const KEY_STORAGE = "feeling-cerebras-key"
const MODEL_STORAGE = "feeling-cerebras-model"
const MAX_AT_ONCE = 4
const RETRIES = 3
const LONGEST_PAUSE_MS = 15000

const remembered = new Map()
const waiting = []
let running = 0
let pausedUntil = 0, strikes = 0, timer = null

export { MODELS }

/** The key and model live only in this browser's localStorage. */
export const settings = {
  /** Set to answer from the simulator even when a key is saved. */
  simulate: false,
  /** Called with the milliseconds to wait when the rate limit pauses the queue. */
  onPause: null,
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

/**
 * @param ahead true when nobody is waiting on the answer yet. Such a request gives way to the others, and is
 *   refused while the rate limit is reached. Asking again without `ahead` makes it a normal request.
 */
export function request(kind, payload, { ahead = false } = {}) {
  const id = `${isLive() ? settings.model : "simulator"} ${kind} ${JSON.stringify(payload)}`
  const known = remembered.get(id)
  if (known) {
    if (!ahead && known.job) hurry(known.job)
    return known.reply
  }
  if (!isLive()) return remember(id, simulate(kind, payload))
  if (ahead && Date.now() < pausedUntil) return Promise.reject(new Error("not asked: the rate limit is reached"))

  const job = { call: () => ask(kind, payload), urgent: !ahead, tries: 0 }
  const reply = new Promise((resolve, reject) => Object.assign(job, { resolve, reject }))
  line(job)
  next()
  return remember(id, reply, job)
}

function remember(id, reply, job) {
  remembered.set(id, { reply, job })
  reply.catch(() => remembered.delete(id))
  return reply
}

function ask(kind, payload) {
  const { user, schema } = PROMPTS[kind](payload)
  return complete({ apiKey: settings.apiKey, model: settings.model, system: SYSTEM, user, schema })
}

/** Puts a job in the queue: behind the requests someone is waiting on, ahead of the speculative ones. */
function line(job) {
  if (job.urgent) waiting.splice(waiting.findLastIndex((other) => other.urgent) + 1, 0, job)
  else waiting.push(job)
}

function hurry(job) {
  if (job.urgent) return
  job.urgent = true
  const at = waiting.indexOf(job)
  if (at >= 0) { waiting.splice(at, 1); line(job) }
}

/** Runs at most MAX_AT_ONCE calls together, and none while the rate limit has the queue paused. */
function next() {
  if (running >= MAX_AT_ONCE || !waiting.length) return
  const pause = pausedUntil - Date.now()
  if (pause > 0) {
    clearTimeout(timer)
    timer = setTimeout(next, pause)
    return
  }
  const job = waiting.shift()
  running++
  job.call().then((reply) => {
    strikes = 0
    job.resolve(reply)
  }, (error) => {
    if (error.status !== 429) return job.reject(error)
    const pause = error.retryAfter ?? Math.min(LONGEST_PAUSE_MS, 2000 * 2 ** strikes++)
    pausedUntil = Date.now() + pause
    for (const other of waiting.splice(0).filter((other) => other.urgent || void other.reject(error))) waiting.push(other)
    if (job.urgent && job.tries++ < RETRIES) { line(job); settings.onPause?.(pause) }
    else job.reject(error)
  }).finally(() => {
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
