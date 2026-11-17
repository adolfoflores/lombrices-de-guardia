# Seguridad

Para reportar una vulnerabilidad utiliza **Security → Report a vulnerability** en el
repositorio de GitHub cuando esté habilitado. Si aún no está disponible, abre un issue
que solicite un canal privado, sin publicar detalles de explotación, secretos o datos
de partidas reales.

Incluye la revisión afectada, condiciones necesarias, impacto y una reproducción mínima
sobre tu propia instancia. No pruebes ataques sobre servidores de otras personas.

Se mantiene la revisión más reciente. Antes de publicar una instancia:

- Instala el lockfile con `npm ci` y ejecuta `npm run verify`.
- Usa `npm start` o el Dockerfile de producción, HTTPS y WSS.
- Conserva una sola instancia: reiniciar pierde las salas almacenadas en memoria.
- Revisa [los límites de conexión y proxy](docs/DEPLOYMENT.md).
- Ejecuta `npm audit` con acceso al registro y atiende los avisos aplicables.

Desarrollo exige Vite 7.3.8 o posterior de la rama 7. El servidor rechaza arrancar
desarrollo con una instalación anterior. No expongas un servidor de desarrollo a Internet.
