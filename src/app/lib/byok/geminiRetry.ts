const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504])
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_BASE_DELAY_MS = 1000
const DEFAULT_MAX_DELAY_MS = 8000

export async function fetchGeminiWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  options?: {
    maxRetries?: number
    baseDelayMs?: number
    maxDelayMs?: number
    requestLabel?: string
  }
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const label = options?.requestLabel ?? "gemini_request"
  const signal = init.signal ?? undefined

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(input, init)
      if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt >= maxRetries) {
        return response
      }

      const bodyText = await response.text().catch(() => "")
      const delayMs = computeRetryDelayMs({
        attempt,
        baseDelayMs,
        maxDelayMs,
        serverDelayMs: parseRetryDelayMs(response.headers, bodyText),
      })

      logRetry({
        label,
        attempt,
        maxRetries,
        reason: `http_${response.status}`,
        delayMs,
      })

      await delay(delayMs, signal)
    } catch (error) {
      if (isAbortError(error) || !isRetryableNetworkError(error) || attempt >= maxRetries) {
        throw error
      }

      const delayMs = computeRetryDelayMs({
        attempt,
        baseDelayMs,
        maxDelayMs,
      })

      logRetry({
        label,
        attempt,
        maxRetries,
        reason: "network_error",
        delayMs,
      })

      await delay(delayMs, signal)
    }
  }
}

function computeRetryDelayMs(params: {
  attempt: number
  baseDelayMs: number
  maxDelayMs: number
  serverDelayMs?: number | null
}): number {
  const exponential = Math.min(params.baseDelayMs * (2 ** params.attempt), params.maxDelayMs)
  const jitter = Math.floor(Math.random() * params.baseDelayMs)
  const hintedDelay = params.serverDelayMs ?? 0
  return Math.min(Math.max(exponential + jitter, hintedDelay), params.maxDelayMs)
}

function parseRetryDelayMs(headers: Headers, bodyText: string): number | null {
  const headerDelay = parseRetryAfterHeader(headers.get("retry-after"))
  const bodyDelay = parseRetryDelayFromBody(bodyText)
  return bodyDelay ?? headerDelay
}

function parseRetryAfterHeader(value: string | null): number | null {
  if (!value) return null

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000)
  }

  const when = Date.parse(value)
  if (!Number.isFinite(when)) return null

  return Math.max(0, when - Date.now())
}

function parseRetryDelayFromBody(bodyText: string): number | null {
  if (!bodyText) return null

  try {
    const json = JSON.parse(bodyText) as {
      error?: {
        details?: Array<{ retryDelay?: unknown }>
      }
    }
    const details = Array.isArray(json.error?.details) ? json.error.details : []
    for (const detail of details) {
      const parsed = parseDurationMs(detail?.retryDelay)
      if (parsed !== null) return parsed
    }
  } catch {
    return null
  }

  return null
}

function parseDurationMs(value: unknown): number | null {
  if (typeof value !== "string") return null
  const match = value.trim().match(/^(\d+(?:\.\d+)?)s$/i)
  if (!match) return null

  const seconds = Number(match[1])
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return Math.round(seconds * 1000)
}

function isRetryableNetworkError(error: unknown): boolean {
  return error instanceof TypeError
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  return "name" in error && (error as { name?: unknown }).name === "AbortError"
}

function logRetry(params: {
  label: string
  attempt: number
  maxRetries: number
  reason: string
  delayMs: number
}): void {
  if (typeof console === "undefined") return
  console.warn("[GeminiRetry]", {
    request: params.label,
    attempt: params.attempt + 1,
    max_retries: params.maxRetries,
    reason: params.reason,
    delay_ms: params.delayMs,
  })
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  if (signal?.aborted) return Promise.reject(createAbortError())

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const onAbort = () => {
      if (timer !== null) {
        globalThis.clearTimeout(timer)
      }
      cleanup()
      reject(createAbortError())
    }

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort)
    }

    timer = globalThis.setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function createAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted.", "AbortError")
  }
  const error = new Error("The operation was aborted.")
  error.name = "AbortError"
  return error
}
