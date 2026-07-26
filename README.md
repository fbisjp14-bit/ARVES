# ARVES

Interface multimodal premium criada por **LEINAD**, com identidade visual preta e azul, chat, voz, criação, RAG local e integrações opcionais.

## Executar localmente

Requisitos: Node.js 20 ou superior.

```bash
npm install
cp .env.example .env
npm run dev
```

Abra `http://localhost:3000`.

Para validar e gerar a versão de produção:

```bash
npm run lint
npm run build
npm start
```

## Chaves e proteção do servidor

- `GEMINI_API_KEY` e `ELEVENLABS_API_KEY` são opcionais no servidor. O usuário também pode inserir as próprias chaves no painel.
- `ARVES_ACCESS_TOKEN` protege as rotas privadas e os canais WebSocket em uma implantação pública. Informe o mesmo valor no campo “Token privado do servidor ARVES”.
- `ARVES_WEBHOOK_SECRET` protege o webhook do WhatsApp/Evolution pelo cabeçalho `X-ARVES-Webhook-Secret`.
- `ARVES_ALLOWED_ORIGINS` adiciona origens autorizadas para WebSockets.
- `ARVES_ALLOW_PRIVATE_INTEGRATIONS=true` deve ser usado somente quando a Evolution API estiver deliberadamente na sua rede local.

As chaves ficam no navegador atual e **não entram na sincronização de memória**. O endpoint de status do Gemini nunca devolve a chave do servidor. Em produção, use HTTPS e segredos longos e aleatórios.

## Privacidade

Memórias e preferências são armazenadas localmente no navegador. Ao usar IA, voz, pesquisa, mapas ou outras integrações, os dados necessários à ação podem ser enviados ao provedor configurado. O conector RAG acessa somente arquivos selecionados pelo usuário.

## Comandos

- `npm run dev` — servidor de desenvolvimento.
- `npm run lint` — validação TypeScript.
- `npm run build` — build do cliente e do servidor.
- `npm start` — servidor compilado.

