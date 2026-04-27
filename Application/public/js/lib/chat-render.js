// ── Shared chat rendering ─────────────────────────────────────────────────────
function scrollChatLog() {
  const log = document.getElementById('chat-log');
  if (log) log.scrollTop = log.scrollHeight;
}

function appendChatEntry(e) {
  const log = document.getElementById('chat-log');
  if (!log) return;
  const rawTs = e.timestamp || '';
  const dt = rawTs ? new Date(rawTs + (rawTs.endsWith('Z') ? '' : 'Z')) : new Date();
  const time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');

  if (e.type === 'text') {
    div.className = 'chat-entry chat-text';
    div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:2px">
      <span class="ce-sender">${esc(e.sender || '?')}</span>
      <span style="color:var(--txd);font-size:10px">${time}</span>
    </div>
    <div style="word-break:break-word">${esc(e.message || '')}</div>`;
    log.appendChild(div);
    return;
  }

  if (e.type === 'media') {
    const url = `/api/shared-media/${e.mediaId}`;
    let mediaEl = '';
    if (e.mimeType && e.mimeType.startsWith('image/')) {
      const displayUrl = e.mediumUrl || url;
      mediaEl = `<img loading="lazy" src="${esc(displayUrl)}" style="max-width:100%;max-height:200px;width:auto;object-fit:contain;border-radius:4px;margin-top:4px;display:block;cursor:pointer" onclick="lightboxOpen('${url}','${esc(e.mimeType || '')}')">`;
    } else if (e.mimeType && e.mimeType.startsWith('video/')) {
      mediaEl = `<div style="position:relative;max-width:100%;cursor:pointer;overflow:hidden;background:#000;border-radius:4px;margin-top:4px;display:inline-block" onclick="lightboxOpen('${url}','${esc(e.mimeType || '')}')"><video src="${url}" preload="metadata" muted playsinline style="max-width:100%;max-height:200px;display:block;pointer-events:none"></video><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px;text-shadow:0 2px 8px #000;pointer-events:none">&#9654;</div></div>`;
    } else if (e.mimeType && e.mimeType.startsWith('audio/')) {
      mediaEl = `<audio src="${url}" controls style="max-width:100%;margin-top:6px;display:block"></audio>`;
    } else {
      mediaEl = `<a href="${url}" target="_blank" style="display:inline-block;margin-top:6px;padding:4px 8px;background:var(--bg3);border-radius:4px;color:var(--ac);font-size:11px">📎 Open file</a>`;
    }
    const cap = e.caption ? `<div style="font-size:10px;color:var(--txd);margin-top:4px">${esc(e.caption)}</div>` : '';
    div.className = 'chat-entry';
    div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span class="ce-sender">${esc(e.sender || 'DM')} <span style="font-size:10px;color:var(--txd);font-weight:normal">media</span></span>
      <span style="color:var(--txd);font-size:10px">${time}</span>
    </div>${mediaEl}${cap}`;
    log.appendChild(div);
    return;
  }

  const isNat20 = e.dice && e.dice.match(/d20$/) && e.results && e.results.length === 1 && e.results[0] === 20;
  const isNat1  = e.dice && e.dice.match(/d20$/) && e.results && e.results.length === 1 && e.results[0] === 1;
  const cls = isNat20 ? ' nat20' : isNat1 ? ' nat1' : '';
  const modStr = e.modifier ? (e.modifier > 0 ? `+${e.modifier}` : `${e.modifier}`) : '';
  const multiStr = e.results && e.results.length > 1
    ? ` <span style="font-size:10px;color:var(--txd)">[${e.results.join(', ')}]</span>` : '';
  const labelStr = e.label ? ` — ${esc(e.label)}` : '';
  const natStr = isNat20 ? ' <span style="color:var(--ok)">✨ NAT 20!</span>'
               : isNat1  ? ' <span style="color:var(--err)">💀 NAT 1</span>' : '';
  div.className = `chat-entry${cls}`;
  div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:2px">
    <span class="ce-sender">${esc(e.sender || '?')}</span>
    <span style="color:var(--txd);font-size:10px">${time}</span>
  </div>
  <span style="color:var(--txd);font-size:11px">${esc(e.dice || '')}${modStr}${labelStr}</span>${multiStr}
  <div class="ce-total" style="color:${isNat20 ? 'var(--ok)' : isNat1 ? 'var(--err)' : 'var(--tx)'}">${e.total}${natStr}</div>`;
  log.appendChild(div);
}
