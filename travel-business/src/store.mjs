import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { destinations, journeys } from './data.mjs';

export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const budgets = ['', '$2,000–$3,500', '$3,500–$5,000', '$5,000–$8,000', '$8,000+'];
export function validateEnquiry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Please provide your enquiry details.');
  const text = (key, max, required = false) => {
    const raw = input[key] ?? '';
    if (typeof raw !== 'string') throw new InputError(`Please check the ${key} field.`);
    const value = raw.trim();
    if ((required && !value) || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new InputError(`Please check the ${key} field.`);
    return value;
  };
  const firstName = text('firstName', 60, true), lastName = text('lastName', 60, true);
  const email = text('email', 160, true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError('Please enter a valid email address.');
  let destination = text('destination', 40);
  if (destination && !destinations.some(d => d.id === destination)) throw new InputError('Please choose a destination from the list.');
  const journey = text('journey', 60);
  const selected = journeys.find(j => j.id === journey);
  if (journey && !selected) throw new InputError('Please choose a journey from the list.');
  if (selected && destination && selected.destination !== destination) throw new InputError('Please choose a journey that matches your destination, or select a personal journey.');
  if (selected && !destination) destination = selected.destination;
  const departure = text('departure', 10);
  if (departure) {
    const date = new Date(`${departure}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(departure) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== departure) throw new InputError('Please choose a valid departure date.');
    // Allow yesterday in UTC to accommodate browser time zones around midnight.
    if (departure < new Date(Date.now() - 86400000).toISOString().slice(0, 10)) throw new InputError('Please choose a future departure date, or leave it flexible.');
  }
  if (!Number.isInteger(input.travelers) || input.travelers < 1 || input.travelers > 12) throw new InputError('Please choose between 1 and 12 travellers.');
  const budget = text('budget', 40);
  if (!budgets.includes(budget)) throw new InputError('Please choose a budget from the list.');
  if (input.consent !== true) throw new InputError('Please acknowledge that this is a demo using fictional details.');
  return { firstName, lastName, email, destination, journey, departure, travelers: input.travelers, budget, message: text('message', 2000) };
}

export function createStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS enquiries (
      id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE,
      firstName TEXT NOT NULL, lastName TEXT NOT NULL, email TEXT NOT NULL,
      destination TEXT NOT NULL DEFAULT '', journey TEXT NOT NULL DEFAULT '', departure TEXT NOT NULL DEFAULT '',
      travelers INTEGER NOT NULL, budget TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','proposal','converted','closed')),
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE,
      enquiryId INTEGER UNIQUE REFERENCES enquiries(id),
      firstName TEXT NOT NULL, lastName TEXT NOT NULL, destination TEXT NOT NULL DEFAULT '',
      journey TEXT NOT NULL DEFAULT '', departure TEXT NOT NULL DEFAULT '', travelers INTEGER NOT NULL,
      value INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'planning', createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const insert = db.prepare('INSERT INTO enquiries (reference, firstName, lastName, email, destination, journey, departure, travelers, budget, message, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const ref = prefix => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
  function addEnquiry(data, status = 'new') {
    const reference = ref('EW');
    const result = insert.run(reference, data.firstName, data.lastName, data.email, data.destination, data.journey, data.departure, data.travelers, data.budget, data.message, status, new Date().toISOString());
    return { id: Number(result.lastInsertRowid), reference };
  }
  if (!db.prepare("SELECT value FROM metadata WHERE key = 'seeded'").get()) {
    const future = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    db.exec('BEGIN');
    try {
      const samples = [
        ['Olivia', 'Bennett', 'italy', 'italian-slow-days', 2, '$3,500–$5,000', 'We’re celebrating an anniversary and would love a relaxed itinerary with a few cooking experiences.', 'new', 75],
        ['James', 'Morgan', 'japan', 'japan-beyond', 4, '$5,000–$8,000', 'A family trip with two teenagers. We love food, art and exploring neighbourhoods on foot.', 'proposal', 120],
        ['Sophie', 'Chen', 'bali', 'bali-unhurried', 2, '$2,000–$3,500', 'Hoping for a quiet escape with time in the rice terraces and a few nights near the ocean.', 'contacted', 65],
        ['Noah', 'Williams', 'tanzania', 'wild-tanzania', 2, '$5,000–$8,000', 'Our first safari. We’re interested in photography and a small, intimate camp.', 'new', 160]
      ];
      for (const [firstName, lastName, destination, journey, travelers, budget, message, status, days] of samples) addEnquiry({ firstName, lastName, email: `${firstName.toLowerCase()}@example.com`, destination, journey, travelers, budget, message, departure: future(days) }, status);
      const bookingInsert = db.prepare('INSERT INTO bookings (reference, firstName, lastName, destination, journey, departure, travelers, value, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      bookingInsert.run('BK-DEMO-001', 'Amelia', 'Parker', 'greece', 'greek-island-days', future(90), 2, 5900, 'confirmed', new Date().toISOString());
      bookingInsert.run('BK-DEMO-002', 'Oliver', 'Reed', 'maldives', 'maldives-barefoot', future(45), 2, 7900, 'planning', new Date().toISOString());
      bookingInsert.run('BK-DEMO-003', 'Mia', 'Collins', 'japan', 'japan-beyond', future(150), 3, 14550, 'confirmed', new Date().toISOString());
      db.prepare("INSERT INTO metadata VALUES ('seeded', '1')").run();
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {
    createEnquiry(input) { return addEnquiry(validateEnquiry(input)); },
    overview() {
      return { enquiries: db.prepare('SELECT * FROM enquiries ORDER BY id DESC').all(), bookings: db.prepare('SELECT * FROM bookings ORDER BY id DESC').all(), catalog: { destinations: destinations.map(({ id, name }) => ({ id, name })), journeys: journeys.map(({ id, title }) => ({ id, title })) } };
    },
    updateStatus(id, status) {
      if (!['new', 'contacted', 'proposal', 'closed'].includes(status)) throw new InputError('Please choose a valid enquiry status.');
      const enquiry = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(id);
      if (!enquiry) throw new InputError('Enquiry not found.', 404);
      if (enquiry.status === 'converted') throw new InputError('This enquiry already has a demo booking record.', 409);
      db.prepare('UPDATE enquiries SET status = ? WHERE id = ?').run(status, id);
      return { ok: true };
    },
    convert(id) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const e = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(id);
        if (!e) throw new InputError('Enquiry not found.', 404);
        if (db.prepare('SELECT id FROM bookings WHERE enquiryId = ?').get(id)) throw new InputError('A demo booking already exists for this enquiry.', 409);
        const reference = ref('BK');
        const price = journeys.find(j => j.id === e.journey)?.price || 0;
        db.prepare('INSERT INTO bookings (reference, enquiryId, firstName, lastName, destination, journey, departure, travelers, value, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(reference, id, e.firstName, e.lastName, e.destination, e.journey, e.departure, e.travelers, price * e.travelers, 'planning', new Date().toISOString());
        db.prepare("UPDATE enquiries SET status = 'converted' WHERE id = ?").run(id);
        db.exec('COMMIT');
        return { reference };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { db.close(); }
  };
}
