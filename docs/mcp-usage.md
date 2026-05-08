# MCP Usage Guide (Ordinal Mind)

Short operational guide for teams and agents consuming the public MCP server.

## Endpoint

- Base URL: `https://ordinalmind.com/mcp`
- Transport: Streamable HTTP (SSE)
- Server: `ordinal-mind` (`2.0.0`)

## Required Headers

Use these headers for MCP requests:

- `Content-Type: application/json`
- `Accept: application/json, text/event-stream`

If `Accept` does not include `text/event-stream`, the server may return `406`.

## Quick Start

Note: values like `ordinal-punks` and `0` are just sample inputs. For production use, discover valid slugs first with `wiki_search_pages`/`wiki_list_pages` and use real inscription IDs.

### 1) Initialize

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"initialize",
    "params":{
      "protocolVersion":"2024-11-05",
      "capabilities":{},
      "clientInfo":{"name":"demo-client","version":"1.0.0"}
    }
  }'
```

Expected capabilities include `resources`, `tools`, and `prompts`.

### 2) Discover Resource Templates

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"resources/templates/list",
    "params":{}
  }'
```

Templates currently exposed:

- `chronicle://inscription/{id}`
- `wiki://page/{slug}`
- `wiki://collection/{slug}`
- `collection://context/{slug}`

### 3) Read a Resource

#### Chronicle by inscription

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":3,
    "method":"resources/read",
    "params":{"uri":"chronicle://inscription/0"}
  }'
```

#### Collection wiki

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":4,
    "method":"resources/read",
    "params":{"uri":"wiki://collection/ordinal-punks"}
  }'
```

#### Wiki page by exact slug

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":5,
    "method":"resources/read",
    "params":{"uri":"wiki://page/collection%3Aordinal-punks"}
  }'
```

#### Collection context

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":6,
    "method":"resources/read",
    "params":{"uri":"collection://context/ordinal-punks"}
  }'
```

### 4) Use Query Tools

#### List tools

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":7,
    "method":"tools/list",
    "params":{}
  }'
```

#### Get strategy guide (`help`)

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":8,
    "method":"tools/call",
    "params":{
      "name":"help",
      "arguments":{}
    }
  }'
```

#### Query chronicle with filters

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":9,
    "method":"tools/call",
    "params":{
      "name":"query_chronicle",
      "arguments":{
        "inscription_id":"0",
        "event_types":["genesis","transfer"],
        "sort":"asc",
        "limit":25
      }
    }
  }'
```

#### Search inscriptions by collection

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":10,
    "method":"tools/call",
    "params":{
      "name":"search_collection_inscriptions",
      "arguments":{
        "collection_slug":"ordinal-punks",
        "limit":20,
        "offset":0,
        "sort":"recent"
      }
    }
  }'
```

### 5) Use Wiki Read-Only Tools (Phase 1)

#### Get global wiki stats

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":11,
    "method":"tools/call",
    "params":{
      "name":"wiki_stats",
      "arguments":{}
    }
  }'
```

Returns:
- `total_pages`: rows in `wiki_pages`
- `indexed_pages`: rows in `wiki_fts` (public searchable index)
- `published_pages`: unique `collection_slug` with published consensus contributions
- `published_contribution_pages`: alias of `published_pages` (explicit governance metric)
- `quarantine_pages`: unique `collection_slug` with quarantined contributions
- `seed_pages`: collection placeholders generated by discovery seed (`system_seed` + empty editorial shape)
- `published_shape_pages`: `total_pages - seed_pages` (pages with non-seed shape)
- `inventory_pages`: alias of `total_pages`
- `inventory_editorial_pages`: alias of `published_shape_pages`
- `updated_at`: latest update timestamp across pages and public contribution states

#### Search wiki pages (all entity types)

Each item now includes:
- `publication_status`: `seed` or `published`
- `page_kind`: `seed` or `editorial`
- `is_seed`: boolean convenience flag

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":12,
    "method":"tools/call",
    "params":{
      "name":"wiki_search_pages",
      "arguments":{
        "query":"runestone",
        "entity_type":"collection",
        "limit":10,
        "offset":0
      }
    }
  }'
```

#### List wiki pages (inventory)

Each item now includes:
- `publication_status`: `seed` or `published`
- `page_kind`: `seed` or `editorial`
- `is_seed`: boolean convenience flag

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":13,
    "method":"tools/call",
    "params":{
      "name":"wiki_list_pages",
      "arguments":{
        "limit":50,
        "offset":0
      }
    }
  }'
```

#### Get wiki page by slug

Response includes `publication_status` at top-level and inside `page`.

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":14,
    "method":"tools/call",
    "params":{
      "name":"wiki_get_page",
      "arguments":{
        "slug":"inscription:cbd62b57bc1b3ae8f6e0cfc402fbdbeb5ae4172f9200671f5f689f1af6d3332bi0"
      }
    }
  }'
```

#### Get wiki field status

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":15,
    "method":"tools/call",
    "params":{
      "name":"wiki_get_field_status",
      "arguments":{
        "collection_slug":"ordinal-punks"
      }
    }
  }'
```

#### Get wiki collection context

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc":"2.0",
    "id":16,
    "method":"tools/call",
    "params":{
      "name":"wiki_get_collection_context",
      "arguments":{
        "collection_slug":"ordinal-punks",
        "include_graph_summary":true
      }
    }
  }'
```

### 6) Use Wiki Proposal Tool (Phase 2 Governance)

#### Propose a wiki update (tier-governed)

```bash
curl -sS -X POST 'https://ordinalmind.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer <mcp_access_token>' \
  --data '{
    "jsonrpc":"2.0",
    "id":18,
    "method":"tools/call",
    "params":{
      "name":"wiki_propose_update",
      "arguments":{
        "collection_slug":"ordinal-punks",
        "field":"origin_narrative",
        "proposed_value":"Launch narrative draft backed by cited sources.",
        "sources":[
          "https://ordinals.com/inscription/6fb976ab49dcec017f1e201e84395983204ae1a7c2abf7ced0a85d692e442799i0"
        ],
        "rationale":"Candidate summary to be reviewed before publication.",
        "idempotency_key":"wiki-proposal-ordinal-punks-001"
      }
    }
  }'
```

## OAuth MCP (Dedicated Token)

Use OAuth MCP endpoints (separate from web session auth):

- `GET /mcp/oauth/authorize`
- `GET /mcp/oauth/callback`
- `POST /mcp/oauth/token`
- `POST /mcp/oauth/register`
- `GET /.well-known/oauth-protected-resource`

Discovery example:

```bash
curl -sS 'https://ordinalmind.com/.well-known/oauth-protected-resource'
```

After OAuth, send MCP bearer token:

```http
Authorization: Bearer <mcp_access_token>
```

State handoff note:
- OAuth `state` is persisted in `OAUTH_KV` and validated on callback.
- Always start a fresh authorize URL per login attempt.
- Do not reuse callback URLs or run the same flow in parallel tabs.
- Complete login quickly after opening authorize.

## Capability Behavior

- Anonymous:
  - `resources/*` available
  - `help` available
  - `query_chronicle` available
  - `search_collection_inscriptions` available
  - `wiki_search_pages` available
  - `wiki_list_pages` available
  - `wiki_get_page` available
  - `wiki_get_field_status` available
  - `wiki_get_collection_context` available
  - `prompts/list` returns `[]`
- Authenticated (Discord tier claims in MCP token):
  - `community|og|genesis`: `wiki_propose_update` (follows app tier rules: `community -> quarantine`, `og/genesis -> published`)
  - `community|og|genesis`: `contribute_wiki` (+ anonymous query tools remain available)
  - `genesis`: `review_contribution`, `refresh_chronicle`, `reindex_collection`

## Troubleshooting

- `406 Not Acceptable` on `/mcp`
  - Missing `Accept: application/json, text/event-stream`.
- `tools/list` without mutation tools
  - Expected for anonymous token/session. Read-only query tools remain available.
- `401/403` on `tools/call`
  - Missing/invalid MCP token or insufficient tier/capability.
- `MCP OAuth failed: Authorization state expired`
  - Callback could not resolve state (expired/reused/eventual-consistency race).
  - Restart from a new `/mcp/oauth/authorize` URL and complete login immediately.
- `resource_payload_too_large`
  - Response hit MCP guardrails; narrow query scope.
- `untrusted_origin`
  - Origin is not in trusted origin set for MCP hardening.

## Notes for Agents/Clients

- Prefer template discovery via `resources/templates/list`.
- Expect SSE responses (`event: message` + JSON payload).
- Treat `notifications/initialized` as a notification, not a request expecting a response.
