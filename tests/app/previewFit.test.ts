import { describe, expect, it } from "vitest"
import {
  buildSandboxedSrcDoc,
  computeFitScale,
  isNonImageFitKind,
  resolveNonImagePrimaryMode,
} from "../../src/app/lib/previewFit"

describe("preview fit helpers", () => {
  it("returns 1 when content already fits and does not upscale past max", () => {
    const result = computeFitScale({
      containerWidth: 600,
      containerHeight: 600,
      contentWidth: 300,
      contentHeight: 300,
      minScale: 0.55,
      maxScale: 1,
    })

    expect(result.scale).toBe(1)
    expect(result.clipped).toBe(false)
  })

  it("scales down proportionally when content is larger than container", () => {
    const result = computeFitScale({
      containerWidth: 400,
      containerHeight: 300,
      contentWidth: 500,
      contentHeight: 320,
      minScale: 0.55,
      maxScale: 1,
    })

    expect(result.scale).toBeCloseTo(0.8, 3)
    expect(result.clipped).toBe(false)
  })

  it("enforces minimum readable scale when base fit would be too small", () => {
    const result = computeFitScale({
      containerWidth: 240,
      containerHeight: 180,
      contentWidth: 2000,
      contentHeight: 1800,
      minScale: 0.55,
      maxScale: 1,
    })

    expect(result.baseScale).toBeLessThan(0.2)
    expect(result.scale).toBe(0.55)
    expect(result.clipped).toBe(true)
  })

  it("routes only non-image media kinds to fit renderer", () => {
    expect(isNonImageFitKind("image")).toBe(false)
    expect(isNonImageFitKind("audio")).toBe(false)
    expect(isNonImageFitKind("video")).toBe(false)

    expect(isNonImageFitKind("text")).toBe(true)
    expect(isNonImageFitKind("html")).toBe(true)
    expect(isNonImageFitKind("svg")).toBe(true)
    expect(isNonImageFitKind("model")).toBe(true)
    expect(isNonImageFitKind("document")).toBe(true)
    expect(isNonImageFitKind("unknown")).toBe(true)
  })

  it("uses a deterministic primary render mode by media kind", () => {
    expect(resolveNonImagePrimaryMode("image")).toBe("preview")
    expect(resolveNonImagePrimaryMode("audio")).toBe("preview")
    expect(resolveNonImagePrimaryMode("video")).toBe("preview")
    expect(resolveNonImagePrimaryMode("text")).toBe("text")
    expect(resolveNonImagePrimaryMode("html")).toBe("html")
    expect(resolveNonImagePrimaryMode("svg")).toBe("preview")
    expect(resolveNonImagePrimaryMode("model")).toBe("preview")
    expect(resolveNonImagePrimaryMode("document")).toBe("preview")
    expect(resolveNonImagePrimaryMode("unknown")).toBe("preview_image_candidate")
  })

  it("uses ordinals preview for compact html cards when a preview url exists", () => {
    expect(resolveNonImagePrimaryMode("html", { mode: "compact", hasPreviewUrl: true })).toBe("preview")
    expect(resolveNonImagePrimaryMode("html", { mode: "compact", hasPreviewUrl: false })).toBe("html")
    expect(resolveNonImagePrimaryMode("html", { mode: "default", hasPreviewUrl: true })).toBe("html")
  })

  it("can prefer ordinals preview for html thumbnails even outside compact mode", () => {
    expect(resolveNonImagePrimaryMode("html", {
      mode: "default",
      hasPreviewUrl: true,
      preferPreviewForHtml: true,
    })).toBe("preview")
    expect(resolveNonImagePrimaryMode("html", {
      mode: "default",
      hasPreviewUrl: false,
      preferPreviewForHtml: true,
    })).toBe("html")
  })

  it("injects base href in sandboxed html srcDoc for relative asset resolution", () => {
    const srcDoc = buildSandboxedSrcDoc(
      "<html><head></head><body><img src=\"./asset.png\" /></body></html>",
      "text/html",
      "https://ordinals.com/content/abc123i0"
    )

    expect(srcDoc).toContain("<base href=\"https://ordinals.com/content/\">")
    expect(srcDoc).toContain("<img src=\"./asset.png\"")
  })

  it("wraps svg into html document shell with base href", () => {
    const srcDoc = buildSandboxedSrcDoc(
      "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\"></svg>",
      "image/svg+xml",
      "https://ordinals.com/content/xyz789i0"
    )

    expect(srcDoc).toContain("<base href=\"https://ordinals.com/content/\">")
    expect(srcDoc).toContain("<body class=\"om-svg-root\">")
    expect(srcDoc).toContain("<svg")
  })
})
