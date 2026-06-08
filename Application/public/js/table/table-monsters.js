// ── Monster stat rendering (same logic as monsters.js) ───────────────────────
let _currentMonsterData = null;

function _plainEntry(s) {
  return String(s || '').replace(/\{@(\w+)\s([^}]*)\}/g, (_, tag, content) => {
    const p = content.split('|');
    switch (tag) {
      case 'hit': return (parseInt(p[0]) >= 0 ? '+' : '') + p[0];
      case 'damage': case 'dice': return p[0];
      case 'dc': return 'DC ' + p[0];
      case 'h': return '\nHit: ';
      case 'atk': case 'atkr': return '';
      case 'recharge': return '(Recharge ' + p[0] + '–6)';
      default: return p[0] || content;
    }
  }).replace(/\{@\w+\}/g, '')
    .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

async function rollMonsterDamage(section, idx, dmgStr) {
  const items = (_currentMonsterData && _currentMonsterData[section]) || [];
  const item = items[idx];
  const label = (item ? item.name : '') || 'Damage';
  let description = '';
  if (item) {
    const entryText = [].concat(item.entries || []).join(' ');
    description = _plainEntry(entryText).slice(0, 150);
  }
  rollDamageStr(label + ' Dmg', dmgStr, description);
}

async function useMonsterAction(section, idx) {
  if (!_currentMonsterData) return;
  const items = _currentMonsterData[section] || [];
  const item = items[idx];
  if (!item) return;
  const sender = (_currentMonsterData.label || _currentMonsterData.name || 'Monster').slice(0, 40);
  const rawText = [].concat(item.entries || []).map(e => {
    if (typeof e === 'string') return _plainEntry(e);
    if (e && e.type === 'list' && Array.isArray(e.items))
      return e.items.map(i => '• ' + _plainEntry(typeof i === 'string' ? i : (i.name || ''))).join('\n');
    return '';
  }).filter(Boolean).join('\n');
  // Shared info-card poster (table-chat.js) — keeps formatting and line breaks
  // identical to the player-action and spell "send to chat" features.
  postChatInfoCard({ name: item.name, text: rawText, sender });
}

function renderMonsterActionsPanel(data, tok) {
  const hasAny = (data.action?.length || 0) + (data.bonus?.length || 0) +
    (data.reaction?.length || 0) + (data.legendary?.length || 0) > 0;
  if (!hasAny) return '';

  _currentMonsterData = {
    name: data.name || 'Monster',
    label: tok?.label || '',
    action: data.action || [],
    bonus: data.bonus || [],
    reaction: data.reaction || [],
    legendary: data.legendary || []
  };

  if (!_sideOpenSections.has('monster-actions')) _sideOpenSections.add('monster-actions');

  function rActionItem(item, section, idx) {
    const entryText = [].concat(item.entries || []).join(' ');
    const atkMatch = entryText.match(/\{@hit\s([+-]?\d+)\}/i);
    const dmgTagMatch = entryText.match(/\{@damage\s+([^}]+)\}/i);
    const rawDmg = dmgTagMatch ? dmgTagMatch[1] : (entryText.match(/\d+d\d+\s*(?:[+-]\s*\d+)?/i)?.[0] || '');
    const dmgStr = rawDmg.replace(/\s+/g, '');
    const sn = (item.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const useBtn = `<button class="btn sm" onclick="useMonsterAction('${section}',${idx})" style="font-size:10px;padding:1px 5px;flex-shrink:0;background:rgba(100,150,255,.18);color:#aaf">Use</button>`;

    if (atkMatch) {
      const bonus = parseInt(atkMatch[1]);
      const dmgRow = dmgStr
        ? `<div class="qroll-row" onclick="rollMonsterDamage('${section}',${idx},'${dmgStr}')" style="padding-left:20px;background:rgba(0,0,0,.15)"><span style="font-size:11px;color:var(--txd)">↳ Damage</span><span class="qroll-val" style="color:#ff9966;font-size:13px">${esc(dmgStr)}</span></div>`
        : '';
      return `<div style="display:flex;align-items:center;gap:2px"><div class="qroll-row" style="flex:1;min-width:0;margin:0" onclick="qroll('${sn} atk','${bonus}')" title="${esc(entryText.slice(0, 120))}"><span>${parseEntry(item.name || '')}</span><span class="qroll-val">${bonus >= 0 ? '+' : ''}${bonus}</span></div>${useBtn}</div>${dmgRow}`;
    }

    return `<div style="display:flex;align-items:center;gap:2px;padding:2px 4px"><span style="flex:1;font-size:11px;color:var(--ac);font-weight:bold;font-style:italic">${parseEntry(item.name || '')}</span>${useBtn}</div>`;
  }

  const HR2 = '<hr style="border:none;border-top:1px solid var(--a44);margin:4px 0">';

  function rActionGroup(items, title, section) {
    if (!items || !items.length) return '';
    return `${HR2}<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:2px">${title}</div>` +
      items.map((item, idx) => rActionItem(item, section, idx)).join('');
  }

  const content =
    rActionGroup(data.action, 'Actions', 'action') +
    rActionGroup(data.bonus, 'Bonus Actions', 'bonus') +
    rActionGroup(data.reaction, 'Reactions', 'reaction') +
    rActionGroup(data.legendary, 'Legendary', 'legendary');

  return `<div class="qroll-section">
    <div class="qroll-section-hdr" onclick="toggleSideSection('monster-actions')">
      <span style="color:#ff9999">Actions</span>
      <span id="side-sec-monster-actions-arrow">${_sideSecArrow('monster-actions')}</span>
    </div>
    <div id="side-sec-monster-actions" class="qroll-rows" style="${_sideSecStyle('monster-actions')}">${content}</div>
  </div>`;
}


function renderMonsterFullStats(data, tok) {
  // ── Shared data ──
  const SZ={T:'Tiny',S:'Small',M:'Medium',L:'Large',H:'Huge',G:'Gargantuan'};
  const AL={L:'Lawful',N:'Neutral',C:'Chaotic',G:'Good',E:'Evil',U:'Unaligned',A:'Any'};
  const size=(data.size||[]).map(s=>SZ[s]||s).join('/');
  const typeStr=typeof data.type==='string'?data.type:data.type?(data.type.type||'')+(data.type.tags&&data.type.tags.length?' ('+data.type.tags.join(', ')+')':''):'';
  const align=(data.alignment||[]).map(a=>AL[a]||a).join(' ');
  const cr=(data.cr&&typeof data.cr==='object')?data.cr.cr:(data.cr||'—');
  const acStr=!data.ac?'—':[].concat(data.ac).map(a=>typeof a==='number'?a:typeof a==='object'?String(a.ac||'')+([].concat(a.from||[]).length?' ('+[].concat(a.from).join(', ')+')':''):a).join(', ');
  const hpStr=!data.hp?'—':data.hp.average!==undefined?String(data.hp.average)+(data.hp.formula?' ('+data.hp.formula+')':''):String(data.hp);
  const speedParts=[];
  if(data.speed){if(data.speed.walk)speedParts.push(data.speed.walk+' ft.');if(data.speed.fly)speedParts.push('fly '+data.speed.fly+' ft.');if(data.speed.swim)speedParts.push('swim '+data.speed.swim+' ft.');if(data.speed.climb)speedParts.push('climb '+data.speed.climb+' ft.');}
  const speedStr=speedParts.join(', ')||'—';
  const scores=['str','dex','con','int','wis','cha'],snames=['STR','DEX','CON','INT','WIS','CHA'];
  const immuneStr=[].concat(data.immune||[]).map(i=>typeof i==='string'?i:[].concat(i.immune||[]).join('/')).join(', ');
  const resistStr=[].concat(data.resist||[]).map(i=>typeof i==='string'?i:[].concat(i.resist||[]).join('/')).join(', ');
  const condImmStr=[].concat(data.conditionImmune||[]).map(i=>typeof i==='string'?i:[].concat(i.conditionImmune||[]).join('/')).join(', ');
  const sensesStr=[...(data.senses||[])].join(', ')+(data.passive?((data.senses||[]).length?', ':'')+'Passive Perception '+data.passive:'');
  const langStr=(data.languages||[]).join(', ')||'—';
  const hpFrac=(tok.hpMax>0)?(tok.hpCurrent||0)/tok.hpMax:0;
  const dexMod=Math.floor(((data.dex||10)-10)/2);
  const initProfBonus=(data.initiative&&data.initiative.proficiency===true)?getMonsterProfBonus(data.cr):0;
  const initTotal=dexMod+initProfBonus+(data.initBonus||0);
  const initStr=(initTotal>=0?'+':'')+initTotal;
  function rEntries(entries){return(entries||[]).map(e=>{if(typeof e==='string')return'<p style="margin:2px 0 3px;white-space:pre-wrap">'+parseEntry(e)+'</p>';if(e&&e.type==='list'&&Array.isArray(e.items))return'<ul style="margin:2px 0 3px;padding-left:14px">'+e.items.map(i=>'<li>'+parseEntry(typeof i==='string'?i:(i.name||''))+'</li>').join('')+'</ul>';return'';}).join('');}

  // Set _currentMonsterData for useMonsterAction (needed by both themes)
  const hasActions=(data.action?.length||0)+(data.bonus?.length||0)+(data.reaction?.length||0)+(data.legendary?.length||0)>0;
  if(hasActions){
    _currentMonsterData={name:data.name||'Monster',label:tok?.label||'',action:data.action||[],bonus:data.bonus||[],reaction:data.reaction||[],legendary:data.legendary||[]};
    if(!_sideOpenSections.has('monster-actions'))_sideOpenSections.add('monster-actions');
  }

  // ── Modern HUD ──────────────────────────────────────────────────────────────
  if(document.body.dataset.theme==='modern'){
    // Action row: Init (primary) + Info button
    const actionRowHtml=`<div class="rp-action-row">`
      +(tok?.linkedId?`<button class="btn sm" onclick="showMonsterInfoModal('${esc(tok.linkedId)}')" style="font-size:10px;padding:2px 7px">Info</button>`:'')
      +`<button class="btn sm primary" onclick="rollMonsterInitiativeFromPanel()" title="Roll Initiative (d20${initStr})" style="font-size:10px;padding:2px 7px">🎲 Init ${initStr}</button>`
      +`</div>`;

    // Secondary stats bar: CR | Initiative (clickable) | Speed | Passive Perc
    const walkSpd=data.speed?.walk?data.speed.walk+' ft.':speedStr||'—';
    const secItems=[
      {val:String(cr),lbl:'CR'},
      {val:initStr,lbl:'INITIATIVE',onclick:'rollMonsterInitiativeFromPanel()'},
      {val:walkSpd,lbl:'SPEED'},
    ];
    if(data.passive)secItems.push({val:String(data.passive),lbl:'PASS. PERC'});
    const secStatsHtml=`<div class="rp-sec-stats">`+secItems.map((s,i)=>
      (i>0?'<div class="rp-sec-divider"></div>':'')
      +`<div class="rp-sec-stat"${s.onclick?` onclick="${s.onclick}" style="cursor:pointer"`:''}>`
      +`<div class="rp-sec-val">${esc(String(s.val))}</div>`
      +`<div class="rp-sec-lbl">${esc(s.lbl)}</div></div>`
    ).join('')+`</div>`;

    // Ability grid — same rp-ability-block classes as character sheet
    const abilityGridHtml=`<div class="rp-ability-grid">`+scores.map((sc,i)=>{
      const val=data[sc]||10,m=Math.floor((val-10)/2),ms=(m>=0?'+':'')+m;
      return `<div class="rp-ability-block rp-ability-clickable" onclick="qroll('${snames[i]} Check','${ms}')" title="${snames[i]} Check (d20${ms})">`
        +`<div class="rp-ability-name">${snames[i]}</div>`
        +`<div class="rp-ability-mod">${ms}</div>`
        +`<div class="rp-ability-score">${val}</div></div>`;
    }).join('')+`</div>`;

    // Save grid — rp-save-grid with proficient saves highlighted
    const saveGridHtml=`<div class="rp-save-grid">`+scores.map((sc,i)=>{
      const profVal=data.save&&data.save[sc];
      const rawMod=Math.floor(((data[sc]||10)-10)/2);
      const val=profVal||(rawMod>=0?'+'+rawMod:''+rawMod);
      const prof=!!profVal;
      return `<div class="rp-save-cell${prof?' rp-save-prof':''}" onclick="qroll('${snames[i]} Save','${val}')" title="${snames[i]} Saving Throw${prof?' (proficient)':''}">`
        +`<div class="rp-save-val">${val}</div>`
        +`<div class="rp-save-name">${snames[i]}${prof?'<span class="rp-save-star">★</span>':''}</div></div>`;
    }).join('')+`</div>`;

    // Skills (only if monster has explicit skill entries)
    let skillsHtml='';
    if(data.skill&&Object.keys(data.skill).length){
      const rows=Object.entries(data.skill).map(([k,v])=>{
        const lbl=k.charAt(0).toUpperCase()+k.slice(1);
        return `<div class="qroll-row" onclick="qroll('${lbl}','${v}')">`
          +`<span>${lbl}</span><span class="qroll-val">${v}</span></div>`;
      }).join('');
      skillsHtml=`<div class="rp-flat-hdr">Skills</div><div class="rp-skill-grid">${rows}</div>`;
    }

    // Actions — flat rp-atk-list, same compact layout as character sheet attacks
    let actionsHtml='';
    if(hasActions){
      const rActItem=(item,section,idx)=>{
        const entryText=[].concat(item.entries||[]).join(' ');
        const atkMatch=entryText.match(/\{@hit\s([+-]?\d+)\}/i);
        const dmgTagMatch=entryText.match(/\{@damage\s+([^}]+)\}/i);
        const rawDmg=dmgTagMatch?dmgTagMatch[1]:(entryText.match(/\d+d\d+\s*(?:[+-]\s*\d+)?/i)?.[0]||'');
        const dmgStr=rawDmg.replace(/\s+/g,'');
        const sn=(item.name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const useBtn=`<span class="rp-mon-use-btn" onclick="useMonsterAction('${section}',${idx})" title="Send to chat">Use</span>`;
        if(atkMatch){
          const bonus=parseInt(atkMatch[1]);
          const atkClick=`qroll('${sn} atk','${bonus}')`;
          const dmgClick=dmgStr?`rollMonsterDamage('${section}',${idx},'${dmgStr}')`:null;
          return `<div class="rp-atk-row">`
            +`<span class="rp-atk-name" onclick="${atkClick}">${parseEntry(item.name||'')}</span>`
            +`<span class="rp-atk-hit" onclick="${atkClick}">${bonus>=0?'+':''}${bonus}</span>`
            +(dmgStr?`<span class="rp-atk-sep">·</span><span class="rp-atk-dmg" onclick="${dmgClick}">${esc(dmgStr)}</span>`:'')
            +useBtn+`</div>`;
        }
        return `<div class="rp-atk-row">`
          +`<span class="rp-atk-name" style="color:var(--ac);font-style:italic">${parseEntry(item.name||'')}</span>`
          +useBtn+`</div>`;
      };
      const rActGroup=(items,title,section)=>{
        if(!items||!items.length)return'';
        return `<div class="rp-flat-hdr">${title}</div>`
          +`<div class="rp-atk-list">${items.map((item,idx)=>rActItem(item,section,idx)).join('')}</div>`;
      };
      actionsHtml=rActGroup(data.action,'Actions','action')
        +rActGroup(data.bonus,'Bonus Actions','bonus')
        +rActGroup(data.reaction,'Reactions','reaction')
        +rActGroup(data.legendary,'Legendary Actions','legendary');
    }

    // Traits
    let traitsHtml='';
    if(data.trait&&data.trait.length){
      traitsHtml=`<div class="rp-flat-hdr">Traits</div>`
        +data.trait.map(t=>`<div class="rp-mon-trait">`
          +`<div class="rp-mon-trait-name">${parseEntry(t.name||'')}</div>`
          +`<div class="rp-mon-trait-body">${rEntries(t.entries)}</div></div>`
        ).join('');
    }

    // Defenses, senses, languages
    let defenseHtml='';
    const defLines=[];
    if(immuneStr)defLines.push({lbl:'Immune',val:immuneStr});
    if(resistStr)defLines.push({lbl:'Resist',val:resistStr});
    if(condImmStr)defLines.push({lbl:'Cond. Immune',val:condImmStr});
    if(sensesStr)defLines.push({lbl:'Senses',val:sensesStr});
    if(langStr&&langStr!=='—')defLines.push({lbl:'Languages',val:langStr});
    if(defLines.length){
      defenseHtml=`<div class="rp-flat-hdr">Defenses & Senses</div>`
        +`<div class="rp-mon-defense">`
        +defLines.map(l=>`<div><span class="rp-mon-defense-lbl">${esc(l.lbl)}</span> ${esc(l.val)}</div>`).join('')
        +`</div>`;
    }

    const linkHtml=tok?.linkedId
      ?`<div class="rp-mon-link"><a href="/monsters.html" target="_blank">📖 Full stat block →</a></div>`:'';

    return actionRowHtml+secStatsHtml
      +`<div class="rp-flat-hdr rp-abil-hdr">Abilities</div>`+abilityGridHtml
      +`<div class="rp-flat-hdr">Saving Throws</div>`+saveGridHtml
      +skillsHtml+actionsHtml+traitsHtml+defenseHtml+linkHtml;
  }

  // ── Classic path (unchanged) ─────────────────────────────────────────────────
  const HR='<hr style="border:none;border-top:1px solid var(--a44);margin:6px 0">';
  function rSection(items,title){if(!items||!items.length)return'';return HR+'<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:3px">'+title+'</div>'+items.map(item=>'<div style="margin:4px 0"><span style="color:var(--ac);font-weight:bold;font-style:italic">'+parseEntry(item.name||'')+'</span> '+rEntries(item.entries)+'</div>').join('');}
  function rSectionRollable(items,title){if(!items||!items.length)return'';const HR2=HR+'<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:3px">'+title+'</div>';return HR2+items.map(item=>{const entryText=[].concat(item.entries||[]).join(' ');const atkMatch=entryText.match(/\{@hit\s([+-]?\d+)\}|([+-]\d+)\s+to\s+hit/i);const dmgMatch=entryText.match(/\d+d\d+(?:[+-]\d+)?/i);if(atkMatch){const bonus=parseInt(atkMatch[1]||atkMatch[2]);const dmgStr=dmgMatch?dmgMatch[0]:'';const sn=item.name.replace(/'/g,"\\'");const dmgRow=dmgStr?'<div class="qroll-row" onclick="rollDamageStr(\''+sn+' Dmg\',\''+dmgStr+'\')" style="padding-left:20px;background:rgba(0,0,0,.15)"><span style="font-size:11px;color:var(--txd)">↳ Damage</span><span class="qroll-val" style="color:#ff9966;font-size:13px">'+esc(dmgStr)+'</span></div>':'';return'<div class="qroll-row" onclick="qroll(\''+sn+' atk\',\''+bonus+'\')" title="'+esc(entryText.slice(0,120))+'">'+'<span>'+parseEntry(item.name||'')+'</span>'+'<span class="qroll-val">'+(bonus>=0?'+':'')+bonus+'</span></div>'+dmgRow;}return'<div style="margin:4px 0"><span style="color:var(--ac);font-weight:bold;font-style:italic">'+parseEntry(item.name||'')+'</span> '+rEntries(item.entries)+'</div>';}).join('');}

  const actionsPanel = renderMonsterActionsPanel(data, tok);
  let html='<div style="font-size:11px;line-height:1.5">';
  if(size||typeStr||align)html+='<div style="font-size:10px;font-style:italic;color:var(--txd);margin-bottom:4px">'+esc([size,typeStr,align].filter(Boolean).join(', '))+'</div>';
  html+=HR;
  html+='<div><span style="color:var(--ac);font-weight:bold">HP</span> <span style="color:'+hpBarColor(hpFrac)+'">'+tok.hpCurrent+'/'+tok.hpMax+'</span> <span style="color:var(--txd);font-size:10px">('+esc(hpStr)+')</span></div>';
  html+='<div><span style="color:var(--ac);font-weight:bold">AC</span> '+esc(acStr)+'</div>';
  html+='<div><span style="color:var(--ac);font-weight:bold">Speed</span> '+esc(speedStr)+'</div>';
  html+='<div><span style="color:var(--ac);font-weight:bold">CR</span> '+esc(String(cr))+'</div>';
  html+=HR+'<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:2px;text-align:center;margin:4px 0">';
  for(let i=0;i<6;i++){const sc=scores[i];const val=data[sc]||10;const m=Math.floor((val-10)/2);const ms=(m>=0?'+':'')+m;html+='<div onclick="qroll(\''+snames[i]+' Check\',\''+ms+'\')" title="'+snames[i]+' ability check" style="background:var(--bg3);border-radius:3px;padding:3px 1px;cursor:pointer"><div style="font-size:8px;color:var(--ac);font-weight:bold">'+snames[i]+'</div><div style="font-size:12px;font-weight:bold">'+val+'</div><div style="font-size:9px;color:var(--txd)">'+ms+'</div></div>';}
  html+='</div>'+HR;
  html+=HR+'<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:3px">Saves</div>';
  html+=scores.map((sc,i)=>{const profVal=data.save&&data.save[sc];const rawMod=Math.floor(((data[sc]||10)-10)/2);const val=profVal||(rawMod>=0?'+'+rawMod:''+rawMod);const prof=!!profVal;return'<div class="qroll-row" onclick="qroll(\''+snames[i]+' Save\',\''+val+'\')" title="'+snames[i]+' Saving Throw'+(prof?' (proficient)':'')+'" style="'+(prof?'':'opacity:0.75')+'"><span>'+snames[i]+(prof?' ★':'')+'</span><span class="qroll-val">'+val+'</span></div>';}).join('');
  if(data.skill&&Object.keys(data.skill).length){html+=HR+'<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:3px">Skills</div>';html+=Object.entries(data.skill).map(([key,val])=>{const label=key.charAt(0).toUpperCase()+key.slice(1);return'<div class="qroll-row" onclick="qroll(\''+label+'\',\''+val+'\')" title="'+label+'"><span>'+label+'</span><span class="qroll-val">'+val+'</span></div>';}).join('');}
  if(immuneStr)html+='<div><span style="color:var(--ac);font-weight:bold">Immune</span> '+esc(immuneStr)+'</div>';
  if(resistStr)html+='<div><span style="color:var(--ac);font-weight:bold">Resist</span> '+esc(resistStr)+'</div>';
  if(condImmStr)html+='<div><span style="color:var(--ac);font-weight:bold">Cond. Immune</span> '+esc(condImmStr)+'</div>';
  if(sensesStr)html+='<div><span style="color:var(--ac);font-weight:bold">Senses</span> '+esc(sensesStr)+'</div>';
  html+='<div><span style="color:var(--ac);font-weight:bold">Languages</span> '+esc(langStr)+'</div>';
  html+=rSection(data.trait,'Traits');
  html+='<div style="margin-top:8px"><a href="/monsters.html" target="_blank" style="color:var(--ac);font-size:10px">📖 Full view →</a></div>';
  html+='</div>';
  return `<div style="padding:2px 0 4px;display:flex;align-items:center;justify-content:space-between">
    <span style="font-size:12px;color:#ff9999;font-weight:bold">${esc(data.name||'Monster')}${tok&&tok.label?` <span style="color:var(--txd);font-weight:normal;font-size:11px">[${esc(tok.label)}]</span>`:''}</span>
    <div style="display:flex;gap:4px">
      ${tok&&tok.linkedId?`<button class="btn sm" onclick="showMonsterInfoModal('${esc(tok.linkedId)}')" title="View full stat block" style="font-size:10px;padding:2px 6px">Info</button>`:''}
      <button class="btn sm" onclick="rollMonsterInitiativeFromPanel()" title="Roll Initiative (d20${initStr})" style="font-size:10px;padding:2px 6px">🎲 Init ${initStr}</button>
    </div>
  </div>
  ${actionsPanel}
  <div class="qroll-section">
    <div class="qroll-section-hdr" onclick="toggleSideSection('monster')">
      <span style="color:#ff9999">Stat Block</span>
      <span id="side-sec-monster-arrow">${_sideSecArrow('monster')}</span>
    </div>
    <div id="side-sec-monster" class="qroll-rows" style="${_sideSecStyle('monster')}">${html}</div>
  </div>`;
}

// ── Monster info modal (full stat block popup for DM) ─────────────────────────
let _infoModalMonsterId = null;

async function showMonsterInfoModal(linkedId) {
  let mon = _monsterList.find(m => m.id === linkedId);
  if (!mon) {
    try {
      const r = await fetch(`/api/monsters/${linkedId}`, { headers: authHeaders() });
      if (r.ok) { mon = await r.json(); _monsterList.push(mon); }
    } catch {}
  }
  if (!mon) return;
  _infoModalMonsterId = linkedId;
  document.getElementById('monster-info-table-title').textContent = mon.name || 'Monster';
  document.getElementById('monster-info-table-body').innerHTML = renderMonsterStatBlock(mon.data || {});
  document.getElementById('monster-info-modal').style.display = 'flex';
}

function closeMonsterInfoTableModal() {
  document.getElementById('monster-info-modal').style.display = 'none';
  _infoModalMonsterId = null;
}
