"""Train the ChordTransformer on a Modal GPU.

One-time data upload (the processed dataset is ~25 MB):
    modal volume create chordcraft-data
    modal volume put chordcraft-data data/processed /processed

Train, then fetch the checkpoint:
    modal run modal_train.py --run-name v1 --epochs 3
    modal volume get chordcraft-runs v1 runs/

The job is capped at 30 minutes so a mistake can't burn through credits.
"""

import modal

app = modal.App("chordcraft-train")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("torch==2.14.1", "numpy>=2.0")
    .add_local_python_source("chordcraft")
)
data_vol = modal.Volume.from_name("chordcraft-data", create_if_missing=True)
runs_vol = modal.Volume.from_name("chordcraft-runs", create_if_missing=True)


@app.function(image=image, gpu="T4", volumes={"/data": data_vol, "/runs": runs_vol}, timeout=30 * 60)
def train_remote(run_name: str, epochs: float, batch_size: int, lr: float) -> dict:
    from chordcraft.model.train import TrainConfig, train

    cfg = TrainConfig(data="/data/processed", out=f"/runs/{run_name}", epochs=epochs,
                      batch_size=batch_size, lr=lr, eval_every=500)
    try:
        return train(cfg)
    finally:
        runs_vol.commit()  # keep checkpoints/metrics even if the run dies


@app.local_entrypoint()
def main(run_name: str = "v1", epochs: float = 3.0, batch_size: int = 512, lr: float = 1e-3) -> None:
    print(train_remote.remote(run_name, epochs, batch_size, lr))
