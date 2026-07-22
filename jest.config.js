/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/*.test.ts'],
    setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/types/**',
        '!src/server.ts',
        '!src/tests/**'
    ],
    coverageThreshold: {
        './src/services/': { statements: 80, lines: 80 },
        './src/middlewares/': { statements: 80, lines: 80 }
    },
    // mongodb-memory-server download can be slow on first run
    testTimeout: 30000
};
