#!/usr/bin/env node

import { buildLazyGraph } from "../src/lazy-graph.mjs"

function printHelp() {
  console.log(`Usage: codeviz-build-lazy-graph [options]

Options:
  --project-root <dir>   App root directory (default: .)
  --src <dir>            Source directory (default: src)
  --out <file>           HTML report path (default: lazy-graph.html)
  -h, --help             Show this help
`)
}

function parseArgs(argv) {
  const args = { projectRoot: ".", srcDir: "src", outputPath: "lazy-graph.html" }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "-h" || arg === "--help") {
      args.help = true
      continue
    }
    if (arg === "--project-root") {
      args.projectRoot = argv[i + 1]
      i += 1
      continue
    }
    if (arg === "--src") {
      args.srcDir = argv[i + 1]
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

  const result = await buildLazyGraph(args)
  console.log(`Lazy graph generated: ${result.outputPath}`)
  console.log(`Nodes: ${result.nodes}, lazy edges: ${result.edges}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
