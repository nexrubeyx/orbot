# Bot

## Confirmação de monstro

A opção **Responder confirmação de monstro**, na aba **Captcha** do painel,
vem ativada. Ao receber um desafio `vq` de seleção de monstro (`k: 1`), o bot
compara os sprites locais do monstro pedido com as colunas da imagem original
enviada pelo jogo. Nenhuma imagem é enviada a serviços externos.

O reconhecimento procura diferentes tamanhos, posições, quadros de animação
e reflexões horizontais. Só envia `{t: "va", a: índice}` quando a melhor
semelhança atinge 0,82 e supera a segunda opção por pelo menos 0,12. Esses
limites são heurísticas, não probabilidades de acerto.

Após reconhecer a opção, aguarda um intervalo aleatório de **5 a 20 segundos**
antes de enviar. O limite superior diminui quando o prazo restante é curto,
preservando uma margem de segurança. Se não houver tempo para esperar pelo
menos 5 segundos, mantém a resposta manual. O Console informa a espera sorteada.

A rotina principal de caça aguarda enquanto a confirmação estiver aberta.
Uma resposta manual, o encerramento da conexão ou a substituição do desafio
cancela a análise pendente. O bot não repete uma resposta ao mesmo desafio
e não fecha a janela por conta própria; aguarda o evento de fechamento do jogo.

Na aba **Captcha**, os desafios de monstro recebidos são salvos no IndexedDB
do navegador com imagem, horário e resposta enviada. O histórico guarda até
50 captchas e permite exportar um JSON. **Repetir último captcha real** e os
botões **Repetir** abrem a janela original do cliente com a imagem e mensagem
salvas, inclusive após reiniciar o cliente. O reconhecimento roda em uma
simulação separada; nenhum pacote de teste é enviado ao servidor.

Desafios de texto/contas, sprites indisponíveis e comparações inconclusivas
exigem resposta manual. O Console informa o resultado; `mod.confirmation`
contém o estado e os índices de semelhança das opções.

### Validação

Execute `node tests/confirmation.test.cjs` dentro de `bot`.
Os testes usam imagens sintéticas e cobrem localização, escala, reflexão,
ruído, ambiguidade, cancelamento, prazo e envio único.

O reconhecimento ainda precisa ser validado com os PNGs originais recebidos
do jogo. Uma foto da tela não permite medir a precisão contra o atlas real.
Na primeira execução, acompanhe o Console e a janela do desafio para conferir
a opção reconhecida. Não há garantia de acerto em imagens distorcidas ou em
versões futuras do desafio.
