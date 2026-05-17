const defaultDishes = [
  {
    id: "ramen",
    name: "Miso Ramen",
    price: "13,90",
    category: "main",
    icon: "🍜",
    description: "Weizennudeln, Pilze, Ei, Chili-Öl, Sesam",
    tags: ["warm", "satt", "leicht scharf"],
  },
  {
    id: "bowl",
    name: "Sesam Bowl",
    price: "12,40",
    category: "light",
    icon: "🥗",
    description: "Reis, Edamame, Gurke, Avocado, Ingwerdressing",
    tags: ["frisch", "vegan", "glutenarm"],
  },
  {
    id: "pizza",
    name: "Pizza Burrata",
    price: "14,80",
    category: "main",
    icon: "🍕",
    description: "Tomaten, Burrata, Basilikum, geröstete Pinienkerne",
    tags: ["vegetarisch", "teilen"],
  },
  {
    id: "curry",
    name: "Kokos Curry",
    price: "13,20",
    category: "veggie",
    icon: "🍛",
    description: "Gemüse, Kichererbsen, Jasminreis, Limette",
    tags: ["vegan", "warm", "mild"],
  },
  {
    id: "tacos",
    name: "Pilz Tacos",
    price: "11,90",
    category: "veggie",
    icon: "🌮",
    description: "Mais-Tortillas, Kraut, Salsa verde, Koriander",
    tags: ["vegetarisch", "teilen", "frisch"],
  },
  {
    id: "salmon",
    name: "Lachs Teriyaki",
    price: "16,50",
    category: "light",
    icon: "🍣",
    description: "Lachs, Reis, Gurkensalat, Teriyaki, Sesam",
    tags: ["protein", "leicht", "umami"],
  },
];

const maxVotes = 3;
const tesseractUrl = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
const supabaseUrl = "https://saekkjrstziirzyztkih.supabase.co";
const supabaseKey = "sb_publishable_ko5UmpkF6RrGrnOOlzDVYg_c1E4vkZO";
const roomTable = "tischwahl_rooms";
const roomId = getRoomId();
const storageKey = `tischwahl-state-v2-${roomId}`;

const defaultState = {
  voterName: "",
  filter: "all",
  dishes: defaultDishes,
  votes: {
    ramen: [],
    bowl: [],
    pizza: [],
    curry: [],
    tacos: [],
    salmon: [],
  },
};

let state = loadState();
let dishes = state.dishes?.length ? state.dishes : structuredClone(defaultDishes);
let draftDishes = [];
let selectedPhoto = null;
let tesseractLoading = null;
let toastTimer;
let supabaseClient = null;
let remoteReady = false;
let applyingRemoteState = false;
let saveRemoteTimer = null;

const menuList = document.querySelector("#menuList");
const resultsList = document.querySelector("#resultsList");
const voterNameInput = document.querySelector("#voterName");
const voteCounter = document.querySelector("#voteCounter");
const orderSummary = document.querySelector("#orderSummary");
const toast = document.querySelector("#toast");
const photoInputs = [
  document.querySelector("#menuPhotoCamera"),
  document.querySelector("#menuPhotoLibrary"),
].filter(Boolean);
const photoPreview = document.querySelector("#photoPreview");
const previewBox = document.querySelector(".photo-preview");
const menuTextInput = document.querySelector("#menuText");
const scanPhotoButton = document.querySelector("#scanPhotoButton");
const parseTextButton = document.querySelector("#parseTextButton");
const sampleTextButton = document.querySelector("#sampleTextButton");
const publishMenuButton = document.querySelector("#publishMenuButton");
const clearDraftButton = document.querySelector("#clearDraftButton");
const draftMenuList = document.querySelector("#draftMenuList");
const draftCounter = document.querySelector("#draftCounter");
const shareLinkInput = document.querySelector("#shareLink");
const copyLinkButton = document.querySelector("#copyLinkButton");
const newRoomButton = document.querySelector("#newRoomButton");
const importStatus = document.querySelector("#importStatus");
const roomCode = document.querySelector("#roomCode");
const syncStatus = document.querySelector("#syncStatus");

voterNameInput.value = state.voterName;
roomCode.textContent = roomId;
shareLinkInput.value = getShareUrl();

document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    saveState();
    render();
  });
});

voterNameInput.addEventListener("input", (event) => {
  const previousName = state.voterName.trim();
  state.voterName = event.target.value;
  const nextName = state.voterName.trim();

  if (previousName && nextName && previousName !== nextName) {
    Object.keys(state.votes).forEach((dishId) => {
      state.votes[dishId] = state.votes[dishId].map((name) =>
        name === previousName ? nextName : name,
      );
    });
  }

  saveState();
  render();
});

document.querySelector("#resetButton").addEventListener("click", () => {
  state = {
    ...structuredClone(defaultState),
    voterName: state.voterName,
    dishes,
    votes: Object.fromEntries(dishes.map((dish) => [dish.id, []])),
  };
  saveState();
  render();
  showToast("Die Abstimmung ist wieder leer.");
});

document.querySelector("#finishButton").addEventListener("click", () => {
  const winners = getRankedDishes().filter((item) => item.count > 0).slice(0, 3);
  if (!winners.length) {
    showToast("Noch keine Stimmen vorhanden.");
    return;
  }

  showToast(`Festgelegt: ${winners.map((item) => item.name).join(", ")}`);
});

photoInputs.forEach((input) => {
  input.addEventListener("change", (event) => {
    const [file] = event.target.files;
    selectedPhoto = file ?? null;
    photoInputs.forEach((otherInput) => {
      if (otherInput !== input) otherInput.value = "";
    });

    if (!selectedPhoto) {
      photoPreview.removeAttribute("src");
      previewBox.classList.remove("has-image");
      setImportStatus("Bereit");
      return;
    }

    photoPreview.src = URL.createObjectURL(selectedPhoto);
    previewBox.classList.add("has-image");
    setImportStatus("Foto geladen");
  });
});

scanPhotoButton?.addEventListener("click", async () => {
  if (!selectedPhoto) {
    showToast("Bitte zuerst ein Foto aufnehmen oder aus der Mediathek wählen.");
    photoInputs[0]?.click();
    return;
  }

  scanPhotoButton.disabled = true;
  setImportStatus("Optimiere");

  try {
    await loadTesseract();
    const preparedImage = await prepareImageForOcr(selectedPhoto);
    setImportStatus("Lese Foto");
    const result = await Tesseract.recognize(preparedImage, "deu+eng", {
      logger: (progress) => {
        if (progress.status === "recognizing text") {
          setImportStatus(`${Math.round(progress.progress * 100)}%`);
        }
      },
    });

    menuTextInput.value = cleanupOcrText(result.data.text);
    setImportStatus("Text erkannt");
    showToast("Text erkannt. Bitte kurz prüfen und dann übernehmen.");
  } catch (error) {
    console.error(error);
    setImportStatus("Manuell");
    showToast("Texterkennung konnte nicht geladen werden. Du kannst den Text hier einfügen.");
    menuTextInput.focus();
  } finally {
    scanPhotoButton.disabled = false;
  }
});

parseTextButton.addEventListener("click", () => {
  const parsedDishes = parseMenuText(menuTextInput.value);

  if (!parsedDishes.length) {
    showToast("Ich konnte noch keine Gerichte erkennen.");
    menuTextInput.focus();
    return;
  }

  draftDishes = parsedDishes;
  renderDraftMenu();
  setImportStatus(`${parsedDishes.length} Gerichte`);
  showToast(`${parsedDishes.length} Gerichte erkannt. Bitte kurz prüfen.`);
});

publishMenuButton.addEventListener("click", () => {
  const approvedDishes = getApprovedDraftDishes();

  if (!approvedDishes.length) {
    showToast("Bitte zuerst ein Menü erkennen oder mindestens ein Gericht aktiv lassen.");
    return;
  }

  dishes = approvedDishes;
  state.dishes = approvedDishes;
  state.filter = "all";
  state.votes = Object.fromEntries(dishes.map((dish) => [dish.id, []]));
  saveState();
  render();
  showToast("Abstimmung ist gestartet. Du kannst den Link teilen.");
});

clearDraftButton.addEventListener("click", () => {
  draftDishes = [];
  renderDraftMenu();
  setImportStatus("Bereit");
});

sampleTextButton.addEventListener("click", () => {
  menuTextInput.value = [
    "Pizza Margherita Tomaten, Mozzarella, Basilikum 10,90",
    "Kokos Curry Gemüse, Kichererbsen, Jasminreis 13,20",
    "Lachs Teriyaki Lachs, Reis, Gurkensalat 16,50",
    "Pilz Tacos Mais-Tortillas, Kraut, Salsa verde 11,90",
  ].join("\n");
  showToast("Beispieltext eingesetzt.");
});

copyLinkButton.addEventListener("click", async () => {
  const link = getShareUrl();
  shareLinkInput.value = link;

  try {
    await navigator.clipboard.writeText(link);
    showToast("Link kopiert.");
  } catch {
    shareLinkInput.select();
    showToast("Link ist markiert und kann kopiert werden.");
  }
});

newRoomButton.addEventListener("click", () => {
  const room = `tisch-${Math.random().toString(36).slice(2, 7)}`;
  const url = new URL(window.location.href);
  url.searchParams.set("room", room);
  window.location.href = url.toString();
});

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (!saved) return structuredClone(defaultState);
    const mergedDishes = Array.isArray(saved.dishes) && saved.dishes.length
      ? saved.dishes
      : structuredClone(defaultState.dishes);

    return {
      ...structuredClone(defaultState),
      ...saved,
      dishes: mergedDishes,
      votes: buildVotes(mergedDishes, saved.votes),
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  state.dishes = dishes;
  localStorage.setItem(storageKey, JSON.stringify(state));
  scheduleRemoteSave();
}

function buildVotes(menuItems, savedVotes = {}) {
  return Object.fromEntries(
    menuItems.map((dish) => [
      dish.id,
      Array.isArray(savedVotes?.[dish.id]) ? savedVotes[dish.id] : [],
    ]),
  );
}

function render() {
  renderFilters();
  renderMenu();
  renderResults();
  renderDraftMenu();
}

function renderFilters() {
  document.querySelectorAll(".filter-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.filter);
  });
}

function renderMenu() {
  const voterName = state.voterName.trim();
  const selectedIds = getSelectedIds(voterName);
  voteCounter.textContent = `${selectedIds.length}/${maxVotes}`;

  const visibleDishes = dishes.filter(
    (dish) => state.filter === "all" || dish.category === state.filter,
  );

  menuList.innerHTML = visibleDishes
    .map((dish) => {
      const selected = voterName && state.votes[dish.id]?.includes(voterName);
      return `
        <article class="dish-card ${selected ? "selected" : ""}">
          <div class="dish-art" aria-hidden="true">${escapeHtml(dish.icon)}</div>
          <div class="dish-body">
            <div class="dish-top">
              <h3 class="dish-title">${escapeHtml(dish.name)}</h3>
              <span class="price">€ ${escapeHtml(dish.price)}</span>
            </div>
            <p class="description">${escapeHtml(dish.description)}</p>
            <div class="tags">${dish.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
            <button class="vote-button" type="button" data-dish="${escapeHtml(dish.id)}">
              ${selected ? "Gewählt" : "Wählen"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  menuList.querySelectorAll(".vote-button").forEach((button) => {
    button.addEventListener("click", () => toggleVote(button.dataset.dish));
  });
}

function renderResults() {
  const ranked = getRankedDishes();
  const highest = Math.max(...ranked.map((dish) => dish.count), 1);

  resultsList.innerHTML = ranked
    .map((dish) => {
      const voters = state.votes[dish.id] ?? [];
      const width = Math.round((dish.count / highest) * 100);
      return `
        <div class="result-row">
          <div class="result-meta">
            <span>${escapeHtml(dish.name)}</span>
            <span>${dish.count}</span>
          </div>
          <div class="bar" aria-hidden="true"><span style="width: ${width}%"></span></div>
          <div class="voters">${voters.length ? escapeHtml(voters.join(", ")) : "Noch keine Stimme"}</div>
        </div>
      `;
    })
    .join("");

  const leaders = ranked.filter((dish) => dish.count > 0).slice(0, 2);
  orderSummary.textContent = leaders.length
    ? leaders.map((dish) => `${dish.name} (${dish.count})`).join(" und ")
    : "Noch offen";
}

function renderDraftMenu() {
  draftCounter.textContent = String(draftDishes.length);

  if (!draftDishes.length) {
    draftMenuList.innerHTML = `
      <div class="empty-state">
        Füge Speisekarten-Text ein und tippe auf „Menü erkennen“.
      </div>
    `;
    return;
  }

  draftMenuList.innerHTML = draftDishes
    .map((dish, index) => {
      return `
        <article class="draft-row" data-index="${index}">
          <label class="draft-toggle">
            <input type="checkbox" data-field="included" ${dish.included === false ? "" : "checked"} />
            <span>Aufnehmen</span>
          </label>
          <label>
            <span>Name</span>
            <input type="text" data-field="name" value="${escapeHtml(dish.name)}" />
          </label>
          <label>
            <span>Preis</span>
            <input type="text" data-field="price" value="${escapeHtml(dish.price)}" />
          </label>
          <label class="draft-description">
            <span>Beschreibung</span>
            <input type="text" data-field="description" value="${escapeHtml(dish.description)}" />
          </label>
          <button class="icon-button draft-remove" type="button" data-action="remove" aria-label="Gericht entfernen">×</button>
        </article>
      `;
    })
    .join("");

  draftMenuList.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", updateDraftFromControl);
    input.addEventListener("change", updateDraftFromControl);
  });

  draftMenuList.querySelectorAll("[data-action='remove']").forEach((button) => {
    button.addEventListener("click", () => {
      draftDishes.splice(Number(button.closest(".draft-row").dataset.index), 1);
      renderDraftMenu();
    });
  });
}

function updateDraftFromControl(event) {
  const row = event.target.closest(".draft-row");
  const dish = draftDishes[Number(row.dataset.index)];
  const field = event.target.dataset.field;

  if (!dish || !field) return;

  if (field === "included") {
    dish.included = event.target.checked;
  } else {
    dish[field] = event.target.value;
  }
}

function getApprovedDraftDishes() {
  const approvedDishes = [];

  draftDishes
    .filter((dish) => dish.included !== false && dish.name.trim())
    .forEach((dish) => {
      const name = dish.name.trim();
      const description = dish.description.trim();
      approvedDishes.push({
        id: uniqueDishId(name, approvedDishes),
        name,
        price: dish.price.trim() || "0,00",
        category: categorizeDish(`${name} ${description}`),
        icon: chooseDishIcon(`${name} ${description}`),
        description: description || "Aus dem eingefügten Speisekarten-Text übernommen",
        tags: buildTags(`${name} ${description}`),
      });
    });

  return approvedDishes;
}

function toggleVote(dishId) {
  const voterName = state.voterName.trim();
  if (!voterName) {
    voterNameInput.focus();
    showToast("Bitte zuerst deinen Namen eintragen.");
    return;
  }

  const selectedIds = getSelectedIds(voterName);
  const dishVotes = state.votes[dishId] ?? [];
  const alreadySelected = dishVotes.includes(voterName);

  if (alreadySelected) {
    state.votes[dishId] = dishVotes.filter((name) => name !== voterName);
  } else {
    if (selectedIds.length >= maxVotes) {
      showToast("Du kannst maximal 3 Favoriten wählen.");
      return;
    }
    state.votes[dishId] = [...dishVotes, voterName];
  }

  saveState();
  render();
}

function getSelectedIds(voterName) {
  if (!voterName) return [];
  return dishes
    .filter((dish) => state.votes[dish.id]?.includes(voterName))
    .map((dish) => dish.id);
}

function getRankedDishes() {
  return dishes
    .map((dish) => ({
      ...dish,
      count: state.votes[dish.id]?.length ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

async function loadTesseract() {
  if (window.Tesseract) return;
  if (tesseractLoading) return tesseractLoading;

  tesseractLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = tesseractUrl;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });

  return tesseractLoading;
}

async function initializeSharedRoom() {
  if (!window.supabase?.createClient || !supabaseUrl || !supabaseKey) {
    setSyncStatus("Lokal");
    return;
  }

  supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
  setSyncStatus("Verbinde");

  try {
    const { data, error } = await supabaseClient
      .from(roomTable)
      .select("data")
      .eq("room_id", roomId)
      .maybeSingle();

    if (error) throw error;

    if (data?.data) {
      applyRemoteData(data.data);
    } else {
      await saveRemoteState();
    }

    remoteReady = true;
    setSyncStatus("Online");
    subscribeToRoom();
  } catch (error) {
    console.error(error);
    setSyncStatus("Lokal");
    showToast("Online-Abstimmung ist noch nicht eingerichtet. Bitte Supabase-Tabelle anlegen.");
  }
}

function subscribeToRoom() {
  supabaseClient
    .channel(`tischwahl:${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: roomTable,
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        if (payload.new?.data) applyRemoteData(payload.new.data);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setSyncStatus("Live");
    });
}

function scheduleRemoteSave() {
  if (!remoteReady || applyingRemoteState || !supabaseClient) return;
  clearTimeout(saveRemoteTimer);
  saveRemoteTimer = setTimeout(saveRemoteState, 250);
}

async function saveRemoteState() {
  if (!supabaseClient) return;

  const payload = {
    dishes,
    votes: state.votes,
  };

  const { error } = await supabaseClient.from(roomTable).upsert({
    room_id: roomId,
    data: payload,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error(error);
    setSyncStatus("Lokal");
  }
}

function applyRemoteData(data) {
  if (!Array.isArray(data.dishes) || !data.dishes.length) return;

  applyingRemoteState = true;
  dishes = data.dishes;
  state.dishes = data.dishes;
  state.votes = buildVotes(data.dishes, data.votes);
  localStorage.setItem(storageKey, JSON.stringify(state));
  render();
  applyingRemoteState = false;
}

function getRoomId() {
  const params = new URLSearchParams(window.location.search);
  const rawRoom = params.get("room") || window.location.hash.replace("#", "") || "tischwahl";
  return rawRoom
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "tischwahl";
}

function getShareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  url.hash = "";
  return url.toString();
}

function setSyncStatus(label) {
  syncStatus.textContent = label;
}

function cleanupOcrText(text) {
  return text
    .replace(/[|]/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/([A-Za-zÄÖÜäöüß])(\d{1,2}[,.]\d{2})/g, "$1 $2")
    .replace(/(\d{1,2})\s*[,.]\s*(\d{2})/g, "$1,$2")
    .replace(/\s+€/g, " €")
    .replace(/(\d)[;:](\d{2})/g, "$1,$2")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseMenuText(text) {
  const lines = cleanupOcrText(text)
    .split("\n")
    .map((line) => line.replace(/\s{2,}/g, " ").trim())
    .filter((line) => line.length > 1);

  const menuItems = [];
  const pendingItems = [];

  lines.forEach((line) => {
    const prices = findPrices(line);
    const withoutPrice = stripPrices(line);

    if (shouldSkipMenuLine(line)) {
      return;
    }

    if (prices.length && hasDishText(withoutPrice)) {
      const parsedText = splitDishText(withoutPrice);
      addParsedMenuItem(menuItems, parsedText, prices[0]);
      return;
    }

    if (prices.length) {
      prices.forEach((price) => assignPriceToPendingItem(pendingItems, menuItems, price));
      return;
    }

    if (isLikelyDishName(line)) {
      pendingItems.push({
        title: line,
        descriptions: [],
      });
      return;
    }

    if (pendingItems.length && isLikelyDescription(line)) {
      pendingItems[pendingItems.length - 1].descriptions.push(line);
    }
  });

  return menuItems.slice(0, 24);
}

function assignPriceToPendingItem(pendingItems, menuItems, price) {
  const pending = pendingItems.shift();
  if (!pending) return;

  const parsedText = splitDishText(`${pending.title} ${pending.descriptions.join(" ")}`.trim());
  addParsedMenuItem(menuItems, parsedText, price);
}

function addParsedMenuItem(menuItems, parsedText, price) {
  const name = parsedText.name;
  const description = parsedText.description;

  if (!name || name.length < 3) return;
  if (menuItems.some((item) => item.name.toLowerCase() === name.toLowerCase())) return;

  menuItems.push({
    id: uniqueDishId(name, menuItems),
    name,
    price,
    category: categorizeDish(`${name} ${description}`),
    icon: chooseDishIcon(`${name} ${description}`),
    description: description || "Aus dem eingefügten Speisekarten-Text übernommen",
    tags: buildTags(`${name} ${description}`),
  });
}

function splitDishText(value) {
  const cleaned = value
    .replace(/\b\d+[a-z]?\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const romanized = cleaned.match(/（([^（）]{2,45})）|\(([^()]{2,45})\)/);
  const germanStart = cleaned.search(/\b(geschmorte|gebratene|gebratener|sauer|scharfes|spezieller|salat|oktopus|dünn|fischfilet|tofu|lammfleisch|rindfleisch|garnelen|morcheln|variation|frittiertes|zartes|würziges|chinesische)\b/i);
  let rawName = "";
  let description = "";

  if (romanized) {
    rawName = romanized[1] || romanized[2];
    description = cleaned.slice((romanized.index ?? 0) + romanized[0].length).trim();
  } else if (germanStart > 8) {
    rawName = cleaned.slice(0, germanStart).trim();
    description = cleaned.slice(germanStart).trim();
  } else {
    const parts = cleaned.split(/\s[-–—]\s|(?:\s{2,})|(?:,\s+)/).filter(Boolean);
    rawName = parts.shift() || cleaned;
    description = parts.join(", ");
  }

  if (!description) {
    const words = rawName.split(" ");
    const ingredientIndex = words.findIndex((word, index) => {
      return index >= 2 && isIngredientWord(word);
    });

    if (ingredientIndex > -1) {
      description = words.slice(ingredientIndex).join(" ");
      rawName = words.slice(0, ingredientIndex).join(" ");
    }
  }

  return {
    name: titleCase(cleanDishName(rawName)),
    description: description ? sentenceCase(cleanDescription(description)) : "",
  };
}

function findPrices(line) {
  return [...line.matchAll(/(?:€\s*)?(\d{1,2}[,.]\d{2})(?:\s*€)?/g)].map((match) =>
    match[1].replace(".", ","),
  );
}

function stripPrices(line) {
  return line.replace(/(?:€\s*)?\d{1,2}[,.]\d{2}(?:\s*€)?/g, "").replace(/\s{2,}/g, " ").trim();
}

function hasDishText(line) {
  return cleanDishName(line).length >= 3 && !isLikelyDescription(line);
}

function shouldSkipMenuLine(line) {
  const lower = line.toLowerCase();
  return (
    isLikelyHeading(line) ||
    isLikelyChineseHeading(line) ||
    /^€$/.test(line) ||
    /^\d{1,3}$/.test(line) ||
    /^(\(?[a-z](,[a-z])*\)?)+$/i.test(line.replace(/\s/g, "")) ||
    /yummy house|vor einem jahr|pepper|starters|soup for|house specialties/.test(lower)
  );
}

function isLikelyDishName(line) {
  if (shouldSkipMenuLine(line)) return false;
  if (/[\u3400-\u9fff]/.test(line)) return true;
  if (/（[^（）]{2,45}）|\([^()]{2,45}\)/.test(line) && !isLikelyDescription(line)) return true;
  return /^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\s'’-]{3,60}$/.test(line) && !isLikelyDescription(line);
}

function isLikelyDescription(line) {
  return /\b(mit|vom|von|nach|in|und|with|fried|braised|sour|spicy|salad|beef|lamb|pork|fish|tofu|sauce|suppe|scharf|geschmort|geschmorte|gebraten|gebratene|frittiert|frittierte|mariniert|marinierten|speziell|spezieller|oktopus|oktopusstücke|dünn|sauer)\b/i.test(line);
}

function cleanDishName(value) {
  return value
    .replace(/[\u3400-\u9fff]/g, "")
    .replace(/[（）()]/g, " ")
    .replace(/\b[A-Z](?:[,.][A-Z])+\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanDescription(value) {
  return value
    .replace(/^[（(]\s*[A-Z](?:[,.，]\s*[A-Z])*\s*[）)]/i, "")
    .replace(/^€\s*/, "")
    .replace(/[（）]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isLikelyChineseHeading(line) {
  const chineseChars = (line.match(/[\u3400-\u9fff]/g) || []).length;
  return chineseChars > 0 && chineseChars <= 5 && !/[()（）]/.test(line) && line.length <= 12;
}

function isIngredientWord(word) {
  return /^(tomaten|tomate|mozzarella|basilikum|avocado|gurke|reis|sesam|gemüse|pilze|pilz|lachs|huhn|rind|tofu|käse|salat|zwiebel|chili|limette|koriander|kartoffel|nudeln|sauce|salsa)$/i.test(word);
}

function isLikelyHeading(line) {
  const lower = line.toLowerCase();
  return (
    /^(vorspeisen|hauptgerichte|pasta|pizza|salate|dessert|drinks|getränke|speisen)$/.test(lower) ||
    /^seite\s+\d+/.test(lower)
  );
}

function sentenceCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function prepareImageForOcr(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const maxWidth = 1800;
      const scale = Math.min(maxWidth / image.width, 1);
      const width = Math.max(Math.round(image.width * scale), 1);
      const height = Math.max(Math.round(image.height * scale), 1);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      canvas.width = width;
      canvas.height = height;

      context.drawImage(image, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      const data = imageData.data;

      for (let index = 0; index < data.length; index += 4) {
        const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
        const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.55 + 128));
        const cleaned = contrasted > 210 ? 255 : contrasted < 92 ? 0 : contrasted;
        data[index] = cleaned;
        data[index + 1] = cleaned;
        data[index + 2] = cleaned;
      }

      context.putImageData(imageData, 0, 0);
      resolve(canvas);
    };
    image.onerror = reject;
    image.src = URL.createObjectURL(file);
  });
}

function titleCase(value) {
  return value
    .toLowerCase()
    .replace(/(^|\s|-)([a-zäöüß])/g, (match) => match.toUpperCase())
    .replace(/\bmit\b/gi, "mit")
    .replace(/\bund\b/gi, "und");
}

function uniqueDishId(name, existingItems) {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 34) || "gericht";

  let id = base;
  let index = 2;
  while (existingItems.some((item) => item.id === id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

function categorizeDish(text) {
  const lower = text.toLowerCase();
  if (/(salat|bowl|suppe|carpaccio|ceviche|vorspeise)/.test(lower)) return "light";
  if (/(vegan|vegetarisch|gemüse|tofu|pilz|falafel|linsen|kichererbsen)/.test(lower)) {
    return "veggie";
  }
  return "main";
}

function chooseDishIcon(text) {
  const lower = text.toLowerCase();
  if (/(pizza|focaccia)/.test(lower)) return "🍕";
  if (/(salat|bowl|avocado)/.test(lower)) return "🥗";
  if (/(sushi|lachs|thunfisch|fisch)/.test(lower)) return "🍣";
  if (/(taco|wrap|burrito)/.test(lower)) return "🌮";
  if (/(ramen|nudel|pasta|spaghetti|tagliatelle)/.test(lower)) return "🍜";
  if (/(curry|reis|dal)/.test(lower)) return "🍛";
  return "🍽️";
}

function buildTags(text) {
  const lower = text.toLowerCase();
  const tags = [];
  if (/(vegan)/.test(lower)) tags.push("vegan");
  if (/(vegetarisch|gemüse|tofu|pilz|falafel)/.test(lower)) tags.push("vegetarisch");
  if (/(scharf|chili|pikant)/.test(lower)) tags.push("scharf");
  if (/(salat|frisch|limette|gurke)/.test(lower)) tags.push("frisch");
  if (/(teilen|platte|tapas)/.test(lower)) tags.push("teilen");
  return tags.length ? tags.slice(0, 3) : ["neu"];
}

function setImportStatus(label) {
  importStatus.textContent = label;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

render();
initializeSharedRoom();
