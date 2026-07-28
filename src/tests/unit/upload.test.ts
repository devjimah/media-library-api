// Unit test for the upload middleware's startup directory creation.
// The key production concern: on a read-only serverless filesystem (e.g. Vercel,
// where only /tmp is writable) fs.mkdirSync throws at module load. That must NOT
// crash the process — otherwise every route, even ones that never touch uploads,
// goes down. This test forces mkdirSync to throw and asserts the module still loads.

describe('upload middleware startup directory creation', () => {
    const OLD_ENV = process.env;

    afterEach(() => {
        jest.resetModules();
        jest.restoreAllMocks();
        process.env = OLD_ENV;
    });

    it('does not throw at import when the upload directory cannot be created', () => {
        jest.resetModules();
        process.env = { ...OLD_ENV, UPLOAD_DIR: '/definitely/not/writable' };

        // Force the directory creation to fail the way a read-only FS would.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs');
        jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {
            const err = new Error("ENOENT: no such file or directory, mkdir '/definitely/not/writable'");
            throw err;
        });

        // Importing the module runs the top-level mkdir. It must swallow the error.
        expect(() => {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            require('../../middlewares/upload');
        }).not.toThrow();
    });
});
