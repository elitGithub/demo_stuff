import { CharacterCard } from './CharacterCard.mjs';

export class SchemaUpgrades {
  static Latest = 1;

  static steps = Object.freeze([
    Object.freeze({
      version: 1,

      /**
       * @param {import('node:sqlite').DatabaseSync} db
       * @returns {void}
       * @throws {Error}
       */
      apply(db) {
        if (!SchemaUpgrades.hasColumn(db, 'characters', 'card_json')) {
          db.exec("ALTER TABLE characters ADD COLUMN card_json TEXT NOT NULL DEFAULT '{}'");
        }
        if (!SchemaUpgrades.hasColumn(db, 'spend_log', 'prompt_chars')) {
          db.exec('ALTER TABLE spend_log ADD COLUMN prompt_chars INTEGER');
        }
        const rows = db.prepare(
          "SELECT id, persona, voice_notes FROM characters WHERE card_json = '{}' AND (persona <> '' OR voice_notes <> '')",
        ).all();
        const update = db.prepare('UPDATE characters SET card_json = ? WHERE id = ?');
        for (const row of rows) {
          const card = CharacterCard.fromObject({
            personalitySummary: row.persona,
            speakingStyle: row.voice_notes,
          });
          update.run(JSON.stringify(card.toObject()), row.id);
        }
      },
    }),
  ]);

  /**
   * @param {import('node:sqlite').DatabaseSync} db
   * @param {string} tableName
   * @param {string} columnName
   * @returns {boolean}
   * @throws {Error}
   */
  static hasColumn(db, tableName, columnName) {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName);
  }
}
