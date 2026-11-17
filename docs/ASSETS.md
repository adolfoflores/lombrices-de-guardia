# Recursos y licencias

Todo el arte visible se creó para este proyecto: paisajes con Canvas 2D (`client/renderer.js`), personajes articulados y doce armas/herramientas vectoriales en PixiJS (`client/pixi-character.js`, `client/art/`), proyectiles y partículas (`client/pixi-effects.js`), emblema y favicon vectoriales (`public/crest.svg`, `public/favicon.svg`). Los mapas son polígonos, túneles y plataformas diseñados de forma fija en `shared/terrain.js`, sin generación procedural. La máscara de terreno se usa tanto para colisiones como para el alfa del dibujo. Las vigas colocadas conservan un acabado de metal, refuerzos y remaches recortado por esa misma máscara, incluso después de destruirse parcialmente.

Los PNG maestros de los seis paisajes se conservan en `art/source/`, fuera de los archivos servidos. Las texturas de producción son WebP **sin pérdida**, con las dimensiones y píxeles originales: 10.997.002 bytes en total frente a 15.636.786 bytes de los PNG. Se verificó la igualdad de los píxeles RGBA decodificados. Las tres miniaturas del lobby miden 480×320 y suman 66.656 bytes; las tarjetas ya no descargan los fondos completos. La portada y el fondo del lobby reutilizan el WebP del mapa.

Para regenerarlos instala la utilidad oficial `cwebp` de WebP y ejecuta `npm run art:optimize`. Los archivos generados se versionan; compilar o desplegar no requiere cwebp. `tests/assets.test.js` comprueba formato sin pérdida, dimensiones y presupuestos de descarga. La calidad visual automática es la preferencia inicial de usuarios nuevos.

El inventario usa doce PNG transparentes de 320×192 en `public/art/arsenal/`, exportados directamente del arte vectorial original mediante `node scripts/export-arsenal-art.js`. Pesan 102,4 KiB en conjunto y se sirven localmente; no se crea otro renderizador al abrir el panel. El exportador también genera la lámina de revisión `docs/evidence/arsenal-icons.png`. Si una ilustración falla, el nombre, la munición y un símbolo de respaldo mantienen el arma identificable y seleccionable.

Lomas de bronce incorpora dos imágenes originales generadas con la herramienta integrada de generación de imágenes: `public/art/hills-earth.webp` y `public/art/hills-backdrop.webp` (1536×1024). Los prompts y la procedencia están en [ART-PROMPTS.md](ART-PROMPTS.md#lomas-de-bronce). Se sirven localmente, sin API ni servicio de imágenes durante la partida. `client/hills-terrain.js` añade césped, raíces y cortes sombreados dentro de la máscara; `client/hills-background.js` compone tres planos independientes. Si las imágenes no cargan, queda un acabado Canvas original funcional.

La música es una composición original de 64 pasos sintetizada en Web Audio. Los efectos de las doce herramientas, explosiones, agua, saltos y avisos también se sintetizan localmente (`client/audio.js`). No hay grabaciones, fuentes descargadas, CDN de recursos ni contenido de terceros incorporado como arte. La tipografía utiliza fuentes disponibles en el sistema con alternativas genéricas.

Gruta luminosa y Archipiélago coral usan cuatro imágenes originales adicionales, generadas con la misma herramienta integrada: `public/art/cavern-rock.webp`, `public/art/cavern-backdrop.webp`, `public/art/islands-earth.webp` y `public/art/islands-backdrop.webp` (1536×1024 cada una). Los prompts completos están en [ART-PROMPTS.md](ART-PROMPTS.md). Los módulos `client/biome-terrain.js` y `client/biome-background.js` componen sus materiales y tres planos de profundidad. Durante la preparación del combate solo se descargan las imágenes del mapa seleccionado; el selector del lobby muestra miniaturas de los tres mapas; se reutilizan durante la sesión y tienen una alternativa Canvas si no están disponibles.

Dependencias externas instaladas por npm:

| Paquete    | Uso                                                 | Licencia upstream |
| ---------- | --------------------------------------------------- | ----------------- |
| ws         | Servidor y pruebas WebSocket                        | MIT               |
| pixi.js    | Personajes, armas y efectos 2D acelerados por WebGL | MIT               |
| Vite       | Desarrollo y compilación                            | MIT               |
| Playwright | Pruebas de navegador                                | Apache-2.0        |

Las versiones exactas y sus dependencias transitivas quedan fijadas en `package-lock.json`; los archivos LICENSE de cada distribución están en `node_modules/`. Los navegadores empleados para pruebas se distribuyen por separado y no forman parte del juego. El código, la documentación y los recursos originales del proyecto se distribuyen bajo la [licencia MIT](../LICENSE). Las dependencias conservan sus licencias y avisos propios; consulta [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

Referencias consultadas para implementación: documentación oficial de [Vite](https://vite.dev/guide/), [ws](https://github.com/websockets/ws) y [selectores nativos de shadcn/ui](https://ui.shadcn.com/docs/components/base/native-select). No se incorporó React ni código de shadcn; los formularios usan HTML nativo. No hay recursos de Team17 ni de la serie Worms en el proyecto.

La ampliación gráfica usa [Application](https://pixijs.com/8.x/guides/components/application) y [Graphics](https://pixijs.com/8.x/guides/components/scene-objects/graphics) de PixiJS. Las formas originales se conservan en memoria y se animan con transformaciones; no se utilizan sprites de terceros.
