import { afterEach, describe, expect, it, vi } from "vitest"
import {
  buildSuggestedExportFilename,
  downloadWikiExport,
  parseDownloadFilename,
} from "../../src/app/lib/wikiExport"

describe("wikiExport", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("uses the browser download flow via blob and anchor", async () => {
    const clickMock = vi.fn()
    const removeMock = vi.fn()
    const appendChildMock = vi.fn()
    const createObjectURLMock = vi.fn().mockReturnValue("blob:ordinalmind-export")
    const revokeObjectURLMock = vi.fn()

    vi.stubGlobal("URL", {
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock,
    })

    const documentLike = {
      body: {
        appendChild: appendChildMock,
      },
      createElement: vi.fn().mockReturnValue({
        href: "",
        download: "",
        click: clickMock,
        remove: removeMock,
      }),
    } as unknown as Document

    const fetchMock = vi.fn().mockResolvedValue(new Response("zip-fallback", {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename*=UTF-8''ordinalmind-wiki-export-2026-05-06.zip`,
      },
    }))

    const result = await downloadWikiExport({
      fetchImpl: fetchMock,
      token: "jwt-token",
      documentLike,
      now: new Date("2026-05-06T00:00:00.000Z"),
    })

    expect(result.status).toBe("success")
    expect(result.filename).toBe("ordinalmind-wiki-export-2026-05-06.zip")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: "Bearer jwt-token" })
    expect(clickMock).toHaveBeenCalledTimes(1)
    expect(removeMock).toHaveBeenCalledTimes(1)
    expect(createObjectURLMock).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:ordinalmind-export")
  })

  it("returns an inline error when the export endpoint fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "invalid_auth_token",
    }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
      },
    }))

    const result = await downloadWikiExport({
      fetchImpl: fetchMock,
      token: "jwt-token",
      documentLike: {
        body: {
          appendChild: vi.fn(),
        },
        createElement: vi.fn(),
      } as unknown as Document,
    })

    expect(result.status).toBe("error")
    expect(result.message).toBe("invalid_auth_token")
  })

  it("builds predictable filenames and parses content disposition", () => {
    expect(buildSuggestedExportFilename(new Date("2026-05-06T12:30:00.000Z"))).toBe("ordinalmind-wiki-export-2026-05-06.zip")
    expect(parseDownloadFilename(`attachment; filename="wiki.zip"`)).toBe("wiki.zip")
    expect(parseDownloadFilename(`attachment; filename*=UTF-8''wiki%20export.zip`)).toBe("wiki export.zip")
  })
})
