import { describe, it, expect } from "vitest"
import { detectProvider, createAdapter } from "../../src/app/lib/byok/index"

describe("BYOK configuration", () => {
  describe("detectProvider", () => {
    it("should detect Anthropic keys", () => {
      expect(detectProvider("sk-ant-api03-xxxxxxxxxxxx")).toBe("anthropic")
    })

    it("should detect OpenAI keys", () => {
      expect(detectProvider("sk-proj-xxxxxxxxxxxx")).toBe("openai")
      expect(detectProvider("sk-xxxxxxxxxxxxxxxxxxxx")).toBe("openai")
    })

    it("should detect Gemini keys", () => {
      expect(detectProvider("AIzaSyxxxxxxxxxxxxxxxxxxxxxxx")).toBe("gemini")
    })

    it("should detect OpenRouter keys", () => {
      expect(detectProvider("sk-or-v1-xxxxxxxxxxxx")).toBe("openrouter")
    })

    it("should return unknown for invalid keys", () => {
      expect(detectProvider("")).toBe("unknown")
      expect(detectProvider("some-random-key")).toBe("unknown")
      expect(detectProvider("bearer-xxxx")).toBe("unknown")
    })

    it("should not confuse Anthropic with OpenAI", () => {
      // Anthropic keys start with sk-ant- which also starts with sk-
      // Anthropic check must come first
      expect(detectProvider("sk-ant-api03-test")).toBe("anthropic")
      expect(detectProvider("sk-proj-test")).toBe("openai")
    })
  })

  describe("createAdapter", () => {
    it("should create correct adapters with dynamic models", () => {
      const a1 = createAdapter({ provider: "anthropic", model: "claude-3-7", key: "sk-ant-123" })
      expect(a1?.provider).toBe("anthropic")
      expect(a1?.model).toBe("claude-3-7")

      const a2 = createAdapter({ provider: "openai", model: "gpt-5.4", key: "sk-123" })
      expect(a2?.provider).toBe("openai")
      expect(a2?.model).toBe("gpt-5.4")

      const a3 = createAdapter({ provider: "gemini", model: "gemini-3.1-pro", key: "AIza123" })
      expect(a3?.provider).toBe("gemini")
      expect(a3?.model).toBe("gemini-3.1-pro")

      const a4 = createAdapter({ provider: "openrouter", model: "deepseek/deepseek-r1", key: "sk-or-123" })
      expect(a4?.provider).toBe("openrouter")
      expect(a4?.model).toBe("deepseek/deepseek-r1")
    })

    it("should return null for invalid configurations", () => {
      expect(createAdapter({ provider: "unknown", model: "", key: "" })).toBeNull()
      expect(createAdapter({ provider: "openai", model: "gpt-4", key: "" })).toBeNull()
    })
  })
})
