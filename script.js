/* ===========================================================
 * Calendario Musicala – TSV + Firebase + Filtros + Heurísticas
 * - Agrega múltiples TSV (APP_CONFIG.CSV_SHEETS)
 * - Festivos opcional (APP_CONFIG.FESTIVOS_TSV)
 * - Heurísticas robustas para detectar FECHA y DESCRIPCIÓN
 * - Botón "Ver todo" + filtros por categoría
 * - Checkboxes en tiempo real (window.fbChecks)
 * - Solo muestra el nombre del evento (no el origen)
 * =========================================================== */

(() => {
  'use strict';

  // -----------------------------
  // Config
  // -----------------------------
  const CFG = window.APP_CONFIG || {};
  const SHEETS = Array.isArray(CFG.CSV_SHEETS) ? CFG.CSV_SHEETS : [];
  const FESTIVOS_TSV = CFG.FESTIVOS_TSV || '';
  const POLLING_MS = Number(CFG.POLLING_MS || 0);

  // -----------------------------
  // UI
  // -----------------------------
  const els = {
    monthHeader: document.getElementById('monthHeader'),
    grid: document.getElementById('grid'),
    status: document.getElementById('status'),
    btnPrev: document.getElementById('btnPrev'),
    btnNext: document.getElementById('btnNext'),
    btnToday: document.getElementById('btnToday'),
    tplEvent: document.getElementById('tpl-event'),
    // Filtros
    pillAll: document.getElementById('pillAll'),
    pills: Array.from(document.querySelectorAll('.pillbar .pill:not(#pillAll)')),
  };

  // -----------------------------
  // Estado
  // -----------------------------
  let CURRENT = new Date();
  CURRENT.setDate(1);

  let DATA = {
    events: [],   // [{fechaISO, descripcion, origen, key}]
    festivos: []  // [{fechaISO, nombre}]
  };

  // Categoría activa (slug) — null = todas
  let ACTIVE_CATEGORY = null;

  // -----------------------------
  // Utils
  // -----------------------------
  const pad2 = n => String(n).padStart(2, '0');

  function normalize(str) {
    return String(str || '')
      .replace(/\uFEFF/g, '')  // quita BOM
      .trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function slugOf(cat){
    return normalize(cat).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  }

  function toISO(d) {
    // Date -> ISO
    if (Object.prototype.toString.call(d) === '[object Date]') {
      return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
    }
    let s = String(d || '').trim().replace(/\uFEFF/g,'');
    if (!s) return '';

    // yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // dd/mm/aaaa | d-m-aaaa | dd.mm.aaaa
    let m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (m) return `${m[3]}-${pad2(+m[2])}-${pad2(+m[1])}`;

    // Fecha Google Sheets (número de días)
    if (!isNaN(+s)) {
      const num = +s;
      if (num > 20000 && num < 90000) {
        const base = new Date(Date.UTC(1899, 11, 30));
        const dt = new Date(base.getTime() + num * 86400000);
        return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth()+1)}-${pad2(dt.getUTCDate())}`;
      }
    }
    // Si es algo como "15/03" (sin año), lo dejamos tal cual (no ideal, pero evita perderlo)
    return s;
  }

  function humanMonth(d){
    const fmt = new Intl.DateTimeFormat('es-CO', { month:'long', year:'numeric' });
    const s = fmt.format(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function setStatus(msg){
    if (els.status) els.status.textContent = msg || '';
  }

  function ensureKey(ev){
    const fecha = toISO(ev.fechaISO);
    const desc  = normalize(ev.descripcion);
    const orig  = normalize(ev.origen);
    ev.key = ev.key || `${fecha}|${desc}|${orig}`;
    return ev;
  }

  // -----------------------------
  // TSV parsing + heurísticas
  // -----------------------------
  async function fetchText(url){
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      const t = await res.text().catch(()=> '');
      throw new Error(`TSV ${res.status} ${res.statusText} :: ${t.slice(0,180)}`);
    }
    return res.text();
  }

  function parseTSV(text){
    const clean = text.replace(/\r/g,'');
    const rows = clean.split('\n').map(r => r.split('\t'));
    // Quita filas donde todas las celdas están vacías
    const filtered = rows.filter(r => r.some(c => String(c||'').trim().length));
    if (!filtered.length) return { header: [], data: [] };
    const header = filtered[0].map(h => h.replace(/\uFEFF/g,'').trim());
    const data = filtered.slice(1);
    return { header, data };
  }

  // Heurísticas:
  // - Fecha: palabras clave comunes (incluye "nacimiento", "cumple") o columna que más "parezca fecha"
  // - Descripción: actividad/evento/detalle/descripcion/tarea/asunto/nombre/cumpleañero/persona/cliente
  function findIdxSmart(header, data){
    const low = header.map(h => normalize(h).toLowerCase());

    let idxFecha = low.findIndex(h =>
      h.includes('fecha') || h.includes('dia ') || h.includes('día') ||
      h.includes('nacimiento') || h.includes('cumple')
    );

    let idxDesc = low.findIndex(h =>
      h.includes('activ') || h.includes('evento') || h.includes('detalle') ||
      h.includes('descrip') || h.includes('tarea') || h.includes('asunto') ||
      h.includes('titulo') || h.includes('título') ||
      h.includes('nombre') || h.includes('cumplean') || h.includes('persona') || h.includes('cliente')
    );

    // Si no encontró fecha, prueba por contenido
    if (idxFecha === -1) {
      const cols = header.length;
      let bestCol = -1, bestScore = -1;
      const scan = Math.min(30, data.length);
      for (let c=0; c<cols; c++){
        let score = 0;
        for (let r=0; r<scan; r++){
          const raw = String(data[r][c] || '').trim();
          if (!raw) continue;
          if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) score += 3;
          else if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(raw)) score += 2;
          else if (!isNaN(+raw) && +raw > 20000 && +raw < 90000) score += 1; // número de Google
        }
        if (score > bestScore) { bestScore = score; bestCol = c; }
      }
      idxFecha = bestScore > 0 ? bestCol : -1;
    }

    // Si no encontró descripción, elige la columna con más texto "rico"
    if (idxDesc === -1) {
      const cols = header.length;
      let bestCol = -1, bestScore = -1;
      const scan = Math.min(30, data.length);
      for (let c=0; c<cols; c++){
        if (c === idxFecha) continue;
        let score = 0;
        for (let r=0; r<scan; r++){
          const v = String(data[r][c] || '').trim();
          if (v && v.length >= 2) {
            // penaliza si parece fecha
            if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(v) || /^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
            score += Math.min(8, v.length); // favorece texto
          }
        }
        if (score > bestScore) { bestScore = score; bestCol = c; }
      }
      idxDesc = bestScore > 0 ? bestCol : -1;
    }

    return { idxFecha, idxDesc };
  }

  async function fetchEventsFromSheet(name, url){
    try {
      const txt = await fetchText(url);
      const { header, data } = parseTSV(txt);
      if (!header.length) return [];

      const { idxFecha, idxDesc } = findIdxSmart(header, data);
      if (idxFecha === -1 || idxDesc === -1) {
        console.warn(`[TSV] No encontré columnas (fecha/descripcion) en "${name}". Header:`, header);
        return [];
      }

      const out = [];
      for (const row of data) {
        const f = toISO(row[idxFecha] || '');
        const d = normalize(row[idxDesc] || '');
        if (!f || !d) continue;
        // Fuerza origen = name (para que case con las píldoras)
        const o = name;
        out.push(ensureKey({ fechaISO: f, descripcion: d, origen: o }));
      }
      return out;
    } catch (e) {
      console.error(`[TSV] Error en hoja "${name}":`, e);
      return [];
    }
  }

  async function fetchAllEvents(){
    const lists = await Promise.all(
      SHEETS.map(s => fetchEventsFromSheet(s.name, s.url))
    );
    const events = lists.flat();
    events.sort((a,b)=>
      a.fechaISO.localeCompare(b.fechaISO) ||
      normalize(a.origen).localeCompare(normalize(b.origen)) ||
      normalize(a.descripcion).localeCompare(normalize(b.descripcion))
    );
    return events;
  }

  async function fetchFestivos(){
    if (!FESTIVOS_TSV) return [];
    try {
      const txt = await fetchText(FESTIVOS_TSV);
      const { header, data } = parseTSV(txt);
      if (!header.length) return [];
      const low = header.map(h => normalize(h).toLowerCase());
      const idxFecha = low.findIndex(h => h.includes('fecha'));
      const idxName  = low.findIndex(h => h.includes('festivo') || h.includes('nombre') || h.includes('descripcion'));
      if (idxFecha === -1) return [];

      const out = [];
      for (const r of data) {
        const f = toISO(r[idxFecha] || '');
        const n = (idxName >= 0 ? String(r[idxName]||'').trim() : 'Festivo');
        if (!f) continue;
        out.push({ fechaISO: f, nombre: n });
      }
      return out;
    } catch (e) {
      console.warn('[TSV] No pude cargar festivos:', e);
      return [];
    }
  }

  async function loadData(){
    setStatus('Cargando eventos…');
    try {
      const [events, festivos] = await Promise.all([
        fetchAllEvents(),
        fetchFestivos()
      ]);
      DATA.events = events;
      DATA.festivos = festivos;
      setStatus(`Listo • ${events.length} eventos`);
      renderMonth(CURRENT);
    } catch (e) {
      console.error(e);
      setStatus(`Error al cargar eventos: ${e.message}`);
      DATA = { events: [], festivos: [] };
      renderMonth(CURRENT);
    }
  }

  // -----------------------------
  // Filtros (píldoras + Ver todo)
  // -----------------------------
  function bindPillFilters(){
    // "Ver todo"
    if (els.pillAll) {
      els.pillAll.addEventListener('click', () => {
        ACTIVE_CATEGORY = null;
        els.pillAll.classList.add('active');
        els.pillAll.setAttribute('aria-pressed','true');
        els.pills.forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed','false'); });
        renderMonth(CURRENT);
        setStatus('Mostrando todas las categorías');
      });
      // por defecto, activo "ver todo"
      els.pillAll.classList.add('active');
      els.pillAll.setAttribute('aria-pressed','true');
    }

    // categorías
    els.pills.forEach(p => {
      const label = p.textContent.trim();
      const slug  = slugOf(label);
      p.dataset.slug = slug;
      p.setAttribute('role','button');
      p.setAttribute('aria-pressed','false');

      p.addEventListener('click', () => {
        ACTIVE_CATEGORY = slug; // guardamos slug
        // activo solo esta
        els.pills.forEach(x => {
          const on = x === p;
          x.classList.toggle('active', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        // desactivo "ver todo"
        if (els.pillAll) {
          els.pillAll.classList.remove('active');
          els.pillAll.setAttribute('aria-pressed','false');
        }
        renderMonth(CURRENT);
        setStatus(`Filtrando: ${label}`);
      });
    });
  }

  // -----------------------------
  // Render calendario
  // -----------------------------
  function startOfCalendarGrid(d) {
    const base = new Date(d.getFullYear(), d.getMonth(), 1);
    const dow = base.getDay(); // 0=Dom
    base.setDate(base.getDate() - dow);
    return base;
  }

  function groupEventsByDate() {
    const map = new Map();
    for (const ev of DATA.events) {
      const iso = toISO(ev.fechaISO);
      if (!map.has(iso)) map.set(iso, []);
      map.get(iso).push(ev);
    }
    for (const list of map.values()) {
      list.sort((a,b)=> normalize(a.origen).localeCompare(normalize(b.origen)) || normalize(a.descripcion).localeCompare(normalize(b.descripcion)));
    }
    return map;
  }

  function festivosSet() {
    const s = new Set();
    for (const f of DATA.festivos) s.add(toISO(f.fechaISO));
    return s;
  }

  function createEventItem(ev){
    let item, chk, textSpan;
    if (els.tplEvent) {
      item = els.tplEvent.content.firstElementChild.cloneNode(true);
      chk = item.querySelector('input[type="checkbox"]');
      textSpan = item.querySelector('.text');
    } else {
      item = document.createElement('div');
      item.className = 'event-item';
      textSpan = document.createElement('span');
      textSpan.className = 'text';
      chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'evt-check';
      item.appendChild(textSpan);
      item.appendChild(chk);
    }

    // Solo nombre del evento
    textSpan.textContent = ev.descripcion;

    // ✅ Clase de color por categoría (aplica estilos CSS cat-*)
    const slug = slugOf(ev.origen);
    item.classList.add(`cat-${slug}`);
    item.title = ev.origen; // hint al pasar el mouse

    // Día “hecho” en tiempo real
    if (window.fbChecks) {
      window.fbChecks.watch(ev.key, (val) => {
        chk.checked = !!val;
        item.classList.toggle('done', !!val);
      });

      chk.addEventListener('change', async () => {
        try {
          await window.fbChecks.set(ev.key, chk.checked);
        } catch (e) {
          console.error(e);
          chk.checked = !chk.checked; // rollback
          item.classList.toggle('done', chk.checked);
          alert('No pude guardar el check 😥');
        }
      });
    } else {
      // Si no hay Firebase, deshabilita
      chk.disabled = true;
      chk.title = 'Habilita Firebase en index.html para marcar';
      chk.style.opacity = '0.5';
    }

    return item;
  }

  function renderMonth(d) {
    if (els.monthHeader) els.monthHeader.textContent = humanMonth(d);

    const first = startOfCalendarGrid(d);
    const holi = festivosSet();
    const map  = groupEventsByDate();

    els.grid.innerHTML = '';

    for (let i = 0; i < 42; i++) {
      const day = new Date(first);
      day.setDate(first.getDate() + i);

      const cell = document.createElement('div');
      cell.className = 'day';
      if (day.getMonth() !== d.getMonth()) cell.style.opacity = '0.5';

      const num = document.createElement('div');
      num.className = 'num';
      num.textContent = String(day.getDate());
      cell.appendChild(num);

      const iso = toISO(day);

      if (holi.has(iso)) {
        cell.classList.add('holiday');
      }

      // resaltar día actual
      const todayISO = toISO(new Date());
      if (iso === todayISO) {
        cell.classList.add('today');
      }

      const events = map.get(iso) || [];
      for (const ev of events) {
        // Filtro por categoría activa (slug)
        if (ACTIVE_CATEGORY && slugOf(ev.origen) !== ACTIVE_CATEGORY) continue;
        const item = createEventItem(ev);
        cell.appendChild(item);
      }

      els.grid.appendChild(cell);
    }
  }

  // -----------------------------
  // Navegación
  // -----------------------------
  function prevMonth(){
    CURRENT.setMonth(CURRENT.getMonth() - 1);
    renderMonth(CURRENT);
  }
  function nextMonth(){
    CURRENT.setMonth(CURRENT.getMonth() + 1);
    renderMonth(CURRENT);
  }
  function goToday(){
    const now = new Date();
    CURRENT = new Date(now.getFullYear(), now.getMonth(), 1);
    renderMonth(CURRENT);
  }

  function bindUI(){
    els.btnPrev && els.btnPrev.addEventListener('click', prevMonth);
    els.btnNext && els.btnNext.addEventListener('click', nextMonth);
    els.btnToday && els.btnToday.addEventListener('click', goToday);
    bindPillFilters();
  }

  // -----------------------------
  // Polling (refrescar eventos)
  // -----------------------------
  let pollingTimer = null;
  function startPolling(){
    if (!POLLING_MS || POLLING_MS < 5000) return; // mínimo 5s
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = setInterval(async () => {
      try {
        const latestEvents = await fetchAllEvents();
        const changed = latestEvents.length !== DATA.events.length;
        DATA.events = latestEvents;
        if (changed) renderMonth(CURRENT);
      } catch (e) {
        console.warn('Polling error', e);
      }
    }, POLLING_MS);
  }

  // -----------------------------
  // Init
  // -----------------------------
  (async function init(){
    bindUI();
    await loadData();
    startPolling();
  })();

})();
