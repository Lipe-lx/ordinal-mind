import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchGeminiWithRetry } from "../../src/app/lib/byok/geminiRetry"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("fetchGeminiWithRetry", () => {
  it("retries transient 503 responses with exponential backoff", async () => {
    const delays: number[] = []
    vi.spyOn(Math, "random").mockReturnValue(0)
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: TimerHandler, timeout?: number) => {
      delays.push(Number(timeout ?? 0))
      if (typeof handler === "function") handler()
      return 0 as ReturnType<typeof setTimeout>
    }) as typeof setTimeout)
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: 503, status: "UNAVAILABLE", message: "The model is overloaded. Please try again later." },
      }), { status: 503, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: 503, status: "UNAVAILABLE", message: "The model is overloaded. Please try again later." },
      }), { status: 503, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))

    vi.stubGlobal("fetch", fetchMock)

    const response = await fetchGeminiWithRetry("https://example.com/gemini", {
      method: "POST",
      body: JSON.stringify({ prompt: "hi" }),
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(delays).toEqual([1000, 2000])
  })

  it("uses Gemini retryDelay hints when provided", async () => {
    const delays: number[] = []
    vi.spyOn(Math, "random").mockReturnValue(0)
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: TimerHandler, timeout?: number) => {
      delays.push(Number(timeout ?? 0))
      if (typeof handler === "function") handler()
      return 0 as ReturnType<typeof setTimeout>
    }) as typeof setTimeout)
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "Please retry later.",
          details: [{ retryDelay: "3.5s" }],
        },
      }), { status: 429, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))

    vi.stubGlobal("fetch", fetchMock)

    const response = await fetchGeminiWithRetry("https://example.com/gemini", {
      method: "POST",
      body: JSON.stringify({ prompt: "hi" }),
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(delays).toEqual([3500])
  })
})
