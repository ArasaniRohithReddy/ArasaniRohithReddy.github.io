"use strict";

// A small built-in map of common GitHub language colours (subset of
// github-linguist's languages.yml). Falls back to a deterministic hash-based
// hue for anything not in the map, so no network request is ever needed.
const LANGUAGE_COLORS = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  Java: "#b07219",
  Go: "#00ADD8",
  Rust: "#dea584",
  Ruby: "#701516",
  PHP: "#4F5D95",
  "C": "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Shell: "#89e051",
  Vue: "#41b883",
  Dart: "#00B4AB",
  Scala: "#c22d40",
  Elixir: "#6e4a7e",
  Haskell: "#5e5086",
  Lua: "#000080",
  Perl: "#0298c3",
  R: "#198CE7",
  "Objective-C": "#438eff",
  "Jupyter Notebook": "#DA5B0B",
  Dockerfile: "#384d54",
};

export function languageColor(language) {
  if (LANGUAGE_COLORS[language]) {
    return LANGUAGE_COLORS[language];
  }

  let hash = 0;
  for (const character of language) {
    hash = (hash * 31 + character.codePointAt(0)) % 360;
  }
  return `hsl(${hash} 58% 52%)`;
}
