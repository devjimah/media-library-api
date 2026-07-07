// TypeScript types for media records, query parameters, and API response shapes.
// Centralising these here ensures controllers, services, and repositories all share the same contract.

import { Document } from 'mongoose';

/** Allowed media category values — mirrors the Mongoose enum */
export type MediaCategory = 'image' | 'document' | 'other';

/** Allowed sort order values */
export type SortOrder = 'asc' | 'desc';

/** Fields that can be used as sort keys */
export type SortField = 'createdAt' | 'title' | 'fileSize' | 'category';

// ---------------------------------------------------------------------------
// Mongoose Document interface
// ---------------------------------------------------------------------------

/** Shape of a persisted Media document returned from Mongoose */
export interface IMedia extends Document {
    title: string;
    tags: string[];
    category: MediaCategory;
    filePath: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
    createdAt: Date;
    updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Request body / query types
// ---------------------------------------------------------------------------

/** Body fields accepted on POST /media (file fields handled by Multer separately) */
export interface CreateMediaBody {
    title: string;
    tags?: string | string[];   // Raw form-data may send tags as comma-separated string
    category: MediaCategory;
}

/** Body fields accepted on PUT /media/:id */
export interface UpdateMediaBody {
    title?: string;
    tags?: string | string[];
    category?: MediaCategory;
}

/** Validated query parameters for GET /media */
export interface MediaQueryParams {
    page: number;
    limit: number;
    category?: MediaCategory;
    tags?: string;              // Comma-separated list
    search?: string;
    sortBy: SortField;
    order: SortOrder;
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/** Pagination metadata included in list responses */
export interface PaginationMeta {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

/** Paginated list response wrapper */
export interface PaginatedMediaResponse {
    results: IMedia[];
    pagination: PaginationMeta;
}
