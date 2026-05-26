import { promises as fs } from "node:fs"
import path from "node:path"

const JS_EXT_RE = /\.(?:m?js)$/i

function stripUrlDecorators(rawPath) {
  return rawPath.split("#")[0].split("?")[0]
}

function parseScriptSources(indexHtmlSource) {
  const sources = []
  const scriptRe = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
  for (const match of indexHtmlSource.matchAll(scriptRe)) {
    sources.push(stripUrlDecorators(match[1]))
  }
  return sources
}

function normalizeChunkPath(specifier, fromFilePath, distDir) {
  const cleaned = stripUrlDecorators(specifier)
  let resolved

  if (cleaned.startsWith("/")) {
    resolved = path.resolve(distDir, `.${cleaned}`)
  } else {
    resolved = path.resolve(path.dirname(fromFilePath), cleaned)
  }

  const relativeToDist = path.relative(distDir, resolved)
  if (
    relativeToDist.startsWith("..") ||
    path.isAbsolute(relativeToDist) ||
    !JS_EXT_RE.test(resolved)
  ) {
    return null
  }

  return path.normalize(resolved)
}

function extractImports(jsSource) {
  const out = []
  const staticImportRe = /\bimport\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g
  const dynamicImportRe = /\bimport\(\s*["']([^"']+)["']\s*\)/g

  for (const match of jsSource.matchAll(staticImportRe)) {
    out.push(match[1])
  }
  for (const match of jsSource.matchAll(dynamicImportRe)) {
    out.push(match[1])
  }
  return out
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function shortChunkName(absPath, distDir) {
  const rel = path.relative(distDir, absPath).replaceAll(path.sep, "/")
  return rel.replace(/^assets\//, "")
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function buildLevels(entryNodes, adjacency) {
  const levels = new Map()
  const queue = []

  for (const entry of entryNodes) {
    levels.set(entry, 0)
    queue.push(entry)
  }

  while (queue.length > 0) {
    const current = queue.shift()
    const currentLevel = levels.get(current)
    const targets = adjacency.get(current) || []
    for (const next of targets) {
      if (levels.has(next)) continue
      levels.set(next, currentLevel + 1)
      queue.push(next)
    }
  }

  return levels
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function buildVisPayload({ nodes, nodeData, edges }) {
  const allBytes = nodes.map((node) => nodeData.get(node)?.bytes ?? 0).filter((bytes) => bytes > 0)
  const minBytes = allBytes.length > 0 ? Math.min(...allBytes) : 1
  const maxBytes = allBytes.length > 0 ? Math.max(...allBytes) : 1
  const minLog = Math.log10(minBytes + 1)
  const maxLog = Math.log10(maxBytes + 1)

  function dotSizeByBytes(bytes, isEntry) {
    if (minLog === maxLog) return isEntry ? 28 : 20
    const normalized = (Math.log10(Math.max(1, bytes) + 1) - minLog) / (maxLog - minLog)
    const base = 14 + normalized * 24
    return isEntry ? Math.min(42, base + 4) : base
  }

  const visNodes = nodes.map((node) => {
    const info = nodeData.get(node)
    const nodeSize = dotSizeByBytes(info.bytes, info.isEntry)
    return {
      id: node,
      label: `${info.isEntry ? "ENTRY\\n" : ""}${info.label}\n${info.size}`,
      shape: "dot",
      size: Number(nodeSize.toFixed(1)),
      title: `${info.label} (${info.size})${info.isEntry ? " [entry]" : ""}`,
      color: info.isEntry
        ? {
            background: "#7a4b00",
            border: "#f59e0b",
            highlight: { background: "#996100", border: "#ffd08a" },
          }
        : {
            background: "#1d4f93",
            border: "#60a5fa",
            highlight: { background: "#2a69bb", border: "#a7ccff" },
          },
      font: {
        color: "#ecf2ff",
        face: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
        size: 12,
        multi: "html",
      },
    }
  })

  const visEdges = edges
    .filter((edge) => nodeData.has(edge.from) && nodeData.has(edge.to))
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      arrows: "to",
      color: { color: "#6b7fa8", highlight: "#9fb6e3" },
      width: 1.2,
    }))

  return { visNodes, visEdges }
}

function buildHtml({ distDir, entryNodes, nodeData, edges }) {
  const adjacency = new Map()
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, [])
    adjacency.get(edge.from).push(edge.to)
  }

  const levels = buildLevels(entryNodes, adjacency)
  const nodes = Array.from(nodeData.keys())
  const maxDepth = Math.max(...nodes.map((node) => levels.get(node) ?? 0), 0)
  const escapedDist = escapeHtml(distDir)
  const { visNodes, visEdges } = buildVisPayload({ nodes, nodeData, edges })
  const sortedRows = nodes
    .map((node) => ({ node, info: nodeData.get(node) }))
    .sort((a, b) => a.info.label.localeCompare(b.info.label))
  const rowsHtml = sortedRows
    .map(({ node, info }) => {
      const imports = (adjacency.get(node) || [])
        .filter((to) => nodeData.has(to))
        .map((to) => nodeData.get(to).label)
        .sort((a, b) => a.localeCompare(b))
      const importsHtml = imports.length
        ? imports.map((name) => `<code>${escapeHtml(name)}</code>`).join(", ")
        : "<span style='color:#8ea0bf'>-</span>"
      const entryMark = info.isEntry ? " <strong>(entry)</strong>" : ""
      return `<tr>
        <td><code>${escapeHtml(info.label)}</code>${entryMark}</td>
        <td>${info.size}</td>
        <td>${importsHtml}</td>
      </tr>`
    })
    .join("\n")

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chunk graph (vis-network)</title>
  <link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/vis-network@9.1.9/styles/vis-network.min.css"
  />
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
    }
    body {
      margin: 0;
      padding: 24px;
      background: #0b1020;
      color: #dbe2f0;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
    }
    .meta {
      color: #9fb0cc;
      margin-bottom: 20px;
      font-size: 14px;
    }
    .graph-shell {
      border: 1px solid #2a3553;
      border-radius: 12px;
      overflow: auto;
      background: #0e152b;
      margin-bottom: 20px;
    }
    .graph-body {
      height: 70vh;
      min-height: 520px;
    }
    .table-shell {
      border: 1px solid #2a3553;
      border-radius: 12px;
      overflow: hidden;
      background: #0e152b;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid #1e2842;
      vertical-align: top;
    }
    th {
      background: #141f3b;
      color: #b7c5de;
      font-weight: 600;
    }
    tr:last-child td {
      border-bottom: none;
    }
    code {
      color: #f5f7fc;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <h1>Chunk dependency graph (vis-network)</h1>
  <div class="meta">
    dist: <code>${escapedDist}</code> | entries: ${entryNodes.length} | chunks: ${nodes.length} | edges: ${edges.length} | max depth: ${maxDepth}
  </div>

  <div class="graph-shell">
    <div class="graph-body">
      <div id="chunkGraph" style="width:100%;height:100%"></div>
    </div>
  </div>

  <div class="table-shell">
    <table>
      <thead>
        <tr>
          <th style="width:40%">Chunk</th>
          <th style="width:15%">Size</th>
          <th>Imports</th>
        </tr>
      </thead>
      <tbody>
${rowsHtml}
      </tbody>
    </table>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
  <script>
    const nodes = new vis.DataSet(${JSON.stringify(visNodes)});
    const edges = new vis.DataSet(${JSON.stringify(visEdges)});
    const container = document.getElementById("chunkGraph");

    const network = new vis.Network(
      container,
      { nodes, edges },
      {
        autoResize: true,
        interaction: {
          hover: true,
          tooltipDelay: 120,
          dragNodes: true,
          zoomView: true,
          dragView: true,
          navigationButtons: true
        },
        edges: {
          smooth: {
            type: "dynamic"
          }
        },
        physics: {
          enabled: true,
          solver: "barnesHut",
          stabilization: {
            enabled: true,
            iterations: 50,
            updateInterval: 30,
            fit: true
          },
          barnesHut: {
            gravitationalConstant: -3600,
            centralGravity: 0.26,
            springLength: 130,
            springConstant: 0.06,
            damping: 0.84,
            avoidOverlap: 0.4
          },
          maxVelocity: 20,
          minVelocity: 0.7,
          timestep: 0.45,
          adaptiveTimestep: true
        },
        layout: {
          improvedLayout: true,
          randomSeed: 42
        }
      }
    );

    network.once("stabilizationIterationsDone", () => {
      network.fit({ animation: { duration: 380, easingFunction: "easeOutCubic" } });
    });

    network.on("dragStart", () => {
      network.setOptions({ physics: { enabled: true } });
    });
  </script>
</body>
</html>`
}

export async function buildChunkGraph({
  distDir = "dist",
  outputPath = "chunk-graph.html",
  cwd = process.cwd(),
} = {}) {
  const resolvedDistDir = path.resolve(cwd, distDir)
  const resolvedOutputPath = path.resolve(cwd, outputPath)
  const indexHtmlPath = path.resolve(resolvedDistDir, "index.html")
  if (!(await fileExists(indexHtmlPath))) {
    throw new Error(`Cannot find ${indexHtmlPath}. Run your build first.`)
  }

  const indexHtmlSource = await fs.readFile(indexHtmlPath, "utf8")
  const scriptSources = parseScriptSources(indexHtmlSource)
  const entryNodes = []

  for (const scriptSrc of scriptSources) {
    const normalized = normalizeChunkPath(
      scriptSrc,
      path.resolve(resolvedDistDir, "index.html"),
      resolvedDistDir,
    )
    if (normalized) entryNodes.push(normalized)
  }

  if (entryNodes.length === 0) {
    throw new Error("No JS entry chunks found in dist/index.html")
  }

  const queue = [...new Set(entryNodes)]
  const visited = new Set()
  const edges = []
  const edgeSet = new Set()
  const nodeData = new Map()

  while (queue.length > 0) {
    const currentFile = queue.shift()
    if (visited.has(currentFile)) continue
    visited.add(currentFile)

    if (!(await fileExists(currentFile))) continue

    const stat = await fs.stat(currentFile)
    nodeData.set(currentFile, {
      label: shortChunkName(currentFile, resolvedDistDir),
      size: formatBytes(stat.size),
      bytes: stat.size,
      isEntry: entryNodes.includes(currentFile),
    })

    const jsSource = await fs.readFile(currentFile, "utf8")
    const imports = extractImports(jsSource)

    for (const specifier of imports) {
      const normalized = normalizeChunkPath(specifier, currentFile, resolvedDistDir)
      if (!normalized) continue
      const edgeKey = `${currentFile} -> ${normalized}`
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey)
        edges.push({ from: currentFile, to: normalized })
      }
      if (!visited.has(normalized)) queue.push(normalized)
    }
  }

  const html = buildHtml({
    distDir: resolvedDistDir,
    entryNodes,
    nodeData,
    edges,
  })
  await fs.writeFile(resolvedOutputPath, html, "utf8")

  return {
    outputPath: resolvedOutputPath,
    chunks: nodeData.size,
    edges: edges.length,
    entries: entryNodes.length,
  }
}
