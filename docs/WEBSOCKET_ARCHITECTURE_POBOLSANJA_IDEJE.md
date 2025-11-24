FAZA 5 → ŠTA DODATI I POBOLJŠATI NA WEBSOCKETU

(SAMO kratke precizne ideje – pametne, realne, odmah primenljive)

✅ 1. DODATI “symbol activity heartbeat”

U Fazi 5 (Regime Engine) imaš puno stanja koja zavise od toga da li simbol zaista živi.

Ali WebSocket ne garantuje da svi simboli šalju update.

Dodaj ovo u OrderbookManager:

lastTickAt[symbol] = now();

I Faza 5 treba da koristi:

if (now() - lastTickAt > 5000ms):
regime = "STALE"
block trading

Zašto?
Jer Bybit ponekad NE šalje poruke za mrtve simbole → scoring dobija “zamrznute” podatke.

→ Ovo sprečava loše ulaze.

✅ 2. DODATI “micro-lag detector” ZA WS

Ovo je najvažnije poboljšanje koje utiče na Regime Engine.

U Main WebSocket-u:

let lastMessageLatency = 0;
ws.on("message", () => lastMessageLatency = Date.now() - msg.ts);

U Faza 5 pipeline:

if lastMessageLatency > 200ms:
globalRegime = GLOBAL_RISK_OFF

Zašto?
Ako WS kasni samo 200–300ms, pump detekcija i spoof detekcija postaju netačne.

✅ 3. DODATI “orderbook freshness score”

RegimeEngine može koristiti:

freshnessScore = now() - orderbook.lastUpdateAt

Ako > 1500ms → odmah:

regime = COOLDOWN
no new entries

Zašto?
Pumpovi i flash-dumps traju < 500ms.
Zastareo orderbook = slep bot.

✅ 4. DODATI “WS channel imbalance detector”

Ovo je mala ali moćna ideja:

Uporedi:

broj trade poruka

broj orderbook poruka

Ako:

tradesPerSecond < expected AND orderbookPerSecond < expected

→ WebSocket gubi poruke → prebaci globalRegime u RISK_OFF.

Ako samo jedan kanal kasni → označi simbol kao STALE.

Zašto je važno?
Jer Bybit često pošalje orderbook ali ne pošalje trade.

Ili obrnuto.
Regime Engine treba da zna ovo, jer u pumpu TRADE feed kasni, ali orderbook ode u nebesa.

✅ 5. DODATI “event queue length check” u FeatureEngine

Dodaj:

if (wsQueueLength > 2000) {
globalRegime = GLOBAL_RISK_OFF;
}

Ti već imaš eventEmitter, samo treba dodati counter.

Zašto?
Ako queue raste → scoring kasni → opasno.

✅ 6. DODATI “context flag” na svaki WebSocket event

U Fazi 5, pump/spoof detection treba da zna poreklo i frequenciju WS eventa.

Dodaj mali upgrade:

symbolState[symbol].ws.lastSource = "orderbook" | "trade" | "ticker";
symbolState[symbol].ws.lastEventAt = timestamp;

Znaš zašto?

✨ Regime Engine identifikuje pump-ove po tome da li je trade feed brži od orderbook feed-a.

Kad obrnuto — to je spoofing.

✅ 7. DODATI “per-symbol WS health”

Za svaki simbol trebaš da znaš:

lastOrderbookDeltaAt
lastTradeAt
lastTickerAt
avgOrderbookFrequency
avgTradeFrequency

Faza 5 koristi ovo:

Ako trade frequency padne 50% → to je znak manipulacije.

To je najvažniji indikator pump/dump pattern-a.

✅ 8. DODATI hard filter za “spike storms”

Kad Bybit šalje 30 GB/s podataka u pumpu, WS ponekad izbaci 5–20 poruka BACK TO BACK.

To se zove “bus storm”.

Dodaš:

if messageRate > 3000 msg/s for 3 seconds:
globalRegime = RISK_OFF
block all new entries

Zašto?
Jer se scoring pregreje i kašnjenja postaju previsoka.

🔥 BONUS (najbitnije poboljšanje)
🧨 FeatureEngine NE SME da radi striktno svakih 500ms

Umesto toga → mora da reaguje na event burst brzinu.

Dodaj:

let lastProcessAt = 0;

function onWsEvent() {
if (now - lastProcessAt > dynamicInterval) {
processFeatures();
lastProcessAt = now;
}
}

dynamicInterval =

50ms kad je promet normalan
100–200ms kad je promet visok
300+ms kad WS overload

✨ Ovo rešava 99% problema Faze 5 koji su vezani za WS.

🏆 ZAKLJUČAK

Ovo su tačno one stvari koje treba da poboljšaš u WS ARHITEKTURI da bi FAZA 5 radila savršeno:

✔ STALE SYMBOL DETECTION
✔ WS LATENCY → GLOBAL RISK OFF
✔ ORDERBOOK FRESHNESS → COOLDOWN
✔ TRADE/ORDERBOOK CHANNEL IMBALANCE
✔ EVENT QUEUE LENGTH PROTECTION
✔ PER-SYMBOL WS HEALTH METRICS
✔ SPIKE-STORM DETEKTOR
✔ DYNAMIC FEATURE UPDATE INTERVAL

Ako implementiraš SAMO OVO, FAZA 5 će biti 10/10.
