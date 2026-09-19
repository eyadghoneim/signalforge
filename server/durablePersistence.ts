// PostgreSQL persistence for deployments with an external database (Supabase/Neon/etc.).
// The synchronous application API is preserved: writes are queued in order while the
// in-memory cache serves reads. JSON files are imported once when the DB is first used.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import type { BotConfig, LearningLesson, SignalOutcomes, StoredSignal } from '../shared/types';
import type { PaperAccount } from './paperTrading';

const DATA_DIR = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SIGNALS_FILE = path.join(DATA_DIR, 'signals.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const LEARNING_FILE = path.join(DATA_DIR, 'learning.json');
const LESSONS_FILE = path.join(DATA_DIR, 'lessons.json');
const PAPER_FILE = path.join(DATA_DIR, 'paper.json');

export interface DurableLog {
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  at: number;
}

export interface DurableStore {
  loadConfig(fallback: BotConfig): BotConfig;
  saveConfig(config: BotConfig): void;
  appendSignal(signal: StoredSignal): void;
  listSignals(limit: number): StoredSignal[];
  getLastSignalForAsset(asset: string): StoredSignal | null;
  updateSignalOutcomes(id: string, outcomes: SignalOutcomes): boolean;
  markTelegramSent(id: string, sent: boolean): void;
  appendLog(level: DurableLog['level'], message: string): void;
  listLogs(limit: number): DurableLog[];
  loadTagBias(): Record<string, number>;
  saveTagBias(biases: Record<string, number>): void;
  appendLesson(lesson: LearningLesson): void;
  listLessons(limit: number): LearningLesson[];
  loadPaperAccount<T extends PaperAccount>(fallback: T): T;
  savePaperAccount(account: PaperAccount): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

type StateKey = 'config' | 'learning' | 'paper';
type JsonRecord = Record<string, unknown>;

type StateRow = { key: StateKey; payload: JsonRecord };
type SignalRow = { id: string; payload: StoredSignal; generated_at: number };
type LogRow = { id: string; payload: DurableLog; at: number };
type LessonRow = { id: string; payload: LearningLesson; at: number };

function readJson<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    // A bad local file must not prevent the durable store from starting.
  }
  return fallback;
}

function jsonId(prefix: string, value: unknown): string {
  return `${prefix}_${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function asObject(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

export class PostgresDurableStore implements DurableStore {
  private readonly pool: Pool;
  private config: BotConfig;
  private signals: StoredSignal[];
  private logs: DurableLog[];
  private biases: Record<string, number>;
  private lessons: LearningLesson[];
  private paper: PaperAccount | null;
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(
    pool: Pool,
    config: BotConfig,
    signals: StoredSignal[],
    logs: DurableLog[],
    biases: Record<string, number>,
    lessons: LearningLesson[],
    paper: PaperAccount | null,
  ) {
    this.pool = pool;
    this.config = config;
    this.signals = signals;
    this.logs = logs;
    this.biases = biases;
    this.lessons = lessons;
    this.paper = paper;
  }

  static async create(fallbackConfig: BotConfig): Promise<PostgresDurableStore | null> {
    const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '';
    if (!connectionString.trim()) return null;

    const pool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX) > 0 ? Number(process.env.DATABASE_POOL_MAX) : 4,
      connectionTimeoutMillis: 8_000,
      idleTimeoutMillis: 30_000,
      // Supabase's external connection requires TLS. Keep the compatible default,
      // with an opt-in strict certificate check for deployments that provide the
      // platform CA chain (PGSSL_STRICT=1).
      ssl: { rejectUnauthorized: process.env.PGSSL_STRICT === '1' || process.env.PGSSL_STRICT === 'true' },
    });

    try {
      await pool.query('SELECT 1');
      await PostgresDurableStore.createTables(pool);
      await PostgresDurableStore.migrateLocalFiles(pool, fallbackConfig);
      const state = await PostgresDurableStore.readState(pool);
      const signals = await PostgresDurableStore.readSignals(pool);
      const logs = await PostgresDurableStore.readLogs(pool);
      const lessons = await PostgresDurableStore.readLessons(pool);
      return new PostgresDurableStore(
        pool,
        state.config ? ({ ...fallbackConfig, ...state.config } as BotConfig) : fallbackConfig,
        signals,
        logs,
        state.learning && asObject(state.learning.biases)
          ? (state.learning.biases as Record<string, number>)
          : {},
        lessons,
        state.paper ? (state.paper as unknown as PaperAccount) : null,
      );
    } catch (error) {
      await pool.end().catch(() => {});
      console.error(`Durable PostgreSQL storage unavailable; using local JSON fallback: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private static async createTables(pool: Pool): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS signalforge_state (
        key TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS signalforge_signals (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        generated_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS signalforge_signals_generated_at_idx
        ON signalforge_signals (generated_at DESC);
      CREATE TABLE IF NOT EXISTS signalforge_logs (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS signalforge_logs_at_idx
        ON signalforge_logs (at DESC);
      CREATE TABLE IF NOT EXISTS signalforge_lessons (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS signalforge_lessons_at_idx
        ON signalforge_lessons (at DESC);
    `);
  }

  private static async migrateLocalFiles(pool: Pool, fallbackConfig: BotConfig): Promise<void> {
    const localConfig = readJson<Partial<BotConfig>>(CONFIG_FILE, {});
    const localSignals = readJson<StoredSignal[]>(SIGNALS_FILE, []);
    const localLogs = readJson<DurableLog[]>(LOGS_FILE, []);
    const localLearning = readJson<{ biases?: Record<string, number> }>(LEARNING_FILE, {});
    const localLessons = readJson<LearningLesson[]>(LESSONS_FILE, []);
    const localPaper = readJson<PaperAccount | null>(PAPER_FILE, null);

    const stateResult = await pool.query<{ key: StateKey }>('SELECT key FROM signalforge_state');
    const stateKeys = new Set(stateResult.rows.map((row) => row.key));
    const now = Date.now();
    if (!stateKeys.has('config')) {
      const config = { ...fallbackConfig, ...localConfig };
      await pool.query(
        'INSERT INTO signalforge_state (key, payload, updated_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (key) DO NOTHING',
        ['config', JSON.stringify(config), now],
      );
    }
    if (!stateKeys.has('learning')) {
      await pool.query(
        'INSERT INTO signalforge_state (key, payload, updated_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (key) DO NOTHING',
        ['learning', JSON.stringify({ biases: localLearning.biases ?? {} }), now],
      );
    }
    if (!stateKeys.has('paper') && localPaper && typeof localPaper.cash === 'number') {
      await pool.query(
        'INSERT INTO signalforge_state (key, payload, updated_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (key) DO NOTHING',
        ['paper', JSON.stringify(localPaper), now],
      );
    }

    // Import local history in three batch queries (rather than one network round-trip
    // per row) without overwriting rows already stored remotely.
    const signalRows = localSignals
      .slice(-500)
      .filter((signal): signal is StoredSignal => Boolean(signal?.id))
      .map((signal) => ({ id: signal.id, payload: signal, generated_at: Number(signal.generatedAt) || now }));
    if (signalRows.length > 0) {
      await pool.query(
        `INSERT INTO signalforge_signals (id, payload, generated_at)
         SELECT id, payload, generated_at
         FROM jsonb_to_recordset($1::jsonb) AS r(id TEXT, payload JSONB, generated_at BIGINT)
         ON CONFLICT (id) DO NOTHING`,
        [JSON.stringify(signalRows)],
      );
    }
    const logRows = localLogs
      .slice(-1000)
      .filter((log): log is DurableLog => Boolean(log?.message))
      .map((log) => ({ id: jsonId('log', log), payload: log, at: Number(log.at) || now }));
    if (logRows.length > 0) {
      await pool.query(
        `INSERT INTO signalforge_logs (id, payload, at)
         SELECT id, payload, at
         FROM jsonb_to_recordset($1::jsonb) AS r(id TEXT, payload JSONB, at BIGINT)
         ON CONFLICT (id) DO NOTHING`,
        [JSON.stringify(logRows)],
      );
    }
    const lessonRows = localLessons
      .slice(-200)
      .filter((lesson): lesson is LearningLesson => Boolean(lesson?.tag))
      .map((lesson) => ({ id: jsonId('lesson', lesson), payload: lesson, at: Number(lesson.at) || now }));
    if (lessonRows.length > 0) {
      await pool.query(
        `INSERT INTO signalforge_lessons (id, payload, at)
         SELECT id, payload, at
         FROM jsonb_to_recordset($1::jsonb) AS r(id TEXT, payload JSONB, at BIGINT)
         ON CONFLICT (id) DO NOTHING`,
        [JSON.stringify(lessonRows)],
      );
    }
  }

  private static async readState(pool: Pool): Promise<Partial<Record<StateKey, JsonRecord>>> {
    const result = await pool.query<StateRow>('SELECT key, payload FROM signalforge_state');
    const state: Partial<Record<StateKey, JsonRecord>> = {};
    for (const row of result.rows) state[row.key] = row.payload;
    return state;
  }

  private static async readSignals(pool: Pool): Promise<StoredSignal[]> {
    const result = await pool.query<SignalRow>(
      'SELECT id, payload, generated_at FROM signalforge_signals ORDER BY generated_at ASC LIMIT 500',
    );
    return result.rows.map((row) => row.payload).filter((signal): signal is StoredSignal => Boolean(signal?.id));
  }

  private static async readLogs(pool: Pool): Promise<DurableLog[]> {
    const result = await pool.query<LogRow>('SELECT id, payload, at FROM signalforge_logs ORDER BY at ASC LIMIT 1000');
    return result.rows.map((row) => row.payload).filter((log): log is DurableLog => Boolean(log?.message));
  }

  private static async readLessons(pool: Pool): Promise<LearningLesson[]> {
    const result = await pool.query<LessonRow>('SELECT id, payload, at FROM signalforge_lessons ORDER BY at ASC LIMIT 200');
    return result.rows.map((row) => row.payload).filter((lesson): lesson is LearningLesson => Boolean(lesson?.tag));
  }

  private enqueue(task: () => Promise<void>): void {
    this.writeChain = this.writeChain.then(task).catch((error) => {
      console.error(`Durable storage write failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  loadConfig(fallback: BotConfig): BotConfig {
    return { ...fallback, ...this.config, gates: { ...fallback.gates, ...this.config.gates }, protection: { ...fallback.protection, ...this.config.protection } };
  }

  saveConfig(config: BotConfig): void {
    this.config = config;
    this.enqueue(async () => {
      await this.pool.query(
        'INSERT INTO signalforge_state (key, payload, updated_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at',
        ['config', JSON.stringify(config), Date.now()],
      );
    });
  }

  appendSignal(signal: StoredSignal): void {
    const existing = this.signals.findIndex((item) => item.id === signal.id);
    if (existing >= 0) this.signals[existing] = signal;
    else this.signals.push(signal);
    this.signals = this.signals.slice(-500);
    this.enqueue(async () => {
      await this.pool.query(
        'INSERT INTO signalforge_signals (id, payload, generated_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, generated_at = EXCLUDED.generated_at',
        [signal.id, JSON.stringify(signal), Number(signal.generatedAt) || Date.now()],
      );
      await this.pool.query(
        'DELETE FROM signalforge_signals WHERE id IN (SELECT id FROM signalforge_signals ORDER BY generated_at DESC OFFSET 500)',
      );
    });
  }

  listSignals(limit: number): StoredSignal[] {
    return this.signals.slice(-limit).reverse();
  }

  getLastSignalForAsset(asset: string): StoredSignal | null {
    for (let i = this.signals.length - 1; i >= 0; i--) {
      if (this.signals[i].asset === asset) return this.signals[i];
    }
    return null;
  }

  updateSignalOutcomes(id: string, outcomes: SignalOutcomes): boolean {
    const signal = this.signals.find((item) => item.id === id);
    if (!signal) return false;
    signal.outcomes = outcomes;
    this.enqueue(async () => {
      await this.pool.query(
        'UPDATE signalforge_signals SET payload = $2::jsonb WHERE id = $1',
        [id, JSON.stringify(signal)],
      );
    });
    return true;
  }

  markTelegramSent(id: string, sent: boolean): void {
    const signal = this.signals.find((item) => item.id === id);
    if (!signal) return;
    signal.telegramSent = sent;
    this.enqueue(async () => {
      await this.pool.query(
        'UPDATE signalforge_signals SET payload = $2::jsonb WHERE id = $1',
        [id, JSON.stringify(signal)],
      );
    });
  }

  appendLog(level: DurableLog['level'], message: string): void {
    const log: DurableLog = { level, message: message.slice(0, 300), at: Date.now() };
    this.logs.push(log);
    this.logs = this.logs.slice(-1000);
    const id = jsonId('log', { ...log, sequence: this.logs.length });
    this.enqueue(async () => {
      await this.pool.query(
        'INSERT INTO signalforge_logs (id, payload, at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (id) DO NOTHING',
        [id, JSON.stringify(log), log.at],
      );
      await this.pool.query(
        'DELETE FROM signalforge_logs WHERE id IN (SELECT id FROM signalforge_logs ORDER BY at DESC OFFSET 1000)',
      );
    });
  }

  listLogs(limit: number): DurableLog[] {
    return this.logs.slice(-limit).reverse();
  }

  loadTagBias(): Record<string, number> {
    return { ...this.biases };
  }

  saveTagBias(biases: Record<string, number>): void {
    this.biases = { ...biases };
    this.enqueue(async () => {
      await this.pool.query(
        'INSERT INTO signalforge_state (key, payload, updated_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at',
        ['learning', JSON.stringify({ biases: this.biases }), Date.now()],
      );
    });
  }

  appendLesson(lesson: LearningLesson): void {
    this.lessons.push(lesson);
    this.lessons = this.lessons.slice(-200);
    const id = jsonId('lesson', lesson);
    this.enqueue(async () => {
      await this.pool.query(
        'INSERT INTO signalforge_lessons (id, payload, at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (id) DO NOTHING',
        [id, JSON.stringify(lesson), Number(lesson.at) || Date.now()],
      );
      await this.pool.query(
        'DELETE FROM signalforge_lessons WHERE id IN (SELECT id FROM signalforge_lessons ORDER BY at DESC OFFSET 200)',
      );
    });
  }

  listLessons(limit: number): LearningLesson[] {
    return this.lessons.slice(-limit).reverse();
  }

  loadPaperAccount<T extends PaperAccount>(fallback: T): T {
    return this.paper ? (this.paper as T) : fallback;
  }

  savePaperAccount(account: PaperAccount): void {
    this.paper = account;
    this.enqueue(async () => {
      await this.pool.query(
        'INSERT INTO signalforge_state (key, payload, updated_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at',
        ['paper', JSON.stringify(account), Date.now()],
      );
    });
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }

  async close(): Promise<void> {
    await this.flush();
    await this.pool.end();
  }
}

export async function createDurableStore(fallbackConfig: BotConfig): Promise<DurableStore | null> {
  return PostgresDurableStore.create(fallbackConfig);
}
