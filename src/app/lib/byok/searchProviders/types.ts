export interface SearchResult {
  title?: string
  url?: string
  content: string // Full text, excerpt, or synthesized answer
  published_date?: string
}

export interface SearchToolResult {
  tool_name: string
  results: SearchResult[]
  error?: string
}

export interface SearchProviderConfig {
  apiKey?: string
  endpoint?: string
}

export interface SearchProvider {
  name: string
  execute: (args: Record<string, unknown>, config: SearchProviderConfig) => Promise<SearchToolResult>
}
