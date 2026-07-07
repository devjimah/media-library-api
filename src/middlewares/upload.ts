// Multer upload middleware — configures disk storage, accepted MIME types, and file size limits.
// Importing this file and calling upload.single('file') handles all file-upload concerns
// before the request reaches the controller.

import multer, { FileFilterCallback } from 'multer';
import fs from 'fs';
import path from 'path';
import { Request } from 'express';
import { AppError } from '../utils/AppError';

/** Accepted MIME types — any other type is rejected with a 400 error */
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

/** Maximum file size in bytes (5 MB) */
const MAX_FILE_SIZE = (Number(process.env.MAX_FILE_SIZE_MB) || 5) * 1024 * 1024;

/** Directory where uploaded files are persisted */
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';

// Ensure the upload directory exists at startup — Multer's destination callback
// errors with ENOENT if the directory is missing (e.g. custom UPLOAD_DIR values).
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
// Does: Accepts image/jpeg, image/png, and application/pdf; rejects anything else with
//       a 400 AppError before the file is written to disk.
// If removed: Any file type (executables, scripts, videos) gets stored — a security
//             risk and a direct violation of the lab's upload restrictions.
const fileFilter = (
    _req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback
): void => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        // Accept the file
        cb(null, true);
    } else {
        // Reject unsupported types — the error is caught by the global error handler
        cb(
            new AppError(
                `Unsupported file type: "${file.mimetype}". Accepted types: JPEG, PNG, PDF.`,
                400
            )
        );
    }
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
