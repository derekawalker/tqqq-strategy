# TQQQ Strategy Dashboard

A personal dashboard for tracking a TQQQ trading strategy. Connects to the Schwab brokerage API to display positions, filled orders, working orders, option positions, balances, and dividend/interest history.

Built with Next.js, Mantine UI, Recharts, and Supabase.

---

## Try the Demo

Not sure if this is for you? You can spin up a live version with fake data in about 5 minutes — no Schwab account, no coding, no installs.

**What you'll need:**
- A free [GitHub](https://github.com) account
- A free [Vercel](https://vercel.com) account

**Steps:**

1. Click **Fork** in the top-right corner of this GitHub page to copy the repo to your own account.
2. Go to [vercel.com](https://vercel.com), sign in with GitHub, and click **Add New → Project**.
3. Find your forked repo and click **Import**.
4. Before clicking Deploy, open the **Environment Variables** section and add:
   - Name: `DEMO_MODE` / Value: `true`
5. Click **Deploy**.

In a minute or two you'll have a live URL with a fully working app pre-populated with fake data. No real account data, no password required.

---

## Run It With Your Real Schwab Account (No Local Setup)

This is the recommended path if you've never done software development. Everything runs in the cloud — you only need a web browser.

**How it works:**
- Your code lives on GitHub (free)
- The app runs on Vercel (free)
- Your Schwab tokens and settings are stored in Supabase (free)
- Every time you push a change to GitHub, Vercel automatically rebuilds and redeploys

```
Your browser
    ↓ (password-protected)
Vercel (runs the app)  ←→  Schwab API  (reads your brokerage data)
                       ←→  Supabase    (stores tokens + settings)
```

### Step 1 — Fork the repo

Click **Fork** at the top of this page to copy the repo to your GitHub account. All future changes you make will live in your fork.

### Step 2 — Set up Schwab API access

The dashboard reads your brokerage data through Schwab's official API. You need to register a developer app to get credentials.

1. Go to [developer.schwab.com](https://developer.schwab.com) and sign in with your Schwab account.
2. Create a new app. When asked for a **Callback URL**, enter:
   ```
   https://your-vercel-url.vercel.app/api/auth/callback
   ```
   You'll get your Vercel URL after deploying in Step 4 — you can come back and update this.
3. Submit the app for approval. **This takes a few business days** — Schwab reviews all API apps manually. You can complete the remaining steps while you wait.
4. Once approved, copy your **App Key** and **App Secret** — you'll need these shortly.

### Step 3 — Set up Supabase

Supabase is a free database service that stores your Schwab tokens (so you stay logged in) and your app settings (so they sync across devices).

1. Create a free account at [supabase.com](https://supabase.com) and create a new project.
2. Once the project is ready, click **SQL Editor** in the left sidebar and run this query:

```sql
create table tokens (
  id int primary key,
  access_token text not null,
  refresh_token text not null,
  expires_at bigint not null
);

create table settings (
  key text primary key,
  value jsonb not null
);
```

3. Go to **Project Settings → API** and copy two values:
   - **Project URL** — looks like `https://xxxx.supabase.co`
   - **service_role** key — listed under "Project API keys" (use the `service_role` one, not `anon`)

### Step 4 — Deploy to Vercel

1. Go to [vercel.com](https://vercel.com), sign in with GitHub, and click **Add New → Project**.
2. Import your forked repo.
3. Before deploying, add the following **Environment Variables**:

| Variable | Value |
|---|---|
| `SCHWAB_CLIENT_ID` | Your Schwab App Key |
| `SCHWAB_CLIENT_SECRET` | Your Schwab App Secret |
| `SCHWAB_REDIRECT_URI` | `https://your-vercel-url.vercel.app/api/auth/callback` |
| `NEXT_PUBLIC_APP_URL` | `https://your-vercel-url.vercel.app` |
| `SUPABASE_URL` | Your Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service_role key |
| `APP_PASSWORD` | A password of your choosing to protect the app |
| `APP_SESSION_SECRET` | A long random string — use [this generator](https://generate-secret.vercel.app/64) and paste the result |

4. Click **Deploy**.
5. Once deployed, copy your Vercel URL and go back to the Schwab Developer Portal to update your app's Callback URL to match.

### Step 5 — Connect to Schwab

1. Open your deployed app and log in with your `APP_PASSWORD`.
2. You'll see a **Connect to Schwab** button. Click it to go through Schwab's OAuth authorization — this is the same kind of "log in with..." flow you've seen on other apps.
3. Once authorized, the app starts pulling your real account data. Tokens are stored in Supabase and automatically refreshed.

### Making changes

If you want to tweak the code later, you can edit files directly on GitHub in your browser. Every time you save a change, Vercel will automatically rebuild and deploy. No terminal required.

---

## Local Development (For Developers)

If you're comfortable with the terminal and want to run the app on your own machine for development.

**Prerequisites:** [Node.js](https://nodejs.org) v18+, [Git](https://git-scm.com)

### Clone and install

```bash
git clone https://github.com/derekawalker/tqqq-strategy.git
cd tqqq-strategy
npm install
```

### HTTPS (required for Schwab OAuth)

Schwab's OAuth callback requires HTTPS even locally. Use [mkcert](https://github.com/FiloSottile/mkcert) to generate a trusted local cert:

**macOS:**
```bash
brew install mkcert && mkcert -install
mkdir -p certs && mkcert -key-file certs/key.pem -cert-file certs/cert.pem 127.0.0.1 localhost
```

**Windows** (PowerShell as Administrator, requires [Chocolatey](https://chocolatey.org)):
```powershell
choco install mkcert; mkcert -install
mkdir certs; mkcert -key-file certs/key.pem -cert-file certs/cert.pem 127.0.0.1 localhost
```

**Linux:**
```bash
# Download binary from https://github.com/FiloSottile/mkcert/releases
chmod +x mkcert-*-linux-amd64 && sudo mv mkcert-*-linux-amd64 /usr/local/bin/mkcert
mkcert -install && mkdir -p certs
mkcert -key-file certs/key.pem -cert-file certs/cert.pem 127.0.0.1 localhost
```

### Environment variables

```bash
cp .env.local.example .env.local  # Windows PowerShell: Copy-Item .env.local.example .env.local
```

| Variable | Value |
|---|---|
| `SCHWAB_CLIENT_ID` | Schwab App Key |
| `SCHWAB_CLIENT_SECRET` | Schwab App Secret |
| `SCHWAB_REDIRECT_URI` | `https://127.0.0.1:3000/api/auth/callback` |
| `NEXT_PUBLIC_APP_URL` | `https://localhost:3000` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |
| `APP_PASSWORD` | Your chosen app password |
| `APP_SESSION_SECRET` | Random hex string — `openssl rand -hex 32` |

### Run

```bash
npm run dev
```

Open [https://localhost:3000](https://localhost:3000). On first run, click **Connect to Schwab** to complete OAuth.

---

## Architecture Notes

- **Authentication**: A single password (`APP_PASSWORD`) protects all routes via a session cookie. No user database needed.
- **Schwab tokens**: OAuth tokens are stored in Supabase server-side and automatically refreshed on expiry. Never sent to the browser.
- **No public API**: All `/api/*` routes require the session cookie.
- **Demo mode**: Set `DEMO_MODE=true` to bypass all authentication and serve static fake data. Safe to deploy publicly — no real credentials are used.
