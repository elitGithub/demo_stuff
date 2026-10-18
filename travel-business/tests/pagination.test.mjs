import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import sandboxConfig from '../config/sandbox.json' with { type: 'json' };
import budgets from '../config/enquiry-budgets.json' with { type: 'json' };

const realm = createContext({ window: {} });
runInContext(await readFile(new URL('../assets/dashboard-pagination.js', import.meta.url), 'utf8'), realm);
const pagination = new realm.window.ElsewherePagination(sandboxConfig.pageSize);

test('twenty_row_pages_and_search', () => {
  for (const total of [0, 1, 20, 21, 100]) {
    const records = Object.freeze(Array.from({ length: total }, (_, index) => Object.freeze({ id: total - index, text: index === total - 1 ? 'needle' : 'other' })));
    const original = [...records];
    const first = pagination.select(records, 1);
    assert.equal(first.start, total ? 1 : 0);
    assert.equal(first.end, Math.min(total, 20));
    assert.equal(first.total, total);
    assert.equal(first.pageCount, Math.max(1, Math.ceil(total / 20)));
    const last = pagination.select(records, 999);
    assert.equal(last.page, first.pageCount);
    assert.equal(last.end, total);
    assert.equal(last.start, total ? (last.page - 1) * 20 + 1 : 0);
    assert.deepEqual([...first.rows], records.slice(0, 20));
    assert.deepEqual([...last.rows], records.slice((last.page - 1) * 20));
    const filtered = pagination.select(records.filter(record => record.text.includes('needle')), last.page);
    assert.equal(filtered.total, total ? 1 : 0);
    assert.equal(filtered.page, 1);
    if (total) { assert.equal(filtered.rows[0].id, 1); }
    assert.deepEqual(records, original);
    assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first.rows));
    for (const page of [-1, 0, 1.5, NaN, Infinity, '2']) { assert.equal(pagination.select(records, page).page, 1); }
  }
});

test('pagination validates configuration and keeps tab selections independent', () => {
  for (const pageSize of [0, -1, 1.5, NaN, Infinity, '20']) { assert.throws(() => new realm.window.ElsewherePagination(pageSize), /Invalid page size/); }
  const records = Array.from({ length: 46 }, (_, index) => index);
  const enquiryPage = pagination.select(records, 2);
  const bookingPage = pagination.select(records, 1);
  assert.equal(enquiryPage.start, 21); assert.equal(enquiryPage.end, 40);
  assert.equal(bookingPage.start, 1); assert.equal(bookingPage.end, 20);
  assert.equal(pagination.select(records.slice(0, 20), enquiryPage.page).page, 1);
  assert.equal(pagination.select(records, 3).end, 46);
});

test('build_orders_and_versions_client_assets', async () => {
  const root = new URL('../', import.meta.url);
  const expected = {
    'contact.html': ['sandbox.js', 'app.js'],
    'admin.html': ['sandbox.js', 'dashboard-pagination.js', 'app.js', 'admin.js'],
    'index.html': ['app.js'], 'about.html': ['app.js'], 'destinations.html': ['app.js'], 'journeys.html': ['app.js'], 'journal.html': ['app.js']
  };
  for (const [file, files] of Object.entries(expected)) {
    const html = await readFile(new URL(`public/${file}`, root), 'utf8');
    const scripts = [...html.matchAll(/<script src="assets\/([^?]+)\?v=([a-f0-9]{10})" defer><\/script>/g)];
    assert.deepEqual(scripts.map(match => match[1]), files, file);
    for (const match of scripts) {
      const source = await readFile(new URL(`assets/${match[1]}`, root));
      assert.equal(match[2], createHash('sha256').update(source).digest('hex').slice(0, 10));
    }
    assert.doesNotMatch(html, /shared demonstration workspace|public demo dashboard|temporary session cookie/);
    assert.match(html, new RegExp(`${sandboxConfig.idleSeconds / 3600} idle hours`));
    if (!['contact.html', 'admin.html'].includes(file)) { assert.doesNotMatch(html, /id="(?:enquiry-form|admin-login)"/); }
  }
  const contact = await readFile(new URL('public/contact.html', root), 'utf8');
  const options = contact.match(/<select name="budget">(.*?)<\/select>/)[1];
  assert.deepEqual([...options.matchAll(/<option value="([^"]*)">/g)].map(match => match[1]), budgets);
  for (const file of ['contact.html', 'admin.html']) {
    const html = await readFile(new URL(`public/${file}`, root), 'utf8');
    for (const id of ['sandbox-status', 'sandbox-retry', 'sandbox-restart']) { assert.equal(html.split(`id="${id}"`).length, 2); }
    assert.match(html, /private to this browser/i);
    assert.doesNotMatch(html, / style="/);
  }
});
