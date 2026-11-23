/**
 * The simulator: canned rewrites that stand in for a model, so the interface can be tried without an API key.
 * It only knows the sample letter well; on other text its changes are crude.
 */

const DELAY_MS = { bloom: 350, moves: 350, prompt: 450, grid: 250, shrinks: 200, compose: 150, blend: 150, custom: 300 }
const SHRINK_RUNGS = 5

const ROUTES = {
  bloom: ({ text, start, end, exclude = [], count = 4 }) => mockBloom(text.slice(start, end), exclude, count),
  moves: ({ exclude = [], count = 6 }) => mockMoves(exclude, count),
  compose: ({ mode, text, start, end, pulls = [], refs = [] }) => ({ text: mockCompose(mode, text.slice(start, end), pulls, refs) }),
  grid: ({ mode, text, start, end, pins = [], refs = [], options = [] }) => {
    const passage = text.slice(start, end)
    const at = (label, level) => mockCompose(mode, passage, [...pins, { label, weight: level / 3 }], refs)
    return { text: mockCompose(mode, passage, pins, refs), options: options.map((label) => ({ label, slight: at(label, 1), medium: at(label, 2), strong: at(label, 3) })) }
  },
  shrinks: ({ text, start, end }) => {
    const passage = text.slice(start, end), words = passage.split(/\s+/).filter(Boolean).length
    return { versions: Array.from({ length: SHRINK_RUNGS }, (_, k) => mockShrink(passage, Math.max(3, Math.round(words * 0.85 ** (k + 1))))) }
  },
  prompt: ({ mode, text, start, end, prompt, keep = [], refs = [], count = 6, apply = true }) =>
    apply ? mockPrompt(mode, text.slice(start, end), prompt, keep, refs, count) : mockSteer(mode, text.slice(start, end), prompt, keep, count),
  /** Used only by the earlier sketches in explorations/. */
  blend: ({ text, start, end, pulls }) => ({ text: mockBlend(text.slice(start, end), pulls) }),
  custom: ({ text, start, end, label }) => ({ direction: mockDirection(text.slice(start, end), label) }),
}

export async function simulate(route, payload) {
  if (!ROUTES[route]) throw new Error(`the simulator has no "${route}"`)
  await new Promise((resolve) => setTimeout(resolve, DELAY_MS[route] ?? 200))
  return ROUTES[route](payload)
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
  "more of it": {
    rules: [[/\bcan\b/i, "really can"], [/\bimportant\b/i, "essential"], [/\bgood\b/i, "excellent"], [/\bwant\b/i, "really want"]],
    flourish: (t) => beforeEnd(t, ", even more so than I can say here"),
  },
  subtler: {
    rules: [[/\breally\b/i, ""], [/\bwill\b/i, "could"], [/\bI can\b/i, "I think I can"], [/\bcertain\b/i, "fairly sure"], [/\bessential\b/i, "useful"]],
    flourish: (t) => beforeEnd(t, ", in a modest way"),
  },
  "more concrete": {
    rules: [[/three years/i, "three years (2022–2025)"], [/\bdata tools\b/i, "data pipelines and dashboards"], [/\bteams?\b/i, "four teams"], [/\bstreets\b/i, "1,200 streets"]],
    flourish: (t) => beforeEnd(t, ", with numbers to back it up"),
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

function mockBloom(passage, exclude, count = 4) {
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

/** A one-word touch per direction, for when none of its swaps fit the passage: every level must visibly change something. */
const HINTS = {
  "quietly confident": "surely", warmer: "gladly", "about the team": "with others", "more curious": "curiously", bolder: "clearly", humbler: "I hope",
  "more precise": "precisely", "more of it": "truly", subtler: "perhaps", "more concrete": "in practice", playful: "happily",
}

function hinted(text, label) {
  return beforeEnd(text, `, ${HINTS[label] ?? label}`)
}

/** Three levels that each differ from the passage and from each other. */
function mockDirection(passage, label) {
  const { rules, flourish } = rulesFor(label)
  if (applyRules(passage, rules, Infinity) === passage) return { label, slight: hinted(passage, label), medium: flourish(passage), strong: flourish(hinted(passage, label)) }
  let slight = applyRules(passage, rules, 1)
  if (slight === passage) slight = hinted(passage, label)
  let medium = applyRules(passage, rules, 3)
  if (medium === passage || medium === slight) medium = flourish(slight)
  let strong = flourish(applyRules(passage, rules, Infinity))
  if (strong === medium) strong = hinted(strong, label)
  return { label, slight, medium, strong }
}

/** Applies each direction's swaps in turn, as many as its weight allows; only the strongest gets its closing flourish. */
function mockBlend(passage, pulls) {
  const ordered = [...pulls].sort((a, b) => b.weight - a.weight)
  let text = passage
  for (const { label, weight } of ordered) {
    const level = Math.round(weight * 3)
    const changed = applyRules(text, rulesFor(label).rules, level === 1 ? 1 : level === 2 ? 3 : Infinity)
    text = changed === text ? hinted(text, label) : changed
  }
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

function mockMoves(exclude, count) {
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
  for (const ref of refs) out = beforeEnd(out, quoted(ref))
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

const PROMPT_WRITES = {
  thesis: "My master's thesis asked whether city sensor data could predict which streets flood first, and it taught me how to turn messy data into decisions people trust.",
  pipeline: "The pipeline I built cut dataset preparation from two weeks to one afternoon, and four teams still use it today.",
  studio: "What draws me to small teams is seeing a tool used the very week it ships.",
  supervisor: "My supervisor once called me the person everyone asks when a dataset stops making sense, and that is the role I enjoy most.",
}

/** The referenced passage itself, worked into the sentence, so it is plain which one was used. */
function quoted(ref) {
  return ` — as my ${ref.title} puts it, “${ref.text.trim().replace(/[.!?]+$/, "")}”`
}

const SMALL_WORDS = new Set("a an the it this that to of and or like as be is make makes sound more less my me i in on for with please".split(" "))

/** Directions toward a request, without touching the text: the request itself first, then its neighbours. */
function mockSteer(mode, passage, prompt, keep, count) {
  const words = prompt.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter(Boolean)
  const own = (words.filter((word) => !SMALL_WORDS.has(word)).slice(0, 3).join(" ") || words.slice(0, 3).join(" "))
  if (mode === "write") {
    const said = prompt.replace(/^(please\s+)?(mention|add|say|write|talk about)\s+/i, "")
    const first = { label: own, slight: `and ${said}`, medium: `I also want to mention ${said}.`, strong: `I also want to mention ${said}. It matters to me, and I think it says something about how I work.` }
    return { directions: [first, ...mockMoves([], count - 1).directions] }
  }
  const kept = keep.filter((label) => MOCK_DIRECTIONS[label]).slice(0, 2)
  const labels = [own, "a hint of it", ...kept, "more of it", "subtler", "more concrete", "bolder"].filter((label, i, list) => list.indexOf(label) === i).slice(0, count)
  return { directions: labels.map((label) => ({ ...mockDirection(passage, label), kept: kept.includes(label) })) }
}

function mockPrompt(mode, passage, prompt, keep, refs, count) {
  const p = prompt.toLowerCase()
  const topic = Object.keys(PROMPT_WRITES).find((k) => p.includes(k) || (k === "studio" && p.includes("nord")))
  const refTitle = { thesis: "thesis abstract", pipeline: "pipeline notes", studio: "letter to Studio Nord", supervisor: "supervisor's feedback" }[topic]
  const words = passage.split(/\s+/).filter(Boolean).length
  let text
  if (/short|concise|brief|cut/.test(p) && passage) text = mockShrink(passage, Math.max(4, Math.round(words * 0.55)))
  else if (mode === "write") text = topic ? PROMPT_WRITES[topic] : `I also want to say this: ${prompt.replace(/^(please\s+)?(mention|add|say|write|talk about)\s+/i, "")}.`
  else {
    const known = Object.keys(MOCK_DIRECTIONS).find((l) => new RegExp(`\\b${l.split(" ").at(-1)}\\b`).test(p) && l.split(" ").at(-1).length > 3)
    text = topic ? beforeEnd(passage, MOCK_REFS[refTitle]) : known ? mockDirection(passage, known).strong : beforeEnd(passage, ` — ${prompt}`)
  }
  for (const ref of refs) text = beforeEnd(text, quoted(ref))
  const kept = keep.filter((l) => MOCK_DIRECTIONS[l]).slice(0, 2)
  const fresh = ["more of it", "subtler", "more concrete", "warmer", "bolder", "quietly confident"].filter((l) => !kept.includes(l)).slice(0, count - kept.length)
  return { text, directions: [...kept, ...fresh].map((label) => ({ ...mockDirection(text, label), kept: kept.includes(label) })) }
}
