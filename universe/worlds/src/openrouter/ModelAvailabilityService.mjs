import { ModelAvailability } from './ModelAvailability.mjs';
import { ModelCatalog } from './ModelCatalog.mjs';

export class ModelAvailabilityService {
  static #Slots = Object.freeze(['director', 'composer', 'main', 'recurring', 'scribe']);

  #modelCatalog;
  #store;
  #scribeService;

  /**
   * @param {{modelCatalog: ModelCatalog, store: object, scribeService: object}} options
   * @throws {TypeError}
   */
  constructor({ modelCatalog, store, scribeService } = {}) {
    if (
      modelCatalog === null ||
      typeof modelCatalog !== 'object' ||
      typeof modelCatalog.checkModel !== 'function' ||
      typeof modelCatalog.modelStatus !== 'function' ||
      typeof modelCatalog.modelCheckedAt !== 'function'
    ) {
      throw new TypeError('modelCatalog must provide checkModel(), modelStatus() and modelCheckedAt().');
    }
    if (store === null || typeof store !== 'object' || typeof store.getSettings !== 'function') {
      throw new TypeError('store must provide getSettings().');
    }
    if (
      scribeService === null ||
      typeof scribeService !== 'object' ||
      typeof scribeService.listAllCharacters !== 'function'
    ) {
      throw new TypeError('scribeService must provide listAllCharacters().');
    }
    this.#modelCatalog = modelCatalog;
    this.#store = store;
    this.#scribeService = scribeService;
  }

  /**
   * @param {Record<string, string>} nextModels
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<{refusals: string[], warnings: string[]}>}
   * @throws {Error}
   */
  async checkSlotChanges(nextModels, { signal = null } = {}) {
    const storedModels = this.#store.getSettings().models;
    const changedSlots = ModelAvailabilityService.#Slots
      .filter((slotName) => typeof nextModels[slotName] === 'string')
      .map((slotName) => ({ slotName, modelId: nextModels[slotName].trim() }))
      .filter((entry) => entry.modelId.length > 0 && entry.modelId !== storedModels[entry.slotName].trim());

    const outcomes = await Promise.all(changedSlots.map(async (entry) => {
      if (!ModelCatalog.isValidModelId(entry.modelId)) {
        return {
          refusal: `the ${entry.slotName} slot model '${entry.modelId}' is not a valid OpenRouter model ID`,
          warnings: [],
        };
      }
      const result = await this.#modelCatalog.checkModel(entry.modelId, { signal });
      return ModelAvailabilityService.#interpretResult(result, {
        refusal: `the ${entry.slotName} slot model ${entry.modelId} is not served by any OpenRouter provider`,
        warning: `The ${entry.slotName} slot model ${entry.modelId} could not be checked: `,
      });
    }));
    return ModelAvailabilityService.#collect(outcomes);
  }

  /**
   * @param {string} characterName
   * @param {string | null} storedOverride
   * @param {string | null} nextOverride
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<{refusals: string[], warnings: string[]}>}
   * @throws {Error}
   */
  async checkOverrideChange(characterName, storedOverride, nextOverride, { signal = null } = {}) {
    const nextId = typeof nextOverride === 'string' ? nextOverride.trim() : '';
    const storedId = typeof storedOverride === 'string' ? storedOverride.trim() : '';
    if (nextId.length === 0 || nextId === storedId) {
      return { refusals: [], warnings: [] };
    }
    if (!ModelCatalog.isValidModelId(nextId)) {
      return ModelAvailabilityService.#collect([{
        refusal: `${characterName}'s model override '${nextId}' is not a valid OpenRouter model ID`,
        warnings: [],
      }]);
    }
    const result = await this.#modelCatalog.checkModel(nextId, { signal });
    return ModelAvailabilityService.#collect([
      ModelAvailabilityService.#interpretResult(result, {
        refusal: `${characterName}'s model override ${nextId} is not served by any OpenRouter provider`,
        warning: `${characterName}'s model override ${nextId} could not be checked: `,
      }),
    ]);
  }

  /**
   * @param {string} campaignId
   * @returns {string | null}
   * @throws {RangeError}
   */
  blockingMessage(campaignId) {
    const parts = [];
    const models = this.#store.getSettings().models;
    for (const slotName of ModelAvailabilityService.#Slots) {
      const modelId = models[slotName];
      if (modelId.length > 0 && this.#modelCatalog.modelStatus(modelId) === ModelAvailability.Unserved) {
        parts.push(
          `the ${slotName} slot uses ${modelId}, which no OpenRouter provider serves (checked ${this.#modelCatalog.modelCheckedAt(modelId)})`,
        );
      }
    }
    for (const character of this.#scribeService.listAllCharacters(campaignId)) {
      const modelId = character.modelOverride;
      if (
        character.archived !== true &&
        typeof modelId === 'string' &&
        modelId.length > 0 &&
        this.#modelCatalog.modelStatus(modelId) === ModelAvailability.Unserved
      ) {
        parts.push(
          `${character.name}'s model override ${modelId} is not served by any OpenRouter provider (checked ${this.#modelCatalog.modelCheckedAt(modelId)})`,
        );
      }
    }
    if (parts.length === 0) {
      return null;
    }
    return `Refused: ${parts.join('; ')}. Change it in Settings or the character window.`;
  }

  /**
   * @param {{outcome: string, reason: string | null, cacheWarning: string | null}} result
   * @param {{refusal: string, warning: string}} texts
   * @returns {{refusal: string | null, warnings: string[]}}
   */
  static #interpretResult(result, { refusal, warning }) {
    const warnings = [];
    let refusalText = null;
    if (result.outcome === ModelAvailability.Unserved) {
      refusalText = refusal;
    } else if (result.outcome === ModelAvailability.Unchecked) {
      warnings.push(`${warning}${result.reason}.`);
    }
    if (result.cacheWarning !== null) {
      warnings.push(result.cacheWarning);
    }
    return { refusal: refusalText, warnings };
  }

  /**
   * @param {Array<{refusal: string | null, warnings: string[]}>} outcomes
   * @returns {{refusals: string[], warnings: string[]}}
   */
  static #collect(outcomes) {
    const parts = outcomes.map((outcome) => outcome.refusal).filter((refusal) => refusal !== null);
    return {
      refusals: parts.length > 0 ? [`Not saved: ${parts.join('; ')}.`] : [],
      warnings: outcomes.flatMap((outcome) => outcome.warnings),
    };
  }
}
