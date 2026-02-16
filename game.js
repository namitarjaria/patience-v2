/*
  Patience (10-column solitaire)
  - 52-card deck, deal into 10 columns face-up
  - Build foundations (A→K) by suit
  - Tableau builds descending by rank, alternating colors
  - Any card or correctly ordered stack can be moved between columns
  - Any card may be placed into an empty column
  - Undo last 5 moves, Redeal to start new game
*/

(function () {
  // === CONSTANTS ===
  const NUM_COLUMNS = 10;
  const FOUNDATION_SUITS = ["S", "H", "D", "C"];
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  
  // Animation & timing constants
  const DEAL_CARD_DELAY_MS = 20;
  const DEAL_FLY_DURATION_MS = 420;
  const GATHER_CARD_DELAY_MS = 6;
  const GATHER_FLY_DURATION_MS = 320;
  const HINT_GLOW_DURATION_MS = 1000;
  const HINT_CONFIRM_TIMEOUT_MS = 3000;
  const MAX_UNDO_STACK = 5;
  
  // Layout constants
  const CARD_OVERLAP_RATIO = 0.28;
  const SNAP_MARGIN_PX = 60;
  
  // Performance: Debounce time for resize
  const RESIZE_DEBOUNCE_MS = 150;

  // === DOM REFERENCES (cached for performance) ===
  const gameRoot = document.getElementById("gameRoot");
  const tableauArea = document.getElementById("tableauArea");
  const foundationArea = document.getElementById("foundationArea");
  const cardLayer = document.getElementById("cardLayer");
  const redealBtn = document.getElementById("redealBtn");
  const undoBtn = document.getElementById("undoBtn");
  const hintBtn = document.getElementById("hintBtn");
  const rulesTopBtn = document.getElementById("rulesTopBtn");
  const testWinBtn = document.getElementById("testWinBtn");
  const foundationsBtn = document.getElementById("foundationsBtn");
  const foundationsModal = document.getElementById("foundationsModal");
  const foundationsGrid = document.getElementById("foundationsGrid");
  const statusText = document.getElementById("statusText");
  const redealCountdownOverlay = document.getElementById("redealCountdownOverlay");
  const redealCountdownNumber = document.getElementById("redealCountdownNumber");

  // === GAME STATE ===
  let cardsById = new Map();
  let cardElementsById = new Map(); // Cache of card DOM elements for performance
  let tableau = [];
  let completedHouses = [];
  let completedColumns = new Set();
  let lastHintMove = null;
  let hintHistory = [];
  let hintHeadCooldown = new Map();
  let isGameWon = false;
  let isDealing = false;
  let undoStack = [];
  let redealCountdownShownThisGame = false;

  // Layout cache (updated on resize)
  let layoutCache = {
    cardWidth: 72,
    cardHeight: 98,
    overlap: 27,
    columnRects: [],
    rootRect: null,
    needsUpdate: true
  };

  // === LAYOUT HELPERS ===
  
  /**
   * Computes responsive card dimensions based on available viewport space
   * Ensures 10 columns fit with appropriate gaps
   */
  function computeResponsiveCardSize() {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Measure chrome heights (topbar + bottombar)
    const topbar = document.querySelector('.topbar');
    const bottombar = document.querySelector('.bottombar');
    const chromeHeight = (topbar?.offsetHeight || 0) + (bottombar?.offsetHeight || 0);
    
    // Available space for game board
    const availableWidth = viewportWidth;
    const availableHeight = viewportHeight - chromeHeight;
    
    // Calculate space needed for 10 columns with gaps
    // Formula: 10 * cardWidth + 9 * gap + 2 * padding
    const NUM_COLS = 10;
    const NUM_GAPS = NUM_COLS - 1;
    const HORIZONTAL_PADDING = 16; // Base padding on each side
    
    // Target aspect ratio for cards (width:height ≈ 0.735)
    const CARD_ASPECT_RATIO = 0.735;
    
    // Calculate max card width that fits horizontally
    const maxWidthFromColumns = Math.floor((availableWidth - HORIZONTAL_PADDING * 2 - NUM_GAPS * 6) / NUM_COLS);
    
    // Calculate max card height from available vertical space
    // Reserve space for foundation area (approx 120px + padding)
    const foundationReserve = 140;
    const maxHeightFromViewport = Math.floor((availableHeight - foundationReserve) * 0.6);
    
    // Calculate card width from height constraint
    const maxWidthFromHeight = Math.floor(maxHeightFromViewport * CARD_ASPECT_RATIO);
    
    // Use the smaller constraint, but clamp to reasonable min/max
    let cardWidth = Math.min(maxWidthFromColumns, maxWidthFromHeight);
    cardWidth = Math.max(36, Math.min(88, cardWidth)); // Clamp between 36px and 88px
    
    // Calculate corresponding height
    let cardHeight = Math.round(cardWidth / CARD_ASPECT_RATIO);
    
    // Calculate gap based on card size (proportional)
    const gap = Math.max(4, Math.floor(cardWidth * 0.14));
    
    return { cardWidth, cardHeight, gap, chromeHeight };
  }
  
  /**
   * Updates CSS custom properties with computed responsive values
   */
  function updateResponsiveCSSVars() {
    const { cardWidth, cardHeight, gap, chromeHeight } = computeResponsiveCardSize();
    const root = document.documentElement;
    
    root.style.setProperty('--card-width', `${cardWidth}px`);
    root.style.setProperty('--card-height', `${cardHeight}px`);
    root.style.setProperty('--card-gap', `${gap}px`);
    root.style.setProperty('--chrome-height', `${chromeHeight}px`);
    root.style.setProperty('--board-width', `${window.innerWidth}px`);
    root.style.setProperty('--board-height', `${window.innerHeight - chromeHeight}px`);
    
    // Update layout cache with new dimensions
    layoutCache.cardWidth = cardWidth;
    layoutCache.cardHeight = cardHeight;
    layoutCache.overlap = Math.floor(cardHeight * CARD_OVERLAP_RATIO);
  }
  
  /**
   * Updates the layout cache with current measurements
   * Call this after DOM changes or window resize
   */
  function updateLayoutCache() {
    // Update responsive CSS vars first
    updateResponsiveCSSVars();
    
    // Cache column and root rectangles
    layoutCache.rootRect = gameRoot.getBoundingClientRect();
    const columns = Array.from(tableauArea.querySelectorAll(".column"));
    layoutCache.columnRects = columns.map(col => col.getBoundingClientRect());
    
    layoutCache.needsUpdate = false;
  }
  
  /**
   * Gets cached card dimensions
   */
  function getCardSize() {
    if (layoutCache.needsUpdate) {
      updateLayoutCache();
    }
    return {
      cardWidth: layoutCache.cardWidth,
      cardHeight: layoutCache.cardHeight,
      overlap: layoutCache.overlap
    };
  }

  // === GAME LOGIC HELPERS ===
  
  function isRed(suit) {
    return suit === "H" || suit === "D";
  }

  /**
   * Creates a standard 52-card deck
   */
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

  /**
   * Fisher-Yates shuffle algorithm
   */
  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  // === UNDO/REDO SYSTEM ===
  
  /**
   * Saves current game state to undo stack
   */
  function saveUndoSnapshot() {
    const snapshot = {
      tableau: tableau.map(col => col.slice()),
      cards: Array.from(cardsById.entries()).map(([id, c]) => [id, { ...c }]),
      completedHouses: completedHouses.map(h => h.slice()),
      completedColumns: Array.from(completedColumns),
    };
    undoStack.push(snapshot);
    if (undoStack.length > MAX_UNDO_STACK) undoStack.shift();
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
    updateFoundationsButton();
  }

  function dealNewGame() {
    undoStack = [];
    undoBtn.disabled = true;
    completedHouses = [];
    completedColumns = new Set();
    isGameWon = false;
    redealCountdownShownThisGame = false;
    updateFoundationsButton();
    gameRoot.classList.remove('game-won');
    document.body.classList.remove('game-won');
    const confettiLayer = document.getElementById('confettiLayer');
    if (confettiLayer) confettiLayer.remove();
    const winClone = document.getElementById('winTitleClone');
    if (winClone) winClone.remove();
    const winOverlay = document.getElementById('winOverlay');
    if (winOverlay) winOverlay.remove();
    if (redealCountdownOverlay) redealCountdownOverlay.style.display = 'none';
    const headerTitle = document.querySelector('.topbar .title');
    if (headerTitle) headerTitle.style.opacity = '1';
    const bottomBar = document.querySelector('.bottombar');
    if (bottomBar) bottomBar.style.opacity = '';
    // Reset card maps completely to avoid stale entries/styles
    cardsById = new Map();
    cardElementsById = new Map();
    tableau = Array.from({ length: NUM_COLUMNS }, () => []);
    layoutCache.needsUpdate = true;
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
    redealCountdownShownThisGame = false;
  }

  /**
   * Attaches all card elements to DOM with initial transform positions
   */
  function attachCardsToDOM() {
    // Clear old DOM and cache
    cardLayer.innerHTML = "";
    cardElementsById.clear();
    
    // Use foundation slots as origins if present
    const rootRect = gameRoot.getBoundingClientRect();
    const slots = Array.from(foundationArea.querySelectorAll('.foundation-slot'));
    const origins = slots.map((slot) => {
      const r = slot.getBoundingClientRect();
      return { x: r.left - rootRect.left + r.width / 2, y: r.top - rootRect.top + r.height / 2 };
    });
    let originIndex = 0;
    
    const { cardWidth, cardHeight } = getCardSize();
    
    for (const [id, card] of cardsById.entries()) {
      const el = document.createElement("div");
      el.className = "card";
      el.dataset.id = id;
      el.draggable = false;
      
      // Set per-card SVG background
      el.style.backgroundImage = `url('${cardAssetUrl(card)}')`;
      el.setAttribute('aria-label', `${rankName(card.rankIndex)} of ${suitName(card.suit)}`);
      
      // Mark for dealing animation
      el.classList.add('dealing');
      
      // Use transform for GPU acceleration (start at origin position)
      let startX, startY;
      if (origins.length > 0) {
        const o = origins[originIndex % origins.length];
        originIndex++;
        startX = Math.round(o.x - cardWidth / 2);
        startY = Math.round(o.y - cardHeight / 2);
      } else {
        // Fallback to top center
        startX = Math.round(rootRect.width / 2 - cardWidth / 2);
        startY = -cardHeight - 20;
      }
      
      el.style.transform = `translate(${startX}px, ${startY}px)`;
      
      cardLayer.appendChild(el);
      cardElementsById.set(id, el);
    }
    
    layoutCache.needsUpdate = true;
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

  function ensureColumnsExist() {
    if (tableauArea.children.length === NUM_COLUMNS) return;
    tableauArea.innerHTML = "";
    for (let i = 0; i < NUM_COLUMNS; i++) {
      const c = document.createElement("div");
      c.className = "column";
      c.dataset.col = String(i);
      tableauArea.appendChild(c);
    }
    layoutCache.needsUpdate = true;
  }
  
  /**
   * Gets cached card element by ID (performance optimization)
   */
  function getCardEl(id) {
    return cardElementsById.get(id) || null;
  }

  /**
   * Positions all cards using GPU-accelerated transforms
   * Uses cached measurements and batches DOM updates for performance
   */
  function layoutAll() {
    ensureColumnsExist();
    
    // Update cache if needed (e.g., after resize)
    if (layoutCache.needsUpdate) {
      updateLayoutCache();
    }
    
    const { rootRect, columnRects, cardWidth, overlap } = layoutCache;
    
    // Batch all DOM updates together (minimize reflows)
    requestAnimationFrame(() => {
      // Position tableau cards using transforms
      for (let col = 0; col < NUM_COLUMNS; col++) {
        const ids = tableau[col];
        if (!columnRects[col]) continue;
        
        const baseX = columnRects[col].left - rootRect.left + Math.round((columnRects[col].width - cardWidth) / 2);
        const baseY = columnRects[col].top - rootRect.top + 6;
        
        ids.forEach((id, idx) => {
          const el = getCardEl(id);
          if (!el) return;
          
          // Skip cards currently being dealt (they handle their own transition)
          if (!el.classList.contains('dealing')) {
            const x = baseX;
            const y = baseY + idx * overlap;
            el.style.transform = `translate(${x}px, ${y}px)`;
          }
          el.style.zIndex = String(10 + idx);
        });
      }
      
      // Position completed houses in foundation area slots
      const slots = Array.from(foundationArea.querySelectorAll('.foundation-slot'));
      completedHouses.forEach((houseIds, i) => {
        const slotEl = slots[i];
        if (!slotEl) return;
        
        const rect = slotEl.getBoundingClientRect();
        const x = rect.left - rootRect.left + Math.round((rect.width - cardWidth) / 2);
        const y = rect.top - rootRect.top + 6;
        
        houseIds.forEach((id, idx) => {
          const el = getCardEl(id);
          if (!el) return;
          el.style.transform = `translate(${x}px, ${y}px)`;
          el.style.zIndex = String(1000 + i * 20 + idx);
        });
      });
    });
  }

  /**
   * Animates the initial card deal with smooth spring physics
   */
  function animateInitialDeal() {
    isDealing = true;
    ensureColumnsExist();
    updateLayoutCache();
    
    const { overlap, cardWidth, columnRects, rootRect } = layoutCache;
    
    // Compute target positions for each card
    const targets = new Map();
    for (let c = 0; c < NUM_COLUMNS; c++) {
      const ids = tableau[c];
      if (!columnRects[c]) continue;
      
      const baseX = columnRects[c].left - rootRect.left + Math.round((columnRects[c].width - cardWidth) / 2);
      const baseY = columnRects[c].top - rootRect.top + 6;
      
      ids.forEach((id, idx) => {
        targets.set(id, { x: baseX, y: baseY + idx * overlap });
      });
    }
    
    // Flatten all card IDs in deal order
    const allIds = [];
    tableau.forEach(col => col.forEach(id => allIds.push(id)));
    
    // Animate each card with staggered delay and spring physics
    allIds.forEach((id, i) => {
      const el = getCardEl(id);
      const t = targets.get(id);
      if (!el || !t) return;
      
      const delay = i * DEAL_CARD_DELAY_MS;
      setTimeout(() => {
        const angle = (Math.random() - 0.5) * 6; // Slight rotation for natural feel
        // Smooth spring easing for fluid motion
        el.style.transition = `transform ${DEAL_FLY_DURATION_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;
        el.style.transform = `translate(${t.x}px, ${t.y}px) rotate(${angle}deg)`;
        
        setTimeout(() => {
          el.classList.remove('dealing');
          // Reset to no rotation after landing
          el.style.transform = `translate(${t.x}px, ${t.y}px)`;
          
          if (i === allIds.length - 1) {
            isDealing = false;
          }
        }, DEAL_FLY_DURATION_MS + 40);
      }, delay);
    });
  }

  /**
   * Gathers all cards back to foundation piles with smooth animation
   */
  function gatherCardsToPiles(onDone) {
    const orderedIds = [];
    tableau.forEach(col => col.forEach(id => orderedIds.push(id)));
    const cards = orderedIds.map(getCardEl).filter(Boolean);
    
    if (cards.length === 0) {
      onDone && onDone();
      return;
    }
    
    isDealing = true;
    const rootRect = gameRoot.getBoundingClientRect();
    const slots = Array.from(foundationArea.querySelectorAll('.foundation-slot'));
    const { cardWidth, cardHeight } = getCardSize();
    
    // Compute target origins (foundation piles)
    const origins = slots.length > 0
      ? slots.map((slot) => {
          const r = slot.getBoundingClientRect();
          return {
            x: r.left - rootRect.left + r.width / 2,
            y: r.top - rootRect.top + r.height / 2
          };
        })
      : [{ x: rootRect.width / 2, y: 20 }];
    
    let doneCount = 0;
    cards.forEach((el, i) => {
      const o = origins[i % origins.length];
      const x = Math.round(o.x - cardWidth / 2);
      const y = Math.round(o.y - cardHeight / 2);
      const delay = i * GATHER_CARD_DELAY_MS;
      
      setTimeout(() => {
        el.style.transition = `transform ${GATHER_FLY_DURATION_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;
        el.style.transform = `translate(${x}px, ${y}px)`;
        el.style.zIndex = String(3000 + i);
        
        setTimeout(() => {
          doneCount++;
          if (doneCount === cards.length) {
            isDealing = false;
            setTimeout(() => onDone && onDone(), 40);
          }
        }, GATHER_FLY_DURATION_MS + 20);
      }, delay);
    });
  }

  // === GAME RULES ===
  
  /**
   * Checks if upperCard can be placed on top of lowerCard in tableau
   * Rules: descending rank, alternating colors
   */
  function canStack(upperCard, lowerCard) {
    if (!lowerCard) return true; // Empty column allows any card
    const ranksDescending = upperCard.rankIndex === lowerCard.rankIndex - 1;
    const colorsAlternate = upperCard.color !== lowerCard.color;
    return ranksDescending && colorsAlternate;
  }

  // === DRAG & DROP SYSTEM ===
  
  let dragState = null;
  let dragStartScrollX = 0;
  let dragStartScrollY = 0;
  
  /**
   * Handles the start of a card drag operation
   */
  function onPointerDown(e) {
    if (isDealing) return;
    
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;
    
    const id = cardEl.dataset.id;
    const { columnIndex, stackIndex } = findCardLocation(id);
    if (columnIndex == null) return;

    // Build stack of cards to move (from clicked card to top)
    const movingIds = tableau[columnIndex].slice(stackIndex);
    const movingCards = movingIds.map((cid) => cardsById.get(cid));
    
    // Verify the stack is valid (correctly ordered)
    for (let i = 1; i < movingCards.length; i++) {
      if (!canStack(movingCards[i], movingCards[i - 1])) return;
    }
    
    // Only prevent default after we've confirmed it's a valid drag
    e.preventDefault();
    
    // Capture pointer for this drag operation
    try {
      if (cardEl.setPointerCapture) {
        cardEl.setPointerCapture(e.pointerId);
      } else if (cardLayer.setPointerCapture) {
        cardLayer.setPointerCapture(e.pointerId);
      }
    } catch (err) {
      // Pointer capture may fail on some browsers, continue anyway
      console.debug('Pointer capture failed:', err);
    }
    
    // Store initial scroll positions to account for scrolling during drag
    dragStartScrollX = window.scrollX || document.documentElement.scrollLeft || 0;
    dragStartScrollY = window.scrollY || document.documentElement.scrollTop || 0;

    // Extract current transform positions for smooth dragging
    // Account for any scroll offset
    const rootRect = gameRoot.getBoundingClientRect();
    const startPositions = movingIds.map((cid) => {
      const el = getCardEl(cid);
      const transform = el.style.transform;
      // Parse translate(Xpx, Ypx) from transform
      const match = transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
      if (match) {
        return { 
          x: parseFloat(match[1]), 
          y: parseFloat(match[2]) 
        };
      }
      return { x: 0, y: 0 };
    });

    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      movingIds,
      fromColumn: columnIndex,
      startPositions,
      pointerId: e.pointerId,
    };

    // Apply dragging visual state
    movingIds.forEach((cid, i) => {
      const el = getCardEl(cid);
      el.classList.add('dragging');
      el.style.zIndex = String(2000 + i);
    });

    // Use non-passive listener to prevent scrolling during drag
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { once: true });
    window.addEventListener('pointercancel', onPointerUp, { once: true });
  }

  /**
   * Updates card positions during drag using GPU-accelerated transforms
   */
  function onPointerMove(e) {
    if (!dragState) return;
    
    // Prevent scrolling during drag
    e.preventDefault();
    
    // Account for any scroll changes since drag started
    const currentScrollX = window.scrollX || document.documentElement.scrollLeft || 0;
    const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const scrollDeltaX = currentScrollX - dragStartScrollX;
    const scrollDeltaY = currentScrollY - dragStartScrollY;
    
    const dx = e.clientX - dragState.startX + scrollDeltaX;
    const dy = e.clientY - dragState.startY + scrollDeltaY;
    const { overlap } = getCardSize();
    
    // Update positions of all cards in the dragged stack using transforms
    dragState.movingIds.forEach((cid, i) => {
      const el = getCardEl(cid);
      const newX = dragState.startPositions[i].x + dx;
      const newY = dragState.startPositions[i].y + dy + i * overlap;
      el.style.transform = `translate(${newX}px, ${newY}px) scale(1.06) rotate(-1deg)`;
    });
  }

  /**
   * Handles card drop at the end of drag
   */
  function onPointerUp(e) {
    if (!dragState) return;
    
    // Release pointer capture
    if (dragState.pointerId != null) {
      try {
        const cardEl = getCardEl(dragState.movingIds[0]);
        if (cardEl && cardEl.releasePointerCapture) {
          cardEl.releasePointerCapture(dragState.pointerId);
        } else if (cardLayer.releasePointerCapture) {
          cardLayer.releasePointerCapture(dragState.pointerId);
        }
      } catch (err) {
        // Ignore release errors
        console.debug('Pointer release failed:', err);
      }
    }

    // Find the best drop target based on pointer position
    const drop = findBestDropTarget(e.clientX, e.clientY);
    if (drop) {
      let moved = false;
      if (drop.type === 'column') {
        moved = performMoveToColumn(dragState.fromColumn, drop.colIndex, dragState.movingIds);
      }
      if (moved) checkWin();
    }

    // Clean up drag visuals
    dragState.movingIds.forEach((cid) => {
      const el = getCardEl(cid);
      el.classList.remove('dragging');
    });
    dragState = null;
    layoutAll();

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointercancel', onPointerUp);
  }

  function rectContains(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  /**
   * Finds the best drop target (column) for a drag operation
   * Uses cached column rectangles for performance
   */
  function findBestDropTarget(clientX, clientY) {
    const x = clientX;
    const y = clientY;
    
    // Ensure cache is fresh
    if (layoutCache.needsUpdate) {
      updateLayoutCache();
    }
    
    const { columnRects } = layoutCache;

    // Check if pointer is directly over a column
    for (let i = 0; i < NUM_COLUMNS; i++) {
      if (completedColumns.has(i)) continue;
      const rect = columnRects[i];
      if (rect && rectContains(rect, x, y)) {
        return { type: 'column', colIndex: i };
      }
    }

    // If not directly over, find nearest column within snap margin
    let bestIndex = -1;
    let bestDist = Infinity;
    
    for (let i = 0; i < NUM_COLUMNS; i++) {
      if (completedColumns.has(i)) continue;
      const rect = columnRects[i];
      if (!rect) continue;
      
      const dx = x < rect.left ? rect.left - x : (x > rect.right ? x - rect.right : 0);
      const dy = y < rect.top ? rect.top - y : (y > rect.bottom ? y - rect.bottom : 0);
      const dist = Math.hypot(dx, dy);
      
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i;
      }
    }
    
    if (bestIndex !== -1 && bestDist <= SNAP_MARGIN_PX) {
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

  // === AUTO-COMPLETE SYSTEM ===
  
  /**
   * Detects and moves a completed house (13 cards K→A alternating colors)
   */
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
    // Update foundations button on mobile
    updateFoundationsButton();
    // Show redeal countdown when 2 houses completed
    if (completedHouses.length === 2 && !redealCountdownShownThisGame) {
      showRedealCountdownDialog();
    }
  }

  /**
   * Shows blocking "Redealing in... 10" countdown overlay when 2 houses are completed.
   * Counts 10→1, then waits 5 more seconds. Does not actually redeal.
   */
  function showRedealCountdownDialog() {
    if (!redealCountdownOverlay || !redealCountdownNumber) return;
    redealCountdownShownThisGame = true;
    redealCountdownOverlay.style.display = 'flex';

    let count = 10;
    const countInterval = setInterval(() => {
      count--;
      redealCountdownNumber.textContent = String(count);
      if (count <= 0) {
        clearInterval(countInterval);
        setTimeout(() => {
          redealCountdownOverlay.style.display = 'none';
        }, 5000);
      }
    }, 1000);
  }

  /**
   * Updates the foundations button visibility and badge count
   */
  function updateFoundationsButton() {
    if (!foundationsBtn) return;
    const count = completedHouses.length;
    const badge = foundationsBtn.querySelector('.foundations-badge');
    if (badge) badge.textContent = String(count);
    
    // Show button only on mobile and only if there are foundations
    const isMobile = window.innerWidth <= 740;
    if (count > 0 && isMobile) {
      foundationsBtn.style.display = 'inline-flex';
    } else {
      foundationsBtn.style.display = 'none';
    }
  }
  
  // Update button visibility on resize
  window.addEventListener('resize', () => {
    updateFoundationsButton();
  });
  
  /**
   * Shows the foundations modal with all completed foundations
   */
  function showFoundationsModal() {
    if (!foundationsModal || !foundationsGrid) return;
    
    // Clear previous content
    foundationsGrid.innerHTML = '';
    
    if (completedHouses.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'foundations-empty';
      emptyMsg.textContent = 'No foundations completed yet';
      foundationsGrid.appendChild(emptyMsg);
    } else {
      // Create a grid item for each foundation
      completedHouses.forEach((houseIds, index) => {
        const foundationItem = document.createElement('div');
        foundationItem.className = 'foundation-item';
        
        const topCard = cardsById.get(houseIds[houseIds.length - 1]); // Top card (Ace)
        const suit = topCard ? suitName(topCard.suit) : 'unknown';
        
        const header = document.createElement('div');
        header.className = 'foundation-item-header';
        header.textContent = suit.charAt(0).toUpperCase() + suit.slice(1);
        foundationItem.appendChild(header);
        
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'foundation-cards-preview';
        
        // Show cards in a compact stack view (show top few cards)
        const cardsToShow = Math.min(5, houseIds.length);
        for (let i = houseIds.length - cardsToShow; i < houseIds.length; i++) {
          const cardId = houseIds[i];
          const card = cardsById.get(cardId);
          if (!card) continue;
          
          const cardPreview = document.createElement('div');
          cardPreview.className = 'foundation-card-preview';
          cardPreview.style.backgroundImage = `url('${cardAssetUrl(card)}')`;
          cardPreview.setAttribute('aria-label', `${rankName(card.rankIndex)} of ${suitName(card.suit)}`);
          cardsContainer.appendChild(cardPreview);
        }
        
        if (houseIds.length > cardsToShow) {
          const moreIndicator = document.createElement('div');
          moreIndicator.className = 'foundation-more-indicator';
          moreIndicator.textContent = `+${houseIds.length - cardsToShow}`;
          cardsContainer.appendChild(moreIndicator);
        }
        
        foundationItem.appendChild(cardsContainer);
        foundationsGrid.appendChild(foundationItem);
      });
    }
    
    foundationsModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
  
  /**
   * Hides the foundations modal
   */
  function hideFoundationsModal() {
    if (!foundationsModal) return;
    foundationsModal.style.display = 'none';
    document.body.style.overflow = '';
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

  // === WIN DETECTION & CELEBRATION ===
  
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

  // === HINT SYSTEM ===
  // Smart search for best moves using beam search with heuristic evaluation
  
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

  /**
   * Visually highlights a suggested move with fluid animations
   */
  function flashHint(move) {
    if (!move) {
      setStatus('No moves found.');
      return;
    }
    
    // Highlight only the cards that should be moved (not the destination)
    const stackEls = move.movingIds.map(id => getCardEl(id)).filter(Boolean);
    
    // Apply hint glow with staggered timing for fluid cascade effect
    stackEls.forEach((el, index) => {
      if (!el) return;
      
      // Small delay for each card in stack for cascade effect
      setTimeout(() => {
        el.classList.add('hint-glow');
      }, index * 30);
    });
    
    // Remove hints after animation completes (3 cycles = 6000ms)
    const totalDuration = HINT_GLOW_DURATION_MS * 3;
    setTimeout(() => {
      stackEls.forEach(el => {
        if (el) {
          el.classList.remove('hint-glow');
          // Smoothly remove filter effect
          el.style.transition = 'filter 500ms ease-out';
          setTimeout(() => {
            if (el.style) {
              el.style.transition = '';
            }
          }, 500);
        }
      });
    }, totalDuration);
    
    setStatus('Hint: Move stack');
    lastHintMove = move;
    
    // Track history (cap at 12 entries) to avoid loops
    if (move.type === 'toColumn') {
      hintHistory.push({ head: move.movingIds[0], from: move.fromCol, to: move.toCol });
      if (hintHistory.length > 12) hintHistory.shift();
      hintHeadCooldown.set(move.movingIds[0], 3);
    }
  }

  // === EVENT HANDLERS & INITIALIZATION ===
  
  // Redeal button
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
      
      // Auto-timeout disarm
      clearTimeout(hintBtn._disarmTimer);
      hintBtn._disarmTimer = setTimeout(() => {
        hintConfirmArmed = false;
        hintBtn.textContent = 'Hint';
        hintBtn.classList.remove('btn-warn');
      }, HINT_CONFIRM_TIMEOUT_MS);
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

  // Foundations button and modal
  if (foundationsBtn) {
    foundationsBtn.addEventListener('click', () => {
      showFoundationsModal();
    });
  }
  
  const modalCloseBtn = foundationsModal?.querySelector('.foundations-modal-close');
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', () => {
      hideFoundationsModal();
    });
  }
  
  const modalBackdrop = foundationsModal?.querySelector('.foundations-modal-backdrop');
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', () => {
      hideFoundationsModal();
    });
  }
  
  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && foundationsModal && foundationsModal.style.display === 'flex') {
      hideFoundationsModal();
    }
  });

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
      updateFoundationsButton();
      celebrateWin();
    });
  }

  // Pointer events
  cardLayer.addEventListener('pointerdown', onPointerDown);

  // Initial DOM preparation
  ensureColumnsExist();

  // === PERFORMANCE: Debounced resize handler ===
  let resizeTimeout;
  
  function handleResize() {
    // Invalidate cache immediately for responsive queries
    layoutCache.needsUpdate = true;
    
    // Debounce the expensive relayout
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      updateLayoutCache();
      layoutAll();
    }, RESIZE_DEBOUNCE_MS);
  }
  
  window.addEventListener('resize', handleResize);
  
  // Watch for chrome (topbar/bottombar) size changes using ResizeObserver
  const topbar = document.querySelector('.topbar');
  const bottombar = document.querySelector('.bottombar');
  
  if (topbar && bottombar && window.ResizeObserver) {
    const chromeObserver = new ResizeObserver(() => {
      handleResize();
    });
    chromeObserver.observe(topbar);
    chromeObserver.observe(bottombar);
  }
  
  // Initial responsive setup - must happen before any layout operations
  updateResponsiveCSSVars();
  
  // Show landing overlay after responsive setup
  showLandingOverlay();
})();


