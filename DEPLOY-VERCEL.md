# Deploy corrigido no Vercel

Esta versão separa as funções críticas de OpenAI e voz do servidor Express
legado. Depois de substituir os arquivos do projeto, faça um **novo deploy sem
usar o cache do build anterior**.

## OpenAI

1. Abra **Configurações > Chaves**.
2. Selecione **OpenAI / ChatGPT**.
3. Cole uma chave da plataforma de API da OpenAI e toque em
   **Testar chave OpenAI**.
4. Para pesquisar a web, selecione **Aprofundada + fontes**.

O único modelo de texto OpenAI desta versão é o GPT‑5.6 Sol.

## Pesquisa somente com Gemini

1. Selecione **Google Gemini** como provedor.
2. Informe e valide sua chave Gemini.
3. Deixe o botão **Web ON** no chat.

A busca usa Google Search Grounding dentro da própria API Gemini. Não é
necessária uma chave Custom Search, CX ou Tavily.

A assinatura do ChatGPT e os créditos da API são produtos separados. A chave
também pode ser configurada como `OPENAI_API_KEY` nas variáveis do projeto
Vercel; não coloque a chave dentro do código-fonte.

## Voz

A voz simples do navegador foi removida. O aplicativo usa apenas:

- voz neural Gemini, com a chave Gemini; ou
- ElevenLabs, quando essa opção e sua chave estiverem configuradas.

Se a API de voz falhar, o aplicativo mostra o motivo e permanece em silêncio,
sem ativar a antiga voz Google do navegador.

A versão 3.2 zera distorções antigas salvas, silencia o retorno do microfone e
aplica filtros leves contra ruído e clipping na voz em tempo real.

## Verificação rápida

Após o deploy, abra `/api/health`. A resposta deve conter:

```json
{"ok":true,"service":"osone-api","runtime":"isolated-vercel-function"}
```

Depois valide a chave dentro das Configurações. Uma chave nunca deve ser
enviada em capturas de tela, logs ou commits.
