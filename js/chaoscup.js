// =====================================================================
// CHAOS DISC GOLF — Modo "Chaos Cup" (torneo con handicap, gana el neto)
// =====================================================================
// El handicap se resta al marcador bruto para obtener el neto — el que
// tenga el neto más bajo se lleva la copa. Fórmula usada:
//   Handicap = (Promedio del jugador − Promedio del mejor del grupo) × 0.8
// Los promedios vienen de rangos aproximados de score en campo, dados
// por Jorge; se usó el punto medio de cada rango.
// =====================================================================

const CHAOS_CUP_HANDICAPS = {
  "hugo": 0,
  "jorge": 4,
  "alfonso": 4,
  "yorch": 7,
  "beto": 9,
  "jordi": 12,
  "ivan": 12,
};

function lookupChaosCupHandicap(name){
  const key = (name || "").trim().toLowerCase();
  return CHAOS_CUP_HANDICAPS.hasOwnProperty(key) ? CHAOS_CUP_HANDICAPS[key] : null;
}
