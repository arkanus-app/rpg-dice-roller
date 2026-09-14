"""Render round-five JSON evidence after all measurements have completed.

    python scripts/plot-go-round5.py

Creates main/holdout throughput, main RSS snapshots, and serialization-only
microbenchmark PNG/SVG figures plus plot-round5-manifest.json. This renderer
does not run Go, benchmarks, subprocesses or production code.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
from pathlib import Path
from statistics import median

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / "go/benchmarks/optimization-round5"
HELPER_PATH = ROOT / "scripts/plot-go-round4.py"
helper_spec = importlib.util.spec_from_file_location("dicecore_round4_plot_helpers", HELPER_PATH)
helpers = importlib.util.module_from_spec(helper_spec)
helper_spec.loader.exec_module(helpers)
number, finite, quantile = helpers.number, helpers.finite, helpers.quantile
source_record, read_go_benchmarks = helpers.source_record, helpers.read_go_benchmarks
clean_axis, save_figure = helpers.clean_axis, helpers.save_figure
TEXT, MUTED, BEFORE, AFTER = helpers.TEXT, helpers.MUTED, helpers.BEFORE, helpers.AFTER
CONFIGURATIONS = [
    ("node", "Node", "#B95B2A", True),
    ("bun", "Bun", "#7951A8", True),
    ("go-std-default", "Go std · GC100", AFTER, False),
    ("go-direct-default", "Go direto · GC100", AFTER, True),
    ("go-std-tuned", "Go std · GC500 / 96MiB", "#A64267", False),
    ("go-direct-tuned", "Go direto · GC500 / 96MiB", "#A64267", True),
]
MAIN = [("d20", "1d20+5"), ("100d6", "100d6"), ("pool", "20d6!2ro=1kh10")]
HOLDOUT = [
    ("1000d6", "1000d6"),
    ("reroll-selection", "100d6ro=1kh60"),
    ("multi-group", "2#{4d6,3d8+2}kh1"),
    ("unicode-comment", "20d6!2ro=1kh10 · comentário Unicode"),
    ("fudge", "100dF.2"),
    ("fractional-bounds", "50d6min2.125max4.875kh25"),
]


def read_comparison(source: Path, holdout: bool) -> dict:
    data = json.loads(source.read_text(encoding="utf-8-sig"))
    expected_mode = "holdout" if holdout else "main"
    if (data.get("schemaVersion"), data.get("status"), data.get("mode")) != (1, "complete", expected_mode):
        raise ValueError(f"Expected completed round-five {expected_mode} measurements")
    if data["baseline"]["reference"] != "cecb59b" or not data["baseline"]["commit"].startswith("cecb59b"):
        raise ValueError("Expected cecb59b as the original preflight control")
    if not data["preflight"]["passed"] or not data["preflight"]["goStdlibByteEquality"]:
        raise ValueError("Whole-byte Go preflight must pass")
    config = data["configuration"]
    expected = (6, 512 if holdout else 5000, 3, 2, 12, 64 if holdout else 1000)
    if tuple(config[key] for key in ("workers", "requests", "samplesPerProcess", "rounds", "gomaxprocs", "warmupPerWorker")) != expected:
        raise ValueError("Unexpected workers, batches, rounds, runtime parallelism or warmup")
    if config["operation"] != "build-and-encode" or config["engineMode"] != "pool":
        raise ValueError("Comparison must build full results with one engine per worker")
    identifiers = [identifier for identifier, *_ in CONFIGURATIONS]
    configs = {entry["id"]: entry for entry in data["configurations"]}
    if len(data["configurations"]) != 6 or set(configs) != set(identifiers):
        raise ValueError("Expected all six runtime/encoder series")
    if config["orders"] != [identifiers, list(reversed(identifiers))]:
        raise ValueError("Expected reversed execution orders")
    go_executables = set()
    for identifier in identifiers[2:]:
        item = configs[identifier]
        tuned, direct = identifier.endswith("tuned"), "direct" in identifier
        if (item["encoder"], item["gc"], item["memoryLimit"]) != ("direct" if direct else "std", 500 if tuned else 100, "96MiB" if tuned else None):
            raise ValueError(f"Incorrect encoder/GC label: {identifier}")
        go_executables.add(item["executable"])
    if len(go_executables) != 1:
        raise ValueError("All measured Go encoders must use the same executable")
    workloads = HOLDOUT if holdout else MAIN
    rows = {row["id"]: row for row in data["summary"]}
    if len(data["summary"]) != len(workloads) or set(rows) != {identifier for identifier, _ in workloads}:
        raise ValueError("Unexpected, missing or duplicated workloads")
    for workload, _ in workloads:
        for identifier in identifiers:
            stats = rows[workload][identifier]
            if stats["samplesCount"] != 6 or len(stats["samples"]) != 6:
                raise ValueError(f"Expected six batches: {workload}/{identifier}")
            values = [finite(value, identifier) for value in stats["samples"]]
            for field, fraction in (("q1BatchMs", 0.25), ("medianBatchMs", 0.5), ("q3BatchMs", 0.75)):
                if not math.isclose(finite(stats[field], field), quantile(values, fraction) / 1e6, rel_tol=1e-10):
                    raise ValueError(f"Quartile differs from raw durations: {workload}/{identifier}/{field}")
            if not math.isclose(finite(stats["opsPerSecond"], identifier), config["requests"] * 1000 / stats["medianBatchMs"], rel_tol=1e-10):
                raise ValueError(f"Throughput differs from median duration: {workload}/{identifier}")
            rss = [finite(value, "RSS") for value in stats["rssSamplesMiB"]]
            if len(rss) > 6:
                raise ValueError("More RSS readings than timed batches")
            if rss:
                if not math.isclose(finite(stats["medianSnapshotRssMiB"], "RSS median"), median(rss), rel_tol=1e-10) or not math.isclose(finite(stats["maximumSnapshotRssMiB"], "RSS maximum"), max(rss), rel_tol=1e-10):
                    raise ValueError("RSS summary differs from snapshot values")
            elif stats["medianSnapshotRssMiB"] is not None or stats["maximumSnapshotRssMiB"] is not None:
                raise ValueError("Unavailable RSS must remain null")
    return data


def comparison_canvas(title: str, holdout: bool, requests: int):
    if holdout:
        fig, axes = plt.subplots(3, 2, figsize=(20, 15))
        fig.subplots_adjust(left=0.19, right=0.955, top=0.815, bottom=0.16, wspace=0.32, hspace=0.63)
        axes = list(axes.flat)
    else:
        fig, axes = plt.subplots(3, 1, figsize=(14, 13))
        fig.subplots_adjust(left=0.275, right=0.935, top=0.81, bottom=0.16, hspace=0.60)
    fig.suptitle(title, x=0.045, y=0.973, ha="left", fontsize=22, fontweight="bold")
    fig.text(0.045, 0.936, f"6 workers · {number(requests, 0)} chamadas/lote · 6 lotes por configuração · duas ordens invertidas", fontsize=11)
    fig.text(0.045, 0.905, "Go std = encoding/json.Marshal · Go direto = dicecore.MarshalJSON · mesmo binário Go e mesma API de rolagem", fontsize=10)
    fig.text(0.045, 0.875, "Uma engine/worker · GOMAXPROCS=12 · GC100 sem limite; GC500 com GOMEMLIMIT=96MiB · escalas independentes", fontsize=10, color=MUTED)
    return fig, axes


def throughput_figure(data: dict, source: Path, holdout: bool, output_dir: Path) -> dict:
    title = "Rodada 5 · " + ("holdout: expressões adicionais + JSON" if holdout else "resultado completo + JSON")
    fig, axes = comparison_canvas(title, holdout, data["configuration"]["requests"])
    rows = {row["id"]: row for row in data["summary"]}
    plotted = []
    for index, (ax, (workload, label)) in enumerate(zip(axes, HOLDOUT if holdout else MAIN)):
        extent = 0.0
        for position, (identifier, _, color, filled) in enumerate(CONFIGURATIONS):
            stats = rows[workload][identifier]
            value = stats["opsPerSecond"] / 1000
            low, high = data["configuration"]["requests"] / stats["q3BatchMs"], data["configuration"]["requests"] / stats["q1BatchMs"]
            extent = max(extent, high)
            ax.barh(position, value, height=0.58, color=color if filled else "white", edgecolor=color, linewidth=1.4, zorder=3)
            ax.errorbar(value, position, xerr=[[max(0, value-low)], [max(0, high-value)]], color=TEXT, capsize=3, linewidth=1, zorder=4)
            ax.annotate(number(value, 2 if value < 10 else 1), (high, position), xytext=(6, 0), textcoords="offset points", va="center", fontsize=10, color=color)
            plotted.append({"workload": workload, "input": rows[workload]["input"], "configuration": identifier, "thousandsPerSecond": value, "lower": low, "upper": high})
        ax.set_title(label + " · full", loc="left", fontsize=13, fontweight="bold", pad=10)
        ax.set_yticks(range(6), [label for _, label, _, _ in CONFIGURATIONS] if not holdout or index % 2 == 0 else [])
        ax.invert_yaxis()
        ax.set_xlim(0, extent * (1.22 if holdout else 1.16))
        clean_axis(ax, "Mil chamadas/s · maior é melhor")
    fig.text(0.045, 0.116, "Barras: chamadas / mediana do lote. Intervalos: Q1–Q3 dos tempos convertidos em vazão; não são p95 individuais.", fontsize=10)
    fig.text(0.045, 0.089, "Cada chamada cria o resultado completo e bytes próprios. Go usa MarshalJSON, sem buffer fornecido pelo benchmark.", fontsize=10)
    fig.text(0.045, 0.062, "Sem HTTP/rede ou conversão UTF-8 adicional em JS. " + ("Holdout separado, com lotes menores; não agrega ao ensaio principal." if holdout else "Diferenças de JIT, GC e escalonamento afetam esta amostra local."), fontsize=10, color=MUTED)
    fig.text(0.045, 0.035, "Fonte: go/benchmarks/optimization-round5/" + source.name + " · " + data["environment"]["cpuModel"].strip(), fontsize=9, color=MUTED)
    stem = "json-round5-holdout-throughput" if holdout else "json-round5-throughput"
    return {"inputs": [source_record(source)], "displayedValues": plotted, "outputs": save_figure(fig, stem, output_dir)}


def rss_figure(data: dict, source: Path, output_dir: Path) -> dict:
    fig, axes = comparison_canvas("Rodada 5 · memória residente observada", False, data["configuration"]["requests"])
    rows = {row["id"]: row for row in data["summary"]}
    plotted = []
    for ax, (workload, label) in zip(axes, MAIN):
        extent = 1.0
        for position, (identifier, _, color, filled) in enumerate(CONFIGURATIONS):
            values = rows[workload][identifier]["rssSamplesMiB"]
            if values:
                center, maximum = median(values), max(values)
                extent = max(extent, maximum)
                ax.barh(position, center, height=0.58, color=color if filled else "white", edgecolor=color, linewidth=1.4, zorder=3)
                ax.scatter(values, [position - 0.10 + 0.04 * i for i in range(len(values))], s=12, color=TEXT, alpha=0.65, zorder=4)
                ax.scatter([maximum], [position], marker="D", s=25, color=TEXT, zorder=5)
                ax.annotate(number(center) + " / " + number(maximum), (maximum, position), xytext=(7, 0), textcoords="offset points", va="center", fontsize=10, color=color)
            else:
                center, maximum = None, None
                ax.text(0, position, "RSS indisponível", va="center", color=MUTED)
            plotted.append({"workload": workload, "configuration": identifier, "snapshotsMiB": values, "medianMiB": center, "maximumMiB": maximum})
        ax.set_title(label + " · full + JSON", loc="left", fontsize=13, fontweight="bold", pad=10)
        ax.set_yticks(range(6), [label for _, label, _, _ in CONFIGURATIONS])
        ax.invert_yaxis()
        ax.set_xlim(0, extent * 1.37)
        clean_axis(ax, "RSS em MiB · snapshots do processo inteiro")
    fig.text(0.045, 0.116, "Barra: mediana. Pontos: snapshots após lotes. Losango: maior snapshot. Rótulo: mediana / maior snapshot.", fontsize=10)
    fig.text(0.045, 0.089, "Inclui runtime, harness, workers e últimos resultados/JSON vivos. Cargas anteriores podem influenciar as seguintes.", fontsize=10)
    fig.text(0.045, 0.062, "Snapshots não representam pico, teto nem memória isolada por expressão. GOMEMLIMIT é flexível e não é um teto de RSS.", fontsize=10, color=MUTED)
    fig.text(0.045, 0.035, "Fonte: go/benchmarks/optimization-round5/" + source.name + " · " + data["environment"]["cpuModel"].strip(), fontsize=9, color=MUTED)
    return {"inputs": [source_record(source)], "displayedValues": plotted, "outputs": save_figure(fig, "json-round5-rss", output_dir)}


def micro_figure(before_path: Path, after_path: Path, metadata_path: Path, output_dir: Path) -> dict:
    before, after = read_go_benchmarks(before_path), read_go_benchmarks(after_path)
    metadata = json.loads(metadata_path.read_text(encoding="utf-8-sig"))
    if metadata["status"] != "complete" or metadata["encoders"] != {"before": "std", "after": "direct"} or metadata["rounds"] != 10 or metadata["mode"] != "std-direct-confirmation":
        raise ValueError("Expected completed ten-pair std/direct microbenchmark")
    if metadata["binaries"]["before"]["sha256"] != metadata["binaries"]["after"]["sha256"]:
        raise ValueError("Confirmed std/direct measurements must use the same Go binary")
    for variant in ("before", "after"):
        if metadata["variants"][variant] != metadata["binaries"][variant]["file"]:
            raise ValueError("Confirmed executable paths differ from the binary records")
    if metadata["order"] != [["before", "after"] if index % 2 == 0 else ["after", "before"] for index in range(10)]:
        raise ValueError("Microbenchmark pairs must alternate encoder order")
    if metadata["env"] != {"GOMAXPROCS": "1", "GOGC": "100", "GOMEMLIMIT": "off"} or before["environment"] != after["environment"]:
        raise ValueError("Unexpected or differing microbenchmark environment")
    for variant, data in (("before", before), ("after", after)):
        if data["source"]["sha256"] != metadata["outputs"][variant]["sha256"]:
            raise ValueError("Microbenchmark text differs from its recorded hash")
    rows = []
    for identifier, workload in MAIN:
        for mode in ("summary", "details", "full"):
            name = f"BenchmarkRollJSON/{identifier}/{mode}"
            left, right = before["benchmarks"].get(name, []), after["benchmarks"].get(name, [])
            if len(left) != 10 or len(right) != 10:
                raise ValueError(f"Expected ten microbenchmark samples per encoder: {name}")
            rows.append({"workload": workload, "mode": mode, "benchmark": name,
                         "std": {field: median(row[field] for row in left) for field in ("nsPerOp", "bytesPerOp", "allocsPerOp")},
                         "direct": {field: median(row[field] for row in right) for field in ("nsPerOp", "bytesPerOp", "allocsPerOp")}})
    fig, axes = plt.subplots(1, 3, figsize=(21, 12))
    fig.subplots_adjust(left=0.185, right=0.965, top=0.81, bottom=0.165, wspace=0.27)
    fig.suptitle("Rodada 5 · serialização isolada do mesmo resultado", x=0.04, y=0.972, ha="left", fontsize=23, fontweight="bold")
    fig.text(0.04, 0.935, "9 casos · 10 amostras por encoder · medianas por serialização · mesmo binário e função de benchmark", fontsize=11)
    fig.text(0.04, 0.902, "Resultado preparado fora do timer; bytes próprios a cada chamada. Não mede rolagem e não usa AppendJSON.", fontsize=10)
    fig.legend(handles=[Patch(facecolor="white", edgecolor=BEFORE, linewidth=1.5, label="encoding/json.Marshal"), Patch(facecolor=AFTER, edgecolor=AFTER, label="dicecore.MarshalJSON")], loc="upper left", bbox_to_anchor=(0.034, 0.883), ncol=2, frameon=False, fontsize=11)
    for ax, field, xlabel in zip(axes, ("nsPerOp", "bytesPerOp", "allocsPerOp"), ("ns/serialização · escala log · menor é melhor", "Bytes/serialização · menor é melhor", "Alocações/serialização · menor é melhor")):
        values = [row[variant][field] for row in rows for variant in ("std", "direct")]
        for index, row in enumerate(rows):
            if (index // 3) % 2 == 0:
                ax.axhspan(index - 0.5, index + 0.5, color="#F3F6F8", zorder=0)
            for variant, offset, color, filled in (("std", -0.18, BEFORE, False), ("direct", 0.18, AFTER, True)):
                value = row[variant][field]
                if field == "nsPerOp":
                    ax.scatter(value, index + offset, s=42, facecolors=color if filled else "white", edgecolors=color, linewidths=1.3, zorder=3)
                else:
                    ax.barh(index + offset, value, height=0.29, color=color if filled else "white", edgecolor=color, linewidth=1.15, zorder=3)
                ax.annotate(number(value, 1 if value % 1 else 0), (value, index + offset), xytext=(6, 0), textcoords="offset points", va="center", fontsize=9, color=color)
        ax.set_ylim(len(rows) - 0.5, -0.5)
        if field == "nsPerOp":
            ax.set_xscale("log")
            ax.set_xlim(min(values) * 0.55, max(values) * 3.2)
        else:
            ax.set_xlim(0, max(values) * 1.3 if max(values) else 1)
        ax.set_yticks(range(len(rows)), [f"{row['workload']} · {row['mode']}" for row in rows] if field == "nsPerOp" else [])
        clean_axis(ax, xlabel)
    fig.text(0.04, 0.115, "Tempo: pontos em escala logarítmica, sem barras partindo de zero. Memória e alocações: barras lineares com origem zero.", fontsize=10)
    fig.text(0.04, 0.087, "GOMAXPROCS=1 · GOGC=100 · GOMEMLIMIT=off. Medianas de benchmarks não são latências individuais nem prova de significância.", fontsize=10, color=MUTED)
    fig.text(0.04, 0.058, "Fontes: " + before_path.name + " / " + after_path.name + " · " + metadata_path.name, fontsize=10, color=MUTED)
    fig.text(0.04, 0.032, "Diretório: go/benchmarks/optimization-round5 · " + before["environment"]["cpu"], fontsize=9, color=MUTED)
    return {"inputs": [before["source"], after["source"], source_record(metadata_path)], "displayedValues": rows,
            "outputs": save_figure(fig, "json-round5-serialization", output_dir)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--main-input", type=Path, default=DIRECTORY / "json-round5.json")
    parser.add_argument("--holdout-input", type=Path, default=DIRECTORY / "json-round5-holdout.json")
    parser.add_argument("--before", type=Path, default=DIRECTORY / "final-encoder-before.txt")
    parser.add_argument("--after", type=Path, default=DIRECTORY / "final-encoder-after.txt")
    parser.add_argument("--micro-metadata", type=Path, default=DIRECTORY / "final-encoder.json")
    parser.add_argument("--output-dir", type=Path, default=DIRECTORY)
    args = parser.parse_args()
    for source in (args.main_input, args.holdout_input, args.before, args.after, args.micro_metadata):
        if not source.is_file():
            raise FileNotFoundError(f"Wait for complete measurements: {source}")
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "text.color": TEXT, "axes.labelcolor": TEXT, "svg.fonttype": "none", "axes.axisbelow": True})
    primary, holdout = read_comparison(args.main_input, False), read_comparison(args.holdout_input, True)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    charts = {"mainThroughput": throughput_figure(primary, args.main_input, False, args.output_dir),
              "holdoutThroughput": throughput_figure(holdout, args.holdout_input, True, args.output_dir),
              "mainRSS": rss_figure(primary, args.main_input, args.output_dir),
              "serialization": micro_figure(args.before, args.after, args.micro_metadata, args.output_dir)}
    manifest = {"schemaVersion": 1, "renderer": source_record(Path(__file__)), "helpers": source_record(HELPER_PATH),
                "matplotlib": matplotlib.__version__, "charts": charts,
                "verification": "Measurements, configurations, byte-equality preflight, quartiles, RSS summaries and microbenchmark hashes validated. Visual layout review is separate."}
    output = args.output_dir / "plot-round5-manifest.json"
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
