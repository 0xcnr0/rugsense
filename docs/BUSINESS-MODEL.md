# RugSense — İş Modeli

> Amaç: düşük bütçe (~$0) ile çıkıp, çağrı başına ve abonelikle gelir. Bu bir
> "ramen-kârlı yan proje" trajektorisi — VC-ölçeği değil. Kullanıcının hedefiyle
> birebir: küçük ama gerçek, marjı ~%95+ gelir.

---

## 1. Ürün tek cümlede
Base'de yeni çıkan token'ları skorlayıp (safety + momentum → `AVOID/WATCH/HOT`)
**rug'ları eleyen** bir karar API'si. Ham veri değil, **karar** satıyoruz.

## 2. İki müşteri, iki para akışı

### A) AI ajanlar — asıl gelir (otomatik, x402)
- Başka projelerin trading/research bot'ları `/api/launches/latest`'i çağırır.
- x402 ile her çağrı USDC öder → cüzdana düşer. Biz hiçbir şey yapmayız.
- **Kaldıraç: ajanlar POLL eder.** Yeni lansman izleyen tek bir bot dakikada bir
  çağırırsa = **1.440 çağrı/gün** = tek müşteriden ciddi hacim. Yani "az sayıda
  entegre ajan" > "çok sayıda gelip geçen ziyaretçi".

### B) İnsanlar — vitrin + pro abonelik
- Free görünüm = teaser (gecikmeli, top-10, sadece tier).
- Pro = gerçek-zamanlı + tam safety dökümü + uyarı (Farcaster/Telegram).
- İnsan tarafı hem ikinci gelir hem de pazarlama (içerik = reklam).

## 3. Fiyatlandırma

| Ürün | Fiyat | Gerekçe |
|---|---|---|
| API — temel `/launches/latest` | **$0.03 / çağrı** (USDC) | Pazar normu $0.005–0.10; "karar" ham veriden değerli → orta-üst |
| API — premium (real-time / tam safety) | **$0.05–0.10 / çağrı** | Ağır sorgu, daha taze veri |
| İnsan — Free | $0 | 15 dk gecikme, top-10, sadece tier (teaser) |
| İnsan — Pro | **~$15 / ay** veya ~5 USDC/hafta | Real-time + tam safety + uyarılar |

Not: insan Pro'yu da USDC/x402 ile alabilir (KYC yok), ya da basit Stripe.

## 4. Gelir senaryoları (dürüst, aylık)

**Ajan tarafı** ($0.03/çağrı):
| Senaryo | Hacim | Aylık |
|---|---|---|
| Kötümser (yeni listelenmiş, birkaç çağrı) | ~50 çağrı/gün | **~$45** |
| Baz (birkaç aktif bot poll eder) | ~1.000 çağrı/gün | **~$900** |
| İyimser (bir ajan framework'ü entegre eder) | ~10.000 çağrı/gün | **~$9.000** |

**İnsan tarafı** (Pro $15/ay):
| Senaryo | Dönüşüm | Aylık |
|---|---|---|
| Kötümser | 2 Pro | **$30** |
| Baz | 15 Pro | **$225** |
| İyimser (bir viral Farcaster thread) | 100 Pro | **$1.500** |

**Baz birleşik ≈ $1.100/ay**, maliyet ~$0 → marj ~%95+. Bu hedefe ("düşük bütçe →
gelir") oturuyor; büyüklük değil, **gerçeklik + kendini çeviren ekonomi** önemli.

## 5. Maliyet yapısı
- Hosting (Vercel free), DexScreener (free), Base RPC (free tier) → **$0** başlangıç.
- Ölçekte tek risk: ağır poll eden ajan free-tier RPC/DexScreener limitini zorlar →
  çözüm: agresif cache (route'ta var) + kendi indexer'ımız (Faz 1.5) + free tier'a
  rate-limit. Premium fiyatlar bu maliyeti absorbe eder.

## 6. İlk 10 müşteri nereden gelir?

**Ajanlar (pasif + dağıtım):**
1. **x402 Bazaar + Agentic.Market**'e listele (data + trading kategorisi) → ajanlar
   dizinden otomatik bulur. *En düşük efor, ilk hamle.*
2. **MCP server wrapper** yayınla → MCP kullanan ajanlar bizi "tool" olarak ekler.
3. **x402 / AgentKit dev toplulukları** (Farcaster kanalları, x402 Foundation) →
   "scored Base launch feed, pay-per-call" duyurusu.
4. Mevcut **Base trading-ajan projelerine** doğrudan ulaş → feed'imizi tool olarak öner.

**İnsanlar (içerik = pazarlama):**
5. **Farcaster günlük post**: "bugünün HOT Base lansmanları + elediğimiz rug'lar".
   Ürünün çıktısı = reklam. (Frames/mini-app ile dağıtım.)
6. **Base App mini-app** (MiniKit) → consumer dağıtımı.
7. **Kanıt içeriği**: "radar şu token'ı rug olmadan önce honeypot işaretledi" →
   güven = görünür hale gelmiş moat. (Crypto Twitter/Farcaster thread.)
8. Telegram/Discord alpha grupları → free tier teaser.

**Sıralama:** önce (1) listele + (5/7) günlük içerik. İkisi de ~$0 ve kendini yayar.
Güven biriktikçe Pro dönüşümü ve ajan entegrasyonu gelir.

## 7. Neden bu savunulabilir (moat özeti)
- DexScreener = ham/insan-first, ödemeli-makine-API değil. GoPlus = sadece güvenlik.
  Boşluk: **tek x402 çağrısında skorlu KARAR.**
- Gerçek moat = **skor kalitesi + tazelik + küratörlük**. Çöp skor → tekrar alan
  olmaz; iyi skor + "rug'ı önceden yakaladık" kanıtı → güven → tekrar gelir.

## 8. Başarı eşiği (ne zaman "çalışıyor" deriz?)
- İlk ödeme (ajan veya insan) cüzdana düştüğünde → **mekanik kanıtlandı**.
- 30 günde ~$100+ tekrarlayan → hipotez doğru, ölçeklemeye değer.
- 3 ayda baz senaryo (~$1k/ay) → kendini çeviren yan ürün.
