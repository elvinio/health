// ── Wiki tab ──────────────────────────────────────────────────────────────────
// Sub-tabs: Recipe · Shopping · Resume
// Interaction: tap card → read-only detail view; swipe left → reveal Edit button.

let currentWikiSubTab = 'recipe';
let wikiView = null; // { type: 'recipe'|'shopping'|'resume', id: string } | null

// ── Sub-tab switching ─────────────────────────────────────────────────────────
function switchWikiSubTab(tab) {
  currentWikiSubTab = tab;
  wikiView = null;
  document.querySelectorAll('.wiki-sub-tab').forEach(b => {
    b.classList.toggle('active', b.id === 'wikiSubTab-' + tab);
  });
  ['recipe', 'shopping', 'resume'].forEach(t => {
    const el = document.getElementById('wikiSubContent-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.getElementById('fabBtn').style.display = '';
  renderWiki();
}

// ── Main render dispatcher ────────────────────────────────────────────────────
function renderWiki() {
  if (wikiView) {
    if (wikiView.type === 'recipe') renderRecipeDetail(wikiView.id);
    else if (wikiView.type === 'shopping') renderShoppingDetail(wikiView.id);
    else if (wikiView.type === 'resume') renderResumeDetail(wikiView.id);
    return;
  }
  if (currentWikiSubTab === 'recipe') renderRecipeList();
  else if (currentWikiSubTab === 'shopping') renderShoppingList();
  else if (currentWikiSubTab === 'resume') renderResumeList();
}

function openWikiDetail(type, id) {
  wikiView = { type, id };
  renderWiki();
}

function closeWikiDetail() {
  wikiView = null;
  renderWiki();
}

// ── Tap-to-view / swipe-to-edit helper ───────────────────────────────────────
// Attaches touch (and mouse-drag) gesture support to a container of .wiki-card
// elements.  Each .wiki-card wraps a .wiki-card-fg (foreground) and a
// .wiki-card-actions (action bar behind, revealed on left-swipe).
//
// Usage: attachWikiGestures(containerEl)
function attachWikiGestures(container) {
  if (!container) return;
  if (container._wikiGesturesBound) return;
  container._wikiGesturesBound = true;

  let startX = 0, startY = 0, activeCard = null, dragging = false;
  const SWIPE_THRESHOLD = 55;   // px before reveal
  const REVEAL_WIDTH    = 72;   // px to translate foreground by

  function getCard(el) {
    return el.closest('.wiki-card');
  }

  function resetCard(card) {
    if (!card) return;
    const fg = card.querySelector('.wiki-card-fg');
    if (fg) fg.style.transform = '';
    card.classList.remove('wiki-swiped');
  }

  function resetAll(except) {
    container.querySelectorAll('.wiki-card.wiki-swiped').forEach(c => {
      if (c !== except) resetCard(c);
    });
  }

  container.addEventListener('touchstart', e => {
    const card = getCard(e.target);
    if (!card) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    activeCard = card;
    dragging = false;
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    if (!activeCard) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    // Cancel if primarily vertical
    if (!dragging && Math.abs(dy) > Math.abs(dx)) { activeCard = null; return; }
    if (Math.abs(dx) > 8) dragging = true;
    if (!dragging) return;
    e.preventDefault();
    const fg = activeCard.querySelector('.wiki-card-fg');
    if (!fg) return;
    const trans = Math.min(0, dx - (activeCard.classList.contains('wiki-swiped') ? REVEAL_WIDTH : 0));
    fg.style.transform = `translateX(${Math.max(-REVEAL_WIDTH * 1.1, trans)}px)`;
  }, { passive: false });

  container.addEventListener('touchend', e => {
    if (!activeCard) return;
    const dx = e.changedTouches[0].clientX - startX;
    const card = activeCard;
    activeCard = null;

    if (!dragging) {
      // Pure tap — open detail view (only if not already swiped open)
      if (!card.classList.contains('wiki-swiped')) {
        const type = card.dataset.type;
        const id   = card.dataset.id;
        if (type && id) openWikiDetail(type, id);
      } else {
        resetCard(card);
      }
      return;
    }

    // Determine final state based on net displacement
    const fg = card.querySelector('.wiki-card-fg');
    if (dx < -SWIPE_THRESHOLD) {
      // Reveal actions
      resetAll(card);
      card.classList.add('wiki-swiped');
      if (fg) fg.style.transform = `translateX(-${REVEAL_WIDTH}px)`;
    } else {
      resetCard(card);
    }
    dragging = false;
  });

  // Click on the action layer Edit button — open edit sheet
  container.addEventListener('click', e => {
    const btn = e.target.closest('[data-wiki-edit]');
    if (btn) {
      const card = getCard(btn);
      if (card) resetCard(card);
      const type = btn.dataset.wikiEdit;
      const id   = btn.dataset.id;
      if (type === 'recipe') openRecipeSheet(id);
      else if (type === 'shopping') openShoppingSheet(id);
      else if (type === 'resume') openResumeSheet(id);
      return;
    }
    // Tap on foreground (no swipe) → open detail
    const fg = e.target.closest('.wiki-card-fg');
    if (fg) {
      const card = fg.closest('.wiki-card');
      if (card && !card.classList.contains('wiki-swiped')) {
        const type = card.dataset.type;
        const id   = card.dataset.id;
        if (type && id) openWikiDetail(type, id);
      } else if (card) {
        resetCard(card);
      }
    }
  });
}

// ── Back button HTML ──────────────────────────────────────────────────────────
function wikiBackBtn() {
  return `<button class="wiki-back-btn" onclick="closeWikiDetail()">← Back</button>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// RECIPES
// ─────────────────────────────────────────────────────────────────────────────

function renderRecipeList() {
  const el = document.getElementById('wikiSubContent-recipe');
  if (!el) return;
  const recipes = (wikiData.recipes || []).slice().sort((a, b) => (b._updatedAt || 0) - (a._updatedAt || 0));
  if (!recipes.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon">🍳</div>No recipes yet.<br>Tap + to add one.</div>`;
    return;
  }
  el.innerHTML = recipes.map(r => {
    const ingredientCount = (r.ingredients || '').split('\n').filter(l => l.trim()).length;
    return `<div class="wiki-card" data-type="recipe" data-id="${esc(r.id)}">
      <div class="wiki-card-actions">
        <button class="wiki-action-btn" data-wiki-edit="recipe" data-id="${esc(r.id)}" aria-label="Edit recipe">Edit</button>
      </div>
      <div class="wiki-card-fg">
        <div class="wiki-card-title">${esc(r.title)}</div>
        <div class="wiki-card-meta">${ingredientCount} ingredient${ingredientCount !== 1 ? 's' : ''}</div>
      </div>
    </div>`;
  }).join('');
  attachWikiGestures(el);
}

function renderRecipeDetail(id) {
  const el = document.getElementById('wikiSubContent-recipe');
  if (!el) return;
  const recipe = (wikiData.recipes || []).find(r => r.id === id);
  if (!recipe) { closeWikiDetail(); return; }

  const ingLines = (recipe.ingredients || '').split('\n').filter(l => l.trim());
  const stepLines = (recipe.steps || '').split('\n').filter(l => l.trim());
  const noteLines = (recipe.notes || '').split('\n').filter(l => l.trim());

  const ingredientsHtml = ingLines.length
    ? `<ul class="wiki-detail-list">${ingLines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`
    : '<p class="wiki-detail-empty">None listed.</p>';

  const stepsHtml = stepLines.length
    ? `<ol class="wiki-detail-list">${stepLines.map(l => `<li>${esc(l)}</li>`).join('')}</ol>`
    : '<p class="wiki-detail-empty">None listed.</p>';

  const notesHtml = noteLines.length
    ? `<p class="wiki-detail-notes">${noteLines.map(l => esc(l)).join('<br>')}</p>`
    : '';

  el.innerHTML = `
    <div class="wiki-detail">
      ${wikiBackBtn()}
      <div class="wiki-detail-header">
        <h2 class="wiki-detail-title">${esc(recipe.title)}</h2>
        <button class="btn btn-secondary wiki-detail-edit-btn" onclick="openRecipeSheet('${esc(id)}')">Edit</button>
      </div>
      <div class="wiki-detail-section">
        <div class="wiki-detail-section-title">Ingredients</div>
        ${ingredientsHtml}
      </div>
      <div class="wiki-detail-section">
        <div class="wiki-detail-section-title">Steps</div>
        ${stepsHtml}
      </div>
      ${notesHtml ? `<div class="wiki-detail-section"><div class="wiki-detail-section-title">Notes</div>${notesHtml}</div>` : ''}
    </div>`;
}

function openRecipeSheet(id) {
  document.getElementById('recipeForm').reset();
  document.getElementById('recipeId').value = '';
  document.getElementById('recipeDeleteBtn').style.display = 'none';
  document.getElementById('recipeSheetTitle').textContent = 'Add Recipe';

  if (id) {
    const recipe = (wikiData.recipes || []).find(r => r.id === id);
    if (!recipe) return;
    document.getElementById('recipeSheetTitle').textContent = 'Edit Recipe';
    document.getElementById('recipeId').value = id;
    document.getElementById('recipeTitle').value = recipe.title || '';
    document.getElementById('recipeIngredients').value = recipe.ingredients || '';
    document.getElementById('recipeSteps').value = recipe.steps || '';
    document.getElementById('recipeNotes').value = recipe.notes || '';
    document.getElementById('recipeDeleteBtn').style.display = '';
  }
  openSheet('recipeSheet');
  setTimeout(() => document.getElementById('recipeTitle').focus(), 350);
}

document.getElementById('recipeForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('recipeId').value;
  const recipe = {
    id: id || uid(),
    title: document.getElementById('recipeTitle').value.trim(),
    ingredients: document.getElementById('recipeIngredients').value,
    steps: document.getElementById('recipeSteps').value,
    notes: document.getElementById('recipeNotes').value,
    _updatedAt: Date.now()
  };
  if (!recipe.title) return;
  if (!wikiData.recipes) wikiData.recipes = [];
  if (id) {
    const idx = wikiData.recipes.findIndex(r => r.id === id);
    if (idx >= 0) wikiData.recipes[idx] = recipe; else wikiData.recipes.push(recipe);
  } else {
    wikiData.recipes.push(recipe);
  }
  saveWiki(wikiData); saveData(data);
  closeSheet();
  if (wikiView && wikiView.type === 'recipe') wikiView.id = recipe.id;
  renderWiki();
  showToast(id ? 'Recipe updated' : 'Recipe saved');
});

function deleteRecipe() {
  const id = document.getElementById('recipeId').value;
  if (!id || !confirm('Delete this recipe?')) return;
  if (!data._deletedIds) data._deletedIds = [];
  if (!data._deletedIds.includes(id)) data._deletedIds.push(id);
  wikiData.recipes = (wikiData.recipes || []).filter(r => r.id !== id);
  saveWiki(wikiData); saveData(data);
  closeSheet();
  wikiView = null;
  renderWiki();
  showToast('Recipe deleted');
}

// ─────────────────────────────────────────────────────────────────────────────
// SHOPPING LISTS
// ─────────────────────────────────────────────────────────────────────────────

function renderShoppingList() {
  const el = document.getElementById('wikiSubContent-shopping');
  if (!el) return;
  const lists = (wikiData.shoppingLists || []).slice().sort((a, b) => (b._updatedAt || 0) - (a._updatedAt || 0));
  if (!lists.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon">📝</div>No shopping lists yet.<br>Tap + to add one.</div>`;
    return;
  }
  el.innerHTML = lists.map(sl => {
    const total   = (sl.items || []).length;
    const checked = (sl.items || []).filter(i => i.checked).length;
    return `<div class="wiki-card" data-type="shopping" data-id="${esc(sl.id)}">
      <div class="wiki-card-actions">
        <button class="wiki-action-btn" data-wiki-edit="shopping" data-id="${esc(sl.id)}" aria-label="Edit list">Edit</button>
      </div>
      <div class="wiki-card-fg">
        <div class="wiki-card-title">${esc(sl.title)}</div>
        <div class="wiki-card-meta">${checked}/${total} checked</div>
      </div>
    </div>`;
  }).join('');
  attachWikiGestures(el);
}

function renderShoppingDetail(id) {
  const el = document.getElementById('wikiSubContent-shopping');
  if (!el) return;
  const sl = (wikiData.shoppingLists || []).find(l => l.id === id);
  if (!sl) { closeWikiDetail(); return; }

  const itemsHtml = (sl.items || []).length
    ? (sl.items || []).map(item => `
        <label class="wiki-shop-item${item.checked ? ' checked' : ''}">
          <input type="checkbox" ${item.checked ? 'checked' : ''}
            onchange="toggleShopItem('${esc(id)}','${esc(item.id)}',this.checked)">
          <span>${esc(item.text)}</span>
        </label>`).join('')
    : '<p class="wiki-detail-empty">No items.</p>';

  el.innerHTML = `
    <div class="wiki-detail">
      ${wikiBackBtn()}
      <div class="wiki-detail-header">
        <h2 class="wiki-detail-title">${esc(sl.title)}</h2>
        <button class="btn btn-secondary wiki-detail-edit-btn" onclick="openShoppingSheet('${esc(id)}')">Edit</button>
      </div>
      <div class="wiki-shop-items">${itemsHtml}</div>
    </div>`;
}

function toggleShopItem(listId, itemId, checked) {
  const sl = (wikiData.shoppingLists || []).find(l => l.id === listId);
  if (!sl) return;
  const item = (sl.items || []).find(i => i.id === itemId);
  if (!item) return;
  item.checked = checked;
  sl._updatedAt = Date.now();
  saveWiki(wikiData); saveData(data);
  // Re-render detail in place without going via wikiView
  renderShoppingDetail(listId);
}

function openShoppingSheet(id) {
  document.getElementById('shoppingForm').reset();
  document.getElementById('shoppingId').value = '';
  document.getElementById('shoppingDeleteBtn').style.display = 'none';
  document.getElementById('shoppingSheetTitle').textContent = 'Add Shopping List';
  document.getElementById('shoppingItemsEditor').innerHTML = '';

  if (id) {
    const sl = (wikiData.shoppingLists || []).find(l => l.id === id);
    if (!sl) return;
    document.getElementById('shoppingSheetTitle').textContent = 'Edit Shopping List';
    document.getElementById('shoppingId').value = id;
    document.getElementById('shoppingTitle').value = sl.title || '';
    (sl.items || []).forEach(item => addShoppingItemRow(item.text, item.checked, item.id));
    document.getElementById('shoppingDeleteBtn').style.display = '';
  }
  openSheet('shoppingSheet');
  setTimeout(() => document.getElementById('shoppingTitle').focus(), 350);
}

function addShoppingItemRow(text, checked, existingId) {
  const container = document.getElementById('shoppingItemsEditor');
  const row = document.createElement('div');
  row.className = 'wiki-editor-row';
  const itemId = existingId || uid();
  row.dataset.itemId = itemId;
  row.innerHTML = `
    <input type="checkbox" class="wiki-shop-check" ${checked ? 'checked' : ''} aria-label="Checked">
    <input type="text" class="wiki-editor-input" placeholder="Item…" value="${esc(text || '')}">
    <button type="button" class="wiki-editor-remove" onclick="this.closest('.wiki-editor-row').remove()" aria-label="Remove">✕</button>`;
  container.appendChild(row);
}

document.getElementById('shoppingForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('shoppingId').value;
  const rows = document.getElementById('shoppingItemsEditor').querySelectorAll('.wiki-editor-row');
  const items = [];
  rows.forEach(row => {
    const text = row.querySelector('input[type="text"]').value.trim();
    if (!text) return;
    items.push({
      id: row.dataset.itemId || uid(),
      text,
      checked: row.querySelector('input[type="checkbox"]').checked
    });
  });
  const sl = {
    id: id || uid(),
    title: document.getElementById('shoppingTitle').value.trim(),
    items,
    _updatedAt: Date.now()
  };
  if (!sl.title) return;
  if (!wikiData.shoppingLists) wikiData.shoppingLists = [];
  if (id) {
    const idx = wikiData.shoppingLists.findIndex(l => l.id === id);
    if (idx >= 0) wikiData.shoppingLists[idx] = sl; else wikiData.shoppingLists.push(sl);
  } else {
    wikiData.shoppingLists.push(sl);
  }
  saveWiki(wikiData); saveData(data);
  closeSheet();
  if (wikiView && wikiView.type === 'shopping') wikiView.id = sl.id;
  renderWiki();
  showToast(id ? 'List updated' : 'List saved');
});

function deleteShoppingList() {
  const id = document.getElementById('shoppingId').value;
  if (!id || !confirm('Delete this shopping list?')) return;
  if (!data._deletedIds) data._deletedIds = [];
  if (!data._deletedIds.includes(id)) data._deletedIds.push(id);
  wikiData.shoppingLists = (wikiData.shoppingLists || []).filter(l => l.id !== id);
  saveWiki(wikiData); saveData(data);
  closeSheet();
  wikiView = null;
  renderWiki();
  showToast('List deleted');
}

// ─────────────────────────────────────────────────────────────────────────────
// RESUMES
// ─────────────────────────────────────────────────────────────────────────────

function renderResumeList() {
  const el = document.getElementById('wikiSubContent-resume');
  if (!el) return;
  const resumes = (wikiData.resumes || []).slice().sort((a, b) => (b._updatedAt || 0) - (a._updatedAt || 0));
  if (!resumes.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon">📄</div>No resumes yet.<br>Tap + to add one.</div>`;
    return;
  }
  el.innerHTML = resumes.map(r => `
    <div class="wiki-card" data-type="resume" data-id="${esc(r.id)}">
      <div class="wiki-card-actions">
        <button class="wiki-action-btn" data-wiki-edit="resume" data-id="${esc(r.id)}" aria-label="Edit resume">Edit</button>
      </div>
      <div class="wiki-card-fg">
        <div class="wiki-card-title">${esc(r.title)}</div>
        <div class="wiki-card-meta">${esc(r.name || '')}</div>
      </div>
    </div>`).join('');
  attachWikiGestures(el);
}

function renderResumeDetail(id) {
  const el = document.getElementById('wikiSubContent-resume');
  if (!el) return;
  const resume = (wikiData.resumes || []).find(r => r.id === id);
  if (!resume) { closeWikiDetail(); return; }

  // Font options
  const fontOptions = [
    { value: 'Helvetica,Arial,sans-serif',      label: 'Helvetica / Arial (sans)' },
    { value: "Georgia,'Times New Roman',serif",  label: 'Georgia / Times (serif)' },
    { value: "'Courier New',monospace",          label: 'Courier (mono)' },
    { value: "'EB Garamond',serif",              label: 'EB Garamond' },
  ];
  const sizeOptions = ['10', '11', '12', '13'];
  const marginOptions = ['0.5cm', '1cm', '1.5cm', '2cm', '2.5cm', '3cm'];
  const curFont = resume.pdfFont || fontOptions[0].value;
  const curSize = resume.pdfSize || '11';
  const curMargin = resume.pdfMargin || '1.5cm';

  const fontSelect = `<select id="resumePdfFont" class="wiki-pdf-select" onchange="persistResumePdf('${esc(id)}')">
    ${fontOptions.map(f => `<option value="${esc(f.value)}"${f.value === curFont ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}
  </select>`;
  const sizeSelect = `<select id="resumePdfSize" class="wiki-pdf-select" onchange="persistResumePdf('${esc(id)}')">
    ${sizeOptions.map(s => `<option value="${s}"${s === curSize ? ' selected' : ''}>${s}pt</option>`).join('')}
  </select>`;
  const marginSelect = `<select id="resumePdfMargin" class="wiki-pdf-select" onchange="persistResumePdf('${esc(id)}')">
    ${marginOptions.map(m => `<option value="${m}"${m === curMargin ? ' selected' : ''}>${m}</option>`).join('')}
  </select>`;

  // Build experience section
  const expHtml = (resume.experience || []).map(exp => {
    const projHtml = (exp.projects || []).map(proj => {
      const pts = (proj.points || '').split('\n').filter(l => l.trim());
      return pts.length
        ? `<div class="wiki-exp-project"><div class="wiki-exp-proj-name">${esc(proj.name || '')}</div>
           <ul>${pts.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>`
        : (proj.name ? `<div class="wiki-exp-project"><div class="wiki-exp-proj-name">${esc(proj.name)}</div></div>` : '');
    }).join('');
    return `<div class="wiki-exp-block">
      <div class="wiki-exp-header">
        <span class="wiki-exp-company">${esc(exp.company || '')}</span>
        <span class="wiki-exp-period">${esc(exp.period || '')}</span>
      </div>
      ${projHtml}
    </div>`;
  }).join('');

  const skillLines = (resume.coreSkills || '').split('\n').filter(l => l.trim());
  const eduLines   = (resume.education || '').split('\n').filter(l => l.trim());

  el.innerHTML = `
    <div class="wiki-detail">
      ${wikiBackBtn()}
      <div class="wiki-detail-header">
        <h2 class="wiki-detail-title">${esc(resume.title)}</h2>
        <button class="btn btn-secondary wiki-detail-edit-btn" onclick="openResumeSheet('${esc(id)}')">Edit</button>
      </div>

      <div class="wiki-resume-view">
        <h1 class="wiki-resume-name">${esc(resume.name || '')}</h1>
        ${resume.contact ? `<p class="wiki-resume-contact">${esc(resume.contact)}</p>` : ''}

        ${resume.summary ? `<div class="wiki-detail-section">
          <div class="wiki-detail-section-title">Summary</div>
          <p>${esc(resume.summary)}</p>
        </div>` : ''}

        ${skillLines.length ? `<div class="wiki-detail-section">
          <div class="wiki-detail-section-title">Core Skills</div>
          <ul class="wiki-detail-list">${skillLines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
        </div>` : ''}

        ${expHtml ? `<div class="wiki-detail-section">
          <div class="wiki-detail-section-title">Experience</div>
          ${expHtml}
        </div>` : ''}

        ${eduLines.length ? `<div class="wiki-detail-section">
          <div class="wiki-detail-section-title">Education</div>
          <ul class="wiki-detail-list">${eduLines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
        </div>` : ''}
      </div>

      <div class="wiki-pdf-controls">
        <div class="wiki-pdf-row">
          <label class="wiki-pdf-label">Font</label>${fontSelect}
        </div>
        <div class="wiki-pdf-row">
          <label class="wiki-pdf-label">Size</label>${sizeSelect}
        </div>
        <div class="wiki-pdf-row">
          <label class="wiki-pdf-label">Margin</label>${marginSelect}
        </div>
        <button class="btn btn-primary wiki-pdf-btn" onclick="printResume('${esc(id)}')">🖨 Print / Save PDF</button>
      </div>
    </div>`;
}

function persistResumePdf(id) {
  const resume = (wikiData.resumes || []).find(r => r.id === id);
  if (!resume) return;
  const fontEl = document.getElementById('resumePdfFont');
  const sizeEl = document.getElementById('resumePdfSize');
  const marginEl = document.getElementById('resumePdfMargin');
  if (fontEl) resume.pdfFont = fontEl.value;
  if (sizeEl) resume.pdfSize = sizeEl.value;
  if (marginEl) resume.pdfMargin = marginEl.value;
  saveWiki(wikiData); saveData(data);
}

function printResume(id) {
  const resume = (wikiData.resumes || []).find(r => r.id === id);
  if (!resume) return;

  // Read + persist chosen font/size/margin
  const fontEl = document.getElementById('resumePdfFont');
  const sizeEl = document.getElementById('resumePdfSize');
  const marginEl = document.getElementById('resumePdfMargin');
  const font = (fontEl ? fontEl.value : resume.pdfFont) || 'Helvetica,Arial,sans-serif';
  const size = (sizeEl ? sizeEl.value : resume.pdfSize) || '11';
  const margin = (marginEl ? marginEl.value : resume.pdfMargin) || '1.5cm';
  if (fontEl) resume.pdfFont = font;
  if (sizeEl) resume.pdfSize = size;
  if (marginEl) resume.pdfMargin = margin;
  saveWiki(wikiData); saveData(data);

  // Build semantic HTML
  const expHtml = (resume.experience || []).map(exp => {
    const projHtml = (exp.projects || []).map(proj => {
      const pts = (proj.points || '').split('\n').filter(l => l.trim());
      return `<div class="rp-project">
        ${proj.name ? `<p class="rp-proj-name">${esc(proj.name)}</p>` : ''}
        ${pts.length ? `<ul>${pts.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      </div>`;
    }).join('');
    return `<div class="rp-exp">
      <div class="rp-exp-header">
        <span class="rp-company">${esc(exp.company || '')}</span>
        <span class="rp-period">${esc(exp.period || '')}</span>
      </div>
      ${projHtml}
    </div>`;
  }).join('');

  const skillLines = (resume.coreSkills || '').split('\n').filter(l => l.trim());
  const eduLines   = (resume.education || '').split('\n').filter(l => l.trim());

  const html = `
    <h1>${esc(resume.name || resume.title)}</h1>
    ${resume.contact ? `<p class="rp-contact">${esc(resume.contact)}</p>` : ''}
    ${resume.summary ? `<h2>Summary</h2><p>${esc(resume.summary)}</p>` : ''}
    ${skillLines.length ? `<h2>Core Skills</h2><ul>${skillLines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    ${expHtml ? `<h2>Experience</h2>${expHtml}` : ''}
    ${eduLines.length ? `<h2>Education</h2><ul>${eduLines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
  `;

  const root = document.getElementById('resumePrintRoot');
  root.innerHTML = html;
  root.style.setProperty('--resume-font', font);
  root.style.setProperty('--resume-size', size + 'pt');

  // Inject @page margin + zero out the element's own margin so only @page applies
  const styleEl = document.createElement('style');
  styleEl.id = 'rp-margin-style';
  styleEl.textContent = `@page { margin: ${margin}; } #resumePrintRoot { margin: 0 !important; }`;
  document.head.appendChild(styleEl);

  window.print();

  const cleanup = () => { styleEl.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
}

function openResumeSheet(id) {
  document.getElementById('resumeForm').reset();
  document.getElementById('resumeId').value = '';
  document.getElementById('resumeDeleteBtn').style.display = 'none';
  document.getElementById('resumeSheetTitle').textContent = 'Add Resume';
  document.getElementById('resumeExpEditor').innerHTML = '';

  if (id) {
    const resume = (wikiData.resumes || []).find(r => r.id === id);
    if (!resume) return;
    document.getElementById('resumeSheetTitle').textContent = 'Edit Resume';
    document.getElementById('resumeId').value = id;
    document.getElementById('resumeDocTitle').value = resume.title || '';
    document.getElementById('resumeName').value = resume.name || '';
    document.getElementById('resumeContact').value = resume.contact || '';
    document.getElementById('resumeSummary').value = resume.summary || '';
    document.getElementById('resumeCoreSkills').value = resume.coreSkills || '';
    document.getElementById('resumeEducation').value = resume.education || '';
    (resume.experience || []).forEach(exp => addResumeExpBlock(exp));
    document.getElementById('resumeDeleteBtn').style.display = '';
  }
  openSheet('resumeSheet');
  setTimeout(() => document.getElementById('resumeDocTitle').focus(), 350);
}

function addResumeExpBlock(exp) {
  const container = document.getElementById('resumeExpEditor');
  const block = document.createElement('div');
  block.className = 'wiki-exp-edit-block';
  const expId = (exp && exp.id) || uid();
  block.dataset.expId = expId;
  block.innerHTML = `
    <div class="wiki-exp-edit-header">
      <div class="wiki-editor-row" style="flex:1">
        <input type="text" class="wiki-editor-input wiki-exp-company" placeholder="Company" value="${esc(exp && exp.company || '')}">
        <input type="text" class="wiki-editor-input wiki-exp-period" placeholder="Period (e.g. 2020–2023)" value="${esc(exp && exp.period || '')}">
      </div>
      <button type="button" class="wiki-editor-remove wiki-exp-remove" onclick="this.closest('.wiki-exp-edit-block').remove()" aria-label="Remove experience">✕</button>
    </div>
    <div class="wiki-proj-editor"></div>
    <button type="button" class="wiki-add-proj-btn" onclick="addResumeProjRow(this)">+ Add project</button>`;
  container.appendChild(block);
  if (exp && exp.projects) {
    exp.projects.forEach(proj => addResumeProjRow(block.querySelector('.wiki-add-proj-btn'), proj));
  }
}

function addResumeProjRow(btnOrContainer, proj) {
  const btn = btnOrContainer.tagName === 'BUTTON' ? btnOrContainer : null;
  const projEditor = btn
    ? btn.previousElementSibling
    : btnOrContainer;
  const row = document.createElement('div');
  row.className = 'wiki-proj-edit-row';
  row.innerHTML = `
    <input type="text" class="wiki-editor-input wiki-proj-name" placeholder="Project name" value="${esc(proj && proj.name || '')}">
    <textarea class="wiki-editor-textarea wiki-proj-points" placeholder="Bullet points (one per line)…" rows="3">${esc(proj && proj.points || '')}</textarea>
    <button type="button" class="wiki-editor-remove" onclick="this.closest('.wiki-proj-edit-row').remove()" aria-label="Remove project">✕</button>`;
  projEditor.appendChild(row);
}

document.getElementById('resumeForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('resumeId').value;

  // Read experience blocks
  const experience = [];
  document.getElementById('resumeExpEditor').querySelectorAll('.wiki-exp-edit-block').forEach(block => {
    const company = block.querySelector('.wiki-exp-company').value.trim();
    const period  = block.querySelector('.wiki-exp-period').value.trim();
    const projects = [];
    block.querySelectorAll('.wiki-proj-edit-row').forEach(row => {
      const name   = row.querySelector('.wiki-proj-name').value.trim();
      const points = row.querySelector('.wiki-proj-points').value;
      if (name || points.trim()) projects.push({ name, points });
    });
    if (company || period || projects.length) {
      experience.push({ id: block.dataset.expId || uid(), company, period, projects });
    }
  });

  const resume = {
    id: id || uid(),
    title: document.getElementById('resumeDocTitle').value.trim(),
    name: document.getElementById('resumeName').value.trim(),
    contact: document.getElementById('resumeContact').value.trim(),
    summary: document.getElementById('resumeSummary').value,
    coreSkills: document.getElementById('resumeCoreSkills').value,
    experience,
    education: document.getElementById('resumeEducation').value,
    // preserve pdf prefs if editing
    pdfFont: (wikiData.resumes || []).find(r => r.id === id)?.pdfFont || '',
    pdfSize: (wikiData.resumes || []).find(r => r.id === id)?.pdfSize || '',
    pdfMargin: (wikiData.resumes || []).find(r => r.id === id)?.pdfMargin || '',
    _updatedAt: Date.now()
  };
  if (!resume.title) return;
  if (!wikiData.resumes) wikiData.resumes = [];
  if (id) {
    const idx = wikiData.resumes.findIndex(r => r.id === id);
    if (idx >= 0) wikiData.resumes[idx] = resume; else wikiData.resumes.push(resume);
  } else {
    wikiData.resumes.push(resume);
  }
  saveWiki(wikiData); saveData(data);
  closeSheet();
  if (wikiView && wikiView.type === 'resume') wikiView.id = resume.id;
  renderWiki();
  showToast(id ? 'Resume updated' : 'Resume saved');
});

function deleteResume() {
  const id = document.getElementById('resumeId').value;
  if (!id || !confirm('Delete this resume?')) return;
  if (!data._deletedIds) data._deletedIds = [];
  if (!data._deletedIds.includes(id)) data._deletedIds.push(id);
  wikiData.resumes = (wikiData.resumes || []).filter(r => r.id !== id);
  saveWiki(wikiData); saveData(data);
  closeSheet();
  wikiView = null;
  renderWiki();
  showToast('Resume deleted');
}
