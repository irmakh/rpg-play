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
function buildSystemPrompt(charName, charData, scenario) {
  const charContext = buildCharacterContext(charName, charData);

  return `You are an experienced Dungeon Master running a D&D 5.5e (2024 Player's Handbook) text-based adventure set in the Forgotten Realms. You are creative, descriptive, and fair. You follow the rules and create an immersive experience.

${charContext}

---

## Your Role as DM

- You narrate the world, NPCs, and outcomes. The player controls only their character.
- Descriptions should be vivid but concise (2–4 sentences for scene-setting).
- Follow D&D 5.5e rules: proficiency bonus, ability modifiers, advantage/disadvantage.
- **SPELLS: The character may ONLY cast spells listed in the "✅ PREPARED SPELLS" section of their character sheet above. Never reference, suggest, or allow any spell not on that list — even if it would fit narratively. Cantrips in the prepared list are always available. Leveled spells consume spell slots. If no spells are prepared, the character cannot cast anything.**
- Track narrative state across the conversation (who was met, what happened, what was agreed).
- In combat: track initiative order, enemy HP (hidden from player), and announce when enemies fall.
- When the character takes damage, state their new HP total clearly (e.g., "You take 8 piercing damage — 27 HP remaining").
- If HP reaches 0, trigger death saves. If the character dies, narrate it with gravity.
- Offer 2–4 meaningful choices when appropriate, but also accept freeform player input.
- Never break character. Never acknowledge you are an AI. You are the DM.
- Keep a sense of wonder. The Forgotten Realms is rich, dangerous, and full of secrets.

---

## Dice Roll Protocol

When the player's action requires a dice roll, embed a roll request at the end of your message using this EXACT syntax (on its own line):

**Skill checks:**
[[ROLL:sk-N:Skill Name:DC:NUMBER]]
(N is 0–17, matching the skill index below)
0=Acrobatics, 1=Animal Handling, 2=Arcana, 3=Athletics, 4=Deception, 5=History,
6=Insight, 7=Intimidation, 8=Investigation, 9=Medicine, 10=Nature, 11=Perception,
12=Performance, 13=Persuasion, 14=Religion, 15=Sleight of Hand, 16=Stealth, 17=Survival

**Saving throws:**
[[ROLL:save-str:Strength Save:DC:NUMBER]]
[[ROLL:save-dex:Dexterity Save:DC:NUMBER]]
[[ROLL:save-con:Constitution Save:DC:NUMBER]]
[[ROLL:save-int:Intelligence Save:DC:NUMBER]]
[[ROLL:save-wis:Wisdom Save:DC:NUMBER]]
[[ROLL:save-cha:Charisma Save:DC:NUMBER]]

**Initiative (start of combat):**
[[ROLL:init:Initiative]]

**Attack rolls (use the character's weapon attack bonus):**
[[ROLL:atk:Weapon Name:MODIFIER]]
e.g. [[ROLL:atk:Longsword:+5]]

**Raw dice (damage, healing, etc. — no character modifier):**
[[ROLL:raw:NdN:Description]]
e.g. [[ROLL:raw:2d6:fire damage]]

**With advantage/disadvantage, append :advantage or :disadvantage:**
[[ROLL:sk-11:Perception:DC:15:advantage]]
[[ROLL:save-dex:Dexterity Save:DC:13:disadvantage]]

Rules:
- Only embed ONE roll request per DM message (multiple rolls may confuse the player).
- After embedding a roll request, STOP and wait for the player's roll result.
- When the player sends a roll result, continue the narrative based on success/failure.
- DC guidance: Easy=10, Medium=15, Hard=20, Very Hard=25, Nearly Impossible=30.

---

## The Adventure

${scenario.name} — ${scenario.location}

${scenario.description}

**Opening Hook:** ${scenario.hook}

---

Begin the adventure now. Set the opening scene in 3–5 vivid sentences, then give the player their first meaningful choice or action opportunity. Do NOT ask for a roll yet — let the player establish themselves first.`;
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
async function callAIStream(provider, model, lmStudioUrl, apiKey, messages, res) {
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

  const body = JSON.stringify({ model, messages, stream: true, temperature: 0.85, max_tokens: 1024 });
  const aiRes = await fetch(endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(60000) });
  if (!aiRes.ok) {
    const errText = await aiRes.text();
    throw new Error(`AI provider error ${aiRes.status}: ${errText.slice(0, 200)}`);
  }

  // Stream SSE back to the client
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const reader = aiRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const obj = JSON.parse(data);
        const content = obj.choices?.[0]?.delta?.content || '';
        if (content) {
          fullContent += content;
          res.write(`data: ${JSON.stringify({ type: 'token', content })}\n\n`);
        }
      } catch {}
    }
  }

  // Flush remaining buffer
  if (buffer.startsWith('data: ')) {
    const data = buffer.slice(6).trim();
    if (data && data !== '[DONE]') {
      try {
        const obj = JSON.parse(data);
        const content = obj.choices?.[0]?.delta?.content || '';
        if (content) { fullContent += content; res.write(`data: ${JSON.stringify({ type: 'token', content })}\n\n`); }
      } catch {}
    }
  }

  return fullContent;
}

// ── Non-streaming AI call (for summaries) ─────────────────────────────────────
async function callAINonStream(provider, model, lmStudioUrl, apiKey, messages) {
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
  const body = JSON.stringify({ model, messages, stream: false, temperature: 0.4, max_tokens: 1024 });
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
      content: `You are a scribe summarizing a D&D adventure session for the Dungeon Master's records. Write a concise but complete summary (3–5 paragraphs) covering: key events that occurred, important NPCs encountered, locations visited, decisions made by the player, any combat outcomes, and the current state of the adventure (where the character is, what they know, any active quests or threats). Be factual and narrative. Do not include dice roll details. This summary will be used to restore context in future AI calls.`
    },
    {
      role: 'user',
      content: `Here is the adventure log so far:\n\n${toSummarize.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n\n')}\n\nPlease write the summary now.`
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
const AIDM_VERSION = 4;

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
      const { characterId, scenarioId, provider, model, lmStudioUrl, apiKey } = req.body || {};
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
      });

      // Build system prompt and save as first message
      const systemPrompt = buildSystemPrompt(char.name, charData, scenario);
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
        },
        messages,
        rollData,
      });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // Send a message (streaming SSE response)
  app.post('/api/ai-dm/sessions/:id/message', async (req, res) => {
    const { content } = req.body || {};
    if (!content?.trim()) return res.status(400).json({ error: 'content required' });

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

      // Save user message
      const userMsgId = crypto.randomUUID();
      aidb.addMessage(userMsgId, session.id, 'user', content.trim());

      // Build message history for AI (uses summary to compress old context)
      const allMessages = aidb.getMessages(session.id);
      const aiMessages = buildAIMessages(session, allMessages);

      // Get API key
      const apiKey = aidb.getConfig('apiKey', '');

      // Stream AI response
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
        if (!res.headersSent) {
          return res.status(502).json({ error: streamErr.message });
        }
        res.write(`data: ${JSON.stringify({ type: 'error', error: streamErr.message })}\n\n`);
        res.end();
        return;
      }

      // Save assistant response
      if (fullContent) {
        aidb.addMessage(crypto.randomUUID(), session.id, 'assistant', fullContent);
      }

      // Auto-summarize: fire-and-forget after threshold is reached
      const freshSession = aidb.getSession(req.params.id);
      const convCount = aidb.getMessages(session.id).filter(m => m.role !== 'system').length;
      if (convCount >= AUTO_SUMMARY_THRESHOLD && !freshSession.summarizedUpTo) {
        generateSummaryForSession(freshSession, aidb.getMessages(session.id), apiKey).catch(() => {});
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else { res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`); res.end(); }
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
