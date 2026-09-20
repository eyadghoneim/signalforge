// طبقة التخزين المحلية: JSON ذري على القرص (tmp + rename) — بسيطة ومحمولة بلا سحابة
import * as fs from 'fs';
import * as path from 'path';
import type { BotConfig, StoredSignal, SignalOutcomes, LearningLesson } from '../shared/types';
import { DEFAULT_PROTECTION } from './protection';

const DATA_DIR = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SIGNALS_FILE = path.join(DATA_DIR, 'signals.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const LEARNING_FILE = path.join(DATA_DIR, 'learning.json');
const LESSONS_FILE = path.join(DATA_DIR, 'lessons.json');

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
  protection: DEFAULT_PROTECTION,
};

export function loadConfig(): BotConfig {
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
  writeJson(CONFIG_FILE, next);
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
  const list = readJson<StoredSignal[]>(SIGNALS_FILE, []);
  list.push(signal);
  writeJson(SIGNALS_FILE, list.slice(-500)); // سقف 500 إشارة
}

export function listSignals(limit = 200): StoredSignal[] {
  const list = readJson<StoredSignal[]>(SIGNALS_FILE, []);
  return list.slice(-limit).reverse();
}

export function getLastSignalForAsset(asset: string): StoredSignal | null {
  const list = readJson<StoredSignal[]>(SIGNALS_FILE, []);
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].asset === asset) return list[i];
  }
  return null;
}

export function updateSignalOutcomes(id: string, outcomes: SignalOutcomes): boolean {
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
  const list = readJson<BotLog[]>(LOGS_FILE, []);
  list.push({ level, message: message.slice(0, 300), at: Date.now() });
  writeJson(LOGS_FILE, list.slice(-1000));
}

export function listLogs(limit = 50): BotLog[] {
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
  const state = readJson<{ biases?: Record<string, number> }>(LEARNING_FILE, {});
  return state.biases ?? {};
}

export function saveTagBias(biases: Record<string, number>): void {
  writeJson(LEARNING_FILE, { biases, updatedAt: Date.now() });
}

export function appendLesson(lesson: LearningLesson): void {
  const list = readJson<LearningLesson[]>(LESSONS_FILE, []);
  list.push(lesson);
  writeJson(LESSONS_FILE, list.slice(-200));
}

export function listLessons(limit = 50): LearningLesson[] {
  return readJson<LearningLesson[]>(LESSONS_FILE, []).slice(-limit).reverse();
}