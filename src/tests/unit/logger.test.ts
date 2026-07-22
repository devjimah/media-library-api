// Unit test for the Winston logger — verifies it is a usable logger honouring LOG_LEVEL.

import logger from '../../config/logger';

describe('logger', () => {
    it('exposes the standard log methods', () => {
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.error).toBe('function');
        expect(typeof logger.debug).toBe('function');
    });

    it('uses the level from LOG_LEVEL (error in the test env)', () => {
        // setup.ts sets LOG_LEVEL=error for the test run.
        expect(logger.level).toBe('error');
    });
});
