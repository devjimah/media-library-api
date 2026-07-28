// Unit tests for environment validation — verifies validateEnv reports every
// missing required variable and passes when all are present. A Mongo URI counts
// as present if either MONGODB_URI or MONGODB_ATLAS_URI is set.

import { validateEnv } from '../../config/env';

const complete = (): NodeJS.ProcessEnv => ({
    NODE_ENV: 'test',
    PORT: '3000',
    MONGODB_URI: 'mongodb://localhost:27017/x',
    MAX_FILE_SIZE_MB: '5',
    UPLOAD_DIR: 'uploads',
    LOG_LEVEL: 'info'
});

describe('validateEnv', () => {
    it('returns no errors when all required vars are present', () => {
        expect(validateEnv(complete())).toEqual([]);
    });

    it('accepts MONGODB_ATLAS_URI in place of MONGODB_URI', () => {
        const env = complete();
        delete env.MONGODB_URI;
        env.MONGODB_ATLAS_URI = 'mongodb://atlas/x';
        expect(validateEnv(env)).toEqual([]);
    });

    it('accepts the generic DATABASE_URL in place of MONGODB_URI', () => {
        const env = complete();
        delete env.MONGODB_URI;
        env.DATABASE_URL = 'mongodb://localhost:27017/x';
        expect(validateEnv(env)).toEqual([]);
    });

    it('reports a missing Mongo URI', () => {
        const env = complete();
        delete env.MONGODB_URI;
        const errors = validateEnv(env);
        expect(errors.some((e) => e.includes('MONGODB_URI'))).toBe(true);
    });

    it('reports each missing simple variable', () => {
        const env = complete();
        delete env.PORT;
        delete env.LOG_LEVEL;
        const errors = validateEnv(env);
        expect(errors.some((e) => e.includes('PORT'))).toBe(true);
        expect(errors.some((e) => e.includes('LOG_LEVEL'))).toBe(true);
    });
});
