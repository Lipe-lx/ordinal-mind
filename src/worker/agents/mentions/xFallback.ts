import type { SocialMention, SourceCatalogItem } from "../../../app/lib/types"
import { scrapeXMentions, type XMentionDiagnostics } from "../xsearch"
import type { MentionProviderContext, MentionProviderResult } from "./types"

export async function searchXFallback(
  context: MentionProviderContext
): Promise<MentionProviderResult> {
  const diagnostics: XMentionDiagnostics = {
    official_x_urls: [],
    candidate_handles: [],
    queries: [],
    attempts: [],
  }

  const mentions = await scrapeXMentions(context.inscriptionId, {
    inscriptionNumber: context.inscriptionNumber,
    collectionName: context.collectionName,
    itemName: context.itemName,
    officialXUrls: context.officialXUrls,
    diagnostics,
    debug: context.debug,
    requestId: context.requestId,
  })

  if (context.diagnostics) {
    context.diagnostics.official_x_urls = diagnostics.official_x_urls
    context.diagnostics.candidate_handles = diagnostics.candidate_handles
    context.diagnostics.queries = diagnostics.queries
    context.diagnostics.attempts.push(
      ...diagnostics.attempts.map((attempt) => ({
        query: attempt.query,
        outcome: attempt.outcome,
        status: attempt.status,
        result_count: attempt.mention_count,
        detail: `${attempt.provider} ${attempt.transport}`,
      }))
    )
  }

  const normalized = mentions.map((mention) => normalizeXMention(mention, context))
  const sourceCatalog: SourceCatalogItem[] = [{
    source_type: "x_search_fallback",
    url_or_ref: "https://html.duckduckgo.com/html/",
    trust_level: "public_social",
    fetched_at: new Date().toISOString(),
    partial: false,
    detail: `${normalized.length} low-priority X fallback mention${normalized.length === 1 ? "" : "s"} found`,
  }]

  return { mentions: normalized, sourceCatalog }
}

function normalizeXMention(
  mention: { url: string; title: string; snippet: string; found_at: string },
  context: MentionProviderContext
): SocialMention {
  const preferredQuery = context.queries[0]
  return {
    platform: "x",
    provider: "x_fallback",
    canonical_url: mention.url,
    title: mention.title || "X mention",
    excerpt: mention.snippet,
    text: [mention.title, mention.snippet].filter(Boolean).join(" · "),
    published_at: mention.found_at,
    discovered_at: mention.found_at,
    scope: preferredQuery?.scope ?? "collection_level",
    match_type: preferredQuery?.matchType ?? "collection_only",
    provider_confidence: 0.35,
  }
}
