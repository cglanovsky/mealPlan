let state = {
  meals: [],
  ingredients: [],
  weeklyPlan: [],
  customHistory: [],
  units: ["count", "oz", "lbs", "g", "kg", "cups", "tbsp", "tsp", "cans", "bunches", "cloves"],
  shoppingState: {
    checked: {},
    qtyOverrides: {},
    deleted: {},
    activeSupplies: [],
    customItems: []
  },
  randomSlots: {}
};

let activeSlotTarget = { day: null, slot: null };
let queuedOtherItems = [];
let pendingNewOtherItem = null;

document.addEventListener("DOMContentLoaded", () => {
  registerServiceWorker();
  loadCachedState();
  setupNavigation();
  setupEventListeners();
  renderAll();
  syncFromServer();
});

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

function loadCachedState() {
  const cached = localStorage.getItem("mealPlanAppCache");
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      state = { ...state, ...parsed };
      normalizeState();
    } catch (e) {}
  }
}

function saveLocalCache() {
  localStorage.setItem("mealPlanAppCache", JSON.stringify(state));
}

function normalizeState() {
  state.meals = (state.meals || []).map(m => ({
    ...m,
    Effort: m.Effort || "Normal"
  }));

  if (!state.shoppingState || typeof state.shoppingState !== "object") {
    state.shoppingState = {};
  }
  state.shoppingState.checked = state.shoppingState.checked || {};
  state.shoppingState.qtyOverrides = state.shoppingState.qtyOverrides || {};
  state.shoppingState.deleted = state.shoppingState.deleted || {};
  state.shoppingState.activeSupplies = Array.isArray(state.shoppingState.activeSupplies) ? state.shoppingState.activeSupplies : [];
  state.shoppingState.customItems = Array.isArray(state.shoppingState.customItems) ? state.shoppingState.customItems : [];

  if (!state.randomSlots || typeof state.randomSlots !== "object") {
    state.randomSlots = {};
  }
}

function setStatus(text, isOnline = false) {
  const badge = document.getElementById("sync-status");
  badge.textContent = text;
  badge.classList.toggle("online", isOnline);
}

async function syncFromServer() {
  setStatus("Syncing...");
  try {
    const res = await fetch(CONFIG.API_URL);
    const json = await res.json();
    if (json.status === "success" && json.data) {
      state.meals = json.data.meals || [];
      state.ingredients = json.data.ingredients || [];
      state.weeklyPlan = json.data.weeklyPlan || [];
      state.customHistory = json.data.customHistory || [];
      if (json.data.units && json.data.units.length > 0) {
        state.units = json.data.units;
      }
      state.shoppingState = json.data.shoppingState || {};
      normalizeState();
      saveLocalCache();
      renderAll();
      setStatus("Synced", true);
    }
  } catch (err) {
    setStatus("Offline (Cached)", false);
  }
}

async function postToServer(payload) {
  saveLocalCache();
  setStatus("Saving...");
  try {
    await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    setStatus("Synced", true);
  } catch (err) {
    setStatus("Offline (Queued)", false);
  }
}

function setupNavigation() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.view;
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === target));
      document.querySelectorAll(".view-section").forEach(sec => sec.classList.toggle("active", sec.id === `view-${target}`));
    });
  });
}

function setupEventListeners() {
  document.getElementById("refresh-btn").addEventListener("click", syncFromServer);

  document.getElementById("clear-plan-btn").addEventListener("click", () => {
    if (!confirm("Clear all meals from this week's plan?")) return;
    state.weeklyPlan.forEach(p => (p.Meal_ID = ""));
    state.randomSlots = {};
    renderWeeklyPlan();
    renderShoppingList();
    postToServer({ action: "clearWeeklyPlan" });
  });

  document.getElementById("reset-shopping-btn").addEventListener("click", () => {
    if (!confirm("Reset quantity overrides, deleted items, and custom additions?")) return;
    state.shoppingState = {
      checked: {},
      qtyOverrides: {},
      deleted: {},
      activeSupplies: [],
      customItems: []
    };
    renderShoppingList();
    postToServer({ action: "saveShoppingState", state: state.shoppingState });
  });

  document.getElementById("print-btn").addEventListener("click", () => {
    window.print();
  });

  document.getElementById("add-other-items-btn").addEventListener("click", openOtherItemsModal);
  document.getElementById("other-item-name").addEventListener("input", handleOtherItemAutocomplete);
  document.getElementById("other-item-name").addEventListener("focus", handleOtherItemAutocomplete);
  document.getElementById("other-item-name").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleQueueOtherItem();
    }
  });
  document.getElementById("queue-other-item-btn").addEventListener("click", handleQueueOtherItem);
  document.querySelectorAll(".btn-category-choice").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!pendingNewOtherItem) return;
      const category = btn.dataset.cat;
      finalizeQueueOtherItem(
        pendingNewOtherItem.name,
        pendingNewOtherItem.quantity,
        pendingNewOtherItem.unit,
        category,
        true
      );
      pendingNewOtherItem = null;
      document.getElementById("new-item-category-prompt").classList.add("hidden");
    });
  });
  document.getElementById("confirm-other-items-btn").addEventListener("click", confirmQueuedOtherItems);

  document.getElementById("new-meal-btn").addEventListener("click", () => openMealEditor());
  document.getElementById("add-ingredient-row-btn").addEventListener("click", () => addIngredientRow());
  document.getElementById("meal-form").addEventListener("submit", handleSaveMeal);
  document.getElementById("library-search").addEventListener("input", renderMealLibrary);
  document.getElementById("slot-meal-search").addEventListener("input", renderSlotPickerOptions);

  document.querySelectorAll(".close-modal").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById(btn.dataset.close).classList.add("hidden");
    });
  });

  document.querySelectorAll(".btn-add-custom").forEach(btn => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.category;
      const wrapper = btn.closest(".custom-add-wrapper");
      const nameInput = wrapper.querySelector(".custom-item-input");
      const qtyInput = wrapper.querySelector(".custom-qty-input");
      const unitSelect = wrapper.querySelector(".custom-unit-select");
      const parsedQty = parseFloat(qtyInput.value);
      const validQty = parsedQty > 0 ? parsedQty : 1;
      addCustomShoppingItem(nameInput.value, validQty, unitSelect.value, cat);
      nameInput.value = "";
      qtyInput.value = "1";
      wrapper.querySelector(".autocomplete-dropdown").classList.remove("show");
    });
  });

  document.querySelectorAll(".custom-item-input").forEach(input => {
    input.addEventListener("input", () => handleShoppingAutocomplete(input));
    input.addEventListener("focus", () => handleShoppingAutocomplete(input));
  });

  document.addEventListener("click", e => {
    if (
      !e.target.closest(".custom-add-wrapper") &&
      !e.target.closest(".ing-name-wrapper") &&
      !e.target.closest(".other-name-wrapper")
    ) {
      document.querySelectorAll(".autocomplete-dropdown").forEach(d => d.classList.remove("show"));
    }
  });
}

function getIngredientBank() {
  const bankMap = new Map();

  state.ingredients.forEach(ing => {
    if (!ing.Item_Name) return;
    const name = ing.Item_Name.trim();
    const key = name.toLowerCase();
    if (!bankMap.has(key)) {
      bankMap.set(key, {
        name,
        quantity: Number(ing.Quantity) > 0 ? Number(ing.Quantity) : 1,
        unit: ing.Unit || "count",
        category: ing.Category || "Grocery"
      });
    }
  });

  state.customHistory.forEach(hist => {
    if (!hist.Item_Name) return;
    const name = hist.Item_Name.trim();
    const key = name.toLowerCase();
    if (!bankMap.has(key)) {
      bankMap.set(key, {
        name,
        quantity: Number(hist.Quantity) > 0 ? Number(hist.Quantity) : 1,
        unit: hist.Unit || "count",
        category: hist.Category || "Grocery"
      });
    }
  });

  return Array.from(bankMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function renderAll() {
  populateUnitSelects();
  renderWeeklyPlan();
  renderShoppingList();
  renderMealLibrary();
}

function populateUnitSelects() {
  document.querySelectorAll(".custom-unit-select").forEach(select => {
    const current = select.value;
    select.innerHTML = state.units.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("");
    if (current && state.units.includes(current)) {
      select.value = current;
    } else if (state.units.includes("count")) {
      select.value = "count";
    }
  });
}

function openOtherItemsModal() {
  queuedOtherItems = [];
  pendingNewOtherItem = null;
  document.getElementById("other-item-name").value = "";
  document.getElementById("other-item-qty").value = "1";
  const unitSelect = document.getElementById("other-item-unit");
  unitSelect.value = state.units.includes("count") ? "count" : state.units[0];
  document.getElementById("other-item-dropdown").classList.remove("show");
  document.getElementById("new-item-category-prompt").classList.add("hidden");
  renderQueuedOtherItems();
  document.getElementById("other-items-modal").classList.remove("hidden");
  document.getElementById("other-item-name").focus();
}

function handleOtherItemAutocomplete() {
  const input = document.getElementById("other-item-name");
  const dropdown = document.getElementById("other-item-dropdown");
  const query = input.value.trim().toLowerCase();

  document.getElementById("new-item-category-prompt").classList.add("hidden");
  pendingNewOtherItem = null;

  if (!query) {
    dropdown.classList.remove("show");
    return;
  }

  const bank = getIngredientBank();
  const matches = bank.filter(item => item.name.toLowerCase().includes(query));

  if (matches.length === 0) {
    dropdown.classList.remove("show");
    return;
  }

  dropdown.innerHTML = matches
    .slice(0, 12)
    .map(m => `
      <div class="autocomplete-item" data-name="${escapeHtml(m.name)}" data-qty="${m.quantity}" data-unit="${escapeHtml(m.unit)}" data-cat="${escapeHtml(m.category)}">
        <span>${escapeHtml(m.name)}</span>
        <span class="autocomplete-meta">${formatNumber(m.quantity)} ${escapeHtml(m.unit)} · ${escapeHtml(m.category)}</span>
      </div>
    `)
    .join("");

  dropdown.querySelectorAll(".autocomplete-item").forEach(div => {
    div.addEventListener("click", () => {
      input.value = div.dataset.name;
      const qtyInput = document.getElementById("other-item-qty");
      const unitSelect = document.getElementById("other-item-unit");
      qtyInput.value = formatNumber(parseFloat(div.dataset.qty) || 1);
      if (div.dataset.unit && state.units.includes(div.dataset.unit)) {
        unitSelect.value = div.dataset.unit;
      } else if (state.units.includes("count")) {
        unitSelect.value = "count";
      }
      dropdown.classList.remove("show");
      input.focus();
    });
  });

  dropdown.classList.add("show");
}

function handleQueueOtherItem() {
  const nameInput = document.getElementById("other-item-name");
  const qtyInput = document.getElementById("other-item-qty");
  const unitSelect = document.getElementById("other-item-unit");
  const dropdown = document.getElementById("other-item-dropdown");

  const cleanName = nameInput.value.trim();
  if (!cleanName) return;

  dropdown.classList.remove("show");

  const parsedQty = parseFloat(qtyInput.value);
  const validQty = parsedQty > 0 ? formatNumber(parsedQty) : 1;
  const unit = unitSelect.value || "count";

  const bank = getIngredientBank();
  const savedMatch = bank.find(b => b.name.toLowerCase() === cleanName.toLowerCase());

  if (savedMatch) {
    finalizeQueueOtherItem(savedMatch.name, validQty, unit, savedMatch.category, false);
    return;
  }

  const queuedMatch = queuedOtherItems.find(q => q.name.toLowerCase() === cleanName.toLowerCase());
  if (queuedMatch) {
    finalizeQueueOtherItem(queuedMatch.name, validQty, unit, queuedMatch.category, false);
    return;
  }

  pendingNewOtherItem = { name: cleanName, quantity: validQty, unit };
  document.getElementById("category-prompt-text").textContent = `"${cleanName}" is new. Choose a category to save it:`;
  document.getElementById("new-item-category-prompt").classList.remove("hidden");
}

function finalizeQueueOtherItem(name, quantity, unit, category, isNewToMemory) {
  if (isNewToMemory) {
    if (!state.customHistory.some(h => h.Item_Name.toLowerCase() === name.toLowerCase())) {
      state.customHistory.push({
        Item_Name: name,
        Quantity: quantity,
        Unit: unit,
        Category: category,
        Last_Used: new Date().toISOString()
      });
      saveLocalCache();
      postToServer({ action: "addCustomHistory", itemName: name, category, quantity, unit });
    }
  }

  const existing = queuedOtherItems.find(
    item => item.name.toLowerCase() === name.toLowerCase() && item.unit.toLowerCase() === unit.toLowerCase() && item.category === category
  );

  if (existing) {
    existing.quantity = formatNumber(existing.quantity + quantity);
  } else {
    queuedOtherItems.push({ name, quantity, unit, category });
  }

  const nameInput = document.getElementById("other-item-name");
  const qtyInput = document.getElementById("other-item-qty");
  const unitSelect = document.getElementById("other-item-unit");
  nameInput.value = "";
  qtyInput.value = "1";
  unitSelect.value = state.units.includes("count") ? "count" : state.units[0];
  renderQueuedOtherItems();
  nameInput.focus();
}

function renderQueuedOtherItems() {
  const list = document.getElementById("queued-other-items-list");
  if (queuedOtherItems.length === 0) {
    list.innerHTML = `<li class="queued-empty">No items added yet.</li>`;
    return;
  }

  list.innerHTML = queuedOtherItems
    .map((item, idx) => {
      const unitStr = item.unit && item.unit !== "count" ? ` ${escapeHtml(item.unit)}` : "";
      return `
        <li class="queued-item-row">
          <div class="queued-item-info">
            <strong>${formatNumber(item.quantity)}${unitStr}</strong> ${escapeHtml(item.name)}
            <span class="queued-item-cat">(${escapeHtml(item.category)})</span>
          </div>
          <button type="button" class="del-item-btn" data-index="${idx}">&times;</button>
        </li>
      `;
    })
    .join("");

  list.querySelectorAll(".del-item-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index, 10);
      queuedOtherItems.splice(idx, 1);
      renderQueuedOtherItems();
    });
  });
}

function confirmQueuedOtherItems() {
  if (queuedOtherItems.length === 0) {
    document.getElementById("other-items-modal").classList.add("hidden");
    return;
  }

  queuedOtherItems.forEach(item => {
    const key = `custom|${item.category}|${item.name.toLowerCase()}|${item.unit.toLowerCase()}`;
    const existing = state.shoppingState.customItems.find(c => c.key === key);
    if (existing) {
      existing.quantity = formatNumber(existing.quantity + item.quantity);
    } else {
      state.shoppingState.customItems.push({
        key,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        category: item.category
      });
    }
  });

  queuedOtherItems = [];
  pendingNewOtherItem = null;
  document.getElementById("other-items-modal").classList.add("hidden");
  renderShoppingList();
  postToServer({ action: "saveShoppingState", state: state.shoppingState });
}

function renderWeeklyPlan() {
  const grid = document.getElementById("weekly-grid");
  grid.innerHTML = "";

  CONFIG.DAYS.forEach(day => {
    const card = document.createElement("div");
    card.className = "day-card";
    card.innerHTML = `<h3>${day}</h3>`;

    CONFIG.SLOTS.forEach(slot => {
      const entry = state.weeklyPlan.find(p => p.Day_Of_Week === day && p.Meal_Slot === slot);
      const meal = entry && entry.Meal_ID ? state.meals.find(m => m.Meal_ID === entry.Meal_ID) : null;
      const slotKey = `${day}|${slot}`;
      const randomEffort = meal ? state.randomSlots[slotKey] : null;

      if (!meal && state.randomSlots[slotKey]) {
        delete state.randomSlots[slotKey];
      }

      const slotDiv = document.createElement("div");
      slotDiv.className = `meal-slot ${meal ? "filled" : ""}`;
      slotDiv.innerHTML = `
        <span class="slot-label">${slot}</span>
        <div class="slot-meal-row">
          <span class="slot-meal-name">${meal ? escapeHtml(meal.Title) : "+ Assign"}</span>
          ${randomEffort ? `<button type="button" class="slot-refresh-btn" title="Pick another random ${escapeHtml(randomEffort)} meal">&#x21bb;</button>` : ""}
        </div>
      `;

      if (randomEffort) {
        slotDiv.querySelector(".slot-refresh-btn").addEventListener("click", e => {
          e.stopPropagation();
          assignRandomMeal(day, slot, randomEffort, meal.Meal_ID);
        });
      }

      slotDiv.addEventListener("click", () => openSlotPicker(day, slot));
      card.appendChild(slotDiv);
    });

    grid.appendChild(card);
  });
}

function openSlotPicker(day, slot) {
  activeSlotTarget = { day, slot };
  document.getElementById("slot-picker-title").textContent = `${day} — ${slot}`;
  document.getElementById("slot-meal-search").value = "";
  renderSlotPickerOptions();
  document.getElementById("slot-picker-modal").classList.remove("hidden");
}

function renderSlotPickerOptions() {
  const query = document.getElementById("slot-meal-search").value.toLowerCase();
  const list = document.getElementById("slot-meal-options");
  list.innerHTML = "";

  const clearBtn = document.createElement("button");
  clearBtn.className = "slot-option-btn";
  clearBtn.style.color = "var(--danger)";
  clearBtn.textContent = "— Clear Slot —";
  clearBtn.addEventListener("click", () => assignMealToSlot("", null));
  list.appendChild(clearBtn);

  CONFIG.EFFORT_LEVELS.forEach(effort => {
    const label = `Random ${effort} Meal`;
    if (query && !label.toLowerCase().includes(query)) return;

    const btn = document.createElement("button");
    btn.className = "slot-option-btn slot-option-random";
    btn.innerHTML = `<span>${label}</span><span class="slot-option-tag">Random</span>`;
    btn.addEventListener("click", () => {
      const { day, slot } = activeSlotTarget;
      assignRandomMeal(day, slot, effort);
    });
    list.appendChild(btn);
  });

  state.meals
    .filter(m => m.Title.toLowerCase().includes(query))
    .forEach(meal => {
      const effort = meal.Effort || "Normal";
      const btn = document.createElement("button");
      btn.className = "slot-option-btn";
      btn.innerHTML = `<span>${escapeHtml(meal.Title)}</span><span class="slot-option-tag">${escapeHtml(effort)}</span>`;
      btn.addEventListener("click", () => assignMealToSlot(meal.Meal_ID, null));
      list.appendChild(btn);
    });
}

function assignRandomMeal(day, slot, effort, excludeMealId = null) {
  const matching = state.meals.filter(m => (m.Effort || "Normal") === effort);

  if (matching.length === 0) {
    alert(`No "${effort}" meals found. Assign a meal to "${effort}" on the Meals screen first.`);
    return;
  }

  let candidates = matching;
  if (excludeMealId) {
    const others = matching.filter(m => m.Meal_ID !== excludeMealId);
    if (others.length === 0) {
      alert(`No other "${effort}" meals available to reselect.`);
      return;
    }
    candidates = others;
  }

  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  activeSlotTarget = { day, slot };
  assignMealToSlot(picked.Meal_ID, effort);
}

function assignMealToSlot(mealId, randomEffort = null) {
  const { day, slot } = activeSlotTarget;
  const slotKey = `${day}|${slot}`;

  if (mealId && randomEffort) {
    state.randomSlots[slotKey] = randomEffort;
  } else {
    delete state.randomSlots[slotKey];
  }

  let entry = state.weeklyPlan.find(p => p.Day_Of_Week === day && p.Meal_Slot === slot);
  if (entry) {
    entry.Meal_ID = mealId;
  } else {
    state.weeklyPlan.push({ Day_Of_Week: day, Meal_Slot: slot, Meal_ID: mealId });
  }
  document.getElementById("slot-picker-modal").classList.add("hidden");
  renderWeeklyPlan();
  renderShoppingList();
  postToServer({ action: "updateWeeklyPlan", day, slot, mealId });
}

function renderShoppingList() {
  const aggregated = buildAggregatedItems();

  CONFIG.CATEGORIES.forEach(cat => {
    const ul = document.getElementById(`list-${cat}`);
    ul.innerHTML = "";

    const items = aggregated.filter(item => item.category === cat);
    items.forEach(item => {
      const li = document.createElement("li");
      const isChecked = !!state.shoppingState.checked[item.key];
      li.className = `shopping-item ${isChecked ? "checked" : ""}`;

      const displayQty = formatNumber(item.quantity);
      const unitStr = item.unit && item.unit !== "count" ? ` ${escapeHtml(item.unit)}` : "";
      const qtyPrefix = displayQty > 0 ? `${displayQty}${unitStr} ` : "";

      li.innerHTML = `
        <label class="item-left">
          <input type="checkbox" class="item-checkbox" ${isChecked ? "checked" : ""}>
          <span class="item-label"><strong>${qtyPrefix}</strong>${escapeHtml(item.name)}</span>
        </label>
        <div class="item-controls no-print">
          <button class="qty-btn" data-delta="-1">-</button>
          <button class="qty-btn" data-delta="1">+</button>
          <button class="del-item-btn" title="Remove from list">&times;</button>
        </div>
      `;

      li.querySelector(".item-checkbox").addEventListener("change", e => {
        state.shoppingState.checked[item.key] = e.target.checked;
        li.classList.toggle("checked", e.target.checked);
        postToServer({ action: "saveShoppingState", state: state.shoppingState });
      });

      li.querySelectorAll(".qty-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const delta = parseInt(btn.dataset.delta, 10);
          const nextQty = delta < 0
            ? (item.quantity > 1 ? formatNumber(item.quantity - 1) : item.quantity)
            : formatNumber(item.quantity + 1);
          state.shoppingState.qtyOverrides[item.key] = nextQty;
          renderShoppingList();
          postToServer({ action: "saveShoppingState", state: state.shoppingState });
        });
      });

      li.querySelector(".del-item-btn").addEventListener("click", () => {
        if (item.isStaple) {
          state.shoppingState.activeSupplies = state.shoppingState.activeSupplies.filter(s => s !== item.name);
        } else if (item.isCustom) {
          state.shoppingState.customItems = state.shoppingState.customItems.filter(c => c.key !== item.key);
        } else {
          state.shoppingState.deleted[item.key] = true;
        }
        renderShoppingList();
        postToServer({ action: "saveShoppingState", state: state.shoppingState });
      });

      ul.appendChild(li);
    });
  });

  renderSuppliesStaplesPool();
}

function buildAggregatedItems() {
  const map = new Map();

  state.shoppingState.activeSupplies.forEach(staple => {
    const key = `staple|${staple.toLowerCase()}`;
    const qty = state.shoppingState.qtyOverrides[key] !== undefined ? state.shoppingState.qtyOverrides[key] : 1;
    map.set(key, {
      key,
      name: staple,
      quantity: qty,
      unit: "count",
      category: "Supplies/Specialty",
      isStaple: true
    });
  });

  state.weeklyPlan.forEach(slot => {
    if (!slot.Meal_ID) return;
    const mealIngs = state.ingredients.filter(i => i.Meal_ID === slot.Meal_ID);
    mealIngs.forEach(ing => {
      const normName = ing.Item_Name.trim();
      const normUnit = (ing.Unit || "count").trim();
      const cat = ing.Category;
      const key = `${cat}|${normName.toLowerCase()}|${normUnit.toLowerCase()}`;

      if (state.shoppingState.deleted[key]) return;

      if (map.has(key)) {
        map.get(key).quantity += Number(ing.Quantity) || 0;
      } else {
        map.set(key, {
          key,
          name: normName,
          quantity: Number(ing.Quantity) || 0,
          unit: normUnit,
          category: cat
        });
      }
    });
  });

  state.shoppingState.customItems.forEach(custom => {
    const key = custom.key;
    if (map.has(key)) {
      map.get(key).quantity += Number(custom.quantity) || 1;
    } else {
      map.set(key, {
        key,
        name: custom.name,
        quantity: Number(custom.quantity) || 1,
        unit: custom.unit || "count",
        category: custom.category,
        isCustom: true
      });
    }
  });

  map.forEach((item, key) => {
    if (state.shoppingState.qtyOverrides[key] !== undefined) {
      item.quantity = state.shoppingState.qtyOverrides[key];
    }
  });

  return Array.from(map.values());
}

function renderSuppliesStaplesPool() {
  const pool = document.getElementById("supplies-staples-pool");
  pool.innerHTML = "";

  CONFIG.HOUSEHOLD_STAPLES.forEach(staple => {
    const isActive = state.shoppingState.activeSupplies.includes(staple);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `staple-chip ${isActive ? "active" : ""}`;
    chip.textContent = staple;
    chip.addEventListener("click", () => {
      if (isActive) {
        state.shoppingState.activeSupplies = state.shoppingState.activeSupplies.filter(s => s !== staple);
      } else {
        state.shoppingState.activeSupplies.push(staple);
      }
      renderShoppingList();
      postToServer({ action: "saveShoppingState", state: state.shoppingState });
    });
    pool.appendChild(chip);
  });
}

function handleShoppingAutocomplete(input) {
  const cat = input.dataset.category;
  const query = input.value.trim().toLowerCase();
  const wrapper = input.closest(".custom-add-wrapper");
  const dropdown = wrapper.querySelector(".autocomplete-dropdown");

  if (!query) {
    dropdown.classList.remove("show");
    return;
  }

  const bank = getIngredientBank();
  const matches = bank
    .filter(item => item.name.toLowerCase().includes(query))
    .sort((a, b) => {
      const aMatch = a.category === cat ? 0 : 1;
      const bMatch = b.category === cat ? 0 : 1;
      return aMatch - bMatch || a.name.localeCompare(b.name);
    });

  if (matches.length === 0) {
    dropdown.classList.remove("show");
    return;
  }

  dropdown.innerHTML = matches
    .slice(0, 10)
    .map(m => `
      <div class="autocomplete-item" data-name="${escapeHtml(m.name)}" data-unit="${escapeHtml(m.unit)}">
        <span>${escapeHtml(m.name)}</span>
        <span class="autocomplete-meta">${escapeHtml(m.unit)}</span>
      </div>
    `)
    .join("");

  dropdown.querySelectorAll(".autocomplete-item").forEach(div => {
    div.addEventListener("click", () => {
      input.value = div.dataset.name;
      const unitSelect = wrapper.querySelector(".custom-unit-select");
      if (div.dataset.unit && state.units.includes(div.dataset.unit)) {
        unitSelect.value = div.dataset.unit;
      }
      dropdown.classList.remove("show");
    });
  });

  dropdown.classList.add("show");
}

function handleMealIngredientAutocomplete(input, row) {
  const query = input.value.trim().toLowerCase();
  const dropdown = row.querySelector(".autocomplete-dropdown");

  if (!query) {
    dropdown.classList.remove("show");
    return;
  }

  const bank = getIngredientBank();
  const matches = bank.filter(item => item.name.toLowerCase().includes(query));

  if (matches.length === 0) {
    dropdown.classList.remove("show");
    return;
  }

  dropdown.innerHTML = matches
    .slice(0, 10)
    .map(m => `
      <div class="autocomplete-item" data-name="${escapeHtml(m.name)}" data-unit="${escapeHtml(m.unit)}" data-cat="${escapeHtml(m.category)}">
        <span>${escapeHtml(m.name)}</span>
        <span class="autocomplete-meta">${escapeHtml(m.unit)} · ${escapeHtml(m.category)}</span>
      </div>
    `)
    .join("");

  dropdown.querySelectorAll(".autocomplete-item").forEach(div => {
    div.addEventListener("click", () => {
      input.value = div.dataset.name;
      const unitSelect = row.querySelector(".ing-unit");
      const catSelect = row.querySelector(".ing-cat");
      if (div.dataset.unit && state.units.includes(div.dataset.unit)) {
        unitSelect.value = div.dataset.unit;
      }
      if (div.dataset.cat && CONFIG.CATEGORIES.includes(div.dataset.cat)) {
        catSelect.value = div.dataset.cat;
      }
      dropdown.classList.remove("show");
    });
  });

  dropdown.classList.add("show");
}

function renderMealLibrary() {
  const query = document.getElementById("library-search").value.toLowerCase();
  const grid = document.getElementById("meal-library-grid");
  grid.innerHTML = "";

  state.meals
    .filter(meal => {
      const mealIngs = state.ingredients.filter(i => i.Meal_ID === meal.Meal_ID);
      const ingText = mealIngs.map(i => i.Item_Name.toLowerCase()).join(" ");
      const effort = (meal.Effort || "Normal").toLowerCase();
      return meal.Title.toLowerCase().includes(query) || ingText.includes(query) || effort.includes(query);
    })
    .forEach(meal => {
      const mealIngs = state.ingredients.filter(i => i.Meal_ID === meal.Meal_ID);
      const preview = mealIngs.map(i => `${formatNumber(i.Quantity)} ${i.Unit} ${i.Item_Name}`).join(", ");
      const currentEffort = meal.Effort || "Normal";

      const effortPills = CONFIG.EFFORT_LEVELS.map(level => `
        <button type="button" class="effort-pill ${currentEffort === level ? "active" : ""}" data-effort="${level}">${level}</button>
      `).join("");

      const card = document.createElement("div");
      card.className = "meal-card";
      card.innerHTML = `
        <div>
          <h3>${escapeHtml(meal.Title)}</h3>
          <p class="meal-card-ingredients">${escapeHtml(preview) || "No ingredients listed"}</p>
          <div class="effort-selector">${effortPills}</div>
        </div>
        <div class="meal-card-actions">
          <button class="btn-secondary edit-meal-btn">Edit</button>
          <button class="btn-danger-outline delete-meal-btn">Delete</button>
        </div>
      `;

      card.querySelectorAll(".effort-pill").forEach(pill => {
        pill.addEventListener("click", () => {
          const nextEffort = pill.dataset.effort;
          if (nextEffort === currentEffort) return;
          meal.Effort = nextEffort;
          renderMealLibrary();
          postToServer({ action: "updateMealEffort", mealId: meal.Meal_ID, effort: nextEffort });
        });
      });

      card.querySelector(".edit-meal-btn").addEventListener("click", () => openMealEditor(meal));
      card.querySelector(".delete-meal-btn").addEventListener("click", () => handleDeleteMeal(meal));
      grid.appendChild(card);
    });
}

function openMealEditor(meal = null) {
  document.getElementById("editor-modal-title").textContent = meal ? "Edit Meal" : "Add New Meal";
  document.getElementById("edit-meal-id").value = meal ? meal.Meal_ID : "";
  document.getElementById("meal-title-input").value = meal ? meal.Title : "";
  document.getElementById("meal-effort-select").value = meal && meal.Effort ? meal.Effort : "Normal";

  const container = document.getElementById("ingredient-rows-container");
  container.innerHTML = "";

  if (meal) {
    const mealIngs = state.ingredients.filter(i => i.Meal_ID === meal.Meal_ID);
    mealIngs.forEach(ing => addIngredientRow(ing));
  } else {
    addIngredientRow();
  }

  document.getElementById("meal-editor-modal").classList.remove("hidden");
}

function addIngredientRow(ing = null) {
  const container = document.getElementById("ingredient-rows-container");
  const row = document.createElement("div");
  row.className = "ingredient-row";

  const unitOptions = state.units
    .map(u => `<option value="${escapeHtml(u)}" ${ing && ing.Unit === u ? "selected" : ""}>${escapeHtml(u)}</option>`)
    .join("");

  const catOptions = CONFIG.CATEGORIES
    .map(c => `<option value="${c}" ${ing && ing.Category === c ? "selected" : ""}>${c}</option>`)
    .join("");

  row.innerHTML = `
    <div class="ing-name-wrapper">
      <input type="text" class="ing-name" placeholder="Ingredient" autocomplete="off" required value="${ing ? escapeHtml(ing.Item_Name) : ""}">
      <div class="autocomplete-dropdown"></div>
    </div>
    <div class="qty-stepper">
      <button type="button" class="step-down">-</button>
      <input type="number" class="ing-qty" placeholder="Qty" step="any" min="0.01" required value="${ing ? ing.Quantity : 1}">
      <button type="button" class="step-up">+</button>
    </div>
    <select class="ing-unit">
      ${unitOptions}
      <option value="__custom__">+ Custom Unit</option>
    </select>
    <select class="ing-cat">${catOptions}</select>
    <button type="button" class="del-item-btn">&times;</button>
  `;

  const nameInput = row.querySelector(".ing-name");
  nameInput.addEventListener("input", () => handleMealIngredientAutocomplete(nameInput, row));
  nameInput.addEventListener("focus", () => handleMealIngredientAutocomplete(nameInput, row));

  const qtyInput = row.querySelector(".ing-qty");
  row.querySelector(".step-down").addEventListener("click", () => {
    const current = parseFloat(qtyInput.value) || 1;
    if (current > 1) {
      qtyInput.value = formatNumber(current - 1);
    }
  });
  row.querySelector(".step-up").addEventListener("click", () => {
    const current = parseFloat(qtyInput.value) || 0;
    qtyInput.value = formatNumber(current + 1);
  });

  const unitSelect = row.querySelector(".ing-unit");
  unitSelect.addEventListener("change", () => {
    if (unitSelect.value === "__custom__") {
      const custom = prompt("Enter custom unit name (e.g., pinch, loaf, bag):");
      if (custom && custom.trim()) {
        const clean = custom.trim();
        if (!state.units.includes(clean)) {
          state.units.push(clean);
          populateUnitSelects();
          postToServer({ action: "addCustomUnit", unitName: clean });
        }
        const opt = document.createElement("option");
        opt.value = clean;
        opt.textContent = clean;
        unitSelect.insertBefore(opt, unitSelect.lastElementChild);
        unitSelect.value = clean;
      } else {
        unitSelect.value = state.units[0];
      }
    }
  });

  row.querySelector(".del-item-btn").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

async function handleSaveMeal(e) {
  e.preventDefault();
  const mealId = document.getElementById("edit-meal-id").value || crypto.randomUUID();
  const title = document.getElementById("meal-title-input").value.trim();
  const effort = document.getElementById("meal-effort-select").value || "Normal";
  const rows = document.querySelectorAll("#ingredient-rows-container .ingredient-row");

  const ingredients = Array.from(rows).map(row => {
    const parsedQty = parseFloat(row.querySelector(".ing-qty").value);
    return {
      id: crypto.randomUUID(),
      name: row.querySelector(".ing-name").value.trim(),
      quantity: parsedQty > 0 ? parsedQty : 1,
      unit: row.querySelector(".ing-unit").value,
      category: row.querySelector(".ing-cat").value
    };
  });

  const existingIndex = state.meals.findIndex(m => m.Meal_ID === mealId);
  if (existingIndex >= 0) {
    state.meals[existingIndex].Title = title;
    state.meals[existingIndex].Effort = effort;
  } else {
    state.meals.push({ Meal_ID: mealId, Title: title, Effort: effort });
  }

  state.ingredients = state.ingredients.filter(i => i.Meal_ID !== mealId);
  ingredients.forEach(ing => {
    state.ingredients.push({
      Ingredient_ID: ing.id,
      Meal_ID: mealId,
      Item_Name: ing.name,
      Quantity: ing.quantity,
      Unit: ing.unit,
      Category: ing.category
    });
  });

  document.getElementById("meal-editor-modal").classList.add("hidden");
  renderAll();

  await postToServer({
    action: "saveMeal",
    meal: { id: mealId, title, effort, ingredients }
  });
}

async function handleDeleteMeal(meal) {
  if (!confirm(`Delete "${meal.Title}" and remove it from any weekly slots?`)) return;

  state.meals = state.meals.filter(m => m.Meal_ID !== meal.Meal_ID);
  state.ingredients = state.ingredients.filter(i => i.Meal_ID !== meal.Meal_ID);
  state.weeklyPlan.forEach(p => {
    if (p.Meal_ID === meal.Meal_ID) p.Meal_ID = "";
  });

  renderAll();
  await postToServer({ action: "deleteMeal", mealId: meal.Meal_ID });
}

function addCustomShoppingItem(name, quantity, unit, category) {
  const cleanName = name.trim();
  if (!cleanName) return;

  const key = `custom|${category}|${cleanName.toLowerCase()}|${unit.toLowerCase()}`;
  const existing = state.shoppingState.customItems.find(c => c.key === key);

  if (existing) {
    existing.quantity = formatNumber(existing.quantity + quantity);
  } else {
    state.shoppingState.customItems.push({ key, name: cleanName, quantity, unit, category });
  }

  if (!state.customHistory.some(h => h.Item_Name.toLowerCase() === cleanName.toLowerCase() && h.Category === category)) {
    state.customHistory.push({ Item_Name: cleanName, Category: category, Last_Used: new Date().toISOString() });
  }

  renderShoppingList();
  postToServer({ action: "saveShoppingState", state: state.shoppingState });
  postToServer({ action: "addCustomHistory", itemName: cleanName, category });
}

function formatNumber(num) {
  return Number(Math.round(num * 1000) / 1000);
}

function escapeHtml(str) {
  if (!str) return "";
  return str.toString().replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}
