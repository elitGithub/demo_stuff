const toggle = document.querySelector('[data-menu-toggle]');
const menu = document.getElementById('site-menu');
toggle?.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(expanded));
    menu?.classList.toggle('is-open', expanded);
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') {
        toggle.setAttribute('aria-expanded', 'false');
        menu?.classList.remove('is-open');
        toggle.focus();
    }
});
const photos = document.querySelector('[data-photo-input]');
const previews = document.querySelector('[data-photo-previews]');
let objectUrls = [];
function clearPreviews() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];
    previews?.replaceChildren();
}
function renderPreviews() {
    clearPreviews();
    Array.from(photos.files ?? []).slice(0, 5).forEach((file, index) => {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return;
        const figure = document.createElement('figure');
        const image = document.createElement('img');
        const caption = document.createElement('figcaption');
        const url = URL.createObjectURL(file);
        objectUrls.push(url);
        image.src = url;
        image.alt = 'Selected photo preview';
        caption.textContent = file.name;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'photo-remove';
        remove.textContent = 'Remove photo';
        remove.setAttribute('aria-label', 'Remove ' + file.name);
        remove.addEventListener('click', () => {
            const remaining = new DataTransfer();
            Array.from(photos.files ?? []).forEach((selected, selectedIndex) => {
                if (selectedIndex !== index) remaining.items.add(selected);
            });
            photos.files = remaining.files;
            renderPreviews();
            photos.focus();
        });
        figure.append(image, caption, remove);
        previews?.append(figure);
    });
}
photos?.addEventListener('change', renderPreviews);
window.addEventListener('pagehide', clearPreviews);

document.querySelectorAll('[data-print]').forEach(button => button.addEventListener('click', () => window.print()));
