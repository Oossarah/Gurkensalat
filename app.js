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
    ramen: ["Mira", "Jonas"],
    bowl: ["Lea"],
    pizza: ["Mira"],
    curry: ["Noah", "Lea"],
    tacos: [],
    salmon: ["Jonas"],
  },
};

let state = loadState();
let dishes = state.dishes?.length ? state.dishes : structuredClone(defaultDishes);
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
const menuPhotoInput = document.querySelector("#menuPhoto");
const photoPreview = document.querySelector("#photoPreview");
const previewBox = document.querySelector(".photo-preview");
const menuTextInput = document.querySelector("#menuText");
const scanPhotoButton = document.querySelector("#scanPhotoButton");
const applyMenuButton = document.querySelector("#applyMenuButton");
const importStatus = document.querySelector("#importStatus");
const roomCode = document.querySelector("#roomCode");
const syncStatus = document.querySelector("#syncStatus");

voterNameInput.value = state.voterName;
roomCode.textContent = roomId;

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

menuPhotoInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  selectedPhoto = file ?? null;

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

scanPhotoButton.addEventListener("click", async () => {
  if (!selectedPhoto) {
    showToast("Bitte zuerst ein Foto auswählen.");
    menuPhotoInput.click();
    return;
  }

  scanPhotoButton.disabled = true;
  setImportStatus("Lese Foto");

  try {
    await loadTesseract();
    const result = await Tesseract.recognize(selectedPhoto, "deu+eng", {
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

applyMenuButton.addEventListener("click", () => {
  const parsedDishes = parseMenuText(menuTextInput.value);

  if (!parsedDishes.length) {
    showToast("Ich konnte noch keine Gerichte erkennen.");
    menuTextInput.focus();
    return;
  }

  dishes = parsedDishes;
  state.dishes = parsedDishes;
  state.filter = "all";
  state.votes = Object.fromEntries(dishes.map((dish) => [dish.id, []]));
  saveState();
  render();
  setImportStatus(`${parsedDishes.length} Gerichte`);
  showToast(`${parsedDishes.length} Gerichte übernommen.`);
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

function setSyncStatus(label) {
  syncStatus.textContent = label;
}

function cleanupOcrText(text) {
  return text
    .replace(/[|]/g, " ")
    .replace(/\s+€/g, " €")
    .replace(/(\d)[,;](\d{2})/g, "$1,$2")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseMenuText(text) {
  const lines = cleanupOcrText(text)
    .split("\n")
    .map((line) => line.replace(/\s{2,}/g, " ").trim())
    .filter((line) => line.length > 2);

  const menuItems = [];

  lines.forEach((line) => {
    const priceMatch = line.match(/(?:€\s*)?(\d{1,2}[,.]\d{2})(?:\s*€)?/);
    if (!priceMatch) return;

    const price = priceMatch[1].replace(".", ",");
    const beforePrice = line.slice(0, priceMatch.index).replace(/[.,;:-]+$/g, "").trim();
    const afterPrice = line.slice(priceMatch.index + priceMatch[0].length).trim();
    const name = titleCase(beforePrice || afterPrice);

    if (!name || name.length < 3) return;

    menuItems.push({
      id: uniqueDishId(name, menuItems),
      name,
      price,
      category: categorizeDish(`${name} ${afterPrice}`),
      icon: chooseDishIcon(`${name} ${afterPrice}`),
      description: afterPrice || "Aus der fotografierten Speisekarte übernommen",
      tags: buildTags(`${name} ${afterPrice}`),
    });
  });

  return menuItems.slice(0, 24);
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
