"""Export the merged copilot model to ONNX for Transformers.js, then quantize.

Runs as a Kaggle kernel (`kaggle kernels push -p backend/copilot`) that reads
the training kernel's output, or locally:

    uv run --python 3.12 --with "optimum-onnx[onnxruntime]" \
        python backend/copilot/export_onnx.py <merged_dir> <out_dir>

Produces the layout Transformers.js loads from the Hub: config/tokenizer files
at the root, onnx/model_q4.onnx (4-bit MatMulNBits weights, used on WebGPU)
and onnx/model_quantized.onnx (8-bit dynamic quantization, used on WASM). The
fp32 export is deleted afterwards to save space.
"""

import glob
import os
import shutil
import subprocess
import sys
from pathlib import Path

ON_KAGGLE = os.path.exists("/kaggle/input")
if ON_KAGGLE:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "optimum-onnx[onnxruntime]"])

import onnx  # noqa: E402
from onnxruntime.quantization import QuantType, quantize_dynamic  # noqa: E402
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer  # noqa: E402
from optimum.exporters.onnx import main_export  # noqa: E402

if ON_KAGGLE:
    merged = Path(os.path.dirname(glob.glob("/kaggle/input/**/merged/config.json", recursive=True)[0]))
    out = Path("/kaggle/working/chordcraft-copilot")
else:
    merged, out = Path(sys.argv[1]), Path(sys.argv[2])
fp32 = out / "fp32"
main_export(str(merged), output=str(fp32), task="text-generation-with-past", device="cpu")

onnx_dir = out / "onnx"
onnx_dir.mkdir(parents=True, exist_ok=True)
for f in fp32.iterdir():
    if not f.name.startswith("model.onnx"):
        shutil.copy(f, out / f.name)

quantize_dynamic(fp32 / "model.onnx", onnx_dir / "model_quantized.onnx", weight_type=QuantType.QUInt8, per_channel=True, reduce_range=True)
print("wrote", onnx_dir / "model_quantized.onnx")

q4 = MatMulNBitsQuantizer(onnx.load(fp32 / "model.onnx"), block_size=32, is_symmetric=True)
q4.process()
q4.model.save_model_to_file(str(onnx_dir / "model_q4.onnx"), use_external_data_format=False)
print("wrote", onnx_dir / "model_q4.onnx")

shutil.rmtree(fp32)
summary = merged / "training_summary.json"
if summary.exists():
    shutil.copy(summary, out / summary.name)
for f in sorted(out.rglob("*")):
    if f.is_file():
        print(f"{f.relative_to(out)}  {f.stat().st_size / 1e6:.0f} MB")
