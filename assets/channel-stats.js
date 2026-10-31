// Channel stats section: loads data/channel-stats.json (written by the publisher's export-stats) and renders
// totals, the next releases, a sortable video table and an hourly/daily views chart. Vanilla JS, no build step.
(() => {
  'use strict';
  const TZ = 'America/Lima';
  const num = new Intl.NumberFormat('es-PE');
  const fmtFull = new Intl.DateTimeFormat('es-PE', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtShort = new Intl.DateTimeFormat('es-PE', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtDay = new Intl.DateTimeFormat('es-PE', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
  const fmtHour = new Intl.DateTimeFormat('es-PE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtDate = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  const STATUS = { Pending: 'Pendiente', Uploading: 'Subiendo', Scheduled: 'Programado', WaitingForQuota: 'Esperando cupo de YouTube' };
  const $ = id => document.getElementById(id);
  const el = (tag, attrs = {}, text) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };
  const n0 = v => (typeof v === 'number' && isFinite(v) ? v : null);
  const show = v => (n0(v) == null ? '—' : num.format(v));
  const date = s => { const d = s ? new Date(s) : null; return d && !isNaN(d) ? d : null; };

  function empty() {
    $('stats-updated').textContent = '';
    $('stats-body').hidden = true;
    $('stats-empty').hidden = false;
  }

  /** A queued episode cannot go out before its publish time nor before the service's retry time. */
  function expected(entry) {
    const p = date(entry.publishAt), r = date(entry.retryAt);
    return p && r && r > p ? r : p;
  }

  function cards(data) {
    const c = data.channel || {};
    const list = $('stats-cards');
    const add = (label, value, sub, wide) => {
      const li = el('li', { class: 'stats-card' + (wide ? ' wide' : '') });
      li.append(el('span', { class: 'label' }, label), el('span', { class: 'value' }, value));
      if (sub) li.append(el('span', { class: 'sub' }, sub));
      list.append(li);
    };
    add('Vistas totales', show(c.views));
    add('Vistas en 24 h', show(c.views24h));
    add('Me gusta', show(c.likes), n0(c.comments) != null ? num.format(c.comments) + ' comentarios' : null);
    add('Videos públicos', show(c.videos));
    const next = data.queue && data.queue.next;
    if (next) {
      const at = expected(next);
      add('Próximo estreno', next.title || next.episode, at ? fmtShort.format(at) + ' (hora de Perú)' : null, true);
    }
  }

  function queue(data) {
    const items = data.queue && Array.isArray(data.queue.upcoming) ? data.queue.upcoming.slice(0, 6) : [];
    if (!items.length) return;
    const ul = $('stats-queue');
    for (const it of items) {
      const li = el('li');
      const at = expected(it);
      li.append(el('span', {}, it.title || it.episode), el('span', { class: 'when' }, at ? fmtShort.format(at) : '—'));
      if (it.status === 'WaitingForQuota' || it.status === 'Uploading') li.append(el('span', { class: 'state' }, STATUS[it.status]));
      ul.append(li);
    }
    $('stats-queue-block').hidden = false;
  }

  // ---- table ----
  let rows = [], sortKey = 'views', sortDir = -1;

  function table(data) {
    rows = (Array.isArray(data.videos) ? data.videos : []).filter(v => v && typeof v.id === 'string');
    $('stats-table').tHead.querySelectorAll('th').forEach(th => th.querySelector('button').addEventListener('click', () => {
      const key = th.dataset.key;
      sortDir = key === sortKey ? -sortDir : (key === 'title' ? 1 : -1);
      sortKey = key;
      renderTable();
    }));
    renderTable();
  }

  function renderTable() {
    const t = $('stats-table');
    t.tHead.querySelectorAll('th').forEach(th => {
      if (th.dataset.key === sortKey) th.setAttribute('aria-sort', sortDir > 0 ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
    const val = (r, k) => (k === 'title' ? (r.title || '').toLocaleLowerCase('es') : (n0(r[k]) ?? -1));
    const sorted = rows.slice().sort((a, b) => {
      const x = val(a, sortKey), y = val(b, sortKey);
      return (x < y ? -1 : x > y ? 1 : 0) * sortDir || (n0(b.views) ?? -1) - (n0(a.views) ?? -1);
    });
    const body = t.tBodies[0];
    body.replaceChildren();
    if (!sorted.length) {
      const tr = el('tr');
      tr.append(el('td', { colspan: '5' }, 'Todavía no hay videos con estadísticas.'));
      body.append(tr);
      return;
    }
    for (const r of sorted) {
      const tr = el('tr');
      const td = el('td');
      td.append(el('a', { href: 'https://youtu.be/' + encodeURIComponent(r.id), rel: 'noopener' }, r.title || r.id));
      const pub = date(r.publishedAt);
      if (pub) td.append(el('span', { class: 'date' }, fmtDay.format(pub)));
      tr.append(td, el('td', {}, show(r.views)), el('td', {}, show(r.views24h)),
        el('td', { class: 'opt' }, show(r.likes)), el('td', { class: 'opt' }, show(r.comments)));
      body.append(tr);
    }
  }

  // ---- chart ----
  const series = {};
  let range = '24h';

  function chartData(data) {
    const gen = date(data.generatedAt) || new Date();
    const hourly = new Array(24).fill(0);
    let any = false;
    for (const v of data.videos || []) {
      const trend = (Array.isArray(v.trend24h) ? v.trend24h : []).slice(-24);
      trend.forEach((x, i) => { if (n0(x) != null) { hourly[24 - trend.length + i] += x; any = true; } });
    }
    series['24h'] = any ? hourly.map((y, i) => {
      const start = new Date(gen.getTime() - (24 - i) * 3600e3);
      const end = new Date(start.getTime() + 3600e3);
      return { y, label: fmtHour.format(start) + '–' + fmtHour.format(end), tick: fmtHour.format(start), unit: 'vistas' };
    }) : [];
    series.days = (Array.isArray(data.dailyViews) ? data.dailyViews : []).filter(d => d && n0(d.views) != null).map(d => {
      const day = new Date(d.date + 'T00:00:00Z');
      const label = isNaN(day) ? String(d.date) : fmtDate.format(day);
      return { y: d.views, label, tick: label, unit: 'vistas acumuladas' };
    });
    if (series.days.length >= 2) {
      const toggle = $('stats-toggle');
      toggle.hidden = false;
      toggle.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        range = b.dataset.range;
        toggle.querySelectorAll('button').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
        $('stats-chart-title').textContent = range === '24h' ? 'Vistas por hora (últimas 24 h)' : 'Vistas totales por día';
        drawChart();
      }));
    }
    drawChart();
    if ('ResizeObserver' in window) new ResizeObserver(() => drawChart()).observe($('stats-chart'));
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  let drawn = '';

  function drawChart() {
    const host = $('stats-chart');
    const pts = series[range] || [];
    const W = Math.max(240, Math.round(host.clientWidth || 600));
    if (drawn === W + range) return;
    drawn = W + range;
    host.replaceChildren();
    if (!pts.length) {
      host.append(el('p', { class: 'stats-updated' }, 'Aún no hay suficientes datos para el gráfico.'));
      return;
    }
    const H = W < 420 ? 180 : 220, L = 40, R = 10, T = 12, B = 26;
    const max = Math.max(1, ...pts.map(p => p.y));
    const step = niceStep(max / 3);
    const top = Math.ceil(max / step) * step;
    const x = i => L + (pts.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (pts.length - 1));
    const y = v => T + (H - T - B) * (1 - v / top);
    const total = pts.reduce((a, p) => a + p.y, 0);
    const summary = range === '24h'
      ? `Vistas por hora en las últimas 24 horas: ${num.format(Math.round(total))} en total, máximo ${num.format(max)} en una hora.`
      : `Vistas totales del canal por día, de ${num.format(pts[0].y)} a ${num.format(pts[pts.length - 1].y)}.`;
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', tabindex: '0',
      'aria-label': summary + ' Usa las flechas izquierda y derecha para recorrer los valores.' });

    for (let v = 0; v <= top + 1e-9; v += step) {
      svg.append(sv('line', { class: 'grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }));
      const t = sv('text', { class: 'axis', x: L - 6, y: y(v) + 4, 'text-anchor': 'end' });
      t.textContent = compact(v);
      svg.append(t);
    }
    const every = Math.max(1, Math.ceil(pts.length / (W < 420 ? 4 : 6)));
    pts.forEach((p, i) => {
      const last = i === pts.length - 1;
      if (!last && (i % every !== 0 || pts.length - 1 - i < every / 2)) return;
      const t = sv('text', { class: 'axis', x: x(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : last ? 'end' : 'middle' });
      t.textContent = p.tick;
      svg.append(t);
    });

    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
    if (pts.length > 1) {
      svg.append(sv('path', { class: 'area', d: `${d}L${x(pts.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` }));
      svg.append(sv('path', { class: 'line', d }));
    } else {
      svg.append(sv('circle', { class: 'dot', cx: x(0), cy: y(pts[0].y), r: 5 }));
    }
    const cross = sv('line', { class: 'cross', y1: T, y2: H - B, visibility: 'hidden' });
    const dot = sv('circle', { class: 'dot', r: 5, visibility: 'hidden' });
    svg.append(cross, dot);
    host.append(svg);
    const tip = el('div', { class: 'stats-tip', 'aria-hidden': 'true', hidden: '' });
    host.append(tip);

    let cur = -1;
    const focus = i => {
      cur = Math.max(0, Math.min(pts.length - 1, i));
      const p = pts[cur], cx = x(cur), cy = y(p.y);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
      tip.replaceChildren(el('span', {}, p.label + ' · '), el('strong', {}, num.format(p.y)), el('span', {}, ' ' + p.unit));
      tip.hidden = false;
      const scale = svg.getBoundingClientRect().width / W || 1;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(host.clientWidth - tw, cx * scale - tw / 2)) + 'px';
      tip.style.top = Math.max(0, cy * scale - 44) + 'px';
    };
    const hide = () => {
      cur = -1;
      tip.hidden = true;
      cross.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
    };
    svg.addEventListener('pointermove', e => {
      const r = svg.getBoundingClientRect();
      const px = (e.clientX - r.left) * W / r.width;
      focus(pts.length === 1 ? 0 : Math.round((px - L) / ((W - L - R) / (pts.length - 1))));
    });
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        focus(cur < 0 ? pts.length - 1 : cur + (e.key === 'ArrowRight' ? 1 : -1));
      } else if (e.key === 'Escape') hide();
    });
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
    const f = raw / p;
    return Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p);
  }

  function compact(v) {
    return v >= 1e6 ? +(v / 1e6).toFixed(1) + ' M' : v >= 1e4 ? +(v / 1e3).toFixed(1) + ' k' : num.format(v);
  }

  fetch('data/channel-stats.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(data => {
      if (!data || typeof data !== 'object' || !data.channel) throw new Error('unexpected data');
      const gen = date(data.generatedAt);
      $('stats-updated').textContent = gen ? 'Actualizado el ' + fmtFull.format(gen) + ' (hora de Perú)' : '';
      $('stats-body').hidden = false;
      cards(data);
      queue(data);
      table(data);
      chartData(data);
    })
    .catch(empty);
})();
