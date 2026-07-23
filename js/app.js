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
    // raw strokes from par-2 to par+3, mapped to relative-to-par value + label
    const opts = [];
    for(let raw = par-2; raw <= par+3; raw++){
      const rel = raw - par;
      opts.push({raw, rel, label: relLabel(rel)});
    }
    return opts;
  }

  let state = {
    screen: "setup",         // setup | pars | reveal | scoring | leaderboardBlock | finalBoard
    players: [],             // {id,name,total, holes:[{hole,block,score}]}
    pars: {},                // {holeNumber: 3|4}
    block: null,             // 'front' | 'back'
    blockOrder: [],          // shuffled hole numbers for current block
    blockIndex: 0,           // pointer into blockOrder
    blockState: null,        // per-block tracking (see startBlock)
    holeScores: {},          // temp scores for current hole being entered {playerId: relative val}
    pendingEvent: null,      // {type, ...} triggers glitch overlay
    forcedPickCompanion: null,
    log: [],
    showLog: false,
    revealAnimating: false,
    finalBlockDone: {front:false, back:false},
  };

  function uid(){ return Math.random().toString(36).slice(2,9); }

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
    state.blockOrder = shuffle(holes);
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
    const bs = state.blockState;
    const holeNum = currentHoleNumber();
    const pos = currentPosition();
    const scores = state.holeScores;

    // record raw scores first (baseline)
    state.players.forEach(p=>{
      p.total += scores[p.id];
      p.holes.push({hole:holeNum, block:state.block, score:scores[p.id]});
    });

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
    let glitchEvent = null;
    if(pos <= 8 && !bs.glitchTriggered){
      const bestVal = Math.min(...state.players.map(p=>scores[p.id]));
      const worstVal = Math.max(...state.players.map(p=>scores[p.id]));
      const bestPlayers = state.players.filter(p=>scores[p.id]===bestVal);
      const worstPlayers = state.players.filter(p=>scores[p.id]===worstVal);
      const remaining = 8 - pos + 1;
      const roll = Math.random() < (1/remaining);
      if(roll){
        if(bestPlayers.length===1 && worstPlayers.length===1 && bestPlayers[0].id !== worstPlayers[0].id){
          bs.glitchTriggered = true;
          glitchEvent = {type:"glitch_lider", best: bestPlayers[0].id, worst: worstPlayers[0].id,
            bestScore: bestVal, worstScore: worstVal};
        }
        // if tie, we simply skip (no retrigger) — counts as consumed slot per simplification
      }
    }

    if(swapEvent && (swapEvent.type==="swap_single" || swapEvent.type==="swap_tie")){
      bs.anyValidSwapHappened = true;
    }

    // queue events in a sensible order: forced > robo > glitch > swap-companion-pick
    const queue = [];
    if(roboEvent) queue.push(roboEvent);
    if(glitchEvent) queue.push(glitchEvent);
    if(forcedEvent) queue.push(forcedEvent);
    if(swapEvent && !forcedEvent) queue.push(swapEvent); // forced already includes its own swap resolution

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
      // apply swap of that hole's scores between a and b
      const pa = state.players.find(p=>p.id===ev.a);
      const pb = state.players.find(p=>p.id===ev.b);
      const delta = ev.bScore - ev.aScore;
      pa.total += delta;
      pb.total -= delta;
      playSiren();
      state.blockState.log.push(`Hoyo ${currentHoleNumber()}: Robo de Identidad entre ${pa.name} y ${pb.name}.`);
    } else if(ev.type === "glitch_lider"){
      const pb = state.players.find(p=>p.id===ev.best);
      const pw = state.players.find(p=>p.id===ev.worst);
      const delta = ev.worstScore - ev.bestScore;
      pb.total += delta;
      pw.total -= delta;
      playSiren();
      state.blockState.log.push(`Hoyo ${currentHoleNumber()}: Glitch del Líder invierte a ${pb.name} y ${pw.name}.`);
    } else if(ev.type === "swap_single" || ev.type === "swap_tie"){
      playChime();
    } else if(ev.type === "forced_swap_robo"){
      playSiren();
    } else if(ev.type === "forced_none"){
      state.blockState.log.push(`Hoyo ${currentHoleNumber()}: hoyo forzado sin Birdie — no hay Robo de Identidad este bloque.`);
    }
    render();
  }

  function resolveCompanionChoice(mainPid, companionPid, reciprocal){
    // sets swapNextHole to apply starting NEXT hole processed
    state.blockState.swapActive = null;
    state._pendingSwapForNext = {a: mainPid, b: companionPid, reciprocal: !!reciprocal};
    continueFromEvent();
  }

  function resolveForced(mainPid, companionPid){
    // applies swap+robo immediately on THIS hole
    const bs = state.blockState;
    bs.robTriggered = true;
    bs.anyValidSwapHappened = true;
    const pa = state.players.find(p=>p.id===mainPid);
    const pb = state.players.find(p=>p.id===companionPid);
    const scoreA = state.holeScores[mainPid];
    const scoreB = state.holeScores[companionPid];
    const delta = scoreB - scoreA;
    pa.total += delta;
    pb.total -= delta;
    bs.log.push(`Hoyo ${currentHoleNumber()}: hoyo forzado — combo Shuffle de Discos + Robo de Identidad entre ${pa.name} y ${pb.name}.`);
    continueFromEvent();
  }

  function continueFromEvent(){
    processNextEvent();
  }

  function advanceAfterHole(){
    // apply any pending swap decided this hole to be active NEXT hole
    if(state._pendingSwapForNext){
      state.blockState.swapNextHole = state._pendingSwapForNext;
      state._pendingSwapForNext = null;
    }
    state.blockState.swapActive = state.blockState.swapNextHole;
    state.blockState.swapNextHole = null;

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
    else if(state.screen === "scoring") html += renderScoring();
    else if(state.screen === "leaderboardBlock") html += renderBlockLeaderboard();
    else if(state.screen === "finalBoard") html += renderFinalBoard();
    html += `</main>`;
    if(state.screen !== "setup") html += renderScoreboardFooterToggle();
    app.innerHTML = html;
    attachHandlers();
    if(state.pendingEvent){
      renderGlitchOverlay();
    }
  }

  function renderTopbar(){
    const frontActive = state.block === "front";
    const backActive = state.block === "back";
    return `
    <header class="topbar">
      <div class="brand"><span style="color:var(--text);">CHAOS</span> <span style="color:var(--lime);">DISC</span><span style="display:inline-flex;margin:0 -1px;">${basketLogo()}</span><span style="color:var(--lime);">GOLF</span></div>
      <div style="display:flex;gap:6px;">
        <div class="block-pill ${frontActive?'active':''}">FRONT 9</div>
        <div class="block-pill ${backActive?'active':''}">BACK 9</div>
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
        <p class="sub">Agrega a los jugadores de la card. El sistema baraja los hoyos y decide cuándo saltan los glitches.</p>
        <div class="card">
          ${rows}
          <button class="btn-ghost" id="addPlayer">+ Agregar jugador</button>
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
              </div>
            </div>`).join("")}
        </div>
      </div>`;
    return `
      <div class="screen">
        <div class="eyebrow">Configurar campo</div>
        <h1 class="title">¿Qué hoyos son par 4?</h1>
        <p class="sub">Por default todos son par 3. Marca los que sean par 4 — así el sistema calcula Birdie/Bogey correcto sin importar el campo.</p>
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
    return `
      <div class="screen reveal-wrap">
        <div class="reveal-label">Hoyo ${pos} de 9 · ${state.block==='front'?'Front':'Back'} 9</div>
        <div class="reveal-num ${state.revealAnimating?'glitching':''}" id="revealNum">${holeNum}</div>
        <div class="block-pill" style="margin-top:8px;">PAR ${par}</div>
        <div class="progress-dots">${dots}</div>
        <p class="center-note">Siguiente destino del shuffle. Caminen al hoyo ${holeNum}.</p>
      </div>
      <footer class="bottombar">
        <button class="btn-primary" id="toScoring">Jugar este hoyo</button>
      </footer>
    `;
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
    return `
      <div class="screen">
        <div class="eyebrow">${state.block==='front'?'Front 9':'Back 9'} completado</div>
        <h1 class="title">Así va el marcador</h1>
        ${renderScoreboardCard()}
        ${state.blockState.log.length ? `<div class="card"><div class="eyebrow" style="margin-bottom:8px;">Eventos de este bloque</div><div class="log-list">${state.blockState.log.map(l=>`· ${l}`).join("<br>")}</div></div>` : ""}
      </div>
      <footer class="bottombar">
        ${bothDone
          ? `<button class="btn-primary" id="toFinal">Ver marcador final</button>`
          : `<button class="btn-primary" id="startOther">Iniciar ${other==='front'?'Front':'Back'} 9</button>`}
      </footer>
    `;
  }

  function renderFinalBoard(){
    const sorted = state.players.slice().sort((a,b)=>a.total-b.total);
    const winner = sorted[0];
    return `
      <div class="screen">
        <div class="eyebrow">Ronda completa · 18 hoyos</div>
        <h1 class="title">🏆 ${winner.name} se lleva la card</h1>
        ${renderScoreboardCard()}
      </div>
      <footer class="bottombar">
        <button class="btn-primary" id="newRound">Jugar otra ronda</button>
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
        <div class="sb-name"><span class="sb-rank">${i+1}</span>${p.name}</div>
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

    if(ev.type === "robo"){
      const pa = state.players.find(p=>p.id===ev.a), pb = state.players.find(p=>p.id===ev.b);
      title = "🚨 ¡ROBO DE IDENTIDAD!";
      desc = `Los golpes de este hoyo se intercambian entre <b>${pa.name}</b> y <b>${pb.name}</b>. Solo afecta este hoyo.`;
    } else if(ev.type === "glitch_lider"){
      const pb = state.players.find(p=>p.id===ev.best), pw = state.players.find(p=>p.id===ev.worst);
      title = "🚨 ¡GLITCH DEL LÍDER!";
      desc = `Se invierte el mejor y el peor resultado del hoyo entre <b>${pb.name}</b> y <b>${pw.name}</b>.`;
    } else if(ev.type === "swap_single"){
      const pMain = state.players.find(p=>p.id===ev.birdie);
      const options = state.players.filter(p=>p.id!==ev.birdie);
      title = "🔄 ¡SHUFFLE DE DISCOS!";
      desc = `<b>${pMain.name}</b> hizo Birdie en solitario. Elige con quién intercambia disco para el siguiente hoyo.`;
      bodyExtra = `<select class="pick" id="companionPick">${options.map(o=>`<option value="${o.id}">${o.name}</option>`).join("")}</select>`;
      cta = "Confirmar intercambio";
    } else if(ev.type === "swap_tie"){
      const pMain = state.players.find(p=>p.id===ev.birdie);
      const options = state.players.filter(p=>p.id!==ev.birdie);
      title = "🔄 ¡SHUFFLE DE DISCOS (empate)!";
      desc = `Hubo empate de Birdie y el sistema eligió a <b>${pMain.name}</b>. Elige compañero — el intercambio será recíproco.`;
      bodyExtra = `<select class="pick" id="companionPick">${options.map(o=>`<option value="${o.id}">${o.name}</option>`).join("")}</select>`;
      cta = "Confirmar intercambio";
    } else if(ev.type === "forced_swap_robo"){
      const pMain = state.players.find(p=>p.id===ev.birdie);
      const options = state.players.filter(p=>p.id!==ev.birdie);
      title = "🚨 ¡HOYO FORZADO!";
      desc = `Sin Shuffle de Discos válido en el bloque, <b>${pMain.name}</b> hizo el Birdie de cierre. Se dispara Shuffle de Discos + Robo de Identidad en este mismo hoyo. Elige compañero:`;
      bodyExtra = `<select class="pick" id="companionPick">${options.map(o=>`<option value="${o.id}">${o.name}</option>`).join("")}</select>`;
      cta = "Aplicar combo";
    } else if(ev.type === "forced_none"){
      title = "Hoyo de cierre sin Birdie";
      desc = `Nadie hizo Birdie en el hoyo forzado — este bloque se queda sin Robo de Identidad.`;
    }

    const overlay = document.createElement("div");
    overlay.className = "glitch-overlay";
    overlay.innerHTML = `
      <div class="glitch-card">
        <div class="glitch-siren">🚨</div>
        <div class="glitch-title">${title}</div>
        <div class="glitch-desc">${desc}</div>
        ${bodyExtra}
        <button class="btn-primary" id="glitchContinue" style="margin-top:${bodyExtra?'14px':'0'};">${cta}</button>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById("glitchContinue").addEventListener("click", ()=>{
      document.body.removeChild(overlay);
      if(ev.type === "swap_single"){
        const comp = document.getElementById("companionPick").value;
        resolveCompanionChoice(ev.birdie, comp, false);
      } else if(ev.type === "swap_tie"){
        const comp = document.getElementById("companionPick").value;
        resolveCompanionChoice(ev.birdie, comp, true);
      } else if(ev.type === "forced_swap_robo"){
        const comp = document.getElementById("companionPick").value;
        resolveForced(ev.birdie, comp);
      } else {
        continueFromEvent();
      }
    });
  }

  function attachHandlers(){
    const addBtn = document.getElementById("addPlayer");
    if(addBtn) addBtn.addEventListener("click", ()=>{
      state.players.push({id:uid(), name:"", total:0, holes:[]});
      render();
    });
    document.querySelectorAll("[data-pidx]").forEach(inp=>{
      inp.addEventListener("input", (e)=>{
        state.players[+e.target.dataset.pidx].name = e.target.value;
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
      startBlock("front");
    });

    const toScoring = document.getElementById("toScoring");
    if(toScoring) toScoring.addEventListener("click", goToScoring);

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

    const newRound = document.getElementById("newRound");
    if(newRound) newRound.addEventListener("click", ()=>{
      const freshPars = {};
      for(let h=1;h<=18;h++){ freshPars[h]=3; }
      state = {
        screen:"setup", players:[], pars:freshPars, block:null, blockOrder:[], blockIndex:0, blockState:null,
        holeScores:{}, pendingEvent:null, log:[], showLog:false, revealAnimating:false,
        finalBlockDone:{front:false, back:false},
      };
      render();
    });
  }

  // init with 4 empty player slots
  state.players = [0,1,2,3].map(()=>({id:uid(), name:"", total:0, holes:[]}));
  for(let h=1;h<=18;h++){ state.pars[h] = 3; }
  render();
})();
