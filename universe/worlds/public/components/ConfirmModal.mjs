export class ConfirmModal {
  #modalRoot;
  #documentRef;
  #activeState = null;
  #keyHandler = null;

  /**
   * @param {{modalRoot: HTMLElement, documentRef?: Document | null}} options
   * @throws {TypeError}
   */
  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('ConfirmModal options must be a plain object.');
    }
    const { modalRoot, documentRef = null } = options;
    if (modalRoot === null || typeof modalRoot !== 'object') {
      throw new TypeError('modalRoot element is required.');
    }
    this.#modalRoot = modalRoot;
    this.#documentRef = documentRef ?? (typeof document !== 'undefined' ? document : null);
  }

  /**
   * @param {{title: string, message: string, confirmLabel?: string, busyLabel?: string, onConfirm: () => Promise<void> | void}} options
   * @returns {void}
   * @throws {TypeError}
   */
  open(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('ConfirmModal.open options must be a plain object.');
    }
    const {
      title,
      message,
      confirmLabel = 'Delete',
      busyLabel = 'Deleting...',
      onConfirm,
    } = options;
    if (typeof title !== 'string' || typeof message !== 'string') {
      throw new TypeError('ConfirmModal requires title and message strings.');
    }
    if (typeof onConfirm !== 'function') {
      throw new TypeError('ConfirmModal requires an onConfirm callback.');
    }

    this.close();
    this.#activeState = {
      title,
      message,
      confirmLabel,
      busyLabel,
      onConfirm,
      busy: false,
      errorMessage: '',
    };

    if (this.#documentRef !== null && typeof this.#documentRef.addEventListener === 'function') {
      this.#keyHandler = (event) => {
        if (event.key === 'Escape' && this.#activeState !== null && !this.#activeState.busy) {
          event.preventDefault();
          this.close();
        }
      };
      this.#documentRef.addEventListener('keydown', this.#keyHandler);
    }

    this.#render();
  }

  /**
   * @returns {void}
   */
  close() {
    if (this.#keyHandler !== null && this.#documentRef !== null && typeof this.#documentRef.removeEventListener === 'function') {
      this.#documentRef.removeEventListener('keydown', this.#keyHandler);
    }
    this.#keyHandler = null;
    this.#activeState = null;
    this.#modalRoot.replaceChildren();
  }

  /**
   * @returns {void}
   */
  #render() {
    if (this.#activeState === null || this.#documentRef === null) {
      return;
    }

    const state = this.#activeState;
    const backdrop = this.#documentRef.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop && !state.busy) {
        this.close();
      }
    });

    const card = this.#documentRef.createElement('div');
    card.className = 'modal-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'confirm-modal-title');

    const header = this.#documentRef.createElement('div');
    header.className = 'modal-header';

    const titleElement = this.#documentRef.createElement('h2');
    titleElement.id = 'confirm-modal-title';
    titleElement.className = 'modal-title';
    titleElement.textContent = state.title;

    const closeButton = this.#documentRef.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn btn-ghost btn-compact';
    closeButton.textContent = 'Close';
    closeButton.disabled = state.busy;
    closeButton.addEventListener('click', () => {
      if (!state.busy) {
        this.close();
      }
    });

    header.append(titleElement, closeButton);

    const body = this.#documentRef.createElement('div');
    body.className = 'modal-body';

    const messageElement = this.#documentRef.createElement('p');
    messageElement.className = 'item-copy';
    messageElement.textContent = state.message;
    body.append(messageElement);

    if (state.errorMessage.length > 0) {
      const errorBox = this.#documentRef.createElement('div');
      errorBox.className = 'inline-alert is-danger';
      errorBox.setAttribute('role', 'alert');
      errorBox.textContent = state.errorMessage;
      body.append(errorBox);
    }

    const footer = this.#documentRef.createElement('div');
    footer.className = 'modal-footer';

    const cancelButton = this.#documentRef.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn-secondary';
    cancelButton.textContent = 'Cancel';
    cancelButton.disabled = state.busy;
    cancelButton.addEventListener('click', () => {
      if (!state.busy) {
        this.close();
      }
    });

    const confirmButton = this.#documentRef.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = state.busy ? 'btn is-danger is-loading' : 'btn is-danger';
    confirmButton.textContent = state.busy ? state.busyLabel : state.confirmLabel;
    confirmButton.disabled = state.busy;
    confirmButton.addEventListener('click', async () => {
      if (state.busy) {
        return;
      }
      state.busy = true;
      state.errorMessage = '';
      this.#render();
      try {
        await state.onConfirm();
        this.close();
      } catch (confirmError) {
        if (this.#activeState === state) {
          state.busy = false;
          state.errorMessage = confirmError instanceof Error ? confirmError.message : String(confirmError);
          this.#render();
        }
      }
    });

    const actions = this.#documentRef.createElement('div');
    actions.className = 'modal-footer-actions';
    actions.append(cancelButton, confirmButton);
    footer.append(actions);

    card.append(header, body, footer);
    backdrop.append(card);
    this.#modalRoot.replaceChildren(backdrop);

    if (!state.busy && typeof cancelButton.focus === 'function') {
      cancelButton.focus();
    }
  }
}
