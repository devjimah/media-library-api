# Media Library API — Lab Review Report (Follow-up Bug Sweep)

**Date:** 2026-07-17
**Branch:** `BEM-34`
**Scope:** All files under `src/` (19 files), the new `public/` browser upload page,
and the uncommitted `app.ts` changes. Cross-checked against the
[2026-07-06 review](../../REVIEW-FINDINGS.md) and the lab requirements.
**Method:** Full manual read of every source file, `tsc --noEmit` type check, and
live runtime verification of the upload pipeline against a running app instance
(no database required — every exercised path resolves before the repository layer).

---

## Summary

The three critical bugs and four findings from the 2026-07-06 review are **genuinely
fixed** in the current code — each fix was re-verified by reading the shipped
implementation, not just the review's "fixed" note. The codebase is in good shape:
layering is clean, error handling is centralized, and orphan-file cleanup works in
both the validation and error-handler paths.

This sweep found **one new security bug (fixed during this review)** and four minor
findings (documented, not fixed).

| Severity | Count | Status |
| --- | --- | --- |
| 🔴 Security | 1 | **Fixed + verified 2026-07-17** |
| 🟡 Minor | 4 | Open — documented below |

---

## Verification of the 2026-07-06 findings

| # | Original finding | Current state |
| --- | --- | --- |
| 1 | `req.query` assignment throws in Express 5 | ✅ Fixed — `validate.ts` uses `Object.defineProperty` to shadow the getter |
| 2 | Update wipes tags via `.default([])` | ✅ Fixed — separate `tagsFieldCreate` / `tagsFieldUpdate` schemas; the update refine now works |
| 3 | `$text` inside `$or` rejected by MongoDB | ✅ Fixed — regex-only title search with `escapeRegex` (ReDoS-safe); text index removed |
| 4 | File-size message overwritten (error-handler ordering) | ✅ Fixed — `else if` on the Multer branch |
| 5 | Orphaned files on failed uploads | ✅ Fixed — cleanup in both `validate.ts` and `errorHandler.ts` via `removeUploadedFile` |
| 6 | `unhandledRejection` not graceful | ✅ Fixed — `shutdownWithFailure` drains via `server.close()` with a 10 s force-exit failsafe |
| 7 | Error responses missing `details` | ✅ Fixed — `details: []` always present; Mongoose validation errors populate it per field |

---

## 🔴 New finding 1 — Stored XSS via spoofed upload MIME type (FIXED)

**Files:** `src/middlewares/upload.ts`, `src/app.ts`

**Defect.** The Multer file filter whitelisted uploads by `file.mimetype` alone.
That value is the client-declared `Content-Type` of the multipart part — fully
attacker-controlled — and the **file extension was never validated**. Meanwhile the
filename callback preserves the original extension, and `express.static` derives the
response `Content-Type` from that extension.

**Attack.** Upload `evil.html` (containing `<script>…</script>`) with a declared
part type of `image/png`:

1. The filter sees `image/png` → accepted.
2. The file is stored as `uploads/<ts>-evil.html`.
3. `GET /uploads/<ts>-evil.html` is served with `Content-Type: text/html`.
4. The script executes on the API's origin — stored XSS.

**Fix applied (2026-07-17).**

1. `upload.ts` — the whitelist is now a MIME → extension map
   (`image/jpeg → .jpg/.jpeg`, `image/png → .png`, `application/pdf → .pdf`).
   A mismatch is rejected with a 400 **before the file is written to disk**.
2. `app.ts` — the `/uploads` static route now sends
   `X-Content-Type-Options: nosniff` on every response, so browsers cannot sniff a
   served file into a more dangerous type (defense in depth).

**Runtime verification (all against a live app instance):**

| Case | Expected | Result |
| --- | --- | --- |
| `evil.html` declared `image/png` | 400 extension-mismatch | ✅ PASS |
| `evil.exe` declared `application/octet-stream` | 400 unsupported type | ✅ PASS |
| Extensionless file declared `image/png` | 400 extension-mismatch | ✅ PASS |
| Real `.png` declared `image/png` | passes filter (fails later on missing title — proves legit files unaffected) | ✅ PASS |
| Uppercase `photo.JPG` declared `image/jpeg` | accepted (case-insensitive extension check) | ✅ PASS |
| Rejected uploads leave files on disk? | uploads dir unchanged | ✅ PASS |
| `GET /uploads/<file>` header | `X-Content-Type-Options: nosniff` | ✅ PASS |

`tsc --noEmit` passes clean after the change.

---

## 🟡 Minor findings (open)

### 2. Filename collisions overwrite silently

**File:** `src/middlewares/upload.ts` (filename callback)

Stored names are `${Date.now()}-${basename}${ext}`. Two uploads of the same filename
within the same millisecond write to the same path — the second silently clobbers
the first, and deleting either record unlinks the file both records point at.
Low probability, but trivially eliminated by adding a random component
(`crypto.randomUUID()` or a random suffix) to the generated name.

### 3. `?page=` (empty value) returns 400 instead of applying the default

**File:** `src/validation/mediaSchemas.ts`

`z.coerce.number()` coerces the empty string to `0`, which then fails `min(1)`.
A URL like `GET /media?page=&limit=` therefore 400s rather than falling back to the
defaults. If empty params should read as "absent", preprocess `'' → undefined`
before coercion. Arguably correct as-is — just be aware clients cannot send empty
values for numeric params.

### 4. `shutdownWithFailure` never closes the MongoDB connection

**File:** `src/server.ts`

The SIGTERM/SIGINT path closes the HTTP server **and** the Mongoose connection; the
`unhandledRejection` path only closes the HTTP server before `process.exit(1)`.
Survivable (the process exits anyway), but inconsistent with the graceful pattern
directly below it. Mirror the `mongoose.connection.close()` call.

### 5. Stored file paths are CWD-relative

**Files:** `src/middlewares/upload.ts`, `src/services/mediaService.ts`, `src/app.ts`

Multer stores relative paths (`uploads/...`), delete resolves them with
`path.resolve` (CWD-dependent), and the static route mounts a relative directory.
Running the server from any directory other than the project root breaks file
serving and deletion. Resolve `UPLOAD_DIR` to an absolute path once at startup and
use it everywhere; keep storing the relative form in `filePath` for URL portability.

---

## New surface reviewed: browser upload page (`public/`, `/upload` route)

The uncommitted `app.ts` change mounts `public/` at `/upload` (static
`index.html` + `styles.css` + `upload.js`). Reviewed and found sound:

- Posts to `/media` via `fetch` + `FormData`; infers `category` from the file type.
- Error messages surface the API's `message` field; the submit button is re-enabled
  in a `finally` block, so a failed upload never wedges the form.
- No secrets, no inline event handlers, no third-party scripts.
- The health-check JSON response at `GET /` is unaffected (page mounts at `/upload`).

---

## Requirements compliance

No change from the 2026-07-06 matrix — all six lab criteria still pass. The upload
hardening strengthens the *file upload handling* criterion beyond the lab baseline.

## Recommended next steps

1. Commit the current working tree (security fix + upload page) on `BEM-34`.
2. Address minor findings 2 and 4 — both are two-line fixes.
3. Decide on the empty-query-param semantics (finding 3) and document the choice.
4. Fold finding 5 into the BEM-34 production-readiness plan (it is a deploy-time
   concern, not a lab concern).
