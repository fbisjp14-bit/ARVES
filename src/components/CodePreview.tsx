import React, { useRef, useState, useEffect } from 'react';
import { Minimize, Maximize } from 'lucide-react';
import { cn } from '../lib/utils';

export const CodePreview = ({ code }: { code: string }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <script src="https://cdn.tailwindcss.com"></script>
              <style>
                body { font-family: sans-serif; margin: 0; padding: 20px; }
              </style>
            </head>
            <body>
              ${code}
            </body>
          </html>
        `);
        doc.close();
      }
    }
  }, [code]);

  const toggleFullScreen = () => {
    setIsFullScreen(!isFullScreen);
  };

  return (
    <div 
      ref={containerRef} 
      className={cn(
        "bg-white overflow-hidden border border-black/10 shadow-inner relative group transition-all duration-300",
        isFullScreen ? "fixed inset-0 z-[100] rounded-none" : "w-full h-full rounded-xl"
      )}
    >
      <iframe 
        ref={iframeRef}
        title="Preview"
        className="w-full h-full border-none"
      />
      <button 
        onClick={toggleFullScreen}
        className="absolute bottom-4 right-4 p-2 bg-black/50 text-white rounded-lg lg:opacity-0 lg:group-hover:opacity-100 opacity-100 transition-opacity hover:bg-black/70 backdrop-blur-sm z-40"
        title={isFullScreen ? "Sair da Tela Cheia" : "Tela Cheia"}
      >
        {isFullScreen ? <Minimize size={18} /> : <Maximize size={18} />}
      </button>
    </div>
  );
};
