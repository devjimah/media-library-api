// Shared test helpers — small fixtures reused across integration tests.

// What: Builds a minimal but valid 1x1 PNG as a Buffer for upload tests.
// Does: Returns the canonical smallest PNG byte sequence so Multer accepts it as image/png.
// If removed: Upload tests have no file to attach and POST /media cannot be exercised.
export const makePngBuffer = (): Buffer =>
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
    );
