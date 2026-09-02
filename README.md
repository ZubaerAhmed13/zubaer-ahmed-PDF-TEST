# DocFlow Professional

DocFlow is a local-first browser PDF workspace. The `professional-upgrade` branch is a safe migration from the previous monolithic deployment to a modular TypeScript/Vite architecture.

## Current migration status

This branch is **not yet a production release**. Core structural operations have been migrated, while compression quality, large-document memory certification, forms breadth, browser certification and complete feature parity remain release gates.

The previous root application is preserved at `legacy/index.html` on the migration branch and remains recoverable from git history. Production `main` should not be replaced until `RELEASE_CHECKLIST.md` is satisfied.

## Development

```bash
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

On the first CI run only, if `package-lock.json` is not yet present, the migration workflow runs `npm install` and commits the generated lockfile. Subsequent CI runs use `npm ci`.

## Architecture

- TypeScript + Vite
- central tool registry
- lazy-loaded tool workspace
- PDF.js worker-backed page rendering
- dedicated module worker for pdf-lib processing
- deterministic operation inputs/options
- cancellable worker operations by worker termination
- local preferences only for favorites/recent tools
- PWA runtime cache with nested GitHub Pages scope
- no remote PDF-processing API or analytics dependency

See `ARCHITECTURE.md`, `SECURITY.md`, `PRIVACY.md`, `TESTING.md` and `RELEASE_CHECKLIST.md`.

## GitHub Pages

Vite base path is explicitly configured for:

`/zubaer-ahmed-PDF-TEST/`

The canonical production URL remains:

`https://zubaerahmed13.github.io/zubaer-ahmed-PDF-TEST/`
