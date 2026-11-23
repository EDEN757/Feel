import assert from "node:assert/strict"
import { test } from "node:test"
import { diffWords } from "../src/diff.js"

const changed = (parts) => parts.filter((part) => part.changed).map((part) => part.text).join("")

test("marks only the words that are new", () => {
  assert.equal(changed(diffWords("I think I could help", "I can help")), "can")
})

test("joins neighbouring new words into one run", () => {
  assert.equal(changed(diffWords("help your company", "help your company, and I know it")), "company, and I know it")
})

test("with `removed`, marks the words that are gone", () => {
  assert.equal(changed(diffWords("a really messy question", "a question", true)), "really messy")
})

test("rebuilds the new text exactly", () => {
  const after = "Honestly, I could support your company"
  assert.equal(diffWords("I could help your company", after).map((part) => part.text).join(""), after)
})
