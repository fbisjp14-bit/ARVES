# Correção da API Gemini

## O que foi corrigido

- O botão **Testar Handshake Gemini** não usa mais `generateContent` no Gemini 2.5 Flash.
  Agora ele valida a chave pelo endpoint de listagem de modelos, sem gastar uma requisição da cota de geração.
- O projeto tenta primeiro o backend da Vercel. A chave não é enviada diretamente pelo navegador quando o backend está disponível.
- Se o backend estiver indisponível, o modo de contingência tenta automaticamente modelos estáveis:
  1. modelo escolhido pelo usuário;
  2. Gemini 3.5 Flash;
  3. Gemini 3.1 Flash-Lite;
  4. Gemini 2.5 Flash.
- Erros 400, 403, 404, 429 e 503 agora aparecem em português e sem o JSON gigante do Google.
- O erro 429 é identificado corretamente como limite de cota do projeto/modelo, e não como chave inválida.
- O cache do PWA foi atualizado para não manter uma versão antiga do site nem armazenar respostas da pasta `/api/`.
- O `package-lock.json` foi sincronizado com o `package.json`.

## Como publicar

1. Substitua os arquivos do repositório pelos arquivos desta pasta.
2. Envie as alterações ao GitHub.
3. Na Vercel, faça um novo **Redeploy**.
4. Depois do deploy, abra o site e atualize a página. O novo service worker remove o cache antigo automaticamente.
5. Cole a chave em **Ajustes** e clique em **Testar Handshake Gemini**.

## Observação importante

Uma chave pode estar correta e ainda receber erro 429. Nesse caso, a cota gratuita do projeto/modelo foi consumida. Criar outra chave dentro do mesmo projeto não cria uma nova cota. O sistema agora tenta outros modelos, mas não é possível remover ou burlar um limite imposto pelos servidores do Google.
