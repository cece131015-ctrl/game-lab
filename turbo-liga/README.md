# Turbo Liga 3D

Fútbol con coches en 3D al estilo Rocket League, para el navegador. Incluye bots con IA, salas online para jugar con amigos y chat de voz con el micrófono abierto.

![Turbo Liga](https://img.shields.io/badge/three.js-r186-blue) ![Node](https://img.shields.io/badge/node-%E2%89%A518-green)

## Qué incluye

- **Física de Rocket League**: los valores salen de [RocketSim](https://github.com/ZealanL/RocketSim) (licencia MIT) y de la wiki de RLBot. Se simula a 120 Hz, igual que el juego original.
  - Coche: 2300 uu/s de velocidad máxima, 1410 uu/s sin turbo, supersónico a partir de 2200, turbo de 991,7 uu/s² en el suelo y 1058 en el aire, 33,3 de turbo por segundo.
  - Saltos: impulso de 291,7 uu/s y 0,2 s de salto mantenido. El doble salto y el flip se pueden hacer hasta 1,25 s después de saltar. Los flips usan los mismos impulsos (500 uu/s) y pares de giro (260/224), con cancelación de flip y *stall*.
  - Control aéreo con los pares y amortiguaciones originales (pitch 130, yaw 95, roll 400), giro aéreo libre y direccional.
  - Conducción por paredes y techo con fuerza de adherencia, derrape analógico (*powerslide*), curvas de ángulo de giro según la velocidad, autovuelta cuando el coche queda boca abajo.
  - Balón de radio 91,25, rebote 0,6, efecto con el modelo de rebote de Chip y el "impulso extra" del golpe coche-balón de RL.
  - Choques entre coches y **demoliciones** a velocidad supersónica.
  - 34 pads de turbo (6 grandes de 100 y 28 pequeños de 12) en sus posiciones reales.
- **Coches**: Octane, Dominus, Batmobile, Breakout, Venom y Merc, con sus hitbox, ruedas y suspensión reales. Los modelos 3D se generan por código: no se usa ningún recurso del juego original.
- **Estadio** con las medidas oficiales (8192 × 10240 × 2044 uu), porterías de 1786 × 643 uu, curvas entre el suelo y las paredes, gradas, focos y red.
- **Bots** en tres niveles (Principiante, Pro y Leyenda). Predicen la trayectoria del balón, buscan el punto de intercepción, apuntan a la portería, rotan en equipo (atacante, apoyo y portero), hacen el saque con flip, esquivan para dar potencia, recogen turbo y, en nivel Leyenda, juegan por alto.
- **Modos**: 1 contra 1, 2 contra 2 y 3 contra 3 contra bots, entrenamiento libre (turbo infinito, `R` recoloca el balón y `F` recoloca el coche) y salas online.
- **Salas online** con código de 6 caracteres y enlace para invitar. El anfitrión elige el modo, la duración y si se rellenan los huecos con bots. Si alguien entra con el partido empezado, toma el control de un bot; si alguien se va, su coche pasa a ser un bot.
- **Chat de voz** en la sala y durante el partido: micrófono abierto por defecto, `M` para silenciarlo y modo "pulsar para hablar" con la tecla `V`. Muestra quién está hablando. También hay chat de texto (tecla `T`).
- **Partido**: 5 minutos (el reloj se pone en marcha con el primer toque del saque), cuenta atrás de 3 segundos, celebración de gol con explosión y prórroga a gol de oro. Se cuentan goles, asistencias, paradas, tiros, demoliciones y puntos (tabla con `Tab`).
- **Cámara** como la de RL: campo de visión de 110°, distancia 270, altura 110 y cámara de balón (`C`).
- **Controles** de teclado y ratón, mando (Xbox/PlayStation con la distribución estándar) y controles táctiles en el móvil.

## Cómo jugar en tu ordenador

Necesitas [Node.js](https://nodejs.org) 18 o superior.

```bash
cd turbo-liga
npm install
npm run build      # genera dist/
npm start          # servidor de juego + salas en http://localhost:8080
```

Para desarrollar con recarga automática: `npm run dev` y abre http://localhost:5173.

Para pasar los tests: `npm test`.

## Jugar con amigos (salas y micrófono)

1. Uno pulsa **Online con amigos → Crear sala** y comparte el código o el enlace (botón *Copiar enlace*).
2. Los demás pulsan **Unirse** con el código, o abren el enlace directamente.
3. El navegador pide permiso para el micrófono: acéptalo para hablar. Si no lo das, podrás escuchar a los demás igualmente.
4. El anfitrión pulsa **Empezar partido**.

> **Importante para el micrófono:** los navegadores solo dejan usar el micrófono en `https://` o en `localhost`. Si tus amigos entran por `http://TU-IP:8080` verán el juego, pero el micrófono no funcionará. Para jugar con voz por internet, usa una de estas opciones (todas dan HTTPS):

### Opción A: desplegar gratis en Render (recomendado)

El repositorio incluye `render.yaml`. En [render.com](https://render.com) crea un **Blueprint** apuntando a este repositorio y se despliega solo. También puedes crear un *Web Service* a mano con estos datos:

- Root directory: `turbo-liga`
- Build command: `npm install && npm run build`
- Start command: `npm start`

Funciona igual en Railway, Fly.io, Koyeb o cualquier servicio que ejecute Node con WebSockets.

### Opción B: túnel desde tu ordenador

Con el servidor arrancado (`npm start`):

```bash
npx cloudflared tunnel --url http://localhost:8080
```

Comparte la URL `https://…trycloudflare.com` que aparece.

### Voz detrás de redes estrictas (TURN)

La voz va de navegador a navegador (WebRTC) usando los STUN públicos de Google. En algunas redes (móviles, empresas) hace falta un servidor TURN. Puedes configurarlo con variables de entorno:

```bash
TURN_URL="turn:tu-servidor:3478" TURN_USER="usuario" TURN_PASS="clave" npm start
```

### Juego estático con servidor aparte

El cliente funciona en cualquier hosting estático (por ejemplo GitHub Pages) para jugar contra bots. Para las salas, añade `?server=https://tu-servidor` a la URL y apuntará a un servidor de salas desplegado en otro sitio.

## Controles

| Acción | Teclado / ratón | Mando |
|---|---|---|
| Acelerar / frenar | `W` / `S` | RT / LT |
| Girar | `A` `D` | Stick izquierdo |
| Saltar, doble salto, flip | `Espacio` o clic derecho | A |
| Turbo | `Shift` o clic izquierdo | B |
| Derrape / giro aéreo libre | `Ctrl` o `X` | X |
| Giro aéreo izquierda / derecha | `Q` / `E` | LB / RB |
| Cámara de balón | `C` | Y |
| Marcador | `Tab` | View |
| Silenciar micrófono | `M` | |
| Pulsar para hablar | `V` | |
| Chat | `T` | |
| Pausa | `Esc` | Start |

## Cómo está hecho

```
turbo-liga/
├── src/shared/        Física y reglas (las usan el navegador y el servidor)
│   ├── constants.js   Valores de Rocket League (RocketSim, RLBot)
│   ├── arena.js       Estadio como campo de distancias con signo (SDF)
│   ├── car.js         Coche: ruedas, suspensión, motor, saltos, flips, control aéreo, turbo
│   ├── ball.js        Balón y modelo de rebote con efecto
│   ├── world.js       Colisiones coche-balón, coche-coche, demoliciones, pads
│   ├── game.js        Partido: saque, goles, tiempo, prórroga, estadísticas
│   └── bot.js         IA de los bots
├── src/client/        Navegador: three.js, HUD, menús, sonido, red, voz
└── server/            Servidor Node: archivos estáticos, salas, partido autoritativo, señalización WebRTC
```

- **Red**: el servidor simula el partido a 120 Hz y manda el estado 30 veces por segundo. Cada cliente predice su propio coche y el resto del mundo, y cuando llega el estado del servidor vuelve a ese punto y repite sus entradas pendientes (*rollback*, como en RL). Las correcciones se suavizan para que no se noten saltos.
- **Voz**: es una malla WebRTC de solo audio, con cancelación de eco y supresión de ruido. El servidor solo reenvía la señalización.

## Sobre car-soccer.com

Revisé car-soccer.com como referencia. Ese juego no es de código abierto (su código y sus recursos pertenecen a su autor), así que **no se ha copiado nada**. Turbo Liga toma ideas de su diseño: salas con código de 6 caracteres, partidos de 1 contra 1 a 3 contra 3, 5 minutos con prórroga, bots y soporte de mando. Todo el código y los gráficos de este proyecto son originales.

*Juego hecho por fans, sin relación con Psyonix ni Epic Games. "Rocket League" es una marca de sus propietarios.*
