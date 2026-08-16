"use strict";

import { GitHubApiError, loadAccountData, validateToken } from "./api.js";
import { createRepoCard, computeStats } from "./render.js";
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
  sort: document.querySelector("#sort"),
  clearFilters: document.querySelector("#clear-filters"),
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
let debouncedSearchRender = null;
let tokenDetails = null;
let inactivityTimer = null;
let lastActivityWrite = 0;

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
    .map((scope) => scope.trim().toLocaleLowerCase())
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

function initView() {
  const preferred = getStoredView();
  applyView(preferred);

  for (const button of elements.viewButtons) {
    button.addEventListener("click", () => {
      applyView(button.dataset.view);
      setStoredView(button.dataset.view);
    });
  }

  initSegmentedGroup(elements.viewButtons, (button) => {
    applyView(button.dataset.view);
    setStoredView(button.dataset.view);
  });
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
  if (languages.includes(current)) {
    elements.languageFilter.value = current;
  }
}

function activeFilterCount() {
  let count = 0;
  if (elements.search.value.trim()) count += 1;
  if (elements.languageFilter.value) count += 1;
  if (elements.visibilityFilter.value) count += 1;
  return count;
}

function visibleRepositories() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const language = elements.languageFilter.value;
  const visibility = elements.visibilityFilter.value;

  const visible = repositories.filter((repo) => {
    const searchable = `${repo.name} ${repo.description || ""}`.toLocaleLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (language && repo.language !== language) return false;
    if (visibility === "public" && repo.private) return false;
    if (visibility === "private" && !repo.private) return false;
    return true;
  });

  return visible.sort((left, right) => {
    if (elements.sort.value === "name") {
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    }
    if (elements.sort.value === "stars") {
      return right.stargazers_count - left.stargazers_count ||
        left.name.localeCompare(right.name);
    }
    return new Date(right.updated_at) - new Date(left.updated_at);
  });
}

function updateStats(visible) {
  const stats = computeStats(visible);
  elements.statRepos.textContent = stats.total.toLocaleString();
  elements.statStars.textContent = stats.totalStars.toLocaleString();
  elements.statLanguages.textContent = stats.languageCount.toLocaleString();
  elements.statTopLanguage.textContent = stats.topLanguage;
}

function renderRepositories() {
  const visible = visibleRepositories();
  elements.grid.replaceChildren(...visible.map(createRepoCard));
  elements.grid.setAttribute("aria-busy", "false");
  elements.empty.hidden = visible.length !== 0 || repositories.length === 0;
  elements.resultCount.textContent = repositories.length
    ? `Showing ${visible.length.toLocaleString()} of ${repositories.length.toLocaleString()} repositories`
    : "";

  const filterCount = activeFilterCount();
  elements.clearFilters.hidden = filterCount === 0;
  elements.activeFilterCount.textContent = filterCount ? ` (${filterCount})` : "";

  updateStats(visible);
}

function clearFilters() {
  debouncedSearchRender?.cancel();
  elements.search.value = "";
  elements.languageFilter.value = "";
  elements.visibilityFilter.value = "";
  renderRepositories();
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
    hideSkeletons();
    populateLanguageFilter();
    renderRepositories();

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
    hideSkeletons();
    populateLanguageFilter();
    renderRepositories();
    showError(error, Boolean(accessToken));
  }
}

// ---------- Wiring ----------

function initFilters() {
  debouncedSearchRender = debounce(renderRepositories, SEARCH_DEBOUNCE_MS);
  elements.search.addEventListener("input", debouncedSearchRender);
  elements.languageFilter.addEventListener("change", renderRepositories);
  elements.visibilityFilter.addEventListener("change", renderRepositories);
  elements.sort.addEventListener("change", renderRepositories);
  elements.clearFilters.addEventListener("click", clearFilters);
}

function initKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isTyping =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA");

    if (event.key === "/" && !isTyping) {
      event.preventDefault();
      elements.search.focus();
    } else if (event.key === "Escape" && target === elements.search) {
      debouncedSearchRender?.cancel();
      elements.search.value = "";
      renderRepositories();
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
  initTheme();
  initView();
  initSigninDialog();
  initTokenForm();
  initFilters();
  initKeyboardShortcuts();
  elements.retry.addEventListener("click", loadRepositories);
  for (const eventName of ["pointerdown", "keydown", "scroll"]) {
    document.addEventListener(eventName, recordActivity, { passive: true });
  }
  const storedToken = token();
  if (storedToken) {
    const lastActivity = Number(sessionStorage.getItem(TOKEN_ACTIVITY_KEY)) || Date.now();
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
