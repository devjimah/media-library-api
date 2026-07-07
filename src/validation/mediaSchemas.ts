// Zod validation schemas for all Media API endpoints.
// Centralising schemas here keeps route files clean and makes it easy to
// reuse or extend schemas independently of the route definitions.

import { z } from 'zod';
import { MEDIA_CATEGORIES } from '../models/Media';

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** Reusable category enum derived from the model constant to avoid drift */
const categoryEnum = z.enum(MEDIA_CATEGORIES as [string, ...string[]], {
    // What: Custom error-message mapper for the category enum.
    // Does: Replaces Zod's generic enum error with a message listing the valid categories.
    // If removed: Clients get the unhelpful default "Invalid enum value" message.
    errorMap: () => ({
        message: `Category must be one of: ${MEDIA_CATEGORIES.join(', ')}`
    })
});

/**
 * Tags base schema: accepts an array of strings or a comma-separated string,
 * always producing a string[] after parsing. Deliberately has NO default —
 * create and update apply different "field absent" semantics (see below).
 */
const tagsBase = z.union([
    z.array(z.string().trim().min(1)),
    // What: Transform callback converting a comma-separated tags string into an array.
    // Does: Splits on commas, trims each entry, and drops empty fragments.
    // If removed: Form-data clients sending "a, b, c" would fail array validation.
    z.string().transform((val) => val.split(',').map((t) => t.trim()).filter(Boolean))
]);

/** Create: absent tags default to [] so new records always have a tags array */
const tagsFieldCreate = tagsBase.optional().default([]);

/**
 * Update: absent tags stay undefined so the service leaves stored tags untouched.
 * (A .default([]) here previously caused every update to silently wipe tags.)
 */
const tagsFieldUpdate = tagsBase.optional();

// ---------------------------------------------------------------------------
// POST /media — upload a new file
// ---------------------------------------------------------------------------

/**
 * Validates the non-file form fields sent alongside the uploaded file.
 * The file itself is handled by Multer before this schema runs.
 */
export const createMediaSchema = z.object({
    title: z
        .string({ required_error: 'Title is required' })
        .trim()
        .min(1, 'Title is required')
        .max(200, 'Title must not exceed 200 characters'),

    tags: tagsFieldCreate,

    category: categoryEnum
});

// ---------------------------------------------------------------------------
// PUT /media/:id — update metadata
// ---------------------------------------------------------------------------

/**
 * All fields are optional for PATCH-like partial updates.
 * At least one field must be present to prevent empty-body calls.
 */
export const updateMediaSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(1, 'Title cannot be empty')
            .max(200, 'Title must not exceed 200 characters')
            .optional(),

        tags: tagsFieldUpdate,

        category: categoryEnum.optional()
    })
    .refine(
        // What: Refinement predicate enforcing a non-empty update payload.
        // Does: Passes only when at least one of title/tags/category is defined after parsing.
        // If removed: PUT /media/:id with an empty body succeeds as a no-op update.
        (data) => Object.keys(data).some((k) => data[k as keyof typeof data] !== undefined),
        { message: 'At least one field must be provided for an update.' }
    );

// ---------------------------------------------------------------------------
// GET /media — query parameters
// ---------------------------------------------------------------------------

/**
 * Validates and coerces all supported query parameters.
 * Zod's z.coerce.number() converts the string query params to numbers.
 */
export const queryMediaSchema = z.object({
    page: z.coerce
        .number({ invalid_type_error: 'page must be a number' })
        .int('page must be an integer')
        .min(1, 'page must be at least 1')
        .default(1),

    limit: z.coerce
        .number({ invalid_type_error: 'limit must be a number' })
        .int('limit must be an integer')
        .min(1, 'limit must be at least 1')
        .max(50, 'limit cannot exceed 50')
        .default(10),

    category: categoryEnum.optional(),

    // Comma-separated tag list — validated as a plain string here;
    // the repository splits it when building the $in filter
    tags: z.string().optional(),

    search: z.string().trim().optional(),

    sortBy: z
        .enum(['createdAt', 'title', 'fileSize', 'category'], {
            // What: Custom error-message mapper for the sortBy enum.
            // Does: Lists the sortable fields in the validation error message.
            // If removed: Clients get Zod's generic "Invalid enum value" message.
            errorMap: () => ({
                message: 'sortBy must be one of: createdAt, title, fileSize, category'
            })
        })
        .default('createdAt'),

    order: z
        .enum(['asc', 'desc'], {
            // What: Custom error-message mapper for the order enum.
            // Does: Names the two accepted sort directions in the error message.
            // If removed: Clients get Zod's generic "Invalid enum value" message.
            errorMap: () => ({ message: 'order must be "asc" or "desc"' })
        })
        .default('desc')
});

// ---------------------------------------------------------------------------
// Exported TypeScript types inferred from schemas
// ---------------------------------------------------------------------------

export type CreateMediaInput = z.infer<typeof createMediaSchema>;
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;
export type QueryMediaInput = z.infer<typeof queryMediaSchema>;
