/* ============================================================
   IN TIME — Backend za "Prodajni upitnik" (InTime_PismoNamjere.html)

   Po uzoru na HSC Škole sustav, ALI bez Formspree — umjesto toga
   Saša dobiva obavijest izravno na email preko MailApp-a.

   Kad korisnik pošalje veliki prodajni upitnik (45 pitanja), dešava se:
   1. Podaci se spremaju u Google Sheet "InTime_Upiti" (evidencija) —
      jedan red po upitu, sve u istim kolonama.
   2. Saša dobije email obavijest s cijelim upitnikom, sortiranim po
      sekcijama.
   3. Ako je korisnik zainteresiran (ne odbijenica) — dobije i on/ona
      lijepo dizajniranu HTML potvrdu na svoj email, sa sažetkom
      onoga što je poslao/la.

   ------------------------------------------------------------
   POSTAVLJANJE (prvi put):
   1. script.google.com → New project → zalijepiti ovaj kod
   2. Dolje u konfiguraciji promijeniti NOTIFY_EMAIL na svoj email
   3. Pokrenuti funkciju testMail() jednom ručno (Run → testMail)
      — Google će tražiti autorizaciju, odobriti je
   4. Deploy → New deployment → Web app
      - Execute as: Me
      - Who has access: Anyone
      → Deploy → kopirati URL (.../exec)
   5. Taj URL zalijepiti u InTime_PismoNamjere.html na mjesto
      GAS_WEB_APP_URL (na dnu HTML-a, u <script> dijelu)

   Kasnije kod izmjena koda: Deploy → Manage deployments → ✏️ →
   Version: New version → Deploy (URL ostaje isti).
   ============================================================ */

// ---- KONFIGURACIJA ----
var NOTIFY_EMAIL = 'sbatinac.intime@gmail.com';   // kamo stižu obavijesti o novim upitima — ISTI račun pod kojim je cijeli Web App deployan i šalje mailove (vidi napomenu o računu na vrhu datoteke), na korisnikov izričit zahtjev da se sve sam sebi skuplja na jednom mjestu (ranije: sasa.batinac@in-time.hr)
var SHEET_NAME = 'InTime_Upiti';

// Admin kao kontrolni centar — Drive "root" folder (Faza 1, 19.9.2026., vidi
// claude/admin-kontrolni-centar-plan.md u Projectu za cijeli plan). Saša je
// ovaj folder sam napravio na svom Driveu i dao nam njegov ID — budući da
// Web App izvršava "kao Saša" (vidi napomenu o Deploy postavkama gore),
// skripta ima puni pristup bez ikakvog dodatnog dijeljenja. Svi poddirektoriji
// kontrolnog centra (POTENCIJALNI KLIJENTI, PONUDE, KLIJENTI, OSNOVNA
// DOKUMENTACIJA, IMENIK) žive unutar njega — vidi getSustavSubfolders_().
var SUSTAV_ROOT_FOLDER_ID = '1quxNuz5ePh20jmgjXlNI6S62KZL-hGT6';

// Header-slika za mailove koje klijent I Saša dobivaju: (1) kad klijent
// popuni podatke o firmi (prodajni upitnik — potvrda klijentu i obavijest
// Saši), i (2) kad klijent popuni anketu/ocijeni zadovoljstvo suradnjom
// (potvrda klijentu i obavijest Saši) — korisnikov zahtjev. Trenutno ISTA
// slika za sve slučajeve; korisnik je najavio da će naknadno dostaviti
// drugu sliku za NEGATIVAN ishod ankete (nizak prosjek ocjena) — kad ta
// slika stigne, u buildAnketaConfirmationEmail/buildAnketaAdminNotificationEmail
// dodati grananje po `prosjek` (vidi izracunajProsjekOcjenaAnkete_) i drugu
// konstantu, npr. EMAIL_HEADER_IMG_NEGATIVNO.
var EMAIL_HEADER_IMG = 'https://i.imgur.com/XVKObib.png';

// Zasebna header-slika SAMO za potvrdu klijentu kod odbijenice (kad tvrtka
// na glavnom upitniku odabere da NIJE zainteresirana za suradnju) — vidi
// buildOdbijenicaConfirmationEmail() niže.
var EMAIL_HEADER_IMG_ODBIJENICA = 'https://i.imgur.com/N3x4wQS.png';

// Dinamičke Drive galerije na glavnoj stranici (InTime_PismoNamjere.html)
// — PDF dokumenti, slike i video, svaka iz svog Google Drive foldera (isti
// Google račun pod kojim je cijeli Web App deployan). Naziv datoteke na
// Driveu = naziv koji se prikazuje na stranici (ekstenzija se automatski
// uklanja); preporučen brojčani prefiks u nazivu ("01 - Naziv.pdf") za
// kontrolu redoslijeda jer Drive ne garantira poredak (lista se sortira
// abecedno). VAŽNO — folder I svaka datoteka unutra moraju imati dijeljenje
// "Bilo tko s poveznicom — Preglednik" (Anyone with the link — Viewer),
// inače se neće moći prikazati posjetiteljima stranice (Apps Script čita
// popis privatno, ali sam <iframe>/thumbnail preview učitava se izravno iz
// Google Drive u tuđem pregledniku, pa taj dio MORA biti javno gledljiv).
// Dok je ID prazan, pripadajuća sekcija ostaje sakrivena na stranici.
var PDF_GALERIJA_FOLDER_ID = '10HbOTgjLX_TNFPc3L7503sq1L9CpBoZg';
var SLIKE_GALERIJA_FOLDER_ID = '18O9W8ALTp9EjMSCM3Wu6gd3pNJcABYKP';
var VIDEO_GALERIJA_FOLDER_ID = '11XpqmcsEjitQUr6iY0vnJM5vsfxRIZEi';

// FAQ ("Česta pitanja") — zaseban Google Sheet "InTime_FAQ", uređuje se iz
// InTime_Admin.html (tab "Česta pitanja") i javno se prikazuje na
// InTime_PismoNamjere.html odmah nakon sekcije "In Time prednosti".
// Prilozi (slika/video/PDF) uz odgovor NISU vezani na ručno dijeljen Drive
// folder kao galerije gore — Saša ih izravno prilaže kroz admin sučelje
// (upload), a kod ih sam sprema u poseban Drive folder ("InTime_FAQ_Mediji",
// automatski se stvara pri prvom uploadu, vidi getOrCreateFaqMediaFolder_())
// i EKSPLICITNO postavlja dijeljenje "Bilo tko s poveznicom" na SVAKU
// pojedinu datoteku (ne oslanja se na nasljeđivanje dijeljenja od foldera —
// Drive to ne garantira za datoteke stvorene skriptom), inače se ne bi
// prikazale gostima na javnoj stranici.
var FAQ_SHEET_NAME = 'InTime_FAQ';

// Zaseban Google Sheet za "Zone dostave" (popis grad/poštanski broj/zona,
// ~6700 redaka) — vidi opširnu napomenu uz getOrCreateZoneSheet() niže.
// Namjerno odvojen od FAQ_SHEET_NAME jer je riječ o strukturiranim
// podacima za pretragu, ne o ručno pisanim pitanjima/odgovorima.
var ZONE_SHEET_NAME = 'InTime_Zone';

// Arhiva Zone Excel uploada — svaki upload (i svaki restore iz arhive) sprema
// kopiju originalne .xlsx datoteke u ovaj Drive folder i upisuje redak u
// InTime_Zone_Arhiva_Log tablicu (Datum, NazivDatoteke, BrojGradova,
// DriveFileId) — vidi arhivirajZoneDatoteku_() niže. Ništa se nikad ne
// briše iz arhive automatski.
var ZONE_ARHIVA_FOLDER_NAME = 'InTime_Zone_Arhiva';
var ZONE_ARHIVA_SHEET_NAME = 'InTime_Zone_Arhiva_Log';

// Placeholder — zamijeniti pravim URL-om nakon što InTime_Ispravak.html bude
// hostan (npr. GitHub Pages, Google Sites i sl.). Koristi se ISKLJUČIVO za
// sastavljanje poveznice za "naknadni ispravak podataka" u mailu klijentu
// (vidi buildUpitConfirmationEmail/saveUpit niže) — ne utječe na ništa drugo
// dok ostane placeholder (mail će samo sadržavati neispravnu poveznicu).
var ISPRAVAK_STRANICA_URL = 'https://sbatinac.github.io/intime-portal/InTime_Ispravak.html';

// Isti princip kao ISPRAVAK_STRANICA_URL iznad, samo za NOVU stranicu
// InTime_PotvrdaPonude.html (Sašin izričit zahtjev, 20.9.2026.: klikabilna
// poveznica u mail predlošku ponude, kojom klijent OIB-om + imenom/funkcijom
// potvrđuje prihvaćanje ponude bez potrebe čekanja povratnog maila — vidi
// opširnu napomenu uz "POTVRDA PONUDE" blok funkcija niže). Placeholder dok
// stranica ne bude hostana na istom mjestu kao InTime_Ispravak.html —
// nakon hostanja zamijeniti stvarnim URL-om OVDJE i u InTime_Admin.html
// (POTVRDA_PONUDE_STRANICA_URL, koristi se za renderMailTekst_/{{LINK_POTVRDE}}).
var POTVRDA_PONUDE_STRANICA_URL = 'https://sbatinac.github.io/intime-portal/InTime_PotvrdaPonude.html';

/* ---- OB TABLICA ("popuni kasnije, pošalji mailom") — VAŽNA NAPOMENA O RAČUNU ----
   Cijeli ovaj Apps Script projekt MORA biti otvoren/deployan pod Google
   računom sbatinac.intime@gmail.com — GmailApp/MailApp unutar Apps Scripta
   uvijek djeluju isključivo pod računom koji je vlasnik deploymenta, pa
   samo tako mailovi s Excel predlošcima idu S tog računa i odgovori se
   čitaju NA tom računu. NOTIFY_EMAIL (sasa.batinac@in-time.hr) ostaje
   ispravan kao adresat za poslovne obavijesti (npr. "netko je popunio
   obrazac") NEOVISNO o tome koji račun posjeduje deployment — to je samo
   "to:" adresa, ne račun koji šalje/prima. Podaci iz OB tablica NE smiju
   ići preko sasa.batinac@in-time.hr, samo preko sbatinac.intime@gmail.com.

   Prije prvog ručnog pokretanja postaviTrigerZaOBTablice() potrebno je u
   Apps Script editoru omogućiti napredni Google servis "Drive API"
   (Services → + → Drive API) — koristi se za pretvorbu primljenog .xlsx
   priloga u Google Sheet radi čitanja podataka (SpreadsheetApp ne može
   izravno otvoriti .xlsx datoteku). ---- */
var OB_TABLICA_MAX = 10; // mora odgovarati DODATNI_OB_MAX u InTime_PismoNamjere.html
var OB_TABLICA_FIELDS = [
  ['poslovnica', 'Ime poslovnice ili organizacijske jedinice'],
  ['ime', 'Ime i prezime'],
  ['adresa', 'Adresa'],
  ['grad', 'Grad ili mjesto'],
  ['postanski_broj', 'Poštanski broj'],
  ['mail', 'Mail adresa'],
  ['mobitel', 'Broj mobitela'],
  ['login_email', 'Preferirana mail adresa OB računa']
];
var OB_LABEL_PROCESSED = 'ob-tablica-obradjeno';
var OB_LABEL_UNRECOGNIZED = 'ob-tablica-neprepoznato';

/* ---- DEFINICIJA POLJA UPITNIKA ----
   Svaka stavka je [ključ_iz_forme, čitljiv_naziv]. Stavke oblika
   {sec:'...'} označavaju naslov sekcije (koriste se samo za
   ispis u mailu, ne generiraju kolonu u Sheetu). Ovaj popis je
   "izvor istine" za redoslijed kolona u Sheetu i za sadržaj
   emailova — ako se u HTML-u doda/promijeni polje, ažurirati i
   ovdje. */
var UPIT_FIELDS = [
  {sec:'Podaci o unosu'},
  ['vrijeme_dolaska', 'Vrijeme dolaska na stranicu'],
  // Sašin izričit zahtjev (15.9.2026., "datum stavi točno vrijeme kad je počeo
  // popunjavati ne kad je [stigao] na web stranicu... znači datum sat,minuta,
  // sekunda početka - sat minuta sekunda završetka - ukupno trajalo"): "Vrijeme
  // dolaska na stranicu" iznad mjeri dolazak na CIJELU stranicu (ostaje
  // netaknuto), a ovo novo polje mjeri stvarni POČETAK popunjavanja OVOG
  // upitnika/odbijenice — trenutak kad korisnik prvi put otvori taj panel (vidi
  // showPanel()/VRIJEME_OTVARANJA_PANELA u InTime_PismoNamjere.html). Zajedno s
  // 'vrijeme_slanja' (završetak) i 'vrijeme_popunjavanja' (ukupno trajanje) niže,
  // admin sad ima sva tri tražena podatka eksplicitno.
  ['vrijeme_pocetka_popunjavanja', 'Vrijeme početka popunjavanja upitnika'],
  ['vrijeme_slanja', 'Vrijeme slanja upitnika'],
  ['vrijeme_popunjavanja', 'Vrijeme popunjavanja (trajanje)'],
  ['unosnik_ime', 'Ime i prezime osobe koja unosi podatke'],
  ['unosnik_telefon', 'Telefon osobe koja unosi podatke'],
  ['unosnik_email', 'Email osobe koja unosi podatke'],

  {sec:'Osnovni podaci o tvrtki'},
  ['oblik_subjekta', 'Oblik poslovnog subjekta'],
  ['oblik_subjekta_ostalo', 'Oblik subjekta – ostalo'],
  ['naziv', 'Naziv tvrtke'],
  ['broj_zaposlenika', 'Broj zaposlenika'],
  ['adresa', 'Adresa sjedišta'],
  ['postanski_broj', 'Poštanski broj'],
  ['grad', 'Mjesto'],
  ['telefon_centrale', 'Telefon centrale'],
  ['email_tvrtke', 'Glavna e-mail adresa tvrtke'],

  {sec:'Poslovni i bankovni podaci'},
  ['oib', 'OIB'],
  ['mbs', 'MBS'],
  ['email_racun', 'Email za e-račune'],
  ['iban', 'IBAN'],
  ['banka', 'Poslovna banka'],
  ['banka_ostalo', 'Poslovna banka – nije ponuđena, upisano ručno'],
  ['email_specifikacija', 'Email za specifikacije uplata otkupnina'],
  ['racunovodstvo_kontakt_ime', 'Kontakt osoba u računovodstvu – ime i prezime'],
  ['racunovodstvo_kontakt_telefon', 'Kontakt osoba u računovodstvu – telefon'],
  ['racunovodstvo_kontakt_email', 'Kontakt osoba u računovodstvu – mail'],

  {sec:'Odgovorna osoba (za ponudu)'},
  ['odgovorna_osoba', 'Ime i prezime'],
  ['odgovorna_titula', 'Titula'],
  ['odgovorna_titula_ostalo', 'Titula – ostalo'],
  ['odgovorna_funkcija', 'Funkcija'],
  ['odgovorna_funkcija_ostalo', 'Funkcija – ostalo'],
  ['odgovorna_email', 'Mail adresa odgovorne osobe'],
  ['odgovorna_telefon', 'Telefon odgovorne osobe'],

  {sec:'Kontakt osoba i komunikacija'},
  ['logisticke_sluzbe', 'Trenutne logističke službe'],
  ['logisticke_sluzbe_ostalo', 'Logističke službe – ostalo'],
  // NOVO (19.9.2026., Sašin izričit zahtjev) — pitanje se pojavljuje KLIJENTU
  // tek kad označi barem jednu logističku službu gore (reveal, vidi
  // updateLogistikaIznosVisibility() u InTime_PismoNamjere.html); obavezno je
  // dok je vidljivo (data-required-group), ali server ovdje ne provjerava
  // obaveznost (kao i za sva ostala choice-group/msdrop polja — provjera je
  // isključivo client-side, ista logika kao za sve ostale required-group
  // grupe u ovom upitniku).
  ['mjesecni_iznos_logistika', 'Približan ukupan mjesečni iznos za logističke usluge (svi partneri)'],
  // NOVO (19.9.2026., isti zahtjev kao gore) — za SVAKU logističku službu
  // koju klijent označi gore, na frontendu se automatski otvara zasebno
  // pitanje o iznosu zadnjeg mjesečnog računa TE službe (uvijek se pita za
  // "prethodni mjesec" računajući od datuma popunjavanja — izračunato JS-om
  // u InTime_PismoNamjere.html, ne sprema se ovdje kao zaseban podatak jer
  // se lako izračuna iz Timestampa ako ikad zatreba). Ovih 14 polja pokriva
  // svih 13 stvarnih službi s popisa + "Ostalo" (čiji naziv klijent sam
  // upiše u logisticke_sluzbe_ostalo) — "Nismo do sada imali potrebe za
  // uslugom dostave" NAMJERNO nema svoje polje (nema smisla pitati za
  // račun službe koju klijent ne koristi). Sva polja su OPCIONALNA (klijent
  // možda nema iznos pri ruci za svaku službu) — za razliku od
  // mjesecni_iznos_logistika iznad, koje je obavezno.
  ['racun_logistika_gls', 'Zadnji mjesečni račun – GLS'],
  ['racun_logistika_dpd', 'Zadnji mjesečni račun – DPD'],
  ['racun_logistika_overseas_express', 'Zadnji mjesečni račun – Overseas Express'],
  ['racun_logistika_hp_express', 'Zadnji mjesečni račun – HP Express (Hrvatska pošta)'],
  ['racun_logistika_gebruder_weiss', 'Zadnji mjesečni račun – Gebrüder Weiss'],
  ['racun_logistika_db_schenker', 'Zadnji mjesečni račun – DB Schenker'],
  ['racun_logistika_intereuropa', 'Zadnji mjesečni račun – Intereuropa'],
  ['racun_logistika_dhl', 'Zadnji mjesečni račun – DHL'],
  ['racun_logistika_ups', 'Zadnji mjesečni račun – UPS'],
  ['racun_logistika_cargo_partner', 'Zadnji mjesečni račun – Cargo Partner'],
  ['racun_logistika_rhenus', 'Zadnji mjesečni račun – Rhenus Logistics'],
  ['racun_logistika_tisak_paket', 'Zadnji mjesečni račun – TISAK Paket'],
  ['racun_logistika_lokalne', 'Zadnji mjesečni račun – lokalna/manje poznata dostavna služba'],
  ['racun_logistika_ostalo', 'Zadnji mjesečni račun – Ostalo (naziv službe kako je klijent upisao)'],
  ['nova_tvrtka_bez_logistike', 'Novoosnovan subjekt bez dosadašnje suradnje s logističkim službama'],
  // NOVO (19.9.2026., Sašin izričit zahtjev) — dva dodatna, OPCIONALNA
  // pitanja na kraju 7. poglavlja, uvijek vidljiva (nisu vezana za odabir
  // konkretnih logističkih službi iznad, za razliku od mjesecni_iznos_logistika/
  // racun_logistika_* polja). 9 raspona (počinje s "Do 1.000 €", BEZ
  // dodatnog "Do 500 €"/"Od 501 do 1.000 €" razdvajanja kao kod
  // mjesecni_iznos_logistika — namjerno drugačiji, širi raspon jer je ovo
  // GODIŠNJI/opći kontekst, ne fokusiran na trenutne partnere).
  ['godisnji_iznos_logistika', 'Ukupan godišnji iznos za usluge transporta i logistike'],
  ['mjesecni_iznos_za_intime', 'Mjesečni iznos za logističke usluge za koje razmatra angažiranje In Time'],
  ['kontakt', 'Kontakt osoba'],
  ['kontakt_funkcija', 'Funkcija kontakt osobe'],
  ['kontakt_funkcija_ostalo', 'Funkcija kontakt osobe – ostalo'],
  ['telefon', 'Mobitel'],
  ['kontakt_email', 'Email kontakt osobe'],
  ['viber', 'Viber'],
  ['whatsapp', 'WhatsApp'],
  ['zoom_kontakt', 'Zoom kontakt adresa'],
  ['teams_kontakt', 'Microsoft Teams kontakt adresa'],
  ['komunikacija', 'Preferirana komunikacija'],
  ['komunikacija_ostalo', 'Komunikacija – ostalo'],
  ['drugi_komunikacija_predlog', 'Preporuka drugog oblika komunikacije (Da/Ne)'],
  ['drugi_komunikacija_naziv', 'Preporučena aplikacija/program'],
  ['drugi_komunikacija_kontakt', 'Kontakt u preporučenoj aplikaciji'],

  {sec:'Mjesto prikupa pošiljaka i logistika'},
  ['logistika_osoba_ime', 'Osoba za organizaciju slanja/primanja pošiljaka – ime i prezime'],
  ['logistika_osoba_email', 'Osoba za organizaciju slanja/primanja pošiljaka – email'],
  ['logistika_osoba_telefon', 'Osoba za organizaciju slanja/primanja pošiljaka – telefon'],
  ['mjesto_prikupa_isto_kao_sjediste', 'Mjesto prikupa je adresa sjedišta (Da/Ne)'],
  ['mjesto_prikupa_potvrda', 'Potvrda da je mjesto prikupa adresa sjedišta'],
  ['mjesto_prikupa_adresa', 'Adresa mjesta prikupa pošiljaka'],
  ['mjesto_prikupa_postanski_broj', 'Poštanski broj mjesta prikupa'],
  ['mjesto_prikupa_grad', 'Mjesto prikupa pošiljaka'],
  ['online_booking_email', 'Preferirana e-mail adresa za prijavu u Online Booking (OB)'],
  ['potreba_dodatni_ob_racuni', 'Potreba za dodatnim Online Booking (OB) korisničkim računima (Da/Ne)'],
  ['dodatni_ob_nacin_unosa', 'Način unosa podataka za dodatne OB račune (Ovdje/Mail)'],
  ['dodatni_ob_tablica_mail', 'E-mail adresa za slanje Excel predloška (dodatni OB računi)'],
  ['dodatni_ob_tablica_id', 'Korelacijski ID Excel predloška (dodatni OB računi)'],
  ['dodatni_ob_poslovnica_1', 'Dodatni OB račun 1 – Ime poslovnice ili organizacijske jedinice'],
  ['dodatni_ob_ime_1', 'Dodatni OB račun 1 – Ime i prezime'],
  ['dodatni_ob_adresa_1', 'Dodatni OB račun 1 – Adresa'],
  ['dodatni_ob_grad_1', 'Dodatni OB račun 1 – Grad ili mjesto'],
  ['dodatni_ob_postanski_broj_1', 'Dodatni OB račun 1 – Poštanski broj'],
  ['dodatni_ob_mail_1', 'Dodatni OB račun 1 – Mail adresa'],
  ['dodatni_ob_mobitel_1', 'Dodatni OB račun 1 – Broj mobitela'],
  ['dodatni_ob_login_email_1', 'Dodatni OB račun 1 – Preferirana mail adresa OB računa'],
  ['dodatni_ob_poslovnica_2', 'Dodatni OB račun 2 – Ime poslovnice ili organizacijske jedinice'],
  ['dodatni_ob_ime_2', 'Dodatni OB račun 2 – Ime i prezime'],
  ['dodatni_ob_adresa_2', 'Dodatni OB račun 2 – Adresa'],
  ['dodatni_ob_grad_2', 'Dodatni OB račun 2 – Grad ili mjesto'],
  ['dodatni_ob_postanski_broj_2', 'Dodatni OB račun 2 – Poštanski broj'],
  ['dodatni_ob_mail_2', 'Dodatni OB račun 2 – Mail adresa'],
  ['dodatni_ob_mobitel_2', 'Dodatni OB račun 2 – Broj mobitela'],
  ['dodatni_ob_login_email_2', 'Dodatni OB račun 2 – Preferirana mail adresa OB računa'],
  ['dodatni_ob_poslovnica_3', 'Dodatni OB račun 3 – Ime poslovnice ili organizacijske jedinice'],
  ['dodatni_ob_ime_3', 'Dodatni OB račun 3 – Ime i prezime'],
  ['dodatni_ob_adresa_3', 'Dodatni OB račun 3 – Adresa'],
  ['dodatni_ob_grad_3', 'Dodatni OB račun 3 – Grad ili mjesto'],
  ['dodatni_ob_postanski_broj_3', 'Dodatni OB račun 3 – Poštanski broj'],
  ['dodatni_ob_mail_3', 'Dodatni OB račun 3 – Mail adresa'],
  ['dodatni_ob_mobitel_3', 'Dodatni OB račun 3 – Broj mobitela'],
  ['dodatni_ob_login_email_3', 'Dodatni OB račun 3 – Preferirana mail adresa OB računa'],
  ['dodatni_ob_poslovnica_4', 'Dodatni OB račun 4 – Ime poslovnice ili organizacijske jedinice'],
  ['dodatni_ob_ime_4', 'Dodatni OB račun 4 – Ime i prezime'],
  ['dodatni_ob_adresa_4', 'Dodatni OB račun 4 – Adresa'],
  ['dodatni_ob_grad_4', 'Dodatni OB račun 4 – Grad ili mjesto'],
  ['dodatni_ob_postanski_broj_4', 'Dodatni OB račun 4 – Poštanski broj'],
  ['dodatni_ob_mail_4', 'Dodatni OB račun 4 – Mail adresa'],
  ['dodatni_ob_mobitel_4', 'Dodatni OB račun 4 – Broj mobitela'],
  ['dodatni_ob_login_email_4', 'Dodatni OB račun 4 – Preferirana mail adresa OB računa'],
  ['dodatni_ob_poslovnica_5', 'Dodatni OB račun 5 – Ime poslovnice ili organizacijske jedinice'],
  ['dodatni_ob_ime_5', 'Dodatni OB račun 5 – Ime i prezime'],
  ['dodatni_ob_adresa_5', 'Dodatni OB račun 5 – Adresa'],
  ['dodatni_ob_grad_5', 'Dodatni OB račun 5 – Grad ili mjesto'],
  ['dodatni_ob_postanski_broj_5', 'Dodatni OB račun 5 – Poštanski broj'],
  ['dodatni_ob_mail_5', 'Dodatni OB račun 5 – Mail adresa'],
  ['dodatni_ob_mobitel_5', 'Dodatni OB račun 5 – Broj mobitela'],
  ['dodatni_ob_login_email_5', 'Dodatni OB račun 5 – Preferirana mail adresa OB računa'],
  ['dodatni_ob_poslovnica_6', 'Dodatni OB račun 6 – Ime poslovnice ili organizacijske jedinice'],
  ['dodatni_ob_ime_6', 'Dodatni OB račun 6 – Ime i prezime'],
  ['dodatni_ob_adresa_6', 'Dodatni OB račun 6 – Adresa'],
  ['dodatni_ob_grad_6', 'Dodatni OB račun 6 – Grad ili mjesto'],
  ['dodatni_ob_postanski_broj_6', 'Dodatni OB račun 6 – Poštanski broj'],
  ['dodatni_ob_mail_6', 'Dodatni OB račun 6 – Mail adresa'],
  ['dodatni_ob_mobitel_6', 'Dodatni OB račun 6 – Broj mobitela'],
  ['dodatni_ob_login_email_6', 'Dodatni OB račun 6 – Preferirana mail adresa OB računa'],
  ['dodatni_ob_poslovnica_7', 'Dodatni OB račun 7 – Ime poslovnice ili organizacijske jedinice'],
  ['dodatni_ob_ime_7', 'Dodatni OB račun 7 – Ime i prezime'],
  ['dodatni_ob_adresa_7', 'Dodatni OB račun 7 – Adresa'],
  ['dodatni_ob_grad_7', 'Dodatni OB račun 7 – Grad ili mjesto'],
  ['dodatni_ob_postanski_broj_7', 'Dodatni OB račun 7 – Poštanski broj'],
  ['dodatni_ob_mail_7', 'Dodatni OB račun 7 – Mail adresa'],
  ['dodatni_ob_mobitel_7', 'Dodatni OB račun 7 – Broj mobitela'],
  ['dodatni_ob_login_email_7', 'Dodatni OB račun 7 – Preferirana mail adresa OB računa'],
  ['dodatni_ob_poslovnica_8', 'Dodatni OB račun 8 – Ime poslovnice ili organizacijske jedinice'],
  ['dodatni_ob_ime_8', 'Dodatni OB račun 8 – Ime i prezime'],
  ['dodatni_ob_adresa_8', 'Dodatni OB račun 8 – Adresa'],
  ['dodatni_ob_grad_8', 'Dodatni OB račun 8 – Grad ili mjesto'],
  ['dodatni_ob_postanski_broj_8', 'Dodatni OB račun 8 – Poštanski broj'],
  ['dodatni_ob_mail_8', 'Dodatni OB račun 8 – Mail adresa'],
  ['dodatni_ob_mobitel_8', 'Dodatni OB račun 8 – Broj mobitela'],
  ['dodatni_ob_login_email_8', 'Dodatni OB račun 8 – Preferirana mail adresa OB računa'],
  ['dodatni_ob_poslovnica_9', 'Dodatni OB račun 9 – Ime poslovnice ili organizacijske jedinice'],
  ['dodatni_ob_ime_9', 'Dodatni OB račun 9 – Ime i prezime'],
  ['dodatni_ob_adresa_9', 'Dodatni OB račun 9 – Adresa'],
  ['dodatni_ob_grad_9', 'Dodatni OB račun 9 – Grad ili mjesto'],
  ['dodatni_ob_postanski_broj_9', 'Dodatni OB račun 9 – Poštanski broj'],
  ['dodatni_ob_mail_9', 'Dodatni OB račun 9 – Mail adresa'],
  ['dodatni_ob_mobitel_9', 'Dodatni OB račun 9 – Broj mobitela'],
  ['dodatni_ob_login_email_9', 'Dodatni OB račun 9 – Preferirana mail adresa OB računa'],
  ['dodatni_ob_poslovnica_10', 'Dodatni OB račun 10 – Ime poslovnice ili organizacijske jedinice'],
  ['dodatni_ob_ime_10', 'Dodatni OB račun 10 – Ime i prezime'],
  ['dodatni_ob_adresa_10', 'Dodatni OB račun 10 – Adresa'],
  ['dodatni_ob_grad_10', 'Dodatni OB račun 10 – Grad ili mjesto'],
  ['dodatni_ob_postanski_broj_10', 'Dodatni OB račun 10 – Poštanski broj'],
  ['dodatni_ob_mail_10', 'Dodatni OB račun 10 – Mail adresa'],
  ['dodatni_ob_mobitel_10', 'Dodatni OB račun 10 – Broj mobitela'],
  ['dodatni_ob_login_email_10', 'Dodatni OB račun 10 – Preferirana mail adresa OB računa'],
  ['vrijeme_prikupa', 'Vrijeme prikupa pošiljaka (dolazak vozila)'],

  {sec:'Svrha korištenja usluga dostave'},
  ['svrha_dostave', 'Svrha korištenja usluga dostave'],
  ['svrha_dostave_ostalo', 'Svrha korištenja usluga dostave – ostalo'],

  {sec:'Usluge koje zanimaju klijenta'},
  ['osnovne_usluge', 'Osnovne usluge'],
  ['dodatne_usluge', 'Dodatne usluge'],
  ['dodatne_usluge_ostalo', 'Dodatne usluge – ostalo'],
  ['dodatna_specifikacija', 'Dodatna usluga – specifikacija'],

  {sec:'Proizvodi i pošiljke'},
  ['sadrzaj_posiljki', 'Sadržaj pošiljki – kategorija proizvoda'],
  ['sadrzaj_posiljki_ostalo', 'Sadržaj pošiljki – ostalo'],
  ['opis_proizvoda', 'Opis proizvoda/pošiljaka'],
  ['karakteristika', 'Karakteristike pošiljaka'],
  ['karakteristika_ostalo', 'Karakteristike – ostalo'],
  ['tezina_posiljaka', 'Definicija težine pošiljaka'],
  ['tezina_ostalo', 'Težina – ostalo'],

  {sec:'Opseg pošiljaka (mjesečno)'},
  ['novi_klijent_bez_opsega', 'Novi klijent bez procjene opsega pošiljaka (Da/prazno)'],
  ['broj_usluga_domaca', 'Broj pošiljaka – Domaća distribucija'],
  ['razdoblje_usluga_domaca', 'Broj pošiljaka – Domaća distribucija – razdoblje'],
  ['kategorije_tezine_domaca', 'Najčešće težinske kategorije – Domaća distribucija'],
  ['kat_tezine_domaca_naziv_1', 'Kategorija 1 – naziv (Domaća distribucija)'],
  ['kat_tezine_domaca_broj_1', 'Kategorija 1 – broj pošiljaka (Domaća distribucija)'],
  ['kat_tezine_domaca_postotak_1', 'Kategorija 1 – postotak udjela (Domaća distribucija, automatski izračun)'],
  ['kat_tezine_domaca_naziv_2', 'Kategorija 2 – naziv (Domaća distribucija)'],
  ['kat_tezine_domaca_broj_2', 'Kategorija 2 – broj pošiljaka (Domaća distribucija)'],
  ['kat_tezine_domaca_postotak_2', 'Kategorija 2 – postotak udjela (Domaća distribucija, automatski izračun)'],
  ['kat_tezine_domaca_naziv_3', 'Kategorija 3 – naziv (Domaća distribucija)'],
  ['kat_tezine_domaca_broj_3', 'Kategorija 3 – broj pošiljaka (Domaća distribucija)'],
  ['kat_tezine_domaca_postotak_3', 'Kategorija 3 – postotak udjela (Domaća distribucija, automatski izračun)'],
  ['kat_tezine_domaca_naziv_4', 'Kategorija 4 – naziv (Domaća distribucija)'],
  ['kat_tezine_domaca_broj_4', 'Kategorija 4 – broj pošiljaka (Domaća distribucija)'],
  ['kat_tezine_domaca_postotak_4', 'Kategorija 4 – postotak udjela (Domaća distribucija, automatski izračun)'],
  ['kat_tezine_domaca_naziv_5', 'Kategorija 5 – naziv (Domaća distribucija)'],
  ['kat_tezine_domaca_broj_5', 'Kategorija 5 – broj pošiljaka (Domaća distribucija)'],
  ['kat_tezine_domaca_postotak_5', 'Kategorija 5 – postotak udjela (Domaća distribucija, automatski izračun)'],
  ['kat_tezine_domaca_naziv_6', 'Kategorija 6 – naziv (Domaća distribucija)'],
  ['kat_tezine_domaca_broj_6', 'Kategorija 6 – broj pošiljaka (Domaća distribucija)'],
  ['kat_tezine_domaca_postotak_6', 'Kategorija 6 – postotak udjela (Domaća distribucija, automatski izračun)'],
  ['kat_tezine_domaca_naziv_7', 'Kategorija 7 – naziv (Domaća distribucija)'],
  ['kat_tezine_domaca_broj_7', 'Kategorija 7 – broj pošiljaka (Domaća distribucija)'],
  ['kat_tezine_domaca_postotak_7', 'Kategorija 7 – postotak udjela (Domaća distribucija, automatski izračun)'],
  ['kat_tezine_domaca_ostalo_postotak', 'Ostali težinski razredi – postotak (Domaća distribucija, automatski izračun, razlika do 100%)'],
  ['kat_tezine_domaca_ostalo_broj', 'Ostali težinski razredi – broj neraspoređenih pošiljaka (Domaća distribucija, automatski izračun)'],

  ['broj_usluga_medjunarodna', 'Broj pošiljaka – Međunarodna distribucija'],
  ['razdoblje_usluga_medjunarodna', 'Broj pošiljaka – Međunarodna distribucija – razdoblje'],
  ['kategorije_tezine_medjunarodna', 'Najčešće težinske kategorije – Međunarodna distribucija'],
  ['kat_tezine_medjunarodna_naziv_1', 'Kategorija 1 – naziv (Međunarodna distribucija)'],
  ['kat_tezine_medjunarodna_broj_1', 'Kategorija 1 – broj pošiljaka (Međunarodna distribucija)'],
  ['kat_tezine_medjunarodna_postotak_1', 'Kategorija 1 – postotak udjela (Međunarodna distribucija, automatski izračun)'],
  ['kat_tezine_medjunarodna_naziv_2', 'Kategorija 2 – naziv (Međunarodna distribucija)'],
  ['kat_tezine_medjunarodna_broj_2', 'Kategorija 2 – broj pošiljaka (Međunarodna distribucija)'],
  ['kat_tezine_medjunarodna_postotak_2', 'Kategorija 2 – postotak udjela (Međunarodna distribucija, automatski izračun)'],
  ['kat_tezine_medjunarodna_naziv_3', 'Kategorija 3 – naziv (Međunarodna distribucija)'],
  ['kat_tezine_medjunarodna_broj_3', 'Kategorija 3 – broj pošiljaka (Međunarodna distribucija)'],
  ['kat_tezine_medjunarodna_postotak_3', 'Kategorija 3 – postotak udjela (Međunarodna distribucija, automatski izračun)'],
  ['kat_tezine_medjunarodna_naziv_4', 'Kategorija 4 – naziv (Međunarodna distribucija)'],
  ['kat_tezine_medjunarodna_broj_4', 'Kategorija 4 – broj pošiljaka (Međunarodna distribucija)'],
  ['kat_tezine_medjunarodna_postotak_4', 'Kategorija 4 – postotak udjela (Međunarodna distribucija, automatski izračun)'],
  ['kat_tezine_medjunarodna_naziv_5', 'Kategorija 5 – naziv (Međunarodna distribucija)'],
  ['kat_tezine_medjunarodna_broj_5', 'Kategorija 5 – broj pošiljaka (Međunarodna distribucija)'],
  ['kat_tezine_medjunarodna_postotak_5', 'Kategorija 5 – postotak udjela (Međunarodna distribucija, automatski izračun)'],
  ['kat_tezine_medjunarodna_naziv_6', 'Kategorija 6 – naziv (Međunarodna distribucija)'],
  ['kat_tezine_medjunarodna_broj_6', 'Kategorija 6 – broj pošiljaka (Međunarodna distribucija)'],
  ['kat_tezine_medjunarodna_postotak_6', 'Kategorija 6 – postotak udjela (Međunarodna distribucija, automatski izračun)'],
  ['kat_tezine_medjunarodna_naziv_7', 'Kategorija 7 – naziv (Međunarodna distribucija)'],
  ['kat_tezine_medjunarodna_broj_7', 'Kategorija 7 – broj pošiljaka (Međunarodna distribucija)'],
  ['kat_tezine_medjunarodna_postotak_7', 'Kategorija 7 – postotak udjela (Međunarodna distribucija, automatski izračun)'],
  ['kat_tezine_medjunarodna_ostalo_postotak', 'Ostali težinski razredi – postotak (Međunarodna distribucija, automatski izračun, razlika do 100%)'],
  ['kat_tezine_medjunarodna_ostalo_broj', 'Ostali težinski razredi – broj neraspoređenih pošiljaka (Međunarodna distribucija, automatski izračun)'],
  ['zemlje_medjunarodna', 'Zemlje isporuke/prijema – Međunarodna distribucija'],
  ['udio_izvoza_medjunarodna', 'Omjer izvoz/uvoz – postotak izvoza (Međunarodna distribucija, 0-100)'],

  ['broj_usluga_fedex_express', 'Broj pošiljaka – FedEx EXPRESS'],
  ['razdoblje_usluga_fedex_express', 'Broj pošiljaka – FedEx EXPRESS – razdoblje'],
  ['kategorije_tezine_fedex_express', 'Najčešće težinske kategorije – FedEx EXPRESS'],
  ['kat_tezine_fedex_express_naziv_1', 'Kategorija 1 – naziv (FedEx EXPRESS)'],
  ['kat_tezine_fedex_express_broj_1', 'Kategorija 1 – broj pošiljaka (FedEx EXPRESS)'],
  ['kat_tezine_fedex_express_postotak_1', 'Kategorija 1 – postotak udjela (FedEx EXPRESS, automatski izračun)'],
  ['kat_tezine_fedex_express_naziv_2', 'Kategorija 2 – naziv (FedEx EXPRESS)'],
  ['kat_tezine_fedex_express_broj_2', 'Kategorija 2 – broj pošiljaka (FedEx EXPRESS)'],
  ['kat_tezine_fedex_express_postotak_2', 'Kategorija 2 – postotak udjela (FedEx EXPRESS, automatski izračun)'],
  ['kat_tezine_fedex_express_naziv_3', 'Kategorija 3 – naziv (FedEx EXPRESS)'],
  ['kat_tezine_fedex_express_broj_3', 'Kategorija 3 – broj pošiljaka (FedEx EXPRESS)'],
  ['kat_tezine_fedex_express_postotak_3', 'Kategorija 3 – postotak udjela (FedEx EXPRESS, automatski izračun)'],
  ['kat_tezine_fedex_express_naziv_4', 'Kategorija 4 – naziv (FedEx EXPRESS)'],
  ['kat_tezine_fedex_express_broj_4', 'Kategorija 4 – broj pošiljaka (FedEx EXPRESS)'],
  ['kat_tezine_fedex_express_postotak_4', 'Kategorija 4 – postotak udjela (FedEx EXPRESS, automatski izračun)'],
  ['kat_tezine_fedex_express_naziv_5', 'Kategorija 5 – naziv (FedEx EXPRESS)'],
  ['kat_tezine_fedex_express_broj_5', 'Kategorija 5 – broj pošiljaka (FedEx EXPRESS)'],
  ['kat_tezine_fedex_express_postotak_5', 'Kategorija 5 – postotak udjela (FedEx EXPRESS, automatski izračun)'],
  ['kat_tezine_fedex_express_naziv_6', 'Kategorija 6 – naziv (FedEx EXPRESS)'],
  ['kat_tezine_fedex_express_broj_6', 'Kategorija 6 – broj pošiljaka (FedEx EXPRESS)'],
  ['kat_tezine_fedex_express_postotak_6', 'Kategorija 6 – postotak udjela (FedEx EXPRESS, automatski izračun)'],
  ['kat_tezine_fedex_express_naziv_7', 'Kategorija 7 – naziv (FedEx EXPRESS)'],
  ['kat_tezine_fedex_express_broj_7', 'Kategorija 7 – broj pošiljaka (FedEx EXPRESS)'],
  ['kat_tezine_fedex_express_postotak_7', 'Kategorija 7 – postotak udjela (FedEx EXPRESS, automatski izračun)'],
  ['kat_tezine_fedex_express_ostalo_postotak', 'Ostali težinski razredi – postotak (FedEx EXPRESS, automatski izračun, razlika do 100%)'],
  ['kat_tezine_fedex_express_ostalo_broj', 'Ostali težinski razredi – broj neraspoređenih pošiljaka (FedEx EXPRESS, automatski izračun)'],
  ['zemlje_fedex_express', 'Zemlje isporuke/prijema – FedEx EXPRESS (uz naziv zemlje uključena i FedEx EXPRESS zona)'],
  ['udio_izvoza_fedex_express', 'Omjer izvoz/uvoz – postotak izvoza (FedEx EXPRESS, 0-100)'],

  ['broj_usluga_fedex_economy', 'Broj pošiljaka – FedEx ECONOMY'],
  ['razdoblje_usluga_fedex_economy', 'Broj pošiljaka – FedEx ECONOMY – razdoblje'],
  ['kategorije_tezine_fedex_economy', 'Najčešće težinske kategorije – FedEx ECONOMY'],
  ['kat_tezine_fedex_economy_naziv_1', 'Kategorija 1 – naziv (FedEx ECONOMY)'],
  ['kat_tezine_fedex_economy_broj_1', 'Kategorija 1 – broj pošiljaka (FedEx ECONOMY)'],
  ['kat_tezine_fedex_economy_postotak_1', 'Kategorija 1 – postotak udjela (FedEx ECONOMY, automatski izračun)'],
  ['kat_tezine_fedex_economy_naziv_2', 'Kategorija 2 – naziv (FedEx ECONOMY)'],
  ['kat_tezine_fedex_economy_broj_2', 'Kategorija 2 – broj pošiljaka (FedEx ECONOMY)'],
  ['kat_tezine_fedex_economy_postotak_2', 'Kategorija 2 – postotak udjela (FedEx ECONOMY, automatski izračun)'],
  ['kat_tezine_fedex_economy_naziv_3', 'Kategorija 3 – naziv (FedEx ECONOMY)'],
  ['kat_tezine_fedex_economy_broj_3', 'Kategorija 3 – broj pošiljaka (FedEx ECONOMY)'],
  ['kat_tezine_fedex_economy_postotak_3', 'Kategorija 3 – postotak udjela (FedEx ECONOMY, automatski izračun)'],
  ['kat_tezine_fedex_economy_naziv_4', 'Kategorija 4 – naziv (FedEx ECONOMY)'],
  ['kat_tezine_fedex_economy_broj_4', 'Kategorija 4 – broj pošiljaka (FedEx ECONOMY)'],
  ['kat_tezine_fedex_economy_postotak_4', 'Kategorija 4 – postotak udjela (FedEx ECONOMY, automatski izračun)'],
  ['kat_tezine_fedex_economy_naziv_5', 'Kategorija 5 – naziv (FedEx ECONOMY)'],
  ['kat_tezine_fedex_economy_broj_5', 'Kategorija 5 – broj pošiljaka (FedEx ECONOMY)'],
  ['kat_tezine_fedex_economy_postotak_5', 'Kategorija 5 – postotak udjela (FedEx ECONOMY, automatski izračun)'],
  ['kat_tezine_fedex_economy_naziv_6', 'Kategorija 6 – naziv (FedEx ECONOMY)'],
  ['kat_tezine_fedex_economy_broj_6', 'Kategorija 6 – broj pošiljaka (FedEx ECONOMY)'],
  ['kat_tezine_fedex_economy_postotak_6', 'Kategorija 6 – postotak udjela (FedEx ECONOMY, automatski izračun)'],
  ['kat_tezine_fedex_economy_naziv_7', 'Kategorija 7 – naziv (FedEx ECONOMY)'],
  ['kat_tezine_fedex_economy_broj_7', 'Kategorija 7 – broj pošiljaka (FedEx ECONOMY)'],
  ['kat_tezine_fedex_economy_postotak_7', 'Kategorija 7 – postotak udjela (FedEx ECONOMY, automatski izračun)'],
  ['kat_tezine_fedex_economy_ostalo_postotak', 'Ostali težinski razredi – postotak (FedEx ECONOMY, automatski izračun, razlika do 100%)'],
  ['kat_tezine_fedex_economy_ostalo_broj', 'Ostali težinski razredi – broj neraspoređenih pošiljaka (FedEx ECONOMY, automatski izračun)'],
  ['zemlje_fedex_economy', 'Zemlje isporuke/prijema – FedEx ECONOMY (uz naziv zemlje uključena i FedEx ECONOMY zona)'],
  ['udio_izvoza_fedex_economy', 'Omjer izvoz/uvoz – postotak izvoza (FedEx ECONOMY, 0-100)'],


  {sec:'Pakiranje i sezonalnost'},
  ['pakiranje', 'Način pakiranja'],
  ['pakiranje_ostalo', 'Pakiranje – ostalo'],
  ['sezonalnost', 'Sezonalnost prodaje'],
  ['sezonalnost_ostalo', 'Sezonalnost – ostalo'],
  ['sezonalnost_mjeseci', 'Sezonalnost – mjeseci s izraženom sezonalnošću'],
  ['standardizirane_kutije', 'Koristi standardizirane kutije/ambalažu'],
  ['kutija_duzina_1', 'Kutija 1 – dužina (cm)'],
  ['kutija_sirina_1', 'Kutija 1 – širina (cm)'],
  ['kutija_visina_1', 'Kutija 1 – visina (cm)'],
  ['kutija_duzina_2', 'Kutija 2 – dužina (cm)'],
  ['kutija_sirina_2', 'Kutija 2 – širina (cm)'],
  ['kutija_visina_2', 'Kutija 2 – visina (cm)'],
  ['kutija_duzina_3', 'Kutija 3 – dužina (cm)'],
  ['kutija_sirina_3', 'Kutija 3 – širina (cm)'],
  ['kutija_visina_3', 'Kutija 3 – visina (cm)'],
  ['kutija_duzina_4', 'Kutija 4 – dužina (cm)'],
  ['kutija_sirina_4', 'Kutija 4 – širina (cm)'],
  ['kutija_visina_4', 'Kutija 4 – visina (cm)'],
  ['kutija_duzina_5', 'Kutija 5 – dužina (cm)'],
  ['kutija_sirina_5', 'Kutija 5 – širina (cm)'],
  ['kutija_visina_5', 'Kutija 5 – visina (cm)'],
  ['kutija_duzina_6', 'Kutija 6 – dužina (cm)'],
  ['kutija_sirina_6', 'Kutija 6 – širina (cm)'],
  ['kutija_visina_6', 'Kutija 6 – visina (cm)'],
  ['kutija_duzina_7', 'Kutija 7 – dužina (cm)'],
  ['kutija_sirina_7', 'Kutija 7 – širina (cm)'],
  ['kutija_visina_7', 'Kutija 7 – visina (cm)'],
  ['kutija_duzina_8', 'Kutija 8 – dužina (cm)'],
  ['kutija_sirina_8', 'Kutija 8 – širina (cm)'],
  ['kutija_visina_8', 'Kutija 8 – visina (cm)'],
  ['kutija_duzina_9', 'Kutija 9 – dužina (cm)'],
  ['kutija_sirina_9', 'Kutija 9 – širina (cm)'],
  ['kutija_visina_9', 'Kutija 9 – visina (cm)'],
  ['kutija_duzina_10', 'Kutija 10 – dužina (cm)'],
  ['kutija_sirina_10', 'Kutija 10 – širina (cm)'],
  ['kutija_visina_10', 'Kutija 10 – visina (cm)'],
  ['crni_petak', 'Utjecaj crnog petka (0–100%)'],

  // Sašin izričit zahtjev (15.9.2026., "možemo li još u upitnik na kraju
  // postaviti jedno pitanje... potvrdite na koju mail adresu želite da Vam
  // sustav pošalje ponudu... da onda budu ponuđene sve adrese koje je unio sa
  // checkboxom i to je obavezno pitanje"): posljednje pitanje upitnika (13.
  // poglavlje u InTime_PismoNamjere.html) — checkbox popis izgrađen na
  // klijentovoj strani iz stvarno upisanih e-mail adresa (vidi
  // azurirajPonudaEmailOpcije() u InTime_PismoNamjere.html), pa se ovdje samo
  // sprema što je klijent označio (moguće više adresa, spremaju se odvojene
  // zarezom — isti obrazac kao svako drugo polje s checkboxevima, npr.
  // 'logisticke_sluzbe'). NAMJERNO izostavljeno iz POGLAVLJA_ISPRAVAK niže —
  // vrijednost je izvedena iz ostalih polja u trenutku slanja, kao i
  // vrijeme_dolaska/vrijeme_slanja/vrijeme_popunjavanja, pa se ne nudi za
  // naknadni ručni ispravak klijentu.
  {sec:'Potvrda adrese za slanje ponude'},
  ['ponuda_email_adrese', 'Potvrđena adresa/e za slanje ponude']
];

// Brzi lookup ključ→[ključ, label] iz UPIT_FIELDS (bez {sec:...} markera) —
// koristi se u ispravakSaveChanges() za pronalazak stupca po ključu polja.
var UPIT_FIELDS_BY_KEY_ = {};
UPIT_FIELDS.forEach(function(f) { if (!f.sec) { UPIT_FIELDS_BY_KEY_[f[0]] = f; } });

/* ---- MAPA POGLAVLJA ZA "ISPRAVAK PODATAKA" (klijent naknadno ispravlja) ----
   Grupira SVE ključeve polja (osim automatskih vrijeme_dolaska/vrijeme_slanja/
   vrijeme_popunjavanja, koji se ne mogu ispravljati) u istih 12 poglavlja kao
   u InTime_PismoNamjere.html (brojevi/naslovi MORAJU ostati usklađeni s HTML
   <h3> naslovima — ako se poglavlje doda/ukloni/preimenuje u formi, ovu mapu
   treba ručno ažurirati, ISTOVJETNO kao POGLAVLJA_ISPRAVAK nizu u
   InTime_Ispravak.html, koji MORA ostati identičan ovome). Ovo je AUTORITATIVNA
   (server-side) definicija koja polja klijent smije mijenjati kad Saša odobri
   pojedino poglavlje — vidi ispravakSaveChanges() niže. 'naziv' i 'oib' su
   NAMJERNO uključeni ovdje (radi prikaza), ali su EKSPLICITNO izuzeti iz
   dozvoljenih izmjena u ispravakSaveChanges() bez obzira na odobrena poglavlja
   — mijenja ih isključivo Saša, kroz admin stranicu (adminUpdateFields(), koja
   dopušta ručnu izmjenu BILO KOJEG polja upitnika, ne samo ova dva). */
var POGLAVLJA_ISPRAVAK = [
  { broj: 1, naslov: 'Podaci o unosu', polja: ['unosnik_ime', 'unosnik_telefon', 'unosnik_email'] },
  { broj: 2, naslov: 'Osnovni podaci o tvrtki', polja: ['oblik_subjekta', 'oblik_subjekta_ostalo', 'naziv', 'broj_zaposlenika', 'adresa', 'postanski_broj', 'grad', 'telefon_centrale', 'email_tvrtke'] },
  { broj: 3, naslov: 'Poslovni i bankovni podaci', polja: ['oib', 'mbs', 'email_racun', 'iban', 'banka', 'banka_ostalo', 'email_specifikacija', 'racunovodstvo_kontakt_ime', 'racunovodstvo_kontakt_telefon', 'racunovodstvo_kontakt_email'] },
  { broj: 4, naslov: 'Odgovorna osoba (za ponudu)', polja: ['odgovorna_osoba', 'odgovorna_titula', 'odgovorna_titula_ostalo', 'odgovorna_funkcija', 'odgovorna_funkcija_ostalo', 'odgovorna_email', 'odgovorna_telefon'] },
  { broj: 5, naslov: 'Kontakt osoba i preferirana komunikacija', polja: ['kontakt', 'kontakt_funkcija', 'kontakt_funkcija_ostalo', 'telefon', 'kontakt_email', 'viber', 'whatsapp', 'zoom_kontakt', 'teams_kontakt', 'komunikacija', 'komunikacija_ostalo', 'drugi_komunikacija_predlog', 'drugi_komunikacija_naziv', 'drugi_komunikacija_kontakt'] },
  { broj: 6, naslov: 'Mjesto prikupa pošiljaka i osoba zadužena za logistiku', polja: ['logistika_osoba_ime', 'logistika_osoba_email', 'logistika_osoba_telefon', 'mjesto_prikupa_isto_kao_sjediste', 'mjesto_prikupa_potvrda', 'mjesto_prikupa_adresa', 'mjesto_prikupa_postanski_broj', 'mjesto_prikupa_grad', 'online_booking_email', 'potreba_dodatni_ob_racuni', 'dodatni_ob_nacin_unosa', 'dodatni_ob_tablica_mail', 'dodatni_ob_tablica_id', 'dodatni_ob_poslovnica_1', 'dodatni_ob_ime_1', 'dodatni_ob_adresa_1', 'dodatni_ob_grad_1', 'dodatni_ob_postanski_broj_1', 'dodatni_ob_mail_1', 'dodatni_ob_mobitel_1', 'dodatni_ob_login_email_1', 'dodatni_ob_poslovnica_2', 'dodatni_ob_ime_2', 'dodatni_ob_adresa_2', 'dodatni_ob_grad_2', 'dodatni_ob_postanski_broj_2', 'dodatni_ob_mail_2', 'dodatni_ob_mobitel_2', 'dodatni_ob_login_email_2', 'dodatni_ob_poslovnica_3', 'dodatni_ob_ime_3', 'dodatni_ob_adresa_3', 'dodatni_ob_grad_3', 'dodatni_ob_postanski_broj_3', 'dodatni_ob_mail_3', 'dodatni_ob_mobitel_3', 'dodatni_ob_login_email_3', 'dodatni_ob_poslovnica_4', 'dodatni_ob_ime_4', 'dodatni_ob_adresa_4', 'dodatni_ob_grad_4', 'dodatni_ob_postanski_broj_4', 'dodatni_ob_mail_4', 'dodatni_ob_mobitel_4', 'dodatni_ob_login_email_4', 'dodatni_ob_poslovnica_5', 'dodatni_ob_ime_5', 'dodatni_ob_adresa_5', 'dodatni_ob_grad_5', 'dodatni_ob_postanski_broj_5', 'dodatni_ob_mail_5', 'dodatni_ob_mobitel_5', 'dodatni_ob_login_email_5', 'dodatni_ob_poslovnica_6', 'dodatni_ob_ime_6', 'dodatni_ob_adresa_6', 'dodatni_ob_grad_6', 'dodatni_ob_postanski_broj_6', 'dodatni_ob_mail_6', 'dodatni_ob_mobitel_6', 'dodatni_ob_login_email_6', 'dodatni_ob_poslovnica_7', 'dodatni_ob_ime_7', 'dodatni_ob_adresa_7', 'dodatni_ob_grad_7', 'dodatni_ob_postanski_broj_7', 'dodatni_ob_mail_7', 'dodatni_ob_mobitel_7', 'dodatni_ob_login_email_7', 'dodatni_ob_poslovnica_8', 'dodatni_ob_ime_8', 'dodatni_ob_adresa_8', 'dodatni_ob_grad_8', 'dodatni_ob_postanski_broj_8', 'dodatni_ob_mail_8', 'dodatni_ob_mobitel_8', 'dodatni_ob_login_email_8', 'dodatni_ob_poslovnica_9', 'dodatni_ob_ime_9', 'dodatni_ob_adresa_9', 'dodatni_ob_grad_9', 'dodatni_ob_postanski_broj_9', 'dodatni_ob_mail_9', 'dodatni_ob_mobitel_9', 'dodatni_ob_login_email_9', 'dodatni_ob_poslovnica_10', 'dodatni_ob_ime_10', 'dodatni_ob_adresa_10', 'dodatni_ob_grad_10', 'dodatni_ob_postanski_broj_10', 'dodatni_ob_mail_10', 'dodatni_ob_mobitel_10', 'dodatni_ob_login_email_10', 'vrijeme_prikupa'] },
  { broj: 7, naslov: 'Trenutni logistički partneri', polja: ['logisticke_sluzbe', 'logisticke_sluzbe_ostalo', 'nova_tvrtka_bez_logistike'] },
  { broj: 8, naslov: 'Za koje svrhe želite koristiti naše usluge dostave?', polja: ['svrha_dostave', 'svrha_dostave_ostalo'] },
  { broj: 9, naslov: 'Usluge koje Vam možemo ponuditi', polja: ['osnovne_usluge', 'dodatne_usluge', 'dodatne_usluge_ostalo', 'dodatna_specifikacija'] },
  { broj: 10, naslov: 'Proizvodi i pošiljke', polja: ['sadrzaj_posiljki', 'sadrzaj_posiljki_ostalo', 'opis_proizvoda', 'karakteristika', 'karakteristika_ostalo', 'tezina_posiljaka', 'tezina_ostalo'] },
  { broj: 11, naslov: 'Pakiranje i sezonalnost', polja: ['pakiranje', 'pakiranje_ostalo', 'sezonalnost', 'sezonalnost_ostalo', 'sezonalnost_mjeseci', 'standardizirane_kutije', 'kutija_duzina_1', 'kutija_sirina_1', 'kutija_visina_1', 'kutija_duzina_2', 'kutija_sirina_2', 'kutija_visina_2', 'kutija_duzina_3', 'kutija_sirina_3', 'kutija_visina_3', 'kutija_duzina_4', 'kutija_sirina_4', 'kutija_visina_4', 'kutija_duzina_5', 'kutija_sirina_5', 'kutija_visina_5', 'kutija_duzina_6', 'kutija_sirina_6', 'kutija_visina_6', 'kutija_duzina_7', 'kutija_sirina_7', 'kutija_visina_7', 'kutija_duzina_8', 'kutija_sirina_8', 'kutija_visina_8', 'kutija_duzina_9', 'kutija_sirina_9', 'kutija_visina_9', 'kutija_duzina_10', 'kutija_sirina_10', 'kutija_visina_10', 'crni_petak'] },
  { broj: 12, naslov: 'Opseg pošiljaka', polja: ['novi_klijent_bez_opsega', 'broj_usluga_domaca', 'razdoblje_usluga_domaca', 'kategorije_tezine_domaca', 'kat_tezine_domaca_naziv_1', 'kat_tezine_domaca_broj_1', 'kat_tezine_domaca_postotak_1', 'kat_tezine_domaca_naziv_2', 'kat_tezine_domaca_broj_2', 'kat_tezine_domaca_postotak_2', 'kat_tezine_domaca_naziv_3', 'kat_tezine_domaca_broj_3', 'kat_tezine_domaca_postotak_3', 'kat_tezine_domaca_naziv_4', 'kat_tezine_domaca_broj_4', 'kat_tezine_domaca_postotak_4', 'kat_tezine_domaca_naziv_5', 'kat_tezine_domaca_broj_5', 'kat_tezine_domaca_postotak_5', 'kat_tezine_domaca_naziv_6', 'kat_tezine_domaca_broj_6', 'kat_tezine_domaca_postotak_6', 'kat_tezine_domaca_naziv_7', 'kat_tezine_domaca_broj_7', 'kat_tezine_domaca_postotak_7', 'kat_tezine_domaca_ostalo_postotak', 'kat_tezine_domaca_ostalo_broj', 'broj_usluga_medjunarodna', 'razdoblje_usluga_medjunarodna', 'kategorije_tezine_medjunarodna', 'kat_tezine_medjunarodna_naziv_1', 'kat_tezine_medjunarodna_broj_1', 'kat_tezine_medjunarodna_postotak_1', 'kat_tezine_medjunarodna_naziv_2', 'kat_tezine_medjunarodna_broj_2', 'kat_tezine_medjunarodna_postotak_2', 'kat_tezine_medjunarodna_naziv_3', 'kat_tezine_medjunarodna_broj_3', 'kat_tezine_medjunarodna_postotak_3', 'kat_tezine_medjunarodna_naziv_4', 'kat_tezine_medjunarodna_broj_4', 'kat_tezine_medjunarodna_postotak_4', 'kat_tezine_medjunarodna_naziv_5', 'kat_tezine_medjunarodna_broj_5', 'kat_tezine_medjunarodna_postotak_5', 'kat_tezine_medjunarodna_naziv_6', 'kat_tezine_medjunarodna_broj_6', 'kat_tezine_medjunarodna_postotak_6', 'kat_tezine_medjunarodna_naziv_7', 'kat_tezine_medjunarodna_broj_7', 'kat_tezine_medjunarodna_postotak_7', 'kat_tezine_medjunarodna_ostalo_postotak', 'kat_tezine_medjunarodna_ostalo_broj', 'zemlje_medjunarodna', 'udio_izvoza_medjunarodna', 'broj_usluga_fedex_express', 'razdoblje_usluga_fedex_express', 'kategorije_tezine_fedex_express', 'kat_tezine_fedex_express_naziv_1', 'kat_tezine_fedex_express_broj_1', 'kat_tezine_fedex_express_postotak_1', 'kat_tezine_fedex_express_naziv_2', 'kat_tezine_fedex_express_broj_2', 'kat_tezine_fedex_express_postotak_2', 'kat_tezine_fedex_express_naziv_3', 'kat_tezine_fedex_express_broj_3', 'kat_tezine_fedex_express_postotak_3', 'kat_tezine_fedex_express_naziv_4', 'kat_tezine_fedex_express_broj_4', 'kat_tezine_fedex_express_postotak_4', 'kat_tezine_fedex_express_naziv_5', 'kat_tezine_fedex_express_broj_5', 'kat_tezine_fedex_express_postotak_5', 'kat_tezine_fedex_express_naziv_6', 'kat_tezine_fedex_express_broj_6', 'kat_tezine_fedex_express_postotak_6', 'kat_tezine_fedex_express_naziv_7', 'kat_tezine_fedex_express_broj_7', 'kat_tezine_fedex_express_postotak_7', 'kat_tezine_fedex_express_ostalo_postotak', 'kat_tezine_fedex_express_ostalo_broj', 'zemlje_fedex_express', 'udio_izvoza_fedex_express', 'broj_usluga_fedex_economy', 'razdoblje_usluga_fedex_economy', 'kategorije_tezine_fedex_economy', 'kat_tezine_fedex_economy_naziv_1', 'kat_tezine_fedex_economy_broj_1', 'kat_tezine_fedex_economy_postotak_1', 'kat_tezine_fedex_economy_naziv_2', 'kat_tezine_fedex_economy_broj_2', 'kat_tezine_fedex_economy_postotak_2', 'kat_tezine_fedex_economy_naziv_3', 'kat_tezine_fedex_economy_broj_3', 'kat_tezine_fedex_economy_postotak_3', 'kat_tezine_fedex_economy_naziv_4', 'kat_tezine_fedex_economy_broj_4', 'kat_tezine_fedex_economy_postotak_4', 'kat_tezine_fedex_economy_naziv_5', 'kat_tezine_fedex_economy_broj_5', 'kat_tezine_fedex_economy_postotak_5', 'kat_tezine_fedex_economy_naziv_6', 'kat_tezine_fedex_economy_broj_6', 'kat_tezine_fedex_economy_postotak_6', 'kat_tezine_fedex_economy_naziv_7', 'kat_tezine_fedex_economy_broj_7', 'kat_tezine_fedex_economy_postotak_7', 'kat_tezine_fedex_economy_ostalo_postotak', 'kat_tezine_fedex_economy_ostalo_broj', 'zemlje_fedex_economy', 'udio_izvoza_fedex_economy'] },
];

// ---- POMOĆNA FUNKCIJA — pretvara vrijednost (string ili niz iz
// checkboxeva/multi-selecta) u čitljiv string ----
function val(v) {
  if (v === undefined || v === null) { return ''; }
  if (Array.isArray(v)) { return v.join(', '); }
  return String(v);
}

/* ---- ANKETA O KVALITETI USLUGE (InTime_Anketa.html) ----
   Zasebna, samostalna anketa namijenjena POSTOJEĆIM klijentima — poveznica
   na nju nalazi se na glavnoj stranici (InTime_PismoNamjere.html), iznad
   izbora "DA/NE zainteresirani smo". Potpuno odvojena od "Prodajni upitnik"
   toka (drugi Sheet, drugi mail, drugi `tip` u doPost) — ne dijeli UPIT_FIELDS
   niti "InTime_Upiti" tablicu, budući da pokriva sasvim drugu vrstu podataka
   (25 ocjena kvalitete + 2 NPS pitanja + slobodni komentari), ne "podatke o
   tvrtki radi ponude". ANKETA_FIELDS je izvor istine za redoslijed stupaca u
   Sheetu i sadržaj mailova — ako se u InTime_Anketa.html doda/promijeni
   pitanje, ažurirati i ovdje (i ANKETA_SEKCIJE/ANKETA_ZAVRSNA_PITANJA nizove
   u samom HTML-u). */
var ANKETA_SHEET_NAME = 'InTime_Ankete';
// Svako pitanje q1-q25 sad ima UZ ocjenu i vlastito opcionalno polje
// "{key}_komentar" (slobodan tekst — iskustvo/stav/problem vezan baš za to
// pitanje, korisnikov izričit zahtjev) — umetnuto odmah iza odgovarajućeg
// q-polja, u istoj sekciji.
var ANKETA_FIELDS = [
  {sec:'Podaci o unosu'},
  ['vrijeme_dolaska', 'Vrijeme dolaska na stranicu'],
  ['vrijeme_slanja', 'Vrijeme slanja ankete'],
  ['vrijeme_popunjavanja', 'Vrijeme popunjavanja (trajanje)'],
  {sec:'Podaci o poslovnom subjektu'},
  ['anketa_naziv', 'Naziv poslovnog subjekta'],
  ['anketa_oib', 'OIB poslovnog subjekta'],
  ['anketa_ime_prezime', 'Ime i prezime osobe koja ispunjava anketu'],
  ['anketa_telefon', 'Broj telefona osobe koja ispunjava anketu'],
  ['anketa_email', 'E-mail adresa osobe koja ispunjava anketu'],
  {sec:'Opća kvaliteta usluge'},
  ['q1', 'Ukupna kvaliteta usluge tvrtke IN TIME (0-10 ili "Ne mogu procijeniti")'],
  ['q1_komentar', 'Komentar uz pitanje: Ukupna kvaliteta usluge'],
  ['q2', 'Pouzdanost IN TIME-a kao poslovnog partnera (0-10 ili "Ne mogu procijeniti")'],
  ['q2_komentar', 'Komentar uz pitanje: Pouzdanost kao poslovnog partnera'],
  ['q3', 'Omjer cijene i kvalitete usluge (0-10 ili "Ne mogu procijeniti")'],
  ['q3_komentar', 'Komentar uz pitanje: Omjer cijene i kvalitete'],
  {sec:'Preuzimanje i isporuka pošiljaka'},
  ['q4', 'Pravovremenost preuzimanja pošiljaka (0-10 ili "Ne mogu procijeniti")'],
  ['q4_komentar', 'Komentar uz pitanje: Pravovremenost preuzimanja'],
  ['q5', 'Pridržavanje dogovorenih termina preuzimanja (0-10 ili "Ne mogu procijeniti")'],
  ['q5_komentar', 'Komentar uz pitanje: Pridržavanje dogovorenih termina'],
  ['q6', 'Brzina isporuke pošiljaka (0-10 ili "Ne mogu procijeniti")'],
  ['q6_komentar', 'Komentar uz pitanje: Brzina isporuke'],
  ['q7', 'Poštivanje očekivanih rokova isporuke (0-10 ili "Ne mogu procijeniti")'],
  ['q7_komentar', 'Komentar uz pitanje: Poštivanje rokova isporuke'],
  ['q8', 'Uspješnost isporuke pošiljaka iz prvog pokušaja (0-10 ili "Ne mogu procijeniti")'],
  ['q8_komentar', 'Komentar uz pitanje: Isporuka iz prvog pokušaja'],
  ['q9', 'Točnost i dostupnost informacija o statusu pošiljaka (0-10 ili "Ne mogu procijeniti")'],
  ['q9_komentar', 'Komentar uz pitanje: Informacije o statusu pošiljaka'],
  ['q10', 'Pravovremenost obavještavanja primatelja o isporuci (0-10 ili "Ne mogu procijeniti")'],
  ['q10_komentar', 'Komentar uz pitanje: Obavještavanje primatelja'],
  {sec:'Dostavljači i postupanje s pošiljkama'},
  ['q11', 'Profesionalnost i ljubaznost dostavljača (0-10 ili "Ne mogu procijeniti")'],
  ['q11_komentar', 'Komentar uz pitanje: Profesionalnost dostavljača'],
  ['q12', 'Odnos dostavljača prema kupcima i primateljima (0-10 ili "Ne mogu procijeniti")'],
  ['q12_komentar', 'Komentar uz pitanje: Odnos prema kupcima/primateljima'],
  ['q13', 'Pažnja kojom se postupa s pošiljkama (0-10 ili "Ne mogu procijeniti")'],
  ['q13_komentar', 'Komentar uz pitanje: Pažnja pri postupanju s pošiljkama'],
  ['q14', 'Stanje pošiljaka pri isporuci, oštećenja (0-10 ili "Ne mogu procijeniti")'],
  ['q14_komentar', 'Komentar uz pitanje: Stanje pošiljaka/oštećenja'],
  ['q15', 'Sigurnost prijevoza lomljive, osjetljive ili vrijedne robe (0-10 ili "Ne mogu procijeniti")'],
  ['q15_komentar', 'Komentar uz pitanje: Sigurnost prijevoza robe'],
  {sec:'Online Booking i praćenje pošiljaka'},
  ['q16', 'Jednostavnost kreiranja naloga u Online Bookingu (0-10 ili "Ne mogu procijeniti")'],
  ['q16_komentar', 'Komentar uz pitanje: Kreiranje naloga u OB-u'],
  ['q17', 'Mogućnost praćenja pošiljaka i dostupnost informacija (0-10 ili "Ne mogu procijeniti")'],
  ['q17_komentar', 'Komentar uz pitanje: Praćenje pošiljaka'],
  {sec:'Voditelj ključnih kupaca'},
  ['q18', 'Dostupnost voditelja ključnih kupaca (0-10 ili "Ne mogu procijeniti")'],
  ['q18_komentar', 'Komentar uz pitanje: Dostupnost voditelja'],
  ['q19', 'Brzina odgovora voditelja ključnih kupaca (0-10 ili "Ne mogu procijeniti")'],
  ['q19_komentar', 'Komentar uz pitanje: Brzina odgovora voditelja'],
  ['q20', 'Razumijevanje poslovanja, potreba i problema od strane voditelja (0-10 ili "Ne mogu procijeniti")'],
  ['q20_komentar', 'Komentar uz pitanje: Razumijevanje poslovanja klijenta'],
  ['q21', 'Angažiranost i učinkovitost voditelja pri rješavanju zahtjeva (0-10 ili "Ne mogu procijeniti")'],
  ['q21_komentar', 'Komentar uz pitanje: Angažiranost voditelja'],
  {sec:'Reklamacije, računi i administracija'},
  ['q22', 'Brzina i kvaliteta rješavanja reklamacija i oštećenja (0-10 ili "Ne mogu procijeniti")'],
  ['q22_komentar', 'Komentar uz pitanje: Rješavanje reklamacija'],
  ['q23', 'Točnost računa i jasnoća obračunatih cijena i naknada (0-10 ili "Ne mogu procijeniti")'],
  ['q23_komentar', 'Komentar uz pitanje: Točnost računa'],
  {sec:'Završna ocjena'},
  ['q24', 'Vjerojatnost preporuke IN TIME drugoj tvrtki/partneru (0-10)'],
  ['q24_komentar', 'Komentar uz pitanje: Vjerojatnost preporuke'],
  ['q25', 'Vjerojatnost daljnjeg korištenja usluga IN TIME (0-10)'],
  ['q25_komentar', 'Komentar uz pitanje: Vjerojatnost daljnjeg korištenja'],
  {sec:'Dodatni komentar'},
  ['anketa_prednost', 'Najveća prednost suradnje s IN TIME-om'],
  ['anketa_poboljsati', 'Što bi trebalo prvo poboljšati'],
  ['anketa_komentar', 'Dodatni komentar, prijedlog ili pohvala']
];

// Kategorije (= sekcije upitnika u InTime_Anketa.html, ANKETA_SEKCIJE +
// ANKETA_ZAVRSNA_PITANJA) za admin agregatnu statistiku — korisnikov izričit
// zahtjev: prosječna ocjena PO SVAKOJ kategoriji i ukupno, računato preko SVIH
// dosad ispunjenih anketa (zbrajaju se rezultati kako ankete stižu, ne samo
// jedna po jedna) — vidi adminGetAnketaStatistika(). Ako se ikad doda/ukloni/
// premjesti pitanje u InTime_Anketa.html, ovaj popis MORA se ručno ažurirati
// da prati isti raspored — nema automatske sinkronizacije.
var ANKETA_KATEGORIJE = [
  { naziv: 'Opća kvaliteta usluge', pitanja: ['q1', 'q2', 'q3'] },
  { naziv: 'Preuzimanje i isporuka pošiljaka', pitanja: ['q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'] },
  { naziv: 'Dostavljači i postupanje s pošiljkama', pitanja: ['q11', 'q12', 'q13', 'q14', 'q15'] },
  { naziv: 'Online Booking i praćenje pošiljaka', pitanja: ['q16', 'q17'] },
  { naziv: 'Voditelj ključnih kupaca', pitanja: ['q18', 'q19', 'q20', 'q21'] },
  { naziv: 'Reklamacije, računi i administracija', pitanja: ['q22', 'q23'] },
  { naziv: 'Završna ocjena (preporuka i daljnje korištenje)', pitanja: ['q24', 'q25'] }
];

// Gradi popis naslova stupaca koje trenutni ANKETA_FIELDS kod treba
// proizvesti — analogno izracunajOcekivanoZaglavljeUpiti_() niže, ali za
// "InTime_Ankete" Sheet. Izdvojeno u zasebnu funkciju da je koristi i
// getOrCreateAnketaSheet() (nov sheet) i uskladiZaglavljeUpitiSheeta_()
// (postojeći sheet, provjera/dopuna) — ista generička poravnavajuća funkcija
// koja se već koristi za "InTime_Upiti" sad se ponovno koristi i ovdje,
// umjesto da se piše zasebna, gotovo identična implementacija.
function izracunajOcekivanoZaglavljeAnkete_() {
  var header = ['Timestamp', 'Broj'];
  for (var i = 0; i < ANKETA_FIELDS.length; i++) {
    var f = ANKETA_FIELDS[i];
    if (f.sec) { continue; }
    header.push(f[1]);
  }
  // Sašin izričit zahtjev (20.9.2026., drugi val — "stavi napomenu KAM-a i
  // za odbijenicu i za anketu"): ISTO admin-only polje kao kod Upitnika
  // (vidi ADMIN_ONLY_FIELDS.napomena_kam), ovdje dodano na sam kraj zaglavlja
  // "InTime_Ankete" Sheeta (self-healing uskladiZaglavljeUpitiSheeta_ u
  // getOrCreateAnketaSheet() ga umeće bez pomicanja postojećih podataka).
  // Upisuje se kroz novu adminUpdateAnketaFields() (Anketa živi u VLASTITOM
  // Sheetu, adminUpdateFields() radi samo nad "InTime_Upiti").
  header.push('Napomena KAM-a (admin)');
  return header;
}

// POPRAVAK 20.9.2026. (18. krug) — isti razlog i isto rješenje kao u
// getOrCreateUpitiSheet() gore (LockService oko poravnanja zaglavlja, jer
// adminGetCounters() I adminListAnkete() oba zovu ovu funkciju usporedno).
function getOrCreateAnketaSheet() {
  var files = DriveApp.getFilesByName(ANKETA_SHEET_NAME);
  var ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(ANKETA_SHEET_NAME);
  }
  var sheet = ss.getSheets()[0];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
  var ocekivano = izracunajOcekivanoZaglavljeAnkete_();
  if (sheet.getLastRow() === 0) {
    // Sasvim nov (prazan) sheet — upiši zaglavlje odmah.
    sheet.appendRow(ocekivano);
    sheet.getRange(1, 1, 1, ocekivano.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    // BUG NAĐEN 15.9.2026. (Sašin nalaz — admin kartice ankete prikazivale
    // su podatke "pomaknute" u pogrešna polja, npr. naziv tvrtke prikazan
    // kao OIB, mail prikazan kao brojčana ocjena): dosad je ovdje bila samo
    // USKA provjera "je li 2. stupac 'Broj'" — svaka DRUGA izmjena u
    // ANKETA_FIELDS (npr. dodavanje polja usred popisa) NIJE bila praćena
    // nikakvim ažuriranjem stvarnog zaglavlja retka 1 u već postojećem
    // Sheetu, pa su nove izmjene koda i stari, nepromijenjeni stvarni
    // Sheet-header s vremenom "otišli u raskorak" — obj[header[c]] u
    // adminListAnkete() zato čita ispravnu VRIJEDNOST iz pogrešno
    // označenog stupca. Zamijenjeno istom generičkom poravnavajućom
    // funkcijom (uskladiZaglavljeUpitiSheeta_) koja se već koristi za
    // "InTime_Upiti" — uspoređuje stupac-po-stupac i umeće nedostajuće
    // stupce TOČNO na njihovo mjesto, umjesto da samo doda na kraj. NAPOMENA:
    // ovo ispravlja poravnanje za BUDUĆE upise, ali NE ispravlja retroaktivno
    // već upisane (pogrešno poravnate) retke — te treba ručno provjeriti/
    // obrisati (npr. testne unose).
    uskladiZaglavljeUpitiSheeta_(sheet, ocekivano);
  }
  } finally {
    lock.releaseLock();
  }
  return sheet;
}

// ============================================================
// FAQ ("Česta pitanja") — vidi opširnu napomenu uz FAQ_SHEET_NAME na vrhu
// datoteke. Stupci: Pitanje, Odgovor, SlikaId, VideoId, PdfId (Drive file ID
// priloga, ili prazno ako ga nema), Redoslijed (broj — manji ide više gore
// na javnoj stranici), SlikaPoravnanje ('puna'/'centar'/'lijevo'/'desno' —
// samo za sliku, kontrolira širinu/poravnanje na javnoj stranici, prazno =
// 'puna'), Datum (kad je pitanje dodano, admin-informativno), Lajkovi/
// Nelajkovi (brojači 👍/👎 koje gosti kliču ispod odgovora na javnoj
// stranici — vidi faqOcjena() niže).
// ============================================================
function getOrCreateFaqSheet() {
  var files = DriveApp.getFilesByName(FAQ_SHEET_NAME);
  var ss;
  var header = ['Pitanje', 'Odgovor', 'SlikaId', 'VideoId', 'PdfId', 'Redoslijed', 'SlikaPoravnanje', 'Datum', 'Lajkovi', 'Nelajkovi'];
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
    var postojeciSheet = ss.getSheets()[0];
    // Migracija za tablice stvorene PRIJE dodavanja Lajkovi/Nelajkovi stupaca
    // — samo dopuni zaglavlje ako fali, podaci retka se ne diraju (Sheets
    // automatski proširuje mrežu i pri čitanju/pisanju stupaca 9/10).
    var trenutnoZaglavlje = postojeciSheet.getRange(1, 9, 1, 2).getValues()[0];
    if (String(trenutnoZaglavlje[0] || '') !== 'Lajkovi' || String(trenutnoZaglavlje[1] || '') !== 'Nelajkovi') {
      postojeciSheet.getRange(1, 9, 1, 2).setValues([['Lajkovi', 'Nelajkovi']]);
    }
  } else {
    ss = SpreadsheetApp.create(FAQ_SHEET_NAME);
    var sheet = ss.getSheets()[0];
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return ss.getSheets()[0];
}

// ---- Admin kao kontrolni centar — Drive struktura (Faza 1, 19.9.2026.) ----

function getSustavRootFolder_() {
  return DriveApp.getFolderById(SUSTAV_ROOT_FOLDER_ID);
}

// Generički helper: traži poddirektorij po TOČNOM imenu unutar zadanog
// roditelja, stvara ga ako ne postoji. Koristi se za sve poddirektorije
// kontrolnog centra ispod (i za poddirektorije po klijentu/mjesecu/firmi
// unutar njih — vidi adminExportKlijent()).
function getOrCreateChildFolder_(parentFolder, name) {
  var it = parentFolder.getFoldersByName(name);
  if (it.hasNext()) { return it.next(); }
  return parentFolder.createFolder(name);
}

// Traži poddirektorij VERZIJE ponude po formuli imena, TOLERANTNO na dodani
// sufiks "- PRIHVAĆENA" (dodaje se kod potvrdiPonudu()/stvoriDokumentPotvrdePonude_
// niže, na Sašin izričit zahtjev, deveti krug: "kad se ponuda potvrdi
// direktorij te ponude treba na kraju dobiti - PRIHVACENA") — bez ovoga bi
// svaki SLJEDEĆI poziv koji traži TOČNO ime po formuli (bez sufiksa) —
// adminPripremiDokumenteZaPonudu, stvoriDokumentOdbijanjaPonude_ itd. —
// stvorio DRUGI, prazan folder umjesto da nađe već postojeći preimenovani.
// Ako ne nađe ni točno ime ni ime+sufiks, stvara novi (točnog imena, BEZ
// sufiksa — sufiks se dodaje SAMO na stvarno prihvaćanje).
function getOrCreateVerzijaFolder_(klijentFolder, verzijaFolderName) {
  var it = klijentFolder.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    var ime = f.getName();
    if (ime === verzijaFolderName || ime.indexOf(verzijaFolderName + ' - ') === 0) { return f; }
  }
  return klijentFolder.createFolder(verzijaFolderName);
}

// Imena svih poddirektorija koje getSustavSubfolders_() drži — izdvojeno u
// zaseban objekt (22.9.2026., osmi krug) da ga cache-sloj niže može čitati
// bez ponavljanja popisa.
var SUSTAV_SUBFOLDER_IMENA_ = {
  potencijalniKlijenti: 'POTENCIJALNI KLIJENTI',
  ponude: 'PONUDE',
  klijenti: 'KLIJENTI',
  osnovnaDokumentacija: 'OSNOVNA DOKUMENTACIJA',
  imenik: 'IMENIK',
  odbijenice: 'ODBIJENICE',
  oceneKvalitete: 'OCJENE KVALITETE',
  predlosciSlike: 'PREDLOSCI SLIKE'
};
// Ključ/trajanje CacheService zapisa niže — 6h je maksimum koji CacheService
// dopušta (`put` prima sekunde, max 21600).
var SUSTAV_SUBFOLDERS_CACHE_KLJUC_ = 'sustavSubfolderIds_v1';
var SUSTAV_SUBFOLDERS_CACHE_SEK_ = 21600;
// Memorijski cache SAMO za trajanje TRENUTNOG izvršavanja (resetira se na
// svaki novi poziv skripte) — pokriva slučaj kad se getSustavSubfolders_()
// pozove više puta UNUTAR istog izvršavanja.
var sustavSubfoldersMemCache_ = null;

// Vraća (i po potrebi stvara) svih 8 glavnih poddirektorija kontrolnog
// centra unutar SUSTAV_ROOT_FOLDER_ID.
//
// UBRZANO (22.9.2026., osmi krug — Sašin izričit zahtjev, nakon dijagnoze
// preko Network taba, koja je pokazala "exec" pozive od 7-27 SEKUNDI i
// povremene CORS greške na Googleovom redirect-echu, ne u ovom kodu). Prava
// dijagnoza: OVA funkcija je do sad, na SVAKI poziv, radila 8 UZASTOPNIH
// `getFoldersByName()` PRETRAGA po Driveu (jedna po poddirektoriju) — bez
// ikakvog cachea, kako je stara napomena i govorila ("pretraga po imenu je
// jeftina" — u praksi NIJE, DriveApp pretrage su primjetno sporije od
// izravnog dohvata po ID-u). Ovu funkciju poziva `adminListOsnovnaDokumentacija`
// (panel "Osnovna dokumentacija" koji je znao ostati na "Učitavanje…"/
// "Failed to fetch") i `adminListImenik` (jedna od 10 funkcija unutar
// konsolidiranog `adminUcitajPocetno`) — dulje izvršavanje znači i veću
// šansu da GAS-ov redirect (script.google.com → script.googleusercontent.com)
// povremeno zapne, što se točno i vidjelo na Network tabu.
//
// Rješenje: ID-jevi svih 8 poddirektorija (NE sami Folder objekti, koji se
// ne mogu serijalizirati) spremaju se u CacheService na 6h. Sljedeći poziv
// (unutar tih 6h, uklj. iz DRUGOG izvršavanja/HTTP poziva) čita ID-jeve iz
// cachea i dohvaća foldere s `DriveApp.getFolderById()` — izravan lookup,
// bez pretrage, MNOGO brže. Ako neki cache-irani ID više nije valjan (Saša
// ručno obrisao/premjestio folder), automatski pada natrag na puni put
// (pretraga-ili-stvori) za SVE poddirektorije i osvježava cache — isto
// samoobnavljajuće ponašanje kao prije, samo sad brzo u čestom slučaju.
function getSustavSubfolders_() {
  if (sustavSubfoldersMemCache_) { return sustavSubfoldersMemCache_; }
  var kljucevi = Object.keys(SUSTAV_SUBFOLDER_IMENA_);

  try {
    var cache = CacheService.getScriptCache();
    var cachiranoSirovo = cache.get(SUSTAV_SUBFOLDERS_CACHE_KLJUC_);
    if (cachiranoSirovo) {
      var ids = JSON.parse(cachiranoSirovo);
      var rezultatIzCachea = {};
      var sveValjano = true;
      for (var i = 0; i < kljucevi.length; i++) {
        var k = kljucevi[i];
        if (!ids[k]) { sveValjano = false; break; }
        try {
          rezultatIzCachea[k] = DriveApp.getFolderById(ids[k]);
        } catch (errFolder) {
          sveValjano = false;
          break;
        }
      }
      if (sveValjano) {
        sustavSubfoldersMemCache_ = rezultatIzCachea;
        return rezultatIzCachea;
      }
    }
  } catch (errCacheRead) { /* CacheService nedostupan/oštećen zapis — nastavi na puni put niže */ }

  // Puni put (pretraga-ili-stvori za svaki poddirektorij) — isto ponašanje
  // kao prije ovog popravka, koristi se samo kad cache promaši/istekne.
  var root = getSustavRootFolder_();
  var rezultatPuni = {};
  kljucevi.forEach(function(k) {
    rezultatPuni[k] = getOrCreateChildFolder_(root, SUSTAV_SUBFOLDER_IMENA_[k]);
  });

  try {
    var idoviZaCache = {};
    kljucevi.forEach(function(k) { idoviZaCache[k] = rezultatPuni[k].getId(); });
    CacheService.getScriptCache().put(SUSTAV_SUBFOLDERS_CACHE_KLJUC_, JSON.stringify(idoviZaCache), SUSTAV_SUBFOLDERS_CACHE_SEK_);
  } catch (errCacheWrite) { /* spremanje u cache nije kritično, nastavi bez njega */ }

  sustavSubfoldersMemCache_ = rezultatPuni;
  return rezultatPuni;
}

// ---- IMENIK (kontakti) — Faza (19.9.2026., Sašin izričit zahtjev, trinaesti
// krug): objedinjena adresna knjiga kontakata prikupljenih iz sva tri
// obrasca (Upitnik/Interes, Odbijenica, Anketa o kvaliteti). Svaki kontakt
// se STVARA/AŽURIRA AUTOMATSKI čim se odgovarajući obrazac pošalje (vidi
// pozive obradiKontakteZaImenik_() niže, ugrađene u saveUpit/saveOdbijenica/
// saveAnketa) — nema potrebe za ručnim exportom kao kod adminExportKlijent
// i sl. Isti fizički Drive folder ('IMENIK', vidi getSustavSubfolders_()
// iznad, pripremljen još u Fazi 1) sada dobiva stvarnu namjenu: svaki
// kontakt dobiva svoju CSV datoteku u IMENIK/<godina>/<mjesec>/.
//
// SPAJANJE DUPLIKATA: kontakt se prepoznaje po OIB-u + istom imenu — ako već
// postoji redak s istim OIB-om i istim imenom (case-insensitive), NE stvara
// se nov redak nego se postojeći ažurira (dodaju mu se novi telefon/email/
// funkcija/tag/broj, bez brisanja starih) — Sašin izričit zahtjev ("spajaš
// po OIB-u"). Kontakt bez OIB-a uvijek dobiva nov redak (nema po čemu
// sigurno prepoznati da je riječ o istoj osobi/tvrtki).
var IMENIK_SHEET_NAME = 'InTime_Imenik';
// 'Napomena' (20.9.2026., Sašin izričit zahtjev) — slobodan tekst, trenutno
// koristi SAMO jedan slučaj: kad Odgovorna osoba (potpisnik/na koga se
// naslovljava ponuda) NEMA upisan telefonski broj (u upitniku nije obavezan)
// I nije ista osoba kao Kontakt osoba, ne stvara se poseban, "slab" kontakt
// bez telefona — umjesto toga na Kontakt osobin redak upisuje se napomena
// "Odgovorna osoba: {ime i prezime}", da Saša u Imeniku/Google Contacts vidi
// tko je potpisnik. Vidi izvuciKontakteIzUpitnika_() niže za punu logiku.
var IMENIK_HEADER = [
  'Datum unosa', 'Zadnja izmjena', 'Ime', 'Prezime (naziv tvrtke)', 'OIB', 'Grad',
  'Telefoni', 'Emailovi', 'Funkcije', 'Napomena', 'Tagovi',
  'Broj upitnika', 'Broj odbijenice', 'Broj ocjene kvalitete',
  'Google Contact ID', 'Prebačeno u Google Contacts', 'Datum prebacivanja u Google',
  'CSV Drive File ID', 'Skriveno'
];
// Stupci (1-indeksirano, radi preglednosti kroz cijeli Imenik blok koda):
// NOVO 20.9.2026. (17. krug, Sašin izričit zahtjev — pretraga po gradu): stupac
// "Grad" umetnut nakon OIB-a; puni se samo iz Upitnika (Interes), jer
// Odbijenica/Anketa obrasci ne prikupljaju grad/mjesto tvrtke.
// NOVO 20.9.2026. (dvadeset i šesti krug, Sašin izričit zahtjev): "Skriveno"
// ('Da'/'Ne', prazno = 'Ne') dodano NA SAM KRAJ zaglavlja (isti self-healing
// obrazac kao svi prijašnji krugovi — sigurno mjesto, ne pomiče postojeće
// stupce). Rješava problem gdje bi BRISANJE kontakta iz Imenika uzrokovalo da
// se on VRATI kod sljedećeg pokretanja "Povuci sve kontakte iz starih upisa"
// (backfill ponovno prolazi kroz IZVORNE upitnike/odbijenice/ankete, koji se
// nikad ne brišu — vidi adminPovuciSveKontakte niže) — "Sakrij" umjesto
// "Obriši" ostavlja redak netaknut u Imeniku (pa ga spremiKontaktUImenik_
// prepoznaje kao već obrađen i NE stvara duplikat), samo ga izostavlja iz
// zadanog prikaza dok se aktivno ne pretražuje.
var IMENIK_COL = {
  DATUM_UNOSA: 1, ZADNJA_IZMJENA: 2, IME: 3, PREZIME: 4, OIB: 5, GRAD: 6,
  TELEFONI: 7, EMAILOVI: 8, FUNKCIJE: 9, NAPOMENA: 10, TAGOVI: 11,
  BROJ_UPITNIKA: 12, BROJ_ODBIJENICE: 13, BROJ_OCJENE: 14,
  GOOGLE_ID: 15, PREBACENO: 16, DATUM_PREBACIVANJA: 17, CSV_FILE_ID: 18,
  SKRIVENO: 19
};

function getOrCreateImenikSheet() {
  var files = DriveApp.getFilesByName(IMENIK_SHEET_NAME);
  var ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(IMENIK_SHEET_NAME);
  }
  var sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(IMENIK_HEADER);
    sheet.getRange(1, 1, 1, IMENIK_HEADER.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    // Self-healing poravnavanje (isti generički mehanizam kao za "InTime_Upiti"
    // i "InTime_Ankete") — umeće stupac "Napomena" na TOČNO pravo mjesto u
    // već postojećem Imenik sheetu (20.9.2026.), bez pomicanja/brisanja
    // postojećih podataka u ostalim stupcima.
    uskladiZaglavljeUpitiSheeta_(sheet, IMENIK_HEADER);
  }
  return sheet;
}

// Spaja stari i novi popis (odvojen zarezom) bez duplikata i bez praznih
// članova — koristi se za Telefone/Emailove/Funkcije/Tagove/Brojeve u
// Imeniku kad se kontakt naknadno dopunjuje.
function spojiPopis_(stari, novi) {
  var dijelovi = String(stari || '').split(',').map(function(s){ return s.trim(); }).filter(function(s){ return s; });
  String(novi || '').split(',').forEach(function(s) {
    s = s.trim();
    if (s && dijelovi.indexOf(s) === -1) { dijelovi.push(s); }
  });
  return dijelovi.join(', ');
}

// Drive folder u koji se spremaju prilozi uz FAQ odgovore (slika/video/PDF
// koje Saša izravno uploada kroz admin sučelje). ID foldera pamti se u
// Script Properties (FAQ_MEDIA_FOLDER_ID) da se ne stvara nov folder pri
// svakom uploadu. Folder se ujedno dijeli "Bilo tko s poveznicom", radi
// urednosti kad ga Saša ručno otvori na Driveu — ali stvarno javno
// gledanje SVAKE pojedine datoteke oslanja se na eksplicitno postavljeno
// dijeljenje te datoteke u adminFaqUploadMedia(), ne na ovo.
function getOrCreateFaqMediaFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('FAQ_MEDIA_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (err) { /* folder obrisan/nedostupan — stvori novi ispod */ }
  }
  var folder = DriveApp.createFolder('InTime_FAQ_Mediji');
  try { folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) { /* ne blokira upload ako ne uspije */ }
  props.setProperty('FAQ_MEDIA_FOLDER_ID', folder.getId());
  return folder;
}

// Prima bazu64-kodiranu datoteku iz admin sučelja (slika/video/PDF uz FAQ
// odgovor), sprema je u InTime_FAQ_Mediji i vraća njen Drive file ID.
// EKSPLICITNO postavlja javno dijeljenje na datoteku (vidi napomenu uz
// FAQ_SHEET_NAME) — bez toga se slika/video/PDF ne bi prikazali gostima.
function adminFaqUploadMedia(token, base64Data, mimeType, filename) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  if (!base64Data || !mimeType) { return { status: 'error', message: 'Nedostaje datoteka za slanje.' }; }
  try {
    var bytes = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(bytes, mimeType, filename || 'datoteka');
    var folder = getOrCreateFaqMediaFolder_();
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { status: 'ok', id: file.getId() };
  } catch (err) {
    return { status: 'error', message: 'Slanje datoteke nije uspjelo: ' + err.message };
  }
}

// Živi popis datoteka u Drive folderu "OSNOVNA DOKUMENTACIJA" (vidi
// getSustavSubfolders_() gore) — za lijevi okvir "Dokumenti za ponudu" u
// adminu (Sašin izričit zahtjev, 20.9.2026., devetnaesti krug). Saša taj
// folder održava RUČNO na Driveu (dodaje/mijenja/briše dokumente kako treba)
// — sustav ga NIKAD ne piše, samo čita, zato se popis dohvaća uživo pri
// svakom otvaranju kartice/klikom na "Osvježi", bez ikakvog cachea. Vraća i
// mimeType (za sitnu ikonu u sučelju po tipu datoteke) i modifiedDate (radi
// sortiranja/prikaza "zadnja izmjena").
function adminListOsnovnaDokumentacija(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  try {
    var sub = getSustavSubfolders_();
    var it = sub.osnovnaDokumentacija.getFiles();
    var files = [];
    while (it.hasNext()) {
      var f = it.next();
      files.push({
        id: f.getId(),
        name: f.getName(),
        mimeType: f.getMimeType(),
        url: f.getUrl()
      });
    }
    files.sort(function(a, b) { return a.name.localeCompare(b.name, 'hr'); });
    return { status: 'ok', files: files, folderUrl: sub.osnovnaDokumentacija.getUrl() };
  } catch (err) {
    return { status: 'error', message: 'Popis osnovne dokumentacije nije uspio: ' + err.message };
  }
}

// Prima bazu64-kodiranu datoteku koju je Saša dovukao IZRAVNO s računala
// (desni okvir "Dokumenti za ovu ponudu", Sašin izričit zahtjev — "mogu li
// napraviti drag and drop izvan preglednika, da uhvatim na desktopu i
// prebacim tu?") i sprema je u klijentov poddirektorij unutar "PONUDE" (isti
// obrazac imenovanja foldera kao adminExportKlijent(), samo pod sub.ponude
// umjesto sub.potencijalniKlijenti — jer dokument pripada KONKRETNOJ ponudi,
// ne izvornom upitniku). Vraća {id, name, url} — pozivatelj (InTime_Admin.html)
// tu stavku sam dodaje u JSON popis polja "dokumenti_ponude" (opći popis
// "Ostali dokumenti") ILI u jedno od tri fiksna polja i sprema ga kroz
// postojeći adminUpdateFields.
//
// ISPRAVAK (22.9.2026., deveti krug — Sašin izričit zahtjev: "prilozi
// analitički cjenik i cjenik hrvatska nisi opet stavila u dobar direktorij
// ... jedna kopija u direktoriju ispred, to ispred ne treba, samo u
// direktoriju ponude treba"): dokument uploadan IZRAVNO za jedno od TRI
// FIKSNA POLJA (analitički cjenik/cjenik Hrvatska/ponuda za suradnju,
// prepoznaje se po novom parametru `zaFiksnoPolje` koji klijent šalje SAMO
// za ta tri slota) sad se sprema u zaseban, interni poddirektorij
// "_INTERNO - privremeni uploadi" unutar klijentovog osnovnog direktorija,
// NE izravno u njega — jer se taj isti dokument odmah zatim (automatska
// priprema) kopira i preimenuje u pravi direktorij ponude
// (adminPripremiDokumenteZaPonudu), pa je originalni upload ovdje samo
// privremeni "izvor" za kopiranje, ne treba biti vidljiv među pravim
// dokumentima klijenta. "Ostali dokumenti" (bez `zaFiksnoPolje`) i dalje idu
// izravno u klijentov osnovni direktorij, kao staging popis za odabir —
// to je nepromijenjeno, namjerno ostaje tako.
function adminUploadPonudaDokument(token, rowIndex, base64Data, mimeType, filename, zaFiksnoPolje) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  if (!base64Data || !filename) { return { status: 'error', message: 'Nedostaje datoteka za slanje.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  try {
    var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
    var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
    var naziv = (row[header.indexOf('Naziv tvrtke')] || '').toString().trim() || '(bez naziva)';
    var oib = (row[header.indexOf('OIB')] || '').toString().trim() || '(bez OIB-a)';
    var grad = (row[header.indexOf('Mjesto')] || '').toString().trim().toUpperCase() || '(bez mjesta)';
    var folderName = 'PONUDA - ' + naziv + ' - ' + oib + ' - ' + grad;

    var sub = getSustavSubfolders_();
    var klijentFolder = getOrCreateChildFolder_(sub.ponude, folderName);
    var ciljFolder = zaFiksnoPolje ? getOrCreateChildFolder_(klijentFolder, '_INTERNO - privremeni uploadi') : klijentFolder;

    var bytes = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', filename);
    var file = ciljFolder.createFile(blob);
    return { status: 'ok', id: file.getId(), name: file.getName(), url: file.getUrl() };
  } catch (err) {
    return { status: 'error', message: 'Slanje datoteke nije uspjelo: ' + err.message };
  }
}

// Izvlači "čisti naziv" dokumenta iz Sašinog dogovorenog obrasca imenovanja
// u "Osnovna dokumentacija" (Sašin izričit zahtjev, 21.9.2026., vidi
// claude/dokumenti-ponude-plan.md u Projectu): skida fiksni prefiks
// "InTime d.o.o. - " (prihvaća i "In Time d.o.o. - ", razmaknuti oblik, radi
// sigurnosti), pa ako u ostatku postoji JOŠ jedna " - ", zadrži SAMO dio
// IZMEĐU prve i druge crtice — sve od druge crtice nadalje je Sašina
// INTERNA napomena (npr. koja zemlja/koji postotak popusta), NIKAD ne ide
// klijentu. Ako druge crtice nema, zadrži cijeli ostatak. Radi na PUNOM
// imenu datoteke (uključujući ekstenziju) — ekstenzija se čuva i vraća na
// kraju rezultata. Koristi se SAMO za opći popis "Ostali dokumenti" — sva
// tri fiksna polja (analitički cjenik/cjenik Hrvatska/ponuda za suradnju)
// ovo pravilo namjerno NE koriste (vidi adminPripremiDokumenteZaPonudu niže,
// grana `stavka.fiksniNaziv`).
function izvuciCistNaziv_(imeDatoteke) {
  imeDatoteke = String(imeDatoteke || '');
  var ext = '';
  var dotIdx = imeDatoteke.lastIndexOf('.');
  var baza = imeDatoteke;
  if (dotIdx > 0) {
    baza = imeDatoteke.substring(0, dotIdx);
    ext = imeDatoteke.substring(dotIdx);
  }
  var prefiksi = ['InTime d.o.o. - ', 'In Time d.o.o. - '];
  for (var i = 0; i < prefiksi.length; i++) {
    if (baza.indexOf(prefiksi[i]) === 0) {
      baza = baza.substring(prefiksi[i].length);
      break;
    }
  }
  var drugaCrtica = baza.indexOf(' - ');
  if (drugaCrtica !== -1) { baza = baza.substring(0, drugaCrtica); }
  baza = baza.trim();
  return (baza || imeDatoteke) + ext;
}

// Priprema Drive poddirektorij za TRENUTNU verziju ponude (Sašin izričit
// zahtjev, 21.9.2026., puni dizajn u claude/dokumenti-ponude-plan.md) —
// kopira i preimenuje SVE odabrane dokumente (opći popis "Ostali dokumenti"
// + sva tri fiksna polja, sve zajedno šalje InTime_Admin.html kao `stavke`),
// stavlja poddirektorij na javno dijeljenje (bilo tko s linkom, samo
// pregled), i gasi dijeljenje na PRETHODNOM poddirektoriju te ponude ako se
// verzija u međuvremenu promijenila ("Generiraj novu ponudu") — stari link
// koji je klijent dobio time prestaje raditi. Svaka stavka u `stavke`:
// {id: <Drive ID izvorne datoteke>, fiksniNaziv: <opcionalno, samo za 3
// fiksna polja>}. Broj ponude (uklj. "-P{N}" verziju) računa se OVDJE,
// SERVERSKI, istom formulom kao {{BROJ_PONUDE}} tag (renderMailTekst_ u
// InTime_Admin.html) — jedan izvor istine, klijent ga ne šalje. Vraća
// {status, link}. Poziva se klikom na "📁 Pripremi direktorij i link" u
// bloku "Dokumenti za ponudu".
function adminPripremiDokumenteZaPonudu(token, rowIndex, stavke) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  if (!stavke || !stavke.length) { return { status: 'error', message: 'Nije odabran nijedan dokument — dodaj barem jedan prije pripreme direktorija.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  try {
    var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
    var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
    var naziv = (row[header.indexOf('Naziv tvrtke')] || '').toString().trim() || '(bez naziva)';
    var oib = (row[header.indexOf('OIB')] || '').toString().trim() || '(bez OIB-a)';
    var grad = (row[header.indexOf('Mjesto')] || '').toString().trim().toUpperCase() || '(bez mjesta)';

    var sifraSirova = (row[header.indexOf(ADMIN_ONLY_FIELDS.sifra_ponude)] || '').toString().trim();
    if (!sifraSirova) { return { status: 'error', message: 'Prvo potvrdi INTRIX šifru ponude (gore, "✓ Potvrdi") — bez nje se direktorij ne može imenovati.' }; }
    var verzijaCol = header.indexOf(ADMIN_ONLY_FIELDS.ponuda_verzija);
    var verzija = (verzijaCol !== -1 && parseInt(row[verzijaCol], 10)) || 1;
    var brojPonude = sifraSirova + '-P' + verzija;

    var sub = getSustavSubfolders_();
    var klijentFolderName = 'PONUDA - ' + naziv + ' - ' + oib + ' - ' + grad;
    var klijentFolder = getOrCreateChildFolder_(sub.ponude, klijentFolderName);
    var verzijaFolderName = brojPonude + ' - ' + naziv + ' - ' + oib + ' - ' + grad;
    // Sašin izričit zahtjev (22.9.2026.) — verzijaFolder je odsad "predirektorij"
    // TE KONKRETNE ponude: direktno u njemu žive dokumenti koje klijent NE
    // smije vidjeti (Analitički cjenik, Cjenik Hrvatska, kopija Ponude za
    // suradnju, Potvrda prihvaćanja/Odbijanja — te dvije stvara
    // stvoriDokumentPotvrdePonude_/stvoriDokumentOdbijanjaPonude_ niže, ciljaju
    // isti ovaj direktorij bez promjene — i Evidencija slanja, vidi
    // stvoriEvidencijuSlanja_ niže). Dokumenti KOJI IDU klijentu kopiraju se u
    // poddirektorij "POSLANO - ..." unutar njega — SAMO taj poddirektorij se
    // dijeli linkom ({{LINK_DOKUMENTI}}), verzijaFolder sam ostaje privatan.
    var verzijaFolder = getOrCreateVerzijaFolder_(klijentFolder, verzijaFolderName);

    // Poddirektorij "POSLANO - DATUM - ..." — ID mora ostati STABILAN kroz
    // ponovljene pripreme (isti direktorij se dijeli linkom, a gašenje/
    // vraćanje linka niže pamti taj ID), pa se ne traži po punom imenu (datum
    // bi svaki put bio drukčiji) nego po prefiksu "POSLANO - ", a ime se samo
    // osvježi (setName) na trenutni datum.
    var poslanoFolder = null;
    var djecaFolderi = verzijaFolder.getFolders();
    while (djecaFolderi.hasNext()) {
      var kandidatFolder = djecaFolderi.next();
      if (kandidatFolder.getName().indexOf('POSLANO - ') === 0) { poslanoFolder = kandidatFolder; break; }
    }
    var datumPripremeStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy.');
    var poslanoFolderNaziv = 'POSLANO - ' + datumPripremeStr + ' - ' + brojPonude + ' - ' + naziv + ' - ' + grad;
    if (!poslanoFolder) {
      poslanoFolder = verzijaFolder.createFolder(poslanoFolderNaziv);
    } else if (poslanoFolder.getName() !== poslanoFolderNaziv) {
      poslanoFolder.setName(poslanoFolderNaziv);
    }

    // Ponovno pokretanje za ISTU verziju (npr. naknadno dodan/zamijenjen
    // dokument — uklj. automatsko pokretanje pri svakoj promjeni fiksnog
    // polja) ne smije gomilati stare kopije — očisti DATOTEKE direktno u
    // predirektoriju (ne dira poddirektorij POSLANO) i sve unutar POSLANO
    // prije ponovnog kopiranja.
    var staraDjecaPredirektorij = verzijaFolder.getFiles();
    while (staraDjecaPredirektorij.hasNext()) { staraDjecaPredirektorij.next().setTrashed(true); }
    var staraDjecaPoslano = poslanoFolder.getFiles();
    while (staraDjecaPoslano.hasNext()) { staraDjecaPoslano.next().setTrashed(true); }

    stavke.forEach(function(stavka) {
      if (!stavka || !stavka.id) { return; }
      var izvorFile;
      try { izvorFile = DriveApp.getFileById(stavka.id); } catch (errNadji) { return; }
      var originalIme = izvorFile.getName();
      var noviNaziv;
      if (stavka.fiksniNaziv) {
        var ext = '';
        var dotIdx = originalIme.lastIndexOf('.');
        if (dotIdx > 0) { ext = originalIme.substring(dotIdx); }
        noviNaziv = brojPonude + ' - ' + naziv + ' - ' + grad + ' - ' + stavka.fiksniNaziv + ext;
      } else {
        noviNaziv = brojPonude + ' - ' + naziv + ' - ' + grad + ' - ' + izvuciCistNaziv_(originalIme);
      }
      var slot = stavka.slotKljuc || 'ostalo';
      if (slot === 'analiticki' || slot === 'cjenikhr') {
        // Interni dokumenti — SAMO u predirektoriju, klijent ih ne smije vidjeti.
        izvorFile.makeCopy(noviNaziv, verzijaFolder);
      } else if (slot === 'ponudasuradnja') {
        // Sama ponuda ide na OBA mjesta — klijentu (POSLANO) i u internu arhivu (predirektorij).
        izvorFile.makeCopy(noviNaziv, verzijaFolder);
        izvorFile.makeCopy(noviNaziv, poslanoFolder);
      } else {
        // "Ostali dokumenti" — samo ono što se stvarno šalje klijentu.
        izvorFile.makeCopy(noviNaziv, poslanoFolder);
      }
    });

    poslanoFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var noviFolderId = poslanoFolder.getId();
    var noviLink = poslanoFolder.getUrl();

    var aktivniCol = header.indexOf(ADMIN_ONLY_FIELDS.aktivni_folder_dokumenti_id);
    var linkCol = header.indexOf(ADMIN_ONLY_FIELDS.link_dokumenti_ponude);
    var predirektorijLinkCol = header.indexOf(ADMIN_ONLY_FIELDS.link_predirektorij_ponude);
    var staviFolderId = (aktivniCol !== -1) ? String(row[aktivniCol] || '').trim() : '';
    if (staviFolderId && staviFolderId !== noviFolderId) {
      try {
        DriveApp.getFolderById(staviFolderId).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      } catch (errStari) { /* stari folder možda ručno obrisan/premješten — zanemari */ }
    }
    if (aktivniCol !== -1) { sheet.getRange(rowIndex, aktivniCol + 1).setValue(noviFolderId); }
    if (linkCol !== -1) { sheet.getRange(rowIndex, linkCol + 1).setValue(noviLink); }
    // Poveznica na PREDIREKTORIJ (interni, "cijela ponuda" — vidi napomenu uz
    // ADMIN_ONLY_FIELDS.link_predirektorij_ponude) — NIKAD se ne dijeli
    // javno, samo Saša do nje dolazi kroz admin sučelje (prijavljen na svoj
    // Google račun s pristupom kontrolnom centru).
    if (predirektorijLinkCol !== -1) { sheet.getRange(rowIndex, predirektorijLinkCol + 1).setValue(verzijaFolder.getUrl()); }

    return { status: 'ok', link: noviLink, broj: stavke.length };
  } catch (err) {
    return { status: 'error', message: 'Priprema direktorija nije uspjela: ' + err.message };
  }
}

// ============================================================
// POTVRDA PONUDE (klijent klikom na poveznicu iz maila potvrđuje
// prihvaćanje) — InTime_PotvrdaPonude.html
//
// Sašin izričit zahtjev (20.9.2026.): "možemo li u template nekako ugraditi
// mogućnost da ide link i kad klikne na potvrđujem unese OIB firme kao
// potvrdu da se pošalje povratna informacija natrag u sustav... da ne moram
// čekati povratni mail" — pa naknadno, na pitanje o jačini dokaza: "OIB +
// ime/funkcija + zapis" (Google dokument u klijentovom Drive folderu + mail
// obavijest Saši), token se generira AUTOMATSKI (vidi adminListEntries()
// gore), poveznica je JEDNOKRATNA (nakon prve uspješne potvrde se
// zaključava — ponovni pokušaj samo javlja da je već potvrđeno).
//
// Tok: (1) token se automatski generira i sprema čim zapis uđe u "Ponude"
// (adminListEntries() gore); (2) admin u mail predlošku koristi tag
// {{LINK_POTVRDE}} (renderMailTekst_ u InTime_Admin.html), koji se
// pretvara u POTVRDA_PONUDE_STRANICA_URL + '?token=...'; (3) klijent otvori
// tu poveznicu — InTime_PotvrdaPonude.html prvo zove potvrdaPonudeInfo()
// (samo naziv tvrtke + je li već potvrđeno, BEZ ičeg osjetljivog, token nije
// tajna lozinka nego samo "teško pogodiva" poveznica); (4) klijent unese OIB
// tvrtke + ime/prezime + funkciju i potvrdi checkbox ovlaštenja, stranica
// zove potvrdiPonudu() — SERVER (ne klijent) provjerava da uneseni OIB
// odgovara OIB-u tvrtke iz tog retka; (5) kod uspjeha: automatski se
// postavlja "Datum prihvaćanja ponude (admin)" (isto polje koje Saša danas
// ručno upisuje), stvara se Google dokument "Potvrda prihvaćanja ponude" u
// klijentovom PONUDE/... Drive folderu (trajan trag), i šalje mail Saši s
// detaljima potvrde. Ni stvaranje dokumenta ni slanje maila NE smiju srušiti
// samu potvrdu ako padnu (umotano u try/catch) — potvrda u Sheetu je uvijek
// prioritet.
// ============================================================

// Čitljivi hrvatski opis statusa ponude — koristi se u porukama grešaka
// (adminPostaviRokPonude/adminGenerirajNovuPonudu/adminPonistiPonudu niže).
var OPIS_STATUSA_PONUDE_ = {
  nije_poslano: 'još nije poslana',
  na_cekanju: 'na čekanju odgovora',
  potvrdjena: 'prihvaćena',
  odbijena: 'odbijena',
  ponistena: 'poništena',
  istekla: 'istekla',
  ponistena_nakon_prihvata: 'poništena nakon prihvaćanja'
};

// JEDINO mjesto koje računa status ponude iz sirovih stupaca — Sašin
// izričit zahtjev (20.9.2026., dvadeset i treći krug: "generiraj novu
// ponudu... ako odbiju ponudu... ručna opcija da ja poništim ponudu").
// `header`/`row` su sirovi nizovi kakve vraća sheet.getRange(...).getValues()
// (vrijednosti datumskih stupaca su Date objekti, ne formatirani stringovi)
// — koristi se i u javnim funkcijama (preko pronadjiRedakPoTokenuPotvrde_)
// i u admin funkcijama (koje redak čitaju izravno). Redoslijed provjera je
// namjeran: jednom kad je ponuda potvrđena/odbijena/poništena, taj status je
// TRAJAN (ne mijenja se natrag u 'istekla' ako je npr. rok u međuvremenu
// prošao) — samo "Generiraj novu ponudu" otvara novi ciklus.
function izracunajStatusPonude_(header, row) {
  var get = function(label) {
    var idx = header.indexOf(label);
    return idx === -1 ? null : row[idx];
  };
  // MORA biti provjereno PRIJE 'potvrdjena' — kad Saša poništi VEĆ
  // prihvaćenu ponudu (adminPonistiPrihvacenuPonudu niže), polje "Datum
  // prihvaćanja ponude (admin)" NAMJERNO ostaje popunjeno (trag da JE bilo
  // prihvaćeno), pa bez ovog prioriteta status bi i dalje ispao 'potvrdjena'.
  if (get('Datum poništenja prihvaćene ponude (admin)')) { return 'ponistena_nakon_prihvata'; }
  if (get('Datum prihvaćanja ponude (admin)')) { return 'potvrdjena'; }
  if (get('Datum odbijanja ponude (admin)')) { return 'odbijena'; }
  if (get('Datum poništenja ponude (admin)')) { return 'ponistena'; }
  if (!get('Datum slanja aktivne ponude (admin)')) { return 'nije_poslano'; }
  var istek = get('Datum isteka ponude (admin)');
  if (istek instanceof Date && istek.getTime() < Date.now()) { return 'istekla'; }
  return 'na_cekanju';
}

// Formatira vrijednost datumskog stupca (Date objekt ILI već formatirani
// string, ovisno odakle se čita) na jedinstven način "dd.MM.yyyy. HH:mm" —
// mala pomoćna funkcija da se ista dva retka koda ne ponavljaju na više
// mjesta (potvrdaPonudeInfo/potvrdiPonudu/odbijPonudu niže).
function formatDatumPolja_(v) {
  if (!v) { return ''; }
  return (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm') : String(v);
}

// Pronalazi redak po tokenu za POTVRDU PONUDE (odvojeno od
// pronadjiRedakPoTokenu_ iznad, koji je za "Ispravak podataka" — različiti
// stupci, različita svrha, namjerno zasebna funkcija da se dvije stvari ne
// pomiješaju).
function pronadjiRedakPoTokenuPotvrde_(token) {
  if (!token) { return null; }
  var sheet = getOrCreateUpitiSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return null; }
  var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
  var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var tokenCol = header.indexOf('Token za potvrdu ponude (admin)');
  if (tokenCol === -1) { return null; }
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][tokenCol] && String(data[i][tokenCol]) === String(token)) {
      return { rowIndex: i + 2, header: header, row: data[i] };
    }
  }
  return null;
}

// Javna (bez admin tokena) — InTime_PotvrdaPonude.html zove ovo ODMAH kod
// otvaranja poveznice, prije prikaza obrasca. Vraća samo naziv tvrtke (da
// klijent zna da je na pravoj ponudi) i je li već potvrđeno — nikad ništa
// osjetljivo (OIB, iznose, usluge i sl.).
function potvrdaPonudeInfo(token) {
  var found = pronadjiRedakPoTokenuPotvrde_(token);
  if (!found) { return { status: 'error', message: 'Poveznica nije ispravna ili je istekla. Provjerite jeste li je u cijelosti kopirali iz e-maila, ili nas kontaktirajte na sbatinac.intime@gmail.com.' }; }
  var naziv = String(found.row[found.header.indexOf('Naziv tvrtke')] || '').trim() || '(bez naziva)';
  var stanje = izracunajStatusPonude_(found.header, found.row);
  if (stanje === 'potvrdjena') {
    var datumStr = formatDatumPolja_(found.row[found.header.indexOf('Datum prihvaćanja ponude (admin)')]);
    // Sašin izričit zahtjev (20.9.2026., dvadeset i četvrti krug): ponuda se
    // može poslati na VIŠE mail adresa iste tvrtke, pa ako netko DRUGI otvori
    // istu poveznicu NAKON što je već netko potvrdio, treba mu jasno pisati
    // TKO je i KADA potvrdio (ime/prezime, funkcija, točno vrijeme, IP
    // adresa) — ne samo datum. Isti podaci koji su već admin-only vidljivi
    // Saši (buildPotvrdaInfoBlok_ u InTime_Admin.html), sad se vraćaju i
    // javno kroz ovu funkciju (namjerno se NE vraća OIB — to ostaje admin-only).
    var potvrdioIme = String(found.row[found.header.indexOf('Ime i prezime osobe koja je potvrdila ponudu (admin)')] || '').trim();
    var potvrdioFunkcija = String(found.row[found.header.indexOf('Funkcija osobe koja je potvrdila ponudu (admin)')] || '').trim();
    var potvrdioIp = String(found.row[found.header.indexOf('IP adresa prilikom potvrde ponude (admin)')] || '').trim();
    return {
      status: 'ok',
      nazivTvrtke: naziv,
      vecPotvrdjeno: true,
      datumPotvrde: datumStr,
      potvrdioIme: potvrdioIme,
      potvrdioFunkcija: potvrdioFunkcija,
      potvrdioIp: potvrdioIp
    };
  }
  // Sašin izričit zahtjev (20.9.2026., dvadeset i treći krug): "gumb za
  // odbijanje ponude" — klijent koji ponovno otvori poveznicu NAKON što je
  // (ranije, ili netko drugi na istoj poveznici) kliknuo "Odbijam ponudu"
  // vidi jasnu poruku umjesto obrasca, isto kao kod već potvrđene ponude.
  if (stanje === 'odbijena') {
    return {
      status: 'ok',
      nazivTvrtke: naziv,
      odbijena: true,
      datumOdbijanja: formatDatumPolja_(found.row[found.header.indexOf('Datum odbijanja ponude (admin)')])
    };
  }
  // Saša je RUČNO poništio ponudu (adminPonistiPonudu niže) — poveznica
  // ostaje "mrtva" dok ne generira novu, koja dolazi s NOVIM tokenom.
  if (stanje === 'ponistena') {
    return { status: 'ok', nazivTvrtke: naziv, ponistena: true };
  }
  // Saša je poništio VEĆ prihvaćenu ponudu (sigurnosni okidač, dvadeset i
  // sedmi krug) — poveznica prestaje raditi kao i kod obične poništene, ali
  // klijentskoj strani se javlja poseban flag da ispiše ispravljenu poruku
  // (ne "ponuda je poništena", nego jasno da JE bila prihvaćena, a
  // naknadno povučena, jer je klijent to očekivano zbunjujuće — vidi
  // InTime_PotvrdaPonude.html).
  if (stanje === 'ponistena_nakon_prihvata') {
    return { status: 'ok', nazivTvrtke: naziv, ponistena: true, ponistenaNakonPrihvata: true };
  }
  // Rok važenja ponude (Sašin izričit zahtjev, dvadeset i drugi krug) — vraća
  // se klijentu SAMO kao datum isteka (ISO za brojač na stranici + čitljiv
  // prikaz), NIKAD kao razlog za sakrivanje ostatka odgovora. Ako rok nije
  // postavljen (istekCol prazan), ponuda se tretira kao da nema roka —
  // stariji zapisi (prije ove nadogradnje) i dalje rade bez ograničenja.
  var istekCol = found.header.indexOf('Datum isteka ponude (admin)');
  var istekVrijednost = (istekCol !== -1) ? found.row[istekCol] : null;
  if (istekVrijednost instanceof Date) {
    return {
      status: 'ok',
      nazivTvrtke: naziv,
      vecPotvrdjeno: false,
      istekIso: istekVrijednost.toISOString(),
      istekPrikaz: Utilities.formatDate(istekVrijednost, Session.getScriptTimeZone(), 'dd.MM.yyyy.'),
      istekla: (stanje === 'istekla')
    };
  }
  return { status: 'ok', nazivTvrtke: naziv, vecPotvrdjeno: false };
}

// Stvarna potvrda — SERVER je autoritet za provjeru OIB-a, klijentska strana
// (InTime_PotvrdaPonude.html) je samo UX. `ipAdresa` je ono što je klijentov
// preglednik javio (Apps Script doPost(e) nema izravan pristup IP adresi
// pošiljatelja) — vidi opširnu napomenu uz ADMIN_ONLY_FIELDS.potvrda_ip_adresa.
function potvrdiPonudu(token, oib, imeOsobe, funkcijaOsobe, ipAdresa) {
  var found = pronadjiRedakPoTokenuPotvrde_(token);
  if (!found) { return { status: 'error', message: 'Poveznica nije ispravna ili je istekla. Kontaktirajte nas na sbatinac.intime@gmail.com.' }; }
  var header = found.header, row = found.row, rowIndex = found.rowIndex;
  var datumCol = header.indexOf('Datum prihvaćanja ponude (admin)');
  if (datumCol === -1) { return { status: 'error', message: 'Sustavna greška — stupac za datum prihvaćanja ne postoji. Kontaktirajte nas na sbatinac.intime@gmail.com.' }; }
  // Sašin izričit zahtjev (20.9.2026., dvadeset i treći krug): jedan te isti
  // status-helper odlučuje smije li se potvrditi — pokriva i nove slučajeve
  // (ranije odbijena/poništena ponuda), ne samo već-potvrđenu i isteklu kao
  // dosad.
  var stanje = izracunajStatusPonude_(header, row);
  if (stanje === 'potvrdjena') {
    var vecDatumStr = formatDatumPolja_(row[datumCol]);
    return { status: 'error', vecPotvrdjeno: true, datumPotvrde: vecDatumStr, message: 'Ova ponuda je već potvrđena ' + vecDatumStr + '.' };
  }
  if (stanje === 'odbijena') {
    return { status: 'error', odbijena: true, message: 'Ova ponuda je već odbijena — ne može se naknadno potvrditi ovom poveznicom. Kontaktirajte nas na sbatinac.intime@gmail.com ako je ovo greška.' };
  }
  if (stanje === 'ponistena' || stanje === 'ponistena_nakon_prihvata') {
    return { status: 'error', message: 'Ova poveznica trenutno nije aktivna. Kontaktirajte nas na sbatinac.intime@gmail.com.' };
  }
  // Rok važenja — SERVER je autoritet (klijentska stranica samo prikazuje
  // brojač/blokira obrazac kao UX, vidi potvrdaPonudeInfo() gore). Ako je
  // istekla, potvrda se odbija ovdje bez obzira što klijent pošalje — Saša
  // je jedini koji je može ponovno "otključati" klikom na "Postavi rok" u
  // adminu (adminPostaviRokPonude() gore), koji uvijek računa novi rok od
  // TRENUTNOG trenutka.
  var istekCol = header.indexOf('Datum isteka ponude (admin)');
  if (stanje === 'istekla') {
    var istekDatumStr = Utilities.formatDate(row[istekCol], Session.getScriptTimeZone(), 'dd.MM.yyyy.');
    return { status: 'error', istekla: true, message: 'Ova ponuda je istekla ' + istekDatumStr + '. Kontaktirajte nas na sbatinac.intime@gmail.com za produženje roka.' };
  }
  var stvarniOib = String(row[header.indexOf('OIB')] || '').trim();
  var uneseniOib = String(oib || '').trim();
  if (!stvarniOib || !uneseniOib || uneseniOib !== stvarniOib) {
    return { status: 'error', message: 'Uneseni OIB ne odgovara OIB-u tvrtke iz ove ponude. Provjerite unos i pokušajte ponovno.' };
  }
  imeOsobe = String(imeOsobe || '').trim();
  funkcijaOsobe = String(funkcijaOsobe || '').trim();
  if (!imeOsobe || !funkcijaOsobe) {
    return { status: 'error', message: 'Ime i prezime te funkcija su obavezni.' };
  }

  var sheet = getOrCreateUpitiSheet();
  var sada = new Date();
  sheet.getRange(rowIndex, datumCol + 1).setValue(sada);
  var imeCol = header.indexOf('Ime i prezime osobe koja je potvrdila ponudu (admin)');
  var funkcijaCol = header.indexOf('Funkcija osobe koja je potvrdila ponudu (admin)');
  var ipCol = header.indexOf('IP adresa prilikom potvrde ponude (admin)');
  var dokCol = header.indexOf('Poveznica na dokument potvrde ponude (admin)');
  ipAdresa = String(ipAdresa || '').trim();
  if (imeCol !== -1) { sheet.getRange(rowIndex, imeCol + 1).setValue(imeOsobe); }
  if (funkcijaCol !== -1) { sheet.getRange(rowIndex, funkcijaCol + 1).setValue(funkcijaOsobe); }
  if (ipCol !== -1) { sheet.getRange(rowIndex, ipCol + 1).setValue(ipAdresa); }

  var naziv = String(row[header.indexOf('Naziv tvrtke')] || '').trim() || '(bez naziva)';
  var grad = String(row[header.indexOf('Mjesto')] || '').trim() || '(bez mjesta)';

  // brojPonude (23. krug, "svaki dokument treba biti unutar direktorija
  // svoje ponude") — ista formula kao u adminPripremiDokumenteZaPonudu
  // gore: INTRIX šifra + "-P" + redni broj slanja. Ako šifra još nije
  // potvrđena (sifraSirova prazan), brojPonude ostaje '' i
  // stvoriDokumentPotvrdePonude_ pada natrag na STARO ponašanje (dokument
  // u klijentov osnovni direktorij) — sigurno, nikad ne ruši potvrdu.
  var sifraSirovaPotvrda_ = (row[header.indexOf(ADMIN_ONLY_FIELDS.sifra_ponude)] || '').toString().trim();
  var verzijaColPotvrda_ = header.indexOf(ADMIN_ONLY_FIELDS.ponuda_verzija);
  var verzijaPotvrda_ = (verzijaColPotvrda_ !== -1 && parseInt(row[verzijaColPotvrda_], 10)) || 1;
  var brojPonudePotvrda_ = sifraSirovaPotvrda_ ? (sifraSirovaPotvrda_ + '-P' + verzijaPotvrda_) : '';

  var dokUrl = '';
  try {
    dokUrl = stvoriDokumentPotvrdePonude_(naziv, stvarniOib, grad, imeOsobe, funkcijaOsobe, ipAdresa, sada, brojPonudePotvrda_);
    if (dokCol !== -1 && dokUrl) { sheet.getRange(rowIndex, dokCol + 1).setValue(dokUrl); }
  } catch (err) {
    // Stvaranje dokumenta NIKAD ne smije srušiti samu potvrdu — potvrda u
    // Sheetu (datum prihvaćanja + OIB provjera) je već zabilježena gore.
  }

  try {
    posaljiMailPotvrdePonude_(naziv, stvarniOib, grad, imeOsobe, funkcijaOsobe, ipAdresa, sada, dokUrl);
  } catch (err) {
    // Isto — mail obavijest Saši ne smije srušiti samu potvrdu.
  }

  return { status: 'ok', datumPotvrde: Utilities.formatDate(sada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm') };
}

// Trajan "papirnati trag" potvrde — Google dokument unutar poddirektorija
// TE KONKRETNE VERZIJE ponude (Sašin izričit zahtjev, 23. krug: "svaki
// dokument treba biti unutar direktorija SVOJE ponude" — dokument potvrde
// ide u direktorij verzije koja je prihvaćena, dokument odbijanja (niže) u
// direktorij verzije koja je odbijena, NE u zajednički klijentov osnovni
// direktorij). Isti obrazac imena poddirektorija kao
// adminPripremiDokumenteZaPonudu ('{brojPonude} - Naziv - OIB - GRAD',
// unutar 'PONUDA - Naziv - OIB - GRAD') — mora se PODUDARATI da dokument
// završi u ISTOM poddirektoriju koji klijent već ima (dijeljen preko
// {{LINK_DOKUMENTI}}), ne u nekom trećem. Ako poddirektorij verzije iz nekog
// razloga još ne postoji (npr. Saša nikad nije kliknuo "Pripremi direktorij"
// za tu verziju), stvara se prazan — bolje nego izgubiti zapis potvrde.
function stvoriDokumentPotvrdePonude_(naziv, oib, grad, imeOsobe, funkcijaOsobe, ipAdresa, kada, brojPonude) {
  // Grad UVIJEK velikim slovima u NAZIVU foldera (mora se poklapati s
  // folderName iz adminUploadPonudaDokument/adminPripremiDokumenteZaPonudu,
  // inače nastaju DVA foldera za istog klijenta). Tijelo dokumenta ispod i
  // dalje koristi izvorni 'grad' (čitljiv tekst), samo naziv foldera je
  // velikim slovima.
  var gradZaNaziv = (grad && grad !== '(bez mjesta)') ? grad.toUpperCase() : grad;
  var klijentFolderName = 'PONUDA - ' + naziv + ' - ' + oib + ' - ' + gradZaNaziv;
  var sub = getSustavSubfolders_();
  var klijentFolder = getOrCreateChildFolder_(sub.ponude, klijentFolderName);
  var ciljniFolder = klijentFolder;
  if (brojPonude) {
    var verzijaFolderName = brojPonude + ' - ' + naziv + ' - ' + oib + ' - ' + gradZaNaziv;
    ciljniFolder = getOrCreateVerzijaFolder_(klijentFolder, verzijaFolderName);
    // Sašin izričit zahtjev (22.9.2026., deveti krug): čim je ponuda
    // prihvaćena, direktorij TE VERZIJE odmah dobiva sufiks "- PRIHVAĆENA" u
    // nazivu — na prvi pogled u Google Driveu jasno koja je ponuda
    // prihvaćena, bez otvaranja svakog foldera. getOrCreateVerzijaFolder_
    // iznad je tolerantan na ovaj sufiks, pa sljedeći pozivi po formuli
    // (npr. "Pripremi direktorij") i dalje pronalaze ISTI folder.
    if (ciljniFolder.getName().indexOf(' - PRIHVAĆENA') === -1) {
      ciljniFolder.setName(ciljniFolder.getName() + ' - PRIHVAĆENA');
    }
  }

  var docNaziv = 'POTVRDA PRIHVAĆANJA PONUDE - ' + naziv + ' - ' + oib;
  // Ako iz nekog razloga već postoji stariji dokument istog imena (npr.
  // ručni test), ukloni ga da se ne gomilaju kopije — isti princip kao kod
  // exporta podataka.
  var postojeci = ciljniFolder.getFilesByName(docNaziv);
  while (postojeci.hasNext()) { postojeci.next().setTrashed(true); }

  var doc = DocumentApp.create(docNaziv);
  var body = doc.getBody();
  body.appendParagraph('Potvrda prihvaćanja ponude').setHeading(DocumentApp.ParagraphHeading.TITLE);
  // Sašin izričit zahtjev (22.9.2026., deveti krug): broj ponude mora biti
  // vidljiv U SAMOM dokumentu, ne samo u nazivu direktorija/datoteke.
  body.appendParagraph('Broj ponude: ' + (brojPonude || '(nepoznat)'));
  body.appendParagraph('Naziv tvrtke: ' + naziv);
  body.appendParagraph('OIB: ' + oib);
  body.appendParagraph('Mjesto: ' + grad);
  body.appendParagraph('Ponudu je potvrdio/la: ' + imeOsobe);
  body.appendParagraph('Funkcija: ' + funkcijaOsobe);
  body.appendParagraph('Datum i vrijeme potvrde: ' + Utilities.formatDate(kada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm:ss'));
  body.appendParagraph('IP adresa prilikom potvrde: ' + (ipAdresa || '(nije dostupna)'));
  body.appendParagraph('Potvrđeno klikom na poveznicu za potvrdu ponude (InTime_PotvrdaPonude.html), unosom OIB-a tvrtke te uz izričitu izjavu da je gore navedena osoba ovlaštena prihvatiti ovu ponudu u ime tvrtke.');
  doc.saveAndClose();

  var file = DriveApp.getFileById(doc.getId());
  ciljniFolder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  return file.getUrl();
}

// Trajan "papirnati trag" ODBIJANJA — analogno stvoriDokumentPotvrdePonude_
// iznad (Sašin izričit zahtjev, 23. krug, nastavak: "svaki dokument treba
// biti unutar direktorija SVOJE ponude — ako je odbijena neka unutar se
// stvara dokument koji potvrđuje odbijanje"). Sprema se u poddirektorij TE
// KONKRETNE VERZIJE ponude (ne u zajednički klijentov osnovni direktorij, i
// NE u zasebnu granu "ODBIJENICE" — ta grana je za sasvim drugi, nezavisan
// obrazac odbijenice, vidi napomenu uz adminExportOdbijenica niže).
function stvoriDokumentOdbijanjaPonude_(naziv, oib, grad, imeOsobe, razlog, ipAdresa, kada, brojPonude) {
  var gradZaNaziv = (grad && grad !== '(bez mjesta)') ? grad.toUpperCase() : grad;
  var klijentFolderName = 'PONUDA - ' + naziv + ' - ' + oib + ' - ' + gradZaNaziv;
  var sub = getSustavSubfolders_();
  var klijentFolder = getOrCreateChildFolder_(sub.ponude, klijentFolderName);
  var ciljniFolder = klijentFolder;
  if (brojPonude) {
    var verzijaFolderName = brojPonude + ' - ' + naziv + ' - ' + oib + ' - ' + gradZaNaziv;
    ciljniFolder = getOrCreateVerzijaFolder_(klijentFolder, verzijaFolderName);
  }

  var docNaziv = 'ODBIJANJE PONUDE - ' + naziv + ' - ' + oib;
  var postojeci = ciljniFolder.getFilesByName(docNaziv);
  while (postojeci.hasNext()) { postojeci.next().setTrashed(true); }

  var doc = DocumentApp.create(docNaziv);
  var body = doc.getBody();
  body.appendParagraph('Odbijanje ponude').setHeading(DocumentApp.ParagraphHeading.TITLE);
  // Sašin izričit zahtjev (22.9.2026., deveti krug): broj ponude mora biti
  // vidljiv U SAMOM dokumentu, ne samo u nazivu direktorija/datoteke.
  body.appendParagraph('Broj ponude: ' + (brojPonude || '(nepoznat)'));
  body.appendParagraph('Naziv tvrtke: ' + naziv);
  body.appendParagraph('OIB: ' + oib);
  body.appendParagraph('Mjesto: ' + grad);
  body.appendParagraph('Ponudu je odbio/la: ' + (imeOsobe || '(nije navedeno)'));
  body.appendParagraph('Razlog odbijanja: ' + (razlog || '(nije naveden)'));
  body.appendParagraph('Datum i vrijeme odbijanja: ' + Utilities.formatDate(kada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm:ss'));
  body.appendParagraph('IP adresa prilikom odbijanja: ' + (ipAdresa || '(nije dostupna)'));
  body.appendParagraph('Zabilježeno klikom na "Odbijam ponudu" na poveznici za potvrdu ponude (InTime_PotvrdaPonude.html).');
  doc.saveAndClose();

  var file = DriveApp.getFileById(doc.getId());
  // ISPRAVAK (22.9.2026., deveti krug — Sašin izričit zahtjev): ovdje je
  // GREŠKOM stajalo klijentFolder (klijentov OSNOVNI direktorij, razina 1 —
  // "ispred" direktorij koji dijeli SVE verzije) umjesto ciljniFolder
  // (poddirektorij TE KONKRETNE VERZIJE ponude, izračunat iznad) — zbog toga
  // se dokument odbijanja pojavljivao jedan nivo previsoko, izmiješan s
  // ostalim verzijama, umjesto unutar direktorija odbijene ponude (isto
  // mjesto gdje ispravno završava dokument potvrde, vidi
  // stvoriDokumentPotvrdePonude_ iznad).
  ciljniFolder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  return file.getUrl();
}

// Mail obavijest Saši (NOTIFY_EMAIL) čim klijent potvrdi ponudu — Sašin
// izričit zahtjev uz "OIB + ime/funkcija + zapis" opciju, da odmah zna bez
// da mora ručno provjeravati admin sučelje.
function posaljiMailPotvrdePonude_(naziv, oib, grad, imeOsobe, funkcijaOsobe, ipAdresa, kada, dokUrl) {
  var datumStr = Utilities.formatDate(kada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm');
  var tijelo = 'Klijent je potvrdio prihvaćanje ponude putem poveznice iz maila.\n\n' +
    'Tvrtka: ' + naziv + '\n' +
    'OIB: ' + oib + '\n' +
    'Mjesto: ' + grad + '\n' +
    'Potvrdio/la: ' + imeOsobe + ' (' + funkcijaOsobe + ')\n' +
    'Datum i vrijeme: ' + datumStr + '\n' +
    'IP adresa: ' + (ipAdresa || '(nije dostupna)') + '\n' +
    (dokUrl ? ('\nDokument potvrde (Drive): ' + dokUrl + '\n') : '\n(Dokument potvrde nije uspio biti stvoren — provjerite ručno u admin sučelju.)\n');
  MailApp.sendEmail(NOTIFY_EMAIL, 'Ponuda potvrđena — ' + naziv, tijelo);
}

// Odbijanje ponude — Sašin izričit zahtjev (20.9.2026., dvadeset i treći
// krug): "možemo li staviti dugme za odbijanje ponude". Javna funkcija (kao
// potvrdiPonudu gore) — klijent na InTime_PotvrdaPonude.html klikne "Odbijam
// ponudu" (uz opcionalan slobodan razlog), SERVER upisuje datum + razlog i
// šalje mail obavijest Saši, isto kao kod potvrde. Za razliku od potvrde, NE
// traži se OIB/ime/funkcija — odbijanje je niže-rizična radnja (ne otvara
// nikakve obveze), a Sašin izričit prioritet je da odbijanje bude
// jednostavno zabilježiti ("bitno je da ova ponuda bude odbijena").
// NADOGRAĐENO 20.9.2026. (dvadeset i sedmi krug — "ako odbiju neka piše
// odbijeno IP adresa i tko je odbio"): dodana DVA nova, potpuno OPCIONALNA
// parametra — `imeOsobe` (klijent ga upisuje slobodno, NIJE obavezno polje
// na InTime_PotvrdaPonude.html, isti "niska trenja" princip kao dosad) i
// `ipAdresa` (klijentov preglednik ju sam dohvaća i šalje, isti mehanizam
// kao kod potvrdiPonudu() gore — vidi dohvatiIP_() u
// InTime_PotvrdaPonude.html). Ni jedno ni drugo NE mijenja postojeće
// ponašanje niže — samo se, ako stignu, upisuju.
function odbijPonudu(token, razlog, imeOsobe, ipAdresa) {
  var found = pronadjiRedakPoTokenuPotvrde_(token);
  if (!found) { return { status: 'error', message: 'Poveznica nije ispravna ili je istekla. Kontaktirajte nas na sbatinac.intime@gmail.com.' }; }
  var header = found.header, row = found.row, rowIndex = found.rowIndex;
  var stanje = izracunajStatusPonude_(header, row);
  if (stanje === 'potvrdjena') {
    return { status: 'error', vecPotvrdjeno: true, datumPotvrde: formatDatumPolja_(row[header.indexOf('Datum prihvaćanja ponude (admin)')]), message: 'Ova ponuda je već prihvaćena, ne može se naknadno odbiti. Kontaktirajte nas na sbatinac.intime@gmail.com ako je ovo greška.' };
  }
  if (stanje === 'odbijena') {
    return { status: 'error', message: 'Ova ponuda je već ranije odbijena.' };
  }
  if (stanje === 'ponistena' || stanje === 'ponistena_nakon_prihvata' || stanje === 'nije_poslano') {
    return { status: 'error', message: 'Ova poveznica trenutno nije aktivna. Kontaktirajte nas na sbatinac.intime@gmail.com.' };
  }
  // stanje je 'na_cekanju' ili 'istekla' — odbijanje je dopušteno u oba
  // slučaja (klijent koji poveznicu otvori tek nakon isteka roka i dalje
  // može zabilježiti da NE prihvaća, koristan podatak čak i bez formalnog
  // roka koji bi to inače blokirao kao kod potvrde).
  var odbijanjeCol = header.indexOf('Datum odbijanja ponude (admin)');
  var razlogCol = header.indexOf('Razlog odbijanja ponude (admin)');
  var imeOdbioCol = header.indexOf('Ime i prezime osobe koja je odbila ponudu (admin)');
  var ipOdbijanjaCol = header.indexOf('IP adresa prilikom odbijanja ponude (admin)');
  if (odbijanjeCol === -1) { return { status: 'error', message: 'Sustavna greška — stupac za datum odbijanja ne postoji. Kontaktirajte nas na sbatinac.intime@gmail.com.' }; }
  var sheet = getOrCreateUpitiSheet();
  var sada = new Date();
  sheet.getRange(rowIndex, odbijanjeCol + 1).setValue(sada);
  razlog = String(razlog || '').trim();
  if (razlogCol !== -1 && razlog) { sheet.getRange(rowIndex, razlogCol + 1).setValue(razlog); }
  imeOsobe = String(imeOsobe || '').trim();
  ipAdresa = String(ipAdresa || '').trim();
  if (imeOdbioCol !== -1 && imeOsobe) { sheet.getRange(rowIndex, imeOdbioCol + 1).setValue(imeOsobe); }
  if (ipOdbijanjaCol !== -1 && ipAdresa) { sheet.getRange(rowIndex, ipOdbijanjaCol + 1).setValue(ipAdresa); }

  var naziv = String(row[header.indexOf('Naziv tvrtke')] || '').trim() || '(bez naziva)';
  var oib = String(row[header.indexOf('OIB')] || '').trim() || '(bez OIB-a)';
  var grad = String(row[header.indexOf('Mjesto')] || '').trim() || '(bez mjesta)';
  var dokOdbijanjaCol = header.indexOf('Poveznica na dokument odbijanja ponude (admin)');

  // brojPonude (23. krug, "svaki dokument treba biti unutar direktorija
  // svoje ponude") — ista formula kao u adminPripremiDokumenteZaPonudu i
  // potvrdiPonudu iznad.
  var sifraSirovaOdbijanje_ = (row[header.indexOf(ADMIN_ONLY_FIELDS.sifra_ponude)] || '').toString().trim();
  var verzijaColOdbijanje_ = header.indexOf(ADMIN_ONLY_FIELDS.ponuda_verzija);
  var verzijaOdbijanje_ = (verzijaColOdbijanje_ !== -1 && parseInt(row[verzijaColOdbijanje_], 10)) || 1;
  var brojPonudeOdbijanje_ = sifraSirovaOdbijanje_ ? (sifraSirovaOdbijanje_ + '-P' + verzijaOdbijanje_) : '';

  // Trajan "papirnati trag" odbijanja — Google dokument UNUTAR poddirektorija
  // TE KONKRETNE VERZIJE ponude koja je odbijena (Sašin izričit zahtjev, 23.
  // krug: "isto što smo napravili kad se prihvati ponuda, da se napravi ako
  // se odbije... svaki dokument treba biti unutar direktorija svoje
  // ponude"). Vidi stvoriDokumentOdbijanjaPonude_() iznad.
  var dokOdbijanjaUrl = '';
  try {
    dokOdbijanjaUrl = stvoriDokumentOdbijanjaPonude_(naziv, oib, grad, imeOsobe, razlog, ipAdresa, sada, brojPonudeOdbijanje_);
    if (dokOdbijanjaCol !== -1 && dokOdbijanjaUrl) { sheet.getRange(rowIndex, dokOdbijanjaCol + 1).setValue(dokOdbijanjaUrl); }
  } catch (err) {
    // Stvaranje dokumenta NIKAD ne smije srušiti samo bilježenje odbijanja —
    // datum/razlog u Sheetu (gore) su već zabilježeni.
  }

  try {
    var datumStr = Utilities.formatDate(sada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm:ss');
    var tijelo = 'Klijent je odbio ponudu putem poveznice iz maila.\n\n' +
      'Tvrtka: ' + naziv + '\n' +
      'Datum i vrijeme: ' + datumStr + '\n' +
      (imeOsobe ? ('Odbio/la: ' + imeOsobe + '\n') : '(Klijent nije naveo ime i prezime.)\n') +
      'IP adresa: ' + (ipAdresa || '(nije dostupna)') + '\n' +
      (razlog ? ('Razlog (naveo klijent): ' + razlog + '\n') : '(Klijent nije naveo razlog.)\n') +
      (dokOdbijanjaUrl ? ('\nDokument odbijanja (Drive): ' + dokOdbijanjaUrl + '\n') : '\n(Dokument odbijanja nije uspio biti stvoren — provjerite ručno u admin sučelju.)\n') +
      '\nZa slanje nove ponude otvorite karticu "Ponude" u adminu i kliknite "Generiraj novu ponudu".';
    MailApp.sendEmail(NOTIFY_EMAIL, 'Ponuda odbijena — ' + naziv, tijelo);
  } catch (err) {
    // Mail obavijest ne smije srušiti samo bilježenje odbijanja.
  }

  // Automatsko gašenje linka na dokumente 30 min nakon odbijanja (23. krug,
  // nastavak, Sašin izričit zahtjev: "kad odbiju ponudu, link postane
  // private u roku 30 minuta"). NE gasi se ODMAH — Saša ostavlja prostor da
  // se link i dalje otvori kratko nakon odbijanja (npr. klijent se
  // predomisli u zadnji tren dok razgovaraju telefonom). Vidi
  // zakazniGasenjeLinkaNakonOdbijanja_() niže za puni mehanizam (zakazani
  // one-shot trigger + adminVratiLinkDokumenataOdbijenePonude() koji Saša
  // može ručno pozvati PRIJE nego što istekne, da poništi gašenje).
  try {
    var aktivniFolderColOdbijanje_ = header.indexOf(ADMIN_ONLY_FIELDS.aktivni_folder_dokumenti_id);
    var aktivniFolderIdOdbijanje_ = (aktivniFolderColOdbijanje_ !== -1) ? String(row[aktivniFolderColOdbijanje_] || '').trim() : '';
    if (aktivniFolderIdOdbijanje_) {
      zakaziGasenjeLinkaNakonOdbijanja_(rowIndex, aktivniFolderIdOdbijanje_);
    }
  } catch (err) {
    // Zakazivanje NIKAD ne smije srušiti samo bilježenje odbijanja.
  }

  return { status: 'ok', datumOdbijanja: Utilities.formatDate(sada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm') };
}

// ============================================================
// AUTOMATSKO GAŠENJE LINKA NA DOKUMENTE NAKON ODBIJANJA (23. krug, nastavak)
//
// Sašin izričit zahtjev: "kad odbiju ponudu, link postane private u roku 30
// minuta, ali ja i dalje imam mogućnost da ga odblokiram dok ne počnem
// raditi drugu ponudu — onda ga ne mogu vratiti". Mehanizam:
//
// 1. odbijPonudu() gore poziva zakaziGasenjeLinkaNakonOdbijanja_(), koja (a)
//    upiše {rowIndex, folderId, kada} u malu čekaonicu u
//    PropertiesService (Script Properties — isti obrazac kao ostale
//    perzistentne postavke u ovoj datoteci, npr. IMENIK_AUTOSYNC), i (b)
//    postavi JEDNOKRATNI (one-shot) vremenski trigger za točno 30 min
//    kasnije koji zove izvrsiZakazanoGasenjeLinkova_(). Apps Script SAM
//    briše one-shot trigger čim jednom odradi — nema gomilanja.
// 2. izvrsiZakazanoGasenjeLinkova_() (funkcija koju trigger zove) prođe
//    KOMPLETNU čekaonicu (ne samo "svoj" zapis — jednostavnije i sigurnije
//    nego oslanjati se na ID triggera), i za svaki zapis kojem je vrijeme
//    isteklo provjeri je LI TA ISTA ponuda I DALJE u stanju "odbijena" I
//    je li aktivni folder dokumenata I DALJE isti kao u trenutku
//    odbijanja — ako da, ugasi dijeljenje (PRIVATE). Ako je u međuvremenu
//    pripremljena NOVA verzija ponude (mijenja aktivni_folder_dokumenti_id
//    I resetira stanje na "na_cekanju"), gašenje se PRESKAČE (nova verzija
//    već ima svoj vlastiti, svjež link).
// 3. adminVratiLinkDokumenataOdbijenePonude() (poziva se klikom na "🔓
//    Vrati link na dokumente" u adminu) ODMAH vraća dijeljenje na
//    ANYONE_WITH_LINK i briše zapis iz čekaonice (da ga sweep kasnije ne
//    ugasi ponovno) — radi SAMO dok je ponuda i dalje u stanju "odbijena";
//    čim se krene raditi nova verzija, stanje više nije "odbijena" i gumb
//    (te ova funkcija) prestaju vrijediti — točno kako je Saša tražio.
// ============================================================

var GASENJE_LINKOVA_PROP_KEY_ = 'intime_zakazano_gasenje_linkova_v1';
var GASENJE_LINKA_KASNJENJE_MS_ = 30 * 60 * 1000; // 30 minuta

function ucitajZakazanoGasenje_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(GASENJE_LINKOVA_PROP_KEY_);
    var lista = raw ? JSON.parse(raw) : [];
    return Array.isArray(lista) ? lista : [];
  } catch (err) {
    return [];
  }
}

function spremiZakazanoGasenje_(lista) {
  try {
    PropertiesService.getScriptProperties().setProperty(GASENJE_LINKOVA_PROP_KEY_, JSON.stringify(lista));
  } catch (err) {
    // Nije kritično — u najgorem slučaju se zakazano gašenje "izgubi" i
    // link jednostavno ostane aktivan (sigurnija strana greške nego da se
    // nešto sruši).
  }
}

function zakaziGasenjeLinkaNakonOdbijanja_(rowIndex, folderId) {
  if (!folderId) { return; }
  var lista = ucitajZakazanoGasenje_();
  lista.push({ rowIndex: rowIndex, folderId: folderId, kada: new Date().getTime() + GASENJE_LINKA_KASNJENJE_MS_ });
  spremiZakazanoGasenje_(lista);
  try {
    ScriptApp.newTrigger('izvrsiZakazanoGasenjeLinkova_').timeBased().after(GASENJE_LINKA_KASNJENJE_MS_).create();
  } catch (err) {
    // Ako je dosegnut limit broja triggera (Google ograničenje po
    // korisniku/skripti) — zakazivanje jednostavno ne uspije, link ostaje
    // aktivan dulje nego planirano, ali ništa se ne ruši. Rijedak slučaj
    // (trebalo bi >20 odbijanja u kratkom razdoblju).
  }
}

// Poziva ju SAMO Apps Script trigger (vidi zakaziGasenjeLinkaNakonOdbijanja_
// iznad) — prolazi kompletnu čekaonicu, ne samo zapis vezan za trigger koji
// ju je pozvao (jednostavnije, i sigurno i kad se više triggera preklopi).
function izvrsiZakazanoGasenjeLinkova_() {
  var lista = ucitajZakazanoGasenje_();
  if (!lista.length) { return; }
  var sada = new Date().getTime();
  var preostalo = [];
  var sheet = null;
  var header = null;
  var lastCol = 0;
  lista.forEach(function(zapis) {
    if (!zapis || zapis.kada > sada) { preostalo.push(zapis); return; }
    try {
      if (!sheet) {
        sheet = getOrCreateUpitiSheet();
        var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
        lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
        header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      }
      if (zapis.rowIndex && zapis.rowIndex <= sheet.getLastRow()) {
        var row = sheet.getRange(zapis.rowIndex, 1, 1, lastCol).getValues()[0];
        var stanje = izracunajStatusPonude_(header, row);
        var aktivniCol = header.indexOf(ADMIN_ONLY_FIELDS.aktivni_folder_dokumenti_id);
        var trenutniFolderId = (aktivniCol !== -1) ? String(row[aktivniCol] || '').trim() : '';
        if (stanje === 'odbijena' && trenutniFolderId === zapis.folderId) {
          DriveApp.getFolderById(zapis.folderId).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
        }
      }
    } catch (err) {
      // Folder možda ručno obrisan/premješten, ili redak obrisan — zanemari,
      // zapis se svejedno uklanja iz čekaonice niže (bez ponavljanja).
    }
    // Obrađen zapis (uspješno ili ne) se UVIJEK uklanja — nema beskonačnog
    // ponavljanja pokušaja.
  });
  spremiZakazanoGasenje_(preostalo);
}

// Ručno vraćanje linka na dokumente odbijene ponude natrag na "javno s
// linkom" (gumb "🔓 Vrati link na dokumente" u adminu) — Sašin izričit
// zahtjev: mora raditi SAMO dok je ponuda i dalje u stanju "odbijena" (čim
// se pripremi nova verzija, stanje se resetira i ovo prestaje vrijediti).
function adminVratiLinkDokumenataOdbijenePonude(token, rowIndex) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
  var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var stanje = izracunajStatusPonude_(header, row);
  if (stanje !== 'odbijena') {
    return { status: 'error', message: 'Link se može vratiti samo dok je ponuda u stanju "odbijena" — za ovu ponudu to više ne vrijedi (npr. već je pripremljena nova verzija, koja ima svoj vlastiti link).' };
  }
  var aktivniCol = header.indexOf(ADMIN_ONLY_FIELDS.aktivni_folder_dokumenti_id);
  var folderId = (aktivniCol !== -1) ? String(row[aktivniCol] || '').trim() : '';
  if (!folderId) { return { status: 'error', message: 'Za ovu ponudu još nije pripremljen direktorij dokumenata.' }; }
  try {
    DriveApp.getFolderById(folderId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    return { status: 'error', message: 'Vraćanje linka nije uspjelo: ' + err.message };
  }
  // Ukloni zakazano gašenje za ovaj folder (ako još nije izvršeno) — inače
  // bi sweep kasnije mogao ponovno ugasiti link koji je Saša upravo ručno
  // vratio.
  var lista = ucitajZakazanoGasenje_().filter(function(z) { return !z || z.folderId !== folderId; });
  spremiZakazanoGasenje_(lista);
  return { status: 'ok' };
}

// ---- Predlošci maila za slanje ponude (Sašin izričit zahtjev, 20.9.2026.,
// dvadeseti krug — "treba mi pregled/predložak za slanje i sa strane
// izbornik za predloške gdje mogu učitati... template mora biti vezan za
// tagove: ime firme, osoba kojoj šaljemo, zahvala na interesu, usluge koje
// je naveo u svom upitniku") ----
//
// Zaseban Google Sheet "InTime_MailPredlosci" — isti CRUD obrazac kao FAQ
// (getOrCreateFaqSheet/adminFaqList/adminFaqSave/adminFaqDelete iznad).
// Saša može imati VIŠE predložaka (izbornik u adminu bira među njima),
// jedan od njih označen kao "Zadani" (učitava se automatski kad admin prvi
// put otvori karticu). Sam TEKST predloška sadrži tagove oblika {{TAG}} —
// zamjena u stvarne vrijednosti radi se u InTime_Admin.html (renderMailPredlozak_,
// client-side, jer se predložak samo PRIKAZUJE/KOPIRA za ručno slanje, ne
// šalje se sam iz sustava — stvarno automatsko slanje maila s prilozima je
// Faza 4 iz admin-kontrolni-centar-plan.md, i dalje neizgrađeno).
var MAIL_PREDLOSCI_SHEET_NAME = 'InTime_MailPredlosci';

// Zadani tekst predloška za ponudu — sjeme koje se upisuje SAMO ako Sheet
// još nema nijedan predložak (prvo ikad pokretanje). Sadržaj je Sašin
// vlastiti tekst (poslan 20.9.2026.) uz umetnuta 4 tražena taga:
// {{IME_OSOBE}}, {{IME_FIRME}}, {{USLUGE}} (popis usluga iz upitnika, vidi
// izracunajUslugeBullet_ u InTime_Admin.html) i {{BROJ_PONUDE}} (INTRIX
// šifra ponude — zamjenjuje mjesto gdje je u izvornom tekstu stajao
// primjer "XXXX-XX-SB"). Nakon sjemena Saša ovo slobodno uređuje/dodaje
// nove predloške kroz admin sučelje — ovaj tekst se više NE piše natrag
// preko postojećeg sheeta.
//
// NADOGRAĐENO 20.9.2026. (dvadeset i prvi krug): rečenica koja je tražila da
// klijent POŠALJE POVRATNI MAIL za prihvaćanje zamijenjena je klik-linkom
// {{LINK_POTVRDE}} (vidi "POTVRDA PONUDE" blok funkcija niže) — Sašin
// izričit zahtjev, "da ne moram čekati povratni mail". Ovo mijenja samo
// SJEME (prvo ikad pokretanje) — postojeće, već spremljene predloške u
// InTime_MailPredlosci Sheetu ovo NE dira; Saša ih po potrebi sam uređuje
// kroz admin sučelje (gumb "✎ Uredi", isti tag je dostupan i tamo).
//
// NADOGRAĐENO 20.9.2026. (dvadeset i drugi krug): fiksni "Rok važenja
// ponude: 15 kalendarskih dana." zamijenjen dinamičkim {{ROK_VAZENJA}}
// tagom — vidi ADMIN_ONLY_FIELDS.datum_isteka_ponude i
// adminPostaviRokPonude() niže (izbornik 7/15/21/30 dana u admin bloku "Rok
// važenja ponude"). Isto vrijedi: mijenja samo sjeme, postojeći spremljeni
// predlošci se ne diraju automatski.
var MAIL_PREDLOZAK_ZADANI_TEKST_ =
  'Poštovani {{IME_OSOBE}},\n\n' +
  'zahvaljujemo Vam na iskazanom interesu za suradnju s In Time d.o.o. Šaljemo Vam našu ponudu za tvrtku {{IME_FIRME}}, za sljedeće logističke usluge:\n\n' +
  '{{USLUGE}}\n\n' +
  'U slučaju pitanja i potrebe za dodatnim informacijama stojimo Vam na raspolaganju.\n\n' +
  'Bila bi nam velika čast da se odlučite za našu ponudu i započnemo suradnju u 2026. godini.\n\n' +
  'Vjerujemo da možemo biti stabilan i dugoročan poslovni partner te smo u potpunosti otvoreni za model suradnje koji uključuje koegzistenciju s drugim dobavljačima, uz cilj kontinuiranog podizanja razine usluge i optimizacije troškova.\n\n' +
  'Ponudu možete prihvatiti brzo i jednostavno, bez čekanja na povratni mail — klikom na sljedeću poveznicu, gdje je potrebno unijeti OIB Vaše tvrtke te ime i prezime i funkciju osobe koja potvrđuje, kao dokaz ovlaštenja za prihvaćanje ponude {{BROJ_PONUDE}}:\n{{LINK_POTVRDE}}\n\n' +
  'Dokumentaciju uz ovu ponudu (cjenik, uvjeti suradnje, prezentacija) možete pogledati na sljedećoj poveznici:\n{{LINK_DOKUMENTI}}\n\n' +
  'Rok važenja ponude: do {{ROK_VAZENJA}}.\n\n' +
  'Na temelju takvog povratnog maila Vaš poslovni subjekt otvaramo u našem sustavu, dodjeljujemo Vam username i password za unos naloga i u roku od 12–24 sata možete početi unositi naloge i naručivati In Time prikup paketa.\n\n\n' +
  'In Time d.o.o. prednosti su:\n\n' +
  '1. EKSPRESNA ISPORUKA pošiljaka unutar granica RH na principu "od vrata do vrata" bez posrednika, stopova i boxova za preuzimanje od strane krajnjeg primatelja.\n' +
  '2. Vrlo brzo rješavanje prigovora i naknada štete u slučaju oštećenja i gubitka Vaših pošiljaka u transportu.\n' +
  '3. Prodajni agent zadužen za Vas kao našeg klijenta brzo i efikasno rješava svu aktualnu problematiku (ne morate sami rješavati i kontaktirati službe unutar In Time d.o.o.).\n' +
  '4. Više paketa koje šaljete na jednu adresu gledamo kao kolete/parcele/dijelove iste pošiljke, zbrajaju se samo težine.\n' +
  '5. Nudimo kompletnu dropshipping uslugu – prikup robe s dodatnih adresa, obradu i slanje pošiljaka u Vaše ime te isporuku Vašim kupcima uz automatsku obavijest na Vašem online računu po izvršenoj usluzi.\n' +
  '6. Interno tjedno i mjesečno vanjsko ocjenjivanje kvalitete i točnosti usluge; korekcija svih uočenih nedostataka i propusta u vrlo kratkim rokovima.\n' +
  '7. Našim klijentima osiguravamo pristup ONLINE BOOKING aplikaciji koja omogućuje jednostavno otvaranje i storniranje naloga, praćenje lokacije pošiljke u realnom vremenu te potpunu kontrolu nad svim pošiljkama na jednom mjestu. Uz to, aplikacija omogućuje i ispis dostavnih naljepnica izravno na Vašem A4 printeru, bez potrebe za dodatnom opremom, čime dodatno ubrzavate pripremu i pakiranje pošiljaka. (Klijentima bez naknade osiguravamo A4 naljepnice za printanje naloga za pošiljke; obavezno zatražiti prilikom početka suradnje i/ili kad tijekom suradnje ostanete bez istih.)\n' +
  '8. Prevozimo sve pošiljke – od paketa već od 2 kg pa do tereta mase 2,5 tone, uključujući sve volumene koji se mogu utovariti u kombi vozila ili kamione s hidrauličnom rampom. Napomena: za utovar većih odnosno težih tereta potrebno je osigurati raspoloživ viličar ili utovarnu rampu na lokaciji prikupa.\n' +
  '9. Ekspresna dostava malih pošiljaka (0–40 kg) – 98,7% paketa u većim gradovima (Zona 1) isporučuje se unutar 24 sata od preuzimanja.\n' +
  '10. Distribucija velikih i paletnih pošiljaka (100+ kg) – isporuka u Zoni 1 najčešće u roku 24–48 sati, maksimalno do 3 radna dana.\n' +
  '11. Radimo isključivo na principu ponuda, nema pritiska na ostvarivanje planova i volumena pošiljaka koje trebate poslati putem našeg logističkog sustava.\n' +
  '12. In Time d.o.o. – poslovni subjekt isključivo u domaćem hrvatskom vlasništvu.\n\n\n' +
  'Srdačan pozdrav / Kind regards,\n\n' +
  'Saša Batinac\n' +
  'Voditelj ključnih kupaca';

// Dva GOTOVA HTML predloška (Sašin izričit zahtjev, 24. krug: "ona 2
// templatea za stavljanje za slanje koja smo napravili") — puni HTML iz
// InTime_MailPredlozak_1_Standardna_ponuda.html /
// InTime_MailPredlozak_2_Korigirana_ponuda.html, ugrađen OVDJE kao sjeme
// koje dodajHtmlPredloskeAkoNedostaju_() niže automatski upiše u Sheet
// "InTime_MailPredlosci" (kao HTML predložak, stupac HTML='DA') AKO ondje
// već ne postoji redak s ISTIM nazivom — sigurno pozvati više puta, nikad
// ne stvara duplikate niti prepisuje Sašinu eventualnu ručnu izmjenu.
// Sadrže iste {{TAG}} placeholdere kao i tekstualni predlošci —
// renderMailTekst_() u InTime_Admin.html tagove tretira identično, bez
// obzira je li predložak HTML ili čisti tekst.
var MAIL_PREDLOZAK_HTML_STANDARDNA_NAZIV_ = 'Standardna ponuda (HTML)';
var MAIL_PREDLOZAK_HTML_STANDARDNA_ = `<!DOCTYPE html>
<html lang="hr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Ponuda — In Time d.o.o.</title>
</head>
<body style="margin:0;padding:0;background-color:#f2f4f3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f2f4f3;margin:0;padding:0;border-collapse:collapse;">
<tr>
<td align="center" style="padding:24px 16px;">

<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;border-collapse:collapse;">
<tr>
<td style="background-color:#ffffff;border:1px solid #e3e6e5;border-radius:10px;font-family:Arial,Helvetica,sans-serif;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
<tr>
<td style="border-radius:10px 10px 0 0;">
<img src="https://i.imgur.com/1jWHsMW.png" alt="In Time d.o.o." width="620" style="display:block;border:0;outline:none;text-decoration:none;width:100%;max-width:620px;height:auto;border-radius:10px 10px 0 0;">
</td>
</tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
<tr>
<td style="padding:28px 30px;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b;">

<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Poštovani {{IME_OSOBE}},</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">zahvaljujemo Vam na iskazanom interesu za suradnju s In Time d.o.o. Dostavljamo Vam ponudu broj {{BROJ_PONUDE}} za tvrtku {{IME_FIRME}}, izrađenu na temelju podataka navedenih u prodajnom upitniku broj {{BROJ_UPITNIKA}}, za sljedeće logističke usluge:</p>

<div style="white-space:pre-line;font-size:14px;line-height:1.7;background-color:#f6faf9;border:1px solid #d9ece8;border-radius:8px;padding:14px 16px;margin:0 0 18px;color:#2b2b2b;">{{USLUGE}}</div>

<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">U slučaju pitanja i potrebe za dodatnim informacijama stojimo Vam na raspolaganju.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Bila bi nam velika čast da se odlučite za našu ponudu i započnemo suradnju u 2026. godini.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Vjerujemo da možemo biti stabilan i dugoročan poslovni partner te smo u potpunosti otvoreni za model suradnje koji uključuje koegzistenciju s drugim dobavljačima, uz cilj kontinuiranog podizanja razine usluge i optimizacije troškova.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;"><strong>Ponudu možete prihvatiti brzo i jednostavno, bez čekanja na povratni mail — klikom na gumb ispod, gdje je potrebno unijeti OIB Vaše tvrtke te ime i prezime i funkciju osobe koja potvrđuje, kao dokaz ovlaštenja za prihvaćanje ponude {{BROJ_PONUDE}}:</strong></p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;border-collapse:collapse;">
<tr>
<td align="center" bgcolor="#0f8b7e" style="border-radius:8px;background-color:#0f8b7e;">
<a href="{{LINK_POTVRDE}}" target="_blank" rel="noopener" style="display:block;width:100%;box-sizing:border-box;padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;text-align:center;border-radius:8px;">✅ Potvrdi ponudu</a>
</td>
</tr>
</table>
<p style="font-size:12px;line-height:1.5;color:#777777;word-break:break-all;margin:0 0 14px;">Ako gumb ne radi, kopirajte poveznicu u preglednik: <a href="{{LINK_POTVRDE}}" style="color:#0f8b7e;">{{LINK_POTVRDE}}</a></p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 26px;border-collapse:collapse;">
<tr>
<td align="center" style="border-radius:8px;border:2px solid #0f8b7e;background-color:#ffffff;">
<a href="{{LINK_DOKUMENTI}}" target="_blank" rel="noopener" style="display:block;width:100%;box-sizing:border-box;padding:12px 18px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#0f8b7e;text-decoration:none;text-align:center;">📁 Pogledaj dokumente ponude</a>
</td>
</tr>
</table>
<p style="font-size:12px;line-height:1.5;color:#777777;word-break:break-all;margin:0 0 14px;">Ako gumb ne radi, kopirajte poveznicu u preglednik: <a href="{{LINK_DOKUMENTI}}" style="color:#0f8b7e;">{{LINK_DOKUMENTI}}</a></p>

<p style="font-size:13px;line-height:1.4;color:#ffffff;font-weight:bold;background-color:#c0392b;border-radius:6px;padding:10px 14px;margin:0 0 18px;text-align:center;">Rok važenja ponude: do {{ROK_VAZENJA}}.</p>

<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Na temelju takvog povratnog maila Vaš poslovni subjekt otvaramo u našem sustavu, dodjeljujemo Vam username i password za unos naloga i u roku od 12–24 sata možete početi unositi naloge i naručivati In Time prikup paketa.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;"><strong>In Time d.o.o. prednosti su:</strong></p>

<ol style="font-size:13.5px;line-height:1.6;margin:0 0 18px;padding-left:20px;color:#2b2b2b;">
<li style="margin-bottom:8px;"><strong>EKSPRESNA ISPORUKA</strong> pošiljaka unutar granica RH po principu „od vrata do vrata", bez posrednika, dodatnih zaustavljanja i paketomata za preuzimanje od strane krajnjeg primatelja.</li>
<li style="margin-bottom:8px;">Vrlo brzo rješavanje prigovora i naknada štete u slučaju oštećenja ili gubitka Vaših pošiljaka u transportu.</li>
<li style="margin-bottom:8px;">Prodajni agent zadužen isključivo za Vas kao našeg klijenta brzo i učinkovito rješava svu aktualnu problematiku — ne morate sami kontaktirati različite službe unutar In Time d.o.o.</li>
<li style="margin-bottom:8px;">Više paketa koje šaljete na jednu adresu tretiramo kao dijelove iste pošiljke — zbrajaju se samo njihove težine.</li>
<li style="margin-bottom:8px;">Nudimo <strong>kompletnu dropshipping uslugu</strong> — prikup robe s dodatnih adresa, obradu i slanje pošiljaka u Vaše ime te isporuku Vašim kupcima, uz <strong>automatsku obavijest na Vašem online računu</strong> nakon izvršene usluge.</li>
<li style="margin-bottom:8px;">Provodimo <strong>interno tjedno i mjesečno vanjsko ocjenjivanje</strong> kvalitete i točnosti usluge, uz korekciju svih uočenih nedostataka i propusta <strong>u vrlo kratkim rokovima</strong>.</li>
<li style="margin-bottom:8px;">Našim klijentima osiguravamo pristup <strong>ONLINE BOOKING aplikaciji</strong> koja omogućuje:
  <ul style="margin:6px 0 6px;padding-left:20px;">
    <li style="margin-bottom:4px;">jednostavno otvaranje i storniranje naloga</li>
    <li style="margin-bottom:4px;">praćenje pošiljke u realnom vremenu</li>
    <li style="margin-bottom:4px;">potpunu kontrolu nad svim pošiljkama na jednom mjestu</li>
    <li style="margin-bottom:4px;">ispis dostavnih naljepnica izravno na Vašem A4 printeru, bez dodatne opreme</li>
  </ul>
  <p style="margin:6px 0 0;font-size:13.5px;line-height:1.6;color:#2b2b2b;">Klijentima bez naknade osiguravamo A4 naljepnice za ispis naloga za pošiljke. Potrebno ih je zatražiti prilikom početka suradnje ili tijekom suradnje kada potrošite postojeću zalihu.</p>
</li>
<li style="margin-bottom:8px;">Prevozimo sve pošiljke — od paketa mase 2 kg do tereta mase 2,5 tone, uključujući sve volumene koji se mogu utovariti u kombi vozila ili kamione s hidrauličnom rampom. Napomena: za utovar većih odnosno težih tereta potrebno je osigurati raspoloživ viličar ili utovarnu rampu na lokaciji prikupa.</li>
<li style="margin-bottom:8px;">Ekspresna dostava malih pošiljaka od 0 do 40 kg — čak 98,7 % paketa u većim gradovima (Zona 1) isporučuje se unutar 24 sata od preuzimanja.</li>
<li style="margin-bottom:8px;">Distribucija velikih i paletnih pošiljaka mase veće od 100 kg — isporuka u Zoni 1 najčešće se izvršava u roku od 24 do 48 sati, a maksimalno unutar tri radna dana.</li>
<li style="margin-bottom:8px;">Radimo <strong>isključivo na temelju ponude</strong>, bez pritiska na ostvarivanje planova i bez obveznog minimalnog volumena pošiljaka koje trebate poslati putem našeg logističkog sustava.</li>
<li style="margin-bottom:8px;">In Time d.o.o. — poslovni subjekt u potpunom hrvatskom vlasništvu.</li>
</ol>

<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Srdačan pozdrav / Kind regards,</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 18px;color:#2b2b2b;">Saša Batinac</p>

<div style="border-top:1px solid #e3e6e5;margin-top:24px;padding-top:18px;font-size:12.5px;line-height:1.6;color:#444444;">
<strong style="color:#1f3d3a;">Saša Batinac, univ. spec. oec.</strong><br>
Sales and Marketing Manager, Voditelj ključnih kupaca<br>
In Time d.o.o. — Licensee of FedEx<br><br>
M: +385 91 6262 171 · <a href="mailto:sasa.batinac@in-time.hr" style="color:#0f8b7e;text-decoration:none;">sasa.batinac@in-time.hr</a><br>
<a href="https://in-time.hr" target="_blank" rel="noopener" style="color:#0f8b7e;text-decoration:none;">in-time.hr</a> · <a href="https://fedex.com" target="_blank" rel="noopener" style="color:#0f8b7e;text-decoration:none;">fedex.com</a><br>
In Time d.o.o. · FedEx zastupništvo · Hrvatska, BiH, Srbija, Slovenija, Crna Gora, Sjeverna Makedonija
</div>

</td>
</tr>
</table>

</td>
</tr>
</table>

<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;border-collapse:collapse;">
<tr>
<td style="font-size:10.5px;line-height:1.5;color:#9aa3a1;text-align:center;padding:14px 10px 0;font-family:Arial,Helvetica,sans-serif;">Izradio Saša Batinac. Sva prava pridržana.<br>Saša Batinac univ. spec. oec. — voditelj ključnih klijenata — In Time d.o.o. — regija istok</td>
</tr>
</table>

</td>
</tr>
</table>
</body>
</html>
`;

var MAIL_PREDLOZAK_HTML_KORIGIRANA_NAZIV_ = 'Korigirana ponuda (HTML)';
var MAIL_PREDLOZAK_HTML_KORIGIRANA_ = `<!DOCTYPE html>
<html lang="hr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Korigirana ponuda — In Time d.o.o.</title>
</head>
<body style="margin:0;padding:0;background-color:#f2f4f3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f2f4f3;margin:0;padding:0;border-collapse:collapse;">
<tr>
<td align="center" style="padding:24px 16px;">

<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;border-collapse:collapse;">
<tr>
<td style="background-color:#ffffff;border:1px solid #e3e6e5;border-radius:10px;font-family:Arial,Helvetica,sans-serif;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
<tr>
<td style="border-radius:10px 10px 0 0;">
<img src="https://i.imgur.com/fACTW8k.png" alt="In Time d.o.o." width="620" style="display:block;border:0;outline:none;text-decoration:none;width:100%;max-width:620px;height:auto;border-radius:10px 10px 0 0;">
</td>
</tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
<tr>
<td style="padding:28px 30px;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b;">

<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Poštovani {{IME_OSOBE}},</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">dostavljamo Vam ponudu broj {{BROJ_PONUDE}} za tvrtku {{IME_FIRME}}, izrađenu na temelju podataka navedenih u prodajnom upitniku broj {{BROJ_UPITNIKA}}, za sljedeće logističke usluge:</p>

<div style="white-space:pre-line;font-size:14px;line-height:1.7;background-color:#f6faf9;border:1px solid #d9ece8;border-radius:8px;padding:14px 16px;margin:0 0 18px;color:#2b2b2b;">{{USLUGE}}</div>

<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Iznimno nam je stalo do suradnje s Vama. Stoga smo ponovno pažljivo razmotrili sve okolnosti te, želeći u najvećoj mogućoj mjeri uvažiti Vaše potrebe, pripremili korigiranu ponudu za koju vjerujemo da će bolje odgovarati Vašim očekivanjima i otvoriti prostor za uspješnu dugoročnu suradnju.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;"><strong>Ponudu možete prihvatiti brzo i jednostavno, bez čekanja na povratni mail — klikom na gumb ispod, gdje je potrebno unijeti OIB Vaše tvrtke te ime i prezime i funkciju osobe koja potvrđuje, kao dokaz ovlaštenja za prihvaćanje ponude {{BROJ_PONUDE}}:</strong></p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;border-collapse:collapse;">
<tr>
<td align="center" bgcolor="#0f8b7e" style="border-radius:8px;background-color:#0f8b7e;">
<a href="{{LINK_POTVRDE}}" target="_blank" rel="noopener" style="display:block;width:100%;box-sizing:border-box;padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;text-align:center;border-radius:8px;">✅ Potvrdi ponudu</a>
</td>
</tr>
</table>
<p style="font-size:12px;line-height:1.5;color:#777777;word-break:break-all;margin:0 0 14px;">Ako gumb ne radi, kopirajte poveznicu u preglednik: <a href="{{LINK_POTVRDE}}" style="color:#0f8b7e;">{{LINK_POTVRDE}}</a></p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 26px;border-collapse:collapse;">
<tr>
<td align="center" style="border-radius:8px;border:2px solid #0f8b7e;background-color:#ffffff;">
<a href="{{LINK_DOKUMENTI}}" target="_blank" rel="noopener" style="display:block;width:100%;box-sizing:border-box;padding:12px 18px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#0f8b7e;text-decoration:none;text-align:center;">📁 Pogledaj dokumente ponude</a>
</td>
</tr>
</table>
<p style="font-size:12px;line-height:1.5;color:#777777;word-break:break-all;margin:0 0 14px;">Ako gumb ne radi, kopirajte poveznicu u preglednik: <a href="{{LINK_DOKUMENTI}}" style="color:#0f8b7e;">{{LINK_DOKUMENTI}}</a></p>

<p style="font-size:13px;line-height:1.4;color:#ffffff;font-weight:bold;background-color:#c0392b;border-radius:6px;padding:10px 14px;margin:0 0 18px;text-align:center;">Rok važenja ponude: do {{ROK_VAZENJA}}.</p>

<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Nakon što zaprimimo Vašu povratnu potvrdu, ponuda će biti upućena na verifikaciju u sjedište društva IN TIME d.o.o. u Zagrebu, nakon čega ćemo Vaš poslovni subjekt otvoriti u našem sustavu.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">U roku od 24 do 48 sati od trenutka zaprimanja Vaše potvrde, na istu adresu e-pošte primit ćete korisničko ime, lozinku i upute za pristup sustavu. Nakon zaprimanja pristupnih podataka moći ćete odmah započeti s unosom naloga i naručivanjem IN TIME prikupa pošiljaka.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">U slučaju pitanja i potrebe za dodatnim informacijama stojimo Vam na raspolaganju.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Srdačan pozdrav / Kind regards,</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 18px;color:#2b2b2b;">Saša Batinac</p>

<div style="border-top:1px solid #e3e6e5;margin-top:24px;padding-top:18px;font-size:12.5px;line-height:1.6;color:#444444;">
<strong style="color:#1f3d3a;">Saša Batinac, univ. spec. oec.</strong><br>
Sales and Marketing Manager, Voditelj ključnih kupaca<br>
In Time d.o.o. — Licensee of FedEx<br><br>
M: +385 91 6262 171 · <a href="mailto:sasa.batinac@in-time.hr" style="color:#0f8b7e;text-decoration:none;">sasa.batinac@in-time.hr</a><br>
<a href="https://in-time.hr" target="_blank" rel="noopener" style="color:#0f8b7e;text-decoration:none;">in-time.hr</a> · <a href="https://fedex.com" target="_blank" rel="noopener" style="color:#0f8b7e;text-decoration:none;">fedex.com</a><br>
In Time d.o.o. · FedEx zastupništvo · Hrvatska, BiH, Srbija, Slovenija, Crna Gora, Sjeverna Makedonija
</div>

</td>
</tr>
</table>

</td>
</tr>
</table>

<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;border-collapse:collapse;">
<tr>
<td style="font-size:10.5px;line-height:1.5;color:#9aa3a1;text-align:center;padding:14px 10px 0;font-family:Arial,Helvetica,sans-serif;">Izradio Saša Batinac. Sva prava pridržana.<br>Saša Batinac univ. spec. oec. — voditelj ključnih klijenata — In Time d.o.o. — regija istok</td>
</tr>
</table>

</td>
</tr>
</table>
</body>
</html>
`;

// Doda gornja dva HTML predloška u Sheet SAMO ako redak s istim nazivom
// (stupac "Naziv") još ne postoji.
function dodajHtmlPredloskeAkoNedostaju_(sheet) {
  var lastRow = sheet.getLastRow();
  var postojeciNazivi = {};
  if (lastRow >= 2) {
    var nazivi = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < nazivi.length; i++) {
      postojeciNazivi[String(nazivi[i][0] || '').trim()] = true;
    }
  }
  var predmetZadani = 'Ponuda In Time d.o.o. za {{IME_FIRME}} - OZNAKA PONUDE: {{BROJ_PONUDE}} - PO: {{BROJ_UPITNIKA}}';
  if (!postojeciNazivi[MAIL_PREDLOZAK_HTML_STANDARDNA_NAZIV_]) {
    sheet.appendRow([MAIL_PREDLOZAK_HTML_STANDARDNA_NAZIV_, predmetZadani, MAIL_PREDLOZAK_HTML_STANDARDNA_, '', new Date(), 'DA']);
  }
  if (!postojeciNazivi[MAIL_PREDLOZAK_HTML_KORIGIRANA_NAZIV_]) {
    sheet.appendRow([MAIL_PREDLOZAK_HTML_KORIGIRANA_NAZIV_, predmetZadani, MAIL_PREDLOZAK_HTML_KORIGIRANA_, '', new Date(), 'DA']);
  }
}

function getOrCreateMailPredlosciSheet() {
  var files = DriveApp.getFilesByName(MAIL_PREDLOSCI_SHEET_NAME);
  var ss;
  // Stupac 'HTML' dodan na SAM KRAJ (trideset i prvi krug, 20.9.2026., Sašin
  // izričit zahtjev — predlošci koji smiju sadržavati HTML/slike, ne samo
  // čisti tekst). Čisto dodavanje na kraj — self-healing preko
  // uskladiZaglavljeUpitiSheeta_() niže za VEĆ POSTOJEĆE listove, sigurno
  // (nikad ne pomiče postojeće stupce). Postojeći redci bez ove vrijednosti
  // čitaju se kao '' — što `adminMailPredlosciList()` tumači kao "NE" (plain
  // tekst, isto ponašanje kao dosad) — ništa se ne mijenja za već spremljene
  // predloške dok ih Saša sam ne označi kao HTML.
  var header = ['Naziv', 'Predmet', 'Sadržaj', 'Zadani', 'Datum izmjene', 'HTML'];
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
    uskladiZaglavljeUpitiSheeta_(ss.getSheets()[0], header);
  } else {
    ss = SpreadsheetApp.create(MAIL_PREDLOSCI_SHEET_NAME);
    var sheet = ss.getSheets()[0];
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  var sheet = ss.getSheets()[0];
  if (sheet.getLastRow() < 2) {
    // Predmet po Sašinom izričitom zahtjevu (20.9.2026., dvadeset i osmi
    // krug): "Ponuda In Time d.o.o. za [ime firme] - OZNAKA PONUDE:
    // [INTRIX šifra]-P[verzija] - PO: [šifra upitnika]". {{BROJ_PONUDE}}
    // sam uključuje "-P{N}" dodatak (vidi renderMailTekst_() u
    // InTime_Admin.html) — NAPOMENA: ovaj seed se upisuje SAMO ako list
    // "InTime_MailPredlosci" još nema niti jedan redak (prvi ikad poziv);
    // već spremljeni predlošci (uključujući Sašin eventualno ručno
    // uređen zadani predložak) se NIKAD ne mijenjaju automatski.
    sheet.appendRow(['Zadani predložak za ponudu', 'Ponuda In Time d.o.o. za {{IME_FIRME}} - OZNAKA PONUDE: {{BROJ_PONUDE}} - PO: {{BROJ_UPITNIKA}}', MAIL_PREDLOZAK_ZADANI_TEKST_, 'DA', new Date()]);
  }
  // Samopopravak (trideset i drugi krug, 21.9.2026., Sašin izričit zahtjev
  // — "u tim ponudama se treba pojaviti link kada se generira, ostale su
  // još uvijek one verzije ponude u kojima nema linka"): TEKSTUALNI
  // predlošci (HTML stupac != 'DA') koji su spremljeni PRIJE nego što je
  // tag {{LINK_DOKUMENTI}} uveden u ovaj sustav nemaju ga u svom sadržaju
  // — jer se sjeme iznad piše SAMO kad list nema nijedan redak, nikad
  // preko već postojećih redaka. Ova funkcija svaki put (idempotentno,
  // provjerava postoji li tag) dopunjuje takve retke poveznicom na
  // dokumente ponude — HTML predlošci se NE diraju (njih Saša uređuje
  // kroz zasebne InTime_MailPredlozak_*.html fajlove).
  popraviPredloskeBezLinkaDokumenata_(sheet);
  dodajHtmlPredloskeAkoNedostaju_(sheet);
  return sheet;
}

function popraviPredloskeBezLinkaDokumenata_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }
  var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  for (var i = 0; i < data.length; i++) {
    var sadrzaj = String(data[i][2] || '');
    var jeHtml = data[i][5] === 'DA';
    if (jeHtml || !sadrzaj || sadrzaj.indexOf('{{LINK_DOKUMENTI}}') !== -1) { continue; }
    var umetak = ['', 'Dokumentaciju uz ovu ponudu (cjenik, uvjeti suradnje, prezentacija) možete pogledati na sljedećoj poveznici:', '{{LINK_DOKUMENTI}}', ''];
    var lines = sadrzaj.split('\n');
    var ciljIdx = -1;
    for (var j = 0; j < lines.length; j++) {
      if (lines[j].indexOf('Rok važenja') !== -1) { ciljIdx = j; break; }
    }
    if (ciljIdx === -1) {
      for (var k = 0; k < lines.length; k++) {
        if (lines[k].indexOf('{{LINK_POTVRDE}}') !== -1) { ciljIdx = k + 1; break; }
      }
    }
    var novSadrzaj;
    if (ciljIdx !== -1) {
      novSadrzaj = lines.slice(0, ciljIdx).concat(umetak).concat(lines.slice(ciljIdx)).join('\n');
    } else {
      novSadrzaj = sadrzaj + '\n\n' + umetak.join('\n');
    }
    sheet.getRange(i + 2, 3).setValue(novSadrzaj);
    sheet.getRange(i + 2, 5).setValue(new Date());
  }
}

// Popis svih predložaka za izbornik u adminu (buildAdminFieldsBlock, Dio 1,
// blok "Predložak za slanje ponude", ODMAH NAKON bloka "Dokumenti za
// ponudu" — Sašin izričit zahtjev, "to treba staviti nakon odabira
// dokumentacije... onda se odabire template za slanje").
function adminMailPredlosciList(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var sheet = getOrCreateMailPredlosciSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'ok', predlosci: [] }; }
  var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var predlosci = [];
  for (var i = 0; i < data.length; i++) {
    predlosci.push({
      rowIndex: i + 2,
      naziv: data[i][0],
      predmet: data[i][1],
      sadrzaj: data[i][2],
      zadani: data[i][3] === 'DA',
      datumIzmjene: (data[i][4] instanceof Date) ? Utilities.formatDate(data[i][4], Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm') : String(data[i][4] || ''),
      // 'HTML' stupac (trideset i prvi krug) — 'DA'/'NE'/prazno (stari
      // redci prije uvođenja stupca čitaju se kao prazno = false = plain
      // tekst, isto ponašanje kao dosad).
      html: data[i][5] === 'DA'
    });
  }
  return { status: 'ok', predlosci: predlosci };
}

// Sprema novi predložak (predlozak.rowIndex prazan) ili uređuje postojeći.
// Kad je predlozak.zadani=true, prvo skine "DA" sa SVIH ostalih redaka —
// samo JEDAN predložak smije biti označen kao zadani u danom trenutku.
function adminMailPredlozakSpremi(token, predlozak) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  predlozak = predlozak || {};
  var naziv = String(predlozak.naziv || '').trim();
  var sadrzaj = String(predlozak.sadrzaj || '').trim();
  if (!naziv || !sadrzaj) { return { status: 'error', message: 'Naziv i sadržaj predloška su obavezni.' }; }
  var predmet = String(predlozak.predmet || '').trim();
  var sheet = getOrCreateMailPredlosciSheet();
  var zadani = !!predlozak.zadani;
  if (zadani) {
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var kolonaZadani = sheet.getRange(2, 4, lastRow - 1, 1).getValues();
      for (var i = 0; i < kolonaZadani.length; i++) {
        if (kolonaZadani[i][0] === 'DA') { sheet.getRange(i + 2, 4).setValue(''); }
      }
    }
  }
  var jeHtml = !!predlozak.html;
  var redak = [naziv, predmet, sadrzaj, zadani ? 'DA' : '', new Date(), jeHtml ? 'DA' : ''];
  var rowIndex = parseInt(predlozak.rowIndex, 10);
  if (rowIndex && rowIndex >= 2 && rowIndex <= sheet.getLastRow()) {
    sheet.getRange(rowIndex, 1, 1, 6).setValues([redak]);
  } else {
    sheet.appendRow(redak);
    rowIndex = sheet.getLastRow();
  }
  return { status: 'ok', rowIndex: rowIndex };
}

// Briše predložak — ista BRISATI-potvrda kao adminFaqDelete/adminDeleteEntry.
function adminMailPredlozakObrisi(token, rowIndex, confirmWord) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  if (confirmWord !== 'BRISATI') { return { status: 'error', message: 'Potvrda nije ispravna — potrebno je upisati točno riječ BRISATI.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateMailPredlosciSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Predložak više ne postoji (možda je već obrisan).' }; }
  sheet.deleteRow(rowIndex);
  return { status: 'ok' };
}

// Upload slike za HTML predložak maila (trideset i prvi krug, 20.9.2026.,
// Sašin izričit zahtjev — "želim moći ubacivati slike"). Slika stiže s
// klijenta kao base64 (isti obrazac kao "Dokumenti za ponudu" drag&drop),
// sprema se u Drive poddirektoriju PREDLOSCI SLIKE (vidi
// getSustavSubfolders_() iznad) i postavlja na "svatko s linkom može
// gledati" — treba biti javno vidljiva da je klijentov mail-čitač uopće
// može prikazati (isti princip kao EMAIL_HEADER_IMG, samo hostano na
// vlastitom Driveu umjesto Imgura). Vraća direktan link
// (drive.google.com/uc?export=view&id=...) koji frontend ubacuje u
// <img src="..."> na mjestu kursora u polju Sadržaj.
function adminUploadPredlozakSlika(token, base64Data, mimeType, filename) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  if (!base64Data) { return { status: 'error', message: 'Nema podataka slike.' }; }
  try {
    var bytes = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(bytes, mimeType || 'image/png', filename || 'slika.png');
    var folder = getSustavSubfolders_().predlosciSlike;
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://drive.google.com/uc?export=view&id=' + file.getId();
    return { status: 'ok', url: url };
  } catch (err) {
    return { status: 'error', message: 'Upload slike nije uspio: ' + err.message };
  }
}

// Vraća stvarni naziv Drive datoteke za dani file ID (za prikaz u adminu —
// vidi napomenu uz adminFaqList niže). Prazno ako ID nije zadan ili
// datoteka više nije dostupna (obrisana/premještena) — ne blokira ostatak
// popisa.
function faqFileNaziv_(fileId) {
  if (!fileId) { return ''; }
  try { return DriveApp.getFileById(fileId).getName(); } catch (err) { return ''; }
}

// Popis SVIH FAQ pitanja za admin sučelje (uključuje i ona bez priloga),
// sortiran po Redoslijedu — koristi se za uređivanje/brisanje. Uz svaki
// slikaId/videoId/pdfId vraća se i stvarni naziv te Drive datoteke
// (slikaNaziv/videoNaziv/pdfNaziv) — Saša je tražila da se u adminu odmah
// vidi KOJA je datoteka priložena, ne samo polje za poravnanje slike.
function adminFaqList(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var sheet = getOrCreateFaqSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'ok', entries: [] }; }
  var data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var entries = [];
  for (var i = 0; i < data.length; i++) {
    entries.push({
      rowIndex: i + 2,
      pitanje: data[i][0],
      odgovor: data[i][1],
      slikaId: data[i][2],
      videoId: data[i][3],
      pdfId: data[i][4],
      slikaNaziv: faqFileNaziv_(data[i][2]),
      videoNaziv: faqFileNaziv_(data[i][3]),
      pdfNaziv: faqFileNaziv_(data[i][4]),
      redoslijed: data[i][5],
      slikaPoravnanje: data[i][6] || 'puna',
      lajkovi: parseInt(data[i][8], 10) || 0,
      nelajkovi: parseInt(data[i][9], 10) || 0
    });
  }
  entries.sort(function(a, b) { return (parseFloat(a.redoslijed) || 0) - (parseFloat(b.redoslijed) || 0); });
  return { status: 'ok', entries: entries };
}

// Sprema novo FAQ pitanje (faq.rowIndex prazan/0) ili uređuje postojeće
// (faq.rowIndex = redak iz adminFaqList()). Prilozi (slikaId/videoId/pdfId)
// su već ranije spremljeni Drive file ID-jevi (vidi adminFaqUploadMedia) —
// ova funkcija samo upisuje/mijenja redak u tablici, ne prima same datoteke.
function adminFaqSave(token, faq) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  faq = faq || {};
  var pitanje = String(faq.pitanje || '').trim();
  var odgovor = String(faq.odgovor || '').trim();
  if (!pitanje || !odgovor) { return { status: 'error', message: 'Pitanje i odgovor su obavezni.' }; }
  var sheet = getOrCreateFaqSheet();
  var redoslijed = parseFloat(faq.redoslijed);
  if (isNaN(redoslijed)) { redoslijed = Math.max(0, sheet.getLastRow() - 1); }
  var slikaPoravnanjeDozvoljeno = { puna: 1, centar: 1, lijevo: 1, desno: 1 };
  var slikaPoravnanje = slikaPoravnanjeDozvoljeno[faq.slikaPoravnanje] ? faq.slikaPoravnanje : 'puna';
  var redak = [pitanje, odgovor, faq.slikaId || '', faq.videoId || '', faq.pdfId || '', redoslijed, slikaPoravnanje];
  var rowIndex = parseInt(faq.rowIndex, 10);
  if (rowIndex && rowIndex >= 2 && rowIndex <= sheet.getLastRow()) {
    sheet.getRange(rowIndex, 1, 1, 7).setValues([redak]);
  } else {
    redak.push(new Date());
    sheet.appendRow(redak);
    rowIndex = sheet.getLastRow();
  }
  return { status: 'ok', rowIndex: rowIndex };
}

// Briše cijeli redak FAQ pitanja — ista BRISATI-potvrda kao adminDeleteEntry/
// adminDeleteAnketaEntry.
function adminFaqDelete(token, rowIndex, confirmWord) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  if (confirmWord !== 'BRISATI') { return { status: 'error', message: 'Potvrda nije ispravna — potrebno je upisati točno riječ BRISATI.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateFaqSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Pitanje više ne postoji (možda je već obrisano).' }; }
  sheet.deleteRow(rowIndex);
  return { status: 'ok' };
}

// JAVNA akcija (bez tokena) — čita FAQ popis za InTime_PismoNamjere.html.
// Preskače retke bez pitanja/odgovora (npr. ako je red u tablici ostao
// napola popunjen), sortira po Redoslijedu.
function listFaqJavno() {
  var sheet = getOrCreateFaqSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'ok', pitanja: [], zoneBroj: brojGradovaUZoneSheetu_() }; }
  var data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var lista = [];
  for (var i = 0; i < data.length; i++) {
    var pitanje = String(data[i][0] || '').trim();
    var odgovor = String(data[i][1] || '').trim();
    if (!pitanje || !odgovor) { continue; }
    lista.push({
      rowIndex: i + 2,
      pitanje: pitanje,
      odgovor: odgovor,
      slikaId: data[i][2] || '',
      videoId: data[i][3] || '',
      pdfId: data[i][4] || '',
      redoslijed: parseFloat(data[i][5]) || 0,
      slikaPoravnanje: data[i][6] || 'puna',
      lajkovi: parseInt(data[i][8], 10) || 0,
      nelajkovi: parseInt(data[i][9], 10) || 0
    });
  }
  lista.sort(function(a, b) { return a.redoslijed - b.redoslijed; });
  return { status: 'ok', pitanja: lista, zoneBroj: brojGradovaUZoneSheetu_() };
}

// JAVNA akcija (bez tokena) — gost klikne 👍/👎 ispod FAQ odgovora na javnoj
// stranici ("Je li Vam ovaj odgovor pomogao?"). `tip` mora biti točno 'like'
// ili 'dislike'. Nema kriptografski dokazane zaštite od višestrukog glasanja
// iste osobe — to se rješava na frontendu (localStorage pamti za koja je
// pitanja gost već glasao U TOM PREGLEDNIKU i onemogućuje ponovni klik);
// LockService ovdje štiti samo od izgubljenog uvećanja kod dva istovremena
// glasa (race condition), ne od namjernog zaobilaženja.
function faqOcjena(rowIndex, tip) {
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravno pitanje.' }; }
  if (tip !== 'like' && tip !== 'dislike') { return { status: 'error', message: 'Neispravna ocjena.' }; }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getOrCreateFaqSheet();
    if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Pitanje više ne postoji.' }; }
    var col = (tip === 'like') ? 9 : 10;
    var cell = sheet.getRange(rowIndex, col);
    var trenutno = parseInt(cell.getValue(), 10) || 0;
    cell.setValue(trenutno + 1);
    return { status: 'ok' };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// ZONE DOSTAVE — popis gradova/mjesta, poštanskih brojeva i pripadajućih
// dostavnih zona In Timea (Saša uploada Excel u adminu, kartica "Zone
// dostave"). NAMJERNO je odvojen Sheet od InTime_FAQ (ne redak u FAQ
// tablici) — riječ je o ~6700 redaka strukturiranih podataka za pretragu,
// ne o ručno pisanom pitanju/odgovoru. Na javnoj stranici prikazuje se
// kao poseban, uvijek PRVI "prikvačeni" unos na vrhu FAQ popisa, s poljem
// za pretragu (vidi zoneBroj u listFaqJavno() gore i listZoneJavno()
// niže — javna stranica prvo provjeri zoneBroj pa tek pri otvaranju te
// stavke lijeno dohvati cijeli popis).
// Svaki novi upload BRIŠE i u cijelosti zamjenjuje dosadašnje podatke —
// korisničin izričit zahtjev ("kad ucitam tamo u adminu novi excell
// promjueniti ce se u faqu...ucitati novi podaci"), ne dodaje im se.
// ============================================================
function getOrCreateZoneSheet() {
  var files = DriveApp.getFilesByName(ZONE_SHEET_NAME);
  var ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(ZONE_SHEET_NAME);
    var sheet = ss.getSheets()[0];
    var header = ['Grad', 'Postanski', 'Zona'];
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return ss.getSheets()[0];
}

// Brz broj redaka (bez čitanja svih podataka) — koristi se i u
// listFaqJavno() (javno, da stranica zna treba li prikazati prikvačenu
// stavku) i u adminZoneStatus() (admin, informativni prikaz).
function brojGradovaUZoneSheetu_() {
  return Math.max(0, getOrCreateZoneSheet().getLastRow() - 1);
}

// Admin-only: trenutni broj gradova u bazi + kad/koja je datoteka zadnje
// uploadana — čisto informativni prikaz u adminu, ne mijenja ništa.
function adminZoneStatus(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var props = PropertiesService.getScriptProperties();
  return {
    status: 'ok',
    broj: brojGradovaUZoneSheetu_(),
    datum: props.getProperty('ZONE_LAST_UPLOAD_DATE') || '',
    naziv: props.getProperty('ZONE_LAST_UPLOAD_FILENAME') || ''
  };
}

// Drive folder za arhivu Zone .xlsx uploada — ista logika kao
// getOrCreateFaqMediaFolder_() (ID se pamti u Script Properties da se ne
// stvara nov folder pri svakom uploadu).
function getOrCreateZoneArhivaFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('ZONE_ARHIVA_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (err) { /* folder obrisan/nedostupan — stvori novi ispod */ }
  }
  var folder = DriveApp.createFolder(ZONE_ARHIVA_FOLDER_NAME);
  props.setProperty('ZONE_ARHIVA_FOLDER_ID', folder.getId());
  return folder;
}

// Log tablica arhive — jedan redak po svakom uploadu/restoreu: Datum,
// NazivDatoteke, BrojGradova, DriveFileId (ID kopije .xlsx datoteke u
// ZONE_ARHIVA_FOLDER_NAME, za kasnije preuzimanje/vraćanje).
function getOrCreateZoneArhivaLogSheet_() {
  var files = DriveApp.getFilesByName(ZONE_ARHIVA_SHEET_NAME);
  var ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(ZONE_ARHIVA_SHEET_NAME);
    var sheet = ss.getSheets()[0];
    var header = ['Datum', 'NazivDatoteke', 'BrojGradova', 'DriveFileId'];
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return ss.getSheets()[0];
}

// Sprema kopiju upravo uploadane/vraćene .xlsx datoteke u arhivski folder i
// upisuje redak u log — zove se iz adminZoneUpload() NAKON uspješnog upisa
// u InTime_Zone, tako da svaki upload (uključujući i svaki restore, jer
// adminZoneArhivaRestore() iznutra zove adminZoneUpload()) ostavlja trag.
// Namjerno u try/catch — ako arhiviranje ne uspije, glavni upload/restore
// svejedno ostaje uspješan (arhiva je dodatna sigurnosna mreža, ne smije
// blokirati osnovnu funkciju).
function arhivirajZoneDatoteku_(blob, filename, brojGradova) {
  try {
    var folder = getOrCreateZoneArhivaFolder_();
    var kopija = folder.createFile(blob.copyBlob());
    var logSheet = getOrCreateZoneArhivaLogSheet_();
    logSheet.appendRow([
      new Date(),
      filename || 'zone.xlsx',
      brojGradova || 0,
      kopija.getId()
    ]);
  } catch (err) {
    // Ne blokira glavnu radnju — arhiviranje je "best effort".
  }
}

// Prima bazu64-kodirani .xlsx iz admin sučelja (stupci: Grad, Poštanski
// broj, Zona — isti raspored kao dosadašnja radna tablica), pretvara ga u
// privremeni Google Sheet (pretvoriXlsxUSheet_, isti obrazac kao OB
// tablica niže u datoteci), preskače prazne/"NULL" retke, te BRIŠE i
// prepisuje CIJELI InTime_Zone Sheet novim podacima. Privremeni Sheet se
// briše (trash) odmah nakon obrade, bez obzira na ishod. Nakon uspješnog
// upisa, izvorna .xlsx datoteka arhivira se (vidi arhivirajZoneDatoteku_)
// — tako svaka promjena ostaje evidentirana s datumom i može se kasnije
// vratiti iz admina (adminZoneArhivaList/adminZoneArhivaRestore niže).
function adminZoneUpload(token, base64Data, filename) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  if (!base64Data) { return { status: 'error', message: 'Nedostaje datoteka za slanje.' }; }
  var tempFileId;
  try {
    var bytes = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(bytes, MimeType.MICROSOFT_EXCEL, filename || 'zone.xlsx');
    tempFileId = pretvoriXlsxUSheet_(blob);
    var tempSs = SpreadsheetApp.openById(tempFileId);
    var tempSheet = tempSs.getSheets()[0];
    var lastRow = tempSheet.getLastRow();
    if (lastRow < 2) { return { status: 'error', message: 'Tablica izgleda prazno.' }; }
    var values = tempSheet.getRange(2, 1, lastRow - 1, 3).getValues();

    var cisti = [];
    for (var i = 0; i < values.length; i++) {
      var grad = String(values[i][0] || '').trim();
      var postanski = String(values[i][1] || '').trim();
      var zona = String(values[i][2] || '').trim();
      if (!grad || grad.toUpperCase() === 'NULL') { continue; }
      if (!postanski || postanski.toUpperCase() === 'NULL') { continue; }
      cisti.push([grad, postanski, zona]);
    }
    if (!cisti.length) { return { status: 'error', message: 'Nije pronađen nijedan ispravan redak (Grad/Poštanski/Zona).' }; }

    var sheet = getOrCreateZoneSheet();
    var stariLastRow = sheet.getLastRow();
    if (stariLastRow > 1) {
      sheet.getRange(2, 1, stariLastRow - 1, 3).clearContent();
    }
    sheet.getRange(2, 1, cisti.length, 3).setValues(cisti);

    var props = PropertiesService.getScriptProperties();
    props.setProperty('ZONE_LAST_UPLOAD_DATE', Utilities.formatDate(new Date(), 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm'));
    props.setProperty('ZONE_LAST_UPLOAD_FILENAME', filename || '');

    arhivirajZoneDatoteku_(blob, filename, cisti.length);

    return { status: 'ok', broj: cisti.length };
  } catch (err) {
    return { status: 'error', message: 'Obrada tablice nije uspjela: ' + err.message };
  } finally {
    if (tempFileId) {
      try { DriveApp.getFileById(tempFileId).setTrashed(true); } catch (e2) { /* ne blokira odgovor ako brisanje ne uspije */ }
    }
  }
}

// Admin-only: popis svih arhiviranih Zone uploada, najnoviji prvi —
// prikazuje se u adminu pod karticom "Zone dostave" da Saša vidi povijest
// promjena i po potrebi vrati stariju verziju.
function adminZoneArhivaList(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var sheet = getOrCreateZoneArhivaLogSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'ok', entries: [] }; }
  var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  var entries = [];
  for (var i = 0; i < data.length; i++) {
    var fileId = String(data[i][3] || '').trim();
    if (!fileId) { continue; }
    entries.push({
      datum: Utilities.formatDate(new Date(data[i][0]), 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm'),
      naziv: data[i][1],
      brojGradova: parseInt(data[i][2], 10) || 0,
      fileId: fileId
    });
  }
  entries.reverse();
  return { status: 'ok', entries: entries };
}

// Admin-only: vraća ("povlači") arhiviranu .xlsx datoteku kao trenutno
// aktivne Zone podatke — jednostavno pročita arhiviranu datoteku i pozove
// adminZoneUpload() s njom, čime se ponovno koristi SVA postojeća
// validacija/upis/arhiviranje logika (znači i sâm restore odmah stvara
// svoj novi zapis u arhivi — ništa se time ne gubi).
function adminZoneArhivaRestore(token, fileId) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  fileId = String(fileId || '').trim();
  if (!fileId) { return { status: 'error', message: 'Nedostaje ID arhivirane datoteke.' }; }
  try {
    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    var base64Data = Utilities.base64Encode(blob.getBytes());
    return adminZoneUpload(token, base64Data, file.getName());
  } catch (err) {
    return { status: 'error', message: 'Vraćanje arhivirane verzije nije uspjelo: ' + err.message };
  }
}

// JAVNA akcija (bez tokena) — cijeli popis grad/poštanski broj/zona za
// pretragu na javnoj stranici. Dohvaća se LIJENO, tek kad gost otvori
// prikvačenu FAQ stavku "In Time - popis gradova, mjesta i zone" (ne pri
// svakom učitavanju stranice) — podataka ima puno (~6700 redaka).
function listZoneJavno() {
  var sheet = getOrCreateZoneSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'ok', zone: [] }; }
  var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var lista = [];
  for (var i = 0; i < data.length; i++) {
    var grad = String(data[i][0] || '').trim();
    var postanski = String(data[i][1] || '').trim();
    if (!grad || !postanski) { continue; }
    lista.push({ grad: grad, postanski: postanski, zona: String(data[i][2] || '').trim() });
  }
  return { status: 'ok', zone: lista };
}

// Prosjek svih numeričkih ocjena (Q1-25, isključujući "Ne mogu procijeniti")
// — koristi se u mail-obavijesti i u admin prikazu radi brzog pregleda.
function izracunajProsjekOcjenaAnkete_(data) {
  var suma = 0, broj = 0;
  for (var i = 1; i <= 25; i++) {
    var v = data['q' + i];
    var n = parseFloat(v);
    if (!isNaN(n) && String(v).trim() !== '' && val(v) !== 'Ne mogu procijeniti') { suma += n; broj++; }
  }
  return broj > 0 ? Math.round((suma / broj) * 10) / 10 : null;
}

// Admin-only: prosječna ocjena po SVAKOJ kategoriji i ukupno, zbrajajući
// odgovore iz SVIH dosad ispunjenih anketa (ne samo jedne) — korisnikov
// izričit zahtjev: "za sve upitnike kako dođu, znači zbrajaju se rezultati i
// računa prosjek". "Ne mogu procijeniti"/prazno polje preskače se pri
// zbrajanju, isto kao u izracunajProsjekOcjenaAnkete_() za pojedinačnu anketu.
function adminGetAnketaStatistika(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var sheet = getOrCreateAnketaSheet();
  var lastRow = sheet.getLastRow();
  var brojAnketa = Math.max(0, lastRow - 1);

  var kategorije = ANKETA_KATEGORIJE.map(function(k) {
    return { naziv: k.naziv, pitanja: k.pitanja, suma: 0, broj: 0 };
  });
  var ukupnoSuma = 0, ukupnoBroj = 0;

  if (lastRow > 1) {
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var colIndexByKey = {};
    ANKETA_FIELDS.forEach(function(f) {
      if (f.sec) { return; }
      var idx = header.indexOf(f[1]);
      if (idx !== -1) { colIndexByKey[f[0]] = idx; }
    });
    var podaci = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    podaci.forEach(function(row) {
      kategorije.forEach(function(kat) {
        kat.pitanja.forEach(function(qKey) {
          var idx = colIndexByKey[qKey];
          if (idx === undefined) { return; }
          var vrijednost = row[idx];
          var broj = parseFloat(vrijednost);
          var tekst = String(vrijednost).trim();
          if (!isNaN(broj) && tekst !== '' && tekst !== 'Ne mogu procijeniti') {
            kat.suma += broj;
            kat.broj++;
            ukupnoSuma += broj;
            ukupnoBroj++;
          }
        });
      });
    });
  }

  var kategorijeRezultat = kategorije.map(function(kat) {
    return {
      naziv: kat.naziv,
      prosjek: kat.broj > 0 ? Math.round((kat.suma / kat.broj) * 10) / 10 : null,
      brojOdgovora: kat.broj
    };
  });

  return {
    status: 'ok',
    brojAnketa: brojAnketa,
    kategorije: kategorijeRezultat,
    ukupnoProsjek: ukupnoBroj > 0 ? Math.round((ukupnoSuma / ukupnoBroj) * 10) / 10 : null,
    ukupnoBrojOdgovora: ukupnoBroj
  };
}

function saveAnketa(data) {
  var sheet = getOrCreateAnketaSheet();
  var broj = generirajBroj_('anketa', val(data.anketa_naziv));
  var row = [new Date(), broj];
  for (var i = 0; i < ANKETA_FIELDS.length; i++) {
    var f = ANKETA_FIELDS[i];
    if (f.sec) { continue; }
    row.push(val(data[f[0]]));
  }
  sheet.appendRow(row);

  // Automatski prijenos u Imenik (13. krug, Sašin izričit zahtjev) — best
  // effort, greška ovdje NE smije spriječiti mailove ispod.
  try { obradiKontakteZaImenik_(izvuciKontaktIzAnkete_(data), 'Ocjena kvalitete', broj); } catch (imenikErr) { /* vidi IMENIK_ZADNJA_GRESKA u Script Properties */ }

  var prosjek = izracunajProsjekOcjenaAnkete_(data);
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    // Broj dokumenta na početku subjecta (Sašin izričit zahtjev 15.9.2026.)
    // — isti broj ide i Saši i klijentu, tako da se mail lako pretraži/
    // poveže s konkretnim zapisom u adminu/Sheetu.
    subject: '[' + broj + '] Nova anketa o kvaliteti usluge — ' + (val(data.anketa_naziv) || 'nepoznata tvrtka') +
      (prosjek !== null ? ' (prosjek: ' + prosjek + '/10)' : ''),
    htmlBody: buildAnketaAdminNotificationEmail(data, prosjek)
  });

  // Zahvala klijentu — SADA uključuje puni pregled njegovih odgovora (svih
  // 25+2 ocjena i sva tri slobodna komentara), isti obrazac kao potvrda
  // glavnog upitnika (buildUpitConfirmationEmail/buildFieldsHtml) — korisnik
  // je eksplicitno zatražio da klijent u povratnom mailu dobije SVE što je
  // odgovorio, ne samo kratku zahvalu bez podataka (kako je bilo ranije).
  if (val(data.anketa_email)) {
    MailApp.sendEmail({
      to: val(data.anketa_email),
      subject: '[' + broj + '] In Time d.o.o. — hvala na popunjenoj anketi',
      htmlBody: buildAnketaConfirmationEmail(data)
    });
  }
  return { status: 'ok', broj: broj };
}

// ---- HTML POTVRDA KLIJENTU (anketa) ----
// Isti vizualni obrazac kao buildUpitConfirmationEmail() niže (tamna
// zaglavlje-traka, sivi okvir s pregledom odgovora preko buildFieldsHtml(),
// potpis) — bez bloka za "naknadni ispravak" jer anketa nema svoj ispravak-
// mehanizam (vidi napomenu u changelogu/projektnoj dokumentaciji).
function buildAnketaConfirmationEmail(data) {
  return '' +
  '<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a;">' +
    '<img src="' + EMAIL_HEADER_IMG + '" alt="In Time d.o.o." style="width:100%;max-width:640px;height:auto;display:block;">' +
    '<div style="padding:26px 24px;">' +
      '<p>Poštovani' + (val(data.anketa_ime_prezime) ? ' ' + val(data.anketa_ime_prezime) : '') + ',</p>' +
      '<p>Hvala Vam na izdvojenom vremenu i iskrenim odgovorima u anketi o kvaliteti naše usluge. Vaše mišljenje pomoći će nam unaprijediti kvalitetu usluga i daljnju suradnju.</p>' +
      '<p style="font-size:13px;color:#6b6b6b;">U nastavku šaljemo pregled Vaših odgovora, radi Vaše evidencije:</p>' +
      '<div style="background:#f7fafb;border:1px solid #e2e6ea;border-radius:8px;padding:14px 16px;margin:14px 0;">' +
        buildFieldsHtml(data, ANKETA_FIELDS) +
      '</div>' +
      '<p style="margin-top:24px;">Srdačan pozdrav,<br><b>Saša Batinac</b><br>' +
      'Sales and Marketing Manager, Voditelj ključnih kupaca<br>' +
      'In Time d.o.o. — Licensee of FedEx<br>' +
      'M: +385 91 6262 171 · sasa.batinac@in-time.hr</p>' +
    '</div>' +
    '<div style="background:#f7fafb;border-top:1px solid #e2e6ea;padding:14px 24px;font-size:11px;color:#6b6b6b;">' +
      'In Time d.o.o. · Zelena aleja 28, 10410 Vukovina · Tel: 01 6254 444' +
    '</div>' +
  '</div>';
}

// ---- HTML OBAVIJEST SAŠI (anketa) ----
// Isti header-slika kao buildAnketaConfirmationEmail() iznad (korisnikov
// zahtjev — i klijent i Saša vide isto zaglavlje), plus prosjek ocjena
// istaknut na vrhu i pregled svih odgovora (buildFieldsHtml). Ranije je ovo
// bio običan tekstualni mail (MailApp `body`) — sada htmlBody, isti obrazac
// kao potvrda klijentu, radi konzistentnog izgleda.
function buildAnketaAdminNotificationEmail(data, prosjek) {
  return '' +
  '<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a;">' +
    '<img src="' + EMAIL_HEADER_IMG + '" alt="In Time d.o.o." style="width:100%;max-width:640px;height:auto;display:block;">' +
    '<div style="padding:26px 24px;">' +
      '<p><b>Nova popunjena anketa o kvaliteti usluge</b> — ' + (val(data.anketa_naziv) || 'nepoznata tvrtka') + '</p>' +
      (prosjek !== null ?
        '<p style="font-size:15px;"><b>Prosjek ocjena: ' + prosjek + '/10</b></p>' : '') +
      '<div style="background:#f7fafb;border:1px solid #e2e6ea;border-radius:8px;padding:14px 16px;margin:14px 0;">' +
        buildFieldsHtml(data, ANKETA_FIELDS) +
      '</div>' +
    '</div>' +
    '<div style="background:#f7fafb;border-top:1px solid #e2e6ea;padding:14px 24px;font-size:11px;color:#6b6b6b;">' +
      'In Time d.o.o. · Zelena aleja 28, 10410 Vukovina · Tel: 01 6254 444' +
    '</div>' +
  '</div>';
}

// Vraća SVE popunjene ankete, ključano po nazivu stupca (isti obrazac kao
// adminListEntries() za InTime_Upiti) — koristi se za treći tab "Ankete
// kvalitete" u InTime_Admin.html.
function adminListAnkete(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var sheet = getOrCreateAnketaSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'ok', entries: [] }; }
  // BUG NAĐEN 15.9.2026. (Sašin nalaz — kartice ankete prikazivale su prazna
  // polja iako se prosjek ispravno računao): stariji Sheet je s vremenom
  // nakupio gomilu VIŠKA praznih/dupliciranih stupaca DESNO od stvarnih
  // podataka (ostatak iz ranijih izmjena ANKETA_FIELDS tijekom razvoja — npr.
  // testni Sheet je imao 241 stupac umjesto stvarnih ~63). Ranije se ovdje
  // čitalo do sheet.getLastColumn() (cijela širina retka) — ti višak stupci
  // imaju ISTI naziv kao pravi, ali PRAZNU vrijednost, pa su u petlji ispod
  // (obj[header[c]] = ...) prepisivali ispravno učitane vrijednosti praznima,
  // jer kasniji stupac u nizu uvijek pobjeđuje. Rješenje: čita se TOČNO
  // onoliko stupaca koliko trenutni ANKETA_FIELDS stvarno očekuje — taj
  // raspon je već garantirano ispravno poravnat (vidi getOrCreateAnketaSheet/
  // uskladiZaglavljeUpitiSheeta_), pa se stari višak stupaca zdesna jednostavno
  // ignorira, umjesto da kvari prikaz.
  var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeAnkete_();
  var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var entries = [];
  for (var i = 0; i < data.length; i++) {
    var obj = {};
    var dataObj = {};
    for (var c = 0; c < header.length; c++) {
      var v = data[i][c];
      var formatted = (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm') : v;
      obj[header[c]] = formatted;
    }
    // Prosjek ocjena — treba čitati po kratkim ključevima (q1..q25), ne po
    // nazivima stupaca, pa se ovdje ponovno gradi mala mapa label→vrijednost.
    ANKETA_FIELDS.forEach(function(f) { if (!f.sec) { dataObj[f[0]] = obj[f[1]]; } });
    entries.push({ rowIndex: i + 2, fields: obj, prosjek: izracunajProsjekOcjenaAnkete_(dataObj) });
  }
  entries.reverse();
  return { status: 'ok', entries: entries };
}

// Briše cijeli redak ankete iz "InTime_Ankete" Sheeta — ista BRISATI-potvrda
// kao adminDeleteEntry() za glavni upitnik.
function adminDeleteAnketaEntry(token, rowIndex, confirmWord) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  if (confirmWord !== 'BRISATI') { return { status: 'error', message: 'Potvrda nije ispravna — potrebno je upisati točno riječ BRISATI.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateAnketaSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  sheet.deleteRow(rowIndex);
  return { status: 'ok' };
}

function doPost(e) {
  var result = { status: 'ok' };
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.action === 'trackVisit') {
      trackVisit();
    } else if (data.action === 'adminLogin') {
      result = adminLogin(data.password);
    } else if (data.action === 'adminChangePassword') {
      result = adminChangePassword(data.token, data.oldPassword, data.newPassword);
    } else if (data.action === 'adminListEntries') {
      result = adminListEntries(data.token);
    } else if (data.action === 'adminUpdateFields') {
      result = adminUpdateFields(data.token, data.rowIndex, data.fields);
    } else if (data.action === 'adminPostaviRokPonude') {
      result = adminPostaviRokPonude(data.token, data.rowIndex, data.brojDana, data.ukupnoSati);
    } else if (data.action === 'adminGenerirajNovuPonudu') {
      result = adminGenerirajNovuPonudu(data.token, data.rowIndex, data.brojDana, data.ukupnoSati);
    } else if (data.action === 'adminPonistiPonudu') {
      result = adminPonistiPonudu(data.token, data.rowIndex);
    } else if (data.action === 'adminOtkljucajPonistenuPonudu') {
      result = adminOtkljucajPonistenuPonudu(data.token, data.rowIndex, data.brojDana, data.ukupnoSati);
    } else if (data.action === 'adminPonistiPrihvacenuPonudu') {
      result = adminPonistiPrihvacenuPonudu(data.token, data.rowIndex);
    } else if (data.action === 'adminUpdateAnketaFields') {
      result = adminUpdateAnketaFields(data.token, data.rowIndex, data.fields);
    } else if (data.action === 'adminExportKlijent') {
      result = adminExportKlijent(data.token, data.rowIndex);
    } else if (data.action === 'adminExportOdbijenica') {
      result = adminExportOdbijenica(data.token, data.rowIndex);
    } else if (data.action === 'adminExportAnketa') {
      result = adminExportAnketa(data.token, data.rowIndex);
    } else if (data.action === 'adminDeleteEntry') {
      result = adminDeleteEntry(data.token, data.rowIndex, data.confirmWord);
    } else if (data.action === 'adminListImenik') {
      result = adminListImenik(data.token);
    } else if (data.action === 'adminDeleteImenikKontakt') {
      result = adminDeleteImenikKontakt(data.token, data.rowIndex, data.confirmWord);
    } else if (data.action === 'adminTransferImenikKontakte') {
      result = adminTransferImenikKontakte(data.token, data.rowIndexes);
    } else if (data.action === 'adminSetImenikSkriveno') {
      result = adminSetImenikSkriveno(data.token, data.rowIndexes, data.skriveno);
    } else if (data.action === 'adminGetImenikAutoSync') {
      result = adminGetImenikAutoSync(data.token);
    } else if (data.action === 'adminSetImenikAutoSync') {
      result = adminSetImenikAutoSync(data.token, data.adminPassword, data.settings);
    } else if (data.action === 'adminPovuciSveKontakte') {
      result = adminPovuciSveKontakte(data.token);
    } else if (data.action === 'adminGetTestMail') {
      result = adminGetTestMail(data.token);
    } else if (data.action === 'adminPosaljiPonudaTest') {
      result = adminPosaljiPonudaTest(data.token, data.rowIndex, data.testMail, data.predmet, data.tijelo, data.jeHtml);
    } else if (data.action === 'adminPosaljiPonudaMail') {
      result = adminPosaljiPonudaMail(data.token, data.rowIndex, data.primatelji, data.predmet, data.tijelo, data.kopijaSebi, data.jeHtml, data.nazivPredloska);
    } else if (data.action === 'adminUcitajPocetno') {
      result = adminUcitajPocetno(data.token);
    } else if (data.action === 'adminGetCounters') {
      result = adminGetCounters(data.token);
    } else if (data.action === 'adminResetPosjeteUkupno') {
      result = adminResetPosjeteUkupno(data.token);
    } else if (data.action === 'adminResetPosjeteDanas') {
      result = adminResetPosjeteDanas(data.token);
    } else if (data.action === 'adminSetIspravakOdobrenje') {
      result = adminSetIspravakOdobrenje(data.token, data.rowIndex, data.poglavlja);
    } else if (data.action === 'adminListAnkete') {
      result = adminListAnkete(data.token);
    } else if (data.action === 'adminGetAnketaStatistika') {
      result = adminGetAnketaStatistika(data.token);
    } else if (data.action === 'adminDeleteAnketaEntry') {
      result = adminDeleteAnketaEntry(data.token, data.rowIndex, data.confirmWord);
    } else if (data.action === 'provjeriKlijenta') {
      result = provjeriDuplikatKlijenta(data.oib, data.naziv, data.oblik, data.tip);
    } else if (data.action === 'ispravakLogin') {
      result = ispravakLogin(data.token, data.lozinka);
    } else if (data.action === 'ispravakSaveChanges') {
      result = ispravakSaveChanges(data.token, data.lozinka, data.izmjene);
    } else if (data.action === 'listVideoGalerija') {
      result = listVideoGalerija();
    } else if (data.action === 'listSlikeGalerija') {
      result = listSlikeGalerija();
    } else if (data.action === 'listPdfGalerija') {
      result = listPdfGalerija();
    } else if (data.action === 'adminFaqList') {
      result = adminFaqList(data.token);
    } else if (data.action === 'adminFaqSave') {
      result = adminFaqSave(data.token, data.faq);
    } else if (data.action === 'adminFaqDelete') {
      result = adminFaqDelete(data.token, data.rowIndex, data.confirmWord);
    } else if (data.action === 'adminFaqUploadMedia') {
      result = adminFaqUploadMedia(data.token, data.base64Data, data.mimeType, data.filename);
    } else if (data.action === 'adminListOsnovnaDokumentacija') {
      result = adminListOsnovnaDokumentacija(data.token);
    } else if (data.action === 'adminUploadPonudaDokument') {
      result = adminUploadPonudaDokument(data.token, data.rowIndex, data.base64Data, data.mimeType, data.filename);
    } else if (data.action === 'adminPripremiDokumenteZaPonudu') {
      result = adminPripremiDokumenteZaPonudu(data.token, data.rowIndex, data.stavke);
    } else if (data.action === 'adminVratiLinkDokumenataOdbijenePonude') {
      result = adminVratiLinkDokumenataOdbijenePonude(data.token, data.rowIndex);
    } else if (data.action === 'potvrdaPonudeInfo') {
      // Napomena: `data.token` ovdje NIJE admin token (kao kod ostalih
      // 'admin...' akcija) nego token za potvrdu ponude iz poveznice — isti
      // obrazac kao postojeće ispravakLogin/ispravakSaveChanges gore, koje
      // isto tako reuse-aju generičko ime polja `token` za svoj vlastiti,
      // javni (ne-admin) token.
      result = potvrdaPonudeInfo(data.token);
    } else if (data.action === 'potvrdiPonudu') {
      result = potvrdiPonudu(data.token, data.oib, data.imeOsobe, data.funkcijaOsobe, data.ipAdresa);
    } else if (data.action === 'odbijPonudu') {
      // Napomena: isto kao potvrdaPonudeInfo/potvrdiPonudu gore, `data.token`
      // NIJE admin token nego token za potvrdu ponude iz poveznice — javna
      // akcija, klijent je zove izravno s InTime_PotvrdaPonude.html.
      result = odbijPonudu(data.token, data.razlog, data.imeOsobe, data.ipAdresa);
    } else if (data.action === 'adminMailPredlosciList') {
      result = adminMailPredlosciList(data.token);
    } else if (data.action === 'adminMailPredlozakSpremi') {
      result = adminMailPredlozakSpremi(data.token, data.predlozak);
    } else if (data.action === 'adminMailPredlozakObrisi') {
      result = adminMailPredlozakObrisi(data.token, data.rowIndex, data.confirmWord);
    } else if (data.action === 'adminUploadPredlozakSlika') {
      result = adminUploadPredlozakSlika(data.token, data.base64Data, data.mimeType, data.filename);
    } else if (data.action === 'listFaqJavno') {
      result = listFaqJavno();
    } else if (data.action === 'faqOcjena') {
      result = faqOcjena(data.rowIndex, data.tip);
    } else if (data.action === 'adminZoneStatus') {
      result = adminZoneStatus(data.token);
    } else if (data.action === 'adminZoneUpload') {
      result = adminZoneUpload(data.token, data.base64Data, data.filename);
    } else if (data.action === 'adminZoneArhivaList') {
      result = adminZoneArhivaList(data.token);
    } else if (data.action === 'adminZoneArhivaRestore') {
      result = adminZoneArhivaRestore(data.token, data.fileId);
    } else if (data.action === 'listZoneJavno') {
      result = listZoneJavno();
    } else if (data.action === 'adminGetBrojStatus') {
      result = adminGetBrojStatus(data.token);
    } else if (data.action === 'adminSetBrojTest') {
      result = adminSetBrojTest(data.token, data.tipBroja, data.ukljuceno);
    } else if (data.action === 'adminResetBrojac') {
      result = adminResetBrojac(data.token, data.tipBroja);
    } else if (data.action === 'adminMasterResetBrojace') {
      result = adminMasterResetBrojace(data.token);
    } else if (data.action === 'adminSetBrojac') {
      result = adminSetBrojac(data.token, data.tipBroja, data.sljedeciBroj);
    } else if (data.tip === 'interes') {
      result = saveUpit(data);
    } else if (data.tip === 'anketa') {
      result = saveAnketa(data);
    } else if (data.tip === 'odbijenica') {
      result = saveOdbijenica(data);
    } else {
      // NEPOZNAT zahtjev (npr. bot/skener koji pogađa Web App URL bez
      // ispravnog action/tip polja) — NE tretiramo kao odbijenicu (stari
      // "catch-all" ovdje je slao lažne "Odbijenica — nepoznata tvrtka"
      // mailove na svaki takav zahtjev). Samo vraćamo grešku, bez upisa u
      // Sheet i bez slanja maila.
      result = { status: 'error', message: 'Nepoznata akcija.' };
    }
  } catch (err) {
    result = { status: 'error', message: err.message };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// DINAMIČKE DRIVE GALERIJE (InTime_PismoNamjere.html) — čitaju popis
// datoteka izravno iz odgovarajućeg Google Drive foldera (konfiguracija na
// vrhu datoteke) i vraćaju ih frontendu, koji ih prikazuje kao ugrađene
// Google Drive preview iframe-ove / thumbnailove. Dodavanje/uklanjanje
// datoteke u folderu odmah se odražava na stranici, bez izmjene koda —
// naziv datoteke na Driveu (bez ekstenzije) postaje naziv na stranici,
// lista se sortira abecedno (preporučen brojčani prefiks u nazivu za
// kontrolu redoslijeda). SVE TRI su JAVNE akcije (bez tokena/lozinke) jer
// galerije moraju biti vidljive SVAKOM posjetitelju stranice, ne samo Saši
// — sadrže samo naziv i ID datoteke, ništa osjetljivo. Ako folder nije
// postavljen ili ne postoji, vraća se prazna lista (frontend tada
// jednostavno ne prikazuje tu sekciju).
//
// OTPORNOST NA PROLAZNE DRIVE GREŠKE (popravak "galerije se pale/gase,
// video ponekad potpuno nestane" — Drive API zna povremeno vratiti
// prolaznu grešku/kvotu, pogotovo kod foldera s više datoteka poput
// videa): dva sloja zaštite prije nego se ijedna sekcija ikad sakrije:
//   1) CacheService (10 min) — brzo vraća zadnji uspješan popis bez
//      dodatnog poziva na Drive kod svakog učitavanja stranice, čime se
//      broj stvarnih Drive poziva (i prilika za prolaznu grešku) drastično
//      smanjuje.
//   2) Ako Drive baci grešku, pokušaj još jednom (kratka pauza pa retry) —
//      rješava veliku većinu prolaznih glitcheva.
//   3) Ako i nakon retry-a ne uspije, umjesto prazne liste (=galerija
//      nestane) vraća se ZADNJA POZNATA DOBRA lista spremljena trajno u
//      PropertiesService — galerija se sakriva samo ako baš NIKAD nije
//      uspješno dohvaćena, ne zbog trenutnog hiroa Drivea.
// Napomena: nakon dodavanja/micanja datoteke u Drive folderu, promjena se
// na stranici vidi u roku od najviše ~10 min (trajanje brzog cachea), ne
// nužno odmah.
function getDriveFolderContents_(folderId) {
  if (!folderId) { return []; }
  var cacheKey = 'galerija_' + folderId;
  var propKey = 'GALERIJA_ZADNJA_DOBRA_' + folderId;

  // 1) Brzi cache
  try {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) { return JSON.parse(cached); }
  } catch (eCache) { /* cache nije kritičan, nastavljamo na Drive */ }

  // 2) Dohvat s Drivea, do 2 pokušaja
  var lista = null;
  for (var pokusaj = 0; pokusaj < 2 && lista === null; pokusaj++) {
    try {
      var folder = DriveApp.getFolderById(folderId);
      var files = folder.getFiles();
      var tmp = [];
      while (files.hasNext()) {
        var file = files.next();
        tmp.push({
          naziv: file.getName().replace(/\.[^/.]+$/, ''), // ukloni ekstenziju (.mp4, .pdf, .jpg...) iz prikaza
          id: file.getId()
        });
      }
      tmp.sort(function(a, b) { return a.naziv.localeCompare(b.naziv, 'hr'); });
      lista = tmp;
    } catch (errDrive) {
      if (pokusaj === 0) { Utilities.sleep(400); } // kratka pauza pa još jedan pokušaj
    }
  }

  if (lista !== null) {
    // Uspjeh — spremi u brzi cache i u trajnu "zadnju poznatu dobru" listu.
    try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(lista), 600); } catch (eCachePut) {}
    try { PropertiesService.getScriptProperties().setProperty(propKey, JSON.stringify(lista)); } catch (ePropPut) { /* npr. lista prevelika za jedno svojstvo — nije kritično */ }
    return lista;
  }

  // 3) Drive nije odgovorio ni nakon retry-a — vrati zadnju poznatu dobru
  // listu ako postoji, umjesto da galerija nestane.
  try {
    var zadnja = PropertiesService.getScriptProperties().getProperty(propKey);
    if (zadnja) { return JSON.parse(zadnja); }
  } catch (ePropGet) {}
  return [];
}
function listVideoGalerija() {
  return { status: 'ok', videos: getDriveFolderContents_(VIDEO_GALERIJA_FOLDER_ID) };
}
function listSlikeGalerija() {
  return { status: 'ok', slike: getDriveFolderContents_(SLIKE_GALERIJA_FOLDER_ID) };
}
function listPdfGalerija() {
  return { status: 'ok', pdfovi: getDriveFolderContents_(PDF_GALERIJA_FOLDER_ID) };
}

// ============================================================
// ADMIN STRANICA (InTime_Admin.html) — zaštićena lozinkom, prikazuje sve
// upite (Interes/Odbijenica), brojače, i omogućava upis 4 admin-only polja
// (OB korisničko ime/lozinka, datum otvaranja, zadnje vrijeme unosa naloga)
// te brisanje pojedinačnog retka (uz potvrdu riječju "BRISATI").
//
// LOZINKA: hash (SHA-256 + sol) sprema se u PropertiesService (Script
// Properties) — NIKAD u plain textu, NIKAD u Sheetu/kodu. Prvi poziv
// adminLogin() bez ikad postavljene lozinke POSTAVLJA upisanu lozinku kao
// trajnu (korisnikov zahtjev: "prvi put kad se uđe, stavlja se password").
// Promjena lozinke ide preko adminChangePassword() (traži trenutnu lozinku).
//
// SESIJA: uspješna prijava vraća nasumični token, spremljen u
// ADMIN_SESSIONS (JSON mapa token→istek-timestamp) u Script Properties.
// Svaka admin-akcija (list/update/delete/counters/changePassword) MORA
// proslijediti važeći token — inače se odbija. Trajanje sesije 12h.
// ============================================================
var ADMIN_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

// Stupci koji postoje ISKLJUČIVO kao admin-polja, bez odgovarajućeg pitanja
// u upitniku (klijent ih nikad ne vidi/popunjava) — whitelist za
// adminUpdateFields() UZ UPIT_FIELDS_BY_KEY_ (koji već pokriva SVAKO
// pitanje iz upitnika, uključujući naziv/OIB). Saša smije kroz admin
// stranicu ručno promijeniti BILO KOJI od ta dva izvora — vidi
// adminUpdateFields() niže i opširnu napomenu uz nju.
// NAPOMENA o "datum_otvaranja": naziv ključa i stupca u Sheetu (i sve što o
// njemu ovisi — jeOtvorenKlijent(), "Prebaci među klijente" gumb) NAMJERNO
// NISU mijenjani — samo je PRIKAZNA oznaka u InTime_Admin.html (kartica
// "Podaci koje popunjava In Time") promijenjena u "Datum popunjavanja
// online prodajnog upitnika" (Sašin izričit zahtjev 15.9.2026.). Diranje
// stvarnog naziva stupca ovdje bi pokrenulo self-healing umetanje NOVOG
// stupca umjesto preimenovanja postojećeg (vidi napomenu uz
// uskladiZaglavljeUpitiSheeta_ niže) i pomiješalo već upisane podatke.
//
// Novih 7 polja (šifra ponude, 3× datum slanja ponude, datum prihvaćanja
// ponude, datum otvaranja OB-a, ručno uređeno vrijeme prikupa) dodano je
// 15.9.2026. — Sašin izričit zahtjev za "sve odraditi iz admina" (prva
// faza: samo polja za unos, bez automatizacije/obavijesti za sada).
var ADMIN_ONLY_FIELDS = {
  ob_username: 'OB korisničko ime (admin)',
  ob_password: 'OB lozinka (admin)',
  datum_otvaranja: 'Datum otvaranja klijenta u sustavu (admin)',
  zadnje_vrijeme_unosa: 'Zadnje vrijeme unosa naloga (admin)',
  interna_napomena: 'Interna napomena (admin)',
  sifra_ponude: 'Šifra ponude (admin)',
  // Sašin izričit zahtjev (15.9.2026., "na polje Datum slanja ponude 1, na to
  // mjesto stavi polje koje ću ručno unijeti, zove se Identifikacijski TM broj
  // klijenta"): novo čisto admin-polje, ručno se upisuje, nema odgovarajuće
  // pitanje u upitniku — postavljeno u admin UI TOČNO na mjesto gdje je prije
  // bilo "Datum slanja ponude 1" (vidi buildAdminFieldsBlock() u
  // InTime_Admin.html), dok su sad "Datum slanja ponude 1/2/3" grupirana
  // odvojeno, jedno ispod drugoga.
  identifikacijski_tm_broj: 'Identifikacijski TM broj klijenta (admin)',
  datum_slanja_ponude_1: 'Datum slanja ponude 1 (admin)',
  datum_slanja_ponude_2: 'Datum slanja ponude 2 (admin)',
  datum_slanja_ponude_3: 'Datum slanja ponude 3 (admin)',
  datum_prihvacanja_ponude: 'Datum prihvaćanja ponude (admin)',
  datum_otvaranja_ob: 'Datum otvaranja Online Bookinga (admin)',
  admin_vrijeme_prikupa: 'Vrijeme prikupa — ručno uređeno (admin)',
  // Sašin izričit zahtjev (19.9.2026., admin-kontrolni-centar): pozitivno
  // popunjeni upitnici se VIŠE NE prebacuju izravno u "Novi klijenti", nego u
  // novu (međukoraćnu) karticu "Ponude" — veza "Novi klijenti" ⇄ pozitivno
  // popunjeni upitnik (jeOtvorenKlijent()/datum_otvaranja gore) time je
  // NAMJERNO prekinuta za ubuduće (gumb "Prebaci u ponude" više NE postavlja
  // datum_otvaranja, vidi buildAdminFieldsBlock() u InTime_Admin.html). Ovo
  // je posve novo, zasebno polje/stupac — jePonuda() u InTime_Admin.html.
  datum_prebacivanja_ponude: 'Datum prebacivanja u ponude (admin)',
  // Sašin izričit zahtjev (19.9.2026.): dodjela klijenta nadležnoj
  // poslovnici/distribucijskom centru (vidi DISTRIBUCIJSKI_CENTRI niže za
  // pune kontakt podatke). Treba za automatski mail poslovnici kod otvaranja
  // klijenta (Faza 4). Sašin izričit zahtjev (19.9.2026., drugi krug):
  // klijent može imati 2+ nadležne poslovnice odjednom — vrijednost je zato
  // POPIS naziva poslovnica ODVOJENIH ZAREZOM (npr. "Osijek,Bjelovar"), isti
  // obrazac kao "Odobrena poglavlja za ispravak (admin, brojevi odvojeni
  // zarezom)" gore. Checkbox padajući izbornik (s "Svi centri" kvačicom i
  // istaknutim poslovnicama pri vrhu) je u buildAdminFieldsBlock() u
  // InTime_Admin.html, popis poslovnica u POSLOVNICE_LISTA ondje.
  nadlezna_poslovnica: 'Nadležna poslovnica (admin)',
  // Sašin izričit zahtjev (21.9.2026.): Nadležna poslovnica dobiva ISTI
  // "potvrdi/zaključaj" mehanizam kao INTRIX šifra ponude (vidi
  // ADMIN_ONLY_FIELDS.sifra_ponude gore) — služi kao jedan od 4 uvjeta
  // osigurača prije slanja ponude (InTime_Admin.html, blok
  // "af-slanje-guard"). Vrijednost: "da" kad je potvrđena, prazno inače.
  poslovnica_potvrdjena: 'Nadležna poslovnica potvrđena (admin)',
  // Sašin izričit zahtjev (19.9.2026., osmi krug): "Arhiva klijenata" —
  // umjesto stare povratne veze "Vrati u Zainteresirani" iz "Ponude"
  // (uklonjena), klijent od kojeg se odustalo sad se gumbom "Prebaci u
  // arhivu" (dvostruka zaštita — riječ pa lozinka, isti obrazac kao
  // Zainteresirani → Ponude) premješta u novu karticu "Arhiva". Posve novo,
  // zasebno polje/stupac — jeArhiva() u InTime_Admin.html. Za sada samo
  // premještanje/prikaz, bez daljnje logike (npr. trajno brisanje ili
  // ponovno otvaranje iz arhive nije definirano).
  datum_prebacivanja_arhiva: 'Datum prebacivanja u arhivu (admin)',
  // Sašin izričit zahtjev (20.9.2026.): posve novo, ODVOJENO polje od
  // postojeće "Interna napomena" gore — ta je uvijek bila dio SKRIVENOG
  // buildAdminFieldsBlock() (vidljivog tek u "Ponude", vidi Fazu 1g). Ovo
  // polje mora biti vidljivo/uredljivo ODMAH kod "Zainteresirani" (prije
  // "Prebaci u ponude") i ostaje isto vidljivo kroz Ponude/Arhivu/Novi
  // klijenti — nije skriveno kao ostatak admin-fields bloka. Namjena:
  // slobodna napomena koju Saša (KAM — Key Account Manager) ručno upisuje,
  // a koja se UVIJEK uključuje u "Export podataka" (za razliku od "Interna
  // napomena", koja se danas NE exporta) jer je zamišljena da se DIJELI s
  // drugima kroz taj export. Prikazuje se u InTime_Admin.html odmah ispod
  // tablice klijentovih odgovora (buildNapomenaKamBlock()), NE unutar
  // skrivenog buildAdminFieldsBlock().
  napomena_kam: 'Napomena KAM-a (admin)',
  // Sašin izričit zahtjev (20.9.2026., devetnaesti krug): okvir "Dokumenti za
  // ponudu" u adminu (buildAdminFieldsBlock(), Dio 1) — dva okvira, drag&drop
  // između njih: "Osnovna dokumentacija" (živi popis iz istoimenog Drive
  // foldera, vidi adminListOsnovnaDokumentacija() niže, SAMO za čitanje) i
  // "Dokumenti za ovu ponudu" (cilj — dovlačenjem iz lijevog okvira BIRA se
  // koji osnovni dokumenti idu u OVU konkretnu ponudu; dovlačenjem datoteke
  // izravno s računala/Explorera/Findera DODAJE se klijent-specifičan
  // dokument, vidi adminUploadPonudaDokument() niže). Ovo polje pamti
  // KONAČAN sadržaj desnog okvira (ono što je stvarno odabrano za slanje uz
  // ovu ponudu) kao JSON popis objekata
  // {source:'osnovna'|'upload', id, name, url} — 'osnovna' stavke referenciraju
  // datoteku u OSNOVNA DOKUMENTACIJA po ID-u (uvijek čita TRENUTNU verziju te
  // datoteke, ne kopiju), 'upload' stavke referenciraju datoteku već
  // uploadanu u klijentov PONUDE poddirektorij (vidi
  // adminUploadPonudaDokument()). Samo pohrana odabira — stvarno slanje
  // mailom s prilozima (Faza 4 iz admin-kontrolni-centar-plan.md) NIJE dio
  // ovog kruga.
  dokumenti_ponude: 'Dokumenti za ponudu (admin, JSON)',
  // Sašin izričit zahtjev (21.9.2026.): tri POSEBNA, fiksna polja za
  // dokumente koji uvijek idu u SVAKU ponudu (Analitički cjenik, Cjenik
  // Hrvatska, Ponuda za suradnju) — svako prima TOČNO 1 dokument, drag&drop
  // ili klik iz "Osnovna dokumentacija" / upload s računala (isti mehanizam
  // kao dokumenti_ponude gore, vidi adminUploadPonudaDokument), ali s
  // ograničenjem tipa datoteke (Excel za prva dva, PDF za treće) i BEZ
  // pravila "odbacivanja dijela imena iza 2. crtice" — dokument se uvijek
  // preimenuje FIKSNIM nazivom polja, izvorno ime datoteke se u potpunosti
  // ignorira (vidi izvuciCistNaziv_/adminPripremiDokumenteZaPonudu niže).
  // Vrijednost svakog polja: JSON objekt {id, name, url} JEDNE stavke (ne
  // popis kao dokumenti_ponude), ili prazan string ako polje nije popunjeno.
  dokument_analiticki_cjenik: 'Analitički cjenik (admin, JSON)',
  dokument_cjenik_hrvatska: 'Cjenik Hrvatska (admin, JSON)',
  dokument_ponuda_suradnja: 'Ponuda za suradnju (admin, JSON)',
  // Sustav dokumenata na Driveu po VERZIJI ponude (21.9.2026., Sašin izričit
  // zahtjev — umjesto slanja fizičkih priloga mailom, dokumenti odabrani za
  // OVU verziju ponude (dokumenti_ponude + sva tri fiksna polja gore) se
  // kopiraju/preimenuju u poseban poddirektorij na Driveu
  // (adminPripremiDokumenteZaPonudu niže), a klijent u mailu dobiva SAMO
  // link na taj direktorij ({{LINK_DOKUMENTI}} tag, renderMailTekst_ u
  // InTime_Admin.html). `aktivni_folder_dokumenti_id` pamti Drive ID
  // TRENUTNO dijeljenog poddirektorija — kad se pripremi NOVA verzija (novi
  // "Redni broj slanja ponude"), prijašnjem poddirektoriju se dijeljenje
  // ugasi (link umre), a ovo polje se prebaci na novi ID. Premještanje/
  // preimenovanje foldera na Driveu NE lomi postojeći link (link je vezan
  // uz ID foldera, ne uz put/ime) — jedino EKSPLICITNO gašenje dijeljenja
  // (setSharing PRIVATE/NONE) lomi link, što se ovdje radi namjerno kod
  // prijelaza na novu verziju. `link_dokumenti_ponude` pamti sam link, za
  // brzo čitanje u {{LINK_DOKUMENTI}} tagu bez ponovnog odlaska na Drive.
  aktivni_folder_dokumenti_id: 'ID aktivnog direktorija dokumenata ponude (admin)',
  link_dokumenti_ponude: 'Link na direktorij dokumenata ponude (admin)',
  // NOVO (22.9.2026., deveti krug — Sašin izričit zahtjev: "2 male ikone,
  // jedna da se vidi CIJELA ponuda na Google Driveu, a druga da se vidi
  // samo dokumenti"): `link_dokumenti_ponude` iznad je poddirektorij
  // "POSLANO" (samo ono što klijent vidi) — ovo je poveznica na
  // PREDIREKTORIJ te verzije (interni direktorij, uklj. cjenike/evidenciju/
  // potvrdu/odbijanje), za Sašinu vlastitu upotrebu u adminu, NIKAD ne ide
  // klijentu ni u kakav mail tag.
  link_predirektorij_ponude: 'Link na predirektorij ponude (admin)',
  // Sašin izričit zahtjev (20.9.2026., dvadeseti krug — "ponudi mi sa
  // checkboxom mail adrese koje su definirane u upitniku da se na njih
  // šalje ponuda... odmah napiši tko je iza tih mailova"): checkbox popis u
  // adminu (buildAdminFieldsBlock(), Dio 1, ODMAH IZNAD bloka "Dokumenti za
  // ponudu") — ISTIH 9 izvora e-mail adresa kao klijentovo 13. poglavlje
  // "Potvrda adrese za slanje ponude" (ponuda_email_adrese), samo ovdje uz
  // svaku adresu stoji i STVARNO IME osobe (kad postoji), i Saša ga MOŽE
  // dodatno urediti (odznačiti/označiti) za baš OVU ponudu, neovisno o
  // tome što je klijent sam označio. Vrijednost: popis odabranih adresa
  // odvojenih zarezom (isti format kao ponuda_email_adrese, koji je
  // checkbox-group polje, vidi val() u InTime_Code.gs).
  mail_adrese_ponude: 'Mail adrese za slanje ponude (admin)',
  // Sašin izričit zahtjev (20.9.2026., "možemo li u template nekako ugraditi
  // mogućnost da ide link i kad klikne na potvrđujem unese OIB firme kao
  // potvrdu... da ne moram čekati povratni mail" + naknadno "bolji dokaz da
  // su to oni potvrdili"): {{LINK_POTVRDE}} tag u mail predlošku (vidi
  // renderMailTekst_ u InTime_Admin.html) vodi na NOVU stranicu
  // InTime_PotvrdaPonude.html?token=... — klijent tamo unosi OIB tvrtke (kao
  // dokaz da je BAŠ ta tvrtka potvrđuje) TE svoje ime/prezime i funkciju (kao
  // dodatni trag TKO je konkretno kliknuo, po Sašinoj želji za "boljim
  // dokazom"). Token se generira AUTOMATSKI, ne ručno — vidi adminListEntries()
  // niže, gdje se čim je zapis u "Ponude" (datum_prebacivanja_ponude
  // popunjen) i ovaj stupac još prazan, odmah generira i sprema, tako je
  // uvijek spreman za tag bez ikakve dodatne akcije. Cijeli tok — provjera
  // tokena, provjera OIB-a, upis, zaključavanje nakon prve potvrde,
  // generiranje Google dokumenta "Potvrda prihvaćanja ponude" u klijentovom
  // Drive folderu i mail obavijest Saši — vidi "POTVRDA PONUDE" blok funkcija
  // (potvrdaPonudeInfo/potvrdiPonudu/stvoriDokumentPotvrdePonude_/
  // posaljiMailPotvrdePonude_) niže, odmah uz postojeći
  // adminUploadPonudaDokument().
  token_potvrda_ponude: 'Token za potvrdu ponude (admin)',
  // Popunjava se TEK kod same potvrde (potvrdiPonudu niže) — ne ranije.
  potvrda_ime_osobe: 'Ime i prezime osobe koja je potvrdila ponudu (admin)',
  potvrda_funkcija_osobe: 'Funkcija osobe koja je potvrdila ponudu (admin)',
  // Klijentski browser dohvaća vlastitu javnu IP adresu (preko besplatnog
  // vanjskog servisa, InTime_PotvrdaPonude.html) i šalje je uz potvrdu — GAS
  // Web App doPost(e) NEMA izravan pristup IP adresi pošiljatelja, pa je ovo
  // jedini praktičan način da se ona uopće zabilježi. Napomena za Sašu: ovo
  // je IP koju je JAVIO klijentov preglednik, ne nešto što je sustav
  // neovisno provjerio — dovoljno za uobičajen trag/dokaz, ali teorijski
  // (kao i kod bilo kojeg web obrasca) netko tehnički vičan bi je mogao
  // krivotvoriti prije slanja.
  potvrda_ip_adresa: 'IP adresa prilikom potvrde ponude (admin)',
  potvrda_dokument_url: 'Poveznica na dokument potvrde ponude (admin)',
  // Sašin izričit zahtjev (20.9.2026., dvadeset i drugi krug): izbornik u
  // adminu (7/15/21/30 dana) kojim se određuje koliko ponuda vrijedi — kad
  // klikne "Postavi rok", `adminPostaviRokPonude()` niže izračuna datum
  // isteka (danas + N dana, do kraja tog dana) i upiše ga u
  // `datum_isteka_ponude`. `rok_dana_ponude` pamti ZADNJI odabrani broj
  // dana (samo da izbornik u adminu ostane na ispravnoj vrijednosti nakon
  // ponovnog otvaranja kartice — server ga inače ne koristi ni za što).
  // Isti gumb služi i za RUČNO PRODUŽENJE roka nakon isteka ("ako ponuda
  // istekne da mogu ručno dati još vremena") — klik uvijek računa NOVI
  // datum isteka od TRENUTNOG trenutka, pa istekla ponuda odmah ponovno
  // postane važeća čim Saša klikne. `datum_isteka_ponude` se čita i u
  // {{ROK_VAZENJA}} tagu (InTime_Admin.html) i u potvrdaPonudeInfo()/
  // potvrdiPonudu() niže — nakon isteka klijent na InTime_PotvrdaPonude.html
  // više NE može potvrditi (server to provjerava, ne samo klijentska
  // stranica).
  rok_dana_ponude: 'Rok važenja ponude (dana, admin)',
  datum_isteka_ponude: 'Datum isteka ponude (admin)',
  // Sašin izričit zahtjev (20.9.2026., dvadeset i treći krug): "generiraj
  // novu ponudu i da se odmah pojavi ispod novi okvir... tako da mogu ako
  // odbiju ponudu poslati drugu... i da imam ručnu opciju da ja poništim
  // ponudu". Novi blok "Ponuda — slanje i status" u InTime_Admin.html (isto
  // mjesto kao dosadašnji "Rok važenja ponude") sad prati CIJELI životni
  // ciklus slanja: kad je poslana, je li odbijena (klijent klikom na novi
  // gumb "Odbijam ponudu" na InTime_PotvrdaPonude.html) ili ručno poništena
  // (Saša u adminu), i koji je redni broj slanja (1., 2., 3. ponuda istom
  // klijentu) — vidi izracunajStatusPonude_() niže, jedino mjesto koje računa
  // status ('nije_poslano'/'na_cekanju'/'potvrdjena'/'odbijena'/'ponistena'/
  // 'istekla') iz ovih polja. NAMJERNO odvojeno novim imenima polja od
  // starih, čisto ručnih "Datum slanja ponude 1/2/3 (admin)" gore (koja Saša
  // slobodno i dalje ručno upisuje po potrebi, nepromijenjena, nemaju veze s
  // ovim automatiziranim sustavom) — da se izbjegne svaka zabuna/kolizija
  // između dva odvojena koncepta.
  //
  // `ponuda_datum_slanja` se popunjava AUTOMATSKI čim Saša klikne "Pošalji
  // ponudu"/"Produži rok" (adminPostaviRokPonude() niže, samo prvi put) ili
  // "Generiraj novu ponudu" (adminGenerirajNovuPonudu() niže, svaki put) —
  // nikad ručno. `ponuda_verzija` broji koja je ovo po redu ponuda ovom
  // klijentu (1, 2, 3...), raste SAMO kroz "Generiraj novu ponudu".
  ponuda_datum_slanja: 'Datum slanja aktivne ponude (admin)',
  ponuda_verzija: 'Redni broj slanja ponude (admin)',
  // Popunjava SERVER (odbijPonudu() niže) čim klijent na
  // InTime_PotvrdaPonude.html klikne "Odbijam ponudu" — razlog je slobodan
  // tekst koji klijent NIJE obavezan upisati.
  ponuda_datum_odbijanja: 'Datum odbijanja ponude (admin)',
  ponuda_razlog_odbijanja: 'Razlog odbijanja ponude (admin)',
  // NOVO (23. krug, Sašin izričit zahtjev — "isto što smo napravili kad se
  // prihvati ponuda, da se napravi ako se odbije odbijanje ponude"):
  // analogno potvrda_dokument_url niže, popunjava odbijPonudu() (vidi
  // stvoriDokumentOdbijanjaPonude_ niže) — dokument se sprema u ISTI
  // klijentov direktorij ponude na Driveu kao i dokument potvrde.
  ponuda_dokument_odbijanja_url: 'Poveznica na dokument odbijanja ponude (admin)',
  // Popunjava SAMO Saša, ručno, klikom na "Poništi ponudu" u adminu
  // (adminPonistiPonudu() niže) — npr. kad se predomisli oko uvjeta ponude, a
  // klijent još nije ni prihvatio ni odbio. Nakon poništenja stara poveznica
  // više ne radi (InTime_PotvrdaPonude.html prikazuje "poveznica više nije
  // aktivna"), a "Generiraj novu ponudu" postaje dostupan.
  ponuda_datum_ponistenja: 'Datum poništenja ponude (admin)',
  // Arhiva SVIH prijašnjih (završenih) slanja ovom klijentu, kao JSON popis
  // objekata {verzija, token, datumSlanja, datumIsteka, status,
  // datumZavrsetka, razlogOdbijanja} — puni se u adminGenerirajNovuPonudu()
  // niže, TEPRVO kad se generira SLJEDEĆA ponuda (prijašnja verzija se tad
  // "zaključava" u povijest, njeno mjesto u gornjim poljima preuzima nova).
  // Prikazuje se čisto za čitanje u InTime_Admin.html, ispod glavnog okvira.
  ponuda_povijest_json: 'Povijest prijašnjih slanja ponude (admin, JSON)',
  // Sašin izričit zahtjev (20.9.2026., dvadeset i sedmi krug — "sigurnosni
  // okidač... ako ponudu i prihvate trebam imati mogućnost da je ja
  // poništim"): Saša može poništiti ponudu i NAKON što ju je klijent već
  // prihvatio (za razliku od ponuda_datum_ponistenja gore, koja je dopuštena
  // SAMO dok ponuda još nije prihvaćena/odbijena — vidi
  // adminPonistiPonudu()). Namjerno ZASEBNO polje/status
  // ('ponistena_nakon_prihvata' u izracunajStatusPonude_() niže) — polja
  // prihvaćanja (datum_prihvacanja_ponude, potvrda_ime_osobe,
  // potvrda_funkcija_osobe, potvrda_ip_adresa) se NE brišu, ostaju kao trag
  // da JE bilo prihvaćeno prije poništenja (vidjeti adminPonistiPrihvacenuPonudu()
  // niže). Klijentu koji naknadno otvori poveznicu ide poruka da poveznica
  // više nije aktivna (isto kao ponistena), a svim adresama s kojih je
  // ponuda prihvaćena ide automatski mail obavijest.
  ponuda_datum_ponistenja_nakon_prihvata: 'Datum poništenja prihvaćene ponude (admin)',
  // Sašin izričit zahtjev (20.9.2026., dvadeset i sedmi krug — "ako odbiju
  // neka piše odbijeno IP adresa i tko je odbio"): mirroring potvrda_ime_osobe/
  // potvrda_ip_adresa gore, ali za ODBIJANJE (odbijPonudu() niže). Ime i
  // dalje NIJE obavezno (isti "niska trenja" princip kao dosad kod
  // odbijanja — vidi napomenu uz odbijPonudu() niže), samo se sad, ako ga
  // klijent upiše, i sprema.
  ponuda_ime_osobe_odbila: 'Ime i prezime osobe koja je odbila ponudu (admin)',
  ponuda_ip_odbijanja: 'IP adresa prilikom odbijanja ponude (admin)'
};

// Kontakt podaci svih nadležnih poslovnica/distribucijskih centara — Sašin
// izričit zahtjev (19.9.2026., "zapamti mailove trebat cemo ih kasnije").
// Spremljeno ovdje kao referentni podatak za Fazu 4 (automatski mail
// poslovnici kod otvaranja klijenta) — JOS NIJE NIGDJE WIRED/pozvano, samo
// arhivirano da se ne izgubi. Kljuc = tocno isti naziv kao u POSLOVNICE_LISTA
// (InTime_Admin.html), da se kasnije moze izravno dohvatiti po odabranoj
// vrijednosti polja "Nadlezna poslovnica".
var DISTRIBUCIJSKI_CENTRI = {
  'Bjelovar': {
    kontakti: [{ uloga: 'Voditelj i Operativac', ime: 'Mario', telefon: '091 6262 160', email: 'bjelovar@in-time.hr' }],
    email: 'bjelovar@in-time.hr'
  },
  'Dubrovnik': {
    kontakti: [
      { uloga: 'Voditelj', ime: 'Nikša', telefon: '091 6262 049', email: 'artemida.dubrovnik@gmail.com' },
      { uloga: 'Operativka', ime: 'Ivana', telefon: '091 6262 149', email: 'artemida.dubrovnik@gmail.com' }
    ],
    email: 'dubrovnik@in-time.hr'
  },
  'Gospić': {
    kontakti: [{ uloga: 'Voditelj i Operativac', ime: 'Marjan', telefon: '091 6262 065', email: 'marjan.pavicic@yahoo.com' }],
    email: 'gospic@in-time.hr'
  },
  'Krapina': {
    kontakti: [{ uloga: 'Voditeljica i Operativka', ime: 'Ivna', telefon: '099 827 7777', email: 'krapina@in-time.hr' }],
    email: 'krapina@in-time.hr'
  },
  'Opuzen': {
    kontakti: [{ uloga: 'Voditelj i Operativac', ime: 'Tomislav', telefon: '091 6262 455', email: 'tomislav.popovic@in-time.hr' }],
    adresa: 'Prašnica 38, 20355 Opuzen',
    telefon: '091/6262-455',
    email: 'opuzen@in-time.hr'
  },
  'Osijek': {
    kontakti: [
      { uloga: 'Voditelj', ime: 'Draško', telefon: '091 6262 098', email: 'drasko.polanjcec@in-time.hr' },
      { uloga: 'Operativac', ime: 'Antonio', telefon: '091 6262 070', email: 'antonio.zelic@in-time.hr' }
    ],
    adresa: 'Južna obilaznica bb, 31000 Osijek',
    telefon: '031/205979',
    email: 'osijek@in-time.hr'
  },
  'Pazin': {
    kontakti: [
      { uloga: 'Voditelj', ime: 'Tomislav', telefon: '091 6262 093', email: 'tomislav.sigur@in-time.hr' },
      { uloga: 'Operativka', ime: 'Sandra', telefon: '091 6262 133', email: 'sandra.francula@in-time.hr' }
    ],
    adresa: 'Šime Kurelića 20/7, 52000 Pazin',
    telefon: '052/206-652',
    email: 'pazin@in-time.hr'
  },
  'Rijeka': {
    kontakti: [
      { uloga: 'Voditelj', ime: 'Vladimir', telefon: '091 6262 035', email: 'vladimir.babic@in-time.hr' },
      { uloga: 'Operativac', ime: 'Vedran', telefon: '091 6262 397', email: 'vedran.tomic@in-time.hr' }
    ],
    adresa: 'Blažići 23, Viškovo 51216',
    telefon: '051/671010',
    email: 'rijeka@in-time.hr'
  },
  'Sisak': {
    kontakti: [{ uloga: 'Voditelj i Operativac', ime: 'Alen', telefon: '091 1808 444', email: 'sisak@in-time.hr' }],
    email: 'sisak@in-time.hr'
  },
  'Slavonski Brod': {
    kontakti: [{ uloga: 'Voditelj i Operativac', ime: 'Tihomir', telefon: '091 6262 067', email: 'epd-brod@sb.t-com.hr' }],
    email: 'slavonskibrod@in-time.hr'
  },
  'Split': {
    kontakti: [
      { uloga: 'Voditelj', ime: 'Dario', telefon: '091 6262 143', email: 'dario.erkapic@in-time.hr' },
      { uloga: 'Operativac', ime: 'Marko', telefon: '091 6262 170', email: 'marko.sopta@in-time.hr' }
    ],
    adresa: 'Stinice 59 (u krugu tvrtke Dalmacijavino Split d.o.o.), 21000 Split',
    telefon: '021/508178, 021/508166',
    email: 'split@in-time.hr'
  },
  'Šibenik': {
    kontakti: [{ uloga: 'Voditelj i Operativac', ime: 'Frane', telefon: '091 6262 096', email: 'fmikula1@gmail.com' }],
    email: 'sibenik@in-time.hr'
  },
  'Varaždin': {
    kontakti: [
      { uloga: 'Voditelj', ime: 'Dinko', telefon: '091 6262 069', email: 'dinko.samec@in-time.hr' },
      { uloga: 'Operativac', ime: 'Rudolf', telefon: '091 6262 086', email: 'rudolf.kukec@in-time.hr' }
    ],
    adresa: 'Cehovska 12, 42000 Varaždin',
    telefon: '042/311676',
    email: 'varazdin@in-time.hr'
  },
  // Pokriva: Zagreb, Krapina, Karlovac, Jastrebarsko, Vrbovec, Ivanić Grad,
  // Sv. Ivan Zelina — NAPOMENA: "Krapina" je ovdje navedena I unutar ovog
  // popisa gradova I kao svoja zasebna poslovnica gore (drugi kontakt,
  // Ivna) — preneseno točno kako je Saša naveo, nije naša izmjena/ispravka.
  'Zagrebačka distribucija': {
    kontakti: [
      { uloga: 'Voditelj', ime: 'Dejan', telefon: '091 6262 026', email: '' },
      { uloga: 'Operativac', ime: 'Marko', telefon: '091 6262 006', email: '' },
      { uloga: 'Prikupi', ime: 'Hrvoje', telefon: '091 6262 117', email: '' }
    ],
    pokriva: ['Zagreb', 'Krapina', 'Karlovac', 'Jastrebarsko', 'Vrbovec', 'Ivanić Grad', 'Sv. Ivan Zelina'],
    email: 'distribucija.zagreb@in-time.hr'
  }
};

function sha256Hex_(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(function(b) {
    b = (b < 0) ? b + 256 : b;
    var s = b.toString(16);
    return s.length === 1 ? '0' + s : s;
  }).join('');
}

function getAdminSessions_() {
  var raw = PropertiesService.getScriptProperties().getProperty('ADMIN_SESSIONS');
  return raw ? JSON.parse(raw) : {};
}

function saveAdminSessions_(sessions) {
  PropertiesService.getScriptProperties().setProperty('ADMIN_SESSIONS', JSON.stringify(sessions));
}

// Ujedno čisti istekle tokene (usput, pri svakoj provjeri) da ADMIN_SESSIONS
// ne raste neograničeno.
function isValidAdminToken_(token) {
  if (!token) { return false; }
  var sessions = getAdminSessions_();
  var changed = false;
  var now = Date.now();
  Object.keys(sessions).forEach(function(t) {
    if (sessions[t] < now) { delete sessions[t]; changed = true; }
  });
  var valid = Object.prototype.hasOwnProperty.call(sessions, token);
  if (changed) { saveAdminSessions_(sessions); }
  return valid;
}

function adminLogin(password) {
  if (!password) { return { status: 'error', message: 'Unesite lozinku.' }; }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var hash = props.getProperty('ADMIN_PASSWORD_HASH');
    var salt = props.getProperty('ADMIN_PASSWORD_SALT');
    var firstTime = false;
    if (!hash) {
      // Prvi put — lozinka koju admin sad upiše postaje trajna.
      firstTime = true;
      salt = Utilities.getUuid();
      hash = sha256Hex_(salt + password);
      props.setProperty('ADMIN_PASSWORD_SALT', salt);
      props.setProperty('ADMIN_PASSWORD_HASH', hash);
    } else {
      var attemptHash = sha256Hex_(salt + password);
      if (attemptHash !== hash) {
        return { status: 'error', message: 'Pogrešna lozinka.' };
      }
    }
    var token = Utilities.getUuid() + Utilities.getUuid();
    var sessions = getAdminSessions_();
    sessions[token] = Date.now() + ADMIN_SESSION_DURATION_MS;
    saveAdminSessions_(sessions);
    return { status: 'ok', token: token, firstTime: firstTime };
  } finally {
    lock.releaseLock();
  }
}

function adminChangePassword(token, oldPassword, newPassword) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  if (!newPassword || String(newPassword).length < 4) { return { status: 'error', message: 'Nova lozinka mora imati barem 4 znaka.' }; }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var hash = props.getProperty('ADMIN_PASSWORD_HASH');
    var salt = props.getProperty('ADMIN_PASSWORD_SALT');
    if (hash) {
      var attemptHash = sha256Hex_(salt + (oldPassword || ''));
      if (attemptHash !== hash) { return { status: 'error', message: 'Trenutna lozinka nije točna.' }; }
    }
    var newSalt = Utilities.getUuid();
    var newHash = sha256Hex_(newSalt + newPassword);
    props.setProperty('ADMIN_PASSWORD_SALT', newSalt);
    props.setProperty('ADMIN_PASSWORD_HASH', newHash);
    return { status: 'ok' };
  } finally {
    lock.releaseLock();
  }
}

// Broji SVAKO učitavanje stranice InTime_PismoNamjere.html (ne jedinstvene
// posjetitelje) — poziva se "tiho" (fire-and-forget, no-cors) s vrha te
// stranice pri učitavanju. Drži TRI odvojena brojača:
//   - POSJETE_COUNT     — "ukupno" u adminu, admin ga po želji može resetirati
//                         (adminResetPosjeteUkupno).
//   - POSJETE_DANAS     — "danas" u adminu, automatski kreće od 0 svaki novi
//                         kalendarski dan (Europe/Zagreb), a admin ga po
//                         potrebi može resetirati i ranije (adminResetPosjeteDanas).
//   - POSJETE_SVEUKUPNO — trajni zapis "od početka rada stranice", NEMA
//                         reset funkciju nigdje u kodu — namjerno se samo
//                         uvećava i prikazuje se u statistici kao nepromjenjiv broj.
function trackVisit() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();

    var sveukupno = parseInt(props.getProperty('POSJETE_SVEUKUPNO') || '0', 10);
    props.setProperty('POSJETE_SVEUKUPNO', String(sveukupno + 1));

    var ukupno = parseInt(props.getProperty('POSJETE_COUNT') || '0', 10);
    props.setProperty('POSJETE_COUNT', String(ukupno + 1));

    var danasnjiDatum = Utilities.formatDate(new Date(), 'Europe/Zagreb', 'yyyy-MM-dd');
    var spremljeniDatum = props.getProperty('POSJETE_DANAS_DATUM');
    var danas = parseInt(props.getProperty('POSJETE_DANAS') || '0', 10);
    if (spremljeniDatum !== danasnjiDatum) {
      danas = 0;
      props.setProperty('POSJETE_DANAS_DATUM', danasnjiDatum);
    }
    props.setProperty('POSJETE_DANAS', String(danas + 1));
  } finally {
    lock.releaseLock();
  }
}

// Vraća trenutni "posjeta danas" broj, uzimajući u obzir da je možda već
// nastupio novi dan otkad je zadnja posjeta zabilježena (u tom slučaju je
// stvarna vrijednost 0, iako spremljeni broj u Properties još nije nuliran
// — do sljedeće posjete koja će to učiniti kroz trackVisit()).
function getPosjeteDanas_() {
  var props = PropertiesService.getScriptProperties();
  var danasnjiDatum = Utilities.formatDate(new Date(), 'Europe/Zagreb', 'yyyy-MM-dd');
  var spremljeniDatum = props.getProperty('POSJETE_DANAS_DATUM');
  if (spremljeniDatum !== danasnjiDatum) { return 0; }
  return parseInt(props.getProperty('POSJETE_DANAS') || '0', 10);
}

// Resetira SAMO "ukupno" brojač (POSJETE_COUNT) na 0. Ne dira dnevni ni
// sveukupni (trajni) brojač.
function adminResetPosjeteUkupno(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  PropertiesService.getScriptProperties().setProperty('POSJETE_COUNT', '0');
  return { status: 'ok' };
}

// Resetira SAMO "danas" brojač (POSJETE_DANAS) na 0, i postavlja datum na
// danas (kako se ne bi automatski "nadopunio" pri sljedećoj posjeti istog
// dana). Ne dira ukupni ni sveukupni (trajni) brojač.
function adminResetPosjeteDanas(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var props = PropertiesService.getScriptProperties();
  var danasnjiDatum = Utilities.formatDate(new Date(), 'Europe/Zagreb', 'yyyy-MM-dd');
  props.setProperty('POSJETE_DANAS', '0');
  props.setProperty('POSJETE_DANAS_DATUM', danasnjiDatum);
  return { status: 'ok' };
}

// Spaja SVIH 10 zasebnih poziva koje InTime_Admin.html šalje ODMAH pri
// otvaranju admina (loadAll()) u JEDNO izvršavanje — Sašin izričit zahtjev
// (22.9.2026., treći krug: "vezano za ubrzavanje 9 zasebnih izvršenja
// možemo li to napraviti... i spojiti u jedan poziv"). Dosad je svaki od
// adminGetCounters/adminListEntries/adminListAnkete/adminGetAnketaStatistika/
// adminFaqList/adminZoneStatus/adminZoneArhivaList/adminGetBrojStatus/
// adminListImenik/adminGetImenikAutoSync stizao kao ZASEBAN HTTP poziv —
// svaki nosi vlastitu Apps Script "hladni start" latenciju (1-6+ sek), a
// Google ograničava broj ISTOVREMENIH izvršavanja po korisniku, pa dio čeka
// u redu → 10-15 sek do prikaza popisa/statistike. Ova funkcija poziva
// svih 10 kao OBIČNE JS funkcije unutar JEDNOG izvršavanja (token se
// provjerava samo jednom, na početku) i vraća sve rezultate spojene u jedan
// odgovor. Svaka pojedinačna admin*/adminGet*/adminList* funkcija gore i
// dalje postoji NEPROMIJENJENA i radi kao prije (koriste ju razne akcije za
// pojedinačno osvježavanje, npr. nakon spremanja FAQ-a ili uploada zona) —
// ova funkcija se koristi SAMO za početno/cjelovito učitavanje dashboarda
// (vidi loadAll() u InTime_Admin.html).
function adminUcitajPocetno(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  return {
    status: 'ok',
    counters: adminGetCounters(token),
    entries: adminListEntries(token),
    ankete: adminListAnkete(token),
    anketaStatistika: adminGetAnketaStatistika(token),
    faq: adminFaqList(token),
    zoneStatus: adminZoneStatus(token),
    zoneArhiva: adminZoneArhivaList(token),
    brojStatus: adminGetBrojStatus(token),
    imenik: adminListImenik(token),
    imenikAutoSync: adminGetImenikAutoSync(token)
  };
}

// Brojači za admin dashboard: posjete (iz PropertiesService), pozitivno/
// negativno odlučili — RAČUNAJU SE IZRAVNO iz Sheeta (brojanje redaka po
// stupcu "Tip"), ne drže se kao zaseban brojač, kako bi ostali točni i
// nakon brisanja pojedinačnih redaka.
function adminGetCounters(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var sheet = getOrCreateUpitiSheet();
  var lastRow = sheet.getLastRow();
  var pozitivno = 0, negativno = 0;
  if (lastRow > 1) {
    var statuses = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    statuses.forEach(function(r) {
      if (r[0] === 'Interes') { pozitivno++; }
      else if (r[0] === 'Odbijenica') { negativno++; }
    });
  }
  var posjete = parseInt(PropertiesService.getScriptProperties().getProperty('POSJETE_COUNT') || '0', 10);
  var posjeteDanas = getPosjeteDanas_();
  var posjeteSveukupno = parseInt(PropertiesService.getScriptProperties().getProperty('POSJETE_SVEUKUPNO') || '0', 10);
  var anketaSheet = getOrCreateAnketaSheet();
  var ankete = Math.max(0, anketaSheet.getLastRow() - 1);
  return { status: 'ok', posjete: posjete, posjeteDanas: posjeteDanas, posjeteSveukupno: posjeteSveukupno, pozitivno: pozitivno, negativno: negativno, ankete: ankete };
}

// Vraća SVE retke (Interes + Odbijenica) s punim podacima, ključano po
// nazivu stupca (header) — admin.html filtrira po `status` (Interes/
// Odbijenica) za dva odvojena taba/popisa kartica. `rowIndex` je STVARNI
// broj retka u Sheetu (1-based, uključuje header red) — koristi se kao
// identifikator za adminUpdateFields()/adminDeleteEntry(), budući da ovi
// upiti nemaju zaseban ID stupac.
function adminListEntries(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var sheet = getOrCreateUpitiSheet();
  var lastRow = sheet.getLastRow();
  // labelToKey: naziv stupca → kratki ključ polja (iz UPIT_FIELDS) — šalje se
  // uz popis kako bi InTime_Admin.html mogao generički prikazati SVAKO polje
  // upitnika kao uredljivo (ne samo one ključeve koji imaju poseban blok), a
  // da ključeve ne treba ručno duplicirati u HTML-u (jedan izvor istine, ovdje).
  var labelToKey = {};
  UPIT_FIELDS.forEach(function(f) {
    if (f.sec) { return; }
    labelToKey[f[1]] = f[0];
  });
  if (lastRow < 2) { return { status: 'ok', entries: [], labelToKey: labelToKey }; }
  // ISTA ZAŠTITA kao u adminListAnkete() (Sašin nalaz na "InTime_Ankete" Sheetu,
  // 15.9.2026. — stari Sheet nakupio 241 stupac umjesto stvarnih ~63, pa su
  // prazni viškovi zdesna prepisivali ispravne vrijednosti praznima jer se
  // čitalo do sheet.getLastColumn(), cijele širine retka). Ista klasa buga je
  // ovdje samo LATENTNA (nije prijavljena), ali kod je identičan pa je jednako
  // ranjiv ako "InTime_Upiti" ikad nakupi sličan višak stupaca — čita se zato
  // TOČNO onoliko stupaca koliko trenutni UPIT_FIELDS + admin-only stupci
  // stvarno očekuju, taj raspon je već garantirano poravnat (vidi
  // getOrCreateUpitiSheet/uskladiZaglavljeUpitiSheeta_).
  var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
  var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  // Auto-generiranje tokena za "Potvrda ponude" (poveznica u mail predlošku,
  // {{LINK_POTVRDE}} — vidi ADMIN_ONLY_FIELDS.token_potvrda_ponude gore) —
  // Sašin izričit zahtjev (20.9.2026.): token se stvara AUTOMATSKI, čim je
  // zapis u "Ponude" (prepoznato po popunjenom "Datum prebacivanja u ponude
  // (admin)"), bez ikakvog posebnog gumba/koraka. Ovdje, kod SVAKOG čitanja
  // popisa, provjeri je li zapis već u "Ponude" a token mu još prazan — ako
  // da, generiraj ga i ODMAH upiši natrag u Sheet (retroaktivno pokriva i
  // zapise koji su u "Ponude" ušli PRIJE ove nadogradnje). Upis je jeftin
  // (samo za retke kojima token stvarno nedostaje) i osigurava da je token
  // već prisutan u `entry.fields` ovog istog poziva, bez dodatnog
  // round-tripa — pregled predloška u adminu tako odmah ima ispravan link.
  var prebacivanjeCol = header.indexOf('Datum prebacivanja u ponude (admin)');
  var tokenPotvrdeCol = header.indexOf('Token za potvrdu ponude (admin)');
  var entries = [];
  for (var i = 0; i < data.length; i++) {
    if (tokenPotvrdeCol !== -1 && prebacivanjeCol !== -1 && data[i][prebacivanjeCol] && !data[i][tokenPotvrdeCol]) {
      var noviTokenPotvrde = Utilities.getUuid();
      sheet.getRange(i + 2, tokenPotvrdeCol + 1).setValue(noviTokenPotvrde);
      data[i][tokenPotvrdeCol] = noviTokenPotvrde;
    }
    var obj = {};
    for (var c = 0; c < header.length; c++) {
      var v = data[i][c];
      obj[header[c]] = (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm') : v;
    }
    // Sašin izričit zahtjev (20.9.2026., dvadeset i sedmi krug — "ako
    // prihvate neka piše dan datum sat minuta i sekunda"): svi ostali
    // datumi u ovom popisu NAMJERNO ostaju na minutnoj preciznosti gore
    // (mijenjanje TOG formata bi pokvarilo izracunajIstekDatumObj_() u
    // InTime_Admin.html, koja regexom skida " HH:mm" — dodavanje sekundi
    // bi to poravnanje pomaknulo). Umjesto toga, za TOČNO polja koja
    // "Ponuda — slanje i status" blok prikazuje u novim "Datum N" okvirima,
    // ovdje se dodaju ZASEBNI, sekundno-precizni ključevi (sufiks ", sek)")
    // — čitaju se izravno iz sirovog Date objekta, ne diraju postojeći
    // ključ/format iznad. Povijest prijašnjih slanja (ponuda_povijest_json)
    // već nosi punu ISO preciznost (toISOString()) pa joj ovo ne treba.
    var sekPolja_ = [
      'Datum slanja aktivne ponude (admin)',
      'Datum odbijanja ponude (admin)',
      'Datum prihvaćanja ponude (admin)',
      'Datum poništenja ponude (admin)',
      'Datum poništenja prihvaćene ponude (admin)'
    ];
    sekPolja_.forEach(function(labelSek) {
      var idxSek = header.indexOf(labelSek);
      if (idxSek === -1) { return; }
      var vSek = data[i][idxSek];
      obj[labelSek + ' (sek)'] = (vSek instanceof Date) ? Utilities.formatDate(vSek, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm:ss') : '';
    });
    entries.push({ rowIndex: i + 2, status: data[i][1], fields: obj });
  }
  // Najnoviji upiti prvi.
  entries.reverse();
  return { status: 'ok', entries: entries, labelToKey: labelToKey };
}

// Upisuje polja upitnika koje Saša RUČNO promijeni kroz admin stranicu.
// Dozvoljeni ključevi = BILO KOJI ključ iz UPIT_FIELDS (preko UPIT_FIELDS_BY_KEY_
// lookupa — dakle SVAKO pitanje iz upitnika, uključujući naziv/OIB) PLUS 4
// čisto admin-polja (ADMIN_ONLY_FIELDS, bez odgovarajućeg pitanja u upitniku).
// Bilo koji drugi/nepoznat ključ u `fields` tiho se preskače. Za razliku od
// ispravakSaveChanges() (koja je ograničena na klijentom odobrena poglavlja
// i nikad ne dopušta naziv/OIB), OVA funkcija je Sašina — nema ograničenja
// osim valjanog admin tokena, budući da je Saša jedini koji joj pristupa.
function adminUpdateFields(token, rowIndex, fields) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  fields = fields || {};
  var primijenjenoPolja = 0;
  Object.keys(fields).forEach(function(key) {
    var colLabel = ADMIN_ONLY_FIELDS[key];
    if (!colLabel) {
      var f = UPIT_FIELDS_BY_KEY_[key];
      if (f) { colLabel = f[1]; }
    }
    if (!colLabel) { return; }
    var colIdx = header.indexOf(colLabel);
    if (colIdx === -1) { return; }
    sheet.getRange(rowIndex, colIdx + 1).setValue(fields[key]);
    primijenjenoPolja++;
  });
  return { status: 'ok', primijenjenoPolja: primijenjenoPolja };
}

// Postavlja (ili, nakon isteka, RUČNO PRODUŽUJE) rok važenja ponude — Sašin
// izričit zahtjev (20.9.2026., dvadeset i drugi krug): izbornik 7/15/21/30
// dana u admin bloku "Rok važenja ponude", vidi punu napomenu uz
// ADMIN_ONLY_FIELDS.rok_dana_ponude gore. Datum isteka se UVIJEK računa od
// TRENUTNOG trenutka poziva (ne od nekog ranijeg datuma), do kraja tog dana
// (23:59:59) — tako isti gumb radi i za prvo postavljanje i za ručno
// produženje nakon isteka, bez posebne "produži" akcije. Provjeru je li
// ponuda istekla za KLIJENTA (na InTime_PotvrdaPonude.html) vidi
// potvrdaPonudeInfo()/potvrdiPonudu() niže — SERVER je uvijek autoritet.
// `ukupnoSati` (trideset i drugi krug, 20.9.2026., Sašin izričit zahtjev:
// "da mogu napraviti rok trajanja ponude koliko želim, 1h pa do 365 dana")
// — kad je poslan (>0), IMA PREDNOST nad `brojDana` i rok istječe TOČNO N
// sati od trenutka poziva, bez zaokruživanja na kraj dana (preset
// 7/15/21/30 dana ostaje potpuno nedirano — i dalje istječe u 23:59:59 tog
// dana, jer bi kratki prilagođeni rok poput "2 sata" inače u praksi
// trajao gotovo cijeli dan).
function adminPostaviRokPonude(token, rowIndex, brojDana, ukupnoSati) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  ukupnoSati = ukupnoSati ? parseInt(ukupnoSati, 10) : 0;
  var koristiSate = ukupnoSati > 0;
  if (koristiSate) {
    if (ukupnoSati < 1 || ukupnoSati > 8760) { return { status: 'error', message: 'Prilagođeni rok mora biti između 1 sat i 365 dana (8760 sati).' }; }
  } else {
    brojDana = parseInt(brojDana, 10);
    if (!brojDana || brojDana < 1 || brojDana > 365) { return { status: 'error', message: 'Neispravan broj dana.' }; }
  }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  // Sašin izričit zahtjev (20.9.2026., dvadeset i treći krug): ovaj gumb više
  // NE smije raditi nad ponudom koja je već dobila konačan ishod
  // (prihvaćena/odbijena/poništena) — za sljedeće slanje istom klijentu
  // postoji "Generiraj novu ponudu" (adminGenerirajNovuPonudu niže).
  var stanje = izracunajStatusPonude_(header, row);
  if (stanje === 'potvrdjena' || stanje === 'odbijena' || stanje === 'ponistena') {
    return { status: 'error', message: 'Ova ponuda je ' + OPIS_STATUSA_PONUDE_[stanje] + ' — za sljedeće slanje kliknite "Generiraj novu ponudu".' };
  }
  var rokDanaCol = header.indexOf('Rok važenja ponude (dana, admin)');
  var istekCol = header.indexOf('Datum isteka ponude (admin)');
  if (istekCol === -1) { return { status: 'error', message: 'Stupac za datum isteka ne postoji u tablici.' }; }
  var sada = new Date();
  var istek;
  if (koristiSate) {
    istek = new Date(sada.getTime() + ukupnoSati * 3600 * 1000);
  } else {
    istek = new Date();
    istek.setDate(istek.getDate() + brojDana);
    istek.setHours(23, 59, 59, 999);
  }
  sheet.getRange(rowIndex, istekCol + 1).setValue(istek);
  // Kod prilagođenog (satnog) roka stupac 'dana' ostaje prazan — izbornik
  // 7/15/21/30 dana u adminu ga koristi samo za pred-odabir kod ponovnog
  // otvaranja kartice; nema odgovarajuće opcije za satni rok, pa se prazno
  // polje jednostavno tiho ignorira (izbornik ostaje na zadanoj opciji).
  if (rokDanaCol !== -1) { sheet.getRange(rowIndex, rokDanaCol + 1).setValue(koristiSate ? '' : brojDana); }
  // ISPRAVAK (22.9.2026., deveti krug — Sašin izričit zahtjev, nakon što je
  // primijetio da "Time to Decision" (TTD) pokazuje sate umjesto stvarnih
  // par minuta): OVA funkcija ("Postavi rok") više NE postavlja "Datum
  // slanja aktivne ponude"/redni broj — to je RANIJE ovdje radila, pod
  // pretpostavkom da Saša klikne "Postavi rok" i "Pošalji ponudu" gotovo
  // istovremeno. U praksi zna proći sati između njih (rok postavi ranije,
  // stvarni mail pošalje kasnije) — pa je TTD (koji broji od "Datum slanja
  // aktivne ponude" do trenutka odluke) ispadao lažno velik, jer je brojao
  // od klika na "Postavi rok", ne od stvarnog slanja maila. Postavljanje
  // datuma slanja/rednog broja premješteno je u `adminPosaljiPonudaMail()`
  // niže — SAD se stvarno postavlja tek kad Saša klikne "📧 Pošalji ponudu",
  // što je pravi trenutak koji TTD treba mjeriti. Ova funkcija sad SAMO
  // postavlja rok — status ostaje 'nije_poslano' dok se mail stvarno ne
  // pošalje.
  return {
    status: 'ok',
    // Puna preciznost (datum + vrijeme), ne samo datum (ispravak, trideset i
    // drugi krug) — nužno otkad rok može isteći u proizvoljno vrijeme dana
    // (prilagođeni satni rok), a klijentski `izracunajIstekDatumObj_()`/
    // `parsirajHrvatskiDatum_()` u InTime_Admin.html ovo parsiraju natrag
    // (koriste se za brojač i status "istekla" odmah nakon klika, bez
    // čekanja na sljedeće puno učitavanje popisa).
    datumIstekaPrikaz: Utilities.formatDate(istek, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm'),
    datumIstekaIso: istek.toISOString()
  };
}

// Generira POSVE NOVU ponudu (novi token/poveznica) istom klijentu — Sašin
// izričit zahtjev (20.9.2026., dvadeset i treći krug): "generiraj novu
// ponudu i da se odmah pojavi ispod novi okvir u koji ide datum i vrijeme
// slanja druge ponude i odmah da se generira novi link za slanje... tako da
// mogu ako odbiju ponudu poslati drugu". Dopušteno SAMO kad prijašnja
// verzija ima konačan (ne-aktivan) ishod — odbijena, poništena ili istekla —
// nikad dok je još 'na_cekanju' ili već 'potvrdjena' (za to služi
// adminPostaviRokPonude gore). Prijašnja verzija se prije prepisivanja
// arhivira u ponuda_povijest_json, trajan trag svih pokušaja.
// `ukupnoSati` — isto prilagođeno-trajanje kao adminPostaviRokPonude()
// gore (trideset i drugi krug), jer "Generiraj novu ponudu" koristi ISTI
// izbornik/prilagođeno polje na kartici.
function adminGenerirajNovuPonudu(token, rowIndex, brojDana, ukupnoSati) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  ukupnoSati = ukupnoSati ? parseInt(ukupnoSati, 10) : 0;
  var koristiSate = ukupnoSati > 0;
  if (koristiSate) {
    if (ukupnoSati < 1 || ukupnoSati > 8760) { return { status: 'error', message: 'Prilagođeni rok mora biti između 1 sat i 365 dana (8760 sati).' }; }
  } else {
    brojDana = parseInt(brojDana, 10);
    if (!brojDana || brojDana < 1 || brojDana > 365) { return { status: 'error', message: 'Neispravan broj dana.' }; }
  }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var stanje = izracunajStatusPonude_(header, row);
  if (stanje !== 'odbijena' && stanje !== 'ponistena' && stanje !== 'istekla' && stanje !== 'ponistena_nakon_prihvata') {
    return { status: 'error', message: 'Nova ponuda se može generirati samo kad je prijašnja odbijena, poništena ili istekla (trenutno: ' + (OPIS_STATUSA_PONUDE_[stanje] || stanje) + ').' };
  }

  var get = function(label) { var idx = header.indexOf(label); return idx === -1 ? null : row[idx]; };
  var set = function(label, value) { var idx = header.indexOf(label); if (idx !== -1) { sheet.getRange(rowIndex, idx + 1).setValue(value); } };

  var povijestCol = header.indexOf('Povijest prijašnjih slanja ponude (admin, JSON)');
  var povijest = [];
  if (povijestCol !== -1 && row[povijestCol]) {
    try { povijest = JSON.parse(row[povijestCol]); } catch (e) { povijest = []; }
  }
  // NADOGRAĐENO (20.9.2026., dvadeset i sedmi krug — mockup "Datum 1/2/3"
  // odobren, vidi InTime_Admin.html renderRokBlok_()): povijest sad, uz
  // dosadašnja polja, čuva i PUNI trag prihvaćanja/odbijanja te verzije
  // (ime/funkcija/IP tko je prihvatio, ili ime/IP tko je odbio) — ranije se
  // to jedino vidjelo u glavnim (aktivnim) poljima, koja sljedeća verzija
  // prepisuje, pa se gubilo iz prikaza. `datumZavrsetka` sad provjerava i
  // novi 'ponistena_nakon_prihvata' datum.
  var datumZavrsetkaSirovo = get('Datum odbijanja ponude (admin)') || get('Datum poništenja ponude (admin)') || get('Datum poništenja prihvaćene ponude (admin)') || get('Datum isteka ponude (admin)') || null;
  var datumSlanjaSirovo = get('Datum slanja aktivne ponude (admin)');
  var datumIstekaSirovo = get('Datum isteka ponude (admin)');
  var datumPrihvacanjaSirovo = get('Datum prihvaćanja ponude (admin)');
  povijest.push({
    verzija: parseInt(get('Redni broj slanja ponude (admin)'), 10) || 1,
    token: get('Token za potvrdu ponude (admin)') || '',
    datumSlanja: (datumSlanjaSirovo instanceof Date) ? datumSlanjaSirovo.toISOString() : '',
    datumIsteka: (datumIstekaSirovo instanceof Date) ? datumIstekaSirovo.toISOString() : '',
    status: stanje,
    datumZavrsetka: (datumZavrsetkaSirovo instanceof Date) ? datumZavrsetkaSirovo.toISOString() : '',
    razlogOdbijanja: get('Razlog odbijanja ponude (admin)') || '',
    imeOdbio: get('Ime i prezime osobe koja je odbila ponudu (admin)') || '',
    ipOdbio: get('IP adresa prilikom odbijanja ponude (admin)') || '',
    datumPrihvacanja: (datumPrihvacanjaSirovo instanceof Date) ? datumPrihvacanjaSirovo.toISOString() : '',
    imePotvrdio: get('Ime i prezime osobe koja je potvrdila ponudu (admin)') || '',
    funkcijaPotvrdio: get('Funkcija osobe koja je potvrdila ponudu (admin)') || '',
    ipPotvrdio: get('IP adresa prilikom potvrde ponude (admin)') || ''
  });

  var sada = new Date();
  var istek;
  if (koristiSate) {
    istek = new Date(sada.getTime() + ukupnoSati * 3600 * 1000);
  } else {
    istek = new Date();
    istek.setDate(istek.getDate() + brojDana);
    istek.setHours(23, 59, 59, 999);
  }
  var novaVerzija = (parseInt(get('Redni broj slanja ponude (admin)'), 10) || 1) + 1;
  var noviToken = Utilities.getUuid();

  set('Token za potvrdu ponude (admin)', noviToken);
  set('Redni broj slanja ponude (admin)', novaVerzija);
  set('Datum slanja aktivne ponude (admin)', sada);
  set('Datum isteka ponude (admin)', istek);
  set('Rok važenja ponude (dana, admin)', koristiSate ? '' : brojDana);
  set('Povijest prijašnjih slanja ponude (admin, JSON)', JSON.stringify(povijest));
  // Čista ploča za novu verziju — status prijašnje verzije je već siguran u
  // povijesti gore, ova polja sad opisuju SAMO novu, aktivnu ponudu.
  set('Datum odbijanja ponude (admin)', '');
  set('Razlog odbijanja ponude (admin)', '');
  set('Datum poništenja ponude (admin)', '');
  set('Datum prihvaćanja ponude (admin)', '');
  set('Ime i prezime osobe koja je potvrdila ponudu (admin)', '');
  set('Funkcija osobe koja je potvrdila ponudu (admin)', '');
  set('IP adresa prilikom potvrde ponude (admin)', '');
  set('Poveznica na dokument potvrde ponude (admin)', '');
  set('Datum poništenja prihvaćene ponude (admin)', '');
  set('Ime i prezime osobe koja je odbila ponudu (admin)', '');
  set('IP adresa prilikom odbijanja ponude (admin)', '');
  set('Poveznica na dokument odbijanja ponude (admin)', '');

  return {
    status: 'ok',
    verzija: novaVerzija,
    token: noviToken,
    link: POTVRDA_PONUDE_STRANICA_URL + '?token=' + encodeURIComponent(noviToken),
    datumSlanjaPrikaz: Utilities.formatDate(sada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm'),
    // Sekundna preciznost (vidi napomenu uz adminListEntries() gore).
    datumSlanjaPrikazSek: Utilities.formatDate(sada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm:ss'),
    // Puna preciznost (vidi identičnu napomenu uz adminPostaviRokPonude()
    // gore) — nužno otkad rok može isteći u proizvoljno vrijeme dana.
    datumIstekaPrikaz: Utilities.formatDate(istek, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm'),
    datumIstekaIso: istek.toISOString(),
    // Vraća se natrag da InTime_Admin.html odmah osvježi svoju (client-side)
    // kopiju u entry.fields bez čekanja na puno ponovno učitavanje popisa —
    // inače bi "Datum N" okvir upravo zaključane prijašnje verzije nakratko
    // nestao iz prikaza (vidi renderRokBlok_() u InTime_Admin.html).
    povijestJson: JSON.stringify(povijest)
  };
}

// Ručno poništenje ponude — Sašin izričit zahtjev (20.9.2026., dvadeset i
// treći krug): "ručna opcija da ja poništim ponudu... kliknem i ponistim
// ponudu... ponuda poništena". Dopušteno samo dok je ponuda još aktivna
// ('na_cekanju') ili istekla — NE nad već prihvaćenom/odbijenom/poništenom
// (te su već konačne). Nakon poništenja, poveznica koju klijent ima prestaje
// raditi (InTime_PotvrdaPonude.html prikazuje "poveznica više nije
// aktivna") — vidi potvrdaPonudeInfo()/potvrdiPonudu()/odbijPonudu() gore.
function adminPonistiPonudu(token, rowIndex) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var stanje = izracunajStatusPonude_(header, row);
  if (stanje !== 'na_cekanju' && stanje !== 'istekla') {
    return { status: 'error', message: 'Ponuda se može poništiti samo dok je na čekanju odgovora ili je istekla (trenutno: ' + (OPIS_STATUSA_PONUDE_[stanje] || stanje) + ').' };
  }
  var ponistenjeCol = header.indexOf('Datum poništenja ponude (admin)');
  if (ponistenjeCol === -1) { return { status: 'error', message: 'Stupac za poništenje ne postoji u tablici.' }; }
  var sada = new Date();
  sheet.getRange(rowIndex, ponistenjeCol + 1).setValue(sada);

  // Sašin izričit zahtjev (22.9.2026., trideset i treći krug): "odmah
  // poništi" — za razliku od odbijanja (koje gasi link tek nakon 30 min, jer
  // klijent možda još razgovara telefonom i predomisli se), ručno
  // poništenje je Sašina vlastita, svjesna odluka, pa dijeljeni POSLANO
  // direktorij postaje privatan ODMAH, bez odgode. Link za odluku
  // (potvrda/odbijanje) je već onemogućen kroz status 'ponistena' u
  // potvrdaPonudeInfo()/potvrdiPonudu()/odbijPonudu() gore — ovo gasi i
  // link NA DOKUMENTE. Umotano u try/catch — gašenje direktorija nikad ne
  // smije srušiti samo poništenje ponude.
  try {
    var aktivniFolderColPonisti_ = header.indexOf(ADMIN_ONLY_FIELDS.aktivni_folder_dokumenti_id);
    var aktivniFolderIdPonisti_ = (aktivniFolderColPonisti_ !== -1) ? String(row[aktivniFolderColPonisti_] || '').trim() : '';
    if (aktivniFolderIdPonisti_) {
      DriveApp.getFolderById(aktivniFolderIdPonisti_).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    }
  } catch (err) {
    // Folder možda ručno obrisan/premješten — poništenje ponude se svejedno
    // provodi, samo gašenje linka nije uspjelo.
  }

  return {
    status: 'ok',
    datumPonistenjaPrikaz: Utilities.formatDate(sada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm'),
    datumPonistenjaPrikazSek: Utilities.formatDate(sada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm:ss')
  };
}

// "Otključaj poništenu ponudu" — Sašin izričit zahtjev (22.9.2026., trideset
// i treći krug): "ako je nanovo odobrim s drugim vremenom da se onda
// otključa opet...znači link ostaje isti samo se promjeni vrijeme za
// odluku? i link za odluku ostaje isti?" — za razliku od
// adminGenerirajNovuPonudu() gore (koja stvara POSVE NOVI token/link/
// direktorij i arhivira prijašnju verziju u povijest), ova funkcija
// NAMJERNO zadržava ISTI token (pa i isti link za potvrdu/odbijanje) i ISTI
// dijeljeni POSLANO direktorij (pa i isti link na dokumente) — samo briše
// datum poništenja (status se time vraća na 'na_cekanju'/'istekla' ovisno o
// novom roku) i postavlja NOVI rok, te ponovno otvara dijeljenje direktorija
// koji je adminPonistiPonudu() gore ugasio. Dopušteno SAMO kad je ponuda
// trenutno 'ponistena' — za sve druge slučajeve postoji "Postavi rok"
// (adminPostaviRokPonude) ili "Generiraj novu ponudu"
// (adminGenerirajNovuPonudu). `brojDana`/`ukupnoSati` — isti obrazac kao
// adminPostaviRokPonude() gore.
function adminOtkljucajPonistenuPonudu(token, rowIndex, brojDana, ukupnoSati) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  ukupnoSati = ukupnoSati ? parseInt(ukupnoSati, 10) : 0;
  var koristiSate = ukupnoSati > 0;
  if (koristiSate) {
    if (ukupnoSati < 1 || ukupnoSati > 8760) { return { status: 'error', message: 'Prilagođeni rok mora biti između 1 sat i 365 dana (8760 sati).' }; }
  } else {
    brojDana = parseInt(brojDana, 10);
    if (!brojDana || brojDana < 1 || brojDana > 365) { return { status: 'error', message: 'Neispravan broj dana.' }; }
  }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var stanje = izracunajStatusPonude_(header, row);
  if (stanje !== 'ponistena') {
    return { status: 'error', message: 'Otključati se može samo ponuda koja je poništena (trenutno: ' + (OPIS_STATUSA_PONUDE_[stanje] || stanje) + ').' };
  }

  var rokDanaCol = header.indexOf('Rok važenja ponude (dana, admin)');
  var istekCol = header.indexOf('Datum isteka ponude (admin)');
  var ponistenjeCol = header.indexOf('Datum poništenja ponude (admin)');
  if (istekCol === -1 || ponistenjeCol === -1) { return { status: 'error', message: 'Potrebni stupci ne postoje u tablici.' }; }

  var sada = new Date();
  var istek;
  if (koristiSate) {
    istek = new Date(sada.getTime() + ukupnoSati * 3600 * 1000);
  } else {
    istek = new Date();
    istek.setDate(istek.getDate() + brojDana);
    istek.setHours(23, 59, 59, 999);
  }

  // Redoslijed namjerno: prvo novi rok, PA TEK ONDA brisanje datuma
  // poništenja — izracunajStatusPonude_() provjerava poništenje PRIJE
  // isteka, pa dok je datum poništenja još upisan, status ostaje
  // 'ponistena' i sve je sigurno u međukoraku ako nešto ovdje pukne.
  sheet.getRange(rowIndex, istekCol + 1).setValue(istek);
  if (rokDanaCol !== -1) { sheet.getRange(rowIndex, rokDanaCol + 1).setValue(koristiSate ? '' : brojDana); }
  sheet.getRange(rowIndex, ponistenjeCol + 1).setValue('');

  // Token za potvrdu/odbijanje (link za odluku), šifra ponude, redni broj
  // slanja, link na dokumente i ID aktivnog direktorija dokumenata se
  // NAMJERNO NE DIRAJU — to je cijela poanta ove funkcije (isti link,
  // samo novo vrijeme za odluku).
  var aktivniFolderColOtkljucaj_ = header.indexOf(ADMIN_ONLY_FIELDS.aktivni_folder_dokumenti_id);
  var aktivniFolderIdOtkljucaj_ = (aktivniFolderColOtkljucaj_ !== -1) ? String(row[aktivniFolderColOtkljucaj_] || '').trim() : '';
  var linkVracen = false;
  if (aktivniFolderIdOtkljucaj_) {
    try {
      DriveApp.getFolderById(aktivniFolderIdOtkljucaj_).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      linkVracen = true;
    } catch (err) {
      // Folder možda ručno obrisan/premješten — otključavanje ponude se
      // svejedno provodi (klijent će moći opet prihvatiti/odbiti), samo
      // link na dokumente ostaje ugašen dok se ručno ne provjeri.
    }
  }

  return {
    status: 'ok',
    datumIstekaPrikaz: Utilities.formatDate(istek, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm'),
    datumIstekaIso: istek.toISOString(),
    linkDokumenataVracen: linkVracen
  };
}

// "Sigurnosni okidač" — Sašin izričit zahtjev (20.9.2026., dvadeset i sedmi
// krug): "ako ponudu i prihvate trebam imati mogućnost da je ja poništim...
// u tom slučaju ide povratni mail prema osobama koji su prihvatili ponudu".
// Za razliku od adminPonistiPonudu() gore (dopušteno SAMO dok NIJE
// prihvaćena), ova funkcija radi TOČNO SUPROTNO — dopuštena je SAMO kad JE
// ponuda već prihvaćena ('potvrdjena'). Polja prihvaćanja (datum, ime,
// funkcija, IP) se namjerno NE brišu — ostaju trajan trag da je do
// prihvaćanja došlo, samo se dodaje datum poništenja PREKO njega (vidi
// izracunajStatusPonude_() gore, koji ovaj novi datum provjerava prije
// 'potvrdjena'). Mail ide na SVE adrese s kojih je ponuda poslana (isti
// popis kao kod slanja same ponude, ADMIN_ONLY_FIELDS.mail_adrese_ponude) —
// pojedinačna adresa osobe koja je BAŠ kliknula "Prihvaćam" se ne
// bilježi (potvrdiPonudu() ne traži e-mail, samo OIB/ime/funkciju), pa je
// ovo najbliži praktičan doseg svih uključenih primatelja ponude.
function adminPonistiPrihvacenuPonudu(token, rowIndex) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var stanje = izracunajStatusPonude_(header, row);
  if (stanje !== 'potvrdjena') {
    return { status: 'error', message: 'Poništiti prihvaćenu ponudu moguće je samo dok je status "Prihvaćena" (trenutno: ' + (OPIS_STATUSA_PONUDE_[stanje] || stanje) + ').' };
  }
  var ponistenjeCol = header.indexOf('Datum poništenja prihvaćene ponude (admin)');
  if (ponistenjeCol === -1) { return { status: 'error', message: 'Stupac za poništenje prihvaćene ponude ne postoji u tablici.' }; }
  var sada = new Date();
  sheet.getRange(rowIndex, ponistenjeCol + 1).setValue(sada);

  var naziv = String(row[header.indexOf('Naziv tvrtke')] || '').trim() || '(bez naziva)';
  var sifraPonude = String(row[header.indexOf('Šifra ponude (admin)')] || '').trim() || '(bez broja ponude)';
  var mailAdreseSirovo = String(row[header.indexOf('Mail adrese za slanje ponude (admin)')] || '').trim();
  var primatelji = mailAdreseSirovo ? mailAdreseSirovo.split(',').map(function(a) { return a.trim(); }).filter(function(a) { return EMAIL_REGEX_.test(a); }) : [];

  var poslanoNa = [];
  if (primatelji.length) {
    try {
      var tijelo = 'Poštovani,\n\n' +
        'nažalost, moramo Vas obavijestiti da ponuda broj ' + sifraPonude + ' nije odobrena od strane Uprave In Time d.o.o. u Zagrebu.\n\n' +
        'Uskoro ćemo Vas kontaktirati s izmijenjenom ponudom.\n\n' +
        'Srdačan pozdrav / Kind regards,\n\n' +
        'Saša Batinac\n' +
        'Voditelj ključnih kupaca';
      GmailApp.sendEmail(primatelji.join(','), 'Obavijest o ponudi ' + sifraPonude, tijelo, { bcc: NOTIFY_EMAIL });
      poslanoNa = primatelji;
    } catch (err) {
      // Slanje maila ne smije srušiti samo poništenje — Saša svejedno vidi
      // (niže, kroz upozorenje na klijentskoj strani u InTime_Admin.html)
      // ako primatelji ostanu prazni.
    }
  }

  return {
    status: 'ok',
    datumPonistenjaPrikaz: Utilities.formatDate(sada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm:ss'),
    poslanoNa: poslanoNa
  };
}

// Export podataka odabranog klijenta iz upitnika na Drive — prvi korak
// admin-kontrolnog-centra (Faza 1, 19.9.2026., vidi
// claude/admin-kontrolni-centar-plan.md u Projectu za cijeli plan). Stvara
// (ili ponovno koristi, ako klijent već ima folder od ranijeg exporta)
// poddirektorij "POTENCIJALNI KLIJENTI/PRODAJNI UPITNIK - {Naziv tvrtke} -
// {OIB} - {Mjesto}" i u njega sprema dokument sa svim popunjenim odgovorima
// iz upitnika, organiziran po poglavljima istim redoslijedom kao
// UPIT_FIELDS. Saša to koristi kao osnovu za ručnu izradu ponude izvan
// sustava.
//
// Sašin izričit zahtjev (19.9.2026., deveti krug):
// export se gradi kao Google dokument (DocumentApp, formatiran s naslovima/
// poglavljima — vidi buildKlijentExportDoc_() niže) umjesto običnog .txt, da
// bude pregledniji za nekog tko ga čita. Google dokument je Wordu
// ekvivalentan format za čitanje/uređivanje — bilo tko ga može izravno
// otvoriti u pregledniku, ili preuzeti kao pravi .docx jednim klikom (u
// dokumentu: Datoteka → Preuzmi → Microsoft Word). NAPOMENA: izravno
// stvaranje BINARNOG .docx zahtijeva uključivanje naprednog "Drive API"
// servisa u Apps Script projektu (ručni korak koji Saša mora sam uključiti,
// i može se pokvariti ako se ikad isključi) — ovo rješenje namjerno to
// izbjegava dok Saša ne potvrdi da mu baš treba binarni .docx.
//
// Sašin izričit zahtjev (19.9.2026., deseti krug) — naziv direktorija i
// naziv same datoteke promijenjeni na fiksni, prepoznatljiv obrazac:
// - Direktorij: "PRODAJNI UPITNIK - {Naziv tvrtke} - {OIB} - {Mjesto}"
// - Datoteka:   "PRODAJNI UPITNIK - {Šifra upitnika} - {Naziv tvrtke} -
//               {OIB} - {Mjesto}"
// Šifra upitnika (stupac "Broj", generira se JEDNOM kod slanja upitnika,
// vidi saveUpit()/generirajBroj_) je jedinstvena po upitniku, pa naziv
// datoteke više ne treba datum da bi izbjegao gomilanje duplikata — isti
// redak UVIJEK proizvodi ISTI naziv datoteke, pa ponovljeni klik na "Export
// podataka" (bilo kojeg dana) samo zamijeni prethodni export istog
// upitnika, nikad ne stvara dvije kopije.
function adminExportKlijent(token, rowIndex) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }

  var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
  var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var fields = {};
  for (var c = 0; c < header.length; c++) {
    var v = row[c];
    fields[header[c]] = (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm') : v;
  }

  var naziv = (fields['Naziv tvrtke'] || '').toString().trim() || '(bez naziva)';
  var grad = (fields['Mjesto'] || '').toString().trim().toUpperCase() || '(bez mjesta)';
  var oib = (fields['OIB'] || '').toString().trim() || '(bez OIB-a)';
  var brojUpitnika = (fields['Broj'] || '').toString().trim() || '(bez šifre)';
  // ISPRAVAK (23. krug, Sašin izričit zahtjev — "export podataka iz ponude
  // treba ići u klijentov osnovni direktorij, a ne u kategoriju 'prodajni
  // upitnik', jer smo to već prebacili na viši nivo ponude"): export ide u
  // ISTI klijentov osnovni direktorij kao i ostatak ponude ("PONUDA - Naziv
  // - OIB - GRAD", pod sub.ponude — isti obrazac kao adminUploadPonudaDokument/
  // adminPripremiDokumenteZaPonudu/stvoriDokumentPotvrdePonude_), umjesto
  // dosadašnjeg zasebnog "PRODAJNI UPITNIK - ..." direktorija pod
  // POTENCIJALNI KLIJENTI. Naziv same DATOTEKE ostaje prepoznatljiv po
  // istom obrascu kao prije ("PRODAJNI UPITNIK - {šifra} - ..."), mijenja se
  // samo direktorij u koji se sprema.
  var folderName = 'PONUDA - ' + naziv + ' - ' + oib + ' - ' + grad;

  try {
    var sub = getSustavSubfolders_();
    var klijentFolder = getOrCreateChildFolder_(sub.ponude, folderName);

    var filename = 'PRODAJNI UPITNIK - ' + brojUpitnika + ' - ' + naziv + ' - ' + oib + ' - ' + grad;

    // Ukloni export ISTOG NAZIVA ako postoji — budući da naziv sadrži
    // jedinstvenu šifru upitnika (ne datum), ponovljeni klik na "Export
    // podataka" za isti redak UVIJEK proizvodi isti naziv i samo zamijeni
    // stari export, bez obzira koji je dan.
    var postojeci = klijentFolder.getFilesByName(filename);
    while (postojeci.hasNext()) { postojeci.next().setTrashed(true); }

    var doc = DocumentApp.create(filename);
    buildKlijentExportDoc_(doc, fields);
    doc.saveAndClose();
    var docFile = DriveApp.getFileById(doc.getId());
    // DocumentApp.create() stvara dokument u korijenu Drivea (Sašinog) —
    // premjesti ga u klijentov folder i ukloni iz korijena da ne ostane
    // dvostruko vidljiv/razbacan.
    klijentFolder.addFile(docFile);
    DriveApp.getRootFolder().removeFile(docFile);

    return { status: 'ok', folderUrl: klijentFolder.getUrl(), folderName: folderName, fileUrl: docFile.getUrl() };
  } catch (err) {
    return { status: 'error', message: 'Export nije uspio: ' + err.message };
  }
}

// NOVO (19.9.2026., Sašin izričit zahtjev — "napravi mi export odbijenice i
// export ankete kvalitete...isto kao i ovo sto smo napravili...u posebnim
// direktorijima..po logici označavanja kao i za upitnik"): isti obrazac kao
// adminExportKlijent() iznad, ali za Odbijenicu (redak i dalje živi u ISTOM
// "InTime_Upiti" Sheetu, samo Tip='Odbijenica' — vidi saveOdbijenica()).
// Sprema se u ZASEBAN poddirektorij "ODBIJENICE" (ne u POTENCIJALNI
// KLIJENTI). Odbijenica nema polje "Mjesto" (forma za odbijanje ga ne
// prikuplja), pa naziv foldera/datoteke izostavlja taj dio umjesto da svugdje
// ispisuje isti placeholder "(bez mjesta)" — logika označavanja (prefiks
// tipa, pa Naziv/OIB, datoteka dodatno s jedinstvenom šifrom na početku) je
// inače identična onoj za upitnik.
function adminExportOdbijenica(token, rowIndex) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }

  var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
  var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var fields = {};
  for (var c = 0; c < header.length; c++) {
    var v = row[c];
    fields[header[c]] = (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm') : v;
  }

  var naziv = (fields['Naziv tvrtke'] || '').toString().trim() || '(bez naziva)';
  var oib = (fields['OIB'] || '').toString().trim() || '(bez OIB-a)';
  var brojOdbijenice = (fields['Broj'] || '').toString().trim() || '(bez šifre)';
  var folderName = 'ODBIJENICA - ' + naziv + ' - ' + oib;

  try {
    var sub = getSustavSubfolders_();
    var klijentFolder = getOrCreateChildFolder_(sub.odbijenice, folderName);

    var filename = 'ODBIJENICA - ' + brojOdbijenice + ' - ' + naziv + ' - ' + oib;

    var postojeci = klijentFolder.getFilesByName(filename);
    while (postojeci.hasNext()) { postojeci.next().setTrashed(true); }

    var doc = DocumentApp.create(filename);
    buildOdbijenicaExportDoc_(doc, fields);
    doc.saveAndClose();
    var docFile = DriveApp.getFileById(doc.getId());
    klijentFolder.addFile(docFile);
    DriveApp.getRootFolder().removeFile(docFile);

    return { status: 'ok', folderUrl: klijentFolder.getUrl(), folderName: folderName, fileUrl: docFile.getUrl() };
  } catch (err) {
    return { status: 'error', message: 'Export nije uspio: ' + err.message };
  }
}

// NOVO (19.9.2026., isti zahtjev kao adminExportOdbijenica iznad) — export za
// Anketu o kvaliteti usluge. Za razliku od Upitnika/Odbijenice, Anketa živi u
// SVOM VLASTITOM Sheetu ("InTime_Ankete", vidi getOrCreateAnketaSheet()), pa
// se ovdje čita taj Sheet umjesto "InTime_Upiti". Sprema se u zaseban
// poddirektorij "OCJENE KVALITETE". Anketa također nema polje "Mjesto".
function adminExportAnketa(token, rowIndex) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateAnketaSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }

  var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeAnkete_();
  var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var fields = {};
  for (var c = 0; c < header.length; c++) {
    var v = row[c];
    fields[header[c]] = (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm') : v;
  }

  var naziv = (fields['Naziv poslovnog subjekta'] || '').toString().trim() || '(bez naziva)';
  var oib = (fields['OIB poslovnog subjekta'] || '').toString().trim() || '(bez OIB-a)';
  var brojAnkete = (fields['Broj'] || '').toString().trim() || '(bez šifre)';
  var folderName = 'OCJENA KVALITETE - ' + naziv + ' - ' + oib;

  try {
    var sub = getSustavSubfolders_();
    var klijentFolder = getOrCreateChildFolder_(sub.oceneKvalitete, folderName);

    var filename = 'OCJENA KVALITETE - ' + brojAnkete + ' - ' + naziv + ' - ' + oib;

    var postojeci = klijentFolder.getFilesByName(filename);
    while (postojeci.hasNext()) { postojeci.next().setTrashed(true); }

    var doc = DocumentApp.create(filename);
    buildAnketaExportDoc_(doc, fields);
    doc.saveAndClose();
    var docFile = DriveApp.getFileById(doc.getId());
    klijentFolder.addFile(docFile);
    DriveApp.getRootFolder().removeFile(docFile);

    return { status: 'ok', folderUrl: klijentFolder.getUrl(), folderName: folderName, fileUrl: docFile.getUrl() };
  } catch (err) {
    return { status: 'error', message: 'Export nije uspio: ' + err.message };
  }
}

// Gradi čitljiv, formatiran sadržaj exporta izravno u Google dokument —
// naslov, poglavlja kao podnaslovi (UPIT_FIELDS {sec:...} markeri), pa
// "Naziv polja: vrijednost" po retku unutar svakog poglavlja, prazna polja
// se preskaču radi preglednosti. Zamjena za stari buildKlijentExportText_()
// (obični .txt) — Sašin izričit zahtjev (19.9.2026., deveti krug) da export
// bude u formatu čitljivom kao Word dokument, ne golom tekstu.
function buildKlijentExportDoc_(doc, fields) {
  // Napomena KAM-a (20.9.2026., Sašin izričit zahtjev) — posve odvojeno
  // admin-only polje (ADMIN_ONLY_FIELDS, ne UPIT_FIELDS), pa ga
  // popuniExportDoc_() ne bi inače uključio (ona iterira SAMO fieldsSpec).
  // Namjerno se UVIJEK dodaje na SAM KRAJ ovog exporta (Sašin izričit
  // zahtjev — "to se eksportira uvijek"), istaknuto naslovom, jer je ova
  // napomena zamišljena baš za dijeljenje kroz taj export. Odbijenica/
  // Anketa export (popuniExportDoc_ pozivi niže) je NE uključuju — polje se
  // odnosi isključivo na klijente/zainteresirane.
  var napomenaKam = (fields['Napomena KAM-a (admin)'] || '').toString().trim();
  popuniExportDoc_(doc.getBody(), 'IN TIME — Podaci klijenta iz upitnika', 'Šifra upitnika', fields, UPIT_FIELDS,
    napomenaKam ? [{ naslov: 'Napomena KAM-a', tekst: napomenaKam }] : null);
}

// NOVO (19.9.2026.) — izdvojena zajednička logika iz buildKlijentExportDoc_
// (iznad) da je mogu ponovno koristiti i buildOdbijenicaExportDoc_ i
// buildAnketaExportDoc_ niže — sve tri admin-export funkcije (Export
// podataka za Upitnik/Odbijenicu/Ocjenu kvalitete) grade Google dokument na
// identičan način: naslov, datum izvoza, šifra, pa poglavlja (sec markeri)
// i "Naziv polja: vrijednost" po retku, prazna polja preskočena — razlikuje
// se samo popis polja (fieldsSpec: UPIT_FIELDS / ANKETA_FIELDS / novi
// ODBIJENICA_EXPORT_FIELDS) i tekst naslova/oznake šifre.
// `dodatniNaKraju` (opcionalno) — popis {naslov, tekst} blokova koji se
// dodaju SAMOSTALNO na sam kraj dokumenta, IZVAN fieldsSpec petlje, svaki
// s vlastitim HEADING2 naslovom (za razliku od običnih "Naziv: vrijednost"
// redaka gore) — koristi ga trenutno samo buildKlijentExportDoc_() za
// "Napomenu KAM-a" (20.9.2026.), koja nije dio UPIT_FIELDS/ANKETA_FIELDS/
// ODBIJENICA_EXPORT_FIELDS popisa pa je ne bi pokrila petlja ispod.
function popuniExportDoc_(body, naslovText, sifraLabel, fields, fieldsSpec, dodatniNaKraju) {
  body.clear();

  var naslov = body.appendParagraph(naslovText);
  naslov.setHeading(DocumentApp.ParagraphHeading.TITLE);

  var datumP = body.appendParagraph('Izvezeno: ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm'));
  datumP.setFontSize(10).setForegroundColor('#666666');

  var broj = fields['Broj'];
  if (broj) {
    var sifraP = body.appendParagraph(sifraLabel + ': ' + broj);
    sifraP.setFontSize(10).setForegroundColor('#666666');
  }

  for (var i = 0; i < fieldsSpec.length; i++) {
    var f = fieldsSpec[i];
    if (f.sec) {
      var h = body.appendParagraph(f.sec);
      h.setHeading(DocumentApp.ParagraphHeading.HEADING2);
      continue;
    }
    var label = f[1];
    var value = fields[label];
    if (value === undefined || value === null || value === '') { continue; }
    body.appendParagraph(label + ': ' + value);
  }

  if (dodatniNaKraju) {
    for (var j = 0; j < dodatniNaKraju.length; j++) {
      var blok = dodatniNaKraju[j];
      var bh = body.appendParagraph(blok.naslov);
      bh.setHeading(DocumentApp.ParagraphHeading.HEADING2);
      body.appendParagraph(blok.tekst);
    }
  }
}

// NOVO (19.9.2026., Sašin izričit zahtjev) — popis polja (stvarni naslovi
// stupaca iz "InTime_Upiti" Sheeta, isti sheet koji dijele Upitnik i
// Odbijenica) za export Odbijenice — vidi adminExportOdbijenica() niže.
// NAPOMENA: ovo NIJE isto što i ODBIJENICA_CONFIRM_FIELDS (koristi se za
// mail klijentu, radi na sirovom POST payloadu s drugačijim labelima poput
// "OIB poslovnog subjekta") — export čita iz Sheeta pa MORA koristiti točne
// naslove stupaca kako ih generira izracunajOcekivanoZaglavljeUpiti_()
// (npr. "OIB", ne "OIB poslovnog subjekta"; "Kontakt ime (odbijenica)", ne
// "Kontakt ime"). Ključevi u parovima niže su samo simbolični (nisu stvarno
// korišteni), format je zadržan radi doslovne kompatibilnosti s
// popuniExportDoc_().
var ODBIJENICA_EXPORT_FIELDS = [
  {sec:'Podaci o unosu'},
  ['vrijeme_dolaska', 'Vrijeme dolaska na stranicu'],
  ['vrijeme_pocetka_popunjavanja', 'Vrijeme početka popunjavanja upitnika'],
  ['vrijeme_slanja', 'Vrijeme slanja upitnika'],
  ['vrijeme_popunjavanja', 'Vrijeme popunjavanja (trajanje)'],
  {sec:'Podaci o poslovnom subjektu'},
  ['naziv', 'Naziv tvrtke'],
  ['oib', 'OIB'],
  {sec:'Trenutni logistički partneri'},
  ['logisticke_sluzbe', 'Trenutne logističke službe'],
  ['logisticke_sluzbe_ostalo', 'Logističke službe – ostalo'],
  ['nova_tvrtka_bez_logistike', 'Novoosnovan subjekt bez dosadašnje suradnje s logističkim službama'],
  {sec:'Kontakt osoba'},
  ['odbijenica_kontakt_ime', 'Kontakt ime (odbijenica)'],
  ['odbijenica_kontakt_prezime', 'Kontakt prezime (odbijenica)'],
  ['odbijenica_telefon', 'Telefon (odbijenica)'],
  ['odbijenica_email', 'Email (odbijenica)'],
  {sec:'Razlog nezainteresiranosti'},
  ['razlog', 'Razlog (odbijenica)'],
  ['razlog_ostalo', 'Razlog – Ostalo, tekst (odbijenica)'],
  {sec:'Ostalo'},
  ['odbijenica_newsletter', 'Newsletter pristanak (odbijenica)']
];

function buildOdbijenicaExportDoc_(doc, fields) {
  // Napomena KAM-a (20.9.2026., drugi val — vidi buildKlijentExportDoc_ za
  // isti obrazac): Odbijenica dijeli "InTime_Upiti" Sheet s Upitnikom, pa
  // `fields` ovdje već ima stupac 'Napomena KAM-a (admin)' kad postoji.
  var napomenaKamOdbijenica = (fields['Napomena KAM-a (admin)'] || '').toString().trim();
  popuniExportDoc_(doc.getBody(), 'IN TIME — Odgovor na upitnik (nije zainteresiran/a)', 'Šifra odbijenice', fields, ODBIJENICA_EXPORT_FIELDS,
    napomenaKamOdbijenica ? [{ naslov: 'Napomena KAM-a', tekst: napomenaKamOdbijenica }] : null);
}

// ANKETA_FIELDS već ima točan format (sec markeri + [key,label] parovi s
// labelima koji doslovno odgovaraju stupcima "InTime_Ankete" Sheeta, vidi
// izracunajOcekivanoZaglavljeAnkete_()) — može se izravno ponovno koristiti,
// bez posebnog ANKETA_EXPORT_FIELDS popisa.
function buildAnketaExportDoc_(doc, fields) {
  // Napomena KAM-a (20.9.2026., drugi val) — vidi buildKlijentExportDoc_.
  var napomenaKamAnketa = (fields['Napomena KAM-a (admin)'] || '').toString().trim();
  popuniExportDoc_(doc.getBody(), 'IN TIME — Anketa o kvaliteti usluge', 'Šifra ocjene kvalitete', fields, ANKETA_FIELDS,
    napomenaKamAnketa ? [{ naslov: 'Napomena KAM-a', tekst: napomenaKamAnketa }] : null);
}

// Upisuje "Napomena KAM-a" za redak ANKETE — Anketa živi u vlastitom
// "InTime_Ankete" Sheetu (za razliku od Upitnika/Odbijenice, koji dijele
// "InTime_Upiti"), pa je postojeća adminUpdateFields() (radi isključivo nad
// getOrCreateUpitiSheet()) ovdje neupotrebljiva — otud zasebna, ali svjesno
// MINIMALNA funkcija: dopušta SAMO ključeve iz ADMIN_ONLY_FIELDS (danas
// jedino 'napomena_kam' ima odgovarajući stupac u ovom Sheetu — svaki drugi
// ključ jednostavno neće naći stupac pa se tiho preskače), NIKAD ključeve
// iz ANKETA_FIELDS (stvarni odgovori na anketu ostaju trajno nedostupni za
// ručnu izmjenu iz admina — to nije traženo niti poželjno).
function adminUpdateAnketaFields(token, rowIndex, fields) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateAnketaSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  fields = fields || {};
  var primijenjenoPolja = 0;
  Object.keys(fields).forEach(function(key) {
    var colLabel = ADMIN_ONLY_FIELDS[key];
    if (!colLabel) { return; }
    var colIdx = header.indexOf(colLabel);
    if (colIdx === -1) { return; }
    sheet.getRange(rowIndex, colIdx + 1).setValue(fields[key]);
    primijenjenoPolja++;
  });
  return { status: 'ok', primijenjenoPolja: primijenjenoPolja };
}

// Briše CIJELI redak upita iz Sheeta. Server-side dvostruka provjera
// (uz client-side "upišite BRISATI" gate u admin.html) — confirmWord MORA
// biti točno "BRISATI", inače se ništa ne briše.
function adminDeleteEntry(token, rowIndex, confirmWord) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  if (confirmWord !== 'BRISATI') { return { status: 'error', message: 'Potvrda nije ispravna — potrebno je upisati točno riječ BRISATI.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  sheet.deleteRow(rowIndex);
  return { status: 'ok' };
}

// Admin postavlja/mijenja KOJA poglavlja (1-12) klijent smije ispraviti putem
// InTime_Ispravak.html za dani redak — potpuno zamjenjuje prethodni popis
// (ne dodaje na njega). Prazan niz = ništa odobreno (klijent samo gleda).
// Saša ovo poziva klikom na "Spremi odobrenje" u admin.html (checkboxovi po
// poglavlju + brzi "Sve" gumb). Vidi opširnu napomenu uz POGLAVLJA_ISPRAVAK.
function adminSetIspravakOdobrenje(token, rowIndex, poglavlja) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = header.indexOf('Odobrena poglavlja za ispravak (admin, brojevi odvojeni zarezom)');
  if (col === -1) { return { status: 'error', message: 'Stupac za odobrenje ne postoji u tablici.' }; }
  var brojevi = (poglavlja || [])
    .map(function(n) { return parseInt(n, 10); })
    .filter(function(n) { return !isNaN(n) && n >= 1 && n <= 12; });
  sheet.getRange(rowIndex, col + 1).setValue(brojevi.join(','));
  return { status: 'ok' };
}

// ============================================================
// ISPRAVAK PODATAKA (klijent naknadno mijenja svoj upit) — InTime_Ispravak.html
//
// Tok: (1) klijent kod slanja upitnika (saveUpit niže) dobije jedinstveni
// token (dio poveznice) i lozinku, oboje generirano ovdje na backendu i
// poslano mailom; (2) klijent otvori InTime_Ispravak.html?token=... i unese
// lozinku (ispravakLogin) — VIDI podatke uvijek, ali ih može UREĐIVATI samo
// u poglavljima koja je Saša prethodno odobrio (adminSetIspravakOdobrenje
// iznad, kontrolirano iz admin.html); (3) klijent sprema izmjene
// (ispravakSaveChanges) — server ponovno provjerava token+lozinku I koja su
// poglavlja odobrena (klijentska strana NIJE pouzdana granica sigurnosti,
// samo UX), i NIKAD ne dopušta izmjenu naziva tvrtke ni OIB-a, bez obzira na
// odobrena poglavlja — te dvije vrijednosti mijenja isključivo Saša, kroz
// admin stranicu (adminUpdateFields()).
// ============================================================

// Nasumična, lako čitljiva lozinka (bez 0/O/1/l/I radi manje pogrešaka pri
// prepisivanju) — sekundarni sloj sigurnosti uz sami (dugi, teško pogodivi)
// token u poveznici. Sustavom generirana lozinka, ne korisnički odabrana, pa
// se (za razliku od admin lozinke) namjerno ne hashira — složenost hashiranja
// ovdje ne donosi stvarnu dodatnu zaštitu, a Sheet je dostupan samo Saši.
function generirajLozinku_() {
  var znakovi = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  var out = '';
  for (var i = 0; i < 10; i++) {
    out += znakovi.charAt(Math.floor(Math.random() * znakovi.length));
  }
  return out;
}

// Pronalazi redak po tokenu za ispravak (skenira Sheet) — vraća null ako
// token nije prazan/pronađen (prazan token NIKAD ne smije "pogoditi" retke
// gdje je taj stupac prazan, npr. Odbijenica retke — provjera niže to sprječava).
function pronadjiRedakPoTokenu_(token) {
  if (!token) { return null; }
  var sheet = getOrCreateUpitiSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return null; }
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var tokenCol = header.indexOf('Token za ispravak (admin)');
  var lozinkaCol = header.indexOf('Lozinka za ispravak (admin)');
  var odobrenaCol = header.indexOf('Odobrena poglavlja za ispravak (admin, brojevi odvojeni zarezom)');
  if (tokenCol === -1) { return null; }
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][tokenCol] && String(data[i][tokenCol]) === String(token)) {
      return {
        rowIndex: i + 2,
        header: header,
        row: data[i],
        lozinka: String(data[i][lozinkaCol] || ''),
        odobrenaPoglavljaRaw: String(data[i][odobrenaCol] || '')
      };
    }
  }
  return null;
}

function parsirajOdobrenaPoglavlja_(raw) {
  if (!raw) { return []; }
  return String(raw).split(',')
    .map(function(s) { return parseInt(String(s).trim(), 10); })
    .filter(function(n) { return !isNaN(n); });
}

// Prijava klijenta na stranicu za ispravak — token (iz poveznice) + lozinka
// (iz maila). Uvijek vraća PUN prikaz podataka (za pregled), plus popis
// odobrenih poglavlja — InTime_Ispravak.html prikazuje polja izvan odobrenih
// poglavlja kao samo-za-čitanje.
//
// VAŽNO: `fields` je namjerno KLJUČAN PO KRATKOM KLJUČU polja (isti ključevi
// kao u UPIT_FIELDS[i][0] i POGLAVLJA_ISPRAVAK.polja), NE po hrvatskom nazivu
// stupca — tako InTime_Ispravak.html može izravno spojiti prikaz s
// POGLAVLJA_ISPRAVAK mapom i s onim što šalje natrag u ispravakSaveChanges()
// (koji također očekuje `izmjene` ključan po kratkom ključu). Svaki unos
// nosi i `label` (naziv stupca za prikaz) da ga frontend ne mora duplicirati.
function ispravakLogin(token, lozinka) {
  var found = pronadjiRedakPoTokenu_(token);
  if (!found || !lozinka || found.lozinka !== String(lozinka)) {
    return { status: 'error', message: 'Neispravna poveznica ili lozinka.' };
  }
  var polja = {};
  for (var i = 0; i < UPIT_FIELDS.length; i++) {
    var f = UPIT_FIELDS[i];
    if (f.sec) { continue; }
    var colIdx = found.header.indexOf(f[1]);
    if (colIdx === -1) { continue; }
    var v = found.row[colIdx];
    polja[f[0]] = {
      label: f[1],
      value: (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm') : v
    };
  }
  return {
    status: 'ok',
    fields: polja,
    odobrenaPoglavlja: parsirajOdobrenaPoglavlja_(found.odobrenaPoglavljaRaw)
  };
}

// Sprema izmjene koje je klijent unio na InTime_Ispravak.html. `izmjene` je
// mapa {ključ_polja: nova_vrijednost}. SERVER (ne klijent) je autoritet za to
// koja su polja stvarno dozvoljena — ključevi izvan trenutno odobrenih
// poglavlja, kao i 'naziv'/'oib' (uvijek), tiho se preskaču.
function ispravakSaveChanges(token, lozinka, izmjene) {
  var found = pronadjiRedakPoTokenu_(token);
  if (!found || !lozinka || found.lozinka !== String(lozinka)) {
    return { status: 'error', message: 'Neispravna poveznica ili lozinka.' };
  }
  var odobrenaBrojevi = parsirajOdobrenaPoglavlja_(found.odobrenaPoglavljaRaw);
  if (odobrenaBrojevi.length === 0) {
    return { status: 'error', message: 'In Time d.o.o. još nije odobrio ispravak podataka za ovaj upit. Za odobrenje nas kontaktirajte na sbatinac.intime@gmail.com.' };
  }
  var dozvoljeniKljucevi = {};
  POGLAVLJA_ISPRAVAK.forEach(function(p) {
    if (odobrenaBrojevi.indexOf(p.broj) !== -1) {
      p.polja.forEach(function(k) { dozvoljeniKljucevi[k] = true; });
    }
  });
  // Naziv tvrtke i OIB NIKAD nisu izmjenjivi od strane klijenta, bez obzira
  // na odobrena poglavlja — vidi opširnu napomenu uz POGLAVLJA_ISPRAVAK.
  delete dozvoljeniKljucevi.naziv;
  delete dozvoljeniKljucevi.oib;

  var sheet = getOrCreateUpitiSheet();
  var header = found.header;
  izmjene = izmjene || {};
  var primijenjenoPolja = 0;
  Object.keys(izmjene).forEach(function(kljuc) {
    if (!dozvoljeniKljucevi[kljuc]) { return; }
    var f = UPIT_FIELDS_BY_KEY_[kljuc];
    if (!f) { return; }
    var colIdx = header.indexOf(f[1]);
    if (colIdx === -1) { return; }
    sheet.getRange(found.rowIndex, colIdx + 1).setValue(izmjene[kljuc]);
    primijenjenoPolja++;
  });
  return { status: 'ok', primijenjenoPolja: primijenjenoPolja };
}

// ---- PROVJERA DUPLIKATA (OIB / naziv+oblik poslovnog subjekta) ----
// Poziva se SINKRONO iz sva tri obrasca (Interes, Odbijenica, Anketa), TIK
// PRIJE stvarnog slanja (za razliku od fire-and-forget submita). Pravila po
// tipu su NAMJERNO različita (Sašin izričit zahtjev 20.9.2026., IZMIJENJENO
// isti dan — vidi ispravku niže):
//
// - 'interes' (glavni upitnik): tvrtka s istim OIB-om, ili istim nazivom I
//   istim oblikom poslovnog subjekta, smije poslati SAMO JEDNOM, trajno.
//   Uspoređuje se ISKLJUČIVO protiv postojećih "Interes" redaka — prethodna
//   Odbijenica ili Anketa NE blokira novi Interes (klijent koji je nekad
//   odbio ponudu i dalje može kasnije poslati upitnik interesa).
// - 'odbijenica': ISPRAVLJENO (Sašin izričit zahtjev, isti dan) — VIŠE NIJE
//   trajna blokada. Tvrtka s istim OIB-om smije ponovno poslati Odbijenicu
//   čim prođe 30 dana od zadnjeg unosa (isti cooldown princip kao Anketa) —
//   delegirano u provjeriDuplikatOdbijenica_() niže, koja gleda "InTime_Upiti"
//   sheet filtrirano na Tip='Odbijenica'.
// - 'anketa': tvrtka s istim OIB-om smije poslati anketu kvalitete
//   najviše 1x svakih 30 dana (cooldown, NE trajna blokada) — delegirano u
//   provjeriDuplikatAnkete_() niže, koja gleda zaseban "InTime_Ankete" sheet.
function provjeriDuplikatKlijenta(oib, naziv, oblik, tip) {
  oib = String(oib || '').trim();
  naziv = String(naziv || '').trim().toLowerCase();
  oblik = String(oblik || '').trim().toLowerCase();
  tip = String(tip || 'interes').trim().toLowerCase();

  if (tip === 'anketa') {
    return provjeriDuplikatAnkete_(oib);
  }
  if (tip === 'odbijenica') {
    return provjeriDuplikatOdbijenica_(oib);
  }

  var sheet = getOrCreateUpitiSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'ok', duplicate: false }; }
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var tipCol = header.indexOf('Tip');
  var nazivCol = header.indexOf('Naziv tvrtke');
  var oblikCol = header.indexOf('Oblik poslovnog subjekta');
  var oibCol = header.indexOf('OIB');
  if (tipCol === -1 || nazivCol === -1 || oibCol === -1) {
    return { status: 'ok', duplicate: false }; // sigurnosni izlaz ako se stupci ikad preimenuju
  }
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][tipCol] !== 'Interes') { continue; }
    var rOib = String(data[i][oibCol] || '').trim();
    if (oib && rOib && rOib === oib) {
      return { status: 'ok', duplicate: true, reason: 'oib' };
    }
    if (oblikCol !== -1) {
      var rNaziv = String(data[i][nazivCol] || '').trim().toLowerCase();
      var rOblik = String(data[i][oblikCol] || '').trim().toLowerCase();
      if (naziv && oblik && rNaziv === naziv && rOblik === oblik) {
        return { status: 'ok', duplicate: true, reason: 'naziv_oblik' };
      }
    }
  }
  return { status: 'ok', duplicate: false };
}

// ---- PROVJERA DUPLIKATA — Odbijenica (cooldown 30 dana po OIB-u) ----
// ISPRAVKA 20.9.2026. (Sašin izričit zahtjev, isti dan kad je izvorno
// izgrađena trajna blokada): Odbijenica VIŠE NIJE trajna blokada — ista
// tvrtka (OIB) smije ponovno poslati Odbijenicu čim prođe 30 dana od
// zadnjeg unosa. Isti princip kao provjeriDuplikatAnkete_() niže, samo što
// Odbijenica dijeli "InTime_Upiti" sheet s Upitnikom (Tip='Odbijenica'),
// pa se ovdje dodatno filtrira po stupcu Tip.
function provjeriDuplikatOdbijenica_(oib) {
  if (!oib) { return { status: 'ok', duplicate: false }; }
  var sheet = getOrCreateUpitiSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'ok', duplicate: false }; }
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var tipCol = header.indexOf('Tip');
  var oibCol = header.indexOf('OIB');
  var timestampCol = header.indexOf('Timestamp');
  if (tipCol === -1 || oibCol === -1 || timestampCol === -1) {
    return { status: 'ok', duplicate: false }; // sigurnosni izlaz ako se stupci ikad preimenuju
  }
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var CEKANJE_DANA = 30;
  var sadaMs = Date.now();
  var najnovijiUnutarCekanja = null;
  for (var i = 0; i < data.length; i++) {
    if (data[i][tipCol] !== 'Odbijenica') { continue; }
    var rOib = String(data[i][oibCol] || '').trim();
    if (!rOib || rOib !== oib) { continue; }
    var rDatum = data[i][timestampCol];
    if (!(rDatum instanceof Date)) { continue; }
    var proteklihDana = (sadaMs - rDatum.getTime()) / (1000 * 60 * 60 * 24);
    if (proteklihDana < CEKANJE_DANA) {
      if (!najnovijiUnutarCekanja || rDatum.getTime() > najnovijiUnutarCekanja.getTime()) {
        najnovijiUnutarCekanja = rDatum;
      }
    }
  }
  if (najnovijiUnutarCekanja) {
    var preostaloDana = Math.ceil(CEKANJE_DANA - (sadaMs - najnovijiUnutarCekanja.getTime()) / (1000 * 60 * 60 * 24));
    if (preostaloDana < 1) { preostaloDana = 1; }
    return { status: 'ok', duplicate: true, reason: 'odbijenica_cooldown', preostaloDana: preostaloDana };
  }
  return { status: 'ok', duplicate: false };
}

// ---- PROVJERA DUPLIKATA — Anketa kvalitete (cooldown 30 dana po OIB-u) ----
// Za razliku od Interesa/Odbijenice ovo NIJE trajna blokada — ista tvrtka
// (OIB) smije ponovno ispuniti anketu čim prođe 30 dana od zadnjeg unosa.
// Gleda zaseban "InTime_Ankete" sheet (izracunajOcekivanoZaglavljeAnkete_
// definira stupce "OIB poslovnog subjekta" i "Timestamp").
function provjeriDuplikatAnkete_(oib) {
  if (!oib) { return { status: 'ok', duplicate: false }; }
  var sheet = getOrCreateAnketaSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'ok', duplicate: false }; }
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var oibCol = header.indexOf('OIB poslovnog subjekta');
  var timestampCol = header.indexOf('Timestamp');
  if (oibCol === -1 || timestampCol === -1) {
    return { status: 'ok', duplicate: false }; // sigurnosni izlaz ako se stupci ikad preimenuju
  }
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var CEKANJE_DANA = 30;
  var sadaMs = Date.now();
  var najnovijiUnutarCekanja = null;
  for (var i = 0; i < data.length; i++) {
    var rOib = String(data[i][oibCol] || '').trim();
    if (!rOib || rOib !== oib) { continue; }
    var rDatum = data[i][timestampCol];
    if (!(rDatum instanceof Date)) { continue; }
    var proteklihDana = (sadaMs - rDatum.getTime()) / (1000 * 60 * 60 * 24);
    if (proteklihDana < CEKANJE_DANA) {
      if (!najnovijiUnutarCekanja || rDatum.getTime() > najnovijiUnutarCekanja.getTime()) {
        najnovijiUnutarCekanja = rDatum;
      }
    }
  }
  if (najnovijiUnutarCekanja) {
    var preostaloDana = Math.ceil(CEKANJE_DANA - (sadaMs - najnovijiUnutarCekanja.getTime()) / (1000 * 60 * 60 * 24));
    if (preostaloDana < 1) { preostaloDana = 1; }
    return { status: 'ok', duplicate: true, reason: 'anketa_cooldown', preostaloDana: preostaloDana };
  }
  return { status: 'ok', duplicate: false };
}

// ============================================================
// NUMERACIJA — trajni, nepromjenjivi identifikacijski broj za svaki
// Upitnik/Odbijenicu/Ocjenu kvalitete. Tri ODVOJENA brojača (jedan po
// vrsti, čuvaju se u Script Properties), svaki reže na 0001 svake nove
// kalendarske godine (korisnikov izričit zahtjev — vidi ključ
// 'BROJ_<VRSTA>_<godina>' niže). Format:
//   Upitnik:    PO-0001-SB-XXX-2026
//   Odbijenica: NE!-0001-SB-XXX-2026   (s uskličnikom — korisnikov zahtjev)
//   Anketa:     OCJENA-0001-XXX-2026   (bez "SB" segmenta)
// gdje je XXX prva 3 slova naziva tvrtke (hrvatski dijakritici svedeni na
// najbliže osnovno slovo), velikim slovima, dopunjeno s "X" ako je naziv
// kraći od 3 slova.
//
// Testni način (zaseban prekidač po vrsti u adminu, adminSetBrojTest):
// dok je uključen, SVAKI novi unos te vrste dobiva IDENTIČAN broj s
// literalnim "TEST" umjesto brojčanog dijela (npr. PO-TEST-SB-ABC-2026) —
// pravi brojač se pritom uopće ne diže. Kad se isključi, numeracija
// nastavlja točno od sljedećeg pravog broja nakon zadnjeg stvarno
// izdanog (brojač je cijelo vrijeme testiranja stajao "zamrznut").
//
// LockService oko inkrementa sprječava da dva gotovo istovremena unosa
// (Apps Script Web App može primiti paralelne pozive) dobiju isti broj.
// ============================================================
function izvuciXXX_(naziv) {
  var s = String(naziv || '').toUpperCase();
  s = s.replace(/Č/g, 'C').replace(/Ć/g, 'C').replace(/Đ/g, 'D').replace(/Š/g, 'S').replace(/Ž/g, 'Z');
  s = s.replace(/[^A-Z]/g, '');
  s = s.substring(0, 3);
  while (s.length < 3) { s += 'X'; }
  return s;
}

function formatBroj_(tip, brojDio, xxx, godina) {
  if (tip === 'upitnik') { return 'PO-' + brojDio + '-SB-' + xxx + '-' + godina; }
  if (tip === 'odbijenica') { return 'NE!-' + brojDio + '-SB-' + xxx + '-' + godina; }
  if (tip === 'anketa') { return 'OCJENA-' + brojDio + '-' + xxx + '-' + godina; }
  return '';
}

function generirajBroj_(tip, naziv) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var props = PropertiesService.getScriptProperties();
    var godina = new Date().getFullYear();
    var xxx = izvuciXXX_(naziv);
    var testUkljucen = props.getProperty('BROJ_TEST_' + tip.toUpperCase()) === 'true';
    if (testUkljucen) {
      return formatBroj_(tip, 'TEST', xxx, godina);
    }
    var counterKey = 'BROJ_' + tip.toUpperCase() + '_' + godina;
    var zadnji = parseInt(props.getProperty(counterKey), 10) || 0;
    var sljedeci = zadnji + 1;
    props.setProperty(counterKey, String(sljedeci));
    var brojDio = ('0000' + sljedeci).slice(-4);
    return formatBroj_(tip, brojDio, xxx, godina);
  } finally {
    lock.releaseLock();
  }
}

// Trenutno stanje sva tri testna prekidača, PLUS trenutna vrijednost svakog
// brojača za TEKUĆU godinu (npr. "5" znači da je zadnji izdani broj 0005,
// sljedeći će biti 0006) — za admin sučelje (prikaz stanja pri učitavanju
// stranice, i da Saša vidi treba li uopće resetirati).
function adminGetBrojStatus(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var props = PropertiesService.getScriptProperties();
  var godina = new Date().getFullYear();
  return {
    status: 'ok',
    testUpitnik: props.getProperty('BROJ_TEST_UPITNIK') === 'true',
    testOdbijenica: props.getProperty('BROJ_TEST_ODBIJENICA') === 'true',
    testAnketa: props.getProperty('BROJ_TEST_ANKETA') === 'true',
    zadnjiUpitnik: parseInt(props.getProperty('BROJ_UPITNIK_' + godina), 10) || 0,
    zadnjiOdbijenica: parseInt(props.getProperty('BROJ_ODBIJENICA_' + godina), 10) || 0,
    zadnjiAnketa: parseInt(props.getProperty('BROJ_ANKETA_' + godina), 10) || 0
  };
}

// Uključuje/isključuje testni način numeracije za jednu od tri vrste
// ('upitnik'/'odbijenica'/'anketa') — poziva se s admin preklopnika.
function adminSetBrojTest(token, tip, ukljuceno) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var dozvoljeno = { upitnik: 1, odbijenica: 1, anketa: 1 };
  if (!dozvoljeno[tip]) { return { status: 'error', message: 'Nepoznata vrsta numeracije.' }; }
  PropertiesService.getScriptProperties().setProperty('BROJ_TEST_' + tip.toUpperCase(), ukljuceno ? 'true' : 'false');
  return { status: 'ok' };
}

// Vraća brojač jedne od tri vrste ('upitnik'/'odbijenica'/'anketa') natrag
// na 0000 za TEKUĆU godinu — tako sljedeći stvarni (ne-testni) unos opet
// dobiva 0001. Za slučaj kad je netko slučajno poslao pravi (ne-testni) unos
// dok je mislio da testira (npr. zaboravio uključiti testni prekidač iznad)
// — Sašin izričit zahtjev 15.9.2026. NAPOMENA: ovo NE briše/mijenja već
// upisane retke u Sheetu (već dodijeljeni brojevi u postojećim recima
// ostaju kakvi jesu) — samo se sljedeći novi unos ponovno broji od 0001.
// Ako je pogrešan testni unos ostao u Sheetu, njega treba zasebno obrisati
// (gumb "Obriši upit" na kartici) da ne ostane kao "duh" zapis.
function adminResetBrojac(token, tip) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var dozvoljeno = { upitnik: 1, odbijenica: 1, anketa: 1 };
  if (!dozvoljeno[tip]) { return { status: 'error', message: 'Nepoznata vrsta numeracije.' }; }
  var godina = new Date().getFullYear();
  PropertiesService.getScriptProperties().deleteProperty('BROJ_' + tip.toUpperCase() + '_' + godina);
  return { status: 'ok' };
}

// "Master reset" SVE TRI numeracije odjednom (Sašin izričit zahtjev,
// 19.9.2026.) — isto što i tri uzastopna poziva adminResetBrojac() za
// 'upitnik'/'odbijenica'/'anketa', samo u JEDNOM koraku s JEDNIM
// (najstrože zaštićenim) potvrdnim tokom u adminu (dva "jesi siguran" +
// potvrda riječju + admin lozinka — vidi openMasterResetBrojevaModal() u
// InTime_Admin.html). Vraća sljedeći broj svake vrste (za tekuću godinu)
// natrag na 0001 — NE dira već upisane retke u Sheetu (već dodijeljeni
// brojevi na postojećim zapisima ostaju nepromijenjeni), isto kao i
// pojedinačni adminResetBrojac().
function adminMasterResetBrojace(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var godina = new Date().getFullYear();
  var props = PropertiesService.getScriptProperties();
  ['upitnik', 'odbijenica', 'anketa'].forEach(function(tip) {
    props.deleteProperty('BROJ_' + tip.toUpperCase() + '_' + godina);
  });
  return { status: 'ok' };
}

// Ručno postavlja SLJEDEĆI broj (proizvoljan, ne nužno 1) za jednu od tri
// vrste, za TEKUĆU godinu — Sašin izričit zahtjev 15.9.2026., za slučaj kad
// treba fino podesiti/uštimati numeraciju (ne samo vratiti na 0001, npr. ako
// je nekoliko upita ručno obrisano pa treba "vratiti" brojač unatrag, ili
// namjerno preskočiti nekoliko brojeva). Admin stranica ovu akciju traži tek
// NAKON dvostruke potvrde (lozinka + riječ) — ovdje se, kao i svugdje,
// provjerava SAMO valjani admin token (potvrda riječju je čisto
// frontend-only "friction" korak, isto kao kod masovnog brisanja).
function adminSetBrojac(token, tip, sljedeciBroj) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var dozvoljeno = { upitnik: 1, odbijenica: 1, anketa: 1 };
  if (!dozvoljeno[tip]) { return { status: 'error', message: 'Nepoznata vrsta numeracije.' }; }
  var broj = parseInt(sljedeciBroj, 10);
  if (isNaN(broj) || broj < 1 || broj > 9999) {
    return { status: 'error', message: 'Broj mora biti cijeli broj između 1 i 9999.' };
  }
  var godina = new Date().getFullYear();
  // generirajBroj_ uzima zadnji spremljeni broj i dodaje 1, pa se ovdje
  // sprema (željeni sljedeći broj − 1).
  PropertiesService.getScriptProperties().setProperty('BROJ_' + tip.toUpperCase() + '_' + godina, String(broj - 1));
  return { status: 'ok' };
}

// ---- GLAVNA FUNKCIJA — PRODAJNI UPITNIK (zainteresirani) ----
// ---- IMENIK — izvlačenje kandidata za kontakt iz pojedinog obrasca ----
// "Ime" polje kontakta u Imeniku uvijek nosi PUNO IME I PREZIME kontakt
// osobe, a "Prezime" polje NOSI NAZIV TVRTKE — Sašin izričit zahtjev, radi
// lakšeg snalaženja na mobitelu kad se kontakt izveze u Google Contacts
// (familyName=tvrtka grupira kontakte iste tvrtke jedne pored drugih).
function izvuciKontakteIzUpitnika_(data) {
  var naziv = val(data.naziv);
  var oib = val(data.oib);
  var grad = val(data.grad);
  var kandidati = [];
  function dodaj(ime, funkcija, telefon, email, napomena) {
    ime = (ime || '').toString().trim();
    if (!ime) { return; }
    kandidati.push({ ime: ime, prezime: naziv, oib: oib, grad: grad, telefon: val(telefon), email: val(email), funkcija: (funkcija || '').toString().trim(), napomena: (napomena || '').toString().trim() });
  }
  dodaj(data.unosnik_ime, 'Osoba koja je unijela upitnik', data.unosnik_telefon, data.unosnik_email);
  dodaj(data.racunovodstvo_kontakt_ime, 'Kontakt osoba u računovodstvu', data.racunovodstvo_kontakt_telefon, data.racunovodstvo_kontakt_email);

  // Odgovorna osoba (potpisnik/na koga se naslovljava ponuda) — telefon NIJE
  // obavezno polje u upitniku. Sašin izričit zahtjev 20.9.2026.: ako telefon
  // NIJE upisan I Odgovorna osoba nije ista osoba kao Kontakt osoba (drugo
  // ime), NE stvaramo poseban, "slab" kontakt bez telefona — umjesto toga
  // ime Odgovorne osobe ide kao NAPOMENA na Kontakt osobin redak ("Odgovorna
  // osoba: Ime Prezime"), da Saša u Imeniku/Google Contacts vidi tko je
  // potpisnik. Ako Kontakt osoba uopće nije upisana (nema kome pripisati
  // napomenu), Odgovorna osoba se ipak sprema kao svoj kontakt — bolje slab
  // kontakt nego izgubljen podatak. Ako telefon JEST upisan, ili je riječ o
  // istoj osobi kao Kontakt osoba (postojeći "spoji unutar upitnika"
  // mehanizam niže svejedno ih spaja u jedan zapis), ponašanje je nepromijenjeno.
  var odgovornaIme = (val(data.odgovorna_osoba) || '').toString().trim();
  var odgovornaTelefon = (val(data.odgovorna_telefon) || '').toString().trim();
  var kontaktIme = (val(data.kontakt) || '').toString().trim();
  var odgovornaFunkcija = (val(data.odgovorna_funkcija) === 'Ostalo' ? val(data.odgovorna_funkcija_ostalo) : val(data.odgovorna_funkcija)) || 'Odgovorna osoba (za ponudu)';
  var napomenaZaKontakt = '';
  var preskociOdgovornu = false;
  if (odgovornaIme && !odgovornaTelefon && kontaktIme && kontaktIme.toLowerCase() !== odgovornaIme.toLowerCase()) {
    preskociOdgovornu = true;
    napomenaZaKontakt = 'Odgovorna osoba: ' + odgovornaIme;
  }
  if (!preskociOdgovornu) {
    dodaj(data.odgovorna_osoba, odgovornaFunkcija, data.odgovorna_telefon, data.odgovorna_email);
  }
  var kontaktFunkcija = (val(data.kontakt_funkcija) === 'Ostalo' ? val(data.kontakt_funkcija_ostalo) : val(data.kontakt_funkcija)) || 'Kontakt osoba';
  dodaj(data.kontakt, kontaktFunkcija, data.telefon, data.kontakt_email, napomenaZaKontakt);

  dodaj(data.logistika_osoba_ime, 'Osoba zadužena za logistiku (prikup/primanje pošiljaka)', data.logistika_osoba_telefon, data.logistika_osoba_email);

  // Unutar OVOG upitnika, ako se isto ime pojavi u više "funkcija" (npr. ista
  // osoba je i kontakt osoba i odgovorna osoba), spoji u JEDAN kandidat sa
  // svim telefonima/emailovima/funkcijama/napomenama — Sašin izričit zahtjev.
  var spojeno = [];
  kandidati.forEach(function(k) {
    var kljucIme = k.ime.toLowerCase();
    var postojeci = null;
    for (var i = 0; i < spojeno.length; i++) {
      if (spojeno[i].ime.toLowerCase() === kljucIme) { postojeci = spojeno[i]; break; }
    }
    if (postojeci) {
      postojeci.telefon = spojiPopis_(postojeci.telefon, k.telefon);
      postojeci.email = spojiPopis_(postojeci.email, k.email);
      postojeci.funkcija = spojiPopis_(postojeci.funkcija, k.funkcija);
      postojeci.napomena = spojiPopis_(postojeci.napomena, k.napomena);
    } else {
      spojeno.push({ ime: k.ime, prezime: k.prezime, oib: k.oib, grad: k.grad, telefon: k.telefon, email: k.email, funkcija: k.funkcija, napomena: k.napomena });
    }
  });
  return spojeno;
}

function izvuciKontaktIzOdbijenice_(data) {
  var ime = (val(data.odbijenica_kontakt_ime) + ' ' + val(data.odbijenica_kontakt_prezime)).replace(/\s+/g, ' ').trim();
  if (!ime) { return null; }
  return { ime: ime, prezime: val(data.naziv), oib: val(data.oib), telefon: val(data.odbijenica_telefon), email: val(data.odbijenica_email), funkcija: '' };
}

function izvuciKontaktIzAnkete_(data) {
  var ime = val(data.anketa_ime_prezime).toString().trim();
  if (!ime) { return null; }
  return { ime: ime, prezime: val(data.anketa_naziv), oib: val(data.anketa_oib), telefon: val(data.anketa_telefon), email: val(data.anketa_email), funkcija: '' };
}

// ---- IMENIK — spremanje jednog kandidata (spajanje po OIB-u+imenu ili nov
// redak), CSV export i (ako je uključen auto-prijenos za ovaj tag) sinkronizacija
// s Google Contacts. Vraća rowIndex spremljenog/ažuriranog retka ili -1 ako
// kandidat nema ime (ništa se nije spremilo). NIKAD ne baca grešku dalje —
// greška u bilo kojem koraku (Drive/Sheet) se hvata i bilježi u
// IMENIK_ZADNJA_GRESKA (Script Properties) radi kasnijeg uvida, ali NE smije
// srušiti spremanje/mail samog upitnika/odbijenice/ankete koje ju je pozvalo.
function spremiKontaktUImenik_(kandidat, tag, broj) {
  if (!kandidat || !kandidat.ime) { return -1; }
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getOrCreateImenikSheet();
    var lastRow = sheet.getLastRow();
    var rowIndex = -1;
    var existing = null;
    if (kandidat.oib && lastRow >= 2) {
      var podaci = sheet.getRange(2, 1, lastRow - 1, IMENIK_HEADER.length).getValues();
      for (var i = 0; i < podaci.length; i++) {
        if (String(podaci[i][IMENIK_COL.OIB - 1]).trim() === String(kandidat.oib).trim() &&
            String(podaci[i][IMENIK_COL.IME - 1]).trim().toLowerCase() === kandidat.ime.trim().toLowerCase()) {
          rowIndex = i + 2;
          existing = podaci[i];
          break;
        }
      }
    }
    var sada = new Date();
    if (existing) {
      var noviRedak = existing.slice();
      noviRedak[IMENIK_COL.ZADNJA_IZMJENA - 1] = sada;
      if (kandidat.prezime) { noviRedak[IMENIK_COL.PREZIME - 1] = kandidat.prezime; }
      if (kandidat.grad) { noviRedak[IMENIK_COL.GRAD - 1] = kandidat.grad; }
      noviRedak[IMENIK_COL.TELEFONI - 1] = spojiPopis_(existing[IMENIK_COL.TELEFONI - 1], kandidat.telefon);
      noviRedak[IMENIK_COL.EMAILOVI - 1] = spojiPopis_(existing[IMENIK_COL.EMAILOVI - 1], kandidat.email);
      noviRedak[IMENIK_COL.FUNKCIJE - 1] = spojiPopis_(existing[IMENIK_COL.FUNKCIJE - 1], kandidat.funkcija);
      if (kandidat.napomena) { noviRedak[IMENIK_COL.NAPOMENA - 1] = spojiPopis_(existing[IMENIK_COL.NAPOMENA - 1], kandidat.napomena); }
      noviRedak[IMENIK_COL.TAGOVI - 1] = spojiPopis_(existing[IMENIK_COL.TAGOVI - 1], tag);
      if (tag === 'Upitnik') { noviRedak[IMENIK_COL.BROJ_UPITNIKA - 1] = spojiPopis_(existing[IMENIK_COL.BROJ_UPITNIKA - 1], broj); }
      if (tag === 'Odbijenica') { noviRedak[IMENIK_COL.BROJ_ODBIJENICE - 1] = spojiPopis_(existing[IMENIK_COL.BROJ_ODBIJENICE - 1], broj); }
      if (tag === 'Ocjena kvalitete') { noviRedak[IMENIK_COL.BROJ_OCJENE - 1] = spojiPopis_(existing[IMENIK_COL.BROJ_OCJENE - 1], broj); }
      sheet.getRange(rowIndex, 1, 1, IMENIK_HEADER.length).setValues([noviRedak]);
    } else {
      var redak = [];
      redak[IMENIK_COL.DATUM_UNOSA - 1] = sada;
      redak[IMENIK_COL.ZADNJA_IZMJENA - 1] = sada;
      redak[IMENIK_COL.IME - 1] = kandidat.ime;
      redak[IMENIK_COL.PREZIME - 1] = kandidat.prezime || '';
      redak[IMENIK_COL.OIB - 1] = kandidat.oib || '';
      redak[IMENIK_COL.GRAD - 1] = kandidat.grad || '';
      redak[IMENIK_COL.TELEFONI - 1] = kandidat.telefon || '';
      redak[IMENIK_COL.EMAILOVI - 1] = kandidat.email || '';
      redak[IMENIK_COL.FUNKCIJE - 1] = kandidat.funkcija || '';
      redak[IMENIK_COL.NAPOMENA - 1] = kandidat.napomena || '';
      redak[IMENIK_COL.TAGOVI - 1] = tag;
      redak[IMENIK_COL.BROJ_UPITNIKA - 1] = tag === 'Upitnik' ? broj : '';
      redak[IMENIK_COL.BROJ_ODBIJENICE - 1] = tag === 'Odbijenica' ? broj : '';
      redak[IMENIK_COL.BROJ_OCJENE - 1] = tag === 'Ocjena kvalitete' ? broj : '';
      redak[IMENIK_COL.GOOGLE_ID - 1] = '';
      redak[IMENIK_COL.PREBACENO - 1] = 'Ne';
      redak[IMENIK_COL.DATUM_PREBACIVANJA - 1] = '';
      redak[IMENIK_COL.CSV_FILE_ID - 1] = '';
      sheet.appendRow(redak);
      rowIndex = sheet.getLastRow();
    }
    return rowIndex;
  } catch (err) {
    PropertiesService.getScriptProperties().setProperty('IMENIK_ZADNJA_GRESKA', new Date() + ' — spremiKontaktUImenik_: ' + err.message);
    return -1;
  } finally {
    lock.releaseLock();
  }
}

// Godina/Mjesec poddirektorij unutar postojećeg IMENIK Drive foldera (vidi
// getSustavSubfolders_()) — naziv datoteke po Sašinom izričitom obrascu:
// "Naziv tvrtke - Ime osobe - Funkcija - Oznaka". Ako kontakt već ima
// spremljenu CSV datoteku (stupac CSV_FILE_ID), ta se datoteka BRIŠE i
// zamjenjuje novom (umjesto pokušaja izmjene sadržaja postojeće datoteke),
// isti obrazac kao kod adminExportKlijent/Odbijenica/Anketa u ovoj datoteci.
function spremiKontaktCsv_(rowIndex) {
  try {
    var sheet = getOrCreateImenikSheet();
    var redak = sheet.getRange(rowIndex, 1, 1, IMENIK_HEADER.length).getValues()[0];
    var ime = redak[IMENIK_COL.IME - 1] || '(bez imena)';
    var prezime = redak[IMENIK_COL.PREZIME - 1] || '(bez tvrtke)';
    var funkcije = redak[IMENIK_COL.FUNKCIJE - 1] || '-';
    var tagovi = redak[IMENIK_COL.TAGOVI - 1] || '-';
    var datumUnosa = redak[IMENIK_COL.DATUM_UNOSA - 1];
    var d = (datumUnosa instanceof Date) ? datumUnosa : new Date();

    var sub = getSustavSubfolders_();
    var godinaFolder = getOrCreateChildFolder_(sub.imenik, String(d.getFullYear()));
    var mjeseci = ['01 - Siječanj','02 - Veljača','03 - Ožujak','04 - Travanj','05 - Svibanj','06 - Lipanj','07 - Srpanj','08 - Kolovoz','09 - Rujan','10 - Listopad','11 - Studeni','12 - Prosinac'];
    var mjesecFolder = getOrCreateChildFolder_(godinaFolder, mjeseci[d.getMonth()]);

    function sanitiziraj(s) {
      return String(s).replace(/[\\\/:*?"<>|]/g, '-').trim();
    }
    var naziv = sanitiziraj(prezime) + ' - ' + sanitiziraj(ime) + ' - ' + sanitiziraj(funkcije) + ' - ' + sanitiziraj(tagovi);

    // Stara CSV datoteka ovog kontakta (ako postoji) se briše prije upisa nove.
    var stariId = redak[IMENIK_COL.CSV_FILE_ID - 1];
    if (stariId) {
      try { DriveApp.getFileById(stariId).setTrashed(true); } catch (e) { /* već obrisana/nedostupna — nastavi */ }
    }

    var csvRedovi = [
      ['Ime', 'Prezime (naziv tvrtke)', 'OIB', 'Grad', 'Telefoni', 'Emailovi', 'Funkcije', 'Napomena', 'Tagovi', 'Broj upitnika', 'Broj odbijenice', 'Broj ocjene kvalitete', 'Datum unosa'],
      [ime, prezime, redak[IMENIK_COL.OIB - 1] || '', redak[IMENIK_COL.GRAD - 1] || '', redak[IMENIK_COL.TELEFONI - 1] || '', redak[IMENIK_COL.EMAILOVI - 1] || '', funkcije, redak[IMENIK_COL.NAPOMENA - 1] || '', tagovi,
        redak[IMENIK_COL.BROJ_UPITNIKA - 1] || '', redak[IMENIK_COL.BROJ_ODBIJENICE - 1] || '', redak[IMENIK_COL.BROJ_OCJENE - 1] || '',
        Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm') ]
    ];
    var csvSadrzaj = csvRedovi.map(function(r) {
      return r.map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');

    var file = mjesecFolder.createFile(naziv + '.csv', csvSadrzaj, MimeType.CSV);
    sheet.getRange(rowIndex, IMENIK_COL.CSV_FILE_ID).setValue(file.getId());
  } catch (err) {
    PropertiesService.getScriptProperties().setProperty('IMENIK_ZADNJA_GRESKA', new Date() + ' — spremiKontaktCsv_: ' + err.message);
  }
}

// Glavna ulazna točka — poziva se iz saveUpit/saveOdbijenica/saveAnketa nakon
// uspješnog upisa u njihov Sheet. Za svakog kandidata: spremi/ažuriraj u
// Imeniku, napravi/ažuriraj CSV, i ako je uključen auto-prijenos za ovaj tag,
// odmah pokušaj sinkronizirati s Google Contacts. Cijela funkcija je "best
// effort" — greška ovdje NIKAD ne smije spriječiti da klijent dobije potvrdu
// ili da Saša dobije mail obavijest (poziva se unutar try/catch na mjestu
// poziva, u saveUpit/saveOdbijenica/saveAnketa).
function obradiKontakteZaImenik_(kandidati, tag, broj) {
  if (!kandidati) { return; }
  if (!Array.isArray(kandidati)) { kandidati = [kandidati]; }
  var autoSync = ucitajImenikAutoSync_();
  var ovajTagUkljucen = autoSync.enabled && (
    (tag === 'Upitnik' && autoSync.noviUpitnici) ||
    (tag === 'Odbijenica' && autoSync.odbijenice) ||
    (tag === 'Ocjena kvalitete' && autoSync.ocjeneKvalitete)
  );
  kandidati.forEach(function(kandidat) {
    if (!kandidat || !kandidat.ime) { return; }
    var rowIndex = spremiKontaktUImenik_(kandidat, tag, broj);
    if (rowIndex === -1) { return; }
    spremiKontaktCsv_(rowIndex);
    if (ovajTagUkljucen) {
      try { sinkronizirajKontaktGoogle_(rowIndex); } catch (err) { /* vidi IMENIK_ZADNJA_GRESKA */ }
    }
  });
}

// ============================================================
// IMENIK — SINKRONIZACIJA S GOOGLE CONTACTS (People API, napredna usluga)
//
// VAŽNO — jednokratno ručno podešavanje prije prve upotrebe (Saša mora
// napraviti OVO, kod ne može umjesto njega):
//   1. U Apps Script uređivaču: lijevo "Usluge" (Services) → "+" → dodati
//      "People API" (Google-ova napredna usluga).
//   2. U istom dijalogu otvoriti poveznicu na Google Cloud Console projekt i
//      ondje TAKOĐER omogućiti "People API" (Google Cloud → APIs & Services
//      → Enable APIs → People API → Enable).
//   3. Napraviti NOVI deploy (Deploy → Manage deployments → ✏️ → New
//      version) da se ponovno pojavi ekran za autorizaciju, i ondje odobriti
//      pristup Contacts-ima (scope contacts).
// Dok se ovo ne napravi, svaki poziv na Google sinkronizaciju (ručni gumb
// "Prebaci u Google Contacts" ili automatski prijenos) vraća grešku koju
// admin sučelje prikazuje ispod kontakta — ništa se ne ruši, samo se
// kontakt ne prebaci dok postavka ne bude gotova.
// ============================================================

// NOVO 20.9.2026. (17. krug, Sašin izričit zahtjev) — "organizations" dodan
// da "Funkcija" ide u Google Contacts kao pravo polje "Radno mjesto" (uz
// naziv tvrtke), a ne samo unutar teksta bilješke (biography) kao dosad.
var IMENIK_PEOPLE_FIELDS_ = 'names,emailAddresses,phoneNumbers,biographies,memberships,organizations';

// Traži/stvara Contact Group (naljepnicu/"label") u Google Contacts s danim
// nazivom (npr. "Odbijenica") — rezultat (resourceName) se pamti u Script
// Properties da se ne mora svaki put ponovno tražiti po cijelom popisu grupa.
function getOrCreateContactGroupResourceName_(naziv) {
  var props = PropertiesService.getScriptProperties();
  var kljuc = 'IMENIK_GRUPA_' + naziv;
  var cached = props.getProperty(kljuc);
  if (cached) { return cached; }
  var popis = People.ContactGroups.list({ pageSize: 200 });
  var grupe = (popis && popis.contactGroups) || [];
  for (var i = 0; i < grupe.length; i++) {
    if (grupe[i].name === naziv || grupe[i].formattedName === naziv) {
      props.setProperty(kljuc, grupe[i].resourceName);
      return grupe[i].resourceName;
    }
  }
  var nova = People.ContactGroups.create({ contactGroup: { name: naziv } });
  props.setProperty(kljuc, nova.resourceName);
  return nova.resourceName;
}

// PRIVREMENA TEST-FUNKCIJA — samo za ručno pokretanje iz editora da se
// izazove Google-ov ekran za odobrenje "contacts" ovlasti (scope) koji
// People API zahtijeva. Nakon što je pokreneš i odobriš dozvole, obriši
// test-kontakt "TEST OBRISI ME" iz Google kontakata i (po želji) makni ovu
// funkciju iz koda. NE zove se odnikuda iz ostatka sustava.
function testPeopleAuth() {
  var kontakt = People.People.createContact({
    names: [{ givenName: 'TEST OBRISI ME' }]
  });
  Logger.log('Test kontakt kreiran, resourceName: ' + kontakt.resourceName);
  return kontakt.resourceName;
}

// Sinkronizira JEDAN redak Imenika s Google Contacts (sbatinac.intime@gmail.com
// — isti račun pod kojim je ovaj Web App deployan, Saša je to potvrdio
// 19.9.2026., pa People API radi izravno preko ovlasti scripta, bez dodatnog
// tuđeg OAuth-a). "Ime" polje kontakta u Google Contacts (givenName) = puno
// ime osobe, "Prezime" (familyName) = naziv tvrtke (Sašin izričit zahtjev).
// Tagovi (Upitnik/Odbijenica/Ocjena kvalitete) postaju Contact Group
// naljepnice, a brojevi/datum unosa idu u bilješku (biography) kontakta, tako
// da su odmah vidljivi na mobitelu bez otvaranja Sheeta.
function sinkronizirajKontaktGoogle_(rowIndex) {
  var sheet = getOrCreateImenikSheet();
  var redak = sheet.getRange(rowIndex, 1, 1, IMENIK_HEADER.length).getValues()[0];
  var ime = redak[IMENIK_COL.IME - 1];
  if (!ime) { return { status: 'error', message: 'Kontakt nema ime.' }; }
  var prezime = redak[IMENIK_COL.PREZIME - 1] || '';
  var grad = redak[IMENIK_COL.GRAD - 1] || '';
  var telefoni = String(redak[IMENIK_COL.TELEFONI - 1] || '').split(',').map(function(s){ return s.trim(); }).filter(function(s){ return s; });
  var emailovi = String(redak[IMENIK_COL.EMAILOVI - 1] || '').split(',').map(function(s){ return s.trim(); }).filter(function(s){ return s; });
  var tagovi = String(redak[IMENIK_COL.TAGOVI - 1] || '').split(',').map(function(s){ return s.trim(); }).filter(function(s){ return s; });
  var funkcije = redak[IMENIK_COL.FUNKCIJE - 1] || '';
  var napomena = redak[IMENIK_COL.NAPOMENA - 1] || '';
  var datumUnosa = redak[IMENIK_COL.DATUM_UNOSA - 1];
  var datumTekst = (datumUnosa instanceof Date) ? Utilities.formatDate(datumUnosa, Session.getScriptTimeZone(), 'dd.MM.yyyy.') : '';

  var biografija = 'IN TIME — Imenik\n' +
    'Tag' + (tagovi.length > 1 ? 'ovi' : '') + ': ' + (tagovi.join(', ') || '-') + '\n' +
    (funkcije ? 'Funkcija: ' + funkcije + '\n' : '') +
    (grad ? 'Grad: ' + grad + '\n' : '') +
    (napomena ? 'Napomena: ' + napomena + '\n' : '') +
    (redak[IMENIK_COL.BROJ_UPITNIKA - 1] ? 'Broj upitnika: ' + redak[IMENIK_COL.BROJ_UPITNIKA - 1] + '\n' : '') +
    (redak[IMENIK_COL.BROJ_ODBIJENICE - 1] ? 'Broj odbijenice: ' + redak[IMENIK_COL.BROJ_ODBIJENICE - 1] + '\n' : '') +
    (redak[IMENIK_COL.BROJ_OCJENE - 1] ? 'Broj ocjene kvalitete: ' + redak[IMENIK_COL.BROJ_OCJENE - 1] + '\n' : '') +
    'Datum unosa: ' + datumTekst;

  var memberships = [];
  tagovi.forEach(function(tag) {
    try {
      var grupaRes = getOrCreateContactGroupResourceName_(tag);
      memberships.push({ contactGroupMembership: { contactGroupResourceName: grupaRes } });
    } catch (err) { /* naljepnica se preskače ako ne uspije, kontakt se svejedno sprema */ }
  });

  var osoba = {
    names: [{ givenName: ime, familyName: prezime }],
    emailAddresses: emailovi.map(function(e) { return { value: e }; }),
    phoneNumbers: telefoni.map(function(t) { return { value: t }; }),
    biographies: [{ value: biografija, contentType: 'TEXT_PLAIN' }],
    memberships: memberships
  };
  // Funkcija ide i kao pravo polje "Radno mjesto"/"Tvrtka" u Google Contactsu
  // (uz postojeći zapis u bilješci), ali samo ako funkcija stvarno postoji —
  // ne dupliciramo prazno polje.
  if (funkcije) {
    osoba.organizations = [{ name: prezime, title: funkcije }];
  }

  try {
    var postojeciId = redak[IMENIK_COL.GOOGLE_ID - 1];
    var rezultat;
    if (postojeciId) {
      var trenutni = People.People.get(postojeciId, { personFields: IMENIK_PEOPLE_FIELDS_ });
      osoba.etag = trenutni.etag;
      rezultat = People.People.updateContact(osoba, postojeciId, { updatePersonFields: IMENIK_PEOPLE_FIELDS_ });
    } else {
      rezultat = People.People.createContact(osoba);
    }
    var sada = new Date();
    sheet.getRange(rowIndex, IMENIK_COL.GOOGLE_ID).setValue(rezultat.resourceName);
    sheet.getRange(rowIndex, IMENIK_COL.PREBACENO).setValue('Da');
    sheet.getRange(rowIndex, IMENIK_COL.DATUM_PREBACIVANJA).setValue(Utilities.formatDate(sada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm'));
    return { status: 'ok' };
  } catch (err) {
    PropertiesService.getScriptProperties().setProperty('IMENIK_ZADNJA_GRESKA', new Date() + ' — sinkronizirajKontaktGoogle_: ' + err.message);
    return { status: 'error', message: 'Prijenos u Google Contacts nije uspio: ' + err.message + ' (provjeri je li "People API" omogućen — vidi napomenu uz sinkronizacijski blok u kodu).' };
  }
}

// ---- Auto-prijenos (prekidač u Imeniku) — postavke se pamte u Script
// Properties kao JSON. Uključivanje ZAHTIJEVA admin lozinku (vidi
// adminSetImenikAutoSync niže) — isključivanje ne treba dodatnu potvrdu
// (uvijek je "sigurnije" isključiti automatiku nego je uključiti).
function ucitajImenikAutoSync_() {
  var raw = PropertiesService.getScriptProperties().getProperty('IMENIK_AUTOSYNC');
  var zadano = { enabled: false, odbijenice: false, ocjeneKvalitete: false, noviUpitnici: false };
  if (!raw) { return zadano; }
  try {
    var parsed = JSON.parse(raw);
    return {
      enabled: !!parsed.enabled,
      odbijenice: !!parsed.odbijenice,
      ocjeneKvalitete: !!parsed.ocjeneKvalitete,
      noviUpitnici: !!parsed.noviUpitnici
    };
  } catch (err) { return zadano; }
}

function adminGetImenikAutoSync(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var postavke = ucitajImenikAutoSync_();
  postavke.status = 'ok';
  return postavke;
}

// Uključivanje/promjena kriterija zahtijeva PONOVNI unos admin lozinke —
// Sašin izričit zahtjev ("sa šifrom admina... da se svi kontakti odmah
// prebacuju u imenik Google accounta čim dođu"). Isključivanje (settings.enabled
// === false) ne zahtijeva lozinku — vidi frontend (samo UKLJUČIVANJE prolazi
// kroz dvostruku potvrdu lozinka+riječ, isključivanje je jedan klik).
function adminSetImenikAutoSync(token, adminPassword, settings) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  settings = settings || {};
  if (settings.enabled) {
    if (!provjeriAdminLozinku_(adminPassword)) { return { status: 'error', message: 'Pogrešna lozinka.' }; }
  }
  var nova = {
    enabled: !!settings.enabled,
    odbijenice: !!settings.odbijenice,
    ocjeneKvalitete: !!settings.ocjeneKvalitete,
    noviUpitnici: !!settings.noviUpitnici
  };
  PropertiesService.getScriptProperties().setProperty('IMENIK_AUTOSYNC', JSON.stringify(nova));
  nova.status = 'ok';
  return nova;
}

// ---- "Povuci sve kontakte iz starih upisa" (Sašin izričit zahtjev,
// 20.9.2026.) — Imenik (13. krug) skuplja kontakte SAMO automatski, u
// trenutku novog upisa (saveUpit/saveOdbijenica/saveAnketa). Stariji zapisi u
// "InTime_Upiti"/"InTime_Ankete" koji su nastali PRIJE uvođenja Imenika (ili
// bi ubuduće slučajno promašili automatski upis zbog neke greške) se NIKAD
// retroaktivno ne povlače — ova funkcija to nadoknađuje: prolazi kroz SVE
// postojeće retke obje tablice i za svaki (ponovno) izvlači kandidate ISTIM
// izvuciKontakte*_ funkcijama koje koriste i saveUpit/saveOdbijenica/saveAnketa,
// pa ih sprema kroz istu spremiKontaktUImenik_ (spajanje po OIB-u+imenu, NE
// duplicira). Zato je sigurno pokrenuti je VIŠE PUTA — npr. i mjesecima
// kasnije, ako zatreba (Sašin izričit zahtjev — "ako se nešto ne dorade a
// kasnije mi to treba").
//
// NAMJERNO NE zove sinkronizirajKontaktGoogle_ (Google Contacts), čak i kad je
// auto-prijenos uključen — masovni povratni uvoz ne smije odjednom preplaviti
// Google Contacts/mobitel stotinama starih kontakata bez pregleda. Prijenos u
// Google Contacts ostaje ručni odabir u Imeniku, kao i do sad.
//
// Rekonstrukcija "data" objekta (isti oblik kakav izvuciKontakte*_ funkcije
// očekuju iz žive POST predaje) iz retka Sheeta ide preko naziv stupca (label)
// → kratki ključ polja, isti label→key mehanizam kao adminListEntries().
//
// NAPOMENA o vremenskom ograničenju: Apps Script izvršavanje ima limit od 6
// minuta — ako broj redaka jednog dana naraste na više tisuća, ovu funkciju
// treba podijeliti u serije (nije bio slučaj u trenutku pisanja).
function adminPovuciSveKontakte(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }

  var upitLabelToKey = {};
  UPIT_FIELDS.forEach(function(f) { if (!f.sec) { upitLabelToKey[f[1]] = f[0]; } });
  // Odbijenica-specifični stupci koje UPIT_FIELDS ne pokriva (vidi
  // izracunajOcekivanoZaglavljeUpiti_ za točan popis/redoslijed naziva) — samo
  // ona 4 polja koja izvuciKontaktIzOdbijenice_ stvarno koristi.
  var odbijenicaLabelToKey = {
    'Kontakt ime (odbijenica)': 'odbijenica_kontakt_ime',
    'Kontakt prezime (odbijenica)': 'odbijenica_kontakt_prezime',
    'Telefon (odbijenica)': 'odbijenica_telefon',
    'Email (odbijenica)': 'odbijenica_email'
  };

  var obradjenoUpitnika = 0, obradjenoOdbijenica = 0, obradjenoAnketa = 0;
  var upisanoKontakata = 0, greske = 0;

  // ---- "InTime_Upiti" — pokriva Interes/Ponude/Arhiva/Novi klijenti/Odbijenica
  // (svi dijele isti Sheet, razlikuju se po stupcu "Tip") ----
  var sheet = getOrCreateUpitiSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
    var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var podaci = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (var i = 0; i < podaci.length; i++) {
      var red = podaci[i];
      var status = red[1];
      var broj = red[2];
      if (!broj) { continue; }
      var data = {};
      for (var c = 0; c < header.length; c++) {
        var key = upitLabelToKey[header[c]] || odbijenicaLabelToKey[header[c]];
        if (key) { data[key] = red[c]; }
      }
      try {
        if (status === 'Odbijenica') {
          var kandidatOdb = izvuciKontaktIzOdbijenice_(data);
          if (kandidatOdb && kandidatOdb.ime) {
            var rowIdxOdb = spremiKontaktUImenik_(kandidatOdb, 'Odbijenica', broj);
            if (rowIdxOdb !== -1) { spremiKontaktCsv_(rowIdxOdb); upisanoKontakata++; }
          }
          obradjenoOdbijenica++;
        } else {
          var kandidatiUpit = izvuciKontakteIzUpitnika_(data) || [];
          kandidatiUpit.forEach(function(k) {
            if (!k || !k.ime) { return; }
            var rowIdxUpit = spremiKontaktUImenik_(k, 'Upitnik', broj);
            if (rowIdxUpit !== -1) { spremiKontaktCsv_(rowIdxUpit); upisanoKontakata++; }
          });
          obradjenoUpitnika++;
        }
      } catch (err) { greske++; }
    }
  }

  // ---- "InTime_Ankete" (ocjene kvalitete) ----
  var anketaSheet = getOrCreateAnketaSheet();
  var lastRowA = anketaSheet.getLastRow();
  if (lastRowA >= 2) {
    var anketaLabelToKey = {};
    ANKETA_FIELDS.forEach(function(f) { if (!f.sec) { anketaLabelToKey[f[1]] = f[0]; } });
    var ocekivanoZaglavljeA = izracunajOcekivanoZaglavljeAnkete_();
    var lastColA = Math.min(anketaSheet.getLastColumn(), ocekivanoZaglavljeA.length);
    var headerA = anketaSheet.getRange(1, 1, 1, lastColA).getValues()[0];
    var podaciA = anketaSheet.getRange(2, 1, lastRowA - 1, lastColA).getValues();
    for (var j = 0; j < podaciA.length; j++) {
      var redA = podaciA[j];
      var brojA = redA[1];
      if (!brojA) { continue; }
      var dataA = {};
      for (var cc = 0; cc < headerA.length; cc++) {
        var keyA = anketaLabelToKey[headerA[cc]];
        if (keyA) { dataA[keyA] = redA[cc]; }
      }
      try {
        var kandidatAnketa = izvuciKontaktIzAnkete_(dataA);
        if (kandidatAnketa && kandidatAnketa.ime) {
          var rowIdxAnk = spremiKontaktUImenik_(kandidatAnketa, 'Ocjena kvalitete', brojA);
          if (rowIdxAnk !== -1) { spremiKontaktCsv_(rowIdxAnk); upisanoKontakata++; }
        }
        obradjenoAnketa++;
      } catch (err) { greske++; }
    }
  }

  return {
    status: 'ok',
    obradjenoUpitnika: obradjenoUpitnika,
    obradjenoOdbijenica: obradjenoOdbijenica,
    obradjenoAnketa: obradjenoAnketa,
    upisanoKontakata: upisanoKontakata,
    greske: greske
  };
}

// ============================================================
// STVARNO SLANJE PONUDE MAILOM — Sašin izričit zahtjev (20.9.2026., dvadeset
// i četvrti krug): "zelim jos moguncost kod llponuda da doam dodatne maila
// adrese... zelim moguncot testriaj ponudu... da unesem mail na koji zelim
// posalti ponudu prije nego sto ode na sve osatle mailove... i zelim
// checkbox posalji kopiju ponude samom sebi".
//
// Ovo je PRVO pravo automatsko slanje maila u cijelom projektu — dosad je
// sustav SAMO prikazivao renderirani predložak (renderMailTekst_ u
// InTime_Admin.html), a Saša ga je ručno copy-paste-ao ("📋 Kopiraj tekst").
// Namjerno je NAČINJENO KAO DODATAK preko postojećeg sustava, ne zamjena:
//   - konačni (već renderirani, {{TAGOVI}} zamijenjeni) predmet/tijelo šalje
//     KLIJENT (InTime_Admin.html), ista renderMailTekst_ funkcija kao za
//     pregled/kopiranje — nema duple/razdvojene logike zamjene tagova na
//     serveru;
//   - primatelji dolaze iz trenutno označenih checkboxova u bloku "Mail
//     adrese za ponudu" u trenutku klika (uključujući ručno dodane, vidi
//     buildAdminFieldsBlock gore);
//   - OVA funkcija NE DIRA postojeći status-stroj ponude (ponuda_datum_slanja,
//     "Postavi rok"/"Generiraj novu ponudu" gumbi, izracunajStatusPonude_) —
//     ostaju potpuno nepromijenjeni, kako je Saša izričito tražio da se ne
//     miješa s tim mehanizmom.
// ============================================================

// Prilozi za stvarno slanje UVIJEK se dohvaćaju NA SERVERU iz spremljenog
// polja "dokumenti_ponude" (JSON, ADMIN_ONLY_FIELDS.dokumenti_ponude) za
// dani redak — ne prima ih se od klijenta — tako da je nemoguće poslati
// nešto drugo od onoga što Saša stvarno vidi/odabrao u bloku "Dokumenti za
// ponudu". Svaka datoteka se dohvaća pojedinačno u try/catch: ako je jedna
// u međuvremenu obrisana s Drivea ili nedostupna, ostale se ipak pošalju
// (mail nikad ne padne cijeli zbog jednog lošeg priloga).
function dohvatiPrilogePonude_(rowIndex) {
  var blobovi = [];
  try {
    var sheet = getOrCreateUpitiSheet();
    if (!rowIndex || rowIndex < 2 || rowIndex > sheet.getLastRow()) { return blobovi; }
    var lastCol = sheet.getLastColumn();
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var dokCol = header.indexOf(ADMIN_ONLY_FIELDS.dokumenti_ponude);
    if (dokCol === -1) { return blobovi; }
    var sirovo = sheet.getRange(rowIndex, dokCol + 1).getValue();
    if (!sirovo) { return blobovi; }
    var lista = [];
    try { lista = JSON.parse(sirovo); } catch (eParse) { return blobovi; }
    if (!Array.isArray(lista)) { return blobovi; }
    lista.forEach(function(d) {
      if (!d || !d.id) { return; }
      try {
        var blob = DriveApp.getFileById(d.id).getBlob();
        if (d.name) { blob.setName(d.name); }
        blobovi.push(blob);
      } catch (eBlob) { /* jedan nedostupan prilog ne smije srušiti cijelo slanje */ }
    });
  } catch (err) { /* npr. stupac ne postoji — vrati što je dosad skupljeno (prazno) */ }
  return blobovi;
}

// Vraća globalno zapamćenu adresu za probno slanje (PropertiesService, NE
// po klijentu — Sašin izričit zahtjev: "neka se ta maila dresa za tetirnaje
// pamti i neka mi svaki put ponudi... mozda je ponovim").
function adminGetTestMail(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var testMail = PropertiesService.getScriptProperties().getProperty('PONUDA_TEST_MAIL') || '';
  return { status: 'ok', testMail: testMail };
}

var EMAIL_REGEX_ = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Grubi plain-text fallback za HTML predloške (trideset i prvi krug) —
// GmailApp.sendEmail treći argument (plain 'body') MORA biti neprazan i
// dalje se šalje kao dio poruke (klijenti e-pošte koji ne prikazuju HTML ga
// koriste), pa se ne smije samo proslijediti prazan string. Skida tagove
// grubo (dovoljno za fallback, ne mora biti savršeno) i sažima razmake.
function skiniHtmlTagoveZaFallback_(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '(sadržaj ove poruke dostupan je samo u HTML formatu)';
}

// Probno slanje — šalje SAMO na ručno upisanu testMail adresu (nikad na
// stvarne primatelje), s istim prilozima kao stvarno slanje, da Saša unaprijed
// vidi točno što bi klijent dobio. Pamti testMail globalno za sljedeći put.
// `jeHtml` (trideset i prvi krug) — kad je predložak označen kao HTML (vidi
// stupac 'HTML' u getOrCreateMailPredlosciSheet()), 'tijelo' je HTML
// izvorni kod (već s zamijenjenim {{TAG}}-ovima), pa ide kao
// `htmlBody`, uz grubi plain fallback za klijente bez HTML prikaza.
function adminPosaljiPonudaTest(token, rowIndex, testMail, predmet, tijelo, jeHtml) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  testMail = String(testMail || '').trim();
  if (!EMAIL_REGEX_.test(testMail)) { return { status: 'error', message: 'Upišite ispravnu e-mail adresu za testno slanje.' }; }
  if (!tijelo || !String(tijelo).trim()) { return { status: 'error', message: 'Tekst ponude je prazan — odaberite predložak.' }; }
  try {
    // Testno slanje NAMJERNO ide BEZ priloga (Sašin izričit zahtjev,
    // 22.9.2026., treći krug: "kad šaljem mail test ne želim priloge iz
    // bloka... nisu potrebni, sve je i onako na direktoriju koji je
    // linkan... samo želim vidjeti da li je sve ok") — za razliku od
    // STVARNOG slanja (adminPosaljiPonudaMail niže), koje priloge i dalje
    // šalje kao prije. `dohvatiPrilogePonude_` se ovdje više NE poziva.
    var opcije = {};
    var plainTijelo = tijelo;
    if (jeHtml) { opcije.htmlBody = tijelo; plainTijelo = skiniHtmlTagoveZaFallback_(tijelo); }
    GmailApp.sendEmail(testMail, predmet || '(bez predmeta)', plainTijelo, opcije);
    PropertiesService.getScriptProperties().setProperty('PONUDA_TEST_MAIL', testMail);
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: 'Slanje testnog maila nije uspjelo: ' + err.message };
  }
}

// Evidencija slanja — Sašin izričit zahtjev (22.9.2026.): trajan trag koji
// dokumenti su STVARNO poslani klijentu (na dijeljenom "POSLANO" linku) i koji
// su uz ponudu arhivirani interno (predirektorij, klijent ih ne vidi), s
// IZVORNIM (ne preimenovanim) nazivima datoteka — kakvi su bili PRIJE
// kopiranja/preimenovanja u adminPripremiDokumenteZaPonudu. Sprema se kao
// stvarni PDF (ne Google dokument), direktno u predirektorij (verzijaFolder),
// NIKAD u poddirektorij "POSLANO" koji ide klijentu. Jedan zapis po ponudi —
// svako slanje ga OSVJEŽI (isti princip "trashaj pa stvori iznova" kao kod
// POTVRDA/ODBIJANJE dokumenata).
// NADOGRAĐENO (22.9.2026., nastavak) — Sašin izričit zahtjev: "stavi na koju
// je poslana ponuda, na koje mail adrese, koji predložak je poslan, stavi
// cijeli izgled predloška... i odmah stavi dolje da imam fizički zapisan
// link koji je bio za ponudu i koji je bio za potvrdu ponude i vrijeme koje
// smo odabrali za potvrdu ponude (rok važenja)". `podaci` nosi sve dodatno:
// {nazivPredloska, predmet, tijelo, jeHtml, linkDokumenata, linkPotvrde,
// rokVazenjaStr}. Kad je predložak HTML, cijeli izgled se NE može vjerno
// prikazati unutar Google dokumenta/PDF-a (nema podrške za umetanje
// proizvoljnog HTML-a) — zato se sprema kao ZASEBAN .html dokument uz PDF, u
// ISTI (predirektorij) direktorij, a u PDF ide samo poveznica na njega. Kod
// običnog teksta cijeli tekst ide izravno u PDF (to JE cijeli "izgled" za
// tekstualni predložak).
function stvoriEvidencijuSlanja_(verzijaFolder, naziv, oib, grad, brojPonude, primatelji, kada, poslaniNazivi, arhiviraniNazivi, podaci) {
  podaci = podaci || {};
  var docNaziv = 'EVIDENCIJA SLANJA - ' + naziv + ' - ' + oib;
  var postojeciGdoc = verzijaFolder.getFilesByName(docNaziv);
  while (postojeciGdoc.hasNext()) { postojeciGdoc.next().setTrashed(true); }
  var postojeciPdf = verzijaFolder.getFilesByName(docNaziv + '.pdf');
  while (postojeciPdf.hasNext()) { postojeciPdf.next().setTrashed(true); }
  var izgledNaziv = docNaziv + ' - izgled predloška poslanog maila.html';
  var postojeciIzgled = verzijaFolder.getFilesByName(izgledNaziv);
  while (postojeciIzgled.hasNext()) { postojeciIzgled.next().setTrashed(true); }

  var doc = DocumentApp.create(docNaziv);
  var body = doc.getBody();
  body.appendParagraph('Evidencija slanja ponude').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph('Naziv tvrtke: ' + naziv);
  body.appendParagraph('OIB: ' + oib);
  body.appendParagraph('Mjesto: ' + grad);
  body.appendParagraph('Broj ponude: ' + brojPonude);
  body.appendParagraph('Datum i vrijeme slanja: ' + Utilities.formatDate(kada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm:ss'));
  body.appendParagraph('Primatelji: ' + (primatelji && primatelji.length ? primatelji.join(', ') : '(nema)'));
  body.appendParagraph('Poslani predložak: ' + (podaci.nazivPredloska || '(nepoznat)'));
  body.appendParagraph('Predmet maila: ' + (podaci.predmet || '(bez predmeta)'));
  body.appendParagraph('Link na dokumente ponude (poslan klijentu u ovom mailu): ' + (podaci.linkDokumenata || '(nije dostupan)'));
  body.appendParagraph('Link za potvrdu/odbijanje ponude: ' + (podaci.linkPotvrde || '(nije dostupan)'));
  body.appendParagraph('Rok važenja ponude (do): ' + (podaci.rokVazenjaStr || '(nije postavljen)'));

  body.appendParagraph('Dokumenti poslani klijentu (dijeljeni direktorij "POSLANO"), izvorni nazivi:').setHeading(DocumentApp.ParagraphHeading.HEADING3);
  if (poslaniNazivi.length) {
    poslaniNazivi.forEach(function(n) { body.appendListItem(n).setGlyphType(DocumentApp.GlyphType.BULLET); });
  } else {
    body.appendParagraph('(nema)');
  }
  body.appendParagraph('Dokumenti arhivirani uz ponudu — interno, klijent ih NE vidi, izvorni nazivi:').setHeading(DocumentApp.ParagraphHeading.HEADING3);
  if (arhiviraniNazivi.length) {
    arhiviraniNazivi.forEach(function(n) { body.appendListItem(n).setGlyphType(DocumentApp.GlyphType.BULLET); });
  } else {
    body.appendParagraph('(nema)');
  }

  body.appendParagraph('Cijeli izgled poslanog maila (tekst predloška):').setHeading(DocumentApp.ParagraphHeading.HEADING3);
  if (podaci.jeHtml) {
    body.appendParagraph('Predložak je HTML — vjeran izgled priložen je kao zaseban dokument u ISTOM direktoriju: "' + izgledNaziv + '" (otvori ga u pregledniku).');
    var tekstBezTagova = skiniHtmlTagoveZaFallback_(podaci.tijelo || '');
    body.appendParagraph('Tekstualni sadržaj (bez formatiranja, radi brzog pregleda):');
    body.appendParagraph(tekstBezTagova);
  } else {
    body.appendParagraph(podaci.tijelo || '(prazno)');
  }
  doc.saveAndClose();

  var docFile = DriveApp.getFileById(doc.getId());
  var pdfBlob = docFile.getAs(MimeType.PDF).setName(docNaziv + '.pdf');
  var pdfFile = verzijaFolder.createFile(pdfBlob);
  docFile.setTrashed(true); // makni privremeni Google dokument — ostaje samo PDF

  if (podaci.jeHtml && podaci.tijelo) {
    var izgledBlob = Utilities.newBlob(podaci.tijelo, 'text/html', izgledNaziv);
    verzijaFolder.createFile(izgledBlob);
  }

  return pdfFile.getUrl();
}

// Priprema podatke i poziva stvoriEvidencijuSlanja_ — čita SPREMLJENE JSON
// zapise fiksnih polja i "Ostalih dokumenata" (isti izvor kao dohvatiPrilogePonude_
// gore), čije 'name' polje je IZVORNI naziv datoteke (nikad ponuda-preimenovan,
// vidi napomenu uz DOK_FIKSNI_SLOTOVI_ u InTime_Admin.html). Poziva se SAMO iz
// adminPosaljiPonudaMail (stvarno slanje) — testno slanje NE stvara evidenciju,
// jer služi samo pregledu identičnog maila i ne smije pokretati poslovne
// nuspojave. Greška ovdje ne smije srušiti već izvršeno slanje maila.
function zabiljeziEvidencijuSlanja_(rowIndex, primatelji, kada, nazivPredloska, predmet, tijelo, jeHtml) {
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return; }
  var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
  var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var naziv = (row[header.indexOf('Naziv tvrtke')] || '').toString().trim() || '(bez naziva)';
  var oib = (row[header.indexOf('OIB')] || '').toString().trim() || '(bez OIB-a)';
  var grad = (row[header.indexOf('Mjesto')] || '').toString().trim().toUpperCase() || '(bez mjesta)';
  var sifraSirova = (row[header.indexOf(ADMIN_ONLY_FIELDS.sifra_ponude)] || '').toString().trim();
  if (!sifraSirova) { return; }
  var verzijaCol = header.indexOf(ADMIN_ONLY_FIELDS.ponuda_verzija);
  var verzija = (verzijaCol !== -1 && parseInt(row[verzijaCol], 10)) || 1;
  var brojPonude = sifraSirova + '-P' + verzija;

  var sub = getSustavSubfolders_();
  var klijentFolder = getOrCreateChildFolder_(sub.ponude, 'PONUDA - ' + naziv + ' - ' + oib + ' - ' + grad);
  // getOrCreateVerzijaFolder_ (ne getOrCreateChildFolder_) — tolerantno na
  // sufiks "- PRIHVAĆENA" koji stvoriDokumentPotvrdePonude_ dodaje nazivu
  // ovog istog foldera (vidi napomenu uz tu funkciju gore).
  var verzijaFolder = getOrCreateVerzijaFolder_(klijentFolder, brojPonude + ' - ' + naziv + ' - ' + oib + ' - ' + grad);

  var citajJson_ = function(polje) {
    var col = header.indexOf(ADMIN_ONLY_FIELDS[polje]);
    if (col === -1) { return null; }
    var sirovo = row[col];
    if (!sirovo) { return null; }
    try { return JSON.parse(sirovo); } catch (e) { return null; }
  };

  var poslaniNazivi = [];
  var arhiviraniNazivi = [];

  var ponudaSuradnja = citajJson_('dokument_ponuda_suradnja');
  if (ponudaSuradnja && ponudaSuradnja.name) {
    poslaniNazivi.push(ponudaSuradnja.name);
    arhiviraniNazivi.push(ponudaSuradnja.name + ' (kopija ponude)');
  }
  var ostaliRaw = citajJson_('dokumenti_ponude');
  if (Array.isArray(ostaliRaw)) {
    ostaliRaw.forEach(function(d) { if (d && d.name) { poslaniNazivi.push(d.name); } });
  }
  var analiticki = citajJson_('dokument_analiticki_cjenik');
  if (analiticki && analiticki.name) { arhiviraniNazivi.push(analiticki.name); }
  var cjenikHr = citajJson_('dokument_cjenik_hrvatska');
  if (cjenikHr && cjenikHr.name) { arhiviraniNazivi.push(cjenikHr.name); }

  // Fizički zapisan link na dokumente (POSLANO — vidi ADMIN_ONLY_FIELDS.link_dokumenti_ponude),
  // link za potvrdu/odbijanje (isti obrazac kao {{LINK_POTVRDE}}, iz tokena) i
  // rok važenja (SERVER je autoritet, ADMIN_ONLY_FIELDS.datum_isteka_ponude) —
  // Sašin izričit zahtjev, vidi napomenu uz stvoriEvidencijuSlanja_ iznad.
  var linkDokumentaCol = header.indexOf(ADMIN_ONLY_FIELDS.link_dokumenti_ponude);
  var linkDokumenata = (linkDokumentaCol !== -1) ? String(row[linkDokumentaCol] || '').trim() : '';

  var tokenPotvrdeCol = header.indexOf(ADMIN_ONLY_FIELDS.token_potvrda_ponude);
  var tokenPotvrde = (tokenPotvrdeCol !== -1) ? String(row[tokenPotvrdeCol] || '').trim() : '';
  var linkPotvrde = tokenPotvrde ? (POTVRDA_PONUDE_STRANICA_URL + '?token=' + encodeURIComponent(tokenPotvrde)) : '';

  var istekCol = header.indexOf(ADMIN_ONLY_FIELDS.datum_isteka_ponude);
  var istekVrijednost = (istekCol !== -1) ? row[istekCol] : null;
  var rokVazenjaStr = (istekVrijednost instanceof Date)
    ? Utilities.formatDate(istekVrijednost, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm')
    : (istekVrijednost ? String(istekVrijednost) : '');

  stvoriEvidencijuSlanja_(verzijaFolder, naziv, oib, grad, brojPonude, primatelji, kada, poslaniNazivi, arhiviraniNazivi, {
    nazivPredloska: nazivPredloska,
    predmet: predmet,
    tijelo: tijelo,
    jeHtml: jeHtml,
    linkDokumenata: linkDokumenata,
    linkPotvrde: linkPotvrde,
    rokVazenjaStr: rokVazenjaStr
  });
}

// Stvarno slanje ponude — na popis primatelja koji stižu s klijenta (trenutno
// označeni checkboxovi bloka "Mail adrese za ponudu", vidi napomenu gore).
// kopijaSebi=true dodaje NOTIFY_EMAIL (sbatinac.intime@gmail.com — isti
// račun pod kojim Web App šalje i sve ostale mailove) kao BCC, ne CC, da
// primatelji u zaglavlju ne vide da Saša prima kopiju. `jeHtml` — vidi
// napomenu uz adminPosaljiPonudaTest() iznad.
function adminPosaljiPonudaMail(token, rowIndex, primatelji, predmet, tijelo, kopijaSebi, jeHtml, nazivPredloska) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  if (!Array.isArray(primatelji)) { primatelji = []; }
  primatelji = primatelji.map(function(p) { return String(p || '').trim(); }).filter(function(p) { return EMAIL_REGEX_.test(p); });
  if (!primatelji.length) { return { status: 'error', message: 'Nijedna označena adresa nije ispravna e-mail adresa — provjerite popis primatelja.' }; }
  if (!tijelo || !String(tijelo).trim()) { return { status: 'error', message: 'Tekst ponude je prazan — odaberite predložak.' }; }
  try {
    var blobovi = dohvatiPrilogePonude_(rowIndex);
    var opcije = { attachments: blobovi };
    if (kopijaSebi) { opcije.bcc = NOTIFY_EMAIL; }
    var plainTijelo = tijelo;
    if (jeHtml) { opcije.htmlBody = tijelo; plainTijelo = skiniHtmlTagoveZaFallback_(tijelo); }
    GmailApp.sendEmail(primatelji.join(','), predmet || '(bez predmeta)', plainTijelo, opcije);

    // Evidencija slanja — SAMO kod stvarnog slanja, ne smije srušiti slanje
    // ako zakaže (npr. INTRIX šifra još nije potvrđena).
    try { zabiljeziEvidencijuSlanja_(rowIndex, primatelji, new Date(), nazivPredloska, predmet, tijelo, jeHtml); } catch (errEvid) { /* zanemari */ }

    // ISPRAVAK (22.9.2026., deveti krug — Sašin izričit zahtjev, TTD bug): OVO
    // je pravi trenutak stvarnog slanja ponude, pa se TEK OVDJE postavlja
    // "Datum slanja aktivne ponude (admin)" — polje od kojeg TTD (Time to
    // Decision) računa proteklo vrijeme do klijentove odluke. Ranije je to
    // radila adminPostaviRokPonude() (na klik "Postavi rok"), što je TTD
    // lažno naduvalo satima kad bi Saša rok postavio puno prije stvarnog
    // slanja maila. Postavlja se SAMO kod PRVOG stvarnog slanja (status je
    // tad još 'nije_poslano') — ne smije se prepisivati preko datuma
    // sljedećih verzija poslanih putem "Generiraj novu ponudu"
    // (adminGenerirajNovuPonudu), koja taj datum postavlja zasebno.
    var datumSlanjaPrikaz = null;
    var datumSlanjaPrikazSek = null;
    try {
      var sheetTtd = getOrCreateUpitiSheet();
      var lastColTtd = sheetTtd.getLastColumn();
      var headerTtd = sheetTtd.getRange(1, 1, 1, lastColTtd).getValues()[0];
      var rowTtd = sheetTtd.getRange(rowIndex, 1, 1, lastColTtd).getValues()[0];
      if (izracunajStatusPonude_(headerTtd, rowTtd) === 'nije_poslano') {
        var slanjeCol = headerTtd.indexOf('Datum slanja aktivne ponude (admin)');
        var verzijaCol = headerTtd.indexOf('Redni broj slanja ponude (admin)');
        var sadaSlanje = new Date();
        if (slanjeCol !== -1) { sheetTtd.getRange(rowIndex, slanjeCol + 1).setValue(sadaSlanje); }
        if (verzijaCol !== -1) { sheetTtd.getRange(rowIndex, verzijaCol + 1).setValue(1); }
        // Vraća se klijentu (InTime_Admin.html) da odmah lokalno ažurira
        // entry.fields i ponovno iscrta blok "Ponuda — slanje i status" (bedž,
        // TTD, brojač), bez čekanja na puno ponovno učitavanje popisa.
        datumSlanjaPrikaz = Utilities.formatDate(sadaSlanje, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm');
        datumSlanjaPrikazSek = Utilities.formatDate(sadaSlanje, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm:ss');
      }
    } catch (errTtd) { /* postavljanje datuma slanja ne smije srušiti već izvršeno slanje maila */ }

    return { status: 'ok', poslanoNa: primatelji, kopijaSebi: !!kopijaSebi, datumSlanjaPrikaz: datumSlanjaPrikaz, datumSlanjaPrikazSek: datumSlanjaPrikazSek };
  } catch (err) {
    return { status: 'error', message: 'Slanje ponude nije uspjelo: ' + err.message };
  }
}

// Provjerava lozinku BEZ stvaranja nove admin sesije (za razliku od
// adminLogin) — koristi isti hash/salt mehanizam. Vraća true/false.
function provjeriAdminLozinku_(password) {
  if (!password) { return false; }
  var props = PropertiesService.getScriptProperties();
  var hash = props.getProperty('ADMIN_PASSWORD_HASH');
  var salt = props.getProperty('ADMIN_PASSWORD_SALT');
  if (!hash) { return false; }
  return sha256Hex_(salt + password) === hash;
}

// ---- Admin akcije za Imenik (popis / brisanje / ručni prijenos odabranih) ----
function adminListImenik(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var sheet = getOrCreateImenikSheet();
  var lastRow = sheet.getLastRow();
  // NAPOMENA (ispravak, dvadeset i deveti krug): ranije je ovaj rani izlaz
  // (prazan Imenik) vraćao odgovor BEZ `imenikDriveFolderUrl` — zbog toga bi
  // gumb "Otvori Drive direktorij" u adminu ostao trajno onemogućen kad god
  // Imenik nema niti jedan kontakt, bez obzira na redeploy. Sad se link
  // računa i vraća u OBA slučaja.
  if (lastRow < 2) { return { status: 'ok', entries: [], imenikDriveFolderUrl: getSustavSubfolders_().imenik.getUrl() }; }
  var podaci = sheet.getRange(2, 1, lastRow - 1, IMENIK_HEADER.length).getValues();
  var entries = [];
  for (var i = 0; i < podaci.length; i++) {
    var r = podaci[i];
    var datumUnosa = r[IMENIK_COL.DATUM_UNOSA - 1];
    entries.push({
      rowIndex: i + 2,
      ime: r[IMENIK_COL.IME - 1],
      prezime: r[IMENIK_COL.PREZIME - 1],
      oib: r[IMENIK_COL.OIB - 1],
      grad: r[IMENIK_COL.GRAD - 1],
      telefoni: r[IMENIK_COL.TELEFONI - 1],
      emailovi: r[IMENIK_COL.EMAILOVI - 1],
      funkcije: r[IMENIK_COL.FUNKCIJE - 1],
      napomena: r[IMENIK_COL.NAPOMENA - 1],
      tagovi: r[IMENIK_COL.TAGOVI - 1],
      brojUpitnika: r[IMENIK_COL.BROJ_UPITNIKA - 1],
      brojOdbijenice: r[IMENIK_COL.BROJ_ODBIJENICE - 1],
      brojOcjene: r[IMENIK_COL.BROJ_OCJENE - 1],
      prebaceno: r[IMENIK_COL.PREBACENO - 1] === 'Da',
      datumPrebacivanja: r[IMENIK_COL.DATUM_PREBACIVANJA - 1],
      skriveno: r[IMENIK_COL.SKRIVENO - 1] === 'Da',
      datumUnosa: (datumUnosa instanceof Date) ? Utilities.formatDate(datumUnosa, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm') : String(datumUnosa || '')
    });
  }
  // Najnoviji prvi.
  entries.reverse();
  // Direktan link na Drive direktorij "IMENIK" (Sašin izričit zahtjev,
  // 20.9.2026., dvadeset i deveti krug: "napravi mu u kontaktima link
  // direktno na... google drive direktorij gdje su kontakti") — isti
  // fizički folder u koji `spremiKontaktUImenik_`/`izvezikontaktUImenikCsv_`
  // (vidi getSustavSubfolders_() iznad) sprema CSV po kontaktu, po
  // godini/mjesecu. Pretraga po imenu unutar poznatog roditelja je jeftina
  // (isti obrazac kao svugdje u ovom fajlu), pa se računa svaki put, bez
  // cachea.
  var imenikDriveFolderUrl = getSustavSubfolders_().imenik.getUrl();
  return { status: 'ok', entries: entries, imenikDriveFolderUrl: imenikDriveFolderUrl };
}

// Sakrij/otkrij OZNAČENE kontakte u Imeniku — Sašin izričit zahtjev
// (20.9.2026., dvadeset i šesti krug): "napravi opciju sakrih kontakte...da
// ih označim i sakrijem...i neka budu tu...ali neće smetati...mogu se
// pretraživati i neka piše skriveno ako ih pronađe". Za razliku od
// `adminDeleteImenikKontakt` (koja BRIŠE redak — pa se kontakt VRATI kod
// sljedećeg "Povuci sve kontakte iz starih upisa", jer izvorni upitnik/
// odbijenica/anketa i dalje postoji), ovo samo postavlja zastavicu — redak
// ostaje u tablici, pa ga backfill (i svaka buduća prijava iste osobe)
// prepoznaje kao već obrađen i ne stvara duplikat/ne "oživljava" ga.
function adminSetImenikSkriveno(token, rowIndexes, skriveno) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndexes = rowIndexes || [];
  var sheet = getOrCreateImenikSheet();
  var lastRow = sheet.getLastRow();
  var vrijednost = skriveno ? 'Da' : 'Ne';
  var primijenjeno = 0;
  rowIndexes.forEach(function(rIdx) {
    var rowIndex = parseInt(rIdx, 10);
    if (!rowIndex || rowIndex < 2 || rowIndex > lastRow) { return; }
    sheet.getRange(rowIndex, IMENIK_COL.SKRIVENO).setValue(vrijednost);
    primijenjeno++;
  });
  return { status: 'ok', primijenjeno: primijenjeno };
}

function adminDeleteImenikKontakt(token, rowIndex, confirmWord) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  if (confirmWord !== 'BRISATI') { return { status: 'error', message: 'Potvrda nije ispravna — potrebno je upisati točno riječ BRISATI.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateImenikSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  sheet.deleteRow(rowIndex);
  return { status: 'ok' };
}

// Ručni prijenos OZNAČENIH kontakata u Google Contacts (checkbox u Imeniku +
// "Prebaci u Google Contacts" u traci masovnih akcija) — ide redak po redak,
// ne prekida se ako jedan padne (npr. People API još nije omogućen), nego
// vraća popis grešaka na kraju.
function adminTransferImenikKontakte(token, rowIndexes) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndexes = rowIndexes || [];
  var uspjeh = 0, greske = [];
  for (var i = 0; i < rowIndexes.length; i++) {
    var rowIndex = parseInt(rowIndexes[i], 10);
    if (!rowIndex || rowIndex < 2) { continue; }
    var rezultat = sinkronizirajKontaktGoogle_(rowIndex);
    if (rezultat.status === 'ok') { uspjeh++; } else { greske.push(rezultat.message); }
  }
  return { status: 'ok', uspjeh: uspjeh, greske: greske };
}

function saveUpit(data) {
  var sheet = getOrCreateUpitiSheet();
  var broj = generirajBroj_('upitnik', val(data.naziv));
  // Token+lozinka za "naknadni ispravak podataka" (InTime_Ispravak.html) —
  // generirani OVDJE, po jednom po upitu, poslani klijentu mailom niže. Vidi
  // opširnu napomenu uz "ISPRAVAK PODATAKA" blok funkcija iznad. Treće
  // "odobrena poglavlja" polje kreće PRAZNO — klijent za sada može samo
  // GLEDATI svoje podatke putem poveznice, dok Saša ne odobri barem jedno
  // poglavlje kroz admin stranicu.
  var ispravakToken = Utilities.getUuid();
  var ispravakLozinka = generirajLozinku_();

  var row = [new Date(), 'Interes', broj];
  for (var i = 0; i < UPIT_FIELDS.length; i++) {
    var f = UPIT_FIELDS[i];
    if (f.sec) { continue; }
    row.push(val(data[f[0]]));
  }
  // Odbijenica-specifični stupci (7: ime, prezime, telefon, email, razlog,
  // razlog-ostalo, newsletter) i "(admin)" stupci (12: OB korisničko ime, OB
  // lozinka, Datum otvaranja klijenta, Zadnje vrijeme unosa naloga, Interna
  // napomena, Šifra ponude, Datum slanja ponude 1/2/3, Datum prihvaćanja
  // ponude, Datum otvaranja Online Bookinga, Vrijeme prikupa — ručno
  // uređeno) ostaju prazni za "Interes" retke — appendRow() s kraćim nizom
  // automatski ostavlja stupce iza zadnjeg upisanog praznima, ALI budući da
  // MORAMO upisati vrijednosti u tri "ispravak" stupca koji dolaze IZA njih,
  // moramo eksplicitno popuniti svih 19 (7+12) stupaca između praznim
  // stringom (appendRow ne zna "preskočiti" stupce usred niza).
  //
  // BUG NAĐEN 15.9.2026. (Sašin nalaz — novi klijenti se odmah pojavljivali
  // u kartici "Novi klijenti" umjesto "Zainteresirani"): ova petlja je
  // godinama/izmjenama ostala na STAROM broju stupaca (9, iz vremena kad je
  // bilo 5 odbijenica + 4 admin stupca) dok je stvaran broj obje grupe u
  // međuvremenu narastao na 7+5=12 (vidi izracunajOcekivanoZaglavljeUpiti_
  // iznad) — petlja se ranije zaustavljala 3 stupca prerano, pa su
  // ispravakToken/ispravakLozinka/'' upisivani 3 mjesta ULIJEVO od svog
  // pravog stupca: ispravakToken (nasumičan UUID) je završavao točno u
  // stupcu "Datum otvaranja klijenta u sustavu (admin)", pa je
  // jeOtvorenKlijent() (InTime_Admin.html) taj UUID tumačio kao "klijent je
  // već otvoren" i ODMAH prebacivao svaki novi Interes upit u karticu "Novi
  // klijenti" umjesto u "Zainteresirani". Isto vrijedi i za Anketu/Odbijenicu
  // NE — one ne prolaze kroz ovu petlju.
  //
  // NAPOMENA 15.9.2026.: dodano je 7 novih "(admin)" stupaca (Šifra ponude,
  // 3× Datum slanja ponude, Datum prihvaćanja ponude, Datum otvaranja OB-a,
  // Vrijeme prikupa — ručno uređeno) — broj u ovoj petlji MORA rasti zajedno
  // s brojem stupaca u izracunajOcekivanoZaglavljeUpiti_() iznad (12 → 19).
  // NAPOMENA 15.9.2026. (isti dan, drugi zahtjev): dodano je JOŠ jedno admin
  // polje ("Identifikacijski TM broj klijenta") — 19 → 20. Isto upozorenje
  // vrijedi ubuduće za svako sljedeće dodavanje: OVAJ broj MORA rasti zajedno
  // s brojem admin-only stupaca u izracunajOcekivanoZaglavljeUpiti_() iznad,
  // inače se vraća točno ovaj isti bug (vidi opširan opis iznad).
  for (var praznihStupaca = 0; praznihStupaca < 20; praznihStupaca++) { row.push(''); }
  row.push(ispravakToken);
  row.push(ispravakLozinka);
  row.push(''); // Odobrena poglavlja za ispravak — prazno dok Saša ne odobri
  sheet.appendRow(row);

  // Automatski prijenos u Imenik (13. krug, Sašin izričit zahtjev) — svih do
  // 5 kontakt-osoba iz ovog upitnika (unosnik/računovodstvo/odgovorna osoba/
  // kontakt osoba/logistika), best effort, greška ovdje NE smije spriječiti
  // mailove ispod.
  try { obradiKontakteZaImenik_(izvuciKontakteIzUpitnika_(data), 'Upitnik', broj); } catch (imenikErr) { /* vidi IMENIK_ZADNJA_GRESKA u Script Properties */ }

  // 1) Obavijest Saši — cijeli upitnik, sortiran po sekcijama
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    // Broj dokumenta na početku subjecta (Sašin izričit zahtjev 15.9.2026.)
    // — isti broj ide i Saši i klijentu, radi lakšeg pretraživanja/
    // povezivanja maila s konkretnim zapisom u adminu/Sheetu.
    subject: '[' + broj + '] Novi prodajni upitnik — ' + (val(data.naziv) || 'nepoznata tvrtka'),
    htmlBody: buildUpitAdminNotificationEmail(data)
  });

  // 2) HTML potvrda klijentu (uključuje i poveznicu+lozinku za naknadni
  // ispravak podataka — vidi buildUpitConfirmationEmail())
  // Potvrda prvenstveno ide na email kontakt osobe tvrtke-klijenta. Ako to
  // polje nije upisano, redom se pokušava: mail osobe koja je unosila
  // podatke → mail računovodstva → mail odgovorne osobe — korisnikov
  // izričit zahtjev za redoslijed rezervnih adresa.
  var replyEmail = val(data.kontakt_email) || val(data.unosnik_email) ||
    val(data.racunovodstvo_kontakt_email) || val(data.odgovorna_email);
  if (replyEmail) {
    MailApp.sendEmail({
      to: replyEmail,
      subject: '[' + broj + '] In Time d.o.o. — primili smo Vaš upitnik',
      htmlBody: buildUpitConfirmationEmail(data, ispravakToken, ispravakLozinka)
    });
  }

  // 3) Ako je klijent za dodatne Online Booking račune odabrao "pošaljite mi
  // Excel tablicu na e-mail" (umjesto ručnog unosa u obrascu), pošalji mu
  // predložak — vidi opširnu napomenu o računu (sbatinac.intime@gmail.com)
  // uz OB_TABLICA_MAX konfiguraciju na vrhu datoteke. Greška ovdje ne smije
  // srušiti spremanje upita (podaci su već upisani u Sheet iznad) — samo se
  // prijavljuje Saši mailom radi ručne intervencije.
  if (val(data.potreba_dodatni_ob_racuni) === 'Da' && val(data.dodatni_ob_nacin_unosa) === 'Mail') {
    try {
      posaljiOBTablicuPredlozak(val(data.dodatni_ob_tablica_mail), val(data.dodatni_ob_tablica_id), val(data.naziv));
    } catch (obErr) {
      MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        subject: '[' + broj + '] GREŠKA — slanje OB Excel predloška nije uspjelo',
        body: 'Tvrtka: ' + (val(data.naziv) || 'nepoznato') + '\n' +
          'ID: ' + val(data.dodatni_ob_tablica_id) + '\n' +
          'Mail primatelja: ' + val(data.dodatni_ob_tablica_mail) + '\n' +
          'Greška: ' + obErr.message + '\n\n' +
          'Molimo predložak pošaljite ručno ili provjerite je li "Drive API" napredni servis omogućen.'
      });
    }
  }
  return { status: 'ok', broj: broj };
}

// ---- ODBIJENICA (nije zainteresiran) ----
// Proširena verzija: uz naziv i razlog (sada checkbox multi-select s 11
// ponuđenih razloga + Ostalo, umjesto slobodnog teksta), traži se i kontakt
// telefon/email nezainteresirane tvrtke te pristanak na povremeni newsletter.
// Sve odbijenica-specifično polje spremaju se u NOVE, trajne stupce na kraju
// istog "InTime_Upiti" sheeta (redoslijed MORA odgovarati redoslijedu
// header.push() poziva u getOrCreateUpitiSheet() iznad) — za 'Interes' retke
// ti stupci ostaju prazni, isto kao i ranije za 'Razlog (odbijenica)'.
function saveOdbijenica(data) {
  var sheet = getOrCreateUpitiSheet();
  var broj = generirajBroj_('odbijenica', val(data.naziv));
  var row = [new Date(), 'Odbijenica', broj];
  // Za odbijenicu su sva UPIT_FIELDS polja prazna OSIM naziva tvrtke, OIB-a,
  // tri automatski zabilježena vremena dolaska/slanja/trajanja (ista polja
  // koja se bilježe i za "Interes" upite — vidi InTime_PismoNamjere.html,
  // hidden inputi u panel-odbijenica), i "Trenutni logistički partneri"
  // pitanja (logisticke_sluzbe/logisticke_sluzbe_ostalo/nova_tvrtka_bez_logistike
  // — ISTA tri polja/ključa kao u 7. poglavlju glavnog upitnika, forma za
  // odbijanje ima svoju vlastitu kopiju istog pitanja) — sva ostala poslovna
  // pitanja iz upitnika ne postoje u formi za odbijanje pa ostaju prazna.
  // Sašin izričit zahtjev (15.9.2026.) — novo polje 'vrijeme_pocetka_popunjavanja'
  // MORA biti na ovoj bijeloj listi, inače bi se za Odbijenicu (kao i za bilo
  // koje UPIT_FIELDS polje koje nije ovdje navedeno) tiho upisivalo prazno
  // umjesto stvarne vrijednosti — ista zamka kao i za preostala dva vremenska
  // polja odmah ispod.
  var VRIJEME_POLJA = { vrijeme_dolaska: 1, vrijeme_pocetka_popunjavanja: 1, vrijeme_slanja: 1, vrijeme_popunjavanja: 1 };
  var ODBIJENICA_DIJELJENA_POLJA = { oib: 1, logisticke_sluzbe: 1, logisticke_sluzbe_ostalo: 1, nova_tvrtka_bez_logistike: 1 };
  for (var i = 0; i < UPIT_FIELDS.length; i++) {
    var f = UPIT_FIELDS[i];
    if (f.sec) { continue; }
    if (f[0] === 'naziv') { row.push(val(data.naziv)); }
    else if (VRIJEME_POLJA[f[0]] || ODBIJENICA_DIJELJENA_POLJA[f[0]]) { row.push(val(data[f[0]])); }
    else { row.push(''); }
  }
  row.push(val(data.odbijenica_kontakt_ime));
  row.push(val(data.odbijenica_kontakt_prezime));
  row.push(val(data.odbijenica_telefon));
  row.push(val(data.odbijenica_email));
  row.push(val(data.razlog));
  row.push(val(data.razlog_ostalo));
  row.push(val(data.odbijenica_newsletter));
  sheet.appendRow(row);

  // Automatski prijenos u Imenik (13. krug, Sašin izričit zahtjev) — best
  // effort, greška ovdje NE smije spriječiti mailove ispod.
  try { obradiKontakteZaImenik_(izvuciKontaktIzOdbijenice_(data), 'Odbijenica', broj); } catch (imenikErr) { /* vidi IMENIK_ZADNJA_GRESKA u Script Properties */ }

  // UKLONJENO 17.9.2026. (Sašin izričit zahtjev — prijavio je da mu redovito
  // stiže dupli mail): ovdje je ranije postojao i DRUGI, plain-text mail
  // Saši (subject s test-oznakom "[V2]") koji je bio ostatak ranijeg
  // eksperimenta — slao se UZ HTML obavijest ispod, pa je Saša za svaku
  // Odbijenicu dobivao dva maila umjesto jednog. Sada ide samo HTML
  // obavijest niže (isti prikaz odgovora kao klijentova potvrda, naslov
  // "ODBIJENICA" radi lakšeg filtriranja u inboxu).
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: '[' + broj + '] ODBIJENICA',
    htmlBody: buildOdbijenicaConfirmationEmail(data)
  });

  // NOVO — potvrda klijentu s punim pregledom njegovog odgovora (isti
  // obrazac kao potvrda glavnog upitnika i ankete) — RANIJE forma za
  // odbijanje NIJE slala ništa klijentu, samo obavijest Saši (iznad).
  // Korisnik je eksplicitno zatražio da SVA TRI obrasca (Interes, Odbijenica,
  // Anketa) klijentu vrate potvrdu sa svime što je odgovorio.
  if (val(data.odbijenica_email)) {
    MailApp.sendEmail({
      to: val(data.odbijenica_email),
      subject: '[' + broj + '] In Time d.o.o. — zaprimili smo Vaš odgovor',
      htmlBody: buildOdbijenicaConfirmationEmail(data)
    });
  }
  return { status: 'ok', broj: broj };
}

// ---- Popis polja za potvrdu klijentu nakon odbijenice ----
// Zaseban od UPIT_FIELDS jer miješa nekoliko polja koja TU jesu dio
// UPIT_FIELDS (naziv, logisticke_sluzbe/_ostalo — dijele se s glavnim
// upitnikom, vidi ODBIJENICA_DIJELJENA_POLJA u saveOdbijenica() iznad) s
// poljima koja postoje SAMO u formi za odbijanje (odbijenica_kontakt_ime/
// _prezime/_telefon/_email, razlog/_ostalo, odbijenica_newsletter) — sva su
// već prisutna izravno u `data` (POST payload), bez obzira potječu li iz
// UPIT_FIELDS ili ne, pa ih buildFieldsHtml() (generalizirana s opcionalnim
// `fieldsList`, vidi definiciju niže) jednako ispravno prikazuje.
var ODBIJENICA_CONFIRM_FIELDS = [
  {sec:'Podaci o unosu'},
  ['vrijeme_dolaska', 'Vrijeme dolaska na stranicu'],
  ['vrijeme_pocetka_popunjavanja', 'Vrijeme početka popunjavanja upitnika'],
  ['vrijeme_slanja', 'Vrijeme slanja odgovora'],
  ['vrijeme_popunjavanja', 'Vrijeme popunjavanja (trajanje)'],
  {sec:'Podaci o poslovnom subjektu'},
  ['naziv', 'Naziv poslovnog subjekta'],
  ['oib', 'OIB poslovnog subjekta'],
  ['odbijenica_kontakt_ime', 'Kontakt ime'],
  ['odbijenica_kontakt_prezime', 'Kontakt prezime'],
  ['odbijenica_telefon', 'Kontakt telefon'],
  ['odbijenica_email', 'Kontakt e-mail'],
  {sec:'Trenutni logistički partneri'},
  ['logisticke_sluzbe', 'S kojima trenutno surađujete'],
  ['logisticke_sluzbe_ostalo', 'Ostalo, navedeno'],
  {sec:'Razlog nezainteresiranosti'},
  ['razlog', 'Razlog(i)'],
  ['razlog_ostalo', 'Ostalo, navedeno'],
  {sec:'Ostalo'},
  ['odbijenica_newsletter', 'Žele li povremeno primati novosti/ponude']
];

// ---- HTML POTVRDA KLIJENTU (odbijenica) ----
// Isti vizualni obrazac kao buildUpitConfirmationEmail() niže — bez bloka za
// "naknadni ispravak" jer odbijenica nema svoj ispravak-mehanizam (isto kao
// anketa — implementiran je SAMO za Interes, vidi projektnu dokumentaciju).
// Header-slika je POSEBNA (EMAIL_HEADER_IMG_ODBIJENICA), različita od
// EMAIL_HEADER_IMG koja se koristi za Interes/Anketu — korisnikov zahtjev.
function buildOdbijenicaConfirmationEmail(data) {
  var ime = (val(data.odbijenica_kontakt_ime) + ' ' + val(data.odbijenica_kontakt_prezime)).trim();
  return '' +
  '<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a;">' +
    '<img src="' + EMAIL_HEADER_IMG_ODBIJENICA + '" alt="In Time d.o.o." style="width:100%;max-width:640px;height:auto;display:block;">' +
    '<div style="padding:26px 24px;">' +
      '<p>Poštovani' + (ime ? ' ' + ime : '') + ',</p>' +
      '<p>Hvala Vam na izdvojenom vremenu. Zaprimili smo Vašu poruku da trenutno niste zainteresirani za suradnju s In Time d.o.o. Ukoliko se Vaše potrebe ili okolnosti ubuduće promijene, rado ćemo ponovno razgovarati.</p>' +
      '<p style="font-size:13px;color:#6b6b6b;">U nastavku šaljemo pregled Vašeg odgovora, radi Vaše evidencije:</p>' +
      '<div style="background:#f7fafb;border:1px solid #e2e6ea;border-radius:8px;padding:14px 16px;margin:14px 0;">' +
        buildFieldsHtml(data, ODBIJENICA_CONFIRM_FIELDS) +
      '</div>' +
      '<p>Stojimo Vam na raspolaganju ako nas ubuduće budete trebali kontaktirati.</p>' +
      '<p style="margin-top:24px;">Srdačan pozdrav,<br>' +
      '<b>Saša Batinac</b><br>' +
      'Sales and Marketing Manager, Voditelj ključnih kupaca<br>' +
      'In Time d.o.o. — Licensee of FedEx<br>' +
      'M: +385 91 6262 171 · sasa.batinac@in-time.hr</p>' +
    '</div>' +
    '<div style="background:#f7fafb;border-top:1px solid #e2e6ea;padding:14px 24px;font-size:11px;color:#6b6b6b;">' +
      'In Time d.o.o. · Zelena aleja 28, 10410 Vukovina · Tel: 01 6254 444' +
    '</div>' +
  '</div>';
}

// ---- SHEET ----
// POPRAVAK 20.9.2026. (18. krug, Sašin nalaz — svi brojači/popisi odjednom
// pokazivali 0, greška "Ti se stupci nalaze izvan granica."): admin panel
// šalje VIŠE poziva istovremeno (loadAll() u InTime_Admin.html), a
// adminGetCounters() I adminListEntries() OBA zovu ovu funkciju usporedno.
// Ako u tom trenutku treba poravnati zaglavlje (uskladiZaglavljeUpitiSheeta_
// umeće stupce), dva ISTOVREMENA poziva su se sudarala — dok jedan umeće
// stupac, drugi (sa zastarjelom slikom broja stupaca u glavi) pokuša pisati
// izvan trenutnih granica sheeta, što Google Sheets odbija tom greškom.
// Rješenje: cijeli "provjeri/poravnaj zaglavlje" blok zaključan je
// LockService-om, tako da se dva poziva nikad ne izvode paralelno nad istim
// sheetom.
function getOrCreateUpitiSheet() {
  var files = DriveApp.getFilesByName(SHEET_NAME);
  var ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(SHEET_NAME);
  }
  var sheet = ss.getSheets()[0];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ocekivano = izracunajOcekivanoZaglavljeUpiti_();
    if (sheet.getLastRow() === 0) {
      // Sasvim nov (prazan) sheet — upiši zaglavlje odmah.
      sheet.appendRow(ocekivano);
      sheet.getRange(1, 1, 1, ocekivano.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    } else {
      uskladiZaglavljeUpitiSheeta_(sheet, ocekivano);
    }
  } finally {
    lock.releaseLock();
  }
  return sheet;
}

// Gradi popis naslova stupaca KOJI BI trenutni UPIT_FIELDS kod trebao
// proizvesti — jedini izvor istine za redoslijed stupaca u "InTime_Upiti"
// Sheetu. Izdvojeno u zasebnu funkciju kako bi je mogla koristiti i
// getOrCreateUpitiSheet() (novi sheet) i uskladiZaglavljeUpitiSheeta_()
// (postojeći sheet, provjera/dopuna).
function izracunajOcekivanoZaglavljeUpiti_() {
  var header = ['Timestamp', 'Tip', 'Broj'];
  for (var i = 0; i < UPIT_FIELDS.length; i++) {
    var f = UPIT_FIELDS[i];
    if (f.sec) { continue; }
    header.push(f[1]);
  }
  header.push('Kontakt ime (odbijenica)');
  header.push('Kontakt prezime (odbijenica)');
  header.push('Telefon (odbijenica)');
  header.push('Email (odbijenica)');
  header.push('Razlog (odbijenica)');
  header.push('Razlog – Ostalo, tekst (odbijenica)');
  header.push('Newsletter pristanak (odbijenica)');
  header.push('OB korisničko ime (admin)');
  header.push('OB lozinka (admin)');
  header.push('Datum otvaranja klijenta u sustavu (admin)');
  header.push('Zadnje vrijeme unosa naloga (admin)');
  header.push('Interna napomena (admin)');
  header.push('Šifra ponude (admin)');
  header.push('Identifikacijski TM broj klijenta (admin)');
  header.push('Datum slanja ponude 1 (admin)');
  header.push('Datum slanja ponude 2 (admin)');
  header.push('Datum slanja ponude 3 (admin)');
  header.push('Datum prihvaćanja ponude (admin)');
  header.push('Datum otvaranja Online Bookinga (admin)');
  header.push('Vrijeme prikupa — ručno uređeno (admin)');
  header.push('Token za ispravak (admin)');
  header.push('Lozinka za ispravak (admin)');
  header.push('Odobrena poglavlja za ispravak (admin, brojevi odvojeni zarezom)');
  header.push('Datum prebacivanja u ponude (admin)');
  header.push('Nadležna poslovnica (admin)');
  header.push('Datum prebacivanja u arhivu (admin)');
  header.push('Napomena KAM-a (admin)');
  // NOVO (20.9.2026., devetnaesti krug) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.dokumenti_ponude gore. Dodano NA SAM KRAJ, isti razlog
  // kao "Napomena KAM-a (admin)" iznad nje — self-healing umetanje
  // (uskladiZaglavljeUpitiSheeta_) tad samo doda stupac na kraj postojećeg
  // Sheeta umjesto da umeće usred već popunjenih redaka.
  header.push('Dokumenti za ponudu (admin, JSON)');
  // NOVO (20.9.2026., dvadeseti krug) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.mail_adrese_ponude gore. Dodano NA SAM KRAJ, isti
  // razlog kao stupci iznad (self-healing samo doda na kraj, bez pomicanja
  // postojećih podataka).
  header.push('Mail adrese za slanje ponude (admin)');
  // NOVO (20.9.2026., dvadeset i prvi krug) — poveznica za potvrdu ponude
  // (OIB + ime/funkcija). Vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.token_potvrda_ponude gore. Svih 5 dodano NA SAM KRAJ,
  // isti razlog kao stupci iznad.
  header.push('Token za potvrdu ponude (admin)');
  header.push('Ime i prezime osobe koja je potvrdila ponudu (admin)');
  header.push('Funkcija osobe koja je potvrdila ponudu (admin)');
  header.push('IP adresa prilikom potvrde ponude (admin)');
  header.push('Poveznica na dokument potvrde ponude (admin)');
  // NOVO (20.9.2026., dvadeset i drugi krug) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.rok_dana_ponude gore. Dodano NA SAM KRAJ, isti razlog
  // kao stupci iznad.
  header.push('Rok važenja ponude (dana, admin)');
  header.push('Datum isteka ponude (admin)');
  // NOVO (20.9.2026., dvadeset i treći krug) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.ponuda_datum_slanja gore. Dodano NA SAM KRAJ, isti
  // razlog kao stupci iznad.
  header.push('Datum slanja aktivne ponude (admin)');
  header.push('Redni broj slanja ponude (admin)');
  header.push('Datum odbijanja ponude (admin)');
  header.push('Razlog odbijanja ponude (admin)');
  header.push('Datum poništenja ponude (admin)');
  header.push('Povijest prijašnjih slanja ponude (admin, JSON)');
  // NOVO (20.9.2026., dvadeset i sedmi krug) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.ponuda_datum_ponistenja_nakon_prihvata gore. Dodano NA
  // SAM KRAJ, isti razlog kao stupci iznad.
  header.push('Datum poništenja prihvaćene ponude (admin)');
  header.push('Ime i prezime osobe koja je odbila ponudu (admin)');
  header.push('IP adresa prilikom odbijanja ponude (admin)');
  // NOVO (21.9.2026.) — sustav dokumenata za ponudu na Driveu, vidi punu
  // napomenu uz ADMIN_ONLY_FIELDS.dokument_analiticki_cjenik i
  // ADMIN_ONLY_FIELDS.aktivni_folder_dokumenti_id gore. Svih 5 dodano NA SAM
  // KRAJ, isti razlog kao stupci iznad (self-healing samo doda na kraj, bez
  // pomicanja postojećih podataka).
  header.push('Analitički cjenik (admin, JSON)');
  header.push('Cjenik Hrvatska (admin, JSON)');
  header.push('Ponuda za suradnju (admin, JSON)');
  header.push('ID aktivnog direktorija dokumenata ponude (admin)');
  header.push('Link na direktorij dokumenata ponude (admin)');
  // NOVO (21.9.2026.) — osigurač prije slanja ponude, vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.poslovnica_potvrdjena gore. Dodano NA SAM KRAJ, isti
  // razlog kao stupci iznad.
  header.push('Nadležna poslovnica potvrđena (admin)');
  // NOVO (23. krug) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.ponuda_dokument_odbijanja_url gore. Dodano NA SAM
  // KRAJ, isti razlog kao stupci iznad.
  header.push('Poveznica na dokument odbijanja ponude (admin)');
  // NOVO (22.9.2026., deveti krug) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.link_predirektorij_ponude gore. Dodano NA SAM KRAJ,
  // isti razlog kao stupci iznad.
  header.push('Link na predirektorij ponude (admin)');
  return header;
}

// KRITIČNO za stupacIndeksZaPolje() i sve funkcije koje upisuju u tablicu
// POZICIJSKI po indeksu stupca (npr. obradiOBNit_() kod obrade OB tablica) —
// stvarno zaglavlje Sheeta MORA, stupac-po-stupac, biti identično onome što
// trenutni UPIT_FIELDS kod generira. Bez ove provjere: ako se u UPIT_FIELDS
// doda novo polje NEGDJE U SREDINI popisa (a ne na kraju), postojeće
// zaglavlje sheeta to polje nema, pa svi upisi RAČUNATI POZICIJSKI (kroz
// stupacIndeksZaPolje) završe u POGREŠNOM (susjednom) stupcu za svaki upit
// poslan nakon te izmjene koda. Ova funkcija to automatski ispravlja pri
// SVAKOM pozivu getOrCreateUpitiSheet() — usporedi trenutno zaglavlje s
// očekivanim, stupac po stupac, i gdje god se ne poklapaju UMETNE prazan
// stupac s ispravnim naslovom TOČNO na to mjesto (insertColumnBefore), umjesto
// da ga samo doda na kraj.
//
// NAPOMENA (bug otkriven 13.9.2026.): dodavanje 'kontakt_funkcija_ostalo' i
// 'sezonalnost_mjeseci' usred UPIT_FIELDS popisa pomaknulo je sve stupce
// nakon njih, pa su upiti/OB-tablice poslani NAKON te izmjene koda, a PRIJE
// ovog popravka, mogli završiti djelomično u pogrešnim stupcima. Ovaj
// popravak sprječava da se to ponovno dogodi ubuduće, ali NE ispravlja
// retroaktivno već upisane (pogrešne) vrijednosti u postojećim recima — te
// treba ručno provjeriti/ispraviti ili obrisati i ponovno zatražiti/unijeti.
// POPRAVAK 20.9.2026. (18. krug, TREĆI i konačan pokušaj — Sašin nalaz s
// točnim brojkama: "trenutno stvarnih stupaca u Sheetu: 352, ukupno
// očekivano stupaca: 353" — dakle padalo je BAŠ na zadnjem, 353. stupcu
// ("Napomena KAM-a (admin)"). Pravi uzrok: insertColumnBefore(N) zahtijeva
// da stupac N već postoji (umeće "ispred" njega) — kad N == trenutni broj
// stupaca + 1 (dakle dodajemo na sam KRAJ, nema ničeg iza čega bi se
// umetalo), insertColumnBefore puca s "izvan granica". Za čisto DODAVANJE na
// kraj popisa nikakvo umetanje nije ni potrebno — obično pisanje vrijednosti
// (setValue) izvan trenutnih granica samo od sebe proširi mrežu Sheeta.
// insertColumnBefore se sad zove SAMO kad stvarno umećemo NASRED postojećih
// stupaca (kad iza te pozicije još ima pravih, postojećih stupaca).
function uskladiZaglavljeUpitiSheeta_(sheet, ocekivano) {
  var lastCol = sheet.getLastColumn();
  var trenutno = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  for (var j = 0; j < ocekivano.length; j++) {
    if (trenutno[j] === ocekivano[j]) { continue; }
    try {
      if (j < sheet.getLastColumn()) {
        // Ima stvarnih stupaca iza ove pozicije — pravo umetanje, pomiče ih udesno.
        sheet.insertColumnBefore(j + 1);
        SpreadsheetApp.flush();
      }
      // Inače: čisto dodavanje na kraj, nema što umetati — samo upiši.
      sheet.getRange(1, j + 1).setValue(ocekivano[j]).setFontWeight('bold');
      SpreadsheetApp.flush();
      trenutno.splice(j, 0, ocekivano[j]);
    } catch (err) {
      throw new Error('Poravnanje zaglavlja palo na stupcu ' + (j + 1) + ' ("' + ocekivano[j] +
        '") — trenutno stvarnih stupaca u Sheetu: ' + sheet.getLastColumn() +
        ', ukupno očekivano stupaca: ' + ocekivano.length + '. Izvorna Google greška: ' + err.message);
    }
  }
}

// ---- SAŽETAK ZA PLAIN-TEXT EMAIL (obavijest Saši) ----
// `fieldsList` je opcionalan — zadano UPIT_FIELDS (glavni upitnik), ali se
// ista funkcija koristi i za ANKETA_FIELDS (anketa o kvaliteti usluge, vidi
// saveAnketa() niže) kako se ne bi duplicirala identična petlja.
function buildPlainTextSummary(data, fieldsList) {
  fieldsList = fieldsList || UPIT_FIELDS;
  var lines = [];
  for (var i = 0; i < fieldsList.length; i++) {
    var f = fieldsList[i];
    if (f.sec) {
      lines.push('\n== ' + f.sec + ' ==');
      continue;
    }
    var v = val(data[f[0]]);
    if (!v) { continue; }
    lines.push(f[1] + ': ' + v);
  }
  return lines.join('\n');
}

// ---- HTML SAŽETAK (za mail Saši, ako se ikad zatreba, i za bazu potvrde klijentu) ----
// Isto — `fieldsList` opcionalan, zadano UPIT_FIELDS, dijeli se s anketom.
function buildFieldsHtml(data, fieldsList) {
  fieldsList = fieldsList || UPIT_FIELDS;
  var html = '';
  var openList = false;
  for (var i = 0; i < fieldsList.length; i++) {
    var f = fieldsList[i];
    if (f.sec) {
      if (openList) { html += '</table>'; openList = false; }
      html += '<h3 style="margin:20px 0 6px;font-size:14px;color:#135450;">' + f.sec + '</h3>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
      openList = true;
      continue;
    }
    var v = val(data[f[0]]);
    if (!v) { continue; }
    html +=
      '<tr>' +
        '<td style="padding:4px 8px 4px 0;color:#6b6b6b;vertical-align:top;white-space:nowrap;">' + f[1] + '</td>' +
        '<td style="padding:4px 0;color:#1a1a1a;">' + v + '</td>' +
      '</tr>';
  }
  if (openList) { html += '</table>'; }
  return html;
}

// ---- HTML OBAVIJEST SAŠI (glavni prodajni upitnik) ----
// Isti header-slika (EMAIL_HEADER_IMG) i vizualni obrazac kao ostale mailove
// — ranije je ovo bio običan tekstualni mail (MailApp `body`), sada htmlBody
// radi konzistentnog izgleda i header-slike (korisnikov zahtjev).
function buildUpitAdminNotificationEmail(data) {
  return '' +
  '<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a;">' +
    '<img src="' + EMAIL_HEADER_IMG + '" alt="In Time d.o.o." style="width:100%;max-width:640px;height:auto;display:block;">' +
    '<div style="padding:26px 24px;">' +
      '<p><b>Novi popunjeni prodajni upitnik</b> — ' + (val(data.naziv) || 'nepoznata tvrtka') + '</p>' +
      '<div style="background:#f7fafb;border:1px solid #e2e6ea;border-radius:8px;padding:14px 16px;margin:14px 0;">' +
        buildFieldsHtml(data) +
      '</div>' +
    '</div>' +
    '<div style="background:#f7fafb;border-top:1px solid #e2e6ea;padding:14px 24px;font-size:11px;color:#6b6b6b;">' +
      'In Time d.o.o. · Zelena aleja 28, 10410 Vukovina · Tel: 01 6254 444' +
    '</div>' +
  '</div>';
}

// ---- HTML POTVRDA KLIJENTU ----
function buildUpitConfirmationEmail(data, ispravakToken, ispravakLozinka) {
  var ime = val(data.odgovorna_osoba) || val(data.kontakt);
  var ispravakLink = ISPRAVAK_STRANICA_URL + '?token=' + encodeURIComponent(ispravakToken || '');
  return '' +
  '<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a;">' +
    '<img src="' + EMAIL_HEADER_IMG + '" alt="In Time d.o.o." style="width:100%;max-width:640px;height:auto;display:block;">' +
    '<div style="padding:26px 24px;">' +
      '<p>Poštovani' + (ime ? ' ' + ime : '') + ',</p>' +
      '<p>Hvala Vam na interesu za suradnju s In Time d.o.o. Zaprimili smo Vaš prodajni upitnik i naš prodajni predstavnik javit će Vam se u najkraćem mogućem roku radi dogovora oko prezentacije i pripreme ponude/ugovora.</p>' +
      '<p style="font-size:13px;color:#6b6b6b;">U nastavku šaljemo pregled podataka koje ste nam poslali, radi Vaše evidencije:</p>' +
      '<div style="background:#f7fafb;border:1px solid #e2e6ea;border-radius:8px;padding:14px 16px;margin:14px 0;">' +
        buildFieldsHtml(data) +
      '</div>' +
      '<div style="background:#fff8e1;border:1px solid #f0d98c;border-radius:8px;padding:14px 16px;margin:14px 0;">' +
        '<p style="margin:0 0 8px 0;font-weight:bold;color:#8a6d00;">Naknadni ispravak podataka</p>' +
        '<p style="margin:0 0 8px 0;font-size:13px;">Ako naknadno uočite grešku ili želite nešto ispraviti, svoje podatke možete pregledati putem sljedeće poveznice:</p>' +
        '<p style="margin:0 0 4px 0;font-size:13px;word-break:break-all;"><a href="' + ispravakLink + '">' + ispravakLink + '</a></p>' +
        '<p style="margin:0 0 8px 0;font-size:13px;">Lozinka: <b>' + (ispravakLozinka || '') + '</b></p>' +
        '<p style="margin:0;font-size:12px;color:#6b6b6b;">Napomena: putem poveznice uvijek možete pregledati poslane podatke, ali ih možete i UREDITI tek nakon što In Time d.o.o. to odobri. Ako želite ispraviti podatke, javite nam se na sbatinac.intime@gmail.com — nakon odobrenja moći ćete urediti odobrena poglavlja upitnika putem iste poveznice.</p>' +
      '</div>' +
      '<p>Stojimo Vam na raspolaganju za sva dodatna pitanja.</p>' +
      '<p style="margin-top:24px;">Srdačan pozdrav,<br>' +
      '<b>Saša Batinac</b><br>' +
      'Sales and Marketing Manager, Voditelj ključnih kupaca<br>' +
      'In Time d.o.o. — Licensee of FedEx<br>' +
      'M: +385 91 6262 171 · sasa.batinac@in-time.hr</p>' +
    '</div>' +
    '<div style="background:#f7fafb;border-top:1px solid #e2e6ea;padding:14px 24px;font-size:11px;color:#6b6b6b;">' +
      'In Time d.o.o. · Zelena aleja 28, 10410 Vukovina · Tel: 01 6254 444' +
    '</div>' +
  '</div>';
}

// ============================================================
// OB TABLICA — "popuni kasnije, pošalji mailom" (dodatni Online Booking
// računi). Vidi opširnu napomenu o računu (sbatinac.intime@gmail.com) i
// zahtjevu za "Drive API" naprednim servisom uz konfiguraciju na vrhu
// datoteke prije čitanja koda ispod.
// ============================================================

// ---- SLANJE EXCEL PREDLOŠKA KLIJENTU ----
// Napravi privremeni Google Sheet s predloškom (ćelija B1 = korelacijski ID,
// zaglavlje + do OB_TABLICA_MAX praznih redova), izveze ga kao .xlsx i
// pošalje na `mail` putem GmailApp-a (NE MailApp-a — GmailApp ostavlja
// pravu Gmail nit na koju klijent može jednostavno odgovoriti "Reply", a
// nama je kasnije lakše pretragom pronaći odgovor). ID putuje i u predmetu
// maila (`[ID: ...]`, ostaje vidljiv i u "Re:" odgovoru) I u samoj tablici
// (ćelija B1) — prepoznavanje je tako robusno čak i ako klijent preimenuje
// priloženu datoteku. Privremeni Sheet se briše (trash) odmah nakon slanja.
function posaljiOBTablicuPredlozak(mail, tablicaId, nazivTvrtke) {
  if (!mail || !tablicaId) { return; }

  var ss = SpreadsheetApp.create('OB predložak – ' + (nazivTvrtke || 'klijent') + ' – ' + tablicaId);
  var tempFileId = ss.getId();
  try {
    var sheet = ss.getSheets()[0];
    sheet.setName('Dodatni OB računi');

    sheet.getRange(1, 1, 1, 2).setValues([['ID predloška (ne brišite ovaj redak):', tablicaId]]);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');

    var headerRow = 2;
    var headers = ['Redni broj računa'];
    for (var i = 0; i < OB_TABLICA_FIELDS.length; i++) { headers.push(OB_TABLICA_FIELDS[i][1]); }
    sheet.getRange(headerRow, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(headerRow, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(headerRow);

    var dataRows = [];
    for (var n = 1; n <= OB_TABLICA_MAX; n++) {
      var r = [n];
      for (var c = 0; c < OB_TABLICA_FIELDS.length; c++) { r.push(''); }
      dataRows.push(r);
    }
    sheet.getRange(headerRow + 1, 1, dataRows.length, headers.length).setValues(dataRows);
    sheet.autoResizeColumns(1, headers.length);
    SpreadsheetApp.flush();

    var xlsxBlob = exportSheetAsXlsxBlob_(tempFileId, 'InTime_OB_racuni_predlozak');

    var subject = '[ID: ' + tablicaId + '] In Time — predložak tablice za dodatne Online Booking račune';
    var body =
      'Poštovani,\n\n' +
      'U prilogu šaljemo Excel predložak tablice za unos podataka za dodatne Online Booking (OB) korisničke račune' +
      (nazivTvrtke ? (' za tvrtku ' + nazivTvrtke) : '') + '.\n\n' +
      'Molimo Vas da tablicu popunite (jedan redak po dodatnom OB računu — koliko Vam ih uistinu treba, ne morate ispuniti svih ' + OB_TABLICA_MAX + ') te je vratite jednostavnim odgovorom na ovaj e-mail (Reply), s ispunjenom tablicom u prilogu.\n\n' +
      'VAŽNO: molimo NE mijenjajte naziv priložene datoteke i ne brišite prvi redak s ID-em predloška (ćelija B1) — po njemu automatski prepoznajemo i povezujemo podatke s Vašim upitnikom.\n\n' +
      'Hvala unaprijed!\n\n' +
      'Srdačan pozdrav,\n' +
      'In Time d.o.o.';

    GmailApp.sendEmail(mail, subject, body, { attachments: [xlsxBlob] });
  } finally {
    DriveApp.getFileById(tempFileId).setTrashed(true);
  }
}

// ---- POMOĆNA FUNKCIJA — izvoz Google Sheeta kao .xlsx blob ----
function exportSheetAsXlsxBlob_(spreadsheetId, fileName) {
  var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export?format=xlsx';
  var token = ScriptApp.getOAuthToken();
  var response = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  return response.getBlob().setName(fileName + '.xlsx');
}

// ---- POMOĆNA FUNKCIJA — pretvara primljeni .xlsx prilog u privremeni
// Google Sheet (potrebno da bi se podaci uopće mogli pročitati) preko
// naprednog "Drive API" servisa — MORA biti ručno omogućen u editoru
// (Services → + → Drive API) prije prvog pokretanja procesirajOBTabliceOdgovore().
function pretvoriXlsxUSheet_(blob) {
  var resource = {
    name: blob.getName().replace(/\.xlsx$/i, '') + ' (OB tablica – privremeno)',
    mimeType: MimeType.GOOGLE_SHEETS
  };
  var file = Drive.Files.create(resource, blob);
  return file.id;
}

// ---- POMOĆNA FUNKCIJA — pretvara ključ iz UPIT_FIELDS u 1-based indeks
// kolone u Sheetu "InTime_Upiti" (Timestamp=1, Tip=2, zatim redom polja
// koja nisu {sec:...} naslovi sekcije — isti redoslijed kao u getOrCreateUpitiSheet()). ----
function stupacIndeksZaPolje(kljuc) {
  var idx = 3; // Timestamp=1, Tip=2, Broj=3
  for (var i = 0; i < UPIT_FIELDS.length; i++) {
    var f = UPIT_FIELDS[i];
    if (f.sec) { continue; }
    idx++;
    if (f[0] === kljuc) { return idx; }
  }
  return -1;
}

// ---- PERIODIČNA OBRADA — traži Gmail niti koje su odgovor na poslani OB
// predložak (po predmetu "[ID: OB-...]"), s .xlsx prilogom, koje još nisu
// obrađene ni označene kao neprepoznate. Za svaku pronađenu nit pretvara
// prilog u privremeni Sheet, čita podatke, pronalazi odgovarajući red u
// "InTime_Upiti" (po dodatni_ob_tablica_id) i upisuje podatke izravno u
// dodatni_ob_{polje}_{n} kolone tog reda. Pokreće se vremenskim trigerom —
// vidi postaviTrigerZaOBTablice() niže.
function procesirajOBTabliceOdgovore() {
  var labelObradjeno = ensureObLabel_(OB_LABEL_PROCESSED);
  var labelNeprepoznato = ensureObLabel_(OB_LABEL_UNRECOGNIZED);

  var upitiSheet = getOrCreateUpitiSheet();
  var idCol = stupacIndeksZaPolje('dodatni_ob_tablica_id');
  if (idCol === -1) {
    Logger.log('stupacIndeksZaPolje nije pronašao dodatni_ob_tablica_id — provjeri UPIT_FIELDS.');
    return;
  }

  var threads = GmailApp.search(
    'subject:"[ID: OB-" has:attachment -label:' + OB_LABEL_PROCESSED + ' -label:' + OB_LABEL_UNRECOGNIZED,
    0, 50
  );

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    try {
      obradiOBNit_(thread, upitiSheet, idCol, labelObradjeno, labelNeprepoznato);
    } catch (err) {
      Logger.log('Greška kod obrade OB niti "' + thread.getFirstMessageSubject() + '": ' + err.message);
      thread.addLabel(labelNeprepoznato);
      MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        subject: 'GREŠKA — obrada OB tablice nije uspjela',
        body: 'Nit: ' + thread.getFirstMessageSubject() + '\nGreška: ' + err.message +
          '\n\nMolimo provjerite ručno u Gmailu (oznaka "' + OB_LABEL_UNRECOGNIZED + '").'
      });
    }
  }
}

// ---- OBRADA JEDNE GMAIL NITI (pomoćna funkcija za procesirajOBTabliceOdgovore) ----
function obradiOBNit_(thread, upitiSheet, idCol, labelObradjeno, labelNeprepoznato) {
  var messages = thread.getMessages();
  var xlsxAttachment = null;
  var tablicaId = null;

  for (var m = messages.length - 1; m >= 0; m--) {
    var subjectMatch = messages[m].getSubject().match(/\[ID:\s*(OB-[A-Z0-9\-]+)\]/i);
    if (subjectMatch) { tablicaId = subjectMatch[1].toUpperCase(); }
    var atts = messages[m].getAttachments();
    for (var a = 0; a < atts.length; a++) {
      if (/\.xlsx$/i.test(atts[a].getName())) { xlsxAttachment = atts[a]; }
    }
    if (xlsxAttachment && tablicaId) { break; }
  }

  if (!xlsxAttachment || !tablicaId) {
    // Nit odgovara po predmetu, ali (još) nema priloga ili čitljivog ID-a —
    // preskoči ovaj put (npr. klijent je samo odgovorio bez priloga), ne
    // označavaj kao neprepoznato jer se možda uskoro pojavi ispravan odgovor.
    return;
  }

  var tempFileId = pretvoriXlsxUSheet_(xlsxAttachment);
  try {
    var tempSs = SpreadsheetApp.openById(tempFileId);
    var tempSheet = tempSs.getSheets()[0];
    var values = tempSheet.getDataRange().getValues();

    // Dodatna provjera ID-a iz ćelije B1 (uz onaj iz predmeta maila)
    var idUCeliji = values.length > 0 ? String(values[0][1] || '').trim().toUpperCase() : '';
    if (idUCeliji && idUCeliji !== tablicaId) {
      throw new Error('ID iz predmeta (' + tablicaId + ') ne odgovara ID-u iz tablice (' + idUCeliji + ').');
    }

    // Pronađi red u "InTime_Upiti" s odgovarajućim dodatni_ob_tablica_id
    var upitiData = upitiSheet.getDataRange().getValues();
    var upitRowIndex = -1;
    for (var r = 1; r < upitiData.length; r++) {
      if (String(upitiData[r][idCol - 1] || '').trim().toUpperCase() === tablicaId) {
        upitRowIndex = r + 1; // 1-based red u Sheetu
        break;
      }
    }

    if (upitRowIndex === -1) {
      thread.addLabel(labelNeprepoznato);
      MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        subject: 'OB tablica — nije pronađen odgovarajući upit (ID ' + tablicaId + ')',
        body: 'Primljena je popunjena OB tablica s ID-em ' + tablicaId + ', ali u tablici "InTime_Upiti" nije pronađen red s tim ID-em. Molimo provjerite ručno.\n\nGmail nit: ' + thread.getFirstMessageSubject()
      });
      return;
    }

    // Redci s podacima počinju odmah nakon zaglavlja (values[0]=ID redak,
    // values[1]=zaglavlje, values[2+]=podaci). Stupci unutar retka:
    // [0]=redni broj, [1]=poslovnica, [2]=ime, [3]=adresa, [4]=grad,
    // [5]=poštanski broj, [6]=mail, [7]=mobitel, [8]=login_email.
    var polja = ['poslovnica', 'ime', 'adresa', 'grad', 'postanski_broj', 'mail', 'mobitel', 'login_email'];
    var upisano = 0;
    for (var dr = 2; dr < values.length; dr++) {
      if (upisano >= OB_TABLICA_MAX) { break; }
      var row = values[dr];
      var imePrezime = String(row[2] || '').trim();
      if (!imePrezime) { continue; } // prazan/nepopunjen redak — preskoči

      upisano++;
      var n = upisano; // redoslijed popunjavanja = redoslijed dodatni_ob_*_{n}
      for (var pIdx = 0; pIdx < polja.length; pIdx++) {
        var kljuc = 'dodatni_ob_' + polja[pIdx] + '_' + n;
        var col = stupacIndeksZaPolje(kljuc);
        if (col === -1) { continue; }
        upitiSheet.getRange(upitRowIndex, col).setValue(row[1 + pIdx] || '');
      }
    }

    thread.addLabel(labelObradjeno);
  } finally {
    DriveApp.getFileById(tempFileId).setTrashed(true);
  }
}

// ---- POMOĆNA FUNKCIJA — dohvaća ili stvara Gmail oznaku ----
function ensureObLabel_(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (!label) { label = GmailApp.createLabel(name); }
  return label;
}

// ---- JEDNOKRATNO POKRETANJE (ručno, jednom u editoru, NAKON što je
// omogućen napredni servis "Drive API") — postavlja vremenski triger koji
// svakih 15 minuta poziva procesirajOBTabliceOdgovore(). Sigurno je pokrenuti
// više puta — prvo briše stari triger za istu funkciju ako postoji. ----
function postaviTrigerZaOBTablice() {
  var postojeci = ScriptApp.getProjectTriggers();
  for (var i = 0; i < postojeci.length; i++) {
    if (postojeci[i].getHandlerFunction() === 'procesirajOBTabliceOdgovore') {
      ScriptApp.deleteTrigger(postojeci[i]);
    }
  }
  ScriptApp.newTrigger('procesirajOBTabliceOdgovore')
    .timeBased()
    .everyMinutes(15)
    .create();
  Logger.log('Triger postavljen — procesirajOBTabliceOdgovore() pokretat će se svakih 15 minuta.');
}

// ---- JEDNOKRATNA AUTORIZACIJA (pokreni ručno jednom u editoru) ----
function testMail() {
  MailApp.sendEmail(NOTIFY_EMAIL, 'Test — In Time Apps Script', 'Ako si dobio ovaj mail, MailApp je autoriziran i backend je spreman.');
}

// ---- JEDNOKRATNA AUTORIZACIJA ZA DocumentApp (pokreni ručno jednom u
// editoru, NAKON što je uklonjen postojeći pristup na myaccount.google.com/
// permissions) — sam kreira testni Google dokument i odmah ga baca u smeće,
// samo da bi Google zatražio (i ti odobrio) novo dopuštenje za Docs koje
// treba admin export (buildKlijentExportDoc_). Nakon što jednom prođe
// autorizacija, ova funkcija se više ne mora koristiti — može ostati u
// kodu, ne smeta ničemu. ----
function testDoc() {
  var d = DocumentApp.create('TEST - obrisi me');
  DriveApp.getFileById(d.getId()).setTrashed(true);
  Logger.log('OK — DocumentApp je autoriziran.');
}
