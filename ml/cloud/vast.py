"""Small wrapper over the Vast.ai CLI for Listen training runs.

The API key comes from the vastai CLI's own config (`vastai set api-key ...`) or
VAST_API_KEY; it is never stored in this repository. Nothing is rented without --yes.

    uv run python cloud/vast.py offers --hours 6          # cheapest suitable GPUs, with total cost
    uv run python cloud/vast.py create OFFER_ID --yes      # rent one
    uv run python cloud/vast.py sync INSTANCE_ID           # copy ml/ (code, catalog, clips) to the box
    uv run python cloud/vast.py run INSTANCE_ID "bash cloud/setup.sh"
    uv run python cloud/vast.py destroy INSTANCE_ID --yes
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ML = Path(__file__).resolve().parent.parent
IMAGE = "pytorch/pytorch:2.5.1-cuda12.4-cudnn9-devel"
# Rendering happens on the CPU, so a fast GPU needs many cores to stay busy.
QUERY = "reliability>0.98 num_gpus=1 gpu_ram>=40 cpu_cores_effective>=32 disk_space>=150 inet_down>=500 rentable=true verified=true"


def vast(*args: str) -> str:
    env = dict(os.environ)
    command = ["vastai", *args, "--raw"]
    if "VAST_API_KEY" in env:
        command += ["--api-key", env["VAST_API_KEY"]]
    result = subprocess.run(command, capture_output=True, text=True, env=env)
    if result.returncode:
        sys.exit(result.stderr.strip() or result.stdout.strip())
    return result.stdout


def ssh_target(instance: str) -> tuple[str, str]:
    info = json.loads(vast("show", "instance", instance))
    return f"root@{info['ssh_host']}", str(info["ssh_port"])


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    offers = sub.add_parser("offers")
    offers.add_argument("--hours", type=float, default=6)
    offers.add_argument("--gpu", default="", help='e.g. "H100_SXM" or "A100_SXM4"')
    create = sub.add_parser("create")
    create.add_argument("offer")
    create.add_argument("--disk", type=int, default=150)
    create.add_argument("--yes", action="store_true")
    for name in ("sync", "destroy", "ssh"):
        command = sub.add_parser(name)
        command.add_argument("instance")
        command.add_argument("--yes", action="store_true")
    run = sub.add_parser("run")
    run.add_argument("instance")
    run.add_argument("script")
    args = parser.parse_args()

    if args.command == "offers":
        query = QUERY + (f" gpu_name={args.gpu}" if args.gpu else "")
        rows = sorted(json.loads(vast("search", "offers", query)), key=lambda offer: offer["dph_total"])[:15]
        print(f"{'id':>10}  {'gpu':14} {'vram':>5} {'cpus':>5} {'$/h':>6} {'total':>7}  location")
        for offer in rows:
            print(f"{offer['id']:>10}  {offer['gpu_name']:14} {offer['gpu_ram'] / 1024:5.0f} {offer['cpu_cores_effective']:5.0f} {offer['dph_total']:6.2f} {offer['dph_total'] * args.hours:7.2f}  {offer.get('geolocation', '')}")
    elif args.command == "create":
        if not args.yes:
            sys.exit("Renting costs money: re-run with --yes to confirm.")
        print(vast("create", "instance", args.offer, "--image", IMAGE, "--disk", str(args.disk), "--ssh", "--direct"))
    elif args.command == "destroy":
        if not args.yes:
            sys.exit("This deletes the box and its disk: re-run with --yes to confirm.")
        print(vast("destroy", "instance", args.instance))
    elif args.command == "sync":
        host, port = ssh_target(args.instance)
        subprocess.run(["rsync", "-az", "--info=progress2", "-e", f"ssh -p {port} -o StrictHostKeyChecking=accept-new",
                        "--exclude", ".venv", "--exclude", "cache/clews", "--exclude", "cache/checkpoints", "--exclude", "cache/soundfonts",
                        "--exclude", "cache/renders", "--exclude", "runs", f"{ML}/", f"{host}:/workspace/ml/"], check=True)
    elif args.command == "run":
        host, port = ssh_target(args.instance)
        subprocess.run(["ssh", "-p", port, "-o", "StrictHostKeyChecking=accept-new", host, f"cd /workspace/ml && {args.script}"], check=True)
    elif args.command == "ssh":
        host, port = ssh_target(args.instance)
        print(f"ssh -p {port} {host}")


if __name__ == "__main__":
    main()
