# js-codeviz

Reusable CLI and library for generating two HTML reports:

- chunk dependency graph from built JS chunks (`chunk-graph.html`)
- lazy import graph from source (`lazy-graph.html`)

## Install

```bash
npm i -D js-codeviz
```

## Use in `package.json`

```json
{
  "scripts": {
    "build:chunk-graph": "codeviz-build-chunk-graph --dist dist --out chunk-graph.html",
    "build:lazy-graph": "codeviz-build-lazy-graph --project-root . --src src --out lazy-graph.html"
  }
}
```

## Single CLI

```bash
npx js-codeviz chunk-graph --dist dist --out chunk-graph.html
npx js-codeviz lazy-graph --project-root . --src src --out lazy-graph.html
```

## Programmatic API

```js
import { buildChunkGraph, buildLazyGraph } from "js-codeviz"

await buildChunkGraph({
  distDir: "dist",
  outputPath: "chunk-graph.html",
})

await buildLazyGraph({
  projectRoot: ".",
  srcDir: "src",
  outputPath: "lazy-graph.html",
})
```

## Notes

- `chunk-graph` expects `dist/index.html` with `<script src="...">` entries.
- `lazy-graph` uses TypeScript module resolution and requires `tsconfig.app.json` or `tsconfig.json`.
