import { createReadStream, existsSync, statSync } from "node:fs"
import { extname, join, normalize, resolve } from "node:path"
import { createServer } from "node:http"

const rootArg = process.argv[2] ?? "dist/client"
const portArg = Number(process.argv[3] ?? "4173")
const root = resolve(process.cwd(), rootArg)
const indexPath = join(root, "index.html")

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
}

function getContentType(filePath) {
  return CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream"
}

function isAssetRequest(pathname) {
  return pathname.includes(".") || pathname.startsWith("/assets/")
}

function sendFile(response, filePath, statusCode = 200) {
  response.writeHead(statusCode, {
    "Content-Type": getContentType(filePath),
    "Cache-Control": isAssetRequest(filePath) ? "public, max-age=31536000, immutable" : "no-cache",
  })
  createReadStream(filePath).pipe(response)
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1")
  const decodedPath = decodeURIComponent(url.pathname)
  const requestedPath = normalize(join(root, decodedPath))

  if (!requestedPath.startsWith(root)) {
    response.writeHead(403).end("Forbidden")
    return
  }

  if (existsSync(requestedPath) && statSync(requestedPath).isFile()) {
    sendFile(response, requestedPath)
    return
  }

  if (isAssetRequest(decodedPath)) {
    response.writeHead(404).end("Not Found")
    return
  }

  sendFile(response, indexPath)
})

server.listen(portArg, "127.0.0.1", () => {
  console.log(`SPA server listening on http://127.0.0.1:${portArg}`)
})
