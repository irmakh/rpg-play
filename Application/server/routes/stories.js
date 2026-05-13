export default function register(app, ctx) {
  const { sdb, STORIES_DIR, STORY_IMAGES_DIR, path, fs, __dirname, crypto } = ctx;

  function safeStoryPath(rel) {
    if (!rel) return null;
    const full = path.resolve(STORIES_DIR, rel);
    if (full !== STORIES_DIR && !full.startsWith(STORIES_DIR + path.sep)) return null;
    return full;
  }

  function slugify(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'story';
  }

  function parsePromptFile(content) {
    const seqs = [];
    for (const line of content.split('\n')) {
      const m = line.trim().match(/^(\d+)\s*[:.]\s*(.+)$/);
      if (m) seqs.push({ seqNumber: parseInt(m[1], 10), prompt: m[2].trim() });
    }
    return seqs;
  }

  function buildComfyWorkflow(prompt, cfg) {
    return {
      "4": { "inputs": { "ckpt_name": cfg.checkpoint }, "class_type": "CheckpointLoaderSimple" },
      "5": { "inputs": { "width": cfg.width||512, "height": cfg.height||512, "batch_size": 1 }, "class_type": "EmptyLatentImage" },
      "6": { "inputs": { "text": prompt, "clip": ["4", 1] }, "class_type": "CLIPTextEncode" },
      "7": { "inputs": { "text": cfg.negativePrompt || "ugly, blurry, low quality, deformed", "clip": ["4", 1] }, "class_type": "CLIPTextEncode" },
      "3": {
        "inputs": {
          "seed": Math.floor(Math.random() * 9999999999),
          "steps": cfg.steps || 20, "cfg": cfg.cfg || 7.0,
          "sampler_name": cfg.sampler || "euler", "scheduler": "normal", "denoise": 1.0,
          "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]
        },
        "class_type": "KSampler"
      },
      "8": { "inputs": { "samples": ["3", 0], "vae": ["4", 2] }, "class_type": "VAEDecode" },
      "9": { "inputs": { "filename_prefix": "story", "images": ["8", 0] }, "class_type": "SaveImage" }
    };
  }

  async function generateWithComfyUI(endpoint, comfyCfg, prompt) {
    let workflow;
    if (comfyCfg.customWorkflow && comfyCfg.customWorkflow.trim()) {
      const workflowJson = comfyCfg.customWorkflow.replace(/\{\{PROMPT\}\}/g, prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
      try { workflow = JSON.parse(workflowJson); }
      catch (e) { throw new Error('Invalid custom workflow JSON: ' + e.message); }
    } else {
      if (!comfyCfg.checkpoint) throw new Error('No checkpoint selected');
      workflow = buildComfyWorkflow(prompt, comfyCfg);
    }

    const promptResp = await fetch(`${endpoint}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: `story-${crypto.randomUUID()}` }),
      signal: AbortSignal.timeout(30000)
    });
    if (!promptResp.ok) throw new Error(`ComfyUI /prompt returned ${promptResp.status}`);
    const { prompt_id } = await promptResp.json();

    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 2500));
      const histResp = await fetch(`${endpoint}/history/${prompt_id}`, { signal: AbortSignal.timeout(10000) });
      if (!histResp.ok) continue;
      const hist = await histResp.json();
      const entry = hist[prompt_id];
      if (!entry?.status?.completed) continue;
      for (const nodeOut of Object.values(entry.outputs || {})) {
        const images = nodeOut?.images;
        if (!images?.length) continue;
        const img = images[0];
        const url = `${endpoint}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type || 'output'}`;
        const imgResp = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (!imgResp.ok) throw new Error('Failed to download image from ComfyUI');
        return Buffer.from(await imgResp.arrayBuffer());
      }
      throw new Error('ComfyUI completed but output contained no images');
    }
    throw new Error('ComfyUI generation timed out (5 minutes)');
  }

  async function generateWithOpenRouter(apiKey, model, prompt, width, height) {
    const body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image'],
    };
    if (width && height) body.extra_body = { width, height };

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'DnD Story Generator'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000)
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OpenRouter ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = await resp.json();
    const message = data?.choices?.[0]?.message;

    // Primary shape: message.images[].image_url.url
    if (Array.isArray(message?.images) && message.images.length) {
      const url = message.images[0]?.image_url?.url;
      if (url) return _fetchOrDecodeImage(url);
    }

    // Fallback: content array with image_url blocks
    if (Array.isArray(message?.content)) {
      for (const block of message.content) {
        if (block?.type === 'image_url' && block.image_url?.url)
          return _fetchOrDecodeImage(block.image_url.url);
      }
    }

    // Fallback: content as plain string (URL / markdown / data URL)
    if (typeof message?.content === 'string' && message.content.trim())
      return _fetchOrDecodeImage(message.content.trim());

    throw new Error(`OpenRouter returned no image. Response: ${JSON.stringify(data).slice(0, 400)}`);
  }

  async function _fetchOrDecodeImage(value) {
    if (value.startsWith('data:image/')) {
      const m = value.match(/^data:image\/[^;]+;base64,(.+)$/s);
      if (m) return Buffer.from(m[1], 'base64');
      throw new Error('Malformed data URL in OpenRouter response');
    }
    const mdMatch = value.match(/!\[.*?\]\(([^)]+)\)/);
    const url = mdMatch ? mdMatch[1] : (/^https?:\/\//.test(value) ? value : null);
    if (!url) throw new Error(`Cannot extract image URL from: ${value.slice(0, 200)}`);
    const imgResp = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!imgResp.ok) throw new Error(`Failed to download image from OpenRouter (${imgResp.status})`);
    return Buffer.from(await imgResp.arrayBuffer());
  }

  // ComfyUI proxy — auto-falls back to host.docker.internal when localhost is unreachable
  app.get('/api/stories/comfyui/checkpoints', async (req, res) => {
    const requested = (req.query.endpoint || 'http://localhost:8188').trim().replace(/\/+$/, '');

    async function tryEndpoint(ep) {
      const resp = await fetch(`${ep}/object_info/CheckpointLoaderSimple`, {
        signal: AbortSignal.timeout(8000)
      });
      if (!resp.ok) throw new Error(`ComfyUI returned HTTP ${resp.status}`);
      const data = await resp.json();
      const checkpoints = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
      return { checkpoints, endpoint: ep };
    }

    try {
      const result = await tryEndpoint(requested);
      return res.json(result);
    } catch (e1) {
      const cause = e1.cause?.message || e1.message;
      if (/localhost|127\.0\.0\.1/.test(requested)) {
        const dockerEp = requested.replace(/localhost|127\.0\.0\.1/, 'host.docker.internal');
        try {
          const result = await tryEndpoint(dockerEp);
          return res.json({ ...result, autoDetected: true });
        } catch (e2) {
          const cause2 = e2.cause?.message || e2.message;
          return res.status(500).json({
            error: `Cannot reach ComfyUI.\n• ${requested} → ${cause}\n• ${dockerEp} → ${cause2}\n\nMake sure ComfyUI is running and check the endpoint URL.`
          });
        }
      }
      return res.status(500).json({ error: `Cannot reach ComfyUI at ${requested}: ${cause}` });
    }
  });

  // File-system routes — must come before :id routes
  app.get('/api/stories/files', (req, res) => {
    try {
      const result = [];
      const entries = fs.readdirSync(STORIES_DIR, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const charDir = path.join(STORIES_DIR, e.name);
        const files = fs.readdirSync(charDir)
          .filter(f => f.endsWith('.txt'))
          .map(f => ({
            filename: f,
            name: f.replace(/\.txt$/, '').replace(/^\d+-/, '').replace(/-/g, ' '),
            path: `${e.name}/${f}`
          }))
          .sort((a, b) => a.filename.localeCompare(b.filename));
        result.push({ character: e.name, files });
      }
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/stories/folders', (req, res) => {
    const { name } = req.body || {};
    if (!name || !/^[a-zA-Z0-9 _-]+$/.test(name.trim()))
      return res.status(400).json({ error: 'Invalid folder name — use letters, numbers, spaces, hyphens only' });
    const folderName = name.trim().toLowerCase().replace(/\s+/g, '-');
    try {
      fs.mkdirSync(path.join(STORIES_DIR, folderName), { recursive: true });
      res.json({ ok: true, name: folderName });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/stories/files/*', (req, res) => {
    const full = safeStoryPath(req.params[0]);
    if (!full) return res.status(400).json({ error: 'Invalid path' });
    try {
      const content = fs.readFileSync(full, 'utf8');
      res.json({ content, sequences: parsePromptFile(content) });
    } catch { res.status(404).json({ error: 'File not found' }); }
  });

  app.put('/api/stories/files/*', (req, res) => {
    const full = safeStoryPath(req.params[0]);
    if (!full) return res.status(400).json({ error: 'Invalid path' });
    const { content } = req.body || {};
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    try {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
      res.json({ ok: true, sequences: parsePromptFile(content) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/stories/files/*', (req, res) => {
    const full = safeStoryPath(req.params[0]);
    if (!full) return res.status(400).json({ error: 'Invalid path' });
    try { fs.unlinkSync(full); res.json({ ok: true }); }
    catch { res.status(404).json({ error: 'File not found' }); }
  });

  // Preset routes — must come before :id routes
  app.get('/api/stories/presets', (req, res) => res.json(sdb.listPresets()));

  app.post('/api/stories/presets', (req, res) => {
    const d = req.body || {};
    if (!d.name) return res.status(400).json({ error: 'name required' });
    res.json(sdb.createPreset(crypto.randomUUID(), d));
  });

  app.put('/api/stories/presets/:pid', (req, res) => {
    if (!sdb.getPreset(req.params.pid)) return res.status(404).json({ error: 'Not found' });
    res.json(sdb.updatePreset(req.params.pid, req.body || {}));
  });

  app.delete('/api/stories/presets/:pid', (req, res) => {
    if (!sdb.getPreset(req.params.pid)) return res.status(404).json({ error: 'Not found' });
    sdb.deletePreset(req.params.pid);
    res.json({ ok: true });
  });

  // Story CRUD routes
  app.get('/api/stories', (req, res) => res.json(sdb.listStories()));

  app.get('/api/stories/:id', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Not found' });
    res.json({ ...story, sequences: sdb.listSequences(story.id) });
  });

  app.post('/api/stories', (req, res) => {
    const { promptFile } = req.body || {};
    if (!promptFile) return res.status(400).json({ error: 'promptFile required' });
    const full = safeStoryPath(promptFile);
    if (!full) return res.status(400).json({ error: 'Invalid path' });

    let content;
    try { content = fs.readFileSync(full, 'utf8'); }
    catch { return res.status(404).json({ error: 'Prompt file not found' }); }

    const sequences = parsePromptFile(content);
    if (!sequences.length) return res.status(400).json({ error: 'No valid sequences in file' });

    const parts = promptFile.split('/');
    const character = parts[0];
    const filename  = parts[1] || parts[0];
    const storyName = filename.replace(/\.txt$/, '').replace(/^\d+-/, '').replace(/-/g, ' ');
    const dateStr   = new Date().toISOString().slice(0, 10);
    const imageDir  = `/story-images/${slugify(character)}/${dateStr}/${slugify(storyName)}`;

    const existing = sdb.getStoryByFile(promptFile);
    let storyId;
    if (existing) {
      storyId = existing.id;
      sdb.updateStoryStatus(storyId, 'pending');
    } else {
      storyId = crypto.randomUUID();
      sdb.createStory(storyId, character, storyName, promptFile, sequences.length, imageDir);
    }

    // Preserve image_path/status for sequences that already have generated images
    const existingSeqs = sdb.listSequences(storyId);
    const existingByNum = {};
    for (const s of existingSeqs) existingByNum[s.seq_number] = s;

    const seqObjs = sequences.map(s => ({
      id:        existingByNum[s.seqNumber]?.id        || crypto.randomUUID(),
      seqNumber: s.seqNumber,
      prompt:    s.prompt,
      imagePath: existingByNum[s.seqNumber]?.image_path || '',
      status:    existingByNum[s.seqNumber]?.status     || 'pending',
    }));
    sdb.replaceSequences(storyId, seqObjs);

    res.json({ ...sdb.getStory(storyId), sequences: sdb.listSequences(storyId) });
  });

  app.delete('/api/stories/:id', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Not found' });
    if (story.image_dir) {
      try { fs.rmSync(path.join(__dirname, 'public', story.image_dir), { recursive: true, force: true }); } catch {}
    }
    sdb.deleteStory(req.params.id);
    res.json({ ok: true });
  });

  // Upload a pre-generated image to a specific sequence
  app.post('/api/stories/:id/sequences/:seqId/image', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    const seqs = sdb.listSequences(story.id);
    const seq  = seqs.find(s => s.id === req.params.seqId);
    if (!seq) return res.status(404).json({ error: 'Sequence not found' });

    const { dataUrl } = req.body || {};
    if (!dataUrl) return res.status(400).json({ error: 'dataUrl required' });
    const mimeMatch = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/s);
    if (!mimeMatch) return res.status(400).json({ error: 'Invalid data URL' });

    const mimeType = mimeMatch[1];
    const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' })[mimeType] || 'png';
    const imageDir = path.join(__dirname, 'public', story.image_dir);
    fs.mkdirSync(imageDir, { recursive: true });
    const filename = String(seq.seq_number).padStart(3, '0') + '.' + ext;
    fs.writeFileSync(path.join(imageDir, filename), Buffer.from(mimeMatch[2], 'base64'));
    const webPath = `${story.image_dir}/${filename}`;
    sdb.updateSequence(seq.id, webPath, 'done');
    res.json({ ok: true, imagePath: webPath });
  });

  app.post('/api/stories/:id/generate', async (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Not found' });

    const { serverType, endpoint, apiKey, model,
            checkpoint, negativePrompt, steps, cfg, sampler,
            width, height, customWorkflow, seqIds } = req.body || {};
    if (!serverType) return res.status(400).json({ error: 'serverType required' });
    if (serverType === 'comfyui' && !endpoint)
      return res.status(400).json({ error: 'endpoint required for ComfyUI' });
    if (serverType === 'comfyui' && !customWorkflow && !checkpoint)
      return res.status(400).json({ error: 'Select a checkpoint or provide a custom workflow' });
    if (serverType === 'openrouter' && (!apiKey || !model))
      return res.status(400).json({ error: 'apiKey and model required for OpenRouter' });

    if (serverType === 'comfyui' && customWorkflow) {
      try { JSON.parse(customWorkflow.replace(/\{\{PROMPT\}\}/g, 'test')); }
      catch { return res.status(400).json({ error: 'Invalid custom workflow JSON' }); }
    }

    const allSequences = sdb.listSequences(story.id);
    if (!allSequences.length) return res.status(400).json({ error: 'Story has no sequences' });
    // Allow targeting specific sequences (single-sequence generation)
    const sequences = (Array.isArray(seqIds) && seqIds.length)
      ? allSequences.filter(s => seqIds.includes(s.id))
      : allSequences;
    if (!sequences.length) return res.status(400).json({ error: 'No matching sequences found' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const imageDir = path.join(__dirname, 'public', story.image_dir);
    fs.mkdirSync(imageDir, { recursive: true });

    sdb.updateStoryStatus(story.id, 'generating');
    send({ type: 'start', total: sequences.length });

    let done = 0;
    for (const seq of sequences) {
      send({ type: 'progress', seqId: seq.id, seqNumber: seq.seq_number, status: 'generating' });
      sdb.updateSequenceStatus(seq.id, 'generating');
      try {
        let buf;
        if (serverType === 'comfyui') {
          buf = await generateWithComfyUI(endpoint,
            { checkpoint, negativePrompt, steps, cfg, sampler, width, height, customWorkflow },
            seq.prompt);
        } else {
          buf = await generateWithOpenRouter(apiKey, model, seq.prompt, width, height);
        }
        const filename  = String(seq.seq_number).padStart(3, '0') + '.png';
        fs.writeFileSync(path.join(imageDir, filename), buf);
        const webPath = `${story.image_dir}/${filename}`;
        sdb.updateSequence(seq.id, webPath, 'done');
        done++;
        send({ type: 'done', seqId: seq.id, seqNumber: seq.seq_number, imagePath: webPath });
      } catch (err) {
        sdb.updateSequenceStatus(seq.id, 'failed');
        send({ type: 'error', seqId: seq.id, seqNumber: seq.seq_number, error: err.message });
      }
    }

    const finalStatus = done === sequences.length ? 'complete' : done > 0 ? 'partial' : 'failed';
    sdb.updateStoryStatus(story.id, finalStatus);
    send({ type: 'finish', status: finalStatus, done, total: sequences.length });
    res.end();
  });
}
