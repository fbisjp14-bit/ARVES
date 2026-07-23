# OSONE Copilot Atualizado

Versão que mantém o fluxo funcional do OSONE Copilot e incorpora a interface e
os recursos da edição atual.

## Executar no computador

Requisitos: Node.js 22.x.

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Publicar no Vercel

1. Envie esta pasta para um repositório.
2. Importe o repositório no Vercel.
3. Mantenha as configurações detectadas pelo arquivo `vercel.json`.
4. Publique.
5. No OSONE, abra **Configurações → Chaves**, cole sua chave Gemini e clique
   em **Testar Handshake Gemini**.

Também é possível cadastrar `GEMINI_API_KEY` nas variáveis do projeto no
Vercel. Não coloque uma chave real dentro do código ou do repositório.

Para confirmar a Function depois do deploy, abra
`https://SEU-DOMINIO.vercel.app/api/health`. A resposta deve conter
`"ok": true`. Se o celular ainda mostrar a edição antiga, feche a aba e abra o
site novamente; esta revisão também atualiza e limpa o cache antigo do app.

## Correções principais desta edição

- autenticação Gemini compatível com as chaves atuais, usando
  `x-goog-api-key`, sem transformar a chave em token Bearer;
- validação da chave pela listagem de modelos, sem consumir uma geração;
- fallback do Copilot no navegador quando uma função do Vercel estiver
  temporariamente indisponível;
- conexão direta com o Gemini Live no build de produção, preservando a voz em
  tempo real mesmo sem WebSocket persistente nas Functions da Vercel;
- Function serverless enxuta e independente do servidor local, evitando
  `FUNCTION_INVOCATION_FAILED` no Vercel;
- fallback automático no navegador quando a Function responder com erro 500,
  mantendo o Gemini utilizável mesmo durante uma falha do backend;
- rotas `/api/*` preservadas corretamente no Vercel;
- chave, histórico e memória existentes não são apagados durante a atualização;
- validação ElevenLabs unificada;
- `package-lock.json` sincronizado e Node.js 22.x definido.

## Verificação

```bash
npm test
npm run lint
npm run build
```
