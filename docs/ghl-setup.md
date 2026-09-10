# Configuración de GHL para Frutitodo

## 1. Campos temporales del contacto

Crear estos campos personalizados en la subcuenta de Frutitodo:

| Nombre | Clave sugerida | Tipo | Contenido |
|---|---|---|---|
| Pedido evento ID | `pedido_evento_id` | Texto | UUID nuevo por pedido confirmado |
| Pedido productos JSON | `pedido_productos_json` | Texto largo | Arreglo JSON de productos |
| Pedido tipo entrega | `pedido_tipo_entrega` | Lista | `domicilio` o `recogida` |
| Pedido dirección | `pedido_direccion` | Texto largo | Dirección completa; vacío para recogida |
| Pedido observaciones | `pedido_observaciones` | Texto largo | Sustituciones, indicaciones y notas |

Ejemplo válido de `pedido_productos_json`:

```json
[
  { "name": "Leche deslactosada Alpina 1L", "quantity": 2, "unit": "unidad" },
  { "name": "Aguacate Hass", "quantity": 1.5, "unit": "kg" }
]
```

## 2. Reglas del agente

Agregar una acción de información de contacto por cada campo y mapearla a su campo correspondiente. Mantener los campos vacíos al iniciar un pedido nuevo. El agente debe cumplir este contrato:

1. Recolectar nombre, teléfono, productos con cantidad/unidad, tipo de entrega, dirección si es domicilio y observaciones.
2. Mostrar un resumen final al cliente y solicitar confirmación explícita.
3. Solo después de la confirmación, guardar los cinco campos. `pedido_evento_id` debe ser un UUID nuevo y `pedido_productos_json` debe ser JSON válido, sin Markdown.
4. Disparar exactamente una vez el workflow **Enviar pedido confirmado a Frutitodo**.
5. No afirmar que el pedido llegó a operación si la acción del workflow falla.

No habilitar un segundo trigger automático para el mismo workflow; la entrada debe ser únicamente la acción **Trigger Workflow** del agente.

## 3. Custom Webhook del workflow

Crear el workflow en borrador y añadir un **Custom Webhook**:

- Método: `POST`
- URL: `https://pedidos-frutitodo-eight.vercel.app/api/webhooks/ghl/orders`
- Header: `Authorization: Bearer <GHL_INGEST_SECRET>`
- Header: `Content-Type: application/json`
- Body JSON:

```json
{
  "sourceEventId": "{{custom_fields.pedido_evento_id}}",
  "locationId": "{{location.id}}",
  "contactId": "{{contact.id}}",
  "customer": {
    "name": "{{contact.name}}",
    "phone": "{{contact.phone}}"
  },
  "delivery": {
    "type": "{{custom_fields.pedido_tipo_entrega}}",
    "address": "{{custom_fields.pedido_direccion}}"
  },
  "items": {{custom_fields.pedido_productos_json}},
  "notes": "{{custom_fields.pedido_observaciones}}"
}
```

Usar el selector de valores dinámicos de GHL para insertar las claves reales; los nombres generados pueden variar. Probar el body capturado antes de publicar.

Después del webhook:

1. Añadir la etiqueta `pedido_enviado`.
2. Limpiar los cinco campos temporales para que el siguiente pedido pueda reemplazarlos.
3. Si el webhook falla, no ejecutar la limpieza; conservar los datos para diagnóstico.

## 4. Menú embebido

Crear el Custom Menu Link **Pedidos Frutitodo** con apertura **Embedded Page (iFrame)** y limitarlo a los roles operativos.

La URL debe llevar el `location` y el `token` **escritos literalmente**, sin merge tags:

```text
https://pedidos-frutitodo-eight.vercel.app/panel?location=UfbKDvUAPCDEaRQWYXau&token=<TOKEN>
```

`UfbKDvUAPCDEaRQWYXau` es el location ID de la subcuenta COL - Frutitodo y `<TOKEN>` es el valor generado por `npm run provision:location`. Generarlo o regenerarlo con:

```powershell
npm.cmd run provision:location -- --location-id UfbKDvUAPCDEaRQWYXau --name "COL - Frutitodo"
```

Cada ejecución reemplaza el token anterior; hay que actualizar el enlace del menú con el nuevo valor. Supabase guarda solo el HMAC-SHA256 del token con `EMBED_TOKEN_PEPPER`, así que el valor en claro no se puede recuperar después: si se pierde, se regenera.

El token no puede ser un valor inventado. En cada llamada el panel envía `Authorization: Bearer <TOKEN>` y `X-Location-Id: <LOCATION_ID>`; el servidor vuelve a calcular el HMAC y busca la fila de `locations` que coincida con ambos y esté activa. Esa fila define de qué subcuenta son los pedidos que se devuelven, así que el token es a la vez credencial y aislamiento entre locations. Un valor que no salga del script responde `401 Acceso no autorizado`.

El custom value `frutitodo_panel_token` es opcional y no cumple ninguna función en tiempo de ejecución: sirve solo como lugar donde dejar anotado el token. Quien tenga la URL completa del menú puede ver y despachar los pedidos de la subcuenta, así que hay que tratarla como secreto.

**No usar `{{custom_values.frutitodo_panel_token}}` en el enlace.** Los Custom Menu Links solo resuelven un conjunto reducido de merge tags y los custom values no están incluidos, así que GHL entrega el enlace sin token y el panel muestra `Enlace de acceso incompleto`. El menú vive dentro de una sola subcuenta, así que los valores literales son además más predecibles que `{{location.id}}`.

El panel también acepta el formato antiguo con fragmento (`/panel#location=...&token=...`) y los alias `location_id` y `panel_token`, por si GHL reescribe la URL. Al cargar mueve las credenciales a `sessionStorage` y las borra de la barra de direcciones; si el navegador bloquea el almacenamiento dentro del iframe, las conserva en memoria y deja la URL intacta para que el siguiente refresco vuelva a funcionar.

Cuando el panel no reciba credenciales válidas indicará en pantalla qué falta (token, location o merge tag sin resolver), lo que permite diagnosticar el enlace sin abrir la consola.

### Dominio en uso

`https://pedidos-frutitodo-eight.vercel.app` es el dominio del proyecto de Vercel conectado a GitHub: despliega solo en cada push y tiene las cuatro variables de entorno con scope Production. El dominio corto `pedidos-frutitodo.vercel.app` pertenece a un proyecto anterior que sirve un build viejo; si en algún momento se retira ese proyecto y se reclama el nombre corto, hay que actualizar aquí el menu link y el Custom Webhook a la vez.

## 5. Dominio del iframe

El panel responde con `Content-Security-Policy: frame-ancestors` limitado a los dominios de GHL, incluido el white label `app.iaorbita.com`. Si la agencia cambia de dominio, agregarlo en la variable de entorno `PANEL_FRAME_ANCESTORS` de Vercel como lista separada por comas; se suma a los valores por defecto sin tocar el código.

## 6. Aviso de despacho hacia n8n

Cuando un pedido se marca como despachado, la app avisa a n8n para que actualice la oportunidad en GHL. Se configura con dos variables de entorno en Vercel:

| Variable | Contenido |
|---|---|
| `N8N_DISPATCH_WEBHOOK_URL` | URL del nodo Webhook de n8n |
| `N8N_WEBHOOK_SECRET` | Opcional. Se envía como `Authorization: Bearer <valor>` |

Si `N8N_DISPATCH_WEBHOOK_URL` está vacía la app no llama a nadie; el panel funciona igual. Es intencional: la automatización es opcional y nunca debe poder tumbar el despacho.

Cuerpo del `POST`:

```json
{
  "event": "order.dispatched",
  "requestId": "<id único del clic en el panel>",
  "ghlLocationId": "UfbKDvUAPCDEaRQWYXau",
  "ghlContactId": "<contacto en GHL>",
  "order": {
    "id": "<uuid>",
    "orderNumber": "FT-000021",
    "customerName": "...",
    "customerPhone": "...",
    "deliveryType": "domicilio",
    "deliveryAddress": "...",
    "items": [{ "name": "...", "quantity": 1.5, "unit": "kg" }],
    "notes": "...",
    "status": "dispatched",
    "receivedAt": "...",
    "dispatchedAt": "..."
  }
}
```

`ghlContactId` es la llave para encontrar la oportunidad. `requestId` sirve como llave de idempotencia si n8n necesita descartar repeticiones.

El envío ocurre después de responderle al panel, con `after()` de Next: el operario nunca espera a n8n. Ante un `5xx` reintenta una vez; ante un `4xx` no reintenta porque el payload no va a mejorar. Si agota los intentos lo deja en los logs de Vercel nombrando el pedido, para poder reponerlo a mano.

## 7. Modificar un pedido (anexos y correcciones)

`POST https://pedidos-frutitodo-eight.vercel.app/api/webhooks/ghl/orders/amendments`

Mismo header `Authorization: Bearer <GHL_INGEST_SECRET>` y **el mismo cuerpo** que el endpoint de creación. La semántica es de reemplazo, no de suma: el extractor relee toda la conversación, así que el anexo llega con el pedido completo y sustituye el contenido anterior. Eso cubre por igual "agrégame dos libras de tomate" y "quita el aguacate".

Busca el pedido más reciente de ese `contactId` que siga abierto (`pending` o `printed`) y:

1. Reemplaza productos, cliente, entrega y observaciones.
2. Devuelve el estado a `pending` y suma uno a `amendment_count`.
3. Registra un evento `amended`, usando el `sourceEventId` como llave de idempotencia: un reintento no vuelve a aplicar el cambio ni infla el contador.

El regreso a `pending` es deliberado. Despachar exige una impresión confirmada, así que un pedido modificado **no puede salir sin reimprimirse**. El panel lo marca con `Modificado · reimprimir` en la tarjeta y en el detalle, y el tiquete sale con la leyenda `PEDIDO MODIFICADO · DESCARTA EL TIQUETE ANTERIOR` para que nadie aliste con papel viejo.

Respuestas:

| Código | Cuerpo | Qué hacer en n8n |
|---|---|---|
| `200` | `amended: true` | Listo |
| `200` | `duplicate: true` | Reintento; no hacer nada |
| `404` | `no_open_order` | El contacto no tiene pedidos: crear uno con el endpoint normal |
| `409` | `already_dispatched` | El pedido ya salió: crear uno nuevo con el endpoint normal |

En n8n, las acciones **Anexo a Pedido** y las de modificación usan el mismo flujo de extracción del pedido entrante; solo cambia el nodo final de HTTP. Ante `404` o `409`, reenviar el mismo payload al endpoint de creación.

Requiere aplicar las migraciones `20260910120000` y `20260910120100`.
