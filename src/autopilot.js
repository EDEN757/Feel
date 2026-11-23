/**
 * The tour plays itself. A ghost cursor walks through each interaction by sending the same mouse and key events
 * a person would, so what is shown is the real interface. A real cursor passing over changes nothing; the first
 * press or key stops the show and hands over the controls. It starts over a few seconds after the visitor leaves.
 */

export const pilot = { running: false }

const RESUME_AFTER_MS = 3500

/**
 * @param app what the show needs from the app:
 *   rects(start, end) the on-screen boxes of a stretch of text; select(start, end) and writeAt(offset) to open the ring;
 *   point(index, level) a spot on the ring; isOpen(), isBusy(), text(); reset() back to the untouched sample.
 */
export function startAutopilot(app) {
  const ghost = document.body.appendChild(Object.assign(document.createElement("div"), { id: "ghost" }))
  const note = document.body.appendChild(Object.assign(document.createElement("div"), { id: "demoNote" }))
  const marks = document.body.appendChild(Object.assign(document.createElement("div"), { id: "ghostMarks" }))
  const at = { x: innerWidth / 2, y: innerHeight / 2 }
  let run = 0
  let visible = false
  let resume = null

  addEventListener("message", (event) => {
    if (event.origin !== location.origin || typeof event.data?.feelingPlay !== "boolean") return
    visible = event.data.feelingPlay
    if (visible && !pilot.running && !resume) play()
    if (!visible) stop()
  })

  /** While the show runs, the visitor's pointer must not steer it: movement and scrolling pass the app by. */
  for (const type of ["mousemove", "wheel"]) {
    addEventListener(type, (event) => {
      if (event.isTrusted && pilot.running) event.stopImmediatePropagation()
    }, true)
  }
  /** A press or a key is the visitor asking for the controls. That first one only takes over; it is not acted on. */
  for (const type of ["mousedown", "keydown"]) {
    addEventListener(type, (event) => {
      if (!event.isTrusted) return
      clearTimeout(resume)
      resume = null
      if (!pilot.running) return
      if (type === "keydown" && (event.metaKey || event.ctrlKey || event.altKey)) return
      event.stopImmediatePropagation()
      event.preventDefault()
      takeOver()
    }, true)
  }
  document.documentElement.addEventListener("mouseleave", (event) => {
    if (!event.isTrusted || pilot.running) return
    clearTimeout(resume)
    resume = setTimeout(() => { resume = null; if (visible) play() }, RESUME_AFTER_MS)
  })

  function takeOver() {
    stop()
    app.reset()
    note.textContent = "your turn · it plays again when you leave"
  }

  function stop() {
    run++
    pilot.running = false
    document.body.classList.remove("piloting")
    ghost.classList.remove("show")
    mark([])
    say(null)
  }

  /** Paints a selection over the given boxes. Drawn by hand, because a frame without focus shows no real selection. */
  function mark(boxes) {
    marks.replaceChildren(...boxes.map((box) => {
      const piece = document.createElement("i")
      Object.assign(piece.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` })
      return piece
    }))
  }

  async function play() {
    const mine = ++run
    pilot.running = true
    document.body.classList.add("piloting")
    ghost.classList.add("show")
    note.textContent = "playing by itself · click here to try it yourself"
    try {
      while (true) {
        app.reset()
        await show(mine)
      }
    } catch (error) {
      if (error !== STOPPED) throw error
    }
  }

  /** One pass through every interaction. */
  async function show(mine) {
    const alive = () => { if (mine !== run) throw STOPPED }
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)).then(alive)
    const settled = async () => { while (!app.isOpen() || app.isBusy()) await wait(80) }

    const moveTo = async (x, y, ms = 700) => {
      const from = { ...at }, started = performance.now()
      while (true) {
        const t = Math.min(1, (performance.now() - started) / ms), eased = t * t * (3 - 2 * t)
        at.x = from.x + (x - from.x) * eased
        at.y = from.y + (y - from.y) * eased
        ghost.style.transform = `translate(${at.x}px, ${at.y}px)`
        send("mousemove")
        if (t === 1) return
        await new Promise(requestAnimationFrame).then(alive)
      }
    }
    const toRing = (index, level, ms) => moveTo(...app.point(index, level), ms)
    const send = (type) => document.body.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: at.x, clientY: at.y, button: 0 }))
    const press = (key, target = document.body) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))

    /** Drags a selection across a phrase the way a hand would, then opens the ring on it. */
    const select = async (phrase) => {
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
    }

    say("select")
    await wait(600)
    await select("I think I could help your company")
    await wait(500)
    for (const level of [1, 2, 3]) { await toRing(1, level, 650); await wait(750) }
    await toRing(0, 2, 900)
    await wait(900)

    say("pin")
    await toRing(1, 2, 800)
    await wait(300)
    send("mousedown")
    await wait(700)
    await toRing(4, 2, 1000)
    await settled()
    await wait(1100)
    send("mousedown")
    await wait(300)
    await toRing(4, 0, 600)
    await wait(900)

    say("save")
    await wait(400)
    press("Enter")
    await wait(2400)

    say("ask")
    await select("I learned to work with people from different fields")
    const ask = document.querySelector("#askInput")
    for (const letter of "connect it to my thesis") { ask.value += letter; await wait(55) }
    await wait(400)
    press("Enter", ask)
    ask.value = ""
    await wait(600)
    await settled()
    await wait(1800)
    press("Enter")
    await wait(2400)

    say("shorter")
    await select("I would sit with them, listen until I understood what they were really asking, and then turn it into something they could use every day: a dashboard, a cleaning script, a small app.")
    await wait(500)
    for (let i = 0; i < 2; i++) { press("ArrowLeft"); await wait(1500) }
    press("Escape")
    await wait(900)

    say("write")
    const sentence = "would be useful in the role."
    const offset = app.text().indexOf(sentence) + sentence.length
    const spot = app.rects(offset - 1, offset).at(-1)
    await moveTo(spot.right + 2, spot.top + spot.height / 2, 900)
    await wait(300)
    app.writeAt(offset)
    await settled()
    await wait(400)
    for (const level of [1, 2, 3]) { await toRing(0, level, 650); await wait(900) }
    press("Enter")
    await wait(3000)
    say(null)
  }

  function say(step) {
    parent.postMessage({ feelingNow: step }, location.origin)
  }
}

const STOPPED = Symbol("stopped")
