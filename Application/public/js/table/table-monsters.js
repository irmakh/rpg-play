// ── Monster stat rendering (same logic as monsters.js) ───────────────────────
function parseEntry(s) {
  const escaped = String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return escaped.replace(/\{@(\w+)\s([^}]*)\}/g, (_,tag,content) => {
    const p = content.split('|');
    switch(tag) {
      case 'spell': case 'item': case 'creature': case 'condition': case 'status': case 'sense': return '<em>'+p[0]+'</em>';
      case 'hit': return (parseInt(p[0])>=0?'+':'')+p[0];
      case 'damage': case 'dice': return p[0];
      case 'dc': return 'DC '+p[0];
      case 'h': case 'atk': case 'atkr': return '';
      case 'recharge': return '(Recharge '+p[0]+'–6)';
      default: return p[0]||content;
    }
  }).replace(/\{@\w+\}/g,'');
}

function renderMonsterFullStats(data, tok) {
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
  const saveStr=data.save?Object.entries(data.save).map(([k,v])=>k[0].toUpperCase()+k.slice(1)+' '+v).join(', '):'';
  const skillStr=data.skill?Object.entries(data.skill).map(([k,v])=>k[0].toUpperCase()+k.slice(1)+' '+v).join(', '):'';
  const immuneStr=[].concat(data.immune||[]).map(i=>typeof i==='string'?i:[].concat(i.immune||[]).join('/')).join(', ');
  const resistStr=[].concat(data.resist||[]).map(i=>typeof i==='string'?i:[].concat(i.resist||[]).join('/')).join(', ');
  const condImmStr=[].concat(data.conditionImmune||[]).map(i=>typeof i==='string'?i:[].concat(i.conditionImmune||[]).join('/')).join(', ');
  const sensesStr=[...(data.senses||[])].join(', ')+(data.passive?((data.senses||[]).length?', ':'')+'Passive Perception '+data.passive:'');
  const langStr=(data.languages||[]).join(', ')||'—';
  const HR='<hr style="border:none;border-top:1px solid var(--a44);margin:6px 0">';
  function rEntries(entries){return(entries||[]).map(e=>{if(typeof e==='string')return'<p style="margin:2px 0 3px">'+parseEntry(e)+'</p>';if(e&&e.type==='list'&&Array.isArray(e.items))return'<ul style="margin:2px 0 3px;padding-left:14px">'+e.items.map(i=>'<li>'+parseEntry(typeof i==='string'?i:(i.name||''))+'</li>').join('')+'</ul>';return'';}).join('');}
  function rSection(items,title){if(!items||!items.length)return'';return HR+'<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:3px">'+title+'</div>'+items.map(item=>'<div style="margin:4px 0"><span style="color:var(--ac);font-weight:bold;font-style:italic">'+parseEntry(item.name||'')+'</span> '+rEntries(item.entries)+'</div>').join('');}
  function rSectionRollable(items,title){if(!items||!items.length)return'';const HR2=HR+'<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:3px">'+title+'</div>';return HR2+items.map(item=>{const entryText=[].concat(item.entries||[]).join(' ');const atkMatch=entryText.match(/\{@hit\s([+-]?\d+)\}|([+-]\d+)\s+to\s+hit/i);const dmgMatch=entryText.match(/\d+d\d+(?:[+-]\d+)?/i);if(atkMatch){const bonus=parseInt(atkMatch[1]||atkMatch[2]);const dmgStr=dmgMatch?dmgMatch[0]:'';const sn=item.name.replace(/'/g,"\\'");const dmgRow=dmgStr?'<div class="qroll-row" onclick="rollDamageStr(\''+sn+' Dmg\',\''+dmgStr+'\')" style="padding-left:20px;background:rgba(0,0,0,.15)"><span style="font-size:11px;color:var(--txd)">↳ Damage</span><span class="qroll-val" style="color:#ff9966;font-size:13px">'+esc(dmgStr)+'</span></div>':'';return'<div class="qroll-row" onclick="qroll(\''+sn+' atk\',\''+bonus+'\')" title="'+esc(entryText.slice(0,120))+'">'+'<span>'+parseEntry(item.name||'')+'</span>'+'<span class="qroll-val">'+(bonus>=0?'+':'')+bonus+'</span></div>'+dmgRow;}return'<div style="margin:4px 0"><span style="color:var(--ac);font-weight:bold;font-style:italic">'+parseEntry(item.name||'')+'</span> '+rEntries(item.entries)+'</div>';}).join('');}

  const hpFrac=(tok.hpMax>0)?(tok.hpCurrent||0)/tok.hpMax:0;
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
  html+=rSectionRollable(data.action,'Actions');
  html+=rSectionRollable(data.bonus,'Bonus Actions');
  html+=rSectionRollable(data.reaction,'Reactions');
  html+=rSectionRollable(data.legendary,'Legendary Actions');
  html+='<div style="margin-top:8px"><a href="/monsters.html" target="_blank" style="color:var(--ac);font-size:10px">📖 Full view →</a></div>';
  html+='</div>';
  const dexMod=Math.floor(((data.dex||10)-10)/2);const initStr=(dexMod>=0?'+':'')+dexMod;
  return `<div style="padding:2px 0 4px;display:flex;align-items:center;justify-content:space-between">
    <span style="font-size:12px;color:#ff9999;font-weight:bold">${esc(data.name||'Monster')}${tok&&tok.label?` <span style="color:var(--txd);font-weight:normal;font-size:11px">[${esc(tok.label)}]</span>`:''}</span>
    <div style="display:flex;gap:4px">
      ${tok&&tok.linkedId?`<button class="btn sm" onclick="showMonsterInfoModal('${esc(tok.linkedId)}')" title="View full stat block" style="font-size:10px;padding:2px 6px">Info</button>`:''}
      <button class="btn sm" onclick="rollMonsterInitiativeFromPanel()" title="Roll Initiative (d20${initStr})" style="font-size:10px;padding:2px 6px">🎲 Init ${initStr}</button>
    </div>
  </div>
  <div class="qroll-section">
    <div class="qroll-section-hdr" onclick="toggleSideSection('monster')">
      <span style="color:#ff9999">Stat Block</span>
      <span id="side-sec-monster-arrow">${_sideSecArrow('monster')}</span>
    </div>
    <div id="side-sec-monster" class="qroll-rows" style="${_sideSecStyle('monster')}">${html}</div>
  </div>`;
}

// ── Monster info modal (full stat block popup for DM) ─────────────────────────
function renderMonsterInfoFull(data) {
  const SZ={T:'Tiny',S:'Small',M:'Medium',L:'Large',H:'Huge',G:'Gargantuan'};
  const AL={L:'Lawful',N:'Neutral',C:'Chaotic',G:'Good',E:'Evil',U:'Unaligned',A:'Any'};
  const size=(data.size||[]).map(s=>SZ[s]||s).join('/');
  const typeStr=typeof data.type==='string'?data.type:data.type?(data.type.type||'')+(data.type.tags&&data.type.tags.length?' ('+data.type.tags.join(', ')+')':''):'';
  const alignment=(data.alignment||[]).map(a=>AL[a]||a).join(' ');
  const cr=(data.cr&&typeof data.cr==='object')?data.cr.cr:(data.cr||'—');
  const acStr=!data.ac?'—':[].concat(data.ac).map(a=>typeof a==='number'?a:typeof a==='object'?String(a.ac||'')+([].concat(a.from||[]).length?' ('+[].concat(a.from).join(', ')+')':''):a).join(', ');
  const hpStr=!data.hp?'—':data.hp.average!==undefined?String(data.hp.average)+(data.hp.formula?' ('+data.hp.formula+')':''):String(data.hp);
  const speedParts=[];
  if(data.speed){if(data.speed.walk)speedParts.push(data.speed.walk+' ft.');if(data.speed.fly)speedParts.push('fly '+data.speed.fly+' ft.');if(data.speed.swim)speedParts.push('swim '+data.speed.swim+' ft.');if(data.speed.climb)speedParts.push('climb '+data.speed.climb+' ft.');if(data.speed.burrow)speedParts.push('burrow '+data.speed.burrow+' ft.');}
  const speedStr=speedParts.join(', ')||'—';
  const scores=['str','dex','con','int','wis','cha'];const snames=['STR','DEX','CON','INT','WIS','CHA'];
  const saveStr=data.save?Object.entries(data.save).map(([k,v])=>k[0].toUpperCase()+k.slice(1)+' '+v).join(', '):'';
  const skillStr=data.skill?Object.entries(data.skill).map(([k,v])=>k[0].toUpperCase()+k.slice(1)+' '+v).join(', '):'';
  const immuneStr=[].concat(data.immune||[]).map(i=>typeof i==='string'?i:[].concat(i.immune||[]).join('/')).join(', ');
  const resistStr=[].concat(data.resist||[]).map(i=>typeof i==='string'?i:[].concat(i.resist||[]).join('/')).join(', ');
  const condImmStr=[].concat(data.conditionImmune||[]).map(i=>typeof i==='string'?i:[].concat(i.conditionImmune||[]).join('/')).join(', ');
  const sensesStr=[...(data.senses||[])].join(', ')+(data.passive?((data.senses||[]).length?', ':'')+('Passive Perception '+data.passive):'');
  const langStr=(data.languages||[]).join(', ')||'—';
  const HR='<hr style="border:none;border-top:1px solid var(--a44);margin:8px 0">';
  function rEntries(entries){return(entries||[]).map(e=>{if(typeof e==='string')return'<p style="margin:2px 0 4px">'+parseEntry(e)+'</p>';if(e&&e.type==='list'&&Array.isArray(e.items))return'<ul style="margin:2px 0 4px;padding-left:16px">'+e.items.map(i=>'<li>'+parseEntry(typeof i==='string'?i:(i.name||''))+'</li>').join('')+'</ul>';return'';}).join('');}
  function rSection(items,title){if(!items||!items.length)return'';return HR+'<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:4px">'+title+'</div>'+items.map(item=>'<div style="margin:5px 0"><span style="color:var(--ac);font-weight:bold;font-style:italic">'+parseEntry(item.name||'')+'</span> '+rEntries(item.entries)+'</div>').join('');}
  function rSpellEntries(list){return(list||[]).map(sc=>{let h='<div style="margin:5px 0"><span style="color:var(--ac);font-weight:bold;font-style:italic">'+esc(sc.name||'')+'</span> ';if(sc.headerEntries)h+=rEntries(sc.headerEntries);if(sc.will&&sc.will.length)h+='<p style="margin:2px 0 4px"><em>At will:</em> '+sc.will.map(s=>parseEntry(s)).join(', ')+'</p>';if(sc.daily)for(const[k,v]of Object.entries(sc.daily)){const n=k.replace('e','');h+='<p style="margin:2px 0 4px"><em>'+n+'/day'+(k.endsWith('e')?' each':'')+':</em> '+v.map(s=>parseEntry(s)).join(', ')+'</p>';}if(sc.spells)for(const[lvl,sd]of Object.entries(sc.spells)){const slots=sd.slots?' ('+sd.slots+' slot'+(sd.slots!==1?'s':'')+')':'';const ord=['','st','nd','rd'];const lvlStr=lvl==='0'?'Cantrips (at will)':lvl+(ord[+lvl]||'th')+'-level'+slots;h+='<p style="margin:2px 0 4px"><em>'+esc(lvlStr)+':</em> '+[].concat(sd.spells||[]).map(s=>parseEntry(s)).join(', ')+'</p>';}return h+'</div>';}).join('');}
  function rSectionWithSc(items,scList,title){const hi=items&&items.length;const hs=scList&&scList.length;if(!hi&&!hs)return'';return HR+'<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:4px">'+title+'</div>'+(hi?items.map(item=>'<div style="margin:5px 0"><span style="color:var(--ac);font-weight:bold;font-style:italic">'+parseEntry(item.name||'')+'</span> '+rEntries(item.entries)+'</div>').join(''):'')+rSpellEntries(scList);}
  let html='<div style="font-size:12px">';
  html+='<div style="font-size:16px;font-weight:bold;color:var(--ac)">'+esc(data.name||'Unknown')+'</div>';
  html+='<div style="font-size:12px;font-style:italic;color:var(--txd);margin-bottom:6px">'+esc([size,typeStr,alignment].filter(Boolean).join(', '))+(data.source?' <span style="font-size:10px;opacity:.6">('+esc(data.source)+')</span>':'')+'</div>';
  html+=HR;
  html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">AC</span> '+esc(String(acStr))+'</div>';
  html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">HP</span> '+esc(String(hpStr))+'</div>';
  html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Speed</span> '+esc(speedStr)+'</div>';
  html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Challenge</span> '+esc(String(cr))+'</div>';
  html+=HR+'<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;text-align:center;margin:6px 0">';
  for(let i=0;i<6;i++){const sc=scores[i];const val=data[sc]||10;const m=Math.floor((val-10)/2);html+='<div style="background:var(--bg3);border-radius:3px;padding:4px 2px"><div style="font-size:9px;color:var(--ac);text-transform:uppercase;font-weight:bold">'+snames[i]+'</div><div style="font-size:13px;font-weight:bold">'+val+'</div><div style="font-size:10px;color:var(--txd)">'+(m>=0?'+':'')+m+'</div></div>';}
  html+='</div>'+HR;
  if(saveStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Saving Throws</span> '+esc(saveStr)+'</div>';
  if(skillStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Skills</span> '+esc(skillStr)+'</div>';
  if(immuneStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Damage Immunities</span> '+esc(immuneStr)+'</div>';
  if(resistStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Resistances</span> '+esc(resistStr)+'</div>';
  if(condImmStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Condition Immunities</span> '+esc(condImmStr)+'</div>';
  if(sensesStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Senses</span> '+esc(sensesStr)+'</div>';
  html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Languages</span> '+esc(langStr)+'</div>';
  const scGroups={};for(const sc of(data.spellcasting||[])){const k=(sc.displayAs||'trait').toLowerCase();(scGroups[k]||(scGroups[k]=[])).push(sc);}
  const traitSc=Object.entries(scGroups).filter(([k])=>!['action','bonus','reaction','legendary','mythic'].includes(k)).flatMap(([,v])=>v);
  html+=rSection(data.trait,'Traits');
  if(traitSc.length)html+=HR+'<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:4px">Spellcasting</div>'+rSpellEntries(traitSc);
  html+=rSectionWithSc(data.action,scGroups['action'],'Actions');
  html+=rSectionWithSc(data.bonus,scGroups['bonus'],'Bonus Actions');
  html+=rSectionWithSc(data.reaction,scGroups['reaction'],'Reactions');
  html+=rSectionWithSc(data.legendary,scGroups['legendary'],'Legendary Actions');
  html+=rSection(data.mythic,'Mythic Actions');
  html+='</div>';
  return html;
}

function showMonsterInfoModal(linkedId) {
  const mon = _monsterList.find(m => m.id === linkedId);
  if (!mon) return;
  document.getElementById('monster-info-table-title').textContent = mon.name || 'Monster';
  document.getElementById('monster-info-table-body').innerHTML = renderMonsterInfoFull(mon.data || {});
  document.getElementById('monster-info-modal').style.display = 'flex';
}

function closeMonsterInfoTableModal() {
  document.getElementById('monster-info-modal').style.display = 'none';
}
