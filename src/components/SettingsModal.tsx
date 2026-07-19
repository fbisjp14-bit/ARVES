import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { ApiKeys, OrbStyle, AppTheme } from '../types';

export const SettingsModal = ({ 
  isOpen, 
  onClose, 
  keys, 
  setKeys, 
  selectedVoice, 
  setSelectedVoice,
  orbStyle,
  setOrbStyle,
  appTheme,
  setAppTheme
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  keys: ApiKeys;
  setKeys: (keys: ApiKeys) => void;
  selectedVoice: string;
  setSelectedVoice: (voice: string) => void;
  orbStyle: OrbStyle;
  setOrbStyle: (style: OrbStyle) => void;
  appTheme: AppTheme;
  setAppTheme: (theme: AppTheme) => void;
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-md p-0 sm:p-4"
        >
          <motion.div 
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="bg-her-bg w-full max-w-md rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-2xl p-8 border border-white/[0.05] backdrop-blur-2xl max-h-[85vh] overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-serif italic font-light">Configurações</h2>
              <button onClick={onClose} className="p-2 hover:bg-white/[0.03] rounded-full transition-colors text-her-muted">
                <X size={20} />
              </button>
            </div>
            
            <div className="space-y-6 pr-2">
              <div>
                <label className="block text-[9px] uppercase tracking-[0.2em] text-her-muted mb-2 font-light">Gemini API</label>
                <input 
                  type="password"
                  value={keys.gemini}
                  onChange={(e) => setKeys({ ...keys, gemini: e.target.value })}
                  className="w-full bg-white/[0.02] border border-white/[0.05] rounded-2xl px-5 py-3 focus:outline-none focus:border-her-accent/30 transition-colors text-base md:text-sm font-light text-her-ink/80"
                  placeholder="Insira sua chave..."
                />
              </div>

              <div>
                <label className="block text-[9px] uppercase tracking-[0.2em] text-her-muted mb-2 font-light">Voz do OSONE</label>
                <div className="grid grid-cols-3 gap-2">
                  {['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'].map((voice) => (
                    <button
                      key={voice}
                      onClick={() => setSelectedVoice(voice)}
                      className={cn(
                        "px-3 py-2 rounded-xl text-[10px] sm:text-xs font-light transition-all border",
                        selectedVoice === voice 
                          ? "bg-her-accent/10 text-her-accent border-her-accent/30" 
                          : "bg-white/[0.02] text-her-muted border-white/[0.05] hover:bg-white/[0.05]"
                      )}
                    >
                      {voice}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[9px] uppercase tracking-[0.2em] text-her-muted mb-2 font-light">Estilo do Núcleo (Orb)</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'classic', label: 'Classic' },
                    { id: 'superintelligence', label: 'Super AI' },
                    { id: 'neural', label: 'Neural' }
                  ].map((style) => (
                    <button
                      key={style.id}
                      onClick={() => setOrbStyle(style.id as OrbStyle)}
                      className={cn(
                        "px-3 py-2 rounded-xl text-[10px] sm:text-xs font-light transition-all border",
                        orbStyle === style.id 
                          ? "bg-her-accent/10 text-her-accent border-her-accent/30" 
                          : "bg-white/[0.02] text-her-muted border-white/[0.05] hover:bg-white/[0.05]"
                      )}
                    >
                      {style.label}
                    </button>
                  ))}
                </div>
              </div>
              
              <div>
                <label className="block text-[9px] uppercase tracking-[0.2em] text-her-muted mb-2 font-light">Tema da Interface</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'her', label: 'OSONE (Padrão)' },
                    { id: 'cyberpunk', label: 'Cyberpunk' },
                    { id: 'monochrome', label: 'Monochrome' },
                    { id: 'nature', label: 'Natureza' }
                  ].map((theme) => (
                    <button
                      key={theme.id}
                      onClick={() => setAppTheme(theme.id as AppTheme)}
                      className={cn(
                        "px-3 py-2 rounded-xl text-[10px] sm:text-xs font-light transition-all border",
                        appTheme === theme.id 
                          ? "bg-her-accent/10 text-her-accent border-her-accent/30" 
                          : "bg-white/[0.02] text-her-muted border-white/[0.05] hover:bg-white/[0.05]"
                      )}
                    >
                      {theme.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            
            <button 
              onClick={onClose}
              className="w-full mt-10 bg-her-accent/10 text-her-accent border border-her-accent/20 rounded-xl py-4 font-light text-sm hover:bg-her-accent/20 transition-all"
            >
              Confirmar Alterações
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

