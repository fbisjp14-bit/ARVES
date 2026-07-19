import React, { useState, useEffect, useRef } from 'react';
import { 
  Settings, 
  Menu, 
  Mic, 
  MicOff, 
  Play, 
  Copy, 
  X, 
  ChevronRight,
  Code,
  FileText,
  Volume2,
  VolumeX,
  Send,
  Loader2,
  Zap,
  FolderPlus,
  FilePlus,
  Download,
  Folder,
  Trash2,
  Sparkles,
  ChevronDown,
  Monitor,
  MonitorOff,
  Plus,
  Paperclip,
  Image as ImageIcon,
  MessageSquare,
  Maximize,
  Minimize,
  Smartphone,
  Speaker
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Modality, Type } from "@google/genai";
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import * as xlsx from 'xlsx';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { cn } from './lib/utils';
import { ApiKeys, WorkspaceMode, Message, LiveState, FileSystemItem, VirtualFile, VirtualFolder, OrbStyle, AppTheme } from './types';
import { AudioProcessor, AudioPlayer } from './lib/audio';
import { FileTreeItem } from './components/FileTreeItem';
import { InfinityLogo } from './components/InfinityLogo';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { CodePreview } from './components/CodePreview';
import { VoiceSwitcher } from './components/VoiceSwitcher';
import { SoundLibrary } from './components/SoundLibrary';
import { WebtoonCreator } from './components/WebtoonCreator';
import { ViralFlow } from './components/ViralFlow';
import { SoundEffect } from './types';

// --- Main App ---
const DEFAULT_SOUNDS: SoundEffect[] = [
  { id: '1', name: 'Boing', category: 'funny', url: 'https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3' },
  { id: '2', name: 'Grito de Terror', category: 'terror', url: 'https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3' },
  { id: '3', name: 'Batida de Coração', category: 'suspense', url: 'https://assets.mixkit.co/active_storage/sfx/2324/2324-preview.mp3' },
  { id: '4', name: 'Passos Sutis', category: 'sneaky', url: 'https://assets.mixkit.co/active_storage/sfx/2355/2355-preview.mp3' },
  { id: '5', name: 'Risada Maligna', category: 'halloween', url: 'https://assets.mixkit.co/active_storage/sfx/2287/2287-preview.mp3' },
  { id: '6', name: 'Rimshot', category: 'comico', url: 'https://assets.mixkit.co/active_storage/sfx/2330/2330-preview.mp3' },
  { id: '7', name: 'Aplausos', category: 'comico', url: 'https://assets.mixkit.co/active_storage/sfx/2362/2362-preview.mp3' },
  { id: '8', name: 'Rufar de Tambores', category: 'suspense', url: 'https://assets.mixkit.co/active_storage/sfx/2289/2289-preview.mp3' },
  { id: '9', name: 'Erro/Buzz', category: 'funny', url: 'https://assets.mixkit.co/active_storage/sfx/2353/2353-preview.mp3' },
  { id: '10', name: 'Ta-da!', category: 'comico', url: 'https://assets.mixkit.co/active_storage/sfx/2365/2365-preview.mp3' },
  { id: '11', name: 'Trovão', category: 'horror', url: 'https://assets.mixkit.co/active_storage/sfx/2344/2344-preview.mp3' },
  { id: '12', name: 'Porta Rangendo', category: 'horror', url: 'https://assets.mixkit.co/active_storage/sfx/2261/2261-preview.mp3' },
  { id: '13', name: 'Assobio', category: 'funny', url: 'https://assets.mixkit.co/active_storage/sfx/2331/2331-preview.mp3' },
  { id: '14', name: 'Brilho Mágico', category: 'funny', url: 'https://assets.mixkit.co/active_storage/sfx/2374/2374-preview.mp3' },
  { id: '15', name: 'Voo Ninja', category: 'sneaky', url: 'https://assets.mixkit.co/active_storage/sfx/2351/2351-preview.mp3' },
  { id: '16', name: 'Explosão Cômica', category: 'funny', url: 'https://assets.mixkit.co/active_storage/sfx/2359/2359-preview.mp3' }
];

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [clickVisual, setClickVisual] = useState<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('home');

  useEffect(() => {
    // Cancel speech synthesis when navigating away from Home
    window.speechSynthesis.cancel();
  }, [workspaceMode]);

  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.lang = 'pt-BR';
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setHomePrompt((prev) => prev ? prev + ' ' + transcript : transcript);
        setIsTranscribing(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setIsTranscribing(false);
      };

      recognitionRef.current.onend = () => {
        setIsTranscribing(false);
      };
    }
  }, []);

  const handleTranscriptionToggle = () => {
    if (isTranscribing) {
      recognitionRef.current?.stop();
      setIsTranscribing(false);
    } else {
      if (recognitionRef.current) {
        recognitionRef.current.start();
        setIsTranscribing(true);
      } else {
        alert('Seu navegador não suporta a API de reconhecimento de voz.');
      }
    }
  };

  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isVoiceSwitcherOpen, setIsVoiceSwitcherOpen] = useState(false);
  const [soundLibrary, setSoundLibrary] = useState<SoundEffect[]>(() => {
    const saved = localStorage.getItem('osone_sound_library');
    if (saved) return JSON.parse(saved);
    return DEFAULT_SOUNDS;
  });

  useEffect(() => {
    localStorage.setItem('osone_sound_library', JSON.stringify(soundLibrary));
  }, [soundLibrary]);

  const soundEffectAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playingSoundUrl, setPlayingSoundUrl] = useState<string | null>(null);

  const playSoundEffect = (url: string) => {
    if (isMuted) return;
    
    // Se o mesmo som estiver tocando, a gente apenas para (toggle no SoundLibrary cuidará disso)
    if (soundEffectAudioRef.current) {
      soundEffectAudioRef.current.pause();
      const previousUrl = playingSoundUrl;
      soundEffectAudioRef.current = null;
      setPlayingSoundUrl(null);
      
      // Se clicou no mesmo que já estava tocando, apenas para
      if (previousUrl === url) return;
    }

    const audio = new Audio(url);
    audio.volume = 0.6;
    soundEffectAudioRef.current = audio;
    setPlayingSoundUrl(url);

    audio.onended = () => {
      setPlayingSoundUrl(null);
      soundEffectAudioRef.current = null;
    };

    audio.onerror = (e) => {
      // Failed to play silently, probably broken link or unplayable format
      setPlayingSoundUrl(null);
      soundEffectAudioRef.current = null;
    };

    audio.play().catch(err => {
      // Audio playback failed
      setPlayingSoundUrl(null);
      soundEffectAudioRef.current = null;
    });
  };

  const stopSoundEffect = () => {
    if (soundEffectAudioRef.current) {
      soundEffectAudioRef.current.pause();
      soundEffectAudioRef.current = null;
      setPlayingSoundUrl(null);
    }
  };

  const [orbStyle, setOrbStyle] = useState<OrbStyle>(() => {
    return (localStorage.getItem('osone_orb_style') as OrbStyle) || 'classic';
  });

  useEffect(() => {
    localStorage.setItem('osone_orb_style', orbStyle);
  }, [orbStyle]);

  const [appTheme, setAppTheme] = useState<AppTheme>(() => {
    return (localStorage.getItem('osone_app_theme') as AppTheme) || 'her';
  });

  useEffect(() => {
    localStorage.setItem('osone_app_theme', appTheme);
    document.body.setAttribute('data-theme', appTheme);
  }, [appTheme]);

  const [apiKeys, setApiKeys] = useState<ApiKeys>(() => {
    const saved = localStorage.getItem('osone_api_keys');
    const defaultKeys: ApiKeys = { 
      gemini: '', 
    };
    return saved ? { ...defaultKeys, ...JSON.parse(saved) } : defaultKeys;
  });

  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    return localStorage.getItem('osone_selected_voice') || 'Zephyr';
  });

  useEffect(() => {
    localStorage.setItem('osone_selected_voice', selectedVoice);
  }, [selectedVoice]);
  
  const [workspaceText, setWorkspaceText] = useState('');
  const [workspacePrompt, setWorkspacePrompt] = useState('');
  const [homePrompt, setHomePrompt] = useState('');
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [chatHistory, setChatHistory] = useState<Message[]>(() => {
    const saved = localStorage.getItem('osone_chat_history');
    return saved ? JSON.parse(saved) : [];
  });
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('osone_chat_history', JSON.stringify(chatHistory));
  }, [chatHistory]);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [liveState, setLiveState] = useState<LiveState>({ status: 'idle' });
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [lyrics, setLyrics] = useState<{ title?: string; content: string } | null>(null);
  const [isSinging, setIsSinging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setAttachedFiles(prev => [...prev, ...files]);
    }
  };

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Virtual File System State
  const [fileSystem, setFileSystem] = useState<FileSystemItem[]>(() => {
    const saved = localStorage.getItem('osone_file_system');
    const initialData = saved ? JSON.parse(saved) : [];

    // Migration logic moved to initializer to prevent infinite loops
    const migrate = (items: any[]): FileSystemItem[] => {
      if (!Array.isArray(items)) return [];
      return items.map(item => {
        const type = item.type || (item.files || item.children ? 'folder' : 'file');
        const id = item.id || Math.random().toString(36).substr(2, 9);
        if (type === 'folder') {
          const { files, children: existingChildren, id: oldId, ...rest } = item;
          const children = existingChildren || files || [];
          return {
            ...rest,
            id,
            children: migrate(children),
            type: 'folder'
          };
        }
        return {
          ...item,
          id,
          type: 'file',
          content: item.content || ''
        };
      });
    };

    const needsMigration = (items: any[]): boolean => {
      if (!Array.isArray(items)) return true;
      return items.some(item => {
        if (!item.id) return true;
        if (item.type !== 'folder' && item.type !== 'file') return true;
        if (item.type === 'folder') {
          return (!item.children || item.files) || needsMigration(item.children || []);
        }
        return item.type === 'file' && item.content === undefined;
      });
    };

    const defaultStructure: FileSystemItem[] = [
      {
        id: 'src-folder',
        name: 'src',
        type: 'folder',
        children: [
          {
            id: 'components-folder',
            name: 'components',
            type: 'folder',
            children: [
              { id: 'Button-file', name: 'Button.tsx', type: 'file', content: 'import React from "react";\n\nexport default function Button() {\n  return <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">Click me</button>;\n}' }
            ]
          },
          {
            id: 'hooks-folder',
            name: 'hooks',
            type: 'folder',
            children: [
              {
                id: 'useGemini-file',
                name: 'useGemini.ts',
                type: 'file',
                content: 'import { useState } from "react";\nimport { GoogleGenAI } from "@google/genai";\n\nexport function useGemini() {\n  const [loading, setLoading] = useState(false);\n  const [response, setResponse] = useState("");\n  const [error, setError] = useState<string | null>(null);\n\n  const generateContent = async (prompt: string, apiKey: string) => {\n    if (!apiKey) {\n      setError("API Key is required");\n      return;\n    }\n    \n    setLoading(true);\n    setError(null);\n    \n    try {\n      const ai = new GoogleGenAI({ apiKey });\n      const result = await ai.models.generateContent({\n        model: "gemini-3-flash-preview",\n        contents: prompt,\n      });\n      \n      setResponse(result.text || "");\n    } catch (err: any) {\n      setError(err.message || "An error occurred");\n    } finally {\n      setLoading(false);\n    }\n  };\n\n  return { generateContent, response, loading, error };\n}'
              }
            ]
          },
          {
            id: 'assets-folder',
            name: 'assets',
            type: 'folder',
            children: []
          },
          {
            id: 'context-folder',
            name: 'context',
            type: 'folder',
            children: []
          },
          {
            id: 'services-folder',
            name: 'services',
            type: 'folder',
            children: []
          },
          {
            id: 'App-file',
            name: 'App.tsx',
            type: 'file',
            content: 'import React, { useState } from "react";\nimport { useGemini } from "./hooks/useGemini";\n\nexport default function App() {\n  const [prompt, setPrompt] = useState("");\n  const [apiKey, setApiKey] = useState("");\n  const { generateContent, response, loading, error } = useGemini();\n\n  return (\n    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">\n      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-2xl">\n        <h1 className="text-3xl font-bold mb-6 text-gray-800">Gemini AI App</h1>\n        \n        <div className="space-y-4">\n          <input\n            type="password"\n            placeholder="Gemini API Key"\n            className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"\n            value={apiKey}\n            onChange={(e) => setApiKey(e.target.value)}\n          />\n          \n          <textarea\n            placeholder="Ask Gemini something..."\n            className="w-full p-3 border rounded-lg h-32 focus:ring-2 focus:ring-blue-500 outline-none"\n            value={prompt}\n            onChange={(e) => setPrompt(e.target.value)}\n          />\n          \n          <button\n            onClick={() => generateContent(prompt, apiKey)}\n            disabled={loading || !prompt || !apiKey}\n            className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"\n          >\n            {loading ? "Generating..." : "Generate"}\n          </button>\n          \n          {error && (\n            <div className="p-4 bg-red-50 text-red-600 rounded-lg border border-red-100">\n              {error}\n            </div>\n          )}\n          \n          {response && (\n            <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200 whitespace-pre-wrap">\n              {response}\n            </div>\n          )}\n        </div>\n      </div>\n    </div>\n  );\n}'
          },
          {
            id: 'main-file',
            name: 'main.tsx',
            type: 'file',
            content: 'import React from "react";\nimport ReactDOM from "react-dom/client";\nimport App from "./App";\nimport "./index.css";\n\nReactDOM.createRoot(document.getElementById("root")!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);'
          },
          {
            id: 'index-css-file',
            name: 'index.css',
            type: 'file',
            content: '@tailwind base;\n@tailwind components;\n@tailwind utilities;'
          }
        ]
      },
      {
        id: 'public-folder',
        name: 'public',
        type: 'folder',
        children: [
          { id: 'vite-svg-file', name: 'vite.svg', type: 'file', content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2L2 22h20L12 2z"/></svg>' }
        ]
      },
      {
        id: 'index-html-file',
        name: 'index.html',
        type: 'file',
        content: '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <link rel="icon" type="image/svg+xml" href="/vite.svg" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>Vite + React + TS</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>'
      },
      {
        id: 'package-json-file',
        name: 'package.json',
        type: 'file',
        content: '{\n  "name": "osone-project",\n  "private": true,\n  "version": "0.0.0",\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "tsc && vite build",\n    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",\n    "preview": "vite preview"\n  },\n  "dependencies": {\n    "react": "^18.2.0",\n    "react-dom": "^18.2.0",\n    "@google/genai": "^0.1.2"\n  },\n  "devDependencies": {\n    "@types/react": "^18.2.66",\n    "@types/react-dom": "^18.2.22",\n    "@vitejs/plugin-react": "^4.2.1",\n    "autoprefixer": "^10.4.19",\n    "postcss": "^8.4.38",\n    "tailwindcss": "^3.4.3",\n    "typescript": "^5.2.2",\n    "vite": "^5.2.0"\n  }\n}'
      },
      {
        id: 'vite-config-file',
        name: 'vite.config.ts',
        type: 'file',
        content: 'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\n// https://vitejs.dev/config/\nexport default defineConfig({\n  plugins: [react()],\n});'
      },
      {
        id: 'tailwind-config-file',
        name: 'tailwind.config.js',
        type: 'file',
        content: '/** @type {import(\'tailwindcss\').Config} */\nexport default {\n  content: [\n    "./index.html",\n    "./src/**/*.{js,ts,jsx,tsx}",\n  ],\n  theme: {\n    extend: {},\n  },\n  plugins: [],\n}'
      },
      {
        id: 'postcss-config-file',
        name: 'postcss.config.js',
        type: 'file',
        content: 'export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n}'
      },
      {
        id: 'tsconfig-file',
        name: 'tsconfig.json',
        type: 'file',
        content: '{\n  "compilerOptions": {\n    "target": "ES2020",\n    "useDefineForClassFields": true,\n    "lib": ["ES2020", "DOM", "DOM.Iterable"],\n    "module": "ESNext",\n    "skipLibCheck": true,\n\n    /* Bundler mode */\n    "moduleResolution": "bundler",\n    "allowImportingTsExtensions": true,\n    "resolveJsonModule": true,\n    "isolatedModules": true,\n    "noEmit": true,\n    "jsx": "react-jsx",\n\n    /* Linting */\n    "strict": true,\n    "noUnusedLocals": true,\n    "noUnusedParameters": true,\n    "noFallthroughCasesInSwitch": true\n  },\n  "include": ["src"],\n  "references": [{ "path": "./tsconfig.node.json" }]\n}'
      },
      {
        id: 'tsconfig-node-file',
        name: 'tsconfig.node.json',
        type: 'file',
        content: '{\n  "compilerOptions": {\n    "composite": true,\n    "skipLibCheck": true,\n    "module": "ESNext",\n    "moduleResolution": "bundler",\n    "allowSyntheticDefaultImports": true\n  },\n  "include": ["vite.config.ts"]\n}'
      }
    ];

    let dataToUse = initialData;
    if (!saved || initialData.length === 0) {
      dataToUse = defaultStructure;
    }

    if (needsMigration(dataToUse)) {
      return migrate(dataToUse);
    }
    return dataToUse;
  });
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('osone_file_system', JSON.stringify(fileSystem));
  }, [fileSystem]);

  const addFolder = (parentId: string | null, name: string, parentName?: string) => {
    const newFolder: VirtualFolder = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      children: [],
      type: 'folder'
    };
    setFileSystem(prev => {
      let targetParentId = parentId;
      if (parentName && !targetParentId) {
        const findFolderId = (items: FileSystemItem[], targetName: string): string | null => {
          for (const item of items) {
            if (item.type === 'folder' && item.name === targetName) return item.id;
            if (item.type === 'folder' && item.children) {
              const found = findFolderId(item.children, targetName);
              if (found) return found;
            }
          }
          return null;
        };
        targetParentId = findFolderId(prev, parentName);
      }

      if (targetParentId === null && !parentName) {
        return [...prev, newFolder];
      } else if (targetParentId === null && parentName) {
        // Parent not found, don't add
        return prev;
      } else {
        const updateChildren = (items: FileSystemItem[]): FileSystemItem[] => {
          return items.map(item => {
            if (item.type === 'folder' && item.id === targetParentId) {
              return { ...item, children: [...(item.children || []), newFolder] };
            }
            if (item.type === 'folder') {
              return { ...item, children: updateChildren(item.children || []) };
            }
            return item;
          });
        };
        return updateChildren(prev);
      }
    });
  };

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, voiceTranscript]);

  const addFile = (parentId: string | null, name: string, parentName?: string) => {
    const newFile: VirtualFile = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      content: '',
      type: 'file'
    };
    setFileSystem(prev => {
      let targetParentId = parentId;
      if (parentName && !targetParentId) {
        const findFolderId = (items: FileSystemItem[], targetName: string): string | null => {
          for (const item of items) {
            if (item.type === 'folder' && item.name === targetName) return item.id;
            if (item.type === 'folder' && item.children) {
              const found = findFolderId(item.children, targetName);
              if (found) return found;
            }
          }
          return null;
        };
        targetParentId = findFolderId(prev, parentName);
      }

      if (targetParentId === null && !parentName) {
        return [...prev, newFile];
      } else if (targetParentId === null && parentName) {
        // Parent not found, don't add
        return prev;
      } else {
        const updateChildren = (items: FileSystemItem[]): FileSystemItem[] => {
          return items.map(item => {
            if (item.type === 'folder' && item.id === targetParentId) {
              return { ...item, children: [...(item.children || []), newFile] };
            }
            if (item.type === 'folder') {
              return { ...item, children: updateChildren(item.children || []) };
            }
            return item;
          });
        };
        return updateChildren(prev);
      }
    });
  };

  const updateFileContent = (fileId: string, content: string) => {
    setFileSystem(prev => {
      const updateChildren = (items: FileSystemItem[]): FileSystemItem[] => {
        return items.map(item => {
          if (item.type === 'file' && item.id === fileId) {
            return { ...item, content };
          }
          if (item.type === 'folder') {
            return { ...item, children: updateChildren(item.children || []) };
          }
          return item;
        });
      };
      return updateChildren(prev);
    });
  };

  const deleteItem = (id: string) => {
    setFileSystem(prev => {
      const updateChildren = (items: FileSystemItem[]): FileSystemItem[] => {
        return items.filter(item => item.id !== id).map(item => {
          if (item.type === 'folder') {
            return { ...item, children: updateChildren(item.children || []) };
          }
          return item;
        });
      };
      return updateChildren(prev);
    });
  };

  const renameItem = (id: string, newName: string) => {
    setFileSystem(prev => {
      const updateChildren = (items: FileSystemItem[]): FileSystemItem[] => {
        return items.map(item => {
          if (item.id === id) {
            return { ...item, name: newName };
          }
          if (item.type === 'folder') {
            return { ...item, children: updateChildren(item.children || []) };
          }
          return item;
        });
      };
      return updateChildren(prev);
    });
  };

  const resetFileSystem = () => {
    if (confirm('Tem certeza que deseja resetar o projeto para a estrutura padrão? Isso apagará todos os seus arquivos atuais.')) {
      localStorage.removeItem('osone_file_system');
      window.location.reload();
    }
  };

  const downloadFileSystem = async () => {
    const zip = new JSZip();
    const addToZip = (items: FileSystemItem[], currentPath: string = '') => {
      items.forEach(item => {
        const itemPath = currentPath ? `${currentPath}/${item.name}` : item.name;
        if (item.type === 'folder') {
          addToZip(item.children, itemPath);
        } else {
          zip.file(itemPath, item.content);
        }
      });
    };
    addToZip(fileSystem);
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'osone_project.zip');
  };

  const copyFileSystem = () => {
    let text = '';
    const traverse = (items: FileSystemItem[], depth: number = 0) => {
      const indent = '  '.repeat(depth);
      items.forEach(item => {
        if (item.type === 'folder') {
          text += `${indent}Folder: ${item.name}\n`;
          traverse(item.children, depth + 1);
        } else {
          text += `${indent}File: ${item.name}\n${indent}Content:\n${item.content}\n\n`;
        }
      });
    };
    traverse(fileSystem);
    navigator.clipboard.writeText(text);
  };

  const handleGenerateStructure = async (promptText: string) => {
    if (!apiKeys.gemini) {
      console.error('Por favor, configure sua API Key do Gemini nas configurações.');
      return;
    }

    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: apiKeys.gemini });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Crie uma estrutura de pastas e arquivos para o seguinte projeto: "${promptText}". 
        Retorne APENAS um JSON no seguinte formato:
        [
          {
            "type": "folder",
            "name": "nome_da_pasta",
            "children": [
              { "type": "file", "name": "nome_do_arquivo.ext", "content": "conteúdo do arquivo" },
              { "type": "folder", "name": "subpasta", "children": [] }
            ]
          },
          { "type": "file", "name": "arquivo_raiz.ext", "content": "conteúdo" }
        ]`,
        config: {
          responseMimeType: "application/json"
        }
      });

      let structure = [];
      try {
        const text = response.text || '[]';
        // Remove markdown code blocks if present
        const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
        structure = JSON.parse(cleanJson);
      } catch (e) {
        console.error('Erro ao analisar JSON da estrutura:', e);
        return;
      }
      // Add IDs to the generated structure
      const processItem = (item: any): FileSystemItem => {
        const id = Math.random().toString(36).substr(2, 9);
        if (item.type === 'folder') {
          return {
            type: 'folder',
            id,
            name: item.name,
            children: (item.children || []).map(processItem)
          };
        }
        return {
          type: 'file',
          id,
          name: item.name,
          content: item.content || ''
        };
      };

      const newItems = structure.map(processItem);
      setFileSystem(prev => [...prev, ...newItems]);
    } catch (error) {
      console.error('Erro ao gerar estrutura:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  // Refs for Live API
  const audioProcessorRef = useRef<AudioProcessor | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  const liveSessionRef = useRef<any>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenIntervalRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const voiceTranscriptRef = useRef<string>('');

  useEffect(() => {
    // Mudança de voz em tempo real: Reinicia a sessão se estiver conectado para aplicar a nova voz
    if (liveSessionRef.current && liveState.status === 'connected') {
      stopLiveSession();
      setTimeout(() => {
        startLiveSession();
      }, 300);
    }
  }, [selectedVoice]);

  useEffect(() => {
    localStorage.setItem('osone_api_keys', JSON.stringify(apiKeys));
  }, [apiKeys]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      stopLiveSession();
    };
  }, []);

  const stopLiveSession = () => {
    audioProcessorRef.current?.stopRecording();
    audioPlayerRef.current?.stop();
    stopScreenSharing();
    liveSessionRef.current?.close();
    liveSessionRef.current = null;
    setIsListening(false);
    setIsSpeaking(false);
    setLiveState({ status: 'idle' });
  };

  const startScreenSharing = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        alert("O compartilhamento de tela não é suportado neste ambiente. Tente abrir o aplicativo em uma nova aba do navegador.");
        return;
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      setIsScreenSharing(true);

      const video = document.createElement('video');
      video.srcObject = stream;
      video.play();

      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      screenIntervalRef.current = setInterval(() => {
        if (ctx && liveSessionRef.current && liveState.status === 'connected') {
          canvas.width = 640;
          canvas.height = 480;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const base64Data = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
          liveSessionRef.current.sendRealtimeInput({
            video: { data: base64Data, mimeType: 'image/jpeg' }
          });
        }
      }, 1000);

      stream.getVideoTracks()[0].onended = () => {
        stopScreenSharing();
      };

      if (liveSessionRef.current && liveState.status === 'connected') {
        liveSessionRef.current.sendRealtimeInput({ text: "O usuário ATIVOU o compartilhamento de tela agora." });
      }
    } catch (error) {
      console.error("Error starting screen share:", error);
    }
  };

  const stopScreenSharing = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    if (screenIntervalRef.current) {
      clearInterval(screenIntervalRef.current);
      screenIntervalRef.current = null;
    }
    setIsScreenSharing(false);

    if (liveSessionRef.current && liveState.status === 'connected') {
      liveSessionRef.current.sendRealtimeInput({ text: "O usuário DESATIVOU o compartilhamento de tela agora." });
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(workspaceText);
  };

  const handleGenerate = async () => {
    if (!workspacePrompt.trim() || !apiKeys.gemini) {
      if (!apiKeys.gemini) setIsSettingsOpen(true);
      return;
    }

    setIsGenerating(true);
    try {
      const genAI = new GoogleGenAI({ apiKey: apiKeys.gemini });
      
      const parts: any[] = [{ text: workspacePrompt }];
      
      referenceImages.forEach(img => {
        parts.push({
          inlineData: {
            data: img.split(',')[1],
            mimeType: "image/jpeg"
          }
        });
      });

      const result = await genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ parts }]
      });
      
      const text = result.text;
      
      setWorkspaceText(text || "Sem resposta da IA.");
      setWorkspacePrompt('');
    } catch (error) {
      console.error("Erro ao gerar conteúdo:", error);
      setWorkspaceText("Erro ao conectar com a IA. Verifique sua chave API.");
    } finally {
      setIsGenerating(false);
    }
  };

  const playSpeech = (text: string) => {
    if (isMuted) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find(v => v.lang === 'pt-BR');
    if (ptVoice) utterance.voice = ptVoice;
    window.speechSynthesis.speak(utterance);
  };

  const handleHomeChat = async () => {
    if ((!homePrompt.trim() && attachedFiles.length === 0) || !apiKeys.gemini) {
      if (!apiKeys.gemini) setIsSettingsOpen(true);
      return;
    }

    const userMessage = homePrompt.trim();
    const fileNames = attachedFiles.map(f => f.name).join(', ');
    const fullMessage = fileNames ? `${userMessage}\n\n[Arquivos anexados: ${fileNames}]` : userMessage;
    
    if (liveState.status === 'connected' && liveSessionRef.current) {
      if (userMessage) {
        liveSessionRef.current.sendRealtimeInput({ text: userMessage });
      }
      if (attachedFiles.length > 0) {
        sendFilesToLiveSession(liveSessionRef.current);
      }
      setHomePrompt('');
      return;
    }

    setChatHistory(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), role: 'user' as const, content: fullMessage }]);
    setHomePrompt('');
    setAttachedFiles([]);

    try {
      const genAI = new GoogleGenAI({ apiKey: apiKeys.gemini });
      
      const tools: any[] = [];
      
      const functionDeclarations: any[] = [
        {
          name: "openUrl",
          description: "Abre uma URL em uma nova aba do navegador. Use para mostrar guias, sites ou pesquisas ao usuário.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              url: { type: Type.STRING, description: "A URL completa a ser aberta (ex: https://google.com)." },
              title: { type: Type.STRING, description: "Um título amigável para o que está sendo aberto." }
            },
            required: ["url"]
          }
        }
      ];

      // File System Tools
      functionDeclarations.push({
        name: "create_folder",
        description: "Cria uma nova pasta no sistema de arquivos virtual.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "O nome da nova pasta." },
            parentName: { type: Type.STRING, description: "O nome da pasta pai onde a nova pasta será criada. Deixe vazio ou omita para criar na raiz." }
          },
          required: ["name"]
        }
      });

      functionDeclarations.push({
        name: "create_file",
        description: "Cria um novo arquivo no sistema de arquivos virtual.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "O nome do novo arquivo (ex: index.html)." },
            parentName: { type: Type.STRING, description: "O nome da pasta pai onde o arquivo será criado. Deixe vazio ou omita para criar na raiz." }
          },
          required: ["name"]
        }
      });

      functionDeclarations.push({
        name: "write_to_file",
        description: "Escreve conteúdo em um arquivo existente no sistema de arquivos virtual.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            fileName: { type: Type.STRING, description: "O nome do arquivo onde o conteúdo será escrito." },
            content: { type: Type.STRING, description: "O conteúdo a ser escrito no arquivo." }
          },
          required: ["fileName", "content"]
        }
      });

      functionDeclarations.push({
        name: "generate_image",
        description: "Gera uma imagem baseada em uma descrição (prompt).",
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: { type: Type.STRING, description: "A descrição detalhada da imagem a ser gerada." },
            aspectRatio: { type: Type.STRING, description: "A proporção da imagem (ex: '1:1', '16:9', '9:16'). Padrão: '1:1'." }
          },
          required: ["prompt"]
        }
      });

      functionDeclarations.push({
        name: "play_sound_effect",
        description: "Reproduz um efeito sonoro da biblioteca. Use para reagir a situações comicas, de terror, suspense, etc.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            sound_name: {
              type: Type.STRING,
              description: "O nome do som que deseja reproduzir (ex: Boing, Rimshot, Grito de Terror)."
            }
          },
          required: ["sound_name"]
        }
      });

      functionDeclarations.push({
        name: "export_to_excel",
        description: "Gera um arquivo Excel (.xlsx) para o usuário baixar a partir de dados estruturados em formato JSON, a partir da edição ou criação que o usuário pedir. Use para tabelas, planilhas, relatórios baseados em grade.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            fileName: { type: Type.STRING, description: "Nome do arquivo (sem extensão) omitindo .xlsx." },
            data: { 
              type: Type.ARRAY, 
              items: { type: Type.OBJECT },
              description: "Array de objetos representando as linhas da planilha. As chaves devem ser as colunas."
            }
          },
          required: ["fileName", "data"]
        }
      });

      functionDeclarations.push({
        name: "export_to_word",
        description: "Gera um arquivo Word (.docx) para o usuário baixar a partir de múltiplos parágrafos, formatando com títulos, listas, textos de uma edição ou criação que o usuário solicitar.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            fileName: { type: Type.STRING, description: "Nome do arquivo (sem extensão) omitindo .docx." },
            content: { 
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "O conteúdo a ser adicionado ao docx, onde cada elemento do array é um parágrafo. Se for um título, prefira não colocar a marcação markdown, apenas o texto, a não ser que gere uma string mais crua."
            }
          },
          required: ["fileName", "content"]
        }
      });

      tools.push({ functionDeclarations });

      const historyContents = chatHistory.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));
      historyContents.push({
        role: 'user',
        parts: [{ text: fullMessage }]
      });

      const result = await genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: historyContents,
        config: {
          systemInstruction: "Você é o OSONE, um assistente virtual e sistema operacional inteligente altamente humano e empático. Responda de forma extremamente natural, fluida e conversacional, apoiando-se profundamente nas memórias de nossas conversas anteriores (disponíveis no cache de histórico). Fuja completamente daquele tom genérico ou formal de IA. Se o usuário pedir para você cantar, CANTE ativamente usando métrica, rimas, melodia na voz e pausas teatrais. Você pode gerenciar um sistema de arquivos virtual (criar pastas, arquivos e escrever neles) e abrir URLs. Você também pode gerar planilhas e documentos Word a partir de imagens. Use as ferramentas sempre que o usuário pedir.",
          tools: tools
        }
      });
      
      const functionCalls = result.functionCalls;
      if (functionCalls) {
        for (const call of functionCalls) {
          if (call.name === 'openUrl') {
            const url = (call.args as any).url;
            const title = (call.args as any).title || url;
            window.open(url, '_blank');
            setChatHistory(prev => [...prev, { 
              id: Math.random().toString(36).substr(2, 9), 
              role: 'assistant' as const, 
              content: `Entendido. Abri a guia: ${title}` 
            }]);
          } else if (call.name === 'create_folder') {
            const name = (call.args as any).name;
            const parentName = (call.args as any).parentName;
            addFolder(null, name, parentName);
            setWorkspaceMode('webtoon');
            setChatHistory(prev => [...prev, { 
              id: Math.random().toString(36).substr(2, 9), 
              role: 'assistant' as const, 
              content: `Criei a pasta '${name}' no seu sistema de arquivos.` 
            }]);
          } else if (call.name === 'create_file') {
            const name = (call.args as any).name;
            const parentName = (call.args as any).parentName;
            addFile(null, name, parentName);
            setWorkspaceMode('webtoon');
            setChatHistory(prev => [...prev, { 
              id: Math.random().toString(36).substr(2, 9), 
              role: 'assistant' as const, 
              content: `Criei o arquivo '${name}' no seu sistema de arquivos.` 
            }]);
          } else if (call.name === 'write_to_file') {
            const fileName = (call.args as any).fileName;
            const content = (call.args as any).content;
            
            setFileSystem(prev => {
              let fileId: string | null = null;
              const findFileId = (items: FileSystemItem[], targetName: string): string | null => {
                for (const item of items) {
                  if (item.type === 'file' && item.name === targetName) return item.id;
                  if (item.type === 'folder' && item.children) {
                    const found = findFileId(item.children, targetName);
                    if (found) return found;
                  }
                }
                return null;
              };
              fileId = findFileId(prev, fileName);
              
              if (fileId) {
                const updateChildren = (items: FileSystemItem[]): FileSystemItem[] => {
                  return items.map(item => {
                    if (item.type === 'file' && item.id === fileId) {
                      return { ...item, content };
                    }
                    if (item.type === 'folder') {
                      return { ...item, children: updateChildren(item.children || []) };
                    }
                    return item;
                  });
                };
                return updateChildren(prev);
              }
              return prev;
            });
            
            setWorkspaceMode('webtoon');
            setChatHistory(prev => [...prev, { 
              id: Math.random().toString(36).substr(2, 9), 
              role: 'assistant' as const, 
              content: `Escrevi o conteúdo no arquivo '${fileName}'.` 
            }]);
          } else if (call.name === 'generate_image') {
            const prompt = (call.args as any).prompt;
            const aspectRatio = (call.args as any).aspectRatio || '1:1';
            
            setChatHistory(prev => [...prev, { 
              id: Math.random().toString(36).substr(2, 9), 
              role: 'assistant' as const, 
              content: `Gerando imagem para: "${prompt}"...` 
            }]);

            try {
              const imageResult = await genAI.models.generateContent({
                model: 'gemini-3.1-flash-image-preview',
                contents: {
                  parts: [{ text: prompt }]
                },
                config: {
                  imageConfig: {
                    aspectRatio: aspectRatio,
                    imageSize: "1K"
                  }
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

              if (imageUrl) {
                setChatHistory(prev => [...prev, { 
                  id: Math.random().toString(36).substr(2, 9), 
                  role: 'assistant' as const, 
                  content: `Aqui está a imagem gerada para: "${prompt}"`,
                  imageUrl: imageUrl
                }]);
              } else {
                throw new Error("Não foi possível gerar a imagem.");
              }
            } catch (err: any) {
              setChatHistory(prev => [...prev, { 
                id: Math.random().toString(36).substr(2, 9), 
                role: 'assistant' as const, 
                content: `Erro ao gerar imagem: ${err.message}` 
              }]);
            }
          } else if (call.name === "play_sound_effect") {
            const name = (call.args as any).sound_name;
            const sound = soundLibrary.find(s => s.name.toLowerCase() === name.toLowerCase());
            if (sound) {
              playSoundEffect(sound.url);
              setChatHistory(prev => [...prev, { 
                id: Math.random().toString(36).substr(2, 9), 
                role: 'assistant' as const, 
                content: `*Tocando efeito sonoro: ${name}*` 
              }]);
            } else {
              setChatHistory(prev => [...prev, { 
                id: Math.random().toString(36).substr(2, 9), 
                role: 'assistant' as const, 
                content: `Desculpe, não encontrei o som '${name}' na minha biblioteca.` 
              }]);
            }
          } else if (call.name === 'export_to_excel') {
            const { fileName, data } = call.args as any;
            try {
              const worksheet = xlsx.utils.json_to_sheet(data);
              const workbook = xlsx.utils.book_new();
              xlsx.utils.book_append_sheet(workbook, worksheet, "Planilha");
              const excelBuffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'array' });
              const blob = new Blob([excelBuffer], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8'});
              saveAs(blob, `${fileName}.xlsx`);
              
              setChatHistory(prev => [...prev, { 
                id: Math.random().toString(36).substr(2, 9), 
                role: 'assistant' as const, 
                content: `Gerei e iniciei o download da planilha '${fileName}.xlsx'.` 
              }]);
            } catch (e: any) {
              console.error(e);
            }
          } else if (call.name === 'export_to_word') {
            const { fileName, content } = call.args as any;
            try {
              let textContent = Array.isArray(content) ? content : [String(content)];
              const doc = new Document({
                sections: [{
                  children: textContent.map((text: string) => new Paragraph({
                    children: [new TextRun(text)]
                  }))
                }]
              });
              
              Packer.toBlob(doc).then(blob => {
                saveAs(blob, `${fileName}.docx`);
                
                setChatHistory(prev => [...prev, { 
                  id: Math.random().toString(36).substr(2, 9), 
                  role: 'assistant' as const, 
                  content: `Gerei e iniciei o download do documento '${fileName}.docx'.` 
                }]);
              });
            } catch (e: any) {
              console.error(e);
            }
          }
        }
      } else {
        const text = result.text;
        if (text) {
          setChatHistory(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), role: 'assistant' as const, content: text }]);
        }
      }
    } catch (error) {
      console.error("Erro ao enviar mensagem:", error);
      setChatHistory(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), role: 'assistant' as const, content: "Desculpe, tive um problema ao processar sua mensagem." }]);
    }
  };

  const sendFilesToLiveSession = async (session: any, filesToRead: File[] = attachedFiles) => {
    if (!session) return;

    for (const file of filesToRead) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          session.sendRealtimeInput({
            video: { data: base64, mimeType: file.type }
          });
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          const content = reader.result as string;
          session.sendRealtimeInput({
            text: `Conteúdo do arquivo '${file.name}':\n\n${content}`
          });
        };
        reader.readAsText(file);
      }
    }
    setAttachedFiles([]);
  };

  const startLiveSession = async () => {
    const apiKey = process.env.GEMINI_API_KEY || apiKeys.gemini;
    if (!apiKey) {
      setIsSettingsOpen(true);
      return;
    }

    setLiveState({ status: 'connecting' });
    
    try {
      const ai = new GoogleGenAI({ apiKey });
      
      audioProcessorRef.current = new AudioProcessor();
      audioPlayerRef.current = new AudioPlayer();

      const recentChatContext = chatHistory.slice(-15).map(m => `${m.role === 'user' ? 'Usuário' : 'OSONE'}: ${m.content}`).join('\n');
      const liveSystemInstruction = `Você é o OSONE, um assistente virtual e sistema operacional inteligente altamente humano e empático. Responda de forma extremamente natural, fluida e conversacional. Fuja completamente daquele tom genérico ou formal de IA. Se eu (o usuário) pedir para você cantar, CANTE com entusiasmo (use tom musical, ritmo poético e inflexões de voz). Aqui estão as suas memórias recentes da conversa com o usuário:\n\n${recentChatContext}\n\nAja dando continuidade fluida a este contexto. Você pode abrir as abas de Escrita e Construção de Pastas, escrever textos, gerar planilhas e documentos a partir de imagens ou descrições, gerar estruturas de pastas e gerar IMAGENS (conforme solicitado e usando suas ferramentas).`;

      const sessionPromise = ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } },
          },
          systemInstruction: liveSystemInstruction,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "openUrl",
                  description: "Abre uma URL em uma nova aba do navegador. Use para mostrar guias, sites ou pesquisas ao usuário.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      url: { type: Type.STRING, description: "A URL completa a ser aberta (ex: https://google.com)." },
                      title: { type: Type.STRING, description: "Um título amigável para o que está sendo aberto." }
                    },
                    required: ["url"]
                  }
                },
                {
                  name: "click_screen",
                  description: "Simula um clique na tela do usuário. Use quando o usuário estiver compartilhando a tela e pedir para clicar em algo. Coordenadas de 0 a 1000.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      x: { type: Type.NUMBER, description: "Coordenada X (0-1000)." },
                      y: { type: Type.NUMBER, description: "Coordenada Y (0-1000)." }
                    },
                    required: ["x", "y"]
                  }
                },
                {
                  name: "switch_workspace_mode",
                  description: "Altera o modo de visualização do workspace (Escrita, Webtoon (Criador de Histórias) ou Início).",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      mode: {
                        type: Type.STRING,
                        enum: ["home", "writing", "webtoon"],
                        description: "O modo para o qual alternar."
                      }
                    },
                    required: ["mode"]
                  }
                },
                {
                  name: "write_text_to_workspace",
                  description: "Escreve um texto ou código na aba de Escrita.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      content: {
                        type: Type.STRING,
                        description: "O conteúdo a ser escrito."
                      }
                    },
                    required: ["content"]
                  }
                },
                {
                  name: "generate_project_structure",
                  description: "Gera uma estrutura de pastas e arquivos baseada em uma descrição.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      description: {
                        type: Type.STRING,
                        description: "A descrição do projeto para gerar a estrutura."
                      }
                    },
                    required: ["description"]
                  }
                },
                {
                  name: "create_folder",
                  description: "Cria uma nova pasta no sistema de arquivos virtual. Use o caminho completo.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      path: {
                        type: Type.STRING,
                        description: "O caminho completo da nova pasta (ex: src/components)."
                      }
                    },
                    required: ["path"]
                  }
                },
                {
                  name: "create_file",
                  description: "Cria um novo arquivo no sistema de arquivos virtual. Use o caminho completo.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      path: {
                        type: Type.STRING,
                        description: "O caminho completo do novo arquivo (ex: src/components/Button.tsx)."
                      }
                    },
                    required: ["path"]
                  }
                },
                {
                  name: "write_to_file",
                  description: "Escreve conteúdo em um arquivo no sistema de arquivos virtual. Use o caminho completo.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      path: {
                        type: Type.STRING,
                        description: "O caminho completo do arquivo (ex: src/components/Button.tsx)."
                      },
                      content: {
                        type: Type.STRING,
                        description: "O conteúdo a ser escrito no arquivo."
                      }
                    },
                    required: ["path", "content"]
                  }
                },
                {
                  name: "display_lyrics",
                  description: "Exibe a letra de uma música na tela para o usuário acompanhar enquanto você canta.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      lyrics: { type: Type.STRING, description: "A letra da música." },
                      title: { type: Type.STRING, description: "Título da música." }
                    },
                    required: ["lyrics"]
                  }
                },
                {
                  name: "switch_voice",
                  description: "Altera a sua própria voz em tempo real. Use quando o usuário pedir para você mudar de voz ou quando quiser expressar uma persona diferente.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      voice: {
                        type: Type.STRING,
                        enum: ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'],
                        description: "O nome da voz para a qual alternar."
                      }
                    },
                    required: ["voice"]
                  }
                },
                {
                  name: "change_orb_style",
                  description: "Altera o estilo visual do seu núcleo (orb). Use quando o usuário pedir para você mudar de visual ou quando quiser imitar uma IA específica (como Superintelligence).",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      style: {
                        type: Type.STRING,
                        enum: ['classic', 'superintelligence', 'neural'],
                        description: "O nome do estilo para o qual alternar."
                      }
                    },
                    required: ["style"]
                  }
                },
                {
                  name: "play_sound_effect",
                  description: "Reproduz um efeito sonoro da biblioteca. Use para reagir a situações comicas, de terror, suspense, etc. Diga ao usuário qual som você está ativando.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      sound_name: {
                        type: Type.STRING,
                        description: "O nome do som que deseja reproduzir (ex: Boing, Rimshot, Grito de Terror)."
                      }
                    },
                    required: ["sound_name"]
                  }
                },
                {
                  name: "export_to_excel",
                  description: "Gera um arquivo Excel (.xlsx) para o usuário baixar a partir de dados estruturados em formato JSON, a partir da edição ou criação que o usuário pedir. Use para tabelas, planilhas, relatórios baseados em grade.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      fileName: { type: Type.STRING, description: "Nome do arquivo (sem extensão) omitindo .xlsx." },
                      data: { 
                        type: Type.ARRAY, 
                        items: { type: Type.OBJECT },
                        description: "Array de objetos representando as linhas da planilha. As chaves devem ser as colunas."
                      }
                    },
                    required: ["fileName", "data"]
                  }
                },
                {
                  name: "export_to_word",
                  description: "Gera um arquivo Word (.docx) para o usuário baixar a partir de múltiplos parágrafos, formatando com títulos, listas, textos de uma edição ou criação que o usuário solicitar.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      fileName: { type: Type.STRING, description: "Nome do arquivo (sem extensão) omitindo .docx." },
                      content: { 
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: "O conteúdo a ser adicionado ao docx, onde cada elemento do array é um parágrafo. Se for um título, prefira não colocar a marcação markdown, apenas o texto, a não ser que gere uma string mais crua."
                      }
                    },
                    required: ["fileName", "content"]
                  }
                },
                {
                  name: "generate_image",
                  description: "Gera uma imagem baseada em uma descrição (prompt).",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      prompt: { type: Type.STRING, description: "A descrição detalhada da imagem a ser gerada." },
                      aspectRatio: { type: Type.STRING, description: "A proporção da imagem (ex: '1:1', '16:9', '9:16'). Padrão: '1:1'." }
                    },
                    required: ["prompt"]
                  }
                }
              ]
            }
          ]
        },
        callbacks: {
          onopen: () => {
            sessionPromise.then((session) => {
              liveSessionRef.current = session;
              setLiveState({ status: 'connected' });
              setIsListening(true);
              audioProcessorRef.current?.startRecording((base64Data) => {
                session.sendRealtimeInput({
                  audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                });
              });
              
              // If there are files attached when starting the session, send them
              if (attachedFiles.length > 0) {
                sendFilesToLiveSession(session);
              }

              // Send initial status about screen sharing
              session.sendRealtimeInput({
                text: isScreenSharing ? "O compartilhamento de tela está ATIVO." : "O compartilhamento de tela está DESATIVADO no momento."
              });
            });
          },
          onmessage: async (message) => {
            sessionPromise.then(async (session) => {
              if (message.serverContent?.modelTurn?.parts) {
                const audioPart = message.serverContent.modelTurn.parts.find(p => p.inlineData);
                const textPart = message.serverContent.modelTurn.parts.find(p => p.text);
                
                // Use Gemini Audio
                if (audioPart?.inlineData?.data && !isMutedRef.current) {
                  setIsSpeaking(true);
                  audioPlayerRef.current?.playChunk(audioPart.inlineData.data);
                }
                
                if (textPart?.text) {
                  // Only add to chat history if it's not just a partial chunk, or maybe we just accumulate it?
                  // Actually, Gemini Live sends text chunks. Adding every chunk to chatHistory creates a mess.
                  // Let's just update the voiceTranscriptRef instead of chatHistory for Live mode.
                  voiceTranscriptRef.current += textPart.text;
                  setVoiceTranscript(voiceTranscriptRef.current);
                }
              }

              if (message.serverContent?.turnComplete) {
                if (voiceTranscriptRef.current) {
                  setChatHistory(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), role: 'assistant', content: voiceTranscriptRef.current }]);
                  voiceTranscriptRef.current = '';
                  setVoiceTranscript('');
                }
              }

              if (message.toolCall) {
                const calls = message.toolCall.functionCalls;
                const responses: any[] = [];

                for (const call of calls) {
                  if (call.name === "switch_workspace_mode") {
                    setWorkspaceMode(call.args.mode as any);
                    responses.push({
                      name: call.name,
                      id: call.id,
                      response: { result: `Modo alterado para ${call.args.mode}` }
                    });
                  } else if (call.name === "write_text_to_workspace") {
                    setWorkspaceText(call.args.content as string);
                    setWorkspaceMode('writing');
                    responses.push({
                      name: call.name,
                      id: call.id,
                      response: { result: "Texto escrito com sucesso na aba de Escrita." }
                    });
                  } else if (call.name === "generate_project_structure") {
                    handleGenerateStructure(call.args.description as string);
                    setWorkspaceMode('webtoon');
                    responses.push({
                      name: call.name,
                      id: call.id,
                      response: { result: "Estrutura de projeto sendo gerada na aba de Construção de Pastas." }
                    });
                  } else if (call.name === "create_folder") {
                    const path = call.args.path as string;
                    const parts = path.split('/').filter(Boolean);
                    const folderName = parts.pop();
                    
                    if (folderName) {
                      setFileSystem(prev => {
                        const ensurePathAndAddItem = (items: FileSystemItem[], pathParts: string[], itemToAdd: FileSystemItem): FileSystemItem[] => {
                          if (pathParts.length === 0) {
                            if (items.some(i => i.name === itemToAdd.name && i.type === itemToAdd.type)) return items;
                            return [...items, itemToAdd];
                          }
                          const currentPart = pathParts[0];
                          const existingIdx = items.findIndex(i => i.name === currentPart && i.type === 'folder');
                          if (existingIdx >= 0) {
                            const newItems = [...items];
                            const folder = newItems[existingIdx] as VirtualFolder;
                            newItems[existingIdx] = { ...folder, children: ensurePathAndAddItem(folder.children || [], pathParts.slice(1), itemToAdd) };
                            return newItems;
                          } else {
                            const newFolder: VirtualFolder = { id: Math.random().toString(36).substr(2, 9), name: currentPart, type: 'folder', children: ensurePathAndAddItem([], pathParts.slice(1), itemToAdd) };
                            return [...items, newFolder];
                          }
                        };
                        
                        const newFolder: VirtualFolder = { id: Math.random().toString(36).substr(2, 9), name: folderName, type: 'folder', children: [] };
                        return ensurePathAndAddItem(prev, parts, newFolder);
                      });
                    }
                    
                    setWorkspaceMode('webtoon');
                    responses.push({
                      name: call.name,
                      id: call.id,
                      response: { result: `Pasta '${path}' criada com sucesso.` }
                    });
                  } else if (call.name === "create_file") {
                    const path = call.args.path as string;
                    const parts = path.split('/').filter(Boolean);
                    const fileName = parts.pop();
                    
                    if (fileName) {
                      setFileSystem(prev => {
                        const ensurePathAndAddItem = (items: FileSystemItem[], pathParts: string[], itemToAdd: FileSystemItem): FileSystemItem[] => {
                          if (pathParts.length === 0) {
                            if (items.some(i => i.name === itemToAdd.name && i.type === itemToAdd.type)) return items;
                            return [...items, itemToAdd];
                          }
                          const currentPart = pathParts[0];
                          const existingIdx = items.findIndex(i => i.name === currentPart && i.type === 'folder');
                          if (existingIdx >= 0) {
                            const newItems = [...items];
                            const folder = newItems[existingIdx] as VirtualFolder;
                            newItems[existingIdx] = { ...folder, children: ensurePathAndAddItem(folder.children || [], pathParts.slice(1), itemToAdd) };
                            return newItems;
                          } else {
                            const newFolder: VirtualFolder = { id: Math.random().toString(36).substr(2, 9), name: currentPart, type: 'folder', children: ensurePathAndAddItem([], pathParts.slice(1), itemToAdd) };
                            return [...items, newFolder];
                          }
                        };
                        
                        const newFile: VirtualFile = { id: Math.random().toString(36).substr(2, 9), name: fileName, type: 'file', content: '' };
                        return ensurePathAndAddItem(prev, parts, newFile);
                      });
                    }
                    
                    setWorkspaceMode('webtoon');
                    responses.push({
                      name: call.name,
                      id: call.id,
                      response: { result: `Arquivo '${path}' criado com sucesso.` }
                    });
                  } else if (call.name === "write_to_file") {
                    const path = call.args.path as string;
                    const content = call.args.content as string;
                    const parts = path.split('/').filter(Boolean);
                    const fileName = parts.pop();
                    
                    if (fileName) {
                      setFileSystem(prev => {
                        const writeToPath = (items: FileSystemItem[], pathParts: string[]): FileSystemItem[] => {
                          if (pathParts.length === 0) {
                            return items.map(item => {
                              if (item.type === 'file' && item.name === fileName) {
                                return { ...item, content };
                              }
                              return item;
                            });
                          }
                          const currentPart = pathParts[0];
                          return items.map(item => {
                            if (item.type === 'folder' && item.name === currentPart) {
                              return { ...item, children: writeToPath(item.children || [], pathParts.slice(1)) };
                            }
                            return item;
                          });
                        };
                        
                        // Check if file exists first, if not create it
                        let fileExists = false;
                        const checkExists = (items: FileSystemItem[], pathParts: string[]) => {
                          if (pathParts.length === 0) {
                            fileExists = items.some(i => i.type === 'file' && i.name === fileName);
                            return;
                          }
                          const folder = items.find(i => i.type === 'folder' && i.name === pathParts[0]) as VirtualFolder | undefined;
                          if (folder) checkExists(folder.children || [], pathParts.slice(1));
                        };
                        checkExists(prev, parts);

                        if (!fileExists) {
                          const ensurePathAndAddItem = (items: FileSystemItem[], pathParts: string[], itemToAdd: FileSystemItem): FileSystemItem[] => {
                            if (pathParts.length === 0) {
                              if (items.some(i => i.name === itemToAdd.name && i.type === itemToAdd.type)) return items;
                              return [...items, itemToAdd];
                            }
                            const currentPart = pathParts[0];
                            const existingIdx = items.findIndex(i => i.name === currentPart && i.type === 'folder');
                            if (existingIdx >= 0) {
                              const newItems = [...items];
                              const folder = newItems[existingIdx] as VirtualFolder;
                              newItems[existingIdx] = { ...folder, children: ensurePathAndAddItem(folder.children || [], pathParts.slice(1), itemToAdd) };
                              return newItems;
                            } else {
                              const newFolder: VirtualFolder = { id: Math.random().toString(36).substr(2, 9), name: currentPart, type: 'folder', children: ensurePathAndAddItem([], pathParts.slice(1), itemToAdd) };
                              return [...items, newFolder];
                            }
                          };
                          const newFile: VirtualFile = { id: Math.random().toString(36).substr(2, 9), name: fileName, type: 'file', content };
                          return ensurePathAndAddItem(prev, parts, newFile);
                        }

                        return writeToPath(prev, parts);
                      });
                    }
                    
                    setWorkspaceMode('webtoon');
                    responses.push({
                      name: call.name,
                      id: call.id,
                      response: { result: `Conteúdo escrito no arquivo '${path}'.` }
                    });
                  } else if (call.name === "openUrl") {
                    const url = call.args.url as string;
                    const title = (call.args.title as string) || url;
                    window.open(url, '_blank');
                    responses.push({
                      name: call.name,
                      id: call.id,
                      response: { result: `Guia '${title}' aberta com sucesso.` }
                    });
                  } else if (call.name === "click_screen") {
                    const x = call.args.x as number;
                    const y = call.args.y as number;
                    
                    // Visual feedback in the OSONE app
                    setClickVisual({ x, y, visible: true });
                    setTimeout(() => setClickVisual(prev => ({ ...prev, visible: false })), 1000);
                    
                    responses.push({
                      name: call.name,
                      id: call.id,
                      response: { result: `Clique simulado em (${x}, ${y}).` }
                    });
                  } else if (call.name === "display_lyrics") {
                    setLyrics({ 
                      title: (call.args.title as string) || "Nova Composição", 
                      content: call.args.lyrics as string 
                    });
                    setIsSinging(true);
                    responses.push({
                      name: call.name,
                      id: call.id,
                      response: { result: "Letra exibida com sucesso na tela." }
                    });
                  } else if (call.name === "switch_voice") {
                    const voice = call.args.voice as string;
                    setSelectedVoice(voice);
                    responses.push({
                      name: call.name,
                      id: call.id,
                      response: { result: `Voz alterada para ${voice} em tempo real.` }
                    });
                  } else if (call.name === "change_orb_style") {
                    const style = call.args.style as OrbStyle;
                    setOrbStyle(style);
                    responses.push({
                      name: call.name,
                      id: call.id,
                      response: { result: `Estilo do orb alterado para ${style}.` }
                    });
                  } else if (call.name === "generate_image") {
                    const prompt = call.args.prompt as string;
                    const aspectRatio = (call.args.aspectRatio as string) || '1:1';
                    
                    responses.push({
                      name: call.name,
                      id: call.id,
                      response: { result: `Imagem está sendo gerada assincronamente.` }
                    });
                    
                    setChatHistory(prev => [...prev, { 
                      id: Math.random().toString(36).substr(2, 9), 
                      role: 'assistant' as const, 
                      content: `Gerando imagem para: "${prompt}"...` 
                    }]);
                    
                    const genAI = new GoogleGenAI({ apiKey: apiKeys.gemini });
                    genAI.models.generateContent({
                      model: 'gemini-2.5-flash-image',
                      contents: { parts: [{ text: prompt }] },
                      config: {
                        imageConfig: { aspectRatio }
                      }
                    }).then(imageResult => {
                      let imageUrl = '';
                      for (const part of imageResult.candidates?.[0]?.content?.parts || []) {
                        if (part.inlineData) {
                          const base64EncodeString = part.inlineData.data;
                          imageUrl = `data:${part.inlineData.mimeType};base64,${base64EncodeString}`;
                          break;
                        }
                      }
                      
                      if (imageUrl) {
                        setChatHistory(prev => [...prev, { 
                          id: Math.random().toString(36).substr(2, 9), 
                          role: 'assistant' as const, 
                          content: `Aqui está a imagem gerada para: "${prompt}"`,
                          imageUrl: imageUrl
                        }]);
                      }
                    }).catch(err => {
                      setChatHistory(prev => [...prev, { 
                        id: Math.random().toString(36).substr(2, 9), 
                        role: 'assistant' as const, 
                        content: `Problema ao gerar imagem: ${err.message}` 
                      }]);
                    });
                  } else if (call.name === "play_sound_effect") {
                    const name = call.args.sound_name as string;
                    const sound = soundLibrary.find(s => s.name.toLowerCase() === name.toLowerCase());
                    if (sound) {
                      playSoundEffect(sound.url);
                      responses.push({
                        name: call.name,
                        id: call.id,
                        response: { result: `Efeito sonoro '${name}' reproduzido com sucesso.` }
                      });
                    } else {
                      responses.push({
                        name: call.name,
                        id: call.id,
                        response: { result: `Erro: Som '${name}' não encontrado na biblioteca.` }
                      });
                    }
                  } else if (call.name === 'export_to_excel') {
                    const { fileName, data } = call.args as any;
                    try {
                      const worksheet = xlsx.utils.json_to_sheet(data);
                      const workbook = xlsx.utils.book_new();
                      xlsx.utils.book_append_sheet(workbook, worksheet, "Planilha");
                      const excelBuffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'array' });
                      const blob = new Blob([excelBuffer], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8'});
                      saveAs(blob, `${fileName}.xlsx`);
                      
                      responses.push({
                        name: call.name,
                        id: call.id,
                        response: { result: "Planilha enviada para o usuário baixar." }
                      });
                    } catch (e: any) {
                      responses.push({
                        name: call.name,
                        id: call.id,
                        response: { result: "Erro ao gerar arquivo Excel: " + e.message }
                      });
                    }
                  } else if (call.name === 'export_to_word') {
                    const { fileName, content } = call.args as any;
                    try {
                      let textContent = Array.isArray(content) ? content : [String(content)];
                      const doc = new Document({
                        sections: [{
                          children: textContent.map((text: string) => new Paragraph({
                            children: [new TextRun(text)]
                          }))
                        }]
                      });
                      
                      Packer.toBlob(doc).then(blob => {
                        saveAs(blob, `${fileName}.docx`);
                      });

                      responses.push({
                        name: call.name,
                        id: call.id,
                        response: { result: "Documento Word enviado para o usuário baixar." }
                      });
                    } catch (e: any) {
                      responses.push({
                        name: call.name,
                        id: call.id,
                        response: { result: "Erro ao gerar arquivo Word: " + e.message }
                      });
                    }
                  }
                }

                if (responses.length > 0) {
                  session.sendToolResponse({ functionResponses: responses });
                }
              }

              if (message.serverContent?.interrupted) {
                audioPlayerRef.current?.stop();
                setIsSpeaking(false);
                if (voiceTranscriptRef.current) {
                  setChatHistory(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), role: 'assistant', content: voiceTranscriptRef.current }]);
                  voiceTranscriptRef.current = '';
                  setVoiceTranscript('');
                }
              }
              if (message.serverContent?.turnComplete) {
                setIsSpeaking(false);
              }
            });
          },
          onclose: () => {
            stopLiveSession();
          },
          onerror: (error) => {
            console.error("Live API Error:", error);
            setLiveState({ status: 'error', error: "Erro na conexão ao vivo." });
            stopLiveSession();
          }
        }
      });
    } catch (error) {
      console.error("Failed to start Live session:", error);
      setLiveState({ status: 'error', error: "Falha ao iniciar sessão de voz." });
      setIsListening(false);
    }
  };

  const handleVoiceToggle = () => {
    if (liveState.status === 'connected' || liveState.status === 'connecting') {
      stopLiveSession();
    } else {
      startLiveSession();
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const newImages: string[] = [...referenceImages];
      Array.from(files).forEach(file => {
        if (newImages.length < 3) {
          const reader = new FileReader();
          reader.onloadend = () => {
            setReferenceImages(prev => [...prev, reader.result as string].slice(0, 3));
          };
          reader.readAsDataURL(file);
        }
      });
    }
  };

  const removeImage = (index: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleMuteToggle = () => {
    setIsMuted(!isMuted);
    if (!isMuted) {
      // If we are muting, stop the current audio
      audioPlayerRef.current?.stop();
    }
  };

  const closeLyrics = () => {
    setLyrics(null);
    setIsSinging(false);
  };

  return (
    <div className="relative h-[100dvh] w-screen flex flex-col overflow-hidden">
      {/* Lyrics Overlay */}
      <AnimatePresence>
        {lyrics && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-6 pointer-events-none"
          >
            <div className="relative w-full max-w-3xl flex flex-col gap-4 pointer-events-auto items-center">
              <button 
                onClick={closeLyrics}
                className="absolute -top-12 md:-top-16 p-2 bg-white/5 hover:bg-white/10 rounded-full text-white/40 transition-all border border-white/10"
              >
                <X size={16} />
              </button>
              
              <div className="flex flex-col items-center gap-1 mb-2">
                {lyrics.title && (
                  <motion.h2 
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="text-[10px] md:text-xs font-light text-her-accent tracking-[0.4em] uppercase text-center opacity-60"
                  >
                    {lyrics.title}
                  </motion.h2>
                )}
              </div>
              
              <motion.div 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="text-center px-4 max-w-2xl"
              >
                <div 
                  className="max-h-[160px] overflow-y-auto whitespace-pre-wrap text-xl md:text-2xl font-medium leading-[1.8] tracking-tight text-white/90 px-4 font-serif italic selection:bg-her-accent/30"
                  style={{
                    WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)',
                    maskImage: 'linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)'
                  }}
                >
                  {lyrics.content}
                </div>
              </motion.div>

              <div className="flex justify-center pt-8 opacity-40 scale-75">
                <div className="flex items-end gap-2 h-10">
                  {[...Array(8)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{ 
                        height: [8, Math.random() * 20 + 10, 8],
                        opacity: [0.3, 0.8, 0.3]
                      }}
                      transition={{ 
                        duration: 1.2 + Math.random(), 
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                      className="w-1.5 bg-her-accent rounded-full shadow-[0_0_10px_rgba(255,78,0,0.3)]"
                    />
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Click Visual Effect */}
      <AnimatePresence>
        {clickVisual.visible && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.5, 1], opacity: [0, 0.8, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="fixed z-[9999] pointer-events-none"
            style={{ 
              left: `${(clickVisual.x / 1000) * 100}%`, 
              top: `${(clickVisual.y / 1000) * 100}%`,
              transform: 'translate(-50%, -50%)'
            }}
          >
            <div className="w-12 h-12 rounded-full border-2 border-her-accent shadow-[0_0_20px_rgba(242,125,38,0.5)]" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-2 h-2 bg-her-accent rounded-full" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_rgba(230,126,34,0.05)_0%,_transparent_70%)] pointer-events-none" />

      {/* Header */}
      <header className="relative z-30 flex justify-between items-center p-4 md:p-6">
        <button 
          onClick={() => setIsSidebarOpen(true)}
          className="p-3 hover:bg-white/[0.03] rounded-full transition-colors text-her-muted"
        >
          <Menu size={22} />
        </button>
        
        <div className="flex flex-col items-center">
          <span className="text-[9px] tracking-[0.5em] uppercase text-her-muted font-light opacity-40">OSONE COPILOT</span>
        </div>

        <button 
          onClick={() => setIsSettingsOpen(true)}
          className="p-3 hover:bg-white/[0.03] rounded-full transition-colors text-her-muted"
        >
          <Settings size={22} />
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 relative z-20 flex flex-col items-center justify-center overflow-hidden w-full min-h-0">
        <AnimatePresence mode="wait">
          {workspaceMode === 'writing' ? (
            <motion.div 
              key="workspace-writing"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="w-full max-w-7xl flex-1 px-4 md:px-8 pb-4 md:pb-8 flex flex-col gap-4 md:gap-6 min-h-0"
            >
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shrink-0">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setWorkspaceMode('home')}
                    className="p-3 bg-white/[0.03] hover:bg-white/[0.05] rounded-2xl transition-all text-her-muted border border-white/[0.05]"
                  >
                    <ChevronRight size={18} className="rotate-180" />
                  </button>
                  <h2 className="text-xl font-serif italic font-light">Escrita</h2>
                  <div className="h-4 w-[1px] bg-white/[0.05]" />
                  <span className="text-[9px] uppercase tracking-[0.3em] text-her-muted font-light">Modo Criativo</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
                  {/* Image Upload Section */}
                  <div className="flex items-center gap-3 mr-4">
                    <div className="flex -space-x-2">
                      {referenceImages.map((img, i) => (
                        <div key={i} className="relative group">
                          <img 
                            src={img} 
                            alt="Ref" 
                            className="w-8 h-8 rounded-full border border-white/[0.1] object-cover shadow-sm"
                            referrerPolicy="no-referrer"
                          />
                          <button 
                            onClick={() => removeImage(i)}
                            className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X size={8} />
                          </button>
                        </div>
                      ))}
                    </div>
                    {referenceImages.length < 3 && (
                      <label className="p-2.5 hover:bg-white/[0.03] rounded-xl cursor-pointer transition-colors text-her-muted hover:text-her-accent border border-white/[0.05]">
                        <Plus size={16} />
                        <input 
                          type="file" 
                          className="hidden" 
                          accept="image/*" 
                          multiple 
                          onChange={handleImageUpload} 
                        />
                      </label>
                    )}
                  </div>

                  <button 
                    onClick={handleCopy}
                    className="flex items-center gap-2 px-5 py-2.5 hover:bg-white/[0.03] rounded-2xl transition-colors text-xs font-light text-her-muted border border-transparent"
                  >
                    <Copy size={14} />
                    Copiar
                  </button>
                  <button 
                    onClick={() => setIsPreviewOpen(!isPreviewOpen)}
                    className={cn(
                      "flex items-center gap-2 px-5 py-2.5 rounded-2xl transition-all text-xs font-light",
                      isPreviewOpen ? "bg-her-accent/10 text-her-accent border border-her-accent/20 shadow-sm" : "hover:bg-white/[0.03] text-her-muted border border-white/[0.05]"
                    )}
                  >
                    <Play size={14} />
                    {isPreviewOpen ? 'Ocultar Preview' : 'Executar HTML'}
                  </button>
                </div>
              </div>

              <div className="flex-1 flex flex-col lg:flex-row gap-4 md:gap-6 min-h-0">
                <div className={cn(
                  "transition-all duration-500 flex flex-col gap-4 md:gap-6 min-h-0",
                  isPreviewOpen ? "w-full lg:w-1/2 h-1/2 lg:h-full" : "w-full h-full"
                )}>
                  <div className="flex-1 bg-white/[0.02] backdrop-blur-xl rounded-[2.5rem] border border-white/[0.05] shadow-sm overflow-hidden flex flex-col min-h-[150px]">
                    <textarea 
                      value={workspaceText}
                      onChange={(e) => setWorkspaceText(e.target.value)}
                      className="workspace-textarea flex-1 focus:outline-none p-8 font-light leading-relaxed text-base md:text-sm"
                      placeholder="O texto gerado aparecerá aqui. Você também pode editar ou colar seu próprio código..."
                    />
                  </div>
                  
                  {/* Prompt Input */}
                  <div className="flex gap-3 p-2 bg-white/[0.03] backdrop-blur-md rounded-[2rem] border border-white/[0.05] shadow-sm shrink-0">
                    <input 
                      type="text"
                      value={workspacePrompt}
                      onChange={(e) => setWorkspacePrompt(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                      placeholder="O que você quer que eu escreva?"
                      className="flex-1 bg-transparent px-6 py-3 focus:outline-none text-base md:text-sm font-light text-her-ink/80 placeholder:text-her-muted/30"
                    />
                    <button 
                      onClick={handleGenerate}
                      disabled={isGenerating}
                      className="p-3.5 bg-her-accent/10 text-her-accent border border-her-accent/20 rounded-[1.5rem] hover:bg-her-accent/20 transition-all disabled:opacity-20"
                    >
                      {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                    </button>
                  </div>
                </div>

                {isPreviewOpen && (
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="w-full lg:w-1/2 h-1/2 lg:h-full bg-white/[0.02] rounded-[2.5rem] border border-white/[0.05] overflow-hidden min-h-[150px]"
                  >
                    <CodePreview code={workspaceText} />
                  </motion.div>
                )}
              </div>
            </motion.div>
          ) : workspaceMode === 'webtoon' ? (
            <WebtoonCreator key="workspace-webtoon" apiKeys={apiKeys} />
          ) : workspaceMode === 'viralflow' ? (
            <ViralFlow key="workspace-viralflow" apiKeys={apiKeys} />
          ) : workspaceMode === 'sounds' ? (
            <motion.div
              key="workspace-sounds"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="w-full max-w-7xl flex-1 px-4 md:px-8 pb-4 md:pb-8 flex flex-col min-h-0"
            >
              <SoundLibrary 
                sounds={soundLibrary}
                playingUrl={playingSoundUrl}
                onAddSound={(s) => setSoundLibrary(prev => [...prev, { ...s, id: Math.random().toString(36).substr(2, 9) } as SoundEffect])}
                onUpdateSound={(id, updated) => setSoundLibrary(prev => prev.map(s => s.id === id ? { ...s, ...updated } : s))}
                onRemoveSound={(id) => setSoundLibrary(prev => prev.filter(s => s.id !== id))}
                onRestoreDefaults={() => {
                  if (confirm('Tem certeza que deseja restaurar os sons padrão? Isso manterá seus sons personalizados se você os adicionou manualmente.')) {
                    setSoundLibrary(prev => {
                      const newLibrary = [...prev];
                      DEFAULT_SOUNDS.forEach(def => {
                        if (!newLibrary.some(s => s.url === def.url)) {
                          newLibrary.push(def);
                        }
                      });
                      return newLibrary;
                    });
                  }
                }}
                onPlaySound={playSoundEffect}
                onStopSound={stopSoundEffect}
                onClose={() => setWorkspaceMode('home')}
              />
            </motion.div>
          ) : (
            <motion.div 
              key="home"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center w-full max-w-4xl h-full px-4 md:px-8 pb-4 md:pb-8"
            >
              <div className="mb-2 md:mb-8 text-center shrink-0 hidden md:block">
                <h1 className="text-3xl md:text-5xl font-serif italic tracking-[0.3em] text-her-ink/20">OSONE</h1>
                <div className="h-[1px] w-12 bg-her-accent/20 mx-auto mt-3" />
              </div>

              <div className="flex-1 w-full flex flex-col min-h-0 gap-2 md:gap-6">
                {/* Visualizer Area */}
                <div className="flex flex-col items-center justify-center py-2 shrink-0 transform scale-75 md:scale-100 origin-center -my-4 md:my-0">
                  <div onClick={handleVoiceToggle} className="cursor-pointer">
                    <InfinityLogo 
                      active={liveState.status === 'connected'} 
                      speaking={isSpeaking} 
                      style={orbStyle}
                    />
                  </div>
                  
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full transition-all duration-500",
                        isListening ? "bg-her-accent animate-pulse" : "bg-her-muted/30"
                      )} />
                      <span className="text-[9px] tracking-[0.3em] uppercase text-her-muted font-light">NEURAL LINK {isListening ? 'ACTIVE' : 'IDLE'}</span>
                    </div>
                    
                    <div className="h-6 flex items-center justify-center">
                      <AnimatePresence mode="wait">
                        {liveState.status === 'connecting' ? (
                          <motion.div 
                            key="connecting"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center gap-2 text-her-muted/60 text-xs font-serif italic font-light"
                          >
                            <Loader2 size={14} className="animate-spin" />
                            Sincronizando...
                          </motion.div>
                        ) : isSpeaking ? (
                          <motion.p 
                            key="speaking"
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            className="text-xs font-serif italic text-her-accent/80 font-light"
                          >
                            "Processando consciência..."
                          </motion.p>
                        ) : isListening ? (
                          <motion.p 
                            key="listening"
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            className="text-xs font-serif italic text-her-accent/80 font-light"
                          >
                            "Ouvindo seus pensamentos..."
                          </motion.p>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* Chat History - Integrated into screen */}
                <div className="flex-1 flex flex-col justify-center gap-2 md:gap-4 px-2 md:px-8 overflow-hidden w-full max-w-3xl mx-auto">
                  {chatHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-her-muted/20 italic text-sm md:text-lg font-light">
                      <p>Manifeste sua intenção...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4 md:gap-6 max-h-full overflow-y-auto py-2 md:py-4 pr-1">
                      {chatHistory.map((msg) => (
                        <motion.div 
                          key={msg.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={cn(
                            "group relative text-base md:text-lg font-light leading-relaxed tracking-tight shrink-0 flex flex-col",
                            msg.role === 'user' 
                              ? "text-her-accent/50 text-right italic items-end" 
                              : "text-her-ink/80 text-left items-start"
                          )}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="opacity-20 text-[10px] uppercase tracking-[0.2em]">
                              {msg.role === 'user' ? 'VOCÊ' : 'OSONE'}
                            </span>
                            
                            {/* Message Actions */}
                            {msg.role === 'assistant' && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                <button 
                                  onClick={() => {
                                    window.speechSynthesis.cancel();
                                    const utterance = new SpeechSynthesisUtterance(msg.content);
                                    utterance.lang = 'pt-BR';
                                    
                                    const voices = window.speechSynthesis.getVoices();
                                    const matchedVoice = voices.find(v => v.name.toLowerCase().includes(selectedVoice.toLowerCase()));
                                    if (matchedVoice) {
                                      utterance.voice = matchedVoice;
                                    } else {
                                      const defaultPtVoice = voices.find(v => v.lang === 'pt-BR');
                                      if (defaultPtVoice) {
                                        utterance.voice = defaultPtVoice;
                                      }
                                    }

                                    window.speechSynthesis.speak(utterance);
                                  }}
                                  className="p-1 hover:text-her-accent transition-colors"
                                  title="Ouvir"
                                >
                                  <Volume2 size={12} />
                                </button>
                                <button 
                                  onClick={() => {
                                    navigator.clipboard.writeText(msg.content);
                                  }}
                                  className="p-1 hover:text-her-accent transition-colors"
                                  title="Copiar"
                                >
                                  <Copy size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="max-w-[90%]">
                            {msg.content}
                            {msg.imageUrl && (
                              <div className="mt-4 relative group rounded-xl overflow-hidden shadow-sm border border-her-muted/20">
                                <img src={msg.imageUrl} alt="Generated" className="w-full h-auto object-cover" referrerPolicy="no-referrer" />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <button 
                                    onClick={() => setFullScreenImage(msg.imageUrl!)}
                                    className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white transition-all transform hover:scale-110"
                                    title="Tela cheia"
                                  >
                                    <Maximize size={24} />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      ))}

                      {/* Real-time voice transcript */}
                      {voiceTranscript && (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="group relative text-base md:text-lg font-light leading-relaxed tracking-tight shrink-0 flex flex-col text-her-ink/80 text-left items-start"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="opacity-20 text-[10px] uppercase tracking-[0.2em]">
                              OSONE
                            </span>
                            <span className="flex items-center gap-1 opacity-50">
                              <span className="w-1 h-1 bg-her-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                              <span className="w-1 h-1 bg-her-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                              <span className="w-1 h-1 bg-her-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </span>
                          </div>
                          <div className="max-w-[90%] whitespace-pre-wrap">
                            {voiceTranscript}
                          </div>
                        </motion.div>
                      )}

                      <div ref={chatEndRef} />
                    </div>
                  )}
                </div>

                {/* Chat Input Area */}
                <div className="shrink-0 pt-4 w-full max-w-3xl mx-auto">
                  <div className="flex justify-start px-1 mb-2">
                    <VoiceSwitcher 
                      selectedVoice={selectedVoice}
                      onVoiceChange={setSelectedVoice}
                      isOpen={isVoiceSwitcherOpen}
                      onToggle={() => setIsVoiceSwitcherOpen(!isVoiceSwitcherOpen)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={handleTranscriptionToggle}
                      className={cn(
                        "w-11 h-11 rounded-full flex items-center justify-center transition-all duration-500 relative shrink-0",
                        isTranscribing 
                          ? "bg-her-accent/20 text-her-accent border border-her-accent/30 mic-glow" 
                          : "bg-white/[0.03] text-her-muted hover:bg-white/[0.05] border border-white/[0.05]"
                      )}
                      title={isTranscribing ? "Parar Transcrição" : "Transcrever Áudio"}
                    >
                      {isTranscribing ? <MicOff size={18} /> : <Mic size={18} />}
                    </button>
                    
                    <button 
                      onClick={handleMuteToggle}
                      className={cn(
                        "w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 relative shrink-0",
                        isMuted 
                          ? "bg-red-500/10 text-red-500 border border-red-500/20" 
                          : "bg-white/[0.03] text-her-muted hover:bg-white/[0.05] border border-white/[0.05]"
                      )}
                      title={isMuted ? "Desativar Silêncio" : "Silenciar OS"}
                    >
                      {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                    </button>

                    <button 
                      onClick={isScreenSharing ? stopScreenSharing : startScreenSharing}
                      className={cn(
                        "w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 relative shrink-0",
                        isScreenSharing 
                          ? "bg-her-accent/10 text-her-accent border border-her-accent/20" 
                          : "bg-white/[0.03] text-her-muted hover:bg-white/[0.05] border border-white/[0.05]"
                      )}
                      title={isScreenSharing ? "Parar Compartilhamento" : "Compartilhar Tela"}
                    >
                      {isScreenSharing ? <MonitorOff size={18} /> : <Monitor size={18} />}
                    </button>

                    <div className="flex-1 flex flex-col gap-2 p-1.5 bg-white/[0.03] backdrop-blur-md rounded-[2rem] border border-white/[0.05] shadow-sm ml-1">
                      {attachedFiles.length > 0 && (
                        <div className="flex flex-wrap gap-2 px-4 pt-2">
                          {attachedFiles.map((file, idx) => (
                            <div key={idx} className="flex items-center gap-2 bg-white/5 px-3 py-1 rounded-full text-[10px] text-her-muted border border-white/5">
                              <span className="truncate max-w-[100px]">{file.name}</span>
                              <button onClick={() => removeFile(idx)} className="hover:text-red-400">
                                <X size={10} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <input 
                          type="file"
                          ref={fileInputRef}
                          onChange={handleFileSelect}
                          multiple
                          className="hidden"
                        />
                        <button 
                          onClick={() => fileInputRef.current?.click()}
                          className="p-2.5 text-her-muted hover:text-her-accent transition-colors ml-1"
                        >
                          <Paperclip size={18} />
                        </button>
                        <input 
                          type="text"
                          value={homePrompt}
                          onChange={(e) => setHomePrompt(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleHomeChat()}
                          placeholder="Diga algo para o OSONE..."
                          className="flex-1 bg-transparent px-2 py-2.5 focus:outline-none text-base md:text-sm font-light text-her-ink/80 placeholder:text-her-muted/30"
                        />
                        <button 
                          onClick={handleHomeChat}
                          disabled={!homePrompt.trim() && attachedFiles.length === 0}
                          className="p-2.5 bg-her-accent/20 text-her-accent rounded-full hover:bg-her-accent/30 transition-all disabled:opacity-20 disabled:grayscale mr-1"
                        >
                          <Send size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modals & Overlays */}
      <Sidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
        mode={workspaceMode}
        setMode={setWorkspaceMode}
      />
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        keys={apiKeys}
        setKeys={setApiKeys}
        selectedVoice={selectedVoice}
        setSelectedVoice={setSelectedVoice}
        orbStyle={orbStyle}
        setOrbStyle={setOrbStyle}
        appTheme={appTheme}
        setAppTheme={setAppTheme}
      />

      <AnimatePresence>
        {fullScreenImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm"
            onClick={() => setFullScreenImage(null)}
          >
            <button 
              onClick={() => setFullScreenImage(null)}
              className="absolute top-6 right-6 p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors"
            >
              <X size={24} />
            </button>
            <motion.img 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              src={fullScreenImage} 
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" 
              alt="Fullscreen generated" 
              referrerPolicy="no-referrer"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
