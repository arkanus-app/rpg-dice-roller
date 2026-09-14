"""Render the completed Node-only round-six measurements as PNG and SVG.

    python scripts/plot-node-round6.py

Reads both worker-count files without combining their samples. Never starts
benchmarks, builds, subprocesses or production code. Inspect exported figures
separately before recording visual verification.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.ticker import FuncFormatter, LogLocator, NullFormatter

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / "go/benchmarks/optimization-round6"
TEXT, MUTED, GRID = "#243443", "#596975", "#E1E7EC"
SERIES = [
    ("node", "Node · JSON.stringify", "#AC5A28", "o"),
    ("go-final-default", "Go final · GC100", "#176B91", "s"),
    ("go-final-tuned", "Go final · GC500 / 96MiB", "#9E4568", "D"),
]
WORKLOADS = [
    ("d20", "1d20+5"), ("100d6", "100d6"), ("pool", "20d6!2ro=1kh10"),
    ("1000d6", "1000d6"), ("reroll-selection", "100d6ro=1kh60"),
    ("multi-group", "2#{4d6,3d8+2}kh1"),
    ("unicode-comment", "20d6!2ro=1kh10 # ação 🎲"),
    ("fudge", "100dF.2"), ("fractional-bounds", "50d6min2.125max4.875kh25"),
    ("target-pool", "40d10>=7f=1"), ("drop-group", "{6d6,4d8}dl1"),
]
SPECS = {
    "throughput": {
        "title": "Vazão da rolagem completa + JSON",
        "axis": "Mil chamadas/s · maior é melhor · escala logarítmica",
        "note": "Ponto: chamadas / mediana do lote. Intervalo: Q1–Q3 dos tempos de lote convertidos em vazão.",
        "detail": "Seis lotes de 4.096 chamadas por série/carga; os intervalos não são confiança estatística nem p95 individual.",
    },
    "cpu-per-op": {
        "title": "CPU agregada por operação",
        "axis": "µs de CPU/op · menor é melhor · escala logarítmica",
        "note": "Ponto: soma dos deltas de CPU de usuário + sistema / soma das chamadas dos seis lotes.",
        "detail": "CPU do processo inteiro, incluindo runtime/GC. Windows pode quantizar deltas em ~15,6 ms; zero isolado não é trabalho gratuito.",
    },
    "latency-p95": {
        "title": "Latência individual da rolagem + JSON",
        "axis": "µs por chamada · menor é melhor · escala logarítmica",
        "note": "Ponto: p95 individual. Segmento: p50–p95 da mesma passagem, sem intervalo de confiança.",
        "detail": "4.096 amostras por série/carga em passagem separada, com dois timers/chamada; loops fechados, sem fila ou HTTP.",
    },
    "rss": {
        "title": "Memória residente observada",
        "axis": "RSS em MiB · menor é melhor · escala logarítmica",
        "note": "Ponto: mediana dos snapshots. Segmento: menor–maior snapshot disponível, após os lotes.",
        "detail": "Até seis snapshots por série/carga. Incluem runtime e retenção de cargas anteriores; não representam pico, teto ou memória isolada.",
    },
}


def number(value: float) -> str:
    decimals = 0 if value >= 100 else 1 if value >= 10 else 2
    return f"{value:,.{decimals}f}".replace(",", "_").replace(".", ",").replace("_", ".")


def source_record(source: Path) -> dict:
    content = source.read_bytes()
    try:
        name = source.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        name = source.as_posix()
    return {"path": name, "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}


def optional_number(value: object, field: str, zero: bool = False) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise ValueError(f"{field}: invalid number {value!r}")
    if value < 0 or (value == 0 and not zero):
        raise ValueError(f"{field}: expected {'nonnegative' if zero else 'positive'} number")
    return float(value)


def quantile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower, upper = math.floor(position), math.ceil(position)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def same(actual: float, expected: float, field: str) -> None:
    if not math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-8):
        raise ValueError(f"{field}: summary {actual} differs from raw data {expected}")


def read_comparison(source: Path, workers: int) -> dict:
    data = json.loads(source.read_text(encoding="utf-8-sig"))
    if data.get("schemaVersion") != 1 or data.get("status") != "complete":
        raise ValueError(f"{source}: wait for a complete round-six measurement")
    config = data["configuration"]
    expected = {"workers": workers, "gomaxprocs": 12, "requests": 4096,
                "latencyRequests": 2048, "samplesPerProcess": 3, "rounds": 2,
                "warmupPerWorker": 256, "operation": "build-and-encode", "engineMode": "pool"}
    for key, value in expected.items():
        if config.get(key) != value:
            raise ValueError(f"{source}: unexpected configuration.{key}")
    if [(row["id"], row["input"]) for row in data["workloads"]] != WORKLOADS:
        raise ValueError(f"{source}: expected the eleven declared workloads, in order")
    rows = {row["id"]: row for row in data["summary"]}
    if len(rows) != 11 or len(data["summary"]) != 11 or set(rows) != {key for key, _ in WORKLOADS}:
        raise ValueError(f"{source}: missing or duplicated workload summaries")
    configurations = {row["id"]: row for row in data["configurations"]}
    for identifier, gc, limit in (("go-final-default", 100, None), ("go-final-tuned", 500, "96MiB")):
        current = configurations[identifier]
        if current.get("gc") != gc or current.get("memoryLimit") != limit or current.get("encoder") != "dicecore.MarshalJSON":
            raise ValueError(f"{source}: unexpected {identifier} policy or encoder")
    if configurations["node"].get("encoder") != "JSON.stringify":
        raise ValueError(f"{source}: unexpected Node encoder")
    for workload, _ in WORKLOADS:
        if rows[workload].get("workers") != workers or rows[workload].get("mode") != "full":
            raise ValueError(f"{source}: unexpected result mode or workers")
        for identifier, *_ in SERIES:
            stats = rows[workload].get(identifier)
            if stats is None:
                continue  # A missing series is rendered n/d, never as zero.
            prefix = f"{source.name}/{workload}/{identifier}"
            batches = stats.get("batchSamplesNs", [])
            if len(batches) != 6 or stats.get("batchSamplesCount") != 6:
                raise ValueError(f"{prefix}: expected six throughput batches")
            batches = [optional_number(value, prefix) for value in batches]
            if any(value is None for value in batches):
                raise ValueError(f"{prefix}: incomplete raw batch times")
            for key, fraction in (("q1BatchMs", .25), ("medianBatchMs", .5), ("q3BatchMs", .75)):
                reported = optional_number(stats.get(key), key)
                if reported is not None:
                    same(reported, quantile(batches, fraction) / 1e6, prefix + "/" + key)
            throughput = optional_number(stats.get("opsPerSecond"), prefix)
            if throughput is not None:
                same(throughput, config["requests"] * 1e9 / quantile(batches, .5), prefix + "/throughput")
            cpu = [optional_number(value, prefix + "/cpu", zero=True) for value in stats.get("cpuSamplesNsPerOp", [])]
            if any(value is None for value in cpu):
                raise ValueError(f"{prefix}: null within available CPU samples")
            aggregate = optional_number(stats.get("aggregateCpuNsPerOp"), prefix + "/aggregateCpu")
            if aggregate is not None:
                if len(cpu) != 6 or stats.get("cpuSamplesCount") != 6 or stats.get("cpuMeasuredRequests") != config["requests"] * 6:
                    raise ValueError(f"{prefix}: aggregate CPU must include all six batches")
                same(aggregate, sum(cpu) / 6, prefix + "/aggregateCpu")
                same(stats["measuredCpuTotalNs"], sum(cpu) * config["requests"], prefix + "/cpuTotal")
            rss = [optional_number(value, prefix + "/rss") for value in stats.get("rssSamplesMiB", [])]
            if any(value is None for value in rss) or len(rss) > 6:
                raise ValueError(f"{prefix}: invalid RSS sample list")
            for key, expected_value in (("medianSnapshotRssMiB", quantile(rss, .5) if rss else None),
                                        ("maximumSnapshotRssMiB", max(rss) if rss else None)):
                reported = optional_number(stats.get(key), prefix + "/" + key)
                if reported is not None:
                    if expected_value is None:
                        raise ValueError(f"{prefix}: RSS summary without snapshots")
                    same(reported, expected_value, prefix + "/" + key)
            p95 = optional_number(stats.get("p95LatencyNs"), prefix + "/p95")
            p50 = optional_number(stats.get("p50LatencyNs"), prefix + "/p50")
            if p95 is not None or p50 is not None:
                if stats.get("latencySamplesCount") != 4096:
                    raise ValueError(f"{prefix}: expected 4096 individual latency samples")
                latency = [value for run in data["runs"] if run["configuration"] == identifier
                           for per_worker in run["output"]["latency"][workload]["samplesByWorkerNs"]
                           for value in per_worker]
                if len(latency) != 4096:
                    raise ValueError(f"{prefix}: individual latency summary lacks its raw samples")
                for reported, fraction in ((p50, .5), (p95, .95)):
                    if reported is not None:
                        same(reported, quantile(latency, fraction), prefix + "/latency")
    data["_rows"], data["_source"] = rows, source_record(source)
    return data


def metric(stats: dict | None, kind: str, requests: int) -> dict:
    result = {"value": None, "low": None, "high": None, "samples": None, "missingReason": None}
    if stats is None:
        result["missingReason"] = "Série ausente no resumo"
        return result
    if kind == "throughput":
        value = stats.get("opsPerSecond")
        result["value"] = value / 1000 if value is not None else None
        result["samples"] = stats.get("batchSamplesCount")
        if stats.get("q1BatchMs") and stats.get("q3BatchMs"):
            result["low"], result["high"] = requests / stats["q3BatchMs"], requests / stats["q1BatchMs"]
    elif kind == "cpu-per-op":
        value = stats.get("aggregateCpuNsPerOp")
        result["value"] = value / 1000 if value is not None else None
        result["samples"] = stats.get("cpuSamplesCount")
    elif kind == "latency-p95":
        value = stats.get("p95LatencyNs")
        result["value"] = value / 1000 if value is not None else None
        result["samples"] = stats.get("latencySamplesCount")
        if stats.get("p50LatencyNs") is not None and value is not None:
            result["low"], result["high"] = stats["p50LatencyNs"] / 1000, value / 1000
    else:
        result["value"] = stats.get("medianSnapshotRssMiB")
        samples = stats.get("rssSamplesMiB", [])
        result["samples"] = len(samples)
        if samples:
            result["low"], result["high"] = min(samples), max(samples)
    if result["value"] is None:
        result["low"], result["high"] = None, None
        result["missingReason"] = "Métrica indisponível; não substituída por zero nem por outra estatística"
    return result


def label(identifier: str, expression: str) -> str:
    if identifier == "unicode-comment":
        return "20d6!2ro=1kh10\ncomentário Unicode: ação + dado"
    if identifier == "fractional-bounds":
        return "50d6min2.125max4.875kh25"
    return expression


def save_figure(fig, stem: str, output_dir: Path) -> list[dict]:
    outputs = []
    fig.canvas.draw()
    for extension in ("png", "svg"):
        destination = output_dir / f"{stem}.{extension}"
        fig.savefig(destination, dpi=170, facecolor="white")
        outputs.append(source_record(destination))
        print(destination)
    plt.close(fig)
    return outputs


def render(datasets: list[dict], kind: str, output_dir: Path) -> dict:
    spec = SPECS[kind]
    points = []
    for data in datasets:
        for workload, expression in WORKLOADS:
            for identifier, *_ in SERIES:
                points.append({"workers": data["configuration"]["workers"], "workload": workload,
                               "input": expression, "configuration": identifier,
                               **metric(data["_rows"][workload].get(identifier), kind, data["configuration"]["requests"])})
    positives = [point[key] for point in points for key in ("value", "low", "high") if point[key] is not None]
    limits = (min(positives) / 1.7, max(positives) * 2.7) if positives else (1, 10)
    fig, axes = plt.subplots(1, 2, figsize=(20, 13), sharex=True, sharey=True)
    fig.subplots_adjust(left=0.22, right=0.965, top=0.79, bottom=0.235, wspace=0.13)
    fig.suptitle("Rodada 6 · " + spec["title"], x=.04, y=.973, ha="left", fontsize=23, fontweight="bold")
    fig.text(.04, .935, "11 cargas full · Node versus Go final · 1 e 6 workers em ensaios separados", fontsize=12)
    fig.text(.04, .905, "Go: dicecore.MarshalJSON, uma engine/worker, GOMAXPROCS=12. GC100 sem GOMEMLIMIT; GC500 com 96MiB.", fontsize=11)
    handles = [Line2D([0], [0], color=color, marker=marker, linestyle="none", markersize=8, label=name)
               for _, name, color, marker in SERIES]
    fig.legend(handles=handles, loc="upper left", bbox_to_anchor=(.035, .885), ncol=3, frameon=False, fontsize=11, handletextpad=.6)
    fig.text(.04, .832, "As duas colunas usam a mesma escala. Distâncias horizontais representam razões; pontos não partem de zero.", fontsize=10, color=MUTED)
    for ax, data in zip(axes, datasets):
        workers = data["configuration"]["workers"]
        ax.set_title(f"{workers} worker" + ("s" if workers != 1 else ""), fontsize=14, fontweight="bold", pad=14)
        ax.set_xscale("log")
        ax.set_xlim(*limits)
        ax.set_ylim(10.55, -.55)
        ax.set_yticks(range(11), [label(identifier, expression) for identifier, expression in WORKLOADS])
        ax.tick_params(axis="y", length=0, pad=12, labelsize=11)
        ax.xaxis.set_major_locator(LogLocator(base=10, subs=(1, 2, 5), numticks=9))
        ax.xaxis.set_minor_locator(LogLocator(base=10, subs=(3, 4, 6, 7, 8, 9), numticks=50))
        ax.xaxis.set_major_formatter(FuncFormatter(lambda value, _: number(value)))
        ax.xaxis.set_minor_formatter(NullFormatter())
        ax.grid(axis="x", which="major", color=GRID, linewidth=.75, zorder=0)
        ax.spines[["top", "right"]].set_visible(False)
        ax.spines["left"].set_color("#AAB5BE")
        ax.spines["bottom"].set_color("#AAB5BE")
        ax.set_xlabel(spec["axis"], fontsize=10, labelpad=10)
        for boundary in (2.5, 8.5):
            ax.axhline(boundary, color="#CCD4DC", linewidth=1)
        for index, (workload, _) in enumerate(WORKLOADS):
            for series_index, (identifier, _, color, marker) in enumerate(SERIES):
                point = next(point for point in points if point["workers"] == workers and point["workload"] == workload and point["configuration"] == identifier)
                y = index + (series_index - 1) * .245
                value, low, high = point["value"], point["low"], point["high"]
                if value is None:
                    ax.text(.985, y, "n/d", transform=ax.get_yaxis_transform(), ha="right", va="center", color=color, fontsize=9)
                    continue
                if low is not None and high is not None:
                    ax.plot([low, high], [y, y], color=color, linewidth=1.4, alpha=.65, zorder=2)
                    ax.plot([low, high], [y, y], color=color, marker="|", linestyle="none", markersize=5, zorder=2)
                ax.plot(value, y, marker=marker, color=color, markersize=6.5, linestyle="none", zorder=3)
                ax.annotate(number(value), (max(value, high or value), y), xytext=(7, 0),
                            textcoords="offset points", va="center", fontsize=9, color=color)
    fig.text(.04, .151, spec["note"], fontsize=11)
    fig.text(.04, .126, spec["detail"], fontsize=10, color=MUTED)
    fig.text(.04, .101, "Separadores: 3 cargas principais / 6 regressões da rodada 5 / 2 holdouts novos. Comentário de dado = emoji U+1F3B2.", fontsize=10, color=MUTED)
    fig.text(.04, .076, "n/d = indisponível, sem imputação. GOMEMLIMIT é flexível e não limita RSS rigidamente. Máquina compartilhada; sem garantia de capacidade HTTP.", fontsize=10, color=MUTED)
    fig.text(.04, .051, "Fonte: go/benchmarks/optimization-round6/node-round6-w1.json e node-round6-w6.json", fontsize=9, color=MUTED)
    fig.text(.04, .030, datasets[0]["environment"]["cpuModel"].strip() + " · " + datasets[0]["environment"]["node"] +
             " · Node sem conversão adicional de string para bytes UTF-8.", fontsize=9, color=MUTED)
    return {"metric": kind, "units": spec["axis"], "displayedValues": points,
            "missingValues": [point for point in points if point["value"] is None],
            "outputs": save_figure(fig, kind, output_dir)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--w1", type=Path, default=DIRECTORY / "node-round6-w1.json")
    parser.add_argument("--w6", type=Path, default=DIRECTORY / "node-round6-w6.json")
    parser.add_argument("--output-dir", type=Path, default=DIRECTORY / "charts")
    args = parser.parse_args()
    datasets = [read_comparison(args.w1, 1), read_comparison(args.w6, 6)]
    for field in ("cpuModel", "osVersion", "node", "go"):
        if datasets[0]["environment"].get(field) != datasets[1]["environment"].get(field):
            raise ValueError(f"Worker-count comparisons have different environments: {field}")
    if datasets[0]["source"]["sha256"] != datasets[1]["source"]["sha256"]:
        raise ValueError("Worker-count comparisons must describe the same frozen source manifest")
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "text.color": TEXT,
                         "axes.labelcolor": TEXT, "xtick.color": MUTED, "ytick.color": TEXT,
                         "svg.fonttype": "none", "axes.axisbelow": True})
    args.output_dir.mkdir(parents=True, exist_ok=True)
    charts = {kind: render(datasets, kind, args.output_dir) for kind in SPECS}
    manifest = {
        "schemaVersion": 1, "renderer": source_record(Path(__file__)), "matplotlib": matplotlib.__version__,
        "inputs": [data["_source"] for data in datasets], "workerCounts": [1, 6],
        "series": [identifier for identifier, *_ in SERIES], "excludedSeries": ["go-baseline-default", "go-baseline-tuned"],
        "sourceManifestSha256": datasets[0]["source"]["sha256"], "charts": charts,
        "verification": "Source arithmetic checked by renderer. Visual review of the four PNG/SVG exports remains required.",
    }
    destination = args.output_dir / "plot-node-round6-manifest.json"
    destination.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(destination)


if __name__ == "__main__":
    main()
