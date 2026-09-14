"""Render the second backend round beside its preserved six-worker baseline.

Dependency: matplotlib==3.10.8
Usage: python scripts/plot-backend-round2.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
from matplotlib.ticker import FuncFormatter


ROOT = Path(__file__).resolve().parent.parent
RUNTIMES = [("node", "Node", "#B95B2A"), ("bun", "Bun", "#7951A8"),
            ("go-pool", "Go padrão · pool", "#176B91"), ("go-shared", "Go padrão · compartilhada", "#34826A")]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "go/benchmarks/backend-round2-final.json")
    parser.add_argument("--baseline", type=Path, default=ROOT / "go/benchmarks/round2-baseline/go/benchmarks/backend-final.json")
    parser.add_argument("--gc-data", type=Path, default=ROOT / "go/benchmarks/gc-round2-memory-cap.json")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "go/benchmarks")
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8"))
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    if data["status"] != "complete" or baseline["status"] != "complete":
        raise ValueError("Both experiments must be complete")
    if data["mode"] != "final" and args.output_dir.resolve() == (ROOT / "go/benchmarks").resolve():
        raise ValueError("Development plots need a separate output directory")
    rows = [row for row in data["summary"] if row["workers"] == 6]
    old = {row["id"]: row for row in baseline["summary"] if row["workers"] == 6}
    if len(rows) != 9 or {row["id"] for row in rows} != set(old):
        raise ValueError("Expected the same nine workloads with six workers")
    gc_run = None
    if args.gc_data.exists():
        gc_data = json.loads(args.gc_data.read_text(encoding="utf-8"))
        if gc_data.get("status") == "complete" and gc_data.get("confirmedGc"):
            if gc_data["goWorkerBinary"]["sha256"] != data["goWorkerBinary"]["sha256"]:
                raise ValueError("GC confirmation must use the same frozen Go binary")
            gc_run = next(run for run in gc_data["runs"] if run["stage"] == "confirmation" and run["gc"] == gc_data["confirmedGc"])
            if not all(row["maximumRssMiB"] is not None and row["maximumRssMiB"] <= 128 for row in gc_run["summary"].values()):
                raise ValueError("Confirmed GC configuration exceeds the experimental RSS ceiling")
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "text.color": "#243443", "axes.labelcolor": "#243443", "svg.fonttype": "none"})
    metrics = [
        ("throughput", "Vazão com seis workers", "Mil rolagens/s · maior é melhor", "opsPerSecond", 1000),
        ("batches", "Duração real dos lotes com seis workers", "Mediana do lote (ms) · menor é melhor", "medianBatchMs", 1),
        ("rss", "Memória residente após os lotes", "Snapshot RSS mediano (MiB)", "medianSnapshotRssMiB", 1),
    ]
    for name, title, xlabel, field, scale in metrics:
        fig, axes = plt.subplots(3, 3, figsize=(19, 14 if gc_run else 13))
        fig.subplots_adjust(left=0.10, right=0.98, top=0.835, bottom=0.12, hspace=0.55, wspace=0.43)
        fig.suptitle(title, x=0.055, y=0.975, ha="left", fontsize=22, fontweight="bold")
        fig.text(0.055, 0.935, "Segunda rodada versus a1c4bbb · 10.000 chamadas/lote · 5 lotes · mesmas expressões, seeds e modos", fontsize=12)
        fig.legend(handles=[Patch(facecolor="white", edgecolor="#64748B", linewidth=1.6, label="Rodada anterior"),
                            Patch(facecolor="#64748B", edgecolor="#64748B", label="Rodada atual")],
                   loc="upper left", bbox_to_anchor=(0.049, 0.916), ncol=2, frameon=False)
        for ax, row in zip(axes.flat, rows):
            extent = 0
            for position, (runtime, label, color) in enumerate(RUNTIMES):
                for is_current, stats in ((False, old[row["id"]][runtime]), (True, row[runtime])):
                    value = stats[field]
                    y = position + (0.18 if is_current else -0.18)
                    if value is None:
                        ax.text(0, y, "indisponível", va="center", fontsize=8)
                        continue
                    value /= scale
                    extent = max(extent, value)
                    ax.barh(y, value, height=0.29, color=color if is_current else "white", edgecolor=color, linewidth=1.1, zorder=3)
                    if is_current:
                        ax.annotate(f"{value:,.1f}".replace(",", "_").replace(".", ",").replace("_", "."),
                                    (value, y), xytext=(4, 0), textcoords="offset points", va="center", fontsize=8.5, color=color)
            labels = [label for _, label, _ in RUNTIMES]
            if gc_run:
                gc_stats = gc_run["summary"][row["id"]]
                gc_field = {"opsPerSecond": "opsPerSecond", "medianBatchMs": "batchMs", "medianSnapshotRssMiB": "medianRssMiB"}[field]
                value = gc_stats[gc_field] / scale
                extent = max(extent, value)
                ax.barh(4, value, height=0.40, color="#A64267", zorder=3)
                ax.annotate(f"{value:,.1f}".replace(",", "_").replace(".", ",").replace("_", "."),
                            (value, 4), xytext=(4, 0), textcoords="offset points", va="center", fontsize=8.5, color="#A64267")
                labels.append(f"Go pool · GC{gc_run['gc']} / {gc_run.get('memoryLimit') or 'sem cap'}")
            ax.set_title(row["label"], loc="left", fontsize=12, fontweight="bold", pad=10)
            ax.set_yticks(range(len(labels)), labels)
            ax.tick_params(axis="y", labelleft=True, length=0, labelsize=9)
            ax.invert_yaxis()
            ax.set_xlim(0, extent * 1.25 if extent else 1)
            ax.set_xlabel(xlabel, fontsize=9)
            ax.xaxis.set_major_formatter(FuncFormatter(lambda value, _: f"{value:g}".replace(".", ",")))
            ax.grid(axis="x", color="#E3E8ED", linewidth=0.65, zorder=0)
            ax.spines[["top", "right", "left"]].set_visible(False)
        fig.text(0.055, 0.080 if gc_run else 0.064, "As rodadas ocorreram em horários diferentes. As barras mostram medianas; consulte Q1–Q3 e todos os lotes nos arquivos JSON.", fontsize=10)
        if gc_run:
            fig.text(0.055, 0.060, f"GOGC={gc_run['gc']} / GOMEMLIMIT={gc_run.get('memoryLimit') or 'não definido'}: confirmação separada no mesmo binário e 6 workers; maior snapshot em cada carga ≤128 MiB.", fontsize=10, color="#A64267")
        note = ("RSS inclui runtime, workers e harness; cargas anteriores podem influenciar snapshots seguintes. Não representa pico nem heap por operação."
                if name == "rss" else "Chamadas locais sem HTTP nem codificação JSON do resultado completo. Node/Bun: engine por isolate; Go: pool ou engine compartilhada.")
        fig.text(0.055, 0.041, note, fontsize=10)
        fig.text(0.055, 0.018, f"Fonte: backend-round2-final.json, {args.gc_data.name} (se confirmado) e round2-baseline · Ryzen 5 5500 · Windows 11 Pro", fontsize=9, color="#586774")
        args.output_dir.mkdir(parents=True, exist_ok=True)
        fig.canvas.draw()
        for extension in ("png", "svg"):
            output = args.output_dir / f"backend-round2-{name}.{extension}"
            fig.savefig(output, dpi=160, facecolor="white")
            if extension == "svg":
                output.write_text("\n".join(line.rstrip() for line in output.read_text(encoding="utf-8").splitlines()) + "\n", encoding="utf-8")
            print(output)
        plt.close(fig)


if __name__ == "__main__":
    main()
