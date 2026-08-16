"use strict";

const ACCOUNT = "ArasaniRohithReddy";
const API_ROOT = "https://api.github.com";
const PER_PAGE = 100;
const TOKEN_KEY = "github-repository-dashboard-token";

const elements = {
  avatar: document.querySelector("#avatar"),
  profileName: document.querySelector("#profile-name"),
  profileBio: document.querySelector("#profile-bio"),
  publicCount: document.querySelector("#public-count"),
  tokenForm: document.querySelector("#token-form"),
  tokenInput: document.querySelector("#token"),
  signOut: document.querySelector("#sign-out"),
  search: document.querySelector("#search"),
  sort: document.querySelector("#sort"),
  status: document.querySelector("#status"),
  error: document.querySelector("#error"),
  grid: document.querySelector("#repo-grid"),
  empty: document.querySelector("#empty"),
  resultCount: document.querySelector("#result-count"),
};

let repositories = [];

class GitHubApiError extends Error {
  constructor(response) {
    super(`GitHub API request failed with status ${response.status}`);
    this.status = response.status;
    this.rateLimitReset = response.headers.get("x-ratelimit-reset");
  }
}

function token() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function requestHeaders(accessToken = "") {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (accessToken) {
    headers.Authorization = "Bearer " + accessToken;
  }

  return headers;
}

async function githubRequest(path, accessToken = "") {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: requestHeaders(accessToken),
    referrerPolicy: "no-referrer",
  });

  if (!response.ok) {
    throw new GitHubApiError(response);
  }

  return response.json();
}

async function fetchAll(path, accessToken = "") {
  const items = [];

  for (let page = 1; ; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await githubRequest(
      `${path}${separator}per_page=${PER_PAGE}&page=${page}`,
      accessToken,
    );
    items.push(...batch);

    if (batch.length < PER_PAGE) {
      return items;
    }
  }
}

function displayProfile(profile) {
  elements.profileName.textContent = profile.name || profile.login;
  elements.profileBio.textContent = profile.bio || "GitHub repositories and projects";
  elements.publicCount.textContent = `${profile.public_repos.toLocaleString()} public repositories`;
  elements.avatar.src = profile.avatar_url;
  elements.avatar.alt = `${profile.login}'s avatar`;
  elements.avatar.hidden = false;
}

function languageColor(language) {
  let hash = 0;
  for (const character of language) {
    hash = (hash * 31 + character.codePointAt(0)) % 360;
  }
  return `hsl(${hash} 58% 52%)`;
}

function relativeDate(value) {
  const date = new Date(value);
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const intervals = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];

  for (const [unit, size] of intervals) {
    if (elapsedSeconds >= size) {
      return formatter.format(-Math.round(elapsedSeconds / size), unit);
    }
  }

  return formatter.format(-elapsedSeconds, "second");
}

function badge(label, className = "") {
  const item = document.createElement("span");
  item.className = `badge ${className}`.trim();
  item.textContent = label;
  return item;
}

function metric(glyph, count, singular, plural) {
  const item = document.createElement("span");
  const symbol = document.createElement("span");
  symbol.setAttribute("aria-hidden", "true");
  symbol.textContent = `${glyph} ${count.toLocaleString()}`;
  const label = document.createElement("span");
  label.className = "visually-hidden";
  label.textContent = `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
  item.append(symbol, label);
  return item;
}

function createRepoCard(repo) {
  const article = document.createElement("article");
  article.className = `repo-card${repo.private ? " private" : ""}`;

  const heading = document.createElement("div");
  heading.className = "card-heading";
  const title = document.createElement("h3");
  const link = document.createElement("a");
  link.href = `https://github.com/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = repo.name;
  title.append(link);

  const badges = document.createElement("div");
  badges.className = "badges";
  badges.append(badge(repo.private ? "Private" : "Public", repo.private ? "private" : ""));
  if (repo.fork) badges.append(badge("Fork"));
  if (repo.archived) badges.append(badge("Archived"));
  heading.append(title, badges);

  const description = document.createElement("p");
  description.className = "description";
  description.textContent = repo.description || "No description provided.";

  const metadata = document.createElement("div");
  metadata.className = "repo-meta";

  if (repo.language) {
    const language = document.createElement("span");
    const dot = document.createElement("span");
    dot.className = "language-dot";
    dot.style.setProperty("--language-color", languageColor(repo.language));
    language.append(dot, repo.language);
    metadata.append(language);
  }

  const stars = metric("★", repo.stargazers_count, "star", "stars");
  const forks = metric("⑂", repo.forks_count, "fork", "forks");
  const updated = document.createElement("time");
  updated.dateTime = repo.updated_at;
  updated.textContent = `Updated ${relativeDate(repo.updated_at)}`;
  metadata.append(stars, forks, updated);

  article.append(heading, description, metadata);
  return article;
}

function visibleRepositories() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const visible = repositories.filter((repo) => {
    const searchable = `${repo.name} ${repo.description || ""}`.toLocaleLowerCase();
    return searchable.includes(query);
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

function renderRepositories() {
  const visible = visibleRepositories();
  elements.grid.replaceChildren(...visible.map(createRepoCard));
  elements.grid.setAttribute("aria-busy", "false");
  elements.empty.hidden = visible.length !== 0;
  elements.resultCount.textContent =
    `${visible.length.toLocaleString()} of ${repositories.length.toLocaleString()} repositories`;
}

function showError(error, signedIn) {
  let message = "GitHub could not be reached. Check your connection and try again.";

  if (error instanceof GitHubApiError && error.status === 401) {
    message = "This token is invalid or expired. Clear it and try another token.";
  } else if (error instanceof GitHubApiError && error.status === 403) {
    const reset = Number(error.rateLimitReset);
    const resetMessage = Number.isFinite(reset) && reset > 0
      ? ` The limit resets at ${new Date(reset * 1000).toLocaleString()}.`
      : "";
    message = `GitHub API rate limit reached.${resetMessage}${
      signedIn ? "" : " Sign in with a token for a higher rate limit."
    }`;
  }

  elements.error.textContent = message;
  elements.error.hidden = false;
}

function updateTokenControls() {
  const signedIn = Boolean(token());
  elements.signOut.hidden = !signedIn;
  elements.tokenInput.placeholder = signedIn ? "Replace current token" : "github_pat_…";
}

async function loadRepositories() {
  const accessToken = token();
  elements.status.textContent = "Loading repositories…";
  elements.status.classList.add("loading");
  elements.status.hidden = false;
  elements.error.hidden = true;
  elements.empty.hidden = true;
  elements.grid.setAttribute("aria-busy", "true");

  try {
    const [profile, publicRepos] = await Promise.all([
      githubRequest(`/users/${ACCOUNT}`),
      fetchAll(`/users/${ACCOUNT}/repos?sort=updated`),
    ]);
    displayProfile(profile);

    const byId = new Map(publicRepos.map((repo) => [repo.id, repo]));
    if (accessToken) {
      try {
        const accessible = await fetchAll(
          `/users/${ACCOUNT}/repos?sort=updated`,
          accessToken,
        );
        for (const repo of accessible) {
          if (repo.owner.login.toLocaleLowerCase() === ACCOUNT.toLocaleLowerCase()) {
            byId.set(repo.id, repo);
          }
        }
      } catch (error) {
        showError(error, true);
      }
    }

    repositories = [...byId.values()];
    renderRepositories();
    elements.status.textContent = `${repositories.length.toLocaleString()} repositories loaded.`;
    elements.status.classList.remove("loading");
    setTimeout(() => {
      elements.status.hidden = true;
    }, 1200);
  } catch (error) {
    repositories = [];
    renderRepositories();
    showError(error, Boolean(accessToken));
    elements.status.hidden = true;
    elements.status.classList.remove("loading");
  }
}

elements.tokenForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const submittedToken = elements.tokenInput.value.trim();
  if (!submittedToken) return;
  sessionStorage.setItem(TOKEN_KEY, submittedToken);
  elements.tokenInput.value = "";
  updateTokenControls();
  loadRepositories();
});

elements.signOut.addEventListener("click", () => {
  sessionStorage.removeItem(TOKEN_KEY);
  elements.tokenInput.value = "";
  updateTokenControls();
  loadRepositories();
});

elements.search.addEventListener("input", renderRepositories);
elements.sort.addEventListener("change", renderRepositories);

updateTokenControls();
loadRepositories();
