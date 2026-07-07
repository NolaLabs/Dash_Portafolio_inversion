// NOLA LABS · PORTAFOLIO — proxy de precios en vivo (Yahoo Finance)
// GET /quotes?symbols=VOO,MSFT,GLD → { "VOO": {price, prevClose, currency, time}, ... }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

async function quote(sym: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo ${res.status} para ${sym}`);
  const j = await res.json();
  const meta = j?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) throw new Error(`Sin precio para ${sym}`);
  return {
    price: meta.regularMarketPrice,
    prevClose: meta.chartPreviousClose ?? null,
    currency: meta.currency ?? "USD",
    time: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const u = new URL(req.url);
    const symbols = (u.searchParams.get("symbols") ?? "")
      .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 30);
    if (!symbols.length) {
      return new Response(JSON.stringify({ error: "symbols requerido" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const out: Record<string, unknown> = {};
    await Promise.all(symbols.map(async (s) => {
      try { out[s] = await quote(s); } catch (e) { out[s] = { error: String(e) }; }
    }));
    return new Response(JSON.stringify(out), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
