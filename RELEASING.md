# Releasing `js-codeviz`

## One-time setup

1. Update npm metadata in `package.json`:
   - `repository.url`
   - `homepage`
   - `bugs.url`
   - `author`
2. Login to npm:
   - `npm login`

## Publish flow

1. Bump version:
   - `npm version patch` (or `minor` / `major`)
2. Run publish checks:
   - `npm run prepublishOnly`
3. Publish:
   - `npm publish`

## Verify after publish

1. Check package page:
   - `https://www.npmjs.com/package/js-codeviz`
2. Smoke test in another project:
   - `npx js-codeviz --help`
   - `npx js-codeviz chunk-graph --dist dist --out chunk-graph.html`
   - `npx js-codeviz lazy-graph --project-root . --src src --out lazy-graph.html`
