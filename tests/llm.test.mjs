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

test("a typed request carries the writer's documents", () => {
  const library = [{ title: "thesis", text: "It asked which streets flood first." }]
  for (const apply of [true, false]) {
    const { user } = PROMPTS.prompt({ ...payload, mode: "edit", prompt: "connect it to my thesis", library, apply })
    assert.ok(user.includes("[thesis] It asked which streets flood first."), String(apply))
  }
})

test("a long text is cut to its opening and the part around the spot", () => {
  const paragraphs = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ${"word ".repeat(60).trim()}.`)
  const text = paragraphs.join("\n\n"), start = text.indexOf("Paragraph 30"), end = start + 12
  const { user } = PROMPTS.bloom({ text, start, end })
  assert.ok(user.length < 6500)
  assert.ok(user.includes("[[Paragraph 30]]"))
  assert.ok(user.startsWith("Paragraph 0 "))
  assert.ok(user.includes("[…]"))
  assert.ok(user.includes("Paragraph 29 ") && user.includes("Paragraph 31 "))
  assert.ok(!user.includes("Paragraph 10 ") && !user.includes("Paragraph 50 "))
})

test("a short text is sent whole", () => {
  assert.ok(PROMPTS.bloom(payload).user.startsWith("I [[could help]] your company."))
})

test("the grid asks for nothing extra when every option is pinned", () => {
  const { user } = PROMPTS.grid({ ...payload, mode: "edit", pins: [{ label: "warmer", weight: 1 }], options: [] })
  assert.ok(!user.includes("further options"))
})

test("with only documents pinned, the model is told to work them in, not to stay close to the original", () => {
  const refs = [{ title: "notes", text: "Four teams use it." }]
  for (const kind of ["compose", "grid"]) {
    const { user } = PROMPTS[kind]({ ...payload, mode: "edit", pulls: [], pins: [], options: ["bolder"], refs })
    assert.ok(!user.includes("stay close to the original"), kind)
    assert.ok(user.includes("brings in what the references below say"), kind)
  }
  assert.ok(PROMPTS.grid({ ...payload, mode: "edit", pins: [], options: ["bolder"], refs }).user.includes("including what it took from the references"))
})

