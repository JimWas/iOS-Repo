#!/usr/bin/env python3
"""Build a flat APT repo for free jailbreak packages only."""
import gzip
import hashlib
import json
import re
import shutil
import subprocess
from email.utils import formatdate
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "repo" / "free"
OUTPUT = ROOT / "repo" / "public"
CATALOG = ROOT / "storefront" / "data" / "packages.json"
PRIVATE = ROOT / ".private" / "packages"
FIELDS = ("Package", "Version", "Architecture", "Maintainer", "Depends", "Section", "Priority", "Name", "Author", "Description", "Depiction", "SileoDepiction", "Icon", "Tag")

def digest(path, algorithm):
    h = hashlib.new(algorithm)
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def control_fields(path):
    result = subprocess.run(["dpkg-deb", "-f", str(path)], check=True, capture_output=True, text=True).stdout
    fields = {}
    current = None
    for line in result.splitlines():
        if line.startswith(" ") and current:
            fields[current] += "\n" + line
        elif ":" in line:
            current, value = line.split(":", 1)
            fields[current] = value.strip()
    return fields

def main():
    if not shutil.which("dpkg-deb"):
        raise SystemExit("Install dpkg-deb first (brew install dpkg on macOS).")
    SOURCE.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    entries = []
    catalog = [item for item in json.loads(CATALOG.read_text()) if item.get("priceCents", 0) > 0]
    seen = set()
    for deb in sorted(SOURCE.glob("*.deb")):
        fields = control_fields(deb)
        package_id = fields.get("Package")
        if not package_id or not fields.get("Version") or not fields.get("Architecture"):
            raise SystemExit(f"Missing required control fields in {deb.name}")
        if not re.fullmatch(r"[a-z0-9][a-z0-9+.-]+", package_id):
            raise SystemExit(f"Invalid package ID in {deb.name}")
        if (package_id, fields["Version"], fields["Architecture"]) in seen:
            raise SystemExit(f"Duplicate package version: {deb.name}")
        seen.add((package_id, fields["Version"], fields["Architecture"]))
        if "cydia::commercial" in fields.get("Tag", "").lower():
            raise SystemExit(f"Paid package {deb.name} cannot be published in the public repo")
        target = OUTPUT / deb.name
        shutil.copy2(deb, target)
        lines = [f"{key}: {fields[key]}" for key in FIELDS if key in fields]
        lines += [f"Filename: {deb.name}", f"Size: {target.stat().st_size}", f"MD5sum: {digest(target, 'md5')}", f"SHA256: {digest(target, 'sha256')}"]
        entries.append("\n".join(lines))
        description = fields.get("Description", "")
        catalog.append({"slug": package_id, "name": fields.get("Name", package_id), "icon": "✦", "category": fields.get("Section", "Tweaks"), "priceCents": 0, "summary": description.splitlines()[0], "description": description, "version": fields["Version"]})
    manifest_path = PRIVATE / "manifest.json"
    if manifest_path.exists():
        for package_id, item in json.loads(manifest_path.read_text()).items():
            deb = PRIVATE / item["filename"]
            if not deb.is_file() or digest(deb, "sha256") != item["sha256"]:
                raise SystemExit(f"Private package missing or hash mismatch: {package_id}")
            fields = control_fields(deb)
            if fields.get("Package") != package_id or fields.get("Version") != item["version"]:
                raise SystemExit(f"Private package control mismatch: {package_id}")
            if (package_id, fields["Version"], fields["Architecture"]) in seen:
                raise SystemExit(f"Package is present as both free and paid: {package_id}")
            lines = [f"{key}: {fields[key]}" for key in FIELDS if key in fields and key != "Tag"]
            lines += ["Tag: cydia::commercial", f"Filename: private/{deb.name}", f"Size: {deb.stat().st_size}", f"MD5sum: {digest(deb, 'md5')}", f"SHA256: {item['sha256']}"]
            entries.append("\n".join(lines))
    packages = OUTPUT / "Packages"
    packages.write_text("\n\n".join(entries) + ("\n" if entries else ""))
    with gzip.GzipFile(filename=str(OUTPUT / "Packages.gz"), mode="wb", mtime=0) as f:
        f.write(packages.read_bytes())
    release_lines = ["Origin: JimWas Repo", "Label: JimWas Repo", "Suite: stable", "Codename: ios", "Architectures: iphoneos-arm64 iphoneos-arm", "Components: main", f"Date: {formatdate(usegmt=True)}", "Description: Independent iOS tweaks", "MD5Sum:"]
    for name in ("Packages", "Packages.gz"):
        path = OUTPUT / name
        release_lines.append(f" {digest(path, 'md5')} {path.stat().st_size:>16} {name}")
    release_lines.append("SHA256:")
    for name in ("Packages", "Packages.gz"):
        path = OUTPUT / name
        release_lines.append(f" {digest(path, 'sha256')} {path.stat().st_size:>16} {name}")
    (OUTPUT / "Release").write_text("\n".join(release_lines) + "\n")
    CATALOG.write_text(json.dumps(catalog, indent=2) + "\n")
    print(f"Built {len(entries)} package listing(s) in {OUTPUT}; paid files stayed private")

if __name__ == "__main__":
    main()
