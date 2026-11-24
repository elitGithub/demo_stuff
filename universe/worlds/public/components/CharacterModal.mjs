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

  #modalRoot;
  #documentRef;
  #onSave;
  #state = null;
  #keyHandler = null;

  /**
   * @param {{modalRoot: HTMLElement, documentRef?: Document | null, onSave: (payload: Record<string, unknown>, existingCharacter: object | null) => Promise<void>}} options
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
   * @param {{character?: object | null, modelCatalog?: object | null, onLoadAllModels?: ((refresh: boolean) => Promise<void>) | null}} [options]
   * @returns {void}
   */
  open({ character = null, modelCatalog = null, onLoadAllModels = null } = {}) {
    this.close();
    const isEdit = character !== null && typeof character === 'object';
    this.#state = {
      character: isEdit ? character : null,
      modelCatalog,
      onLoadAllModels,
      catalogLoading: false,
      catalogError: '',
      modelFilter: '',
      slugManuallyEdited: isEdit,
      values: {
        name: isEdit ? String(character.name ?? '') : '',
        slug: isEdit ? String(character.slug ?? '') : '',
        aliasesText: isEdit && Array.isArray(character.aliases) ? character.aliases.join(', ') : '',
        tier: isEdit && character.tier === 'recurring' ? 'recurring' : 'main',
        isPlayer: isEdit ? Boolean(character.isPlayer) : false,
        modelOverride: isEdit && typeof character.modelOverride === 'string' ? character.modelOverride : '',
        persona: isEdit ? String(character.persona ?? '') : '',
        voiceNotes: isEdit ? String(character.voiceNotes ?? '') : '',
        avatarToken: isEdit && typeof character.avatarToken === 'string' ? character.avatarToken : 'slate',
        avatarInitials: isEdit && typeof character.avatarInitials === 'string' ? character.avatarInitials : '',
      },
      busy: false,
      errorMessage: '',
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

    this.#render();
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
    this.#state = null;
    this.#modalRoot.replaceChildren();
  }

  /**
   * @returns {void}
   */
  #render() {
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

    if (state.modelCatalog !== null || typeof state.onLoadAllModels === 'function') {
      const hasOpenRouter = Array.isArray(state.modelCatalog?.openrouter);
      const pickerToolbar = this.#documentRef.createElement('div');
      pickerToolbar.className = 'action-row-split';

      const filterInput = this.#documentRef.createElement('input');
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

      if (typeof state.onLoadAllModels === 'function') {
        const loadBtn = this.#documentRef.createElement('button');
        loadBtn.type = 'button';
        loadBtn.className = state.catalogLoading
          ? 'btn btn-secondary btn-compact is-loading'
          : 'btn btn-secondary btn-compact';
        loadBtn.disabled = state.busy || state.catalogLoading;
        loadBtn.textContent = state.catalogLoading
          ? 'Loading catalog...'
          : hasOpenRouter
            ? 'Refresh OpenRouter models'
            : 'Load all OpenRouter models';
        loadBtn.addEventListener('click', async () => {
          if (state.catalogLoading) {
            return;
          }
          state.catalogLoading = true;
          state.catalogError = '';
          this.#render();
          try {
            await state.onLoadAllModels(hasOpenRouter);
          } catch (loadError) {
            if (this.#state === state) {
              state.catalogLoading = false;
              state.catalogError = loadError instanceof Error ? loadError.message : String(loadError);
              this.#render();
            }
          }
        });
        pickerToolbar.append(filterInput, loadBtn);
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
      if (state.catalogError.length > 0) {
        const catalogAlert = this.#documentRef.createElement('div');
        catalogAlert.className = 'inline-alert is-danger';
        catalogAlert.setAttribute('role', 'alert');
        catalogAlert.textContent = state.catalogError;
        modelGroup.append(catalogAlert);
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
    personaInput.value = state.values.persona;
    personaInput.disabled = state.busy;
    personaInput.placeholder = 'Background, personality, goals, and secrets';
    personaInput.addEventListener('input', () => {
      state.values.persona = personaInput.value;
    });
    body.append(this.#createField('Persona', personaInput));

    const voiceInput = this.#documentRef.createElement('textarea');
    voiceInput.id = 'char-voice-input';
    voiceInput.className = 'field-control';
    voiceInput.rows = 2;
    voiceInput.value = state.values.voiceNotes;
    voiceInput.disabled = state.busy;
    voiceInput.placeholder = 'Speech rhythm, habits, and diction';
    voiceInput.addEventListener('input', () => {
      state.values.voiceNotes = voiceInput.value;
    });
    body.append(this.#createField('Voice notes', voiceInput));

    if (state.errorMessage.length > 0) {
      const errorBox = this.#documentRef.createElement('div');
      errorBox.className = 'inline-alert is-danger';
      errorBox.setAttribute('role', 'alert');
      errorBox.textContent = state.errorMessage;
      body.append(errorBox);
    }

    const footer = this.#documentRef.createElement('div');
    footer.className = 'modal-footer';

    const actions = this.#documentRef.createElement('div');
    actions.className = 'modal-footer-actions';

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

    const saveButton = this.#documentRef.createElement('button');
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
        persona: state.values.persona,
        voiceNotes: state.values.voiceNotes,
        avatarToken: state.values.avatarToken,
      };
      if (trimmedInitials.length > 0) {
        payload.avatarInitials = trimmedInitials.slice(0, 4);
      }

      state.busy = true;
      state.errorMessage = '';
      this.#render();
      try {
        await this.#onSave(payload, state.character);
        this.close();
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

    if (!state.busy && typeof nameInput.focus === 'function') {
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
    const normalizedFilter = typeof filterQuery === 'string' ? filterQuery.trim().toLowerCase() : '';
    const catalog = this.#state?.modelCatalog ?? null;
    const nodes = [];

    const defaultOpt = this.#documentRef.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Use tier default (no override)';
    nodes.push(defaultOpt);

    const recommendedList = Array.isArray(catalog?.recommended) ? catalog.recommended : [];
    const matchingRec = recommendedList.filter((item) => {
      if (normalizedFilter.length === 0) {
        return true;
      }
      return [item.id, item.name, item.recommendedFor].some((field) => {
        return typeof field === 'string' && field.toLowerCase().includes(normalizedFilter);
      });
    });
    if (matchingRec.length > 0) {
      const recGroup = this.#documentRef.createElement('optgroup');
      recGroup.label = `Suggested (Unrestricted RP) - ${matchingRec.length}`;
      for (const item of matchingRec) {
        const option = this.#documentRef.createElement('option');
        option.value = item.id;
        option.textContent = item.recommendedFor ? `${item.id} (${item.recommendedFor})` : item.id;
        recGroup.append(option);
      }
      nodes.push(recGroup);
    }

    const openRouterList = Array.isArray(catalog?.openrouter) ? catalog.openrouter : [];
    if (openRouterList.length > 0) {
      const matchingOr = openRouterList
        .filter((item) => {
          if (normalizedFilter.length === 0) {
            return true;
          }
          return [item.id, item.name].some((field) => {
            return typeof field === 'string' && field.toLowerCase().includes(normalizedFilter);
          });
        })
        .slice(0, 60);
      if (matchingOr.length > 0) {
        const orGroup = this.#documentRef.createElement('optgroup');
        orGroup.label = `OpenRouter Catalog (${matchingOr.length})`;
        for (const item of matchingOr) {
          const option = this.#documentRef.createElement('option');
          option.value = item.id;
          option.textContent = item.isModerated === true ? `${item.id} (moderated)` : item.id;
          orGroup.append(option);
        }
        nodes.push(orGroup);
      }
    }

    selectElement.replaceChildren(...nodes);
    const hasExactOption = [
      ...matchingRec.map((item) => item.id),
      ...openRouterList.map((item) => item.id),
    ].includes(currentValue);
    selectElement.value = hasExactOption ? currentValue : '';
  }
}
