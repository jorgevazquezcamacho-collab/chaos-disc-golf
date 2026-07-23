// =====================================================================
// CHAOS DISC GOLF — Motor de mensajes
// =====================================================================
// FASE 1 (activa ahora): banco de frases locales con tono de comentarista
// caótico. Sin costo, sin internet, funciona sin señal en el campo.
//
// FASE 2 (futuro, no activa): reemplazar la llamada local por IA real.
// Todo el gancho para eso ya está armado al final de este archivo —
// solo hay que montar un backend pequeño (Cloudflare Worker / Vercel
// Function) que guarde la API key de forma segura, apuntar AI_CONFIG.endpoint
// ahí, y poner AI_CONFIG.enabled = true. Nada más en el resto del código
// tiene que cambiar.
// =====================================================================

const MESSAGE_BANKS = {

  swap_single: [
    "{player} clavó el Birdie en solitario. El destino ya eligió a la víctima del intercambio.",
    "Nadie lo vio venir: {player} se vuela el hoyo y ahora tiene poder de decisión.",
    "Birdie en solitario de {player}. En Chaos Disc Golf, el que gana también castiga.",
    "{player} rompió el molde este hoyo. Alguien va a jugar con disco ajeno el siguiente.",
    "Golpe limpio de {player}. El sistema ya está calculando quién paga las consecuencias."
  ],

  swap_tie: [
    "Empate de Birdies. El sistema tira el dado y decide que sea {player} quien mueva ficha.",
    "Dos Birdies, un solo elegido: {player} se lleva el poder del intercambio esta vez.",
    "El azar habló entre los birdistas — {player} queda al mando del Shuffle de Discos.",
    "Empate en la cima, pero el sistema no reparte por igual: le tocó a {player}."
  ],

  robo: [
    "🚨 Los discos se cambiaron y el destino también. {player} y {player2} intercambian su resultado.",
    "Robo de Identidad activado — lo que hizo {player} ahora es de {player2}, y viceversa.",
    "El sistema decidió que este hoyo no cuenta para quien lo jugó. {player} y {player2}, feliz intercambio.",
    "Nadie estaba a salvo. {player} y {player2} se roban el marcador de este hoyo."
  ],

  glitch_lider: [
    "🚨 El líder no se la iba a llevar tan fácil. Glitch del Líder entre {player} y {player2}.",
    "El sistema frena al que iba mejor: {player} y {player2} invierten su resultado del hoyo.",
    "Cuando alguien va muy arriba, Chaos Disc Golf lo baja. {player} y {player2}, intercambien penas.",
    "El mejor tiro del hoyo y el peor acaban de cambiar de dueño: {player} ↔ {player2}."
  ],

  forced_swap_robo: [
    "🚨 Hoyo de cierre sin piedad — {player} tuvo que salvarlo con Birdie, y ahora paga con un combo doble.",
    "El bloque llegó sin Shuffle de Discos y el sistema no perdona: {player} dispara Shuffle + Robo en el mismo hoyo.",
    "Última oportunidad del bloque. {player} metió el Birdie justo a tiempo — y el glitch le cae encima de inmediato."
  ],

  forced_none: [
    "Nadie se atrevió con el Birdie de cierre. Este bloque se queda sin Robo de Identidad — por esta vez.",
    "El hoyo forzado no encontró héroe. Sin combo esta ronda de nueve.",
    "Silencio en el marcador: nadie clavó el Birdie del hoyo forzado. Bloque tranquilo, por fin."
  ],

};

function pick(arr){
  return arr[Math.floor(Math.random() * arr.length)];
}

function fillTemplate(template, ctx){
  return template
    .replace(/\{player\}/g, (ctx && ctx.player) || "")
    .replace(/\{player2\}/g, (ctx && ctx.player2) || "")
    .replace(/\{score\}/g, (ctx && ctx.score !== undefined) ? ctx.score : "");
}

// Punto de entrada usado por app.js. Hoy resuelve local y de forma
// instantánea (sin await). Si en el futuro se activa AI_CONFIG.enabled,
// este es el único lugar que habría que tocar para volverla async.
function getEventMessage(type, ctx){
  const bank = MESSAGE_BANKS[type];
  if(!bank || !bank.length) return "";
  const template = pick(bank);
  return fillTemplate(template, ctx || {});
}

// =====================================================================
// GANCHO PARA IA EN VIVO (Fase 2 — no activo todavía)
// =====================================================================
// Idea: en vez de elegir una frase del banco local, se le pide a un
// modelo de Claude que redacte el mensaje en el momento, con el
// contexto real de la ronda (nombres, marcador acumulado, hoyo, etc.)
// Requiere un backend intermedio (nunca poner la API key aquí en el
// frontend, aunque el repo sea público) — por ejemplo un Cloudflare
// Worker o una Vercel Function que reciba {type, ctx} y regrese
// {message}, usando tu API key guardada como variable de entorno ahí.

const AI_CONFIG = {
  enabled: false,     // cambiar a true cuando exista el backend
  endpoint: "",        // ej: "https://tu-worker.workers.dev/mensaje"
};

async function fetchAIMessage(type, ctx){
  if(!AI_CONFIG.enabled || !AI_CONFIG.endpoint){
    return getEventMessage(type, ctx); // fallback: banco local
  }
  try{
    const res = await fetch(AI_CONFIG.endpoint, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({type, ctx})
    });
    const data = await res.json();
    return data.message || getEventMessage(type, ctx);
  }catch(e){
    return getEventMessage(type, ctx); // si falla la red, cae al banco local
  }
}
