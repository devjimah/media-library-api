// Environment loader + validator. Loads per-environment .env files via dotenv-flow
// (keyed on NODE_ENV), then fails fast if any required variable is missing so the
// process never starts in a half-configured state.

import dotenvFlow from 'dotenv-flow';

// Simple required vars (must be non-empty strings).
const REQUIRED_SIMPLE = ['NODE_ENV', 'PORT', 'MAX_FILE_SIZE_MB', 'UPLOAD_DIR', 'LOG_LEVEL'] as const;

// What: Pure validator for a given environment object.
// Does: Returns a list of human-readable messages for every missing required variable;
//       an empty list means the environment is valid. A Mongo URI is satisfied by either
//       MONGODB_URI or MONGODB_ATLAS_URI. Kept pure (no process.exit) so it is unit-testable.
// If removed: Startup validation has nothing to call and misconfiguration surfaces as
//             confusing downstream runtime errors instead of a clear startup failure.
export const validateEnv = (env: NodeJS.ProcessEnv): string[] => {
    const missing: string[] = [];

    for (const key of REQUIRED_SIMPLE) {
        if (!env[key] || env[key]?.trim() === '') {
            missing.push(`Missing required environment variable: ${key}`);
        }
    }

    // A Mongo connection string may be supplied under any of these names.
    // DATABASE_URL is the generic name from the lab brief; MONGODB_URI /
    // MONGODB_ATLAS_URI are the app's existing (Atlas-preferred) convention.
    const hasMongo =
        (env.MONGODB_URI && env.MONGODB_URI.trim() !== '') ||
        (env.MONGODB_ATLAS_URI && env.MONGODB_ATLAS_URI.trim() !== '') ||
        (env.DATABASE_URL && env.DATABASE_URL.trim() !== '');
    if (!hasMongo) {
        missing.push(
            'Missing required environment variable: DATABASE_URL (or MONGODB_URI / MONGODB_ATLAS_URI)'
        );
    }

    return missing;
};

// What: Application environment bootstrap called once at startup.
// Does: Loads the correct .env files with dotenv-flow, validates them, and on any
//       missing variable prints every problem and exits the process with code 1.
// If removed: Env files are never loaded and the app runs with an unvalidated,
//             possibly incomplete configuration.
const loadEnv = (): void => {
    dotenvFlow.config();

    const errors = validateEnv(process.env);
    if (errors.length > 0) {
        // eslint-disable-next-line no-console
        console.error('Environment validation failed:');
        for (const err of errors) console.error(`  - ${err}`);
        process.exit(1);
    }
};

export default loadEnv;
