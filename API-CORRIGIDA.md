# Correção da API Gemini

- Mantida integralmente a identidade e a interface original do OSONE.
- O teste de chave agora usa `models.list`, sem gastar cota de geração.
- A chave é normalizada e salva imediatamente antes da validação.
- Erros 429 não são mais tratados como chave inválida.
- Mensagens técnicas extensas foram substituídas por mensagens curtas.
- Chamadas de texto no modo estático da Vercel tentam modelos alternativos compatíveis quando o modelo selecionado está indisponível ou temporariamente limitado.
- Node.js 22 foi fixado para implantação atual na Vercel.

Observação: nenhuma correção de código pode tornar a cota gratuita ilimitada. Quando o limite real da conta Google for atingido, é necessário aguardar a janela de renovação ou ativar faturamento no projeto.
