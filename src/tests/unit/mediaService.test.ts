// Unit tests for mediaService — the repository is fully mocked so these tests
// isolate the service's own logic: pagination pass-through, 404 on missing records,
// and partial-update patch construction (title-only update must not touch tags).

import { getAllMedia, getMediaById, updateMediaRecord } from '../../services/mediaService';
import * as repo from '../../repositories/mediaRepository';
import { MediaQueryParams } from '../../types/media';

jest.mock('../../repositories/mediaRepository');
const mockedRepo = repo as jest.Mocked<typeof repo>;

// Reset call history before each test so `mock.calls[0]` refers to the current
// test's invocation, not a call recorded by an earlier test in the same file.
beforeEach(() => {
    jest.clearAllMocks();
});

const baseQuery: MediaQueryParams = {
    page: 2,
    limit: 10,
    sortBy: 'createdAt',
    order: 'desc'
};

describe('mediaService.getAllMedia', () => {
    it('passes pagination metadata through from the repository', async () => {
        mockedRepo.findAllMedia.mockResolvedValue({
            results: [],
            pagination: { total: 25, page: 2, limit: 10, totalPages: 3 }
        });

        const result = await getAllMedia(baseQuery);

        expect(result.pagination).toEqual({ total: 25, page: 2, limit: 10, totalPages: 3 });
        expect(mockedRepo.findAllMedia).toHaveBeenCalledWith(baseQuery);
    });
});

describe('mediaService.getMediaById', () => {
    it('throws a 404 AppError when the record is missing', async () => {
        mockedRepo.findMediaById.mockResolvedValue(null);

        await expect(getMediaById('507f1f77bcf86cd799439011')).rejects.toMatchObject({
            statusCode: 404
        });
    });

    it('returns the record when found', async () => {
        const doc = { title: 'x' } as unknown as Awaited<ReturnType<typeof repo.findMediaById>>;
        mockedRepo.findMediaById.mockResolvedValue(doc);

        const result = await getMediaById('507f1f77bcf86cd799439011');
        expect(result).toBe(doc);
    });
});

describe('mediaService.updateMediaRecord', () => {
    it('sends only the provided fields (title-only update omits tags)', async () => {
        mockedRepo.updateMediaById.mockResolvedValue({ title: 'New' } as never);

        await updateMediaRecord('507f1f77bcf86cd799439011', { title: 'New' });

        const patch = mockedRepo.updateMediaById.mock.calls[0][1];
        expect(patch).toEqual({ title: 'New' });
        expect(patch).not.toHaveProperty('tags');
    });

    it('normalises tags when tags are provided', async () => {
        mockedRepo.updateMediaById.mockResolvedValue({ title: 'x' } as never);

        await updateMediaRecord('507f1f77bcf86cd799439011', { tags: 'a, b, ,c' });

        const patch = mockedRepo.updateMediaById.mock.calls[0][1];
        expect(patch.tags).toEqual(['a', 'b', 'c']);
    });

    it('throws 404 when the record does not exist', async () => {
        mockedRepo.updateMediaById.mockResolvedValue(null);

        await expect(
            updateMediaRecord('507f1f77bcf86cd799439011', { title: 'New' })
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});
