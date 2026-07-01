# Nola Labs · Tablero Portafolio

Sistema de gestión de portafolio de inversión con el look and feel oficial de Nola Labs• (Crema · Verde Hondo · Cyprus · Ochre · Sage · Rust). Editable desde cualquier dispositivo con datos **en vivo** vía Supabase, precios de mercado en tiempo real, **scoring de salud 0–100** y **motor de sugerencias** según el perfil de riesgo del cliente.

Clave de acceso en modo local: **`Nola$2026`** · En la nube: tu correo + contraseña.

---

## Qué hace

- **Resumen** — valor total, P&L contra capital aportado, retorno vs. S&P 500, curva de evolución mensual y asignación actual vs. objetivo por sector.
- **Portafolio** — posiciones con costo, precio (en vivo o manual), P&L y peso. Efectivo editable.
- **Movimientos** — historial completo de compras, ventas, depósitos y dividendos. Registrar un movimiento actualiza posiciones, costo promedio y efectivo automáticamente.
- **Salud** — scoring 0–100 en 6 dimensiones ponderadas: cobertura de sectores objetivo, diversificación (HHI), alineación con el perfil, disciplina de rotación, despliegue de capital y desempeño vs. mercado.
- **Sugerencias** — órdenes propuestas (comprar / recortar / vigilar / reglas) generadas a partir del perfil de riesgo, la asignación objetivo, la banda de efectivo y la tenencia mínima. Con montos concretos en USD.
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
- **Edge Function:** `quotes` — proxy de precios de Yahoo Finance con CORS abierto y JWT requerido.

---

Nola Labs• — Ejecutar, no presentar. Herramienta interna de gestión; no constituye asesoría financiera regulada.
