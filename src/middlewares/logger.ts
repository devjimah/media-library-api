// Request logger — prints method, URL, and response status for every request.
// Useful during development for tracing request flows.
// Safe to remove in production if a proper logging library (Winston, Pino) is added.

import { Request, Response, NextFunction } from 'express';
import appLogger from '../config/logger';

// What: Request-logging middleware applied to every incoming request.
// Does: Records the start time, then logs method, URL, status code, and duration
//       once the response finishes.
// If removed: The server runs fine but produces no request trace — debugging and
//             observability during development become much harder.
const logger = (req: Request, res: Response, next: NextFunction): void => {
    // Capture the start time so we can log response duration
    const start = Date.now();

    // What: 'finish' event listener on the response object.
    // Does: Fires after the status code and body are sent, then writes the log line
    //       with the measured duration.
    // If removed: Nothing is ever logged — the middleware becomes a no-op pass-through.
    res.on('finish', () => {
        const duration = Date.now() - start;
        appLogger.info(`${req.method} ${req.originalUrl} ${res.statusCode} — ${duration}ms`);
    });

    next();
};

export default logger;
