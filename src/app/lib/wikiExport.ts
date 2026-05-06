export type WikiExportStatus = "success" | "error"

export interface WikiExportOutcome {
  status: WikiExportStatus
  filename?: string
  message?: string
}

interface AnchorLike {
  href: string
  download: string
  click: () => void
  remove: () => void
}

interface WikiExportDependencies {
  fetchImpl?: typeof fetch
  documentLike?: Document
  token?: string | null
  now?: Date
}

const EXPORT_ENDPOINT = "/api/wiki/export"

export async function downloadWikiExport(
  dependencies: WikiExportDependencies = {}
): Promise<WikiExportOutcome> {
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const documentLike = dependencies.documentLike ?? (typeof document !== "undefined" ? document : undefined)
  const token = dependencies.token ?? null

  const suggestedName = buildSuggestedExportFilename(dependencies.now ?? new Date())

  try {
    if (!documentLike || !globalThis.URL) {
      return {
        status: "error",
        message: "This browser cannot save the export archive here.",
      }
    }

    const response = await fetchExportArchive(fetchImpl, token)
    const filename = parseDownloadFilename(response.headers.get("Content-Disposition")) ?? suggestedName
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)

    try {
      const anchor = documentLike.createElement("a") as HTMLAnchorElement & AnchorLike
      anchor.href = objectUrl
      anchor.download = filename
      documentLike.body?.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } finally {
      URL.revokeObjectURL(objectUrl)
    }

    return {
      status: "success",
      filename,
    }
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not export the public wiki.",
    }
  }
}

export function buildSuggestedExportFilename(now = new Date()): string {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, "0")
  const day = String(now.getUTCDate()).padStart(2, "0")
  return `ordinal-mind-wiki-export-${year}-${month}-${day}.zip`
}

export function parseDownloadFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null

  const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      // Ignore invalid encoding and fall through.
    }
  }

  const asciiMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"/i)
    ?? contentDisposition.match(/filename\s*=\s*([^;]+)/i)

  return asciiMatch?.[1]?.trim() ?? null
}

async function fetchExportArchive(fetchImpl: typeof fetch, token: string | null): Promise<Response> {
  const response = await fetchImpl(EXPORT_ENDPOINT, {
    method: "GET",
    credentials: "same-origin",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })

  if (!response.ok) {
    let detail = "Could not export the public wiki."
    try {
      const body = await response.json() as { error?: string }
      if (typeof body.error === "string" && body.error.length > 0) {
        detail = body.error
      }
    } catch {
      // Ignore malformed error bodies.
    }
    throw new Error(detail)
  }

  return response
}
