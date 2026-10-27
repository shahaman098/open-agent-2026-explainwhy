#!/usr/bin/env python3
"""Prepare the official local Zetaris stack. Image entitlement remains a prerequisite."""
import argparse
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / ".local" / "zetaris-freemium"
REVISION = "9dd4fe943afebca6b204b6ed5eccdca91b831e6c"
SERVICES = ["zetaris-db", "zetaris-server", "zetaris-api", "zetaris-gui"]

def run(*args):
    subprocess.run(args, check=True, cwd=ROOT)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", action="store_true", help="Pull and start the four official services after Docker Hub access is enabled")
    args = parser.parse_args()
    DEST.parent.mkdir(exist_ok=True)
    if not DEST.exists():
        run("git", "clone", "--no-checkout", "https://github.com/zetaris/Freemium.git", str(DEST))
        run("git", "-C", str(DEST), "checkout", "--detach", REVISION)
    actual = subprocess.check_output(["git", "-C", str(DEST), "rev-parse", "HEAD"], text=True).strip()
    if actual != REVISION:
        raise SystemExit("Existing Zetaris checkout differs from the pinned revision; inspect it before continuing.")
    # Compose !override replaces, rather than appends to, upstream public port bindings.
    override = "services:\n"
    for service, ports in {"zetaris-db": [], "zetaris-server": [10000, 9998, 4040], "zetaris-api": [8888, 8889], "zetaris-gui": [9001]}.items():
        override += f"  {service}:\n    ports: !override " + ("[]\n" if not ports else "\n" + "".join(f'      - "127.0.0.1:{port}:{port}"\n' for port in ports))
    (DEST / "explainwhy.override.yml").write_text(override)
    export = ROOT / ".local" / "zetaris-data"
    export.mkdir(exist_ok=True)
    shared = DEST / "customer_data" / "shared" / "explainwhy"
    shared.mkdir(parents=True, exist_ok=True)
    print(f"Prepared official Zetaris {REVISION} at {DEST}")
    print(f"Export data with npm run zetaris:export, then copy ads.csv and campaigns.csv into {shared}")
    print("Register both CSV files in Zetaris as two relations with the column names from their headers; see docs/sponsor-integrations/README.md.")
    if args.start:
        command = ["docker", "compose", "-p", "explainwhy-zetaris", "-f", str(DEST / "docker-compose.yml"), "-f", str(DEST / "explainwhy.override.yml")]
        run(*command, "pull", *SERVICES)
        run(*command, "up", "-d", *SERVICES)
        print("Zetaris UI: http://localhost:9001  API: http://localhost:8888")
        print("Create the local development user using the official Freemium README procedure. Do not use these demo credentials on a hosted service.")

if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError:
        raise SystemExit("Zetaris setup did not complete. Check Docker is running and that your account can pull the official Zetaris images.")
