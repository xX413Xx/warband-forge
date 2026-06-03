// ═══ DATA (loaded from Flask API) ═══
let FACTIONS={},VARIANTS={},GOETIC_POWERS={},SAINT_AURAS={},MERCENARIES=[],GEAR={},ARCANA_POWERS=[];

function parseLimit(limitStr){
  if(!limitStr) return {min:0,max:99};
  const s=String(limitStr);
  if(s.includes('∞')||s==='No limit') return {min:0,max:99};
  if(s.includes('required')&&s.startsWith('1')) return {min:1,max:1};
  const m=s.match(/(\d+)-(\d+)/);
  if(m) return {min:parseInt(m[1]),max:parseInt(m[2])};
  const m2=s.match(/^(\d+)/);
  if(m2) return {min:parseInt(m2[1]),max:parseInt(m2[1])};
  return {min:0,max:99};
}

function transformUnit(u){
  const lim=parseLimit(u.limit);
  return {...u, min:lim.min, max:lim.max,
    movement:u.movement||'6"',
    ranged:u.ranged?u.ranged.replace(' DICE',''):'-',
    melee:u.melee?u.melee.replace(' DICE',''):'-',
    armour:u.armour||'0',
    gp_max:u.goetic_powers_max||0,
    gp_free:u.goetic_powers_free||[],
    ap_max:u.ap_max||0,
    conditional_abilities:u.conditional_abilities||{},
    conditional_keywords:u.conditional_keywords||{},
    conditional_restrict_items:u.conditional_restrict_items||{},
    restrict_ranged:u.restrict_ranged||false,
    restrict_grenades:u.restrict_grenades||false,
    restrict_shields:u.restrict_shields||false,
    restrict_equipment_to:u.restrict_equipment_to||null,
    restrict_ranged_to:u.restrict_ranged_to||null,
    restrict_grenades_to:u.restrict_grenades_to||null,
  };
}

async function loadData(){
  const resp=await fetch('/api/data');
  const raw=await resp.json();

  // Transform factions
  for(const[key,f]of Object.entries(raw.factions)){
    FACTIONS[key]={
      name:f.name, side:f.side, sins:(f.sin_selection&&f.sin_selection.sins)||f.sins||null,
      special_rules:f.special_rules||[],
      elites:(f.elites||[]).map(transformUnit),
      troops:(f.troops||[]).map(transformUnit),
      armoury:f.armoury||{},
    };
  }

  // Transform variants — group by parent
  for(const[parentKey,varList]of Object.entries(raw.variants)){
    VARIANTS[parentKey]=[{key:'standard',name:'Standard',desc:'Base warband.'}];
    varList.forEach(v=>{
      // Skip the synthetic standard the server also injects
      if(v.key==='standard')return;
      VARIANTS[parentKey].push({
        // Use the actual key from the server (filename-based), not a derived one
        key:v.key,
        name:v.name, desc:v.description||v.desc||'',
        restrict_units:v.restrict_units||[],
        restrict_mercenaries:v.restrict_mercenaries||false,
        restrict_mercenaries_list:v.restrict_mercenaries_list||[],
        limit_overrides:v.limit_overrides||{},
        cost_overrides:v.cost_overrides||{},
        remove_armoury:Array.isArray(v.remove_armoury)?v.remove_armoury:[],
        add_armoury:v.add_armoury||{},
        add_keywords_all:v.add_keywords_all||[],
        unit_replacements:v.unit_replacements||{},
        base_equip_remove:v.base_equip_remove||{},
        add_units:(v.add_units||[]).map(transformUnit),
        elite_overrides:v.elite_overrides||[],
        budget_override:v.budget_override||null,
        // Variant-conditional upgrades
        variant_unit_upgrades:v.variant_unit_upgrades||{},
        unit_stat_overrides:v.unit_stat_overrides||{},
        restrict_unit_upgrades:v.restrict_unit_upgrades||{},
        glory_cost_overrides:v.glory_cost_overrides||{},
        remove_restrictions:v.remove_restrictions||{},
        add_rules:v.add_rules||[],
        mutually_exclusive:v.mutually_exclusive||[],
      });
    });
  }
  // Ensure all factions have at least a standard variant
  for(const key of Object.keys(FACTIONS)){
    if(!VARIANTS[key]) VARIANTS[key]=[{key:'standard',name:'Standard',desc:'Base warband.'}];
  }

  // Transform mercenaries
  MERCENARIES=(raw.mercenaries||[]).map(m=>{
    const lim=parseLimit(m.limit);
    return{...m, min:lim.min, max:lim.max,
      available:m.available_to||m.available||[],
      movement:m.movement||'6"',
      ranged:m.ranged?m.ranged.replace(' DICE',''):'-',
      melee:m.melee?m.melee.replace(' DICE',''):'-',
      armour:m.armour||'0',
    };
  });

  // Load gear data
  if(raw.gear) Object.assign(GEAR, raw.gear);

  // Load Arcana Putrescere powers from Great Hunger variant
  const gh=raw.variants?.black_grail?.find(v=>v.key==='great_hunger');
  if(gh&&gh.arcana_putrescere) ARCANA_POWERS=gh.arcana_putrescere;

  // Extract Goetic Powers from Court faction data
  const court=raw.factions.court_serpent;
  if(court&&court.goetic_powers){
    for(const[sin,powers]of Object.entries(court.goetic_powers)){
      GOETIC_POWERS[sin]=powers.map(p=>({
        name:p.name, cost:p.cost,
        desc:p.effect||p.desc||'',
        for:p.restriction||'',
      }));
    }
  }
  if(court&&court.desecrated_saint_auras){
    Object.assign(SAINT_AURAS,court.desecrated_saint_auras);
  }

  console.log('Loaded:',Object.keys(FACTIONS).length,'factions',
    Object.values(VARIANTS).reduce((s,v)=>s+v.length-1,0),'variants',
    MERCENARIES.length,'mercenaries');
}

// ═══ STATE ═══
let selectedFaction=null,selectedVariant=null,selectedSin=null,roster=[],editingIndex=-1,currentUnit=null;
let limitsOverridden=false;
let allRestrictionsIgnored=false;

function updateConditionalItems(){
  // Re-evaluate canUseItem for all non-permanent disabled items
  // This unlocks items whose prerequisites have just been met (e.g. Heavy Ballistic Shield when Machine Armour ticked)
  document.querySelectorAll('#equip-picker .eq-item').forEach(label=>{
    const cb=label.querySelector('input');
    if(!cb||cb.dataset.perm==='1')return; // permanent restriction — skip
    const note=cb.dataset.note||'';
    if(!note||!note.toLowerCase().includes('only'))return; // no restriction note — skip
    const nowAllowed=allRestrictionsIgnored?true:canUseItem(note,currentUnit);
    const wasRestricted=label.classList.contains('eq-restricted');
    if(nowAllowed&&wasRestricted){
      label.classList.remove('eq-restricted');
      cb.disabled=false;
      // Remove lock icon
      label.querySelectorAll('.eq-lock').forEach(l=>l.remove());
    } else if(!nowAllowed&&!wasRestricted&&!cb.checked){
      label.classList.add('eq-restricted');
      cb.disabled=true;
    }
  });
}

function rebuildPickerOnUpgrade(changedCb){
  if(changedCb.checked && changedCb.dataset.group){
    document.querySelectorAll(`input[data-group="${changedCb.dataset.group}"]`).forEach(other=>{
      if(other !== changedCb) other.checked = false;
    });
  }
  setTimeout(()=>{
    updateConditionalItems();
    enforceEquipLimits();
    updateEditorCost();
  },0);
}
function toggleLimitOverride(){
  limitsOverridden=!limitsOverridden;
  const btn=document.getElementById('limit-override-btn');
  if(btn){
    btn.textContent=limitsOverridden?'🔓 Unit Limits':'🔒 Unit Limits';
    btn.style.color=limitsOverridden?'var(--gold)':'var(--rust)';
    btn.style.borderColor=limitsOverridden?'var(--gold)':'rgba(139,26,26,0.2)';
  }
  const tp=document.getElementById('type-picker');
  if(tp&&tp.style.display!=='none')showTypePicker();
}

function toggleAllRestrictions(){
  allRestrictionsIgnored=!allRestrictionsIgnored;
  const btn=document.getElementById('all-restrictions-btn');
  if(btn){
    btn.textContent=allRestrictionsIgnored?'⚠ Rules Ignored':'☠ Ignore All Rules';
    btn.style.color=allRestrictionsIgnored?'#ff4444':'var(--rust)';
    btn.style.borderColor=allRestrictionsIgnored?'#ff4444':'rgba(139,26,26,0.2)';
    btn.style.background=allRestrictionsIgnored?'rgba(255,68,68,0.08)':'none';
  }
  const tp=document.getElementById('type-picker');
  if(tp&&tp.style.display!=='none')showTypePicker();
}

// ═══ HELPERS ═══
function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');}
// HTML sanitization — prevents XSS from imported JSON data
function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function sanitizeStr(s){return typeof s==='string'?s.replace(/<[^>]*>/g,'').slice(0,500):String(s||'').slice(0,500);}
function sanitizeImport(data){
  // Validate structure
  if(!data||typeof data!=='object')throw new Error('Invalid format');
  if(!data._format||!String(data._format).startsWith('warband-forge'))throw new Error('Unknown format');
  if(!data.warband||typeof data.warband!=='object')throw new Error('Missing warband block');
  if(!data.units||!Array.isArray(data.units))throw new Error('Missing units array');
  if(data.units.length>50)throw new Error('Too many units (max 50)');
  // Sanitize all string fields
  const w=data.warband;
  w.name=sanitizeStr(w.name);
  w.faction=sanitizeStr(w.faction);
  w.variant=sanitizeStr(w.variant);
  w.sin=w.sin?sanitizeStr(w.sin):null;
  w.notes=sanitizeStr(w.notes);
  w.budget_ducats=Math.min(Math.max(parseInt(w.budget_ducats)||700,0),99999);
  w.budget_glory=Math.min(Math.max(parseInt(w.budget_glory)||0,0),999);
  data.units.forEach(u=>{
    u.type=sanitizeStr(u.type);
    u.name=sanitizeStr(u.name);
    u.id=sanitizeStr(u.id);
    u.sin_aura=u.sin_aura?sanitizeStr(u.sin_aura):'';
    u.base_cost=Math.min(Math.max(parseInt(u.base_cost)||0,0),9999);
    u.total_cost=Math.min(Math.max(parseInt(u.total_cost)||0,0),9999);
    u.glory_cost=Math.min(Math.max(parseInt(u.glory_cost)||0,0),999);
    u.is_elite=!!u.is_elite;u.is_merc=!!u.is_merc;
    if(Array.isArray(u.equipment))u.equipment=u.equipment.slice(0,20).map(e=>({name:sanitizeStr(e.name),cost:parseInt(e.cost)||0}));else u.equipment=[];
    if(Array.isArray(u.goetic_powers))u.goetic_powers=u.goetic_powers.slice(0,5).map(p=>({name:sanitizeStr(p.name),cost:parseInt(p.cost)||0}));else u.goetic_powers=[];
    // Strip __proto__ / constructor keys
    delete u.__proto__;delete u.constructor;
  });
  delete data.__proto__;delete data.constructor;
  return data;
}
function detailActive(on){document.getElementById('detail-panel').classList.toggle('has-content',on);}
function showEmpty(){document.getElementById('empty-detail').style.display='flex';document.getElementById('type-picker').style.display='none';document.getElementById('unit-editor').style.display='none';document.querySelectorAll('.r-unit').forEach(u=>u.classList.remove('selected'));detailActive(false);}
function cancelAdd(){showEmpty();}
function goBack(){if(roster.length&&!confirm('Go back? Warband will be lost.'))return;roster=[];selectedSin=null;showScreen('screen-faction');}

// Count how many of a given type are in roster
function countInRoster(type){return roster.filter(u=>u.type===type).length;}

// Get effective max for a unit type (considering variant overrides)
function getEffectiveMax(unitDef){
  const v=getVariant();
  if(v&&v.limit_overrides&&v.limit_overrides[unitDef.type]!==undefined){
    const ov=v.limit_overrides[unitDef.type];
    if(typeof ov==='number') return ov;
    const m=String(ov).match(/(\d+)-(\d+)/);
    if(m) return parseInt(m[2]);
    const m2=String(ov).match(/^(\d+)/);
    if(m2) return parseInt(m2[1]);
  }
  return unitDef.max;
}

function getVariant(){return(VARIANTS[selectedFaction]||[]).find(v=>v.key===selectedVariant)||null;}
function isRestricted(type){const v=getVariant();return v&&v.restrict_units&&v.restrict_units.includes(type);}
function isMutuallyExcluded(type){
  const v=getVariant();
  if(!v||!v.mutually_exclusive)return false;
  return v.mutually_exclusive.some(group=>{
    if(!group.includes(type))return false;
    return group.filter(t=>t!==type).some(t=>roster.some(u=>u.type===t));
  });
}

// ═══ SCREEN 1 ═══
function pickFaction(btn){
  document.querySelectorAll('.faction-btn').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedFaction=btn.dataset.key;selectedVariant='standard';selectedSin=null;limitsOverridden=false;allRestrictionsIgnored=false;
  const lb=document.getElementById('limit-override-btn');
  if(lb){lb.textContent='🔒 Unit Limits';lb.style.color='var(--rust)';lb.style.borderColor='rgba(139,26,26,0.2)';}
  const ab=document.getElementById('all-restrictions-btn');
  if(ab){ab.textContent='☠ Ignore All Rules';ab.style.color='var(--rust)';ab.style.borderColor='rgba(139,26,26,0.2)';ab.style.background='none';}
  const vs=VARIANTS[selectedFaction]||[];
  const sel=document.getElementById('variant-selector'),opts=document.getElementById('variant-options');
  opts.innerHTML='';  // Clear all previous variant buttons
  vs.forEach(v=>{const el=document.createElement('button');el.className='variant-opt'+(v.key==='standard'?' selected':'');
    el.innerHTML=`<span class="vo-name">${v.name}</span><span class="vo-desc">${v.desc}</span>`;
    el.onclick=()=>{opts.querySelectorAll('.variant-opt').forEach(o=>o.classList.remove('selected'));el.classList.add('selected');selectedVariant=v.key;};
    opts.appendChild(el);});
  sel.classList.add('visible');
  // Sin selector for Court
  const sinSel=document.getElementById('sin-selector'),sinOpts=document.getElementById('sin-options');
  const f=FACTIONS[selectedFaction];
  if(f.sins){
    sinOpts.innerHTML='';
    f.sins.forEach((sin,i)=>{
      const el=document.createElement('button');
      el.className='variant-opt'+(i===0?' selected':'');
      const aura=SAINT_AURAS[sin]||'';
      el.innerHTML=`<span class="vo-name">${sin}</span><span class="vo-desc">Desecrated Saint: ${aura}</span>`;
      el.onclick=()=>{sinOpts.querySelectorAll('.variant-opt').forEach(o=>o.classList.remove('selected'));el.classList.add('selected');selectedSin=sin;};
      sinOpts.appendChild(el);
    });
    selectedSin=f.sins[0];
    sinSel.style.display='block';sinSel.classList.add('visible');
  } else {
    sinSel.style.display='none';sinSel.classList.remove('visible');
  }
  document.getElementById('start-btn').classList.add('visible');
}
function startBuilder(){
  if(!selectedFaction)return;const f=FACTIONS[selectedFaction];
  document.getElementById('wb-faction-label').textContent=f.name;
  const v=getVariant(),vl=document.getElementById('wb-variant-label');
  let variantText='';
  if(selectedVariant!=='standard'&&v){variantText=v.name;}
  if(selectedSin){variantText=(variantText?variantText+' · ':'')+'Sin of '+selectedSin;}
  if(variantText){vl.textContent=variantText;vl.style.display='block';if(v&&selectedVariant!=='standard')showVariantBanner(v);}
  else{vl.style.display='none';document.getElementById('variant-banner').style.display='none';}
  // Apply variant budget override (e.g. Papal States: 500D + 11 Glory)
  const bo=v&&v.budget_override;
  if(bo){
    document.getElementById('d-budget').value=bo.ducats||700;
    document.getElementById('g-budget').value=bo.glory||0;
  } else {
    document.getElementById('d-budget').value=700;
    document.getElementById('g-budget').value=0;
  }
  roster=[];renderRoster();showEmpty();showScreen('screen-builder');
}
function showVariantBanner(v){
  const b=document.getElementById('variant-banner');b.style.display='block';
  document.getElementById('vb-name').textContent=v.name;
  const r=document.getElementById('vb-rules');r.innerHTML='';
  if(v.restrict_units&&v.restrict_units.length)r.innerHTML+=`<div class="vb-rule">Cannot include: ${v.restrict_units.join(', ')}</div>`;
  if(v.restrict_mercenaries)r.innerHTML+=`<div class="vb-rule">Cannot include Mercenaries</div>`;
  if(v.limit_overrides)Object.entries(v.limit_overrides).forEach(([k,lim])=>r.innerHTML+=`<div class="vb-rule">${k}: max ${lim}</div>`);
  if(v.remove_armoury&&v.remove_armoury.length)r.innerHTML+=`<div class="vb-rule">Removed from armoury: ${v.remove_armoury.join(', ')}</div>`;
  if(v.add_keywords_all&&v.add_keywords_all.length)r.innerHTML+=`<div class="vb-rule">All models gain: ${v.add_keywords_all.join(', ')}</div>`;
  if(v.unit_replacements)Object.entries(v.unit_replacements).forEach(([orig,rep])=>r.innerHTML+=`<div class="vb-rule">${orig} → ${rep.new_type}</div>`);
}

// ═══ TYPE PICKER (with limits + counts + variant rules) ═══
let _pickerUnits=[];  // store units for safe onclick lookup
function showTypePicker(){
  const f=FACTIONS[selectedFaction],v=getVariant()||{};
  const replacements=v.unit_replacements||{};
  _pickerUnits=[];
  let html='<h3>Choose a Unit Type</h3>';

  const renderUnit=(u,isElite)=>{
    let displayUnit={...u};
    const rep=replacements[u.type];
    if(rep){
      displayUnit={...u, type:rep.new_type||u.type, abilities:rep.abilities||u.abilities};
    }
    // A unit with a replacement is available under its new name — never show as restricted
    const restricted=allRestrictionsIgnored?false:(rep?false:(isRestricted(u.type)||isMutuallyExcluded(displayUnit.type)));
    const max=getEffectiveMax(u);
    const actualCount=countInRoster(displayUnit.type);
    const maxed=!limitsOverridden&&!allRestrictionsIgnored&&actualCount>=max;
    const needsMore=!allRestrictionsIgnored&&u.min&&u.min>0&&actualCount<u.min;
    let cls=restricted?'restricted':maxed?'maxed':'';
    let countBadge='';
    if(restricted)countBadge=`<span class="tp-count full">Restricted</span>`;
    else if(allRestrictionsIgnored)countBadge=`<span class="tp-count available" style="color:#ff4444;border-color:#ff4444;">${actualCount} ☠</span>`;
    else if(limitsOverridden&&max<99)countBadge=`<span class="tp-count available" style="color:var(--gold);border-color:var(--gold);">${actualCount}/${max} 🔓</span>`;
    else if(maxed)countBadge=`<span class="tp-count full">${actualCount}/${max} MAX</span>`;
    else if(needsMore)countBadge=`<span class="tp-count required">${actualCount}/${u.min} NEED</span>`;
    else if(max<99)countBadge=`<span class="tp-count available">${actualCount}/${max}</span>`;
    const clickable=!restricted&&!maxed;
    const idx=_pickerUnits.length;
    _pickerUnits.push({unit:displayUnit,isElite,isMerc:false});
    return`<div class="tp-unit ${cls}" ${clickable?`onclick="pickUnit(${idx})"`:''}">
      <span class="tp-name">${displayUnit.type}</span>
      <span class="tp-stats">${displayUnit.movement} R:${displayUnit.ranged} M:${displayUnit.melee} A:${displayUnit.armour}</span>
      <span class="tp-cost">${displayUnit.base_cost}D</span>
      ${countBadge}
    </div>`;
  };

  html+='<div class="tp-section">‡ Elites ‡</div>';
  f.elites.forEach(u=>html+=renderUnit(u,true));
  // Troops promoted to ELITE by variant (e.g. Janissary in Defenders)
  const eliteOv=v.elite_overrides||[];
  if(eliteOv.length){
    f.troops.filter(u=>eliteOv.includes(u.type)).forEach(u=>html+=renderUnit(u,true));
  }
  // Variant-added ELITE units — skip any type already covered by a unit_replacement
  // (e.g. Barbed Wire Banshee in Trench Ghosts replaces Chorister — don't show it twice)
  const replacedTypes=new Set(Object.values(replacements).map(r=>r.new_type).filter(Boolean));
  if(v.add_units&&v.add_units.length){
    v.add_units
      .filter(u=>u.keywords&&u.keywords.some(k=>k.toUpperCase()==='ELITE'))
      .filter(u=>!replacedTypes.has(u.type))
      .forEach(u=>html+=renderUnit(u,true));
  }
  html+='<div class="tp-section">† Troops †</div>';
  f.troops.filter(u=>!eliteOv.includes(u.type)).forEach(u=>html+=renderUnit(u,false));
  // Variant-added TROOP units — skip replaced types
  if(v.add_units&&v.add_units.length){
    v.add_units
      .filter(u=>!(u.keywords&&u.keywords.some(k=>k.toUpperCase()==='ELITE')))
      .filter(u=>!replacedTypes.has(u.type))
      .forEach(u=>html+=renderUnit(u,false));
  }

  // Mercenaries (blocked entirely if variant says so)
  if(!v.restrict_mercenaries){
    const mercs=MERCENARIES.filter(m=>m.available.includes(selectedFaction));
    if(mercs.length){
      html+='<div class="tp-section glory-sec">☼ Mercenaries ☼</div>';
      mercs.forEach(m=>{
        const count=countInRoster(m.type),maxed=count>=m.max;
        const badge=maxed?`<span class="tp-count full">${count}/${m.max} MAX</span>`:`<span class="tp-count available">${count}/${m.max}</span>`;
        const idx=_pickerUnits.length;
        _pickerUnits.push({unit:m,isElite:true,isMerc:true});
        html+=`<div class="tp-unit ${maxed?'maxed':''}" ${maxed?'':`onclick="pickUnit(${idx})"`}>
          <span class="tp-name">${m.type}</span><span class="tp-stats">${m.movement} R:${m.ranged} M:${m.melee} A:${m.armour}</span>
          <span class="tp-cost glory-cost">${m.cost}☼</span>${badge}</div>`;
      });
    }
  } else {
    html+='<div class="tp-section glory-sec" style="opacity:0.3;">☼ Mercenaries — blocked by variant ☼</div>';
  }

  html+='<div style="margin-top:0.6rem;"><button class="btn-cancel" onclick="cancelAdd()">Cancel</button></div>';
  const p=document.getElementById('type-picker');p.innerHTML=html;
  document.getElementById('empty-detail').style.display='none';p.style.display='block';document.getElementById('unit-editor').style.display='none';editingIndex=-1;detailActive(true);
}

// ═══ UNIT EDITOR ═══
function pickUnit(idx){
  const entry=_pickerUnits[idx];if(!entry)return;
  const v=getVariant()||{};
  const overrides=(v.unit_stat_overrides||{})[entry.unit.type]||{};
  const removeRestrictions=(v.remove_restrictions||{})[entry.unit.type]||[];
  let unitData={...entry.unit, ...overrides, isElite:entry.isElite, isMerc:entry.isMerc};
  // Apply variant remove_restrictions (e.g. Saint Methodius removes restrict_armoury from Anchorite)
  removeRestrictions.forEach(flag=>{unitData[flag]=false;});
  currentUnit=unitData;
  openEditor();
}

function openEditor(){
  const u=currentUnit;
  document.getElementById('empty-detail').style.display='none';document.getElementById('type-picker').style.display='none';document.getElementById('unit-editor').style.display='block';detailActive(true);
  document.getElementById('ue-type-name').textContent=u.type;
  document.getElementById('ue-name-input').value='';
  document.getElementById('ue-stats').innerHTML=['Movement','Ranged','Melee','Armour','Base Cost'].map((l,i)=>{
    const vals=[u.movement,u.ranged,u.melee,u.armour,u.isMerc?u.cost+'☼':u.base_cost+'D'];
    return`<div class="ue-stat"><div class="s-label">${l}</div><div class="s-val">${vals[i]}</div></div>`;}).join('');
  const v=getVariant()||{};
  const addedKw=v.add_keywords_all||[];
  document.getElementById('ue-keywords').innerHTML=
    (u.keywords||[]).map(k=>`<span class="kw-tag">${k}</span>`).join('')+
    addedKw.map(k=>`<span class="kw-tag added">+${k}</span>`).join('');
  document.getElementById('ue-abilities').innerHTML='<h4>Abilities</h4>'+(u.abilities||[]).map(a=>`<div class="abil-item">${a}</div>`).join('');
  // Base equipment — remove items if variant says so
  let baseEq=(u.base_equipment||[]).slice();
  const eqRemove=(v.base_equip_remove&&v.base_equip_remove[u.type])||[];
  baseEq=baseEq.filter(e=>!eqRemove.includes(e));
  const beq=document.getElementById('ue-base-eq');
  if(baseEq.length){beq.style.display='block';beq.innerHTML='Included: <span>'+baseEq.join(', ')+'</span>';}else beq.style.display='none';
  currentUnit._effectiveBaseEq=baseEq;
  buildEquipPicker();buildGoeticPicker();buildArcanaPicker();updateEditorCost();
}
function buildGoeticPicker(){
  const picker=document.getElementById('goetic-picker');
  const list=document.getElementById('goetic-list');
  const u=currentUnit;
  // Only show for Court ELITE with Goetic Power slots
  if(selectedFaction!=='court_serpent'||!u.isElite||u.isMerc||(u.gp_max===0&&(!u.gp_free||u.gp_free.length===0))){
    picker.style.display='none';return;
  }
  picker.style.display='block';
  const max=u.gp_max||0;
  const free=u.gp_free||[];
  document.getElementById('gp-slots').textContent=max>0?`(${max} slots available)`:'(built-in only)';
  let html='';
  // Free/built-in powers (shown but not checkable)
  free.forEach(name=>{
    html+=`<div class="gp-item gp-free"><input type="checkbox" checked disabled><div class="gp-info"><div class="gp-name">${name}</div></div><div class="gp-cost">free</div></div>`;
  });
  if(max>0){
    // Available powers: Universal + selected Sin
    const available=[...GOETIC_POWERS.Universal];
    if(selectedSin&&GOETIC_POWERS[selectedSin])available.push(...GOETIC_POWERS[selectedSin]);
    available.forEach(p=>{
      if(free.includes(p.name))return;
      const costStr=typeof p.cost==='number'?p.cost+'D':p.cost;
      html+=`<label class="gp-item"><input type="checkbox" class="gp-check" data-cost="${typeof p.cost==='number'?p.cost:0}" data-name="${p.name}" onchange="updateGoeticSlots()"><div class="gp-info"><div class="gp-name">${p.name}</div><div class="gp-desc">${p.desc}</div><div class="gp-for">${p.for||''}</div></div><div class="gp-cost">${costStr}</div></label>`;
    });
  }
  list.innerHTML=html;
}
function toggleDual(btn,event){
  event.preventDefault();event.stopPropagation();
  btn.classList.toggle('active');
  enforceEquipLimits();updateEditorCost();
}
function updateGoeticSlots(){
  const u=currentUnit;if(!u)return;
  const max=u.gp_max||0;
  const checked=document.querySelectorAll('.gp-check:checked').length;
  document.getElementById('gp-slots').textContent=`(${checked}/${max} slots used)`;
  // Disable unchecked if at max
  document.querySelectorAll('.gp-check:not(:checked)').forEach(cb=>{cb.disabled=checked>=max;});
  document.querySelectorAll('.gp-check:checked').forEach(cb=>{cb.disabled=false;});
  updateEditorCost();
}
function buildArcanaPicker(){
  const picker=document.getElementById('arcana-picker');
  const list=document.getElementById('arcana-list');
  const u=currentUnit;
  // Only show for Great Hunger units with ap_max
  const isGH=selectedVariant==='great_hunger'||((getVariant()||{}).key==='great_hunger');
  if(!isGH||!u.ap_max||u.ap_max===0){picker.style.display='none';return;}
  picker.style.display='block';
  const max=u.ap_max||3;
  document.getElementById('ap-slots').textContent=`(${max} slots available)`;
  let html='';
  ARCANA_POWERS.forEach(p=>{
    const costStr=typeof p.cost==='number'?p.cost+'D':p.cost;
    const typeStr=p.type?`${p.type}${p.spell_cost?' · '+p.spell_cost+' marker(s)':''}`:'' ;
    const whoStr=p.who?`<div class="ap-who">${p.who}</div>`:'';
    html+=`<label class="ap-item"><input type="checkbox" class="ap-check" data-cost="${typeof p.cost==='number'?p.cost:0}" data-name="${p.name}" onchange="updateArcanaSlots()"><div class="ap-info"><div class="ap-name">${p.name}</div><div class="ap-type">${typeStr}</div><div class="ap-desc">${p.description||''}</div>${whoStr}</div><div class="ap-cost">${costStr}</div></label>`;
  });
  list.innerHTML=html;
}
function updateArcanaSlots(){
  const u=currentUnit;if(!u)return;
  const max=u.ap_max||3;
  const checked=document.querySelectorAll('.ap-check:checked').length;
  document.getElementById('ap-slots').textContent=`(${checked}/${max} slots used)`;
  document.querySelectorAll('.ap-check:not(:checked)').forEach(cb=>{cb.disabled=checked>=max;});
  document.querySelectorAll('.ap-check:checked').forEach(cb=>{cb.disabled=false;});
  updateEditorCost();
}
function canUseItem(note,unit){
  if(!note)return true;
  const n=note.toLowerCase();
  if(!n.includes('only'))return true;
  const uType=(unit.type||'').toLowerCase();
  const uKw=(unit.keywords||[]).map(k=>k.toLowerCase());
  // Check currently selected equipment AND unit upgrades in the picker
  const uEquip=[];
  document.querySelectorAll('#equip-picker input:checked').forEach(cb=>{
    const nm=cb.dataset.name||cb.closest('.eq-item')?.querySelector('.eq-name')?.textContent||'';
    if(nm)uEquip.push(nm.toLowerCase());
  });
  // Base equipment on THIS unit only (not previous unit's equip from roster)
  (unit.base_equipment||[]).forEach(e=>uEquip.push(e.toLowerCase()));
  let before=n.split('only')[0].trim();
  ['consumable','headgear','shield combo','bayonet lug'].forEach(w=>{before=before.replace(new RegExp(w,'gi'),'');});
  before=before.replace(/limit:\s*\d+(\s*\([^)]*\))?/gi,'');
  before=before.replace(/^[,\s]+|[,\s]+$/g,'').replace(/,\s*,/g,',').trim();
  if(!before)return true;
  const reqs=before.split(/[\/&,]/).map(s=>s.trim()).filter(Boolean);
  if(!reqs.length)return true;
  return reqs.some(req=>{
    if(uType.includes(req))return true;
    const singular=req.endsWith('ies')?req.slice(0,-3)+'y':req.endsWith('s')?req.slice(0,-1):req;
    const plural=req.endsWith('s')?req:req+'s';
    if(uType.includes(singular)||uType.includes(plural))return true;
    if(uKw.some(k=>k.includes(req)||k.includes(singular)))return true;
    if(uEquip.some(e=>e.includes(req)||e.includes(singular)))return true;
    return false;
  });
}
// ═══ GEAR LOOKUP — reads from GEAR object loaded via /api/data ═══════════════
// Returns the gear entry for an item name, or null if not found
function gearGet(name){
  return GEAR[name]||null;
}
// Returns hands string ('1H','2H','special','') from gear data
function getHands(name,cat){
  const g=gearGet(name);
  if(g&&g.hands)return g.hands;
  // Fallback defaults if somehow not in gear
  if(cat==='Ranged Weapons')return '2H';
  if(cat==='Melee Weapons')return '1H';
  return '';
}
// Returns true if item has the HEAVY keyword
function gearIsHeavy(name){
  const g=gearGet(name);
  return g?!!g.heavy:false;
}
// Parse a gear entry into the structured object previously returned by parseWI()
// Returns null if item not in gear or not a displayable weapon/shield/armour
function gearParse(name){
  const g=gearGet(name);
  if(!g)return null;
  const cat=g.cat; // 'ranged'|'melee'|'grenade'|'shield'|'armour'|'equipment'
  const isWeapon=(cat==='ranged'||cat==='melee'||cat==='grenade');
  const isArmour=(cat==='armour');
  const isShield=(cat==='shield');
  const isEquip=(cat==='equipment');
  const isRanged=(cat==='ranged');
  const isMelee=(cat==='melee');
  const isGrenade=(cat==='grenade');
  const isDual=g.range&&(g.range.includes('/Melee')||g.range.includes('Melee/'));
  // Build display keywords string — inj_mod and inj_dice go into keywords for display
  const kws=[...(g.keywords||[])];
  if(g.note)kws.push(g.note);
  const injModStr=g.inj_mod&&g.inj_mod!==0?`${g.inj_mod>0?'+':''}${g.inj_mod} INJ MOD`:'';
  const injDiceStr=g.inj_dice&&g.inj_dice!==0?`${g.inj_dice>0?'+':''}${g.inj_dice} INJ`:'';
  // injMod goes at the front for armour/shield display
  if(injModStr&&(isArmour||isShield))kws.unshift(injModStr);
  else if(injModStr)kws.push(injModStr);
  return{
    cat:isWeapon?'weapon':isArmour?'armour':isShield?'shield':'equipment',
    hands:g.hands||'',
    range:g.range||'',
    diceMod:g.dice_mod||0,
    injDice:g.inj_dice||0,
    injMod:g.inj_mod||0,
    injModStr,
    injDiceStr,
    keywords:kws.join(', '),
    isRanged:isRanged||isDual,
    isMelee:isMelee||isDual,
    isGrenade,
    isDual,
  };
}

function enforceEquipLimits(){
  const checks=document.querySelectorAll('#equip-picker input[type="checkbox"]');
  // Count checked items by category
  const sel={ranged1H:0,ranged2H:0,melee1H:0,melee2H:0,grenades:0,armour:0,shields:0,headgear:0};
  const equipNames=new Set();
  let hasShield=false;
  // Check for exclusive items (block everything else when checked)
  let hasSarcophagus=false; // blocks ALL other battlekit
  let hasTankPalanquin=false; // blocks shield
  checks.forEach(cb=>{
    if(!cb.checked)return;
    const cat=cb.dataset.cat||'';
    const hands=cb.dataset.hands||'';
    const name=cb.dataset.name||'';
    const note=cb.dataset.note||'';
    if(name==='Sarcophagus Mine')hasSarcophagus=true;
    if(name==='Tank Palanquin')hasTankPalanquin=true;
    if(cat==='Ranged Weapons'){
      const isDual=cb.closest('.eq-item')?.querySelector('.eq-dual-btn.active');
      if(hands==='1H')sel.ranged1H+=isDual?2:1;else sel.ranged2H++;
    }
    if(cat==='Melee Weapons'){
      const isDual=cb.closest('.eq-item')?.querySelector('.eq-dual-btn.active');
      if(hands==='2H')sel.melee2H++;else sel.melee1H+=isDual?2:1;
    }
    if(cat==='Grenades')sel.grenades++;
    if(cat==='Armour')sel.armour++;
    if(cat==='Shields'){sel.shields++;hasShield=true;}
    if(note.toLowerCase().includes('headgear'))sel.headgear++;
    if(cat==='Equipment')equipNames.add(name);
  });
  // Now disable/enable unchecked items based on limits
  checks.forEach(cb=>{
    if(cb.checked||cb.disabled&&cb.dataset.perm==='1')return;
    const cat=cb.dataset.cat||'';
    const hands=cb.dataset.hands||'';
    const name=cb.dataset.name||'';
    const note=cb.dataset.note||'';
    let blocked=false,reason='';
    // Sarcophagus Mine: Walking Bomb rule — cannot have ANY other battlekit
    if(hasSarcophagus){blocked=true;reason='Walking Bomb: no other Battlekit allowed';}
    // Tank Palanquin: cannot have a Shield (Bulky rule)
    if(!blocked&&hasTankPalanquin&&cat==='Shields'){blocked=true;reason='Tank Palanquin: no Shield (Bulky)';}
    // Ranged: 1×2H or 2×1H
    if(!blocked&&cat==='Ranged Weapons'){
      if(sel.ranged2H>0){blocked=true;reason='Already have a 2H ranged weapon';}
      else if(hands==='2H'&&sel.ranged1H>0){blocked=true;reason='Already have 1H ranged';}
      else if(hands==='1H'&&sel.ranged1H>=2){blocked=true;reason='Max 2 × 1H ranged';}
      if(hasShield){
        if(hands==='2H'){
          const shieldCombo=note.toLowerCase().includes('shield combo');
          if(!shieldCombo){blocked=true;reason='Shield blocks 2H (no Shield Combo)';}
        }
        if(hands==='1H'&&sel.ranged1H>=1){blocked=true;reason='Shield: max 1 × 1H ranged';}
      }
    }
    // Melee: 1×2H or 2×1H
    if(!blocked&&cat==='Melee Weapons'){
      if(sel.melee2H>0){blocked=true;reason='Already have a 2H melee weapon';}
      else if(hands==='2H'&&sel.melee1H>0){blocked=true;reason='Already have 1H melee';}
      else if(hands==='1H'&&sel.melee1H>=2){blocked=true;reason='Max 2 × 1H melee';}
      if(hasShield){
        if(hands==='2H'){
          const shieldCombo=note.toLowerCase().includes('shield combo');
          if(!shieldCombo){blocked=true;reason='Shield blocks 2H (no Shield Combo)';}
        }
        if(hands==='1H'&&sel.melee1H>=1){blocked=true;reason='Shield: max 1 × 1H melee';}
      }
    }
    // Grenades: 1 type
    if(!blocked&&cat==='Grenades'&&sel.grenades>=1){blocked=true;reason='Max 1 grenade type';}
    // Unit-level ranged restriction (e.g. Artillery Witch)
    if(!blocked&&cat==='Ranged Weapons'&&currentUnit.restrict_ranged){blocked=true;reason='This unit cannot have Ranged Weapons';}
    // Unit-level grenade restriction (e.g. Artillery Witch)
    if(!blocked&&cat==='Grenades'&&currentUnit.restrict_grenades){blocked=true;reason='This unit cannot have Grenades';}
    // Conditional item restrictions (e.g. Machine Armour blocks Trench Shield)
    if(!blocked&&currentUnit.conditional_restrict_items){
      const checkedEquip=new Set();
      document.querySelectorAll('#equip-picker input:checked').forEach(cb2=>{
        checkedEquip.add(cb2.dataset.name||cb2.closest('.eq-item')?.querySelector('.eq-name')?.textContent||'');
      });
      for(const[triggerItem,blockedItems]of Object.entries(currentUnit.conditional_restrict_items)){
        if(checkedEquip.has(triggerItem)&&blockedItems.includes(name)){
          blocked=true;reason=`${triggerItem} restricts this item`;
        }
      }
    }
    // Armour: 1
    if(!blocked&&cat==='Armour'&&sel.armour>=1){blocked=true;reason='Max 1 armour';}
    // Shields: 1
    if(!blocked&&cat==='Shields'&&sel.shields>=1){blocked=true;reason='Max 1 shield';}
    // Headgear: 1
    if(!blocked&&note.toLowerCase().includes('headgear')&&sel.headgear>=1){blocked=true;reason='Max 1 headgear';}
    // Equipment: no duplicates
    if(!blocked&&cat==='Equipment'&&equipNames.has(name)){blocked=true;reason='Already have this';}
    cb.disabled=blocked;
    cb.closest('label').classList.toggle('eq-limit-blocked',blocked);
  });
}

function buildEquipPicker(){
  const f=FACTIONS[selectedFaction],p=document.getElementById('equip-picker');
  if(currentUnit.isMerc&&!currentUnit.merc_can_equip){p.innerHTML='<div style="font-size:0.7rem;color:#908070;font-style:italic;padding:0.4rem 0;">Mercenaries come fully equipped.</div>';return;}

  // ═══ RESTRICTED ARMOURY (e.g. Ecclesiastic Prisoner, Anchorite) ═══
  if(currentUnit.restrict_armoury){
    const vv=getVariant()||{};
    let upgrades=currentUnit.unit_upgrades||[];
    const varRes=(vv.restrict_unit_upgrades||{})[currentUnit.type]||[];
    if(varRes.length)upgrades=upgrades.filter(u=>!varRes.includes(u[0]));
    if(!upgrades.length){
      p.innerHTML='<div style="font-size:0.7rem;color:#908070;font-style:italic;padding:0.4rem 0;">This unit cannot take additional equipment.</div>';
      return;
    }
    let html='<div class="equip-section"><div class="eq-cat-title">Unit Upgrades <span class="toggle">▸</span></div><div class="eq-items collapsed">';
    const wbCounts2={};
    roster.forEach((ru,ri)=>{if(ri===editingIndex)return;(ru.equip||[]).forEach(e=>{wbCounts2[e]=(wbCounts2[e]||0)+1;});});
    upgrades.forEach(item=>{
      const name=item[0],cost=item[1],note=item[2]||'',wbLimit=item.length>=4?item[3]:null;
      const costStr=typeof cost==='number'?cost+'D':cost;
      const costVal=typeof cost==='number'?cost:0;
      let wbBlocked=false,wbLock='';
      if(wbLimit!==null){const used=wbCounts2[name]||0;if(used>=wbLimit){wbBlocked=true;wbLock=` <span class="eq-lock">🔒 Limit ${wbLimit}</span>`;}}
      const cls=wbBlocked?'eq-limit-blocked':'';
      html+=`<label class="eq-item ${cls}"><input type="checkbox" data-cost="${costVal}" data-cat="Unit Upgrades" data-name="${esc(name)}" data-note="${esc(note)}" ${wbBlocked?'disabled data-perm="1"':''} data-group="${item[4]||''}" onchange="rebuildPickerOnUpgrade(this)"><span class="eq-name">${esc(name)}</span><span class="eq-cost">${costStr}</span>${note?`<span class="eq-note">${esc(note)}</span>`:''}${wbLock}</label>`;
    });
    html+='</div></div>';
    p.innerHTML=html;
    return;
  }

  // ═══ NORMAL ARMOURY WITH ENFORCEMENT ═══
  const v=getVariant()||{};
  const overrides=(v.cost_overrides)||{};
  const removed=Array.isArray(v.remove_armoury)?v.remove_armoury:[];
  const added=v.add_armoury||{};
  let merged={};
  for(const[cat,items]of Object.entries(f.armoury)){
    merged[cat]=items.filter(item=>!removed.includes(item[0]));
  }
  for(const[cat,items]of Object.entries(added)){
    if(!merged[cat])merged[cat]=[];
    items.forEach(item=>merged[cat].push(item));
  }
  let html='';
  for(const[cat,items]of Object.entries(merged)){
    if(!items.length)continue;
    // For units with armour included in base cost, skip the Armour category entirely
    // Their armour options are handled via unit_upgrades instead
    if(!allRestrictionsIgnored&&currentUnit.restrict_armour_purchase&&cat==='Armour')continue;
    if(!allRestrictionsIgnored&&currentUnit.restrict_shields&&cat==='Shields')continue;
    // For units restricted to specific equipment only (e.g. Lion of Jabir: Wind Amulet only)
    // Items are filtered per-item below
    html+=`<div class="equip-section"><div class="eq-cat-title" onclick="this.nextElementSibling.classList.toggle('collapsed');this.querySelector('.toggle').textContent=this.nextElementSibling.classList.contains('collapsed')?'▸':'▾';">
      ${cat} <span class="toggle">▸</span></div><div class="eq-items collapsed">`;
    items.forEach(item=>{
      const name=item[0];
      let cost=item[1],note=item[2]||'';
      let modified=false;
      if(overrides[name]!==undefined){cost=overrides[name];modified=true;}
      if(currentUnit.cost_overrides&&currentUnit.cost_overrides[name]!==undefined){cost=currentUnit.cost_overrides[name];modified=true;}
      // Skip equipment items not in the allowed list (e.g. Lion of Jabir: Wind Amulet only)
      if(!allRestrictionsIgnored&&currentUnit.restrict_equipment_to&&cat==='Equipment'){
        if(!currentUnit.restrict_equipment_to.includes(name))return;
      }
      // Allowlist restrictions (e.g. Death Commando: Silenced Pistol only, Gas Grenades only)
      if(!allRestrictionsIgnored&&currentUnit.restrict_ranged_to&&cat==='Ranged Weapons'){
        if(!currentUnit.restrict_ranged_to.includes(name))return;
      }
      if(!allRestrictionsIgnored&&currentUnit.restrict_grenades_to&&cat==='Grenades'){
        if(!currentUnit.restrict_grenades_to.includes(name))return;
      }
      const costStr=typeof cost==='number'?cost+'D':cost;
      const costVal=typeof cost==='number'?cost:0;
      const allowed=allRestrictionsIgnored?true:canUseItem(note,currentUnit);
      // Weapon keyword restriction (e.g. Brazen Bull = HEAVY only)
      const wkOnly=currentUnit.weapon_keyword_only;
      let wkBlocked=false;
      if(!allRestrictionsIgnored&&wkOnly&&(cat==='Ranged Weapons'||cat==='Melee Weapons')){
        if(!gearIsHeavy(name)){wkBlocked=true;}
      }
      const cls=(!allowed||wkBlocked)?'eq-restricted':'';
      const lockIcon=(!allowed&&note)?` <span class="eq-lock">🔒 ${note}</span>`:(wkBlocked?` <span class="eq-lock">🔒 ${wkOnly} only</span>`:'');
      const modCls=modified?'modified':'';
      const hands=getHands(name,cat);
      const itemDisabled=!allowed||wkBlocked;
      // Build compact info string from gear data for picker display
      const gp=gearParse(name);
      let wInfo='';
      if(gp&&gp.cat==='weapon'){
        const parts=[];
        if(gp.range)parts.push(gp.range);
        if(gp.diceMod!==0)parts.push((gp.diceMod>0?'+':'')+gp.diceMod+'d');
        if(gp.injDiceStr)parts.push(gp.injDiceStr);
        if(gp.injModStr)parts.push(gp.injModStr);
        if(gp.keywords)parts.push(gp.keywords);
        wInfo=parts.join(', ');
      } else if(gp&&(gp.cat==='armour'||gp.cat==='shield')){
        wInfo=gp.keywords||'';
      }
      // For 1H weapons: show a ×2 toggle so users can take two identical weapons
      const is1H=(cat==='Ranged Weapons'||cat==='Melee Weapons')&&hands==='1H';
      const dualBtn=is1H&&!itemDisabled?` <button class="eq-dual-btn" data-cost="${costVal}" data-name="${esc(name)}" data-cat="${cat}" data-hands="${hands}" onclick="toggleDual(this,event)" title="Take two of this weapon">×2</button>`:'';
      html+=`<label class="eq-item ${cls}"><input type="checkbox" data-cost="${costVal}" data-cat="${cat}" data-hands="${hands}" data-name="${esc(name)}" data-note="${esc(note)}" ${wkBlocked?'disabled data-perm="1"':itemDisabled?'disabled':''} onchange="enforceEquipLimits();updateConditionalItems();updateEditorCost()"><span class="eq-name">${name}</span>${wInfo?`<span class="eq-info">${wInfo}</span>`:''}<span class="eq-cost ${modCls}">${costStr}</span>${note&&!itemDisabled?`<span class="eq-note">${note}</span>`:''}${lockIcon}${dualBtn}</label>`;
    });
    html+='</div></div>';
  }
  // Add unit-specific upgrades if any (alongside normal armoury)
  let upgrades=(currentUnit.unit_upgrades||[]).slice();
  // Variant can add upgrades for specific units (e.g. Éire Rangers Fianna for Shock Troopers)
  const variantAdd=(v.variant_unit_upgrades||{})[currentUnit.type]||[];
  upgrades=upgrades.concat(variantAdd);

 
  // Variant can restrict certain upgrades (e.g. Saint Methodius blocks Martyrdom Device)
  const variantRestrict=(v.restrict_unit_upgrades||{})[currentUnit.type]||[];
  if(variantRestrict.length)upgrades=upgrades.filter(u=>!variantRestrict.includes(u[0]));
  if(upgrades.length){
    // Count named upgrades already used across other roster units
    const wbUpgradeCounts={};
    roster.forEach((ru,ri)=>{
      if(ri===editingIndex)return;
      (ru.equip||[]).forEach(e=>{wbUpgradeCounts[e]=(wbUpgradeCounts[e]||0)+1;});
    });
    html+='<div class="equip-section"><div class="eq-cat-title" onclick="this.nextElementSibling.classList.toggle(\'collapsed\');this.querySelector(\'.toggle\').textContent=this.nextElementSibling.classList.contains(\'collapsed\')?\'▸\':\'▾\';">Unit Upgrades ▸</span></div><div class="eq-items collapsed">';
    upgrades.forEach(item=>{
      const name=item[0],cost=item[1],note=item[2]||'',wbLimit=item.length>=4?item[3]:null;
      const costStr=typeof cost==='number'?cost+'D':cost;
      const costVal=typeof cost==='number'?cost:0;
      // Check warband-wide limit
      let wbBlocked=false,wbLock='';
      if(wbLimit!==null){
        const used=wbUpgradeCounts[name]||0;
        if(used>=wbLimit){wbBlocked=true;wbLock=` <span class="eq-lock">🔒 Limit ${wbLimit} (${used} in warband)</span>`;}
      }
      const cls=wbBlocked?'eq-limit-blocked':'';
      html+=`<label class="eq-item ${cls}"><input type="checkbox" data-cost="${costVal}" data-cat="Unit Upgrades" data-name="${esc(name)}" data-note="${esc(note)}" ${wbBlocked?'disabled data-perm="1"':''} data-group="${item[4]||''}" onchange="rebuildPickerOnUpgrade(this)"><span class="eq-name">${esc(name)}</span><span class="eq-cost">${costStr}</span>${note?`<span class="eq-note">${esc(note)}</span>`:''}${wbLock}</label>`;
    });
    html+='</div></div>';
  }
  // Cross-faction armoury sections (e.g. House of Wisdom)
  const xfa=(v.cross_faction_armoury||[]);
  if(xfa.length){
    // Count cross-faction items already used across warband
    const xfaCounts={};
    roster.forEach((ru,ri)=>{
      if(ri===editingIndex)return;
      (ru.equip||[]).forEach(e=>{xfaCounts[e]=(xfaCounts[e]||0)+1;});
    });
    xfa.forEach(xf=>{
      const xfFaction=FACTIONS[xf.faction];
      if(!xfFaction)return;
      const xfLimit=xf.limit||1;
      // Count items from this faction's armoury already selected in this unit + warband
      const allXfItems=new Set();
      Object.values(xfFaction.armoury||{}).forEach(items=>items.forEach(i=>allXfItems.add(i[0])));
      const xfUsed=Object.entries(xfaCounts).filter(([n])=>allXfItems.has(n)).reduce((s,[,c])=>s+c,0);
      const xfSectionFull=xfUsed>=xfLimit;
      html+=`<div class="equip-section"><div class="eq-cat-title" onclick="this.nextElementSibling.classList.toggle('collapsed');this.querySelector('.toggle').textContent=this.nextElementSibling.classList.contains('collapsed')?'▸':'▾';">
        ${xf.label} <span style="font-weight:400;font-size:0.5rem;">(${xfUsed}/${xfLimit} used)</span> <span class="toggle">▸</span></div><div class="eq-items collapsed">`;
      Object.entries(xfFaction.armoury||{}).forEach(([cat,items])=>{
        items.forEach(item=>{
          const name=item[0],cost=item[1],note=item[2]||'';
          const costStr=typeof cost==='number'?cost+'D':cost;
          const costVal=typeof cost==='number'?cost:0;
          const gp=gearParse(name);
          let wInfo='';
          if(gp&&gp.cat==='weapon'){
            const parts=[];
            if(gp.range)parts.push(gp.range);
            if(gp.diceMod!==0)parts.push((gp.diceMod>0?'+':'')+gp.diceMod+'d');
            if(gp.injDiceStr)parts.push(gp.injDiceStr);
            if(gp.keywords)parts.push(gp.keywords);
            wInfo=parts.join(', ');
          } else if(gp&&(gp.cat==='armour'||gp.cat==='shield')){
            wInfo=gp.keywords||'';
          }
          const hands=getHands(name,cat);
          const blocked=xfSectionFull;
          const cls=blocked?'eq-restricted':'';
          const lockIcon=blocked?` <span class="eq-lock">🔒 Limit ${xfLimit}</span>`:'';
          html+=`<label class="eq-item ${cls}"><input type="checkbox" data-cost="${costVal}" data-cat="${cat}" data-hands="${hands}" data-name="${esc(name)}" data-note="${esc(note)}" data-xfa="${xf.faction}" ${blocked?'disabled data-perm="1"':''} onchange="enforceEquipLimits();updateEditorCost()"><span class="eq-name">${name}</span>${wInfo?`<span class="eq-info">${wInfo}</span>`:''}<span class="eq-cost">${costStr}</span>${note?`<span class="eq-note">${note}</span>`:''}${lockIcon}</label>`;
        });
      });
      html+='</div></div>';
    });
  }
  p.innerHTML=html;
}
function updateEditorCost(){
  if(!currentUnit)return;
  let eq=0;
  document.querySelectorAll('#equip-picker input:checked').forEach(cb=>{
    const cost=parseInt(cb.dataset.cost||0);
    eq+=cost;
    // Add cost again if ×2 is active for this item
    const dualBtn=cb.closest('.eq-item')?.querySelector('.eq-dual-btn');
    if(dualBtn&&dualBtn.classList.contains('active'))eq+=cost;
  });
  let gp=0;document.querySelectorAll('.gp-check:checked').forEach(cb=>gp+=parseInt(cb.dataset.cost||0));
  let ap=0;document.querySelectorAll('.ap-check:checked').forEach(cb=>ap+=parseInt(cb.dataset.cost||0));
  const t=(currentUnit.base_cost||0)+eq+gp+ap;
  document.getElementById('ue-total-cost').textContent=currentUnit.isMerc?'':t;
  const gl=document.getElementById('ue-glory-cost');
  if(currentUnit.isMerc){gl.style.display='inline';gl.textContent=currentUnit.cost+'☼';document.querySelector('.cost-label').textContent=' Glory';}
  else{gl.style.display='none';document.querySelector('.cost-label').textContent=' Ducats';}
}

// ═══ CONFIRM + ROSTER ═══
function confirmUnit(){
  const name=document.getElementById('ue-name-input').value||'',u=currentUnit;
  const v=getVariant()||{};
  const variantUpgradeNames=new Set(((v.variant_unit_upgrades||{})[u.type]||[]).map(x=>x[0]));

  // Split equip into regular gear vs variant upgrades
  let equip=[],variant_upgrades=[],eqCost=0;
  document.querySelectorAll('#equip-picker input:checked').forEach(cb=>{
    const itemName=cb.closest('.eq-item').querySelector('.eq-name').textContent;
    const cost=parseInt(cb.dataset.cost||0);
    const dualBtn=cb.closest('.eq-item')?.querySelector('.eq-dual-btn');
    const isDual=dualBtn&&dualBtn.classList.contains('active');
    eqCost+=cost;
    if(isDual)eqCost+=cost;
    if(cb.dataset.cat==='Unit Upgrades'&&variantUpgradeNames.has(itemName)){
      variant_upgrades.push({name:itemName,note:cb.dataset.note||''});
    } else {
      equip.push(itemName);
      if(isDual)equip.push(itemName); // push twice for ×2
    }
  });

  // Goetic Powers
  let powers=[...(u.gp_free||[])];
  let gpCost=0;
  document.querySelectorAll('.gp-check:checked').forEach(cb=>{
    powers.push(cb.dataset.name);
    gpCost+=parseInt(cb.dataset.cost||0);
  });
  let powerDescs=[];
  powers.forEach(pName=>{
    const freeP=(u.gp_free||[]).includes(pName);
    let found=null;
    for(const[sin,arr]of Object.entries(GOETIC_POWERS)){
      const p=arr.find(x=>x.name===pName);
      if(p){found=p;break;}
    }
    if(found) powerDescs.push({name:pName,desc:found.desc,free:freeP});
    else powerDescs.push({name:pName,desc:'',free:freeP});
  });

  // Arcana Putrescere
  let arcana=[];
  let apCost=0;
  document.querySelectorAll('.ap-check:checked').forEach(cb=>{
    const p=ARCANA_POWERS.find(x=>x.name===cb.dataset.name);
    apCost+=parseInt(cb.dataset.cost||0);
    if(p) arcana.push({name:p.name,desc:p.description||'',type:p.type||'',cost:p.cost});
  });

  // Saint aura
  let sinAura='';
  if(u.type==='Desecrated Saint'&&selectedSin){sinAura=SAINT_AURAS[selectedSin]||'';}

  const unit={name,type:u.type,base_cost:u.base_cost||0,equip_cost:eqCost+gpCost+apCost,total_cost:(u.base_cost||0)+eqCost+gpCost+apCost,equip,variant_upgrades,isElite:u.isElite,isMerc:u.isMerc||false,glory_cost:u.isMerc?u.cost:0,movement:u.movement,ranged:u.ranged,melee:u.melee,armour:u.armour,keywords:u.keywords||[],abilities:u.abilities||[],conditional_abilities:u.conditional_abilities||{},conditional_keywords:u.conditional_keywords||{},base_equipment:u._effectiveBaseEq||u.base_equipment||[],base_size:u.base_size||'32mm',powers:powerDescs,arcana,sinAura,restrict_armour_purchase:u.restrict_armour_purchase||false};
  if(editingIndex>=0)roster[editingIndex]=unit;else roster.push(unit);
  renderRoster();showEmpty();
}
function renderRoster(){
  const list=document.getElementById('roster-list'),empty=document.getElementById('roster-empty');
  list.querySelectorAll('.r-section,.r-unit').forEach(e=>e.remove());
  if(!roster.length){empty.style.display='block';updateTopBar();return;}
  empty.style.display='none';
  const add=(label,units,cls)=>{if(!units.length)return;const s=document.createElement('div');s.className='r-section '+(cls||'');s.textContent=label;list.appendChild(s);units.forEach(u=>list.appendChild(makeRI(u,roster.indexOf(u))));};
  add('‡ Elites ‡',roster.filter(u=>u.isElite&&!u.isMerc));
  add('† Troops †',roster.filter(u=>!u.isElite&&!u.isMerc));
  add('☼ Mercenaries ☼',roster.filter(u=>u.isMerc),'glory-section');
  const hint=document.createElement('div');hint.className='roster-hint';hint.textContent='☩ Tap a unit above to edit';list.appendChild(hint);
  updateTopBar();
}
function makeRI(u,idx){
  const d=document.createElement('div');d.className='r-unit';d.dataset.idx=idx;
  d.innerHTML=`<div class="r-mark ${u.isMerc?'glory-mark':''}">${u.isMerc?'☼':u.isElite?'‡':'†'}</div>
    <div class="r-body"><div class="r-name">${u.name||'(Unnamed)'}</div><div class="r-type">${u.type}</div>
    <div class="r-equip">${u.equip.length?u.equip.join(', '):(u.base_equipment.join(', ')||'—')}</div></div>
    <div class="r-cost ${u.isMerc?'glory-cost':''}">${u.isMerc?u.glory_cost+'☼':u.total_cost+'D'}</div>
    <button class="r-del" onclick="event.stopPropagation();roster.splice(${idx},1);renderRoster();showEmpty();">✕</button>`;
  d.addEventListener('click',()=>editExisting(idx));return d;
}
function editExisting(idx){
  editingIndex=idx;const u=roster[idx];
  // Find original unit def to get gp_max/gp_free/ap_max
  const f=FACTIONS[selectedFaction];
  const allUnits=[...(f?.elites||[]),...(f?.troops||[]),...((getVariant()||{}).add_units||[])];
  const origDef=allUnits.find(d=>d.type===u.type)||{};
  currentUnit={type:u.type,base_cost:u.base_cost,movement:u.movement,ranged:u.ranged,melee:u.melee,armour:u.armour,keywords:u.keywords,abilities:u.abilities,conditional_abilities:origDef.conditional_abilities||{},conditional_keywords:origDef.conditional_keywords||{},conditional_restrict_items:origDef.conditional_restrict_items||{},base_equipment:u.base_equipment,base_size:origDef.base_size||u.base_size||'32mm',isElite:u.isElite,isMerc:u.isMerc,cost:u.glory_cost,min:0,max:99,gp_max:origDef.gp_max||0,gp_free:origDef.gp_free||[],ap_max:origDef.ap_max||0,restrict_armoury:origDef.restrict_armoury||false,unit_upgrades:origDef.unit_upgrades||[],restrict_armour_purchase:origDef.restrict_armour_purchase||false,restrict_ranged:origDef.restrict_ranged||false,restrict_grenades:origDef.restrict_grenades||false,restrict_shields:origDef.restrict_shields||false,restrict_equipment_to:origDef.restrict_equipment_to||null,restrict_ranged_to:origDef.restrict_ranged_to||null,restrict_grenades_to:origDef.restrict_grenades_to||null};
  openEditor();document.getElementById('ue-name-input').value=u.name;
  if(!u.isMerc){
    // Restore equip — includes both gear and variant upgrades stored in equip
    const allEquipNames=[...u.equip,...(u.variant_upgrades||[]).map(x=>x.name)];
    document.querySelectorAll('#equip-picker input').forEach(cb=>{
      cb.checked=allEquipNames.includes(cb.closest('.eq-item').querySelector('.eq-name').textContent);
    });
    // Re-evaluate conditional items with restored selections (e.g. Machine Armour unlocks Heavy Ballistic Shield)
    updateConditionalItems();
    enforceEquipLimits();
    // Re-check Goetic Powers
    const savedPowers=(u.powers||[]).map(p=>p.name);
    document.querySelectorAll('.gp-check').forEach(cb=>{cb.checked=savedPowers.includes(cb.dataset.name);});
    updateGoeticSlots();
    // Re-check Arcana Powers
    const savedArcana=(u.arcana||[]).map(p=>p.name);
    document.querySelectorAll('.ap-check').forEach(cb=>{cb.checked=savedArcana.includes(cb.dataset.name);});
    updateArcanaSlots();
    updateEditorCost();
  }
  document.querySelectorAll('.r-unit').forEach(r=>r.classList.remove('selected'));
  document.querySelector(`.r-unit[data-idx="${idx}"]`)?.classList.add('selected');
}
function updateTopBar(){
  const budget=parseInt(document.getElementById('d-budget').value)||700;
  const gBudget=parseInt(document.getElementById('g-budget').value)||0;
  const ducats=roster.filter(u=>!u.isMerc).reduce((s,u)=>s+u.total_cost,0);
  const glory=roster.filter(u=>u.isMerc).reduce((s,u)=>s+u.glory_cost,0);
  document.getElementById('d-spent').textContent=ducats;
  document.getElementById('d-remain').textContent=budget-ducats;
  document.getElementById('g-spent').textContent=glory;
  document.getElementById('g-remain').textContent=gBudget>0?gBudget-glory:'—';
  document.getElementById('d-models').textContent=roster.length;
  document.getElementById('d-remain').parentElement.classList.toggle('warn',ducats>budget);
  const gloryOver=gBudget>0&&glory>gBudget;
  document.getElementById('g-spent').parentElement.classList.toggle('warn',gloryOver);
  document.getElementById('g-remain').parentElement.classList.toggle('warn',gloryOver);
}

// ═══ CARD PREVIEW ═══
function fmtDice(v){
  if(!v||v==='-'||v==='0')return v;
  const s=String(v).replace(/\s*DICE/i,'');
  if(s.match(/^[+-]\d/))return s+'d';
  return s;
}
function fmtEquipCard(name,escaped){
  const raw=escaped?name.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"'):name;
  const gp=gearParse(raw);
  if(gp){
    let info='';
    if(gp.cat==='weapon'){
      const parts=[];
      if(gp.range)parts.push(gp.range);
      if(gp.diceMod!==0)parts.push((gp.diceMod>0?'+':'')+gp.diceMod+'d');
      if(gp.injDiceStr)parts.push(gp.injDiceStr);
      if(gp.injModStr)parts.push(gp.injModStr);
      if(gp.keywords)parts.push(gp.keywords);
      info=parts.join(', ');
    } else {
      // Armour/shield/equipment: keywords already includes injModStr — use directly
      info=gp.keywords||'';
    }
    if(info)return`<div class="uc-gear"><b>${raw}</b> <i>${info}</i></div>`;
  }
  return`<div class="uc-gear"><b>${raw}</b></div>`;
}
// Parse a dice string like "+2 DICE", "+1d", "-1 DICE", "0" → number
function parseDiceVal(v){
  if(!v||v==='-'||v==='—')return 0;
  const s=String(v).replace(/\s*DICE/i,'').replace(/d$/i,'');
  const n=parseInt(s);return isNaN(n)?0:n;
}
// Calculate effective stats for stat boxes — reads from gear data
function calcEffStats(unit){
  const allEquip=[...(unit.base_equipment||[]),...(unit.equip||[])];
  const baseR=parseDiceVal(unit.ranged),baseM=parseDiceVal(unit.melee);
  let bestRangedMod=null,bestMeleeMod=null,armourMod=0;
  allEquip.forEach(name=>{
    const raw=name.replace(/&amp;/g,'&').replace(/&#39;/g,"'");
    const w=gearParse(raw);
    if(!w)return;
    if(w.cat==='weapon'){
      // Only count weapons with actual dice modifiers (not pure INJ dice weapons like Grand Cannon)
      if(w.diceMod!==0){
        if(w.isRanged||w.isDual){
          if(bestRangedMod===null||w.diceMod>bestRangedMod)bestRangedMod=w.diceMod;
        }
        if(w.isMelee||w.isDual){
          if(bestMeleeMod===null||w.diceMod>bestMeleeMod)bestMeleeMod=w.diceMod;
        }
      }
    }
    if(w.cat==='armour'||w.cat==='shield'){
      armourMod+=w.injMod||0;
    }
  });
  const effR=bestRangedMod!==null?baseR+bestRangedMod:null;
  const effM=bestMeleeMod!==null?baseM+bestMeleeMod:null;
  // Conditional base size — check if any conditional_keywords item changes base
  let effBase=unit.base_size||'32mm';
  const condKws=unit.conditional_keywords||{};
  Object.entries(condKws).forEach(([item,kws])=>{
    if(allEquip.includes(item)&&kws.includes('BULKY')){
      // Machine Armour: base becomes 40mm unless already larger
      const cur=parseInt(effBase)||32;
      if(cur<40)effBase='40mm';
    }
  });
  return{effR,effM,armourMod,effBase};
}
// Format stat box value — always show effective in parens when a weapon is equipped
function fmtStatBox(label,baseVal,effVal){
  const base=fmtDice(baseVal);
  if(effVal===null||effVal===undefined)return`<div class="uc-st"><div class="sl">${label}</div><div class="sv">${base}</div></div>`;
  const effStr=(effVal>=0?'+':'')+effVal+'d';
  return`<div class="uc-st"><div class="sl">${label}</div><div class="sv">${base} <span class="se">(${effStr})</span></div></div>`;
}
function fmtArmourBox(baseVal,armourMod){
  const base=String(baseVal||0);
  if(armourMod===null||armourMod===undefined||armourMod===0)return`<div class="uc-st"><div class="sl">Armour</div><div class="sv">${base}</div></div>`;
  const eff=(parseInt(base)||0)+armourMod;
  return`<div class="uc-st"><div class="sl">Armour</div><div class="sv">${base} <span class="se">(${eff})</span></div></div>`;
}
// Build equipment section: weapon table + gear list — reads from gear data
function buildEquipSection(allEquip,unit,doEsc){
  const e=doEsc?esc:v=>v;
  const weapons=[],gear=[];
  allEquip.forEach(name=>{
    const raw=name.replace(/&amp;/g,'&').replace(/&#39;/g,"'");
    const w=gearParse(raw);
    if(!w){gear.push(name);return;}
    if(w.cat==='weapon'){
      // Dice column: show dice modifier if non-zero, else show INJ dice if present, else —
      const wd=w.diceMod;
      let wdStr,kwDisplay=w.keywords;
      if(wd!==0){
        wdStr=(wd>=0?'+':'')+wd+'d';
      } else if(w.injDice!==0){
        // Injury dice shown in dice column as +Nd format
        wdStr=(w.injDice>0?'+':'')+w.injDice+'d';
        // Remove injDiceStr from keywords to avoid showing twice
        kwDisplay=(w.keywords||'').replace(w.injDiceStr,'').replace(/^,\s*|,\s*$|,\s*,/g,',').replace(/^,|,$/,'').trim();
      } else {
        wdStr='—';
      }
      weapons.push({name:e(raw),hands:w.hands,range:w.range,effDice:wdStr,keywords:kwDisplay});
    } else {
      gear.push(name);
    }
  });
  let html='';
  if(weapons.length){
    html+=`<table class="uc-wtbl"><tr><th>Weapon</th><th>Range</th><th>Dice</th><th>Keywords</th></tr>`;
    weapons.forEach(w=>{
      html+=`<tr><td>${w.name}</td><td>${w.range||'—'}</td><td class="wd">${w.effDice}</td><td class="wk">${w.keywords||'—'}</td></tr>`;
    });
    html+=`</table>`;
  }
  if(gear.length){
    gear.forEach(name=>{
      html+=fmtEquipCard(name,doEsc);
    });
  }
  if(!weapons.length&&!gear.length)html='<div class="uc-gear"><i>None</i></div>';
  return html;
}
function showPreview(){
  if(!roster.length){alert('Add units first!');return;}
  const fName=FACTIONS[selectedFaction]?.name||'';
  const wbName=document.getElementById('wb-name-input').value||'Unnamed';
  const xpBoxes='<div class="xb"></div>'.repeat(3)+'<div class="xb s"></div>';
  const xpRow=xpBoxes.repeat(4);

  document.getElementById('card-grid').innerHTML=roster.map(u=>{
    const isElite=u.isElite&&!u.isMerc;
    const isMerc=u.isMerc;
    const cardClass=isElite||isMerc?'card-a6l':'card-a7';
    const badge=isMerc?'☼ MERC':isElite?'‡ ELITE':'† TROOP';
    const badgeCls=isElite||isMerc?'':'troop';

    // Keywords — base + conditional (e.g. BULKY when Machine Armour equipped)
    const allEquip=[...u.base_equipment,...u.equip];
    const condKws=u.conditional_keywords||{};
    const extraKws=[];
    Object.entries(condKws).forEach(([item,kws])=>{if(allEquip.includes(item))extraKws.push(...kws);});
    const kwHtml=[...u.keywords,...extraKws].map(k=>`<span class="kw">${k}</span>`).join('');

    // Stats with effective modifiers
    const eff=calcEffStats(u);
    const baseChanged=eff.effBase&&eff.effBase!==(u.base_size||'32mm');
    const statsHtml=fmtStatBox('Move',u.movement,null)+fmtStatBox('Ranged',u.ranged,eff.effR)+fmtStatBox('Melee',u.melee,eff.effM)+fmtArmourBox(u.armour,eff.armourMod)+fmtStatBox('Base',u.base_size||'32mm',baseChanged?eff.effBase:null);

    // Equipment: weapon table + gear list
    const equipHtml=buildEquipSection(allEquip,u,false);

    // Abilities — base only + conditional (e.g. Machine Armour ability only when equipped)
    const condAbs=u.conditional_abilities||{};
    const activeAbs=[...u.abilities];
    Object.entries(condAbs).forEach(([item,abs])=>{if(allEquip.includes(item))activeAbs.push(...abs);});
    const abHtml=activeAbs.map(a=>{
      const parts=a.match(/^([^:]+:)\s*(.*)/);
      if(parts)return`<div class="uc-ab"><strong>${parts[1]}</strong> ${parts[2]}</div>`;
      return`<div class="uc-ab">${a}</div>`;
    }).join('');

    // Goetic Powers
    const pwHtml=(u.powers&&u.powers.length)?u.powers.map(p=>
      `<div class="uc-pw"><strong>${p.name}</strong>${p.free?' <span class="ct">(free)</span>':` <span class="ct">(${typeof p.cost==='number'?p.cost+'D':p.cost})</span>`}${p.desc?' — '+p.desc:''}</div>`
    ).join(''):'';

    // Arcana Putrescere
    const apHtml=(u.arcana&&u.arcana.length)?u.arcana.map(p=>
      `<div class="uc-arcana uc-arcana-item"><strong>${p.name}</strong>${p.type?` <span class="ct">(${p.type})</span>`:''}${p.desc?' — '+p.desc:''}</div>`
    ).join(''):'';

    // Variant upgrades
    const vuHtml=(u.variant_upgrades&&u.variant_upgrades.length)?u.variant_upgrades.map(vu=>
      `<div class="uc-ab"><strong>${vu.name}</strong>${vu.note?' — '+vu.note:''}</div>`
    ).join(''):'';

    // Aura
    const auraHtml=u.sinAura?`<div class="uc-aura">✦ ${u.sinAura}</div>`:'';

    // ═══ A6L: two-column elite card ═══
    if(cardClass==='card-a6l'){
      // Powers footer — full width, two columns, only shown when powers/arcana present
      const hasPowers=pwHtml||apHtml||auraHtml;
      const pwZoneHtml=hasPowers?`<div class="uc-pw-zone">
        ${pwHtml?`<div class="uc-pw-zone-title">Goetic Powers</div>${pwHtml}`:''}
        ${apHtml?`<div class="uc-pw-zone-title" style="color:#7A3B1E;">Arcana Putrescere</div>${apHtml}`:''}
        ${auraHtml?`<div class="uc-pw-zone-title">Aura</div><div class="uc-pw">${auraHtml}</div>`:''}
      </div>`:'';
      return`<div class="unit-card card-a6l">
        <div class="uc-header"><div class="uc-name">${u.name?`<span class="uc-custom-name">${u.name}</span>`:''}${u.type}</div><div class="uc-hright"><div class="uc-badge ${badgeCls}">${badge}</div><div class="uc-cost-val">${isMerc?u.glory_cost+'☼':u.total_cost+'D'}</div></div></div>
        <div class="uc-wbar"><span>${fName}</span><span>${wbName}</span></div>
        <div class="uc-stats">${statsHtml}</div>
        <div class="uc-body">
          <div class="col-l">
            <div class="uc-kw">${kwHtml}</div>
            <div class="uc-sec">Equipment</div>
            ${equipHtml}
          </div>
          <div class="col-div"></div>
          <div class="col-r">
            <div class="uc-sec">Abilities</div>
            ${abHtml}
            ${vuHtml?`<div class="uc-sec">Variant Upgrades</div>${vuHtml}`:''}
          </div>
        </div>
        ${pwZoneHtml}
        ${allRestrictionsIgnored?`<div style="font-family:'Cinzel',serif;font-size:1.5mm;color:#ff4444;text-align:center;padding:1mm;border-top:0.3mm solid #ff4444;letter-spacing:0.05em;">☠ Rules ignored — not tournament legal</div>`:''}
        <div class="uc-foot">
          <div class="uc-xp"><span class="uc-xpl">Experience</span><div class="uc-xpb">${xpRow}</div></div>
          <div class="uc-fr"><span class="uc-fl">Injuries</span><div class="uc-fline"></div><div class="uc-scars"><div class="uc-sc"></div><div class="uc-sc"></div><div class="uc-sc"></div></div></div>
          <div class="uc-nl"></div><div class="uc-nl"></div>
        </div>
      </div>`;
    }

    // ═══ A7: single-column troop card ═══
    return`<div class="unit-card card-a7">
      <div class="uc-header"><div class="uc-name">${u.name?`<span class="uc-custom-name">${u.name}</span>`:''}${u.type}</div><div class="uc-hright"><div class="uc-badge troop">${badge}</div><div class="uc-cost-val">${u.total_cost}d</div></div></div>
      <div class="uc-wbar"><span>${fName}</span><span>${wbName}</span></div>
      <div class="uc-stats">${statsHtml}</div>
      <div class="uc-body">
        <div class="uc-kw">${kwHtml}</div>
        <div class="uc-sec">Equipment</div>
        ${equipHtml}
        <div class="uc-sec">Abilities</div>
        ${abHtml}
        ${vuHtml?`<div class="uc-sec">Variant Upgrades</div>${vuHtml}`:''}
        ${pwHtml?`<div class="uc-sec pwr">Goetic Powers</div>${pwHtml}`:''}
        ${apHtml?`<div class="uc-sec" style="color:#7A3B1E;border-color:rgba(122,59,30,0.2);">Arcana Putrescere</div>${apHtml}`:''}
        ${auraHtml}
      </div>
      ${allRestrictionsIgnored?`<div style="font-family:'Cinzel',serif;font-size:1.5mm;color:#ff4444;text-align:center;padding:1mm;border-top:0.3mm solid #ff4444;letter-spacing:0.05em;">☠ Rules ignored — not tournament legal</div>`:''}
      <div class="uc-foot">
        <div class="uc-fr"><span class="uc-fl">Kills</span><div class="uc-fline"></div></div>
        <div class="uc-fr"><span class="uc-fl">Injuries</span><div class="uc-fline"></div></div>
        <div class="uc-nl"></div><div class="uc-nl"></div><div class="uc-nl"></div>
      </div>
    </div>`;
  }).join('');
  showScreen('screen-preview');
}

function showMobileCards(){
  if(!roster.length){alert('Add units first!');return;}
  const fName=FACTIONS[selectedFaction]?.name||'';
  const wbName=document.getElementById('wb-name-input').value||'Unnamed';
  const xpBoxes='<div class="xb"></div>'.repeat(3)+'<div class="xb s"></div>';
  const xpRow=xpBoxes.repeat(4);

  document.getElementById('mobile-cards').innerHTML=roster.map(u=>{
    const isElite=u.isElite&&!u.isMerc;
    const isMerc=u.isMerc;
    const badge=isMerc?'☼ MERC':isElite?'‡ ELITE':'† TROOP';

    const allEquip=[...u.base_equipment,...u.equip];
    const condKws=u.conditional_keywords||{};
    const extraKws=[];
    Object.entries(condKws).forEach(([item,kws])=>{if(allEquip.includes(item))extraKws.push(...kws);});
    const kwHtml=[...u.keywords,...extraKws].map(k=>`<span class="kw">${esc(k)}</span>`).join('');

    const eff=calcEffStats(u);
    const baseChanged=eff.effBase&&eff.effBase!==(u.base_size||'32mm');
    const statsHtml=fmtStatBox('Move',u.movement,null)+fmtStatBox('Ranged',u.ranged,eff.effR)+fmtStatBox('Melee',u.melee,eff.effM)+fmtArmourBox(u.armour,eff.armourMod)+fmtStatBox('Base',u.base_size||'32mm',baseChanged?eff.effBase:null);
    const equipHtml=buildEquipSection(allEquip,u,true);

    const condAbs=u.conditional_abilities||{};
    const activeAbs=[...u.abilities];
    Object.entries(condAbs).forEach(([item,abs])=>{if(allEquip.includes(item))activeAbs.push(...abs);});
    const abHtml=activeAbs.map(a=>{
      const parts=a.match(/^([^:]+:)\s*(.*)/);
      if(parts)return`<div class="uc-ab"><strong>${esc(parts[1])}</strong> ${esc(parts[2])}</div>`;
      return`<div class="uc-ab">${esc(a)}</div>`;
    }).join('');

    const pwHtml=(u.powers&&u.powers.length)?u.powers.map(p=>
      `<div class="uc-pw"><strong>${esc(p.name)}</strong>${p.free?' <span class="ct">(free)</span>':` <span class="ct">(${typeof p.cost==='number'?p.cost+'D':esc(String(p.cost))})</span>`}${p.desc?' — '+esc(p.desc):''}</div>`
    ).join(''):'';
    const apHtml=(u.arcana&&u.arcana.length)?u.arcana.map(p=>
      `<div class="uc-arcana uc-arcana-item"><strong>${esc(p.name)}</strong>${p.type?` <span class="ct">(${esc(p.type)})</span>`:''}${p.desc?' — '+esc(p.desc):''}</div>`
    ).join(''):'';
    const vuHtml=(u.variant_upgrades&&u.variant_upgrades.length)?u.variant_upgrades.map(vu=>
      `<div class="uc-ab"><strong>${esc(vu.name)}</strong>${vu.note?' — '+esc(vu.note):''}</div>`
    ).join(''):'';
    const auraHtml=u.sinAura?`<div class="uc-aura">✦ ${esc(u.sinAura)}</div>`:'';

    const footer=isElite?
      `<div class="uc-foot"><div class="uc-xp"><span class="uc-xpl">Experience</span><div class="uc-xpb">${xpRow}</div></div><div class="uc-fr"><span class="uc-fl">Injuries</span><div class="uc-fline"></div><div class="uc-scars"><div class="uc-sc"></div><div class="uc-sc"></div><div class="uc-sc"></div></div></div><div class="uc-nl"></div><div class="uc-nl"></div></div>`:
      `<div class="uc-foot"><div class="uc-fr"><span class="uc-fl">Kills</span><div class="uc-fline"></div></div><div class="uc-fr"><span class="uc-fl">Injuries</span><div class="uc-fline"></div></div><div class="uc-nl"></div><div class="uc-nl"></div><div class="uc-nl"></div></div>`;

    return`<div class="mob-card">
      <div class="uc-header"><div class="uc-name">${u.name?`<span class="uc-custom-name">${esc(u.name)}</span>`:''}${esc(u.type)}</div><div class="uc-hright"><div class="uc-badge">${badge}</div><div class="uc-cost-val">${isMerc?u.glory_cost+'☼':u.total_cost+'D'}</div></div></div>
      <div class="uc-wbar"><span>${esc(fName)}</span><span>${esc(wbName)}</span></div>
      <div class="uc-stats">${statsHtml}</div>
      <div class="uc-body">
        <div class="uc-kw">${kwHtml}</div>
        <div class="uc-sec">Equipment</div>
        ${equipHtml}
        <div class="uc-sec">Abilities</div>
        ${abHtml}
        ${vuHtml?`<div class="uc-sec">Variant Upgrades</div>${vuHtml}`:''}
        ${pwHtml?`<div class="uc-sec pwr">Goetic Powers</div>${pwHtml}`:''}
        ${apHtml?`<div class="uc-sec" style="color:#7A3B1E;border-color:rgba(122,59,30,0.2);">Arcana Putrescere</div>${apHtml}`:''}
        ${auraHtml}
      </div>
      ${footer}
    </div>`;
  }).join('');
  showScreen('screen-mobile');
}

function showRoster(){
  if(!roster.length){alert('Add units first!');return;}
  const fName=FACTIONS[selectedFaction]?.name||'';
  const wbName=document.getElementById('wb-name-input').value||'Unnamed';
  const budget=parseInt(document.getElementById('d-budget').value)||700;
  const gBudget=parseInt(document.getElementById('g-budget').value)||0;
  const ducats=roster.filter(u=>!u.isMerc).reduce((s,u)=>s+u.total_cost,0);
  const glory=roster.filter(u=>u.isMerc).reduce((s,u)=>s+u.glory_cost,0);
  const varText=selectedSin?'Sin of '+selectedSin:(selectedVariant!=='standard'?(getVariant()||{}).name||'':'');
  const xpRow='<div class="rp-xb"></div>'.repeat(3)+'<div class="rp-xb s"></div>';
  const xpAll=xpRow.repeat(4);
  const emptyRows=Array.from({length:10},(_,i)=>`<tr><td>${i+1}</td><td class="e"></td><td class="e"></td><td class="e"></td><td class="e"></td><td class="e"></td><td class="e"></td></tr>`).join('');
  const elites=roster.filter(u=>u.isElite&&!u.isMerc);
  const troops=roster.filter(u=>!u.isElite&&!u.isMerc);
  const mercs=roster.filter(u=>u.isMerc);

  // Table row helper
  const trow=(u,cls)=>{
    const allEq=[...u.base_equipment,...u.equip];
    return`<tr class="${cls}"><td class="nm">${esc(u.name)||'(Unnamed)'}</td><td class="tp">${esc(u.type)}</td><td class="c">${u.movement}</td><td class="c">${fmtDice(u.ranged)}</td><td class="c">${fmtDice(u.melee)}</td><td class="c">${u.armour}</td><td>${allEq.map(e=>esc(e)).join(', ')||'—'}</td><td class="ct${u.isMerc?' gl':''}">${u.isMerc?u.glory_cost+'☼':u.total_cost+'D'}</td></tr>`;
  };

  // Unit detail block helper
  const ublock=(u)=>{
    const isE=u.isElite&&!u.isMerc;
    const allEq=[...u.base_equipment,...u.equip];

    // Conditional keywords
    const condKws=u.conditional_keywords||{};
    const extraKws=[];
    Object.entries(condKws).forEach(([item,kws])=>{if(allEq.includes(item))extraKws.push(...kws);});
    const allKws=[...u.keywords,...extraKws];

    // Conditional abilities
    const condAbs=u.conditional_abilities||{};
    const activeAbs=[...u.abilities];
    Object.entries(condAbs).forEach(([item,abs])=>{if(allEq.includes(item))activeAbs.push(...abs);});

    const abHtml=activeAbs.map(a=>{const p=a.match(/^([^:]+:)\s*(.*)/);return p?`<div class="rp-ab"><strong>${esc(p[1])}</strong> ${esc(p[2])}</div>`:`<div class="rp-ab">${esc(a)}</div>`;}).join('');
    const pwHtml=(u.powers||[]).map(p=>`<div class="rp-pw"><strong>${esc(p.name)}</strong>${p.free?' <span class="ct">(free)</span>':` <span class="ct">(${typeof p.cost==='number'?p.cost+'D':esc(String(p.cost))})</span>`}${p.desc?' — '+esc(p.desc):''}</div>`).join('');
    const apHtml=(u.arcana||[]).map(p=>`<div class="rp-arcana"><strong>${esc(p.name)}</strong>${p.type?` <span class="ct">(${esc(p.type)})</span>`:''}${p.desc?' — '+esc(p.desc):''}</div>`).join('');
    const vuHtml=(u.variant_upgrades||[]).map(vu=>`<div class="rp-ab"><strong>${esc(vu.name)}</strong>${vu.note?' — '+esc(vu.note):''}</div>`).join('');
    const auraHtml=u.sinAura?`<div class="rp-aura">✦ ${esc(u.sinAura)}</div>`:'';
    const campHtml=isE?`<div class="rp-camp"><span class="rp-cl">Exp</span><div class="rp-xpb">${xpAll}</div><span class="rp-cl">Kills</span><div class="rp-cvl"></div><span class="rp-cl">Injuries</span><div class="rp-cvl"></div><span class="rp-cl">Scars</span><div class="rp-cvl"></div></div>`
      :`<div class="rp-camp"><span class="rp-cl">Kills</span><div class="rp-cvl"></div><span class="rp-cl">Injuries</span><div class="rp-cvl"></div></div>`;
    return`<div class="rp-ub"><div class="rp-ubh"><div>${u.name?`<span class="uc">${esc(u.name)}</span>`:''}` +
      `<span class="un">${esc(u.type)}</span></div><span class="ub${isE?'':' tr'}">${u.isMerc?'☼ MERC':isE?'‡ ELITE':'† TROOP'} · ${u.isMerc?u.glory_cost+'☼':u.total_cost+'D'}</span></div>` +
      `<div class="rp-ubb"><div class="full rp-ust">${['Move','Ranged','Melee','Armour'].map((l,i)=>`<div class="rp-us"><div class="sl">${l}</div><div class="sv">${[u.movement,fmtDice(u.ranged),fmtDice(u.melee),u.armour][i]}</div></div>`).join('')}</div>` +
      `<div class="full rp-kw">${allKws.map(k=>`<span>${esc(k)}</span>`).join('')}</div>` +
      `<div><div class="rp-lbl">Equipment</div>${buildEquipSection(allEq,u,true)}</div>` +
      `<div><div class="rp-lbl">Abilities</div>${abHtml}${vuHtml?`<div class="rp-lbl">Variant Upgrades</div>${vuHtml}`:''}${pwHtml?`<div class="rp-lbl pw">Goetic Powers</div>${pwHtml}`:''}${apHtml?`<div class="rp-lbl" style="color:#7A3B1E;">Arcana Putrescere</div>${apHtml}`:''}${auraHtml}</div>` +
      `${campHtml}</div></div>`;
  };

  // Collect faction + variant special rules for the roster
  const factionRules=FACTIONS[selectedFaction]?.special_rules||[];
  const variantRules=(getVariant()||{}).add_rules||[];
  const allSpecialRules=[...factionRules,...variantRules];

  // Page 1: Overview
  let page1=`<div class="roster-page"><div class="rp-header"><div><div class="rp-title">${esc(wbName)}</div><div class="rp-sub">Warband Roster</div></div><div class="rp-meta"><div class="rm-f">${esc(fName)}</div>${varText?`<div class="rm-v">${esc(varText)}</div>`:''}</div></div>` +
    `<div class="rp-summary"><div class="rp-sc"><div class="sl">Spent</div><div class="sv" style="color:var(--gold)">${ducats}</div></div><div class="rp-sc"><div class="sl">Budget</div><div class="sv">${budget}</div></div><div class="rp-sc"><div class="sl">Remaining</div><div class="sv">${budget-ducats}</div></div><div class="rp-sc"><div class="sl">Glory</div><div class="sv" style="color:var(--glory)">${glory}</div></div><div class="rp-sc"><div class="sl">Models</div><div class="sv">${roster.length}</div></div><div class="rp-sc"><div class="sl">Games</div><div class="sv">—</div></div></div>`;
  if(allSpecialRules.length){
    // Format each rule: bold the part before the first colon
    const ruleItems=allSpecialRules.map(r=>{
      const colonIdx=r.indexOf(':');
      if(colonIdx>0&&colonIdx<60){
        const title=r.slice(0,colonIdx);
        const body=r.slice(colonIdx+1).trim();
        return`<div class="rp-sr-item"><b>${esc(title)}:</b> ${esc(body)}</div>`;
      }
      return`<div class="rp-sr-item">${esc(r)}</div>`;
    }).join('');
    page1+=`<div class="rp-sec rp-sr">Special Rules</div><div class="rp-sr-list">${ruleItems}</div>`;
  }
  if(allRestrictionsIgnored){
    page1+=`<div style="font-family:'Cinzel',serif;font-size:2.5mm;color:#ff4444;text-align:center;padding:2mm;border:0.5mm solid #ff4444;margin:2mm 0;letter-spacing:0.08em;">☠ ALL RULES IGNORED — THIS WARBAND IS NOT TOURNAMENT LEGAL</div>`;
  }
  page1+=`<div class="rp-sec">Warband Roster</div><table class="rp-tbl"><tr><th style="width:20%">Name</th><th style="width:16%">Type</th><th class="c" style="width:7%">Move</th><th class="c" style="width:7%">Rng</th><th class="c" style="width:7%">Mel</th><th class="c" style="width:7%">Arm</th><th style="width:26%">Equipment</th><th class="r" style="width:10%">Cost</th></tr>`;
  if(elites.length){page1+=`<tr><td colspan="8" class="rp-tsec">‡ Elites</td></tr>`;elites.forEach(u=>page1+=trow(u,'er'));}
  if(troops.length){page1+=`<tr><td colspan="8" class="rp-tsec">† Troops</td></tr>`;troops.forEach(u=>page1+=trow(u,''));}
  if(mercs.length){page1+=`<tr><td colspan="8" class="rp-tsec gl">☼ Mercenaries</td></tr>`;mercs.forEach(u=>page1+=trow(u,'mr'));}
  page1+=`</table>`;
  page1+=`<div class="rp-sec">Campaign Battle Log</div><table class="rp-ctbl"><tr><th>#</th><th>Threshold</th><th>Strength</th><th>Opponent</th><th>Scenario</th><th>Result</th><th>Notes</th></tr>${emptyRows}</table>`;
  page1+=`<div style="margin-top:3mm;"><div class="rp-sec">Warband Notes</div><div class="rp-nline"></div><div class="rp-nline"></div><div class="rp-nline"></div><div class="rp-nline"></div></div>`;
  page1+=`<div class="rp-foot"><span>Warband Forge · v3.14</span><span>Trench Crusade © Factory Fortress</span></div></div>`;

  // Page 2+: Unit Details
  let page2=`<div class="roster-page"><div style="font-family:'IM Fell English SC',serif;font-size:4.5mm;color:var(--blood);border-bottom:0.5mm solid var(--blood);padding-bottom:1mm;margin-bottom:3mm;display:flex;justify-content:space-between;align-items:flex-end;"><span>Unit Details</span><span style="font-family:'Cinzel',serif;font-size:2.5mm;color:var(--gold);letter-spacing:0.1em;">${esc(wbName)} — ${esc(fName)}</span></div>`;
  roster.forEach(u=>page2+=ublock(u));
  page2+=`<div class="rp-foot"><span>Warband Forge · v3.14</span><span>Trench Crusade © Factory Fortress</span></div></div>`;

  document.getElementById('roster-sheet').innerHTML=page1+page2;
  showScreen('screen-roster');
}

async function downloadPDF(){
  const wbName=document.getElementById('wb-name-input').value||'Unnamed Warband';
  const fName=FACTIONS[selectedFaction]?.name||'Unknown';
  const body=JSON.stringify({warband_name:wbName,faction_name:fName,units:roster.map(u=>({
    type:u.type,name:u.name,base_cost:u.base_cost,movement:u.movement,ranged:u.ranged,
    melee:u.melee,armour:u.armour,keywords:u.keywords,abilities:u.abilities,
    base_equipment:u.base_equipment,equipment:u.equip.map(e=>[e,0]),
    is_elite:u.isElite,powers:u.powers||[],sinAura:u.sinAura||'',
  }))});
  try{
    const resp=await fetch('/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body});
    if(!resp.ok){alert('PDF generation failed');return;}
    const blob=await resp.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=wbName.replace(/\s+/g,'_')+'_roster.pdf';
    document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
    if(typeof umami!=='undefined'){
      umami.track('PDF Exported', {faction: FACTIONS[selectedFaction]?.name||''});
    }
  }catch(e){console.error(e);alert('PDF generation failed: '+e.message);}
}

// ═══ IMPORT / EXPORT WARBAND JSON ═══
// Bump this when the save schema changes — add a migration block in migrateSave()
const CURRENT_FORMAT_VERSION = 2;

function migrateSave(data){
  const v = parseInt((data._format_version)||1);
  // v1 → v2: added variant_upgrades, arcana, conditional fields
  if(v < 2){
    (data.units||[]).forEach(u=>{
      if(!u.variant_upgrades) u.variant_upgrades=[];
      if(!u.arcana) u.arcana=[];
    });
  }
  // Future migrations go here as:
  // if(v < 3){ ... }
  data._format_version = CURRENT_FORMAT_VERSION;
  return data;
}

function exportWarband(){
  const wbName=document.getElementById('wb-name-input').value||'Unnamed Warband';
  const fName=FACTIONS[selectedFaction]?.name||'';
  const save={
    _format:'warband-forge-v1',
    _format_version: CURRENT_FORMAT_VERSION,
    _created:new Date().toISOString(),
    _modified:new Date().toISOString(),
    warband:{
      name:wbName,
      faction:selectedFaction,
      variant:selectedVariant,
      sin:selectedSin,
      budget_ducats:parseInt(document.getElementById('d-budget').value)||700,
      budget_glory:parseInt(document.getElementById('g-budget').value)||0,
      notes:''
    },
    campaign:{games_played:0,wins:0,losses:0,glory_earned:0,glory_spent:0,ducats_earned:0,ducats_spent:0},
    units:roster.map((u,i)=>({
      id:'unit_'+String(i+1).padStart(3,'0'),
      type:u.type,
      name:u.name||'',
      is_elite:u.isElite,
      is_merc:u.isMerc||false,
      base_cost:u.base_cost,
      glory_cost:u.glory_cost||0,
      equipment:u.equip.map(e=>({name:e,cost:0})),
      variant_upgrades:u.variant_upgrades||[],
      arcana:u.arcana||[],
      goetic_powers:(u.powers||[]).filter(p=>!p.free).map(p=>({name:p.name,cost:typeof p.cost==='number'?p.cost:0})),
      sin_aura:u.sinAura||'',
      total_cost:u.total_cost,
      campaign_data:null
    }))
  };
  const blob=new Blob([JSON.stringify(save,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=wbName.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_-]/g,'')+'.json';
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  // Track save event
  if(typeof umami!=='undefined'){
    umami.track('Warband Saved', {faction: fName, variant: selectedVariant||'standard'});
  }
}

function importWarband(event){
  const file=event.target.files[0];
  if(!file)return;
  // File size guard — max 1MB
  if(file.size>1024*1024){alert('File too large (max 1MB).');event.target.value='';return;}
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      const raw=JSON.parse(e.target.result);
      // Sanitize all imported data
      const data=migrateSave(sanitizeImport(raw));
      if(!FACTIONS[data.warband.faction]){
        alert('Unknown faction: '+esc(data.warband.faction));return;
      }
      // Set faction/variant/sin state
      selectedFaction=data.warband.faction;
      selectedVariant=data.warband.variant||'standard';
      selectedSin=data.warband.sin||null;
      // Build roster from saved units
      const f=FACTIONS[selectedFaction];
      const allDefs=[...(f?.elites||[]),...(f?.troops||[])];
      roster=data.units.map(u=>{
        const def=allDefs.find(d=>d.type===u.type)||{};
        return{
          name:u.name||'',
          type:u.type,
          base_cost:u.base_cost||def.base_cost||0,
          equip_cost:u.equipment?u.equipment.reduce((s,e)=>s+(e.cost||0),0):0,
          total_cost:u.total_cost||u.base_cost||0,
          equip:u.equipment?u.equipment.map(e=>e.name):[],
          isElite:u.is_elite||false,
          isMerc:u.is_merc||false,
          glory_cost:u.glory_cost||0,
          movement:def.movement||'6"',
          ranged:def.ranged||'+0',
          melee:def.melee||'+0',
          armour:def.armour||'0',
          keywords:def.keywords||[],
          abilities:def.abilities||[],
          base_equipment:def.base_equipment||[],
          powers:(u.goetic_powers||[]).map(p=>({name:p.name,cost:p.cost,desc:'',free:false})),
          variant_upgrades:u.variant_upgrades||[],
          arcana:u.arcana||[],
          sinAura:u.sin_aura||'',
        };
      });
      // Set up the builder screen
      document.getElementById('wb-faction-label').textContent=f.name;
      const vl=document.getElementById('wb-variant-label');
      let variantText='';
      if(selectedVariant!=='standard'){const v=getVariant();if(v)variantText=v.name;}
      if(selectedSin)variantText=(variantText?variantText+' · ':'')+'Sin of '+selectedSin;
      if(variantText){vl.textContent=variantText;vl.style.display='block';}else{vl.style.display='none';}
      document.getElementById('wb-name-input').value=data.warband.name||'';
      document.getElementById('d-budget').value=data.warband.budget_ducats||700;
      document.getElementById('g-budget').value=data.warband.budget_glory||0;
      // Skip to builder
      renderRoster();showEmpty();showScreen('screen-builder');
    }catch(err){
      console.error(err);alert('Error reading warband file: '+err.message);
    }
    // Discard file reference
    event.target.value='';
  };
  reader.readAsText(file);
}

// ═══ SHARE ═══
function shareClipboard(){
  const url=window.location.href;
  navigator.clipboard.writeText(url).then(()=>{
    const btn=document.querySelector('.share-btn');
    const orig=btn.textContent;btn.textContent='✓ Copied!';
    setTimeout(()=>btn.textContent=orig,1500);
  }).catch(()=>alert('Copy failed. URL: '+window.location.href));
}

function updateShareLinks(){
  const url=encodeURIComponent(window.location.href);
  const text=encodeURIComponent('Check out my warband on Warband Forge!');
  document.getElementById('share-x').href=`https://x.com/intent/tweet?text=${text}&url=${url}`;
  document.getElementById('share-reddit').href=`https://reddit.com/submit?url=${url}&title=${text}`;
  document.getElementById('share-fb').href=`https://www.facebook.com/sharer/sharer.php?u=${url}`;
}

// ═══ INIT — load data from Flask API ═══
updateShareLinks();
loadData().then(()=>{
  if(!localStorage.getItem('wf-onboarded')){
    document.getElementById('onboarding-banner').style.display='block';
  }
}).catch(e=>{
  console.warn('API not available, using empty data. Run app.py for full data.',e);
});
