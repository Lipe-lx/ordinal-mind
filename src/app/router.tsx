import { createBrowserRouter, type LoaderFunctionArgs, type HydrationState } from "react-router"

declare global {
  interface Window {
    __ROUTER_HYDRATION_DATA__?: HydrationState
  }
}
import { Layout } from "./components/Layout"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { Home } from "./pages/Home"
import { Chronicle } from "./pages/Chronicle"
import { TermsOfUse } from "./pages/TermsOfUse"
import { Policies } from "./pages/Policies"
import { Docs } from "./pages/Docs"

// The loader now only validates the ID and passes it to the component.
// Actual data fetching happens client-side via SSE for progress feedback.
async function chronicleLoader({ params }: LoaderFunctionArgs) {
  const id = params.id
  if (!id) throw new Response("Missing inscription ID", { status: 400 })
  return { id }
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    errorElement: <ErrorBoundary />,
    HydrateFallback: () => (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh", background: "var(--bg-primary)", color: "var(--text-secondary)" }}>
        Loading...
      </div>
    ),
    children: [
      {
        index: true,
        element: <Home />,
      },
      {
        path: "chronicle/:id",
        element: <Chronicle />,
        loader: chronicleLoader,
        errorElement: <ErrorBoundary />,
      },
      {
        path: "address/:address",
        lazy: () => import("./pages/AddressPage").then(m => ({ Component: m.AddressPage })),
        loader: async ({ params }) => {
          if (!params.address) throw new Response("Missing address", { status: 400 })
          return { address: params.address }
        },
        errorElement: <ErrorBoundary />,
      },
      {
        path: "wiki/:slug",
        lazy: () => import("./pages/WikiPage").then(m => ({ Component: m.WikiPage })),
        errorElement: <ErrorBoundary />,
      },
      {
        path: "terms",
        element: <TermsOfUse />,
        errorElement: <ErrorBoundary />,
      },
      {
        path: "policies",
        element: <Policies />,
        errorElement: <ErrorBoundary />,
      },
      {
        path: "docs",
        element: <Docs />,
        errorElement: <ErrorBoundary />,
      },
    ],
  },
], {
  hydrationData: window.__ROUTER_HYDRATION_DATA__,
})
