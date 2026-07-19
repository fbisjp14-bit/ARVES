import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Video, Sparkles, Loader2, Save, Download, Shuffle } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import { ApiKeys } from '../types';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export interface ScriptSection {
  title: string;
  hook: string;
  body: string;
  callToAction: string;
}

export const ViralFlow = ({ apiKeys }: { apiKeys: ApiKeys }) => {
  const [idea, setIdea] = useState('');
  const [script, setScript] = useState<ScriptSection | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);

  const generateRandomIdea = () => {
    const ideas = [
      "Como 1% melhora a sua vida em 1 ano (Mentalidade)",
      "3 truques psicológicos para ter mais foco nos estudos",
      "O segredo obscuro das dietas restritivas que ninguém te conta",
      "Por que você deve parar de tentar ser 'produtivo' o tempo todo",
      "O mito do talento: como construir consistência real",
      "O que as grandes marcas escondem sobre o marketing nas redes"
    ];
    setIdea(ideas[Math.floor(Math.random() * ideas.length)]);
  };

  const generateScript = async () => {
    if (!apiKeys.gemini) {
      alert("Por favor, configure sua chave de API do Gemini nas configurações.");
      return;
    }
    if (!idea) return;

    setIsGenerating(true);
    setScript(null);
    
    try {
      const genAI = new GoogleGenAI({ apiKey: apiKeys.gemini });
      
      const prompt = `Você é um roteirista especialista em vídeos virais curtos (TikTok, Reels, Shorts) e copywriting de alta conversão.
Tema/Ideia: ${idea}

Crie um roteiro de vídeo curto usando técnicas avançadas de storytelling. O vídeo deve prender a atenção nos primeiros 3 segundos, manter o engajamento no meio, e finalizar com impacto.
Estruture o roteiro nas seguintes chaves em formato JSON:
- title: Título atrativo do vídeo
- hook: Início (Gancho) - Primeiros 3 segundos (Apenas falas/texto para prender a atenção forte)
- body: Meio (Desvolvimento) - Corpo da história (Uso de storytelling com clímax, gatilhos de curiosidade)
- callToAction: Fim (CTA) - Uma frase final de impacto com uma chamada para ação

Responda SOMENTE em JSON seguindo a estrutura sem Markdown block. No body do json pode conter quebras de linha para formatar.`;

      const response = await genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              hook: { type: Type.STRING },
              body: { type: Type.STRING },
              callToAction: { type: Type.STRING },
            },
            required: ["title", "hook", "body", "callToAction"]
          }
        }
      });

      if (response.text) {
        setScript(JSON.parse(response.text));
      }
    } catch (e: any) {
      console.error(e);
      alert("Erro ao gerar o roteiro: " + e.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const exportToPDF = async () => {
    if (!script) return;
    setIsExportingPDF(true);

    try {
      const element = document.getElementById('viralflow-preview-container');
      if (!element) return;

      const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#111' });
      const imgData = canvas.toDataURL('image/jpeg', 1.0);
      
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [canvas.width / 2, canvas.height / 2]
      });

      pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width / 2, canvas.height / 2);
      pdf.save('viralflow-roteiro.pdf');
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Erro ao gerar o PDF.');
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
            <Video className="text-her-accent" size={24} />
            <h2 className="text-2xl font-serif italic font-light">ViralFlow</h2>
          </div>
          <span className="text-[10px] uppercase tracking-[0.2em] text-her-muted font-light">
            Criação de Roteiros Curtos Virais
          </span>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={exportToPDF}
            disabled={!script || isExportingPDF}
            className="flex items-center gap-2 px-5 py-2.5 bg-her-accent/10 hover:bg-her-accent/20 rounded-2xl transition-all text-xs font-medium text-her-accent disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isExportingPDF ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {isExportingPDF ? 'Gerando PDF...' : 'Baixar Roteiro PDF'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-4 md:gap-6 shrink-0 h-max">
        
        {/* Form panel */}
        <div className="w-full lg:w-96 shrink-0 bg-white/[0.02] backdrop-blur-xl rounded-[2.5rem] border border-white/[0.05] p-4 md:p-6 flex flex-col gap-6">
          
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2 ml-1">
                <label className="block text-xs uppercase tracking-widest text-her-muted">Sua Ideia ou Tema</label>
                <button 
                  onClick={generateRandomIdea}
                  className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-her-accent hover:text-white transition-colors"
                >
                  <Shuffle size={12} />
                  Aleatório
                </button>
              </div>
              <textarea 
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="Ex: Por que a consistência é mais importante que motivação nos estudos."
                className="w-full bg-black/10 border border-white/[0.05] rounded-2xl p-4 min-h-[120px] text-sm focus:outline-none focus:border-her-accent/30 text-her-ink/80 transition-colors resize-none"
              />
            </div>

            <div className="bg-her-accent/5 border border-her-accent/10 rounded-2xl p-4 mt-2">
              <h4 className="text-[10px] uppercase tracking-widest text-her-accent mb-2">Estrutura Viral</h4>
              <p className="text-xs text-her-muted/80 font-light leading-relaxed">
                Nós usamos a "Pirâmide de Retenção" para construir o roteiro:
                <br /><br />
                <strong className="text-her-ink">1. Gancho (Início):</strong> 3s críticos.<br />
                <strong className="text-her-ink">2. Corpo (Meio):</strong> História e retenção.<br />
                <strong className="text-her-ink">3. CTA (Fim):</strong> Fechamento magnético.
              </p>
            </div>
          </div>
          
          <div className="flex flex-col gap-2 mt-auto">
            <button 
              onClick={generateScript}
              disabled={isGenerating || !idea}
              className="w-full flex items-center justify-center gap-2 py-4 bg-her-accent/10 text-her-accent rounded-2xl hover:bg-her-accent/20 transition-all font-medium disabled:opacity-30 disabled:grayscale"
            >
              {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
              {isGenerating ? "Criando o Viral..." : "Gerar Roteiro"}
            </button>
          </div>
        </div>

        {/* View panel */}
        <div className="flex-1 bg-black/20 rounded-[2.5rem] border border-white/[0.05] flex flex-col items-center py-8 px-4 h-full">
          {!script && !isGenerating ? (
            <div className="flex-1 flex flex-col items-center justify-center text-her-muted/50 p-8 text-center max-w-sm h-full">
              <Video size={48} className="opacity-20 mb-6" />
              <p className="font-light italic text-sm">
                Seu roteiro de vídeo curto estruturado com técnicas avançadas de storytelling aparecerá aqui.
              </p>
            </div>
          ) : isGenerating ? (
             <div className="flex-1 flex flex-col items-center justify-center text-her-muted gap-4 py-20">
                <Loader2 size={32} className="animate-spin text-her-accent" />
                <p className="text-xs uppercase tracking-widest font-light">Estrategizando o Roteiro...</p>
             </div>
          ) : script && (
            <div id="viralflow-preview-container" className="w-full max-w-lg bg-[#111] p-6 lg:p-10 rounded-2xl border border-white/10 shrink-0">
              <h3 className="text-2xl font-serif text-white/90 font-light italic mb-8 border-b border-white/10 pb-4">
                {script.title}
              </h3>

              <div className="space-y-8">
                {/* Hook section */}
                <div className="relative pl-6 border-l-2 border-her-accent">
                  <div className="absolute -left-3 top-[-4px] bg-black text-her-accent px-1">
                     <span className="text-[10px] uppercase tracking-widest font-bold">1. Início (Gancho)</span>
                  </div>
                  <div className="mt-4 text-white/80 text-sm leading-relaxed whitespace-pre-wrap font-medium">
                    {script.hook}
                  </div>
                </div>

                {/* Body section */}
                <div className="relative pl-6 border-l-2 border-white/20">
                  <div className="absolute -left-3 top-[-4px] bg-black text-white/50 px-1">
                     <span className="text-[10px] uppercase tracking-widest font-bold">2. Meio (Desenvolvimento)</span>
                  </div>
                  <div className="mt-4 text-white/70 text-sm leading-relaxed whitespace-pre-wrap">
                    {script.body}
                  </div>
                </div>

                {/* CTA section */}
                <div className="relative pl-6 border-l-2 border-white/20">
                  <div className="absolute -left-3 top-[-4px] bg-black text-white/50 px-1">
                     <span className="text-[10px] uppercase tracking-widest font-bold">3. Fim (Call to Action)</span>
                  </div>
                  <div className="mt-4 text-her-accent/90 italic font-semibold text-sm leading-relaxed whitespace-pre-wrap">
                    {script.callToAction}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};
