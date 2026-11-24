import assert from "node:assert/strict"
import { test } from "node:test"

const store = new Map([["feeling-cerebras-key", "test-key"]])
globalThis.localStorage = { getItem: (name) => store.get(name) ?? null, setItem: (name, value) => store.set(name, value), removeItem: (name) => store.delete(name) }

const answers = []
let calls = 0
globalThis.fetch = async () => {
  calls++
  const status = answers.shift() ?? 200
  return {
    ok: status === 200,
    status,
    headers: { get: (name) => (name === "retry-after" ? "0.02" : null) },
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ text: "ok" }) } }] }),
  }
}

const { request, settings } = await import("../src/llm/index.js")
const payload = (n) => ({ mode: "edit", text: `Passage ${n}.`, start: 0, end: 7, pulls: [] })

test("a rate-limited request waits and tries again", async () => {
  const pauses = []
  settings.onPause = (ms) => pauses.push(ms)
  answers.push(429, 429)
  assert.deepEqual(await request("compose", payload(1)), { text: "ok" })
  assert.equal(calls, 3)
  assert.deepEqual(pauses, [20, 20])
})

test("it gives up after a few tries", async () => {
  answers.push(429, 429, 429, 429)
  await assert.rejects(request("compose", payload(2)), /rate limit/)
})

const pauseOver = () => new Promise((resolve) => setTimeout(resolve, 40))

test("requests made ahead are dropped, not retried, and refused during the pause", async () => {
  await pauseOver()
  calls = 0
  answers.push(429)
  await assert.rejects(request("compose", payload(3), { ahead: true }), /rate limit/)
  assert.equal(calls, 1)
  await assert.rejects(request("compose", payload(4), { ahead: true }), /not asked/)
  assert.equal(calls, 1)
})

test("asking for real takes over a request made ahead", async () => {
  await pauseOver()
  calls = 0
  answers.push(429)
  const early = request("compose", payload(5), { ahead: true })
  const real = request("compose", payload(5))
  assert.equal(early, real)
  assert.deepEqual(await real, { text: "ok" })
  assert.equal(calls, 2)
})
