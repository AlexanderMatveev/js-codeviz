#!/usr/bin/env node

import { buildChunkGraph } from "../src/chunk-graph.mjs"
import { buildLazyGraph } from "../src/lazy-graph.mjs"

function printHelp() {
  console.log(`Usage: js-codeviz <command> [options]

Commands:
  chunk-graph   Build dependency graph from built chunks
  lazy-graph    Build dynamic import graph from source files

Examples:
  js-codeviz chunk-graph --dist dist --out chunk-graph.html
  js-codeviz lazy-graph --project-root . --src src --out lazy-graph.html
`)
}

function readOption(argv, name, fallback) {
  const index = argv.indexOf(name)
  if (index === -1) return fallback
  return argv[index + 1]
}

async function runChunkGraph(argv) {
  const result = await buildChunkGraph({
    distDir: readOption(argv, "--dist", "dist"),
    outputPath: readOption(argv, "--out", "chunk-graph.html"),
  })
  console.log(`Chunk graph generated: ${result.outputPath}`)
  console.log(`Entries: ${result.entries}, chunks: ${result.chunks}, edges: ${result.edges}`)
}

async function runLazyGraph(argv) {
  const result = await buildLazyGraph({
    projectRoot: readOption(argv, "--project-root", "."),
    srcDir: readOption(argv, "--src", "src"),
    outputPath: readOption(argv, "--out", "lazy-graph.html"),
  })
  console.log(`Lazy graph generated: ${result.outputPath}`)
  console.log(`Nodes: ${result.nodes}, lazy edges: ${result.edges}`)
}

async function main() {
  const [command, ...argv] = process.argv.slice(2)
  if (!command || command === "-h" || command === "--help") {
    printHelp()
    return
  }

  if (command === "chunk-graph") {
    await runChunkGraph(argv)
    return
  }

  if (command === "lazy-graph") {
    await runLazyGraph(argv)
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
