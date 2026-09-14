"""Plot the recorded Go GC selection experiment; no benchmarks are run.

Dependency: python -m pip install matplotlib==3.10.8
Usage: python scripts/plot-go-gc.py
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.ticker import FuncFormatter


ROOT = Path(__file__).resolve().parent.parent
COLORS = {100: "#64748B", 200: "#176B91", 500: "#B95B2A", 1000: "#7951A8"}
MARKERS = {100: "o", 200: "s", 500: "D", 1000: "^"}


def positive(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError(f"Expected positive finite measurement, got {value!r}")
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "go/benchmarks/gc-tuning.json")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "go/benchmarks")
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8"))
    if data["status"] != "complete" or data["configuration"]["samples"] != 5:
        raise ValueError("Expected a complete experiment with five batches per configuration")
    runs = {run["gc"]: run for run in data["runs"] if run["stage"] == "selection"}
    if set(runs) != set(COLORS) or len(data["configuration"]["workloads"]) != 9:
        raise ValueError("Expected four GOGC selection configurations and nine workloads")

    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.labelcolor": "#243443",
                         "text.color": "#243443", "axes.edgecolor": "#B7C2CC", "svg.fonttype": "none"})
    fig, axes = plt.subplots(3, 3, figsize=(18, 12.5))
    fig.subplots_adjust(left=0.065, right=0.97, top=0.835, bottom=0.14, hspace=0.54, wspace=0.30)
    fig.suptitle("Go: vazão e memória com diferentes configurações de GC", x=0.055, y=0.975, ha="left", fontsize=21, fontweight="bold")
    fig.text(0.055, 0.934, "6 workers · uma engine por worker · 5 lotes de 10.000 rolagens · sementes únicas · GOMAXPROCS=12", fontsize=12)
    handles = [Line2D([], [], color=COLORS[gc], marker=MARKERS[gc], linestyle="none", markersize=8, label=f"GOGC={gc}") for gc in COLORS]
    fig.legend(handles=handles, loc="upper left", bbox_to_anchor=(0.049, 0.913), frameon=False, ncol=4, columnspacing=3)

    for ax, workload in zip(axes.flat, data["configuration"]["workloads"]):
        workload_id = workload["id"]
        xs, ys = [], []
        for gc, run in runs.items():
            stats = run["summary"][workload_id]
            rss = positive(stats["medianRssMiB"])
            throughput = positive(stats["opsPerSecond"]) / 1000
            samples = run["output"]["cases"][workload_id]
            memory = run["output"]["memory"][workload_id]["afterBatches"]
            if len(samples) != 5 or len(memory) != 5 or not all(snapshot["available"] for snapshot in memory):
                raise ValueError(f"Incomplete samples for {workload_id}, GOGC={gc}")
            rss_samples = sorted(positive(snapshot["rssBytes"]) / 2**20 for snapshot in memory)
            rates = sorted(positive(sample["opsPerSecond"]) / 1000 for sample in samples)
            if not math.isclose(rss_samples[2], rss) or not math.isclose(rates[2], throughput):
                raise ValueError(f"Recorded summary differs from raw medians: {workload_id}, GOGC={gc}")
            ax.errorbar(rss, throughput, xerr=[[rss - rss_samples[1]], [rss_samples[3] - rss]],
                        yerr=[[throughput - rates[1]], [rates[3] - throughput]], color=COLORS[gc],
                        marker=MARKERS[gc], markersize=7, capsize=3, elinewidth=1.3, linestyle="none", zorder=3)
            offset = {100: (5, -17), 200: (5, 7), 500: (5, -17), 1000: (5, 7)}[gc]
            ax.annotate(str(gc), (rss, throughput), xytext=offset, textcoords="offset points", fontsize=9, color=COLORS[gc], fontweight="bold")
            xs.append(rss)
            ys.append(throughput)
        ax.plot(xs, ys, color="#B7C2CC", linewidth=0.9, linestyle=(0, (3, 3)), zorder=1)
        ax.set_title(workload["label"], loc="left", fontsize=12, fontweight="bold", pad=12)
        ax.set_xlabel("RSS mediano (MiB)")
        ax.set_ylabel("Mil rolagens/s")
        ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}".replace(".", ",")))
        ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}".replace(".", ",")))
        ax.margins(x=0.20, y=0.30)
        ax.set_xlim(left=0)
        ax.grid(color="#E3E8ED", linewidth=0.65, zorder=0)
        ax.spines[["top", "right"]].set_visible(False)

    fig.text(0.055, 0.079, "Pontos: medianas; barras: Q1–Q3 dos cinco lotes. Linhas ligam GOGC 100 → 200 → 500 → 1000; não representam um modelo.", fontsize=10)
    fig.text(0.055, 0.056, "RSS é um snapshot após cada lote, não o pico; cargas anteriores no mesmo processo podem influenciá-lo. A variação não é monotônica.", fontsize=10)
    fig.text(0.055, 0.033, "Somente a etapa de seleção deste experimento Go; confirmação 100/200 não exibida. O teto experimental usa o maior snapshot, não a mediana.", fontsize=10)
    fig.text(0.055, 0.012, "Fonte: go/benchmarks/gc-tuning.json · Ryzen 5 5500 · Windows 11 Pro · Go 1.26.2 · detalhes e confirmação em go/GC_TUNING.md", fontsize=9, color="#586774")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    fig.canvas.draw()
    for extension in ("png", "svg"):
        path = args.output_dir / f"gc-tradeoff.{extension}"
        fig.savefig(path, dpi=160, facecolor="white")
        if extension == "svg":
            path.write_text("\n".join(line.rstrip() for line in path.read_text(encoding="utf-8").splitlines()) + "\n", encoding="utf-8")
        print(path)
    plt.close(fig)


if __name__ == "__main__":
    main()
