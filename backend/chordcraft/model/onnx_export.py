"""Export the chord transformer to ONNX (fp32 + int8) for in-browser inference.

    uv run --extra ml --group export python -m chordcraft.model.onnx_export \\
        --model dist/chord-transformer --data data/processed

Writes ``onnx/model.onnx`` and ``onnx/model_quantized.onnx`` (dynamic int8
weights) into the model directory, then checks both against PyTorch on real
validation prefixes: fp32 must match to float precision; int8 must keep the
next-chord ranking (top-1 agreement) and distribution (KL) close.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from .dataset import PhraseDataset, split_file
from .hub import load_exported


def export_onnx(model_dir: Path) -> tuple[Path, Path]:
    model, tok = load_exported(model_dir)
    out = model_dir / "onnx"
    out.mkdir(exist_ok=True)
    fp32, int8 = out / "model.onnx", out / "model_quantized.onnx"
    dummy = torch.tensor([tok.control_ids("major", 4) + [tok.first_chord_id]])
    batch, seq = torch.export.Dim("batch", min=1, max=64), torch.export.Dim("seq", min=1, max=model.cfg.max_len)
    torch.onnx.export(
        model, (dummy,), fp32, dynamo=True, input_names=["input_ids"], output_names=["logits"],
        dynamic_shapes={"ids": {0: batch, 1: seq}}, external_data=False,
    )
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(fp32, int8, weight_type=QuantType.QInt8)
    return fp32, int8


def verify(model_dir: Path, data: Path, n: int = 512) -> dict:
    import onnxruntime as ort

    model, tok = load_exported(model_dir)
    ds = PhraseDataset(split_file(data, "val"), tok, limit=n)
    rng = np.random.default_rng(0)
    report = {}
    sessions = {name: ort.InferenceSession(str(model_dir / "onnx" / f"{name}.onnx"))
                for name in ("model", "model_quantized")}
    # Real prefixes: control tokens plus a random number of the phrase's chords.
    prefixes = []
    for row in ds.ids:
        row = [int(t) for t in row if t != tok.pad_id]
        cut = int(rng.integers(5, len(row)))
        prefixes.append(row[:cut])
    for name, sess in sessions.items():
        agree, kl_sum, max_diff = 0, 0.0, 0.0
        for p in prefixes:
            ids = np.array([p], dtype=np.int64)
            ref = model(torch.from_numpy(ids))[0, -1].detach().double()
            got = torch.from_numpy(sess.run(["logits"], {"input_ids": ids})[0][0, -1]).double()
            max_diff = max(max_diff, (ref - got).abs().max().item())
            agree += int(ref.argmax() == got.argmax())
            lp, lq = torch.log_softmax(ref, -1), torch.log_softmax(got, -1)
            kl_sum += float((lp.exp() * (lp - lq)).sum())
        report[name] = {"top1_agreement": round(agree / len(prefixes), 4), "mean_kl": round(kl_sum / len(prefixes), 6),
                        "max_abs_logit_diff": round(max_diff, 5),
                        "size_mb": round((model_dir / "onnx" / f"{name}.onnx").stat().st_size / 1e6, 1)}
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", type=Path, required=True, help="exported Hub-layout directory")
    ap.add_argument("--data", type=Path, required=True)
    args = ap.parse_args()
    export_onnx(args.model)
    report = verify(args.model, args.data)
    (args.model / "onnx" / "parity.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
