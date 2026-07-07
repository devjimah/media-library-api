// AppError — a concrete Error subclass that carries an HTTP status code and an
// isOperational flag.  Operational errors (404, 400, etc.) are safe to expose to
// the client; programming/unexpected errors (isOperational = false) are masked.

import { AppErrorInterface } from '../types/errors';

export class AppError extends Error implements AppErrorInterface {
    public readonly statusCode: number;
    public readonly isOperational: boolean;

    // What: Constructor for all deliberate, operational HTTP errors in the app.
    // Does: Sets the message and status code, marks the error operational, repairs the
    //       prototype chain for instanceof checks, and trims itself from the stack trace.
    // If removed: The class can't be instantiated — every `throw new AppError(...)` in
    //             services/controllers/middleware breaks, and errors lose status codes.
    constructor(message: string, statusCode: number) {
        // Sets Error.message and captures the stack trace
        super(message);

        this.statusCode = statusCode;
        // Any error created via AppError is deliberate and expected — mark it operational
        this.isOperational = true;

        // Maintain correct prototype chain for instanceof checks after transpilation
        Object.setPrototypeOf(this, new.target.prototype);

        // Capture the stack trace without including the AppError constructor itself
        Error.captureStackTrace(this, this.constructor);
    }
}
