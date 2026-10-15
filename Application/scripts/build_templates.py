#!/usr/bin/env python3
# Written by Irmak Hakman — 2026-10-15 15:00
# Copyright (c) 2026 Irmak Hakman
# SPDX-License-Identifier: BUSL-1.1  (see LICENSE)
"""Build public/css/templates.css — the ten large-text colour templates.

Each template is one of the first ten schemes in Visme's "website color
schemes" article, mapped onto the app's design tokens (css/tokens.css). The
default template is not in this file and is never touched by it.

Every text colour is checked against every surface for WCAG AA (4.5:1), the
bar tokens.css set for the default. A source colour that misses is moved in
lightness, keeping its hue, until it passes, and the report says so. Schemes 5
and 7 had no published hex codes (animated images); theirs were sampled from
the images.

Usage:  python3 scripts/build_templates.py            # write + report
        python3 scripts/build_templates.py --check    # report only
"""
import colorsys
import math
import re
from datetime import datetime
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'public' / 'css' / 'templates.css'
FS = 1.2   # every font a fifth larger than the default

# id, label, mode, then the token sources. 'src' lists the scheme's colours.
TEMPLATES = [
  dict(id='metallic', label='Metallic Chic', mode='light',
       src='3D52A0 7091E6 8697C4 ADBBDA EDE8F5',
       ink='EDE8F5', slate='F8F6FC', slate_hi='DCE1F0', sunken='E1DBEE',
       bone='1C2550', ash='4F5A80', arc='3D52A0', blood='B3261E', verdigris='1E7A4A'),
  dict(id='vintage', label='Deep Vintage Mood', mode='dark',
       src='244855 E64833 874F41 90AEAD FBE9D0',
       ink='0E2228', slate='173540', slate_hi='1F434F', sunken='09181D',
       bone='FBE9D0', ash='90AEAD', arc='E64833', blood='FF5C7A', verdigris='5FD39A'),
  dict(id='cool', label='Cool and Collected', mode='dark',
       src='003135 024950 964734 0FA4AF AFDDE5',
       ink='002629', slate='003135', slate_hi='024950', sunken='001C1F',
       bone='E4F4F7', ash='AFDDE5', arc='0FA4AF', blood='E07A5F', verdigris='5ED6A0'),
  dict(id='earthy', label='Earthy and Serene', mode='dark',
       src='3E362E 865D36 93785B AC8968 A69080',
       ink='2B251F', slate='3E362E', slate_hi='4A4137', sunken='211C17',
       bone='F2E8DA', ash='A69080', arc='AC8968', blood='E07B6A', verdigris='8FC79A'),
  dict(id='texture', label='Texture and Contrast', mode='dark',
       src='677A6F 7C97A1 645752 E4E8D8 D89BB5',
       ink='29332E', slate='343F39', slate_hi='3F4C44', sunken='212924',
       bone='F4F6EC', ash='E4E8D8', arc='D89BB5', blood='F2A3A3', verdigris='B6E6C0'),
  dict(id='mechanical', label='Mechanical and Floaty', mode='dark',
       src='141619 2C2E3A 050A44 0A21C0 B3B4BD',
       ink='141619', slate='1E2027', slate_hi='2C2E3A', sunken='0C0D10',
       bone='ECEDF2', ash='B3B4BD', arc='0A21C0', blood='F06B6B', verdigris='4DD68F'),
  dict(id='pixel', label='Pixel Intensity', mode='dark',
       src='000000 8B0E05 3997EB 87B8D2 674B61',
       ink='05070D', slate='0E1220', slate_hi='1A2034', sunken='000000',
       bone='EAF3FA', ash='87B8D2', arc='3997EB', blood='8B0E05', verdigris='4DD68F'),
  dict(id='gradient', label='Gradient Pop', mode='dark',
       src='141414 273DB4 C50900 F95CA4 ED7845',
       ink='141414', slate='1F1F24', slate_hi='2A2A33', sunken='0B0B0B',
       bone='F5F5F5', ash='B4B9D4', arc='F95CA4', blood='C50900', verdigris='4DD68F'),
  dict(id='cosmic', label='Cosmic Artistry', mode='dark',
       src='212A31 2E3944 124E66 748D92 D3D9D4',
       ink='212A31', slate='2E3944', slate_hi='38465A', sunken='182027',
       bone='E8ECE9', ash='748D92', arc='124E66', blood='E88080', verdigris='7FD1A8'),
  dict(id='vibrant', label='Vibrant but Calm', mode='light',
       src='E43D12 D6536D FFA2B6 EFB11D EBE9E1',
       ink='EBE9E1', slate='F7F6F2', slate_hi='E2DFD4', sunken='DEDACD',
       bone='2B1A12', ash='6B5548', arc='E43D12', blood='D6536D', verdigris='1F7A45'),
]

# ── colour maths ─────────────────────────────────────────────────────────────
def rgb(h):  return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
def hexs(c): return ''.join(f'{round(max(0, min(1, v)) * 255):02X}' for v in c)

def lum(h):
    def ch(v): return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(v) for v in rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)

# Lightness moves in OKLCH, which keeps a colour's intensity as it brightens or
# darkens; HSL lightness drifts toward grey/white and turns a vivid red pastel.
def _lin(v):   return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
def _gam(v):   return 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055

def to_oklch(h):
    r, g, b = (_lin(v) for v in rgb(h))
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return L, (a * a + bb * bb) ** 0.5, math.atan2(bb, a)

def from_oklch(L, C, H):

    for _ in range(60):                   # reduce chroma until it fits sRGB
        a, b = C * math.cos(H), C * math.sin(H)
        l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
        m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
        s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
        rgb_ = (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
        if all(-1e-4 <= v <= 1 + 1e-4 for v in rgb_):
            return hexs(tuple(_gam(max(0, min(1, v))) for v in rgb_))
        C *= 0.95
    return hexs(tuple(_gam(max(0, min(1, v))) for v in rgb_))

def shift(h, dl):
    L, C, H = to_oklch(h)
    return from_oklch(max(0, min(1, L + dl)), C, H)

def fit(h, surfaces, need, toward):
    """Move h in lightness (toward +1 lighter / -1 darker) until it reaches
    `need` contrast on every surface. Returns (colour, moved?)."""
    c = h
    for _ in range(200):
        if min(contrast(c, s) for s in surfaces) >= need:
            return c, c != h
        c = shift(c, 0.005 * toward)
    sys.exit(f'cannot fit {h} on {surfaces}')

def alpha(h, a): return f'#{h}{round(a * 255):02X}'

# The selectbox itself (js/lib/template.js puts it in each page's header). It is
# styled here rather than in base.css because login, music and maintenance do
# not load base.css, and it must look the same everywhere.
SELECT_CSS = """/* The template button and its pop-up, in every template including the default. */
.tpl-btn{
  display:inline-grid; place-items:center; flex:none;
  width:32px; height:32px; padding:0; cursor:pointer;
  color:var(--ash); background:transparent;
  border:1px solid var(--rule-hi); border-radius:var(--r-sm);
}
.tpl-btn:hover, .tpl-btn[aria-expanded="true"]{color:var(--bone); background:var(--slate-hi)}
.tpl-btn:focus-visible, .tpl-item:focus-visible{outline:2px solid var(--arc); outline-offset:1px}
.tpl-btn .lt-icon{width:18px; height:18px}
.tpl-btn-float{position:fixed; top:8px; right:8px; z-index:900; background:var(--slate); box-shadow:var(--cast)}
.login-box > .tpl-btn{display:grid; margin:var(--s4) auto 0}

.tpl-pop{
  position:fixed; z-index:10000; width:max-content; min-width:220px;
  max-height:calc(100vh - 16px); overflow-y:auto;
  padding:var(--s1); background:var(--slate);
  border:1px solid var(--rule-hi); border-radius:var(--r-md); box-shadow:var(--cast);
}
.tpl-item{
  display:flex; align-items:center; gap:var(--s2); width:100%;
  padding:6px 10px; min-height:36px; border:0; border-radius:var(--r-sm);
  background:transparent; color:var(--bone); font:inherit; font-size:var(--t-sm);
  text-align:left; cursor:pointer;
}
.tpl-item:hover{background:var(--slate-hi)}
.tpl-item[aria-checked="true"]{background:var(--arc-fill); box-shadow:inset 3px 0 0 var(--arc)}
.tpl-item[aria-checked="true"]::after{content:"\\2713"; margin-left:auto; padding-left:var(--s3); color:var(--arc)}
/* Three dots: the template's ground, panel and accent. */
.tpl-sw{display:inline-flex; flex:none; border-radius:var(--r-full); padding:2px; gap:2px; background:var(--ink); border:1px solid var(--rule-hi)}
.tpl-sw i{width:10px; height:10px; border-radius:50%}
.tpl-sw i:nth-child(1){background:var(--slate)}
.tpl-sw i:nth-child(2){background:var(--bone)}
.tpl-sw i:nth-child(3){background:var(--arc)}
/* Six sizes: the label takes its own line above them. */
.tpl-sizes{display:flex; flex-wrap:wrap; align-items:center; gap:4px; margin-top:var(--s1); padding:var(--s2) 6px var(--s1); border-top:1px solid var(--rule)}
.tpl-sizes-lbl{flex:1 0 100%; font-size:var(--t-xs); color:var(--ash); padding-bottom:2px; white-space:nowrap}
.tpl-size{
  font:inherit; font-size:var(--t-xs); font-weight:600; color:var(--bone); cursor:pointer;
  min-width:40px; min-height:30px; padding:2px 5px; border:1px solid var(--rule-hi);
  border-radius:var(--r-sm); background:transparent;
}
.tpl-size:hover{background:var(--slate-hi)}
.tpl-size[aria-checked="true"]{background:var(--arc); border-color:var(--arc); color:var(--ink)}
.tpl-size:focus-visible{outline:2px solid var(--arc); outline-offset:1px}
/* Header overflow (js/lib/header-fit.js): on a phone, a header stays on one
   row; buttons that do not fit hide here and appear in the ☰ menu. */
.hf-hidden{display:none!important}
.hf-burger[hidden]{display:none!important}
.hf-menu .tpl-item svg{flex:none; width:1.15em; height:1.15em}
.hf-menu .tpl-item[aria-current="true"]{box-shadow:inset 3px 0 0 var(--arc)}
.hf-menu .tpl-item:disabled{opacity:.45; cursor:default}
.hf-row, .hf-row .cb-group, .hf-row .hdr-left, .hf-row .hdr-right{flex-wrap:nowrap!important}
.hf-row > *, .hf-row .cb-group > *, .hf-row .hdr-right > *{flex-shrink:0}
.hf-row :is(button, a){white-space:nowrap}
.hf-row .hdr-left, .hf-row h1{min-width:0; flex-shrink:1}
.hf-row h1{overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.hf-row .cb-nav{flex:0 0 auto!important; order:0!important; margin-left:0}
/* A group never shrinks below its contents (the sheet's phone CSS allows it,
   which let its buttons draw over each other); the select inside still can. */
:is(.hf-row, .hf-wrap) :is(.cb-group, .hdr-right){min-width:min-content!important}
/* A select's natural width is its longest option; start it at 8em instead, so
   it can grow into spare room or give way down to 5em. */
html :is(.hf-row, .hf-wrap) select{width:8em; flex:1 1 8em!important; min-width:5em; max-width:none}
/* The map toolbar and the character sheet's bar may use two rows on a phone. */
.hf-wrap{flex-wrap:wrap!important}
.tpl-sw[data-tpl-default]{--ink:#080C15; --slate:#101A2C; --bone:#E6EDF7; --arc:#E0A93F; --rule-hi:#E6EDF733}
"""

# ── build ────────────────────────────────────────────────────────────────────
def build(t, notes):
    light = t['mode'] == 'light'
    surf = [t['ink'], t['slate'], t['slate_hi'], t['sunken']]
    away = -1 if light else 1          # text moves away from the ground
    tok = {}
    for k in ('bone', 'ash', 'arc', 'blood', 'verdigris'):
        tok[k], moved = fit(t[k], surf, 4.5, away)
        if moved:
            notes.append(f"{t['id']}: {k} {t[k]} -> {tok[k]}")
    tok['ash_dim'], _ = fit(shift(tok['ash'], 0.12 if light else -0.12), surf, 3.0, away)
    tok['arc_hi'], _ = fit(shift(tok['arc'], -0.08 if light else 0.08), surf, 4.5, away)
    tok['blood_deep'] = shift(tok['blood'], 0.08 if light else -0.12)

    # A solid fill of the accent or a status colour carries --ink text
    # (tokens.css rule). Check it rather than trust it.
    for k in ('arc', 'blood', 'verdigris'):
        cr = contrast(t['ink'], tok[k])
        if cr < 4.5:
            notes.append(f"{t['id']}: --ink on solid --{k} is {cr:.1f}:1 (below 4.5)")

    b = tok['bone']
    lines = [
        f"/* {t['label']} — {t['mode']}. Scheme: {t['src']} */",
        f"html[data-template=\"{t['id']}\"], .tpl-sw[data-template=\"{t['id']}\"]{{",
        f"  color-scheme:{t['mode']};",
        f"  --fs:{FS};",
        f"  --ink:#{t['ink']}; --slate:#{t['slate']}; --slate-hi:#{t['slate_hi']}; --sunken:#{t['sunken']};",
        f"  --bone:#{b}; --ash:#{tok['ash']}; --ash-dim:#{tok['ash_dim']};",
        f"  --arc:#{tok['arc']}; --arc-hi:#{tok['arc_hi']}; --arc-fill:{alpha(tok['arc'], .14)}; --arc-line:{alpha(tok['arc'], .4)};",
        f"  --blood:#{tok['blood']}; --blood-deep:#{tok['blood_deep']}; --blood-fill:{alpha(tok['blood'], .13)};",
        f"  --verdigris:#{tok['verdigris']}; --verdigris-fill:{alpha(tok['verdigris'], .13)};",
        f"  --wash:{alpha(b, .06)}; --rule:{alpha(b, .12)}; --rule-hi:{alpha(b, .22)};",
        f"  --scrim:{'#1A1A2499' if light else '#000000B3'};",
        f"  --lift:{'#FFFFFFB3' if light else alpha(b, .12)};",
        f"  --cast:{'0 1px 2px #0000001F, 0 8px 24px #00000014' if light else '0 1px 2px #0000006B, 0 10px 28px #00000047'};",
        f"  --txd:#{tok['ash']};",
        "}",
    ]
    return '\n'.join(lines)

def main():
    notes = []
    blocks = [build(t, notes) for t in TEMPLATES]
    head = (
        f"/* Written by Irmak Hakman — {datetime.now():%Y-%m-%d %H:%M} (generated by scripts/build_templates.py; edit that, not this) */\n"
        "/* Copyright (c) 2026 Irmak Hakman — SPDX-License-Identifier: BUSL-1.1 (see LICENSE) */\n\n"
        "/* templates.css - the ten large-text colour templates.\n\n"
        "   Each one overrides the design tokens from tokens.css on <html data-template=\"…\">,\n"
        "   which js/lib/template.js sets from the visitor's choice. With no template the\n"
        "   attribute is absent and none of this applies - the default look is untouched.\n"
        "   --fs scales every font size (see tokens.css). Every text colour is AA (4.5:1)\n"
        "   on all four surfaces of its template. */\n"
    )
    # template.js holds the list the selectbox offers; it must name the same ids.
    js = (OUT.parent.parent / 'js' / 'lib' / 'template.js').read_text(encoding='utf-8')
    js_ids = set(re.findall(r"\['([a-z]+)', '", js))
    m = re.search(r'const TEMPLATE_FS = ([0-9.]+);', js)
    if not m or float(m.group(1)) != FS:
        sys.exit(f'template.js TEMPLATE_FS must equal FS ({FS})')
    if js_ids != {t['id'] for t in TEMPLATES}:
        sys.exit(f'template.js ids {sorted(js_ids)} do not match {sorted(t["id"] for t in TEMPLATES)}')
    css = head + '\n' + SELECT_CSS + '\n' + '\n\n'.join(blocks) + '\n'
    for n in notes:
        print('adjusted:', n)
    if '--check' not in sys.argv:
        OUT.write_text(css, encoding='utf-8')
        print(f'wrote {OUT} ({len(TEMPLATES)} templates)')

if __name__ == '__main__':
    main()
