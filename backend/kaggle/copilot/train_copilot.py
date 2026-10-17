"""Kaggle GPU job: LoRA fine-tune Qwen2.5-0.5B-Instruct to emit ChordChat tool calls.

Pushed with `kaggle kernels push -p backend/kaggle/copilot`. The data is the
private Kaggle dataset cadenkeen/chordcraft-copilot-sft, built by
`npx tsx scripts/copilot-data.ts` (chats in exactly the format the browser
sends: system prompt with the current progression, user request, JSON call).

Loss is on the assistant's JSON only. The adapter is merged into the base
weights and saved as safetensors in /kaggle/working/merged, ready for the ONNX
export in backend/copilot/export_onnx.py.
"""

import glob
import json
import math
import os
import random
import subprocess
import sys
import time

subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "-U", "peft"])

import torch  # noqa: E402
from peft import LoraConfig, get_peft_model  # noqa: E402
from transformers import AutoModelForCausalLM, AutoTokenizer, get_cosine_schedule_with_warmup  # noqa: E402

BASE = "Qwen/Qwen2.5-0.5B-Instruct"
REVISION = "7ae557604adf67be50417f59c2c2f167def9a775"
EPOCHS = 2
BATCH = 16
LR = 2e-4
MAX_LEN = 640
SEED = 0

random.seed(SEED)
torch.manual_seed(SEED)
device = "cuda"
print("torch", torch.__version__, "|", torch.cuda.get_device_name(0))

data_dir = os.path.dirname(glob.glob("/kaggle/input/**/train.jsonl", recursive=True)[0])


def load(name):
    with open(os.path.join(data_dir, name)) as f:
        return [json.loads(line) for line in f]


train_rows, val_rows = load("train.jsonl"), load("val.jsonl")

tok = AutoTokenizer.from_pretrained(BASE, revision=REVISION)
model = AutoModelForCausalLM.from_pretrained(BASE, revision=REVISION, dtype=torch.float32).to(device)
model.gradient_checkpointing_enable()
model.enable_input_require_grads()
model = get_peft_model(model, LoraConfig(
    r=16, lora_alpha=32, lora_dropout=0.05, task_type="CAUSAL_LM",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
))
model.print_trainable_parameters()


def encode(row):
    """Prompt exactly as the browser builds it; labels only on the JSON + end-of-turn."""
    msgs = row["messages"]
    prompt = tok.apply_chat_template(msgs[:-1], tokenize=False, add_generation_prompt=True)
    p = tok(prompt, add_special_tokens=False)["input_ids"]
    a = tok(msgs[-1]["content"] + "<|im_end|>", add_special_tokens=False)["input_ids"]
    ids = (p + a)[:MAX_LEN]
    labels = ([-100] * len(p) + a)[:MAX_LEN]
    return ids, labels


def batches(rows, shuffle):
    order = list(range(len(rows)))
    if shuffle:
        random.shuffle(order)
    for i in range(0, len(order), BATCH):
        enc = [encode(rows[j]) for j in order[i:i + BATCH]]
        width = max(len(ids) for ids, _ in enc)
        ids = torch.full((len(enc), width), tok.pad_token_id)
        labels = torch.full((len(enc), width), -100)
        mask = torch.zeros((len(enc), width), dtype=torch.long)
        for r, (x, y) in enumerate(enc):
            ids[r, :len(x)] = torch.tensor(x)
            labels[r, :len(y)] = torch.tensor(y)
            mask[r, :len(x)] = 1
        yield ids.to(device), labels.to(device), mask.to(device)


opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=LR, weight_decay=0.0)
steps = EPOCHS * math.ceil(len(train_rows) / BATCH)
sched = get_cosine_schedule_with_warmup(opt, int(0.05 * steps), steps)
scaler = torch.amp.GradScaler()


@torch.no_grad()
def val_loss():
    model.eval()
    total, n = 0.0, 0
    for ids, labels, mask in batches(val_rows, False):
        with torch.autocast("cuda", dtype=torch.float16):
            total += model(input_ids=ids, attention_mask=mask, labels=labels).loss.item()
        n += 1
    model.train()
    return total / n


step, t0 = 0, time.time()
print("val loss before", round(val_loss(), 4))
for epoch in range(EPOCHS):
    for ids, labels, mask in batches(train_rows, True):
        with torch.autocast("cuda", dtype=torch.float16):
            loss = model(input_ids=ids, attention_mask=mask, labels=labels).loss
        scaler.scale(loss).backward()
        scaler.unscale_(opt)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(opt)
        scaler.update()
        opt.zero_grad()
        sched.step()
        step += 1
        if step % 50 == 0:
            print(f"epoch {epoch} step {step}/{steps} loss {loss.item():.4f} {time.time() - t0:.0f}s", flush=True)
    print(f"epoch {epoch} val loss {val_loss():.4f}", flush=True)

# Exact-match accuracy on held-out synthetic chats (greedy, like the browser).
model.eval()
exact, valid = 0, 0
sample = val_rows[:200]
for row in sample:
    prompt = tok.apply_chat_template(row["messages"][:-1], tokenize=False, add_generation_prompt=True)
    ids = tok(prompt, return_tensors="pt", add_special_tokens=False).to(device)
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16):
        out = model.generate(**ids, max_new_tokens=120, do_sample=False)
    text = tok.decode(out[0, ids["input_ids"].shape[1]:], skip_special_tokens=True).strip()
    want = json.loads(row["messages"][-1]["content"])
    try:
        got = json.loads(text)
        valid += 1
        exact += {k: v for k, v in got.items() if k != "say"} == {k: v for k, v in want.items() if k != "say"}
    except json.JSONDecodeError:
        pass
print(json.dumps({"val_valid_json": valid / len(sample), "val_exact_call": exact / len(sample)}))

merged = model.merge_and_unload()
merged.save_pretrained("/kaggle/working/merged", safe_serialization=True)
tok.save_pretrained("/kaggle/working/merged")
summary = {
    "base": BASE, "revision": REVISION, "epochs": EPOCHS, "lr": LR, "lora_r": 16, "train_examples": len(train_rows),
    "val_valid_json": valid / len(sample), "val_exact_call": exact / len(sample),
}
with open("/kaggle/working/merged/training_summary.json", "w") as f:
    json.dump(summary, f, indent=1)
print("saved merged model")
