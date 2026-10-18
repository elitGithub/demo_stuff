import budgets from '../../config/enquiry-budgets.json' with { type: 'json' };
import { destinations, journeys } from '../data.mjs';
import { CatalogDestination } from './CatalogDestination.mjs';
import { CatalogJourney } from './CatalogJourney.mjs';

export class Catalog {
  /** @param {{destinations:CatalogDestination[],journeys:CatalogJourney[],budgets:string[]}} fields */
  constructor({ destinations: destinationList, journeys: journeyList, budgets: budgetList }) {
    this.destinations = Object.freeze([...destinationList]);
    this.journeys = Object.freeze([...journeyList]);
    this.budgets = Object.freeze([...budgetList]);
    Object.freeze(this);
  }
  /** @returns {Catalog} */
  static canonical() {
    return new Catalog({ destinations: destinations.map(destination => new CatalogDestination(destination)), journeys: journeys.map(journey => new CatalogJourney(journey)), budgets });
  }
  /** @returns {object} */
  toJSON() { return { destinations: this.destinations, journeys: this.journeys }; }
}
