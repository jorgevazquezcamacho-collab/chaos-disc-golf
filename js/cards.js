// =====================================================================
// CHAOS DISC GOLF — Mazo "Skins Chaos"
// =====================================================================
// Modo opcional inspirado en juegos de cartas de disc golf tipo skins:
// cada hoyo se compite por un "skin" (ficha), quien pierde recibe una
// carta, y las cartas se pueden jugar para alterar el hoyo.
//
// kind: 'mechanic' = el sistema aplica el efecto solo.
//       'physical'  = es una instrucción para el grupo, el sistema solo
//                      la anuncia (igual que ya hace con Shuffle de Discos).
// =====================================================================

const CARD_DEFS = {
  mulligan:      {name:"🍀 Mulligan Fantasma", desc:"Repite tu tiro de este hoyo sin penalización.", kind:"physical", needsTarget:false},
  ojo_halcon:    {name:"🎯 Ojo de Halcón",      desc:"Anula el próximo \"Intentar salvarme\" de un rival.", kind:"mechanic", needsTarget:true},
  paso_tortuga:  {name:"🐌 Paso de Tortuga",    desc:"Un rival tira su próximo drive parado, sin salida corriendo.", kind:"physical", needsTarget:true},
  cambio_forzado:{name:"🔄 Cambio Forzado",     desc:"Un rival usa un disco al azar de su propia bolsa en el siguiente hoyo.", kind:"physical", needsTarget:true},
  escudo:        {name:"🛡️ Escudo",            desc:"Te protege del próximo Robo de Identidad o Glitch del Líder que te toque.", kind:"mechanic", needsTarget:false},
  doble_nada:    {name:"🎲 Doble o Nada",       desc:"Si ganas el skin de este hoyo, su valor se duplica.", kind:"mechanic", needsTarget:false},
  mano_contraria:{name:"🥶 Mano Contraria",     desc:"Un rival tira su próximo drive con la mano no dominante.", kind:"physical", needsTarget:true},
  robo_carta:    {name:"🎁 Robo de Carta",      desc:"Le robas 1 carta al azar de la mano de un rival.", kind:"mechanic", needsTarget:true},
  presion:       {name:"🔥 Presión",            desc:"El peor resultado de este hoyo pierde 1 carta al azar de su mano.", kind:"mechanic", needsTarget:false},
  carta_espejo:  {name:"👻 Carta Espejo",       desc:"Copia el efecto de la última carta jugada por cualquier rival.", kind:"mechanic", needsTarget:false},
  veto:          {name:"🚫 Veto",               desc:"Nadie puede jugarte una carta en tu contra este hoyo.", kind:"mechanic", needsTarget:false},
  caos_total:    {name:"🌪️ Caos Total",        desc:"El grupo decide entre todos un castigo o beneficio improvisado para este hoyo.", kind:"physical", needsTarget:false},
};

const CARD_IDS = Object.keys(CARD_DEFS);

// Construye un mazo con N copias de cada carta, barajado.
function buildShuffledDeck(copiesPerCard){
  const deck = [];
  CARD_IDS.forEach(id=>{
    for(let i=0;i<copiesPerCard;i++) deck.push(id);
  });
  for(let i=deck.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [deck[i],deck[j]] = [deck[j],deck[i]];
  }
  return deck;
}
