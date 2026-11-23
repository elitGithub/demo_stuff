import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class LauncherLog {
  #path;

  /**
   * @param {?string} path
   */
  constructor(path) {
    this.#path = path;
  }

  /**
   * @param {string} text
   * @param {Function} [show]
   * @returns {void}
   * @throws {Error}
   */
  say(text, show = console.log) {
    this.write(`[universe] ${text}`, show);
  }

  /**
   * @param {string} line
   * @param {Function} [show]
   * @returns {void}
   * @throws {Error}
   */
  write(line, show = console.log) {
    if (this.#path !== null) {
      try {
        mkdirSync(dirname(this.#path), { recursive: true });
        appendFileSync(this.#path, `${new Date().toISOString()} ${line}\n`);
      } catch (error) {
        const path = this.#path;
        this.#path = null;
        this.say(`Could not write the log file ${path}: ${error.message}`);
      }
    }
    show(line);
  }
}
