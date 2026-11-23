/** The front page: the creator's name drawn in dots that scatter from the cursor, and the tour's checklist. */

const NAME = "edoardo schiatti"
const GAP = 3
const REACH = 34

const canvas = document.querySelector("#dotName canvas")
const steps = document.querySelector("#steps")

const demo = document.querySelector("#demo")
const isDemo = new URLSearchParams(location.search).has("demo")

if (canvas && !isDemo) document.fonts.ready.then(startDots)

/** The tour is the app itself in a frame; it loads only once it scrolls near, and never inside itself. */
if (demo && !isDemo) {
  const watcher = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return
    demo.src = "?demo"
    watcher.disconnect()
  }, { rootMargin: "300px" })
  watcher.observe(demo)
}

addEventListener("message", (event) => {
  if (event.origin !== location.origin || typeof event.data?.feeling !== "string") return
  steps?.querySelector(`[data-step="${CSS.escape(event.data.feeling)}"]`)?.classList.add("done")
})

function startDots() {
  const ctx = canvas.getContext("2d")
  const dpr = devicePixelRatio || 1
  const dots = dotsOf(NAME)
  const width = Math.max(...dots.map((dot) => dot.homeX)) + 12, height = 40
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx.scale(dpr, dpr)

  let mouse = null
  canvas.addEventListener("mousemove", (e) => {
    const box = canvas.getBoundingClientRect()
    mouse = { x: e.clientX - box.left, y: e.clientY - box.top }
  })
  canvas.addEventListener("mouseleave", () => (mouse = null))

  requestAnimationFrame(function frame(t) {
    requestAnimationFrame(frame)
    if (!canvas.offsetParent) return
    ctx.clearRect(0, 0, width, height)
    for (const dot of dots) {
      if (mouse) {
        const dx = dot.x - mouse.x, dy = dot.y - mouse.y, distance = Math.hypot(dx, dy) || 1
        if (distance < REACH) {
          const push = (1 - distance / REACH) * 2.4
          dot.vx += (dx / distance) * push - (dy / distance) * push * 0.5
          dot.vy += (dy / distance) * push + (dx / distance) * push * 0.5
        }
      }
      dot.vx = (dot.vx + (dot.homeX - dot.x) * 0.06) * 0.86
      dot.vy = (dot.vy + (dot.homeY - dot.y) * 0.06) * 0.86
      dot.x += dot.vx
      dot.y += dot.vy
      const away = Math.min(1, Math.hypot(dot.x - dot.homeX, dot.y - dot.homeY) / 14)
      const depth = 0.5 + 0.5 * Math.sin(t / 900 + dot.phase)
      const size = 1.3 + away * 1.6 + depth * 0.4
      ctx.fillStyle = `rgba(255,255,255,${0.45 + 0.25 * depth + 0.3 * away})`
      ctx.fillRect(dot.x - size / 2, dot.y - size / 2, size, size)
    }
  })
}

/** Samples the name, drawn off-screen, into a grid of dots. */
function dotsOf(name) {
  const scratch = document.createElement("canvas")
  scratch.width = 420
  scratch.height = 40
  const ctx = scratch.getContext("2d", { willReadFrequently: true })
  ctx.font = "500 21px 'IBM Plex Mono', ui-monospace, monospace"
  ctx.textBaseline = "middle"
  ctx.fillStyle = "#fff"
  ctx.fillText(name, 6, 21)
  const pixels = ctx.getImageData(0, 0, scratch.width, scratch.height).data
  const dots = []
  for (let y = 0; y < scratch.height; y += GAP) {
    for (let x = 0; x < scratch.width; x += GAP) {
      if (pixels[(y * scratch.width + x) * 4 + 3] > 110) dots.push({ homeX: x, homeY: y, x, y, vx: 0, vy: 0, phase: x * 0.05 + y * 0.2 })
    }
  }
  return dots
}
