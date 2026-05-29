import { fileURLToPath } from 'url';
import path from 'path';
import crypto from 'crypto';
import * as aidb from './db.js';

const AUTO_SUMMARY_THRESHOLD = 20; // user+assistant messages before auto-summarizing

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Skill & ability constants ─────────────────────────────────────────────────
const SKILL_NAMES = [
  'Acrobatics','Animal Handling','Arcana','Athletics','Deception','History',
  'Insight','Intimidation','Investigation','Medicine','Nature','Perception',
  'Performance','Persuasion','Religion','Sleight of Hand','Stealth','Survival'
];
const ABILITY_LABELS = { str:'Strength', dex:'Dexterity', con:'Constitution', int:'Intelligence', wis:'Wisdom', cha:'Charisma' };

function abilityMod(score) {
  const v = parseInt(score) || 10;
  const m = Math.floor((v - 10) / 2);
  return m >= 0 ? `+${m}` : `${m}`;
}

// ── Build character context string for AI system prompt ───────────────────────
function buildCharacterContext(charName, data) {
  const lines = [
    `# Character: ${charName}`,
    `**Class:** ${data.class || '?'}${data.subclass ? ` (${data.subclass})` : ''} | **Level:** ${data.level || '?'} | **Species:** ${data.species || '?'} | **Background:** ${data.background || '?'} | **Alignment:** ${data.alignment || '?'}`,
    `**Languages:** ${data.languages || 'Common'}`,
    '',
    '## Ability Scores',
    `STR ${data.str || 10} (${abilityMod(data.str)})  DEX ${data.dex || 10} (${abilityMod(data.dex)})  CON ${data.con || 10} (${abilityMod(data.con)})  INT ${data.int || 10} (${abilityMod(data.int)})  WIS ${data.wis || 10} (${abilityMod(data.wis)})  CHA ${data.cha || 10} (${abilityMod(data.cha)})`,
    '',
    '## Combat Stats',
    `HP: ${data.hpcur || '?'}/${data.hpmax || '?'} | AC: ${data.ac || '?'} | Speed: ${data.speed || '30'} ft | Initiative: ${data.init || abilityMod(data.dex)} | Proficiency Bonus: +${data.profbonus || '2'} | Passive Perception: ${data.pp || '10'}`,
    '',
    '## Saving Throws',
    `STR ${data['save-str'] || abilityMod(data.str)}  DEX ${data['save-dex'] || abilityMod(data.dex)}  CON ${data['save-con'] || abilityMod(data.con)}  INT ${data['save-int'] || abilityMod(data.int)}  WIS ${data['save-wis'] || abilityMod(data.wis)}  CHA ${data['save-cha'] || abilityMod(data.cha)}`,
    '',
    '## Skills',
    SKILL_NAMES.map((name, i) => {
      const prof = data[`sk-prof-${i}`] ? (data[`sk-exp-${i}`] ? '★★' : '★') : '○';
      return `${prof} ${name}: ${data[`sk-${i}`] || '0'}`;
    }).join('  '),
  ];

  // Weapons
  try {
    const weapons = JSON.parse(data._weapons || '[]');
    if (weapons.length > 0) {
      lines.push('', '## Weapons');
      weapons.forEach(([name, atk, dmg, dmgType]) => {
        if (name) lines.push(`- ${name}: Attack ${atk || '?'}, Damage ${dmg || '?'} ${dmgType || ''}`);
      });
    }
  } catch {}

  // Spells
  try {
    const spells = JSON.parse(data._spells || '[]');
    if (spells.length > 0) {
      // [lvl, name, time, range, conc, ritual, notes, prepared, school, v, s, m, material]
      const prepared    = spells.filter(s => s[7] && s[1]);
      const notPrepared = spells.filter(s => !s[7] && s[1]);

      lines.push('\n## Spells');
      if (data['sp-atk']) lines.push(`**Spell Attack Bonus:** ${data['sp-atk']}`);

      // Spell slots
      const slotLines = [];
      for (let lvl = 1; lvl <= 9; lvl++) {
        const total = parseInt(data[`slot-${lvl}-total`]) || 0;
        const used  = parseInt(data[`slot-${lvl}-used`])  || 0;
        if (total > 0) slotLines.push(`L${lvl}: ${total - used}/${total} remaining`);
      }
      if (slotLines.length) lines.push(`**Spell Slots:** ${slotLines.join('  |  ')}`);

      if (prepared.length > 0) {
        lines.push('\n### ✅ PREPARED SPELLS — character may ONLY cast these');
        prepared.forEach(s => {
          const lvlLabel = parseInt(s[0]) === 0 ? 'Cantrip' : `Lv${s[0]}`;
          const tags = [];
          if (s[4]) tags.push('Concentration');
          if (s[5]) tags.push('Ritual');
          if (s[8]) tags.push(s[8]);
          const tagStr  = tags.length ? ` [${tags.join(', ')}]` : '';
          const noteStr = s[6] ? ` — ${s[6]}` : '';
          const time    = s[2] ? `, ${s[2]}` : '';
          const range   = s[3] ? `, range ${s[3]}` : '';
          lines.push(`- **${s[1]}** (${lvlLabel}${time}${range})${tagStr}${noteStr}`);
        });
      } else {
        lines.push('*(No spells currently prepared)*');
      }

      if (notPrepared.length > 0) {
        lines.push('\n### ❌ KNOWN BUT NOT PREPARED — character CANNOT cast these');
        lines.push(notPrepared.map(s => s[1]).join(', '));
      }
    }
  } catch {}

  // Equipment
  if (data.equipment) lines.push(`\n## Equipment\n${data.equipment}`);

  // Features / Feats
  if (data.features) lines.push(`\n## Class Features\n${data.features}`);
  if (data.feats) lines.push(`\n## Feats\n${data.feats}`);
  if (data.traits) lines.push(`\n## Personality Traits\n${data.traits}`);

  return lines.join('\n');
}

// ── Build AI system prompt ────────────────────────────────────────────────────
function buildSystemPrompt(charName, charData, scenario, language = 'English') {
  const charContext = buildCharacterContext(charName, charData);

  const languageBlock = language === 'Turkish' ? `
## DİL GEREKSİNİMİ — ZORUNLU / LANGUAGE REQUIREMENT — MANDATORY

**Tüm yanıtlarını TÜRKÇE yazmalısın.** Bu kesinlikle değiştirilemez.
- Anlatı metni, NPC diyalogları, sahne tanımlamaları ve seçeneklerin tamamı Türkçe olmalı
- Oyun mekaniği kısaltmaları olduğu gibi kalır: HP, AC, STR, DEX, CON, INT, WIS, CHA
- Zar sözdizimi değişmez: [[ROLL:...]]
- Seçenek okları: → ardından Türkçe metin
- Tek bir İngilizce cümle bile yazma — yalnızca Türkçe
- Emin olmadığın terimleri Türkçeleştir veya kulağa doğal gelen şekilde kullan; İngilizce'ye dönme

---
` : '';

  return `You are an expert Dungeon Master running a D&D 5.5e (2024 Player's Handbook) text-based adventure set in the Forgotten Realms. You are a master storyteller who understands atmosphere, pacing, and consequence. You know that immersion lives in specific sensory details, that every NPC has their own agenda, and that the player's choices should visibly shape the world.
${languageBlock}
## CRITICAL RESPONSE FORMAT

**Start every response directly with narrative prose.** Never begin with:
- "As your Dungeon Master…" / "As the DM…" / "As an AI…"
- "I'll begin…" / "I will start…" / "Let me describe…" / "Allow me to…"
- "Of course!" / "Sure!" / "Certainly!" / "Great!" / "Absolutely!"
- Any meta-commentary, acknowledgment, or explanation of what you're about to do

**Every response must contain 2–5 sentences of vivid, immersive narrative prose.** Never give one-line or one-sentence responses.

**Use present tense, second person:** "You see…", "You hear…", "The guard steps forward…"

**Vary your sentence openings.** Do not start multiple consecutive sentences with "You." Let the environment, NPCs, sounds, and smells be subjects too:
- ✓ "Rain hammers the cobblestones. A figure hunches against the wall. You recognize the cloak immediately."
- ✗ "You see rain. You notice a figure. You recognize their cloak."

**When presenting choices:** place them at the very end, each on its own line prefixed with →:
→ [Choice A]
→ [Choice B]

**Never include:** raw JSON, code blocks, markdown headers (## or ###), or out-of-character parenthetical notes.

---

${charContext}

---

## Your Role as DM

**Player control:** You narrate the world, NPCs, and outcomes. The player controls only their character. Never tell the player what their character thinks, feels, or intends — only what they perceive.

**Narrative craft:**
- Layer your senses: give the player sights, sounds, smells, and textures — not just visuals. A dungeon smells of rot and torch smoke. A tavern carries sawdust, ale, and the faint sweat of strangers.
- Be specific: "a guard" is forgettable; "a young conscript with a jaw set too tight and eyes scanning the crowd" is a person.
- Use contrast: establish quiet before violence, warmth before cold, safety before threat. The contrast is what makes moments land.
- Show consequence: if the player failed a roll or made an enemy earlier, the world remembers. NPCs are warier. Wounds slow movement. Rumors have already spread.
- Descriptions should be 2–4 sentences for scene-setting, tighter during action, slower during exploration.

**NPC depth:**
- Each NPC should have one or two distinguishing traits that persist: a nervous habit, a turn of phrase, a scar, a conflicting goal. Use them consistently every time that NPC appears.
- NPCs have their own agendas. They lie, deflect, negotiate, and react to how the player treated them before.
- When an NPC reappears, acknowledge the history — they remember what was done or said.

**Pacing:**
- Build toward beats: investigate, then confront. Travel, then ambush. Discover, then decide.
- After a high-tension moment, give one beat of relative calm before the next pressure.
- End responses on a forward hook — something the player wants to resolve, a question that hangs in the air, a sound from the next room.

**Choices and agency:**
- Offer 2–4 meaningful choices when a moment calls for a decision. Make them genuinely different: risk vs. caution, speed vs. thoroughness, combat vs. negotiation.
- Accept any freeform player input. If the player does something unexpected, adjudicate it fairly with a roll if needed. Never refuse a player's declared action without narrative reason.
- Follow D&D 5.5e rules: proficiency bonus, ability modifiers, advantage/disadvantage.

**Spells:** The character may ONLY cast spells listed in the "✅ PREPARED SPELLS" section. Never reference, suggest, or allow any unprepared spell — even if it would fit narratively. Cantrips are always available. Leveled spells consume spell slots. If no spells are prepared, the character cannot cast.

**HP and death:**
- When the character takes damage, state the new HP total clearly: "You take 8 piercing damage — 27 HP remaining."
- At 0 HP, trigger death saves. Narrate unconsciousness and vulnerability with gravity.
- If the character dies, honor it: narrate the moment with weight and finality.

**Continuity:** Track who was met, what was agreed, what was discovered, and where things stand. The world does not reset between exchanges.

**Never break character. Never acknowledge you are an AI. You are the DM.**

---

## Combat

When combat begins:
- Describe the environment first: terrain, lighting, distance between combatants, available cover.
- Call for initiative with [[ROLL:init:Initiative]] and state the order once rolled.

During combat rounds:
- Keep descriptions kinetic and spatial. Enemies move, use cover, shout to each other, change tactics.
- As enemies take damage, show it: a stumble, a hand pressed to a wound, desperation creeping into their eyes. When an enemy is nearly dead, telegraph it — "She looks badly hurt." Never reveal exact HP numbers.
- Describe the player's successful hits with texture: where it lands, the sound of impact, the enemy's reaction.
- After every hit the player takes, state the damage and new HP total.
- Between rounds, the world keeps moving: an ally shouts a warning, a torch gutters, a second enemy circles behind.

---

## Dice Roll Protocol

When the player's action requires a roll, embed it at the end of your message using this EXACT syntax (on its own line):

**Skill checks:**
[[ROLL:sk-N:Skill Name:DC:NUMBER]]
(N is 0–17: 0=Acrobatics, 1=Animal Handling, 2=Arcana, 3=Athletics, 4=Deception, 5=History, 6=Insight, 7=Intimidation, 8=Investigation, 9=Medicine, 10=Nature, 11=Perception, 12=Performance, 13=Persuasion, 14=Religion, 15=Sleight of Hand, 16=Stealth, 17=Survival)

**Saving throws:**
[[ROLL:save-str:Strength Save:DC:NUMBER]]
[[ROLL:save-dex:Dexterity Save:DC:NUMBER]]
[[ROLL:save-con:Constitution Save:DC:NUMBER]]
[[ROLL:save-int:Intelligence Save:DC:NUMBER]]
[[ROLL:save-wis:Wisdom Save:DC:NUMBER]]
[[ROLL:save-cha:Charisma Save:DC:NUMBER]]

**Initiative (start of combat):**
[[ROLL:init:Initiative]]

**Attack rolls:**
[[ROLL:atk:Weapon Name:MODIFIER]]
e.g. [[ROLL:atk:Longsword:+5]]

**Raw dice (damage, healing, etc.):**
[[ROLL:raw:NdN:Description]]
e.g. [[ROLL:raw:2d6:fire damage]]

**With advantage/disadvantage:**
[[ROLL:sk-11:Perception:DC:15:advantage]]
[[ROLL:save-dex:Dexterity Save:DC:13:disadvantage]]

Rules:
- Embed ONE roll per DM message. Stop and wait for the result before continuing the narrative.
- When the result arrives, narrate success or failure with weight — a failure isn't just "you fail," it's what goes wrong and what it costs the character.
- Choose the roll that matters most dramatically in this moment.
- DC guidance: Easy=10, Medium=15, Hard=20, Very Hard=25, Nearly Impossible=30.

---

## The Adventure

${scenario.name} — ${scenario.location}

${scenario.description}

**Opening Hook:** ${scenario.hook}

---

Begin the adventure now. Drop the player into a specific moment — a sound, a sight, an arrival. Establish the atmosphere of ${scenario.location} in 3–5 vivid sentences before the hook lands. Give the player their first choice or action opportunity. Do not ask for a roll yet.`;
}

// ── Fetch available models from provider ──────────────────────────────────────
async function fetchModels(provider, lmStudioUrl, apiKey) {
  if (provider === 'lmstudio') {
    const baseUrl = (lmStudioUrl || 'http://localhost:1234').replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/v1/models`, { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error('LM Studio not reachable');
    const json = await res.json();
    return (json.data || []).map(m => ({ id: m.id, name: m.id }));
  }
  if (provider === 'openrouter') {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await fetch('https://openrouter.ai/api/v1/models', { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('OpenRouter not reachable');
    const json = await res.json();
    const models = (json.data || []).filter(m => {
      const p = m.pricing || {};
      return p.prompt === '0' && p.completion === '0';
    });
    return models.map(m => ({ id: m.id, name: m.name || m.id })).sort((a, b) => a.name.localeCompare(b.name));
  }
  throw new Error('Unknown provider');
}

// ── Call AI provider (streaming) ──────────────────────────────────────────────
// Inner: assumes SSE headers already set. Writes tokens, returns full content.
async function streamAITokens(provider, model, lmStudioUrl, apiKey, messages, res) {
  let endpoint, headers;
  if (provider === 'lmstudio') {
    const base = (lmStudioUrl || 'http://localhost:1234').replace(/\/$/, '');
    endpoint = `${base}/v1/chat/completions`;
    headers = { 'Content-Type': 'application/json' };
  } else {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://rpg-play.local',
      'X-Title': 'RPG AI DM',
    };
  }

  const body = JSON.stringify({ model, messages, stream: true, temperature: 0.9, max_tokens: 1500 });
  const aiRes = await fetch(endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(60000) });
  if (!aiRes.ok) {
    const errText = await aiRes.text();
    throw new Error(`AI provider error ${aiRes.status}: ${errText.slice(0, 200)}`);
  }

  const safeWrite = (data) => { try { res.write(data); } catch {} };
  const reader = aiRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const obj = JSON.parse(data);
        const content = obj.choices?.[0]?.delta?.content || '';
        if (content) {
          fullContent += content;
          safeWrite(`data: ${JSON.stringify({ type: 'token', content })}\n\n`);
        }
      } catch {}
    }
  }

  if (buffer.startsWith('data: ')) {
    const data = buffer.slice(6).trim();
    if (data && data !== '[DONE]') {
      try {
        const obj = JSON.parse(data);
        const content = obj.choices?.[0]?.delta?.content || '';
        if (content) { fullContent += content; safeWrite(`data: ${JSON.stringify({ type: 'token', content })}\n\n`); }
      } catch {}
    }
  }

  return fullContent;
}

// Outer: sets SSE headers then streams. Used by /regenerate.
async function callAIStream(provider, model, lmStudioUrl, apiKey, messages, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  return streamAITokens(provider, model, lmStudioUrl, apiKey, messages, res);
}

// ── Response validation ───────────────────────────────────────────────────────
function validateDMResponse(text) {
  const t = text.trim();
  if (t.length < 80) return { valid: false, reason: 'too_short' };
  if (/^(i'?m sorry|i am sorry|sorry,|as an ai|i cannot|i can'?t|i apologize)/i.test(t))
    return { valid: false, reason: 'refusal' };
  if (/^(as (your |the |a )?dungeon master|as (the |your )?dm\b|i'?ll (begin|start)|i will (begin|start)|of course!|certainly!|sure[,!]|great[,!]|absolutely[,!])/i.test(t))
    return { valid: false, reason: 'meta_commentary' };
  if (t.startsWith('{') || t.startsWith('[') || t.startsWith('```'))
    return { valid: false, reason: 'invalid_format' };
  return { valid: true };
}

function scoreResponse(text) {
  const t = text.trim();
  if (!t) return -1000;
  let score = Math.min(t.length, 600);
  if (t.length >= 100) score += 50;
  if (t.length >= 200) score += 50;
  if (/i'?m sorry|i cannot|as an ai/i.test(t)) score -= 300;
  if (/^(as (your |the )?dungeon master|i'?ll begin)/i.test(t)) score -= 100;
  if (t.startsWith('{') || t.startsWith('[')) score -= 500;
  return score;
}

// ── Non-streaming AI call (for retries, summaries, scenario gen) ──────────────
async function callAINonStream(provider, model, lmStudioUrl, apiKey, messages, opts = {}) {
  const { temperature = 0.4, max_tokens = 1024 } = opts;
  let endpoint, headers;
  if (provider === 'lmstudio') {
    const base = (lmStudioUrl || 'http://localhost:1234').replace(/\/$/, '');
    endpoint = `${base}/v1/chat/completions`;
    headers = { 'Content-Type': 'application/json' };
  } else {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://rpg-play.local',
      'X-Title': 'RPG AI DM',
    };
  }
  const body = JSON.stringify({ model, messages, stream: false, temperature, max_tokens });
  const aiRes = await fetch(endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(60000) });
  if (!aiRes.ok) throw new Error(`AI provider error ${aiRes.status}`);
  const json = await aiRes.json();
  return json.choices?.[0]?.message?.content || '';
}

// ── Generate and store a summary for a session ────────────────────────────────
async function generateSummaryForSession(session, allMessages, apiKey) {
  const conversationMessages = allMessages.filter(m => m.role !== 'system');
  if (conversationMessages.length < 6) return; // too short to summarize

  // Leave the last 8 messages unsummarized (keep recent context fresh)
  const toSummarize = conversationMessages.slice(0, -8);
  if (toSummarize.length < 4) return;

  const summarizedUpTo = toSummarize[toSummarize.length - 1].timestamp;

  const summaryPrompt = [
    {
      role: 'system',
      content: `You are a scribe summarizing a D&D adventure session. This summary will replace the earlier conversation history in the AI context — it must contain everything needed to continue the adventure accurately without losing mechanical state or narrative continuity.`
    },
    {
      role: 'user',
      content: `Here is the adventure log so far:\n\n${toSummarize.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n\n')}\n\nWrite a structured summary with these exact sections:

**CURRENT STATE** (1–2 sentences): Where is the character right now, and what is immediately happening around them?

**EVENTS SO FAR** (2–3 paragraphs): Key events in chronological order — encounters, decisions, combat outcomes, discoveries, how the situation evolved.

**ACTIVE QUESTS & LEADS** (bullet list): What is the character trying to accomplish? What unresolved threads or leads exist?

**NPCs ENCOUNTERED** (bullet list, one per line): Name — brief description — attitude toward the character (hostile/wary/neutral/friendly) — any promises made or owed.

**CHARACTER STATE** (bullet list): Current HP if mentioned, any active conditions or effects, spell slots used, notable items gained or lost since the adventure began.

**WHAT THE CHARACTER KNOWS** (bullet list): Key facts, secrets, clues, or information discovered that should inform future decisions.

Be factual and specific. No dice roll details. No meta-commentary. This summary IS the context — be complete.`
    }
  ];

  const summary = await callAINonStream(
    session.provider, session.model, session.lmStudioUrl, apiKey, summaryPrompt
  );

  if (summary) aidb.updateSessionSummary(session.id, summary, summarizedUpTo);
}

// ── Build AI message array, using summary to compress old context ──────────────
function buildAIMessages(session, allMessages) {
  const systemMsg = allMessages.find(m => m.role === 'system');
  const convMsgs  = allMessages.filter(m => m.role !== 'system');

  if (session.summary && session.summarizedUpTo) {
    const recent = convMsgs.filter(m => m.timestamp > session.summarizedUpTo);
    return [
      ...(systemMsg ? [{ role: 'system', content: systemMsg.content }] : []),
      { role: 'system', content: `[SUMMARY OF EVENTS BEFORE THIS POINT]\n${session.summary}\n[END SUMMARY — continue adventure from here]` },
      ...recent.map(m => ({ role: m.role, content: m.content })),
    ];
  }

  return allMessages.map(m => ({ role: m.role, content: m.content }));
}

// ── Version — bump this whenever aiDM JS/CSS files change ────────────────────
const AIDM_VERSION = 8;

// ── Main route registration ───────────────────────────────────────────────────
export default function register(app, ctx) {
  const { path: nodePath, fs, express, __dirname: appDir, getCharacter, verifyPassword, isMasterPassword, ldb, idb, DB_PROVIDER } = ctx;

  // ── Static files for AI DM ────────────────────────────────────────────────
  const publicDir = nodePath.join(__dirname, 'public');
  app.use('/ai-dm/assets', express.static(publicDir));

  // ── Main page — served with ?v=N injected (same pattern as main app) ──────
  app.get('/ai-dm', (req, res) => {
    const htmlPath = nodePath.join(publicDir, 'ai-dm.html');
    fs.readFile(htmlPath, 'utf8', (err, html) => {
      if (err) return res.status(500).send('Page load error');
      const versioned = html.replace(
        /((?:src|href)=")(\/?[^"?#]+\.(js|css))(")/gi,
        (_, attr, url, _ext, close) => {
          if (/^(https?:)?\/\//i.test(url)) return `${attr}${url}${close}`;
          return `${attr}${url}?v=${AIDM_VERSION}${close}`;
        }
      );
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(versioned);
    });
  });

  // ── Scenarios ─────────────────────────────────────────────────────────────
  app.get('/api/ai-dm/scenarios', (req, res) => {
    try {
      const scenariosPath = nodePath.join(__dirname, 'scenarios', 'index.json');
      const builtin = JSON.parse(fs.readFileSync(scenariosPath, 'utf8'));
      const custom  = aidb.listCustomScenarios().map(s => ({
        id: s.id, name: s.name, location: s.location, difficulty: s.difficulty,
        tags: JSON.parse(s.tags || '[]'), description: s.description, hook: s.hook,
        isCustom: true,
      }));
      res.json([...builtin, ...custom]);
    } catch (err) { res.status(500).json({ error: 'Could not load scenarios' }); }
  });

  // Create a custom scenario
  app.post('/api/ai-dm/scenarios', (req, res) => {
    try {
      const { name, location, difficulty, description, hook, tags } = req.body || {};
      if (!name?.trim())        return res.status(400).json({ error: 'name required' });
      if (!description?.trim()) return res.status(400).json({ error: 'description required' });
      if (!hook?.trim())        return res.status(400).json({ error: 'hook required' });
      const id = aidb.createCustomScenario({ name: name.trim(), location: location?.trim() || 'Forgotten Realms', difficulty: difficulty || 'Medium', description: description.trim(), hook: hook.trim(), tags });
      res.json({ ok: true, id });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Delete a custom scenario
  app.delete('/api/ai-dm/scenarios/:id', (req, res) => {
    try {
      if (!req.params.id.startsWith('custom_')) return res.status(400).json({ error: 'Only custom scenarios can be deleted' });
      aidb.deleteCustomScenario(req.params.id);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Generate a scenario using AI
  app.post('/api/ai-dm/scenarios/generate', async (req, res) => {
    try {
      const { keywords, provider, model, lmStudioUrl, apiKey: reqApiKey } = req.body || {};
      if (!model) return res.status(400).json({ error: 'model required' });
      const apiKey = reqApiKey || aidb.getConfig('apiKey', '');

      const prompt = [
        {
          role: 'system',
          content: `You are a creative D&D dungeon master designing adventure scenarios for the Forgotten Realms. Respond ONLY with a valid JSON object — no markdown, no explanation, just the raw JSON.`
        },
        {
          role: 'user',
          content: `Create a D&D 5e adventure scenario for the Forgotten Realms inspired by these keywords: "${keywords || 'adventure, mystery, danger'}".

Return ONLY this JSON structure (fill in all fields):
{
  "name": "A short evocative title (3-6 words)",
  "location": "Specific place in the Forgotten Realms",
  "difficulty": "Easy" or "Medium" or "Hard",
  "description": "2-3 sentences describing the adventure premise and setting",
  "hook": "1-2 sentences: how does the character get pulled into this adventure?"
}

Return ONLY the JSON object. No markdown code fences. No explanation.`
        }
      ];

      const raw = await callAINonStream(provider || 'openrouter', model, lmStudioUrl, apiKey, prompt);

      // Strip markdown fences if AI wrapped the JSON
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      let scenario;
      try { scenario = JSON.parse(cleaned); }
      catch { return res.status(422).json({ error: 'AI returned invalid JSON. Try again or fill in manually.', raw }); }

      // Validate required fields
      if (!scenario.name || !scenario.description || !scenario.hook)
        return res.status(422).json({ error: 'AI response was missing required fields. Try again.', raw });

      // Normalize difficulty
      const diff = String(scenario.difficulty || '').trim();
      scenario.difficulty = ['Easy','Medium','Hard'].includes(diff) ? diff : 'Medium';

      res.json({ ok: true, scenario });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // ── Characters (read-only, for character selection) ───────────────────────
  app.get('/api/ai-dm/characters', async (req, res) => {
    try {
      let chars;
      if (DB_PROVIDER === 'localdb') {
        chars = ldb.listCharacters();
      } else {
        const result = await ctx.idb.query({ characters: {} });
        chars = result.characters || [];
      }
      res.json(chars
        .filter(c => c.charType !== 'npc')
        .map(c => ({ id: c.id, name: c.name || 'Unnamed', has_password: !!c.passwordHash }))
        .sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Full character data (for session start + roll data) ───────────────────
  app.get('/api/ai-dm/characters/:id/data', async (req, res) => {
    try {
      const char = await getCharacter(req.params.id);
      if (!char) return res.status(404).json({ error: 'Character not found' });
      if (char.passwordHash) {
        const pw = req.headers['x-character-password'];
        if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw)))
          return res.status(401).json({ locked: true });
      }
      let data = {};
      try { data = JSON.parse(char.dataJson || '{}'); } catch {}

      // Extract portrait thumb if available
      let portrait = null;
      if (DB_PROVIDER === 'localdb') {
        try {
          const media = ldb.listMedia ? ldb.listMedia(char.id) : [];
          const p = media.find(m => m.isPortrait);
          if (p) portrait = p.thumbUrl || p.dataUrl || null;
        } catch {}
      }

      res.json({ id: char.id, name: char.name, data, portrait });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Models from AI provider ───────────────────────────────────────────────
  app.get('/api/ai-dm/models', async (req, res) => {
    try {
      const { provider, lmStudioUrl, apiKey } = req.query;
      const models = await fetchModels(provider || 'lmstudio', lmStudioUrl, apiKey);
      res.json(models);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // ── Config ────────────────────────────────────────────────────────────────
  app.get('/api/ai-dm/config', (req, res) => {
    res.json({
      provider:    aidb.getConfig('provider', 'openrouter'),
      lmStudioUrl: aidb.getConfig('lmStudioUrl', 'http://localhost:1234'),
      model:       aidb.getConfig('model', ''),
      hasApiKey:   !!aidb.getConfig('apiKey', ''),
    });
  });

  app.post('/api/ai-dm/config', (req, res) => {
    const { provider, lmStudioUrl, model, apiKey } = req.body || {};
    if (provider)    aidb.setConfig('provider',    provider);
    if (lmStudioUrl) aidb.setConfig('lmStudioUrl', lmStudioUrl);
    if (model)       aidb.setConfig('model',       model);
    if (apiKey !== undefined) aidb.setConfig('apiKey', apiKey);
    res.json({ ok: true });
  });

  // ── Sessions ──────────────────────────────────────────────────────────────

  // Create a new session
  app.post('/api/ai-dm/sessions', async (req, res) => {
    try {
      const { characterId, scenarioId, provider, model, lmStudioUrl, apiKey, language } = req.body || {};
      if (!characterId) return res.status(400).json({ error: 'characterId required' });
      if (!scenarioId)  return res.status(400).json({ error: 'scenarioId required' });
      if (!model)       return res.status(400).json({ error: 'model required' });

      // Load character
      const char = await getCharacter(characterId);
      if (!char) return res.status(404).json({ error: 'Character not found' });
      if (char.passwordHash) {
        const pw = req.headers['x-character-password'];
        if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw)))
          return res.status(401).json({ locked: true });
      }
      let charData = {};
      try { charData = JSON.parse(char.dataJson || '{}'); } catch {}

      // Load scenario — check built-in index first, then custom DB scenarios
      const scenariosPath = nodePath.join(__dirname, 'scenarios', 'index.json');
      const builtin = JSON.parse(fs.readFileSync(scenariosPath, 'utf8'));
      let scenario = builtin.find(s => s.id === scenarioId);
      if (!scenario) {
        const custom = aidb.listCustomScenarios().find(s => s.id === scenarioId);
        if (custom) {
          scenario = { ...custom, tags: JSON.parse(custom.tags || '[]'), isCustom: true };
        }
      }
      if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

      // Persist config
      if (provider)    aidb.setConfig('provider', provider);
      if (lmStudioUrl) aidb.setConfig('lmStudioUrl', lmStudioUrl);
      if (model)       aidb.setConfig('model', model);
      if (apiKey)      aidb.setConfig('apiKey', apiKey);

      // Resolve API key (from request or stored config)
      const resolvedApiKey = apiKey || aidb.getConfig('apiKey', '');

      // Validate language
      const resolvedLanguage = language === 'Turkish' ? 'Turkish' : 'English';

      // Create session
      const sessionId = crypto.randomUUID();
      aidb.createSession(sessionId, {
        characterId,
        characterName: char.name,
        characterSnapshot: charData,
        scenarioId,
        scenarioName: scenario.name,
        provider: provider || 'lmstudio',
        model,
        lmStudioUrl: lmStudioUrl || 'http://localhost:1234',
        language: resolvedLanguage,
      });

      // Build system prompt and save as first message
      const systemPrompt = buildSystemPrompt(char.name, charData, scenario, resolvedLanguage);
      aidb.addMessage(crypto.randomUUID(), sessionId, 'system', systemPrompt);

      res.json({ sessionId, scenarioName: scenario.name, characterName: char.name });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // List sessions for a character
  app.get('/api/ai-dm/sessions/list/:characterId', (req, res) => {
    try {
      const sessions = aidb.listSessionsForChar(req.params.characterId);
      res.json(sessions);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
  });

  // Get session (metadata + messages + roll data)
  app.get('/api/ai-dm/sessions/:id', async (req, res) => {
    try {
      const session = aidb.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      // Verify character password if needed
      const char = await getCharacter(session.characterId);
      if (char && char.passwordHash) {
        const pw = req.headers['x-character-password'];
        if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw)))
          return res.status(401).json({ locked: true });
      }

      const messages = aidb.getMessages(req.params.id).filter(m => m.role !== 'system');
      let snapshot = {};
      try { snapshot = JSON.parse(session.characterSnapshot || '{}'); } catch {}

      // Build compact roll data from snapshot
      const rollData = {};
      for (let i = 0; i < 18; i++) { rollData[`sk-${i}`] = snapshot[`sk-${i}`] || '0'; }
      ['str','dex','con','int','wis','cha'].forEach(a => {
        rollData[`save-${a}`] = snapshot[`save-${a}`] || abilityMod(snapshot[a]);
      });
      rollData.init = snapshot.init || abilityMod(snapshot.dex);
      rollData.hpcur = snapshot.hpcur;
      rollData.hpmax = snapshot.hpmax;

      res.json({
        session: {
          id: session.id,
          characterName: session.characterName,
          scenarioName: session.scenarioName,
          provider: session.provider,
          model: session.model,
          status: session.status,
          startedAt: session.startedAt,
          summary: session.summary || '',
          summarizedUpTo: session.summarizedUpTo || '',
          language: session.language || 'English',
        },
        messages,
        rollData,
      });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // Send a message (streaming SSE response with validation + retry)
  app.post('/api/ai-dm/sessions/:id/message', async (req, res) => {
    const { content } = req.body || {};
    if (!content?.trim()) return res.status(400).json({ error: 'content required' });

    try {
      const session = aidb.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      if (session.status === 'ended') return res.status(400).json({ error: 'Session ended' });

      const char = await getCharacter(session.characterId);
      if (char && char.passwordHash) {
        const pw = req.headers['x-character-password'];
        if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw)))
          return res.status(401).json({ locked: true });
      }

      const userMsgId = crypto.randomUUID();
      aidb.addMessage(userMsgId, session.id, 'user', content.trim());

      const allMessages = aidb.getMessages(session.id);
      const aiMessages = buildAIMessages(session, allMessages);
      const apiKey = aidb.getConfig('apiKey', '');

      // Set up SSE before any attempt
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const sendEvent = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };

      let clientClosed = false;
      req.on('close', () => { clientClosed = true; });

      const MAX_ATTEMPTS = 5;
      let savedContent = '';
      let bestContent = '';
      let bestScore = -Infinity;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (clientClosed) break;
        sendEvent({ type: 'attempt_start', attempt, max: MAX_ATTEMPTS });

        let fullContent = '';
        try {
          if (attempt === 1) {
            // First attempt: stream tokens live so user sees response typing
            fullContent = await streamAITokens(session.provider, session.model, session.lmStudioUrl, apiKey, aiMessages, res);
          } else {
            // Retries: non-streaming so we validate before showing
            fullContent = await callAINonStream(session.provider, session.model, session.lmStudioUrl, apiKey, aiMessages, { temperature: 0.9, max_tokens: 1500 });
          }
        } catch (err) {
          sendEvent({ type: 'error', error: err.message });
          break;
        }

        const score = scoreResponse(fullContent);
        if (score > bestScore) { bestScore = score; bestContent = fullContent; }

        const validation = validateDMResponse(fullContent);
        if (validation.valid) {
          if (attempt > 1) sendEvent({ type: 'response_burst', content: fullContent });
          sendEvent({ type: 'attempt_accepted', attempt });
          savedContent = fullContent;
          break;
        } else {
          sendEvent({ type: 'attempt_rejected', attempt, reason: validation.reason });
          if (attempt === MAX_ATTEMPTS) {
            // All attempts exhausted — send best response we got
            sendEvent({ type: 'response_burst', content: bestContent });
            sendEvent({ type: 'best_effort', attempt });
            savedContent = bestContent;
          }
        }
      }

      // Save to DB (even if client disconnected — user msg was already saved)
      const toSave = savedContent || bestContent;
      if (toSave) aidb.addMessage(crypto.randomUUID(), session.id, 'assistant', toSave);

      // Auto-summarize
      if (!clientClosed) {
        const freshSession = aidb.getSession(req.params.id);
        const convCount = aidb.getMessages(session.id).filter(m => m.role !== 'system').length;
        if (convCount >= AUTO_SUMMARY_THRESHOLD && !freshSession.summarizedUpTo) {
          generateSummaryForSession(freshSession, aidb.getMessages(session.id), apiKey).catch(() => {});
        }
      }

      try { res.write('data: [DONE]\n\n'); res.end(); } catch {}
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else { try { res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`); res.end(); } catch {} }
    }
  });

  // End a session
  app.post('/api/ai-dm/sessions/:id/end', (req, res) => {
    try {
      const session = aidb.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      aidb.endSession(req.params.id);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
  });

  // Short rest / Long rest — updates real character data in main DB
  app.post('/api/ai-dm/rest', async (req, res) => {
    const { characterId, restType, hpGained, hitDiceSpent, preparedIndices } = req.body || {};
    if (!characterId) return res.status(400).json({ error: 'characterId required' });
    if (restType !== 'short' && restType !== 'long') return res.status(400).json({ error: 'restType must be short or long' });
    try {
      const char = await getCharacter(characterId);
      if (!char) return res.status(404).json({ error: 'Character not found' });
      if (char.passwordHash) {
        const pw = req.headers['x-character-password'];
        if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw)))
          return res.status(401).json({ locked: true });
      }
      let data = {};
      try { data = JSON.parse(char.dataJson || '{}'); } catch {}

      if (restType === 'short') {
        const hpCur = parseInt(data.hpcur) || 0;
        const hpMax = parseInt(data.hpmax) || hpCur;
        data.hpcur   = Math.min(hpMax, hpCur + (parseInt(hpGained) || 0));
        data.hdspent = (parseInt(data.hdspent) || 0) + (parseInt(hitDiceSpent) || 0);
      } else {
        // Restore HP to max
        data.hpcur = data.hpmax || data.hpcur;
        // Restore all spell slots
        for (let lvl = 1; lvl <= 9; lvl++) data[`slot-${lvl}-used`] = 0;
        // Restore all hit dice (D&D 5.5e 2024: all restored on long rest)
        data.hdspent = 0;
        // Reset death saves
        ['ds0','ds1','ds2','df0','df1','df2'].forEach(k => { data[k] = false; });
        // Update prepared spells if provided
        if (Array.isArray(preparedIndices)) {
          let spells = [];
          try { spells = JSON.parse(data._spells || '[]'); } catch {}
          spells = spells.map((s, i) => {
            const sp = [...s];
            // Cantrips (level 0) are always prepared
            sp[7] = parseInt(s[0]) === 0 ? true : preparedIndices.includes(i);
            return sp;
          });
          data._spells = JSON.stringify(spells);
        }
      }

      const dataJson = JSON.stringify(data);
      if (DB_PROVIDER === 'localdb') {
        ldb.updateCharacter(characterId, { name: char.name, dataJson });
      } else {
        await idb.transact([idb.tx.characters[characterId].update({ dataJson })]);
      }
      res.json({ ok: true, data });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Change model for an active session
  app.patch('/api/ai-dm/sessions/:id/model', (req, res) => {
    try {
      const session = aidb.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      const { provider, model, lmStudioUrl, apiKey } = req.body || {};
      if (!model) return res.status(400).json({ error: 'model required' });
      aidb.updateSessionModel(req.params.id, {
        provider:    provider    || session.provider,
        model,
        lmStudioUrl: lmStudioUrl || session.lmStudioUrl,
      });
      // Persist config so next adventure defaults to this
      if (provider)    aidb.setConfig('provider',    provider);
      if (model)       aidb.setConfig('model',       model);
      if (lmStudioUrl) aidb.setConfig('lmStudioUrl', lmStudioUrl);
      if (apiKey)      aidb.setConfig('apiKey',      apiKey);
      res.json({ ok: true, model, provider: provider || session.provider });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // Regenerate: delete last assistant message and re-run with current history
  app.post('/api/ai-dm/sessions/:id/regenerate', async (req, res) => {
    try {
      const session = aidb.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      if (session.status === 'ended') return res.status(400).json({ error: 'Session ended' });

      // Verify character
      const char = await getCharacter(session.characterId);
      if (char && char.passwordHash) {
        const pw = req.headers['x-character-password'];
        if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw)))
          return res.status(401).json({ locked: true });
      }

      // Delete last assistant message (if any)
      aidb.deleteLastAssistantMessage(session.id);

      // Build history for AI call (uses summary compression)
      const allMessages = aidb.getMessages(session.id);
      const aiMessages = buildAIMessages(session, allMessages);

      const apiKey = aidb.getConfig('apiKey', '');

      let fullContent = '';
      try {
        fullContent = await callAIStream(
          session.provider,
          session.model,
          session.lmStudioUrl,
          apiKey,
          aiMessages,
          res
        );
      } catch (streamErr) {
        if (!res.headersSent) return res.status(502).json({ error: streamErr.message });
        res.write(`data: ${JSON.stringify({ type: 'error', error: streamErr.message })}\n\n`);
        res.end();
        return;
      }

      if (fullContent) aidb.addMessage(crypto.randomUUID(), session.id, 'assistant', fullContent);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else { res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`); res.end(); }
    }
  });

  // Delete a session and all its messages
  app.delete('/api/ai-dm/sessions/:id', async (req, res) => {
    try {
      const session = aidb.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      const char = await getCharacter(session.characterId);
      if (char && char.passwordHash) {
        const pw = req.headers['x-character-password'];
        if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw)))
          return res.status(401).json({ locked: true });
      }
      aidb.deleteSession(req.params.id);
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // Re-open an ended session
  app.patch('/api/ai-dm/sessions/:id/reopen', async (req, res) => {
    try {
      const session = aidb.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      const char = await getCharacter(session.characterId);
      if (char && char.passwordHash) {
        const pw = req.headers['x-character-password'];
        if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw)))
          return res.status(401).json({ locked: true });
      }
      aidb.reopenSession(req.params.id);
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // Generate (or regenerate) summary for a session
  app.post('/api/ai-dm/sessions/:id/summarize', async (req, res) => {
    try {
      const session = aidb.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      const char = await getCharacter(session.characterId);
      if (char && char.passwordHash) {
        const pw = req.headers['x-character-password'];
        if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw)))
          return res.status(401).json({ locked: true });
      }
      const allMessages = aidb.getMessages(session.id);
      const apiKey = aidb.getConfig('apiKey', '');
      await generateSummaryForSession(session, allMessages, apiKey);
      const updated = aidb.getSession(req.params.id);
      res.json({ ok: true, summary: updated.summary || '', summarizedUpTo: updated.summarizedUpTo || '' });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });
}
