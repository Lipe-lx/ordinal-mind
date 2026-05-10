import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router"
import { router } from "./router"
import { registerServiceWorker } from "./lib/registerServiceWorker"
import { runStorageMigration } from "./lib/storageMigration"
import "./index.css"

runStorageMigration()
registerServiceWorker()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
