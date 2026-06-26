// ── office.js  ── pixel-art 2D office renderer ──────────────────────────────

const TILE = 32; // pixels per tile

// office map (0=floor, 1=wall, 2=window-wall, 3=desk, 4=chair, 5=meeting-table, 6=plant, 7=server, 8=whiteboard)
const MAP = [
  [1,1,1,1,1,1,1,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,3,3,0,3,3,0,0,8,8,8,0,0,3,3,0,3,3,0,0,6,0,1],
  [1,0,4,0,0,4,0,0,0,0,0,0,0,0,4,0,0,4,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,3,3,0,3,3,0,0,0,5,5,5,0,0,3,3,0,3,3,0,0,0,1],
  [1,0,4,0,0,4,0,0,0,0,5,5,5,0,0,4,0,0,4,0,0,6,0,1],
  [1,0,0,0,0,0,0,0,0,0,5,5,5,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,3,3,0,3,3,0,0,0,0,0,0,0,0,3,3,0,3,3,0,0,0,1],
  [1,0,4,0,0,4,0,0,0,0,0,0,0,0,0,4,0,0,4,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,7,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

const COLS = MAP[0].length;
const ROWS = MAP.length;

let canvas, ctx, offW, offH, scale;
let animFrame;

// ─── Desk positions per agent (tile coords: {x,y,facing})
const DESK_POSITIONS = {
  plan0:  {tx:2, ty:2, fx:1, fy:0},
  plan1:  {tx:5, ty:2, fx:1, fy:0},
  plan2:  {tx:2, ty:5, fx:1, fy:0},
  sales0: {tx:5, ty:5, fx:1, fy:0},
  sales1: {tx:14,ty:2, fx:1, fy:0},
  sales2: {tx:17,ty:2, fx:1, fy:0},
  mkt0:   {tx:14,ty:5, fx:1, fy:0},
  mkt1:   {tx:17,ty:5, fx:1, fy:0},
  mkt2:   {tx:14,ty:8, fx:1, fy:0},
  cont0:  {tx:17,ty:8, fx:1, fy:0},
  cont1:  {tx:2, ty:8, fx:1, fy:0},
  cont2:  {tx:5, ty:8, fx:1, fy:0},
};

// meeting table center (tile)
const MEETING_CENTER = {tx:11, ty:6};
const MEETING_SPOTS = [
  {tx:10,ty:5},{tx:11,ty:5},{tx:12,ty:5},
  {tx:10,ty:7},{tx:11,ty:7},{tx:12,ty:7},
  {tx:9, ty:6},{tx:13,ty:6},
];

// ─── Agent visual state
window.agentStates = {};

function initAgentStates() {
  Object.entries(DESK_POSITIONS).forEach(([id, pos]) => {
    agentStates[id] = {
      x: pos.tx * TILE + TILE/2,
      y: pos.ty * TILE + TILE/2,
      tx: pos.tx * TILE + TILE/2,
      ty: pos.ty * TILE + TILE/2,
      homeX: pos.tx * TILE + TILE/2,
      homeY: pos.ty * TILE + TILE/2,
      frame: 0, frameTimer: 0,
      facing: 'down',
      state: 'idle',  // idle | walking | working | meeting | thinking
      speechText: '',
      speechTimer: 0,
      color: AGENT_COLORS[id] || '#aaa',
      label: (AGENTS_DATA.find(a=>a.id===id)||{short:'??'}).short,
    };
  });
}

const AGENT_COLORS = {
  plan0:'#7eb3ff', plan1:'#5a9ae6', plan2:'#4488cc',
  sales0:'#6dcc8f', sales1:'#4db870', sales2:'#3a9a5c',
  mkt0:'#f5c842',  mkt1:'#d4a830', mkt2:'#b88c20',
  cont0:'#f07ab0', cont1:'#d45e8e', cont2:'#b84070',
};

// ─── Canvas setup
function setupCanvas() {
  canvas = document.getElementById('officeCanvas');
  ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  const wrap = document.getElementById('officeWrap');
  offW = wrap.clientWidth;
  offH = wrap.clientHeight;
  scale = Math.max(1, Math.floor(Math.min(offW/(COLS*TILE), offH/(ROWS*TILE))));
  canvas.width  = COLS * TILE * scale;
  canvas.height = ROWS * TILE * scale;
  canvas.style.width  = canvas.width  + 'px';
  canvas.style.height = canvas.height + 'px';
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

// ─── Draw helpers
function px(x){ return Math.floor(x); }

function drawTile(x,y,color,shade){
  ctx.fillStyle = color;
  ctx.fillRect(px(x*TILE), px(y*TILE), TILE, TILE);
  if(shade){
    ctx.fillStyle = shade;
    ctx.fillRect(px(x*TILE), px(y*TILE), TILE, 2);
    ctx.fillRect(px(x*TILE), px(y*TILE), 2, TILE);
  }
}

function drawFloor(x,y){
  const checker = (x+y)%2===0;
  drawTile(x,y, checker?'#2d4a3e':'#324f43');
  ctx.fillStyle = '#ffffff08';
  ctx.fillRect(px(x*TILE+1), px(y*TILE+1), TILE-2, TILE-2);
}

function drawWall(x,y){
  drawTile(x,y,'#1e3a5f','#2a4f7a');
  // brick lines
  ctx.fillStyle = '#15305299';
  const off = y%2===0 ? 0 : TILE/2;
  ctx.fillRect(px(x*TILE), py(y*TILE+8), TILE, 1);
  ctx.fillRect(px(x*TILE), py(y*TILE+16), TILE, 1);
  ctx.fillRect(px(x*TILE), py(y*TILE+24), TILE, 1);
  ctx.fillRect(px(x*TILE + off + TILE/2), py(y*TILE), 1, TILE);
}

function py(v){ return Math.floor(v); }

function drawWindow(x,y){
  drawTile(x,y,'#1e3a5f');
  ctx.fillStyle = '#7ec8e3aa';
  ctx.fillRect(px(x*TILE+4), px(y*TILE+4), TILE-8, TILE-8);
  ctx.fillStyle = '#ffffff44';
  ctx.fillRect(px(x*TILE+4), px(y*TILE+4), (TILE-8)/2-1, TILE-8);
  ctx.fillStyle = '#1e3a5f';
  ctx.fillRect(px(x*TILE+TILE/2-1), px(y*TILE+4), 2, TILE-8);
  ctx.fillRect(px(x*TILE+4), px(y*TILE+TILE/2-1), TILE-8, 2);
}

function drawDesk(x,y){
  drawFloor(x,y);
  ctx.fillStyle = '#8b5e3c';
  ctx.fillRect(px(x*TILE+2), px(y*TILE+8), TILE-4, TILE-10);
  ctx.fillStyle = '#a0714f';
  ctx.fillRect(px(x*TILE+2), px(y*TILE+8), TILE-4, 4);
  // monitor
  ctx.fillStyle = '#111';
  ctx.fillRect(px(x*TILE+6), px(y*TILE+10), 12, 8);
  ctx.fillStyle = '#00ff8888';
  ctx.fillRect(px(x*TILE+7), px(y*TILE+11), 10, 6);
}

function drawChair(x,y){
  drawFloor(x,y);
  ctx.fillStyle = '#4a3728';
  ctx.fillRect(px(x*TILE+8), px(y*TILE+14), 16, 12);
  ctx.fillStyle = '#5c4535';
  ctx.fillRect(px(x*TILE+8), px(y*TILE+10), 16, 6);
}

function drawMeetingTable(x,y){
  drawFloor(x,y);
  ctx.fillStyle = '#5a3e28';
  ctx.fillRect(px(x*TILE+2), px(y*TILE+4), TILE-4, TILE-8);
  ctx.fillStyle = '#7a5535';
  ctx.fillRect(px(x*TILE+2), px(y*TILE+4), TILE-4, 3);
  // shine
  ctx.fillStyle = '#ffffff11';
  ctx.fillRect(px(x*TILE+4), px(y*TILE+6), 8, 2);
}

function drawPlant(x,y){
  drawFloor(x,y);
  ctx.fillStyle = '#5a3e0a';
  ctx.fillRect(px(x*TILE+12), px(y*TILE+22), 8, 8);
  ctx.fillStyle = '#1a6e2a';
  ctx.fillRect(px(x*TILE+8),  px(y*TILE+14), 16, 10);
  ctx.fillStyle = '#22882e';
  ctx.fillRect(px(x*TILE+10), px(y*TILE+10), 12, 8);
  ctx.fillStyle = '#2aa03a';
  ctx.fillRect(px(x*TILE+12), px(y*TILE+8), 8, 6);
}

function drawServer(x,y){
  drawFloor(x,y);
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(px(x*TILE+4), px(y*TILE+2), TILE-8, TILE-4);
  ctx.fillStyle = '#333';
  for(let r=0;r<4;r++){
    ctx.fillRect(px(x*TILE+6), px(y*TILE+4+r*6), TILE-12, 4);
  }
  ctx.fillStyle = '#00ff88';
  for(let r=0;r<4;r++){
    ctx.fillRect(px(x*TILE+TILE-10), px(y*TILE+5+r*6), 3, 3);
  }
}

function drawWhiteboard(x,y){
  drawFloor(x,y);
  ctx.fillStyle = '#dde';
  ctx.fillRect(px(x*TILE+2), px(y*TILE+2), TILE-4, TILE-6);
  ctx.fillStyle = '#333';
  ctx.fillRect(px(x*TILE+2), px(y*TILE+2), TILE-4, 3);
  // scribbles
  ctx.strokeStyle = '#4488ff66';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px(x*TILE+4), px(y*TILE+10));
  ctx.lineTo(px(x*TILE+20), px(y*TILE+14));
  ctx.lineTo(px(x*TILE+14), px(y*TILE+20));
  ctx.stroke();
  ctx.fillStyle = '#ff444466';
  ctx.fillRect(px(x*TILE+6), px(y*TILE+8), 8, 2);
}

function drawOffice(){
  for(let y=0;y<ROWS;y++){
    for(let x=0;x<COLS;x++){
      const t = MAP[y][x];
      switch(t){
        case 0: drawFloor(x,y); break;
        case 1: drawWall(x,y); break;
        case 2: drawWindow(x,y); break;
        case 3: drawDesk(x,y); break;
        case 4: drawChair(x,y); break;
        case 5: drawMeetingTable(x,y); break;
        case 6: drawPlant(x,y); break;
        case 7: drawServer(x,y); break;
        case 8: drawWhiteboard(x,y); break;
      }
    }
  }
}

// ─── Agent sprite (pixel character)
function drawAgent(id){
  const s = agentStates[id];
  if(!s) return;
  const x = px(s.x - 8);
  const y = px(s.y - 18);
  const c = s.color;
  const bobY = (s.state==='walking') ? Math.sin(s.frame*0.4)*2 : 0;
  const yy = y + bobY;

  // shadow
  ctx.fillStyle = '#00000055';
  ctx.fillRect(px(s.x-7), px(s.y+2), 14, 4);

  // body (shirt)
  const bodyColor = s.state==='meeting'?c+'dd':s.state==='thinking'?'#ffdd00':c+'99';
  ctx.fillStyle = bodyColor;
  ctx.fillRect(px(x+3), py(yy+8), 10, 9);

  // arms
  const armSwing = s.state==='walking' ? Math.sin(s.frame*0.4)*3 : 0;
  ctx.fillStyle = bodyColor;
  ctx.fillRect(px(x+1),  py(yy+8+armSwing), 3, 7);
  ctx.fillRect(px(x+12), py(yy+8-armSwing), 3, 7);

  // legs
  const legL = s.state==='walking' ? Math.sin(s.frame*0.4)*3 : 0;
  ctx.fillStyle = '#222244';
  ctx.fillRect(px(x+4), py(yy+17), 4, 5+legL);
  ctx.fillRect(px(x+8), py(yy+17), 4, 5-legL);

  // shoes
  ctx.fillStyle = '#111';
  ctx.fillRect(px(x+3), py(yy+22+legL), 5, 3);
  ctx.fillRect(px(x+8), py(yy+22-legL), 5, 3);

  // head
  ctx.fillStyle = '#f4c88e';
  ctx.fillRect(px(x+4), py(yy+1), 8, 8);

  // hair
  ctx.fillStyle = c;
  ctx.fillRect(px(x+4), py(yy+1), 8, 3);

  // eyes
  ctx.fillStyle = '#222';
  if(s.state==='thinking'){
    // swirly eyes
    ctx.fillRect(px(x+5), py(yy+4), 2, 2);
    ctx.fillRect(px(x+9), py(yy+4), 2, 2);
    ctx.fillStyle = '#ffdd00';
    ctx.fillRect(px(x+6), py(yy+3), 1, 1);
    ctx.fillRect(px(x+10),py(yy+3), 1, 1);
  } else {
    ctx.fillRect(px(x+5), py(yy+4), 2, 2);
    ctx.fillRect(px(x+9), py(yy+4), 2, 2);
  }

  // mouth
  ctx.fillStyle = s.state==='meeting' ? '#ff6666' : '#c8785a';
  ctx.fillRect(px(x+6), py(yy+7), 4, 1);

  // name tag
  ctx.fillStyle = '#000000aa';
  ctx.fillRect(px(s.x-10), py(s.y+6), 20, 8);
  ctx.fillStyle = c;
  ctx.font = '5px "Press Start 2P"';
  ctx.textAlign = 'center';
  ctx.fillText(s.label, px(s.x), py(s.y+12));
  ctx.textAlign = 'left';

  // activity icon
  if(s.state==='working'){
    ctx.fillStyle = '#00ff88';
    ctx.font = '6px monospace';
    ctx.fillText('⚡', px(x+14), py(yy));
  } else if(s.state==='meeting'){
    ctx.fillStyle = '#ffd700';
    ctx.font = '6px monospace';
    ctx.fillText('💬', px(x+14), py(yy));
  }
}

// ─── Main render loop
function renderLoop(ts){
  if(!ctx) return;
  ctx.clearRect(0, 0, COLS*TILE, ROWS*TILE);

  drawOffice();

  // update & draw agents
  Object.keys(agentStates).forEach(id => {
    const s = agentStates[id];
    // move toward target
    const dx = s.tx - s.x, dy = s.ty - s.y;
    const dist = Math.sqrt(dx*dx+dy*dy);
    if(dist > 1.5){
      const spd = 1.8;
      s.x += (dx/dist)*spd;
      s.y += (dy/dist)*spd;
      s.state = (s.state!=='meeting') ? 'walking' : s.state;
      s.frameTimer++;
      if(s.frameTimer>3){ s.frame++; s.frameTimer=0; }
      // facing
      if(Math.abs(dx)>Math.abs(dy)) s.facing = dx>0?'right':'left';
      else s.facing = dy>0?'down':'up';
    } else {
      if(s.state==='walking') s.state='idle';
    }
    // speech bubble timer
    if(s.speechTimer > 0){
      s.speechTimer--;
      if(s.speechTimer===0) s.speechText='';
    }
    drawAgent(id);
  });

  animFrame = requestAnimationFrame(renderLoop);
}

// ─── Speech bubbles (DOM overlay, scales with canvas)
function showSpeech(agentId, text, duration=4000, isThinking=false){
  const s = agentStates[agentId];
  if(!s) return;
  const layer = document.getElementById('bubblesLayer');
  // remove existing bubble for this agent
  const old = document.getElementById('bubble_'+agentId);
  if(old) old.remove();

  const bx = (s.x * scale / canvas.width)  * 100;
  const by = ((s.y - 28) * scale / canvas.height) * 100;

  const div = document.createElement('div');
  div.className = 'bubble' + (isThinking?' thinking':'');
  div.id = 'bubble_'+agentId;
  div.style.left = bx+'%';
  div.style.top  = by+'%';

  const short = (text||'').length > 60 ? text.slice(0,58)+'…' : (text||'');
  div.innerHTML = `<div class="bname">${(AGENTS_DATA.find(a=>a.id===agentId)||{name:'?'}).name}</div>`
    + (isThinking ? `<span class="dots">...</span>` : short);
  layer.appendChild(div);

  setTimeout(()=>{ if(div.parentNode) div.remove(); }, duration);
}

function clearAllBubbles(){
  document.getElementById('bubblesLayer').innerHTML='';
}

// ─── Move agent to meeting table
function moveToMeeting(agentId, slotIndex){
  const spot = MEETING_SPOTS[slotIndex % MEETING_SPOTS.length];
  const s = agentStates[agentId];
  if(!s) return;
  s.tx = spot.tx * TILE + TILE/2;
  s.ty = spot.ty * TILE + TILE/2;
  s.state = 'meeting';
}

// ─── Return agent to desk
function moveToDesk(agentId){
  const s = agentStates[agentId];
  const pos = DESK_POSITIONS[agentId];
  if(!s||!pos) return;
  s.tx = pos.tx * TILE + TILE/2;
  s.ty = pos.ty * TILE + TILE/2;
  s.state = 'walking';
  setTimeout(()=>{ if(s.state!=='meeting') s.state='idle'; }, 2000);
}

// ─── Init
window.initOffice = function(){
  setupCanvas();
  initAgentStates();
  animFrame = requestAnimationFrame(renderLoop);
};
