## Deploy rehberi (hızlı)

Bu proje Socket.IO (WebSocket) kullanır. Vercel/Netlify gibi “serverless” ortamlarda WebSocket bazen sorun çıkarır.
Railway / Render / VPS (Docker) en rahat.

### 1) Railway (en kolay)

1) Projeyi GitHub’a at (private olabilir).
2) Railway → New Project → Deploy from GitHub Repo
3) Deploy olur. Settings → Variables:
   - NODE_ENV=production (opsiyonel)
4) Railway sana bir URL verir: `https://....up.railway.app`

Host panel: `https://URL/host.html`  
İzleyici: `https://URL/?room=XXXXXX`

Not: “rooms” RAM’de tutuluyor. Railway/Render yeniden başlatırsa odalar sıfırlanır.

### 2) Render

1) GitHub’a push et
2) Render → New → Web Service → repo’yu seç
3) Build Command: `npm ci`
4) Start Command: `node server.js`
5) Deploy.

### 3) VPS (Docker ile)

Sunucuda Docker kuruluysa:

```bash
git clone <repo>
cd eren-bingo
docker build -t eren-bingo .
docker run -d --restart=always -p 3000:3000 --name eren-bingo eren-bingo
```

Nginx + HTTPS için reverse proxy önerilir.


## Yeni: Topluluk doğrulama + timeout + ses

- İzleyici, **kapalı** kutuya da tıklayabilir → bu bir “doğrulama oyu” olur.
- Belirli bir pencerede (varsayılan 6sn) yeterince kişi aynı kutuya tıklarsa kutu **otomatik açılır** ve oylayanların kartında **işaretlenmiş sayılır**.
- Eğer 10sn içinde yeterli yoğunluk gelmezse, o seçimi yapan kişi **10sn timeout** yer (hiçbir kutuya basamaz).
- Bir kutu açıldığında (yoğunlukla veya host ile), izleyicilerin dikkatini çekmek için **kısa bir bip** çalar.
  - Ses tarayıcı gereği ilk tıklamadan sonra çalışır.
  - İzleyici `M` tuşuyla sesi aç/kapat yapabilir.

Parametreler `server.js` içinde: ACTIVE_WINDOW_MS, VOTE_WINDOW_MS, VOTE_FAIL_MS, COOLDOWN_MS, MIN_VOTES, MAX_VOTES.
