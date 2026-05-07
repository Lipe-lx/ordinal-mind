#!/usr/bin/env node
import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

function usage() {
  console.error(
    "Usage: node scripts/cloudflare/kv-import-bulk.mjs --in <file> --namespace-id <id> [--config-home <dir>]"
  )
}

function parseArgs(argv) {
  const args = {
    inFile: "",
    namespaceId: "",
    configHome: "",
  }

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === "--in") {
      args.inFile = argv[++i] ?? ""
    } else if (token === "--namespace-id") {
      args.namespaceId = argv[++i] ?? ""
    } else if (token === "--config-home") {
      args.configHome = argv[++i] ?? ""
    }
  }

  if (!args.inFile || !args.namespaceId) {
    usage()
    process.exit(1)
  }

  return args
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

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv)
  const raw = await readFile(args.inFile, "utf8")
  const parsed = JSON.parse(raw)

  const entries = Array.isArray(parsed.entries) ? parsed.entries : []
  const chunks = chunk(entries, 1000)

  let imported = 0
  for (let i = 0; i < chunks.length; i += 1) {
    const part = chunks[i].map((row) => {
      const item = { key: row.key, value: row.value }
      if (Number.isFinite(row.expiration)) item.expiration = row.expiration
      if (row.metadata !== undefined) item.metadata = row.metadata
      return item
    })

    const file = path.join(os.tmpdir(), `ordinalmind-kv-bulk-${Date.now()}-${i}.json`)
    await writeFile(file, `${JSON.stringify(part)}\n`, "utf8")

    await runWrangler(
      ["kv", "bulk", "put", file, "--namespace-id", args.namespaceId],
      args.configHome
    )

    imported += part.length
    console.log(JSON.stringify({ chunk: i + 1, total_chunks: chunks.length, imported }))
  }

  console.log(JSON.stringify({ ok: true, imported, namespace_id: args.namespaceId }))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
