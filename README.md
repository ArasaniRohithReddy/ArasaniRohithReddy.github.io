# ArasaniRohithReddy repository dashboard

A dependency-free GitHub Pages site that fetches repositories for
[`ArasaniRohithReddy`](https://github.com/ArasaniRohithReddy) directly from the
GitHub API.

**Site:** https://arasanirohithreddy.github.io/

## Enable GitHub Pages

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main` or manually run the **Deploy GitHub Pages** workflow.

The workflow publishes the repository root, where `index.html` is located.

## Using the dashboard

- **Search, filter and sort:** the filter bar lets you search by name/description,
  filter by language, visibility (All / Public / Private), archived state and
  forks, and sort by recently updated, name, or star count. Every sort can be
  reversed with the **sort direction** toggle beside it. Filters compose
  together, and a result count ("Showing 12 of 24 repositories") plus an
  active-filter count is shown. Use **Clear filters** to reset everything at once.
  The toolbar is two rows — a full-width search field, then the filter controls
  with their actions — collapsing behind a **Filters** disclosure on narrow
  screens.
- **Shareable views:** the current search, language, visibility, archived, fork,
  sort, sort direction and view selections are mirrored in the URL query string
  (`?q=…&lang=…&vis=…&arch=…&fork=…&sort=…&dir=…&view=…`) with `history.replaceState`,
  so a link reproduces the same view. Parameters at their default value are
  omitted. **Copy link to this view** copies the current URL. When a parameter is
  absent, the stored `localStorage` preference is used instead.
- **Featured repositories:** in the default "Recently updated" ordering the most
  significant repositories lead the list with a **Featured** badge. An optional
  curated allow-list of names (`FEATURED_REPO_NAMES` in `assets/js/main.js`) takes
  precedence; otherwise the most-starred repositories are used. Choosing **Name**
  or **Most stars** overrides the featured ordering.
- **Language breakdown:** a stacked bar shows the language distribution of the
  repositories currently shown, recomputed whenever filters change. Hovering a
  segment or a legend entry reveals the language, percentage and repository
  count; selecting a legend entry filters to that language (and updates the URL),
  and selecting it again clears the filter. Very small slices are grouped into
  **Other**, whose tooltip lists what it contains. The bar keeps `role="img"`
  with a descriptive label plus a screen-reader text fallback, and is derived
  from the repository data already fetched, so it costs no extra API requests.
- **Repository details:** selecting a card (or its details button) opens a dialog
  with the full description, all topics, language, stars, forks, watchers, open
  issues, licence, default branch, size, created/updated/pushed dates, homepage
  and clone URL. Everything comes from the data already fetched — no extra API
  requests — and the dialog is fully keyboard operable with `Escape` to close.
- **Copy clone URL:** each repository card has a copy button for its HTTPS clone
  URL, with visual and screen-reader confirmation.
- **Progressive rendering:** the first 24 repositories render immediately and
  **Show more repositories** reveals the rest, so large accounts stay responsive.
- **Keyboard shortcuts:** `/` focuses the search box, `Escape` clears it (or
  closes a dialog), `g` switches to grid view, `l` to list view, and `?` opens
  the shortcuts help dialog, also reachable from the **Shortcuts** button.
- **Back to top:** a button appears once you scroll down, honouring
  `prefers-reduced-motion`.
- **Empty state:** when filters match nothing, each active filter is listed as a
  chip that can be removed individually, alongside a clear-all action.
- **Printing:** a print stylesheet hides the controls, expands the cards and
  prints black on white.
- **Grid / list view:** toggle between a card grid and a compact list using the
  view switch above the repository list. Your choice is remembered
  (`localStorage`) across visits.
- **Theme:** choose light, dark, or system (the default) with the theme toggle
  in the header. The preference is stored in `localStorage`; the GitHub token is
  never included in it.
- **Stats strip:** shows the total repositories currently shown, total stars,
  number of distinct languages, and the most-used language among them.
- **Custom 404 page:** `404.html` uses the same design system and links back to
  the dashboard; GitHub Pages serves it for unknown paths.

## Viewing repositories you can access

Anonymous visitors see only repositories returned by GitHub's public
`/users/ArasaniRohithReddy/repos` endpoint.

To include private repositories that GitHub permits your account to view:

1. Select **Sign in** in the header to open the compact sign-in panel.
2. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new).
3. Choose **Repository access: Only select repositories** (or All repositories)
   and grant **Metadata: Read-only** only. Do not use a classic `repo`-scoped
   token: it grants unnecessary write access to every repository.
4. Paste the token into the password field and choose **Use token**.
5. Choose **Sign out** when finished.

The token is validated with `GET https://api.github.com/user` before it is
stored. Invalid tokens are rejected; classic tokens with write-capable scopes
produce a non-blocking warning, and GitHub's token-expiration header is shown
when available. The token is kept only in the browser tab's `sessionStorage`,
is cleared after 60 minutes without activity, and is sent only to
`api.github.com`. It is never written to the DOM, URL, `localStorage`, console,
cookie, or repository.

## Security model and limits

The site contains no repository inventory, access-control list, or application
role logic. GitHub enforces access when the browser requests
`/user/repos?affiliation=owner,collaborator` with the supplied token; the page
then keeps only repositories owned by `ArasaniRohithReddy` and unions them
with the anonymous public `/users/ArasaniRohithReddy/repos` response. The page
cannot grant access that the supplied token does not already have.

This is not application-level authentication. GitHub enforces all access; a token used in browser
JavaScript remains accessible to code running in that page, so visitors should
use a short-lived, least-privilege token and
[revoke it](https://github.com/settings/tokens) when finished. A true login
would require GitHub OAuth plus a backend that safely holds the client secret
and exchanges authorization codes. That architecture is out of scope for
GitHub Pages and this static site.
