# Plugged Sustained Power Equilibrium — iPad Pro M4
**Sidecar de observação, não altera o contrato congelado RDE, HFB ou MTS.**

**Princípio:** *Mining should be able to live on the device, not consume the device.*

## O que mudou
O usuário observou que um outro minerador (BrowserCoin) continuava drenando a bateria mesmo ligado à tomada. O teste deve separar quatro hipóteses: (1) alimentação/cabo/bateria inadequados; (2) política normal de carregamento e limitação térmica do iPadOS; (3) consumo líquido persistente do workload; (4) medições insuficientes. Não antecipar PASS ou FAIL.

**Não confundir algoritmos:** HFB usa o DP6 v0.7; o RDE usa o minerador SHA256 da testnet. Duas horas e 33 minutos de RDE não constituem evidência de duas horas e 33 minutos de DP6.

## Setup único
Registrar iPad exato, iPadOS, saúde da bateria (ou desconhecida), política de limite de 80% ligada/desligada, carregador modelo e potência nominal, cabo, wattímetro, unidade Wh/kWh, temperatura ambiente e brilho. Manter a mesma fonte e resfriamento normal. Não inferir que a potência nominal do carregador seja a potência realmente entregue.

**Segunda tela:** usar um iPhone para notas/fotos com timestamps do percentual de bateria visível no iPad e do wattímetro. Não abrir Ajustes, Central de Controle ou ChatGPT no **iPad em teste** durante HFB e RDE medidos, pois isso comprometeria a integridade de foreground. A mudança de fase do RDE só pode seguir o próprio harness.

### 0. Baseline: 20 minutos de uso normalmente exigente (sem mineração)
Declarar *antes* o workload normal intensivo disponível, por exemplo jogo pesado habitual ou edição exigente. Conectar o mesmo carregador e monitorar no minuto **0, 10, 20**: bateria %, status de carga e watts/Wh. Se o dispositivo também descarregar continuamente nesse cenário, **INVALID_ENVIRONMENT / charger adequacy unresolved**; não atribuir falha ao DP6. Depois aguardar estabilização térmica e carregamento perto do regime estável requerido pelo HFB. Não mudar configurações da bateria só para produzir resultado esperado.

### 1. HFB DP6: **60 minutos** contínuos (recomendado para residência)
Abrir https://fairyelf-fae-asic-lab.vercel.app/; verificar o hash WASM e paridade, anotar contador Wh no **mesmo instante do início**; manter Safari foreground por 60m. O HFB oficial continua com 30m mínimos e 35m preferenciais: **60m é uma extensão do período de observação, não uma nova exigência de aceitação**. Usar o iPhone para anotar no minuto **0, 10, 20, 30, 40, 50, 60** bateria %, carga, leitura instantânea W, contador acumulado Wh (se disponível), temperatura percebida. Exportar o JSON original e foto do contador final, computar média watts = delta Wh / horas somente no intervalo coincidente. Se o SOC for ambíguo e estiver seguro, extensão **opcional, na mesma execução**, até 90m com observações 75 e 90m. Nunca interromper a aba do teste para registrar o percentual.

### 2. RDE testnet SHA256: **2h33min** inalterados
https://fae-rde-physical-autopilot-1lztsf.v2.appdeploy.ai/?deviceClass=mobile_tablet_arm&manufacturer=Apple&mode=PHYSICAL_EVIDENCE
Três 10+20min sustentados, três 1+5+15min coexistência. Fazer fotos passivas no acumulado **0, 30, 60, 90, 111, 132, 153m** em outro dispositivo se possível. Nada de sair da aba, recarregar ou experimentar simultaneamente DP6. Depois executar 5 mudanças reais background/foreground e exportar as capturas antes de fechar/atualizar Safari. O que se mede aqui vale **somente** para o minerador SHA256 e o contrato RDE.

### 3. MTS-12 V3 — residual, inalterado
https://fae-mts12-v3-residual-isolated-2026.vercel.app/lab/mining-tip-sync/mts-12-ipad-acceptance.html?residualOnly=1
Uma aba Miner A, armamento, Safari background por 30–60s, retorno direto à Miner A, exportar JSON. Status request-start <=1500ms, HTTP 200; não repetir real-tip histórico.

## Classificação adicional, **não canônica**
- 🟢 **SUSTAINABLE_WITHIN_OBSERVED_WINDOW:** após aquecimento bateria estabiliza/sobe, DP6 segue produzindo trabalho, sem evento crítico. Não é prova 24/7.
- 🟡 **MARGINAL_TRANSIENT_OR_OS_HYSTERESIS:** descarga inicial curta seguida de platô ou ciclo limitado de carga; pede observação se persistir dúvida.
- 🔴 **SUSTAINED_DISCHARGE_TREND_OBSERVED:** SOC continua descendo em amostras tardias com fonte adequada e baseline normal; falha na premissa de residência desta configuração, sujeita a análise causal. Não projetar shutdown inevitável como fato.
- **INCONCLUSIVE:** poucas amostras, 100% mascarando tendência, quantização, mudança de fontes ou limite 80%.
- **INVALID_ENVIRONMENT:** defeito/temperatura inadequada, baseline de uso normal também inviável ou alimentação insuficiente. Diagnosticar ambiente antes de culpar o DP6.
- **CRITICAL_EVENT_STOP:** aquecimento anormal, alerta térmico ou queda acelerada grave: interromper e preservar evidência parcial.

**Cuidado Apple:** com limite de 80% ligado, a carga pode cair até cerca de **75% antes de retomar o carregamento**, por política normal de saúde da bateria. Isso sozinho não comprova descarga insustentável. Fonte: https://support.apple.com/pt-br/118418. Apple documenta carregadores USB-C 20W fornecidos com alguns iPad Pro M4, mas a potência real de entrega e o headroom do workload devem ser observados: https://support.apple.com/pt-br/120548.

## Saídas e duração
Arquivos primários: JSON HFB + Wh/fotos; JSON RDE; JSON MTS V3. Sidecar: fotos e registro de bateria/carga/watts em [power-residency-ledger.csv](./power-residency-ledger.csv), atribuído a cada workload distinto.
Tempo programado: **20 + 60 + 153 = 233min (3h53)** + estabilização/cooling, cinco ciclos RDE, MTS, exportações. Extensão HFB a 90m muda para 4h23 programados.

**Limite de autoridade:** o sidecar não cria novo gate de consenso, economia, mineração, HFB ou RDE, não autoriza mainnet nem transmuta evidências de simulação ou observação informal em PASS físico.
