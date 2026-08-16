"use strict";

import { languageColor } from "./languages.js";

export function relativeDate(value) {
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

  return formatter.format(-elapsedSeconds || 0, "second");
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}

function badge(label, className = "") {
  const item = document.createElement("span");
  item.className = `badge ${className}`.trim();
  item.textContent = label;
  return item;
}

function metric(iconName, count, singular, plural) {
  const item = document.createElement("span");
  item.className = "metric";
  item.append(icon(iconName));
  const value = document.createElement("span");
  value.setAttribute("aria-hidden", "true");
  value.textContent = count.toLocaleString();
  const label = document.createElement("span");
  label.className = "visually-hidden";
  label.textContent = `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
  item.append(value, label);
  return item;
}

const MAX_TOPIC_CHIPS = 3;

function topicChips(topics) {
  const wrap = document.createElement("div");
  const list = Array.isArray(topics) ? topics : [];
  wrap.className = list.length > 0 ? "topics" : "topics topics--empty";
  if (list.length === 0) {
    wrap.setAttribute("aria-hidden", "true");
    return wrap;
  }
  for (const topic of list.slice(0, MAX_TOPIC_CHIPS)) {
    const chip = document.createElement("span");
    chip.className = "topic-chip";
    chip.textContent = topic;
    chip.title = topic;
    wrap.append(chip);
  }
  const overflow = list.length - MAX_TOPIC_CHIPS;
  if (overflow > 0) {
    const chip = document.createElement("span");
    chip.className = "topic-chip topic-chip--more";
    chip.textContent = `+${overflow}`;
    chip.title = list.slice(MAX_TOPIC_CHIPS).join(", ");
    wrap.append(chip);
  }
  return wrap;
}

function copyCloneButton(repo) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-clone icon-button";
  button.dataset.cloneUrl = repo.clone_url || "";
  button.dataset.repoName = repo.name;
  button.setAttribute("aria-label", `Copy clone URL for ${repo.name}`);
  button.title = `Copy clone URL for ${repo.name}`;
  button.append(icon("copy"), icon("check"));
  const feedback = document.createElement("span");
  feedback.className = "copy-clone-feedback";
  feedback.setAttribute("aria-hidden", "true");
  feedback.textContent = "Copied!";
  button.append(feedback);
  return button;
}

export function createRepoCard(repo, { featured = false } = {}) {
  const article = document.createElement("article");
  article.className = `repo-card${repo.private ? " private" : ""}${
    featured ? " repo-card--featured" : ""
  }`;
  article.dataset.repoId = String(repo.id);
  article.tabIndex = 0;
  article.setAttribute("role", "button");
  article.setAttribute("aria-label", `${repo.name} — open details`);

  // Zone 1: header — title, badges and the copy button, at a fixed height so
  // every card in a row lines up regardless of how long the repo name is.
  const heading = document.createElement("header");
  heading.className = "card-header";
  const title = document.createElement("h3");
  title.className = "card-title";
  const link = document.createElement("a");
  link.href = `https://github.com/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = repo.name;
  link.title = repo.name;
  title.append(link);

  const badges = document.createElement("div");
  badges.className = "badges";
  if (featured) {
    const featuredBadge = badge("Featured", "featured");
    featuredBadge.prepend(icon("sparkle"));
    badges.append(featuredBadge);
  }
  const visibilityBadge = badge(repo.private ? "Private" : "Public", repo.private ? "private" : "");
  visibilityBadge.prepend(icon(repo.private ? "lock" : "globe"));
  badges.append(visibilityBadge);
  if (repo.fork) badges.append(badge("Fork"));
  if (repo.archived) {
    const archivedBadge = badge("Archived");
    archivedBadge.prepend(icon("archive"));
    badges.append(archivedBadge);
  }
  // Title and the copy button share the first header row; badges always get
  // their own row, so a long name can never push them out of place.
  heading.append(title);
  if (repo.clone_url) {
    heading.append(copyCloneButton(repo));
  }
  heading.append(badges);

  // Zone 2: body — description clamped to a fixed number of lines, then a
  // single clamped row of topic chips.
  const body = document.createElement("div");
  body.className = "card-body";
  const description = document.createElement("p");
  description.className = repo.description ? "description" : "description placeholder";
  description.textContent = repo.description || "No description provided.";
  if (repo.description) {
    description.title = repo.description;
  } else {
    description.setAttribute("aria-hidden", "true");
  }
  body.append(description, topicChips(repo.topics));

  // Zone 3: footer — pinned to the bottom so metrics align across the row.
  const metadata = document.createElement("footer");
  metadata.className = "card-footer repo-meta";

  if (repo.language) {
    const language = document.createElement("span");
    language.className = "language";
    const dot = document.createElement("span");
    dot.className = "language-dot";
    dot.style.setProperty("--language-color", languageColor(repo.language));
    language.append(dot, repo.language);
    metadata.append(language);
  }

  metadata.append(
    metric("star", repo.stargazers_count, "star", "stars"),
    metric("fork", repo.forks_count, "fork", "forks"),
  );

  const updated = document.createElement("time");
  updated.className = "updated";
  updated.dateTime = repo.updated_at;
  updated.append(icon("clock"));
  const updatedText = document.createElement("span");
  updatedText.textContent = `Updated ${relativeDate(repo.updated_at)}`;
  updated.append(updatedText);
  metadata.append(updated);

  article.append(heading, body, metadata);
  return article;
}

function absoluteDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function detailRow(label, value) {
  const row = document.createElement("div");
  row.className = "detail-row";
  const term = document.createElement("dt");
  term.textContent = label;
  const definition = document.createElement("dd");
  if (value instanceof Node) {
    definition.append(value);
  } else {
    definition.textContent = value;
  }
  row.append(term, definition);
  return row;
}

function externalLink(href, text) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.textContent = text;
  return anchor;
}

/**
 * Detail view for the repository dialog. Uses only fields already present in
 * the repositories response — it never triggers another API request.
 */
export function createRepoDetail(repo) {
  const fragment = document.createDocumentFragment();

  const badges = document.createElement("div");
  badges.className = "badges detail-badges";
  const visibilityBadge = badge(repo.private ? "Private" : "Public", repo.private ? "private" : "");
  visibilityBadge.prepend(icon(repo.private ? "lock" : "globe"));
  badges.append(visibilityBadge);
  if (repo.fork) badges.append(badge("Fork"));
  if (repo.archived) badges.append(badge("Archived"));
  fragment.append(badges);

  const description = document.createElement("p");
  description.className = repo.description ? "detail-description" : "detail-description placeholder";
  description.textContent = repo.description || "No description provided.";
  fragment.append(description);

  if (Array.isArray(repo.topics) && repo.topics.length > 0) {
    const topics = document.createElement("div");
    topics.className = "topics detail-topics";
    for (const topic of repo.topics) {
      const chip = document.createElement("span");
      chip.className = "topic-chip";
      chip.textContent = topic;
      topics.append(chip);
    }
    fragment.append(topics);
  }

  const list = document.createElement("dl");
  list.className = "detail-grid";
  list.append(
    detailRow("Language", repo.language || "Not detected"),
    detailRow("Stars", repo.stargazers_count.toLocaleString()),
    detailRow("Forks", repo.forks_count.toLocaleString()),
    detailRow("Watchers", (repo.watchers_count ?? 0).toLocaleString()),
    detailRow("Open issues", (repo.open_issues_count ?? 0).toLocaleString()),
    detailRow("Licence", repo.license?.name || "Not specified"),
    detailRow("Default branch", repo.default_branch || "Unknown"),
    detailRow("Size", `${(repo.size ?? 0).toLocaleString()} KB`),
    detailRow("Created", absoluteDate(repo.created_at)),
    detailRow("Updated", absoluteDate(repo.updated_at)),
    detailRow("Last push", absoluteDate(repo.pushed_at)),
  );
  if (repo.homepage) {
    list.append(detailRow("Homepage", externalLink(repo.homepage, repo.homepage)));
  }
  fragment.append(list);

  const actions = document.createElement("div");
  actions.className = "detail-actions";
  actions.append(
    externalLink(
      `https://github.com/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}`,
      "Open on GitHub",
    ),
  );
  if (repo.clone_url) {
    const cloneRow = document.createElement("div");
    cloneRow.className = "detail-clone";
    const code = document.createElement("code");
    code.textContent = repo.clone_url;
    const copyButton = copyCloneButton(repo);
    copyButton.classList.add("detail-copy");
    cloneRow.append(code, copyButton);
    actions.append(cloneRow);
  }
  fragment.append(actions);

  return fragment;
}

export function computeStats(repositories) {
  const totalStars = repositories.reduce((sum, repo) => sum + repo.stargazers_count, 0);
  const languageCounts = new Map();
  for (const repo of repositories) {
    if (!repo.language) continue;
    languageCounts.set(repo.language, (languageCounts.get(repo.language) || 0) + 1);
  }
  let topLanguage = "–";
  let topCount = 0;
  for (const [language, count] of languageCounts) {
    if (count > topCount) {
      topLanguage = language;
      topCount = count;
    }
  }

  return {
    total: repositories.length,
    totalStars,
    languageCount: languageCounts.size,
    topLanguage,
  };
}

/**
 * Language distribution across the supplied repositories, derived from the
 * already-fetched `repo.language` field. Never issues extra API requests.
 */
export function computeLanguageBreakdown(repositories, maxSlices = 6, minPercent = 3) {
  const counts = new Map();
  let counted = 0;
  for (const repo of repositories) {
    if (!repo.language) continue;
    counts.set(repo.language, (counts.get(repo.language) || 0) + 1);
    counted += 1;
  }

  const sorted = [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );

  const slices = [];
  const grouped = [];
  for (const [index, [language, count]] of sorted.entries()) {
    const percent = (count / counted) * 100;
    // Very small slices are unreadable, so they roll up into "Other" alongside
    // anything beyond the maximum slice count.
    if (index >= maxSlices || (percent < minPercent && sorted.length > maxSlices)) {
      grouped.push({ language, count, percent });
      continue;
    }
    slices.push({ language, count, percent, color: languageColor(language) });
  }

  if (grouped.length > 0) {
    const remainder = grouped.reduce((sum, entry) => sum + entry.count, 0);
    slices.push({
      language: "Other",
      count: remainder,
      percent: (remainder / counted) * 100,
      color: "var(--muted)",
      grouped,
    });
  }

  return { slices, counted, unknown: repositories.length - counted };
}
