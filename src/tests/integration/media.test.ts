// Integration tests — exercise the real Express + Mongoose stack via Supertest
// against the in-memory MongoDB. Covers all five endpoints plus the three
// regression cases from REVIEW-FINDINGS.md (valid GET list = 200 not 500;
// title-only PUT keeps tags; ?search= works).

import request from 'supertest';
import app from '../../app';
import { makePngBuffer } from '../helpers';

// Helper: upload one media record and return its id + body.
const uploadMedia = async (overrides: { title?: string; category?: string; tags?: string } = {}) => {
    const res = await request(app)
        .post('/media')
        .field('title', overrides.title ?? 'Test Photo')
        .field('category', overrides.category ?? 'image')
        .field('tags', overrides.tags ?? 'holiday,beach')
        .attach('file', makePngBuffer(), 'photo.png');
    return res;
};

describe('POST /media', () => {
    it('creates a record and returns 201 with the standard envelope', async () => {
        const res = await uploadMedia();
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('success');
        expect(res.body.data.media).toMatchObject({
            title: 'Test Photo',
            category: 'image',
            mimeType: 'image/png'
        });
        expect(res.body.data.media.tags).toEqual(['holiday', 'beach']);
    });

    it('returns 400 when title is missing', async () => {
        const res = await request(app)
            .post('/media')
            .field('category', 'image')
            .attach('file', makePngBuffer(), 'photo.png');
        expect(res.status).toBe(400);
        expect(res.body.status).toBe('error');
    });

    it('returns 400 for an unsupported file type', async () => {
        const res = await request(app)
            .post('/media')
            .field('title', 'Bad')
            .field('category', 'other')
            .attach('file', Buffer.from('#!/bin/sh\necho hi'), 'evil.sh');
        expect(res.status).toBe(400);
        expect(res.body.status).toBe('error');
    });

    it('returns 400 when the file exceeds the size limit (Multer LIMIT_FILE_SIZE)', async () => {
        // MAX_FILE_SIZE_MB is 5 in the test env; 6 MB trips Multer's size guard,
        // exercising the errorHandler's LIMIT_FILE_SIZE branch.
        const tooBig = Buffer.alloc(6 * 1024 * 1024, 0);
        const res = await request(app)
            .post('/media')
            .field('title', 'Too big')
            .field('category', 'image')
            .attach('file', tooBig, 'huge.png');
        expect(res.status).toBe(400);
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/too large/i);
    });

    it('returns 400 for an extension that does not match the declared type', async () => {
        // A PNG-typed part carrying a .jpg extension hits upload.ts's mismatch branch.
        const res = await request(app)
            .post('/media')
            .field('title', 'Mismatch')
            .field('category', 'image')
            .attach('file', makePngBuffer(), { filename: 'photo.jpg', contentType: 'image/png' });
        expect(res.status).toBe(400);
        expect(res.body.status).toBe('error');
    });
});

describe('GET /media', () => {
    it('returns 200 with pagination metadata for a valid query (regression: no 500)', async () => {
        await uploadMedia();
        const res = await request(app).get('/media?page=1&limit=5');
        expect(res.status).toBe(200);
        expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 5 });
        expect(Array.isArray(res.body.data.results)).toBe(true);
    });

    it('filters by category', async () => {
        await uploadMedia({ category: 'image' });
        await uploadMedia({ title: 'A doc', category: 'document' });
        const res = await request(app).get('/media?category=document');
        expect(res.status).toBe(200);
        expect(res.body.data.results).toHaveLength(1);
        expect(res.body.data.results[0].category).toBe('document');
    });

    it('searches by title (regression: ?search= must not error)', async () => {
        await uploadMedia({ title: 'Sunset over water' });
        await uploadMedia({ title: 'City lights' });
        const res = await request(app).get('/media?search=sunset');
        expect(res.status).toBe(200);
        expect(res.body.data.results).toHaveLength(1);
        expect(res.body.data.results[0].title).toBe('Sunset over water');
    });
});

describe('GET /media/:id', () => {
    it('returns 200 for a valid id', async () => {
        const created = await uploadMedia();
        const id = created.body.data.media._id;
        const res = await request(app).get(`/media/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.data.media._id).toBe(id);
    });

    it('returns 404 for an unknown but valid id', async () => {
        const res = await request(app).get('/media/507f1f77bcf86cd799439011');
        expect(res.status).toBe(404);
        expect(res.body.status).toBe('error');
    });

    it('returns 400 for a malformed id (Mongoose CastError)', async () => {
        // A non-ObjectId string triggers a Mongoose CastError, exercising the
        // errorHandler's invalid-ID branch (400, not 404).
        const res = await request(app).get('/media/not-a-valid-object-id');
        expect(res.status).toBe(400);
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/invalid id/i);
    });
});

describe('PUT /media/:id', () => {
    it('updates a record and returns 200', async () => {
        const created = await uploadMedia();
        const id = created.body.data.media._id;
        const res = await request(app).put(`/media/${id}`).send({ title: 'Renamed' });
        expect(res.status).toBe(200);
        expect(res.body.data.media.title).toBe('Renamed');
    });

    it('preserves existing tags on a title-only update (regression)', async () => {
        const created = await uploadMedia({ tags: 'keep,these' });
        const id = created.body.data.media._id;
        const res = await request(app).put(`/media/${id}`).send({ title: 'Renamed' });
        expect(res.status).toBe(200);
        expect(res.body.data.media.tags).toEqual(['keep', 'these']);
    });

    it('returns 400 for an empty update body', async () => {
        const created = await uploadMedia();
        const id = created.body.data.media._id;
        const res = await request(app).put(`/media/${id}`).send({});
        expect(res.status).toBe(400);
        expect(res.body.status).toBe('error');
    });
});

describe('DELETE /media/:id', () => {
    it('deletes a record and returns 200', async () => {
        const created = await uploadMedia();
        const id = created.body.data.media._id;
        const res = await request(app).delete(`/media/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('success');

        const after = await request(app).get(`/media/${id}`);
        expect(after.status).toBe(404);
    });

    it('returns 404 when deleting an unknown id', async () => {
        const res = await request(app).delete('/media/507f1f77bcf86cd799439011');
        expect(res.status).toBe(404);
    });
});
