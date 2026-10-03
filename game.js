(() => {
  'use strict';

  if (!window.Matter) {
    document.body.innerHTML = '<div style="font:16px system-ui;background:#0b0f16;color:white;min-height:100vh;display:grid;place-items:center;padding:30px;text-align:center">Mechyard could not load the physics engine. Check your connection and reload once; after the first successful load the PWA cache can keep it available.</div>';
    return;
  }

  const { Engine, World, Bodies, Body, Constraint, Composite, Events, Query, Vector } = Matter;
  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const stage = document.getElementById('stageWrap');
  const engine = Engine.create({ enableSleeping: true, positionIterations: 10, velocityIterations: 8, constraintIterations: 5 });
  engine.gravity.y = 1;
  engine.gravity.scale = 0.001;

  const state = {
    tool: 'select',
    spawnKey: 'beam',
    category: 'structure',
    selected: null,
    toolFirst: null,
    dragging: false,
    dragConstraint: null,
    pointerDown: null,
    panStart: null,
    camera: { x: 0, y: 20, zoom: 1 },
    pointers: new Map(),
    pinch: null,
    paused: false,
    timeScale: 1,
    showJoints: true,
    showColliders: true,
    snap: false,
    map: 'hangar',
    music: false,
    sfx: true,
    history: [],
    historyIndex: -1,
    isLoading: false,
    fps: 60,
    frameTimes: [],
    lastFrame: performance.now(),
    lastRotationBucket: null
  };

  const special = {
    pistons: [],
    boundaries: [],
    gravityCores: [],
    sliders: [],
  };

  const colors = {
    steel: '#758399', darkSteel: '#3c485a', plate: '#56687e', armor: '#2d3949', joint: '#88ddff',
    accent: '#75d4ff', green: '#b6ff83', danger: '#ff6d7a', yellow: '#f4de4c', pale: '#d7cb66',
    buttonOff: '#5a687c', buttonOn: '#a7f876', collider: 'rgba(95,211,255,.12)'
  };

  const categories = {
    structure: [
      ['beam','Beam','Rigid steel frame'], ['longbeam','Long Beam','Long chassis rail'], ['plate','Plate','Wide armor plate'],
      ['armor','Heavy Armor','Dense impact panel'], ['box','Crate','Basic physics box'], ['circle','Round Plate','Circular structural part']
    ],
    motion: [
      ['wheel','Wheel','Free-spinning wheel'], ['motorwheel','Motor Wheel','Powered drive wheel'], ['piston','Piston','Powered linear actuator'],
      ['gyro','Gyroscope','Active stabilization'], ['thruster','Thruster','Powered directional force'], ['rotor','Rotor','High-speed powered rotor']
    ],
    logic: [
      ['button','Toggle Button','Wire to powered parts'], ['pressure','Pressure Pad','Triggers when hit'], ['timer','Pulse Timer','Cycles linked power'],
      ['gravitycore','Gravity Core','Local gravity control']
    ],
    utility: [
      ['collider','Collider','Invisible-style collision block'], ['dummy','Ragdoll Dummy','Jointed test dummy'], ['ballast','Ballast','Very heavy compact mass'],
      ['balloon','Lift Cell','Buoyant lift module'], ['magnet','Magnet','Attracts nearby metal']
    ],
    characters: [
      ['dummy','Ragdoll Dummy','Jointed physics character'], ['bot','Mech Pilot','Small armored ragdoll'], ['cratebot','Box Bot','Compact mechanical dummy']
    ]
  };

  const MOD_BASE = [
    {
      id:'verity', title:'Verity', author:'Workshop Featured', spawnKey:'mod_verity', rarity:'FEATURED',
      desc:'A small yellow smiling helper sphere inspired by the Verity character. This Mechyard version uses original vector art and sandbox behavior: it hovers, self-stabilizes and survives heavy impacts.',
      features:['Hovering companion','Self-stabilizing','Very high durability','Original vector rendering'], art:'verity'
    },
    {
      id:'verity_monster', title:'Verity Monster', author:'Workshop Featured', spawnKey:'mod_verity_monster', rarity:'FEATURED',
      desc:'A tall hostile-looking yellow ragdoll based on the later monster/anomaly interpretation of Verity. It has a heavy articulated body, long limbs and an unsettling black face built entirely from original game shapes.',
      features:['Large ragdoll','Long articulated limbs','Heavy joints','High durability'], art:'monster'
    }
  ];

  const ROTATING_POOL = [
    {id:'crawler_pack',title:'Crawler Rig Pack',spawnKey:'mod_crawler',desc:'A six-link mechanical crawler with powered wheels and stabilizers.',features:['Prebuilt machine','Motorized','Gyro assisted']},
    {id:'skyhook',title:'Skyhook Module',spawnKey:'mod_skyhook',desc:'A lightweight lift frame with twin thrusters and a center attachment point.',features:['Twin thrusters','Light frame','Air builds']},
    {id:'crusher_frame',title:'Crusher Frame',spawnKey:'mod_crusher',desc:'A reinforced piston frame designed for moving heavy assemblies.',features:['Dual pistons','Heavy armor','Machine frame']},
    {id:'orbital_wheel',title:'Orbital Wheel',spawnKey:'mod_orbital',desc:'A giant powered wheel with a protected inner hub.',features:['Large wheel','Powered hub','Heavy duty']},
    {id:'spider_core',title:'Spider Core',spawnKey:'mod_spider',desc:'A low-profile multi-limb chassis for experimental walkers.',features:['Walker base','Jointed limbs','Wide stance']},
    {id:'cargo_drone',title:'Cargo Drone',spawnKey:'mod_drone',desc:'A hovering platform tuned for lifting and moving builds.',features:['Lift cells','Thrusters','Stable platform']},
    {id:'shock_lab',title:'Shock Test Kit',spawnKey:'mod_shock',desc:'A test sled with springs, ballast and impact plates.',features:['Springs','Ballast','Impact testing']},
    {id:'micro_mech',title:'Micro Mech',spawnKey:'mod_micro',desc:'A tiny two-leg mech starter with a gyro core and motorized feet.',features:['Starter mech','Gyroscope','Compact']}
  ];

  const installedMods = new Set(JSON.parse(localStorage.getItem('mechyard.installedMods') || '[]'));

  const spawnDefs = {
    beam: { shape:'rect', w:110,h:18, color:colors.steel, density:.003, name:'Beam', kind:'metal' },
    longbeam: { shape:'rect', w:210,h:18, color:'#6d7d92', density:.003, name:'Long Beam', kind:'metal' },
    plate: { shape:'rect', w:92,h:58, color:colors.plate, density:.0032, name:'Plate', kind:'metal' },
    armor: { shape:'rect', w:112,h:70, color:colors.armor, density:.007, name:'Heavy Armor', kind:'metal' },
    box: { shape:'rect', w:62,h:62, color:'#725842', density:.002, name:'Crate', kind:'wood' },
    circle: { shape:'circle', r:34, color:'#687c92', density:.0032, name:'Round Plate', kind:'metal' },
    wheel: { shape:'circle', r:36, color:'#202832', density:.003, friction:.9, name:'Wheel', kind:'rubber', wheel:true },
    motorwheel: { shape:'circle', r:38, color:'#25303b', density:.004, friction:1.1, name:'Motor Wheel', kind:'rubber', poweredType:'motor', active:false, wheel:true },
    gyro: { shape:'circle', r:30, color:'#364d5c', density:.006, name:'Gyroscope', kind:'machine', poweredType:'gyro', active:true, gyro:true },
    thruster: { shape:'rect', w:64,h:34, color:'#384b5e', density:.004, name:'Thruster', kind:'machine', poweredType:'thruster', active:false, thruster:true },
    rotor: { shape:'rect', w:110,h:12, color:'#8797aa', density:.002, name:'Rotor', kind:'metal', poweredType:'rotor', active:false, rotor:true },
    button: { shape:'rect', w:46,h:26, color:colors.buttonOff, density:.004, name:'Toggle Button', kind:'logic', toggleSource:true, active:false, linkedIds:[] },
    pressure: { shape:'rect', w:76,h:14, color:'#566474', density:.005, name:'Pressure Pad', kind:'logic', pressure:true, linkedIds:[] },
    timer: { shape:'rect', w:48,h:48, color:'#5a476d', density:.004, name:'Pulse Timer', kind:'logic', timer:true, active:true, linkedIds:[], interval:1200, lastPulse:0 },
    gravitycore: { shape:'circle', r:28, color:'#454974', density:.009, name:'Gravity Core', kind:'machine', poweredType:'gravity', active:false, gravityCore:true },
    collider: { shape:'rect', w:110,h:70, color:'rgba(95,211,255,.13)', density:.001, name:'Collider', kind:'collider', collider:true },
    ballast: { shape:'rect', w:56,h:56, color:'#202630', density:.025, name:'Ballast', kind:'metal' },
    balloon: { shape:'circle', r:40, color:'#6e91a3', density:.0003, name:'Lift Cell', kind:'utility', balloon:true },
    magnet: { shape:'rect', w:54,h:38, color:'#71484d', density:.006, name:'Magnet', kind:'machine', magnet:true, active:true }
  };

  function clonePlugin(o){ return JSON.parse(JSON.stringify(o || {})); }

  function createBasicBody(key, x, y, opts={}) {
    const d = spawnDefs[key];
    if (!d) return null;
    let body;
    const common = {
      friction: d.friction ?? .55, frictionStatic:.7, frictionAir:.01,
      restitution: .08, density: d.density || .003, chamfer: d.shape === 'rect' ? { radius: Math.min(7, (d.h||20)/3) } : undefined
    };
    if (d.shape === 'circle') body = Bodies.circle(x,y,d.r,common);
    else body = Bodies.rectangle(x,y,d.w,d.h,common);
    body.label = d.name;
    body.plugin = Object.assign({}, clonePlugin(d), { spawnKey:key, color:d.color, width:d.w, height:d.h, radius:d.r, noCollide:false }, opts.plugin || {});
    if (d.gyro) body.plugin.targetAngle = 0;
    World.add(engine.world, body);
    if (d.gravityCore) special.gravityCores.push(body);
    return body;
  }

  function attachConstraint(a,b, pointA, pointB, opts={}) {
    const c = Constraint.create({
      bodyA:a || undefined, bodyB:b || undefined,
      pointA: pointA || {x:0,y:0}, pointB: pointB || {x:0,y:0},
      length: opts.length ?? 0, stiffness: opts.stiffness ?? .9, damping: opts.damping ?? .08
    });
    c.plugin = { kind:opts.kind || 'joint', color:opts.color || colors.joint, visible:opts.visible !== false };
    World.add(engine.world,c);
    return c;
  }

  function localPoint(body, worldPoint) {
    const p = Vector.sub(worldPoint, body.position);
    return Vector.rotate(p, -body.angle);
  }

  function worldPoint(body, local) {
    return Vector.add(body.position, Vector.rotate(local, body.angle));
  }

  function createPiston(x,y) {
    const base = Bodies.rectangle(x-22,y,62,34,{density:.006,friction:.6,chamfer:{radius:7}});
    const rod = Bodies.rectangle(x+28,y,54,14,{density:.003,friction:.35,chamfer:{radius:6}});
    base.label='Piston Base'; rod.label='Piston Rod';
    base.plugin={spawnKey:'piston_base',kind:'machine',color:'#354657',width:62,height:34,name:'Piston',poweredType:'piston',active:false,pistonBase:true};
    rod.plugin={spawnKey:'piston_rod',kind:'metal',color:'#a3b0bf',width:54,height:14,name:'Piston Rod',pistonRod:true,controllerBaseId:base.id};
    World.add(engine.world,[base,rod]);
    const guide = attachConstraint(base,rod,{x:16,y:0},{x:-20,y:0},{length:18,stiffness:.3,damping:.25,kind:'pistonGuide',visible:false});
    special.pistons.push({base,rod,guide,extension:8,min:8,max:78,speed:1.1});
    return base;
  }

  function createRagdoll(x,y,style='dummy') {
    const comp = Composite.create({label: style==='bot'?'Mech Pilot':'Ragdoll Dummy'});
    const bot = style==='bot';
    const head = Bodies.circle(x,y-56, bot?18:17,{density:.002,restitution:.05,friction:.6});
    const torso = Bodies.rectangle(x,y-18,bot?38:32,56,{density:bot?.005:.0025,chamfer:{radius:8}});
    const la = Bodies.rectangle(x-31,y-18,12,54,{density:.002,chamfer:{radius:5}});
    const ra = Bodies.rectangle(x+31,y-18,12,54,{density:.002,chamfer:{radius:5}});
    const ll = Bodies.rectangle(x-12,y+32,14,60,{density:.0025,chamfer:{radius:5}});
    const rl = Bodies.rectangle(x+12,y+32,14,60,{density:.0025,chamfer:{radius:5}});
    const parts=[head,torso,la,ra,ll,rl];
    const baseColor=bot?'#52677d':'#87a3b2';
    parts.forEach((p,i)=>{p.label=style==='bot'?'Mech Pilot':'Ragdoll Dummy';p.plugin={spawnKey:'ragpart',kind:bot?'machine':'dummy',color:i===0?(bot?'#758da6':'#aec4ce'):baseColor,width:p.circleRadius?undefined:(p.bounds.max.x-p.bounds.min.x),height:p.circleRadius?undefined:(p.bounds.max.y-p.bounds.min.y),radius:p.circleRadius,ragdollStyle:style};});
    Composite.add(comp,parts);
    World.add(engine.world, comp);
    const cs=[
      attachConstraint(torso,head,{x:0,y:-26},{x:0,y:15},{length:1,stiffness:.65,damping:.15,kind:'ragdoll'}),
      attachConstraint(torso,la,{x:-17,y:-17},{x:0,y:-22},{length:1,stiffness:.58,damping:.12,kind:'ragdoll'}),
      attachConstraint(torso,ra,{x:17,y:-17},{x:0,y:-22},{length:1,stiffness:.58,damping:.12,kind:'ragdoll'}),
      attachConstraint(torso,ll,{x:-10,y:25},{x:0,y:-25},{length:1,stiffness:.72,damping:.15,kind:'ragdoll'}),
      attachConstraint(torso,rl,{x:10,y:25},{x:0,y:-25},{length:1,stiffness:.72,damping:.15,kind:'ragdoll'})
    ];
    return torso;
  }

  function createCrateBot(x,y){
    const body=createBasicBody('armor',x,y); body.label='Box Bot'; body.plugin.name='Box Bot'; body.plugin.color='#48596c';
    const eyeL=Bodies.circle(x-16,y-5,5,{density:.001}); const eyeR=Bodies.circle(x+16,y-5,5,{density:.001});
    [eyeL,eyeR].forEach(e=>{e.plugin={spawnKey:'boteye',kind:'logic',color:'#75d4ff',radius:5,name:'Bot Eye'}; World.add(engine.world,e); attachConstraint(body,e,localPoint(body,e.position),{x:0,y:0},{length:0,stiffness:1,damping:.1,kind:'weld',visible:false});});
    return body;
  }

  function createVerity(x,y) {
    const b = Bodies.circle(x,y,31,{density:.0015,frictionAir:.055,restitution:.55,friction:.2});
    b.label='Verity';
    b.plugin={spawnKey:'mod_verity',kind:'verity',color:colors.yellow,radius:31,name:'Verity',verity:true,balloon:true,durability:9999,face:'smile'};
    World.add(engine.world,b);
    return b;
  }

  function createVerityMonster(x,y) {
    const comp=Composite.create({label:'Verity Monster'});
    const head=Bodies.circle(x,y-92,34,{density:.005,friction:.5});
    const torso=Bodies.rectangle(x,y-30,46,96,{density:.009,chamfer:{radius:15}});
    const hip=Bodies.rectangle(x,y+30,42,28,{density:.008,chamfer:{radius:8}});
    const armL=Bodies.rectangle(x-47,y-25,16,105,{density:.004,chamfer:{radius:8}});
    const armR=Bodies.rectangle(x+47,y-25,16,105,{density:.004,chamfer:{radius:8}});
    const legL=Bodies.rectangle(x-16,y+95,18,112,{density:.006,chamfer:{radius:8}});
    const legR=Bodies.rectangle(x+16,y+95,18,112,{density:.006,chamfer:{radius:8}});
    const parts=[head,torso,hip,armL,armR,legL,legR];
    parts.forEach((p,i)=>{p.label='Verity Monster';p.plugin={spawnKey:'veritymonsterpart',kind:'verityMonster',color:i===0?'#d8cb62':'#bcb24f',width:p.circleRadius?undefined:(p.bounds.max.x-p.bounds.min.x),height:p.circleRadius?undefined:(p.bounds.max.y-p.bounds.min.y),radius:p.circleRadius,name:'Verity Monster',durability:9999,monsterHead:i===0};});
    Composite.add(comp,parts);
    World.add(engine.world, comp);
    attachConstraint(torso,head,{x:0,y:-48},{x:0,y:28},{stiffness:.83,damping:.18,kind:'ragdoll'});
    attachConstraint(torso,hip,{x:0,y:46},{x:0,y:-12},{stiffness:.92,damping:.2,kind:'ragdoll'});
    attachConstraint(torso,armL,{x:-23,y:-27},{x:0,y:-46},{stiffness:.68,damping:.12,kind:'ragdoll'});
    attachConstraint(torso,armR,{x:23,y:-27},{x:0,y:-46},{stiffness:.68,damping:.12,kind:'ragdoll'});
    attachConstraint(hip,legL,{x:-14,y:10},{x:0,y:-51},{stiffness:.82,damping:.15,kind:'ragdoll'});
    attachConstraint(hip,legR,{x:14,y:10},{x:0,y:-51},{stiffness:.82,damping:.15,kind:'ragdoll'});
    return torso;
  }

  function createWorkshopMachine(key,x,y){
    const make = (part,dx,dy)=>createBasicBody(part,x+dx,y+dy);
    if(key==='mod_crawler'){
      const base=make('longbeam',0,0), w1=make('motorwheel',-70,35), w2=make('motorwheel',0,35), w3=make('motorwheel',70,35), g=make('gyro',0,-28);
      [w1,w2,w3,g].forEach(p=>attachConstraint(base,p,localPoint(base,p.position),{x:0,y:0},{length:0,stiffness:.92,damping:.18,kind:'weld'})); return base;
    }
    if(key==='mod_skyhook'){
      const base=make('longbeam',0,0), t1=make('thruster',-66,28), t2=make('thruster',66,28), g=make('gyro',0,-24); [t1,t2,g].forEach(p=>{p.plugin.active=true;attachConstraint(base,p,localPoint(base,p.position),{x:0,y:0},{stiffness:.95,damping:.15,kind:'weld'});}); return base;
    }
    if(key==='mod_crusher'){
      const a=make('armor',0,0); const p1=createPiston(x-60,y), p2=createPiston(x+60,y); attachConstraint(a,p1,localPoint(a,p1.position),{x:0,y:0},{stiffness:.94,kind:'weld'}); attachConstraint(a,p2,localPoint(a,p2.position),{x:0,y:0},{stiffness:.94,kind:'weld'}); return a;
    }
    if(key==='mod_orbital'){ const w=Bodies.circle(x,y,82,{density:.006,friction:1});w.label='Orbital Wheel';w.plugin={spawnKey:key,kind:'rubber',color:'#222b36',radius:82,name:'Orbital Wheel',poweredType:'motor',active:true,wheel:true,motorSpeed:.17};World.add(engine.world,w);const hub=make('gyro',0,0);attachConstraint(w,hub,{x:0,y:0},{x:0,y:0},{stiffness:.15,damping:.1,kind:'hinge'});return w; }
    if(key==='mod_spider'){ const base=make('plate',0,0); for(let i=0;i<6;i++){const side=i<3?-1:1, row=i%3;const limb=Bodies.rectangle(x+side*70,y-30+row*30,90,12,{density:.002});limb.plugin={spawnKey:'spiderlimb',kind:'metal',color:'#64768a',width:90,height:12,name:'Spider Limb'};World.add(engine.world,limb);attachConstraint(base,limb,{x:side*42,y:-22+row*22},{x:-side*38,y:0},{stiffness:.75,damping:.12,kind:'hinge'});} return base; }
    if(key==='mod_drone'){ const base=make('plate',0,0); for(const dx of [-42,42]){const t=make('thruster',dx,35);t.plugin.active=true;attachConstraint(base,t,localPoint(base,t.position),{x:0,y:0},{stiffness:.92,kind:'weld'});} const g=make('gyro',0,-40);attachConstraint(base,g,localPoint(base,g.position),{x:0,y:0},{stiffness:.92,kind:'weld'});return base; }
    if(key==='mod_shock'){ const base=make('longbeam',0,0); const b1=make('ballast',-70,-40),b2=make('ballast',70,-40); attachConstraint(base,b1,{x:-70,y:0},{x:0,y:28},{length:32,stiffness:.05,damping:.03,kind:'spring'}); attachConstraint(base,b2,{x:70,y:0},{x:0,y:28},{length:32,stiffness:.05,damping:.03,kind:'spring'}); return base; }
    if(key==='mod_micro'){ const torso=make('plate',0,0),g=make('gyro',0,-44),l=make('motorwheel',-30,52),r=make('motorwheel',30,52);g.plugin.active=true;l.plugin.active=true;r.plugin.active=true;[g,l,r].forEach(p=>attachConstraint(torso,p,localPoint(torso,p.position),{x:0,y:0},{stiffness:.88,damping:.16,kind:'weld'}));return torso; }
    return make('box',0,0);
  }

  function spawnPart(key, x, y, silent=false) {
    pushPreAction();
    if(state.snap){x=Math.round(x/20)*20;y=Math.round(y/20)*20;}
    let body;
    if(key==='piston') body=createPiston(x,y);
    else if(key==='dummy'||key==='bot') body=createRagdoll(x,y,key==='bot'?'bot':'dummy');
    else if(key==='cratebot') body=createCrateBot(x,y);
    else if(key==='mod_verity') body=createVerity(x,y);
    else if(key==='mod_verity_monster') body=createVerityMonster(x,y);
    else if(key.startsWith('mod_')) body=createWorkshopMachine(key,x,y);
    else body=createBasicBody(key,x,y);
    if(body && !silent){ selectBody(body); sfx('place'); toast(`${body.plugin?.name || body.label} placed`); }
    recordHistory();
    return body;
  }

  function createBoundary() {
    special.boundaries.forEach(b=>World.remove(engine.world,b)); special.boundaries=[];
    if(state.map==='void') return;
    const floorY=410;
    const floor=Bodies.rectangle(0,floorY,3000,80,{isStatic:true,friction:1});
    floor.label='Ground';floor.plugin={boundary:true,color:state.map==='hangar'?'#1a2330':'#212735',width:3000,height:80};
    special.boundaries.push(floor);World.add(engine.world,floor);
    if(state.map==='testlab'){
      const shelf=Bodies.rectangle(480,240,360,25,{isStatic:true,friction:.9}); shelf.label='Platform'; shelf.plugin={boundary:true,color:'#263448',width:360,height:25};special.boundaries.push(shelf);World.add(engine.world,shelf);
      const ramp=Bodies.rectangle(-460,300,340,22,{isStatic:true,friction:.8});Body.setAngle(ramp,-.27);ramp.plugin={boundary:true,color:'#263448',width:340,height:22};special.boundaries.push(ramp);World.add(engine.world,ramp);
    }
  }

  function clearWorld(record=true) {
    if(record) pushPreAction();
    const allBodies=Composite.allBodies(engine.world).filter(b=>!b.plugin?.boundary);
    const allCons=Composite.allConstraints(engine.world);
    allBodies.forEach(b=>World.remove(engine.world,b)); allCons.forEach(c=>World.remove(engine.world,c));
    special.pistons=[]; special.gravityCores=[]; special.sliders=[]; state.selected=null; state.toolFirst=null; updateSelectionHud();
    createBoundary();
    if(record){recordHistory();sfx('delete');toast('World cleared');}
  }

  function createRope(a,pA,b,pB,steel=false){
    const start=worldPoint(a,pA), end=worldPoint(b,pB); const delta=Vector.sub(end,start); const dist=Vector.magnitude(delta); const segLen=steel?18:14; const count=Math.max(2,Math.min(45,Math.ceil(dist/segLen)));
    const group=Body.nextGroup(true); let prev=a, prevLocal=pA;
    for(let i=1;i<count;i++){
      const t=i/count, pos={x:start.x+delta.x*t,y:start.y+delta.y*t};
      const seg=Bodies.circle(pos.x,pos.y,steel?5.5:4.5,{density:steel?.0045:.0017,friction:.4,frictionAir:.01,collisionFilter:{group}});
      seg.label=steel?'Steel Rope':'Rope'; seg.plugin={spawnKey:steel?'steelRopeSeg':'ropeSeg',kind:'rope',color:steel?'#8f9dac':'#c6ab78',radius:steel?5.5:4.5,name:steel?'Steel Rope':'Rope Segment',ropeSegment:true};
      World.add(engine.world,seg);
      const prevAnchor=prev===a?prevLocal:{x:0,y:0};
      attachConstraint(prev,seg,prevAnchor,{x:0,y:0},{length:segLen,stiffness:steel?.98:.78,damping:steel?.09:.035,kind:steel?'steelrope':'rope',color:steel?'#9aa8b7':'#d3b47b'});
      prev=seg; prevLocal={x:0,y:0};
    }
    attachConstraint(prev,b,{x:0,y:0},pB,{length:segLen,stiffness:steel?.98:.78,damping:steel?.09:.035,kind:steel?'steelrope':'rope',color:steel?'#9aa8b7':'#d3b47b'});
  }

  function createToolConnection(tool, first, second){
    pushPreAction();
    const a=first.body,b=second.body,pA=localPoint(a,first.point),pB=localPoint(b,second.point);
    if(tool==='hinge') attachConstraint(a,b,pA,pB,{length:0,stiffness:.92,damping:.16,kind:'hinge'});
    if(tool==='spring') attachConstraint(a,b,pA,pB,{length:Vector.magnitude(Vector.sub(first.point,second.point)),stiffness:.035,damping:.02,kind:'spring',color:'#c1d1e3'});
    if(tool==='rope') createRope(a,pA,b,pB,false);
    if(tool==='steelrope') createRope(a,pA,b,pB,true);
    if(tool==='weld'||tool==='fixedrope'){
      const off=18; const kind=tool==='fixedrope'?'fixedrope':'weld';
      attachConstraint(a,b,pA,pB,{length:0,stiffness:1,damping:.25,kind,color:tool==='fixedrope'?'#666f7d':colors.joint});
      attachConstraint(a,b,{x:pA.x,y:pA.y+off},{x:pB.x,y:pB.y+off},{length:0,stiffness:1,damping:.25,kind,color:tool==='fixedrope'?'#666f7d':colors.joint});
    }
    if(tool==='slider'){
      const axisWorld=Vector.normalise(Vector.sub(second.point,first.point));
      const axisLocal=Vector.rotate(axisWorld,-a.angle);
      special.sliders.push({a,b,axisLocal,offset:0});
      attachConstraint(a,b,pA,pB,{length:Vector.magnitude(Vector.sub(first.point,second.point)),stiffness:0,damping:0,kind:'slider',color:'#9ea9b5'});
    }
    if(tool==='wire'){
      if(!a.plugin?.linkedIds){toast('First object must be a button, timer, or pressure pad','bad'); return;}
      if(!b.plugin?.poweredType && !b.plugin?.gravityCore){toast('Second object must be a powered part','bad');return;}
      if(!a.plugin.linkedIds.includes(b.id))a.plugin.linkedIds.push(b.id);
      attachConstraint(a,b,pA,pB,{length:Vector.magnitude(Vector.sub(first.point,second.point)),stiffness:0,damping:0,kind:'wire',color:'#7bd5ff'});
      toast(`${a.plugin.name||a.label} wired to ${b.plugin?.name||b.label}`,'good');
    }
    sfx('connect'); recordHistory();
  }

  function toggleSource(body){
    if(!body.plugin?.linkedIds) return false;
    pushPreAction(); body.plugin.active=!body.plugin.active;
    for(const id of body.plugin.linkedIds){const t=Composite.get(engine.world,id,'body'); if(t?.plugin) t.plugin.active=body.plugin.active;}
    sfx('toggle'); recordHistory(); toast(body.plugin.active?'Power ON':'Power OFF'); return true;
  }

  function getBodyAt(point){
    const bodies=Composite.allBodies(engine.world).filter(b=>!b.plugin?.boundary);
    const found=Query.point(bodies,point); return found.length?found[found.length-1]:null;
  }

  function selectBody(body){ state.selected=body; updateSelectionHud(); }
  function updateSelectionHud(){
    const el=document.getElementById('selectionHud'); if(!state.selected){el.classList.add('hidden');return;}
    el.classList.remove('hidden');document.getElementById('selectionName').textContent=state.selected.plugin?.name||state.selected.label;
    const mass=state.selected.isStatic?'LOCKED':`${Math.max(.1,state.selected.mass).toFixed(1)} kg`;
    document.getElementById('selectionInfo').textContent=mass;
    document.getElementById('selFreeze').textContent=state.selected.isStatic?'Unfreeze':'Freeze';
  }

  function freezeBody(body){pushPreAction();Body.setStatic(body,!body.isStatic);body.plugin=body.plugin||{};body.plugin.frozen=body.isStatic;sfx('toggle');recordHistory();updateSelectionHud();}
  function deleteBody(body){if(!body||body.plugin?.boundary)return;pushPreAction();
    Composite.allConstraints(engine.world).filter(c=>c.bodyA===body||c.bodyB===body).forEach(c=>World.remove(engine.world,c));
    special.pistons=special.pistons.filter(p=>{if(p.base===body||p.rod===body){if(p.base!==body)World.remove(engine.world,p.base);if(p.rod!==body)World.remove(engine.world,p.rod);if(p.guide)World.remove(engine.world,p.guide);return false;}return true;});
    World.remove(engine.world,body); if(state.selected===body)state.selected=null; sfx('delete');recordHistory();updateSelectionHud();}
  function duplicateBody(body){ if(!body)return; const k=body.plugin?.spawnKey; if(spawnDefs[k]||k?.startsWith('mod_')) spawnPart(k,body.position.x+35,body.position.y-35); else { const clone=deserializeBody(serializeBody(body));Body.setPosition(clone,{x:body.position.x+35,y:body.position.y-35});World.add(engine.world,clone);selectBody(clone);recordHistory();}}

  function applyPoweredSystems(now){
    const bodies=Composite.allBodies(engine.world);
    for(const b of bodies){const p=b.plugin||{}; if(b.isStatic)continue;
      if(p.balloon){ Body.applyForce(b,b.position,{x:0,y:-0.00075*b.mass*engine.gravity.y}); }
      if(p.verity){ Body.applyForce(b,b.position,{x:0,y:-0.00104*b.mass*engine.gravity.y}); const target=0; Body.setAngularVelocity(b,b.angularVelocity*.88 + (target-b.angle)*.013); }
      if(p.thruster&&p.active){ const mag=.00145*b.mass; const ang=b.angle; Body.applyForce(b,{x:b.position.x-Math.cos(ang)*25,y:b.position.y-Math.sin(ang)*25},{x:Math.cos(ang)*mag,y:Math.sin(ang)*mag}); }
      if(p.poweredType==='motor'&&p.active){const target=p.motorSpeed||.19; Body.setAngularVelocity(b,b.angularVelocity*.86+target*.14);}
      if(p.rotor&&p.active){Body.setAngularVelocity(b,b.angularVelocity*.8+.45*.2);}
      if(p.gyro&&p.active){const err=((p.targetAngle||0)-b.angle); Body.setAngularVelocity(b,b.angularVelocity*.82+err*.08);}
      if(p.magnet&&p.active){ for(const o of bodies){if(o===b||o.isStatic||o.plugin?.kind!=='metal')continue; const d=Vector.sub(b.position,o.position), ds=Math.max(70,Vector.magnitudeSquared(d)); if(ds<90000){const n=Vector.normalise(d),f=Math.min(.0008,.0000008*90000/ds)*o.mass;Body.applyForce(o,o.position,{x:n.x*f,y:n.y*f});}}}
      if(p.timer&&p.active&&now-(p.lastPulse||0)>p.interval){p.lastPulse=now;p.pulseState=!p.pulseState;for(const id of p.linkedIds||[]){const t=Composite.get(engine.world,id,'body');if(t?.plugin)t.plugin.active=p.pulseState;}}
    }
    for(const piston of special.pistons){const {base,rod}=piston;if(!base||!rod)continue; const target=base.plugin?.active?piston.max:piston.min; piston.extension += Math.sign(target-piston.extension)*Math.min(Math.abs(target-piston.extension),piston.speed*state.timeScale);
      const ang=base.angle, dist=26+piston.extension; const desired={x:base.position.x+Math.cos(ang)*dist,y:base.position.y+Math.sin(ang)*dist}; Body.setPosition(rod,desired);Body.setAngle(rod,ang);Body.setVelocity(rod,base.velocity);Body.setAngularVelocity(rod,base.angularVelocity);
    }
    for(const g of special.gravityCores){if(!g?.plugin?.active)continue;for(const o of bodies){if(o===g||o.isStatic)continue;const d=Vector.sub(g.position,o.position), dist2=Math.max(900,Vector.magnitudeSquared(d));if(dist2<140000){const n=Vector.normalise(d), f=.00015*o.mass*(140000/dist2);Body.applyForce(o,o.position,{x:n.x*f,y:n.y*f});}}}
    for(const s of special.sliders){if(!s.a||!s.b||s.a.isStatic&&s.b.isStatic)continue;const axis=Vector.rotate(s.axisLocal,s.a.angle),perp={x:-axis.y,y:axis.x};const rel=Vector.sub(s.b.position,s.a.position);const err=rel.x*perp.x+rel.y*perp.y-(s.offset||0);const k=Math.max(-.003,Math.min(.003,-err*.000035));if(!s.b.isStatic)Body.applyForce(s.b,s.b.position,{x:perp.x*k*s.b.mass,y:perp.y*k*s.b.mass});if(!s.a.isStatic)Body.applyForce(s.a,s.a.position,{x:-perp.x*k*s.a.mass,y:-perp.y*k*s.a.mass});}
  }

  Events.on(engine,'collisionStart',ev=>{
    for(const pair of ev.pairs){for(const b of [pair.bodyA,pair.bodyB]){if(b.plugin?.pressure){b.plugin.active=true;for(const id of b.plugin.linkedIds||[]){const t=Composite.get(engine.world,id,'body');if(t?.plugin)t.plugin.active=true;}}}}
  });
  Events.on(engine,'collisionEnd',ev=>{
    for(const pair of ev.pairs){for(const b of [pair.bodyA,pair.bodyB]){if(b.plugin?.pressure){b.plugin.active=false;for(const id of b.plugin.linkedIds||[]){const t=Composite.get(engine.world,id,'body');if(t?.plugin)t.plugin.active=false;}}}}
  });

  function resize(){const dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.floor(innerWidth*dpr);canvas.height=Math.floor(innerHeight*dpr);canvas.style.width=innerWidth+'px';canvas.style.height=innerHeight+'px';ctx.setTransform(dpr,0,0,dpr,0,0);state.dpr=dpr;}
  addEventListener('resize',resize);resize();

  function screenToWorld(x,y){return{x:(x-innerWidth/2)/state.camera.zoom+state.camera.x,y:(y-innerHeight/2)/state.camera.zoom+state.camera.y};}
  function worldToScreen(x,y){return{x:(x-state.camera.x)*state.camera.zoom+innerWidth/2,y:(y-state.camera.y)*state.camera.zoom+innerHeight/2};}

  function drawGrid(){
    const z=state.camera.zoom; const step=40*z; const bg=state.map==='void'?'#070a0f':state.map==='testlab'?'#0c111a':'#0a0f17';ctx.fillStyle=bg;ctx.fillRect(0,0,innerWidth,innerHeight);
    if(state.map==='void')return;
    ctx.strokeStyle='rgba(150,190,230,.055)';ctx.lineWidth=1;ctx.beginPath();const ox=((innerWidth/2-state.camera.x*z)%step+step)%step, oy=((innerHeight/2-state.camera.y*z)%step+step)%step;
    for(let x=ox;x<innerWidth;x+=step){ctx.moveTo(x,0);ctx.lineTo(x,innerHeight);}for(let y=oy;y<innerHeight;y+=step){ctx.moveTo(0,y);ctx.lineTo(innerWidth,y);}ctx.stroke();
    if(state.map==='hangar'){const horizon=worldToScreen(0,410).y;const grad=ctx.createLinearGradient(0,horizon-180,0,horizon+50);grad.addColorStop(0,'rgba(117,212,255,0)');grad.addColorStop(1,'rgba(117,212,255,.045)');ctx.fillStyle=grad;ctx.fillRect(0,Math.max(0,horizon-180),innerWidth,220);}
  }

  function drawBody(b){
    const p=b.plugin||{}; if(p.collider&&!state.showColliders)return;
    ctx.save();ctx.translate(b.position.x,b.position.y);ctx.rotate(b.angle);
    let fill=p.color||'#76869a';
    if(p.toggleSource)fill=p.active?colors.buttonOn:colors.buttonOff;
    ctx.fillStyle=fill;ctx.strokeStyle=b===state.selected?'#d6ff9d':'rgba(255,255,255,.18)';ctx.lineWidth=(b===state.selected?2:1)/state.camera.zoom;
    if(b.circleRadius){ctx.beginPath();ctx.arc(0,0,b.circleRadius,0,Math.PI*2);ctx.fill();ctx.stroke();}
    else {const w=p.width||Math.max(1,b.bounds.max.x-b.bounds.min.x),h=p.height||Math.max(1,b.bounds.max.y-b.bounds.min.y);roundRect(ctx,-w/2,-h/2,w,h,Math.min(7,h/3));ctx.fill();ctx.stroke();}
    if(p.wheel&&b.circleRadius){ctx.strokeStyle='rgba(255,255,255,.26)';ctx.lineWidth=3/state.camera.zoom;ctx.beginPath();ctx.arc(0,0,b.circleRadius*.55,0,Math.PI*2);ctx.stroke();for(let i=0;i<6;i++){const a=i*Math.PI/3;ctx.beginPath();ctx.moveTo(Math.cos(a)*b.circleRadius*.18,Math.sin(a)*b.circleRadius*.18);ctx.lineTo(Math.cos(a)*b.circleRadius*.82,Math.sin(a)*b.circleRadius*.82);ctx.stroke();}}
    if(p.gyro){ctx.strokeStyle=p.active?'#b6ff83':'#748294';ctx.lineWidth=3/state.camera.zoom;ctx.beginPath();ctx.arc(0,0,19,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(-14,0);ctx.lineTo(14,0);ctx.stroke();}
    if(p.thruster){ctx.fillStyle=p.active?'#9cecff':'#60748a';ctx.beginPath();ctx.moveTo(28,-10);ctx.lineTo(42,0);ctx.lineTo(28,10);ctx.closePath();ctx.fill();if(p.active){ctx.fillStyle='rgba(117,212,255,.45)';ctx.beginPath();ctx.moveTo(-32,-8);ctx.lineTo(-56,0);ctx.lineTo(-32,8);ctx.closePath();ctx.fill();}}
    if(p.rotor){ctx.fillStyle='#1b232d';ctx.beginPath();ctx.arc(0,0,9,0,Math.PI*2);ctx.fill();}
    if(p.collider){ctx.setLineDash([7/state.camera.zoom,5/state.camera.zoom]);ctx.strokeStyle='rgba(95,211,255,.9)';ctx.lineWidth=1.5/state.camera.zoom;const w=p.width||100,h=p.height||60;ctx.strokeRect(-w/2,-h/2,w,h);ctx.setLineDash([]);}
    if(p.toggleSource){ctx.fillStyle=p.active?'#14351c':'#1d2631';roundRect(ctx,-13,-6,26,12,6);ctx.fill();}
    if(p.pressure){ctx.fillStyle=p.active?'#b6ff83':'#78889a';ctx.fillRect(-28,-4,56,8);}
    if(p.timer){ctx.strokeStyle='#ceb6ff';ctx.lineWidth=2/state.camera.zoom;ctx.beginPath();ctx.arc(0,0,12,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-8);ctx.moveTo(0,0);ctx.lineTo(6,2);ctx.stroke();}
    if(p.gravityCore){ctx.strokeStyle=p.active?'#b9a8ff':'#746d94';ctx.lineWidth=2/state.camera.zoom;for(let r=11;r<=23;r+=6){ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();}}
    if(p.verity){drawVerityFace(ctx,b.circleRadius||31);}
    if(p.monsterHead){drawMonsterFace(ctx,b.circleRadius||34);}
    if(p.kind==='dummy'&&b.circleRadius){ctx.fillStyle='#24313b';ctx.beginPath();ctx.arc(-6,-3,2,0,Math.PI*2);ctx.arc(6,-3,2,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#31404b';ctx.beginPath();ctx.moveTo(-5,6);ctx.lineTo(5,6);ctx.stroke();}
    if(p.kind==='logic'&&!p.toggleSource&&!p.pressure&&!p.timer){ctx.fillStyle='#75d4ff';ctx.fillRect(-6,-2,12,4);}
    if(b.isStatic&&!p.boundary){ctx.strokeStyle='rgba(180,220,255,.9)';ctx.lineWidth=2/state.camera.zoom;ctx.strokeRect(-9,-9,18,18);ctx.beginPath();ctx.moveTo(-6,-9);ctx.lineTo(-6,-14);ctx.quadraticCurveTo(0,-21,6,-14);ctx.lineTo(6,-9);ctx.stroke();}
    ctx.restore();
  }

  function drawVerityFace(c,r){c.fillStyle='#151515';c.beginPath();c.arc(-10,-7,3.2,0,Math.PI*2);c.arc(10,-7,3.2,0,Math.PI*2);c.fill();c.strokeStyle='#151515';c.lineWidth=3; c.beginPath();c.arc(0,2,14,.25,Math.PI-.25);c.stroke();}
  function drawMonsterFace(c,r){c.fillStyle='#090909';c.beginPath();c.ellipse(-11,-8,6,9,0,0,Math.PI*2);c.ellipse(11,-8,6,9,0,0,Math.PI*2);c.fill();c.beginPath();c.ellipse(0,10,18,10,0,0,Math.PI*2);c.fill();c.fillStyle='#e8dda0';for(let i=-12;i<=12;i+=6){c.beginPath();c.moveTo(i,4);c.lineTo(i+3,10);c.lineTo(i+6,4);c.fill();c.beginPath();c.moveTo(i,16);c.lineTo(i+3,10);c.lineTo(i+6,16);c.fill();}}

  function roundRect(c,x,y,w,h,r){r=Math.max(0,Math.min(r,w/2,h/2));c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}

  function drawConstraint(c){if(c.plugin?.visible===false||!state.showJoints)return; const a=c.bodyA?worldPoint(c.bodyA,c.pointA):c.pointA,b=c.bodyB?worldPoint(c.bodyB,c.pointB):c.pointB;if(!a||!b)return;ctx.save();ctx.strokeStyle=c.plugin?.color||colors.joint;const ck=c.plugin?.kind;ctx.lineWidth=((ck==='steelrope'||ck==='fixedrope')?2.5:1.5)/state.camera.zoom;if(ck==='wire')ctx.setLineDash([5/state.camera.zoom,5/state.camera.zoom]);if(ck==='slider')ctx.setLineDash([12/state.camera.zoom,4/state.camera.zoom]);if(c.plugin?.kind==='spring'){const n=10,dx=(b.x-a.x)/n,dy=(b.y-a.y)/n,perp=Vector.normalise({x:-dy,y:dx});ctx.beginPath();ctx.moveTo(a.x,a.y);for(let i=1;i<n;i++){const s=i%2?5:-5;ctx.lineTo(a.x+dx*i+perp.x*s,a.y+dy*i+perp.y*s);}ctx.lineTo(b.x,b.y);ctx.stroke();}else{ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}ctx.setLineDash([]);ctx.restore();}

  function drawToolPreview(){if(!state.toolFirst)return; const p=state.toolFirst.point;const s=worldToScreen(p.x,p.y);ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.strokeStyle='#b6ff83';ctx.lineWidth=2;ctx.beginPath();ctx.arc(s.x,s.y,9,0,Math.PI*2);ctx.stroke();ctx.restore();}

  function render(){
    const now=performance.now(), dt=now-state.lastFrame;state.lastFrame=now;state.frameTimes.push(dt);if(state.frameTimes.length>30)state.frameTimes.shift();state.fps=Math.round(1000/(state.frameTimes.reduce((a,b)=>a+b,0)/state.frameTimes.length));
    if(!state.paused){engine.timing.timeScale=state.timeScale;applyPoweredSystems(now);Engine.update(engine,Math.min(32,dt||16.67));}
    drawGrid();ctx.save();ctx.translate(innerWidth/2,innerHeight/2);ctx.scale(state.camera.zoom,state.camera.zoom);ctx.translate(-state.camera.x,-state.camera.y);
    const constraints=Composite.allConstraints(engine.world);constraints.forEach(drawConstraint);Composite.allBodies(engine.world).forEach(drawBody);drawToolPreview();ctx.restore();
    document.getElementById('fpsText').textContent=state.fps;document.getElementById('objectCount').textContent=Composite.allBodies(engine.world).filter(b=>!b.plugin?.boundary).length;
    requestAnimationFrame(render);
  }

  function toolNeedsTwo(tool){return ['hinge','weld','fixedrope','slider','rope','steelrope','spring','wire'].includes(tool);}
  function setTool(tool){state.tool=tool;state.toolFirst=null;document.querySelectorAll('.tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));document.getElementById('hint').textContent=toolNeedsTwo(tool)?`Tap the first object, then the second to create ${tool}.`:tool==='freeze'?'Tap objects to freeze or unfreeze them.':tool==='delete'?'Tap objects to delete them.':tool==='nocollide'?'Tap an object to toggle collision.':'Tap or drag objects. Drag empty space to pan.';}
  document.querySelectorAll('.tool').forEach(b=>b.addEventListener('click',()=>{ if(b.dataset.tool==='select') clearSpawnSelection(); setTool(b.dataset.tool); }));

  canvas.addEventListener('pointerdown',e=>{
    audioUnlock();canvas.setPointerCapture(e.pointerId);state.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY});
    if(state.pointers.size===2){const pts=[...state.pointers.values()];const d=Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y);state.pinch={dist:d,zoom:state.camera.zoom};removeDrag();return;}
    const world=screenToWorld(e.clientX,e.clientY);const body=getBodyAt(world);state.pointerDown={x:e.clientX,y:e.clientY,world,body,time:performance.now()};
    if(state.spawnKey&&state.tool==='select'&&document.querySelector('.itemCard.active')){spawnPart(state.spawnKey,world.x,world.y);return;}
    if(state.tool==='freeze'&&body){freezeBody(body);return;}
    if(state.tool==='delete'&&body){deleteBody(body);return;}
    if(state.tool==='nocollide'&&body){pushPreAction();body.plugin.noCollide=!body.plugin.noCollide;body.collisionFilter.mask=body.plugin.noCollide?0:0xFFFFFFFF;toast(body.plugin.noCollide?'Collision disabled':'Collision enabled');recordHistory();return;}
    if(toolNeedsTwo(state.tool)&&body){if(!state.toolFirst){state.toolFirst={body,point:world};toast('First connection point set');}else if(body!==state.toolFirst.body || state.tool==='wire'){createToolConnection(state.tool,state.toolFirst,{body,point:world});state.toolFirst=null;}return;}
    if(state.tool==='select'&&body){selectBody(body);state.dragging=false;state.dragConstraint=Constraint.create({pointA:world,bodyB:body,pointB:localPoint(body,world),stiffness:.18,damping:.18});state.dragConstraint.plugin={kind:'drag',visible:false};World.add(engine.world,state.dragConstraint);}else if(state.tool==='select'){selectBody(null);state.panStart={x:e.clientX,y:e.clientY,cx:state.camera.x,cy:state.camera.y};}
  });

  canvas.addEventListener('pointermove',e=>{
    const p=state.pointers.get(e.pointerId);if(p){p.x=e.clientX;p.y=e.clientY;}
    if(state.pointers.size===2&&state.pinch){const pts=[...state.pointers.values()];const d=Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y);state.camera.zoom=Math.max(.35,Math.min(2.5,state.pinch.zoom*d/state.pinch.dist));return;}
    if(state.dragConstraint){const w=screenToWorld(e.clientX,e.clientY);state.dragConstraint.pointA=w;if(state.pointerDown&&Math.hypot(e.clientX-state.pointerDown.x,e.clientY-state.pointerDown.y)>5)state.dragging=true;}
    else if(state.panStart){state.camera.x=state.panStart.cx-(e.clientX-state.panStart.x)/state.camera.zoom;state.camera.y=state.panStart.cy-(e.clientY-state.panStart.y)/state.camera.zoom;}
  });

  function pointerEnd(e){
    const pd=state.pointerDown;const body=pd?.body; const wasDrag=state.dragging;removeDrag();state.panStart=null;state.pointers.delete(e.pointerId);if(state.pointers.size<2)state.pinch=null;
    if(pd&&body&&state.tool==='select'&&!wasDrag&&performance.now()-pd.time<420&&Math.hypot(e.clientX-pd.x,e.clientY-pd.y)<8){ if(body.plugin?.toggleSource)toggleSource(body); }
    if(wasDrag)recordHistory();state.pointerDown=null;state.dragging=false;
  }
  canvas.addEventListener('pointerup',pointerEnd);canvas.addEventListener('pointercancel',pointerEnd);
  canvas.addEventListener('wheel',e=>{e.preventDefault();const before=screenToWorld(e.clientX,e.clientY);const factor=Math.exp(-e.deltaY*.001);state.camera.zoom=Math.max(.35,Math.min(2.5,state.camera.zoom*factor));const after=screenToWorld(e.clientX,e.clientY);state.camera.x+=before.x-after.x;state.camera.y+=before.y-after.y;},{passive:false});

  function removeDrag(){if(state.dragConstraint){World.remove(engine.world,state.dragConstraint);state.dragConstraint=null;}}
  function clearSpawnSelection(){state.spawnKey=null;document.querySelectorAll('.itemCard').forEach(c=>c.classList.remove('active'));}

  function renderItems(){
    const grid=document.getElementById('itemGrid');grid.innerHTML='';let items=categories[state.category]||[];
    if(state.category==='mods'){
      const shop=document.createElement('button');shop.className='itemCard';shop.innerHTML='<div class="itemIcon">WS</div><b>Workshop</b><small>Browse rotating mods</small>';shop.onclick=()=>openWorkshop();grid.appendChild(shop);
      const allMods=[...MOD_BASE,...ROTATING_POOL];items=[...installedMods].map(id=>allMods.find(m=>m.id===id)).filter(Boolean).map(m=>[m.spawnKey,m.title,'Installed mod']);
    }
    for(const [key,name,desc] of items){const card=document.createElement('button');card.className='itemCard';card.dataset.key=key;card.innerHTML=`<div class="itemIcon">${iconText(key)}</div><b>${name}</b><small>${desc}</small>`;card.onclick=()=>{state.spawnKey=key;setTool('select');document.querySelectorAll('.itemCard').forEach(c=>c.classList.remove('active'));card.classList.add('active');document.getElementById('hint').textContent=`Tap the world to place ${name}.`;};grid.appendChild(card);}
  }
  function iconText(key){const map={beam:'I',longbeam:'II',plate:'PL',armor:'AR',box:'BX',circle:'O',wheel:'WH',motorwheel:'MW',piston:'PS',gyro:'GY',thruster:'TH',rotor:'RT',button:'BT',pressure:'PD',timer:'TM',gravitycore:'GR',collider:'CL',dummy:'RG',ballast:'BL',balloon:'LF',magnet:'MG',bot:'MP',cratebot:'BB',mod_verity:'V',mod_verity_monster:'VM'};return map[key]||'MOD';}
  document.querySelectorAll('#categoryTabs button').forEach(b=>b.addEventListener('click',()=>{state.category=b.dataset.category;document.querySelectorAll('#categoryTabs button').forEach(x=>x.classList.toggle('active',x===b));clearSpawnSelection();renderItems();}));

  function getRotationMods(){const bucket=Math.floor(Date.now()/(3*60*60*1000));const picks=[];for(let i=0;i<3;i++){const idx=(bucket*7+i*3)%ROTATING_POOL.length;picks.push(ROTATING_POOL[idx]);}return picks;}
  function openWorkshop(){document.getElementById('workshopPanel').classList.remove('hidden');renderWorkshop();sfx('open');}
  function renderWorkshop(){const grid=document.getElementById('workshopGrid');grid.innerHTML='';const mods=[...MOD_BASE,...getRotationMods()];for(const m of mods){const installed=installedMods.has(m.id);const card=document.createElement('button');card.className='modCard';card.innerHTML=`<div class="modBadge">${installed?'INSTALLED':(m.rarity||'ROTATING')}</div><div class="modArt">${modArtHTML(m.art)}</div><b>${m.title}</b><p>${m.desc}</p>`;card.onclick=()=>openModDetail(m);grid.appendChild(card);}}
  function modArtHTML(art){if(art==='verity')return '<div class="verityOrb"><i class="veritySmile"></i></div>';if(art==='monster')return '<div class="monsterMini"></div>';return '<div class="genericModArt"></div>';}
  function openModDetail(m){document.getElementById('modTitle').textContent=m.title;document.getElementById('modAuthor').textContent=m.author||'Rotating Workshop';document.getElementById('modDescription').textContent=m.desc;const chips=document.getElementById('modFeatures');chips.innerHTML=(m.features||[]).map(x=>`<span>${x}</span>`).join('');const btn=document.getElementById('modInstallButton');btn.textContent=installedMods.has(m.id)?'Installed — Spawn Menu Ready':'Install to Spawn Menu';btn.disabled=installedMods.has(m.id);btn.onclick=()=>{installedMods.add(m.id);localStorage.setItem('mechyard.installedMods',JSON.stringify([...installedMods]));btn.textContent='Installed — Spawn Menu Ready';btn.disabled=true;sfx('install');toast(`${m.title} installed`,'good');renderItems();renderWorkshop();};drawModPreview(m);document.getElementById('modDetail').classList.remove('hidden');}
  function drawModPreview(m){const c=document.getElementById('modPreview'),g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);const grad=g.createLinearGradient(0,0,c.width,c.height);grad.addColorStop(0,'#0d151f');grad.addColorStop(1,'#171522');g.fillStyle=grad;g.fillRect(0,0,c.width,c.height);g.strokeStyle='rgba(255,255,255,.05)';for(let x=0;x<c.width;x+=40){g.beginPath();g.moveTo(x,0);g.lineTo(x,c.height);g.stroke();}for(let y=0;y<c.height;y+=40){g.beginPath();g.moveTo(0,y);g.lineTo(c.width,y);g.stroke();}if(m.art==='verity'){g.translate(c.width/2,c.height/2);g.fillStyle=colors.yellow;g.shadowBlur=30;g.shadowColor='rgba(244,222,76,.4)';g.beginPath();g.arc(0,0,74,0,Math.PI*2);g.fill();g.shadowBlur=0;drawVerityFace(g,74);}else if(m.art==='monster'){g.translate(c.width/2,c.height/2+20);g.fillStyle='#c7bb55';roundRect(g,-34,-65,68,160,20);g.fill();g.fillStyle='#d8cb62';g.beginPath();g.arc(0,-100,48,0,Math.PI*2);g.fill();drawMonsterFace(g,48);g.fillStyle='#c7bb55';roundRect(g,-90,-55,24,150,10);g.fill();roundRect(g,66,-55,24,150,10);g.fill();}else{g.fillStyle='#75d4ff';g.font='700 30px system-ui';g.textAlign='center';g.fillText(m.title,c.width/2,c.height/2-10);g.fillStyle='#8ea0b8';g.font='16px system-ui';g.fillText('MECHYARD WORKSHOP PACK',c.width/2,c.height/2+25);}}
  function updateRotation(){const bucket=Math.floor(Date.now()/(3*60*60*1000));if(state.lastRotationBucket!==null&&bucket!==state.lastRotationBucket&&!document.getElementById('workshopPanel').classList.contains('hidden')){renderWorkshop();toast('Workshop rotated: new packs are available','good');}state.lastRotationBucket=bucket;const next=(bucket+1)*3*60*60*1000-Date.now();const h=Math.floor(next/3600000),m=Math.floor((next%3600000)/60000),s=Math.floor((next%60000)/1000);document.getElementById('rotationTimer').textContent=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}
  setInterval(updateRotation,1000);updateRotation();

  function serializeBody(b){const p=clonePlugin(b.plugin);return{id:b.id,label:b.label,x:b.position.x,y:b.position.y,angle:b.angle,vx:b.velocity.x,vy:b.velocity.y,av:b.angularVelocity,isStatic:b.isStatic,plugin:p,shape:b.circleRadius?'circle':'rect',radius:b.circleRadius||p.radius,w:p.width||Math.max(4,b.bounds.max.x-b.bounds.min.x),h:p.height||Math.max(4,b.bounds.max.y-b.bounds.min.y),group:b.collisionFilter.group,mask:b.collisionFilter.mask,category:b.collisionFilter.category};}
  function deserializeBody(o){const common={density:.003,friction:.55,restitution:.08};let b;if(o.shape==='circle')b=Bodies.circle(o.x,o.y,o.radius||20,common);else b=Bodies.rectangle(o.x,o.y,o.w||40,o.h||40,common);b.label=o.label;b.plugin=clonePlugin(o.plugin);b.collisionFilter.group=o.group||0;b.collisionFilter.mask=Number.isFinite(o.mask)?o.mask:0xFFFFFFFF;b.collisionFilter.category=Number.isFinite(o.category)?o.category:1;Body.setAngle(b,o.angle||0);Body.setVelocity(b,{x:o.vx||0,y:o.vy||0});Body.setAngularVelocity(b,o.av||0);if(o.isStatic)Body.setStatic(b,true);return b;}
  function serializeScene(){const bodies=Composite.allBodies(engine.world).filter(b=>!b.plugin?.boundary).map(serializeBody);const allowed=new Set(bodies.map(b=>b.id));const cons=Composite.allConstraints(engine.world).filter(c=>(!c.bodyA||allowed.has(c.bodyA.id))&&(!c.bodyB||allowed.has(c.bodyB.id))&&c!==state.dragConstraint).map(c=>({a:c.bodyA?.id||null,b:c.bodyB?.id||null,pa:c.pointA,pb:c.pointB,length:c.length,stiffness:c.stiffness,damping:c.damping,plugin:clonePlugin(c.plugin)}));const pistons=special.pistons.map(p=>({base:p.base?.id,rod:p.rod?.id,extension:p.extension,min:p.min,max:p.max,speed:p.speed,guidePlugin:clonePlugin(p.guide?.plugin)}));const sliders=special.sliders.map(s=>({a:s.a?.id,b:s.b?.id,axisLocal:s.axisLocal,offset:s.offset||0}));return{version:3,map:state.map,gravity:engine.gravity.y,timeScale:state.timeScale,bodies,cons,pistons,sliders,camera:state.camera};}
  function loadScene(data,keepHistory=true){state.isLoading=true;clearWorld(false);state.map=data.map||'hangar';createBoundary();engine.gravity.y=Number.isFinite(data.gravity)?data.gravity:1;state.timeScale=data.timeScale||1;state.camera=data.camera||{x:0,y:20,zoom:1};const map=new Map();for(const o of data.bodies||[]){const b=deserializeBody(o);World.add(engine.world,b);map.set(o.id,b);if(b.plugin?.gravityCore)special.gravityCores.push(b);}for(const o of data.cons||[]){const a=o.a?map.get(o.a):null,b=o.b?map.get(o.b):null;const c=Constraint.create({bodyA:a||undefined,bodyB:b||undefined,pointA:o.pa,pointB:o.pb,length:o.length,stiffness:o.stiffness,damping:o.damping});c.plugin=o.plugin||{};World.add(engine.world,c);}special.pistons=[];special.sliders=[];for(const p of data.pistons||[]){const base=map.get(p.base),rod=map.get(p.rod);if(base&&rod){let guide=Composite.allConstraints(engine.world).find(c=>c.bodyA===base&&c.bodyB===rod&&c.plugin?.kind==='pistonGuide');if(!guide)guide=attachConstraint(base,rod,{x:16,y:0},{x:-20,y:0},{length:18,stiffness:.3,damping:.25,kind:'pistonGuide',visible:false});special.pistons.push({base,rod,guide,extension:p.extension||8,min:p.min||8,max:p.max||78,speed:p.speed||1.1});}}for(const sl of data.sliders||[]){const a=map.get(sl.a),b=map.get(sl.b);if(a&&b)special.sliders.push({a,b,axisLocal:sl.axisLocal||{x:1,y:0},offset:sl.offset||0});}
    document.getElementById('gravitySlider').value=engine.gravity.y;document.getElementById('gravityValue').textContent=engine.gravity.y.toFixed(2);document.getElementById('gravityLabel').textContent=engine.gravity.y.toFixed(2)+'x';document.getElementById('timeSlider').value=state.timeScale;document.getElementById('timeValue').textContent=state.timeScale.toFixed(2);document.getElementById('mapSelect').value=state.map;state.isLoading=false;if(!keepHistory)recordHistory(true);
  }

  let preActionSnapshot=null;
  function pushPreAction(){if(state.isLoading)return;preActionSnapshot=JSON.stringify(serializeScene());}
  function recordHistory(force=false){if(state.isLoading)return;const snap=JSON.stringify(serializeScene());if(state.historyIndex>=0&&state.history[state.historyIndex]===snap&&!force)return;if(state.historyIndex<state.history.length-1)state.history=state.history.slice(0,state.historyIndex+1);if(preActionSnapshot&&state.history.length===0){state.history.push(preActionSnapshot);state.historyIndex=0;}state.history.push(snap);if(state.history.length>20)state.history.shift();state.historyIndex=state.history.length-1;preActionSnapshot=null;}
  function undo(){if(state.historyIndex<=0){toast('Nothing to undo');return;}state.historyIndex--;loadScene(JSON.parse(state.history[state.historyIndex]),true);sfx('toggle');}
  function redo(){if(state.historyIndex>=state.history.length-1){toast('Nothing to redo');return;}state.historyIndex++;loadScene(JSON.parse(state.history[state.historyIndex]),true);sfx('toggle');}

  function saveBuild(){localStorage.setItem('mechyard.save',JSON.stringify(serializeScene()));sfx('save');toast('Build saved on this device','good');}
  function loadBuild(){const raw=localStorage.getItem('mechyard.save');if(!raw){toast('No saved build yet','bad');return;}pushPreAction();loadScene(JSON.parse(raw),true);recordHistory();sfx('save');toast('Build loaded','good');}
  function exportBuild(){const blob=new Blob([JSON.stringify(serializeScene(),null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='mechyard-build.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);sfx('save');}
  function importBuild(file){const r=new FileReader();r.onload=()=>{try{pushPreAction();loadScene(JSON.parse(r.result),true);recordHistory();toast('Build imported','good');sfx('save');}catch(e){toast('That build file is invalid','bad');}};r.readAsText(file);}

  function toast(msg,type=''){const el=document.createElement('div');el.className='toast '+type;el.textContent=msg;document.getElementById('toastLayer').appendChild(el);setTimeout(()=>el.remove(),1800);}

  let audioCtx=null,musicTimer=null,musicNodes=[];
  function audioUnlock(){if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();}
  function sfx(name){if(!state.sfx)return;audioUnlock();const t=audioCtx.currentTime;const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.connect(gain);gain.connect(audioCtx.destination);const spec={place:[210,110,.08],connect:[520,280,.09],delete:[130,60,.1],toggle:[650,460,.055],save:[760,420,.1],open:[340,220,.07],install:[440,880,.18]}[name]||[300,180,.06];osc.type=name==='delete'?'sawtooth':'sine';osc.frequency.setValueAtTime(spec[0],t);osc.frequency.exponentialRampToValueAtTime(spec[1],t+spec[2]);gain.gain.setValueAtTime(.045,t);gain.gain.exponentialRampToValueAtTime(.001,t+spec[2]);osc.start(t);osc.stop(t+spec[2]);}
  function setMusic(on){state.music=on;localStorage.setItem('mechyard.music',on?'1':'0');if(!on){if(musicTimer)clearInterval(musicTimer);musicTimer=null;musicNodes.forEach(n=>{try{n.stop()}catch{}});musicNodes=[];return;}audioUnlock();const playChord=()=>{if(!state.music)return;const t=audioCtx.currentTime;const root=[110,123.47,98,130.81][Math.floor(Date.now()/5000)%4];[1,1.5,2].forEach((m,i)=>{const o=audioCtx.createOscillator(),g=audioCtx.createGain(),f=audioCtx.createBiquadFilter();o.type=i===0?'sine':'triangle';o.frequency.value=root*m;f.type='lowpass';f.frequency.value=520;o.connect(f);f.connect(g);g.connect(audioCtx.destination);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.012/(i+1),t+.6);g.gain.linearRampToValueAtTime(0,t+4.5);o.start(t);o.stop(t+4.6);musicNodes.push(o);});};playChord();musicTimer=setInterval(playChord,5000);}

  document.getElementById('settingsButton').onclick=()=>document.getElementById('settingsPanel').classList.remove('hidden');
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).classList.add('hidden'));
  document.getElementById('undoButton').onclick=undo;document.getElementById('redoButton').onclick=redo;
  document.getElementById('pauseButton').onclick=()=>{state.paused=!state.paused;document.getElementById('pauseButton').textContent=state.paused?'PLAY':'PAUSE';toast(state.paused?'Physics paused':'Physics resumed');};
  document.getElementById('gravitySlider').oninput=e=>{engine.gravity.y=+e.target.value;document.getElementById('gravityValue').textContent=(+e.target.value).toFixed(2);document.getElementById('gravityLabel').textContent=(+e.target.value).toFixed(2)+'x';};
  document.getElementById('timeSlider').oninput=e=>{state.timeScale=+e.target.value;document.getElementById('timeValue').textContent=state.timeScale.toFixed(2);};
  document.getElementById('jointToggle').onchange=e=>state.showJoints=e.target.checked;document.getElementById('colliderToggle').onchange=e=>state.showColliders=e.target.checked;document.getElementById('snapToggle').onchange=e=>state.snap=e.target.checked;
  document.getElementById('musicToggle').onchange=e=>setMusic(e.target.checked);document.getElementById('sfxToggle').onchange=e=>{state.sfx=e.target.checked;localStorage.setItem('mechyard.sfx',state.sfx?'1':'0');};
  document.getElementById('mapSelect').onchange=e=>{pushPreAction();state.map=e.target.value;createBoundary();recordHistory();};document.getElementById('clearWorld').onclick=()=>clearWorld(true);document.getElementById('resetCamera').onclick=()=>{state.camera={x:0,y:20,zoom:1};};
  document.getElementById('saveButton').onclick=saveBuild;document.getElementById('loadButton').onclick=loadBuild;document.getElementById('exportButton').onclick=exportBuild;document.getElementById('importButton').onclick=()=>document.getElementById('importFile').click();document.getElementById('importFile').onchange=e=>{if(e.target.files[0])importBuild(e.target.files[0]);e.target.value='';};
  document.getElementById('selFreeze').onclick=()=>state.selected&&freezeBody(state.selected);document.getElementById('selDuplicate').onclick=()=>state.selected&&duplicateBody(state.selected);document.getElementById('selDelete').onclick=()=>state.selected&&deleteBody(state.selected);
  document.getElementById('panelToggle').onclick=()=>{const p=document.getElementById('buildPanel');p.classList.toggle('open');document.getElementById('panelToggle').textContent=p.classList.contains('open')?'UP':'DOWN';};

  function init(){
    state.sfx=localStorage.getItem('mechyard.sfx')!=='0';document.getElementById('sfxToggle').checked=state.sfx;
    createBoundary();renderItems();recordHistory(true);requestAnimationFrame(render);
    if('serviceWorker' in navigator)navigator.serviceWorker.register('service-worker.js').catch(()=>{});
    toast('Mechyard ready — build something unreasonable','good');
  }
  init();
})();
