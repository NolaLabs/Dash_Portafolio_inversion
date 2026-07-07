// NOLA LABS · PORTAFOLIO — actualización diaria de precios + recomendación semanal con Claude
// GET /reco?mode=snapshot  → actualiza precios de posiciones y snapshot del día (cron diario)
// GET /reco?mode=reco      → lo anterior + recomendación semanal vía Claude API (cron lunes / botón)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RECO_SCHEMA = {
  type: "object",
  properties: {
    resumen: { type: "string", description: "Lectura ejecutiva del portafolio esta semana, 2-4 frases, en español." },
    ordenes: {
      type: "array",
      description: "Órdenes concretas recomendadas para esta semana.",
      items: {
        type: "object",
        properties: {
          accion: { type: "string", enum: ["comprar", "vender", "mantener"] },
          sym: { type: "string" },
          nombre: { type: "string" },
          montoUsd: { type: "number", description: "Monto en USD; 0 si es mantener." },
          razon: { type: "string", description: "Justificación en español, con cifras." },
        },
        required: ["accion", "sym", "nombre", "montoUsd", "razon"],
        additionalProperties: false,
      },
    },
    riesgos: { type: "string", description: "Riesgos a vigilar esta semana, 1-3 frases, en español." },
  },
  required: ["resumen", "ordenes", "riesgos"],
  additionalProperties: false,
};

async function quote(sym: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo ${res.status} para ${sym}`);
  const j = await res.json();
  const meta = j?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) throw new Error(`Sin precio para ${sym}`);
  return meta.regularMarketPrice as number;
}

function hoy() { return new Date().toISOString().slice(0, 10); }

async function generarReco(data: Record<string, any>): Promise<Record<string, any>> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Falta el secreto ANTHROPIC_API_KEY en Supabase (Edge Functions → Secrets)");
  const anthropic = new Anthropic({ apiKey });

  const total = (data.posiciones as any[]).reduce((s, p) => s + p.qty * p.precio, 0) + (data.cash || 0);

  /* posiciones con métricas pre-calculadas: el modelo no debe inferir aritmética */
  const posiciones = (data.posiciones as any[]).map((p) => {
    const valor = p.qty * p.precio;
    const pl = valor - p.costo;
    return {
      sym: p.sym, sector: p.sector, qty: p.qty,
      costoTotalUsd: p.costo,
      costoPorUnidadUsd: +(p.costo / p.qty).toFixed(2),
      precioActualUsd: p.precio,
      valorUsd: +valor.toFixed(2),
      pesoPct: +((valor / total) * 100).toFixed(1),
      plUsd: +pl.toFixed(2),
      plPct: +((pl / p.costo) * 100).toFixed(1),
      diasTenencia: p.compradoEl ? Math.round((Date.now() - new Date(p.compradoEl).getTime()) / 86400000) : null,
    };
  });

  /* pesos por sector actual vs objetivo, con brecha en USD — incluye sectores en 0% */
  const sectores = Object.entries(data.targets?.sectores || {}).map(([k, cfg]: [string, any]) => {
    const actual = posiciones.filter((p) => p.sector === k).reduce((s, p) => s + p.valorUsd, 0);
    return {
      sector: k, label: cfg.label,
      pesoActualPct: +((actual / total) * 100).toFixed(1),
      pesoObjetivoPct: +(cfg.peso * 100).toFixed(0),
      brechaUsd: +((cfg.peso * total) - actual).toFixed(2),
    };
  });

  const contexto = {
    fecha: hoy(),
    cliente: data.cliente,
    perfilRiesgo: data.cliente?.perfil,
    totalPortafolioUsd: +total.toFixed(2),
    efectivoUsd: data.cash,
    efectivoPct: +(((data.cash || 0) / total) * 100).toFixed(1),
    bandaEfectivoObjetivoPct: { min: (data.targets?.cashMin ?? 0.05) * 100, max: (data.targets?.cashMax ?? 0.12) * 100 },
    minHoldingDias: data.targets?.minHoldingDias ?? 90,
    maxPesoPorPosicionPct: (data.targets?.maxPosicion ?? 0.25) * 100,
    sectoresActualVsObjetivo: sectores,
    posiciones,
    movimientosRecientes: (data.movimientos as any[]).slice(-10),
    feesBroker: data.targets?.fees ?? { porOrden: 0.15, ventaRegulatorio: 0.02, minTicket: 30 },
    candidatosPorSector: {
      salud: ["XLV", "VHT"], financiero: ["XLF", "VFH"], indice: ["VOO"],
      tech: ["VGT", "MSFT"], emergentes: ["VWO"], oro: ["GLD"], innovacion: ["ARKK"],
    },
  };

  const response = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4000,
    output_config: { format: { type: "json_schema", schema: RECO_SCHEMA } },
    system: [
      "Eres el analista de inversiones de Nola Labs. Generas la recomendación semanal para el portafolio de un cliente con perfil de riesgo moderado.",
      "Todas las cifras del contexto ya vienen calculadas (pesos, P&L, brechas por sector, días de tenencia): úsalas tal cual, no las recalcules ni inventes métricas que no estén en los datos.",
      "Reglas duras que debes respetar en toda orden que propongas:",
      "1. Perfil moderado: nada de apalancamiento, opciones ni activos especulativos; máximo maxPesoPorPosicionPct en una sola posición.",
      "2. Estrategia declarada del cliente: tecnología como mayor apuesta, luego salud y sector financiero; núcleo indexado (VOO); oro solo como cobertura (~10%).",
      "3. Prioriza cubrir sectores de la estrategia declarada que estén en 0% de exposición (revisa sectoresActualVsObjetivo): un sector declarado sin cubrir pesa más que afinar uno que ya está cerca del objetivo. Usa candidatosPorSector para proponer el instrumento.",
      "4. Tenencia mínima: no recomiendes vender posiciones con diasTenencia menor a minHoldingDias, salvo deterioro grave de tesis; la rotación corta destruyó retorno en este portafolio.",
      "5. Fees del broker (Hapi): cada orden cuesta feesBroker.porOrden USD y las ventas suman feesBroker.ventaRegulatorio; no propongas órdenes menores a feesBroker.minTicket USD.",
      "6. Banda de efectivo objetivo: entre bandaEfectivoObjetivoPct.min y .max del total; despliega el exceso gradualmente (2-3 semanas), no todo de una vez.",
      "7. Cada orden con monto concreto en USD y razón citando las cifras del contexto (peso actual vs objetivo, brechaUsd). Máximo 4 órdenes por semana — es gestión paciente, no trading.",
      "8. Responde en español. Sé concreto y honesto; si lo correcto es no hacer nada, dilo con una sola orden 'mantener'.",
    ].join("\n"),
    messages: [{
      role: "user",
      content: `Estado del portafolio hoy (JSON):\n${JSON.stringify(contexto, null, 1)}\n\nGenera la recomendación semanal.`,
    }],
  });

  if (response.stop_reason === "refusal") throw new Error("El modelo declinó la solicitud");
  const texto = response.content.find((b: any) => b.type === "text");
  if (!texto) throw new Error("Respuesta sin contenido");
  const reco = JSON.parse((texto as any).text);
  return { ...reco, fecha: hoy(), modelo: response.model };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  try {
    const mode = new URL(req.url).searchParams.get("mode") ?? "snapshot";

    const rowsRes = await fetch(`${SUPA_URL}/rest/v1/portafolios?select=owner,data`, {
      headers: { apikey: SRK, Authorization: `Bearer ${SRK}` },
    });
    if (!rowsRes.ok) throw new Error(`Error leyendo portafolios: ${rowsRes.status}`);
    const rows = await rowsRes.json();
    const out: Record<string, unknown>[] = [];

    for (const row of rows) {
      const data = row.data as Record<string, any>;
      if (!Array.isArray(data.posiciones)) continue;

      let actualizadas = 0;
      for (const p of data.posiciones) {
        try {
          p.precio = await quote(p.sym);
          p.precioFecha = `${hoy()} · en vivo`;
          actualizadas++;
        } catch (_) { /* mantiene el precio anterior */ }
      }

      const equities = data.posiciones.reduce((s: number, p: any) => s + p.qty * p.precio, 0);
      const total = equities + (data.cash || 0);
      data.historial = (data.historial || []).filter((h: any) => h.fecha !== hoy());
      data.historial.push({ fecha: hoy(), total: +total.toFixed(2), cash: +(data.cash || 0).toFixed(2), equities: +equities.toFixed(2) });
      data.historial.sort((a: any, b: any) => a.fecha.localeCompare(b.fecha));

      let reco: Record<string, any> | null = null;
      if (mode === "reco") {
        reco = await generarReco(data);
        data.recoSemanal = reco;
        data.recos = [...(data.recos || []), reco].slice(-12);
      }

      const upd = await fetch(`${SUPA_URL}/rest/v1/portafolios?owner=eq.${row.owner}`, {
        method: "PATCH",
        headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
      });
      if (!upd.ok) throw new Error(`Error guardando: ${upd.status} ${await upd.text()}`);
      out.push({ owner: row.owner, preciosActualizados: actualizadas, total: +total.toFixed(2), reco });
    }

    return json({ ok: true, mode, resultados: out });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
