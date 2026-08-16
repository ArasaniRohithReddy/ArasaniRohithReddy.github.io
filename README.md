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

## Viewing repositories you can access

Anonymous visitors see only repositories returned by GitHub's public
`/users/ArasaniRohithReddy/repos` endpoint.

To include private repositories that GitHub permits your account to view:

1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new).
2. Select only the repository access needed. No repository permissions beyond
   read-only metadata are required. If using a classic PAT instead, select
   `repo` for private repositories or `public_repo` for public repositories.
3. Paste the token into the site's password field and choose **Use token**.
4. Choose **Sign out / clear token** when finished.

The token is kept only in the browser tab's `sessionStorage` and is sent only
to `api.github.com`. It is never committed, placed in a URL or cookie, or sent
to this static site.

## Security model and limits

The site contains no repository inventory, access-control list, or application
role logic. GitHub enforces access when the browser requests
`/user/repos?affiliation=owner,collaborator` with the supplied token; the page
then keeps only repositories owned by `ArasaniRohithReddy` and unions them
with the anonymous public `/users/ArasaniRohithReddy/repos` response. The page
cannot grant access that the supplied token does not already have.

This is not application-level authentication. A token used in browser
JavaScript remains accessible to code running in that page, so visitors should
use a short-lived, least-privilege token and clear it afterward. True
server-enforced row-level security would require a GitHub OAuth app and a
serverless token-exchange backend. That architecture is intentionally out of
scope for this static site.
