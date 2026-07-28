// Zod validation middleware factory — creates reusable validation middleware
// for any Zod schema against req.body, req.query, or req.params.
// When validation fails, it returns a structured field-level error response
// instead of forwarding the request to the controller.

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import removeUploadedFile from '../utils/removeUploadedFile';
import logger from '../config/logger';

type ValidationTarget = 'body' | 'query' | 'params';

// What: Factory that builds an Express validation middleware for one Zod schema.
// Does: Parses req[target] with the schema; on failure responds 400 with field-level
//       details (and deletes any Multer-saved file); on success stores the parsed data.
// If removed: Controllers receive raw, unvalidated input — invalid payloads reach the
//             service/DB layers and the lab's structured validation errors disappear.
const validate = (schema: ZodSchema, target: ValidationTarget = 'body') => {
    // What: The actual per-request validation middleware returned by the factory.
    // Does: Runs schema.safeParse on the chosen request target and branches on the result.
    // If removed: The factory returns nothing and Express throws at route registration.
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req[target]);

        if (!result.success) {
            // A file may already be on disk (Multer runs before validation on POST /media).
            // Delete it so failed requests never leave orphaned files in /uploads.
            removeUploadedFile(req.file);

            // Map ZodError issues to the { field, message } shape specified by the lab
            const details = result.error.issues.map((issue: ZodError['issues'][number]) => ({
                field: issue.path.join('.') || 'unknown',
                message: issue.message
            }));

            // Validation failures are expected/operational — log at warn, not error.
            logger.warn(
                `Validation error on ${target}: ${details.map((d) => `${d.field} (${d.message})`).join('; ')}`
            );

            res.status(400).json({
                status: 'error',
                message: 'Validation failed',
                details
            });
            return;
        }

        // Expose the Zod-parsed (coerced + defaulted) value to downstream handlers.
        // Express 5 defines req.query with a getter-only accessor, so plain assignment
        // throws a TypeError; defineProperty shadows the prototype getter safely.
        Object.defineProperty(req, target, {
            value: result.data,
            writable: true,
            enumerable: true,
            configurable: true
        });

        next();
    };
};

export default validate;
