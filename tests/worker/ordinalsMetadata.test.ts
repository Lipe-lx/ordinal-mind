import { afterEach, describe, expect, it, vi } from "vitest"
import cbor from "cbor"
import { fetchOrdinals } from "../../src/worker/agents/ordinals"

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

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => hex,
    } satisfies Partial<Response>))

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

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => hex,
    } satisfies Partial<Response>))

    await expect(fetchOrdinals.metadata("test-id")).resolves.toEqual({
      Background: "Blue",
      Hat: "Wizard",
    })
  })

  it("supports direct JSON metadata payloads without CBOR hex", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        traits: [
          { trait_type: "Background", value: "Dark Grey" },
          { trait_type: "Item", value: "Keyboard" },
        ],
      }),
    } satisfies Partial<Response>))

    await expect(fetchOrdinals.metadata("test-id")).resolves.toEqual({
      Background: "Dark Grey",
      Item: "Keyboard",
    })
  })
})
