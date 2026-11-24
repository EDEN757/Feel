/**
 * The front page: words drawn as dot-matrix displays that scatter from the cursor, the title that falls apart
 * as the page scrolls, the clips, and the tour's checklist.
 */

/** How far from the cursor dots are pushed, at most; small words use less. */
const REACH = 34
/** A clip is drawn at the size of a real window, so the text and the ring keep the app's own proportions. */
const CLIP_WIDTH = 1200, CLIP_HEIGHT = 714

/** A 5×7 dot-matrix face, only the letters the page shows. */
const GLYPHS = {
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
}

const steps = document.querySelector("#steps")
const isDemo = new URLSearchParams(location.search).has("demo")

if (!isDemo) {
  for (const canvas of document.querySelectorAll("canvas[data-word]")) drawWord(canvas)
  for (const frame of document.querySelectorAll("iframe[data-frame]")) watchFrame(frame)
  const track = document.querySelector("#clips .track")
  if (track) lineUp(track)
}

addEventListener("message", (event) => {
  if (event.origin !== location.origin || typeof event.data?.feeling !== "string") return
  steps?.querySelector(`[data-step="${CSS.escape(event.data.feeling)}"]`)?.classList.add("done")
})

/**
 * The clips sit in one line with a single clip in the spotlight, centred and at full strength; the rest are dimmed.
 * The line moves on when the spotlit clip finishes, or when a clip is clicked.
 */
function lineUp(track) {
  const figures = [...track.children]
  const frameOf = (figure) => figure.querySelector("iframe")
  let spot = 0

  const centre = () => {
    const figure = figures[spot]
    track.style.transform = `translateX(${track.parentElement.clientWidth / 2 - (figure.offsetLeft + figure.offsetWidth / 2)}px)`
  }
  const show = (index) => {
    spot = (index + figures.length) % figures.length
    figures.forEach((figure, i) => figure.classList.toggle("spot", i === spot))
    centre()
    frameOf(figures[spot]).contentWindow?.postMessage({ feelingPlay: true }, location.origin)
  }

  figures.forEach((figure, i) => figure.addEventListener("click", () => show(i === spot ? spot + 1 : i)))
  addEventListener("message", (event) => {
    if (event.origin !== location.origin || !event.data?.feelingClipDone) return
    if (event.source === frameOf(figures[spot]).contentWindow) show(spot + 1)
  })
  new ResizeObserver(centre).observe(track.parentElement)
  show(0)
}

/**
 * Each frame is the app itself. It loads once it scrolls near and never inside itself.
 * A clip is drawn at a fixed size and scaled to its box, and is told to play only while in view.
 */
function watchFrame(frame) {
  const loader = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return
    frame.src = frame.dataset.frame
    loader.disconnect()
  }, { rootMargin: "300px" })
  loader.observe(frame)
  if (!frame.dataset.frame.includes("clip=")) return

  frame.width = CLIP_WIDTH
  frame.height = CLIP_HEIGHT
  new ResizeObserver(([entry]) => { frame.style.transform = `scale(${entry.contentRect.width / CLIP_WIDTH})` }).observe(frame.parentElement)

  let inView = false
  const tell = () => frame.contentWindow?.postMessage({ feelingPlay: inView }, location.origin)
  new IntersectionObserver(([entry]) => { inView = entry.intersectionRatio > 0.3; tell() }, { threshold: [0, 0.3, 1] }).observe(frame.parentElement)
  frame.addEventListener("load", () => setTimeout(tell, 500))
}

/**
 * Draws the canvas's word in dots. With `data-fall`, the canvas extends below the word and the dots rain down it
 * as the page scrolls, each on its own delay; scrolling back up runs the same motion in reverse.
 */
function drawWord(canvas) {
  const word = canvas.dataset.word, cell = Number(canvas.dataset.cell), falls = "fall" in canvas.dataset
  const ctx = canvas.getContext("2d")
  const dpr = devicePixelRatio || 1
  const margin = cell * 2, reach = Math.min(REACH, cell * 9)
  const wordWidth = margin * 2 + (word.length * 6 - 1) * cell, wordHeight = margin * 2 + 7 * cell
  const side = falls ? 60 : 0, room = falls ? Math.min(innerHeight * 0.62, 560) : 0
  const width = wordWidth + side * 2, height = wordHeight + room

  const dots = []
  ;[...word.toUpperCase()].forEach((letter, index) => {
    GLYPHS[letter]?.forEach((row, y) => [...row].forEach((on, x) => {
      if (on !== "1") return
      const homeX = side + margin + (index * 6 + x) * cell, homeY = margin + y * cell
      dots.push({ homeX, homeY, x: homeX, y: homeY, vx: 0, vy: 0, phase: index * 0.9 + y * 0.35, delay: Math.random() * 0.55, reach: 0.55 + Math.random() * 0.45, drift: (Math.random() - 0.5) * 46 })
    }))
  })

  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx.scale(dpr, dpr)
  if (falls) Object.assign(canvas.parentElement.style, { width: `${wordWidth}px`, height: `${wordHeight}px` })

  let mouse = null
  addEventListener("mousemove", (e) => {
    const box = canvas.getBoundingClientRect()
    const inside = e.clientX > box.left - reach && e.clientX < box.right + reach && e.clientY > box.top - reach && e.clientY < box.top + wordHeight + reach
    mouse = inside ? { x: e.clientX - box.left, y: e.clientY - box.top } : null
  })

  const size = cell * 0.72
  requestAnimationFrame(function frame(t) {
    requestAnimationFrame(frame)
    if (!canvas.offsetParent) return
    const scrolled = falls ? Math.min(1, scrollY / (innerHeight * 0.5)) : 0
    ctx.clearRect(0, 0, width, height)
    for (const dot of dots) {
      if (mouse) {
        const dx = dot.x - mouse.x, dy = dot.y - mouse.y, distance = Math.hypot(dx, dy) || 1
        if (distance < reach) {
          const push = (1 - distance / reach) * 1.8
          dot.vx += (dx / distance) * push - (dy / distance) * push * 0.5
          dot.vy += (dy / distance) * push + (dx / distance) * push * 0.5
        }
      }
      dot.vx = (dot.vx + (dot.homeX - dot.x) * 0.06) * 0.86
      dot.vy = (dot.vy + (dot.homeY - dot.y) * 0.06) * 0.86
      dot.x += dot.vx
      dot.y += dot.vy

      const fallen = Math.max(0, (scrolled - dot.delay) / (1 - dot.delay))
      if (fallen >= 1) continue
      const scan = 0.5 + 0.5 * Math.sin(t / 700 - dot.phase)
      ctx.fillStyle = `rgba(255,255,255,${(0.7 + 0.3 * scan) * (1 - fallen ** 1.6)})`
      ctx.fillRect(dot.x + dot.drift * fallen, dot.y + fallen * fallen * room * dot.reach, size, size * (1 + 5 * fallen))
    }
  })
}
