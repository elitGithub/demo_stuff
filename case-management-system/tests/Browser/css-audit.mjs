/**
 * @return {object}
 */
export function inspectCssAuditPage() {
    /** @param {Element} element @return {object} */
    const bounds = (element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
    };
    /** @param {Element} element @return {boolean} */
    const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    /** @param {string} selector @return {Element[]} */
    const select = (selector) => Array.from(document.querySelectorAll(selector)).filter(visible);
    /** @param {Element} element @return {object} */
    const identity = (element) => ({ tag: element.tagName, id: element.id, className: element.getAttribute('class'), name: element.getAttribute('name'), text: element.textContent.trim().slice(0, 100) });
    /** @param {object} first @param {object} second @return {boolean} */
    const horizontalOverlap = (first, second) => first.right > second.left + 1 && first.left < second.right - 1;
    /** @param {object} first @param {object} second @return {boolean} */
    const overlap = (first, second) => horizontalOverlap(first, second) && first.bottom > second.top + 1 && first.top < second.bottom - 1;
    /** @param {Element} element @return {object} */
    const textBounds = (element) => {
        if (typeof document.createRange !== 'function') {
            return { status: 'visual-only', reason: 'Text Range API unavailable.' };
        }
        try {
            const range = document.createRange();
            range.selectNodeContents(element);
            const rect = range.getBoundingClientRect();
            return { status: 'measured', rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height } };
        } catch {
            return { status: 'visual-only', reason: 'Text rectangle API unavailable.' };
        }
    };
    /** @param {Element} element @return {object} */
    const occlusion = (element) => {
        if (typeof document.elementFromPoint !== 'function') {
            return { status: 'visual-only', reason: 'Hit testing API unavailable.' };
        }
        try {
            const rect = bounds(element);
            const samples = [
                [rect.left + 4, rect.top + 4], [rect.right - 4, rect.top + 4],
                [rect.left + 4, rect.bottom - 4], [rect.right - 4, rect.bottom - 4],
                [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
            ];
            const covered = samples.filter(([horizontal, vertical]) => {
                if (horizontal < 0 || vertical < 0 || horizontal > innerWidth || vertical > innerHeight) {
                    return false;
                }
                const hit = document.elementFromPoint(horizontal, vertical);
                return hit !== null && !element.contains(hit) && !hit.contains(element);
            });
            return { status: covered.length ? 'fail' : 'pass', coveredSamples: covered };
        } catch {
            return { status: 'visual-only', reason: 'Hit testing API unavailable.' };
        }
    };

    const viewport = { width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, scrollX, scrollY };
    const checks = [{ name: 'page-width', status: viewport.scrollWidth > viewport.clientWidth + 1 ? 'fail' : 'pass', reason: `Document ${viewport.scrollWidth}px; viewport ${viewport.clientWidth}px.` }];
    const headerElement = select('.app-bar')[0];
    const header = headerElement ? bounds(headerElement) : null;
    const controls = Array.from(document.querySelectorAll('.app-bar .brand, .app-bar .workspace-trigger, .app-bar [data-theme-trigger], .app-bar .notification-bell')).filter((element) => {
        const style = getComputedStyle(element);
        return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).map((element) => {
        const rect = bounds(element);
        const children = element.matches('.brand') ? Array.from(element.children).filter(visible).map(bounds) : [];
        const left = Math.min(rect.left, ...children.map((child) => child.left));
        const right = Math.max(rect.right, ...children.map((child) => child.right));
        const top = Math.min(rect.top, ...children.map((child) => child.top));
        const bottom = Math.max(rect.bottom, ...children.map((child) => child.bottom));
        return { ...identity(element), rect, paintedRect: { left, right, top, bottom, width: right - left, height: bottom - top } };
    });

    if (headerElement) {
        const style = getComputedStyle(headerElement);
        const content = {
            left: header.left + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft),
            right: header.right - Number.parseFloat(style.borderRightWidth) - Number.parseFloat(style.paddingRight),
            top: header.top + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.paddingTop),
            bottom: header.bottom - Number.parseFloat(style.borderBottomWidth) - Number.parseFloat(style.paddingBottom),
        };
        controls.forEach((control, index) => {
            const reasons = [];
            if (control.rect.width < 1 || control.rect.height < 1) {
                reasons.push('Expected visible header control collapsed.');
            }
            if (control.paintedRect.left < content.left - 1 || control.paintedRect.right > content.right + 1 || control.paintedRect.top < content.top - 1 || control.paintedRect.bottom > content.bottom + 1) {
                reasons.push('Control exceeds header content bounds.');
            }
            controls.slice(index + 1).forEach((other) => {
                if (overlap(control.paintedRect, other.paintedRect)) {
                    reasons.push(`Control overlaps ${other.className}.`);
                }
            });
            checks.push({ name: 'header-fit', element: control, status: reasons.length ? 'fail' : 'pass', reasons });
        });
    }

    const badges = select('.notification-count').map((element) => {
        const rect = bounds(element);
        const text = textBounds(element);
        const link = element.closest('a');
        const target = link ? bounds(link) : null;
        const style = getComputedStyle(element);
        const reasons = [];
        if (rect.width < 19.99 || rect.height < 19.99) {
            reasons.push('Badge is smaller than 20px.');
        }
        if (!target || target.width < 43.99 || target.height < 43.99) {
            reasons.push('Notification link is smaller than 44px.');
        }
        if (text.status === 'measured') {
            const horizontalDelta = Math.abs((text.rect.left + text.rect.right - rect.left - rect.right) / 2);
            const verticalDelta = Math.abs((text.rect.top + text.rect.bottom - rect.top - rect.bottom) / 2);
            if (horizontalDelta > 1 || verticalDelta > 1) {
                reasons.push(`Text centre differs by ${horizontalDelta}px horizontally and ${verticalDelta}px vertically.`);
            }
            if (text.rect.left < rect.left - 1 || text.rect.right > rect.right + 1 || text.rect.top < rect.top - 1 || text.rect.bottom > rect.bottom + 1) {
                reasons.push('Badge text exceeds badge bounds.');
            }
        }
        checks.push({ name: 'badge-geometry', status: reasons.length ? 'fail' : text.status === 'measured' ? 'pass' : 'visual-only', reasons, textMeasurement: text.status });
        return { count: element.textContent.trim(), rect, text, target, layout: { display: style.display, alignItems: style.alignItems, justifyContent: style.justifyContent, fontSize: style.fontSize, lineHeight: style.lineHeight, whiteSpace: style.whiteSpace } };
    });

    const panels = select('.desk-folders, .mail-labels, .case-edit-rail, .tracker-sidebar, .tracker-editor, .mail-case-list').map((element) => {
        const style = getComputedStyle(element);
        const rect = bounds(element);
        const sticky = style.position === 'sticky';
        const engaged = sticky && scrollY > 0 && Math.abs(rect.top - Number.parseFloat(style.top)) < 2;
        if (engaged && header && horizontalOverlap(rect, header)) {
            checks.push({ name: 'sticky-clearance', element: identity(element), status: rect.top < header.bottom + 15 ? 'fail' : 'pass', reason: `Panel top ${rect.top}px; header bottom ${header.bottom}px.` });
        }
        const endControls = Array.from(element.querySelectorAll('button, a, input, textarea, select')).filter(visible);
        const last = endControls.at(-1);
        const constrained = element.scrollHeight > element.clientHeight + 1 && ['auto', 'scroll'].includes(style.overflowY);
        if (constrained && last) {
            const lastRect = bounds(last);
            const relativeBottom = lastRect.bottom - rect.top - element.clientTop + element.scrollTop;
            checks.push({ name: 'reachable-controls', element: identity(last), status: relativeBottom > element.scrollHeight + 1 ? 'fail' : 'visual-only', reason: 'Snapshot reports the pane extent; confirm its final control by scrolling in the browser.' });
        }
        return { ...identity(element), rect, position: style.position, top: style.top, engaged, scrollTop: element.scrollTop, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, lastControl: last ? { ...identity(last), rect: bounds(last) } : null };
    });

    const menus = select('.header-disclosure[open] .header-menu').map((element) => {
        const rect = bounds(element);
        const reasons = [];
        if (rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1) {
            reasons.push('Open menu exceeds viewport.');
        }
        const hitTest = occlusion(element);
        if (hitTest.status === 'fail') {
            reasons.push('Another layer obscures the open menu.');
        }
        checks.push({ name: 'open-menu', status: reasons.length ? 'fail' : hitTest.status, reasons });
        return { ...identity(element), rect, occlusion: hitTest };
    });

    const active = document.activeElement;
    let focused = null;
    if (active && active !== document.body && active !== document.documentElement) {
        const rect = bounds(active);
        const associatedLabel = active.matches('input[type="radio"][data-theme-option]') && rect.width <= 1 && rect.height <= 1 ? active.closest('label') : null;
        const presentation = associatedLabel ?? active;
        const presentationRect = bounds(presentation);
        const style = getComputedStyle(presentation);
        const inViewport = visible(presentation) && presentationRect.top >= -1 && presentationRect.left >= -1 && presentationRect.bottom <= innerHeight + 1 && presentationRect.right <= innerWidth + 1;
        const hitTest = occlusion(presentation);
        focused = { ...identity(active), rect, presentation: { ...identity(presentation), rect: presentationRect, source: associatedLabel ? 'associated-label' : 'focused-element' }, inViewport, focusVisible: active.matches(':focus-visible'), outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow, occlusion: hitTest };
        checks.push({ name: 'focused-content', status: !inViewport || hitTest.status === 'fail' ? 'fail' : hitTest.status, reason: 'Compare real focus identity and draft through resize; intentionally hidden theme radios use their visible label for geometry and occlusion. Inspect the focus indicator visually.' });
    }

    return {
        url: location.href, theme: document.documentElement.dataset.theme, viewport, header, controls, badges, panels, menus, focused,
        text: select('.detail-title, .sender-email, .sender-name, .mail-reading-title, textarea').map((element) => ({ ...identity(element), rect: bounds(element), text: textBounds(element) })),
        nativeDates: select('input[type="date"]').map((element) => ({ ...identity(element), rect: bounds(element), status: 'visual-only', reason: 'Native text and picker internals require screenshot inspection.' })),
        checks,
    };
}
