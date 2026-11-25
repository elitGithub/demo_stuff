import { WorldsApi } from './api.mjs';
import { CampaignModal } from './components/CampaignModal.mjs';
import { CharacterModal } from './components/CharacterModal.mjs';
import { ChatView } from './components/ChatView.mjs';
import { ComposerBar } from './components/ComposerBar.mjs';
import { ConfirmModal } from './components/ConfirmModal.mjs';
import { InspectorDrawer } from './components/InspectorDrawer.mjs';

export class WorldsApp {
  #api;
  #rootElement;
  #documentRef;

  #campaignSelect;
  #loadMoreCampaignsBtn;
  #newCampaignBtn;
  #editCampaignBtn;
  #scenePill;
  #spendBadge;
  #syncBadge;
  #syncSaveBtn;
  #inspectorToggleBtn;
  #findingsBadge;
  #spendWarningBanner;
  #globalStatusBanner;

  #chatView;
  #composerBar;
  #inspectorDrawer;
  #campaignModal;
  #characterModal;
  #confirmModal;

  #health = null;
  #settings = null;
  #modelCatalog = null;
  #modelCatalogLoading = false;
  #modelCatalogError = '';
  #modelLoadSeq = 0;
  #modelAbortController = null;
  #campaigns = [];
  #campaignsTotal = 0;
  #campaignsNextCursor = null;
  #loadingMoreCampaigns = false;
  #activeCampaignId = null;

  #activeCharacters = [];
  #castIncludeArchived = false;
  #memorySection = 'subjects';
  #memoryQuery = '';
  #openFindingsTotal = 0;

  #activeTurnController = null;
  #syncSaving = false;

  /**
   * @param {{api: WorldsApi, rootElement: HTMLElement, documentRef?: Document | null}} options
   * @throws {TypeError}
   */
  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('WorldsApp options must be a plain object.');
    }
    const { api, rootElement, documentRef = null } = options;
    if (api === null || typeof api !== 'object') {
      throw new TypeError('WorldsApi instance is required.');
    }
    if (rootElement === null || typeof rootElement !== 'object') {
      throw new TypeError('rootElement is required.');
    }

    this.#api = api;
    this.#rootElement = rootElement;
    this.#documentRef = documentRef ?? (typeof document !== 'undefined' ? document : null);

    this.#campaignSelect = this.#rootElement.querySelector('#campaign-select');
    this.#loadMoreCampaignsBtn = this.#rootElement.querySelector('#load-more-campaigns-btn');
    this.#newCampaignBtn = this.#rootElement.querySelector('#new-campaign-btn');
    this.#editCampaignBtn = this.#rootElement.querySelector('#edit-campaign-btn');
    this.#scenePill = this.#rootElement.querySelector('#scene-pill');
    this.#spendBadge = this.#rootElement.querySelector('#spend-badge');
    this.#syncBadge = this.#rootElement.querySelector('#sync-badge');
    this.#syncSaveBtn = this.#rootElement.querySelector('#sync-save-btn');
    this.#inspectorToggleBtn = this.#rootElement.querySelector('#inspector-toggle-btn');
    this.#findingsBadge = this.#rootElement.querySelector('#findings-badge');
    this.#spendWarningBanner = this.#rootElement.querySelector('#spend-warning-banner');
    this.#globalStatusBanner = this.#rootElement.querySelector('#global-status-banner');

    const chatContainer = this.#rootElement.querySelector('#chat-view');
    const composerContainer = this.#rootElement.querySelector('#composer-bar');
    const drawerElement = this.#rootElement.querySelector('#inspector-drawer');
    const backdropElement = this.#rootElement.querySelector('#drawer-backdrop');
    const modalRoot = this.#rootElement.querySelector('#modal-root');

    this.#confirmModal = new ConfirmModal({
      modalRoot,
      documentRef: this.#documentRef,
    });

    this.#campaignModal = new CampaignModal({
      modalRoot,
      documentRef: this.#documentRef,
      onSave: async (payload, existingCampaign) => {
        if (existingCampaign === null) {
          const created = await this.#api.createCampaign(payload);
          this.#campaigns = [created, ...this.#campaigns];
          this.#campaignsTotal += 1;
          await this.selectCampaign(created.id);
        } else {
          const updated = await this.#api.updateCampaign(existingCampaign.id, payload);
          this.#applyUpdatedCampaign(updated);
        }
      },
      onRequestDelete: (targetCampaign) => {
        this.#confirmModal.open({
          title: 'Delete campaign?',
          message: `Permanently delete "${targetCampaign.title}" and all its turns, cast, and memory?`,
          confirmLabel: 'Delete Campaign',
          busyLabel: 'Deleting...',
          onConfirm: async () => {
            await this.#api.deleteCampaign(targetCampaign.id);
            this.#campaigns = this.#campaigns.filter((entry) => entry.id !== targetCampaign.id);
            this.#campaignsTotal = Math.max(0, this.#campaignsTotal - 1);
            if (this.#activeCampaignId === targetCampaign.id) {
              const nextCampaign = this.#campaigns[0] ?? null;
              if (nextCampaign !== null) {
                await this.selectCampaign(nextCampaign.id);
              } else {
                this.#activeCampaignId = null;
                this.#openFindingsTotal = 0;
                this.#activeCharacters = [];
                this.#chatView.setCampaignActive(false);
                this.#composerBar.setCampaignActive(false);
                this.#inspectorDrawer.setCampaign(null);
                this.#renderTopBar();
              }
            } else {
              this.#renderTopBar();
            }
          },
        });
      },
    });

    this.#characterModal = new CharacterModal({
      modalRoot,
      documentRef: this.#documentRef,
      onSave: async (payload, existingCharacter) => {
        const campaignId = this.#activeCampaignId;
        if (campaignId === null) {
          return;
        }
        let savedCharacter;
        if (existingCharacter === null) {
          savedCharacter = await this.#api.createCharacter(campaignId, payload);
        } else {
          savedCharacter = await this.#api.updateCharacter(campaignId, existingCharacter.id, payload);
        }
        const activeCampaign = this.#getActiveCampaign();
        if (activeCampaign !== null && savedCharacter !== null && typeof savedCharacter === 'object') {
          if (savedCharacter.isPlayer === true) {
            this.#applyUpdatedCampaign({
              ...activeCampaign,
              playerCharacterId: savedCharacter.id,
            });
          } else if (activeCampaign.playerCharacterId === savedCharacter.id) {
            this.#applyUpdatedCampaign({
              ...activeCampaign,
              playerCharacterId: null,
            });
          }
        }
        await this.#refreshCast({ includeArchived: this.#castIncludeArchived });
        return savedCharacter;
      },
    });

    this.#chatView = new ChatView({
      container: chatContainer,
      documentRef: this.#documentRef,
      onLoadEarlier: async () => {
        const campaignId = this.#activeCampaignId;
        if (campaignId === null) {
          return;
        }
        const currentCursor = this.#turnsNextCursor === null ? null : (this.#oldestTurnSeq ?? this.#turnsNextCursor);
        if (currentCursor === null) {
          return;
        }
        this.#chatView.setLoadingEarlier(true);
        try {
          const page = await this.#api.listTurns(campaignId, { limit: 50, beforeSeq: currentCursor });
          this.#oldestTurnSeq = page.items.length > 0
            ? Math.min(this.#oldestTurnSeq ?? page.items[0].seq, ...page.items.map((turn) => turn.seq))
            : this.#oldestTurnSeq;
          this.#turnsNextCursor = page.nextCursor;
          this.#chatView.prependTurnsPage(page);
        } catch (loadError) {
          this.#chatView.setLoadingEarlier(false);
          this.#setGlobalBanner(loadError instanceof Error ? loadError.message : String(loadError), 'danger');
        }
      },
      onRegenerate: async () => {
        await this.#executeSseTurn({ regenerating: true });
      },
      onSaveEdit: async (turnId, { text, beatId }) => {
        const campaignId = this.#activeCampaignId;
        if (campaignId === null) {
          return;
        }
        const updatedTurn = await this.#api.editTurn(campaignId, turnId, { text, beatId });
        this.#chatView.replaceTurn(updatedTurn);
        try {
          await this.#refreshMemory(campaignId);
        } catch (refreshError) {
          this.#setGlobalBanner(refreshError instanceof Error ? refreshError.message : String(refreshError), 'warning');
        }
      },
      onRequestDelete: () => {
        const campaignId = this.#activeCampaignId;
        if (campaignId === null) {
          return;
        }
        this.#confirmModal.open({
          title: 'Delete last turn pair?',
          message: 'Remove the most recent user message and reply, and restore the scene state before that turn?',
          confirmLabel: 'Delete Turn',
          busyLabel: 'Deleting...',
          onConfirm: async () => {
            this.#chatView.setActionBusy(true);
            try {
              const result = await this.#api.deleteLastTurnPair(campaignId);
              const activeCampaign = this.#getActiveCampaign();
              if (activeCampaign !== null && result.restoredSceneState) {
                this.#applyUpdatedCampaign({
                  ...activeCampaign,
                  sceneState: result.restoredSceneState,
                });
              }
              this.#chatView.removeLastTurnPair();
              try {
                await Promise.all([
                  this.#refreshFindings(campaignId),
                  this.#refreshMemory(campaignId),
                ]);
              } catch (refreshError) {
                this.#setGlobalBanner(refreshError instanceof Error ? refreshError.message : String(refreshError), 'warning');
              }
            } finally {
              this.#chatView.setActionBusy(false);
            }
          },
        });
      },
    });

    this.#composerBar = new ComposerBar({
      container: composerContainer,
      documentRef: this.#documentRef,
      onSend: async ({ text, mode, oocNudge }) => {
        await this.#executeSseTurn({ text, mode, oocNudge, regenerating: false });
      },
      onStop: () => {
        if (this.#activeTurnController !== null && !this.#activeTurnController.signal.aborted) {
          this.#activeTurnController.abort();
        }
      },
    });

    this.#inspectorDrawer = new InspectorDrawer({
      drawerElement,
      backdropElement,
      documentRef: this.#documentRef,
      callbacks: {
        onOpenChange: (isOpen) => {
          this.#inspectorToggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        },
        onTabChange: async (tabId) => {
          const campaignId = this.#activeCampaignId;
          if (campaignId === null) {
            return;
          }
          try {
            if (tabId === 'memory') {
              await this.#refreshMemory(campaignId);
            } else if (tabId === 'findings') {
              await Promise.all([
                this.#refreshFindings(campaignId),
                this.#refreshRulings(campaignId),
              ]);
            } else if (tabId === 'cast' || tabId === 'scene') {
              await this.#refreshCast({ includeArchived: this.#castIncludeArchived });
            } else if (tabId === 'settings') {
              const latestSettings = await this.#api.getSettings();
              this.#settings = latestSettings;
              this.#inspectorDrawer.setSettings(latestSettings);
              this.#renderTopBar();
            }
          } catch (tabError) {
            this.#setGlobalBanner(tabError instanceof Error ? tabError.message : String(tabError), 'danger');
          }
        },
        onSaveScene: async (scenePatch) => {
          const campaign = this.#getActiveCampaign();
          if (campaign === null) {
            return;
          }
          const updated = await this.#api.updateCampaign(campaign.id, {
            sceneState: {
              ...campaign.sceneState,
              ...scenePatch,
            },
          });
          this.#applyUpdatedCampaign(updated);
        },
        onSetPresence: async (characterId, mode) => {
          const campaign = this.#getActiveCampaign();
          if (campaign === null) {
            return;
          }
          const currentState = campaign.sceneState;
          const presentIds = (currentState.presentIds ?? []).filter((entryId) => entryId !== characterId);
          const remoteIds = (currentState.remoteIds ?? []).filter((entryId) => entryId !== characterId);
          if (mode === 'present') {
            presentIds.push(characterId);
          } else if (mode === 'remote') {
            remoteIds.push(characterId);
          }
          const updated = await this.#api.updateCampaign(campaign.id, {
            sceneState: {
              ...currentState,
              presentIds,
              remoteIds,
            },
          });
          this.#applyUpdatedCampaign(updated);
        },
        onAddWalkOn: async (walkOnName) => {
          const campaign = this.#getActiveCampaign();
          if (campaign === null) {
            return;
          }
          const currentWalkOns = Array.isArray(campaign.sceneState.activeWalkOns)
            ? campaign.sceneState.activeWalkOns
            : [];
          if (currentWalkOns.includes(walkOnName)) {
            throw new Error(`Walk-on "${walkOnName}" is already active.`);
          }
          const updated = await this.#api.updateCampaign(campaign.id, {
            sceneState: {
              ...campaign.sceneState,
              activeWalkOns: [...currentWalkOns, walkOnName],
            },
          });
          this.#applyUpdatedCampaign(updated);
        },
        onRemoveWalkOn: async (walkOnName) => {
          const campaign = this.#getActiveCampaign();
          if (campaign === null) {
            return;
          }
          const currentWalkOns = Array.isArray(campaign.sceneState.activeWalkOns)
            ? campaign.sceneState.activeWalkOns
            : [];
          const updated = await this.#api.updateCampaign(campaign.id, {
            sceneState: {
              ...campaign.sceneState,
              activeWalkOns: currentWalkOns.filter((entry) => entry !== walkOnName),
            },
          });
          this.#applyUpdatedCampaign(updated);
        },
        onAddCharacter: () => {
          this.#characterModal.open({
            character: null,
            modelCatalog: this.#modelCatalog,
            modelCatalogLoading: this.#modelCatalogLoading,
            modelCatalogError: this.#modelCatalogError,
            onRefreshModels: () => this.#loadModels(true),
          });
        },
        onEditCharacter: (character) => {
          this.#characterModal.open({
            character,
            modelCatalog: this.#modelCatalog,
            modelCatalogLoading: this.#modelCatalogLoading,
            modelCatalogError: this.#modelCatalogError,
            onRefreshModels: () => this.#loadModels(true),
          });
        },
        onToggleArchiveCharacter: async (character) => {
          const campaignId = this.#activeCampaignId;
          if (campaignId === null) {
            return;
          }
          const updatedChar = await this.#api.updateCharacter(campaignId, character.id, {
            archived: !character.archived,
          });
          const activeCampaign = this.#getActiveCampaign();
          if (activeCampaign !== null && activeCampaign.playerCharacterId === updatedChar.id && !updatedChar.isPlayer) {
            this.#applyUpdatedCampaign({
              ...activeCampaign,
              playerCharacterId: null,
            });
          }
          await this.#refreshCast({ includeArchived: this.#castIncludeArchived });
        },
        onDeleteCharacter: (character) => {
          const campaignId = this.#activeCampaignId;
          if (campaignId === null) {
            return;
          }
          this.#confirmModal.open({
            title: 'Delete character?',
            message: `Permanently delete "${character.name}" (@${character.slug})? Referenced characters must be archived instead.`,
            confirmLabel: 'Delete Character',
            busyLabel: 'Deleting...',
            onConfirm: async () => {
              await this.#api.deleteCharacter(campaignId, character.id);
              await this.#refreshCast({ includeArchived: this.#castIncludeArchived });
            },
          });
        },
        onReloadCast: async (includeArchived) => {
          this.#castIncludeArchived = includeArchived;
          await this.#refreshCast({ includeArchived });
        },
        onLoadMoreCast: async (afterCursor, includeArchived) => {
          await this.#refreshCast({ after: afterCursor, append: true, includeArchived });
        },
        onLoadMemory: async ({ section, query, after = null, append = false }) => {
          const campaignId = this.#activeCampaignId;
          if (campaignId === null) {
            return;
          }
          this.#memorySection = section;
          this.#memoryQuery = query;
          await this.#refreshMemory(campaignId, { section, query, after, append });
        },
        onUpdateMemory: async () => {
          const campaignId = this.#activeCampaignId;
          if (campaignId === null) {
            return;
          }
          await this.#api.updateMemory(campaignId);
          await Promise.all([
            this.#refreshMemory(campaignId),
            this.#refreshRulings(campaignId),
            this.#refreshHealth(),
          ]);
        },
        onTellPreview: async (instruction) => {
          const campaignId = this.#activeCampaignId;
          if (campaignId === null) {
            throw new Error('No active campaign selected.');
          }
          const preview = await this.#api.tellPreview(campaignId, instruction);
          await this.#refreshHealth();
          return preview;
        },
        onTellCommit: async (operations) => {
          const campaignId = this.#activeCampaignId;
          if (campaignId === null) {
            return;
          }
          await this.#api.tellCommit(campaignId, operations);
          await Promise.all([
            this.#refreshMemory(campaignId),
            this.#refreshRulings(campaignId),
          ]);
        },
        onMuseSuggest: async (excludeThreadIds) => {
          const campaignId = this.#activeCampaignId;
          if (campaignId === null) {
            return null;
          }
          const result = await this.#api.museSuggest(campaignId, { excludeThreadIds });
          await this.#refreshHealth();
          return result.suggestion ?? null;
        },
        onUseMuse: (suggestionText) => {
          this.#composerBar.setDraftText(suggestionText);
          this.#inspectorDrawer.setOpen(false);
        },
        onLoadMoreFindings: async (afterCursor) => {
          const campaignId = this.#activeCampaignId;
          if (campaignId === null) {
            return;
          }
          await this.#refreshFindings(campaignId, { after: afterCursor, append: true });
        },
        onLoadMoreRulings: async (afterCursor) => {
          const campaignId = this.#activeCampaignId;
          if (campaignId === null) {
            return;
          }
          await this.#refreshRulings(campaignId, { after: afterCursor, append: true });
        },
        onResolveFinding: async (findingId, { action, replacementText = null }) => {
          const campaignId = this.#activeCampaignId;
          if (campaignId === null) {
            return;
          }
          await this.#api.resolveFinding(campaignId, findingId, { action, replacementText });
          await Promise.all([
            this.#refreshFindings(campaignId),
            this.#refreshRulings(campaignId),
            this.#refreshMemory(campaignId),
          ]);
        },
        onSaveSettings: async (patch, { replaceWarnings = true } = {}) => {
          const updatedSettings = await this.#api.updateSettings(patch);
          this.#settings = updatedSettings;
          this.#inspectorDrawer.setSettings(updatedSettings);
          if (replaceWarnings) {
            this.#inspectorDrawer.setSettingsWarnings(updatedSettings.warnings);
          }
          this.#renderTopBar();
        },
        onRefreshModels: () => this.#loadModels(true),
      },
    });
  }

  #turnsNextCursor = null;
  #oldestTurnSeq = null;

  /**
   * @returns {Promise<void>}
   */
  async init() {
    this.#campaignSelect.addEventListener('change', () => {
      const selectedId = this.#campaignSelect.value;
      if (selectedId && selectedId !== this.#activeCampaignId) {
        void this.selectCampaign(selectedId);
      }
    });

    this.#loadMoreCampaignsBtn.addEventListener('click', async () => {
      if (this.#loadingMoreCampaigns || this.#campaignsNextCursor === null) {
        return;
      }
      this.#loadingMoreCampaigns = true;
      this.#renderTopBar();
      try {
        const nextPage = await this.#api.listCampaigns({ limit: 25, after: this.#campaignsNextCursor });
        const existingIds = new Set(this.#campaigns.map((entry) => entry.id));
        const appended = (nextPage.items ?? []).filter((entry) => !existingIds.has(entry.id));
        this.#campaigns = [...this.#campaigns, ...appended];
        this.#campaignsTotal = Number.isInteger(nextPage.total) ? nextPage.total : this.#campaigns.length;
        this.#campaignsNextCursor = nextPage.nextCursor ?? null;
      } catch (loadError) {
        this.#setGlobalBanner(loadError instanceof Error ? loadError.message : String(loadError), 'danger');
      } finally {
        this.#loadingMoreCampaigns = false;
        this.#renderTopBar();
      }
    });

    this.#newCampaignBtn.addEventListener('click', () => {
      this.#campaignModal.open({
        campaign: null,
        settings: this.#settings,
      });
    });

    this.#editCampaignBtn.addEventListener('click', () => {
      const campaign = this.#getActiveCampaign();
      if (campaign !== null) {
        this.#campaignModal.open({
          campaign,
          settings: this.#settings,
          characters: this.#activeCharacters,
        });
      }
    });

    this.#scenePill.addEventListener('click', () => {
      this.#inspectorDrawer.setTab('scene');
      this.#inspectorDrawer.setOpen(true);
    });

    this.#inspectorToggleBtn.addEventListener('click', () => {
      this.#inspectorDrawer.setOpen(!this.#inspectorDrawer.isOpen());
    });

    this.#syncSaveBtn.addEventListener('click', async () => {
      if (this.#syncSaving) {
        return;
      }
      this.#syncSaving = true;
      this.#renderTopBar();
      try {
        const result = await this.#api.saveSync();
        if (this.#health !== null) {
          this.#health = {
            ...this.#health,
            sync: {
              ...(this.#health.sync ?? {}),
              status: result.status,
              mode: result.status === 'local_only' ? 'local_only' : (this.#health.sync?.mode ?? 'r2'),
            },
          };
        }
        const level = result.saved ? 'success' : 'info';
        const message = result.message || (result.saved ? 'Saved snapshot to cloud.' : 'Cloud sync status updated.');
        this.#setGlobalBanner(message, level);
      } catch (syncError) {
        if (syncError?.statusCode === 409 && this.#health !== null) {
          this.#health = {
            ...this.#health,
            sync: {
              ...(this.#health.sync ?? {}),
              status: 'conflict',
            },
          };
        }
        this.#setGlobalBanner(syncError instanceof Error ? syncError.message : String(syncError), 'danger');
      } finally {
        this.#syncSaving = false;
        this.#renderTopBar();
      }
    });

    this.#inspectorDrawer.render();
    this.#chatView.render();

    void this.#loadModels(false);

    try {
      const [health, settings, campaignsPage] = await Promise.all([
        this.#api.getHealth(),
        this.#api.getSettings(),
        this.#api.listCampaigns({ limit: 25 }),
      ]);
      this.#health = health;
      this.#settings = settings;
      this.#campaigns = [...(campaignsPage.items ?? [])];
      this.#campaignsTotal = Number.isInteger(campaignsPage.total) ? campaignsPage.total : this.#campaigns.length;
      this.#campaignsNextCursor = campaignsPage.nextCursor ?? null;

      this.#inspectorDrawer.setSettings(settings);
      this.#renderTopBar();

      if (this.#campaigns.length > 0) {
        await this.selectCampaign(this.#campaigns[0].id);
      } else {
        this.#chatView.setCampaignActive(false);
        this.#composerBar.setCampaignActive(false);
        this.#inspectorDrawer.setCampaign(null);
      }
    } catch (bootError) {
      this.#setGlobalBanner(bootError instanceof Error ? bootError.message : String(bootError), 'danger');
    }
  }

  /**
   * @param {string} campaignId
   * @returns {Promise<void>}
   */
  async selectCampaign(campaignId) {
    this.#activeCampaignId = campaignId;
    this.#memorySection = 'subjects';
    this.#memoryQuery = '';
    const activeCampaign = this.#getActiveCampaign();
    this.#chatView.setCampaignActive(activeCampaign !== null);
    this.#composerBar.setCampaignActive(activeCampaign !== null);
    this.#composerBar.setAlert(null);
    this.#inspectorDrawer.setCampaign(activeCampaign, { resetDraft: true });
    this.#renderTopBar();

    if (activeCampaign === null) {
      return;
    }

    try {
      const [turnsPage, castPage, allActiveCast] = await Promise.all([
        this.#api.listTurns(campaignId, { limit: 50 }),
        this.#api.listCharacters(campaignId, { includeArchived: this.#castIncludeArchived, limit: 25 }),
        this.#loadAllActiveCharacters(campaignId),
      ]);

      this.#turnsNextCursor = turnsPage.nextCursor ?? null;
      this.#oldestTurnSeq = turnsPage.items.length > 0
        ? Math.min(...turnsPage.items.map((turn) => turn.seq))
        : null;
      this.#activeCharacters = allActiveCast;

      this.#chatView.setCharacters(allActiveCast);
      this.#chatView.setTurnsPage(turnsPage);
      this.#inspectorDrawer.setCastPage(castPage, { includeArchived: this.#castIncludeArchived });

      await Promise.all([
        this.#refreshFindings(campaignId),
        this.#refreshMemory(campaignId),
        this.#refreshRulings(campaignId),
      ]);
    } catch (loadError) {
      this.#setGlobalBanner(loadError instanceof Error ? loadError.message : String(loadError), 'danger');
    }
  }

  /**
   * @param {string} campaignId
   * @returns {Promise<Array<object>>}
   */
  async #loadAllActiveCharacters(campaignId) {
    const collected = [];
    let afterCursor = null;
    while (true) {
      const page = await this.#api.listCharacters(campaignId, {
        includeArchived: true,
        limit: 50,
        after: afterCursor,
      });
      collected.push(...(page.items ?? []));
      if (page.nextCursor === null) {
        break;
      }
      afterCursor = page.nextCursor;
    }
    return collected;
  }

  /**
   * @returns {object | null}
   */
  #getActiveCampaign() {
    if (this.#activeCampaignId === null) {
      return null;
    }
    return this.#campaigns.find((entry) => entry.id === this.#activeCampaignId) ?? null;
  }

  /**
   * @param {object} updatedCampaign
   * @returns {void}
   */
  #applyUpdatedCampaign(updatedCampaign) {
    if (updatedCampaign === null || typeof updatedCampaign !== 'object') {
      return;
    }
    this.#campaigns = this.#campaigns.map((entry) => {
      return entry.id === updatedCampaign.id ? updatedCampaign : entry;
    });
    if (this.#activeCampaignId === updatedCampaign.id) {
      this.#inspectorDrawer.setCampaign(updatedCampaign, { resetDraft: true });
    }
    this.#renderTopBar();
  }

  /**
   * @returns {void}
   */
  #renderTopBar() {
    const activeCampaign = this.#getActiveCampaign();
    const isTurnRunning = this.#activeTurnController !== null;

    const options = [];
    if (this.#campaigns.length === 0) {
      const emptyOption = this.#documentRef.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = 'No campaigns';
      options.push(emptyOption);
    } else {
      for (const campaign of this.#campaigns) {
        const option = this.#documentRef.createElement('option');
        option.value = campaign.id;
        option.textContent = campaign.title;
        options.push(option);
      }
    }
    this.#campaignSelect.replaceChildren(...options);
    this.#campaignSelect.value = activeCampaign?.id ?? '';
    this.#campaignSelect.disabled = isTurnRunning || this.#campaigns.length === 0;

    if (this.#campaignsNextCursor !== null) {
      this.#loadMoreCampaignsBtn.className = this.#loadingMoreCampaigns
        ? 'btn btn-secondary btn-compact is-loading'
        : 'btn btn-secondary btn-compact';
      this.#loadMoreCampaignsBtn.disabled = this.#loadingMoreCampaigns || isTurnRunning;
      this.#loadMoreCampaignsBtn.textContent = this.#loadingMoreCampaigns
        ? 'Loading...'
        : `More (${this.#campaigns.length}/${this.#campaignsTotal})`;
    } else {
      this.#loadMoreCampaignsBtn.className = 'btn btn-secondary btn-compact is-hidden';
    }

    this.#newCampaignBtn.disabled = isTurnRunning;
    this.#editCampaignBtn.disabled = isTurnRunning || activeCampaign === null;

    if (activeCampaign !== null && activeCampaign.sceneState) {
      const scene = activeCampaign.sceneState;
      const locationText = typeof scene.location === 'string' && scene.location.trim().length > 0
        ? scene.location.trim()
        : 'Unspecified location';
      const visibilityLabel = scene.sceneType === 'private' ? 'Private' : 'Public';
      this.#scenePill.className = 'scene-pill';
      this.#scenePill.textContent = `${locationText} · Day ${scene.day} · ${visibilityLabel}`;
    } else {
      this.#scenePill.className = 'scene-pill is-hidden';
      this.#scenePill.textContent = '';
    }

    const totalUsd = Number(this.#health?.dailySpend?.totalUsd ?? 0);
    const unpricedCount = Number(this.#health?.dailySpend?.unpricedCount ?? 0);
    const formattedUsd = totalUsd === 0
      ? '$0.00'
      : totalUsd < 0.01
        ? `$${totalUsd.toFixed(4)}`
        : `$${totalUsd.toFixed(2)}`;
    const spendLabel = unpricedCount > 0 ? `${formattedUsd} (+${unpricedCount} unpriced)` : formattedUsd;
    const warnThreshold = this.#settings?.dailyWarnUsd;
    const overThreshold = typeof warnThreshold === 'number' && Number.isFinite(warnThreshold) && totalUsd >= warnThreshold;

    this.#spendBadge.textContent = spendLabel;
    this.#spendBadge.className = overThreshold ? 'status-pill is-warning' : 'status-pill';

    if (overThreshold) {
      this.#spendWarningBanner.className = 'alert-banner is-warning';
      this.#spendWarningBanner.textContent = `Daily UTC spend (${spendLabel}) reached your warning threshold ($${warnThreshold.toFixed(2)}).`;
    } else {
      this.#spendWarningBanner.className = 'alert-banner is-warning is-hidden';
      this.#spendWarningBanner.textContent = '';
    }

    const syncStatus = this.#health?.sync?.status ?? 'local_only';
    const syncMode = this.#health?.sync?.mode ?? 'local_only';
    let syncText = 'Local only';
    let syncClass = 'status-pill';
    if (syncMode !== 'local_only' || (syncStatus !== 'local_only' && syncStatus !== 'ready')) {
      if (syncStatus === 'synced' || syncStatus === 'saved') {
        syncText = 'Cloud synced';
        syncClass = 'status-pill is-success';
      } else if (syncStatus === 'conflict' || syncStatus === 'foreign_bucket') {
        syncText = syncStatus === 'foreign_bucket' ? 'Bucket guard error' : 'Cloud conflict';
        syncClass = 'status-pill is-danger';
      } else if (syncStatus === 'offline') {
        syncText = 'Cloud offline';
        syncClass = 'status-pill is-warning';
      } else {
        syncText = 'Cloud ready';
      }
    }
    this.#syncBadge.textContent = syncText;
    this.#syncBadge.className = syncClass;

    this.#syncSaveBtn.disabled = this.#syncSaving || isTurnRunning;
    this.#syncSaveBtn.className = this.#syncSaving
      ? 'btn btn-secondary btn-compact is-loading'
      : 'btn btn-secondary btn-compact';
    this.#syncSaveBtn.textContent = this.#syncSaving ? 'Saving...' : 'Save to Cloud';

    if (this.#openFindingsTotal > 0) {
      this.#findingsBadge.textContent = String(this.#openFindingsTotal);
      this.#findingsBadge.className = 'count-badge';
    } else {
      this.#findingsBadge.textContent = '0';
      this.#findingsBadge.className = 'count-badge is-hidden';
    }
  }

  /**
   * @param {string | null} message
   * @param {'info' | 'warning' | 'danger' | 'success'} [level]
   * @returns {void}
   */
  #setGlobalBanner(message, level = 'info') {
    if (typeof message !== 'string' || message.trim().length === 0) {
      this.#globalStatusBanner.textContent = '';
      this.#globalStatusBanner.className = 'alert-banner is-hidden';
      return;
    }
    const levelClass = level === 'info' ? '' : ` is-${level}`;
    this.#globalStatusBanner.textContent = message;
    this.#globalStatusBanner.className = `alert-banner${levelClass}`;
  }

  /**
   * @returns {Promise<void>}
   */
  async #refreshHealth() {
    try {
      this.#health = await this.#api.getHealth();
      this.#renderTopBar();
    } catch (healthError) {
      this.#setGlobalBanner(healthError instanceof Error ? healthError.message : String(healthError), 'warning');
    }
  }

  /**
   * @param {boolean} [refresh]
   * @returns {Promise<void>}
   */
  async #loadModels(refresh = false) {
    this.#modelLoadSeq += 1;
    const requestSeq = this.#modelLoadSeq;
    if (this.#modelAbortController !== null) {
      this.#modelAbortController.abort();
    }
    const controller = new AbortController();
    this.#modelAbortController = controller;

    this.#modelCatalogLoading = true;
    this.#modelCatalogError = '';
    this.#inspectorDrawer.setModelCatalogLoading(true);
    this.#characterModal.setModelCatalogLoading(true);

    try {
      const catalog = refresh
        ? await this.#api.refreshModels({ signal: controller.signal })
        : await this.#api.getModels({ signal: controller.signal });
      if (requestSeq !== this.#modelLoadSeq || controller.signal.aborted) {
        return;
      }
      this.#modelCatalog = catalog;
      this.#modelCatalogLoading = false;
      this.#modelCatalogError = '';
      this.#inspectorDrawer.setModelCatalog(catalog);
      this.#characterModal.setModelCatalog(catalog);
    } catch (loadError) {
      if (requestSeq !== this.#modelLoadSeq || controller.signal.aborted) {
        return;
      }
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      this.#modelCatalogLoading = false;
      this.#modelCatalogError = message;
      this.#inspectorDrawer.setModelCatalogError(message);
      this.#characterModal.setModelCatalogError(message);
    }
  }

  /**
   * @param {{after?: string | null, append?: boolean, includeArchived?: boolean}} [options]
   * @returns {Promise<void>}
   */
  async #refreshCast({ after = null, append = false, includeArchived = this.#castIncludeArchived } = {}) {
    const campaignId = this.#activeCampaignId;
    if (campaignId === null) {
      return;
    }
    const [page, allActiveCast] = await Promise.all([
      this.#api.listCharacters(campaignId, { includeArchived, limit: 25, after }),
      this.#loadAllActiveCharacters(campaignId),
    ]);
    this.#activeCharacters = allActiveCast;
    this.#chatView.setCharacters(allActiveCast);
    this.#inspectorDrawer.setCastPage(page, { append, includeArchived });
  }

  /**
   * @param {string} campaignId
   * @param {{section?: string, query?: string, after?: string | null, append?: boolean}} [options]
   * @returns {Promise<void>}
   */
  async #refreshMemory(
    campaignId,
    { section = this.#memorySection, query = this.#memoryQuery, after = null, append = false } = {},
  ) {
    const page = await this.#api.getMemory(campaignId, {
      section,
      query,
      limit: 25,
      after,
    });
    this.#inspectorDrawer.setMemoryPage(page, { append });
  }

  /**
   * @param {string} campaignId
   * @param {{after?: string | null, append?: boolean}} [options]
   * @returns {Promise<void>}
   */
  async #refreshFindings(campaignId, { after = null, append = false } = {}) {
    const page = await this.#api.listFindings(campaignId, {
      status: 'open',
      limit: 25,
      after,
    });
    this.#openFindingsTotal = Number.isInteger(page.total) ? page.total : (page.items?.length ?? 0);
    this.#inspectorDrawer.setFindingsPage(page, { append });
    this.#renderTopBar();
  }

  /**
   * @param {string} campaignId
   * @param {{after?: string | null, append?: boolean}} [options]
   * @returns {Promise<void>}
   */
  async #refreshRulings(campaignId, { after = null, append = false } = {}) {
    const page = await this.#api.getMemory(campaignId, {
      section: 'rulings',
      limit: 25,
      after,
    });
    this.#inspectorDrawer.setRulingsPage(page, { append });
  }

  /**
   * @param {{text?: string, mode?: 'normal' | 'narrator' | 'encounter', oocNudge?: string | null, regenerating?: boolean}} options
   * @returns {Promise<void>}
   */
  async #executeSseTurn({ text = '', mode = 'normal', oocNudge = null, regenerating = false }) {
    const campaign = this.#getActiveCampaign();
    if (campaign === null || this.#activeTurnController !== null) {
      return;
    }

    const campaignId = campaign.id;
    const controller = new AbortController();
    this.#activeTurnController = controller;
    this.#composerBar.setStreaming(true);
    this.#composerBar.setAlert(null);
    this.#composerBar.setPhase(regenerating ? 'Regenerating...' : 'Starting...');
    this.#renderTopBar();

    const playerCharacter = campaign.playerCharacterId
      ? this.#activeCharacters.find((character) => character.id === campaign.playerCharacterId && !character.archived) ?? null
      : null;
    const isNarratorMode = mode === 'narrator' || /^[\s*_]*narrator:\s*/i.test(text);
    const previewUserText = mode === 'encounter' && text.trim().length === 0
      ? '*(Encounter)*'
      : text.replace(/^[\s*_]*narrator:\s*/i, '').trim();

    this.#chatView.startStreaming({
      regenerating,
      userText: previewUserText,
      userSpeakerType: isNarratorMode || playerCharacter === null ? 'narrator' : 'player',
      userCharacterId: isNarratorMode || playerCharacter === null ? null : playerCharacter.id,
      userSpeakerName: isNarratorMode || playerCharacter === null ? 'Narrator' : playerCharacter.name,
      oocNudge,
      mode,
    });

    let turnCommitted = false;
    try {
      const onEvent = async ({ event, data }) => {
        if (this.#activeCampaignId !== campaignId) {
          return;
        }
        switch (event) {
          case 'phase': {
            const phaseName = data?.phase;
            if (phaseName === 'directing') {
              this.#composerBar.setPhase('Directing...');
            } else if (phaseName === 'director_done') {
              this.#composerBar.setPhase('Scene planned...');
            } else if (phaseName === 'minds') {
              const names = Array.isArray(data?.names) ? data.names.filter((name) => typeof name === 'string') : [];
              this.#composerBar.setPhase(
                names.length > 0 ? `Thinking: ${names.join(', ')}...` : 'Thinking...',
              );
            } else if (phaseName === 'composing') {
              this.#composerBar.setPhase('Composing...');
            }
            break;
          }
          case 'beat_delta': {
            this.#chatView.appendStreamDelta(data);
            break;
          }
          case 'committed': {
            turnCommitted = true;
            const currentCampaign = this.#getActiveCampaign();
            if (currentCampaign !== null && data?.sceneState) {
              this.#applyUpdatedCampaign({
                ...currentCampaign,
                sceneState: data.sceneState,
              });
            }
            if (data?.userTurn && data?.assistantTurn) {
              this.#chatView.commitStream({
                userTurn: data.userTurn,
                assistantTurn: data.assistantTurn,
              });
            }
            if (!regenerating) {
              this.#composerBar.clearDraft();
            }
            break;
          }
          case 'findings': {
            await this.#refreshFindings(campaignId);
            break;
          }
          case 'memory_updated': {
            await Promise.all([
              this.#refreshMemory(campaignId),
              this.#refreshRulings(campaignId),
            ]);
            break;
          }
          case 'warning': {
            const stagePrefix = typeof data?.stage === 'string' && data.stage.length > 0 ? `[${data.stage}] ` : '';
            const warnText = `${stagePrefix}${typeof data?.message === 'string' ? data.message : 'Warning'}`;
            this.#composerBar.setAlert(warnText, { level: 'warning' });
            break;
          }
          case 'done': {
            const currentCampaign = this.#getActiveCampaign();
            if (currentCampaign !== null && data?.sceneState) {
              this.#applyUpdatedCampaign({
                ...currentCampaign,
                sceneState: data.sceneState,
              });
            }
            await Promise.all([
              this.#refreshFindings(campaignId),
              this.#refreshMemory(campaignId),
              this.#refreshRulings(campaignId),
            ]);
            break;
          }
        }
      };

      if (regenerating) {
        await this.#api.regenerateLastTurn(campaignId, {
          onEvent,
          signal: controller.signal,
        });
      } else {
        await this.#api.runTurn(campaignId, { text, mode, oocNudge }, {
          onEvent,
          signal: controller.signal,
        });
      }
    } catch (turnError) {
      this.#chatView.clearStreaming();
      if (turnError instanceof Error && turnError.name === 'AbortError') {
        this.#composerBar.setAlert(
          turnCommitted
            ? 'Post-turn checks stopped (turn was already committed).'
            : 'Turn stopped. No changes were committed.',
          { level: 'info' },
        );
      } else {
        this.#composerBar.setAlert(
          turnError instanceof Error ? turnError.message : String(turnError),
          { level: 'error' },
        );
      }
    } finally {
      await this.#refreshHealth();
      this.#activeTurnController = null;
      this.#composerBar.setStreaming(false);
      this.#composerBar.setPhase(null);
      this.#renderTopBar();
    }
  }
}

if (typeof document !== 'undefined') {
  const appRoot = document.getElementById('app');
  if (appRoot !== null) {
    const appInstance = new WorldsApp({
      api: new WorldsApi({ documentRef: document }),
      rootElement: appRoot,
      documentRef: document,
    });
    void appInstance.init();
  }
}
