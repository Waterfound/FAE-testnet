# FAE – Wallet Transaction UX

Status: **PLANNING_RUN_VERIFIED**. Data: 23/09/2026.

Frente de implementação do **Element 5 — Complete User Journey**: Transaction ID Visibility & Copyability e Transaction History Discoverability.

## Resultado desta etapa

Foi executada uma run real **local de planejamento** do Build Colony: `bc2-ebd32ede17ccb49b`. O CLI validou o perfil, produziu as ondas, compilou e verificou o manifesto; o AGDWS admitiu o primeiro pacote com uma evidência imutável de capability gap; o ledger foi reproduzido e o frontier consultado. A compilação pela API reproduziu exatamente a saída do CLI.

- FAE inspecionado: `0341ed060be0f030d5cb677953cef141ae7eb415`.
- Build Colony executado: `17979869a85c9f5adf2cef2ceb589a07fcef6239`.
- 47 arquivos do motor/testes materializados e conferidos contra os blobs Git dessa revisão.
- Manifesto e ledger aceitos; 7 pacotes, 6 ondas, 1 evento `ISSUE` para `WTX-01-contract`.
- 19 testes existentes de AGDWS/EBCG passaram; o teste existente `tests/client-smoke.mjs` passou.
- `index.html`, `core.js` e `wallet.js` publicados em `https://fairyelf-fae-testnet.vercel.app` retornaram HTTP 200 e bytes iguais ao baseline.
- Nenhum worker de implementação foi despachado; nenhum resultado de produto foi submetido, verificado ou integrado. Não houve execução multiagente, backend alterado ou deployment nesta etapa.

O resultado comprova planejamento executável e o estado observado. Não equivale à conclusão das duas tasks. A inspeção do endpoint foi feita no source congelado; não há alegação de equivalência entre esse source e o backend em execução.

## Lacunas verificadas

| Superfície | Estado atual | Trabalho necessário |
|---|---|---|
| Retorno de envio | `sendFAE()` mostra apenas os primeiros 20 caracteres do TXID aceito | Recibo com identificador completo, cópia e acesso aos detalhes |
| Lista do histórico | `renderWalletHistory()` abrevia em 18+8 caracteres; linha não abre detalhes | Detalhes acessíveis e cópia do TXID associado àquela linha |
| Descoberta | Histórico recolhido abaixo da lista de endereços | Ação principal junto à carteira ativa e navegação previsível |
| Estados | Qualquer status diferente de `confirmed` aparece como `Pending` | Tratar estados conhecidos e dados desconhecidos/inconsistentes explicitamente |
| Consulta inválida | `transactions` ausente ou inválido vira lista vazia | Erro de dados separado de resultado vazio |
| Falha da rede | Há erro para a consulta de histórico, mas falha de `/status` encerra o refresh antes dessa etapa | Histórico entra em indisponibilidade ou fica marcado como desatualizado |
| Pós-envio | Falha no refresh pode substituir o recibo de envio aceito por um erro no mesmo campo | Preservar aceitação e separar falha de atualização |
| Datas | `created_at` é ISO/timestamptz; o helper atual faz conversão numérica | Interpretar ISO e timestamps numéricos válidos, sem inventar data |
| Troca de endereço | Existe comparação do endereço solicitado com o atual | Reforçar geração da consulta, inclusive A→B→A e refresh em andamento |

Evidência detalhada: [baseline.json](wallet-transaction-ux/baseline.json). As referências são funções do source fixado, não suposições a partir do Explorer.

## Cobertura real e decisão de escopo

O `history()` da API Supabase lê as **100 transações mais recentes da rede**, filtra pelo endereço e retorna **até 30**. Não há paginação nem metadados de completude. São transferências; recompensas de mineração não pertencem a essa consulta. O endpoint `/transactions` do Independent Node também limita a 30, mas filtra o conjunto de transações do endereço antes do corte. Essas fontes não têm cobertura intercambiável.

O escopo mínimo completo desta frente será **histórico recente do endereço ativo**, com a limitação comunicada. Não será apresentado como extrato integral da carteira. A interface deverá explicar que transações antigas e recompensas de mineração podem não aparecer, e um resultado vazio deverá dizer que não foram encontradas transferências na consulta disponível.

Recarregar a página deve consultar novamente a rede. Recuperar a carteira reconstitui endereços/chaves e consulta o endereço ativo; não restaura um arquivo de transações embutido na seed. A carteira atual deriva cinco endereços, enquanto backups antigos podem conter apenas um. Não será prometida agregação automática de todos os endereços.

Decisão inicial: reaproveitar o endpoint existente e sua limitação explícita. Um histórico integral/paginado é uma ampliação separada, não um pré-requisito oculto. Se a validação demonstrar que o contrato mínimo não funciona, reabrir apenas a integração necessária e registrar o impacto antes de qualquer mudança de backend. Nenhuma alteração de consenso está prevista.

## Experiência proposta

1. **Entrada principal:** botão `Transaction history` nas ações da carteira ativa. Abre a seção existente, leva o foco ao título e permite voltar. A seção permanece identificável sem depender de hover.
2. **Após envio aceito:** recibo com `TX ID`, valor completo selecionável, `Copy TX ID`, feedback acessível e acesso aos detalhes. A mensagem informa envio aceito/aguardando bloco. Falha posterior de consulta não transforma a aceitação em falha de envio.
3. **Histórico:** cada linha permite abrir detalhes. O TXID pode ser abreviado na lista, mas o detalhe mostra os 64 caracteres e copia o valor original exato.
4. **Detalhes:** direção relativa ao endereço ativo, origem, saídas/valores, estado, altura e data somente quando disponíveis. Distinguir autoenvio/troco; não somar troco como valor transferido a terceiro. Não estimar taxa sem entradas/valores suficientes.
5. **Cópia:** partir do toque/clique do usuário, aguardar sucesso real, anunciar falha e manter seleção manual. Reutilizar o helper existente quando adequado, preservando as funções de cópia de endereço e backup.
6. **Estados:** carregando, resultado recente disponível, vazio dentro da cobertura, indisponível, dados inválidos, resultado anterior desatualizado. Retry não deve duplicar envio. Ausência em uma janela limitada não significa rejeição ou remoção da transação.
7. **Persistência mínima:** se o recibo aceito for mantido após reload, armazenar apenas metadados públicos com versão, limite e vínculo à rede/endereço. Esse cache não confere confirmação e não faz parte da recuperação por seed. A implementação do contrato decidirá se ele é necessário para evitar perder o TXID após refresh indisponível; não haverá banco/indexador novo.

Usar os rótulos no idioma já adotado pelo produto. O TXID completo deve caber em telas estreitas por quebra de linha ou campo selecionável, sem obrigar rolagem horizontal da página. Controles terão alvo de toque adequado, nome acessível, ordem de foco e feedback por `aria-live`.

O Explorer continua uma aplicação separada e read-only. Seu estado canônico é `PUBLIC_PREBIND / UNBOUND`, com `LIVE = NOT_LIVE`. Link externo é complementar e só será ativado quando URL, rede e rota de TXID estiverem comprovadas. A ausência desse link não bloqueia a conclusão da carteira.

## Pacotes e ordem efetivamente produzida pelo Build Colony

| Onda | Pacote | Entrega e condição de avanço |
|---|---|---|
| 1 | **WTX-01 — Contrato e estados** | Modelo de leitura, validação do TXID, cobertura, estados e lifecycle do recibo; congelar fixtures esperadas |
| 2 | **WTX-02 — Fixtures de aceitação** | Casos independentes de confirmação, cópia, erros, endereços, reload e recovery |
| 2 | **WTX-03 — TXID e detalhes** | Recibo, detalhe, seleção manual, cópia integral e feedback; nenhuma falsa confirmação |
| 3 | **WTX-04 — Histórico e lifecycle** | Acesso principal, estados de consulta, escopo/cobertura, retry e proteção contra respostas antigas |
| 4 | **WTX-05 — Validação da jornada** | Checks determinísticos e browser real; desktop, tablet e celular; limitações físicas separadas |
| 5 | **WTX-06 — Integração** | Conciliar com main atual, revisão, merge serial e verificação combinada na revisão resultante |
| 6 | **WTX-07 — Publicação e encerramento** | Release frontend autorizada, bytes publicados verificados, smoke público de leitura e registro das duas tasks |

WTX-02 e WTX-03 têm escrita independente. WTX-03 e WTX-04 editam `core.js`, `wallet.js` e `index.html`; o recurso exclusivo `active-wallet-ui` força serialização. Não existe necessidade de acrescentar vários agentes para esta frente pequena.

O próximo frontier admitido é **WTX-01-contract**. Os demais aguardam dependências; não há pacote integrado ou autorizado a declarar release concluída. A unidade de progresso é `verified_user_acceptance_criteria_out_of_7`; seu delta nesta run de planejamento é zero, pois os critérios de produto ainda não foram validados.

## Matriz de conclusão

| Critério do usuário | Evidência exigida | Pacotes |
|---|---|---|
| Encontra histórico na tela principal | Jornada da carteira ativa até a lista com foco/navegação corretos | WTX-04/05 |
| Abre transação e vê TXID completo | Linha → detalhe; identificador integral comparado ao retorno/fixture | WTX-03/05 |
| Cópia exata | Clipboard igual ao TXID de cada item; sem reticências, espaços ou ID da linha anterior | WTX-02/03/05 |
| Funciona com toque e mouse | Browser desktop e contextos de toque em viewports de tablet/celular; teclado e foco | WTX-05 |
| Estados fiéis aos dados | Submit aceito, pending, confirmed, desconhecido, payload inválido, falha e estado antigo | WTX-01/02/05 |
| Reload e recovery verificados | Nova sessão com armazenamento; recuperação limpa de fixture; mesmo endereço, cobertura e ausência de cache explicitados | WTX-04/05 |
| Entrega rastreável | Evidências ligadas às revisões de implementação, merge, verificação combinada e arquivos publicados | WTX-06/07 |

Também cobrir: clipboard negado/indisponível, múltiplos TXIDs, cópias consecutivas, envio aceito seguido de rede offline, `/status` falhando, resposta fora de ordem, troca rápida A→B→A, histórico antigo fora da janela, transações para endereços diferentes da mesma carteira, watch-only, ISO dates e cache ausente/corrompido caso haja cache.

Os testes de envio e recuperação usarão fixtures locais ou uma rede isolada com chaves descartáveis. Nunca solicitar seed real do usuário. No site público, esta frente utilizará somente consultas e navegação/cópia para smoke. Emulação de toque/WebKit não será descrita como teste realizado em iPad/iPhone físico; um teste físico curto só será solicitado se restar incerteza concreta que a máquina não consiga resolver.

## Integração, evidências e limite de autorização

Aplicar `docs/FAE_LAB_INTEGRATION_PROTOCOL.md`: branch contém o main mais recente antes do merge, testes da frente e baseline passam, integração serial, depois gate combinado na revisão exata. Verificações previstas: sintaxe dos arquivos alterados, client smoke, crypto compat, novos checks de UX e `node tools/verify-lab-integration.mjs --run`. Não ampliar testes fora desse gate sem risco concreto.

O produto fecha somente com estados separados: **implementado → validado → integrado em main → combined-main verified → live**. Um PR de planejamento não fecha nenhum desses estados de implementação. A publicação segue a integração GitHub/Vercel configurada, quando a etapa de execução a autorizar; alterar o backend exige sua autoridade própria. Não há infraestrutura paga, mudança de chaves, assinatura, consenso, mineração ou economia no plano mínimo.

Se `main` mudar, resolver novamente seus contratos e conciliar os arquivos de UX. Se surgir falha de dados ou browser, manter o erro no registro e corrigir o limite afetado. Uma falha de clipboard não permite anunciar cópia bem-sucedida; uma falha de consulta não permite declarar histórico vazio; indisponibilidade do Explorer não permite promover uma fonte substituta a autoridade.

## Reprodução e artefatos

No checkout da revisão indicada do Build Colony, com Python 3.11 ou superior:

```sh
python docs/wallet-transaction-ux/run-planning.py \
  --build-colony-root /caminho/Build-Colony \
  --output-dir /tmp/fae-wallet-ux-planning-replay
```

O script valida os blobs do motor antes de importá-lo. Não precisa de credenciais, chamadas a provider, GitHub Actions ou infraestrutura alugada. Os testes do motor são os arquivos já existentes no Build Colony e seus logs foram preservados.

- [Resumo executado](wallet-transaction-ux/run-20260923/summary.json)
- [Perfil com escopos, invariantes e gates](wallet-transaction-ux/profile.json)
- [Manifesto](wallet-transaction-ux/run-20260923/manifest.json)
- [Ledger](wallet-transaction-ux/run-20260923/ledger.json)
- [Seleção AGDWS](wallet-transaction-ux/run-20260923/selection-decision.json)
- [Comandos executados](wallet-transaction-ux/run-20260923/commands.json)
- [Comparação do frontend publicado](wallet-transaction-ux/live-baseline.json)
- [Verificação dos arquivos do motor](wallet-transaction-ux/engine-source.json)

A busca de PRs abertos por `wallet` e `transaction` não encontrou implementação dedicada destas duas tasks. Trabalhos de transição de estado/PQ encontrados pertencem a outras frentes e não serão incorporados a este escopo.
