# TQQQ Strategy Dashboard

A personal dashboard for tracking a TQQQ covered-call / cash-secured-put options strategy. Connects to the Schwab brokerage API to display positions, filled orders, working orders, option positions, balances, and dividend/interest history.

Built with Next.js, Mantine UI, Recharts, and Supabase.

---

## Prerequisites

You'll need accounts with three services before setting up:

- **[Schwab Developer Portal](https://developer.schwab.com)** — to create an API app and get OAuth credentials
- **[Supabase](https://supabase.com)** — to store OAuth tokens and app settings (free tier is fine)
- **[Vercel](https://vercel.com)** — to deploy (or any platform that runs Next.js)

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

### HTTPS requirement

Schwab's OAuth callback requires HTTPS. The dev server uses Next.js's built-in HTTPS with a local certificate.

**Generate a trusted local certificate using [mkcert](https://github.com/FiloSottile/mkcert):**

```bash
# Install mkcert (macOS)
brew install mkcert
mkcert -install

# Generate certs for the project
mkdir -p certs
mkcert -key-file certs/key.pem -cert-file certs/cert.pem 127.0.0.1 localhost
```

### Environment variables

```bash
cp .env.local.example .env.local
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
| `APP_SESSION_SECRET` | Random hex string — generate with `openssl rand -hex 32` |

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
