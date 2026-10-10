// Progressive enhancement only: every page works without this file.
(() => {
  // The public form accepts shop URLs only.
  for (const form of document.querySelectorAll('[data-scan-form]')) {
    const submit = form.querySelector('[data-submit]');
    const submitLabel = form.querySelector('[data-submit-label]');
    form.addEventListener('submit', () => {
      submit.disabled = true;
      submitLabel.textContent = 'Wird gestartet …';
      form.setAttribute('aria-busy', 'true');
    });
  }

  // "Zur Prüfung" at the end of the landing page: scroll up and put the cursor in the field.
  for (const link of document.querySelectorAll('[data-focus-scan]')) {
    link.addEventListener('click', (e) => {
      const input = document.getElementById('shop-url');
      if (!input) return;
      e.preventDefault();
      input.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      input.focus({ preventScroll: true });
    });
  }

  // Progress page: poll until the report is ready, then reload into it.
  const phases = document.querySelector('[data-poll]');
  if (phases) {
    // The second opinion's step, and the health hint step this list had left out.
    const order = ['laden', 'produkte', 'seiten', 'rechtstexte', 'zweite-pruefung'];
    const tick = async () => {
      try {
        const res = await fetch(phases.dataset.poll, { headers: { Accept: 'application/json' } });
        const data = await res.json();
        if (res.status === 404 || data.status === 'fertig' || data.status === 'fehler') {
          location.reload();
          return;
        }
        const current = order.indexOf(data.phase);
        phases.querySelectorAll('[data-phase]').forEach((li, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'open';
          li.className = `phase phase--${state}`;
          li.querySelector('[data-status]').textContent = { done: 'erledigt', active: 'läuft', open: 'offen' }[state];
          li.querySelector('[data-count]').textContent = i === current ? data.count : '';
          const ratio = i < current ? 1 : i === current && data.ratio != null ? data.ratio : 0;
          li.querySelector('[data-fill]').style.setProperty('--p', String(ratio));
        });
      } catch {
        // network hiccup: try again on the next tick
      }
      setTimeout(tick, 700);
    };
    setTimeout(tick, 400);
  }

  // Report: "Fehlalarm?" sends one click to the server without leaving the page.
  for (const form of document.querySelectorAll('[data-flag]')) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = form.querySelector('button');
      const label = form.querySelector('[data-flag-label]');
      button.disabled = true;
      try {
        // Match the bounded URL-encoded feedback route.
        const res = await fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)), headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(String(res.status));
        const done = document.createElement('span');
        done.className = 'flag flag--done';
        done.setAttribute('role', 'status');
        done.textContent = 'Gemeldet, danke';
        form.replaceWith(done);
      } catch {
        button.disabled = false;
        label.textContent = 'Nicht gesendet – nochmal?';
      }
    });
  }

  // Report: filter findings by level.
  const filters = document.querySelector('[data-filters]');
  if (filters) {
    filters.hidden = false;
    const apply = (mode) => {
      document.body.dataset.filter = mode;
      for (const b of filters.querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed', String(b.dataset.filter === mode));
      for (const el of document.querySelectorAll('[data-counts]')) {
        const [risiko, pruefen] = el.dataset.counts.split(',').map(Number);
        el.hidden = mode === 'risiko' ? risiko === 0 : mode === 'pruefen' ? pruefen === 0 : false;
      }
    };
    filters.addEventListener('click', (e) => {
      const button = e.target.closest('[data-filter]');
      if (button) apply(button.dataset.filter);
    });
  }

  // One-click remedy copy snippets.
  // Retain the original label across repeated copies.
  const copyStates = new WeakMap();
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const text = btn.dataset.copy;
    if (!text) return;
    const markCopied = () => {
      const state = copyStates.get(btn) ?? { label: btn.textContent };
      clearTimeout(state.timer);
      btn.textContent = 'Kopiert!';
      btn.classList.add('is-copied');
      state.timer = setTimeout(() => {
        btn.textContent = state.label;
        btn.classList.remove('is-copied');
        copyStates.delete(btn);
      }, 2000);
      copyStates.set(btn, state);
    };
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        markCopied();
        return;
      }
    } catch {
      // fall through to fallback
    }
    // A failed fallback must not claim success or leak its textarea.
    let area;
    try {
      area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      if (document.execCommand('copy')) markCopied();
    } catch {
      // ignore
    } finally {
      area?.remove();
    }
  });
})();
