import { describe, it, expect, vi } from "vitest"
import { withRetry } from "../../src/worker/pipeline/withRetry"

describe("withRetry", () => {
  it("should return value on first success", async () => {
    const fn = vi.fn().mockResolvedValue("success")
    const result = await withRetry(fn)
    expect(result).toBe("success")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("should retry and succeed", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("success")
    const result = await withRetry(fn, { delayMs: 1 })
    expect(result).toBe("success")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("should throw after all retries fail", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("final fail"))
    await expect(withRetry(fn, { retries: 2, delayMs: 1 })).rejects.toThrow(
      "final fail"
    )
    expect(fn).toHaveBeenCalledTimes(3)
  })
})
