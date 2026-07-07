# Media Library API — Code Review Findings

**Date:** 2026-07-06
**Reviewed against:** Media Library API lab requirements
**Scope:** All files under `src/`, plus `package.json`, `.gitignore`, `.env.example`

> **UPDATE 2026-07-07 — all findings below are FIXED and verified.**
> Every bug (1–4) and finding (5–7 + minor items) was fixed, plus a project-wide
> comment convention was added (`What / Does / If removed` above every function).
> Verified live against MongoDB Atlas with 14 end-to-end requests covering all five
> endpoints and every lab edge case (invalid type, oversized file, missing fields,
> invalid query params, tags survival on update, empty update body, orphan-file
> cleanup, invalid/unknown ids). All returned the expected status and body.

---

## Summary

The project is well structured and hits most of the lab requirements: clean four-layer
architecture, a reusable `AppError` class, centralized error handling, Zod validation with
field-level error details, correct Multer configuration (disk storage, 5MB limit, MIME
whitelist), `catchAsync` everywhere, and `Promise.all()` for the paginated list + count.

However, **three confirmed bugs** — one of which breaks `GET /media` entirely — and several
smaller deviations were found. Bugs 1 and 2 were reproduced with runtime tests against the
installed dependency versions.

---

## 🔴 Critical

### 1. `GET /media` returns 500 for every *valid* request (Express 5 `req.query` is read-only)

**File:** [src/middlewares/validate.ts:42](src/middlewares/validate.ts#L42)

After successful validation, the middleware writes the parsed result back:

```ts
(req as unknown as Record<string, unknown>)[target] = result.data;
```

In Express 5, `req.query` is defined as a **getter-only** property on the request prototype
(`node_modules/express/lib/request.js:217`). Assigning to it throws in strict mode (all
compiled TS/ESM code is strict):

```
TypeError: Cannot set property query of #<IncomingMessage> which has only a getter
```

**Verified at runtime** with the installed Express 5.1: a test route assigning `req.query`
returned 500 with exactly this error.

**Effect (ironic):** requests with *invalid* query params get a correct 400 (validation runs
on the raw query and responds before the assignment), but every request with *valid* params
throws at the assignment and returns 500. The list endpoint is effectively dead.

**Fix options:**
- Skip re-assignment for `query` and let the controller keep its manual coercion
  (it already re-coerces at [src/controllers/mediaController.ts:50-58](src/controllers/mediaController.ts#L50-L58)), or
- Store parsed data on `res.locals.validatedQuery` (or `req.validatedQuery` via a type
  augmentation) and read that in the controller, or
- Use `Object.defineProperty(req, 'query', { value: result.data })` (works because the
  prototype getter is `configurable: true`).

---

### 2. `PUT /media/:id` silently wipes existing tags on any update

**Files:** [src/validation/mediaSchemas.ts:20-26](src/validation/mediaSchemas.ts#L20-L26) (shared `tagsField`),
[src/services/mediaService.ts:104](src/services/mediaService.ts#L104)

`tagsField` ends with `.optional().default([])`. That default is correct for **create**, but
the same field is reused in `updateMediaSchema`, so Zod injects `tags: []` into every parsed
update body even when the client never sent tags. The service then sees
`body.tags !== undefined` and overwrites the stored tags with `[]`.

**Verified at runtime** with the installed Zod 3.23:

```
input { title: "New" }  →  parsed { title: "New", tags: [] }   // tags wiped
input {}                →  parsed { tags: [] }                  // see below
```

**Bonus defect:** the `.refine()` guard "At least one field must be provided" can never fire —
an empty body `{}` passes validation because the tags default makes the object non-empty.

**Fix:** define a separate tags schema for updates without `.default([])` (just
`.optional()`), and make the refine check the *raw* keys or check
`title/category/tags` explicitly.

---

### 3. Search (`?search=`) will fail: `$text` inside `$or` with an unindexed regex clause

**File:** [src/repositories/mediaRepository.ts:41-46](src/repositories/mediaRepository.ts#L41-L46)

```ts
filter.$or = [
    { $text: { $search: search } },
    { title: { $regex: search, $options: 'i' } }
];
```

MongoDB requires that when `$text` appears inside `$or`, **all other `$or` clauses must be
supported by indexes**. `title` only has a *text* index
([src/models/Media.ts:71](src/models/Media.ts#L71)); a case-insensitive regex clause cannot
use it, so the query planner rejects the query at runtime with an error like
*"Failed to produce a solution for TEXT under OR — other non-TEXT clauses under OR have to
be indexed as well"*. The comment "falls back to regex" describes behavior MongoDB does not
have — `$or` is not a fallback chain.

*(Not executed against a live database in this review, but this is a documented MongoDB
restriction; confirm by running `GET /media?search=x` with the server up.)*

**Fix:** pick one strategy — regex-only (`filter.title = { $regex: search, $options: 'i' }`,
simple and sufficient for the lab) or `$text`-only at the filter top level.

---

## 🟠 Moderate

### 4. Custom file-size error message is dead code (error-handler ordering)

**File:** [src/middlewares/errorHandler.ts:60-72](src/middlewares/errorHandler.ts#L60-L72)

Two consecutive (non-`else`) `if` blocks both match a `LIMIT_FILE_SIZE` error: the first sets
the friendly "Maximum allowed size is 5MB" message; the second
(`if (err instanceof multer.MulterError)`) then **overwrites** it with the generic
`File upload error: File too large`. The status is still 400, so the lab requirement is met,
but the specific message never reaches the client. Make the second block an `else if`.

### 5. Orphaned files on failed uploads

**Files:** [src/routes/mediaRoutes.ts:18-23](src/routes/mediaRoutes.ts#L18-L23),
[src/controllers/mediaController.ts:26-38](src/controllers/mediaController.ts#L26-L38)

Multer saves the file to disk **before** Zod validation runs. If validation fails (e.g.
missing `title`), or the DB insert throws, the request is rejected but the uploaded file
stays in `/uploads` forever with no DB record pointing at it. Add cleanup: on validation
failure or controller error, `fs.unlink(req.file.path)` (e.g. in the validate middleware's
failure branch or in the error handler when `req.file` exists).

### 6. `unhandledRejection` handler is not graceful (contradicts its own comment)

**File:** [src/server.ts:21-26](src/server.ts#L21-L26)

The comment says "Allow in-flight requests to complete, then exit" but the code calls
`process.exit(1)` immediately, killing in-flight requests. The lab asks for graceful
shutdown. Standard pattern: keep a reference to the HTTP server and call
`server.close(() => process.exit(1))` (the handler is currently registered before `server`
exists — restructure so it can see it, or set a module-level variable).

### 7. Generic error responses omit the `details` field

**File:** [src/middlewares/errorHandler.ts:93-96](src/middlewares/errorHandler.ts#L93-L96)

The lab's standard error format is `{ "status": "error", "message": "...", "details": [] }`.
The validation middleware returns `details` correctly, but the global error handler returns
only `{ status, message }`. Low impact, but for strict spec compliance add `details: []`
(and consider routing Mongoose `ValidationError` field errors into it instead of a
comma-joined string).

---

## 🟡 Minor / observations

- **Redundant double coercion:** the controller re-parses `req.query` manually
  ([mediaController.ts:50-58](src/controllers/mediaController.ts#L50-L58)) even though Zod
  already coerced and defaulted everything. Once Bug 1 is fixed by passing validated data
  through, this block can collapse to a single cast.
- **Upload directory existence:** Multer's `destination` callback assumes `uploads/` exists.
  It's tracked via `.gitkeep`, but an `fs.mkdir(UPLOAD_DIR, { recursive: true })` at startup
  would make the app robust to a custom `UPLOAD_DIR` env value.
- **`:id` params are not Zod-validated** — acceptable, since Mongoose `CastError` is mapped
  to a 400 in the error handler.
- **`deleteMediaRecord` does two DB round-trips** (find, then delete). `findByIdAndDelete`
  already returns the deleted doc (the repository comment even says so) — one call suffices.
- **`.env` is present locally.** The folder is not yet a git repository; `.gitignore` does
  list `.env`, so it will be excluded once `git init` runs. Keep it that way.

---

## Requirements compliance matrix

| Lab criterion (weight) | Status | Notes |
|---|---|---|
| Layered architecture (20%) | ✅ Pass | routes → controllers → services → repositories cleanly separated; no business logic in routes; extra `types/` and `validation/` folders are reasonable additions |
| Global error handling (20%) | ✅ Pass (after fixes) | `AppError` + centralized handler registered last; process-level handlers present; Bug 4, Finding 6, and Finding 7 fixed on 2026-07-07 |
| Request validation (15%) | ✅ Pass (after fixes) | Reusable Zod middleware with field-level errors; Bug 1 (query flow) and Bug 2 (updates) fixed on 2026-07-07 |
| File upload handling (20%) | ✅ Pass | Disk storage to `/uploads`, MIME whitelist (jpeg/png/pdf), 5MB limit, all 7 metadata fields stored; Finding 5 (orphaned files) fixed on 2026-07-07 |
| Pagination, filtering & search (15%) | ✅ Pass (after fixes) | Defaults, max limit 50, category/tags filters and sort logic correct; Bug 1 (500s) and Bug 3 (search) fixed and verified live on 2026-07-07 |
| Async/await & promise handling (10%) | ✅ Pass | `catchAsync` wraps all handlers; `Promise.all()` used for results + count; no `.then()` chains; rejection/exception handlers registered |

---

## Recommended fix order

1. **Bug 1** — validate middleware `req.query` assignment (unblocks the entire list endpoint).
2. **Bug 2** — update schema tags default (data loss on every update).
3. **Bug 3** — search filter (`$text`/`$or`).
4. **Bug 4** — error-handler `else if`.
5. Findings 5–7 as polish.

After fixing, test the lab's edge cases end-to-end: invalid file type, oversized file,
missing fields, invalid query params — plus a valid `GET /media?search=...&tags=...` and a
title-only `PUT` (confirm tags survive).
