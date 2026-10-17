"""ChordTransformer — a small decoder-only transformer for chord progressions.

Written from scratch in PyTorch, modern-LLM style:

- pre-norm residual blocks with RMSNorm
- multi-head causal self-attention with rotary position embeddings (RoPE)
- SwiGLU feed-forward
- tied input/output embeddings

The sequences are tiny (5 control tokens + ≤16 chords + EOS), so the model is
small (~10M parameters) and trains in minutes on a single GPU.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import torch
import torch.nn.functional as F
from torch import nn


@dataclass
class ModelConfig:
    vocab_size: int
    d_model: int = 384
    n_layers: int = 8
    n_heads: int = 6
    mlp_mult: float = 8 / 3  # SwiGLU hidden = mult * d_model (≈ same params as a 4x GELU MLP)
    max_len: int = 32
    dropout: float = 0.1
    rope_base: float = 10_000.0

    def to_dict(self) -> dict:
        return asdict(self)


class RMSNorm(nn.Module):
    def __init__(self, dim: int, eps: float = 1e-6) -> None:
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + self.eps) * self.weight


def rope_tables(head_dim: int, max_len: int, base: float) -> tuple[torch.Tensor, torch.Tensor]:
    inv_freq = 1.0 / (base ** (torch.arange(0, head_dim, 2).float() / head_dim))
    angles = torch.outer(torch.arange(max_len).float(), inv_freq)  # (T, head_dim/2)
    return angles.cos(), angles.sin()


def apply_rope(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    """Rotate (even, odd) feature pairs of x: (B, H, T, D) by position-dependent angles."""
    x1, x2 = x[..., 0::2], x[..., 1::2]
    t = x.shape[-2]
    c, s = cos[:t], sin[:t]
    out = torch.stack((x1 * c - x2 * s, x1 * s + x2 * c), dim=-1)
    return out.flatten(-2)


class CausalSelfAttention(nn.Module):
    def __init__(self, cfg: ModelConfig) -> None:
        super().__init__()
        assert cfg.d_model % cfg.n_heads == 0
        self.n_heads = cfg.n_heads
        self.head_dim = cfg.d_model // cfg.n_heads
        self.qkv = nn.Linear(cfg.d_model, 3 * cfg.d_model, bias=False)
        self.proj = nn.Linear(cfg.d_model, cfg.d_model, bias=False)
        self.dropout = cfg.dropout

    def forward(self, x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor, pad_mask: torch.Tensor | None):
        b, t, d = x.shape
        q, k, v = self.qkv(x).split(d, dim=-1)
        q, k, v = (z.view(b, t, self.n_heads, self.head_dim).transpose(1, 2) for z in (q, k, v))
        q, k = apply_rope(q, cos, sin), apply_rope(k, cos, sin)

        # Causal mask, optionally also hiding padded keys. Sequences are
        # left-aligned (pads only at the end), so real queries never need them.
        mask = torch.ones(t, t, dtype=torch.bool, device=x.device).tril()
        if pad_mask is not None:
            mask = mask & pad_mask[:, None, None, :]
        y = F.scaled_dot_product_attention(
            q, k, v, attn_mask=mask, dropout_p=self.dropout if self.training else 0.0
        )
        return self.proj(y.transpose(1, 2).reshape(b, t, d))


class SwiGLU(nn.Module):
    def __init__(self, cfg: ModelConfig) -> None:
        super().__init__()
        hidden = int(cfg.mlp_mult * cfg.d_model)
        hidden = 64 * math.ceil(hidden / 64)
        self.gate_up = nn.Linear(cfg.d_model, 2 * hidden, bias=False)
        self.down = nn.Linear(hidden, cfg.d_model, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        gate, up = self.gate_up(x).chunk(2, dim=-1)
        return self.down(F.silu(gate) * up)


class Block(nn.Module):
    def __init__(self, cfg: ModelConfig) -> None:
        super().__init__()
        self.norm1 = RMSNorm(cfg.d_model)
        self.attn = CausalSelfAttention(cfg)
        self.norm2 = RMSNorm(cfg.d_model)
        self.mlp = SwiGLU(cfg)
        self.drop = nn.Dropout(cfg.dropout)

    def forward(self, x, cos, sin, pad_mask):
        x = x + self.drop(self.attn(self.norm1(x), cos, sin, pad_mask))
        return x + self.drop(self.mlp(self.norm2(x)))


class ChordTransformer(nn.Module):
    def __init__(self, cfg: ModelConfig) -> None:
        super().__init__()
        self.cfg = cfg
        self.embed = nn.Embedding(cfg.vocab_size, cfg.d_model)
        self.drop = nn.Dropout(cfg.dropout)
        self.blocks = nn.ModuleList(Block(cfg) for _ in range(cfg.n_layers))
        self.norm = RMSNorm(cfg.d_model)
        self.head = nn.Linear(cfg.d_model, cfg.vocab_size, bias=False)
        self.head.weight = self.embed.weight  # weight tying
        cos, sin = rope_tables(cfg.d_model // cfg.n_heads, cfg.max_len, cfg.rope_base)
        self.register_buffer("rope_cos", cos, persistent=False)
        self.register_buffer("rope_sin", sin, persistent=False)
        self.apply(self._init_weights)
        # Scale residual-branch outputs by depth (GPT-2 style) for stable training.
        for name, p in self.named_parameters():
            if name.endswith("proj.weight") or name.endswith("down.weight"):
                nn.init.normal_(p, mean=0.0, std=0.02 / math.sqrt(2 * cfg.n_layers))

    @staticmethod
    def _init_weights(m: nn.Module) -> None:
        if isinstance(m, (nn.Linear, nn.Embedding)):
            nn.init.normal_(m.weight, mean=0.0, std=0.02)

    def num_params(self) -> int:
        return sum(p.numel() for p in self.parameters())

    def forward(self, ids: torch.Tensor, pad_mask: torch.Tensor | None = None) -> torch.Tensor:
        """ids: (B, T) token ids → logits (B, T, vocab)."""
        if ids.shape[1] > self.cfg.max_len:
            raise ValueError(f"sequence length {ids.shape[1]} exceeds max_len {self.cfg.max_len}")
        x = self.drop(self.embed(ids))
        for block in self.blocks:
            x = block(x, self.rope_cos, self.rope_sin, pad_mask)
        return self.head(self.norm(x))
