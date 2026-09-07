if (window.__scopPantheonLoaded) { throw new Error('already_loaded'); }
window.__scopPantheonLoaded = true;

const SUPABASE_URL  = 'https://odhogdwxafqdlfvfbsux.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kaG9nZHd4YWZxZGxmdmZic3V4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMTM2MDAsImV4cCI6MjA4OTY4OTYwMH0.sDgtKOdVeK9Xf7VI2aNQhUO5Hs_rY2tmXD1z5pHayF8';
const VISITOR_EMAIL = 'noproblemastore@gmail.com';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay(min = 200, max = 600) { return sleep(Math.floor(Math.random() * (max - min + 1)) + min); }
function sendStep(step, text) { chrome.runtime.sendMessage({ type: 'STEP', step, text }).catch(() => {}); }
function sendDone(text)  { chrome.runtime.sendMessage({ type: 'DONE', text }).catch(() => {}); }
function sendError(text) { chrome.runtime.sendMessage({ type: 'ERROR', text }).catch(() => {}); }

function waitFor(fn, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const el = fn();
      if (el) return resolve(el);
      if (Date.now() - start > timeout) return reject(new Error('Timeout: ' + fn.toString().slice(0, 80)));
      setTimeout(check, 300);
    };
    check();
  });
}

function scrollTo(el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return sleep(300); }

function closeLangSwitch() {
  // Cerrar el selector de idioma si está abierto
  const langBtn = document.querySelector('button[aria-label*="language" i][aria-expanded="true"], button.lang-switch[aria-expanded="true"]');
  if (langBtn) langBtn.click();
}

async function clickEl(el) {
  closeLangSwitch();
  await scrollTo(el);
  await randomDelay(150, 300);
  // Verificar que no estemos clickeando el lang-switch por error
  if (el.classList.contains('lang-switch') || el.closest('[class*="lang-switch"]')) return;
  el.click();
  await randomDelay(200, 400);
}

async function humanType(el, text) {
  closeLangSwitch();
  await scrollTo(el);
  await randomDelay(100, 200);
  closeLangSwitch();
  el.focus();
  el.value = '';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(80);
  for (const char of text) {
    el.value += char;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    await sleep(Math.floor(Math.random() * 60) + 20);
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
  await randomDelay(150, 300);
}

function findBtn(texts) {
  return Array.from(document.querySelectorAll('button, a, div[role="button"]'))
    .find(el => {
      const t = (el.innerText || el.textContent || '').trim().toLowerCase();
      return texts.some(txt => t.includes(txt.toLowerCase())) && el.offsetParent && !el.disabled;
    });
}

async function fetchOrder(orderId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=*&limit=1`,
    { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
  );
  if (!res.ok) throw new Error(`Error al obtener la orden: ${res.status}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`Orden no encontrada: ${orderId}`);
  const row = rows[0];

  // Leer ticket_breakdown para mapear correctamente segun el label real
  // Pantheon: Intero=full, Ridotto=reduced, Gratuito=free
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
      } else if (label.includes('intero') || label.includes('full') || label.includes('adult') || val.qty > 0) {
        // Fallback: si no matchea ninguno y tiene precio, es full
        if (val.price > 0 && !label.includes('ridotto') && !label.includes('reduced')) {
          tickets['full'] = (tickets['full'] || 0) + val.qty;
        } else if (val.price === 0 && !label) {
          // sin label y gratis = free
          tickets['free'] = (tickets['free'] || 0) + val.qty;
        }
      }
    }
  } else {
    // Fallback si no hay breakdown
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
    const name = c.replace(/\s*\[.*?\]/g, '').trim();
    if (name) visitors.push({ name });
  }
  return { date: row.visit_date, timeSlot: row.time_slot, tickets, visitors };
}

// PASO 1: Individuali
async function step1_selectIndividuali() {
  sendStep(1, 'Seleccionando tipo de visita...');
  const btn = await waitFor(() => {
    return Array.from(document.querySelectorAll('button, div, span, a, li'))
      .find(el => {
        const t = (el.innerText || '').trim().toLowerCase();
        return (t === 'individuali' || t === 'individual' || t === 'individuals' || t === 'singoli') && el.offsetParent;
      });
  }, 12000);
  await clickEl(btn);
  await randomDelay(800, 1500);
}

// PASO 2: Fecha en calendario
async function step2_selectDate(date) {
  sendStep(2, `Seleccionando fecha ${date}...`);
  const [year, month, day] = date.split('-').map(Number);

  await waitFor(() => document.querySelector('[class*="calendar" i], [class*="date-picker" i]'), 12000);
  await randomDelay(300, 500);

  for (let attempt = 0; attempt < 14; attempt++) {
    const headerEl = document.querySelector('[class*="month" i][class*="year" i], [class*="calendar-title" i], h2, h3');
    let calMonth = null, calYear = null;

    if (headerEl) {
      const text = (headerEl.innerText || headerEl.textContent || '').toLowerCase();
      const months = ['january','february','march','april','may','june','july','august','september','october','november','december',
                      'gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
      months.forEach((m, i) => { if (text.includes(m)) calMonth = (i % 12) + 1; });
      const yearMatch = text.match(/\d{4}/);
      if (yearMatch) calYear = parseInt(yearMatch[0]);
    }

    if (calMonth && calYear && calMonth === month && calYear === year) break;

    const goNext = !calMonth || !calYear || calYear < year || (calYear === year && calMonth < month);
    const navBtns = Array.from(document.querySelectorAll('button, span'));
    const navBtn = goNext
      ? navBtns.find(el => (el.innerText?.trim() === '>' || el.innerText?.trim() === '›' || el.getAttribute('aria-label')?.toLowerCase().includes('next') || el.className?.toLowerCase().includes('next')) && el.offsetParent)
      : navBtns.find(el => (el.innerText?.trim() === '<' || el.innerText?.trim() === '‹' || el.getAttribute('aria-label')?.toLowerCase().includes('prev') || el.className?.toLowerCase().includes('prev')) && el.offsetParent);

    if (!navBtn) break;
    await clickEl(navBtn);
    await randomDelay(200, 400);
  }

  const dayEl = await waitFor(() => {
    return Array.from(document.querySelectorAll('button, td, div, span'))
      .find(el => {
        const t = (el.innerText || el.textContent || '').trim();
        const isDay = t === String(day) || t === String(day).padStart(2, '0');
        const notDisabled = !el.classList.contains('disabled') && !el.classList.contains('unavailable') &&
                            !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true';
        const inCalendar = !!el.closest('[class*="calendar" i], [class*="date-picker" i]');
        return isDay && notDisabled && inCalendar && el.offsetParent;
      });
  }, 10000);

  await clickEl(dayEl);
  await randomDelay(400, 700);
}

// PASO 3: Time slot — usa clase timeslot-badge y aria-label
async function step3_selectTimeSlot(timeSlot) {
  sendStep(3, `Seleccionando horario ${timeSlot}...`);
  await randomDelay(400, 700);

  // El sitio renderiza botones con clase "timeslot-badge"
  // aria-label: "Select timeslot - time: 10:00-11:00 - Available tickets: 147"
  // Span interno: "10:00-11:00"
  const slotEl = await waitFor(() => {
    // Buscar por clase timeslot-badge primero
    // aria-label: "Select timeslot - time: 16:00-17:00 - Available tickets: N"
    // Buscar que el slot EMPIECE con la hora (no que la contenga)
    const byClass = Array.from(document.querySelectorAll('button[class*="timeslot-badge"], button[class*="timeslot"]'))
      .find(el => {
        const label = el.getAttribute('aria-label') || '';
        const text  = (el.innerText || el.textContent || '').trim();
        // Extraer la hora del aria-label: "time: 16:00-17:00"
        const labelTimeMatch = label.match(/time:\s*([\d:]+)/i);
        const labelTime = labelTimeMatch ? labelTimeMatch[1] : '';
        return (labelTime === timeSlot || text.startsWith(timeSlot + '-') || text === timeSlot) && el.offsetParent && !el.disabled;
      });
    if (byClass) return byClass;

    // Fallback: span hijo que empiece exactamente con "HH:MM-"
    return Array.from(document.querySelectorAll('button'))
      .find(el => {
        const span = el.querySelector('span');
        const t = span ? span.innerText.trim() : (el.innerText || '').trim();
        return t.startsWith(timeSlot + '-') && el.offsetParent && !el.disabled;
      });
  }, 12000);

  await clickEl(slotEl);
  await randomDelay(400, 700);

  const continueBtn = await waitFor(() => {
    return document.querySelector('button.forward-btn, button[class*="forward-btn"]') ||
           findBtn(['continue', 'continua', 'continuar', 'avanti', 'next', 'proceed']);
  }, 8000);
  await clickEl(continueBtn);
  await randomDelay(1000, 1800);
}

// PASO 4: Cantidad de tickets con botones +
async function step4_selectTickets(tickets) {
  sendStep(4, 'Seleccionando cantidad de tickets...');
  await randomDelay(800, 1500);

  // Cada single-ticket-selector tiene un top-layer con el titulo y un bot-layer con los botones
  // Orden en DOM: Full price, Reduced, Free, Tourist guide Free Ticket
  // Mapeamos por titulo exacto del top-layer (primer texto visible, ignorando descripcion)
  const typeTitles = {
    full:    ['full price', 'intero'],
    reduced: ['reduced', 'ridotto'],
    free:    ['free', 'gratuito'],
  };

  const allSections = Array.from(document.querySelectorAll('single-ticket-selector, [class*="single-ticket-selector"]'))
    .filter(el => el.offsetParent);

  function getTitleOfSection(el) {
    const topLayer = el.querySelector('[class*="top-layer"]');
    if (!topLayer) return '';
    // Recorrer childNodes del top-layer para encontrar el primer texto no vacio
    for (const node of topLayer.childNodes) {
      const t = (node.textContent || '').trim();
      if (t) return t.toLowerCase();
    }
    // Fallback: innerText del top-layer, primera linea
    return (topLayer.innerText || '').split('\n')[0].trim().toLowerCase();
  }

  for (const [type, qty] of Object.entries(tickets)) {
    if (!qty || qty <= 0) continue;
    const titles = typeTitles[type] || [];

    const section = allSections.find(el => {
      const title = getTitleOfSection(el);
      return titles.some(t => title === t);
    });

    if (!section) {
      console.error('Pantheon bot: no encontre seccion para tipo ' + type);
      continue;
    }

    // Boton + tiene aria-label="Add a ticket"
    const plusBtn = section.querySelector('button[aria-label="Add a ticket"]') ||
                    section.querySelector('button[aria-label*="Add a ticke"]') ||
                    Array.from(section.querySelectorAll('button[class*="counter-btn"]'))
                      .find(btn => !btn.getAttribute('aria-label')?.toLowerCase().includes('remove'));

    if (plusBtn) {
      for (let i = 0; i < qty; i++) {
        plusBtn.click();
        await randomDelay(350, 550);
      }
    }
  }

  await randomDelay(500, 800);
  // El boton tiene clase fija 'forward-btn' independientemente del texto
  const continueBtn = await waitFor(() => {
    return document.querySelector('button.forward-btn, button[class*="forward-btn"]') ||
           findBtn(['buy', 'continue', 'continua', 'continuar', 'avanti', 'checkout', 'next', 'proceed']);
  }, 8000);
  await clickEl(continueBtn);
  await randomDelay(1000, 1800);
}

// PASO 5: Continue as guest
async function step5_continueAsGuest() {
  sendStep(5, 'Continuando como invitado...');
  try {
    const guestBtn = await waitFor(() =>
      findBtn(['guest', 'ospite', 'without account', 'senza account', 'continue without', 'continua senza']), 6000);
    await clickEl(guestBtn);
    await randomDelay(800, 1500);
  } catch (e) {
    console.log('Pantheon bot: no guest popup, continuing...');
  }
}

// PASO 6: Llenar datos de visitantes
async function step6_fillVisitors(visitors) {
  sendStep(6, 'Llenando datos de visitantes...');
  await randomDelay(1000, 2000);

  await waitFor(() => document.querySelector(
    'input[placeholder*="name" i], input[placeholder*="nome" i], input[name*="name" i], input[id*="first" i]'
  ), 15000);
  await randomDelay(600, 1000);

  // Expandir secciones colapsadas
  const collapsed = Array.from(document.querySelectorAll('[aria-expanded="false"]')).filter(el => el.offsetParent);
  for (const btn of collapsed) { await clickEl(btn); await randomDelay(200, 400); }
  await randomDelay(400, 700);

  function getVisibleInputs(sel) {
    return Array.from(document.querySelectorAll(sel)).filter(el => el.offsetParent && !el.disabled);
  }

  // El sitio usa placeholder="Name" y placeholder="Lastname" exactos
  const firstNameInputs    = getVisibleInputs('input[placeholder="Name"], input[placeholder="Nome"], input[placeholder*="first name" i], input[placeholder*="nome" i], input[name*="firstName" i], input[id*="firstName" i], input[id*="first" i]');
  const lastNameInputs     = getVisibleInputs('input[placeholder="Lastname"], input[placeholder="Cognome"], input[placeholder*="last name" i], input[placeholder*="surname" i], input[placeholder*="cognome" i], input[name*="lastName" i], input[id*="last" i]');
  const emailInputs        = getVisibleInputs('input[type="email"]:not([placeholder*="confirm" i]):not([id*="confirm" i]):not([name*="confirm" i])');
  const confirmEmailInputs = getVisibleInputs('input[placeholder*="confirm" i], input[placeholder*="conferma" i], input[id*="confirm" i], input[name*="confirm" i]');

  for (let i = 0; i < visitors.length; i++) {
    const parts     = (visitors[i]?.name || visitors[0].name).trim().split(' ');
    const firstName = parts[0] || 'Scop';
    const lastName  = parts.slice(1).join(' ') || 'Tickets';

    if (firstNameInputs[i])    await humanType(firstNameInputs[i], firstName);
    if (lastNameInputs[i])     await humanType(lastNameInputs[i], lastName);
    if (emailInputs[i])        await humanType(emailInputs[i], VISITOR_EMAIL);
    if (confirmEmailInputs[i]) await humanType(confirmEmailInputs[i], VISITOR_EMAIL);
  }

  await randomDelay(500, 800);
  sendDone('Formulario completado. Revisá los datos y completá el pago.');
}

// Precarga desde URL hash
const hashMatch = window.location.hash.match(/#scoporder=([a-zA-Z0-9-]+)/);
if (hashMatch) {
  fetchOrder(hashMatch[1])
    .then(order => chrome.runtime.sendMessage({ type: 'PRELOAD', order }).catch(() => {}))
    .catch(err  => chrome.runtime.sendMessage({ type: 'ERROR', text: err.message }).catch(() => {}));
}

// Escuchar RUN_BOT — arranca directo en la pagina de seleccion de tickets
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.action !== 'RUN_BOT') return;
  const { order } = msg;
  try {
    await step4_selectTickets(order.tickets);
    await step5_continueAsGuest();
    await step6_fillVisitors(order.visitors);
  } catch (err) {
    sendError(err.message);
  }
});
