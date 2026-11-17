# Despliegue

Un solo proceso Node sirve el cliente compilado (`dist/`), el WebSocket del juego en `/socket` y
un chequeo de salud en `/health`. Funciona en cualquier servidor o plataforma capaz de ejecutar
Node o un contenedor Docker, detrás de un proxy inverso con HTTPS.

## Con Docker

El [Dockerfile](../Dockerfile) compila el cliente, elimina las dependencias de desarrollo y
ejecuta el servidor como el usuario sin privilegios `node`.

```sh
docker build -t lombrices-de-guardia .
docker run -d --name lombrices -p 127.0.0.1:3000:3000 -e TRUST_PROXY=1 lombrices-de-guardia
```

El ejemplo publica el puerto solo en `127.0.0.1` para que únicamente el proxy de la misma
máquina pueda alcanzarlo. La imagen incluye un `HEALTHCHECK` que consulta `/health` con Node,
sin necesidad de `curl`. Si tu plataforma permite configurar otro chequeo, apúntalo a la misma
ruta o deja el de la imagen.

En plataformas que construyen desde Git (Coolify, Dokploy, CapRover, Fly.io, Railway…) usa el
Dockerfile de la raíz con el repositorio completo como contexto, expón el puerto interno `3000`
y declara las variables de la tabla de abajo.

## Sin Docker

```sh
npm ci
npm run build
npm start
```

`npm start` fuerza el modo producción. No publiques `npm run dev`: sirve los archivos fuente
con Vite y solo escucha en localhost.

## Configuración

Los scripts no cargan `.env` automáticamente. Exporta las variables o usa
`node --env-file=.env server/index.js`. [.env.example](../.env.example) contiene los valores.

| Variable                 | Predeterminado                                     | Uso                                                 |
| ------------------------ | -------------------------------------------------- | --------------------------------------------------- |
| `PORT`                   | `3000`                                             | Puerto HTTP y WebSocket                             |
| `HOST`                   | `127.0.0.1` en desarrollo; `0.0.0.0` en producción | Interfaz de escucha                                 |
| `NODE_ENV`               | desarrollo                                         | Usa `production` para servir `dist/`                |
| `MAX_CONNECTIONS`        | `256`                                              | Sockets simultáneos en total                        |
| `MAX_CONNECTIONS_PER_IP` | `32`                                               | Sockets simultáneos por dirección                   |
| `MAX_ROOMS`              | `32`                                               | Salas simultáneas                                   |
| `MAX_ROOMS_PER_IP`       | `8`                                                | Salas creadas por dirección                         |
| `TRUST_PROXY`            | desactivado                                        | `1` acepta la última dirección de `X-Forwarded-For` |
| `ALLOWED_ORIGINS`        | vacío                                              | Orígenes adicionales exactos, separados por comas   |

El navegador debe enviar un origen cuyo host y puerto coincidan con los del servicio, salvo
los orígenes adicionales explícitos. Clientes de pruebas sin `Origin` siguen admitidos.

Cada socket dispone de una ráfaga de 512 mensajes, recupera 60 mensajes por segundo y admite
12 intentos iniciales de entrada con recuperación de uno por segundo. La portada permanece sin
socket hasta solicitar entrada. Un socket sin identidad caduca a los 15 s; una salida explícita
inicia un plazo nuevo. Mensajes de más de 8 KB son rechazados por WebSocket. Los límites buscan
proteger una instancia pequeña; ajústalos después de medir carga real, no sustituyen la
protección de red del proveedor.

## Proxy inverso y dominio

- **HTTPS obligatorio fuera de la red local.** El cliente usa `wss://` automáticamente al abrirse
  por HTTPS. El portapapeles y el menú de compartir también lo necesitan.
- **Mismo dominio y mismo proceso.** La página y `/socket` deben llegar al mismo contenedor. El
  proxy tiene que reenviar las cabeceras `Upgrade` y `Connection` del WebSocket; Traefik y Caddy
  lo hacen solos, y [deploy/nginx.conf](../deploy/nginx.conf) es un ejemplo para Nginx.
- **Dominio o subdominio dedicado.** La aplicación usa rutas absolutas como `/socket` y no está
  preparada para publicarse bajo una subruta como `/juego`.
- **Puerto interno cerrado.** No expongas el puerto 3000 a Internet; solo el proxy debe
  alcanzarlo.

### `TRUST_PROXY`

Detrás de un proxy, el proceso ve la dirección del proxy en cada conexión. Sin `TRUST_PROXY=1`,
los límites por dirección se aplican a **todo el sitio**: con los valores predeterminados, como
máximo 8 salas y 32 conexiones en total. Con la variable activada, el servidor usa la última
dirección de `X-Forwarded-For`, la que añade tu proxy.

Actívala solo si el puerto interno no es accesible directamente y el proxy sobrescribe `Host` y
`X-Forwarded-For` con valores confiables. Si un cliente pudiera conectarse directo al proceso,
podría inventar su dirección.

Si hay una CDN con proxy delante, como Cloudflare con la nube naranja, la última dirección será
la de la CDN y varios jugadores compartirán límites. Configura tu proxy para confiar en los
rangos de la CDN y reescribir la dirección real, o sube `MAX_CONNECTIONS_PER_IP` y
`MAX_ROOMS_PER_IP`.

## Operación

- **Una sola instancia.** Las salas viven en la memoria de un proceso. No uses réplicas,
  balanceo entre procesos ni clúster de Node: cada proceso tendría salas distintas.
- **Sin rolling updates.** Un reemplazo gradual ejecuta dos contenedores a la vez y parte las
  salas entre ellos. Configura tu plataforma para detener el contenedor anterior antes de
  iniciar el nuevo; en Docker basta con un nombre de contenedor fijo.
- **Actualiza sin partidas activas.** Reiniciar, redesplegar o reemplazar el contenedor pierde
  las partidas, incluso tras un reinicio automático por fallo. Un volumen no conserva ese
  estado, así que no hace falta ninguno.
- Se guardan hasta 256 confirmaciones por identidad. Números de secuencia crecientes impiden
  ejecutar de nuevo comandos antiguos, incluso tras su expulsión de la caché o una reconexión.
- Cuando una versión cambia el protocolo, los navegadores abiertos deben recargar.

## Verificación tras desplegar

1. Comprueba que el contenedor quede saludable y que el log indique modo producción.
2. Abre `https://tu-dominio/health` y confirma la respuesta `{"ok":true}`.
3. Crea una sala y entra desde otro dispositivo en otra red, por ejemplo un teléfono con datos
   móviles. Juega una partida y comprueba movimiento, disparo, turnos y terreno en ambos.
4. Corta la conexión un momento y vuelve a la misma sala. En iPhone, prueba también Safari y
   la app añadida a la pantalla de inicio.

Antes de anunciar una versión, revisa también [las comprobaciones de TESTING](TESTING.md) y
habilita los reportes privados de seguridad en tu repositorio.
