export default function register(app, ctx) {
  const { getCharacter, isMasterPassword, verifyPassword, ldb, DB_PROVIDER } = ctx;

  // Accepts any valid password (DM or any character) — used by stories gate
  app.post('/api/auth/verify-any', async (req, res) => {
    try {
      const { password } = req.body || {};
      if (!password) return res.status(400).json({ error: 'password required' });
      if (isMasterPassword(password)) return res.json({ ok: true });
      if (DB_PROVIDER === 'localdb') {
        const chars = ldb.listCharacters();
        for (const c of chars) {
          if (c.passwordHash && verifyPassword(password, c.passwordHash))
            return res.json({ ok: true });
        }
      }
      return res.status(401).json({ error: 'Wrong password' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { type, characterId, password } = req.body || {};
      if (type === 'dm') {
        if (!password || !isMasterPassword(password)) return res.status(401).json({ error: 'Wrong password' });
        return res.json({ ok: true, role: 'dm' });
      }
      if (type === 'character') {
        if (!characterId) return res.status(400).json({ error: 'characterId required' });
        const char = await getCharacter(characterId);
        if (!char) return res.status(404).json({ error: 'Character not found' });
        // The DM master password unlocks any character (even one with no password
        // set yet). charAuth already accepts the master password on later requests,
        // and the client stores whatever password was typed, so this works end-to-end.
        if (password && isMasterPassword(password))
          return res.json({ ok: true, role: 'character', characterId: char.id, characterName: char.name });
        if (!char.passwordHash) return res.json({ needsSetup: true, characterId: char.id, characterName: char.name });
        if (!password || !verifyPassword(password, char.passwordHash))
          return res.status(401).json({ error: 'Wrong password' });
        return res.json({ ok: true, role: 'character', characterId: char.id, characterName: char.name });
      }
      return res.status(400).json({ error: 'Invalid login type' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });
}
