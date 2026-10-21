const { WebSocketServer, WebSocket } = require('ws');
const { GoogleGenAI } = require('@google/genai');

const MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.5-transcribe-live';
const MAX_AUDIO_MESSAGE_BYTES = 256 * 1024;

function sendJson(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function attachRealtime(server) {
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_AUDIO_MESSAGE_BYTES });

  server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (requestUrl.pathname !== '/ws/transcription') {
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request);
    });
  });

  webSocketServer.on('connection', async (clientSocket) => {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.startsWith('replace_')) {
      sendJson(clientSocket, {
        type: 'error',
        message: 'Add a valid GEMINI_API_KEY to server/.env before starting a recording.',
      });
      clientSocket.close(1011, 'Gemini API key is not configured');
      return;
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    let geminiSession = null;
    let clientEnded = false;
    let geminiClosed = false;

    const closeGemini = () => {
      if (geminiSession && !geminiClosed) {
        geminiClosed = true;
        try { geminiSession.close(); } catch { /* A session may already be closed upstream. */ }
      }
    };

    try {
      geminiSession = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: ['TEXT'],
        inputAudioTranscription: {},
      },
        callbacks: {
          onmessage: (message) => {
            const content = message?.serverContent;
            if (!content) return;
            const interim = content.interimInputTranscription?.text;
            const finalized = content.inputTranscription?.text;
            if (typeof interim === 'string' && interim.trim()) {
              sendJson(clientSocket, { type: 'interim', text: interim });
            }
            if (typeof finalized === 'string' && finalized.trim()) {
              sendJson(clientSocket, { type: 'final', text: finalized.trim() });
            }
          },
          onerror: (event) => {
            const message = event?.message || 'The live transcription service reported an error.';
            sendJson(clientSocket, { type: 'error', message });
          },
          onclose: (event) => {
            geminiClosed = true;
            if (!clientEnded && clientSocket.readyState === WebSocket.OPEN) {
              sendJson(clientSocket, {
                type: 'upstream-closed',
                reason: event?.reason || 'Live transcription connection closed.',
              });
            }
          },
        },
      });

      if (clientSocket.readyState !== WebSocket.OPEN) {
        closeGemini();
        return;
      }
      sendJson(clientSocket, { type: 'ready', model: MODEL });

      clientSocket.on('message', (rawMessage, isBinary) => {
        if (isBinary) {
          sendJson(clientSocket, { type: 'error', message: 'Expected JSON audio messages.' });
          return;
        }
        let message;
        try {
          message = JSON.parse(rawMessage.toString());
        } catch {
          sendJson(clientSocket, { type: 'error', message: 'Invalid WebSocket message.' });
          return;
        }

        if (!message || typeof message !== 'object' || Array.isArray(message)) {
          sendJson(clientSocket, { type: 'error', message: 'WebSocket message must be a JSON object.' });
          return;
        }

        if (message.type === 'audio') {
          if (typeof message.data !== 'string' || message.data.length > MAX_AUDIO_MESSAGE_BYTES) {
            sendJson(clientSocket, { type: 'error', message: 'Audio data must be a base64 string within the message size limit.' });
            return;
          }
          try {
            geminiSession.sendRealtimeInput({
              audio: {
                data: message.data,
                mimeType: 'audio/pcm;rate=16000',
              },
            });
          } catch (error) {
            sendJson(clientSocket, { type: 'error', message: error.message || 'Audio streaming failed.' });
          }
        } else if (message.type === 'end') {
          clientEnded = true;
          try {
            geminiSession.sendRealtimeInput({ audioStreamEnd: true });
            sendJson(clientSocket, { type: 'stream-ended' });
          } catch (error) {
            sendJson(clientSocket, { type: 'error', message: error.message || 'Could not end the audio stream.' });
          }
          // Leave the connection open briefly so the finalized transcript can arrive.
          setTimeout(() => {
            closeGemini();
            if (clientSocket.readyState === WebSocket.OPEN) clientSocket.close(1000, 'Transcription finished');
          }, 1800).unref?.();
        } else if (message.type === 'close') {
          clientEnded = true;
          closeGemini();
          clientSocket.close(1000, 'Client stopped transcription');
        }
      });

      clientSocket.on('close', () => {
        clientEnded = true;
        closeGemini();
      });
      clientSocket.on('error', () => {
        clientEnded = true;
        closeGemini();
      });
    } catch (error) {
      console.error('[realtime] Could not start Gemini Live session:', error);
      sendJson(clientSocket, {
        type: 'error',
        message: error?.message || 'Could not start the live transcription service. Check the Gemini API key and model availability.',
      });
      try { clientSocket.close(1011, 'Could not start transcription'); } catch { /* Socket is already closed. */ }
      closeGemini();
    }
  });

  return webSocketServer;
}

module.exports = { attachRealtime };
