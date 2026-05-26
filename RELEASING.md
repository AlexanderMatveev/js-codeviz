# Releasing `js-codeviz`

## One-time setup

1. Update npm metadata in `package.json`:
   - `repository.url`
   - `homepage`
   - `bugs.url`
   - `author`
2. Create npm granular access token with publish rights.
3. Add GitHub repository secret:
   - name: `NPM_TOKEN`
   - value: npm token from step 2
4. Login to npm locally (optional, for manual publish fallback):
   - `npm login`

## Publish flow (GitHub Release -> npm + GitHub Packages)

1. Bump version:
   - `npm version patch` (or `minor` / `major`)
2. Run publish checks:
   - `npm run prepublishOnly`
3. Push commits and tags:
   - `git push && git push --tags`
4. Create GitHub Release from the new tag.
5. GitHub Actions workflow publishes automatically:
   - npmjs: `js-codeviz`
   - GitHub Packages: `@alexandermatveev/js-codeviz`

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
2. Check GitHub Packages page in repository.
3. Smoke test in another project:
   - `npx js-codeviz --help`
   - `npx js-codeviz chunk-graph --dist dist --out chunk-graph.html`
   - `npx js-codeviz lazy-graph --project-root . --src src --out lazy-graph.html`
