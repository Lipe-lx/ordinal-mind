import { beforeEach, describe, expect, it, vi } from "vitest"
import { runWikiSeedAgent } from "../../src/app/lib/byok/wikiSeedAgent"
import { runByokPrompt, parseFirstJsonObject } from "../../src/app/lib/byok/wikiAdapter"
import { submitWikiContribution } from "../../src/app/lib/byok/wikiSubmit"

vi.mock("../../src/app/lib/byok/wikiAdapter", () => ({
  runByokPrompt: vi.fn(),
  parseFirstJsonObject: vi.fn(),
}))

vi.mock("../../src/app/lib/byok/wikiSubmit", () => ({
  submitWikiContribution: vi.fn(),
}))

function buildChronicle() {
  return {
    meta: {
      inscription_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0",
      inscription_number: 123,
    },
    collection_context: {
      market: {
        match: {
          collection_slug: "collection:test-seed",
          collection_name: "Test Seed",
        },
      },
      registry: { match: null },
      profile: null,
      presentation: {
        primary_label: "Test Seed",
      },
    },
  } as any
}

function mockConsolidatedResponse(canonicalValue: string | null) {
  vi.stubGlobal("fetch", vi.fn(async () => {
    const payload = canonicalValue
      ? {
          ok: true,
          data: {
            narrative: {
              founder: {
                canonical_value: canonicalValue,
              },
            },
          },
        }
      : {
          ok: true,
          data: {
            narrative: {},
          },
        }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }))
}

describe("wikiSeedAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("skips submission when canonical value already matches", async () => {
    mockConsolidatedResponse("Casey Rodarmor")
    vi.mocked(runByokPrompt).mockResolvedValue("[{}]")
    vi.mocked(parseFirstJsonObject).mockReturnValue([
      {
        field: "founder",
        value: "Casey Rodarmor",
        verifiable: true,
        scope: "collection",
      },
    ])
    vi.mocked(submitWikiContribution).mockResolvedValue({ ok: true, status: "published" })

    await runWikiSeedAgent({
      narrative: "Founder is Casey Rodarmor.",
      chronicle: buildChronicle(),
      config: { provider: "openai", model: "gpt-4.1", key: "sk-test" } as any,
      sessionId: "thread_1",
    })

    expect(submitWikiContribution).not.toHaveBeenCalled()
  })

  it("submits seed contribution with origin when canonical differs", async () => {
    mockConsolidatedResponse("Old Founder")
    vi.mocked(runByokPrompt).mockResolvedValue("[{}]")
    vi.mocked(parseFirstJsonObject).mockReturnValue([
      {
        field: "founder",
        value: "New Founder",
        verifiable: true,
        scope: "collection",
      },
    ])
    vi.mocked(submitWikiContribution).mockResolvedValue({ ok: true, status: "published" })

    await runWikiSeedAgent({
      narrative: "Founder updated: New Founder.",
      chronicle: buildChronicle(),
      config: { provider: "openai", model: "gpt-4.1", key: "sk-test" } as any,
      sessionId: "thread_1",
    })

    expect(submitWikiContribution).toHaveBeenCalledTimes(1)
    expect(vi.mocked(submitWikiContribution).mock.calls[0]?.[0]?.data?.origin).toBe("narrative_seed_agent")
  })

  it("submits both collection and inscription fields when both are present", async () => {
    mockConsolidatedResponse(null)
    vi.mocked(runByokPrompt).mockResolvedValue("[{}]")
    vi.mocked(parseFirstJsonObject).mockReturnValue([
      {
        field: "founder",
        value: "Collection Founder",
        verifiable: true,
        scope: "collection",
      },
      {
        field: "inscriber",
        value: "Inscription Author",
        verifiable: true,
        scope: "inscription",
      },
    ])
    vi.mocked(submitWikiContribution).mockResolvedValue({ ok: true, status: "published" })

    await runWikiSeedAgent({
      narrative: "Collection founder is Collection Founder. This inscription was inscribed by Inscription Author.",
      chronicle: buildChronicle(),
      config: { provider: "openai", model: "gpt-4.1", key: "sk-test" } as any,
      sessionId: "thread_1",
    })

    expect(submitWikiContribution).toHaveBeenCalledTimes(2)
    const slugs = vi.mocked(submitWikiContribution).mock.calls.map((call) => call?.[0]?.data?.collection_slug)
    expect(slugs).toContain("collection:test-seed")
    expect(slugs).toContain("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0")
  })

  it("keeps only one deterministic write per field+scope", async () => {
    mockConsolidatedResponse(null)
    vi.mocked(runByokPrompt).mockResolvedValue("[{}]")
    vi.mocked(parseFirstJsonObject).mockReturnValue([
      {
        field: "founder",
        value: "A",
        verifiable: false,
        scope: "collection",
      },
      {
        field: "founder",
        value: "Founder Alpha",
        verifiable: true,
        scope: "collection",
      },
    ])
    vi.mocked(submitWikiContribution).mockResolvedValue({ ok: true, status: "published" })

    await runWikiSeedAgent({
      narrative: "Founder Alpha.",
      chronicle: buildChronicle(),
      config: { provider: "openai", model: "gpt-4.1", key: "sk-test" } as any,
      sessionId: "thread_1",
    })

    expect(submitWikiContribution).toHaveBeenCalledTimes(1)
    const sentValue = vi.mocked(submitWikiContribution).mock.calls[0]?.[0]?.data?.value
    expect(sentValue).toBe("Founder Alpha")
  })

  it("parses JSON arrays wrapped in markdown fences", async () => {
    mockConsolidatedResponse(null)
    vi.mocked(runByokPrompt).mockResolvedValue(
      "```json\n[{\"field\":\"founder\",\"value\":\"Casey Rodarmor\",\"verifiable\":true,\"scope\":\"collection\"}]\n```"
    )
    vi.mocked(parseFirstJsonObject).mockReturnValue(null)
    vi.mocked(submitWikiContribution).mockResolvedValue({ ok: true, status: "published" })

    await runWikiSeedAgent({
      narrative: "Founder is Casey Rodarmor.",
      chronicle: buildChronicle(),
      config: { provider: "openai", model: "gpt-4.1", key: "sk-test" } as any,
      sessionId: "thread_1",
    })

    expect(submitWikiContribution).toHaveBeenCalledTimes(1)
    expect(vi.mocked(submitWikiContribution).mock.calls[0]?.[0]?.data?.field).toBe("founder")
  })
})
