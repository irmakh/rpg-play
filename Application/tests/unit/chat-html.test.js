// Written by Irmak Hakman — 2026-09-26 16:35
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * chatHtmlAttr() — which attributes an HTML chat message may keep.
 *
 * HTML chat bodies (spell cards, group rolls) used to go into innerHTML raw,
 * and anyone could post one, so '<img src=x onerror=…>' ran in every tab —
 * the DM's included. sanitizeChatHtml() now rebuilds each body from an
 * allowlist; its per-attribute decision is this pure function, tested here
 * without a browser. (The DOM walk around it is ten lines and uses DOMParser,
 * which only exists in a browser.)
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../../public/js/lib/chat-render.js'), 'utf-8');

function extract(name) {
  const m = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`).exec(SRC);
  if (!m) throw new Error(`${name} not found — was it renamed?`);
  let depth = 0, i = m.index;
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) break;
  }
  return SRC.slice(m.index, i + 1);
}

const ctx = createContext({});
runInContext(`${extract('chatHtmlAttr')}; this.chatHtmlAttr = chatHtmlAttr;`, ctx);
const attr = ctx.chatHtmlAttr;

describe('chatHtmlAttr', () => {
  it('drops every event handler', () => {
    for (const n of ['onerror', 'onclick', 'onload', 'onmouseover', 'ONFOCUS']) {
      expect(attr('DIV', n, 'alert(1)')).toBeNull();
    }
  });

  it('keeps the layout the cards actually use', () => {
    expect(attr('DIV', 'style', 'display:flex;gap:10px')).toBe('display:flex;gap:10px');
    expect(attr('SPAN', 'class', 'x')).toBe('x');
    expect(attr('TD', 'colspan', '2')).toBe('2');
  });

  it('drops style that can fetch or reach script', () => {
    expect(attr('DIV', 'style', 'background:url(//evil/x)')).toBeNull();
    expect(attr('DIV', 'style', 'width:expression(alert(1))')).toBeNull();
    expect(attr('DIV', 'style', 'background:javascript:x')).toBeNull();
  });

  it('allows http(s), mailto, anchors and same-site links', () => {
    expect(attr('A', 'href', 'https://5e.tools/spells.html#fireball_xphb')).toBe('https://5e.tools/spells.html#fireball_xphb');
    expect(attr('A', 'href', '/table.html')).toBe('/table.html');
    expect(attr('A', 'href', '#top')).toBe('#top');
  });

  it('refuses javascript:, data: and protocol-relative links', () => {
    expect(attr('A', 'href', 'javascript:alert(1)')).toBeNull();
    expect(attr('A', 'href', ' JaVaScRiPt:alert(1)')).toBeNull();
    expect(attr('A', 'href', 'data:text/html,<script>')).toBeNull();
    expect(attr('A', 'href', '//evil.example')).toBeNull();
  });

  it('keeps target only as _blank, and href only on links', () => {
    expect(attr('A', 'target', '_blank')).toBe('_blank');
    expect(attr('A', 'target', '_top')).toBeNull();
    expect(attr('DIV', 'href', 'https://x')).toBeNull();
  });

  it('drops attributes it does not know', () => {
    expect(attr('DIV', 'srcdoc', '<script>')).toBeNull();
    expect(attr('A', 'formaction', 'x')).toBeNull();
  });
});
