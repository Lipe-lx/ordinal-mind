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
