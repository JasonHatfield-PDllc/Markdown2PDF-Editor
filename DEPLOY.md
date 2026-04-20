# Deploy Markdown2PDF to GitHub Pages + Wix DNS

This folder is intended to be the **root of its own Git repository** (not nested under `MyStartPage` if that repo excludes this path).

## Part A — GitHub (you do this once)

### 1. Create a new empty repository

1. Log in to [GitHub](https://github.com).
2. **New repository** (e.g. name `markdown2pdf-editor` or `markdown2pdf`).
3. **Do not** add a README, `.gitignore`, or license (keeps the first push simple), *or* add them and follow GitHub’s “push an existing repository” instructions.
4. Default branch should be **`main`** (matches the workflow).

#### Repository visibility (read this before step 3)

On **GitHub Free** and **Team**, **GitHub Pages only works for [public repositories](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages#visibility-for-github-pages-sites).** If the repo is **private**, Settings → Pages shows *Upgrade or make this repository public to enable Pages* unless you use **GitHub Enterprise** (private Pages for internal docs).

**For this project:** the site is a static client-side app (`dist/`); there are no API keys in the repo. **Making the repository public** is the usual choice and matches many open-source tools.

**If you need the repo to stay private:** do not use GitHub Pages—deploy `dist/` elsewhere (e.g. **Azure Static Web Apps**, **Netlify**, **Cloudflare Pages**) from CI, or keep the repo private and publish only the built files to a bucket/CDN.

### 2. Push this project from your PC

In PowerShell (adjust paths and remote URL):

```powershell
cd "C:\Users\JasonHatfield\OneDrive - Pragmatic Disruptor LLC\Documents\MyStartPage\Markdown2PDF"

git init
git branch -M main
git add .
git commit -m "Initial Markdown2PDF app with GitHub Pages workflow"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

Use your real GitHub username and repo name in the remote URL.

**Confirm the workflow file is included:** after `git add .`, you should have `.github/workflows/deploy-github-pages.yml` in the commit. On GitHub, open the repo → **Code** → browse to `.github/workflows/` — if that folder is missing, the Actions workflow was never pushed; add, commit, and push again.

### 3. Enable GitHub Pages (Actions source)

1. If the repo is **private**, either **make it public** first: **Settings** → **General** → **Danger Zone** → **Change repository visibility** → **Public**, *or* switch to non–GitHub Pages hosting (see above).
2. Open the repo on GitHub → **Settings** → **Pages**.
3. Under **Build and deployment** → **Source**, choose **GitHub Actions** (not “Deploy from a branch”).
4. **Ignore** the **Actions** tab “Get started with GitHub Actions” template gallery (blue **Configure** buttons). You are **not** using those templates — this project already defines its workflow in `.github/workflows/deploy-github-pages.yml`.
5. **Trigger the workflow:** push to `main` (or use **Actions** → **Deploy to GitHub Pages** → **Run workflow** if shown). After push, GitHub runs the workflow automatically.
6. **Find the green status:** open the **Actions** tab. In the **left sidebar**, click **“Deploy to GitHub Pages”** (the workflow name). You should see a list of runs; the latest run should show a **green checkmark** ✓ when **build** and **deploy** both succeed. If you still only see the template gallery, the workflow file is not on the `main` branch yet — fix step 2 above.

7. After a successful run, **Settings** → **Pages** will show a URL like:
   - `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

**Custom domain (next section) is recommended** so the site loads at `https://tools.pragmaticdisruptor.com` with **`base: '/'`** and no path quirks.

### 4. `github.io` project URL and `base` (required for styling)

If you **do not** use a custom domain, GitHub serves the app at:

`https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

Vite must use **`base: '/YOUR_REPO_NAME/'`** (with slashes) or CSS/JS load from `/assets/...` and **404** — the page looks unstyled (“broken”). This repo sets `REPO_BASE` in `vite.config.js` to **`/Markdown2PDF-Editor/`**; if you **rename the GitHub repo**, update that string to match.

When you add a **custom domain** (Part B), change `base` to **`'/'`** in `vite.config.js`, commit, and redeploy.

---

## Part B — Custom subdomain (recommended)

Example: **`tools.pragmaticdisruptor.com`** → your GitHub Pages site.

### 1. GitHub: add the custom domain

1. Repo → **Settings** → **Pages**.
2. **Custom domain** → enter `tools.pragmaticdisruptor.com` (or your chosen subdomain).
3. Save. Enable **Enforce HTTPS** when GitHub allows it (after DNS propagates).
4. GitHub may create a `CNAME` file or show the exact DNS records required—follow what the UI shows (usually a **CNAME**).

Typical setup:

| Type | Host / Name | Value / Target |
|------|----------------|----------------|
| CNAME | `tools` | `YOUR_USERNAME.github.io` |

**Important:** Use the **GitHub Pages hostname** shown in your repo’s Pages settings (often `username.github.io` for user/organization sites; project pages may differ slightly—**follow GitHub’s UI**).

### 2. Wix: add the DNS record

Your domain uses **Wix nameservers** (`ns0.wixdns.net` / `ns1.wixdns.net`), so DNS is edited **in Wix**, not at Whois (unless you change nameservers).

1. Log in to [Wix](https://www.wix.com/) → your site dashboard.
2. Open **Domains** (or **Premium Subscriptions** → **Domains**).
3. Select **pragmaticdisruptor.com** → **Manage** → look for **DNS records**, **Advanced DNS**, or **Manage DNS records** (wording varies).
4. Add a **CNAME** record:
   - **Host name:** `tools` (or `@` is wrong for subdomain—use the subdomain label only).
   - **Points to / Target:** `YOUR_USERNAME.github.io` (exactly as GitHub shows).
5. Save. Propagation can take **15 minutes to 48 hours** (often under an hour).

### 3. Verify

- `https://tools.pragmaticdisruptor.com` loads your app.
- GitHub → Settings → Pages shows **DNS check** valid (green).

---

## Part C — Wix site: link from your menu

1. **Wix Editor** → open [pragmaticdisruptor.com](https://www.pragmaticdisruptor.com/).
2. **Menus & Pages** (or header menu).
3. Add a **menu item** or **button**, e.g. “Markdown PDF Editor” or under **Guides**.
4. Link type: **Web address** → `https://tools.pragmaticdisruptor.com` (use HTTPS).
5. Publish the site.

---

## Troubleshooting

| Issue | What to check |
|--------|----------------|
| “Upgrade or make this repository public to enable Pages” | On Free/Team, Pages needs a **public** repo, or use Enterprise / another host. |
| 404 on `github.io` URL | Pages source = **GitHub Actions**; latest workflow run succeeded. |
| Blank / wrong assets | Custom domain: `vite.config.js` `base` should be `'/'`. Without custom domain: `base` must match `/repo-name/`. |
| Custom domain not verifying | CNAME host and target match GitHub; wait for DNS; no conflicting A records on same host. |
| Workflow fails on `npm ci` | Commit `package-lock.json`; use Node 20 locally to match Actions. |

---

## What stays private

- Nothing in this repo needs API keys for the static editor. Do not commit `.env` secrets.
