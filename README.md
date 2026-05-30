# Wallapop Search Agent & Notifier 🚀

Este proyecto es un agente inteligente desarrollado en Node.js que monitoriza Wallapop en tiempo real para encontrar productos basados en tus filtros (palabras clave, rangos de precio, localización, etc.). Te notifica instantáneamente a través de **Telegram** y/o **WhatsApp** con las características del anuncio (título, precio, ubicación, descripción) y un enlace directo para que puedas comprarlo antes de que se venda.

## Características

*   **Evita Bloqueos (CloudFront Bypass):** En lugar de hacer peticiones HTTP directas (que son bloqueadas inmediatamente por el WAF de Wallapop), utiliza **Playwright** en segundo plano para emular un navegador real e interceptar las respuestas JSON de la API interna (`/api/v3/search/section`).
*   **Filtros Avanzados:** Puedes añadir búsquedas usando filtros estructurados o pegando directamente la URL de búsqueda de la web de Wallapop.
*   **Notificaciones en Telegram:** Notificaciones instantáneas y muy estables a través de un Bot de Telegram de forma gratuita.
*   **Notificaciones en WhatsApp:** Soporte para notificaciones a tu número de WhatsApp escaneando un código QR en la consola gracias a `whatsapp-web.js` (sesión persistente).
*   **Deduplicación Inteligente:** Almacena localmente un registro de los productos ya vistos en `seen_products.json` para no enviarte alertas repetidas.

---

## Requisitos Previos

Tener instalado **Node.js** (versión 18 o superior).

---

## Instalación

1.  Instala las dependencias del proyecto:
    ```bash
    npm install
    ```
2.  Instala el motor de Chromium necesario para Playwright:
    ```bash
    npx playwright install chromium
    ```

---

## Configuración (`config.json`)

Edita el archivo `config.json` en la raíz del proyecto para definir tus canales de notificación y los productos que deseas buscar.

Ejemplo de `config.json`:
```json
{
  "check_interval_minutes": 5,
  "notifications": {
    "telegram": {
      "enabled": true,
      "bot_token": "1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ",
      "chat_id": "987654321"
    },
    "whatsapp": {
      "enabled": false,
      "chat_id": "34600112233"
    }
  },
  "searches": [
    {
      "name": "Logitech G920 barato",
      "keywords": "logitech g920",
      "min_price": 100,
      "max_price": 200,
      "order_by": "newest"
    },
    {
      "name": "Nintendo Switch OLED",
      "url": "https://es.wallapop.com/search?keywords=nintendo%20switch%20oled&min_sale_price=150&max_sale_price=220&order_by=newest"
    }
  ]
}
```

### Opciones de Notificación

#### 1. Telegram (Recomendado)
*   **bot_token:** Crea un bot hablando con [@BotFather](https://t.me/BotFather) en Telegram usando el comando `/newbot`. Te dará un token.
*   **chat_id:** Inicia una conversación con tu bot y luego consulta tu Chat ID escribiendo a [@userinfobot](https://t.me/userinfobot) o accediendo a `https://api.telegram.org/bot<TU_TOKEN>/getUpdates`.

#### 2. WhatsApp
*   **chat_id:** Tu número de teléfono con el código de país (ej. `34600112233` para España, sin símbolos de más `+` ni espacios).
*   La primera vez que inicies el agente con WhatsApp habilitado, aparecerá un **código QR en la terminal**. Escanéalo con tu aplicación móvil de WhatsApp (Dispositivos vinculados) para iniciar sesión. La sesión quedará guardada de forma persistente.

### Opciones de Búsqueda (`searches`)
Puedes añadir tantas búsquedas como quieras en la lista `searches`. Tienes dos formas de configurarlas:
1.  **Forma estructurada (Recomendado):**
    *   `name`: Nombre descriptivo de la búsqueda (se incluye en la notificación).
    *   `keywords`: Texto de búsqueda (ej. `logitech g920`).
    *   `min_price` (Opcional): Precio mínimo.
    *   `max_price` (Opcional): Precio máximo.
    *   `order_by` (Opcional): Criterio de ordenación. Usa `newest` para ver lo más nuevo primero.
    *   `distance_in_km`, `latitude`, `longitude` (Opcionales): Para restringir la búsqueda a un radio geográfico específico.
2.  **Pegando una URL directa:**
    *   `name`: Nombre descriptivo.
    *   `url`: Pega la URL completa de la búsqueda desde tu navegador. Útil si usas filtros complejos en la web.

---

## Cómo Ejecutar el Agente

El agente tiene varios comandos de ejecución para facilitar las pruebas y el uso diario:

### 1. Probar el Canal de Notificaciones
Verifica que las credenciales de Telegram o el inicio de sesión de WhatsApp funcionan enviando un mensaje de prueba:
```bash
node agent.js --test-notify
```

### 2. Ejecución Única (Modo Test)
Realiza una sola búsqueda de prueba en Wallapop, muestra los resultados encontrados en la consola e identifica qué anuncios son nuevos (y enviaría notificaciones):
```bash
node agent.js --run-once
```

### 3. Simulación sin Notificar (Dry Run)
Realiza una sola búsqueda pero simula el envío (imprime en consola qué notificaciones se enviarían sin enviarlas realmente a tu teléfono):
```bash
node agent.js --run-once --dry-run
```

### 4. Monitorización Continua (Modo Producción)
Inicia el bot para que corra continuamente y busque nuevos productos cada `check_interval_minutes` minutos de forma indefinida:
```bash
node agent.js
```
*(Nota: En la primera ejecución continua, el agente guardará todos los productos actuales en la base de datos `seen_products.json` sin notificártelos, para no saturarte de mensajes. A partir del siguiente ciclo, te notificará cada vez que aparezca un producto nuevo).*

### 5. Ejecutar con Docker
Si prefieres no instalar Node.js ni Chromium en tu máquina, puedes ejecutar el agente dentro de un contenedor Docker. 

1. **Construye la imagen:**
   ```bash
   docker build -t wallapop-agent .
   ```
2. **Crea el archivo de la base de datos vacío** (solo la primera vez, para que Docker pueda montarlo correctamente):
   ```bash
   touch seen_products.json
   ```
3. **Ejecuta el contenedor** en segundo plano (montando tu `.env` y los volúmenes de datos):
   ```bash
   docker run -d \\
     --name wallapop-agent \\
     --env-file .env \\
     -v $(pwd)/config.json:/app/config.json \\
     -v $(pwd)/seen_products.json:/app/seen_products.json \\
     wallapop-agent
   ```
*(Nota: Si usas WhatsApp, ten en cuenta que necesitarás ver la consola con `docker logs -f wallapop-agent` para escanear el QR la primera vez, y además deberías mapear el volumen `-v $(pwd)/.wwebjs_auth:/app/.wwebjs_auth` para guardar la sesión).*

---

## Estructura del Proyecto

*   `agent.js`: Archivo principal que gestiona el ciclo de monitorización, la base de datos de productos vistos y las alertas.
*   `scraper.js`: Módulo encargado de lanzar Playwright, navegar por Wallapop y capturar el JSON de la API.
*   `notifier.js`: Canalizador de notificaciones para Telegram y WhatsApp Web.
*   `config.json`: Archivo de configuración personal.
*   `seen_products.json`: Almacén local de identificadores de anuncios para deduplicación.
