/**
 * Reusable SSE stream consumer for BYOK adapters.
 *
 * Handles: ReadableStream → TextDecoder → SSE line parsing → callbacks.
 *
 * Key robustness features (learned from production):
 * - CRLF normalization: some providers (Gemini) use \r\n line endings
 * - Multi-line data: joins multiple `data:` lines per SSE spec
 * - Comment lines: silently skips `: ...` keepalive comments
 * - Terminal markers: skips `[DONE]` (OpenAI/OpenRouter convention)
 * - Remaining buffer: processes any data left after stream ends
 */

/**
 * Consume a fetch Response body as an SSE stream.
 *
 * @param response - Fetch Response with body stream
 * @param onData   - Called with raw data string for each SSE event
 * @param signal   - Optional AbortSignal for cancellation
 */
export async function consumeSSE(
  response: Response,
  onData: (data: string) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!response.body) {
    throw new Error("Response body is null — streaming not supported")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel()
        break
      }

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Normalize CRLF → LF (Gemini API uses \r\n, others use \n)
      buffer = buffer.replace(/\r\n/g, "\n")

      // SSE events are separated by double newlines
      const parts = buffer.split("\n\n")
      buffer = parts.pop() || "" // keep incomplete part in buffer

      for (const part of parts) {
        if (!part.trim()) continue
        processSSEEvent(part, onData)
      }
    }

    // Process any remaining buffer after stream ends
    if (buffer.trim()) {
      processSSEEvent(buffer.replace(/\r\n/g, "\n"), onData)
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Process a single SSE event block (may contain multiple lines).
 *
 * Per SSE spec, a single event can have multiple `data:` lines that must
 * be joined with '\n'. This ensures multi-line payloads are handled correctly.
 */
function processSSEEvent(eventBlock: string, onData: (data: string) => void): void {
  const dataLines: string[] = []

  for (const line of eventBlock.split("\n")) {
    // Skip comment lines (used by OpenRouter for keepalive)
    if (line.startsWith(":")) continue

    // Skip event type lines (we process data-only for BYOK adapters)
    if (line.startsWith("event:")) continue

    // Collect data lines (SSE spec: multi-line data)
    if (line.startsWith("data: ")) {
      dataLines.push(line.slice(6))
    } else if (line === "data:") {
      dataLines.push("")
    }
  }

  if (dataLines.length === 0) return

  const data = dataLines.join("\n").trim()

  // Skip terminal marker (OpenAI/OpenRouter convention)
  if (data === "[DONE]") return

  onData(data)
}
