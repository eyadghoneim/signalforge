# 🧭 بحث المستودعات مفتوحة المصدر (SignalForge Roadmap Reference)

> الهدف: توثيق كل مستودع عالي النجوم رُوجِعَ ضمن خطة تطوير SignalForge.
> نُسجّل لكل واحد: عدد النجوم، اللغة، الترخيص، وماذا أخذنا منه (أو لماذا رفضناه).
> **آخر تحديث:** 2026-09-18 — مرجع مستقبلي ، ليس إلزاماً لأي تطوير قادم.

---

## ✅ ما أخذناه بالفعل (مدمج في الكود)

| المستودع | ⭐ النجوم | اللغة | الترخيص | ماذا أخذنا |
|---|---|---|---|---|
| [ccxt/ccxt](https://github.com/ccxt/ccxt) | ~43.7k | TS/JS/Python/C#/… | MIT | **شبكة أمان بيانات** — آخر مصدر بيانات عند فشل المزودين المباشرين. عبر `server/ccxtProvider.ts` بترتيب `kucoin → gate → mexc → okx → binance → htx → bitget`. |
| [freqtrade/freqtrade](https://github.com/freqtrade/freqtrade) | ~50k | Python | GPL-3.0 | **أفكار فقط** (ممنوع نسخ الكود لتعارض الترخيص): staged trailing stop بعد TP2 + حماية rate limiter برؤوس `X-RateLimit-*` و`Retry-After`. |
| [TradingView/lightweight-charts](https://github.com/tradingview/lightweight-charts) | ~17.3k | TS | Apache-2.0 | مخطط الشموع في الواجهة (مستخدم منذ البداية). |
| [anandanand84/technicalindicators](https://github.com/anandanand84/technicalindicators) | ~2.5k | TS | MIT | **فكرة كشف أنماط الشموع** — نُفِّذت بكتابة مستقلة في `server/candlePatterns.ts` (Hammer، Engulfing، Morning/Evening Star، Doji) كعامل `PATTERN`. |
| [bennycode/trading-signals](https://github.com/bennycode/trading-signals) | ~990 | TS | MIT | مرجع تدقيق/تحقق من دقة مؤشراتنا (عبور قيم RSI/MACD/ATR من مكتبتنا). |

---

## 🔍 رُوجِعت ولم ندمجها (مع السبب)

| المستودع | ⭐ النجوم | السبب |
|---|---|---|
| [wilsonfreitas/awesome-quant](https://github.com/wilsonfreitas/awesome-quant) | ~29.4k | كنز معلوماتي فقط (قائمة مكتبات) — وثّقناها هنا كمرجع، لا تُدمج ككود. |
| [jesse-ai/jesse](https://github.com/jesse-ai/jesse) | ~8.3k | إطار باك تيست Python شبه متكامل — لدينا باك تيست حتمي بأحدث، ولا نتعدّد لغات لغير داعٍ. |
| [CryptoSignal/Crypto-Signal](https://github.com/CryptoSignal/Crypto-Signal) | ~5.6k | إشعارات Telegram وتنبيهات — طبقة Telegram لدينا أقوى (ثنائية اللغة + محفظة ورقية). |
| [hummingbot/hummingbot](https://github.com/hummingbot/hummingbot) | ~15.9k | صانع سوق للتنفيذ الحقيقي — **ممنوع** (قرارنا: لا تداول بأموال حقيقية، اكتشاف الأخطار هذا بالاسم). |
| [bmoscon/cryptofeed](https://github.com/bmoscon/cryptofeed) | ~2k | تغذية دفاتر أوامر منخفضة المستوى لصناع السوق — لا نحتاجه بلا تنفيذ حقيقي. |

---

## 📋 السياسات المعتمدة (تراكمت خلال البحث)

1. **التراخيص** — MIT / Apache-2.0: نستوحي الأفكار ونكتب كودنا. GPL: نأخذ المفهوم فقط (لن نوزع كوداً مشتقاً). **أبداً** لا نسخ حرفي لأي كود محمي.
2. **المحاكاة أولاً** — أي فكرة تؤخذ من الخارج تمر عبر: ورقة بحث → موافقة صريحة من صاحب المشروع → تطبيق → اختبارات → قياس لا يوقع نتائج.
3. **لا تنفيذ بأموال حقيقية** — حتى لو المستودع أقوى تنفيذ.
4. **المسار الحار مقدّس** — أي إحلال تقنية جديدة يكون آخر الاحتياطيات (ccxt مثال قائم).
5. **بيانات أولاً** — الأولوية الدائمة دقة/استمرارية البيانات عبر أقصى بورصات.

---

## 🧩 معنى الأقسام في إطار العمل

- **ccxt**: يضمن أن انهيار أي بورصة رئيسية لا يوقف المنصة (`getTicker`, `getCandles1h/4h/1d`).
- **patterns**: عامل `PATTERN` يضيف الطابع الياباني لأنماط الانعكاس كمستقبل تأكيد، ويكشف التعارض فيلغى بأمانة.
- **freqtrade-methodology**: وقف متحرك درجي + بوابة سحق التمويل تحمي رأس المال.
