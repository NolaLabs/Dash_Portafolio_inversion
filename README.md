# Nola Labs · Tablero Portafolio

Sistema de gestión de portafolio de inversión con el look and feel oficial de Nola Labs• (Crema · Verde Hondo · Cyprus · Ochre · Sage · Rust). Editable desde cualquier dispositivo con datos **en vivo** vía Supabase, precios de mercado en tiempo real, **scoring de salud 0–100** y **motor de sugerencias** según el perfil de riesgo del cliente.

Clave de acceso en modo local: **`Nola$2026`** · En la nube: tu correo + contraseña.

---

## Qué hace

- **Resumen** — valor total, P&L contra capital aportado, retorno vs. S&P 500, curva de evolución mensual y asignación actual vs. objetivo por sector.
- **Portafolio** — posiciones con costo, precio (en vivo o manual), P&L y peso. Efectivo editable.
- **Movimientos** — historial completo de compras, ventas, depósitos y dividendos. Registrar un movimiento actualiza posiciones, costo promedio y efectivo automáticamente.
- **Salud** — scoring 0–100 en 6 dimensiones ponderadas: cobertura de sectores objetivo, diversificación (HHI), alineación con el perfil, disciplina de rotación, despliegue de capital y desempeño vs. mercado.
- **Sugerencias** — dos motores: (1) **recomendación semanal generada por Claude** (Opus 4.8) con el estado completo del portafolio, respetando perfil de riesgo, fees del broker, tenencia mínima y banda de efectivo — se genera sola cada lunes 7:00 am (Bogotá) vía pg_cron o bajo demanda con un botón; (2) reglas en vivo (comprar / recortar / vigilar) con montos concretos en USD, conscientes del fee por orden y del ticket mínimo.
- **Fees del broker (Hapi)** — cada movimiento registra su fee ($0.15/orden + ~$0.02 regulatorio en ventas); se descuenta de la caja, engrosa el costo de compra y el tablero acumula el total pagado.
- **Nube · Ajustes** — estado de conexión, snapshot del día, export/import JSON.

El código trae una **plantilla genérica**; los datos reales del cliente viven en la nube (Supabase, tabla `portafolios` con RLS) y se cargan al iniciar sesión.

## Precios en vivo

El botón **Actualizar precios** llama a la Edge Function `quotes` (Supabase), que consulta Yahoo Finance del lado del servidor — sin problemas de CORS desde GitHub Pages. Al actualizar, se guarda un snapshot del día para la curva de evolución.

## Cómo usarlo

1. Abre `index.html` (o la URL de GitHub Pages).
2. Inicia sesión con tu correo → los datos del cliente cargan desde la nube y todo lo que edites se sincroniza en tiempo real entre dispositivos.
3. Modo local (sin internet): clave `Nola$2026`, datos solo en ese navegador.

## Publicar en GitHub Pages

```bash
cd "TABLERO PORTAFOLIO"
git remote add origin https://github.com/<tu-usuario>/nola-portafolio.git
git push -u origin main
```

Luego en GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root)**. La URL queda `https://<tu-usuario>.github.io/nola-portafolio/`.

> El repo puede ser público sin riesgo: no contiene datos del cliente (viven en Supabase con Row Level Security) y la `anon key` es pública por diseño — sin login no da acceso a nada.

## Infraestructura (ya desplegada)

- **Proyecto Supabase:** `baqevhsyawugvekqbwsm` (us-east-1) — el mismo del Tablero Financiero.
- **Tabla:** `portafolios` (una fila jsonb por usuario, RLS + realtime). SQL de referencia en `supabase-setup.sql`.
- **Edge Function `quotes`** — proxy de precios de Yahoo Finance con CORS abierto y JWT requerido.
- **Edge Function `reco`** — `?mode=snapshot` actualiza precios y snapshot del día; `?mode=reco` además genera la recomendación semanal llamando al API de Claude (`claude-opus-4-8`, salida JSON estructurada). Requiere el secreto `ANTHROPIC_API_KEY` (Dashboard → Edge Functions → Secrets).
- **pg_cron:** `portafolio-precios-diario` (L–V 21:15 UTC, tras el cierre de NYSE) y `portafolio-reco-semanal` (lunes 12:00 UTC = 7:00 am Bogotá).

---

Nola Labs• — Ejecutar, no presentar. Herramienta interna de gestión; no constituye asesoría financiera regulada.
