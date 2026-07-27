(function(){
  "use strict";

  // ---------- Audio: simple siren beep, no external assets ----------
  let audioCtx = null;
  function beep(freqStart, freqEnd, duration, delay){
    try{
      if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
      const t0 = audioCtx.currentTime + (delay||0);
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(freqStart, t0);
      osc.frequency.linearRampToValueAtTime(freqEnd, t0 + duration);
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.06, t0 + 0.03);
      gain.gain.linearRampToValueAtTime(0.001, t0 + duration);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    }catch(e){}
  }
  function playSiren(){
    beep(440, 880, 0.22, 0);
    beep(880, 440, 0.22, 0.24);
    beep(440, 880, 0.22, 0.48);
  }
  function playChime(){
    beep(660, 990, 0.18, 0);
    beep(990, 1320, 0.18, 0.16);
  }

  // ---------- State ----------
  function relLabel(rel){
    if(rel <= -2) return "Eagle";
    if(rel === -1) return "Birdie";
    if(rel === 0) return "Par";
    if(rel === 1) return "Bogey";
    if(rel === 2) return "Dobl.";
    return "Triple+";
  }
  function scoreOptionsForPar(par){
    // raw strokes: siempre se incluye 1 (Ace/hoyo en uno) sin importar el par,
    // más el rango normal par-2 a par+3, sin duplicar.
    const raws = new Set([1]);
    for(let raw = Math.max(1, par-2); raw <= par+3; raw++) raws.add(raw);
    const sorted = Array.from(raws).sort((a,b)=>a-b);
    return sorted.map(raw=>{
      const rel = raw - par;
      const label = raw === 1 ? "Ace" : relLabel(rel);
      return {raw, rel, label};
    });
  }

  let state = {
    screen: "setup",         // setup | pars | reveal | cards | scoring | leaderboardBlock | finalBoard | scorecard
    prevScreen: "leaderboardBlock", // a dónde regresar desde la tarjeta completa
    players: [],             // {id,name,total, holes:[{hole,block,score}]}
    pars: {},                // {holeNumber: 3|4|5}
    block: null,             // 'front' | 'back'
    blockOrder: [],          // shuffled hole numbers for current block
    blockIndex: 0,           // pointer into blockOrder
    blockState: null,        // per-block tracking (see startBlock)
    holeScores: {},          // temp scores for current hole being entered {playerId: relative val}
    pendingEvent: null,      // {type, ...} triggers glitch overlay
    forcedPickCompanion: null,
    fullLog: [],             // {block, hole, text} — persiste toda la ronda (Front 9 + Back 9)
    log: [],
    showLog: false,
    revealAnimating: false,
    finalBlockDone: {front:false, back:false},
    // ---- Modo Skins Chaos (opcional) ----
    skinsMode: false,
    skinsInitialized: false,
    deck: [], discard: [],
    skinPool: 1,
    holeDoubleBy: null,       // playerId que jugó Doble o Nada este hoyo
    pressionActive: false,    // si se jugó Presión este hoyo
    lastPlayedCard: null,     // {cardId, byPlayerId} — para Carta Espejo
    cardsPlayedThisHole: [],  // playerIds que ya jugaron carta este hoyo
    cardTargetsHitThisHole: [], // playerIds que ya recibieron una carta en contra este hoyo
    history: [], // snapshots para poder deshacer el último hoyo
    courseInfo: null, // {key, name, safetyNote, holes:{n:{par,distance,ob,image}}} si se cargó un campo guardado
    trajectoryOpen: false,
  };

  function uid(){ return Math.random().toString(36).slice(2,9); }

  // ---------- Persistencia (localStorage) ----------
  const STORAGE_KEY = "chaosDiscGolfState_v1";
  let pendingResumeDecision = false;

  function saveState(){
    if(pendingResumeDecision) return; // no pisar el respaldo mientras el usuario decide
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch(e){ /* si falla (modo privado, cuota llena, etc.) simplemente no persiste */ }
  }

  function loadSavedState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  }

  function clearSavedState(){
    try{ localStorage.removeItem(STORAGE_KEY); }catch(e){}
  }

  function shuffle(arr){
    const a = arr.slice();
    for(let i=a.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }

  function startBlock(block){
    state.block = block;
    const holes = block === "front" ? [1,2,3,4,5,6,7,8,9] : [10,11,12,13,14,15,16,17,18];
    state.blockOrder = holes; // orden natural — el shuffle de hoyos se quitó por logística de cancha
    if(!state.playOrder) state.playOrder = {front:[], back:[]};
    state.playOrder[block] = state.blockOrder.slice();
    state.blockIndex = 0;
    state.blockState = {
      swapActive: null,        // {a,b} companions active THIS hole (from previous hole birdie)
      swapNextHole: null,      // {a,b} to apply starting next hole
      robTriggered: false,
      glitchTriggered: false,
      anyValidSwapHappened: false,
      log: [],
    };
    state.holeScores = {};
    state.screen = "reveal";
    render();
  }

  function currentHoleNumber(){
    return state.blockOrder[state.blockIndex];
  }
  function currentPosition(){
    return state.blockIndex + 1; // 1-indexed position within block
  }
  function isLastOfBlock(){
    return currentPosition() === 9;
  }

  function goToScoring(){
    state.screen = "scoring";
    state.holeScores = {};
    state.players.forEach(p => state.holeScores[p.id] = null);
    render();
  }

  function setScore(pid, val){
    state.holeScores[pid] = val;
    render();
  }

  function allScoresIn(){
    return state.players.every(p => state.holeScores[p.id] !== null && state.holeScores[p.id] !== undefined);
  }

  function applyDelta(pid, delta){
    const p = state.players.find(x=>x.id===pid);
    p.total += delta;
  }

  function saveHoleAndProcess(){
    // Snapshot del estado ANTES de tocar nada, para poder deshacer este hoyo después.
    snapshotForUndo();

    const bs = state.blockState;
    const holeNum = currentHoleNumber();
    const pos = currentPosition();
    const scores = state.holeScores;

    // record raw scores first (baseline)
    state.players.forEach(p=>{
      p.total += scores[p.id];
      p.holes.push({hole:holeNum, block:state.block, score:scores[p.id]});
    });

    // ---------- Modo Skins Chaos: resolver skin del hoyo ----------
    if(state.skinsMode){
      const minScore = Math.min(...state.players.map(p=>scores[p.id]));
      const winners = state.players.filter(p=>scores[p.id]===minScore);
      if(winners.length === 1){
        const winner = winners[0];
        const value = (state.holeDoubleBy === winner.id) ? state.skinPool*2 : state.skinPool;
        winner.skins += value;
        logEvent(`🏆 ${winner.name} gana ${value} skin${value===1?'':'s'} en el Hoyo ${holeNum}.`);
        state.skinPool = 1;
        state.players.filter(p=>p.id!==winner.id).forEach(p=>drawCardFor(p));
      } else {
        state.skinPool += 1;
        logEvent(`🤝 Empate en el Hoyo ${holeNum} — nadie gana skin. Se acumula para el siguiente (ahora vale ${state.skinPool}).`);
      }
      if(state.pressionActive){
        const maxScore = Math.max(...state.players.map(p=>scores[p.id]));
        const worstPlayers = state.players.filter(p=>scores[p.id]===maxScore);
        if(worstPlayers.length===1 && worstPlayers[0].hand.length>0){
          const wp = worstPlayers[0];
          const idx = Math.floor(Math.random()*wp.hand.length);
          const dropped = wp.hand.splice(idx,1)[0];
          state.discard.push(dropped);
          logEvent(`🔥 Presión: ${wp.name} tuvo el peor resultado del hoyo y perdió una carta.`);
        }
      }
    }

    const swapActiveThisHole = bs.swapActive; // companions using each other's discs THIS hole
    bs.swapActive = null;

    const birdieMakers = state.players.filter(p => scores[p.id] <= -1).map(p=>p.id);
    const others = state.players.filter(p => !birdieMakers.includes(p.id));
    const allOthersBogeyPlus = others.every(p => scores[p.id] >= 1);


    // ---------- Determine Shuffle de Discos (Regla 2) for NEXT hole ----------
    let swapEvent = null;
    if(birdieMakers.length === 1 && allOthersBogeyPlus && others.length>0){
      // will resolve companion pick below (manual choice by host)
      swapEvent = {type:"swap_single", birdie: birdieMakers[0]};
    } else if(birdieMakers.length >= 2){
      const activates = Math.random() < 0.5;
      if(activates){
        const chosen = birdieMakers[Math.floor(Math.random()*birdieMakers.length)];
        swapEvent = {type:"swap_tie", birdie: chosen, allBirdies: birdieMakers};
      }
    }

    // ---------- Robo de Identidad (Regla 3) evaluation on swapActiveThisHole ----------
    let roboEvent = null;
    if(swapActiveThisHole && !bs.robTriggered){
      const isLast = pos === 9;
      const fire = isLast ? true : (Math.random() < 0.40);
      if(fire){
        bs.robTriggered = true;
        roboEvent = {type:"robo", a: swapActiveThisHole.a, b: swapActiveThisHole.b,
          aScore: scores[swapActiveThisHole.a], bScore: scores[swapActiveThisHole.b]};
      }
    }

    // ---------- Forced hole 9/18 (Regla 3.2/3.3) ----------
    let forcedEvent = null;
    if(isLastOfBlock() && !bs.robTriggered && !bs.anyValidSwapHappened && !swapActiveThisHole){
      if(birdieMakers.length >= 1){
        const chosen = birdieMakers.length===1 ? birdieMakers[0] : birdieMakers[Math.floor(Math.random()*birdieMakers.length)];
        forcedEvent = {type:"forced_swap_robo", birdie: chosen, tie: birdieMakers.length>1, allBirdies:birdieMakers};
      } else {
        forcedEvent = {type:"forced_none"};
      }
    }

    // ---------- Glitch del Líder (Regla 4), window = positions 1-8 ----------
    // En la posición 8 (última oportunidad del bloque), si sigue habiendo empate
    // en el mejor o el peor resultado, se desempata al azar en vez de cancelarse —
    // así el evento casi siempre logra aplicar una vez por bloque, incluso con
    // marcadores muy parejos entre los jugadores.
    let glitchEvent = null;
    if(pos <= 8 && !bs.glitchTriggered){
      const bestVal = Math.min(...state.players.map(p=>scores[p.id]));
      const worstVal = Math.max(...state.players.map(p=>scores[p.id]));
      const bestPlayers = state.players.filter(p=>scores[p.id]===bestVal);
      const worstPlayers = state.players.filter(p=>scores[p.id]===worstVal);
      const remaining = 8 - pos + 1;
      const roll = Math.random() < (1/remaining);
      const eligible = bestPlayers.length===1 && worstPlayers.length===1 && bestPlayers[0].id !== worstPlayers[0].id;
      if(roll){
        if(eligible){
          bs.glitchTriggered = true;
          glitchEvent = {type:"glitch_lider", best: bestPlayers[0].id, worst: worstPlayers[0].id,
            bestScore: bestVal, worstScore: worstVal};
        } else if(pos === 8 && bestVal !== worstVal){
          // última oportunidad del bloque: desempate al azar entre los empatados
          const chosenBest = bestPlayers[Math.floor(Math.random()*bestPlayers.length)];
          const chosenWorst = worstPlayers[Math.floor(Math.random()*worstPlayers.length)];
          bs.glitchTriggered = true;
          glitchEvent = {type:"glitch_lider", best: chosenBest.id, worst: chosenWorst.id,
            bestScore: bestVal, worstScore: worstVal};
        }
        // si sigue empatado en pos<8, o si TODOS empataron igual incluso en pos8, se desperdicia sin forzar
      }
    }

    if(swapEvent && (swapEvent.type==="swap_single" || swapEvent.type==="swap_tie")){
      bs.anyValidSwapHappened = true;
    }

    // ---------- Putt Zurdo: los 4 del card sacan exactamente Bogey en el hoyo ----------
    let puttZurdoEvent = null;
    if(state.players.length === 4 && state.players.every(p => scores[p.id] === 1)){
      puttZurdoEvent = {type:"putt_zurdo"};
    }

    // queue events in a sensible order: forced > robo > glitch > swap-companion-pick
    const queue = [];
    if(roboEvent) queue.push(roboEvent);
    if(glitchEvent) queue.push(glitchEvent);
    if(forcedEvent) queue.push(forcedEvent);
    if(swapEvent && !forcedEvent) queue.push(swapEvent); // forced already includes its own swap resolution
    if(puttZurdoEvent) queue.push(puttZurdoEvent);


    state.eventQueue = queue;
    processNextEvent();
  }

  function processNextEvent(){
    if(!state.eventQueue || state.eventQueue.length === 0){
      state.pendingEvent = null;
      advanceAfterHole();
      return;
    }
    const ev = state.eventQueue.shift();
    state.pendingEvent = ev;
    if(ev.type === "robo"){
      // el castigo se aplica después (ver applyRoboEffect), para dar chance de "salvarse"
      const pa = state.players.find(p=>p.id===ev.a);
      const pb = state.players.find(p=>p.id===ev.b);
      ev.victim = (ev.aScore <= ev.bScore) ? ev.a : ev.b; // quien tenía el mejor resultado pierde
      checkShield(ev);
      playSiren();
    } else if(ev.type === "glitch_lider"){
      ev.victim = ev.best; // quien tenía el mejor resultado del hoyo pierde
      checkShield(ev);
      playSiren();
    } else if(ev.type === "swap_single" || ev.type === "swap_tie"){
      playChime();
    } else if(ev.type === "forced_swap_robo"){
      playSiren();
    } else if(ev.type === "forced_none"){
      logEvent("Hoyo forzado sin Birdie — no hay Robo de Identidad este bloque.");
    } else if(ev.type === "putt_zurdo"){
      playChime();
    }
    render();
  }

  function logEvent(text){
    state.fullLog.push({block: state.block, hole: currentHoleNumber(), text});
  }

  function checkShield(ev){
    if(!state.skinsMode) return;
    const victimPlayer = state.players.find(p=>p.id===ev.victim);
    if(victimPlayer && victimPlayer.shielded){
      victimPlayer.shielded = false;
      ev.shieldBlocked = true;
      logEvent(`🛡️ El Escudo de ${victimPlayer.name} bloqueó el castigo de este hoyo.`);
    }
  }

  function applyRoboEffect(ev){
    const pa = state.players.find(p=>p.id===ev.a);
    const pb = state.players.find(p=>p.id===ev.b);
    const delta = ev.bScore - ev.aScore;
    pa.total += delta;
    pb.total -= delta;
    logEvent(`🚨 Robo de Identidad entre ${pa.name} y ${pb.name}.`);
  }

  function applyGlitchLiderEffect(ev){
    const pb = state.players.find(p=>p.id===ev.best);
    const pw = state.players.find(p=>p.id===ev.worst);
    const delta = ev.worstScore - ev.bestScore;
    pb.total += delta;
    pw.total -= delta;
    logEvent(`🚨 Glitch del Líder invierte a ${pb.name} y ${pw.name}.`);
  }

  function applyForcedRoboEffect(mainPid, companionPid){
    const pa = state.players.find(p=>p.id===mainPid);
    const pb = state.players.find(p=>p.id===companionPid);
    const scoreA = state.holeScores[mainPid];
    const scoreB = state.holeScores[companionPid];
    const delta = scoreB - scoreA;
    pa.total += delta;
    pb.total -= delta;
    logEvent(`🚨 Hoyo forzado — combo Shuffle de Discos + Robo de Identidad entre ${pa.name} y ${pb.name}.`);
  }

  function applyPuttZurdo(savedPlayerIds){
    const holeNum = currentHoleNumber();
    savedPlayerIds.forEach(pid=>{
      const p = state.players.find(x=>x.id===pid);
      if(!p) return;
      p.total -= 1;
      const entry = p.holes.find(h=>h.hole===holeNum && h.block===state.block);
      if(entry) entry.score = 0; // de Bogey (+1) a Par (0)
    });
    if(savedPlayerIds.length){
      const names = savedPlayerIds.map(id=>state.players.find(p=>p.id===id).name).join(", ");
      logEvent(`🖐️ Putt Zurdo: ${names} salvaron el par con la mano contraria.`);
    } else {
      logEvent(`🖐️ Putt Zurdo: nadie logró salvar el par.`);
    }
  }

  function resolveCompanionChoice(mainPid, companionPid, reciprocal){
    // sets swapNextHole to apply starting NEXT hole processed
    const pMain = state.players.find(p=>p.id===mainPid);
    const pComp = state.players.find(p=>p.id===companionPid);
    logEvent(`🔄 Shuffle de Discos: ${pMain.name} y ${pComp.name} intercambian disco para el siguiente hoyo${reciprocal ? " (recíproco)" : ""}.`);
    state.blockState.swapActive = null;
    state._pendingSwapForNext = {a: mainPid, b: companionPid, reciprocal: !!reciprocal};
    continueFromEvent();
  }

  function resolveForced(mainPid, companionPid){
    // marca el bloque como resuelto, pero el castigo se aplica después
    // de dar oportunidad de "salvarse" (ver renderGlitchOverlay)
    const bs = state.blockState;
    bs.robTriggered = true;
    bs.anyValidSwapHappened = true;
    state.pendingEvent = {type:"forced_apply_confirm", birdie: mainPid, companion: companionPid, victim: mainPid};
    render();
  }

  function continueFromEvent(){
    processNextEvent();
  }

  function advanceAfterHole(){
    state.trajectoryOpen = false;

    // apply any pending swap decided this hole to be active NEXT hole
    if(state._pendingSwapForNext){
      state.blockState.swapNextHole = state._pendingSwapForNext;
      state._pendingSwapForNext = null;
    }
    state.blockState.swapActive = state.blockState.swapNextHole;
    state.blockState.swapNextHole = null;

    // reset de banderas del modo Skins Chaos para el siguiente hoyo
    if(state.skinsMode){
      state.cardsPlayedThisHole = [];
      state.cardTargetsHitThisHole = [];
      state.holeDoubleBy = null;
      state.pressionActive = false;
      state.players.forEach(p => p.immuneThisHole = false);
    }

    if(currentPosition() >= 9){
      // block finished
      state.finalBlockDone[state.block] = true;
      state.screen = "leaderboardBlock";
      render();
      return;
    }
    state.blockIndex += 1;
    state.screen = "reveal";
    render();
  }

  function basketLogo(){
    return `
    <svg width="24" height="24" viewBox="0 0 48 48" style="vertical-align:-7px;">
      <!-- pole (tube) -->
      <rect x="22.5" y="17" width="3" height="24" rx="1" fill="#7C8798"/>
      <!-- flared base -->
      <path d="M14,43 L34,43 L30,47 L18,47 Z" fill="#7C8798"/>
      <rect x="13" y="41" width="22" height="2.6" rx="1.3" fill="#7C8798"/>
      <!-- chains -->
      <path d="M14,20 Q24,30 34,20" stroke="#3DDBFF" stroke-width="1.6" fill="none" opacity="0.85"/>
      <path d="M17,17 Q24,27 31,17" stroke="#3DDBFF" stroke-width="1.6" fill="none" opacity="0.7"/>
      <path d="M11,23 Q24,32 37,23" stroke="#3DDBFF" stroke-width="1.6" fill="none" opacity="0.6"/>
      <!-- basket rim -->
      <ellipse cx="24" cy="30" rx="12" ry="4" fill="none" stroke="#E7ECEF" stroke-width="2.2"/>
      <!-- basket bottom cage -->
      <path d="M13,30 L15,40 Q24,44 33,40 L35,30" fill="none" stroke="#7C8798" stroke-width="1.8"/>
      <!-- disc, almost going in, tilted above the rim -->
      <ellipse cx="21" cy="12" rx="9" ry="3.4" fill="#D4F521" transform="rotate(-8 21 12)"/>
      <ellipse cx="21" cy="11" rx="9" ry="3.4" fill="#EDFFA0" opacity="0.5" transform="rotate(-8 21 11)"/>
    </svg>`;
  }


  const app = document.getElementById("app");

  function render(){
    let html = "";
    html += renderTopbar();
    html += `<main>`;
    if(state.screen === "setup") html += renderSetup();
    else if(state.screen === "pars") html += renderPars();
    else if(state.screen === "reveal") html += renderReveal();
    else if(state.screen === "cards") html += renderCards();
    else if(state.screen === "scoring") html += renderScoring();
    else if(state.screen === "leaderboardBlock") html += renderBlockLeaderboard();
    else if(state.screen === "finalBoard") html += renderFinalBoard();
    else if(state.screen === "scorecard") html += renderScorecard();
    html += `</main>`;
    if(state.screen !== "setup" && state.screen !== "scorecard") html += renderScoreboardFooterToggle();
    app.innerHTML = html;
    attachHandlers();
    if(state.pendingEvent){
      renderGlitchOverlay();
    }
    saveState();
  }

  function renderTopbar(){
    const frontActive = state.block === "front";
    const backActive = state.block === "back";
    const showReset = !["setup","finalBoard"].includes(state.screen);
    const showUndo = showReset && state.history && state.history.length > 0;
    return `
    <header class="topbar">
      <div class="brand"><span style="color:var(--text);">CHAOS</span> <span style="color:var(--lime);">DISC</span><span style="display:inline-flex;margin:0 -1px;">${basketLogo()}</span><span style="color:var(--lime);">GOLF</span></div>
      <div style="display:flex;gap:6px;align-items:center;">
        <div class="block-pill ${frontActive?'active':''}">FRONT 9</div>
        <div class="block-pill ${backActive?'active':''}">BACK 9</div>
        ${showUndo ? `<button id="undoHoleBtn" class="reset-btn" title="Deshacer último hoyo">↩</button>` : ""}
        ${showReset ? `<button id="resetRoundBtn" class="reset-btn" title="Reiniciar ronda">↺</button>` : ""}
      </div>
    </header>`;
  }

  function renderSetup(){
    const rows = state.players.map((p,i)=>`
      <div class="add-row">
        <input class="name-input" data-pidx="${i}" value="${p.name}" placeholder="Jugador ${i+1}"/>
        <button class="btn-remove" data-remove="${i}">✕</button>
      </div>`).join("");
    return `
      <div class="screen">
        <div class="eyebrow">Armar card</div>
        <h1 class="title">¿Quién juega hoy?</h1>
        <p class="sub">Agrega a los jugadores de la card. El sistema decide cuándo saltan los glitches.</p>
        <div class="card">
          ${rows}
          <button class="btn-ghost" id="addPlayer">+ Agregar jugador</button>
        </div>
        <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div>
            <div style="font-weight:700;font-size:14px;">🃏 Modo Skins Chaos</div>
            <div class="sub" style="margin:2px 0 0;font-size:12px;">Skins acumulables + mazo de cartas con efectos. Opcional.</div>
          </div>
          <button class="mode-toggle ${state.skinsMode?'selected':''}" id="toggleSkinsMode">${state.skinsMode?'ON':'OFF'}</button>
        </div>
      </div>
      <footer class="bottombar">
        <button class="btn-primary" id="toPars" ${state.players.filter(p=>p.name.trim()).length<2?'disabled':''}>Siguiente — configurar pares</button>
      </footer>
    `;
  }

  function renderPars(){
    const holeBlock = (label, holes) => `
      <div class="card">
        <div class="eyebrow" style="margin-bottom:10px;">${label}</div>
        <div class="par-grid">
          ${holes.map(h=>`
            <div class="par-cell">
              <div class="par-hole">Hoyo ${h}</div>
              <div class="par-toggle" data-hole="${h}">
                <button class="par-opt ${state.pars[h]===3?'selected':''}" data-hole="${h}" data-par="3">P3</button>
                <button class="par-opt ${state.pars[h]===4?'selected':''}" data-hole="${h}" data-par="4">P4</button>
                <button class="par-opt ${state.pars[h]===5?'selected':''}" data-hole="${h}" data-par="5">P5</button>
              </div>
            </div>`).join("")}
        </div>
      </div>`;
    return `
      <div class="screen">
        <div class="eyebrow">Configurar campo</div>
        <h1 class="title">¿Qué hoyos son par 4?</h1>
        <p class="sub">Por default todos son par 3. Marca los que sean par 4 — así el sistema calcula Birdie/Bogey correcto sin importar el campo.</p>
        <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div>
            <div style="font-weight:700;font-size:14px;">📍 Los Colomos ${state.courseInfo && state.courseInfo.key==='los_colomos' ? '✅' : ''}</div>
            <div class="sub" style="margin:2px 0 0;font-size:12px;">Carga los pares y el mapa de cada hoyo (Front 9 disponible).</div>
          </div>
          <button class="mode-toggle" id="loadLosColomos" style="flex:0 0 auto;">Cargar</button>
        </div>
        ${holeBlock("Front 9", [1,2,3,4,5,6,7,8,9])}
        ${holeBlock("Back 9", [10,11,12,13,14,15,16,17,18])}
      </div>
      <footer class="bottombar">
        <button class="btn-primary" id="startRound">Iniciar ronda — Front 9</button>
      </footer>
    `;
  }

  function renderReveal(){
    const holeNum = currentHoleNumber();
    const pos = currentPosition();
    const par = state.pars[holeNum];
    const dots = state.blockOrder.map((h,i)=>`<div class="dot ${i<state.blockIndex? 'done':''}"></div>`).join("");
    const holeInfo = state.courseInfo && state.courseInfo.holes[holeNum];

    let trajectoryHtml = "";
    if(holeInfo){
      if(state.trajectoryOpen){
        trajectoryHtml = `
          <div class="card" style="margin-top:16px;max-width:280px;margin-left:auto;margin-right:auto;">
            ${holeDiagramSVG(holeNum, holeInfo)}
            <div class="eyebrow" style="margin-top:10px;">${state.courseInfo.name} · Hoyo ${holeNum}</div>
            <p class="sub" style="margin:6px 0 0;"><b>Distancia:</b> ${holeInfo.distance}m</p>
            <p class="sub" style="margin:4px 0 0;"><b>OB:</b> ${holeInfo.ob}</p>
            ${holeInfo.special ? `<p class="sub" style="margin:6px 0 0;color:var(--amber);"><b>⚡ Regla especial:</b> ${holeInfo.special}</p>` : ""}
          </div>`;
      }
    }

    return `
      <div class="screen reveal-wrap">
        <div class="reveal-label">Hoyo ${pos} de 9 · ${state.block==='front'?'Front':'Back'} 9</div>
        <div class="reveal-num ${state.revealAnimating?'glitching':''}" id="revealNum">${holeNum}</div>
        <div class="block-pill" style="margin-top:8px;">PAR ${par}</div>
        <div class="progress-dots">${dots}</div>
        <p class="center-note">Siguiente hoyo. Caminen al hoyo ${holeNum}.</p>
        ${holeInfo ? `<button class="btn-ghost" id="toggleTrajectory" style="margin-top:6px;max-width:280px;">🗺️ ${state.trajectoryOpen?'Ocultar':'Ver'} trayecto del hoyo</button>` : ""}
        ${trajectoryHtml}
      </div>
      <footer class="bottombar">
        ${state.skinsMode ? `<button class="btn-ghost" id="toCards" style="margin-bottom:10px;">🃏 Jugar cartas (opcional)</button>` : ""}
        <button class="btn-primary" id="toScoring">Jugar este hoyo</button>
      </footer>
    `;
  }

  function renderCards(){
    const skinLabel = state.skinPool > 1 ? `${state.skinPool} skins acumulados` : "1 skin";
    const playersHtml = state.players.map(p=>{
      const played = state.cardsPlayedThisHole.includes(p.id);
      const cardsHtml = p.hand.length
        ? p.hand.map((cid,idx)=>{
            const def = CARD_DEFS[cid];
            return `<button class="hand-card" data-pid="${p.id}" data-idx="${idx}" ${played?'disabled':''}>
              <span class="hc-name">${def.name}</span>
              <span class="hc-desc">${def.desc}</span>
            </button>`;
          }).join("")
        : `<p class="center-note" style="margin:6px 0;">Sin cartas en mano.</p>`;
      return `
        <div class="card">
          <div class="eyebrow" style="display:flex;justify-content:space-between;">
            <span>${p.name} · 🏆${p.skins}</span>
            <span>${played ? "✅ jugó carta" : `${p.hand.length} carta${p.hand.length===1?'':'s'}`}</span>
          </div>
          <div class="hand-grid">${cardsHtml}</div>
        </div>`;
    }).join("");

    return `
      <div class="screen">
        <div class="eyebrow">Antes de jugar el hoyo</div>
        <h1 class="title">🃏 Mesa de cartas</h1>
        <p class="sub">Skin en juego este hoyo: <b>${skinLabel}</b>. Cada jugador puede jugar máximo 1 carta por hoyo.</p>
        ${playersHtml}
      </div>
      <footer class="bottombar">
        <button class="btn-primary" id="backFromCards">Continuar a capturar tiros</button>
      </footer>
    `;
  }

  function drawCardFor(player){
    if(state.deck.length === 0){
      if(state.discard.length === 0) return; // mazo y descarte vacíos, no hay más cartas
      state.deck = shuffle(state.discard);
      state.discard = [];
    }
    const c = state.deck.pop();
    if(c) player.hand.push(c);
    while(player.hand.length > 5){
      const dropped = player.hand.shift(); // descarta la más vieja si se pasa del límite
      state.discard.push(dropped);
    }
  }

  function promptCardTarget(playerId, handIdx, def){
    const options = state.players.filter(p=>p.id!==playerId);
    const overlay = document.createElement("div");
    overlay.className = "glitch-overlay flash-info";
    overlay.innerHTML = `
      <div class="glitch-card">
        <div class="glitch-siren">🃏</div>
        <div class="glitch-title" style="color:var(--cyan);animation:none;">${def.name}</div>
        <div class="glitch-desc">${def.desc}<br>¿A quién le juegas esta carta?</div>
        <select class="pick" id="cardTargetPick">${options.map(o=>`<option value="${o.id}">${o.name}</option>`).join("")}</select>
        <button class="btn-primary" id="confirmCardTarget" style="margin-top:14px;">Jugar carta</button>
        <button class="btn-ghost" id="cancelCardTarget" style="margin-top:8px;">Cancelar</button>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById("confirmCardTarget").addEventListener("click", ()=>{
      const targetId = document.getElementById("cardTargetPick").value;
      document.body.removeChild(overlay);
      playCard(playerId, handIdx, targetId);
    });
    document.getElementById("cancelCardTarget").addEventListener("click", ()=>{
      document.body.removeChild(overlay);
    });
  }

  function playCard(playerId, handIdx, targetId){
    const player = state.players.find(p=>p.id===playerId);
    if(!player || state.cardsPlayedThisHole.includes(playerId)) return;
    const cardId = player.hand[handIdx];
    if(!cardId) return;
    const def = CARD_DEFS[cardId];
    const target = targetId ? state.players.find(p=>p.id===targetId) : null;

    if(target && target.immuneThisHole){
      logEvent(`🚫 ${target.name} tenía Veto activo — la carta ${def.name} de ${player.name} no tuvo efecto.`);
      player.hand.splice(handIdx,1);
      state.discard.push(cardId);
      state.cardsPlayedThisHole.push(playerId);
      render();
      return;
    }

    applyCardEffect(cardId, player, target);

    player.hand.splice(handIdx,1);
    state.discard.push(cardId);
    state.cardsPlayedThisHole.push(playerId);
    if(target) state.cardTargetsHitThisHole.push(target.id);
    if(cardId !== "carta_espejo") state.lastPlayedCard = {cardId, byPlayerId: playerId};
    render();
  }

  function applyCardEffect(cardId, player, target){
    const def = CARD_DEFS[cardId];
    if(cardId === "escudo"){
      player.shielded = true;
      logEvent(`🛡️ ${player.name} jugó Escudo — queda protegido del próximo Robo/Glitch.`);
    } else if(cardId === "ojo_halcon"){
      if(target){ target.saveBlocked = true; logEvent(`🎯 ${player.name} jugó Ojo de Halcón contra ${target.name} — le anula su "salvarme".`); }
    } else if(cardId === "doble_nada"){
      state.holeDoubleBy = player.id;
      logEvent(`🎲 ${player.name} jugó Doble o Nada — si gana el skin de este hoyo, se duplica.`);
    } else if(cardId === "robo_carta"){
      if(target && target.hand.length){
        const idx = Math.floor(Math.random()*target.hand.length);
        const stolen = target.hand.splice(idx,1)[0];
        player.hand.push(stolen);
        logEvent(`🎁 ${player.name} le robó una carta a ${target.name}.`);
      } else if(target){
        logEvent(`🎁 ${player.name} intentó robarle carta a ${target.name}, pero no tenía ninguna.`);
      }
    } else if(cardId === "presion"){
      state.pressionActive = true;
      logEvent(`🔥 ${player.name} jugó Presión — el peor resultado de este hoyo pierde una carta al azar.`);
    } else if(cardId === "veto"){
      player.immuneThisHole = true;
      logEvent(`🚫 ${player.name} jugó Veto — nadie puede jugarle cartas este hoyo.`);
    } else if(cardId === "carta_espejo"){
      if(state.lastPlayedCard){
        const mirroredId = state.lastPlayedCard.cardId;
        logEvent(`👻 ${player.name} jugó Carta Espejo, copiando ${CARD_DEFS[mirroredId].name}.`);
        applyCardEffect(mirroredId, player, target);
      } else {
        logEvent(`👻 ${player.name} jugó Carta Espejo, pero no había ninguna carta previa que copiar.`);
      }
    } else if(def.kind === "physical"){
      // Cartas de instrucción física: el sistema solo anuncia, el grupo la ejecuta.
      const targetTxt = target ? ` (afecta a ${target.name})` : "";
      logEvent(`${def.name}: ${player.name} la jugó${targetTxt}. ${def.desc}`);
    }
  }

  function renderScoring(){
    const holeNum = currentHoleNumber();
    const par = state.pars[holeNum];
    const opts = scoreOptionsForPar(par);
    const rows = state.players.map(p=>{
      const sel = state.holeScores[p.id]; // relative value
      const btns = opts.map(opt=>{
        const isSel = sel === opt.rel;
        const bad = opt.rel >= 1;
        return `<button class="score-btn ${isSel?'selected':''} ${isSel&&bad?'bad':''}" data-pid="${p.id}" data-rel="${opt.rel}">
          <span class="num">${opt.raw}</span>${opt.label}
        </button>`;
      }).join("");
      return `<div class="player-score-row">
        <div class="pname">${p.name}</div>
        <div class="score-btns">${btns}</div>

      </div>`;
    }).join("");

    const swap = state.blockState.swapActive;
    let swapBanner = "";
    if(swap){
      const pa = state.players.find(x=>x.id===swap.a);
      const pb = state.players.find(x=>x.id===swap.b);
      swapBanner = `<div class="banner info">
        <div class="btitle">🔄 Discos cambiados este hoyo</div>
        <div class="btext">${pa.name} y ${pb.name} juegan con disco elegido del otro. Este hoyo es candidato a Robo de Identidad.</div>
      </div>`;
    }

    return `
      <div class="screen">
        <div class="eyebrow">Hoyo ${holeNum} · Par ${par}</div>
        <h1 class="title">Captura los tiros</h1>
        <p class="sub">Toca el número de tiros reales de cada jugador — el sistema calcula solo el resultado.</p>
        ${swapBanner}
        ${rows}
      </div>
      <footer class="bottombar">
        <button class="btn-primary" id="saveHole" ${allScoresIn()?'':'disabled'}>Guardar hoyo</button>
      </footer>
    `;
  }

  function renderBlockLeaderboard(){
    const other = state.block === "front" ? "back" : "front";
    const bothDone = state.finalBlockDone.front && state.finalBlockDone.back;
    const blockLog = state.fullLog.filter(l=>l.block===state.block);
    return `
      <div class="screen">
        <div class="eyebrow">${state.block==='front'?'Front 9':'Back 9'} completado</div>
        <h1 class="title">Así va el marcador</h1>
        ${renderScoreboardCard()}
        ${blockLog.length ? `<div class="card"><div class="eyebrow" style="margin-bottom:8px;">Eventos de este bloque</div><div class="log-list">${blockLog.map(l=>`· Hoyo ${l.hole}: ${l.text}`).join("<br>")}</div></div>` : ""}
        <button class="btn-ghost" id="toScorecard" style="margin-bottom:14px;">📋 Ver tarjeta completa</button>
      </div>
      <footer class="bottombar">
        ${bothDone
          ? `<button class="btn-primary" id="toFinal">Ver marcador final</button>`
          : `<button class="btn-primary" id="startOther">Iniciar ${other==='front'?'Front':'Back'} 9</button>`}
      </footer>
    `;
  }

  function renderFinalBoard(){
    const sortedByScore = state.players.slice().sort((a,b)=>a.total-b.total);
    const winner = state.skinsMode
      ? state.players.slice().sort((a,b)=>b.skins-a.skins)[0]
      : sortedByScore[0];
    const winnerLine = state.skinsMode
      ? `🏆 ${winner.name} gana con ${winner.skins} skin${winner.skins===1?'':'s'}`
      : `🏆 ${winner.name} se lleva la card`;
    return `
      <div class="screen">
        <div class="eyebrow">Ronda completa · 18 hoyos</div>
        <h1 class="title">${winnerLine}</h1>
        ${renderScoreboardCard()}
        <button class="btn-ghost" id="toScorecard" style="margin-bottom:14px;">📋 Ver tarjeta completa</button>
      </div>
      <footer class="bottombar">
        <button class="btn-primary" id="newRound">Jugar otra ronda</button>
      </footer>
    `;
  }

  function renderScorecard(){
    const blocks = [
      {key:"front", label:"Front 9", holes:[1,2,3,4,5,6,7,8,9]},
      {key:"back", label:"Back 9", holes:[10,11,12,13,14,15,16,17,18]},
    ];

    const tables = blocks.map(b=>{
      const played = state.players.length && state.players[0].holes.some(h=>h.block===b.key);
      if(!played) return `<div class="card"><div class="eyebrow">${b.label}</div><p class="center-note" style="margin:8px 0 0;">Todavía no se juega este bloque.</p></div>`;

      const headerCells = b.holes.map(h=>`<th>${h}<br><span class="sc-par">P${state.pars[h]}</span></th>`).join("");
      const rows = state.players.map(p=>{
        const cells = b.holes.map(h=>{
          const entry = p.holes.find(x=>x.hole===h && x.block===b.key);
          if(!entry) return `<td>—</td>`;
          const raw = state.pars[h] + entry.score;
          const cls = entry.score <= -1 ? "sc-good" : (entry.score >= 1 ? "sc-bad" : "sc-even");
          return `<td class="${cls}">${raw}</td>`;
        }).join("");
        return `<tr><td class="sc-name">${p.name}</td>${cells}</tr>`;
      }).join("");

      const blockLog = state.fullLog.filter(l=>l.block===b.key);
      const logHtml = blockLog.length
        ? `<div class="log-list" style="margin-top:10px;">${blockLog.map(l=>`· Hoyo ${l.hole}: ${l.text}`).join("<br>")}</div>`
        : `<p class="center-note" style="margin:8px 0 0;">Sin eventos en este bloque.</p>`;

      const order = (state.playOrder && state.playOrder[b.key]) || [];
      const orderHtml = order.length
        ? `<p class="center-note" style="text-align:left;margin:10px 0 0;">Orden jugado: ${order.join(" → ")}</p>`
        : "";

      return `
        <div class="card">
          <div class="eyebrow" style="margin-bottom:8px;">${b.label}</div>
          <div style="overflow-x:auto;">
            <table class="scorecard-table">
              <thead><tr><th></th>${headerCells}</tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ${orderHtml}
          ${logHtml}
        </div>`;
    }).join("");

    return `
      <div class="screen">
        <div class="eyebrow">Registro completo</div>
        <h1 class="title">Tarjeta de la ronda</h1>
        <p class="sub">Tiros reales por hoyo (par ya aplicado) y todos los eventos que saltaron.</p>
        ${tables}
      </div>
      <footer class="bottombar">
        <button class="btn-primary" id="backFromScorecard">Regresar</button>
      </footer>
    `;
  }

  function scoreClass(total){
    if(total < 0) return "neg";
    if(total > 0) return "pos";
    return "zero";
  }

  function renderScoreboardCard(){
    const sorted = state.players.slice().sort((a,b)=>a.total-b.total);
    const rows = sorted.map((p,i)=>`
      <div class="sb-row">
        <div class="sb-name"><span class="sb-rank">${i+1}</span>${p.name}${state.skinsMode?` <span class="mono" style="color:var(--amber);font-size:11px;">🏆${p.skins}</span>`:""}</div>
        <div class="sb-score ${scoreClass(p.total)} mono">${p.total>0?'+':''}${p.total}</div>
      </div>`).join("");
    return `<div class="scoreboard">${rows}</div>`;
  }

  function renderScoreboardFooterToggle(){
    return `<div style="padding:0 20px 130px;">${renderScoreboardCard()}</div>`;
  }

  function renderGlitchOverlay(){
    const ev = state.pendingEvent;
    let title = "", desc = "", cta = "Continuar";
    let bodyExtra = "";
    let punishing = false; // true = este evento aplica un castigo real (elegible para "salvarme")
    let victimId = ev.victim || null;

    if(ev.type === "robo"){
      const pa = state.players.find(p=>p.id===ev.a), pb = state.players.find(p=>p.id===ev.b);
      title = "🚨 ¡ROBO DE IDENTIDAD!";
      desc = getEventMessage("robo", {player:`<b>${pa.name}</b>`, player2:`<b>${pb.name}</b>`});
      cta = "Aplicar castigo";
      punishing = true;
    } else if(ev.type === "glitch_lider"){
      const pb = state.players.find(p=>p.id===ev.best), pw = state.players.find(p=>p.id===ev.worst);
      title = "🚨 ¡GLITCH DEL LÍDER!";
      desc = getEventMessage("glitch_lider", {player:`<b>${pb.name}</b>`, player2:`<b>${pw.name}</b>`});
      cta = "Aplicar castigo";
      punishing = true;
    } else if(ev.type === "swap_single"){
      const pMain = state.players.find(p=>p.id===ev.birdie);
      const options = state.players.filter(p=>p.id!==ev.birdie);
      title = "🔄 ¡SHUFFLE DE DISCOS!";
      desc = getEventMessage("swap_single", {player:`<b>${pMain.name}</b>`}) + " Elige con quién intercambia disco:";
      bodyExtra = `<select class="pick" id="companionPick">${options.map(o=>`<option value="${o.id}">${o.name}</option>`).join("")}</select>`;
      cta = "Confirmar intercambio";
    } else if(ev.type === "swap_tie"){
      const pMain = state.players.find(p=>p.id===ev.birdie);
      const options = state.players.filter(p=>p.id!==ev.birdie);
      title = "🔄 ¡SHUFFLE DE DISCOS (empate)!";
      desc = getEventMessage("swap_tie", {player:`<b>${pMain.name}</b>`}) + " Elige compañero — el intercambio será recíproco.";
      bodyExtra = `<select class="pick" id="companionPick">${options.map(o=>`<option value="${o.id}">${o.name}</option>`).join("")}</select>`;
      cta = "Confirmar intercambio";
    } else if(ev.type === "forced_swap_robo"){
      const pMain = state.players.find(p=>p.id===ev.birdie);
      const options = state.players.filter(p=>p.id!==ev.birdie);
      title = "🚨 ¡HOYO FORZADO!";
      desc = getEventMessage("forced_swap_robo", {player:`<b>${pMain.name}</b>`}) + " Elige compañero:";
      bodyExtra = `<select class="pick" id="companionPick">${options.map(o=>`<option value="${o.id}">${o.name}</option>`).join("")}</select>`;
      cta = "Aplicar combo";
    } else if(ev.type === "forced_apply_confirm"){
      const pa = state.players.find(p=>p.id===ev.birdie), pb = state.players.find(p=>p.id===ev.companion);
      title = "🚨 ¡COMBO FORZADO!";
      desc = `Se va a aplicar el intercambio de este hoyo entre <b>${pa.name}</b> y <b>${pb.name}</b>.`;
      cta = "Aplicar castigo";
      punishing = true;
    } else if(ev.type === "forced_none"){
      title = "Hoyo de cierre sin Birdie";
      desc = getEventMessage("forced_none", {});
    } else if(ev.type === "putt_zurdo"){
      title = "🖐️ ¡PUTT ZURDO!";
      desc = "Los 4 sacaron Bogey en este hoyo. Cada quien repite su putt desde la misma posición, con la mano contraria, para intentar salvar el par. Marca quién lo logró:";
      bodyExtra = state.players.map(p=>`
        <label class="putt-zurdo-check">
          <input type="checkbox" id="pz_${p.id}" value="${p.id}"/> ${p.name} salvó el par
        </label>`).join("");
      cta = "Confirmar resultados";
    }

    // Si el Escudo (modo Skins Chaos) ya bloqueó el castigo, se muestra un mensaje especial
    // y ya no hay nada que aplicar ni oportunidad de "salvarme" (no hace falta).
    if(ev.shieldBlocked){
      const victimPlayer = state.players.find(p=>p.id===ev.victim);
      title = "🛡️ ¡ESCUDO ACTIVADO!";
      desc = `${victimPlayer ? `<b>${victimPlayer.name}</b> tenía Escudo activo` : "El jugador tenía Escudo activo"} y bloqueó el castigo de este hoyo por completo.`;
      cta = "Continuar";
      punishing = false;
    }

    const victim = victimId ? state.players.find(p=>p.id===victimId) : null;
    let canSave = punishing && victim && !victim.usedSave;
    if(canSave && victim.saveBlocked){
      canSave = false;
      victim.saveBlocked = false; // se consume el bloqueo de Ojo de Halcón, solo una vez
    }

    function applyThePunishment(){
      if(ev.shieldBlocked) return; // el Escudo ya lo anuló, no hay nada que aplicar
      if(ev.type === "robo") applyRoboEffect(ev);
      else if(ev.type === "glitch_lider") applyGlitchLiderEffect(ev);
      else if(ev.type === "forced_apply_confirm") applyForcedRoboEffect(ev.birdie, ev.companion);
    }

    const saveBtnHtml = canSave
      ? `<button class="btn-ghost" id="saveAttemptBtn" style="margin-top:8px;border-color:var(--amber);color:var(--amber);">🎰 ${victim.name}, intentar salvarme (única oportunidad · 25%)</button>`
      : "";

    let flashClass = "";
    if(punishing) flashClass = "flash-danger";
    else if(ev.type === "swap_single" || ev.type === "swap_tie" || ev.type === "forced_swap_robo" || ev.type === "putt_zurdo") flashClass = "flash-info";

    const overlay = document.createElement("div");
    overlay.className = `glitch-overlay ${flashClass}`;
    overlay.innerHTML = `
      <div class="glitch-card">
        <div class="glitch-siren">🚨</div>
        <div class="glitch-title">${title}</div>
        <div class="glitch-desc">${desc}</div>
        ${bodyExtra}
        <button class="btn-primary" id="glitchContinue" style="margin-top:${bodyExtra?'14px':'0'};">${cta}</button>
        ${saveBtnHtml}
      </div>
    `;
    document.body.appendChild(overlay);

    function finishAndContinue(){
      let comp = null;
      if(ev.type === "swap_single" || ev.type === "swap_tie" || ev.type === "forced_swap_robo"){
        const sel = document.getElementById("companionPick");
        comp = sel ? sel.value : null;
      }
      let puttZurdoSaved = null;
      if(ev.type === "putt_zurdo"){
        puttZurdoSaved = state.players
          .filter(p => document.getElementById(`pz_${p.id}`) && document.getElementById(`pz_${p.id}`).checked)
          .map(p => p.id);
      }
      document.body.removeChild(overlay);
      if(ev.type === "swap_single"){
        resolveCompanionChoice(ev.birdie, comp, false);
      } else if(ev.type === "swap_tie"){
        resolveCompanionChoice(ev.birdie, comp, true);
      } else if(ev.type === "forced_swap_robo"){
        resolveForced(ev.birdie, comp);
      } else if(ev.type === "putt_zurdo"){
        applyPuttZurdo(puttZurdoSaved);
        continueFromEvent();
      } else {
        continueFromEvent();
      }
    }

    document.getElementById("glitchContinue").addEventListener("click", ()=>{
      if(punishing) applyThePunishment();
      finishAndContinue();
    });

    if(canSave){
      document.getElementById("saveAttemptBtn").addEventListener("click", ()=>{
        victim.usedSave = true;
        const success = Math.random() < 0.25;
        logEvent(success
          ? `🎰 ${victim.name} usó su única oportunidad de salvarse y le funcionó — castigo anulado.`
          : `🎰 ${victim.name} usó su única oportunidad de salvarse y no le funcionó.`);
        const card = overlay.querySelector(".glitch-card");
        if(success){
          card.innerHTML = `
            <div class="glitch-siren">🎰</div>
            <div class="glitch-title" style="color:var(--lime);">¡SE SALVÓ!</div>
            <div class="glitch-desc"><b>${victim.name}</b> gastó su única oportunidad de la ronda y le funcionó. El castigo queda anulado para este hoyo.</div>
            <button class="btn-primary" id="afterSaveContinue">Continuar</button>
          `;
        } else {
          card.innerHTML = `
            <div class="glitch-siren">🎰</div>
            <div class="glitch-title">SIN SUERTE</div>
            <div class="glitch-desc"><b>${victim.name}</b> gastó su única oportunidad de la ronda y no funcionó. El castigo se aplica normal.</div>
            <button class="btn-primary" id="afterSaveContinue">Continuar</button>
          `;
        }
        document.getElementById("afterSaveContinue").addEventListener("click", ()=>{
          if(!success) applyThePunishment();
          finishAndContinue();
        });
      });
    }
  }

  function attachHandlers(){
    const addBtn = document.getElementById("addPlayer");
    if(addBtn) addBtn.addEventListener("click", ()=>{
      state.players.push({id:uid(), name:"", total:0, holes:[], usedSave:false, hand:[], skins:0, shielded:false, saveBlocked:false, immuneThisHole:false});
      render();
    });
    document.querySelectorAll("[data-pidx]").forEach(inp=>{
      inp.addEventListener("input", (e)=>{
        state.players[+e.target.dataset.pidx].name = e.target.value;
        const btn = document.getElementById("toPars");
        if(btn) btn.disabled = state.players.filter(p=>p.name.trim()).length < 2;
      });
    });
    document.querySelectorAll("[data-remove]").forEach(btn=>{
      btn.addEventListener("click", (e)=>{
        state.players.splice(+e.target.dataset.remove,1);
        render();
      });
    });
    const toPars = document.getElementById("toPars");
    if(toPars) toPars.addEventListener("click", ()=>{
      state.players = state.players.filter(p=>p.name.trim());
      if(state.players.length<2) return;
      state.screen = "pars";
      render();
    });

    const toggleSkinsMode = document.getElementById("toggleSkinsMode");
    if(toggleSkinsMode) toggleSkinsMode.addEventListener("click", ()=>{
      state.skinsMode = !state.skinsMode;
      render();
    });

    const loadLosColomos = document.getElementById("loadLosColomos");
    if(loadLosColomos) loadLosColomos.addEventListener("click", ()=>{
      applyCoursePreset(state, "los_colomos");
      render();
    });

    document.querySelectorAll(".par-opt").forEach(btn=>{
      btn.addEventListener("click", (e)=>{
        const h = +e.currentTarget.dataset.hole;
        const par = +e.currentTarget.dataset.par;
        state.pars[h] = par;
        render();
      });
    });

    const startRound = document.getElementById("startRound");
    if(startRound) startRound.addEventListener("click", ()=>{
      if(state.skinsMode && !state.skinsInitialized){
        state.deck = buildShuffledDeck(3); // 3 copias de cada una de las 12 cartas = 36
        state.discard = [];
        state.players.forEach(p=>{
          p.hand = [];
          for(let i=0;i<3;i++){ const c = state.deck.pop(); if(c) p.hand.push(c); }
        });
        state.skinsInitialized = true;
      }
      startBlock("front");
    });

    const toScoring = document.getElementById("toScoring");
    if(toScoring) toScoring.addEventListener("click", goToScoring);

    const toggleTrajectory = document.getElementById("toggleTrajectory");
    if(toggleTrajectory) toggleTrajectory.addEventListener("click", ()=>{
      state.trajectoryOpen = !state.trajectoryOpen;
      render();
    });

    const toCards = document.getElementById("toCards");
    if(toCards) toCards.addEventListener("click", ()=>{
      state.screen = "cards";
      render();
    });

    const backFromCards = document.getElementById("backFromCards");
    if(backFromCards) backFromCards.addEventListener("click", goToScoring);

    document.querySelectorAll(".hand-card").forEach(btn=>{
      btn.addEventListener("click", (e)=>{
        const pid = e.currentTarget.dataset.pid;
        const idx = +e.currentTarget.dataset.idx;
        const player = state.players.find(p=>p.id===pid);
        const cardId = player.hand[idx];
        const def = CARD_DEFS[cardId];
        if(def.needsTarget){
          promptCardTarget(pid, idx, def);
        } else {
          playCard(pid, idx, null);
        }
      });
    });

    document.querySelectorAll(".score-btn").forEach(btn=>{
      btn.addEventListener("click", (e)=>{
        const el = e.currentTarget;
        setScore(el.dataset.pid, +el.dataset.rel);
      });
    });

    const saveHole = document.getElementById("saveHole");
    if(saveHole) saveHole.addEventListener("click", saveHoleAndProcess);

    const startOther = document.getElementById("startOther");
    if(startOther) startOther.addEventListener("click", ()=>{
      startBlock(state.block === "front" ? "back" : "front");
    });

    const toFinal = document.getElementById("toFinal");
    if(toFinal) toFinal.addEventListener("click", ()=>{
      state.screen = "finalBoard";
      render();
    });

    const toScorecard = document.getElementById("toScorecard");
    if(toScorecard) toScorecard.addEventListener("click", ()=>{
      state.prevScreen = state.screen;
      state.screen = "scorecard";
      render();
    });

    const backFromScorecard = document.getElementById("backFromScorecard");
    if(backFromScorecard) backFromScorecard.addEventListener("click", ()=>{
      state.screen = state.prevScreen || "leaderboardBlock";
      render();
    });

    const newRound = document.getElementById("newRound");
    if(newRound) newRound.addEventListener("click", ()=>{
      resetToNewRound();
    });

    const resetRoundBtn = document.getElementById("resetRoundBtn");
    if(resetRoundBtn) resetRoundBtn.addEventListener("click", ()=>{
      showResetConfirm();
    });

    const undoHoleBtn = document.getElementById("undoHoleBtn");
    if(undoHoleBtn) undoHoleBtn.addEventListener("click", ()=>{
      undoLastHole();
    });
  }

  function resetToNewRound(){
    clearSavedState();
    state = freshDefaultState();
    render();
  }

  function snapshotForUndo(){
    // clona el estado actual (sin el propio historial, para no anidar snapshots)
    const clone = JSON.parse(JSON.stringify({...state, history: undefined}));
    if(!Array.isArray(state.history)) state.history = [];
    state.history.push(clone);
    if(state.history.length > 20) state.history.shift(); // tope de seguridad, 18 hoyos caben de sobra
  }

  function undoLastHole(){
    if(!state.history || state.history.length === 0) return;
    const prevHistory = state.history;
    const restored = prevHistory.pop();
    restored.history = prevHistory;
    state = restored;
    render();
  }

  function showResetConfirm(){
    const overlay = document.createElement("div");
    overlay.className = "glitch-overlay";
    overlay.innerHTML = `
      <div class="glitch-card">
        <div class="glitch-siren">⚠️</div>
        <div class="glitch-title" style="color:var(--amber);animation:none;">¿REINICIAR RONDA?</div>
        <div class="glitch-desc">Se va a borrar todo el progreso de la ronda actual (marcador, hoyos jugados, eventos). Esto no se puede deshacer.</div>
        <button class="btn-primary" id="confirmResetBtn" style="background:var(--magenta);color:#fff;margin-bottom:8px;">Sí, reiniciar todo</button>
        <button class="btn-ghost" id="cancelResetBtn">Cancelar, seguir jugando</button>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById("confirmResetBtn").addEventListener("click", ()=>{
      document.body.removeChild(overlay);
      resetToNewRound();
    });
    document.getElementById("cancelResetBtn").addEventListener("click", ()=>{
      document.body.removeChild(overlay);
    });
  }

  // ---------- Arranque ----------
  function freshDefaultState(){
    const freshPars = {};
    for(let h=1;h<=18;h++){ freshPars[h] = 3; }
    return {
      screen:"setup", prevScreen:"leaderboardBlock",
      players:[0,1,2,3].map(()=>({id:uid(), name:"", total:0, holes:[], usedSave:false, hand:[], skins:0, shielded:false, saveBlocked:false, immuneThisHole:false})),
      pars:freshPars, block:null, blockOrder:[], blockIndex:0, blockState:null, playOrder:{front:[], back:[]},
      holeScores:{}, pendingEvent:null, fullLog:[], log:[], showLog:false, revealAnimating:false,
      finalBlockDone:{front:false, back:false},
      skinsMode:false, skinsInitialized:false, deck:[], discard:[], skinPool:1,
      holeDoubleBy:null, pressionActive:false, lastPlayedCard:null,
      cardsPlayedThisHole:[], cardTargetsHitThisHole:[], history:[], courseInfo:null, trajectoryOpen:false,
    };
  }

  function showResumePrompt(saved){
    const holeInfo = saved.block ? `${saved.block==='front'?'Front 9':'Back 9'}, hoyo ${saved.blockIndex+1} de 9` : "";
    const overlay = document.createElement("div");
    overlay.className = "glitch-overlay";
    overlay.innerHTML = `
      <div class="glitch-card">
        <div class="glitch-siren">📋</div>
        <div class="glitch-title" style="color:var(--cyan);animation:none;">RONDA EN CURSO</div>
        <div class="glitch-desc">Encontramos una ronda sin terminar (${holeInfo}). ¿Quieres continuarla o empezar una nueva?</div>
        <button class="btn-primary" id="resumeBtn" style="margin-bottom:8px;">Continuar ronda</button>
        <button class="btn-ghost" id="freshBtn">Empezar de nuevo</button>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById("resumeBtn").addEventListener("click", ()=>{
      document.body.removeChild(overlay);
      state = saved;
      pendingResumeDecision = false;
      render();
    });
    document.getElementById("freshBtn").addEventListener("click", ()=>{
      document.body.removeChild(overlay);
      clearSavedState();
      state = freshDefaultState();
      pendingResumeDecision = false;
      render();
    });
  }

  const saved = loadSavedState();
  if(saved && saved.players && saved.players.length && saved.screen && saved.screen !== "setup" && saved.screen !== "finalBoard"){
    pendingResumeDecision = true;
    state = freshDefaultState(); // pantalla base detrás del prompt
    showResumePrompt(saved);
  } else {
    if(saved) clearSavedState(); // rondas ya terminadas no se ofrecen para continuar
    state = freshDefaultState();
  }
  render();
})();
