const form = document.querySelector('#upload-form');
const fileInput = document.querySelector('#file');
const button = form.querySelector('button');
const status = document.querySelector('#status');

const categoryFor = (file) => {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type === 'application/pdf') return 'document';
    return 'other';
};

form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const [file] = fileInput.files;
    if (!file) return;

    const body = new FormData();
    body.append('file', file);
    body.append('title', file.name.replace(/\.[^.]+$/, '') || file.name);
    body.append('category', categoryFor(file));

    button.disabled = true;
    status.textContent = 'Uploading…';

    try {
        const response = await fetch('/media', { method: 'POST', body });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'Upload failed.');
        }

        form.reset();
        status.textContent = 'Upload complete.';
    } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'Upload failed.';
    } finally {
        button.disabled = false;
    }
});
