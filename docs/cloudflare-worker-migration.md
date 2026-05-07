# Cloudflare Worker Migration Runbook (Source -> Target Account)

This runbook migrates `ordinal-mind-worker` from a source Cloudflare account to a target account with D1 + KV copied.

## Preconditions

- Node dependencies installed (`npm install`).
- Wrangler available (`npx wrangler --version`).
- Access to both Cloudflare accounts.
- Discord OAuth app access to update redirect URI.

## 1) Prepare a migration workspace

```bash
export MIG_TS="$(date +%Y%m%d-%H%M%S)"
export MIG_DIR="/tmp/ordinalmind-migration-$MIG_TS"
mkdir -p "$MIG_DIR"
```

## 2) Authenticate in source account

Use a dedicated config directory for source session:

```bash
export CF_SRC_CONFIG="/tmp/ordinalmind-cf-src"
XDG_CONFIG_HOME="$CF_SRC_CONFIG" npx wrangler login
XDG_CONFIG_HOME="$CF_SRC_CONFIG" npx wrangler whoami
```

## 3) Export source D1 + KV

### D1 export (data only)

Cloudflare D1 export may fail when the database contains FTS5 virtual tables.  
In this repository, run data-only export for concrete tables and rely on migrations for schema:

```bash
XDG_CONFIG_HOME="$CF_SRC_CONFIG" npx wrangler d1 export ordinal-mind-wiki \
  --remote \
  --no-schema \
  --table raw_chronicle_events \
  --table wiki_pages \
  --table wiki_log \
  --table users \
  --table wiki_contributions \
  --table consolidated_cache \
  --output "$MIG_DIR/d1-source-data.sql"
```

### KV export

Current KV namespace ID in this repository:

- `CHRONICLES_KV`: `9434dd5bf9394fcc808384e46ff61725`

```bash
node scripts/cloudflare/kv-export.mjs \
  --namespace-id 9434dd5bf9394fcc808384e46ff61725 \
  --out "$MIG_DIR/kv-source.json" \
  --config-home "$CF_SRC_CONFIG"
```

### Export report

```bash
jq '.count' "$MIG_DIR/kv-source.json"
wc -l "$MIG_DIR/d1-source-data.sql"
```

## 4) Authenticate in target account

```bash
export CF_DST_CONFIG="/tmp/ordinalmind-cf-dst"
XDG_CONFIG_HOME="$CF_DST_CONFIG" npx wrangler login
XDG_CONFIG_HOME="$CF_DST_CONFIG" npx wrangler whoami
```

## 5) Provision target resources

Create new D1 + KV in target account:

```bash
XDG_CONFIG_HOME="$CF_DST_CONFIG" npx wrangler d1 create ordinal-mind-wiki
XDG_CONFIG_HOME="$CF_DST_CONFIG" npx wrangler kv namespace create CHRONICLES_KV
```

Capture returned IDs and update `wrangler.jsonc` bindings:

- `d1_databases[0].database_id`
- `kv_namespaces[0].id`

Keep bindings unchanged:

- D1 binding: `DB`
- KV binding: `CHRONICLES_KV`

## 6) Apply migrations + import data in target account

### Apply schema migrations

```bash
XDG_CONFIG_HOME="$CF_DST_CONFIG" npx wrangler d1 migrations apply ordinal-mind-wiki --remote
```

### Import D1 data dump

```bash
CLOUDFLARE_ACCOUNT_ID="<TARGET_ACCOUNT_ID>" \
XDG_CONFIG_HOME="$CF_DST_CONFIG" \
npx wrangler d1 execute ordinal-mind-wiki --remote --file "$MIG_DIR/d1-source-data.sql"
```

### Import KV dump

```bash
node scripts/cloudflare/kv-import-bulk.mjs \
  --in "$MIG_DIR/kv-source.json" \
  --namespace-id <NEW_KV_NAMESPACE_ID> \
  --config-home "$CF_DST_CONFIG"
```

## 7) Configure worker secrets/vars in target account

```bash
XDG_CONFIG_HOME="$CF_DST_CONFIG" npx wrangler secret put UNISAT_API_KEY
XDG_CONFIG_HOME="$CF_DST_CONFIG" npx wrangler secret put DISCORD_CLIENT_ID
XDG_CONFIG_HOME="$CF_DST_CONFIG" npx wrangler secret put DISCORD_CLIENT_SECRET
XDG_CONFIG_HOME="$CF_DST_CONFIG" npx wrangler secret put JWT_SECRET
```

For non-secret vars (`wrangler.jsonc` vars section or dashboard):

- `ENVIRONMENT=production`
- `ALLOWED_ORIGINS=https://<new-workers-dev-origin>`

## 8) Deploy to target account

```bash
XDG_CONFIG_HOME="$CF_DST_CONFIG" npm run deploy
```

## 9) OAuth redirect update (Discord)

Update redirect URI to the new worker origin:

- `https://<new-workers-dev-origin>/api/auth/callback`

## 10) Post-deploy validation

- `GET /api/chronicle?id=<inscription>` returns timeline.
- `GET /api/wiki/health` returns `ok`.
- Discord auth flow works end-to-end (`/api/auth/discord` -> callback -> `/api/auth/me`).
- Wiki write/read routes operate (`contribute` and consolidated endpoints).
- Local smoke check:

```bash
npm run test:smoke
npm run build
```

## Rollback

- Keep source worker untouched until target validation finishes.
- If target fails, revert DNS/client usage to source origin and re-check target secrets/bindings/data.
