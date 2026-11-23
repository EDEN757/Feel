import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { execFile } from "node:child_process"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"

const PORT = Number(process.env.PORT ?? 4317)
const MODEL = "claude-haiku-5-5"
const MOCK = process.env.MOCK === "1"
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "prototype")
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" }

const BACKEND = MOCK ? "mock" : process.env.ANTHROPIC_API_KEY ? "api" : "subscription"
const client = BACKEND === "api" ? new Anthropic() : null

const GRADES = z.object({
  slight: z.string().describe("one or two words changed, the passage barely shifts"),
  medium: z.string().describe("a clear shift you would notice on first read"),
  strong: z.string().describe("fully committed to the direction, same facts"),
})
const BLOOM = z.object({ directions: z.array(GRADES.extend({ label: z.string() })) })
const BLEND = z.object({ text: z.string() })
const LENGTHS = z.object({
  slight: z.string().describe("a short phrase of a few words"),
  medium: z.string().describe("one full sentence"),
  strong: z.string().describe("a short paragraph of two to four sentences"),
})
const MOVES = z.object({ directions: z.array(LENGTHS.extend({ label: z.string() })) })

const SYSTEM = `You help a writer shape their own text by its feeling and meaning, not just its wording.

The user message has the whole text with one spot marked like [[this]]: either a passage to rewrite, or an empty [[]] where new text will be inserted.

Rules for everything you write:
- Output ONLY the text that goes inside the brackets, without the brackets or any surrounding text.
- It must slot in seamlessly: it flows from the words before the mark into the words after it.
- Keep the writer's facts, names and claims. Never invent achievements; draw only on the text and on any references given.
- Unless asked otherwise, keep roughly the same length as the marked passage.
- Same language as the text. Plain text, no quotes, no commentary.`

const grades = `Write each direction at three strengths: slight (one or two words change), medium (a clear shift), strong (fully committed, still the same facts).`

const routes = {
  async bloom({ text, start, end, exclude = [], count = 4 }) {
    count = Math.max(2, Math.min(8, Number(count) || 4))
    const user = `${marked(text, start, end)}

Propose ${count} directions that would change this passage in the most meaningful and distinct ways, given what the whole text is for. Mix kinds: a feeling, a tone, an emphasis on a different part of the writer's story, a shift in stance. Each label is 1 to 3 lowercase words, evocative rather than technical.${exclude.length ? `\nDo not repeat or closely echo: ${exclude.join(", ")}.` : ""}
${grades}`
    if (MOCK) return mockBloom(text.slice(start, end), exclude, count)
    const { directions } = await ask(user, BLOOM)
    return { directions: directions.slice(0, count) }
  },

  async custom({ text, start, end, label }) {
    const user = `${marked(text, start, end)}

Direction, in the writer's own words: "${label}". Read it as a feeling, idea or intention, not as words to insert.
${grades}`
    if (MOCK) return { direction: mockDirection(text.slice(start, end), label) }
    const direction = await ask(user, GRADES)
    return { direction: { label, ...direction } }
  },

  async blend({ text, start, end, pulls }) {
    const mix = pulls.map(({ label, weight }) => `- ${label}: ${Math.round(weight * 100)}%`).join("\n")
    const user = `${marked(text, start, end)}

Rewrite the passage as a blend of these directions, each with how strongly it should pull (100% = fully committed):
${mix}
Return the single blended passage.`
    if (MOCK) return { text: mockBlend(text.slice(start, end), pulls) }
    return ask(user, BLEND)
  },

  /** What could be written at a cursor: each move at three lengths. */
  async moves({ text, start, count = 6, exclude = [] }) {
    count = Math.max(2, Math.min(8, Number(count) || 6))
    const user = `${marked(text, start, start)}

New text will be inserted at the empty [[]]. Propose ${count} distinct moves the writer could make there, given what the whole text is for: for example give an example, add a concrete result, explain a motivation, admit something honestly, close the thought. Each label is 1 to 4 lowercase words.${exclude.length ? `\nDo not repeat: ${exclude.join(", ")}.` : ""}
Write each move at three lengths: slight (a short phrase), medium (one sentence), strong (a short paragraph). Each must read naturally right where the mark is.`
    if (MOCK) return mockMoves(exclude, count)
    const { directions } = await ask(user, MOVES)
    return { directions: directions.slice(0, count) }
  },

  /** Several pulls at once, in edit or write mode, optionally drawing on reference documents. */
  async compose({ mode, text, start, end, pulls = [], refs = [] }) {
    const mix = pulls.map(({ label, weight, length }) => `- ${label}: ${Math.round(weight * 100)}%${length ? ` (${length})` : ""}`).join("\n")
    const sources = refs.length ? `\nDraw on these references from the writer's own documents, using only what they say:\n${refs.map((r) => `[${r.title}] ${r.text}`).join("\n")}` : ""
    const task = mode === "write"
      ? `Write new text to insert at the empty [[]], combining these moves (the percentage is how much each should shape it, the length in brackets is how long the result should be):`
      : `Rewrite the marked passage as a blend of these directions, each with how strongly it should pull (100% = fully committed):`
    const user = `${marked(text, start, end)}\n\n${task}\n${mix || "- stay close to the original"}${sources}\nReturn the single result.`
    if (MOCK) return { text: mockCompose(mode, text.slice(start, end), pulls, refs) }
    return ask(user, BLEND)
  },

  /** The marked passage rewritten shorter, keeping what matters most. */
  async shrink({ text, start, end, steps = 1 }) {
    const words = text.slice(start, end).split(/\s+/).filter(Boolean).length
    const target = Math.max(3, Math.round(words * 0.85 ** steps))
    const user = `${marked(text, start, end)}\n\nRewrite the marked passage in at most ${target} words. Keep the most important meaning and the writer's voice; drop or merge what matters least. Do not just cut words mid-sentence: it must read as finished text.`
    if (MOCK) return { text: mockShrink(text.slice(start, end), target) }
    return ask(user, BLEND)
  },
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const route = url.pathname.startsWith("/api/") && routes[url.pathname.slice(5)]
    if (route && req.method === "POST") {
      const localHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? "")
      const localOrigin = !req.headers.origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin)
      const isJson = (req.headers["content-type"] ?? "").startsWith("application/json")
      if (!localHost || !localOrigin || !isJson) return send(res, 403, { error: "local JSON requests only" })
      const started = Date.now()
      const result = await route(JSON.parse(await body(req)))
      console.log(`${url.pathname} ${Date.now() - started}ms${MOCK ? " (mock)" : ""}`)
      return send(res, 200, result)
    }
    const path = normalize(join(ROOT, url.pathname === "/" ? "ring.html" : url.pathname))
    if (!path.startsWith(ROOT)) return send(res, 403, { error: "forbidden" })
    const file = await readFile(path).catch(() => null)
    if (!file) return send(res, 404, { error: "not found" })
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" })
    res.end(file)
  } catch (error) {
    console.error(error)
    send(res, 500, { error: String(error?.message ?? error) })
  }
}).listen(PORT, "127.0.0.1", () => console.log(`feeling_llm on http://localhost:${PORT} · ${{ mock: "fake data", api: `${MODEL} via API key`, subscription: "Haiku via your Claude subscription (claude CLI)" }[BACKEND]}`))

function ask(user, schema) {
  return BACKEND === "api" ? askApi(user, schema) : askSubscription(user, schema)
}

function askSubscription(user, schema) {
  const args = ["-p", "--model", "haiku", "--output-format", "json", "--no-session-persistence", "--tools", "", "--setting-sources", "",
    "--system-prompt", SYSTEM, "--json-schema", JSON.stringify(jsonSchemaOf(schema))]
  return new Promise((resolve, reject) => {
    const child = execFile("claude", args, { cwd: tmpdir(), timeout: 90_000, maxBuffer: 4 << 20 }, (error, stdout, stderr) => {
      let reply
      try { reply = JSON.parse(stdout) } catch { return reject(new Error(`claude CLI failed: ${(stderr || error?.message || "no reply").trim().split("\n").at(-1)}`)) }
      if (reply.is_error) return reject(new Error(`claude CLI: ${reply.result}${/auth|login|OAuth/i.test(reply.result) ? " — run `claude` in a terminal and log in" : ""}`))
      try { resolve(schema.parse(reply.structured_output ?? JSON.parse(reply.result))) } catch { reject(new Error("claude CLI reply did not match the expected shape")) }
    })
    child.stdin.end(user)
  })
}

function jsonSchemaOf(schema) {
  const { $schema, ...rest } = z.toJSONSchema(schema)
  return rest
}

async function askApi(user, schema) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "disabled" },
    output_config: { effort: "low", format: zodOutputFormat(schema) },
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
  })
  if (response.stop_reason === "refusal") throw new Error("The model declined this passage.")
  if (!response.parsed_output) throw new Error(`Unparseable reply (stop: ${response.stop_reason})`)
  return response.parsed_output
}

function marked(text, start, end) {
  return `${text.slice(0, start)}[[${text.slice(start, end)}]]${text.slice(end)}`
}

function body(req) {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (chunk) => (data += chunk))
    req.on("end", () => resolve(data))
    req.on("error", reject)
  })
}

function send(res, status, json) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(json))
}

/** Fake rewrites for testing the interface: each direction is an ordered list of word swaps, applied more fully at higher strengths. */
const MOCK_DIRECTIONS = {
  "quietly confident": {
    rules: [[/I think I could/i, "I can"], [/\bhopeful\b/i, "confident"], [/\bwould be\b/i, "will be"], [/\bmight\b/i, "will"], [/\blearned to\b/i, "know how to"], [/\bsmall\b/i, "focused"], [/\bbuilt\b/i, "designed and built"], [/\bdifferent\b/i, "very different"], [/\buseful\b/i, "valuable"]],
    flourish: (t) => beforeEnd(t, ", and I know it works"),
  },
  warmer: {
    rules: [[/\bpeople\b/i, "wonderful people"], [/\bwork with\b/i, "work alongside"], [/\bteam\b/i, "close-knit team"], [/\bhopeful\b/i, "genuinely excited"], [/\bhelp\b/i, "support"], [/\bbuilt\b/i, "lovingly built"], [/\buseful\b/i, "meaningful"], [/\bfields\b/i, "backgrounds"]],
    flourish: (t) => (/^[A-Z]/.test(t) ? `Honestly, ${/^I\b/.test(t) ? t : t[0].toLowerCase() + t.slice(1)}` : `honestly, ${t}`),
  },
  "about the team": {
    rules: [[/\bI have built\b/i, "we built"], [/\bteam\b/i, "team I loved working with"], [/\bpeople\b/i, "colleagues"], [/\bI learned\b/i, "we learned"], [/\bmy\b/i, "our"], [/\bdata tools\b/i, "shared data tools"], [/\bwork with\b/i, "work side by side with"]],
    flourish: (t) => beforeEnd(t, ", together"),
  },
  "more curious": {
    rules: [[/\blearned to\b/i, "kept discovering how to"], [/\bdifferent fields\b/i, "fields I knew nothing about"], [/\bbuilt\b/i, "explored and built"], [/\bhopeful\b/i, "curious to see"], [/\bhelp\b/i, "explore new problems with"], [/\bdata tools\b/i, "experimental data tools"], [/\buseful\b/i, "surprising"]],
    flourish: (t) => beforeEnd(t, ", and I keep asking why"),
  },
  bolder: {
    rules: [[/I think I could/i, "I will"], [/\bhopeful\b/i, "certain"], [/\bhelp\b/i, "transform"], [/\bsmall\b/i, "lean"], [/\bbuilt\b/i, "shipped"], [/\bwould be useful\b/i, "will make a difference"], [/\buseful\b/i, "decisive"]],
    flourish: (t) => beforeEnd(t, " — no question"),
  },
  humbler: {
    rules: [[/\bbuilt\b/i, "helped build"], [/I think I could/i, "I hope I could"], [/\bhopeful\b/i, "quietly hopeful"], [/\blearned to\b/i, "slowly learned to"], [/\bwould be useful\b/i, "might be of some use"]],
    flourish: (t) => beforeEnd(t, ", if you'll have me"),
  },
  "more precise": {
    rules: [[/three years/i, "three years (2022–2025)"], [/\bdata tools\b/i, "data pipelines and dashboards"], [/\bsmall\b/i, "six-person"], [/\bdifferent fields\b/i, "biology, design and policy"], [/\buseful\b/i, "directly relevant"]],
    flourish: (t) => beforeEnd(t, ", across two cross-lab projects"),
  },
  playful: {
    rules: [[/\bdata tools\b/i, "little data machines"], [/\bteam\b/i, "crew"], [/\bpeople\b/i, "folks"], [/\bhopeful\b/i, "cheerfully hopeful"], [/\bdifferent fields\b/i, "all sorts of fields"]],
    flourish: (t) => beforeEnd(t, " (mostly with coffee)"),
  },
}

function beforeEnd(text, addition) {
  const [, body, end] = text.match(/^([\s\S]*?)([.!?,;:]*)$/)
  return `${body}${addition}${end}`
}

async function mockBloom(passage, exclude, count = 4) {
  await new Promise((r) => setTimeout(r, 500))
  const labels = Object.keys(MOCK_DIRECTIONS).filter((l) => !exclude.includes(l))
  return { directions: (labels.length >= count ? labels : Object.keys(MOCK_DIRECTIONS)).slice(0, count).map((label) => mockDirection(passage, label)) }
}

function rulesFor(label) {
  const known = MOCK_DIRECTIONS[label] ?? MOCK_DIRECTIONS[Object.keys(MOCK_DIRECTIONS).find((k) => label.includes(k.split(" ").at(-1)))]
  return known ?? { rules: [[/\b(\w+)$/, `$1, ${label}`]], flourish: (t) => beforeEnd(t, `, deeply ${label}`) }
}

function applyRules(text, rules, count) {
  let applied = 0
  for (const [pattern, replacement] of rules) {
    if (applied >= count) break
    if (pattern.test(text)) { text = text.replace(pattern, replacement); applied++ }
  }
  return text
}

function mockDirection(passage, label) {
  const { rules, flourish } = rulesFor(label)
  const slight = applyRules(passage, rules, 1), medium = applyRules(passage, rules, 3), strong = flourish(applyRules(passage, rules, Infinity))
  return { label, slight, medium: medium === slight ? flourish(slight) : medium, strong }
}

/** Applies each direction's swaps in turn, as many as its weight allows; only the strongest gets its closing flourish. */
function mockBlend(passage, pulls) {
  const ordered = [...pulls].sort((a, b) => b.weight - a.weight)
  let text = passage
  for (const { label, weight } of ordered) text = applyRules(text, rulesFor(label).rules, Math.round(weight * 3) === 1 ? 1 : Math.round(weight * 3) === 2 ? 3 : Infinity)
  const top = ordered[0]
  return top && top.weight > 0.9 ? rulesFor(top.label).flourish(text) : text
}

const MOCK_MOVES = {
  "give an example": ["for example, a flood-risk dashboard", "For example, I built a dashboard that showed a city team which streets flood first.", "For example, a city team once asked why some streets flooded every spring. I joined rainfall records with residents' complaints and built a small dashboard that ranked streets by risk. They still use it to plan repairs."],
  "add a result": ["cutting prep time to one afternoon", "That work cut dataset preparation from two weeks to one afternoon.", "The result was concrete: dataset preparation went from two weeks to one afternoon. Four teams now rely on the same pipeline, and new members can use it from their first day."],
  "why this company": ["because you build for non-engineers", "I want to work with you because you build tools for people who are not engineers.", "What draws me to your company is who you build for. Most of my best work happened when a researcher with no coding background could finally answer their own question. That is the problem you are solving every day."],
  "admit something": ["though I am still learning", "I am still learning how to scale these tools beyond a single team.", "I should be honest about one thing: so far I have built tools for teams of a few dozen people, not thousands. I am eager to learn how that changes the work, and I learn fastest next to people who have done it."],
  "close the thought": ["and that is what I want to keep doing", "That is the kind of work I want to keep doing.", "That, in the end, is what I care about: tools that quietly make someone's day easier. It is the work I want to keep doing, and I would love to do it with you."],
  "ask a question": ["and I would love to know how you see it", "I would love to hear how your team decides what to build next.", "I am curious about one thing in particular: how does your team decide which problems to solve first? I would love to talk about it, because that choice shapes everything that follows."],
  "tell a small story": ["like the time a script saved a deadline", "Once, a five-line script saved a grant deadline for the whole lab.", "One evening before a grant deadline, our only analyst was ill and the figures were wrong. I wrote a five-line script that fixed the units across every table. We submitted on time, and that script became the start of our first real tool."],
  "show ambition": ["and I want to build at a larger scale", "Next, I want to build tools that reach far more people than one lab.", "Next, I want to work at a larger scale. A tool that helps one lab is satisfying; one that helps thousands of people ask better questions is the reason I do this work."],
}

const MOCK_REFS = {
  "thesis abstract": " — the same instinct behind my thesis on predicting floods from city data",
  "pipeline notes": " (the pipeline I built cut prep time from two weeks to one afternoon)",
  "letter to Studio Nord": ", and I love seeing a tool used the week it ships",
  "supervisor's feedback": "; my supervisor calls me the person people ask when a dataset stops making sense",
}

async function mockMoves(exclude, count) {
  await new Promise((r) => setTimeout(r, 400))
  const labels = Object.keys(MOCK_MOVES).filter((l) => !exclude.includes(l))
  return { directions: (labels.length >= count ? labels : Object.keys(MOCK_MOVES)).slice(0, count).map((label) => { const [slight, medium, strong] = MOCK_MOVES[label]; return { label, slight, medium, strong } }) }
}

function mockCompose(mode, passage, pulls, refs) {
  let out
  if (mode === "write") {
    const top = [...pulls].sort((a, b) => b.weight - a.weight)[0]
    const texts = MOCK_MOVES[top?.label] ?? ["and more", "Here is one more sentence.", "Here is one more paragraph. It says a little more."]
    out = texts[Math.max(0, Math.round((top?.weight ?? 1 / 3) * 3) - 1)]
    const second = [...pulls].sort((a, b) => b.weight - a.weight)[1]
    if (second && MOCK_MOVES[second.label]) out = beforeEnd(out, `, ${MOCK_MOVES[second.label][0]}`)
  } else out = pulls.length ? mockBlend(passage, pulls) : passage
  for (const ref of refs) out = beforeEnd(out, MOCK_REFS[ref.title] ?? ` (as in ${ref.title})`)
  return out
}

const FILLER = /\b(really|very|just|actually|quite|simply|small|every day|at a university lab|messy)\s+/gi

/** Shortens like a careful editor would: filler first, then side clauses, then whole trailing sentences. */
function mockShrink(passage, target) {
  const count = (t) => t.split(/\s+/).filter(Boolean).length
  let text = passage.replace(FILLER, "")
  const cuts = [/:\s[^.]*(?=\.)/, /,\s(?:and|but|because|which)\s[^.,]*(?=[.,])/, /,\s[^.,]*(?=\.)/]
  for (const cut of cuts) while (count(text) > target && cut.test(text)) text = text.replace(cut, "")
  while (count(text) > target) {
    const sentences = text.match(/[^.!?]+[.!?]+/g)
    if (!sentences || sentences.length < 2) break
    text = sentences.slice(0, -1).join("").trim()
  }
  if (count(text) > target) text = text.split(/\s+/).slice(0, target).join(" ").replace(/[,;:]?$/, ".")
  return text.trim()
}
