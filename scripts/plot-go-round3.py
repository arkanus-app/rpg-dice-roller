"""Render round-three measurements as standalone PNG/SVG figures (matplotlib 3.10.8).

Run after the JSON comparison and integrated Go confirmation are complete:
    python scripts/plot-go-round3.py
No benchmarks, subprocesses, or production files are executed by this renderer.
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
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
from matplotlib.ticker import FuncFormatter


ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / "go/benchmarks/optimization-round3"
TEXT = "#243443"
MUTED = "#586774"
BEFORE = "#73818E"
AFTER = "#176B91"
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


def relative(source: Path) -> str:
    try:
        return source.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return source.as_posix()


def source_record(source: Path) -> dict:
    content = source.read_bytes()
    return {"path": relative(source), "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}


def read_go_benchmarks(source: Path) -> dict:
    rows: dict[str, list[dict]] = {}
    environment: dict[str, str] = {}
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
        fields = metric_text.split()
        if len(fields) % 2:
            raise ValueError(f"Malformed benchmark metrics in {source}: {line}")
        metrics = {fields[index + 1]: float(fields[index]) for index in range(0, len(fields), 2)}
        if not {"ns/op", "B/op", "allocs/op"}.issubset(metrics):
            raise ValueError(f"Missing time/allocation metrics in {source}: {benchmark}")
        name = re.sub(r"-\d+$", "", benchmark)
        rows.setdefault(name, []).append({
            "benchmark": benchmark, "iterations": int(iterations),
            "nsPerOp": finite(metrics["ns/op"], benchmark),
            "bytesPerOp": finite(metrics["B/op"], benchmark, allow_zero=True),
            "allocsPerOp": finite(metrics["allocs/op"], benchmark, allow_zero=True),
        })
    if not rows or not {"goos", "goarch", "cpu"}.issubset(environment):
        raise ValueError(f"Missing Go benchmark data or environment: {source}")
    return {"source": source_record(source), "environment": environment, "benchmarks": rows}


def same_environment(before: dict, after: dict) -> None:
    if before["environment"] != after["environment"]:
        raise ValueError("Before/after benchmark environments must agree")


def samples(data: dict, benchmark: str, expected: int | None = None, minimum: int = 6) -> list[dict]:
    result = data["benchmarks"].get(benchmark, [])
    if len(result) < minimum or (expected is not None and len(result) != expected):
        raise ValueError(f"Unexpected sample count for {benchmark}: {len(result)}")
    return result


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


def json_figure(source: Path, output_dir: Path) -> dict:
    data = json.loads(source.read_text(encoding="utf-8-sig"))
    if data.get("schemaVersion") != 1 or data.get("status") != "complete":
        raise ValueError("Expected a complete round-three JSON comparison")
    config = data["configuration"]
    if (config["workers"], config["requests"], config["samplesPerProcess"], config["rounds"], config["gomaxprocs"]) != (6, 5000, 3, 2, 12):
        raise ValueError("JSON chart requires the declared six-worker, six-batch experiment")
    rows = {row["id"]: row for row in data["summary"]}
    if set(rows) != {identifier for identifier, _ in WORKLOADS}:
        raise ValueError("Expected exactly three JSON workloads")
    configs = {row["id"]: row for row in data["configurations"]}
    if set(configs) != {identifier for identifier, *_ in CONFIGURATIONS}:
        raise ValueError("Expected all six runtime/configuration series")
    for identifier in ("go-baseline-default", "go-final-default"):
        if (configs[identifier]["gc"], configs[identifier]["memoryLimit"]) != (100, None):
            raise ValueError("Default Go must use GOGC=100 with no GOMEMLIMIT")
    for identifier in ("go-baseline-tuned", "go-final-tuned"):
        if (configs[identifier]["gc"], configs[identifier]["memoryLimit"]) != (500, "96MiB"):
            raise ValueError("Configured Go must use GOGC=500 and GOMEMLIMIT=96MiB")
    fig, axes = plt.subplots(3, 1, figsize=(14, 13))
    fig.subplots_adjust(left=0.275, right=0.93, top=0.82, bottom=0.155, hspace=0.59)
    fig.suptitle("Rodada 3 · resultado completo + JSON", x=0.05, y=0.97, ha="left", fontsize=22, fontweight="bold")
    fig.text(0.05, 0.933, "6 workers · 5.000 chamadas/lote · 6 lotes por configuração · duas ordens invertidas", fontsize=11)
    fig.text(0.05, 0.902, "Go: uma engine/worker, GOMAXPROCS=12. GC100 sem limite; GC500 com GOMEMLIMIT=96MiB.", fontsize=10)
    fig.text(0.05, 0.874, "Anterior: ca34ff9 · atual: fontes finais da rodada 3 · escalas independentes por carga", fontsize=10, color=MUTED)
    plotted = []
    for ax, (workload, label) in zip(axes, WORKLOADS):
        extent = 0.0
        for position, (identifier, runtime_label, color, filled) in enumerate(CONFIGURATIONS):
            stats = rows[workload][identifier]
            if stats["samplesCount"] != 6 or len(stats["samples"]) != 6:
                raise ValueError(f"Expected six JSON samples: {workload}/{identifier}")
            q1, midpoint, q3 = [finite(stats[key], identifier) for key in ("q1BatchMs", "medianBatchMs", "q3BatchMs")]
            if not q1 <= midpoint <= q3:
                raise ValueError(f"Inconsistent JSON quartiles: {workload}/{identifier}")
            value = finite(stats["opsPerSecond"], identifier) / 1000
            if not math.isclose(value, config["requests"] / midpoint, rel_tol=1e-10):
                raise ValueError(f"Throughput does not match median batch time: {workload}/{identifier}")
            low, high = config["requests"] / q3, config["requests"] / q1
            extent = max(extent, high)
            ax.barh(position, value, height=0.59, color=color if filled else "white", edgecolor=color, linewidth=1.4, zorder=3)
            ax.errorbar(value, position, xerr=[[max(0, value - low)], [max(0, high - value)]], color=TEXT, capsize=3, linewidth=1, zorder=4)
            ax.annotate(number(value), (high, position), xytext=(7, 0), textcoords="offset points", va="center", fontsize=10, color=color)
            plotted.append({"workload": workload, "configuration": identifier, "thousandsPerSecond": value, "lower": low, "upper": high})
        ax.set_title(label + " · full", loc="left", fontsize=13, fontweight="bold", pad=10)
        ax.set_yticks(range(6), [label for _, label, _, _ in CONFIGURATIONS])
        ax.invert_yaxis()
        ax.set_xlim(0, extent * 1.15)
        clean_axis(ax, "Mil chamadas/s · maior é melhor")
    fig.text(0.05, 0.105, "Barras: chamadas / mediana do lote. Intervalos: Q1–Q3 dos tempos convertidos em vazão; não são p95 individuais.", fontsize=10)
    fig.text(0.05, 0.080, "Sem HTTP/rede. Node/Bun: JSON.stringify; Go: json.Marshal. Não inclui conversão adicional para UTF-8 no JavaScript.", fontsize=10)
    fig.text(0.05, 0.055, "Máquina de trabalho compartilhada: tempos variam com JIT, GC e escalonamento; nenhuma garantia de capacidade de servidor.", fontsize=10, color=MUTED)
    fig.text(0.05, 0.031, "Fonte: go/benchmarks/optimization-round3/json-round3.json · " + data["environment"]["cpuModel"].strip(), fontsize=9, color=MUTED)
    return {"inputs": [source_record(source)], "displayedValues": plotted, "outputs": save_figure(fig, "json-round3-throughput", output_dir)}


def allocation_figure(before_path: Path, after_path: Path, utf16_before_path: Path, utf16_after_path: Path, output_dir: Path) -> dict:
    before, after = read_go_benchmarks(before_path), read_go_benchmarks(after_path)
    utf16_before, utf16_after = read_go_benchmarks(utf16_before_path), read_go_benchmarks(utf16_after_path)
    same_environment(before, after)
    same_environment(utf16_before, utf16_after)
    rows, counts = [], set()
    for _, workload in WORKLOADS:
        for mode in MODES:
            name = f"BenchmarkBackendOperation/{workload}/{mode}/changing=true"
            left, right = samples(before, name), samples(after, name)
            if len(left) != len(right):
                raise ValueError(f"Unbalanced integrated sample counts: {name}")
            counts.add(len(left))
            rows.append({"workload": workload, "mode": mode, "benchmark": name, "before": {
                "allocs": median(value["allocsPerOp"] for value in left), "kib": median(value["bytesPerOp"] for value in left) / 1024,
            }, "after": {
                "allocs": median(value["allocsPerOp"] for value in right), "kib": median(value["bytesPerOp"] for value in right) / 1024,
            }})
    if len(counts) != 1:
        raise ValueError("Integrated workloads must have equal sample counts")
    utf16_rows = []
    for _, workload in WORKLOADS:
        name = f"BenchmarkBackendOperation/{workload}/full/changing=true"
        left, right = samples(utf16_before, name, expected=10), samples(utf16_after, name, expected=10)
        utf16_rows.append({"workload": workload, "before": median(value["allocsPerOp"] for value in left),
                           "after": median(value["allocsPerOp"] for value in right)})
    fig, axes = plt.subplots(1, 2, figsize=(16, 12), gridspec_kw={"width_ratios": [1, 1]})
    fig.subplots_adjust(left=0.23, right=0.94, top=0.81, bottom=0.17, wspace=0.24)
    fig.suptitle("Rodada 3 · alocações na API de rolagem", x=0.045, y=0.971, ha="left", fontsize=22, fontweight="bold")
    fig.text(0.045, 0.933, f"Antes/depois integrados · 9 cargas · {next(iter(counts))} amostras por lado · medianas por chamada · sem JSON", fontsize=11)
    fig.text(0.045, 0.902, "Seeds alternadas entre 128 opções; engine e compilação aquecidas. Memória alocada não é memória residente/RSS.", fontsize=10)
    fig.legend(handles=[Patch(facecolor="white", edgecolor=BEFORE, linewidth=1.5, label="Antes · ca34ff9"),
                        Patch(facecolor=AFTER, edgecolor=AFTER, label="Depois · integrado")],
               loc="upper left", bbox_to_anchor=(0.04, 0.886), ncol=2, frameon=False, fontsize=11)
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
    utf16_note = ";  ".join(f"{row['workload']}: {number(row['before'], 0)} → {number(row['after'], 0)}" for row in utf16_rows)
    fig.text(0.045, 0.123, "Etapa UTF-16 isolada, full (allocs/op): " + utf16_note + ".", fontsize=10)
    fig.text(0.045, 0.097, "A etapa isolada usa seu próprio antes/depois; suas diferenças não são somadas às da comparação integrada.", fontsize=10, color=MUTED)
    fig.text(0.045, 0.071, f"Fontes: {before_path.name} / {after_path.name}; etapa isolada: {utf16_before_path.name} / {utf16_after_path.name}.", fontsize=10, color=MUTED)
    fig.text(0.045, 0.045, "Diretório: go/benchmarks/optimization-round3 · " + before["environment"]["cpu"] + " · tempos da máquina compartilhada são ruidosos.", fontsize=9, color=MUTED)
    return {"inputs": [value["source"] for value in (before, after, utf16_before, utf16_after)],
            "displayedValues": rows, "utf16IsolatedAllocations": utf16_rows,
            "outputs": save_figure(fig, "native-round3-allocations", output_dir)}


def formatter_figure(before_path: Path, after_path: Path, output_dir: Path) -> dict:
    before, after = read_go_benchmarks(before_path), read_go_benchmarks(after_path)
    same_environment(before, after)
    cases = [("integer", "Inteiro · caminho otimizado"), ("fraction", "Fracionário · controle"), ("large", "Número grande · controle")]
    fig, axes = plt.subplots(3, 1, figsize=(14, 10))
    fig.subplots_adjust(left=0.17, right=0.93, top=0.82, bottom=0.19, hspace=0.81)
    fig.suptitle("Rodada 3 · formatação numérica isolada", x=0.05, y=0.968, ha="left", fontsize=22, fontweight="bold")
    fig.text(0.05, 0.924, "10 amostras antes + 10 depois em cada caso · todos os pontos mostrados · menor tempo é melhor", fontsize=11)
    fig.text(0.05, 0.888, "São chamadas do formatador; a diferença não representa o ganho da rolagem inteira nem da serialização completa.", fontsize=10)
    plotted = []
    for ax, (case, title) in zip(axes, cases):
        name = f"BenchmarkEventNumber/{case}"
        extent = 0.0
        for position, (variant, data, color, filled) in enumerate((("before", before, BEFORE, False), ("after", after, AFTER, True))):
            values = [row["nsPerOp"] for row in samples(data, name, expected=10)]
            center = median(values)
            extent = max(extent, max(values))
            # Fixed displacement reveals overlapping samples without implying time order.
            offsets = [-0.11 + index * 0.022 for index in range(len(values))]
            ax.scatter(values, [position + offset for offset in offsets], s=45, facecolors=color if filled else "white", edgecolors=color, linewidths=1.2, zorder=4)
            ax.vlines(center, position - 0.24, position + 0.24, color=TEXT, linewidth=2, zorder=5)
            ax.annotate("mediana " + number(center, 2) + " ns", (center, position - 0.24), xytext=(5, 5), textcoords="offset points", fontsize=10, color=TEXT, va="bottom")
            plotted.append({"case": case, "variant": variant, "samplesNsPerOp": values, "medianNsPerOp": center})
        ax.set_title(title, loc="left", fontsize=13, fontweight="bold", pad=12)
        ax.set_yticks([0, 1], ["Antes", "Depois"])
        ax.set_ylim(1.45, -0.65)
        ax.set_xlim(0, extent * 1.21)
        clean_axis(ax, "ns/chamada do formatador · escalas independentes por caso")
    fig.legend(handles=[Line2D([0], [0], marker="o", color="none", markerfacecolor="white", markeredgecolor=BEFORE, label="Uma amostra"),
                        Line2D([0], [0], marker="|", color="none", markeredgecolor=TEXT, markersize=14, markeredgewidth=2, label="Mediana")],
               loc="lower left", bbox_to_anchor=(0.044, 0.119), ncol=2, frameon=False)
    fig.text(0.05, 0.097, "As amostras não são latências individuais: cada benchmark agrega muitas chamadas. A dispersão não é intervalo de confiança.", fontsize=10)
    fig.text(0.05, 0.069, "Máquina de trabalho compartilhada: preserve os resultados dos controles e consulte benchstat antes de afirmar significância.", fontsize=10, color=MUTED)
    fig.text(0.05, 0.041, "Fontes: go/benchmarks/optimization-round3/v1-integer-before.txt e v1-integer-after.txt · " + before["environment"]["cpu"], fontsize=9, color=MUTED)
    return {"inputs": [before["source"], after["source"]], "displayedValues": plotted,
            "outputs": save_figure(fig, "formatter-round3-samples", output_dir)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json-input", type=Path, default=DIRECTORY / "json-round3.json")
    parser.add_argument("--before", type=Path, default=DIRECTORY / "integrated-before.txt")
    parser.add_argument("--after", type=Path, default=DIRECTORY / "integrated-after.txt")
    parser.add_argument("--integer-before", type=Path, default=DIRECTORY / "v1-integer-before.txt")
    parser.add_argument("--integer-after", type=Path, default=DIRECTORY / "v1-integer-after.txt")
    parser.add_argument("--utf16-before", type=Path, default=DIRECTORY / "v3-utf16-before.txt")
    parser.add_argument("--utf16-after", type=Path, default=DIRECTORY / "v3-utf16-after.txt")
    parser.add_argument("--output-dir", type=Path, default=DIRECTORY)
    args = parser.parse_args()
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "text.color": TEXT,
                         "axes.labelcolor": TEXT, "svg.fonttype": "none", "axes.axisbelow": True})
    for source in (args.json_input, args.before, args.after, args.integer_before, args.integer_after, args.utf16_before, args.utf16_after):
        if not source.is_file():
            raise FileNotFoundError(f"Wait for the completed measurement input: {source}")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    charts = {
        "json": json_figure(args.json_input, args.output_dir),
        "allocations": allocation_figure(args.before, args.after, args.utf16_before, args.utf16_after, args.output_dir),
        "formatter": formatter_figure(args.integer_before, args.integer_after, args.output_dir),
    }
    manifest = {"schemaVersion": 1, "renderer": source_record(Path(__file__)), "matplotlib": matplotlib.__version__,
                "charts": charts, "verification": "Numeric validation completed by renderer; inspect PNG/SVG for visual layout separately."}
    output = args.output_dir / "plot-round3-manifest.json"
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
