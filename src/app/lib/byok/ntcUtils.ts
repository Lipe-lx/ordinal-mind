/**
 * Sanitizes JSON Schema for Gemini FunctionDeclaration.
 * Gemini is strict and rejects:
 * - anyOf / oneOf / allOf
 * - $ref / $defs
 * - additionalProperties (at top level)
 */
export function sanitizeGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return schema

  // If it's an array of schemas (from anyOf/oneOf), take the first one that isn't null
  const anyOf = schema.anyOf as Record<string, unknown>[] | undefined
  const oneOf = schema.oneOf as Record<string, unknown>[] | undefined
  
  if (Array.isArray(anyOf) || Array.isArray(oneOf)) {
    const list = anyOf || oneOf || []
    const candidates = list.filter((s) => s.type !== "null")
    if (candidates.length > 0) {
      const base = { ...schema }
      delete base.anyOf
      delete base.oneOf
      return sanitizeGeminiSchema({ ...base, ...candidates[0] })
    }
    return { type: "string" }
  }

  const cleaned: Record<string, unknown> = {}
  const allowedKeys = [
    "type", "description", "properties", "required", "items",
    "enum", "format", "nullable", "minimum", "maximum",
    "minItems", "maxItems", "default", "example"
  ]

  for (const key of allowedKeys) {
    if (key in schema) {
      const value = schema[key]
      if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
        const cleanedProps: Record<string, unknown> = {}
        for (const [propName, propSchema] of Object.entries(value)) {
          cleanedProps[propName] = sanitizeGeminiSchema(propSchema as Record<string, unknown>)
        }
        cleaned.properties = cleanedProps
      } else if (key === "items" && value && typeof value === "object" && !Array.isArray(value)) {
        cleaned.items = sanitizeGeminiSchema(value as Record<string, unknown>)
      } else {
        cleaned[key] = value
      }
    }
  }

  // Ensure type is present
  if (!cleaned.type) {
    if (cleaned.properties) {
      cleaned.type = "object"
    } else {
      cleaned.type = "string"
    }
  }

  return cleaned
}

export interface GeminiFunctionCall {
  id?: string
  name: string
  args: Record<string, unknown>
}

export interface GeminiFunctionResponse {
  id?: string
  name: string
  response: unknown
}

export interface GeminiPart {
  text?: string
  inline_data?: { mime_type: string; data: string }
  file_data?: { mime_type: string; file_uri: string }
  functionCall?: GeminiFunctionCall
  functionResponse?: GeminiFunctionResponse
  thoughtSignature?: string
}

export interface GeminiContent {
  role: string
  parts: GeminiPart[]
}

/**
 * Defensively sanitize turn ordering for Gemini function-calling rules.
 * Gemini requires:
 * 1. History cannot start with a model turn if a user turn exists later.
 * 2. A function_call (model turn) MUST follow a user turn OR a function_response turn.
 * 3. Adjacent messages with the same role should be merged or handled.
 */
export function sanitizeGeminiTurnOrder(contents: GeminiContent[]): GeminiContent[] {
  if (contents.length === 0) return contents

  let sanitized = [...contents]

  // 1. If history starts in `model` and we still have a user turn later, drop leading model turns
  if (sanitized[0].role === "model" || sanitized[0].role === "assistant") {
    const firstUserIdx = sanitized.findIndex(c => c.role === "user")
    if (firstUserIdx > 0) {
      sanitized = sanitized.slice(firstUserIdx)
    }
  }

  if (sanitized.length === 0) return sanitized

  const result: GeminiContent[] = []
  let prevRole: string | null = null

  for (const item of sanitized) {
    const role = item.role === "assistant" ? "model" : item.role
    
    // Merge adjacent turns with the same role (except function responses which often come in separate content blocks)
    if (role === prevRole && role !== "user") {
        const lastTurn = result[result.length - 1]
        lastTurn.parts = [...lastTurn.parts, ...item.parts]
        continue
    }

    result.push({ ...item, role })
    prevRole = role
  }

  return result
}

/**
 * Extracts content between specific XML-like tags.
 */
export function extractContentBetweenTags(text: string, tag: string): string | null {
  const startTag = `<${tag}>`
  const endTag = `</${tag}>`
  const startIdx = text.indexOf(startTag)
  if (startIdx === -1) return null

  const endIdx = text.indexOf(endTag, startIdx + startTag.length)
  if (endIdx === -1) {
    // If tag is not closed yet (streaming), return everything after start tag
    return text.slice(startIdx + startTag.length)
  }

  return text.slice(startIdx + startTag.length, endIdx)
}

/**
 * Heuristic cleanup for non-compliant model outputs.
 * Detects and strips common internal reasoning patterns, prompt echoes,
 * and scratchpad artifacts (e.g., "User question:", "Target:", etc.).
 */
export function heuristicCleanup(text: string): string {
  // If the text contains <final_answer>, use the specific extraction
  const finalAnswer = extractContentBetweenTags(text, "final_answer")
  if (finalAnswer !== null) return finalAnswer.trim()

  let cleaned = text

  // 1. Strip common "Thinking" prefixes and structured analysis artifacts
  const patternsToStrip = [
    /^User question:.*$/im,
    /^Target:.*$/im,
    /^Language:.*$/im,
    /^Collection Name:.*$/im,
    /^Supply:.*$/im,
    /^Specific Inscription:.*$/im,
    /^Analysis:.*$/im,
    /^Chronicle for.*$/im,
    /^\* Target:.*$/im,
    /^\* User question:.*$/im,
  ]

  for (const pattern of patternsToStrip) {
    cleaned = cleaned.replace(pattern, "")
  }

  // 2. Remove common preamble "Yes, I can do that", "Here is the chronicle", etc.
  cleaned = cleaned.replace(/^(Certainly|Of course|Here is|Sure|I can help with that)[^.!?]*[.!?]\s*/i, "")

  // 3. If there are still tags like <thought> or <final_answer> left, strip them
  cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, "")
  cleaned = cleaned.replace(/<thought>[\s\S]*$/gi, "")
  cleaned = cleaned.replace(/<final_answer>/gi, "")
  cleaned = cleaned.replace(/<\/final_answer>/gi, "")

  return cleaned.trim()
}

/**
 * Cleans response text by removing internal tags and common artifacts.
 */
export function cleanResponseText(text: string): string {
  // Try heuristic cleanup first to catch leaks
  return heuristicCleanup(text)
}
