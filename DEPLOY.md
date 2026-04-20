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

**Custom domain (next section) is recommended** so the site loads at e.g. `https://markdown2pdf-editor.pragmaticdisruptor.com` without path quirks.

### 4. `github.io` project URL and `base` (required for styling)

GitHub serves a **project** site at:

`https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

A **custom domain** for that same project is served at the **root** of the subdomain (`https://markdown2pdf-editor.pragmaticdisruptor.com/`). Those two URLs use different **path prefixes** (`/REPO/` vs `/`), so a single absolute `base` cannot fit both.

This repo uses **`base: './'`** in `vite.config.js` so the built HTML references **`./assets/...`**. Browsers resolve that relative to the current page, so the same deploy works for **both** `github.io/.../REPO/` **and** the custom domain. Run `npm run build` and deploy the resulting `dist/` (the GitHub Actions workflow does this on every push to `main`).

---

## Part B — Custom subdomain (recommended)

Example: **`markdown2pdf-editor.pragmaticdisruptor.com`** → your GitHub Pages site.

### 0. Same build for custom domain and `github.io`

`vite.config.js` uses **`base: './'`** so you do **not** need a separate “custom domain” build. Push to `main`, wait for Actions, then open **`https://markdown2pdf-editor.pragmaticdisruptor.com/`** (root of the subdomain). Avoid bookmarking **`.../Markdown2PDF-Editor/`** on the custom domain—that path is not part of the Pages layout and will break asset URLs if old HTML is cached.

### 1. GitHub: add the custom domain

1. Repo → **Settings** → **Pages**.
2. **Custom domain** → enter `markdown2pdf-editor.pragmaticdisruptor.com` (your chosen subdomain).
3. Save. GitHub shows the exact **DNS** requirements—follow that page (usually a **CNAME**).

Typical setup for a **subdomain**:

| Type | Host / Name | Value / Target |
|------|-------------|----------------|
| CNAME | `markdown2pdf-editor` | `jasonhatfield-pdllc.github.io` |

Use the **target** GitHub displays (must match your account). Project Pages use **`USERNAME.github.io`** as the CNAME target—not the repo name.

4. When DNS is valid, enable **Enforce HTTPS**.

### 2. Where to create the subdomain (DNS)

The subdomain is **not** “created” in GitHub—you add a **DNS record** wherever **pragmaticdisruptor.com** is hosted in DNS.

- **Wix shows “Managed by third party” / “Connected by DNS”**  
  The domain may still be registered at **Whois.com** (or elsewhere), and DNS might live at the **registrar** or at **Wix**, depending on **nameservers**.

**Find the right place:**

1. In Wix: **Domains** → **pragmaticdisruptor.com** → look for **Manage DNS records** / **Advanced DNS**. If you can add records there, add the CNAME here.
2. If Wix says DNS is at a **third party**, open **Whois.com** (or whoever you bought the domain from) → **DNS management** for pragmaticdisruptor.com.
3. Optional check (PowerShell): `nslookup -type=NS pragmaticdisruptor.com` — if you see `wixdns.net`, Wix is authoritative; if you see registrar NS, use the registrar’s DNS panel.

**Add the CNAME:**

- **Host / Name:** `markdown2pdf-editor` (only the left part; not the full domain).
- **Points to / Target:** `jasonhatfield-pdllc.github.io` (or exactly what GitHub’s Pages settings show).
- **TTL:** default is fine.

Propagation is often **15 minutes–48 hours**.

### 3. Verify

- `https://markdown2pdf-editor.pragmaticdisruptor.com` loads your app (styled).
- GitHub → **Settings** → **Pages** shows the custom domain **Verified** and **Enforce HTTPS** available.

---

## Part C — Wix site: link from your menu

1. **Wix Editor** → open [pragmaticdisruptor.com](https://www.pragmaticdisruptor.com/).
2. **Menus & Pages** (or header menu).
3. Add a **menu item** or **button**, e.g. “Markdown PDF Editor” or under **Guides**.
4. Link type: **Web address** → `https://markdown2pdf-editor.pragmaticdisruptor.com` (HTTPS).
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
