// Media Service — business logic layer between controllers and the repository.
// Controllers hand raw request data here; services decide what to do with it,
// orchestrate repository calls, and throw AppErrors for invalid states.

import fs from 'fs/promises';
import path from 'path';
import { AppError } from '../utils/AppError';
import {
    createMedia,
    findAllMedia,
    findMediaById,
    updateMediaById,
    deleteMediaById
} from '../repositories/mediaRepository';
import {
    IMedia,
    MediaQueryParams,
    PaginatedMediaResponse,
    CreateMediaBody,
    UpdateMediaBody
} from '../types/media';

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

// What: Service operation behind POST /media.
// Does: Merges the Multer file metadata (path, original name, MIME type, size) with the
//       validated body fields, normalises tags, and asks the repository to persist it.
// If removed: Uploaded files would be saved to disk but never recorded in the database.
export const createMediaRecord = async (
    file: Express.Multer.File,
    body: CreateMediaBody
): Promise<IMedia> => {
    // Normalise tags: form-data may send a comma-separated string or multiple values
    const tags = normaliseTags(body.tags);

    const data: Partial<IMedia> = {
        title: body.title,
        tags,
        category: body.category,
        // Normalise Windows backslashes so stored paths are portable and usable
        // directly as URLs (e.g. /uploads/169...-photo.png via the static route)
        filePath: file.path.replace(/\\/g, '/'),
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size
    };

    return createMedia(data);
};

// ---------------------------------------------------------------------------
// READ — list
// ---------------------------------------------------------------------------

// What: Service operation behind GET /media.
// Does: Delegates the paginated/filtered/searched list query to the repository.
// If removed: The controller would have to call the repository directly, breaking the
//             lab's controller → service → repository layering requirement.
export const getAllMedia = async (
    queryParams: MediaQueryParams
): Promise<PaginatedMediaResponse> => {
    return findAllMedia(queryParams);
};

// ---------------------------------------------------------------------------
// READ — single
// ---------------------------------------------------------------------------

// What: Service operation behind GET /media/:id.
// Does: Fetches one record by id and converts a null result into a 404 AppError,
//       so controllers never need to null-check.
// If removed: GET /media/:id has no lookup path and missing records can't 404 cleanly.
export const getMediaById = async (id: string): Promise<IMedia> => {
    const media = await findMediaById(id);

    if (!media) {
        throw new AppError(`No media record found with ID: ${id}`, 404);
    }

    return media;
};

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

// What: Service operation behind PUT /media/:id.
// Does: Builds a patch containing only the fields the client actually sent (absent tags
//       leave stored tags untouched), applies it, and 404s when the id doesn't exist.
// If removed: Metadata updates are impossible; clients must delete and re-upload instead.
export const updateMediaRecord = async (
    id: string,
    body: UpdateMediaBody
): Promise<IMedia> => {
    // Resolve tags if provided
    const updateData: Partial<IMedia> = {};

    if (body.title !== undefined) updateData.title = body.title;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.tags !== undefined) updateData.tags = normaliseTags(body.tags);

    const updated = await updateMediaById(id, updateData);

    if (!updated) {
        throw new AppError(`No media record found with ID: ${id}`, 404);
    }

    return updated;
};

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

// What: Service operation behind DELETE /media/:id.
// Does: Deletes the DB record in a single round-trip (findByIdAndDelete returns the doc),
//       404s when nothing was deleted, then best-effort unlinks the file from disk —
//       a missing file is logged but never fails the request (the DB is source of truth).
// If removed: Records can't be deleted and files linger on disk with dangling DB rows.
export const deleteMediaRecord = async (id: string): Promise<void> => {
    // Single round-trip: the repository returns the deleted document (or null),
    // so no separate existence check is needed before removal.
    const deleted = await deleteMediaById(id);

    if (!deleted) {
        throw new AppError(`No media record found with ID: ${id}`, 404);
    }

    // Remove the physical file from disk
    const absolutePath = path.resolve(deleted.filePath);
    try {
        await fs.unlink(absolutePath);
    } catch (err) {
        // File may have been manually deleted; log and continue
        console.warn(`Could not delete file at ${absolutePath}:`, (err as Error).message);
    }

    //run a CRON job to 
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// What: Tags normaliser shared by the create and update flows.
// Does: Turns a comma-separated string, string array, or undefined into a clean string[]
//       with each entry trimmed and empty entries dropped.
// If removed: Raw form-data strings like "a, b," would be stored verbatim, producing
//             inconsistent tag data and broken tag filtering.
const normaliseTags = (raw?: string | string[]): string[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map((t) => t.trim()).filter(Boolean);
    return raw.split(',').map((t) => t.trim()).filter(Boolean);
};
