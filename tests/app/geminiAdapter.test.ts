import { afterEach, describe, expect, it, vi } from "vitest"
import { GeminiAdapter } from "../../src/app/lib/byok/gemini"
import type { Chronicle } from "../../src/app/lib/types"
import type { ToolExecutor } from "../../src/app/lib/byok/toolExecutor"

const chronicle: Chronicle = {
  inscription_id: "rooti0",
  meta: {
    inscription_id: "rooti0",
    inscription_number: 7,
    sat: 123456,
    sat_rarity: "rare",
    content_type: "image/png",
    content_url: "https://ordinals.com/content/rooti0",
    genesis_block: 840000,
    genesis_timestamp: "2024-04-20T00:00:00.000Z",
    genesis_fee: 1200,
    owner_address: "bc1ptestowner",
    genesis_txid: "root",
    genesis_vout: 0,
  },
  events: [],
  collector_signals: {
    attention_score: 0,
    sentiment_label: "insufficient_data",
    confidence: "low",
    evidence_count: 0,
    provider_breakdown: { google_trends: 0 },
    scope_breakdown: {
      inscription_level: 0,
      collection_level: 0,
      mixed: 0,
      dominant_scope: "none",
    },
    top_evidence: [],
    windows: {
      current_7d: {
        evidence_count: 0,
        provider_count: 0,
        attention_score: 0,
        sentiment_label: "insufficient_data",
      },
      context_30d: {
        evidence_count: 0,
        provider_count: 0,
        attention_score: 0,
        sentiment_label: "insufficient_data",
      },
    },
  },
  media_context: {
    kind: "image",
    content_type: "image/png",
    content_url: "https://ordinals.com/content/rooti0",
    preview_url: "https://ordinals.com/preview/rooti0",
    vision_eligible: true,
    vision_transport: "public_url",
  },
  collection_context: {
    protocol: {
      parents: null,
      children: null,
      gallery: null,
      grandparents: null,
      greatGrandparents: null,
    },
    registry: {
      match: {
        matched_collection: "Runestone",
        match_type: "parent",
        slug: "runestone",
        registry_ids: ["parent1i0"],
        quality_state: "verified",
        issues: [],
        source_ref: "https://example.com/registry",
      },
      issues: [],
    },
    market: {
      match: {
        collection_slug: "runestone",
        collection_name: "Runestone",
        collection_href: "/collection/runestone",
        verified: true,
        source_ref: "https://ord.net/collection/runestone",
      },
    },
    profile: null,
    socials: { official_x_profiles: [] },
    presentation: { primary_label: "Runestone", facets: [] },
  },
  source_catalog: [],
  cached_at: "2026-04-25T00:00:00.000Z",
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("GeminiAdapter", () => {
  it("preserves function call ids and thought signatures in non-stream tool loops", async () => {
    const requests: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn()
      .mockImplementation(async (url: string, init?: RequestInit) => {
        if (!url.includes("generativelanguage.googleapis.com")) {
          return new Response(new Blob(["png-binary"], { type: "image/png" }), { status: 200 })
        }

        requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>)

        if (requests.length === 1) {
          return new Response(JSON.stringify({
            candidates: [{
              content: {
                role: "model",
                parts: [{
                  functionCall: {
                    id: "fc_1",
                    name: "get_collection_context",
                    args: { collection_slug: "runestone" },
                  },
                  thoughtSignature: "sig_1",
                }],
              },
            }],
          }), { status: 200, headers: { "Content-Type": "application/json" } })
        }

        return new Response(JSON.stringify({
          candidates: [{
            content: {
              role: "model",
              parts: [{ text: "<final_answer>There are 112,383 Runestones.</final_answer>" }],
            },
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } })
      })

    vi.stubGlobal("fetch", fetchMock)

    const toolExecutor = {
      getKeys: () => ({}),
      executeTool: vi.fn().mockResolvedValue({
        tool_name: "get_collection_context",
        results: [{ content: "wiki ok: get_collection_context" }],
        summary: "wiki ok: get_collection_context",
        facts: { collection_size: 112383 },
      }),
    } as unknown as ToolExecutor

    const adapter = new GeminiAdapter("AIza-test", "gemini-3.1-pro-preview")
    const result = await adapter.synthesize(chronicle, toolExecutor)

    expect(result.text).toContain("112,383")
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(requests).toHaveLength(2)

    const secondBody = requests[1]
    const secondContents = secondBody.contents as Array<Record<string, unknown>>
    const modelTurn = secondContents[1]
    const userTurn = secondContents[2]
    const modelPart = (modelTurn.parts as Array<Record<string, unknown>>)[0]
    const responsePart = (userTurn.parts as Array<Record<string, unknown>>)[0]

    expect((modelPart.functionCall as Record<string, unknown>).id).toBe("fc_1")
    expect(modelPart.thoughtSignature).toBe("sig_1")
    expect((responsePart.functionResponse as Record<string, unknown>).id).toBe("fc_1")
  })

  it("preserves ids and signatures in streaming chat tool loops", async () => {
    const requests: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn()
      .mockImplementation(async (url: string, init?: RequestInit) => {
        if (!url.includes("generativelanguage.googleapis.com")) {
          return new Response(new Blob(["png-binary"], { type: "image/png" }), { status: 200 })
        }

        requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>)

        if (requests.length === 1) {
          return sseResponse([
            {
              candidates: [{
                content: {
                  role: "model",
                  parts: [{
                    functionCall: {
                      id: "fc_stream_1",
                      name: "get_collection_context",
                      args: { collection_slug: "runestone" },
                    },
                    thoughtSignature: "sig_stream_1",
                  }],
                },
              }],
            },
          ])
        }

        return sseResponse([
          {
            candidates: [{
              content: {
                role: "model",
                parts: [{ text: "<final_answer>Existem 112,383 Runestones.</final_answer>" }],
              },
            }],
          },
        ])
      })

    vi.stubGlobal("fetch", fetchMock)

    const toolExecutor = {
      getKeys: () => ({}),
      executeTool: vi.fn().mockResolvedValue({
        tool_name: "get_collection_context",
        results: [{ content: "wiki ok: get_collection_context" }],
        summary: "wiki ok: get_collection_context",
        facts: { collection_size: 112383 },
      }),
    } as unknown as ToolExecutor

    const adapter = new GeminiAdapter("AIza-test", "gemini-3.1-pro-preview")
    const result = await adapter.chatStream({
      chronicle,
      history: [],
      userMessage: "Quantas Runestone existem?",
      mode: "qa",
      intent: "chronicle_query",
      toolPolicyDecision: {
        policy: "narrow_factual",
        allowedToolNames: ["get_collection_context"],
        geminiMode: "ANY",
        reason: "qa_narrow_factual",
      },
      onChunk: () => undefined,
      toolExecutor,
    })

    expect(result.text).toContain("112,383")
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(requests).toHaveLength(2)
    expect((requests[0].tool_config as Record<string, unknown>).function_calling_config).toEqual({
      mode: "ANY",
      allowed_function_names: ["get_collection_context"],
    })

    const secondBody = requests[1]
    const secondContents = secondBody.contents as Array<Record<string, unknown>>
    const modelTurn = secondContents[1]
    const userTurn = secondContents[2]
    const modelPart = (modelTurn.parts as Array<Record<string, unknown>>)[0]
    const responsePart = (userTurn.parts as Array<Record<string, unknown>>)[0]

    expect((modelPart.functionCall as Record<string, unknown>).id).toBe("fc_stream_1")
    expect(modelPart.thoughtSignature).toBe("sig_stream_1")
    expect((responsePart.functionResponse as Record<string, unknown>).id).toBe("fc_stream_1")
  })
})

function sseResponse(events: unknown[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      controller.close()
    },
  })

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}
