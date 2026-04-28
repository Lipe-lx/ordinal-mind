export type WikiEntityType = "inscription" | "collection" | "artist" | "sat"

export interface WikiSection {
  heading: string
  body: string
  source_event_ids: string[]
  unverified_claims?: boolean
}

export interface WikiPage {
  slug: string
  entity_type: WikiEntityType
  title: string
  summary: string
  sections: WikiSection[]
  cross_refs: string[]
  source_event_ids: string[]
  generated_at: string
  byok_provider: string
  unverified_count: number
  view_count?: number
  updated_at?: string
}

export interface WikiPageDraft {
  slug: string
  entity_type: WikiEntityType
  title: string
  summary: string
  sections: WikiSection[]
  cross_refs: string[]
  source_event_ids: string[]
  generated_at: string
  byok_provider: string
}

export interface WikiLintReport {
  run_at: string
  unverified_pages: Array<{ slug: string; title: string; unverified_count: number }>
  orphan_pages: Array<{ slug: string; title: string }>
  stale_pages: Array<{ slug: string; generated_at: string }>
  broken_cross_refs: Array<{ slug: string; broken_ref: string }>
  summary: {
    total: number
    healthy: number
    needs_attention: number
  }
}

export interface WikiApiError {
  ok?: false
  error?: string
  status?: WikiSchemaStatus
  phase?: string
  partial?: boolean
}

export type WikiSchemaStatus =
  | "ready"
  | "db_unavailable"
  | "schema_missing"
  | "schema_incomplete"

export interface WikiHealth {
  ok: boolean
  ready: boolean
  status: WikiSchemaStatus
  error?: string
  phase?: "fail_soft"
  detail?: string
  present_objects: string[]
  missing_objects: string[]
  checked_at: string
}

export type WikiLifecycleStatus =
  | "idle"
  | "loading"
  | "loaded"
  | "refreshing"
  | "unavailable"
  | "missing"
  | "not_initialized"
