// طبقة التخزين: PostgreSQL اختياري ودائم عند توفر DATABASE_URL، مع JSON ذري كخطة احتياطية محلية
import * as fs from 'fs';
import * as path from 'path';
import type { BotConfig, StoredSignal, SignalOutcomes, LearningLesson } from '../shared/types';
import { DEFAULT_PROTECTION } from './protection';
import { createDurableStore, type DurableStore } from './durablePersistence';

const DATA_DIR = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SIGNALS_FILE = path.join(DATA_DIR, 'signals.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const LEARNING_FILE = path.join(DATA_DIR, 'learning.json');
const LESSONS_FILE = path.join(DATA_DIR, 'lessons.json');

let durableStore: DurableStore | null = null;

export async function initializeDurablePersistence(): Promise<boolean> {
  if (durableStore) return true;
  const store = await createDurableStore(DEFAULT_CONFIG);
  if (!store) return false;
  durableStore = store;
  return true;
}

export function getDurablePersistence(): DurableStore | null {
  return durableStore;
}

export async function closeDurablePersistence(): Promise<void> {
  if (!durableStore) return;
  const store = durableStore;
  durableStore = null;
  await store.close();
}

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    // ملف تالف → نرجع الافتراضي ولا نهدم البيانات
  }
  return fallback;
}

function writeJson(file: string, data: unknown): void {
  ensureDir();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

// ─── الإعدادات ───
export const DEFAULT_CONFIG: BotConfig = {
  scanIntervalSeconds: 120,
  telegramEnabled: false,
  telegramToken: '',
  telegramChatId: '',
  gates: { htf: true, chop: true, rvol: true, funding: true },
  adminToken: '',
  regimeEnabled: true,
  digestEnabled: true,
  paperAlertsEnabled: true,
  telegramLang: 'ar',
  paperEnginePaused: false,
  protection: DEFAULT_PROTECTION,
};

export function loadConfig(): BotConfig {
  if (durableStore) return durableStore.loadConfig(DEFAULT_CONFIG);
  const stored = readJson<Partial<BotConfig>>(CONFIG_FILE, {});
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    gates: { ...DEFAULT_CONFIG.gates, ...(stored.gates || {}) },
    protection: { ...DEFAULT_PROTECTION, ...(stored.protection || {}) },
  };
}

export function saveConfig(partial: Partial<BotConfig>): BotConfig {
  const current = loadConfig();
  const next: BotConfig = {
    ...current,
    ...partial,
    gates: { ...current.gates, ...(partial.gates || {}) },
    protection: { ...current.protection, ...(partial.protection || {}) },
  };
  next.scanIntervalSeconds = Math.min(3600, Math.max(30, Math.round(next.scanIntervalSeconds)));
  if (durableStore) durableStore.saveConfig(next);
  else writeJson(CONFIG_FILE, next);
  return next;
}

// ─── الإشارات ───
export function defaultOutcomes(): SignalOutcomes {
  return {
    windows: {
      h4: { mfePercent: 0, maePercent: 0, hitTp1BeforeSl: null },
      h24: { mfePercent: 0, maePercent: 0, hitTp1BeforeSl: null },
      h72: { mfePercent: 0, maePercent: 0, hitTp1BeforeSl: null },
    },
    resolution: 'OPEN',
  };
}

export function appendSignal(signal: StoredSignal): void {
  if (durableStore) {
    durableStore.appendSignal(signal);
    return;
  }
  const list = readJson<StoredSignal[]>(SIGNALS_FILE, []);
  list.push(signal);
  writeJson(SIGNALS_FILE, list.slice(-500)); // سقف 500 إشارة
}

export function listSignals(limit = 200): StoredSignal[] {
  if (durableStore) return durableStore.listSignals(limit);
  const list = readJson<StoredSignal[]>(SIGNALS_FILE, []);
  return list.slice(-limit).reverse();
}

export function getLastSignalForAsset(asset: string): StoredSignal | null {
  if (durableStore) return durableStore.getLastSignalForAsset(asset);
  const list = readJson<StoredSignal[]>(SIGNALS_FILE, []);
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].asset === asset) return list[i];
  }
  return null;
}

export function updateSignalOutcomes(id: string, outcomes: SignalOutcomes): boolean {
  if (durableStore) return durableStore.updateSignalOutcomes(id, outcomes);
  const list = readJson<StoredSignal[]>(SIGNALS_FILE, []);
  let changed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].id === id) {
      list[i].outcomes = outcomes;
      changed = true;
      break;
    }
  }
  if (changed) writeJson(SIGNALS_FILE, list);
  return changed;
}

export function markTelegramSent(id: string, sent: boolean): void {
  if (durableStore) {
    durableStore.markTelegramSent(id, sent);
    return;
  }
  const list = readJson<StoredSignal[]>(SIGNALS_FILE, []);
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].id === id) {
      list[i].telegramSent = sent;
      break;
    }
  }
  writeJson(SIGNALS_FILE, list);
}

// ─── السجلات ───
export interface BotLog {
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  at: number;
}

export function appendLog(level: BotLog['level'], message: string): void {
  if (durableStore) {
    durableStore.appendLog(level, message);
    return;
  }
  const list = readJson<BotLog[]>(LOGS_FILE, []);
  list.push({ level, message: message.slice(0, 300), at: Date.now() });
  writeJson(LOGS_FILE, list.slice(-1000));
}

export function listLogs(limit = 50): BotLog[] {
  if (durableStore) return durableStore.listLogs(limit);
  return readJson<BotLog[]>(LOGS_FILE, []).slice(-limit).reverse();
}

export function maskToken(token: string): string {
  const t = (token || '').trim();
  if (!t) return '';
  if (t.length <= 8) return '***';
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

// --- Learning system storage (v3) ---
export function loadTagBias(): Record<string, number> {
  if (durableStore) return durableStore.loadTagBias();
  const state = readJson<{ biases?: Record<string, number> }>(LEARNING_FILE, {});
  return state.biases ?? {};
}

export function saveTagBias(biases: Record<string, number>): void {
  if (durableStore) {
    durableStore.saveTagBias(biases);
    return;
  }
  writeJson(LEARNING_FILE, { biases, updatedAt: Date.now() });
}

export function appendLesson(lesson: LearningLesson): void {
  if (durableStore) {
    durableStore.appendLesson(lesson);
    return;
  }
  const list = readJson<LearningLesson[]>(LESSONS_FILE, []);
  list.push(lesson);
  writeJson(LESSONS_FILE, list.slice(-200));
}

export function listLessons(limit = 50): LearningLesson[] {
  if (durableStore) return durableStore.listLessons(limit);
  return readJson<LearningLesson[]>(LESSONS_FILE, []).slice(-limit).reverse();
}