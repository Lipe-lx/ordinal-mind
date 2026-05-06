export function registerServiceWorker() {
  if (!import.meta.env.PROD) return
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("[PWA] Service worker registration failed", error)
    })
  })
}
