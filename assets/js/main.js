"use strict";

import { GitHubApiError, loadAccountData, validateToken } from "./api.js";
import {
  createRepoCard,
  createRepoDetail,
  computeStats,
  computeLanguageBreakdown,
} from "./render.js";
import {
  applyTheme,
  getStoredTheme,
  getStoredView,
  setStoredTheme,
  setStoredView,
} from "./preferences.js";

const TOKEN_KEY = "github-repository-dashboard-token";
const TOKEN_ACTIVITY_KEY = "github-repository-dashboard-token-last-activity";
const INACTIVITY_MS = 60 * 60 * 1000;
const ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000;
const SEARCH_DEBOUNCE_MS = 150;
const BACK_TO_TOP_OFFSET = 400;
// Natural reading order for each sort; the direction toggle flips it.
const DEFAULT_SORT_DIRECTION = { updated: "desc", name: "asc", stars: "desc" };
const PAGE_SIZE = 24;
const COPY_FEEDBACK_MS = 2000;

// Optional curated allow-list of repository names to surface first. Left empty
// by default: when no name matches, the most-starred repositories are featured
// instead, so no repository data is hard-coded.
const FEATURED_REPO_NAMES = [];
const FEATURED_FALLBACK_COUNT = 3;

const elements = {
  avatar: document.querySelector("#avatar"),
  profileName: document.querySelector("#profile-name"),
  profileBio: document.querySelector("#profile-bio"),
  profileMeta: document.querySelector("#profile-meta"),
  themeButtons: document.querySelectorAll(".theme-btn"),
  viewButtons: document.querySelectorAll(".view-btn"),
  openSignin: document.querySelector("#open-signin"),
  closeSignin: document.querySelector("#close-signin"),
  signinDialog: document.querySelector("#signin-dialog"),
  signinStatus: document.querySelector("#signin-status"),
  tokenForm: document.querySelector("#token-form"),
  tokenInput: document.querySelector("#token"),
  tokenError: document.querySelector("#token-error"),
  signOut: document.querySelector("#sign-out"),
  search: document.querySelector("#search"),
  languageFilter: document.querySelector("#language-filter"),
  visibilityFilter: document.querySelector("#visibility-filter"),
  archivedFilter: document.querySelector("#archived-filter"),
  forkFilter: document.querySelector("#fork-filter"),
  sort: document.querySelector("#sort"),
  sortDirection: document.querySelector("#sort-direction"),
  sortDirectionLabel: document.querySelector("#sort-direction-label"),
  toggleFilters: document.querySelector("#toggle-filters"),
  filterControls: document.querySelector("#filter-controls"),
  disclosureFilterCount: document.querySelector("#disclosure-filter-count"),
  clearFilters: document.querySelector("#clear-filters"),
  copyViewLink: document.querySelector("#copy-view-link"),
  copyAnnouncer: document.querySelector("#copy-announcer"),
  showMore: document.querySelector("#show-more"),
  signinArea: document.querySelector(".signin-area"),
  languageBar: document.querySelector("#language-bar"),
  languageLegend: document.querySelector("#language-legend"),
  languageSummary: document.querySelector("#language-summary"),
  languageFallback: document.querySelector("#language-fallback"),
  languageTooltip: document.querySelector("#language-tooltip"),
  detailDialog: document.querySelector("#detail-dialog"),
  detailTitle: document.querySelector("#detail-title"),
  detailBody: document.querySelector("#detail-body"),
  closeDetail: document.querySelector("#close-detail"),
  shortcutsDialog: document.querySelector("#shortcuts-dialog"),
  openShortcuts: document.querySelector("#open-shortcuts"),
  closeShortcuts: document.querySelector("#close-shortcuts"),
  backToTop: document.querySelector("#back-to-top"),
  emptyFilters: document.querySelector("#empty-filters"),
  emptyClear: document.querySelector("#empty-clear"),
  activeFilterCount: document.querySelector("#active-filter-count"),
  status: document.querySelector("#status"),
  skeletons: document.querySelector("#skeletons"),
  error: document.querySelector("#error"),
  errorMessage: document.querySelector("#error-message"),
  retry: document.querySelector("#retry"),
  grid: document.querySelector("#repo-grid"),
  empty: document.querySelector("#empty"),
  resultCount: document.querySelector("#result-count"),
  statRepos: document.querySelector("#stat-repos"),
  statStars: document.querySelector("#stat-stars"),
  statLanguages: document.querySelector("#stat-languages"),
  statTopLanguage: document.querySelector("#stat-top-language"),
};

let repositories = [];
let featuredIds = new Set();
let visibleLimit = PAGE_SIZE;
// Language requested by the URL before the option list has been populated.
let pendingLanguage = "";
let debouncedSearchRender = null;
let tokenDetails = null;
let inactivityTimer = null;
let lastActivityWrite = 0;
let sortDirection = "desc";

function token() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_ACTIVITY_KEY);
  tokenDetails = null;
  clearTimeout(inactivityTimer);
}

function hasWriteScope(scopes) {
  return scopes
    .split(",")
    .map((scope) => scope.trim().toLowerCase())
    .some((scope) =>
      scope === "repo" ||
      scope === "workflow" ||
      scope.startsWith("write:") ||
      scope.startsWith("delete:") ||
      scope.startsWith("admin:")
    );
}

function armInactivityTimer(lastActivity = Date.now()) {
  clearTimeout(inactivityTimer);
  const remaining = INACTIVITY_MS - (Date.now() - lastActivity);
  if (remaining <= 0) {
    clearToken();
    updateSigninControls();
    loadRepositories();
    return;
  }
  inactivityTimer = setTimeout(() => {
    clearToken();
    updateSigninControls();
    loadRepositories();
  }, remaining);
}

function recordActivity() {
  if (!token() || document.hidden || Date.now() - lastActivityWrite < ACTIVITY_WRITE_INTERVAL_MS) {
    return;
  }
  lastActivityWrite = Date.now();
  sessionStorage.setItem(TOKEN_ACTIVITY_KEY, String(lastActivityWrite));
  armInactivityTimer(lastActivityWrite);
}

// ---------- Segmented radio-group helper (theme / view toggles) ----------

function setRovingTabindex(buttons, activeButton) {
  for (const button of buttons) {
    button.tabIndex = button === activeButton ? 0 : -1;
  }
}

function initSegmentedGroup(buttons, onArrowMove) {
  const list = Array.from(buttons);
  for (const [index, button] of list.entries()) {
    button.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        nextIndex = (index + 1) % list.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        nextIndex = (index - 1 + list.length) % list.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = list.length - 1;
      }
      if (nextIndex === null) {
        return;
      }
      event.preventDefault();
      const nextButton = list[nextIndex];
      nextButton.focus();
      onArrowMove(nextButton);
    });
  }
}

// ---------- Theme ----------

function initTheme() {
  const preferred = getStoredTheme();
  applyTheme(preferred);
  updateThemeButtons(preferred);

  for (const button of elements.themeButtons) {
    button.addEventListener("click", () => {
      const theme = button.dataset.theme;
      setStoredTheme(theme);
      applyTheme(theme);
      updateThemeButtons(theme);
    });
  }

  initSegmentedGroup(elements.themeButtons, (button) => {
    const theme = button.dataset.theme;
    setStoredTheme(theme);
    applyTheme(theme);
    updateThemeButtons(theme);
  });
}

function updateThemeButtons(theme) {
  let activeButton = null;
  for (const button of elements.themeButtons) {
    const isActive = button.dataset.theme === theme;
    button.setAttribute("aria-checked", String(isActive));
    if (isActive) {
      activeButton = button;
    }
  }
  setRovingTabindex(elements.themeButtons, activeButton);
}

// ---------- View mode (grid / list) ----------

function initView(urlParams) {
  // URL parameter wins, then the stored preference.
  const fromUrl = urlParams?.get("view");
  const preferred = fromUrl === "list" || fromUrl === "grid" ? fromUrl : getStoredView();
  applyView(preferred);

  for (const button of elements.viewButtons) {
    button.addEventListener("click", () => setView(button.dataset.view));
  }

  initSegmentedGroup(elements.viewButtons, (button) => setView(button.dataset.view));
}

function setView(view) {
  applyView(view);
  setStoredView(view);
  syncUrl();
}

function applyView(view) {
  elements.grid.classList.toggle("repo-grid--list", view === "list");
  let activeButton = null;
  for (const button of elements.viewButtons) {
    const isActive = button.dataset.view === view;
    button.setAttribute("aria-checked", String(isActive));
    if (isActive) {
      activeButton = button;
    }
  }
  setRovingTabindex(elements.viewButtons, activeButton);
}

// ---------- Sign-in dialog ----------

let lastFocusedBeforeDialog = null;

function openSigninDialog() {
  lastFocusedBeforeDialog = document.activeElement;
  elements.signinDialog.showModal();
  elements.tokenError.hidden = true;
  elements.tokenInput.focus();
}

function closeSigninDialog() {
  elements.signinDialog.close();
  if (lastFocusedBeforeDialog instanceof HTMLElement) {
    lastFocusedBeforeDialog.focus();
  }
}

function initSigninDialog() {
  elements.openSignin.addEventListener("click", openSigninDialog);
  elements.closeSignin.addEventListener("click", closeSigninDialog);
  elements.signinDialog.addEventListener("cancel", (event) => {
    // Let the native Escape-to-cancel behaviour close it, but restore focus.
    event.preventDefault();
    closeSigninDialog();
  });
  elements.signinDialog.addEventListener("click", (event) => {
    if (event.target === elements.signinDialog) {
      closeSigninDialog();
    }
  });
}

function updateSigninControls() {
  const signedIn = Boolean(token());
  // Signed out the area holds a lone button, so drop the grouped-card chrome.
  elements.signinArea.classList.toggle("is-signed-out", !signedIn);
  elements.signOut.hidden = !signedIn;
  elements.openSignin.textContent = signedIn ? "Update token" : "Sign in";
  elements.openSignin.classList.toggle("secondary", signedIn);
  elements.signinStatus.hidden = !signedIn;
  if (signedIn) {
    const details = [];
    if (tokenDetails?.expiration) {
      const expiration = new Date(tokenDetails.expiration);
      details.push(
        Number.isNaN(expiration.getTime())
          ? `Token expires ${tokenDetails.expiration}`
          : `Token expires ${expiration.toLocaleString()}`,
      );
    }
    if (tokenDetails && hasWriteScope(tokenDetails.scopes)) {
      details.push("Warning: switch to a read-only fine-grained token");
      elements.signinStatus.classList.add("signin-status--warning");
    } else {
      elements.signinStatus.classList.remove("signin-status--warning");
    }
    elements.signinStatus.textContent = ["Signed in", ...details].join(" · ");
    elements.signinStatus.title = [
      "Signed in — showing repositories you can access.",
      ...details,
    ].join(" ");
  } else {
    elements.signinStatus.textContent = "";
    elements.signinStatus.removeAttribute("title");
    elements.signinStatus.classList.remove("signin-status--warning");
  }
  elements.tokenInput.placeholder = signedIn ? "Replace current token" : "github_pat_…";
}

// ---------- Profile ----------

function displayProfile(profile) {
  elements.profileName.textContent = profile.name || profile.login;
  elements.profileBio.textContent = profile.bio || "GitHub repositories and projects";
  elements.avatar.src = profile.avatar_url;
  elements.avatar.alt = `${profile.login}'s avatar`;
  elements.avatar.hidden = false;

  const metaItems = [];
  metaItems.push(`${profile.public_repos.toLocaleString()} public repositories`);
  metaItems.push(`${profile.followers.toLocaleString()} followers`);
  metaItems.push(`${profile.following.toLocaleString()} following`);
  if (profile.location) metaItems.push(profile.location);
  if (profile.company) metaItems.push(profile.company);
  if (profile.blog) metaItems.push(profile.blog);

  elements.profileMeta.replaceChildren(
    ...metaItems.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }),
  );
}

// ---------- Filtering / sorting ----------

function populateLanguageFilter() {
  const languages = [...new Set(repositories.map((repo) => repo.language).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
  const current = elements.languageFilter.value;
  elements.languageFilter.replaceChildren(
    Object.assign(document.createElement("option"), { value: "", textContent: "All languages" }),
    ...languages.map((language) =>
      Object.assign(document.createElement("option"), { value: language, textContent: language }),
    ),
  );
  const requested = current || pendingLanguage;
  if (languages.includes(requested)) {
    elements.languageFilter.value = requested;
  }
  pendingLanguage = "";
}

// ---------- Featured repositories ----------

function computeFeaturedIds() {
  const allowList = new Set(FEATURED_REPO_NAMES.map((name) => name.toLocaleLowerCase()));
  const curated = repositories.filter((repo) => allowList.has(repo.name.toLocaleLowerCase()));
  if (curated.length > 0) {
    return new Set(curated.map((repo) => repo.id));
  }

  const starred = repositories
    .filter((repo) => repo.stargazers_count > 0)
    .sort((left, right) => right.stargazers_count - left.stargazers_count)
    .slice(0, FEATURED_FALLBACK_COUNT);
  return new Set(starred.map((repo) => repo.id));
}

// ---------- URL state ----------

const URL_PARAMS = {
  q: () => elements.search.value.trim(),
  lang: () => elements.languageFilter.value || pendingLanguage,
  vis: () => elements.visibilityFilter.value,
  arch: () => elements.archivedFilter.value,
  fork: () => elements.forkFilter.value,
  sort: () => (elements.sort.value === "updated" ? "" : elements.sort.value),
  // Only serialised when it differs from the natural order for this sort.
  dir: () => (sortDirection === defaultSortDirection() ? "" : sortDirection),
  view: () => (elements.grid.classList.contains("repo-grid--list") ? "list" : ""),
};

function defaultSortDirection() {
  return DEFAULT_SORT_DIRECTION[elements.sort.value] || "desc";
}

function isDefaultOrder() {
  return elements.sort.value === "updated" && sortDirection === "desc";
}

function updateSortDirectionControl() {
  const ascending = sortDirection === "asc";
  elements.sortDirection.setAttribute("aria-pressed", String(ascending));
  elements.sortDirection.classList.toggle("is-ascending", ascending);
  const label = ascending ? "Sort ascending" : "Sort descending";
  elements.sortDirectionLabel.textContent = label;
  elements.sortDirection.title = `${label} — activate to reverse the order`;
  elements.sortDirection.setAttribute(
    "aria-label",
    `${label}. Activate to sort ${ascending ? "descending" : "ascending"}.`,
  );
}

function syncUrl() {
  const params = new URLSearchParams();
  for (const [key, read] of Object.entries(URL_PARAMS)) {
    const value = read();
    if (value) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  // replaceState keeps filtering out of the browser history stack.
  window.history.replaceState(null, "", url);
}

function selectValueIfValid(select, value) {
  if (!value) return;
  const allowed = Array.from(select.options, (option) => option.value);
  if (allowed.includes(value)) {
    select.value = value;
  }
}

function applyUrlState() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("q")) {
    elements.search.value = params.get("q");
  }
  pendingLanguage = params.get("lang") || "";
  selectValueIfValid(elements.visibilityFilter, params.get("vis"));
  selectValueIfValid(elements.archivedFilter, params.get("arch"));
  selectValueIfValid(elements.forkFilter, params.get("fork"));
  selectValueIfValid(elements.sort, params.get("sort"));
  const direction = params.get("dir");
  sortDirection = direction === "asc" || direction === "desc" ? direction : defaultSortDirection();
  updateSortDirectionControl();
  return params;
}

function visibleRepositories() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const language = elements.languageFilter.value;
  const visibility = elements.visibilityFilter.value;

  const archived = elements.archivedFilter.value;
  const forks = elements.forkFilter.value;

  const visible = repositories.filter((repo) => {
    const searchable = `${repo.name} ${repo.description || ""}`.toLocaleLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (language && repo.language !== language) return false;
    if (visibility === "public" && repo.private) return false;
    if (visibility === "private" && !repo.private) return false;
    if (archived === "hide" && repo.archived) return false;
    if (archived === "only" && !repo.archived) return false;
    if (forks === "hide" && repo.fork) return false;
    if (forks === "only" && !repo.fork) return false;
    return true;
  });

  // The comparators describe the natural ("default direction") order; the
  // direction toggle reverses the result.
  const flip = sortDirection === defaultSortDirection() ? 1 : -1;
  const defaultOrder = isDefaultOrder();

  return visible.sort((left, right) => {
    if (defaultOrder) {
      // Default ordering only: featured repositories lead, then most recent.
      const featuredDelta =
        Number(featuredIds.has(right.id)) - Number(featuredIds.has(left.id));
      if (featuredDelta !== 0) return featuredDelta;
    }
    if (elements.sort.value === "name") {
      return flip * left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    }
    if (elements.sort.value === "stars") {
      return flip * (right.stargazers_count - left.stargazers_count) ||
        left.name.localeCompare(right.name);
    }
    return flip * (new Date(right.updated_at) - new Date(left.updated_at));
  });
}

function updateStats(visible) {
  const stats = computeStats(visible);
  elements.statRepos.textContent = stats.total.toLocaleString();
  elements.statStars.textContent = stats.totalStars.toLocaleString();
  elements.statLanguages.textContent = stats.languageCount.toLocaleString();
  elements.statTopLanguage.textContent = stats.topLanguage;
}

function sliceDescription(slice) {
  const repos = `${slice.count.toLocaleString()} ${slice.count === 1 ? "repository" : "repositories"}`;
  const contents = slice.grouped?.length
    ? ` — includes ${slice.grouped.map((entry) => entry.language).join(", ")}`
    : "";
  return `${slice.language} · ${slice.percent.toFixed(1)}% · ${repos}${contents}`;
}

function hideLanguageTooltip() {
  elements.languageTooltip.hidden = true;
}

function showLanguageTooltip(target, slice) {
  const tooltip = elements.languageTooltip;
  tooltip.textContent = sliceDescription(slice);
  tooltip.hidden = false;
  const wrap = tooltip.parentElement.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const centre = rect.left - wrap.left + rect.width / 2;
  const half = tooltip.offsetWidth / 2;
  const clamped = Math.min(Math.max(centre, half), Math.max(wrap.width - half, half));
  tooltip.style.left = `${clamped}px`;
}

function toggleLanguageFilter(language) {
  if (!language || language === "Other") return;
  const next = elements.languageFilter.value === language ? "" : language;
  const allowed = Array.from(elements.languageFilter.options, (option) => option.value);
  if (!allowed.includes(next)) return;
  elements.languageFilter.value = next;
  renderFromFilters();
}

function renderLanguageBar(visible) {
  const { slices, counted, unknown } = computeLanguageBreakdown(visible);
  const selected = elements.languageFilter.value;

  // Segments stay presentational so the bar can keep role="img"; the legend
  // buttons below expose the same information to keyboard and screen readers.
  elements.languageBar.replaceChildren(
    ...slices.map((slice) => {
      const segment = document.createElement("span");
      segment.className = "language-segment";
      segment.style.width = `${slice.percent}%`;
      segment.style.background = slice.color;
      segment.classList.toggle("is-selected", slice.language === selected);
      segment.addEventListener("pointerenter", () => showLanguageTooltip(segment, slice));
      segment.addEventListener("pointerleave", hideLanguageTooltip);
      return segment;
    }),
  );
  hideLanguageTooltip();

  elements.languageLegend.replaceChildren(
    ...slices.map((slice) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "language-legend-item";
      const isOther = slice.language === "Other";
      button.disabled = isOther;
      button.classList.toggle("is-selected", slice.language === selected);
      button.setAttribute("aria-pressed", String(slice.language === selected));
      const dot = document.createElement("span");
      dot.className = "language-dot";
      dot.style.setProperty("--language-color", slice.color);
      const label = document.createElement("span");
      label.className = "language-legend-label";
      label.textContent = slice.language;
      const value = document.createElement("span");
      value.className = "language-legend-value";
      value.textContent = `${slice.percent.toFixed(1)}%`;
      const count = document.createElement("span");
      count.className = "visually-hidden";
      count.textContent = `, ${slice.count.toLocaleString()} ${
        slice.count === 1 ? "repository" : "repositories"
      }${isOther ? "" : slice.language === selected ? ", filter active" : ", filter by this language"}`;
      button.append(dot, label, value, count);
      button.title = sliceDescription(slice);
      button.addEventListener("click", () => toggleLanguageFilter(slice.language));
      const segment = elements.languageBar.children[slices.indexOf(slice)];
      const show = () => {
        if (segment) showLanguageTooltip(segment, slice);
      };
      button.addEventListener("focus", show);
      button.addEventListener("pointerenter", show);
      button.addEventListener("blur", hideLanguageTooltip);
      button.addEventListener("pointerleave", hideLanguageTooltip);
      item.append(button);
      return item;
    }),
  );

  const description = slices
    .map((slice) => `${slice.language} ${slice.percent.toFixed(1)}%`)
    .join(", ");
  elements.languageBar.setAttribute(
    "aria-label",
    slices.length
      ? `Language distribution across the repositories currently shown: ${description}.`
      : "No language data available for the repositories currently shown.",
  );
  elements.languageBar.classList.toggle("language-bar--empty", slices.length === 0);

  // Concise caption plus a screen-reader-only text fallback for the bar.
  elements.languageSummary.textContent = slices.length
    ? `Based on ${counted.toLocaleString()} of ${visible.length.toLocaleString()} repositories${
        unknown ? ` (${unknown.toLocaleString()} without a detected language)` : ""
      }`
    : "No language data available for the repositories currently shown.";
  elements.languageFallback.textContent = slices.length ? `${description}.` : "";
}

function describeActiveFilters() {
  const active = [];
  if (elements.search.value.trim()) {
    active.push({ key: "search", label: `Search: “${elements.search.value.trim()}”` });
  }
  if (elements.languageFilter.value) {
    active.push({ key: "language", label: `Language: ${elements.languageFilter.value}` });
  }
  if (elements.visibilityFilter.value) {
    active.push({ key: "visibility", label: `Visibility: ${elements.visibilityFilter.value}` });
  }
  if (elements.archivedFilter.value) {
    active.push({
      key: "archived",
      label: elements.archivedFilter.value === "hide" ? "Archived: hidden" : "Archived: only",
    });
  }
  if (elements.forkFilter.value) {
    active.push({
      key: "fork",
      label: elements.forkFilter.value === "hide" ? "Forks: hidden" : "Forks: only",
    });
  }
  return active;
}

function clearSingleFilter(key) {
  if (key === "search") {
    debouncedSearchRender?.cancel();
    elements.search.value = "";
  } else if (key === "language") {
    elements.languageFilter.value = "";
  } else if (key === "visibility") {
    elements.visibilityFilter.value = "";
  } else if (key === "archived") {
    elements.archivedFilter.value = "";
  } else if (key === "fork") {
    elements.forkFilter.value = "";
  }
  renderFromFilters();
}

function renderEmptyState(active) {
  elements.emptyFilters.replaceChildren(
    ...active.map((filter) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary filter-chip";
      button.textContent = filter.label;
      button.setAttribute("aria-label", `Remove filter ${filter.label}`);
      const remove = document.createElement("span");
      remove.className = "filter-chip-remove";
      remove.setAttribute("aria-hidden", "true");
      remove.textContent = "×";
      button.append(remove);
      button.addEventListener("click", () => clearSingleFilter(filter.key));
      item.append(button);
      return item;
    }),
  );
  elements.emptyClear.hidden = active.length === 0;
}

function renderRepositories() {
  const visible = visibleRepositories();
  const rendered = visible.slice(0, visibleLimit);
  elements.grid.replaceChildren(
    ...rendered.map((repo) => createRepoCard(repo, { featured: featuredIds.has(repo.id) })),
  );
  elements.grid.setAttribute("aria-busy", "false");
  elements.empty.hidden = visible.length !== 0 || repositories.length === 0;

  const remaining = visible.length - rendered.length;
  elements.showMore.hidden = remaining <= 0;
  if (remaining > 0) {
    elements.showMore.textContent = `Show more repositories (${remaining.toLocaleString()} remaining)`;
  }

  elements.resultCount.textContent = repositories.length
    ? `Showing ${visible.length.toLocaleString()} of ${repositories.length.toLocaleString()} repositories${
        remaining > 0 ? ` · ${rendered.length.toLocaleString()} rendered so far` : ""
      }`
    : "";

  const activeFilters = describeActiveFilters();
  const filterCount = activeFilters.length;
  elements.clearFilters.hidden = filterCount === 0;
  elements.activeFilterCount.textContent = filterCount ? ` (${filterCount})` : "";
  elements.disclosureFilterCount.textContent = filterCount ? ` (${filterCount})` : "";
  renderEmptyState(activeFilters);

  updateStats(visible);
  renderLanguageBar(visible);
  syncUrl();
}

function renderFromFilters() {
  visibleLimit = PAGE_SIZE;
  renderRepositories();
}

function showMoreRepositories() {
  visibleLimit += PAGE_SIZE;
  renderRepositories();
  const cards = elements.grid.querySelectorAll(".repo-card");
  const nextCard = cards[Math.max(0, visibleLimit - PAGE_SIZE)];
  nextCard?.querySelector("a")?.focus();
}

function clearFilters() {
  debouncedSearchRender?.cancel();
  elements.search.value = "";
  elements.languageFilter.value = "";
  elements.visibilityFilter.value = "";
  elements.archivedFilter.value = "";
  elements.forkFilter.value = "";
  renderFromFilters();
}

// ---------- Clipboard ----------

function announceCopy(message) {
  elements.copyAnnouncer.textContent = message;
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Fallback for browsers without the async Clipboard API or permission.
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.className = "visually-hidden";
    document.body.append(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    area.remove();
    return copied;
  }
}

async function handleCopyClone(button) {
  const cloneUrl = button.dataset.cloneUrl;
  if (!cloneUrl) return;
  const copied = await copyText(cloneUrl);
  button.classList.toggle("is-copied", copied);
  announceCopy(
    copied
      ? `Clone URL for ${button.dataset.repoName} copied to clipboard.`
      : `Could not copy the clone URL for ${button.dataset.repoName}.`,
  );
  if (copied) {
    setTimeout(() => button.classList.remove("is-copied"), COPY_FEEDBACK_MS);
  }
}

function initCopyControls() {
  elements.grid.addEventListener("click", (event) => {
    const button = event.target instanceof Element
      ? event.target.closest(".copy-clone")
      : null;
    if (button) {
      handleCopyClone(button);
    }
  });

  elements.copyViewLink.addEventListener("click", async () => {
    const copied = await copyText(window.location.href);
    elements.copyViewLink.classList.toggle("is-copied", copied);
    announceCopy(copied ? "Link to this view copied to clipboard." : "Could not copy the link.");
    if (copied) {
      setTimeout(() => elements.copyViewLink.classList.remove("is-copied"), COPY_FEEDBACK_MS);
    }
  });
}

function debounce(fn, delay) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

// ---------- Loading states ----------

function showSkeletons() {
  elements.skeletons.hidden = false;
  elements.grid.hidden = true;
  elements.error.hidden = true;
  elements.empty.hidden = true;
  elements.status.hidden = true;
  elements.grid.setAttribute("aria-busy", "true");
}

function hideSkeletons() {
  elements.skeletons.hidden = true;
  elements.grid.hidden = false;
}

function announceStatus(message) {
  elements.status.hidden = false;
  elements.status.textContent = message;
  setTimeout(() => {
    elements.status.hidden = true;
  }, 2000);
}

function describeError(error, signedIn) {
  if (error instanceof GitHubApiError && error.status === 401) {
    return "This token is invalid or expired. Clear it and try another token.";
  }
  if (error instanceof GitHubApiError && error.status === 403) {
    const reset = Number(error.rateLimitReset);
    const resetMessage = Number.isFinite(reset) && reset > 0
      ? ` The limit resets at ${new Date(reset * 1000).toLocaleString()}.`
      : "";
    return `GitHub API rate limit reached.${resetMessage}${
      signedIn ? "" : " Sign in with a token for a higher rate limit."
    }`;
  }
  return "GitHub could not be reached. Check your connection and try again.";
}

function showError(error, signedIn, { hideRepos = true } = {}) {
  elements.errorMessage.textContent = describeError(error, signedIn);
  elements.error.hidden = false;
  if (hideRepos) {
    elements.grid.hidden = true;
  }
}

// ---------- Load ----------

async function loadRepositories() {
  const accessToken = token();
  showSkeletons();

  try {
    const { profile, repositories: loaded, privateFetchError } = await loadAccountData(
      accessToken,
    );
    displayProfile(profile);
    repositories = loaded;
    featuredIds = computeFeaturedIds();
    hideSkeletons();
    populateLanguageFilter();
    renderFromFilters();

    if (privateFetchError) {
      // Public repositories loaded fine; only the private-repo lookup with
      // the supplied token failed, so keep the grid visible alongside the
      // error banner instead of hiding already-loaded results.
      showError(privateFetchError, true, { hideRepos: false });
    } else {
      elements.error.hidden = true;
      announceStatus(`${repositories.length.toLocaleString()} repositories loaded.`);
    }
  } catch (error) {
    repositories = [];
    featuredIds = new Set();
    hideSkeletons();
    populateLanguageFilter();
    renderFromFilters();
    showError(error, Boolean(accessToken));
  }
}

// ---------- Wiring ----------

function initFilters() {
  debouncedSearchRender = debounce(renderFromFilters, SEARCH_DEBOUNCE_MS);
  elements.search.addEventListener("input", debouncedSearchRender);
  elements.languageFilter.addEventListener("change", renderFromFilters);
  elements.visibilityFilter.addEventListener("change", renderFromFilters);
  elements.archivedFilter.addEventListener("change", renderFromFilters);
  elements.forkFilter.addEventListener("change", renderFromFilters);
  elements.sort.addEventListener("change", () => {
    // Each sort starts in its natural order; the toggle then reverses it.
    sortDirection = defaultSortDirection();
    updateSortDirectionControl();
    renderFromFilters();
  });
  elements.sortDirection.addEventListener("click", () => {
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
    updateSortDirectionControl();
    renderFromFilters();
  });
  elements.clearFilters.addEventListener("click", clearFilters);
  elements.emptyClear.addEventListener("click", clearFilters);
  elements.showMore.addEventListener("click", showMoreRepositories);
}

// ---------- Repository detail dialog ----------

let lastFocusedBeforeDetail = null;

function openDetailDialog(repoId) {
  const repo = repositories.find((item) => String(item.id) === String(repoId));
  if (!repo) return;
  lastFocusedBeforeDetail = document.activeElement;
  elements.detailTitle.textContent = repo.name;
  elements.detailBody.replaceChildren(createRepoDetail(repo));
  elements.detailDialog.showModal();
  elements.closeDetail.focus();
}

function closeDetailDialog() {
  elements.detailDialog.close();
  if (lastFocusedBeforeDetail instanceof HTMLElement) {
    lastFocusedBeforeDetail.focus();
  }
}

function initDetailDialog() {
  elements.closeDetail.addEventListener("click", closeDetailDialog);
  elements.detailDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDetailDialog();
  });
  elements.detailDialog.addEventListener("click", (event) => {
    if (event.target === elements.detailDialog) {
      closeDetailDialog();
    }
  });
  elements.detailBody.addEventListener("click", (event) => {
    const button = event.target instanceof Element
      ? event.target.closest(".copy-clone")
      : null;
    if (button) {
      handleCopyClone(button);
    }
  });

  const openFromEvent = (event) => {
    if (!(event.target instanceof Element)) return null;
    // Links and buttons inside the card keep their own behaviour.
    if (event.target.closest("a, button")) return null;
    return event.target.closest(".repo-card");
  };

  elements.grid.addEventListener("click", (event) => {
    const card = openFromEvent(event);
    if (card) {
      openDetailDialog(card.dataset.repoId);
    }
  });

  elements.grid.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("repo-card")) return;
    event.preventDefault();
    openDetailDialog(target.dataset.repoId);
  });
}

// ---------- Shortcuts dialog ----------

let lastFocusedBeforeShortcuts = null;

function openShortcutsDialog() {
  if (elements.shortcutsDialog.open) return;
  lastFocusedBeforeShortcuts = document.activeElement;
  elements.shortcutsDialog.showModal();
  elements.closeShortcuts.focus();
}

function closeShortcutsDialog() {
  elements.shortcutsDialog.close();
  if (lastFocusedBeforeShortcuts instanceof HTMLElement) {
    lastFocusedBeforeShortcuts.focus();
  }
}

function initShortcutsDialog() {
  elements.openShortcuts.addEventListener("click", openShortcutsDialog);
  elements.closeShortcuts.addEventListener("click", closeShortcutsDialog);
  elements.shortcutsDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeShortcutsDialog();
  });
  elements.shortcutsDialog.addEventListener("click", (event) => {
    if (event.target === elements.shortcutsDialog) {
      closeShortcutsDialog();
    }
  });
}

// ---------- Back to top ----------

function initBackToTop() {
  const update = () => {
    elements.backToTop.hidden = window.scrollY < BACK_TO_TOP_OFFSET;
  };
  window.addEventListener("scroll", update, { passive: true });
  update();

  elements.backToTop.addEventListener("click", () => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    document.querySelector(".skip-link")?.focus();
  });
}

// ---------- Filters disclosure ----------

function initFilterDisclosure() {
  const compact = window.matchMedia("(max-width: 720px)");
  const apply = () => {
    // The disclosure only exists on narrow viewports; wider layouts always
    // show the filter row.
    const expanded = !compact.matches;
    elements.toggleFilters.setAttribute("aria-expanded", String(expanded));
    elements.filterControls.classList.toggle("is-collapsed", !expanded);
  };
  apply();
  compact.addEventListener("change", apply);

  elements.toggleFilters.addEventListener("click", () => {
    const expanded = elements.toggleFilters.getAttribute("aria-expanded") === "true";
    elements.toggleFilters.setAttribute("aria-expanded", String(!expanded));
    elements.filterControls.classList.toggle("is-collapsed", expanded);
  });
}

function initKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isTyping =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA");
    const inDialog =
      target instanceof HTMLElement && Boolean(target.closest("dialog[open]"));

    if (event.key === "/" && !isTyping && !inDialog) {
      event.preventDefault();
      elements.search.focus();
    } else if (event.key === "Escape" && target === elements.search) {
      debouncedSearchRender?.cancel();
      elements.search.value = "";
      renderFromFilters();
    } else if (event.key === "?" && !isTyping && !inDialog) {
      event.preventDefault();
      openShortcutsDialog();
    } else if ((event.key === "g" || event.key === "l") && !isTyping && !inDialog) {
      event.preventDefault();
      setView(event.key === "g" ? "grid" : "list");
    }
  });
}

function initTokenForm() {
  elements.tokenForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submittedToken = elements.tokenInput.value.trim();
    if (!submittedToken) return;
    const submitButton = elements.tokenForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    elements.tokenError.hidden = true;
    try {
      tokenDetails = await validateToken(submittedToken);
      sessionStorage.setItem(TOKEN_KEY, submittedToken);
      sessionStorage.setItem(TOKEN_ACTIVITY_KEY, String(Date.now()));
      elements.tokenInput.value = "";
      updateSigninControls();
      armInactivityTimer();
      closeSigninDialog();
      loadRepositories();
    } catch (error) {
      elements.tokenError.textContent =
        error instanceof GitHubApiError && error.status === 401
          ? "GitHub rejected this token. Check that it is valid and has not expired."
          : "The token could not be validated. Check your connection and try again.";
      elements.tokenError.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });

  elements.signOut.addEventListener("click", () => {
    clearToken();
    elements.tokenInput.value = "";
    updateSigninControls();
    loadRepositories();
  });
}

async function init() {
  const urlParams = applyUrlState();
  initTheme();
  initView(urlParams);
  initSigninDialog();
  initTokenForm();
  initFilters();
  initCopyControls();
  initDetailDialog();
  initShortcutsDialog();
  initBackToTop();
  initFilterDisclosure();
  initKeyboardShortcuts();
  elements.retry.addEventListener("click", loadRepositories);
  for (const eventName of ["pointerdown", "keydown", "scroll"]) {
    document.addEventListener(eventName, recordActivity, { passive: true });
  }
  const storedToken = token();
  if (storedToken) {
    const lastActivity = Number(sessionStorage.getItem(TOKEN_ACTIVITY_KEY));
    if (Date.now() - lastActivity >= INACTIVITY_MS) {
      clearToken();
    } else {
      try {
        tokenDetails = await validateToken(storedToken);
        armInactivityTimer(lastActivity);
      } catch (error) {
        if (error instanceof GitHubApiError && error.status === 401) {
          clearToken();
        }
      }
    }
  }
  updateSigninControls();
  loadRepositories();
}

init();
