// OKX symbols + bar mapping - used by marketData (funding) and oiFactor (open interest).
// OKX reachable from restricted regions (incl. SA) where Binance/Bybit are geo-blocked.
import type { SupportedAsset } from '../shared/types';

/** OKX candle bar label per internal interval key. */
export const OKX_BAR: Record<'1h' | '4h' | '1d', string> = { '1h': '1H', '4h': '4H', '1d': '1D' };

/** OKX USDT perpetual swap instrument per asset ('' when the asset has no swap). */
export const OKX_SWAP: Record<SupportedAsset, string> = {
  BTC: 'BTC-USDT-SWAP',
  ETH: 'ETH-USDT-SWAP',
  PAXG: '', // PAXG has no perpetual swap on OKX
  SOL: 'SOL-USDT-SWAP',
  XRP: 'XRP-USDT-SWAP',
  DOGE: 'DOGE-USDT-SWAP',
  ADA: 'ADA-USDT-SWAP',
};

/** PAXG has no perpetual swap on OKX - funding/OI legitimately unavailable. */
export function hasOkxSwap(asset: SupportedAsset): boolean {
  return OKX_SWAP[asset] !== '';
}
