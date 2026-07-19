import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Loader2, Play, Save, Image as ImageIcon, Volume2, BookOpen, Plus, X, Download } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import { ApiKeys } from '../types';
import { cn } from '../lib/utils';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export interface WebtoonPanel {
  id: string;
  imagePrompt: string;
  narration: string;
  dialogue?: string;
  imageUrl?: string;
  isGeneratingImage?: boolean;
}

export interface CharacterItem {
  id: string;
  name: string;
  appearance: string;
}

const PRESET_STYLES = [
  "Manhwa Vívido",
  "Anime 90s",
  "Cyberpunk",
  "Aquarela Clássica",
  "Mangá Shonen",
  "Fantasia Épica",
  "Cartoon Ocidental",
  "Lineart Sombrio",
  "Animação 2D Flat",
  "Render 3D Estilizado",
  "HQ Americana Clássica",
  "Cel Shading Art",
  "Pixel Art Cinematográfica",
  "Noir / Pulp Clássico"
];

export const WebtoonCreator = ({ apiKeys }: { apiKeys: ApiKeys }) => {
  const [idea, setIdea] = useState('');
  const [characters, setCharacters] = useState<CharacterItem[]>([{ id: Math.random().toString(36).substr(2, 9), name: '', appearance: '' }]);
  const [style, setStyle] = useState('Manhwa Vívido');
  const [language, setLanguage] = useState('Português');
  const [panelCount, setPanelCount] = useState<number>(6);
  const [panels, setPanels] = useState<WebtoonPanel[]>([]);
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [currentlySpeaking, setCurrentlySpeaking] = useState<string | null>(null);
  const [savedStories, setSavedStories] = useState<any[]>(() => {
    const saved = localStorage.getItem('osone_webtoons');
    return saved ? JSON.parse(saved) : [];
  });

  const addCharacter = () => {
    setCharacters(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), name: '', appearance: '' }]);
  };

  const removeCharacter = (id: string) => {
    setCharacters(prev => prev.filter(c => c.id !== id));
  };

  const updateCharacter = (id: string, field: 'name' | 'appearance', value: string) => {
    setCharacters(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const generateStory = async (isNextChapter: boolean = false) => {
    if (!apiKeys.gemini) {
      alert("Por favor, configure sua chave de API do Gemini nas configurações.");
      return;
    }
    if (!idea) return;

    setIsGeneratingStory(true);
    if (!isNextChapter) {
      setPanels([]);
    }
    
    try {
      const genAI = new GoogleGenAI({ apiKey: apiKeys.gemini });
      
      const charactersText = characters.map(c => `${c.name}: ${c.appearance}`).join('\n');

      const previousStoryContext = isNextChapter && panels.length > 0 
        ? `\nHistória até agora (Painéis Anteriores para contexto):\n${panels.map((p, i) => `Painel ${i+1}: Narrativa: ${p.narration} | Diálogo: ${p.dialogue || ''}`).join('\n')}\nContinue a história a partir destes acontecimentos.`
        : '';
      
      const prompt = `Você é um roteirista especializado em Webtoons.
Ideia Principal: ${idea}
Personagens (Nomes e Aparências): ${charactersText}
Estilo da Arte: ${style}
Idioma da História: ${language}${previousStoryContext}

Crie um storyboard / script de webtoon contendo exatamente ${panelCount} painéis (o próximo capítulo / continuação da história).
Retorne os dados em formato JSON usando as seguintes chaves para cada objeto no array:
- imagePrompt: Um prompt detalhado em inglês para o gerador de imagens. Deve incluir o estilo visual pedido (${style}), descrever bem o ambiente e a ação. MANTENHA A CONSISTÊNCIA DOS PERSONAGENS: Inclua as características de aparência exatas definidas acima (${charactersText}) toda vez que um personagem aparecer no painel.
- narration: Narração do painel escrito para o leitor. Em ${language}.
- dialogue: Fala dos personagens (se houver), ou deixe vazio. Em ${language}.`;

      const response = await genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                imagePrompt: { type: Type.STRING },
                narration: { type: Type.STRING },
                dialogue: { type: Type.STRING },
              },
              required: ["imagePrompt", "narration", "dialogue"]
            }
          }
        }
      });

      const text = response.text || "[]";
      let parsedPanels = [];
      try {
        parsedPanels = JSON.parse(text);
      } catch (e) {
        console.error("Failed to parse JSON", e);
      }

      const initialPanels: WebtoonPanel[] = parsedPanels.map((p: any, i: number) => ({
        id: Math.random().toString(36).substr(2, 9),
        imagePrompt: p.imagePrompt,
        narration: p.narration,
        dialogue: p.dialogue,
        isGeneratingImage: false
      }));

      if (isNextChapter) {
        setPanels(prev => [...prev, ...initialPanels]);
      } else {
        setPanels(initialPanels);
      }
      
      // Auto-generate images iteratively
      for (let i = 0; i < initialPanels.length; i++) {
        await generatePanelImage(initialPanels[i].id, initialPanels[i].imagePrompt, style);
      }
      
    } catch (error) {
      console.error(error);
      alert("Erro ao criar história: " + error);
    } finally {
      setIsGeneratingStory(false);
    }
  };

  const generatePanelImage = async (panelId: string, prompt: string, baseStyle: string) => {
    setPanels(current => current.map(p => p.id === panelId ? { ...p, isGeneratingImage: true } : p));
    try {
      const genAI = new GoogleGenAI({ apiKey: apiKeys.gemini });
      const fullPrompt = `${prompt}. Style: ${baseStyle}. Webtoon panel layout.`;
      
      const imageResult = await genAI.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: fullPrompt }] },
        config: {
          imageConfig: { aspectRatio: '9:16' }
        }
      });
      
      let imageUrl = '';
      for (const part of imageResult.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const base64EncodeString = part.inlineData.data;
          imageUrl = `data:${part.inlineData.mimeType};base64,${base64EncodeString}`;
          break;
        }
      }
      
      setPanels(current => current.map(p => 
        p.id === panelId ? { ...p, imageUrl, isGeneratingImage: false } : p
      ));
    } catch (error) {
      console.error("Image gen error", error);
      setPanels(current => current.map(p => p.id === panelId ? { ...p, isGeneratingImage: false } : p));
    }
  };

  const playTTS = (text: string, panelId: string) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    
    // Attempt to pick a good voice
    const voices = window.speechSynthesis.getVoices();
    const brVoice = voices.find(v => v.lang.includes('pt-BR'));
    if (brVoice) utterance.voice = brVoice;
    
    utterance.onstart = () => setCurrentlySpeaking(panelId);
    utterance.onend = () => setCurrentlySpeaking(null);
    
    window.speechSynthesis.speak(utterance);
  };

  const saveStory = () => {
    if (panels.length === 0) return;
    const storyData = JSON.stringify({ idea, characters, style, language, panels });
    const saved = localStorage.getItem('osone_webtoons');
    const parsedSaved = saved ? JSON.parse(saved) : [];
    const newStory = {
      id: Math.random().toString(36).substr(2, 9),
      title: idea.substring(0, 30) + '...',
      date: new Date().toISOString(),
      data: storyData
    };
    parsedSaved.push(newStory);
    localStorage.setItem('osone_webtoons', JSON.stringify(parsedSaved));
    setSavedStories(parsedSaved);
    alert("História salva com sucesso na memória do navegador!");
  };

  const exportToPDF = async () => {
    if (panels.length === 0) return;
    setIsExportingPDF(true);

    try {
      const element = document.getElementById('webtoon-preview-container');
      if (!element) return;

      const canvas = await html2canvas(element, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL('image/jpeg', 1.0);
      
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [canvas.width / 2, canvas.height / 2]
      });

      pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width / 2, canvas.height / 2);
      pdf.save('webtoon.pdf');
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Erro ao gerar o PDF da história.');
    } finally {
      setIsExportingPDF(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="w-full max-w-7xl flex-1 px-4 md:px-8 pb-4 md:pb-8 flex flex-col gap-4 md:gap-6 min-h-0 mx-auto overflow-y-auto custom-scrollbar"
    >
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shrink-0">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <BookOpen className="text-her-accent" size={24} />
            <h2 className="text-2xl font-serif italic font-light">Webtoon Creator</h2>
          </div>
          <span className="text-[10px] uppercase tracking-[0.2em] text-her-muted font-light">
            Geração de Histórias em Quadrinhos
          </span>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={saveStory}
            disabled={panels.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 bg-white/[0.03] hover:bg-white/[0.05] rounded-2xl transition-all text-xs font-light text-her-ink/70 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Save size={14} />
            Salvar História
          </button>
          <button 
            onClick={exportToPDF}
            disabled={panels.length === 0 || isExportingPDF}
            className="flex items-center gap-2 px-5 py-2.5 bg-her-accent/10 hover:bg-her-accent/20 rounded-2xl transition-all text-xs font-medium text-her-accent disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isExportingPDF ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {isExportingPDF ? 'Gerando PDF...' : 'Baixar PDF'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-4 md:gap-6 shrink-0 h-max">
        
        {/* Form panel */}
        <div className="w-full lg:w-96 shrink-0 bg-white/[0.02] backdrop-blur-xl rounded-[2.5rem] border border-white/[0.05] p-4 md:p-6 flex flex-col gap-6">
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-widest text-her-muted mb-2 ml-1">A Ideia Principal</label>
              <textarea 
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="Um grupo de mercenários explora ruínas antigas perdidas em um deserto habitado por bestas colossais..."
                className="w-full bg-black/10 border border-white/[0.05] rounded-2xl p-4 min-h-[100px] text-sm focus:outline-none focus:border-her-accent/30 text-her-ink/80 transition-colors resize-none"
              />
            </div>
            
            <div>
              <div className="flex items-center justify-between mb-2 ml-1">
                <label className="block text-xs uppercase tracking-widest text-her-muted">Personagens</label>
                <button 
                  onClick={addCharacter}
                  className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-her-accent hover:text-white transition-colors"
                >
                  <Plus size={12} />
                  Adicionar
                </button>
              </div>
              <div className="space-y-3">
                {characters.map((char, index) => (
                  <div key={char.id} className="relative bg-black/10 border border-white/[0.05] rounded-2xl p-3 pt-4">
                    {characters.length > 1 && (
                      <button 
                        onClick={() => removeCharacter(char.id)}
                        className="absolute top-2 right-2 text-her-muted hover:text-red-400 transition-colors bg-black/20 rounded-full p-1"
                      >
                        <X size={12} />
                      </button>
                    )}
                    <input 
                      type="text"
                      placeholder="Ex: Garos, o Explorador"
                      value={char.name}
                      onChange={(e) => updateCharacter(char.id, 'name', e.target.value)}
                      className="w-full bg-transparent border-b border-white/[0.05] pb-2 mb-2 text-sm focus:outline-none focus:border-her-accent/30 text-her-ink/90 transition-colors placeholder:text-white/20 font-medium"
                    />
                    <textarea 
                      value={char.appearance}
                      onChange={(e) => updateCharacter(char.id, 'appearance', e.target.value)}
                      placeholder="Ex: Alto, usa um tapa-olho, armadura de ferro escura e carrega uma espada gigante nas costas..."
                      className="w-full bg-transparent text-sm focus:outline-none text-her-ink/80 transition-colors resize-none placeholder:text-white/20 min-h-[40px]"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-widest text-her-muted mb-3 ml-1">Estilo Visual</label>
              
              <div className="flex flex-wrap gap-2 mb-3">
                {PRESET_STYLES.map(preset => (
                  <button
                    key={preset}
                    onClick={() => setStyle(preset)}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-[11px] transition-all border",
                      style === preset 
                        ? "bg-her-accent/20 border-her-accent/40 text-her-accent" 
                        : "bg-black/10 border-white/[0.05] text-her-muted hover:bg-white/[0.05]"
                    )}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              
              <input 
                type="text"
                placeholder="Ou descreva um estilo customizado..."
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="w-full bg-black/10 border border-white/[0.05] rounded-xl p-4 py-3 text-sm focus:outline-none focus:border-her-accent/30 text-her-ink/80 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs uppercase tracking-widest text-her-muted mb-3 ml-1">Idioma dos Diálogos</label>
              
              <div className="flex flex-wrap gap-2">
                {["Português", "Inglês", "Espanhol", "Japonês", "Coreano"].map(lang => (
                  <button
                    key={lang}
                    onClick={() => setLanguage(lang)}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-[11px] transition-all border",
                      language === lang 
                        ? "bg-her-accent/20 border-her-accent/40 text-her-accent" 
                        : "bg-black/10 border-white/[0.05] text-her-muted hover:bg-white/[0.05]"
                    )}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-widest text-her-muted mb-3 ml-1">Painéis por Capítulo</label>
              <div className="flex gap-2">
                {[2, 4, 6, 8, 10].map(count => (
                  <button
                    key={count}
                    onClick={() => setPanelCount(count)}
                    className={cn(
                      "px-4 py-2 rounded-xl text-[12px] font-medium transition-all border flex-1",
                      panelCount === count
                        ? "bg-her-accent/20 border-her-accent/40 text-her-accent"
                        : "bg-black/10 border-white/[0.05] text-her-muted hover:bg-white/[0.05]"
                    )}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>
          </div>
          
          <div className="flex flex-col gap-2">
            <button 
              onClick={() => generateStory(false)}
              disabled={isGeneratingStory || !idea}
              className="w-full flex items-center justify-center gap-2 py-4 bg-her-accent/10 text-her-accent rounded-2xl hover:bg-her-accent/20 transition-all font-medium disabled:opacity-30 disabled:grayscale"
            >
              {isGeneratingStory ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
              {isGeneratingStory ? "Escrevendo..." : (panels.length > 0 ? "Gerar Nova História" : "Gerar Webtoon")}
            </button>

            {panels.length > 0 && (
              <button 
                onClick={() => generateStory(true)}
                disabled={isGeneratingStory || !idea}
                className="w-full flex items-center justify-center gap-2 py-4 bg-white/5 text-white/90 rounded-2xl hover:bg-white/10 transition-all font-medium disabled:opacity-30 disabled:grayscale border border-white/[0.05]"
              >
                {isGeneratingStory ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                {isGeneratingStory ? "Escrevendo Continuação..." : "Gerar Próximo Capítulo"}
              </button>
            )}
          </div>

          {savedStories.length > 0 && (
            <div className="mt-8">
              <h3 className="text-[10px] uppercase tracking-widest text-her-muted mb-4 ml-1">Histórias Salvas</h3>
              <div className="space-y-2">
                {savedStories.map((story) => (
                  <div key={story.id} className="flex gap-2">
                    <button 
                      onClick={() => {
                        try {
                          const parsed = JSON.parse(story.data);
                          setIdea(parsed.idea);
                          
                          if (typeof parsed.characters === 'string') {
                            setCharacters([{ id: Math.random().toString(36).substr(2, 9), name: 'Legado', appearance: parsed.characters }]);
                          } else if (Array.isArray(parsed.characters)) {
                            setCharacters(parsed.characters);
                          }
                          
                          setStyle(parsed.style);
                          setLanguage(parsed.language || 'Português');
                          setPanels(parsed.panels || []);
                        } catch (e) { console.error(e); }
                      }}
                      className="flex-1 text-left p-3 bg-black/10 hover:bg-black/20 border border-white/[0.02] rounded-xl transition-all text-xs text-her-ink/70"
                    >
                      <span className="block font-medium truncate">{story.title}</span>
                      <span className="block text-[9px] text-her-muted mt-1">{new Date(story.date).toLocaleDateString()}</span>
                    </button>
                    <button 
                      onClick={() => {
                        const newSaved = savedStories.filter(s => s.id !== story.id);
                        setSavedStories(newSaved);
                        localStorage.setItem('osone_webtoons', JSON.stringify(newSaved));
                      }}
                      className="p-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-all"
                    >
                      X
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* View panel */}
        <div className="flex-1 bg-black/20 rounded-[2.5rem] border border-white/[0.05] flex flex-col items-center py-8">
          {panels.length === 0 && !isGeneratingStory ? (
            <div className="flex-1 flex flex-col items-center justify-center text-her-muted/50 p-8 text-center max-w-sm">
              <BookOpen size={48} className="opacity-20 mb-6" />
              <p className="font-light italic text-sm">
                Sua história de Webtoon aparecerá aqui em formato vertical, com painéis desenhados e diálogos fluídos.
              </p>
            </div>
          ) : (
            <div id="webtoon-preview-container" className="w-full max-w-[400px] flex flex-col items-center px-4 pt-4 pb-8 bg-[#0a0a0a]">
              {panels.map((panel, idx) => (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  key={panel.id}
                  className="w-full mb-1 border-x border-y border-white/[0.05] bg-white/[0.02] flex flex-col overflow-hidden relative"
                >
                  {/* Image container */}
                  <div className="w-full aspect-[9/16] bg-black/30 flex items-center justify-center relative overflow-hidden">
                    {panel.imageUrl ? (
                      <img 
                        src={panel.imageUrl} 
                        alt={panel.imagePrompt} 
                        className="w-full h-full object-cover" 
                        referrerPolicy="no-referrer"
                      />
                    ) : panel.isGeneratingImage ? (
                      <div className="flex flex-col items-center gap-3 text-her-muted">
                        <Loader2 size={24} className="animate-spin text-her-accent" />
                        <span className="text-[10px] tracking-widest uppercase">Gerando Painel...</span>
                      </div>
                    ) : (
                      <ImageIcon size={32} className="opacity-20 text-her-muted" />
                    )}
                  </div>
                  
                  {/* Text Overlays */}
                  <div className="absolute inset-0 flex flex-col justify-between p-4 pointer-events-none">
                    
                    {/* Narration (usually top or bottom context) */}
                    {panel.narration && (
                      <div className="self-start max-w-[85%] bg-black/60 backdrop-blur-sm border border-white/10 p-3 rounded-tr-xl rounded-br-xl rounded-bl-sm pointer-events-auto">
                        <p className="text-[11px] leading-relaxed text-serif text-white/90 italic">
                          {panel.narration}
                        </p>
                      </div>
                    )}
                    
                    {/* Dialogue (usually speech bubbles concept) */}
                    {panel.dialogue && panel.dialogue !== "null" && panel.dialogue !== "none" && (
                      <div className="self-end max-w-[80%] bg-white/90 border border-black/10 p-3 rounded-3xl rounded-tr-sm shadow-xl pointer-events-auto mb-2 text-center relative z-10">
                        <p className="text-[12px] leading-snug font-medium text-black">
                          "{panel.dialogue}"
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Play audio button */}
                  <button 
                    data-html2canvas-ignore="true"
                    onClick={() => playTTS(`${panel.narration}. ${panel.dialogue || ''}`, panel.id)}
                    className={cn(
                      "absolute top-4 right-4 p-2 rounded-full backdrop-blur-md transition-all shadow-xl z-20",
                      currentlySpeaking === panel.id ? "bg-her-accent text-white" : "bg-black/40 text-white/70 hover:bg-black/60 hover:text-white border border-white/10"
                    )}
                  >
                    <Volume2 size={14} />
                  </button>

                </motion.div>
              ))}
              
              {isGeneratingStory && (
                <div className="py-20 flex flex-col items-center text-her-muted gap-4">
                  <Loader2 size={32} className="animate-spin text-her-accent" />
                  <p className="text-xs uppercase tracking-widest font-light">Construindo o Mundo...</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};
