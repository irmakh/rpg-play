/**
 * Treasury — the unified item catalogue that replaces the separate loot and
 * shop systems. One record per item; `mode` decides how players reach it:
 *
 *   'hidden' — DM only, invisible to players
 *   'loot'   — free, claimed once per character
 *   'shop'   — for sale, gated by the shop open/closed config and activeTag
 *
 * Claiming and buying both produce real inventory items through the same
 * grantItems() helper, so a claimed magic sword carries its stats exactly like
 * a bought one.
 */

const MODES      = new Set(['hidden', 'loot', 'shop']);
const ITEM_TYPES = new Set(['wondrous', 'weapon', 'armor', 'shield', 'other']);
const ARMOR_TYPES = new Set(['light', 'medium', 'heavy']);
const TAG_MAX    = 40;
const MAX_ACTIVE_TAGS = 50;

// Accepts an array, a single string, or nothing; returns a clean, deduped list.
function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : (tags ? [tags] : []);
  return [...new Set(list.map(t => String(t).trim().slice(0, TAG_MAX)).filter(Boolean))]
    .slice(0, MAX_ACTIVE_TAGS);
}

function objFromRecord(r) {
  let weaponProperties = [];
  try { weaponProperties = JSON.parse(r.weaponPropertiesJson || '[]'); } catch {}
  return {
    id: r.id,
    name: r.name || '',
    tag: r.tag || '',
    mode: MODES.has(r.mode) ? r.mode : 'hidden',
    description: r.description || '',
    descVisible: !!r.descVisible,
    itemType: r.itemType || 'other',
    armorType: r.armorType || 'light',
    acBase: r.acBase ?? 10,
    valueCp: r.valueCp ?? 0,
    quantity: r.quantity ?? 1,
    acBonus: r.acBonus ?? 0,
    initBonus: r.initBonus ?? 0,
    speedBonus: r.speedBonus ?? 0,
    spellAtkBonus: r.spellAtkBonus ?? 0,
    spellDcBonus: r.spellDcBonus ?? 0,
    requiresAttunement: !!r.requiresAttunement,
    weaponAtk: r.weaponAtk || '',
    weaponDmg: r.weaponDmg || '',
    weaponProperties,
    imageUrl: r.imageUrl || '',
    imageThumb: r.imageThumb || '',
    imageMedium: r.imageMedium || '',
    createdAt: r.createdAt || '',
  };
}

// An unidentified item keeps its own name — a placeholder name proved more
// confusing than useful — and is flagged with a suffix instead. Only the
// properties are withheld.
const UNIDENTIFIED_SUFFIX = ' - (unidentified)';
function unidentifiedItemName(name) {
  return `${name || ''}${UNIDENTIFIED_SUFFIX}`;
}

/**
 * Player-facing projection.
 *
 * Until the DM marks the description visible, the item is UNIDENTIFIED: the
 * player sees its name, what kind of thing it is and — so a shop still works —
 * what it costs and how many are left. Its properties (description, magic
 * bonus, damage dice, weapon properties, AC/init/speed/spell bonuses,
 * attunement) are stripped here on the server rather than hidden in the
 * browser, where they would still be readable in the network payload.
 */
function playerObj(r) {
  const o = objFromRecord(r);
  if (o.descVisible) return o;
  return {
    id: o.id,
    unidentified: true,
    name: o.name,
    mode: o.mode,
    descVisible: false,
    description: '',
    // Visible: name, kind of object, price, stock, and its picture.
    itemType: o.itemType,
    armorType: o.armorType,
    valueCp: o.valueCp,
    quantity: o.quantity,
    imageUrl: o.imageUrl,
    imageThumb: o.imageThumb,
    imageMedium: o.imageMedium,
    // Withheld — sent as neutral defaults so the client renders nothing.
    acBase: 10, acBonus: 0, initBonus: 0, speedBonus: 0,
    spellAtkBonus: 0, spellDcBonus: 0,
    requiresAttunement: false,
    weaponAtk: '', weaponDmg: '', weaponProperties: [],
  };
}

function sanitizeFields(body, { partial }) {
  const out = {};
  const set = (key, value) => { if (value !== undefined) out[key] = value; };
  const num = v => (v === undefined ? undefined : (Number.isFinite(+v) ? +v : 0));

  if (body.name !== undefined) out.name = String(body.name).trim();
  if (body.tag !== undefined) out.tag = String(body.tag).trim().slice(0, TAG_MAX);
  if (body.mode !== undefined) out.mode = MODES.has(body.mode) ? body.mode : 'hidden';
  if (body.description !== undefined) out.description = String(body.description);
  if (body.descVisible !== undefined) out.descVisible = !!body.descVisible;
  if (body.itemType !== undefined) out.itemType = ITEM_TYPES.has(body.itemType) ? body.itemType : 'other';
  if (body.armorType !== undefined) out.armorType = ARMOR_TYPES.has(body.armorType) ? body.armorType : 'light';
  set('acBase', num(body.acBase));
  set('valueCp', num(body.valueCp));
  set('quantity', num(body.quantity));
  set('acBonus', num(body.acBonus));
  set('initBonus', num(body.initBonus));
  set('speedBonus', num(body.speedBonus));
  set('spellAtkBonus', num(body.spellAtkBonus));
  set('spellDcBonus', num(body.spellDcBonus));
  if (body.requiresAttunement !== undefined) out.requiresAttunement = !!body.requiresAttunement;
  if (body.weaponAtk !== undefined) out.weaponAtk = String(body.weaponAtk);
  if (body.weaponDmg !== undefined) out.weaponDmg = String(body.weaponDmg);
  if (body.weaponProperties !== undefined) {
    out.weaponPropertiesJson = JSON.stringify(Array.isArray(body.weaponProperties) ? body.weaponProperties.slice(0, 3) : []);
  }
  if (body.imageUrl !== undefined) out.imageUrl = String(body.imageUrl);
  if (body.imageThumb !== undefined) out.imageThumb = String(body.imageThumb);
  if (body.imageMedium !== undefined) out.imageMedium = String(body.imageMedium);

  if (!partial) {
    // Fill the rest with defaults so a create always writes a complete row.
    const defaults = {
      name: '', tag: '', mode: 'hidden', description: '', descVisible: false,
      itemType: 'other', armorType: 'light', acBase: 10, valueCp: 0, quantity: 1,
      acBonus: 0, initBonus: 0, speedBonus: 0, spellAtkBonus: 0, spellDcBonus: 0,
      requiresAttunement: false, weaponAtk: '', weaponDmg: '', weaponPropertiesJson: '[]',
      imageUrl: '', imageThumb: '', imageMedium: '',
    };
    for (const [k, v] of Object.entries(defaults)) if (out[k] === undefined) out[k] = v;
  }
  return out;
}

function itemProps(item) {
  if (Array.isArray(item.weaponProperties)) return item.weaponProperties;
  try { return JSON.parse(item.weaponPropertiesJson || '[]'); } catch { return []; }
}

/**
 * The attack-table row for a weapon: [name, atk, damage, notes], with ATK and
 * damage resolved against this character's STR/DEX, level and the item's magic
 * bonus. Finesse takes the better of STR/DEX; Ammunition uses DEX.
 */
function weaponRowFor(charData, item, notesStr) {
  const props = itemProps(item);
  const strMod = Math.floor(((parseInt(charData.str) || 10) - 10) / 2);
  const dexMod = Math.floor(((parseInt(charData.dex) || 10) - 10) / 2);
  const level = parseInt(charData.level) || 1;
  const profBonus = Math.floor((level - 1) / 4) + 2;
  const abilityMod = props.includes('Finesse') ? Math.max(strMod, dexMod)
                   : props.includes('Ammunition') ? dexMod
                   : strMod;
  const magicBonus = parseInt(item.weaponAtk) || 0;
  const totalAtk = profBonus + abilityMod + magicBonus;
  const atkStr = (totalAtk >= 0 ? '+' : '') + totalAtk;
  const dmgRaw = (item.weaponDmg || '1d4').trim();
  const spaceIdx = dmgRaw.indexOf(' ');
  const dicePart = spaceIdx === -1 ? dmgRaw : dmgRaw.slice(0, spaceIdx);
  const typePart = spaceIdx === -1 ? '' : dmgRaw.slice(spaceIdx + 1).trim();
  const dmgBonus = abilityMod + magicBonus;
  const dmgStr = dmgBonus > 0 ? `${dicePart}+${dmgBonus}${typePart ? ' ' + typePart : ''}`
               : dmgBonus < 0 ? `${dicePart}${dmgBonus}${typePart ? ' ' + typePart : ''}`
               : dmgRaw;
  return [item.name, atkStr, dmgStr, notesStr];
}

function weaponNotes(item, desc) {
  const props = itemProps(item);
  return [desc, props.length ? props.join(', ') : ''].filter(Boolean).join(' — ');
}

/**
 * Build the character-inventory entries for `qty` copies of a treasury item.
 * Shared by claim (free) and purchase (paid) so both paths produce identical
 * items — this is the behaviour loot never had before the merge.
 *
 * An item the DM has not identified is stored redacted, exactly as it appeared
 * in the treasury: acquiring it must not reveal what browsing it would not.
 * `srcId` ties the copy back to the catalogue so identifyHeldCopies() can fill
 * in the real name and stats when the DM reveals it later.
 *
 * Mutates charData._items / _weapons / _itemIdCounter in place.
 */
function grantItems(charData, item, qty) {
  let items = [];   try { items   = JSON.parse(charData._items   || '[]'); } catch {}
  let weapons = []; try { weapons = JSON.parse(charData._weapons || '[]'); } catch {}
  let idCounter = parseInt(charData._itemIdCounter) || (items.length ? Math.max(...items.map(i => i.id)) : 0);

  const hidden = !item.descVisible;
  const desc = hidden ? '' : (item.description || '');

  for (let i = 0; i < qty; i++) {
    const base = {
      id: ++idCounter,
      srcId: item.id,
      // The suffix is baked into the stored name so the Items tab and the table
      // panel show it without either needing to know about the treasury.
      name: hidden ? unidentifiedItemName(item.name) : item.name,
      value: cpToGpStringSafe(item.valueCp ?? 0),
      equipped: false,
      attuned: false,
      requiresAttunement: hidden ? false : !!item.requiresAttunement,
      acBonus: hidden ? 0 : (item.acBonus ?? 0),
      initBonus: hidden ? 0 : (item.initBonus ?? 0),
      speedBonus: hidden ? 0 : (item.speedBonus ?? 0),
      img: item.imageUrl || '',
      imgThumb: item.imageThumb || '',
    };

    if (hidden) {
      // No attack row: the damage dice are part of what is being withheld.
      items.push({
        ...base, unidentified: true,
        itemType: item.itemType || 'other', armorType: item.armorType || 'light',
        acBase: 10, weaponAtk: '', weaponDmg: '', notes: '',
      });
    } else if (item.itemType === 'weapon') {
      const notesStr = weaponNotes(item, desc);
      weapons.push(weaponRowFor(charData, item, notesStr));
      const magicBonus = parseInt(item.weaponAtk) || 0;
      const rawAtk = magicBonus !== 0 ? (magicBonus > 0 ? '+' : '') + magicBonus : '';
      items.push({ ...base, itemType: 'weapon', weaponAtk: rawAtk, weaponDmg: item.weaponDmg || '', armorType: 'light', acBase: 10, notes: notesStr });
    } else {
      items.push({ ...base, itemType: item.itemType || 'other', armorType: item.armorType || 'light', acBase: item.acBase ?? 10, notes: desc });
    }
  }

  charData._items = JSON.stringify(items);
  charData._weapons = JSON.stringify(weapons);
  charData._itemIdCounter = idCounter;
}

/**
 * Upgrade every already-granted copy of an item in place when the DM reveals
 * its description. Without this, a player who claimed something unidentified
 * would keep holding a nameless, statless object forever.
 * Returns the ids of characters whose sheets changed.
 */
function identifyHeldCopies(characters, item) {
  const touched = [];
  for (const c of characters) {
    let data = {};
    try { data = JSON.parse(c.dataJson || '{}'); } catch { continue; }
    let its = [];
    try { its = JSON.parse(data._items || '[]'); } catch { continue; }
    const holds = its.filter(i => i && i.srcId === item.id && i.unidentified);
    if (holds.length === 0) continue;
    let weapons = [];
    try { weapons = JSON.parse(data._weapons || '[]'); } catch {}

    for (const held of holds) {
      held.name = item.name;
      held.itemType = item.itemType;
      held.armorType = item.armorType;
      held.acBase = item.acBase ?? 10;
      held.acBonus = item.acBonus ?? 0;
      held.initBonus = item.initBonus ?? 0;
      held.speedBonus = item.speedBonus ?? 0;
      held.requiresAttunement = !!item.requiresAttunement;
      if (item.itemType === 'weapon') {
        const notesStr = weaponNotes(item, item.description || '');
        held.notes = notesStr;
        const magicBonus = parseInt(item.weaponAtk) || 0;
        held.weaponAtk = magicBonus !== 0 ? (magicBonus > 0 ? '+' : '') + magicBonus : '';
        held.weaponDmg = item.weaponDmg || '';
        weapons.push(weaponRowFor(data, item, notesStr));
      } else {
        held.notes = item.description || '';
      }
      delete held.unidentified;
    }

    data._items = JSON.stringify(its);
    data._weapons = JSON.stringify(weapons);
    touched.push({ char: c, dataJson: JSON.stringify(data) });
  }
  return touched;
}

// Local copy so grantItems stays usable without threading ctx through it.
function cpToGpStringSafe(valueCp) {
  if (!valueCp) return '0 gp';
  if (valueCp % 100 === 0) return `${valueCp / 100} gp`;
  return `${(valueCp / 100).toFixed(2)} gp`;
}

export default function register(app, ctx) {
  const {
    ldb, idb, DB_PROVIDER, genId,
    masterAuth, charAuth, getCharacter,
    getShopConfig, deductCurrency, SHOP_CONFIG_ID,
    processImageSizes, deleteUploadFile,
    IMAGE_MIME, MAX_MEDIA_BYTES,
    broadcast,
  } = ctx;

  // ── Storage helpers (dual provider) ─────────────────────────────────────────
  async function listAll() {
    if (DB_PROVIDER === 'localdb') return ldb.listTreasuryItems();
    const result = await idb.query({ treasuryItems: {} });
    return (result.treasuryItems || []).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }
  async function getOne(id) {
    if (DB_PROVIDER === 'localdb') return ldb.getTreasuryItem(id);
    const result = await idb.query({ treasuryItems: { $: { where: { id } } } });
    return result.treasuryItems?.[0] || null;
  }
  async function getMany(ids) {
    if (DB_PROVIDER === 'localdb') return ldb.getTreasuryItemsByIds(ids);
    const result = await idb.query({ treasuryItems: { $: { where: { id: { in: ids } } } } });
    return result.treasuryItems || [];
  }
  async function createOne(id, fields) {
    if (DB_PROVIDER === 'localdb') return ldb.createTreasuryItem(id, fields);
    return idb.transact([idb.tx.treasuryItems[id].update(fields)]);
  }
  async function updateOne(id, fields) {
    if (DB_PROVIDER === 'localdb') return ldb.updateTreasuryItem(id, fields);
    return idb.transact([idb.tx.treasuryItems[id].update(fields)]);
  }
  async function deleteOne(id) {
    if (DB_PROVIDER === 'localdb') return ldb.deleteTreasuryItem(id);
    return idb.transact([idb.tx.treasuryItems[id].delete()]);
  }
  async function claimedIdsFor(charId) {
    if (DB_PROVIDER === 'localdb') return ldb.listClaimedItemIds(charId);
    const result = await idb.query({ lootLogs: { $: { where: { charId } } } });
    return [...new Set((result.lootLogs || []).map(r => r.itemId).filter(Boolean))];
  }

  // Push a newly-revealed item's real name and stats onto every character
  // already holding an unidentified copy, then tell their sheets to refresh.
  async function identifyForEveryone(record) {
    const item = objFromRecord(record);
    const characters = DB_PROVIDER === 'localdb'
      ? ldb.listCharacters()
      : (await idb.query({ characters: {} })).characters || [];
    const touched = identifyHeldCopies(characters, item);
    if (touched.length === 0) return;
    if (DB_PROVIDER === 'localdb') {
      for (const { char, dataJson } of touched) ldb.updateCharacter(char.id, { dataJson, name: char.name });
    } else {
      await idb.transact(touched.map(({ char, dataJson }) =>
        idb.tx.characters[char.id].update({ dataJson, name: char.name })));
    }
    for (const { char } of touched) broadcast('characters', { action: 'updated', id: char.id });
  }

  // Remove an item's image files from disk. Safe to call when there is no image.
  function dropImageFiles(record) {
    for (const url of [record?.imageUrl, record?.imageThumb, record?.imageMedium]) {
      if (url) deleteUploadFile(url);
    }
  }

  // ── Player view ─────────────────────────────────────────────────────────────
  app.get('/api/treasury', async (req, res) => {
    try {
      const cfg = await getShopConfig();
      const all = await listAll();

      // quantity 0 means the pool is exhausted, same rule as the shop.
      const loot = all.filter(r => r.mode === 'loot' && r.quantity !== 0).map(playerObj);

      let shop = [];
      if (cfg.isOpen) {
        shop = all.filter(r => r.mode === 'shop' && r.quantity !== 0);
        // An empty tag list means the whole shop is open; otherwise only the
        // selected tags are on sale.
        const openTags = cfg.activeTags || [];
        if (openTags.length) shop = shop.filter(r => openTags.includes(r.tag || ''));
        shop = shop
          .sort((a, b) => (a.itemType || '').localeCompare(b.itemType || '') || (a.name || '').localeCompare(b.name || ''))
          .map(playerObj);
      }

      // Claim history is only disclosed to a caller who proves they are that
      // character; anonymous callers just get an empty list.
      let claimedIds = [];
      const charId = req.headers['x-character-id'];
      if (charId && (await charAuth(charId, req)) === 200) claimedIds = await claimedIdsFor(charId);

      res.json({
        shopOpen: !!cfg.isOpen,
        activeTag: cfg.activeTag || '',            // legacy single value
        activeTags: cfg.activeTags || [],
        loot, shop, claimedIds,
      });
    } catch (err) { console.error('GET /api/treasury:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // Description-reveal sync: lets an already-held item pick up a description the
  // DM revealed after the fact.
  app.get('/api/treasury/visibility', async (req, res) => {
    try {
      const all = await listAll();
      const map = {};
      // The description of an unrevealed item is withheld here too — this route
      // is public, so returning it would hand out exactly what the unidentified
      // treatment is meant to keep back.
      for (const r of all) {
        const visible = !!r.descVisible;
        map[r.id] = { descVisible: visible, description: visible ? (r.description || '') : '' };
      }
      res.json(map);
    } catch (err) { console.error('GET /api/treasury/visibility:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── DM catalogue ────────────────────────────────────────────────────────────
  app.get('/api/treasury/all', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const all = await listAll();
      res.json(all.map(objFromRecord));
    } catch (err) { console.error('GET /api/treasury/all:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/treasury/status', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const cfg = await getShopConfig();
      res.json({ isOpen: cfg.isOpen, activeTag: cfg.activeTag, activeTags: cfg.activeTags || [] });
    } catch (err) { console.error('GET /api/treasury/status:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/treasury/status', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const isOpen = !!(req.body?.isOpen);
      // The shop can be open for several tags at once. `activeTags` is the
      // current field; a lone `activeTag` is still accepted. Closing clears both.
      const raw = req.body?.activeTags !== undefined ? req.body.activeTags : req.body?.activeTag;
      const activeTags = isOpen ? normalizeTags(raw) : [];
      const activeTag = activeTags[0] || '';
      if (DB_PROVIDER === 'localdb') ldb.setShopConfig(isOpen, activeTags);
      else await idb.transact([idb.tx.shopConfig[SHOP_CONFIG_ID].update({ isOpen, activeTag, activeTags })]);
      broadcast('treasury', { action: 'statusChanged', isOpen, activeTag, activeTags });
      res.json({ ok: true, isOpen, activeTag, activeTags });
    } catch (err) { console.error('PUT /api/treasury/status:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/treasury', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const fields = sanitizeFields(req.body || {}, { partial: false });
      if (!fields.name) return res.status(400).json({ error: 'Name required' });
      fields.createdAt = new Date().toISOString();
      const newId = genId();
      await createOne(newId, fields);
      broadcast('treasury', { action: 'created', id: newId });
      res.json({ id: newId, ok: true });
    } catch (err) { console.error('POST /api/treasury:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/treasury/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const existing = await getOne(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const update = sanitizeFields(req.body || {}, { partial: true });
      if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nothing to update' });
      // Replacing or clearing the image leaves the old files orphaned otherwise.
      if (update.imageUrl !== undefined && update.imageUrl !== existing.imageUrl) dropImageFiles(existing);
      await updateOne(req.params.id, update);

      // Revealing the description identifies every copy players already hold.
      const revealed = update.descVisible === true && !existing.descVisible;
      if (revealed) await identifyForEveryone({ ...existing, ...update, id: req.params.id });

      broadcast('treasury', { action: 'updated', id: req.params.id });
      res.json({ ok: true });
    } catch (err) { console.error('PUT /api/treasury/:id:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/treasury/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const existing = await getOne(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      dropImageFiles(existing);
      await deleteOne(req.params.id);
      broadcast('treasury', { action: 'deleted', id: req.params.id });
      res.json({ ok: true });
    } catch (err) { console.error('DELETE /api/treasury/:id:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Bulk operations ─────────────────────────────────────────────────────────
  app.post('/api/treasury/bulk-update-tag', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { ids, tag } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
      const tagStr = tag !== undefined ? String(tag).trim().slice(0, TAG_MAX) : '';
      if (DB_PROVIDER === 'localdb') ldb.bulkUpdateTreasuryTag(ids, tagStr);
      else await idb.transact(ids.map(id => idb.tx.treasuryItems[id].update({ tag: tagStr })));
      broadcast('treasury', { action: 'bulk-updated' });
      res.json({ ok: true, count: ids.length });
    } catch (err) { console.error('POST /api/treasury/bulk-update-tag:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/treasury/bulk-mode', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { ids, mode } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
      if (!MODES.has(mode)) return res.status(400).json({ error: 'Invalid mode' });
      if (DB_PROVIDER === 'localdb') ldb.bulkUpdateTreasuryMode(ids, mode);
      else await idb.transact(ids.map(id => idb.tx.treasuryItems[id].update({ mode })));
      broadcast('treasury', { action: 'bulk-updated' });
      res.json({ ok: true, count: ids.length });
    } catch (err) { console.error('POST /api/treasury/bulk-mode:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/treasury/bulk-delete', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { ids } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
      const rows = await getMany(ids);
      for (const r of rows) dropImageFiles(r);
      if (DB_PROVIDER === 'localdb') ldb.bulkDeleteTreasuryItems(ids);
      else await idb.transact(ids.map(id => idb.tx.treasuryItems[id].delete()));
      broadcast('treasury', { action: 'bulk-updated' });
      res.json({ ok: true, count: ids.length });
    } catch (err) { console.error('POST /api/treasury/bulk-delete:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // Bulk text import — one item per blank-line-separated block, first line is
  // the name and the rest is the description. Imports stay hidden until the DM
  // decides how to distribute them.
  app.post('/api/treasury/import', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { text, tag = '', mode = 'hidden' } = req.body || {};
      if (!text) return res.status(400).json({ error: 'Text required' });
      const tagStr = String(tag).trim().slice(0, TAG_MAX);
      const modeStr = MODES.has(mode) ? mode : 'hidden';
      const blocks = String(text).split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
      const rows = [];
      for (const block of blocks) {
        const lines = block.split('\n');
        const name = lines[0].trim();
        if (!name) continue;
        rows.push({
          id: genId(),
          fields: sanitizeFields({
            name,
            description: lines.slice(1).join('\n').trim(),
            tag: tagStr,
            mode: modeStr,
          }, { partial: false }),
        });
      }
      if (rows.length === 0) return res.status(400).json({ error: 'No valid items found' });
      // Stagger createdAt so the imported batch keeps its pasted order.
      const t0 = Date.now();
      rows.forEach((r, i) => { r.fields.createdAt = new Date(t0 + i).toISOString(); });
      if (DB_PROVIDER === 'localdb') ldb.bulkCreateTreasuryItems(rows);
      else await idb.transact(rows.map(({ id, fields }) => idb.tx.treasuryItems[id].update(fields)));
      broadcast('treasury', { action: 'imported' });
      res.json({ ok: true, count: rows.length });
    } catch (err) { console.error('POST /api/treasury/import:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Item image upload ───────────────────────────────────────────────────────
  // Mirrors POST /api/calendar/media, but images only. Returns the three sizes;
  // the client saves them onto the item with a follow-up PUT.
  app.post('/api/treasury/media', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { dataUrl } = req.body || {};
      const m = typeof dataUrl === 'string' && dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
      if (!m) return res.status(400).json({ error: 'Invalid data URL' });
      const mime = m[1];
      if (!IMAGE_MIME.has(mime)) return res.status(400).json({ error: 'Images only (jpeg, png, gif, webp)' });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > MAX_MEDIA_BYTES) return res.status(413).json({ error: 'Image too large' });
      const urls = await processImageSizes(mime, buf, 'treasury', genId());
      res.json({ url: urls.original, thumb: urls.thumb, medium: urls.medium });
    } catch (err) { console.error('POST /api/treasury/media:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Claim (free loot) ───────────────────────────────────────────────────────
  app.post('/api/treasury/claim', async (req, res) => {
    try {
      const { charId, items: wanted } = req.body || {};
      if (!charId || !Array.isArray(wanted) || wanted.length === 0)
        return res.status(400).json({ error: 'charId and items required' });

      const status = await charAuth(charId, req);
      if (status !== 200) return res.status(status).json({ error: status === 404 ? 'Not found' : 'Unauthorized' });

      const charRecord = await getCharacter(charId);
      if (!charRecord) return res.status(404).json({ error: 'Character not found' });
      let charData = {};
      try { charData = JSON.parse(charRecord.dataJson || '{}'); } catch {}

      const ids = wanted.map(i => i.id).filter(Boolean);
      const rows = await getMany(ids);
      const byId = {};
      for (const r of rows) byId[r.id] = r;

      // Claim-once is enforced from the claim log, not from the character sheet,
      // so it survives the player editing their own inventory.
      const already = new Set(await claimedIdsFor(charId));

      const granted = [];
      for (const id of ids) {
        const item = byId[id];
        if (!item || item.mode !== 'loot' || already.has(id)) continue;
        already.add(id);
        grantItems(charData, objFromRecord(item), 1);
        granted.push(item);
      }
      if (granted.length === 0) return res.status(400).json({ error: 'Nothing available to claim' });

      const charName = charData.name || charRecord.name || 'Unknown';
      const now = new Date().toISOString();

      // Stock governs how many characters can claim: -1 is an open offer, a
      // finite count decrements and the item leaves the pool at zero (so the
      // default quantity of 1 behaves like the old claim-and-hide loot).
      const claimStock = (item) => {
        if (item.quantity === -1) return null;
        const left = item.quantity - 1;
        return left <= 0 ? { quantity: 0, mode: 'hidden' } : { quantity: left };
      };

      if (DB_PROVIDER === 'localdb') {
        ldb.updateCharacter(charId, { dataJson: JSON.stringify(charData), name: charRecord.name });
        for (const item of granted) {
          const upd = claimStock(item);
          if (upd) ldb.updateTreasuryItem(item.id, upd);
          ldb.createLootLog(genId(), { charId, charName, itemName: item.name, itemId: item.id, claimedAt: now });
        }
      } else {
        const txns = [idb.tx.characters[charId].update({ dataJson: JSON.stringify(charData), name: charRecord.name })];
        for (const item of granted) {
          const upd = claimStock(item);
          if (upd) txns.push(idb.tx.treasuryItems[item.id].update(upd));
          txns.push(idb.tx.lootLogs[genId()].update({ charId, charName, itemName: item.name, itemId: item.id, claimedAt: now }));
        }
        await idb.transact(txns);
      }

      broadcast('characters', { action: 'updated', id: charId });
      broadcast('treasury', { action: 'claimed' });
      res.json({ ok: true, count: granted.length });
    } catch (err) { console.error('POST /api/treasury/claim:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Purchase (paid) ─────────────────────────────────────────────────────────
  app.post('/api/treasury/purchase', async (req, res) => {
    try {
      const { charId, items: cart } = req.body || {};
      if (!charId || !Array.isArray(cart) || cart.length === 0)
        return res.status(400).json({ error: 'charId and items[] required' });

      const authStatus = await charAuth(charId, req);
      if (authStatus !== 200) return res.status(authStatus).json({ error: authStatus === 404 ? 'Character not found' : 'Unauthorized' });

      const cfg = await getShopConfig();
      if (!cfg.isOpen) return res.status(400).json({ error: 'The shop is closed' });

      const charRecord = await getCharacter(charId);
      if (!charRecord) return res.status(404).json({ error: 'Character not found' });
      let charData = {};
      try { charData = JSON.parse(charRecord.dataJson || '{}'); } catch {}

      let totalCp = 0;
      const resolved = [];
      for (const { itemId, qty = 1 } of cart) {
        const item = await getOne(itemId);
        if (!item) return res.status(400).json({ error: `Item ${itemId} not found` });
        if (item.mode !== 'shop') return res.status(400).json({ error: `"${item.name}" is not for sale` });
        if (item.quantity !== -1 && item.quantity < qty) return res.status(400).json({ error: `Not enough stock for "${item.name}"` });
        totalCp += (item.valueCp ?? 0) * qty;
        resolved.push({ item, qty });
      }

      const cp = parseInt(charData.cp)  || 0;
      const sp = parseInt(charData.sp)  || 0;
      const ep = parseInt(charData.ep)  || 0;
      const gp = parseInt(charData.gp)  || 0;
      const pp = parseInt(charData.pp2) || 0;
      if (cp + sp * 10 + ep * 50 + gp * 100 + pp * 1000 < totalCp)
        return res.status(400).json({ error: 'Insufficient funds' });

      const newCurrency = deductCurrency({ cp, sp, ep, gp, pp }, totalCp);
      for (const { item, qty } of resolved) grantItems(charData, objFromRecord(item), qty);

      charData.cp  = String(newCurrency.cp);
      charData.sp  = String(newCurrency.sp);
      charData.ep  = String(newCurrency.ep);
      charData.gp  = String(newCurrency.gp);
      charData.pp2 = String(newCurrency.pp);

      const charName = charData.name || 'Unknown';
      const now = new Date().toISOString();

      if (DB_PROVIDER === 'localdb') {
        for (const { item, qty } of resolved) {
          if (item.quantity !== -1) ldb.updateTreasuryItem(item.id, { quantity: item.quantity - qty });
          ldb.createPurchaseLog(genId(), { charId, charName, itemName: item.name, itemId: item.id, qty, totalCp: (item.valueCp ?? 0) * qty, purchasedAt: now });
        }
        ldb.updateCharacter(charId, { dataJson: JSON.stringify(charData), name: charRecord.name });
      } else {
        const txns = [];
        for (const { item, qty } of resolved) {
          if (item.quantity !== -1) txns.push(idb.tx.treasuryItems[item.id].update({ quantity: item.quantity - qty }));
          txns.push(idb.tx.purchaseLogs[genId()].update({ charId, charName, itemName: item.name, itemId: item.id, qty, totalCp: (item.valueCp ?? 0) * qty, purchasedAt: now }));
        }
        txns.push(idb.tx.characters[charId].update({ dataJson: JSON.stringify(charData), name: charRecord.name }));
        await idb.transact(txns);
      }

      broadcast('treasury', { action: 'purchase' });
      broadcast('characters', { action: 'updated', id: charId });
      res.json({ ok: true, newCurrency });
    } catch (err) { console.error('POST /api/treasury/purchase:', err); res.status(500).json({ error: 'Transaction failed' }); }
  });

  // ── Merged ledger ───────────────────────────────────────────────────────────
  app.get('/api/treasury/logs', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      let claims, purchases;
      if (DB_PROVIDER === 'localdb') {
        claims = ldb.listLootLogs();
        purchases = ldb.listPurchaseLogs();
      } else {
        const [cr, pr] = await Promise.all([idb.query({ lootLogs: {} }), idb.query({ purchaseLogs: {} })]);
        claims = cr.lootLogs || [];
        purchases = pr.purchaseLogs || [];
      }
      const rows = [
        ...claims.map(r => ({ id: r.id, type: 'claim', charName: r.charName, itemName: r.itemName, itemId: r.itemId || '', qty: 1, totalCp: 0, at: r.claimedAt })),
        ...purchases.map(r => ({ id: r.id, type: 'purchase', charName: r.charName, itemName: r.itemName, itemId: r.itemId || '', qty: r.qty, totalCp: r.totalCp, at: r.purchasedAt })),
      ].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 500);
      res.json(rows);
    } catch (err) { console.error('GET /api/treasury/logs:', err); res.status(500).json({ error: 'Server error' }); }
  });
}

export { objFromRecord, playerObj, sanitizeFields, grantItems };
