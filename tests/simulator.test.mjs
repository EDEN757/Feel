import assert from "node:assert/strict"
import { test } from "node:test"
import { simulate } from "../src/llm/simulator.js"
import { SAMPLE } from "../src/sample.js"

const passages = ["I could help your company", "Thank you for your time.", "Dear hiring team", "I am proud of it"]
const at = (text) => ({ text, start: 0, end: text.length })

test("every strength differs from the passage and from the others", async () => {
  for (const text of passages) {
    const { directions } = await simulate("bloom", { ...at(text), count: 6 })
    assert.equal(directions.length, 6)
    for (const { label, slight, medium, strong } of directions) assert.equal(new Set([text, slight, medium, strong]).size, 4, `${label} on "${text}"`)
  }
})

test("asking again leaves out what was already offered", async () => {
  const first = await simulate("bloom", { ...at(passages[0]), count: 4 })
  const seen = first.directions.map((direction) => direction.label)
  const second = await simulate("bloom", { ...at(passages[0]), count: 4, exclude: seen })
  assert.ok(second.directions.every((direction) => !seen.includes(direction.label)))
})

test("the grid covers every option, and each changes the pinned result", async () => {
  const options = ["bolder", "humbler", "playful"]
  const grid = await simulate("grid", { mode: "edit", ...at(passages[0]), pins: [{ label: "warmer", weight: 1 / 3 }], refs: [], options })
  assert.deepEqual(grid.options.map((option) => option.label), options)
  for (const option of grid.options) assert.notEqual(option.slight, grid.text)
})

test("a referenced passage shows up in the result", async () => {
  const refs = [{ title: "notes", text: "Prep time went from two weeks to one afternoon." }]
  const { text } = await simulate("compose", { mode: "edit", ...at(passages[0]), pulls: [], refs })
  assert.ok(text.includes("two weeks to one afternoon"))
})

test("shorter versions never grow", async () => {
  const start = SAMPLE.indexOf("Most of my work"), end = SAMPLE.indexOf("Last year") - 2
  const { versions } = await simulate("shrinks", { text: SAMPLE, start, end })
  assert.equal(versions.length, 5)
  let previous = end - start
  for (const version of versions) {
    assert.ok(version.length <= previous)
    previous = version.length
  }
})

test("a request can change the text, or only offer directions", async () => {
  const applied = await simulate("prompt", { mode: "edit", ...at(passages[0]), prompt: "make it warmer", keep: [] })
  assert.notEqual(applied.text, passages[0])
  const steered = await simulate("prompt", { mode: "edit", ...at(passages[0]), prompt: "formal like a lawyer", keep: [], apply: false })
  assert.equal(steered.text, undefined)
  assert.equal(steered.directions[0].label, "formal lawyer")
})
