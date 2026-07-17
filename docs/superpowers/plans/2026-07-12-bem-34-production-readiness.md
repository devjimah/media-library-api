# BEM-34 Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the TypeScript Media Library API for production with a Jest/Supertest test suite, environment configuration + startup validation, Winston structured logging, a `/health` endpoint, a GitHub Actions CI pipeline, Vercel deployment config, and a Postman collection.

**Architecture:** The app is a clean Express 5 factory (`src/app.ts`, no port binding) over Mongoose 9 + Zod, with a routes → controllers → services → repositories layering. Tests import the `app` factory directly and run against an in-memory MongoDB (`mongodb-memory-server`). Logging moves from `console.*` to a single shared Winston logger. Environment loading moves to `dotenv-flow` with a fail-fast validator invoked at startup.

**Tech Stack:** TypeScript 5.9, Express 5, Mongoose 9, Zod 3, Multer 2, Jest + ts-jest, Supertest, mongodb-memory-server, Winston, dotenv-flow, GitHub Actions, Vercel.

## Global Constraints

- **Runtime:** Node 20+ (dev machine is v22; CI pins Node 20). Verified with `node -v`.
- **Language:** All source and tests are TypeScript (`.ts`). No `.js` source files.
- **Module system:** CommonJS (`tsconfig.json` `"module": "commonjs"`). Use `import`/`export` (esModuleInterop is on). Do NOT convert to ESM.
- **Comment convention:** Every new function/module/exported const gets a `What: / Does: / If removed:` header block, matching the existing codebase style exactly.
- **Response envelopes:** Success = `{ status: 'success', data: {...} }`. Error = `{ status: 'error', message: string, details: [] }`. Do not change these.
- **Test DB:** Tests use ONLY `mongodb-memory-server`. They must never connect to Atlas or local dev Mongo. `.env` (which holds a live Atlas credential) must remain gitignored and unread by tests.
- **Secrets:** Never commit `.env`. `.env.production` contains placeholders only, never real credentials.
- **Coverage floor:** ≥80% statements/lines for `src/services/**` and `src/middlewares/**`.
- **Commits:** Conventional Commits. Each task ends in one commit. Sign-off footer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Existing behaviour is correct:** The 3 bugs in `REVIEW-FINDINGS.md` are already fixed. Do not "fix" them again; integration tests lock the fixed behaviour in.

---

### Task 1: Jest + ts-jest test infrastructure

**Files:**
- Modify: `package.json` (devDependencies + scripts)
- Create: `jest.config.js`
- Create: `src/tests/setup.ts`
- Create: `src/tests/helpers.ts`
- Create: `src/tests/sanity.test.ts` (temporary, deleted in Step 8)

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `jest.config.js` wired so every test file gets `src/tests/setup.ts` via `setupFilesAfterEnv`.
  - `src/tests/helpers.ts` exports `makePngBuffer(): Buffer` (a minimal valid PNG for upload tests).
  - In-memory Mongo running for every test; collections cleared between tests.

- [ ] **Step 1: Install dev dependencies**

Run:
```bash
npm install -D jest@^29 ts-jest@^29 @types/jest@^29 supertest@^7 @types/supertest@^6 mongodb-memory-server@^10
```
Expected: installs succeed, `package.json` devDependencies updated.

- [ ] **Step 2: Add test scripts to `package.json`**

In `package.json`, replace the `"scripts"` block with:
```json
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "tsx watch src/server.ts",
    "test": "jest --runInBand --forceExit",
    "test:coverage": "jest --coverage --runInBand --forceExit",
    "test:watch": "jest --watch"
  },
```

- [ ] **Step 3: Create `jest.config.js`**

Create `jest.config.js`:
```js
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/*.test.ts'],
    setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/types/**',
        '!src/server.ts',
        '!src/tests/**'
    ],
    coverageThreshold: {
        './src/services/': { statements: 80, lines: 80 },
        './src/middlewares/': { statements: 80, lines: 80 }
    },
    // mongodb-memory-server download can be slow on first run
    testTimeout: 30000
};
```
Note: remove the `setupFilesAfterEach` line (it is not a real Jest option; it is included here only to remind you NOT to add invalid keys). The valid key is `setupFilesAfterEnv`.

- [ ] **Step 4: Create `src/tests/setup.ts`**

Create `src/tests/setup.ts`:
```ts
// Jest global test setup — spins up an in-memory MongoDB for the whole test run,
// connects Mongoose to it, clears collections between tests, and tears everything
// down at the end. Ensures tests never touch development or Atlas data.

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Force a test environment before anything reads process.env.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
process.env.MAX_FILE_SIZE_MB = process.env.MAX_FILE_SIZE_MB || '5';

let mongo: MongoMemoryServer;

// What: Boots the in-memory database once before any test runs.
// Does: Starts MongoMemoryServer, sets MONGODB_URI to its URI, and connects Mongoose.
// If removed: Model calls have no database and every test throws a connection error.
beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    const uri = mongo.getUri();
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_ATLAS_URI = '';
    await mongoose.connect(uri);
});

// What: Resets database state between individual tests.
// Does: Deletes all documents from every collection after each test.
// If removed: Tests leak data into each other and assertions become order-dependent.
afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
        await collections[key].deleteMany({});
    }
});

// What: Tears the in-memory database down after the whole suite finishes.
// Does: Disconnects Mongoose and stops the MongoMemoryServer process.
// If removed: Jest hangs open on the live connection and the mongod child process leaks.
afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
});
```

- [ ] **Step 5: Create `src/tests/helpers.ts`**

Create `src/tests/helpers.ts`:
```ts
// Shared test helpers — small fixtures reused across integration tests.

// What: Builds a minimal but valid 1x1 PNG as a Buffer for upload tests.
// Does: Returns the canonical smallest PNG byte sequence so Multer accepts it as image/png.
// If removed: Upload tests have no file to attach and POST /media cannot be exercised.
export const makePngBuffer = (): Buffer =>
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
    );
```

- [ ] **Step 6: Create a temporary sanity test**

Create `src/tests/sanity.test.ts`:
```ts
// Temporary sanity test — proves the Jest + ts-jest + in-memory Mongo wiring works.
import mongoose from 'mongoose';

describe('test infrastructure', () => {
    it('connects to the in-memory database', () => {
        // readyState 1 === connected
        expect(mongoose.connection.readyState).toBe(1);
    });
});
```

- [ ] **Step 7: Run the sanity test**

Run: `npm test -- src/tests/sanity.test.ts`
Expected: PASS — 1 test passing, no open-handle warnings that fail the run.

- [ ] **Step 8: Delete the sanity test**

Run: `rm src/tests/sanity.test.ts`

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json jest.config.js src/tests/setup.ts src/tests/helpers.ts
git commit -m "chore: add jest + ts-jest test infrastructure

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Unit tests — AppError and catchAsync

**Files:**
- Create: `src/tests/unit/AppError.test.ts`
- Create: `src/tests/unit/catchAsync.test.ts`

**Interfaces:**
- Consumes: `AppError` from `src/utils/AppError.ts` (constructor `(message: string, statusCode: number)`, fields `statusCode`, `isOperational`); `catchAsync` default export from `src/utils/catchAsync.ts` (`(fn) => RequestHandler`).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the AppError test**

Create `src/tests/unit/AppError.test.ts`:
```ts
// Unit tests for AppError — verifies it carries HTTP status, message, and the
// operational flag, and remains a real Error subclass after TS transpilation.

import { AppError } from '../../utils/AppError';

describe('AppError', () => {
    it('sets message and statusCode', () => {
        const err = new AppError('Not found', 404);
        expect(err.message).toBe('Not found');
        expect(err.statusCode).toBe(404);
    });

    it('marks the error as operational', () => {
        const err = new AppError('Bad request', 400);
        expect(err.isOperational).toBe(true);
    });

    it('is an instance of Error and AppError', () => {
        const err = new AppError('Boom', 500);
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(AppError);
    });
});
```

- [ ] **Step 2: Run it (should pass — code already exists)**

Run: `npm test -- src/tests/unit/AppError.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 3: Write the catchAsync test**

Create `src/tests/unit/catchAsync.test.ts`:
```ts
// Unit tests for catchAsync — verifies rejected async handlers are forwarded to
// next(err) and resolved handlers do not call next.

import { Request, Response, NextFunction } from 'express';
import catchAsync from '../../utils/catchAsync';

describe('catchAsync', () => {
    it('forwards a rejected promise to next(error)', async () => {
        const boom = new Error('boom');
        const handler = catchAsync(async () => {
            throw boom;
        });
        const next = jest.fn() as unknown as NextFunction;

        handler({} as Request, {} as Response, next);
        // Wait a microtask tick so the rejection propagates to .catch(next)
        await Promise.resolve();

        expect(next).toHaveBeenCalledWith(boom);
    });

    it('does not call next when the handler resolves', async () => {
        const handler = catchAsync(async () => {
            // resolves with no error
        });
        const next = jest.fn() as unknown as NextFunction;

        handler({} as Request, {} as Response, next);
        await Promise.resolve();

        expect(next).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 4: Run it**

Run: `npm test -- src/tests/unit/catchAsync.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/tests/unit/AppError.test.ts src/tests/unit/catchAsync.test.ts
git commit -m "test: add unit tests for AppError and catchAsync

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Unit tests — validate middleware

**Files:**
- Create: `src/tests/unit/validate.test.ts`

**Interfaces:**
- Consumes: `validate` default export from `src/middlewares/validate.ts` (`(schema, target?) => middleware`). A Zod schema for the test (built inline with `zod`).
- Produces: nothing downstream.

- [ ] **Step 1: Write the validate test**

Create `src/tests/unit/validate.test.ts`:
```ts
// Unit tests for the Zod validation middleware factory — confirms valid input
// passes through (parsed data exposed, next called) and invalid input yields the
// structured 400 error response without calling next.

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import validate from '../../middlewares/validate';

// Minimal Response test double capturing status + json.
const mockRes = () => {
    const res = {} as Response & { statusCode?: number; body?: unknown };
    res.status = jest.fn().mockImplementation((code: number) => {
        res.statusCode = code;
        return res;
    }) as unknown as Response['status'];
    res.json = jest.fn().mockImplementation((payload: unknown) => {
        res.body = payload;
        return res;
    }) as unknown as Response['json'];
    return res;
};

const schema = z.object({ title: z.string().min(1) });

describe('validate middleware', () => {
    it('calls next and exposes parsed data on valid input', () => {
        const req = { body: { title: 'hello' } } as Request;
        const res = mockRes();
        const next = jest.fn() as unknown as NextFunction;

        validate(schema, 'body')(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
        expect(req.body).toEqual({ title: 'hello' });
        expect(res.status).not.toHaveBeenCalled();
    });

    it('responds 400 with structured error on invalid input', () => {
        const req = { body: { title: '' } } as Request;
        const res = mockRes();
        const next = jest.fn() as unknown as NextFunction;

        validate(schema, 'body')(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.body).toMatchObject({
            status: 'error',
            message: 'Validation failed'
        });
        expect((res.body as { details: unknown[] }).details.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- src/tests/unit/validate.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 3: Commit**

```bash
git add src/tests/unit/validate.test.ts
git commit -m "test: add unit tests for validate middleware

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Unit tests — mediaService (pagination + logic, repository mocked)

**Files:**
- Create: `src/tests/unit/mediaService.test.ts`

**Interfaces:**
- Consumes: service functions from `src/services/mediaService.ts`:
  - `getAllMedia(params: MediaQueryParams): Promise<PaginatedMediaResponse>`
  - `getMediaById(id: string): Promise<IMedia>` (throws `AppError(404)` on missing)
  - `updateMediaRecord(id, body: UpdateMediaBody): Promise<IMedia>`
  Repository module `src/repositories/mediaRepository.ts` is mocked via `jest.mock`.
- Produces: nothing downstream.

- [ ] **Step 1: Write the mediaService test**

Create `src/tests/unit/mediaService.test.ts`:
```ts
// Unit tests for mediaService — the repository is fully mocked so these tests
// isolate the service's own logic: pagination pass-through, 404 on missing records,
// and partial-update patch construction (title-only update must not touch tags).

import { getAllMedia, getMediaById, updateMediaRecord } from '../../services/mediaService';
import * as repo from '../../repositories/mediaRepository';
import { MediaQueryParams } from '../../types/media';

jest.mock('../../repositories/mediaRepository');
const mockedRepo = repo as jest.Mocked<typeof repo>;

const baseQuery: MediaQueryParams = {
    page: 2,
    limit: 10,
    sortBy: 'createdAt',
    order: 'desc'
};

describe('mediaService.getAllMedia', () => {
    it('passes pagination metadata through from the repository', async () => {
        mockedRepo.findAllMedia.mockResolvedValue({
            results: [],
            pagination: { total: 25, page: 2, limit: 10, totalPages: 3 }
        });

        const result = await getAllMedia(baseQuery);

        expect(result.pagination).toEqual({ total: 25, page: 2, limit: 10, totalPages: 3 });
        expect(mockedRepo.findAllMedia).toHaveBeenCalledWith(baseQuery);
    });
});

describe('mediaService.getMediaById', () => {
    it('throws a 404 AppError when the record is missing', async () => {
        mockedRepo.findMediaById.mockResolvedValue(null);

        await expect(getMediaById('507f1f77bcf86cd799439011')).rejects.toMatchObject({
            statusCode: 404
        });
    });

    it('returns the record when found', async () => {
        const doc = { title: 'x' } as unknown as Awaited<ReturnType<typeof repo.findMediaById>>;
        mockedRepo.findMediaById.mockResolvedValue(doc);

        const result = await getMediaById('507f1f77bcf86cd799439011');
        expect(result).toBe(doc);
    });
});

describe('mediaService.updateMediaRecord', () => {
    it('sends only the provided fields (title-only update omits tags)', async () => {
        mockedRepo.updateMediaById.mockResolvedValue({ title: 'New' } as never);

        await updateMediaRecord('507f1f77bcf86cd799439011', { title: 'New' });

        const patch = mockedRepo.updateMediaById.mock.calls[0][1];
        expect(patch).toEqual({ title: 'New' });
        expect(patch).not.toHaveProperty('tags');
    });

    it('normalises tags when tags are provided', async () => {
        mockedRepo.updateMediaById.mockResolvedValue({ title: 'x' } as never);

        await updateMediaRecord('507f1f77bcf86cd799439011', { tags: 'a, b, ,c' });

        const patch = mockedRepo.updateMediaById.mock.calls[0][1];
        expect(patch.tags).toEqual(['a', 'b', 'c']);
    });

    it('throws 404 when the record does not exist', async () => {
        mockedRepo.updateMediaById.mockResolvedValue(null);

        await expect(
            updateMediaRecord('507f1f77bcf86cd799439011', { title: 'New' })
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- src/tests/unit/mediaService.test.ts`
Expected: PASS — 6 tests. (If TypeScript complains about the mocked return type, the `as never` / `as unknown` casts above are the intended escape hatch — keep them.)

- [ ] **Step 3: Commit**

```bash
git add src/tests/unit/mediaService.test.ts
git commit -m "test: add unit tests for mediaService pagination and logic

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Integration tests — all media endpoints (Supertest)

**Files:**
- Create: `src/tests/integration/media.test.ts`

**Interfaces:**
- Consumes: `app` default export from `src/app.ts`; `makePngBuffer` from `src/tests/helpers.ts`; the running in-memory Mongo from `src/tests/setup.ts`.
- Produces: nothing downstream. These are the regression tests for the 3 previously-fixed bugs.

- [ ] **Step 1: Write the integration test**

Create `src/tests/integration/media.test.ts`:
```ts
// Integration tests — exercise the real Express + Mongoose stack via Supertest
// against the in-memory MongoDB. Covers all five endpoints plus the three
// regression cases from REVIEW-FINDINGS.md (valid GET list = 200 not 500;
// title-only PUT keeps tags; ?search= works).

import request from 'supertest';
import app from '../../app';
import { makePngBuffer } from '../helpers';

// Helper: upload one media record and return its id + body.
const uploadMedia = async (overrides: { title?: string; category?: string; tags?: string } = {}) => {
    const res = await request(app)
        .post('/media')
        .field('title', overrides.title ?? 'Test Photo')
        .field('category', overrides.category ?? 'image')
        .field('tags', overrides.tags ?? 'holiday,beach')
        .attach('file', makePngBuffer(), 'photo.png');
    return res;
};

describe('POST /media', () => {
    it('creates a record and returns 201 with the standard envelope', async () => {
        const res = await uploadMedia();
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('success');
        expect(res.body.data.media).toMatchObject({
            title: 'Test Photo',
            category: 'image',
            mimeType: 'image/png'
        });
        expect(res.body.data.media.tags).toEqual(['holiday', 'beach']);
    });

    it('returns 400 when title is missing', async () => {
        const res = await request(app)
            .post('/media')
            .field('category', 'image')
            .attach('file', makePngBuffer(), 'photo.png');
        expect(res.status).toBe(400);
        expect(res.body.status).toBe('error');
    });

    it('returns 400 for an unsupported file type', async () => {
        const res = await request(app)
            .post('/media')
            .field('title', 'Bad')
            .field('category', 'other')
            .attach('file', Buffer.from('#!/bin/sh\necho hi'), 'evil.sh');
        expect(res.status).toBe(400);
        expect(res.body.status).toBe('error');
    });
});

describe('GET /media', () => {
    it('returns 200 with pagination metadata for a valid query (regression: no 500)', async () => {
        await uploadMedia();
        const res = await request(app).get('/media?page=1&limit=5');
        expect(res.status).toBe(200);
        expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 5 });
        expect(Array.isArray(res.body.data.results)).toBe(true);
    });

    it('filters by category', async () => {
        await uploadMedia({ category: 'image' });
        await uploadMedia({ title: 'A doc', category: 'document' });
        const res = await request(app).get('/media?category=document');
        expect(res.status).toBe(200);
        expect(res.body.data.results).toHaveLength(1);
        expect(res.body.data.results[0].category).toBe('document');
    });

    it('searches by title (regression: ?search= must not error)', async () => {
        await uploadMedia({ title: 'Sunset over water' });
        await uploadMedia({ title: 'City lights' });
        const res = await request(app).get('/media?search=sunset');
        expect(res.status).toBe(200);
        expect(res.body.data.results).toHaveLength(1);
        expect(res.body.data.results[0].title).toBe('Sunset over water');
    });
});

describe('GET /media/:id', () => {
    it('returns 200 for a valid id', async () => {
        const created = await uploadMedia();
        const id = created.body.data.media._id;
        const res = await request(app).get(`/media/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.data.media._id).toBe(id);
    });

    it('returns 404 for an unknown but valid id', async () => {
        const res = await request(app).get('/media/507f1f77bcf86cd799439011');
        expect(res.status).toBe(404);
        expect(res.body.status).toBe('error');
    });
});

describe('PUT /media/:id', () => {
    it('updates a record and returns 200', async () => {
        const created = await uploadMedia();
        const id = created.body.data.media._id;
        const res = await request(app).put(`/media/${id}`).send({ title: 'Renamed' });
        expect(res.status).toBe(200);
        expect(res.body.data.media.title).toBe('Renamed');
    });

    it('preserves existing tags on a title-only update (regression)', async () => {
        const created = await uploadMedia({ tags: 'keep,these' });
        const id = created.body.data.media._id;
        const res = await request(app).put(`/media/${id}`).send({ title: 'Renamed' });
        expect(res.status).toBe(200);
        expect(res.body.data.media.tags).toEqual(['keep', 'these']);
    });

    it('returns 400 for an empty update body', async () => {
        const created = await uploadMedia();
        const id = created.body.data.media._id;
        const res = await request(app).put(`/media/${id}`).send({});
        expect(res.status).toBe(400);
        expect(res.body.status).toBe('error');
    });
});

describe('DELETE /media/:id', () => {
    it('deletes a record and returns 200', async () => {
        const created = await uploadMedia();
        const id = created.body.data.media._id;
        const res = await request(app).delete(`/media/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('success');

        const after = await request(app).get(`/media/${id}`);
        expect(after.status).toBe(404);
    });

    it('returns 404 when deleting an unknown id', async () => {
        const res = await request(app).delete('/media/507f1f77bcf86cd799439011');
        expect(res.status).toBe(404);
    });
});
```

- [ ] **Step 2: Run the integration test**

Run: `npm test -- src/tests/integration/media.test.ts`
Expected: PASS — all describe blocks green. If the title-only-tags test fails, STOP: that means the tags-wipe bug is NOT actually fixed and the spec's assumption is wrong — report it rather than editing the test to pass.

- [ ] **Step 3: Run the full suite with coverage**

Run: `npm run test:coverage`
Expected: PASS, and the coverage table shows `src/services/` and `src/middlewares/` at ≥80% statements/lines. If below 80%, add targeted tests for the uncovered branch (most likely the errorHandler Mongoose/Multer branches — add a test that POSTs an oversized file to hit `LIMIT_FILE_SIZE`).

- [ ] **Step 4: Commit**

```bash
git add src/tests/integration/media.test.ts
git commit -m "test: add supertest integration tests for all media endpoints

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Environment configuration — dotenv-flow + startup validation

**Files:**
- Modify: `package.json` (add `dotenv-flow` dependency)
- Create: `src/config/env.ts`
- Modify: `src/server.ts` (replace `import 'dotenv/config'` with the new env loader)
- Create: `.env.development`
- Create: `.env.test`
- Create: `.env.production`
- Modify: `.env.example`
- Modify: `.gitignore`
- Create: `src/tests/unit/env.test.ts`

**Interfaces:**
- Consumes: `process.env`.
- Produces: `src/config/env.ts` default export `loadEnv(): void` and named export `validateEnv(env: NodeJS.ProcessEnv): string[]` (returns an array of missing-var messages; empty array = valid). `loadEnv` calls `dotenv-flow` then `validateEnv` and exits on failure.

- [ ] **Step 1: Install dotenv-flow**

Run: `npm install dotenv-flow@^4`
Expected: added to dependencies.

- [ ] **Step 2: Write the env validation test**

Create `src/tests/unit/env.test.ts`:
```ts
// Unit tests for environment validation — verifies validateEnv reports every
// missing required variable and passes when all are present. A Mongo URI counts
// as present if either MONGODB_URI or MONGODB_ATLAS_URI is set.

import { validateEnv } from '../../config/env';

const complete = (): NodeJS.ProcessEnv => ({
    NODE_ENV: 'test',
    PORT: '3000',
    MONGODB_URI: 'mongodb://localhost:27017/x',
    MAX_FILE_SIZE_MB: '5',
    UPLOAD_DIR: 'uploads',
    LOG_LEVEL: 'info'
});

describe('validateEnv', () => {
    it('returns no errors when all required vars are present', () => {
        expect(validateEnv(complete())).toEqual([]);
    });

    it('accepts MONGODB_ATLAS_URI in place of MONGODB_URI', () => {
        const env = complete();
        delete env.MONGODB_URI;
        env.MONGODB_ATLAS_URI = 'mongodb://atlas/x';
        expect(validateEnv(env)).toEqual([]);
    });

    it('reports a missing Mongo URI', () => {
        const env = complete();
        delete env.MONGODB_URI;
        const errors = validateEnv(env);
        expect(errors.some((e) => e.includes('MONGODB_URI'))).toBe(true);
    });

    it('reports each missing simple variable', () => {
        const env = complete();
        delete env.PORT;
        delete env.LOG_LEVEL;
        const errors = validateEnv(env);
        expect(errors.some((e) => e.includes('PORT'))).toBe(true);
        expect(errors.some((e) => e.includes('LOG_LEVEL'))).toBe(true);
    });
});
```

- [ ] **Step 3: Run it (should fail — env.ts does not exist yet)**

Run: `npm test -- src/tests/unit/env.test.ts`
Expected: FAIL — cannot find module `../../config/env`.

- [ ] **Step 4: Create `src/config/env.ts`**

Create `src/config/env.ts`:
```ts
// Environment loader + validator. Loads per-environment .env files via dotenv-flow
// (keyed on NODE_ENV), then fails fast if any required variable is missing so the
// process never starts in a half-configured state.

import dotenvFlow from 'dotenv-flow';

// Simple required vars (must be non-empty strings).
const REQUIRED_SIMPLE = ['NODE_ENV', 'PORT', 'MAX_FILE_SIZE_MB', 'UPLOAD_DIR', 'LOG_LEVEL'] as const;

// What: Pure validator for a given environment object.
// Does: Returns a list of human-readable messages for every missing required variable;
//       an empty list means the environment is valid. A Mongo URI is satisfied by either
//       MONGODB_URI or MONGODB_ATLAS_URI. Kept pure (no process.exit) so it is unit-testable.
// If removed: Startup validation has nothing to call and misconfiguration surfaces as
//             confusing downstream runtime errors instead of a clear startup failure.
export const validateEnv = (env: NodeJS.ProcessEnv): string[] => {
    const missing: string[] = [];

    for (const key of REQUIRED_SIMPLE) {
        if (!env[key] || env[key]?.trim() === '') {
            missing.push(`Missing required environment variable: ${key}`);
        }
    }

    const hasMongo =
        (env.MONGODB_URI && env.MONGODB_URI.trim() !== '') ||
        (env.MONGODB_ATLAS_URI && env.MONGODB_ATLAS_URI.trim() !== '');
    if (!hasMongo) {
        missing.push('Missing required environment variable: MONGODB_URI (or MONGODB_ATLAS_URI)');
    }

    return missing;
};

// What: Application environment bootstrap called once at startup.
// Does: Loads the correct .env files with dotenv-flow, validates them, and on any
//       missing variable prints every problem and exits the process with code 1.
// If removed: Env files are never loaded and the app runs with an unvalidated,
//             possibly incomplete configuration.
const loadEnv = (): void => {
    dotenvFlow.config();

    const errors = validateEnv(process.env);
    if (errors.length > 0) {
        // eslint-disable-next-line no-console
        console.error('Environment validation failed:');
        for (const err of errors) console.error(`  - ${err}`);
        process.exit(1);
    }
};

export default loadEnv;
```

- [ ] **Step 5: Run the env test (should pass now)**

Run: `npm test -- src/tests/unit/env.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Wire the loader into `src/server.ts`**

In `src/server.ts`, replace line 5:
```ts
import 'dotenv/config';
```
with:
```ts
import loadEnv from './config/env';

// Load and validate environment before anything else reads process.env.
loadEnv();
```
Leave the rest of `server.ts` unchanged for now (logging swap happens in Task 7).

- [ ] **Step 7: Create the env files**

Create `.env.development`:
```
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/media_library
MAX_FILE_SIZE_MB=5
UPLOAD_DIR=uploads
LOG_LEVEL=debug
```

Create `.env.test`:
```
NODE_ENV=test
PORT=3001
MONGODB_URI=mongodb://localhost:27017/media_library_test
MAX_FILE_SIZE_MB=5
UPLOAD_DIR=uploads
LOG_LEVEL=error
```

Create `.env.production` (placeholders only — real values go in the Vercel dashboard):
```
NODE_ENV=production
PORT=3000
MONGODB_URI=
MONGODB_ATLAS_URI=
MAX_FILE_SIZE_MB=5
UPLOAD_DIR=/tmp/uploads
LOG_LEVEL=info
```

- [ ] **Step 8: Update `.env.example`**

Replace the contents of `.env.example` with:
```
# Copy to .env.development / .env.test / .env.production and fill in values.

# Runtime environment: development | test | production
NODE_ENV=development

# HTTP port
PORT=3000

# MongoDB connection — set at least one. MONGODB_ATLAS_URI takes precedence.
MONGODB_URI=mongodb://localhost:27017/media_library
MONGODB_ATLAS_URI=

# File upload configuration
MAX_FILE_SIZE_MB=5
UPLOAD_DIR=uploads

# Logging level: debug | info | warn | error
LOG_LEVEL=info

# Reserved for future authentication (not currently used by the API)
JWT_SECRET=
```

- [ ] **Step 9: Update `.gitignore`**

Replace the contents of `.gitignore` with:
```
node_modules/
dist/
coverage/

# Environment files — never commit real secrets. Only the example is tracked.
.env
.env.*
!.env.example

uploads/*
!uploads/.gitkeep
```

- [ ] **Step 10: Verify the env files are ignored**

Run: `git status --porcelain`
Expected: `.env.development`, `.env.test`, `.env.production`, and `.env` do NOT appear as untracked. `.env.example`, `.gitignore`, `src/config/env.ts`, `src/server.ts`, `package.json` DO appear.

- [ ] **Step 11: Run the full suite**

Run: `npm test`
Expected: PASS — all tests green (env changes did not break app tests).

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example src/config/env.ts src/server.ts src/tests/unit/env.test.ts
git commit -m "feat: environment config via dotenv-flow with startup validation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Structured logging with Winston

**Files:**
- Modify: `package.json` (add `winston`)
- Create: `src/config/logger.ts`
- Modify: `src/server.ts` (console → logger)
- Modify: `src/config/db.ts` (console → logger)
- Modify: `src/services/mediaService.ts` (console.warn → logger.warn; add upload info log)
- Modify: `src/middlewares/logger.ts` (console.log → logger.info)
- Modify: `src/middlewares/errorHandler.ts` (console.error → logger.error)
- Modify: `src/utils/removeUploadedFile.ts` (console.warn → logger.warn)
- Create: `src/tests/unit/logger.test.ts`

**Interfaces:**
- Consumes: `LOG_LEVEL`, `NODE_ENV` from env.
- Produces: `src/config/logger.ts` default export `logger` — a Winston logger with methods `debug/info/warn/error`. Everything else imports and calls it.

- [ ] **Step 1: Install winston**

Run: `npm install winston@^3`
Expected: added to dependencies.

- [ ] **Step 2: Write the logger test**

Create `src/tests/unit/logger.test.ts`:
```ts
// Unit test for the Winston logger — verifies it is a usable logger honouring LOG_LEVEL.

import logger from '../../config/logger';

describe('logger', () => {
    it('exposes the standard log methods', () => {
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.error).toBe('function');
        expect(typeof logger.debug).toBe('function');
    });

    it('uses the level from LOG_LEVEL (error in the test env)', () => {
        // setup.ts sets LOG_LEVEL=error for the test run.
        expect(logger.level).toBe('error');
    });
});
```

- [ ] **Step 3: Run it (should fail — logger.ts does not exist)**

Run: `npm test -- src/tests/unit/logger.test.ts`
Expected: FAIL — cannot find module `../../config/logger`.

- [ ] **Step 4: Create `src/config/logger.ts`**

Create `src/config/logger.ts`:
```ts
// Application logger — a single shared Winston instance. Level is driven by
// LOG_LEVEL (default info). Development gets colorized, human-readable lines;
// production emits JSON so log aggregators can parse structured fields.

import winston from 'winston';

const isProduction = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL || 'info';

// What: Chooses the output format based on environment.
// Does: Pretty, colorized, timestamped lines in dev; structured JSON in production.
// If removed: Logs have no consistent format and production logs are not machine-parseable.
const format = isProduction
    ? winston.format.combine(winston.format.timestamp(), winston.format.json())
    : winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'HH:mm:ss' }),
          winston.format.printf(({ timestamp, level: lvl, message }) => `${timestamp} ${lvl}: ${message}`)
      );

// What: The single application-wide Winston logger.
// Does: Writes all logs to the console transport at the configured level and format.
// If removed: Every module that imports it breaks; the app loses structured logging.
const logger = winston.createLogger({
    level,
    format,
    transports: [new winston.transports.Console()]
});

export default logger;
```

- [ ] **Step 5: Run the logger test (should pass)**

Run: `npm test -- src/tests/unit/logger.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 6: Replace console in `src/server.ts`**

In `src/server.ts`:

Add after the `loadEnv();` block (near the top imports):
```ts
import logger from './config/logger';
```

Replace `console.error(`[UNHANDLED REJECTION] ${message}`);` with:
```ts
    logger.error(`Unhandled promise rejection: ${message}`);
```

Replace the two `console.error` lines in the `uncaughtException` handler with:
```ts
    logger.error(`Uncaught exception: ${err.message}`);
    if (err.stack) logger.error(err.stack);
```

Replace the `app.listen` success `console.log` block (the `✅ ...` lines) with:
```ts
        server = app.listen(PORT, () => {
            logger.info(`Media Library API running on http://localhost:${PORT}`);
        });
```

Replace the graceful-shutdown `console.log`/`console.error` calls:
- `console.log(\`\nReceived ${signal}. Shutting down gracefully...\`);` → `logger.info(`Received ${signal}. Shutting down gracefully...`);`
- `console.log('MongoDB connection closed.');` → `logger.info('MongoDB connection closed.');`
- `console.error('Error closing MongoDB connection:', message);` → `logger.error(`Error closing MongoDB connection: ${message}`);`
- `console.log('Server closed. Exiting.');` → `logger.info('Server closed. Exiting.');`
- `console.error('Failed to start server:', message);` → `logger.error(`Failed to start server: ${message}`);`

- [ ] **Step 7: Replace console in `src/config/db.ts`**

In `src/config/db.ts`, add import at top (after the mongoose import):
```ts
import logger from './logger';
```
Replace `console.log(\`MongoDB connected: ${mongoose.connection.name}\`);` with:
```ts
    logger.info(`MongoDB connected: ${mongoose.connection.name}`);
```

- [ ] **Step 8: Replace console in `src/middlewares/logger.ts`**

Replace the whole file body's `console.log` line. Add import at top (after the express import):
```ts
import appLogger from '../config/logger';
```
Replace the `res.on('finish', ...)` `console.log(...)` line with:
```ts
        appLogger.info(`${req.method} ${req.originalUrl} ${res.statusCode} — ${duration}ms`);
```

- [ ] **Step 9: Replace console in `src/middlewares/errorHandler.ts`**

Add import at top (after the removeUploadedFile import):
```ts
import logger from '../config/logger';
```
Replace:
```ts
    console.error(`[ERROR ${statusCode}] ${err.message}`);
    if (!isProduction && err.stack) {
        console.error(err.stack);
    }
```
with:
```ts
    // 4xx are expected/operational (warn); 5xx are real failures (error).
    if (statusCode >= 500) {
        logger.error(`[${statusCode}] ${err.message}`);
        if (!isProduction && err.stack) logger.error(err.stack);
    } else {
        logger.warn(`[${statusCode}] ${err.message}`);
    }
```

- [ ] **Step 10: Replace console in `src/services/mediaService.ts`**

Add import at top (after the repository imports):
```ts
import logger from '../config/logger';
```
In `createMediaRecord`, add an info log right before `return createMedia(data);`:
```ts
    logger.info(`File uploaded: ${data.originalName} (${data.fileSize} bytes)`);
```
In `deleteMediaRecord`, replace:
```ts
        console.warn(`Could not delete file at ${absolutePath}:`, (err as Error).message);
```
with:
```ts
        logger.warn(`Could not delete file at ${absolutePath}: ${(err as Error).message}`);
```

- [ ] **Step 11: Replace console in `src/utils/removeUploadedFile.ts`**

Add import at top (after the fs import):
```ts
import logger from '../config/logger';
```
Replace:
```ts
        console.warn(`Could not clean up uploaded file at ${file.path}: ${err.message}`);
```
with:
```ts
        logger.warn(`Could not clean up uploaded file at ${file.path}: ${err.message}`);
```

- [ ] **Step 12: Verify no stray console.* remain in src (excluding tests and env.ts)**

Run: `grep -rn "console\." src --include=*.ts | grep -v "src/tests" | grep -v "src/config/env.ts"`
Expected: no output (env.ts intentionally uses console for pre-logger startup validation failures).

- [ ] **Step 13: Build to confirm types compile**

Run: `npm run build`
Expected: exit 0, no TypeScript errors.

- [ ] **Step 14: Run the full suite**

Run: `npm test`
Expected: PASS — all tests green.

- [ ] **Step 15: Commit**

```bash
git add package.json package-lock.json src/config/logger.ts src/server.ts src/config/db.ts src/middlewares/logger.ts src/middlewares/errorHandler.ts src/services/mediaService.ts src/utils/removeUploadedFile.ts src/tests/unit/logger.test.ts
git commit -m "feat: structured logging with winston

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: GET /health endpoint

**Files:**
- Modify: `src/app.ts` (add the `GET /health` route just after the existing `GET /` handler)
- Create: `src/tests/integration/health.test.ts`

**Interfaces:**
- Consumes: `app` from `src/app.ts`.
- Produces: `GET /health` → `200 { status: 'ok', uptime: number, timestamp: string }`.

- [ ] **Step 1: Write the health test**

Create `src/tests/integration/health.test.ts`:
```ts
// Integration test for the health-check endpoint used by deployment monitors.

import request from 'supertest';
import app from '../../app';

describe('GET /health', () => {
    it('returns 200 with status, uptime, and timestamp', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(typeof res.body.uptime).toBe('number');
        expect(typeof res.body.timestamp).toBe('string');
        // timestamp must be a valid ISO date
        expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
    });
});
```

- [ ] **Step 2: Run it (should fail — route returns 404)**

Run: `npm test -- src/tests/integration/health.test.ts`
Expected: FAIL — status 404, `res.body.status` is `'error'`.

- [ ] **Step 3: Add the route in `src/app.ts`**

In `src/app.ts`, immediately after the existing `GET /` handler block (after its closing `});`, before the `// API routes` section, add:
```ts
// ---------------------------------------------------------------------------
// Dedicated health-check endpoint
// ---------------------------------------------------------------------------

// What: Liveness endpoint for uptime monitors and the Vercel deployment.
// Does: Responds 200 with a fixed shape { status, uptime, timestamp } without touching
//       the database, so monitors can confirm the process is alive cheaply.
// If removed: Monitoring pointed at GET /health starts failing with 404.
app.get('/health', (_req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});
```

- [ ] **Step 4: Run it (should pass)**

Run: `npm test -- src/tests/integration/health.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/tests/integration/health.test.ts
git commit -m "feat: add GET /health endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: GitHub Actions CI pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm ci`, `npm run build`, `npm test` (all defined). Tests self-provision Mongo via `mongodb-memory-server`, so CI needs no external database service.
- Produces: CI workflow + coverage artifact.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build (typecheck)
        run: npm run build

      - name: Run tests with coverage
        run: npm run test:coverage
        env:
          NODE_ENV: test
          PORT: '3001'
          MONGODB_URI: 'mongodb://localhost:27017/media_library_test'
          MAX_FILE_SIZE_MB: '5'
          UPLOAD_DIR: 'uploads'
          LOG_LEVEL: 'error'

      - name: Upload coverage report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
          if-no-files-found: ignore
```

- [ ] **Step 2: Lint the YAML locally (basic parse check)**

Run: `node -e "require('fs').readFileSync('.github/workflows/ci.yml','utf8'); console.log('yaml file present')"`
Expected: `yaml file present` (this only confirms the file exists/reads; GitHub validates on push).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions test pipeline

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Vercel deployment config + docs

**Files:**
- Create: `api/index.ts` (Vercel serverless entry)
- Create: `vercel.json`
- Create: `DEPLOYMENT.md`
- Modify: `tsconfig.json` (`include` the `api` folder so it compiles/typechecks)

**Interfaces:**
- Consumes: `app` from `src/app.ts`, `connectDB` from `src/config/db.ts`, `loadEnv` from `src/config/env.ts`.
- Produces: a serverless handler at `api/index.ts` exporting the Express app with a lazy DB connection; `vercel.json` routing all traffic to it.

- [ ] **Step 1: Create the serverless entry `api/index.ts`**

Create `api/index.ts`:
```ts
// Vercel serverless entry point. Unlike server.ts it never calls app.listen() —
// Vercel invokes the exported Express app as a request handler. The DB connection
// is established lazily on the first request and reused across warm invocations.

import type { Request, Response } from 'express';
import loadEnv from '../src/config/env';
import connectDB from '../src/config/db';
import app from '../src/app';

loadEnv();

// Cache the connection promise across warm invocations so we connect at most once.
let dbReady: Promise<void> | null = null;

// What: Serverless request handler exported to the Vercel Node runtime.
// Does: Ensures a single lazy MongoDB connection is established, then delegates the
//       request to the Express app.
// If removed: Vercel has no entry to invoke and the deployment serves nothing.
export default async function handler(req: Request, res: Response): Promise<void> {
    if (!dbReady) dbReady = connectDB();
    await dbReady;
    app(req, res);
}
```

- [ ] **Step 2: Create `vercel.json`**

Create `vercel.json`:
```json
{
  "version": 2,
  "builds": [
    { "src": "api/index.ts", "use": "@vercel/node" }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "api/index.ts" }
  ]
}
```

- [ ] **Step 3: Include the api folder in `tsconfig.json`**

In `tsconfig.json`, change the `"include"` line from:
```json
  "include": ["src/**/*"],
```
to:
```json
  "include": ["src/**/*", "api/**/*"],
```

- [ ] **Step 4: Build to confirm the entry typechecks**

Run: `npm run build`
Expected: exit 0. (Note: `rootDir` is `src`, so compiling `api` may warn about files outside rootDir. If `tsc` errors with "is not under rootDir", remove the `"rootDir": "src"` line from tsconfig — Vercel builds `api/` with its own toolchain and `npm run build` is only used for the CI typecheck + local dist. Confirm build then passes.)

- [ ] **Step 5: Create `DEPLOYMENT.md`**

Create `DEPLOYMENT.md`:
```markdown
# Deployment (Vercel)

## Prerequisites
- A Vercel account and the Vercel CLI: `npm i -g vercel`
- A MongoDB Atlas connection string (Vercel cannot reach a local Mongo).

## Configure environment variables
Set these in the Vercel dashboard (Project → Settings → Environment Variables),
for the Production environment:

| Variable | Example |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_ATLAS_URI` | your Atlas connection string |
| `MAX_FILE_SIZE_MB` | `5` |
| `UPLOAD_DIR` | `/tmp/uploads` |
| `LOG_LEVEL` | `info` |
| `PORT` | `3000` (unused by serverless, set for validation) |

`.env.production` in the repo holds placeholders only — never commit real secrets.

## Deploy
```bash
vercel            # first run links/creates the project (preview)
vercel --prod     # production deployment
```

## Verify
- `GET https://<your-app>.vercel.app/health` → `{ "status": "ok", ... }`
- Run the Postman collection (see `/postman`) against the production environment;
  all assertions should pass.

## Known limitation: ephemeral filesystem
Vercel serverless functions have a **read-only / ephemeral** filesystem. Files written
to `UPLOAD_DIR` (only `/tmp` is writable, and only for the lifetime of a single
invocation) do **not** persist: a later request may hit a different instance where the
file does not exist, so uploaded files effectively vanish and `/uploads/<file>` 404s.

### Production-grade fix
Do not store uploads on the function filesystem. Stream them to external object storage
and persist the returned URL in Mongo instead of a local `filePath`:

- **AWS S3** — upload via the AWS SDK; store the S3 object URL (or a signed URL).
- **Cloudinary** — upload via the Cloudinary SDK; store the secure URL.

The Multer disk storage engine would be replaced with `multer-s3` (or an in-memory
Multer storage + a direct SDK upload), and `filePath` would become the remote URL. The
rest of the API (validation, pagination, search) is unaffected.

## Monitoring (bonus)
Point an uptime monitor (UptimeRobot / Better Uptime / Vercel Analytics) at
`GET /health` on a short interval.
```

- [ ] **Step 6: Run the full suite once more**

Run: `npm test`
Expected: PASS — all tests green (deployment files don't affect tests).

- [ ] **Step 7: Commit**

```bash
git add api/index.ts vercel.json DEPLOYMENT.md tsconfig.json
git commit -m "feat: add vercel deployment config and deployment docs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Postman collection + environments

**Files:**
- Create: `postman/media-library-api.postman_collection.json`
- Create: `postman/development.postman_environment.json`
- Create: `postman/production.postman_environment.json`

**Interfaces:**
- Consumes: the live API (via `{{BASE_URL}}`); captures `{{MEDIA_ID}}` from the create response.
- Produces: an importable Postman collection with assertions for all five endpoints.

- [ ] **Step 1: Create the collection**

Create `postman/media-library-api.postman_collection.json`:
```json
{
  "info": {
    "name": "Media Library API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    "description": "All Media Library API endpoints with status, structure, and field assertions."
  },
  "item": [
    {
      "name": "POST /media (create)",
      "event": [
        {
          "listen": "test",
          "script": {
            "type": "text/javascript",
            "exec": [
              "pm.test('status is 201', () => pm.response.to.have.status(201));",
              "const b = pm.response.json();",
              "pm.test('envelope is success', () => pm.expect(b.status).to.eql('success'));",
              "pm.test('has media with _id', () => pm.expect(b.data.media).to.have.property('_id'));",
              "if (b.data && b.data.media && b.data.media._id) {",
              "  pm.environment.set('MEDIA_ID', b.data.media._id);",
              "}"
            ]
          }
        }
      ],
      "request": {
        "method": "POST",
        "header": [],
        "url": { "raw": "{{BASE_URL}}/media", "host": ["{{BASE_URL}}"], "path": ["media"] },
        "body": {
          "mode": "formdata",
          "formdata": [
            { "key": "title", "value": "Sample Photo", "type": "text" },
            { "key": "category", "value": "image", "type": "text" },
            { "key": "tags", "value": "sample,demo", "type": "text" },
            { "key": "file", "type": "file", "src": [] }
          ]
        }
      }
    },
    {
      "name": "GET /media (list)",
      "event": [
        {
          "listen": "test",
          "script": {
            "type": "text/javascript",
            "exec": [
              "pm.test('status is 200', () => pm.response.to.have.status(200));",
              "const b = pm.response.json();",
              "pm.test('envelope is success', () => pm.expect(b.status).to.eql('success'));",
              "pm.test('has pagination metadata', () => {",
              "  pm.expect(b.data.pagination).to.have.property('total');",
              "  pm.expect(b.data.pagination).to.have.property('totalPages');",
              "});",
              "pm.test('results is an array', () => pm.expect(b.data.results).to.be.an('array'));"
            ]
          }
        }
      ],
      "request": {
        "method": "GET",
        "header": [],
        "url": {
          "raw": "{{BASE_URL}}/media?page=1&limit=10",
          "host": ["{{BASE_URL}}"],
          "path": ["media"],
          "query": [
            { "key": "page", "value": "1" },
            { "key": "limit", "value": "10" }
          ]
        }
      }
    },
    {
      "name": "GET /media/:id (get one)",
      "event": [
        {
          "listen": "test",
          "script": {
            "type": "text/javascript",
            "exec": [
              "pm.test('status is 200', () => pm.response.to.have.status(200));",
              "const b = pm.response.json();",
              "pm.test('returns the requested record', () => {",
              "  pm.expect(b.status).to.eql('success');",
              "  pm.expect(b.data.media._id).to.eql(pm.environment.get('MEDIA_ID'));",
              "});"
            ]
          }
        }
      ],
      "request": {
        "method": "GET",
        "header": [],
        "url": { "raw": "{{BASE_URL}}/media/{{MEDIA_ID}}", "host": ["{{BASE_URL}}"], "path": ["media", "{{MEDIA_ID}}"] }
      }
    },
    {
      "name": "PUT /media/:id (update)",
      "event": [
        {
          "listen": "test",
          "script": {
            "type": "text/javascript",
            "exec": [
              "pm.test('status is 200', () => pm.response.to.have.status(200));",
              "const b = pm.response.json();",
              "pm.test('title updated', () => pm.expect(b.data.media.title).to.eql('Updated Title'));"
            ]
          }
        }
      ],
      "request": {
        "method": "PUT",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "url": { "raw": "{{BASE_URL}}/media/{{MEDIA_ID}}", "host": ["{{BASE_URL}}"], "path": ["media", "{{MEDIA_ID}}"] },
        "body": { "mode": "raw", "raw": "{\n  \"title\": \"Updated Title\"\n}" }
      }
    },
    {
      "name": "DELETE /media/:id (delete)",
      "event": [
        {
          "listen": "test",
          "script": {
            "type": "text/javascript",
            "exec": [
              "pm.test('status is 200', () => pm.response.to.have.status(200));",
              "const b = pm.response.json();",
              "pm.test('envelope is success', () => pm.expect(b.status).to.eql('success'));"
            ]
          }
        }
      ],
      "request": {
        "method": "DELETE",
        "header": [],
        "url": { "raw": "{{BASE_URL}}/media/{{MEDIA_ID}}", "host": ["{{BASE_URL}}"], "path": ["media", "{{MEDIA_ID}}"] }
      }
    }
  ]
}
```

- [ ] **Step 2: Create the Development environment**

Create `postman/development.postman_environment.json`:
```json
{
  "name": "Development",
  "values": [
    { "key": "BASE_URL", "value": "http://localhost:3000", "enabled": true },
    { "key": "MEDIA_ID", "value": "", "enabled": true }
  ]
}
```

- [ ] **Step 3: Create the Production environment**

Create `postman/production.postman_environment.json`:
```json
{
  "name": "Production",
  "values": [
    { "key": "BASE_URL", "value": "https://REPLACE-WITH-YOUR-APP.vercel.app", "enabled": true },
    { "key": "MEDIA_ID", "value": "", "enabled": true }
  ]
}
```

- [ ] **Step 4: Validate the JSON files parse**

Run: `node -e "['postman/media-library-api.postman_collection.json','postman/development.postman_environment.json','postman/production.postman_environment.json'].forEach(f=>JSON.parse(require('fs').readFileSync(f,'utf8'))); console.log('all postman json valid')"`
Expected: `all postman json valid`.

- [ ] **Step 5: Commit**

```bash
git add postman/
git commit -m "docs: add postman collection and environments

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Final verification + README update

**Files:**
- Modify: `README.md` (add a "Testing", "Environment", "Logging", "Health", "Deployment" section pointer)

**Interfaces:**
- Consumes: everything built above.
- Produces: updated docs; a fully green run.

- [ ] **Step 1: Run the whole suite with coverage**

Run: `npm run test:coverage`
Expected: PASS; services + middleware ≥80%.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 3: Append a production-readiness section to `README.md`**

Add this section near the end of `README.md` (before any license footer):
```markdown
## Production Readiness (BEM-34)

- **Tests:** `npm test` (unit + integration via Jest, Supertest, in-memory MongoDB).
  Coverage: `npm run test:coverage`.
- **Environment:** `dotenv-flow` loads `.env.<NODE_ENV>`; required variables are
  validated at startup (`src/config/env.ts`) and the process exits on a missing var.
  See `.env.example`.
- **Logging:** structured logging via Winston (`src/config/logger.ts`) — pretty in
  development, JSON in production, level from `LOG_LEVEL`.
- **Health check:** `GET /health` → `{ status, uptime, timestamp }`.
- **CI:** `.github/workflows/ci.yml` builds, tests, and uploads a coverage artifact on
  every push/PR to `master`.
- **Deployment:** see `DEPLOYMENT.md` (Vercel config in `vercel.json`, serverless entry
  in `api/index.ts`, plus the ephemeral-filesystem limitation and its S3/Cloudinary fix).
- **Postman:** import `postman/media-library-api.postman_collection.json` and the
  Development / Production environments.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document production-readiness features in README

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Final git log review**

Run: `git log --oneline master..BEM-34`
Expected: the grouped conventional commits (spec doc + Tasks 1–12) in order.

---

## Notes for the implementer

- If any integration regression test (title-only tags, GET list 200, search) FAILS, that contradicts the spec's assumption that the 3 prior bugs are fixed. STOP and report — do not weaken the test to make it pass.
- `mongodb-memory-server` downloads a mongod binary on first run; the first `npm test` may be slow. This is expected.
- The `.env` file holds a live Atlas credential. It must never be staged. If `git status` ever shows `.env` as tracked/untracked-and-about-to-be-added, stop and fix `.gitignore` first.
- Do NOT run the actual `vercel` deploy — that requires the user's authenticated account and is out of scope for this branch.
