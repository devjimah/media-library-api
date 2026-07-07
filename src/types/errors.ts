// Shared error type contract — imported by both AppError and the global error handler.
// Keeping this separate avoids circular imports between utils and middlewares.

export interface AppErrorInterface extends Error {
    /** HTTP status code to return to the client */
    statusCode: number;
    /** Operational errors are expected (404, 400, etc.); non-operational ones crash the process */
    isOperational: boolean;
}
