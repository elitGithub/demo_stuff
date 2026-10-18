export class ApiResult {
  /** @param {{payload:import('./Bootstrap.mjs').Bootstrap|import('./Overview.mjs').Overview|import('./CreatedEnquiry.mjs').CreatedEnquiry|import('./CreatedBooking.mjs').CreatedBooking|import('./Acknowledgement.mjs').Acknowledgement,cookies:import('./CookieChange.mjs').CookieChange[]}} fields */
  constructor({ payload, cookies }) {
    this.payload = payload;
    this.cookies = Object.freeze([...cookies]);
    Object.freeze(this);
  }
}
