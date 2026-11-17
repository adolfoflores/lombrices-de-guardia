# Arquitectura

Un mapa para orientarte en el código: cómo fluye una partida, qué hace cada carpeta y dónde
tocar para los cambios más comunes. Las reglas de juego están en [RULES](RULES.md) y las
pruebas en [TESTING](TESTING.md).

## Principios

- **El servidor manda.** Un proceso Node simula cada partida a 60 Hz y decide posiciones,
  colisiones, daño, viento, turnos y resultado. El navegador solo envía **intenciones**
  (moverse, apuntar, disparar) y dibuja lo que recibe.
- **Código compartido.** `shared/` corre igual en el servidor y en el navegador: configuración,
  terreno y física. Así el cliente puede predecir el movimiento de tu gusano sin duplicar reglas.
- **Sin framework.** Módulos ES de JavaScript, HTML semántico, Canvas 2D y PixiJS. Vite solo
  sirve el cliente en desarrollo y lo compila para producción.
- **Todo local.** El arte, la música y los efectos viven en el repositorio o se sintetizan en
  el navegador. No hay APIs externas durante la partida.

## Flujo de una partida

```
Navegador                                   Servidor (un proceso)
─────────                                   ─────────────────────
portada ── create / join ─── WebSocket ──▶  rooms.js crea o busca la sala
sala    ── settings, team, ready, start ──▶  valida y difunde { type: 'room' }
carga   ── loaded ────────────────────────▶  todos listos → new Game(...)
combate ── action { input | fire | … } ───▶  engine.js simula a 60 Hz
        ◀── state (15 Hz) ─────────────────  snapshot; el terreno solo si cambió
final   ◀── state con result ──────────────  repetición del golpe final y resumen
```

1. La portada no abre ningún socket hasta que alguien crea una sala o entra a una.
2. Cada comando lleva un `id` único y, después del saludo, una secuencia `seq` creciente. El
   servidor responde con `ack` y nunca ejecuta dos veces el mismo comando, aunque haya
   reconexiones.
3. Durante el combate el servidor envía estados a 15 Hz. El cliente los interpola para dibujar
   a la frecuencia de la pantalla y predice solo la posición de su propio gusano.
4. El terreno es una máscara de 1600×900. Viaja comprimido (RLE) al empezar, al reconectar y
   cada vez que una explosión o una viga lo cambian.

## Carpetas

### `shared/`: reglas y simulación

| Archivo         | Qué hace                                                              |
| --------------- | --------------------------------------------------------------------- |
| `config.js`     | Balance central: armas, mapas, modalidades, tiempos y física          |
| `engine.js`     | `Game`: turnos, proyectiles, minas, cajas, explosiones y resultado    |
| `actions.js`    | Valida y aplica las intenciones de cada jugador                       |
| `physics.js`    | Movimiento, saltos, suelo y colisiones; lo reusa la predicción local  |
| `statistics.js` | Atribuye daño y bajas a cada ataque y elige al jugador de la partida  |
| `terrain.js`    | Geometría fija de los tres mapas, máscara destructible y codificación |
| `aim.js`        | Normalización del ángulo y orientación del gusano                     |
| `names.js`      | Los 72 apodos de los gusanos                                          |

### `server/`: red y salas

| Archivo              | Qué hace                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| `index.js`           | Arranque, reloj de la simulación, latido y Vite en desarrollo            |
| `start.js`           | Punto de entrada de `npm start`, siempre en producción                   |
| `http.js`            | Archivos de `dist/`, `/health` y validación de rutas                     |
| `rooms.js`           | Salas: entrada, sala de espera, carga, partida, revancha y desconexiones |
| `protocol.js`        | Validación de cada mensaje, ajuste y acción                              |
| `messages.js`        | Envío seguro a cada socket y caché de respuestas                         |
| `command-journal.js` | Confirmaciones acotadas y última secuencia aceptada por identidad        |
| `limits.js`          | Admisión de conexiones, límites por dirección, origen y `TRUST_PROXY`    |

### `client/`: interfaz y presentación

| Ruta                                                                                       | Qué hace                                                      |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `main.js`                                                                                  | Coordina pantallas, controles, HUD y sesión                   |
| `session/`                                                                                 | Socket, reconexión, secuencias e identidad guardada           |
| `ui/`, `home.js`, `lobby.js`, `arsenal.js`                                                 | Portada, sala de espera, diálogos, ajustes, arsenal y resumen |
| `combat-hud.js`, `combat-controls.js`                                                      | HUD de combate y control contextual de apuntado               |
| `mobile-controls.js`, `slingshot.js`, `keyboard.js`, `aim-control.js`, `charge-control.js` | Palancas táctiles, honda, teclado, apuntado y anillo de carga |
| `prediction.js`                                                                            | Predicción local del gusano propio                            |
| `renderer.js`, `rendering/`                                                                | Canvas 2D: terreno, fondo, cámara, gestos y repetición        |
| `hills-*.js`, `biome-*.js`                                                                 | Arte pintado y materiales de cada mapa                        |
| `pixi-combat.js`, `pixi-character.js`                                                      | Capa PixiJS: gusanos animados, placas y bocadillos            |
| `pixi-effects.js`, `effects/`                                                              | Proyectiles, explosiones y efectos de cada familia de armas   |
| `art/`                                                                                     | Paleta y dibujo vectorial de armas, herramientas y cajas      |
| `audio.js`                                                                                 | Música y efectos sintetizados con Web Audio                   |

El campo de batalla usa dos lienzos superpuestos. El Canvas 2D dibuja el fondo y el terreno y
recibe los gestos de cámara; encima, una capa PixiJS sin eventos dibuja gusanos, proyectiles y
efectos. Si WebGL falla, el juego sigue con el Canvas 2D.

### Resto del repositorio

- `public/`: arte servido tal cual (mapas en WebP, ilustraciones del arsenal, iconos).
- `art/source/`: maestros PNG de los mapas; `npm run art:optimize` genera los WebP.
- `tests/`: pruebas de Node, sin navegador.
- `scripts/`: compilación, comprobaciones y recorridos de navegador con Playwright.

## Protocolo

WebSocket en `/socket` con mensajes JSON. Todos los comandos llevan un `id` único; los que no
son de entrada llevan además `seq`.

| Cliente → servidor                    | Para qué                                                         |
| ------------------------------------- | ---------------------------------------------------------------- |
| `create`, `join`, `resume`            | Crear sala, entrar con código o recuperar la sesión              |
| `settings`, `team`, `ready`, `start`  | Configurar la sala y empezar (los ajustes son de quien organiza) |
| `loaded`                              | Avisar que el mapa terminó de cargar                             |
| `action`                              | Intención de juego: `input`, `jump`, `fire`, `release` o `end`   |
| `rematch`, `rematch-request`, `lobby` | Revancha o volver a la sala                                      |
| `leave`                               | Salir y liberar el lugar                                         |

| Servidor → cliente | Contenido                                                         |
| ------------------ | ----------------------------------------------------------------- |
| `welcome`          | Identidad, token de reconexión, código de sala y secuencia        |
| `room`             | Estado de la sala: fase, ajustes y participantes                  |
| `state`            | Snapshot de la partida (`Game.snapshot()`), con terreno si cambió |
| `ack`              | Confirmación de un comando, con `error` si se rechazó             |
| `error`, `left`    | Mensaje no válido o salida confirmada                             |

Los ángulos usan coordenadas de Canvas: 0 apunta a la derecha y −π/2 hacia arriba. Las
unidades son píxeles del mundo y segundos. El servidor valida tipos, rangos, turno, munición y
destino de cada acción, aunque la interfaz ya los limite.

## Cambios frecuentes

- **Ajustar el balance** (daño, radios, munición, tiempos, física): `shared/config.js`.
- **Añadir un arma:** definirla en `shared/config.js`; implementar su efecto en
  `shared/actions.js` y `shared/engine.js`; dibujarla en `client/art/weapons.js` y sus efectos
  en `client/effects/`; regenerar su ilustración del arsenal con
  `node scripts/export-arsenal-art.js`; darle sonido en `client/audio.js`.
- **Añadir un mapa:** geometría en `shared/terrain.js`, entrada en `MAPS` de
  `shared/config.js`, arte en `art/source/` y `public/art/`, y material y fondo en
  `client/biome-*.js`.
- **Cambiar la interfaz:** pantallas en `client/ui/`, `home.js` y `lobby.js`; combate en
  `client/combat-hud.js`; estilos en los CSS del mismo nombre.

Después de cualquier cambio, `npm run verify` debe pasar. Si tocas la presentación, corre
también el recorrido de navegador correspondiente (ver [TESTING](TESTING.md)).
