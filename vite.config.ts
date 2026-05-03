import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { cloudflare } from "@cloudflare/vite-plugin"
import path from "node:path"

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    {
      name: "api-bypass-spa",
      enforce: "pre",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // Prevent Vite SPA fallback from intercepting direct browser navigations to /api/
          // EXCEPTION: /api/auth/callback must allow standard browser navigation (Accept: text/html)
          // so the Worker can perform a 302 Redirect back to the SPA.
          if (req.url?.startsWith("/api/") && !req.url.startsWith("/api/auth/callback")) {
            req.headers.accept = "application/json"
          }
          next()
        })
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
})
