// Unit tests for AppError — verifies it carries HTTP status, message, and the
// operational flag, and remains a real Error subclass after TS transpilation.

import { AppError } from '../../utils/AppError';

describe('AppError', () => {
    it('sets message and statusCode', () => {
        const err = new AppError('Not found', 404);
        expect(err.message).toBe('Not found');
        expect(err.statusCode).toBe(404);
    });

    it('marks the error as operational', () => {
        const err = new AppError('Bad request', 400);
        expect(err.isOperational).toBe(true);
    });

    it('is an instance of Error and AppError', () => {
        const err = new AppError('Boom', 500);
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(AppError);
    });
});
