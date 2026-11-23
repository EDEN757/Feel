/**
 * The clips on the front page. Each one is the real app in a small frame, with a ghost cursor walking through one
 * interaction by sending the same mouse and key events a person would, then starting over. Nothing is recorded.
 */

export const pilot = { running: false }

const FIRST = "I think I could help your company"
const SECOND = "I learned to work with people from different fields"
const LONG = "I would sit with them, listen until I understood what they were really asking, and then turn it into something they could use every day: a dashboard, a cleaning script, a small app."
const STOPPED = Symbol("stopped")
/** Every pause and movement is stretched by this much, so there is time to read what changed. */
const PACE = 1.14

/** One interaction each. `it` is the set of gestures built in `startAutopilot`. */
const CLIPS = {
  async change(it) {
    await it.select(FIRST)
    for (const level of [1, 2, 3]) { await it.toRing(1, level, 650); await it.wait(800) }
    await it.toRing(0, 2, 900)
    await it.wait(900)
    await it.toRing(4, 3, 1000)
    await it.wait(1000)
    it.press("Enter")
    await it.wait(2600)
  },

  async combine(it) {
    await it.select(FIRST)
    await it.toRing(0, 2, 800, 0.35)
    await it.wait(300)
    it.click()
    await it.wait(700)
    await it.toRing(2, 3, 1000, 0.7)
    await it.settled()
    await it.wait(900)
    it.click()
    await it.wait(600)
    await it.toRing(4, 1, 1000, 0.4)
    await it.settled()
    await it.wait(900)
    it.click()
    await it.wait(300)
    await it.toRing(5, 0, 600)
    await it.wait(1300)
    it.press("Enter")
    await it.wait(2600)
  },

  async ask(it) {
    await it.select(SECOND)
    await it.type("connect it to my thesis")
    await it.settled()
    await it.wait(1500)
    await it.toRing(2, 2, 900)
    await it.wait(1300)
    it.press("Enter")
    await it.wait(2600)
  },

  async shorter(it) {
    await it.select(LONG)
    await it.wait(500)
    for (let i = 0; i < 3; i++) { it.press("ArrowLeft"); await it.wait(1500) }
    it.press("ArrowRight")
    await it.wait(1400)
    it.press("Escape")
    await it.wait(1200)
  },

  async documents(it) {
    await it.select(FIRST)
    await it.moveTo(innerWidth - 4, innerHeight / 2, 900)
    await it.wait(700)
    const passage = document.querySelectorAll("#refs .doc p")[3].getBoundingClientRect()
    await it.moveTo(passage.left + 60, passage.top + passage.height / 2, 700)
    await it.wait(400)
    it.click()
    await it.wait(1200)
    await it.toRing(1, 2, 1100)
    await it.settled()
    await it.wait(1600)
    it.press("Enter")
    await it.wait(2800)
  },

  async write(it) {
    const sentence = "would be useful in the role."
    const offset = it.app.text().indexOf(sentence) + sentence.length
    const spot = it.app.rects(offset - 1, offset).at(-1)
    await it.moveTo(spot.right + 2, spot.top + spot.height / 2, 900)
    await it.wait(300)
    it.app.writeAt(offset)
    await it.settled()
    await it.wait(400)
    for (const level of [1, 2, 3]) { await it.toRing(0, level, 650); await it.wait(950) }
    it.press("Enter")
    await it.wait(3000)
  },
}

/**
 * Plays one clip on a loop while the front page says it is in view.
 * @param app what a clip needs from the app: rects(start, end) the on-screen boxes of a stretch of text;
 *   select(start, end) and writeAt(offset) to open the ring; point(index, level, across) a spot on the ring;
 *   isOpen(), isBusy(), text(); reset() back to the untouched sample.
 */
export function startAutopilot(app, name) {
  const clip = CLIPS[name]
  if (!clip) return
  pilot.running = true
  const ghost = document.body.appendChild(Object.assign(document.createElement("div"), { id: "ghost" }))
  const marks = document.body.appendChild(Object.assign(document.createElement("div"), { id: "ghostMarks" }))
  const at = { x: innerWidth / 2, y: innerHeight / 2 }
  let run = 0

  addEventListener("message", (event) => {
    if (event.origin !== location.origin || typeof event.data?.feelingPlay !== "boolean") return
    if (event.data.feelingPlay) play()
    else run++
  })

  async function play() {
    const mine = ++run
    try {
      while (true) {
        mark([])
        app.reset()
        await gestures(mine).wait(700)
        await clip(gestures(mine))
        parent.postMessage({ feelingClipDone: name }, location.origin)
      }
    } catch (error) {
      if (error !== STOPPED) throw error
    }
  }

  function gestures(mine) {
    const alive = () => { if (mine !== run) throw STOPPED }
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms * PACE)).then(alive)
    const send = (type) => (document.elementFromPoint(at.x, at.y) ?? document.body).dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: at.x, clientY: at.y, button: 0 }))
    const press = (key, target = document.body) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
    const settled = async () => { while (!app.isOpen() || app.isBusy()) await wait(80) }

    async function moveTo(x, y, ms = 700) {
      const from = { ...at }, started = performance.now()
      while (true) {
        const t = Math.min(1, (performance.now() - started) / (ms * PACE)), eased = t * t * (3 - 2 * t)
        at.x = from.x + (x - from.x) * eased
        at.y = from.y + (y - from.y) * eased
        ghost.style.transform = `translate(${at.x}px, ${at.y}px)`
        send("mousemove")
        if (t === 1) return
        await new Promise(requestAnimationFrame).then(alive)
      }
    }

    /** Drags a selection across a phrase the way a hand would, then opens the ring on it. */
    async function select(phrase) {
      const start = app.text().indexOf(phrase), end = start + phrase.length
      const boxes = app.rects(start, end), first = boxes[0], last = boxes.at(-1)
      await moveTo(first.left, first.top + first.height / 2, 800)
      const steps = Math.max(10, Math.round(phrase.length / 5))
      for (let i = 1; i <= steps; i++) {
        const sofar = app.rects(start, start + Math.max(1, Math.round((phrase.length * i) / steps)))
        mark(sofar)
        await moveTo(sofar.at(-1).right, sofar.at(-1).top + sofar.at(-1).height / 2, 40)
      }
      await moveTo(last.right, last.top + last.height / 2, 60)
      await wait(300)
      mark([])
      app.select(start, end)
      await settled()
      await wait(400)
    }

    /** Types into the ask bar letter by letter, then sends it. */
    async function type(words) {
      const ask = document.querySelector("#askInput")
      for (const letter of words) { ask.value += letter; await wait(55) }
      await wait(450)
      press("Enter", ask)
      ask.value = ""
      await wait(500)
    }

    return { app, wait, press, settled, moveTo, select, type, click: () => send("mousedown"), toRing: (index, level, ms, across) => moveTo(...app.point(index, level, across), ms) }
  }

  /** Paints a selection over the given boxes. Drawn by hand, because a frame without focus shows no real selection. */
  function mark(boxes) {
    marks.replaceChildren(...boxes.map((box) => {
      const piece = document.createElement("i")
      Object.assign(piece.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` })
      return piece
    }))
  }
}
