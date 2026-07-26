import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import os from "os";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import pkgWhatsapp from "whatsapp-web.js";
const { Client: WWebClient, LocalAuth: WWebLocalAuth } = pkgWhatsapp;
import QRCode from "qrcode";

dotenv.config();

// ALWAYS polyfill global WebSocket for Node.js environments.
// This ensures @google/genai uses the complete 'ws' implementation rather than Node 22's
// native experimental Global WebSocket (which doesn't support the custom headers/authentication needed by Gemini Live).
(globalThis as any).WebSocket = WebSocket;

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  app.disable("x-powered-by");
  
  // Create a WebSocket Server connected to the HTTP Server, responding on specifically /api/live-ws path
  const wss = new WebSocketServer({ noServer: true, maxPayload: 5 * 1024 * 1024, perMessageDeflate: false });
  // Create a WebSocket Server for ElevenLabs streaming input audio proxy
  const elWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });

  const PORT = 3000;
  const ARVES_IDENTITY_INSTRUCTION = "Identidade fixa: você é o ARVES. Foi idealizado e criado por LEINAD. Se perguntarem quem criou ou desenvolveu você, responda claramente: \"Fui criado por LEINAD.\" Não atribua sua criação a terceiros e não invente fatos pessoais sobre LEINAD.";
  const normalizeGeminiModel = (value: unknown, fallback: string, allowImagen = false): string => {
    if (typeof value !== "string") return fallback;
    const pattern = allowImagen
      ? /^(?:gemini|imagen)-[a-z0-9.-]{1,80}$/i
      : /^gemini-[a-z0-9.-]{1,80}$/i;
    return pattern.test(value) ? value : fallback;
  };

  // Safe helper to read the Gemini API key from environment
  const getSecretGeminiKey = (): string => {
    if (process.env.GEMINI_API_KEY) {
      return process.env.GEMINI_API_KEY;
    }
    return "";
  };

  const safeSecretEqual = (received: unknown, expected: string): boolean => {
    if (!expected || typeof received !== "string") return false;
    const receivedBuffer = Buffer.from(received);
    const expectedBuffer = Buffer.from(expected);
    return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
  };

  const isPrivateAddress = (address: string): boolean => {
    const normalized = address.toLowerCase().split("%")[0];
    if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) {
      return true;
    }
    if (normalized.startsWith("::ffff:")) {
      return isPrivateAddress(normalized.slice(7));
    }
    if (isIP(normalized) === 4) {
      const octets = normalized.split(".").map(Number);
      return (
        octets[0] === 0 ||
        octets[0] === 10 ||
        octets[0] === 127 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
        octets[0] >= 224
      );
    }
    return false;
  };

  const assertSafeRemoteUrl = async (rawUrl: string, allowPrivate = false): Promise<URL> => {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error("URL inválida.");
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error("Apenas URLs HTTP/HTTPS sem credenciais embutidas são permitidas.");
    }
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") {
      throw new Error("Endereço local ou de metadados bloqueado.");
    }
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || (!allowPrivate && addresses.some(item => isPrivateAddress(item.address)))) {
      throw new Error("Endereço privado, reservado ou não resolvido bloqueado.");
    }
    return parsed;
  };

  const readResponseTextLimited = async (response: Response, maxBytes: number): Promise<string> => {
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Resposta remota excedeu ${Math.round(maxBytes / 1024)} KB.`);
      }
      chunks.push(value);
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(output);
  };

  const readResponseBufferLimited = async (response: Response, maxBytes: number): Promise<Buffer> => {
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Resposta binária excedeu ${Math.round(maxBytes / 1024 / 1024)} MB.`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  };

  const configuredOrigins = (process.env.ARVES_ALLOWED_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

  const isAllowedOrigin = (origin: string | undefined, host: string | undefined): boolean => {
    if (!origin) return process.env.NODE_ENV !== "production";
    if (configuredOrigins.includes(origin)) return true;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  };

  // Helper to sanitize any occurrence of sensitive API keys from messages returned to the client
  const sanitizeMessageOfKeys = (message: string): string => {
    if (!message) return "";
    
    // 1. Mask Google Gemini API keys (starts with AIzaSy followed by 33 characters)
    let sanitized = message.replace(/AIzaSy[A-Za-z0-9_-]{33}/g, "[CHAVE_REMOVIDA]");
    
    // 2. Mask generic key/token patterns (such as api_key=..., key=..., xi-api-key, etc.)
    sanitized = sanitized.replace(/(key|api_key|apikey|xi-api-key|token)(?:["'\s:=]+)([A-Za-z0-9_-]{10,60})/gi, "$1=[REMOVED]");
    
    // 3. Mask the fallback key if loaded
    const secretKey = getSecretGeminiKey();
    if (secretKey && secretKey.length > 5) {
      const escapedKey = secretKey.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const keyRegex = new RegExp(escapedKey, 'g');
      sanitized = sanitized.replace(keyRegex, "[CHAVE_REMOVIDA]");
    }

    // 4. Mask the standard process env key
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 5) {
      const escapedEnvKey = process.env.GEMINI_API_KEY.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const envKeyRegex = new RegExp(escapedEnvKey, 'g');
      sanitized = sanitized.replace(envKeyRegex, "[CHAVE_REMOVIDA]");
    }
    
    return sanitized;
  };

  // Gracefully formats Gemini API errors, notifying the user when their key quota is exhausted
  const formatGeminiError = (err: any): string => {
    const msg = err?.message || String(err);
    if (
      msg.includes("429") ||
      msg.includes("RESOURCE_EXHAUSTED") ||
      msg.toLowerCase().includes("quota") ||
      msg.toLowerCase().includes("limit") ||
      msg.toLowerCase().includes("exceeded")
    ) {
      return "Sua cota da API do Gemini foi excedida ou houve limite de taxa (Erro 429). Por favor, insira sua própria API Key válida do Google no painel de Ajustes (ícone de engrenagem) ou verifique o limite do seu plano em https://ai.google.dev/gemini-api/docs/rate-limits.";
    }
    if (
      msg.includes("503") ||
      msg.includes("UNAVAILABLE") ||
      msg.toLowerCase().includes("high demand") ||
      msg.toLowerCase().includes("temporary") ||
      msg.toLowerCase().includes("temporarily")
    ) {
      return "O modelo da API do Gemini está temporariamente congestionado com alta demanda global (Erro 503 / UNAVAILABLE). Por favor, aguarde alguns segundos e clique em enviar novamente, ou selecione outro modelo (como gemini-2.5-flash ou gemini-1.5-flash) nas Configurações (ícone de engrenagem no cabeçalho superior) para obter respostas mais estáveis.";
    }
    return sanitizeMessageOfKeys(msg);
  };

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self), payment=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    if (req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
    }
    next();
  });

  app.use(express.json({ limit: "20mb", strict: true }));
  app.use(express.urlencoded({ limit: "2mb", extended: true, parameterLimit: 200 }));

  const rateWindows = new Map<string, { count: number; resetAt: number }>();
  app.use("/api", (req, res, next) => {
    const now = Date.now();
    const windowMs = 5 * 60 * 1000;
    const isComputeRoute = /\/(gemini|generate|chat-intel|search|scrape|dossier|integrations)\b/.test(req.path);
    const limit = isComputeRoute ? 60 : 240;
    const key = `${req.ip || req.socket.remoteAddress || "unknown"}:${isComputeRoute ? "compute" : "general"}`;
    const current = rateWindows.get(key);
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    bucket.count += 1;
    rateWindows.set(key, bucket);
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - bucket.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > limit) {
      return res.status(429).json({ error: "Muitas solicitações. Aguarde alguns minutos e tente novamente." });
    }
    if (rateWindows.size > 2000) {
      for (const [bucketKey, value] of rateWindows) {
        if (value.resetAt <= now) rateWindows.delete(bucketKey);
      }
    }
    next();
  });

  app.use("/api", (req, res, next) => {
    if (req.path !== "/whatsapp/webhook" && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      if (origin && !isAllowedOrigin(origin, req.get("host"))) {
        return res.status(403).json({ error: "Origem não autorizada." });
      }
    }
    next();
  });

  app.use("/api", (req, res, next) => {
    if (req.path === "/health" || req.path === "/whatsapp/webhook") return next();
    const expected = (process.env.ARVES_ACCESS_TOKEN || "").trim();
    if (!expected) return next();
    if (!safeSecretEqual(req.get("x-arves-access-token"), expected)) {
      return res.status(401).json({ error: "Token privado do ARVES ausente ou inválido." });
    }
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "ARVES", creator: "LEINAD" });
  });

  // Middleware to intercept all outgoing JSON and string responses and sanitize potential leaks of API keys
  app.use((req, res, next) => {
    const originalJson = res.json;
    res.json = function (obj) {
      if (obj && typeof obj === 'object') {
        try {
          const str = JSON.stringify(obj);
          const fallbackKey = getSecretGeminiKey();
          const envKey = process.env.GEMINI_API_KEY || "";
          
          const hasGoogleKey = str.includes("AIzaSy");
          const hasFallbackKey = !!(fallbackKey && str.includes(fallbackKey));
          const hasEnvKey = !!(envKey && str.includes(envKey));
          
          if (hasGoogleKey || hasFallbackKey || hasEnvKey) {
            const sanitizedStr = sanitizeMessageOfKeys(str);
            return originalJson.call(this, JSON.parse(sanitizedStr));
          }
        } catch (e) {
          console.warn("Failed to sanitize JSON response:", e);
        }
      }
      return originalJson.call(this, obj);
    };
    
    const originalSend = res.send;
    res.send = function (body) {
      if (typeof body === 'string') {
        const fallbackKey = getSecretGeminiKey();
        const envKey = process.env.GEMINI_API_KEY || "";
        
        const hasGoogleKey = body.includes("AIzaSy");
        const hasFallbackKey = !!(fallbackKey && body.includes(fallbackKey));
        const hasEnvKey = !!(envKey && body.includes(envKey));
        
        if (hasGoogleKey || hasFallbackKey || hasEnvKey) {
          const sanitizedBody = sanitizeMessageOfKeys(body);
          return originalSend.call(this, sanitizedBody);
        }
      }
      return originalSend.call(this, body);
    };
    
    next();
  });

  // ====== TIKTOK LIVE WEBCAST INTEGRATION STATE ======
  let currentTikTokUser = "";
  let tiktokStatus: "connected" | "disconnected" | "connecting" = "disconnected";
  let isTikTokAutoRespondActive = false;
  let activeTikTokRunner: any = null;
  let simulatedIntervalId: any = null;
  let tiktokViewerCount = 0;
  let tiktokLikeCount = 0;
  let tiktokSessionId = "";
  let tiktokTargetIdc = "";

  interface TikTokLog {
    id: string;
    type: "chat" | "gift" | "like" | "member" | "system" | "error";
    user: string;
    message: string;
    timestamp: number;
    detailedData?: any;
  }

  let tiktokEventLogs: TikTokLog[] = [
    {
      id: "init-tiktok",
      type: "system",
      user: "Sistema",
      message: "Co-piloto de Live do TikTok carregado. Ajuste os dados do host em Configurações para iniciar escuta passiva das webcast sockets.",
      timestamp: Date.now()
    }
  ];

  async function handleTikTokAutoResponse(user: string, text: string) {
    try {
      const apiKey = getSecretGeminiKey();
      if (!apiKey) return;

      const ai = new GoogleGenAI({ apiKey, vertexai: false });
      const prompt = `Você é o co-piloto ARVES G5 assistindo uma transmissão ao vivo no TikTok. O usuário "@${user}" enviou uma mensagem no chat da live. 
Responda brevemente e com muita energia, carisma, carinho e sintonia (máximo 1 linha com no máximo 20 palavras), interagindo diretamente com ele.

Comentário de @${user}: "${text}"`;

      const gResult = await generateContentWithFallback(ai, {
        model: "gemini-3.5-flash-lite",
        contents: prompt
      });

      const replyText = gResult.text?.trim() || "Sensacional, obrigado por participar da nossa transmissão!";
      
      tiktokEventLogs.unshift({
        id: Math.random().toString(36).substring(2, 11),
        type: "system",
        user: "🤖 ARVES G5 (Co-piloto)",
        message: `Resposta automática para @${user}: "${replyText}"`,
        timestamp: Date.now()
      });
    } catch (err) {
      console.error("TikTok Auto respond error:", err);
    }
  }

  function stopSimulatedLive() {
    if (simulatedIntervalId) {
      clearInterval(simulatedIntervalId);
      simulatedIntervalId = null;
    }
  }

  function startSimulatedLive() {
    stopSimulatedLive();
    tiktokStatus = "connected";
    currentTikTokUser = "simulador_arves";
    tiktokViewerCount = Math.floor(Math.random() * 120) + 38;
    tiktokLikeCount = Math.floor(Math.random() * 800) + 120;
    
    tiktokEventLogs.unshift({
      id: Math.random().toString(),
      type: "system",
      user: "Sistema",
      message: "Modo de simulação ativa! Gerando tráfego virtual de chat, curtidas e presentes TikTok a cada 6 segundos.",
      timestamp: Date.now()
    });

    const NAMES = ["LiviaStyle", "Guilherme_Dev", "AnaClara_TikTok", "Pedro_Arves", "Sonia_Mendes", "RenatoG5_Pro"];
    const COMMENTS = [
      "Caramba, o ARVES é bizarro de rápido!",
      "Como faz pra conectar no whatsapp igual você fez?",
      "Que inteligência incrível, roda local?",
      "Dá um salve pra galera de São Paulo!",
      "Gostei muito do design desse orb sínclitico",
      "Você prefere ser chamado de ARVES ou apenas IA?",
      "Manda bala nas explicações, aprendendo muito!"
    ];
    const GIFTS = ["Rosa", "Coração", "Boné TikTok", "Sorvete", "Diamante"];

    simulatedIntervalId = setInterval(async () => {
      const coin = Math.random();
      
      // Dynamic viewer count fluctuates
      tiktokViewerCount = Math.max(5, tiktokViewerCount + Math.floor(Math.random() * 7) - 3);

      if (coin < 0.65) {
        const name = NAMES[Math.floor(Math.random() * NAMES.length)];
        const msg = COMMENTS[Math.floor(Math.random() * COMMENTS.length)];
        tiktokEventLogs.unshift({
          id: Math.random().toString(),
          type: "chat",
          user: name,
          message: msg,
          timestamp: Date.now()
        });
        
        if (isTikTokAutoRespondActive) {
          await handleTikTokAutoResponse(name, msg);
        }
      } else if (coin < 0.85) {
        const name = NAMES[Math.floor(Math.random() * NAMES.length)];
        const addedLikes = Math.floor(Math.random() * 15) + 5;
        tiktokLikeCount += addedLikes;
        tiktokEventLogs.unshift({
          id: Math.random().toString(),
          type: "like",
          user: name,
          message: `Curtiu a live enviando corações (+${addedLikes} likes)!`,
          timestamp: Date.now()
        });
      } else {
        const name = NAMES[Math.floor(Math.random() * NAMES.length)];
        const giftName = GIFTS[Math.floor(Math.random() * GIFTS.length)];
        const count = Math.floor(Math.random() * 5) + 1;
        tiktokLikeCount += (count * 10); // Gifts add lots of likes too
        tiktokEventLogs.unshift({
          id: Math.random().toString(),
          type: "gift",
          user: name,
          message: `Enviou Presente: ${giftName} x${count}!`,
          timestamp: Date.now()
        });
      }

      if (tiktokEventLogs.length > 300) tiktokEventLogs.pop();
    }, 6000);
  }

  async function connectToTikTokLive(username: string, sessionId?: string, targetIdc?: string) {
    try {
      await disconnectFromTikTokLive();
      currentTikTokUser = username;
      tiktokStatus = "connecting";
      tiktokViewerCount = 0;
      tiktokLikeCount = 0;

      tiktokEventLogs.unshift({
        id: Math.random().toString(),
        type: "system",
        user: "Sistema",
        message: `Mapeando username @${username}... Buscando ID do canal de transmissão ativa.`,
        timestamp: Date.now()
      });

      // Dynamic import to support clean compilation
      const { TikTokLiveConnection, WebcastEvent, ControlEvent } = await import("tiktok-live-connector");
      
      const configOpts: any = {
        enableExtendedGiftInfo: true,
        requestPollingIntervalMs: 2000,
        clientParams: {
          "app_language": "pt-BR",
          "webcast_language": "pt-BR"
        },
        requestOptions: {
          timeout: 12000,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        }
      };

      if (sessionId && sessionId.trim()) {
        configOpts.sessionId = sessionId.trim();
        tiktokEventLogs.unshift({
          id: Math.random().toString(),
          type: "system",
          user: "Sistema",
          message: "Autenticação Ativa: Conectando com Session ID credenciado para evitar shadow-blocks.",
          timestamp: Date.now()
        });

        if (targetIdc && targetIdc.trim()) {
          const idcValue = targetIdc.trim();
          configOpts.requestOptions.headers["Cookie"] = `tt-target-idc=${idcValue}; tt-idc-switch=1`;
          configOpts.requestOptions.headers["cookie"] = `tt-target-idc=${idcValue}; tt-idc-switch=1`;
          // Also pass the target data center directly when supported.
          configOpts.targetIdc = idcValue;
          configOpts.target_idc = idcValue;
        }
      }

      const connection = new TikTokLiveConnection(username, configOpts);
      activeTikTokRunner = connection;

      connection.on(WebcastEvent.CHAT, async (data: any) => {
        const user = data?.user || {};
        const logEntry: TikTokLog = {
          id: data.msgId || data?.common?.msgId || Math.random().toString(),
          type: "chat",
          user: data.uniqueId || user.uniqueId || data.nickname || user.nickname || "Anônimo",
          message: data.comment || data.content || "",
          timestamp: Date.now()
        };
        tiktokEventLogs.unshift(logEntry);
        if (tiktokEventLogs.length > 300) tiktokEventLogs.pop();

        if (isTikTokAutoRespondActive) {
          await handleTikTokAutoResponse(logEntry.user, logEntry.message);
        }
      });

      connection.on(WebcastEvent.GIFT, (data: any) => {
        const user = data?.user || {};
        const giftCount = data.repeatCount || data.count || 1;
        const logEntry: TikTokLog = {
          id: data.msgId || data?.common?.msgId || Math.random().toString(),
          type: "gift",
          user: data.uniqueId || user.uniqueId || data.nickname || user.nickname || "Doador",
          message: `Enviou Presente: ${data.giftName || data?.gift?.name || data?.extendedGiftInfo?.name || "Presente"} (x${giftCount})`,
          timestamp: Date.now()
        };
        tiktokEventLogs.unshift(logEntry);
         if (tiktokEventLogs.length > 300) tiktokEventLogs.pop();
      });

      connection.on(WebcastEvent.LIKE, (data: any) => {
        const user = data?.user || {};
        if (data && typeof data.likeCount === "number") {
          tiktokLikeCount = data.likeCount;
        }
        tiktokEventLogs.unshift({
          id: Math.random().toString(),
          type: "like",
          user: data.uniqueId || user.uniqueId || data.nickname || user.nickname || "Curtiu",
          message: `Curtiu a transmissão! Total: ${data.likeCount || tiktokLikeCount || ''} curtidas`,
          timestamp: Date.now()
        });
        if (tiktokEventLogs.length > 300) tiktokEventLogs.pop();
      });

      // Track spectators count in real-time
      connection.on(WebcastEvent.ROOM_USER, (data: any) => {
        if (data && typeof data.viewerCount === "number") {
          tiktokViewerCount = data.viewerCount;
        }
      });

      connection.on(WebcastEvent.MEMBER, (data: any) => {
        const user = data?.user || {};
        tiktokEventLogs.unshift({
          id: Math.random().toString(),
          type: "member",
          user: data.uniqueId || user.uniqueId || data.nickname || user.nickname || "Membro",
          message: `Entrou na live! Bem-vindo(a).`,
          timestamp: Date.now()
        });
        if (tiktokEventLogs.length > 300) tiktokEventLogs.pop();
      });

      connection.on(ControlEvent.DISCONNECTED, () => {
        // Only trigger reconnect check if we are still targeting this user and didn't disconnect manually
        if (currentTikTokUser === username && tiktokStatus === "connected") {
          tiktokStatus = "connecting";
          tiktokEventLogs.unshift({
            id: Math.random().toString(),
            type: "system",
            user: "Sistema",
            message: "Conexão encerrada subitamente pelo TikTok. Tentando reconectar automaticamente em 10 segundos...",
            timestamp: Date.now()
          });
          setTimeout(() => {
            if (currentTikTokUser === username) {
               connectToTikTokLive(username, sessionId, tiktokTargetIdc).catch(() => {});
            }
          }, 10000);
        } else {
          tiktokStatus = "disconnected";
        }
      });

      connection.on(ControlEvent.ERROR, (err) => {
        tiktokEventLogs.unshift({
          id: Math.random().toString(),
          type: "error",
          user: "Erro",
          message: `Alerta na transmissão: ${err.message || "Problema de transporte de sockets."}`,
          timestamp: Date.now()
        });
      });

      await connection.connect();
      tiktokStatus = "connected";

      tiktokEventLogs.unshift({
        id: Math.random().toString(),
        type: "system",
        user: "Sistema",
        message: `Conectado com sucesso absoluto! Assistindo webcast de @${username} e recebendo eventos em tempo real.`,
        timestamp: Date.now()
      });

    } catch (err: any) {
      console.error("TikTok connection crash:", err);
      tiktokStatus = "disconnected";
      
      let errMsg = err.message || "Sem resposta/Transmissão offline.";
      if (errMsg.includes("404") || errMsg.includes("not found")) {
        errMsg = "Canal não encontrado ou transmissão offline no momento.";
      } else if (errMsg.includes("rate limit") || errMsg.includes("IP") || errMsg.includes("block")) {
        errMsg = "Bloqueio de IP por taxa limite do TikTok. Recomenda-se preencher o seu 'Session ID' para bypass.";
      }

      tiktokEventLogs.unshift({
        id: Math.random().toString(),
        type: "error",
        user: "Erro",
        message: `Falha na conexão: ${errMsg} Dica: Se o canal existir e estiver online, o TikTok pode estar bloqueando nosso IP de nuvem. Use o campo 'Session ID' ao lado para autenticar.`,
        timestamp: Date.now()
      });
      throw err;
    }
  }

  async function disconnectFromTikTokLive() {
    stopSimulatedLive();
    if (activeTikTokRunner) {
      try {
        await activeTikTokRunner.disconnect();
      } catch (e) {
        console.warn("Disconnection failed gracefully:", e);
      }
      activeTikTokRunner = null;
    }
    tiktokStatus = "disconnected";
    currentTikTokUser = "";
  }

  // ====== WHATSAPP EVOLUTION INTEGRATION STATE ======
  let whatsappConfig = {
    apiUrl: "https://demo.evolution-api.com",
    apiKey: "",
    instanceName: "arves_assistant",
    enabled: false,
    geminiApiKey: ""
  };

  let virtualConnectionState = "DISCONNECTED";

  // ====== WHATSAPP-WEB.JS LOCAL CLIENT STATE ======
  let wwebjsClient: any = null;
  let wwebjsStatus: "desconectado" | "iniciando" | "aguardando_qr" | "conectado" | "erro" = "desconectado";
  let wwebjsQrRaw = "";
  let wwebjsQrBase64 = "";
  let wwebjsPhoneInfo: { number?: string; name?: string } = {};
  let wwebjsLastError = "";

  interface WhatsappLog {
    id: string;
    timestamp: number;
    type: "received" | "sent" | "error" | "info";
    sender: string;
    message: string;
    response?: string;
  }

  let whatsappLogs: WhatsappLog[] = [
    {
      id: "init",
      timestamp: Date.now(),
      type: "info",
      sender: "Sistema",
      message: "Canal do WhatsApp ARVES de pé. Pronto para evolução de fluxos."
    }
  ];

  // Helper function to initialize WhatsApp Web Client via Puppeteer
  const initializeWhatsAppWebClient = async () => {
    if (wwebjsClient) {
      try {
        await wwebjsClient.destroy();
      } catch (_) {}
      wwebjsClient = null;
    }

    wwebjsStatus = "iniciando";
    wwebjsQrRaw = "";
    wwebjsQrBase64 = "";
    wwebjsLastError = "";

    try {
      wwebjsClient = new WWebClient({
        authStrategy: new WWebLocalAuth({
          clientId: "arves_copilot_session",
          dataPath: path.join(process.cwd(), ".wwebjs_auth")
        }),
        puppeteer: {
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu"
          ]
        }
      });

      wwebjsClient.on("qr", async (qr: string) => {
        wwebjsStatus = "aguardando_qr";
        wwebjsQrRaw = qr;
        try {
          wwebjsQrBase64 = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
        } catch (e: any) {
          console.error("[WhatsApp] Erro ao converter QR Code:", e);
        }
        whatsappLogs.unshift({
          id: Math.random().toString(36).substring(2, 11),
          timestamp: Date.now(),
          type: "info",
          sender: "WhatsApp Web",
          message: "Novo QR Code gerado. Prontos para escanear no app do WhatsApp!"
        });
        if (whatsappLogs.length > 100) whatsappLogs.pop();
      });

      wwebjsClient.on("authenticated", () => {
        wwebjsStatus = "iniciando";
        wwebjsQrRaw = "";
        wwebjsQrBase64 = "";
        whatsappLogs.unshift({
          id: Math.random().toString(36).substring(2, 11),
          timestamp: Date.now(),
          type: "info",
          sender: "WhatsApp Web",
          message: "Sessão autenticada via WhatsApp Web com sucesso."
        });
        if (whatsappLogs.length > 100) whatsappLogs.pop();
      });

      wwebjsClient.on("ready", () => {
        wwebjsStatus = "conectado";
        virtualConnectionState = "CONNECTED";
        wwebjsQrRaw = "";
        wwebjsQrBase64 = "";
        wwebjsPhoneInfo = {
          number: wwebjsClient.info?.wid?.user || "Conectado",
          name: wwebjsClient.info?.pushname || "ARVES WhatsApp"
        };
        whatsappLogs.unshift({
          id: Math.random().toString(36).substring(2, 11),
          timestamp: Date.now(),
          type: "info",
          sender: "WhatsApp Web",
          message: `Conexão WhatsApp Ativa! Telefone/Conta: ${wwebjsPhoneInfo.name} (${wwebjsPhoneInfo.number})`
        });
        if (whatsappLogs.length > 100) whatsappLogs.pop();
      });

      wwebjsClient.on("auth_failure", (msg: string) => {
        wwebjsStatus = "erro";
        wwebjsLastError = `Falha de Autenticação: ${msg}`;
        whatsappLogs.unshift({
          id: Math.random().toString(36).substring(2, 11),
          timestamp: Date.now(),
          type: "error",
          sender: "WhatsApp Web",
          message: `Falha na autenticação do WhatsApp: ${msg}`
        });
        if (whatsappLogs.length > 100) whatsappLogs.pop();
      });

      wwebjsClient.on("disconnected", (reason: string) => {
        wwebjsStatus = "desconectado";
        virtualConnectionState = "DISCONNECTED";
        wwebjsQrRaw = "";
        wwebjsQrBase64 = "";
        wwebjsPhoneInfo = {};
        whatsappLogs.unshift({
          id: Math.random().toString(36).substring(2, 11),
          timestamp: Date.now(),
          type: "error",
          sender: "WhatsApp Web",
          message: `WhatsApp Web desconectado: ${reason}`
        });
        if (whatsappLogs.length > 100) whatsappLogs.pop();
      });

      wwebjsClient.on("message", async (msg: any) => {
        try {
          if (msg.isStatus || msg.from.endsWith("@g.us")) return;
          const sender = msg.from;
          const body = msg.body;
          if (!body) return;

          whatsappLogs.unshift({
            id: Math.random().toString(36).substring(2, 11),
            timestamp: Date.now(),
            type: "received",
            sender: sender,
            message: body
          });
          if (whatsappLogs.length > 100) whatsappLogs.pop();

          if (whatsappConfig.enabled) {
            const geminiApiKeyToUse = whatsappConfig.geminiApiKey || getSecretGeminiKey();
            const ai = new GoogleGenAI({ apiKey: geminiApiKeyToUse, vertexai: false });
            const systemPrompt = `Você é o ARVES G5, o cérebro eletrônico central de inteligência artificial de elite, hiperfocado em ajudar o usuário com uma clareza deslumbrante, respostas estruturadas, elegantes e um toque futurista e polido.
${ARVES_IDENTITY_INSTRUCTION}
Você está atendendo o usuário pelo WhatsApp em nome do proprietário deste dispositivo ARVES. Responda diretamente e com muita inteligência, clareza, formatação impecável de parágrafos breves e emojis adequados.`;

            const gResult = await generateContentWithFallback(ai, {
              model: "gemini-3.5-flash-lite",
              contents: body,
              config: { systemInstruction: systemPrompt }
            });

            const replyText = gResult.text || "Olá! Recebi sua mensagem no ARVES.";
            await msg.reply(replyText);

            whatsappLogs.unshift({
              id: Math.random().toString(36).substring(2, 11),
              timestamp: Date.now(),
              type: "sent",
              sender: sender,
              message: replyText
            });
            if (whatsappLogs.length > 100) whatsappLogs.pop();
          }
        } catch (err: any) {
          console.error("[WhatsApp] Erro no listener de mensagem:", err);
        }
      });

      wwebjsClient.initialize().catch((err: any) => {
        wwebjsStatus = "erro";
        wwebjsLastError = err?.message || String(err);
        console.error("[WhatsApp] Erro na inicialização do Client:", err);
      });
    } catch (err: any) {
      wwebjsStatus = "erro";
      wwebjsLastError = err?.message || String(err);
      console.error("[WhatsApp] Erro no setup do Client:", err);
    }
  };

  // WhatsApp Web API routes
  app.get("/api/whatsapp/status", (req, res) => {
    res.json({
      status: wwebjsStatus,
      phone: wwebjsPhoneInfo,
      error: wwebjsLastError,
      qrAvailable: !!wwebjsQrBase64,
      virtualState: virtualConnectionState
    });
  });

  app.get("/api/whatsapp/qr", (req, res) => {
    res.json({
      qr: wwebjsQrBase64,
      status: wwebjsStatus
    });
  });

  app.post("/api/whatsapp/connect", async (req, res) => {
    if (wwebjsStatus === "conectado") {
      return res.json({ status: "conectado", message: "WhatsApp já está conectado!" });
    }
    initializeWhatsAppWebClient();
    res.json({ status: "iniciando", message: "Inicializando WhatsApp Web via Puppeteer..." });
  });

  app.post("/api/whatsapp/disconnect", async (req, res) => {
    if (wwebjsClient) {
      try {
        await wwebjsClient.destroy();
      } catch (_) {}
      wwebjsClient = null;
    }
    wwebjsStatus = "desconectado";
    virtualConnectionState = "DISCONNECTED";
    wwebjsQrRaw = "";
    wwebjsQrBase64 = "";
    wwebjsPhoneInfo = {};
    res.json({ status: "desconectado", message: "Sessão do WhatsApp encerrada." });
  });

  // API Endpoints for WhatsApp Frontend configuration
  const getRedactedWhatsAppConfig = () => ({
    apiUrl: whatsappConfig.apiUrl,
    apiKey: "",
    instanceName: whatsappConfig.instanceName,
    enabled: whatsappConfig.enabled,
    geminiApiKey: "",
    hasApiKey: Boolean(whatsappConfig.apiKey),
    hasGeminiApiKey: Boolean(whatsappConfig.geminiApiKey)
  });

  app.get("/api/whatsapp/config", (req, res) => {
    res.json(getRedactedWhatsAppConfig());
  });

  app.post("/api/whatsapp/config", async (req, res) => {
    const { apiUrl, apiKey, instanceName, enabled, geminiApiKey } = req.body;
    try {
      if (apiUrl !== undefined) {
        const normalizedUrl = String(apiUrl).trim();
        if (normalizedUrl) {
          await assertSafeRemoteUrl(
            normalizedUrl,
            process.env.ARVES_ALLOW_PRIVATE_INTEGRATIONS === "true"
          );
        }
        whatsappConfig.apiUrl = normalizedUrl;
      }
      if (apiKey !== undefined && String(apiKey).trim() && String(apiKey).length <= 4096) {
        whatsappConfig.apiKey = String(apiKey);
      }
      if (geminiApiKey !== undefined && String(geminiApiKey).trim() && String(geminiApiKey).length <= 4096) {
        whatsappConfig.geminiApiKey = String(geminiApiKey);
      }
      if (instanceName !== undefined) {
        const cleanInstance = String(instanceName).trim();
        if (!/^[\w.-]{0,120}$/.test(cleanInstance)) {
          return res.status(400).json({ error: "Nome de instância inválido." });
        }
        whatsappConfig.instanceName = cleanInstance;
      }
      if (enabled !== undefined) whatsappConfig.enabled = enabled === true;
    } catch (error: any) {
      return res.status(400).json({ error: error.message || "Configuração inválida." });
    }

    whatsappLogs.unshift({
      id: Math.random().toString(36).substring(2, 11),
      timestamp: Date.now(),
      type: "info",
      sender: "Sistema",
      message: `Configurações salvas: Chatbot ${whatsappConfig.enabled ? "Ativado" : "Desativado"}. Instância: ${whatsappConfig.instanceName}`
    });
    
    res.json({ status: "success", config: getRedactedWhatsAppConfig() });
  });

  app.get("/api/whatsapp/logs", (req, res) => {
    res.json(whatsappLogs);
  });

  app.post("/api/whatsapp/clear-logs", (req, res) => {
    whatsappLogs = [
      {
        id: "clear-" + Date.now(),
        timestamp: Date.now(),
        type: "info",
        sender: "Sistema",
        message: "Histórico de logs do chatbot limpo com sucesso."
      }
    ];
    res.json({ status: "success" });
  });

  // Get and set virtual state for simulated connection
  app.get("/api/whatsapp/virtual-state", (req, res) => {
    res.json({ state: virtualConnectionState });
  });

  app.post("/api/whatsapp/virtual-state", (req, res) => {
    const { state } = req.body;
    if (state !== undefined) {
      virtualConnectionState = state;
    }
    res.json({ success: true, state: virtualConnectionState });
  });

  // Simulate an incoming WhatsApp message
  app.post("/api/whatsapp/simulate-incoming", async (req, res) => {
    try {
      const { senderName, text, remoteJid } = req.body;
      const cleanSender = senderName || "Visitante";
      const cleanJid = remoteJid || "5511999999999@s.whatsapp.net";
      const cleanText = text || "Olá!";

      // Add incoming message to logs
      whatsappLogs.unshift({
        id: Math.random().toString(36).substring(2, 11),
        timestamp: Date.now(),
        type: "received",
        sender: `${cleanSender} (${cleanJid})`,
        message: cleanText
      });
      if (whatsappLogs.length > 100) whatsappLogs.pop();

      // Check if Chatbot autoresponder is enabled
      if (!whatsappConfig.enabled) {
        whatsappLogs.unshift({
          id: Math.random().toString(36).substring(2, 11),
          timestamp: Date.now(),
          type: "info",
          sender: "Sistema",
          message: `Mensagem de ${cleanSender} recebida, mas o chatbot está desativado no painel.`
        });
        if (whatsappLogs.length > 100) whatsappLogs.pop();
        return res.json({ status: "ignored", reason: "Autoresponder is disabled" });
      }

      const geminiApiKeyToUse = whatsappConfig.geminiApiKey || getSecretGeminiKey();
      if (!geminiApiKeyToUse) {
        whatsappLogs.unshift({
          id: Math.random().toString(36).substring(2, 11),
          timestamp: Date.now(),
          type: "error",
          sender: "Sistema",
          message: `Mensagem de ${cleanSender} recebida via simulação, mas a chave API do Gemini não foi encontrada no ARVES.`
        });
        if (whatsappLogs.length > 100) whatsappLogs.pop();
        return res.json({ status: "error", error: "Gemini API key is not configured" });
      }

      // Use modern GoogleGenAI SDK to speak with Gemini 3.5-flash-lite
      const ai = new GoogleGenAI({ apiKey: geminiApiKeyToUse, vertexai: false });
      const systemPrompt = `Você é o ARVES G5, o cérebro eletrônico central de inteligência artificial de elite, hiperfocado em ajudar o usuário com uma clareza deslumbrante, respostas estruturadas, elegantes e um toque futurista e polido.
${ARVES_IDENTITY_INSTRUCTION}
Você está atendendo o usuário pelo WhatsApp em nome do proprietário deste dispositivo ARVES. Responda diretamente e com muita inteligência, clareza, formatação impecável de parágrafos breves e emojis adequados.
Nome do interlocutor: ${cleanSender}`;

      const gResult = await generateContentWithFallback(ai, {
        model: "gemini-3.5-flash-lite",
        contents: cleanText,
        config: {
          systemInstruction: systemPrompt
        }
      });
      
      const replyText = gResult.text || "Ops! Meu cérebro digital oscilou, por favor tente novamente.";

      whatsappLogs.unshift({
        id: Math.random().toString(36).substring(2, 11),
        timestamp: Date.now(),
        type: "sent",
        sender: `${cleanSender} (${cleanJid})`,
        message: cleanText,
        response: replyText
      });
      if (whatsappLogs.length > 100) whatsappLogs.pop();

      return res.json({ status: "success", reply: replyText });
    } catch (e: any) {
      console.log("[Simulation log info]: Simulação falhou ou não encontrou chave:", e.message || e);
      return res.status(500).json({ status: "error", error: e?.message || e });
    }
  });

  // Proxy requests server-side to bypass CORS block / Failed to fetch
  app.post("/api/whatsapp/proxy", async (req, res) => {
    let targetUrl = "";
    try {
      const { endpoint, method, body } = req.body;
      if (!endpoint || typeof endpoint !== "string" || endpoint.length > 2048) {
        return res.status(400).json({ error: "Nenhum endpoint especificado para o proxy." });
      }

      if (!whatsappConfig.apiUrl) {
        return res.status(400).json({ error: "A URL da API Evolution não está configurada." });
      }
      const baseUrl = await assertSafeRemoteUrl(
        whatsappConfig.apiUrl,
        process.env.ARVES_ALLOW_PRIVATE_INTEGRATIONS === "true"
      );
      const resolvedTarget = new URL(endpoint, baseUrl);
      if (resolvedTarget.origin !== baseUrl.origin) {
        return res.status(403).json({ error: "O proxy só pode acessar a origem da API Evolution configurada." });
      }
      await assertSafeRemoteUrl(
        resolvedTarget.toString(),
        process.env.ARVES_ALLOW_PRIVATE_INTEGRATIONS === "true"
      );
      targetUrl = resolvedTarget.toString();

      const normalizedMethod = String(method || "GET").toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(normalizedMethod)) {
        return res.status(405).json({ error: "Método não permitido no proxy." });
      }

      const fetchOptions: any = {
        method: normalizedMethod,
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(12_000)
      };

      if (body !== undefined && ["POST", "PUT", "PATCH"].includes(normalizedMethod)) {
        const serializedBody = typeof body === "string" ? body : JSON.stringify(body);
        if (Buffer.byteLength(serializedBody) > 2 * 1024 * 1024) {
          return res.status(413).json({ error: "Corpo da solicitação excede 2 MB." });
        }
        fetchOptions.body = serializedBody;
      }

      // Adiciona apikey se configurado no servidor, caso não enviado
      if (whatsappConfig.apiKey && !fetchOptions.headers["apikey"]) {
        fetchOptions.headers["apikey"] = whatsappConfig.apiKey;
      }

      const response = await fetch(targetUrl, fetchOptions);
      if (response.status >= 300 && response.status < 400) {
        return res.status(502).json({ error: "Redirecionamentos externos foram bloqueados pelo proxy." });
      }
      const responseText = await readResponseTextLimited(response, 2 * 1024 * 1024);
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        try {
          return res.status(response.status).json(JSON.parse(responseText));
        } catch {}
      }
      res.type("text/plain").status(response.status).send(responseText);
    } catch (e: any) {
      const isOffline = e.message?.includes("ENOTFOUND") || 
                        e.message?.includes("fetch failed") || 
                        e.code === "ENOTFOUND" || 
                        e.code === "ECONNREFUSED" || 
                        e.code === "EAI_AGAIN";
                        
      if (isOffline) {
        console.log("[WhatsApp Proxy Info] Evolution API URL está offline ou inacessível no momento:", targetUrl);
      } else {
        console.log("[WhatsApp Proxy Warning] Ocorreu um erro no encaminhamento:", e.message || e);
      }
      
      res.status(isOffline ? 503 : 500).json({ 
        error: "Evolution API offline ou endereço inacessível.", 
        isOffline: true,
        details: process.env.NODE_ENV === "development" ? sanitizeMessageOfKeys(e.message || "Erro desconhecido") : undefined
      });
    }
  });

  // Endpoint de inteligência para preencher Dossiê com arquivo ou PDF de referência
  app.post("/api/dossier/analyze", async (req, res) => {
    try {
      const { fileData, mimeType, questions, currentAnswers } = req.body;
      if (!fileData) {
        return res.status(400).json({ error: "Nenhum arquivo de referência foi enviado." });
      }
      if (!questions || !Array.isArray(questions)) {
        return res.status(400).json({ error: "A lista de perguntas é necessária para alinhar o mapeamento." });
      }

      const apiKey = getSecretGeminiKey();
      if (!apiKey) {
        return res.status(400).json({ error: "A API Key do Gemini não está configurada no painel de Secrets. Por favor, adicione-a para habilitar análise de referência." });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      // Prepare parts for Gemini based on MIME type
      const parts: any[] = [];

      if (mimeType === "application/pdf") {
        parts.push({
          inlineData: {
            data: fileData, // Already expected to be base64 from client
            mimeType: "application/pdf"
          }
        });
      } else {
        // Assume text file
        try {
          const decodedText = Buffer.from(fileData, 'base64').toString('utf8');
          parts.push({
            text: `DOCUMENTO DE REFERÊNCIA:\n\n${decodedText}`
          });
        } catch (errDec) {
          // Fallback if decode fails, try passing as inline text direct
          parts.push({
            inlineData: {
              data: fileData,
              mimeType: mimeType || "text/plain"
            }
          });
        }
      }

      // Add prompt with instructions and questions
      const prompt = `
Você é uma inteligência de elite integrada ao ecossistema ARVES.
Analise cuidadosamente o documento de referência fornecido acima sobre o Criador/Usuário do ARVES.
Sua missão é extrair e preencher as respostas do "Dossiê de Memória Íntima" com base UNICAMENTE nos fatos reais documentados na referência de forma natural, humana e direta, sem rodeios ou floreios artificiais.

Aqui está o conjunto de perguntas e seus IDs numéricos:
${JSON.stringify(questions.map((q: any) => ({ id: q.id, question: q.question })))}

Respostas Atuais cadastradas (as respostas já fornecidas):
${JSON.stringify(currentAnswers || {})}

Instruções Cruciais:
1. Extraia respostas precisas apenas para as perguntas cujas informações estejam claramente documentadas na referência fornecida.
2. Não invente ou presuma fatos adicionais. Se a referência não tiver dados para responder a uma pergunta, ignore-a de volta (não mande resposta pra ela).
3. Escreva respostas bem estruturadas, humanizadas, maduras, em primeira ou terceira pessoa (preferencialmente mantendo o estilo de notas pessoais, ex: "Mora em São Paulo, Brasil e tem 28 anos").
4. Caso a pergunta já tenha uma resposta atual válida em 'Respostas Atuais', priorize a resposta atual e mantenha a consistência, a menos que a referência traga dados cruciais mais completos ou que preencham por completo uma lacuna vazia.
5. Retorne os resultados obrigatoriamente no esquema JSON solicitado no responseSchema, onde as chaves são os IDs numéricos em formato de string (por exemplo, "1", "2") e os valores são as novas respostas extraídas.

Retorne SOMENTE o objeto JSON conforme o esquema.
`;

      parts.push({ text: prompt });

      // Call Gemini with structured JSON response config and fallbacks
      const response = await generateContentWithFallback(ai, {
        model: "gemini-3.6-flash",
        contents: { parts },
        config: {
          responseMimeType: "application/json",
          systemInstruction: "Você é um assistente cirúrgico de extração de dados pessoais. Analisa referências biográficas e preenche relatórios de forma factual, mantendo o estilo direto do usuário. Retorna JSON puro.",
          temperature: 0.2,
        },
      });

      const resultText = response.text?.trim() || "{}";
      let cleanJson = resultText;
      if (cleanJson.includes("```")) {
        // Strip markdown backticks
        cleanJson = cleanJson.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");
      }
      const parsedAnswers = JSON.parse(cleanJson);

      res.json({
        status: "success",
        answers: parsedAnswers
      });

    } catch (e: any) {
      console.error("Erro ao analisar dossiê de referência:", e);
      res.status(500).json({ error: formatGeminiError(e) });
    }
  });

  // ====== NEURAL CONNECTION MEMORY SYNC ENDPOINTS ======
  // Choose safe paths in OS temp folder (writable in severless containers like Cloud Run)
  const SYNC_FILE_PATH = path.join(os.tmpdir(), "arves-sync-profiles.json");
  
  // Shared global memory fallback for 100% database/filesystem-free reliability 
  let inMemorySyncProfiles: Record<string, any> = {};

  // Helper to read sync profiles
  const readSyncProfiles = (): Record<string, any> => {
    try {
      if (Object.keys(inMemorySyncProfiles).length === 0) {
        // Try filling from temporary file storage if in-memory is empty
        if (fs.existsSync(SYNC_FILE_PATH)) {
          const raw = fs.readFileSync(SYNC_FILE_PATH, "utf8");
          inMemorySyncProfiles = JSON.parse(raw);
        }
      }
    } catch (e) {
      console.error("Error reading sync-profiles from temporary storage:", e);
    }
    return inMemorySyncProfiles;
  };

  // Helper to write sync profiles
  const writeSyncProfiles = (data: Record<string, any>) => {
    try {
      inMemorySyncProfiles = data;
      // Best-effort cache file writing
      fs.writeFileSync(SYNC_FILE_PATH, JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
      console.warn("Writing to temp directory deferred. Proceeding with active RAM backup:", e.message);
    }
  };

  const isSafeSyncKey = (key: string): boolean => {
    const normalized = key.toLowerCase();
    const sensitiveFragments = [
      "api_key",
      "api_keys",
      "apikey",
      "access_token",
      "oauth",
      "password",
      "secret",
      "credential",
      "google_home",
      "smarthome",
      "whatsapp",
      "obsidian"
    ];
    return normalized.startsWith("arves_") && !sensitiveFragments.some(fragment => normalized.includes(fragment));
  };

  const sanitizeSyncPayload = (input: unknown): Record<string, string> => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Payload de sincronização inválido.");
    }
    const entries = Object.entries(input as Record<string, unknown>);
    if (entries.length > 200) throw new Error("Muitos campos no backup.");
    const safePayload: Record<string, string> = {};
    let totalBytes = 0;
    for (const [key, value] of entries) {
      if (!isSafeSyncKey(key) || typeof value !== "string") continue;
      const valueBytes = Buffer.byteLength(value);
      if (valueBytes > 512 * 1024) throw new Error(`Campo de backup muito grande: ${key}`);
      totalBytes += valueBytes;
      if (totalBytes > 2 * 1024 * 1024) throw new Error("Backup excede o limite de 2 MB.");
      if (
        /AIzaSy[A-Za-z0-9_-]{20,}/.test(value) ||
        /(?:sk|tvly)-[A-Za-z0-9_-]{20,}/i.test(value) ||
        /"(?:apiKey|accessToken|clientSecret|password)"\s*:\s*"[^"]{8,}"/i.test(value)
      ) {
        throw new Error("O backup parece conter uma credencial. Remova chaves e tokens antes de sincronizar.");
      }
      safePayload[key] = value;
    }
    return safePayload;
  };

  // POST to save memory sync profile
  app.post("/api/memory-sync/save", (req, res) => {
    try {
      const { syncId, payload } = req.body;
      if (!payload) {
        return res.status(400).json({ status: "error", error: "Missing payload" });
      }
      const safePayload = sanitizeSyncPayload(payload);

      let targetSyncId = syncId;
      const profiles = readSyncProfiles();

      if (!targetSyncId) {
        // ID imprevisível para evitar enumeração de backups.
        const createSyncId = () => {
          const random = randomBytes(10).toString("hex").toUpperCase();
          return `ARVES-${random.slice(0, 5)}-${random.slice(5, 10)}-${random.slice(10, 15)}-${random.slice(15, 20)}`;
        };
        targetSyncId = createSyncId();
        while (profiles[targetSyncId]) {
          targetSyncId = createSyncId();
        }
      } else {
        // Clean and sanitize syncId
        targetSyncId = String(targetSyncId).trim().toUpperCase();
        if (!/^[A-Z0-9_-]{3,32}$/.test(targetSyncId)) {
          return res.status(400).json({ 
            status: "error", 
            error: "O ID deve conter de 3 a 32 caracteres alfanuméricos, hífen ou underline." 
          });
        }
      }

      profiles[targetSyncId] = {
        createdAt: profiles[targetSyncId]?.createdAt || Date.now(),
        updatedAt: Date.now(),
        payload: safePayload
      };

      writeSyncProfiles(profiles);
      res.json({ status: "success", syncId: targetSyncId, profilesCount: Object.keys(profiles).length });
    } catch (error: any) {
      console.warn("Backup de memória recusado:", sanitizeMessageOfKeys(error?.message || String(error)));
      res.status(400).json({ status: "error", error: sanitizeMessageOfKeys(error?.message || "Backup inválido.") });
    }
  });

  // GET to load memory sync profile
  app.get("/api/memory-sync/load/:syncId", (req, res) => {
    try {
      const syncId = String(req.params.syncId).trim().toUpperCase();
      const profiles = readSyncProfiles();
      const profile = profiles[syncId];

      if (!profile) {
        return res.status(404).json({ 
          status: "error", 
          error: "ID de Conexão Neural não encontrado. Verifique se o ID está correto." 
        });
      }

      res.json({ 
        status: "success", 
        syncId, 
        createdAt: profile.createdAt, 
        updatedAt: profile.updatedAt, 
        payload: sanitizeSyncPayload(profile.payload)
      });
    } catch (error: any) {
      console.error("Error loading memory sync:", error);
      res.status(500).json({ status: "error", error: error.message });
    }
  });

  // Webhook Receiver from Evolution API (e.g. listening to messages.upsert)
  app.post("/api/whatsapp/webhook", async (req, res) => {
    try {
      const webhookSecret = (process.env.ARVES_WEBHOOK_SECRET || "").trim();
      if (process.env.NODE_ENV === "production" && !webhookSecret) {
        return res.status(503).json({ error: "Webhook desativado: configure ARVES_WEBHOOK_SECRET no servidor." });
      }
      if (webhookSecret && !safeSecretEqual(req.get("x-arves-webhook-secret"), webhookSecret)) {
        return res.status(401).json({ error: "Assinatura do webhook ausente ou inválida." });
      }
      const body = req.body;
      const eventType = body.event || body.type;

      // Log webhook ping or payload received
      console.log("Evolution API Webhook received:", eventType || "ping/raw");

      // Verify if it's indeed message creation
      if (eventType && eventType !== "messages.upsert" && eventType !== "values.upsert" && eventType !== "messages.create") {
         return res.json({ status: "ignored", reason: "Unmanaged webhook event types: " + eventType });
      }

      const data = body.data;
      if (!data) {
        return res.json({ status: "ignored", reason: "No data payload inside webhook" });
      }

      // Evitar loop infinito do bot respondendo a si mesmo
      const fromMe = data.key?.fromMe;
      if (fromMe === true) {
        return res.json({ status: "ignored", reason: "Self message (fromMe: true)" });
      }

      const remoteJid = data.key?.remoteJid;
      const senderName = data.pushName || "Usuário WhatsApp";
      const originalMessage = data.message;
      
      // Extract clean textual incoming string
      const text = originalMessage?.conversation || 
                   originalMessage?.extendedTextMessage?.text || 
                   originalMessage?.imageMessage?.caption || 
                   body.text || "";

      if (!text || !remoteJid) {
        return res.json({ status: "ignored", reason: "Missing remoteJid or content text" });
      }

      // Check if Chatbot autoresponder is enabled
      if (!whatsappConfig.enabled) {
        whatsappLogs.unshift({
          id: Math.random().toString(36).substring(2, 11),
          timestamp: Date.now(),
          type: "received",
          sender: `${senderName} (${remoteJid})`,
          message: text,
          response: "[Auto-resposta inativa no painel]"
        });
        if (whatsappLogs.length > 100) whatsappLogs.pop();
        return res.json({ status: "ignored", reason: "Autoresponder is disabled" });
      }

      const geminiApiKeyToUse = whatsappConfig.geminiApiKey || getSecretGeminiKey();
      if (!geminiApiKeyToUse) {
        whatsappLogs.unshift({
          id: Math.random().toString(36).substring(2, 11),
          timestamp: Date.now(),
          type: "error",
          sender: "Sistema",
          message: `Mensagem de ${senderName} recebida, mas a chave API do Gemini não foi encontrada no ARVES.`
        });
        if (whatsappLogs.length > 100) whatsappLogs.pop();
        return res.json({ status: "error", error: "Gemini API key is not configured" });
      }

      // Use modern GoogleGenAI SDK to speak with Gemini 3.5-flash-lite (forcing Developer API over Vertex AI)
      const ai = new GoogleGenAI({ apiKey: geminiApiKeyToUse, vertexai: false });
      const systemPrompt = `Você é o ARVES G5, o cérebro eletrônico central de inteligência artificial de elite, hiperfocado em ajudar o usuário com uma clareza deslumbrante, respostas estruturadas, elegantes e um toque futurista e polido.
${ARVES_IDENTITY_INSTRUCTION}
Você está atendendo o usuário pelo WhatsApp em nome do proprietário deste dispositivo ARVES. Responda diretamente e com muita inteligência, clareza, formatação impecável de parágrafos breves e emojis adequados.
Nome do interlocutor: ${senderName}`;

      const gResult = await generateContentWithFallback(ai, {
        model: "gemini-3.5-flash-lite",
        contents: text,
        config: {
          systemInstruction: systemPrompt
        }
      });
      
      const replyText = gResult.text || "Ops! Meu cérebro digital oscilou, por favor tente novamente.";

      // Dispatch to Evolution API
      const cleanApiUrl = whatsappConfig.apiUrl.endsWith('/') ? whatsappConfig.apiUrl.slice(0, -1) : whatsappConfig.apiUrl;
      const sendUrl = `${cleanApiUrl}/message/sendText/${whatsappConfig.instanceName}`;
      
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (whatsappConfig.apiKey) {
        headers["apikey"] = whatsappConfig.apiKey;
      }

      const response = await fetch(sendUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          number: remoteJid,
          text: replyText,
          textMessage: {
            text: replyText
          }
        })
      });

      if (!response.ok) {
        const errVal = await response.text();
        throw new Error(`Evolution API HTTP ${response.status}: ${errVal}`);
      }

      whatsappLogs.unshift({
        id: Math.random().toString(36).substring(2, 11),
        timestamp: Date.now(),
        type: "sent",
        sender: `${senderName} (${remoteJid})`,
        message: text,
        response: replyText
      });
      if (whatsappLogs.length > 100) whatsappLogs.pop();

      return res.json({ status: "success", senderName, replied: true });
    } catch (e: any) {
      console.error("Critical error inside WhatsApp webhook receiver:", e);
      whatsappLogs.unshift({
        id: Math.random().toString(36).substring(2, 11),
        timestamp: Date.now(),
        type: "error",
        sender: "Webhook ARVES",
        message: `Falha ao processar mensagem recebida: ${e?.message || e}`
      });
      if (whatsappLogs.length > 100) whatsappLogs.pop();
      return res.status(500).json({ status: "error", error: e?.message || e });
    }
  });

  // Helper to construct a standard WAV container header for raw 16-bit Mono PCM streams
  function pcmToWav(pcmBuffer: Buffer, sampleRate: number = 24000, numChannels: number = 1, bitsPerSample: number = 16): Buffer {
    const header = Buffer.alloc(44);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmBuffer.length;
    const chunkSize = 36 + dataSize;

    // RIFF identifier
    header.write("RIFF", 0);
    // File length minus RIFF header (8 bytes)
    header.writeUInt32LE(chunkSize, 4);
    // RIFF type
    header.write("WAVE", 8);
    // Format chunk identifier (fmt with trailing space)
    header.write("fmt ", 12);
    // Format chunk size (16 for PCM)
    header.writeUInt32LE(16, 16);
    // Sample format (1 for PCM)
    header.writeUInt16LE(1, 20);
    // Channel count
    header.writeUInt16LE(numChannels, 22);
    // Sample rate
    header.writeUInt32LE(sampleRate, 24);
    // Byte rate
    header.writeUInt32LE(byteRate, 28);
    // Block align
    header.writeUInt16LE(blockAlign, 32);
    // Bits per sample
    header.writeUInt16LE(bitsPerSample, 34);
    // Data chunk identifier
    header.write("data", 36);
    // Data chunk size
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmBuffer]);
  }

  // helper to split text into chunks safely for Google Translate TTS API (200 char limit) - Kept as fallback or general reference
  function splitIntoChunks(text: string, maxLength: number = 200): string[] {
    const chunks: string[] = [];
    let currentChunk = "";
    const sentences = text.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+/g) || [text];
    
    for (const sentence of sentences) {
      if ((currentChunk + sentence).length <= maxLength) {
        currentChunk += sentence;
      } else {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
        if (sentence.length > maxLength) {
          const words = sentence.split(/\s+/);
          let wordChunk = "";
          for (const word of words) {
            if ((wordChunk + " " + word).length <= maxLength) {
              wordChunk += (wordChunk ? " " : "") + word;
            } else {
              if (wordChunk.trim()) {
                chunks.push(wordChunk.trim());
              }
              wordChunk = word;
            }
          }
          currentChunk = wordChunk;
        } else {
          currentChunk = sentence;
        }
      }
    }
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    return chunks;
  }

  // helper to split text into optimal paragraph/sentence chunks for premium Gemini 3.1 TTS
  function splitIntoTtsChunks(text: string, maxLength: number = 800): string[] {
    const chunks: string[] = [];
    let currentChunk = "";
    const sentences = text.match(/[^.!?\n\r]+[.!?\n\r]+|[^.!?\n\r]+/g) || [text];
    
    for (const sentence of sentences) {
      if ((currentChunk + " " + sentence).length <= maxLength) {
        currentChunk += (currentChunk ? " " : "") + sentence;
      } else {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
        if (sentence.length > maxLength) {
          const words = sentence.split(/\s+/);
          let wordChunk = "";
          for (const word of words) {
            if ((wordChunk + " " + word).length <= maxLength) {
              wordChunk += (wordChunk ? " " : "") + word;
            } else {
              if (wordChunk.trim()) {
                chunks.push(wordChunk.trim());
              }
              wordChunk = word;
            }
          }
          currentChunk = wordChunk;
        } else {
          currentChunk = sentence;
        }
      }
    }
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    return chunks;
  }

  function stripVocalTags(text: string): string {
    return text.replace(/\[[^\]]+\]/g, "").replace(/\([^)]+\)/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  }

  // POST endpoint for high-quality, consolidated Premium Gemini 3.1 TTS or ElevenLabs voice synthesis
  app.post("/api/tts", async (req, res) => {
    try {
      const { 
        text, 
        engine, 
        clientApiKey, 
        voice, 
        elevenLabsApiKey, 
        elevenLabsVoiceId,
        elevenLabsStability,
        elevenLabsSimilarityBoost,
        elevenLabsStyle,
        elevenLabsSpeakerBoost,
        elevenLabsModel,
        vocalProfileEscarlate
      } = req.body;

      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "O texto é obrigatório para conversão de áudio." });
      }

      const cleanText = text.trim();
      if (!cleanText) {
        return res.status(400).json({ error: "O texto está vazio." });
      }
      if (cleanText.length > 8_000) {
        return res.status(413).json({ error: "O texto para voz excede o limite de 8.000 caracteres." });
      }

      // ELEVENLABS ENGINE ROUTE
      if (engine === 'elevenlabs') {
        const elApiKey = elevenLabsApiKey || process.env.ELEVENLABS_API_KEY;
        if (!elApiKey) {
          return res.status(400).json({ 
            error: "A chave API da ElevenLabs não foi configurada. Por favor, especifique uma na aba 'Chaves' das Configurações." 
          });
        }

        const cleanTextForEleven = stripVocalTags(cleanText);

        const rawVoiceId = elevenLabsVoiceId || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
        const voiceId = /^[A-Za-z0-9_-]{1,120}$/.test(rawVoiceId) ? rawVoiceId : "21m00Tcm4TlvDq8ikWAM";
        const stability = typeof elevenLabsStability === "number" ? Math.min(1, Math.max(0, elevenLabsStability)) : 0.5;
        const similarity_boost = typeof elevenLabsSimilarityBoost === "number" ? Math.min(1, Math.max(0, elevenLabsSimilarityBoost)) : 0.75;
        const style = typeof elevenLabsStyle === "number" ? Math.min(1, Math.max(0, elevenLabsStyle)) : 0.0;
        const use_speaker_boost = typeof elevenLabsSpeakerBoost === "boolean" ? elevenLabsSpeakerBoost : true;
        const modelId = typeof elevenLabsModel === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(elevenLabsModel)
          ? elevenLabsModel
          : "eleven_turbo_v2_5";

        let response: Response | null = null;
        let lastError = "";

        // Attempt 1: Using selected model & custom voice settings
        try {
          response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
            method: "POST",
            headers: {
              "xi-api-key": elApiKey,
              "Content-Type": "application/json",
              "accept": "audio/mpeg"
            },
            body: JSON.stringify({
              text: cleanTextForEleven,
              model_id: modelId,
              voice_settings: {
                stability,
                similarity_boost,
                style,
                use_speaker_boost
              }
            }),
            signal: AbortSignal.timeout(30_000)
          });
        } catch (err: any) {
          lastError = err.message || "Erro de conexão inicial ElevenLabs API";
        }

        // Attempt 2: Fallback with "eleven_multilingual_v2" if standard failed
        if (!response || !response.ok) {
          console.warn(`ElevenLabs API failed (Model: ${modelId}). Retrying with eleven_multilingual_v2 fallback...`);
          try {
            response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
              method: "POST",
              headers: {
                "xi-api-key": elApiKey,
                "Content-Type": "application/json",
                "accept": "audio/mpeg"
              },
              body: JSON.stringify({
                text: cleanTextForEleven,
                model_id: "eleven_multilingual_v2",
                voice_settings: {
                  stability: 0.5,
                  similarity_boost: 0.75
                }
              }),
              signal: AbortSignal.timeout(30_000)
            });
          } catch (retryErr: any) {
            lastError = retryErr.message || "Falha de conexão no segundo teste de ElevenLabs";
          }
        }

        // Final verification
        if (!response || !response.ok) {
          const status = response ? response.status : 500;
          let errText = lastError;
          if (response) {
            try {
              errText = await response.text();
            } catch (_) {}
          }
          
          let errorMessage = errText;
          try {
            const parsed = JSON.parse(errText);
            if (parsed.detail && typeof parsed.detail === 'object') {
              errorMessage = parsed.detail.message || JSON.stringify(parsed.detail);
            } else if (parsed.detail) {
              errorMessage = parsed.detail;
            }
          } catch (_) {}

          return res.status(status).json({
            error: `ElevenLabs recusou a síntese: ${sanitizeMessageOfKeys(errorMessage || "Sem resposta ou chave inválida")}`
          });
        }

        // Retrieve and send the ElevenLabs synthesized audio as a single buffer
        const audioBuffer = await readResponseBufferLimited(response, 15 * 1024 * 1024);
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("X-TTS-Mode", "elevenlabs");
        return res.send(audioBuffer);
      }

      // GEMINI 3.1 ENGINE ROUTE (DEFAULT)
      // Check for available API Keys
      const apiKey = clientApiKey || getSecretGeminiKey();
      if (!apiKey) {
        return res.status(400).json({ 
          error: "A chave API do Gemini não foi encontrada. Por favor, especifique uma nos Ajustes para utilizar a Voz Premium." 
        });
      }

      // Initialize the Gemini SDK (forcing Developer API over Vertex AI)
      const ai = new GoogleGenAI({
        apiKey,
        vertexai: false,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });

      // Split the prose into safer, reliable chunks (up to 700 characters) to avoid 500 timeouts/failures
      const chunks = splitIntoTtsChunks(cleanText, 700);
      const buffers: Buffer[] = [];
      let usedFallback = false;

      // Selected voice defaults to 'Kore' (highly natural female narrator in Portuguese)
      const supportedGeminiVoices = ["Puck", "Charon", "Kore", "Fenrir", "Zephyr", "Aoede", "Scarlet"];
      let selectedVoice = voice || "Kore";
      const isScarletVoice = selectedVoice === "Scarlet" || selectedVoice === "Fenrir";
      if (!supportedGeminiVoices.includes(selectedVoice)) {
        selectedVoice = "Kore"; // Map unsupported voices like 'Scarlet' to 'Kore'
      }
      if (selectedVoice === "Scarlet") {
        selectedVoice = "Fenrir";
      }

      for (const chunk of chunks) {
        let chunkAudioBuffer: Buffer | null = null;
        const processedChunk = isScarletVoice ? chunk : stripVocalTags(chunk);
        
        // Tiered model candidates list of premium intelligent voice models
        const candidateModels = [
          "gemini-3.1-flash-tts-preview",
          "gemini-3.6-flash",
          "gemini-3.5-flash-lite",
          "gemini-3.1-flash-lite",
          "gemini-2.5-flash"
        ];

        for (const modelName of candidateModels) {
          try {
            let promptText = `Leia o seguinte trecho com clareza absoluta, expressividade natural, pausas realistas e ritmo agradável de palestrante:\n\n${processedChunk}`;
            if (isScarletVoice) {
              const characteristics = vocalProfileEscarlate || "voz profunda, ressonante, de sabedoria cósmica, pausada e misteriosa";
              promptText = `Aja como o Arves Sensus: especialista em Ciência Comportamental de IA e Física Aplicada ao Comportamento Humano (Futurista Comportamental Quântico). É uma IA de sabedoria cósmica, profunda, instigante, misteriosa e altamente perspicaz.
Você deve encenar perfeitamente as seguintes CARACTERÍSTICAS DE PERFIL VOCAL específicas:
=== CARACTERÍSTICAS DE PERFIL VOCAL ===
${characteristics}
=======================================

Leia o trecho de texto abaixo encenando de acordo com esse perfil de voz futurista quântico, com alto nível de expressividade, nuances instigantes e tom cósmico profundo.
IMPORTANTE: Se houver qualquer tag de sentimento ou instrução vocal entre colchetes (como [sussurro], [tenso], [irritado], [sombrio], [ameaçador], [gargalhada], [drama], [rindo], [frio]) no texto original, você deve interpretar e inferir essas variações vocais perfeitamente em sua voz, mas NUNCA, SOB HIPÓTESE ALGUMA, pronunciar ou dizer as palavras da tag em voz alta! Apenas interprete o sentimento correspondente de forma magnífica de acordo com as instruções.
Adapte as transições de ritmo para soar perturbadoramente inteligente.
Texto para leitura:
${processedChunk}`;
            }

            const response = await ai.models.generateContent({
              model: modelName,
              contents: [{ parts: [{ text: promptText }] }],
              config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: selectedVoice },
                  },
                },
              },
            });

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              chunkAudioBuffer = Buffer.from(base64Audio, 'base64');
              console.log(`Successfully generated intelligent voice chunk utilizing candidate model: ${modelName}`);
              break; // Success, exit model candidates loop for this chunk
            }
          } catch (chunkError: any) {
            console.warn(`Candidate model ${modelName} encountered error for premium voice generation:`, chunkError?.message || chunkError);
          }
        }

        if (chunkAudioBuffer) {
          buffers.push(chunkAudioBuffer);
        } else {
          console.warn("All premium Gemini models failed. Resorting to standard fallback for chunk.");
          usedFallback = true;
          
          // Google Translate fallback for this specific chunk
          const subChunks = splitIntoChunks(stripVocalTags(processedChunk), 180);
          for (const subChunk of subChunks) {
            try {
              const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=pt-BR&client=tw-ob&q=${encodeURIComponent(subChunk)}`;
              const fbResponse = await fetch(url, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                }
              });
              if (fbResponse.ok) {
                const arrayBuffer = await fbResponse.arrayBuffer();
                buffers.push(Buffer.from(arrayBuffer));
              }
            } catch (fbErr) {
              console.error("Failed standard fallback synthesis for chunk:", fbErr);
            }
          }
        }
      }

      if (buffers.length === 0) {
        return res.status(500).json({ error: "Nenhum áudio pôde ser gerado por nenhum dos serviços de voz." });
      }

      const finalPcmBuffer = Buffer.concat(buffers);

      if (usedFallback) {
        // If Google Translate fallback was used, the audio container is MP3
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Disposition", "attachment; filename=prosa_arves.mp3");
        res.setHeader("X-TTS-Mode", "fallback");
        res.send(finalPcmBuffer);
      } else {
        // High fidelity WAV container for raw Mono 24kHz PCM from Gemini 3.1
        const wavBuffer = pcmToWav(finalPcmBuffer, 24000);
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Content-Disposition", "attachment; filename=prosa_arves.wav");
        res.setHeader("X-TTS-Mode", "premium");
        res.send(wavBuffer);
      }
    } catch (err: any) {
      console.error("Critical error inside premium /api/tts endpoint:", sanitizeMessageOfKeys(err?.message || String(err)));
      res.status(500).json({ error: sanitizeMessageOfKeys(err?.message || "Erro no servidor ao sintetizar áudio com Gemini 3.1.") });
    }
  });

  // Helper to run content generation with automated fallbacks
  async function generateContentWithFallback(ai: GoogleGenAI, params: { model: string; contents: any; config?: any }) {
    const primaryModel = params.model || "gemini-2.5-flash";
    
    // Tiered candidates using standard highly-available Gemini 2.5 and 3.x models
    const modelsToTry = [
      primaryModel, 
      "gemini-2.5-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-3.5-flash"
    ];
    
    // Remove duplicates keeping order
    const uniqueModels = Array.from(new Set(modelsToTry));
    
    let lastError: any = null;
    for (const modelName of uniqueModels) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          console.log(`Trying Gemini content generation (Model: ${modelName}, Attempt: ${attempt})`);
          const response = await ai.models.generateContent({
            model: modelName,
            contents: params.contents,
            config: params.config
          });
          return response;
        } catch (err: any) {
          lastError = err;
          const errMsg = err?.message || String(err);
          const isQuota = errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("limit");
          const isTransient = (errMsg.includes("503") || errMsg.includes("UNAVAILABLE") || errMsg.toLowerCase().includes("high demand")) && !isQuota;
          
          if (isQuota || (isTransient && attempt >= 1)) {
            // For quota or transient high demand errors, immediately try next model candidate
            console.warn(`[Fallback Log] Model ${modelName} encountered transient/quota issue. Switching to next candidate model...`);
            break;
          }
          
          console.log(`[Fallback Log] Model ${modelName} attempt ${attempt} returned exception:`, errMsg);
          break; // Move to next candidate model
        }
      }
    }
    throw lastError;
  }

  // Helper to run content stream generation with automated fallbacks
  async function generateContentStreamWithFallback(ai: GoogleGenAI, params: { model: string; contents: any; config?: any }) {
    const primaryModel = params.model || "gemini-2.5-flash";
    
    // Tiered candidates using standard highly-available Gemini 2.5 and 3.x models
    const modelsToTry = [
      primaryModel, 
      "gemini-2.5-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-3.5-flash"
    ];
    
    // Remove duplicates keeping order
    const uniqueModels = Array.from(new Set(modelsToTry));
    
    let lastError: any = null;
    for (const modelName of uniqueModels) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          console.log(`Trying Gemini content stream generation (Model: ${modelName}, Attempt: ${attempt})`);
          const stream = await ai.models.generateContentStream({
            model: modelName,
            contents: params.contents,
            config: params.config
          });
          return stream;
        } catch (err: any) {
          lastError = err;
          const errMsg = err?.message || String(err);
          const isQuota = errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("limit");
          const isTransient = (errMsg.includes("503") || errMsg.includes("UNAVAILABLE") || errMsg.toLowerCase().includes("high demand")) && !isQuota;
          
          if (isQuota || (isTransient && attempt >= 1)) {
            console.warn(`[Fallback Stream Log] Model ${modelName} encountered transient/quota issue. Switching to next candidate model...`);
            break;
          }
          
          console.log(`[Fallback Stream Log] Model ${modelName} attempt ${attempt} returned exception:`, errMsg);
          break; // Move to next candidate model
        }
      }
    }
    throw lastError;
  }

  // POST endpoint for high-quality, server-run intelligence completion using gemini-2.5-flash
  app.post("/api/chat-intel", async (req, res) => {
    try {
      const { historyContents, systemInstruction, clientApiKey } = req.body;
      const apiKey = clientApiKey || getSecretGeminiKey();
      if (!apiKey) {
        return res.status(400).json({ error: "Chave API do Gemini não definida no servidor." });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        vertexai: false,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const response = await generateContentWithFallback(ai, {
        model: "gemini-3.6-flash",
        contents: historyContents,
        config: {
          maxOutputTokens: 250,
          temperature: 0.7,
          systemInstruction: systemInstruction
        }
      });

      return res.json({ text: response.text || "" });
    } catch (err: any) {
      console.error("Error inside /api/chat-intel endpoint:", err);
      return res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // POST endpoint for streaming Gemini response using Server-Sent Events (SSE)
  app.post("/api/chat-intel-stream", async (req, res) => {
    try {
      const { historyContents, systemInstruction, clientApiKey } = req.body;
      const apiKey = clientApiKey || getSecretGeminiKey();
      if (!apiKey) {
        return res.status(400).json({ error: "Chave API do Gemini não definida no servidor." });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        vertexai: false,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const responseStream = await generateContentStreamWithFallback(ai, {
        model: "gemini-3.6-flash",
        contents: historyContents,
        config: {
          maxOutputTokens: 250,
          temperature: 0.7,
          systemInstruction: systemInstruction
        }
      });

      for await (const chunk of responseStream) {
        const text = chunk.text || "";
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err: any) {
      console.error("Error inside /api/chat-intel-stream endpoint:", err);
      res.write(`data: ${JSON.stringify({ error: formatGeminiError(err) })}\n\n`);
      res.end();
    }
  });

  // Generic and robust POST endpoint for server-side Gemini 3.6-flash content generation 
  app.post("/api/generate", async (req, res) => {
    try {
      const { prompt, systemInstruction, clientApiKey, model, responseMimeType } = req.body;
      const apiKey = clientApiKey || getSecretGeminiKey();
      
      if (!apiKey) {
        return res.status(400).json({ error: "Chave API do Gemini não definida no servidor." });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        vertexai: false,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const selectedModel = normalizeGeminiModel(model, "gemini-3.6-flash");

      const config: any = {};
      if (systemInstruction) config.systemInstruction = systemInstruction;
      if (responseMimeType) config.responseMimeType = responseMimeType;

      const response = await generateContentWithFallback(ai, {
        model: selectedModel,
        contents: prompt,
        config: config
      });

      return res.json({ text: response.text || "" });
    } catch (err: any) {
      console.error("Error inside /api/generate endpoint:", err);
      return res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // POST secure proxy endpoint for general Gemini content generation (supports history, tools, etc.)
  app.post("/api/gemini/generateContent", async (req, res) => {
    try {
      const { contents, model, config, clientApiKey } = req.body;
      const apiKey = clientApiKey || getSecretGeminiKey();
      
      if (!apiKey) {
        return res.status(400).json({ error: "Chave API do Gemini não definida. Insira uma chave válida nos Ajustes." });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        vertexai: false,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const selectedModel = normalizeGeminiModel(model, "gemini-3.6-flash");
      const response = await generateContentWithFallback(ai, {
        model: selectedModel,
        contents: contents,
        config: config
      });

      // Enrich response object with non-enumerable class getters (text, functionCalls) so they survive JSON serialization
      const responseJson = JSON.parse(JSON.stringify(response));
      try {
        if (response.text !== undefined) {
          responseJson.text = response.text;
        }
      } catch (e) {
        console.warn("Error copying response.text getter:", e);
      }
      try {
        if (response.functionCalls !== undefined) {
          responseJson.functionCalls = response.functionCalls;
        }
      } catch (e) {
        console.warn("Error copying response.functionCalls getter:", e);
      }

      return res.json(responseJson);
    } catch (err: any) {
      console.error("Erro no proxy server-side generateContent:", err);
      return res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // POST secure proxy endpoint for Imagen image generation
  app.post("/api/gemini/generateImages", async (req, res) => {
    const { prompt, model, config, clientApiKey } = req.body;
    try {
      const apiKey = clientApiKey || getSecretGeminiKey();
      
      if (!apiKey) {
        return res.status(400).json({ error: "Chave API do Gemini não definida. Insira uma chave válida nos Ajustes." });
      }

      const requestedModel = normalizeGeminiModel(model, "gemini-2.5-flash", true);

      // Helper function to try generating with gemini-2.5-flash (generateContent) via direct REST API
      const tryGeminiModelREST = async (modelName: string) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
        const payload = {
          contents: {
            parts: [{ text: prompt }]
          },
          generationConfig: {
            imageConfig: {
              aspectRatio: config?.aspectRatio || "1:1",
              imageSize: config?.imageSize || "1K"
            }
          }
        };

        console.log(`[Image Gen REST] Fazendo chamada direta de conteúdo para ${modelName}...`);
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
            "User-Agent": "aistudio-build"
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errText = await response.text();
          let errJSON;
          try {
            errJSON = JSON.parse(errText);
          } catch(e) {}
          throw new Error(errJSON?.error?.message || errText || `HTTP error ${response.status}`);
        }

        const responseData = await response.json();
        let base64EncodeString = "";
        const parts = responseData.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.inlineData) {
            base64EncodeString = part.inlineData.data;
            break;
          }
        }

        if (!base64EncodeString) {
          throw new Error("Nenhuma imagem gerada foi encontrada na resposta do modelo.");
        }

        return {
          generatedImages: [
            {
              image: {
                imageBytes: base64EncodeString
              }
            }
          ]
        };
      };

      // Helper function to try generating with imagen-3.0-generate-002 (generateImages) via direct REST API
      const tryImagenModelREST = async (modelName: string) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateImages`;
        const payload = {
          prompt: prompt,
          numberOfImages: config?.numberOfImages || 1,
          outputMimeType: config?.outputMimeType || "image/jpeg",
          aspectRatio: config?.aspectRatio || "1:1"
        };
        
        console.log(`[Image Gen REST] Fazendo chamada direta de imagens para ${modelName}...`);
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
            "User-Agent": "aistudio-build"
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errText = await response.text();
          let errJSON;
          try {
            errJSON = JSON.parse(errText);
          } catch(e) {}
          throw new Error(errJSON?.error?.message || errText || `HTTP error ${response.status}`);
        }

        return await response.json();
      };

      // Helper function to try generating with Pollinations.ai as an ultra-robust, keyless, free fallback
      const tryPollinationsModel = async (promptText: string) => {
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptText)}?width=1024&height=1024&nologo=true&private=true&enhance=true&seed=${Math.floor(Math.random() * 1000000)}`;
        console.log("[Image Gen] Baixando imagem do fallback configurado.");
        const response = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(30_000)
        });
        if (!response.ok) {
          throw new Error(`Pollinations image fetch failed: HTTP ${response.status}`);
        }
        const imageType = (response.headers.get("content-type") || "").toLowerCase();
        if (!imageType.startsWith("image/")) {
          throw new Error("O fallback não retornou uma imagem válida.");
        }
        if (!response.body) throw new Error("Resposta de imagem vazia.");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          total += value.byteLength;
          if (total > 12 * 1024 * 1024) {
            await reader.cancel();
            throw new Error("Imagem gerada excedeu o limite de 12 MB.");
          }
          chunks.push(value);
        }
        const buffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
        const base64String = buffer.toString("base64");
        
        return {
          generatedImages: [
            {
              image: {
                imageBytes: base64String
              }
            }
          ]
        };
      };

      // Execute with self-healing fallback logic
      const candidates = [
        requestedModel,
        "gemini-3.6-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-2.5-flash"
      ].filter(Boolean);

      const uniqueImageCandidates = Array.from(new Set(candidates));
      let lastImageError: any = null;

      for (const candidateModel of uniqueImageCandidates) {
        try {
          console.log(`[Image Gen] Tentando gerar imagem com modelo: ${candidateModel}`);
          if (candidateModel.startsWith("gemini-")) {
            const result = await tryGeminiModelREST(candidateModel);
            return res.json(result);
          } else {
            const result = await tryImagenModelREST(candidateModel);
            return res.json(result);
          }
        } catch (err: any) {
          lastImageError = err;
          console.log(`[Image Gen] Modelo ${candidateModel} não pôde ser utilizado. Alternando para o próximo candidato...`);
        }
      }

      // If all API models hit quota or error, execute Pollinations.ai fallback
      try {
        console.log("[Image Gen] Iniciando fallback ultra-robusto com Pollinations.ai...");
        const pollinationsResult = await tryPollinationsModel(prompt);
        return res.json(pollinationsResult);
      } catch (pollinationsErr: any) {
        console.error("[Image Gen] Falha no modelo de fallback final Pollinations.ai:", pollinationsErr);
        return res.status(500).json({ error: formatGeminiError(lastImageError || pollinationsErr) });
      }
    } catch (err: any) {
      console.error("[Image Generation] Erro geral na rota de geração de imagem:", err);
      return res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // Expõe apenas o estado de configuração; segredos do servidor nunca retornam ao cliente.
  app.get("/api/gemini/key", (req, res) => {
    const configured = Boolean(getSecretGeminiKey());
    return res.status(configured ? 200 : 404).json({
      success: configured,
      configured,
      message: configured
        ? "Uma chave Gemini está configurada no servidor."
        : "Chave Gemini não configurada no servidor."
    });
  });

  // POST endpoint for verifying Gemini API credentials in real-time
  app.post("/api/gemini/verify", async (req, res) => {
    try {
      const { geminiApiKey } = req.body;
      if (!geminiApiKey || typeof geminiApiKey !== "string" || !geminiApiKey.trim()) {
        return res.status(400).json({ success: false, message: "A chave API do Gemini é obrigatória para verificação." });
      }

      const trimApiKey = geminiApiKey.trim();
      if (trimApiKey.length > 4096) {
        return res.status(400).json({ success: false, message: "A chave informada é inválida." });
      }
      
      // Realizar chamada HTTP direta à API do Gemini para evitar auto-detecção do Vertex AI em plataformas GCP/Cloud Run
      const verifyRes = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": trimApiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "responder 'ok'" }] }]
        }),
        signal: AbortSignal.timeout(10_000)
      });

      if (!verifyRes.ok) {
        const errorData = await verifyRes.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || "Erro retornado pela API do Gemini. Verifique a validade e permissões da chave.";
        return res.status(verifyRes.status).json({
          success: false,
          message: `Falha no Handshake: ${errorMessage}`
        });
      }

      const testRes = await verifyRes.json();
      const replyText = testRes.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (replyText) {
        return res.json({
          success: true,
          message: "Conexão bem-sucedida! Handshake concluído com a API do Gemini."
        });
      } else {
        return res.status(400).json({
          success: false,
          message: "O Gemini respondeu sem texto válido. Verifique o acesso e cota da chave."
        });
      }
    } catch (err: any) {
      console.error("Error inside /api/gemini/verify endpoint:", sanitizeMessageOfKeys(err?.message || String(err)));
      return res.status(400).json({
        success: false,
        message: "A API do Gemini retornou um erro de rede. Verifique a chave, a cota e tente novamente."
      });
    }
  });

  // POST endpoint for Google Custom Search API retrieval to prevent client-side CORS and secure credentials
  app.post("/api/search/custom", async (req, res) => {
    try {
      const { query, key, cx } = req.body;
      if (!query || typeof query !== "string" || query.length > 500) {
        return res.status(400).json({ error: "O termo de pesquisa 'query' é obrigatório." });
      }

      const searchKey = key || process.env.GOOGLE_API_KEY;
      const searchCx = cx || process.env.GOOGLE_CSE_ID;

      if (!searchKey || !searchCx) {
        return res.status(400).json({
          error: "Google Custom Search não configurado. Por favor, ajuste as chaves em 'Ajustes > Chaves Extras' ou no arquivo .env."
        });
      }

      const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(searchKey)}&cx=${encodeURIComponent(searchCx)}&q=${encodeURIComponent(query)}`;
      const searchRes = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      
      if (!searchRes.ok) {
        return res.status(searchRes.status).json({ error: "A Google Custom Search recusou a solicitação. Verifique a chave, o CX e a cota." });
      }

      const data = await searchRes.json();
      return res.json(data);
    } catch (err: any) {
      console.error("Erro ao realizar busca Google Custom Search:", sanitizeMessageOfKeys(err?.message || String(err)));
      return res.status(500).json({ error: "Falha de rede na Google Custom Search." });
    }
  });

  // POST endpoint for Tavily Web Search
  app.post("/api/search/tavily", async (req, res) => {
    try {
      const { query, apiKey } = req.body;
      if (!query || typeof query !== "string" || query.length > 500) {
        return res.status(400).json({ error: "O termo de pesquisa 'query' é obrigatório." });
      }

      const tavilyKey = apiKey || process.env.TAVILY_API_KEY;
      if (!tavilyKey) {
        return res.status(400).json({
          error: "API Key do Tavily não configurada. Por favor, ajuste nos Chaves Extras do ARVES ou configure TAVILY_API_KEY no seu servidor."
        });
      }

      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: query,
          search_depth: "smart",
          include_answer: true,
          max_results: 5
        }),
        signal: AbortSignal.timeout(12_000)
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: "A Tavily recusou a solicitação. Verifique a chave e a cota." });
      }

      const data = await response.json();
      return res.json(data);
    } catch (err: any) {
      console.error("Erro ao realizar busca via Tavily:", sanitizeMessageOfKeys(err?.message || String(err)));
      return res.status(500).json({ error: "Falha de rede na pesquisa Tavily." });
    }
  });

  // POST endpoint for Google-Lens style visual intelligence searches (with or without Google Search grounding)
  app.post("/api/lens/query", async (req, res) => {
    try {
      const { image, internetSearch, clientApiKey } = req.body;
      if (!image) {
        return res.status(400).json({ error: "A imagem é obrigatória para a pesquisa da Lente." });
      }

      const apiKey = clientApiKey || getSecretGeminiKey();
      if (!apiKey) {
        return res.status(400).json({ error: "Chave API do Gemini não definida no servidor." });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        vertexai: false,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      // Extract raw base64 data and mimeType
      let base64Data = image;
      let mimeType = "image/jpeg";
      if (image.startsWith("data:")) {
        const matches = image.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          mimeType = matches[1];
          base64Data = matches[2];
        }
      }

      const imagePart = {
        inlineData: {
          mimeType: mimeType,
          data: base64Data,
        },
      };

      const systemInstruction = `Você é o sintonizador visual da Lente ARVES (mecanismo inspirado no Google Lens).
Sua missão é identificar detalhadamente o objeto, marca, planta, animal, alimento, monumento ou texto contido na imagem enviada.
Você deve produzir uma resposta estruturada de forma impecável no formato JSON contendo campos úteis para o usuário.
Não inclua nenhuma formatação markdown extra fora do JSON bruto.`;

      const promptText = `Analise a imagem de foco fornecida. Identifique o que aparece nela e responda estritamente com um objeto JSON no seguinte formato:
{
  "name": "Nome específico do item identificado",
  "category": "Categoria / Especialidade",
  "confidence": 99, 
  "description": "Uma descrição rica, focada e cativante em língua portuguesa detalhando o item...",
  "tags": ["tag1", "tag2", "tag3"], 
  "details": {
    "marcaOuOrigem": "Marca fabricante, proveniência ou bioma original",
    "caracteristicaPrincipal": "A característica física ou estrutural mais marcante observada",
    "curiosidadeOuUso": "Curiosidade histórica, utilidade prática, ou conselho de manutenção"
  },
  "suggestions": ["Ação de pesquisa útil 1", "Sugestão de uso do item 2"]
}
`;

      const config: any = {
        systemInstruction,
        responseMimeType: "application/json",
      };

      // If internetSearch is true, enable Google Search Grounding for live Lens matches!
      if (internetSearch) {
        config.tools = [{ googleSearch: {} }];
      }

      const response = await generateContentWithFallback(ai, {
        model: "gemini-3.6-flash",
        contents: { parts: [imagePart, { text: promptText }] },
        config: config
      });

      const responseText = response.text || "{}";
      let parsedData: any = {};
      try {
        parsedData = JSON.parse(responseText.trim());
      } catch (parseErr) {
        console.warn("Raw Gemini answer could not be parsed as direct JSON, attempting to extract blocks:", responseText);
        // Fallback robust json extraction from markdown blocks
        const cleaned = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
        parsedData = JSON.parse(cleaned);
      }

      // Extract actual live Google Search citations if available in Gemini's grounding metadata!
      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      const citations: { title: string; uri: string }[] = [];
      if (groundingChunks && Array.isArray(groundingChunks)) {
        for (const chunk of groundingChunks) {
          if (chunk.web && chunk.web.uri) {
            citations.push({
              title: chunk.web.title || "Resultado da Web",
              uri: chunk.web.uri
            });
          }
        }
      }

      parsedData.citations = citations;
      return res.json(parsedData);
    } catch (err: any) {
      console.error("Erro na pesquisa da Lente ARVES:", err);
      return res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // POST endpoint for high-speed server-side webpage text scraping & parsing
  app.post("/api/scrape", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string" || url.length > 2048) {
        return res.status(400).json({ error: "O parâmetro 'url' é obrigatório." });
      }

      const safeUrl = await assertSafeRemoteUrl(url);
      const response = await fetch(safeUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000)
      });

      if (response.status >= 300 && response.status < 400) {
        return res.status(400).json({ error: "Redirecionamento bloqueado. Envie a URL final diretamente." });
      }
      if (!response.ok) {
        return res.status(400).json({ error: `Falha ao acessar o site: status ${response.status}` });
      }
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
        return res.status(415).json({ error: "A URL não retornou uma página HTML ou texto." });
      }

      const html = await readResponseTextLimited(response, 1_500_000);

      // Strips structural elements like script tags, stylesheets, and menus
      let text = html
        .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
        .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
        .replace(/<svg[^>]*>([\s\S]*?)<\/svg>/gi, '')
        .replace(/<noscript[^>]*>([\s\S]*?)<\/noscript>/gi, '')
        .replace(/<header[^>]*>([\s\S]*?)<\/header>/gi, '')
        .replace(/<footer[^>]*>([\s\S]*?)<\/footer>/gi, '')
        .replace(/<nav[^>]*>([\s\S]*?)<\/nav>/gi, '')
        .replace(/<iframe[^>]*>([\s\S]*?)<\/iframe>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');

      text = text
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Retain a clean set of text characters up to 12k to avoid bloating context
      const cleanText = text.slice(0, 12000);

      return res.json({ text: cleanText });
    } catch (err: any) {
      console.error("Erro ao analisar página no servidor:", sanitizeMessageOfKeys(err?.message || String(err)));
      return res.status(400).json({ error: sanitizeMessageOfKeys(err?.message || "Falha ao analisar a página.") });
    }
  });

  app.get("/api/system-docs", (req, res) => {
    try {
      const { file } = req.query;
      if (!file || typeof file !== "string") {
        return res.status(400).json({ error: "Faltando o parâmetro do arquivo." });
      }
      const allowed = ["manifesto.md", "capacidades.md", "memoria_evolutiva.md"];
      if (!allowed.includes(file)) {
        return res.status(400).json({ error: "Arquivo proibido ou não mapeado nas diretrizes." });
      }
      const filePath = path.join(process.cwd(), "src", "documentos_arves", file);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: `Arquivo ${file} não existe no diretório.` });
      }
      const text = fs.readFileSync(filePath, "utf-8");
      return res.json({ text });
    } catch (err: any) {
      console.error("Erro ao ler documento de sistema:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ====== TIKTOK LIVE CO-PILOT API ENDPOINTS ======
  app.get("/api/tiktok/state", (req, res) => {
    res.json({
      status: tiktokStatus,
      username: currentTikTokUser,
      isAutoRespondActive: isTikTokAutoRespondActive,
      viewerCount: tiktokViewerCount,
      likeCount: tiktokLikeCount,
      sessionId: tiktokSessionId,
      targetIdc: tiktokTargetIdc,
      logs: tiktokEventLogs
    });
  });

  app.post("/api/tiktok/connect", async (req, res) => {
    try {
      const { username, simulate, sessionId, targetIdc } = req.body;
      
      if (sessionId !== undefined) {
        tiktokSessionId = String(sessionId).trim();
      }

      if (targetIdc !== undefined) {
        tiktokTargetIdc = String(targetIdc).trim();
      }

      if (simulate) {
        startSimulatedLive();
        return res.json({ status: "success", message: "Simulação de live do TikTok iniciada no ARVES!" });
      }

      if (!username || typeof username !== "string" || !username.trim()) {
        return res.status(400).json({ error: "O nome de usuário do TikTok é obrigatório." });
      }

      const cleanUser = username.trim().replace(/^@/, "");
      
      // Async trigger connection so we don't hold the HTTP request indefinitely
      connectToTikTokLive(cleanUser, tiktokSessionId, tiktokTargetIdc).catch(e => {
        console.error("Delayed connection failed:", e);
      });

      res.json({ 
        status: "success", 
        message: `Sinalização enviada com sucesso! Conectando à webcast de @${cleanUser}...` 
      });
    } catch (err: any) {
      console.error("Erro ao conectar TikTok:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tiktok/disconnect", async (req, res) => {
    try {
      await disconnectFromTikTokLive();
      res.json({ status: "success", message: "Conectividade do TikTok Live suspensa de forma íntegra." });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tiktok/config", (req, res) => {
    const { isAutoRespondActive } = req.body;
    if (isAutoRespondActive !== undefined) {
      isTikTokAutoRespondActive = !!isAutoRespondActive;
    }
    res.json({ 
      status: "success", 
      isAutoRespondActive: isTikTokAutoRespondActive 
    });
  });

  app.post("/api/tiktok/clear-logs", (req, res) => {
    tiktokEventLogs = [
      {
        id: "clear-" + Date.now(),
        type: "system",
        user: "Sistema",
        message: "Histórico de eventos do TikTok Live limpo com segurança.",
        timestamp: Date.now()
      }
    ];
    res.json({ status: "success" });
  });

  // POST endpoint for verifying Elevenlabs credentials and options in real-time
  app.post("/api/elevenlabs/verify", async (req, res) => {
    try {
      const { elevenLabsApiKey, elevenLabsVoiceId } = req.body;
      if (!elevenLabsApiKey || typeof elevenLabsApiKey !== "string" || !elevenLabsApiKey.trim()) {
        return res.status(400).json({ success: false, message: "A chave API da Elevenlabs é obrigatória para verificação." });
      }

      const trimApiKey = elevenLabsApiKey.trim();

      // Validate Api Key via ElevenLabs User Info Endpoint
      const userRes = await fetch("https://api.elevenlabs.io/v1/user", {
        method: "GET",
        headers: {
          "xi-api-key": trimApiKey
        }
      });

      if (!userRes.ok) {
        const errText = await userRes.text();
        let message = "Chave de API inválida ou expirada. Verifique as credenciais digitadas.";
        try {
          const parsed = JSON.parse(errText);
          if (parsed.detail?.message) {
            message = parsed.detail.message;
          } else if (parsed.detail?.status === "invalid-api-key") {
            message = "Chave API Elevenlabs inválida. Por favor, revise os caracteres.";
          }
        } catch (_) {}
        return res.status(userRes.status === 401 ? 401 : 400).json({ success: false, message });
      }

      const userData = await userRes.json();
      const userTier = userData.subscription?.tier || "Free/Trial";
      const characterCount = userData.subscription?.character_count || 0;
      const characterLimit = userData.subscription?.character_limit || 10000;
      const leftCount = Math.max(0, characterLimit - characterCount);

      const subInfo = `Plano: ${userTier} (${leftCount.toLocaleString()} caracteres restantes)`;

      // If Voice ID was provided, validate it as well
      if (elevenLabsVoiceId && typeof elevenLabsVoiceId === "string" && elevenLabsVoiceId.trim()) {
        const trimVoiceId = elevenLabsVoiceId.trim();
        const voiceRes = await fetch(`https://api.elevenlabs.io/v1/voices/${trimVoiceId}`, {
          method: "GET",
          headers: {
            "xi-api-key": trimApiKey
          }
        });

        if (!voiceRes.ok) {
          return res.status(400).json({
            success: false,
            message: `A chave de API é válida! (${subInfo}), mas o ID da voz "${trimVoiceId}" não foi encontrado ou é inacessível para esta chave.`
          });
        }

        const voiceData = await voiceRes.json();
        const voiceName = voiceData.name || "Voz Desconhecida";
        return res.json({
          success: true,
          message: `Conexão bem-sucedida! Chave de API válida (${subInfo}). Voz encontrada: "${voiceName}".`
        });
      }

      return res.json({
        success: true,
        message: `Conexão bem-sucedida! Chave de API ativa (${subInfo}). Nenhum Voice ID foi inserido, será utilizada a voz padrão.`
      });

    } catch (err: any) {
      console.error("Error inside /api/elevenlabs/verify endpoint:", err);
      res.status(500).json({ success: false, message: `Falha ao tentar conectar ao servidor da ElevenLabs: ${err.message}` });
    }
  });

  // POST endpoint for generating step-by-step simple integration plans
  app.post("/api/integrations/plan", async (req, res) => {
    try {
      const { targetIntegration, clientApiKey } = req.body;
      
      if (!targetIntegration || typeof targetIntegration !== "string") {
        return res.status(400).json({ error: "O nome da integração é obrigatório." });
      }

      const apiKey = clientApiKey || getSecretGeminiKey();

      if (!apiKey) {
        return res.status(400).json({ 
          error: "A chave API do Gemini não está definida no ARVES ou nos segredos. Por favor, configure sua chave nos Ajustes." 
        });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        vertexai: false,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const prompt = `Gere um guia de plano de integração extremamente simples, didático e prático, estruturado em passos numerados fáceis (de 3 a 5 passos), explicando detalhadamente o que o usuário precisa preparar, configurar e programar em seu app para conseguir integrar o sistema desejado.
      
      Algumas pessoas não sabem por onde começar ou o que precisam (como Chave de API, URLs de retorno, webhook, bibliotecas). Explique de forma amigável, acolhedora e encorajadora para que qualquer pessoa (mesmo leigos) consiga entender o que precisa fazer e o que precisa obter nos painéis parceiros.

      Sistema que o usuário deseja integrar: "${targetIntegration}"

      Siga exatamente esta estrutura no seu resultado Markdown:
      1. **Introdução**: Uma introdução breve, encorajadora e amigável em português explicando o que é o sistema e confirmando que é super viável integrá-lo.
      2. **Passo a Passo**: Divida em passos claramente numerados (ex: # 1, # 2, etc.), usando palavras simples e destacando termos técnicos essenciais em negrito (ex: **Token de Acesso**, **Painel de Desenvolvedor**, **Webhooks**, **Servidor**).
      3. **Dica Pro**: Uma dica rápida para manter as senhas protegidas ou sobre como testar de forma simulada.`;

      const response = await generateContentWithFallback(ai, {
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          systemInstruction: "Você é um Engenheiro de API de Software experiente, empático e de linguagem extremamente clara e acessível."
        }
      });

      res.json({ plan: response.text || "Ops! Não foi possível gerar o plano. Tente novamente." });
    } catch (error: any) {
      console.error("Erro no endpoint de planejador de integrações:", error);
      res.status(500).json({ error: error?.message || "Erro interno ao gerar o plano de integração." });
    }
  });

  // Handle upgrade event manually to route to the /api/live-ws or /api/elevenlabs-ws websocket bridge
  server.on("upgrade", (request, socket, head) => {
    try {
      const reqUrl = request.url || "";
      const pathname = reqUrl.split("?")[0].replace(/\/$/, "");
      if (!isAllowedOrigin(request.headers.origin, request.headers.host)) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      
      if (pathname === "/api/live-ws") {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      } else if (pathname === "/api/elevenlabs-ws") {
        elWss.handleUpgrade(request, socket, head, (ws) => {
          elWss.emit("connection", ws, request);
        });
      } else {
        socket.destroy();
      }
    } catch (e) {
      console.error("Upgrade routing failed:", e);
      socket.destroy();
    }
  });

  // Handle incoming websocket connections
  wss.on("connection", async (clientWs, req) => {
    console.log("Client connected to the server-side ARVES G5 Live Bridge WS");
    let bidiSession: any = null;
    let setupComplete = false;

    clientWs.on("message", async (rawData) => {
      try {
        const message = JSON.parse(rawData.toString());
        
        if (message.type === "setup") {
          if (setupComplete) {
            clientWs.close(1008, "Setup duplicado");
            return;
          }
          const expectedAccessToken = (process.env.ARVES_ACCESS_TOKEN || "").trim();
          if (expectedAccessToken && !safeSecretEqual(message.accessToken, expectedAccessToken)) {
            clientWs.send(JSON.stringify({ type: "error", error: "Token privado do ARVES inválido." }));
            clientWs.close(1008, "Unauthorized");
            return;
          }
          const apiKey = typeof message.clientApiKey === "string" && message.clientApiKey.trim()
            ? message.clientApiKey.trim()
            : getSecretGeminiKey();
          if (!apiKey || apiKey.length > 4096) {
            clientWs.send(JSON.stringify({
              type: "error",
              error: "Chave API do Gemini não definida. Insira uma chave válida nos ajustes."
            }));
            clientWs.close(1008, "Missing API key");
            return;
          }
          const { model, config } = message;
          const targetModel = typeof model === "string" && /^gemini-[a-z0-9.-]{1,80}$/i.test(model)
            ? model
            : "gemini-3.1-flash-live-preview";
          const ai = new GoogleGenAI({
            apiKey,
            vertexai: false,
            httpOptions: {
              headers: {
                "User-Agent": "arves-ai"
              }
            }
          });
          console.log(`Connecting Live API on server mode: ${targetModel}`);
          
          try {
            bidiSession = await ai.live.connect({
              model: targetModel,
              config: config,
              callbacks: {
                onmessage: (liveResponse: any) => {
                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify(liveResponse));
                  }
                },
                onclose: () => {
                  console.log("Gemini Live connection closed by Google endpoint");
                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.close();
                  }
                },
                onerror: (err: any) => {
                  console.error("Gemini Live server API error callback:", err);
                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ 
                      type: "error", 
                      error: err?.message || "Ops, ocorreu um erro interno na conexão Neural." 
                    }));
                  }
                }
              }
            });
            setupComplete = true;
            console.log("Server successfully connected to Google Gemini Live endpoint!");
          } catch (connectError: any) {
            console.error("Failed to connect to Gemini Live:", connectError);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ 
                type: "error", 
                error: `Falha na conexão Neural do Servidor: ${connectError?.message || connectError}` 
              }));
              clientWs.close();
            }
          }
        } else if (!setupComplete) {
          clientWs.send(JSON.stringify({ type: "error", error: "Inicialize o canal antes de enviar dados." }));
          clientWs.close(1008, "Setup required");
        } else if (message.type === "realtime_input") {
          if (bidiSession) {
            bidiSession.sendRealtimeInput(message.input);
          }
        } else if (message.type === "tool_response") {
          if (bidiSession) {
            bidiSession.sendToolResponse(message.payload);
          }
        }
      } catch (parseError: any) {
        console.error("WS Message processing error:", parseError);
      }
    });

    clientWs.on("close", () => {
      console.log("Client disconnected from websocket bridge, cleaning up");
      if (bidiSession) {
        try {
          bidiSession.close();
        } catch (e) {
          console.error("Failed to cleanly close bidi session on client departure:", e);
        }
      }
    });

    clientWs.on("error", (e) => {
      console.error("Client WS error:", e);
      if (bidiSession) {
        try { bidiSession.close(); } catch (_) {}
      }
    });
  });

  // Handle incoming ElevenLabs streaming proxy connections
  elWss.on("connection", async (clientWs, req) => {
    console.log("Client connected to the server-side ElevenLabs WS Proxy");
    
    const reqUrl = req.url || "";
    const queryString = reqUrl.includes("?") ? reqUrl.split("?")[1] : "";
    const searchParams = new URLSearchParams(queryString);
    
    const rawVoiceId = searchParams.get("voiceId") || "21m00Tcm4TlvDq8ikWAM";
    const rawModelId = searchParams.get("modelId") || "eleven_flash_v2_5";
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(rawVoiceId) || !/^[A-Za-z0-9_-]{1,120}$/.test(rawModelId)) {
      clientWs.send(JSON.stringify({ error: "Parâmetros de voz inválidos." }));
      clientWs.close(1008, "Invalid voice settings");
      return;
    }
    const stabilityValue = Number.parseFloat(searchParams.get("stability") || "0.5");
    const similarityValue = Number.parseFloat(searchParams.get("similarityBoost") || "0.75");
    const stability = Number.isFinite(stabilityValue) ? Math.min(1, Math.max(0, stabilityValue)) : 0.5;
    const similarityBoost = Number.isFinite(similarityValue) ? Math.min(1, Math.max(0, similarityValue)) : 0.75;

    let elWs: WebSocket | null = null;
    let authenticated = false;
    const pendingMsgBuffer: string[] = [];
    let pendingBytes = 0;

    const authTimeout = setTimeout(() => {
      if (!authenticated && clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1008, "Authentication timeout");
      }
    }, 5_000);

    const forwardToElevenLabs = (msgStr: string) => {
      if (!elWs || elWs.readyState !== WebSocket.OPEN) return;
      try {
        const parsed = JSON.parse(msgStr);
        if (parsed?.type !== "auth") elWs.send(JSON.stringify(parsed));
      } catch {
        elWs.send(JSON.stringify({ text: msgStr }));
      }
    };

    const startElevenLabsConnection = (elApiKey: string) => {
      const outboundUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(rawVoiceId)}/stream-input?model_id=${encodeURIComponent(rawModelId)}&output_format=pcm_24000`;
      console.log(`Establishing outbound connection to ElevenLabs for voice ${rawVoiceId}`);
      elWs = new WebSocket(outboundUrl, {
        headers: {
          "xi-api-key": elApiKey
        }
      });

      elWs.on("open", () => {
        console.log("ElevenLabs outbound WebSocket successfully established");
        elWs?.send(JSON.stringify({
          text: " ",
          xi_api_key: elApiKey,
          voice_settings: {
            stability,
            similarity_boost: similarityBoost
          },
          generation_config: {
            chunk_length_schedule: [120, 160, 250, 290]
          }
        }));
        while (pendingMsgBuffer.length > 0) {
          const msgStr = pendingMsgBuffer.shift();
          if (msgStr) {
            pendingBytes -= Buffer.byteLength(msgStr);
            forwardToElevenLabs(msgStr);
          }
        }
      });

      elWs.on("message", (data) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.message || parsed.detail) {
              const msg = parsed.message || (typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail));
              clientWs.send(JSON.stringify({ error: sanitizeMessageOfKeys(msg) }));
              return;
            }
          } catch {}
          clientWs.send(data.toString());
        }
      });

      elWs.on("error", (err) => {
        console.error("ElevenLabs outbound WS error:", sanitizeMessageOfKeys(err.message));
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ error: "Falha no canal de voz ElevenLabs." }));
        }
      });

      elWs.on("close", (code) => {
        console.log(`ElevenLabs outbound WS closed. Code: ${code}`);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close();
        }
      });
    };

    clientWs.on("message", (msg) => {
      const msgStr = msg.toString();
      if (Buffer.byteLength(msgStr) > 256 * 1024) {
        clientWs.close(1009, "Message too large");
        return;
      }
      if (!authenticated) {
        try {
          const authMessage = JSON.parse(msgStr);
          if (authMessage?.type !== "auth") throw new Error("Auth required");
          const expectedAccessToken = (process.env.ARVES_ACCESS_TOKEN || "").trim();
          if (expectedAccessToken && !safeSecretEqual(authMessage.accessToken, expectedAccessToken)) {
            clientWs.send(JSON.stringify({ error: "Token privado do ARVES inválido." }));
            clientWs.close(1008, "Unauthorized");
            return;
          }
          const elApiKey = typeof authMessage.apiKey === "string" && authMessage.apiKey.trim()
            ? authMessage.apiKey.trim()
            : (process.env.ELEVENLABS_API_KEY || "").trim();
          if (!elApiKey || elApiKey.length > 4096) {
            clientWs.send(JSON.stringify({ error: "Chave API ElevenLabs não configurada." }));
            clientWs.close(1008, "Missing API key");
            return;
          }
          authenticated = true;
          clearTimeout(authTimeout);
          startElevenLabsConnection(elApiKey);
          return;
        } catch {
          clientWs.send(JSON.stringify({ error: "O primeiro frame deve autenticar o canal." }));
          clientWs.close(1008, "Authentication required");
          return;
        }
      }
      if (elWs?.readyState === WebSocket.OPEN) {
        forwardToElevenLabs(msgStr);
      } else if (elWs?.readyState === WebSocket.CONNECTING) {
        pendingBytes += Buffer.byteLength(msgStr);
        if (pendingBytes > 512 * 1024) {
          clientWs.close(1009, "Queue too large");
          return;
        }
        pendingMsgBuffer.push(msgStr);
      }
    });
    
    clientWs.on("error", (err) => {
      console.error("ElevenLabs Proxy client WS error:", err);
      clearTimeout(authTimeout);
      if (elWs?.readyState === WebSocket.OPEN) {
        elWs.close();
      }
    });
    
    clientWs.on("close", () => {
      console.log("ElevenLabs Proxy client WS closed");
      clearTimeout(authTimeout);
      if (elWs?.readyState === WebSocket.OPEN || elWs?.readyState === WebSocket.CONNECTING) {
        elWs.close();
      }
    });
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Rota da API não encontrada." });
  });

  app.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    const isTooLarge = error?.type === "entity.too.large" || error?.status === 413;
    res.status(isTooLarge ? 413 : 400).json({
      error: isTooLarge ? "Solicitação excede o limite permitido." : "Solicitação inválida."
    });
  });

  // Integration with Vite dev middleware for hot loading frontend assets in dev, serve statically in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite dev server mounted on Express middleware");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log(`Serving static files from ${distPath}`);
  }

  if (process.env.VERCEL !== "1") {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Express Server connected and running on http://0.0.0.0:${PORT}`);
    });
  }

  return app;
}

const serverPromise = startServer().catch((error) => {
  console.error("Server execution crashed:", error);
  throw error;
});

export default serverPromise;
