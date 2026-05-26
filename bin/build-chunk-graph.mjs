#!/usr/bin/env node

import { buildChunkGraph } from "../src/chunk-graph.mjs"

function printHelp() {
  console.log(`Usage: codeviz-build-chunk-graph [options]

Options:
  --dist <dir>   Build output directory (default: dist)
  --out <file>   HTML report path (default: chunk-graph.html)
  -h, --help     Show this help
`)
}

function parseArgs(argv) {
  const args = { distDir: "dist", outputPath: "chunk-graph.html" }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "-h" || arg === "--help") {
      args.help = true
      continue
    }
    if (arg === "--dist") {
      args.distDir = argv[i + 1]
      i += 1
      continue
    }
    if (arg === "--out") {
      args.outputPath = argv[i + 1]
      i += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const result = await buildChunkGraph(args)
  console.log(`Chunk graph generated: ${result.outputPath}`)
  console.log(`Entries: ${result.entries}, chunks: ${result.chunks}, edges: ${result.edges}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
