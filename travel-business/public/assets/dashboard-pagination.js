window.ElsewherePagination = class ElsewherePagination {
  /** @param {number} pageSize */
  constructor(pageSize) {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1) { throw new TypeError('Invalid page size.'); }
    this.pageSize = pageSize;
  }

  /** @param {ReadonlyArray} records @param {number} requestedPage @returns {Readonly<object>} */
  select(records, requestedPage) {
    const total = records.length;
    const pageCount = Math.max(1, Math.ceil(total / this.pageSize));
    const page = Math.min(pageCount, Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1));
    const offset = (page - 1) * this.pageSize;
    return Object.freeze({ rows: Object.freeze(records.slice(offset, offset + this.pageSize)), page, pageCount, total, start: total ? offset + 1 : 0, end: Math.min(offset + this.pageSize, total) });
  }
};
