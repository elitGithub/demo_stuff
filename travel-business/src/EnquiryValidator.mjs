import { InputError } from './InputError.mjs';
import { EnquiryInput } from './dto/EnquiryInput.mjs';
import { Catalog } from './dto/Catalog.mjs';

export class EnquiryValidator {
  /** @param {Catalog} catalog @param {()=>number} now */
  constructor(catalog, now) { this.catalog = catalog; this.now = now; }

  /** @param {unknown} raw @returns {EnquiryInput} */
  validate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { throw new InputError('Please provide your enquiry details.'); }
    const firstName = this.text(raw, 'firstName', 60, true);
    const lastName = this.text(raw, 'lastName', 60, true);
    const email = this.text(raw, 'email', 160, true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { throw new InputError('Please enter a valid email address.'); }
    let destination = this.text(raw, 'destination', 40);
    if (destination && !this.catalog.destinations.some(candidate => candidate.id === destination)) { throw new InputError('Please choose a destination from the list.'); }
    const journey = this.text(raw, 'journey', 60);
    const selected = this.catalog.journeys.find(candidate => candidate.id === journey);
    if (journey && !selected) { throw new InputError('Please choose a journey from the list.'); }
    if (selected && destination && selected.destination !== destination) { throw new InputError('Please choose a journey that matches your destination, or select a personal journey.'); }
    if (selected && !destination) { destination = selected.destination; }
    const departure = this.text(raw, 'departure', 10);
    if (departure) {
      const date = new Date(`${departure}T12:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(departure) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== departure) { throw new InputError('Please choose a valid departure date.'); }
      if (departure < new Date((this.now() - 86400) * 1000).toISOString().slice(0, 10)) { throw new InputError('Please choose a future departure date, or leave it flexible.'); }
    }
    if (!Number.isInteger(raw.travelers) || raw.travelers < 1 || raw.travelers > 12) { throw new InputError('Please choose between 1 and 12 travellers.'); }
    const budget = this.text(raw, 'budget', 40);
    if (!this.catalog.budgets.includes(budget)) { throw new InputError('Please choose a budget from the list.'); }
    if (typeof raw.consent !== 'boolean' || raw.consent !== true) { throw new InputError('Please acknowledge that this is a demo using fictional details.'); }
    return new EnquiryInput({ firstName, lastName, email, destination, journey, departure, travelers: raw.travelers, budget, message: this.text(raw, 'message', 2000) });
  }

  /** @param {object} raw @param {string} key @param {number} maximum @param {boolean} required @returns {string} */
  text(raw, key, maximum, required = false) {
    const field = Object.hasOwn(raw, key) ? raw[key] : '';
    if (typeof field !== 'string' || !field.isWellFormed()) { throw new InputError(`Please check the ${key} field.`); }
    const value = field.trim();
    if ((required && !value) || [...value].length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) { throw new InputError(`Please check the ${key} field.`); }
    return value;
  }
}
