export class ComposerBar {
  static #NarratorPrefixPattern = /^[\s*_]*narrator:\s*/i;

  #container;
  #documentRef;
  #onSend;
  #onStop;
  #campaignActive = false;
  #streaming = false;
  #oocExpanded = false;

  #phaseBanner;
  #alertBox;
  #narratorBadge;
  #oocToggleButton;
  #oocWrapper;
  #oocInput;
  #textarea;
  #encounterButton;
  #sendButton;

  /**
   * @param {{container: HTMLElement, documentRef?: Document | null, onSend: (payload: {text: string, mode: 'normal' | 'narrator' | 'encounter', oocNudge: string | null}) => Promise<void> | void, onStop: () => void}} options
   * @throws {TypeError}
   */
  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('ComposerBar options must be a plain object.');
    }
    const { container, documentRef = null, onSend, onStop } = options;
    if (container === null || typeof container !== 'object') {
      throw new TypeError('container element is required.');
    }
    if (typeof onSend !== 'function' || typeof onStop !== 'function') {
      throw new TypeError('onSend and onStop callbacks are required.');
    }
    this.#container = container;
    this.#documentRef = documentRef ?? (typeof document !== 'undefined' ? document : null);
    this.#onSend = onSend;
    this.#onStop = onStop;
    this.mount();
  }

  /**
   * @returns {void}
   */
  mount() {
    if (this.#documentRef === null) {
      return;
    }

    this.#phaseBanner = this.#documentRef.createElement('div');
    this.#phaseBanner.className = 'phase-banner is-hidden';
    this.#phaseBanner.setAttribute('aria-live', 'polite');

    this.#alertBox = this.#documentRef.createElement('div');
    this.#alertBox.className = 'inline-alert is-hidden';
    this.#alertBox.setAttribute('role', 'alert');

    const metaRow = this.#documentRef.createElement('div');
    metaRow.className = 'composer-meta-row';

    this.#narratorBadge = this.#documentRef.createElement('span');
    this.#narratorBadge.className = 'tag-pill is-warning is-hidden';
    this.#narratorBadge.textContent = 'Narrator mode';

    this.#oocToggleButton = this.#documentRef.createElement('button');
    this.#oocToggleButton.type = 'button';
    this.#oocToggleButton.className = 'btn btn-ghost btn-compact';
    this.#oocToggleButton.setAttribute('aria-expanded', 'false');
    this.#oocToggleButton.textContent = 'OOC Nudge';
    this.#oocToggleButton.addEventListener('click', () => {
      this.#oocExpanded = !this.#oocExpanded;
      this.#oocWrapper.className = this.#oocExpanded ? 'field-group' : 'field-group is-hidden';
      this.#oocToggleButton.setAttribute('aria-expanded', this.#oocExpanded ? 'true' : 'false');
      if (this.#oocExpanded && typeof this.#oocInput.focus === 'function') {
        this.#oocInput.focus();
      }
    });

    metaRow.append(this.#narratorBadge, this.#oocToggleButton);

    this.#oocWrapper = this.#documentRef.createElement('div');
    this.#oocWrapper.className = 'field-group is-hidden';

    const oocLabel = this.#documentRef.createElement('label');
    oocLabel.className = 'sr-only';
    oocLabel.setAttribute('for', 'composer-ooc-input');
    oocLabel.textContent = 'OOC Nudge';

    this.#oocInput = this.#documentRef.createElement('input');
    this.#oocInput.id = 'composer-ooc-input';
    this.#oocInput.type = 'text';
    this.#oocInput.className = 'field-control';
    this.#oocInput.placeholder = 'Optional OOC direction for Director and Composer';

    this.#oocWrapper.append(oocLabel, this.#oocInput);

    const controlsRow = this.#documentRef.createElement('div');
    controlsRow.className = 'composer-controls-row';

    const textareaLabel = this.#documentRef.createElement('label');
    textareaLabel.className = 'sr-only';
    textareaLabel.setAttribute('for', 'composer-text-input');
    textareaLabel.textContent = 'Message';

    this.#textarea = this.#documentRef.createElement('textarea');
    this.#textarea.id = 'composer-text-input';
    this.#textarea.rows = 3;
    this.#textarea.className = 'field-control composer-textarea';
    this.#textarea.placeholder = 'Write your action or dialogue (Enter sends, Shift+Enter newline; prefix with Narrator: for narration)';
    this.#textarea.addEventListener('input', () => {
      this.#updateNarratorBadge();
    });
    this.#textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (!this.#streaming && this.#campaignActive) {
          this.#submitTurn('normal');
        }
      }
    });

    const buttonRow = this.#documentRef.createElement('div');
    buttonRow.className = 'composer-button-row';

    this.#encounterButton = this.#documentRef.createElement('button');
    this.#encounterButton.type = 'button';
    this.#encounterButton.className = 'btn btn-secondary';
    this.#encounterButton.textContent = 'Encounter';
    this.#encounterButton.addEventListener('click', () => {
      if (!this.#streaming && this.#campaignActive) {
        this.#submitTurn('encounter');
      }
    });

    this.#sendButton = this.#documentRef.createElement('button');
    this.#sendButton.type = 'button';
    this.#sendButton.className = 'btn btn-primary';
    this.#sendButton.textContent = 'Send';
    this.#sendButton.addEventListener('click', () => {
      if (this.#streaming) {
        this.#onStop();
        return;
      }
      if (this.#campaignActive) {
        this.#submitTurn('normal');
      }
    });

    buttonRow.append(this.#encounterButton, this.#sendButton);
    controlsRow.append(textareaLabel, this.#textarea, buttonRow);

    this.#container.replaceChildren(
      this.#phaseBanner,
      this.#alertBox,
      metaRow,
      this.#oocWrapper,
      controlsRow,
    );

    this.#updateNarratorBadge();
    this.#updateControls();
  }

  /**
   * @param {boolean} active
   * @returns {void}
   */
  setCampaignActive(active) {
    this.#campaignActive = Boolean(active);
    this.#updateControls();
  }

  /**
   * @param {boolean} streaming
   * @returns {void}
   */
  setStreaming(streaming) {
    this.#streaming = Boolean(streaming);
    this.#updateControls();
  }

  /**
   * @param {string | null} phaseText
   * @returns {void}
   */
  setPhase(phaseText) {
    if (typeof phaseText === 'string' && phaseText.trim().length > 0) {
      this.#phaseBanner.textContent = phaseText;
      this.#phaseBanner.className = 'phase-banner';
    } else {
      this.#phaseBanner.textContent = '';
      this.#phaseBanner.className = 'phase-banner is-hidden';
    }
  }

  /**
   * @param {string | null} message
   * @param {{level?: 'error' | 'warning' | 'info' | 'success'}} [options]
   * @returns {void}
   */
  setAlert(message, { level = 'error' } = {}) {
    if (typeof message !== 'string' || message.trim().length === 0) {
      this.#alertBox.textContent = '';
      this.#alertBox.className = 'inline-alert is-hidden';
      return;
    }
    let levelClass = 'is-danger';
    if (level === 'warning') {
      levelClass = 'is-warning';
    } else if (level === 'info') {
      levelClass = '';
    } else if (level === 'success') {
      levelClass = 'is-success';
    }
    this.#alertBox.textContent = message;
    this.#alertBox.className = levelClass.length > 0 ? `inline-alert ${levelClass}` : 'inline-alert';
  }

  /**
   * @param {string} text
   * @returns {void}
   */
  setDraftText(text) {
    this.#textarea.value = typeof text === 'string' ? text : '';
    this.#updateNarratorBadge();
    if (typeof this.#textarea.focus === 'function') {
      this.#textarea.focus();
    }
  }

  /**
   * @returns {void}
   */
  clearDraft() {
    this.#textarea.value = '';
    this.#oocInput.value = '';
    this.#updateNarratorBadge();
  }

  /**
   * @returns {void}
   */
  #updateNarratorBadge() {
    const isNarrator = ComposerBar.#NarratorPrefixPattern.test(this.#textarea.value);
    this.#narratorBadge.className = isNarrator ? 'tag-pill is-warning' : 'tag-pill is-warning is-hidden';
  }

  /**
   * @returns {void}
   */
  #updateControls() {
    const inputDisabled = !this.#campaignActive || this.#streaming;
    this.#textarea.disabled = inputDisabled;
    this.#oocInput.disabled = inputDisabled;
    this.#oocToggleButton.disabled = !this.#campaignActive;
    this.#encounterButton.disabled = inputDisabled;

    if (this.#streaming) {
      this.#sendButton.disabled = false;
      this.#sendButton.className = 'btn is-danger';
      this.#sendButton.textContent = 'Stop';
    } else {
      this.#sendButton.disabled = !this.#campaignActive;
      this.#sendButton.className = 'btn btn-primary';
      this.#sendButton.textContent = 'Send';
    }
  }

  /**
   * @param {'normal' | 'encounter'} requestedMode
   * @returns {void}
   */
  #submitTurn(requestedMode) {
    const rawText = this.#textarea.value;
    const isNarrator = ComposerBar.#NarratorPrefixPattern.test(rawText);
    const strippedNarrator = rawText.replace(ComposerBar.#NarratorPrefixPattern, '').trim();
    const effectiveMode = requestedMode === 'encounter'
      ? 'encounter'
      : isNarrator
        ? 'narrator'
        : 'normal';

    if (effectiveMode !== 'encounter' && (isNarrator ? strippedNarrator.length === 0 : rawText.trim().length === 0)) {
      this.setAlert('Write a message before sending, or click Encounter.', { level: 'warning' });
      return;
    }

    this.setAlert(null);
    const trimmedOoc = this.#oocInput.value.trim();
    void this.#onSend({
      text: rawText,
      mode: effectiveMode,
      oocNudge: trimmedOoc.length > 0 ? trimmedOoc : null,
    });
  }
}
