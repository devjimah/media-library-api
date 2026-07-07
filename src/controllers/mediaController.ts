// Media Controller — thin request/response layer.
// Every handler is wrapped with catchAsync so that async errors are
// automatically forwarded to the global error handler without try/catch.
// All decision-making is delegated to the service layer.

import { Request, Response } from 'express';
import catchAsync from '../utils/catchAsync';
import { AppError } from '../utils/AppError';
import {
    createMediaRecord,
    getAllMedia,
    getMediaById,
    updateMediaRecord,
    deleteMediaRecord
} from '../services/mediaService';
import { MediaQueryParams, CreateMediaBody, UpdateMediaBody } from '../types/media';

// ---------------------------------------------------------------------------
// POST /media
// ---------------------------------------------------------------------------

// What: Controller for POST /media (single-file upload + metadata creation).
// Does: Confirms Multer attached a file, hands file + validated body to the service,
//       and responds 201 with the created record in the standard success envelope.
// If removed: The upload route has no handler — POST /media returns 404.
export const create = catchAsync(async (req: Request, res: Response): Promise<void> => {
    // Multer must have attached a file; if not, something bypassed the upload middleware
    if (!req.file) {
        throw new AppError('No file was uploaded. Include a file field named "file".', 400);
    }

    const media = await createMediaRecord(req.file, req.body as CreateMediaBody);

    res.status(201).json({
        status: 'success',
        data: { media }
    });
});

// ---------------------------------------------------------------------------
// GET /media
// ---------------------------------------------------------------------------

// What: Controller for GET /media (paginated, filtered, searchable list).
// Does: Passes the Zod-validated query (already coerced and defaulted by the validation
//       middleware) straight to the service and responds with results + pagination.
// If removed: The list route has no handler — GET /media returns 404.
export const getAll = catchAsync(async (req: Request, res: Response): Promise<void> => {
    // The validate middleware replaced req.query with the parsed schema output,
    // so page/limit are numbers and sortBy/order carry their defaults already.
    const result = await getAllMedia(req.query as unknown as MediaQueryParams);

    res.status(200).json({
        status: 'success',
        data: result
    });
});

// ---------------------------------------------------------------------------
// GET /media/:id
// ---------------------------------------------------------------------------

// What: Controller for GET /media/:id (single-record fetch).
// Does: Asks the service for the record by id and responds 200; the service throws a
//       404 AppError when the id is unknown, which the error handler formats.
// If removed: The detail route has no handler — GET /media/:id returns 404 for all ids.
export const getOne = catchAsync(async (req: Request, res: Response): Promise<void> => {
    const media = await getMediaById(String(req.params.id));

    res.status(200).json({
        status: 'success',
        data: { media }
    });
});

// ---------------------------------------------------------------------------
// PUT /media/:id
// ---------------------------------------------------------------------------

// What: Controller for PUT /media/:id (partial metadata update; no file replacement).
// Does: Forwards the validated update body to the service and responds 200 with the
//       updated record.
// If removed: The update route has no handler — metadata becomes immutable via the API.
export const update = catchAsync(async (req: Request, res: Response): Promise<void> => {
    const media = await updateMediaRecord(String(req.params.id), req.body as UpdateMediaBody);

    res.status(200).json({
        status: 'success',
        data: { media }
    });
});

// ---------------------------------------------------------------------------
// DELETE /media/:id
// ---------------------------------------------------------------------------

// What: Controller for DELETE /media/:id (record + file removal).
// Does: Asks the service to delete the record and its file, then responds 200 with a
//       confirmation message (kept as { status, data } for response consistency over 204).
// If removed: The delete route has no handler — media can never be removed via the API.
export const deleteOne = catchAsync(async (req: Request, res: Response): Promise<void> => {
    await deleteMediaRecord(String(req.params.id));

    res.status(200).json({
        status: 'success',
        data: { message: 'Media record deleted successfully.' }
    });
});
