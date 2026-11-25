import { FocusKeeper } from './FocusKeeper.mjs';
import { ModelCatalogView } from './ModelCatalogView.mjs';

export class CharacterModal {
  static #AvatarTokens = Object.freeze([
    { value: 'sage', label: 'Sage' },
    { value: 'rose', label: 'Rose' },
    { value: 'amber', label: 'Amber' },
    { value: 'slate', label: 'Slate' },
    { value: 'plum', label: 'Plum' },
    { value: 'teal', label: 'Teal' },
    { value: 'indigo', label: 'Indigo' },
    { value: 'coral', label: 'Coral' },
  ]);

  static #TierDefaultPlaceholder = 'Use tier default (no override)';
  static #RefreshButtonId = 'char-refresh-models';
  static #CloseButtonId = 'char-modal-close';
  static #CancelButtonId = 'char-modal-cancel';
  static #SaveButtonId = 'char-modal-save';
  static #AvatarButtonIdPrefix = 'char-avatar-';
  static #ScrollSelector = '.modal-card';

  #modalRoot;
  #documentRef;
  #onSave;
  #state = null;
  #keyHandler = null;
  #firstWarningElement = null;

  /**
   * @param {{modalRoot: HTMLElement, documentRef?: Document | null, onSave: (payload: Record<string, unknown>, existingCharacter: object | null) => Promise<object | void>}} options
   * @throws {TypeError}
   */
  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('CharacterModal options must be a plain object.');
    }
    const { modalRoot, documentRef = null, onSave } = options;
    if (modalRoot === null || typeof modalRoot !== 'object') {
      throw new TypeError('modalRoot element is required.');
    }
    if (typeof onSave !== 'function') {
      throw new TypeError('onSave callback is required.');
    }
    this.#modalRoot = modalRoot;
    this.#documentRef = documentRef ?? (typeof document !== 'undefined' ? document : null);
    this.#onSave = onSave;
  }

  /**
   * @param {{character?: object | null, modelCatalog?: object | null, modelCatalogLoading?: boolean, modelCatalogError?: string, onRefreshModels?: (() => Promise<void>) | null}} [options]
   * @returns {void}
   */
  open({
    character = null,
    modelCatalog = null,
    modelCatalogLoading = false,
    modelCatalogError = '',
    onRefreshModels = null,
  } = {}) {
    this.close();
    const isEdit = character !== null && typeof character === 'object';
    this.#state = {
      character: isEdit ? character : null,
      modelCatalog,
      onRefreshModels,
      catalogLoading: Boolean(modelCatalogLoading),
      catalogError: modelCatalogError,
      refreshFocusPending: false,
      modelFilter: '',
      slugManuallyEdited: isEdit,
      values: CharacterModal.#buildValues(isEdit ? character : null),
      busy: false,
      errorMessage: '',
      warnings: [],
    };

    if (this.#documentRef !== null && typeof this.#documentRef.addEventListener === 'function') {
      this.#keyHandler = (event) => {
        if (event.key === 'Escape' && this.#state !== null && !this.#state.busy) {
          event.preventDefault();
          this.close();
        }
      };
      this.#documentRef.addEventListener('keydown', this.#keyHandler);
    }

    this.#render({ focusName: true });
  }

  /**
   * @param {object | null} modelCatalog
   * @returns {void}
   */
  setModelCatalog(modelCatalog) {
    if (this.#state === null) {
      return;
    }
    this.#state.modelCatalog = modelCatalog;
    this.#state.catalogLoading = false;
    this.#state.catalogError = '';
    this.#renderCatalogUpdate();
  }

  /**
   * @param {boolean} isLoading
   * @returns {void}
   */
  setModelCatalogLoading(isLoading) {
    if (this.#state === null) {
      return;
    }
    this.#state.catalogLoading = Boolean(isLoading);
    if (this.#state.catalogLoading) {
      this.#state.catalogError = '';
    }
    this.#renderCatalogUpdate();
  }

  /**
   * @param {unknown} errorMessage
   * @returns {void}
   */
  setModelCatalogError(errorMessage) {
    if (this.#state === null) {
      return;
    }
    this.#state.catalogLoading = false;
    this.#state.catalogError = typeof errorMessage === 'string' ? errorMessage : String(errorMessage ?? '');
    this.#renderCatalogUpdate();
  }

  /**
   * @returns {void}
   */
  close() {
    if (this.#keyHandler !== null && this.#documentRef !== null && typeof this.#documentRef.removeEventListener === 'function') {
      this.#documentRef.removeEventListener('keydown', this.#keyHandler);
    }
    this.#keyHandler = null;
    this.#state = null;
    this.#modalRoot.replaceChildren();
  }

  /**
   * @returns {void}
   */
  #renderCatalogUpdate() {
    const refreshReturn = FocusKeeper.takeRefreshReturn({
      isLoading: this.#state.catalogLoading,
      isPending: this.#state.refreshFocusPending,
      refreshButtonId: CharacterModal.#RefreshButtonId,
    });
    this.#state.refreshFocusPending = refreshReturn.isPending;
    FocusKeeper.keep({
      documentRef: this.#documentRef,
      containerElement: this.#modalRoot,
      scrollSelector: CharacterModal.#ScrollSelector,
      renderFn: () => {
        this.#render({ focusName: false });
      },
      returnFocusId: refreshReturn.returnFocusId,
    });
  }

  /**
   * @param {{name?: string, slug?: string, aliases?: Array<string>, tier?: string, isPlayer?: boolean, modelOverride?: string | null, card: {personalitySummary: string, speakingStyle: string}, avatarToken?: string, avatarInitials?: string} | null} character
   * @returns {{name: string, slug: string, aliasesText: string, tier: string, isPlayer: boolean, modelOverride: string, personalitySummary: string, speakingStyle: string, avatarToken: string, avatarInitials: string}}
   * @throws {TypeError}
   */
  static #buildValues(character) {
    const isEdit = character !== null;
    return {
      name: isEdit ? String(character.name ?? '') : '',
      slug: isEdit ? String(character.slug ?? '') : '',
      aliasesText: isEdit && Array.isArray(character.aliases) ? character.aliases.join(', ') : '',
      tier: isEdit && character.tier === 'recurring' ? 'recurring' : 'main',
      isPlayer: isEdit ? Boolean(character.isPlayer) : false,
      modelOverride: isEdit && typeof character.modelOverride === 'string' ? character.modelOverride : '',
      personalitySummary: isEdit ? character.card.personalitySummary : '',
      speakingStyle: isEdit ? character.card.speakingStyle : '',
      avatarToken: isEdit && typeof character.avatarToken === 'string' ? character.avatarToken : 'slate',
      avatarInitials: isEdit && typeof character.avatarInitials === 'string' ? character.avatarInitials : '',
    };
  }

  /**
   * @param {{focusName?: boolean}} [options]
   * @returns {void}
   */
  #render({ focusName = true } = {}) {
    if (this.#state === null || this.#documentRef === null) {
      return;
    }

    const state = this.#state;
    const isEdit = state.character !== null;

    const backdrop = this.#documentRef.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop && !state.busy) {
        this.close();
      }
    });

    const card = this.#documentRef.createElement('form');
    card.className = 'modal-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'character-modal-title');
    card.noValidate = true;

    const header = this.#documentRef.createElement('div');
    header.className = 'modal-header';

    const titleHeading = this.#documentRef.createElement('h2');
    titleHeading.id = 'character-modal-title';
    titleHeading.className = 'modal-title';
    titleHeading.textContent = isEdit ? 'Edit Character' : 'Add Character';

    const closeButton = this.#documentRef.createElement('button');
    closeButton.id = CharacterModal.#CloseButtonId;
    closeButton.type = 'button';
    closeButton.className = 'btn btn-ghost btn-compact';
    closeButton.textContent = 'Close';
    closeButton.disabled = state.busy;
    closeButton.addEventListener('click', () => {
      if (!state.busy) {
        this.close();
      }
    });
    header.append(titleHeading, closeButton);

    const body = this.#documentRef.createElement('div');
    body.className = 'modal-body';

    const identityRow = this.#documentRef.createElement('div');
    identityRow.className = 'form-grid-two';

    const nameInput = this.#documentRef.createElement('input');
    nameInput.id = 'char-name-input';
    nameInput.type = 'text';
    nameInput.maxLength = 60;
    nameInput.required = true;
    nameInput.setAttribute('aria-required', 'true');
    nameInput.className = 'field-control';
    nameInput.value = state.values.name;
    nameInput.disabled = state.busy;
    nameInput.placeholder = 'Character name';

    const slugInput = this.#documentRef.createElement('input');
    slugInput.id = 'char-slug-input';
    slugInput.type = 'text';
    slugInput.maxLength = 48;
    slugInput.required = true;
    slugInput.setAttribute('aria-required', 'true');
    slugInput.pattern = '^[a-z0-9][a-z0-9_-]{0,47}$';
    slugInput.className = 'field-control';
    slugInput.value = state.values.slug;
    slugInput.disabled = state.busy;
    slugInput.placeholder = 'lowercase_slug';

    nameInput.addEventListener('input', () => {
      state.values.name = nameInput.value;
      if (!state.slugManuallyEdited) {
        const autoSlug = nameInput.value
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '_')
          .replace(/^[_-]+|[_-]+$/g, '')
          .slice(0, 48);
        state.values.slug = autoSlug;
        slugInput.value = autoSlug;
      }
    });

    slugInput.addEventListener('input', () => {
      state.slugManuallyEdited = true;
      state.values.slug = slugInput.value;
    });

    identityRow.append(
      this.#createField('Name (max 60)', nameInput, { required: true }),
      this.#createField('Slug', slugInput, { required: true }),
    );
    body.append(identityRow);

    const aliasesInput = this.#documentRef.createElement('input');
    aliasesInput.id = 'char-aliases-input';
    aliasesInput.type = 'text';
    aliasesInput.className = 'field-control';
    aliasesInput.value = state.values.aliasesText;
    aliasesInput.disabled = state.busy;
    aliasesInput.placeholder = 'Comma-separated aliases (optional)';
    aliasesInput.addEventListener('input', () => {
      state.values.aliasesText = aliasesInput.value;
    });
    body.append(this.#createField('Aliases', aliasesInput));

    const tierRow = this.#documentRef.createElement('div');
    tierRow.className = 'form-grid-two';

    const tierSelect = this.#documentRef.createElement('select');
    tierSelect.id = 'char-tier-select';
    tierSelect.className = 'field-control';
    tierSelect.disabled = state.busy;

    const mainOption = this.#documentRef.createElement('option');
    mainOption.value = 'main';
    mainOption.textContent = 'Main';
    const recurringOption = this.#documentRef.createElement('option');
    recurringOption.value = 'recurring';
    recurringOption.textContent = 'Recurring';
    tierSelect.append(mainOption, recurringOption);
    tierSelect.value = state.values.tier;
    tierSelect.addEventListener('change', () => {
      state.values.tier = tierSelect.value;
    });

    const initialsInput = this.#documentRef.createElement('input');
    initialsInput.id = 'char-initials-input';
    initialsInput.type = 'text';
    initialsInput.maxLength = 4;
    initialsInput.className = 'field-control';
    initialsInput.value = state.values.avatarInitials;
    initialsInput.disabled = state.busy;
    initialsInput.placeholder = 'Auto';
    initialsInput.addEventListener('input', () => {
      state.values.avatarInitials = initialsInput.value;
    });

    tierRow.append(
      this.#createField('Tier', tierSelect),
      this.#createField('Avatar initials', initialsInput),
    );
    body.append(tierRow);

    const playerLabel = this.#documentRef.createElement('label');
    playerLabel.className = 'checkbox-row';
    const playerCheckbox = this.#documentRef.createElement('input');
    playerCheckbox.id = 'char-player-checkbox';
    playerCheckbox.type = 'checkbox';
    playerCheckbox.checked = state.values.isPlayer;
    playerCheckbox.disabled = state.busy;
    playerCheckbox.addEventListener('change', () => {
      state.values.isPlayer = playerCheckbox.checked;
    });
    const playerText = this.#documentRef.createElement('span');
    playerText.textContent = 'Player character (POV protagonist)';
    playerLabel.append(playerCheckbox, playerText);
    body.append(playerLabel);

    const modelGroup = this.#documentRef.createElement('div');
    modelGroup.className = 'model-slot-group';

    const modelInput = this.#documentRef.createElement('input');
    modelInput.id = 'char-model-input';
    modelInput.type = 'text';
    modelInput.className = 'field-control';
    modelInput.value = state.values.modelOverride;
    modelInput.disabled = state.busy;
    modelInput.placeholder = 'Optional OpenRouter model override';
    modelGroup.append(this.#createField('Model override', modelInput));

    if (state.modelCatalog !== null || typeof state.onRefreshModels === 'function') {
      const pickerToolbar = this.#documentRef.createElement('div');
      pickerToolbar.className = 'action-row-split';

      const filterInput = this.#documentRef.createElement('input');
      filterInput.id = 'char-model-filter';
      filterInput.type = 'search';
      filterInput.className = 'field-control';
      filterInput.placeholder = 'Filter models...';
      filterInput.value = state.modelFilter;
      filterInput.disabled = state.busy;

      const modelSelect = this.#documentRef.createElement('select');
      modelSelect.id = 'char-model-picker';
      modelSelect.className = 'field-control model-picker-select';
      modelSelect.setAttribute('aria-label', 'Model override quick pick');
      modelSelect.disabled = state.busy;
      this.#populateOverrideSelect(modelSelect, state.values.modelOverride, state.modelFilter);

      if (typeof state.onRefreshModels === 'function') {
        const refreshBtn = this.#documentRef.createElement('button');
        refreshBtn.id = CharacterModal.#RefreshButtonId;
        refreshBtn.type = 'button';
        refreshBtn.className = state.catalogLoading
          ? 'btn btn-secondary btn-compact is-loading'
          : 'btn btn-secondary btn-compact';
        refreshBtn.disabled = state.busy || state.catalogLoading;
        refreshBtn.textContent = state.catalogLoading
          ? ModelCatalogView.RefreshBusyLabel
          : ModelCatalogView.RefreshLabel;
        refreshBtn.addEventListener('click', () => {
          state.refreshFocusPending = true;
          return state.onRefreshModels();
        });
        pickerToolbar.append(filterInput, refreshBtn);
      } else {
        pickerToolbar.append(filterInput);
      }

      filterInput.addEventListener('input', () => {
        state.modelFilter = filterInput.value;
        this.#populateOverrideSelect(modelSelect, state.values.modelOverride, state.modelFilter);
      });

      modelInput.addEventListener('input', () => {
        state.values.modelOverride = modelInput.value;
        this.#populateOverrideSelect(modelSelect, state.values.modelOverride, state.modelFilter);
      });

      modelSelect.addEventListener('change', () => {
        state.values.modelOverride = modelSelect.value;
        modelInput.value = modelSelect.value;
      });

      modelGroup.append(pickerToolbar, modelSelect);

      const catalogStatusText = ModelCatalogView.statusText(state.modelCatalog, state.catalogLoading);
      if (catalogStatusText.length > 0) {
        const catalogStatus = this.#documentRef.createElement('div');
        catalogStatus.className = 'item-meta';
        catalogStatus.textContent = catalogStatusText;
        modelGroup.append(catalogStatus);
      }
      if (state.catalogError.length > 0) {
        const catalogAlert = this.#documentRef.createElement('div');
        catalogAlert.className = 'inline-alert is-danger';
        catalogAlert.setAttribute('role', 'alert');
        catalogAlert.textContent = state.catalogError;
        modelGroup.append(catalogAlert);
      }
      if (typeof state.modelCatalog?.warning === 'string' && state.modelCatalog.warning.length > 0) {
        const warningAlert = this.#documentRef.createElement('div');
        warningAlert.className = 'inline-alert is-warning';
        warningAlert.textContent = state.modelCatalog.warning;
        modelGroup.append(warningAlert);
      }
    } else {
      modelInput.addEventListener('input', () => {
        state.values.modelOverride = modelInput.value;
      });
    }

    body.append(modelGroup);

    const tokenGroup = this.#documentRef.createElement('div');
    tokenGroup.className = 'field-group';
    const tokenLabel = this.#documentRef.createElement('span');
    tokenLabel.className = 'field-label';
    tokenLabel.textContent = 'Avatar color token';
    const tokenPicker = this.#documentRef.createElement('div');
    tokenPicker.className = 'token-picker';
    tokenPicker.setAttribute('role', 'radiogroup');
    tokenPicker.setAttribute('aria-label', 'Avatar color token');

    for (const tokenEntry of CharacterModal.#AvatarTokens) {
      const isSelected = state.values.avatarToken === tokenEntry.value;
      const optionButton = this.#documentRef.createElement('button');
      optionButton.id = `${CharacterModal.#AvatarButtonIdPrefix}${tokenEntry.value}`;
      optionButton.type = 'button';
      optionButton.className = isSelected ? 'token-option is-active' : 'token-option';
      optionButton.setAttribute('role', 'radio');
      optionButton.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      optionButton.disabled = state.busy;
      optionButton.addEventListener('click', () => {
        if (!state.busy) {
          state.values.avatarToken = tokenEntry.value;
          this.#render();
        }
      });

      const swatch = this.#documentRef.createElement('span');
      swatch.className = `avatar-swatch avatar-${tokenEntry.value}`;
      swatch.setAttribute('aria-hidden', 'true');

      const labelSpan = this.#documentRef.createElement('span');
      labelSpan.textContent = tokenEntry.label;

      optionButton.append(swatch, labelSpan);
      tokenPicker.append(optionButton);
    }
    tokenGroup.append(tokenLabel, tokenPicker);
    body.append(tokenGroup);

    const personaInput = this.#documentRef.createElement('textarea');
    personaInput.id = 'char-persona-input';
    personaInput.className = 'field-control';
    personaInput.rows = 3;
    personaInput.value = state.values.personalitySummary;
    personaInput.disabled = state.busy;
    personaInput.placeholder = 'Background, personality, goals, and secrets';
    personaInput.addEventListener('input', () => {
      state.values.personalitySummary = personaInput.value;
    });
    body.append(this.#createField('Persona', personaInput));

    const voiceInput = this.#documentRef.createElement('textarea');
    voiceInput.id = 'char-voice-input';
    voiceInput.className = 'field-control';
    voiceInput.rows = 2;
    voiceInput.value = state.values.speakingStyle;
    voiceInput.disabled = state.busy;
    voiceInput.placeholder = 'Speech rhythm, habits, and diction';
    voiceInput.addEventListener('input', () => {
      state.values.speakingStyle = voiceInput.value;
    });
    body.append(this.#createField('Voice notes', voiceInput));

    if (state.errorMessage.length > 0) {
      const errorBox = this.#documentRef.createElement('div');
      errorBox.className = 'inline-alert is-danger';
      errorBox.setAttribute('role', 'alert');
      errorBox.textContent = state.errorMessage;
      body.append(errorBox);
    }
    this.#firstWarningElement = null;
    for (const saveWarning of state.warnings) {
      const warningBox = this.#documentRef.createElement('div');
      warningBox.className = 'inline-alert is-warning';
      warningBox.textContent = saveWarning;
      body.append(warningBox);
      if (this.#firstWarningElement === null) {
        this.#firstWarningElement = warningBox;
      }
    }

    const footer = this.#documentRef.createElement('div');
    footer.className = 'modal-footer';

    const actions = this.#documentRef.createElement('div');
    actions.className = 'modal-footer-actions';

    const cancelButton = this.#documentRef.createElement('button');
    cancelButton.id = CharacterModal.#CancelButtonId;
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn-secondary';
    cancelButton.textContent = 'Cancel';
    cancelButton.disabled = state.busy;
    cancelButton.addEventListener('click', () => {
      if (!state.busy) {
        this.close();
      }
    });

    const saveButton = this.#documentRef.createElement('button');
    saveButton.id = CharacterModal.#SaveButtonId;
    saveButton.type = 'submit';
    saveButton.className = state.busy ? 'btn btn-primary is-loading' : 'btn btn-primary';
    saveButton.textContent = state.busy ? 'Saving...' : 'Save';
    saveButton.disabled = state.busy;

    actions.append(cancelButton, saveButton);
    footer.append(actions);

    card.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (state.busy) {
        return;
      }

      const trimmedName = state.values.name.trim();
      const normalizedSlug = state.values.slug.trim().toLowerCase();
      if (trimmedName.length === 0) {
        state.errorMessage = 'Name is required.';
        this.#render();
        return;
      }
      if (trimmedName.length > 60) {
        state.errorMessage = 'Name must be 60 characters or fewer.';
        this.#render();
        return;
      }
      if (trimmedName.toLowerCase() === 'narrator') {
        state.errorMessage = 'Name "Narrator" is reserved.';
        this.#render();
        return;
      }
      if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(normalizedSlug)) {
        state.errorMessage = 'Slug must start with a-z or 0-9 and contain only a-z, 0-9, _, or - (max 48 chars).';
        this.#render();
        return;
      }
      if (normalizedSlug === 'narrator') {
        state.errorMessage = 'Slug "narrator" is reserved.';
        this.#render();
        return;
      }

      const aliases = state.values.aliasesText
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const trimmedOverride = state.values.modelOverride.trim();
      const trimmedInitials = state.values.avatarInitials.trim();

      const payload = {
        name: trimmedName,
        slug: normalizedSlug,
        aliases,
        tier: state.values.tier,
        isPlayer: state.values.isPlayer,
        modelOverride: trimmedOverride.length > 0 ? trimmedOverride : null,
        card: {
          personalitySummary: state.values.personalitySummary,
          speakingStyle: state.values.speakingStyle,
        },
        avatarToken: state.values.avatarToken,
      };
      if (trimmedInitials.length > 0) {
        payload.avatarInitials = trimmedInitials.slice(0, 4);
      }

      state.busy = true;
      state.errorMessage = '';
      state.warnings = [];
      this.#render();
      try {
        const savedCharacter = await this.#onSave(payload, state.character);
        const saveWarnings = Array.isArray(savedCharacter?.warnings) ? savedCharacter.warnings : [];
        if (saveWarnings.length === 0) {
          this.close();
        } else if (this.#state === state) {
          state.character = savedCharacter;
          state.values = CharacterModal.#buildValues(savedCharacter);
          state.slugManuallyEdited = true;
          state.warnings = saveWarnings;
          state.busy = false;
          this.#render({ focusName: false });
          FocusKeeper.reveal(this.#firstWarningElement);
        }
      } catch (saveError) {
        if (this.#state === state) {
          state.busy = false;
          state.errorMessage = saveError instanceof Error ? saveError.message : String(saveError);
          this.#render();
        }
      }
    });

    card.append(header, body, footer);
    backdrop.append(card);
    this.#modalRoot.replaceChildren(backdrop);

    if (focusName && !state.busy && typeof nameInput.focus === 'function') {
      nameInput.focus();
    }
  }

  /**
   * @param {string} labelText
   * @param {HTMLElement} controlElement
   * @param {{required?: boolean}} [options]
   * @returns {HTMLElement}
   */
  #createField(labelText, controlElement, { required = false } = {}) {
    const group = this.#documentRef.createElement('div');
    group.className = 'field-group';

    const label = this.#documentRef.createElement('label');
    label.className = 'field-label';
    if (typeof controlElement.id === 'string' && controlElement.id.length > 0) {
      label.setAttribute('for', controlElement.id);
    }
    label.textContent = labelText;

    if (required) {
      const marker = this.#documentRef.createElement('span');
      marker.className = 'required-marker';
      marker.setAttribute('aria-hidden', 'true');
      marker.textContent = '*';
      label.append(marker);
    }

    group.append(label, controlElement);
    return group;
  }

  /**
   * @param {HTMLSelectElement} selectElement
   * @param {string} currentValue
   * @param {string} filterQuery
   * @returns {void}
   */
  #populateOverrideSelect(selectElement, currentValue, filterQuery) {
    ModelCatalogView.populateSelect({
      documentRef: this.#documentRef,
      selectElement,
      catalog: this.#state.modelCatalog,
      currentValue,
      filterQuery,
      emptyOptionText: CharacterModal.#TierDefaultPlaceholder,
      hiddenOptionText: ModelCatalogView.SelectPlaceholder,
    });
  }
}
