# JimWas Repo

A personal jailbreak tweak storefront and APT repository. The storefront lives in `storefront/`. The public APT files are generated in `repo/public/` from free `.deb` files placed in `repo/free/`.

## Publish a free package

1. Build and test a Theos `.deb`. Rootless releases use `THEOS_PACKAGE_SCHEME=rootless` and the `iphoneos-arm64` architecture.
2. Put the `.deb` in `repo/free/`.
3. Run `python3 tools/build_repo.py` from the project root. This generates `Packages`, `Packages.gz`, `Release`, and the storefront catalog.
4. Host the contents of `repo/public/` at the root of an HTTPS repo URL. Add that URL in Sileo or Zebra and test installation and update behavior.

The generator rejects packages marked `Tag: cydia::commercial`, because publishing their `.deb` files at public URLs would bypass payment.

## Paid packages

Paid packages use the self-hosted commerce service below. Keep paid `.deb` files in private storage. Never copy them to `repo/public/` or the storefront's `public/` folder.

## JimWas Recorder 1.9.5

The first paid package is **JimWas Recorder** (`com.jimwas.recorder`, rootless `iphoneos-arm64`) at **$34.99 USD**. Its verified SHA-256 is `16ef2cadf4a1c9f772b8262fe3ef4f78c39185a258ffd6243d994d4604133f0c`. The package is held in `.private/packages/` and ignored by Git. The public `Packages` index advertises it with `Tag: cydia::commercial`, but the `.deb` is not served at a public URL. The storefront listing uses the supplied product artwork and release details.

The live JW LLC Stripe account has product `prod_VKdfgaaSfEZ6G2` and one-time USD price `price_1UJyO18apqxJlTTcIMznbGUs` (3499 cents). No payment link is exposed on the Sites preview.

## Self-hosted paid store

OpenAI Sites cannot enable financial transactions, so the live paid store runs on a Debian Google Cloud VM at `repo.jimwashkau.com`. `commerce/server.js` serves the exported storefront, APT metadata, Sileo payment-provider endpoints, Stripe Checkout, verified webhook fulfillment, and one-time authorized package downloads. Caddy provides HTTPS in `compose.yaml`. The SQLite database and paid package stay outside public web assets.

1. Run `npm install` in `commerce/` and `npm run build:selfhost` in `storefront/`.
2. Copy `commerce/.env.example` to `commerce/.env` and set `STRIPE_SECRET_KEY` to a live restricted Stripe key with Checkout Sessions **Write**, Prices **Read**, and Products **Read** permissions. Set `STRIPE_WEBHOOK_SECRET` to the endpoint signing secret, and `AUTH_SECRET` to a random 32+ byte secret. Keep these values outside Git and the Sites project. The VM has an `AUTH_SECRET` already; `tools/activate_live.py` privately prompts for the two Stripe secrets and verifies the live $34.99 price before starting the containers.
3. On the Debian VM, install Docker Engine and its Compose plugin, copy the project and private package, and give UID 1000 write access to `.private/` for the SQLite database. Run `docker compose up -d --build`. The `.private` bind mount and Caddy volumes persist across deployments. Run `python3 tools/build_repo.py` after changing packages, then rebuild.
4. Point a Cloudflare DNS A record for `repo.jimwashkau.com` to the VM's reserved external IP, and permit inbound TCP 80 and 443 in Google Cloud's firewall. In Stripe, register `https://repo.jimwashkau.com/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `charge.refunded`. Fulfillment only happens after a signature-verified paid event.
5. Test a purchase in a Stripe sandbox with a sandbox price, webhook secret, and test API key before enabling live checkout. Test Sileo sign-in, purchase, install, and update on a jailbroken device.

The Google Cloud project is `project-6c934194-73a4-42f4-914`. Its Debian 13 VM `jimwas-repo` is in `asia-southeast1-c`, with reserved IP `34.126.76.107`. Cloudflare's `repo` A record points to that IP in DNS-only mode. The live store runs at `https://repo.jimwashkau.com/`.

### Live traffic monitor

On the VPS, run `~/traffic` for a color-coded live view of web requests and license decisions. Run `~/traffic license` to focus on license traffic, `~/traffic errors` for HTTP errors, or `~/traffic --tail 100` to include more recent history. Press Ctrl+C to stop. The script is versioned at `tools/traffic.py`; after updating from GitHub, install it with `install -m 755 tools/traffic.py ~/traffic`. It reads the Caddy and store container logs through Docker Compose. Caddy access logging must be enabled in `Caddyfile` and the containers restarted with `sudo docker compose up -d --build` for new requests to appear.

Each web line shows local time, HTTP status, method, path, HTTP/HTTPS protocol, elapsed time, response bytes, client IP, and user agent. License lines show the decision (`not_started`, `trial`, `expired`, or `paid`), whether a trial was requested, whether a purchase code was supplied, and a short keyed device fingerprint. Request bodies, purchase codes, raw device IDs, signatures, and URL query strings are never printed. The monitor only sees requests that reach Caddy; a direct request to the store container would not appear as a web line.

The JW LLC live webhook endpoint `we_1UK1HI8apqxJlTTcNpE9wCPG` is enabled at `https://repo.jimwashkau.com/stripe/webhook` for the four events in step 4. `tools/activate_live.py` privately prompts for the restricted key and webhook signing secret during initial setup, verifies the price, and saves them in `commerce/.env` with owner-only permissions. Never put those secrets in Git. Complete a Stripe sandbox purchase and Sileo device test before accepting real customers.

A website buyer gets a purchase code after webhook confirmation, then enters it during Sileo sign-in to bind the purchase to their device. A Sileo buyer can start Checkout from the package manager. Sileo receives an expiring one-time download URL only after the purchase is recorded. The package is never copied to the public repo directory.

The previously published Sites page remains a **private catalog preview**; its checkout is disabled. The standalone build enables checkout for the self-hosted service.

## Server-verified Recorder licenses (1.9.6 candidate)

The licensing endpoint is `POST /api/license/lease`. It accepts a device identifier, a first-use request, and optionally a purchase code. SQLite keeps one `device_trials` start time per device hash, so reinstalling the tweak or deleting its local cache does not restart the seven-day trial. Existing verified paid orders grant a paid lease; a website buyer can bind an order by entering the purchase code in the Recorder app. The server signs each response with P-256 ECDSA. The package embeds only the corresponding public key and checks the signature, device hash, package ID, and validity dates. Paid leases permit seven days of offline use before renewal is required. Trial leases expire at their original seven-day deadline.

A signing key was generated locally at `.private/license-signing-key.pem` and its public point at `.private/license-public-key.b64`. Both are ignored by Git. Keep the private key backed up securely. In Google Cloud's browser SSH window, use **Upload file** to transfer the PEM directly to the VM, then run `cd ~/jimwas-repo && install -m 600 ~/license-signing-key.pem .private/license-signing-key.pem && rm ~/license-signing-key.pem`. The `.private` bind mount makes the key available to the store container at `/app/.private/license-signing-key.pem`; `commerce/.env.example` documents `LICENSE_SIGNING_KEY_PATH` for a different path. Never upload the PEM to GitHub or a public web directory. Do not regenerate it without rebuilding the client with its new public point, or existing clients will reject leases.

After pushing the server code and tests to GitHub, copy the updated `commerce/server.js` to `~/jimwas-repo/commerce/server.js` on the VM and run `cd ~/jimwas-repo && sudo docker compose up -d --build`. Check `https://repo.jimwashkau.com/healthz`, then POST `{"device_id":"0123456789ABCDEF0123456789ABCDEF","start_trial":false}` to `/api/license/lease`. A healthy response is a signed payload with `kind: "not_started"` and no trial start; verify its signature against the public point embedded in the client before releasing 1.9.6.

Deploy and test the endpoint before listing the 1.9.6 trial or paid packages. Run `npm --prefix commerce test`, verify the device identifier and signed lease on an iOS 18 phone, test first use, reinstall, expiry, paid activation, and offline capture, then update the private paid `.deb`, its SHA-256 configuration, and APT metadata. The 1.9.5 full package remains unrestricted and cannot be revoked retroactively; remove it from distribution when moving to licensed packages. A rooted user can still patch the tweak or replay a cached lease with a changed device clock, so this guards ordinary reinstall bypass rather than guaranteeing tamper resistance.
