// ── Wire proficiency checkboxes + derived inputs to recalcAll ─────────────────
document.querySelectorAll('[data-key^="sk-prof-"], [data-key^="sk-exp-"], [data-key^="save-prof-"]').forEach(el => {
  el.addEventListener('change', recalcAll);
});
document.querySelector('[data-key="profbonus"]')?.addEventListener('input', recalcAll);
document.querySelector('[data-key="sp-ability"]')?.addEventListener('input', recalcAll);
document.querySelector('[data-key="init-bonus"]')?.addEventListener('input', recalcAll);
document.querySelector('[data-key="level"]')?.addEventListener('input', () => { recalcProfBonus(); recalcAll(); recalcPreparedCount(); });

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (document.getElementById('adv-modal').style.display === 'flex') {
    if      (e.key === 'a' || e.key === 'A') { e.preventDefault(); confirmRoll('adv'); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); confirmRoll('norm'); }
    else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); confirmRoll('dis'); }
    else if (e.key === 'Escape') advClose();
    return;
  }
  if (e.key !== 'Escape') return;
  if (document.getElementById('unlock-screen').style.display !== 'none') unlockCancel();
  else if (document.getElementById('pw-modal').style.display !== 'none') pwClose();
  else if (document.getElementById('nc-modal').style.display !== 'none') ncClose();
  else if (document.getElementById('shop-detail-modal').style.display !== 'none') closeShopDetail();
  else if (document.getElementById('item-detail-modal').style.display !== 'none') closeItemDetail();
  else if (document.getElementById('item-modal').style.display !== 'none') closeItemModal();
  else if (document.getElementById('loot-add-modal').style.display !== 'none') closeLootAddModal();
  else if (document.getElementById('media-lightbox')) document.getElementById('media-lightbox').remove();
});

document.getElementById('wpn-tbl').addEventListener('input', renderWeaponsSummary);

initRollClickHandlers();
loadCharacterList(true);
// Initiative data loaded on first panel open — panel starts collapsed so no need to fetch upfront
