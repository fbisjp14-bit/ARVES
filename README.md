# OSONE AI 3.2 — GPT‑5.6 Sol, pesquisa Gemini e voz limpa

Esta entrega atualiza o OSONE Copilot para a interface atual, preserva a
integração de API que funcionava na versão antiga e acrescenta OpenAI,
pesquisa web, geração de imagens e exportação de documentos.

## Principais recursos

- Gemini com autenticação correta por `x-goog-api-key`.
- OpenAI como provedor opcional para chat, análise de arquivos, pesquisa web
  com fontes e geração de imagens.
- Funções OpenAI, TTS e health isoladas no Vercel para que uma falha da função
  Express legada não derrube a validação da chave.
- Voz simples do navegador removida; a leitura usa apenas Gemini TTS ou
  ElevenLabs.
- GPT‑5.6 Sol como único modelo de texto da OpenAI.
- Google Search Grounding nativo com a própria chave Gemini e fontes.
- Saída de voz sem distorção artificial, com filtragem, proteção contra
  clipping e retorno do microfone silenciado.
- GPT Image 2 para imagens pela OpenAI.
- Gemini 3.1 Flash Image para imagens pelo Gemini.
- Exportação da conversa para PDF com texto e imagens.
- Exportação para DOCX e XLSX.
- RAG local separado por perfil.
- Perfis, conversas, memórias e chaves de API separados por perfil local.
- Limites de concorrência, tamanho de requisição e taxa contra abuso.
- Segredos removidos de logs e respostas.

## Executar localmente

Requisitos: Node.js 22 e npm.

```bash
npm ci
npm run dev
```

O endereço local é mostrado no terminal. Para validar a entrega completa:

```bash
npm run check
npm run test:smoke
```

## Publicar na Vercel

1. Importe este diretório como projeto na Vercel.
2. Use o preset Vite; o `vercel.json` já contém build, rotas e cabeçalhos.
3. Faça um novo deploy sem reaproveitar o cache da versão anterior.
4. Publique sem colocar uma chave global se cada pessoa usará a própria chave.
5. No OSONE, abra **Configurações > Chaves**, selecione Gemini ou OpenAI,
   informe a chave e clique para consolidar os parâmetros.

Depois do deploy, `/api/health` deve responder com
`"runtime":"isolated-vercel-function"`.

As variáveis de `.env.example` são alternativas globais e opcionais. Uma chave
global na Vercel será usada como fallback e o consumo dela será compartilhado
por todos os visitantes. A assinatura do ChatGPT e os créditos da API OpenAI
são produtos separados; é necessária uma chave da plataforma da API.

## Consumo de API

- Toda solicitação OpenAI usa `gpt-5.6-sol`, conforme solicitado. Esse modelo
  pode custar mais que as versões Mini/Nano removidas.
- O modo de pesquisa aprofundada é opcional; o modo padrão não ativa pesquisa
  web em todas as mensagens.
- No Gemini, o botão **Web ON** ativa o Grounding com Google Search usando
  somente a chave Gemini.
- Geração de imagem só é executada quando solicitada.
- O servidor valida diretamente se a chave OpenAI tem acesso ao GPT‑5.6 Sol,
  sem gastar uma geração apenas para realizar o handshake.

## Privacidade e multiusuário

O modo multiusuário desta versão isola perfis **dentro do mesmo navegador**:
chaves, chat, memória, livro de memórias, saúde, dossiê e documentos RAG usam
um escopo por perfil. Cada aba também recebe uma identidade de sessão distinta.
As chaves enviadas pelo navegador são usadas somente durante a requisição e não
são persistidas pelo servidor.

Esses perfis locais não substituem autenticação com senha e banco de dados.
Em computador compartilhado com pessoas não confiáveis, use contas de navegador
ou dispositivos separados. Para login remoto real, será necessário adicionar
um provedor de autenticação e armazenamento externo.

## Limites técnicos

- RAG: até 1 MB por arquivo, 200 arquivos por perfil e 20 MB totais por perfil.
- Requisições grandes e anexos fora dos limites são recusados de forma segura.
- A integração Evolution API funciona por HTTPS e bloqueia destinos locais ou
  privados. Webhook persistente exige um serviço dedicado, não uma função
  serverless efêmera.
- O TikTok incluído permanece em modo simulador. Automação real com sessão de
  navegador e o conector Puppeteer também exigem um worker dedicado.
- O editor automático em `scripts/auto_editor.py` é opcional e requer as
  dependências Python apropriadas no computador em que for executado.

Nenhum sistema pode garantir ausência absoluta de bugs futuros. A entrega foi
testada nas rotas e cenários descritos em `AUDITORIA.md`, incluindo concorrência,
isolamento de perfis, segurança, exportação e execução de produção.
