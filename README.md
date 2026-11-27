# Observer.to

Observer.to records the wireless presence around a place you are responsible for. The public site is the Next.js app in `site/`. Production serves it at `https://observer.to`. The signed-in observer is the Vite app in `src/`, served at `/app` and `/auth/verify`. The API stores each account's records in Postgres and keeps a short-lived snapshot in Redis. Search and questions stay inside that account.

The Mac app is the scanner. It records Wi-Fi, public Bluetooth advertisements, and its own GPS, altitude, and speed. The browser shows what the app has already uploaded. An optional Android app can scan as well. The Mac app source is [https://github.com/2050-to/observer.to-sigint](https://github.com/2050-to/observer.to-sigint).

The observer is free: drives, range, a map, open networks, a log, enrichment, CSV and Markdown export, an owned-network check, and a This Mac security checklist. The owned-network check lists addresses and announced names on a network you own. It does not open video, try passwords, or record traffic. The checklist report stays on the Mac and is not uploaded.

Sign-in is a magic link that returns a JWT. The homepage, terms, and privacy policy are public. The observer and catalog API routes require that JWT, acceptance of the current Terms and Privacy Policy, and an age of 18 or older. The public copies are `legal/terms.md` and `legal/privacy.md`, shown at `/terms` and `/privacy`. A $5/month Stripe subscription sends one purple-team alert email per week, an immediate email for a critical site finding, and lets you ask questions about your own records. The weekly review is also stored for the Changes tab, including on a free account. An evil twin also notifies the Android phone that uploaded the scan. In production a scheduled job builds and sends that review. Locally, the API process still does. Checkout does not turn the subscription on. The webhook does, and only an `active` subscription is entitled.

## Prerequisites

- Node.js 20 or newer, and npm
- Docker
- OpenSSL

Android builds also need Android Studio with SDK 35. The app targets devices on API 29 or newer.

## Install on macOS

Install [Homebrew](https://brew.sh) if it is not already installed, then install Node.js 20 or newer:

```bash
brew install node
node -v
```

Install [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) and open it. Leave it running. `docker compose` works once the menu bar icon reports that Docker is running.

macOS includes an OpenSSL-compatible `openssl`. Confirm it:

```bash
openssl version
```

If that command is missing, install OpenSSL and put it on your PATH. Add the `export` line to `~/.zshrc` so new terminals keep it:

```bash
brew install openssl
echo 'export PATH="$(brew --prefix openssl)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

From the repo root, install the observer and the API, then generate certificates and `.env`:

```bash
npm install
npm install --prefix server
npm run setup
```

Continue with Configure and Run below. The first time the API starts, macOS may ask to allow incoming connections for Node. Allow them so an Android emulator on this Mac can reach the API.

For a device build, install Android Studio for Mac and add Android SDK 35 from its SDK Manager.

## Install

From the repo root, install the observer and the API:

```bash
npm install
npm install --prefix server
```

To work on the public homepage, install the site as well:

```bash
npm install --prefix site
```

## Configure

Generate a local certificate authority, a server certificate, and a `.env` file:

```bash
npm run setup
```

That script writes `certs/` and, if `.env` is missing, a `.env` with random `DATA_KEY`, `HMAC_KEY`, and `JWT_SECRET`. If `.env` already exists, it appends any of those keys that are missing, plus empty billing and email settings. Both paths are gitignored. Leave the keys as generated. `DATA_KEY` and `HMAC_KEY` are base64 and must decode to 32 bytes.

The first API start after accounts were added drops observational tables that have no owner. Local scans collected before sign-in are cleared once. Enrichment research is kept.

The setup script sets `PORT=8443`. The Vite dev server proxies `/api` to `https://127.0.0.1:9453`, and the Android client uses that same port. Change the port before you start the API:

```bash
# in .env
PORT=9453
```

Restart the API after you change server environment variables.

| Variable | Purpose |
| --- | --- |
| `PORT` | Local API port. Use `9453` for local development. On Render this is the public port, and the API process listens on `10001`. |
| `BIND_HOST` | Address the API binds. Defaults to `0.0.0.0`. Production pins the API to `127.0.0.1`. |
| `JWT_SECRET` | HMAC secret for session JWTs. |
| `DATA_KEY` | AES-256-GCM key for stored records. |
| `HMAC_KEY` | HMAC key used to index hardware addresses and sign-in tokens. |
| `DATABASE_URL` | Postgres URL. Local host port `5434`. Default user, password, and database are `wifi`. |
| `REDIS_URL` | Redis URL. Local development uses TLS (`rediss://localhost:6380`). |
| `PGSSLROOTCERT` | CA file for Postgres (`certs/ca.crt`). Set this together with `REDIS_CA`. The managed database on Render does not use it. |
| `REDIS_CA` | CA file for Redis (`certs/ca.crt`). Set this together with `PGSSLROOTCERT`. The Key Value instance on Render does not use it. |
| `TLS_CERT` | API certificate (`certs/server.crt`). Optional, and only together with `TLS_KEY`. Local setup sets both. Production leaves them unset because Render terminates TLS. |
| `TLS_KEY` | API private key (`certs/server.key`). Optional, and only together with `TLS_CERT`. |
| `APP_ORIGIN` | Public origin for magic links and Stripe return URLs. Local default is `http://localhost:5173`. Production is `https://observer.to`. |
| `RESEND_API_KEY` | Server-only key for sign-in and alert email. Leave blank to print messages in the API log. |
| `EMAIL_FROM` | From address Resend is allowed to send. Required when `RESEND_API_KEY` is set. |
| `STRIPE_SECRET_KEY` | Restricted Stripe key for the $5/month subscription. Leave blank to keep checkout unavailable. |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret. |
| `STRIPE_PRICE_ID` | Price id for the $5 monthly subscription. One product, one $5 monthly price. |
| `DEEPSEEK_API_KEY` | Server-only key for enrichment and questions. Leave blank to disable both. Never use a `VITE_` prefix. |
| `DEEPSEEK_MODEL` | Optional model for enrichment and questions. When unset, enrichment uses `deepseek-flash` and questions use `deepseek-chat`. |
| `ENRICHMENT_REFRESH_DAYS` | Optional number of days before research is refreshed. Defaults to `30`. |
| `VITE_DEVICE_API_URL` | API base URL baked into a device build. Optional. |
| `OBSERVER_API_ORIGIN` | Optional HTTPS origin for the Mac app. A packaged app uses `https://observer.to`. An unpackaged app uses `https://127.0.0.1:9453`. |

For the Android emulator, add:

```bash
VITE_DEVICE_API_URL=https://10.0.2.2:9453
```

`10.0.2.2` is the emulator's address for the host machine, and it is already on the dev certificate. The API listens on all interfaces, so the emulator can reach it.

## Run

Start Postgres 17 and Redis 7. Both containers use the certificates in `certs/`:

```bash
docker compose up -d
```

In one terminal, start the API. It listens on `BIND_HOST` (default `0.0.0.0`) and the port in `.env`:

```bash
npm run server
```

A healthy API responds to `GET /health` with `{"ok":true}`. These routes do not require a session: `GET /health`, `POST /api/auth/request`, `POST /api/auth/verify`, `GET /api/legal`, and `POST /api/billing/webhook`. The webhook uses the Stripe signature. Every other `/api/*` route requires `Authorization: Bearer` with a session JWT. Catalog routes also require accepted consent. `GET /api/me`, `GET /api/billing`, and `POST /api/legal/accept` require the JWT before consent.

In a second terminal, start the observer:

```bash
npm run dev
```

Open `http://localhost:5173`. This is the local observer. It proxies `/api` to `https://127.0.0.1:9453`. Magic links use `APP_ORIGIN`, which setup sets to this origin. Enter an email and, if `RESEND_API_KEY` is empty, copy the sign-in link from the API log. Read and accept the current Terms and Privacy Policy. You must be 18 or older. **Delete all data** removes that account's networks, scans, devices, cells, imports, and custom names on the device and the server.

The public homepage is a separate Next app. Preview it with:

```bash
npm run dev --prefix site
```

That server previews the homepage. Use the Vite observer on port 5173 to sign in and call the API.

Create the Stripe product and $5 monthly price in the Dashboard, then set `STRIPE_PRICE_ID` and a restricted key. Forward webhooks to the local HTTPS API with the Stripe CLI. The dev certificate is self-signed, so the CLI has to accept it. Checkout does not turn the subscription on by itself. The webhook does, and only an `active` subscription receives the weekly email, the immediate critical email, and can ask questions. Stripe Tax stays off until you have a tax registration.

Place lookup calls the public Nominatim and Overpass services, so the machine running the API needs outbound HTTPS.

## Production

`render.yaml` describes the production stack in Oregon:

- Web service `observer` on the `main` branch, with health check `/health` and domain `observer.to`. The service uses Node 22.
- Cron job `observer-review`, hourly, which builds the stored weekly review and sends it to an active subscription. The web process does not send that weekly mail when `RENDER` is set. The web process does send an immediate critical email when a scan opens one, and the cron retries a send that failed.
- Postgres 17 database `observer-db`. The database name and user are `observer`.
- Key Value instance `observer-cache`.
- A 1 GB disk named `observer-release`, mounted at `/var/observer`.

The build installs the root, `server/`, and `site/` dependencies, runs `npm run build`, copies the Vite assets into the site with `scripts/copy-spa.mjs`, and then builds the site. The start command is `node scripts/render-start.mjs`. That process binds `0.0.0.0:$PORT`. `/health` and `/api` go to the API on `127.0.0.1:10001`. Every other path goes to Next on `127.0.0.1:10002`.

`APP_ORIGIN` is `https://observer.to`. Set `JWT_SECRET`, `DATA_KEY`, `HMAC_KEY`, Resend, Stripe, and DeepSeek in the Dashboard. Those values are not stored in the blueprint.

## Device enrichment

Set `DEEPSEEK_API_KEY` in `.env` and restart the API to enable enrichment. The key is used only by the server and must never use a `VITE_` prefix. The same key answers questions for an `active` subscription, using only that account's records. When `DEEPSEEK_MODEL` is unset, enrichment uses `deepseek-flash` and questions use `deepseek-chat`.

The worker automatically queues eligible named Wi-Fi and Bluetooth records, backfills existing records, deduplicates repeated device titles, and refreshes old results. Hidden networks, address-only records, and generic names are skipped.

Research uses DeepSeek Search and Fetch for live sources, then the DeepSeek Responses API for schema-constrained output. The worker prioritizes official manufacturer support pages, vendor advisories, CVE/NVD, and CISA KEV. Public PoC or exploit pages can be saved as labeled links, but their source code, payloads, and executable content are not downloaded or stored.

Only the observed title, radio kind, vendor OUIs, service UUIDs, and limited protocol metadata are sent for research. Full BSSIDs, Bluetooth addresses, coordinates, and observation history are excluded. Job inputs and results remain encrypted in Postgres. Enrichment returned to the app is also cached in its local catalog so it remains visible offline; protect that device storage accordingly.

Passive scans do not reveal the installed firmware or driver. The catalog therefore labels release data as the latest publicly available release and treats vulnerabilities as potentially applicable until the exact model and installed version are verified. `High Risk` is assigned conservatively from strong identity evidence plus end-of-support, CISA KEV or official active exploitation, or an official latest release more than three years old.

Each enriched catalog entry includes a copyable remediation prompt. It asks for vendor-supported verification, backup, update, mitigation, validation, monitoring, and rollback steps. It explicitly rejects exploit development, unsupported firmware changes, and invented commands.

## Test and build

```bash
npm test
npm run build
```

`npm test` runs the server checks. `npm run build` typechecks the observer and writes `dist/`. The Render build also builds the site.

## Android

The optional `android/` project is already in the repo. Run setup again so the dev CA is copied to `android/app/src/main/res/raw/dev_ca.crt`. Debug builds trust that certificate.

```bash
npm run setup
npm run cap:sync
```

`cap:sync` builds the web app and copies it into the Android project. Open `android/` in Android Studio and run it on an emulator or a device.

On first **Start drive**, the app asks for location, nearby Wi-Fi devices, and notifications. Those permissions keep the scan running in the foreground. Sign in inside the app. Point `VITE_DEVICE_API_URL` at the API before `npm run cap:sync`, then rebuild so the packaged app has that URL.

## macOS

The Mac app source is [https://github.com/2050-to/observer.to-sigint](https://github.com/2050-to/observer.to-sigint).

To build an ad-hoc signed disk image from this checkout:

```bash
npm run mac:dmg
```

That command sets `VITE_DEVICE_API_URL=https://observer.to`, so the packaged app syncs to production. An unpackaged app uses `https://127.0.0.1:9453` unless `OBSERVER_API_ORIGIN` is an `https://` origin.

Open `release/Observer.to.dmg`, drag **Observer.to** to Applications, and open it. Sign in, then on the first **Start drive**, allow Location and Bluetooth. The app uses the same screens as Android and scans on the same timing: Wi-Fi networks, public Bluetooth advertisements, and this Mac's GPS, altitude, and speed. A drive keeps running if you close the window. Click the Dock icon to bring it back, and quit from the app menu to stop it. macOS does not reveal a Bluetooth advertiser's hardware address, so each advertisement is keyed by the identifier CoreBluetooth gives this app. macOS also does not provide tower identity, so cell sites are collected on the phone and show up here after those scans sync.

The disk image is not notarized. It opens on the Mac that built it. On another Mac, Control-click the app and choose Open so Gatekeeper allows it.
