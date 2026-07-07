// Media Repository — raw database operations only; no business logic here.
// Every method maps directly to a Mongoose query.  Services call this layer
// and are responsible for all decision-making around the results.

// No FilterQuery in Mongoose 9 — use a plain record for dynamic filter construction
import Media from '../models/Media';
import { IMedia, MediaQueryParams, PaginatedMediaResponse } from '../types/media';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// What: Sanitiser for user-supplied search strings used inside a regex.
// Does: Backslash-escapes every regex metacharacter so the search term matches literally.
// If removed: Searches like "c++" throw a regex syntax error, and crafted input could
//             trigger catastrophic-backtracking (ReDoS) patterns against the DB.
const escapeRegex = (value: string): string => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

// What: Repository insert operation for the Media collection.
// Does: Persists a new Media document via Media.create and returns it.
// If removed: POST /media has no way to store records — every upload fails.
export const createMedia = async (data: Partial<IMedia>): Promise<IMedia> => {
    const media = await Media.create(data);
    return media;
};

// ---------------------------------------------------------------------------
// READ — list (paginated, filtered, searched)
// ---------------------------------------------------------------------------

// What: Repository list operation powering GET /media.
// Does: Builds a dynamic filter (search/category/tags), then runs the page query and the
//       total count in parallel with Promise.all, returning results + pagination metadata.
// If removed: The list endpoint loses pagination, filtering, and search entirely.
export const findAllMedia = async (params: MediaQueryParams): Promise<PaginatedMediaResponse> => {
    const { page, limit, category, tags, search, sortBy, order } = params;

    // Build the Mongoose filter object dynamically
    const filter: Record<string, unknown> = {};

    // Case-insensitive substring search on title.
    // Note: a $text clause must NOT be combined with a regex inside $or — MongoDB
    // requires all $or siblings of $text to be index-supported, so that query errors.
    if (search) {
        filter.title = { $regex: escapeRegex(search), $options: 'i' };
    }

    // Exact enum match for category
    if (category) {
        filter.category = category;
    }

    // Tags filter — any document that contains at least one of the requested tags
    if (tags) {
        const tagArray = tags.split(',').map((t) => t.trim()).filter(Boolean);
        if (tagArray.length > 0) {
            filter.tags = { $in: tagArray };
        }
    }

    // Sort direction: 1 = ascending, -1 = descending
    const sortDirection = order === 'asc' ? 1 : -1;
    const skip = (page - 1) * limit;

    // Fire both queries in parallel — fetches the page and the total count simultaneously
    const [results, total] = await Promise.all([
        Media.find(filter)
            .sort({ [sortBy]: sortDirection })
            .skip(skip)
            .limit(limit)
            .lean<IMedia[]>(),
        Media.countDocuments(filter)
    ]);

    return {
        results,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        }
    };
};

// ---------------------------------------------------------------------------
// READ — single
// ---------------------------------------------------------------------------

// What: Repository lookup for a single Media document by _id.
// Does: Runs Media.findById and returns the document, or null when nothing matches.
// If removed: GET /media/:id and the update/delete existence checks have no data source.
export const findMediaById = async (id: string): Promise<IMedia | null> => {
    return Media.findById(id).lean<IMedia>();
};

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

// What: Repository partial-update operation for a Media document.
// Does: Applies the patch with findByIdAndUpdate, enforcing schema validators, and
//       returns the post-update document (or null when the id does not exist).
// If removed: PUT /media/:id cannot persist metadata changes.
export const updateMediaById = async (
    id: string,
    data: Partial<IMedia>
): Promise<IMedia | null> => {
    return Media.findByIdAndUpdate(id, data, {
        new: true,          // Return the document after applying the update
        runValidators: true // Enforce schema-level validation on the patch
    }).lean<IMedia>();
};

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

// What: Repository delete operation for a Media document.
// Does: Removes the document with findByIdAndDelete and returns it so the caller can
//       read filePath before unlinking the file from disk (or null when not found).
// If removed: DELETE /media/:id cannot remove records; orphaned rows accumulate.
export const deleteMediaById = async (id: string): Promise<IMedia | null> => {
    return Media.findByIdAndDelete(id).lean<IMedia>();
};
