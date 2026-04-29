import { afterEach, describe, expect, it, vi } from "vitest"
import cbor from "cbor"
import { fetchOrdinals } from "../../src/worker/agents/ordinals"

function metadataResponse(body: unknown, contentType = "application/json"): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": contentType },
  })
}

describe("ordinals metadata parser", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("parses traits from CBOR hex attributes array", async () => {
    const hex = cbor.encode({
      attributes: [
        { trait_type: "Background", value: "Dark Grey" },
        { trait_type: "Face", value: "Peppy" },
      ],
    }).toString("hex")

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(metadataResponse(hex)))

    await expect(fetchOrdinals.metadata("test-id")).resolves.toEqual({
      Background: "Dark Grey",
      Face: "Peppy",
    })
  })

  it("parses traits from CBOR hex properties map", async () => {
    const hex = cbor.encode({
      name: "Example",
      properties: {
        Background: "Blue",
        Hat: "Wizard",
      },
    }).toString("hex")

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(metadataResponse(hex)))

    await expect(fetchOrdinals.metadata("test-id")).resolves.toEqual({
      Background: "Blue",
      Hat: "Wizard",
    })
  })

  it("supports direct JSON metadata payloads without CBOR hex", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      metadataResponse({
        traits: [
          { trait_type: "Background", value: "Dark Grey" },
          { trait_type: "Item", value: "Keyboard" },
        ],
      })
    ))

    await expect(fetchOrdinals.metadata("test-id")).resolves.toEqual({
      Background: "Dark Grey",
      Item: "Keyboard",
    })
  })

  it("parses native CBOR bytes without requiring a JSON hex wrapper", async () => {
    const bytes = cbor.encode({
      attributes: [
        { trait_type: "Body", value: "Purple Haze" },
        { trait_type: "Eyes", value: "Nebula Gaze" },
      ],
    })

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "application/cbor" },
      })
    ))

    await expect(fetchOrdinals.metadata("test-id")).resolves.toEqual({
      Body: "Purple Haze",
      Eyes: "Nebula Gaze",
    })
  })

  it("parses traits from nested metadata envelopes", async () => {
    const hex = cbor.encode({
      metadata: {
        attributes: [
          { trait_type: "Quantum State", value: "Dead" },
          { trait_type: "Background", value: "Concatenation" },
        ],
      },
    }).toString("hex")

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(metadataResponse({ data: hex })))

    await expect(fetchOrdinals.metadata("test-id")).resolves.toEqual({
      "Quantum State": "Dead",
      Background: "Concatenation",
    })
  })
})

describe("ordinals inscription content type", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("uses the reported inscription content type when available", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      id: "abc123i0",
      number: 1,
      content_type: "IMAGE/PNG; charset=binary",
      height: 800000,
      fee: 1000,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))

    vi.stubGlobal("fetch", fetchMock)

    const meta = await fetchOrdinals.inscription("abc123i0")

    expect(meta.content_type).toBe("image/png")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("falls back to the content endpoint header when inscription metadata omits content type", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "svg123i0",
        number: 2,
        height: 800001,
        fee: 1000,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
      }))

    vi.stubGlobal("fetch", fetchMock)

    const meta = await fetchOrdinals.inscription("svg123i0")

    expect(meta.content_type).toBe("image/svg+xml")
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://ordinals.com/content/svg123i0", {
      method: "HEAD",
    })
  })

  it("uses a ranged content request when HEAD does not expose the content type", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "html123i0",
        number: 3,
        content_type: "Not available",
        height: 800002,
        fee: 1000,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response("<html></html>", {
        status: 206,
        headers: { "Content-Type": "text/html;charset=utf-8" },
      }))

    vi.stubGlobal("fetch", fetchMock)

    const meta = await fetchOrdinals.inscription("html123i0")

    expect(meta.content_type).toBe("text/html")
    expect(fetchMock).toHaveBeenNthCalledWith(3, "https://ordinals.com/content/html123i0", {
      method: "GET",
      headers: { Range: "bytes=0-0" },
    })
  })
})
