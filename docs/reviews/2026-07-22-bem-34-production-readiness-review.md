# BEM-34 — Production Readiness: Lab Review

**Date:** 2026-07-22
**Branch:** `BEM-34` (base: `master`)
**Reviewer:** Implementation walkthrough of the completed production-readiness work
**Related docs:** [design spec](../superpowers/specs/2026-07-12-bem-34-production-readiness-design.md) · [implementation plan](../superpowers/plans/2026-07-12-bem-34-production-readiness.md)

---

## 1. Purpose of this document

This review walks through **every step** taken to move the Media Library API from a
local-only project to a production-ready service, maps each step to the lab's evaluation
criteria, records the verification evidence, and calls out the deviations from the literal
lab brief (the repo is TypeScript, not JavaScript) and the judgement calls made along the
way.

It is meant to be read top-to-bottom as the story of the branch, and also used as a
checklist for graders: each requirement links to the file that satisfies it and the test
that proves it.

---

## 2. Starting point

Before this branch, the API was a well-layered Express 5 + Mongoose 9 + Zod service written
in **TypeScript** and run with `tsx` in development. It had:

- A clean `routes → controllers → services → repositories` layering.
- A pure Express **app factory** (`src/app.ts`) with **no** port binding or DB connection —
  both lived only in `src/server.ts`. (This is what made Supertest testing straightforward.)
- Three previously-identified bugs already fixed (see
  [REVIEW-FINDINGS.md](../../REVIEW-FINDINGS.md)): a `req.query` reassignment crash, a
  tags-wiped-on-update bug, and a `$text`-inside-`$or` search error.

It had **no** automated tests, no environment validation, `console.*` logging, no health
endpoint, no CI, and no deployment configuration. Those seven gaps are exactly what this
lab required us to close.

### Deviation from the lab brief

The lab text assumes a JavaScript project (`src/app.js`, plain Jest). This repository is
TypeScript, so two adaptations were made and are reflected throughout:

1. Tests are `.ts` run through **Jest + ts-jest**; the in-memory database is
   **`mongodb-memory-server`**.
2. `vercel.json` targets a TypeScript serverless entry via **`@vercel/node`**, not
   `src/app.js`.

The three "confirmed bugs" were **not** re-fixed — instead the integration tests act as
**regression tests** that lock the fixed behaviour in.

---

## 3. Step-by-step walkthrough

Each subsection below corresponds to one task/commit on the branch, in order. All commands
were run on Node v22 (CI pins Node 20).

### Step 1 — Test infrastructure (`chore: add jest + ts-jest test infrastructure`)

**What was done**

- Installed dev dependencies: `jest`, `ts-jest`, `@types/jest`, `supertest`,
  `@types/supertest`, `mongodb-memory-server`.
- Added scripts to `package.json`:
  - `test`: `jest --runInBand --forceExit`
  - `test:coverage`: `jest --coverage --runInBand --forceExit`
  - `test:watch`: `jest --watch`
- Created `jest.config.js` — `ts-jest` preset, `node` environment, `setupFilesAfterEnv`
  wired to `src/tests/setup.ts`, `collectCoverageFrom` covering `src/**/*.ts` (excluding
  `types`, `server.ts`, and the tests themselves), and an **80% statements/lines coverage
  threshold** scoped to `src/services/**` and `src/middlewares/**`.
- Created `src/tests/setup.ts` — boots one `MongoMemoryServer` for the whole run, sets
  `NODE_ENV=test`/`LOG_LEVEL=error`, points `MONGODB_URI` at the in-memory instance, clears
  every collection after each test, and disconnects + stops the server at the end.
- Created `src/tests/helpers.ts` — `makePngBuffer()`, a minimal valid 1×1 PNG for upload
  tests.

**Why it matters:** tests use the in-memory database **exclusively**, so development and
Atlas data are never touched. The live Atlas credential in `.env` is never read by tests.

**Verified:** a temporary sanity test confirmed the whole stack (Jest + ts-jest + in-memory
Mongo) connects (`readyState === 1`), then was deleted before commit.

### Step 2 — Unit tests: AppError & catchAsync (`test: add unit tests for AppError and catchAsync`)

- `src/tests/unit/AppError.test.ts` — verifies `message`, `statusCode`,
  `isOperational === true`, and that it remains an `instanceof Error`/`AppError` after TS
  transpilation.
- `src/tests/unit/catchAsync.test.ts` — a rejected async handler forwards to `next(err)`; a
  resolved handler does not call `next`.

**Verified:** 5 tests pass.

### Step 3 — Unit tests: validate middleware (`test: add unit tests for validate middleware`)

- `src/tests/unit/validate.test.ts` — valid input calls `next()` and exposes parsed data on
  the request target; invalid input responds `400` with the structured
  `{ status: 'error', message: 'Validation failed', details: [...] }` envelope and does
  **not** call `next`.

**Verified:** 2 tests pass.

### Step 4 — Unit tests: mediaService (`test: add unit tests for mediaService pagination and logic`)

- `src/tests/unit/mediaService.test.ts` — the repository is fully **mocked** (`jest.mock`)
  so these tests isolate the service's own logic:
  - `getAllMedia` passes pagination metadata (`total/page/limit/totalPages`) straight
    through.
  - `getMediaById` throws a 404 `AppError` on a null lookup and returns the record when
    found.
  - `updateMediaRecord` builds a patch containing **only** provided fields (a title-only
    update omits `tags`), normalises comma-separated tags, and 404s on a missing record.

**Judgement call (deviation from plan):** the plan's version of this test failed because
`jest.mock` state leaked between tests — `mock.calls[0]` referred to an earlier test's
call, so `patch.tags` read `undefined`. Fixed by adding `beforeEach(() =>
jest.clearAllMocks())`. The assertions were **not** weakened; only the mock-state leak was
corrected.

**Verified:** 6 tests pass.

### Step 5 — Integration tests (`test: add supertest integration tests for all media endpoints`)

`src/tests/integration/media.test.ts` drives the **real** Express + Mongoose stack via
Supertest against the in-memory database. Covers all five endpoints plus the three
regression cases:

| Endpoint | Cases |
|---|---|
| `POST /media` | 201 valid upload · 400 missing title · 400 unsupported type · 400 oversized file (Multer `LIMIT_FILE_SIZE`) · 400 extension/type mismatch |
| `GET /media` | 200 + pagination metadata (**regression: no 500**) · category filter · `?search=` (**regression: search works**) |
| `GET /media/:id` | 200 valid id · 404 unknown id · 400 malformed id (Mongoose `CastError`) |
| `PUT /media/:id` | 200 update · **title-only update preserves tags (regression)** · 400 empty body |
| `DELETE /media/:id` | 200 delete (+ confirms subsequent 404) · 404 unknown id |

**Judgement call (deviation from plan):** the initial coverage run left `src/middlewares/`
at 77% — below the 80% floor — because the `errorHandler` Multer/Mongoose branches were
never exercised. As the plan anticipated, three error-path cases were added (oversized file,
extension/type mismatch, malformed ObjectId), lifting middleware coverage over the
threshold.

**Verified:** 13 integration tests pass; all three regressions green (i.e. the prior bug
fixes hold).

### Step 6 — Environment configuration (`feat: environment config via dotenv-flow with startup validation`)

- Installed `dotenv-flow`.
- `src/config/env.ts` exposes:
  - `validateEnv(env)` — a **pure** function returning a list of missing-variable messages
    (empty = valid). Required: `NODE_ENV`, `PORT`, `MAX_FILE_SIZE_MB`, `UPLOAD_DIR`,
    `LOG_LEVEL`, and a Mongo URI (`MONGODB_URI` **or** `MONGODB_ATLAS_URI` — the app's
    Atlas-preferred logic is preserved). Kept pure so it is unit-testable.
  - `loadEnv()` (default export) — loads the correct `.env.<NODE_ENV>` via `dotenv-flow`,
    validates, and **exits the process with code 1** printing every problem if anything is
    missing. Wired as the very first call in `src/server.ts`.
- Created `.env.development`, `.env.test`, `.env.production` (production holds
  **placeholders only** — real values go in the Vercel dashboard).
- Rewrote `.env.example` to document every variable (incl. `JWT_SECRET`, reserved/optional
  since the API has no auth).
- Updated `.gitignore` to ignore `.env` and `.env.*` while keeping `!.env.example`.
- `src/tests/unit/env.test.ts` covers: all-present → no errors; `MONGODB_ATLAS_URI` accepted
  in place of `MONGODB_URI`; missing Mongo URI reported; each missing simple var reported.

**Security-critical verification:** `git check-ignore` confirmed `.env`, `.env.development`,
`.env.test`, and `.env.production` are all ignored, and `.env.example` is **not** — so the
live Atlas credential in `.env` can never be staged.

**Verified:** 4 env tests pass; full suite (33) green; build clean.

### Step 7 — Structured logging with Winston (`feat: structured logging with winston`)

- Installed `winston`.
- `src/config/logger.ts` — one shared Winston logger. Level from `LOG_LEVEL` (default
  `info`). **Development:** colorized, timestamped, human-readable lines. **Production
  (`NODE_ENV=production`):** structured JSON for log aggregators.
- Replaced **every** `console.*` call across the source with the logger:
  - `server.ts` — server started (info), unhandled rejection (error), uncaught exception
    (error), graceful-shutdown messages (info/error), startup failure (error), missing-`.env`
    warning (warn).
  - `config/db.ts` — connection success (info).
  - `middlewares/logger.ts` — per-request line (info).
  - `middlewares/errorHandler.ts` — **4xx logged at `warn`, 5xx at `error`** (operational vs
    real failures), stack only in development.
  - `services/mediaService.ts` — file-uploaded (info), file-delete failure (warn).
  - `utils/removeUploadedFile.ts` — cleanup failure (warn).
- The **only** remaining `console.*` is in `env.ts`, intentionally: it runs during
  pre-startup validation, before the logger config is trusted.

**Verified:** a `grep` for `console.` across `src` (excluding tests and `env.ts`) returns
nothing; logger unit test passes; build clean; full suite (35) green. A useful side effect:
routing 4xx through `logger.warn` at `LOG_LEVEL=error` silenced the noisy expected-error
output during test runs.

### Step 8 — Health endpoint (`feat: add GET /health endpoint`)

- Added `GET /health` to `src/app.ts` (right after the existing `GET /` service-info route)
  → `200 { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() }`.
  It does **not** touch the database, so monitors can check liveness cheaply.
- `src/tests/integration/health.test.ts` asserts 200, `status === 'ok'`, numeric `uptime`,
  and a valid ISO `timestamp`.

**Verified:** written test-first (failed 404 before the route existed, passed after) — 1
test passes.

### Step 9 — CI pipeline (`ci: add GitHub Actions test pipeline`)

- `.github/workflows/ci.yml` runs on push/PR to `master`: checkout → `setup-node@v4`
  (Node 20, npm cache) → `npm ci` → `npm run build` (typecheck) → `npm run test:coverage`
  (with test env vars set) → **upload the `coverage/` directory as a workflow artifact**
  (the lab's bonus).
- CI needs **no external database** — tests self-provision Mongo via
  `mongodb-memory-server`.

**Verified:** YAML parses locally. (GitHub validates fully on push.)

### Step 10 — Vercel deployment config + docs (`feat: add vercel deployment config and deployment docs`)

- `api/index.ts` — the serverless entry. Unlike `server.ts` it **never** calls
  `app.listen()`; Vercel invokes the exported Express app directly. The DB connection is
  established **lazily on the first request** and cached across warm invocations.
- `vercel.json` — `version: 2`, `@vercel/node` building `api/index.ts`, all routes → that
  entry.
- `DEPLOYMENT.md` — prerequisites, the production env-var table for the Vercel dashboard,
  deploy/verify steps, the **ephemeral-filesystem limitation**, and the production fix
  (offload uploads to **AWS S3** or **Cloudinary**, store the returned URL instead of a
  local path).

**Judgement call (deviation from plan):** including `api/**/*` in `tsconfig.json` triggered
`TS6059: not under rootDir 'src'`. Following the plan's documented remedy, `"rootDir": "src"`
was removed so `api/` typechecks. That moves compiled output to `dist/src/…` + `dist/api/…`,
so two follow-on fixes were made to keep everything working:
1. `package.json` `main`/`start` updated to `dist/src/server.js`.
2. Tests excluded from the production build (`tsconfig` `exclude: ["…","src/tests/**"]`) so
   `dist/` no longer carries test files. (ts-jest transpiles per-file and ignores this, so
   tests still run.)

A later small commit (`chore: ignore compiled api/*.js…`) added `api/*.js` to `.gitignore`
so a stray compiled entry can't be committed next to `api/index.ts`.

**Verified:** build clean (`dist/src/server.js` present, tests excluded); full suite (36)
green.

### Step 11 — Postman collection + environments (`docs: add postman collection and environments`)

- `postman/media-library-api.postman_collection.json` — all five endpoints, each with test
  scripts asserting status code, the `status`/`data` envelope, and required fields. `POST`
  captures `MEDIA_ID` into the environment so the subsequent GET/PUT/DELETE chain against
  the created record.
- `postman/development.postman_environment.json` (`BASE_URL=http://localhost:3000`) and
  `postman/production.postman_environment.json` (Vercel URL placeholder), both using
  `{{BASE_URL}}` and `{{MEDIA_ID}}`.

**Verified:** all three JSON files parse.

### Step 12 — Final verification + README (`docs: document production-readiness features in README`)

- Ran the full coverage suite and build one final time (both clean).
- Appended a **"Production Readiness (BEM-34)"** section to `README.md` pointing at tests,
  env config, logging, `/health`, CI, deployment, and Postman.

---

## 4. Final verification evidence

Run on Node v22; CI pins Node 20.

```
Test Suites: 8 passed, 8 total
Tests:       36 passed, 36 total
```

**Coverage (thresholded areas in bold):**

| Area | % Stmts | % Lines | Threshold | Status |
|---|---|---|---|---|
| **`src/services/`** | **94.00** | **97.36** | 80 | ✅ pass |
| **`src/middlewares/`** | **82.41** | **84.09** | 80 | ✅ pass |
| `src/utils/` | 94.44 | 94.11 | — | — |
| `src/repositories/` | 87.87 | 88.88 | — | — |
| All files | 84.91 | 85.66 | — | — |

- `npm run build` → exit 0 (clean typecheck, `dist/src/server.js` emitted).
- `git status` → clean working tree.
- No `.env*` secret files staged; `.env.example` tracked.

**Test count by file:**

| File | Tests |
|---|---|
| `unit/AppError.test.ts` | 3 |
| `unit/catchAsync.test.ts` | 2 |
| `unit/validate.test.ts` | 2 |
| `unit/mediaService.test.ts` | 6 |
| `unit/env.test.ts` | 4 |
| `unit/logger.test.ts` | 2 |
| `integration/media.test.ts` | 16 |
| `integration/health.test.ts` | 1 |
| **Total** | **36** |

---

## 5. Requirements → evaluation-criteria coverage

| Lab criterion (weight) | Delivered | Evidence |
|---|---|---|
| **Postman Collection (15%)** | 5 endpoints, status + structure + field assertions, `{{BASE_URL}}`/`{{MEDIA_ID}}`, Development + Production environments | `postman/` |
| **Unit Tests (20%)** | `mediaService` (pagination + logic), `validate`, `catchAsync`, `AppError` (+ `env`, `logger`) | `src/tests/unit/` (19 tests) |
| **Integration Tests (20%)** | All five endpoints via Supertest against in-memory Mongo; separate/in-memory DB; ≥80% on services + middleware | `src/tests/integration/` (17 tests) |
| **Environment Config (15%)** | `dotenv-flow`, separate `.env.*` files, `.env.example`, startup validation that exits on missing vars | `src/config/env.ts`, `.env.example` |
| **Git Workflow & CI/CD (15%)** | Clean grouped Conventional Commits on a feature branch; GitHub Actions builds, tests, uploads coverage artifact | branch history, `.github/workflows/ci.yml` |
| **Deployment & Logging (15%)** | Winston structured logging (level from `LOG_LEVEL`), `GET /health`, Vercel config + serverless entry + `DEPLOYMENT.md` | `src/config/logger.ts`, `src/app.ts`, `vercel.json`, `api/index.ts`, `DEPLOYMENT.md` |

**Required logged events (all present):** server started (info), incoming request (info),
file uploaded (info), validation error (warn), resource not found (warn), unhandled global
error (error), promise rejection (error).

---

## 6. Deviations & judgement calls (summary)

1. **TypeScript, not JavaScript** — tests are ts-jest; Vercel entry is a TS `@vercel/node`
   handler. (Established in the design spec.)
2. **Mock-state leak fix** — added `jest.clearAllMocks()` in the mediaService unit test so
   per-test call assertions read the current test's invocation. Assertions unchanged.
3. **Extra error-path integration tests** — oversized file, extension/type mismatch,
   malformed id — added to clear the 80% middleware coverage floor (anticipated by the plan).
4. **`rootDir` removed for Vercel** — output moved to `dist/src/…`, so `main`/`start` were
   repointed to `dist/src/server.js`, tests were excluded from the production build, and
   `api/*.js` was gitignored.

None of these changed the API's runtime behaviour or the response envelopes.

---

## 7. Out of scope (documented, not implemented)

- **Actual Vercel deploy** — requires the user's authenticated CLI/account.
- **Authentication / JWT** — none exists in the API; `JWT_SECRET` is reserved in
  `.env.example` only.
- **Real cloud storage (S3/Cloudinary)** — documented in `DEPLOYMENT.md` as the production
  path for the ephemeral-filesystem limitation, not implemented.
- **Uptime monitoring setup** — bonus; documented (point UptimeRobot / Better Uptime /
  Vercel Analytics at `GET /health`).

---

## 8. Follow-ups worth considering (non-blocking)

- **`errorHandler.ts` branch coverage (48%)** — several mapping branches (duplicate-key 409,
  Mongoose `ValidationError`, `headersSent`) are still unexercised. Statements/lines clear
  the gate, but targeted tests would harden the least-tested file in the middleware layer.
- **`db.ts` is 0%** — deliberately: tests use `mongoose.connect` directly in `setup.ts` and
  never import `connectDB`. A tiny test covering the "no URI configured" throw would remove
  the blind spot.
- **Pre-existing lint warnings** — `node:` import prefixes, `String#replaceAll`, and the
  Express version-disclosure hint were left untouched to stay within scope; worth a separate
  cleanup pass.
