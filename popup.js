const SUPABASE_URL  = 'https://odhogdwxafqdlfvfbsux.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kaG9nZHd4YWZxZGxmdmZic3V4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMTM2MDAsImV4cCI6MjA4OTY4OTYwMH0.sDgtKOdVeK9Xf7VI2aNQhUO5Hs_rY2tmXD1z5pHayF8';

function orderToForm(row) {
  const tickets = {};
  const breakdown = row.ticket_breakdown || {};
  if (Object.keys(breakdown).length > 0) {
    for (const [key, val] of Object.entries(breakdown)) {
      if (!val.qty || val.qty <= 0) continue;
      const label = (val.label || '').toLowerCase();
      if (label.includes('gratuito') || label.includes('free') || label.includes('gratis')) {
        tickets['free'] = (tickets['free'] || 0) + val.qty;
      } else if (label.includes('ridotto') || label.includes('reduced') || label.includes('ue') || label.includes('eu')) {
        tickets['reduced'] = (tickets['reduced'] || 0) + val.qty;
      } else if (val.price > 0) {
        tickets['full'] = (tickets['full'] || 0) + val.qty;
      } else if (val.price === 0 && !label) {
        tickets['free'] = (tickets['free'] || 0) + val.qty;
      }
    }
  } else {
    if ((row.qty_adults  || 0) > 0) tickets['full']    = row.qty_adults;
    if ((row.qty_children|| 0) > 0) tickets['reduced'] = row.qty_children;
    if ((row.qty_seniors || 0) > 0) tickets['free']    = (tickets['free'] || 0) + row.qty_seniors;
    if ((row.qty_infants || 0) > 0) tickets['free']    = (tickets['free'] || 0) + row.qty_infants;
  }

  const visitors = [];
  if (row.visitor_name) visitors.push({ name: row.visitor_name.trim() });
  let companions = row.companion_names || [];
  if (typeof companions === 'string') { try { companions = JSON.parse(companions); } catch { companions = []; } }
  for (const c of companions) {
    const name = c.replace(/\s*\[.*\]/, '').trim();
    if (name) visitors.push({ name });
  }
  return { date: row.visit_date, timeSlot: row.time_slot, tickets, visitors };
}

function fillForm(order) {
  if (order.tickets) {
    for (const [key, val] of Object.entries(order.tickets)) {
      const el = document.getElementById(`t-${key}`);
      if (el) el.value = val;
    }
  }
  updateVisitorFields();
  if (order.visitors) restoreVisitors(order.visitors);
  chrome.storage.local.set({ lastOrderPantheon: order });
}

async function checkTabForOrder() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return false;
    const match = tab.url.match(/#scoporder=([a-zA-Z0-9-]+)/);
    if (!match) return false;
    const orderId = match[1];
    setStatus('⏳ Cargando orden...', 'info');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=*&limit=1`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!rows.length) throw new Error('Orden no encontrada');
    const order = orderToForm(rows[0]);
    fillForm(order);
    setStatus('✅ Orden precargada — revisá y clickeá Completar', 'success');
    return true;
  } catch (err) {
    setStatus('❌ Error: ' + err.message, 'error');
    return false;
  }
}

async function initPopup() {
  const loadedFromTab = await checkTabForOrder();
  if (!loadedFromTab) {
    chrome.storage.local.get(['lastOrderPantheon'], (res) => {
      if (res.lastOrderPantheon) fillForm(res.lastOrderPantheon);

  // Escuchar PRELOAD desde content script (cuando detecta #scoporder en la URL)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PRELOAD' && msg.order) {
      fillForm(msg.order);
      setStatus('Orden precargada desde URL', 'info');
    }
  });
    });
  }
}

initPopup();

const ticketInputs = document.querySelectorAll('.ticket-field input');
ticketInputs.forEach(inp => inp.addEventListener('input', updateVisitorFields));

function getTotalTickets() {
  let total = 0;
  ticketInputs.forEach(inp => { total += parseInt(inp.value) || 0; });
  return total;
}

function updateVisitorFields() {
  const container = document.getElementById('visitors-container');
  const total = getTotalTickets();
  const existing = container.querySelectorAll('input[data-visitor]');
  if (total === 0) {
    container.innerHTML = '<div style="font-size:11px; color:#999; text-align:center; padding:6px 0;">Completá los tickets arriba para ver los campos</div>';
    return;
  }
  const currentValues = {};
  existing.forEach(inp => { currentValues[inp.dataset.visitor] = inp.value; });
  container.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const row = document.createElement('div');
    row.className = 'visitor-row';
    row.innerHTML = `
      <div class="visitor-num">${i + 1}</div>
      <input type="text" data-visitor="${i}" placeholder="Nombre y apellido" value="${currentValues[i] || ''}">
    `;
    container.appendChild(row);
  }
}

function restoreVisitors(visitors) {
  setTimeout(() => {
    const inputs = document.querySelectorAll('input[data-visitor]');
    inputs.forEach((inp, i) => { if (visitors[i]) inp.value = visitors[i].name || ''; });
  }, 50);
}

function setStatus(msg, type = 'info') {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = `status ${type}`;
}

function setStep(n, state) {
  const el = document.getElementById(`s${n}`);
  if (el) { el.className = 'step'; if (state) el.classList.add(state); }
}

function resetSteps() { for (let i = 1; i <= 6; i++) setStep(i, ''); }

document.getElementById('btn-run').addEventListener('click', async () => {
  const tickets = {};
  ticketInputs.forEach(inp => {
    const key = inp.id.replace('t-', '');
    const val = parseInt(inp.value) || 0;
    if (val > 0) tickets[key] = val;
  });

  if (Object.keys(tickets).length === 0) {
    setStatus('⚠️ Seleccioná al menos 1 ticket', 'error');
    return;
  }

  const visitorInputs = document.querySelectorAll('input[data-visitor]');
  const visitors = [];
  let missingVisitor = false;
  visitorInputs.forEach(inp => {
    if (!inp.value.trim()) missingVisitor = true;
    visitors.push({ name: inp.value.trim() });
  });

  if (missingVisitor) { setStatus('⚠️ Completá todos los nombres', 'error'); return; }

  const order = { tickets, visitors };
  chrome.storage.local.set({ lastOrderPantheon: order });

  const btn = document.getElementById('btn-run');
  btn.disabled = true;
  btn.textContent = '⏳ Ejecutando...';
  resetSteps();
  setStatus('Iniciando...', 'info');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes('portale.museiitaliani.it')) {
    setStatus('❌ Abrí el sitio del Pantheon primero:\nhttps://portale.museiitaliani.it/b2c/buyTicketless/33f77159-0acd-40c4-8524-701f33aae108', 'error');
    btn.disabled = false;
    btn.textContent = '▶ Completar formulario';
    return;
  }

  // Siempre reinyectar para evitar "Receiving end does not exist"
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => { window.__scopPantheonLoaded = false; }
    });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await new Promise(r => setTimeout(r, 500));
  } catch (e) {
    setStatus('❌ No se pudo inyectar el script: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '▶ Completar formulario';
    return;
  }

  chrome.tabs.sendMessage(tab.id, { action: 'RUN_BOT', order }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus('❌ Error: ' + chrome.runtime.lastError.message, 'error');
      btn.disabled = false;
      btn.textContent = '▶ Completar formulario';
    }
  });

  chrome.runtime.onMessage.addListener(function listener(msg) {
    if (msg.type === 'STEP') {
      setStep(msg.step, 'active');
      if (msg.step > 1) setStep(msg.step - 1, 'done');
      setStatus(msg.text, 'info');
    }
    if (msg.type === 'DONE') {
      for (let i = 1; i <= 6; i++) setStep(i, 'done');
      setStatus('✅ ' + msg.text, 'success');
      btn.disabled = false;
      btn.textContent = '▶ Completar formulario';
      chrome.runtime.onMessage.removeListener(listener);
    }
    if (msg.type === 'ERROR') {
      setStatus('❌ ' + msg.text, 'error');
      btn.disabled = false;
      btn.textContent = '▶ Completar formulario';
      chrome.runtime.onMessage.removeListener(listener);
    }
  });
});
