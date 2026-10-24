// قائمة العملات المستقرة الموحدة — مصدر واحد للسيرفر والواجهة
export const STABLECOIN_SYMBOLS = [
  'USDT',
  'USDC',
  'DAI',
  'USDS',
  'FDUSD',
  'USDE',
  'PYUSD',
  'CRVUSD',
  'FRAX',
  'BUSD',
  'GUSD',
  'LUSD',
  'SUSD',
  'USDBC',
  'USD',
] as const;

export const STABLECOIN_SET = new Set<string>(STABLECOIN_SYMBOLS.map((s) => s.toUpperCase()));

export function isStablecoin(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  return STABLECOIN_SET.has(symbol.trim().toUpperCase());
}

export const STABLECOIN_SQL_IN_LIST = `(${STABLECOIN_SYMBOLS.map((s) => `'${s}'`).join(',')})`;
