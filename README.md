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

The Google Cloud project is `project-6c934194-73a4-42f4-914`. Its Debian 13 VM `jimwas-repo` is in `asia-southeast1-c`, with reserved IP `34.126.76.107`. Cloudflare's `repo` A record points to that IP in DNS-only mode. The Docker image has been built and the app passed an isolated `/healthz` smoke test. The live site is not started until the Stripe key and webhook signing secret are entered on the VM.

The JW LLC live webhook endpoint `we_1UK1HI8apqxJlTTcNpE9wCPG` is enabled at `https://repo.jimwashkau.com/stripe/webhook` for the four events in step 4. To finish the live launch without exposing secrets in chat, reveal that endpoint's signing secret in Stripe's webhook settings. In the Google Cloud browser SSH window, run `cd ~/jimwas-repo && python3 tools/activate_live.py`. Paste the restricted key and webhook signing secret at the hidden prompts. The helper checks the key against the Stripe price, saves the secrets in `commerce/.env` with owner-only permissions, starts the containers, and checks the store health endpoint. Verify HTTPS, the listing, and that `/private/com.jimwas.recorder_1.9.5_iphoneos-arm64.deb` does not serve the paid package before announcing the repo. Then complete a Stripe sandbox purchase and Sileo device test before accepting real customers.

A website buyer gets a purchase code after webhook confirmation, then enters it during Sileo sign-in to bind the purchase to their device. A Sileo buyer can start Checkout from the package manager. Sileo receives an expiring one-time download URL only after the purchase is recorded. The package is never copied to the public repo directory.

The previously published Sites page remains a **private catalog preview**; its checkout is disabled. The standalone build enables checkout for the self-hosted service.
