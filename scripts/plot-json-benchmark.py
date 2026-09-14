"""Plot full API calls plus JSON encoding with six workers. matplotlib==3.10.8."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "go/benchmarks/json-final.json")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "go/benchmarks")
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8"))
    if data["status"] != "complete" or data["mode"] != "final":
        raise ValueError("Expected a complete final JSON benchmark")
    rows = [row for row in data["summary"] if row["workers"] == 6 and row["operation"] == "build-and-encode"]
    if len(rows) != 3:
        raise ValueError("Expected three full workloads with six workers")
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "text.color": "#243443", "axes.labelcolor": "#243443", "svg.fonttype": "none"})
    fig, axes = plt.subplots(3, 1, figsize=(13, 11))
    fig.subplots_adjust(left=0.27, right=0.94, top=0.835, bottom=0.14, hspace=0.60)
    fig.suptitle("Resultado completo + JSON: seis workers", x=0.055, y=0.97, ha="left", fontsize=21, fontweight="bold")
    fig.text(0.055, 0.928, "10.000 chamadas por lote · cinco lotes · mesmos inputs e seeds · sem rede nem transporte do payload", fontsize=11)
    if data.get("gcSummary"):
        config = data["confirmedGc"]
        fig.text(0.055, 0.89, f"Configuração adicional: Go pool, GOGC={config['gc']} e GOMEMLIMIT={config.get('memoryLimit') or 'não definido'}; selecionada na API sem JSON.", fontsize=10, color="#A64267")
    for ax, row in zip(axes, rows):
        series = [("Node", "#B95B2A", row["node"]), ("Bun", "#7951A8", row["bun"]),
                  ("Go padrão · pool", "#176B91", row["go-pool"]), ("Go padrão · compartilhada", "#34826A", row["go-shared"])]
        if data.get("gcSummary"):
            tuned = next(item for item in data["gcSummary"] if item["id"] == row["id"])
            config = data["confirmedGc"]
            series.append((f"Go pool · GC{config['gc']} / {config.get('memoryLimit') or 'sem cap'}", "#A64267", tuned["stats"]))
        extent = 0
        requests = data["configuration"]["operations"]["build-and-encode"]["requests"]
        for position, (label, color, stats) in enumerate(series):
            value = stats["opsPerSecond"] / 1000
            low = requests / stats["q3BatchMs"]
            high = requests / stats["q1BatchMs"]
            extent = max(extent, high)
            ax.barh(position, value, color=color, height=0.56, zorder=3)
            ax.errorbar(value, position, xerr=[[max(0, value - low)], [max(0, high - value)]], color="#243443", capsize=3, linewidth=1, zorder=4)
            ax.annotate(f"{value:.1f}".replace(".", ","), (high, position), xytext=(6, 0), textcoords="offset points", va="center", fontsize=9, color=color)
        ax.set_title(row["label"], loc="left", fontweight="bold", fontsize=12, pad=8)
        ax.set_yticks(range(len(series)), [label for label, _, _ in series])
        ax.tick_params(axis="y", labelleft=True, length=0)
        ax.invert_yaxis()
        ax.set_xlim(0, extent * 1.15)
        ax.set_xlabel("Mil chamadas/s · maior é melhor")
        ax.xaxis.set_major_formatter(FuncFormatter(lambda value, _: f"{value:g}".replace(".", ",")))
        ax.grid(axis="x", color="#E3E8ED", linewidth=0.65)
        ax.spines[["top", "right", "left"]].set_visible(False)
    fig.text(0.055, 0.075, "Barras: medianas do throughput; intervalos: Q1–Q3 dos lotes. Não são percentis de latência individual.", fontsize=10)
    fig.text(0.055, 0.051, "Node/Bun produzem strings via JSON.stringify; Go produz bytes via json.Marshal. Não inclui UTF-8 adicional no JavaScript.", fontsize=10)
    fig.text(0.055, 0.027, "Fonte: go/benchmarks/json-final.json · Ryzen 5 5500 · Windows 11 Pro · encoding-only permanece separado no relatório.", fontsize=9, color="#586774")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    fig.canvas.draw()
    for extension in ("png", "svg"):
        output = args.output_dir / f"json-throughput.{extension}"
        fig.savefig(output, dpi=160, facecolor="white")
        if extension == "svg":
            output.write_text("\n".join(line.rstrip() for line in output.read_text(encoding="utf-8").splitlines()) + "\n", encoding="utf-8")
        print(output)
    plt.close(fig)


if __name__ == "__main__":
    main()
