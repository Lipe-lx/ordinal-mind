import type { WikiLintReport } from "./wikiTypes"

const LINT_SESSION_KEY = "ordinal-mind:wiki-lint-checked"
const LINT_REPORT_KEY = "ordinal-mind:wiki-lint-report"
const LINT_STALE_AFTER_MS = 12 * 60 * 60 * 1000

export function shouldRunLint(now = Date.now()): boolean {
  if (typeof window === "undefined") return false
  const last = window.sessionStorage.getItem(LINT_SESSION_KEY)
  if (!last) return true

  const lastTs = Number(last)
  if (!Number.isFinite(lastTs)) return true
  return now - lastTs >= LINT_STALE_AFTER_MS
}

export async function maybeRunWikiLint(now = Date.now()): Promise<WikiLintReport | null> {
  if (typeof window === "undefined") return null
  if (!shouldRunLint(now)) {
    return getCachedLintReport()
  }

  try {
    const response = await fetch("/api/wiki/lint", { method: "GET" })
    if (!response.ok) {
      window.sessionStorage.setItem(LINT_SESSION_KEY, String(now))
      return null
    }

    const report = await response.json() as WikiLintReport
    window.sessionStorage.setItem(LINT_SESSION_KEY, String(now))
    window.sessionStorage.setItem(LINT_REPORT_KEY, JSON.stringify(report))
    return report
  } catch {
    window.sessionStorage.setItem(LINT_SESSION_KEY, String(now))
    return null
  }
}

export function getCachedLintReport(): WikiLintReport | null {
  if (typeof window === "undefined") return null
  const raw = window.sessionStorage.getItem(LINT_REPORT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as WikiLintReport
  } catch {
    return null
  }
}

export function isSlugFlaggedForRegeneration(
  slug: string,
  report: WikiLintReport | null
): boolean {
  if (!report) return false

  return (
    report.stale_pages.some((page) => page.slug === slug)
    || report.unverified_pages.some((page) => page.slug === slug)
    || report.orphan_pages.some((page) => page.slug === slug)
  )
}
