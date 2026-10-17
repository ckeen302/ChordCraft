"""Kaggle GPU job: train the ChordTransformer, then evaluate it against the rule engine.

Pushed with `kaggle kernels push -p backend/kaggle --accelerator NvidiaTeslaT4`.
Installs the backend package from GitHub at a pinned commit so every run is
reproducible; the processed dataset is the private Kaggle dataset
cadenkeen/chordcraft-training-phrases.
"""

import glob
import json
import os
import subprocess
import sys
from pathlib import Path

COMMIT = "bfafa36717be046d229581ae6e91106617e6577e"
subprocess.check_call([
    sys.executable, "-m", "pip", "install", "-q", "--no-deps",
    f"git+https://github.com/ckeen302/ChordCraft.git@{COMMIT}#subdirectory=backend",
])

import torch  # noqa: E402

from chordcraft.model.evaluate import run as evaluate  # noqa: E402
from chordcraft.model.train import TrainConfig, train  # noqa: E402

print("torch", torch.__version__, "|", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU")
data_dir = Path(os.path.dirname(glob.glob("/kaggle/input/**/vocab.json", recursive=True)[0]))
out = Path("/kaggle/working/v1")

summary = train(TrainConfig(data=str(data_dir), out=str(out), epochs=3.0, batch_size=512, eval_every=500))
report = evaluate(out / "best.pt", data_dir, per_mood=200, lengths=[4, 8], seed=0)
(out / "eval.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
print(json.dumps({"train": summary, "eval": report["generators"], "test_ppl": report["test_perplexity"]}, indent=1))
