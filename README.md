# Media Library API

A production-grade REST API for managing media assets (images and PDFs), built with
**Node.js, Express 5, TypeScript, MongoDB (Mongoose), Multer, and Zod**.

Content teams can upload files with metadata, then search, filter, paginate, update,
and delete them — with consistent, structured responses for every success and failure
case.

## Features

- **Layered architecture** — routes → controllers → services → repositories, with
  strict separation of concerns (no business logic in routes or controllers, no DB
  calls outside the repository layer)
- **File uploads** — single-file upload via Multer disk storage with a MIME-type
  **and matching-extension** whitelist (JPEG, PNG, PDF) and a 5 MB size limit, all
  enforced *before* the request reaches any controller
- **Request validation** — reusable Zod middleware producing structured, field-level
  error details for bodies and query strings
- **Pagination, filtering & search** — page/limit with sane defaults and caps,
  category and tag filters, case-insensitive title search (regex-escaped to prevent
  ReDoS), and configurable sorting
- **Global error handling** — a single error middleware normalises `AppError`,
  Mongoose, MongoDB, and Multer errors into one response shape; internals are masked
  in production
- **Async safety** — every handler is wrapped in `catchAsync`; process-level
  `unhandledRejection` / `uncaughtException` handlers log and shut down gracefully;
  `Promise.all()` fetches page results and total count in parallel
- **No orphaned files** — uploads whose requests later fail (validation or DB errors)
  are automatically deleted from disk; deleting a record also removes its file
- **Static file serving** — every stored `filePath` is directly downloadable via
  `GET /uploads/<filename>`, served with `X-Content-Type-Options: nosniff`
- **Upload hardening** — the declared `Content-Type` of an upload is client-controlled,
  so the file extension must also match the declared type; combined with `nosniff`
  this prevents a disguised HTML file from ever being stored or rendered on the API
  origin (stored XSS)
- **Browser upload page** — a minimal static page at `GET /upload` for uploading
  files without a REST client

## Tech Stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js (TypeScript, compiled with `tsc`, dev-run with `tsx`) |
| Web framework | Express 5 |
| Database | MongoDB via Mongoose 9 |
| File uploads | Multer 2 (disk storage) |
| Validation | Zod 3 |
| Config | dotenv |

## Project Structure

```text
media-library-api/
├── src/
│   ├── app.ts                     # Express app factory (middleware + routes wiring)
│   ├── server.ts                  # Entry point: env, DB connect, listen, process handlers
│   ├── config/
│   │   └── db.ts                  # MongoDB connection (Atlas preferred, local fallback)
│   ├── routes/
│   │   └── mediaRoutes.ts         # Route definitions only — no logic
│   ├── controllers/
│   │   └── mediaController.ts     # Thin request/response handlers (all catchAsync-wrapped)
│   ├── services/
│   │   └── mediaService.ts        # Business logic; throws AppError for invalid states
│   ├── repositories/
│   │   └── mediaRepository.ts     # Raw Mongoose queries only
│   ├── models/
│   │   └── Media.ts               # Mongoose schema + indexes
│   ├── middlewares/
│   │   ├── upload.ts              # Multer config: disk storage, MIME filter, 5MB limit
│   │   ├── validate.ts            # Reusable Zod validation middleware factory
│   │   ├── errorHandler.ts        # Global error handler (registered last)
│   │   ├── notFound.ts            # 404 catch-all for unknown routes
│   │   └── logger.ts              # Request logger (method, path, status, duration)
│   ├── validation/
│   │   └── mediaSchemas.ts        # Zod schemas for create / update / query
│   ├── types/
│   │   ├── media.ts               # Shared TS contracts (document, params, responses)
│   │   └── errors.ts              # AppError interface
│   └── utils/
│       ├── AppError.ts            # Operational error class with HTTP status code
│       ├── catchAsync.ts          # Async handler wrapper → next(err)
│       └── removeUploadedFile.ts  # Best-effort cleanup for failed uploads
├── public/                        # Static browser upload page (served at /upload)
├── docs/
│   ├── reviews/                   # Dated lab review reports
│   └── superpowers/               # BEM-34 design spec + implementation plan
├── uploads/                       # Uploaded files (gitignored, .gitkeep tracked)
├── .env.example                   # Environment variable template
└── REVIEW-FINDINGS.md             # Code-review history for this project
```

**Request flow:** `route → Multer (uploads only) → Zod validation → controller → service → repository → MongoDB`

Every function in the codebase carries a three-line comment stating **what it is**,
**what it does**, and **what removing it would cause**.

## Getting Started

### Prerequisites

- Node.js 18+ (native `fetch`/`fs.promises` usage)
- A MongoDB instance — local or [MongoDB Atlas](https://www.mongodb.com/atlas)

### Installation

```bash
git clone <repository-url>
cd media-library-api
npm install
cp .env.example .env   # then fill in your values
```

### Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port the server listens on |
| `NODE_ENV` | `development` | `production` masks 500 messages and hides stack traces |
| `MONGODB_URI` | — | Local/self-hosted MongoDB connection string |
| `MONGODB_ATLAS_URI` | — | Atlas connection string; **takes precedence** over `MONGODB_URI` when set |
| `UPLOAD_DIR` | `uploads` | Directory for stored files (created automatically at startup) |
| `MAX_FILE_SIZE_MB` | `5` | Maximum upload size in megabytes |

At least one of `MONGODB_URI` / `MONGODB_ATLAS_URI` is required — startup fails fast
with a clear message otherwise.

### Running

```bash
npm run dev     # development — tsx watch mode with auto-restart
npm run build   # compile TypeScript to dist/
npm start       # run the compiled build (node dist/src/server.js)
```

On success you'll see the endpoint summary and `MongoDB connected: <db name>`.

## API Reference

Base URL: `http://localhost:<PORT>`

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/media` | Upload a media file with metadata |
| `GET` | `/media` | List media with pagination, filtering, and search |
| `GET` | `/media/:id` | Get a single media record |
| `PUT` | `/media/:id` | Update media metadata (file replacement not supported) |
| `DELETE` | `/media/:id` | Delete a media record and its file from disk |
| `GET` | `/uploads/:filename` | Download a stored file |
| `GET` | `/upload` | Minimal browser upload page |
| `GET` | `/` | Health check |

### Response Envelope

Every response uses one of two shapes:

```json
{ "status": "success", "data": { } }
```

```json
{ "status": "error", "message": "Validation failed", "details": [] }
```

`details` contains field-level entries for validation failures and is an empty array
for all other errors.

### POST /media — upload a file

`multipart/form-data` fields:

| Field | Required | Notes |
| --- | --- | --- |
| `file` | ✅ | The file itself — `image/jpeg` (`.jpg`/`.jpeg`), `image/png` (`.png`), or `application/pdf` (`.pdf`), max 5 MB; the extension must match the declared type |
| `title` | ✅ | 1–200 characters |
| `category` | ✅ | One of `image`, `document`, `other` |
| `tags` | — | Comma-separated string (`"a, b"`) or repeated array values; defaults to `[]` |

```bash
curl -X POST http://localhost:3000/media \
  -F "file=@photo.png" \
  -F "title=Team Offsite" \
  -F "tags=events, 2026" \
  -F "category=image"
```

`201 Created`:

```json
{
  "status": "success",
  "data": {
    "media": {
      "_id": "6a4cc62d11948b8590d56485",
      "title": "Team Offsite",
      "tags": ["events", "2026"],
      "category": "image",
      "filePath": "uploads/1783416365681-photo.png",
      "originalName": "photo.png",
      "mimeType": "image/png",
      "fileSize": 48213,
      "createdAt": "2026-07-07T09:26:05.763Z",
      "updatedAt": "2026-07-07T09:26:05.763Z"
    }
  }
}
```

Failure cases (all `400`): unsupported file type, file extension not matching the
declared type (e.g. `evil.html` sent as `image/png`), file over the size limit,
missing `file` field, or invalid metadata (returned with field-level `details`).
Files already written to disk for a failed request are deleted automatically —
type/extension rejections happen before the file is ever written.

### GET /media — list with pagination, filtering & search

| Query param | Default | Constraints |
| --- | --- | --- |
| `page` | `1` | Integer ≥ 1 |
| `limit` | `10` | Integer 1–50 |
| `category` | — | `image` \| `document` \| `other` |
| `tags` | — | Comma-separated; matches records containing **any** listed tag |
| `search` | — | Case-insensitive substring match on `title` (input is regex-escaped) |
| `sortBy` | `createdAt` | `createdAt` \| `title` \| `fileSize` \| `category` |
| `order` | `desc` | `asc` \| `desc` |

```bash
curl "http://localhost:3000/media?page=2&limit=10&category=image&tags=events&search=offsite&sortBy=createdAt&order=desc"
```

`200 OK`:

```json
{
  "status": "success",
  "data": {
    "results": [ ],
    "pagination": { "total": 84, "page": 2, "limit": 10, "totalPages": 9 }
  }
}
```

The page of results and the total count are fetched simultaneously with
`Promise.all()`. Invalid query parameters return `400` with per-field details.

### GET /media/:id

Returns the record or `404` when the id is unknown; malformed ObjectIds return `400`
(`"Invalid ID format."`).

### PUT /media/:id — update metadata

JSON body; all fields optional, but **at least one is required** (an empty body is a
`400`). Fields not included are left untouched — omitting `tags` does *not* clear
existing tags.

```bash
curl -X PUT http://localhost:3000/media/6a4cc62d11948b8590d56485 \
  -H "Content-Type: application/json" \
  -d '{ "title": "Team Offsite 2026", "tags": "events, offsite" }'
```

### DELETE /media/:id

Deletes the database record **and** the file on disk. A file already missing from
disk is logged and ignored — the database is the source of truth. Returns `200` with
a confirmation message, or `404` for unknown ids.

### Validation Error Example

```json
{
  "status": "error",
  "message": "Validation failed",
  "details": [
    { "field": "title", "message": "Title is required" },
    { "field": "category", "message": "Category must be one of: image, document, other" }
  ]
}
```

## Error Handling Design

- **`AppError`** — operational errors (404s, 400s) are thrown anywhere in the service
  layer with an HTTP status code and formatted by the global handler.
- **Global error middleware** (registered last) maps Mongoose validation errors
  (→ 400 with field details), cast errors (→ 400), duplicate keys (→ 409), and Multer
  errors (→ 400, with a specific message for oversized files) into the standard
  envelope. Unknown errors become 500s, with the message masked when
  `NODE_ENV=production`.
- **Process level** — `unhandledRejection` drains in-flight requests via
  `server.close()` (with a 10-second force-exit failsafe) before exiting;
  `uncaughtException` logs and exits immediately; `SIGINT`/`SIGTERM` trigger a
  graceful shutdown that also closes the MongoDB connection.

## Manual Testing Checklist

Edge cases worth exercising in Postman/Insomnia (all verified against this codebase):

- ✅ Valid upload → `201` with full metadata
- ✅ Unsupported file type (e.g. `.txt`) → `400` with accepted-types message
- ✅ Spoofed upload (`.html` declared as `image/png`) → `400` extension-mismatch, nothing written to disk
- ✅ Oversized file (> 5 MB) → `400` with size-limit message
- ✅ Missing/invalid metadata → `400` with field-level `details`, uploaded file cleaned up
- ✅ `GET /media` with filters, search, and sorting → paginated `200`
- ✅ Invalid query params (`page=0`, `limit=999`, `order=sideways`) → `400` with details
- ✅ Title-only `PUT` → tags preserved
- ✅ Empty-body `PUT` → `400`
- ✅ Malformed ObjectId → `400`; unknown id → `404`
- ✅ `DELETE` removes both the record and the file on disk

## Review History

- [REVIEW-FINDINGS.md](REVIEW-FINDINGS.md) — 2026-07-06 full lab review (3 bugs + 4 findings, all fixed and verified 2026-07-07)
- [docs/reviews/2026-07-17-lab-review-report.md](docs/reviews/2026-07-17-lab-review-report.md) — 2026-07-17 follow-up bug sweep (1 security fix + minor findings)

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

## License

MIT
