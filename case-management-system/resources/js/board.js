document.querySelectorAll('[data-board-status-select]').forEach((select) => {
    select.addEventListener('change', () => {
        if (!select.form.classList.contains('is-pending')) {
            select.form.requestSubmit(select.form.querySelector('[type="submit"]'));
        }
    });
});

const columns = document.querySelector('[data-board-columns]');
const tabs = Array.from(document.querySelectorAll('[data-board-tab]'));

if (columns) {
    document.documentElement.classList.add('board-enhanced');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                tabs.forEach((tab) => {
                    if (tab.hash === `#${entry.target.id}`) {
                        tab.setAttribute('aria-current', 'true');
                    } else {
                        tab.removeAttribute('aria-current');
                    }
                });
            }
        });
    }, { root: columns, threshold: 0.6 });

    Array.from(columns.children).forEach((column) => observer.observe(column));
    tabs.forEach((tab, index) => {
        tab.addEventListener('keydown', (event) => {
            let next = index;

            if (event.key === 'ArrowRight') {
                next = (index + 1) % tabs.length;
            } else if (event.key === 'ArrowLeft') {
                next = (index + tabs.length - 1) % tabs.length;
            } else if (event.key === 'Home') {
                next = 0;
            } else if (event.key === 'End') {
                next = tabs.length - 1;
            } else {
                return;
            }

            event.preventDefault();
            const pageScrollLeft = window.scrollX;
            const tabListBounds = tab.closest('[data-board-tabs]').getBoundingClientRect();
            const visibleTop = document.querySelector('.app-bar').getBoundingClientRect().bottom;
            const banner = document.querySelector('.demo-banner');
            const visibleBottom = banner ? banner.getBoundingClientRect().top : window.innerHeight;
            let pageScrollTop = window.scrollY;

            if (tabListBounds.top < visibleTop) {
                pageScrollTop += tabListBounds.top - visibleTop;
            } else if (tabListBounds.bottom > visibleBottom) {
                pageScrollTop += tabListBounds.bottom - visibleBottom;
            }

            tabs[next].click();
            tabs[next].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
            window.scrollTo({ left: pageScrollLeft, top: pageScrollTop, behavior: 'instant' });
            tabs[next].focus({ preventScroll: true });
        });
    });

    const target = document.getElementById(location.hash.slice(1));

    if (target && columns.contains(target)) {
        target.scrollIntoView({ block: 'nearest', inline: 'start' });

        if (target.classList.contains('board-card')) {
            target.focus({ preventScroll: true });
        }
    }
}
