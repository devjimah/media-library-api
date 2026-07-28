// Multer upload middleware — configures disk storage, accepted MIME types, and file size limits.
// Importing this file and calling upload.single('file') handles all file-upload concerns
// before the request reaches the controller.

import multer, { FileFilterCallback } from 'multer';
import fs from 'fs';
import path from 'path';
import { Request } from 'express';
import { AppError } from '../utils/AppError';
import logger from '../config/logger';

/**
 * Accepted MIME types and the file extensions each may carry.
 * The declared Content-Type of a multipart part is client-controlled, so the
 * extension must be checked too — otherwise "evil.html" declared as image/png
 * passes the filter and express.static later serves it as text/html (stored XSS).
 */
const ALLOWED_TYPES: Record<string, string[]> = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'application/pdf': ['.pdf']
};

/** Maximum file size in bytes (5 MB) */
const MAX_FILE_SIZE = (Number(process.env.MAX_FILE_SIZE_MB) || 5) * 1024 * 1024;

/** Directory where uploaded files are persisted */
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';

// Ensure the upload directory exists — Multer's destination callback errors with
// ENOENT if the directory is missing. This is best-effort and MUST NOT crash the
// process at module load: on a read-only serverless filesystem (e.g. Vercel, where
// only /tmp is writable) mkdir throws, and letting that escape would take down every
// route — even ones that never touch uploads. On failure we log and continue; a real
// upload will surface its own error later if the directory truly can't be used.
try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (err) {
    logger.warn(
        `Could not pre-create upload directory "${UPLOAD_DIR}": ${(err as Error).message}. ` +
        'Set UPLOAD_DIR to a writable path (e.g. /tmp/uploads on serverless).'
    );
}

// ---------------------------------------------------------------------------
// Disk storage engine
// ---------------------------------------------------------------------------

const storage = multer.diskStorage({
    // What: Multer destination callback choosing where each file is written.
    // Does: Routes every upload into the configured /uploads directory.
    // If removed: Multer falls back to the OS temp directory, so files land outside
    //             the project and recorded filePaths no longer match reality.
    destination: (_req, _file, cb) => {
        cb(null, UPLOAD_DIR);
    },

    // What: Multer filename callback generating the on-disk name for each file.
    // Does: Prefixes a timestamp and replaces whitespace while preserving the original
    //       extension, so two users uploading "photo.png" never collide.
    // If removed: Multer generates random hex names with NO extension, breaking any
    //             tooling that relies on file extensions in /uploads.
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        const base = path.basename(file.originalname, ext).replace(/\s+/g, '_');
        const uniqueName = `${Date.now()}-${base}${ext}`;
        cb(null, uniqueName);
    }
});

// ---------------------------------------------------------------------------
// MIME-type filter
// ---------------------------------------------------------------------------

// What: Multer fileFilter enforcing the lab's accepted-type whitelist.
// Does: Accepts image/jpeg, image/png, and application/pdf — and only when the file
//       extension matches the declared type — rejecting anything else with a 400
//       AppError before the file is written to disk.
// If removed: Any file type (executables, scripts, videos) gets stored — a security
//             risk and a direct violation of the lab's upload restrictions.
const fileFilter = (
    _req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback
): void => {
    const allowedExtensions = ALLOWED_TYPES[file.mimetype];

    if (!allowedExtensions) {
        // Reject unsupported types — the error is caught by the global error handler
        cb(
            new AppError(
                `Unsupported file type: "${file.mimetype}". Accepted types: JPEG, PNG, PDF.`,
                400
            )
        );
        return;
    }

    const ext = path.extname(file.originalname).toLowerCase();

    if (!allowedExtensions.includes(ext)) {
        // Extension/type mismatch — the stored extension drives the Content-Type that
        // express.static serves later, so it must agree with the declared MIME type.
        cb(
            new AppError(
                `File extension "${ext || '(none)'}" does not match type "${file.mimetype}". ` +
                `Expected: ${allowedExtensions.join(', ')}.`,
                400
            )
        );
        return;
    }

    cb(null, true);
};

// ---------------------------------------------------------------------------
// Multer instance — used as route-level middleware
// ---------------------------------------------------------------------------

const upload = multer({
    storage,
    fileFilter,
    limits: {
        // Multer throws a LIMIT_FILE_SIZE error when this is exceeded;
        // the error handler maps it to a 400 response
        fileSize: MAX_FILE_SIZE
    }
});

export default upload;
