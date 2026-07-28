// Minimal browser client for the Media Library API.
// Upload: posts each selected file as its own POST /media request (the API
// accepts one file per request). Browse: queries GET /media with search,
// category, and page parameters and renders the results.

const uploadForm = document.querySelector('#upload-form');
const fileInput = document.querySelector('#file');
const uploadButton = uploadForm.querySelector('button');
const status = document.querySelector('#status');

const filterForm = document.querySelector('#filter-form');
const searchInput = document.querySelector('#search');
const categorySelect = document.querySelector('#category');
const listStatus = document.querySelector('#list-status');
const mediaList = document.querySelector('#media-list');
const pager = document.querySelector('#pager');
const prevButton = document.querySelector('#prev');
const nextButton = document.querySelector('#next');
const pageInfo = document.querySelector('#page-info');

const PAGE_SIZE = 10;
let currentPage = 1;

const categoryFor = (file) => {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type === 'application/pdf') return 'document';
    return 'other';
};

// ---------------------------------------------------------------------------
// Upload — one request per file, run sequentially so per-file errors are clear
// ---------------------------------------------------------------------------

const uploadOne = async (file) => {
    const body = new FormData();
    body.append('file', file);
    body.append('title', file.name.replace(/\.[^.]+$/, '') || file.name);
    body.append('category', categoryFor(file));

    const response = await fetch('/media', { method: 'POST', body });
    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.message || 'Upload failed.');
    }
};

uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const files = [...fileInput.files];
    if (!files.length) return;

    uploadButton.disabled = true;

    let uploaded = 0;
    const failures = [];

    for (const file of files) {
        status.textContent = `Uploading ${uploaded + failures.length + 1} of ${files.length}: ${file.name}…`;
        try {
            await uploadOne(file);
            uploaded += 1;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Upload failed.';
            failures.push(`${file.name} — ${message}`);
        }
    }

    status.textContent = failures.length
        ? `Uploaded ${uploaded} of ${files.length}. Failed: ${failures.join('; ')}`
        : `Uploaded ${uploaded} file${uploaded === 1 ? '' : 's'}.`;

    if (!failures.length) uploadForm.reset();
    uploadButton.disabled = false;

    // Refresh the list so new uploads appear immediately
    currentPage = 1;
    loadMedia();
});

// ---------------------------------------------------------------------------
// Browse — search, category filter, pagination
// ---------------------------------------------------------------------------

const formatSize = (bytes) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
};

// Builds each list item with textContent only — never innerHTML — so titles
// and tags from the API can't inject markup into the page.
const renderItem = (media) => {
    const item = document.createElement('li');

    const link = document.createElement('a');
    link.href = `/${media.filePath}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = media.title;
    item.append(link);

    const meta = document.createElement('small');
    const tags = media.tags?.length ? ` · ${media.tags.join(', ')}` : '';
    meta.textContent = ` ${media.category} · ${formatSize(media.fileSize)}${tags}`;
    item.append(meta);

    return item;
};

const loadMedia = async () => {
    listStatus.textContent = 'Loading…';

    const params = new URLSearchParams({ page: String(currentPage), limit: String(PAGE_SIZE) });
    const search = searchInput.value.trim();
    if (search) params.set('search', search);
    if (categorySelect.value) params.set('category', categorySelect.value);

    try {
        const response = await fetch(`/media?${params}`);
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'Could not load media.');
        }

        const { results, pagination } = result.data;

        mediaList.replaceChildren(...results.map(renderItem));
        listStatus.textContent = pagination.total
            ? `${pagination.total} item${pagination.total === 1 ? '' : 's'} found.`
            : 'No media found.';

        const totalPages = Math.max(1, Math.ceil(pagination.total / PAGE_SIZE));
        pager.hidden = totalPages <= 1;
        pageInfo.textContent = `Page ${pagination.page} of ${totalPages}`;
        prevButton.disabled = pagination.page <= 1;
        nextButton.disabled = pagination.page >= totalPages;
    } catch (error) {
        mediaList.replaceChildren();
        pager.hidden = true;
        listStatus.textContent = error instanceof Error ? error.message : 'Could not load media.';
    }
};

filterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    currentPage = 1;
    loadMedia();
});

prevButton.addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage -= 1;
        loadMedia();
    }
});

nextButton.addEventListener('click', () => {
    currentPage += 1;
    loadMedia();
});

// Initial load so the library is visible without interaction
loadMedia();
