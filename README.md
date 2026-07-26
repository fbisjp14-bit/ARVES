# OSONE AI — Gemini + GPT‑5.6 Sol

Esta versão mantém o visual e os recursos da base `OSONE-AI-main(5)`, com uma camada de provedores mais estável:

- Gemini continua sendo o provedor principal.
- GPT‑5.6 Sol entra automaticamente como segunda opção quando o Gemini estiver indisponível, sem chave ou sem cota.
- Erros de autenticação, pedido inválido ou bloqueio de segurança não são desviados para outro provedor.
- Pesquisa usa Google Search Grounding pelo Gemini e Web Search pelo GPT‑5.6 Sol, com fontes clicáveis.
- Imagens usam Gemini primeiro e a ferramenta de geração de imagens do GPT‑5.6 Sol como contingência.
- PDFs, DOCX e planilhas são gerados localmente pelo aplicativo.
- A voz TTS do navegador foi removida. O áudio usa somente a rota neural `/api/tts`.
- Chaves salvas pela interface ficam separadas por perfil neste navegador e não entram em snapshots.

## Publicar rapidamente no GitHub

1. Extraia o ZIP.
2. Crie um repositório vazio no GitHub.
3. No repositório, escolha **Add file → Upload files**.
4. Abra a pasta `OSONE-AI-main` extraída, selecione todo o conteúdo e arraste para a página.
5. Clique em **Commit changes**.

Não envie a pasta `node_modules`, a pasta `dist` nem um arquivo `.env`. Elas já estão ignoradas pelo Git.

Também é possível publicar pelo terminal:

```bash
git init
git add .
git commit -m "OSONE AI Gemini e GPT-5.6 Sol"
git branch -M main
git remote add origin URL_DO_SEU_REPOSITORIO
git push -u origin main
```

## Publicar na Vercel

1. Importe o repositório do GitHub na Vercel.
2. Mantenha o framework **Vite**.
3. O projeto já define `npm run vercel-build`, saída `dist` e Node.js 22.
4. Em **Settings → Environment Variables**, configure:

```text
GEMINI_API_KEY=sua_chave_gemini
OPENAI_API_KEY=sua_chave_openai
```

Opcionalmente:

```text
ELEVENLABS_API_KEY=sua_chave_elevenlabs
ELEVENLABS_VOICE_ID=id_da_voz
```

Depois faça um novo deploy. As chaves também podem ser informadas em **Ajustes → Chaves**, mas variáveis da Vercel são mais adequadas para uma instalação privada. Nunca use prefixo `VITE_` em chaves secretas.

## Como funciona a contingência

O fallback para GPT‑5.6 Sol é acionado somente em falhas recuperáveis do Gemini:

- chave Gemini ausente;
- limite/cota (`429`);
- timeout;
- modelo ou serviço temporariamente indisponível;
- resposta vazia.

Uma chave inválida (`401/403`), solicitação incorreta (`4xx`) ou bloqueio de segurança é exibido ao usuário e não tenta contornar a decisão usando outro provedor.

## Verificação local

Requer Node.js 22:

```bash
npm install
npm run check
npm audit --omit=dev
```

Para iniciar:

```bash
npm run dev
```

## Observações importantes

- A assinatura do ChatGPT e os créditos da API da OpenAI são produtos separados.
- O modelo OpenAI foi fixado em `gpt-5.6-sol`; versões antigas não aparecem na interface.
- A contingência depende de a chave possuir acesso ao modelo e saldo/cota disponível.
- Pesquisa e geração de imagens podem ter custo nos provedores.
