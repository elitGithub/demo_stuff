import fs from 'node:fs';
import path from 'node:path';

const RECORD_START = '=== ';
const FIELD_SEPARATOR = ' | ';
const STAGE_LABEL = 'stage=';
const CAMPAIGN_LABEL = 'campaign=';
const MODEL_LABEL = 'model=';
const STATUS_LABEL = 'status=';
const FINISH_LABEL = 'finish=';
const TOKENS_LABEL = 'tokens=';
const NONE_VALUE = 'none';
const TOKENS_SEPARATOR = '/';
const ERROR_LABEL = 'error: ';
const PARTIAL_LABEL = 'partial text:';

export class ReplyLog {
  #filePath;

  /**
   * @param {string} filePath
   * @throws {TypeError}
   */
  constructor(filePath) {
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      throw new TypeError('ReplyLog filePath must be a non-empty string.');
    }
    this.#filePath = filePath;
  }

  /**
   * @param {{stage: string, campaignId: string | null, model: string, status: string, finishReason: string | null, usage: {promptTokens: number, completionTokens: number} | null, text: string, errorMessage?: string | null}} record
   * @returns {void}
   * @throws {Error}
   */
  append({ stage, campaignId, model, status, finishReason, usage, text, errorMessage = null }) {
    const tokens = usage === null
      ? NONE_VALUE
      : `${usage.promptTokens}${TOKENS_SEPARATOR}${usage.completionTokens}`;
    const header = [
      `${RECORD_START}${new Date().toISOString()}`,
      `${STAGE_LABEL}${stage}`,
      `${CAMPAIGN_LABEL}${campaignId ?? NONE_VALUE}`,
      `${MODEL_LABEL}${model}`,
      `${STATUS_LABEL}${status}`,
      `${FINISH_LABEL}${finishReason ?? NONE_VALUE}`,
      `${TOKENS_LABEL}${tokens}`,
    ].join(FIELD_SEPARATOR);
    const body = errorMessage === null
      ? text
      : `${ERROR_LABEL}${errorMessage}\n${PARTIAL_LABEL}\n${text}`;
    fs.mkdirSync(path.dirname(this.#filePath), { recursive: true });
    fs.appendFileSync(this.#filePath, `${header}\n${body}\n\n`, 'utf8');
  }
}
