# Pedidos Frutitodo

Panel operativo embebible en GHL para recibir pedidos confirmados, imprimir órdenes térmicas de 80 mm y registrar su despacho.

## Desarrollo

```powershell
npm.cmd install
Copy-Item .env.example .env.local
npm.cmd run dev
```

Variables requeridas:

- `SUPABASE_URL`: URL pública del proyecto.
- `SUPABASE_SERVICE_ROLE_KEY`: solo servidor.
- `GHL_INGEST_SECRET`: bearer del Custom Webhook.
- `EMBED_TOKEN_PEPPER`: secreto para firmar tokens de iframe.

## Base de datos

El CLI está instalado como dependencia local:

```powershell
npx.cmd supabase login
npx.cmd supabase link --project-ref rcjixjsoehetbwcpkrpd
npx.cmd supabase db push --dry-run
npx.cmd supabase db push
```

No se debe guardar la contraseña de base de datos en el repositorio. Ver la configuración externa en [docs/ghl-setup.md](docs/ghl-setup.md).

## Verificación

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

Los archivos `orbita_pedidos_mvp.html` y `n8n_orbita_pedidos_mvp.json` son referencias históricas y no forman parte del runtime.
