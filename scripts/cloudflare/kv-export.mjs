#!/usr/bin/env node
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

function usage() {
  console.error(
    "Usage: node scripts/cloudflare/kv-export.mjs --namespace-id <id> --out <file> [--config-home <dir>]"
  )
}

function parseArgs(argv) {
  const args = {
    namespaceId: "",
    outFile: "",
    configHome: "",
  }

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === "--namespace-id") {
      args.namespaceId = argv[++i] ?? ""
    } else if (token === "--out") {
      args.outFile = argv[++i] ?? ""
    } else if (token === "--config-home") {
      args.configHome = argv[++i] ?? ""
    }
  }

  if (!args.namespaceId || !args.outFile) {
    usage()
    process.exit(1)
  }

  return args
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, "")
}

function extractJsonArray(raw) {
  const cleaned = stripAnsi(raw)
  const emptyMatch = cleaned.match(/\[\s*\]/m)
  if (emptyMatch) return emptyMatch[0]
  const match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/m)
  if (!match) {
    throw new Error(`Could not parse Wrangler JSON output:\n${cleaned}`)
  }
  return match[0]
}

function runWrangler(args, configHome) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    if (configHome) env.XDG_CONFIG_HOME = configHome

    const child = spawn("npx", ["wrangler", ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`wrangler ${args.join(" ")} failed (code ${code})\n${stderr}`))
      }
    })
  })
}

async function main() {
  const args = parseArgs(process.argv)

  const listed = await runWrangler(
    ["kv", "key", "list", "--namespace-id", args.namespaceId],
    args.configHome
  )

  const keysRaw = extractJsonArray(listed.stdout)
  const keys = JSON.parse(keysRaw)

  const exported = []
  const startedAt = new Date().toISOString()

  for (const item of keys) {
    if (!item?.name) continue

    const got = await runWrangler(
      ["kv", "key", "get", item.name, "--namespace-id", args.namespaceId, "--text"],
      args.configHome
    )

    exported.push({
      key: item.name,
      value: got.stdout,
      expiration: Number.isFinite(item.expiration) ? item.expiration : undefined,
      metadata: item.metadata ?? undefined,
    })
  }

  const payload = {
    namespace_id: args.namespaceId,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    count: exported.length,
    entries: exported,
  }

  await mkdir(path.dirname(args.outFile), { recursive: true })
  await writeFile(args.outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8")

  console.log(JSON.stringify({ ok: true, out: args.outFile, count: exported.length }))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
