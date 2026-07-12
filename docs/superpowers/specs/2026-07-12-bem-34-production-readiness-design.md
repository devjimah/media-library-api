# BEM-34 — Production Readiness Design

**Date:** 2026-07-12
**Branch:** `BEM-34`
**Base:** `master`

## Goal

Take the existing Media Library API and prepare it for production: automated tests
(unit + integration), environment configuration with startup validation, structured
logging, a health-check endpoint, a GitHub Actions CI pipeline, Vercel deployment
config, and a Postman collection.

## Context corrections (deviations from the literal lab spec)

The lab text assumes a JavaScript project; this repository is **TypeScript + Express 5 +
Mongoose 9 + Zod**, run with `tsx` in dev and compiled to `dist/` for production. Two
adaptations follow from that:

1. **Tests are TypeScript** (`.ts`) run through **Jest + ts-jest**, not plain Jest over
   `.js`. `vercel.json` targets the app factory via `@vercel/node`, not `src/app.js`.
2. **The three "confirmed bugs" in `REVIEW-FINDINGS.md` are already fixed** (verified in
   the current source: `validate.ts` uses `Object.defineProperty` for `req.query`;
   `mediaSchemas.ts` has separate create/update tags schemas so updates no longer wipe
   tags; `mediaRepository.ts` uses regex-only search, not `$text` inside `$or`). This
   branch therefore does **not** re-fix them — instead the integration tests act as
   **regression tests** that lock the fixed behaviour in.

The app is already well-structured for this work: `app.ts` is a pure Express factory with
no port binding or DB connection (both live only in `server.ts`), so Supertest can import
it directly.

## Architecture / components

### 1. Test infrastructure — Jest + ts-jest

New devDependencies: `jest`, `ts-jest`, `@types/jest`, `supertest`, `@types/supertest`,
`mongodb-memory-server`.

- `jest.config.js` — `ts-jest` preset, `testEnvironment: 'node'`, `runInBand` via script,
  `collectCoverageFrom` covering `src/**/*.ts` excluding `src/types/**`, `src/server.ts`
  (bootstrap), and `src/tests/**`. `coverageThreshold` set to **80%** for
  `src/services/**` and `src/middlewares/**` (statements/lines).
- `src/tests/setup.ts` — global setup/teardown. Starts `mongodb-memory-server`, assigns
  its URI to `MONGODB_URI` **before** any model import, connects Mongoose, clears all
  collections in `afterEach`, disconnects + stops the server in `afterAll`. Registered via
  `setupFilesAfterEnv` in the Jest config so it applies to every test file.
- `package.json` scripts:
  - `"test": "jest --runInBand --forceExit"`
  - `"test:coverage": "jest --coverage --runInBand --forceExit"`
  - `"test:watch": "jest --watch"`

The test DB is exclusively the in-memory server — development/Atlas data is never touched.

### 2. Unit tests — `src/tests/unit/`

- **`mediaService.test.ts`** — repository mocked (`jest.mock`): pagination metadata is
  passed through correctly (`total`, `page`, `limit`, `totalPages`); `getMediaById` throws
  `AppError(404)` on null; `updateMediaRecord` builds a patch containing only provided
  fields (title-only update does **not** set `tags`); tag normalisation from
  comma-string / array / undefined.
- **`validate.test.ts`** — valid input calls `next()` with no args and exposes parsed data
  on the target; invalid input responds `400` with `{status:'error', message, details:[]}`
  and does not call `next()`.
- **`catchAsync.test.ts`** — a handler that rejects calls `next(error)`; a handler that
  resolves does not call `next`.
- **`AppError.test.ts`** — `message`, `statusCode`, `isOperational === true`, and
  `instanceof Error`.

### 3. Integration tests — `src/tests/integration/`

Supertest against the imported `app` factory. `media.test.ts` covers all five endpoints:

- `POST /media` — 201 valid upload (multipart with a small in-memory PNG buffer);
  400 missing title; 400 unsupported file type.
- `GET /media` — 200 with pagination metadata present; category/tags filtering; `?search=`
  works (regression for prior Bug 3); a valid query returns 200 not 500 (regression for
  prior Bug 1).
- `GET /media/:id` — 200 valid id; 404 unknown (valid ObjectId) id.
- `PUT /media/:id` — 200 valid update; **title-only update preserves existing tags**
  (regression for prior Bug 2); 400 empty/invalid body.
- `DELETE /media/:id` — 200 success; 404 unknown id.

### 4. Environment configuration — dotenv-flow + startup validation

- Add `dotenv-flow`.
- `src/config/env.ts` — loads env via `dotenv-flow` (keyed on `NODE_ENV`), then validates
  required variables and **throws a descriptive error and exits (`process.exit(1)`)** if
  any is missing. Required: `NODE_ENV`, `PORT`, a Mongo URI (`MONGODB_URI` or
  `MONGODB_ATLAS_URI` — the app's existing Atlas-preferred logic is preserved),
  `MAX_FILE_SIZE_MB`, `UPLOAD_DIR`, `LOG_LEVEL`. `JWT_SECRET` is listed in `.env.example`
  as reserved/optional (there is no auth in this API) and is **not** required at startup.
- Files: `.env.development`, `.env.test`, `.env.production` (production values as
  placeholders, not real secrets), and an updated `.env.example` documenting every var.
- `.gitignore` updated to ignore `.env*` while keeping `!.env.example`.
- `src/config/env.ts` is imported first in `server.ts` (before `connectDB`) so validation
  runs at startup. Tests set env directly and load the in-memory URI.

### 5. Structured logging — Winston

- Add `winston`.
- `src/config/logger.ts` — a single Winston logger. Level from `LOG_LEVEL` (default
  `info`). In development: colorized, pretty, human-readable. In production
  (`NODE_ENV=production`): JSON. Levels used: `debug`, `info`, `warn`, `error`.
- Replace all `console.*`:
  - `server.ts` — server started (info), unhandled rejection (error), uncaught exception
    (error), shutdown messages (info).
  - `config/db.ts` — connection success (info).
  - `services/mediaService.ts` — file-delete warning (warn); file uploaded (info).
  - `middlewares/logger.ts` — rewrite to log each incoming/finished request via Winston
    (info). Validation errors (warn) and resource-not-found (warn) logged where they occur
    (validate middleware / notFound / errorHandler).

### 6. Health endpoint

- `GET /health` in `app.ts` → `200 { status:'ok', uptime: process.uptime(), timestamp:
  new Date().toISOString() }`. Existing `GET /` service-info route is kept.

### 7. Deployment config + docs (user runs the actual deploy)

- `vercel.json` — version 2, `@vercel/node` building a serverless entry that exports the
  Express `app` (no `listen`). Because `server.ts` is the only place that binds a port,
  the entry re-uses `app.ts` directly. Routes all traffic to the entry.
- `api/index.ts` (or documented entry) — imports the app factory + `connectDB`, connects
  lazily, exports the handler for `@vercel/node`.
- `DEPLOYMENT.md` — steps to set production env vars in the Vercel dashboard; documents the
  **ephemeral filesystem** limitation (uploaded files under `/uploads` do not persist
  across invocations) and the production mitigation: offload storage to **AWS S3** or
  **Cloudinary** and store the returned URL instead of a local path.

### 8. CI — `.github/workflows/ci.yml`

On push and pull_request to `master`: checkout → `actions/setup-node` (Node 20, npm cache)
→ `npm ci` → `npm run build` (compile = typecheck) → `npm test` → upload the coverage
report as a workflow artifact (bonus).

### 9. Postman

- `postman/media-library-api.postman_collection.json` — all five endpoints, each with test
  assertions for status code, response body structure (`status`/`data` or
  `status`/`message`), and required fields. Uses `{{BASE_URL}}` and captures `{{MEDIA_ID}}`
  from the create response for chained requests.
- `postman/development.postman_environment.json` (`BASE_URL=http://localhost:3000`) and
  `postman/production.postman_environment.json` (Vercel URL placeholder).

## Comment convention

Every new function/module gets the codebase's **What / Does / If removed** header block, to
match the existing style.

## Testing strategy

- Unit tests isolate pure logic with mocked collaborators.
- Integration tests exercise the real Express + Mongoose stack against an in-memory Mongo.
- `npm run build` in CI provides type-level verification.
- Coverage gate at 80% for services + middleware.

## Commit plan (grouped, Conventional Commits, on `BEM-34`)

1. `chore: add jest + ts-jest test infrastructure`
2. `test: add unit tests for service, validate, catchAsync, AppError`
3. `test: add supertest integration tests for all media endpoints`
4. `feat: environment config via dotenv-flow with startup validation`
5. `feat: structured logging with winston`
6. `feat: add GET /health endpoint`
7. `ci: add GitHub Actions test pipeline`
8. `feat: add vercel deployment config and deployment docs`
9. `docs: add postman collection and environments`

## Out of scope

- Actual Vercel deploy (needs the user's authenticated CLI/account).
- Authentication / JWT (none exists in the API; `JWT_SECRET` reserved only).
- Real cloud storage integration (documented as the production path, not implemented).
- Uptime monitoring setup (bonus; documented in `DEPLOYMENT.md`).
