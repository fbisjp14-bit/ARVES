import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Music, Plus, Trash2, Play, Volume2, X, Search, Upload, Link, Square, Edit2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { SoundEffect } from '../types';

interface SoundLibraryProps {
  sounds: SoundEffect[];
  playingUrl: string | null;
  onAddSound: (sound: Partial<SoundEffect>) => void;
  onUpdateSound: (id: string, sound: Partial<SoundEffect>) => void;
  onRemoveSound: (id: string) => void;
  onRestoreDefaults: () => void;
  onPlaySound: (url: string) => void;
  onStopSound: () => void;
  onClose: () => void;
}

export const SoundLibrary = ({ sounds, playingUrl, onAddSound, onUpdateSound, onRemoveSound, onRestoreDefaults, onPlaySound, onStopSound, onClose }: SoundLibraryProps) => {
  const [filter, setFilter] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingSound, setEditingSound] = useState<SoundEffect | null>(null);
  const [newSound, setNewSound] = useState({ name: '', category: 'funny', url: '' });
  const [uploadType, setUploadType] = useState<'url' | 'file'>('url');
  const [isUploading, setIsUploading] = useState(false);

  const categories = ['all', ...Array.from(new Set(sounds.map(s => s.category)))];

  const filteredSounds = sounds.filter(s => {
    const matchesFilter = s.name.toLowerCase().includes(filter.toLowerCase());
    const matchesCategory = activeCategory === 'all' || s.category === activeCategory;
    return matchesFilter && matchesCategory;
  });

  const handleAdd = () => {
    if (newSound.name && newSound.url) {
      if (editingSound) {
        onUpdateSound(editingSound.id, newSound);
      } else {
        onAddSound(newSound);
      }
      resetForm();
    }
  };

  const resetForm = () => {
    setNewSound({ name: '', category: 'funny', url: '' });
    setUploadType('url');
    setIsAddModalOpen(false);
    setEditingSound(null);
  };

  const openEdit = (sound: SoundEffect) => {
    setEditingSound(sound);
    setNewSound({ name: sound.name, category: sound.category, url: sound.url });
    setUploadType(sound.url.startsWith('data:') ? 'file' : 'url');
    setIsAddModalOpen(true);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2.5 * 1024 * 1024) { // 2.5MB limit for localStorage safety
        alert('Este arquivo é muito grande. Tente um arquivo MP3/WAV abaixo de 2.5MB para garantir que seja salvo corretamente.');
        return;
      }
      setIsUploading(true);
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setNewSound({ ...newSound, url: result });
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex flex-col h-full bg-her-bg/50 backdrop-blur-xl rounded-[2.5rem] border border-white/[0.05] overflow-hidden">
      {/* Header */}
      <div className="p-6 md:p-8 flex items-center justify-between border-b border-white/[0.05]">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-her-accent/10 rounded-2xl text-her-accent">
            <Music size={24} />
          </div>
          <div>
            <h2 className="text-xl font-serif italic">Biblioteca de Sons</h2>
            <p className="text-[10px] text-her-muted uppercase tracking-[0.2em] font-light">Efeitos sonoros para o OSONE</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {playingUrl && (
            <button 
              onClick={onStopSound}
              className="flex items-center gap-2 px-4 py-2 bg-red-400/10 text-red-400 hover:bg-red-400/20 rounded-xl text-xs font-light border border-red-400/20 transition-all"
            >
              <Square size={14} fill="currentColor" />
              <span>Parar Todos</span>
            </button>
          )}
          <button 
            onClick={onRestoreDefaults}
            className="hidden md:flex items-center gap-2 px-4 py-2 bg-white/[0.05] text-her-muted hover:text-white rounded-xl text-xs font-light border border-white/[0.05] transition-all"
          >
            <span>Restaurar Padrões</span>
          </button>
          <button 
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-her-accent text-white rounded-xl text-xs font-light hover:bg-her-accent/90 transition-all"
          >
            <Plus size={16} />
            <span>Adicionar</span>
          </button>
          <button onClick={onClose} className="p-2.5 hover:bg-white/[0.03] rounded-full transition-colors text-her-muted">
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 p-6 md:p-8 gap-6">
        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4 shrink-0">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-her-muted" size={16} />
            <input 
              type="text" 
              placeholder="Buscar sons..." 
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/[0.05] rounded-xl py-2.5 pl-10 pr-4 text-sm font-light focus:outline-none focus:border-her-accent/30 transition-all"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "px-4 py-2 rounded-xl text-[10px] uppercase tracking-wider font-light transition-all whitespace-nowrap border",
                  activeCategory === cat 
                    ? "bg-her-accent/10 text-her-accent border-her-accent/20" 
                    : "bg-white/[0.02] text-her-muted border-white/[0.05] hover:bg-white/[0.05]"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredSounds.map((sound) => (
              <motion.div
                layout
                key={sound.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="group relative p-4 bg-white/[0.03] border border-white/[0.05] rounded-2xl hover:bg-white/[0.06] transition-all"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="p-2 bg-her-accent/5 rounded-lg text-her-accent">
                    <Volume2 size={16} />
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => openEdit(sound)}
                      className="p-1.5 opacity-0 group-hover:opacity-100 text-her-muted hover:text-her-accent transition-all"
                      title="Editar"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button 
                      onClick={() => onRemoveSound(sound.id)}
                      className="p-1.5 opacity-0 group-hover:opacity-100 text-her-muted hover:text-red-400 transition-all"
                      title="Excluir"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <h3 className="text-sm font-medium text-white/80 group-hover:text-her-accent transition-colors">{sound.name}</h3>
                <p className="text-[10px] text-her-muted uppercase tracking-widest mt-1">{sound.category}</p>
                
                <button
                  onClick={() => playingUrl === sound.url ? onStopSound() : onPlaySound(sound.url)}
                  className={cn(
                    "mt-4 w-full flex items-center justify-center gap-2 py-2 rounded-xl text-[10px] uppercase tracking-widest transition-all",
                    playingUrl === sound.url 
                      ? "bg-her-accent text-white" 
                      : "bg-white/[0.05] hover:bg-her-accent hover:text-white"
                  )}
                >
                  {playingUrl === sound.url ? (
                    <>
                      <Square size={12} fill="currentColor" />
                      <span>Parar</span>
                    </>
                  ) : (
                    <>
                      <Play size={12} fill="currentColor" />
                      <span>Testar</span>
                    </>
                  )}
                </button>
              </motion.div>
            ))}
          </div>
          
          {filteredSounds.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-her-muted">
              <Music size={48} className="mb-4 opacity-10" />
              <p className="text-sm font-light">Nenhum som encontrado</p>
            </div>
          )}
        </div>
      </div>

      {/* Add Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-her-bg w-full max-w-sm rounded-[2rem] shadow-2xl p-8 border border-white/[0.1]"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-serif italic">{editingSound ? 'Editar Som' : 'Novo Som'}</h3>
                <button onClick={resetForm} className="p-2 hover:bg-white/[0.03] rounded-full">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex bg-white/[0.03] rounded-xl p-1 mb-2">
                  <button 
                    onClick={() => setUploadType('url')}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] uppercase tracking-wider transition-all",
                      uploadType === 'url' ? "bg-white/10 text-white" : "text-her-muted hover:text-white/60"
                    )}
                  >
                    <Link size={12} />
                    Link
                  </button>
                  <button 
                    onClick={() => setUploadType('file')}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] uppercase tracking-wider transition-all",
                      uploadType === 'file' ? "bg-white/10 text-white" : "text-her-muted hover:text-white/60"
                    )}
                  >
                    <Upload size={12} />
                    Arquivo
                  </button>
                </div>

                <div>
                  <label className="block text-[9px] uppercase tracking-widest text-her-muted mb-2 font-light">Nome do Som</label>
                  <input 
                    type="text" 
                    value={newSound.name}
                    onChange={(e) => setNewSound({ ...newSound, name: e.target.value })}
                    placeholder="Ex: Risada Comica"
                    className="w-full bg-white/[0.03] border border-white/[0.05] rounded-xl py-2.5 px-4 text-sm font-light focus:outline-none focus:border-her-accent/30"
                  />
                </div>
                <div>
                  <label className="block text-[9px] uppercase tracking-widest text-her-muted mb-2 font-light">Categoria</label>
                  <select 
                    value={newSound.category}
                    onChange={(e) => setNewSound({ ...newSound, category: e.target.value })}
                    className="w-full bg-white/[0.03] border border-white/[0.05] rounded-xl py-2.5 px-4 text-sm font-light focus:outline-none focus:border-her-accent/30 appearance-none"
                  >
                    <option value="funny">Funny</option>
                    <option value="comico">Comico</option>
                    <option value="horror">Terror</option>
                    <option value="suspense">Suspense</option>
                    <option value="halloween">Halloween</option>
                    <option value="sneaky">Sneaky</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] uppercase tracking-widest text-her-muted mb-2 font-light">
                    {uploadType === 'url' ? 'URL do Som (MP3/WAV)' : 'Upload de Arquivo (MP3/WAV)'}
                  </label>
                  {uploadType === 'url' ? (
                    <input 
                      type="text" 
                      value={newSound.url}
                      onChange={(e) => setNewSound({ ...newSound, url: e.target.value })}
                      placeholder="https://exemplo.com/som.mp3"
                      className="w-full bg-white/[0.03] border border-white/[0.05] rounded-xl py-2.5 px-4 text-sm font-light focus:outline-none focus:border-her-accent/30"
                    />
                  ) : (
                    <div className="relative">
                      <input 
                        type="file" 
                        accept="audio/*"
                        onChange={handleFileChange}
                        className="hidden" 
                        id="audio-upload"
                      />
                      <label 
                        htmlFor="audio-upload"
                        className={cn(
                          "w-full flex flex-col items-center justify-center gap-3 p-6 bg-white/[0.03] border-2 border-dashed border-white/[0.05] rounded-2xl cursor-pointer hover:bg-white/[0.05] hover:border-her-accent/30 transition-all",
                          newSound.url && "border-her-accent/50 bg-her-accent/5"
                        )}
                      >
                        {isUploading ? (
                          <div className="animate-spin rounded-full h-6 w-6 border-2 border-her-accent border-t-transparent" />
                        ) : newSound.url ? (
                          <>
                            <div className="p-3 bg-her-accent/20 rounded-full text-her-accent">
                              <Volume2 size={24} />
                            </div>
                            <span className="text-[10px] text-her-accent uppercase tracking-widest">Arquivo Carregado</span>
                          </>
                        ) : (
                          <>
                            <Upload className="text-her-muted" size={24} />
                            <span className="text-[10px] text-her-muted uppercase tracking-widest">Clique para selecionar</span>
                          </>
                        )}
                      </label>
                    </div>
                  )}
                </div>

                <button 
                  onClick={handleAdd}
                  disabled={!newSound.name || !newSound.url || isUploading}
                  className="w-full py-3 bg-her-accent text-white rounded-xl text-xs font-light hover:bg-her-accent/90 transition-all disabled:opacity-30 disabled:grayscale mt-4"
                >
                  {isUploading ? 'Processando...' : editingSound ? 'Salvar Alterações' : 'Adicionar à Biblioteca'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
