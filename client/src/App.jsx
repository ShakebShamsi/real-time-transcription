import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AudioLines, Bell, BookOpenText, Check, ChevronDown, Clock3, Copy,
  Download, FileAudio, FileText, Headphones, History, LayoutDashboard, LoaderCircle,
  Mic, MoreHorizontal, Pause, Play, Plus, Radio, Search, Settings, ShieldCheck,
  Sparkles, Square, Trash2, Volume2, WandSparkles, X, PencilLine, RefreshCw,
} from 'lucide-react';
import { api } from './lib/api';

const initialStats = { total: 0, totalSeconds: 0, words: 0 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatDuration(totalSeconds = 0) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

function formatDate(dateString) {
  if (!dateString) return 'Just now';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function formatRelative(dateString) {
  if (!dateString) return 'Just now';
  const date = new Date(dateString);
  const delta = Date.now() - date.getTime();
  if (delta < 60_000) return 'Just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} min ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} hr ago`;
  return formatDate(dateString);
}

function makeSessionTitle() {
  const stamp = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date());
  return `Voice note · ${stamp}`;
}

function saveAsText(item) {
  const text = `${item.title}\n${formatDate(item.createdAt)}\n\n${item.content}\n`;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${(item.title || 'transcription').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'transcription'}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function speakText(text) {
  if (!('speechSynthesis' in window) || !text.trim()) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'hi-IN';
  utterance.rate = 0.96;
  window.speechSynthesis.speak(utterance);
  return true;
}

function downsampleToPcm16(input, inputRate, outputRate = 16000) {
  let samples = input;
  if (inputRate > outputRate) {
    const ratio = inputRate / outputRate;
    const outputLength = Math.floor(input.length / ratio);
    samples = new Float32Array(outputLength);
    for (let outIndex = 0; outIndex < outputLength; outIndex += 1) {
      const start = Math.floor(outIndex * ratio);
      const end = Math.min(Math.floor((outIndex + 1) * ratio), input.length);
      let sum = 0;
      for (let i = start; i < end; i += 1) sum += input[i];
      samples[outIndex] = sum / Math.max(1, end - start);
    }
  } else if (inputRate < outputRate) {
    // This is rare in browsers; linear interpolation prevents sending the wrong sample rate.
    const scale = outputRate / inputRate;
    const output = new Float32Array(Math.floor(input.length * scale));
    for (let i = 0; i < output.length; i += 1) {
      const position = i / scale;
      const left = Math.floor(position);
      const right = Math.min(left + 1, input.length - 1);
      const fraction = position - left;
      output[i] = input[left] * (1 - fraction) + input[right] * fraction;
    }
    samples = output;
  }

  const pcm = new ArrayBuffer(samples.length * 2);
  const view = new DataView(pcm);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  const bytes = new Uint8Array(pcm);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary);
}

function useVoiceSession({ onFinal, onError, onStatus }) {
  const socketRef = useRef(null);
  const streamRef = useRef(null);
  const contextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const muteRef = useRef(null);
  const startedAtRef = useRef(0);
  const isStoppingRef = useRef(false);

  const cleanupAudio = useCallback(async () => {
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch { /* Already disconnected. */ }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch { /* Already disconnected. */ }
      sourceRef.current = null;
    }
    if (muteRef.current) {
      try { muteRef.current.disconnect(); } catch { /* Already disconnected. */ }
      muteRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (contextRef.current) {
      try { await contextRef.current.close(); } catch { /* Audio context may already be closed. */ }
      contextRef.current = null;
    }
  }, []);

  const start = useCallback(async (providedStream) => {
    isStoppingRef.current = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access is not available in this browser. Open the app in a recent version of Chrome or Edge.');
    }
    if (!window.WebSocket) throw new Error('This browser does not support WebSockets.');

    onStatus('connecting');
    const stream = providedStream || await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;

    const socket = new WebSocket(api.websocketUrl());
    socketRef.current = socket;

    let settled = false;
    const ready = new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('The live transcription service did not respond in time. Check the API key and try again.'));
        }
      }, 20000);

      socket.onmessage = (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'ready' && !settled) {
          settled = true;
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.type === 'interim') onStatus('interim', message.text || '');
        if (message.type === 'final') onFinal(message.text || '');
        if (message.type === 'stream-ended') return;
        if (message.type === 'error') {
          const error = new Error(message.message || 'Live transcription failed.');
          if (!settled) {
            settled = true;
            window.clearTimeout(timeout);
            reject(error);
          } else {
            onError(error);
          }
        }
        if (message.type === 'upstream-closed' && !isStoppingRef.current) {
          onError(new Error(message.reason || 'The transcription service disconnected.'));
        }
      };
      socket.onerror = () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error('Could not connect to the transcription WebSocket. Make sure the API server is running.'));
        } else if (!isStoppingRef.current) {
          onError(new Error('The live connection reported a network error.'));
        }
      };
      socket.onclose = (event) => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error(event.reason || 'The live transcription connection closed before it was ready.'));
        } else if (!isStoppingRef.current) {
          onError(new Error(event.reason || 'The live transcription connection closed unexpectedly.'));
        }
      };
    });

    try {
      await ready;
      if (socket.readyState !== WebSocket.OPEN) {
        throw new Error('The live transcription connection closed before recording could start.');
      }
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextClass({ sampleRate: 16000 });
      contextRef.current = context;
      if (context.state === 'suspended') await context.resume();
      if (socket.readyState !== WebSocket.OPEN) {
        throw new Error('The live transcription connection closed before recording could start.');
      }
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const muted = context.createGain();
      muted.gain.value = 0;
      sourceRef.current = source;
      processorRef.current = processor;
      muteRef.current = muted;

      processor.onaudioprocess = (audioEvent) => {
        if (socket.readyState !== WebSocket.OPEN || isStoppingRef.current) return;
        const input = audioEvent.inputBuffer.getChannelData(0);
        const data = downsampleToPcm16(input, context.sampleRate, 16000);
        if (data) socket.send(JSON.stringify({ type: 'audio', data }));
      };

      source.connect(processor);
      processor.connect(muted);
      muted.connect(context.destination);
      startedAtRef.current = Date.now();
      onStatus('recording');
    } catch (error) {
      socketRef.current?.close();
      socketRef.current = null;
      await cleanupAudio();
      throw error;
    }
  }, [cleanupAudio, onError, onFinal, onStatus]);

  const stop = useCallback(async () => {
    isStoppingRef.current = true;
    onStatus('stopping');
    const durationSeconds = startedAtRef.current ? Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000)) : 0;
    startedAtRef.current = 0;

    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ type: 'end' })); } catch { /* Socket is closing. */ }
    }
    await cleanupAudio();

    if (socket && socket.readyState !== WebSocket.CLOSED) {
      await Promise.race([
        new Promise((resolve) => socket.addEventListener('close', resolve, { once: true })),
        sleep(2300),
      ]);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        try { socket.close(); } catch { /* Already closed. */ }
      }
    }
    socketRef.current = null;
    onStatus('idle');
    return durationSeconds;
  }, [cleanupAudio, onStatus]);

  const abort = useCallback(async () => {
    isStoppingRef.current = true;
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ type: 'close' })); } catch { /* Ignore during cleanup. */ }
    }
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      try { socket.close(); } catch { /* Ignore during cleanup. */ }
    }
    socketRef.current = null;
    await cleanupAudio();
    startedAtRef.current = 0;
    onStatus('idle');
  }, [cleanupAudio, onStatus]);

  useEffect(() => () => {
    isStoppingRef.current = true;
    try { socketRef.current?.close(); } catch { /* Component unmount. */ }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    try { contextRef.current?.close(); } catch { /* Component unmount. */ }
  }, []);

  return { start, stop, abort };
}

function StatCard({ icon: Icon, label, value, note, tone = 'blue' }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}><Icon size={18} strokeWidth={2.1} /></div>
      <div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
    </div>
  );
}

function SectionHeading({ eyebrow, title, description, action }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="section-action">{action}</div>}
    </div>
  );
}

function EmptyState({ icon: Icon = FileText, title, description, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon size={24} /></div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState('studio');
  const [records, setRecords] = useState([]);
  const [stats, setStats] = useState(initialStats);
  const [health, setHealth] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('idle');
  const [savedText, setSavedText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [activeId, setActiveId] = useState(null);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [editRecord, setEditRecord] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const savedTextRef = useRef('');
  const activeIdRef = useRef(null);
  const appendQueueRef = useRef(Promise.resolve());
  const recordStartedAtRef = useRef(0);
  const elapsedTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const stopRecordingRef = useRef(null);

  const isRecording = status === 'recording';
  const isConnecting = status === 'connecting';
  const isStopping = status === 'stopping';
  const isBusy = isConnecting || isStopping || busy;
  const combinedText = [savedText, interimText].filter(Boolean).join(savedText && interimText ? ' ' : '');

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const refreshData = useCallback(async ({ refreshHealth = false } = {}) => {
    try {
      const [itemsResponse, statsResponse] = await Promise.all([api.list(), api.stats()]);
      setRecords(itemsResponse.data || []);
      setStats(statsResponse.data || initialStats);
    } catch (error) {
      if (refreshHealth) showToast(error.message, 'error');
    }
    if (refreshHealth) {
      try { setHealth(await api.health()); } catch { setHealth({ status: 'offline', transcriptionConfigured: false }); }
    }
  }, [showToast]);

  useEffect(() => {
    refreshData({ refreshHealth: true });
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (elapsedTimerRef.current) window.clearInterval(elapsedTimerRef.current);
    };
  }, [refreshData]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.list(search.trim());
        setRecords(response.data || []);
      } catch { /* The top-level service status reports API errors. */ }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [search]);

  const handleInterimStatus = useCallback((nextStatus, partial = '') => {
    if (nextStatus === 'interim') {
      setInterimText(partial);
      return;
    }
    setStatus(nextStatus);
  }, []);

  const handleFinal = useCallback((rawText) => {
    const text = rawText.trim();
    if (!text) return;
    const previous = savedTextRef.current;
    const next = previous ? `${previous} ${text}` : text;
    savedTextRef.current = next;
    setSavedText(next);
    setInterimText('');

    const targetId = activeIdRef.current;
    if (targetId) {
      appendQueueRef.current = appendQueueRef.current
        .then(() => api.append(targetId, text))
        .catch((error) => showToast(`Live text is visible, but automatic save failed: ${error.message}`, 'error'));
    }
  }, [showToast]);

  const handleVoiceError = useCallback((error) => {
    const message = error.message || 'Transcription error. Please try again.';
    showToast(message, 'error');
    stopRecordingRef.current?.(message);
  }, [showToast]);

  const voice = useVoiceSession({ onFinal: handleFinal, onError: handleVoiceError, onStatus: handleInterimStatus });

  useEffect(() => {
    if (!isRecording) return undefined;
    elapsedTimerRef.current = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - recordStartedAtRef.current) / 1000)));
    }, 250);
    return () => {
      if (elapsedTimerRef.current) window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    };
  }, [isRecording]);

  const startRecording = async () => {
    if (isBusy || isRecording) return;
    setBusy(true);
    setInterimText('');
    setSavedText('');
    savedTextRef.current = '';
    appendQueueRef.current = Promise.resolve();
    setElapsed(0);
    setActiveId(null);
    activeIdRef.current = null;

    let record = null;
    let microphoneStream = null;
    try {
      // Ask for microphone permission first so a denied permission does not create an empty history item.
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not available in this browser.');
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      record = (await api.create({ title: makeSessionTitle(), content: '', language: 'auto', durationSeconds: 0 })).data;
      setActiveId(record.id);
      activeIdRef.current = record.id;
      await refreshData();
      await voice.start(microphoneStream);
      microphoneStream = null;
      recordStartedAtRef.current = Date.now();
      setView('studio');
      showToast('Microphone connected. Start speaking in Hindi, English, or a mix of both.', 'success');
    } catch (error) {
      microphoneStream?.getTracks().forEach((track) => track.stop());
      await voice.abort();
      if (record?.id) {
        try { await api.remove(record.id); } catch { /* Avoid leaving a blank history row when possible. */ }
      }
      setActiveId(null);
      activeIdRef.current = null;
      setStatus('idle');
      showToast(error.message || 'Could not start recording.', 'error');
      await refreshData();
    } finally {
      setBusy(false);
    }
  };

  const stopRecording = async (failureMessage = '') => {
    if (!isRecording || isStopping) return;
    setBusy(true);
    setInterimText('');
    try {
      const durationSeconds = await voice.stop();
      await appendQueueRef.current;
      const recordId = activeIdRef.current;
      const content = savedTextRef.current.trim();
      if (recordId && !content) {
        await api.remove(recordId).catch(() => null);
        showToast(
          failureMessage
            ? `${failureMessage} No transcript was available to save.`
            : 'No speech was detected, so no history item was saved.',
          failureMessage ? 'error' : 'info',
        );
      } else if (recordId) {
        const bestTitle = content.split(/\s+/u).slice(0, 7).join(' ');
        await api.update(recordId, {
          title: bestTitle ? (bestTitle.length > 68 ? `${bestTitle.slice(0, 65)}…` : bestTitle) : makeSessionTitle(),
          durationSeconds,
          content,
        });
        showToast(
          failureMessage
            ? `${failureMessage} Transcript captured so far was saved.`
            : 'Transcription saved to your history.',
          failureMessage ? 'error' : 'success',
        );
      }
      setActiveId(null);
      activeIdRef.current = null;
      await refreshData();
    } catch (error) {
      showToast(error.message || 'The recording could not be saved.', 'error');
      await refreshData();
    } finally {
      setStatus('idle');
      setBusy(false);
    }
  };
  stopRecordingRef.current = stopRecording;

  const openRecord = async (record) => {
    try {
      const response = await api.get(record.id);
      setSelectedRecord(response.data);
      setView('history');
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  const deleteRecord = async (record) => {
    const confirmed = window.confirm(`Delete “${record.title}”? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await api.remove(record.id);
      if (selectedRecord?.id === record.id) setSelectedRecord(null);
      if (editRecord?.id === record.id) setEditRecord(null);
      await refreshData();
      showToast('Transcription deleted.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  const saveEditedRecord = async () => {
    if (!editRecord) return;
    if (!editRecord.title.trim()) {
      showToast('Please add a title before saving.', 'error');
      return;
    }
    setBusy(true);
    try {
      const response = await api.update(editRecord.id, {
        title: editRecord.title.trim(),
        content: editRecord.content,
      });
      setEditRecord(null);
      if (selectedRecord?.id === response.data.id) setSelectedRecord(response.data);
      await refreshData();
      showToast('Changes saved successfully.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard.', 'success');
    } catch {
      showToast('Clipboard access was blocked by the browser.', 'error');
    }
  };

  const recentRecords = records.slice(0, 4);
  const currentTranscript = selectedRecord;
  const healthReady = health?.status === 'ok' && health?.transcriptionConfigured;
  const averageWords = stats.total ? Math.round(stats.words / stats.total) : 0;

  const nav = [
    { id: 'studio', label: 'Live studio', icon: AudioLines },
    { id: 'history', label: 'Transcription history', icon: History, count: records.length },
    { id: 'settings', label: 'Settings & API', icon: Settings },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand-lockup" onClick={() => setView('studio')} aria-label="Go to the live studio">
          <span className="brand-mark"><AudioLines size={24} strokeWidth={2.5} /></span>
          <span className="brand-type"><strong>procucev<span>•</span></strong><small>VOICE WORKSPACE</small></span>
        </button>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {nav.map(({ id, label, icon: Icon, count }) => (
            <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => setView(id)}>
              <Icon size={18} strokeWidth={1.9} />
              <span>{label}</span>
              {count !== undefined && <span className="nav-count">{count}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-divider" />
        <div className="workspace-label">QUICK ACCESS</div>
        <button className="nav-item sub-nav" onClick={() => { setSearch(''); setView('history'); }}>
          <Clock3 size={17} /><span>Recent sessions</span>
        </button>
        <button className="nav-item sub-nav" onClick={() => setView('settings')}>
          <ShieldCheck size={17} /><span>Privacy & data</span>
        </button>

        <div className="sidebar-bottom">
          <div className="upgrade-card">
            <div className="upgrade-icon"><Sparkles size={16} /></div>
            <strong>Words, without the wait.</strong>
            <p>Live captions in multiple languages, saved as you speak.</p>
            <button onClick={() => setView('studio')}>Open live studio <span>↗</span></button>
          </div>
          <div className="account-row">
            <div className="avatar">S</div>
            <div className="account-meta"><strong>Speech workspace</strong><small>Local demo environment</small></div>
            <MoreHorizontal size={18} className="account-more" />
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{nav.find((item) => item.id === view)?.label || 'Live studio'}</strong></div>
          <div className="topbar-actions">
            <span className={`service-pill ${healthReady ? 'online' : health?.status === 'offline' ? 'offline' : 'warning'}`}>
              <span className="service-dot" />{healthReady ? 'All systems operational' : health?.status === 'offline' ? 'API offline' : 'Setup required'}
            </span>
            <button className="icon-button top-notification" aria-label="Notifications" onClick={() => showToast('You are all caught up.', 'info')}><Bell size={18} /><i /></button>
            <div className="top-avatar">S</div>
          </div>
        </header>

        <div className="page-content">
          {view === 'studio' && (
            <>
              <SectionHeading
                eyebrow="YOUR SPEECH, IN TEXT"
                title={<>Say it. <span className="title-accent">See it.</span> Save it.</>}
                description="Capture conversations in real time, in the language you naturally speak."
                action={<div className="date-chip"><Clock3 size={15} /> {new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date())}</div>}
              />

              <section className="stats-grid" aria-label="Workspace statistics">
                <StatCard icon={FileText} label="Saved sessions" value={stats.total.toLocaleString('en-IN')} note="Across your workspace" tone="blue" />
                <StatCard icon={AudioLines} label="Words captured" value={stats.words.toLocaleString('en-IN')} note={stats.total ? `${averageWords} words / session on average` : 'Your first words start here'} tone="violet" />
                <StatCard icon={Clock3} label="Time transcribed" value={formatDuration(stats.totalSeconds)} note="Total recorded audio" tone="mint" />
              </section>

              <section className="studio-grid">
                <div className="panel live-panel">
                  <div className="panel-heading">
                    <div className="panel-title-wrap">
                      <div className="panel-icon live-icon"><Radio size={18} /></div>
                      <div><h2>Live transcription</h2><p>Real-time speech recognition</p></div>
                    </div>
                    <span className={`live-status ${isRecording ? 'capturing' : isConnecting ? 'connecting' : ''}`}><span />{isRecording ? 'Listening' : isConnecting ? 'Connecting' : isStopping ? 'Finishing' : 'Ready when you are'}</span>
                  </div>

                  <div className={`recording-stage ${isRecording ? 'is-recording' : ''}`}>
                    <div className={`orbital orb-one ${isRecording ? 'animate' : ''}`} />
                    <div className={`orbital orb-two ${isRecording ? 'animate' : ''}`} />
                    <div className={`mic-orb ${isRecording ? 'active' : ''} ${isConnecting ? 'pending' : ''}`}>
                      {isConnecting || isStopping ? <LoaderCircle size={29} className="spin" /> : <Mic size={31} strokeWidth={1.7} />}
                    </div>
                    <div className="wave-bars" aria-hidden="true">
                      {Array.from({ length: 29 }).map((_, index) => <span key={index} style={{ '--i': index }} />)}
                    </div>
                    <div className="timer-display">{formatDuration(elapsed)}</div>
                    <p className="recording-hint">{isRecording ? 'Your microphone is on. Speak naturally.' : isConnecting ? 'Getting your microphone and live session ready…' : isStopping ? 'Finalizing your last words…' : 'Press the button below to start listening'}</p>
                    <div className="record-actions">
                      {isRecording ? (
                        <button className="record-button stop-button" onClick={() => stopRecording()} disabled={busy}>
                          <Square size={15} fill="currentColor" /> Stop recording
                        </button>
                      ) : (
                        <button className="record-button" onClick={startRecording} disabled={isBusy}>
                          {isBusy ? <LoaderCircle size={17} className="spin" /> : <Mic size={17} />}
                          {isConnecting ? 'Connecting…' : isStopping ? 'Finalizing…' : 'Start recording'}
                        </button>
                      )}
                      <span className="shortcut-hint"><span className="keycap">●</span> {isRecording ? 'Live capture on' : 'Microphone access required'}</span>
                    </div>
                  </div>

                  <div className="transcript-box">
                    <div className="transcript-box-head">
                      <div><span className="tiny-live-indicator" /> <strong>Live transcript</strong><span className="auto-save-tag"><Check size={11} /> Auto-save</span></div>
                      {savedText && <div className="transcript-inline-actions"><button title="Copy transcript" onClick={() => copyText(savedText)}><Copy size={15} /></button><button title="Download text" onClick={() => saveAsText({ title: 'Live transcription', content: savedText, createdAt: new Date().toISOString() })}><Download size={15} /></button></div>}
                    </div>
                    <div className={`transcript-content ${combinedText ? 'has-text' : ''}`} aria-live="polite">
                      {combinedText ? <><span>{savedText}</span>{interimText && <span className="interim-text">{savedText ? ' ' : ''}{interimText}</span>}</> : (
                        <div className="transcript-placeholder">
                          <span className="placeholder-wave"><i /><i /><i /><i /><i /></span>
                          <p>Your words will appear here as you speak…</p>
                          <small>Hindi, English, Hinglish and other supported languages</small>
                        </div>
                      )}
                    </div>
                    <div className="transcript-box-foot"><span>{savedText ? `${savedText.trim().split(/\s+/u).length.toLocaleString('en-IN')} words captured` : 'Waiting for speech input'}</span><span><ShieldCheck size={13} /> Saved to your history automatically</span></div>
                  </div>
                </div>

                <aside className="studio-side-column">
                  <div className="panel language-panel">
                    <div className="side-panel-heading"><div><h2>Language intelligence</h2><p>Automatic language detection</p></div><div className="sparkle-badge"><WandSparkles size={18} /></div></div>
                    <div className="language-feature">
                      <div className="language-flags"><span>अ</span><span>A</span></div>
                      <div><strong>Multilingual by default</strong><p>Switch between Hindi and English in the same sentence. No manual language toggling.</p></div>
                    </div>
                    <div className="language-chips"><span>हिन्दी · Hindi</span><span>English (India)</span><span>Hinglish</span><span className="plus-chip">+ more</span></div>
                    <div className="language-foot"><span className="green-check"><Check size={12} /></span><span>Powered by Gemini Live transcription</span></div>
                  </div>

                  <div className="panel tips-panel">
                    <div className="tips-title"><div className="tipbulb"><Sparkles size={16} /></div><h2>Get better results</h2></div>
                    <div className="tip-row"><span className="tip-number">01</span><div><strong>Speak naturally</strong><p>Mix Hindi and English just as you would in a conversation.</p></div></div>
                    <div className="tip-row"><span className="tip-number">02</span><div><strong>Keep a steady pace</strong><p>Short pauses help the system finalize each spoken segment.</p></div></div>
                    <div className="tip-row"><span className="tip-number">03</span><div><strong>Use a clear mic</strong><p>Reduce background noise for more accurate transcripts.</p></div></div>
                  </div>
                </aside>
              </section>

              <section className="recent-section">
                <div className="recent-heading"><div><div className="eyebrow">PICK UP WHERE YOU LEFT OFF</div><h2>Recent transcriptions</h2></div><button className="text-link" onClick={() => setView('history')}>View all sessions <span>↗</span></button></div>
                {recentRecords.length ? (
                  <div className="recent-list">
                    {recentRecords.map((record, index) => (
                      <div className="recent-row" key={record.id}>
                        <div className={`recent-file-icon tone-${index % 3}`}><FileAudio size={18} /></div>
                        <button className="recent-main" onClick={() => openRecord(record)}><strong>{record.title}</strong><span>{formatRelative(record.updatedAt)} <i /> {record.wordCount} words</span></button>
                        <span className="recent-duration"><Clock3 size={13} /> {formatDuration(record.durationSeconds)}</span>
                        <button className="row-open-button" aria-label={`Open ${record.title}`} onClick={() => openRecord(record)}>↗</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="recent-empty"><div className="recent-empty-icon"><FileText size={18} /></div><div><strong>No sessions yet</strong><span>Your saved speech-to-text sessions will show up here.</span></div><button onClick={startRecording}><Plus size={15} /> Record your first note</button></div>
                )}
              </section>
            </>
          )}

          {view === 'history' && (
            <>
              <SectionHeading eyebrow="YOUR WORDS, ORGANIZED" title={<>Transcription <span className="title-accent">history.</span></>} description="Search, review, edit, export or delete your saved sessions." action={<button className="record-button compact" onClick={() => { setView('studio'); startRecording(); }} disabled={isBusy}><Plus size={16} /> New transcription</button>} />
              <section className="stats-grid history-stats">
                <StatCard icon={FileText} label="Total sessions" value={stats.total.toLocaleString('en-IN')} note="All saved transcripts" tone="blue" />
                <StatCard icon={AudioLines} label="Words in archive" value={stats.words.toLocaleString('en-IN')} note="Across all sessions" tone="violet" />
                <StatCard icon={Clock3} label="Audio captured" value={formatDuration(stats.totalSeconds)} note="Recorded time in total" tone="mint" />
              </section>

              <section className="panel history-panel">
                <div className="history-toolbar"><div><h2>All sessions <span className="soft-count">{records.length}</span></h2><p>Your transcripts are stored in the local SQLite database.</p></div><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transcripts…" /><span className="search-shortcut">⌘ K</span></label></div>
                {records.length ? (
                  <div className="table-wrap"><table className="history-table"><thead><tr><th>TRANSCRIPTION</th><th>CREATED</th><th>LENGTH</th><th>WORDS</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
                    {records.map((record, index) => <tr key={record.id}>
                      <td><button className="table-title-button" onClick={() => openRecord(record)}><span className={`table-file-icon tone-${index % 3}`}><FileText size={16} /></span><span><strong>{record.title}</strong><small>{record.content ? `${record.content.slice(0, 58)}${record.content.length > 58 ? '…' : ''}` : 'Empty transcription'}</small></span></button></td>
                      <td><span className="table-date">{formatDate(record.createdAt)}</span></td>
                      <td><span className="duration-cell">{formatDuration(record.durationSeconds)}</span></td>
                      <td><span className="words-badge">{record.wordCount}</span></td>
                      <td><div className="table-actions"><button title="Edit transcription" onClick={() => setEditRecord({ ...record })}><PencilLine size={15} /></button><button title="Download transcription" onClick={() => saveAsText(record)}><Download size={15} /></button><button title="Delete transcription" className="delete-action" onClick={() => deleteRecord(record)}><Trash2 size={15} /></button></div></td>
                    </tr>)}
                  </tbody></table></div>
                ) : search ? <EmptyState icon={Search} title="No matches found" description={`Nothing matched “${search}”. Try another word or phrase.`} action={<button className="plain-button" onClick={() => setSearch('')}>Clear search</button>} />
                  : <EmptyState icon={History} title="Your archive starts here" description="Start a live transcription and the saved session will appear in this list." action={<button className="record-button compact" onClick={() => setView('studio')}><Mic size={15} /> Open live studio</button>} />}
              </section>

              {currentTranscript && (
                <section className="panel selected-transcript-panel">
                  <div className="selected-heading"><div><div className="eyebrow">TRANSCRIPT DETAILS</div><h2>{currentTranscript.title}</h2><p>{formatDate(currentTranscript.createdAt)} · {currentTranscript.wordCount} words · {formatDuration(currentTranscript.durationSeconds)}</p></div><div className="selected-actions"><button className="outline-button" onClick={() => setEditRecord({ ...currentTranscript })}><PencilLine size={15} /> Edit</button><button className="outline-button" onClick={() => copyText(currentTranscript.content)}><Copy size={15} /> Copy</button><button className="icon-button" aria-label="Close transcript details" onClick={() => setSelectedRecord(null)}><X size={17} /></button></div></div>
                  <div className="selected-transcript-content">{currentTranscript.content || 'No transcript content was captured.'}</div>
                  <div className="selected-foot-actions"><button onClick={() => speakText(currentTranscript.content)}><Volume2 size={15} /> Read aloud</button><button onClick={() => saveAsText(currentTranscript)}><Download size={15} /> Export .txt</button><button className="danger-text" onClick={() => deleteRecord(currentTranscript)}><Trash2 size={15} /> Delete session</button></div>
                </section>
              )}
            </>
          )}

          {view === 'settings' && (
            <>
              <SectionHeading eyebrow="CONFIGURATION & DOCUMENTATION" title={<>Settings & <span className="title-accent">API.</span></>} description="Check your local services and review the integration points for this assignment." />
              <div className="settings-grid">
                <section className="panel settings-panel">
                  <div className="settings-panel-heading"><div className="settings-big-icon"><Activity size={20} /></div><div><h2>Service status</h2><p>Live status reported by your backend server.</p></div><button className="icon-button" onClick={() => refreshData({ refreshHealth: true })} title="Refresh status"><RefreshCw size={16} /></button></div>
                  <div className="service-detail-row"><span>REST API</span><span className={`detail-status ${health?.status === 'ok' ? 'good' : 'bad'}`}><i />{health?.status === 'ok' ? 'Connected' : 'Unavailable'}</span></div>
                  <div className="service-detail-row"><span>SQLite database</span><span className={`detail-status ${health?.status === 'ok' ? 'good' : 'bad'}`}><i />{health?.status === 'ok' ? 'Initialized' : 'Unknown'}</span></div>
                  <div className="service-detail-row"><span>Gemini API key</span><span className={`detail-status ${healthReady ? 'good' : 'bad'}`}><i />{healthReady ? 'Configured' : 'Missing / invalid'}</span></div>
                  <div className="service-detail-row"><span>Transcription model</span><code>{health?.model || 'gemini-3.5-transcribe-live'}</code></div>
                  {!healthReady && <div className="setup-callout"><ShieldCheck size={18} /><div><strong>One-time setup required</strong><p>Copy <code>server/.env.example</code> to <code>server/.env</code>, add your Gemini API key, and restart the API server.</p><a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Get a Gemini API key ↗</a></div></div>}
                </section>
                <section className="panel settings-panel">
                  <div className="settings-panel-heading"><div className="settings-big-icon violet-settings"><BookOpenText size={20} /></div><div><h2>Project stack</h2><p>Assignment implementation details.</p></div></div>
                  <div className="stack-row"><span>Frontend</span><strong>React 19 + Vite</strong></div>
                  <div className="stack-row"><span>Backend</span><strong>Node.js + Express</strong></div>
                  <div className="stack-row"><span>Database</span><strong>SQLite (relational)</strong></div>
                  <div className="stack-row"><span>Speech recognition</span><strong>Gemini Live API</strong></div>
                  <div className="stack-row"><span>Text-to-speech</span><strong>Browser SpeechSynthesis</strong></div>
                  <div className="stack-note"><Sparkles size={16} /><p>Audio is streamed to the configured live model. Finalized transcript segments are written to SQLite as they arrive.</p></div>
                </section>
              </div>

              <section className="panel api-panel"><div className="api-heading"><div><div className="eyebrow">BACKEND REFERENCE</div><h2>REST API endpoints</h2><p>Endpoints for history, editing and deletion.</p></div></div><div className="api-endpoints">
                {[
                  ['GET', '/api/health', 'Check backend and model configuration'],
                  ['GET', '/api/stats', 'Read total sessions, duration and word count'],
                  ['GET', '/api/transcriptions?search=', 'List and search saved transcripts'],
                  ['POST', '/api/transcriptions', 'Create a new transcript session'],
                  ['POST', '/api/transcriptions/:id/append', 'Append a finalized speech segment'],
                  ['GET', '/api/transcriptions/:id', 'Read one transcript'],
                  ['PATCH', '/api/transcriptions/:id', 'Edit title, transcript content or duration'],
                  ['DELETE', '/api/transcriptions/:id', 'Delete a saved transcript'],
                ].map(([method, endpoint, description]) => <div className="api-endpoint" key={`${method}-${endpoint}`}><span className={`method-badge ${method.toLowerCase()}`}>{method}</span><code>{endpoint}</code><span>{description}</span></div>)}
              </div></section>
            </>
          )}

          <footer className="app-footer"><span>© 2026 Procucev Voice <i /> Built for the AI Tech Hiring Assignment</span><span><span className="footer-pulse" /> Real-time transcription <i /> Version 1.0.0</span></footer>
        </div>
      </main>

      {editRecord && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditRecord(null); }}>
        <div className="edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-modal-title">
          <div className="modal-heading"><div><div className="eyebrow">MAKE IT YOURS</div><h2 id="edit-modal-title">Edit transcription</h2><p>Update the session name or correct the recognized words.</p></div><button className="icon-button" aria-label="Close edit dialog" onClick={() => setEditRecord(null)}><X size={18} /></button></div>
          <label className="form-field"><span>Session title</span><input maxLength={160} value={editRecord.title} onChange={(event) => setEditRecord({ ...editRecord, title: event.target.value })} placeholder="Add a descriptive title" /></label>
          <label className="form-field"><span>Transcript text</span><textarea rows={8} maxLength={1_000_000} value={editRecord.content} onChange={(event) => setEditRecord({ ...editRecord, content: event.target.value })} placeholder="Your transcribed words…" /></label>
          <div className="modal-footer"><span>{editRecord.content.trim() ? editRecord.content.trim().split(/\s+/u).length : 0} words</span><div><button className="outline-button" onClick={() => setEditRecord(null)}>Cancel</button><button className="record-button compact" onClick={saveEditedRecord} disabled={busy}><Check size={15} /> {busy ? 'Saving…' : 'Save changes'}</button></div></div>
        </div>
      </div>}

      {toast && <div className={`toast toast-${toast.type}`} role="status"><span className="toast-icon">{toast.type === 'error' ? <X size={16} /> : toast.type === 'info' ? <Bell size={16} /> : <Check size={16} />}</span><span>{toast.message}</span><button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={14} /></button></div>}
    </div>
  );
}
