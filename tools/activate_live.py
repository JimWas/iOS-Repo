#!/usr/bin/env python3
"""Finish the live Stripe setup on the VM without echoing credentials."""

import getpass
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / "commerce" / ".env"
PRICE_ID = "price_1UJyO18apqxJlTTcIMznbGUs"


def fail(message):
    raise SystemExit(message)


def check_price(key):
    request = urllib.request.Request(
        f"https://api.stripe.com/v1/prices/{PRICE_ID}",
        headers={"Authorization": f"Bearer {key}", "Stripe-Version": "2026-08-26.dahlia"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            price = json.load(response)
    except urllib.error.HTTPError as error:
        fail(f"Stripe rejected the key or price lookup (HTTP {error.code}). Check Prices: Read access.")
    except urllib.error.URLError:
        fail("Could not reach Stripe to verify the price. Try again when the connection is working.")
    if (price.get("id"), price.get("currency"), price.get("unit_amount"), price.get("active")) != (
        PRICE_ID, "usd", 3499, True
    ):
        fail("The Stripe key does not match the active $34.99 JimWas Recorder price.")


def main():
    if not ENV_FILE.is_file():
        fail("Server configuration is missing. Ask Codex to prepare it first.")
    current = dict(line.split("=", 1) for line in ENV_FILE.read_text().splitlines() if "=" in line)
    if len(current.get("AUTH_SECRET", "")) < 32:
        fail("The server authentication secret is missing.")

    print("Enter the live JW LLC Stripe secrets. Input is hidden and is never printed.")
    stripe_key = getpass.getpass("Restricted API key (rk_live_...): ").strip()
    webhook_secret = getpass.getpass("Webhook signing secret (whsec_...): ").strip()
    if not stripe_key.startswith("rk_live_") or len(stripe_key) < 20:
        fail("Expected a live restricted API key beginning rk_live_.")
    if not webhook_secret.startswith("whsec_") or len(webhook_secret) < 20:
        fail("Expected a webhook signing secret beginning whsec_.")
    check_price(stripe_key)

    current.update(
        BASE_URL="https://repo.jimwashkau.com",
        STRIPE_SECRET_KEY=stripe_key,
        STRIPE_PRICE_ID=PRICE_ID,
        STRIPE_WEBHOOK_SECRET=webhook_secret,
        DB_PATH=".private/commerce.sqlite",
    )
    handle, temporary = tempfile.mkstemp(prefix=".env.", dir=ENV_FILE.parent, text=True)
    try:
        os.fchmod(handle, 0o600)
        with os.fdopen(handle, "w") as file:
            for name, value in current.items():
                file.write(f"{name}={value}\n")
        os.replace(temporary, ENV_FILE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

    subprocess.run(["sudo", "docker", "compose", "up", "-d"], cwd=ROOT, check=True)
    result = subprocess.run(
        ["sudo", "docker", "compose", "exec", "-T", "store", "node", "-e",
         "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1);console.log('Store is healthy')})"],
        cwd=ROOT,
        check=False,
    )
    if result.returncode:
        fail("The store did not pass its health check. Check: sudo docker compose logs store")
    print("The store is running. Check https://repo.jimwashkau.com after HTTPS starts.")


if __name__ == "__main__":
    main()
