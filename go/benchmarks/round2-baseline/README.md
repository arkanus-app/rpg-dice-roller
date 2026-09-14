# Baseline da segunda rodada

Estado preservado do commit `a1c4bbb0a525de5d9f9b5f383be26bf867d79e1d`, anterior às mudanças da segunda rodada. Os arquivos reproduzem os bytes versionados, verificados por SHA-256 no [manifesto](manifest.json).

- [17 cargas e resultados Go/Node/Bun](go/BENCHMARK.md)
- [Lotes concorrentes e RSS](go/BACKEND_BENCHMARK.md)
- [Experimento GOGC separado](go/GC_TUNING.md)
- [Registro da primeira otimização](go/OPTIMIZATION.md)

Os relatórios mantêm seus caminhos relativos para dados e gráficos. Referências ao código vivo e ao baseline original devem ser lidas a partir do commit indicado. Os harnesses históricos estão preservados como `.txt` para evitar execução acidental; o preflight backend mantém o gzip integral de 1,3 MB, sem duplicar o JSON de 47,5 MB descompactado. Novas medições não substituem este diretório.
