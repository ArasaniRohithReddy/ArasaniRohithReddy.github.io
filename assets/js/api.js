"use strict";

export const ACCOUNT = "ArasaniRohithReddy";
const API_ROOT = "https://api.github.com";
const PER_PAGE = 100;

export class GitHubApiError extends Error {
  constructor(response) {
    super(`GitHub API request failed with status ${response.status}`);
    this.status = response.status;
    this.rateLimitReset = response.headers.get("x-ratelimit-reset");
  }
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

export async function githubRequest(path, accessToken = "") {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: requestHeaders(accessToken),
    referrerPolicy: "no-referrer",
  });

  if (!response.ok) {
    throw new GitHubApiError(response);
  }

  return await response.json();
}

export async function fetchAll(path, accessToken = "") {
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

/**
 * Loads the public profile plus the union of publicly-visible repositories
 * and (if a token is supplied) repositories the token owner can access.
 *
 * Returns { profile, repositories, privateFetchError }.
 */
export async function loadAccountData(accessToken) {
  const [profile, publicRepos] = await Promise.all([
    githubRequest(`/users/${ACCOUNT}`),
    fetchAll(`/users/${ACCOUNT}/repos?sort=updated`),
  ]);

  const byId = new Map(publicRepos.map((repo) => [repo.id, repo]));
  let privateFetchError = null;

  if (accessToken) {
    try {
      // Must use /user/repos: /users/{username}/repos cannot return another
      // user's private repos, even when an Authorization token is present.
      // Do not "optimise" this back to /users/{ACCOUNT}/repos.
      const accessible = await fetchAll(
        `/user/repos?sort=updated&affiliation=owner,collaborator`,
        accessToken,
      );
      for (const repo of accessible) {
        if (repo.owner.login.toLocaleLowerCase() === ACCOUNT.toLocaleLowerCase()) {
          byId.set(repo.id, repo);
        }
      }
    } catch (error) {
      privateFetchError = error;
    }
  }

  return { profile, repositories: [...byId.values()], privateFetchError };
}
