(() => {
  const login = document.getElementById('admin-login');
  const workspace = document.getElementById('admin-workspace');
  const loginButton = document.getElementById('demo-login');
  const loginError = document.getElementById('login-error');
  const feedback = document.getElementById('admin-feedback');
  const search = document.getElementById('admin-search');
  const dialog = document.getElementById('content-dialog');
  const content = document.getElementById('dialog-content');
  let enquiries = [], bookings = [], catalog = {}, activeTab = 'enquiries';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const dateLabel = value => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : 'Flexible';
  const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
  const destinationName = id => catalog.destinations?.find(d => d.id === id)?.name || 'Open to ideas';
  const journeyName = id => catalog.journeys?.find(j => j.id === id)?.title || 'A personal journey';
  const status = value => `<span class="status-pill status-${escape(value)}">${escape(value.charAt(0).toUpperCase() + value.slice(1))}</span>`;
  async function request(path, options = {}) {
    const response = await fetch(window.elsewhereApi(path), { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 401) { login.hidden = false; workspace.hidden = true; }
      throw new Error(body.error || 'Something went wrong. Please try again.');
    }
    return body;
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
    const visibleEnquiries = enquiries.filter(matches);
    document.getElementById('enquiries-table').innerHTML = visibleEnquiries.map(e => `<tr><td><strong>${escape(e.firstName)} ${escape(e.lastName)}</strong><small>${escape(e.reference)} · ${escape(e.email)}</small></td><td>${escape(destinationName(e.destination))}<small>${escape(journeyName(e.journey))}</small></td><td>${escape(dateLabel(e.departure))}</td><td>${e.travelers} ${e.travelers === 1 ? 'person' : 'people'}</td><td>${status(e.status)}</td><td><button class="text-link" data-enquiry="${e.id}">View details <span aria-hidden="true">↗</span></button></td></tr>`).join('') || '<tr><td colspan="6">No enquiries match your search.</td></tr>';
    document.getElementById('bookings-table').innerHTML = bookings.filter(matches).map(b => `<tr><td><strong>${escape(b.firstName)} ${escape(b.lastName)}</strong><small>${escape(b.reference)}</small></td><td>${escape(journeyName(b.journey))}<small>${escape(destinationName(b.destination))}</small></td><td>${escape(dateLabel(b.departure))}</td><td>${b.travelers} ${b.travelers === 1 ? 'person' : 'people'}</td><td>${money(b.value)}<small>Illustrative total</small></td><td>${status(b.status)}</td></tr>`).join('') || '<tr><td colspan="6">No bookings match your search.</td></tr>';
  }
  async function load() {
    const body = await request('/api/admin/overview');
    enquiries = body.enquiries; bookings = body.bookings; catalog = body.catalog;
    login.hidden = true; workspace.hidden = false;
    render();
  }
  loginButton.addEventListener('click', async () => {
    loginButton.disabled = true; loginError.hidden = true;
    try { await request('/api/admin/login', { method: 'POST', body: '{}' }); await load(); }
    catch (error) { loginError.textContent = error.message; loginError.hidden = false; }
    finally { loginButton.disabled = false; }
  });
  document.getElementById('demo-logout').addEventListener('click', async () => {
    try { await request('/api/admin/logout', { method: 'POST', body: '{}' }); login.hidden = false; workspace.hidden = true; enquiries = []; bookings = []; loginButton.focus(); }
    catch (error) { message(error.message, true); }
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
  search.addEventListener('input', render);
  document.getElementById('enquiries-table').addEventListener('click', event => {
    const button = event.target.closest('[data-enquiry]');
    if (!button) return;
    const e = enquiries.find(row => row.id === Number(button.dataset.enquiry));
    if (!e) return;
    const converted = e.status === 'converted';
    const fields = [['Reference', e.reference], ['Email', e.email], ['Destination', destinationName(e.destination)], ['Journey', journeyName(e.journey)], ['Departure', dateLabel(e.departure)], ['Travellers', e.travelers], ['Budget / person', e.budget || 'Still exploring'], ['Received', dateLabel(e.createdAt)]];
    content.innerHTML = `<div class="admin-detail"><p class="eyebrow">A JOURNEY IN THE MAKING</p><h2 id="dialog-title">${escape(e.firstName)} ${escape(e.lastName)}</h2><dl class="detail-list">${fields.map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><h3>The daydream</h3><p class="admin-note">${escape(e.message || 'No additional notes yet.')}</p>${converted ? '<p class="demo-note">A demo booking record has been created for this enquiry.</p>' : `<form id="status-form" class="admin-actions"><label>Enquiry status<select name="status">${['new', 'contacted', 'proposal', 'closed'].map(s => `<option value="${s}" ${e.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}</select></label><button type="submit" class="button">Save status</button></form><div class="admin-actions"><button class="button button-cream" id="convert-enquiry">Create demo booking <span aria-hidden="true">↗</span></button></div>`}<p class="admin-record-note">This is a demonstration record. Updating a status or creating a booking does not send an email, reserve inventory or collect a payment.</p><p id="record-feedback" role="status" class="admin-feedback"></p></div>`;
    const recordRoot = content.firstElementChild;
    const recordFeedback = recordRoot.querySelector('#record-feedback');
    dialog.showModal(); dialog.scrollTop = 0; document.body.classList.add('dialog-open');
    content.querySelector('#status-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const save = event.target.querySelector('button');
      save.disabled = true;
      try {
        await request(`/api/admin/enquiries/${e.id}`, { method: 'PATCH', body: JSON.stringify({ status: event.target.elements.status.value }) });
        await load();
        recordFeedback.textContent = 'Status saved. No email was sent.';
        message('Enquiry status updated.');
      } catch (error) { recordFeedback.textContent = error.message; }
      finally { save.disabled = false; }
    });
    content.querySelector('#convert-enquiry')?.addEventListener('click', async event => {
      const convert = event.currentTarget; convert.disabled = true;
      try {
        const result = await request(`/api/admin/enquiries/${e.id}/booking`, { method: 'POST', body: '{}' });
        await load();
        if (dialog.open && content.firstElementChild === recordRoot) {
          dialog.close(); switchTab(tabs[1]); search.value = ''; render();
        }
        message(`Created ${result.reference}, a demo planning record. No travel has been reserved.`);
      } catch (error) { recordFeedback.textContent = error.message; convert.disabled = false; }
    });
  });
  load().catch(() => { login.hidden = false; workspace.hidden = true; });
})();
