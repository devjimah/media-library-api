// 404 Not Found middleware — catches requests to undefined routes and returns a
// consistent error response.  Must be registered after all valid routes.

import { Request, Response } from 'express';

// What: Catch-all middleware for requests that matched no registered route.
// Does: Responds 404 with the standard error envelope, naming the method and URL.
// If removed: Unknown routes fall through to Express's default HTML 404 page,
//             breaking the API's consistent JSON error format.
const notFound = (req: Request, res: Response): void => {
    res.status(404).json({
        status: 'error',
        message: `Cannot ${req.method} ${req.originalUrl} — route not found.`,
        details: []
    });
};

export default notFound;
