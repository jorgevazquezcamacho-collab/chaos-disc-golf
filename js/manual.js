// =====================================================================
// CHAOS DISC GOLF — Manual rápido para jugadores nuevos
// =====================================================================

const DISC_NUMBERS = [
  {
    label: "Velocidad", example: "7", range: "1 a 14", color: "var(--lime)",
    desc: "Qué tan rápido debes tirar el disco para que vuele como está diseñado. Más alto = más distancia potencial, pero más difícil de controlar. Un principiante debería empezar con velocidad baja (1–5).",
  },
  {
    label: "Planeo", example: "5", range: "1 a 7", color: "var(--cyan)",
    desc: "Cuánto \"flota\" el disco en el aire durante el vuelo. Más alto = vuelos más largos y suaves, pero más sensible al viento.",
  },
  {
    label: "Giro", example: "-1", range: "+1 a -5", color: "var(--amber)",
    desc: "Qué tanto se va hacia la derecha a media velocidad (diestro backhand). Mientras más negativo, más \"understable\" es el disco — gira más fácil.",
  },
  {
    label: "Caída", example: "1", range: "0 a 5", color: "var(--magenta)",
    desc: "Qué tanto se va hacia la izquierda al final del vuelo, cuando pierde velocidad. Mientras más alto, más \"overstable\" — termina con más fuerza a la izquierda.",
  },
];

const DISC_TYPES = [
  {
    name: "Putter", speed: "1–3", color: "var(--lime)",
    desc: "El más lento y controlado. Para putts y approaches cortos (menos de 40m). Poco vuelo, casi no se curva.",
  },
  {
    name: "Midrange", speed: "3–5", color: "var(--cyan)",
    desc: "Vuelo predecible a distancia media (40–80m). El disco más fácil de controlar — el mejor para aprender a leer vuelos.",
  },
  {
    name: "Fairway Driver", speed: "5–9", color: "var(--amber)",
    desc: "Más distancia que el midrange, todavía con buen control. Bueno para tiros con curva controlada entre árboles.",
  },
  {
    name: "Driver", speed: "9–14", color: "var(--magenta)",
    desc: "Máxima distancia, pero requiere más potencia y técnica para controlar. El más difícil de dominar para un principiante.",
  },
];

// ---------------------------------------------------------------------
// Diagrama Hyzer / Anhyzer (vista desde arriba, lanzamiento backhand diestro)
// ---------------------------------------------------------------------
function hyzerAnhyzerSVG(){
  return `
  <svg viewBox="0 0 300 220" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block;">
    <defs>
      <marker id="hzArrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="var(--cyan)"/>
      </marker>
      <marker id="ahArrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="var(--amber)"/>
      </marker>
    </defs>
    <!-- punto de lanzamiento -->
    <circle cx="150" cy="200" r="5" fill="var(--text)"/>
    <text x="150" y="216" text-anchor="middle" fill="var(--text-dim)" font-family="Space Mono, monospace" font-size="10">TÚ (diestro, backhand)</text>

    <!-- Hyzer: curva hacia la izquierda -->
    <path d="M150,196 C100,150 70,100 55,55" fill="none" stroke="var(--cyan)" stroke-width="3" marker-end="url(#hzArrow)"/>
    <text x="45" y="45" text-anchor="middle" fill="var(--cyan)" font-family="Space Mono, monospace" font-weight="700" font-size="13">HYZER</text>

    <!-- Anhyzer: curva hacia la derecha -->
    <path d="M150,196 C200,150 230,100 245,55" fill="none" stroke="var(--amber)" stroke-width="3" marker-end="url(#ahArrow)"/>
    <text x="255" y="45" text-anchor="middle" fill="var(--amber)" font-family="Space Mono, monospace" font-weight="700" font-size="13">ANHYZER</text>

    <!-- linea recta de referencia -->
    <line x1="150" y1="196" x2="150" y2="55" stroke="var(--line)" stroke-width="2" stroke-dasharray="4 4"/>
    <text x="150" y="45" text-anchor="middle" fill="var(--text-dim)" font-family="Space Mono, monospace" font-size="10">recto</text>
  </svg>`;
}

// ---------------------------------------------------------------------
// Diagrama de Estabilidad (perfil de vuelo típico)
// ---------------------------------------------------------------------
function stabilitySVG(){
  return `
  <svg viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block;">
    <defs>
      <marker id="usArrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="var(--lime)"/></marker>
      <marker id="stArrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="var(--cyan)"/></marker>
      <marker id="osArrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="var(--magenta)"/></marker>
    </defs>
    <!-- punto de lanzamiento -->
    <circle cx="20" cy="180" r="5" fill="var(--text)"/>

    <!-- Understable: gira hacia la derecha al final (turn) -->
    <path d="M20,178 C120,170 180,150 270,80" fill="none" stroke="var(--lime)" stroke-width="3" marker-end="url(#usArrow)"/>

    <!-- Stable: casi recto, fade leve al final -->
    <path d="M20,175 C120,140 180,110 230,50" fill="none" stroke="var(--cyan)" stroke-width="3" marker-end="url(#stArrow)"/>

    <!-- Overstable: se va fuerte a la izquierda (fade) -->
    <path d="M20,172 C90,130 110,90 90,40" fill="none" stroke="var(--magenta)" stroke-width="3" marker-end="url(#osArrow)"/>

    <text x="270" y="70" text-anchor="middle" fill="var(--lime)" font-family="Space Mono, monospace" font-weight="700" font-size="11">Understable</text>
    <text x="235" y="42" text-anchor="middle" fill="var(--cyan)" font-family="Space Mono, monospace" font-weight="700" font-size="11">Stable</text>
    <text x="90" y="30" text-anchor="middle" fill="var(--magenta)" font-family="Space Mono, monospace" font-weight="700" font-size="11">Overstable</text>
  </svg>`;
}
