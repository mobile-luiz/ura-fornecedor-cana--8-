# URA de Consulta — Fornecedores de Cana (Tonelagem e ATR)

Exemplo de bot de WhatsApp onde o fornecedor consulta sua tonelagem e ATR
informando o CPF.

## Como funciona o fluxo

1. Fornecedor manda mensagem qualquer → bot pede o CPF
2. Fornecedor digita o CPF (com ou sem pontuação)
3. Bot valida o CPF na base (`dados-fornecedores.json`)
   - Se não encontrar, avisa e continua pedindo o CPF
   - Se encontrar, mostra o menu:
     - 1: última entrega (data, toneladas, ATR)
     - 2: acumulado da safra (total de toneladas, ATR médio)
4. Fornecedor digita "menu" a qualquer momento para ver as opções de novo

## Como rodar

```bash
npm install
node bot.js
```

O terminal vai mostrar algo como:

```
🌐 Acesse http://localhost:3000 para escanear o QR Code
```

Abra esse endereço no navegador — a página `public/index.html` mostra o QR
Code e atualiza sozinha a cada 3 segundos até detectar a conexão. Escaneie
com o WhatsApp que vai funcionar como o bot (recomendo um número dedicado,
não o pessoal).

Se for rodar em um servidor (Render, VPS etc.) em vez do seu PC, acesse pelo
endereço público do serviço em vez de `localhost`, e garanta que a porta
esteja liberada (por padrão é a 3000, pode mudar com a variável de ambiente
`PORT`).

## Trocando a fonte de dados

Neste exemplo os dados ficam em `dados-fornecedores.json`, indexados por CPF
(só números). Para usar em produção, troque a função `carregarDados()` em
`bot.js` por uma consulta real, por exemplo:

- **Planilha Google Sheets**: usar a API do Google Sheets para ler os dados
- **Banco de dados (PostgreSQL/MySQL)**: substituir por uma query SQL
- **Sistema de pesagem/laboratório da usina**: se já existir uma API, chamar
  ela diretamente

O formato esperado é:

```json
{
  "CPF_SEM_PONTUACAO": {
    "nome": "Nome do Fornecedor",
    "codigo": "Código interno",
    "entregas": [
      { "data": "AAAA-MM-DD", "toneladas": 0.0, "atr": 0.0 }
    ]
  }
}
```

## Pontos importantes para produção

- **Sessões em memória**: este exemplo guarda o estado da conversa (`sessoes`)
  em um `Map`, que é apagado se o bot reiniciar. Para produção, trocar por
  Redis ou uma tabela no banco de dados.
- **Segurança**: validar sempre pelo CPF digitado, mas considerar também
  vincular o número de WhatsApp ao CPF depois da primeira consulta bem-sucedida,
  para evitar que qualquer pessoa com o CPF de outra consulte os dados dela.
- **Volume de mensagens**: em época de safra, o volume de consultas pode subir
  bastante — vale monitorar e, se precisar, colocar fila de processamento.
- **LGPD**: como o bot lida com CPF e dados financeiros/produtivos do
  fornecedor, vale ter uma política clara de retenção e acesso a esses dados.
