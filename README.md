# OSONE AI 3.0 — versão multiusuário estável

Esta entrega atualiza o OSONE Copilot para a interface atual, preserva a
integração de API que funcionava na versão antiga e acrescenta OpenAI,
pesquisa web, geração de imagens e exportação de documentos.

## Principais recursos

- Gemini com autenticação correta por `x-goog-api-key`.
- OpenAI como provedor opcional para chat, análise de arquivos, pesquisa web
  com fontes e geração de imagens.
- `gpt-5.4-mini` como modelo OpenAI padrão econômico.
- Opções manuais `gpt-5.4-nano`, `gpt-5.4-mini` e `gpt-5.4`.
- Nenhum uso automático do GPT-5.6.
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
3. Publique sem colocar uma chave global se cada pessoa usará a própria chave.
4. No OSONE, abra **Configurações > Chaves**, selecione Gemini ou OpenAI,
   informe a chave e clique para consolidar os parâmetros.

As variáveis de `.env.example` são alternativas globais e opcionais. Uma chave
global na Vercel será usada como fallback e o consumo dela será compartilhado
por todos os visitantes. A assinatura do ChatGPT e os créditos da API OpenAI
são produtos separados; é necessária uma chave da plataforma da API.

## Economia de créditos

- O padrão da OpenAI é `gpt-5.4-mini`.
- O modo de pesquisa aprofundada é opcional; o modo padrão não ativa pesquisa
  web em todas as mensagens.
- Para tarefas simples, `gpt-5.4-nano` pode ser selecionado manualmente.
- Geração de imagem só é executada quando solicitada.
- O servidor valida a chave consultando os modelos disponíveis, sem gastar uma
  geração apenas para realizar o handshake.

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
