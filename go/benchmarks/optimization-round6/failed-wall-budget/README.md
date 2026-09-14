# Confirmação interrompida pelo orçamento de execução

O timer QPC funcionou, a paridade passou e nove dos dez processos terminaram,
mas o limite de 360 segundos interrompeu o último processo Node. O JSON
preserva status failed, ETIMEDOUT, os nove resultados e seus hashes. O script
original também foi preservado como `.mjs.txt`.

Nenhuma amostra desta tentativa entra nas conclusões. O orçamento da
confirmação foi ampliado para 540 segundos e ambas as ordens repetidas desde
o começo. Não foram alterados workloads, seeds, amostras, workers, configuração
de GC, código da biblioteca ou binários; somente o teto de tempo e seu texto
na documentação do orquestrador mudaram. O ajuste não é uma nova hipótese de
otimização nem uma continuação seletiva dos resultados incompletos.
