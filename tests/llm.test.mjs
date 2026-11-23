import assert from "node:assert/strict"
import { test } from "node:test"
import { isLive, request } from "../src/llm/index.js"
import { PROMPTS } from "../src/llm/prompts.js"

const payload = { text: "I could help your company.", start: 2, end: 12, count: 3 }

test("without a key, requests go to the simulator", async () => {
  assert.equal(isLive(), false)
  const { directions } = await request("bloom", payload)
  assert.equal(directions.length, 3)
})

test("the same request is answered once", () => {
  assert.equal(request("bloom", payload), request("bloom", { ...payload }))
  assert.notEqual(request("bloom", payload), request("bloom", { ...payload, count: 4 }))
})

test("every prompt marks the passage and asks for a strict object", () => {
  const extras = { mode: "edit", prompt: "warmer", pulls: [], pins: [], options: ["bolder"] }
  for (const [kind, build] of Object.entries(PROMPTS)) {
    const { user, schema } = build({ ...payload, ...extras })
    assert.match(user, /\[\[.*\]\]/s, kind)
    assert.equal(schema.type, "object", kind)
    assert.equal(schema.additionalProperties, false, kind)
    assert.deepEqual(schema.required, Object.keys(schema.properties), kind)
  }
})

test("references are passed to the model word for word", () => {
  const refs = [{ title: "notes", text: "Four teams use it." }]
  for (const kind of ["compose", "grid", "prompt"]) {
    const { user } = PROMPTS[kind]({ ...payload, mode: "edit", prompt: "x", options: [], refs })
    assert.ok(user.includes("[notes] Four teams use it."), kind)
  }
})
