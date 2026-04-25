import { createBrowserRouter, type LoaderFunctionArgs } from "react-router"
import { Layout } from "./components/Layout"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { Home } from "./pages/Home"
import { Chronicle } from "./pages/Chronicle"

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
    ],
  },
])
