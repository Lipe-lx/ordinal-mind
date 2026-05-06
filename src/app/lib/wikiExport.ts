import { readStoredDiscordJWT } from "./useDiscordIdentity"

export type WikiExportStatus = "success" | "cancelled" | "error"

export interface WikiExportOutcome {
  status: WikiExportStatus
  filename?: string
  message?: string
}

interface SavePickerWindowLike {
  showSaveFilePicker?: (options?: {
    suggestedName?: string
    excludeAcceptAllOption?: boolean
    types?: Array<{
      description?: string
      accept: Record<string, string[]>
    }>
  }) => Promise<FileSystemFileHandleLike>
}

interface FileSystemFileHandleLike {
  createWritable: () => Promise<FileSystemWritableFileStreamLike>
}

type FileSystemWritableFileStreamLike = WritableStream<Uint8Array> & {
  write: (data: Blob | BufferSource | string) => Promise<void>
  close: () => Promise<void>
}

interface AnchorLike {
  href: string
  download: string
  click: () => void
  remove: () => void
}

interface WikiExportDependencies {
  fetchImpl?: typeof fetch
  windowLike?: (Window & SavePickerWindowLike) | SavePickerWindowLike
  documentLike?: Document
  token?: string | null
  now?: Date
}

const EXPORT_ENDPOINT = "/api/wiki/export"

export async function downloadWikiExport(
  dependencies: WikiExportDependencies = {}
): Promise<WikiExportOutcome> {
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const windowLike = dependencies.windowLike ?? (typeof window !== "undefined" ? window : undefined)
  const documentLike = dependencies.documentLike ?? (typeof document !== "undefined" ? document : undefined)
  const token = dependencies.token ?? readStoredDiscordJWT()

  if (!token) {
    return {
      status: "error",
      message: "Connect Discord to export the public wiki.",
    }
  }

  const suggestedName = buildSuggestedExportFilename(dependencies.now ?? new Date())
  const savePicker = resolveSavePicker(windowLike)

  try {
    if (savePicker) {
      const fileHandle = await savePicker({
        suggestedName,
        excludeAcceptAllOption: false,
        types: [
          {
            description: "ZIP archive",
            accept: { "application/zip": [".zip"] },
          },
        ],
      })

      const response = await fetchExportArchive(fetchImpl, token)
      const writable = await fileHandle.createWritable()
      if (response.body) {
        await response.body.pipeTo(writable)
      } else {
        await writable.write(await response.blob())
        await writable.close()
      }

      return {
        status: "success",
        filename: parseDownloadFilename(response.headers.get("Content-Disposition")) ?? suggestedName,
      }
    }

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
    if (isAbortError(error)) {
      return { status: "cancelled" }
    }

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

async function fetchExportArchive(fetchImpl: typeof fetch, token: string): Promise<Response> {
  const response = await fetchImpl(EXPORT_ENDPOINT, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
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

function resolveSavePicker(windowLike: WikiExportDependencies["windowLike"]) {
  const maybePicker = windowLike?.showSaveFilePicker
  return typeof maybePicker === "function" ? maybePicker.bind(windowLike) : null
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object"
      && error !== null
      && "name" in error
      && (error as { name?: unknown }).name === "AbortError"
}
