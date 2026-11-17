# Contribuir

Lombrices de guardia usa JavaScript con módulos ES, Node y npm. No requiere cuentas ni credenciales.

1. Usa Node 22.13+ (rama 22) o 24+ y ejecuta `npm ci`.
2. Ejecuta `npm run dev` y abre `http://localhost:3000`.
3. Mantén cada cambio enfocado y agrega una regresión cuando corrijas un fallo.
4. Ejecuta `npm run lint`, `npm run format` y `npm run verify` antes de enviar el cambio.
5. Describe el comportamiento antes/después, las pruebas realizadas y sus límites.

`npm run test:unit` comprueba motor, controles, transporte y salas sin abrir puertos. `npm test`
también comprueba HTTP/WebSocket reales y necesita puertos locales y el cliente compilado.
Consulta [TESTING](docs/TESTING.md) para recorridos de navegador y dispositivos físicos.

La simulación autoritativa vive en `shared/`; el cliente envía intenciones. Las reglas, la
munición y el daño deben validarse en el servidor aunque la interfaz también los limite.
La física compartida permite predecir el movimiento sin duplicar reglas.

Las capturas y reportes de cada ejecución se generan en `docs/evidence/`, que está ignorado.
Las cuatro referencias visuales deliberadas están en `tests/fixtures/visual/`; no las
regeneres para hacer pasar una regresión sin revisar el cambio visual y su causa.

No agregues credenciales, datos personales ni configuraciones locales. Reporta problemas
de seguridad siguiendo [SECURITY](SECURITY.md). Las contribuciones se reciben bajo la
[licencia MIT](LICENSE) del proyecto.
