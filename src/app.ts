// Express application factory — creates and configures the app instance.
// Separating app creation from server startup allows this module to be imported
// in tests without binding to a port.

import express from 'express';
import logger from './middlewares/logger';
import errorHandler from './middlewares/errorHandler';
import notFound from './middlewares/notFound';
import mediaRoutes from './routes/mediaRoutes';

const app = express();

// ---------------------------------------------------------------------------
// Body parsers
// ---------------------------------------------------------------------------

// Parse JSON bodies — required for PUT /media/:id
app.use(express.json());

// Parse URL-encoded bodies — form submissions without files
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// Request logger
// ---------------------------------------------------------------------------

// Logs every request's method, path, status, and duration; safe to remove
app.use(logger);

// ---------------------------------------------------------------------------
// Health-check endpoint
// ---------------------------------------------------------------------------

// What: Health-check handler for the root path.
// Does: Responds 200 with service name/version so load balancers and monitors can
//       verify the process is alive without touching the database.
// If removed: Uptime checks pointed at GET / start failing with 404.
app.get('/', (_req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'media-library-api',
        version: '1.0.0',
        description: 'Production-grade Media Library API with file uploads, search, and pagination'
    });
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

// All media endpoints live under /media
app.use('/media', mediaRoutes);

// ---------------------------------------------------------------------------
// Static file serving — makes stored filePath values directly downloadable
// ---------------------------------------------------------------------------

// GET /uploads/<filename> streams the uploaded file from disk; without this route
// the filePath returned by the API points at files clients cannot retrieve.
app.use('/uploads', express.static(process.env.UPLOAD_DIR || 'uploads'));

// ---------------------------------------------------------------------------
// 404 — must come after all valid routes
// ---------------------------------------------------------------------------

app.use(notFound);

// ---------------------------------------------------------------------------
// Global error handler — must be last (4-argument signature required by Express)
// ---------------------------------------------------------------------------

app.use(errorHandler);

export default app;
