// Server entry point — loads environment variables, connects to MongoDB,
// starts the HTTP server, and registers process-level error handlers.
// This file is the only place that calls app.listen() and connectDB().

import 'dotenv/config';
import http from 'http';
import mongoose from 'mongoose';
import app from './app';
import connectDB from './config/db';

const PORT = process.env.PORT || 3000;

// Module-level server reference so the process-level handlers (registered before
// startup) can close it gracefully once it exists.
let server: http.Server | undefined;

// ---------------------------------------------------------------------------
// Process-level exception handlers
// Must be registered before startServer() so they capture any bootstrap errors.
// ---------------------------------------------------------------------------

// What: Shared graceful-exit helper for the process-level failure handlers.
// Does: Stops accepting new connections, lets in-flight requests finish, then exits
//       with code 1; exits immediately when the server hasn't started yet. A 10s
//       failsafe timer guarantees the process cannot hang on stuck connections.
// If removed: Fatal errors either kill in-flight requests mid-response or, worse,
//             leave the process running in a corrupted state.
const shutdownWithFailure = (): void => {
    if (server) {
        // Failsafe: force-exit if connections refuse to drain within 10 seconds
        const forceExit = setTimeout(() => process.exit(1), 10_000);
        forceExit.unref();

        server.close(() => process.exit(1));
    } else {
        process.exit(1);
    }
};

// What: Global handler for unhandled promise rejections (e.g. a missing await/catch).
// Does: Logs the rejection reason, then shuts the server down gracefully — in-flight
//       requests complete, but no new work is accepted in a possibly broken state.
// If removed: Node's default behaviour kills the process instantly with no logging
//             and no chance for open requests to finish (lab requires handling this).
process.on('unhandledRejection', (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error(`[UNHANDLED REJECTION] ${message}`);
    shutdownWithFailure();
});

// What: Global handler for uncaught synchronous exceptions.
// Does: Logs the error and stack, then exits immediately — after an uncaught throw,
//       Node's internal state may be corrupted, so draining requests is unsafe.
// If removed: The process dies with Node's default crash output and nothing is
//             logged in the application's format (lab requires handling this).
process.on('uncaughtException', (err: Error) => {
    console.error(`[UNCAUGHT EXCEPTION] ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
});

// ---------------------------------------------------------------------------
// Startup sequence
// ---------------------------------------------------------------------------

// What: Application bootstrap — the only function that starts the HTTP server.
// Does: Connects to MongoDB first, then binds the Express app to the configured port
//       and registers SIGTERM/SIGINT graceful-shutdown handlers.
// If removed: Nothing ever listens for HTTP traffic; the process starts and exits.
const startServer = async (): Promise<void> => {
    try {
        // Connect to the database before accepting any HTTP traffic
        await connectDB();

        server = app.listen(PORT, () => {
            console.log(`\n✅  Media Library API running on http://localhost:${PORT}`);
            console.log(`   Health check  →  GET  /`);
            console.log(`   Upload media  →  POST /media`);
            console.log(`   List media    →  GET  /media`);
            console.log(`   Get media     →  GET  /media/:id`);
            console.log(`   Update media  →  PUT  /media/:id`);
            console.log(`   Delete media  →  DELETE /media/:id\n`);
        });

        // -----------------------------------------------------------------------
        // Graceful shutdown handlers — borrowed from BEM-32 lab
        // Close the HTTP server first so no new connections arrive,
        // then close the MongoDB connection to prevent data corruption.
        // -----------------------------------------------------------------------

        // What: Signal-triggered graceful shutdown routine (SIGTERM/SIGINT).
        // Does: Stops the HTTP server, closes the MongoDB connection once requests
        //       drain, and exits with code 0.
        // If removed: Ctrl+C / container stop kills the process mid-request and can
        //             leave MongoDB connections dangling.
        const gracefulShutdown = (signal: string): void => {
            console.log(`\nReceived ${signal}. Shutting down gracefully...`);

            server?.close(async () => {
                try {
                    await mongoose.connection.close();
                    console.log('MongoDB connection closed.');
                } catch (closeErr) {
                    const message = closeErr instanceof Error ? closeErr.message : 'Unknown error';
                    console.error('Error closing MongoDB connection:', message);
                }
                console.log('Server closed. Exiting.');
                process.exit(0);
            });
        };

        // Container stop / Kubernetes pod eviction
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

        // Keyboard Ctrl+C interrupt
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown startup error';
        console.error('Failed to start server:', message);
        process.exit(1);
    }
};

startServer();
