/**
 * Multi-layer narrative sanitizer for Chronicle synthesis output.
 *
 * Reasoning models (Gemini thinking, DeepSeek R1, o3, Claude extended thinking)
 * may leak chain-of-thought as plain text — not just XML tags. This sanitizer
 * strips all known patterns so only the final narrative reaches the UI.
 */

// --- Pattern definitions ---

/** XML-style thinking tags (pairs) */
const XML_TAG_PATTERNS = [
  /<think>[\s\S]*?<\/think>/gi,
  /<thought>[\s\S]*?<\/thought>/gi,
  /<system>[\s\S]*?<\/system>/gi,
  /<instructions>[\s\S]*?<\/instructions>/gi,
  /<scratchpad>[\s\S]*?<\/scratchpad>/gi,
  /<reasoning>[\s\S]*?<\/reasoning>/gi,
  /<reflection>[\s\S]*?<\/reflection>/gi,
  /<internal>[\s\S]*?<\/internal>/gi,
  /<antThinking>[\s\S]*?<\/antThinking>/gi,
]

/** Lines that are prompt echoes — the model is repeating our instructions */
const PROMPT_ECHO_PATTERNS = [
  /^Role:\s/i,
  /^Task:\s/i,
  /^User Question:\s/i,
  /^Latest user message:\s/i,
  /^Target Entity:\s/i,
  /^Constraint\s?\d+:/i,
  /^CRITICAL INSTRUCTION:/i,
  /^INSCRIPTION DATA:/i,
  /^EVENT TIMELINE:/i,
  /^Response policy:/i,
  /^Conversation so far:/i,
  /^Source Data Check:/i,
  /^\*+\s*Source Data Check:/i,
  /^Write the Chronicle now/i,
  /^Output ONLY the final/i,
  /^You are a factual chronicler/i,
  /^Write in the same language/i,
  /^Tone:\s*(objective|factual)/i,
  /^Language:\s/i,
  /^Length:\s/i,
  /^Maximum \d+ (short )?paragraphs/i,
  /^If something is not in the data/i,
  /^Every fact must be backed/i,
  /^Do NOT include any internal/i,
  /^Return ONLY the \d+ paragraphs/i,
  /^Context:\s/i,
  /^Collection Name:\s/i,
]

/** Lines that are reasoning / self-correction noise */
const REASONING_NOISE_PATTERNS = [
  /^Self-Correction/i,
  /^Check against data:/i,
  /^Revised Draft:/i,
  /^Final Review/i,
  /^Final verification/i,
  /^Refining Paragraph/i,
  /^One more check/i,
  /^One small detail/i,
  /^Let's (make|tighten|check)/i,
  /^Wait,\s/i,
  /^Actually,\s/i,
  /^Let me\s/i,
  /^HOWEVER,?\s/i,
  /^Note:\s/i,
  /^Paragraph \d+:/i,
  /^Check:/i,
  /^Constraint check:/i,
  /^(I will|I should|I must|I'll)\s/i,
  /^Looking at /i,
  /^\(Checking /i,
  /^The user is asking\b/i,
  /^The provided data\b/i,
  /^Provided data\b/i,
  /^Does the data\b/i,
  /^\*+\s*The provided data\b/i,
  /^\*+\s*The .* protocol is mentioned\b/i,
]

/** Verification checklist lines */
const VERIFICATION_PATTERNS = [
  /^\w[\w\s]*correct\?\s*(Yes|No)/i,
  /^Invented anything\?\s*(Yes|No)/i,
  /^Tone:\s*(Objective|Historical)/i,
  /^Max \d+ paragraphs:\s*(Yes|No)/i,
  /^Completion:\s/i,
]

/** Data echo lines — the model is echoing the inscription data we provided */
const DATA_ECHO_PATTERNS = [
  /^-?\s*ID:\s/i,
  /^-?\s*Number:\s#/i,
  /^-?\s*Sat:\s[\d,]/i,
  /^-?\s*Content type:\s/i,
  /^-?\s*Genesis block:\s/i,
  /^-?\s*Current owner:\s/i,
  /^-?\s*Collection:\s/i,
  /^\[\d{4}-\d{2}-\d{2}\]\s/,  // Timeline entries like [2023-02-02] TRANSFER: ...
]

// --- Core sanitizer ---

function extractFinalAnswerBlock(raw: string): string | undefined {
  const openMatch = /<final_answer>/i.exec(raw)
  if (!openMatch) return undefined

  const afterOpen = raw.slice(openMatch.index + openMatch[0].length)
  const closeMatch = /<\/final_answer>/i.exec(afterOpen)
  const answer = closeMatch ? afterOpen.slice(0, closeMatch.index) : afterOpen
  return answer.trim()
}

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === "") return false // blank lines handled separately

  for (const pattern of PROMPT_ECHO_PATTERNS) {
    if (pattern.test(trimmed)) return true
  }
  for (const pattern of REASONING_NOISE_PATTERNS) {
    if (pattern.test(trimmed)) return true
  }
  for (const pattern of VERIFICATION_PATTERNS) {
    if (pattern.test(trimmed)) return true
  }
  for (const pattern of DATA_ECHO_PATTERNS) {
    if (pattern.test(trimmed)) return true
  }
  return false
}

function stripXmlThinkingTags(raw: string): string {
  let text = raw
  for (const pattern of XML_TAG_PATTERNS) {
    text = text.replace(pattern, "")
  }
  return text
}

function cleanFinalAnswerLabel(text: string): string {
  return text
    .replace(/^\s*(?:Final\s+Answer|Answer|Resposta\s+final|Resposta)\s*:\s*/i, "")
    .trim()
}

function extractLabeledFinalAnswer(text: string): string | null {
  const labelPattern = /(?:^|\n)\s*(?:Final\s+Answer|Answer|Resposta\s+final|Resposta)\s*:\s*/i
  const match = labelPattern.exec(text)
  if (!match) return null

  const answer = text.slice(match.index + match[0].length).trim()
  return answer ? cleanFinalAnswerLabel(answer) : null
}

function extractInlineDataCheckAnswer(text: string): string | null {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean)

  for (const line of lines) {
    if (!isInlineDataCheckLine(line)) continue

    const match = line.match(/\?\s*((?:No|Yes|Não|Nao|Sim)\.?\s+[\s\S]+)$/i)
    if (match?.[1]) {
      return cleanFinalAnswerLabel(match[1])
    }
  }

  return null
}

function isInlineDataCheckLine(line: string): boolean {
  return /\b(data|dados|provided|fornecid[oa]s|specif(?:y|ies)|especifica|source data|current data|dados atuais)\b/i.test(line)
}

function extractStructuredSupplyAnswer(text: string): string | null {
  if (!/\b(?:User Question|Target Entity|Collection Name|Supply)\s*:/i.test(text)) return null

  const fields = new Map<string, string>()
  let supplySource = ""

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim().replace(/^["“”]+|["“”]+$/g, "")
    const match = line.match(/^([A-Za-z ]+?)(?:\s*\(([^)]+)\))?:\s*(.+)$/)
    if (!match) continue

    const key = match[1].trim().toLowerCase()
    const source = match[2]?.trim() ?? ""
    const value = match[3].trim().replace(/^["“”]+|["“”]+$/g, "")
    fields.set(key, value)
    if (key === "supply") supplySource = source
  }

  const rawSupply = fields.get("supply")
  if (!rawSupply) return null

  const supply = normalizeSupply(rawSupply)
  const collection = normalizeEntityName(
    fields.get("collection name") ?? fields.get("target entity") ?? "Runestone"
  )
  const language = fields.get("language") ?? ""
  const userQuestion = fields.get("user question") ?? ""
  const distribution = fields.get("distribution design")
  const sourceSuffix = supplySource ? ` na ${supplySource}` : ""

  if (isPortugueseText(`${language} ${userQuestion}`)) {
    const distributionCount = distribution?.match(/\b\d{1,3}(?:,\d{3})+\b/)?.[0]
    const distributionSentence = distributionCount
      ? ` O desenho de distribuição menciona airdrop para ${distributionCount} wallets.`
      : ""

    return `A coleção ${collection} aparece com supply de ${supply}${sourceSuffix}.${distributionSentence}`.trim()
  }

  return `The ${collection} collection is listed with a supply of ${supply}${sourceSuffix}.`
}

function normalizeSupply(value: string): string {
  return value
    .replace(/\s*\(specifically\s+["“”]?supply\s+[^)"“”]+["“”]?\)/i, "")
    .replace(/^supply\s+/i, "")
    .trim()
}

function normalizeEntityName(value: string): string {
  return value
    .replace(/^The\s+/i, "")
    .replace(/\s+collection\.?$/i, "")
    .trim()
}

function isPortugueseText(value: string): boolean {
  return /\b(portuguese|portugu[eê]s|quant[ao]s?|existem|runas?)\b/i.test(value)
}

/**
 * Extracts the final narrative block from text that may contain
 * multiple draft iterations. If multiple narrative blocks exist,
 * keeps the last one (typically the most refined).
 */
function extractFinalNarrative(text: string): string {
  const lines = text.split("\n")
  const narrativeLines: string[] = []
  let inNoiseBlock = false
  let consecutiveNoiseLines = 0

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed === "") {
      // Blank lines: keep if we're in a narrative section
      if (narrativeLines.length > 0 && !inNoiseBlock) {
        narrativeLines.push("")
      }
      continue
    }

    if (isNoiseLine(trimmed)) {
      consecutiveNoiseLines++
      // If we hit 3+ consecutive noise lines, mark as noise block
      if (consecutiveNoiseLines >= 3) {
        inNoiseBlock = true
      }
      continue
    }

    // This is a narrative line
    consecutiveNoiseLines = 0
    inNoiseBlock = false
    narrativeLines.push(line)
  }

  return narrativeLines.join("\n").trim()
}

/**
 * Detect if text contains multiple drafts of the same narrative.
 * If so, return only the last draft.
 */
function deduplicateDrafts(text: string): string {
  // Split by common draft delimiters
  const draftSeparators = [
    /\n(?:Revised Draft:)/i,
    /\n(?:Final Draft:)/i,
    /\n(?:Let's tighten)/i,
    /\n(?:Refined (?:text|version|draft):)/i,
  ]

  let segments = [text]
  for (const separator of draftSeparators) {
    const newSegments: string[] = []
    for (const segment of segments) {
      const parts = segment.split(separator)
      newSegments.push(...parts)
    }
    segments = newSegments
  }

  // If multiple segments exist, the last substantial one is the final draft
  if (segments.length > 1) {
    const substantialSegments = segments
      .map((s) => s.trim())
      .filter((s) => s.length > 80) // a real narrative paragraph is > 80 chars

    if (substantialSegments.length > 0) {
      return substantialSegments[substantialSegments.length - 1]
    }
  }

  return text
}

/**
 * Main sanitizer entry point. Applies all layers in sequence.
 *
 * @param raw - Raw LLM output, potentially containing thinking/reasoning
 * @returns Clean narrative text ready for display
 */
export function sanitizeNarrative(raw: string): string {
  if (!raw || typeof raw !== "string") return ""

  const taggedAnswer = extractFinalAnswerBlock(raw)
  const cleanedTaggedAnswer = taggedAnswer === undefined ? undefined : cleanFinalAnswerLabel(taggedAnswer)
  const labeledAnswer = taggedAnswer === undefined ? extractLabeledFinalAnswer(raw) : null
  let text = cleanedTaggedAnswer ?? labeledAnswer ?? raw

  // Layer 1: Strip XML thinking tags
  text = stripXmlThinkingTags(text)

  const structuredSupplyAnswer = extractStructuredSupplyAnswer(text)
  if (structuredSupplyAnswer) {
    return structuredSupplyAnswer
  }

  const inlineDataCheckAnswer = extractInlineDataCheckAnswer(text)
  if (inlineDataCheckAnswer) {
    text = inlineDataCheckAnswer
  }

  // Layer 2: Deduplicate drafts (before line-level filtering)
  text = deduplicateDrafts(text)

  // Layer 3: Line-level noise extraction
  text = extractFinalNarrative(text)

  // Layer 4: Final cleanup
  text = text
    .replace(/\n{3,}/g, "\n\n") // collapse excessive blank lines
    .trim()

  return text
}

export function sanitizeNarrativePreview(raw: string): string {
  if (!raw || typeof raw !== "string") return ""

  const taggedAnswer = extractFinalAnswerBlock(raw)
  if (taggedAnswer !== undefined) {
    return sanitizeNarrative(taggedAnswer)
  }

  const cleaned = sanitizeNarrative(raw)
  if (cleaned) return cleaned

  return stripXmlThinkingTags(raw)
    .split("\n")
    .filter((line) => !isNoiseLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
