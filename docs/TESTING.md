# Pruebas

## Comprobación de un checkout limpio

```sh
npm ci
npm run verify
```

`verify` comprueba que Node y las dependencias instaladas coincidan con el lockfile; después ejecuta sintaxis recursiva, ESLint, formato, avisos de terceros, compilación y todos los tests Node. Una instalación antigua no puede dar una verificación de publicación aprobada. La prueba
HTTP de producción ya no se omite silenciosamente cuando falta `dist/`: compilar es parte
obligatoria de la comprobación. Node 22.13+ y 24 se comprueban en CI. ESLint detecta referencias sin declarar, código sin uso y errores estáticos; los globals de los recorridos de navegador se declaran únicamente en sus propios archivos, donde los crea el harness.

Para trabajar en un entorno que no permite abrir puertos:

```sh
npm run test:unit
npm run test:security
```

Estos comandos ejercitan el motor, controles, el servicio real de salas con transporte en
memoria y el transporte del cliente con un socket controlado. No sustituyen los tests de red.
`npm test` también abre HTTP/WebSocket locales y necesita permisos para hacerlo.

## Antes de publicar una versión

En un checkout nuevo con acceso al registro y a los navegadores:

```sh
npm ci
npx playwright install chrome webkit
npm run test:release
npm audit --audit-level=high
docker build -t lombrices-de-guardia .
```

`test:release` ejecuta `verify`, las simulaciones de los tres mapas y las seis combinaciones
de navegador (Chromium y WebKit en cada mapa) con el cliente compilado. Los informes se
generan en `docs/evidence/`, que Git ignora. Las comprobaciones manuales de la sección final,
incluidos teléfonos físicos y HTTPS/WSS público, siguen siendo necesarias antes de anunciar
una versión estable.

## Regresiones de publicación

`tests/server-safety.test.js` comprueba URLs malformadas, expiración después de desconexión
seguida de salida explícita, eliminación de salas sin jugadores, reconexión durante la
caducidad, límites de salas/conexiones/mensajes, orígenes, confianza en proxy, plazos de
entrada y deduplicación acotada tras miles de comandos. Repite un disparo después de expulsar
su confirmación de la caché y de reconectar: no vuelve a ejecutarse.

`tests/transport.test.js` comprueba secuencias sincronizadas por `welcome`, confirmaciones,
latencia, reconexión, toma de sesión por otra ventana, memoria acotada, preferencias
malformadas y el resumen final extraído de la interfaz. Las suites existentes siguen
comprobando física, puntería, predicción, equipos, armas y transporte real.

`tests/session.test.js` y `session-contract.test.js` ejercitan la entrada diferida, portada
sin conexiones, rechazo de entrada, restauración, salida y reentrada con el servicio real en
memoria. `tests/presentation.test.js` cubre cámara, repetición, efectos acotados y foco del
teclado. `tests/toolchain.test.js` rechaza instalaciones obsoletas.

`tests/lobby.test.js` comprueba cambios rápidos antes de recibir una respuesta, validación
atómica de parches, compatibilidad de comandos completos y transición de tres alianzas a
dos. La composición normalizada permite iniciar una nueva partida. `aim-control.test.js`
comprueba captura independiente, apuntado nativo, arrastre, cambio de orientación y limpieza.
La exportación rechaza reportes ignorados pero versionados antes de crear archivos; también
protege informes anteriores y comprueba un clon de la copia generada.

## Navegadores

```sh
npx playwright install chrome webkit
npm run build
npm run test:browser:all
```

El recorrido crea seis contextos independientes, inicia una partida, mueve, apunta, dispara,
reconecta, comprueba el resultado y prepara revancha. También deja la portada inactiva más de
15 segundos y comprueba que no se abra ninguna conexión. La matriz cubre Chromium y WebKit
en hills/cavern/islands (seis combinaciones), siempre con el paquete compilado. Cada combinación escribe
en `docs/evidence/browser/<navegador>-<mapa>/`. Incluso un fallo al iniciar servidor o navegador
genera un informe y libera los recursos ya abiertos. Chrome instalado es el predeterminado;
WebKit de Playwright no equivale a Safari en un iPhone físico.

Recorridos específicos, ejecutados individualmente con desarrollo actualizado:

```sh
node scripts/client-regressions.js
node scripts/result-replay-smoke.js
node scripts/touch-smoke.js
node scripts/slingshot-smoke.js
node scripts/motion-smoke.js
node scripts/lobby-mobile-smoke.js
node scripts/home-smoke.js
npm run test:presentation
npm run test:pixi
npm run test:identity
npm run test:terrain
npm run test:biomes
node scripts/network-smoke.js --stress
npm run test:soak
```

`test:soak` dura 600 segundos reales; `SOAK_SECONDS=60` es solo una comprobación corta. Los
informes se escriben en `docs/evidence/` (ignorado por Git). Las referencias visuales
históricas usadas por terreno/biomas viven en `tests/fixtures/visual/`; son entradas de
prueba, no resultados de la última ejecución. Regenerarlas exige revisar la diferencia.

Los recorridos de navegador se ejecutan en local, no en CI: los runners compartidos sin GPU
renderizan tan pocos cuadros por segundo que las comprobaciones de tiempo real fallan sin que
haya un error en el juego. El CI ejecuta la suite Node en Node 22 y 24, las simulaciones,
`npm audit`, el escaneo de secretos y la construcción de la imagen Docker. Antes de publicar una
versión, ejecuta `npm run test:release` en tu máquina.

## Secretos

El job `secrets` descarga todo el historial y ejecuta Gitleaks 8.30.1 con valores redactados,
sin comentar en pull requests ni requerir una cuenta del proveedor. Con Gitleaks instalado:

```sh
npm run check:secrets
```

El escaneo del historial no incluye cambios sin commit: guarda la revisión final antes de
usarlo como comprobación de publicación. Un job configurado no equivale a un resultado
aprobado; deben revisarse sus resultados en la revisión que se publicará.

## Revisión antes de anunciar una versión estable

- Completar partidas y revancha con personas en los tres mapas.
- Probar iOS/Safari y Android/Chrome físicos: dos pulgares, giro, notch, app instalada,
  teclado, cancelar carga, suspensión de audio y regreso desde otra aplicación.
- Cortar y recuperar la conexión antes y después de 120 segundos.
- Medir rendimiento térmico y cuadros largos durante 15–30 minutos en teléfonos.
- Comprobar HTTPS/WSS y enlaces compartidos desde otra red.
- Confirmar los jobs Node, secretos y contenedor de CI, y ejecutar `npm run test:release` en local.
