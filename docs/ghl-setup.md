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
- URL: `https://<DOMINIO_VERCEL>/api/webhooks/ghl/orders`
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

```text
https://<DOMINIO_VERCEL>/panel#location={{location.id}}&token={{custom_values.frutitodo_panel_token}}
```

Crear `frutitodo_panel_token` en **Settings → Custom Values** usando el valor generado por `npm run provision:location`. El token del fragmento no se envía al servidor al cargar el documento; el panel lo mueve a `sessionStorage` y elimina el fragmento.
