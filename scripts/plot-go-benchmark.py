"""Render the measured Go/TypeScript benchmark without recomputing statistics.

Install the plotting dependency: python -m pip install matplotlib==3.10.8
Run from any directory: python scripts/plot-go-benchmark.py
Optional paths: --input comparison-final.json --output-dir output-directory
Development previews additionally require --allow-development.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import textwrap

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.ticker import FixedLocator, FuncFormatter, NullLocator


ROOT = Path(__file__).resolve().parent.parent
GO_COLOR = "#176B91"
TS_COLOR = "#B95B2A"
BUN_COLOR = "#7951A8"
TEXT_COLOR = "#243443"
MUTED_COLOR = "#586774"


def positive_number(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field}: expected a positive finite number")
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{field}: expected a positive finite number")
    return float(value)


def read_comparison(path: Path, allow_development: bool) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schemaVersion") != 1 or data.get("status") != "complete":
        raise ValueError("Expected a complete benchmark with schemaVersion=1")
    if data.get("mode") != "final" and not allow_development:
        raise ValueError("Only final measurements may be plotted without --allow-development")
    rows = data.get("summary", [])
    if not rows or len({row["id"] for row in rows}) != len(rows):
        raise ValueError("Expected non-empty summary with unique workload IDs")
    if {row["id"] for row in rows} != {row["id"] for row in data["workloads"]}:
        raise ValueError("Summary and measured workloads must contain the same IDs")
    samples = data["configuration"]["samples"]
    for row in rows:
        for runtime in ("go", "typescript", "bun") if "bun" in row else ("go", "typescript"):
            stats = row[runtime]
            median, q1, q3 = (
                positive_number(stats[field], f"{row['id']}.{runtime}.{field}")
                for field in ("medianNsPerOp", "q1NsPerOp", "q3NsPerOp")
            )
            if not q1 <= median <= q3 or len(stats["samples"]) != samples:
                raise ValueError(f"Inconsistent quartiles/sample count: {row['id']}.{runtime}")
        ratio = positive_number(row["typescriptOverGo"], f"{row['id']}.typescriptOverGo")
        if ratio != row["typescript"]["medianNsPerOp"] / row["go"]["medianNsPerOp"]:
            raise ValueError(f"Ratio does not match the recorded medians: {row['id']}")
        if "bun" in row and row["bunOverGo"] != row["bun"]["medianNsPerOp"] / row["go"]["medianNsPerOp"]:
            raise ValueError(f"Bun ratio does not match recorded medians: {row['id']}")
    return data


def portuguese_number(value: float, decimals: int = 2) -> str:
    return f"{value:,.{decimals}f}".replace(",", "_").replace(".", ",").replace("_", ".")


def workload_label(row: dict) -> str:
    label = row["label"]
    for original, translated in (
        ("full", "completo"), ("details", "detalhes"),
        ("summary", "resumo"), ("compact", "compacto"), ("seeds", "sementes"),
    ):
        label = label.replace(original, translated)
    return textwrap.fill(label, width=43, break_long_words=False)


def base_figure(data: dict, title: str, subtitle: str):
    rows = data["summary"]
    three = "bun" in rows[0]
    fig = plt.figure(figsize=(17 if three else 15, max(10.5, 0.46 * len(rows) + 3.7)), facecolor="white")
    ax = fig.add_axes((0.30, 0.185, 0.41, 0.67) if three else (0.345, 0.185, 0.48, 0.67))
    for index in range(len(rows)):
        if index % 2 == 0:
            ax.axhspan(index - 0.5, index + 0.5, color="#F3F6F8", zorder=0)
    ax.set_yticks(range(len(rows)), [workload_label(row) for row in rows])
    ax.set_ylim(len(rows) - 0.4, -0.6)
    ax.tick_params(axis="y", length=0, pad=16, labelsize=10.5)
    ax.tick_params(axis="x", colors=MUTED_COLOR, labelsize=10, length=0, pad=9)
    ax.set_axisbelow(True)
    ax.grid(axis="x", color="#DCE3E8", linewidth=0.7)
    for spine in ax.spines.values():
        spine.set_visible(False)
    prefix = "" if data["mode"] == "final" else f"PRÉVIA ({data['mode']}) · "
    fig.text(0.045, 0.962, prefix + title, fontsize=21, weight="bold", color=TEXT_COLOR)
    fig.text(0.045, 0.921, subtitle, fontsize=11.5, color=MUTED_COLOR)
    env = data["environment"]
    runtime = f"{env['go'].replace('go version ', '')} · Node {env['node']}"
    if "bun" in env:
        runtime += f" · Bun {env['bun']}"
    machine = f"{env['cpuModel'].strip()} · {env['osVersion']} · {env['arch']}"
    fig.text(0.045, 0.055, runtime + "\n" + machine, fontsize=9, color=MUTED_COLOR, linespacing=1.6)
    return fig, ax


def latency_figure(data: dict, source: Path):
    rows = data["summary"]
    samples = data["configuration"]["samples"]
    fig, ax = base_figure(
        data, "Tempo por operação",
        f"{len(rows)} cargas · {samples} amostras por implementação · mediana menor indica menos tempo",
    )
    all_bounds = []
    series = (
        ("go", GO_COLOR, -0.15, "o", 1.095),
        ("typescript", TS_COLOR, 0.15, "s", 1.26),
    )
    if "bun" in rows[0]:
        series = (("go", GO_COLOR, -0.23, "o", 1.12),
                  ("typescript", TS_COLOR, 0, "s", 1.36),
                  ("bun", BUN_COLOR, 0.23, "^", 1.60))
    labels = {"go": "Go", "typescript": "Node", "bun": "Bun"}
    for runtime, color, offset, marker, column in series:
        medians = [row[runtime]["medianNsPerOp"] / 1000 for row in rows]
        lower = [row[runtime]["q1NsPerOp"] / 1000 for row in rows]
        upper = [row[runtime]["q3NsPerOp"] / 1000 for row in rows]
        all_bounds.extend(lower + upper)
        ax.errorbar(
            medians, [index + offset for index in range(len(rows))],
            xerr=[[m - lo for m, lo in zip(medians, lower)], [hi - m for m, hi in zip(medians, upper)]],
            fmt=marker, markersize=5.5, color=color, linewidth=1.8,
            capsize=3.2, capthick=1.3, zorder=3,
        )
        for index, median in enumerate(medians):
            ax.text(column, index, portuguese_number(median), transform=ax.get_yaxis_transform(),
                    ha="right", va="center", fontsize=10, color=color, clip_on=False)
    ax.set_xscale("log")
    left, right = min(all_bounds) / 1.4, max(all_bounds) * 1.5
    ax.set_xlim(left, right)
    ticks = [factor * 10 ** exponent for exponent in range(-5, 9) for factor in (1, 2, 5)]
    ax.xaxis.set_major_locator(FixedLocator([tick for tick in ticks if left <= tick <= right]))
    ax.xaxis.set_major_formatter(FuncFormatter(lambda x, _: portuguese_number(x, 0 if x >= 1 else 1)))
    ax.xaxis.set_minor_locator(NullLocator())
    ax.set_xlabel("Tempo mediano por operação (µs, escala logarítmica)", labelpad=15, fontsize=11)
    fig.legend(
        handles=[Line2D([], [], marker=marker, color=color, label=labels[runtime]) for runtime, color, _, marker, _ in series],
        loc="lower left", bbox_to_anchor=(0.30, 0.869), frameon=False, ncol=len(series), fontsize=10.5,
    )
    for runtime, color, _, _, column in series:
        ax.text(column, 1.044, f"{labels[runtime]} (µs)", transform=ax.transAxes, ha="right", fontsize=10.5, color=color, weight="bold")
    fig.text(0.045, 0.113,
             "Pontos: mediana. Barras: intervalo interquartil (Q1–Q3) das médias por lote.\n"
             "As barras descrevem a variação entre amostras, não percentis de operações individuais.",
             fontsize=9.5, color=MUTED_COLOR, linespacing=1.6, va="top")
    fig.text(0.96, 0.025, f"Fonte: {source.name}", fontsize=8.5, color=MUTED_COLOR, ha="right")
    ax.set_yticks(range(len(rows)))
    ax.set_yticklabels([workload_label(row) for row in rows])
    ax.tick_params(axis="y", labelleft=True)
    fig.canvas.draw()
    return fig


def speedup_figure(data: dict, source: Path):
    rows = data["summary"]
    if "bun" in rows[0]:
        return three_runtime_speedup(data, source)
    fig, ax = base_figure(
        data, "Razão entre os tempos medianos",
        "TypeScript ÷ Go · 1× indica a mesma mediana · comparação local das mesmas cargas",
    )
    ratios = [row["typescriptOverGo"] for row in rows]
    extent = max(1, math.ceil(max(abs(math.log2(ratio)) for ratio in ratios)))
    limit = 2 ** (extent + 0.18)
    ax.set_xscale("log", base=2)
    ax.set_xlim(1 / limit, limit)
    ax.axvspan(1 / limit, 1, color=TS_COLOR, alpha=0.05, zorder=0)
    ax.axvspan(1, limit, color=GO_COLOR, alpha=0.05, zorder=0)
    ax.axvline(1, color=TEXT_COLOR, linewidth=1.2, linestyle=(0, (4, 4)), zorder=2)
    for index, ratio in enumerate(ratios):
        stats = rows[index]
        overlapping_iqr = (
            stats["go"]["q1NsPerOp"] <= stats["typescript"]["q3NsPerOp"]
            and stats["typescript"]["q1NsPerOp"] <= stats["go"]["q3NsPerOp"]
        )
        color = MUTED_COLOR if overlapping_iqr or ratio == 1 else GO_COLOR if ratio > 1 else TS_COLOR
        ax.plot([1, ratio], [index, index], color=color, linewidth=3.2, solid_capstyle="round", zorder=3)
        ax.plot(ratio, index, "o", color=color, markersize=6.5, zorder=4)
        ratio_decimals = 3 if ratio != 1 and round(ratio, 2) == 1 else 2
        ax.text(1.17, index, portuguese_number(ratio, ratio_decimals) + "×", transform=ax.get_yaxis_transform(),
                ha="right", va="center", fontsize=11, color=color, weight="bold", clip_on=False)
    ticks = [2 ** exponent for exponent in range(-extent, extent + 1)]
    ax.xaxis.set_major_locator(FixedLocator(ticks))
    ax.xaxis.set_major_formatter(FuncFormatter(
        lambda x, _: portuguese_number(x, max(0, -int(round(math.log2(x)))) if x < 1 else 0) + "×"))
    ax.xaxis.set_minor_locator(NullLocator())
    ax.set_xlabel("Razão TS/Go (escala logarítmica, centro em 1×)", labelpad=15, fontsize=11)
    ax.text(0.24, 1.04, "TypeScript com menor mediana", transform=ax.transAxes,
            ha="center", fontsize=10.2, color=TS_COLOR, weight="bold")
    ax.text(0.77, 1.04, "Go com menor mediana", transform=ax.transAxes,
            ha="center", fontsize=10.2, color=GO_COLOR, weight="bold")
    ax.text(1.17, 1.044, "TS ÷ Go", transform=ax.transAxes, ha="right",
            fontsize=10.5, color=TEXT_COLOR, weight="bold")
    ax.set_yticks(range(len(rows)), [workload_label(row) for row in rows])
    fig.text(0.045, 0.113,
             "0,5×: TypeScript usa metade do tempo de Go. 2×: Go usa metade do tempo de TypeScript.\n"
             "Cinza: faixas Q1–Q3 sobrepostas. Razões calculadas das medianas; a dispersão aparece no gráfico de latência.",
             fontsize=9.5, color=MUTED_COLOR, linespacing=1.6, va="top")
    fig.text(0.96, 0.025, f"Fonte: {source.name}", fontsize=8.5, color=MUTED_COLOR, ha="right")
    return fig


def three_runtime_speedup(data: dict, source: Path):
    rows = data["summary"]
    fig, ax = base_figure(data, "Razões Node/Go e Bun/Go",
                         "Mesmas 17 cargas · 1× indica mesma mediana · cores identificam o runtime JavaScript")
    all_ratios = [row[key] for row in rows for key in ("typescriptOverGo", "bunOverGo")]
    extent = max(1, math.ceil(max(abs(math.log2(value)) for value in all_ratios)))
    limit = 2 ** (extent + 0.18)
    ax.set_xscale("log", base=2)
    ax.set_xlim(1 / limit, limit)
    ax.axvline(1, color=TEXT_COLOR, linestyle="--", linewidth=1.2)
    for runtime, key, color, marker, offset, column in (
        ("typescript", "typescriptOverGo", TS_COLOR, "s", -0.15, 1.20),
        ("bun", "bunOverGo", BUN_COLOR, "^", 0.15, 1.55),
    ):
        for index, row in enumerate(rows):
            ratio = row[key]
            overlap = row["go"]["q1NsPerOp"] <= row[runtime]["q3NsPerOp"] and row[runtime]["q1NsPerOp"] <= row["go"]["q3NsPerOp"]
            shade = MUTED_COLOR if overlap else color
            ax.plot([1, ratio], [index+offset, index+offset], color=shade, linewidth=2.5)
            ax.plot(ratio, index+offset, marker, color=shade, markersize=6)
            decimals = 3 if ratio != 1 and round(ratio, 2) == 1 else 2
            ax.text(column, index, portuguese_number(ratio, decimals)+"×", transform=ax.get_yaxis_transform(), ha="right", va="center", fontsize=10, color=shade)
        ax.text(column, 1.044, "Node/Go" if runtime == "typescript" else "Bun/Go", transform=ax.transAxes, ha="right", fontsize=10.5, color=color, weight="bold")
    ax.xaxis.set_major_locator(FixedLocator([2**power for power in range(-extent, extent+1)]))
    ax.xaxis.set_major_formatter(FuncFormatter(lambda value, _: portuguese_number(value, 2 if value < 1 else 0)+"×"))
    ax.xaxis.set_minor_locator(NullLocator())
    ax.set_xlabel("Razão JavaScript/Go (escala logarítmica)", labelpad=15, fontsize=11)
    ax.text(.23, 1.044, "JavaScript com menor mediana", transform=ax.transAxes, ha="center", fontsize=10, color=MUTED_COLOR)
    ax.text(.79, 1.044, "Go com menor mediana", transform=ax.transAxes, ha="center", fontsize=10, color=GO_COLOR)
    fig.legend(handles=[Line2D([], [], marker="s", color=TS_COLOR, label="Node/Go"), Line2D([], [], marker="^", color=BUN_COLOR, label="Bun/Go")], loc="lower left", bbox_to_anchor=(.045,.887), frameon=False, ncol=2)
    fig.text(.045,.113,"0,5×: JavaScript usa metade do tempo de Go. 2×: Go usa metade do tempo de JavaScript.\nCinza: faixas Q1–Q3 sobrepostas; razões próximas de 1× devem ser lidas junto da dispersão.",fontsize=9.5,color=MUTED_COLOR,linespacing=1.6,va="top")
    fig.text(.96,.025,f"Fonte: {source.name}",fontsize=8.5,color=MUTED_COLOR,ha="right")
    return fig


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "go/benchmarks/comparison-final.json")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "go/benchmarks")
    parser.add_argument("--allow-development", action="store_true")
    args = parser.parse_args()
    data = read_comparison(args.input, args.allow_development)
    if data["mode"] != "final" and args.output_dir.resolve() == (ROOT / "go/benchmarks").resolve():
        parser.error("Development plots require an output directory outside go/benchmarks")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update({
        "font.family": "DejaVu Sans", "text.color": TEXT_COLOR, "axes.labelcolor": TEXT_COLOR,
        "ytick.color": TEXT_COLOR, "svg.hashsalt": "dicecore-benchmark-v1", "svg.fonttype": "none",
    })
    for name, builder in (("latency", latency_figure), ("speedup", speedup_figure)):
        fig = builder(data, args.input)
        fig.canvas.draw()
        fig.savefig(args.output_dir / f"{name}.png", dpi=180, facecolor="white")
        svg_path = args.output_dir / f"{name}.svg"
        fig.savefig(svg_path, facecolor="white", metadata={"Date": None})
        svg_path.write_text("\n".join(line.rstrip() for line in svg_path.read_text(encoding="utf-8").splitlines()) + "\n",
                            encoding="utf-8", newline="\n")
        plt.close(fig)
        print(f"Wrote {name}.png and {name}.svg from {args.input.name} ({data['mode']})")


if __name__ == "__main__":
    main()
