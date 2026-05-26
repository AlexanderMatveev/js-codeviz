import { promises as fs } from "node:fs"
import path from "node:path"
import ts from "typescript"

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]
const SOURCE_EXTENSIONS_SET = new Set(SOURCE_EXTENSIONS)

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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function walkFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(nextPath)))
      continue
    }
    const ext = path.extname(nextPath).toLowerCase()
    if (SOURCE_EXTENSIONS_SET.has(ext)) {
      files.push(path.normalize(nextPath))
    }
  }
  return files
}

function pickTsconfigPath(projectRoot) {
  const preferred = ["tsconfig.app.json", "tsconfig.json"]
  for (const filename of preferred) {
    const found = ts.findConfigFile(projectRoot, ts.sys.fileExists, filename)
    if (found) return found
  }
  return null
}

function loadTsCompilerOptions(projectRoot) {
  const tsconfigPath = pickTsconfigPath(projectRoot)
  if (!tsconfigPath) {
    throw new Error("Cannot find tsconfig.app.json or tsconfig.json in project root")
  }

  const readResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (readResult.error) {
    throw new Error(
      ts.formatDiagnostic(readResult.error, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => projectRoot,
        getNewLine: () => "\n",
      }),
    )
  }

  const parsed = ts.parseJsonConfigFileContent(
    readResult.config,
    ts.sys,
    path.dirname(tsconfigPath),
  )

  return {
    options: parsed.options,
    host: ts.createCompilerHost(parsed.options, true),
  }
}

function relativeFromRoot(absPath, rootDir) {
  return path.relative(rootDir, absPath).replaceAll(path.sep, "/")
}

function isLocalDynamicImportSpecifier(specifier) {
  return specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("@/")
}

function resolveImportToFile(specifier, fromFile, resolver, projectRoot) {
  const result = ts.resolveModuleName(specifier, fromFile, resolver.options, resolver.host)

  const resolvedPath = result.resolvedModule?.resolvedFileName
  if (!resolvedPath) return null

  const normalized = path.normalize(resolvedPath)
  if (normalized.includes(`${path.sep}node_modules${path.sep}`)) return null
  if (!normalized.startsWith(projectRoot)) return null

  return normalized
}

function collectDynamicImports(filePath, sourceText) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  const imports = []

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      imports.push({
        specifier: node.arguments[0].text,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return imports
}

function collectStaticImports(filePath, sourceText) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  const imports = []

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text)
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return imports
}

function buildVisPayload({ nodes, nodeData, edges }) {
  const allBytes = nodes.map((node) => nodeData.get(node)?.bytes ?? 0).filter((bytes) => bytes > 0)
  const minBytes = allBytes.length > 0 ? Math.min(...allBytes) : 1
  const maxBytes = allBytes.length > 0 ? Math.max(...allBytes) : 1
  const minLog = Math.log10(minBytes + 1)
  const maxLog = Math.log10(maxBytes + 1)

  function dotSizeByBytes(bytes, isCaller) {
    if (minLog === maxLog) return isCaller ? 28 : 20
    const normalized = (Math.log10(Math.max(1, bytes) + 1) - minLog) / (maxLog - minLog)
    const base = 14 + normalized * 24
    return isCaller ? Math.min(42, base + 4) : base
  }

  const visNodes = nodes.map((node) => {
    const info = nodeData.get(node)
    const isCaller = info.outgoingCount > 0
    const baseSize = dotSizeByBytes(info.bytes, isCaller)
    const nodeSize = info.isEntry ? Math.min(48, baseSize + 6) : baseSize
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
        : isCaller
          ? {
              background: "#1f8f6a",
              border: "#34d399",
              highlight: { background: "#22a87b", border: "#7cf5cb" },
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

  const visEdges = edges.map((edge) =>
    edge.kind === "bootstrap"
      ? {
          from: edge.from,
          to: edge.to,
          arrows: "to",
          color: { color: "#d2a765", highlight: "#f1c887" },
          width: 1.4,
          dashes: true,
          title: "entry bootstrap path",
        }
      : {
          from: edge.from,
          to: edge.to,
          arrows: "to",
          color: { color: "#6b7fa8", highlight: "#9fb6e3" },
          width: 1.2,
          title: `line ${edge.line}`,
        },
  )

  return { visNodes, visEdges }
}

function buildHtml({ projectRoot, srcRoot, nodeData, edges }) {
  const nodes = Array.from(nodeData.keys())
  const { visNodes, visEdges } = buildVisPayload({ nodes, nodeData, edges })
  const entryNodes = nodes
    .filter((node) => nodeData.get(node).isEntry)
    .map((node) => nodeData.get(node).label)
    .sort((a, b) => a.localeCompare(b))

  const sortedRows = edges.slice().sort((a, b) => {
    const aFrom = nodeData.get(a.from).label
    const bFrom = nodeData.get(b.from).label
    if (aFrom !== bFrom) return aFrom.localeCompare(bFrom)
    const aTo = nodeData.get(a.to).label
    const bTo = nodeData.get(b.to).label
    return aTo.localeCompare(bTo)
  })

  const rowsHtml = sortedRows
    .map((edge) => {
      const from = nodeData.get(edge.from).label
      const to = nodeData.get(edge.to).label
      const kindLabel = edge.kind === "bootstrap" ? "bootstrap" : "lazy"
      const locationLabel = edge.kind === "bootstrap" ? "entry reachability" : `line ${edge.line}`
      return `<tr>
  <td><code>${escapeHtml(from)}</code></td>
  <td><code>${escapeHtml(to)}</code></td>
  <td>${kindLabel} (${locationLabel})</td>
</tr>`
    })
    .join("\n")

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lazy import graph (vis-network)</title>
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
  <h1>Lazy import graph from source (vis-network)</h1>
  <div class="meta">
    root: <code>${escapeHtml(projectRoot)}</code> |
    src: <code>${escapeHtml(srcRoot)}</code> |
    entries: ${entryNodes.length} |
    nodes: ${nodes.length} |
    lazy edges: ${edges.length}
  </div>
  ${
    entryNodes.length > 0
      ? `<div class="meta">entrypoints: ${entryNodes
          .map((entry) => `<code>${escapeHtml(entry)}</code>`)
          .join(", ")}</div>`
      : ""
  }

  <div class="graph-shell">
    <div class="graph-body">
      <div id="lazyGraph" style="width:100%;height:100%"></div>
    </div>
  </div>

  <div class="table-shell">
    <table>
      <thead>
        <tr>
          <th style="width:42%">From</th>
          <th style="width:42%">To</th>
          <th>Kind</th>
        </tr>
      </thead>
      <tbody>
${rowsHtml || "<tr><td colspan='3'>No lazy imports detected.</td></tr>"}
      </tbody>
    </table>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
  <script>
    const nodes = new vis.DataSet(${JSON.stringify(visNodes)});
    const edges = new vis.DataSet(${JSON.stringify(visEdges)});
    const container = document.getElementById("lazyGraph");

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
            iterations: 70,
            updateInterval: 30,
            fit: true
          },
          barnesHut: {
            gravitationalConstant: -3400,
            centralGravity: 0.22,
            springLength: 125,
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
      network.fit({ animation: { duration: 320, easingFunction: "easeOutCubic" } });
    });
  </script>
</body>
</html>`
}

export async function buildLazyGraph({
  projectRoot = ".",
  srcDir = "src",
  outputPath = "lazy-graph.html",
  cwd = process.cwd(),
} = {}) {
  const resolvedProjectRoot = path.resolve(cwd, projectRoot)
  const srcRoot = path.resolve(resolvedProjectRoot, srcDir)
  const resolvedOutputPath = path.resolve(cwd, outputPath)
  if (!(await fileExists(srcRoot))) {
    throw new Error(`Cannot find source directory: ${srcRoot}`)
  }

  const resolver = loadTsCompilerOptions(resolvedProjectRoot)
  const sourceFiles = await walkFiles(srcRoot)
  const indexHtmlPath = path.resolve(resolvedProjectRoot, "index.html")
  const nodeData = new Map()
  const edges = []
  const edgeSet = new Set()
  const staticAdjacency = new Map()

  async function ensureNode(filePath) {
    if (nodeData.has(filePath)) return
    const stat = await fs.stat(filePath)
    nodeData.set(filePath, {
      label: relativeFromRoot(filePath, resolvedProjectRoot),
      size: formatBytes(stat.size),
      bytes: stat.size,
      outgoingCount: 0,
      isEntry: false,
    })
  }

  if (await fileExists(indexHtmlPath)) {
    const indexHtmlSource = await fs.readFile(indexHtmlPath, "utf8")
    const scriptSources = parseScriptSources(indexHtmlSource)
    const srcWebPrefix = `/${srcDir
      .replace(/^[./]+/, "")
      .replaceAll("\\", "/")
      .replace(/\/+$/, "")}/`
    for (const scriptSrc of scriptSources) {
      if (!scriptSrc.startsWith(srcWebPrefix)) continue
      const entryFile = path.normalize(path.resolve(resolvedProjectRoot, `.${scriptSrc}`))
      if (!(await fileExists(entryFile))) continue
      const ext = path.extname(entryFile).toLowerCase()
      if (!SOURCE_EXTENSIONS_SET.has(ext)) continue
      await ensureNode(entryFile)
      nodeData.get(entryFile).isEntry = true
    }
  }

  for (const filePath of sourceFiles) {
    const sourceText = await fs.readFile(filePath, "utf8")
    const imports = collectDynamicImports(filePath, sourceText)
    const staticImports = collectStaticImports(filePath, sourceText)

    for (const specifier of staticImports) {
      if (!isLocalDynamicImportSpecifier(specifier)) continue
      const resolvedStatic = resolveImportToFile(specifier, filePath, resolver, resolvedProjectRoot)
      if (!resolvedStatic) continue
      if (!SOURCE_EXTENSIONS_SET.has(path.extname(resolvedStatic).toLowerCase())) continue
      if (!staticAdjacency.has(filePath)) staticAdjacency.set(filePath, new Set())
      staticAdjacency.get(filePath).add(resolvedStatic)
    }

    for (const item of imports) {
      if (!isLocalDynamicImportSpecifier(item.specifier)) continue
      const resolved = resolveImportToFile(item.specifier, filePath, resolver, resolvedProjectRoot)
      if (!resolved) continue
      if (!SOURCE_EXTENSIONS_SET.has(path.extname(resolved).toLowerCase())) continue

      await ensureNode(filePath)
      await ensureNode(resolved)

      const edgeKey = `${filePath} -> ${resolved} @ ${item.line}`
      if (edgeSet.has(edgeKey)) continue
      edgeSet.add(edgeKey)
      edges.push({ from: filePath, to: resolved, line: item.line, kind: "lazy" })
      nodeData.get(filePath).outgoingCount += 1
    }
  }

  const entryFiles = Array.from(nodeData.entries())
    .filter(([, info]) => info.isEntry)
    .map(([filePath]) => filePath)
  const lazyInitiators = Array.from(nodeData.entries())
    .filter(([, info]) => info.outgoingCount > 0)
    .map(([filePath]) => filePath)

  for (const entryFile of entryFiles) {
    const queue = [entryFile]
    const visited = new Set([entryFile])

    while (queue.length > 0) {
      const current = queue.shift()
      const neighbors = Array.from(staticAdjacency.get(current) || [])
      for (const next of neighbors) {
        if (visited.has(next)) continue
        visited.add(next)
        queue.push(next)
      }
    }

    for (const initiator of lazyInitiators) {
      if (initiator === entryFile) continue
      if (!visited.has(initiator)) continue
      const bootstrapKey = `${entryFile} -> ${initiator} @ bootstrap`
      if (edgeSet.has(bootstrapKey)) continue
      edgeSet.add(bootstrapKey)
      edges.push({ from: entryFile, to: initiator, line: 0, kind: "bootstrap" })
    }
  }

  const html = buildHtml({
    projectRoot: resolvedProjectRoot,
    srcRoot,
    nodeData,
    edges,
  })
  await fs.writeFile(resolvedOutputPath, html, "utf8")

  return {
    outputPath: resolvedOutputPath,
    nodes: nodeData.size,
    edges: edges.length,
  }
}
