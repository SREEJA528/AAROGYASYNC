import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Cloud,
  CloudOff,
  Radio,
  RefreshCw,
  Mic,
  Square,
  Camera,
  Video,
  VideoOff,
  Phone,
  PhoneOff,
  Bot,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  HeartPulse,
  Thermometer,
  Activity,
  User,
  Plus,
  Minus,
  Volume2,
  FileText,
  Send,
  Lock,
  Database,
  X,
  Stethoscope,
  MessageSquare,
} from 'lucide-react';

// ============================================================================
// 1. OFFLINE VAULT (real IndexedDB, with localStorage fallback)
// ============================================================================
const DB_NAME = 'aarogyasync_vault';
const STORE = 'records';
const LS_KEY = 'aarogyasync_indexeddb_vault_v1';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const localVault = {
  async getAll() {
    try {
      const db = await openDb();
      const rows = await new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch {
      try {
        const raw = localStorage.getItem(LS_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    }
  },
  async saveAll(records) {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        store.clear();
        records.forEach((r) => store.put(r));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(records));
      } catch (err) {
        console.error('Vault write error:', err);
      }
    }
  },
};

// ============================================================================
// 2. ENCRYPTION PLACEHOLDER + WEBP COMPRESSION
// NOTE: encryptPayloadAES256 is a DISPLAY-ONLY simulation, not real encryption.
// Replace with crypto.subtle AES-GCM before handling real patient data.
// ============================================================================
function encryptPayloadAES256(plainObj) {
  try {
    const jsonStr = JSON.stringify({ ...plainObj, encryptedBlob: undefined, photo: undefined });
    const encoded = btoa(unescape(encodeURIComponent(jsonStr)));
    const reversed = encoded.split('').reverse().join('');
    return `AES256-GCM::${reversed.slice(0, 48)}...${reversed.slice(-16)}`;
  } catch {
    return 'AES256-GCM::ENCRYPTED_BLOB';
  }
}

async function compressImageToWebP(file, maxWidth = 480, quality = 0.62) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL('image/webp', quality);
        const originalKb = Math.max(1, Math.round(file.size / 1024));
        const compressedKb = Math.max(1, Math.round((dataUrl.length * 3) / 4 / 1024));
        resolve({
          dataUrl,
          originalKb,
          compressedKb,
          ratio: `${Math.round((compressedKb / originalKb) * 100)}%`,
        });
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// 3. OFFLINE EDGE TRIAGE ENGINE (WHO / NHM style danger-sign rules)
// ============================================================================
function evaluateEdgeTriage({ vitals, symptoms, age }) {
  const redFlags = [];
  const yellowFlags = [];

  if (vitals.spo2 < 92) redFlags.push('SpO₂ < 92% (Hypoxia)');
  else if (vitals.spo2 < 95) yellowFlags.push('SpO₂ 92–94% (Borderline)');

  if (vitals.tempF >= 103) redFlags.push('High Fever ≥ 103°F');
  else if (vitals.tempF >= 100.4) yellowFlags.push('Fever ≥ 100.4°F');

  if (vitals.hr > 130 || vitals.hr < 45) redFlags.push('Critical Heart Rate');
  else if (vitals.hr > 105 || vitals.hr < 55) yellowFlags.push('Elevated/Low Pulse');

  if (vitals.bpSys >= 160 || vitals.bpSys < 85) redFlags.push('Dangerous Systolic BP');
  else if (vitals.bpSys >= 140 || vitals.bpSys < 95) yellowFlags.push('Borderline BP');

  if (symptoms.includes('respiratory')) redFlags.push('Breathing Distress');
  if (symptoms.includes('pregnant') && (vitals.bpSys >= 140 || symptoms.includes('pulse'))) {
    redFlags.push('Maternal Danger Sign');
  }
  if (age <= 2 && (symptoms.includes('fever') || vitals.tempF >= 100.4)) {
    yellowFlags.push('Infant (<2y) Fever');
  }
  if (symptoms.includes('injury') || symptoms.includes('stomach')) {
    yellowFlags.push('Needs Clinical Check');
  }

  if (redFlags.length > 0) {
    return {
      level: 'RED',
      priorityRank: 1,
      label: 'RED — URGENT REFERRAL',
      firstAidIcons: ['🚑', '🫁', '💧'],
      guidance: [
        'Arrange PHC / Ambulance referral immediately.',
        'Keep patient upright & calm; loosen tight clothing.',
        'Give small sips of ORS/water if conscious & not vomiting.',
      ],
      flags: redFlags,
    };
  }
  if (yellowFlags.length > 0) {
    return {
      level: 'YELLOW',
      priorityRank: 2,
      label: 'YELLOW — TELE-DOCTOR / CLINIC',
      firstAidIcons: ['🧊', '💧', '🩺'],
      guidance: [
        'Tepid sponging if fever > 100°F; start ORS solution.',
        'Connect to Tele-Doctor when signal is available.',
        'Re-check vitals every 30 minutes for red flags.',
      ],
      flags: yellowFlags,
    };
  }
  return {
    level: 'GREEN',
    priorityRank: 3,
    label: 'GREEN — ROUTINE / HOME CARE',
    firstAidIcons: ['💧', '🥗', '😴'],
    guidance: [
      'Continue normal hydration, rest, and nutritious meals.',
      'Follow routine hygiene and preventive care.',
      'Return or call if new symptoms appear.',
    ],
    flags: ['Vitals & symptoms within safe baseline'],
  };
}

// ============================================================================
// 4. ICON-FIRST SYMPTOM & AVATAR DEFINITIONS
// ============================================================================
const PATIENT_AVATARS = [
  { id: 'child', label: 'Child', emoji: '🧒' },
  { id: 'adult', label: 'Adult', emoji: '🧑' },
  { id: 'mother', label: 'Mother', emoji: '🤰' },
  { id: 'elder', label: 'Elder', emoji: '🧓' },
];

const Svg = ({ children }) => (
  <svg
    viewBox="0 0 64 64"
    className="w-12 h-12"
    fill="none"
    stroke="currentColor"
    strokeWidth="4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const SYMPTOM_TILES = [
  {
    id: 'fever',
    label: 'Fever',
    localHint: 'बुखार / জ্বর',
    bgClass: 'bg-sky-100 border-sky-300 text-sky-950',
    activeClass: 'bg-sky-500 border-sky-700 text-white ring-4 ring-sky-200',
    svg: (
      <Svg>
        <path d="M26 10a6 6 0 0 1 12 0v26a12 12 0 1 1-12 0z" />
        <circle cx="32" cy="46" r="5" fill="currentColor" />
        <path d="M32 18v22" />
      </Svg>
    ),
  },
  {
    id: 'respiratory',
    label: 'Breathing',
    localHint: 'साँस / শ্বাসকষ্ট',
    bgClass: 'bg-emerald-100 border-emerald-300 text-emerald-950',
    activeClass: 'bg-emerald-600 border-emerald-800 text-white ring-4 ring-emerald-200',
    svg: (
      <Svg>
        <path d="M32 8v22" />
        <path d="M32 30c-4 6-8 8-12 8-6 0-10 6-10 12 0 4 4 6 8 6 8 0 14-10 14-26z" />
        <path d="M32 30c4 6 8 8 12 8 6 0 10 6 10 12 0 4-4 6-8 6-8 0-14-10-14-26z" />
      </Svg>
    ),
  },
  {
    id: 'pulse',
    label: 'Heart / Chest',
    localHint: 'दिल / বুক',
    bgClass: 'bg-rose-100 border-rose-300 text-rose-950',
    activeClass: 'bg-rose-600 border-rose-800 text-white ring-4 ring-rose-200',
    svg: (
      <Svg>
        <path d="M32 54S8 40 8 24a12 12 0 0 1 24-4 12 12 0 0 1 24 4c0 16-24 30-24 30z" />
        <path d="M14 32h10l4-8 6 14 4-6h12" />
      </Svg>
    ),
  },
  {
    id: 'injury',
    label: 'Injury',
    localHint: 'चोट / আঘাত',
    bgClass: 'bg-orange-100 border-orange-300 text-orange-950',
    activeClass: 'bg-orange-500 border-orange-700 text-white ring-4 ring-orange-200',
    svg: (
      <Svg>
        <rect x="6" y="22" width="52" height="20" rx="10" transform="rotate(-35 32 32)" />
        <path d="M26 24l14 16" />
        <circle cx="29" cy="30" r="1.5" fill="currentColor" />
        <circle cx="35" cy="34" r="1.5" fill="currentColor" />
      </Svg>
    ),
  },
  {
    id: 'stomach',
    label: 'Stomach',
    localHint: 'पेट / পেট ব্যথা',
    bgClass: 'bg-amber-100 border-amber-300 text-amber-950',
    activeClass: 'bg-amber-500 border-amber-700 text-white ring-4 ring-amber-200',
    svg: (
      <Svg>
        <path d="M24 8v14c0 6 12 6 12 14 0 8-4 12-12 12-10 0-14-8-14-16s6-12 14-12" />
        <path d="M44 20c6 2 10 8 10 16 0 10-8 16-18 16" />
        <path d="M46 8l4 8M54 10l-6 6" />
      </Svg>
    ),
  },
  {
    id: 'pregnant',
    label: 'Maternal',
    localHint: 'गर्भवती / গর্ভবতী',
    bgClass: 'bg-fuchsia-100 border-fuchsia-300 text-fuchsia-950',
    activeClass: 'bg-fuchsia-600 border-fuchsia-800 text-white ring-4 ring-fuchsia-200',
    svg: (
      <Svg>
        <circle cx="26" cy="12" r="6" />
        <path d="M26 20c-6 4-6 14-2 20 0 0 4 4 10 4 8 0 12-6 8-12-3-5-8-4-8-4" />
        <path d="M24 44l-4 14M36 44l4 14" />
        <circle cx="38" cy="32" r="3" fill="currentColor" />
      </Svg>
    ),
  },
];

// ============================================================================
// 5. SEED DATA
// ============================================================================
function createSeedRecords() {
  const make = (rec) => {
    const triage = evaluateEdgeTriage({ vitals: rec.vitals, symptoms: rec.symptoms, age: rec.patient.age });
    const full = { ...rec, triage, photo: null, syncStatus: 'synced', prescription: null };
    return { ...full, encryptedBlob: encryptPayloadAES256(full) };
  };

  return [
    make({
      id: 'REC-1042',
      createdAt: new Date(Date.now() - 12 * 60000).toISOString(),
      chwName: 'Sunita Devi (ASHA-042)',
      usageMode: 'asha',
      patient: { name: 'Ramesh Majhi', avatar: 'elder', age: 62, village: 'Bankura Gram-4', phone: '+91 98321-00412' },
      vitals: { hr: 118, tempF: 101.6, spo2: 90, bpSys: 156 },
      symptoms: ['fever', 'respiratory'],
      audioNote: { durationSec: 9, label: 'Breathless since morning' },
    }),
    make({
      id: 'REC-1043',
      createdAt: new Date(Date.now() - 28 * 60000).toISOString(),
      chwName: 'Sunita Devi (ASHA-042)',
      usageMode: 'asha',
      patient: { name: 'Kavita Mondal', avatar: 'mother', age: 26, village: 'Bankura Gram-2', phone: '+91 97345-11890' },
      vitals: { hr: 96, tempF: 99.4, spo2: 98, bpSys: 124 },
      symptoms: ['pregnant', 'stomach'],
      audioNote: null,
    }),
  ];
}

// ============================================================================
// 6. SMALL REUSABLE COMPONENT: VITAL STEPPER
// ============================================================================
function VitalCard({ icon, label, valueNode, onUp, onDown }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-2.5 flex items-center justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <div>
          <div className="text-[10px] font-extrabold text-slate-500 uppercase">{label}</div>
          {valueNode}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={onUp}
          className="w-7 h-7 rounded-lg bg-white border border-slate-300 flex items-center justify-center active:scale-90"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={onDown}
          className="w-7 h-7 rounded-lg bg-white border border-slate-300 flex items-center justify-center active:scale-90"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// 7. MAIN APPLICATION
// ============================================================================
export default function App() {
  const [activeRole, setActiveRole] = useState('chw');
  const [usageMode, setUsageMode] = useState('asha');
  const [networkMode, setNetworkMode] = useState('offline');

  const [records, setRecords] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showSyncDrawer, setShowSyncDrawer] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);

  const [selectedAvatar, setSelectedAvatar] = useState('adult');
  const [patientAge, setPatientAge] = useState(32);
  const [patientName, setPatientName] = useState('');
  const [symptoms, setSymptoms] = useState([]);
  const [vitals, setVitals] = useState({ hr: 78, tempF: 98.6, spo2: 98, bpSys: 120 });

  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [audioNote, setAudioNote] = useState(null);
  const [photoData, setPhotoData] = useState(null);
  const fileInputRef = useRef(null);

  const [showAiDrawer, setShowAiDrawer] = useState(false);
  const [aiPromptFilter, setAiPromptFilter] = useState('all');

  const [activeCall, setActiveCall] = useState(null);
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);

  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [rxMedicine, setRxMedicine] = useState('Paracetamol 500mg + ORS Packets');
  const [rxDose, setRxDose] = useState('1 tab every 6 hrs if fever > 100°F; sip ORS frequently');
  const [smsLog, setSmsLog] = useState([]);

  const showToast = (text, tone = 'info') => setToastMsg({ text, tone, id: Date.now() });

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const speakAudioCue = (text) => {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 0.95;
        window.speechSynthesis.speak(utter);
      }
    } catch {
      /* speech not available */
    }
  };

  // Load vault (seed on first run)
  useEffect(() => {
    let mounted = true;
    (async () => {
      const existing = await localVault.getAll();
      if (!mounted) return;
      if (existing.length > 0) {
        setRecords(existing);
        setSelectedPatientId(existing[0].id);
      } else {
        const seeded = createSeedRecords();
        await localVault.saveAll(seeded);
        if (!mounted) return;
        setRecords(seeded);
        setSelectedPatientId(seeded[0].id);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Recording timer
  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => setRecordingSec((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isRecording]);

  // Attach camera stream once the <video> element exists
  useEffect(() => {
    if (activeCall && !activeCall.camOff && localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [activeCall]);

  // Release camera/mic on unmount
  useEffect(
    () => () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    },
    []
  );

  const liveTriage = useMemo(
    () => evaluateEdgeTriage({ vitals, symptoms, age: patientAge }),
    [vitals, symptoms, patientAge]
  );

  const pendingRecords = useMemo(() => records.filter((r) => r.syncStatus !== 'synced'), [records]);

  const runStoreAndForwardSync = async (currentRecords, mode) => {
    if (mode === 'offline') return currentRecords;
    const unsynced = currentRecords.filter((r) => r.syncStatus !== 'synced');
    if (unsynced.length === 0) return currentRecords;

    setIsSyncing(true);
    showToast(`Syncing ${unsynced.length} encrypted record(s) over ${mode.toUpperCase()}...`, 'sync');

    await new Promise((res) => setTimeout(res, mode === '2g' ? 1400 : 700));

    const updated = currentRecords.map((rec) =>
      rec.syncStatus !== 'synced'
        ? { ...rec, syncStatus: 'synced', syncedAt: new Date().toISOString(), syncedVia: mode }
        : rec
    );

    await localVault.saveAll(updated);
    setRecords(updated);
    setIsSyncing(false);
    showToast(`Synced ${unsynced.length} record(s) to Tele-Doctor Queue.`, 'success');
    return updated;
  };

  const cycleNetworkMode = async () => {
    const order = ['offline', '2g', 'online'];
    const next = order[(order.indexOf(networkMode) + 1) % order.length];
    setNetworkMode(next);

    if (next === 'offline') {
      showToast('OFFLINE mode active — Edge AI & Local Vault ready.', 'warn');
    } else {
      await runStoreAndForwardSync(records, next);
    }
  };

  const toggleSymptom = (tile) => {
    const exists = symptoms.includes(tile.id);
    setSymptoms(exists ? symptoms.filter((id) => id !== tile.id) : [...symptoms, tile.id]);
    speakAudioCue(`${tile.label} ${exists ? 'removed' : 'selected'}`);
  };

  const stepVital = (key, delta, min, max, step = 1) => {
    setVitals((prev) => {
      const raw = prev[key] + delta * step;
      const clamped = Math.min(max, Math.max(min, Number(raw.toFixed(1))));
      return { ...prev, [key]: clamped };
    });
  };

  const handleToggleRecording = () => {
    if (!isRecording) {
      setIsRecording(true);
      setRecordingSec(0);
      speakAudioCue('Recording voice note');
    } else {
      setIsRecording(false);
      const dur = Math.max(1, recordingSec);
      setAudioNote({
        durationSec: dur,
        label: usageMode === 'personal' ? `Self voice note (${dur}s)` : `ASHA voice note (${dur}s)`,
      });
      speakAudioCue('Voice note saved');
    }
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageToWebP(file);
      setPhotoData(compressed);
      showToast(`Photo compressed to WebP (${compressed.originalKb}KB → ${compressed.compressedKb}KB)`, 'info');
    } catch {
      showToast('Could not process image file.', 'warn');
    }
    e.target.value = '';
  };

  const handleSaveRecord = async () => {
    const newId = `REC-${Date.now().toString().slice(-6)}`;
    const avatarMeta = PATIENT_AVATARS.find((a) => a.id === selectedAvatar);

    const draft = {
      id: newId,
      createdAt: new Date().toISOString(),
      chwName: usageMode === 'asha' ? 'Sunita Devi (ASHA-042)' : 'Personal Self-Check',
      usageMode,
      patient: {
        name:
          patientName.trim() ||
          (usageMode === 'personal' ? 'My Health Check' : `${avatarMeta?.label || 'Patient'} #${newId.slice(-3)}`),
        avatar: selectedAvatar,
        age: patientAge,
        village: usageMode === 'personal' ? 'My Home' : 'Bankura Gram-4',
        phone: '+91 98321-00412',
      },
      vitals: { ...vitals },
      symptoms: [...symptoms],
      triage: liveTriage,
      audioNote,
      photo: photoData,
      syncStatus: networkMode === 'offline' ? 'pending' : 'synced',
      encryptedBlob: '',
      prescription: null,
    };
    draft.encryptedBlob = encryptPayloadAES256(draft);

    const nextList = [draft, ...records];
    await localVault.saveAll(nextList);
    setRecords(nextList);
    setSelectedPatientId(draft.id);

    setPatientName('');
    setSymptoms([]);
    setAudioNote(null);
    setPhotoData(null);

    if (networkMode === 'offline') {
      speakAudioCue('Saved offline in encrypted vault');
      showToast(`Saved ${newId} offline in encrypted vault.`, 'warn');
    } else {
      speakAudioCue('Saved and synced with doctor');
      showToast(`Saved & synced ${newId} (${liveTriage.level}).`, 'success');
    }
  };

  const startTeleCall = async (patientRecord = null) => {
    if (networkMode === 'offline') {
      showToast('No internet connection. Switch to 2G or Online for call.', 'warn');
      return;
    }

    // Acquire the stream first; the effect above attaches it once <video> mounts.
    if (networkMode === 'online' && navigator.mediaDevices?.getUserMedia) {
      try {
        localStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        localStreamRef.current = null; // simulated fallback UI
      }
    }

    setActiveCall({
      peerName: networkMode === '2g' ? 'Dr. Ananya Sen (2G Audio Link)' : 'Dr. Ananya Sen (Tele-Clinic)',
      patientRecord: patientRecord || {
        id: 'LIVE-SESSION',
        patient: {
          name: patientName.trim() || (usageMode === 'personal' ? 'Self Caller' : 'Current Patient'),
          age: patientAge,
          avatar: selectedAvatar,
        },
        vitals,
        triage: liveTriage,
      },
      muted: false,
      camOff: networkMode === '2g',
    });
  };

  const endTeleCall = () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setActiveCall(null);
  };

  const toggleMute = () => {
    const nextMuted = !activeCall.muted;
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !nextMuted));
    setActiveCall((prev) => ({ ...prev, muted: nextMuted }));
  };

  const toggleCamera = () => {
    const nextOff = !activeCall.camOff;
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !nextOff));
    setActiveCall((prev) => ({ ...prev, camOff: nextOff }));
  };

  const handleIssuePrescription = async (recordId) => {
    const target = records.find((r) => r.id === recordId);
    if (!target) return;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const rxObj = { medicine: rxMedicine, dose: rxDose, doctor: 'Dr. Ananya Sen, MBBS', issuedAt: time };

    const updated = records.map((r) => (r.id === recordId ? { ...r, prescription: rxObj } : r));
    await localVault.saveAll(updated);
    setRecords(updated);

    setSmsLog((prev) => [
      {
        id: `SMS-${Date.now()}`,
        to: target.patient.phone,
        patientName: target.patient.name,
        text: `AarogyaSync Rx [${target.triage.level}]: ${rxMedicine} — ${rxDose} (-Dr. Sen)`,
        time,
      },
      ...prev,
    ]);
    showToast(`e-Rx & SMS sent to ${target.patient.name}`, 'success');
  };

  const sortedDoctorQueue = useMemo(
    () => [...records].sort((a, b) => (a.triage?.priorityRank || 3) - (b.triage?.priorityRank || 3)),
    [records]
  );

  const activeDoctorPatient = useMemo(
    () => sortedDoctorQueue.find((r) => r.id === selectedPatientId) || sortedDoctorQueue[0] || null,
    [sortedDoctorQueue, selectedPatientId]
  );

  const isDangerTriggered = liveTriage.level !== 'GREEN';

  const netButtonClass =
    networkMode === 'offline'
      ? 'bg-rose-600 text-white'
      : networkMode === '2g'
      ? 'bg-amber-500 text-slate-950'
      : 'bg-emerald-500 text-slate-950';

  // ==========================================================================
  // RENDER
  // ==========================================================================
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col pb-28">
      {/* HEADER */}
      <header className="sticky top-0 z-30 bg-slate-900 text-white px-3 py-2.5 shadow-md">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-teal-500 text-slate-950 flex items-center justify-center">
              <HeartPulse className="w-5 h-5" />
            </div>
            <div className="leading-tight">
              <h1 className="font-black text-base">AarogyaSync</h1>
              <p className="text-[10px] font-semibold text-slate-400">Offline-first rural health triage</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cycleNetworkMode}
              title="Tap to toggle Offline / 2G / Online"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-extrabold tracking-wide transition active:scale-95 ${netButtonClass}`}
            >
              {networkMode === 'offline' ? (
                <>
                  <CloudOff className="w-4 h-4" />
                  OFFLINE
                </>
              ) : networkMode === '2g' ? (
                <>
                  <Radio className="w-4 h-4" />
                  2G SLOW
                </>
              ) : (
                <>
                  <Cloud className="w-4 h-4" />
                  ONLINE
                </>
              )}
            </button>

            <div className="flex items-center bg-slate-800 p-1 rounded-full border border-slate-700">
              <button
                type="button"
                onClick={() => setActiveRole('chw')}
                className={`px-3 py-1 rounded-full text-xs font-bold transition ${
                  activeRole === 'chw' ? 'bg-teal-500 text-slate-950 shadow' : 'text-slate-300 hover:text-white'
                }`}
              >
                {usageMode === 'personal' ? 'My Check' : 'ASHA'}
              </button>
              <button
                type="button"
                onClick={() => setActiveRole('doctor')}
                className={`px-3 py-1 rounded-full text-xs font-bold transition ${
                  activeRole === 'doctor' ? 'bg-sky-400 text-slate-950 shadow' : 'text-slate-300 hover:text-white'
                }`}
              >
                Doctor
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowSyncDrawer(true)}
              className="relative flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-full text-xs font-bold transition active:scale-95"
            >
              <Database className="w-4 h-4 text-teal-400" />
              <span className="hidden sm:inline">Vault</span>
              {pendingRecords.length > 0 && (
                <span className="bg-amber-400 text-slate-950 text-[11px] font-black px-1.5 py-0.5 rounded-full">
                  {pendingRecords.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* TOAST */}
      {toastMsg && (
        <div className="max-w-4xl w-full mx-auto px-3 pt-2 z-20">
          <div
            className={`px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-between shadow ${
              toastMsg.tone === 'success'
                ? 'bg-emerald-600 text-white'
                : toastMsg.tone === 'warn'
                ? 'bg-amber-400 text-slate-950'
                : toastMsg.tone === 'sync'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-white'
            }`}
          >
            <span className="flex items-center gap-2">
              {isSyncing && <RefreshCw className="w-4 h-4 animate-spin" />}
              {toastMsg.text}
            </span>
            <button type="button" aria-label="Dismiss" onClick={() => setToastMsg(null)} className="p-1 opacity-80 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-4xl w-full mx-auto px-3 sm:px-4 pt-3 space-y-4">
        {activeRole === 'chw' ? (
          <div className="max-w-xl mx-auto space-y-4">
            {/* MODE SWITCH */}
            <div className="bg-white rounded-3xl p-2 shadow-sm border border-slate-200 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setUsageMode('asha');
                  speakAudioCue('ASHA worker mode selected');
                }}
                className={`py-2.5 px-3 rounded-2xl flex items-center justify-center gap-2 font-black text-xs sm:text-sm transition active:scale-95 ${
                  usageMode === 'asha' ? 'bg-teal-600 text-white shadow' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <HeartPulse className="w-4 h-4 shrink-0" />
                <div className="text-left leading-tight">
                  <span className="block">ASHA Worker</span>
                  <span className="text-[10px] font-semibold opacity-85 block">आशा कार्यकर्ता</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setUsageMode('personal');
                  speakAudioCue('Personal health check mode selected');
                }}
                className={`py-2.5 px-3 rounded-2xl flex items-center justify-center gap-2 font-black text-xs sm:text-sm transition active:scale-95 ${
                  usageMode === 'personal' ? 'bg-sky-600 text-white shadow' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <User className="w-4 h-4 shrink-0" />
                <div className="text-left leading-tight">
                  <span className="block">Personal Use</span>
                  <span className="text-[10px] font-semibold opacity-85 block">अपना जाँच / নিজের জন্য</span>
                </div>
              </button>
            </div>

            {/* TELE-DOCTOR BANNER */}
            {networkMode !== 'offline' && (
              <div className="bg-gradient-to-r from-emerald-600 to-teal-700 text-white rounded-3xl p-3.5 shadow-md flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                    {networkMode === '2g' ? <Phone className="w-6 h-6" /> : <Video className="w-6 h-6" />}
                  </div>
                  <div>
                    <div className="text-xs font-extrabold uppercase tracking-wider text-emerald-100">
                      {networkMode === '2g' ? '2G Audio Call Ready' : 'Live Video Doctor Ready'}
                    </div>
                    <div className="text-sm font-black">Dr. Ananya Sen • Tele-Clinic</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => startTeleCall()}
                  className="bg-white text-emerald-900 hover:bg-emerald-50 font-black text-xs sm:text-sm px-4 py-2.5 rounded-2xl shadow flex items-center gap-1.5 transition active:scale-95 shrink-0"
                >
                  {networkMode === '2g' ? (
                    <>
                      <Phone className="w-4 h-4" />
                      <span>Call</span>
                    </>
                  ) : (
                    <>
                      <Video className="w-4 h-4" />
                      <span>Video Call</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* PATIENT */}
            <section className="bg-white rounded-3xl p-3.5 shadow-sm border border-slate-200 space-y-3">
              <div className="grid grid-cols-4 gap-2">
                {PATIENT_AVATARS.map((av) => {
                  const active = selectedAvatar === av.id;
                  return (
                    <button
                      key={av.id}
                      type="button"
                      onClick={() => {
                        setSelectedAvatar(av.id);
                        speakAudioCue(av.label);
                      }}
                      className={`py-2.5 px-1 rounded-2xl border-2 flex flex-col items-center gap-1 transition active:scale-95 ${
                        active
                          ? 'bg-slate-900 border-slate-900 text-white shadow'
                          : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100'
                      }`}
                    >
                      <span className="text-2xl leading-none">{av.emoji}</span>
                      <span className="text-[11px] font-extrabold">{av.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={usageMode === 'personal' ? 'Your Name (Optional)' : 'Patient Name (Optional)'}
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  className="flex-1 min-w-0 px-3.5 py-2.5 rounded-2xl bg-slate-100 border border-slate-200 text-sm font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                />

                <div className="flex items-center bg-slate-100 border border-slate-200 rounded-2xl px-1.5 py-1 gap-1.5">
                  <button
                    type="button"
                    aria-label="Decrease age"
                    onClick={() => setPatientAge((a) => Math.max(0, a - 1))}
                    className="w-8 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center active:scale-90"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <div className="text-center min-w-[44px]">
                    <span className="block text-[10px] font-bold text-slate-500 uppercase">Age</span>
                    <span className="text-sm font-black">{patientAge}y</span>
                  </div>
                  <button
                    type="button"
                    aria-label="Increase age"
                    onClick={() => setPatientAge((a) => Math.min(110, a + 1))}
                    className="w-8 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center active:scale-90"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </section>

            {/* SYMPTOMS */}
            <section className="grid grid-cols-3 gap-2.5">
              {SYMPTOM_TILES.map((tile) => {
                const selected = symptoms.includes(tile.id);
                return (
                  <div
                    key={tile.id}
                    onClick={() => toggleSymptom(tile)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleSymptom(tile);
                      }
                    }}
                    className={`relative rounded-3xl p-3 border-2 flex flex-col items-center justify-between gap-1.5 cursor-pointer transition active:scale-95 ${
                      selected ? tile.activeClass : tile.bgClass
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        speakAudioCue(`${tile.label}. ${tile.localHint}`);
                      }}
                      title="Listen"
                      aria-label={`Listen: ${tile.label}`}
                      className="self-end p-1 rounded-full bg-black/10 hover:bg-black/20"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>

                    {tile.svg}

                    <div className="text-center leading-tight">
                      <div className="text-xs sm:text-sm font-black">{tile.label}</div>
                      <div className="text-[10px] font-bold opacity-80">{tile.localHint}</div>
                    </div>
                  </div>
                );
              })}
            </section>

            {/* VITALS */}
            <section className="bg-white rounded-3xl p-3.5 shadow-sm border border-slate-200 grid grid-cols-2 gap-2.5">
              <VitalCard
                icon={<HeartPulse className="w-6 h-6 text-rose-600 shrink-0" />}
                label="Pulse"
                valueNode={
                  <div className={`text-base font-black ${vitals.hr > 120 || vitals.hr < 50 ? 'text-rose-600' : 'text-slate-900'}`}>
                    {vitals.hr} <span className="text-[10px]">bpm</span>
                  </div>
                }
                onUp={() => stepVital('hr', 1, 35, 200, 2)}
                onDown={() => stepVital('hr', -1, 35, 200, 2)}
              />
              <VitalCard
                icon={<Thermometer className="w-6 h-6 text-amber-600 shrink-0" />}
                label="Temp"
                valueNode={
                  <div
                    className={`text-base font-black ${
                      vitals.tempF >= 102 ? 'text-rose-600' : vitals.tempF >= 100 ? 'text-amber-600' : 'text-slate-900'
                    }`}
                  >
                    {vitals.tempF}°F
                  </div>
                }
                onUp={() => stepVital('tempF', 1, 95, 108, 0.4)}
                onDown={() => stepVital('tempF', -1, 95, 108, 0.4)}
              />
              <VitalCard
                icon={<Activity className="w-6 h-6 text-sky-600 shrink-0" />}
                label="SpO₂"
                valueNode={
                  <div
                    className={`text-base font-black ${
                      vitals.spo2 < 92 ? 'text-rose-600' : vitals.spo2 < 95 ? 'text-amber-600' : 'text-slate-900'
                    }`}
                  >
                    {vitals.spo2}%
                  </div>
                }
                onUp={() => stepVital('spo2', 1, 70, 100, 1)}
                onDown={() => stepVital('spo2', -1, 70, 100, 1)}
              />
              <VitalCard
                icon={<Stethoscope className="w-6 h-6 text-indigo-600 shrink-0" />}
                label="BP Sys"
                valueNode={
                  <div className={`text-base font-black ${vitals.bpSys >= 160 || vitals.bpSys < 85 ? 'text-rose-600' : 'text-slate-900'}`}>
                    {vitals.bpSys}
                  </div>
                }
                onUp={() => stepVital('bpSys', 1, 70, 220, 5)}
                onDown={() => stepVital('bpSys', -1, 70, 220, 5)}
              />
            </section>

            {/* VOICE + PHOTO */}
            <section className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleToggleRecording}
                className={`rounded-3xl p-3.5 flex items-center justify-center gap-2.5 font-black text-sm shadow-sm border transition active:scale-95 ${
                  isRecording
                    ? 'bg-rose-600 text-white border-rose-700 animate-pulse'
                    : 'bg-white text-slate-900 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span className="w-10 h-10 rounded-full bg-rose-600 text-white flex items-center justify-center shrink-0">
                  {isRecording ? <Square className="w-4 h-4 fill-current" /> : <Mic className="w-5 h-5" />}
                </span>
                <div className="text-left leading-tight">
                  <span>{isRecording ? `${recordingSec}s Stop` : 'Voice Note'}</span>
                  {audioNote && !isRecording && (
                    <span className="block text-[10px] font-bold text-emerald-700">✓ {audioNote.durationSec}s saved</span>
                  )}
                </div>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 rounded-3xl p-3.5 flex items-center justify-center gap-2.5 font-black text-sm shadow-sm transition active:scale-95"
              >
                <span className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center shrink-0">
                  <Camera className="w-5 h-5" />
                </span>
                <div className="text-left leading-tight">
                  <span>Photo</span>
                  {photoData && (
                    <span className="block text-[10px] font-bold text-teal-700">✓ WebP {photoData.compressedKb}KB</span>
                  )}
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoChange}
                className="hidden"
              />
            </section>

            {/* LIVE TRIAGE */}
            <section className="bg-slate-900 text-white rounded-3xl p-3.5 shadow-md space-y-2.5">
              <div className="grid grid-cols-3 gap-2">
                <div
                  className={`rounded-2xl py-2 flex flex-col items-center justify-center gap-1 border-2 ${
                    liveTriage.level === 'GREEN'
                      ? 'bg-emerald-500 border-white text-slate-950 scale-105 shadow-lg'
                      : 'bg-emerald-950/60 border-emerald-800/50 text-emerald-300/60'
                  }`}
                >
                  <span className="text-xl leading-none">🟢</span>
                  <span className="text-[11px] font-black">SAFE</span>
                </div>
                <div
                  className={`rounded-2xl py-2 flex flex-col items-center justify-center gap-1 border-2 ${
                    liveTriage.level === 'YELLOW'
                      ? 'bg-amber-400 border-white text-slate-950 scale-105 shadow-lg'
                      : 'bg-amber-950/60 border-amber-800/50 text-amber-300/60'
                  }`}
                >
                  <span className="text-xl leading-none">🟡</span>
                  <span className="text-[11px] font-black">CLINIC</span>
                </div>
                <div
                  className={`rounded-2xl py-2 flex flex-col items-center justify-center gap-1 border-2 ${
                    liveTriage.level === 'RED'
                      ? 'bg-rose-600 border-white text-white scale-105 shadow-lg'
                      : 'bg-rose-950/60 border-rose-800/50 text-rose-300/60'
                  }`}
                >
                  <span className="text-xl leading-none">🚑</span>
                  <span className="text-[11px] font-black">URGENT</span>
                </div>
              </div>

              <div className="flex items-center justify-between px-1 pt-1">
                <div className="flex items-center gap-2 text-lg">
                  {liveTriage.firstAidIcons.map((ic, i) => (
                    <span key={i}>{ic}</span>
                  ))}
                </div>
                <span className="text-xs font-extrabold text-slate-300">{liveTriage.label}</span>
              </div>
            </section>

            <button
              type="button"
              onClick={handleSaveRecord}
              className="w-full py-4 rounded-3xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-lg shadow-lg flex items-center justify-center gap-2 transition active:scale-[0.98]"
            >
              <CheckCircle2 className="w-6 h-6" />
              <span>{networkMode === 'offline' ? 'Save Offline' : 'Save & Sync'}</span>
            </button>
          </div>
        ) : (
          /* DOCTOR VIEW */
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-5 bg-white rounded-3xl p-3.5 shadow-sm border border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <h2 className="font-black text-sm text-slate-800">Triage Queue ({sortedDoctorQueue.length})</h2>
                <span className="text-[11px] font-bold text-slate-500">Urgency Sorted</span>
              </div>

              {sortedDoctorQueue.map((item) => {
                const isSelected = activeDoctorPatient?.id === item.id;
                const badgeColor =
                  item.triage?.level === 'RED'
                    ? 'bg-rose-100 text-rose-800 border-rose-300'
                    : item.triage?.level === 'YELLOW'
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : 'bg-emerald-100 text-emerald-800 border-emerald-300';

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedPatientId(item.id)}
                    className={`w-full text-left p-3 rounded-2xl border-2 transition ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 text-slate-900 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black text-sm truncate">
                        {item.patient.name} ({item.patient.age}y)
                      </span>
                      <span
                        className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                          isSelected ? 'bg-white text-slate-900' : badgeColor
                        }`}
                      >
                        {item.triage?.level}
                      </span>
                    </div>
                    <div
                      className={`text-xs mt-1 flex items-center justify-between ${
                        isSelected ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      <span>
                        SpO₂ {item.vitals.spo2}% • {item.vitals.tempF}°F
                      </span>
                      <span>{item.syncStatus === 'synced' ? '☁ Synced' : '🔒 Offline'}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="md:col-span-7 space-y-4">
              {activeDoctorPatient && (
                <div className="bg-white rounded-3xl p-4 shadow-sm border border-slate-200 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <div className="text-xs font-bold text-slate-400">
                        {activeDoctorPatient.id} • {activeDoctorPatient.patient.village}
                      </div>
                      <h3 className="text-lg font-black text-slate-900">
                        {activeDoctorPatient.patient.name} ({activeDoctorPatient.patient.age}y)
                      </h3>
                    </div>

                    <button
                      type="button"
                      onClick={() => startTeleCall(activeDoctorPatient)}
                      className="px-4 py-2 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center gap-1.5 shadow transition active:scale-95"
                    >
                      {networkMode === '2g' ? (
                        <>
                          <Phone className="w-4 h-4" />
                          <span>2G Audio Call</span>
                        </>
                      ) : (
                        <>
                          <Video className="w-4 h-4" />
                          <span>Video Consult</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                      ['Pulse', activeDoctorPatient.vitals.hr],
                      ['Temp', `${activeDoctorPatient.vitals.tempF}°F`],
                      ['SpO₂', `${activeDoctorPatient.vitals.spo2}%`],
                      ['BP', activeDoctorPatient.vitals.bpSys],
                    ].map(([label, value]) => (
                      <div key={label} className="bg-slate-50 rounded-2xl p-2 border border-slate-200">
                        <div className="text-[10px] font-bold text-slate-500">{label}</div>
                        <div className="text-sm font-black">{value}</div>
                      </div>
                    ))}
                  </div>

                  {(activeDoctorPatient.photo || activeDoctorPatient.audioNote) && (
                    <div className="flex flex-wrap items-center gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                      {activeDoctorPatient.photo && (
                        <img
                          src={activeDoctorPatient.photo.dataUrl}
                          alt="Clinical capture"
                          className="w-16 h-16 object-cover rounded-xl border"
                        />
                      )}
                      {activeDoctorPatient.audioNote && (
                        <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          <Mic className="w-4 h-4 text-rose-600" />
                          <span>{activeDoctorPatient.audioNote.label}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-2.5 pt-1">
                    <div className="text-xs font-black uppercase text-slate-500 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-sky-600" />
                      <span>Digital Prescription + SMS Alert</span>
                    </div>
                    <input
                      type="text"
                      value={rxMedicine}
                      onChange={(e) => setRxMedicine(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 text-xs font-bold"
                    />
                    <input
                      type="text"
                      value={rxDose}
                      onChange={(e) => setRxDose(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 text-xs font-semibold"
                    />
                    <button
                      type="button"
                      onClick={() => handleIssuePrescription(activeDoctorPatient.id)}
                      className="w-full py-2.5 rounded-2xl bg-sky-600 hover:bg-sky-500 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow transition active:scale-95"
                    >
                      <Send className="w-4 h-4" />
                      <span>Send e-Rx & SMS</span>
                    </button>
                  </div>

                  {activeDoctorPatient.prescription && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-xs">
                      <div className="font-black text-emerald-900">
                        Issued Rx: {activeDoctorPatient.prescription.medicine}
                      </div>
                      <div className="text-emerald-800 mt-0.5">{activeDoctorPatient.prescription.dose}</div>
                    </div>
                  )}
                </div>
              )}

              {smsLog.length > 0 && (
                <div className="bg-white rounded-3xl p-3.5 shadow-sm border border-slate-200 space-y-2">
                  <div className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-teal-600" />
                    <span>Dispatched SMS Alerts ({smsLog.length})</span>
                  </div>
                  {smsLog.map((sms) => (
                    <div key={sms.id} className="bg-slate-50 rounded-2xl p-2.5 text-xs border border-slate-200">
                      <div className="font-bold text-slate-800">
                        To {sms.patientName} ({sms.to}) • {sms.time}
                      </div>
                      <div className="text-slate-600 mt-0.5">{sms.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* FLOATING AI BUTTON */}
      <button
        type="button"
        onClick={() => setShowAiDrawer(true)}
        aria-label="Offline AI Triage Assistant"
        className={`fixed bottom-5 right-4 z-30 w-16 h-16 rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-2xl border-4 border-white flex flex-col items-center justify-center transition active:scale-90 ${
          isDangerTriggered ? 'ring-4 ring-rose-500 animate-bounce' : ''
        }`}
      >
        <div className="relative flex items-center justify-center">
          <Bot className="w-7 h-7" />
          <Sparkles className="w-3.5 h-3.5 text-amber-300 absolute -top-1.5 -right-2" />
        </div>
        <span className="text-[9px] font-black tracking-wider uppercase mt-0.5">AI</span>
      </button>

      {/* AI DRAWER */}
      {showAiDrawer && (
        <div className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center">
                  <Bot className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-900">Offline AI Triage Guide</h3>
                  <p className="text-[11px] font-bold text-slate-500">Works 100% Offline • Danger Signs & First Aid</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setShowAiDrawer(false)}
                className="p-2 rounded-full bg-slate-100 hover:bg-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setAiPromptFilter(aiPromptFilter === 'danger' ? 'all' : 'danger')}
                className={`py-2 px-2 rounded-2xl text-xs font-black flex flex-col items-center gap-1 border ${
                  aiPromptFilter === 'danger' ? 'bg-rose-600 text-white border-rose-700' : 'bg-rose-50 text-rose-900 border-rose-200'
                }`}
              >
                <ShieldAlert className="w-4 h-4" />
                <span>⚠️ Danger</span>
              </button>
              <button
                type="button"
                onClick={() => setAiPromptFilter(aiPromptFilter === 'firstaid' ? 'all' : 'firstaid')}
                className={`py-2 px-2 rounded-2xl text-xs font-black flex flex-col items-center gap-1 border ${
                  aiPromptFilter === 'firstaid' ? 'bg-teal-600 text-white border-teal-700' : 'bg-teal-50 text-teal-900 border-teal-200'
                }`}
              >
                <HeartPulse className="w-4 h-4" />
                <span>🩹 First Aid</span>
              </button>
              <button
                type="button"
                onClick={() => setAiPromptFilter(aiPromptFilter === 'referral' ? 'all' : 'referral')}
                className={`py-2 px-2 rounded-2xl text-xs font-black flex flex-col items-center gap-1 border ${
                  aiPromptFilter === 'referral' ? 'bg-amber-500 text-slate-950 border-amber-600' : 'bg-amber-50 text-amber-900 border-amber-200'
                }`}
              >
                <AlertTriangle className="w-4 h-4" />
                <span>🚑 Referral</span>
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-slate-500">Current Status</span>
                <span
                  className={`text-xs font-black px-2.5 py-0.5 rounded-full ${
                    liveTriage.level === 'RED'
                      ? 'bg-rose-600 text-white'
                      : liveTriage.level === 'YELLOW'
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-emerald-600 text-white'
                  }`}
                >
                  {liveTriage.label}
                </span>
              </div>

              {(aiPromptFilter === 'all' || aiPromptFilter === 'danger') && (
                <div className="space-y-1">
                  <div className="text-xs font-black text-rose-700">⚠️ Flagged Signs:</div>
                  <ul className="text-xs font-semibold text-slate-800 list-disc pl-5 space-y-0.5">
                    {liveTriage.flags.map((f, idx) => (
                      <li key={idx}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(aiPromptFilter === 'all' || aiPromptFilter === 'firstaid') && (
                <div className="space-y-1 pt-1 border-t border-slate-200">
                  <div className="text-xs font-black text-teal-800">
                    🩹 Immediate First Aid ({liveTriage.firstAidIcons.join(' ')}):
                  </div>
                  <ul className="text-xs font-semibold text-slate-800 list-disc pl-5 space-y-0.5">
                    {liveTriage.guidance.map((g, idx) => (
                      <li key={idx}>{g}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(aiPromptFilter === 'all' || aiPromptFilter === 'referral') && (
                <div className="pt-1 border-t border-slate-200 text-xs font-bold text-slate-800">
                  🚑 Referral Priority:{' '}
                  {liveTriage.level === 'RED'
                    ? 'Priority #1 — Immediate PHC / District Hospital transfer.'
                    : liveTriage.level === 'YELLOW'
                    ? 'Priority #2 — Tele-doctor consult & clinic visit within 24h.'
                    : 'Priority #3 — Home care & routine follow-up.'}
                </div>
              )}
            </div>

            <p className="text-[10px] font-semibold text-slate-500">
              This guide supports, and does not replace, a trained health worker or doctor. When in doubt, refer.
            </p>

            <button
              type="button"
              onClick={() => speakAudioCue(`${liveTriage.label}. ${liveTriage.guidance.join('. ')}`)}
              className="w-full py-3 rounded-2xl bg-slate-900 text-white font-black text-xs flex items-center justify-center gap-2"
            >
              <Volume2 className="w-4 h-4" />
              <span>Read First Aid Aloud</span>
            </button>
          </div>
        </div>
      )}

      {/* VAULT DRAWER */}
      {showSyncDrawer && (
        <div className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-teal-600" />
                <h3 className="font-black text-base">Encrypted Offline Vault ({records.length})</h3>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setShowSyncDrawer(false)}
                className="p-2 rounded-full bg-slate-100 hover:bg-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-between bg-slate-100 p-3 rounded-2xl">
              <div className="text-xs font-bold text-slate-700">
                Pending Sync: <span className="font-black">{pendingRecords.length}</span>
              </div>
              <button
                type="button"
                disabled={networkMode === 'offline' || pendingRecords.length === 0 || isSyncing}
                onClick={() => runStoreAndForwardSync(records, networkMode)}
                className="px-3.5 py-2 rounded-xl bg-teal-600 disabled:bg-slate-300 text-white font-black text-xs flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>Sync Now</span>
              </button>
            </div>

            <div className="space-y-2">
              {records.map((rec) => (
                <div key={rec.id} className="p-3 rounded-2xl border border-slate-200 bg-slate-50 text-xs space-y-1">
                  <div className="flex items-center justify-between font-black">
                    <span>
                      {rec.id} • {rec.patient.name}
                    </span>
                    <span className={rec.syncStatus === 'synced' ? 'text-emerald-700' : 'text-amber-700'}>
                      {rec.syncStatus === 'synced' ? '✓ Synced' : '⏳ Pending'}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 truncate">{rec.encryptedBlob}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TELE-CALL OVERLAY */}
      {activeCall && (
        <div className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col justify-between p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-extrabold uppercase text-emerald-400">
                {networkMode === '2g' ? 'Low-Bandwidth 2G Audio' : 'HD Tele-Consult'}
              </div>
              <div className="text-base font-black">{activeCall.peerName}</div>
            </div>
            <span className="px-3 py-1 rounded-full bg-white/10 text-xs font-bold">
              {activeCall.patientRecord?.patient?.name}
            </span>
          </div>

          <div className="relative flex-1 my-4 rounded-3xl bg-slate-900 border border-slate-800 flex flex-col items-center justify-center overflow-hidden">
            {networkMode === 'online' && !activeCall.camOff && localStreamRef.current ? (
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover opacity-80" />
            ) : (
              <div className="flex flex-col items-center gap-3 p-6 text-center">
                <div className="w-20 h-20 rounded-full bg-emerald-600/20 border-2 border-emerald-400 flex items-center justify-center">
                  <Stethoscope className="w-10 h-10 text-emerald-400" />
                </div>
                <div className="text-lg font-black">{activeCall.peerName}</div>
                <div className="text-xs text-slate-400 max-w-xs">
                  {networkMode === '2g'
                    ? 'Video paused automatically to save 2G bandwidth. Voice & vitals active.'
                    : 'Connected to Tele-Doctor clinical room.'}
                </div>
              </div>
            )}

            <div className="absolute bottom-3 left-3 right-3 bg-slate-950/80 backdrop-blur-sm rounded-2xl px-3.5 py-2 flex items-center justify-around text-xs font-black">
              <span>❤️ {vitals.hr}</span>
              <span>🌡️ {vitals.tempF}°F</span>
              <span>🫁 {vitals.spo2}%</span>
              <span className="px-2 py-0.5 rounded-full bg-white/15">{liveTriage.level}</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-4 pb-2">
            <button
              type="button"
              aria-label={activeCall.muted ? 'Unmute' : 'Mute'}
              onClick={toggleMute}
              className={`w-14 h-14 rounded-full flex items-center justify-center font-bold ${
                activeCall.muted ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-white'
              }`}
            >
              <Mic className="w-6 h-6" />
            </button>

            {networkMode === 'online' && (
              <button
                type="button"
                aria-label={activeCall.camOff ? 'Turn camera on' : 'Turn camera off'}
                onClick={toggleCamera}
                className={`w-14 h-14 rounded-full flex items-center justify-center font-bold ${
                  activeCall.camOff ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-white'
                }`}
              >
                {activeCall.camOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
              </button>
            )}

            <button
              type="button"
              aria-label="End call"
              onClick={endTeleCall}
              className="w-16 h-14 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-lg"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
