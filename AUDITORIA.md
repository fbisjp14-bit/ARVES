# Auditoria técnica — OSONE AI 3.0

Data da validação: 25 de julho de 2026.

## Resultado

Todos os testes, a compilação local, o empacotamento da função Vercel e o smoke
test de produção passaram. A auditoria do npm não identificou vulnerabilidades
conhecidas nas dependências.

## Evidências executadas

| Validação | Resultado |
| --- | --- |
| TypeScript (`tsc --noEmit`) | Aprovado |
| Suíte automatizada | 40 testes aprovados |
| Build Vite | Aprovado |
| Bundle do servidor Node | Aprovado |
| Bundle da função Vercel | Aprovado |
| Smoke test do build de produção | Aprovado |
| Arquivos estáticos verificados no smoke test | 9 de 9 responderam HTTP 200 |
| Sessões simultâneas isoladas no teste de carga | 40 |
| Sessões isoladas no servidor compilado de produção | 30 |
| Rajada de uma sessão | Limitada a no máximo 8 operações simultâneas |
| Abuso sequencial | HTTP 429 com `Retry-After: 60` |
| Requisição sem chave obrigatória | HTTP 400 |
| `npm audit` completo | 0 vulnerabilidades |
| `npm audit --omit=dev` | 0 vulnerabilidades |

As APIs externas foram substituídas por servidores simulados controlados nos
testes automatizados. Isso permite verificar encaminhamento de chaves,
isolamento e formato das requisições sem consumir créditos reais.

## Cenários cobertos

- Quarenta usuários usando Gemini, OpenAI, WhatsApp e TikTok em paralelo.
- Ausência de cruzamento de chaves, nomes de usuário e configuração entre
  sessões.
- Sessão abusiva recebendo limite sem impedir a requisição de outro usuário.
- Migração automática de configuração GPT-5.6 antiga para `gpt-5.4-mini`.
- Handshake Gemini e OpenAI sem chamada de geração cobrada.
- Pesquisa OpenAI com `web_search`, fontes e citações normalizadas.
- Geração de imagem OpenAI com GPT Image 2.
- Correção automática de pedido de imagem enviado a um modelo Gemini textual.
- PDF de conversa com texto e imagens, incluindo bloqueio de conteúdo ativo.
- XLSX válido, DOCX e limites de anexos.
- Persistência local corrompida, perfis duplicados e exclusão completa do perfil.
- URLs externas, navegação, preview de código e proteção contra `javascript:`.
- Bloqueio de SSRF, IPs privados, redirecionamentos inseguros e downloads
  excessivos na rota de scraping.
- Remoção de segredos em logs, mensagens de erro e respostas de configuração.
- Caminhos de API Vercel, inclusive rejeição de traversal.
- Cabeçalhos de segurança, service worker e cache desativado para APIs.

## Correções relevantes

- Removida a injeção de chaves no bundle do navegador.
- Autenticação Gemini alterada para o cabeçalho oficial.
- Integração ElevenLabs passou a usar endpoints REST válidos.
- Estado efêmero do servidor ganhou escopo de sessão, TTL e limite de tamanho.
- Chaves e dados do aplicativo passaram a ser separados por perfil.
- Identificadores previsíveis foram substituídos por aleatoriedade criptográfica.
- O conector WhatsApp deixou de devolver segredos salvos.
- O proxy Evolution exige HTTPS e bloqueia destinos internos.
- Funções serverless incompatíveis com sessão persistente passaram a responder
  explicitamente como indisponíveis, em vez de simular sucesso enganoso.

## Limites conhecidos

Os perfis são locais e não possuem autenticação remota. O isolamento foi
projetado para sessões e perfis cooperativos no navegador; ele não protege dados
contra uma pessoa com acesso completo ao mesmo perfil do navegador.

Conexões persistentes, automação de navegador, webhook contínuo do WhatsApp e
TikTok real não são adequados a funções efêmeras da Vercel. Esses recursos
precisam de um worker dedicado, armazenamento persistente e autenticação.

Os testes externos validam o contrato das APIs por simulação. Disponibilidade,
saldo, permissões e limites reais continuam dependendo da chave e da conta do
provedor usada no momento.
