"""Publish the chord model and deploy the API Space on the Hugging Face Hub.

    uv run --extra ml python scripts/publish_hf.py model   # dist/chord-transformer → model repo
    uv run --extra ml python scripts/publish_hf.py space   # backend → Docker Space

Both are public. The Space downloads the model from the Hub at startup
(CHORD_MODEL_REPO) and allows CORS from the ChordCraft Vercel deployments.
"""

from __future__ import annotations

import argparse
import shutil
import tempfile
from pathlib import Path

from huggingface_hub import HfApi

BACKEND = Path(__file__).resolve().parents[1]
MODEL_REPO = "ckeen302/chordcraft-chord-transformer"
SPACE_REPO = "ckeen302/chordcraft-api"
# Every Vercel project/preview built from the repo (chordcraft-*, chord-craft-*).
VERCEL_ORIGINS = r"^https://chord-?craft[a-z0-9-]*\.vercel\.app$"

SPACE_README = f"""---
title: ChordCraft API
emoji: 🎹
colorFrom: green
colorTo: indigo
sdk: docker
app_port: 7860
license: cc-by-nc-4.0
models:
  - {MODEL_REPO}
short_description: Chord theory engine + AI chord-progression transformer
---

# ChordCraft API

FastAPI backend for [ChordCraft](https://github.com/ckeen302/ChordCraft): chord
parsing/analysis and progression generation with a custom chord transformer
([{MODEL_REPO}](https://huggingface.co/{MODEL_REPO})).

Interactive docs: `/docs`. Try `POST /v1/generate` with
`{{"key": "A Minor", "mood": "epic", "length": 4}}`.
"""


def publish_model(api: HfApi, folder: Path) -> str:
    if not (folder / "model.safetensors").exists():
        raise SystemExit(f"{folder} has no model.safetensors — run `python -m chordcraft.model.hub export` first")
    api.create_repo(MODEL_REPO, repo_type="model", exist_ok=True, private=False)
    api.upload_folder(repo_id=MODEL_REPO, repo_type="model", folder_path=folder,
                      commit_message="Publish chord transformer v1")
    return f"https://huggingface.co/{MODEL_REPO}"


def deploy_space(api: HfApi) -> str:
    api.create_repo(SPACE_REPO, repo_type="space", space_sdk="docker", exist_ok=True, private=False)
    api.add_space_variable(SPACE_REPO, "CHORD_MODEL_REPO", MODEL_REPO)
    api.add_space_variable(SPACE_REPO, "ALLOWED_ORIGIN_REGEX", VERCEL_ORIGINS)
    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp)
        for name in ("Dockerfile", ".dockerignore", "pyproject.toml", "uv.lock"):
            shutil.copy(BACKEND / name, stage / name)
        shutil.copytree(BACKEND / "chordcraft", stage / "chordcraft",
                        ignore=shutil.ignore_patterns("__pycache__"))
        (stage / "README.md").write_text(SPACE_README)
        api.upload_folder(repo_id=SPACE_REPO, repo_type="space", folder_path=stage,
                          commit_message="Deploy ChordCraft API")
    return f"https://huggingface.co/spaces/{SPACE_REPO}  (API: https://{SPACE_REPO.replace('/', '-')}.hf.space)"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("what", choices=["model", "space"])
    ap.add_argument("--folder", type=Path, default=BACKEND / "dist" / "chord-transformer")
    args = ap.parse_args()
    api = HfApi()
    print(publish_model(api, args.folder) if args.what == "model" else deploy_space(api))


if __name__ == "__main__":
    main()
