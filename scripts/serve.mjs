/** A static file server for local development. The app has no backend: any static host works. */

import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

const PORT = Number(process.env.PORT ?? 4317)
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" }

createServer(async (request, response) => {
  const { pathname } = new URL(request.url, "http://localhost")
  const path = normalize(join(ROOT, pathname.endsWith("/") ? `${pathname}index.html` : pathname))
  const file = path.startsWith(ROOT) ? await readFile(path).catch(() => null) : null
  if (!file) return response.writeHead(404).end("not found")
  response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" })
  response.end(file)
}).listen(PORT, "127.0.0.1", () => console.log(`feeling on http://localhost:${PORT}`))
