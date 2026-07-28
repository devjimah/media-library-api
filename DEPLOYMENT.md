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
- Live deployment: **https://media-library-api.vercel.app**
- `GET https://media-library-api.vercel.app/health` → `{ "status": "ok", ... }`
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
