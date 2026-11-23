/**
 * What the model is asked, one builder per request kind.
 * Each builder takes the request payload and returns the user message and the JSON schema of the reply.
 * Every payload carries the whole `text` and the `start`/`end` of the spot being worked on.
 * The model is shown all of a short text; of a long one, only its opening and the part around the spot.
 */

export const SYSTEM = `You help a writer shape their own text by its feeling and meaning, not just its wording.

The user message has the writer's text with one spot marked like [[this]]: either a passage to rewrite, or an empty [[]] where new text will be inserted. A long text is cut down to its opening and the part around the spot, with […] where something was left out.

Rules for everything you write:
- Output ONLY the text that goes inside the brackets, without the brackets or any surrounding text.
- It must slot in seamlessly: it flows from the words before the mark into the words after it.
- Keep the writer's facts, names and claims. Never invent achievements; draw only on the text and on any references given.
- Unless asked otherwise, keep roughly the same length as the marked passage.
- Same language as the text. Plain text, no quotes, no commentary.`

const STRENGTHS = `Write each direction at three strengths: slight (one or two words change), medium (a clear shift), strong (fully committed, still the same facts). Even slight must visibly differ from the passage: never return it unchanged, and never repeat the same wording at two strengths.`
const LENGTHS = `Write each at three lengths: slight (a short phrase), medium (one sentence), strong (a short paragraph). Each must read naturally right where the mark is.`

/** Texts up to WHOLE characters are sent in full. Longer ones keep their OPENING, then BEFORE and AFTER the spot. */
const WHOLE = 6000, OPENING = 500, BEFORE = 2500, AFTER = 1500
/** The most of the writer's documents sent along with a typed request, in characters. */
const LIBRARY = 6000
const GAP = "\n\n[…]\n\n"

const string = { type: "string" }
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false })
const list = (items) => ({ type: "array", items })
const graded = object({ label: string, slight: string, medium: string, strong: string })

const TEXT = object({ text: string })
const DIRECTIONS = object({ directions: list(graded) })

export const PROMPTS = {
  /** Ways the marked passage could change, each at three strengths. */
  bloom({ text, start, end, exclude = [], count = 6 }) {
    return {
      schema: DIRECTIONS,
      user: `${marked(text, start, end)}

Propose ${count} directions that would change this passage in the most meaningful and distinct ways, given what the whole text is for. Mix kinds: a feeling, a tone, an emphasis on a different part of the writer's story, a shift in stance. Each label is 1 to 3 lowercase words, evocative rather than technical.${avoiding(exclude)}
${STRENGTHS}`,
    }
  },

  /** What could be written at an empty mark, each move at three lengths. */
  moves({ text, start, exclude = [], count = 6 }) {
    return {
      schema: DIRECTIONS,
      user: `${marked(text, start, start)}

New text will be inserted at the empty [[]]. Propose ${count} distinct moves the writer could make there, given what the whole text is for: for example give an example, add a concrete result, explain a motivation, admit something honestly, close the thought. Each label is 1 to 4 lowercase words.${avoiding(exclude)}
${LENGTHS}`,
    }
  },

  /** Several pulls at once, optionally drawing on the writer's reference documents. */
  compose({ mode, text, start, end, pulls = [], refs = [] }) {
    return {
      schema: TEXT,
      user: `${marked(text, start, end)}

${mixTask(mode)}
${mixOf(pulls)}${sourcesOf(refs)}
Return the single result.`,
    }
  },

  /**
   * Everything the writer could reach with one more move, computed ahead of time:
   * the pinned pulls on their own, then the pinned pulls plus each option at three strengths.
   * `options` are the labels on the ring that are not pinned already.
   */
  grid({ mode, text, start, end, pins = [], refs = [], options = [] }) {
    const steps = mode === "write" ? "three lengths: slight (a short phrase), medium (one sentence), strong (a short paragraph)" : "three strengths: slight (one or two words change), medium (a clear shift), strong (fully committed). Even slight must visibly differ from the result without that option"
    return {
      schema: object({ text: string, options: list(graded) }),
      user: `${marked(text, start, end)}

${mixTask(mode)}
${mixOf(pins)}${sourcesOf(refs)}
Put that result in "text".
${options.length ? `Then, for each of these further options, write the same result with that option added on top, at ${steps}. Use exactly these labels, in this order: ${options.join(", ")}.` : `Return "options" as an empty list.`}`,
    }
  },

  /** The marked passage at five decreasing lengths, each a finished rewrite of the one before. */
  shrinks({ text, start, end }) {
    const words = text.slice(start, end).split(/\s+/).filter(Boolean).length
    const targets = [1, 2, 3, 4, 5].map((k) => Math.max(3, Math.round(words * 0.85 ** k)))
    return {
      schema: object({ versions: list(string) }),
      user: `${marked(text, start, end)}

Rewrite the marked passage ${targets.length} times, each shorter than the last, at most ${targets.join(", ")} words in turn. Keep the most important meaning and the writer's voice; drop or merge what matters least first. Every version must read as finished text, not as a sentence cut off.`,
    }
  },

  /**
   * The writer's own request. With `apply`, the result plus directions that steer that result further;
   * without it, only directions toward what they asked, leaving the text as it is.
   * `library` is the writer's documents, sent so a request can name one ("connect it to my thesis").
   */
  prompt({ mode, text, start, end, prompt, keep = [], refs = [], library = [], count = 6, apply = true }) {
    const keeping = `You may keep up to ${Math.min(3, keep.length)} of these current directions if they still fit, using the exact same label: ${keep.join(", ") || "none"}.`
    if (!apply) {
      return {
        schema: DIRECTIONS,
        user: `${marked(text, start, end)}

The writer says what they are after: "${prompt}". Do not decide for them: propose ${count} directions that approach it from different angles, so they can choose. The first is their request itself, labelled in 1 to 3 lowercase words; the others are nuances, neighbours or contrasts of it, each 1 to 3 lowercase words. ${keeping}${sourcesOf(refs)}${libraryOf(library)}
${mode === "write" ? LENGTHS : STRENGTHS}`,
      }
    }
    const task = mode === "write"
      ? `New text will be inserted at the empty [[]]. The writer asks: "${prompt}". In "text", write what goes there so it does what they ask.`
      : `The writer asks: "${prompt}". In "text", rewrite the marked passage so it does what they ask. It may change meaning, emphasis or length as far as the request needs.`
    return {
      schema: object({ text: string, directions: list(graded) }),
      user: `${marked(text, start, end)}

${task}
Then propose ${count} directions to steer that new version further, staying close to what the writer asked: nuances, intensities or angles of their request, not unrelated ideas. Each label is 1 to 3 lowercase words. ${keeping}${sourcesOf(refs)}${libraryOf(library)}
${STRENGTHS} Every strength is a rewrite of the new version, not of the original.`,
    }
  },
}

/** The text with the spot in [[ ]]. A long text is cut to its opening and the paragraphs around the spot. */
function marked(text, start, end) {
  const spot = `[[${text.slice(start, end)}]]`
  if (text.length <= WHOLE) return text.slice(0, start) + spot + text.slice(end)
  return leadUp(text.slice(0, start)) + spot + followUp(text.slice(end))
}

function leadUp(before) {
  if (before.length <= OPENING + BEFORE) return before
  const opening = before.slice(0, OPENING), near = before.slice(-BEFORE)
  return opening.slice(0, lastBreak(opening)) + GAP + near.slice(firstBreak(near))
}

function followUp(after) {
  if (after.length <= AFTER) return after
  const far = after.slice(0, AFTER)
  return far.slice(0, lastBreak(far)) + GAP.trimEnd()
}

/** Where to cut so that whole paragraphs are kept, or whole words when there is no paragraph break. */
function lastBreak(part) {
  const paragraph = part.lastIndexOf("\n\n")
  return paragraph > 0 ? paragraph : Math.max(0, part.lastIndexOf(" "))
}

function firstBreak(part) {
  const paragraph = part.indexOf("\n\n")
  return paragraph >= 0 ? paragraph + 2 : part.indexOf(" ") + 1
}

function avoiding(labels) {
  return labels.length ? `\nDo not repeat or closely echo: ${labels.join(", ")}.` : ""
}

function mixTask(mode) {
  return mode === "write"
    ? `Write new text to insert at the empty [[]], combining these moves (the percentage is how much each should shape it, the length in brackets is how long the result should be):`
    : `Rewrite the marked passage as a blend of these directions, each with how strongly it should pull (100% = fully committed):`
}

function mixOf(pulls) {
  if (!pulls.length) return "- stay close to the original"
  return pulls.map(({ label, weight, length }) => `- ${label}: ${Math.round(weight * 100)}%${length ? ` (${length})` : ""}`).join("\n")
}

function sourcesOf(refs) {
  if (!refs.length) return ""
  return `\nDraw on these references from the writer's own documents, using only what they say:\n${refs.map((ref) => `[${ref.title}] ${ref.text}`).join("\n")}`
}

function libraryOf(library) {
  let room = LIBRARY
  const shown = []
  for (const { title, text } of library) {
    if (room <= 0) break
    shown.push(`[${title}] ${text.length > room ? `${text.slice(0, room)}…` : text}`)
    room -= text.length
  }
  if (!shown.length) return ""
  return `\nThese are the writer's own documents, in case the request refers to one of them. Use only what the request needs, and only what they say:\n${shown.join("\n")}`
}
