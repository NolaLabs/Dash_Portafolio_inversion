/* ============================================================================
   NOLA LABS · TABLERO PORTAFOLIO
   Gestión de portafolio de inversión: posiciones, movimientos, salud 0–100
   y sugerencias según perfil de riesgo. Nube en vivo vía Supabase.

   El código trae una PLANTILLA genérica de arranque; los datos reales del
   cliente viven en la nube (tabla `portafolios`, RLS por usuario) y se
   cargan al iniciar sesión. Ver README.md y supabase-setup.sql.
   ============================================================================ */

const SUPABASE_CDN = 'https://esm.sh/@supabase/supabase-js@2';

const CFG = {
  url: 'https://baqevhsyawugvekqbwsm.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhcWV2aHN5YXd1Z3Zla3Fid3NtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4NDU3NTIsImV4cCI6MjA5ODQyMTc1Mn0.td_VHz332hqV9l0Rxij7D3qGC1tM2oe1obrOaOFXnzw',
};

const CLAVE_LOCAL = 'Nola$2026';
const LS_KEY = 'nola_portafolio_v1';

/* Catálogo de instrumentos que el motor de sugerencias puede proponer,
   por sector objetivo. Precios se llenan con "Actualizar precios". */
const CATALOGO = {
  indice:     [{ sym: 'VOO', nombre: 'Vanguard S&P 500 ETF' }],
  tech:       [{ sym: 'VGT', nombre: 'Vanguard Information Technology ETF' }, { sym: 'MSFT', nombre: 'Microsoft Corp' }],
  salud:      [{ sym: 'XLV', nombre: 'Health Care Select Sector SPDR' }, { sym: 'VHT', nombre: 'Vanguard Health Care ETF' }],
  financiero: [{ sym: 'XLF', nombre: 'Financial Select Sector SPDR' }, { sym: 'VFH', nombre: 'Vanguard Financials ETF' }],
  oro:        [{ sym: 'GLD', nombre: 'SPDR Gold Trust' }],
  emergentes: [{ sym: 'VWO', nombre: 'Vanguard FTSE Emerging Markets ETF' }],
  innovacion: [{ sym: 'ARKK', nombre: 'ARK Innovation ETF' }],
};

/* Plantilla genérica (sin datos reales — los reales viven en la nube). */
const PLANTILLA = {
  cliente: {
    nombre: 'Cliente demo', perfil: 'moderado',
    objetivo: 'Rentabilidad sostenible con diversificación.',
    inicio: '2026-01-01', broker: '—', cuenta: '—', capitalAportado: 1000,
  },
  targets: {
    cashMin: 0.05, cashMax: 0.12, maxPosicion: 0.25, minHoldingDias: 90,
    sectores: {
      indice:     { label: 'Índice EEUU (core)', peso: 0.28 },
      tech:       { label: 'Tecnología', peso: 0.22 },
      salud:      { label: 'Salud', peso: 0.12 },
      financiero: { label: 'Financiero', peso: 0.10 },
      oro:        { label: 'Oro / cobertura', peso: 0.10 },
      emergentes: { label: 'Emergentes', peso: 0.08 },
      innovacion: { label: 'Innovación (alto riesgo)', peso: 0.05 },
    },
  },
  cash: 200,
  posiciones: [
    { sym: 'VOO', nombre: 'Vanguard S&P 500 ETF', sector: 'indice', qty: 1, costo: 600, precio: 650, precioFecha: '', compradoEl: '2026-01-15' },
  ],
  movimientos: [
    { fecha: '2026-01-15', tipo: 'deposito', sym: '', qty: 0, precio: 0, monto: 1000, nota: 'Aporte inicial' },
    { fecha: '2026-01-15', tipo: 'compra', sym: 'VOO', qty: 1, precio: 600, monto: 600, nota: '' },
  ],
  historial: [{ fecha: '2026-01-15', total: 1000, cash: 400, equities: 600 }],
  quotes: {},
};

/* ---------------- estado ---------------- */
let D = null;            // datos vivos
let sb = null;           // cliente supabase
let uid = null;          // usuario nube
let modo = null;         // 'nube' | 'local'
let saveTimer = null;
let lastSavedAt = null;
let pane = 'resumen';

/* ---------------- utilidades ---------------- */
const $ = (s) => document.querySelector(s);
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const fm = (v) => usd.format(v || 0);
const fp = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hoy = () => new Date().toISOString().slice(0, 10);
const dias = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------------- cálculos ---------------- */
function posiciones() {
  const total = totalPortafolio();
  return (D.posiciones || []).map((p) => {
    const valor = p.qty * p.precio;
    const pl = valor - p.costo;
    return { ...p, valor, pl, plPct: p.costo ? pl / p.costo : 0, peso: total ? valor / total : 0 };
  });
}
const equitiesVal = () => (D.posiciones || []).reduce((s, p) => s + p.qty * p.precio, 0);
const totalPortafolio = () => equitiesVal() + (D.cash || 0);

function pesosSector() {
  const total = totalPortafolio();
  const w = {};
  for (const k of Object.keys(D.targets.sectores)) w[k] = 0;
  for (const p of D.posiciones || []) {
    if (!(p.sector in w)) w[p.sector] = 0;
    w[p.sector] += total ? (p.qty * p.precio) / total : 0;
  }
  return w;
}

function ventasCortas() {
  /* ventas cuya tenencia fue menor a minHoldingDias (últimos 12 meses) */
  const min = D.targets.minHoldingDias || 90;
  const compras = {};
  const out = [];
  const movs = [...(D.movimientos || [])].sort((a, b) => a.fecha.localeCompare(b.fecha));
  for (const m of movs) {
    if (m.tipo === 'compra') { if (!compras[m.sym]) compras[m.sym] = m.fecha; }
    if (m.tipo === 'venta' && compras[m.sym]) {
      const d = dias(compras[m.sym], m.fecha);
      if (d < min && dias(m.fecha, hoy()) < 365) out.push({ sym: m.sym, dias: d, fecha: m.fecha });
      delete compras[m.sym];
    }
  }
  return out;
}

function retornoPortafolio() {
  const cap = D.cliente.capitalAportado || 0;
  return cap ? totalPortafolio() / cap - 1 : 0;
}

function retornoBenchmark() {
  /* VOO como referencia del mercado desde el inicio del mandato */
  const base = 630.50; // precio de compra VOO 13-feb-2026 (inicio del portafolio)
  const q = (D.quotes || {}).VOO;
  const voo = (D.posiciones || []).find((p) => p.sym === 'VOO');
  const precioActual = q?.price || voo?.precio || base;
  return precioActual / base - 1;
}

/* -------- salud: scoring 0–100 en 6 dimensiones -------- */
function salud() {
  const t = D.targets;
  const total = totalPortafolio();
  const pos = posiciones();
  const cashW = total ? (D.cash || 0) / total : 0;
  const dims = [];

  // 1 · Cobertura de sectores objetivo (peso 25)
  const w = pesosSector();
  let sumGap = 0;
  const faltantes = [];
  for (const [k, cfg] of Object.entries(t.sectores)) {
    const gap = cfg.peso - (w[k] || 0);
    sumGap += Math.abs(gap);
    if ((w[k] || 0) < 0.005 && cfg.peso >= 0.08) faltantes.push(cfg.label);
  }
  const sectores = clamp(Math.round(100 - sumGap * 160), 0, 100);
  dims.push({
    label: 'Cobertura de sectores objetivo', peso: 25, score: sectores,
    detalle: faltantes.length
      ? `Sin exposición a: ${faltantes.join(' · ')}. La desviación total frente a la asignación objetivo es ${fp(sumGap)}.`
      : `Desviación total frente a la asignación objetivo: ${fp(sumGap)}.`,
  });

  // 2 · Diversificación (peso 20)
  const eq = equitiesVal();
  const hhi = eq ? pos.reduce((s, p) => s + Math.pow(p.valor / eq, 2), 0) : 1;
  let diver = clamp(Math.round(100 * (0.45 - hhi) / (0.45 - 0.15)), 0, 100);
  const grandes = pos.filter((p) => p.peso > t.maxPosicion);
  if (grandes.length) diver = Math.max(0, diver - 15 * grandes.length);
  dims.push({
    label: 'Diversificación', peso: 20, score: diver,
    detalle: `${pos.length} posiciones · índice de concentración (HHI) ${hhi.toFixed(2)}${grandes.length ? ` · ${grandes.map((g) => g.sym).join(', ')} supera el ${fp(t.maxPosicion, 0)} máximo por posición` : ''}.`,
  });

  // 3 · Alineación con el perfil (peso 15)
  const altoRiesgo = pos.filter((p) => p.sector === 'innovacion').reduce((s, p) => s + p.peso, 0);
  const singles = pos.filter((p) => !/ETF|SPDR|Vanguard|iShares|Trust|Select/i.test(p.nombre)).reduce((s, p) => s + p.peso, 0);
  let perfil = 100;
  const limAlto = (t.sectores.innovacion?.peso ?? 0.05) + 0.03;
  if (altoRiesgo > limAlto) perfil -= Math.round((altoRiesgo - limAlto) * 400);
  if (singles > 0.25) perfil -= Math.round((singles - 0.25) * 250);
  perfil = clamp(perfil, 0, 100);
  dims.push({
    label: `Alineación con perfil ${esc(D.cliente.perfil)}`, peso: 15, score: perfil,
    detalle: `Activos de alto riesgo: ${fp(altoRiesgo)} del portafolio · acciones individuales: ${fp(singles)}.`,
  });

  // 4 · Disciplina de rotación (peso 15)
  const cortas = ventasCortas();
  const rotacion = clamp(100 - cortas.length * 22, 0, 100);
  dims.push({
    label: 'Disciplina de rotación', peso: 15, score: rotacion,
    detalle: cortas.length
      ? `${cortas.length} ventas antes de ${t.minHoldingDias} días de tenencia (${cortas.map((c) => `${c.sym} a ${c.dias}d`).join(' · ')}). La rotación corta erosiona el retorno.`
      : `Sin ventas antes de ${t.minHoldingDias} días. Buen manejo del horizonte.`,
  });

  // 5 · Despliegue de capital (peso 15)
  let cashScore = 100;
  if (cashW > t.cashMax) cashScore = clamp(Math.round(100 - (cashW - t.cashMax) * 380), 0, 100);
  if (cashW < t.cashMin) cashScore = clamp(Math.round(100 - (t.cashMin - cashW) * 600), 0, 100);
  dims.push({
    label: 'Despliegue de capital', peso: 15, score: cashScore,
    detalle: `Efectivo: ${fp(cashW)} del portafolio (banda objetivo ${fp(t.cashMin, 0)}–${fp(t.cashMax, 0)}). ${cashW > t.cashMax ? 'Hay capital ocioso sin trabajar.' : cashW < t.cashMin ? 'Colchón de liquidez muy bajo.' : 'Dentro de la banda.'}`,
  });

  // 6 · Desempeño vs. mercado (peso 10)
  const rp = retornoPortafolio();
  const rb = retornoBenchmark();
  const diff = rp - rb;
  const desemp = clamp(Math.round(60 + diff * 300), 0, 100);
  dims.push({
    label: 'Desempeño vs. mercado', peso: 10, score: desemp,
    detalle: `Retorno del portafolio ${fp(rp)} vs. S&P 500 (VOO) ${fp(rb)} desde el inicio — diferencia ${fp(diff)}.`,
  });

  const score = Math.round(dims.reduce((s, d) => s + d.score * d.peso, 0) / dims.reduce((s, d) => s + d.peso, 0));
  return { score, dims };
}

/* -------- motor de sugerencias según perfil -------- */
function sugerencias() {
  const t = D.targets;
  const total = totalPortafolio();
  const pos = posiciones();
  const w = pesosSector();
  const out = [];
  if (!total) return out;

  const cashW = (D.cash || 0) / total;
  const cashObjetivo = (t.cashMin + t.cashMax) / 2;
  let desplegable = Math.max(0, (D.cash || 0) - cashObjetivo * total);

  /* gaps por sector, de mayor a menor */
  const gaps = Object.entries(t.sectores)
    .map(([k, cfg]) => ({ k, label: cfg.label, gap: cfg.peso - (w[k] || 0), gapUsd: (cfg.peso - (w[k] || 0)) * total }))
    .sort((a, b) => b.gapUsd - a.gapUsd);

  /* COMPRAS: sectores subponderados, mientras haya cash desplegable */
  for (const g of gaps) {
    if (g.gapUsd < 25 || desplegable < 25) continue;
    const monto = Math.min(g.gapUsd, desplegable);
    desplegable -= monto;
    const cands = (CATALOGO[g.k] || []).filter((c) => c.sym);
    const yaTiene = pos.find((p) => p.sector === g.k);
    const cand = yaTiene && cands.find((c) => c.sym === yaTiene.sym) ? yaTiene : cands[0];
    const q = (D.quotes || {})[cand?.sym];
    const sinExp = (w[g.k] || 0) < 0.005;
    out.push({
      prioridad: sinExp && g.gap >= 0.08 ? 'alta' : 'media',
      accion: 'COMPRAR', sym: cand?.sym || '—', monto,
      razon: `${g.label} pesa ${fp(w[g.k] || 0)} y el objetivo del perfil ${esc(D.cliente.perfil)} es ${fp(t.sectores[g.k].peso, 0)}. ${sinExp ? 'Hoy no hay ninguna exposición a este sector, que es parte declarada de la estrategia.' : 'Completa el sector hacia su peso objetivo.'}${q?.price ? ` Precio actual de ${cand.sym}: ${fm(q.price)} → ~${(monto / q.price).toFixed(4)} unidades.` : ''}`,
    });
  }

  /* RECORTES: sectores sobreponderados */
  for (const g of gaps) {
    if (g.gapUsd > -40) continue;
    const exceso = -g.gapUsd;
    const enSector = pos.filter((p) => p.sector === g.k).sort((a, b) => b.valor - a.valor);
    const p = enSector[0];
    if (!p) continue;
    const joven = p.compradoEl && dias(p.compradoEl, hoy()) < (t.minHoldingDias || 90);
    out.push({
      prioridad: g.gap < -0.08 ? 'alta' : 'media',
      accion: joven ? 'VIGILAR' : 'RECORTAR', sym: p.sym, monto: exceso,
      razon: `${g.label} pesa ${fp(w[g.k] || 0)} frente a un objetivo de ${fp(t.sectores[g.k].peso, 0)} — un exceso de ${fm(exceso)}. ${joven ? `La posición lleva ${dias(p.compradoEl, hoy())} días (regla mínima: ${t.minHoldingDias}); prográmalo, no lo ejecutes todavía.` : `Recortar ${p.sym} libera capital para los sectores faltantes sin salir del activo.`}`,
    });
  }

  /* Posición individual por encima del máximo */
  for (const p of pos) {
    if (p.peso > t.maxPosicion + 0.02) {
      out.push({
        prioridad: 'media', accion: 'RECORTAR', sym: p.sym, monto: (p.peso - t.maxPosicion) * total,
        razon: `${p.sym} concentra ${fp(p.peso)} del portafolio; el máximo por posición para un perfil ${esc(D.cliente.perfil)} es ${fp(t.maxPosicion, 0)}. Reducir el exceso baja el riesgo idiosincrático.`,
      });
    }
  }

  /* Regla anti-rotación */
  const cortas = ventasCortas();
  if (cortas.length) {
    out.push({
      prioridad: 'alta', accion: 'REGLA', sym: '', monto: 0,
      razon: `En los últimos meses hubo ${cortas.length} ventas con menos de ${t.minHoldingDias} días de tenencia (${cortas.map((c) => `${c.sym} a ${c.dias}d`).join(' · ')}). Para un mandato de rentabilidad sostenible: toda compra entra con tesis escrita y fecha de revisión, y solo se vende antes por deterioro de la tesis — no por movimiento de precio.`,
    });
  }

  /* Cash fuera de banda (si no salió ya vía compras) */
  if (cashW > t.cashMax && !out.some((s) => s.accion === 'COMPRAR')) {
    out.push({
      prioridad: 'media', accion: 'DESPLEGAR', sym: '', monto: (D.cash || 0) - cashObjetivo * total,
      razon: `El efectivo es ${fp(cashW)} del portafolio, por encima de la banda ${fp(t.cashMin, 0)}–${fp(t.cashMax, 0)}. Capital quieto es retorno que no se genera; despliega gradualmente (2–3 entradas) hacia los sectores subponderados.`,
    });
  }

  /* Desempeño */
  const diff = retornoPortafolio() - retornoBenchmark();
  if (diff < -0.05) {
    out.push({
      prioridad: 'baja', accion: 'NOTA', sym: '', monto: 0,
      razon: `El portafolio va ${fp(diff)} por detrás del S&P 500 desde el inicio. Gran parte se explica por rotación corta con pérdidas y por el peso del capital ocioso. El plan simple que más probabilidad tiene de cerrar la brecha: núcleo indexado + sectores objetivo, y dejar correr las posiciones.`,
    });
  }

  const orden = { alta: 0, media: 1, baja: 2 };
  return out.sort((a, b) => orden[a.prioridad] - orden[b.prioridad]);
}

/* ---------------- render ---------------- */
function render() {
  $('#topTitle').textContent = `Portafolio · ${D.cliente.nombre}`;
  renderResumen();
  renderPortafolio();
  renderMovimientos();
  renderSalud();
  renderSugerencias();
  renderNube();
}

function colorScore(s) { return s >= 70 ? 'var(--sage)' : s >= 45 ? 'var(--ochre)' : 'var(--rust)'; }

function renderResumen() {
  const total = totalPortafolio();
  const cap = D.cliente.capitalAportado || 0;
  const pl = total - cap;
  const ret = retornoPortafolio();
  const s = salud();
  const w = pesosSector();
  const t = D.targets;

  const allocRows = Object.entries(t.sectores).map(([k, cfg]) => {
    const actual = w[k] || 0;
    return `<div class="alloc-row">
      <div class="alloc-head"><span>${esc(cfg.label)}</span><span class="t">${fp(actual)} · objetivo ${fp(cfg.peso, 0)}</span></div>
      <div class="alloc-track">
        <div class="alloc-fill" style="width:${clamp(actual * 250, 0, 100)}%; background:${actual > cfg.peso + 0.05 ? 'var(--rust-2)' : actual < cfg.peso - 0.05 ? 'var(--ochre-2)' : 'var(--sage)'}"></div>
        <div class="alloc-target" style="left:${clamp(cfg.peso * 250, 0, 100)}%"></div>
      </div>
    </div>`;
  }).join('');
  const cashRow = `<div class="alloc-row">
      <div class="alloc-head"><span>Efectivo (poder de compra)</span><span class="t">${fp(total ? (D.cash || 0) / total : 0)} · banda ${fp(t.cashMin, 0)}–${fp(t.cashMax, 0)}</span></div>
      <div class="alloc-track"><div class="alloc-fill" style="width:${clamp((total ? (D.cash || 0) / total : 0) * 250, 0, 100)}%; background:${(D.cash || 0) / (total || 1) > t.cashMax ? 'var(--rust-2)' : 'var(--sage)'}"></div>
      <div class="alloc-target" style="left:${clamp(((t.cashMin + t.cashMax) / 2) * 250, 0, 100)}%"></div></div>
    </div>`;

  $('#pane-resumen').innerHTML = `
    <span class="eyebrow"><span>01</span> · Resumen</span>
    <h2>${esc(D.cliente.nombre)}</h2>
    <p class="sub">Perfil <b>${esc(D.cliente.perfil)}</b> · ${esc(D.cliente.broker)} · cuenta ${esc(D.cliente.cuenta)} · desde ${esc(D.cliente.inicio)}. ${esc(D.cliente.objetivo)}</p>

    <div class="grid cols-4">
      <div class="card"><span class="eyebrow">Valor total</span><span class="stat-num">${fm(total)}</span><span class="stat-label">incluye ${fm(D.cash)} en efectivo</span></div>
      <div class="card"><span class="eyebrow">P&amp;L vs. aportado</span><span class="stat-num ${pl >= 0 ? 'pos' : 'neg'}">${pl >= 0 ? '+' : ''}${fm(pl)}</span><span class="stat-label">capital aportado ${fm(cap)}</span></div>
      <div class="card"><span class="eyebrow">Retorno</span><span class="stat-num ${ret >= 0 ? 'pos' : 'neg'}">${fp(ret)}</span><span class="stat-label">S&amp;P 500 en el mismo período: ${fp(retornoBenchmark())}</span></div>
      <div class="card"><span class="eyebrow">Salud</span><span class="stat-num" style="color:${colorScore(s.score)}">${s.score}<span style="font-size:22px">/100</span></span><span class="stat-label">ver detalle en la pestaña Salud</span></div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <span class="eyebrow">Evolución</span>
        <h3>Valor del portafolio por mes</h3>
        <div class="chart-box">${chartLinea()}</div>
        <p class="card-note">Cortes de fin de mes según extractos + valor de hoy con precios en vivo.</p>
      </div>
      <div class="card">
        <span class="eyebrow">Asignación</span>
        <h3>Peso actual vs. objetivo del perfil</h3>
        <div style="margin-top:14px">${allocRows}${cashRow}</div>
        <p class="card-note">La marca vertical es el peso objetivo. Naranja: falta llegar · terracota: sobreponderado.</p>
      </div>
    </div>`;
}

function chartLinea() {
  const H = [...(D.historial || [])].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const puntos = [...H];
  const th = { fecha: hoy(), total: totalPortafolio() };
  if (!puntos.length || puntos[puntos.length - 1].fecha < th.fecha) puntos.push(th);
  if (puntos.length < 2) return '<p class="card-note">Aún no hay historial suficiente.</p>';
  const W = 520, Ht = 210, padL = 46, padB = 26, padT = 12, padR = 10;
  const vals = puntos.map((p) => p.total);
  const min = Math.min(...vals) * 0.97, max = Math.max(...vals) * 1.03;
  const x = (i) => padL + (i * (W - padL - padR)) / (puntos.length - 1);
  const y = (v) => padT + (Ht - padT - padB) * (1 - (v - min) / (max - min || 1));
  const path = puntos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');
  const area = `${path} L${x(puntos.length - 1).toFixed(1)},${Ht - padB} L${padL},${Ht - padB} Z`;
  const cap = D.cliente.capitalAportado || 0;
  const capY = cap >= min && cap <= max ? y(cap) : null;
  const dots = puntos.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.total).toFixed(1)}" r="3.4" fill="#004643"/>`).join('');
  const labels = puntos.map((p, i) => `<text x="${x(i).toFixed(1)}" y="${Ht - 8}" font-size="10" text-anchor="middle" fill="rgba(10,54,37,.6)" font-family="Manrope">${p.fecha.slice(5, 7)}/${p.fecha.slice(2, 4)}</text>`).join('');
  const yTicks = [min, (min + max) / 2, max].map((v) => `<text x="${padL - 6}" y="${(y(v) + 3).toFixed(1)}" font-size="10" text-anchor="end" fill="rgba(10,54,37,.6)" font-family="Manrope">$${Math.round(v).toLocaleString('en-US')}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Evolución del portafolio">
    <path d="${area}" fill="rgba(45,125,111,.14)"/>
    ${capY !== null ? `<line x1="${padL}" y1="${capY.toFixed(1)}" x2="${W - padR}" y2="${capY.toFixed(1)}" stroke="#C9883A" stroke-width="1.6" stroke-dasharray="5 4"/><text x="${W - padR}" y="${(capY - 5).toFixed(1)}" font-size="10" text-anchor="end" fill="#B85C38" font-family="Manrope" font-weight="700">aportado ${fm(cap)}</text>` : ''}
    <path d="${path}" fill="none" stroke="#004643" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}${labels}${yTicks}
  </svg>`;
}

function renderPortafolio() {
  const pos = posiciones();
  const rows = pos.map((p, i) => `<tr>
      <td><span class="sym">${esc(p.sym)}</span><div class="mini">${esc(p.nombre)}</div></td>
      <td><span class="badge">${esc(D.targets.sectores[p.sector]?.label || p.sector)}</span></td>
      <td class="num">${p.qty.toFixed(5)}</td>
      <td class="num">${fm(p.costo)}</td>
      <td class="num"><input type="number" step="0.01" data-precio="${i}" value="${p.precio.toFixed(2)}"><div class="mini">${esc(p.precioFecha || '')}</div></td>
      <td class="num">${fm(p.valor)}</td>
      <td class="num ${p.pl >= 0 ? 'pos' : 'neg'}">${p.pl >= 0 ? '+' : ''}${fm(p.pl)}</td>
      <td class="num ${p.pl >= 0 ? 'pos' : 'neg'}">${fp(p.plPct)}</td>
      <td class="num">${fp(p.peso)}</td>
    </tr>`).join('');

  const sectorOpts = Object.entries(D.targets.sectores).map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('');

  $('#pane-portafolio').innerHTML = `
    <span class="eyebrow"><span>02</span> · Portafolio</span>
    <h2>Posiciones</h2>
    <p class="sub">El precio es editable a mano, o usa <b>Actualizar precios</b> arriba para traer el mercado en vivo. Todo lo demás se mueve desde Movimientos.</p>
    <div class="card" style="margin-top:20px">
      <div class="table-scroll"><table>
        <thead><tr><th>Activo</th><th>Sector</th><th class="num">Cantidad</th><th class="num">Costo</th><th class="num">Precio</th><th class="num">Valor</th><th class="num">P&amp;L $</th><th class="num">P&amp;L %</th><th class="num">Peso</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="5" style="font-weight:800;color:var(--cyprus)">Total invertido + efectivo ${fm(D.cash)}</td>
          <td class="num" style="font-weight:800">${fm(totalPortafolio())}</td><td colspan="3"></td>
        </tr></tfoot>
      </table></div>
    </div>

    <div class="card warm" style="margin-top:16px">
      <span class="eyebrow">Editar</span>
      <h3>Efectivo y nueva posición</h3>
      <div class="form-row" style="margin-top:10px">
        <div class="field"><label>Efectivo (USD)</label><input class="input" type="number" step="0.01" id="cashInput" value="${(D.cash || 0).toFixed(2)}"></div>
        <div class="field"><label>&nbsp;</label><button class="btn btn-primary" id="btnCash">Guardar efectivo</button></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Símbolo</label><input class="input" id="npSym" placeholder="XLV"></div>
        <div class="field"><label>Nombre</label><input class="input" id="npNombre" placeholder="Health Care SPDR"></div>
        <div class="field"><label>Sector</label><select class="input" id="npSector">${sectorOpts}</select></div>
        <div class="field"><label>Cantidad</label><input class="input" type="number" step="0.00001" id="npQty"></div>
        <div class="field"><label>Costo total USD</label><input class="input" type="number" step="0.01" id="npCosto"></div>
        <div class="field"><label>Precio actual</label><input class="input" type="number" step="0.01" id="npPrecio"></div>
        <div class="field"><label>&nbsp;</label><button class="btn btn-signature" id="btnAddPos">Agregar posición</button></div>
      </div>
      <p class="card-note">Para compras y ventas usa la pestaña Movimientos: actualiza posición, costo y efectivo de una sola vez.</p>
    </div>`;

  document.querySelectorAll('[data-precio]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const i = +inp.dataset.precio;
      D.posiciones[i].precio = parseFloat(inp.value) || 0;
      D.posiciones[i].precioFecha = hoy() + ' · manual';
      touch(); render();
    });
  });
  $('#btnCash').onclick = () => { D.cash = parseFloat($('#cashInput').value) || 0; touch(); render(); toast('Efectivo actualizado'); };
  $('#btnAddPos').onclick = () => {
    const sym = $('#npSym').value.trim().toUpperCase();
    if (!sym) return toast('Falta el símbolo');
    D.posiciones.push({
      sym, nombre: $('#npNombre').value.trim() || sym, sector: $('#npSector').value,
      qty: parseFloat($('#npQty').value) || 0, costo: parseFloat($('#npCosto').value) || 0,
      precio: parseFloat($('#npPrecio').value) || 0, precioFecha: hoy() + ' · manual', compradoEl: hoy(),
    });
    touch(); render(); toast(`${sym} agregada`);
  };
}

function renderMovimientos() {
  const movs = [...(D.movimientos || [])].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const tipoBadge = { compra: 'badge', venta: 'badge-warn', deposito: 'badge-pos', retiro: 'badge-neg', dividendo: 'badge-pos', interes: 'badge-pos' };
  const rows = movs.map((m) => `<tr>
      <td class="num" style="text-align:left">${esc(m.fecha)}</td>
      <td><span class="badge ${tipoBadge[m.tipo] || ''}">${esc(m.tipo)}</span></td>
      <td><span class="sym">${esc(m.sym || '—')}</span></td>
      <td class="num">${m.qty ? m.qty.toFixed(5) : ''}</td>
      <td class="num">${m.precio ? fm(m.precio) : ''}</td>
      <td class="num ${['venta', 'deposito', 'dividendo', 'interes'].includes(m.tipo) ? 'pos' : 'neg'}">${['venta', 'deposito', 'dividendo', 'interes'].includes(m.tipo) ? '+' : '−'}${fm(m.monto)}</td>
      <td class="mini">${esc(m.nota || '')}</td>
    </tr>`).join('');

  $('#pane-movimientos').innerHTML = `
    <span class="eyebrow"><span>03</span> · Movimientos</span>
    <h2>Historial y registro</h2>
    <p class="sub">Registrar una compra o venta actualiza posición, costo y efectivo automáticamente. Los depósitos suman al capital aportado.</p>

    <div class="card warm" style="margin-top:20px">
      <span class="eyebrow">Nuevo movimiento</span>
      <div class="form-row" style="margin-top:12px">
        <div class="field"><label>Fecha</label><input class="input" type="date" id="mvFecha" value="${hoy()}"></div>
        <div class="field"><label>Tipo</label><select class="input" id="mvTipo">
          <option value="compra">Compra</option><option value="venta">Venta</option>
          <option value="deposito">Depósito</option><option value="retiro">Retiro</option>
          <option value="dividendo">Dividendo</option><option value="interes">Interés</option>
        </select></div>
        <div class="field"><label>Símbolo</label><input class="input" id="mvSym" placeholder="VOO"></div>
        <div class="field"><label>Cantidad</label><input class="input" type="number" step="0.00001" id="mvQty"></div>
        <div class="field"><label>Monto total USD</label><input class="input" type="number" step="0.01" id="mvMonto"></div>
        <div class="field"><label>Nota</label><input class="input" id="mvNota"></div>
        <div class="field"><label>&nbsp;</label><button class="btn btn-signature" id="btnAddMov">Registrar</button></div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="table-scroll"><table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Activo</th><th class="num">Cantidad</th><th class="num">Precio</th><th class="num">Monto</th><th>Nota</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;

  $('#btnAddMov').onclick = () => {
    const tipo = $('#mvTipo').value;
    const sym = $('#mvSym').value.trim().toUpperCase();
    const qty = parseFloat($('#mvQty').value) || 0;
    const monto = parseFloat($('#mvMonto').value) || 0;
    const fecha = $('#mvFecha').value || hoy();
    if (!monto) return toast('Falta el monto');
    if (['compra', 'venta'].includes(tipo) && (!sym || !qty)) return toast('Compra/venta necesita símbolo y cantidad');

    const precio = qty ? monto / qty : 0;
    D.movimientos.push({ fecha, tipo, sym, qty, precio, monto, nota: $('#mvNota').value.trim() });

    if (tipo === 'deposito') { D.cash += monto; D.cliente.capitalAportado = (D.cliente.capitalAportado || 0) + monto; }
    if (tipo === 'retiro') { D.cash -= monto; D.cliente.capitalAportado = Math.max(0, (D.cliente.capitalAportado || 0) - monto); }
    if (tipo === 'dividendo' || tipo === 'interes') D.cash += monto;
    if (tipo === 'compra') {
      D.cash -= monto;
      let p = D.posiciones.find((x) => x.sym === sym);
      if (p) { p.qty += qty; p.costo += monto; }
      else D.posiciones.push({ sym, nombre: sym, sector: 'tech', qty, costo: monto, precio, precioFecha: fecha, compradoEl: fecha });
    }
    if (tipo === 'venta') {
      D.cash += monto;
      const p = D.posiciones.find((x) => x.sym === sym);
      if (p) {
        const frac = Math.min(1, qty / p.qty);
        p.costo *= (1 - frac); p.qty -= qty;
        if (p.qty <= 0.00001) D.posiciones = D.posiciones.filter((x) => x !== p);
      }
    }
    touch(); render(); toast('Movimiento registrado');
  };
}

function renderSalud() {
  const s = salud();
  const R = 74, C = 2 * Math.PI * R;
  const dims = s.dims.map((d) => `<div class="dim">
      <div class="dim-head"><b>${esc(d.label)}</b><span>${d.score}/100 · pondera ${d.peso}%</span></div>
      <div class="bar"><i style="width:${d.score}%;background:${colorScore(d.score)}"></i></div>
      <p>${d.detalle}</p>
    </div>`).join('');

  $('#pane-salud').innerHTML = `
    <span class="eyebrow"><span>04</span> · Salud</span>
    <h2>Scoring del portafolio</h2>
    <p class="sub">Seis dimensiones ponderadas, recalculadas en vivo con cada precio, movimiento o edición. La meta operativa: mantenerlo por encima de 70.</p>

    <div class="card" style="margin-top:20px">
      <div class="score-hero">
        <div class="score-ring">
          <svg width="170" height="170" viewBox="0 0 170 170">
            <circle cx="85" cy="85" r="${R}" fill="none" stroke="var(--cyprus-08)" stroke-width="13"/>
            <circle cx="85" cy="85" r="${R}" fill="none" stroke="${colorScore(s.score)}" stroke-width="13" stroke-linecap="round"
              stroke-dasharray="${(C * s.score / 100).toFixed(1)} ${C.toFixed(1)}"/>
          </svg>
          <div class="score-val"><b>${s.score}</b><span>de 100</span></div>
        </div>
        <div style="flex:1;min-width:260px">${dims}</div>
      </div>
    </div>
    ${s.score < 60 ? `<div class="callout"><strong>Lectura ejecutiva:</strong> el puntaje bajo no viene de malos activos sino de estructura — sectores objetivo sin cubrir, efectivo ocioso y rotación corta. Las tres cosas se corrigen con las órdenes de la pestaña Sugerencias.</div>` : ''}`;
}

function renderSugerencias() {
  const sugs = sugerencias();
  const cards = sugs.length ? sugs.map((s) => `<article class="card sug ${s.prioridad}">
      <div class="sug-head">
        <span class="badge ${s.prioridad === 'alta' ? 'badge-neg' : s.prioridad === 'media' ? 'badge-warn' : 'badge-pos'}">${s.prioridad}</span>
        <span class="badge">${esc(s.accion)}${s.sym ? ` · ${esc(s.sym)}` : ''}</span>
        ${s.monto ? `<span class="sug-monto">${fm(s.monto)}</span>` : ''}
      </div>
      <p>${s.razon}</p>
    </article>`).join('') : '<div class="card"><p>El portafolio está alineado con el perfil y los objetivos. Nada que hacer — esa también es una decisión.</p></div>';

  $('#pane-sugerencias').innerHTML = `
    <span class="eyebrow"><span>05</span> · Sugerencias</span>
    <h2>Órdenes propuestas</h2>
    <p class="sub">Generadas por reglas a partir del perfil <b>${esc(D.cliente.perfil)}</b>, la asignación objetivo (tech &gt; salud &gt; financiero), la banda de efectivo y la disciplina de tenencia mínima. Se recalculan con cada cambio.</p>
    <div class="grid" style="margin-top:20px">${cards}</div>
    <div class="callout" style="margin-top:24px"><strong>Marco de decisión:</strong> estas sugerencias son generadas por reglas del sistema como apoyo a la gestión — la decisión final y su comunicación al cliente son tuyas. No constituyen asesoría financiera regulada.</div>`;
}

function renderNube() {
  $('#pane-nube').innerHTML = `
    <span class="eyebrow"><span>06</span> · Nube</span>
    <h2>Conexión y respaldo</h2>
    <div class="grid cols-2" style="margin-top:20px">
      <div class="card">
        <span class="eyebrow">Estado</span>
        <h3>${modo === 'nube' ? 'Nube en vivo' : 'Modo local'}</h3>
        <p class="card-note">${modo === 'nube'
          ? 'Los datos viven en Supabase con seguridad por usuario (RLS) y sincronización en tiempo real: edita en el celular y el computador lo refleja al instante.'
          : 'Los datos viven solo en este navegador. Inicia sesión con tu correo para activar la nube en vivo y editar desde cualquier dispositivo.'}</p>
        <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-secondary" id="btnSnapshot">Guardar snapshot de hoy</button>
          <button class="btn btn-danger" id="btnLogout">${modo === 'nube' ? 'Cerrar sesión' : 'Salir'}</button>
        </div>
      </div>
      <div class="card">
        <span class="eyebrow">Respaldo</span>
        <h3>Exportar / importar</h3>
        <p class="card-note">Descarga una copia JSON de todo (posiciones, movimientos, historial) o restaura desde un archivo.</p>
        <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary" id="btnExport">Exportar JSON</button>
          <button class="btn btn-secondary" id="btnImport">Importar JSON</button>
          <input type="file" id="fileImport" accept="application/json" class="hidden">
        </div>
      </div>
    </div>`;

  $('#btnSnapshot').onclick = () => {
    const f = hoy();
    D.historial = (D.historial || []).filter((h) => h.fecha !== f);
    D.historial.push({ fecha: f, total: +totalPortafolio().toFixed(2), cash: +(D.cash || 0).toFixed(2), equities: +equitiesVal().toFixed(2) });
    D.historial.sort((a, b) => a.fecha.localeCompare(b.fecha));
    touch(); render(); toast('Snapshot guardado en el historial');
  };
  $('#btnExport').onclick = () => {
    const blob = new Blob([JSON.stringify(D, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `portafolio-${hoy()}.json`;
    a.click();
  };
  $('#btnImport').onclick = () => $('#fileImport').click();
  $('#fileImport').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { D = JSON.parse(r.result); touch(); render(); toast('Datos importados'); }
      catch { toast('Archivo inválido'); }
    };
    r.readAsText(f);
  };
  $('#btnLogout').onclick = async () => {
    if (sb) await sb.auth.signOut();
    location.reload();
  };
}

/* ---------------- persistencia ---------------- */
function touch() {
  if (modo === 'local') localStorage.setItem(LS_KEY, JSON.stringify(D));
  if (modo === 'nube') {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCloud, 900);
  }
}

async function saveCloud() {
  if (!sb || !uid) return;
  lastSavedAt = new Date().toISOString();
  const { error } = await sb.from('portafolios').upsert({ owner: uid, data: D, updated_at: lastSavedAt });
  if (error) toast('Error guardando en la nube: ' + error.message);
}

async function loadCloud() {
  const { data, error } = await sb.from('portafolios').select('data').eq('owner', uid).maybeSingle();
  if (error) { toast('Error leyendo la nube: ' + error.message); return null; }
  return data?.data || null;
}

function subscribeRealtime() {
  sb.channel('portafolio-live')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'portafolios', filter: `owner=eq.${uid}` }, (payload) => {
      if (payload.new?.updated_at && payload.new.updated_at !== lastSavedAt) {
        D = payload.new.data;
        render();
        toast('Sincronizado desde otro dispositivo');
      }
    })
    .subscribe();
}

/* ---------------- precios en vivo ---------------- */
async function actualizarPrecios() {
  const btn = $('#btnQuotes');
  btn.disabled = true; btn.textContent = 'Actualizando…';
  try {
    const propios = (D.posiciones || []).map((p) => p.sym);
    const catalogo = Object.values(CATALOGO).flat().map((c) => c.sym);
    const syms = [...new Set([...propios, ...catalogo, 'VOO'])].join(',');
    const res = await fetch(`${CFG.url}/functions/v1/quotes?symbols=${encodeURIComponent(syms)}`, {
      headers: { Authorization: `Bearer ${CFG.anon}`, apikey: CFG.anon },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const q = await res.json();
    D.quotes = q;
    let n = 0;
    for (const p of D.posiciones || []) {
      if (q[p.sym]?.price) { p.precio = q[p.sym].price; p.precioFecha = hoy() + ' · en vivo'; n++; }
    }
    /* snapshot automático del día para la curva de evolución */
    const f = hoy();
    D.historial = (D.historial || []).filter((h) => h.fecha !== f);
    D.historial.push({ fecha: f, total: +totalPortafolio().toFixed(2), cash: +(D.cash || 0).toFixed(2), equities: +equitiesVal().toFixed(2) });
    D.historial.sort((a, b) => a.fecha.localeCompare(b.fecha));
    touch(); render();
    toast(`Precios en vivo: ${n} posiciones actualizadas`);
  } catch (e) {
    toast('No se pudieron traer precios: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Actualizar precios';
  }
}

/* ---------------- arranque / login ---------------- */
function entrar(datos, m) {
  D = datos;
  modo = m;
  $('#lock').classList.add('hidden');
  $('#app').classList.remove('hidden');
  const cs = $('#cloudState');
  cs.textContent = m === 'nube' ? 'Nube en vivo' : 'Local';
  cs.className = 'cloud-state ' + (m === 'nube' ? 'on' : 'off');
  render();
  actualizarPrecios().catch(() => {});
}

async function initSupabase() {
  try {
    const { createClient } = await import(SUPABASE_CDN);
    sb = createClient(CFG.url, CFG.anon);
    return true;
  } catch { return false; }
}

async function boot() {
  /* tabs */
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    pane = b.dataset.pane;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === b));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${pane}`));
  });
  $('#btnQuotes').onclick = actualizarPrecios;

  $('#toLocal').onclick = () => { $('#lockCloud').classList.add('hidden'); $('#lockLocal').classList.remove('hidden'); };
  $('#toCloud').onclick = () => { $('#lockLocal').classList.add('hidden'); $('#lockCloud').classList.remove('hidden'); };

  $('#btnLoginLocal').onclick = () => {
    if ($('#localPass').value !== CLAVE_LOCAL) { $('#lockMsg').textContent = 'Clave incorrecta.'; return; }
    const guardado = localStorage.getItem(LS_KEY);
    entrar(guardado ? JSON.parse(guardado) : structuredClone(PLANTILLA), 'local');
  };
  $('#localPass')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnLoginLocal').click(); });

  const okSb = await initSupabase();

  $('#btnLoginCloud').onclick = async () => {
    if (!okSb || !sb) { $('#lockMsg').textContent = 'Sin conexión a la nube. Usa el modo local.'; return; }
    $('#lockMsg').textContent = '';
    const { data, error } = await sb.auth.signInWithPassword({
      email: $('#loginEmail').value.trim(),
      password: $('#loginPass').value,
    });
    if (error) { $('#lockMsg').textContent = 'No pudimos iniciar sesión: ' + error.message; return; }
    uid = data.user.id;
    const nube = await loadCloud();
    subscribeRealtime();
    entrar(nube || structuredClone(PLANTILLA), 'nube');
    if (!nube) saveCloud();
  };
  $('#loginPass')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnLoginCloud').click(); });

  /* sesión previa → directo a la nube */
  if (okSb && sb) {
    const { data } = await sb.auth.getSession();
    if (data?.session) {
      uid = data.session.user.id;
      const nube = await loadCloud();
      if (nube) { subscribeRealtime(); entrar(nube, 'nube'); }
    }
  }
}

boot();
