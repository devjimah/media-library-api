// Unit tests for catchAsync — verifies rejected async handlers are forwarded to
// next(err) and resolved handlers do not call next.

import { Request, Response, NextFunction } from 'express';
import catchAsync from '../../utils/catchAsync';

describe('catchAsync', () => {
    it('forwards a rejected promise to next(error)', async () => {
        const boom = new Error('boom');
        const handler = catchAsync(async () => {
            throw boom;
        });
        const next = jest.fn() as unknown as NextFunction;

        handler({} as Request, {} as Response, next);
        // Wait a microtask tick so the rejection propagates to .catch(next)
        await Promise.resolve();

        expect(next).toHaveBeenCalledWith(boom);
    });

    it('does not call next when the handler resolves', async () => {
        const handler = catchAsync(async () => {
            // resolves with no error
        });
        const next = jest.fn() as unknown as NextFunction;

        handler({} as Request, {} as Response, next);
        await Promise.resolve();

        expect(next).not.toHaveBeenCalled();
    });
});
