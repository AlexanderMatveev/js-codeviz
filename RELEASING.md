# Releasing `js-codeviz`

## One-time setup

1. Update npm metadata in `package.json`:
   - `repository.url`
   - `homepage`
   - `bugs.url`
   - `author`
2. Configure npm Trusted Publishing for GitHub Actions:
   - npm package settings -> Trusted publishers
   - provider: GitHub Actions
   - repository: `AlexanderMatveev/js-codeviz`
   - workflow: `.github/workflows/publish.yml`
3. Login to npm locally (optional, for manual publish fallback):
   - `npm login`

## Publish flow (GitHub Release -> npm)

1. Bump version:
   - `npm version patch` (or `minor` / `major`)
2. Run publish checks:
   - `npm run prepublishOnly`
3. Push commits and tags:
   - `git push && git push --tags`
4. Create GitHub Release from the new tag.
5. GitHub Actions workflow publishes package to npm automatically.

## Manual publish fallback

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
