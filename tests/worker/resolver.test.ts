import { describe, it, expect, vi } from "vitest"

// We test the regex logic and resolveInput directly.
// The actual Xverse fetch is mocked for the number→ID resolution.

// Import the regex patterns by testing resolveInput behavior
// We can't import the private regexes, so we test through the public API.

// Since resolveInput calls fetch() for number resolution, we need to mock it.
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

// Dynamic import after mocking fetch
const { resolveInput } = await import("../../src/worker/resolver")

describe("resolveInput", () => {
  describe("taproot address detection", () => {
    it("should detect a valid taproot address", async () => {
      const addr = "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297"
      const result = await resolveInput(addr)
      expect(result.type).toBe("address")
      expect(result.value).toBe(addr.toLowerCase())
    })

    it("should be case-insensitive for taproot addresses", async () => {
      const addr = "BC1P5D7RJQ7G6RDK2YHZKS9SMLAQTEDR4DEKQ08GE8ZTWAC72SFR9RUSXG3297"
      const result = await resolveInput(addr)
      expect(result.type).toBe("address")
      expect(result.value).toBe(addr.toLowerCase())
    })
  })

  describe("hex inscription ID detection", () => {
    it("should detect a valid hex inscription ID", async () => {
      const hexId = "6fb976ab49dcec017f1e201e84395983204ae1a7c2abf7ced0a85d692e442799i0"
      const result = await resolveInput(hexId)
      expect(result.type).toBe("inscription")
      expect(result.value).toBe(hexId.toLowerCase())
    })

    it("should handle uppercase hex IDs", async () => {
      const hexId = "6FB976AB49DCEC017F1E201E84395983204AE1A7C2ABF7CED0A85D692E442799i0"
      const result = await resolveInput(hexId)
      expect(result.type).toBe("inscription")
      expect(result.value).toBe(hexId.toLowerCase())
    })
  })

  describe("inscription number detection", () => {
    it("should resolve a number to hex ID via ordinals.com scraping", async () => {
      const mockId = "abc123def456abc123def456abc123def456abc123def456abc123def456abc1i0"
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => `<html><title>Inscription 69420</title><body><a href="/inscription/${mockId}">link</a></body></html>`,
      })

      const result = await resolveInput("69420")
      expect(result.type).toBe("inscription")
      expect(result.value).toBe(mockId)
      expect(mockFetch).toHaveBeenCalledWith(
        "https://ordinals.com/inscription/69420"
      )
    })

    it("should resolve a negative inscription number to hex ID via ordinals.com scraping", async () => {
      const mockId = "def456abc123def456abc123def456abc123def456abc123def456abc123def4i0"
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => `<html><title>Inscription -435195</title><body><a href="/inscription/${mockId}">link</a></body></html>`,
      })

      const result = await resolveInput("-435195")
      expect(result.type).toBe("inscription")
      expect(result.value).toBe(mockId)
      expect(mockFetch).toHaveBeenCalledWith(
        "https://ordinals.com/inscription/-435195"
      )
    })

    it("should throw for number that doesn't resolve", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

      await expect(resolveInput("999999999")).rejects.toThrow("not found")
    })
  })

  describe("invalid input", () => {
    it("should throw for random text", async () => {
      await expect(resolveInput("hello world")).rejects.toThrow("invalid input")
    })

    it("should throw for empty string", async () => {
      await expect(resolveInput("")).rejects.toThrow("invalid input")
    })

    it("should throw for partial hex ID", async () => {
      await expect(resolveInput("abc123")).rejects.toThrow()
    })
  })

  describe("whitespace handling", () => {
    it("should trim input", async () => {
      const addr = "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297"
      const result = await resolveInput(`  ${addr}  `)
      expect(result.type).toBe("address")
      expect(result.value).toBe(addr)
    })
  })
})
