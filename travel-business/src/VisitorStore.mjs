import { DatabaseSync } from 'node:sqlite';
import { closeSync, openSync, lstatSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import seed from './demo-seed.json' with { type: 'json' };
import { InputError } from './InputError.mjs';
import { ErrorCode } from './enums/ErrorCode.mjs';
import { EnquiryStatus } from './enums/EnquiryStatus.mjs';
import { BookingStatus } from './enums/BookingStatus.mjs';
import { SandboxConfig } from './dto/SandboxConfig.mjs';
import { Catalog } from './dto/Catalog.mjs';
import { EnquiryInput } from './dto/EnquiryInput.mjs';
import { EnquiryRecord } from './dto/EnquiryRecord.mjs';
import { BookingRecord } from './dto/BookingRecord.mjs';
import { Overview } from './dto/Overview.mjs';
import { CreatedEnquiry } from './dto/CreatedEnquiry.mjs';
import { CreatedBooking } from './dto/CreatedBooking.mjs';
import { Acknowledgement } from './dto/Acknowledgement.mjs';
import { StatusChange } from './dto/StatusChange.mjs';
import { EnquiryId } from './dto/EnquiryId.mjs';

export class VisitorStore {
  /** @param {string} path @param {SandboxConfig} config @param {Catalog} catalog @param {()=>number} now @param {boolean} create */
  constructor(path, config, catalog, now, create) {
    if (!(config instanceof SandboxConfig) || !(catalog instanceof Catalog) || typeof now !== 'function' || typeof create !== 'boolean' || typeof path !== 'string' || !path) { throw new TypeError('Explicit store configuration and creation mode are required.'); }
    this.config = config;
    this.catalog = catalog;
    this.now = now;
    this.database = null;
    try {
      if (create) {
        closeSync(openSync(path, 'wx', 0o600));
      } else {
        const information = lstatSync(path);
        if (!information.isFile() || information.isSymbolicLink() || information.size > config.maxDatabaseBytes) { throw new InputError('Invalid sandbox database.', 503, ErrorCode.Unavailable); }
      }
      this.database = new DatabaseSync(path);
      const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
      if (!create) {
        const definitions = this.database.prepare('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name').all().map(row => ({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: row.sql === null ? null : row.sql.trim().replace(/\s+/g, ' ') }));
        const expected = schema.split(';').map(statement => statement.trim()).filter(Boolean).map(statement => {
          const table = statement.match(/^CREATE TABLE (\w+)/)[1];
          return { type: 'table', name: table, tbl_name: table, sql: statement.replace(/\s+/g, ' ') };
        });
        for (const [table, count] of [['enquiries', 1], ['bookings', 2], ['metadata', 1]]) {
          for (let index = 1; index <= count; index += 1) {
            expected.push({ type: 'index', name: `sqlite_autoindex_${table}_${index}`, tbl_name: table, sql: null });
          }
        }
        expected.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
        if (JSON.stringify(definitions) !== JSON.stringify(expected)) { throw new InputError('Invalid sandbox schema.', 503, ErrorCode.Unavailable); }
        const metadata = this.database.prepare('SELECT key, value FROM metadata ORDER BY key').all();
        if (JSON.stringify(metadata) !== JSON.stringify([{ key: 'schemaVersion', value: seed.schemaVersion }, { key: 'seeded', value: '1' }])) { throw new InputError('Incomplete sandbox seed.', 503, ErrorCode.Unavailable); }
        for (const enquiry of seed.enquiries) {
          if (!this.database.prepare('SELECT id FROM enquiries WHERE id = ? AND reference = ?').get(enquiry.id, enquiry.reference)) { throw new InputError('Incomplete sandbox seed.', 503, ErrorCode.Unavailable); }
        }
        for (const booking of seed.bookings) {
          if (!this.database.prepare('SELECT id FROM bookings WHERE id = ? AND reference = ? AND enquiryId IS NULL').get(booking.id, booking.reference)) { throw new InputError('Incomplete sandbox seed.', 503, ErrorCode.Unavailable); }
        }
        if (this.database.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || this.database.prepare('PRAGMA foreign_key_check').all().length !== 0 || this.database.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') { throw new InputError('Invalid sandbox database state.', 503, ErrorCode.Unavailable); }
      }
      this.database.exec(`PRAGMA page_size = ${config.sqlitePageBytes}; PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY; PRAGMA cache_spill = OFF; PRAGMA cache_size = ${config.maxDatabaseBytes / config.sqlitePageBytes}; PRAGMA max_page_count = ${config.maxDatabaseBytes / config.sqlitePageBytes};`);
      for (const [setting, expected] of Object.entries({ page_size: config.sqlitePageBytes, journal_mode: 'delete', foreign_keys: 1, temp_store: 2, cache_spill: 0, cache_size: config.maxDatabaseBytes / config.sqlitePageBytes, max_page_count: config.maxDatabaseBytes / config.sqlitePageBytes })) {
        if (this.database.prepare(`PRAGMA ${setting}`).get()[setting] !== expected) { throw new InputError('Unsafe sandbox SQLite settings.', 503, ErrorCode.Unavailable); }
      }
      if (create) {
        this.transaction(() => {
          this.database.exec(schema);
          const allocatedAt = this.now();
          const createdAt = new Date(allocatedAt * 1000).toISOString();
          const enquiryInsert = this.database.prepare('INSERT INTO enquiries (id, reference, firstName, lastName, email, destination, journey, departure, travelers, budget, message, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
          for (const enquiry of seed.enquiries) {
            enquiryInsert.run(enquiry.id, enquiry.reference, enquiry.firstName, enquiry.lastName, enquiry.email, enquiry.destination, enquiry.journey, new Date((allocatedAt + enquiry.departureDays * 86400) * 1000).toISOString().slice(0, 10), enquiry.travelers, enquiry.budget, enquiry.message, enquiry.status, createdAt);
          }
          const bookingInsert = this.database.prepare('INSERT INTO bookings (id, reference, firstName, lastName, destination, journey, departure, travelers, value, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
          for (const booking of seed.bookings) {
            bookingInsert.run(booking.id, booking.reference, booking.firstName, booking.lastName, booking.destination, booking.journey, new Date((allocatedAt + booking.departureDays * 86400) * 1000).toISOString().slice(0, 10), booking.travelers, booking.value, booking.status, createdAt);
          }
          this.database.prepare("INSERT INTO metadata (key, value) VALUES ('schemaVersion', ?), ('seeded', '1')").run(seed.schemaVersion);
        });
      }
    } catch (error) {
      if (this.database) { this.database.close(); }
      this.database = null;
      if (error instanceof InputError) { throw error; }
      const unavailable = new InputError('The sandbox database is unavailable.', 503, ErrorCode.Unavailable);
      Object.defineProperty(unavailable, 'cause', { value: error, configurable: true });
      throw unavailable;
    }
  }

  /** @param {EnquiryInput} input @returns {CreatedEnquiry} */
  createEnquiry(input) {
    if (!(input instanceof EnquiryInput)) { throw new TypeError('An EnquiryInput is required.'); }
    return this.transaction(() => {
      if (this.database.prepare('SELECT count(*) AS total FROM enquiries').get().total >= this.config.maxEnquiries) { throw new InputError('Your demo workspace has reached its enquiry limit.', 409, ErrorCode.SandboxFull); }
      const reference = `EW-${randomUUID().slice(0, 8).toUpperCase()}`;
      const result = this.database.prepare('INSERT INTO enquiries (reference, firstName, lastName, email, destination, journey, departure, travelers, budget, message, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(reference, input.firstName, input.lastName, input.email, input.destination, input.journey, input.departure, input.travelers, input.budget, input.message, EnquiryStatus.New.value, new Date(this.now() * 1000).toISOString());
      return new CreatedEnquiry({ id: Number(result.lastInsertRowid), reference });
    });
  }

  /** @returns {Overview} */
  overview() {
    return new Overview({
      enquiries: this.database.prepare('SELECT * FROM enquiries ORDER BY id DESC').all().map(row => new EnquiryRecord({ id: row.id, reference: row.reference, input: new EnquiryInput(row), status: EnquiryStatus.from(row.status), createdAt: row.createdAt })),
      bookings: this.database.prepare('SELECT * FROM bookings ORDER BY id DESC').all().map(row => new BookingRecord({ ...row, status: BookingStatus.from(row.status) })),
      catalog: this.catalog
    });
  }

  /** @param {StatusChange} command @returns {Acknowledgement} */
  updateStatus(command) {
    if (!(command instanceof StatusChange)) { throw new TypeError('A StatusChange is required.'); }
    return this.transaction(() => {
      const enquiry = this.database.prepare('SELECT status FROM enquiries WHERE id = ?').get(command.id);
      if (!enquiry) { throw new InputError('Enquiry not found.', 404, ErrorCode.NotFound); }
      if (enquiry.status === EnquiryStatus.Converted.value) { throw new InputError('This enquiry already has a demo booking record.', 409, ErrorCode.Conflict); }
      this.database.prepare('UPDATE enquiries SET status = ? WHERE id = ?').run(command.status.value, command.id);
      return new Acknowledgement();
    });
  }

  /** @param {EnquiryId} command @returns {CreatedBooking} */
  convert(command) {
    if (!(command instanceof EnquiryId)) { throw new TypeError('An EnquiryId is required.'); }
    return this.transaction(() => {
      const enquiry = this.database.prepare('SELECT * FROM enquiries WHERE id = ?').get(command.id);
      if (!enquiry) { throw new InputError('Enquiry not found.', 404, ErrorCode.NotFound); }
      if (enquiry.status === EnquiryStatus.Converted.value || this.database.prepare('SELECT id FROM bookings WHERE enquiryId = ?').get(command.id)) { throw new InputError('A demo booking already exists for this enquiry.', 409, ErrorCode.Conflict); }
      if (this.database.prepare('SELECT count(*) AS total FROM bookings').get().total >= this.config.maxEnquiries + seed.bookings.length) { throw new InputError('Your demo workspace has reached its booking limit.', 409, ErrorCode.SandboxFull); }
      const reference = `BK-${randomUUID().slice(0, 8).toUpperCase()}`;
      const journey = this.catalog.journeys.find(candidate => candidate.id === enquiry.journey);
      const price = journey ? journey.price : 0;
      this.database.prepare('INSERT INTO bookings (reference, enquiryId, firstName, lastName, destination, journey, departure, travelers, value, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(reference, command.id, enquiry.firstName, enquiry.lastName, enquiry.destination, enquiry.journey, enquiry.departure, enquiry.travelers, price * enquiry.travelers, BookingStatus.Planning.value, new Date(this.now() * 1000).toISOString());
      this.database.prepare('UPDATE enquiries SET status = ? WHERE id = ?').run(EnquiryStatus.Converted.value, command.id);
      return new CreatedBooking({ reference });
    });
  }

  /** @template Result @param {()=>Result} action @returns {Result} */
  transaction(action) {
    try {
      this.database.exec('BEGIN IMMEDIATE');
      const result = action();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.database.isTransaction) { this.database.exec('ROLLBACK'); }
      if (error.code === 'ERR_SQLITE_ERROR' && error.errcode === 13) { throw new InputError('Your demo workspace has reached its storage limit.', 409, ErrorCode.SandboxFull); }
      throw error;
    }
  }

  /** @returns {void} */
  close() {
    if (this.database) { this.database.close(); this.database = null; }
  }
}
