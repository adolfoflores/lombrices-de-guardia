# Decisiones de juego y arquitectura

## Alcance

Versión privada para grupos de amigos. No incluye bots, entrenamiento, campaña, cuentas, emparejamiento público, ranking, progresión, compras, editor, generación procedural ni repeticiones completas de la partida: solo se repite el golpe final en el cliente, con los últimos estados recibidos. Los scripts de prueba pueden producir entradas automáticamente; no son oponentes disponibles en el producto.

## Autoridad y transporte

Una instancia Node posee todas las salas. Las intenciones llegan por WebSocket, se validan contra identidad, turno, fase, munición y destino y se ejecutan una vez. El servidor calcula posiciones, colisiones, daños, viento, reloj, terreno y resultado en pasos de 1/60 s. No acepta posiciones o daños calculados por el cliente.

Los clientes reciben estados a 15 Hz; Canvas interpola únicamente la presentación. Los relojes y física no dependen de FPS. El terreno es una máscara de 1600×900 celdas. La geometría inicial está diseñada con polígonos/plataformas/túneles; explosiones borran círculos y vigas añaden rectángulos. El dibujo usa el mismo alfa de la máscara que la colisión. Se transmite RLE completo cuando cambia su revisión y al reconectar; los demás mensajes omiten terreno. No se simulan derrumbes de fragmentos aislados.

Cada operación lleva ID y, salvo la entrada inicial, una secuencia creciente por identidad. El servidor conserva como máximo 240 confirmaciones de comandos y 16 de movimiento. La última secuencia aceptada impide repetir comandos antiguos incluso después de desalojar su confirmación o reconectar. Renovar movimiento no elimina la protección de un disparo anterior. El token de reconexión es aleatorio, se entrega solo a su conexión y nunca se publica en la sala ni en enlaces. Una reconexión reemplaza la conexión anterior de esa identidad.

La simulación acumulada limita recuperación de una pausa a 250 ms por llamada para evitar un bucle de sobrecarga. En una suspensión del proceso anfitrión el juego puede retrasarse respecto del tiempo real; no hay un servicio distribuido de reloj. La ausencia de un cliente no detiene el reloj del servidor.

## Turnos y final

Por defecto: 2 gusanos por persona, 100 PV, turnos de 30 s y retirada de hasta 3 s. Quien organiza elige 30, 45 o 60 s por turno antes de iniciar; el servidor valida la opción y la aplica a todos, incluidas reconexiones y revancha. La sala aplica 2, 3 o 4 gusanos a todo el grupo. La rotación conserva un cursor de gusano por jugador. En equipo se alterna primero alianza, luego sus integrantes y después sus gusanos; se omiten los eliminados.

El ataque consume la acción. La escopeta bloquea el resto de armas tras su primer disparo y permite exactamente un segundo disparo. Cuerda y jetpack son movilidad previa al ataque. El teletransporte y la viga sí consumen la acción; conservan los 3 s de retirada. Pasar termina la fase de acción. La fase de resolución espera proyectiles, minas en movimiento/armándose/activadas, caídas, empujes y explosiones de muerte. Una mina asentada y armada pero no activada no impide comenzar otro turno.

El fuego amigo está activo. Caer al agua elimina inmediatamente sin explosión de cadáver; una muerte por daño provoca una pequeña explosión diferida de 15 de daño/radio 32, que puede producir cadenas. Un empate se declara si todas las alianzas quedan eliminadas cuando terminan los efectos pendientes. Los miembros eliminados de una alianza ganadora se incluyen en la victoria de su equipo.

### Resumen final y jugador de la partida

El motor atribuye cada daño al ataque que lo causó. Un ataque es cada uso de un arma con daño (los dos disparos de escopeta son dos ataques); cuerda, jetpack, teletransporte y viga no cuentan como disparos. El proyectil, la bomba, la mina o el bate llevan a quien lo usó; los fragmentos, las minas que estallan en cadena, la dinamita detonada por otra explosión y la explosión de un cadáver heredan el ataque que los provocó. Un gusano que cae al agua o muere por una caída dentro del mismo turno en que fue golpeado es baja de quien lo golpeó; ese crédito caduca al cambiar de turno. Las caídas sin golpe previo, el agua de la muerte súbita y los abandonos no se atribuyen a nadie.

El daño a gusanos propios o aliados (en todos contra todos, los propios) se registra como fuego amigo y las bajas aliadas se cuentan aparte; ninguno suma al daño hecho ni al mejor tiro. El daño recibido incluye todas las fuentes, también las caídas. El mejor tiro es el mayor daño a rivales causado por un solo ataque, sumando todos los gusanos que alcanza y sus cadenas. El tiro más largo mide la distancia, desde quien dispara hasta el punto de impacto, de una bazuca, granada o fragmentación que alcanzó a un rival; el cliente la muestra en metros (10 píxeles del mundo por metro). El jugador de la partida es quien más daño hizo a rivales, con las bajas como desempate y el orden del grupo como último criterio; si nadie dañó a un rival, no hay jugador destacado. Las estadísticas viajan solo con el estado final y dentro de `result`; los estados en directo no cambian de tamaño.

A los 600 s sube el agua 1,8 unidades por segundo desde y=820, hasta y=30. Esto evita partidas inmóviles indefinidas. 10–15 minutos es un objetivo de ritmo, sujeto al terreno, cantidad de gusanos, puntería y agresividad del grupo. Las pruebas aceleradas no sustituyen sesiones de balance con personas.

## Balance inicial

Valores ejecutables: `shared/config.js`. Daño de explosión decrece con distancia; la tabla da el máximo, sin sumar daño posterior por caída. ∞ significa disponibilidad ilimitada.

| Arma/herramienta | Munición por jugador | Comportamiento inicial                                                                                              |
| ---------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Bazuca           | ∞                    | 52 daño, radio 58; potencia, gravedad y viento                                                                      |
| Granada          | ∞                    | 56 daño, radio 64; 3 s, rebote, sin viento                                                                          |
| Fragmentación    | 3                    | 22 daño/radio 33 + 5 fragmentos de 24/radio 38; 3 s                                                                 |
| Escopeta         | ∞                    | 24 por impacto; 2 disparos; alcance 480; pequeño agujero en terreno                                                 |
| Dinamita         | 2                    | 78 daño, radio 90; colocación, 4 s                                                                                  |
| Mina             | 3                    | 48 daño, radio 65; armado 1,4 s, proximidad 40, fusible 0,8 s                                                       |
| Bate             | ∞                    | 26 daño; alcance 62; empuje direccional 450                                                                         |
| Ataque aéreo     | 1                    | 5 bombas de 34 daño/radio 47; deshabilitado en caverna                                                              |
| Cuerda ninja     | ∞                    | Enganche entre 34–440, balanceo con inercia, carrete gradual hasta 92 unidades/s                                    |
| Jetpack          | 2                    | 6 s de combustible por uso; vuelo analógico hasta 190 unidades/s, frenado progresivo al centrar; consume al activar |
| Teletransporte   | 2                    | Hasta 740 de distancia, destino libre apoyado cerca del suelo                                                       |
| Viga             | 3                    | Rectángulo 112×16; alcance 280; espacio sin terreno/gusanos/objetos                                                 |

Gravedad: 490 unidades/s². Desplazamiento a 94 unidades/s. Salto normal a 225 y hacia atrás a 285 unidades/s verticales. Caídas por encima de 255 unidades/s infligen daño proporcional. Viento por turno entre −45 y +45, compartido por todos. Los proyectiles usan subpasos para reducir atravesamientos en alta velocidad.

## Inicio equilibrado

Los apoyos candidatos se recorren cada 4 px en las tres geometrías fijas y se filtran: a 120 px o más de los bordes laterales, con al menos 24 px de suelo continuo bajo los pies (el puente de 24 px de las lomas cuenta; una repisa más fina, no) y sin pendiente: la altura del terreno a 14 px a izquierda y derecha no puede diferir en más de 10 px entre sí ni respecto al apoyo. La selección usa el generador sembrado de la partida: por cada gusano se sortean hasta 200 apoyos hasta encontrar uno a 90 px o más de los ya ocupados; si el mapa está saturado se elige el apoyo con el mayor hueco libre, nunca por debajo de 20 px, de forma determinista para la misma semilla. Con las tres geometrías esto solo ocurre con plantillas grandes (por ejemplo 24 gusanos en el archipiélago).

En las modalidades por equipos cada alianza recibe una franja vertical propia (mitades con dos equipos, tercios con tres), con los lados sorteados en cada partida; dentro de la franja sus integrantes se intercalan de izquierda a derecha. En todos contra todos se sortea sobre el mapa completo y los jugadores se intercalan a lo largo de él para que nadie reciba una isla entera. Las pruebas cubren las 45 combinaciones de mapa, 2–6 participantes y 2–4 gusanos sin superposiciones ni pérdida inicial de salud, además de distancia a bordes, pendiente, espesor, separación por franjas y la relajación. No implica simetría exacta; plataformas y accesos siguen siendo parte de la estrategia.

## Cajas de suministros

Al comenzar cada tercer turno (3, 6, 9…) el servidor deja caer una caja de 16×16 sobre un apoyo del mismo conjunto filtrado del inicio, elegido con el generador sembrado y descartando columnas a menos de 32 px de cualquier gusano vivo. La caja aparece en el cielo o, si hay techo encima del apoyo (el techo de la gruta, una repisa, el puente), justo debajo de él, y desciende en paracaídas a 55 px/s constantes, sin viento. Al tocar terreno se posa; si una explosión le quita el suelo cae con gravedad hasta apoyarse de nuevo. El agua la traga. Una caja nunca cuenta como efecto pendiente: no retrasa el final del turno.

Solo el gusano en turno la recoge, al solaparse con ella (radio del gusano más medio lado: 18 px). El contenido se decide al recoger con el generador sembrado, entre las opciones útiles para ese jugador: salud (+25 PV, hasta 100, peso 3) si el gusano está herido, y una unidad de cada arma limitada por debajo de su dotación inicial (fragmentación, dinamita, mina, ataque aéreo fuera de la gruta, jetpack, teletransporte, viga; peso 1 cada una). Con todo completo se abre igualmente como botiquín sin efecto. Cualquier explosión cuyo radio alcance la caja la destruye: deja una marca de radio 12 sin daño ni empuje. Los eventos `crateDrop`, `crateLand`, `cratePickup` (con texto `+25 salud` o `+1 dinamita`) y `crateDestroyed` alimentan presentación, aviso y audio; el aviso de recogida solo lo ve quien la recoge. Valores en `shared/config.js` (`crateInterval`, `crateSize`, `cratePickupRadius`, `crateFallSpeed`, `crateHealth`, `crateBlastRadius`, `CRATE_CONTENTS`).

## Interacción y presentación

Izquierda y derecha giran al gusano y su arma juntos, conservando la inclinación vertical del tiro. Al soltar el movimiento se mantiene el lado elegido. En computadora, la barra de apuntado permite escoger el otro lado en reposo; cerca de la vertical se conserva la orientación para evitar giros por pequeñas variaciones. Las teclas ↑/↓ elevan o bajan el tiro en ambos sentidos; con una cuerda o un jetpack activos y seleccionados controlan su movimiento vertical. W/S siguen disponibles para las herramientas incluso al seleccionar un arma. El salto normal sale hacia el lado elegido y el salto hacia atrás hacia el contrario, sin depender del instante de actualización de la física.

En móvil horizontal, las dos palancas circulares y las acciones flotan sobre el campo con fondos semitransparentes. El campo recupera la altura de la antigua botonera; la cámara coloca al gusano por encima de los controles. El modo zurdo intercambia los extremos. La palanca izquierda responde sólo al desplazamiento horizontal para caminar o balancearse; la derecha responde sólo al vertical para apuntar. Ambas tienen fuerza proporcional y capturan su dedo de forma independiente: se pueden combinar o soltar por separado; al centrar mantiene la inclinación. Cuando la herramienta activa está seleccionada, arriba/abajo acorta/alarga cuerda o sube/baja con jetpack. Seleccionar un arma devuelve el eje vertical al apuntado, con empuje vertical y carrete neutrales; volver a la herramienta recupera sus controles. Se puede seleccionar el jetpack activo aunque no queden cargas. Centrar el vuelo frena gradualmente y deja un descenso lento; soltar cuerda o apagar el motor conserva la velocidad y devuelve la gravedad. El carrete acelera y se detiene progresivamente, con corrección barrida contra obstáculos. Pointer capture mantiene cada dedo en su propio control; cancelación, pérdida de foco, orientación y pestaña oculta limpian movimiento y carga. Sin una liberación válida no se dispara. Tocar el escenario selecciona un destino o desplaza la cámara, nunca dispara por sí mismo.

No se dibuja la trayectoria de impacto ni el valor numérico del ángulo. En móvil desaparece la barra de apuntado y queda el selector compacto de arma. La guía corta comunica dirección y sólo muestra potencia mientras se carga. Un anillo de 13 segmentos integrado en Disparar muestra la carga, cambia de oro a coral cerca del máximo y confirma brevemente un disparo aceptado; permanece oculto en reposo y con herramientas instantáneas. Hay controles separados de cámara y un marcador de destino con validación preliminar; la validación final siempre es del servidor. La vista general y el seguimiento ayudan a explorar un mapa mayor que la pantalla.

Cada alianza tiene símbolo además del color; nombres/HP prioritarios evitan saturación. Los efectos y mensajes comunican lo necesario en silencio. Calidad ligera reduce partículas/decoración; reducción de movimiento limita sacudidas. Música y efectos tienen volumen independiente. El motor de audio solo se activa tras interacción y puede recuperarse tras una interrupción.

Repetición del golpe final: el cliente conserva los estados recibidos durante los últimos cinco segundos de juego. Cuando una partida termina en directo con un impacto dentro de esa ventana, vuelve a reproducir los últimos cuatro segundos (dos con reducción de sacudidas) por la misma ruta de interpolación, a velocidad real, con una etiqueta REPETICIÓN dibujada en el campo y un botón Saltar. Los efectos y sonidos de esos estados se repiten, la cámara sigue la acción y el espectador ve las poses grabadas sin su guía de apuntado ni su identidad local; los estados en directo que lleguen mientras tanto esperan. Al terminar o saltar se restaura el estado final sin repetir sus efectos y se abre el resumen. Reconectar en una partida terminada, una revancha o un final sin golpe (abandonos) abren el resumen directamente. No hay repetición completa ni almacenamiento en el servidor.

## Persistencia y despliegue

Las salas se mantienen en memoria, no en disco. Un solo proceso simplifica autoridad, orden y reconexión sin base de datos. El despliegue preparado exige proxy HTTPS/WSS y una sola réplica. Actualizaciones y reinicios pierden las salas existentes; se documenta como límite de esta primera versión. No se publicó nada durante el desarrollo.
