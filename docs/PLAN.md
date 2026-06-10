# Plan: "RugSense" — AI ajanlara + insanlara USDC ile satılan yeni-lansman istihbarat feed'i (x402)

## Context (Neden bu proje, neden bu niş?)

Kullanıcı, ayrı sekmede bir NFT koleksiyonu geliştirirken; **NFT'den bağımsız**, ağır-DeFi olmayan, **düşük bütçeyle çıkıp gelir getiren** ikinci bir Base projesi arıyor. Base'in 2026 söylemleri araştırıldı (Jesse Pollak + Base/Coinbase resmi yayınları). İki büyük tez: **consumer adoption** ve **agentic economy** (AI ajanların USDC ile otonom ödemesi — x402). Belirleyici sinyal: ajan ekonomisinde devasa **arz/talep boşluğu** ve x402 Bazaar/Agentic.Market'in dağıtımı çözmesi → bir **x402-monetize servis** "düşük bütçe → doğrudan gelir" kriterine en iyi oturan konsept.

Niş seçimi, iki dürüst eleme adımından geçti:
1. **Genel token güvenlik/risk API** elendi — bu nişi **GoPlus** (x402 tabanlı AI Agent Security API, 40+ zincir, 30M+ çağrı, GPS token) + Token Sniffer/DEXTools/ChainAware dolduruyor. Solo geliştirici burada "daha kötü kopya" olur.
2. Kalan mantıklı yön: **devlerin zayıf olduğu alan** = genişlik değil **derinlik**, otomasyon değil **küratörlük/tazelik**, çok-zincir değil **Base-özgü**.

Bu çerçevede seçilen ürün: **RugSense** — Base'de yeni çıkan token / mini-app / kontrat / NFT lansmanlarını near-real-time tespit edip metadata + kalite/risk skoruyla zenginleştiren ve **çağrı başına USDC** ile satan bir istihbarat feed'i. Önemli: bu bir **launchpad değil** (üretim aracı değil); launchpad'lerden çıkan her şeyi izleyen **istihbarat katmanı** — yani mevcut NFT/token launchpad'leri rakip değil, **veri kaynağı/müşteri**.

**Neden sağlam:** (a) hem **AI ajanlar** (research/trading) hem **insanlar** (degen/dev/dashboard) öder → gelir erken ajan talebine mahkûm değil; (b) değişken maliyet ~$0 (veri public blockchain'den, LLM yok); (c) Base'in "trading-first / yeni varlık dağıtımı" tezine birebir oturur; (d) farklılaşma = skor kalitesi + tazelik, bu da küratörlük gerektirir → devlerin breadth modeliyle taklit etmesi zor.

---

## ⚠️ Faz 0 keskinleştirmesi: "ham feed" DEĞİL, ajan-native skorlu KARAR API'si

Faz 0 araştırması kritik bir gerçek ortaya çıkardı: **insan tarafında ham "yeni lansman feed"i zaten çözülmüş** — DexScreener "New Pairs" ücretsiz, <1 dk gecikme, Base dahil 100+ zincir (Clanker/Zora hepsi oraya akıyor). Buna "bir feed daha" olarak girilmez.

Gerçek boşluk: ne **DexScreener** (insan-UI, x402-ödemeli değil) ne **GoPlus** (sadece güvenlik), bir ajanın **tek çağrıda alıp doğrudan karar verebileceği** birleşik skoru sunmuyor. Ürünü buna göre konumla:

> Her yeni Base lansmanı için **tek x402 çağrısında**: birleşik **fırsat/risk skoru + yapısal gerekçe + AVOID/WATCH/HOT kararı** — makine-ödemeli, ajanın `if score > X then act` diyebileceği biçimde. (DexScreener=ham/insan-first, GoPlus=yalnız güvenlik arasındaki boşluk.)

**MVP maliyet kırıcı:** Kendi indexer'ını kurmadan önce **DexScreener ücretsiz API'sini** ham kaynak alıp üstüne skor + onchain zenginleştirme koy → Faz 1 çok daha hızlı/ucuz başlar. Indexer'ı sonra (tazelik/bağımsızlık için) ekle.

**Listeleme:** Agentic.Market kategorileri = reasoning/**data**/media/search/social/infrastructure/**trading** → bizimki **data+trading**. (480K+ işlem yapan ajan.)

### Skor rubriği (deterministik, LLM yok)
Çıktı/launch = `{address, type, age_min, safety_score, momentum_score, composite, flags[], tier}`:
- **Safety (tuzak mı?):** honeypot/sell-tax bayrağı, mint/blacklist/owner-privilege, LP locked/burned, top-10 holder yoğunluğu, deployer geçmişi (önceki rug?).
- **Momentum (ilginç mi?):** likidite derinliği, erken tx/hacim hızı, unique buyer artışı, Farcaster sosyal varlık, kaynak itibarı (Clanker/Zora/bilinen deployer).
- **Tier:** composite + safety eşiğine göre `AVOID / WATCH / HOT` — ajanın doğrudan kullandığı aksiyon biti.

## En basit haliyle: ürün nedir, nasıl çalışır?

İnternete bir **"otomat"** koyuyorsun. İçinde değerli bilgi var: *"Base'de şu an ne yeni çıktı, hangisi kaliteli/riskli, kim erken giriyor."*

1. Bir URL: `radar.../launches/latest` → cevap: son çıkan token/mini-app/NFT'ler + her birinin kalite skoru, likidite, holder, deployer geçmişi, sosyal sinyal.
2. Normal API'de üyelik/API-key/kredi kartı gerekir. **x402 bunu kaldırır:** çağıran "önce 1 sent USDC öde" yanıtı (`402`) alır, cüzdanı **otomatik** öder, sonra veri döner. Para anında senin cüzdanına düşer.
3. **AI ajan neden alır?** Bir trading/research ajanı form dolduramaz, kart giremez — ama USDC'yi otomatik ödeyebilir. x402, ajanın senden veri **alabilmesinin tek yolu.** **İnsan neden alır?** Erken alpha (yeni-çıkan radarı) degen/dev için doğrudan değer.

**Bizim işimiz** = (a) yeni lansmanları izleyen bir arka-plan indexer, (b) her birine ucuz/deterministik bir kalite skoru, (c) URL'e koyup x402 ile "önce öde" katmanı. Hepsi bu.

## Nasıl yayılır? (kendi kendine mi?)

**Kısmen otomatik, kısmen içerik pazarlaması:**
- **Ajan tarafı (otomatik):** servisi **x402 Bazaar / Agentic.Market**'e listelersin. "Kendini geliştiren" ajanlar bu dizini tarar, ihtiyacı olan servisi bulur, fiyat karşılaştırır, uygunsa çağırır. Soğuk pazarlama yok — ajanlar seni dizinden bulur. (Ama: bulunmak ≠ satılmak; ajan ancak veriye ihtiyacı varsa ve seninki iyiyse öder.)
- **İnsan tarafı (içerik = pazarlama):** feed'in kendisi paylaşılabilir içerik. İnce bir **Farcaster mini-app** (MiniKit) + günlük "bugün Base'de çıkanlar" paylaşımı → radarın çıktısı doğrudan tanıtımdır. İnsanlar mini-app içinden de ödeyip premium sorgu çalıştırır.

---

## Faz 0 — Strateji & Validasyon (kod yazmadan, ~1-2 gün)

1. **Rakip taraması:** [Agentic.Market](https://www.coinbase.com/developer-platform) + [x402 Bazaar](https://docs.cdp.coinbase.com/x402/bazaar)'da "new launches / discovery / alpha feed" tipi servis var mı, fiyatları ne. Boş slot doğrula.
2. **Skoru tanımla:** "kalite/risk skoru" hangi sinyallerden oluşacak (likidite, holder dağılımı, deployer geçmişi, kontrat bayrakları, Farcaster sosyal varlık, yaş). **LLM yok** — deterministik heuristik (marjı korur). Skor = ürünün moat'ı; çöp skor → tekrar alan olmaz.
3. **Veri hattı fizibilitesi:** yeni lansmanları free-tier ile yakalayabiliyor muyuz? (DEX factory event'leri Aerodrome/Uniswap, yeni kontrat deploy, NFT factory, mini-app kayıtları.)
4. **Fiyat:** sorgu başı $0.01–0.05 (pazar normu, Bazaar referans); real-time/zengin sorgu premium.
5. **Marj:** veri kaynağı free-tier RPC/indexer'da kalıyor mu; çağrı başı maliyet < fiyatın %20'si mi.

**Çıkış kriteri:** "Hangi feed'i, kime, kaça, hangi skorla satıyorum ve marjım pozitif" net olunca koda geç.

---

## Faz 1 — Teknik MVP

### Stack (hepsi ücretsiz / çok-düşük maliyet)
- **Indexer (arka plan):** cron/scheduled worker → Base loglarını ilgili factory/deploy event'leri için poll'lar; hafif DB'ye yazar (Supabase free / Cloudflare KV / SQLite). Alternatif: Goldsky/Dune free-tier indexer.
- **Veri/RPC:** Base RPC free-tier (Coinbase CDP / Alchemy / QuickNode). Sonuçlar cache'lenir (marj + hız).
- **API/hosting:** Next.js API route (Vercel free) **veya** Cloudflare Worker (zaten x402 destekli).
- **x402 entegrasyonu:** resmi `x402` middleware (`x402-next` / `x402-hono`) → endpoint'i fiyat + alıcı CDP cüzdan adresi + ağ=Base ile sarmala. **Coinbase CDP facilitator** verify+settle'ı üstlenir (kendi node'un gerekmez). Ödeme = USDC on Base.
- **Skor motoru:** saf TypeScript heuristik (likidite/holder/deployer/flags/social/yaş → 0-100). LLM yok.
- **İnsan front-end (opsiyonel ama pazarlama için değerli):** MiniKit ile minimal Farcaster mini-app → "son lansmanlar" listesi + premium sorgu. Hem dağıtım hem ikinci gelir kapısı.
- **Test alıcısı:** Coinbase **AgentKit** ile bir "buyer agent" yazıp servisi gerçek ajan gibi çağır.

### Mimari (akış)
```
[Arka plan] Cron worker → Base loglarını izle (yeni token/NFT/mini-app/kontrat)
        → metadata zenginleştir → kalite skoru hesapla → DB/cache'e yaz
[Talep]  Ajan (AgentKit/MCP) veya insan (mini-app)
        │ GET /launches/latest  (veya /launches/{address})
        ▼
   Senin endpoint → x402 middleware → 402 Payment Required (fiyat+adres+Base)
        ▼ ödeme header ile retry
   CDP facilitator: verify + settle (USDC, Base)
        ▼
   DB/cache'ten skorlu feed JSON + receipt döndür
```

### Build adımları
1. Indexer'ı yaz: tek bir lansman türüyle başla (ör. yeni ERC-20 + likidite) → DB'ye düşür.
2. Skor motorunu yaz (deterministik), birkaç gerçek örnekle kalibre et.
3. `/launches/latest` + `/launches/{address}` endpoint'lerini aç (önce ücretsiz/açık).
4. `x402` middleware ile sarmala (fiyat, CDP cüzdan, Base, facilitator).
5. **Base Sepolia (testnet)** uçtan uca test: AgentKit buyer agent → 402 → öde → skorlu yanıt + USDC settle.
6. Mainnet'e geç, küçük fiyatla canlıya al.
7. **Listele:** x402 Bazaar / Agentic.Market'e ekle (organik ajan trafiği).
8. (Opsiyonel) MiniKit mini-app front + günlük Farcaster paylaşımı (insan dağıtımı).
9. Cache + rate-limit + kötüye-kullanım koruması.
10. Genişleme: 2. lansman türü (NFT / mini-app), sonra premium real-time tier.

---

## Monetizasyon & maliyet
- **Gelir:** sorgu × fiyat (USDC, doğrudan cüzdana) — ajan + insan iki kanal. Abonelik/KYC yok.
- **Maliyet:** hosting (free $0), Base gas (~$0.0007/settle), veri (free-tier $0). Değişken maliyet ~$0 → ilk ücretli sorgudan kâr.
- **Büyüme:** tek feed tutarsa → daha çok lansman türü + premium real-time + (ileride) "agent app store" konseptine evrilme opsiyonu.

---

## Doğrulama (uçtan uca test)
1. **Testnet E2E:** Base Sepolia'da AgentKit buyer agent → `402` döndüğünü, ödemenin imzalanıp facilitator'ın settle ettiğini, skorlu feed'in döndüğünü logla.
2. **Settle teyidi:** BaseScan'de USDC transferinin alıcı cüzdana düştüğünü doğrula.
3. **Veri doğruluğu:** indexer'ın yakaladığı son N lansmanı manuel kontrol et (kaçırma/yanlış var mı), skorları gerçekle karşılaştır.
4. **Discovery teyidi:** Bazaar/Agentic.Market'te servis listeleniyor + arama/fiyat karşılaştırmada görünüyor mu.
5. **Marj teyidi:** 100 sorgu simülasyonunda gelir − (gas+veri) > 0; free-tier limit aşılmıyor mu.
6. **İnsan kanalı:** mini-app'ten bir insan ödeyip sorgu çalıştırabiliyor mu.

---

## Riskler & açık noktalar
- **Skor kalitesi = moat:** zayıf/yanıltıcı skor → tekrar alan olmaz. Faz 0'da skoru ciddiye al; gerçek örneklerle kalibre et.
- **Tazelik yarışı:** "yeni lansman" değerinin çoğu hızdadır; indexer gecikmesi düşük olmalı (free-tier poll aralığına dikkat).
- **Ajan talebi hâlâ erken:** 2026'da fiilen ödeyen ajan hacmi küçük → gelir zamanla ramp eder. İnsan kanalı (mini-app + içerik) bunu dengeler; bu yüzden çift-kanal kritik.
- **Free-tier limitleri:** ölçekte RPC/hosting ücretli plana geçer → fiyatlandırma absorbe etmeli.
- **Veri commodity riski:** ham "ne çıktı" herkesçe okunabilir; fark = skor + küratörlük + tazelik. Bu katman zayıfsa proje commoditize olur.

---

## Kaynaklar
- [Jesse Pollak 2026 — consumer adoption / Base App trading-first](https://incrypted.com/en/jesse-pollak-base-app-will-focus-on-trading-and-onchain-assets/)
- [x402 agentic ödemeler on Base — Chainalysis](https://www.chainalysis.com/blog/x402-agentic-payments-adoption/)
- [Ajan ekonomisi fırsat/boşluk analizi (760x, eksik katmanlar) — TechFlow](https://www.techflowpost.com/en-US/article/30252)
- [x402 Bazaar (keşif katmanı) — Coinbase](https://www.coinbase.com/developer-platform/discover/launches/x402-bazaar)
- [API'lerini x402 ile monetize et — Coinbase](https://www.coinbase.com/developer-platform/discover/launches/monetize-apis-on-x402)
- [GoPlus x402 Security API — neden genel-güvenlik nişini elemeliyiz](https://www.tradingview.com/news/coinmarketcal:96e84edc4094b:0-goplus-security-ai-agent-security-api-27-march-2026/)
- [Coinbase AgentKit (ajana cüzdan / test alıcısı)](https://github.com/coinbase/agentkit)
- [Mini Apps / MiniKit (insan dağıtım kanalı) — Base docs](https://docs.base.org/mini-apps/overview)
- [Launch AI Agents on Base — Base docs](https://docs.base.org/cookbook/launch-ai-agents)
