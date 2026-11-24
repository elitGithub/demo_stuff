export class CampaignModal {
  #modalRoot;
  #documentRef;
  #onSave;
  #onRequestDelete;
  #state = null;
  #keyHandler = null;

  /**
   * @param {{modalRoot: HTMLElement, documentRef?: Document | null, onSave: (payload: Record<string, unknown>, existingCampaign: object | null) => Promise<void>, onRequestDelete: (campaign: object) => void}} options
   * @throws {TypeError}
   */
  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('CampaignModal options must be a plain object.');
    }
    const { modalRoot, documentRef = null, onSave, onRequestDelete } = options;
    if (modalRoot === null || typeof modalRoot !== 'object') {
      throw new TypeError('modalRoot element is required.');
    }
    if (typeof onSave !== 'function' || typeof onRequestDelete !== 'function') {
      throw new TypeError('onSave and onRequestDelete callbacks are required.');
    }
    this.#modalRoot = modalRoot;
    this.#documentRef = documentRef ?? (typeof document !== 'undefined' ? document : null);
    this.#onSave = onSave;
    this.#onRequestDelete = onRequestDelete;
  }

  /**
   * @param {{campaign?: object | null, settings?: object | null, characters?: Array<object>}} [options]
   * @returns {void}
   */
  open({ campaign = null, settings = null, characters = [] } = {}) {
    this.close();
    const isEdit = campaign !== null && typeof campaign === 'object';
    this.#state = {
      campaign: isEdit ? campaign : null,
      characters: Array.isArray(characters) ? characters.filter((entry) => !entry.archived) : [],
      values: {
        title: isEdit ? String(campaign.title ?? '') : '',
        premise: isEdit ? String(campaign.premise ?? '') : '',
        styleNotes: isEdit ? String(campaign.styleNotes ?? '') : '',
        encounterPublicOdds: isEdit
          ? String(campaign.encounterPublicOdds ?? 8)
          : String(settings?.publicOdds ?? 8),
        encounterPrivateOdds: isEdit
          ? String(campaign.encounterPrivateOdds ?? 30)
          : String(settings?.privateOdds ?? 30),
        scribeInterval: isEdit
          ? String(campaign.scribeInterval ?? 10)
          : String(settings?.scribeInterval ?? 10),
        playerCharacterId: isEdit && typeof campaign.playerCharacterId === 'string'
          ? campaign.playerCharacterId
          : '',
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
    const isEdit = state.campaign !== null;

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
    card.setAttribute('aria-labelledby', 'campaign-modal-title');
    card.noValidate = true;

    const header = this.#documentRef.createElement('div');
    header.className = 'modal-header';

    const titleHeading = this.#documentRef.createElement('h2');
    titleHeading.id = 'campaign-modal-title';
    titleHeading.className = 'modal-title';
    titleHeading.textContent = isEdit ? 'Edit Campaign' : 'New Campaign';

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

    const titleInput = this.#documentRef.createElement('input');
    titleInput.id = 'campaign-title-input';
    titleInput.type = 'text';
    titleInput.className = 'field-control';
    titleInput.required = true;
    titleInput.setAttribute('aria-required', 'true');
    titleInput.value = state.values.title;
    titleInput.disabled = state.busy;
    titleInput.placeholder = 'Campaign title';
    titleInput.addEventListener('input', () => {
      state.values.title = titleInput.value;
    });
    body.append(this.#createField('Title', titleInput, { required: true }));

    const premiseInput = this.#documentRef.createElement('textarea');
    premiseInput.id = 'campaign-premise-input';
    premiseInput.className = 'field-control';
    premiseInput.rows = 3;
    premiseInput.value = state.values.premise;
    premiseInput.disabled = state.busy;
    premiseInput.placeholder = 'Setting, stakes, and starting situation';
    premiseInput.addEventListener('input', () => {
      state.values.premise = premiseInput.value;
    });
    body.append(this.#createField('Premise', premiseInput));

    const styleInput = this.#documentRef.createElement('textarea');
    styleInput.id = 'campaign-style-input';
    styleInput.className = 'field-control';
    styleInput.rows = 2;
    styleInput.value = state.values.styleNotes;
    styleInput.disabled = state.busy;
    styleInput.placeholder = 'Tone, prose pacing, and style instructions';
    styleInput.addEventListener('input', () => {
      state.values.styleNotes = styleInput.value;
    });
    body.append(this.#createField('Style notes', styleInput));

    const oddsRow = this.#documentRef.createElement('div');
    oddsRow.className = 'form-grid-two';

    const publicOddsInput = this.#documentRef.createElement('input');
    publicOddsInput.id = 'campaign-public-odds-input';
    publicOddsInput.type = 'number';
    publicOddsInput.min = '0';
    publicOddsInput.step = '1';
    publicOddsInput.className = 'field-control';
    publicOddsInput.value = state.values.encounterPublicOdds;
    publicOddsInput.disabled = state.busy;
    publicOddsInput.addEventListener('input', () => {
      state.values.encounterPublicOdds = publicOddsInput.value;
    });
    oddsRow.append(this.#createField('Public odds (1/N, 0=off)', publicOddsInput));

    const privateOddsInput = this.#documentRef.createElement('input');
    privateOddsInput.id = 'campaign-private-odds-input';
    privateOddsInput.type = 'number';
    privateOddsInput.min = '0';
    privateOddsInput.step = '1';
    privateOddsInput.className = 'field-control';
    privateOddsInput.value = state.values.encounterPrivateOdds;
    privateOddsInput.disabled = state.busy;
    privateOddsInput.addEventListener('input', () => {
      state.values.encounterPrivateOdds = privateOddsInput.value;
    });
    oddsRow.append(this.#createField('Private odds (1/N, 0=off)', privateOddsInput));

    const scribeInput = this.#documentRef.createElement('input');
    scribeInput.id = 'campaign-scribe-interval-input';
    scribeInput.type = 'number';
    scribeInput.min = '0';
    scribeInput.step = '1';
    scribeInput.className = 'field-control';
    scribeInput.value = state.values.scribeInterval;
    scribeInput.disabled = state.busy;
    scribeInput.addEventListener('input', () => {
      state.values.scribeInterval = scribeInput.value;
    });
    oddsRow.append(this.#createField('Scribe interval (0=manual)', scribeInput));

    body.append(oddsRow);

    if (isEdit) {
      const playerSelect = this.#documentRef.createElement('select');
      playerSelect.id = 'campaign-player-select';
      playerSelect.className = 'field-control';
      playerSelect.disabled = state.busy;

      const noneOption = this.#documentRef.createElement('option');
      noneOption.value = '';
      noneOption.textContent = '(None - Ensemble / Spectator)';
      playerSelect.append(noneOption);

      for (const character of state.characters) {
        const option = this.#documentRef.createElement('option');
        option.value = character.id;
        option.textContent = `${character.name} (@${character.slug})`;
        playerSelect.append(option);
      }
      playerSelect.value = state.values.playerCharacterId;
      playerSelect.addEventListener('change', () => {
        state.values.playerCharacterId = playerSelect.value;
      });
      body.append(this.#createField('Player character', playerSelect));
    }

    if (state.errorMessage.length > 0) {
      const errorBox = this.#documentRef.createElement('div');
      errorBox.className = 'inline-alert is-danger';
      errorBox.setAttribute('role', 'alert');
      errorBox.textContent = state.errorMessage;
      body.append(errorBox);
    }

    const footer = this.#documentRef.createElement('div');
    footer.className = 'modal-footer';

    if (isEdit) {
      const deleteButton = this.#documentRef.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'btn is-danger';
      deleteButton.textContent = 'Delete';
      deleteButton.disabled = state.busy;
      deleteButton.addEventListener('click', () => {
        if (!state.busy && state.campaign !== null) {
          const targetCampaign = state.campaign;
          this.close();
          this.#onRequestDelete(targetCampaign);
        }
      });
      footer.append(deleteButton);
    }

    const rightActions = this.#documentRef.createElement('div');
    rightActions.className = 'modal-footer-actions';

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

    rightActions.append(cancelButton, saveButton);
    footer.append(rightActions);

    card.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (state.busy) {
        return;
      }

      const trimmedTitle = state.values.title.trim();
      if (trimmedTitle.length === 0) {
        state.errorMessage = 'Title is required.';
        this.#render();
        return;
      }

      const publicOdds = Number.parseInt(state.values.encounterPublicOdds, 10);
      const privateOdds = Number.parseInt(state.values.encounterPrivateOdds, 10);
      const scribeInterval = Number.parseInt(state.values.scribeInterval, 10);
      if (!/^\d+$/.test(state.values.encounterPublicOdds.trim()) || !Number.isSafeInteger(publicOdds) || publicOdds < 0) {
        state.errorMessage = 'Public encounter odds must be a non-negative integer.';
        this.#render();
        return;
      }
      if (!/^\d+$/.test(state.values.encounterPrivateOdds.trim()) || !Number.isSafeInteger(privateOdds) || privateOdds < 0) {
        state.errorMessage = 'Private encounter odds must be a non-negative integer.';
        this.#render();
        return;
      }
      if (!/^\d+$/.test(state.values.scribeInterval.trim()) || !Number.isSafeInteger(scribeInterval) || scribeInterval < 0) {
        state.errorMessage = 'Scribe interval must be a non-negative integer.';
        this.#render();
        return;
      }

      const payload = {
        title: trimmedTitle,
        premise: state.values.premise,
        styleNotes: state.values.styleNotes,
        encounterPublicOdds: publicOdds,
        encounterPrivateOdds: privateOdds,
        scribeInterval,
      };
      if (isEdit) {
        payload.playerCharacterId = state.values.playerCharacterId.length > 0 ? state.values.playerCharacterId : null;
      }

      state.busy = true;
      state.errorMessage = '';
      this.#render();
      try {
        await this.#onSave(payload, state.campaign);
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

    if (!state.busy && typeof titleInput.focus === 'function') {
      titleInput.focus();
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
}
