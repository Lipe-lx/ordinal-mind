import { describe, expect, it } from "vitest"
import { detectUserLocale } from "../../src/app/lib/byok/language"

describe("detectUserLocale", () => {
  it("defaults to en-US for ambiguous English-like input", () => {
    expect(detectUserLocale("Who owns this inscription now?")).toBe("en-US")
    expect(detectUserLocale("owner current status")).toBe("en-US")
  })

  it("detects Portuguese prompts", () => {
    expect(detectUserLocale("Quem é o dono atual dessa inscrição?")).toBe("pt-BR")
  })

  it("detects Spanish prompts", () => {
    expect(detectUserLocale("¿Quién es el owner actual de esta inscripción?")).toBe("es-ES")
  })

  it("detects French prompts", () => {
    expect(detectUserLocale("Qui est le propriétaire actuel de cette inscription ?")).toBe("fr-FR")
  })
})
