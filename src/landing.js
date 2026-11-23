/** The front page: words drawn as dot-matrix displays that scatter from the cursor, and the tour's checklist. */

const REACH = 34

/** A 5×7 dot-matrix face, only the letters the page shows. */
const GLYPHS = {
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
}

const steps = document.querySelector("#steps")
const demo = document.querySelector("#demo")
const isDemo = new URLSearchParams(location.search).has("demo")

if (!isDemo) {
  for (const canvas of document.querySelectorAll("canvas[data-word]")) drawWord(canvas, canvas.dataset.word, Number(canvas.dataset.cell))
  if (demo) watchDemo()
}

addEventListener("message", (event) => {
  if (event.origin !== location.origin || !steps) return
  const { feeling, feelingNow } = event.data ?? {}
  if (typeof feeling === "string") steps.querySelector(`[data-step="${CSS.escape(feeling)}"]`)?.classList.add("done")
  if (feelingNow !== undefined) for (const step of steps.children) step.classList.toggle("now", step.dataset.step === feelingNow)
})

/** The tour is the app itself in a frame. It loads once it scrolls near, never inside itself, and plays only while in view. */
function watchDemo() {
  const loader = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return
    demo.src = "?demo"
    loader.disconnect()
  }, { rootMargin: "300px" })
  loader.observe(demo)

  let inView = false
  const tell = () => demo.contentWindow?.postMessage({ feelingPlay: inView }, location.origin)
  new IntersectionObserver(([entry]) => { inView = entry.intersectionRatio > 0.45; tell() }, { threshold: [0, 0.45, 1] }).observe(demo)
  demo.addEventListener("load", () => setTimeout(tell, 400))
}

function drawWord(canvas, word, cell) {
  const ctx = canvas.getContext("2d")
  const dpr = devicePixelRatio || 1
  const margin = cell * 2
  const dots = []
  ;[...word.toUpperCase()].forEach((letter, index) => {
    GLYPHS[letter]?.forEach((row, y) => [...row].forEach((on, x) => {
      if (on !== "1") return
      const homeX = margin + (index * 6 + x) * cell, homeY = margin + y * cell
      dots.push({ homeX, homeY, x: homeX, y: homeY, vx: 0, vy: 0, phase: index * 0.9 + y * 0.35 })
    }))
  })
  const width = margin * 2 + (word.length * 6 - 1) * cell, height = margin * 2 + 7 * cell
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

  const size = cell * 0.72
  requestAnimationFrame(function frame(t) {
    requestAnimationFrame(frame)
    if (!canvas.offsetParent) return
    ctx.clearRect(0, 0, width, height)
    for (const dot of dots) {
      if (mouse) {
        const dx = dot.x - mouse.x, dy = dot.y - mouse.y, distance = Math.hypot(dx, dy) || 1
        if (distance < REACH) {
          const push = (1 - distance / REACH) * 1.8
          dot.vx += (dx / distance) * push - (dy / distance) * push * 0.5
          dot.vy += (dy / distance) * push + (dx / distance) * push * 0.5
        }
      }
      dot.vx = (dot.vx + (dot.homeX - dot.x) * 0.06) * 0.86
      dot.vy = (dot.vy + (dot.homeY - dot.y) * 0.06) * 0.86
      dot.x += dot.vx
      dot.y += dot.vy
      const scan = 0.5 + 0.5 * Math.sin(t / 700 - dot.phase)
      ctx.fillStyle = `rgba(255,255,255,${0.7 + 0.3 * scan})`
      ctx.fillRect(dot.x, dot.y, size, size)
    }
  })
}
