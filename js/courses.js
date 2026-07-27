// =====================================================================
// CHAOS DISC GOLF — Datos de campos guardados
// =====================================================================
// Cada campo define, por hoyo: par, distancia, nota de OB (fuera de
// límites) y de qué lado está (para dibujar el diagrama). El diagrama
// se genera como SVG en tiempo real — no depende de imágenes.
// =====================================================================

const COURSE_PRESETS = {
  los_colomos: {
    name: "Los Colomos",
    safetyNote: "Antes de tirar, revisa que no haya peatones en los caminos o gente de picnic en el fairway.",
    holes: {
      1:  {par:3, distance:61,  ob:"Calle empedrada.", obSide:null},
      2:  {par:4, distance:99,  ob:"Camino empedrado de la izquierda, estacionamiento e isla del hoyo 17.", obSide:"left"},
      3:  {par:3, distance:56,  ob:"Pasto de la derecha rodeado por camino de piedra.", obSide:"right"},
      4:  {par:3, distance:75,  ob:"Sin OB.", obSide:null},
      5:  {par:3, distance:91,  ob:"Fuera del parque, camino de concreto y más allá.", obSide:null},
      6:  {par:3, distance:70,  ob:"Fuera del parque y pasando el camino detrás de la canasta.", obSide:"behind"},
      7:  {par:3, distance:82,  ob:"Fuera del parque.", obSide:null},
      8:  {par:3, distance:61,  ob:"Caminos de concreto y más allá.", obSide:null},
      9:  {par:3, distance:106, ob:"Caminos de concreto y más allá.", obSide:null},
      10: {par:3, distance:62,  ob:"Camino y más allá.", obSide:null},
      11: {par:3, distance:59,  ob:"Caminos de concreto y más allá.", obSide:null},
      12: {par:3, distance:64,  ob:"Sin OB.", obSide:null},
      13: {par:4, distance:121, ob:"Sin OB.", obSide:null, special:"Doble Mando marcado. Si fallas cualquier Mando, procede al DZ."},
      14: {par:3, distance:75,  ob:"Camino y más allá.", obSide:null},
      15: {par:3, distance:61,  ob:"Camino y más allá.", obSide:null},
      16: {par:3, distance:68,  ob:"Green del Hoyo 18 y camino empedrado.", obSide:null},
      17: {par:3, distance:90,  ob:"Sin OB tradicional.", obSide:null, special:"Isla delimitada por piedras y árboles. Si fallas la isla en el primer tiro, procede al DZ. En tiros siguientes aplican las reglas normales de OB."},
      18: {par:3, distance:99,  ob:"Camino, más allá, y fairway del Hoyo 16.", obSide:null},
    },
  },
};

function applyCoursePreset(state, presetKey){
  const preset = COURSE_PRESETS[presetKey];
  if(!preset) return;
  Object.keys(preset.holes).forEach(holeStr=>{
    const h = +holeStr;
    state.pars[h] = preset.holes[h].par;
  });
  state.courseInfo = {key: presetKey, name: preset.name, safetyNote: preset.safetyNote, holes: preset.holes};
}

// ---------------------------------------------------------------------
// Diagrama ilustrado del hoyo (SVG generado, sin depender de imágenes)
// ---------------------------------------------------------------------
function holeDiagramSVG(holeNum, info){
  const isNoOB = !info.obSide && (!info.ob || /sin ob/i.test(info.ob));
  let obPatch = "";
  if(info.obSide === "left"){
    obPatch = `<path d="M0,50 L68,50 L38,392 L0,392 Z" fill="url(#obHatch)" opacity="0.6"/>`;
  } else if(info.obSide === "right"){
    obPatch = `<path d="M280,50 L212,50 L242,392 L280,392 Z" fill="url(#obHatch)" opacity="0.6"/>`;
  } else if(info.obSide === "behind"){
    obPatch = `<rect x="66" y="16" width="148" height="46" fill="url(#obHatch)" opacity="0.6"/>`;
  }

  return `
  <svg viewBox="0 0 280 420" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block;">
    <defs>
      <pattern id="obHatch" width="10" height="10" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <rect width="10" height="10" fill="var(--red)" opacity="0.18"/>
        <line x1="0" y1="0" x2="0" y2="10" stroke="var(--red)" stroke-width="4"/>
      </pattern>
      <marker id="arrowHead" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="var(--lime)"/>
      </marker>
    </defs>

    <!-- fairway -->
    <path d="M90,392 Q60,220 105,90 Q140,40 175,90 Q220,220 190,392 Z"
          fill="var(--bg-panel-2)" stroke="var(--line)" stroke-width="2"/>

    <!-- arboles decorativos -->
    ${[[30,70],[250,80],[20,180],[260,190],[35,300],[245,290],[15,360],[255,350],[140,30]]
      .map(([x,y])=>`<circle cx="${x}" cy="${y}" r="16" fill="var(--bg-panel)" stroke="var(--line)"/>`).join("")}

    ${obPatch}

    <!-- trayecto punteado -->
    <line x1="140" y1="370" x2="140" y2="75" stroke="var(--lime)" stroke-width="3"
          stroke-dasharray="10 8" marker-end="url(#arrowHead)"/>

    <!-- tee -->
    <rect x="120" y="372" width="40" height="14" rx="3" fill="var(--text-dim)"/>
    <text x="140" y="404" text-anchor="middle" fill="var(--text-dim)" font-family="Space Mono, monospace" font-size="11">TEE</text>

    <!-- canasta -->
    <line x1="140" y1="60" x2="140" y2="76" stroke="var(--text-dim)" stroke-width="2"/>
    <path d="M118,58 Q140,44 162,58" stroke="var(--cyan)" stroke-width="2" fill="none" opacity="0.85"/>
    <path d="M122,54 Q140,42 158,54" stroke="var(--cyan)" stroke-width="1.6" fill="none" opacity="0.7"/>
    <ellipse cx="140" cy="60" rx="22" ry="7" fill="none" stroke="var(--text)" stroke-width="2.5"/>
    <ellipse cx="132" cy="34" rx="16" ry="6" fill="var(--lime)" transform="rotate(-8 132 34)"/>

    <!-- OB label si aplica -->
    ${!isNoOB ? `<text x="140" y="418" text-anchor="middle" fill="var(--red)" font-family="Space Mono, monospace" font-size="11" font-weight="700">⚠ ZONA OB</text>` : ""}
  </svg>`;
}

