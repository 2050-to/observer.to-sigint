# Wi-Fi Mapping

Local app for collecting and reviewing Wi-Fi networks. A React UI shows range, map, space, open networks, and a log. An HTTPS API stores scans in Postgres and keeps a short-lived snapshot in Redis. An optional Android app and a macOS app scan nearby networks and post them to the API.

The browser cannot scan Wi-Fi. Use **Load sample drive** there. Real scans run in the Android app.

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

From the repo root, install the UI and the API, then generate certificates and `.env`:

```bash
npm install
npm install --prefix server
npm run setup
```

Continue with Configure and Run below. The first time the API starts, macOS may ask to allow incoming connections for Node. Allow them so an Android emulator on this Mac can reach the API.

For a device build, install Android Studio for Mac and add Android SDK 35 from its SDK Manager.

## Install

From the repo root, install the UI and the API:

```bash
npm install
npm install --prefix server
```

## Configure

Generate a local certificate authority, a server certificate, and a `.env` file:

```bash
npm run setup
```

That script writes `certs/` and, if `.env` is missing, a `.env` with random `API_TOKEN`, `DATA_KEY`, and `HMAC_KEY`. Both paths are gitignored. Leave the keys as generated. `DATA_KEY` and `HMAC_KEY` are base64 and must decode to 32 bytes. `VITE_API_TOKEN` must stay equal to `API_TOKEN`.

The setup script sets `PORT=8443`. The Vite dev server proxies `/api` to `https://127.0.0.1:9453`, and the Android client uses that same port. Change the port before you start the API:

```bash
# in .env
PORT=9453
```

Restart the Vite dev server after any change to a `VITE_` variable so it picks up the new value.

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTPS API port. Use `9453` for local development. |
| `API_TOKEN` | Bearer token required on `/api/*`. |
| `DATA_KEY` | AES-256-GCM key for stored records. |
| `HMAC_KEY` | HMAC key used to index BSSIDs. |
| `DATABASE_URL` | Postgres URL. Host port `5434`. Default user, password, and database are `wifi`. |
| `REDIS_URL` | Redis URL over TLS (`rediss://localhost:6380`). |
| `PGSSLROOTCERT` | CA file for Postgres (`certs/ca.crt`). |
| `REDIS_CA` | CA file for Redis (`certs/ca.crt`). |
| `TLS_CERT` | API certificate (`certs/server.crt`). |
| `TLS_KEY` | API private key (`certs/server.key`). |
| `VITE_API_TOKEN` | Same value as `API_TOKEN`, read by the UI. |
| `VITE_DEVICE_API_URL` | API base URL used by the Android app. Optional. |

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

In one terminal, start the API. It listens on `0.0.0.0` and the port in `.env`:

```bash
npm run server
```

A healthy API responds to `GET /health` with `{"ok":true}`. That path does not require the bearer token. Every `/api/*` route does.

In a second terminal, start the UI:

```bash
npm run dev
```

Open `http://localhost:5173`. The page proxies API calls to `https://127.0.0.1:9453`. Choose a speed and click **Load sample drive** to fill the catalog.

Place lookup calls the public Nominatim and Overpass services, so the machine running the API needs outbound HTTPS.

## Test and build

```bash
npm test
npm run build
```

`npm test` runs the server checks. `npm run build` typechecks the UI and writes `dist/`.

## Android

The `android/` project is already in the repo. Run setup again so the dev CA is copied to `android/app/src/main/res/raw/dev_ca.crt`. Debug builds trust that certificate.

```bash
npm run setup
npm run cap:sync
```

`cap:sync` builds the web app and copies it into the Android project. Open `android/` in Android Studio and run it on an emulator or a device.

On first **Start drive**, the app asks for location, nearby Wi-Fi devices, and notifications. Those permissions keep the scan running in the foreground. Point `VITE_DEVICE_API_URL` at the API before `npm run cap:sync`, then rebuild so the packaged app has the token and URL.

## macOS

Build an ad-hoc signed disk image on this Mac:

```bash
npm run mac:dmg
```

Open `release/Wi-Fi Mapping.dmg`, drag **Wi-Fi Mapping** to Applications, and open it. On the first **Start drive**, allow Location and Bluetooth. The app scans nearby Wi-Fi and Bluetooth advertisements and keeps the catalog on this Mac. Cell towers are not available. When `npm run server` is running, scans sync to `https://127.0.0.1:9453`.

The disk image is not notarized. It opens on the Mac that built it. On another Mac, Control-click the app and choose Open so Gatekeeper allows it.

