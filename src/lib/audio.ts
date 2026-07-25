/**
 * Audio processing utilities for Gemini Live API
 */

export class AudioProcessor {
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private silentOutput: GainNode | null = null;

  async startRecording(onAudioData: (base64Data: string, rms: number) => void) {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("Seu navegador não suporta a API de Áudio.");
      }

      this.audioContext = new AudioContextClass({ sampleRate: 16000 });
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          sampleSize: 16,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      if (!this.audioContext || !this.stream) {
        return; 
      }
      
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      this.processor.onaudioprocess = (e) => {
        if (!this.processor) return;
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Calculate RMS to detect user voice volume
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        
        // Dispatch CustomEvent on window for components to react to user speaking volume
        const voiceEvent = new CustomEvent('osone_user_voice', { detail: { rms } });
        window.dispatchEvent(voiceEvent);
        
        // Convert Float32 to Int16 PCM
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }
        
        // Convert to base64 safely without using spread operator to avoid 'Maximum call stack size exceeded' errors
        const uint8Bytes = new Uint8Array(pcmData.buffer);
        let binary = "";
        const len = uint8Bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(uint8Bytes[i]);
        }
        const base64Data = btoa(binary);
        onAudioData(base64Data, rms);
      };
  
      this.source.connect(this.processor);
      // O ScriptProcessor precisa estar conectado para emitir eventos. Um
      // ganho zero impede que o microfone retorne aos alto-falantes e gere
      // chiado, eco ou realimentação.
      this.silentOutput = this.audioContext.createGain();
      this.silentOutput.gain.value = 0;
      this.processor.connect(this.silentOutput);
      this.silentOutput.connect(this.audioContext.destination);
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
    } catch (error: any) {
      const isPermissionDenied = error?.name === 'NotAllowedError' || 
                                 error?.message?.includes('Permission denied') || 
                                 error?.message?.includes('not-allowed');
      if (isPermissionDenied) {
        console.warn("Aviso: Gravação de áudio indisponível por falta de permissão:", error.message || error);
      } else {
        console.error("Erro ao iniciar gravação de áudio:", error);
      }
      this.stopRecording();
      if (isPermissionDenied) {
        const enhancedError = new Error("Permissão de microfone negada. Clique no cadeado (URL) para habilitar, ou abra o OSONE em uma nova aba para contornar restrições de iframe.");
        (enhancedError as any).name = 'NotAllowedError';
        throw enhancedError;
      }
      throw error;
    }
  }

  stopRecording() {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.silentOutput?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop());
    this.audioContext?.close();
    
    this.processor = null;
    this.source = null;
    this.silentOutput = null;
    this.stream = null;
    this.audioContext = null;
  }
}

export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private outputGainNode: GainNode | null = null;
  private highPassNode: BiquadFilterNode | null = null;
  private lowPassNode: BiquadFilterNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private nextStartTime: number = 0;
  private onActivityChange?: (active: boolean) => void;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private animFrameId: number | null = null;
  public modulation: { pitch: number; rate: number; distortion: number } = { pitch: 1.0, rate: 1.0, distortion: 0 };

  constructor(onActivityChange?: (active: boolean) => void) {
    this.onActivityChange = onActivityChange;
    this.initAudioContext();
  }

  private initAudioContext() {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      this.audioContext = new AudioContextClass({ sampleRate: 24000 });
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 64;
      this.analyserNode.smoothingTimeConstant = 0.8;
      this.outputGainNode = this.audioContext.createGain();
      this.outputGainNode.gain.value = 0.92;
      this.highPassNode = this.audioContext.createBiquadFilter();
      this.highPassNode.type = 'highpass';
      this.highPassNode.frequency.value = 70;
      this.highPassNode.Q.value = 0.7;
      this.lowPassNode = this.audioContext.createBiquadFilter();
      this.lowPassNode.type = 'lowpass';
      this.lowPassNode.frequency.value = 11_000;
      this.lowPassNode.Q.value = 0.7;
      this.compressorNode = this.audioContext.createDynamicsCompressor();
      this.compressorNode.threshold.value = -6;
      this.compressorNode.knee.value = 6;
      this.compressorNode.ratio.value = 4;
      this.compressorNode.attack.value = 0.003;
      this.compressorNode.release.value = 0.12;

      this.analyserNode.connect(this.highPassNode);
      this.highPassNode.connect(this.lowPassNode);
      this.lowPassNode.connect(this.compressorNode);
      this.compressorNode.connect(this.outputGainNode);
      this.outputGainNode.connect(this.audioContext.destination);
    }
  }

  private startLevelMonitoring() {
    if (this.animFrameId !== null) return;
    let lastDispatch = 0;
    const monitor = () => {
      if (this.activeSources.size === 0) {
        this.stopLevelMonitoring();
        return;
      }
      if (this.analyserNode) {
        const now = Date.now();
        if (now - lastDispatch >= 33) { // 30 FPS
          lastDispatch = now;
          const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
          this.analyserNode.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const level = sum / (dataArray.length * 255);
          window.dispatchEvent(new CustomEvent('osone_assistant_voice', { detail: { level } }));
        }
      }
      this.animFrameId = requestAnimationFrame(monitor);
    };
    this.animFrameId = requestAnimationFrame(monitor);
  }

  private stopLevelMonitoring() {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  playChunk(base64Data: string) {
    if (!this.audioContext || this.audioContext.state === 'closed') return;

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(err => console.error("Erro ao resumir AudioContext no playChunk:", err));
    }

    try {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      
      const sampleCount = Math.floor(bytes.byteLength / 2);
      if (sampleCount === 0) return;
      const pcmView = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);

      const floatData = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        floatData[i] = pcmView.getInt16(i * 2, true) / 32768.0;
      }
  
      const buffer = this.audioContext.createBuffer(1, floatData.length, 24000);
      buffer.getChannelData(0).set(floatData);
  
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      
      // Apply modulation
      const effectiveRate = Math.max(0.5, Math.min(2.0, this.modulation.pitch * this.modulation.rate));
      source.playbackRate.value = effectiveRate;

      // Anti-pop Gain Envelope Node
      const gainNode = this.audioContext.createGain();

      // A versão anterior possuía WaveShaper configurável, que adicionava
      // ruído audível. A saída agora permanece sempre limpa.
      source.connect(gainNode);
      gainNode.connect(this.analyserNode || this.audioContext.destination);
  
      const currentTime = this.audioContext.currentTime;
      // Jitter buffer management: if nextStartTime is behind currentTime or starting fresh, add 50ms buffer
      if (this.nextStartTime < currentTime + 0.02) {
        this.nextStartTime = currentTime + 0.05;
      }
  
      const startTime = this.nextStartTime;
      const adjustedDuration = buffer.duration / effectiveRate;

      // Apply smooth micro ramps (1.5ms) at chunk boundaries to eliminate clicks/pops
      const rampTime = Math.min(0.0015, adjustedDuration / 4);
      gainNode.gain.setValueAtTime(0.001, startTime);
      gainNode.gain.linearRampToValueAtTime(1.0, startTime + rampTime);
      gainNode.gain.setValueAtTime(1.0, Math.max(startTime + rampTime, startTime + adjustedDuration - rampTime));
      gainNode.gain.linearRampToValueAtTime(0.001, startTime + adjustedDuration);

      source.start(startTime);
      this.nextStartTime += adjustedDuration;

      this.activeSources.add(source);
      if (this.activeSources.size === 1) {
        this.onActivityChange?.(true);
        this.startLevelMonitoring();
      }

      source.onended = () => {
        this.activeSources.delete(source);
        if (this.activeSources.size === 0) {
          this.stopLevelMonitoring();
          this.onActivityChange?.(false);
        }
      };
    } catch (err) {
      console.error("Erro ao reproduzir chunk de áudio:", err);
    }
  }

  stop() {
    this.stopLevelMonitoring();
    this.activeSources.forEach(s => {
      try { s.stop(); } catch(e) {}
    });
    this.activeSources.clear();
    this.audioContext?.close();
    this.initAudioContext();
    this.nextStartTime = 0;
    this.onActivityChange?.(false);
  }
}
