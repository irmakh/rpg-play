// ── Shared lightbox — images and videos ───────────────────────────────────────
function lightboxOpen(src, mimeType) {
  const existing = document.getElementById('media-lightbox');
  if (existing) existing.remove();

  const lb = document.createElement('div');
  lb.id = 'media-lightbox';
  lb.style.cssText = 'position:fixed;inset:0;background:#000d;display:flex;align-items:center;justify-content:center;z-index:4000;cursor:zoom-out';
  lb.onclick = () => lb.remove();

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'position:absolute;top:14px;right:18px;background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;padding:4px;opacity:.8';
  closeBtn.onmouseenter = () => { closeBtn.style.opacity = '1'; };
  closeBtn.onmouseleave = () => { closeBtn.style.opacity = '.8'; };
  closeBtn.onclick = e => { e.stopPropagation(); lb.remove(); };
  lb.appendChild(closeBtn);

  if (mimeType && mimeType.startsWith('video/')) {
    const vid = document.createElement('video');
    vid.src = src;
    vid.controls = true;
    vid.autoplay = true;
    vid.style.cssText = 'max-width:92vw;max-height:88vh;border-radius:6px;box-shadow:0 8px 40px #000;cursor:default';
    vid.onclick = e => e.stopPropagation();
    lb.appendChild(vid);
  } else {
    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'max-width:94vw;max-height:94vh;border-radius:6px;box-shadow:0 8px 40px #000';
    lb.appendChild(img);
  }

  document.body.appendChild(lb);
}

function lightboxClose() {
  const lb = document.getElementById('media-lightbox');
  if (lb) lb.remove();
}
