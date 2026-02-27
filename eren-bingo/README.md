# Eren Aktan – Canlı Yayın Bingosu (Online)

Bu proje, yayında anlık oynanabilen bir bingo web uygulaması:
- Oturum şifresi (izleyici girişi)
- Host şifresi (yayıncı paneli)
- Yayıncı kutuları **açar** (doğrular)
- İzleyici sadece **açılan** kutuları işaretleyebilir (önceden full işaretleyip “bingo yaptım” hilesi biter)
- Bingo iddiası “bekleyen”e düşer, **yayıncı onaylarsa** ilk kazanan seçilir ve oyun biter

## Kurulum

1) Node.js 18+ kurulu olsun  
2) Klasöre gir:
```bash
cd eren-bingo
npm install
npm start
```

Tarayıcıda:
- İzleyici: http://localhost:3000/?room=KOD
- Host:     http://localhost:3000/host.html

## Yayında kullanma (internete açma)

En kolay yol:
- Bir VPS / Render / Railway gibi yere deploy et
- Host linki sende kalsın, izleyiciye sadece `/?room=XXXX` linkini ver
- HTTPS kullanırsan daha stabil olur

> Bu sürüm “stream oyunu” için pratik ve hafif; kurumsal güvenlik amaçlı değil.
