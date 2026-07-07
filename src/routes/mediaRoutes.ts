// Media routes — wires upload middleware, validation, and controller handlers together.
// No business logic lives here; this file is purely routing configuration.

import { Router } from 'express';
import upload from '../middlewares/upload';
import validate from '../middlewares/validate';
import { createMediaSchema, updateMediaSchema, queryMediaSchema } from '../validation/mediaSchemas';
import * as mediaController from '../controllers/mediaController';

const router = Router();

// ---------------------------------------------------------------------------
// POST /media — upload a file with metadata
// 1. Multer parses the multipart request and saves the file to disk
// 2. Zod validates the text fields in req.body
// 3. Controller creates the DB record
// ---------------------------------------------------------------------------
router.post(
    '/',
    upload.single('file'),                          // Step 1 — Multer file upload
    validate(createMediaSchema, 'body'),            // Step 2 — body validation
    mediaController.create                          // Step 3 — controller
);

// ---------------------------------------------------------------------------
// GET /media — list all media with pagination, filtering, and search
// ---------------------------------------------------------------------------
router.get(
    '/',
    validate(queryMediaSchema, 'query'),            // Validate and coerce query parameters
    mediaController.getAll
);

// ---------------------------------------------------------------------------
// GET /media/:id — fetch a single media record
// ---------------------------------------------------------------------------
router.get('/:id', mediaController.getOne);

// ---------------------------------------------------------------------------
// PUT /media/:id — update metadata (file replacement not supported)
// ---------------------------------------------------------------------------
router.put(
    '/:id',
    validate(updateMediaSchema, 'body'),            // Validate update payload
    mediaController.update
);

// ---------------------------------------------------------------------------
// DELETE /media/:id — remove record + file from disk
// ---------------------------------------------------------------------------
router.delete('/:id', mediaController.deleteOne);

export default router;
