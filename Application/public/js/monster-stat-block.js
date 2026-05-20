// ── Shared monster stat block renderer ───────────────────────────────────────
// Single source of truth used by dm.js, monsters.js, and table-monsters.js.
// Depends on global `esc` (lib/esc.js or per-page definition).

function getMonsterProfBonus(cr) {
  const v = (cr && typeof cr === 'object') ? parseFloat(cr.cr) : parseFloat(cr);
  return isNaN(v) ? 2 : v < 5 ? 2 : v < 9 ? 3 : v < 13 ? 4 : v < 17 ? 5 : v < 21 ? 6 : v < 25 ? 7 : v < 29 ? 8 : 9;
}

function parseEntry(s) {
  const escaped = String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return escaped.replace(/\{@(\w+)\s([^}]*)\}/g, (_,tag,content) => {
    const p = content.split('|');
    switch(tag) {
      case 'spell': case 'item': case 'creature': case 'condition': case 'status': case 'variantrule': case 'sense': return '<em>'+p[0]+'</em>';
      case 'hit': return (parseInt(p[0])>=0?'+':'')+p[0];
      case 'damage': case 'dice': return p[0];
      case 'dc': return 'DC '+p[0];
      case 'h': case 'atk': case 'atkr': case 'actSaveSuccessOrFail': return '';
      case 'recharge': return '(Recharge '+p[0]+'–6)';
      case 'actSave': return p[0].charAt(0).toUpperCase()+p[0].slice(1)+' Save';
      case 'actSaveFail': return '<em>Failure:</em>';
      case 'actSaveSuccess': return '<em>Success:</em>';
      default: return p[0]||content;
    }
  }).replace(/\{@\w+\}/g,'');
}

function renderMonsterStatBlock(data) {
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
  function rEntries(entries){return(entries||[]).map(e=>{if(typeof e==='string')return'<p style="margin:2px 0 4px;white-space:pre-wrap">'+parseEntry(e)+'</p>';if(e&&e.type==='list'&&Array.isArray(e.items))return'<ul style="margin:2px 0 4px;padding-left:16px">'+e.items.map(i=>'<li>'+parseEntry(typeof i==='string'?i:(i.name||''))+'</li>').join('')+'</ul>';return'';}).join('');}
  function rSection(items,title){if(!items||!items.length)return'';return HR+'<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:4px">'+title+'</div>'+items.map(item=>'<div style="margin:5px 0"><span style="color:var(--ac);font-weight:bold;font-style:italic">'+parseEntry(item.name||'')+'</span> '+rEntries(item.entries)+'</div>').join('');}
  function rSpellEntries(list){return(list||[]).map(sc=>{let h='<div style="margin:5px 0"><span style="color:var(--ac);font-weight:bold;font-style:italic">'+esc(sc.name||'')+'</span> ';if(sc.headerEntries)h+=rEntries(sc.headerEntries);if(sc.will&&sc.will.length)h+='<p style="margin:2px 0 4px"><em>At will:</em> '+sc.will.map(s=>parseEntry(s)).join(', ')+'</p>';if(sc.daily)for(const[k,v]of Object.entries(sc.daily)){const n=k.replace('e','');h+='<p style="margin:2px 0 4px"><em>'+n+'/day'+(k.endsWith('e')?' each':'')+':</em> '+v.map(s=>parseEntry(s)).join(', ')+'</p>';}if(sc.spells)for(const[lvl,sd]of Object.entries(sc.spells)){const slots=sd.slots?' ('+sd.slots+' slot'+(sd.slots!==1?'s':'')+')':'';const ord=['','st','nd','rd'];const lvlStr=lvl==='0'?'Cantrips (at will)':lvl+(ord[+lvl]||'th')+'-level'+slots;h+='<p style="margin:2px 0 4px"><em>'+esc(lvlStr)+':</em> '+[].concat(sd.spells||[]).map(s=>parseEntry(s)).join(', ')+'</p>';}return h+'</div>';}).join('');}
  function rSectionWithSc(items,scList,title){const hi=items&&items.length;const hs=scList&&scList.length;if(!hi&&!hs)return'';return HR+'<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:4px">'+title+'</div>'+(hi?items.map(item=>'<div style="margin:5px 0"><span style="color:var(--ac);font-weight:bold;font-style:italic">'+parseEntry(item.name||'')+'</span> '+rEntries(item.entries)+'</div>').join(''):'')+rSpellEntries(scList);}
  let html='<div style="font-size:12px">';
  if (data.portraitMedium || data.portrait) {
    html += '<img src="'+esc(data.portraitMedium||data.portrait)+'" style="float:right;max-width:120px;max-height:120px;object-fit:cover;border-radius:4px;margin:0 0 8px 10px;border:1px solid var(--a44)">';
  }
  html+='<div style="font-size:16px;font-weight:bold;color:var(--ac)">'+esc(data.name||'Unknown')+'</div>';
  html+='<div style="font-size:12px;font-style:italic;color:var(--txd);margin-bottom:6px">'+esc([size,typeStr,alignment].filter(Boolean).join(', '))+(data.source?' <span style="font-size:10px;opacity:.6">('+esc(data.source)+')</span>':'')+'</div>';
  html+=HR;
  html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">AC</span> '+esc(String(acStr))+'</div>';
  html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">HP</span> '+esc(String(hpStr))+'</div>';
  html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Speed</span> '+esc(speedStr)+'</div>';
  html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Challenge</span> '+esc(String(cr))+'</div>';
  const prof=getMonsterProfBonus(data.cr);
  html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Proficiency Bonus</span> +'+prof+'</div>';
  const _dexMod=Math.floor(((data.dex||10)-10)/2);
  const _hasInitProf=!!(data.initiative&&data.initiative.proficiency);
  const _manualInit=data.initBonus||0;
  const _totalInit=_dexMod+(_hasInitProf?prof:0)+_manualInit;
  const _initParts=['DEX '+(_dexMod>=0?'+':'')+_dexMod];
  if(_hasInitProf)_initParts.push('Prof +'+prof);
  if(_manualInit!==0)_initParts.push('Mod '+(_manualInit>=0?'+':'')+_manualInit);
  html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Initiative</span> '+(_totalInit>=0?'+':'')+_totalInit+' <span style="font-size:10px;color:var(--txd)">('+_initParts.join(', ')+')</span></div>';
  html+=HR+'<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;text-align:center;margin:6px 0">';
  for(let i=0;i<6;i++){const sc=scores[i];const val=data[sc]||10;const m=Math.floor((val-10)/2);html+='<div style="background:var(--bg3);border-radius:3px;padding:4px 2px"><div style="font-size:9px;color:var(--ac);text-transform:uppercase;font-weight:bold">'+snames[i]+'</div><div style="font-size:13px;font-weight:bold">'+val+'</div><div style="font-size:10px;color:var(--txd)">'+(m>=0?'+':'')+m+'</div></div>';}
  html+='</div>'+HR;
  if(saveStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Saving Throws</span> '+esc(saveStr)+'</div>';
  if(skillStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Skills</span> '+esc(skillStr)+'</div>';
  if(immuneStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Damage Immunities</span> '+esc(immuneStr)+'</div>';
  if(resistStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Resistances</span> '+esc(resistStr)+'</div>';
  if(condImmStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Condition Immunities</span> '+esc(condImmStr)+'</div>';
  const vulnStr=[].concat(data.vulnerable||[]).map(i=>typeof i==='string'?i:[].concat(i.vulnerable||[]).join('/')).join(', ');
  if(vulnStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Damage Vulnerabilities</span> '+esc(vulnStr)+'</div>';
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
