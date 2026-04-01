# TQQQ Strategy Dashboard

A personal dashboard for tracking a TQQQ trading strategy. Connects to the Schwab brokerage API to display positions, filled orders, working orders, option positions, balances, and dividend/interest history.

Built with Next.js, Mantine UI, Recharts, and Supabase.

---

## Try the Demo

Want to see it before setting anything up? Deploy a public demo with fake data in one click:

1. Fork this repo on GitHub (click **Fork** in the top-right corner of the repo page).
2. Go to [vercel.com](https://vercel.com), sign in with GitHub, and click **Add New → Project**.
3. Import your forked repo.
4. Under **Environment Variables**, add one variable: `DEMO_MODE` = `true`.
5. Deploy.

That's it — no Schwab account, no Supabase, no password required. The demo is pre-populated with realistic fake data so you can explore the full UI.

---

## Full Setup (with your real Schwab account)

If you want to run this against your actual Schwab account, you'll need to complete the steps below. The process takes about 30–60 minutes the first time.

**Overview of what you're setting up:**
1. A Schwab developer app — so this dashboard can read your brokerage data
2. A Supabase project — a free database to store your Schwab tokens and settings
3. Your local development environment
4. (Optional) A Vercel deployment for permanent hosting

---

## Prerequisites

You'll need accounts with three services before setting up:

- **[Schwab Developer Portal](https://developer.schwab.com)** — to create an API app and get OAuth credentials
- **[Supabase](https://supabase.com)** — to store OAuth tokens and app settings (free tier is fine)
- **[Vercel](https://vercel.com)** — to deploy (or any platform that runs Next.js)

You'll also need **[Node.js](https://nodejs.org)** (v18 or later) installed on your machine to run the app locally. If you're not sure whether you have it, run `node -v` in your terminal. If it prints a version number, you're good.

> **New to this?** These services are all free at the tier this app needs. "Deploying" just means putting the app on a server so you can access it from anywhere — Vercel handles that automatically when you push code to GitHub.

---

## How It All Fits Together

```
Your browser
    ↓ (password-protected)
This Next.js app  ←→  Schwab API  (reads your brokerage data)
                  ←→  Supabase    (stores tokens + settings)
```

- You log in with a password you set yourself (`APP_PASSWORD`)
- The app calls the Schwab API on your behalf using OAuth tokens stored in Supabase
- Your settings (account configuration, buy levels, etc.) are also saved in Supabase so they persist across devices

---

## 1. Schwab Developer App

1. Log in at [developer.schwab.com](https://developer.schwab.com) and create a new app.
2. Set the **Callback URL** to your production URL:
   ```
   https://yourdomain.com/api/auth/callback
   ```
   For local development, also add:
   ```
   https://127.0.0.1:3000/api/auth/callback
   ```
   > Schwab requires HTTPS and does not accept `localhost` — use `127.0.0.1`.
3. After the app is approved, copy your **App Key** (client ID) and **App Secret** (client secret).

> **Note:** Schwab app approval is manual and can take a few business days. You can set up everything else in the meantime — you just won't be able to connect to Schwab until the app is approved.

---

## 2. Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** and run the following to create the required tables:

```sql
-- Stores Schwab OAuth tokens
create table tokens (
  id int primary key,
  access_token text not null,
  refresh_token text not null,
  expires_at bigint not null
);

-- Stores app settings (e.g. buy levels, display prefs)
create table settings (
  key text primary key,
  value jsonb not null
);
```

3. Go to **Project Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** secret (under "Project API keys") → `SUPABASE_SERVICE_ROLE_KEY`

> The service role key bypasses Row Level Security — it is only used server-side and is never exposed to the browser.

---

## 3. Local Development

### Get the code

If you haven't already, clone the repo to your machine:

```bash
git clone https://github.com/derekawalker/tqqq-strategy.git
cd tqqq-strategy
```

> **Don't have Git?** Download it at [git-scm.com](https://git-scm.com). On macOS you can also install it by running `xcode-select --install` in your terminal. On Windows, the Git installer from that site also installs Git Bash, which you should use for all terminal commands in this guide.

### HTTPS requirement

Schwab's OAuth callback requires HTTPS. The dev server uses Next.js's built-in HTTPS with a local certificate.

**Generate a trusted local certificate using [mkcert](https://github.com/FiloSottile/mkcert):**

**macOS:**
```bash
brew install mkcert
mkcert -install
mkdir -p certs
mkcert -key-file certs/key.pem -cert-file certs/cert.pem 127.0.0.1 localhost
```

**Windows** (run in PowerShell as Administrator, with [Chocolatey](https://chocolatey.org) installed):
```powershell
choco install mkcert
mkcert -install
mkdir certs
mkcert -key-file certs/key.pem -cert-file certs/cert.pem 127.0.0.1 localhost
```

**Linux:**
```bash
# Download the mkcert binary from https://github.com/FiloSottile/mkcert/releases
# then make it executable and install:
chmod +x mkcert-*-linux-amd64
sudo mv mkcert-*-linux-amd64 /usr/local/bin/mkcert
mkcert -install
mkdir -p certs
mkcert -key-file certs/key.pem -cert-file certs/cert.pem 127.0.0.1 localhost
```

### Environment variables

**macOS/Linux:**
```bash
cp .env.local.example .env.local
```

**Windows (Git Bash):**
```bash
cp .env.local.example .env.local
```

**Windows (PowerShell):**
```powershell
Copy-Item .env.local.example .env.local
```

Fill in `.env.local`:

| Variable | Description |
|---|---|
| `SCHWAB_CLIENT_ID` | App Key from Schwab Developer Portal |
| `SCHWAB_CLIENT_SECRET` | App Secret from Schwab Developer Portal |
| `SCHWAB_REDIRECT_URI` | `https://127.0.0.1:3000/api/auth/callback` |
| `NEXT_PUBLIC_APP_URL` | `https://localhost:3000` |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key |
| `APP_PASSWORD` | Password for the app login page |
| `APP_SESSION_SECRET` | Random secret used to sign session cookies — generate one by running `openssl rand -hex 32` in your terminal (macOS/Linux/Git Bash) and pasting the output. On Windows PowerShell: `-join ((1..32) \| % { '{0:x2}' -f (Get-Random -Max 256) })` |

### Run the dev server

```bash
npm install
npm run dev
```

Open [https://localhost:3000](https://localhost:3000).

### Connect to Schwab

On first run (or after tokens expire), you'll see a **Connect to Schwab** button on the dashboard. Click it to go through the Schwab OAuth flow. Tokens are stored in Supabase and automatically refreshed.

---

## 4. Deploy to Vercel

1. Push the repo to GitHub and import it in [Vercel](https://vercel.com/new).
2. Add all environment variables from `.env.local.example` under **Settings → Environment Variables**, using production values:
   - `SCHWAB_REDIRECT_URI` → `https://yourdomain.com/api/auth/callback`
   - `NEXT_PUBLIC_APP_URL` → `https://yourdomain.com`
   - Everything else same as local, but with production Supabase credentials
3. Deploy. After the first deploy, complete the Schwab OAuth flow from the live URL to store tokens in Supabase.

---

## Architecture Notes

- **Authentication**: A single password (`APP_PASSWORD`) protects all routes via a session cookie. The session secret is stored server-side in the cookie — no user database needed.
- **Schwab tokens**: OAuth access/refresh tokens are stored in Supabase (server-side only, never sent to the browser). The access token is automatically refreshed on expiry.
- **No public API**: All `/api/*` routes require the session cookie. There are no publicly accessible endpoints.
