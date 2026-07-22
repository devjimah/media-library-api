// Global error handler — must be the last middleware registered in Express.
// All errors thrown with AppError or forwarded via next(err) land here.
// Extends the BEM-32 pattern with Multer-specific error handling.

import { Request, Response, NextFunction } from 'express';
import { Error as MongooseError } from 'mongoose';
import multer from 'multer';
import { AppErrorInterface } from '../types/errors';
import removeUploadedFile from '../utils/removeUploadedFile';
import logger from '../config/logger';

// Extend AppErrorInterface to accommodate MongoDB and Multer error codes
interface ExtendedError extends AppErrorInterface {
    code?: number | string;
    keyValue?: Record<string, unknown>;
}

/** Field-level error entry included in the standard error response */
interface ErrorDetail {
    field: string;
    message: string;
}

// What: The global Express error-handling middleware (4-arg signature is mandatory).
// Does: Normalises AppError, Mongoose, MongoDB, and Multer errors into the standard
//       { status, message, details } response, cleans up any uploaded file from the
//       failed request, logs the error, and masks internals in production.
// If removed: Errors fall through to Express's default HTML error page — no consistent
//             JSON responses, no Multer/Mongoose mapping, and stack traces leak to clients.
const errorHandler = (
    err: ExtendedError,
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    let statusCode = err.statusCode ?? 500;
    let message = err.message || 'Internal Server Error';
    let details: ErrorDetail[] = [];
    const isProduction = process.env.NODE_ENV === 'production';

    // A file may already be on disk (Multer runs first on POST /media). If the request
    // failed after the upload, delete the file so /uploads never collects orphans.
    removeUploadedFile(req.file);

    // -----------------------------------------------------------------------
    // Mongoose — field-level validation failure → 400
    // -----------------------------------------------------------------------
    if (err instanceof MongooseError.ValidationError) {
        statusCode = 400;
        message = 'Validation failed';
        details = Object.values(err.errors).map((e) => ({
            field: e.path,
            message: e.message
        }));
    }

    // -----------------------------------------------------------------------
    // Mongoose — invalid ObjectId format → 400
    // -----------------------------------------------------------------------
    if (err instanceof MongooseError.CastError) {
        statusCode = 400;
        message = 'Invalid ID format.';
    }

    // -----------------------------------------------------------------------
    // MongoDB — duplicate key (e.g. unique index violation) → 409
    // -----------------------------------------------------------------------
    if (err.code === 11000 && err.keyValue) {
        statusCode = 409;
        const field = Object.keys(err.keyValue)[0];
        message = `A record with that ${field} already exists.`;
    }

    // -----------------------------------------------------------------------
    // Multer — file size exceeded → 400 (specific), any other Multer error → 400 (generic).
    // The else-if matters: a plain second `if` would overwrite the size-specific message.
    // -----------------------------------------------------------------------
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        statusCode = 400;
        const maxMB = process.env.MAX_FILE_SIZE_MB || '5';
        message = `File is too large. Maximum allowed size is ${maxMB}MB.`;
    } else if (err instanceof multer.MulterError) {
        statusCode = 400;
        message = `File upload error: ${err.message}`;
    }

    // -----------------------------------------------------------------------
    // Mask internal details in production to prevent information leakage
    // -----------------------------------------------------------------------
    if (statusCode === 500 && isProduction) {
        message = 'Internal Server Error';
    }

    // Log error details for observability. 4xx are expected/operational (warn);
    // 5xx are real failures (error). Stack only in development.
    if (statusCode >= 500) {
        logger.error(`[${statusCode}] ${err.message}`);
        if (!isProduction && err.stack) logger.error(err.stack);
    } else {
        logger.warn(`[${statusCode}] ${err.message}`);
    }

    // Guard against writing headers twice (e.g. after a streaming response)
    if (res.headersSent) {
        next(err);
        return;
    }

    res.status(statusCode).json({
        status: 'error',
        message,
        details
    });
};

export default errorHandler;
