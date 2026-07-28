// Vercel serverless entry point. Unlike server.ts it never calls app.listen() —
// Vercel invokes the exported Express app as a request handler. The DB connection
// is established lazily on the first request and reused across warm invocations.

import type { Request, Response } from 'express';
import loadEnv from '../src/config/env';
import connectDB from '../src/config/db';
import app from '../src/app';
import logger from '../src/config/logger';

loadEnv();

// Cache the connection promise across warm invocations so we connect at most once.
let dbReady: Promise<void> | null = null;

// Liveness routes that must answer even when the database is down. The lab's
// /health check exists precisely to report "the process is alive" cheaply, so it
// (and the service-info root) must never be gated behind the DB connection.
const DB_FREE_PATHS = new Set(['/health', '/']);

// What: Serverless request handler exported to the Vercel Node runtime.
// Does: For liveness paths, delegates straight to the app; for everything else,
//       ensures a single lazy MongoDB connection is established first, then delegates.
// If removed: Vercel has no entry to invoke and the deployment serves nothing.
export default async function handler(req: Request, res: Response): Promise<void> {
    // Health/root never depend on the database — answer them without connecting.
    if (DB_FREE_PATHS.has(req.url ?? '')) {
        app(req, res);
        return;
    }

    try {
        if (!dbReady) dbReady = connectDB();
        await dbReady;
    } catch (err) {
        // A transient failure on the first (cold-start) connect would otherwise be
        // cached forever as a rejected promise, permanently bricking this warm
        // instance. Clear the cache so the next request retries, and answer this
        // request with a clean 503 instead of letting the rejection hang unanswered.
        dbReady = null;
        const message = err instanceof Error ? err.message : 'Unknown database error';
        logger.error(`Database connection failed: ${message}`);
        res.status(503).json({ status: 'error', message: 'Service unavailable', details: [] });
        return;
    }
    app(req, res);
}
