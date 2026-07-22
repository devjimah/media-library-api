// Unit tests for the Zod validation middleware factory — confirms valid input
// passes through (parsed data exposed, next called) and invalid input yields the
// structured 400 error response without calling next.

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import validate from '../../middlewares/validate';

// Minimal Response test double capturing status + json.
const mockRes = () => {
    const res = {} as Response & { statusCode?: number; body?: unknown };
    res.status = jest.fn().mockImplementation((code: number) => {
        res.statusCode = code;
        return res;
    }) as unknown as Response['status'];
    res.json = jest.fn().mockImplementation((payload: unknown) => {
        res.body = payload;
        return res;
    }) as unknown as Response['json'];
    return res;
};

const schema = z.object({ title: z.string().min(1) });

describe('validate middleware', () => {
    it('calls next and exposes parsed data on valid input', () => {
        const req = { body: { title: 'hello' } } as Request;
        const res = mockRes();
        const next = jest.fn() as unknown as NextFunction;

        validate(schema, 'body')(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
        expect(req.body).toEqual({ title: 'hello' });
        expect(res.status).not.toHaveBeenCalled();
    });

    it('responds 400 with structured error on invalid input', () => {
        const req = { body: { title: '' } } as Request;
        const res = mockRes();
        const next = jest.fn() as unknown as NextFunction;

        validate(schema, 'body')(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.body).toMatchObject({
            status: 'error',
            message: 'Validation failed'
        });
        expect((res.body as { details: unknown[] }).details.length).toBeGreaterThan(0);
    });
});
