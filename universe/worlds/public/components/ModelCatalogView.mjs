export class ModelCatalogView {
  static LoadingText = 'Loading OpenRouter catalog...';
  static UnavailableText = 'OpenRouter models: 0 (unavailable)';
  static SelectPlaceholder = 'Select an OpenRouter model...';
  static RefreshLabel = 'Refresh OpenRouter models';
  static RefreshBusyLabel = 'Loading catalog...';
  static #ModeratedLabel = 'moderated';
  static #GroupTitle = 'OpenRouter Catalog';

  /**
   * @param {unknown} filterQuery
   * @returns {string}
   */
  static #normalizeFilter(filterQuery) {
    return typeof filterQuery === 'string' ? filterQuery.trim().toLowerCase() : '';
  }

  /**
   * @param {{openrouter?: Array<object>} | null} catalog
   * @param {unknown} filterQuery
   * @returns {Array<{id: string, name?: string, contextLength?: number, promptCostPerMillion?: number, completionCostPerMillion?: number, isModerated?: boolean}>}
   */
  static matchingModels(catalog, filterQuery) {
    const normalizedFilter = ModelCatalogView.#normalizeFilter(filterQuery);
    const models = Array.isArray(catalog?.openrouter) ? catalog.openrouter : [];
    if (normalizedFilter.length === 0) {
      return models;
    }
    return models.filter((model) => {
      return [model.id, model.name].some((field) => {
        return typeof field === 'string' && field.toLowerCase().includes(normalizedFilter);
      });
    });
  }

  /**
   * @param {{id: string, contextLength?: number, promptCostPerMillion?: number, completionCostPerMillion?: number, isModerated?: boolean}} model
   * @returns {string}
   */
  static optionLabel(model) {
    const parts = [];
    if (Number.isInteger(model.contextLength)) {
      parts.push(`${Math.round(model.contextLength / 1000)}k`);
    }
    if (typeof model.promptCostPerMillion === 'number' && typeof model.completionCostPerMillion === 'number') {
      parts.push(`$${model.promptCostPerMillion}/$${model.completionCostPerMillion}`);
    }
    if (model.isModerated === true) {
      parts.push(ModelCatalogView.#ModeratedLabel);
    }
    return parts.length > 0 ? `${model.id} (${parts.join(', ')})` : model.id;
  }

  /**
   * @param {{openrouter: Array<object>, fetchedAt?: string | null, stale?: boolean} | null} catalog
   * @param {boolean} isLoading
   * @returns {string}
   */
  static statusText(catalog, isLoading) {
    if (isLoading) {
      return ModelCatalogView.LoadingText;
    }
    if (catalog === null) {
      return '';
    }
    if (typeof catalog.fetchedAt !== 'string' || catalog.fetchedAt.length === 0) {
      return ModelCatalogView.UnavailableText;
    }
    return catalog.stale
      ? `OpenRouter models: ${catalog.openrouter.length} (stale cache · ${catalog.fetchedAt})`
      : `OpenRouter models: ${catalog.openrouter.length} · Cached ${catalog.fetchedAt}`;
  }

  /**
   * @param {{documentRef: Document, selectElement: HTMLSelectElement, catalog: {openrouter?: Array<object>} | null, currentValue: string, filterQuery: unknown, emptyOptionText: string, hiddenOptionText: string}} options
   * @returns {void}
   */
  static populateSelect({
    documentRef,
    selectElement,
    catalog,
    currentValue,
    filterQuery,
    emptyOptionText,
    hiddenOptionText,
  }) {
    const isFiltered = ModelCatalogView.#normalizeFilter(filterQuery).length > 0;
    const matching = ModelCatalogView.matchingModels(catalog, filterQuery);
    const totalCount = Array.isArray(catalog?.openrouter) ? catalog.openrouter.length : 0;
    const hasExactOption = matching.some((model) => model.id === currentValue);
    const isSavedValueHidden = isFiltered && currentValue.length > 0 && !hasExactOption;

    const emptyOption = documentRef.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = isSavedValueHidden ? hiddenOptionText : emptyOptionText;
    selectElement.replaceChildren(emptyOption);

    if (catalog !== null) {
      const group = documentRef.createElement('optgroup');
      group.label = isFiltered
        ? `${ModelCatalogView.#GroupTitle} (${matching.length} of ${totalCount})`
        : `${ModelCatalogView.#GroupTitle} (${totalCount})`;
      for (const model of matching) {
        const option = documentRef.createElement('option');
        option.value = model.id;
        option.textContent = ModelCatalogView.optionLabel(model);
        group.append(option);
      }
      selectElement.append(group);
    }

    selectElement.value = hasExactOption ? currentValue : '';
  }
}
