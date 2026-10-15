(() => {
  // The hosting package supplies a PHP endpoint; local Node routes stay unchanged.
  const phpEndpoint = document.querySelector('meta[name="api-endpoint"]')?.content;
  window.elsewhereApi = path => phpEndpoint ? `${phpEndpoint}?route=${encodeURIComponent(path.replace(/^\/api\//, ''))}` : path;
  const menuButton = document.querySelector('.menu-toggle');
  const mobileNav = document.getElementById('mobile-nav');
  function closeMenu() {
    mobileNav.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
  }
  menuButton?.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    mobileNav.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !mobileNav.hidden) { closeMenu(); menuButton.focus(); }
  });
  matchMedia('(min-width: 651px)').addEventListener('change', event => { if (event.matches) closeMenu(); });

  const dialog = document.getElementById('content-dialog');
  const dialogContent = document.getElementById('dialog-content');
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-dialog]');
    if (!trigger) return;
    const template = document.getElementById(trigger.dataset.dialog);
    if (!template || template.tagName !== 'TEMPLATE') return;
    dialogContent.replaceChildren(template.content.cloneNode(true));
    dialog.showModal();
    dialog.scrollTop = 0;
    document.body.classList.add('dialog-open');
  });
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => document.body.classList.remove('dialog-open'));

  const destinationGroup = document.querySelector('[data-filter-group="destinations"]');
  if (destinationGroup) {
    let region = '';
    const input = document.getElementById('destination-search');
    const cards = [...destinationGroup.querySelectorAll('.destination-card')];
    const chips = [...destinationGroup.querySelectorAll('[data-region-filter]')];
    function filterDestinations() {
      const term = input.value.trim().toLowerCase();
      let count = 0;
      cards.forEach(card => {
        card.hidden = !!((region && card.dataset.region !== region) || !card.dataset.search.includes(term));
        if (!card.hidden) count++;
      });
      destinationGroup.querySelector('.results-count').textContent = `${count} ${count === 1 ? 'place' : 'places'} to begin`;
      destinationGroup.querySelector('.empty-state').hidden = count !== 0;
      chips.forEach(chip => {
        chip.classList.toggle('active', chip.dataset.regionFilter === region);
        chip.setAttribute('aria-pressed', String(chip.dataset.regionFilter === region));
      });
    }
    chips.forEach(chip => chip.addEventListener('click', () => { region = chip.dataset.regionFilter; filterDestinations(); }));
    input.addEventListener('input', filterDestinations);
    destinationGroup.querySelector('[data-reset-filters]').addEventListener('click', () => { region = ''; input.value = ''; filterDestinations(); });
  }

  const journeyGroup = document.querySelector('[data-filter-group="journeys"]');
  if (journeyGroup) {
    const destination = document.getElementById('journey-destination');
    const style = document.getElementById('journey-style');
    const sort = document.getElementById('journey-sort');
    const grid = journeyGroup.querySelector('.journey-grid');
    const cards = [...grid.children];
    const params = new URLSearchParams(location.search);
    const applyParam = (select, key) => {
      const value = params.get(key);
      if (value && [...select.options].some(option => option.value === value)) select.value = value;
    };
    applyParam(destination, 'destination');
    applyParam(style, 'style');
    function filterJourneys() {
      let count = 0;
      const ordered = [...cards];
      if (sort.value !== 'featured') ordered.sort((a, b) => Number(a.dataset[sort.value === 'price' ? 'price' : 'days']) - Number(b.dataset[sort.value === 'price' ? 'price' : 'days']));
      ordered.forEach(card => {
        card.hidden = !!((destination.value && card.dataset.destination !== destination.value) || (style.value && card.dataset.style !== style.value));
        if (!card.hidden) count++;
        grid.append(card);
      });
      journeyGroup.querySelector('.results-count').textContent = `${count} ${count === 1 ? 'way' : 'ways'} to find yourself elsewhere`;
      journeyGroup.querySelector('.empty-state').hidden = count !== 0;
      const query = new URLSearchParams();
      if (destination.value) query.set('destination', destination.value);
      if (style.value) query.set('style', style.value);
      history.replaceState(null, '', `${location.pathname}${query.size ? `?${query}` : ''}`);
    }
    [destination, style, sort].forEach(select => select.addEventListener('change', filterJourneys));
    journeyGroup.querySelectorAll('[data-reset-filters]').forEach(button => button.addEventListener('click', () => { destination.value = ''; style.value = ''; sort.value = 'featured'; filterJourneys(); }));
    filterJourneys();
  }

  const form = document.getElementById('enquiry-form');
  if (form) {
    const params = new URLSearchParams(location.search);
    ['destination', 'journey'].forEach(name => {
      if ([...form.elements[name].options].some(option => option.value === params.get(name))) form.elements[name].value = params.get(name);
    });
    form.elements.journey.addEventListener('change', () => {
      const destination = form.elements.journey.selectedOptions[0]?.dataset.destination;
      if (destination) form.elements.destination.value = destination;
    });
    form.elements.destination.addEventListener('change', () => {
      const journeyDestination = form.elements.journey.selectedOptions[0]?.dataset.destination;
      if (journeyDestination && journeyDestination !== form.elements.destination.value) form.elements.journey.value = '';
    });
    const date = new Date();
    const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    form.elements.departure.min = today;
    const error = document.getElementById('form-error');
    const submit = form.querySelector('[type="submit"]');
    const originalLabel = submit.innerHTML;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = 'Saving your demo enquiry…';
      const data = Object.fromEntries(new FormData(form));
      data.travelers = Number(data.travelers);
      data.consent = form.elements.consent.checked;
      try {
        const response = await fetch(window.elsewhereApi('/api/enquiries'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'We couldn’t save your enquiry. Please try again.');
        document.getElementById('enquiry-reference').textContent = body.reference;
        form.hidden = true;
        const success = document.getElementById('enquiry-success');
        success.hidden = false;
        success.focus();
        success.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
      } catch (failure) {
        error.textContent = failure instanceof TypeError ? 'The demo server is unavailable. Please try again in a moment.' : failure.message;
        error.hidden = false;
      } finally {
        submit.disabled = false;
        submit.innerHTML = originalLabel;
      }
    });
    document.getElementById('new-enquiry').addEventListener('click', () => {
      document.getElementById('enquiry-success').hidden = true;
      form.hidden = false;
      form.reset();
      form.elements.firstName.focus();
    });
  }
})();
