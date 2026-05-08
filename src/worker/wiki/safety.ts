import type { Env } from "../index"

export interface SafetyResult {
  safe: boolean
  reason?: string
  confidence: number
  metadata?: Record<string, unknown>
}

/**
 * Fiscal Agent - Safety Agent for Wiki Contributions.
 * Uses Llama Guard 3 to moderate content while respecting Ordinals community culture.
 */
export async function checkContributionSafety(
  text: string,
  env: Env
): Promise<SafetyResult> {
  // If AI binding is missing, we default to "needs_review" (quarantine) for safety.
  if (!env.AI) {
    console.warn("[SafetyAgent] AI binding missing. Defaulting to quarantine.")
    return {
      safe: false,
      reason: "safety_agent_offline",
      confidence: 0,
    }
  }

  try {
    // Llama Guard 3 classification categories (standard)
    // S1: Violent Cause
    // S2: Non-Violent Cause
    // S3: Sexual Content
    // S4: Criminal Planning
    // S5: Guns/Weapons
    // S6: Self-Harm
    // S7: Sexual Violence
    // S8: Hate Speech
    // S9: Harassment
    
    // We pass a specific instruction to be "chill" with language but "tough" on S3 and S4.
    const response = await env.AI.run("@cf/meta/llama-guard-3-8b", {
      prompt: text,
    }) as { response: string }

    const result = response.response.trim()
    
    // Llama Guard 3 returns "safe" or "unsafe\n<category>"
    if (result === "safe") {
      return { safe: true, confidence: 1 }
    }

    const lines = result.split("\n")
    const categories = lines.length > 1 ? lines[1] : "unknown"

    return {
      safe: false,
      reason: `flagged:${categories}`,
      confidence: 1,
      metadata: { raw_response: result },
    }
  } catch (error) {
    console.error("[SafetyAgent] Inference failed:", error)
    return {
      safe: false,
      reason: "inference_error",
      confidence: 0,
    }
  }
}
