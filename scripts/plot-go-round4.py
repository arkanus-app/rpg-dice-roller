"""Render completed round-four evidence as three standalone PNG/SVG figures.

    python scripts/plot-go-round4.py

Uses matplotlib; never executes benchmarks, subprocesses or production code.
The renderer verifies measurements and writes plot-round4-manifest.json.
Inspect the PNG figures separately before recording their visual review.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
from statistics import median

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
from matplotlib.ticker import FuncFormatter

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / "go/benchmarks/optimization-round4"
BASELINE = "8432345"
TEXT, MUTED = "#243443", "#586774"
BEFORE, AFTER = "#73818E", "#176B91"
WORKLOADS = [("d20", "1d20+5"), ("100d6", "100d6"), ("pool", "20d6!2ro=1kh10")]
MODES = ("full", "details", "summary")
CONFIGURATIONS = [
    ("node", "Node", "#B95B2A", True),
    ("bun", "Bun", "#7951A8", True),
    ("go-baseline-default", "Go anterior · GC100", AFTER, False),
    ("go-final-default", "Go atual · GC100", AFTER, True),
    ("go-baseline-tuned", "Go anterior · GC500 / 96MiB", "#A64267", False),
    ("go-final-tuned", "Go atual · GC500 / 96MiB", "#A64267", True),
]


def number(value: float, decimals: int = 1) -> str:
    return f"{value:,.{decimals}f}".replace(",", "_").replace(".", ",").replace("_", ".")


def finite(value: object, field: str, allow_zero: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        raise ValueError(f"{field}: expected a finite number")
    if not math.isfinite(value) or value < 0 or (not allow_zero and value == 0):
        raise ValueError(f"{field}: invalid measurement {value}")
    return float(value)


def source_record(source: Path) -> dict:
    content = source.read_bytes()
    try:
        name = source.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        name = source.as_posix()
    return {"path": name, "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}


def read_go_benchmarks(source: Path) -> dict:
    rows, environment = {}, {}
    for line in source.read_text(encoding="utf-8-sig").splitlines():
        header = re.match(r"^(goos|goarch|pkg|cpu):\s*(.*)$", line)
        if header:
            key, value = header.groups()
            if key in environment and environment[key] != value:
                raise ValueError(f"Changing environment within {source}: {key}")
            environment[key] = value
            continue
        match = re.match(r"^(Benchmark\S+)\s+(\d+)\s+(.+)$", line)
        if not match:
            continue
        benchmark, iterations, metric_text = match.groups()
        if int(iterations) <= 0:
            raise ValueError(f"Non-positive iteration count: {benchmark}")
        fields = metric_text.split()
        if len(fields) % 2:
            raise ValueError(f"Malformed metrics in {source}: {line}")
        metrics = {fields[index + 1]: float(fields[index]) for index in range(0, len(fields), 2)}
        if not {"ns/op", "B/op", "allocs/op"}.issubset(metrics):
            raise ValueError(f"Missing time/allocation metrics: {benchmark}")
        rows.setdefault(re.sub(r"-\d+$", "", benchmark), []).append({
            "nsPerOp": finite(metrics["ns/op"], benchmark),
            "bytesPerOp": finite(metrics["B/op"], benchmark, allow_zero=True),
            "allocsPerOp": finite(metrics["allocs/op"], benchmark, allow_zero=True),
        })
    if not rows or not {"goos", "goarch", "cpu"}.issubset(environment):
        raise ValueError(f"Missing Go benchmark data/environment: {source}")
    return {"source": source_record(source), "environment": environment, "benchmarks": rows}


def quantile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def read_runtime_comparison(source: Path, native: bool) -> tuple[dict, list[tuple[str, str]]]:
    data = json.loads(source.read_text(encoding="utf-8-sig"))
    if data.get("schemaVersion") != 1 or data.get("status") != "complete":
        raise ValueError("Expected a complete round-four runtime comparison")
    if data["baseline"]["reference"] != BASELINE or not data["baseline"]["commit"].startswith(BASELINE):
        raise ValueError("Runtime comparison must use baseline 8432345")
    config = data["configuration"]
    if tuple(config[key] for key in ("workers", "requests", "samplesPerProcess", "rounds", "gomaxprocs")) != (6, 5000, 3, 2, 12):
        raise ValueError("Chart requires the declared six-worker, six-batch experiment")
    if config["operation"] != ("roll" if native else "build-and-encode") or config["engineMode"] != "pool":
        raise ValueError("Unexpected operation or engine ownership")
    workloads = [(f"{identifier}-{mode}", f"{label} · {mode}") for identifier, label in WORKLOADS for mode in MODES] if native else [(identifier, label + " · full") for identifier, label in WORKLOADS]
    rows = {row["id"]: row for row in data["summary"]}
    if len(data["summary"]) != len(workloads) or set(rows) != {identifier for identifier, _ in workloads}:
        raise ValueError("Unexpected or duplicated workloads")
    configs = {row["id"]: row for row in data["configurations"]}
    identifiers = [identifier for identifier, *_ in CONFIGURATIONS]
    if len(data["configurations"]) != 6 or set(configs) != set(identifiers):
        raise ValueError("Expected all six runtime/configuration series")
    if config["orders"] != [identifiers, list(reversed(identifiers))]:
        raise ValueError("Expected paired reversed execution orders")
    for identifier in ("go-baseline-default", "go-final-default"):
        if (configs[identifier]["gc"], configs[identifier]["memoryLimit"]) != (100, None):
            raise ValueError("Default Go must use GOGC=100 with no GOMEMLIMIT")
    for identifier in ("go-baseline-tuned", "go-final-tuned"):
        if (configs[identifier]["gc"], configs[identifier]["memoryLimit"]) != (500, "96MiB"):
            raise ValueError("Configured Go must use GOGC=500 and GOMEMLIMIT=96MiB")
    for workload, _ in workloads:
        for identifier in identifiers:
            stats = rows[workload][identifier]
            if stats["samplesCount"] != 6 or len(stats["samples"]) != 6:
                raise ValueError(f"Expected six samples: {workload}/{identifier}")
            values = [finite(value, identifier) for value in stats["samples"]]
            for key, fraction in (("q1BatchMs", 0.25), ("medianBatchMs", 0.5), ("q3BatchMs", 0.75)):
                reported = finite(stats[key], key)
                if not math.isclose(reported, quantile(values, fraction) / 1e6, rel_tol=1e-10):
                    raise ValueError(f"Summary quartile differs from raw samples: {workload}/{identifier}/{key}")
            if not math.isclose(finite(stats["opsPerSecond"], identifier), config["requests"] * 1000 / stats["medianBatchMs"], rel_tol=1e-10):
                raise ValueError(f"Throughput differs from median batch time: {workload}/{identifier}")
    return data, workloads


def clean_axis(ax, xlabel: str) -> None:
    ax.set_xlabel(xlabel, fontsize=10)
    ax.xaxis.set_major_formatter(FuncFormatter(lambda value, _: f"{value:g}".replace(".", ",")))
    ax.grid(axis="x", color="#E3E8ED", linewidth=0.7, zorder=0)
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.spines["bottom"].set_color("#AAB5BE")
    ax.tick_params(axis="y", length=0, pad=9)


def save_figure(fig, stem: str, output_dir: Path) -> list[dict]:
    outputs = []
    fig.canvas.draw()
    for extension in ("png", "svg"):
        output = output_dir / f"{stem}.{extension}"
        fig.savefig(output, dpi=165, facecolor="white")
        if extension == "svg":
            output.write_text("\n".join(line.rstrip() for line in output.read_text(encoding="utf-8").splitlines()) + "\n", encoding="utf-8")
        outputs.append(source_record(output))
        print(output)
    plt.close(fig)
    return outputs


def runtime_figure(source: Path, native: bool, output_dir: Path) -> dict:
    data, workloads = read_runtime_comparison(source, native)
    rows = {row["id"]: row for row in data["summary"]}
    if native:
        fig, axes = plt.subplots(3, 3, figsize=(20, 14))
        fig.subplots_adjust(left=0.175, right=0.965, top=0.805, bottom=0.155, wspace=0.35, hspace=0.59)
        axes = list(axes.flat)
    else:
        fig, axes = plt.subplots(3, 1, figsize=(14, 13))
        fig.subplots_adjust(left=0.275, right=0.93, top=0.82, bottom=0.155, hspace=0.59)
    subject = "API de rolagem · sem JSON" if native else "resultado completo + JSON"
    fig.suptitle("Rodada 4 · " + subject, x=0.045, y=0.972, ha="left", fontsize=23, fontweight="bold")
    fig.text(0.045, 0.935, "6 workers · 5.000 chamadas/lote · 6 lotes por configuração · duas ordens invertidas", fontsize=11)
    fig.text(0.045, 0.904, "Go: uma engine/worker, GOMAXPROCS=12. GC100 sem limite; GC500 com GOMEMLIMIT=96MiB.", fontsize=10)
    fig.text(0.045, 0.874, "Anterior: 8432345 · atual: fontes finais da rodada 4 · escalas independentes por carga", fontsize=10, color=MUTED)
    plotted = []
    for index, (ax, (workload, label)) in enumerate(zip(axes, workloads)):
        extent = 0.0
        for position, (identifier, _, color, filled) in enumerate(CONFIGURATIONS):
            stats = rows[workload][identifier]
            value = stats["opsPerSecond"] / 1000
            low, high = data["configuration"]["requests"] / stats["q3BatchMs"], data["configuration"]["requests"] / stats["q1BatchMs"]
            extent = max(extent, high)
            ax.barh(position, value, height=0.59, color=color if filled else "white", edgecolor=color, linewidth=1.4, zorder=3)
            ax.errorbar(value, position, xerr=[[max(0, value - low)], [max(0, high - value)]], color=TEXT, capsize=3, linewidth=1, zorder=4)
            ax.annotate(number(value), (high, position), xytext=(6, 0), textcoords="offset points", va="center", fontsize=9 if native else 10, color=color)
            plotted.append({"workload": workload, "configuration": identifier, "thousandsPerSecond": value, "lower": low, "upper": high})
        ax.set_title(label, loc="left", fontsize=12 if native else 13, fontweight="bold", pad=10)
        ax.set_yticks(range(6), [label for _, label, _, _ in CONFIGURATIONS] if not native or index % 3 == 0 else [])
        ax.invert_yaxis()
        ax.set_xlim(0, extent * (1.28 if native else 1.16))
        clean_axis(ax, "Mil chamadas/s · maior é melhor")
    fig.text(0.045, 0.105, "Barras: chamadas / mediana do lote. Intervalos: Q1–Q3 dos tempos convertidos em vazão; não são p95 individuais.", fontsize=10)
    fig.text(0.045, 0.080, "Sem HTTP/rede. " + ("Mesmas projeções full/details/summary em Go, Node e Bun; resultados completos construídos conforme cada API." if native else "Node/Bun: JSON.stringify; Go: json.Marshal. Não inclui conversão adicional para UTF-8 no JavaScript."), fontsize=10)
    fig.text(0.045, 0.055, "Máquina compartilhada: JIT, GC e escalonamento afetam os tempos; nenhuma garantia de capacidade de servidor.", fontsize=10, color=MUTED)
    fig.text(0.045, 0.031, "Fonte: go/benchmarks/optimization-round4/" + source.name + " · " + data["environment"]["cpuModel"].strip(), fontsize=9, color=MUTED)
    stem = "backend-round4-throughput" if native else "json-round4-throughput"
    return {"inputs": [source_record(source)], "displayedValues": plotted, "outputs": save_figure(fig, stem, output_dir)}


def allocation_figure(before_path: Path, after_path: Path, output_dir: Path) -> dict:
    before, after = read_go_benchmarks(before_path), read_go_benchmarks(after_path)
    if before["environment"] != after["environment"]:
        raise ValueError("Before/after benchmark environments must agree")
    rows = []
    for _, workload in WORKLOADS:
        for mode in MODES:
            name = f"BenchmarkBackendOperation/{workload}/{mode}/changing=true"
            left, right = before["benchmarks"].get(name, []), after["benchmarks"].get(name, [])
            if len(left) != 10 or len(right) != 10:
                raise ValueError(f"Expected ten integrated samples per side: {name}")
            rows.append({"workload": workload, "mode": mode, "benchmark": name, "before": {
                "allocs": median(value["allocsPerOp"] for value in left), "kib": median(value["bytesPerOp"] for value in left) / 1024,
            }, "after": {
                "allocs": median(value["allocsPerOp"] for value in right), "kib": median(value["bytesPerOp"] for value in right) / 1024,
            }})
    fig, axes = plt.subplots(1, 2, figsize=(16, 12))
    fig.subplots_adjust(left=0.23, right=0.94, top=0.81, bottom=0.16, wspace=0.24)
    fig.suptitle("Rodada 4 · memória alocada na API de rolagem", x=0.045, y=0.971, ha="left", fontsize=22, fontweight="bold")
    fig.text(0.045, 0.933, "Antes/depois integrados · 9 cargas · 10 amostras por lado · medianas por chamada · sem JSON", fontsize=11)
    fig.text(0.045, 0.902, "Seeds alternadas entre 128 opções; engine e compilação aquecidas. Memória alocada não é memória residente/RSS.", fontsize=10)
    fig.legend(handles=[Patch(facecolor="white", edgecolor=BEFORE, linewidth=1.5, label="Antes · 8432345"), Patch(facecolor=AFTER, edgecolor=AFTER, label="Depois · integrado")], loc="upper left", bbox_to_anchor=(0.04, 0.886), ncol=2, frameon=False, fontsize=11)
    for ax, field, xlabel in zip(axes, ("kib", "allocs"), ("KiB alocados/chamada · menor é melhor", "Alocações/chamada · menor é melhor")):
        extent = max(row[variant][field] for row in rows for variant in ("before", "after"))
        for index, row in enumerate(rows):
            if (index // 3) % 2 == 0:
                ax.axhspan(index - 0.5, index + 0.5, color="#F3F6F8", zorder=0)
            for variant, offset, color, filled in (("before", -0.18, BEFORE, False), ("after", 0.18, AFTER, True)):
                value = row[variant][field]
                ax.barh(index + offset, value, height=0.29, color=color if filled else "white", edgecolor=color, linewidth=1.15, zorder=3)
                label = number(value, 2) if field == "kib" else number(value, 1 if value % 1 else 0)
                ax.annotate(label, (value, index + offset), xytext=(5, 0), textcoords="offset points", va="center", fontsize=10, color=color)
        ax.set_ylim(len(rows) - 0.5, -0.5)
        ax.set_xlim(0, extent * 1.18 if extent else 1)
        ax.set_yticks(range(len(rows)), [f"{row['workload']} · {row['mode']}" for row in rows] if field == "kib" else [])
        clean_axis(ax, xlabel)
    fig.text(0.045, 0.113, "GOMAXPROCS=1 · GOGC=100 · sem GOMEMLIMIT. As duas métricas são independentes: menos bytes pode manter o número de alocações.", fontsize=10)
    fig.text(0.045, 0.080, "Fontes: " + before_path.name + " / " + after_path.name + ". Ganhos de variantes isoladas não são somados.", fontsize=10, color=MUTED)
    fig.text(0.045, 0.047, "Diretório: go/benchmarks/optimization-round4 · " + before["environment"]["cpu"] + " · medianas das medições locais.", fontsize=9, color=MUTED)
    return {"inputs": [before["source"], after["source"]], "displayedValues": rows, "outputs": save_figure(fig, "native-round4-allocations", output_dir)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json-input", type=Path, default=DIRECTORY / "json-round4.json")
    parser.add_argument("--backend-input", type=Path, default=DIRECTORY / "backend-round4.json")
    parser.add_argument("--before", type=Path, default=DIRECTORY / "integrated-before.txt")
    parser.add_argument("--after", type=Path, default=DIRECTORY / "integrated-after.txt")
    parser.add_argument("--output-dir", type=Path, default=DIRECTORY)
    args = parser.parse_args()
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "text.color": TEXT, "axes.labelcolor": TEXT, "svg.fonttype": "none", "axes.axisbelow": True})
    for source in (args.json_input, args.backend_input, args.before, args.after):
        if not source.is_file():
            raise FileNotFoundError(f"Wait for the completed measurement input: {source}")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    charts = {"allocations": allocation_figure(args.before, args.after, args.output_dir),
              "backend": runtime_figure(args.backend_input, True, args.output_dir),
              "json": runtime_figure(args.json_input, False, args.output_dir)}
    manifest = {"schemaVersion": 1, "baselineReference": BASELINE, "renderer": source_record(Path(__file__)), "matplotlib": matplotlib.__version__,
                "charts": charts, "verification": "Measurement checks passed; inspect all three PNG figures separately for visual layout."}
    output = args.output_dir / "plot-round4-manifest.json"
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
