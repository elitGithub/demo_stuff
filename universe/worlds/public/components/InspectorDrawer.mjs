import { FocusKeeper } from './FocusKeeper.mjs';
import { ModelCatalogView } from './ModelCatalogView.mjs';

export class InspectorDrawer {
  static #SettingsTabId = 'settings';

  static #Tabs = Object.freeze([
    { id: 'scene', label: 'Scene' },
    { id: 'cast', label: 'Cast' },
    { id: 'memory', label: 'Memory' },
    { id: 'findings', label: 'Findings' },
    { id: InspectorDrawer.#SettingsTabId, label: 'Settings' },
  ]);

  static #MemorySections = Object.freeze([
    { id: 'subjects', label: 'Subjects' },
    { id: 'facts', label: 'Facts' },
    { id: 'relations', label: 'Relations' },
    { id: 'threads', label: 'Threads' },
    { id: 'rulings', label: 'Rulings' },
  ]);

  static #ModelSlots = Object.freeze([
    { key: 'director', label: 'Director model' },
    { key: 'composer', label: 'Composer model' },
    { key: 'main', label: 'Main character model' },
    { key: 'recurring', label: 'Recurring character model' },
    { key: 'scribe', label: 'Scribe / Pedant / Muse model' },
  ]);

  static #FilterPlaceholder = 'Filter OpenRouter models...';
  static #RefreshButtonId = 'settings-refresh-models';
  static #CloseButtonId = 'drawer-close';
  static #EditButtonIdPrefix = 'cast-edit-';
  static #TabButtonIdPrefix = 'drawer-tab-';
  static #ApplyDefaultsButtonId = 'settings-apply-defaults';
  static #ClearKeyButtonId = 'settings-clear-key';
  static #CancelButtonId = 'settings-cancel';
  static #SaveButtonId = 'settings-save';
  static #ScrollSelector = '.drawer-body';

  #drawerElement;
  #backdropElement;
  #documentRef;
  #callbacks;
  #firstWarningElement = null;

  #isOpen = false;
  #activeTab = 'scene';
  #campaign = null;
  #escapeHandler = null;

  #sceneDraft = {
    location: '',
    day: '1',
    timeLabel: '',
    sceneType: 'public',
  };
  #walkOnDraft = '';
  #sceneSaving = false;
  #presenceBusyId = null;
  #walkOnBusy = false;
  #sceneError = '';

  #castData = {
    items: [],
    total: 0,
    nextCursor: null,
    includeArchived: false,
    loadingMore: false,
    busyCharId: null,
    openingCharId: null,
    editFailure: null,
    error: '',
  };

  #memoryData = {
    section: 'subjects',
    query: '',
    queryDraft: '',
    items: [],
    total: 0,
    nextCursor: null,
    dirty: false,
    lastTurnSeq: 0,
    turnsSinceScribe: 0,
    counts: { subjects: 0, facts: 0, relations: 0, threads: 0, rulings: 0 },
    loading: false,
    loadingMore: false,
    updating: false,
    error: '',
    tellInstruction: '',
    tellPreview: null,
    tellWorking: false,
    tellCommitting: false,
    tellError: '',
    museSuggestion: null,
    museExcludeIds: [],
    museLoading: false,
    museError: '',
  };

  #findingsData = {
    items: [],
    total: 0,
    nextCursor: null,
    loadingMore: false,
    resolvingId: null,
    replacements: new Map(),
    error: '',
    rulingsItems: [],
    rulingsTotal: 0,
    rulingsNextCursor: null,
    rulingsLoadingMore: false,
  };

  #settingsData = {
    serverSettings: null,
    modelCatalog: null,
    modelCatalogLoading: false,
    modelCatalogError: '',
    refreshFocusPending: false,
    modelFilter: '',
    warnings: [],
    prefilledDefaults: false,
    draft: {
      models: { director: '', composer: '', main: '', recurring: '', scribe: '' },
      publicOdds: '8',
      privateOdds: '30',
      scribeInterval: '1',
      pedantEnabled: true,
      dailyWarnUsd: '',
      openRouterApiKey: '',
    },
    saving: false,
    clearingKey: false,
    error: '',
    success: '',
  };

  /**
   * @param {{drawerElement: HTMLElement, backdropElement: HTMLElement, documentRef?: Document | null, callbacks: Record<string, Function>}} options
   * @throws {TypeError}
   */
  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('InspectorDrawer options must be a plain object.');
    }
    const { drawerElement, backdropElement, documentRef = null, callbacks } = options;
    if (drawerElement === null || typeof drawerElement !== 'object' || backdropElement === null || typeof backdropElement !== 'object') {
      throw new TypeError('drawerElement and backdropElement are required.');
    }
    if (callbacks === null || typeof callbacks !== 'object') {
      throw new TypeError('InspectorDrawer callbacks object is required.');
    }
    this.#drawerElement = drawerElement;
    this.#backdropElement = backdropElement;
    this.#documentRef = documentRef ?? (typeof document !== 'undefined' ? document : null);
    this.#callbacks = callbacks;

    this.#backdropElement.addEventListener('click', () => {
      this.setOpen(false);
    });
  }

  /**
   * @param {boolean} open
   * @returns {void}
   */
  setOpen(open) {
    this.#isOpen = Boolean(open);
    if (this.#isOpen) {
      this.#drawerElement.classList.add('is-open');
      this.#backdropElement.classList.remove('is-hidden');
      if (this.#escapeHandler === null && this.#documentRef !== null && typeof this.#documentRef.addEventListener === 'function') {
        this.#escapeHandler = (event) => {
          if (event.key === 'Escape' && this.#isOpen) {
            this.setOpen(false);
          }
        };
        this.#documentRef.addEventListener('keydown', this.#escapeHandler);
      }
    } else {
      this.#drawerElement.classList.remove('is-open');
      this.#backdropElement.classList.add('is-hidden');
      if (this.#escapeHandler !== null && this.#documentRef !== null && typeof this.#documentRef.removeEventListener === 'function') {
        this.#documentRef.removeEventListener('keydown', this.#escapeHandler);
        this.#escapeHandler = null;
      }
    }
    if (typeof this.#callbacks.onOpenChange === 'function') {
      this.#callbacks.onOpenChange(this.#isOpen);
    }
  }

  /**
   * @returns {boolean}
   */
  isOpen() {
    return this.#isOpen;
  }

  /**
   * @param {string} tabId
   * @returns {void}
   */
  setTab(tabId) {
    if (!InspectorDrawer.#Tabs.some((tab) => tab.id === tabId)) {
      return;
    }
    this.#activeTab = tabId;
    this.render();
    if (typeof this.#callbacks.onTabChange === 'function') {
      void this.#callbacks.onTabChange(tabId);
    }
  }

  /**
   * @param {object | null} campaign
   * @param {{resetDraft?: boolean}} [options]
   * @returns {void}
   */
  setCampaign(campaign, { resetDraft = true } = {}) {
    const previousId = this.#campaign?.id ?? null;
    this.#campaign = campaign;
    const nextId = campaign?.id ?? null;
    if (resetDraft || previousId !== nextId) {
      const scene = campaign?.sceneState ?? null;
      this.#sceneDraft = {
        location: typeof scene?.location === 'string' ? scene.location : '',
        day: Number.isInteger(scene?.day) ? String(scene.day) : '1',
        timeLabel: typeof scene?.timeLabel === 'string' ? scene.timeLabel : '',
        sceneType: scene?.sceneType === 'private' ? 'private' : 'public',
      };
      this.#sceneError = '';
    }
    if (previousId !== nextId) {
      this.#walkOnDraft = '';
      this.#memoryData.tellInstruction = '';
      this.#memoryData.tellPreview = null;
      this.#memoryData.tellError = '';
      this.#memoryData.museSuggestion = null;
      this.#memoryData.museExcludeIds = [];
      this.#memoryData.museError = '';
      this.#memoryData.query = '';
      this.#memoryData.queryDraft = '';
      this.#findingsData.replacements = new Map();
      this.#findingsData.error = '';
    }
    this.render();
  }

  /**
   * @param {{items: Array<object>, total: number, nextCursor: string | null}} page
   * @param {{append?: boolean, includeArchived?: boolean}} [options]
   * @returns {void}
   */
  setCastPage(page, { append = false, includeArchived = this.#castData.includeArchived } = {}) {
    this.#castData.includeArchived = Boolean(includeArchived);
    this.#castData.items = append ? [...this.#castData.items, ...(page.items ?? [])] : [...(page.items ?? [])];
    this.#castData.total = Number.isInteger(page.total) ? page.total : this.#castData.items.length;
    this.#castData.nextCursor = page.nextCursor ?? null;
    this.#castData.loadingMore = false;
    this.#castData.error = '';
    this.#castData.editFailure = null;
    this.render();
  }

  /**
   * @param {object} memoryPage
   * @param {{append?: boolean}} [options]
   * @returns {void}
   */
  setMemoryPage(memoryPage, { append = false } = {}) {
    this.#memoryData.section = memoryPage.section ?? this.#memoryData.section;
    this.#memoryData.items = append ? [...this.#memoryData.items, ...(memoryPage.items ?? [])] : [...(memoryPage.items ?? [])];
    this.#memoryData.total = Number.isInteger(memoryPage.total) ? memoryPage.total : this.#memoryData.items.length;
    this.#memoryData.nextCursor = memoryPage.nextCursor ?? null;
    this.#memoryData.dirty = Boolean(memoryPage.dirty);
    this.#memoryData.lastTurnSeq = Number.isInteger(memoryPage.lastTurnSeq) ? memoryPage.lastTurnSeq : 0;
    this.#memoryData.turnsSinceScribe = Number.isInteger(memoryPage.turnsSinceScribe) ? memoryPage.turnsSinceScribe : 0;
    if (memoryPage.counts !== null && typeof memoryPage.counts === 'object') {
      this.#memoryData.counts = { ...memoryPage.counts };
    }
    this.#memoryData.loading = false;
    this.#memoryData.loadingMore = false;
    this.#memoryData.error = '';
    this.render();
  }

  /**
   * @param {{items: Array<object>, total: number, nextCursor: string | null}} page
   * @param {{append?: boolean}} [options]
   * @returns {void}
   */
  setFindingsPage(page, { append = false } = {}) {
    this.#findingsData.items = append ? [...this.#findingsData.items, ...(page.items ?? [])] : [...(page.items ?? [])];
    this.#findingsData.total = Number.isInteger(page.total) ? page.total : this.#findingsData.items.length;
    this.#findingsData.nextCursor = page.nextCursor ?? null;
    this.#findingsData.loadingMore = false;
    this.#findingsData.error = '';
    this.render();
  }

  /**
   * @param {{items: Array<object>, total: number, nextCursor: string | null}} page
   * @param {{append?: boolean}} [options]
   * @returns {void}
   */
  setRulingsPage(page, { append = false } = {}) {
    this.#findingsData.rulingsItems = append
      ? [...this.#findingsData.rulingsItems, ...(page.items ?? [])]
      : [...(page.items ?? [])];
    this.#findingsData.rulingsTotal = Number.isInteger(page.total)
      ? page.total
      : this.#findingsData.rulingsItems.length;
    this.#findingsData.rulingsNextCursor = page.nextCursor ?? null;
    this.#findingsData.rulingsLoadingMore = false;
    this.render();
  }

  /**
   * @param {object} settings
   * @returns {void}
   */
  setSettings(settings) {
    this.#settingsData.serverSettings = settings;
    this.#settingsData.draft = {
      models: {
        director: settings.models.director,
        composer: settings.models.composer,
        main: settings.models.main,
        recurring: settings.models.recurring,
        scribe: settings.models.scribe,
      },
      publicOdds: String(settings.publicOdds),
      privateOdds: String(settings.privateOdds),
      scribeInterval: String(settings.scribeInterval),
      pedantEnabled: settings.pedantEnabled,
      dailyWarnUsd: settings.dailyWarnUsd === null ? '' : String(settings.dailyWarnUsd),
      openRouterApiKey: '',
    };
    this.#settingsData.error = '';
    this.#applyBlankModelDefaults();
    this.render();
  }

  /**
   * @param {object | null} modelCatalog
   * @returns {void}
   */
  setModelCatalog(modelCatalog) {
    this.#settingsData.modelCatalog = modelCatalog;
    this.#settingsData.modelCatalogLoading = false;
    this.#settingsData.modelCatalogError = '';
    this.#applyBlankModelDefaults();
    this.#renderCatalogUpdate();
  }

  /**
   * @param {boolean} isLoading
   * @returns {void}
   */
  setModelCatalogLoading(isLoading) {
    this.#settingsData.modelCatalogLoading = Boolean(isLoading);
    if (this.#settingsData.modelCatalogLoading) {
      this.#settingsData.modelCatalogError = '';
    }
    this.#renderCatalogUpdate();
  }

  /**
   * @param {unknown} errorMessage
   * @returns {void}
   */
  setModelCatalogError(errorMessage) {
    this.#settingsData.modelCatalogLoading = false;
    this.#settingsData.modelCatalogError = typeof errorMessage === 'string' ? errorMessage : String(errorMessage ?? '');
    this.#renderCatalogUpdate();
  }

  /**
   * @param {Array<string>} warnings
   * @returns {void}
   * @throws {TypeError}
   */
  setSettingsWarnings(warnings) {
    this.#settingsData.warnings = [...warnings];
    this.render();
  }

  /**
   * @returns {void}
   */
  render() {
    if (this.#documentRef === null) {
      return;
    }

    this.#firstWarningElement = null;
    const header = this.#documentRef.createElement('div');
    header.className = 'drawer-header';

    const title = this.#documentRef.createElement('h2');
    title.className = 'drawer-title';
    title.textContent = 'Inspector';

    const closeButton = this.#buildButton('Close', {
      id: InspectorDrawer.#CloseButtonId,
      variant: 'ghost',
      compact: true,
      onClick: () => {
        this.setOpen(false);
      },
    });
    closeButton.classList.add('drawer-close-btn');
    header.append(title, closeButton);

    const tabBar = this.#documentRef.createElement('div');
    tabBar.className = 'drawer-tabs';
    tabBar.setAttribute('role', 'tablist');

    for (const tab of InspectorDrawer.#Tabs) {
      const isSelected = this.#activeTab === tab.id;
      const tabButton = this.#documentRef.createElement('button');
      tabButton.id = `${InspectorDrawer.#TabButtonIdPrefix}${tab.id}`;
      tabButton.type = 'button';
      tabButton.className = isSelected ? 'tab-btn is-active' : 'tab-btn';
      tabButton.setAttribute('role', 'tab');
      tabButton.setAttribute('aria-selected', isSelected ? 'true' : 'false');

      const tabLabel = this.#documentRef.createElement('span');
      tabLabel.textContent = tab.label;
      tabButton.append(tabLabel);

      if (tab.id === 'findings' && this.#findingsData.total > 0) {
        tabButton.append(this.#buildBadge(String(this.#findingsData.total), 'is-warning'));
      }
      if (tab.id === 'memory' && this.#memoryData.dirty) {
        tabButton.append(this.#buildBadge('Out of date', 'is-dirty'));
      }

      tabButton.addEventListener('click', () => {
        this.setTab(tab.id);
      });
      tabBar.append(tabButton);
    }

    const body = this.#documentRef.createElement('div');
    body.className = 'drawer-body';

    switch (this.#activeTab) {
      case 'scene': {
        if (this.#campaign === null) {
          body.append(this.#buildAlert('Select or create a campaign to manage Scene and Presence.', 'info'));
          break;
        }
        const sceneState = this.#campaign.sceneState ?? {
          sceneNumber: 1,
          day: 1,
          timeLabel: 'Morning',
          location: '',
          sceneType: 'public',
          presentIds: [],
          remoteIds: [],
          offscreenNotes: {},
          activeWalkOns: [],
        };

        const sceneSection = this.#documentRef.createElement('form');
        sceneSection.className = 'inspector-section';

        if (this.#sceneError.length > 0) {
          body.append(this.#buildAlert(this.#sceneError, 'danger'));
        }

        const sceneHead = this.#documentRef.createElement('div');
        sceneHead.className = 'section-header';
        const sceneTitle = this.#documentRef.createElement('h3');
        sceneTitle.className = 'section-title';
        sceneTitle.textContent = `Scene #${sceneState.sceneNumber}`;
        sceneHead.append(sceneTitle);
        sceneSection.append(sceneHead);

        const locationInput = this.#documentRef.createElement('input');
        locationInput.id = 'scene-location-input';
        locationInput.type = 'text';
        locationInput.className = 'field-control';
        locationInput.value = this.#sceneDraft.location;
        locationInput.disabled = this.#sceneSaving;
        locationInput.placeholder = 'Current location';
        locationInput.addEventListener('input', () => {
          this.#sceneDraft.location = locationInput.value;
        });
        sceneSection.append(this.#buildField('Location', locationInput));

        const timeRow = this.#documentRef.createElement('div');
        timeRow.className = 'form-grid-two';

        const dayInput = this.#documentRef.createElement('input');
        dayInput.id = 'scene-day-input';
        dayInput.type = 'number';
        dayInput.min = '1';
        dayInput.step = '1';
        dayInput.className = 'field-control';
        dayInput.value = this.#sceneDraft.day;
        dayInput.disabled = this.#sceneSaving;
        dayInput.addEventListener('input', () => {
          this.#sceneDraft.day = dayInput.value;
        });
        timeRow.append(this.#buildField('Day', dayInput));

        const timeInput = this.#documentRef.createElement('input');
        timeInput.id = 'scene-time-input';
        timeInput.type = 'text';
        timeInput.className = 'field-control';
        timeInput.value = this.#sceneDraft.timeLabel;
        timeInput.disabled = this.#sceneSaving;
        timeInput.placeholder = 'Morning / Evening';
        timeInput.addEventListener('input', () => {
          this.#sceneDraft.timeLabel = timeInput.value;
        });
        timeRow.append(this.#buildField('Time label', timeInput));
        sceneSection.append(timeRow);

        const typeGroup = this.#documentRef.createElement('div');
        typeGroup.className = 'field-group';
        const typeLabel = this.#documentRef.createElement('span');
        typeLabel.className = 'field-label';
        typeLabel.textContent = 'Visibility';
        const typePills = this.#documentRef.createElement('div');
        typePills.className = 'pill-group';

        for (const modeOption of [
          { value: 'public', label: 'Public' },
          { value: 'private', label: 'Private' },
        ]) {
          const isSelected = this.#sceneDraft.sceneType === modeOption.value;
          const modeBtn = this.#documentRef.createElement('button');
          modeBtn.type = 'button';
          modeBtn.className = isSelected ? 'pill-btn is-active' : 'pill-btn';
          modeBtn.disabled = this.#sceneSaving;
          modeBtn.textContent = modeOption.label;
          modeBtn.addEventListener('click', () => {
            this.#sceneDraft.sceneType = modeOption.value;
            this.render();
          });
          typePills.append(modeBtn);
        }
        typeGroup.append(typeLabel, typePills);
        sceneSection.append(typeGroup);

        const saveSceneRow = this.#documentRef.createElement('div');
        saveSceneRow.className = 'action-row-end';
        saveSceneRow.append(
          this.#buildButton('Save Scene', {
            variant: 'primary',
            type: 'submit',
            busy: this.#sceneSaving,
            busyLabel: 'Saving...',
          }),
        );
        sceneSection.append(saveSceneRow);

        sceneSection.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (this.#sceneSaving) {
            return;
          }
          const dayNumber = Number.parseInt(this.#sceneDraft.day, 10);
          if (!/^\d+$/.test(this.#sceneDraft.day.trim()) || !Number.isSafeInteger(dayNumber) || dayNumber < 1) {
            this.#sceneError = 'Day must be an integer >= 1.';
            this.render();
            return;
          }
          this.#sceneSaving = true;
          this.#sceneError = '';
          this.render();
          try {
            await this.#callbacks.onSaveScene({
              location: this.#sceneDraft.location,
              day: dayNumber,
              timeLabel: this.#sceneDraft.timeLabel,
              sceneType: this.#sceneDraft.sceneType,
            });
          } catch (saveError) {
            this.#sceneError = saveError instanceof Error ? saveError.message : String(saveError);
          } finally {
            this.#sceneSaving = false;
            this.render();
          }
        });
        body.append(sceneSection);

        const presenceSection = this.#documentRef.createElement('section');
        presenceSection.className = 'inspector-section';
        const presenceHead = this.#documentRef.createElement('div');
        presenceHead.className = 'section-header';
        const presenceTitle = this.#documentRef.createElement('h3');
        presenceTitle.className = 'section-title';
        presenceTitle.textContent = `Cast Presence (${this.#castData.total})`;
        presenceHead.append(presenceTitle);
        presenceSection.append(presenceHead);

        const presentSet = new Set(Array.isArray(sceneState.presentIds) ? sceneState.presentIds : []);
        const remoteSet = new Set(Array.isArray(sceneState.remoteIds) ? sceneState.remoteIds : []);
        const offscreenNotes = sceneState.offscreenNotes !== null && typeof sceneState.offscreenNotes === 'object'
          ? sceneState.offscreenNotes
          : {};
        const shownNoteKeys = new Set();

        const activeCast = this.#castData.items.filter((character) => !character.archived);
        if (activeCast.length === 0) {
          presenceSection.append(this.#buildAlert('No active characters yet. Add characters in the Cast tab.', 'info'));
        } else {
          const castList = this.#documentRef.createElement('div');
          castList.className = 'card-list';
          for (const character of activeCast) {
            const card = this.#documentRef.createElement('div');
            card.className = 'item-card';

            const topRow = this.#documentRef.createElement('div');
            topRow.className = 'item-card-row';

            const identity = this.#documentRef.createElement('div');
            identity.className = 'turn-meta';
            const avatar = this.#documentRef.createElement('span');
            avatar.className = `avatar-badge avatar-${character.avatarToken || 'slate'}`;
            avatar.setAttribute('aria-hidden', 'true');
            avatar.textContent = character.avatarInitials || character.name.slice(0, 2).toUpperCase();
            const nameSpan = this.#documentRef.createElement('span');
            nameSpan.className = 'item-title';
            nameSpan.textContent = character.name;
            identity.append(avatar, nameSpan);
            if (character.isPlayer) {
              identity.append(this.#buildBadge('Player'));
            }
            topRow.append(identity);

            const currentMode = presentSet.has(character.id)
              ? 'present'
              : remoteSet.has(character.id)
                ? 'remote'
                : 'absent';
            const isCharBusy = this.#presenceBusyId === character.id;

            const pills = this.#documentRef.createElement('div');
            pills.className = 'pill-group';
            for (const modeOpt of [
              { value: 'present', label: 'Present' },
              { value: 'remote', label: 'Remote' },
              { value: 'absent', label: 'Absent' },
            ]) {
              const pill = this.#documentRef.createElement('button');
              pill.type = 'button';
              const activeClass = currentMode === modeOpt.value ? ' is-active' : '';
              const loadingClass = isCharBusy ? ' is-loading' : '';
              pill.className = `pill-btn${activeClass}${loadingClass}`;
              pill.disabled = isCharBusy;
              pill.textContent = modeOpt.label;
              pill.addEventListener('click', async () => {
                if (this.#presenceBusyId !== null || currentMode === modeOpt.value) {
                  return;
                }
                this.#presenceBusyId = character.id;
                this.#sceneError = '';
                this.render();
                try {
                  await this.#callbacks.onSetPresence(character.id, modeOpt.value);
                } catch (presenceError) {
                  this.#sceneError = presenceError instanceof Error ? presenceError.message : String(presenceError);
                } finally {
                  this.#presenceBusyId = null;
                  this.render();
                }
              });
              pills.append(pill);
            }
            card.append(topRow, pills);

            let noteText = '';
            if (typeof offscreenNotes[character.id] === 'string' && offscreenNotes[character.id].trim().length > 0) {
              noteText = offscreenNotes[character.id].trim();
              shownNoteKeys.add(character.id);
            } else if (typeof offscreenNotes[character.slug] === 'string' && offscreenNotes[character.slug].trim().length > 0) {
              noteText = offscreenNotes[character.slug].trim();
              shownNoteKeys.add(character.slug);
            }
            if (noteText.length > 0) {
              const noteEl = this.#documentRef.createElement('div');
              noteEl.className = 'item-meta';
              noteEl.textContent = `Off-screen: ${noteText}`;
              card.append(noteEl);
            }

            castList.append(card);
          }
          presenceSection.append(castList);
        }

        const extraNotes = Object.entries(offscreenNotes).filter(([noteKey, noteValue]) => {
          return !shownNoteKeys.has(noteKey) && typeof noteValue === 'string' && noteValue.trim().length > 0;
        });
        if (extraNotes.length > 0) {
          const notesMeta = this.#documentRef.createElement('div');
          notesMeta.className = 'item-meta';
          notesMeta.textContent = `Other off-screen notes: ${extraNotes.map(([noteKey, noteVal]) => `${noteKey}: ${noteVal}`).join(' | ')}`;
          presenceSection.append(notesMeta);
        }

        if (this.#castData.nextCursor !== null || activeCast.length > 0) {
          presenceSection.append(
            this.#buildPager({
              shownCount: this.#castData.items.length,
              totalCount: this.#castData.total,
              nextCursor: this.#castData.nextCursor,
              loading: this.#castData.loadingMore,
              onLoadMore: async () => {
                this.#castData.loadingMore = true;
                this.render();
                try {
                  await this.#callbacks.onLoadMoreCast(this.#castData.nextCursor, this.#castData.includeArchived);
                } catch (loadError) {
                  this.#castData.loadingMore = false;
                  this.#sceneError = loadError instanceof Error ? loadError.message : String(loadError);
                  this.render();
                }
              },
            }),
          );
        }
        body.append(presenceSection);

        const walkOnSection = this.#documentRef.createElement('section');
        walkOnSection.className = 'inspector-section';
        const walkOnTitle = this.#documentRef.createElement('h3');
        walkOnTitle.className = 'section-title';
        const activeWalkOns = Array.isArray(sceneState.activeWalkOns) ? sceneState.activeWalkOns : [];
        walkOnTitle.textContent = `Active Walk-ons (${activeWalkOns.length})`;
        walkOnSection.append(walkOnTitle);

        if (activeWalkOns.length > 0) {
          const walkOnList = this.#documentRef.createElement('div');
          walkOnList.className = 'card-list';
          for (const walkOnName of activeWalkOns) {
            const row = this.#documentRef.createElement('div');
            row.className = 'item-card-row';
            const label = this.#documentRef.createElement('span');
            label.className = 'item-title';
            label.textContent = walkOnName;
            const removeBtn = this.#buildButton('Remove', {
              variant: 'ghost',
              compact: true,
              busy: this.#walkOnBusy,
              busyLabel: 'Removing...',
              onClick: async () => {
                if (this.#walkOnBusy) {
                  return;
                }
                this.#walkOnBusy = true;
                this.#sceneError = '';
                this.render();
                try {
                  await this.#callbacks.onRemoveWalkOn(walkOnName);
                } catch (walkOnError) {
                  this.#sceneError = walkOnError instanceof Error ? walkOnError.message : String(walkOnError);
                } finally {
                  this.#walkOnBusy = false;
                  this.render();
                }
              },
            });
            row.append(label, removeBtn);
            walkOnList.append(row);
          }
          walkOnSection.append(walkOnList);
        }

        const addWalkOnForm = this.#documentRef.createElement('form');
        addWalkOnForm.className = 'action-row-split';
        const walkOnInput = this.#documentRef.createElement('input');
        walkOnInput.type = 'text';
        walkOnInput.className = 'field-control';
        walkOnInput.placeholder = 'Add walk-on NPC (e.g. Innkeeper)';
        walkOnInput.value = this.#walkOnDraft;
        walkOnInput.disabled = this.#walkOnBusy;
        walkOnInput.addEventListener('input', () => {
          this.#walkOnDraft = walkOnInput.value;
        });
        const addWalkOnBtn = this.#buildButton('Add Walk-on', {
          variant: 'secondary',
          type: 'submit',
          busy: this.#walkOnBusy,
          busyLabel: 'Adding...',
        });
        addWalkOnForm.append(walkOnInput, addWalkOnBtn);
        addWalkOnForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          const trimmedWalkOn = this.#walkOnDraft.trim();
          if (this.#walkOnBusy || trimmedWalkOn.length === 0) {
            return;
          }
          this.#walkOnBusy = true;
          this.#sceneError = '';
          this.render();
          try {
            await this.#callbacks.onAddWalkOn(trimmedWalkOn);
            this.#walkOnDraft = '';
          } catch (walkOnError) {
            this.#sceneError = walkOnError instanceof Error ? walkOnError.message : String(walkOnError);
          } finally {
            this.#walkOnBusy = false;
            this.render();
          }
        });
        walkOnSection.append(addWalkOnForm);
        body.append(walkOnSection);
        break;
      }

      case 'cast': {
        if (this.#campaign === null) {
          body.append(this.#buildAlert('Select or create a campaign to manage characters.', 'info'));
          break;
        }
        const castSection = this.#documentRef.createElement('section');
        castSection.className = 'inspector-section';

        const castHeader = this.#documentRef.createElement('div');
        castHeader.className = 'section-header';
        const castTitle = this.#documentRef.createElement('h3');
        castTitle.className = 'section-title';
        castTitle.textContent = `Cast (${this.#castData.total})`;
        const addCharBtn = this.#buildButton('Add Character', {
          variant: 'primary',
          compact: true,
          onClick: () => {
            this.#callbacks.onAddCharacter();
          },
        });
        castHeader.append(castTitle, addCharBtn);
        castSection.append(castHeader);

        const archiveRow = this.#documentRef.createElement('label');
        archiveRow.className = 'checkbox-row';
        const archiveCheck = this.#documentRef.createElement('input');
        archiveCheck.type = 'checkbox';
        archiveCheck.checked = this.#castData.includeArchived;
        archiveCheck.addEventListener('change', async () => {
          this.#castData.includeArchived = archiveCheck.checked;
          this.#castData.loadingMore = true;
          this.render();
          try {
            await this.#callbacks.onReloadCast(archiveCheck.checked);
          } catch (loadError) {
            this.#castData.loadingMore = false;
            this.#castData.error = loadError instanceof Error ? loadError.message : String(loadError);
            this.render();
          }
        });
        const archiveLabel = this.#documentRef.createElement('span');
        archiveLabel.textContent = 'Include archived';
        archiveRow.append(archiveCheck, archiveLabel);
        castSection.append(archiveRow);

        if (this.#castData.error.length > 0) {
          castSection.append(this.#buildAlert(this.#castData.error, 'danger'));
        }

        if (this.#castData.items.length === 0) {
          castSection.append(this.#buildAlert('No characters found.', 'info'));
        } else {
          const list = this.#documentRef.createElement('div');
          list.className = 'card-list';
          for (const character of this.#castData.items) {
            const card = this.#documentRef.createElement('div');
            card.className = 'item-card';

            const row = this.#documentRef.createElement('div');
            row.className = 'item-card-row';

            const identity = this.#documentRef.createElement('div');
            identity.className = 'turn-meta';
            const avatar = this.#documentRef.createElement('span');
            avatar.className = `avatar-badge avatar-${character.avatarToken || 'slate'}`;
            avatar.setAttribute('aria-hidden', 'true');
            avatar.textContent = character.avatarInitials || character.name.slice(0, 2).toUpperCase();

            const nameEl = this.#documentRef.createElement('span');
            nameEl.className = 'item-title';
            nameEl.textContent = character.name;

            identity.append(avatar, nameEl);
            identity.append(this.#buildBadge(`@${character.slug}`));
            identity.append(this.#buildBadge(character.tier === 'recurring' ? 'Recurring' : 'Main'));
            if (character.isPlayer) {
              identity.append(this.#buildBadge('Player', 'is-warning'));
            }
            if (character.archived) {
              identity.append(this.#buildBadge('Archived', 'is-danger'));
            }
            row.append(identity);
            card.append(row);

            if (typeof character.modelOverride === 'string' && character.modelOverride.trim().length > 0) {
              const modelMeta = this.#documentRef.createElement('div');
              modelMeta.className = 'item-meta';
              modelMeta.textContent = `Model override: ${character.modelOverride}`;
              card.append(modelMeta);
            }
            if (character.card.personalitySummary.trim().length > 0) {
              const personaEl = this.#documentRef.createElement('p');
              personaEl.className = 'item-copy';
              personaEl.textContent = character.card.personalitySummary.length > 180
                ? `${character.card.personalitySummary.slice(0, 177)}...`
                : character.card.personalitySummary;
              card.append(personaEl);
            }

            const isCharBusy = this.#castData.busyCharId === character.id;
            const actions = this.#documentRef.createElement('div');
            actions.className = 'action-row-end';

            const editBtn = this.#buildButton('Edit', {
              id: `${InspectorDrawer.#EditButtonIdPrefix}${character.id}`,
              variant: 'secondary',
              compact: true,
              busy: this.#castData.openingCharId === character.id,
              busyLabel: 'Opening...',
              disabled: isCharBusy || this.#castData.openingCharId !== null,
              onClick: async () => {
                if (this.#castData.busyCharId !== null || this.#castData.openingCharId !== null) {
                  return;
                }
                this.#castData.openingCharId = character.id;
                this.#castData.error = '';
                this.#castData.editFailure = null;
                this.render();
                let failed = false;
                try {
                  await this.#callbacks.onEditCharacter(character);
                } catch (openError) {
                  failed = true;
                  this.#castData.editFailure = {
                    characterId: character.id,
                    message: openError instanceof Error ? openError.message : String(openError),
                  };
                } finally {
                  this.#castData.openingCharId = null;
                  this.render();
                }
                if (failed) {
                  this.#drawerElement.querySelector(`#${InspectorDrawer.#EditButtonIdPrefix}${character.id}`)?.focus();
                }
              },
            });

            const archiveBtn = this.#buildButton(character.archived ? 'Restore' : 'Archive', {
              variant: 'secondary',
              compact: true,
              busy: isCharBusy,
              busyLabel: 'Updating...',
              onClick: async () => {
                if (this.#castData.busyCharId !== null || this.#castData.openingCharId !== null) {
                  return;
                }
                this.#castData.busyCharId = character.id;
                this.#castData.error = '';
                this.render();
                try {
                  await this.#callbacks.onToggleArchiveCharacter(character);
                } catch (archiveError) {
                  this.#castData.error = archiveError instanceof Error ? archiveError.message : String(archiveError);
                } finally {
                  this.#castData.busyCharId = null;
                  this.render();
                }
              },
            });

            const deleteBtn = this.#buildButton('Delete', {
              variant: 'danger',
              compact: true,
              disabled: isCharBusy,
              onClick: () => {
                this.#callbacks.onDeleteCharacter(character);
              },
            });

            actions.append(editBtn, archiveBtn, deleteBtn);
            card.append(actions);
            if (this.#castData.editFailure !== null && this.#castData.editFailure.characterId === character.id) {
              card.append(this.#buildAlert(this.#castData.editFailure.message, 'danger'));
            }
            list.append(card);
          }
          castSection.append(list);
        }

        castSection.append(
          this.#buildPager({
            shownCount: this.#castData.items.length,
            totalCount: this.#castData.total,
            nextCursor: this.#castData.nextCursor,
            loading: this.#castData.loadingMore,
            onLoadMore: async () => {
              this.#castData.loadingMore = true;
              this.render();
              try {
                await this.#callbacks.onLoadMoreCast(this.#castData.nextCursor, this.#castData.includeArchived);
              } catch (loadError) {
                this.#castData.loadingMore = false;
                this.#castData.error = loadError instanceof Error ? loadError.message : String(loadError);
                this.render();
              }
            },
          }),
        );
        body.append(castSection);
        break;
      }

      case 'memory': {
        if (this.#campaign === null) {
          body.append(this.#buildAlert('Select or create a campaign to inspect Scribe memory.', 'info'));
          break;
        }

        const bookSection = this.#documentRef.createElement('section');
        bookSection.className = 'inspector-section';

        const bookHeader = this.#documentRef.createElement('div');
        bookHeader.className = 'section-header';

        const bookTitleGroup = this.#documentRef.createElement('div');
        bookTitleGroup.className = 'turn-meta';
        const bookTitle = this.#documentRef.createElement('h3');
        bookTitle.className = 'section-title';
        bookTitle.textContent = 'Memory (Book)';
        bookTitleGroup.append(bookTitle);
        if (this.#memoryData.dirty) {
          bookTitleGroup.append(this.#buildBadge('Memory out of date', 'is-dirty'));
        }

        const updateMemBtn = this.#buildButton('Update Memory', {
          variant: 'primary',
          compact: true,
          busy: this.#memoryData.updating,
          busyLabel: 'Updating...',
          onClick: async () => {
            if (this.#memoryData.updating) {
              return;
            }
            this.#memoryData.updating = true;
            this.#memoryData.error = '';
            this.render();
            try {
              await this.#callbacks.onUpdateMemory();
            } catch (memError) {
              this.#memoryData.error = memError instanceof Error ? memError.message : String(memError);
            } finally {
              this.#memoryData.updating = false;
              this.render();
            }
          },
        });
        bookHeader.append(bookTitleGroup, updateMemBtn);
        bookSection.append(bookHeader);

        const statsLine = this.#documentRef.createElement('div');
        statsLine.className = 'item-meta';
        statsLine.textContent = `Turns since Scribe: ${this.#memoryData.turnsSinceScribe} · Last read seq: #${this.#memoryData.lastTurnSeq}`;
        bookSection.append(statsLine);

        const sectionPills = this.#documentRef.createElement('div');
        sectionPills.className = 'pill-group';
        for (const sectionEntry of InspectorDrawer.#MemorySections) {
          const isCurrent = this.#memoryData.section === sectionEntry.id;
          const count = this.#memoryData.counts[sectionEntry.id] ?? 0;
          const btn = this.#documentRef.createElement('button');
          btn.type = 'button';
          btn.className = isCurrent ? 'pill-btn is-active' : 'pill-btn';
          btn.disabled = this.#memoryData.loading;
          btn.textContent = `${sectionEntry.label} (${count})`;
          btn.addEventListener('click', async () => {
            if (this.#memoryData.loading) {
              return;
            }
            this.#memoryData.section = sectionEntry.id;
            this.#memoryData.loading = true;
            this.render();
            try {
              await this.#callbacks.onLoadMemory({
                section: sectionEntry.id,
                query: this.#memoryData.query,
              });
            } catch (memError) {
              this.#memoryData.loading = false;
              this.#memoryData.error = memError instanceof Error ? memError.message : String(memError);
              this.render();
            }
          });
          sectionPills.append(btn);
        }
        bookSection.append(sectionPills);

        const searchForm = this.#documentRef.createElement('form');
        searchForm.className = 'action-row-split';
        const searchInput = this.#documentRef.createElement('input');
        searchInput.type = 'search';
        searchInput.className = 'field-control';
        searchInput.placeholder = 'Filter memory entries...';
        searchInput.value = this.#memoryData.queryDraft;
        searchInput.addEventListener('input', () => {
          this.#memoryData.queryDraft = searchInput.value;
        });
        const searchBtn = this.#buildButton('Search', {
          variant: 'secondary',
          compact: true,
          type: 'submit',
          busy: this.#memoryData.loading,
          busyLabel: 'Loading...',
        });
        searchForm.append(searchInput, searchBtn);
        if (this.#memoryData.query.length > 0) {
          searchForm.append(
            this.#buildButton('Clear', {
              variant: 'ghost',
              compact: true,
              disabled: this.#memoryData.loading,
              onClick: async () => {
                this.#memoryData.query = '';
                this.#memoryData.queryDraft = '';
                this.#memoryData.loading = true;
                this.render();
                try {
                  await this.#callbacks.onLoadMemory({ section: this.#memoryData.section, query: '' });
                } catch (clearError) {
                  this.#memoryData.loading = false;
                  this.#memoryData.error = clearError instanceof Error ? clearError.message : String(clearError);
                  this.render();
                }
              },
            }),
          );
        }
        searchForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (this.#memoryData.loading) {
            return;
          }
          this.#memoryData.query = this.#memoryData.queryDraft.trim();
          this.#memoryData.loading = true;
          this.render();
          try {
            await this.#callbacks.onLoadMemory({
              section: this.#memoryData.section,
              query: this.#memoryData.query,
            });
          } catch (searchError) {
            this.#memoryData.loading = false;
            this.#memoryData.error = searchError instanceof Error ? searchError.message : String(searchError);
            this.render();
          }
        });
        bookSection.append(searchForm);

        if (this.#memoryData.error.length > 0) {
          bookSection.append(this.#buildAlert(this.#memoryData.error, 'danger'));
        }

        if (this.#memoryData.items.length === 0) {
          bookSection.append(this.#buildAlert('No matching entries in this section.', 'info'));
        } else {
          const itemList = this.#documentRef.createElement('div');
          itemList.className = 'card-list';
          for (const item of this.#memoryData.items) {
            const card = this.#documentRef.createElement('div');
            card.className = 'item-card';
            if (this.#memoryData.section === 'subjects') {
              const titleEl = this.#documentRef.createElement('div');
              titleEl.className = 'item-title';
              titleEl.textContent = `${item.label} (${item.kind})`;
              card.append(titleEl);
              if (item.name && item.name !== item.label) {
                const nameMeta = this.#documentRef.createElement('div');
                nameMeta.className = 'item-meta';
                nameMeta.textContent = `Full name: ${item.name}`;
                card.append(nameMeta);
              }
              if (Array.isArray(item.aka) && item.aka.length > 0) {
                const akaMeta = this.#documentRef.createElement('div');
                akaMeta.className = 'item-meta';
                akaMeta.textContent = `Aliases: ${item.aka.join(', ')}`;
                card.append(akaMeta);
              }
            } else if (this.#memoryData.section === 'threads') {
              const titleRow = this.#documentRef.createElement('div');
              titleRow.className = 'item-card-row';
              const titleEl = this.#documentRef.createElement('div');
              titleEl.className = 'item-title';
              titleEl.textContent = item.subjectLabel ? `${item.subjectLabel}: thread` : 'Story thread';
              const statusBadge = item.closed === null
                ? this.#buildBadge('Open', 'is-success')
                : this.#buildBadge(`Closed: ${item.closed.how ?? 'resolved'}`);
              titleRow.append(titleEl, statusBadge);
              const copyEl = this.#documentRef.createElement('p');
              copyEl.className = 'item-copy';
              copyEl.textContent = item.text;
              card.append(titleRow, copyEl);
            } else {
              const headerRow = this.#documentRef.createElement('div');
              headerRow.className = 'item-card-row';
              const titleEl = this.#documentRef.createElement('div');
              titleEl.className = 'item-title';
              const targetPart = item.targetLabel ? ` -> ${item.targetLabel}` : '';
              titleEl.textContent = `${item.subjectLabel} · ${item.category}${targetPart}`;
              headerRow.append(titleEl);
              if (item.hidden) {
                headerRow.append(this.#buildBadge('Hidden', 'is-warning'));
              }
              if (item.pinned) {
                headerRow.append(this.#buildBadge('Pinned'));
              }
              const copyEl = this.#documentRef.createElement('p');
              copyEl.className = 'item-copy';
              copyEl.textContent = item.text;
              card.append(headerRow, copyEl, this.#buildKnownByRow(item.knownByLabels));
            }
            itemList.append(card);
          }
          bookSection.append(itemList);
        }

        bookSection.append(
          this.#buildPager({
            shownCount: this.#memoryData.items.length,
            totalCount: this.#memoryData.total,
            nextCursor: this.#memoryData.nextCursor,
            loading: this.#memoryData.loadingMore,
            onLoadMore: async () => {
              this.#memoryData.loadingMore = true;
              this.render();
              try {
                await this.#callbacks.onLoadMemory({
                  section: this.#memoryData.section,
                  query: this.#memoryData.query,
                  after: this.#memoryData.nextCursor,
                  append: true,
                });
              } catch (loadError) {
                this.#memoryData.loadingMore = false;
                this.#memoryData.error = loadError instanceof Error ? loadError.message : String(loadError);
                this.render();
              }
            },
          }),
        );
        body.append(bookSection);

        const tellSection = this.#documentRef.createElement('section');
        tellSection.className = 'inspector-section';
        const tellTitle = this.#documentRef.createElement('h3');
        tellTitle.className = 'section-title';
        tellTitle.textContent = 'Tell Scribe';
        tellSection.append(tellTitle);

        const tellArea = this.#documentRef.createElement('textarea');
        tellArea.id = 'tell-scribe-input';
        tellArea.rows = 2;
        tellArea.className = 'field-control';
        tellArea.placeholder = 'State a canonical ruling or fact update directly to Scribe...';
        tellArea.value = this.#memoryData.tellInstruction;
        tellArea.disabled = this.#memoryData.tellWorking || this.#memoryData.tellCommitting;
        tellArea.addEventListener('input', () => {
          this.#memoryData.tellInstruction = tellArea.value;
        });
        tellSection.append(this.#buildField('Instruction', tellArea));

        const workRow = this.#documentRef.createElement('div');
        workRow.className = 'action-row-end';
        workRow.append(
          this.#buildButton('Work it out', {
            variant: 'secondary',
            busy: this.#memoryData.tellWorking,
            busyLabel: 'Working...',
            disabled: this.#memoryData.tellCommitting,
            onClick: async () => {
              if (this.#memoryData.tellWorking || this.#memoryData.tellInstruction.trim().length === 0) {
                this.#memoryData.tellError = 'Enter an instruction for Scribe first.';
                this.render();
                return;
              }
              this.#memoryData.tellWorking = true;
              this.#memoryData.tellError = '';
              this.render();
              try {
                this.#memoryData.tellPreview = await this.#callbacks.onTellPreview(this.#memoryData.tellInstruction);
              } catch (tellError) {
                this.#memoryData.tellError = tellError instanceof Error ? tellError.message : String(tellError);
              } finally {
                this.#memoryData.tellWorking = false;
                this.render();
              }
            },
          }),
        );
        tellSection.append(workRow);

        if (this.#memoryData.tellError.length > 0) {
          tellSection.append(this.#buildAlert(this.#memoryData.tellError, 'danger'));
        }

        if (this.#memoryData.tellPreview !== null) {
          const preview = this.#memoryData.tellPreview;
          const previewBox = this.#documentRef.createElement('div');
          previewBox.className = 'item-card';

          const previewTitle = this.#documentRef.createElement('div');
          previewTitle.className = 'item-title';
          previewTitle.textContent = 'Proposed book changes';
          previewBox.append(previewTitle);

          const changes = Array.isArray(preview.changes) ? preview.changes : [];
          for (const line of changes) {
            const lineEl = this.#documentRef.createElement('div');
            lineEl.className = 'item-copy';
            lineEl.textContent = line;
            previewBox.append(lineEl);
          }

          if (Array.isArray(preview.refused) && preview.refused.length > 0) {
            const refusedMsg = preview.refused
              .map((entry) => (typeof entry === 'string' ? entry : entry.reason ?? JSON.stringify(entry)))
              .join('; ');
            previewBox.append(this.#buildAlert(`Refused: ${refusedMsg}`, 'warning'));
          }

          const previewActions = this.#documentRef.createElement('div');
          previewActions.className = 'action-row-end';
          previewActions.append(
            this.#buildButton('Cancel', {
              variant: 'secondary',
              compact: true,
              disabled: this.#memoryData.tellCommitting,
              onClick: () => {
                this.#memoryData.tellPreview = null;
                this.#memoryData.tellError = '';
                this.render();
              },
            }),
            this.#buildButton('File it', {
              variant: 'primary',
              compact: true,
              busy: this.#memoryData.tellCommitting,
              busyLabel: 'Filing...',
              disabled: !Array.isArray(preview.operations) || preview.operations.length === 0,
              onClick: async () => {
                if (this.#memoryData.tellCommitting) {
                  return;
                }
                this.#memoryData.tellCommitting = true;
                this.#memoryData.tellError = '';
                this.render();
                try {
                  await this.#callbacks.onTellCommit(preview.operations);
                  this.#memoryData.tellPreview = null;
                  this.#memoryData.tellInstruction = '';
                } catch (commitError) {
                  this.#memoryData.tellError = commitError instanceof Error ? commitError.message : String(commitError);
                } finally {
                  this.#memoryData.tellCommitting = false;
                  this.render();
                }
              },
            }),
          );
          previewBox.append(previewActions);
          tellSection.append(previewBox);
        }
        body.append(tellSection);

        const museSection = this.#documentRef.createElement('section');
        museSection.className = 'inspector-section';
        const museHeader = this.#documentRef.createElement('div');
        museHeader.className = 'section-header';
        const museTitle = this.#documentRef.createElement('h3');
        museTitle.className = 'section-title';
        museTitle.textContent = 'Muse';
        const suggestBtn = this.#buildButton('Suggest development', {
          variant: 'secondary',
          compact: true,
          busy: this.#memoryData.museLoading,
          busyLabel: 'Thinking...',
          onClick: async () => {
            if (this.#memoryData.museLoading) {
              return;
            }
            this.#memoryData.museLoading = true;
            this.#memoryData.museError = '';
            this.render();
            try {
              const suggestion = await this.#callbacks.onMuseSuggest(this.#memoryData.museExcludeIds);
              this.#memoryData.museSuggestion = suggestion;
              if (suggestion === null) {
                this.#memoryData.museError = 'No open threads available for Muse.';
              }
            } catch (museError) {
              this.#memoryData.museError = museError instanceof Error ? museError.message : String(museError);
            } finally {
              this.#memoryData.museLoading = false;
              this.render();
            }
          },
        });
        museHeader.append(museTitle, suggestBtn);
        museSection.append(museHeader);

        if (this.#memoryData.museError.length > 0) {
          museSection.append(this.#buildAlert(this.#memoryData.museError, 'warning'));
        }

        if (this.#memoryData.museSuggestion !== null) {
          const suggestion = this.#memoryData.museSuggestion;
          const museCard = this.#documentRef.createElement('div');
          museCard.className = 'item-card';

          const threadMeta = this.#documentRef.createElement('div');
          threadMeta.className = 'item-meta';
          threadMeta.textContent = `Thread: ${suggestion.threadTitle}`;

          const textCopy = this.#documentRef.createElement('p');
          textCopy.className = 'item-copy';
          textCopy.textContent = suggestion.text;

          const museActions = this.#documentRef.createElement('div');
          museActions.className = 'action-row-end';
          museActions.append(
            this.#buildButton('Another', {
              variant: 'ghost',
              compact: true,
              disabled: this.#memoryData.museLoading,
              onClick: async () => {
                if (this.#memoryData.museLoading) {
                  return;
                }
                if (typeof suggestion.threadId === 'string' && !this.#memoryData.museExcludeIds.includes(suggestion.threadId)) {
                  this.#memoryData.museExcludeIds.push(suggestion.threadId);
                }
                this.#memoryData.museLoading = true;
                this.#memoryData.museError = '';
                this.render();
                try {
                  const nextSuggestion = await this.#callbacks.onMuseSuggest(this.#memoryData.museExcludeIds);
                  this.#memoryData.museSuggestion = nextSuggestion;
                  if (nextSuggestion === null) {
                    this.#memoryData.museError = 'No more open threads available.';
                  }
                } catch (museError) {
                  this.#memoryData.museError = museError instanceof Error ? museError.message : String(museError);
                } finally {
                  this.#memoryData.museLoading = false;
                  this.render();
                }
              },
            }),
            this.#buildButton('Use', {
              variant: 'primary',
              compact: true,
              onClick: () => {
                this.#callbacks.onUseMuse(suggestion.text);
              },
            }),
          );

          museCard.append(threadMeta, textCopy, museActions);
          museSection.append(museCard);
        }
        body.append(museSection);
        break;
      }

      case 'findings': {
        if (this.#campaign === null) {
          body.append(this.#buildAlert('Select or create a campaign to review findings and rulings.', 'info'));
          break;
        }

        const openSection = this.#documentRef.createElement('section');
        openSection.className = 'inspector-section';
        const openTitle = this.#documentRef.createElement('h3');
        openTitle.className = 'section-title';
        openTitle.textContent = `Open Findings (${this.#findingsData.total})`;
        openSection.append(openTitle);

        if (this.#findingsData.error.length > 0) {
          openSection.append(this.#buildAlert(this.#findingsData.error, 'danger'));
        }

        if (this.#findingsData.items.length === 0) {
          openSection.append(this.#buildAlert('No open Pedant findings.', 'info'));
        } else {
          const findingsList = this.#documentRef.createElement('div');
          findingsList.className = 'card-list';
          for (const finding of this.#findingsData.items) {
            const card = this.#documentRef.createElement('div');
            card.className = 'item-card';

            const headRow = this.#documentRef.createElement('div');
            headRow.className = 'item-card-row';
            const kindLabel = finding.kind === 'secret_leak'
              ? 'Secret Leak'
              : finding.kind === 'name_mismatch'
                ? 'Name Mismatch'
                : 'Contradiction';
            headRow.append(this.#buildBadge(kindLabel, 'is-warning'));
            if (finding.subjectName) {
              const subjectEl = this.#documentRef.createElement('span');
              subjectEl.className = 'item-meta';
              subjectEl.textContent = finding.subjectName;
              headRow.append(subjectEl);
            }
            card.append(headRow);

            const summaryEl = this.#documentRef.createElement('div');
            summaryEl.className = 'item-title';
            summaryEl.textContent = finding.summary;
            card.append(summaryEl);

            if (finding.bookText) {
              const bookEl = this.#documentRef.createElement('div');
              bookEl.className = 'item-meta';
              bookEl.textContent = `Book: ${finding.bookText}`;
              card.append(bookEl);
            }
            if (finding.quote) {
              const quoteEl = this.#documentRef.createElement('div');
              quoteEl.className = 'item-meta';
              quoteEl.textContent = `Quote: ${finding.quote}`;
              card.append(quoteEl);
            }

            const isResolving = this.#findingsData.resolvingId === finding.id;
            const replacementInput = this.#documentRef.createElement('input');
            replacementInput.type = 'text';
            replacementInput.className = 'field-control';
            replacementInput.placeholder = 'Optional replacement text for Rule it';
            replacementInput.value = this.#findingsData.replacements.get(finding.id) ?? '';
            replacementInput.disabled = isResolving;
            replacementInput.addEventListener('input', () => {
              this.#findingsData.replacements.set(finding.id, replacementInput.value);
            });
            card.append(replacementInput);

            const actionRow = this.#documentRef.createElement('div');
            actionRow.className = 'action-row-end';
            const canTell = Boolean(finding.factId && finding.speakerCharacterId);

            actionRow.append(
              this.#buildButton('Dismiss', {
                variant: 'ghost',
                compact: true,
                busy: isResolving,
                busyLabel: 'Working...',
                onClick: async () => {
                  if (this.#findingsData.resolvingId !== null) {
                    return;
                  }
                  this.#findingsData.resolvingId = finding.id;
                  this.#findingsData.error = '';
                  this.render();
                  try {
                    await this.#callbacks.onResolveFinding(finding.id, { action: 'dismissed' });
                  } catch (resolveError) {
                    this.#findingsData.error = resolveError instanceof Error ? resolveError.message : String(resolveError);
                  } finally {
                    this.#findingsData.resolvingId = null;
                    this.render();
                  }
                },
              }),
              this.#buildButton('They were told', {
                variant: 'secondary',
                compact: true,
                busy: isResolving,
                busyLabel: 'Working...',
                disabled: !canTell,
                onClick: async () => {
                  if (this.#findingsData.resolvingId !== null || !canTell) {
                    return;
                  }
                  this.#findingsData.resolvingId = finding.id;
                  this.#findingsData.error = '';
                  this.render();
                  try {
                    await this.#callbacks.onResolveFinding(finding.id, { action: 'told' });
                  } catch (resolveError) {
                    this.#findingsData.error = resolveError instanceof Error ? resolveError.message : String(resolveError);
                  } finally {
                    this.#findingsData.resolvingId = null;
                    this.render();
                  }
                },
              }),
              this.#buildButton('Rule it', {
                variant: 'primary',
                compact: true,
                busy: isResolving,
                busyLabel: 'Working...',
                onClick: async () => {
                  if (this.#findingsData.resolvingId !== null) {
                    return;
                  }
                  const replacement = (this.#findingsData.replacements.get(finding.id) ?? '').trim();
                  this.#findingsData.resolvingId = finding.id;
                  this.#findingsData.error = '';
                  this.render();
                  try {
                    await this.#callbacks.onResolveFinding(finding.id, {
                      action: 'ruled',
                      replacementText: replacement.length > 0 ? replacement : null,
                    });
                    this.#findingsData.replacements.delete(finding.id);
                  } catch (resolveError) {
                    this.#findingsData.error = resolveError instanceof Error ? resolveError.message : String(resolveError);
                  } finally {
                    this.#findingsData.resolvingId = null;
                    this.render();
                  }
                },
              }),
            );
            card.append(actionRow);
            findingsList.append(card);
          }
          openSection.append(findingsList);
        }

        openSection.append(
          this.#buildPager({
            shownCount: this.#findingsData.items.length,
            totalCount: this.#findingsData.total,
            nextCursor: this.#findingsData.nextCursor,
            loading: this.#findingsData.loadingMore,
            onLoadMore: async () => {
              this.#findingsData.loadingMore = true;
              this.render();
              try {
                await this.#callbacks.onLoadMoreFindings(this.#findingsData.nextCursor);
              } catch (loadError) {
                this.#findingsData.loadingMore = false;
                this.#findingsData.error = loadError instanceof Error ? loadError.message : String(loadError);
                this.render();
              }
            },
          }),
        );
        body.append(openSection);

        const rulingsSection = this.#documentRef.createElement('section');
        rulingsSection.className = 'inspector-section';
        const rulingsTitle = this.#documentRef.createElement('h3');
        rulingsTitle.className = 'section-title';
        rulingsTitle.textContent = `Active Rulings (${this.#findingsData.rulingsTotal})`;
        rulingsSection.append(rulingsTitle);

        if (this.#findingsData.rulingsItems.length === 0) {
          rulingsSection.append(this.#buildAlert('No active operator rulings yet.', 'info'));
        } else {
          const rulingsList = this.#documentRef.createElement('div');
          rulingsList.className = 'card-list';
          for (const ruling of this.#findingsData.rulingsItems) {
            const card = this.#documentRef.createElement('div');
            card.className = 'item-card';
            const titleEl = this.#documentRef.createElement('div');
            titleEl.className = 'item-title';
            const targetPart = ruling.targetLabel ? ` -> ${ruling.targetLabel}` : '';
            titleEl.textContent = `${ruling.subjectLabel} · ${ruling.category}${targetPart}`;
            const copyEl = this.#documentRef.createElement('p');
            copyEl.className = 'item-copy';
            copyEl.textContent = ruling.text;
            card.append(titleEl, copyEl, this.#buildKnownByRow(ruling.knownByLabels));
            rulingsList.append(card);
          }
          rulingsSection.append(rulingsList);
        }

        rulingsSection.append(
          this.#buildPager({
            shownCount: this.#findingsData.rulingsItems.length,
            totalCount: this.#findingsData.rulingsTotal,
            nextCursor: this.#findingsData.rulingsNextCursor,
            loading: this.#findingsData.rulingsLoadingMore,
            onLoadMore: async () => {
              this.#findingsData.rulingsLoadingMore = true;
              this.render();
              try {
                await this.#callbacks.onLoadMoreRulings(this.#findingsData.rulingsNextCursor);
              } catch (loadError) {
                this.#findingsData.rulingsLoadingMore = false;
                this.#findingsData.error = loadError instanceof Error ? loadError.message : String(loadError);
                this.render();
              }
            },
          }),
        );
        body.append(rulingsSection);
        break;
      }

      case InspectorDrawer.#SettingsTabId: {
        const settingsForm = this.#documentRef.createElement('form');
        settingsForm.className = 'inspector-section';
        settingsForm.noValidate = true;

        const settingsTitle = this.#documentRef.createElement('h3');
        settingsTitle.className = 'section-title';
        settingsTitle.textContent = 'Models & Defaults';
        settingsForm.append(settingsTitle);

        const busy = this.#settingsData.saving || this.#settingsData.clearingKey;
        const draft = this.#settingsData.draft;
        const catalog = this.#settingsData.modelCatalog;

        if (this.#settingsData.prefilledDefaults) {
          settingsForm.append(
            this.#buildAlert('Suggested unrestricted defaults are prefilled below. Review and click Save to apply.', 'info'),
          );
        }

        const catalogBar = this.#documentRef.createElement('div');
        catalogBar.className = 'model-catalog-bar';

        const catalogButtons = this.#documentRef.createElement('div');
        catalogButtons.className = 'action-row-split';

        const applyDefaultsBtn = this.#buildButton('Apply suggested defaults', {
          id: InspectorDrawer.#ApplyDefaultsButtonId,
          variant: 'secondary',
          compact: true,
          disabled: busy || !catalog?.defaults,
          onClick: () => {
            if (!catalog?.defaults) {
              return;
            }
            for (const slot of InspectorDrawer.#ModelSlots) {
              if (typeof catalog.defaults[slot.key] === 'string') {
                draft.models[slot.key] = catalog.defaults[slot.key];
              }
            }
            this.#settingsData.prefilledDefaults = true;
            this.#settingsData.success = '';
            this.render();
          },
        });

        const refreshModelsBtn = this.#buildButton(ModelCatalogView.RefreshLabel, {
          id: InspectorDrawer.#RefreshButtonId,
          variant: 'secondary',
          compact: true,
          busy: this.#settingsData.modelCatalogLoading,
          busyLabel: ModelCatalogView.RefreshBusyLabel,
          disabled: busy || typeof this.#callbacks.onRefreshModels !== 'function',
          onClick: () => {
            this.#settingsData.refreshFocusPending = true;
            return this.#callbacks.onRefreshModels();
          },
        });
        catalogButtons.append(applyDefaultsBtn, refreshModelsBtn);
        catalogBar.append(catalogButtons);

        const filterInput = this.#documentRef.createElement('input');
        filterInput.id = 'settings-model-filter';
        filterInput.type = 'search';
        filterInput.className = 'field-control';
        filterInput.placeholder = InspectorDrawer.#FilterPlaceholder;
        filterInput.value = this.#settingsData.modelFilter;
        filterInput.disabled = busy;
        catalogBar.append(this.#buildField('Model picker filter', filterInput));

        const catalogStatusText = ModelCatalogView.statusText(catalog, this.#settingsData.modelCatalogLoading);
        if (catalogStatusText.length > 0) {
          const catalogStatus = this.#documentRef.createElement('div');
          catalogStatus.className = 'item-meta';
          catalogStatus.textContent = catalogStatusText;
          catalogBar.append(catalogStatus);
        }

        if (this.#settingsData.modelCatalogError.length > 0) {
          catalogBar.append(this.#buildAlert(this.#settingsData.modelCatalogError, 'danger'));
        }
        if (typeof catalog?.warning === 'string' && catalog.warning.length > 0) {
          catalogBar.append(this.#buildAlert(catalog.warning, 'warning'));
        }
        settingsForm.append(catalogBar);

        const slotPickers = [];
        for (const slot of InspectorDrawer.#ModelSlots) {
          const slotGroup = this.#documentRef.createElement('div');
          slotGroup.className = 'model-slot-group';

          const slotInput = this.#documentRef.createElement('input');
          slotInput.id = `settings-model-${slot.key}`;
          slotInput.type = 'text';
          slotInput.className = 'field-control';
          slotInput.placeholder = 'provider/model-name';
          slotInput.value = draft.models[slot.key];
          slotInput.disabled = busy;

          const slotSelect = this.#documentRef.createElement('select');
          slotSelect.id = `settings-model-picker-${slot.key}`;
          slotSelect.className = 'field-control model-picker-select';
          slotSelect.setAttribute('aria-label', `${slot.label} quick pick`);
          slotSelect.disabled = busy;
          this.#populateModelSelect(slotSelect, draft.models[slot.key], this.#settingsData.modelFilter);

          slotInput.addEventListener('input', () => {
            draft.models[slot.key] = slotInput.value;
            this.#populateModelSelect(slotSelect, draft.models[slot.key], this.#settingsData.modelFilter);
          });

          slotSelect.addEventListener('change', () => {
            if (slotSelect.value.length > 0) {
              draft.models[slot.key] = slotSelect.value;
              slotInput.value = slotSelect.value;
            }
          });

          slotGroup.append(this.#buildField(slot.label, slotInput), slotSelect);
          settingsForm.append(slotGroup);
          slotPickers.push({ slotKey: slot.key, selectElement: slotSelect });
        }

        filterInput.addEventListener('input', () => {
          this.#settingsData.modelFilter = filterInput.value;
          for (const picker of slotPickers) {
            this.#populateModelSelect(
              picker.selectElement,
              draft.models[picker.slotKey],
              this.#settingsData.modelFilter,
            );
          }
        });

        const oddsGrid = this.#documentRef.createElement('div');
        oddsGrid.className = 'form-grid-two';

        const pubInput = this.#documentRef.createElement('input');
        pubInput.id = 'settings-public-odds';
        pubInput.type = 'number';
        pubInput.min = '0';
        pubInput.step = '1';
        pubInput.className = 'field-control';
        pubInput.value = draft.publicOdds;
        pubInput.disabled = busy;
        pubInput.addEventListener('input', () => {
          draft.publicOdds = pubInput.value;
        });
        oddsGrid.append(this.#buildField('Default public odds', pubInput));

        const privInput = this.#documentRef.createElement('input');
        privInput.id = 'settings-private-odds';
        privInput.type = 'number';
        privInput.min = '0';
        privInput.step = '1';
        privInput.className = 'field-control';
        privInput.value = draft.privateOdds;
        privInput.disabled = busy;
        privInput.addEventListener('input', () => {
          draft.privateOdds = privInput.value;
        });
        oddsGrid.append(this.#buildField('Default private odds', privInput));

        const intervalInput = this.#documentRef.createElement('input');
        intervalInput.id = 'settings-scribe-interval';
        intervalInput.type = 'number';
        intervalInput.min = '0';
        intervalInput.step = '1';
        intervalInput.className = 'field-control';
        intervalInput.value = draft.scribeInterval;
        intervalInput.disabled = busy;
        intervalInput.addEventListener('input', () => {
          draft.scribeInterval = intervalInput.value;
        });
        oddsGrid.append(this.#buildField('Default Scribe interval', intervalInput));

        const warnInput = this.#documentRef.createElement('input');
        warnInput.id = 'settings-daily-warn';
        warnInput.type = 'number';
        warnInput.min = '0';
        warnInput.step = '0.01';
        warnInput.className = 'field-control';
        warnInput.placeholder = 'Optional (blank = off)';
        warnInput.value = draft.dailyWarnUsd;
        warnInput.disabled = busy;
        warnInput.addEventListener('input', () => {
          draft.dailyWarnUsd = warnInput.value;
        });
        oddsGrid.append(this.#buildField('Daily spend warning ($)', warnInput));
        settingsForm.append(oddsGrid);

        const pedantRow = this.#documentRef.createElement('label');
        pedantRow.className = 'checkbox-row';
        const pedantCheck = this.#documentRef.createElement('input');
        pedantCheck.id = 'settings-pedant-enabled';
        pedantCheck.type = 'checkbox';
        pedantCheck.checked = draft.pedantEnabled;
        pedantCheck.disabled = busy;
        pedantCheck.addEventListener('change', () => {
          draft.pedantEnabled = pedantCheck.checked;
        });
        const pedantLabel = this.#documentRef.createElement('span');
        pedantLabel.textContent = 'Enable Pedant continuity checks';
        pedantRow.append(pedantCheck, pedantLabel);
        settingsForm.append(pedantRow);

        const keyCard = this.#documentRef.createElement('div');
        keyCard.className = 'item-card';
        const apiKeyInfo = this.#settingsData.serverSettings?.apiKey ?? { configured: false, source: 'none' };
        const sourceLabel = apiKeyInfo.source === 'secrets'
          ? 'local/secrets.json'
          : apiKeyInfo.source === 'env'
            ? '.env'
            : 'Not configured';
        const keyHeader = this.#documentRef.createElement('div');
        keyHeader.className = 'item-card-row';
        const keyTitle = this.#documentRef.createElement('span');
        keyTitle.className = 'item-title';
        keyTitle.textContent = 'OpenRouter API Key';
        keyHeader.append(
          keyTitle,
          this.#buildBadge(sourceLabel, apiKeyInfo.configured ? 'is-success' : 'is-warning'),
        );
        keyCard.append(keyHeader);

        const apiKeyInput = this.#documentRef.createElement('input');
        apiKeyInput.id = 'settings-api-key';
        apiKeyInput.type = 'password';
        apiKeyInput.autocomplete = 'off';
        apiKeyInput.className = 'field-control';
        apiKeyInput.placeholder = 'Enter new OpenRouter key (blank keeps existing)';
        apiKeyInput.value = draft.openRouterApiKey;
        apiKeyInput.disabled = busy;
        apiKeyInput.addEventListener('input', () => {
          draft.openRouterApiKey = apiKeyInput.value;
        });
        keyCard.append(this.#buildField('Override key (saved to local/secrets.json)', apiKeyInput));

        const clearKeyRow = this.#documentRef.createElement('div');
        clearKeyRow.className = 'action-row-end';
        clearKeyRow.append(
          this.#buildButton('Clear saved key', {
            id: InspectorDrawer.#ClearKeyButtonId,
            variant: 'secondary',
            compact: true,
            busy: this.#settingsData.clearingKey,
            busyLabel: 'Clearing...',
            disabled: busy || apiKeyInfo.source !== 'secrets',
            onClick: async () => {
              if (busy) {
                return;
              }
              this.#settingsData.clearingKey = true;
              this.#settingsData.error = '';
              this.#settingsData.success = '';
              this.render();
              try {
                await this.#callbacks.onSaveSettings({ openRouterApiKey: null }, { replaceWarnings: false });
                this.#settingsData.success = 'Saved key override cleared.';
              } catch (clearError) {
                this.#settingsData.error = clearError instanceof Error ? clearError.message : String(clearError);
              } finally {
                this.#settingsData.clearingKey = false;
                this.render();
              }
            },
          }),
        );
        keyCard.append(clearKeyRow);
        settingsForm.append(keyCard);

        if (this.#settingsData.error.length > 0) {
          settingsForm.append(this.#buildAlert(this.#settingsData.error, 'danger'));
        }
        if (this.#settingsData.success.length > 0) {
          settingsForm.append(this.#buildAlert(this.#settingsData.success, 'success'));
        }
        for (const settingsWarning of this.#settingsData.warnings) {
          const warningAlert = this.#buildAlert(settingsWarning, 'warning');
          settingsForm.append(warningAlert);
          if (this.#firstWarningElement === null) {
            this.#firstWarningElement = warningAlert;
          }
        }

        const settingsFooter = this.#documentRef.createElement('div');
        settingsFooter.className = 'action-row-end';
        settingsFooter.append(
          this.#buildButton('Cancel', {
            id: InspectorDrawer.#CancelButtonId,
            variant: 'secondary',
            disabled: busy,
            onClick: () => {
              if (!busy && this.#settingsData.serverSettings !== null) {
                this.#settingsData.success = '';
                this.setSettings(this.#settingsData.serverSettings);
              }
            },
          }),
          this.#buildButton('Save', {
            id: InspectorDrawer.#SaveButtonId,
            variant: 'primary',
            type: 'submit',
            busy: this.#settingsData.saving,
            busyLabel: 'Saving...',
            disabled: busy,
          }),
        );
        settingsForm.append(settingsFooter);

        settingsForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (busy) {
            return;
          }
          const publicOdds = Number.parseInt(draft.publicOdds, 10);
          const privateOdds = Number.parseInt(draft.privateOdds, 10);
          const scribeInterval = Number.parseInt(draft.scribeInterval, 10);
          if (!/^\d+$/.test(draft.publicOdds.trim()) || !Number.isSafeInteger(publicOdds) || publicOdds < 0) {
            this.#settingsData.error = 'Default public odds must be a non-negative integer.';
            this.render();
            return;
          }
          if (!/^\d+$/.test(draft.privateOdds.trim()) || !Number.isSafeInteger(privateOdds) || privateOdds < 0) {
            this.#settingsData.error = 'Default private odds must be a non-negative integer.';
            this.render();
            return;
          }
          if (!/^\d+$/.test(draft.scribeInterval.trim()) || !Number.isSafeInteger(scribeInterval) || scribeInterval < 0) {
            this.#settingsData.error = 'Default Scribe interval must be a non-negative integer.';
            this.render();
            return;
          }

          let dailyWarnUsd = null;
          const trimmedWarn = draft.dailyWarnUsd.trim();
          if (trimmedWarn.length > 0) {
            const parsedWarn = Number(trimmedWarn);
            if (!Number.isFinite(parsedWarn) || parsedWarn < 0) {
              this.#settingsData.error = 'Daily spend warning must be a non-negative number or blank.';
              this.render();
              return;
            }
            dailyWarnUsd = parsedWarn;
          }

          const patch = {
            models: { ...draft.models },
            publicOdds,
            privateOdds,
            scribeInterval,
            pedantEnabled: draft.pedantEnabled,
            dailyWarnUsd,
          };
          const trimmedKey = draft.openRouterApiKey.trim();
          if (trimmedKey.length > 0) {
            patch.openRouterApiKey = trimmedKey;
          }

          this.#settingsData.saving = true;
          this.#settingsData.error = '';
          this.#settingsData.success = '';
          this.#settingsData.warnings = [];
          this.render();
          try {
            await this.#callbacks.onSaveSettings(patch);
            this.#settingsData.success = 'Settings saved.';
          } catch (saveError) {
            this.#settingsData.error = saveError instanceof Error ? saveError.message : String(saveError);
          } finally {
            this.#settingsData.saving = false;
            this.render();
            if (this.#firstWarningElement !== null) {
              FocusKeeper.reveal(this.#firstWarningElement);
            }
          }
        });

        body.append(settingsForm);
        break;
      }
    }

    this.#drawerElement.replaceChildren(header, tabBar, body);
  }

  /**
   * @param {string} labelText
   * @param {HTMLElement} controlElement
   * @returns {HTMLElement}
   */
  #buildField(labelText, controlElement) {
    const group = this.#documentRef.createElement('div');
    group.className = 'field-group';
    const label = this.#documentRef.createElement('label');
    label.className = 'field-label';
    if (typeof controlElement.id === 'string' && controlElement.id.length > 0) {
      label.setAttribute('for', controlElement.id);
    }
    label.textContent = labelText;
    group.append(label, controlElement);
    return group;
  }

  /**
   * @param {string} text
   * @param {{id?: string, variant?: 'primary' | 'secondary' | 'ghost' | 'danger', compact?: boolean, busy?: boolean, busyLabel?: string, disabled?: boolean, type?: 'button' | 'submit', onClick?: (() => void | Promise<void>) | null}} [options]
   * @returns {HTMLButtonElement}
   */
  #buildButton(
    text,
    {
      id = '',
      variant = 'secondary',
      compact = false,
      busy = false,
      busyLabel = 'Working...',
      disabled = false,
      type = 'button',
      onClick = null,
    } = {},
  ) {
    const button = this.#documentRef.createElement('button');
    if (id.length > 0) {
      button.id = id;
    }
    button.type = type;
    const classes = ['btn'];
    if (variant === 'danger') {
      classes.push('is-danger');
    } else {
      classes.push(`btn-${variant}`);
    }
    if (compact) {
      classes.push('btn-compact');
    }
    if (busy) {
      classes.push('is-loading');
    }
    button.className = classes.join(' ');
    button.disabled = busy || disabled;
    button.textContent = busy ? busyLabel : text;
    if (typeof onClick === 'function') {
      button.addEventListener('click', () => {
        return onClick();
      });
    }
    return button;
  }

  /**
   * @param {string} text
   * @param {string} [extraClass]
   * @returns {HTMLElement}
   */
  #buildBadge(text, extraClass = '') {
    const badge = this.#documentRef.createElement('span');
    badge.className = extraClass.length > 0 ? `tag-pill ${extraClass}` : 'tag-pill';
    badge.textContent = text;
    return badge;
  }

  /**
   * @param {string} message
   * @param {'info' | 'warning' | 'danger' | 'success'} [level]
   * @returns {HTMLElement}
   */
  #buildAlert(message, level = 'danger') {
    const alertBox = this.#documentRef.createElement('div');
    const levelClass = level === 'info' ? '' : `is-${level}`;
    alertBox.className = levelClass.length > 0 ? `inline-alert ${levelClass}` : 'inline-alert';
    if (level === 'danger') {
      alertBox.setAttribute('role', 'alert');
    }
    alertBox.textContent = message;
    return alertBox;
  }

  /**
   * @param {string | Array<string>} knownByLabels
   * @returns {HTMLElement}
   */
  #buildKnownByRow(knownByLabels) {
    const row = this.#documentRef.createElement('div');
    row.className = 'pill-group';
    const prefix = this.#documentRef.createElement('span');
    prefix.className = 'item-meta';
    prefix.textContent = 'Who knows:';
    row.append(prefix);

    if (knownByLabels === 'Everyone') {
      row.append(this.#buildBadge('Everyone', 'is-success'));
    } else if (Array.isArray(knownByLabels) && knownByLabels.length > 0) {
      for (const label of knownByLabels) {
        row.append(this.#buildBadge(String(label)));
      }
    } else {
      row.append(this.#buildBadge('None', 'is-warning'));
    }
    return row;
  }

  /**
   * @param {{shownCount: number, totalCount: number, nextCursor: string | null, loading: boolean, onLoadMore: () => Promise<void>}} options
   * @returns {HTMLElement}
   */
  #buildPager({ shownCount, totalCount, nextCursor, loading, onLoadMore }) {
    const footer = this.#documentRef.createElement('div');
    footer.className = 'pager-footer';

    const countSpan = this.#documentRef.createElement('span');
    countSpan.className = 'item-meta';
    countSpan.textContent = `Showing ${shownCount} of ${totalCount}`;
    footer.append(countSpan);

    if (nextCursor !== null) {
      footer.append(
        this.#buildButton('Load more', {
          variant: 'secondary',
          compact: true,
          busy: loading,
          busyLabel: 'Loading...',
          onClick: onLoadMore,
        }),
      );
    }
    return footer;
  }

  /**
   * @returns {void}
   */
  #applyBlankModelDefaults() {
    const defaults = this.#settingsData.modelCatalog?.defaults;
    const serverModels = this.#settingsData.serverSettings?.models;
    if (!defaults || !serverModels) {
      this.#settingsData.prefilledDefaults = false;
      return;
    }
    let filledAny = false;
    for (const slot of InspectorDrawer.#ModelSlots) {
      const serverValue = typeof serverModels[slot.key] === 'string' ? serverModels[slot.key].trim() : '';
      const currentDraft = typeof this.#settingsData.draft.models[slot.key] === 'string'
        ? this.#settingsData.draft.models[slot.key].trim()
        : '';
      const defaultValue = typeof defaults[slot.key] === 'string' ? defaults[slot.key].trim() : '';
      if (serverValue.length === 0 && currentDraft.length === 0 && defaultValue.length > 0) {
        this.#settingsData.draft.models[slot.key] = defaultValue;
        filledAny = true;
      }
    }
    const stillMissingInServer = InspectorDrawer.#ModelSlots.some((slot) => {
      const serverValue = typeof serverModels[slot.key] === 'string' ? serverModels[slot.key].trim() : '';
      return serverValue.length === 0;
    });
    this.#settingsData.prefilledDefaults = filledAny || stillMissingInServer;
  }

  /**
   * @param {HTMLSelectElement} selectElement
   * @param {string} currentValue
   * @param {string} filterQuery
   * @returns {void}
   */
  #populateModelSelect(selectElement, currentValue, filterQuery) {
    ModelCatalogView.populateSelect({
      documentRef: this.#documentRef,
      selectElement,
      catalog: this.#settingsData.modelCatalog,
      currentValue,
      filterQuery,
      emptyOptionText: ModelCatalogView.SelectPlaceholder,
      hiddenOptionText: ModelCatalogView.SelectPlaceholder,
    });
  }

  /**
   * @returns {void}
   */
  #renderCatalogUpdate() {
    const refreshReturn = FocusKeeper.takeRefreshReturn({
      isLoading: this.#settingsData.modelCatalogLoading,
      isPending: this.#settingsData.refreshFocusPending,
      refreshButtonId: InspectorDrawer.#RefreshButtonId,
    });
    this.#settingsData.refreshFocusPending = refreshReturn.isPending;
    if (this.#activeTab !== InspectorDrawer.#SettingsTabId) {
      return;
    }
    FocusKeeper.keep({
      documentRef: this.#documentRef,
      containerElement: this.#drawerElement,
      scrollSelector: InspectorDrawer.#ScrollSelector,
      renderFn: () => {
        this.render();
      },
      returnFocusId: refreshReturn.returnFocusId,
    });
  }
}
