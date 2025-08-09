/*
  Patience (13-column solitaire)
  - 52-card deck, deal into 13 columns face-up
  - Build foundations (A→K) by suit
  - Tableau builds descending by rank, alternating colors
  - Any card or correctly ordered stack can be moved between columns
  - Any card may be placed into an empty column
  - Undo last 5 moves, Redeal to start new game
*/

(function () {
  const NUM_COLUMNS = 10;
  const FOUNDATION_SUITS = ["S", "H", "D", "C"]; // Kept for suits/colors and assets
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

  const gameRoot = document.getElementById("gameRoot");
  const tableauArea = document.getElementById("tableauArea");
  const foundationArea = document.getElementById("foundationArea");
  const cardLayer = document.getElementById("cardLayer");
  const redealBtn = document.getElementById("redealBtn");
  const undoBtn = document.getElementById("undoBtn");
  const hintBtn = document.getElementById("hintBtn");
  const rulesTopBtn = document.getElementById("rulesTopBtn");
  const testWinBtn = document.getElementById("testWinBtn");
  const statusText = document.getElementById("statusText");

  /** Game State */
  /**
   * cards: { id, rankIndex, suit, color, columnIndex, stackIndex, topOfStack: boolean, foundation?: boolean }
   * tableau: Array<Array<cardId>> size 13; each entry is ordered bottom->top
   * foundations: { S: topRankIndex, H: number, D: number, C: number }
   * undoStack: Array<state snapshot> max len 5
   */
  let cardsById = new Map();
  let tableau = [];
  // Completed houses (each is an array of 13 card ids), and disabled columns
  let completedHouses = [];
  let completedColumns = new Set();
  // Remember last suggested hint to avoid back-and-forth loops
  let lastHintMove = null;
  let hintHistory = [];
  // Per-head anti-spam cooldown for hints (in hint calls)
  let hintHeadCooldown = new Map(); // cardId -> remaining calls to skip
  let isGameWon = false;
  let isDealing = false;
  let undoStack = [];

  // Layout metrics
  function getCardSize() {
    // Measure an existing card if available to sync with responsive CSS
    const sample = cardLayer.querySelector('.card');
    if (sample) {
      const rect = sample.getBoundingClientRect();
      const cardWidth = Math.round(rect.width);
      const cardHeight = Math.round(rect.height);
      return { cardWidth, cardHeight, overlap: Math.floor(cardHeight * 0.28) };
    }
    // Fallback to default CSS base size
    const cardWidth = 72;
    const cardHeight = 96;
    return { cardWidth, cardHeight, overlap: Math.floor(cardHeight * 0.28) };
  }

  function isRed(suit) { return suit === "H" || suit === "D"; }

  function createDeck() {
    const deck = [];
    let id = 0;
    for (const suit of FOUNDATION_SUITS) {
      for (let r = 0; r < RANKS.length; r++) {
        deck.push({
          id: String(id++),
          rankIndex: r,
          suit,
          color: isRed(suit) ? "R" : "B",
          foundation: false,
        });
      }
    }
    return deck;
  }

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  function saveUndoSnapshot() {
    const snapshot = {
      tableau: tableau.map(col => col.slice()),
      cards: Array.from(cardsById.entries()).map(([id, c]) => [id, { ...c }]),
      completedHouses: completedHouses.map(h => h.slice()),
      completedColumns: Array.from(completedColumns),
    };
    undoStack.push(snapshot);
    if (undoStack.length > 5) undoStack.shift();
    undoBtn.disabled = undoStack.length === 0;
  }

  function restoreSnapshot(snapshot) {
    tableau = snapshot.tableau.map(col => col.slice());
    cardsById = new Map(snapshot.cards.map(([id, c]) => [id, { ...c }]));
    completedHouses = snapshot.completedHouses ? snapshot.completedHouses.map(h => h.slice()) : [];
    completedColumns = new Set(snapshot.completedColumns || []);
    layoutAll();
    undoBtn.disabled = undoStack.length === 0;
    lastHintMove = null;
    hintHistory = [];
    hintHeadCooldown = new Map();
  }

  function dealNewGame() {
    undoStack = [];
    undoBtn.disabled = true;
    completedHouses = [];
    completedColumns = new Set();
    isGameWon = false;
    gameRoot.classList.remove('game-won');
    document.body.classList.remove('game-won');
    const confettiLayer = document.getElementById('confettiLayer');
    if (confettiLayer) confettiLayer.remove();
    const winClone = document.getElementById('winTitleClone');
    if (winClone) winClone.remove();
    const winOverlay = document.getElementById('winOverlay');
    if (winOverlay) winOverlay.remove();
    const headerTitle = document.querySelector('.topbar .title');
    if (headerTitle) headerTitle.style.opacity = '1';
    const bottomBar = document.querySelector('.bottombar');
    if (bottomBar) bottomBar.style.opacity = '';
    // Reset card map completely to avoid stale entries/styles
    cardsById = new Map();
    tableau = Array.from({ length: NUM_COLUMNS }, () => []);
    const deck = createDeck();
    shuffle(deck);
    // Fixed deal pattern: 8-8-8-7-6-5-4-3-2-1 across 10 columns
    const dealPattern = [8, 8, 8, 7, 6, 5, 4, 3, 2, 1];
    let deckIndex = 0;
    for (let col = 0; col < NUM_COLUMNS; col++) {
      const count = dealPattern[col] || 0;
      for (let i = 0; i < count; i++) {
        const card = deck[deckIndex++];
        cardsById.set(card.id, card);
        tableau[col].push(card.id);
      }
    }
    attachCardsToDOM();
    // Animate the initial deal
    animateInitialDeal();
    setStatus("Build descending stacks. Completed houses (K→A alt colors) auto-move.");
    lastHintMove = null;
    hintHistory = [];
    hintHeadCooldown = new Map();
  }

  function attachCardsToDOM() {
    // Clear old
    cardLayer.innerHTML = "";
    // Use foundation slots as origins if present
    const rootRect = gameRoot.getBoundingClientRect();
    const slots = Array.from(foundationArea.querySelectorAll('.foundation-slot'));
    const origins = slots.map((slot) => {
      const r = slot.getBoundingClientRect();
      return { left: r.left - rootRect.left + r.width / 2, top: r.top - rootRect.top + r.height / 2 };
    });
    let originIndex = 0;
    for (const [id, card] of cardsById.entries()) {
      const el = document.createElement("div");
      el.className = "card";
      el.dataset.id = id;
      el.draggable = false; // We implement pointer-based dragging
      // Set per-card SVG background
      el.style.backgroundImage = `url('${cardAssetUrl(card)}')`;
      el.setAttribute('aria-label', `${rankName(card.rankIndex)} of ${suitName(card.suit)}`);
      // mark for dealing animation
      el.classList.add('dealing');
      const { cardWidth, cardHeight } = getCardSize();
      if (origins.length > 0) {
        const o = origins[originIndex % origins.length];
        originIndex++;
        el.style.left = `${Math.round(o.left - cardWidth / 2)}px`;
        el.style.top = `${Math.round(o.top - cardHeight / 2)}px`;
      } else {
        // fallback to top center
        el.style.left = `${Math.round(rootRect.width / 2 - cardWidth / 2)}px`;
        el.style.top = `${-cardHeight - 20}px`;
      }
      cardLayer.appendChild(el);
    }
  }

  function suitName(suit) {
    return ({ S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' })[suit];
  }

  function rankName(rankIndex) {
    const r = RANKS[rankIndex];
    switch (r) {
      case 'A': return 'ace';
      case 'J': return 'jack';
      case 'Q': return 'queen';
      case 'K': return 'king';
      default: return r; // '2'..'10'
    }
  }

  function cardAssetUrl(card) {
    // Expected filenames like: 'ace_of_spades.svg', '2_of_hearts.svg', ... in 'SVG-cards-1.3/'
    const file = `${rankName(card.rankIndex)}_of_${suitName(card.suit)}.svg`;
    return `SVG-cards-1.3/${file}`;
  }

  function getColumnRects() {
    const columns = Array.from(tableauArea.querySelectorAll(".column"));
    return columns.map((col) => col.getBoundingClientRect());
  }

  function ensureColumnsExist() {
    if (tableauArea.children.length === NUM_COLUMNS) return;
    tableauArea.innerHTML = "";
    for (let i = 0; i < NUM_COLUMNS; i++) {
      const c = document.createElement("div");
      c.className = "column";
      c.dataset.col = String(i);
      tableauArea.appendChild(c);
    }
  }

  function layoutAll() {
    ensureColumnsExist();
    const rootRect = gameRoot.getBoundingClientRect();
    const colRects = getColumnRects();
    const { overlap, cardWidth } = getCardSize();

    // Position tableau cards
    for (let col = 0; col < NUM_COLUMNS; col++) {
      const ids = tableau[col];
      const baseLeft = colRects[col].left - rootRect.left + Math.round((colRects[col].width - cardWidth) / 2);
      const baseTop = colRects[col].top - rootRect.top + 6;
      ids.forEach((id, idx) => {
        const el = getCardEl(id);
        if (!el) return;
        if (!el.classList.contains('dealing')) {
          el.style.left = `${baseLeft}px`;
          el.style.top = `${baseTop + idx * overlap}px`;
        }
        el.style.zIndex = String(10 + idx);
      });
    }
    // Position completed houses in foundation area slots (display only)
    const slots = Array.from(foundationArea.querySelectorAll('.foundation-slot'));
    completedHouses.forEach((houseIds, i) => {
      const slotEl = slots[i];
      if (!slotEl) return;
      const rect = slotEl.getBoundingClientRect();
      const left = rect.left - rootRect.left + Math.round((rect.width - cardWidth) / 2);
      const top = rect.top - rootRect.top + 6;
      houseIds.forEach((id, idx) => {
        const el = getCardEl(id);
        if (!el) return;
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.zIndex = String(1000 + i * 20 + idx);
      });
    });
  }

  function animateInitialDeal() {
    isDealing = true;
    // Ensure columns exist and compute latest rects after any layout changes
    ensureColumnsExist();
    const { overlap, cardWidth } = getCardSize();
    const perCardDelay = 20; // ms
    const flyDuration = 420;
    const rootRect = gameRoot.getBoundingClientRect();
    const colRects = getColumnRects();
    // compute targets for each card id
    const targets = new Map();
    for (let c = 0; c < NUM_COLUMNS; c++) {
      const ids = tableau[c];
      const baseLeft = colRects[c].left - rootRect.left + Math.round((colRects[c].width - cardWidth) / 2);
      const baseTop = colRects[c].top - rootRect.top + 6;
      ids.forEach((id, idx) => {
        targets.set(id, { left: baseLeft, top: baseTop + idx * overlap });
      });
    }
    const allIds = [];
    tableau.forEach(col => col.forEach(id => allIds.push(id)));
    allIds.forEach((id, i) => {
      const el = getCardEl(id);
      const t = targets.get(id);
      if (!el || !t) return;
      const delay = i * perCardDelay;
      setTimeout(() => {
        const angle = (Math.random() - 0.5) * 8; // -4..4 deg
        el.style.transition = `left ${flyDuration}ms cubic-bezier(.22,.61,.36,1), top ${flyDuration}ms cubic-bezier(.22,.61,.36,1), transform ${flyDuration}ms ease`;
        el.style.left = `${t.left}px`;
        el.style.top = `${t.top}px`;
        el.style.transform = `rotate(${angle}deg)`;
        setTimeout(() => {
          el.classList.remove('dealing');
          el.style.transition = '';
          el.style.transform = '';
          if (i === allIds.length - 1) {
            isDealing = false;
          }
        }, flyDuration + 40);
      }, delay);
    });
  }

  function gatherCardsToPiles(onDone) {
    // Use current tableau order to control z-order so earlier cards fly under later ones
    const orderedIds = [];
    tableau.forEach(col => col.forEach(id => orderedIds.push(id)));
    const cards = orderedIds.map(getCardEl).filter(Boolean);
    if (cards.length === 0) { onDone && onDone(); return; }
    isDealing = true;
    const rootRect = gameRoot.getBoundingClientRect();
    const slots = Array.from(foundationArea.querySelectorAll('.foundation-slot'));
    const { cardWidth, cardHeight } = getCardSize();
    const origins = slots.length > 0
      ? slots.map((slot) => {
          const r = slot.getBoundingClientRect();
          return { left: r.left - rootRect.left + r.width / 2, top: r.top - rootRect.top + r.height / 2 };
        })
      : [{ left: rootRect.width / 2, top: 20 }];
    const perCardDelay = 6;
    const dur = 320;
    let doneCount = 0;
    cards.forEach((el, i) => {
      const o = origins[i % origins.length];
      const left = Math.round(o.left - cardWidth / 2);
      const top = Math.round(o.top - cardHeight / 2);
      const delay = i * perCardDelay;
      setTimeout(() => {
        el.style.transition = `left ${dur}ms cubic-bezier(.22,.61,.36,1), top ${dur}ms cubic-bezier(.22,.61,.36,1), transform ${dur}ms ease`;
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.transform = 'rotate(0deg)';
        el.style.zIndex = String(3000 + i);
        setTimeout(() => {
          doneCount++;
          if (doneCount === cards.length) {
            isDealing = false;
            setTimeout(() => onDone && onDone(), 40);
          }
        }, dur + 20);
      }, delay);
    });
  }

  function getCardEl(id) { return cardLayer.querySelector(`.card[data-id="${id}"]`); }

  // findCardId removed; not needed for completed houses

  // Rules
  function canStack(upperCard, lowerCard) {
    // upperCard goes on top of lowerCard in tableau
    if (!lowerCard) return true; // empty column allows any
    const ranksDescending = upperCard.rankIndex === lowerCard.rankIndex - 1;
    const colorsAlternate = upperCard.color !== lowerCard.color;
    return ranksDescending && colorsAlternate;
  }

  // No manual foundation moves

  // Drag logic
  let dragState = null;
  function onPointerDown(e) {
    if (isDealing) return; // disable interactions while dealing
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;
    e.preventDefault();
    cardLayer.setPointerCapture?.(e.pointerId);
    const id = cardEl.dataset.id;
    // Determine the stack from this card upward within its column
    const { columnIndex, stackIndex } = findCardLocation(id);
    if (columnIndex == null) return; // ignore foundation top for dragging

    // Build moving stack IDs
    const movingIds = tableau[columnIndex].slice(stackIndex);
    const movingCards = movingIds.map((cid) => cardsById.get(cid));
    // Verify the moving stack is correctly ordered
    for (let i = 1; i < movingCards.length; i++) {
      if (!canStack(movingCards[i], movingCards[i - 1])) return; // illegal pick
    }

    const startPositions = movingIds.map((cid) => {
      const el = getCardEl(cid);
      return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
    });

    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      movingIds,
      fromColumn: columnIndex,
      startPositions,
    };

    // Raise z-index and add dragging style
    movingIds.forEach((cid, i) => {
      const el = getCardEl(cid);
      el.classList.add('dragging');
      el.style.zIndex = String(2000 + i);
    });

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { once: true });
  }

  function onPointerMove(e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    const { overlap } = getCardSize();
    dragState.movingIds.forEach((cid, i) => {
      const el = getCardEl(cid);
      el.style.left = `${dragState.startPositions[i].left + dx}px`;
      el.style.top = `${dragState.startPositions[i].top + dy + i * overlap}px`;
    });
  }

  function onPointerUp(e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;

    // Determine best drop target using the pointer position for more forgiving drops
    const drop = findBestDropTarget(e.clientX, e.clientY);
    if (drop) {
      let moved = false;
      if (drop.type === 'column') {
        moved = performMoveToColumn(dragState.fromColumn, drop.colIndex, dragState.movingIds);
      }
      if (moved) checkWin();
    }

    // Reset visuals
    dragState.movingIds.forEach((cid) => {
      const el = getCardEl(cid);
      el.classList.remove('dragging');
    });
    dragState = null;
    layoutAll();

    window.removeEventListener('pointermove', onPointerMove);
  }

  function rectContains(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function findBestDropTarget(clientX, clientY) {
    const x = clientX;
    const y = clientY;

    // Otherwise check tableau columns
    const columns = Array.from(tableauArea.querySelectorAll('.column'));
    for (let i = 0; i < columns.length; i++) {
      if (completedColumns.has(i)) continue;
      const rect = columns[i].getBoundingClientRect();
      if (rectContains(rect, x, y)) return { type: 'column', colIndex: i };
    }

    // If not directly over a column, snap to the nearest column horizontally within a margin
    const snapMargin = 60;
    let bestIndex = -1;
    let bestDist = Infinity;
    for (let i = 0; i < columns.length; i++) {
      if (completedColumns.has(i)) continue;
      const rect = columns[i].getBoundingClientRect();
      const dx = x < rect.left ? rect.left - x : (x > rect.right ? x - rect.right : 0);
      const dy = y < rect.top ? rect.top - y : (y > rect.bottom ? y - rect.bottom : 0);
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) { bestDist = dist; bestIndex = i; }
    }
    if (bestIndex !== -1 && bestDist <= snapMargin) {
      return { type: 'column', colIndex: bestIndex };
    }
    return null;
  }

  function performMoveToColumn(fromCol, toCol, movingIds) {
    if (fromCol === toCol) return false;
    const from = tableau[fromCol];
    const to = tableau[toCol];
    const movingCards = movingIds.map((id) => cardsById.get(id));

    // Validate move against top of target column (or empty)
    const targetTopId = to[to.length - 1];
    const targetTopCard = targetTopId != null ? cardsById.get(targetTopId) : null;
    if (!canStack(movingCards[0], targetTopCard)) {
      // Revert layout only
      layoutAll();
      return false;
    }

    // Save snapshot and execute move
    saveUndoSnapshot();
    tableau[fromCol] = from.slice(0, from.length - movingIds.length);
    tableau[toCol] = to.concat(movingIds);
    // Auto-complete check on both columns
    maybeAutoCompleteColumn(fromCol);
    maybeAutoCompleteColumn(toCol);
    lastHintMove = null;
    hintHistory = [];
    hintHeadCooldown = new Map();
    return true;
  }

  // Detect and move a completed house (column of exactly 13 cards K→A alternating colors)
  function maybeAutoCompleteColumn(colIndex) {
    if (completedColumns.has(colIndex)) return;
    const ids = tableau[colIndex];
    if (ids.length !== 13) return;
    // Validate K..A with alternating colors from bottom to top
    const bottom = cardsById.get(ids[0]);
    if (bottom.rankIndex !== 12) return; // must start with King
    for (let i = 1; i < 13; i++) {
      const up = cardsById.get(ids[i]);
      const low = cardsById.get(ids[i - 1]);
      if (!canStack(up, low)) return;
    }
    const top = cardsById.get(ids[12]);
    if (top.rankIndex !== 0) return; // must end with Ace
    // Move to completed houses
    completedHouses.push(ids.slice());
    tableau[colIndex] = [];
    completedColumns.add(colIndex);
    // Mark DOM column as completed
    const colEl = tableauArea.querySelector(`.column[data-col="${colIndex}"]`);
    if (colEl) colEl.classList.add('completed');
    layoutAll();
  }

  function findCardLocation(id) {
    for (let c = 0; c < NUM_COLUMNS; c++) {
      const idx = tableau[c].indexOf(id);
      if (idx !== -1) {
        return { columnIndex: c, stackIndex: idx };
      }
    }
    return { columnIndex: null, stackIndex: null };
  }

  function setStatus(text) {
    statusText.textContent = text;
  }

  function checkWin() {
    if (isGameWon) return;
    const allComplete = completedHouses.length === 4;
    if (allComplete) {
      isGameWon = true;
      celebrateWin();
    }
  }

  function celebrateWin() {
    setStatus("You win! 🎉");
    // Fade out tableau
    gameRoot.classList.add('game-won');
    document.body.classList.add('game-won');
    // Hide all cards while we show overlay
    const allEls = Array.from(cardLayer.querySelectorAll('.card'));
    allEls.forEach(el => { el.style.opacity = '0'; el.style.transform = 'rotate(0deg)'; });
    // Fade out header title, then show centered overlay
    const headerTitle = document.querySelector('.topbar .title');
    if (headerTitle) headerTitle.style.opacity = '0';
    showWinOverlay();
    // Remove columns after fade
    setTimeout(() => { tableauArea.innerHTML = ''; }, 600);
    // Fire confetti
    spawnConfetti();
  }

  function getAceIds() {
    const ids = [];
    for (const suit of FOUNDATION_SUITS) {
      for (const [id, c] of cardsById.entries()) {
        if (c.suit === suit && c.rankIndex === 0) { ids.push(id); break; }
      }
    }
    return ids;
  }

  // animateWinTitle removed in favor of simple fade-out/in

  function showWinOverlay() {
    let overlay = document.getElementById('winOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'winOverlay';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = '';
    const pre = document.createElement('div');
    pre.className = 'win-pretitle';
    pre.textContent = 'YOU HAVE BEATEN';
    const title = document.createElement('div');
    title.className = 'win-title';
    const text = 'PATIENCE';
    const aceId = getRandomAceId(getAceIds());
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === 'A') {
        const ace = document.createElement('span');
        ace.className = 'win-ace';
        let card = aceId ? cardsById.get(aceId) : null;
        let suit = card ? card.suit : FOUNDATION_SUITS[Math.floor(Math.random() * FOUNDATION_SUITS.length)];
        setAceBackground(ace, suit);
        attachAceSwapHandler(ace);
        title.appendChild(ace);
      } else {
        const span = document.createElement('span');
        span.textContent = ch;
        title.appendChild(span);
      }
    }
    const actions = document.createElement('div');
    actions.className = 'win-actions';
    const redealClone = redealBtn.cloneNode(true);
    redealClone.id = 'redealBtnWin';
    const testWinClone = null; // hide test win after real win
    // Ensure handlers attached
    redealClone.addEventListener('click', () => redealBtn.click());
    actions.appendChild(redealClone);
    overlay.appendChild(pre);
    overlay.appendChild(title);
    overlay.appendChild(actions);
    // fade in
    requestAnimationFrame(() => {
      pre.classList.add('visible');
      title.classList.add('visible');
      actions.classList.add('visible');
      // Add idle bounce to ace
      const aceInTitle = title.querySelector('.win-ace');
      if (aceInTitle) aceInTitle.classList.add('ace-idle');
    });
  }

  // Landing overlay at app start
  function showLandingOverlay() {
    let overlay = document.getElementById('winOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'winOverlay';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'win-title visible';
    // Show brand with random Ace
    const text = 'PATIENCE';
    const aceId = getRandomAceId(getAceIds());
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === 'A') {
        const ace = document.createElement('span');
        ace.className = 'win-ace';
        let card = aceId ? cardsById.get(aceId) : null;
        let suit = card ? card.suit : FOUNDATION_SUITS[Math.floor(Math.random() * FOUNDATION_SUITS.length)];
        setAceBackground(ace, suit);
        attachAceSwapHandler(ace);
        title.appendChild(ace);
      } else {
        const span = document.createElement('span');
        span.textContent = ch;
        title.appendChild(span);
      }
    }
    const subtitle = document.createElement('div');
    subtitle.className = 'win-pretitle visible';
    subtitle.textContent = 'A solitaire-like patience game';

    const actions = document.createElement('div');
    actions.className = 'win-actions visible';
    const startBtn = document.createElement('button');
    startBtn.className = 'btn';
    startBtn.textContent = 'Start Game';
    const rulesBtn = document.createElement('button');
    rulesBtn.className = 'btn';
    rulesBtn.textContent = 'Rules';
    actions.appendChild(startBtn);
    actions.appendChild(rulesBtn);

    overlay.appendChild(subtitle);
    overlay.appendChild(title);
    overlay.appendChild(actions);

    // Dim UI
    document.body.classList.add('game-won');

    startBtn.addEventListener('click', () => {
      // Remove overlay and start game
      document.body.classList.remove('game-won');
      document.body.classList.remove('booting');
      overlay.remove();
      dealNewGame();
    });

    rulesBtn.addEventListener('click', () => {
      showRulesModal();
    });
  }

  function setAceBackground(aceEl, suit) {
    aceEl.dataset.suit = suit;
    const card = { rankIndex: 0, suit };
    aceEl.style.backgroundImage = `url('${cardAssetUrl(card)}')`;
    aceEl.title = 'Click to change Ace';
    aceEl.setAttribute('role', 'button');
    aceEl.setAttribute('tabindex', '0');
  }

  function attachAceSwapHandler(aceEl) {
    const swap = () => {
      const current = aceEl.dataset.suit || FOUNDATION_SUITS[0];
      let next;
      const options = FOUNDATION_SUITS.filter(s => s !== current);
      next = options[Math.floor(Math.random() * options.length)];
      setAceBackground(aceEl, next);
      // Ensure bounce animation is visible even when idle animation is active
      const hadIdle = aceEl.classList.contains('ace-idle');
      if (hadIdle) aceEl.classList.remove('ace-idle');
      aceEl.classList.remove('ace-bounce');
      // force reflow to restart animation
      void aceEl.offsetWidth;
      aceEl.classList.add('ace-bounce');
      // After bounce, restore idle only on win screen
      setTimeout(() => {
        aceEl.classList.remove('ace-bounce');
        if (document.body.classList.contains('game-won')) {
          aceEl.classList.add('ace-idle');
        }
      }, 540);
    };
    aceEl.addEventListener('click', swap);
    aceEl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        swap();
      }
    });
  }

  function showRulesModal() {
    let modal = document.getElementById('rulesModal');
    if (modal) { modal.remove(); }
    modal = document.createElement('div');
    modal.id = 'rulesModal';
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal">
        <h2>How to Play</h2>
        <ul>
          <li>There are 10 columns. Cards build down by rank, alternating colors.</li>
          <li>Move single cards or ordered stacks between columns.</li>
          <li>Any card can be placed in an empty column.</li>
          <li>When a column has a perfect K→A alternating sequence (13 cards), it auto-completes.</li>
          <li>Complete all 4 houses to win.</li>
        </ul>
        <div class="modal-actions">
          <button id="closeRulesBtn" class="btn">Close</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('closeRulesBtn').addEventListener('click', () => modal.remove());
  }

  function getRandomAceId(aceIds) {
    if (!aceIds || aceIds.length === 0) return null;
    const idx = Math.floor(Math.random() * aceIds.length);
    return aceIds[idx];
  }

  function spawnConfetti() {
    let layer = document.getElementById('confettiLayer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'confettiLayer';
      document.body.appendChild(layer);
    }
    const width = window.innerWidth;
    const colors = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#ffffff'];
    const count = 120;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti';
      const size = 6 + Math.random() * 6;
      piece.style.width = `${size}px`;
      piece.style.height = `${size * 1.6}px`;
      piece.style.left = `${Math.random() * width}px`;
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      const dur = 2.5 + Math.random() * 2.5;
      const delay = Math.random() * 0.8;
      piece.style.animationDuration = `${dur}s`;
      piece.style.animationDelay = `${delay}s`;
      layer.appendChild(piece);
      // cleanup
      setTimeout(() => { piece.remove(); }, (dur + delay) * 1000 + 500);
    }
    // remove layer after a while if empty
    setTimeout(() => { if (layer && layer.children.length === 0) layer.remove(); }, 6000);
  }

  // Hint system: smart search for best long-term move using shallow lookahead + heuristic
  function isInverseOfLast(move) {
    if (!lastHintMove) return false;
    if (move.type !== 'toColumn' || lastHintMove.type !== 'toColumn') return false;
    const sameHead = move.movingIds && lastHintMove.movingIds && move.movingIds[0] === lastHintMove.movingIds[0];
    const reversedCols = move.fromCol === lastHintMove.toCol && move.toCol === lastHintMove.fromCol;
    return sameHead && reversedCols;
  }

  function isCyclicWithHistory(move) {
    if (move.type !== 'toColumn') return false;
    // Check recent window (last 8 entries) for inverse or repeated oscillation, regardless of head
    const window = hintHistory.slice(-8);
    let samePairCount = 0;
    for (const h of window) {
      // inverse pair regardless of head
      if (h.from === move.toCol && h.to === move.fromCol) return true;
      if (h.from === move.fromCol && h.to === move.toCol) samePairCount++;
      if (samePairCount >= 2) return true; // suggested too often
    }
    return false;
  }

  function enumerateMoves(state) {
    const moves = [];
    for (let from = 0; from < NUM_COLUMNS; from++) {
      if (state.completedColumns.has(from)) continue;
      const ids = state.tableau[from];
      for (let start = 0; start < ids.length; start++) {
        const movingIds = ids.slice(start);
        if (!isValidOrderedStackWithState(state, movingIds)) continue;
        const head = cardsById.get(movingIds[0]);
        for (let to = 0; to < NUM_COLUMNS; to++) {
          if (to === from || state.completedColumns.has(to)) continue;
          const toIds = state.tableau[to];
          const topId = toIds[toIds.length - 1];
          const topCard = topId != null ? cardsById.get(topId) : null;
          if (canStack(head, topCard)) {
            moves.push({ type: 'toColumn', fromCol: from, toCol: to, movingIds, length: movingIds.length });
          }
        }
      }
    }
    return moves;
  }

  function isValidOrderedStackWithState(state, ids) {
    if (ids.length === 0) return false;
    for (let i = 1; i < ids.length; i++) {
      const up = cardsById.get(ids[i]);
      const low = cardsById.get(ids[i - 1]);
      if (!canStack(up, low)) return false;
    }
    return true;
  }

  function cloneTableau(tableau) {
    return tableau.map(col => col.slice());
  }

  function simulateMove(state, move) {
    const newState = {
      tableau: cloneTableau(state.tableau),
      completedColumns: new Set(Array.from(state.completedColumns)),
      completedCount: state.completedCount || 0,
    };
    const from = newState.tableau[move.fromCol];
    const to = newState.tableau[move.toCol];
    newState.tableau[move.fromCol] = from.slice(0, from.length - move.movingIds.length);
    newState.tableau[move.toCol] = to.concat(move.movingIds);
    // Auto-complete on both columns in simulated state
    newState.completedCount += autoCompleteInState(newState, move.fromCol);
    newState.completedCount += autoCompleteInState(newState, move.toCol);
    return newState;
  }

  function autoCompleteInState(state, colIndex) {
    if (state.completedColumns.has(colIndex)) return 0;
    const ids = state.tableau[colIndex];
    if (ids.length !== 13) return 0;
    const bottom = cardsById.get(ids[0]);
    if (bottom.rankIndex !== 12) return 0;
    for (let i = 1; i < 13; i++) {
      const up = cardsById.get(ids[i]);
      const low = cardsById.get(ids[i - 1]);
      if (!canStack(up, low)) return 0;
    }
    const top = cardsById.get(ids[12]);
    if (top.rankIndex !== 0) return 0;
    state.completedColumns.add(colIndex);
    state.tableau[colIndex] = [];
    return 1;
  }

  function scoreState(state) {
    // Heuristic: prioritize completed houses, long bottom-to-top chains, and available empties
    let score = 0;
    const completed = state.completedCount || 0;
    score += completed * 100000; // very high weight
    for (let c = 0; c < NUM_COLUMNS; c++) {
      if (state.completedColumns.has(c)) continue;
      const ids = state.tableau[c];
      // length of valid chain from bottom
      let chain = 0;
      for (let i = 1; i <= ids.length; i++) {
        if (i === 1) { chain = 1; continue; }
        const up = cardsById.get(ids[i - 1]);
        const low = cardsById.get(ids[i - 2]);
        if (canStack(up, low)) chain++; else break;
      }
      score += chain * chain * 10; // quadratic reward
      if (ids.length === 0) score += 50; // empty space bonus
      // bonus if bottom is King (correct start for house)
      if (ids.length > 0 && cardsById.get(ids[0]).rankIndex === 12) score += 30;
    }
    return score;
  }

  // ===== New Hint System (from scratch) =====
  function stateSignature(state) {
    return state.tableau.map(col => col.join(',')).join('|') + `#${Array.from(state.completedColumns).join(',')}`;
  }

  function evaluateState(state) {
    // Strong focus on completions and mobility, discourage fragmentation
    let score = 0;
    const completed = state.completedCount || 0;
    score += completed * 100000;
    let emptyCols = 0;
    for (let c = 0; c < NUM_COLUMNS; c++) {
      if (state.completedColumns.has(c)) continue;
      const ids = state.tableau[c];
      if (ids.length === 0) { emptyCols++; continue; }
      // chain strength from bottom
      let chain = 1;
      for (let i = 1; i < ids.length; i++) {
        const up = cardsById.get(ids[i]);
        const low = cardsById.get(ids[i - 1]);
        if (canStack(up, low)) chain++; else break;
      }
      score += chain * chain * 15;
      // penalty for short top fragments
      const topLen = Math.min(3, ids.length);
      for (let i = 0; i < topLen - 1; i++) {
        const a = cardsById.get(ids[ids.length - 1 - i]);
        const b = cardsById.get(ids[ids.length - 2 - i]);
        if (!canStack(a, b)) score -= 8; else score += 4;
      }
      // reward King at bottom (good for house start)
      if (cardsById.get(ids[0]).rankIndex === 12) score += 40;
    }
    score += emptyCols * 60;
    return score;
  }

  function legalMoves(state) {
    const moves = [];
    for (let from = 0; from < NUM_COLUMNS; from++) {
      if (state.completedColumns.has(from)) continue;
      const ids = state.tableau[from];
      for (let start = 0; start < ids.length; start++) {
        const movingIds = ids.slice(start);
        if (!isValidOrderedStackWithState(state, movingIds)) continue;
        const head = cardsById.get(movingIds[0]);
        for (let to = 0; to < NUM_COLUMNS; to++) {
          if (to === from || state.completedColumns.has(to)) continue;
          const toIds = state.tableau[to];
          const topId = toIds[toIds.length - 1];
          const topCard = topId != null ? cardsById.get(topId) : null;
          if (canStack(head, topCard)) {
            moves.push({ type: 'toColumn', fromCol: from, toCol: to, movingIds, length: movingIds.length });
          }
        }
      }
    }
    return moves;
  }

  function bestHintWithSearch(timeBudgetMs = 18, depthLimit = 3, beamWidth = 8) {
    const start = (self.performance && performance.now) ? performance.now() : Date.now();
    const initial = { tableau: cloneTableau(tableau), completedColumns: new Set(completedColumns), completedCount: completedHouses.length };
    const baseScore = evaluateState(initial);
    let bestFirstMove = null;
    let bestScore = -Infinity;
    const frontier = [];
    const seen = new Set([stateSignature(initial)]);
    const firstMoves = legalMoves(initial);
    // Order by quick heuristic
    firstMoves.sort((a, b) => (b.length - a.length) + ((initial.tableau[b.toCol].length === 0) - (initial.tableau[a.toCol].length === 0)));
    for (const m of firstMoves.slice(0, beamWidth)) {
      frontier.push({ state: simulateMove(initial, m), first: m, depth: 1 });
    }
    // Evaluate frontier nodes and iterate with beam search
    while (frontier.length > 0) {
      // time budget
      const now = (self.performance && performance.now) ? performance.now() : Date.now();
      if (now - start > timeBudgetMs) break;
      // Pick and expand best few
      frontier.sort((a, b) => evaluateState(b.state) - evaluateState(a.state));
      const batch = frontier.splice(0, Math.min(frontier.length, beamWidth));
      for (const node of batch) {
        const score = evaluateState(node.state);
        if (score > bestScore) { bestScore = score; bestFirstMove = node.first; }
        if (node.depth >= depthLimit) continue;
        const moves = legalMoves(node.state);
        // Order children quickly
        moves.sort((a, b) => b.length - a.length);
        for (const mv of moves.slice(0, beamWidth)) {
          const next = simulateMove(node.state, mv);
          const sig = stateSignature(next);
          if (seen.has(sig)) continue;
          seen.add(sig);
          frontier.push({ state: next, first: node.first, depth: node.depth + 1 });
        }
      }
    }
    // Require improvement threshold to avoid loops
    if (bestFirstMove) {
      const improved = bestScore > baseScore + 1;
      if (!improved) return null;
    }
    return bestFirstMove;
  }

  function findHint() {
    // Use the new search-based system
    const move = bestHintWithSearch(22, 3, 8);
    return move || null;
  }

  function isValidOrderedStack(ids) {
    if (ids.length === 0) return false;
    for (let i = 1; i < ids.length; i++) {
      const up = cardsById.get(ids[i]);
      const low = cardsById.get(ids[i - 1]);
      if (!canStack(up, low)) return false;
    }
    return true;
  }

  function flashHint(move) {
    if (!move) {
      setStatus('No moves found.');
      return;
    }
    // toColumn: highlight moving stack head and destination column
    const stackEls = move.movingIds.map(id => getCardEl(id)).filter(Boolean);
    const toColEl = tableauArea.querySelector(`.column[data-col="${move.toCol}"]`);
    stackEls.forEach(el => el.classList.add('hint-glow'));
    if (toColEl) toColEl.classList.add('hint-glow');
    setTimeout(() => {
      stackEls.forEach(el => el && el.classList.remove('hint-glow'));
      toColEl && toColEl.classList.remove('hint-glow');
    }, 1000);
    setStatus('Hint: Move stack');
    lastHintMove = move;
    // Track history (cap at 12 entries)
    if (move.type === 'toColumn') {
      hintHistory.push({ head: move.movingIds[0], from: move.fromCol, to: move.toCol });
      if (hintHistory.length > 12) hintHistory.shift();
      // Add head cooldown to reduce re-suggesting same head: 3-hint cooldown
      hintHeadCooldown.set(move.movingIds[0], 3);
    }
  }

  // Buttons
  redealBtn.addEventListener('click', () => {
    if (isDealing) return;
    gatherCardsToPiles(() => {
      dealNewGame();
    });
  });

  undoBtn.addEventListener('click', () => {
    const snapshot = undoStack.pop();
    if (!snapshot) return;
    restoreSnapshot(snapshot);
  });

  let hintConfirmArmed = false;
  hintBtn.addEventListener('click', () => {
    if (!hintConfirmArmed) {
      hintConfirmArmed = true;
      hintBtn.textContent = 'Sure?';
      hintBtn.classList.add('btn-warn');
      // auto-timeout disarm after 3s
      clearTimeout(hintBtn._disarmTimer);
      hintBtn._disarmTimer = setTimeout(() => {
        hintConfirmArmed = false;
        hintBtn.textContent = 'Hint';
        hintBtn.classList.remove('btn-warn');
      }, 3000);
      return;
    }
    hintConfirmArmed = false;
    hintBtn.textContent = 'Hint';
    hintBtn.classList.remove('btn-warn');
    const move = findHint();
    flashHint(move);
  });

  if (rulesTopBtn) {
    rulesTopBtn.addEventListener('click', () => {
      showRulesModal();
    });
  }

  // Testing: preview win state and animations
  if (testWinBtn) {
    testWinBtn.addEventListener('click', () => {
      // If already won, just re-trigger confetti
      if (isGameWon) { spawnConfetti(); return; }
      document.body.classList.add('game-won');
      // Synthesize four completed houses using existing cards if possible.
      // Strategy: for up to 4 non-empty columns with >=13 cards, take bottom 13 as completed.
      completedHouses = [];
      completedColumns = new Set();
      const candidates = [];
      for (let c = 0; c < NUM_COLUMNS; c++) {
        if (tableau[c].length >= 13) candidates.push(c);
      }
      while (completedHouses.length < 4 && candidates.length > 0) {
        const col = candidates.shift();
        const ids = tableau[col].slice(0, 13);
        if (ids.length < 13) break;
        completedHouses.push(ids);
        tableau[col] = tableau[col].slice(13);
        completedColumns.add(col);
      }
      // If not enough long columns, just pick any 13 cards from deck order to show visual
      if (completedHouses.length < 4) {
        const allIds = Array.from(cardsById.keys());
        let idx = 0;
        while (completedHouses.length < 4 && idx + 13 <= allIds.length) {
          completedHouses.push(allIds.slice(idx, idx + 13));
          idx += 13;
        }
      }
      isGameWon = true;
      celebrateWin();
    });
  }

  // Pointer events
  cardLayer.addEventListener('pointerdown', onPointerDown);

  // Initial DOM preparation
  ensureColumnsExist();
  showLandingOverlay();

  // Handle window resize relayout
  window.addEventListener('resize', () => {
    layoutAll();
  });
})();


