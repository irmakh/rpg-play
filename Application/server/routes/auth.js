export default function register(app, ctx) {
  const { getCharacter, isMasterPassword, verifyPassword } = ctx;

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
        if (!char.passwordHash) return res.json({ needsSetup: true, characterId: char.id, characterName: char.name });
        if (!password || !verifyPassword(password, char.passwordHash))
          return res.status(401).json({ error: 'Wrong password' });
        return res.json({ ok: true, role: 'character', characterId: char.id, characterName: char.name });
      }
      return res.status(400).json({ error: 'Invalid login type' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });
}
