# Configuración de GHL, n8n y el panel de Frutitodo

## 0. Flujo completo

```
Cliente (WhatsApp)
   │
   ▼
IA de GHL: pide los datos, lee el resumen, el cliente confirma
   │  dispara "Pedido confirmado" (nuevo) o "Ajustar pedido" (cambio)
   ▼
Workflow GHL → Custom Webhook → n8n  (frutitodo-pedido-ia.json)
   1. busca la conversación y lee sus últimos mensajes (API de GHL)
   2. OpenAI (GPT 5.6 luna) saca el pedido confirmado de esos mensajes → JSON estricto
   3. POST al panel: /orders (nuevo) o /orders/amendments (ajuste)
   4. escribe de vuelta en el contacto: resumen, cédula, método de pago, número y estado
   ▼
Panel (iframe): Nuevos → En preparación → Despachados · Requiere ayuda · Productos y precios
   │  cotizar (precios del catálogo) → enviar por WhatsApp con la API de GHL
   │  imprimir comanda con precios / despachar
   ▼
Panel → n8n (frutitodo-eventos-panel.json) → GHL: estado del pedido y aviso de despacho

IA pide ayuda → etiqueta `requiere_ayuda` → workflow GHL → n8n (frutitodo-solicitud-ayuda.json)
   → panel: tarjeta roja con botón "Abrir conversación"
```

Los tres workflows de n8n están en la carpeta [`n8n/`](../n8n) y se importan con **Import from File**.

## 1. Base de datos

Aplicar las migraciones `20260922120000_help_requests_and_order_details.sql` y `20260923120000_catalog_prices_and_quotes.sql`:

```powershell
npx.cmd supabase db push --dry-run
npx.cmd supabase db push
```

Agregan a los pedidos: cédula, método de pago, conversación de GHL, origen (IA o manual), quién imprimió o despachó y la cotización. Crean las tablas `help_requests` y `products` (catálogo con precios y búsqueda aproximada con `pg_trgm`).

**Sin estas migraciones el panel desplegado falla**: aplícalas antes o justo después del push.

## 2. Campos personalizados del contacto

| Nombre | Clave | Tipo | Quién lo escribe |
|---|---|---|---|
| Pedido resumen | `pedido_resumen` | Texto largo | n8n, con el pedido ya extraído y formateado (la IA puede llenarlo, pero no es la fuente) |
| Cédula | `cedula` | Texto | n8n |
| Método de pago | `metodo_pago` | Texto | n8n |
| Último pedido número | `ultimo_pedido_numero` | Texto | n8n (`FT-000123`) |
| Último pedido estado | `ultimo_pedido_estado` | Texto | n8n: `nuevo`, `en_preparacion`, `despachado` |
| Último pedido total | `ultimo_pedido_total` | Texto | El panel, al enviar la cotización |

Si GHL genera claves distintas, cámbialas en el nodo **Config** de cada workflow (`CF_*`). Si la API ignora la clave, usa el ID del campo (Configuración → Campos personalizados).

Los campos `pedido_evento_id`, `pedido_productos_json`, `pedido_tipo_entrega`, `pedido_direccion` y `pedido_observaciones` del flujo anterior dejan de usarse, porque ahora n8n hace la extracción.

## 3. Reglas del agente de IA

1. **Primer mensaje:** bienvenida y aceptación de la política de tratamiento de datos. Si el cliente acepta, agregar la etiqueta `acepto_tratamiento_datos`.
2. **Recolectar:** nombre completo, cédula, teléfono, productos con cantidad, unidad y preparación (por ejemplo "2 kg pechuga troceada"), domicilio o recogida, dirección completa con barrio, método de pago y observaciones.
3. **Resumen:** mostrarlo al cliente y pedir confirmación explícita. El formato sugerido es:
   ```
   Cliente: … | Cédula: … | Teléfono: …
   Entrega: Domicilio – Calle … , barrio … (o: Recoge en tienda)
   Pago: Efectivo
   Productos:
   - 1 kg banano criollo
   - 2 kg pechuga de pollo troceada
   Observaciones: …
   ```
4. **Después del "sí":** disparar una sola vez el workflow **Pedido confirmado**. No hace falta que la IA guarde el resumen: n8n lee los últimos mensajes de la conversación y de ahí saca el pedido. Por eso el resumen confirmado debe quedar escrito **en el chat**, dentro de los últimos mensajes.
5. **Ajustes:** si el cliente ya tiene un pedido que no ha salido (`ultimo_pedido_estado` es `nuevo` o `en_preparacion`) y quiere cambiarlo, el pedido **no es nuevo**. Es un ajuste al pedido actual y **conserva su número**. La IA debe:
   - rehacer el resumen **completo** con el cambio incluido, no solo la diferencia;
   - decirle al cliente que se trata de un ajuste a su pedido actual;
   - mostrarlo en el chat, esperar el "sí" y disparar **Ajustar pedido**.
   Si el pedido ya estaba impreso, el panel lo devuelve a *Nuevos* con la marca **Ajuste · reimprimir**. El tiquete sale con `AJUSTE AL PEDIDO FT-… · DESCARTA EL TIQUETE ANTERIOR`.
6. **Pedido ya despachado:** si el estado es `despachado`, un cambio se registra como pedido nuevo. n8n lo hace solo, porque el panel responde `409`.
7. **La IA no da precios ni totales.** La cotización la arma y envía una persona desde el panel.
8. **Pedir ayuda:** cuando la IA no pueda resolver algo, su acción de handover debe agregar la etiqueta `requiere_ayuda`.

## 4. Workflows de GHL

Todos usan un **Custom Webhook** `POST` con estos headers:

- `Content-Type: application/json`
- `x-frutitodo-secret: <INBOUND_SECRET>`, el mismo valor que pongas en el nodo Config de n8n.

### 4.1 Pedido confirmado

- **Disparador:** la acción *Trigger Workflow* del agente. No agregar un segundo disparador automático.
- **URL:** `https://<tu-n8n>/webhook/frutitodo-pedido`
- **Body:**

```json
{
  "action": "create",
  "locationId": "{{location.id}}",
  "contactId": "{{contact.id}}",
  "contactName": "{{contact.name}}",
  "contactPhone": "{{contact.phone}}",
  "resumen": ""
}
```

`resumen` es opcional: si la IA sí guarda un resumen, puedes mandarlo (`{{contact.pedido_resumen}}`) y la LLM lo usa como apoyo, pero **lo que manda es la conversación**. n8n lee los últimos `MESSAGE_LIMIT` mensajes (10 por defecto, configurable en el nodo Config). Si los pedidos son largos y el resumen confirmado queda fuera de esa ventana, súbelo a 20 o 30.

### 4.2 Ajustar pedido

Igual que el anterior, con `"action": "amend"`. n8n llama al endpoint de ajustes. Si el contacto no tiene un pedido abierto (`404`) o el pedido ya salió (`409`), lo registra como pedido nuevo.

### 4.3 Cliente requiere ayuda

- **Disparador:** *Contact Tag Added* = `requiere_ayuda`
- **Acción 1:** Custom Webhook a `https://<tu-n8n>/webhook/frutitodo-ayuda`

```json
{
  "locationId": "{{location.id}}",
  "contactId": "{{contact.id}}",
  "contactName": "{{contact.name}}",
  "contactPhone": "{{contact.phone}}",
  "reason": "La IA solicitó ayuda de un asesor"
}
```

- **Acción 2:** *Remove Tag* `requiere_ayuda`, para que la siguiente solicitud vuelva a disparar el workflow.

n8n busca el `conversationId` con la API de GHL (`GET /conversations/search`). El panel arma el enlace directo:

```
https://app.iaorbita.com/v2/location/<location>/conversations/conversations/<conversationId>
```

Si no encuentra la conversación, el enlace abre la ficha del contacto. Si un cliente pide ayuda dos veces, el panel no duplica la tarjeta: muestra "Pidió ayuda 2 veces".

## 5. n8n

1. Importa los tres archivos de `n8n/`.
2. Completa el nodo **Config** de cada workflow:
   - `GHL_TOKEN`: Private Integration token de la subcuenta, con permisos `contacts.write`, `conversations.readonly` y `conversations/message.write`.
   - `APP_INGEST_SECRET`: el mismo valor que `GHL_INGEST_SECRET` en Vercel.
   - `OPENAI_API_KEY` y `OPENAI_MODEL`. El valor por defecto es `gpt-5.6-luna`; **confirma el ID exacto del modelo en tu cuenta de OpenAI**.
   - `INBOUND_SECRET` / `APP_WEBHOOK_SECRET`: secretos compartidos.
3. Activa los tres workflows y copia la **Production URL** de cada Webhook.
4. En Vercel, en el proyecto `pedidos-frutitodo-eight`, con scope Production:
   - `N8N_DISPATCH_WEBHOOK_URL` = Production URL de *Frutitodo · Eventos del panel → GHL* (`/webhook/frutitodo-eventos`)
   - `N8N_WEBHOOK_SECRET` = el `APP_WEBHOOK_SECRET` de ese workflow
   - Vuelve a desplegar, porque Vercel incorpora las variables al build.

`SEND_CONFIRMATION` (workflow de pedidos) envía por WhatsApp "Recibimos tu pedido FT-…" o "Ajustamos tu pedido FT-… (es el mismo pedido)". Viene en `false` porque un mensaje enviado por API puede pausar la IA en esa conversación y porque la IA ya confirma. Actívalo solo después de probarlo.

### Eventos que la app envía a n8n

Todos llegan a la misma URL con `Authorization: Bearer <N8N_WEBHOOK_SECRET>` y se distinguen por `event`:

| Evento | Cuándo | Qué hace n8n |
|---|---|---|
| `order.printed` | Se confirma una impresión | `ultimo_pedido_estado = en_preparacion` |
| `order.dispatched` | Se marca despachado | `ultimo_pedido_estado = despachado` y WhatsApp "va en camino" (texto provisional; pedir a Frutitodo el definitivo) |

Cuerpo común:

```json
{
  "event": "order.dispatched",
  "requestId": "<id único del clic>",
  "ghlLocationId": "UfbKDvUAPCDEaRQWYXau",
  "ghlContactId": "<contacto o null si es manual>",
  "operator": "Isabel",
  "order": { "orderNumber": "FT-000021", "customerName": "…", "paymentMethod": "…", "deliveryType": "domicilio", "…": "…" }
}
```

Impresión y despacho se avisan después de responderle al panel: el operario nunca espera a n8n. La cotización **no pasa por n8n**: el panel la envía directo con la API de GHL (sección 9).

## 6. Menú embebido

Crear el Custom Menu Link **Pedidos Frutitodo** con apertura **Embedded Page (iFrame)** y limitarlo a los roles operativos. `location` y `token` van **escritos literalmente**:

```text
https://pedidos-frutitodo-eight.vercel.app/panel?location=UfbKDvUAPCDEaRQWYXau&token=<TOKEN>&user={{user.name}}
```

`&user={{user.name}}` sirve para que el tiquete diga quién imprimió. **Hay que probarlo:** si GHL lo reemplaza, el panel muestra el nombre arriba a la derecha. Si no lo reemplaza, el panel lo ignora y pide "¿Quién está de turno?" (se guarda en esa tablet). Con usuarios de GHL por asesor, cada turno queda registrado.

`<TOKEN>` se genera con:

```powershell
npm.cmd run provision:location -- --location-id UfbKDvUAPCDEaRQWYXau --name "COL - Frutitodo"
```

Cada ejecución reemplaza el token anterior, así que hay que actualizar el enlace del menú. Supabase guarda solo el HMAC del token con `EMBED_TOKEN_PEPPER`: si se pierde, se regenera. El token es a la vez credencial y aislamiento entre locations. Quien tenga la URL completa puede ver y despachar pedidos, así que hay que tratarla como secreto.

**No usar `{{custom_values.*}}` en el enlace:** los Custom Menu Links no resuelven custom values y el panel mostraría `Enlace de acceso incompleto`. El panel también acepta el formato con fragmento (`/panel#location=...&token=...`) y los alias `location_id` y `panel_token`.

### Botón "Abrir conversación"

Usa `target="_top"` para cambiar la pantalla de GHL a la conversación sin salir de Órbita. Junto a él hay un icono ↗ que la abre en una pestaña nueva, como respaldo si GHL bloquea la navegación desde el iframe. El dominio se puede cambiar con `NEXT_PUBLIC_GHL_APP_URL` (por defecto `https://app.iaorbita.com`).

### Dominio en uso

`https://pedidos-frutitodo-eight.vercel.app` es el proyecto de Vercel conectado a GitHub. El dominio corto `pedidos-frutitodo.vercel.app` pertenece a un proyecto viejo. Si algún día se reclama, hay que actualizar a la vez el menú, n8n (`APP_URL`) y este documento.

## 7. Dominio del iframe

El panel responde con `Content-Security-Policy: frame-ancestors`, limitado a los dominios de GHL, incluido `app.iaorbita.com`. Para otro dominio, agrégalo en `PANEL_FRAME_ANCESTORS` en Vercel (lista separada por comas).

## 8. Panel: estados y reglas

| Pestaña | Estado | Acciones |
|---|---|---|
| Nuevos | `pending` | Imprimir. Al confirmar la impresión pasa a *En preparación* |
| En preparación | `printed` | Reimprimir, Despachar |
| Despachados | `dispatched` | Consulta, Cotizar |
| Productos y precios | catálogo | Buscar, filtrar, poner precios, añadir productos |
| Requiere ayuda | `help_requests` abiertas | Abrir conversación, Marcar resuelta |

- Despachar exige una impresión confirmada.
- Un **ajuste** conserva el número de pedido. Si el pedido ya estaba impreso, vuelve a *Nuevos* marcado **Ajuste · reimprimir** y no puede despacharse sin reimprimir.
- **Pedido manual** (llamadas): botón arriba a la derecha. Entra a *Nuevos* con la marca "Manual" y sigue las mismas reglas. No tiene contacto de WhatsApp: se puede cotizar e imprimir con precios, pero no enviar.
- **Sonido:** botón de la campana. Hace falta un clic porque el navegador bloquea el audio hasta entonces. Suena distinto para un pedido nuevo y para una solicitud de ayuda. El título de la pestaña muestra `(N) Ayuda`.

### Catálogo de productos

Los 12.305 productos de Frutitodo (carnes, frutas y verduras, víveres) vienen de sus hojas `KB_*.xlsx`, convertidas a `data/catalogo-frutitodo.csv` (carpeta ignorada por git). La unidad de venta sale de la nota de cada producto ("se vende por libra" → `lb`, "en bandeja" → `bandeja`); los víveres quedan en `und`. Se importa con:

```powershell
npm.cmd run import:products -- --location-id UfbKDvUAPCDEaRQWYXau --file data/catalogo-frutitodo.csv
```

Columnas reconocidas: `referencia;nombre;categoria;subcategoria;nota;unidad;precio`; solo `nombre` es obligatoria. Volver a importar actualiza nombres y notas sin duplicar, y **no borra precios** puestos desde el panel: una fila con `precio` vacío no toca el precio existente. Para cargar precios en bloque, llena la columna `precio` y vuelve a importar.

En la pestaña **Productos y precios** se busca por nombre o referencia (tolera tildes y errores de tipeo), se filtra por categoría y por "con / sin precio", se edita el precio y la unidad de cada producto (Enter o **Guardar**) y se añaden productos que no estén en las hojas.

## 9. Cotización

Desde la tarjeta (**Cotizar**) o el detalle del pedido:

1. El panel propone para cada línea el producto del catálogo que más se parece, con su precio. Si el cliente pidió en kg y el producto se vende por libra, convierte la cantidad (**1 lb = 500 g**) y lo indica.
2. El operario confirma o cambia el producto (buscador), la cantidad, la unidad y el precio; puede agregar o quitar líneas y poner el valor del domicilio.
3. El total se calcula en vivo y **se recalcula en el servidor** (el navegador nunca decide el total).
4. **Guardar** deja la cotización como borrador; **Enviar al cliente** la manda por WhatsApp con la API de GHL, detallada línea por línea con subtotal, domicilio, total, método de pago y una nota opcional. El mensaje se puede ver antes de enviar.
5. "Guardar estos precios en el catálogo" (activado por defecto) actualiza el precio de los productos usados, así la siguiente cotización ya los trae.
6. La comanda impresa incluye la cotización con precios y total.

Reglas: no se envía si hay líneas sin precio; un doble clic o un reintento no manda el mensaje dos veces; si GHL rechaza el envío (por ejemplo, la ventana de 24 h de WhatsApp cerrada), el panel muestra el motivo y el borrador queda guardado.

Requiere en Vercel:

| Variable | Contenido |
|---|---|
| `GHL_API_TOKEN` | Private Integration token de la subcuenta (`conversations/message.write`, `contacts.write`) |
| `GHL_MESSAGE_TYPE` | Opcional, `WhatsApp` por defecto |
| `GHL_CF_ULTIMO_PEDIDO_TOTAL` | Opcional, clave del campo `ultimo_pedido_total` |

## 10. Endpoints de la app

Todos los webhooks usan `Authorization: Bearer <GHL_INGEST_SECRET>`.

| Endpoint | Uso |
|---|---|
| `POST /api/webhooks/ghl/orders` | Pedido nuevo (n8n) |
| `POST /api/webhooks/ghl/orders/amendments` | Ajuste al pedido abierto del contacto |
| `POST /api/webhooks/ghl/help-requests` | La IA pidió ayuda |

Cuerpo de pedido y ajuste:

```json
{
  "sourceEventId": "<sha256 del contacto + resumen>",
  "locationId": "UfbKDvUAPCDEaRQWYXau",
  "contactId": "<contacto>",
  "conversationId": "<opcional>",
  "customer": { "name": "…", "phone": "…", "document": "<opcional>" },
  "delivery": { "type": "domicilio", "address": "…" },
  "paymentMethod": "<opcional>",
  "items": [{ "name": "Pechuga de pollo troceada", "quantity": 2, "unit": "kg" }],
  "notes": "<opcional>"
}
```

Respuestas del endpoint de ajustes:

| Código | Cuerpo | n8n |
|---|---|---|
| `200` | `amended: true`, mismo `order.number` | Listo |
| `200` | `duplicate: true` | Reintento; no hace nada |
| `404` | `no_open_order` | Lo crea como pedido nuevo |
| `409` | `already_dispatched` | Lo crea como pedido nuevo |

## 11. Pruebas manuales sugeridas

1. **Pedido nuevo:** conversación de prueba → confirmar → aparece en *Nuevos* con cédula, pago y "Abrir conversación". En GHL quedan `pedido_resumen` (escrito por n8n), `ultimo_pedido_numero` y `ultimo_pedido_estado = nuevo`.
2. **Ajuste antes de imprimir:** pedir un cambio → mismo número, marca "Ajustado por el cliente".
3. **Ajuste después de imprimir:** imprimir → el pedido pasa a *En preparación* y en GHL queda `en_preparacion`. Pedir un cambio → vuelve a *Nuevos* con **Ajuste · reimprimir**, mismo número, y el tiquete trae la leyenda de ajuste.
4. **Ajuste después de despachar:** se crea un pedido nuevo con otro número.
5. **Ayuda:** agregar la etiqueta `requiere_ayuda` a un contacto → tarjeta roja, sonido, título `(1) Ayuda`. "Abrir conversación" lleva al chat. Marcar resuelta.
6. **Resumen ilegible:** enviar un resumen sin productos → no se crea pedido y aparece una solicitud de ayuda con el motivo.
7. **Cotización:** "Cotizar" → revisar las sugerencias del catálogo → poner precios → "Enviar al cliente" → llega el WhatsApp detallado; la tarjeta muestra "Cotización enviada" y la comanda sale con precios. Volver a abrir el catálogo: los precios usados quedaron guardados.
7b. **Catálogo:** importar el CSV, buscar "pechuga", filtrar "Sin precio", poner un precio y guardarlo.
8. **Despachar:** llega el mensaje de "va en camino" y queda `despachado` en GHL.
9. **Pedido manual:** crear uno → aparece en *Nuevos* con la marca "Manual" → imprimir → despachar.
10. **Operador:** verificar si `{{user.name}}` llega por el menú. Si no, usar "¿Quién está de turno?" e imprimir para ver "Impreso por".
