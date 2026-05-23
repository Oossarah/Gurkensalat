const supabaseUrl = "https://saekkjrstziirzyztkih.supabase.co";
const supabaseKey = "sb_publishable_ko5UmpkF6RrGrnOOlzDVYg_c1E4vkZO";
const roomTable = "tischwahl_rooms";
const voterColors = ["#0f766e", "#b7791f", "#c2410c", "#7c3aed", "#2563eb", "#be123c", "#15803d", "#a21caf", "#0369a1", "#ca8a04"];
const roomId = getRoomId();
const storageKey = `tischwahl-sichuan-v1-${roomId}`;
const menuSections = window.THE_SICHUAN_MENU ?? [];
const allDishes = menuSections.flatMap((section) => section.items);

let state = loadState();
let supabaseClient = null;
let remoteReady = false;
let applyingRemoteState = false;
let saveRemoteTimer = null;
let toastTimer = null;

const roomCode = document.querySelector("#roomCode");
const syncStatus = document.querySelector("#syncStatus");
const syncDetail = document.querySelector("#syncDetail");
const voterNameInput = document.querySelector("#voterName");
const welcomeForm = document.querySelector("#welcomeForm");
const welcomeNameInput = document.querySelector("#welcomeName");
const shareLinkInput = document.querySelector("#shareLink");
const copyLinkButton = document.querySelector("#copyLinkButton");
const newRoomButton = document.querySelector("#newRoomButton");
const searchInput = document.querySelector("#searchInput");
const sectionFilter = document.querySelector("#sectionFilter");
const viewFilter = document.querySelector("#viewFilter");
const voteCounter = document.querySelector("#voteCounter");
const menuHeading = document.querySelector("#menuHeading");
const menuList = document.querySelector("#menuList");
const resultsList = document.querySelector("#resultsList");
const orderSummary = document.querySelector("#orderSummary");
const resetButton = document.querySelector("#resetButton");
const clearMyVotesButton = document.querySelector("#clearMyVotesButton");
const toast = document.querySelector("#toast");

roomCode.textContent = roomId;
shareLinkInput.value = getShareUrl();
voterNameInput.value = state.voterName;
welcomeNameInput.value = state.voterName;

sectionFilter.innerHTML = [
  `<option value="all">Alle Kategorien</option>`,
  ...menuSections.map((section) => `<option value="${escapeHtml(section.id)}">${escapeHtml(section.name)}</option>`),
].join("");

voterNameInput.addEventListener("input", () => {
  const previousName = state.voterName.trim();
  const nextName = voterNameInput.value.trim();
  state.voterName = voterNameInput.value;
  welcomeNameInput.value = state.voterName;

  if (previousName && nextName && previousName !== nextName) {
    Object.keys(state.votes).forEach((dishId) => {
      state.votes[dishId] = state.votes[dishId].map((name) => (name === previousName ? nextName : name));
    });
  }

  saveState();
  render();
});

welcomeNameInput.addEventListener("input", () => {
  voterNameInput.value = welcomeNameInput.value;
});

welcomeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const nextName = welcomeNameInput.value.trim();
  if (!nextName) {
    welcomeNameInput.focus();
    showToast("Bitte zuerst deinen Namen eintragen.");
    return;
  }

  voterNameInput.value = welcomeNameInput.value;
  voterNameInput.dispatchEvent(new Event("input"));
  document.querySelector("#menuSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

searchInput.addEventListener("input", render);
sectionFilter.addEventListener("change", render);
viewFilter.addEventListener("change", render);

copyLinkButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(getShareUrl());
    showToast("Link kopiert.");
  } catch {
    shareLinkInput.select();
    showToast("Link ist markiert.");
  }
});

newRoomButton.addEventListener("click", () => {
  const nextRoom = `gurke-${Math.random().toString(36).slice(2, 7)}`;
  const url = new URL(window.location.href);
  url.searchParams.set("room", nextRoom);
  window.location.href = url.toString();
});

clearMyVotesButton.addEventListener("click", () => {
  const voterName = state.voterName.trim();
  if (!voterName) {
    voterNameInput.focus();
    showToast("Bitte zuerst deinen Namen eintragen.");
    return;
  }

  allDishes.forEach((dish) => {
    state.votes[dish.id] = (state.votes[dish.id] ?? []).filter((name) => name !== voterName);
  });
  saveState();
  render();
});

resetButton.addEventListener("click", () => {
  state.votes = buildEmptyVotes();
  saveState();
  render();
  showToast("Alle Stimmen wurden zurückgesetzt.");
});

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return {
      voterName: saved?.voterName ?? "",
      votes: buildVotes(saved?.votes),
    };
  } catch {
    return {
      voterName: "",
      votes: buildEmptyVotes(),
    };
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  scheduleRemoteSave();
}

function buildEmptyVotes() {
  return Object.fromEntries(allDishes.map((dish) => [dish.id, []]));
}

function buildVotes(savedVotes = {}) {
  return Object.fromEntries(
    allDishes.map((dish) => [
      dish.id,
      normalizeVoters(savedVotes?.[dish.id]),
    ]),
  );
}

function render() {
  const filteredDishes = getFilteredDishes();
  const selectedIds = getSelectedIds();

  updateNameGate();
  updateCurrentVoterColor();
  voteCounter.textContent = selectedIds.length;
  menuHeading.textContent = `${filteredDishes.length} von ${allDishes.length} Gerichten`;

  menuList.innerHTML = filteredDishes.length
    ? renderMenuGroups(filteredDishes)
    : `<div class="empty-state">Keine Gerichte gefunden.</div>`;

  menuList.querySelectorAll("[data-dish]").forEach((button) => {
    button.addEventListener("click", () => toggleVote(button.dataset.dish));
  });

  renderResults();
}

function renderMenuGroups(filteredDishes) {
  const grouped = menuSections
    .map((section) => ({
      section,
      dishes: filteredDishes.filter((dish) => dish.sectionId === section.id),
    }))
    .filter((group) => group.dishes.length > 0);

  const hasActiveFilter = Boolean(searchInput.value.trim()) || sectionFilter.value !== "all" || viewFilter.value !== "all";

  return grouped
    .map((group, index) => renderMenuGroup(group, hasActiveFilter || index === 0))
    .join("");
}

function renderMenuGroup(group, open) {
  return `
    <details class="menu-group" ${open ? "open" : ""}>
      <summary>
        <span>${escapeHtml(group.section.name)}</span>
        <small>${group.dishes.length}</small>
      </summary>
      <div class="menu-list">
        ${group.dishes.map(renderDishCard).join("")}
      </div>
    </details>
  `;
}

function getFilteredDishes() {
  const search = normalize(searchInput.value);
  const section = sectionFilter.value;
  const view = viewFilter.value;
  const voterName = state.voterName.trim();

  return allDishes.filter((dish) => {
    const voters = normalizeVoters(state.votes[dish.id]);
    const selected = voterName && voters.includes(voterName);
    const haystack = normalize(`${dish.name} ${dish.description} ${dish.section} ${dish.labels.join(" ")}`);

    if (section !== "all" && dish.sectionId !== section) return false;
    if (search && !haystack.includes(search)) return false;
    if (view === "selected" && !selected) return false;
    if (view === "popular" && voters.length === 0) return false;
    return true;
  });
}

function renderDishCard(dish) {
  const voterName = state.voterName.trim();
  const voters = normalizeVoters(state.votes[dish.id]);
  const selected = voterName && voters.includes(voterName);
  const labels = [dish.section, ...dish.labels].slice(0, 4);
  const dishName = getDisplayDishName(dish);

  return `
    <article class="dish-card ${selected ? "selected" : ""}">
      <div class="dish-main">
        <div class="dish-top">
          <h3>${escapeHtml(dishName)}</h3>
          <strong>€ ${escapeHtml(formatPrice(dish.price))}</strong>
        </div>
        <p>${escapeHtml(dish.description || "The Sichuan Speisekarte")}</p>
        <div class="tags">${labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>
      </div>
      <div class="dish-action">
        <div class="voter-summary">
          <span>${formatPersonCount(voters.length)}</span>
          ${renderVoterMarkers(voters, false)}
        </div>
        <button class="vote-button" type="button" data-dish="${escapeHtml(dish.id)}">
          ${selected ? "Gewählt" : "Wählen"}
        </button>
      </div>
    </article>
  `;
}

function renderResults() {
  const ranked = allDishes
    .map((dish) => ({ ...dish, count: normalizeVoters(state.votes[dish.id]).length }))
    .filter((dish) => dish.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const grouped = menuSections
    .map((section) => ({
      section,
      dishes: ranked.filter((dish) => dish.sectionId === section.id),
    }))
    .filter((group) => group.dishes.length > 0);

  resultsList.innerHTML = grouped.length
    ? grouped.map(renderResultGroup).join("")
    : `<div class="empty-state">Noch keine Stimmen.</div>`;

  orderSummary.textContent = ranked.length
    ? ranked.slice(0, 4).map((dish) => `${getDisplayDishName(dish)} (${dish.count})`).join(" · ")
    : "Noch offen";
}

function renderResultGroup(group) {
  const totalVotes = group.dishes.reduce((sum, dish) => sum + dish.count, 0);

  return `
    <section class="result-group">
      <div class="result-group-heading">
        <strong>${escapeHtml(group.section.name)}</strong>
        <span>${totalVotes}</span>
      </div>
      <div class="result-group-list">
        ${group.dishes.map(renderResultRow).join("")}
      </div>
    </section>
  `;
}

function renderResultRow(dish) {
  const voters = normalizeVoters(state.votes[dish.id]);
  return `
    <div class="result-row">
      <div class="result-meta">
        <strong>${escapeHtml(getDisplayDishName(dish))}</strong>
        <span>${formatPersonCount(voters.length)}</span>
      </div>
    </div>
  `;
}

function toggleVote(dishId) {
  const voterName = state.voterName.trim();
  if (!voterName) {
    voterNameInput.focus();
    showToast("Bitte zuerst deinen Namen eintragen.");
    return;
  }

  const votes = normalizeVoters(state.votes[dishId]);
  const selected = votes.includes(voterName);

  if (selected) {
    state.votes[dishId] = votes.filter((name) => name !== voterName);
  } else {
    state.votes[dishId] = [...votes, voterName];
  }

  saveState();
  render();
}

function getSelectedIds() {
  const voterName = state.voterName.trim();
  if (!voterName) return [];
  return allDishes.filter((dish) => normalizeVoters(state.votes[dish.id]).includes(voterName)).map((dish) => dish.id);
}

function normalizeVoters(voters = []) {
  if (!Array.isArray(voters)) return [];
  return [...new Set(voters.map((name) => String(name).trim()).filter(Boolean))];
}

function getDisplayDishName(dish) {
  return stripChineseCharacters(dish.name) || stripChineseCharacters(dish.description) || "Gericht";
}

function stripChineseCharacters(value) {
  return String(value)
    .replace(/[\u3400-\u9fff\uf900-\ufaff]/g, "")
    .replace(/[（）]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPersonCount(count) {
  return `${count} Person${count === 1 ? "" : "en"}`;
}

function renderVoterMarkers(voters, showNames) {
  const cleanVoters = normalizeVoters(voters);
  if (!cleanVoters.length) return `<div class="voter-markers empty" aria-label="Noch niemand gewählt"></div>`;

  return `
    <div class="voter-markers ${showNames ? "with-names" : ""}" aria-label="${escapeHtml(cleanVoters.join(", "))}">
      ${cleanVoters
        .map((name) => {
          const color = getVoterColor(name);
          const initials = getInitials(name);
          return showNames
            ? `<span class="voter-pill" style="--voter-color: ${color};"><i>${escapeHtml(initials)}</i>${escapeHtml(name)}</span>`
            : `<i class="voter-dot" style="--voter-color: ${color};" title="${escapeHtml(name)}">${escapeHtml(initials)}</i>`;
        })
        .join("")}
    </div>
  `;
}

function getVoterColor(name) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return voterColors[hash % voterColors.length];
}

function getInitials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function updateCurrentVoterColor() {
  const voterName = state.voterName.trim();
  document.documentElement.style.setProperty("--current-voter-color", voterName ? getVoterColor(voterName) : "#efc5bf");
}

function updateNameGate() {
  document.body.classList.toggle("has-voter-name", Boolean(state.voterName.trim()));
}

async function initializeSharedRoom() {
  if (!window.supabase?.createClient) {
    setSyncStatus("Lokal", "Supabase-Bibliothek nicht geladen");
    return;
  }

  supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
  setSyncStatus("Verbinde", "Online-Abstimmung wird geprüft");

  try {
    const { data, error } = await supabaseClient
      .from(roomTable)
      .select("data")
      .eq("room_id", roomId)
      .maybeSingle();
    if (error) throw error;

    if (data?.data?.votes) applyRemoteState(data.data);
    else await saveRemoteState();

    remoteReady = true;
    setSyncStatus("Online", "Verbunden");
    subscribeToRoom();
  } catch (error) {
    console.error(error);
    const message = getSupabaseErrorMessage(error);
    setSyncStatus("Lokal", message);
    showToast(message);
  }
}

function subscribeToRoom() {
  supabaseClient
    .channel(`tischwahl:${roomId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: roomTable, filter: `room_id=eq.${roomId}` },
      (payload) => {
        if (payload.new?.data?.votes) applyRemoteState(payload.new.data);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setSyncStatus("Live", "Änderungen werden synchronisiert");
    });
}

function scheduleRemoteSave() {
  if (!remoteReady || applyingRemoteState || !supabaseClient) return;
  clearTimeout(saveRemoteTimer);
  saveRemoteTimer = setTimeout(saveRemoteState, 250);
}

async function saveRemoteState() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from(roomTable).upsert({
    room_id: roomId,
    data: {
      menu: "the-sichuan",
      votes: state.votes,
    },
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error(error);
    const message = getSupabaseErrorMessage(error);
    setSyncStatus("Lokal", message);
    showToast(message);
  }
}

function applyRemoteState(remoteState) {
  applyingRemoteState = true;
  state.votes = buildVotes(remoteState.votes);
  localStorage.setItem(storageKey, JSON.stringify(state));
  render();
  applyingRemoteState = false;
}

function getRoomId() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("room") || window.location.hash.replace("#", "") || "gurkensalat";
  return raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "gurkensalat";
}

function getShareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  url.hash = "";
  return url.toString();
}

function setSyncStatus(label, detail = "") {
  syncStatus.textContent = label;
  syncDetail.textContent = detail;
}

function normalize(value) {
  return String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function formatPrice(price) {
  return String(price).replace(".", ",");
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

function getSupabaseErrorMessage(error) {
  const message = String(error?.message ?? "");
  if (message.includes(roomTable) || message.includes("schema cache")) {
    return "Online-Tabelle fehlt. Bitte Supabase SQL erneut ausführen.";
  }
  if (message.toLowerCase().includes("permission") || message.includes("row-level security") || message.includes("RLS")) {
    return "Supabase-Rechte fehlen. Bitte RLS-Policies prüfen.";
  }
  if (message.toLowerCase().includes("failed to fetch") || message.toLowerCase().includes("network")) {
    return "Keine Verbindung zu Supabase. Internet/Key prüfen.";
  }
  return "Online-Abstimmung nicht erreichbar. Supabase prüfen.";
}

render();
initializeSharedRoom();
