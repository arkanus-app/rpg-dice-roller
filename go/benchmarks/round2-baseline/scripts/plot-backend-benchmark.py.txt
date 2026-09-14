"""Plot recorded backend batches. Requires matplotlib==3.10.8; no remeasurement."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

ROOT = Path(__file__).resolve().parent.parent
SERIES = (("node", "Node · pool", "#B95B2A", "s"),
          ("bun", "Bun · pool", "#7951A8", "^"),
          ("go-pool", "Go · pool de engines", "#176B91", "o"),
          ("go-shared", "Go · engine compartilhada", "#31855B", "D"))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT/"go/benchmarks/backend-final.json")
    parser.add_argument("--output-dir", type=Path, default=ROOT/"go/benchmarks")
    parser.add_argument("--allow-development", action="store_true")
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8"))
    if data["status"] != "complete" or (data["mode"] != "final" and not args.allow_development):
        raise ValueError("Expected complete final measurements")
    if data["mode"] != "final" and args.output_dir.resolve() == (ROOT/"go/benchmarks").resolve():
        raise ValueError("Development plots require a separate output directory")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update({"font.family":"DejaVu Sans", "svg.fonttype":"none", "svg.hashsalt":"dicecore-backend-v1"})
    count = data["configuration"]["requests"]
    sample_count = data["configuration"]["samples"]
    workers = data["configuration"]["workers"]
    for metric, filename, title, ylabel in (
        ("opsPerSecond", "backend-throughput", "Throughput de lotes com seeds únicas", "Mil operações por segundo"),
        ("medianBatchMs", "backend-batches", "Tempo real para concluir cada lote", "Milissegundos por lote"),
        ("medianSnapshotRssMiB", "backend-rss", "Memória residente após os lotes", "Snapshot RSS do processo (MiB)"),
    ):
        fig, axes = plt.subplots(3,3,figsize=(17,12), facecolor="white")
        fig.subplots_adjust(left=.075,right=.97,bottom=.16,top=.855,hspace=.48,wspace=.30)
        for workload, ax in zip(data["workloads"], axes.flat):
            rows = sorted((row for row in data["summary"] if row["id"] == workload["id"]), key=lambda row: row["workers"])
            if [row["workers"] for row in rows] != workers:
                raise ValueError("Missing worker configuration")
            for runtime, label, color, marker in SERIES:
                active_rows = [row for row in rows if row[runtime][metric] is not None]
                if not active_rows:
                    continue
                points = [row["workers"] for row in active_rows]
                values = [row[runtime][metric]/(1000 if metric=="opsPerSecond" else 1) for row in active_rows]
                if metric=="opsPerSecond":
                    low = [count/row[runtime]["q3BatchMs"] for row in active_rows]
                    high = [count/row[runtime]["q1BatchMs"] for row in active_rows]
                elif metric=="medianBatchMs":
                    low = [row[runtime]["q1BatchMs"] for row in active_rows]
                    high = [row[runtime]["q3BatchMs"] for row in active_rows]
                else:
                    low = [row[runtime]["q1SnapshotRssMiB"] for row in active_rows]
                    high = [row[runtime]["q3SnapshotRssMiB"] for row in active_rows]
                ax.errorbar(points,values,yerr=[[v-l for v,l in zip(values,low)],[h-v for v,h in zip(values,high)]],color=color,marker=marker,label=label,linewidth=1.7,markersize=5,capsize=2.5)
            ax.set_title(workload["label"],fontsize=11,fontweight="bold",pad=10)
            ax.set_xticks(workers)
            ax.set_xlabel("Workers de aplicação (CPU sem restrição)",fontsize=9)
            ax.set_ylabel(ylabel,fontsize=9)
            ax.set_ylim(bottom=0)
            ax.yaxis.set_major_formatter(FuncFormatter(lambda value,_: f"{value:,.0f}".replace(",",".")))
            ax.grid(alpha=.18)
            for spine in ax.spines.values(): spine.set_visible(False)
            if not ax.lines:
                ax.text(.5,.5,"RSS indisponível nesta configuração",transform=ax.transAxes,ha="center",va="center")
                ax.set_axis_off()
        fig.suptitle(title,fontsize=22,fontweight="bold",x=.055,y=.973,ha="left",color="#243443")
        fig.text(.055,.930,f"{count:,} chamadas por lote · {sample_count} lotes por configuração · mediana e Q1–Q3 · sem HTTP".replace(",","."),fontsize=12,color="#586774")
        handles, labels = axes.flat[0].get_legend_handles_labels()
        fig.legend(handles,labels,ncol=4,loc="upper center",bbox_to_anchor=(.52,.910),frameon=False,fontsize=10)
        env=data["environment"]
        note = "RSS absoluto do processo contínuo, incluindo runtime, workers e harness; cargas anteriores podem influenciar snapshots posteriores.\nGC natural; faixas Q1–Q3 pós-lote. Não são pico de memória nem alocação por operação." if metric=="medianSnapshotRssMiB" else "Engines/workers aquecidos. Cronômetro inclui despacho e conclusão; não inclui startup nem serialização de cada resultado.\nFaixas descrevem variação entre lotes; não são percentis de latência de requisições."
        fig.text(.055,.09,note,fontsize=10,color="#586774",linespacing=1.5)
        fig.text(.055,.035,f"Node {env['node']} · Bun {env['bun']} · {env['go'].replace('go version ','')}\n{env['cpuModel'].strip()} · {env['osVersion']} · fonte: {args.input.name}",fontsize=9,color="#586774",linespacing=1.4)
        fig.savefig(args.output_dir/f"{filename}.png",dpi=180,facecolor="white")
        svg_path = args.output_dir/f"{filename}.svg"
        fig.savefig(svg_path,facecolor="white",metadata={"Date":None})
        svg_path.write_text("\n".join(line.rstrip() for line in svg_path.read_text(encoding="utf-8").splitlines())+"\n", encoding="utf-8", newline="\n")
        plt.close(fig)
        print(f"Wrote {filename}.png and .svg")

if __name__ == "__main__":
    main()
