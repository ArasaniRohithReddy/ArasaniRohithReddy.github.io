"use strict";

const THEME_KEY = "github-repository-dashboard-theme";
const VIEW_KEY = "github-repository-dashboard-view";

export function getStoredTheme() {
  const value = localStorage.getItem(THEME_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

export function setStoredTheme(theme) {
  if (theme === "system") {
    localStorage.removeItem(THEME_KEY);
  } else {
    localStorage.setItem(THEME_KEY, theme);
  }
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

export function getStoredView() {
  const value = localStorage.getItem(VIEW_KEY);
  return value === "list" ? "list" : "grid";
}

export function setStoredView(view) {
  localStorage.setItem(VIEW_KEY, view);
}
