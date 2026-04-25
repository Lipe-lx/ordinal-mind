import { describe, expect, it } from "vitest"
import {
  buildOrdinalsPreviewUrl,
  detectMediaKind,
  getMediaFallbackReason,
  getMediaPreviewMode,
  isTextLikeContentType,
} from "../../src/app/lib/media"

describe("media helpers", () => {
  it("treats structured application payloads as text-like", () => {
    expect(isTextLikeContentType("application/json; charset=utf-8")).toBe(true)
    expect(isTextLikeContentType("application/ld+json")).toBe(true)
    expect(isTextLikeContentType("application/pdf")).toBe(false)
  })

  it("detects model and document inscriptions distinctly", () => {
    expect(detectMediaKind("model/gltf+json")).toBe("model")
    expect(detectMediaKind("application/pdf")).toBe("document")
    expect(detectMediaKind("text/plain;charset=utf-8")).toBe("text")
  })

  it("maps advanced media kinds to ordinals preview mode", () => {
    expect(getMediaPreviewMode({ kind: "model" })).toBe("ordinals_preview")
    expect(getMediaPreviewMode({ kind: "html" })).toBe("ordinals_preview")
    expect(getMediaPreviewMode({ kind: "text" })).toBe("text")
  })

  it("builds a stable preview url and fallback reason", () => {
    expect(buildOrdinalsPreviewUrl("abc123i0")).toBe("https://ordinals.com/preview/abc123i0")
    expect(getMediaFallbackReason("model")).toContain("ordinals preview")
  })
})
