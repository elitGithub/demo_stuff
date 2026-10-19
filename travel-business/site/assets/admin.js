(() => {
  const login = document.getElementById('admin-login');
  const workspace = document.getElementById('admin-workspace');
  const loginButton = document.getElementById('demo-login');
  const loginError = document.getElementById('login-error');
  const feedback = document.getElementById('admin-feedback');
  const search = document.getElementById('admin-search');
  const dialog = document.getElementById('content-dialog');
  const content = document.getElementById('dialog-content');
  const client = window.elsewhereSandbox;
  const sandboxStatus = document.getElementById('sandbox-status');
  const retry = document.getElementById('sandbox-retry');
  const restart = document.getElementById('sandbox-restart');
  const refresh = document.getElementById('admin-refresh');
  const logout = document.getElementById('demo-logout');
  let enquiries = [], bookings = [], catalog = {}, activeTab = 'enquiries';
  let ready = false, pending = false, pagination = null, idleHours = null;
  const pages = { enquiries: 1, bookings: 1 };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const dateLabel = value => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : 'Flexible';
  const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
  const destinationName = id => catalog.destinations?.find(d => d.id === id)?.name || 'Open to ideas';
  const journeyName = id => catalog.journeys?.find(j => j.id === id)?.title || 'A personal journey';
  const status = value => `<span class="status-pill status-${escape(value)}">${escape(value.charAt(0).toUpperCase() + value.slice(1))}</span>`;
  /** @returns {void} */
  function clearWorkspace() {
    if (dialog.open) { dialog.close(); }
    content.replaceChildren();
    enquiries = []; bookings = []; catalog = {};
    pages.enquiries = 1; pages.bookings = 1; search.value = '';
    ['enquiries-table', 'bookings-table', 'admin-stats', 'enquiry-count', 'booking-count', 'enquiries-range', 'bookings-range'].forEach(id => { document.getElementById(id).replaceChildren(); });
    workspace.hidden = true; login.hidden = false; refresh.hidden = true;
    message('');
  }
  /** @param {Error} failure @returns {boolean} */
  function recover(failure) {
    if (failure.name === 'AbortError') { return true; }
    if (failure.handled) { return true; }
    if (failure.code !== 'sandbox_context' && failure.code !== 'dashboard_access') { return false; }
    failure.handled = true;
    client.cancelPending();
    clearWorkspace();
    if (failure.code === 'sandbox_context') {
      ready = false; loginButton.disabled = true; restart.hidden = false;
      sandboxStatus.textContent = 'Your demo session ended or changed. Start a fresh demo to continue.';
      restart.focus();
    } else {
      loginError.textContent = 'Dashboard access ended. Enter the dashboard again to continue.';
      loginError.hidden = false; loginButton.disabled = !ready; loginButton.focus();
    }
    return true;
  }
  /** @param {Error} failure @returns {string} */
  function errorText(failure) {
    return failure instanceof TypeError ? 'The demo server is unavailable. Please try again.' : failure.message;
  }
  /** @param {string} path @param {object} options @returns {Promise<object>} */
  async function request(path, options = {}) {
    try { return await client.request(path, options); }
    catch (failure) { recover(failure); throw failure; }
  }
  /** @param {boolean} initial @returns {Promise<void>} */
  async function initialize(initial = false) {
    clearWorkspace(); ready = false; pending = true; loginButton.disabled = true;
    retry.hidden = true; restart.hidden = true; loginError.hidden = true;
    sandboxStatus.textContent = 'Preparing your private demo…';
    try {
      const bootstrap = await client.initialize();
      pagination = new window.ElsewherePagination(bootstrap.pageSize);
      idleHours = bootstrap.idleSeconds / 3600;
      ready = true;
      sandboxStatus.textContent = bootstrap.created ? 'A fresh demo is ready with sample data.' : 'Your private demo is ready. Your edits are still here.';
      if (initial) { loginButton.textContent = 'Loading records…'; await load(true); }
      else { loginButton.disabled = false; loginButton.focus(); }
    } catch (failure) {
      if (failure.name !== 'AbortError' && !recover(failure)) {
        sandboxStatus.textContent = errorText(failure);
        retry.hidden = false;
        retry.focus();
      }
    } finally { pending = false; loginButton.disabled = !ready; loginButton.textContent = 'Enter the demo dashboard'; }
  }
  function message(text, error = false) {
    feedback.textContent = text;
    feedback.classList.toggle('error', error);
  }
  function render() {
    document.getElementById('enquiry-count').textContent = enquiries.length;
    document.getElementById('booking-count').textContent = bookings.length;
    const active = bookings.filter(b => b.status !== 'cancelled');
    const stats = [
      ['Trip enquiries', enquiries.length, 'Every idea has a starting point'],
      ['New conversations', enquiries.filter(e => e.status === 'new').length, 'Ready for a little attention'],
      ['Sample bookings', active.length, 'Fictional journey records'],
      ['Sample pipeline', money(active.reduce((sum, b) => sum + b.value, 0)), 'Illustrative value · not revenue']
    ];
    document.getElementById('admin-stats').innerHTML = stats.map(([label, value, note]) => `<div class="stat-card"><span>${escape(label)}</span><strong>${escape(value)}</strong><small>${escape(note)}</small></div>`).join('');
    const term = search.value.trim().toLowerCase();
    const matches = record => `${record.firstName} ${record.lastName} ${record.email || ''} ${record.reference} ${destinationName(record.destination)} ${journeyName(record.journey)}`.toLowerCase().includes(term);
    const enquiryPage = pagination.select(enquiries.filter(matches), pages.enquiries);
    const bookingPage = pagination.select(bookings.filter(matches), pages.bookings);
    pages.enquiries = enquiryPage.page; pages.bookings = bookingPage.page;
    for (const [name, selection] of [['enquiries', enquiryPage], ['bookings', bookingPage]]) {
      document.getElementById(`${name}-range`).textContent = selection.total ? `Showing ${selection.start}-${selection.end} of ${selection.total}` : 'No matching records';
      document.getElementById(`${name}-previous`).disabled = selection.page <= 1;
      document.getElementById(`${name}-next`).disabled = selection.page >= selection.pageCount;
    }
    const visibleEnquiries = enquiryPage.rows;
    document.getElementById('enquiries-table').innerHTML = visibleEnquiries.map(e => `<tr><td><strong>${escape(e.firstName)} ${escape(e.lastName)}</strong><small>${escape(e.reference)} · ${escape(e.email)}</small></td><td>${escape(destinationName(e.destination))}<small>${escape(journeyName(e.journey))}</small></td><td>${escape(dateLabel(e.departure))}</td><td>${e.travelers} ${e.travelers === 1 ? 'person' : 'people'}</td><td>${status(e.status)}</td><td><button class="text-link" data-enquiry="${e.id}">View details <span aria-hidden="true">↗</span></button></td></tr>`).join('') || '<tr><td colspan="6">No enquiries match your search.</td></tr>';
    document.getElementById('bookings-table').innerHTML = bookingPage.rows.map(b => `<tr><td><strong>${escape(b.firstName)} ${escape(b.lastName)}</strong><small>${escape(b.reference)}</small></td><td>${escape(journeyName(b.journey))}<small>${escape(destinationName(b.destination))}</small></td><td>${escape(dateLabel(b.departure))}</td><td>${b.travelers} ${b.travelers === 1 ? 'person' : 'people'}</td><td>${money(b.value)}<small>Illustrative total</small></td><td>${status(b.status)}</td></tr>`).join('') || '<tr><td colspan="6">No bookings match your search.</td></tr>';
  }
  /** @param {boolean} initial @returns {Promise<void>} */
  async function load(initial = false) {
    refresh.disabled = true; refresh.textContent = 'Loading records…';
    message('Loading your demo records…');
    try {
      const body = await client.request('/api/admin/overview');
      enquiries = body.enquiries; bookings = body.bookings; catalog = body.catalog;
      login.hidden = true; workspace.hidden = false; refresh.hidden = true;
      render(); message('');
    } catch (failure) {
      if (initial && failure.code === 'dashboard_access') { clearWorkspace(); loginError.hidden = true; return; }
      if (!recover(failure)) {
        if (workspace.hidden) { loginError.textContent = errorText(failure); loginError.hidden = false; }
        else { message(`${errorText(failure)} Refresh records to try again.`, true); refresh.hidden = false; }
      }
      throw failure;
    } finally { refresh.disabled = false; refresh.textContent = 'Refresh records'; }
  }
  loginButton.addEventListener('click', async () => {
    if (!ready || pending) { return; }
    pending = true; loginButton.disabled = true; loginError.hidden = true;
    loginButton.textContent = 'Entering your demo…';
    try { await request('/api/admin/login', { method: 'POST', body: {} }); loginButton.textContent = 'Loading records…'; await load(); }
    catch (failure) { if (!recover(failure)) { loginError.textContent = errorText(failure); loginError.hidden = false; } }
    finally { pending = false; loginButton.disabled = !ready; loginButton.textContent = 'Enter the demo dashboard'; }
  });
  logout.addEventListener('click', async () => {
    if (pending) { return; }
    logout.disabled = true; logout.textContent = 'Leaving dashboard…';
    client.cancelPending(); clearWorkspace(); pending = true; loginButton.disabled = true;
    sandboxStatus.textContent = 'Leaving the dashboard…';
    try {
      await request('/api/admin/logout', { method: 'POST', body: {} });
      sandboxStatus.textContent = `Dashboard access ended. Your edits remain in this browser for ${idleHours} idle hours.`;
    } catch (failure) {
      if (!recover(failure)) { loginError.textContent = `${errorText(failure)} Enter the dashboard to retry leaving.`; loginError.hidden = false; sandboxStatus.textContent = 'Could not confirm dashboard logout.'; }
    } finally { pending = false; logout.disabled = false; logout.textContent = 'Leave dashboard'; loginButton.disabled = !ready; if (ready) { loginButton.focus(); } }
  });
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function switchTab(tab) {
    activeTab = tab.id.replace('tab-', '');
    tabs.forEach(item => { const selected = item === tab; item.classList.toggle('active', selected); item.setAttribute('aria-selected', String(selected)); item.tabIndex = selected ? 0 : -1; });
    document.getElementById('panel-enquiries').hidden = activeTab !== 'enquiries';
    document.getElementById('panel-bookings').hidden = activeTab !== 'bookings';
  }
  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab));
    tab.addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[1] : tabs.find(item => item !== tab);
        switchTab(next); next.focus();
      }
    });
  });
  search.addEventListener('input', () => { pages.enquiries = 1; pages.bookings = 1; render(); });
  for (const name of ['enquiries', 'bookings']) {
    for (const direction of ['previous', 'next']) {
      document.getElementById(`${name}-${direction}`).addEventListener('click', () => { pages[name] += direction === 'next' ? 1 : -1; render(); });
    }
  }
  retry.addEventListener('click', () => initialize());
  restart.addEventListener('click', () => initialize());
  refresh.addEventListener('click', () => { if (!pending) { load().catch(() => {}); } });
  document.getElementById('enquiries-table').addEventListener('click', event => {
    const button = event.target.closest('[data-enquiry]');
    if (!button || pending) return;
    const e = enquiries.find(row => row.id === Number(button.dataset.enquiry));
    if (!e) return;
    const converted = e.status === 'converted';
    const fields = [['Reference', e.reference], ['Email', e.email], ['Destination', destinationName(e.destination)], ['Journey', journeyName(e.journey)], ['Departure', dateLabel(e.departure)], ['Travellers', e.travelers], ['Budget / person', e.budget || 'Still exploring'], ['Received', dateLabel(e.createdAt)]];
    content.innerHTML = `<div class="admin-detail"><p class="eyebrow">A JOURNEY IN THE MAKING</p><h2 id="dialog-title">${escape(e.firstName)} ${escape(e.lastName)}</h2><dl class="detail-list">${fields.map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><h3>The daydream</h3><p class="admin-note">${escape(e.message || 'No additional notes yet.')}</p>${converted ? '<p class="demo-note">A demo booking record has been created for this enquiry.</p>' : `<form id="status-form" class="admin-actions"><label>Enquiry status<select name="status">${['new', 'contacted', 'proposal', 'closed'].map(s => `<option value="${s}" ${e.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}</select></label><button type="submit" class="button">Save status</button></form><div class="admin-actions"><button class="button button-cream" id="convert-enquiry">Create demo booking <span aria-hidden="true">↗</span></button></div>`}<p class="admin-record-note">This is a demonstration record. Updating a status or creating a booking does not send an email, reserve inventory or collect a payment.</p><p id="record-feedback" role="status" class="admin-feedback"></p></div>`;
    const recordRoot = content.firstElementChild;
    const recordControls = [...recordRoot.querySelectorAll('button, select')];
    const recordFeedback = recordRoot.querySelector('#record-feedback');
    dialog.showModal(); dialog.scrollTop = 0; document.body.classList.add('dialog-open');
    content.querySelector('#status-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      if (pending) { return; }
      const save = event.target.querySelector('button');
      client.cancelPending();
      pending = true; recordControls.forEach(control => { control.disabled = true; });
      save.textContent = 'Saving status…'; recordFeedback.textContent = 'Saving status…';
      let saved = false;
      try {
        const selectedStatus = event.target.elements.status.value;
        await request(`/api/admin/enquiries/${e.id}`, { method: 'PATCH', body: { status: selectedStatus } });
        saved = true; e.status = selectedStatus; render();
        await load();
        recordFeedback.textContent = 'Status saved. No email was sent.';
        message('Enquiry status updated.');
      } catch (failure) { if (!recover(failure)) { recordFeedback.textContent = saved ? 'Status saved. Could not refresh records. Close this dialog and refresh records.' : `${errorText(failure)} Try Save status again.`; } }
      finally { pending = false; recordControls.forEach(control => { control.disabled = false; }); save.textContent = 'Save status'; }
    });
    content.querySelector('#convert-enquiry')?.addEventListener('click', async event => {
      if (pending) { return; }
      const convert = event.currentTarget;
      client.cancelPending();
      pending = true; recordControls.forEach(control => { control.disabled = true; });
      convert.textContent = 'Creating demo booking…'; recordFeedback.textContent = 'Creating demo booking…';
      let created = false;
      try {
        const result = await request(`/api/admin/enquiries/${e.id}/booking`, { method: 'POST', body: {} });
        created = true; e.status = 'converted';
        search.value = ''; pages.bookings = 1;
        dialog.close(); switchTab(tabs[1]); render();
        await load();
        message(`Created ${result.reference}, a demo planning record. No travel has been reserved.`);
        document.getElementById('bookings-range').focus();
      } catch (failure) {
        if (!recover(failure)) {
          if (created) { message('Demo booking created. Could not refresh records. Refresh records to see it.', true); }
          else { recordFeedback.textContent = `${errorText(failure)} Try Create demo booking again.`; }
        }
      } finally { pending = false; if (!created) { recordControls.forEach(control => { control.disabled = false; }); convert.textContent = 'Create demo booking'; } }
    });
  });
  initialize(true);
})();
