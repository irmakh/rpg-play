export default function register(app, ctx) {
  const { sdb, ldb, path, fs, __dirname, crypto } = ctx;

  function storyImgDir(storyId) {
    return path.join(__dirname, 'public', 'story-images', storyId);
  }

  function parseCharIds(raw) {
    try { return JSON.parse(raw || '[]'); } catch { return []; }
  }

  function enrichStory(story) {
    return { ...story, character_ids: parseCharIds(story.character_ids) };
  }

  // ── Character portraits for multiselect ─────────────────────────────────────
  app.get('/api/stories/character-portraits', (req, res) => {
    const chars = ldb.listCharacters();
    const result = chars.map(c => {
      const media  = ldb.listMedia(c.id);
      const port   = media.find(m => m.isPortrait);
      const thumb  = port ? (port.thumbUrl || port.dataUrl || '') : '';
      let dataJson = {};
      try { dataJson = JSON.parse(c.dataJson || '{}'); } catch {}
      return {
        id:       c.id,
        name:     c.name,
        charType: c.charType,
        thumb,
        species:  dataJson.species || dataJson.race || '',
        cls:      dataJson.class   || '',
        subclass: dataJson.subclass || '',
      };
    });
    res.json(result);
  });

  // ── Stories ─────────────────────────────────────────────────────────────────
  app.get('/api/stories', (req, res) => res.json(sdb.listStories().map(enrichStory)));

  app.post('/api/stories', (req, res) => {
    const { title, character, description, characterIds } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'title required' });
    const story = sdb.createStory(
      crypto.randomUUID(),
      (character || '').trim(),
      title.trim(),
      (description || '').trim(),
      Array.isArray(characterIds) ? characterIds : []
    );
    res.json(enrichStory(story));
  });

  app.get('/api/stories/:id', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Not found' });
    const seqs = sdb.listSequences(story.id).map(s => ({ ...s, caption: s.prompt }));
    res.json({ ...enrichStory(story), sequences: seqs });
  });

  app.put('/api/stories/:id', (req, res) => {
    if (!sdb.getStory(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const { title, character, description, characterIds } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'title required' });
    const updated = sdb.updateStory(
      req.params.id,
      (character || '').trim(),
      title.trim(),
      (description || '').trim(),
      Array.isArray(characterIds) ? characterIds : []
    );
    res.json(enrichStory(updated));
  });

  app.delete('/api/stories/:id', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Not found' });
    try { fs.rmSync(storyImgDir(story.id), { recursive: true, force: true }); } catch {}
    sdb.deleteStory(story.id);
    res.json({ ok: true });
  });

  // ── Sequences ────────────────────────────────────────────────────────────────
  app.post('/api/stories/:id/sequences', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    const seqs = sdb.listSequences(story.id);
    const seqNumber = req.body?.seqNumber || (seqs.length ? Math.max(...seqs.map(s => s.seq_number)) + 1 : 1);
    const seq = sdb.addSequence(crypto.randomUUID(), story.id, seqNumber, req.body?.caption || '');
    res.json({ ...seq, caption: seq.prompt });
  });

  // Register /reorder before /:seqId to prevent route conflict
  app.post('/api/stories/:id/sequences/reorder', (req, res) => {
    if (!sdb.getStory(req.params.id)) return res.status(404).json({ error: 'Story not found' });
    const { order } = req.body || {};
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
    sdb.reorderSequences(order);
    res.json({ ok: true });
  });

  app.put('/api/stories/:id/sequences/:seqId', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    const seq = sdb.getSequence(req.params.seqId);
    if (!seq || seq.story_id !== story.id) return res.status(404).json({ error: 'Sequence not found' });
    if (typeof req.body?.caption === 'string') sdb.updateSequenceCaption(seq.id, req.body.caption);
    const updated = sdb.getSequence(seq.id);
    res.json({ ...updated, caption: updated.prompt });
  });

  app.delete('/api/stories/:id/sequences/:seqId', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    const seq = sdb.getSequence(req.params.seqId);
    if (!seq || seq.story_id !== story.id) return res.status(404).json({ error: 'Sequence not found' });
    if (seq.image_path) {
      try { fs.unlinkSync(path.join(__dirname, 'public', seq.image_path)); } catch {}
    }
    sdb.deleteSequence(seq.id);
    res.json({ ok: true });
  });

  // ── Image upload ─────────────────────────────────────────────────────────────
  app.post('/api/stories/:id/sequences/:seqId/image', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    const seq = sdb.getSequence(req.params.seqId);
    if (!seq || seq.story_id !== story.id) return res.status(404).json({ error: 'Sequence not found' });

    const { dataUrl } = req.body || {};
    if (!dataUrl) return res.status(400).json({ error: 'dataUrl required' });
    const m = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/s);
    if (!m) return res.status(400).json({ error: 'Invalid data URL' });

    const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' })[m[1]] || 'png';
    const dir  = storyImgDir(story.id);
    fs.mkdirSync(dir, { recursive: true });

    if (seq.image_path) {
      try { fs.unlinkSync(path.join(__dirname, 'public', seq.image_path)); } catch {}
    }

    // Use seq ID as filename so reordering never conflicts
    const filename = `${seq.id}.${ext}`;
    fs.writeFileSync(path.join(dir, filename), Buffer.from(m[2], 'base64'));
    const webPath = `/story-images/${story.id}/${filename}`;
    sdb.updateSequenceImage(seq.id, webPath);
    res.json({ ok: true, imagePath: webPath });
  });

  app.delete('/api/stories/:id/sequences/:seqId/image', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    const seq = sdb.getSequence(req.params.seqId);
    if (!seq || seq.story_id !== story.id) return res.status(404).json({ error: 'Sequence not found' });
    if (seq.image_path) {
      try { fs.unlinkSync(path.join(__dirname, 'public', seq.image_path)); } catch {}
    }
    sdb.updateSequenceImage(seq.id, '');
    res.json({ ok: true });
  });
}
