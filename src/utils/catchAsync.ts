// catchAsync — higher-order wrapper that eliminates try/catch boilerplate from
// async route handlers.  Any rejected promise is automatically forwarded to
// Express's next(err) pipeline, which lands in the global error handler.
//
// Usage:
//   router.get('/', catchAsync(mediaController.getAll));

import { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

// What: Higher-order function that adapts an async handler for safe use in Express.
// Does: Wraps the handler so any rejected promise is routed to next(err) and thus to
//       the global error handler, instead of becoming an unhandled rejection.
// If removed: Every async controller needs its own try/catch, and any forgotten one
//             turns a thrown error into a hung request + unhandled promise rejection.
const catchAsync = (fn: AsyncHandler): RequestHandler => {
    // What: The wrapped (non-async) request handler Express actually invokes.
    // Does: Calls the async handler and attaches .catch(next) to its promise.
    // If removed: catchAsync returns nothing and Express throws at route registration.
    return (req: Request, res: Response, next: NextFunction): void => {
        // Attach .catch(next) so any rejection is routed to the error handler
        fn(req, res, next).catch(next);
    };
};

export default catchAsync;
