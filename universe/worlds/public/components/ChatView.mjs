export class ChatView {
  static #NarrationTagPattern = /<narration>([\s\S]*?)<\/narration>/gi;
  static #NarrationClass = 'beat-narration';
  static #NarratorType = 'narrator';
  static #NarratorName = 'Narrator';
  static #EncounterText = '*(Encounter)*';
  static #ValidTokens = new Set(['sage', 'rose', 'amber', 'slate', 'plum', 'teal', 'indigo', 'coral']);

  #container;
  #documentRef;
  #onLoadEarlier;
  #onRegenerate;
  #onSaveEdit;
  #onRequestDelete;

  #hasCampaign = false;
  #turns = [];
  #totalTurns = 0;
  #nextCursor = null;
  #loadingEarlier = false;
  #charactersById = new Map();
  #charactersBySlug = new Map();

  #streamingState = null;
  #streamingBeatElements = new Map();
  #streamingListElement = null;

  #editingTurnId = null;
  #editingBeatId = null;
  #editingText = '';
  #savingEdit = false;
  #editError = '';
  #actionBusy = false;

  /**
   * @param {{container: HTMLElement, documentRef?: Document | null, onLoadEarlier: () => Promise<void> | void, onRegenerate: () => Promise<void> | void, onSaveEdit: (turnId: string, payload: {text: string, beatId: string | null}) => Promise<void>, onRequestDelete: () => void}} options
   * @throws {TypeError}
   */
  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('ChatView options must be a plain object.');
    }
    const {
      container,
      documentRef = null,
      onLoadEarlier,
      onRegenerate,
      onSaveEdit,
      onRequestDelete,
    } = options;
    if (container === null || typeof container !== 'object') {
      throw new TypeError('container element is required.');
    }
    if (
      typeof onLoadEarlier !== 'function' ||
      typeof onRegenerate !== 'function' ||
      typeof onSaveEdit !== 'function' ||
      typeof onRequestDelete !== 'function'
    ) {
      throw new TypeError('ChatView callbacks are required.');
    }
    this.#container = container;
    this.#documentRef = documentRef ?? (typeof document !== 'undefined' ? document : null);
    this.#onLoadEarlier = onLoadEarlier;
    this.#onRegenerate = onRegenerate;
    this.#onSaveEdit = onSaveEdit;
    this.#onRequestDelete = onRequestDelete;
  }

  /**
   * @param {boolean} hasCampaign
   * @returns {void}
   */
  setCampaignActive(hasCampaign) {
    this.#hasCampaign = Boolean(hasCampaign);
    if (!this.#hasCampaign) {
      this.#turns = [];
      this.#totalTurns = 0;
      this.#nextCursor = null;
      this.#streamingState = null;
      this.#editingTurnId = null;
    }
    this.render();
  }

  /**
   * @param {Array<object>} characters
   * @returns {void}
   */
  setCharacters(characters) {
    this.#charactersById = new Map();
    this.#charactersBySlug = new Map();
    if (Array.isArray(characters)) {
      for (const character of characters) {
        if (character === null || typeof character !== 'object') {
          continue;
        }
        if (typeof character.id === 'string') {
          this.#charactersById.set(character.id, character);
        }
        if (typeof character.slug === 'string') {
          this.#charactersBySlug.set(character.slug.trim().toLowerCase(), character);
        }
      }
    }
    this.render();
  }

  /**
   * @param {{items: Array<object>, total: number, nextCursor: number | null}} pageData
   * @returns {void}
   */
  setTurnsPage({ items, total, nextCursor }) {
    const ascending = Array.isArray(items) ? [...items].sort((leftTurn, rightTurn) => leftTurn.seq - rightTurn.seq) : [];
    this.#turns = ascending;
    this.#totalTurns = Number.isInteger(total) ? total : ascending.length;
    this.#nextCursor = nextCursor ?? null;
    this.#loadingEarlier = false;
    this.#editingTurnId = null;
    this.#editError = '';
    this.render();
    this.#scrollToBottom();
  }

  /**
   * @param {{items: Array<object>, total: number, nextCursor: number | null}} pageData
   * @returns {void}
   */
  prependTurnsPage({ items, total, nextCursor }) {
    const previousHeight = Number(this.#container.scrollHeight ?? 0);
    const previousTop = Number(this.#container.scrollTop ?? 0);

    const existingIds = new Set(this.#turns.map((turn) => turn.id));
    const earlier = Array.isArray(items)
      ? items
          .filter((turn) => !existingIds.has(turn.id))
          .sort((leftTurn, rightTurn) => leftTurn.seq - rightTurn.seq)
      : [];
    this.#turns = [...earlier, ...this.#turns].sort((leftTurn, rightTurn) => leftTurn.seq - rightTurn.seq);
    this.#totalTurns = Number.isInteger(total) ? total : this.#turns.length;
    this.#nextCursor = nextCursor ?? null;
    this.#loadingEarlier = false;
    this.render();

    const nextHeight = Number(this.#container.scrollHeight ?? 0);
    if (Number.isFinite(previousHeight) && Number.isFinite(nextHeight) && nextHeight > previousHeight) {
      this.#container.scrollTop = previousTop + (nextHeight - previousHeight);
    }
  }

  /**
   * @param {boolean} loading
   * @returns {void}
   */
  setLoadingEarlier(loading) {
    this.#loadingEarlier = Boolean(loading);
    this.render();
  }

  /**
   * @param {boolean} busy
   * @returns {void}
   */
  setActionBusy(busy) {
    this.#actionBusy = Boolean(busy);
    this.render();
  }

  /**
   * @param {{userText?: string, userSpeakerName?: string, userCharacterId?: string | null, userSpeakerType?: string, oocNudge?: string | null, mode?: string, narrationText?: string, regenerating?: boolean}} options
   * @returns {void}
   */
  startStreaming({
    userText = '',
    userSpeakerName = 'Narrator',
    userCharacterId = null,
    userSpeakerType = 'narrator',
    oocNudge = null,
    mode = 'normal',
    narrationText = '',
    regenerating = false,
  } = {}) {
    this.#editingTurnId = null;
    this.#streamingBeatElements = new Map();
    this.#streamingState = {
      regenerating: Boolean(regenerating),
      userText,
      userSpeakerName,
      userCharacterId,
      userSpeakerType,
      oocNudge,
      mode,
      narrationText,
      beats: [],
    };
    this.render();
    this.#scrollToBottom();
  }

  /**
   * @param {{beatIndex: number, speakerType: string, slug: string, speakerName: string, delta: string}} deltaPacket
   * @returns {void}
   */
  appendStreamDelta(deltaPacket) {
    if (this.#streamingState === null || deltaPacket === null || typeof deltaPacket !== 'object') {
      return;
    }
    const beatIndex = Number.isInteger(deltaPacket.beatIndex) ? deltaPacket.beatIndex : 0;
    const deltaText = typeof deltaPacket.delta === 'string' ? deltaPacket.delta : '';
    let beatEntry = this.#streamingState.beats[beatIndex];
    if (beatEntry === undefined) {
      beatEntry = {
        beatIndex,
        speakerType: deltaPacket.speakerType || 'narrator',
        slug: deltaPacket.slug || 'narrator',
        speakerName: deltaPacket.speakerName || 'Narrator',
        text: deltaText,
      };
      this.#streamingState.beats[beatIndex] = beatEntry;

      if (this.#streamingListElement !== null && this.#documentRef !== null) {
        const rendered = this.#createBeatRow({
          speakerType: beatEntry.speakerType,
          characterId: null,
          slug: beatEntry.slug,
          speakerName: beatEntry.speakerName,
          text: beatEntry.text,
        });
        this.#streamingBeatElements.set(beatIndex, rendered.textElement);
        this.#streamingListElement.append(rendered.rowElement);
      } else {
        this.render();
      }
    } else {
      beatEntry.text += deltaText;
      const textElement = this.#streamingBeatElements.get(beatIndex);
      if (textElement !== undefined) {
        textElement.textContent = beatEntry.text;
      } else {
        this.render();
      }
    }
    this.#scrollToBottom();
  }

  /**
   * @param {{userTurn: object, assistantTurn: object}} committedPair
   * @returns {void}
   */
  commitStream({ userTurn, assistantTurn }) {
    const wasRegenerating = this.#streamingState?.regenerating === true;
    this.#streamingState = null;
    this.#streamingBeatElements = new Map();
    this.#streamingListElement = null;

    if (wasRegenerating) {
      if (this.#turns.length >= 2) {
        this.#turns = [...this.#turns.slice(0, -2), userTurn, assistantTurn];
      } else {
        this.#turns = [userTurn, assistantTurn];
      }
    } else {
      this.#turns = [...this.#turns, userTurn, assistantTurn];
      this.#totalTurns += 2;
    }
    this.render();
    this.#scrollToBottom();
  }

  /**
   * @returns {void}
   */
  clearStreaming() {
    this.#streamingState = null;
    this.#streamingBeatElements = new Map();
    this.#streamingListElement = null;
    this.render();
  }

  /**
   * @param {object} updatedTurn
   * @returns {void}
   */
  replaceTurn(updatedTurn) {
    if (updatedTurn === null || typeof updatedTurn !== 'object') {
      return;
    }
    this.#turns = this.#turns.map((turn) => (turn.id === updatedTurn.id ? updatedTurn : turn));
    if (this.#editingTurnId === updatedTurn.id) {
      this.#editingTurnId = null;
      this.#editingBeatId = null;
      this.#editingText = '';
      this.#savingEdit = false;
      this.#editError = '';
    }
    this.render();
  }

  /**
   * @returns {void}
   */
  removeLastTurnPair() {
    if (this.#turns.length >= 2) {
      this.#turns = this.#turns.slice(0, -2);
    } else {
      this.#turns = [];
    }
    this.#totalTurns = Math.max(0, this.#totalTurns - 2);
    this.#editingTurnId = null;
    this.render();
  }

  /**
   * @returns {void}
   */
  render() {
    if (this.#documentRef === null) {
      return;
    }

    this.#streamingBeatElements = new Map();
    this.#streamingListElement = null;

    const nodes = [];

    if (!this.#hasCampaign) {
      const emptyBox = this.#documentRef.createElement('div');
      emptyBox.className = 'empty-state';
      const title = this.#documentRef.createElement('h2');
      title.className = 'empty-state-title';
      title.textContent = 'No campaign selected';
      const copy = this.#documentRef.createElement('p');
      copy.className = 'empty-state-copy';
      copy.textContent = 'Create a new campaign from the top bar to start playing.';
      emptyBox.append(title, copy);
      this.#container.replaceChildren(emptyBox);
      return;
    }

    if (this.#turns.length > 0 || this.#nextCursor !== null) {
      const historyBar = this.#documentRef.createElement('div');
      historyBar.className = 'chat-history-bar';

      const countLabel = this.#documentRef.createElement('span');
      countLabel.className = 'item-meta';
      countLabel.textContent = `Showing ${this.#turns.length} of ${this.#totalTurns} turns`;
      historyBar.append(countLabel);

      if (this.#nextCursor !== null) {
        const loadButton = this.#documentRef.createElement('button');
        loadButton.type = 'button';
        loadButton.className = this.#loadingEarlier ? 'btn btn-secondary btn-compact is-loading' : 'btn btn-secondary btn-compact';
        loadButton.disabled = this.#loadingEarlier;
        loadButton.textContent = this.#loadingEarlier ? 'Loading earlier...' : 'Load earlier';
        loadButton.addEventListener('click', () => {
          if (!this.#loadingEarlier) {
            void this.#onLoadEarlier();
          }
        });
        historyBar.append(loadButton);
      }

      nodes.push(historyBar);
    }

    if (this.#turns.length === 0 && this.#streamingState === null) {
      const emptyBox = this.#documentRef.createElement('div');
      emptyBox.className = 'empty-state';
      const title = this.#documentRef.createElement('h2');
      title.className = 'empty-state-title';
      title.textContent = 'Opening scene';
      const copy = this.#documentRef.createElement('p');
      copy.className = 'empty-state-copy';
      copy.textContent = 'Add cast members in the Inspector or send your opening action below.';
      emptyBox.append(title, copy);
      nodes.push(emptyBox);
      this.#container.replaceChildren(...nodes);
      return;
    }

    const visibleTurns = this.#streamingState?.regenerating === true && this.#turns.length > 0 && this.#turns[this.#turns.length - 1].role === 'assistant'
      ? this.#turns.slice(0, -1)
      : this.#turns;

    const latestAssistantTurn = [...visibleTurns].reverse().find((turn) => turn.role === 'assistant') ?? null;

    for (const turn of visibleTurns) {
      const turnCard = this.#documentRef.createElement('article');
      turnCard.className = `turn-card turn-role-${turn.role === 'user' ? 'user' : 'assistant'}`;
      turnCard.setAttribute('data-turn-id', String(turn.id));

      const header = this.#documentRef.createElement('div');
      header.className = 'turn-header';

      const metaLeft = this.#documentRef.createElement('div');
      metaLeft.className = 'turn-meta';

      const seqSpan = this.#documentRef.createElement('span');
      seqSpan.textContent = `#${turn.seq} · Scene ${turn.sceneNumber}`;
      metaLeft.append(seqSpan);

      if (turn.mode === 'narrator' || turn.mode === 'encounter') {
        const modePill = this.#documentRef.createElement('span');
        modePill.className = turn.mode === 'encounter' ? 'tag-pill is-warning' : 'tag-pill';
        modePill.textContent = turn.mode === 'encounter' ? 'Encounter' : 'Narrator';
        metaLeft.append(modePill);
      }

      if (turn.truncated === true) {
        const truncatedPill = this.#documentRef.createElement('span');
        truncatedPill.className = 'tag-pill is-warning';
        truncatedPill.textContent = 'Truncated at model length limit';
        metaLeft.append(truncatedPill);
      }

      const editTrigger = this.#documentRef.createElement('button');
      editTrigger.type = 'button';
      editTrigger.className = 'btn btn-ghost btn-compact';
      editTrigger.textContent = 'Edit';
      editTrigger.disabled = this.#streamingState !== null || this.#actionBusy;
      editTrigger.addEventListener('click', () => {
        const beats = Array.isArray(turn.beats) ? turn.beats : [];
        const firstBeat = beats[0] ?? null;
        this.#editingTurnId = turn.id;
        this.#editingBeatId = firstBeat?.id ?? null;
        this.#editingText = firstBeat?.text ?? turn.rawText ?? '';
        this.#editError = '';
        this.render();
      });

      header.append(metaLeft, editTrigger);
      turnCard.append(header);

      if (turn.role === 'user' && typeof turn.oocNudge === 'string' && turn.oocNudge.trim().length > 0) {
        const oocPill = this.#documentRef.createElement('div');
        oocPill.className = 'turn-ooc-pill';
        oocPill.textContent = `OOC: ${turn.oocNudge}`;
        turnCard.append(oocPill);
      }

      if (this.#editingTurnId === turn.id) {
        const editorForm = this.#documentRef.createElement('form');
        editorForm.className = 'inline-editor';
        const beats = Array.isArray(turn.beats) ? turn.beats : [];

        if (beats.length > 1) {
          const beatGroup = this.#documentRef.createElement('div');
          beatGroup.className = 'field-group';
          const beatLabel = this.#documentRef.createElement('label');
          beatLabel.className = 'field-label';
          beatLabel.setAttribute('for', `edit-beat-select-${turn.id}`);
          beatLabel.textContent = 'Beat to edit';

          const beatSelect = this.#documentRef.createElement('select');
          beatSelect.id = `edit-beat-select-${turn.id}`;
          beatSelect.className = 'field-control';
          beatSelect.disabled = this.#savingEdit;
          for (let beatIdx = 0; beatIdx < beats.length; beatIdx += 1) {
            const beatItem = beats[beatIdx];
            const option = this.#documentRef.createElement('option');
            option.value = beatItem.id;
            option.textContent = `Beat ${beatIdx + 1}: ${beatItem.speakerName}`;
            beatSelect.append(option);
          }
          beatSelect.value = this.#editingBeatId ?? beats[0].id;
          beatSelect.addEventListener('change', () => {
            this.#editingBeatId = beatSelect.value;
            const selectedBeat = beats.find((entry) => entry.id === beatSelect.value);
            this.#editingText = selectedBeat?.text ?? '';
            this.render();
          });
          beatGroup.append(beatLabel, beatSelect);
          editorForm.append(beatGroup);
        }

        const editArea = this.#documentRef.createElement('textarea');
        editArea.rows = 4;
        editArea.className = 'field-control';
        editArea.value = this.#editingText;
        editArea.disabled = this.#savingEdit;
        editArea.addEventListener('input', () => {
          this.#editingText = editArea.value;
        });
        editorForm.append(editArea);

        if (this.#editError.length > 0) {
          const errorBox = this.#documentRef.createElement('div');
          errorBox.className = 'inline-alert is-danger';
          errorBox.setAttribute('role', 'alert');
          errorBox.textContent = this.#editError;
          editorForm.append(errorBox);
        }

        const editorButtons = this.#documentRef.createElement('div');
        editorButtons.className = 'action-row-end';

        const cancelEditBtn = this.#documentRef.createElement('button');
        cancelEditBtn.type = 'button';
        cancelEditBtn.className = 'btn btn-secondary btn-compact';
        cancelEditBtn.textContent = 'Cancel';
        cancelEditBtn.disabled = this.#savingEdit;
        cancelEditBtn.addEventListener('click', () => {
          if (!this.#savingEdit) {
            this.#editingTurnId = null;
            this.#editError = '';
            this.render();
          }
        });

        const saveEditBtn = this.#documentRef.createElement('button');
        saveEditBtn.type = 'submit';
        saveEditBtn.className = this.#savingEdit ? 'btn btn-primary btn-compact is-loading' : 'btn btn-primary btn-compact';
        saveEditBtn.textContent = this.#savingEdit ? 'Saving...' : 'Save';
        saveEditBtn.disabled = this.#savingEdit;

        editorButtons.append(cancelEditBtn, saveEditBtn);
        editorForm.append(editorButtons);

        editorForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (this.#savingEdit) {
            return;
          }
          if (this.#editingText.trim().length === 0) {
            this.#editError = 'Edited text must not be empty.';
            this.render();
            return;
          }
          this.#savingEdit = true;
          this.#editError = '';
          this.render();
          try {
            await this.#onSaveEdit(turn.id, {
              text: this.#editingText,
              beatId: this.#editingBeatId,
            });
          } catch (saveError) {
            this.#editError = saveError instanceof Error ? saveError.message : String(saveError);
          } finally {
            if (this.#savingEdit) {
              this.#savingEdit = false;
              this.render();
            }
          }
        });

        turnCard.append(editorForm);
      } else {
        const beatList = this.#documentRef.createElement('div');
        beatList.className = 'beat-list';
        const beats = Array.isArray(turn.beats) && turn.beats.length > 0
          ? turn.beats
          : [{
              speakerType: turn.role === 'user' ? 'player' : 'narrator',
              characterId: null,
              speakerName: turn.role === 'user' ? 'Player' : 'Narrator',
              text: turn.rawText ?? '',
            }];

        for (const beat of beats) {
          const renderedBeat = this.#createBeatRow({
            speakerType: beat.speakerType,
            characterId: beat.characterId ?? null,
            slug: null,
            speakerName: beat.speakerName,
            text: beat.text,
          });
          beatList.append(renderedBeat.rowElement);
        }
        turnCard.append(beatList);
      }

      if (latestAssistantTurn !== null && turn.id === latestAssistantTurn.id && this.#streamingState === null) {
        const actionBar = this.#documentRef.createElement('div');
        actionBar.className = 'turn-actions';

        const regenBtn = this.#documentRef.createElement('button');
        regenBtn.type = 'button';
        regenBtn.className = this.#actionBusy ? 'btn btn-secondary btn-compact is-loading' : 'btn btn-secondary btn-compact';
        regenBtn.textContent = 'Regenerate';
        regenBtn.disabled = this.#actionBusy;
        regenBtn.addEventListener('click', () => {
          if (!this.#actionBusy) {
            void this.#onRegenerate();
          }
        });

        const deleteBtn = this.#documentRef.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn is-danger btn-compact';
        deleteBtn.textContent = 'Delete';
        deleteBtn.disabled = this.#actionBusy;
        deleteBtn.addEventListener('click', () => {
          if (!this.#actionBusy) {
            this.#onRequestDelete();
          }
        });

        actionBar.append(regenBtn, deleteBtn);
        turnCard.append(actionBar);
      }

      nodes.push(turnCard);
    }

    if (this.#streamingState !== null) {
      const streamState = this.#streamingState;
      if (!streamState.regenerating) {
        const previewUserCard = this.#documentRef.createElement('article');
        previewUserCard.className = 'turn-card turn-role-user turn-streaming';

        const userHeader = this.#documentRef.createElement('div');
        userHeader.className = 'turn-header';
        const userMeta = this.#documentRef.createElement('span');
        userMeta.textContent = streamState.mode === 'encounter' ? 'Pending turn · Encounter' : 'Pending turn';
        userHeader.append(userMeta);
        previewUserCard.append(userHeader);

        if (typeof streamState.oocNudge === 'string' && streamState.oocNudge.trim().length > 0) {
          const oocPill = this.#documentRef.createElement('div');
          oocPill.className = 'turn-ooc-pill';
          oocPill.textContent = `OOC: ${streamState.oocNudge}`;
          previewUserCard.append(oocPill);
        }

        const userBeatList = this.#documentRef.createElement('div');
        userBeatList.className = 'beat-list';
        const segments = [];
        let cursor = 0;
        for (const match of streamState.userText.matchAll(ChatView.#NarrationTagPattern)) {
          segments.push(
            { text: streamState.userText.slice(cursor, match.index).trim(), narration: false },
            { text: match[1].trim(), narration: true },
          );
          cursor = match.index + match[0].length;
        }
        segments.push(
          { text: streamState.userText.slice(cursor).trim(), narration: false },
          { text: streamState.narrationText.trim(), narration: true },
        );
        const shownSegments = segments.filter((segment) => segment.text.length > 0);
        const isEncounter = streamState.mode === 'encounter';
        if (isEncounter && !shownSegments.some((segment) => !segment.narration)) {
          shownSegments.unshift({ text: ChatView.#EncounterText, narration: false });
        }
        const narrationOnly = !isEncounter && shownSegments.length > 0 &&
          shownSegments.every((segment) => segment.narration);
        const userRendered = this.#createBeatRow({
          speakerType: narrationOnly ? ChatView.#NarratorType : streamState.userSpeakerType,
          characterId: narrationOnly ? null : streamState.userCharacterId,
          slug: null,
          speakerName: narrationOnly ? ChatView.#NarratorName : streamState.userSpeakerName,
          text: '',
        });
        userRendered.textElement.replaceChildren(
          ...shownSegments.map((segment) => {
            const spanElement = this.#documentRef.createElement('span');
            if (segment.narration) {
              spanElement.className = ChatView.#NarrationClass;
            }
            spanElement.textContent = segment.text;
            return spanElement;
          }),
        );
        userBeatList.append(userRendered.rowElement);
        previewUserCard.append(userBeatList);
        nodes.push(previewUserCard);
      }

      const previewAssistantCard = this.#documentRef.createElement('article');
      previewAssistantCard.className = 'turn-card turn-role-assistant turn-streaming';

      const assistantHeader = this.#documentRef.createElement('div');
      assistantHeader.className = 'turn-header';
      const assistantMeta = this.#documentRef.createElement('span');
      assistantMeta.textContent = streamState.regenerating ? 'Regenerating reply...' : 'Composing reply...';
      assistantHeader.append(assistantMeta);
      previewAssistantCard.append(assistantHeader);

      const streamList = this.#documentRef.createElement('div');
      streamList.className = 'beat-list';
      this.#streamingListElement = streamList;

      for (const beatEntry of streamState.beats) {
        if (beatEntry === undefined) {
          continue;
        }
        const renderedBeat = this.#createBeatRow({
          speakerType: beatEntry.speakerType,
          characterId: null,
          slug: beatEntry.slug,
          speakerName: beatEntry.speakerName,
          text: beatEntry.text,
        });
        this.#streamingBeatElements.set(beatEntry.beatIndex, renderedBeat.textElement);
        streamList.append(renderedBeat.rowElement);
      }

      previewAssistantCard.append(streamList);
      nodes.push(previewAssistantCard);
    }

    this.#container.replaceChildren(...nodes);
  }

  /**
   * @param {{speakerType: string, characterId: string | null, slug: string | null, speakerName: string, text: string}} beatData
   * @returns {{rowElement: HTMLElement, textElement: HTMLElement}}
   */
  #createBeatRow({ speakerType, characterId, slug, speakerName, text }) {
    const rowElement = this.#documentRef.createElement('div');
    rowElement.className = 'beat-row';

    let tokenClass = 'avatar-slate';
    let initials = '';

    if (speakerType === 'narrator') {
      tokenClass = 'avatar-narrator';
      initials = 'NR';
    } else {
      let matchedChar = null;
      if (typeof characterId === 'string' && this.#charactersById.has(characterId)) {
        matchedChar = this.#charactersById.get(characterId);
      } else if (typeof slug === 'string' && this.#charactersBySlug.has(slug.trim().toLowerCase())) {
        matchedChar = this.#charactersBySlug.get(slug.trim().toLowerCase());
      }
      if (matchedChar !== null) {
        tokenClass = ChatView.#ValidTokens.has(matchedChar.avatarToken)
          ? `avatar-${matchedChar.avatarToken}`
          : matchedChar.isPlayer
            ? 'avatar-player'
            : 'avatar-slate';
        initials = typeof matchedChar.avatarInitials === 'string' && matchedChar.avatarInitials.trim().length > 0
          ? matchedChar.avatarInitials.trim()
          : '';
      } else if (speakerType === 'player') {
        tokenClass = 'avatar-player';
      }
    }

    if (initials.length === 0) {
      const safeName = typeof speakerName === 'string' && speakerName.trim().length > 0 ? speakerName.trim() : 'Speaker';
      const parts = safeName.split(/\s+/);
      initials = parts.length >= 2
        ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
        : parts[0].slice(0, 2).toUpperCase();
    }

    const avatarElement = this.#documentRef.createElement('span');
    avatarElement.className = `avatar-badge ${tokenClass}`;
    avatarElement.setAttribute('aria-hidden', 'true');
    avatarElement.textContent = initials;

    const bodyElement = this.#documentRef.createElement('div');
    bodyElement.className = 'beat-body';

    const speakerElement = this.#documentRef.createElement('div');
    speakerElement.className = 'beat-speaker';
    speakerElement.textContent = typeof speakerName === 'string' ? speakerName : 'Speaker';

    const textElement = this.#documentRef.createElement('div');
    textElement.className = 'beat-text';
    textElement.textContent = typeof text === 'string' ? text : '';

    bodyElement.append(speakerElement, textElement);
    rowElement.append(avatarElement, bodyElement);
    return { rowElement, textElement };
  }

  /**
   * @returns {void}
   */
  #scrollToBottom() {
    if (typeof this.#container.scrollHeight === 'number') {
      this.#container.scrollTop = this.#container.scrollHeight;
    }
  }
}
