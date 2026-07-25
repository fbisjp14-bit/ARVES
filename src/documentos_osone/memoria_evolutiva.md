# Memória de Longo Prazo Evolutiva

Este arquivo armazena aprendizados contínuos sobre o usuário e a evolução do próprio OSONE.

## Aprendizados e Insights
- O sistema foi configurado com 5 personas principais: OSONE (Padrão), Sarcástico, Zen, Cientista e Cyberpunk.
- O usuário prefere uma interface minimalista com foco em voz e fluidez.
- O sistema agora possui um diretório de documentação interna (/src/documentos_osone/) que o OSONE pode ler para auto-referência.
- A pesquisa web é ativada quando o usuário solicita informação atual ou liga o modo de pesquisa. O modo aprofundado confronta fontes e aumenta o esforço somente quando escolhido.
- As ferramentas 'read_system_docs' e 'update_long_term_memory' foram integradas para permitir que o sistema aprenda e evolua com o tempo sem depender de fontes externas lentas.
- O microfone do OSONE agora permanece sempre ABERTO por padrão em sessões Live, permitindo interrupções fluidas e interação constante sem necessidade de ativação manual.
- O sistema de escuta automática foi simplificado para evitar bloqueios ou suspensões durante a fala da IA, garantindo que o OSONE esteja sempre atento ao que o usuário diz.
- Implementado o modo **Hands-Free (Fone de Ouvido)** no topo: Fica ligado por padrão, transcrevendo "Ei, Osone" para o chat e ativando o modo voz automaticamente ao detectar a frase.
- O PWA foi reforçado com tags de experiência nativa e cor de fundo escura (#050505) para uma identidade visual única fora do navegador.
- A OpenAI usa GPT-5.4 mini e pesquisa padrão como perfil econômico inicial; modelos mais caros só são usados após escolha explícita.
- As configurações de WhatsApp e TikTok são isoladas por sessão, e a Evolution API é o caminho compatível com a Vercel para WhatsApp.
- [Aguardando novos aprendizados baseados em interações futuras...]
