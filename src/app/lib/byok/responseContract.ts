export interface ChatAnswerEnvelope {
  answer: string
  evidence?: string
  uncertainty?: string
  used_tools: string[]
}

export function formatChatAnswerEnvelope(envelope: ChatAnswerEnvelope): string {
  return [envelope.answer, envelope.evidence, envelope.uncertainty]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ")
    .trim()
}

export function toChatAnswerEnvelope(params: {
  text: string
  usedTools?: string[]
}): ChatAnswerEnvelope {
  const usedTools = params.usedTools ?? []
  const parsed = parseAnswerEnvelope(params.text, usedTools)
  if (parsed) return parsed

  return {
    answer: params.text.trim(),
    used_tools: usedTools,
  }
}

function parseAnswerEnvelope(text: string, usedTools: string[]): ChatAnswerEnvelope | null {
  const candidate = extractJsonObject(text)
  if (!candidate) return null

  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>
    const answer = readString(parsed.answer)
    if (!answer) return null

    const usedToolsFromPayload = Array.isArray(parsed.used_tools)
      ? parsed.used_tools.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : usedTools

    return {
      answer,
      evidence: readString(parsed.evidence),
      uncertainty: readString(parsed.uncertainty),
      used_tools: usedToolsFromPayload,
    }
  } catch {
    return null
  }
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function extractJsonObject(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith("{")) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === "\\") {
      escaped = true
      continue
    }

    if (char === "\"") {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === "{") depth += 1
    if (char === "}") {
      depth -= 1
      if (depth === 0) {
        return trimmed.slice(0, index + 1)
      }
    }
  }

  return null
}
