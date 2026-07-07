// Media Mongoose model — defines the schema for all uploaded media records.
// Removing this file breaks every repository call that touches the Media collection.

import { Schema, model } from 'mongoose';
import { IMedia, MediaCategory } from '../types/media';

/** Valid category values — shared with Zod schemas to avoid duplication */
export const MEDIA_CATEGORIES: MediaCategory[] = ['image', 'document', 'other'];

const mediaSchema = new Schema<IMedia>(
    {
        // Human-readable label for the asset; searchable via regex index
        title: {
            type: String,
            required: [true, 'Title is required'],
            trim: true,
            maxlength: [200, 'Title must not exceed 200 characters']
        },

        // Arbitrary labels for flexible filtering; stored as an array of strings
        tags: {
            type: [String],
            default: []
        },

        // Controlled vocabulary enforced at the DB layer as a second line of defence
        category: {
            type: String,
            enum: {
                values: MEDIA_CATEGORIES,
                message: 'Category must be one of: image, document, other'
            },
            required: [true, 'Category is required']
        },

        // Absolute or relative path to the file on disk (set by Multer)
        filePath: {
            type: String,
            required: [true, 'File path is required']
        },

        // The filename the client sent before Multer renamed it
        originalName: {
            type: String,
            required: [true, 'Original file name is required']
        },

        // MIME type as reported by Multer (e.g. image/jpeg, application/pdf)
        mimeType: {
            type: String,
            required: [true, 'MIME type is required']
        },

        // File size in bytes; stored for display and quota enforcement
        fileSize: {
            type: Number,
            required: [true, 'File size is required'],
            min: [0, 'File size cannot be negative']
        }
    },
    {
        // Automatically adds createdAt and updatedAt fields to every document
        timestamps: true,

        // Strip __v from all query results to keep responses clean
        versionKey: false
    }
);

// Regular index on title supports sorting by title; search uses a case-insensitive
// regex (a $text index is deliberately NOT used — $text cannot be combined with the
// regex clause the repository builds, and regex substring search fits the lab spec).
mediaSchema.index({ title: 1 });

// Compound index for the most common filter combination
mediaSchema.index({ category: 1, createdAt: -1 });

const Media = model<IMedia>('Media', mediaSchema);

export default Media;
