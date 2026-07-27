// =====================================================================
// CHAOS DISC GOLF — Historial de rondas (local, este celular)
// =====================================================================
// Cada ronda completa (18 hoyos) se guarda como un resumen. Con eso
// se puede: (1) mostrar un historial de partidas, y (2) calcular
// handicaps automáticos según el promedio real de cada jugador, en
// vez de la tabla fija.
// =====================================================================

const HISTORY_KEY = "chaosDiscGolfHistory_v1";
const HISTORY_MAX_ROUNDS = 50;

function loadHistory(){
  try{
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch(e){ return []; }
}

function saveRoundToHistory(entry){
  try{
    const history = loadHistory();
    history.unshift(entry); // más reciente primero
    if(history.length > HISTORY_MAX_ROUNDS) history.length = HISTORY_MAX_ROUNDS;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }catch(e){ /* si falla, simplemente no se guarda esta ronda */ }
}

// Promedio de score bruto por nombre de jugador, a partir del historial completo.
function getPlayerAverages(){
  const history = loadHistory();
  const sums = {}; // {nombre_lowercase: {sum, count, displayName}}
  history.forEach(round=>{
    round.players.forEach(p=>{
      const key = p.name.trim().toLowerCase();
      if(!key) return;
      if(!sums[key]) sums[key] = {sum:0, count:0, displayName:p.name};
      sums[key].sum += p.total;
      sums[key].count += 1;
    });
  });
  const averages = {};
  Object.keys(sums).forEach(key=>{
    averages[key] = sums[key].sum / sums[key].count;
  });
  return averages;
}

// Calcula handicaps automáticos para un set de nombres, usando el historial
// cuando hay suficientes datos, y la tabla fija (chaoscup.js) como respaldo
// para jugadores nuevos sin historial.
function computeAutoHandicaps(playerNames){
  const averages = getPlayerAverages();
  const withHistory = playerNames
    .map(name=>({name, key:name.trim().toLowerCase()}))
    .filter(p=>averages[p.key] !== undefined);

  const result = {};

  if(withHistory.length >= 2){
    const bestAvg = Math.min(...withHistory.map(p=>averages[p.key]));
    withHistory.forEach(p=>{
      const hcp = Math.round((averages[p.key] - bestAvg) * 0.8);
      result[p.name] = hcp;
    });
  }

  playerNames.forEach(name=>{
    if(result[name] === undefined){
      const fallback = lookupChaosCupHandicap(name);
      result[name] = fallback !== null ? fallback : 0;
    }
  });

  return result;
}
