export class FocusKeeper {
  static #TextSelectionTypes = Object.freeze(['text', 'search', 'password']);
  static #TextareaTagName = 'TEXTAREA';

  /**
   * @param {{documentRef: Document | null, containerElement: HTMLElement, scrollSelector: string, renderFn: () => void, returnFocusId?: string}} options
   * @returns {void}
   */
  static keep({ documentRef, containerElement, scrollSelector, renderFn, returnFocusId = '' }) {
    const activeElement = documentRef?.activeElement ?? null;
    const hadFocus = activeElement !== null
      && activeElement.id.length > 0
      && containerElement.contains(activeElement);
    const nothingFocused = activeElement === null || activeElement === documentRef.body;
    const restoreId = hadFocus ? activeElement.id : (nothingFocused ? returnFocusId : '');
    const selectionStart = hadFocus ? activeElement.selectionStart : null;
    const selectionEnd = hadFocus ? activeElement.selectionEnd : null;
    const scrollElementBefore = containerElement.querySelector(scrollSelector);
    const scrollTop = scrollElementBefore === null ? 0 : scrollElementBefore.scrollTop;

    renderFn();

    if (restoreId.length > 0) {
      const restoredElement = containerElement.querySelector(`#${restoreId}`);
      if (restoredElement !== null) {
        restoredElement.focus({ preventScroll: true });
        const keepsSelection = restoredElement.tagName === FocusKeeper.#TextareaTagName
          || FocusKeeper.#TextSelectionTypes.includes(restoredElement.type);
        if (hadFocus && keepsSelection) {
          restoredElement.setSelectionRange(selectionStart, selectionEnd);
        }
      }
    }

    const scrollElementAfter = containerElement.querySelector(scrollSelector);
    if (scrollElementAfter !== null) {
      scrollElementAfter.scrollTop = scrollTop;
    }
  }

  /**
   * @param {HTMLElement} element
   * @returns {void}
   */
  static reveal(element) {
    element.scrollIntoView({ block: 'nearest' });
  }
}
