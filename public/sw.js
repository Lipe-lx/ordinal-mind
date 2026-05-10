const STATIC_CACHE = "ordinalmind-static-v1"
const OFFLINE_URL = "/offline.html"
const STATIC_PATHS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/app-icon.svg",
  "/icons/app-icon-maskable.svg",
]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_PATHS))
  )
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)))
      await self.clients.claim()
    })
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/")) return

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request))
    return
  }

  if (isStaticAsset(url)) {
    event.respondWith(handleStaticAsset(request))
  }
})

async function handleNavigation(request) {
  try {
    return await fetch(request)
  } catch {
    const cache = await caches.open(STATIC_CACHE)
    return (await cache.match(OFFLINE_URL)) || Response.error()
  }
}

async function handleStaticAsset(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) {
      await cache.put(request, response.clone())
    }
    return response
  } catch {
    return cached || Response.error()
  }
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.svg" ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".svg")
  )
}
