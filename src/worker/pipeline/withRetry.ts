const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; delayMs?: number; label?: string } = {}
): Promise<T> {
  const { retries = 2, delayMs = 300, label = "fetch" } = options
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === retries) throw err
      const wait = delayMs * (attempt + 1)
      console.warn(
        `[withRetry] ${label} attempt ${
          attempt + 1
        } failed, retrying in ${wait}ms`
      )
      await sleep(wait)
    }
  }
  throw new Error("unreachable")
}
