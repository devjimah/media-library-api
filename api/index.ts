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

// What: Serverless request handler exported to the Vercel Node runtime.
// Does: Ensures a single lazy MongoDB connection is established, then delegates the
//       request to the Express app.
// If removed: Vercel has no entry to invoke and the deployment serves nothing.
export default async function handler(req: Request, res: Response): Promise<void> {
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
