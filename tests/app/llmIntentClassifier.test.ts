import { describe, expect, it } from "vitest"
import { shouldUseLlmIntentClassifier } from "../../src/app/lib/byok/llmIntentClassifier"
import type { ChatIntentDecision } from "../../src/app/lib/byok/chatIntentRouter"

function decision(overrides: Partial<ChatIntentDecision>): ChatIntentDecision {
  return {
    intent: "clarification_request",
    confidence: 0.51,
    stage: "l2_structured_fallback",
    mode: "qa",
    reason: "fallback_default_clarify",
    scores: {
      greeting: 0,
      smalltalk_social: 0,
      acknowledgement: 0,
      chronicle_query: 0,
      clarification_request: 0,
      offtopic_safe: 0,
    },
    ambiguous: true,
    ...overrides,
  }
}

describe("shouldUseLlmIntentClassifier", () => {
  it("uses the model for ambiguous local fallback decisions", () => {
    expect(shouldUseLlmIntentClassifier({
      localDecision: decision({}),
      hasExplicitOverride: false,
      prompt: "falo dela",
    })).toBe(true)
  })

  it("does not spend a classifier call for clear chronicle queries", () => {
    expect(shouldUseLlmIntentClassifier({
      localDecision: decision({
        intent: "chronicle_query",
        confidence: 0.85,
        stage: "l0_rules",
        reason: "chronicle_hint_or_question",
        ambiguous: false,
      }),
      hasExplicitOverride: false,
      prompt: "when was the parent minted?",
    })).toBe(false)
  })

  it("does not override explicit routing from the auto narrative flow", () => {
    expect(shouldUseLlmIntentClassifier({
      localDecision: decision({}),
      hasExplicitOverride: true,
      prompt: "Present the Chronicle",
    })).toBe(false)
  })
})
