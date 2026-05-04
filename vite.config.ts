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
          // Prevent Vite SPA fallback from intercepting /api/ routes during local dev.
          // Auth routes decide between JSON vs redirect inside the Worker using Sec-Fetch-Dest,
          // so even /api/auth/callback can safely be forced through the Worker.
          if (req.url?.startsWith("/api/")) {
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
