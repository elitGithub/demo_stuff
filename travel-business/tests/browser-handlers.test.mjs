import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { Catalog } from '../src/dto/Catalog.mjs';

const sources = Object.fromEntries(await Promise.all(['sandbox.js', 'dashboard-pagination.js', 'app.js', 'admin.js'].map(async file => [file, await readFile(new URL(`../assets/${file}`, import.meta.url), 'utf8')])));
const bootstrap = { csrfToken: 'a'.repeat(64), expiresAt: 1800000000, created: true, protocolVersion: 1, idleSeconds: 14400, pageSize: 20 };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => structuredClone(body) });
const deferred = () => { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; };
const flush = async () => { for (let turn = 0; turn < 20; turn++) { await Promise.resolve(); } };
const overview = (status = 'new', converted = false) => ({
  enquiries: [{ id: 1, reference: 'EW-DEMO-001', firstName: 'Alex', lastName: 'Demo', email: 'alex@travel.example', destination: 'italy', journey: 'italian-slow-days', departure: '', travelers: 2, budget: '', message: 'Fictional trip', status, createdAt: '2026-10-18T00:00:00.000Z' }],
  bookings: converted ? [{ id: 1, reference: 'BK-12345678', enquiryId: 1, firstName: 'Alex', lastName: 'Demo', destination: 'italy', journey: 'italian-slow-days', departure: '', travelers: 2, value: 6500, status: 'planning', createdAt: '2026-10-18T00:00:00.000Z' }] : [],
  catalog: JSON.parse(JSON.stringify(Catalog.canonical()))
});

const page = (kind, fetchImplementation) => {
  const elements = new Map();
  const document = { activeElement: null, getElementById: id => elements.get(id) || null, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  const element = id => {
    let markup = '', text = '';
    const listeners = new Map(), selectors = new Map();
    const node = {
      id, hidden: false, disabled: false, value: '', checked: false, open: false, dataset: {}, elements: {}, options: [], selectedOptions: [],
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, listener) { if (!listeners.has(type)) { listeners.set(type, []); } listeners.get(type).push(listener); },
      async dispatch(type, event = {}) { await Promise.all((listeners.get(type) || []).map(listener => listener({ target: node, currentTarget: node, preventDefault() {}, ...event }))); await flush(); },
      querySelector(selector) { return selectors.get(selector) || null; },
      querySelectorAll(selector) { return selectors.get(selector) || []; },
      setAttribute() {}, focus() { document.activeElement = node; }, scrollIntoView() {},
      showModal() { node.open = true; }, close() { node.open = false; },
      replaceChildren() { markup = ''; text = ''; node.firstElementChild = null; selectors.clear(); },
      closest(selector) { return selector === '[data-enquiry]' && node.dataset.enquiry ? node : null; },
      reportValidity() { return true; },
      selectors
    };
    Object.defineProperties(node, {
      innerHTML: { get: () => markup, set: value => { markup = value; text = ''; node.onHtml?.(value); } },
      textContent: { get: () => text, set: value => { text = String(value); markup = ''; } }
    });
    if (id) { elements.set(id, node); }
    return node;
  };
  for (const id of ['content-dialog', 'dialog-content', 'mobile-nav', 'sandbox-status', 'sandbox-retry', 'sandbox-restart']) { element(id); }
  const dialog = elements.get('content-dialog');
  dialog.selectors.set('.dialog-close', element());
  elements.get('sandbox-retry').hidden = true; elements.get('sandbox-restart').hidden = true;
  document.body = element();
  if (kind === 'admin') {
    for (const id of ['admin-login', 'admin-workspace', 'demo-login', 'login-error', 'admin-feedback', 'admin-search', 'admin-refresh', 'demo-logout', 'enquiries-table', 'bookings-table', 'admin-stats', 'enquiry-count', 'booking-count', 'enquiries-range', 'bookings-range', 'enquiries-previous', 'enquiries-next', 'bookings-previous', 'bookings-next', 'tab-enquiries', 'tab-bookings', 'panel-enquiries', 'panel-bookings']) { element(id); }
    elements.get('admin-workspace').hidden = true; elements.get('login-error').hidden = true; elements.get('admin-refresh').hidden = true;
    document.querySelectorAll = selector => selector === '[role="tab"]' ? [elements.get('tab-enquiries'), elements.get('tab-bookings')] : [];
    elements.get('dialog-content').onHtml = () => {
      const root = element(), form = element('status-form'), save = element('save-status'), select = element('status-select'), convert = element('convert-enquiry'), recordFeedback = element('record-feedback');
      select.value = 'contacted'; form.elements.status = select;
      form.selectors.set('button', save); root.selectors.set('button, select', [save, select, convert]); root.selectors.set('#record-feedback', recordFeedback);
      const content = elements.get('dialog-content');
      content.firstElementChild = root; content.selectors.set('#status-form', form); content.selectors.set('#convert-enquiry', convert);
    };
  } else {
    for (const id of ['enquiry-form', 'form-error', 'submit-enquiry', 'enquiry-reference', 'enquiry-success', 'new-enquiry']) { element(id); }
    const form = elements.get('enquiry-form');
    for (const [name, value] of Object.entries({ firstName: 'Unsent', lastName: 'Traveller', email: 'unsent@travel.example', destination: '', journey: '', departure: '', travelers: '2', budget: '', message: 'Keep this daydream', consent: 'on' })) { form.elements[name] = element(); form.elements[name].value = value; }
    form.elements.destination.options = [{ value: '' }]; form.elements.journey.options = [{ value: '' }]; form.elements.consent.checked = true;
    form.selectors.set('[type="submit"]', elements.get('submit-enquiry')); elements.get('submit-enquiry').innerHTML = 'Send my demo enquiry';
    elements.get('form-error').hidden = true; elements.get('enquiry-success').hidden = true;
  }
  const realm = createContext({
    window: { fetch: fetchImplementation }, document, DOMException, URLSearchParams, location: { search: '' },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    FormData: function(form) { return Object.entries(form.elements).map(([name, field]) => [name, field.value]); }
  });
  for (const file of ['sandbox.js', 'dashboard-pagination.js', 'app.js', ...(kind === 'admin' ? ['admin.js'] : [])]) { runInContext(sources[file], realm); }
  return {
    get: id => elements.get(id), active: () => document.activeElement, client: realm.window.elsewhereSandbox,
    async openRecord() { const button = element(); button.dataset.enquiry = '1'; await elements.get('enquiries-table').dispatch('click', { target: button }); },
    async save(status) { elements.get('status-select').value = status; await elements.get('status-form').dispatch('submit'); }
  };
};

for (const action of ['save', 'convert']) {
  test(`actual dashboard ${action} supersedes an earlier deferred refresh without restoring its stale snapshot`, async () => {
    const oldRefresh = deferred();
    let reads = 0, status = 'new', converted = false;
    const calls = [];
    const dashboard = page('admin', async (path, options) => {
      calls.push({ path, method: options.method });
      if (path === '/api/sandbox') { return response(bootstrap); }
      if (path === '/api/admin/overview') {
        reads++;
        if (reads === 2) { throw new TypeError('Refresh unavailable'); }
        if (reads === 3) { return oldRefresh.promise; }
        return response(overview(status, converted));
      }
      if (path.endsWith('/booking')) { status = 'converted'; converted = true; return response({ reference: 'BK-12345678' }, 201); }
      status = JSON.parse(options.body).status;
      return response({ ok: true });
    });
    await flush();
    await dashboard.openRecord(); await dashboard.save('contacted');
    assert.equal(dashboard.get('admin-refresh').hidden, false);
    dashboard.get('content-dialog').close();
    await dashboard.get('admin-refresh').dispatch('click');
    assert.equal(reads, 3);
    await dashboard.openRecord();
    if (action === 'save') { await dashboard.save('proposal'); }
    else { await dashboard.get('convert-enquiry').dispatch('click'); }
    assert.equal(reads, 4);
    const expectedFeedback = dashboard.get('admin-feedback').textContent;
    assert.ok(expectedFeedback);
    if (action === 'save') { assert.match(dashboard.get('enquiries-table').innerHTML, /status-proposal/); }
    else {
      assert.equal(dashboard.get('booking-count').textContent, '1');
      assert.match(dashboard.get('bookings-table').innerHTML, /BK-12345678/);
      assert.equal(dashboard.get('panel-bookings').hidden, false);
      assert.equal(dashboard.get('bookings-range').textContent, 'Showing 1-1 of 1');
    }
    oldRefresh.resolve(response(overview('contacted'))); await flush();
    assert.equal(dashboard.get('admin-feedback').textContent, expectedFeedback);
    if (action === 'save') { assert.match(dashboard.get('enquiries-table').innerHTML, /status-proposal/); }
    else { assert.equal(dashboard.get('booking-count').textContent, '1'); assert.match(dashboard.get('bookings-table').innerHTML, /BK-12345678/); }
    assert.equal(calls.filter(call => call.method === 'PATCH').length, action === 'save' ? 2 : 1);
    assert.equal(calls.filter(call => call.path === '/api/sandbox').length, 1);
  });
}

test('actual dashboard expected initial unauthorized response shows normal entry and explicit login restores records', async () => {
  const firstOverview = deferred();
  let authorized = false;
  const dashboard = page('admin', async path => {
    if (path === '/api/sandbox') { return response(bootstrap); }
    if (path === '/api/admin/login') { authorized = true; return response({ ok: true }); }
    return authorized ? response(overview()) : firstOverview.promise;
  });
  await flush();
  assert.equal(dashboard.get('demo-login').disabled, true);
  assert.equal(dashboard.get('login-error').hidden, true);
  firstOverview.resolve(response({ error: 'Dashboard access required.', code: 'dashboard_access' }, 401));
  await flush();
  assert.equal(dashboard.get('admin-login').hidden, false);
  assert.equal(dashboard.get('admin-workspace').hidden, true);
  assert.equal(dashboard.get('demo-login').disabled, false);
  assert.equal(dashboard.get('login-error').hidden, true);
  assert.equal(dashboard.get('sandbox-status').textContent, 'A fresh demo is ready with sample data.');
  assert.equal(dashboard.client.context, bootstrap.csrfToken);
  await dashboard.get('demo-login').dispatch('click');
  assert.equal(dashboard.get('admin-workspace').hidden, false);
  assert.match(dashboard.get('enquiries-table').innerHTML, /Alex/);
});

test('actual dashboard page entry restores an already authorized unexpired workspace without another login', async () => {
  const calls = [];
  const dashboard = page('admin', async path => {
    calls.push(path);
    return path === '/api/sandbox' ? response({ ...bootstrap, created: false }) : response(overview('proposal'));
  });
  await flush();
  assert.deepEqual(calls, ['/api/sandbox', '/api/admin/overview']);
  assert.equal(dashboard.get('admin-login').hidden, true);
  assert.equal(dashboard.get('admin-workspace').hidden, false);
  assert.equal(dashboard.get('login-error').hidden, true);
  assert.match(dashboard.get('enquiries-table').innerHTML, /status-proposal/);
  assert.match(dashboard.get('sandbox-status').textContent, /edits are still here/);
});

for (const code of ['dashboard_access', 'sandbox_context']) {
  test(`actual open dashboard ${code} clears records and dialog and focuses its recovery control`, async () => {
    const dashboard = page('admin', async path => {
      if (path === '/api/sandbox') { return response(bootstrap); }
      if (path === '/api/admin/overview') { return response(overview()); }
      return response({ error: 'Access ended.', code }, code === 'dashboard_access' ? 401 : 409);
    });
    await flush();
    assert.equal(dashboard.get('admin-workspace').hidden, false);
    await dashboard.openRecord(); await dashboard.save('proposal');
    assert.equal(dashboard.get('content-dialog').open, false);
    assert.equal(dashboard.get('dialog-content').firstElementChild, null);
    assert.equal(dashboard.get('enquiries-table').innerHTML, '');
    assert.equal(dashboard.get('booking-count').textContent, '');
    assert.equal(dashboard.get('admin-workspace').hidden, true);
    const control = dashboard.get(code === 'dashboard_access' ? 'demo-login' : 'sandbox-restart');
    assert.equal(control.hidden, false); assert.equal(control.disabled, false);
    assert.equal(dashboard.active(), control);
    if (code === 'dashboard_access') { assert.equal(dashboard.get('login-error').hidden, false); assert.match(dashboard.get('login-error').textContent, /access ended/); assert.equal(dashboard.client.context, bootstrap.csrfToken); }
    else { assert.equal(dashboard.client.context, null); }
  });
}

test('actual dashboard logout cancels a pending refresh and keeps context without allowing late records', async () => {
  const waiting = deferred();
  let reads = 0;
  const dashboard = page('admin', async path => {
    if (path === '/api/sandbox') { return response(bootstrap); }
    if (path === '/api/admin/overview') {
      reads++;
      if (reads === 2) { throw new TypeError('Expose retry'); }
      return reads === 3 ? waiting.promise : response(overview());
    }
    return response({ ok: true });
  });
  await flush(); await dashboard.openRecord(); await dashboard.save('contacted'); dashboard.get('content-dialog').close();
  await dashboard.get('admin-refresh').dispatch('click');
  await dashboard.get('demo-logout').dispatch('click');
  assert.equal(dashboard.get('admin-workspace').hidden, true);
  assert.equal(dashboard.client.context, bootstrap.csrfToken);
  waiting.resolve(response(overview())); await flush();
  assert.equal(dashboard.get('admin-workspace').hidden, true);
  assert.equal(dashboard.get('enquiries-table').innerHTML, '');
  assert.match(dashboard.get('sandbox-status').textContent, /edits remain/);
});

test('actual contact recovery clears resolved expiry alert, retains fields, and requires a new explicit submit', async () => {
  const restarted = deferred();
  let setups = 0, submissions = 0;
  const contact = page('contact', async path => {
    if (path === '/api/sandbox') { setups++; return setups === 2 ? restarted.promise : response(bootstrap); }
    submissions++;
    return submissions === 1 ? response({ error: 'Your demo session ended or changed. Start a fresh demo to continue.', code: 'sandbox_context' }, 409) : response({ id: 5, reference: 'EW-12345678' }, 201);
  });
  await flush();
  const form = contact.get('enquiry-form');
  const values = Object.fromEntries(Object.entries(form.elements).map(([name, field]) => [name, field.value]));
  await form.dispatch('submit');
  assert.equal(contact.get('form-error').hidden, false);
  assert.equal(contact.get('sandbox-restart').hidden, false);
  assert.equal(contact.get('submit-enquiry').disabled, true);
  const recovery = contact.get('sandbox-restart').dispatch('click');
  await flush(); assert.equal(setups, 2); assert.equal(submissions, 1);
  assert.equal(contact.get('submit-enquiry').disabled, true);
  restarted.resolve(response({ ...bootstrap, csrfToken: 'b'.repeat(64) })); await recovery;
  assert.equal(contact.get('form-error').hidden, true);
  assert.equal(contact.get('form-error').textContent, '');
  assert.equal(contact.get('submit-enquiry').disabled, false);
  assert.equal(contact.active(), contact.get('submit-enquiry'));
  assert.equal(contact.get('sandbox-status').textContent, 'A fresh demo is ready with sample data.');
  assert.equal(submissions, 1);
  assert.deepEqual(Object.fromEntries(Object.entries(form.elements).map(([name, field]) => [name, field.value])), values);
  await form.dispatch('submit');
  assert.equal(submissions, 2);
  assert.equal(contact.get('enquiry-success').hidden, false);
});
