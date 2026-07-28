// Database connection — connects to MongoDB using Atlas URI when available, local URI otherwise.
// Removing this file or its export prevents the server from establishing a DB connection.

import mongoose from 'mongoose';
import logger from './logger';

// What: The application's single MongoDB connection routine.
// Does: Resolves the connection string (Atlas preferred, local fallback), fails fast when
//       neither is configured, and connects with a 5s server-selection timeout.
// If removed: The server starts without a database — every repository call throws and
//             all endpoints return 500.
const connectDB = async (): Promise<void> => {
    // Prefer the Atlas connection when configured; fall back to MONGODB_URI, then to
    // the lab's generic DATABASE_URL. Any of the three may carry the connection string.
    const uri =
        process.env.MONGODB_ATLAS_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;

    if (!uri) {
        throw new Error(
            'No MongoDB connection string defined. Set DATABASE_URL, MONGODB_URI, or MONGODB_ATLAS_URI in environment variables.'
        );
    }

    await mongoose.connect(uri, {
        // Fail fast if Atlas is unreachable rather than hanging for 30 s
        serverSelectionTimeoutMS: 5000
    });

    logger.info(`MongoDB connected: ${mongoose.connection.name}`);
};

export default connectDB;
