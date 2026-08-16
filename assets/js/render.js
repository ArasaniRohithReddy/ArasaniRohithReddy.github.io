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

function topicChips(topics) {
  const wrap = document.createElement("div");
  wrap.className = topics && topics.length > 0 ? "topics" : "topics topics--empty";
  if (!topics || topics.length === 0) {
    wrap.setAttribute("aria-hidden", "true");
    return wrap;
  }
  for (const topic of topics.slice(0, 6)) {
    const chip = document.createElement("span");
    chip.className = "topic-chip";
    chip.textContent = topic;
    wrap.append(chip);
  }
  return wrap;
}

export function createRepoCard(repo) {
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
  const visibilityBadge = badge(repo.private ? "Private" : "Public", repo.private ? "private" : "");
  visibilityBadge.prepend(icon(repo.private ? "lock" : "globe"));
  badges.append(visibilityBadge);
  if (repo.fork) badges.append(badge("Fork"));
  if (repo.archived) {
    const archivedBadge = badge("Archived");
    archivedBadge.prepend(icon("archive"));
    badges.append(archivedBadge);
  }
  heading.append(title, badges);

  const description = document.createElement("p");
  description.className = repo.description ? "description" : "description placeholder";
  description.textContent = repo.description || "No description provided.";
  if (!repo.description) {
    description.setAttribute("aria-hidden", "true");
  }

  const metadata = document.createElement("div");
  metadata.className = "repo-meta";

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

  article.append(heading, description);
  article.append(topicChips(repo.topics), metadata);
  return article;
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
