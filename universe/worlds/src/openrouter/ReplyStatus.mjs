export const ReplyStatus = Object.freeze({
  Ok: 'ok',
  StreamError: 'stream-error',
  Aborted: 'aborted',
  NetworkError: 'network-error',

  /**
   * @param {number} code
   * @returns {string}
   */
  http(code) {
    return `http ${code}`;
  },
});
