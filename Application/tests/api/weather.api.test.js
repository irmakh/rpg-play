/**
 * API integration tests for the DM weather system.
 *
 * Mechanics under test (server/routes/events.js rollWeather):
 *   - Each category rolls its own d20: 1–14 normal, 15–17 level1, 18–20 level2.
 *   - Temperature: normal = Session Normal; level1 = SN − 2d6; level2 = SN + 2d6.
 *   - Wind: normal/level1/level2 → Normal/Light/Strong.
 *   - Precip: normal=None; level1=Light; level2=Heavy — snow if temp ≤ 32, else rain.
 * Because rolls are random we run many iterations and assert invariants rather
 * than fixed values, plus exercise config persistence and per-day overwrite.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

const asDM = (a) => a.set('X-Master-Password', TEST_MASTER_PW);
const day  = (over = {}) => ({ frYear: 1492, frMonth: 1, frDay: 5, frFestival: '', ...over });

const LEVELS = { normal: 'normal', level1: 'level1', level2: 'level2' };

describe('weather auth', () => {
  it('gates writes/config behind master pw but leaves the log public', async () => {
    const { app } = makeApp();
    expect((await request(app).get('/api/weather/config')).status).toBe(401);
    expect((await request(app).post('/api/weather/roll').send({ date: day(), sessionNormal: 60 })).status).toBe(401);
    expect((await request(app).put('/api/weather/config').send({ sessionNormal: 50 })).status).toBe(401);
    expect((await request(app).post('/api/weather/set').send({ date: day() })).status).toBe(401);
    expect((await request(app).delete('/api/weather/log/1492-1-5')).status).toBe(401);
    // Public read — players/table read this without a password.
    const log = await request(app).get('/api/weather/log');
    expect(log.status).toBe(200);
    expect(Array.isArray(log.body)).toBe(true);
  });
});

describe('GET/PUT /api/weather/config', () => {
  it('defaults to 60 then persists an updated value', async () => {
    const { app } = makeApp();
    let res = await asDM(request(app).get('/api/weather/config'));
    expect(res.body.sessionNormal).toBe(60);

    res = await asDM(request(app).put('/api/weather/config')).send({ sessionNormal: 45 });
    expect(res.status).toBe(200);

    res = await asDM(request(app).get('/api/weather/config'));
    expect(res.body.sessionNormal).toBe(45);
  });

  it('rejects a non-numeric sessionNormal', async () => {
    const { app } = makeApp();
    const res = await asDM(request(app).put('/api/weather/config')).send({ sessionNormal: 'hot' });
    expect(res.status).toBe(400);
  });

  it('defaults the d20 thresholds to 15 / 18 and persists updates', async () => {
    const { app } = makeApp();
    let res = await asDM(request(app).get('/api/weather/config'));
    expect(res.body.level1Min).toBe(15);
    expect(res.body.level2Min).toBe(18);

    await asDM(request(app).put('/api/weather/config')).send({ level1Min: 10, level2Min: 16 });
    res = await asDM(request(app).get('/api/weather/config'));
    expect(res.body.level1Min).toBe(10);
    expect(res.body.level2Min).toBe(16);
  });

  it('clamps thresholds into a coherent 1 ≤ l1 ≤ l2 ≤ 20 pair', async () => {
    const { app } = makeApp();
    // l2 below l1 gets pulled up to l1; out-of-range values are clamped.
    await asDM(request(app).put('/api/weather/config')).send({ level1Min: 12, level2Min: 5 });
    let res = await asDM(request(app).get('/api/weather/config'));
    expect(res.body.level1Min).toBe(12);
    expect(res.body.level2Min).toBe(12);

    await asDM(request(app).put('/api/weather/config')).send({ level1Min: 99, level2Min: 99 });
    res = await asDM(request(app).get('/api/weather/config'));
    expect(res.body.level1Min).toBe(20);
    expect(res.body.level2Min).toBe(20);
  });

  it('updating Session Normal alone leaves the thresholds intact', async () => {
    const { app } = makeApp();
    await asDM(request(app).put('/api/weather/config')).send({ level1Min: 8, level2Min: 14 });
    await asDM(request(app).put('/api/weather/config')).send({ sessionNormal: 70 });
    const res = await asDM(request(app).get('/api/weather/config'));
    expect(res.body.sessionNormal).toBe(70);
    expect(res.body.level1Min).toBe(8);
    expect(res.body.level2Min).toBe(14);
  });
});

describe('POST /api/weather/roll — invariants', () => {
  it('validates date and sessionNormal', async () => {
    const { app } = makeApp();
    expect((await asDM(request(app).post('/api/weather/roll')).send({ sessionNormal: 60 })).status).toBe(400);
    expect((await asDM(request(app).post('/api/weather/roll')).send({ date: day(), sessionNormal: 'x' })).status).toBe(400);
  });

  it('produces consistent level↔value mappings across many rolls', async () => {
    const { app } = makeApp();
    const SN = 50;
    for (let i = 0; i < 200; i++) {
      const res = await asDM(request(app).post('/api/weather/roll')).send({ date: day(), sessionNormal: SN });
      expect(res.status).toBe(200);
      const { temperature: t, wind: w, precipitation: p } = res.body;

      // d20 → level mapping holds for every category.
      for (const o of [t, w, p]) {
        expect(o.roll).toBeGreaterThanOrEqual(1);
        expect(o.roll).toBeLessThanOrEqual(20);
        expect(o.level).toBe(o.roll >= 18 ? 'level2' : o.roll >= 15 ? 'level1' : 'normal');
      }

      // Temperature direction by level.
      if (t.level === 'normal') { expect(t.value).toBe(SN); expect(t.dice).toEqual([]); }
      else {
        expect(t.dice).toHaveLength(2);
        t.dice.forEach(d => { expect(d).toBeGreaterThanOrEqual(1); expect(d).toBeLessThanOrEqual(6); });
        const sum = t.dice[0] + t.dice[1];
        expect(t.value).toBe(t.level === 'level1' ? SN - sum : SN + sum);
      }

      // Wind label by level.
      expect(w.value).toBe(w.level === 'level2' ? 'Strong' : w.level === 'level1' ? 'Light' : 'Normal');

      // Precipitation: None at normal; snow/rain by freezing threshold otherwise.
      if (p.level === 'normal') expect(p.value).toBe('None');
      else {
        const wet = t.value <= 32 ? 'snow' : 'rain';
        const intensity = p.level === 'level2' ? 'Heavy' : 'Light';
        expect(p.value).toBe(`${intensity} ${wet}`);
      }
    }
  });

  it('persists sessionNormal sent with the roll', async () => {
    const { app } = makeApp();
    await asDM(request(app).post('/api/weather/roll')).send({ date: day(), sessionNormal: 33 });
    const cfg = await asDM(request(app).get('/api/weather/config'));
    expect(cfg.body.sessionNormal).toBe(33);
  });

  it('honours custom thresholds sent with the roll and persists them', async () => {
    const { app } = makeApp();
    // level1Min=2, level2Min=20 → only a natural 20 is level2; 2–19 is level1; 1 normal.
    for (let i = 0; i < 120; i++) {
      const res = await asDM(request(app).post('/api/weather/roll'))
        .send({ date: day(), sessionNormal: 50, level1Min: 2, level2Min: 20 });
      const { temperature: t } = res.body;
      const expected = t.roll >= 20 ? 'level2' : t.roll >= 2 ? 'level1' : 'normal';
      expect(t.level).toBe(expected);
    }
    const cfg = await asDM(request(app).get('/api/weather/config'));
    expect(cfg.body.level1Min).toBe(2);
    expect(cfg.body.level2Min).toBe(20);
  });
});

describe('weather log', () => {
  it('re-rolling the same date overwrites that day (one entry per day)', async () => {
    const { app } = makeApp();
    await asDM(request(app).post('/api/weather/roll')).send({ date: day(), sessionNormal: 60, dateLabel: '5 Hammer, 1492 DR' });
    await asDM(request(app).post('/api/weather/roll')).send({ date: day(), sessionNormal: 60 });
    const log = (await asDM(request(app).get('/api/weather/log'))).body;
    expect(log.filter(e => e.id === '1492-1-5')).toHaveLength(1);
  });

  it('different dates produce separate log entries; festivals get their own key', async () => {
    const { app } = makeApp();
    await asDM(request(app).post('/api/weather/roll')).send({ date: day({ frDay: 1 }), sessionNormal: 60 });
    await asDM(request(app).post('/api/weather/roll')).send({ date: day({ frDay: 2 }), sessionNormal: 60 });
    await asDM(request(app).post('/api/weather/roll')).send({ date: { frYear: 1492, frMonth: null, frDay: null, frFestival: 'midwinter' }, sessionNormal: 60 });
    const log = (await asDM(request(app).get('/api/weather/log'))).body;
    const ids = log.map(e => e.id).sort();
    expect(ids).toEqual(['1492-1-1', '1492-1-2', '1492-F-midwinter']);
  });
});

describe('POST /api/weather/set — manual override', () => {
  const manual = (over = {}) => ({
    date: day(), sessionNormal: 60, dateLabel: '5 Hammer, 1492 DR',
    temperature: { level: 'level1', value: 12 },
    wind: { level: 'level2', value: 'Strong' },
    precipitation: { level: 'level2', value: 'Heavy snow' },
    ...over,
  });

  it('saves a manual entry with null rolls and the chosen values', async () => {
    const { app } = makeApp();
    const res = await asDM(request(app).post('/api/weather/set')).send(manual());
    expect(res.status).toBe(200);
    expect(res.body.temperature.value).toBe(12);
    expect(res.body.temperature.level).toBe('level1');
    expect(res.body.temperature.roll).toBeNull();
    expect(res.body.wind.value).toBe('Strong');
    expect(res.body.precipitation.value).toBe('Heavy snow');
  });

  it('overwrites a previously rolled day', async () => {
    const { app } = makeApp();
    await asDM(request(app).post('/api/weather/roll')).send({ date: day(), sessionNormal: 60 });
    await asDM(request(app).post('/api/weather/set')).send(manual({ temperature: { level: 'normal', value: 99 } }));
    const log = (await request(app).get('/api/weather/log')).body;
    const today = log.filter(e => e.id === '1492-1-5');
    expect(today).toHaveLength(1);
    expect(today[0].temperature.value).toBe(99);
  });

  it('rejects an invalid temperature value', async () => {
    const { app } = makeApp();
    const res = await asDM(request(app).post('/api/weather/set')).send(manual({ temperature: { level: 'normal', value: 'warm' } }));
    expect(res.status).toBe(400);
  });

  it('coerces an unknown level to normal', async () => {
    const { app } = makeApp();
    const res = await asDM(request(app).post('/api/weather/set')).send(manual({ temperature: { level: 'bogus', value: 50 } }));
    expect(res.body.temperature.level).toBe('normal');
  });
});

describe('DELETE /api/weather/log/:id', () => {
  it('removes a day from the log', async () => {
    const { app } = makeApp();
    await asDM(request(app).post('/api/weather/roll')).send({ date: day(), sessionNormal: 60 });
    await asDM(request(app).delete('/api/weather/log/1492-1-5'));
    const log = (await request(app).get('/api/weather/log')).body;
    expect(log.find(e => e.id === '1492-1-5')).toBeUndefined();
  });
});
