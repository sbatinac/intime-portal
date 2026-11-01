# Panther TV (Android TV aplikacija)

Jednostavna aplikacija koja preko cijelog ekrana otvara In Time „Command Bridge”
(https://sbatinac.github.io/intime-portal/InTime_TV.html). Sam sadržaj se ažurira
s GitHub Pagesa — nova verzija aplikacije treba samo ako se mijenja ponašanje aplikacije.

- ikonica/banner „Panther TV” na Android TV početnom zaslonu (leanback)
- ekran ostaje upaljen, nema adresne trake
- pokušava se sama pokrenuti kad se TV upali (neki TV-i to ne dopuštaju)
- NAZAD dvaput = izlaz; tipka MENU = osvježi
- bez interneta: poruka i ponovni pokušaj svakih 30 s

Gotovi APK: `PantherTV.apk` u korijenu repozitorija.
Gradnja: aapt2 → javac (--release 11) → d8 (build-tools 35) → zipalign → apksigner.
Ključ za potpis NIJE u repozitoriju (čuva ga Saša); s drugim ključem nova verzija se instalira tek nakon deinstalacije stare.
