import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { OrbStyle } from '../types';
import { VolumeX } from 'lucide-react';

export const InfinityLogo = ({ 
  active, 
  speaking, 
  style = 'classic'
}: { 
  active: boolean; 
  speaking: boolean; 
  style?: OrbStyle;
}) => {
  const renderStyle = () => {
    switch (style) {
      case 'superintelligence':
        return (
          <div className="relative flex items-center justify-center">
            {/* Superintelligence Orb: Complex, Blue, Glowing */}
            <motion.div
              animate={{
                scale: speaking ? [1, 1.1, 1] : active ? [1, 1.05, 1] : 1,
                rotate: 360
              }}
              transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
              className={cn(
                "w-32 h-32 md:w-48 md:h-48 rounded-full border-2 border-blue-400/30 flex items-center justify-center relative",
                (active || speaking) && "bg-blue-500/5 shadow-[0_0_60px_rgba(59,130,246,0.3)]"
              )}
            >
              {/* Inner floating particles */}
              {[...Array(6)].map((_, i) => (
                <motion.div
                  key={i}
                  animate={{
                    x: [0, (i % 2 === 0 ? 30 : -30), 0],
                    y: [0, (i % 3 === 0 ? 30 : -30), 0],
                    opacity: [0.2, 0.6, 0.2]
                  }}
                  transition={{
                    duration: 3 + i,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  className="absolute w-1.5 h-1.5 bg-blue-300 rounded-full blur-[1px]"
                  style={{ transform: `rotate(${i * 60}deg) translate(20px)` }}
                />
              ))}
              
              <div className={cn(
                "w-8 h-8 rounded-full transition-all duration-700",
                (active || speaking) ? "bg-blue-400 shadow-[0_0_20px_rgba(96,165,250,1)]" : "bg-white/10"
              )} />
            </motion.div>
          </div>
        );

      case 'neural':
        return (
          <div className="relative flex items-center justify-center">
            {/* Neural: Interconnected nodes */}
            <div className="relative w-32 h-32 md:w-44 md:h-44">
              {[...Array(8)].map((_, i) => (
                <motion.div
                  key={i}
                  animate={{
                    scale: speaking ? [0.8, 1.2, 0.8] : active ? [0.9, 1.1, 0.9] : 1,
                    opacity: active ? 0.8 : 0.4
                  }}
                  transition={{ duration: 2, repeat: Infinity, delay: i * 0.2 }}
                  className="absolute w-2 h-2 bg-her-accent rounded-full"
                  style={{
                    left: '50%',
                    top: '50%',
                    transform: `rotate(${i * 45}deg) translate(60px)`
                  }}
                />
              ))}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className={cn(
                  "w-4 h-4 rounded-full transition-all duration-500",
                  (active || speaking) ? "bg-her-accent shadow-[0_0_15px_rgba(255,78,0,0.5)]" : "bg-white/10"
                )} />
              </div>
            </div>
          </div>
        );

      default:
        return (
          <div className="relative flex items-center justify-center">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                animate={{
                  scale: speaking ? [1, 1.15, 1] : active ? [1, 1.05, 1] : 1,
                  opacity: speaking ? [0.4, 0.8, 0.4] : active ? [0.3, 0.6, 0.3] : 0.2,
                  x: i === 0 ? -20 : i === 2 ? 20 : 0,
                  y: speaking ? [0, -5, 0] : 0
                }}
                transition={{
                  duration: speaking ? 2 : 4,
                  repeat: Infinity,
                  delay: i * 0.3,
                  ease: "easeInOut"
                }}
                className={cn(
                  "absolute w-16 h-16 md:w-24 md:h-24 rounded-full border border-white/[0.1] flex items-center justify-center mix-blend-screen",
                  (active || speaking) && "bg-her-accent/5 shadow-[0_0_40px_rgba(255,78,0,0.1)]"
                )}
              >
                <div className={cn(
                  "w-2 h-2 md:w-3 md:h-3 rounded-full transition-all duration-700",
                  (active || speaking) ? "bg-her-accent scale-110 shadow-[0_0_10px_rgba(242,125,38,0.8)]" : "bg-white/20 scale-100"
                )} />
              </motion.div>
            ))}
          </div>
        );
    }
  };

  return (
    <div className={cn(
      "relative w-48 h-48 md:w-64 md:h-64 flex items-center justify-center cursor-pointer group transition-all",
      !active && "opacity-60 saturate-50 scale-95"
    )}>
      {/* Outer Glow */}
      <div className={cn(
        "absolute inset-0 rounded-full transition-all duration-1000",
        (active || speaking) ? (
          style === 'superintelligence' ? "bg-blue-500/10 blur-[100px] scale-110" : "bg-her-accent/10 blur-[100px] scale-110"
        ) : "bg-transparent"
      )} />
      
      {renderStyle()}

      {/* Rotating Rings (only for classic) */}
      {style === 'classic' && (
        <>
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 border border-white/[0.03] rounded-full"
          />
          <motion.div 
            animate={{ rotate: -360 }}
            transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
            className="absolute inset-6 border border-white/[0.02] rounded-full border-dashed"
          />
        </>
      )}

      {/* Superintelligence Rings */}
      {style === 'superintelligence' && (active || speaking) && (
        <motion.div
          animate={{ rotate: [0, 360], scale: [1, 1.1, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 border border-blue-400/10 rounded-full"
        />
      )}
      
      {/* Speaking rings */}
      {speaking && active && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {[1, 2, 3].map((i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: [0, 0.3, 0], scale: [0.8, 1.5, 2] }}
              transition={{
                duration: 2,
                repeat: Infinity,
                delay: i * 0.5,
                ease: "easeOut"
              }}
              className={cn(
                "absolute w-full h-full border rounded-full",
                style === 'superintelligence' ? "border-blue-400/30" : "border-her-accent/30"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
};
