// removeUploadedFile — best-effort cleanup for files Multer has already saved to disk
// when the request that carried them ultimately fails (validation error, DB error, etc.).
// Prevents /uploads from accumulating orphaned files with no database record.

import fs from 'fs/promises';
import logger from '../config/logger';

// What: Fire-and-forget deleter for an uploaded file attached to a failed request.
// Does: Unlinks file.path if a file is present; logs (never throws) when deletion fails,
//       because cleanup must not mask the original request error.
// If removed: Every rejected upload (bad metadata, DB failure) leaves its file orphaned
//             in /uploads forever, silently consuming disk space.
const removeUploadedFile = (file?: Express.Multer.File): void => {
    if (!file?.path) return;

    fs.unlink(file.path).catch((err: Error) => {
        logger.warn(`Could not clean up uploaded file at ${file.path}: ${err.message}`);
    });
};

export default removeUploadedFile;
