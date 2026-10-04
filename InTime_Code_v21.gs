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

// ---- POSTAVKE — globalna adresa za skrivenu kopiju (BCC) SVAKOG izlaznog
// maila (27.9.2026., Sašin izričit zahtjev — postavlja se u adminu preko
// ikonice zupčanika u donjem desnom kutu). Adresa se čuva u Script
// Properties, isti obrazac kao GORIVO_PODSJETNIK_EMAIL i sl. Prazno = BCC
// isključen (nema dodatne skrivene kopije).
var POSTAVKE_GLOBALNI_BCC_KLJUC_ = 'GLOBALNI_BCC_MAIL';

function dohvatiGlobalniBccEmail_() {
  return (PropertiesService.getScriptProperties().getProperty(POSTAVKE_GLOBALNI_BCC_KLJUC_) || '').trim();
}

function adminPostavkeGet(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  return { status: 'ok', globalniBccMail: dohvatiGlobalniBccEmail_() };
}

function adminPostavkeSpremi(token, podaci) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var email = ((podaci && podaci.globalniBccMail) || '').toString().trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: 'error', message: 'Adresa e-pošte nije ispravna.' };
  }
  PropertiesService.getScriptProperties().setProperty(POSTAVKE_GLOBALNI_BCC_KLJUC_, email);
  return { status: 'ok' };
}

// Dodaje globalnu BCC adresu (ako je postavljena) na postojeći bcc niz,
// bez dupliciranja (npr. NOTIFY_EMAIL je već bcc na dosta mailova).
function dodajGlobalnuBcc_(postojeciBcc) {
  var globalna = dohvatiGlobalniBccEmail_();
  if (!globalna) { return postojeciBcc || undefined; }
  var lista = (postojeciBcc || '').toString().split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
  if (lista.indexOf(globalna) === -1) { lista.push(globalna); }
  return lista.join(',');
}

// Generičko formatiranje Sheet vrijednosti za prikaz u adminu/exportu —
// koristi se svugdje gdje se čitaju SVI stupci retka redom (header[c]/v),
// bez posebnog znanja o tome je li pojedini stupac datum ili samo vrijeme
// (27.9.2026., Sašin bug-report — "Vrijeme prikupa pošiljaka" prikazivalo se
// kao "30.12.1899. 14:00" umjesto "14:00"). Uzrok: kad korisnik na Upitniku
// upiše SAMO vrijeme (npr. iz <input type="time">) kao tekst "14:00", Google
// Sheets pri upisu u ćeliju (koja nije eksplicitno formatirana kao tekst)
// SAM prepozna taj tekst kao vremensku vrijednost i pretvori ga u datum s
// Sheetsovim/Excelovim danom-nula za "samo vrijeme" (30.12.1899.) — čitanje
// natrag (getValues()) onda vraća pravi JS Date objekt s TIM datumom, koji se
// dosad svugdje slijepo formatirao punim obrascem "dd.MM.yyyy. HH:mm".
// Rješenje: prepoznaje se upravo taj obrazac (godina < 1900, što se u
// praksi NIKAD ne događa za stvarne datume koje ovaj sustav bilježi) i za
// takve vrijednosti ispisuje se SAMO vrijeme ("HH:mm"), bez lažnog datuma.
// Stvarni datumi (2020.-2100. i sl.) i dalje dobivaju puni obrazac, nepromijenjeno.
function formatirajSheetVrijednost_(v) {
  if (!(v instanceof Date)) { return v; }
  if (v.getFullYear() < 1900) { return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm'); }
  return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm');
}

// ---- CENTRALNO SLANJE MAILA — SVI izlazni mailovi (postojeći i budući)
// MORAJU ići kroz ovu funkciju, ne izravno kroz GmailApp.sendEmail /
// MailApp.sendEmail, da bi globalna BCC postavka (gore) uvijek vrijedila
// bez obzira na to kroz koji se od ta dva API-ja mail šalje niti u kojem
// je obliku pozvan:
//   posaljiMail_(primatelj, predmet, tijelo, opcije)   — GmailApp oblik
//   posaljiMail_({ to: ..., subject: ..., body: ..., ... })  — MailApp oblik
function posaljiMail_(toIliOpcije, subject, body, opcije) {
  if (toIliOpcije && typeof toIliOpcije === 'object') {
    var opcijeSaBcc = Object.assign({}, toIliOpcije);
    opcijeSaBcc.bcc = dodajGlobalnuBcc_(opcijeSaBcc.bcc);
    MailApp.sendEmail(opcijeSaBcc);
  } else {
    var opts = Object.assign({}, opcije || {});
    opts.bcc = dodajGlobalnuBcc_(opts.bcc);
    GmailApp.sendEmail(toIliOpcije, subject, body, opts);
  }
}

// Admin kao kontrolni centar — Drive "root" folder (Faza 1, 19.9.2026., vidi
// claude/admin-kontrolni-centar-plan.md u Projectu za cijeli plan). Saša je
// ovaj folder sam napravio na svom Driveu i dao nam njegov ID — budući da
// Web App izvršava "kao Saša" (vidi napomenu o Deploy postavkama gore),
// skripta ima puni pristup bez ikakvog dodatnog dijeljenja. Svi poddirektoriji
// kontrolnog centra (POTENCIJALNI KLIJENTI, PONUDE, KLIJENTI, OSNOVNA
// DOKUMENTACIJA, IMENIK) žive unutar njega — vidi getSustavSubfolders_().
var SUSTAV_ROOT_FOLDER_ID = '1quxNuz5ePh20jmgjXlNI6S62KZL-hGT6';

// "Kanta - za brisanje" (Sašin izričit zahtjev, 23.9.2026.) — zaseban,
// GLOBALNI Drive direktorij (izvan SUSTAV_ROOT_FOLDER_ID, Saša ga je sam
// ručno stvorio i podijelio link) za SVE privremene/sirove uploade dokumenata
// ponude (i tri fiksna polja i "Ostali dokumenti"), PRIJE nego što se
// povežu s konkretnom ponudom. Razlog: dosad su ti sirovi uploadi ostajali
// trajno u klijentovom Drive direktoriju (razina 1) ili u "_INTERNO -
// privremeni uploadi" poddirektoriju — gomilali su se bez ikakvog čišćenja
// (Sašin primjer: "test_001_lasniranje.xlsx" duplo, stare REVIZIJA-datoteke).
// Sad SVI takvi sirovi uploadi idu ravno ovamo, jedan zajednički direktorij,
// koji se automatski prazni svaki dan (vidi dnevnoCiscenjeKanteZaBrisanje_
// niže) — klijentovi Drive direktoriji ostaju čisti.
var KANTA_ZA_BRISANJE_FOLDER_ID_ = '1hLMeuvxZ-dESl6qCJk7aQmF-2EBhoWgL';

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

// Arhiva uploada osnovnog (zadanog) cjenovnika kalkulatora — isti obrazac
// kao Zone arhiva gore. Vidi veliki komentar uz "KALKULATOR CIJENE —
// OSNOVNI (ZADANI) CJENOVNIK" niže u datoteci za pun opis.
var KALKULATOR_CJENIK_ARHIVA_FOLDER_NAME = 'InTime_Kalkulator_Cjenik_Arhiva';
var KALKULATOR_CJENIK_ARHIVA_SHEET_NAME = 'InTime_Kalkulator_Cjenik_Arhiva_Log';

// NOVO (1.10.2026., dvadeset i drugi krug, Sašin izričit zahtjev — "na oba
// mjesta mora biti polje gdje se stavlja novi cjenik... nemoj da bude
// vezano samo za ono polje kod ponude"): arhiva POJEDINAČNIH klijentskih
// cjenovnika — potpuno odvojena od gornje (koja arhivira samo OSNOVNI/
// ZADANI cjenovnik). Čuva se samo kao redak u Sheetu (JSON vrijednosti, BEZ
// kopije .xlsx datoteke na Disku) jer se izvorna klijentska .xlsx datoteka
// ("Cjenik Hrvatska") briše odmah nakon prve dodjele — vidi
// adminKalkulatorCjenikKlijentUpload/adminKalkulatorCjenikKlijentArhivaRestore
// niže.
var KALKULATOR_CJENIK_KLIJENT_ARHIVA_SHEET_NAME = 'InTime_Kalkulator_Cjenik_Klijent_Arhiva_Log';

// NOVO (30.9.2026., Sašin izričit zahtjev — "možemo li tu jednu datoteku
// cjenik napraviti da bude negdje dalje... da se ne prazni sama, već da se
// isprazni tek kad se cjenik dodijeli kalkulatoru"): dosad je uploadana
// "Cjenik Hrvatska" datoteka (ADMIN_ONLY_FIELDS.dokument_cjenik_hrvatska)
// ležala u ZAJEDNIČKOJ mapi "Kanta - za brisanje" (KANTA_ZA_BRISANJE_FOLDER_ID_)
// zajedno sa svim ostalim uploadima, koja se AUTOMATSKI prazni SVAKU NOĆ
// (dnevnoCiscenjeKanteZaBrisanje_) — neovisno o tome je li taj konkretan
// cjenik već iskorišten za dodjelu kalkulatora ili ne. Ta datoteka sad ide u
// OVU, zasebnu mapu (vidi getOrCreateKalkulatorCjenikHrCekaFolder_ i
// adminUploadPonudaDokument niže) — NIJE dio noćnog automatskog čišćenja,
// nego se BRIŠE RUČNO/TOČNO ONDA kad adminDodijeliKalkulatorPristup uspješno
// parsira i spremi cjenik+postavke (vidi taj kod niže) — jer je tek TADA
// izvorna datoteka stvarno više ne treba (podaci su ugrađeni u Sheet).
// Sve ostalo (Analitički cjenik, Ponuda za suradnju, "Ostali dokumenti") i
// dalje ide u Kanta - za brisanje, nepromijenjeno — Sašin zahtjev se
// izričito ticao SAMO ove jedne datoteke.
var KALKULATOR_CJENIK_HR_CEKA_FOLDER_NAME = 'InTime_Kalkulator_CjenikHrvatska_Ceka_Dodjelu';

// Zaseban Google Sheet za STVARNE mjesečne postotke dodatka na gorivo
// (Sašin izričit zahtjev, 25.9.2026., glasovna poruka — modul "Gorivo",
// vidi opširnu napomenu uz getOrCreateGorivoSheet_() niže). Jedan redak po
// mjesecu: Godina, Mjesec (1-12), Postotak, Napomena, DatumUnosa.
var GORIVO_SHEET_NAME = 'InTime_Gorivo_Postotci';

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
   (30 ocjena kvalitete + 2 NPS pitanja + slobodni komentari — prošireno s 25
   na 30 dodatkom poglavlja "Računovodstvo, fakturiranje i otkupnine",
   25.9.2026.), ne "podatke o tvrtki radi ponude". ANKETA_FIELDS je izvor istine za redoslijed stupaca u
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
  {sec:'Računovodstvo, fakturiranje i otkupnine'},
  ['q26', 'Točnost i pravovremenost izdavanja računa/faktura (0-10 ili "Ne mogu procijeniti")'],
  ['q26_komentar', 'Komentar uz pitanje: Točnost i pravovremenost računa'],
  ['q27', 'Preglednost i jednostavnost usklađivanja evidencija (0-10 ili "Ne mogu procijeniti")'],
  ['q27_komentar', 'Komentar uz pitanje: Usklađivanje evidencija'],
  ['q28', 'Točnost obračunatih otkupnina (0-10 ili "Ne mogu procijeniti")'],
  ['q28_komentar', 'Komentar uz pitanje: Točnost otkupnina'],
  ['q29', 'Brzina isplate naplaćenih otkupnina (0-10 ili "Ne mogu procijeniti")'],
  ['q29_komentar', 'Komentar uz pitanje: Brzina isplate otkupnina'],
  ['q30', 'Dostupnost i susretljivost računovodstva/administracije (0-10 ili "Ne mogu procijeniti")'],
  ['q30_komentar', 'Komentar uz pitanje: Dostupnost računovodstva'],
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
  { naziv: 'Računovodstvo, fakturiranje i otkupnine', pitanja: ['q26', 'q27', 'q28', 'q29', 'q30'] },
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
  // NOVO (23.9.2026., Dio 2) — vidi punu napomenu uz ADMIN_ONLY_FIELDS.skriveno
  // (u InTime_Code.gs, gore u datoteci) — isto polje/naziv stupca kao u
  // "InTime_Upiti", ovdje za tab Ankete. Dodano na sam kraj, self-healing
  // (uskladiZaglavljeUpitiSheeta_) ga umeće bez pomicanja postojećih podataka.
  header.push('Skriveno (admin)');
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

// ---- STABILNO razrješavanje foldera po ID-u (23.9.2026., Sašin izričit
// zahtjev, nakon PRAVOG buga u produkciji: "nakon što sam promijenio OIB
// klijenta automatski mi se sve razdvojilo, nastao je još jedan GLAVNI
// direktorij klijenta i tamo su se počele slagati dalje ponude... možemo
// li taj problem nekako riješiti ako promijenimo OIB i naziv grada
// klijenta i ime klijenta") ----
//
// getOrCreateChildFolder_/getOrCreateVerzijaFolder_ iznad UVIJEK traže
// folder po TOČNOM (ili tolerantnom) STRINGU imena, izračunatom iz
// TRENUTNIH vrijednosti naziv/OIB/grad iz Sheeta. To je bilo dovoljno dok
// se ta polja nisu naknadno ispravljala — ali čim se npr. OIB ispravi (bilo
// zato što je krivo unesen, bilo zato što se promijenio), formula proizvede
// DRUGAČIJI naziv foldera, pretraga po imenu više ne pronalazi POSTOJEĆI
// folder, i sljedeći poziv (adminPripremiDokumenteZaPonudu, potvrdiPonudu,
// odbijPonudu, zabiljeziEvidencijuSlanja_...) stvara SASVIM NOVI, prazan
// folder — stari (sa svim dosadašnjim dokumentima) ostaje "siroče", nitko
// ga više ne nalazi automatski, a nove ponude se od tog trenutka slažu u
// NOVI folder. Točno ovo se dogodilo u produkciji.
//
// Rješenje: od sad se STVARNI Drive ID glavnog klijentovog foldera i ID
// aktivnog predirektorija ponude TRAJNO pamte u Sheetu
// (ADMIN_ONLY_FIELDS.klijent_folder_id / .aktivni_predirektorij_folder_id).
// Svaki poziv koji treba folder PRVO pokuša dohvatiti POSTOJEĆI folder po
// spremljenom ID-u (DriveApp.getFolderById — dohvat po ID-u nikad ne ovisi
// o imenu) i, ako je ime u međuvremenu zastarjelo (OIB/grad/naziv
// ispravljen), samo ga PREIMENUJE na svježe izračunato ime — isti folder,
// ista povijest dokumenata, samo ažuran naziv. TEK ako spremljeni ID ne
// postoji (prvi put za ovog klijenta, ili je ID prazan jer je zapis
// nastao PRIJE ovog ispravka) pada natrag na staro traženje/stvaranje po
// imenu — i tada NOVO pronađeni/stvoreni ID odmah sprema natrag u Sheet,
// tako da SVI budući pozivi za taj redak odsad idu isključivo preko ID-a.
//
// VAŽNO — ovo štiti samo BUDUĆE promjene, od trenutka kad redak jednom
// dobije spremljen ID. Folderi koji su se VEĆ razdvojili PRIJE ovog
// ispravka ostaju razdvojeni dok se ručno ne spoje na Driveu (Saša ih
// treba ručno pronaći i spojiti/premjestiti sadržaj) — vidi napomenu u
// porukama uz isporuku ovog ispravka.
// NOVO (3.10.2026., Sašin zahtjev): kad je ponuda prebačena među KLIJENTE, osnovni direktorij se
// zove "{TM broj} - Naziv - OIB - GRAD" umjesto "PONUDA - Naziv - OIB - GRAD". Ova funkcija vraća
// pravo ime za trenutno stanje retka: ako je klijent otvoren (datum otvaranja) I ima TM broj →
// TM-ime, inače nepromijenjeno "PONUDA - ..." ime. Koristi je resolveKlijentFolderStabilno_ da
// samoobnavljajuće preimenovanje ne vrati staro ime.
function klijentFolderCiljnoIme_(sheet, header, rowIndex, ponudaIme) {
  try {
    var otvCol = header.indexOf(ADMIN_ONLY_FIELDS.datum_otvaranja);
    var tmCol = header.indexOf('Identifikacijski TM broj klijenta (admin)');
    if (otvCol === -1 || tmCol === -1) { return ponudaIme; }
    var otv = String(sheet.getRange(rowIndex, otvCol + 1).getValue() || '').trim();
    var tm = String(sheet.getRange(rowIndex, tmCol + 1).getValue() || '').replace(/[\\\/:*?"<>|]+/g, '_').trim();
    if (!otv || !tm) { return ponudaIme; }
    return tm + ' - ' + String(ponudaIme).replace(/^PONUDA - /, '');
  } catch (e) { return ponudaIme; }
}

function resolveKlijentFolderStabilno_(sheet, header, rowIndex, ponudeSustavFolder, klijentFolderName) {
  var idCol = header.indexOf(ADMIN_ONLY_FIELDS.klijent_folder_id);
  var postojeciId = (idCol !== -1) ? String(sheet.getRange(rowIndex, idCol + 1).getValue() || '').trim() : '';
  var folder = null;
  if (postojeciId) {
    try {
      folder = DriveApp.getFolderById(postojeciId);
      // Preimenuj SAMO ako se ime stvarno promijenilo (OIB/grad/naziv
      // ispravljen u međuvremenu) — izbjegava nepotreban Drive poziv kad je
      // ionako već ažurno.
      var ciljnoImeKlijent_ = klijentFolderCiljnoIme_(sheet, header, rowIndex, klijentFolderName);
      if (folder.getName() !== ciljnoImeKlijent_) {
        folder.setName(ciljnoImeKlijent_);
      }
    } catch (err) {
      // ID zapisan, ali folder više ne postoji (ručno obrisan/premješten iz
      // Drivea) — padni natrag na traženje/stvaranje po imenu ispod.
      folder = null;
    }
  }
  if (!folder) {
    folder = getOrCreateChildFolder_(ponudeSustavFolder, klijentFolderName);
  }
  if (idCol !== -1) {
    sheet.getRange(rowIndex, idCol + 1).setValue(folder.getId());
  }
  return folder;
}

// Isto kao resolveKlijentFolderStabilno_ iznad, ali za PREDIREKTORIJ TE
// KONKRETNE VERZIJE ponude. Dodatna suptilnost: getOrCreateVerzijaFolder_
// je tolerantan na sufiks " - PRIHVAĆENA" koji stvoriDokumentPotvrdePonude_
// dodaje nazivu ČIM se ponuda prihvati (vidi napomenu uz tu funkciju) — pa
// preimenovanje ovdje MORA sačuvati taj sufiks ako ga folder već ima,
// inače bi svaki sljedeći poziv (npr. Export podataka) slučajno "izbrisao"
// vizualnu oznaku prihvaćanja s Drivea, iako je ponuda i dalje prihvaćena.
function resolveVerzijaFolderStabilno_(sheet, header, rowIndex, klijentFolder, verzijaFolderNameBazno) {
  var idCol = header.indexOf(ADMIN_ONLY_FIELDS.aktivni_predirektorij_folder_id);
  var postojeciId = (idCol !== -1) ? String(sheet.getRange(rowIndex, idCol + 1).getValue() || '').trim() : '';
  var folder = null;
  if (postojeciId) {
    try {
      folder = DriveApp.getFolderById(postojeciId);
      var trenutnoIme_ = folder.getName();
      var imaSufiksPrihvaceno_ = trenutnoIme_.indexOf(' - PRIHVAĆENA') !== -1;
      var ciljnoIme_ = verzijaFolderNameBazno + (imaSufiksPrihvaceno_ ? ' - PRIHVAĆENA' : '');
      if (trenutnoIme_ !== ciljnoIme_) {
        folder.setName(ciljnoIme_);
      }
    } catch (err) {
      folder = null;
    }
  }
  if (!folder) {
    folder = getOrCreateVerzijaFolder_(klijentFolder, verzijaFolderNameBazno);
  }
  if (idCol !== -1) {
    sheet.getRange(rowIndex, idCol + 1).setValue(folder.getId());
  }
  return folder;
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
  predlosciSlike: 'PREDLOSCI SLIKE',
  // NOVO (23.9.2026., Sašin izričit zahtjev) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.arhiva_kategorija i premjestiKlijentFolderUKategorijuArhive_
  // niže. getSustavSubfolders_() ispod je generički (petlja preko OVIH
  // ključeva) pa dodavanje jednog novog ključa ovdje je jedino što treba —
  // folder se sam stvara na prvi poziv, cache-sloj se sam obnavlja.
  arhiva: 'ARHIVA',
  // NOVO (30.9.2026., ispravak istog dana — Sašino pojašnjenje: dokumenti uz
  // panel "Pošalji pristupne podatke klijentu" nisu po-klijentu, nego OPĆE
  // upute za korištenje, ISTE za sve klijente). JEDAN zajednički direktorij
  // — vidi getOpciDokumentiKlijentPristupFolderJavni_() niže, koji ga (preko
  // OVOG cache-a) dohvaća brzo i osigurava da je javno dijeljen ("svatko s
  // poveznicom — pregledavač") tako da klijent može otvoriti gumb u mailu
  // bez Google prijave.
  opciDokumentiKlijentPristup: 'OPĆI DOKUMENTI - Upute za korisnike (Online Booking)'
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

// Isti direktorij kao getSustavSubfolders_().opciDokumentiKlijentPristup
// (vidi SUSTAV_SUBFOLDER_IMENA_ iznad), ali osigurava da je JAVNO dijeljen
// ("svatko s poveznicom — pregledavač") prije nego vrati folder — klijent
// otvara ovaj direktorij izravno preko gumba u mailu, BEZ Google prijave,
// pa mora biti dostupan van In Time Workspace domene (Sašin izričit
// zahtjev, 30.9.2026., ispravak istog dana: "google drive link ... ne ide
// mu fizički dokumenat, vec samo link na taj drive"). Provjera trenutnog
// pristupa (getSharingAccess) prije pisanja — da se setSharing ne poziva
// nepotrebno na svaki poziv. Umotano u try/catch — ako administratorska
// Workspace politika zabranjuje javno dijeljenje, folder ostaje kakav je
// (privatan), a Saša mora ručno podijeliti i staviti stvaran link u
// predložak — slanje maila time nije blokirano.
function getOpciDokumentiKlijentPristupFolderJavni_() {
  var folder = getSustavSubfolders_().opciDokumentiKlijentPristup;
  try {
    if (folder.getSharingAccess() === DriveApp.Access.PRIVATE) {
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }
  } catch (errDijeljenje) { /* Workspace politika ili slično — folder ostaje privatan, vidi napomenu iznad */ }
  return folder;
}

// ---- Arhiva — fizičko premještanje dokumentacije na Driveu (23.9.2026.,
// Sašin izričit zahtjev: "kad ga prebacim u arhivu da li dokumentacija
// mijenja mjesto na Google Disku... možemo li napraviti da fizički
// dokumentacija ide u direktorij Arhiva... da unutra dobije status") ----
//
// Ime poddirektorija ARHIVA/... po kategoriji — ključ je isti onaj koji se
// sprema u ADMIN_ONLY_FIELDS.arhiva_kategorija (Sheet), vrijednost je Drive
// naziv foldera (Sašin izričit zahtjev za velika/mala slova i sadržaj).
var ARHIVA_KATEGORIJA_FOLDER_IMENA_ = {
  ABANDON: 'ABANDON',
  ODBIJENA: 'ODBIJENA',
  PONISTENA: 'PONIŠTENA PONUDA',
  NIJE_DOVRSENA: 'NIJE DOVRŠENA'
};

// Iz statusa PONUDE (izracunajStatusPonude_) izračunava kategoriju arhive —
// koristi se SAMO za obično "Prebaci u arhivu" (adminPrebaciUArhivu niže),
// NE za Abandon (koji uvijek ide u 'ABANDON', bez obzira na status — Sašin
// izričit zahtjev). Vraća null za 'potvrdjena' — Saša je eksplicitno rekao
// da se prihvaćena ponuda NE stavlja u arhivu ("ako je prihvaćena onda je
// nećemo stavljati u arhivu, takve ponude stavljamo na drugo mjesto") —
// pozivatelj (adminPrebaciUArhivu) taj slučaj odbija s porukom prije nego
// uopće dođe dovde.
function odrediArhivaKategoriju_(status) {
  if (status === 'odbijena') { return 'ODBIJENA'; }
  if (status === 'ponistena' || status === 'ponistena_nakon_prihvata') { return 'PONISTENA'; }
  if (status === 'potvrdjena') { return null; }
  // nije_poslano / na_cekanju / istekla — "još nije dovršeno", Sašin
  // izričit zahtjev: "ako nije ni poslana onda napravi još kategorija NIJE
  // DOVRŠENA".
  return 'NIJE_DOVRSENA';
}

// Fizički premješta klijentov OSNOVNI direktorij ("PONUDA - Naziv - OIB -
// Grad", zajedno sa SVIM verzijama/dokumentima unutra) iz PONUDE/ u
// ARHIVA/<kategorija>/ na Driveu. Folder se REPARENTIRA (isti Drive ID,
// ista povijest — ne kopira se, ne zipira), pa klijent_folder_id u Sheetu
// ostaje ispravan i dalje (resolveKlijentFolderStabilno_ ga i dalje
// pronalazi po ID-u, bez obzira gdje fizički živi na Driveu).
//
// NAMJERNO odvojeno od upisa u Sheet (arhiva_kategorija/datum_prebacivanja_
// arhiva) — pozivatelj UVIJEK prvo upiše Sheet polja, pa TEK ONDA (u
// try/catch, nikad blokirajuće) pozove ovu funkciju, isti obrazac kao svaka
// druga Drive-operacija u ovoj skripti (npr. gašenje linka kod odbijanja):
// Drive kvar nikad ne smije srušiti/poništiti samu poslovnu radnju koja je
// već zabilježena u tablici.
function premjestiKlijentFolderUKategorijuArhive_(sheet, header, rowIndex, kategorijaKljuc) {
  var imeFoldera = ARHIVA_KATEGORIJA_FOLDER_IMENA_[kategorijaKljuc];
  if (!imeFoldera) { return; } // nepoznata kategorija — ne radi ništa, sigurnije nego pogađati

  var idCol = header.indexOf(ADMIN_ONLY_FIELDS.klijent_folder_id);
  var postojeciId = (idCol !== -1) ? String(sheet.getRange(rowIndex, idCol + 1).getValue() || '').trim() : '';
  var klijentFolder = null;
  if (postojeciId) {
    try { klijentFolder = DriveApp.getFolderById(postojeciId); } catch (err) { klijentFolder = null; }
  }
  if (!klijentFolder) {
    // Nema (valjanog) spremljenog ID-a — samoobnavljajući fallback po
    // imenu/OIB-u/gradu, isti izvor podataka kao resolveKlijentFolderStabilno_
    // poziva drugdje. Ako folder do sad uopće nije postojao (npr. ponuda
    // nikad nije pripremljena), ovo ga stvara — pa se odmah premješta.
    var row = sheet.getRange(rowIndex, 1, 1, header.length).getValues()[0];
    var naziv = (row[header.indexOf('Naziv tvrtke')] || '').toString().trim() || '(bez naziva)';
    var oib = (row[header.indexOf('OIB')] || '').toString().trim() || '(bez OIB-a)';
    var grad = (row[header.indexOf('Mjesto')] || '').toString().trim().toUpperCase() || '(bez mjesta)';
    var sub = getSustavSubfolders_();
    klijentFolder = resolveKlijentFolderStabilno_(sheet, header, rowIndex, sub.ponude, 'PONUDA - ' + naziv + ' - ' + oib + ' - ' + grad);
  }

  var ciljniRoditelj = getOrCreateChildFolder_(getSustavSubfolders_().arhiva, imeFoldera);
  var trenutniRoditelji = klijentFolder.getParents();
  var vecUnutra = false;
  while (trenutniRoditelji.hasNext()) {
    var roditelj = trenutniRoditelji.next();
    if (roditelj.getId() === ciljniRoditelj.getId()) { vecUnutra = true; continue; }
    roditelj.removeFolder(klijentFolder);
  }
  if (!vecUnutra) { ciljniRoditelj.addFolder(klijentFolder); }
}

// Obrnuto od premjestiKlijentFolderUKategorijuArhive_ iznad — vraća
// klijentov osnovni direktorij natrag u PONUDE/ (Sašin izričit zahtjev: "i
// sve se takve ponude moraju moći vratiti u ponude"). Isti obrazac: samo
// reparentira (isti ID), nikad ne blokira glavnu radnju ako Drive dio padne.
function vratiKlijentFolderIzArhive_(sheet, header, rowIndex) {
  var idCol = header.indexOf(ADMIN_ONLY_FIELDS.klijent_folder_id);
  var postojeciId = (idCol !== -1) ? String(sheet.getRange(rowIndex, idCol + 1).getValue() || '').trim() : '';
  if (!postojeciId) { return null; } // nema spremljen ID — nema što fizički vratiti
  var klijentFolder;
  try { klijentFolder = DriveApp.getFolderById(postojeciId); } catch (err) { return null; }

  var ciljniRoditelj = getSustavSubfolders_().ponude;
  var trenutniRoditelji = klijentFolder.getParents();
  var vecUnutra = false;
  while (trenutniRoditelji.hasNext()) {
    var roditelj = trenutniRoditelji.next();
    if (roditelj.getId() === ciljniRoditelj.getId()) { vecUnutra = true; continue; }
    roditelj.removeFolder(klijentFolder);
  }
  if (!vecUnutra) { ciljniRoditelj.addFolder(klijentFolder); }
  return klijentFolder;
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

// Generički preglednik dva direktorija sustava — "KLIJENTI" i "ARHIVA" —
// za ponovnu upotrebu STARIH dokumenata drugih klijenata pri izradi nove
// ponude (Sašin izričit zahtjev, 24.9.2026.: "da u stvaranju ponuda mogu
// koristiti i stare dokumente od klijenata koje smo već generirali i one
// koje smo možda arhivirali... da se može unutar prozora pregledavati po
// direktorijima unutar ta 2 foldera"). `korijen` je 'klijenti' ili 'arhiva'
// (ključevi u SUSTAV_SUBFOLDER_IMENA_/getSustavSubfolders_() — isti sustav
// koji već drži i "Osnovna dokumentacija" iznad). `folderId` je opcionalan
// — bez njega vraća sadržaj SAMOG korijena; s njim vraća sadržaj TE
// konkretne poddirektorija (drill-down navigacija s frontenda, klikom na
// podfolder).
//
// Sigurnosna ograda: traženi `folderId` MORA biti sam korijen ili njegov
// potomak (provjereno hodanjem kroz getParents() prema gore, max 15
// razina) — inače bi admin token (kroz izravan mrežni poziv, ne kroz
// sučelje) mogao pregledavati BILO KOJI Drive folder do kojeg ovaj Apps
// Script projekt ima pristup, ne samo KLIJENTI/ARHIVA. Ako traženi folder
// NIJE potomak korijena (npr. zastarjeli/neispravan ID), tiho pada natrag
// na sam korijen umjesto greške — isti "samoobnavljajući" duh kao
// getSustavSubfolders_() iznad.
//
// Vraća i `putanja` (breadcrumb, korijen prvi pa redom do trenutnog
// foldera) — frontend njome gradi klikabilnu stazu za povratak gore bez
// dodatnih poziva.
function adminBrowseSustavFolder(token, korijen, folderId) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  if (korijen !== 'klijenti' && korijen !== 'arhiva') {
    return { status: 'error', message: 'Nepoznat korijenski direktorij.' };
  }
  try {
    var sub = getSustavSubfolders_();
    var korijenFolder = sub[korijen];
    var ciljFolder = folderId ? DriveApp.getFolderById(folderId) : korijenFolder;

    var lanac = [];
    var trenutni = ciljFolder;
    var nasaoKorijen = false;
    for (var razina = 0; razina < 15; razina++) {
      lanac.push({ id: trenutni.getId(), name: trenutni.getName() });
      if (trenutni.getId() === korijenFolder.getId()) { nasaoKorijen = true; break; }
      var roditelji = trenutni.getParents();
      if (!roditelji.hasNext()) { break; }
      trenutni = roditelji.next();
    }
    if (!nasaoKorijen) {
      ciljFolder = korijenFolder;
      lanac = [{ id: korijenFolder.getId(), name: korijenFolder.getName() }];
    }
    lanac.reverse();

    var podfolderi = [];
    var itF = ciljFolder.getFolders();
    while (itF.hasNext()) {
      var f = itF.next();
      podfolderi.push({ id: f.getId(), name: f.getName() });
    }
    podfolderi.sort(function(a, b) { return a.name.localeCompare(b.name, 'hr'); });

    var datoteke = [];
    var itD = ciljFolder.getFiles();
    while (itD.hasNext()) {
      var d = itD.next();
      datoteke.push({ id: d.getId(), name: d.getName(), mimeType: d.getMimeType(), url: d.getUrl() });
    }
    datoteke.sort(function(a, b) { return a.name.localeCompare(b.name, 'hr'); });

    return {
      status: 'ok',
      folderId: ciljFolder.getId(),
      folderName: ciljFolder.getName(),
      putanja: lanac,
      podfolderi: podfolderi,
      datoteke: datoteke
    };
  } catch (err) {
    return { status: 'error', message: 'Pregled direktorija nije uspio: ' + err.message };
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
// za ta tri slota) — jer se taj isti dokument odmah zatim (automatska
// priprema) kopira i preimenuje u pravi direktorij ponude
// (adminPripremiDokumenteZaPonudu), originalni upload ovdje je samo
// privremeni "izvor" za kopiranje, ne treba biti vidljiv među pravim
// dokumentima klijenta.
//
// PROMIJENJENO (23.9.2026., trideset i treći krug — Sašin izričit zahtjev:
// "uvijek kopira sve dokumente... koji se preimenjuju u direktorij prije
// ponuda... vide se i ostaju tamo... napravi [to] u ovom direktoriju koji
// sam ti sad dodijelio... i onda... obriši sav sadržaj tog direktorija
// jednom dnevno"): SVI sirovi uploadi (i tri fiksna polja I "Ostali
// dokumenti") sad idu u ZAJEDNIČKI globalni direktorij "Kanta - za
// brisanje" (KANTA_ZA_BRISANJE_FOLDER_ID_), NE više u klijentov Drive
// direktorij ni u "_INTERNO" poddirektorij — klijentov direktorij time
// ostaje potpuno čist. Izvorno ime datoteke se NE mijenja ovdje (bitno za
// "Ostali dokumenti" — izvuciCistNaziv_ niže i dalje čita originalni Sašin
// obrazac imenovanja "InTime d.o.o. - Ime - napomena.ext" kod stvarnog
// kopiranja u pravi direktorij ponude; da se ime prefiksira već ovdje, taj
// obrazac bi se pokvario). Taj direktorij se automatski prazni svaki dan
// (vidi dnevnoCiscenjeKanteZaBrisanje_ niže) — ništa se tu ne zadržava
// trajno.
function adminUploadPonudaDokument(token, rowIndex, base64Data, mimeType, filename, zaFiksnoPolje) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  if (!base64Data || !filename) { return { status: 'error', message: 'Nedostaje datoteka za slanje.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  try {
    // NOVO (30.9.2026., Sašin izričit zahtjev) — "Cjenik Hrvatska" SAMA ide u
    // zasebnu mapu koja se NE prazni automatski svaku noć (vidi punu napomenu
    // uz KALKULATOR_CJENIK_HR_CEKA_FOLDER_NAME) — briše se tek kad
    // adminDodijeliKalkulatorPristup uspješno iskoristi taj cjenik. Sva ostala
    // fiksna polja i "Ostali dokumenti" (zaFiksnoPolje prazan/drugačiji) i
    // dalje idu u zajedničku Kanta - za brisanje, nepromijenjeno.
    var ciljFolder = (zaFiksnoPolje === 'cjenikhr')
      ? getOrCreateKalkulatorCjenikHrCekaFolder_()
      : DriveApp.getFolderById(KANTA_ZA_BRISANJE_FOLDER_ID_);

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
// Evidencija PRIPREME dokumenata — razlikuje se od "Evidencija slanja"
// (stvoriEvidencijuSlanja_ niže, koja bilježi SAMO stvarno slanje maila).
// Sašin izričit zahtjev (23.9.2026., trideset i peti krug): svaki put kad se
// klikne "Pripremi direktorij i link" (i prvi put i kod svakog ponavljanja,
// npr. dok se čeka klijentov odgovor) odmah mora postojati zapis KOJI
// dokumenti (pod nazivima NAKON preimenovanja — isti nazivi koji stvarno
// stoje u direktoriju/linku) su u tom trenutku dio ponude. Čuva POVIJEST, ne
// samo trenutno stanje — svaki poziv dodaje nov odjeljak NA KRAJ postojećeg
// dokumenta, ne prepisuje prijašnje. Zato je ova datoteka isključena iz
// brisanja kod ponovne pripreme (filtar "EVIDENCIJA" u
// adminPripremiDokumenteZaPonudu niže) i zato se ovdje NE pretvara u PDF i
// briše kao kod stvoriEvidencijuSlanja_ — ostaje živi Google dokument da bi
// se moglo nastaviti dopisivati sljedeći put.
function azurirajEvidencijuPripreme_(verzijaFolder, naziv, oib, grad, brojPonude, poslaniNazivi, sviNazivi) {
  var docNaziv = 'EVIDENCIJA PRIPREME - ' + naziv + ' - ' + oib;
  var doc, body;
  var postojeci = verzijaFolder.getFilesByName(docNaziv);
  if (postojeci.hasNext()) {
    doc = DocumentApp.openById(postojeci.next().getId());
    body = doc.getBody();
    body.appendHorizontalRule();
  } else {
    doc = DocumentApp.create(docNaziv);
    // DocumentApp.create() stvara datoteku u korijenu Drivea — premjesti je u
    // predirektorij da ne ostane vani, izgubljena.
    var noviDocFile = DriveApp.getFileById(doc.getId());
    verzijaFolder.addFile(noviDocFile);
    try { DriveApp.getRootFolder().removeFile(noviDocFile); } catch (errUkloni) { /* zanemari */ }
    body = doc.getBody();
    body.appendParagraph('Evidencija pripreme dokumenata ponude').setHeading(DocumentApp.ParagraphHeading.TITLE);
    body.appendParagraph('Naziv tvrtke: ' + naziv);
    body.appendParagraph('OIB: ' + oib);
    body.appendParagraph('Mjesto: ' + grad);
  }

  // ISPRAVAK (23.9.2026., Sašin izričit zahtjev — "treba mi naziv dokumenta
  // PRIJE preimenovanja i njegovo novo ime, da mogu povezati što je poslano
  // — taj dokument je postao taj dokument"): svaka stavka sad nosi i STARI
  // (izvorni, s Google Drivea) i NOVI (preimenovani) naziv — `poslaniNazivi`/
  // `sviNazivi` su niz objekata {staro, novo}, ne više goli nizovi stringova.
  var upisiParStaroNovo_ = function(stavka) {
    var staro = (stavka && stavka.staro) ? stavka.staro : '(nepoznat izvorni naziv)';
    var novo = (stavka && stavka.novo) ? stavka.novo : '(nepoznat novi naziv)';
    body.appendListItem(staro + '  →  ' + novo).setGlyphType(DocumentApp.GlyphType.BULLET);
  };
  body.appendParagraph('Priprema — ' + brojPonude + ' — ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm:ss')).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('Dokumenti poslani klijentu (dijeljeni direktorij "POSLANO") — izvorni naziv  →  naziv NAKON preimenovanja:').setHeading(DocumentApp.ParagraphHeading.HEADING3);
  if (poslaniNazivi.length) {
    poslaniNazivi.forEach(upisiParStaroNovo_);
  } else {
    body.appendParagraph('(nema)');
  }
  body.appendParagraph('Svi dokumenti u predirektoriju (uklj. interne koje klijent NE vidi) — izvorni naziv  →  naziv NAKON preimenovanja:').setHeading(DocumentApp.ParagraphHeading.HEADING3);
  if (sviNazivi.length) {
    sviNazivi.forEach(upisiParStaroNovo_);
  } else {
    body.appendParagraph('(nema)');
  }

  doc.saveAndClose();
}

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
    // ISPRAVAK (23.9.2026., vidi napomenu uz resolveKlijentFolderStabilno_
    // gore) — folder se odsad traži/prati po TRAJNO spremljenom Drive ID-u,
    // ne (samo) po imenu, da promjena OIB-a/grada/naziva klijenta ne stvori
    // drugi, "sirotski" glavni direktorij.
    var klijentFolder = resolveKlijentFolderStabilno_(sheet, header, rowIndex, sub.ponude, klijentFolderName);
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
    // ISPRAVAK (23.9.2026.) — isto, po ID-u umjesto (samo) po imenu.
    var verzijaFolder = resolveVerzijaFolderStabilno_(sheet, header, rowIndex, klijentFolder, verzijaFolderName);

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
    while (staraDjecaPredirektorij.hasNext()) {
      var kandidatBrisanjaPredirektorij_ = staraDjecaPredirektorij.next();
      // "EVIDENCIJA..." datoteke (Evidencija slanja i Evidencija pripreme, vidi
      // azurirajEvidencijuPripreme_ niže) se NE brišu ovdje — Sašin izričit
      // zahtjev (23.9.2026., trideset i peti krug): moraju preživjeti ponovljenu
      // pripremu jer čuvaju POVIJEST, a ne trenutno stanje.
      if (kandidatBrisanjaPredirektorij_.getName().indexOf('EVIDENCIJA') === 0) { continue; }
      kandidatBrisanjaPredirektorij_.setTrashed(true);
    }
    var staraDjecaPoslano = poslanoFolder.getFiles();
    while (staraDjecaPoslano.hasNext()) { staraDjecaPoslano.next().setTrashed(true); }

    var poslaniNaziviPripreme_ = [];
    var sviNaziviPripreme_ = [];
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
      // Par {staro, novo} umjesto golog novog naziva (23.9.2026., Sašin
      // izričit zahtjev — vidi napomenu uz azurirajEvidencijuPripreme_ gore).
      var parNaziva_ = { staro: originalIme, novo: noviNaziv };
      sviNaziviPripreme_.push(parNaziva_);
      if (slot === 'analiticki' || slot === 'cjenikhr') {
        // Interni dokumenti — SAMO u predirektoriju, klijent ih ne smije vidjeti.
        izvorFile.makeCopy(noviNaziv, verzijaFolder);
      } else if (slot === 'ponudasuradnja') {
        // Sama ponuda ide na OBA mjesta — klijentu (POSLANO) i u internu arhivu (predirektorij).
        izvorFile.makeCopy(noviNaziv, verzijaFolder);
        izvorFile.makeCopy(noviNaziv, poslanoFolder);
        poslaniNaziviPripreme_.push(parNaziva_);
      } else {
        // "Ostali dokumenti" — Sašin izričit zahtjev (23.9.2026., trideset i
        // treći krug): "želim i primjerak preimenovanih ostalih dokumenata u
        // direktoriju gdje je ostala dokumentacija vezana za ponudu, fale
        // preimenovani ostali dokumenti tu". Sad idu na OBA mjesta, isti
        // obrazac kao "ponudasuradnja" iznad — klijentu (POSLANO) I u internu
        // arhivu (predirektorij), obje kopije preimenovane isto.
        izvorFile.makeCopy(noviNaziv, verzijaFolder);
        izvorFile.makeCopy(noviNaziv, poslanoFolder);
        poslaniNaziviPripreme_.push(parNaziva_);
      }
    });

    // Sašin izričit zahtjev (23.9.2026., trideset i peti krug): "ako promijenim
    // sadržaj pa kliknem novi link, treba odmah definirati što se promijenilo"
    // — svaka priprema (prva i svaka ponovljena, npr. dok se čeka klijentov
    // odgovor) odmah ostavlja trag KOJI dokumenti (pod nazivima NAKON
    // preimenovanja, isti kao na Driveu) su u tom trenutku dio ponude. Greška
    // ovdje ne smije srušiti već izvršenu pripremu dokumenata.
    try {
      azurirajEvidencijuPripreme_(verzijaFolder, naziv, oib, grad, brojPonude, poslaniNaziviPripreme_, sviNaziviPripreme_);
    } catch (errEvidPripreme) { /* evidencija je pomoćna funkcija — zanemari grešku */ }

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
  // NOVO (26.9.2026., Sašin izričit zahtjev — bug uočen kod TESTNOG slanja
  // ponude): dok "Datum slanja aktivne ponude (admin)" još nije postavljen
  // (adminPosaljiPonudaTest ga NAMJERNO ne postavlja, samo stvarno slanje —
  // adminPosaljiPonudaMail — to radi), stanje je 'nije_poslano'. Poveznica
  // (token) je ista i već se pojavljuje u testnom mailu, pa se dok je stanje
  // 'nije_poslano' tretira kao testni pregled — klijentska strana ne
  // prikazuje obrazac, a potvrdiPonudu()/odbijPonudu() niže odbijaju svaki
  // pokušaj prihvaćanja/odbijanja preko ove poveznice dok se ponuda ne
  // pošalje stvarno. Bez ovoga Saša bi mogao (nesvjesno) "prihvatiti"
  // ponudu s testnog maila, pa bi kod stvarnog slanja klijentu ponuda već
  // izgledala prihvaćena.
  if (stanje === 'nije_poslano') {
    return { status: 'ok', nazivTvrtke: naziv, testnaPonuda: true };
  }
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
function potvrdiPonudu(token, oib, imeOsobe, funkcijaOsobe, ipAdresa, ocjenaZnanje, ocjenaPrezentacija, ocjenaUgovaranje) {
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
  // NOVO (26.9.2026.) — vidi napomenu uz potvrdaPonudeInfo() gore: dok
  // ponuda još nije STVARNO poslana klijentu (stanje 'nije_poslano'),
  // prihvaćanje preko ove poveznice je zabranjeno na SERVERU, bez obzira
  // što klijentska strana šalje — sprječava da testni mail nenamjerno
  // upiše stvarno prihvaćanje.
  if (stanje === 'nije_poslano') {
    return { status: 'error', testnaPonuda: true, message: 'Ovo je testni pregled ponude — ponuda još nije stvarno poslana klijentu, pa se ne može prihvatiti ovom poveznicom.' };
  }
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

  // Ocjena voditelja ključnih kupaca (23.9.2026., Sašin izričit zahtjev) —
  // isti klizač 0-10 kao InTime_Anketa.html, NIJE obavezno pa se upisuje
  // SAMO ako je klijent stvarno dotaknuo klizač (frontend šalje prazan
  // string za nedotaknuta pitanja, vidi InTime_PotvrdaPonude.html) — ostaje
  // prazna ćelija umjesto lažne "5" (sredina skale).
  var upisiOcjenu_ = function(kljuc, vrijednost) {
    var col = header.indexOf(ADMIN_ONLY_FIELDS[kljuc]);
    if (col === -1) { return; }
    var n = parseInt(vrijednost, 10);
    if (!isNaN(n) && n >= 0 && n <= 10) { sheet.getRange(rowIndex, col + 1).setValue(n); }
  };
  upisiOcjenu_('potvrda_ocjena_znanje', ocjenaZnanje);
  upisiOcjenu_('potvrda_ocjena_prezentacija', ocjenaPrezentacija);
  upisiOcjenu_('potvrda_ocjena_ugovaranje', ocjenaUgovaranje);

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
    dokUrl = stvoriDokumentPotvrdePonude_(naziv, stvarniOib, grad, imeOsobe, funkcijaOsobe, ipAdresa, sada, brojPonudePotvrda_, ocjenaZnanje, ocjenaPrezentacija, ocjenaUgovaranje, rowIndex);
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
function stvoriDokumentPotvrdePonude_(naziv, oib, grad, imeOsobe, funkcijaOsobe, ipAdresa, kada, brojPonude, ocjenaZnanje, ocjenaPrezentacija, ocjenaUgovaranje, rowIndex) {
  // Grad UVIJEK velikim slovima u NAZIVU foldera (mora se poklapati s
  // folderName iz adminUploadPonudaDokument/adminPripremiDokumenteZaPonudu,
  // inače nastaju DVA foldera za istog klijenta). Tijelo dokumenta ispod i
  // dalje koristi izvorni 'grad' (čitljiv tekst), samo naziv foldera je
  // velikim slovima.
  var gradZaNaziv = (grad && grad !== '(bez mjesta)') ? grad.toUpperCase() : grad;
  var klijentFolderName = 'PONUDA - ' + naziv + ' - ' + oib + ' - ' + gradZaNaziv;
  var sub = getSustavSubfolders_();
  // ISPRAVAK (23.9.2026., novi parametar rowIndex) — po ID-u umjesto (samo)
  // po imenu, vidi resolveKlijentFolderStabilno_/resolveVerzijaFolderStabilno_
  // gore. Svježi sheet/header čitaju se ovdje jer ova funkcija dosad nije
  // imala pristup redku (pozivala se samo s izvučenim poljima).
  var sheetStab_ = getOrCreateUpitiSheet();
  var ocekivanoZaglavljeStab_ = izracunajOcekivanoZaglavljeUpiti_();
  var lastColStab_ = Math.min(sheetStab_.getLastColumn(), ocekivanoZaglavljeStab_.length);
  var headerStab_ = sheetStab_.getRange(1, 1, 1, lastColStab_).getValues()[0];
  var klijentFolder = (rowIndex ? resolveKlijentFolderStabilno_(sheetStab_, headerStab_, rowIndex, sub.ponude, klijentFolderName) : getOrCreateChildFolder_(sub.ponude, klijentFolderName));
  var ciljniFolder = klijentFolder;
  if (brojPonude) {
    var verzijaFolderName = brojPonude + ' - ' + naziv + ' - ' + oib + ' - ' + gradZaNaziv;
    ciljniFolder = (rowIndex ? resolveVerzijaFolderStabilno_(sheetStab_, headerStab_, rowIndex, klijentFolder, verzijaFolderName) : getOrCreateVerzijaFolder_(klijentFolder, verzijaFolderName));
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

  // Ocjena zadovoljstva voditeljem ključnih kupaca (23.9.2026., Sašin izričit
  // zahtjev: "napravi da kod prihvaćanja ponude potvrda o prihvaćanju ponude
  // sadrži i ocjenu kama koju smo napravili") — isti klizač 0-10 kao
  // InTime_Anketa.html, ispisuje se SAMO ako je klijent stvarno dotaknuo
  // klizač (prazan string za nedotaknuta pitanja, vidi potvrdiPonudu() i
  // InTime_PotvrdaPonude.html) — ispisuje "(nije ocijenjeno)" umjesto lažne
  // ocjene.
  var formatirajOcjenu_ = function(vrijednost) {
    var n = parseInt(vrijednost, 10);
    return (!isNaN(n) && n >= 0 && n <= 10) ? (n + ' / 10') : '(nije ocijenjeno)';
  };
  body.appendParagraph('Ocjena zadovoljstva voditeljem ključnih kupaca').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('Znanje voditelja ključnih kupaca: ' + formatirajOcjenu_(ocjenaZnanje));
  body.appendParagraph('Prezentacija tvrtke: ' + formatirajOcjenu_(ocjenaPrezentacija));
  body.appendParagraph('Način ugovaranja (pregovora): ' + formatirajOcjenu_(ocjenaUgovaranje));

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
function stvoriDokumentOdbijanjaPonude_(naziv, oib, grad, imeOsobe, razlog, ipAdresa, kada, brojPonude, rowIndex) {
  var gradZaNaziv = (grad && grad !== '(bez mjesta)') ? grad.toUpperCase() : grad;
  var klijentFolderName = 'PONUDA - ' + naziv + ' - ' + oib + ' - ' + gradZaNaziv;
  var sub = getSustavSubfolders_();
  // ISPRAVAK (23.9.2026., novi parametar rowIndex) — isto kao
  // stvoriDokumentPotvrdePonude_ iznad, po ID-u umjesto (samo) po imenu.
  var sheetStab_ = getOrCreateUpitiSheet();
  var ocekivanoZaglavljeStab_ = izracunajOcekivanoZaglavljeUpiti_();
  var lastColStab_ = Math.min(sheetStab_.getLastColumn(), ocekivanoZaglavljeStab_.length);
  var headerStab_ = sheetStab_.getRange(1, 1, 1, lastColStab_).getValues()[0];
  var klijentFolder = (rowIndex ? resolveKlijentFolderStabilno_(sheetStab_, headerStab_, rowIndex, sub.ponude, klijentFolderName) : getOrCreateChildFolder_(sub.ponude, klijentFolderName));
  var ciljniFolder = klijentFolder;
  if (brojPonude) {
    var verzijaFolderName = brojPonude + ' - ' + naziv + ' - ' + oib + ' - ' + gradZaNaziv;
    ciljniFolder = (rowIndex ? resolveVerzijaFolderStabilno_(sheetStab_, headerStab_, rowIndex, klijentFolder, verzijaFolderName) : getOrCreateVerzijaFolder_(klijentFolder, verzijaFolderName));
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
  posaljiMail_(NOTIFY_EMAIL, 'Ponuda potvrđena — ' + naziv, tijelo);
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
function odbijPonudu(token, unesenOib, imeOsobe, funkcijaOsobe, ipAdresa, razlog) {
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
  // NOVO (26.9.2026.) — izdvojeno iz kombinirane provjere niže, s posebnom
  // (jasnijom) porukom i testnaPonuda zastavicom, isti razlog kao uz
  // potvrdaPonudeInfo()/potvrdiPonudu() gore: dok ponuda još nije stvarno
  // poslana klijentu, odbijanje preko ove poveznice je zabranjeno.
  if (stanje === 'nije_poslano') {
    return { status: 'error', testnaPonuda: true, message: 'Ovo je testni pregled ponude — ponuda još nije stvarno poslana klijentu, pa se ne može odbiti ovom poveznicom.' };
  }
  if (stanje === 'ponistena' || stanje === 'ponistena_nakon_prihvata') {
    return { status: 'error', message: 'Ova poveznica trenutno nije aktivna. Kontaktirajte nas na sbatinac.intime@gmail.com.' };
  }
  // ISPRAVAK (23.9.2026., Sašin izričit zahtjev): jedinstveni obrazac za
  // prihvaćanje I odbijanje na InTime_PotvrdaPonude.html sad traži ISTE
  // podatke za obje radnje (OIB, ime i prezime, funkcija) — pa se od sad OIB
  // provjerava i kod odbijanja, IDENTIČNO kao kod potvrdiPonudu() iznad,
  // umjesto dosadašnjeg odbijanja bez ikakve provjere identiteta.
  var stvarniOibProvjera_ = String(row[header.indexOf('OIB')] || '').trim();
  var uneseniOibProvjera_ = String(unesenOib || '').trim();
  if (!stvarniOibProvjera_ || !uneseniOibProvjera_ || uneseniOibProvjera_ !== stvarniOibProvjera_) {
    return { status: 'error', message: 'Uneseni OIB ne odgovara OIB-u tvrtke iz ove ponude. Provjerite unos i pokušajte ponovno.' };
  }
  imeOsobe = String(imeOsobe || '').trim();
  funkcijaOsobe = String(funkcijaOsobe || '').trim();
  if (!imeOsobe || !funkcijaOsobe) {
    return { status: 'error', message: 'Ime i prezime te funkcija su obavezni.' };
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
  ipAdresa = String(ipAdresa || '').trim();
  // Funkcija se (namjerno, BEZ nove kolone u tablici) dodaje u zagradi uz
  // ime, u ISTO postojeće polje — novi jedinstveni obrazac sad prikuplja
  // funkciju i kod odbijanja, a otvaranje posebne kolone samo za to nije
  // opravdano (ista logika kao "Potvrdio/la: Ime (Funkcija)" u mail
  // obavijesti za prihvaćanje, posaljiMailPotvrdePonude_ iznad).
  var imeZaSpremanje_ = funkcijaOsobe ? (imeOsobe + ' (' + funkcijaOsobe + ')') : imeOsobe;
  if (imeOdbioCol !== -1 && imeZaSpremanje_) { sheet.getRange(rowIndex, imeOdbioCol + 1).setValue(imeZaSpremanje_); }
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
    dokOdbijanjaUrl = stvoriDokumentOdbijanjaPonude_(naziv, oib, grad, imeZaSpremanje_, razlog, ipAdresa, sada, brojPonudeOdbijanje_, rowIndex);
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
      (imeZaSpremanje_ ? ('Odbio/la: ' + imeZaSpremanje_ + '\n') : '(Klijent nije naveo ime i prezime.)\n') +
      'IP adresa: ' + (ipAdresa || '(nije dostupna)') + '\n' +
      (razlog ? ('Razlog (naveo klijent): ' + razlog + '\n') : '(Klijent nije naveo razlog.)\n') +
      (dokOdbijanjaUrl ? ('\nDokument odbijanja (Drive): ' + dokOdbijanjaUrl + '\n') : '\n(Dokument odbijanja nije uspio biti stvoren — provjerite ručno u admin sučelju.)\n') +
      '\nZa slanje nove ponude otvorite karticu "Ponude" u adminu i kliknite "Generiraj novu ponudu".';
    posaljiMail_(NOTIFY_EMAIL, 'Ponuda odbijena — ' + naziv, tijelo);
  } catch (err) {
    // Mail obavijest ne smije srušiti samo bilježenje odbijanja.
  }

  // ISPRAVAK (23.9.2026., Sašin izričit zahtjev — "želim da se link ugasi
  // odmah"): link na dokumente se sad gasi ODMAH, sinkrono, u istom pozivu
  // kad klijent odbije ponudu — ranije se gasio tek 30 min kasnije preko
  // zakazanog (one-shot) triggera (vidi izvrsiZakazanoGasenjeLinkova_() i
  // punu staru napomenu o mehanizmu niže — funkcije su ostavljene netaknute
  // za slučaj da neki VEĆ zakazan trigger iz vremena prije ovog ispravka još
  // treba odraditi, ali odavde se NOVI više ne zakazuju). Saša ipak i dalje
  // može link ručno vratiti gumbom "🔓 Vrati link na dokumente" u adminu
  // (adminVratiLinkDokumenataOdbijenePonude() niže) ako se klijent
  // predomisli — to i dalje radi, jer provjerava samo je li ponuda u stanju
  // "odbijena", neovisno o TOME KAD je link ugašen.
  try {
    var aktivniFolderColOdbijanje_ = header.indexOf(ADMIN_ONLY_FIELDS.aktivni_folder_dokumenti_id);
    var aktivniFolderIdOdbijanje_ = (aktivniFolderColOdbijanje_ !== -1) ? String(row[aktivniFolderColOdbijanje_] || '').trim() : '';
    if (aktivniFolderIdOdbijanje_) {
      DriveApp.getFolderById(aktivniFolderIdOdbijanje_).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    }
  } catch (err) {
    // Gašenje linka NIKAD ne smije srušiti samo bilježenje odbijanja.
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

// BRZINA (30.9.2026., Sašin izričit zahtjev nakon prijave da je admin
// "užasno spor" i da predlošci ne stižu učitati — "Učitavanje..." visi u
// izborniku): getOrCreateMailPredlosciSheet() niže poziva NIZ samopopravaka
// (popravi.../dodaj...AkoNedostaje_) — svaki od njih SAM za sebe čita cijeli
// list (sheet.getRange(...).getValues()), pa je svaki poziv ove funkcije
// značio 10 zasebnih čitanja Google Sheeta (svako s vlastitom mrežnom
// latencijom), umjesto jednog. To je postojalo i prije, ali je s dva nova
// popravka ovog kruga (banner slika + kućice) prešlo prag primjetne sporosti.
// Rješenje: svi popravci se izvrše SAMO JEDNOM po ovoj verziji koda — nakon
// prvog uspješnog prolaska zastavica se upiše u Script Properties i svaki
// sljedeći poziv PRESKAČE cijeli niz (trenutan povratak). Ako ikad ubuduće
// dodam novi popravak/dodaj...AkoNedostaje_ u lanac niže, MORAM promijeniti
// ovaj string (npr. dodati datum) da se on stvarno izvrši barem jednom —
// inače će tiho biti preskočen za sve postojeće instalacije.
var MAIL_PREDLOSCI_POPRAVCI_VERZIJA_ = 'v11-4.10.2026-uski-okvir-internih-mailova';

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

<div style="white-space:pre-line;font-size:14px;line-height:1.7;background-color:#f6faf9;border:1px solid #d9ece8;border-radius:8px;padding:14px 16px;margin:0 0 6px;color:#000000;text-align:center;font-weight:bold;">{{USLUGE}}</div>
<p style="font-size:10px;line-height:1.5;color:#8a938f;text-align:center;margin:0 0 18px;">Dodatne usluge koje Vam možemo ponuditi: Domaća distribucija (unutar Hrvatske) · Međunarodna distribucija (Slovenija, BiH, Srbija, Crna Gora, Sj. Makedonija) – uvoz/izvoz · Međunarodna distribucija – FedEx EXPRESS (uvoz/izvoz) · Međunarodna distribucija – FedEx ECONOMY (uvoz/izvoz) · Carinsko posredovanje (uvoz/izvoz) · Skladištenje i fulfillment usluge.</p>

<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">U slučaju pitanja i potrebe za dodatnim informacijama stojimo Vam na raspolaganju.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Bila bi nam velika čast da se odlučite za našu ponudu i započnemo suradnju u 2026. godini.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Vjerujemo da možemo biti stabilan i dugoročan poslovni partner te smo u potpunosti otvoreni za model suradnje koji uključuje koegzistenciju s drugim dobavljačima, uz cilj kontinuiranog podizanja razine usluge i optimizacije troškova.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;"><strong>Ponudu možete prihvatiti brzo i jednostavno, bez čekanja na povratni mail — klikom na gumb ispod, gdje je potrebno unijeti OIB Vaše tvrtke te ime i prezime i funkciju osobe koja potvrđuje, kao dokaz ovlaštenja za prihvaćanje ponude {{BROJ_PONUDE}}:</strong></p>

<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Na temelju Vaše povratne potvrde te nakon verifikacije ponude u sjedištu društva IN TIME d.o.o. u Zagrebu, Vaš poslovni subjekt bit će otvoren u našem sustavu.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Potom ćemo Vam dodijeliti korisničko ime i lozinku za pristup sustavu i unos naloga. U roku od 24 do 48 sati moći ćete započeti s unosom naloga i naručivanjem IN TIME prikupa pošiljaka.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;border-collapse:collapse;">
<tr>
<td align="center" bgcolor="#0f8b7e" style="border-radius:8px;background-color:#0f8b7e;">
<a href="{{LINK_POTVRDE}}" target="_blank" rel="noopener" style="display:block;width:100%;box-sizing:border-box;padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;text-align:center;border-radius:8px;">Potvrdi ponudu</a>
</td>
</tr>
</table>
<p style="font-size:12px;line-height:1.5;color:#777777;word-break:break-all;margin:0 0 14px;">Ako gumb ne radi, kopirajte poveznicu u preglednik: <a href="{{LINK_POTVRDE}}" style="color:#0f8b7e;">{{LINK_POTVRDE}}</a></p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 26px;border-collapse:collapse;">
<tr>
<td align="center" style="border-radius:8px;border:2px solid #0f8b7e;background-color:#ffffff;">
<a href="{{LINK_DOKUMENTI}}" target="_blank" rel="noopener" style="display:block;width:100%;box-sizing:border-box;padding:12px 18px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#0f8b7e;text-decoration:none;text-align:center;">Pogledaj dokumente ponude</a>
</td>
</tr>
</table>
<p style="font-size:12px;line-height:1.5;color:#777777;word-break:break-all;margin:0 0 14px;">Ako gumb ne radi, kopirajte poveznicu u preglednik: <a href="{{LINK_DOKUMENTI}}" style="color:#0f8b7e;">{{LINK_DOKUMENTI}}</a></p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 24px;border-collapse:collapse;">
<tr>
<td align="center">
<img src="https://i.imgur.com/JYxGTas.png" alt="In Time d.o.o. — Ponuda" width="560" style="display:block;border:1px solid #e3e6e5;outline:none;text-decoration:none;width:100%;max-width:560px;height:auto;border-radius:10px;box-shadow:0 6px 18px rgba(15,139,126,0.18);">
</td>
</tr>
</table>

<p style="font-size:13px;line-height:1.4;color:#ffffff;font-weight:bold;background-color:#c0392b;border-radius:6px;padding:10px 14px;margin:0 0 18px;text-align:center;">Rok važenja ponude: do {{ROK_VAZENJA}}.</p>

<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;"><strong>In Time d.o.o. prednosti su:</strong></p>

<ol style="font-size:13.5px;line-height:1.6;margin:0 0 18px;padding-left:20px;color:#2b2b2b;">
<li style="margin-bottom:8px;"><strong>EKSPRESNA ISPORUKA pošiljaka unutar granica RH</strong> po principu <strong>„od vrata do vrata"</strong>, bez posrednika, dodatnih zaustavljanja i paketomata za preuzimanje od strane krajnjeg primatelja.</li>
<li style="margin-bottom:8px;"><strong>Vrlo brzo rješavanje prigovora i naknada štete</strong> u slučaju oštećenja ili gubitka Vaših pošiljaka u transportu.</li>
<li style="margin-bottom:8px;"><strong>Prodajni agent zadužen isključivo za Vas</strong> kao našeg klijenta brzo i učinkovito rješava svu aktualnu problematiku — <strong>ne morate sami kontaktirati različite službe unutar In Time d.o.o.</strong></li>
<li style="margin-bottom:8px;"><strong>Više paketa koje šaljete na jednu adresu tretiramo kao dijelove iste pošiljke</strong> — zbrajaju se samo njihove težine.</li>
<li style="margin-bottom:8px;">Nudimo <strong>kompletnu dropshipping uslugu</strong> — prikup robe s dodatnih adresa, obradu i slanje pošiljaka u Vaše ime te isporuku Vašim kupcima, uz <strong>automatsku obavijest na Vašem online računu</strong> nakon izvršene usluge.</li>
<li style="margin-bottom:8px;">Provodimo <strong>interno tjedno i mjesečno vanjsko ocjenjivanje kvalitete i točnosti usluge</strong>, uz korekciju svih uočenih nedostataka i propusta <strong>u vrlo kratkim rokovima</strong>.</li>
<li style="margin-bottom:8px;">Našim klijentima osiguravamo pristup <strong>ONLINE BOOKING aplikaciji</strong> koja omogućuje:
  <ul style="margin:6px 0 6px;padding-left:20px;">
    <li style="margin-bottom:4px;">jednostavno otvaranje i storniranje naloga</li>
    <li style="margin-bottom:4px;"><strong>praćenje pošiljke u realnom vremenu</strong></li>
    <li style="margin-bottom:4px;"><strong>potpunu kontrolu nad svim pošiljkama na jednom mjestu</strong></li>
    <li style="margin-bottom:4px;">ispis dostavnih naljepnica izravno na Vašem A4 printeru, bez dodatne opreme</li>
  </ul>
  <p style="margin:6px 0 0;font-size:13.5px;line-height:1.6;color:#2b2b2b;">Klijentima <strong>bez naknade osiguravamo A4 naljepnice</strong> za ispis naloga za pošiljke. Potrebno ih je zatražiti prilikom početka suradnje ili tijekom suradnje kada potrošite postojeću zalihu.</p>
</li>
<li style="margin-bottom:8px;"><strong>Prevozimo sve pošiljke — od paketa mase 2 kg do tereta mase 2,5 tone</strong>, uključujući sve volumene koji se mogu utovariti u kombi vozila ili kamione s hidrauličnom rampom. Napomena: za utovar većih odnosno težih tereta potrebno je osigurati raspoloživ viličar ili utovarnu rampu na lokaciji prikupa.</li>
<li style="margin-bottom:8px;"><strong>Ekspresna dostava malih pošiljaka od 0 do 40 kg</strong> — čak 98,7 % paketa u većim gradovima (Zona 1) isporučuje se <strong>unutar 24 sata od preuzimanja</strong>.</li>
<li style="margin-bottom:8px;"><strong>Distribucija velikih i paletnih pošiljaka mase veće od 100 kg</strong> — isporuka u Zoni 1 najčešće se izvršava <strong>u roku od 24 do 48 sati</strong>, a maksimalno unutar tri radna dana.</li>
<li style="margin-bottom:8px;">Radimo <strong>isključivo na temelju ponude</strong>, bez pritiska na ostvarivanje planova i <strong>bez obveznog minimalnog volumena pošiljaka</strong> koje trebate poslati putem našeg logističkog sustava.</li>
<li style="margin-bottom:8px;"><strong>In Time d.o.o. — poslovni subjekt u potpunom hrvatskom vlasništvu.</strong></li>
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

<div style="white-space:pre-line;font-size:14px;line-height:1.7;background-color:#f6faf9;border:1px solid #d9ece8;border-radius:8px;padding:14px 16px;margin:0 0 6px;color:#000000;text-align:center;font-weight:bold;">{{USLUGE}}</div>
<p style="font-size:10px;line-height:1.5;color:#8a938f;text-align:center;margin:0 0 18px;">Dodatne usluge koje Vam možemo ponuditi: Domaća distribucija (unutar Hrvatske) · Međunarodna distribucija (Slovenija, BiH, Srbija, Crna Gora, Sj. Makedonija) – uvoz/izvoz · Međunarodna distribucija – FedEx EXPRESS (uvoz/izvoz) · Međunarodna distribucija – FedEx ECONOMY (uvoz/izvoz) · Carinsko posredovanje (uvoz/izvoz) · Skladištenje i fulfillment usluge.</p>

<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Iznimno nam je stalo do suradnje s Vama. Stoga smo ponovno pažljivo razmotrili sve okolnosti te, želeći u najvećoj mogućoj mjeri uvažiti Vaše potrebe, pripremili korigiranu ponudu za koju vjerujemo da će bolje odgovarati Vašim očekivanjima i otvoriti prostor za uspješnu dugoročnu suradnju.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;"><strong>Ponudu možete prihvatiti brzo i jednostavno, bez čekanja na povratni mail — klikom na gumb ispod, gdje je potrebno unijeti OIB Vaše tvrtke te ime i prezime i funkciju osobe koja potvrđuje, kao dokaz ovlaštenja za prihvaćanje ponude {{BROJ_PONUDE}}:</strong></p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;border-collapse:collapse;">
<tr>
<td align="center" bgcolor="#0f8b7e" style="border-radius:8px;background-color:#0f8b7e;">
<a href="{{LINK_POTVRDE}}" target="_blank" rel="noopener" style="display:block;width:100%;box-sizing:border-box;padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;text-align:center;border-radius:8px;">Potvrdi ponudu</a>
</td>
</tr>
</table>
<p style="font-size:12px;line-height:1.5;color:#777777;word-break:break-all;margin:0 0 14px;">Ako gumb ne radi, kopirajte poveznicu u preglednik: <a href="{{LINK_POTVRDE}}" style="color:#0f8b7e;">{{LINK_POTVRDE}}</a></p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 26px;border-collapse:collapse;">
<tr>
<td align="center" style="border-radius:8px;border:2px solid #0f8b7e;background-color:#ffffff;">
<a href="{{LINK_DOKUMENTI}}" target="_blank" rel="noopener" style="display:block;width:100%;box-sizing:border-box;padding:12px 18px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#0f8b7e;text-decoration:none;text-align:center;">Pogledaj dokumente ponude</a>
</td>
</tr>
</table>
<p style="font-size:12px;line-height:1.5;color:#777777;word-break:break-all;margin:0 0 14px;">Ako gumb ne radi, kopirajte poveznicu u preglednik: <a href="{{LINK_DOKUMENTI}}" style="color:#0f8b7e;">{{LINK_DOKUMENTI}}</a></p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 24px;border-collapse:collapse;">
<tr>
<td align="center">
<img src="https://i.imgur.com/JYxGTas.png" alt="In Time d.o.o. — Ponuda" width="560" style="display:block;border:1px solid #e3e6e5;outline:none;text-decoration:none;width:100%;max-width:560px;height:auto;border-radius:10px;box-shadow:0 6px 18px rgba(15,139,126,0.18);">
</td>
</tr>
</table>

<p style="font-size:13px;line-height:1.4;color:#ffffff;font-weight:bold;background-color:#c0392b;border-radius:6px;padding:10px 14px;margin:0 0 18px;text-align:center;">Rok važenja ponude: do {{ROK_VAZENJA}}.</p>

<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Na temelju Vaše povratne potvrde te nakon verifikacije ponude u sjedištu društva IN TIME d.o.o. u Zagrebu, Vaš poslovni subjekt bit će otvoren u našem sustavu.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Potom ćemo Vam dodijeliti korisničko ime i lozinku za pristup sustavu i unos naloga. U roku od 24 do 48 sati moći ćete započeti s unosom naloga i naručivanjem IN TIME prikupa pošiljaka.</p>
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

// "Mali skriveni template" (Sašin izričit izraz, 22.9.2026., dvanaesti krug) —
// NIJE u izborniku "Predložak za slanje ponude" (za razliku od gornja dva) i
// NE upisuje se u Sheet InTime_MailPredlosci — koristi ga ISKLJUČIVO
// adminPonistiPrihvacenuPonudu(), automatski, kad Saša poništi VEĆ
// PRIHVAĆENU ponudu (Uprava je naknadno ne odobri). Banner slika (imgur link)
// je Sašina vlastita grafika, priložena u chatu i njemu ranije poznata pod
// istim linkom.
var MAIL_PREDLOZAK_HTML_NEGATIVNA_VERIFIKACIJA_ = `<!DOCTYPE html>
<html lang="hr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Obavijest o negativnoj verifikaciji ponude — In Time d.o.o.</title>
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
<img src="https://i.imgur.com/BS64Fmy.png" alt="In Time d.o.o. — Negativna verifikacija ponude" width="620" style="display:block;border:0;outline:none;text-decoration:none;width:100%;max-width:620px;height:auto;border-radius:10px 10px 0 0;">
</td>
</tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
<tr>
<td style="padding:28px 30px;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b;">

<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Poštovani,</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;"><strong>Nažalost, moramo Vas obavijestiti da predloženi model suradnje u ovom trenutku nije pozitivno verificiran od strane Uprave IN TIME d.o.o. u Zagrebu.</strong></p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Ljubazno Vas molimo za još malo strpljenja. Nakon dodatnog razmatranja svih mogućnosti, povratno ćemo Vas kontaktirati s novim prijedlogom suradnje, za koji vjerujemo da će biti prihvatljiv objema stranama.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;"><strong>Zahvaljujemo Vam na razumijevanju i iskazanom interesu za suradnju s IN TIME d.o.o.</strong></p>
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

// "Mali skriveni template" broj dva — Sašin izričit zahtjev (23.9.2026.,
// trideset i šesti krug): novi gumb "Abandon" (odustajanje OD KLIJENTA, ne
// klijentovo odbijanje) u bloku "Ponuda — slanje i status" (InTime_Admin.html).
// Isti obrazac kao MAIL_PREDLOZAK_HTML_NEGATIVNA_VERIFIKACIJA_ iznad (koji je
// Saša izravno naveo kao uzor: "poput template kojeg smo napravili kad mi
// poništimo ponudu") — NIJE u izborniku "Predložak za slanje ponude", NE
// upisuje se u Sheet InTime_MailPredlosci, koristi ga ISKLJUČIVO
// adminOdustaniOdKlijenta() niže, automatski. Tekst je Sašin doslovan,
// dostavljen u chatu — razbijen u odlomke po prirodnim rečeničnim cjelinama,
// ništa dodano ni oduzeto. Banner slika je Sašina vlastita grafika (imgur
// link, poslan u chatu 23.9.2026.).
var MAIL_PREDLOZAK_HTML_ODUSTAJANJE_ = `<!DOCTYPE html>
<html lang="hr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Povratna informacija — In Time d.o.o.</title>
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
<img src="https://i.imgur.com/0F3nKup.png" alt="In Time d.o.o." width="620" style="display:block;border:0;outline:none;text-decoration:none;width:100%;max-width:620px;height:auto;border-radius:10px 10px 0 0;">
</td>
</tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
<tr>
<td style="padding:28px 30px;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b;">

<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Poštovani,</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Zahvaljujemo Vam na iskazanom interesu i vremenu uloženom u razmatranje mogućnosti suradnje s IN TIME d.o.o.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Nakon detaljne analize Vaših zahtjeva i trenutačno raspoloživih mogućnosti, nažalost smo zaključili kako Vam u ovom trenutku ne možemo ponuditi model suradnje koji bi na odgovarajući način ispunio Vaša očekivanja, a istodobno bio dugoročno održiv i poslovno opravdan za obje strane.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Budući da u ovom trenutku nismo uspjeli pronaći kvalitetno i obostrano prihvatljivo „win-win" rješenje, smatramo kako ne bi bilo korektno započinjati suradnju pod uvjetima koji ne bi u potpunosti odgovarali Vašim potrebama.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Ukoliko se u budućnosti promijene okolnosti i otvorimo mogućnost kreiranja ponude za koju procijenimo da bi Vam bila realno prihvatljiva i komercijalno opravdana, svakako ćemo Vas ponovno kontaktirati s novim prijedlogom suradnje.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Do tada Vam i dalje stojimo na raspolaganju za sva pitanja, dodatne informacije ili eventualne buduće potrebe.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Zahvaljujemo Vam na razumijevanju i želimo Vam mnogo poslovnog uspjeha.</p>
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

// "Mali skriveni template" broj tri — Sašin izričit zahtjev (23.9.2026.,
// nastavak): automatska obavijest klijentu kad MI poništimo ponudu dok je
// još aktivna (prije nego klijent stigne odlučiti) — gumb "⊘ Poništi
// ponudu" u InTime_Admin.html. Isti obrazac kao dva predloška iznad — NIJE
// u izborniku "Predložak za slanje ponude", NE upisuje se u Sheet
// InTime_MailPredlosci, koristi ga ISKLJUČIVO adminPonistiPonudu() niže,
// automatski. Tekst je nacrt koji je Saša odobrio u razgovoru (23.9.2026.).
// Banner slika je Sašina vlastita grafika (imgur link, poslan u chatu
// 23.9.2026.) — isti motiv (sat koji se raspada/istječe) kao predložak za
// istek ponude niže, ali OVAJ predložak tekstom objašnjava da smo MI
// povukli ponudu, ne da je istekao rok.
var MAIL_PREDLOZAK_HTML_PONISTENA_PONUDA_ = `<!DOCTYPE html>
<html lang="hr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Ponuda povučena — In Time d.o.o.</title>
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
<img src="https://i.imgur.com/OvlMIdv.png" alt="In Time d.o.o. — Ponuda povučena" width="620" style="display:block;border:0;outline:none;text-decoration:none;width:100%;max-width:620px;height:auto;border-radius:10px 10px 0 0;">
</td>
</tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
<tr>
<td style="padding:28px 30px;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b;">

<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Poštovani,</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Obavještavamo Vas da smo, zbog internih razloga na našoj strani, privremeno povukli ponudu koju smo Vam ranije uputili, prije nego što ste stigli donijeti odluku o njoj — poveznica za prihvaćanje/odbijanje trenutno nije aktivna.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;"><strong>Ovo ne znači da je suradnja isključena</strong> — naprotiv, uskoro ćemo Vam pripremiti novu, ažuriranu ponudu i ponovno Vas kontaktirati.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Zahvaljujemo Vam na razumijevanju i iskazanom interesu za suradnju s IN TIME d.o.o.</p>
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

// "Mali skriveni template" broj četiri — Sašin izričit zahtjev (23.9.2026.,
// nastavak): automatska obavijest klijentu kad ponudi ISTEKNE rok važenja
// bez odgovora. Za razliku od gornja tri predloška, ovaj se NE šalje iz
// jedne konkretne admin akcije (istek nije "klik", nego prolazak vremena) —
// šalje ga provjeriIIzvijestiIsteklePonude_() niže, koju pokreće satni
// triger (vidi postaviTrigerZaProvjeruIsteklihPonuda() na dnu datoteke —
// JEDNOKRATNO ručno pokretanje u editoru, isti obrazac kao
// postaviTrigerZaDnevnoCiscenjeKante). Banner slika je Sašina vlastita
// grafika (imgur link, poslan u chatu 23.9.2026.) — isti motiv kao
// predložak za poništenu ponudu iznad, ali OVAJ tekstom objašnjava da je
// prošao rok, ne da smo mi povukli ponudu.
var MAIL_PREDLOZAK_HTML_ISTEKLA_PONUDA_ = `<!DOCTYPE html>
<html lang="hr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Ponuda istekla — In Time d.o.o.</title>
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
<img src="https://i.imgur.com/it9uLPl.png" alt="In Time d.o.o. — Ponuda istekla" width="620" style="display:block;border:0;outline:none;text-decoration:none;width:100%;max-width:620px;height:auto;border-radius:10px 10px 0 0;">
</td>
</tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
<tr>
<td style="padding:28px 30px;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b;">

<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Poštovani,</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Obavještavamo Vas da je rok važenja naše ponude istekao, a kako do sada nismo zaprimili Vaš odgovor, ponuda je automatski deaktivirana.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;"><strong>Ukoliko i dalje postoji interes za suradnju s IN TIME d.o.o.</strong>, rado ćemo Vam pripremiti novu ponudu s ažuriranim rokom — dovoljno je da nam se javite, ili ćemo Vas mi ponovno kontaktirati u dogledno vrijeme.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Zahvaljujemo Vam na dosadašnjem interesu i stojimo Vam na raspolaganju za sva pitanja.</p>
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

// Zadani predložak za panel "Pošalji zahtjev za Online Booking" (Sašin
// izričit zahtjev, 27.9.2026., odobreno prema mockupu — "integriraj, sviđa
// mi se... napravi i ugradi"). Kategorija 'ob_zahtjev' (odvojena od ponuda-
// predložaka, vidi Kategorija stupac niže) — interni mail (npr. IT
// službi/distribucijskom centru), NE mail klijentu. Naslovi PRIJE tagova su
// podebljani (<strong>, Sašin izričit zahtjev) — zato je predložak HTML
// ('DA'), ne čisti tekst. Potpis preuzet identično iz
// MAIL_PREDLOZAK_HTML_STANDARDNA_ iznad (Sašin izričit zahtjev: "stavi
// cijeli moj potpis, univ. spec. oec., i funkcija").
// {{UVODNI_TEKST}} (dodano 28.9.2026., Sašin izričit zahtjev: "da ne moram
// ja ručno copy-paste... tag koji kad se klikne na tekst koji želim odmah
// se promijeni") — mjesto gdje se uvodni tekst (textarea/chipovi u
// InTime_Admin.html) umeće izravno u predložak, TOČNO na mjesto koje je
// Saša označio u pregledu (bila je statična "Pozdrav," + "Molimo hitno
// otvaranje..." rečenica — zamijenjena tagom). Vidi
// popraviObPredlozakUvodniTag_ niže — samopopravak koji isto premješta
// već postojeći, ranije spremljeni predložak u Sašinom Sheetu (spremljen
// PRIJE ovog taga) na novi obrazac, bez gubitka njegovih eventualnih
// ručnih izmjena ostatka teksta.
// Zajednički "uski okvir" za interne mailove (OB zahtjev, obavijest nadležnim
// poslovnicama, obavijest svim poslovnicama) — 4.10.2026., Sašina prijava:
// "mail koji dobivaju poslovnice je razvučen... raspao se". Bez ograničenja
// širine Gmail razvuče sadržaj (i kartu) na cijeli prozor. Isti obrazac kao
// MAIL_PREDLOZAK_KLIJENT_PRISTUP_TEKST_: vanjska centrirajuća tablica + FIKSNA
// unutarnja od 620px. Svaki zadani predložak je omotan ovim prefiksom/sufiksom,
// a već spremljeni predlošci u Sheetu popravljaju se samopopravkom
// popraviUskiOkvirInternihPredlozaka_ niže.
var MAIL_UZAK_PREFIKS_ = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td align="center">' +
  '<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="width:620px;max-width:620px;border-collapse:collapse;"><tr><td style="text-align:left;">';
var MAIL_UZAK_SUFIKS_ = '</td></tr></table></td></tr></table>';

var MAIL_PREDLOZAK_OB_NAZIV_ = 'Zadani zahtjev za Online Booking';
var MAIL_PREDLOZAK_OB_PREDMET_ = 'OTVARANJE ONLINE BOOKINGA - {{TM_BROJ}} - {{IME_FIRME}} - {{GRAD}}';
var MAIL_PREDLOZAK_OB_TEKST_ =
  MAIL_UZAK_PREFIKS_ +
  '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222222;">' +
  '{{UVODNI_TEKST}}' +
  '<p style="margin:0 0 4px;"><strong>TM broj:</strong> {{TM_BROJ}}</p>' +
  '<p style="margin:0 0 4px;"><strong>Naziv tvrtke:</strong> {{IME_FIRME}}</p>' +
  '<p style="margin:0 0 4px;"><strong>E-mail adresa za Online Booking:</strong> {{OB_EMAIL}}</p>' +
  '<p style="margin:0 0 4px;"><strong>Osoba zadužena za pošiljke:</strong> {{OSOBA_POSILJKE_IME}}</p>' +
  '<p style="margin:0 0 4px;"><strong>Telefon osobe zadužene za pošiljke:</strong> {{OSOBA_POSILJKE_TELEFON}}</p>' +
  '<p style="margin:0 0 4px;"><strong>Adresa prikupa pošiljaka:</strong> {{ADRESA_PRIKUPA}}</p>' +
  '<p style="margin:0 0 16px;"><strong>Zadnji rok za unos naloga:</strong> {{ZADNJI_ROK_UNOSA}}</p>' +
  '<p style="margin:0 0 4px;">Hvala unaprijed na brzoj obradi.</p>' +
  '<p style="margin:0 0 4px;">Srdačan pozdrav,</p>' +
  '<div style="border-top:1px solid #e3e6e5;margin-top:18px;padding-top:14px;font-size:12.5px;line-height:1.6;color:#444444;">' +
  '<strong style="color:#1f3d3a;">Saša Batinac, univ. spec. oec.</strong><br>' +
  'Sales and Marketing Manager, Voditelj ključnih kupaca<br>' +
  'In Time d.o.o. — Licensee of FedEx<br><br>' +
  'M: +385 91 6262 171 · <a href="mailto:sasa.batinac@in-time.hr" style="color:#0f8b7e;text-decoration:none;">sasa.batinac@in-time.hr</a>' +
  '</div>' +
  '</div>' +
  MAIL_UZAK_SUFIKS_;

// Doda zadani OB predložak u Sheet SAMO ako redak s istim nazivom (stupac
// "Naziv") još ne postoji — isti idempotentni obrazac kao
// dodajHtmlPredloskeAkoNedostaju_ ispod, poziva se svaki put iz
// getOrCreateMailPredlosciSheet(), sigurno pri ponovnom pozivu.
function dodajObPredlozakAkoNedostaje_(sheet) {
  var lastRow = sheet.getLastRow();
  var postojeciNazivi = {};
  if (lastRow >= 2) {
    var nazivi = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < nazivi.length; i++) {
      postojeciNazivi[String(nazivi[i][0] || '').trim()] = true;
    }
  }
  if (!postojeciNazivi[MAIL_PREDLOZAK_OB_NAZIV_]) {
    sheet.appendRow([MAIL_PREDLOZAK_OB_NAZIV_, MAIL_PREDLOZAK_OB_PREDMET_, MAIL_PREDLOZAK_OB_TEKST_, 'DA', new Date(), 'DA', 'ob_zahtjev']);
  }
}

// Samopopravak (28.9.2026., Sašin izričit zahtjev — uvođenje {{UVODNI_TEKST}}
// taga): OB predložak koji je Saša VEĆ spremio prije nego što je tag uveden
// (statična "Pozdrav," + "Molimo hitno otvaranje Online Booking..."
// rečenica) automatski se premješta na novi obrazac — ta ista rečenica
// zamjenjuje se tagom {{UVODNI_TEKST}}, na TOČNO mjestu gdje je i bila
// (Saša ju je izričito označio u pregledu). Regex tolerira sitne razlike u
// stilu/atributima (npr. ako je Saša ručno mijenjao boju/marginu preko
// "✎ Uredi") — traži samo "Pozdrav," paragraf odmah praćen paragrafom koji
// počinje s "Molimo hitno otvaranje Online Booking". Idempotentno — ako tag
// već postoji ili rečenica nije prepoznata (npr. Saša ju je posve
// preformulirao), ništa se ne dira. Djeluje SAMO na retke kategorije
// 'ob_zahtjev' — ponuda-predlošci nisu pogođeni.
function popraviObPredlozakUvodniTag_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }
  var podaci = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var regex = /<p[^>]*>Pozdrav,<\/p>\s*<p[^>]*>Molimo hitno otvaranje Online Booking[^<]*<\/p>/;
  for (var i = 0; i < podaci.length; i++) {
    var kategorija = podaci[i][6] || 'ponuda';
    if (kategorija !== 'ob_zahtjev') { continue; }
    var sadrzaj = String(podaci[i][2] || '');
    if (!sadrzaj || sadrzaj.indexOf('{{UVODNI_TEKST}}') !== -1) { continue; }
    if (regex.test(sadrzaj)) {
      sheet.getRange(i + 2, 3).setValue(sadrzaj.replace(regex, '{{UVODNI_TEKST}}'));
    }
  }
}

// Zadani predložak za panel "Pošalji obavijest poslovnicama" (Sašin izričit
// zahtjev, 28.9.2026.: "nakon što pošaljemo mail za online booking trebamo
// kad dobijemo username i password za online booking poslati mail
// odgovornim poslovnicama za otvoreni poslovni subjekat... identično sve
// kao za slanje zahtjeva za online booking, samo će mail biti upućen
// poslovnicama koje smo označili kao nadležne poslovnice"). Kategorija
// 'poslovnica_obavijest' (odvojena i od ponuda- i od ob_zahtjev-predložaka,
// vidi Kategorija stupac niže). Naslov predmeta ({{TM_BROJ}}/{{IME_FIRME}}/
// {{GRAD}}) i format potpisa preuzeti 1:1 iz MAIL_PREDLOZAK_OB_PREDMET_/
// _TEKST_ iznad (isti obrazac) — Saša izričito nije zadao točan predmet za
// ovaj mail, pa je izabran isti obrazac kao za OB zahtjev; lako se mijenja
// kroz "✎ Uredi" u panelu, ne treba redeploy.
var MAIL_PREDLOZAK_POSLOVNICE_NAZIV_ = 'Zadana obavijest poslovnicama (otvoren poslovni subjekt)';
var MAIL_PREDLOZAK_POSLOVNICE_PREDMET_ = 'OTVOREN POSLOVNI SUBJEKT - {{TM_BROJ}} - {{IME_FIRME}} - {{GRAD}}';
var MAIL_PREDLOZAK_POSLOVNICE_TEKST_ =
  MAIL_UZAK_PREFIKS_ +
  '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222222;">' +
  '{{UVODNI_TEKST}}' +
  '<p style="margin:0 0 4px;"><strong>TM broj:</strong> {{TM_BROJ}}</p>' +
  '<p style="margin:0 0 4px;"><strong>Naziv tvrtke:</strong> {{IME_FIRME}}</p>' +
  '<p style="margin:0 0 4px;"><strong>Grad:</strong> {{GRAD}}</p>' +
  '<p style="margin:0 0 4px;"><strong>E-mail adresa za Online Booking:</strong> {{OB_EMAIL}}</p>' +
  '<p style="margin:0 0 4px;"><strong>Lozinka za Online Booking:</strong> {{OB_LOZINKA}}</p>' +
  '<p style="margin:0 0 4px;"><strong>Osoba zadužena za pošiljke:</strong> {{OSOBA_POSILJKE_IME}}</p>' +
  '<p style="margin:0 0 4px;"><strong>Telefon osobe zadužene za pošiljke:</strong> {{OSOBA_POSILJKE_TELEFON}}</p>' +
  '<p style="margin:0 0 4px;"><strong>Adresa prikupa pošiljaka:</strong> {{ADRESA_PRIKUPA}}</p>' +
  // NOVO (30.9.2026., Sašin izričit zahtjev — "sliku lokacije prikupa koju
  // smo ugradili na stranicu poslati i poslovnicama... u prvom mailu [koji
  // ide prema njima]... ispod adrese prikupa pošiljke"): {{SLIKA_PRIKUPA}}
  // tag ispod se, u renderMailTekst_ u InTime_Admin.html, zamjenjuje GOTOVIM
  // HTML blokom (isti obrazac kao {{USLUGE}} — cijeli HTML fragment, ne samo
  // tekst) — ili stvarnom kartom (ako je admin već generirao kartu prikupa
  // na kartici klijenta, "🗺️ Prikaži kartu prikupa"/"🔄 Osvježi kartu",
  // koristi se TOČNO ta ista, cache-irana slika — ne geokodira se iznova
  // ovdje) ili kratkom napomenom da karta još nije generirana.
  '{{SLIKA_PRIKUPA}}' +
  '<p style="margin:0 0 16px;"><strong>Nadležna poslovnica:</strong> {{NADLEZNE_POSLOVNICE}}</p>' +
  '<p style="margin:0 0 4px;">Hvala unaprijed na brzoj obradi.</p>' +
  '<p style="margin:0 0 4px;">Srdačan pozdrav,</p>' +
  '<div style="border-top:1px solid #e3e6e5;margin-top:18px;padding-top:14px;font-size:12.5px;line-height:1.6;color:#444444;">' +
  '<strong style="color:#1f3d3a;">Saša Batinac, univ. spec. oec.</strong><br>' +
  'Sales and Marketing Manager, Voditelj ključnih kupaca<br>' +
  'In Time d.o.o. — Licensee of FedEx<br><br>' +
  'M: +385 91 6262 171 · <a href="mailto:sasa.batinac@in-time.hr" style="color:#0f8b7e;text-decoration:none;">sasa.batinac@in-time.hr</a>' +
  '</div>' +
  '</div>' +
  MAIL_UZAK_SUFIKS_;

// Doda zadani "poslovnice obavijest" predložak u Sheet SAMO ako redak s
// istim nazivom (stupac "Naziv") još ne postoji — isti idempotentni obrazac
// kao dodajObPredlozakAkoNedostaje_ iznad, poziva se svaki put iz
// getOrCreateMailPredlosciSheet(), sigurno pri ponovnom pozivu.
function dodajPoslovniceObavijestPredlozakAkoNedostaje_(sheet) {
  var lastRow = sheet.getLastRow();
  var postojeciNazivi = {};
  if (lastRow >= 2) {
    var nazivi = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < nazivi.length; i++) {
      postojeciNazivi[String(nazivi[i][0] || '').trim()] = true;
    }
  }
  if (!postojeciNazivi[MAIL_PREDLOZAK_POSLOVNICE_NAZIV_]) {
    sheet.appendRow([MAIL_PREDLOZAK_POSLOVNICE_NAZIV_, MAIL_PREDLOZAK_POSLOVNICE_PREDMET_, MAIL_PREDLOZAK_POSLOVNICE_TEKST_, 'DA', new Date(), 'DA', 'poslovnica_obavijest']);
  }
}

// Samopopravak (30.9.2026., Sašin izričit zahtjev — {{SLIKA_PRIKUPA}} tag
// dodan NAKNADNO u MAIL_PREDLOZAK_POSLOVNICE_TEKST_ iznad): ako je zadani
// "poslovnice obavijest" predložak VEĆ spremljen u Sheetu (npr. prijašnji
// redeploy prije ovog ispravka) i JOŠ NEMA {{SLIKA_PRIKUPA}} tag, umeće se
// odmah ISPOD "Adresa prikupa pošiljaka" pasusa, PRIJE "Nadležna
// poslovnica" — točno isto mjesto kao u zadanom predlošku gore.
// Idempotentno — ako tag već postoji, ništa se ne dira. Djeluje SAMO na
// redak s TOČNIM zadanim nazivom, kategorije 'poslovnica_obavijest'.
function popraviPoslovniceObavijestSlikaPrikupa_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }
  var podaci = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var sidro = '<p style="margin:0 0 4px;"><strong>Adresa prikupa pošiljaka:</strong> {{ADRESA_PRIKUPA}}</p>';
  for (var i = 0; i < podaci.length; i++) {
    var kategorija = podaci[i][6] || 'ponuda';
    if (kategorija !== 'poslovnica_obavijest') { continue; }
    if (String(podaci[i][0] || '').trim() !== MAIL_PREDLOZAK_POSLOVNICE_NAZIV_) { continue; }
    var sadrzaj = String(podaci[i][2] || '');
    if (!sadrzaj || sadrzaj.indexOf('{{SLIKA_PRIKUPA}}') !== -1 || sadrzaj.indexOf(sidro) === -1) { continue; }
    sheet.getRange(i + 2, 3).setValue(sadrzaj.replace(sidro, sidro + '{{SLIKA_PRIKUPA}}'));
  }
}

// ---- "POŠALJI OBAVIJEST SVIM POSLOVNICAMA" — NOVI panel u InTime_Admin.html
// (Sašin izričit zahtjev, 2.10.2026.: "treba ugradnju još jednog slanja
// maila kao ove što smo napravili... narančasta boja... pošalji obavijest
// svim poslovnicama o otvorenom poslovnom subjektu... mail primatelji su
// SVE poslovnice... mail treba biti sadržaja kao i prethodni mail ukratko o
// novom klijentu... i da ih molim da pripaze na pošiljke u startu od novog
// klijenta jer imamo velika očekivanja od istoga... da je puno truda
// uloženo u njegov prelazak u naš logistički sustav te ako ima bilo kakav
// problem vezan za tog klijenta da me kontaktiraju"). Gotovo 1:1 kopija
// MAIL_PREDLOZAK_POSLOVNICE_TEKST_ iznad (isti osnovni podaci o klijentu,
// {{SLIKA_PRIKUPA}}, {{NADLEZNE_POSLOVNICE}} — "ukratko o novom klijentu").
// Kategorija 'sve_poslovnice_obavijest' (zasebna od 'poslovnica_obavijest'
// — zelenog panela, koji i dalje ide SAMO nadležnim poslovnicama).
// Narančasta brend boja (#e67e22) u InTime_Admin.html, ODMAH ISPOD zelenog
// panela. Primatelji NISU filtrirani po "Nadležna poslovnica" — frontend
// predlaže SVE centre+vanjske izvršitelje iz "Logistički centri i servisi"
// koji imaju upisan mail (vidi svepIzracunajZadanePrimatelje_ u
// InTime_Admin.html). Zaključavanje: otključava se kad JE zeleni panel
// poslan (ADMIN_ONLY_FIELDS.datum_slanja_poslovnice_obavijest).
// IZMIJENJENO (2.10.2026., isti dan, Sašin izričit zahtjev — "u obavijest
// svim poslovnicama stavi ove tekstove kao uvodni tekst umjesto onih koji si
// stavio... ono u narančastom ne treba dolje"): prvotni hardkodirani pasus
// "Molimo sve poslovnice..." UKLONJEN odavde — tu poruku sad nosi
// {{UVODNI_TEKST}} (10 novih, Sašinih vlastitih prijedloga — vidi
// SVEP_UVODNI_TEKST_DEFAULT_ niže, VLASTITO spremište, odvojeno od OB/
// zeleni panel spremišta). Dodan i {{OSOBA_POSILJKE_EMAIL}} tag ("obavezno
// stavi kontakt mail... onog tko organizira transport").
var MAIL_PREDLOZAK_SVE_POSLOVNICE_NAZIV_ = 'Zadana obavijest SVIM poslovnicama (otvoren poslovni subjekt)';
var MAIL_PREDLOZAK_SVE_POSLOVNICE_PREDMET_ = 'NOVI KLIJENT U SUSTAVU - {{TM_BROJ}} - {{IME_FIRME}} - {{GRAD}} (obavijest svim poslovnicama)';
var MAIL_PREDLOZAK_SVE_POSLOVNICE_TEKST_ =
  MAIL_UZAK_PREFIKS_ +
  '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222222;">' +
  '{{UVODNI_TEKST}}' +
  '<p style="margin:0 0 4px;"><strong>TM broj:</strong> {{TM_BROJ}}</p>' +
  '<p style="margin:0 0 4px;"><strong>Naziv tvrtke:</strong> {{IME_FIRME}}</p>' +
  '<p style="margin:0 0 4px;"><strong>Grad:</strong> {{GRAD}}</p>' +
  '<p style="margin:0 0 4px;"><strong>Osoba zadužena za pošiljke:</strong> {{OSOBA_POSILJKE_IME}}</p>' +
  '<p style="margin:0 0 4px;"><strong>Telefon osobe zadužene za pošiljke:</strong> {{OSOBA_POSILJKE_TELEFON}}</p>' +
  '<p style="margin:0 0 4px;"><strong>Kontakt e-mail osobe zadužene za pošiljke:</strong> {{OSOBA_POSILJKE_EMAIL}}</p>' +
  '<p style="margin:0 0 4px;"><strong>Adresa prikupa pošiljaka:</strong> {{ADRESA_PRIKUPA}}</p>' +
  '{{SLIKA_PRIKUPA}}' +
  '<p style="margin:0 0 16px;"><strong>Nadležna poslovnica:</strong> {{NADLEZNE_POSLOVNICE}}</p>' +
  '<p style="margin:16px 0 4px;">Hvala unaprijed na suradnji.</p>' +
  '<p style="margin:0 0 4px;">Srdačan pozdrav,</p>' +
  '<div style="border-top:1px solid #e3e6e5;margin-top:18px;padding-top:14px;font-size:12.5px;line-height:1.6;color:#444444;">' +
  '<strong style="color:#1f3d3a;">Saša Batinac, univ. spec. oec.</strong><br>' +
  'Sales and Marketing Manager, Voditelj ključnih kupaca<br>' +
  'In Time d.o.o. — Licensee of FedEx<br><br>' +
  'M: +385 91 6262 171 · <a href="mailto:sasa.batinac@in-time.hr" style="color:#0f8b7e;text-decoration:none;">sasa.batinac@in-time.hr</a>' +
  '</div>' +
  '</div>' +
  MAIL_UZAK_SUFIKS_;

// Doda zadani "sve poslovnice obavijest" predložak u Sheet SAMO ako redak s
// istim nazivom još ne postoji — isti idempotentni obrazac kao
// dodajPoslovniceObavijestPredlozakAkoNedostaje_ iznad.
function dodajSvePoslovniceObavijestPredlozakAkoNedostaje_(sheet) {
  var lastRow = sheet.getLastRow();
  var postojeciNazivi = {};
  if (lastRow >= 2) {
    var nazivi = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < nazivi.length; i++) {
      postojeciNazivi[String(nazivi[i][0] || '').trim()] = true;
    }
  }
  if (!postojeciNazivi[MAIL_PREDLOZAK_SVE_POSLOVNICE_NAZIV_]) {
    sheet.appendRow([MAIL_PREDLOZAK_SVE_POSLOVNICE_NAZIV_, MAIL_PREDLOZAK_SVE_POSLOVNICE_PREDMET_, MAIL_PREDLOZAK_SVE_POSLOVNICE_TEKST_, 'DA', new Date(), 'DA', 'sve_poslovnice_obavijest']);
  }
}

// Samopopravak (2.10.2026., isti dan — vidi opširnu napomenu uz
// MAIL_PREDLOZAK_SVE_POSLOVNICE_TEKST_ iznad): ako je zadani "sve poslovnice
// obavijest" predložak VEĆ spremljen u Sheetu (npr. redeploy prije ovog
// ispravka), (1) uklanja stari hardkodirani narančasti pasus ("Molimo sve
// poslovnice...") jer tu poruku sad nosi {{UVODNI_TEKST}}, i (2) umeće
// {{OSOBA_POSILJKE_EMAIL}} tag odmah ispod telefona, ako ga još nema.
// Idempotentno, djeluje SAMO na redak s TOČNIM zadanim nazivom, kategorije
// 'sve_poslovnice_obavijest' — isti obrazac kao popraviPoslovniceObavijestSlikaPrikupa_.
function popraviSvePoslovniceObavijestTekst_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }
  var podaci = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var stariPasusRegex = /<p style="margin:0 0 4px;background:#fdf1e6;[^"]*">[\s\S]*?<\/p>/;
  var sidroTelefon = '<p style="margin:0 0 4px;"><strong>Telefon osobe zadužene za pošiljke:</strong> {{OSOBA_POSILJKE_TELEFON}}</p>';
  for (var i = 0; i < podaci.length; i++) {
    var kategorija = podaci[i][6] || 'ponuda';
    if (kategorija !== 'sve_poslovnice_obavijest') { continue; }
    if (String(podaci[i][0] || '').trim() !== MAIL_PREDLOZAK_SVE_POSLOVNICE_NAZIV_) { continue; }
    var sadrzaj = String(podaci[i][2] || '');
    if (!sadrzaj) { continue; }
    var promijenjeno = false;
    if (stariPasusRegex.test(sadrzaj)) {
      sadrzaj = sadrzaj.replace(stariPasusRegex, '');
      promijenjeno = true;
    }
    if (sadrzaj.indexOf('{{OSOBA_POSILJKE_EMAIL}}') === -1 && sadrzaj.indexOf(sidroTelefon) !== -1) {
      sadrzaj = sadrzaj.replace(sidroTelefon, sidroTelefon + '<p style="margin:0 0 4px;"><strong>Kontakt e-mail osobe zadužene za pošiljke:</strong> {{OSOBA_POSILJKE_EMAIL}}</p>');
      promijenjeno = true;
    }
    if (promijenjeno) { sheet.getRange(i + 2, 3).setValue(sadrzaj); }
  }
}

// Poveznica za prijavu u Online Booking (In Time Express) — ISTA adresa koju
// već koristi kartica "Online Booking" na naslovnici (InTime_PismoNamjere.html,
// gumb "↗ Otvori u novom prozoru" + ugrađeni iframe) — MORAJU ostati
// identične. Koristi je panel "Pošalji pristupne podatke klijentu" niže, i
// kao gumb i kao obični link za copy-paste.
var OB_LOGIN_URL_ = 'https://intimeolb.azurewebsites.net/login';

// Zadani predložak za panel "Pošalji pristupne podatke klijentu" (Sašin
// izričit zahtjev, 28.9.2026., treći/crveni panel u lancu — "između plavoga
// i zelenoga treba biti jedan svijetlo crvene boje... koji će služiti za
// slanje maila klijentima u kojima ćemo im slati ključne podatke znači
// username i password za online booking, zahvaliti im još jednom za odluku
// o suradnji"). Kategorija 'klijent_pristup' — OVO JE mail KLIJENTU (za
// razliku od plavog/zelenog panela, koji su interni mailovi). Isti
// {{UVODNI_TEKST}} tag-mehanizam kao ostala dva panela, ali s VLASTITIM,
// odvojenim popisom uvodnih tekstova (vidi ucitajKlijentPristupUvodneTekstove_
// niže — ton je ovdje "hvala na povjerenju/suradnji", posve drugačiji od
// interne hitnoće OB/poslovnice panela, pa dijeljenje istog popisa ne bi
// imalo smisla). Gumb + obični link vode na OB_LOGIN_URL_ gore, isti
// vizualni obrazac gumba kao {{LINK_POTVRDE}} u ponuda-predlošku (teal
// #0f8b7e, s fallback poveznicom ispod za slučaj da gumb ne radi u
// klijentovom mail-čitaču). Napomena o Edge/Chrome preglednicima i
// pripadajuće ikonice — Sašin izričit zahtjev, ikonice s Wikimedia Commons
// (javno, stabilno hostano, nije Sašina vlastita imovina — ako želi vlastite
// ikonice, lako se zamijene kroz "✎ Uredi").
// ZAMIJENJENO (30.9.2026., Sašin izričit zahtjev — poslao je dva imgur
// linka "ove slike stavi na template"): Wikimedia ikonice zamijenjene
// Sašinim vlastitim linkovima. Vidi i popraviKlijentPristupIkoniceBrowsera_
// niže (self-heal za već spremljene predloške).
var BROWSER_IKONA_EDGE_URL_ = 'https://i.imgur.com/cCDfF2x.png';
var BROWSER_IKONA_CHROME_URL_ = 'https://i.imgur.com/vVwlRSv.png';
var MAIL_PREDLOZAK_KLIJENT_PRISTUP_NAZIV_ = 'Zadani mail — pristupni podaci za Online Booking';
var MAIL_PREDLOZAK_KLIJENT_PRISTUP_PREDMET_ = 'Vaši pristupni podaci za Online Booking – {{IME_FIRME}}';

// Standalone javna stranica kalkulatora (InTime_KalkulatorCijena.html na
// GitHub Pagesu) — Sašin izričit zahtjev, 30.9.2026.: "možemo li nekako
// kalkulator napraviti na posebnoj stranici... ispred nje unos username i
// password da ne moraju ići na moju početnu". Stranica VEĆ ima svoju
// vlastitu prijavu (kućica username/lozinka na samoj stranici) i VEĆ čita
// ?kalk_u=/?kalk_p= iz URL-a za automatsku prijavu (vidi
// ucitajPrijavuIzUrlaAkoPostoji_() u InTime_KalkulatorCijena.html, dodano
// isti dan za prijavu s početne stranice) — isti mehanizam se ovdje
// ponovno koristi za DIREKTNU poveznicu u mailu klijentu, bez prolaska
// kroz početnu stranicu (InTime_PismoNamjere.html). Ako klijent ipak želi
// ići preko početne, i dalje može — ovo je dodatna, izravna poveznica.
var KALKULATOR_STRANICA_URL_ = 'https://sbatinac.github.io/intime-portal/InTime_KalkulatorCijena.html';

// Blok "pristupni podaci za kalkulator cijene" (Sašin izričit zahtjev,
// 30.9.2026.: "u mail koji upućujemo klijentu s njegovim username/password
// za online booking, dodijelimo i username i password za kalkulator...opiši
// kalkulator...to stavi ispod boxa za korištenje online bookinga, neka piše
// isto u stilu boxa za online booking"). ISTI vizualni obrazac kao OB
// kućice/gumb iznad (crvena kućica za korisničko ime, plava za lozinku,
// teal gumb, siva fallback poveznica) — samo s vlastitim tagovima
// ({{KALK_USERNAME}}/{{KALK_LOZINKA}}/{{LINK_KALKULATOR}}, vidi
// renderMailTekst_ u InTime_Admin.html) da se sadržajno razlikuje od OB
// bloka. Definirano kao ZASEBNA varijabla (ne izravno upisano u
// MAIL_PREDLOZAK_KLIJENT_PRISTUP_TEKST_ niže) da JEDAN isti string koristi
// i zadani predložak ISPOD i samopopravak
// popraviKlijentPristupKalkulatorBlok_() niže u datoteci — sprječava da se
// dva mjesta razmimoiđu.
var KLIJENT_PRISTUP_KALKULATOR_BLOK_ =
  '<p style="font-size:13px;line-height:1.6;color:#555555;margin:20px 0 8px;">Uz Online Booking pripremili smo Vam pristup i <strong>online kalkulatoru cijene dostave</strong> — jednostavnom alatu u kojem odmah vidite Vašu ugovorenu cijenu prijevoza za odabrano odredište i način dostave, bez čekanja na upit ili ponudu. Prijavite se sljedećim podacima:</p>' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px;border-collapse:collapse;">' +
  '<tr><td align="center" style="background-color:#fdeceb;border:2px solid #e57368;border-radius:8px;padding:12px 14px;">' +
  '<div style="font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#a93226;margin-bottom:4px;">Kalkulator cijene — korisničko ime</div>' +
  '<div style="font-size:16px;font-weight:800;color:#7b241c;">{{KALK_USERNAME}}</div>' +
  '</td></tr>' +
  '</table>' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border-collapse:collapse;">' +
  '<tr><td align="center" style="background-color:#eaf1fb;border:2px solid #5b8fd6;border-radius:8px;padding:12px 14px;">' +
  '<div style="font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#2354a0;margin-bottom:4px;">Kalkulator cijene — lozinka</div>' +
  '<div style="font-size:16px;font-weight:800;color:#1a3d73;">{{KALK_LOZINKA}}</div>' +
  '</td></tr>' +
  '</table>' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 14px;border-collapse:collapse;">' +
  '<tr><td align="center" bgcolor="#0f8b7e" style="border-radius:8px;background-color:#0f8b7e;">' +
  '<a href="{{LINK_KALKULATOR}}" target="_blank" rel="noopener" style="display:block;width:100%;box-sizing:border-box;padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;text-align:center;border-radius:8px;">Otvori kalkulator cijene</a>' +
  '</td></tr></table>' +
  '<p style="font-size:12px;line-height:1.5;color:#777777;word-break:break-all;margin:0 0 20px;">Ako gumb ne radi, kopirajte poveznicu u preglednik: <a href="{{LINK_KALKULATOR}}" style="color:#0f8b7e;">{{LINK_KALKULATOR}}</a></p>';

var MAIL_PREDLOZAK_KLIJENT_PRISTUP_TEKST_ =
  // Vanjska centrirajuća tablica (30.9.2026., ispravak — Saša: "mail se
  // razlio... ne smije se toliko rasiriti"): dosad je unutarnji <div> imao
  // font-family ali NIKAKVO ograničenje širine, pa su sve width:100%
  // tablice unutra (kućice, zeleni/sivi gumb) rasle na CIJELU širinu
  // email-klijenta (Gmail je znao prikazati sadržaj razvučen preko cijelog
  // prozora, umjesto uskog stupca poravnatog s banner slikom od 620px).
  // Standardna email-HTML tehnika: vanjska width="100%" tablica s
  // align="center" ćelijom, unutar nje FIKSNA tablica širine 620 (i
  // max-width:620px za klijente koji poštuju CSS) koja sadrži sve ostalo —
  // tako je SVE (tekst, kućice, oba gumba) dosljedno poravnato i uredno
  // uskog stupca, isto kao banner slika.
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td align="center">' +
  '<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="width:620px;max-width:620px;border-collapse:collapse;"><tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222222;text-align:left;">' +
  // Banner slika (imgur link, poslan u chatu 28.9.2026., Sašin izričit
  // zahtjev "evo ugradi") — isti vizualni obrazac kao ostali banneri u
  // sustavu (puna širina, zaobljeni rubovi, max-width 620px).
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border-collapse:collapse;">' +
  '<tr><td align="center"><img src="https://i.imgur.com/Ue83z8O.png" alt="In Time d.o.o. — Vaši pristupni podaci" width="620" style="display:block;border:0;outline:none;text-decoration:none;width:100%;max-width:620px;height:auto;border-radius:10px;"></td></tr>' +
  '</table>' +
  '{{UVODNI_TEKST}}' +
  // Kućice za korisničko ime/lozinku (Sašin izričit zahtjev, 28.9.2026.,
  // nastavak — "stavi u kućicu...u tablicu da bude uokvireno i
  // centrirano..i obojana polja..username crveno pasword plavo"): svaka u
  // svojoj tablici (širina 100%, centrirani tekst), uokvireno bojanim
  // rubom, s obojanom pozadinom — korisničko ime crveno, lozinka plavo.
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 8px;border-collapse:collapse;">' +
  '<tr><td align="center" style="background-color:#fdeceb;border:2px solid #e57368;border-radius:8px;padding:12px 14px;">' +
  '<div style="font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#a93226;margin-bottom:4px;">Korisničko ime</div>' +
  '<div style="font-size:16px;font-weight:800;color:#7b241c;">{{OB_EMAIL}}</div>' +
  '</td></tr>' +
  '</table>' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border-collapse:collapse;">' +
  '<tr><td align="center" style="background-color:#eaf1fb;border:2px solid #5b8fd6;border-radius:8px;padding:12px 14px;">' +
  '<div style="font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#2354a0;margin-bottom:4px;">Lozinka</div>' +
  '<div style="font-size:16px;font-weight:800;color:#1a3d73;">{{OB_LOZINKA}}</div>' +
  '</td></tr>' +
  '</table>' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 14px;border-collapse:collapse;">' +
  '<tr><td align="center" bgcolor="#0f8b7e" style="border-radius:8px;background-color:#0f8b7e;">' +
  '<a href="' + OB_LOGIN_URL_ + '" target="_blank" rel="noopener" style="display:block;width:100%;box-sizing:border-box;padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;text-align:center;border-radius:8px;">Otvori Online Booking</a>' +
  '</td></tr></table>' +
  '<p style="font-size:12px;line-height:1.5;color:#777777;word-break:break-all;margin:0 0 18px;">Ako gumb ne radi, kopirajte poveznicu u preglednik: <a href="' + OB_LOGIN_URL_ + '" style="color:#0f8b7e;">' + OB_LOGIN_URL_ + '</a></p>' +
  KLIJENT_PRISTUP_KALKULATOR_BLOK_ +
  '<p style="font-size:12.5px;line-height:1.6;color:#555555;margin:0 0 6px;">Za jednostavnije i pouzdanije korištenje aplikacije preporučujemo internetske preglednike <strong>Microsoft Edge</strong> ili <strong>Google Chrome</strong> — s njima imamo najmanje poteškoća:</p>' +
  '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 20px;">' +
  '<tr>' +
  '<td style="padding-right:8px;"><img src="' + BROWSER_IKONA_EDGE_URL_ + '" alt="Microsoft Edge" width="26" height="26" style="display:block;border:0;"></td>' +
  '<td style="padding-right:18px;font-size:12.5px;color:#555555;">Microsoft Edge</td>' +
  '<td style="padding-right:8px;"><img src="' + BROWSER_IKONA_CHROME_URL_ + '" alt="Google Chrome" width="26" height="26" style="display:block;border:0;"></td>' +
  '<td style="font-size:12.5px;color:#555555;">Google Chrome</td>' +
  '</tr>' +
  '</table>' +
  // Gumb s poveznicom na zajednički Drive direktorij "Upute za korisnike"
  // (Sašin izričit zahtjev, 30.9.2026., ispravak ISTI dan — "google drive
  // link se dijeli klijentu u obliku buttona u templateu, ne ide mu
  // fizicki dokumenat, vec samo link na taj drive"). {{LINK_OPCIH_DOKUMENATA}}
  // tag zamjenjuje se STVARNIM linkom na direktorij (ne na pojedinačnu
  // datoteku) — vidi renderMailTekst_ u InTime_Admin.html i
  // adminDohvatiKlijentPristupOpceDokumente/getOpciDokumentiKlijentPristupFolderJavni_
  // u ovoj datoteci. Namjerno drugačija (neutralna, siva) boja od zelenog
  // gumba iznad, da se vizualno razlikuje kao sekundarna radnja.
  '<p style="font-size:12.5px;line-height:1.6;color:#555555;margin:0 0 6px;">Također smo Vam pripremili kratke upute za korištenje servisa:</p>' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-collapse:collapse;">' +
  '<tr><td align="center" bgcolor="#5b6b73" style="border-radius:8px;background-color:#5b6b73;">' +
  '<a href="{{LINK_OPCIH_DOKUMENATA}}" target="_blank" rel="noopener" style="display:block;width:100%;box-sizing:border-box;padding:14px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;text-align:center;border-radius:8px;">Upute za korištenje Online Bookinga</a>' +
  '</td></tr></table>' +
  '<p style="margin:0 0 4px;">Stojimo Vam na raspolaganju za bilo kakvu pomoć ili dodatna pitanja.</p>' +
  '<p style="margin:0 0 4px;">Srdačan pozdrav,</p>' +
  '<div style="border-top:1px solid #e3e6e5;margin-top:18px;padding-top:14px;font-size:12.5px;line-height:1.6;color:#444444;">' +
  '<strong style="color:#1f3d3a;">Saša Batinac, univ. spec. oec.</strong><br>' +
  'Sales and Marketing Manager, Voditelj ključnih kupaca<br>' +
  'In Time d.o.o. — Licensee of FedEx<br><br>' +
  'M: +385 91 6262 171 · <a href="mailto:sasa.batinac@in-time.hr" style="color:#0f8b7e;text-decoration:none;">sasa.batinac@in-time.hr</a>' +
  '</div>' +
  '</td></tr></table>' +
  '</td></tr></table>';

// Doda zadani "klijent pristup" predložak u Sheet SAMO ako redak s istim
// nazivom (stupac "Naziv") još ne postoji — isti idempotentni obrazac kao
// dodajPoslovniceObavijestPredlozakAkoNedostaje_ iznad. Saša je izričito
// tražio da bude "JEDAN template s mogućnosti da ih dodam kasnije još" —
// ova funkcija upisuje TOČNO taj jedan zadani, ostatak (dodavanje daljnjih
// predložaka iste kategorije) ide kroz postojeći "+ Novi predložak" u
// panelu, isti mehanizam kao ostala dva panela.
function dodajKlijentPristupPredlozakAkoNedostaje_(sheet) {
  var lastRow = sheet.getLastRow();
  var postojeciNazivi = {};
  if (lastRow >= 2) {
    var nazivi = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < nazivi.length; i++) {
      postojeciNazivi[String(nazivi[i][0] || '').trim()] = true;
    }
  }
  if (!postojeciNazivi[MAIL_PREDLOZAK_KLIJENT_PRISTUP_NAZIV_]) {
    sheet.appendRow([MAIL_PREDLOZAK_KLIJENT_PRISTUP_NAZIV_, MAIL_PREDLOZAK_KLIJENT_PRISTUP_PREDMET_, MAIL_PREDLOZAK_KLIJENT_PRISTUP_TEKST_, 'DA', new Date(), 'DA', 'klijent_pristup']);
  }
}

// Samopopravak (28.9.2026., Sašin izričit zahtjev "evo ugradi" — banner
// slika naknadno dodana u MAIL_PREDLOZAK_KLIJENT_PRISTUP_TEKST_ iznad):
// ako je zadani "klijent pristup" predložak VEĆ spremljen u Sheetu (npr.
// prijašnji redeploy prije nego je banner dodan) i JOŠ NEMA banner sliku,
// umeće se na POČETAK sadržaja, prije {{UVODNI_TEKST}} taga. Idempotentno —
// ako slika već postoji ili predložak nije prepoznat (Saša ga je ručno
// preuredio), ništa se ne dira. Djeluje SAMO na redak s TOČNIM zadanim
// nazivom, kategorije 'klijent_pristup'.
function popraviKlijentPristupBannerSlika_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }
  var podaci = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var bannerImg = 'https://i.imgur.com/Ue83z8O.png';
  var bannerHtml = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border-collapse:collapse;">' +
    '<tr><td align="center"><img src="' + bannerImg + '" alt="In Time d.o.o. — Vaši pristupni podaci" width="620" style="display:block;border:0;outline:none;text-decoration:none;width:100%;max-width:620px;height:auto;border-radius:10px;"></td></tr>' +
    '</table>';
  for (var i = 0; i < podaci.length; i++) {
    var kategorija = podaci[i][6] || 'ponuda';
    if (kategorija !== 'klijent_pristup') { continue; }
    if (String(podaci[i][0] || '').trim() !== MAIL_PREDLOZAK_KLIJENT_PRISTUP_NAZIV_) { continue; }
    var sadrzaj = String(podaci[i][2] || '');
    if (!sadrzaj || sadrzaj.indexOf(bannerImg) !== -1) { continue; }
    var umetnutoMjesto = sadrzaj.indexOf('{{UVODNI_TEKST}}');
    var noviSadrzaj = (umetnutoMjesto !== -1)
      ? (sadrzaj.slice(0, umetnutoMjesto) + bannerHtml + sadrzaj.slice(umetnutoMjesto))
      : (bannerHtml + sadrzaj);
    sheet.getRange(i + 2, 3).setValue(noviSadrzaj);
  }
}

// Samopopravak (28.9.2026., isti dan, nastavak — Sašin izričit zahtjev:
// "username i password stavi u kućicu...u tablicu da bude uokvireno i
// centrirano..i obojana polja..username crveno pasword plavo"): ako je
// zadani "klijent pristup" predložak VEĆ spremljen u Sheetu sa STARIM,
// običnim <p>Korisničko ime:/<p>Lozinka: retcima (prije nego su uvedene
// obojane kućice), automatski se zamjenjuje novim obrascem — isto mjesto,
// isti tagovi ({{OB_EMAIL}}/{{OB_LOZINKA}}). Idempotentno — ako su kućice
// već tu ili stari obrazac nije prepoznat (Saša ga je ručno preuredio),
// ništa se ne dira. Djeluje SAMO na redak s TOČNIM zadanim nazivom,
// kategorije 'klijent_pristup'.
function popraviKlijentPristupKucice_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }
  var podaci = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var regex = /<p[^>]*><strong>Korisničko ime:<\/strong>\s*\{\{OB_EMAIL\}\}<\/p>\s*<p[^>]*><strong>Lozinka:<\/strong>\s*\{\{OB_LOZINKA\}\}<\/p>/;
  var kucice =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 8px;border-collapse:collapse;">' +
    '<tr><td align="center" style="background-color:#fdeceb;border:2px solid #e57368;border-radius:8px;padding:12px 14px;">' +
    '<div style="font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#a93226;margin-bottom:4px;">Korisničko ime</div>' +
    '<div style="font-size:16px;font-weight:800;color:#7b241c;">{{OB_EMAIL}}</div>' +
    '</td></tr>' +
    '</table>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border-collapse:collapse;">' +
    '<tr><td align="center" style="background-color:#eaf1fb;border:2px solid #5b8fd6;border-radius:8px;padding:12px 14px;">' +
    '<div style="font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#2354a0;margin-bottom:4px;">Lozinka</div>' +
    '<div style="font-size:16px;font-weight:800;color:#1a3d73;">{{OB_LOZINKA}}</div>' +
    '</td></tr>' +
    '</table>';
  for (var i = 0; i < podaci.length; i++) {
    var kategorija = podaci[i][6] || 'ponuda';
    if (kategorija !== 'klijent_pristup') { continue; }
    if (String(podaci[i][0] || '').trim() !== MAIL_PREDLOZAK_KLIJENT_PRISTUP_NAZIV_) { continue; }
    var sadrzaj = String(podaci[i][2] || '');
    if (!sadrzaj || sadrzaj.indexOf('text-transform:uppercase;color:#a93226') !== -1) { continue; }
    if (regex.test(sadrzaj)) {
      sheet.getRange(i + 2, 3).setValue(sadrzaj.replace(regex, kucice));
    }
  }
}

// Samopopravak (30.9.2026., Sašin izričit zahtjev — poslao je dva imgur
// linka "ove slike stavi na template" za Edge/Chrome ikonice): ako je zadani
// "klijent pristup" predložak VEĆ spremljen u Sheetu sa STARIM Wikimedia
// linkovima (prije nego su zamijenjeni Sašinim vlastitim, vidi
// BROWSER_IKONA_EDGE_URL_/BROWSER_IKONA_CHROME_URL_ gore), automatski se
// zamjenjuju novima. Idempotentno — ako su nove ikonice već tu, ništa se ne
// dira. Djeluje SAMO na redak s TOČNIM zadanim nazivom, kategorije
// 'klijent_pristup'.
function popraviKlijentPristupIkoniceBrowsera_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }
  var podaci = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var staraEdge = 'https://upload.wikimedia.org/wikipedia/commons/9/98/Microsoft_Edge_logo_%282019%29.png';
  var staraChrome = 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Google_Chrome_icon_%28February_2022%29.svg/240px-Google_Chrome_icon_%28February_2022%29.svg.png';
  for (var i = 0; i < podaci.length; i++) {
    var kategorija = podaci[i][6] || 'ponuda';
    if (kategorija !== 'klijent_pristup') { continue; }
    if (String(podaci[i][0] || '').trim() !== MAIL_PREDLOZAK_KLIJENT_PRISTUP_NAZIV_) { continue; }
    var sadrzaj = String(podaci[i][2] || '');
    if (!sadrzaj) { continue; }
    if (sadrzaj.indexOf(staraEdge) === -1 && sadrzaj.indexOf(staraChrome) === -1) { continue; }
    var noviSadrzaj = sadrzaj.split(staraEdge).join(BROWSER_IKONA_EDGE_URL_).split(staraChrome).join(BROWSER_IKONA_CHROME_URL_);
    sheet.getRange(i + 2, 3).setValue(noviSadrzaj);
  }
}

// Samopopravak (30.9.2026., ispravak ISTI dan — gumb s poveznicom na opće
// dokumente dodan NAKNADNO u MAIL_PREDLOZAK_KLIJENT_PRISTUP_TEKST_ iznad):
// ako je zadani "klijent pristup" predložak VEĆ spremljen u Sheetu (npr.
// prijašnji redeploy od jutros, prije ovog ispravka) i JOŠ NEMA
// {{LINK_OPCIH_DOKUMENATA}} tag, umeće se odmah IZA bloka s ikonicama
// preglednika, prije "Stojimo Vam na raspolaganju". Idempotentno — ako tag
// već postoji, ništa se ne dira.
function popraviKlijentPristupOpciDokumentiGumb_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }
  var podaci = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var sidro = '<p style="margin:0 0 4px;">Stojimo Vam na raspolaganju za bilo kakvu pomoć ili dodatna pitanja.</p>';
  var umetak = '<p style="font-size:12.5px;line-height:1.6;color:#555555;margin:0 0 6px;">Također smo Vam pripremili kratke upute za korištenje servisa:</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-collapse:collapse;">' +
    '<tr><td align="center" bgcolor="#5b6b73" style="border-radius:8px;background-color:#5b6b73;">' +
    '<a href="{{LINK_OPCIH_DOKUMENATA}}" target="_blank" rel="noopener" style="display:block;width:100%;box-sizing:border-box;padding:14px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;text-align:center;border-radius:8px;">Upute za korištenje Online Bookinga</a>' +
    '</td></tr></table>';
  for (var i = 0; i < podaci.length; i++) {
    var kategorija = podaci[i][6] || 'ponuda';
    if (kategorija !== 'klijent_pristup') { continue; }
    if (String(podaci[i][0] || '').trim() !== MAIL_PREDLOZAK_KLIJENT_PRISTUP_NAZIV_) { continue; }
    var sadrzaj = String(podaci[i][2] || '');
    if (!sadrzaj || sadrzaj.indexOf('{{LINK_OPCIH_DOKUMENATA}}') !== -1 || sadrzaj.indexOf(sidro) === -1) { continue; }
    sheet.getRange(i + 2, 3).setValue(sadrzaj.replace(sidro, umetak + sidro));
  }
}

// Samopopravak (4.10.2026.) — vidi MAIL_UZAK_PREFIKS_ iznad. Već spremljeni
// ZADANI predlošci (OB zahtjev, obavijest poslovnicama, obavijest svim
// poslovnicama) omataju se uskim okvirom SAMO ako počinju točno starim
// vanjskim <div>-om i još nemaju okvir (idempotentno; Sašine ručno
// prepravljene predloške koji ne počinju tim obrascem ne dira).
function popraviUskiOkvirInternihPredlozaka_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }
  var podaci = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var stariPrefiks = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222222;">';
  var nazivi = {};
  nazivi[MAIL_PREDLOZAK_OB_NAZIV_] = true;
  nazivi[MAIL_PREDLOZAK_POSLOVNICE_NAZIV_] = true;
  nazivi[MAIL_PREDLOZAK_SVE_POSLOVNICE_NAZIV_] = true;
  for (var i = 0; i < podaci.length; i++) {
    if (!nazivi[String(podaci[i][0] || '').trim()]) { continue; }
    var sadrzaj = String(podaci[i][2] || '');
    if (!sadrzaj || sadrzaj.indexOf(stariPrefiks) !== 0) { continue; }
    if (sadrzaj.lastIndexOf('</div>') !== sadrzaj.length - 6) { continue; }
    sheet.getRange(i + 2, 3).setValue(MAIL_UZAK_PREFIKS_ + sadrzaj + MAIL_UZAK_SUFIKS_);
  }
}

// Samopopravak (30.9.2026., ISPRAVAK — Saša je poslao snimku stvarno
// primljenog test-maila: "mail se razlio... ne smije se toliko rasiriti", i
// gumb je prikazivao razbijene znakove umjesto ikonice). Dva odvojena
// ispravka, oba idempotentna, primjenjuju se neovisno jedan o drugom:
// (1) UKLANJANJE EMOJI IKONICE — "📄 " ispred naziva gumba je u stvarno
// poslanom mailu (GmailApp HTML tijelo) izašao kao razbijeni niz znakova
// umjesto slike, iako je ispravno UTF-8 kodiran u samom kodu/Sheetu —
// najsigurnije rješenje je jednostavno ukloniti ga, tekst gumba i dalje
// jasno govori svoju svrhu bez ikonice.
// (2) OGRANIČENJE ŠIRINE — predložak dosad NIJE imao nikakvo ograničenje
// širine na vanjskom omotaču, pa su sve width:100% tablice unutra (kućice,
// oba gumba) rasle na CIJELU širinu email-klijenta umjesto uskog stupca od
// 620px poravnatog s banner slikom. Ovdje se stari vanjski <div> (bez
// ograničenja) zamjenjuje istom dvostrukom centrirajućom tablicom kao u
// MAIL_PREDLOZAK_KLIJENT_PRISTUP_TEKST_ iznad — djeluje SAMO ako sadržaj
// počinje točno starim obrascem i završava točno s dva uzastopna </div> na
// samom kraju (Sašine ručne izmjene izvan ovog obrasca se ne diraju).
function popraviKlijentPristupSirinaIEmoji_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }
  var podaci = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var staraEmojiOznaka = '📄 Upute za korištenje Online Bookinga';
  var novaOznaka = 'Upute za korištenje Online Bookinga';
  var stariPrefiks = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222222;">';
  var noviPrefiks = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td align="center">' +
    '<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="width:620px;max-width:620px;border-collapse:collapse;"><tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222222;text-align:left;">';
  var stariSufiks = '</div></div>';
  var noviSufiks = '</div></td></tr></table></td></tr></table>';
  for (var i = 0; i < podaci.length; i++) {
    var kategorija = podaci[i][6] || 'ponuda';
    if (kategorija !== 'klijent_pristup') { continue; }
    if (String(podaci[i][0] || '').trim() !== MAIL_PREDLOZAK_KLIJENT_PRISTUP_NAZIV_) { continue; }
    var sadrzaj = String(podaci[i][2] || '');
    if (!sadrzaj) { continue; }
    var promijenjeno = false;
    if (sadrzaj.indexOf(staraEmojiOznaka) !== -1) {
      sadrzaj = sadrzaj.split(staraEmojiOznaka).join(novaOznaka);
      promijenjeno = true;
    }
    if (sadrzaj.indexOf(stariPrefiks) === 0 && sadrzaj.lastIndexOf(stariSufiks) === sadrzaj.length - stariSufiks.length) {
      sadrzaj = noviPrefiks + sadrzaj.slice(stariPrefiks.length, sadrzaj.length - stariSufiks.length) + noviSufiks;
      promijenjeno = true;
    }
    if (promijenjeno) { sheet.getRange(i + 2, 3).setValue(sadrzaj); }
  }
}

// Samopopravak (30.9.2026., Sašin izričit zahtjev — blok s pristupnim
// podacima za kalkulator dodan NAKNADNO u MAIL_PREDLOZAK_KLIJENT_PRISTUP_TEKST_
// iznad, kroz zajedničku varijablu KLIJENT_PRISTUP_KALKULATOR_BLOK_): ako je
// zadani "klijent pristup" predložak VEĆ spremljen u Sheetu (npr. prijašnji
// redeploy prije ovog ispravka) i JOŠ NEMA {{KALK_USERNAME}} tag, umeće se
// odmah ISPRED "Za jednostavnije i pouzdanije korištenje..." pasusa — točno
// isto mjesto kao u zadanom predlošku gore. Idempotentno — ako tag već
// postoji, ništa se ne dira. Djeluje SAMO na redak s TOČNIM zadanim nazivom,
// kategorije 'klijent_pristup'.
function popraviKlijentPristupKalkulatorBlok_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }
  var podaci = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var sidro = '<p style="font-size:12.5px;line-height:1.6;color:#555555;margin:0 0 6px;">Za jednostavnije i pouzdanije korištenje aplikacije preporučujemo internetske preglednike <strong>Microsoft Edge</strong> ili <strong>Google Chrome</strong> — s njima imamo najmanje poteškoća:</p>';
  for (var i = 0; i < podaci.length; i++) {
    var kategorija = podaci[i][6] || 'ponuda';
    if (kategorija !== 'klijent_pristup') { continue; }
    if (String(podaci[i][0] || '').trim() !== MAIL_PREDLOZAK_KLIJENT_PRISTUP_NAZIV_) { continue; }
    var sadrzaj = String(podaci[i][2] || '');
    if (!sadrzaj || sadrzaj.indexOf('{{KALK_USERNAME}}') !== -1 || sadrzaj.indexOf(sidro) === -1) { continue; }
    sheet.getRange(i + 2, 3).setValue(sadrzaj.replace(sidro, KLIJENT_PRISTUP_KALKULATOR_BLOK_ + sidro));
  }
}

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
  // Stupac 'Kategorija' dodan na SAM KRAJ (27.9.2026., Sašin izričit zahtjev
  // — predlošci za novi panel "Pošalji zahtjev za Online Booking" NE smiju
  // se pomiješati s predlošcima ponude u istom izborniku). Prazno/staro =
  // 'ponuda' (vidi adminMailPredlosciList niže) — SVI postojeći redci prije
  // ovog stupca ostaju predlošci ponude, ništa se ne mijenja za njih.
  var header = ['Naziv', 'Predmet', 'Sadržaj', 'Zadani', 'Datum izmjene', 'HTML', 'Kategorija'];
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
    sheet.appendRow(['Zadani predložak za ponudu', 'Ponuda In Time d.o.o. za {{IME_FIRME}} - OZNAKA PONUDE: {{BROJ_PONUDE}} - PO: {{BROJ_UPITNIKA}}', MAIL_PREDLOZAK_ZADANI_TEKST_, 'DA', new Date(), '', 'ponuda']);
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
  // BRZINA — vidi napomenu uz MAIL_PREDLOSCI_POPRAVCI_VERZIJA_ na vrhu
  // datoteke. Cijeli niz popravaka/dodavanja ide SAMO ako zastavica u Script
  // Properties ne odgovara trenutnoj verziji (prvi poziv nakon ovog
  // redeploya, ili prvi poziv ikad) — svaki sljedeći poziv unutar iste
  // verzije koda vraća list odmah, bez ijednog dodatnog čitanja Sheeta.
  var popravciProps_ = PropertiesService.getScriptProperties();
  if (popravciProps_.getProperty('MAIL_PREDLOSCI_POPRAVCI_VERZIJA') !== MAIL_PREDLOSCI_POPRAVCI_VERZIJA_) {
    popraviPredloskeBezLinkaDokumenata_(sheet);
    dodajHtmlPredloskeAkoNedostaju_(sheet);
    dodajObPredlozakAkoNedostaje_(sheet);
    popraviObPredlozakUvodniTag_(sheet);
    dodajPoslovniceObavijestPredlozakAkoNedostaje_(sheet);
    dodajSvePoslovniceObavijestPredlozakAkoNedostaje_(sheet);
    popraviSvePoslovniceObavijestTekst_(sheet);
    dodajKlijentPristupPredlozakAkoNedostaje_(sheet);
    popraviKlijentPristupBannerSlika_(sheet);
    popraviKlijentPristupKucice_(sheet);
    popraviKlijentPristupIkoniceBrowsera_(sheet);
    popraviKlijentPristupOpciDokumentiGumb_(sheet);
    popraviKlijentPristupSirinaIEmoji_(sheet);
    popraviKlijentPristupKalkulatorBlok_(sheet);
    popraviPoslovniceObavijestSlikaPrikupa_(sheet);
    popraviIkoniceUHtmlPredloscima_(sheet);
    popraviUslugeKutijuStil_(sheet);
    popraviUskiOkvirInternihPredlozaka_(sheet);
    popravciProps_.setProperty('MAIL_PREDLOSCI_POPRAVCI_VERZIJA', MAIL_PREDLOSCI_POPRAVCI_VERZIJA_);
  }
  return sheet;
}

// Samopopravak (22.9.2026., dvanaesti krug, nastavak — Sašin izričit
// zahtjev): ✅/📁 ikonice su ranije uklonjene iz standalone datoteka
// InTime_MailPredlozak_1/2_....html RADI PREGLEDA, ali PRAVI sadržaj koji
// se stvarno šalje živi u Sheetu "InTime_MailPredlosci" (upisan JEDNOM, kod
// prvog ikad poziva dodajHtmlPredloskeAkoNedostaju_() gore, dok su
// MAIL_PREDLOZAK_HTML_STANDARDNA_/KORIGIRANA_ konstante još imale stare
// ikonice) — pa je već spremljeni redak u Sašinom Sheetu i dalje sadržavao
// razlomljene ikonice, iako su konstante ovdje u međuvremenu ispravljene.
// Isti mehanizam iskorišten i za rečenicu "Na temelju takvog povratnog
// maila..." iz "Standardna ponuda (HTML)" (Sašin izričit zahtjev, isti
// krug) — bila je ostatak stare verzije teksta (nakon crvenog "Rok
// važenja" bloka), izbačena je iz konstante, a Saša je zatim tražio
// proširen/preformuliran tekst na SASVIM DRUGOM mjestu — ODMAH ISPOD
// uvodnog odlomka "Ponudu možete prihvatiti brzo i jednostavno...", PRIJE
// zelenog gumba "Potvrdi ponudu" (ne nakon crvenog roka — tamo odmah idu
// "In Time d.o.o. prednosti su:", bez ičega između). Već spremljeni redak
// u Sašinom Sheetu je i dalje imao staru rečenicu na starom mjestu, pa je
// ova funkcija briše odande i umeće novi tekst na ispravno mjesto.
// Ova funkcija (idempotentna, svaki put provjerava postoje li ostaci)
// surgically briše/umeće SAMO te poznate podnizove u sadržaju SVAKOG HTML
// predloška (stupac HTML='DA') — ništa se drugo u sadržaju ne dira, tako
// da Saša ne gubi nikakvu svoju eventualnu ručnu izmjenu istog predloška.
function popraviIkoniceUHtmlPredloscima_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }
  var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var recenicaZaBrisanje_ = '<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Na temelju takvog povratnog maila Vaš poslovni subjekt otvaramo u našem sustavu, dodjeljujemo Vam username i password za unos naloga i u roku od 12–24 sata možete početi unositi naloge i naručivati In Time prikup paketa.</p>\n';
  // Novi, prošireni/preformulirani tekst (Sašin izričit zahtjev, isti
  // krug) — umeće se ODMAH ISPOD uvodnog odlomka "Ponudu možete
  // prihvatiti...", PRIJE zelenog gumba "Potvrdi ponudu".
  var novoObjasnjenje_ = '<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Na temelju Vaše povratne potvrde te nakon verifikacije ponude u sjedištu društva IN TIME d.o.o. u Zagrebu, Vaš poslovni subjekt bit će otvoren u našem sustavu.</p>\n<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Potom ćemo Vam dodijeliti korisničko ime i lozinku za pristup sustavu i unos naloga. U roku od 24 do 48 sati moći ćete započeti s unosom naloga i naručivanjem IN TIME prikupa pošiljaka.</p>\n';
  var uvodniOdlomak_ = '<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;"><strong>Ponudu možete prihvatiti brzo i jednostavno, bez čekanja na povratni mail — klikom na gumb ispod, gdje je potrebno unijeti OIB Vaše tvrtke te ime i prezime i funkciju osobe koja potvrđuje, kao dokaz ovlaštenja za prihvaćanje ponude {{BROJ_PONUDE}}:</strong></p>\n\n';
  // Slika ispod gumba "Pogledaj dokumente ponude" (Sašin izričit zahtjev,
  // isti krug) — umeće se odmah nakon fallback-linka tog gumba, prije
  // crvenog "Rok važenja" bloka.
  var oznakaZaSlikuIza_ = '<p style="font-size:12px;line-height:1.5;color:#777777;word-break:break-all;margin:0 0 14px;">Ako gumb ne radi, kopirajte poveznicu u preglednik: <a href="{{LINK_DOKUMENTI}}" style="color:#0f8b7e;">{{LINK_DOKUMENTI}}</a></p>\n\n';
  var slikaPonude_ = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 24px;border-collapse:collapse;">\n<tr>\n<td align="center">\n<img src="https://i.imgur.com/JYxGTas.png" alt="In Time d.o.o. — Ponuda" width="560" style="display:block;border:1px solid #e3e6e5;outline:none;text-decoration:none;width:100%;max-width:560px;height:auto;border-radius:10px;box-shadow:0 6px 18px rgba(15,139,126,0.18);">\n</td>\n</tr>\n</table>\n\n';
  // Staro objašnjenje u "Korigirana ponuda (HTML)" (odmah nakon crvene
  // "Rok važenja" trake) — Sašin izričit zahtjev, novi krug: zamijeni ga
  // istim novoObjasnjenje_ tekstom koji je Standardna već dobila.
  var staroObjasnjenjeKorigirana_ = '<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">Nakon što zaprimimo Vašu povratnu potvrdu, ponuda će biti upućena na verifikaciju u sjedište društva IN TIME d.o.o. u Zagrebu, nakon čega ćemo Vaš poslovni subjekt otvoriti u našem sustavu.</p>\n<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#2b2b2b;">U roku od 24 do 48 sati od trenutka zaprimanja Vaše potvrde, na istu adresu e-pošte primit ćete korisničko ime, lozinku i upute za pristup sustavu. Nakon zaprimanja pristupnih podataka moći ćete odmah započeti s unosom naloga i naručivanjem IN TIME prikupa pošiljaka.</p>';
  // {{USLUGE}} kutija — crno (umjesto tamno sivo) podebljano slovo + novi
  // sitni redak ispod s POTPUNIM popisom svih 6 usluga (Sašin izričit
  // zahtjev, novi krug: "podebljanim crnim slovima... i dolje napiši sve
  // dodatne usluge... sitnim slovima odmah ispod tog zelenog kvadrata").
  // Isto za OBA predloška (Standardna i Korigirana) — struktura identična.
  var staraUslugeKutija_ = '<div style="white-space:pre-line;font-size:14px;line-height:1.7;background-color:#f6faf9;border:1px solid #d9ece8;border-radius:8px;padding:14px 16px;margin:0 0 18px;color:#2b2b2b;text-align:center;font-weight:bold;">{{USLUGE}}</div>';
  var novaUslugeKutija_ = '<div style="white-space:pre-line;font-size:14px;line-height:1.7;background-color:#f6faf9;border:1px solid #d9ece8;border-radius:8px;padding:14px 16px;margin:0 0 6px;color:#000000;text-align:center;font-weight:bold;">{{USLUGE}}</div>\n<p style="font-size:10px;line-height:1.5;color:#8a938f;text-align:center;margin:0 0 18px;">Dodatne usluge koje Vam možemo ponuditi: Domaća distribucija (unutar Hrvatske) · Međunarodna distribucija (Slovenija, BiH, Srbija, Crna Gora, Sj. Makedonija) – uvoz/izvoz · Međunarodna distribucija – FedEx EXPRESS (uvoz/izvoz) · Međunarodna distribucija – FedEx ECONOMY (uvoz/izvoz) · Carinsko posredovanje (uvoz/izvoz) · Skladištenje i fulfillment usluge.</p>';
  for (var i = 0; i < data.length; i++) {
    var sadrzaj = String(data[i][2] || '');
    var jeHtml = data[i][5] === 'DA';
    if (!jeHtml || !sadrzaj) { continue; }
    var nazivPredloska_ = String(data[i][0] || '').trim();
    var popravljeno = sadrzaj.split('✅ Potvrdi ponudu').join('Potvrdi ponudu')
      .split('📁 Pogledaj dokumente ponude').join('Pogledaj dokumente ponude')
      .split(recenicaZaBrisanje_).join('')
      .split(staraUslugeKutija_).join(novaUslugeKutija_);
    // Umetni novi tekst nakon uvodnog odlomka SAMO za "Standardna ponuda
    // (HTML)" (isti razlog kao kod slike niže — "Korigirana ponuda (HTML)"
    // ima identičan uvodni odlomak pa se ne smije oslanjati samo na
    // sadržaj) i još nema novi tekst (idempotentno).
    if (nazivPredloska_ === MAIL_PREDLOZAK_HTML_STANDARDNA_NAZIV_ && popravljeno.indexOf(uvodniOdlomak_) !== -1 && popravljeno.indexOf(novoObjasnjenje_) === -1) {
      popravljeno = popravljeno.split(uvodniOdlomak_).join(uvodniOdlomak_ + novoObjasnjenje_);
    }
    // Isto za sliku — SAMO za predložak nazvan točno "Standardna ponuda
    // (HTML)" (Sašin zahtjev je bio konkretno za taj predložak; "Korigirana
    // ponuda (HTML)" ima identičan fallback-link tekst gumba pa se ne smije
    // oslanjati samo na sadržaj, nego i na naziv retka).
    if (nazivPredloska_ === MAIL_PREDLOZAK_HTML_STANDARDNA_NAZIV_ && popravljeno.indexOf(oznakaZaSlikuIza_) !== -1 && popravljeno.indexOf('JYxGTas') === -1) {
      popravljeno = popravljeno.split(oznakaZaSlikuIza_).join(oznakaZaSlikuIza_ + slikaPonude_);
    }
    // Zamijeni staro objašnjenje novim SAMO za "Korigirana ponuda (HTML)".
    if (nazivPredloska_ === MAIL_PREDLOZAK_HTML_KORIGIRANA_NAZIV_ && popravljeno.indexOf(staroObjasnjenjeKorigirana_) !== -1) {
      popravljeno = popravljeno.split(staroObjasnjenjeKorigirana_).join(novoObjasnjenje_.trim());
    }
    // Slika i za "Korigirana ponuda (HTML)" (Sašin izričit zahtjev, novi
    // krug: "ubaci sliku... i u korigiranu ponudu, na isto mjesto").
    if (nazivPredloska_ === MAIL_PREDLOZAK_HTML_KORIGIRANA_NAZIV_ && popravljeno.indexOf(oznakaZaSlikuIza_) !== -1 && popravljeno.indexOf('JYxGTas') === -1) {
      popravljeno = popravljeno.split(oznakaZaSlikuIza_).join(oznakaZaSlikuIza_ + slikaPonude_);
    }
    // Proširenje podebljanja u "prednosti" listi SAMO za "Standardna ponuda
    // (HTML)" (Sašin izričit zahtjev, novi krug — točno prema njegovoj
    // označenoj referenci).
    if (nazivPredloska_ === MAIL_PREDLOZAK_HTML_STANDARDNA_NAZIV_) {
      var prednostiZamjene_ = [
        ['<li style="margin-bottom:8px;"><strong>EKSPRESNA ISPORUKA</strong> pošiljaka unutar granica RH po principu „od vrata do vrata", bez posrednika, dodatnih zaustavljanja i paketomata za preuzimanje od strane krajnjeg primatelja.</li>',
         '<li style="margin-bottom:8px;"><strong>EKSPRESNA ISPORUKA pošiljaka unutar granica RH</strong> po principu <strong>„od vrata do vrata"</strong>, bez posrednika, dodatnih zaustavljanja i paketomata za preuzimanje od strane krajnjeg primatelja.</li>'],
        ['<li style="margin-bottom:8px;">Vrlo brzo rješavanje prigovora i naknada štete u slučaju oštećenja ili gubitka Vaših pošiljaka u transportu.</li>',
         '<li style="margin-bottom:8px;"><strong>Vrlo brzo rješavanje prigovora i naknada štete</strong> u slučaju oštećenja ili gubitka Vaših pošiljaka u transportu.</li>'],
        ['<li style="margin-bottom:8px;">Prodajni agent zadužen isključivo za Vas kao našeg klijenta brzo i učinkovito rješava svu aktualnu problematiku — ne morate sami kontaktirati različite službe unutar In Time d.o.o.</li>',
         '<li style="margin-bottom:8px;"><strong>Prodajni agent zadužen isključivo za Vas</strong> kao našeg klijenta brzo i učinkovito rješava svu aktualnu problematiku — <strong>ne morate sami kontaktirati različite službe unutar In Time d.o.o.</strong></li>'],
        ['<li style="margin-bottom:8px;">Više paketa koje šaljete na jednu adresu tretiramo kao dijelove iste pošiljke — zbrajaju se samo njihove težine.</li>',
         '<li style="margin-bottom:8px;"><strong>Više paketa koje šaljete na jednu adresu tretiramo kao dijelove iste pošiljke</strong> — zbrajaju se samo njihove težine.</li>'],
        ['<li style="margin-bottom:8px;">Provodimo <strong>interno tjedno i mjesečno vanjsko ocjenjivanje</strong> kvalitete i točnosti usluge, uz korekciju svih uočenih nedostataka i propusta <strong>u vrlo kratkim rokovima</strong>.</li>',
         '<li style="margin-bottom:8px;">Provodimo <strong>interno tjedno i mjesečno vanjsko ocjenjivanje kvalitete i točnosti usluge</strong>, uz korekciju svih uočenih nedostataka i propusta <strong>u vrlo kratkim rokovima</strong>.</li>'],
        ['    <li style="margin-bottom:4px;">praćenje pošiljke u realnom vremenu</li>\n    <li style="margin-bottom:4px;">potpunu kontrolu nad svim pošiljkama na jednom mjestu</li>',
         '    <li style="margin-bottom:4px;"><strong>praćenje pošiljke u realnom vremenu</strong></li>\n    <li style="margin-bottom:4px;"><strong>potpunu kontrolu nad svim pošiljkama na jednom mjestu</strong></li>'],
        ['<p style="margin:6px 0 0;font-size:13.5px;line-height:1.6;color:#2b2b2b;">Klijentima bez naknade osiguravamo A4 naljepnice za ispis naloga za pošiljke. Potrebno ih je zatražiti prilikom početka suradnje ili tijekom suradnje kada potrošite postojeću zalihu.</p>',
         '<p style="margin:6px 0 0;font-size:13.5px;line-height:1.6;color:#2b2b2b;">Klijentima <strong>bez naknade osiguravamo A4 naljepnice</strong> za ispis naloga za pošiljke. Potrebno ih je zatražiti prilikom početka suradnje ili tijekom suradnje kada potrošite postojeću zalihu.</p>'],
        ['<li style="margin-bottom:8px;">Prevozimo sve pošiljke — od paketa mase 2 kg do tereta mase 2,5 tone, uključujući sve volumene koji se mogu utovariti u kombi vozila ili kamione s hidrauličnom rampom. Napomena: za utovar većih odnosno težih tereta potrebno je osigurati raspoloživ viličar ili utovarnu rampu na lokaciji prikupa.</li>',
         '<li style="margin-bottom:8px;"><strong>Prevozimo sve pošiljke — od paketa mase 2 kg do tereta mase 2,5 tone</strong>, uključujući sve volumene koji se mogu utovariti u kombi vozila ili kamione s hidrauličnom rampom. Napomena: za utovar većih odnosno težih tereta potrebno je osigurati raspoloživ viličar ili utovarnu rampu na lokaciji prikupa.</li>'],
        ['<li style="margin-bottom:8px;">Ekspresna dostava malih pošiljaka od 0 do 40 kg — čak 98,7 % paketa u većim gradovima (Zona 1) isporučuje se unutar 24 sata od preuzimanja.</li>',
         '<li style="margin-bottom:8px;"><strong>Ekspresna dostava malih pošiljaka od 0 do 40 kg</strong> — čak 98,7 % paketa u većim gradovima (Zona 1) isporučuje se <strong>unutar 24 sata od preuzimanja</strong>.</li>'],
        ['<li style="margin-bottom:8px;">Distribucija velikih i paletnih pošiljaka mase veće od 100 kg — isporuka u Zoni 1 najčešće se izvršava u roku od 24 do 48 sati, a maksimalno unutar tri radna dana.</li>',
         '<li style="margin-bottom:8px;"><strong>Distribucija velikih i paletnih pošiljaka mase veće od 100 kg</strong> — isporuka u Zoni 1 najčešće se izvršava <strong>u roku od 24 do 48 sati</strong>, a maksimalno unutar tri radna dana.</li>'],
        ['<li style="margin-bottom:8px;">Radimo <strong>isključivo na temelju ponude</strong>, bez pritiska na ostvarivanje planova i bez obveznog minimalnog volumena pošiljaka koje trebate poslati putem našeg logističkog sustava.</li>',
         '<li style="margin-bottom:8px;">Radimo <strong>isključivo na temelju ponude</strong>, bez pritiska na ostvarivanje planova i <strong>bez obveznog minimalnog volumena pošiljaka</strong> koje trebate poslati putem našeg logističkog sustava.</li>'],
        ['<li style="margin-bottom:8px;">In Time d.o.o. — poslovni subjekt u potpunom hrvatskom vlasništvu.</li>',
         '<li style="margin-bottom:8px;"><strong>In Time d.o.o. — poslovni subjekt u potpunom hrvatskom vlasništvu.</strong></li>']
      ];
      for (var p = 0; p < prednostiZamjene_.length; p++) {
        if (popravljeno.indexOf(prednostiZamjene_[p][0]) !== -1) {
          popravljeno = popravljeno.split(prednostiZamjene_[p][0]).join(prednostiZamjene_[p][1]);
        }
      }
    }
    if (popravljeno === sadrzaj) { continue; }
    sheet.getRange(i + 2, 3).setValue(popravljeno);
    sheet.getRange(i + 2, 5).setValue(new Date());
  }
}

// Samopopravak (26.9.2026., Sašin izričit zahtjev — "usluge koje
// nabrajamo neka budu bold podebljane i centrirane na centar"): zelena
// kutija oko {{USLUGE}} (popis odabranih usluga u ponudi) MORA imati
// text-align:center i font-weight:bold. Konstante gore (MAIL_PREDLOZAK_
// HTML_STANDARDNA_/KORIGIRANA_) već imaju ta dva svojstva na toj kutiji —
// ali to vrijedi samo za sjeme (prvi ikad upis) ili za redak koji
// popraviIkoniceUHtmlPredloscima_ iznad prepozna TOČNIM starim podnizom.
// Ako je Sašin već spremljeni redak u Sheetu ikad ručno mijenjan (ili
// potječe iz neke još starije verzije koju ta funkcija ne prepoznaje),
// stil na kutiji ostaje kakav god trenutno jest. Ova funkcija je robusnija
// — regexom nađe SAM <div ...>{{USLUGE}}</div>, bez obzira na njegov
// trenutni inline stil, makne postojeće 'text-align'/'font-weight'
// deklaracije (s BILO KOJOM vrijednosti) i doda ispravne. Idempotentna —
// ako je stil već točno takav, ništa se ne piše natrag.
function uslugeKutijaStilVecIspravan_(stil) {
  var taMatch = stil.match(/text-align\s*:\s*([^;]+)/i);
  var fwMatch = stil.match(/font-weight\s*:\s*([^;]+)/i);
  var taOk = !!(taMatch && taMatch[1].trim().toLowerCase() === 'center');
  var fwOk = !!(fwMatch && fwMatch[1].trim().toLowerCase() === 'bold');
  return taOk && fwOk;
}
function popraviUslugeKutijuStil_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }
  var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var divRe_ = /<div style="([^"]*)">\{\{USLUGE\}\}<\/div>/i;
  for (var i = 0; i < data.length; i++) {
    var sadrzaj = String(data[i][2] || '');
    var jeHtml = data[i][5] === 'DA';
    if (!jeHtml || !sadrzaj) { continue; }
    var m = sadrzaj.match(divRe_);
    if (!m) { continue; }
    var stariStil_ = m[1] || '';
    // Provjera SAMO po stvarnoj vrijednosti ta dva svojstva (ne po
    // formatiranju cijelog stila) — sprječava da whitespace/redoslijed
    // razlike u ostatku stila (razmak nakon ';', drukčiji poredak
    // svojstava i sl.) svaki put lažno izgledaju kao promjena, što bi
    // bespotrebno prepisivalo redak (i "Datum izmjene") pri SVAKOM
    // učitavanju admina iako je stil već stvarno ispravan.
    if (uslugeKutijaStilVecIspravan_(stariStil_)) { continue; }
    var noviStil_ = stariStil_
      .split(';')
      .map(function(dio) { return dio.trim(); })
      .filter(function(dio) { return dio && !/^text-align\s*:/i.test(dio) && !/^font-weight\s*:/i.test(dio); })
      .join(';');
    if (noviStil_ && noviStil_.charAt(noviStil_.length - 1) !== ';') { noviStil_ += ';'; }
    noviStil_ += 'text-align:center;font-weight:bold;';
    var popravljeno = sadrzaj.replace(divRe_, '<div style="' + noviStil_ + '">{{USLUGE}}</div>');
    sheet.getRange(i + 2, 3).setValue(popravljeno);
    sheet.getRange(i + 2, 5).setValue(new Date());
  }
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
  var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
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
      html: data[i][5] === 'DA',
      // 'Kategorija' (27.9.2026., prošireno 28.9.2026.) — 'ponuda',
      // 'ob_zahtjev' ili 'poslovnica_obavijest'; prazno (stari redci prije
      // uvođenja stupca) = 'ponuda', jer su svi postojeći predlošci do sad
      // bili predlošci ponude.
      kategorija: data[i][6] || 'ponuda'
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
  // Kategorija (27.9.2026., prošireno 28.9.2026. s 'poslovnica_obavijest')
  // — 'ponuda' (zadano), 'ob_zahtjev' ili 'poslovnica_obavijest'. Čišćenje
  // postojeće zastavice "zadani" (niže) MORA biti scopeano na ISTU
  // kategoriju — inače bi spremanje novog zadanog OB/poslovnica predloška
  // slučajno skinulo "zadani" sa zadanog predloška druge kategorije.
  var kategorijaSirova_ = String(predlozak.kategorija || '').trim();
  var kategorija = (kategorijaSirova_ === 'ob_zahtjev' || kategorijaSirova_ === 'poslovnica_obavijest' || kategorijaSirova_ === 'klijent_pristup' || kategorijaSirova_ === 'sve_poslovnice_obavijest') ? kategorijaSirova_ : 'ponuda';
  var sheet = getOrCreateMailPredlosciSheet();
  var zadani = !!predlozak.zadani;
  if (zadani) {
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var podaciZaZadani = sheet.getRange(2, 4, lastRow - 1, 4).getValues();
      for (var i = 0; i < podaciZaZadani.length; i++) {
        var kategorijaRetka = podaciZaZadani[i][3] || 'ponuda';
        if (podaciZaZadani[i][0] === 'DA' && kategorijaRetka === kategorija) { sheet.getRange(i + 2, 4).setValue(''); }
      }
    }
  }
  var jeHtml = !!predlozak.html;
  var redak = [naziv, predmet, sadrzaj, zadani ? 'DA' : '', new Date(), jeHtml ? 'DA' : '', kategorija];
  var rowIndex = parseInt(predlozak.rowIndex, 10);
  if (rowIndex && rowIndex >= 2 && rowIndex <= sheet.getLastRow()) {
    sheet.getRange(rowIndex, 1, 1, 7).setValues([redak]);
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

// ============================================================
// KALKULATOR CIJENE — OSNOVNI (ZADANI) CJENOVNIK — kartica "🧮 Kalkulator"
// → pod-kartica "Postavke osnovnog kalkulatora" (27.9.2026., Sašin izričit
// zahtjev). Ovo je cjenovnik (kategorije težine × 3 zone, isti format kao
// tablica "Cjenik" na kalkulatoru) po kojemu kalkulator na javnoj stranici
// (InTime_KalkulatorCijena.html) radi SVIM posjetiteljima DOK sami ne
// učitaju svoj vlastiti cjenik na samoj stranici kalkulatora — ta opcija
// (desna kolona, "Učitaj cjenik" / "Vrati zadani cjenik") ostaje potpuno
// nepromijenjena i i dalje ima prednost dok je aktivna u toj posjeti; ovo
// mijenja SAMO zadanu/početnu vrijednost koju stranica koristi prije toga
// (Sašine riječi: "na cjenovniku ipak i dalje ostaje opcija da se učita
// kalkulator korisnika...to ne diraj").
//
// Parser (parseKalkulatorCjenikRedaka_) je izravan port istoimene funkcije
// parseCjenikRows() iz InTime_KalkulatorCijena.html — namjerno IDENTIČNA
// logika, samo prevedena u Apps Script (isti ulaz: 2D niz redaka, ovdje
// dobiven konverzijom uploadanog .xlsx-a u privremeni Google Sheet preko
// pretvoriXlsxUSheet_(), isti obrazac kao Zone upload iznad).
//
// Svaki upload (i svako vraćanje starije verzije) OBAVEZNO traži razlog
// (Sašin izričit zahtjev: "svaki put kad se promjeni treba se zabilježiti
// datum promjene i razlog") — datum se bilježi s točnošću do sekunde, i
// upload i razlog idu i u "trenutno stanje" (Script Properties) i kao nov
// redak u arhivu (isti obrazac kao Zone arhiva, samo s dodatnim stupcem
// Razlog).
// ============================================================
function parseKalkulatorCjenikRedaka_(rows) {
  var out = [];
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (!row) { continue; }
    var kgVal = null, kgIdx = -1;
    for (var i = 0; i < row.length; i++) {
      var v = row[i];
      if (typeof v === 'string' && /kg/i.test(v)) {
        var cleaned = v.replace(/\./g, '').replace(',', '.');
        var m = cleaned.match(/[\d.]+/);
        if (m) { kgVal = parseFloat(m[0]); kgIdx = i; break; }
      }
    }
    if (kgVal === null || kgVal <= 0) { continue; }
    var nums = [];
    for (var j = kgIdx + 1; j < row.length && nums.length < 3; j++) {
      var v2 = row[j];
      if (typeof v2 === 'number' && isFinite(v2)) {
        nums.push(v2);
      } else if (typeof v2 === 'string' && v2.trim() !== '' && /^[\s\d.,]+$/.test(v2)) {
        var n = parseFloat(v2.replace(/\./g, '').replace(',', '.'));
        if (!isNaN(n)) { nums.push(n); }
      }
    }
    if (nums.length === 3) {
      out.push({ kg: kgVal, z1: nums[0], z2: nums[1], z3: nums[2] });
    }
  }
  out.sort(function(a, b) { return a.kg - b.kg; });
  return out;
}

// ============================================================================
// KALKULATOR — port preostalih "skrivenih" postavki cjenika (30.9.2026.,
// Sašin izričit zahtjev, nastavak istog dana: "sad dovrši kalkulator, one 14
// postavki što si rekla da ćeš odraditi", + izričita napomena da se ne
// zaboravi "ona skrivena postavka koja govori da li ima ograničen broj
// koleta" — parseMaxKoletaFromRows_ niže). Do sad su SVE ove postavke
// postojale ISKLJUČIVO kao klijent-strani JS u InTime_KalkulatorCijena.html
// (parseNestandardnaPctFromRows i još 13 srodnih funkcija, sve rade nad istim
// oblikom 2D niza redaka — XLSX.utils.sheet_to_json({header:1}) na stranici,
// getValues() ovdje — identičan format pa je port izravan, redak po redak) i
// primjenjivale su se SAMO kad korisnik SAM ručno učita Excel na javnoj
// stranici. Svaka funkcija ispod je NAMJERNO identična logika kao istoimena
// *FromRows funkcija u InTime_KalkulatorCijena.html (isti regexi, isti
// redoslijed provjera) — ne mijenjati jednu bez druge. Pozvane su iz
// parsirajDodatneKalkulatorPostavke_ na dnu ovog bloka, koju poziva
// ucitajKlijentovCjenikSDrivea_ za svakog klijenta s dodijeljenim pristupom
// kalkulatoru (isti "Cjenik Hrvatska" dokument, isti values niz, samo jedan
// dodatan prolaz preko 16 funkcija umjesto samo parseKalkulatorCjenikRedaka_).
// ============================================================================

function kalkR2_(n) {
  // isti obrazac kao r2() u InTime_KalkulatorCijena.html — ispravlja tipične
  // greške binarnog zaokruživanja (npr. 57.70*0.15 = 8.6549999...).
  return Math.round((n + (n >= 0 ? 1e-9 : -1e-9)) * 100) / 100;
}

// Port parseNestandardnaPctFromRows() — ugovoreni % naknade za nestandardnu
// pošiljku. Vraća FRAKCIJU (npr. 1 = 100%, 0.5 = 50%) ili null.
function parseNestandardnaPctFromRows_(rows) {
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (!row) { continue; }
    var labelIdx = -1;
    for (var i = 0; i < row.length; i++) {
      if (typeof row[i] === 'string' && /nestandardn/i.test(row[i])) { labelIdx = i; break; }
    }
    if (labelIdx === -1) { continue; }
    for (var j = labelIdx + 1; j < row.length; j++) {
      var v = row[j];
      if (typeof v === 'number' && isFinite(v) && v >= 0) { return v; }
    }
  }
  return null;
}

// Port parsePovratPctFromRows() — ugovoreni % naknade za "Povrat
// pošiljatelju". Vraća FRAKCIJU ili null.
function parsePovratPctFromRows_(rows) {
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (!row) { continue; }
    var labelIdx = -1;
    for (var i = 0; i < row.length; i++) {
      if (typeof row[i] === 'string' && /po[sš]iljatelj/i.test(row[i])) { labelIdx = i; break; }
    }
    if (labelIdx === -1) { continue; }
    for (var j = labelIdx + 1; j < row.length; j++) {
      var v = row[j];
      if (typeof v === 'number' && isFinite(v) && v >= 0) { return v; }
    }
  }
  return null;
}

// Port parseSmsCijenaFromRows() — ugovorena cijena po SMS poruci, apsolutan
// iznos u EUR. Vraća broj ili null.
function parseSmsCijenaFromRows_(rows) {
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (!row) { continue; }
    var labelIdx = -1;
    for (var i = 0; i < row.length; i++) {
      if (typeof row[i] === 'string' && /tekstualna.*obavijest/i.test(row[i])) { labelIdx = i; break; }
    }
    if (labelIdx === -1) { continue; }
    for (var j = labelIdx + 1; j < row.length; j++) {
      var v = row[j];
      if (typeof v === 'number' && isFinite(v) && v >= 0) { return v; }
      if (typeof v === 'string') {
        var m = v.match(/([\d.,]+)\s*EUR/i);
        if (m) {
          var val = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
          if (!isNaN(val)) { return val; }
        }
      }
    }
  }
  return null;
}

// Port parsePovratnicaCijenaFromRows() — cijena za "Povrat otpremnice
// (povratnica)", apsolutan iznos u EUR. Vraća broj ili null.
function parsePovratnicaCijenaFromRows_(rows) {
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (!row) { continue; }
    var labelIdx = -1;
    for (var i = 0; i < row.length; i++) {
      if (typeof row[i] === 'string' && /otpremnic/i.test(row[i])) { labelIdx = i; break; }
    }
    if (labelIdx === -1) { continue; }
    for (var j = labelIdx + 1; j < row.length; j++) {
      var v = row[j];
      if (typeof v === 'number' && isFinite(v) && v >= 0) { return v; }
      if (typeof v === 'string') {
        var m = v.match(/([\d.,]+)\s*EUR/i);
        if (m) {
          var val = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
          if (!isNaN(val)) { return val; }
        }
      }
    }
  }
  return null;
}

// Port parseOtkupninaFromRows(rows, labelRegex) — čita I postotak I minimalni
// iznos iz iste ćelije (npr. "5 % od iznos otkupnine, minimalno 1 EUR").
// Vraća {pct, min} (pct kao POSTOTAK, min može biti null) ili null.
function parseOtkupninaFromRows_(rows, labelRegex) {
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (!row) { continue; }
    var labelIdx = -1;
    for (var i = 0; i < row.length; i++) {
      if (typeof row[i] === 'string' && labelRegex.test(row[i])) { labelIdx = i; break; }
    }
    if (labelIdx === -1) { continue; }
    for (var j = labelIdx + 1; j < row.length; j++) {
      var v = row[j];
      if (typeof v === 'string') {
        var pctMatch = v.match(/([\d.,]+)\s*%/);
        if (pctMatch) {
          var pct = parseFloat(pctMatch[1].replace(/\./g, '').replace(',', '.'));
          if (isNaN(pct)) { continue; }
          var minMatch = v.match(/minimalno\s*([\d.,]+)\s*EUR/i);
          var min = null;
          if (minMatch) {
            var parsedMin = parseFloat(minMatch[1].replace(/\./g, '').replace(',', '.'));
            if (!isNaN(parsedMin)) { min = parsedMin; }
          }
          return { pct: pct, min: min };
        }
      }
      if (typeof v === 'number' && isFinite(v) && v >= 0) {
        return { pct: kalkR2_(v * 100), min: null };
      }
    }
  }
  return null;
}

// Port parseIskazanaVrijednostPctFromRows() — % naknade za "Naknada za
// iskazanu vrijednost". Vraća POSTOTAK (ne frakciju) ili null.
function parseIskazanaVrijednostPctFromRows_(rows) {
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (!row) { continue; }
    var labelIdx = -1;
    for (var i = 0; i < row.length; i++) {
      if (typeof row[i] === 'string' && /iskazan.*vrijednost/i.test(row[i])) { labelIdx = i; break; }
    }
    if (labelIdx === -1) { continue; }
    for (var j = labelIdx + 1; j < row.length; j++) {
      var v = row[j];
      if (typeof v === 'number' && isFinite(v) && v >= 0) { return kalkR2_(v * 100); }
      if (typeof v === 'string') {
        var m = v.match(/([\d.,]+)\s*%/);
        if (m) {
          var pct = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
          if (!isNaN(pct)) { return pct; }
        }
      }
    }
  }
  return null;
}

// Port generičkog parseFixedEurFromRows(rows, labelRegex) — koristi se za
// svih 5 preostalih dodatnih usluga s fiksnim EUR iznosom (Pokušaj
// preuzimanja, Osobno uručenje, Isporuka putem drugog pružatelja, Naknadno
// ispravljanje podataka, Potvrda o isporuci pošiljke). Vraća broj ili null.
function parseFixedEurFromRows_(rows, labelRegex) {
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (!row) { continue; }
    var labelIdx = -1;
    for (var i = 0; i < row.length; i++) {
      if (typeof row[i] === 'string' && labelRegex.test(row[i])) { labelIdx = i; break; }
    }
    if (labelIdx === -1) { continue; }
    for (var j = labelIdx + 1; j < row.length; j++) {
      var v = row[j];
      if (typeof v === 'number' && isFinite(v) && v >= 0) { return v; }
      if (typeof v === 'string') {
        var m = v.match(/([\d.,]+)\s*EUR/i);
        if (m) {
          var val = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
          if (!isNaN(val)) { return val; }
        }
      }
    }
  }
  return null;
}

// Port parseSezonskiPctFromRows() — sezonski dodatak, SIROVA DECIMALNA
// FRAKCIJA (ne tekst s %). Vraća frakciju ili null. (Primjena ostaje
// ugovorna odluka na klijent-strani — getSezonskiFrakcija() i dalje koristi
// ovu vrijednost SAMO kad je admin ručno uključio "iz cjenika" u Postavkama.)
function parseSezonskiPctFromRows_(rows) {
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (!row) { continue; }
    var labelIdx = -1;
    for (var i = 0; i < row.length; i++) {
      if (typeof row[i] === 'string' && /sezonski/i.test(row[i])) { labelIdx = i; break; }
    }
    if (labelIdx === -1) { continue; }
    for (var j = labelIdx + 1; j < row.length; j++) {
      var v = row[j];
      if (typeof v === 'number' && isFinite(v) && v >= 0) { return v; }
    }
  }
  return null;
}

// Port parseDodatakTezinaPctFromRows() — "Dodatak na težinu", zapisan kao
// tekst s % ("10,00 %") ili gol broj (frakcija 0.1 -> pretvara se u 10).
// Vraća POSTOTAK (ne frakciju) ili null.
function parseDodatakTezinaPctFromRows_(rows) {
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (!row) { continue; }
    var labelIdx = -1;
    for (var i = 0; i < row.length; i++) {
      if (typeof row[i] === 'string' && /dodatak.*te[zž]inu/i.test(row[i])) { labelIdx = i; break; }
    }
    if (labelIdx === -1) { continue; }
    for (var j = labelIdx + 1; j < row.length; j++) {
      var v = row[j];
      if (typeof v === 'number' && isFinite(v) && v >= 0) { return kalkR2_(v * 100); }
      if (typeof v === 'string') {
        var m = v.match(/([\d.,]+)\s*%/);
        if (m) {
          var pct = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
          if (!isNaN(pct)) { return pct; }
        }
      }
    }
  }
  return null;
}

// Port parseVolumenLockFromRows() — zaključavanje načina obračuna prema
// retku "Obračun volumenske težine". 'vol' = uvijek volumenska težina,
// 'nestandardna' = uvijek naknada za nestandardnu pošiljku (izričito "ne
// primjenjuje se"), null = redak nije pronađen (ručni izbor ostaje slobodan).
function parseVolumenLockFromRows_(rows) {
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (!row) { continue; }
    var labelIdx = -1;
    for (var i = 0; i < row.length; i++) {
      if (typeof row[i] === 'string' && /obra[cč]un.*volumensk/i.test(row[i])) { labelIdx = i; break; }
    }
    if (labelIdx === -1) { continue; }
    for (var j = labelIdx + 1; j < row.length; j++) {
      var v = row[j];
      if (typeof v === 'string' && v.trim() !== '') {
        if (/ne\s*primjenjuje\s*se/i.test(v)) { return 'nestandardna'; }
        return 'vol';
      }
      if (typeof v === 'number' && isFinite(v)) { return 'vol'; }
    }
  }
  return null;
}

// Port parseMaxKoletaFromRows() — "skrivena" postavka (bez teksta-labela u
// cjeniku, čita se FIKSNA ćelija D61, redak odmah ispod "Potvrda o isporuci
// pošiljke") koja govori je li broj koleta u pošiljci ograničen: prazno =
// neograničen, broj = ograničen na taj broj. Vraća {limited:true, value:N},
// {limited:false} (redak postoji ali je prazan -> neograničen), ili null
// (fajl uopće nema tog retka — starija/drugačija struktura).
function parseMaxKoletaFromRows_(rows) {
  if (!rows || rows.length < 61) { return null; }
  var row = rows[60]; // redak 61 (0-indeksirano)
  var cell = row ? row[3] : undefined; // stupac D (0-indeksirano: A=0, B=1, C=2, D=3)
  if (typeof cell === 'number' && isFinite(cell) && cell > 0) {
    return { limited: true, value: Math.round(cell) };
  }
  if (typeof cell === 'string' && cell.trim() !== '') {
    var n = parseFloat(cell.trim().replace(/\./g, '').replace(',', '.'));
    if (!isNaN(n) && n > 0) { return { limited: true, value: Math.round(n) }; }
  }
  return { limited: false };
}

// Pokreće svih 16 funkcija iznad nad ISTIM values nizom koji je već korišten
// za osnovnu tablicu cijena (parseKalkulatorCjenikRedaka_) i vraća jedan
// objekt spreman za JSON.stringify — pozvan iz ucitajKlijentovCjenikSDrivea_
// niže, sprema se u ADMIN_ONLY_FIELDS.kalkulator_postavke_json i šalje se
// klijentu kod prijave (kalkulatorKlijentPrijava).
function parsirajDodatneKalkulatorPostavke_(values) {
  return {
    nestandardnaPct: parseNestandardnaPctFromRows_(values),
    povratPct: parsePovratPctFromRows_(values),
    dodatakTezinaPct: parseDodatakTezinaPctFromRows_(values),
    volumenLock: parseVolumenLockFromRows_(values),
    smsCijena: parseSmsCijenaFromRows_(values),
    povratnicaCijena: parsePovratnicaCijenaFromRows_(values),
    otkupninaGotovina: parseOtkupninaFromRows_(values, /otkupnin.*gotovina/i),
    otkupninaKartica: parseOtkupninaFromRows_(values, /otkupnin.*kartica/i),
    iskazanaVrijednostPct: parseIskazanaVrijednostPctFromRows_(values),
    preuzimanjeCijena: parseFixedEurFromRows_(values, /poku[sš]aj.*preuzimanj/i),
    urucenjeCijena: parseFixedEurFromRows_(values, /osobno.*uru[cč]enj/i),
    drugiCijena: parseFixedEurFromRows_(values, /isporuka.*drugog.*pru[zž]atelj/i),
    ispravkaCijena: parseFixedEurFromRows_(values, /naknadn.*isprav/i),
    potvrdaCijena: parseFixedEurFromRows_(values, /potvrda.*isporuci/i),
    sezonskiPct: parseSezonskiPctFromRows_(values),
    maxKoletaLock: parseMaxKoletaFromRows_(values)
  };
}

// Vidi punu napomenu uz KALKULATOR_CJENIK_HR_CEKA_FOLDER_NAME gore — isti
// lijeni obrazac stvaranja/keširanja ID-a kao i arhiva folder ispod, samo
// se ova mapa NE prazni automatski nego ručno, u trenutku dodjele.
function getOrCreateKalkulatorCjenikHrCekaFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('KALKULATOR_CJENIK_HR_CEKA_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (err) { /* folder obrisan/nedostupan — stvori novi ispod */ }
  }
  var folder = DriveApp.createFolder(KALKULATOR_CJENIK_HR_CEKA_FOLDER_NAME);
  props.setProperty('KALKULATOR_CJENIK_HR_CEKA_FOLDER_ID', folder.getId());
  return folder;
}

function getOrCreateKalkulatorCjenikArhivaFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('KALKULATOR_CJENIK_ARHIVA_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (err) { /* folder obrisan/nedostupan — stvori novi ispod */ }
  }
  var folder = DriveApp.createFolder(KALKULATOR_CJENIK_ARHIVA_FOLDER_NAME);
  props.setProperty('KALKULATOR_CJENIK_ARHIVA_FOLDER_ID', folder.getId());
  return folder;
}

function getOrCreateKalkulatorCjenikArhivaLogSheet_() {
  var files = DriveApp.getFilesByName(KALKULATOR_CJENIK_ARHIVA_SHEET_NAME);
  var ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(KALKULATOR_CJENIK_ARHIVA_SHEET_NAME);
    var sheet = ss.getSheets()[0];
    var header = ['Datum', 'NazivDatoteke', 'Razlog', 'BrojKategorija', 'DriveFileId'];
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return ss.getSheets()[0];
}

// Best effort, isti obrazac kao arhivirajZoneDatoteku_ — greška ovdje ne
// smije blokirati glavni upload/restore.
function arhivirajKalkulatorCjenikDatoteku_(blob, filename, razlog, brojKategorija) {
  try {
    var folder = getOrCreateKalkulatorCjenikArhivaFolder_();
    var kopija = folder.createFile(blob.copyBlob());
    var logSheet = getOrCreateKalkulatorCjenikArhivaLogSheet_();
    logSheet.appendRow([
      new Date(),
      filename || 'cjenik.xlsx',
      razlog || '',
      brojKategorija || 0,
      kopija.getId()
    ]);
  } catch (err) {
    // Ne blokira glavnu radnju.
  }
}

// Admin-only: trenutno aktivan zadani cjenovnik + kad/tko/zašto je zadnje
// promijenjen — informativni prikaz u adminu.
function adminKalkulatorCjenikStatus(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var props = PropertiesService.getScriptProperties();
  var sirovi = props.getProperty('KALKULATOR_CJENIK_JSON');
  var cjenik = [];
  if (sirovi) {
    try { cjenik = JSON.parse(sirovi); } catch (e) { cjenik = []; }
  }
  return {
    status: 'ok',
    cjenik: cjenik,
    brojKategorija: cjenik.length,
    datum: props.getProperty('KALKULATOR_CJENIK_DATUM') || '',
    naziv: props.getProperty('KALKULATOR_CJENIK_NAZIV') || '',
    razlog: props.getProperty('KALKULATOR_CJENIK_RAZLOG') || ''
  };
}

// Prima base64-kodirani .xlsx, pretvara ga u privremeni Google Sheet (isti
// obrazac kao adminZoneUpload/OB tablica), parsira preko
// parseKalkulatorCjenikRedaka_, i — ako je pronađen barem jedan valjan
// redak — u cijelosti ZAMJENJUJE trenutno aktivan zadani cjenovnik (Script
// Properties) novim, uz točan datum/vrijeme (do sekunde) i OBAVEZAN
// razlog. Stara vrijednost se ne gubi — svaki upload prije zamjene
// (implicitno, kroz činjenicu da se ovaj upload sam arhivira) ostaje
// dostupan u arhivi ispod. Razlog je obavezan (Sašin izričit zahtjev).
function adminKalkulatorCjenikUpload(token, base64Data, filename, razlog) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  if (!base64Data) { return { status: 'error', message: 'Nedostaje datoteka za slanje.' }; }
  razlog = String(razlog || '').trim();
  if (!razlog) { return { status: 'error', message: 'Razlog promjene cjenovnika je obavezan.' }; }
  var tempFileId;
  try {
    var bytes = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(bytes, MimeType.MICROSOFT_EXCEL, filename || 'cjenik.xlsx');
    tempFileId = pretvoriXlsxUSheet_(blob);
    var tempSs = SpreadsheetApp.openById(tempFileId);
    var tempSheet = tempSs.getSheets()[0];
    var lastRow = tempSheet.getLastRow();
    var lastCol = tempSheet.getLastColumn();
    if (lastRow < 1 || lastCol < 1) { return { status: 'error', message: 'Tablica izgleda prazno.' }; }
    var values = tempSheet.getRange(1, 1, lastRow, lastCol).getValues();
    var cjenik = parseKalkulatorCjenikRedaka_(values);
    if (!cjenik.length) { return { status: 'error', message: 'Nije prepoznat nijedan redak cjenovnika (očekuje se ćelija s oznakom "X kg" i tri cijene odmah uz nju, za tri zone).' }; }

    var props = PropertiesService.getScriptProperties();
    var sadaFormatiran = Utilities.formatDate(new Date(), 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm:ss');
    props.setProperty('KALKULATOR_CJENIK_JSON', JSON.stringify(cjenik));
    props.setProperty('KALKULATOR_CJENIK_DATUM', sadaFormatiran);
    props.setProperty('KALKULATOR_CJENIK_NAZIV', filename || '');
    props.setProperty('KALKULATOR_CJENIK_RAZLOG', razlog);

    arhivirajKalkulatorCjenikDatoteku_(blob, filename, razlog, cjenik.length);

    return { status: 'ok', brojKategorija: cjenik.length, datum: sadaFormatiran };
  } catch (err) {
    return { status: 'error', message: 'Obrada cjenovnika nije uspjela: ' + err.message };
  } finally {
    if (tempFileId) {
      try { DriveApp.getFileById(tempFileId).setTrashed(true); } catch (e2) { /* ne blokira odgovor ako brisanje ne uspije */ }
    }
  }
}

// Admin-only: popis svih arhiviranih verzija zadanog cjenovnika, najnoviji
// prvi — datum, naziv datoteke, razlog promjene i broj prepoznatih
// kategorija za svaku.
function adminKalkulatorCjenikArhivaList(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var sheet = getOrCreateKalkulatorCjenikArhivaLogSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'ok', entries: [] }; }
  var data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  var entries = [];
  for (var i = 0; i < data.length; i++) {
    var fileId = String(data[i][4] || '').trim();
    if (!fileId) { continue; }
    entries.push({
      datum: Utilities.formatDate(new Date(data[i][0]), 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm:ss'),
      naziv: data[i][1],
      razlog: data[i][2],
      brojKategorija: parseInt(data[i][3], 10) || 0,
      fileId: fileId
    });
  }
  entries.reverse();
  return { status: 'ok', entries: entries };
}

// Admin-only: vraća arhiviranu .xlsx datoteku kao trenutno aktivan zadani
// cjenovnik — čita arhiviranu datoteku i poziva adminKalkulatorCjenikUpload()
// s njom (ista validacija/upis/arhiviranje kao svaki drugi upload — dakle i
// sâm restore odmah stvara svoj novi zapis u arhivi). Traži NOVI razlog
// (zašto se vraća starija verzija) — svaka promjena, uključivo restore,
// mora imati svoj razlog.
function adminKalkulatorCjenikArhivaRestore(token, fileId, razlog) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  fileId = String(fileId || '').trim();
  if (!fileId) { return { status: 'error', message: 'Nedostaje ID arhivirane datoteke.' }; }
  try {
    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    var base64Data = Utilities.base64Encode(blob.getBytes());
    return adminKalkulatorCjenikUpload(token, base64Data, file.getName(), razlog);
  } catch (err) {
    return { status: 'error', message: 'Vraćanje arhivirane verzije nije uspjelo: ' + err.message };
  }
}

// Admin-only: trajno briše JEDAN zapis iz arhive zadanog cjenovnika (Sašin
// izričit zahtjev, 27.9.2026. — "da mogu obrisati zapise neke u arhivi").
// Briše i redak iz log-sheeta i samu arhiviranu .xlsx kopiju na Disku
// (best-effort — ako brisanje datoteke na Disku ne uspije, redak u logu se
// SVEJEDNO briše, isto kao što arhiviranje nikad ne smije blokirati glavnu
// radnju). NE dira trenutno aktivan zadani cjenovnik (Script Properties) —
// taj živi posve neovisno o ovom log-sheetu, pa brisanje bilo kojeg,
// uključivo i najnovijeg, arhivskog zapisa NIKAD ne mijenja što kalkulator
// na naslovnici trenutno koristi.
function adminKalkulatorCjenikArhivaDelete(token, fileId) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  fileId = String(fileId || '').trim();
  if (!fileId) { return { status: 'error', message: 'Nedostaje ID arhivirane datoteke.' }; }
  var sheet = getOrCreateKalkulatorCjenikArhivaLogSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'error', message: 'Arhiva je prazna.' }; }
  var data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  var pronadjenRedak = -1;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][4] || '').trim() === fileId) { pronadjenRedak = i + 2; break; }
  }
  if (pronadjenRedak === -1) { return { status: 'error', message: 'Zapis više ne postoji (možda je već obrisan).' }; }
  sheet.deleteRow(pronadjenRedak);
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (errFile) { /* datoteka možda već ručno obrisana — ne blokira */ }
  return { status: 'ok' };
}

// ============================================================
// "NAPOMENE" — zadnja pod-kartica u adminskoj kartici "🧮 Kalkulator" (Sašin
// izričit zahtjev, 27.9.2026.): slobodne interne bilješke, svaka sa svojom
// bojom slova, koje admin sam dodaje i briše. Isključivo interno (nema javne
// akcije) — ne prikazuje se nikome osim adminu, sličan princip kao "Interna
// napomena" po klijentu, samo ovdje neovisno o pojedinom zapisu, vezano uz
// samu karticu Kalkulator. Zaseban Sheet, isti obrazac kao FAQ/Zone arhiva.
// ============================================================
var KALKULATOR_NAPOMENE_SHEET_NAME = 'InTime_Kalkulator_Napomene';

function getOrCreateKalkulatorNapomeneSheet_() {
  var files = DriveApp.getFilesByName(KALKULATOR_NAPOMENE_SHEET_NAME);
  var ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(KALKULATOR_NAPOMENE_SHEET_NAME);
    var sheet = ss.getSheets()[0];
    sheet.appendRow(['Datum', 'Tekst', 'Boja']);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return ss.getSheets()[0];
}

function adminKalkulatorNapomenaList(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var sheet = getOrCreateKalkulatorNapomeneSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'ok', entries: [] }; }
  var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var entries = [];
  for (var i = 0; i < data.length; i++) {
    if (!String(data[i][1] || '').trim()) { continue; }
    entries.push({
      rowIndex: i + 2,
      datum: formatirajSheetVrijednost_(data[i][0]),
      tekst: data[i][1],
      boja: data[i][2] || '#131313'
    });
  }
  entries.reverse(); // najnovija napomena prva
  return { status: 'ok', entries: entries };
}

function adminKalkulatorNapomenaDodaj(token, tekst, boja) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  tekst = String(tekst || '').trim();
  if (!tekst) { return { status: 'error', message: 'Tekst napomene je obavezan.' }; }
  boja = String(boja || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(boja)) { boja = '#131313'; }
  var sheet = getOrCreateKalkulatorNapomeneSheet_();
  sheet.appendRow([new Date(), tekst, boja]);
  return { status: 'ok', rowIndex: sheet.getLastRow() };
}

function adminKalkulatorNapomenaObrisi(token, rowIndex) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateKalkulatorNapomeneSheet_();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Napomena više ne postoji (možda je već obrisana).' }; }
  sheet.deleteRow(rowIndex);
  return { status: 'ok' };
}

// JAVNA akcija (bez tokena) — trenutni zadani cjenovnik, dohvaćen pri
// učitavanju InTime_KalkulatorCijena.html. Prazan niz ("cjenik: []") znači
// da admin još nikad ništa nije uploadao — stranica tada zadržava svoj
// ugrađeni cjenovnik iz builda, nepromijenjeno ponašanje (vidi kod na dnu
// InTime_KalkulatorCijena.html koji ovo poziva).
function kalkulatorZadaniCjenikJavno() {
  var props = PropertiesService.getScriptProperties();
  var sirovi = props.getProperty('KALKULATOR_CJENIK_JSON');
  var cjenik = [];
  if (sirovi) {
    try { cjenik = JSON.parse(sirovi); } catch (e) { cjenik = []; }
  }
  return { status: 'ok', cjenik: cjenik, datum: props.getProperty('KALKULATOR_CJENIK_DATUM') || '' };
}

// ============================================================================
// KALKULATOR — PRISTUP PO KLIJENTU (30.9.2026., Sašin izričit zahtjev)
// ----------------------------------------------------------------------------
// Svaki klijent kojem Saša dodijeli SVOJ cjenik (postojeće fiksno polje
// "Cjenik Hrvatska" kod slanja ponude, ADMIN_ONLY_FIELDS.dokument_cjenik_hrvatska)
// dobiva svoj zaseban login za javni kalkulator na stranici — korisničko ime
// je OB korisničko ime (ADMIN_ONLY_FIELDS.ob_username), lozinka se generira
// automatski. Nakon prijave kalkulator učitava ISKLJUČIVO klijentov vlastiti
// cjenik (parsiran istim parserom kao zadani/globalni cjenik) — klijent NEMA
// mogućnost učitati ikoji drugi cjenik. Vidi
// adminDodijeliKalkulatorPristup/adminUkloniKalkulatorPristup/
// adminDohvatiKalkulatorKorisnike (admin akcije) i kalkulatorKlijentPrijava
// (javna akcija, poziva je InTime_KalkulatorCijena.html).
// ============================================================================

// 100 imena superheroja (DC, Marvel i Disney) za generator lozinki — Sašin
// izričit zahtjev (30.9.2026., "kad već predlažeš napravi listu od 100
// junaka DC Marvel i ostali Disney"). Namjerno BEZ razmaka/dijakritike u
// svakom imenu (CamelCase gdje je ime iz dvije riječi) — ulazi izravno u
// lozinku kao jedan komad teksta.
var KALKULATOR_SUPERHEROJI_ = [
  // DC (25)
  'Batman', 'Superman', 'WonderWoman', 'Flash', 'Aquaman', 'GreenLantern', 'Cyborg', 'Shazam',
  'GreenArrow', 'Batgirl', 'Supergirl', 'Nightwing', 'Robin', 'Batwoman', 'MartianManhunter',
  'BlackCanary', 'Zatanna', 'Raven', 'Starfire', 'BeastBoy', 'Hawkgirl', 'Hawkman', 'Catwoman',
  'Huntress', 'Static',
  // Marvel (35)
  'IronMan', 'CaptainAmerica', 'Thor', 'Hulk', 'BlackWidow', 'Hawkeye', 'SpiderMan', 'BlackPanther',
  'DoctorStrange', 'AntMan', 'Wasp', 'CaptainMarvel', 'ScarletWitch', 'Vision', 'Falcon',
  'WinterSoldier', 'StarLord', 'Gamora', 'Drax', 'Rocket', 'Groot', 'Nebula', 'Deadpool',
  'Wolverine', 'ProfessorX', 'Cyclops', 'JeanGrey', 'Storm', 'Nightcrawler', 'Colossus',
  'Daredevil', 'Punisher', 'LukeCage', 'IronFist', 'Magneto',
  // Disney (40)
  'MickeyMouse', 'MinnieMouse', 'DonaldDuck', 'DaisyDuck', 'Goofy', 'Pluto', 'Simba', 'Mufasa',
  'Elsa', 'Anna', 'Olaf', 'Moana', 'Maui', 'Aladdin', 'Jasmine', 'Genie', 'Ariel', 'Belle',
  'BeastPrince', 'Mulan', 'Tiana', 'Rapunzel', 'Flynn', 'Pocahontas', 'Hercules', 'Megara',
  'Stitch', 'Lilo', 'WinnieThePooh', 'Tigger', 'Piglet', 'Woody', 'BuzzLightyear', 'Jessie',
  'Nemo', 'Dory', 'Remy', 'Baymax', 'Elastigirl', 'MrIncredible'
];

// Generira lozinku za kalkulator po Sašinoj formuli: [datum otvaranja OB-a,
// ddMMyyyy] + [nasumično ime superheroja] + [prva 2 slova naziva tvrtke,
// velika slova] + "!". `datumOtvaranjaOb` može biti Date objekt ili prazno
// (tad se koristi današnji datum, uz upozorenje koje poziva funkcija može
// prikazati). Vraća {lozinka, superheroj} — superheroj se vraća zasebno
// samo za eventualni prikaz/podršku, sama lozinka već sadrži njegovo ime.
function generirajKalkulatorLozinku_(datumOtvaranjaOb, naziv) {
  var datum = (datumOtvaranjaOb instanceof Date) ? datumOtvaranjaOb : new Date();
  var datumStr = Utilities.formatDate(datum, 'Europe/Zagreb', 'ddMMyyyy');
  var superheroj = KALKULATOR_SUPERHEROJI_[Math.floor(Math.random() * KALKULATOR_SUPERHEROJI_.length)];
  var slova = String(naziv || '').trim().replace(/[^\p{L}]/gu, '').substring(0, 2).toUpperCase();
  if (!slova) { slova = 'XX'; }
  return { lozinka: datumStr + superheroj + slova + '!', superheroj: superheroj };
}

// Skida .xlsx datoteku s Drivea (po ID-u) i parsira je ISTIM parserom kao
// zadani/globalni cjenik (parseKalkulatorCjenikRedaka_) — isti obrazac kao
// adminKalkulatorCjenikUpload gore, samo izvor nije base64 iz uploada nego
// već postojeća datoteka na Driveu (ADMIN_ONLY_FIELDS.dokument_cjenik_hrvatska).
// Vraća {cjenik, naziv} ili baca grešku s porukom razumljivom adminu.
function ucitajKlijentovCjenikSDrivea_(fileId) {
  var tempFileId;
  try {
    var izvorFile = DriveApp.getFileById(fileId);
    var blob = izvorFile.getBlob();
    tempFileId = pretvoriXlsxUSheet_(blob);
    var tempSs = SpreadsheetApp.openById(tempFileId);
    var tempSheet = tempSs.getSheets()[0];
    var lastRow = tempSheet.getLastRow();
    var lastCol = tempSheet.getLastColumn();
    if (lastRow < 1 || lastCol < 1) { throw new Error('Tablica izgleda prazno.'); }
    var values = tempSheet.getRange(1, 1, lastRow, lastCol).getValues();
    var cjenik = parseKalkulatorCjenikRedaka_(values);
    if (!cjenik.length) { throw new Error('Nije prepoznat nijedan redak cjenovnika (očekuje se ćelija s oznakom "X kg" i tri cijene odmah uz nju, za tri zone).'); }
    // NOVO (30.9.2026., nastavak istog dana) — vidi parsirajDodatneKalkulatorPostavke_
    // gore: istim values nizom čita se i svih 16 dodatnih "skrivenih" postavki
    // (ugovoreni %, fiksne naknade, zaključavanja i sl.), ne samo osnovna tablica.
    var postavke = parsirajDodatneKalkulatorPostavke_(values);
    return { cjenik: cjenik, naziv: izvorFile.getName(), postavke: postavke };
  } finally {
    if (tempFileId) {
      try { DriveApp.getFileById(tempFileId).setTrashed(true); } catch (e2) { /* ne blokira odgovor ako brisanje ne uspije */ }
    }
  }
}

// Ista obrada kao ucitajKlijentovCjenikSDrivea_ gore, samo iz direktno
// uploadanog bloba (base64 iz preglednika) umjesto postojeće Drive datoteke
// — vidi adminKalkulatorCjenikKlijentUpload niže (1.10.2026., dvadeset i
// drugi krug, neovisni upload cjenika).
function ucitajKlijentovCjenikIzBloba_(blob, filename) {
  var tempFileId;
  try {
    tempFileId = pretvoriXlsxUSheet_(blob);
    var tempSs = SpreadsheetApp.openById(tempFileId);
    var tempSheet = tempSs.getSheets()[0];
    var lastRow = tempSheet.getLastRow();
    var lastCol = tempSheet.getLastColumn();
    if (lastRow < 1 || lastCol < 1) { throw new Error('Tablica izgleda prazno.'); }
    var values = tempSheet.getRange(1, 1, lastRow, lastCol).getValues();
    var cjenik = parseKalkulatorCjenikRedaka_(values);
    if (!cjenik.length) { throw new Error('Nije prepoznat nijedan redak cjenovnika (očekuje se ćelija s oznakom "X kg" i tri cijene odmah uz nju, za tri zone).'); }
    var postavke = parsirajDodatneKalkulatorPostavke_(values);
    return { cjenik: cjenik, naziv: filename || 'cjenik.xlsx', postavke: postavke };
  } finally {
    if (tempFileId) {
      try { DriveApp.getFileById(tempFileId).setTrashed(true); } catch (e2) { /* ne blokira odgovor ako brisanje ne uspije */ }
    }
  }
}

// Zaseban Sheet za arhivu POJEDINAČNIH klijentskih cjenovnika (1.10.2026.,
// dvadeset i drugi krug) — vidi napomenu uz
// KALKULATOR_CJENIK_KLIJENT_ARHIVA_SHEET_NAME gore. 'ID' stupac (UUID) je
// stabilan identifikator za restore/delete — NE koristi se redni broj retka
// (taj se pomiče kod brisanja).
function getOrCreateKalkulatorCjenikKlijentArhivaSheet_() {
  var files = DriveApp.getFilesByName(KALKULATOR_CJENIK_KLIJENT_ARHIVA_SHEET_NAME);
  var ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(KALKULATOR_CJENIK_KLIJENT_ARHIVA_SHEET_NAME);
    var sheet = ss.getSheets()[0];
    var header = ['ID', 'Datum arhiviranja', 'Korisničko ime', 'Naziv tvrtke', 'Naziv datoteke', 'Prvotni datum dodjele', 'Razlog zamjene', 'Cjenik JSON', 'Postavke JSON'];
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return ss.getSheets()[0];
}

// Best effort, isti obrazac kao arhivirajZoneDatoteku_/
// arhivirajKalkulatorCjenikDatoteku_ — greška ovdje ne smije blokirati
// glavnu radnju (upload/restore novog cjenika).
function arhivirajKalkulatorCjenikKlijenta_(korisnickoIme, nazivTvrtke, nazivDatoteke, prvotniDatum, razlogZamjene, cjenikJson, postavkeJson) {
  try {
    var sheet = getOrCreateKalkulatorCjenikKlijentArhivaSheet_();
    sheet.appendRow([
      Utilities.getUuid(), new Date(), korisnickoIme || '', nazivTvrtke || '', nazivDatoteke || '',
      prvotniDatum || '', razlogZamjene || '', cjenikJson || '[]', postavkeJson || '{}'
    ]);
  } catch (err) { /* ne blokira glavnu radnju */ }
}

// Admin-only: NEOVISNI upload novog cjenika za JEDNOG VEĆ POSTOJEĆEG klijenta
// kalkulatora (1.10.2026., dvadeset i drugi krug, Sašin izričit zahtjev —
// "na oba mjesta mora biti polje gdje se stavlja novi cjenik koji će
// učitati, nemoj da bude vezano samo za ono polje kod ponude... tamo smo
// stavili cjenik koji je bio vezan za ponudu... a kasnije... moram moći
// učitati cjenik... onaj neka ostane vezan za ponudu"). Za razliku od
// adminDodijeliKalkulatorPristup (koja UVIJEK čita priloženi "Cjenik
// Hrvatska" dokument vezan za PONUDU), ova funkcija prima .xlsx izravno iz
// preglednika (base64) — potpuno neovisno o bloku "Dokumenti za ponudu".
// Trenutni cjenik klijenta (ako postoji) AUTOMATSKI se arhivira PRIJE
// zamjene (arhivirajKalkulatorCjenikKlijenta_) — ništa se ne gubi, vidi
// adminKalkulatorCjenikKlijentArhivaList/Restore niže za vraćanje.
function adminKalkulatorCjenikKlijentUpload(token, rowIndex, base64Data, filename, razlog) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  if (!base64Data) { return { status: 'error', message: 'Nedostaje datoteka za slanje.' }; }
  razlog = String(razlog || '').trim();
  if (!razlog) { return { status: 'error', message: 'Napomena o promjeni cjenika je obavezna.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  try {
    var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
    var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
    var citaj_ = function(label) { var idx = header.indexOf(label); return (idx !== -1) ? String(row[idx] || '').trim() : ''; };

    var korisnickoIme = citaj_(ADMIN_ONLY_FIELDS.kalkulator_korisnicko_ime);
    if (!korisnickoIme) {
      return { status: 'error', message: 'Klijent još nema pristup kalkulatoru — prvo dodijelite pristup gumbom "🧮 Dodijeli cjenik u kalkulator".' };
    }
    var nazivTvrtke = citaj_('Naziv tvrtke');

    var bytes = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(bytes, MimeType.MICROSOFT_EXCEL, filename || 'cjenik.xlsx');
    var ucitano = ucitajKlijentovCjenikIzBloba_(blob, filename);

    // Arhiviraj TRENUTNI cjenik klijenta (ako postoji) prije zamjene.
    var postojeciCjenikJson = citaj_(ADMIN_ONLY_FIELDS.kalkulator_cjenik_json);
    if (postojeciCjenikJson) {
      arhivirajKalkulatorCjenikKlijenta_(
        korisnickoIme, nazivTvrtke,
        citaj_(ADMIN_ONLY_FIELDS.kalkulator_cjenik_naziv_datoteke),
        citaj_(ADMIN_ONLY_FIELDS.kalkulator_cjenik_datum),
        razlog, postojeciCjenikJson, citaj_(ADMIN_ONLY_FIELDS.kalkulator_postavke_json)
      );
    }

    var sadaFormatiran = Utilities.formatDate(new Date(), 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm:ss');
    var upisi_ = function(polje, vrijednost) {
      var idx = header.indexOf(ADMIN_ONLY_FIELDS[polje]);
      if (idx === -1) { return; }
      sheet.getRange(rowIndex, idx + 1).setValue(vrijednost);
    };
    upisi_('kalkulator_cjenik_json', JSON.stringify(ucitano.cjenik));
    upisi_('kalkulator_cjenik_naziv_datoteke', ucitano.naziv);
    upisi_('kalkulator_cjenik_datum', sadaFormatiran);
    upisi_('kalkulator_postavke_json', JSON.stringify(ucitano.postavke || {}));

    // Isti unificirani log kao i "⟳ Osvježi cjenik"/"🔁 Nova lozinka" —
    // vrsta 'Promjena cjenika', vidljivo u "📋 Evidencija" (uključivo i
    // filtrirani prikaz "po klijentu").
    try {
      var evSheetLog_ = getOrCreateKalkulatorEvidencijaSheet_();
      evSheetLog_.appendRow([
        sadaFormatiran, 'Promjena cjenika', citaj_('Identifikacijski TM broj klijenta (admin)'),
        nazivTvrtke, korisnickoIme, '', '', String(razlog).trim().slice(0, 500), ''
      ]);
    } catch (errEvid) { /* ne blokira odgovor */ }

    return { status: 'ok', nazivDatoteke: ucitano.naziv, datum: sadaFormatiran, brojKategorija: ucitano.cjenik.length };
  } catch (err) {
    return { status: 'error', message: 'Obrada cjenovnika nije uspjela: ' + err.message };
  }
}

// Admin-only: popis arhiviranih verzija cjenika JEDNOG klijenta (filtrirano
// po korisničkom imenu — jedinstveno po klijentu), najnoviji prvi.
function adminKalkulatorCjenikKlijentArhivaList(token, korisnickoIme) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  korisnickoIme = String(korisnickoIme || '').trim().toLowerCase();
  if (!korisnickoIme) { return { status: 'error', message: 'Nedostaje korisničko ime.' }; }
  try {
    var sheet = getOrCreateKalkulatorCjenikKlijentArhivaSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) { return { status: 'ok', entries: [] }; }
    var data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
    var entries = [];
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][2] || '').trim().toLowerCase() !== korisnickoIme) { continue; }
      var brojKategorija = 0;
      try { brojKategorija = (JSON.parse(data[i][7] || '[]') || []).length; } catch (eParseBroj) { brojKategorija = 0; }
      entries.push({
        id: data[i][0],
        datumArhiviranja: Utilities.formatDate(new Date(data[i][1]), 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm:ss'),
        nazivDatoteke: data[i][4],
        prvotniDatumDodjele: data[i][5],
        razlogZamjene: data[i][6],
        brojKategorija: brojKategorija
      });
    }
    entries.reverse();
    return { status: 'ok', entries: entries };
  } catch (err) {
    return { status: 'error', message: 'Dohvat arhive nije uspio: ' + err.message };
  }
}

// Admin-only: vraća arhiviranu verziju cjenika kao trenutno aktivan cjenik
// OVOG klijenta. Isto kao upload — trenutni cjenik (onaj koji se OVIM
// vraćanjem zamjenjuje) se SAM arhivira prije prepisivanja, ništa se ne
// gubi, i upisuje se u isti unificirani "Promjena cjenika" log.
function adminKalkulatorCjenikKlijentArhivaRestore(token, rowIndex, arhivId, razlog) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  arhivId = String(arhivId || '').trim();
  if (!arhivId) { return { status: 'error', message: 'Nedostaje ID arhiviranog zapisa.' }; }
  razlog = String(razlog || '').trim();
  if (!razlog) { return { status: 'error', message: 'Napomena o vraćanju cjenika iz arhive je obavezna.' }; }
  var upitiSheet = getOrCreateUpitiSheet();
  if (rowIndex > upitiSheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  try {
    var arhivaSheet = getOrCreateKalkulatorCjenikKlijentArhivaSheet_();
    var lastRow = arhivaSheet.getLastRow();
    if (lastRow < 2) { return { status: 'error', message: 'Arhiva je prazna.' }; }
    var data = arhivaSheet.getRange(2, 1, lastRow - 1, 9).getValues();
    var pronadjeno = null;
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0] || '').trim() === arhivId) { pronadjeno = data[i]; break; }
    }
    if (!pronadjeno) { return { status: 'error', message: 'Arhivirani zapis više ne postoji (možda je obrisan).' }; }

    var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
    var lastCol = Math.min(upitiSheet.getLastColumn(), ocekivanoZaglavlje.length);
    var header = upitiSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var row = upitiSheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
    var citaj_ = function(label) { var idx = header.indexOf(label); return (idx !== -1) ? String(row[idx] || '').trim() : ''; };
    var korisnickoIme = citaj_(ADMIN_ONLY_FIELDS.kalkulator_korisnicko_ime);
    if (!korisnickoIme) { return { status: 'error', message: 'Klijent nema pristup kalkulatoru.' }; }
    var nazivTvrtke = citaj_('Naziv tvrtke');

    // Arhiviraj TRENUTNI cjenik (onaj koji se sad prepisuje) prije vraćanja.
    var postojeciCjenikJson = citaj_(ADMIN_ONLY_FIELDS.kalkulator_cjenik_json);
    if (postojeciCjenikJson) {
      arhivirajKalkulatorCjenikKlijenta_(
        korisnickoIme, nazivTvrtke,
        citaj_(ADMIN_ONLY_FIELDS.kalkulator_cjenik_naziv_datoteke),
        citaj_(ADMIN_ONLY_FIELDS.kalkulator_cjenik_datum),
        'Automatski arhivirano prije vraćanja starije verzije — ' + razlog,
        postojeciCjenikJson, citaj_(ADMIN_ONLY_FIELDS.kalkulator_postavke_json)
      );
    }

    var sadaFormatiran = Utilities.formatDate(new Date(), 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm:ss');
    var nazivVraceno = String(pronadjeno[4] || 'cjenik.xlsx') + ' (vraćeno iz arhive)';
    var upisi_ = function(polje, vrijednost) {
      var idx = header.indexOf(ADMIN_ONLY_FIELDS[polje]);
      if (idx === -1) { return; }
      upitiSheet.getRange(rowIndex, idx + 1).setValue(vrijednost);
    };
    upisi_('kalkulator_cjenik_json', pronadjeno[7] || '[]');
    upisi_('kalkulator_cjenik_naziv_datoteke', nazivVraceno);
    upisi_('kalkulator_cjenik_datum', sadaFormatiran);
    upisi_('kalkulator_postavke_json', pronadjeno[8] || '{}');

    try {
      var evSheetLog_ = getOrCreateKalkulatorEvidencijaSheet_();
      evSheetLog_.appendRow([
        sadaFormatiran, 'Promjena cjenika', citaj_('Identifikacijski TM broj klijenta (admin)'),
        nazivTvrtke, korisnickoIme, '', '', ('Vraćeno iz arhive: ' + razlog).slice(0, 500), ''
      ]);
    } catch (errEvid) { /* ne blokira odgovor */ }

    var brojKategorija = 0;
    try { brojKategorija = (JSON.parse(pronadjeno[7] || '[]') || []).length; } catch (eParseBroj2) { brojKategorija = 0; }
    return { status: 'ok', nazivDatoteke: nazivVraceno, datum: sadaFormatiran, brojKategorija: brojKategorija };
  } catch (err) {
    return { status: 'error', message: 'Vraćanje iz arhive nije uspjelo: ' + err.message };
  }
}

// Admin-only: trajno briše JEDAN zapis iz arhive cjenika klijenta (Sašin
// izričit zahtjev — "promjene se mogu brisati samo uz šifru admina" — admin
// lozinka se traži NA KLIJENTSKOJ STRANI, preko openAdminPasswordConfirmModal,
// PRIJE ovog poziva, isti obrazac kao svugdje drugdje u ovom sustavu). NE
// dira trenutno aktivan cjenik klijenta (Sheet) — taj živi posve neovisno o
// ovoj arhivi, pa brisanje bilo kojeg, uključivo i najnovijeg, arhivskog
// zapisa NIKAD ne mijenja što klijent trenutno koristi u kalkulatoru.
function adminKalkulatorCjenikKlijentArhivaDelete(token, arhivId) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  arhivId = String(arhivId || '').trim();
  if (!arhivId) { return { status: 'error', message: 'Nedostaje ID arhiviranog zapisa.' }; }
  try {
    var sheet = getOrCreateKalkulatorCjenikKlijentArhivaSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) { return { status: 'error', message: 'Arhiva je prazna.' }; }
    var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var pronadjeniRedak = -1;
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0] || '').trim() === arhivId) { pronadjeniRedak = i + 2; break; }
    }
    if (pronadjeniRedak === -1) { return { status: 'error', message: 'Zapis više ne postoji (možda je već obrisan).' }; }
    sheet.deleteRow(pronadjeniRedak);
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: 'Brisanje nije uspjelo: ' + err.message };
  }
}

// Admin-only: dodjeljuje/osvježava pristup kalkulatoru za jednog klijenta.
// Čita trenutno prikvačenu "Cjenik Hrvatska" datoteku (mora već biti
// priložena — vidi ADMIN_ONLY_FIELDS.dokument_cjenik_hrvatska), parsira je i
// sprema PO KLIJENTU. Korisničko ime/lozinka se generiraju SAMO prvi put (ili
// kad je regenerirajLozinku=true) — obična ponovna dodjela (npr. nakon što
// Saša zamijeni Excel novijom verzijom) samo osvježava cjenik, klijent
// zadržava već izdane pristupne podatke.
function adminDodijeliKalkulatorPristup(token, rowIndex, regenerirajLozinku, razlog) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  try {
    var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
    var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];

    var cjenikHrCol = header.indexOf(ADMIN_ONLY_FIELDS.dokument_cjenik_hrvatska);
    var cjenikHrSirovo = (cjenikHrCol !== -1) ? row[cjenikHrCol] : '';
    var cjenikHr = null;
    if (cjenikHrSirovo) { try { cjenikHr = JSON.parse(cjenikHrSirovo); } catch (eParse) { cjenikHr = null; } }
    if (!cjenikHr || !cjenikHr.id) {
      return { status: 'error', message: 'Prvo priložite "Cjenik Hrvatska" dokument za ovog klijenta (blok "Dokumenti za ponudu").' };
    }

    var obUsernameCol = header.indexOf(ADMIN_ONLY_FIELDS.ob_username);
    var obUsername = (obUsernameCol !== -1) ? String(row[obUsernameCol] || '').trim() : '';
    if (!obUsername) {
      return { status: 'error', message: 'Prvo popunite "OB korisničko ime" — koristi se kao korisničko ime za kalkulator.' };
    }

    var ucitano;
    try {
      ucitano = ucitajKlijentovCjenikSDrivea_(cjenikHr.id);
    } catch (errCjenik) {
      return { status: 'error', message: 'Obrada cjenovnika nije uspjela: ' + errCjenik.message };
    }

    var lozinkaCol = header.indexOf(ADMIN_ONLY_FIELDS.kalkulator_lozinka);
    var postojecaLozinka = (lozinkaCol !== -1) ? String(row[lozinkaCol] || '').trim() : '';
    var lozinka = postojecaLozinka;
    if (!postojecaLozinka || regenerirajLozinku === true) {
      var datumOtvaranjaObCol = header.indexOf(ADMIN_ONLY_FIELDS.datum_otvaranja_ob);
      var datumOtvaranjaObVrijednost = (datumOtvaranjaObCol !== -1) ? row[datumOtvaranjaObCol] : null;
      var nazivCol = header.indexOf('Naziv tvrtke');
      var naziv = (nazivCol !== -1) ? String(row[nazivCol] || '').trim() : '';
      var generirano = generirajKalkulatorLozinku_(datumOtvaranjaObVrijednost, naziv);
      lozinka = generirano.lozinka;
    }

    var sadaFormatiran = Utilities.formatDate(new Date(), 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm:ss');
    var upisi_ = function(polje, vrijednost) {
      var idx = header.indexOf(ADMIN_ONLY_FIELDS[polje]);
      if (idx === -1) { return; }
      sheet.getRange(rowIndex, idx + 1).setValue(vrijednost);
    };
    upisi_('kalkulator_korisnicko_ime', obUsername);
    upisi_('kalkulator_lozinka', lozinka);
    upisi_('kalkulator_cjenik_json', JSON.stringify(ucitano.cjenik));
    upisi_('kalkulator_cjenik_naziv_datoteke', ucitano.naziv);
    upisi_('kalkulator_cjenik_datum', sadaFormatiran);
    upisi_('kalkulator_postavke_json', JSON.stringify(ucitano.postavke || {}));

    // Brojač prepoznatih dodatnih postavki — samo za informativnu poruku
    // adminu (brojKategorija je postojao i prije, brojPostavki je NOV).
    var brojPostavki = 0;
    if (ucitano.postavke) {
      for (var kljucPostavke in ucitano.postavke) {
        if (ucitano.postavke[kljucPostavke] !== null) { brojPostavki++; }
      }
    }

    // NOVO (30.9.2026., Sašin izričit zahtjev) — izvorna "Cjenik Hrvatska"
    // datoteka (u mapi "čeka dodjelu", vidi KALKULATOR_CJENIK_HR_CEKA_FOLDER_NAME
    // gore) sad više NIJE potrebna: cjenik+postavke su upravo ugrađeni u Sheet
    // (upisi_ iznad). Briše se (setTrashed) BAŠ OVDJE, odmah nakon uspješne
    // dodjele — ne čeka noćno čišćenje kao ostali dokumenti. Best-effort: ne
    // blokira odgovor ako brisanje ne uspije (npr. datoteka već ručno
    // obrisana), i NE dira ništa ako klijent nema dodijeljen accessa za
    // "Pripremi direktorij i link" ranije — taj korak kopira dokument, ne
    // koristi izvornik nakon kopiranja.
    try { DriveApp.getFileById(cjenikHr.id).setTrashed(true); } catch (errBrisanjeIzvornika) { /* ne blokira odgovor */ }

    // NOVO (30.9.2026., devetnaesti krug, Sašin izričit zahtjev — "kad
    // dodam drugi cjenik moram napisati napomenu što sam dodao i potvrditi
    // passwordom... i bilježi se odmah datum i vrijeme"): kad je `razlog`
    // poslan (samo gumb "⟳ Osvježi cjenik" u InTime_Admin.html ga šalje —
    // ZAMJENA postojećeg cjenika, provjereno admin lozinkom PRIJE ovog
    // poziva preko openAdminPasswordConfirmModal), zapis ide u ISTI log kao
    // klijentove prijave/izračuni ("InTime_Kalkulator_Evidencija", pod-
    // kartica "📋 Evidencija") — Vrsta='Promjena cjenika', napomena u
    // "Rezultat sažetak". Best-effort: ne blokira uspješan odgovor ako
    // bilježenje ne uspije.
    if (razlog) {
      try {
        var nazivZaLog_ = header.indexOf('Naziv tvrtke') !== -1 ? String(row[header.indexOf('Naziv tvrtke')] || '').trim() : '';
        var tmBrojZaLog_ = header.indexOf('Identifikacijski TM broj klijenta (admin)') !== -1 ? String(row[header.indexOf('Identifikacijski TM broj klijenta (admin)')] || '').trim() : '';
        var evSheetLog_ = getOrCreateKalkulatorEvidencijaSheet_();
        evSheetLog_.appendRow([
          sadaFormatiran,
          'Promjena cjenika',
          tmBrojZaLog_,
          nazivZaLog_,
          obUsername,
          '',
          '',
          String(razlog).trim().slice(0, 500),
          ''
        ]);
      } catch (errEvidencijaCjenik) { /* ne blokira odgovor */ }
    }

    return {
      status: 'ok',
      korisnickoIme: obUsername,
      lozinka: lozinka,
      brojKategorija: ucitano.cjenik.length,
      brojPostavki: brojPostavki,
      nazivDatoteke: ucitano.naziv,
      datum: sadaFormatiran
    };
  } catch (err) {
    return { status: 'error', message: 'Dodjela pristupa kalkulatoru nije uspjela: ' + err.message };
  }
}

// Admin-only: generira besplatnu (OpenStreetMap, bez API ključa/naplate)
// kartu lokacije prikupa za jednog klijenta, na temelju adrese koju je
// klijent upisao u upitniku (isti fallback na adresu sjedišta kao
// {{ADRESA_PRIKUPA}} tag u renderMailTekst_ u InTime_Admin.html) — Sašin
// izričit zahtjev, 30.9.2026.: "tu gdje je sve vezano za prikup... i tu
// dodaj onda kartu". Rezultat (URL slike + geokodirana adresa + datum)
// sprema se u ADMIN_ONLY_FIELDS.karta_prikupa_* da se NE geokodira iznova
// svaki put kad admin otvori karticu (Nominatim politika korištenja traži
// razuman broj poziva) — vraća se iz cachea dok se upitana adresa ne
// promijeni. prisili=true (gumb "🔄 Osvježi kartu" u adminu) zaobilazi
// cache i ponovno geokodira, npr. nakon ispravka adrese.
function adminDohvatiKartuPrikupa(token, rowIndex, prisili) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  try {
    var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
    var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];

    var citaj_ = function(naziv) {
      var idx = header.indexOf(naziv);
      return (idx !== -1) ? String(row[idx] || '').trim() : '';
    };

    // Admin ispravak (ADMIN_ONLY_FIELDS.ispravljena_adresa_prikupa i dr.) IMA
    // PREDNOST pred izvornim upitnikom — isti obrazac kao ADRESA_PRIKUPA tag
    // u renderMailTekst_ (InTime_Admin.html). Vidi punu napomenu uz to polje
    // gore (30.9.2026., sedamnaesti/osamnaesti krug).
    var adresa = citaj_(ADMIN_ONLY_FIELDS.ispravljena_adresa_prikupa) || citaj_('Adresa mjesta prikupa pošiljaka') || citaj_('Adresa sjedišta');
    var postanskiBroj = citaj_(ADMIN_ONLY_FIELDS.ispravljeni_postanski_broj_prikupa) || citaj_('Poštanski broj mjesta prikupa') || citaj_('Poštanski broj');
    var grad = citaj_(ADMIN_ONLY_FIELDS.ispravljeno_mjesto_prikupa) || citaj_('Mjesto prikupa pošiljaka') || citaj_('Mjesto');
    var dijelovi = [adresa, postanskiBroj, grad].filter(function(d) { return d; });
    if (!dijelovi.length) {
      return { status: 'error', message: 'Adresa prikupa još nije upisana (ni u upitniku ni kao adresa sjedišta).' };
    }
    var upitanaAdresa = dijelovi.join(', ') + ', Hrvatska';

    // Cache — vraća spremljene koordinate ako se upitana adresa nije
    // promijenila od zadnjeg geokodiranja i "Osvježi" nije zatražen.
    var latCol = header.indexOf(ADMIN_ONLY_FIELDS.karta_prikupa_lat);
    var lonCol = header.indexOf(ADMIN_ONLY_FIELDS.karta_prikupa_lon);
    var adresaCol = header.indexOf(ADMIN_ONLY_FIELDS.karta_prikupa_adresa_upitana);
    var datumCol = header.indexOf(ADMIN_ONLY_FIELDS.karta_prikupa_datum);
    var postojeciLat = (latCol !== -1) ? String(row[latCol] || '').trim() : '';
    var postojeciLon = (lonCol !== -1) ? String(row[lonCol] || '').trim() : '';
    var postojecaAdresa = (adresaCol !== -1) ? String(row[adresaCol] || '').trim() : '';
    if (!prisili && postojeciLat && postojeciLon && postojecaAdresa === upitanaAdresa) {
      return { status: 'ok', lat: postojeciLat, lon: postojeciLon, adresa: upitanaAdresa, izCachea: true };
    }

    // Geokodiranje preko Nominatim (OpenStreetMap) — besplatno, bez API
    // ključa, ali njihova politika korištenja traži prepoznatljiv
    // User-Agent i razuman broj poziva (ovdje: jednom po klijentu, pa
    // ponovno samo na ručni "Osvježi").
    var geoResponse = UrlFetchApp.fetch(
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(upitanaAdresa),
      { method: 'get', headers: { 'User-Agent': 'InTime-doo-admin-sustav/1.0 (sasa.batinac@in-time.hr)' }, muteHttpExceptions: true }
    );
    if (geoResponse.getResponseCode() !== 200) {
      return { status: 'error', message: 'Geokodiranje adrese nije uspjelo (greška servisa) — pokušajte ponovno za par sekundi.' };
    }
    var geoRezultati;
    try { geoRezultati = JSON.parse(geoResponse.getContentText()); } catch (eParseGeo) { geoRezultati = []; }
    if (!geoRezultati || !geoRezultati.length) {
      return { status: 'error', message: 'Adresa "' + upitanaAdresa + '" nije prepoznata — provjerite je li ispravno upisana.' };
    }
    var lat = geoRezultati[0].lat;
    var lon = geoRezultati[0].lon;

    // NAPOMENA (1.10.2026., dvadeset i prvi krug): stari "statička slika"
    // provider (staticmap.openstreetmap.de) Saša je prijavio kao nepouzdan
    // ("ovo ne valja") — zamijenjen je službenim OpenStreetMap embedom
    // (admin kartica, grади se client-side iz lat/lon preko
    // openstreetmap.org/export/embed.html) i izravnom poveznicom na kartu (u
    // internom mailu poslovnicama) — oboje se sad grade iz ovih koordinata,
    // bez ovisnosti o trećem, manje pouzdanom servisu za generiranje slike.
    var sadaFormatiran = Utilities.formatDate(new Date(), 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm:ss');
    if (latCol !== -1) { sheet.getRange(rowIndex, latCol + 1).setValue(lat); }
    if (lonCol !== -1) { sheet.getRange(rowIndex, lonCol + 1).setValue(lon); }
    if (adresaCol !== -1) { sheet.getRange(rowIndex, adresaCol + 1).setValue(upitanaAdresa); }
    if (datumCol !== -1) { sheet.getRange(rowIndex, datumCol + 1).setValue(sadaFormatiran); }

    return { status: 'ok', lat: lat, lon: lon, adresa: upitanaAdresa, izCachea: false, datum: sadaFormatiran };
  } catch (err) {
    return { status: 'error', message: 'Generiranje karte nije uspjelo: ' + err.message };
  }
}

// Admin-only: uklanja pristup kalkulatoru za jednog klijenta (briše
// korisničko ime/lozinku/cjenik/datum — klijent se više ne može prijaviti).
function adminUkloniKalkulatorPristup(token, rowIndex) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  try {
    var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
    var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    ['kalkulator_korisnicko_ime', 'kalkulator_lozinka', 'kalkulator_cjenik_json', 'kalkulator_cjenik_naziv_datoteke', 'kalkulator_cjenik_datum', 'kalkulator_postavke_json', 'kalkulator_zamrznuto'].forEach(function(polje) {
      var idx = header.indexOf(ADMIN_ONLY_FIELDS[polje]);
      if (idx === -1) { return; }
      sheet.getRange(rowIndex, idx + 1).setValue('');
    });
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: 'Uklanjanje pristupa nije uspjelo: ' + err.message };
  }
}

// Admin-only: popis SVIH klijenata koji trenutno imaju pristup kalkulatoru
// (kalkulator_lozinka popunjena) — za novu admin karticu "Kalkulator
// korisnici" (Sašin izričit zahtjev: ime firme, OIB, adresa, datum dodjele
// cjenika, TM broj, uz korisničko ime/lozinku).
function adminDohvatiKalkulatorKorisnike(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  try {
    var sheet = getOrCreateUpitiSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) { return { status: 'ok', korisnici: [] }; }
    var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
    var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    var idx = {
      naziv: header.indexOf('Naziv tvrtke'),
      oib: header.indexOf('OIB'),
      adresa: header.indexOf('Adresa'),
      postanski: header.indexOf('Poštanski broj'),
      grad: header.indexOf('Mjesto'),
      tmBroj: header.indexOf(ADMIN_ONLY_FIELDS.identifikacijski_tm_broj),
      korisnickoIme: header.indexOf(ADMIN_ONLY_FIELDS.kalkulator_korisnicko_ime),
      lozinka: header.indexOf(ADMIN_ONLY_FIELDS.kalkulator_lozinka),
      cjenikNaziv: header.indexOf(ADMIN_ONLY_FIELDS.kalkulator_cjenik_naziv_datoteke),
      cjenikDatum: header.indexOf(ADMIN_ONLY_FIELDS.kalkulator_cjenik_datum),
      zamrznuto: header.indexOf(ADMIN_ONLY_FIELDS.kalkulator_zamrznuto)
    };
    if (idx.lozinka === -1) { return { status: 'ok', korisnici: [] }; }

    var korisnici = [];
    for (var i = 0; i < data.length; i++) {
      var lozinka = String(data[i][idx.lozinka] || '').trim();
      if (!lozinka) { continue; }
      var adresaDijelovi = [
        idx.adresa !== -1 ? String(data[i][idx.adresa] || '').trim() : '',
        idx.postanski !== -1 ? String(data[i][idx.postanski] || '').trim() : '',
        idx.grad !== -1 ? String(data[i][idx.grad] || '').trim() : ''
      ].filter(function(d) { return !!d; });
      korisnici.push({
        rowIndex: i + 2,
        naziv: idx.naziv !== -1 ? String(data[i][idx.naziv] || '').trim() : '',
        oib: idx.oib !== -1 ? String(data[i][idx.oib] || '').trim() : '',
        adresa: adresaDijelovi.join(', '),
        tmBroj: idx.tmBroj !== -1 ? String(data[i][idx.tmBroj] || '').trim() : '',
        korisnickoIme: idx.korisnickoIme !== -1 ? String(data[i][idx.korisnickoIme] || '').trim() : '',
        lozinka: lozinka,
        cjenikNaziv: idx.cjenikNaziv !== -1 ? String(data[i][idx.cjenikNaziv] || '').trim() : '',
        cjenikDatum: idx.cjenikDatum !== -1 ? String(data[i][idx.cjenikDatum] || '').trim() : '',
        zamrznuto: (idx.zamrznuto !== -1 && String(data[i][idx.zamrznuto] || '').trim() === 'DA')
      });
    }
    korisnici.sort(function(a, b) { return a.naziv.localeCompare(b.naziv); });
    return { status: 'ok', korisnici: korisnici };
  } catch (err) {
    return { status: 'error', message: 'Dohvaćanje popisa nije uspjelo: ' + err.message };
  }
}

// JAVNA akcija (bez tokena) — prijava klijenta na kalkulator s javne
// stranice. Uspoređuje korisničko ime (case-insensitive, trim) i lozinku
// (točno podudaranje) sa ZAMRZNUTIM vrijednostima iz
// adminDodijeliKalkulatorPristup (ne uspoređuje se live protiv
// ADMIN_ONLY_FIELDS.ob_username — vidi napomenu uz
// ADMIN_ONLY_FIELDS.kalkulator_korisnicko_ime gore). Namjerno ista poruka
// greške za "nema takvog korisnika" i "pogrešna lozinka" (ne otkriva koji
// dio nije točan).
// Sašin izričit zahtjev (2.10.2026.): "kalkulator u adminu treba biti
// otključan, samo u adminu... neka bude onaj osnovni s defaultnim
// cjenikom" — poseban ulaz preko ?kalk_admin=<adminToken> u
// InTime_KalkulatorCijena.html (vidi ucitajAdminPrijavuIzUrlaAkoPostoji_
// ondje, i buildKalkulatorIsprobajPanel_ u InTime_Admin.html koji ovaj URL
// sad generira). Koristi POSTOJEĆI admin token (isti kao sve druge admin
// radnje), NE traži zasebnu lozinku, NE vraća nikakav cjenik — stranica
// jednostavno ostaje na već učitanom zadanom/admin-postavljenom cjeniku
// (ucitajZadaniCjenikSaAdmina_), nikad na klijentovom personaliziranom.
function kalkulatorAdminPrijava(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Admin sesija je istekla — otvorite ovaj kalkulator ponovno iz admina.' }; }
  return { status: 'ok', naziv: 'Administrator (osnovni cjenik)' };
}

function kalkulatorKlijentPrijava(usernameUneseno, lozinkaUnesena) {
  usernameUneseno = String(usernameUneseno || '').trim().toLowerCase();
  lozinkaUnesena = String(lozinkaUnesena || '').trim();
  if (!usernameUneseno || !lozinkaUnesena) {
    return { status: 'error', message: 'Unesite korisničko ime i lozinku.' };
  }
  try {
    var sheet = getOrCreateUpitiSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) { return { status: 'error', message: 'Neispravno korisničko ime ili lozinka.' }; }
    var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
    var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var korisnickoImeCol = header.indexOf(ADMIN_ONLY_FIELDS.kalkulator_korisnicko_ime);
    var lozinkaCol = header.indexOf(ADMIN_ONLY_FIELDS.kalkulator_lozinka);
    var cjenikCol = header.indexOf(ADMIN_ONLY_FIELDS.kalkulator_cjenik_json);
    var postavkeCol = header.indexOf(ADMIN_ONLY_FIELDS.kalkulator_postavke_json);
    var nazivCol = header.indexOf('Naziv tvrtke');
    // NOVO (30.9.2026., Sašin izričit zahtjev — "želim opciju zamrzni
    // pristup... samo trenutno onesposobljavanje šifre... privremeno"):
    // za razliku od "Ukloni pristup" (koji BRIŠE korisničko ime/lozinku/
    // cjenik), zamrzavanje SAMO postavi zastavicu — pristupni podaci,
    // cjenik i postavke ostaju netaknuti u pozadini, čekaju "odmrzavanje".
    var zamrznutoCol = header.indexOf(ADMIN_ONLY_FIELDS.kalkulator_zamrznuto);
    if (korisnickoImeCol === -1 || lozinkaCol === -1 || cjenikCol === -1) {
      return { status: 'error', message: 'Neispravno korisničko ime ili lozinka.' };
    }
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (var i = 0; i < data.length; i++) {
      var redKorisnickoIme = String(data[i][korisnickoImeCol] || '').trim().toLowerCase();
      var redLozinka = String(data[i][lozinkaCol] || '').trim();
      if (!redKorisnickoIme || !redLozinka) { continue; }
      if (redKorisnickoIme === usernameUneseno && redLozinka === lozinkaUnesena) {
        if (zamrznutoCol !== -1 && String(data[i][zamrznutoCol] || '').trim() === 'DA') {
          return { status: 'error', message: 'Pristup kalkulatoru je privremeno onemogućen. Za više informacija kontaktirajte In Time d.o.o.' };
        }
        var cjenikSirovo = data[i][cjenikCol];
        var cjenik = [];
        if (cjenikSirovo) { try { cjenik = JSON.parse(cjenikSirovo); } catch (eParse) { cjenik = []; } }
        // NOVO (30.9.2026., nastavak istog dana) — dodatnih 16 postavki (vidi
        // ADMIN_ONLY_FIELDS.kalkulator_postavke_json gore), snimljenih ISTOM
        // prilikom kao i cjenik. Prazan objekt ako stupac ne postoji ili je
        // klijentu pristup dodijeljen PRIJE ove nadogradnje (stariji redak
        // bez te kolone popunjene) — kalkulator tad jednostavno ostaje na
        // zadanim/tvorničkim vrijednostima za te postavke, isto kao dosad.
        var postavkeSirovo = postavkeCol !== -1 ? data[i][postavkeCol] : '';
        var postavke = {};
        if (postavkeSirovo) { try { postavke = JSON.parse(postavkeSirovo); } catch (eParse2) { postavke = {}; } }
        return {
          status: 'ok',
          naziv: nazivCol !== -1 ? String(data[i][nazivCol] || '').trim() : '',
          cjenik: cjenik,
          postavke: postavke
        };
      }
    }
    return { status: 'error', message: 'Neispravno korisničko ime ili lozinka.' };
  } catch (err) {
    return { status: 'error', message: 'Prijava trenutno nije moguća, pokušajte ponovno.' };
  }
}

// Naziv zasebnog Sheeta (isti obrazac kao MAIL_PREDLOSCI_SHEET_NAME/
// Logistički centri) u koji se biljeze SVI dogadaji na javnom kalkulatoru —
// Sašin izričit zahtjev, 30.9.2026.: "dali mozemo napraviti pracenje IP
// adrese koja pristupa kalkulatoru i kada je pristupio... bilo bi dobro da
// imamo evidenciju sta je radio da dobijemo vrijednosti koje je ukucavao...
// da kad on klikne izracunaj s druge strane mi dobijemo zapis koji mogu
// kliknuti i vidjeti sto je racunao". Jedan zajednički log za OBA događaja
// (Vrsta stupac: 'Prijava'/'Izračun') — svaki redak nosi TM broj/naziv
// tvrtke/korisničko ime/IP adresu, a za 'Izračun' i cijeli snapshot ulaznih
// vrijednosti (JSON) + generirani prikaz rezultata (HTML), da admin može
// kasnije otvoriti zapis i vidjeti TOČNO što je klijent unio/dobio.
var KALKULATOR_EVIDENCIJA_SHEET_NAME_ = 'InTime_Kalkulator_Evidencija';
function getOrCreateKalkulatorEvidencijaSheet_() {
  var files = DriveApp.getFilesByName(KALKULATOR_EVIDENCIJA_SHEET_NAME_);
  var ss;
  var header = ['Datum', 'Vrsta', 'TM broj', 'Naziv tvrtke', 'Korisničko ime', 'IP adresa', 'Ulazni podaci (JSON)', 'Rezultat sažetak', 'Rezultat HTML'];
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(KALKULATOR_EVIDENCIJA_SHEET_NAME_);
    var sheet = ss.getSheets()[0];
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return ss.getSheets()[0];
}

// JAVNA akcija (bez tokena) — poziva je klijentov preglednik (IP adresa se,
// kao i kod potvrde/odbijanja ponude, dohvaća TAMO preko api.ipify.org —
// Apps Script backend nema izravan pristup IP adresi pošiljatelja — i šalje
// ovamo kao parametar). Validira korisničko ime protiv postojećih
// kalkulator korisnika (da netko izvana ne može "zatrpati" evidenciju
// izmišljenim zapisima) — zamrznut/nepoznat korisnik se tiho odbija, klijent
// to nikad ne vidi jer je poziv uvijek "fire and forget" (nikad ne blokira
// niti prekida njegov rad s kalkulatorom). `ulazniPodaciJson`/`rezultatHtml`
// se odsijecaju na razumnu duljinu (zaštita od pretjerano velike ćelije u
// Sheetu — limit ćelije je ~50.000 znakova).
function kalkulatorZabiljeziEvidenciju(username, vrsta, ulazniPodaciJson, rezultatSazetak, rezultatHtml, ipAdresa) {
  try {
    username = String(username || '').trim();
    vrsta = (vrsta === 'Izračun') ? 'Izračun' : 'Prijava';
    if (!username) { return { status: 'error' }; }
    var sheet = getOrCreateUpitiSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) { return { status: 'error' }; }
    var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
    var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var korisnickoImeCol = header.indexOf(ADMIN_ONLY_FIELDS.kalkulator_korisnicko_ime);
    var lozinkaCol = header.indexOf(ADMIN_ONLY_FIELDS.kalkulator_lozinka);
    var zamrznutoCol = header.indexOf(ADMIN_ONLY_FIELDS.kalkulator_zamrznuto);
    var tmBrojCol = header.indexOf('Identifikacijski TM broj klijenta (admin)');
    var nazivCol = header.indexOf('Naziv tvrtke');
    if (korisnickoImeCol === -1 || lozinkaCol === -1) { return { status: 'error' }; }
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var pronadjeno = null;
    var usernameLower = username.toLowerCase();
    for (var i = 0; i < data.length; i++) {
      var redUsername = String(data[i][korisnickoImeCol] || '').trim().toLowerCase();
      var redLozinka = String(data[i][lozinkaCol] || '').trim();
      if (redUsername && redLozinka && redUsername === usernameLower) { pronadjeno = data[i]; break; }
    }
    if (!pronadjeno) { return { status: 'error' }; }
    if (zamrznutoCol !== -1 && String(pronadjeno[zamrznutoCol] || '').trim() === 'DA') { return { status: 'error' }; }

    var evSheet = getOrCreateKalkulatorEvidencijaSheet_();
    var sada = Utilities.formatDate(new Date(), 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm:ss');
    var ODSIJECI_NA_ = 20000;
    var ulazniPodaciZaSpremanje = String(ulazniPodaciJson || '');
    if (ulazniPodaciZaSpremanje.length > ODSIJECI_NA_) { ulazniPodaciZaSpremanje = ulazniPodaciZaSpremanje.slice(0, ODSIJECI_NA_); }
    var rezultatHtmlZaSpremanje = String(rezultatHtml || '');
    if (rezultatHtmlZaSpremanje.length > ODSIJECI_NA_) { rezultatHtmlZaSpremanje = rezultatHtmlZaSpremanje.slice(0, ODSIJECI_NA_); }
    evSheet.appendRow([
      sada,
      vrsta,
      tmBrojCol !== -1 ? String(pronadjeno[tmBrojCol] || '').trim() : '',
      nazivCol !== -1 ? String(pronadjeno[nazivCol] || '').trim() : '',
      username,
      String(ipAdresa || '').trim(),
      ulazniPodaciZaSpremanje,
      String(rezultatSazetak || '').trim(),
      rezultatHtmlZaSpremanje
    ]);
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error' };
  }
}

// Pretvara jedan redak evidencijskog Sheeta (9 stupaca) u objekt koji čita
// InTime_Admin.html — zajednički helper za obje grane
// adminDohvatiKalkulatorEvidenciju niže (sve / filtrirano po klijentu).
function mapKalkulatorEvidencijaRedak_(row) {
  return {
    datum: row[0] ? String(row[0]) : '',
    vrsta: row[1] || '',
    tmBroj: row[2] || '',
    nazivTvrtke: row[3] || '',
    korisnickoIme: row[4] || '',
    ipAdresa: row[5] || '',
    ulazniPodaci: row[6] || '',
    rezultatSazetak: row[7] || '',
    rezultatHtml: row[8] || ''
  };
}

// Admin-only: zadnjih `limit` (zadano/maks. 500) zapisa iz evidencije
// kalkulatora, najnoviji prvi — za admin pod-karticu "📋 Evidencija"
// (🧮 Kalkulator → Evidencija, prikazuje SVE klijente zajedno).
// `username` (30.9.2026., dvadeseti krug, Sašin izričit zahtjev — "da
// imamo odvojeno sve njegove dolaske... po svakom klijentu... neka tamo
// ostane sve ukupno ali neka ovdje bude filtrirano samo za taj username"):
// kad je poslan, filtrira SAMO zapise tog korisničkog imena (koristi gumb
// "📋 Evidencija ovog klijenta" na kartici u "👥 Korisnici") — tad se čita
// CIJELI list (ne samo zadnjih `limit` ukupno), jer bi inače rjeđe aktivan
// klijent mogao ispasti izvan presjeka "zadnjih N" SVIH klijenata zajedno;
// broj redaka u praksi ostaje malen za ovu vrstu posla.
function adminDohvatiKalkulatorEvidenciju(token, limit, username) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  try {
    var sheet = getOrCreateKalkulatorEvidencijaSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) { return { status: 'ok', zapisi: [] }; }
    var maxLimit = Math.min(parseInt(limit, 10) || 200, 500);
    username = username ? String(username).trim().toLowerCase() : '';
    var zapisi;
    if (username) {
      var svi = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
      var filtrirano = [];
      for (var i = 0; i < svi.length; i++) {
        if (String(svi[i][4] || '').trim().toLowerCase() === username) { filtrirano.push(svi[i]); }
      }
      zapisi = filtrirano.slice(Math.max(0, filtrirano.length - maxLimit)).map(mapKalkulatorEvidencijaRedak_).reverse();
    } else {
      var prviRedak = Math.max(2, lastRow - maxLimit + 1);
      var brojRedaka = lastRow - prviRedak + 1;
      var data = sheet.getRange(prviRedak, 1, brojRedaka, 9).getValues();
      zapisi = data.map(mapKalkulatorEvidencijaRedak_).reverse();
    }
    return { status: 'ok', zapisi: zapisi };
  } catch (err) {
    return { status: 'error', message: 'Dohvat evidencije nije uspio: ' + err.message };
  }
}

// Admin-only: kratki SAŽETAK praćenja jednog klijenta (3.10.2026., Sašin
// izričit zahtjev — blok "🧮 Kalkulator – praćenje" na glavnoj kartici
// klijenta): zadnja prijava, broj prijava, broj izračuna i zadnji izračun.
// Čita samo stupce vrsta/korisničko ime/datum evidencijskog Sheeta, bez
// velikih ćelija (ulazni podaci/rezultat HTML).
function adminKalkulatorPracenjeSazetak(token, username) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  try {
    username = username ? String(username).trim().toLowerCase() : '';
    if (!username) { return { status: 'error', message: 'Nedostaje korisničko ime.' }; }
    var sheet = getOrCreateKalkulatorEvidencijaSheet_();
    var lastRow = sheet.getLastRow();
    var out = { status: 'ok', brojPrijava: 0, brojIzracuna: 0, zadnjaPrijava: '', zadnjiIzracun: '', zadnjaAktivnost: '' };
    if (lastRow < 2) { return out; }
    var data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][4] || '').trim().toLowerCase() !== username) { continue; }
      var vrsta = data[i][1];
      var datum = data[i][0] ? String(data[i][0]) : '';
      if (vrsta === 'Prijava') { out.brojPrijava++; out.zadnjaPrijava = datum; }
      else if (vrsta === 'Izračun') { out.brojIzracuna++; out.zadnjiIzracun = datum; }
      if (vrsta === 'Prijava' || vrsta === 'Izračun') { out.zadnjaAktivnost = datum; }
    }
    return out;
  } catch (err) {
    return { status: 'error', message: 'Dohvat sažetka nije uspio: ' + err.message };
  }
}

// Admin-only: privremeno zamrzava/odmrzava pristup kalkulatoru za jednog
// klijenta (Sašin izričit zahtjev, 30.9.2026. — "želim opciju zamrzni
// pristup... samo trenutno onesposobljavanje šifre... privremeno"). Za
// razliku od adminUkloniKalkulatorPristup niže, korisničko ime/lozinka/
// cjenik/postavke OSTAJU netaknuti — samo se postavi/skine zastavica koju
// kalkulatorKlijentPrijava provjerava PRIJE nego što prihvati prijavu.
function adminPostaviZamrznutostKalkulatora(token, rowIndex, zamrznuto) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  try {
    var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
    var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var idx = header.indexOf(ADMIN_ONLY_FIELDS.kalkulator_zamrznuto);
    if (idx === -1) { return { status: 'error', message: 'Stupac nije pronađen u Sheetu — pokušajte ponovno za par trenutaka.' }; }
    sheet.getRange(rowIndex, idx + 1).setValue(zamrznuto ? 'DA' : '');
    return { status: 'ok', zamrznuto: !!zamrznuto };
  } catch (err) {
    return { status: 'error', message: 'Promjena statusa nije uspjela: ' + err.message };
  }
}

// Prosjek svih numeričkih ocjena (Q1-25, isključujući "Ne mogu procijeniti")
// — koristi se u mail-obavijesti i u admin prikazu radi brzog pregleda.
function izracunajProsjekOcjenaAnkete_(data) {
  var suma = 0, broj = 0;
  // NAPOMENA: q1-q25 + NOVO q26-q30 (poglavlje "Računovodstvo, fakturiranje
  // i otkupnine", 25.9.2026.) — raspon namjerno ide do 30, ne samo do 25.
  for (var i = 1; i <= 30; i++) {
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
  posaljiMail_({
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
    posaljiMail_({
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
      var formatted = formatirajSheetVrijednost_(v);
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
  // Brzi unos dodatka na gorivo iz maila (modul "Gorivo" — Sašin izričit
  // zahtjev, 25.9.2026., vidi opširnu napomenu uz gorivoDnevnaProvjera_ i
  // gorivoStranicaUnosa_ niže) — dolazi kao OBIČAN HTML <form
  // method="POST"> (ne kao JSON gasCall poziv koji šalju sve HTML
  // stranice), pa ima drukčiji content-type
  // ('application/x-www-form-urlencoded') i polja su izravno u
  // e.parameter — ne u e.postData.contents kao JSON. Mora se obraditi OVDJE,
  // PRIJE JSON.parse ispod (koji bi inače pukao na ne-JSON tijelu), i vraća
  // gotovu HTML stranicu (ne JSON) — korisnik u mailu samo klikne link,
  // upiše postotak i vidi "Spremljeno", bez prijave u admin.
  if (e && e.parameter && e.parameter.gorivoToken) {
    return gorivoObradiUnosTokenom_(e.parameter.gorivoToken, e.parameter.postotak);
  }
  var result = { status: 'ok' };
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.action === 'trackVisit') {
      trackVisit();
    } else if (data.action === 'adminLogin') {
      result = adminLogin(data.password, data.username);
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
    } else if (data.action === 'adminOdustaniOdKlijenta') {
      result = adminOdustaniOdKlijenta(data.token, data.rowIndex);
    } else if (data.action === 'adminPrebaciUArhivu') {
      result = adminPrebaciUArhivu(data.token, data.rowIndex);
    } else if (data.action === 'adminVratiIzArhive') {
      result = adminVratiIzArhive(data.token, data.rowIndex);
    } else if (data.action === 'adminSetUpitiSkriveno') {
      result = adminSetUpitiSkriveno(data.token, data.rowIndexes, data.skriveno);
    } else if (data.action === 'adminSetAnketaSkriveno') {
      result = adminSetAnketaSkriveno(data.token, data.rowIndexes, data.skriveno);
    } else if (data.action === 'adminOtkljucajPonistenuPonudu') {
      result = adminOtkljucajPonistenuPonudu(data.token, data.rowIndex, data.brojDana, data.ukupnoSati);
    } else if (data.action === 'adminPonistiPrihvacenuPonudu') {
      result = adminPonistiPrihvacenuPonudu(data.token, data.rowIndex);
    } else if (data.action === 'adminRestartPonudu') {
      result = adminRestartPonudu(data.token, data.rowIndex);
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
    } else if (data.action === 'adminPosaljiObZahtjevTest') {
      result = adminPosaljiObZahtjevTest(data.token, data.testMail, data.predmet, data.tijelo, data.jeHtml);
    } else if (data.action === 'adminPosaljiObZahtjevMail') {
      result = adminPosaljiObZahtjevMail(data.token, data.rowIndex, data.primatelj, data.predmet, data.tijelo, data.kopijaSebi, data.jeHtml);
    } else if (data.action === 'adminPosaljiPoslovniceObavijestTest') {
      result = adminPosaljiPoslovniceObavijestTest(data.token, data.testMail, data.predmet, data.tijelo, data.jeHtml);
    } else if (data.action === 'adminPosaljiPoslovniceObavijestMail') {
      result = adminPosaljiPoslovniceObavijestMail(data.token, data.rowIndex, data.primatelji, data.predmet, data.tijelo, data.kopijaSebi, data.jeHtml);
    } else if (data.action === 'adminPosaljiSvePoslovniceObavijestTest') {
      result = adminPosaljiSvePoslovniceObavijestTest(data.token, data.testMail, data.predmet, data.tijelo, data.jeHtml);
    } else if (data.action === 'adminPosaljiSvePoslovniceObavijestMail') {
      result = adminPosaljiSvePoslovniceObavijestMail(data.token, data.rowIndex, data.primatelji, data.predmet, data.tijelo, data.kopijaSebi, data.jeHtml);
    } else if (data.action === 'adminObUvodniTekstoviList') {
      result = adminObUvodniTekstoviList(data.token);
    } else if (data.action === 'adminObUvodniTekstDodaj') {
      result = adminObUvodniTekstDodaj(data.token, data.tekst);
    } else if (data.action === 'adminObUvodniTekstObrisi') {
      result = adminObUvodniTekstObrisi(data.token, data.id);
    } else if (data.action === 'adminObUvodniTekstoviReset') {
      result = adminObUvodniTekstoviReset(data.token);
    } else if (data.action === 'adminSvepUvodniTekstoviList') {
      result = adminSvepUvodniTekstoviList(data.token);
    } else if (data.action === 'adminSvepUvodniTekstDodaj') {
      result = adminSvepUvodniTekstDodaj(data.token, data.tekst);
    } else if (data.action === 'adminSvepUvodniTekstObrisi') {
      result = adminSvepUvodniTekstObrisi(data.token, data.id);
    } else if (data.action === 'adminSvepUvodniTekstoviReset') {
      result = adminSvepUvodniTekstoviReset(data.token);
    } else if (data.action === 'adminPoslUvodniTekstoviList') {
      result = adminPoslUvodniTekstoviList(data.token);
    } else if (data.action === 'adminPoslUvodniTekstDodaj') {
      result = adminPoslUvodniTekstDodaj(data.token, data.tekst);
    } else if (data.action === 'adminPoslUvodniTekstObrisi') {
      result = adminPoslUvodniTekstObrisi(data.token, data.id);
    } else if (data.action === 'adminPoslUvodniTekstoviReset') {
      result = adminPoslUvodniTekstoviReset(data.token);
    } else if (data.action === 'adminPosaljiKlijentPristupTest') {
      result = adminPosaljiKlijentPristupTest(data.token, data.testMail, data.predmet, data.tijelo, data.jeHtml);
    } else if (data.action === 'adminPosaljiKlijentPristupMail') {
      result = adminPosaljiKlijentPristupMail(data.token, data.rowIndex, data.primatelji, data.predmet, data.tijelo, data.kopijaSebi, data.jeHtml);
    } else if (data.action === 'adminUploadKlijentPristupOpciDokument') {
      result = adminUploadKlijentPristupOpciDokument(data.token, data.base64Data, data.mimeType, data.filename);
    } else if (data.action === 'adminDohvatiKlijentPristupOpceDokumente') {
      result = adminDohvatiKlijentPristupOpceDokumente(data.token);
    } else if (data.action === 'adminObrisiKlijentPristupOpciDokument') {
      result = adminObrisiKlijentPristupOpciDokument(data.token, data.id);
    } else if (data.action === 'adminKlijentPristupUvodniTekstoviList') {
      result = adminKlijentPristupUvodniTekstoviList(data.token);
    } else if (data.action === 'adminKlijentPristupUvodniTekstDodaj') {
      result = adminKlijentPristupUvodniTekstDodaj(data.token, data.tekst);
    } else if (data.action === 'adminKlijentPristupUvodniTekstObrisi') {
      result = adminKlijentPristupUvodniTekstObrisi(data.token, data.id);
    } else if (data.action === 'adminKlijentPristupUvodniTekstoviReset') {
      result = adminKlijentPristupUvodniTekstoviReset(data.token);
    } else if (data.action === 'adminUcitajPocetno') {
      result = adminUcitajPocetno(data.token);
    } else if (data.action === 'adminGetCounters') {
      result = adminGetCounters(data.token);
    } else if (data.action === 'adminResetPosjeteUkupno') {
      result = adminResetPosjeteUkupno(data.token);
    } else if (data.action === 'adminResetPosjeteDanas') {
      result = adminResetPosjeteDanas(data.token);
    } else if (data.action === 'adminResetPosjeteSveukupno') {
      result = adminResetPosjeteSveukupno(data.token);
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
    } else if (data.action === 'adminLogistickiCentriList') {
      result = adminLogistickiCentriList(data.token);
    } else if (data.action === 'adminLogistickiCentarSpremi') {
      result = adminLogistickiCentarSpremi(data.token, data.podaci);
    } else if (data.action === 'adminLogistickiCentarObrisi') {
      result = adminLogistickiCentarObrisi(data.token, data.rowIndex);
    } else if (data.action === 'adminLogistickiOsobeList') {
      result = adminLogistickiOsobeList(data.token);
    } else if (data.action === 'adminLogistickiOsobaSpremi') {
      result = adminLogistickiOsobaSpremi(data.token, data.podaci);
    } else if (data.action === 'adminLogistickiOsobaObrisi') {
      result = adminLogistickiOsobaObrisi(data.token, data.rowIndex);
    } else if (data.action === 'adminPostavkeGet') {
      result = adminPostavkeGet(data.token);
    } else if (data.action === 'adminPostavkeSpremi') {
      result = adminPostavkeSpremi(data.token, data.podaci);
    } else if (data.action === 'adminListOsnovnaDokumentacija') {
      result = adminListOsnovnaDokumentacija(data.token);
    } else if (data.action === 'adminBrowseSustavFolder') {
      result = adminBrowseSustavFolder(data.token, data.korijen, data.folderId);
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
      // ISPRAVAK (23.9.2026.) — jedinstveni obrazac sad šalje i ocjenu
      // voditelja ključnih kupaca (vidi napomenu uz potvrdiPonudu() iznad).
      result = potvrdiPonudu(data.token, data.oib, data.imeOsobe, data.funkcijaOsobe, data.ipAdresa, data.ocjenaZnanje, data.ocjenaPrezentacija, data.ocjenaUgovaranje);
    } else if (data.action === 'odbijPonudu') {
      // Napomena: isto kao potvrdaPonudeInfo/potvrdiPonudu gore, `data.token`
      // NIJE admin token nego token za potvrdu ponude iz poveznice — javna
      // akcija, klijent je zove izravno s InTime_PotvrdaPonude.html.
      // ISPRAVAK (23.9.2026.) — jedinstveni obrazac na InTime_PotvrdaPonude.html
      // sad šalje i OIB i funkciju (vidi napomenu uz odbijPonudu() iznad).
      result = odbijPonudu(data.token, data.oib, data.imeOsobe, data.funkcijaOsobe, data.ipAdresa, data.razlog);
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
    } else if (data.action === 'adminKalkulatorCjenikStatus') {
      result = adminKalkulatorCjenikStatus(data.token);
    } else if (data.action === 'adminKalkulatorCjenikUpload') {
      result = adminKalkulatorCjenikUpload(data.token, data.base64Data, data.filename, data.razlog);
    } else if (data.action === 'adminKalkulatorCjenikArhivaList') {
      result = adminKalkulatorCjenikArhivaList(data.token);
    } else if (data.action === 'adminKalkulatorCjenikArhivaRestore') {
      result = adminKalkulatorCjenikArhivaRestore(data.token, data.fileId, data.razlog);
    } else if (data.action === 'adminKalkulatorCjenikArhivaDelete') {
      result = adminKalkulatorCjenikArhivaDelete(data.token, data.fileId);
    } else if (data.action === 'adminKalkulatorNapomenaList') {
      result = adminKalkulatorNapomenaList(data.token);
    } else if (data.action === 'adminKalkulatorNapomenaDodaj') {
      result = adminKalkulatorNapomenaDodaj(data.token, data.tekst, data.boja);
    } else if (data.action === 'adminKalkulatorNapomenaObrisi') {
      result = adminKalkulatorNapomenaObrisi(data.token, data.rowIndex);
    } else if (data.action === 'kalkulatorZadaniCjenikJavno') {
      result = kalkulatorZadaniCjenikJavno();
    } else if (data.action === 'adminDodijeliKalkulatorPristup') {
      result = adminDodijeliKalkulatorPristup(data.token, data.rowIndex, data.regenerirajLozinku, data.razlog);
    } else if (data.action === 'adminKalkulatorCjenikKlijentUpload') {
      result = adminKalkulatorCjenikKlijentUpload(data.token, data.rowIndex, data.base64Data, data.filename, data.razlog);
    } else if (data.action === 'adminKalkulatorCjenikKlijentArhivaList') {
      result = adminKalkulatorCjenikKlijentArhivaList(data.token, data.korisnickoIme);
    } else if (data.action === 'adminKalkulatorCjenikKlijentArhivaRestore') {
      result = adminKalkulatorCjenikKlijentArhivaRestore(data.token, data.rowIndex, data.arhivId, data.razlog);
    } else if (data.action === 'adminKalkulatorCjenikKlijentArhivaDelete') {
      result = adminKalkulatorCjenikKlijentArhivaDelete(data.token, data.arhivId);
    } else if (data.action === 'adminUkloniKalkulatorPristup') {
      result = adminUkloniKalkulatorPristup(data.token, data.rowIndex);
    } else if (data.action === 'adminDohvatiKalkulatorKorisnike') {
      result = adminDohvatiKalkulatorKorisnike(data.token);
    } else if (data.action === 'adminDohvatiKartuPrikupa') {
      result = adminDohvatiKartuPrikupa(data.token, data.rowIndex, data.prisili);
    } else if (data.action === 'centarPrijava') {
      result = centarPrijava(data.email, data.lozinka);
    } else if (data.action === 'adminCentriKlijentiPregled') {
      result = adminCentriKlijentiPregled(data.token);
    } else if (data.action === 'adminCentarPostavkeSpremi') {
      result = adminCentarPostavkeSpremi(data.token, data.naziv, data.postavke);
    } else if (data.action === 'adminCentarLozinkaNova') {
      result = adminCentarLozinkaNova(data.token, data.naziv, data.posaljiMail, data.portalUrl, data.vrsta, data.rucnaLozinka);
    } else if (data.action === 'adminCentarPosaljiMail') {
      result = adminCentarPosaljiMail(data.token, data.naziv);
    } else if (data.action === 'adminCentarXlsx') {
      result = adminCentarXlsx(data.token, data.naziv);
    } else if (data.action === 'adminCentriAutoTrigerPostavi') {
      result = adminCentriAutoTrigerPostavi(data.token);
    } else if (data.action === 'adminCjenikArhivaPopis') {
      result = adminCjenikArhivaPopis(data.token);
    } else if (data.action === 'adminCjenikArhivaSpremi') {
      result = adminCjenikArhivaSpremi(data.token, data.naziv, data.nazivDatoteke, data.base64, data.hash);
    } else if (data.action === 'adminCjenikArhivaDohvati') {
      result = adminCjenikArhivaDohvati(data.token, data.id);
    } else if (data.action === 'adminCjenikArhivaPreimenuj') {
      result = adminCjenikArhivaPreimenuj(data.token, data.id, data.naziv);
    } else if (data.action === 'adminCjenikArhivaObrisi') {
      result = adminCjenikArhivaObrisi(data.token, data.id);
    } else if (data.action === 'kalkulatorAdminPrijava') {
      result = kalkulatorAdminPrijava(data.token);
    } else if (data.action === 'kalkulatorKlijentPrijava') {
      result = kalkulatorKlijentPrijava(data.username, data.lozinka);
    } else if (data.action === 'kalkulatorZabiljeziEvidenciju') {
      result = kalkulatorZabiljeziEvidenciju(data.username, data.vrsta, data.ulazniPodaci, data.rezultatSazetak, data.rezultatHtml, data.ipAdresa);
    } else if (data.action === 'adminDohvatiKalkulatorEvidenciju') {
      result = adminDohvatiKalkulatorEvidenciju(data.token, data.limit, data.username);
    } else if (data.action === 'adminKolegeList') {
      result = adminKolegeList(data.token);
    } else if (data.action === 'adminKolegaSpremi') {
      result = adminKolegaSpremi(data.token, data.id, data.ime, data.prezime, data.email, data.telefon, data.funkcija, data.lozinka);
    } else if (data.action === 'adminKolegaLozinkaNova') {
      result = adminKolegaLozinkaNova(data.token, data.id, data.lozinka);
    } else if (data.action === 'adminKolegaZamrzni') {
      result = adminKolegaZamrzni(data.token, data.id, data.zamrznuto);
    } else if (data.action === 'adminKolegaObrisi') {
      result = adminKolegaObrisi(data.token, data.id);
    } else if (data.action === 'adminKolegeCjeniciPopis') {
      result = adminKolegeCjeniciPopis(data.token);
    } else if (data.action === 'adminKolegeCjenikDohvati') {
      result = adminKolegeCjenikDohvati(data.token, data.fileId);
    } else if (data.action === 'adminKolegeCjenikUArhivu') {
      result = adminKolegeCjenikUArhivu(data.token, data.fileId, data.naziv);
    } else if (data.action === 'adminKolegaBrojKalkulatora') {
      result = adminKolegaBrojKalkulatora(data.token, data.id, data.broj);
    } else if (data.action === 'adminKolegaPosaljiPristup') {
      result = adminKolegaPosaljiPristup(data.token, data.id, data.primatelji, data.predmet, data.tijelo, data.kopijaSebi, data.testAdresa, data.prilozi, data.html, data.zapamceniIds, data.zapamtiNove);
    } else if (data.action === 'adminKolegeMailPriloziPopis') {
      result = adminKolegeMailPriloziPopis(data.token);
    } else if (data.action === 'adminKolegeMailPrilogObrisi') {
      result = adminKolegeMailPrilogObrisi(data.token, data.id);
    } else if (data.action === 'adminKolegeEvidencija') {
      result = adminKolegeEvidencija(data.token, data.limit, data.username);
    } else if (data.action === 'kalkulatorKolegaPrijava') {
      result = kalkulatorKolegaPrijava(data.username, data.lozinka, data.ipAdresa);
    } else if (data.action === 'kalkulatorKolegaToken') {
      result = kalkulatorKolegaToken(data.token);
    } else if (data.action === 'kalkulatorKolegaZabiljezi') {
      result = kalkulatorKolegaZabiljezi(data.token, data.slot, data.ulazniPodaci, data.rezultatSazetak, data.rezultatHtml, data.ipAdresa);
    } else if (data.action === 'kalkulatorKolegaCjenikZabiljezi') {
      result = kalkulatorKolegaCjenikZabiljezi(data.token, data.slot, data.nazivDatoteke, data.base64, data.ipAdresa);
    } else if (data.action === 'adminKalkulatorPracenjeSazetak') {
      result = adminKalkulatorPracenjeSazetak(data.token, data.username);
    } else if (data.action === 'adminPostaviZamrznutostKalkulatora') {
      result = adminPostaviZamrznutostKalkulatora(data.token, data.rowIndex, data.zamrznuto);
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
    } else if (data.action === 'gorivoDohvatiPostotke') {
      result = gorivoDohvatiPostotke(data.token);
    } else if (data.action === 'gorivoSpremiPostotak') {
      result = gorivoSpremiPostotak(data.token, data.godina, data.mjesec, data.postotak, data.napomena);
    } else if (data.action === 'gorivoObrisiPostotak') {
      result = gorivoObrisiPostotak(data.token, data.godina, data.mjesec);
    } else if (data.action === 'gorivoDohvatiEmailPodsjetnik') {
      result = gorivoDohvatiEmailPodsjetnik(data.token);
    } else if (data.action === 'gorivoSpremiEmailPodsjetnik') {
      result = gorivoSpremiEmailPodsjetnik(data.token, data.email);
    } else if (data.action === 'gorivoOtkljucajEmailPodsjetnik') {
      result = gorivoOtkljucajEmailPodsjetnik(data.token);
    } else if (data.action === 'gorivoPosaljiTestPodsjetnik') {
      result = gorivoPosaljiTestPodsjetnik(data.token);
    } else if (data.action === 'gorivoDohvatiCijene') {
      result = gorivoDohvatiCijene(data.token);
    } else if (data.action === 'gorivoPokreniDohvatCijenaSada') {
      result = gorivoPokreniDohvatCijenaSada(data.token);
    } else if (data.action === 'gorivoDohvatiDogadjaje') {
      result = gorivoDohvatiDogadjaje(data.token);
    } else if (data.action === 'gorivoSpremiDogadjaj') {
      result = gorivoSpremiDogadjaj(data.token, data.datum, data.naziv);
    } else if (data.action === 'gorivoObrisiDogadjaj') {
      result = gorivoObrisiDogadjaj(data.token, data.rowIndex);
    } else if (data.action === 'gorivoPostaviVidljivostDogadjaja') {
      result = gorivoPostaviVidljivostDogadjaja(data.token, data.rowIndexes, data.vidljivo);
    } else if (data.action === 'gorivoSakrijSveDogadjaje') {
      result = gorivoSakrijSveDogadjaje(data.token);
    } else if (data.action === 'gorivoUcitajZadaneDogadjaje') {
      result = gorivoUcitajZadaneDogadjaje(data.token);
    } else if (data.action === 'gorivoPostaviTestPregled') {
      result = gorivoPostaviTestPregled(data.token, data.postotak);
    } else if (data.action === 'gorivoUgasiTestPregled') {
      result = gorivoUgasiTestPregled(data.token);
    } else if (data.action === 'brziLogin') {
      result = brziLogin(data.pin);
    } else if (data.action === 'brziPromijeniPin') {
      result = brziPromijeniPin(data.token, data.stariPin, data.noviPin);
    } else if (data.action === 'adminBrziPromijeniPin') {
      result = adminBrziPromijeniPin(data.token, data.noviPin);
    } else if (data.action === 'brziPregled') {
      result = brziPregled(data.token);
    } else if (data.action === 'brziImenikLista') {
      result = brziImenikLista(data.token);
    } else if (data.action === 'brziAnketeLista') {
      result = brziAnketeLista(data.token);
    } else if (data.action === 'brziAnketaDetalj') {
      result = brziAnketaDetalj(data.token, data.rowIndex);
    } else if (data.action === 'brziOdbijeniceLista') {
      result = brziOdbijeniceLista(data.token);
    } else if (data.action === 'brziKlijentiLista') {
      result = brziKlijentiLista(data.token);
    } else if (data.action === 'brziPretraga') {
      result = brziPretraga(data.token, data.q);
    } else if (data.action === 'brziImenikUnos') {
      result = brziImenikUnos(data.token, data.ime, data.tvrtka, data.telefon, data.email, data.napomena);
    } else if (data.action === 'brziBiljeskaDodaj') {
      result = brziBiljeskaDodaj(data.token, data.tip, data.ref, data.naziv, data.tekst, data.podsjetnik, data.vrijeme, data.primatelji, data.telefon, data.boja);
    } else if (data.action === 'brziBiljeskaUredi') {
      result = brziBiljeskaUredi(data.token, data.id, data.tekst, data.podsjetnik, data.vrijeme, data.primatelji, data.telefon, data.boja);
    } else if (data.action === 'brziPostavkePodsjetnika') {
      result = brziPostavkePodsjetnika(data.token);
    } else if (data.action === 'brziPostaviPrimatelje') {
      result = brziPostaviPrimatelje(data.token, data.primatelji);
    } else if (data.action === 'brziProbniKalendar') {
      result = brziProbniKalendar(data.token);
    } else if (data.action === 'brziProbniMail') {
      result = brziProbniMail(data.token);
    } else if (data.action === 'brziBiljeskeLista') {
      result = brziBiljeskeLista(data.token, data.ref, data.sve);
    } else if (data.action === 'brziBiljeskaRijeseno') {
      result = brziBiljeskaRijeseno(data.token, data.id, data.rijeseno);
    } else if (data.action === 'brziBiljeskaObrisi') {
      result = brziBiljeskaObrisi(data.token, data.id);
    } else if (data.action === 'adminGorivoFabPostavi') {
      result = adminGorivoFabPostavi(data.token, data.ukljucen);
    } else if (data.action === 'gorivoJavniPodaci') {
      // Javna ruta — BEZ provjere tokena (koristi je naslovnica, vidi
      // gorivoJavniPodaci() niže; namjerno ne sadrži ništa osjetljivo).
      result = gorivoJavniPodaci();
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

// GET na Web App URL — do sada nije postojao (sve stranice zovu doPost, s
// JSON tijelom, vidi gasCall u HTML datotekama). Dodano ISKLJUČIVO za
// poveznicu za brzi unos dodatka na gorivo iz mail podsjetnika (modul
// "Gorivo", 25.9.2026. — vidi gorivoStranicaUnosa_ niže), koja mora biti
// običan link (?action=gorivoUnos&token=...) da radi klikom iz bilo kojeg
// mail klijenta, bez JS-a. Svaki drugi GET (npr. netko otvori Web App URL
// izravno u pregledniku) dobiva samo kratku info poruku.
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'gorivoUnos') {
    return gorivoStranicaUnosa_(e.parameter.token);
  }
  return ContentService.createTextOutput('In Time — API backend.').setMimeType(ContentService.MimeType.TEXT);
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
  // Sašin izričit zahtjev (23.9.2026., trideset i šesti krug): gumb "Abandon"
  // — MI odustajemo od klijenta (za razliku od "Datum odbijanja ponude", koje
  // bilježi da je KLIJENT odbio). Klik šalje automatski mail
  // (MAIL_PREDLOZAK_HTML_ODUSTAJANJE_ gore) i odmah prebacuje zapis u Arhivu
  // (postavlja i datum_prebacivanja_arhiva) — ovo polje samo posebno
  // obilježava DA se dogodilo BAŠ kroz Abandon, da InTime_Admin.html zna
  // ispisati crveno "ABANDON" u Arhivi (za razliku od ručnog "Prebaci u
  // arhivu", koje ovo polje ne postavlja). Vidi adminOdustaniOdKlijenta()
  // niže.
  datum_odustajanja_mi: 'Datum odustajanja od klijenta - mi (admin)',
  // NOVO (23.9.2026., Sašin izričit zahtjev — "kad ga prebacim u arhivu da
  // li dokumentacija mijenja mjesto na Google Disku... možemo li napraviti
  // da fizički dokumentacija ide u direktorij Arhiva... da unutra dobije
  // status, recimo ako prebacujem Abandon da dobije poddirektorij Abandon,
  // ako prebacujem poništena ponuda neka dobije poddirektorij poništena
  // ponuda, ako prebacujem odbijena neka dobije poddirektorij odbijena"):
  // pamti KOJU je kategoriju dobio klijent kod prebacivanja u Arhivu —
  // 'ABANDON' / 'ODBIJENA' / 'PONISTENA' / 'NIJE_DOVRSENA' (vidi
  // ARHIVA_KATEGORIJA_FOLDER_IMENA_ i odrediArhivaKategoriju_() niže).
  // Koristi se za DVIJE stvari: (1) u koji poddirektorij ARHIVA/... na
  // Driveu se klijentov direktorij fizički premjesti
  // (premjestiKlijentFolderUKategorijuArhive_), i (2) obojena značka uz ime
  // klijenta u Arhivi (crno/ljubičasto/žuto/crveno — vidi InTime_Admin.html,
  // arhivaKategorijaBadgeHtml_). Briše se kad se klijent vrati iz Arhive
  // (adminVratiIzArhive), tako da ponovni odlazak u Arhivu uvijek dobije
  // SVJEŽU kategoriju prema tadašnjem stanju, ne staru.
  arhiva_kategorija: 'Kategorija arhiviranja (admin)',
  // NOVO (23.9.2026., Dio 2 Sašinog zahtjeva — "svuda u Zainteresirane,
  // Ponude, Arhivu, Nisu zainteresirani, Ankete kvalitete, Klijent napravi
  // isto kao u Imeniku mogućnost sakrivanja na istu logiku"): ISTI princip
  // kao IMENIK_COL.SKRIVENO (Imenik ima svoj, fiksni pozicijski stupac u
  // zasebnom Sheetu) — ovdje je to obično ADMIN_ONLY_FIELDS polje jer
  // Interes/Ponude/Arhiva/Odbijenica/NoviKlijenti dijele "InTime_Upiti"
  // Sheet s dinamičkim header.indexOf() pristupom. Isto polje/naziv stupca
  // dodano i u "InTime_Ankete" Sheet (vidi izracunajOcekivanoZaglavljeAnkete_
  // niže) za tab Ankete. Vrijednost: 'Da'/'Ne' string, isti obrazac kao
  // Imenik. Postavlja se kroz adminSetUpitiSkriveno()/adminSetAnketaSkriveno()
  // niže (masovno, po popisu rowIndex-a) — NE kroz generički
  // adminUpdateFields/adminUpdateAnketaFields, da UI može slati jedan poziv
  // za više označenih kartica odjednom (isti obrazac kao adminSetImenikSkriveno).
  skriveno: 'Skriveno (admin)',
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
  // ISPRAVAK (23.9.2026., Sašin izričit zahtjev — pravi bug: "nakon što sam
  // promijenio OIB klijenta automatski mi se sve razdvojilo, nastao je još
  // jedan GLAVNI direktorij klijenta"): klijentov OSNOVNI direktorij
  // ("PONUDA - Naziv - OIB - Grad", roditelj SVIH verzija) se do sad uvijek
  // tražio/stvarao ISKLJUČIVO po TOČNOM STRING IMENU, izračunatom iz
  // TRENUTNIH vrijednosti naziv/OIB/grad (getOrCreateChildFolder_). Kad bi
  // Saša naknadno ispravio naziv tvrtke, OIB ili grad (npr. kroz blok
  // "Naziv tvrtke i OIB" u InTime_Admin.html), formula bi izračunala DRUGO
  // ime, ne bi pronašla postojeći folder (koji i dalje nosi STARO ime), i
  // stvorila SASVIM NOVI folder — stari, sa svim dosadašnjim ponudama i
  // dokumentima, ostao bi "siroče", nepovezan s klijentom. Ovo polje pamti
  // Drive ID tog OSNOVNOG direktorija — vidi resolveKlijentFolderStabilno_()
  // niže, koja ga koristi da postojeći folder samo PREIMENUJE kad se naziv/
  // OIB/grad promijene, umjesto da izgubi vezu s njim. Nikad se ne briše.
  klijent_folder_id: 'ID glavnog direktorija klijenta (admin)',
  // Isti razlog kao klijent_folder_id iznad, ali za PREDIREKTORIJ TE
  // KONKRETNE VERZIJE ponude (unutar klijentovog osnovnog direktorija,
  // sadrži cjenike/evidenciju/potvrdu/odbijanje — vidi
  // getOrCreateVerzijaFolder_/resolveVerzijaFolderStabilno_ niže). Za
  // razliku od klijent_folder_id (traje kroz CIJELI život klijenta), ovo se
  // BRIŠE pri "Generiraj novu ponudu" (svaka nova verzija namjerno dobiva
  // svoj vlastiti, svježi predirektorij — to nije bug, to je dizajn).
  aktivni_predirektorij_folder_id: 'ID aktivnog predirektorija ponude (admin)',
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
  // Sašin izričit zahtjev (23.9.2026.): kad klijent PRIHVATI ponudu, uz OIB/
  // ime/funkciju traži se i kratka ocjena voditelja ključnih kupaca koji ga
  // je kontaktirao — isti klizač 0-10 kao u InTime_Anketa.html ("ocjena
  // kvalitete", isti vizualni obrazac, bez slobodnog komentara, samo skala).
  // Traži se SAMO kod prihvaćanja (nema smisla kod odbijanja) i NIJE
  // obavezno — popunjava potvrdiPonudu() niže, ostaje prazno ako klijent
  // nije dotaknuo klizač.
  potvrda_ocjena_znanje: 'Ocjena voditelja KAM - znanje (klijent)',
  potvrda_ocjena_prezentacija: 'Ocjena voditelja KAM - prezentacija tvrtke (klijent)',
  potvrda_ocjena_ugovaranje: 'Ocjena voditelja KAM - nacin ugovaranja (klijent)',
  // Sašin izričit zahtjev (23.9.2026.): klijent dobiva automatski mail kad
  // ponuda istekne (vidi provjeriIIzvijestiIsteklePonude_() niže, koju
  // pokreće satni triger). Ovo polje sprječava da se ISTA obavijest pošalje
  // više puta (triger prolazi kroz SVE ponude svaki sat) — čim je mail
  // jednom poslan za TU verziju ponude, stupac se popuni i sweep je
  // preskače. Briše se pri "Generiraj novu ponudu" (čist list za novu
  // verziju) i pri "Postavi rok"/otključavanju (ponuda više nije istekla,
  // pa ponovni istek u budućnosti treba ponovnu obavijest).
  mail_istek_poslan: 'Datum slanja obavijesti o isteku ponude (admin)',
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
  ponuda_ip_odbijanja: 'IP adresa prilikom odbijanja ponude (admin)',
  // Sašin izričit zahtjev (28.9.2026., nastavak — lanac tri panela "Pošalji
  // zahtjev za Online Booking" → "Pošalji pristupne podatke klijentu" →
  // "Pošalji obavijest poslovnicama"): dosad NIJE postojao trag JESU LI
  // ovi mailovi stvarno poslani — panel "Pošalji obavijest poslovnicama"
  // sad mora ostati zaključan dok klijent ne dobije pristupne podatke, a
  // panel "Pošalji pristupne podatke klijentu" mora ostati zaključan dok
  // OB korisničko ime/lozinka nisu potvrđeni I dok zahtjev za OB nije
  // poslan — pa oba trenutka moraju biti zabilježena. Postavljaju se
  // AUTOMATSKI, server-side, čim odgovarajući adminPosalji*Mail uspije
  // (vidi upisiAdminPoljeAkoPostoji_ niže) — nikad ručno upisiva polja.
  datum_slanja_ob_zahtjeva: 'Datum slanja zahtjeva za OB (admin)',
  datum_slanja_klijent_pristup: 'Datum slanja maila klijentu s pristupnim podacima (admin)',
  // NOVO (2.10.2026., Sašin izričit zahtjev — "taj panel [narančasti, SVIM
  // poslovnicama] se ne može otvoriti dok se ne pošalje prethodni mail...
  // obavijest poslovnicama [zeleni, NADLEŽNIM poslovnicama]"): bilježi
  // trenutak slanja zelenog panela "Pošalji obavijest NADLEŽNIM poslovnicama"
  // (upisuje adminPosaljiPoslovniceObavijestMail niže) — TO polje, ne OB
  // korisničko ime/lozinka, sada otključava narančasti panel "Pošalji
  // obavijest SVIM poslovnicama" (vidi svepGuard* u InTime_Admin.html).
  datum_slanja_poslovnice_obavijest: 'Datum slanja obavijesti nadležnim poslovnicama (admin)',
  // NOVO (3.10.2026., Sašin zahtjev — kvačica + datum uz svako slanje na kartici): bilježi slanje
  // narančastog panela "Obavijest SVIM poslovnicama" (samo prikaz, NIJE uvjet za prebacivanje u klijente).
  datum_slanja_sve_poslovnice_obavijest: 'Datum slanja obavijesti svim poslovnicama (admin)',
  // NOVO (30.9.2026., Sašin izričit zahtjev — kalkulator cijene dostave
  // zaključan po klijentu): kad Saša doda "Cjenik Hrvatska" (postojeće
  // fiksno polje, dokument_cjenik_hrvatska gore) i klikne "Dodijeli cjenik u
  // kalkulator" (adminDodijeliKalkulatorPristup niže), ta se Excel datoteka
  // parsira ISTIM parserom kao i zadani (globalni) cjenik
  // (parseKalkulatorCjenikRedaka_) i sprema PO KLIJENTU, odvojeno od
  // zadanog cjenika u Script Properties. Korisničko ime se u tom trenutku
  // "zamrzne" kao kopija ADMIN_ONLY_FIELDS.ob_username (da kasnija ručna
  // izmjena OB korisničkog imena ne pokvari već izdanu lozinku za
  // kalkulator), a lozinka se generira po formuli: [datum otvaranja OB-a,
  // ddMMyyyy] + [ime superheroja, nasumično iz KALKULATOR_SUPERHEROJI_] +
  // [prva 2 slova naziva tvrtke, velika slova] + "!". Vidi
  // generirajKalkulatorLozinku_/adminDodijeliKalkulatorPristup/
  // adminUkloniKalkulatorPristup/adminDohvatiKalkulatorKorisnike/
  // kalkulatorKlijentPrijava niže. NIJE u poljaZaBrisanje_
  // (adminRestartPonudu) — pristup kalkulatoru je vezan za OB odnos s
  // klijentom, ne za pojedini krug ponude, isti princip kao ob_username/
  // ob_password gore.
  kalkulator_korisnicko_ime: 'Kalkulator korisničko ime (admin)',
  kalkulator_lozinka: 'Kalkulator lozinka (admin)',
  kalkulator_cjenik_json: 'Kalkulator cjenik klijenta (admin, JSON)',
  kalkulator_cjenik_naziv_datoteke: 'Kalkulator cjenik - naziv datoteke (admin)',
  kalkulator_cjenik_datum: 'Datum dodjele cjenika u kalkulator (admin)',
  // NOVO (30.9.2026., nastavak istog dana, Sašin izričit zahtjev — "dovrši
  // kalkulator, one 14 postavki"): uz osnovnu tablicu cijena (kalkulator_cjenik_json
  // gore), sad se PO KLIJENTU sprema i svih 16 dodatnih "skrivenih" postavki
  // iz istog "Cjenik Hrvatska" dokumenta (ugovoreni % nestandardne pošiljke/
  // povrata, dodatak na težinu, zaključavanje načina obračuna, SMS,
  // povratnica, otkupnina gotovina/kartica, iskazana vrijednost, 5 fiksnih
  // naknada, sezonski dodatak, ograničen broj koleta) — vidi
  // parsirajDodatneKalkulatorPostavke_/ucitajKlijentovCjenikSDrivea_ gore.
  // Vraća se klijentu kod prijave (kalkulatorKlijentPrijava).
  kalkulator_postavke_json: 'Kalkulator dodatne postavke (admin, JSON)',
  // NOVO (30.9.2026., Sašin izričit zahtjev — "tu gdje je sve vezano za
  // prikup, dodaj kartu"): besplatna (OpenStreetMap, bez API ključa/naplate)
  // karta lokacije prikupa, generirana od adrese koju klijent već upiše u
  // upitniku (polja mjesto_prikupa_adresa/mjesto_prikupa_postanski_broj/
  // mjesto_prikupa_grad, s fallbackom na adresu sjedišta — isti fallback kao
  // {{ADRESA_PRIKUPA}} tag u renderMailTekst_). Rezultat geokodiranja
  // (Nominatim) se sprema PO KLIJENTU da se ne geokodira iznova svaki put
  // kad admin otvori karticu — vidi adminDohvatiKartuPrikupa niže. "Osvježi
  // kartu" u adminu ponovno pokreće geokodiranje (npr. nakon ispravka
  // adrese).
  karta_prikupa_url: 'Karta prikupa - URL slike (admin)',
  karta_prikupa_adresa_upitana: 'Karta prikupa - adresa koja je geokodirana (admin)',
  karta_prikupa_datum: 'Datum generiranja karte prikupa (admin)',
  // NOVO (30.9.2026., Sašin izričit zahtjev — "želim opciju zamrzni
  // pristup... samo trenutno onesposobljavanje šifre... privremeno"):
  // 'DA' = klijent se TRENUTNO ne može prijaviti na kalkulator
  // (kalkulatorKlijentPrijava odbija s jasnom porukom), ali korisničko
  // ime/lozinka/cjenik/postavke OSTAJU spremljeni — za razliku od "Ukloni
  // pristup" (adminUkloniKalkulatorPristup), koje briše sve. Postavlja/
  // skida adminPostaviZamrznutostKalkulatora niže. Briše se (vraća na '')
  // kad se pristup potpuno ukloni, da sljedeća dodjela kreće "odmrznuta".
  kalkulator_zamrznuto: 'Kalkulator pristup zamrznut (admin)',
  // NOVO (30.9.2026., sedamnaesti/osamnaesti krug, Sašin izričit zahtjev —
  // "mogućnost da mogu ispraviti ako adresa nije ispravna... da mogu
  // ispraviti ako se slučajno promijeni nešto... neka bude u kućica i
  // mogućnost promijeni"): ručni ADMIN ISPRAVAK triju polja u bloku "Podaci
  // o prikupu pošiljaka" (adresa/poštanski broj/mjesto) — npr. kad
  // Nominatim ne prepozna adresu upisanu u upitniku (tipfeler, nestandardan
  // zapis) ili kad se adresa naknadno promijeni. Kad je ovo polje popunjeno,
  // IMA PREDNOST pred vrijednošću iz upitnika svugdje gdje se adresa
  // prikupa koristi — prikaz na kartici (buildAdminFieldsBlock), geokodiranje
  // karte (adminDohvatiKartuPrikupa) i tag {{ADRESA_PRIKUPA}} u mailovima
  // (renderMailTekst_) — isti obrazac "admin ispravak nadjačava upitnik" kao
  // "Vrijeme prikupa — ručno uređeno (admin)" gore. Prazno = koristi se
  // vrijednost iz upitnika kao dosad (bez promjene ponašanja).
  ispravljena_adresa_prikupa: 'Ispravljena adresa prikupa (admin)',
  ispravljeni_postanski_broj_prikupa: 'Ispravljeni poštanski broj prikupa (admin)',
  ispravljeno_mjesto_prikupa: 'Ispravljeno mjesto prikupa (admin)',
  // NOVO (1.10.2026., dvadeset i prvi krug, Sašin izričit zahtjev — "ova tri
  // polja što moram moći promijeniti", uz isti screenshot bloka "Podaci o
  // prikupu pošiljaka"): ISTI ✎/✓ ispravak-mehanizam kao gore, ali za
  // kontakt osobu zaduženu za pošiljke (ime/telefon/email) — Nominatim ne
  // pogađa svaku adresu, a slično tako kontakt osoba iz upitnika zna
  // zastarjeti (promjena u firmi). Prednost pred upitnikom posvuda gdje se
  // koristi — kartica (buildAdminFieldsBlock) i mail-tagovi
  // {{OSOBA_POSILJKE_IME}}/{{OSOBA_POSILJKE_TELEFON}} (renderMailTekst_).
  // Prazno = koristi se vrijednost iz upitnika kao dosad.
  ispravljena_osoba_prikupa: 'Ispravljena osoba zadužena za prikup (admin)',
  ispravljeni_telefon_prikupa: 'Ispravljeni telefon prikupa (admin)',
  ispravljeni_email_prikupa: 'Ispravljeni email prikupa (admin)',
  // NOVO (1.10.2026., dvadeset i prvi krug, Sašin izričit zahtjev — "ovo ne
  // valja, nađi neko drugo besplatno rješenje"): stara statična slika karte
  // (staticmap.openstreetmap.de) zamijenjena je službenim OpenStreetMap
  // embed-om (karta na kartici) + izravnom poveznicom na kartu (u mailu) —
  // oboje se grade iz koordinata (lat/lon), pa se umjesto gotovog URL-a
  // slike sad sprema SAMO rezultat geokodiranja. "Karta prikupa - URL slike
  // (admin)" stupac ostaje u tablici (zbog postojećih redaka) ali se više ne
  // koristi — vidi adminDohvatiKartuPrikupa.
  karta_prikupa_lat: 'Karta prikupa - lat (admin)',
  karta_prikupa_lon: 'Karta prikupa - lon (admin)'
  // (30.9.2026., ISPRAVAK ISTI DAN: polje "dokumenti_klijent_pristup" koje je
  // ovdje kratko postojalo — po-klijentu JSON popis mail-priloga — u
  // potpunosti je UKLONJENO. Saša je pojasnio da su ti dokumenti OPĆE upute
  // za korištenje, iste za sve klijente, i da mail treba nositi SAMO
  // poveznicu na zajednički Drive direktorij (gumb), ne fizičke privitke.
  // Vidi getOpciDokumentiKlijentPristupFolderJavni_/adminDohvatiKlijentPristupOpceDokumente/
  // adminUploadKlijentPristupOpciDokument/adminObrisiKlijentPristupOpciDokument
  // iznad — GLOBALNO spremište, ništa se više ne sprema po retku upita.)
};

// Kontakt podaci svih nadležnih poslovnica/distribucijskih centara — Sašin
// izričit zahtjev (19.9.2026., "zapamti mailove trebat cemo ih kasnije").
// NADOGRAĐENO (26.9.2026., Sašin izričit zahtjev — nova kartica "Logistički
// centri" u adminu): ovaj hardkodirani objekt sad služi SAMO kao
// jednokratno sjeme za getOrCreateLogistickiCentriSheet_() niže — prvi put
// kad se ta kartica ikad otvori, podaci odavde se prepišu u zaseban,
// admin-uredivi Google Sheet ("InTime_Logisticki_Centri"), i odatle nadalje
// Saša njih uređuje kroz sučelje (dodaje/miče centre i kontakte), NE
// izmjenom ove konstante. Konstanta ostaje u kodu netaknuta (dokumentacijski
// trag izvornih podataka), ali se više NIGDJE ne čita nakon prvog sjemena.
// Kljuc = tocno isti naziv kao u POSLOVNICE_LISTA (InTime_Admin.html), da se
// kasnije moze izravno dohvatiti po odabranoj vrijednosti polja "Nadlezna
// poslovnica". Sljedeći korak (Sašin izričit zahtjev, isti dan — "trebat će
// mi kasnije za razvrstavanje mailova... da se automatski šalju mailovi
// centrima da je otvoren klijent i da pripaze na njega"): automatski mail
// nadležnom centru (po "Email centra" u novom Sheetu) čim se klijent otvori
// u sustavu (ADMIN_ONLY_FIELDS.datum_otvaranja) — JOŠ NIJE ugrađeno, ova
// kartica/Sheet je preduvjet (mora prvo postojati uredan, admin-editabilan
// popis mailova centara) — ostaje za sljedeći krug.
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
  // Dodano 2.10.2026. (Sašin izričit zahtjev — "nisam ga imao u imeniku pa
  // ga dodaj ti sada"): VLASTITI In Time logistički centar (vrsta 'centar'
  // — Saša je isti dan ispravio prvi pokušaj koji ga je pogrešno tretirao
  // kao vanjskog izvršitelja, vidi dodajIliPopraviZadarCentarAkoTreba_
  // niže), bez poznatog imena kontakt-osobe u ovom trenutku (admin može po
  // potrebi dodati kroz karticu "Logistički centri i servisi" → "Osobe").
  'Zadar': {
    kontakti: [],
    email: 'zadar@in-time.hr'
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

// ============================================================
// LOGISTIČKI CENTRI I SERVISI — admin kartica (26.9.2026., Sašin izričit
// zahtjev: prvo "trebamo počet raditi na novoj kartici koja će biti
// unutar admina samo... LOGISTIČKI CENTRI", potom isti dan proširenje:
// "tu bih stavio i još neke druge funkcije računovodstvo, knjiženja,
// računi, ispravak računa itd, tj mogućnost da mogu dodati druge osobe
// koje će mi kasnije trebati u povezivanju mailova s problemima, onda nek
// se zove Logistički centri i servisi"). Zaseban Google Sheet (isti
// obrazac kao InTime_Gorivo_Cijene/InTime_MailPredlosci) — jedan redak po
// centru/gradu ILI po funkcionalnom servisu/odjelu (npr. Računovodstvo,
// Knjiženja, Računi, Ispravak računa), s dva JSON stupca: "Pokriva
// dodatne gradove" (niz stringova — samo za "Zagrebačka distribucija",
// vidi DISTRIBUCIJSKI_CENTRI iznad; kod servisa uvijek prazan niz) i
// "Kontakti" (niz osoba, svaka {ime, prezime, funkcija, telefon, email,
// adresa} — polja točno prema Sašinom izričitom popisu istog dana: "ime
// prezime mail adresa funkcija telefonski broj"). Sjeme (prvi ikad poziv)
// prebacuje postojeći DISTRIBUCIJSKI_CENTRI iznad; "uloga" iz starih
// podataka postaje "funkcija", "prezime"/"adresa" (nova polja) kreću
// prazna po kontaktu. Interni naziv Sheeta/varijabli/funkcija ostaje
// "Logisticki_Centri"/"grad" iz prvobitne, uže zamišljene verzije (samo
// geografski centri) — NIJE preimenovano da se ne dotiče kôd bez stvarne
// potrebe; polje "grad" je od početka slobodan tekst, pa u praksi već
// prima i naziv servisa/odjela, ne samo grad. Vidljivi naziv u sučelju
// ("🏭 Logistički centri i servisi", vidi InTime_Admin.html) je jedino
// mjesto koje je i trebalo promijeniti. Zamišljeno kao temelj za sljedeći
// korak koji je Saša odmah najavio — automatski mail centru/servisu kod
// otvaranja klijenta (JOŠ NIJE ugrađeno) i, još kasnije, puni imenik SVIH
// kontakata u firmi (Sašine riječi: "kasnije tu će biti svi kontakti u
// firmi") — isti model podataka (centar/servis → lista kontakata) skalira
// na oboje bez promjene strukture.
// ============================================================
var LOGISTICKI_CENTRI_SHEET_NAME = 'InTime_Logisticki_Centri';

// NOVO (26.9.2026., Sašin izričit zahtjev — "mogu li dodati jednu osobu
// unutar više servisa... napravi pametnije"): dosad je svaki centar/servis
// čuvao SVOJU kopiju kontakt podataka (ime/telefon/email upisan izravno u
// "Kontakti (JSON)" stupac centra), pa bi ista osoba na dva centra bila
// dva odvojena, nepovezana zapisa — izmjena telefona bi se morala ručno
// ponoviti na svakom mjestu. Sad kontakt podaci (ime, prezime, telefon,
// email, adresa) žive JEDNOM, u zasebnom Sheetu InTime_Logisticki_Osobe, a
// centar/servis samo REFERENCIRA osobu preko stabilnog ID-a (UUID, ne
// redak u tablici — vidi napomenu uz adminLogistickiOsobaObrisi niže zašto)
// + čuva funkciju koju osoba ima BAŠ na tom centru/servisu (funkcija se
// svjesno NE dijeli — ista osoba može biti "Voditelj" na jednom centru, a
// "Zamjena" na drugom). "Kontakti (JSON)" stupac u InTime_Logisticki_Centri
// od sada sadrži niz {osobaId, funkcija} umjesto punih kontakt objekata.
var LOGISTICKI_OSOBE_SHEET_NAME = 'InTime_Logisticki_Osobe';

function getOrCreateLogistickiOsobeSheet_() {
  var files = DriveApp.getFilesByName(LOGISTICKI_OSOBE_SHEET_NAME);
  if (files.hasNext()) { return SpreadsheetApp.open(files.next()).getSheets()[0]; }
  var ss = SpreadsheetApp.create(LOGISTICKI_OSOBE_SHEET_NAME);
  var sheet = ss.getSheets()[0];
  var header = ['ID (interno, ne mijenjati)', 'Ime', 'Prezime', 'Funkcija', 'Telefon', 'Email', 'Adresa', 'Datum izmjene'];
  sheet.appendRow(header);
  sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

// Dodaje novu osobu izravno (koristi seme/self-repair niže, kad se osoba
// stvara IZ postojećih podataka, ne kroz adminLogistickiOsobaSpremi). ID je
// nasumičan (Utilities.getUuid()), NE redak u tablici — retci se mogu
// brisati/premještati bez da to pokvari reference iz centara/servisa.
function dodajLogistickuOsobu_(sheetOsobe, ime, prezime, funkcija, telefon, email, adresa) {
  var id = Utilities.getUuid();
  sheetOsobe.appendRow([id, ime || '', prezime || '', funkcija || '', telefon || '', email || '', adresa || '', new Date()]);
  return id;
}

// Self-repair (isti obrazac kao popraviIkoniceUHtmlPredloscima_ i slične
// funkcije uz mail predloške) — ako u "Kontakti (JSON)" stupcu centra/
// servisa naiđe na STARI oblik (puni kontakt objekt s ime/telefon/email
// izravno u njemu, bez osobaId — npr. ostatak prije ove nadogradnje),
// tiho izdvaja tu osobu u InTime_Logisticki_Osobe i zamjenjuje zapis s
// {osobaId, funkcija}. Idempotentno — redak koji je već u novom obliku
// (ima osobaId) se ne dira.
function popraviLogistickiKontaktiFormat_(sheetCentri) {
  var lastRow = sheetCentri.getLastRow();
  if (lastRow < 2) { return; }
  var data = sheetCentri.getRange(2, 1, lastRow - 1, 6).getValues();
  var sheetOsobe = null;
  for (var i = 0; i < data.length; i++) {
    var kontakti;
    try { kontakti = JSON.parse(data[i][5] || '[]'); } catch (e) { continue; }
    if (!Array.isArray(kontakti) || !kontakti.length) { continue; }
    var trebaPopravak = kontakti.some(function(k) { return k && !k.osobaId && (k.ime || k.prezime || k.telefon || k.email); });
    if (!trebaPopravak) { continue; }
    if (!sheetOsobe) { sheetOsobe = getOrCreateLogistickiOsobeSheet_(); }
    var novi = kontakti.map(function(k) {
      if (k && k.osobaId) { return k; }
      var id = dodajLogistickuOsobu_(sheetOsobe, (k && k.ime) || '', (k && k.prezime) || '', (k && k.funkcija) || '', (k && k.telefon) || '', (k && k.email) || '', (k && k.adresa) || '');
      return { osobaId: id, funkcija: (k && k.funkcija) || '' };
    });
    sheetCentri.getRange(i + 2, 6).setValue(JSON.stringify(novi));
    sheetCentri.getRange(i + 2, 7).setValue(new Date());
  }
}

// Sašin izričit zahtjev (26.9.2026.) — ovih pet gradova NISU vlastiti In
// Time logistički centri nego se pokrivaju preko vanjskih izvršitelja
// (druge firme/obrtnici), pa im zatvorena kartica u adminu mora pisati
// "VANJSKI IZVRŠITELJI" umjesto "LOGISTIČKI CENTAR" (vidi "vrsta" niže).
// Koristi se SAMO kod jednokratnog sjemena — nakon toga "vrsta" živi u
// Sheetu (stupac 8) i admin je slobodno mijenja po kartici u sučelju.
var LOGISTICKI_VANJSKI_IZVRSITELJI_SJEME_ = ['Dubrovnik', 'Šibenik', 'Bjelovar', 'Sisak', 'Krapina'];

// Sašin izričit zahtjev (2.10.2026.): "fale poslovnice među svim
// poslovnicama... fale vanjske i fali Zadar npr." + naknadno "treba dodati
// i zadar@in-time.hr kao preporučeni... nisam ga imao u imeniku pa ga dodaj
// ti sada" + ISPRAVAK ISTI DAN ("Zadar je logistički centar, ne vanjski
// izvršitelj") — Zadar je vlastiti In Time logistički centar (vrsta
// 'centar'), NE vanjski izvršitelj. Zadar nikad nije bio u sjemenu
// (DISTRIBUCIJSKI_CENTRI), pa ga ni filter-ispravak (centar+vanjski) nije
// mogao prikazati — redak jednostavno nije postojao. Idempotentan self-heal
// za VEĆ POSTOJEĆE Sheetove (isti obrazac kao popraviLogistickiKontaktiFormat_
// iznad) — dodaje redak kao 'centar' ako "Zadar" još nije u popisu po
// nazivu; ako redak već postoji ali je (greškom, prošli krug) upisan kao
// 'vanjski', ISPRAVLJA ga na 'centar'. Ne dira ništa drugo (adresu/telefon/
// kontakte) ako ih admin već ima.
function dodajIliPopraviZadarCentarAkoTreba_(sheetCentri) {
  var lastRow = sheetCentri.getLastRow();
  if (lastRow >= 2) {
    var podaci = sheetCentri.getRange(2, 1, lastRow - 1, 8).getValues();
    for (var i = 0; i < podaci.length; i++) {
      if (String(podaci[i][0] || '').trim().toLowerCase() === 'zadar') {
        if (String(podaci[i][7] || '').trim() !== 'centar') {
          sheetCentri.getRange(i + 2, 8).setValue('centar');
        }
        return;
      }
    }
  }
  sheetCentri.appendRow(['Zadar', '', '', 'zadar@in-time.hr', JSON.stringify([]), JSON.stringify([]), new Date(), 'centar', '']);
}

function getOrCreateLogistickiCentriSheet_() {
  var files = DriveApp.getFilesByName(LOGISTICKI_CENTRI_SHEET_NAME);
  if (files.hasNext()) {
    var postojeci = SpreadsheetApp.open(files.next()).getSheets()[0];
    popraviLogistickiKontaktiFormat_(postojeci);
    dodajIliPopraviZadarCentarAkoTreba_(postojeci);
    // "Boja" (27.9.2026.) — boja trake koju SAM bira admin, samo za vrstu
    // "servis" (centar/vanjski imaju fiksnu boju u CSS-u). Dodano na kraj
    // (stupac 9), iza već postojećeg "Vrsta" — self-heal samo dopisuje novi
    // stupac na postojećim Sheetovima, ne dira ništa od 1-8.
    uskladiZaglavljeUpitiSheeta_(postojeci, ['Naziv centra/servisa', 'Adresa', 'Telefon', 'Email', 'Pokriva dodatne gradove (JSON)', 'Kontakti (JSON)', 'Datum izmjene', 'Vrsta', 'Boja']);
    return postojeci;
  }
  var ss = SpreadsheetApp.create(LOGISTICKI_CENTRI_SHEET_NAME);
  var sheet = ss.getSheets()[0];
  // "Vrsta" je NAMJERNO zadnji stupac (8), ne odmah uz naziv — sve funkcije
  // niže koje čitaju/pišu stupce 1-7 (kontakti, čišćenje dodjela nakon
  // brisanja osobe...) time ostaju netaknute; dodavanje stupca U SREDINU bi
  // pomaknulo sve indekse i tiho pokvarilo te funkcije. "Boja" (27.9.2026.)
  // je iz istog razloga dodana KAO NOVI zadnji stupac (9), ne uz "Vrsta".
  var header = ['Naziv centra/servisa', 'Adresa', 'Telefon', 'Email', 'Pokriva dodatne gradove (JSON)', 'Kontakti (JSON)', 'Datum izmjene', 'Vrsta', 'Boja'];
  sheet.appendRow(header);
  sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  // Sjeme — vidi opširnu napomenu iznad uz DISTRIBUCIJSKI_CENTRI. Svaki
  // kontakt odmah postaje zapis u InTime_Logisticki_Osobe (novi oblik od
  // početka, umjesto da se prvo napiše stari oblik pa self-repair popravlja).
  var sheetOsobe = getOrCreateLogistickiOsobeSheet_();
  Object.keys(DISTRIBUCIJSKI_CENTRI).forEach(function(grad) {
    var c = DISTRIBUCIJSKI_CENTRI[grad];
    var kontaktiRefs = (c.kontakti || []).map(function(k) {
      var osobaId = dodajLogistickuOsobu_(sheetOsobe, k.ime || '', '', k.uloga || '', k.telefon || '', k.email || '', '');
      return { osobaId: osobaId, funkcija: k.uloga || '' };
    });
    var vrsta = LOGISTICKI_VANJSKI_IZVRSITELJI_SJEME_.indexOf(grad) !== -1 ? 'vanjski' : 'centar';
    sheet.appendRow([
      grad,
      c.adresa || '',
      c.telefon || '',
      c.email || '',
      JSON.stringify(c.pokriva || []),
      JSON.stringify(kontaktiRefs),
      new Date(),
      vrsta,
      ''
    ]);
  });
  return sheet;
}

// Koliko je centara/servisa dodijeljeno svakoj osobi (osobaId -> broj) —
// prikazuje se u odjeljku "Osobe" i u potvrdi brisanja, da admin vidi
// posljedicu prije nego što obriše osobu.
function izracunajBrojDodjelaOsoba_() {
  var brojac = {};
  var sheet = getOrCreateLogistickiCentriSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return brojac; }
  var data = sheet.getRange(2, 6, lastRow - 1, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    var kontakti;
    try { kontakti = JSON.parse(data[i][0] || '[]'); } catch (e) { continue; }
    if (!Array.isArray(kontakti)) { continue; }
    kontakti.forEach(function(k) {
      if (k && k.osobaId) { brojac[k.osobaId] = (brojac[k.osobaId] || 0) + 1; }
    });
  }
  return brojac;
}

// Popis SVIH osoba iz zajedničke baze — koristi ga i odjeljak "👤 Osobe" u
// adminu (za uređivanje) i svaka kartica centra/servisa (padajući izbornik
// "dodaj postojeću osobu").
function adminLogistickiOsobeList(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var sheet = getOrCreateLogistickiOsobeSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'ok', osobe: [] }; }
  var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var brojDodjelaPoId_ = izracunajBrojDodjelaOsoba_();
  var osobe = [];
  for (var i = 0; i < data.length; i++) {
    var id = String(data[i][0] || '').trim();
    if (!id) { continue; }
    if (!String(data[i][1] || '').trim() && !String(data[i][2] || '').trim()) { continue; }
    osobe.push({
      id: id,
      ime: data[i][1] || '',
      prezime: data[i][2] || '',
      funkcija: data[i][3] || '',
      telefon: data[i][4] || '',
      email: data[i][5] || '',
      adresa: data[i][6] || '',
      brojDodjela: brojDodjelaPoId_[id] || 0,
      datumIzmjene: (data[i][7] instanceof Date) ? Utilities.formatDate(data[i][7], Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm') : String(data[i][7] || '')
    });
  }
  osobe.sort(function(a, b) {
    return (String(a.ime) + ' ' + String(a.prezime)).localeCompare(String(b.ime) + ' ' + String(b.prezime), 'hr');
  });
  return { status: 'ok', osobe: osobe };
}

// Sprema novu osobu (podaci.id prazan/nedostaje) ili uređuje postojeću
// (podaci.id = UUID iz adminLogistickiOsobeList()) — isti obrazac kao
// adminLogistickiCentarSpremi. Ime ILI prezime je obavezno.
function adminLogistickiOsobaSpremi(token, podaci) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  podaci = podaci || {};
  var ime = String(podaci.ime || '').trim();
  var prezime = String(podaci.prezime || '').trim();
  if (!ime && !prezime) { return { status: 'error', message: 'Ime ili prezime je obavezno.' }; }
  var sheet = getOrCreateLogistickiOsobeSheet_();
  var redakBezId = [ime, prezime, String(podaci.funkcija || '').trim(), String(podaci.telefon || '').trim(), String(podaci.email || '').trim(), String(podaci.adresa || '').trim(), new Date()];
  var postojeciId = String(podaci.id || '').trim();
  if (postojeciId) {
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0] || '').trim() === postojeciId) {
          sheet.getRange(i + 2, 2, 1, redakBezId.length).setValues([redakBezId]);
          return { status: 'ok', id: postojeciId };
        }
      }
    }
    // ID je proslijeđen, ali retka s njim više nema (npr. netko drugi ga je
    // upravo obrisao) — spremamo kao potpuno novu osobu, ne kao grešku.
  }
  var noviId = Utilities.getUuid();
  sheet.appendRow([noviId].concat(redakBezId));
  return { status: 'ok', id: noviId };
}

// Miče osobu SAMO iz InTime_Logisticki_Osobe. Retci u tom Sheetu se SLOBODNO
// mogu brisati/premještati jer se osoba referencira preko UUID-a (stupac
// "ID"), ne preko rednog broja retka — za razliku od centara/servisa, gdje
// bi brisanje retka iz sredine pomaklo rowIndex svih redaka ispod i
// pokvarilo postojeće poveznice (zato ONI ostaju identificirani rowIndex-om,
// jer njih ništa drugo ne referencira).
function adminLogistickiOsobaObrisi(token, id) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  id = String(id || '').trim();
  if (!id) { return { status: 'error', message: 'Neispravan zapis.' }; }
  var sheet = getOrCreateLogistickiOsobeSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'error', message: 'Osoba više ne postoji (možda je već obrisana).' }; }
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === id) {
      sheet.deleteRow(i + 2);
      ukloniOsobuIzSvihCentara_(id);
      return { status: 'ok' };
    }
  }
  return { status: 'error', message: 'Osoba više ne postoji (možda je već obrisana).' };
}

// Čisti SVE dodjele obrisane osobe iz InTime_Logisticki_Centri — bez ovoga
// bi centar/servis ostao s "mrtvom" referencom (osobaId koji više nigdje
// ne postoji) sve dok admin taj centar sljedeći put ne spremi.
function ukloniOsobuIzSvihCentara_(osobaId) {
  var sheet = getOrCreateLogistickiCentriSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }
  var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  for (var i = 0; i < data.length; i++) {
    var kontakti;
    try { kontakti = JSON.parse(data[i][5] || '[]'); } catch (e) { continue; }
    if (!Array.isArray(kontakti) || !kontakti.length) { continue; }
    var filtrirano = kontakti.filter(function(k) { return k && k.osobaId !== osobaId; });
    if (filtrirano.length !== kontakti.length) {
      sheet.getRange(i + 2, 6).setValue(JSON.stringify(filtrirano));
      sheet.getRange(i + 2, 7).setValue(new Date());
    }
  }
}

// Popis SVIH centara i servisa za admin karticu "Logistički centri i
// servisi" — sortirano po nazivu (hrvatsko sortiranje, da Č/Š/Ž dođu na
// očekivano mjesto). Kontakti se OVDJE spajaju s bazom osoba (ime, prezime,
// telefon, email, adresa dolaze iz InTime_Logisticki_Osobe; funkcija je
// specifična za ovaj centar/servis) — frontend prima već spojene, spremne
// podatke za prikaz, ne mora sam raditi lookup.
function adminLogistickiCentriList(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var sheet = getOrCreateLogistickiCentriSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'ok', centri: [] }; }
  var data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  var osobeMapa = {};
  (adminLogistickiOsobeList(token).osobe || []).forEach(function(o) { osobeMapa[o.id] = o; });
  var centri = [];
  for (var i = 0; i < data.length; i++) {
    if (!String(data[i][0] || '').trim()) { continue; }
    var pokriva = [], kontaktiRefs = [];
    try { pokriva = JSON.parse(data[i][4] || '[]'); } catch (eP) { pokriva = []; }
    try { kontaktiRefs = JSON.parse(data[i][5] || '[]'); } catch (eK) { kontaktiRefs = []; }
    if (!Array.isArray(kontaktiRefs)) { kontaktiRefs = []; }
    var kontakti = kontaktiRefs.map(function(ref) {
      var o = osobeMapa[ref && ref.osobaId];
      // Ako osoba više ne postoji (rijetko — npr. obrisana izvan ovog
      // tijeka), tiho je izostavljamo; samoispravlja se kod sljedećeg
      // spremanja tog centra/servisa (adminLogistickiCentarSpremi niže).
      if (!o) { return null; }
      return {
        osobaId: o.id,
        ime: o.ime,
        prezime: o.prezime,
        telefon: o.telefon,
        email: o.email,
        adresa: o.adresa,
        funkcija: (ref && ref.funkcija) || o.funkcija || ''
      };
    }).filter(function(k) { return k; });
    centri.push({
      rowIndex: i + 2,
      grad: data[i][0],
      adresa: data[i][1] || '',
      telefon: data[i][2] || '',
      email: data[i][3] || '',
      pokriva: Array.isArray(pokriva) ? pokriva : [],
      kontakti: kontakti,
      // Zadano 'centar' za retke spremljene PRIJE nego što je ovaj stupac
      // postojao (prazna ćelija) — vidi napomenu uz LOGISTICKI_VRSTA... niže.
      vrsta: data[i][7] || 'centar',
      // Boja trake — SAMO relevantno za vrsta==='servis' (vidi frontend);
      // za centar/vanjski ovo se ignorira (fiksna boja iz CSS-a).
      boja: data[i][8] || '',
      datumIzmjene: (data[i][6] instanceof Date) ? Utilities.formatDate(data[i][6], Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm') : String(data[i][6] || '')
    });
  }
  centri.sort(function(a, b) { return String(a.grad).localeCompare(String(b.grad), 'hr'); });
  return { status: 'ok', centri: centri };
}

// Sprema novi centar (podaci.rowIndex prazan/0/nedostaje) ili uređuje
// postojeći (podaci.rowIndex = redak iz adminLogistickiCentriList()) — isti
// obrazac kao adminFaqSave (jedna funkcija za oba slučaja). podaci.kontakti
// je od sada niz {osobaId, funkcija} (referenca na zajedničku bazu osoba,
// vidi napomenu uz LOGISTICKI_OSOBE_SHEET_NAME iznad) — NE puni kontakt
// objekti kao prije. Zapisi bez osobaId se tiho izbacuju (odbačen odabir).
function adminLogistickiCentarSpremi(token, podaci) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  podaci = podaci || {};
  var grad = String(podaci.grad || '').trim();
  if (!grad) { return { status: 'error', message: 'Naziv centra/servisa je obavezan.' }; }
  var kontakti = (Array.isArray(podaci.kontakti) ? podaci.kontakti : []).map(function(k) {
    return {
      osobaId: String((k && k.osobaId) || '').trim(),
      funkcija: String((k && k.funkcija) || '').trim()
    };
  }).filter(function(k) { return k.osobaId; });
  var pokriva = (Array.isArray(podaci.pokriva) ? podaci.pokriva : [])
    .map(function(g) { return String(g || '').trim(); })
    .filter(function(g) { return g; });
  var vrsta = ['centar', 'vanjski', 'servis'].indexOf(podaci.vrsta) !== -1 ? podaci.vrsta : 'centar';
  // Boja trake — pamti se samo za vrstu "servis" (frontend ju šalje samo
  // otkud je i mijenja); za centar/vanjski se svejedno prazni, da ne ostane
  // "zaboravljena" boja iz trenutka kad je zapis možda bio servis.
  var boja = (vrsta === 'servis') ? String(podaci.boja || '').trim() : '';
  var sheet = getOrCreateLogistickiCentriSheet_();
  var redak = [grad, String(podaci.adresa || '').trim(), String(podaci.telefon || '').trim(), String(podaci.email || '').trim(), JSON.stringify(pokriva), JSON.stringify(kontakti), new Date(), vrsta, boja];
  var rowIndex = parseInt(podaci.rowIndex, 10);
  if (rowIndex && rowIndex >= 2 && rowIndex <= sheet.getLastRow()) {
    sheet.getRange(rowIndex, 1, 1, redak.length).setValues([redak]);
    return { status: 'ok', rowIndex: rowIndex };
  }
  sheet.appendRow(redak);
  return { status: 'ok', rowIndex: sheet.getLastRow() };
}

function adminLogistickiCentarObrisi(token, rowIndex) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateLogistickiCentriSheet_();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Centar više ne postoji (možda je već obrisan).' }; }
  sheet.deleteRow(rowIndex);
  return { status: 'ok' };
}

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

// Korisničko ime za prijavu u admin (3.10.2026., Sašin zahtjev) — fiksno
// 'sbatinac'. Ako stara verzija stranice ne šalje korisničko ime (undefined),
// prijava i dalje radi samo s lozinkom; ako ga šalje, mora se podudarati.
var ADMIN_USERNAME_ = 'sbatinac';

function adminLogin(password, username) {
  if (username !== undefined && username !== null) {
    if (String(username).trim().toLowerCase() !== ADMIN_USERNAME_) {
      return { status: 'error', message: 'Pogrešno korisničko ime ili lozinka.' };
    }
  }
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
        return { status: 'error', message: 'Pogrešno korisničko ime ili lozinka.' };
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
//   - POSJETE_SVEUKUPNO — trajni zapis "od početka rada stranice". ISPRAVAK
//                         (27.9.2026., Sašin izričit zahtjev): ipak IMA reset
//                         funkciju (adminResetPosjeteSveukupno) — ali za
//                         razliku od preostala dva brojača gore, zaštićena je
//                         DVOSTRUKOM potvrdom (riječ superjunaka pa admin
//                         lozinka, isti obrazac kao npr. "Prebacivanje u
//                         nove klijente"), baš zato što je ovo jedini brojač
//                         koji se inače NIKAD ne nulira sam od sebe.
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

// Resetira SAMO trajni ("sveukupno") brojač (POSJETE_SVEUKUPNO) na 0. Ne
// dira dnevni ni "ukupno" brojač. Frontend (InTime_Admin.html) traži
// DVOSTRUKU potvrdu (riječ superjunaka pa admin lozinka) prije nego uopće
// pošalje ovaj poziv — vidi napomenu uz trackVisit() gore.
function adminResetPosjeteSveukupno(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  PropertiesService.getScriptProperties().setProperty('POSJETE_SVEUKUPNO', '0');
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
    kalkulatorCjenikStatus: adminKalkulatorCjenikStatus(token),
    kalkulatorCjenikArhiva: adminKalkulatorCjenikArhivaList(token),
    kalkulatorNapomene: adminKalkulatorNapomenaList(token),
    brojStatus: adminGetBrojStatus(token),
    imenik: adminListImenik(token),
    imenikAutoSync: adminGetImenikAutoSync(token),
    gorivoPostotci: gorivoDohvatiPostotke(token),
    gorivoEmail: gorivoDohvatiEmailPodsjetnik(token),
    gorivoDogadjaji: gorivoDohvatiDogadjaje(token)
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
      obj[header[c]] = formatirajSheetVrijednost_(v);
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
  var odbijenaPolja = [];
  var promjenaOtvaranja_ = null;
  Object.keys(fields).forEach(function(key) {
    var colLabel = ADMIN_ONLY_FIELDS[key];
    if (!colLabel) {
      var f = UPIT_FIELDS_BY_KEY_[key];
      if (f) { colLabel = f[1]; }
    }
    if (!colLabel) { return; }
    var colIdx = header.indexOf(colLabel);
    if (colIdx === -1) { return; }
    // ISPRAVAK (23.9.2026., Sašin izričit zahtjev — bug report "bug nekako je
    // prošao oib bez 11 znakova u sustav"): ova funkcija je JEDINO mjesto gdje
    // Saša ručno mijenja OIB (kroz admin blok "Naziv tvrtke i OIB", vidi
    // buildNazivOibBlock() u InTime_Admin.html) — dosad bez ikakve provjere,
    // pa je mogao proći OIB koji nema točno 11 znamenki. To KASNIJE blokira
    // klijentovu potvrdu ponude, jer InTime_PotvrdaPonude.html ispravno
    // zahtijeva unos od točno 11 znamenki (hrvatski OIB je uvijek 11
    // znamenki), pa taj unos nikad ne može odgovarati pogrešno spremljenom
    // OIB-u iz Sheeta. Admin panel sad filtrira/provjerava ovo već na
    // klijentskoj strani (vidi ogranicniOibAdminInput_()), ali provjera je
    // OVDJE, na serveru, da je ne može zaobići NIJEDAN budući pozivatelj ove
    // funkcije (BILO KOJI ključ upitnika prolazi kroz nju).
    if (key === 'oib') {
      var oibVrijednost = String(fields[key] || '').trim();
      if (oibVrijednost && !/^\d{11}$/.test(oibVrijednost)) {
        odbijenaPolja.push('OIB mora imati točno 11 znamenki (poslano: "' + oibVrijednost + '", ' + oibVrijednost.length + ' znak' + (oibVrijednost.length === 1 ? '' : 'ova') + ').');
        return;
      }
    }
    if (key === 'datum_otvaranja') {
      promjenaOtvaranja_ = {
        prije: String(sheet.getRange(rowIndex, colIdx + 1).getValue() || '').trim(),
        poslije: String(fields[key] || '').trim()
      };
    }
    sheet.getRange(rowIndex, colIdx + 1).setValue(fields[key]);
    primijenjenoPolja++;
  });
  if (odbijenaPolja.length) {
    return { status: 'error', primijenjenoPolja: primijenjenoPolja, message: odbijenaPolja.join(' ') };
  }
  // NOVO (3.10.2026., Sašin zahtjev): kad se ponuda PREBACI među klijente (datum otvaranja se
  // postavi), klijentov Drive direktorij ("PONUDA - Naziv - OIB - Grad" sa SVIM verzijama i
  // dokumentima) fizički se premješta iz PONUDE/ u KLIJENTI/; "Vrati u ponude" (datum se
  // obriše) vraća ga natrag. Reparentira se isti direktorij (isti ID, ništa se ne kopira), a
  // Drive greška nikad ne poništava već upisanu promjenu u tablici.
  var driveNapomena = '';
  if (promjenaOtvaranja_) {
    try {
      if (!promjenaOtvaranja_.prije && promjenaOtvaranja_.poslije) {
        driveNapomena = premjestiKlijentFolderUKlijente_(sheet, header, rowIndex) ? 'Dokumentacija premještena u KLIJENTI.' : 'Direktorij ponude nije pronađen na Driveu — nije premještano.';
      } else if (promjenaOtvaranja_.prije && !promjenaOtvaranja_.poslije) {
        var vraceniFolder_ = vratiKlijentFolderIzArhive_(sheet, header, rowIndex);
        if (vraceniFolder_) {
          var rowV_ = sheet.getRange(rowIndex, 1, 1, header.length).getValues()[0];
          var imeV_ = 'PONUDA - ' + ((rowV_[header.indexOf('Naziv tvrtke')] || '').toString().trim() || '(bez naziva)') + ' - ' +
            ((rowV_[header.indexOf('OIB')] || '').toString().trim() || '(bez OIB-a)') + ' - ' +
            ((rowV_[header.indexOf('Mjesto')] || '').toString().trim().toUpperCase() || '(bez mjesta)');
          if (vraceniFolder_.getName() !== imeV_) { vraceniFolder_.setName(imeV_); }
        }
        driveNapomena = 'Dokumentacija vraćena u PONUDE.';
      }
    } catch (eDrv) {
      driveNapomena = 'Drive: premještanje direktorija nije uspjelo (' + eDrv + ') — premjesti ga ručno.';
    }
  }
  return { status: 'ok', primijenjenoPolja: primijenjenoPolja, driveNapomena: driveNapomena };
}

// Fizički premješta klijentov osnovni direktorij iz PONUDE/ u KLIJENTI/ (kad je ponuda prebačena
// među nove klijente). Isti obrazac kao premjestiKlijentFolderUKategorijuArhive_ (reparentiranje,
// isti Drive ID), ali NE stvara direktorij ako ga ponuda nikad nije imala. Vraća true ako je
// direktorij pronađen (i premješten ili već unutra), inače false.
function premjestiKlijentFolderUKlijente_(sheet, header, rowIndex) {
  var idCol = header.indexOf(ADMIN_ONLY_FIELDS.klijent_folder_id);
  var postojeciId = (idCol !== -1) ? String(sheet.getRange(rowIndex, idCol + 1).getValue() || '').trim() : '';
  var klijentFolder = null;
  if (postojeciId) {
    try { klijentFolder = DriveApp.getFolderById(postojeciId); } catch (err) { klijentFolder = null; }
  }
  if (!klijentFolder) {
    var row = sheet.getRange(rowIndex, 1, 1, header.length).getValues()[0];
    var naziv = (row[header.indexOf('Naziv tvrtke')] || '').toString().trim() || '(bez naziva)';
    var oib = (row[header.indexOf('OIB')] || '').toString().trim() || '(bez OIB-a)';
    var grad = (row[header.indexOf('Mjesto')] || '').toString().trim().toUpperCase() || '(bez mjesta)';
    var ime = 'PONUDA - ' + naziv + ' - ' + oib + ' - ' + grad;
    var trazeni = getSustavSubfolders_().ponude.getFoldersByName(ime);
    if (trazeni.hasNext()) { klijentFolder = trazeni.next(); }
  }
  if (!klijentFolder) { return false; }
  var ciljniRoditelj = getSustavSubfolders_().klijenti;
  var trenutniRoditelji = klijentFolder.getParents();
  var vecUnutra = false;
  while (trenutniRoditelji.hasNext()) {
    var roditelj = trenutniRoditelji.next();
    if (roditelj.getId() === ciljniRoditelj.getId()) { vecUnutra = true; continue; }
    roditelj.removeFolder(klijentFolder);
  }
  if (!vecUnutra) { ciljniRoditelj.addFolder(klijentFolder); }
  // Preimenovanje: "PONUDA - Naziv - OIB - GRAD" → "{TM broj} - Naziv - OIB - GRAD".
  var row2 = sheet.getRange(rowIndex, 1, 1, header.length).getValues()[0];
  var naziv2 = (row2[header.indexOf('Naziv tvrtke')] || '').toString().trim() || '(bez naziva)';
  var oib2 = (row2[header.indexOf('OIB')] || '').toString().trim() || '(bez OIB-a)';
  var grad2 = (row2[header.indexOf('Mjesto')] || '').toString().trim().toUpperCase() || '(bez mjesta)';
  var novoIme = klijentFolderCiljnoIme_(sheet, header, rowIndex, 'PONUDA - ' + naziv2 + ' - ' + oib2 + ' - ' + grad2);
  if (klijentFolder.getName() !== novoIme) { klijentFolder.setName(novoIme); }
  return true;
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
  // Obavijest o isteku (23.9.2026.) — ako je ponuda bila 'istekla' i Saša
  // sad produžuje rok ("Produži rok"), briše se zapis da je obavijest već
  // poslana (vidi ADMIN_ONLY_FIELDS.mail_istek_poslan) — ako ISTA verzija
  // ikad ponovno istekne, satni sweep treba ponovno obavijestiti klijenta,
  // ne šutke preskočiti jer je "već jednom poslano".
  var istekPoslanColRok_ = header.indexOf(ADMIN_ONLY_FIELDS.mail_istek_poslan);
  if (istekPoslanColRok_ !== -1) { sheet.getRange(rowIndex, istekPoslanColRok_ + 1).setValue(''); }
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
    ipPotvrdio: get('IP adresa prilikom potvrde ponude (admin)') || '',
    // Ocjena voditelja KAM (23.9.2026.) — arhivira se ovdje isto kao
    // ime/funkcija/IP iznad, prvenstveno za rubni slučaj gdje je Saša
    // poništio VEĆ prihvaćenu ponudu (ponistena_nakon_prihvata) pa se
    // generira nova verzija — bez ovoga bi ocjena nestala bez traga.
    ocjenaZnanje: get('Ocjena voditelja KAM - znanje (klijent)') || '',
    ocjenaPrezentacija: get('Ocjena voditelja KAM - prezentacija tvrtke (klijent)') || '',
    ocjenaUgovaranje: get('Ocjena voditelja KAM - nacin ugovaranja (klijent)') || ''
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
  // ISPRAVAK (23.9.2026.) — ISTI bug/ispravak kao kod adminPostaviRokPonude()
  // gore (deveti krug, TTD): ova funkcija NE smije odmah postaviti "Datum
  // slanja aktivne ponude" — to je trenutak kad Saša STVARNO pošalje mail
  // (adminPosaljiPonudaMail niže), ne trenutak generiranja nove poveznice.
  // Prijašnja vrijednost OVOG polja (od prošlog stvarnog slanja) mora se
  // ovdje eksplicitno OBRISATI — inače bi status odmah ispao 'na_cekanju'
  // (staro popunjeno polje + svježi budući rok) i zamrznuo blok "Slanje
  // ponude mailom" PRIJE nego je nova ponuda uopće poslana. Točno bug koji
  // je Saša prijavio: "čim izgeneriram drugu ponudu odmah se zamrzne gumb
  // za slanje i ne mogu je poslati".
  set('Datum slanja aktivne ponude (admin)', '');
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
  // Ocjena voditelja KAM (23.9.2026.) — čista ploča isto kao ostala
  // "prihvaćanje"-polja iznad, da ocjena od PRIJAŠNJE (odbijene/poništene)
  // verzije ne ostane vidljiva uz novu.
  set('Ocjena voditelja KAM - znanje (klijent)', '');
  set('Ocjena voditelja KAM - prezentacija tvrtke (klijent)', '');
  set('Ocjena voditelja KAM - nacin ugovaranja (klijent)', '');
  set('Datum poništenja prihvaćene ponude (admin)', '');
  set('Ime i prezime osobe koja je odbila ponudu (admin)', '');
  set('IP adresa prilikom odbijanja ponude (admin)', '');
  set('Poveznica na dokument odbijanja ponude (admin)', '');
  // Obavijest o isteku (23.9.2026.) — čista ploča isto kao ostala polja
  // iznad, da satni sweep (provjeriIIzvijestiIsteklePonude_) ponovno pošalje
  // obavijest ako i OVA (nova) verzija ikad istekne — inače bi zapamćeni
  // datum od PRIJAŠNJE istekle verzije trajno blokirao buduću obavijest.
  set('Datum slanja obavijesti o isteku ponude (admin)', '');
  // ISPRAVAK (23.9.2026., vidi resolveVerzijaFolderStabilno_ gore) — NAMJERNO
  // brisanje, ne bug: svaka nova verzija ponude legitimno dobiva SVOJ novi
  // predirektorij (novi brojPonude u imenu), pa spremljeni ID od PRIJAŠNJE
  // verzije ovdje ne smije "procuriti" u novu — sljedeći poziv koji treba
  // predirektorij (Pripremi direktorij i sl.) sam će ga iznova stvoriti i
  // spremiti svjež ID. "ID glavnog direktorija klijenta" (klijent_folder_id)
  // se NAMJERNO NE briše ovdje — taj folder je zajednički za SVE verzije
  // ovog klijenta, traje kroz cijeli njegov životni vijek.
  set('ID aktivnog predirektorija ponude (admin)', '');

  return {
    status: 'ok',
    verzija: novaVerzija,
    token: noviToken,
    link: POTVRDA_PONUDE_STRANICA_URL + '?token=' + encodeURIComponent(noviToken),
    // Namjerno PRAZNO (23.9.2026. ispravak) — "Datum slanja aktivne ponude"
    // se više NE postavlja ovdje (vidi napomenu gore, uz set(...) iznad);
    // InTime_Admin.html ovim odmah lokalno OBRIŠE prikaz tog polja u
    // entry.fields, dok ga stvarno slanje (adminPosaljiPonudaMail) ne
    // popuni iznova.
    datumSlanjaPrikaz: '',
    datumSlanjaPrikazSek: '',
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

  // ISPRAVAK (23.9.2026., Sašin izričit zahtjev — "možeš li napraviti
  // template koje će klijent dobiti na mail kad mi poništimo [ponudu]"):
  // ranije ovdje NIJE išla nikakva obavijest klijentu — link je jednostavno
  // prestao raditi, bez ijedne riječi objašnjenja. Sad se automatski šalje
  // MAIL_PREDLOZAK_HTML_PONISTENA_PONUDA_ (banner + tekst koje je Saša
  // odobrio) na istu listu adresa kao stvarno slanje ponude. Isti "non-
  // blocking" obrazac kao adminPonistiPrihvacenuPonudu() niže — ako slanje
  // maila zakaže (npr. nema primatelja), samo poništenje ponude se SVEJEDNO
  // provodi (već je upisano gore), a poslanoNa ostaje prazan popis.
  var nazivPonisti_ = (row[header.indexOf('Naziv tvrtke')] || '').toString().trim() || '(bez naziva)';
  var sifraSirovaPonisti_ = String(row[header.indexOf(ADMIN_ONLY_FIELDS.sifra_ponude)] || '').trim();
  var verzijaColPonisti_ = header.indexOf(ADMIN_ONLY_FIELDS.ponuda_verzija);
  var verzijaPonisti_ = (verzijaColPonisti_ !== -1 && parseInt(row[verzijaColPonisti_], 10)) || 1;
  var sifraPonudePonisti_ = sifraSirovaPonisti_ ? (sifraSirovaPonisti_ + '-P' + verzijaPonisti_) : '(bez broja ponude)';
  var mailAdreseSirovoPonisti_ = String(row[header.indexOf(ADMIN_ONLY_FIELDS.mail_adrese_ponude)] || '').trim();
  var primateljiPonisti_ = mailAdreseSirovoPonisti_
    ? mailAdreseSirovoPonisti_.split(',').map(function(a) { return a.trim(); }).filter(function(a) { return EMAIL_REGEX_.test(a); })
    : [];
  var poslanoNaPonisti_ = [];
  if (primateljiPonisti_.length) {
    try {
      var tijeloTekstPonisti_ = 'Poštovani,\n\n' +
        'Obavještavamo Vas da smo, zbog internih razloga na našoj strani, privremeno povukli ponudu koju smo Vam ranije uputili, prije nego što ste stigli donijeti odluku o njoj — poveznica za prihvaćanje/odbijanje trenutno nije aktivna.\n\n' +
        'Ovo ne znači da je suradnja isključena — naprotiv, uskoro ćemo Vam pripremiti novu, ažuriranu ponudu i ponovno Vas kontaktirati.\n\n' +
        'Zahvaljujemo Vam na razumijevanju i iskazanom interesu za suradnju s IN TIME d.o.o.\n\n' +
        'Srdačan pozdrav / Kind regards,\nSaša Batinac';
      posaljiMail_(primateljiPonisti_.join(','), 'PONUDA POVUČENA: ' + sifraPonudePonisti_, tijeloTekstPonisti_, { bcc: NOTIFY_EMAIL, htmlBody: MAIL_PREDLOZAK_HTML_PONISTENA_PONUDA_ });
      poslanoNaPonisti_ = primateljiPonisti_;
    } catch (errMailPonisti) {
      // Slanje maila ne smije srušiti samo poništenje — Saša svejedno vidi
      // (kroz prazan poslanoNa) ako obavijest nije uspjela otići.
    }
  }

  return {
    status: 'ok',
    datumPonistenjaPrikaz: Utilities.formatDate(sada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm'),
    datumPonistenjaPrikazSek: Utilities.formatDate(sada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm:ss'),
    poslanoNa: poslanoNaPonisti_
  };
}

// "Abandon" — Sašin izričit zahtjev (23.9.2026., trideset i šesti krug): MI
// odustajemo od klijenta (obrnuto od "Odbij ponudu", gdje KLIJENT odbija).
// Dostupno dok ponuda nije u nekom KONAČNOM ishodu (potvrđena/odbijena/
// poništena) i dok klijent još nije arhiviran. Klikom: (1) automatski šalje
// mail kontakt osobi klijenta — MAIL_PREDLOZAK_HTML_ODUSTAJANJE_ gore, Sašin
// doslovan tekst; (2) ODMAH prebacuje zapis u "Arhivu" (isto polje koje
// koristi ručni gumb "Prebaci u arhivu" u InTime_Admin.html —
// datum_prebacivanja_arhiva) I posebno obilježava datum_odustajanja_mi, da
// se u Arhivi ispiše crveno "ABANDON" (razlikuje se od "Prebaci u arhivu" iz
// drugih razloga, koje to drugo polje ne postavlja). Ako mail ne uspije
// poslati (npr. nema email adrese), NIŠTA se ne mijenja u tablici — Saša
// treba moći pokušati ponovno.
function adminOdustaniOdKlijenta(token, rowIndex) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];

  var arhivaCol = header.indexOf(ADMIN_ONLY_FIELDS.datum_prebacivanja_arhiva);
  if (arhivaCol !== -1 && String(row[arhivaCol] || '').trim()) {
    return { status: 'error', message: 'Klijent je već u Arhivi.' };
  }
  // ISPRAVLJENO (23.9.2026., trideset i sedmi krug, Sašin izričit zahtjev —
  // obrnuto od prvotne verzije): Abandon NIJE dopušten dok se stvarno čeka
  // odgovor ('na_cekanju') ni dok je istekla ('istekla') — to je JOŠ
  // otvoreno. JEST dopušten: prije nego je ponuda uopće poslana
  // ('nije_poslano'), ili kad je već odbijena, ili smo je MI poništili
  // (uklj. poništenu VEĆ prihvaćenu) — "to je rješenje ako ne možemo
  // pronaći model suradnje" (Sašine riječi). NIJE dopušten kad je
  // prihvaćena.
  var stanje = izracunajStatusPonude_(header, row);
  if (stanje === 'na_cekanju' || stanje === 'istekla' || stanje === 'potvrdjena') {
    return { status: 'error', message: 'Trenutno se čeka klijentov odgovor (ili je ponuda prihvaćena) — Abandon je dostupan tek ako klijent odbije ponudu, mi je poništimo, ili prije nego je ponuda uopće poslana.' };
  }

  var naziv = (row[header.indexOf('Naziv tvrtke')] || '').toString().trim() || '(bez naziva)';
  // Sašin izričit zahtjev (23.9.2026., trideset i sedmi krug): mail za
  // odustajanje ide na ISTU adresu(e) na koju je stvarno poslana ponuda
  // (ista lista kao ADMIN_ONLY_FIELDS.mail_adrese_ponude, koju
  // adminPosaljiPonudaMail/adminPonistiPrihvacenuPonudu već koriste) — ne na
  // "Email kontakt osobe" iz upitnika, koja se možda razlikuje od stvarno
  // odabranih primatelja. Ta lista postoji čim je ponuda ikad pripremljena
  // za slanje, pa pokriva 'odbijena'/'ponistena'/'ponistena_nakon_prihvata'.
  // Za 'nije_poslano' (ponuda nikad nije ni pripremljena) ta lista još ne
  // postoji, pa se onda koristi "Email kontakt osobe" iz upitnika kao
  // jedini razuman izvor.
  var mailAdreseSirovo_ = String(row[header.indexOf(ADMIN_ONLY_FIELDS.mail_adrese_ponude)] || '').trim();
  var primateljiOdustajanje_ = mailAdreseSirovo_
    ? mailAdreseSirovo_.split(',').map(function(a) { return a.trim(); }).filter(function(a) { return EMAIL_REGEX_.test(a); })
    : [];
  if (!primateljiOdustajanje_.length) {
    var kontaktEmailCol = header.indexOf('Email kontakt osobe');
    var kontaktEmail = (kontaktEmailCol !== -1) ? String(row[kontaktEmailCol] || '').trim() : '';
    if (kontaktEmail && EMAIL_REGEX_.test(kontaktEmail)) { primateljiOdustajanje_ = [kontaktEmail]; }
  }
  if (!primateljiOdustajanje_.length) {
    return { status: 'error', message: 'Nema nijedne ispravne email adrese (ni iz slanja ponude, ni iz upitnika) — ne mogu poslati mail. Dodaj adresu ili obavijesti klijenta ručno.' };
  }

  var predmet = 'IN TIME d.o.o. — povratna informacija o mogućnosti suradnje';
  var tijeloTekst_ = 'Poštovani,\n\n' +
    'Zahvaljujemo Vam na iskazanom interesu i vremenu uloženom u razmatranje mogućnosti suradnje s IN TIME d.o.o.\n\n' +
    'Nakon detaljne analize Vaših zahtjeva i trenutačno raspoloživih mogućnosti, nažalost smo zaključili kako Vam u ovom trenutku ne možemo ponuditi model suradnje koji bi na odgovarajući način ispunio Vaša očekivanja, a istodobno bio dugoročno održiv i poslovno opravdan za obje strane.\n\n' +
    'Budući da u ovom trenutku nismo uspjeli pronaći kvalitetno i obostrano prihvatljivo „win-win” rješenje, smatramo kako ne bi bilo korektno započinjati suradnju pod uvjetima koji ne bi u potpunosti odgovarali Vašim potrebama.\n\n' +
    'Ukoliko se u budućnosti promijene okolnosti i otvorimo mogućnost kreiranja ponude za koju procijenimo da bi Vam bila realno prihvatljiva i komercijalno opravdana, svakako ćemo Vas ponovno kontaktirati s novim prijedlogom suradnje.\n\n' +
    'Do tada Vam i dalje stojimo na raspolaganju za sva pitanja, dodatne informacije ili eventualne buduće potrebe.\n\n' +
    'Zahvaljujemo Vam na razumijevanju i želimo Vam mnogo poslovnog uspjeha.\n\n' +
    'Srdačan pozdrav / Kind regards,\nSaša Batinac';

  try {
    posaljiMail_(primateljiOdustajanje_.join(','), predmet, tijeloTekst_, { bcc: NOTIFY_EMAIL, htmlBody: MAIL_PREDLOZAK_HTML_ODUSTAJANJE_ });
  } catch (errMail) {
    return { status: 'error', message: 'Slanje maila nije uspjelo: ' + errMail.message };
  }

  var sada = new Date();
  var datumPrikaz = Utilities.formatDate(sada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm');
  if (arhivaCol !== -1) { sheet.getRange(rowIndex, arhivaCol + 1).setValue(datumPrikaz); }
  var odustajanjeCol = header.indexOf(ADMIN_ONLY_FIELDS.datum_odustajanja_mi);
  if (odustajanjeCol !== -1) { sheet.getRange(rowIndex, odustajanjeCol + 1).setValue(datumPrikaz); }
  // NOVO (23.9.2026., Sašin izričit zahtjev) — Abandon UVIJEK dobiva
  // kategoriju 'ABANDON', bez obzira na status ponude u tom trenutku (za
  // razliku od adminPrebaciUArhivu niže, koja kategoriju IZVODI iz statusa).
  var kategorijaCol = header.indexOf(ADMIN_ONLY_FIELDS.arhiva_kategorija);
  if (kategorijaCol !== -1) { sheet.getRange(rowIndex, kategorijaCol + 1).setValue('ABANDON'); }
  try {
    // Svježi header (kategorijaCol/arhivaCol gore su iz PRIJE ovog upisa —
    // funkcija ispod čita svoj header parametar samo za indexOf, pa je isti
    // 'header' i dalje ispravan, budući da se stupci ne pomiču).
    premjestiKlijentFolderUKategorijuArhive_(sheet, header, rowIndex, 'ABANDON');
  } catch (errDrive) {
    // Drive premještanje NIKAD ne smije poništiti/srušiti sam Abandon — mail
    // je već poslan, Sheet polja su već zapisana.
  }

  return { status: 'ok', datumPrikaz: datumPrikaz, naziv: naziv, poslanoNa: primateljiOdustajanje_ };
}

// "Prebaci u arhivu" (obično, NE Abandon) — Sašin izričit zahtjev
// (23.9.2026.): fizički premjesti dokumentaciju klijenta na Driveu u
// ARHIVA/<kategorija>/, gdje se kategorija izvodi iz TRENUTNOG statusa
// ponude (odbijena/poništena/nije dovršena — vidi odrediArhivaKategoriju_
// gore). Zamjenjuje dosadašnji generički poziv adminUpdateFields s
// {datum_prebacivanja_arhiva: ...} iz InTime_Admin.html — isti Sheet upis,
// PLUS kategorija i fizičko premještanje na Driveu, PLUS izričita zabrana za
// prihvaćenu ponudu (Sašine riječi: "ako je prihvaćena onda je nećemo
// stavljati u arhivu, takve ponude stavljamo na drugo mjesto" — to "drugo
// mjesto" nije ovaj tok, ostaje kako je bilo, ova funkcija samo odbija).
function adminPrebaciUArhivu(token, rowIndex) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];

  var arhivaCol = header.indexOf(ADMIN_ONLY_FIELDS.datum_prebacivanja_arhiva);
  if (arhivaCol !== -1 && String(row[arhivaCol] || '').trim()) {
    return { status: 'error', message: 'Klijent je već u Arhivi.' };
  }
  var stanje = izracunajStatusPonude_(header, row);
  if (stanje === 'potvrdjena') {
    return { status: 'error', message: 'Prihvaćena ponuda se ne prebacuje u Arhivu.' };
  }
  var kategorija = odrediArhivaKategoriju_(stanje);

  var sada = new Date();
  var datumPrikaz = Utilities.formatDate(sada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm:ss');
  if (arhivaCol !== -1) { sheet.getRange(rowIndex, arhivaCol + 1).setValue(datumPrikaz); }
  var kategorijaCol = header.indexOf(ADMIN_ONLY_FIELDS.arhiva_kategorija);
  if (kategorijaCol !== -1) { sheet.getRange(rowIndex, kategorijaCol + 1).setValue(kategorija); }

  try {
    premjestiKlijentFolderUKategorijuArhive_(sheet, header, rowIndex, kategorija);
  } catch (errDrive) {
    // Isto kao kod Abandona — Drive dio nikad ne smije poništiti Sheet upis.
  }

  return { status: 'ok', datumPrikaz: datumPrikaz, kategorija: kategorija };
}

// "Vrati u ponude" — Sašin izričit zahtjev (23.9.2026.): "i sve se takve
// ponude moraju moći vratiti u ponude". Radi za BILO KOJI zapis trenutno u
// Arhivi, bez obzira kojim putem je tamo stigao (Abandon ili obično
// "Prebaci u arhivu") — briše datum_prebacivanja_arhiva (zapis se time vraća
// pod karticu "Ponude", vidi jeArhiva()/jePonuda() u InTime_Admin.html) i
// arhiva_kategorija, te fizički vraća direktorij na Driveu natrag u PONUDE/.
// NAMJERNO NE dira datum_odustajanja_mi ("bio je Abandon" ostaje trajan
// povijesni trag, isto kao što se prihvaćanje/odbijanje ne briše kod
// restarta ponude) — ne utječe ni na što nakon vraćanja jer jeArhiva() gleda
// isključivo datum_prebacivanja_arhiva.
function adminVratiIzArhive(token, rowIndex) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];

  var arhivaCol = header.indexOf(ADMIN_ONLY_FIELDS.datum_prebacivanja_arhiva);
  if (arhivaCol === -1 || !String(row[arhivaCol] || '').trim()) {
    return { status: 'error', message: 'Klijent trenutno nije u Arhivi.' };
  }
  sheet.getRange(rowIndex, arhivaCol + 1).setValue('');
  var kategorijaCol = header.indexOf(ADMIN_ONLY_FIELDS.arhiva_kategorija);
  if (kategorijaCol !== -1) { sheet.getRange(rowIndex, kategorijaCol + 1).setValue(''); }

  try {
    vratiKlijentFolderIzArhive_(sheet, header, rowIndex);
  } catch (errDrive) {
    // Drive dio nikad ne smije poništiti sâmo vraćanje u Sheetu.
  }

  return { status: 'ok' };
}

// Sakrij/otkrij OZNAČENE zapise u "InTime_Upiti" Sheetu (pokriva tabove
// Zainteresirani/Ponude/Arhiva/Nisu zainteresirani/Klijenti — svih 5 dijeli
// isti Sheet) — Sašin izričit zahtjev (23.9.2026., Dio 2 velikog zahtjeva o
// arhiviranju: "svuda... napravi isto kao u imeniku mogućnost sakrivanja na
// istu logiku... i mogu odredene stvari sakriti i maknuti"). ISTI obrazac
// kao adminSetImenikSkriveno() gore (redak ostaje, samo se postavlja
// zastavica — pretraživo je i dalje, "neka piše skriveno ako ga pronađe"),
// samo s dinamičkim header.indexOf(ADMIN_ONLY_FIELDS.skriveno) umjesto
// fiksnog IMENIK_COL.SKRIVENO, jer "InTime_Upiti" nema fiksne pozicijske
// stupce.
function adminSetUpitiSkriveno(token, rowIndexes, skriveno) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndexes = rowIndexes || [];
  var sheet = getOrCreateUpitiSheet();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var skrivenoCol = header.indexOf(ADMIN_ONLY_FIELDS.skriveno);
  if (skrivenoCol === -1) { return { status: 'error', message: 'Stupac "Skriveno" nije pronađen — pokušajte ponovno učitati stranicu.' }; }
  var vrijednost = skriveno ? 'Da' : 'Ne';
  var primijenjeno = 0;
  rowIndexes.forEach(function(rIdx) {
    var rowIndex = parseInt(rIdx, 10);
    if (!rowIndex || rowIndex < 2 || rowIndex > lastRow) { return; }
    sheet.getRange(rowIndex, skrivenoCol + 1).setValue(vrijednost);
    primijenjeno++;
  });
  return { status: 'ok', primijenjeno: primijenjeno };
}

// Isto kao adminSetUpitiSkriveno() gore, samo za "InTime_Ankete" Sheet
// (tab Ankete kvalitete) — zaseban Sheet, pa zasebna funkcija, isti obrazac.
function adminSetAnketaSkriveno(token, rowIndexes, skriveno) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndexes = rowIndexes || [];
  var sheet = getOrCreateAnketaSheet();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var skrivenoCol = header.indexOf(ADMIN_ONLY_FIELDS.skriveno);
  if (skrivenoCol === -1) { return { status: 'error', message: 'Stupac "Skriveno" nije pronađen — pokušajte ponovno učitati stranicu.' }; }
  var vrijednost = skriveno ? 'Da' : 'Ne';
  var primijenjeno = 0;
  rowIndexes.forEach(function(rIdx) {
    var rowIndex = parseInt(rIdx, 10);
    if (!rowIndex || rowIndex < 2 || rowIndex > lastRow) { return; }
    sheet.getRange(rowIndex, skrivenoCol + 1).setValue(vrijednost);
    primijenjeno++;
  });
  return { status: 'ok', primijenjeno: primijenjeno };
}

// Rekurzivno skuplja SVE datoteke unutar foldera (uklj. poddirektorije,
// npr. "POSLANO - ...") kao Blob-ove, s imenom koje nosi relativnu putanju
// (koristi "/" kao razdjelnik) — tako Utilities.zip() niže stvara ZIP s
// pravom unutarnjom strukturom foldera, ne samo ravan popis datoteka.
// Google-native datoteke (Dokument potvrde/odbijanja — DocumentApp, nikad
// pretvorene u PDF) NEMAJU izravan getBlob() izvoz, pa se posebno izvoze kao
// PDF preko getAs(); obična binarna datoteka (PDF/XLSX/JPG) ide kroz
// getBlob(). Pojedinačna datoteka koja ne uspije izvesti se PRESKAČE (ne
// smije srušiti cijeli zip zbog jedne loše datoteke).
function skupiBlobsIzFoldera_(folder, prefiks) {
  var blobovi = [];
  var datoteke = folder.getFiles();
  while (datoteke.hasNext()) {
    var f = datoteke.next();
    try {
      var jeGoogleNativno = f.getMimeType().indexOf('application/vnd.google-apps.') === 0;
      var blob = jeGoogleNativno ? f.getAs(MimeType.PDF) : f.getBlob();
      blob.setName(prefiks + f.getName() + (jeGoogleNativno && f.getName().toLowerCase().indexOf('.pdf') === -1 ? '.pdf' : ''));
      blobovi.push(blob);
    } catch (errBlob) { /* jedna neuspjela datoteka ne smije srušiti cijeli zip — preskoči */ }
  }
  var poddirektoriji = folder.getFolders();
  while (poddirektoriji.hasNext()) {
    var pod = poddirektoriji.next();
    blobovi = blobovi.concat(skupiBlobsIzFoldera_(pod, prefiks + pod.getName() + '/'));
  }
  return blobovi;
}

// "Restartiraj ponudu" (Sašin izričit zahtjev, 23.9.2026., trideset i
// treći krug — "dugme za restartiranje ponude... sve za vezanog klijenta se
// restartira na 0, kao da nije niti jedna ponuda poslana"; DOPUNA istog
// dana: "kad restartiram želim da se sve ponude ne obrišu već da se zipaju
// u naziv osnovne ponude... osnovni direktorij ponude se komprimira i
// preimenuje u naziv ponude - RESTART... sve to se kopira i ostaje u
// glavnom direktoriju klijenta, samo u obliku zipa... sve ostalo se
// briše"): vraća CIJELU ponudu ovog retka na 0 — briše (postavlja na '')
// SVA polja koja opisuju životni ciklus TE ponude (šifra, verzija,
// rok/status, povijest, potvrda/odbijanje/poništenje, linkovi i JSON
// popisi pripremljenih dokumenata). NAMJERNO NE dira: osnovne podatke
// klijenta (naziv/OIB/odgovori iz upitnika — cijeli UPIT_FIELDS blok),
// datum_prebacivanja_ponude (bez njega bi redak posve nestao iz kartice
// "Ponude"), nadleznu poslovnicu, internu napomenu/napomenu KAM-a, ni
// TM/OB podatke (identifikacijski_tm_broj, datum_otvaranja_ob,
// ob_username, ob_password, zadnje_vrijeme_unosa, admin_vrijeme_prikupa,
// datum_otvaranja) — svi ti opisuju SAM klijentov odnos s nama, ne ovu
// konkretnu ponudu.
//
// Drive strana (predirektorij TE ponude, uklj. poddirektorij POSLANO):
// SVE datoteke unutra (rekurzivno) se pakiraju u JEDAN .zip, nazvan
// "{broj ponude} - {naziv} - {OIB} - {grad} - RESTART.zip", koji se sprema
// u klijentov OSNOVNI direktorij (razina 1, gdje već žive npr. export
// upitnika i eventualni stari uploadi) — POKRAJ dokumenata koji su već
// ondje, ne preko njih. Sam predirektorij (i njegov poddirektorij POSLANO)
// se NAKON toga trajno briše (setTrashed) — ništa ne ostaje "napola",
// arhiva je isključivo taj jedan zip. Umotano u try/catch: ako Drive
// operacija (zip/kopiranje/brisanje) padne iz bilo kojeg razloga (npr.
// folder ručno već obrisan/premješten), restart polja u Sheetu SVEJEDNO
// prolazi — Drive arhiviranje nikad ne smije blokirati sâm reset.
// Zaštita (admin lozinka + potvrda riječju) provodi se u InTime_Admin.html
// PRIJE ovog poziva (isti obrazac kao adminMasterResetBrojace iznad) —
// ovdje se, kao i svugdje, provjerava samo da je sesija još valjana.
function adminRestartPonudu(token, rowIndex) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var sheet = getOrCreateUpitiSheet();
  if (rowIndex > sheet.getLastRow()) { return { status: 'error', message: 'Redak više ne postoji (možda je već obrisan).' }; }
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];

  // zipUpozorenje_ — 24.9.2026., Sašin bug-report ("nije se ništa zazipalo,
  // ponuda maknuta nakon restarta, sve još stoji na Disku"): dok se
  // Drive/zip greška hvatala potpuno tiho (return { status: 'ok' } bez ikakve
  // naznake), admin nije mogao vidjeti JE LI arhiva uopće nastala. Ova
  // varijabla sad bilježi RAZLOG kad zip/arhiviranje izostane (bilo zbog
  // neispravnog/praznog linka na predirektorij, bilo zbog stvarne
  // iznimke pri Utilities.zip/Drive pozivu) i vraća se u odgovoru kao
  // 'zipUpozorenje', tako da InTime_Admin.html to prikaže korisniku —
  // reset polja u Sheetu i dalje NIKAD ne ovisi o ovome (ista logika kao
  // prije, samo više ne gutamo poruku o grešci).
  //
  // PROŠIRENO (25.9.2026., Sašin izričit zahtjev nakon testiranja — "vidim
  // samo da je zadnju ponudu zapakirao... sve zapakirati i sve stare
  // verzije nakon zipiranja obrisati, nek ostane samo zip"): dosad se
  // zipala i brisala SAMO trenutačna (zadnja) verzija ponude — jer je Sheet
  // pamtio link SAMO do trenutnog predirektorija (svaka "Generiraj novu
  // ponudu" taj link prepiše; stari link se gubi iz Sheeta, ali sâm FOLDER
  // na Disku ostaje, "siroče", nezipan i neobrisan). Od sad se pronalaze
  // SVE verzije ove ponude — svi predirektoriji izravno unutar klijentovog
  // glavnog direktorija čije ime počinje sa šifrom ponude + "-P" (npr.
  // "PO-0002-SB-ZLA-2026-P1", "...-P2", "...-P3"..., uključujući eventualni
  // "- PRIHVAĆENA" sufiks) — sve se zipa u JEDAN zip (svaka verzija u
  // svom potfolderu unutar zipa, po imenu foldera), i SVI pronađeni
  // direktoriji se nakon toga trajno brišu s Diska — ostaje isključivo
  // taj jedan zip, u klijentovom glavnom direktoriju.
  var zipUpozorenje_ = null;
  try {
    // Klijentov glavni direktorij — traži se PRVENSTVENO preko trajno
    // spremljenog ID-a (klijent_folder_id, isti obrazac kao
    // resolveKlijentFolderStabilno_ gore), jer taj link restart NIKAD ne
    // briše i ne ovisi o tome ima li trenutna verzija uopće pripremljen
    // predirektorij. Pada natrag na "preko trenutnog predirektorija" SAMO
    // ako taj ID nedostaje/više ne postoji (stariji zapisi, prije nego je
    // klijent_folder_id uveden).
    var klijentFolderIdCol_ = header.indexOf(ADMIN_ONLY_FIELDS.klijent_folder_id);
    var klijentFolderId_ = (klijentFolderIdCol_ !== -1) ? String(row[klijentFolderIdCol_] || '').trim() : '';
    var klijentFolder_ = null;
    if (klijentFolderId_) {
      try { klijentFolder_ = DriveApp.getFolderById(klijentFolderId_); } catch (errKf) { klijentFolder_ = null; }
    }
    if (!klijentFolder_) {
      var linkPredirektorijColFallback_ = header.indexOf(ADMIN_ONLY_FIELDS.link_predirektorij_ponude);
      var linkPredirektorijFallback_ = (linkPredirektorijColFallback_ !== -1) ? String(row[linkPredirektorijColFallback_] || '').trim() : '';
      var poklapanjeIdFallback_ = linkPredirektorijFallback_.match(/folders\/([a-zA-Z0-9_-]+)/);
      if (poklapanjeIdFallback_) {
        try {
          var predirektorijFolderFallback_ = DriveApp.getFolderById(poklapanjeIdFallback_[1]);
          klijentFolder_ = predirektorijFolderFallback_.getParents().hasNext() ? predirektorijFolderFallback_.getParents().next() : null;
        } catch (errPf) { klijentFolder_ = null; }
      }
    }

    if (!klijentFolder_) {
      zipUpozorenje_ = 'ZIP arhiva NIJE napravljena — nije pronađen klijentov glavni direktorij na Disku (ni preko spremljenog ID-a, ni preko linka na predirektorij ponude).';
    } else {
      var naziv_ = (row[header.indexOf('Naziv tvrtke')] || '').toString().trim() || '(bez naziva)';
      var oib_ = (row[header.indexOf('OIB')] || '').toString().trim() || '(bez OIB-a)';
      var grad_ = (row[header.indexOf('Mjesto')] || '').toString().trim().toUpperCase() || '(bez mjesta)';
      var sifraSirovaRestart_ = (row[header.indexOf(ADMIN_ONLY_FIELDS.sifra_ponude)] || '').toString().trim();

      // Pronađi SVE verzije: svaki direktan poddirektorij klijentovog
      // foldera čije ime počinje sa "{šifra}-P" — to su predirektoriji SVIH
      // dosadašnjih verzija ove ponude (P1, P2, P3...), bez obzira ima li
      // Sheet trenutno spremljen link do njih ili ne.
      var verzijaFolderi_ = [];
      if (sifraSirovaRestart_) {
        var itKf_ = klijentFolder_.getFolders();
        while (itKf_.hasNext()) {
          var fKf_ = itKf_.next();
          if (fKf_.getName().indexOf(sifraSirovaRestart_ + '-P') === 0) { verzijaFolderi_.push(fKf_); }
        }
      }
      // Fallback za rubni slučaj (šifra nepoznata/prazna, ili nijedan
      // folder nije pronađen po prefiksu) — probaj barem trenutni
      // predirektorij preko spremljenog linka, kao i prije ovog proširenja.
      if (verzijaFolderi_.length === 0) {
        var linkPredirektorijCol_ = header.indexOf(ADMIN_ONLY_FIELDS.link_predirektorij_ponude);
        var linkPredirektorij_ = (linkPredirektorijCol_ !== -1) ? String(row[linkPredirektorijCol_] || '').trim() : '';
        var poklapanjeId_ = linkPredirektorij_.match(/folders\/([a-zA-Z0-9_-]+)/);
        if (poklapanjeId_) {
          try { verzijaFolderi_.push(DriveApp.getFolderById(poklapanjeId_[1])); } catch (errPf2) { /* ignoriraj, nema što dodati */ }
        }
      }

      if (verzijaFolderi_.length === 0) {
        zipUpozorenje_ = 'ZIP arhiva NIJE napravljena — nije pronađen nijedan direktorij verzije ove ponude (ni po šifri, ni preko spremljenog linka).';
      } else {
        var imeZipa_ = sifraSirovaRestart_ ?
          (sifraSirovaRestart_ + ' - ' + naziv_ + ' - ' + oib_ + ' - ' + grad_ + ' - RESTART') :
          (verzijaFolderi_[0].getName() + ' - RESTART');

        var blobovi_ = [];
        verzijaFolderi_.forEach(function(vf_) {
          blobovi_ = blobovi_.concat(skupiBlobsIzFoldera_(vf_, vf_.getName() + '/'));
        });

        if (blobovi_.length > 0) {
          var zipBlob_ = Utilities.zip(blobovi_, imeZipa_ + '.zip');
          // Ako već postoji zip istog imena (npr. ponovljeni restart iste
          // ponude) — ukloni stari da se ne gomilaju kopije.
          var postojeciZip_ = klijentFolder_.getFilesByName(imeZipa_ + '.zip');
          while (postojeciZip_.hasNext()) { postojeciZip_.next().setTrashed(true); }
          klijentFolder_.createFile(zipBlob_);
        } else {
          zipUpozorenje_ = 'Nijedna od pronađenih verzija ponude (' + verzijaFolderi_.length + ') nije imala nijednu datoteku za arhivirati — direktoriji su obrisani bez ZIP-a (nije bilo što spakirati).';
        }
        // Sve pronađene verzije se brišu, bez obzira je li zip uspio (isto
        // ponašanje kao i prije ovog proširenja, samo sad za SVE verzije,
        // ne samo zadnju).
        verzijaFolderi_.forEach(function(vf_) { vf_.setTrashed(true); });
      }
    }
  } catch (errZip) {
    // Zip/arhiviranje na Driveu nije uspjelo (npr. folder ručno obrisan/
    // premješten, ili nedostaje ovlast) — restart polja u Sheetu ispod se
    // svejedno provodi. Razlog se sad bilježi u zipUpozorenje_ umjesto da
    // se potpuno progunta (vidi komentar iznad funkcije, 24.9.2026.).
    zipUpozorenje_ = 'ZIP arhiviranje na Disku nije uspjelo: ' + (errZip && errZip.message ? errZip.message : String(errZip));
  }

  try {
    var aktivniFolderColRestart_ = header.indexOf(ADMIN_ONLY_FIELDS.aktivni_folder_dokumenti_id);
    var aktivniFolderIdRestart_ = (aktivniFolderColRestart_ !== -1) ? String(row[aktivniFolderColRestart_] || '').trim() : '';
    if (aktivniFolderIdRestart_) {
      DriveApp.getFolderById(aktivniFolderIdRestart_).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    }
  } catch (err) {
    // Folder možda već obrisan gore (ili ručno obrisan/premješten) —
    // restart se svejedno provodi.
  }

  var poljaZaBrisanje_ = [
    ADMIN_ONLY_FIELDS.sifra_ponude,
    ADMIN_ONLY_FIELDS.dokumenti_ponude,
    ADMIN_ONLY_FIELDS.dokument_analiticki_cjenik,
    ADMIN_ONLY_FIELDS.dokument_cjenik_hrvatska,
    ADMIN_ONLY_FIELDS.dokument_ponuda_suradnja,
    ADMIN_ONLY_FIELDS.aktivni_folder_dokumenti_id,
    ADMIN_ONLY_FIELDS.link_dokumenti_ponude,
    ADMIN_ONLY_FIELDS.link_predirektorij_ponude,
    // ISPRAVAK (23.9.2026., vidi resolveVerzijaFolderStabilno_ gore) —
    // predirektorijFolder_ se par redaka gore trajno TRASHIRA (setTrashed),
    // pa spremljeni ID MORA nestati odavde — inače bi sljedeća ponuda ovog
    // klijenta (nova šifra, novi predirektorij) pokušala ponovno iskoristiti
    // ID foldera koji je sad u košu. "ID glavnog direktorija klijenta"
    // (klijent_folder_id) NAMJERNO NIJE ovdje — taj folder restart NE briše.
    ADMIN_ONLY_FIELDS.aktivni_predirektorij_folder_id,
    ADMIN_ONLY_FIELDS.mail_adrese_ponude,
    ADMIN_ONLY_FIELDS.token_potvrda_ponude,
    ADMIN_ONLY_FIELDS.potvrda_ime_osobe,
    ADMIN_ONLY_FIELDS.potvrda_funkcija_osobe,
    ADMIN_ONLY_FIELDS.potvrda_ip_adresa,
    ADMIN_ONLY_FIELDS.potvrda_dokument_url,
    ADMIN_ONLY_FIELDS.rok_dana_ponude,
    ADMIN_ONLY_FIELDS.datum_isteka_ponude,
    ADMIN_ONLY_FIELDS.ponuda_datum_slanja,
    ADMIN_ONLY_FIELDS.ponuda_verzija,
    ADMIN_ONLY_FIELDS.ponuda_datum_odbijanja,
    ADMIN_ONLY_FIELDS.ponuda_razlog_odbijanja,
    ADMIN_ONLY_FIELDS.ponuda_dokument_odbijanja_url,
    ADMIN_ONLY_FIELDS.ponuda_datum_ponistenja,
    ADMIN_ONLY_FIELDS.ponuda_povijest_json,
    ADMIN_ONLY_FIELDS.ponuda_datum_ponistenja_nakon_prihvata,
    ADMIN_ONLY_FIELDS.ponuda_ime_osobe_odbila,
    ADMIN_ONLY_FIELDS.ponuda_ip_odbijanja,
    ADMIN_ONLY_FIELDS.datum_prihvacanja_ponude
  ];
  poljaZaBrisanje_.forEach(function(labelPolja) {
    var idx = header.indexOf(labelPolja);
    if (idx === -1) { return; }
    sheet.getRange(rowIndex, idx + 1).setValue('');
  });

  return { status: 'ok', zipUpozorenje: zipUpozorenje_ || null };
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
  // Obavijest o isteku (23.9.2026.) — isti razlog kao u adminPostaviRokPonude()
  // iznad: ako ISTA (otključana) verzija ikad ponovno istekne, satni sweep
  // treba ponovno obavijestiti klijenta.
  var istekPoslanColOtkljucaj_ = header.indexOf(ADMIN_ONLY_FIELDS.mail_istek_poslan);
  if (istekPoslanColOtkljucaj_ !== -1) { sheet.getRange(rowIndex, istekPoslanColOtkljucaj_ + 1).setValue(''); }

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
  // ISPRAVAK (22.9.2026., dvanaesti krug — Sašin izričit zahtjev): raniji kod
  // je ovdje čitao SAMO sirovu INTRIX šifru ("Šifra ponude (admin)"), bez
  // "-P{verzija}" sufiksa — zato je naslov maila znao ispasti BEZ punog broja
  // ponude kad se ova funkcija koristila na 2. ili 3. korigiranoj ponudi
  // (npr. "5678-44-2026" umjesto "5678-44-2026-P3"). Broj ponude se odsad
  // računa POTPUNO ISTOM formulom kao svugdje drugdje u sustavu (vidi
  // adminPripremiDokumenteZaPonudu, zabiljeziEvidencijuSlanja_, {{BROJ_PONUDE}}
  // tag) — jedan izvor istine.
  var sifraSirova_ = String(row[header.indexOf(ADMIN_ONLY_FIELDS.sifra_ponude)] || '').trim();
  var verzijaCol_ = header.indexOf(ADMIN_ONLY_FIELDS.ponuda_verzija);
  var verzija_ = (verzijaCol_ !== -1 && parseInt(row[verzijaCol_], 10)) || 1;
  var sifraPonude = sifraSirova_ ? (sifraSirova_ + '-P' + verzija_) : '(bez broja ponude)';

  // ISPRAVAK (Sašin izričit zahtjev, 25.9.2026.): kad se prihvaćena ponuda
  // poništi, direktorij TE VERZIJE na Google Driveu do sad je zauvijek
  // ostajao s nazivom "... - PRIHVAĆENA" (dodano kod samog prihvaćanja,
  // vidi stvoriDokumentPotvrdePonude_ gore) — nikad se nije mijenjao natrag.
  // Ako bi se kasnije generirala i prihvatila NOVA verzija (P2, P3...), na
  // Driveu bi istovremeno postojala DVA (ili više) direktorija, svaki s
  // "- PRIHVAĆENA" u nazivu, što zbunjuje (stvaran slučaj iz produkcije:
  // "...-P1" i "...-P2" oba "PRIHVAĆENA" istovremeno, iako je P1 davno
  // poništena). Sad se, odmah nakon poništenja, sufiks na OVOJ (poništenoj)
  // verziji mijenja u "- PONIŠTENA" — isti folder (stabilno po ID-u, ista
  // resolveVerzijaFolderStabilno_ formula kao svugdje drugdje), samo ažuran
  // naziv. Ako sifra ponude nikad nije potvrđena (sifraSirova_ prazan),
  // folder nikad nije ni dobio sufiks "- PRIHVAĆENA" pa nema se što
  // preimenovati — tiho se preskače. Cijeli blok u try/catch: preimenovanje
  // NIKAD ne smije srušiti samo poništenje (datum poništenja je već
  // zabilježen gore) — ako Drive poziv ne uspije, Saša folder može
  // preimenovati ručno.
  if (sifraSirova_) {
    try {
      var gradPonist_ = String(row[header.indexOf('Mjesto')] || '').trim() || '(bez mjesta)';
      var gradZaNazivPonist_ = (gradPonist_ !== '(bez mjesta)') ? gradPonist_.toUpperCase() : gradPonist_;
      var oibPonist_ = String(row[header.indexOf('OIB')] || '').trim();
      var subPonist_ = getSustavSubfolders_();
      var klijentFolderNamePonist_ = 'PONUDA - ' + naziv + ' - ' + oibPonist_ + ' - ' + gradZaNazivPonist_;
      var klijentFolderPonist_ = resolveKlijentFolderStabilno_(sheet, header, rowIndex, subPonist_.ponude, klijentFolderNamePonist_);
      var verzijaFolderNameBaznoPonist_ = sifraPonude + ' - ' + naziv + ' - ' + oibPonist_ + ' - ' + gradZaNazivPonist_;
      var verzijaFolderPonist_ = resolveVerzijaFolderStabilno_(sheet, header, rowIndex, klijentFolderPonist_, verzijaFolderNameBaznoPonist_);
      var imeSadPonist_ = verzijaFolderPonist_.getName();
      if (imeSadPonist_.indexOf(' - PRIHVAĆENA') !== -1) {
        verzijaFolderPonist_.setName(imeSadPonist_.replace(' - PRIHVAĆENA', ' - PONIŠTENA'));
      }
    } catch (errPonist_) {
      // Vidi napomenu gore — poništenje u Sheetu je već zabilježeno, folder
      // na Driveu Saša po potrebi preimenuje ručno.
    }
  }

  var mailAdreseSirovo = String(row[header.indexOf('Mail adrese za slanje ponude (admin)')] || '').trim();
  var primatelji = mailAdreseSirovo ? mailAdreseSirovo.split(',').map(function(a) { return a.trim(); }).filter(function(a) { return EMAIL_REGEX_.test(a); }) : [];

  var poslanoNa = [];
  if (primatelji.length) {
    try {
      // Naslov, tekst i banner — Sašin izričit zahtjev (22.9.2026., dvanaesti
      // krug). "Mali skriveni template" — MAIL_PREDLOZAK_HTML_NEGATIVNA_VERIFIKACIJA_
      // (vidi definiciju gore) — HTML, s bannerom koji je Saša priložio, NIJE
      // u izborniku predložaka, koristi se samo ovdje.
      var tijeloTekst_ = 'Poštovani,\n\n' +
        'Nažalost, moramo Vas obavijestiti da predloženi model suradnje u ovom trenutku nije pozitivno verificiran od strane Uprave IN TIME d.o.o. u Zagrebu.\n\n' +
        'Ljubazno Vas molimo za još malo strpljenja. Nakon dodatnog razmatranja svih mogućnosti, povratno ćemo Vas kontaktirati s novim prijedlogom suradnje, za koji vjerujemo da će biti prihvatljiv objema stranama.\n\n' +
        'Zahvaljujemo Vam na razumijevanju i iskazanom interesu za suradnju s IN TIME d.o.o.\n\n' +
        'Srdačan pozdrav / Kind regards,\n\n' +
        'Saša Batinac\n' +
        'Voditelj ključnih kupaca';
      posaljiMail_(primatelji.join(','), 'OBAVIJEST O NEGATIVNOJ VERIFIKACIJI PONUDE: ' + sifraPonude, tijeloTekst_, { bcc: NOTIFY_EMAIL, htmlBody: MAIL_PREDLOZAK_HTML_NEGATIVNA_VERIFIKACIJA_ });
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
    fields[header[c]] = formatirajSheetVrijednost_(v);
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
    // ISPRAVAK (23.9.2026.) — po ID-u umjesto (samo) po imenu, vidi
    // resolveKlijentFolderStabilno_ gore.
    var klijentFolder = resolveKlijentFolderStabilno_(sheet, header, rowIndex, sub.ponude, folderName);

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
    fields[header[c]] = formatirajSheetVrijednost_(v);
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
    fields[header[c]] = formatirajSheetVrijednost_(v);
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
      value: formatirajSheetVrijednost_(v)
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
    // NOVO (26.9.2026., Sašin izričit zahtjev): naslov testnog maila MORA
    // biti vizualno razlikovan od stvarne ponude ("- TESTNA PONUDA -" ispred
    // uobičajenog naslova), da se testni mail nikad ne zamijeni sa stvarnom
    // ponudom — isti razlog kao popravak niže (potvrdaPonudeInfo/
    // potvrdiPonudu/odbijPonudu), koji sprječava da se ta poveznica i
    // stvarno prihvati/odbije prije nego što je ponuda uistinu poslana.
    var predmetTestni_ = '- TESTNA PONUDA - ' + (predmet || '(bez predmeta)');
    posaljiMail_(testMail, predmetTestni_, plainTijelo, opcije);
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
  // ISPRAVAK (23.9.2026.) — po ID-u umjesto (samo) po imenu, vidi
  // resolveKlijentFolderStabilno_/resolveVerzijaFolderStabilno_ gore.
  var klijentFolder = resolveKlijentFolderStabilno_(sheet, header, rowIndex, sub.ponude, 'PONUDA - ' + naziv + ' - ' + oib + ' - ' + grad);
  var verzijaFolder = resolveVerzijaFolderStabilno_(sheet, header, rowIndex, klijentFolder, brojPonude + ' - ' + naziv + ' - ' + oib + ' - ' + grad);

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
    // Sašin izričit zahtjev (23.9.2026., trideset i četvrti krug): "makni
    // priloge, imaju sve na Driveu, ne želim fizički slati nikakve
    // dokumente, samo linkove" — stvarno slanje sad ide BEZ mail priloga,
    // isto kao testno slanje (adminPosaljiPonudaTest iznad) — klijent
    // dobiva SAMO poveznice ({{LINK_DOKUMENTI}}/{{LINK_POTVRDE}} u tekstu),
    // nikad fizičku datoteku u prilogu. `dohvatiPrilogePonude_` se više NE
    // poziva ovdje (funkcija ostaje u kodu, bez pozivatelja, za slučaj da
    // zatreba ubuduće).
    var opcije = {};
    if (kopijaSebi) { opcije.bcc = NOTIFY_EMAIL; }
    var plainTijelo = tijelo;
    if (jeHtml) { opcije.htmlBody = tijelo; plainTijelo = skiniHtmlTagoveZaFallback_(tijelo); }
    posaljiMail_(primatelji.join(','), predmet || '(bez predmeta)', plainTijelo, opcije);

    // Evidencija slanja — SAMO kod stvarnog slanja, ne smije srušiti slanje
    // ako zakaže (npr. INTRIX šifra još nije potvrđena).
    try { zabiljeziEvidencijuSlanja_(rowIndex, primatelji, new Date(), nazivPredloska, predmet, tijelo, jeHtml); } catch (errEvid) { /* zanemari */ }

    // ISPRAVAK (22.9.2026., deveti krug — Sašin izričit zahtjev, TTD bug;
    // NADOGRAĐENO 23.9.2026. da vrijedi i za "Generiraj novu ponudu"): OVO
    // je pravi trenutak stvarnog slanja ponude, pa se TEK OVDJE postavlja
    // "Datum slanja aktivne ponude (admin)" — polje od kojeg TTD (Time to
    // Decision) računa proteklo vrijeme do klijentove odluke, I polje koje
    // izracunajStatusPonude_() koristi da razlikuje 'nije_poslano' od
    // 'na_cekanju' (pa time i zamrzava/otključava blok "Slanje ponude
    // mailom" u InTime_Admin.html). Ranije je datum postavljala
    // adminPostaviRokPonude() (na klik "Postavi rok"), što je TTD lažno
    // naduvalo satima. Sad se postavlja SAMO kod PRVOG stvarnog slanja
    // svake verzije (status je tad još 'nije_poslano') — vrijedi IDENTIČNO
    // za prvu ponudu i za svaku sljedeću generiranu preko "Generiraj novu
    // ponudu": adminGenerirajNovuPonudu() više NE postavlja ovo polje pri
    // generiranju (samo ga briše), nego isključivo ovdje, pri stvarnom
    // slanju — inače bi status odmah nakon generiranja ispao 'na_cekanju' i
    // zamrznuo slanje PRIJE nego je mail uopće poslan.
    //
    // "Redni broj slanja ponude" se NAMJERNO ne dira ovdje — njega
    // isključivo vodi adminGenerirajNovuPonudu (raste SAMO tim gumbom).
    // Ranije je ovdje postojao redundantan upis "= 1" (za slučaj da je ovo
    // prvo ikad slanje) — uklonjen, jer bi od sad (kad ovaj isti guard
    // vrijedi i za 2., 3.,… verziju) VRATIO redni broj natrag na 1 i
    // pokvario numeraciju (-P2, -P3…); svi čitatelji tog polja već imaju
    // "|| 1" fallback za slučaj da je stupac prazan, pa nije ni bio potreban.
    var datumSlanjaPrikaz = null;
    var datumSlanjaPrikazSek = null;
    var datumIstekaPrikaz = null;
    var rokDanaPostavljen = null;
    try {
      var sheetTtd = getOrCreateUpitiSheet();
      var lastColTtd = sheetTtd.getLastColumn();
      var headerTtd = sheetTtd.getRange(1, 1, 1, lastColTtd).getValues()[0];
      var rowTtd = sheetTtd.getRange(rowIndex, 1, 1, lastColTtd).getValues()[0];
      if (izracunajStatusPonude_(headerTtd, rowTtd) === 'nije_poslano') {
        var slanjeCol = headerTtd.indexOf('Datum slanja aktivne ponude (admin)');
        var sadaSlanje = new Date();
        if (slanjeCol !== -1) { sheetTtd.getRange(rowIndex, slanjeCol + 1).setValue(sadaSlanje); }

        // ISPRAVAK (23.9.2026., Sašin izričit zahtjev — "poslao sam novu
        // ponudu ali sam zaboravio potvrditi link... neka default ponude
        // uvijek bude 15 dana ako nešto ne promijenim PRIJE slanja"): ako do
        // OVOG trenutka (stvarnog slanja maila) rok važenja NIJE ručno
        // postavljen preko gumba "Aktiviraj rok i link" (bivši "Postavi
        // rok"/"Pošalji ponudu"), automatski se postavlja zadanih 15 dana —
        // ISTOM formulom kao adminPostaviRokPonude() (istek u 23:59:59, 15.
        // dana od danas). Ako je rok VEĆ postavljen (Saša ga je ručno
        // promijenio prije slanja, npr. na 30 dana), ovo se NE dira. Time
        // klijentov link radi odmah nakon slanja, bez posebnog drugog klika.
        var istekColTtd_ = headerTtd.indexOf('Datum isteka ponude (admin)');
        if (istekColTtd_ !== -1 && !rowTtd[istekColTtd_]) {
          var zadaniIstek_ = new Date();
          zadaniIstek_.setDate(zadaniIstek_.getDate() + 15);
          zadaniIstek_.setHours(23, 59, 59, 999);
          sheetTtd.getRange(rowIndex, istekColTtd_ + 1).setValue(zadaniIstek_);
          var rokDanaColTtd_ = headerTtd.indexOf('Rok važenja ponude (dana, admin)');
          if (rokDanaColTtd_ !== -1 && !rowTtd[rokDanaColTtd_]) { sheetTtd.getRange(rowIndex, rokDanaColTtd_ + 1).setValue(15); }
          // Vraća se klijentu (InTime_Admin.html), isti format kao
          // adminPostaviRokPonude(), da odmah lokalno ažurira prikaz roka bez
          // čekanja punog ponovnog učitavanja popisa.
          datumIstekaPrikaz = Utilities.formatDate(zadaniIstek_, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm');
          rokDanaPostavljen = 15;
        }

        // Vraća se klijentu (InTime_Admin.html) da odmah lokalno ažurira
        // entry.fields i ponovno iscrta blok "Ponuda — slanje i status" (bedž,
        // TTD, brojač), bez čekanja na puno ponovno učitavanje popisa.
        datumSlanjaPrikaz = Utilities.formatDate(sadaSlanje, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm');
        datumSlanjaPrikazSek = Utilities.formatDate(sadaSlanje, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm:ss');
      }
    } catch (errTtd) { /* postavljanje datuma slanja ne smije srušiti već izvršeno slanje maila */ }

    return { status: 'ok', poslanoNa: primatelji, kopijaSebi: !!kopijaSebi, datumSlanjaPrikaz: datumSlanjaPrikaz, datumSlanjaPrikazSek: datumSlanjaPrikazSek, datumIstekaPrikaz: datumIstekaPrikaz, rokDanaPostavljen: rokDanaPostavljen };
  } catch (err) {
    return { status: 'error', message: 'Slanje ponude nije uspjelo: ' + err.message };
  }
}

// ---- "POŠALJI ZAHTJEV ZA ONLINE BOOKING" — panel u InTime_Admin.html
// (buildAdminFieldsBlock, ODMAH ISPOD "Potvrda prihvaćanja ponude", IZNAD
// "Online Booking i podaci klijenta"; Sašin izričit zahtjev, 27.9.2026.,
// odobreno prema mockupu: "integriraj, sviđa mi se"). SVRHA: interni mail
// (npr. IT službi ili distribucijskom centru) da se za OVOG klijenta
// pokrene otvaranje Online Booking računa — NIJE mail klijentu, pa
// NAMJERNO ne dira ništa od ponuda-specifičnih polja/nuspojava
// (TTD/rok/evidencija/status) koje adminPosaljiPonudaMail/Test gore
// koriste — zato zaseban, mnogo jednostavniji par funkcija, ne recikliranje
// tih dviju. Predlošci za ovaj panel žive u ISTOM Sheetu
// (InTime_MailPredlosci) kao ponuda, ali razdvojeni stupcem "Kategorija"
// ('ob_zahtjev' umjesto 'ponuda') — vidi getOrCreateMailPredlosciSheet/
// adminMailPredlosciList/adminMailPredlozakSpremi iznad.
function adminPosaljiObZahtjevTest(token, testMail, predmet, tijelo, jeHtml) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  testMail = String(testMail || '').trim();
  if (!EMAIL_REGEX_.test(testMail)) { return { status: 'error', message: 'Upišite ispravnu e-mail adresu za testno slanje.' }; }
  if (!tijelo || !String(tijelo).trim()) { return { status: 'error', message: 'Tekst zahtjeva je prazan — odaberite predložak.' }; }
  try {
    var opcije = {};
    var plainTijelo = tijelo;
    if (jeHtml) { opcije.htmlBody = tijelo; plainTijelo = skiniHtmlTagoveZaFallback_(tijelo); }
    var predmetTestni_ = '- TEST - ' + (predmet || '(bez predmeta)');
    posaljiMail_(testMail, predmetTestni_, plainTijelo, opcije);
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: 'Slanje testnog maila nije uspjelo: ' + err.message };
  }
}

// Stvarno slanje zahtjeva za Online Booking — JEDAN primatelj (upisan/
// promijenjen u panelu, predložen iz "Servisi", ne popis checkboxova kao
// kod ponude), bez priloga (isti razlog kao ponuda — sve na Driveu/
// poveznicama, ne fizički prilozi). rowIndex se prima SAMO da bi se, ako
// zatreba, u budućnosti moglo zapisati kojem klijentu/ponudi se zahtjev
// odnosi — trenutno se ne upisuje nikamo (nema ponuda-specifičnih polja za
// ovo), pa greška u čitanju retka NE smije srušiti slanje.
function adminPosaljiObZahtjevMail(token, rowIndex, primatelj, predmet, tijelo, kopijaSebi, jeHtml) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  primatelj = String(primatelj || '').trim();
  if (!EMAIL_REGEX_.test(primatelj)) { return { status: 'error', message: 'Adresa primatelja nije ispravna e-mail adresa.' }; }
  if (!tijelo || !String(tijelo).trim()) { return { status: 'error', message: 'Tekst zahtjeva je prazan — odaberite predložak.' }; }
  try {
    var opcije = {};
    if (kopijaSebi) { opcije.bcc = NOTIFY_EMAIL; }
    var plainTijelo = tijelo;
    if (jeHtml) { opcije.htmlBody = tijelo; plainTijelo = skiniHtmlTagoveZaFallback_(tijelo); }
    posaljiMail_(primatelj, predmet || '(bez predmeta)', plainTijelo, opcije);
    // Bilježi trenutak slanja (28.9.2026., Sašin izričit zahtjev) — panel
    // "Pošalji pristupne podatke klijentu" ostaje zaključan dok se OVAJ mail
    // ne pošalje (vidi ADMIN_ONLY_FIELDS.datum_slanja_ob_zahtjeva). Umotano
    // u zaseban try/catch — ako upis padne (npr. redak je u međuvremenu
    // obrisan), sâmo slanje maila i dalje broji kao uspješno, ne smije se
    // poništiti zbog ovoga.
    try {
      var rowIndexOb_ = parseInt(rowIndex, 10);
      if (rowIndexOb_ && rowIndexOb_ >= 2) {
        var sheetOb_ = getOrCreateUpitiSheet();
        if (rowIndexOb_ <= sheetOb_.getLastRow()) {
          var headerOb_ = sheetOb_.getRange(1, 1, 1, sheetOb_.getLastColumn()).getValues()[0];
          upisiAdminPoljeAkoPostoji_(sheetOb_, headerOb_, rowIndexOb_, ADMIN_ONLY_FIELDS.datum_slanja_ob_zahtjeva, new Date());
        }
      }
    } catch (errZapis) { /* slanje maila je već uspjelo, upis oznake ne smije to poništiti */ }
    return { status: 'ok', poslanoNa: primatelj, kopijaSebi: !!kopijaSebi };
  } catch (err) {
    return { status: 'error', message: 'Slanje zahtjeva nije uspjelo: ' + err.message };
  }
}

// Mali dijeljeni helper (28.9.2026.) — upisuje jednu vrijednost u ADMIN_ONLY_FIELDS
// stupac po njegovom nazivu, na već poznatom retku/headeru (bez ponovnog
// dohvaćanja) — koriste ga adminPosaljiObZahtjevMail/adminPosaljiKlijentPristupMail
// za bilježenje "mail poslan" oznaka koje pokreću lanac zaključavanja triju
// panela ("Pošalji zahtjev za Online Booking" → "Pošalji pristupne podatke
// klijentu" → "Pošalji obavijest poslovnicama"). Tiho ne radi ništa ako
// stupac (još) ne postoji u tablici — self-healing header ga svejedno uvijek
// dodaje kroz izracunajOcekivanoZaglavljeUpiti_/uskladiZaglavljeUpitiSheeta_
// prije nego se ova funkcija uopće pozove u praksi.
function upisiAdminPoljeAkoPostoji_(sheet, header, rowIndex, colLabel, vrijednost) {
  var colIdx = header.indexOf(colLabel);
  if (colIdx === -1) { return; }
  sheet.getRange(rowIndex, colIdx + 1).setValue(vrijednost);
}

// Validira popis od JEDNE ili VIŠE e-mail adresa odvojenih zarezom (koristi
// se za panel "Pošalji obavijest poslovnicama" niže, gdje se šalje na
// nekoliko poslovnica odjednom) — vraća niz očišćenih adresa (trim,
// prazni članovi izbačeni) ili null ako je popis prazan ili SADRŽI IOLI
// jednu neispravnu adresu (sve-ili-ništa, isto strogo ponašanje kao
// EMAIL_REGEX_.test za jednu adresu drugdje u kodu).
function validirajViseMailova_(str) {
  var lista = String(str || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
  if (!lista.length) { return null; }
  for (var i = 0; i < lista.length; i++) {
    if (!EMAIL_REGEX_.test(lista[i])) { return null; }
  }
  return lista;
}

// ---- "POŠALJI OBAVIJEST POSLOVNICAMA" — panel u InTime_Admin.html
// (buildAdminFieldsBlock, ODMAH ISPOD panela "Pošalji zahtjev za Online
// Booking" iznad; Sašin izričit zahtjev, 28.9.2026.: "nakon što pošaljemo
// mail za online booking trebamo kad dobijemo username i password za
// online booking poslati mail odgovornim poslovnicama za otvoreni poslovni
// subjekat... identično sve kao za slanje zahtjeva za online booking, samo
// će mail biti upućen poslovnicama koje smo označili kao nadležne
// poslovnice"). SVRHA: obavijestiti poslovnice/logističke centre
// označene kao "Nadležna poslovnica" za ovog klijenta da je poslovni
// subjekt otvoren — NIJE mail klijentu, ne dira ponudu ni njen status.
// Jedina strukturna razlika od adminPosaljiObZahtjevTest/Mail iznad:
// primatelji su VIŠE adresa odjednom (validirajViseMailova_ gore), ne
// jedna. Predlošci žive u ISTOM Sheetu (InTime_MailPredlosci), razdvojeni
// stupcem "Kategorija" ('poslovnica_obavijest') — vidi
// getOrCreateMailPredlosciSheet/adminMailPredlosciList/
// adminMailPredlozakSpremi iznad.
// Zamjenjuje hot-linkani Yandex URL karte prikupa (vidi {{SLIKA_PRIKUPA}} u
// renderMailTekst_, InTime_Admin.html) PRAVIM ugrađenim privitkom (cid:)
// NEPOSREDNO PRIJE stvarnog slanja (1.10.2026., Sašin izričit zahtjev — "karta
// prikupa kroz mail ne radi, ne stavi se u mail", potvrđeno na stvarno
// poslanom mailu). Razlog: Yandex statična karta radi besprijekorno kad je
// admin pregledava u SVOM pregledniku (preview u adminu = izravan fetch iz
// browsera, radi), ALI kod stvarno poslanog maila primateljev mail klijent
// (ili Gmailov vlastiti proxy za vanjske slike) dohvaća sliku SAM, tek pri
// OTVARANJU maila — taj dohvat Yandex očito blokira/odbija (vjerojatno
// prepoznaje/odbija Googleov image-proxy, a Apps Script fetch izravno radi).
// Rješenje: Apps Script (koji ima vlastiti, pouzdan pristup) PRIJE slanja sam
// dohvati sliku i ugradi je kao pravi privitak (cid:) — primatelj je dobije
// KAO DIO maila, bez ikakvog naknadnog vanjskog dohvata. Best-effort: ako
// dohvat ne uspije, slanje se NE ruši — mail ide dalje s izvornim (vanjskim)
// linkom na sliku, isto kao dosad.
function ugradiKartuPrikupaInlineAkoPostoji_(htmlBody) {
  var prazno = { html: htmlBody, inlineImages: {} };
  if (!htmlBody || typeof htmlBody !== 'string') { return prazno; }
  // Prepoznaje i staticmap.openstreetmap.de (2.10.2026., dvadeset i osmi
  // krug — vidi punu napomenu uz slikaPrikupa u InTime_Admin.html) i
  // static-maps.yandex.ru (prijašnji provider, zadržan radi unatrag-
  // kompatibilnosti ako se ikad vrati) — oba provajdera istom logikom.
  var match = /<img[^>]+src="(https:\/\/(?:staticmap\.openstreetmap\.de|static-maps\.yandex\.ru)\/[^"]+)"[^>]*>/i.exec(htmlBody);
  if (!match) { return prazno; }
  var url = match[1];
  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (response.getResponseCode() !== 200) { return prazno; }
    var blob = response.getBlob();
    var cidIme = 'kartaPrikupaInline';
    blob.setName(cidIme);
    var inlineImages = {};
    inlineImages[cidIme] = blob;
    return { html: htmlBody.split(url).join('cid:' + cidIme), inlineImages: inlineImages };
  } catch (err) {
    return prazno;
  }
}

function adminPosaljiPoslovniceObavijestTest(token, testMail, predmet, tijelo, jeHtml) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  testMail = String(testMail || '').trim();
  if (!EMAIL_REGEX_.test(testMail)) { return { status: 'error', message: 'Upišite ispravnu e-mail adresu za testno slanje.' }; }
  if (!tijelo || !String(tijelo).trim()) { return { status: 'error', message: 'Tekst obavijesti je prazan — odaberite predložak.' }; }
  try {
    var opcije = {};
    var plainTijelo = tijelo;
    if (jeHtml) {
      var ugradjeno = ugradiKartuPrikupaInlineAkoPostoji_(tijelo);
      opcije.htmlBody = ugradjeno.html;
      if (Object.keys(ugradjeno.inlineImages).length) { opcije.inlineImages = ugradjeno.inlineImages; }
      plainTijelo = skiniHtmlTagoveZaFallback_(tijelo);
    }
    var predmetTestni_ = '- TEST - ' + (predmet || '(bez predmeta)');
    posaljiMail_(testMail, predmetTestni_, plainTijelo, opcije);
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: 'Slanje testnog maila nije uspjelo: ' + err.message };
  }
}

// Stvarno slanje obavijesti poslovnicama — primatelji je STRING s jednom ili
// VIŠE adresa odvojenih zarezom (validirajViseMailova_ gore, isti obrazac
// kao "Servisi"/kontakti za odustajanje — vidi primatelji.join(',') u
// posaljiMail_ pozivima iznad u ovoj datoteci). rowIndex se prima SAMO za
// eventualnu buduću upotrebu (kao i kod OB zahtjeva) — greška u čitanju
// retka NE smije srušiti slanje.
function adminPosaljiPoslovniceObavijestMail(token, rowIndex, primatelji, predmet, tijelo, kopijaSebi, jeHtml) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var primateljiLista = validirajViseMailova_(primatelji);
  if (!primateljiLista) { return { status: 'error', message: 'Upišite barem jednu ispravnu adresu primatelja (odvojene zarezom).' }; }
  if (!tijelo || !String(tijelo).trim()) { return { status: 'error', message: 'Tekst obavijesti je prazan — odaberite predložak.' }; }
  try {
    var opcije = {};
    if (kopijaSebi) { opcije.bcc = NOTIFY_EMAIL; }
    var plainTijelo = tijelo;
    if (jeHtml) {
      var ugradjeno = ugradiKartuPrikupaInlineAkoPostoji_(tijelo);
      opcije.htmlBody = ugradjeno.html;
      if (Object.keys(ugradjeno.inlineImages).length) { opcije.inlineImages = ugradjeno.inlineImages; }
      plainTijelo = skiniHtmlTagoveZaFallback_(tijelo);
    }
    posaljiMail_(primateljiLista.join(','), predmet || '(bez predmeta)', plainTijelo, opcije);
    // Bilježi trenutak slanja (2.10.2026., Sašin izričit zahtjev — narančasti
    // panel "Pošalji obavijest SVIM poslovnicama" ostaje zaključan dok se
    // OVAJ mail (NADLEŽNIM poslovnicama) ne pošalje, vidi
    // ADMIN_ONLY_FIELDS.datum_slanja_poslovnice_obavijest). Isti umotan
    // try/catch obrazac kao adminPosaljiObZahtjevMail/adminPosaljiKlijentPristupMail
    // — upis oznake nikad ne poništava već uspješno slanje maila.
    try {
      var rowIndexPosl_ = parseInt(rowIndex, 10);
      if (rowIndexPosl_ && rowIndexPosl_ >= 2) {
        var sheetPosl_ = getOrCreateUpitiSheet();
        if (rowIndexPosl_ <= sheetPosl_.getLastRow()) {
          var headerPosl_ = sheetPosl_.getRange(1, 1, 1, sheetPosl_.getLastColumn()).getValues()[0];
          upisiAdminPoljeAkoPostoji_(sheetPosl_, headerPosl_, rowIndexPosl_, ADMIN_ONLY_FIELDS.datum_slanja_poslovnice_obavijest, new Date());
        }
      }
    } catch (errZapisPosl_) { /* slanje maila je već uspjelo, upis oznake ne smije to poništiti */ }
    return { status: 'ok', poslanoNa: primateljiLista, kopijaSebi: !!kopijaSebi };
  } catch (err) {
    return { status: 'error', message: 'Slanje obavijesti nije uspjelo: ' + err.message };
  }
}

// ---- "POŠALJI OBAVIJEST SVIM POSLOVNICAMA" — backend slanja (Sašin izričit
// zahtjev, 2.10.2026., vidi opširnu napomenu uz MAIL_PREDLOZAK_SVE_POSLOVNICE_*
// iznad). 1:1 kopija adminPosaljiPoslovniceObavijestTest/Mail iznad (isti
// cid: inline-slika popravak, isti posaljiMail_/validirajViseMailova_) —
// jedina razlika je da primatelji ovdje dolaze iz SVIH poslovnica (frontend
// predlaže, admin može slobodno urediti), ne samo nadležnih za klijenta.
function adminPosaljiSvePoslovniceObavijestTest(token, testMail, predmet, tijelo, jeHtml) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  testMail = String(testMail || '').trim();
  if (!EMAIL_REGEX_.test(testMail)) { return { status: 'error', message: 'Upišite ispravnu e-mail adresu za testno slanje.' }; }
  if (!tijelo || !String(tijelo).trim()) { return { status: 'error', message: 'Tekst obavijesti je prazan — odaberite predložak.' }; }
  try {
    var opcije = {};
    var plainTijelo = tijelo;
    if (jeHtml) {
      var ugradjeno = ugradiKartuPrikupaInlineAkoPostoji_(tijelo);
      opcije.htmlBody = ugradjeno.html;
      if (Object.keys(ugradjeno.inlineImages).length) { opcije.inlineImages = ugradjeno.inlineImages; }
      plainTijelo = skiniHtmlTagoveZaFallback_(tijelo);
    }
    var predmetTestni_ = '- TEST - ' + (predmet || '(bez predmeta)');
    posaljiMail_(testMail, predmetTestni_, plainTijelo, opcije);
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: 'Slanje testnog maila nije uspjelo: ' + err.message };
  }
}

function adminPosaljiSvePoslovniceObavijestMail(token, rowIndex, primatelji, predmet, tijelo, kopijaSebi, jeHtml) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var primateljiLista = validirajViseMailova_(primatelji);
  if (!primateljiLista) { return { status: 'error', message: 'Upišite barem jednu ispravnu adresu primatelja (odvojene zarezom).' }; }
  if (!tijelo || !String(tijelo).trim()) { return { status: 'error', message: 'Tekst obavijesti je prazan — odaberite predložak.' }; }
  try {
    var opcije = {};
    if (kopijaSebi) { opcije.bcc = NOTIFY_EMAIL; }
    var plainTijelo = tijelo;
    if (jeHtml) {
      var ugradjeno = ugradiKartuPrikupaInlineAkoPostoji_(tijelo);
      opcije.htmlBody = ugradjeno.html;
      if (Object.keys(ugradjeno.inlineImages).length) { opcije.inlineImages = ugradjeno.inlineImages; }
      plainTijelo = skiniHtmlTagoveZaFallback_(tijelo);
    }
    posaljiMail_(primateljiLista.join(','), predmet || '(bez predmeta)', plainTijelo, opcije);
    try {
      var rowIndexSve_ = parseInt(rowIndex, 10);
      if (rowIndexSve_ && rowIndexSve_ >= 2) {
        var sheetSve_ = getOrCreateUpitiSheet();
        if (rowIndexSve_ <= sheetSve_.getLastRow()) {
          var headerSve_ = sheetSve_.getRange(1, 1, 1, sheetSve_.getLastColumn()).getValues()[0];
          upisiAdminPoljeAkoPostoji_(sheetSve_, headerSve_, rowIndexSve_, ADMIN_ONLY_FIELDS.datum_slanja_sve_poslovnice_obavijest, new Date());
        }
      }
    } catch (errZapisSve_) { /* slanje maila je već uspjelo, upis oznake ne smije to poništiti */ }
    return { status: 'ok', poslanoNa: primateljiLista, kopijaSebi: !!kopijaSebi };
  } catch (err) {
    return { status: 'error', message: 'Slanje obavijesti nije uspjelo: ' + err.message };
  }
}

// "Uvodni tekst" — Sašin izričit zahtjev (27.9.2026.): kratak, svaki put
// drugačiji uvod maila za zahtjev za Online Booking ("Pozdrav dečki kako
// ste danas... hitno trebam..."), NIJE dio spremljenog predloška (bira/
// upisuje se zasebno prije SVAKOG slanja, vidi .af-ob-uvodni-* u
// InTime_Admin.html). 10 zadanih prijedloga + do 10 dodanih (max 20
// ukupno) — Saša može obrisati bilo koji (i zadani i dodani), dodati svoje
// preko "Zapamti", i vratiti se na zadanih 10 preko reset akcije. Spremište:
// JEDAN Script Property ('OB_UVODNI_TEKSTOVI', JSON popis) — GLOBALNO
// dijeljeno (isti popis za sve klijente/kartice, ne po klijentu).
var OB_UVODNI_TEKST_DEFAULT_ = [
  'Pozdrav dečki, kako ste danas? Trebamo hitno otvoriti Online Booking za novog klijenta, molim da požurite s obradom.',
  'Bok, imamo novog klijenta za kojeg treba otvoriti Online Booking račun — hvala unaprijed na brzoj obradi!',
  'Pozdrav, molim hitno otvaranje Online Bookinga za klijenta u nastavku — klijent već čeka na početak slanja pošiljaka.',
  'Pozdrav svima, u nastavku šaljem podatke za otvaranje novog OB računa. Molim da se obradi što prije, hvala.',
  'Bok tim, trebamo žurno otvoriti Online Booking za dolje navedenog klijenta — unaprijed hvala na trudu!',
  'Pozdrav, novi klijent čeka otvaranje OB računa — podaci u nastavku, molim hitnu obradu.',
  'Pozdrav dečki, još jedan klijent za OB — treba nam žurno, klijent kreće s prvim pošiljkama ovih dana.',
  'Bok, molim vas otvorite Online Booking za klijenta ispod što prije, hvala na razumijevanju.',
  'Pozdrav, šaljem podatke za otvaranje OB računa — klijent je već potvrdio suradnju, žuri nam se s otvaranjem.',
  'Pozdrav svima, treba nam otvoren OB račun za novog klijenta do kraja dana ako je moguće, hvala unaprijed!'
];
var OB_UVODNI_TEKSTOVI_MAX_ = 20;

function ucitajObUvodneTekstove_() {
  var props = PropertiesService.getScriptProperties();
  var sirovo = props.getProperty('OB_UVODNI_TEKSTOVI');
  if (!sirovo) {
    var zadano = OB_UVODNI_TEKST_DEFAULT_.map(function(tekst, i) { return { id: 'zadano_' + (i + 1), tekst: tekst, prilagodjen: false }; });
    props.setProperty('OB_UVODNI_TEKSTOVI', JSON.stringify(zadano));
    return zadano;
  }
  try {
    var lista = JSON.parse(sirovo);
    return Array.isArray(lista) ? lista : [];
  } catch (e) {
    return [];
  }
}
function spremiObUvodneTekstove_(lista) {
  PropertiesService.getScriptProperties().setProperty('OB_UVODNI_TEKSTOVI', JSON.stringify(lista));
}
function adminObUvodniTekstoviList(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  return { status: 'ok', tekstovi: ucitajObUvodneTekstove_() };
}
function adminObUvodniTekstDodaj(token, tekst) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  tekst = String(tekst || '').trim();
  if (!tekst) { return { status: 'error', message: 'Tekst je prazan.' }; }
  var lista = ucitajObUvodneTekstove_();
  if (lista.length >= OB_UVODNI_TEKSTOVI_MAX_) {
    return { status: 'error', message: 'Dosegnut je maksimalan broj od ' + OB_UVODNI_TEKSTOVI_MAX_ + ' tekstova — obriši neki prije dodavanja novog.' };
  }
  var novi = { id: 'prilagodjen_' + Date.now() + '_' + Math.floor(Math.random() * 10000), tekst: tekst, prilagodjen: true };
  lista.push(novi);
  spremiObUvodneTekstove_(lista);
  return { status: 'ok', tekstovi: lista };
}
function adminObUvodniTekstObrisi(token, id) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var lista = ucitajObUvodneTekstove_().filter(function(t) { return t.id !== id; });
  spremiObUvodneTekstove_(lista);
  return { status: 'ok', tekstovi: lista };
}
function adminObUvodniTekstoviReset(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var zadano = OB_UVODNI_TEKST_DEFAULT_.map(function(tekst, i) { return { id: 'zadano_' + (i + 1), tekst: tekst, prilagodjen: false }; });
  spremiObUvodneTekstove_(zadano);
  return { status: 'ok', tekstovi: zadano };
}

// "Uvodni tekst" — VLASTITO, ZASEBNO spremište za narančasti panel "Pošalji
// obavijest SVIM poslovnicama" (2.10.2026., Sašin izričit zahtjev — "u
// obavijest svim poslovnicama stavi ove tekstove kao uvodni tekst umjesto
// onih koji si stavio"). Prvotno je ovaj panel DIJELIO OB_UVODNI_TEKSTOVI
// pool s OB/zeleni panel (isti ton, kratke rečenice); Saša je sada dao 10
// vlastitih, dužih (višeparagrafnih) tekstova s posve drugačijim tonom —
// pozornost na pošiljke novog klijenta, velika očekivanja, kontakt kod
// problema — pa dobivaju SVOJ popis, isti obrazac kao OB_UVODNI_TEKSTOVI
// (10 zadanih + do 10 dodanih, max 20, reset vraća na ovih 10), ali potpuno
// odvojen Script Property ('SVEP_UVODNI_TEKSTOVI'). \n u tekstu se u
// InTime_Admin.html pretvara u <br> (isti mehanizam kao OB).
var SVEP_UVODNI_TEKST_DEFAULT_ = [
  'Molim sve poslovnice da tijekom početnog razdoblja suradnje obrate posebnu pozornost na pošiljke ovog klijenta.\nRiječ je o važnom poslovnom partneru u čiji je prelazak u naš logistički sustav uloženo mnogo vremena i truda. Želimo od samog početka opravdati njegovo povjerenje i osigurati visoku kvalitetu usluge.\nU slučaju bilo kakvih poteškoća, molim da me odmah kontaktirate kako bismo ih pravovremeno riješili.\nHvala svima na suradnji i angažmanu.',
  'Molim sve poslovnice za dodatnu pozornost prilikom obrade i dostave pošiljaka ovog klijenta.\nRadi se o poslovnom partneru s velikim potencijalom, od kojeg imamo značajna očekivanja. U uspostavljanje ove suradnje uložen je velik trud i iznimno nam je važno da od prvog dana pokažemo kvalitetu i pouzdanost našeg logističkog sustava.\nAko primijetite bilo kakav problem, molim vas da me bez odgode kontaktirate.\nZahvaljujem na podršci.',
  'Drage kolegice i kolege,\nPred nama je početak suradnje s novim klijentom od kojeg mnogo očekujemo. Kako je u realizaciju ove suradnje uloženo dosta truda, molim vas da njegovim pošiljkama u početnom razdoblju posvetimo dodatnu pozornost.\nVažno mi je da klijent od samog početka osjeti kako je odabrao pouzdanog logističkog partnera.\nAko se pojavi bilo kakva poteškoća, slobodno me odmah kontaktirajte kako bismo je zajednički riješili.\nHvala vam na pomoći!',
  'Molim sve poslovnice za poseban nadzor pošiljaka ovog klijenta tijekom početnog razdoblja suradnje.\nRiječ je o iznimno važnom klijentu, u čiji je prelazak u naš logistički sustav uloženo mnogo truda i od kojeg imamo velika očekivanja.\nSvaku eventualnu poteškoću molim odmah prijaviti izravno meni kako bismo mogli reagirati na vrijeme.\nZahvaljujem na razumijevanju i suradnji.',
  'Poštovane kolegice i kolege,\nUspjeli smo dogovoriti suradnju s klijentom koji za našu tvrtku predstavlja značajnu poslovnu priliku. Sada je važno da zajedničkim angažmanom opravdamo njegovo povjerenje.\nMolim sve poslovnice da tijekom početnog razdoblja posebno pripaze na obradu i dostavu njegovih pošiljaka.\nAko se pojavi bilo kakav problem, molim da me odmah obavijestite kako bismo zajednički pronašli rješenje.\nHvala svima na podršci i timskom radu.',
  'Molim sve poslovnice da ovom klijentu tijekom početnog razdoblja suradnje posvete dodatnu pozornost.\nIza njegova prelaska u naš logistički sustav stoji mnogo uloženog vremena, pregovora i truda. Vjerujem da svi zajedno možemo osigurati kvalitetnu uslugu koja će opravdati povjerenje koje nam je ukazao.\nPosebno molim da me o svim eventualnim poteškoćama odmah obavijestite kako bismo spriječili nepotrebne komplikacije.\nUnaprijed zahvaljujem na angažmanu.',
  'Molim sve poslovnice za dodatnu pozornost prilikom postupanja s pošiljkama ovog klijenta.\nPrvo razdoblje suradnje iznimno je važno jer upravo tada klijent stječe dojam o kvaliteti i pouzdanosti naše usluge. S obzirom na velik trud uložen u njegov prelazak i očekivanja koja imamo od buduće suradnje, važno je da sve protekne što kvalitetnije.\nU slučaju bilo kakvih poteškoća molim vas da me odmah kontaktirate kako bismo pravovremeno reagirali.\nHvala na suradnji.',
  'Poštovane kolegice i kolege,\nZapočinjemo suradnju s klijentom u kojem vidimo značajan dugoročni poslovni potencijal.\nKako bismo postavili kvalitetne temelje buduće suradnje, molim sve poslovnice da u početnom razdoblju posebno pripaze na njegove pošiljke te osiguraju pravovremenu obradu i dostavu.\nU slučaju bilo kakvih nepravilnosti ili mogućih problema, molim da me odmah kontaktirate.\nZahvaljujem svima na dodatnoj pozornosti i angažmanu.',
  'Molim sve poslovnice da tijekom početnog razdoblja suradnje osiguraju pojačanu pozornost pri obradi i dostavi pošiljaka ovog klijenta.\nRadi se o značajnom poslovnom partneru, za čije je uključivanje u naš logistički sustav uložen velik trud i od kojeg očekujemo razvoj kvalitetne poslovne suradnje.\nIznimno je važno da eventualne poteškoće prepoznamo i riješimo prije nego što utječu na zadovoljstvo klijenta.\nStoga molim da me o svim uočenim problemima odmah i izravno obavijestite.\nHvala na profesionalnosti i suradnji.',
  'Drage kolegice i kolege,\nZamolio bih vas za malu dodatnu pomoć i pozornost tijekom početnog razdoblja suradnje s ovim klijentom.\nU njegov prelazak u naš logistički sustav uloženo je zaista mnogo truda i osobno mi je jako važno da opravdamo povjerenje koje nam je ukazao. Vjerujem da ovaj klijent ima velik potencijal i da zajedničkim angažmanom možemo izgraditi izvrsnu dugoročnu suradnju.\nAko primijetite bilo kakvu poteškoću, molim vas da me odmah kontaktirate kako bismo je riješili prije nego što postane veći problem.\nUnaprijed vam hvala na pomoći, razumijevanju i dodatnom angažmanu.'
];
var SVEP_UVODNI_TEKSTOVI_MAX_ = 20;

function ucitajSvepUvodneTekstove_() {
  var props = PropertiesService.getScriptProperties();
  var sirovo = props.getProperty('SVEP_UVODNI_TEKSTOVI');
  if (!sirovo) {
    var zadano = SVEP_UVODNI_TEKST_DEFAULT_.map(function(tekst, i) { return { id: 'zadano_' + (i + 1), tekst: tekst, prilagodjen: false }; });
    props.setProperty('SVEP_UVODNI_TEKSTOVI', JSON.stringify(zadano));
    return zadano;
  }
  try {
    var lista = JSON.parse(sirovo);
    return Array.isArray(lista) ? lista : [];
  } catch (e) {
    return [];
  }
}
function spremiSvepUvodneTekstove_(lista) {
  PropertiesService.getScriptProperties().setProperty('SVEP_UVODNI_TEKSTOVI', JSON.stringify(lista));
}
function adminSvepUvodniTekstoviList(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  return { status: 'ok', tekstovi: ucitajSvepUvodneTekstove_() };
}
function adminSvepUvodniTekstDodaj(token, tekst) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  tekst = String(tekst || '').trim();
  if (!tekst) { return { status: 'error', message: 'Tekst je prazan.' }; }
  var lista = ucitajSvepUvodneTekstove_();
  if (lista.length >= SVEP_UVODNI_TEKSTOVI_MAX_) {
    return { status: 'error', message: 'Dosegnut je maksimalan broj od ' + SVEP_UVODNI_TEKSTOVI_MAX_ + ' tekstova — obriši neki prije dodavanja novog.' };
  }
  var novi = { id: 'prilagodjen_' + Date.now() + '_' + Math.floor(Math.random() * 10000), tekst: tekst, prilagodjen: true };
  lista.push(novi);
  spremiSvepUvodneTekstove_(lista);
  return { status: 'ok', tekstovi: lista };
}
function adminSvepUvodniTekstObrisi(token, id) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var lista = ucitajSvepUvodneTekstove_().filter(function(t) { return t.id !== id; });
  spremiSvepUvodneTekstove_(lista);
  return { status: 'ok', tekstovi: lista };
}
function adminSvepUvodniTekstoviReset(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var zadano = SVEP_UVODNI_TEKST_DEFAULT_.map(function(tekst, i) { return { id: 'zadano_' + (i + 1), tekst: tekst, prilagodjen: false }; });
  spremiSvepUvodneTekstove_(zadano);
  return { status: 'ok', tekstovi: zadano };
}

// Uvodni tekst za panel "Pošalji obavijest nadležnim poslovnicama" (zeleni
// panel) — do sada je DIJELIO popis s OB panelom (OB_UVODNI_TEKSTOVI).
// Sašin izričit zahtjev (2.10.2026.): "evo za zeleni mail nove rečenice a
// ne one od plavoga" — zeleni panel dobiva SVOJE vlastito spremište,
// potpuno odvojeno i od OB i od SVEP, isti obrazac (10 zadanih + do 10
// dodanih, max 20, reset vraća na ovih 10), zaseban Script Property
// ('POSL_UVODNI_TEKSTOVI').
var POSL_UVODNI_TEKST_DEFAULT_ = [
  'Obavještavamo vas da je u našem sustavu otvoren i aktiviran sljedeći poslovni subjekt:',
  'Obavještavamo sve poslovnice da je sljedeći poslovni subjekt uspješno otvoren u našem sustavu:',
  'Ovim putem obavještavamo vas da je završen postupak otvaranja sljedećeg poslovnog subjekta:',
  'Obavještavamo vas da je u naš logistički sustav uključen novi poslovni subjekt:',
  'Obavještavamo sve poslovnice o otvaranju i aktivaciji sljedećeg poslovnog subjekta:',
  'Sljedeći poslovni subjekt uspješno je registriran i aktiviran u našem sustavu:',
  'Obavještavamo vas da je otvoren novi poslovni subjekt te da je evidentiran u našem sustavu:',
  'Ovim putem potvrđujemo da je sljedeći poslovni subjekt otvoren i spreman za početak suradnje:',
  'Obavještavamo sve poslovnice da je provedeno otvaranje sljedećeg poslovnog subjekta:',
  'Obavještavamo vas da je postupak otvaranja uspješno završen te je u našem sustavu aktivan sljedeći poslovni subjekt:'
];
var POSL_UVODNI_TEKSTOVI_MAX_ = 20;

function ucitajPoslUvodneTekstove_() {
  var props = PropertiesService.getScriptProperties();
  var sirovo = props.getProperty('POSL_UVODNI_TEKSTOVI');
  if (!sirovo) {
    var zadano = POSL_UVODNI_TEKST_DEFAULT_.map(function(tekst, i) { return { id: 'zadano_' + (i + 1), tekst: tekst, prilagodjen: false }; });
    props.setProperty('POSL_UVODNI_TEKSTOVI', JSON.stringify(zadano));
    return zadano;
  }
  try {
    var lista = JSON.parse(sirovo);
    return Array.isArray(lista) ? lista : [];
  } catch (e) {
    return [];
  }
}
function spremiPoslUvodneTekstove_(lista) {
  PropertiesService.getScriptProperties().setProperty('POSL_UVODNI_TEKSTOVI', JSON.stringify(lista));
}
function adminPoslUvodniTekstoviList(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  return { status: 'ok', tekstovi: ucitajPoslUvodneTekstove_() };
}
function adminPoslUvodniTekstDodaj(token, tekst) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  tekst = String(tekst || '').trim();
  if (!tekst) { return { status: 'error', message: 'Tekst je prazan.' }; }
  var lista = ucitajPoslUvodneTekstove_();
  if (lista.length >= POSL_UVODNI_TEKSTOVI_MAX_) {
    return { status: 'error', message: 'Dosegnut je maksimalan broj od ' + POSL_UVODNI_TEKSTOVI_MAX_ + ' tekstova — obriši neki prije dodavanja novog.' };
  }
  var novi = { id: 'prilagodjen_' + Date.now() + '_' + Math.floor(Math.random() * 10000), tekst: tekst, prilagodjen: true };
  lista.push(novi);
  spremiPoslUvodneTekstove_(lista);
  return { status: 'ok', tekstovi: lista };
}
function adminPoslUvodniTekstObrisi(token, id) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var lista = ucitajPoslUvodneTekstove_().filter(function(t) { return t.id !== id; });
  spremiPoslUvodneTekstove_(lista);
  return { status: 'ok', tekstovi: lista };
}
function adminPoslUvodniTekstoviReset(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var zadano = POSL_UVODNI_TEKST_DEFAULT_.map(function(tekst, i) { return { id: 'zadano_' + (i + 1), tekst: tekst, prilagodjen: false }; });
  spremiPoslUvodneTekstove_(zadano);
  return { status: 'ok', tekstovi: zadano };
}

// Upload dokumenta za panel "Pošalji pristupne podatke klijentu" (Sašin
// izričit zahtjev, 30.9.2026., ISPRAVLJENO ISTI DAN nakon njegovog
// pojašnjenja — "ti dokumenti koji se prilažu su opcenit i vrijede za sve
// klijente... to su upute za korištenje... google drive link se dijeli
// klijentu u obliku buttona u templateu, ne ide mu fizički dokument, vec
// samo link na taj drive"). PRVA verzija ovog dana spremala je ovo
// PO-KLIJENTU kao stvarni mail privitak — POGREŠNO shvaćeno, u potpunosti
// zamijenjeno ovom verzijom. Sad je JEDAN zajednički, javno dijeljen Drive
// direktorij (getOpciDokumentiKlijentPristupFolderJavni_() iznad) — Saša ga
// najčešće uređuje izravno u Drive sučelju ("ja cu fizicki sam staviti u
// taj direktorij dokument i mijenjati ih"), a ovaj upload je samo prečac za
// dodavanje NOVE datoteke bez izlaska iz admina ("mogu uvijek ubaciti i
// nesto novo u sam drag and drop"). Vraća {id, name, url, folderUrl} —
// pozivatelj (InTime_Admin.html) ništa ne sprema u red upita, samo osvježi
// svoj lokalni popis (izvor istine je SAM Drive direktorij, vidi
// adminDohvatiKlijentPristupOpceDokumente niže).
function adminUploadKlijentPristupOpciDokument(token, base64Data, mimeType, filename) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  if (!base64Data || !filename) { return { status: 'error', message: 'Nedostaje datoteka za slanje.' }; }
  try {
    var folder = getOpciDokumentiKlijentPristupFolderJavni_();
    var bytes = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', filename);
    var file = folder.createFile(blob);
    return { status: 'ok', id: file.getId(), name: file.getName(), url: file.getUrl(), folderUrl: folder.getUrl() };
  } catch (err) {
    return { status: 'error', message: 'Slanje datoteke nije uspjelo: ' + err.message };
  }
}

// Popis trenutnog sadržaja zajedničkog direktorija "Upute za korisnike" —
// čita SE IZRAVNO IZ DRIVEA (folder.getFiles()), ne iz nekog spremljenog
// JSON popisa, jer folder JEST izvor istine (Saša ga slobodno mijenja i
// izravno u Driveu). `folderUrl` se šalje uz popis — to je vrijednost koja
// ide na mjesto {{LINK_OPCIH_DOKUMENATA}} taga u predlošku (vidi
// renderMailTekst_ u InTime_Admin.html).
function adminDohvatiKlijentPristupOpceDokumente(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  try {
    var folder = getOpciDokumentiKlijentPristupFolderJavni_();
    var lista = [];
    var files = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      lista.push({ id: f.getId(), name: f.getName(), url: f.getUrl() });
    }
    lista.sort(function(a, b) { return a.name.localeCompare(b.name); });
    return { status: 'ok', dokumenti: lista, folderUrl: folder.getUrl() };
  } catch (err) {
    return { status: 'error', message: 'Dohvaćanje dokumenata nije uspjelo: ' + err.message };
  }
}

// Uklanja dokument iz zajedničkog direktorija "Upute za korisnike" — STVARNO
// briše (u Drive "Koš", obnovljivo, ne trajno) jer folder je izvor istine
// (za razliku od "Dokumenti za ponudu", gdje "ukloni" samo miče stavku iz
// JSON popisa a datoteka ostaje netaknuta na Driveu — tamo je popis izvor
// istine, ovdje je to sam folder).
function adminObrisiKlijentPristupOpciDokument(token, id) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  if (!id) { return { status: 'error', message: 'Nedostaje ID datoteke.' }; }
  try {
    DriveApp.getFileById(id).setTrashed(true);
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: 'Brisanje datoteke nije uspjelo: ' + err.message };
  }
}

// ---- "POŠALJI PRISTUPNE PODATKE KLIJENTU" — panel u InTime_Admin.html
// (buildAdminFieldsBlock, IZMEĐU panela "Pošalji zahtjev za Online Booking"
// i "Pošalji obavijest poslovnicama"; Sašin izričit zahtjev, 28.9.2026.):
// mail KLIJENTU (ne interni) s korisničkim imenom i lozinkom za Online
// Booking, zahvala na odluci o suradnji. Zaključan dok se ne potvrde OB
// korisničko ime i OB lozinka TE dok se ne pošalje mail za OB zahtjev
// (ADMIN_ONLY_FIELDS.datum_slanja_ob_zahtjeva) — vidi guard u
// InTime_Admin.html. Kad se OVAJ mail pošalje, otključava se zeleni panel
// "Pošalji obavijest poslovnicama" (ADMIN_ONLY_FIELDS.datum_slanja_klijent_pristup,
// upisuje se niže u adminPosaljiKlijentPristupMail). Primatelji = ISTA
// adresa/e kao kod slanja inicijalne ponude ('Mail adrese za slanje ponude
// (admin)', predpopunjeno na klijentskoj strani u InTime_Admin.html) —
// dopušteno više adresa odvojenih zarezom, isti obrazac kao poslovnice
// panel iznad (validirajViseMailova_).
// (30.9.2026., ispravak istog dana: `rowIndex` uklonjen iz potpisa — bio je
// dodan samo radi stvarnih mail-priloga koji su u međuvremenu zamijenjeni
// poveznicom na zajednički Drive direktorij, vidi {{LINK_OPCIH_DOKUMENATA}}
// niže i getOpciDokumentiKlijentPristupFolderJavni_() iznad; test je oduvijek
// išao ISKLJUČIVO na ručno upisanu testMail adresu, nikad na stvarne
// primatelje, pa mu rowIndex više ne treba).
function adminPosaljiKlijentPristupTest(token, testMail, predmet, tijelo, jeHtml) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  testMail = String(testMail || '').trim();
  if (!EMAIL_REGEX_.test(testMail)) { return { status: 'error', message: 'Upišite ispravnu e-mail adresu za testno slanje.' }; }
  if (!tijelo || !String(tijelo).trim()) { return { status: 'error', message: 'Tekst maila je prazan — odaberite predložak.' }; }
  try {
    var opcije = {};
    var plainTijelo = tijelo;
    if (jeHtml) { opcije.htmlBody = tijelo; plainTijelo = skiniHtmlTagoveZaFallback_(tijelo); }
    var predmetTestni_ = '- TEST - ' + (predmet || '(bez predmeta)');
    posaljiMail_(testMail, predmetTestni_, plainTijelo, opcije);
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: 'Slanje testnog maila nije uspjelo: ' + err.message };
  }
}

// Stvarno slanje pristupnih podataka klijentu. Nakon uspješnog slanja
// bilježi datum_slanja_klijent_pristup (umotano u zaseban try/catch — ako
// upis padne, slanje maila i dalje broji kao uspješno) — TO polje pokreće
// otključavanje zelenog panela "Pošalji obavijest poslovnicama" (vidi
// InTime_Admin.html, kredGuardRecheck_/poslGuardRecheck_).
function adminPosaljiKlijentPristupMail(token, rowIndex, primatelji, predmet, tijelo, kopijaSebi, jeHtml) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var primateljiLista = validirajViseMailova_(primatelji);
  if (!primateljiLista) { return { status: 'error', message: 'Upišite barem jednu ispravnu adresu primatelja (odvojene zarezom).' }; }
  if (!tijelo || !String(tijelo).trim()) { return { status: 'error', message: 'Tekst maila je prazan — odaberite predložak.' }; }
  // Zaštita (4.10.2026.): mail s placeholderom o nedodijeljenom kalkulatoru nikad ne smije otići klijentu.
  if (String(tijelo).indexOf('kalkulator još nije dodijeljen') !== -1) { return { status: 'error', message: 'Kalkulator nije dodijeljen klijentu — dodijelite ga ili označite "Klijentu NE dodjeljujem kalkulator".' }; }
  try {
    var opcije = {};
    if (kopijaSebi) { opcije.bcc = NOTIFY_EMAIL; }
    var plainTijelo = tijelo;
    if (jeHtml) { opcije.htmlBody = tijelo; plainTijelo = skiniHtmlTagoveZaFallback_(tijelo); }
    posaljiMail_(primateljiLista.join(','), predmet || '(bez predmeta)', plainTijelo, opcije);
    try {
      var rowIndexKred_ = parseInt(rowIndex, 10);
      if (rowIndexKred_ && rowIndexKred_ >= 2) {
        var sheetKred_ = getOrCreateUpitiSheet();
        if (rowIndexKred_ <= sheetKred_.getLastRow()) {
          var headerKred_ = sheetKred_.getRange(1, 1, 1, sheetKred_.getLastColumn()).getValues()[0];
          upisiAdminPoljeAkoPostoji_(sheetKred_, headerKred_, rowIndexKred_, ADMIN_ONLY_FIELDS.datum_slanja_klijent_pristup, new Date());
        }
      }
    } catch (errZapisKred_) { /* slanje maila je već uspjelo, upis oznake ne smije to poništiti */ }
    return { status: 'ok', poslanoNa: primateljiLista, kopijaSebi: !!kopijaSebi };
  } catch (err) {
    return { status: 'error', message: 'Slanje maila nije uspjelo: ' + err.message };
  }
}

// "Uvodni tekst" za panel "Pošalji pristupne podatke klijentu" — ZASEBNO
// spremište od OB_UVODNI_TEKSTOVI (Sašin izričit zahtjev, 28.9.2026.): ton i
// sadržaj su potpuno drugačiji (zahvala klijentu, ne interna hitnost
// poslovnicama), pa se ne smiju miješati. 10 zadanih varijanti — tekst
// prema Sašinim doslovnim prijedlozima (10 stilskih varijanti zahvale +
// dostave pristupnih podataka). Isti mehanizam kao OB_UVODNI_TEKSTOVI:
// JEDAN Script Property ('KLIJENT_PRISTUP_UVODNI_TEKSTOVI', JSON popis).
var KLIJENT_PRISTUP_UVODNI_TEKST_DEFAULT_ = [
  'Poštovani,\nhvala vam na ukazanom povjerenju i odluci o početku suradnje. Veselim se zajedničkom radu! U nastavku ovog maila dostavljam vam korisničko ime i lozinku te poveznicu za pristup online bookingu, dostupnu i putem gumba. Nakon prijave možete odmah početi unositi svoje pošiljke i koristiti naše usluge. Za sva pitanja ili poteškoće slobodno mi se obratite.',
  'Poštovani,\ndrago mi je što ste nas odabrali za svojeg partnera i veselim se našoj suradnji. Kako biste mogli krenuti s unosom pošiljaka, u ovom vam mailu šaljem sve potrebno za pristup online bookingu: korisničko ime, lozinku i poveznicu koju možete otvoriti klikom na gumb u nastavku. Ako vam zatreba pomoć pri prijavi ili unosu prvih pošiljaka, slobodno me kontaktirajte.',
  'Poštovani,\nhvala vam na povjerenju i odluci o suradnji. Veselim se početku zajedničkog rada. U nastavku su korisničko ime, lozinka i gumb s poveznicom za pristup online bookingu, putem kojeg možete odmah početi unositi pošiljke. Ako imate pitanja ili naiđete na poteškoće, stojim vam na raspolaganju.',
  'Poštovani,\ndobro došli i hvala vam što ste nam povjerili svoje pošiljke. Veselim se suradnji i prvim zajedničkim koracima. U ovom mailu pronaći ćete svoje korisničko ime i lozinku, kao i poveznicu za online booking kojoj možete pristupiti putem gumba u nastavku. Sve je spremno za prijavu i unos vaših prvih pošiljaka. Za pomoć ili dodatna pojašnjenja slobodno mi se javite.',
  'Poštovani,\nzahvaljujem vam na ukazanom povjerenju i odluci o uspostavljanju poslovne suradnje. Veselim se budućem zajedničkom radu. U nastavku poruke dostavljam pristupne podatke za online booking — korisničko ime i lozinku — te poveznicu dostupnu putem priloženog gumba. Prijavom u sustav možete započeti s unosom pošiljaka i korištenjem naših usluga. Za sva pitanja ili poteškoće pri korištenju stojim vam na raspolaganju.',
  'Poštovani,\nhvala vam što ste odlučili započeti suradnju s nama. Veselim se što ćemo raditi zajedno. Za početak vam u nastavku šaljem korisničko ime i lozinku za online booking te gumb s poveznicom za prijavu. Nakon prijave možete krenuti s unosom svojih pošiljaka. Ako bilo što zapne ili vam bude potrebno pojašnjenje, slobodno me kontaktirajte.',
  'Poštovani,\nhvala vam na povjerenju — veselim se našoj suradnji! Kako bi vam početak rada bio što jednostavniji, u ovom sam mailu pripremio sve podatke za pristup online bookingu. U nastavku ćete pronaći korisničko ime, lozinku i gumb koji vas vodi na stranicu za prijavu, nakon koje možete odmah početi unositi pošiljke. Ako vam zatreba pomoć u bilo kojem koraku, slobodno mi se obratite.',
  'Poštovani,\nhvala vam što ste nas odabrali za partnera u organizaciji svojih pošiljaka. Veselim se uspješnoj suradnji. U nastavku vam dostavljam korisničko ime i lozinku te poveznicu za online booking, dostupnu klikom na gumb. Time imate sve potrebno za prijavu, unos prvih pošiljaka i početak rada s nama. Za pitanja, pomoć ili eventualne poteškoće možete me slobodno kontaktirati.',
  'Dobar dan,\nhvala vam na odluci da krenemo u suradnju — veselim se zajedničkom radu! U ovom mailu šaljem vam korisničko ime i lozinku te poveznicu za online booking, koju možete otvoriti putem gumba u nastavku. Nakon prijave možete odmah krenuti s unosom pošiljaka. Ako budete imali pitanja ili poteškoća, javite mi se i pomoći ću vam.',
  'Poštovani,\nzahvaljujem vam na povjerenju i veselim se početku naše suradnje. U nastavku ovog maila nalaze se korisničko ime i lozinka te gumb s poveznicom za pristup online bookingu, kako biste mogli započeti s unosom svojih pošiljaka i radom s nama. Tu sam za sva pitanja, pomoć pri prvom unosu ili eventualne poteškoće — slobodno me kontaktirajte.'
];
var KLIJENT_PRISTUP_UVODNI_TEKSTOVI_MAX_ = 20;

function ucitajKlijentPristupUvodneTekstove_() {
  var props = PropertiesService.getScriptProperties();
  var sirovo = props.getProperty('KLIJENT_PRISTUP_UVODNI_TEKSTOVI');
  if (!sirovo) {
    var zadano = KLIJENT_PRISTUP_UVODNI_TEKST_DEFAULT_.map(function(tekst, i) { return { id: 'zadano_' + (i + 1), tekst: tekst, prilagodjen: false }; });
    props.setProperty('KLIJENT_PRISTUP_UVODNI_TEKSTOVI', JSON.stringify(zadano));
    return zadano;
  }
  try {
    var lista = JSON.parse(sirovo);
    return Array.isArray(lista) ? lista : [];
  } catch (e) {
    return [];
  }
}
function spremiKlijentPristupUvodneTekstove_(lista) {
  PropertiesService.getScriptProperties().setProperty('KLIJENT_PRISTUP_UVODNI_TEKSTOVI', JSON.stringify(lista));
}
function adminKlijentPristupUvodniTekstoviList(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  return { status: 'ok', tekstovi: ucitajKlijentPristupUvodneTekstove_() };
}
function adminKlijentPristupUvodniTekstDodaj(token, tekst) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  tekst = String(tekst || '').trim();
  if (!tekst) { return { status: 'error', message: 'Tekst je prazan.' }; }
  var lista = ucitajKlijentPristupUvodneTekstove_();
  if (lista.length >= KLIJENT_PRISTUP_UVODNI_TEKSTOVI_MAX_) {
    return { status: 'error', message: 'Dosegnut je maksimalan broj od ' + KLIJENT_PRISTUP_UVODNI_TEKSTOVI_MAX_ + ' tekstova — obriši neki prije dodavanja novog.' };
  }
  var novi = { id: 'prilagodjen_' + Date.now() + '_' + Math.floor(Math.random() * 10000), tekst: tekst, prilagodjen: true };
  lista.push(novi);
  spremiKlijentPristupUvodneTekstove_(lista);
  return { status: 'ok', tekstovi: lista };
}
function adminKlijentPristupUvodniTekstObrisi(token, id) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var lista = ucitajKlijentPristupUvodneTekstove_().filter(function(t) { return t.id !== id; });
  spremiKlijentPristupUvodneTekstove_(lista);
  return { status: 'ok', tekstovi: lista };
}
function adminKlijentPristupUvodniTekstoviReset(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var zadano = KLIJENT_PRISTUP_UVODNI_TEKST_DEFAULT_.map(function(tekst, i) { return { id: 'zadano_' + (i + 1), tekst: tekst, prilagodjen: false }; });
  spremiKlijentPristupUvodneTekstove_(zadano);
  return { status: 'ok', tekstovi: zadano };
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
  // Ručni unos iz brzog modula (4.10.2026.): vrijedi SAMO uz važeći token (PIN-prijava ili admin sesija).
  // Takav upit ulazi kao običan "Interes" (kartica Zainteresirani), uz oznaku u internoj napomeni;
  // potvrda klijentu ide mailom SAMO ako je to izričito označeno (brzi_potvrda_klijentu = 'Da').
  var rucniUnos = false;
  try { rucniUnos = isValidBrziToken_(data.brzi_token); } catch (rucniErr) { rucniUnos = false; }
  if (data.brzi_token && !rucniUnos) {
    // Token je poslan, ali nije (više) važeći — NE spremaj kao običan javni upit.
    return { status: 'error', code: 'auth', message: 'Sesija brzog modula je istekla — prijavi se ponovno PIN-om.' };
  }
  var saljiPotvrduKlijentu = !rucniUnos || String(data.brzi_potvrda_klijentu || '') === 'Da';
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
  if (rucniUnos) {
    try {
      var internaCol = izracunajOcekivanoZaglavljeUpiti_().indexOf(ADMIN_ONLY_FIELDS.interna_napomena);
      if (internaCol !== -1) {
        sheet.getRange(sheet.getLastRow(), internaCol + 1).setValue('Ručni unos (brzi modul) ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm'));
      }
    } catch (rucniOznakaErr) { /* oznaka je pomoćna — greška ne smije srušiti spremanje */ }
  }

  // Automatski prijenos u Imenik (13. krug, Sašin izričit zahtjev) — svih do
  // 5 kontakt-osoba iz ovog upitnika (unosnik/računovodstvo/odgovorna osoba/
  // kontakt osoba/logistika), best effort, greška ovdje NE smije spriječiti
  // mailove ispod.
  // Kod ručnog unosa osoba koja unosi (Saša) NE ulazi u Imenik kao klijentov kontakt.
  var podaciZaImenik = data;
  if (rucniUnos) {
    podaciZaImenik = {};
    Object.keys(data).forEach(function(k) { if (k.indexOf('unosnik_') !== 0) { podaciZaImenik[k] = data[k]; } });
  }
  try { obradiKontakteZaImenik_(izvuciKontakteIzUpitnika_(podaciZaImenik), 'Upitnik', broj); } catch (imenikErr) { /* vidi IMENIK_ZADNJA_GRESKA u Script Properties */ }

  // 1) Obavijest Saši — cijeli upitnik, sortiran po sekcijama
  posaljiMail_({
    to: NOTIFY_EMAIL,
    // Broj dokumenta na početku subjecta (Sašin izričit zahtjev 15.9.2026.)
    // — isti broj ide i Saši i klijentu, radi lakšeg pretraživanja/
    // povezivanja maila s konkretnim zapisom u adminu/Sheetu.
    subject: '[' + broj + '] ' + (rucniUnos ? '[RUČNI UNOS] ' : '') + 'Novi prodajni upitnik — ' + (val(data.naziv) || 'nepoznata tvrtka'),
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
  if (replyEmail && saljiPotvrduKlijentu) {
    posaljiMail_({
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
      posaljiMail_({
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
  posaljiMail_({
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
    posaljiMail_({
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
  // NOVO (23.9.2026.) — ocjena voditelja ključnih kupaca kod prihvaćanja
  // ponude. Vidi punu napomenu uz ADMIN_ONLY_FIELDS.potvrda_ocjena_znanje
  // gore. Dodano NA SAM KRAJ, isti razlog kao stupci iznad.
  header.push('Ocjena voditelja KAM - znanje (klijent)');
  header.push('Ocjena voditelja KAM - prezentacija tvrtke (klijent)');
  header.push('Ocjena voditelja KAM - nacin ugovaranja (klijent)');
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
  // NOVO (23.9.2026., trideset i šesti krug) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.datum_odustajanja_mi gore. Dodano NA SAM KRAJ, isti
  // razlog kao stupci iznad.
  header.push('Datum odustajanja od klijenta - mi (admin)');
  // NOVO (23.9.2026.) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.mail_istek_poslan gore. Dodano NA SAM KRAJ, isti
  // razlog kao stupci iznad.
  header.push('Datum slanja obavijesti o isteku ponude (admin)');
  // NOVO (23.9.2026.) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.klijent_folder_id/aktivni_predirektorij_folder_id
  // gore. Dodano NA SAM KRAJ, isti razlog kao stupci iznad.
  header.push('ID glavnog direktorija klijenta (admin)');
  header.push('ID aktivnog predirektorija ponude (admin)');
  // NOVO (23.9.2026.) — vidi punu napomenu uz ADMIN_ONLY_FIELDS.arhiva_kategorija
  // gore. Dodano na sam kraj, isti razlog kao stupci iznad.
  header.push('Kategorija arhiviranja (admin)');
  // NOVO (23.9.2026., Dio 2) — vidi punu napomenu uz ADMIN_ONLY_FIELDS.skriveno
  // gore. Dodano na sam kraj, isti razlog kao stupci iznad.
  header.push('Skriveno (admin)');
  // NOVO (28.9.2026.) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.datum_slanja_ob_zahtjeva/datum_slanja_klijent_pristup
  // gore. Dodano na sam kraj, isti razlog kao stupci iznad.
  header.push('Datum slanja zahtjeva za OB (admin)');
  header.push('Datum slanja maila klijentu s pristupnim podacima (admin)');
  // NOVO (30.9.2026.) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.kalkulator_korisnicko_ime gore. Svih 5 dodano NA SAM
  // KRAJ, isti razlog kao stupci iznad.
  header.push('Kalkulator korisničko ime (admin)');
  header.push('Kalkulator lozinka (admin)');
  header.push('Kalkulator cjenik klijenta (admin, JSON)');
  header.push('Kalkulator cjenik - naziv datoteke (admin)');
  header.push('Datum dodjele cjenika u kalkulator (admin)');
  // NOVO (30.9.2026., nastavak istog dana) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.kalkulator_postavke_json gore. Dodano na sam kraj, isti
  // razlog kao stupci iznad.
  header.push('Kalkulator dodatne postavke (admin, JSON)');
  // NOVO (30.9.2026., nastavak istog dana) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.karta_prikupa_url gore. Dodano na sam kraj, isti razlog
  // kao stupci iznad.
  header.push('Karta prikupa - URL slike (admin)');
  header.push('Karta prikupa - adresa koja je geokodirana (admin)');
  header.push('Datum generiranja karte prikupa (admin)');
  // NOVO (30.9.2026., nastavak istog dana) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.kalkulator_zamrznuto gore. Dodano na sam kraj, isti
  // razlog kao stupci iznad.
  header.push('Kalkulator pristup zamrznut (admin)');
  // NOVO (30.9.2026., nastavak istog dana) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.ispravljena_adresa_prikupa gore. Dodano na sam kraj,
  // isti razlog kao stupci iznad.
  header.push('Ispravljena adresa prikupa (admin)');
  header.push('Ispravljeni poštanski broj prikupa (admin)');
  header.push('Ispravljeno mjesto prikupa (admin)');
  // NOVO (1.10.2026., dvadeset i prvi krug) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.ispravljena_osoba_prikupa / karta_prikupa_lat gore.
  // Dodano na sam kraj, isti razlog kao stupci iznad.
  header.push('Ispravljena osoba zadužena za prikup (admin)');
  header.push('Ispravljeni telefon prikupa (admin)');
  header.push('Ispravljeni email prikupa (admin)');
  header.push('Karta prikupa - lat (admin)');
  header.push('Karta prikupa - lon (admin)');
  // NOVO (2.10.2026.) — vidi punu napomenu uz
  // ADMIN_ONLY_FIELDS.datum_slanja_poslovnice_obavijest gore. Dodano na sam
  // kraj, isti razlog kao stupci iznad.
  header.push('Datum slanja obavijesti nadležnim poslovnicama (admin)');
  // NOVO (3.10.2026.) — vidi ADMIN_ONLY_FIELDS.datum_slanja_sve_poslovnice_obavijest.
  header.push('Datum slanja obavijesti svim poslovnicama (admin)');
  // (30.9.2026., ISPRAVAK ISTI DAN: stupac "Dokumenti uz pristupne podatke
  // (admin, JSON)" koji je ovdje kratko bio dodan uklonjen je zajedno s
  // ADMIN_ONLY_FIELDS.dokumenti_klijent_pristup gore — vidi napomenu ondje.
  // Ako je ovaj stupac već fizički u Sheetu zbog međuverzije koda, ostaje
  // tamo neiskorišten/neškodljiv — ne čita ga više nijedna funkcija.)
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

    posaljiMail_(mail, subject, body, { attachments: [xlsxBlob] });
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
      posaljiMail_({
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
      posaljiMail_({
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

// ---- Prazni "Kanta - za brisanje" (Sašin izričit zahtjev, 23.9.2026.,
// trideset i treći krug) — briše (setTrashed) SVE datoteke i poddirektorije
// izravno unutar KANTA_ZA_BRISANJE_FOLDER_ID_. Poziva je dnevni triger
// (vidi postaviTrigerZaDnevnoCiscenjeKante niže). Sigurno za ponovno
// pokretanje — ako je kanta već prazna, jednostavno ne radi ništa. ----
function dnevnoCiscenjeKanteZaBrisanje_() {
  var kanta = DriveApp.getFolderById(KANTA_ZA_BRISANJE_FOLDER_ID_);
  var brojObrisanih = 0;
  var datoteke = kanta.getFiles();
  while (datoteke.hasNext()) { datoteke.next().setTrashed(true); brojObrisanih++; }
  var poddirektoriji = kanta.getFolders();
  while (poddirektoriji.hasNext()) { poddirektoriji.next().setTrashed(true); brojObrisanih++; }
  Logger.log('Kanta za brisanje očišćena — obrisano ' + brojObrisanih + ' stavki.');
}

// ---- JEDNOKRATNO POKRETANJE (ručno, jednom u editoru) — postavlja dnevni
// vremenski triger koji poziva dnevnoCiscenjeKanteZaBrisanje_() svaki dan
// oko 23:59 (Apps Script vremenski triger nije precizan do minute — pali se
// negdje unutar sata koji zadaš, .nearMinute(59) samo ga pokušava približiti
// kraju sata; ako treba točnija minuta, javi pa prebacimo na drukčiji
// mehanizam). Sigurno je pokrenuti više puta — prvo briše stari triger za
// istu funkciju ako postoji, da se ne gomilaju duplikati. ----
function postaviTrigerZaDnevnoCiscenjeKante() {
  var postojeci = ScriptApp.getProjectTriggers();
  for (var i = 0; i < postojeci.length; i++) {
    if (postojeci[i].getHandlerFunction() === 'dnevnoCiscenjeKanteZaBrisanje_') {
      ScriptApp.deleteTrigger(postojeci[i]);
    }
  }
  ScriptApp.newTrigger('dnevnoCiscenjeKanteZaBrisanje_')
    .timeBased()
    .everyDays(1)
    .atHour(23)
    .nearMinute(59)
    .create();
  Logger.log('Triger postavljen — dnevnoCiscenjeKanteZaBrisanje_() pokretat će se svaki dan oko 23:59.');
}

// ============================================================
// GORIVO — STVARNI mjesečni postotci dodatka na gorivo + mail podsjetnik
// za unos (Sašin izričit zahtjev, 25.9.2026., glasovna poruka): "Treba mi
// program slati podsjetnik zadnjih 7 dana u mjesecu, da treba unijeti
// dodatak na gorivo, ako nije unešeno. U adminu treba biti polje gdje će
// se unijeti mail adresa... Ako je moguće napraviti u samom mailu mjesto
// gdje će se unijeti dodatak na gorivo i vratiti da se on automatski unese
// u program." Ovaj Sheet je STVARNI izvor podataka (za razliku od
// InTime_Gorivo_Graf.html, koji je i dalje demo predložak s lokalnim JS
// nizom — puni graf u adminu i na naslovnici dolazi sljedeći krug, kad
// dobijemo Sašinu skicu za raspored na naslovnici). Jedan redak po mjesecu:
// Godina, Mjesec (1-12), Postotak, Napomena, DatumUnosa.
// ============================================================

function getOrCreateGorivoSheet_() {
  var files = DriveApp.getFilesByName(GORIVO_SHEET_NAME);
  var ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(GORIVO_SHEET_NAME);
    var sheet = ss.getSheets()[0];
    var header = ['Godina', 'Mjesec', 'Postotak', 'Napomena', 'DatumUnosa'];
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return ss.getSheets()[0];
}

// Vraća SVE retke kao obične objekte — admin prikaz + osnova za provjeru
// "je li sljedeći mjesec već unesen" u gorivoDnevnaProvjera_() niže.
function gorivoUcitajSveRedove_() {
  var sheet = getOrCreateGorivoSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return []; }
  var data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  var rezultat = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (!row[0] && !row[1]) { continue; }
    rezultat.push({
      rowIndex: i + 2,
      godina: parseInt(row[0], 10),
      mjesec: parseInt(row[1], 10),
      postotak: parseFloat(row[2]),
      napomena: row[3] ? String(row[3]) : '',
      datumUnosa: row[4] ? new Date(row[4]).toISOString() : ''
    });
  }
  return rezultat;
}

function gorivoDohvatiPostotke(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var redovi = gorivoUcitajSveRedove_();
  redovi.sort(function(a, b) { return (a.godina - b.godina) || (a.mjesec - b.mjesec); });
  return { status: 'ok', redovi: redovi };
}

// Upisuje/ažurira postotak za jedan mjesec — RETROAKTIVNO unošenje je
// namjerno dopušteno (u skladu s ranijim dogovorom u ovoj sesiji da se
// postotak ne fiksira unaprijed u ponudama, nego se uvijek povlači
// aktualan). Ako redak za taj mjesec/godinu već postoji, prepisuje ga
// (upsert); inače dodaje novi. Zaključava se LockService-om (kao ostale
// funkcije koje pišu u Sheet, npr. adminUpdateFields) da dva istovremena
// spremanja ne dupliciraju redak.
function gorivoSpremiPostotak(token, godina, mjesec, postotak, napomena) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  godina = parseInt(godina, 10);
  mjesec = parseInt(mjesec, 10);
  var postotakBroj = parseFloat(String(postotak).replace(',', '.'));
  if (!godina || godina < 2000 || godina > 2100) { return { status: 'error', message: 'Neispravna godina.' }; }
  if (!mjesec || mjesec < 1 || mjesec > 12) { return { status: 'error', message: 'Neispravan mjesec.' }; }
  if (isNaN(postotakBroj) || postotakBroj < 0 || postotakBroj > 100) { return { status: 'error', message: 'Neispravan postotak (mora biti broj 0–100).' }; }
  gorivoSpremiPostotakInterno_(godina, mjesec, postotakBroj, napomena || '');
  return { status: 'ok' };
}

// Interna verzija (bez provjere admin tokena) — koristi je i
// gorivoSpremiPostotak (admin) iznad i gorivoObradiUnosTokenom_ niže (unos
// preko mail podsjetnika, bez prijave u admin).
function gorivoSpremiPostotakInterno_(godina, mjesec, postotak, napomena) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getOrCreateGorivoSheet_();
    var lastRow = sheet.getLastRow();
    var foundRow = -1;
    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      for (var i = 0; i < data.length; i++) {
        if (parseInt(data[i][0], 10) === godina && parseInt(data[i][1], 10) === mjesec) { foundRow = i + 2; break; }
      }
    }
    var sada = new Date();
    if (foundRow > -1) {
      sheet.getRange(foundRow, 3, 1, 3).setValues([[postotak, napomena || '', sada]]);
    } else {
      sheet.appendRow([godina, mjesec, postotak, napomena || '', sada]);
    }
  } finally {
    lock.releaseLock();
  }
}

function gorivoObrisiPostotak(token, godina, mjesec) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  godina = parseInt(godina, 10);
  mjesec = parseInt(mjesec, 10);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getOrCreateGorivoSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) { return { status: 'error', message: 'Nema unosa.' }; }
    var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      if (parseInt(data[i][0], 10) === godina && parseInt(data[i][1], 10) === mjesec) {
        sheet.deleteRow(i + 2);
        return { status: 'ok' };
      }
    }
    return { status: 'error', message: 'Unos nije pronađen.' };
  } finally {
    lock.releaseLock();
  }
}

// ---- E-mail adresa za podsjetnike — PropertiesService, s
// "✓ Potvrdi"/"✎ Promijeni" zaključavanjem (isti obrazac kao INTRIX šifra
// ponude — vidi napomenu uz af-sifra-btn u InTime_Admin.html). Klik na
// "Promijeni" NE briše zapamćenu adresu (ostaje kao prijedlog u polju za
// izmjenu) — samo skida zaključavanje da se može upisati nova. ----
function gorivoDohvatiEmailPodsjetnik(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var props = PropertiesService.getScriptProperties();
  return {
    status: 'ok',
    email: props.getProperty('GORIVO_PODSJETNIK_EMAIL') || '',
    zakljucano: props.getProperty('GORIVO_PODSJETNIK_EMAIL_ZAKLJUCANO') === 'da'
  };
}

function gorivoSpremiEmailPodsjetnik(token, email) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  email = String(email || '').trim();
  if (!EMAIL_REGEX_.test(email)) { return { status: 'error', message: 'Upišite ispravnu e-mail adresu.' }; }
  var props = PropertiesService.getScriptProperties();
  props.setProperty('GORIVO_PODSJETNIK_EMAIL', email);
  props.setProperty('GORIVO_PODSJETNIK_EMAIL_ZAKLJUCANO', 'da');
  return { status: 'ok' };
}

function gorivoOtkljucajEmailPodsjetnik(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  PropertiesService.getScriptProperties().setProperty('GORIVO_PODSJETNIK_EMAIL_ZAKLJUCANO', '');
  return { status: 'ok' };
}

var GORIVO_MJESECI_HR_NAZIVI_ = ['siječanj', 'veljača', 'ožujak', 'travanj', 'svibanj', 'lipanj', 'srpanj', 'kolovoz', 'rujan', 'listopad', 'studeni', 'prosinac'];

function gorivoDohvatiTokene_() {
  var raw = PropertiesService.getScriptProperties().getProperty('GORIVO_UNOS_TOKENI');
  return raw ? JSON.parse(raw) : {};
}
function gorivoSpremiTokene_(tokeni) {
  PropertiesService.getScriptProperties().setProperty('GORIVO_UNOS_TOKENI', JSON.stringify(tokeni));
}
// Čisti istekle tokene usput (isti obrazac kao isValidAdminToken_ za
// ADMIN_SESSIONS) — poziva se pri svakom čitanju tokena.
function gorivoOcistiIstekleTokene_(tokeni) {
  var now = Date.now();
  var changed = false;
  Object.keys(tokeni).forEach(function(t) {
    if (tokeni[t].expires < now) { delete tokeni[t]; changed = true; }
  });
  if (changed) { gorivoSpremiTokene_(tokeni); }
  return tokeni;
}

// ISPRAVAK (30.9.2026., Sašin izričit zahtjev — kliknuo je na poveznicu iz
// SVJEŽE poslanog podsjetnika i dobio Googleov "datoteka ne postoji" zaslon
// umjesto stranice za unos): `ScriptApp.getService().getUrl()` NIJE pouzdan
// u ovom projektu — vraćao je URL sasvim DRUGE (arhivirane/obrisane) Web App
// instalacije nego onu koju stvarno koriste sve HTML datoteke
// (`GAS_WEB_APP_URL` na dnu InTime_Admin.html i dr.), vjerojatno zato što
// Sašin Apps Script projekt ima/je imao više od jednog aktivnog "Web app"
// deploymenta. Zato je link SAD hardkodiran, isti obrazac kao OB_LOGIN_URL_
// iznad — ako se ikad stvarno promijeni /exec URL (novi deployment umjesto
// ažuriranja postojećeg), treba ručno ažurirati OVU konstantu, ISTO kao što
// se već ručno ažurira GAS_WEB_APP_URL u svakoj HTML datoteci.
var GORIVO_WEB_APP_URL_ = 'https://script.google.com/macros/s/AKfycbz73zkx72GhrDZ-t3CamF5wuz-9V7Uxe5z9IkFxHA8F5FBlrIlc7zMUd4_EHTILD9FTAw/exec';

// Generira jednokratan token (vrijedi 30 dana — dovoljno da pokrije i
// zakašnjeli unos), sprema ga i šalje mail s linkom koji vodi na doGet
// stranicu za brzi unos (gorivoStranicaUnosa_ niže) — BEZ potrebe za
// prijavom u admin. Koristi GORIVO_WEB_APP_URL_ iznad (NE
// ScriptApp.getService().getUrl() — vidi napomenu uz tu konstantu zašto).
function gorivoPosaljiPodsjetnikMail_(email, godina, mjesec) {
  var token = Utilities.getUuid() + Utilities.getUuid();
  var tokeni = gorivoDohvatiTokene_();
  tokeni[token] = { godina: godina, mjesec: mjesec, expires: Date.now() + (30 * 24 * 60 * 60 * 1000) };
  gorivoSpremiTokene_(tokeni);

  var url = GORIVO_WEB_APP_URL_ + '?action=gorivoUnos&token=' + encodeURIComponent(token);
  var nazivMjeseca = GORIVO_MJESECI_HR_NAZIVI_[mjesec - 1] + ' ' + godina;
  var predmet = 'Podsjetnik: unesite dodatak na gorivo za ' + nazivMjeseca;
  var tekst = 'Poštovani,\n\nPribližava se kraj mjeseca, a dodatak na gorivo za ' + nazivMjeseca + ' još nije unesen.\n\n' +
    'Unesite ga izravno ovdje (bez potrebe za prijavom):\n' + url + '\n\n' +
    'Ova poveznica vrijedi 30 dana i može se iskoristiti samo jednom.\n\nIn Time — automatska obavijest';
  var html = '<p>Poštovani,</p>' +
    '<p>Približava se kraj mjeseca, a dodatak na gorivo za <strong>' + nazivMjeseca + '</strong> još nije unesen.</p>' +
    '<p><a href="' + url + '" style="display:inline-block;background:#229891;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold;">Unesi dodatak na gorivo za ' + nazivMjeseca + '</a></p>' +
    '<p style="color:#777;font-size:13px;">Ova poveznica vrijedi 30 dana i može se iskoristiti samo jednom. Ako gumb ne radi, kopirajte ovu poveznicu: ' + url + '</p>' +
    '<p style="color:#999;font-size:12px;">In Time — automatska obavijest</p>';
  posaljiMail_(email, predmet, tekst, { htmlBody: html });
}

// Admin gumb "Pošalji test podsjetnik sada" — šalje ODMAH, zaobilazeći
// uvjete (zadnjih 7 dana / još nije uneseno) iz gorivoDnevnaProvjera_,
// da Saša može provjeriti da cijeli lanac (mail → klik → unos) radi.
// Cilja UVIJEK sljedeći kalendarski mjesec (isto kao stvarni podsjetnik).
function gorivoPosaljiTestPodsjetnik(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var email = PropertiesService.getScriptProperties().getProperty('GORIVO_PODSJETNIK_EMAIL');
  if (!email) { return { status: 'error', message: 'Prvo potvrdite e-mail adresu za podsjetnike (gore).' }; }
  var danas = new Date();
  var sljedeci = new Date(danas.getFullYear(), danas.getMonth() + 1, 1);
  try {
    gorivoPosaljiPodsjetnikMail_(email, sljedeci.getFullYear(), sljedeci.getMonth() + 1);
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: 'Slanje nije uspjelo: ' + err.message };
  }
}

// ---- Dnevna provjera — poziva je vremenski triger (vidi
// postaviTrigerZaGorivoPodsjetnik niže). Šalje podsjetnik SAMO ako: (a) je
// danas jedan od zadnjih 7 dana u mjesecu, (b) SLJEDEĆI mjesec još nema
// postotak upisan, i (c) je adresa za podsjetnike potvrđena/zaključana u
// adminu. Pamti datum zadnjeg slanja (Script Properties) da ne pošalje
// dvaput isti dan ako triger iz bilo kojeg razloga opali više puta. ----
function gorivoDnevnaProvjera_() {
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty('GORIVO_PODSJETNIK_EMAIL');
  var zakljucano = props.getProperty('GORIVO_PODSJETNIK_EMAIL_ZAKLJUCANO') === 'da';
  if (!email || !zakljucano) { return; } // adresa nije potvrđena — nema kome slati

  var danas = new Date();
  var zadnjiDanMjeseca = new Date(danas.getFullYear(), danas.getMonth() + 1, 0).getDate();
  if (danas.getDate() < (zadnjiDanMjeseca - 6)) { return; } // još nismo u zadnjih 7 dana mjeseca

  var danasnjiKljuc = Utilities.formatDate(danas, Session.getScriptTimeZone() || 'Europe/Zagreb', 'yyyy-MM-dd');
  if (props.getProperty('GORIVO_PODSJETNIK_ZADNJI_DATUM') === danasnjiKljuc) { return; } // već poslano danas

  var sljedeci = new Date(danas.getFullYear(), danas.getMonth() + 1, 1);
  var ciljanaGodina = sljedeci.getFullYear();
  var ciljaniMjesec = sljedeci.getMonth() + 1;

  var vecUnesen = gorivoUcitajSveRedove_().some(function(r) { return r.godina === ciljanaGodina && r.mjesec === ciljaniMjesec; });
  if (vecUnesen) { return; } // već uneseno — nema potrebe za podsjetnikom

  gorivoPosaljiPodsjetnikMail_(email, ciljanaGodina, ciljaniMjesec);
  props.setProperty('GORIVO_PODSJETNIK_ZADNJI_DATUM', danasnjiKljuc);
}

// Zajednički minimalni HTML omot za doGet stranice (poveznica iz maila) —
// namjerno vrlo jednostavno (bez ovisnosti, bez JS-a osim samog <form>
// POST-a), da se dobro čita i radi pouzdano i na mobitelu/u mail klijentima.
function gorivoHtmlOmot_(sadrzaj) {
  return '<!DOCTYPE html><html lang="hr"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>In Time — dodatak na gorivo</title>' +
    '<style>' +
    'body{font-family:Arial,Helvetica,sans-serif;max-width:420px;margin:40px auto;padding:0 20px;color:#1a1a1a;}' +
    'h1{font-size:20px;color:#135450;}' +
    'label{display:block;margin:18px 0 6px;font-weight:bold;}' +
    'input[type=number]{width:100%;padding:12px;font-size:18px;border:1px solid #ccc;border-radius:8px;box-sizing:border-box;}' +
    'button{margin-top:20px;width:100%;padding:14px;background:#229891;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;}' +
    'p{line-height:1.5;}' +
    '</style></head><body>' + sadrzaj + '</body></html>';
}

// doGet stranica (bez prijave) za brzi unos — HtmlService generira
// samostalnu stranicu s OBIČNIM <form method="POST"> (ne JS/fetch), da radi
// pouzdano bez CORS-a — obrada je u doPost, grana 'gorivoToken' na samom
// vrhu funkcije (vidi gorivoObradiUnosTokenom_ niže).
function gorivoStranicaUnosa_(token) {
  var tokeni = gorivoOcistiIstekleTokene_(gorivoDohvatiTokene_());
  var podaci = token ? tokeni[token] : null;
  var html;
  if (!podaci) {
    html = gorivoHtmlOmot_('<h1>Poveznica nije važeća</h1><p>Ova poveznica za unos dodatka na gorivo je istekla ili je već iskorištena. Unesite postotak izravno u admin sučelju (kartica „Gorivo”).</p>');
  } else {
    var nazivMjeseca = GORIVO_MJESECI_HR_NAZIVI_[podaci.mjesec - 1] + ' ' + podaci.godina;
    html = gorivoHtmlOmot_(
      '<h1>Unos dodatka na gorivo</h1>' +
      '<p>Mjesec: <strong>' + nazivMjeseca + '</strong></p>' +
      // Isti razlog kao GORIVO_WEB_APP_URL_ (vidi napomenu uz tu konstantu) —
      // ScriptApp.getService().getUrl() ovdje vraćao pogrešan URL.
      '<form method="POST" action="' + GORIVO_WEB_APP_URL_ + '">' +
      '<input type="hidden" name="gorivoToken" value="' + String(token).replace(/"/g, '&quot;') + '">' +
      '<label for="postotak">Postotak dodatka na gorivo (%)</label>' +
      '<input type="number" step="0.01" min="0" max="100" name="postotak" id="postotak" required autofocus>' +
      '<button type="submit">Spremi</button>' +
      '</form>'
    );
  }
  return HtmlService.createHtmlOutput(html).setTitle('In Time — dodatak na gorivo');
}

// Obrada native <form method="POST"> unosa iz gorivoStranicaUnosa_ — poziva
// je izravno doPost (grana 'gorivoToken', PRIJE JSON.parse). Token je
// JEDNOKRATAN — briše se odmah nakon uspješnog spremanja; ako korisnik
// ponovno otvori/pošalje isti link, drugi put dobiva "nije važeća".
function gorivoObradiUnosTokenom_(token, postotakSirovi) {
  var tokeni = gorivoOcistiIstekleTokene_(gorivoDohvatiTokene_());
  var podaci = tokeni[token];
  var html;
  if (!podaci) {
    html = gorivoHtmlOmot_('<h1>Poveznica nije važeća</h1><p>Ova poveznica je istekla ili je već iskorištena.</p>');
  } else {
    var postotakBroj = parseFloat(String(postotakSirovi || '').replace(',', '.'));
    if (isNaN(postotakBroj) || postotakBroj < 0 || postotakBroj > 100) {
      html = gorivoHtmlOmot_('<h1>Neispravan unos</h1><p>Postotak mora biti broj između 0 i 100. Vratite se na prethodnu stranicu i pokušajte ponovno.</p>');
    } else {
      gorivoSpremiPostotakInterno_(podaci.godina, podaci.mjesec, postotakBroj, 'Unešeno putem mail podsjetnika');
      delete tokeni[token];
      gorivoSpremiTokene_(tokeni);
      var nazivMjeseca = GORIVO_MJESECI_HR_NAZIVI_[podaci.mjesec - 1] + ' ' + podaci.godina;
      html = gorivoHtmlOmot_('<h1>Spremljeno ✓</h1><p>Dodatak na gorivo za <strong>' + nazivMjeseca + '</strong> je spremljen: <strong>' + String(postotakBroj).replace('.', ',') + '%</strong>.</p>');
      try {
        posaljiMail_(NOTIFY_EMAIL, 'Dodatak na gorivo spremljen putem mail podsjetnika', 'Za ' + nazivMjeseca + ' je putem mail podsjetnika spremljen postotak: ' + postotakBroj + '%.');
      } catch (errNotify) { /* obavijest nije kritična — glavni upis je već spremljen */ }
    }
  }
  return HtmlService.createHtmlOutput(html).setTitle('In Time — dodatak na gorivo');
}

// ---- JEDNOKRATNO POKRETANJE (ručno, jednom u editoru) — postavlja dnevni
// triger koji poziva gorivoDnevnaProvjera_() svaki dan (provjerava treba li
// poslati podsjetnik za unos dodatka na gorivo). Isti obrazac kao
// postaviTrigerZaDnevnoCiscenjeKante iznad. Sigurno je pokrenuti više puta —
// prvo briše stari triger za istu funkciju ako postoji. ----
function postaviTrigerZaGorivoPodsjetnik() {
  var postojeci = ScriptApp.getProjectTriggers();
  for (var i = 0; i < postojeci.length; i++) {
    if (postojeci[i].getHandlerFunction() === 'gorivoDnevnaProvjera_') {
      ScriptApp.deleteTrigger(postojeci[i]);
    }
  }
  ScriptApp.newTrigger('gorivoDnevnaProvjera_')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .nearMinute(0)
    .create();
  Logger.log('Triger postavljen — gorivoDnevnaProvjera_() pokretat će se svaki dan oko 8:00.');
}

// ---- JEDNOKRATNO POKRETANJE (ručno, jednom u editoru) — puni STVARNE
// mjesečne postotke od siječnja do rujna 2026. u InTime_Gorivo_Postotci, da
// Saša ne mora ručno upisivati 9 unosa kroz admin (Sašin izričit zahtjev,
// 25.9.2026.: "molim te ti unesi postotke koje imamo od 4 mjeseca do
// sada... znaci kreni od 15% pa na dalje prema sada 9 mj" — 15% je
// vrijedilo siječanj–ožujak, prije objavljene promjene na 20% od 1.4.).
// Sigurno za ponovno pokretanje — gorivoSpremiPostotakInterno_ je upsert
// (prepisuje postojeći redak za isti mjesec/godinu, ne duplicira). ----
function gorivoUcitajPocetnePodatke() {
  var podaci = [
    { godina: 2026, mjesec: 1, postotak: 15 },
    { godina: 2026, mjesec: 2, postotak: 15 },
    { godina: 2026, mjesec: 3, postotak: 15 },
    { godina: 2026, mjesec: 4, postotak: 20 },
    { godina: 2026, mjesec: 5, postotak: 20.5 },
    { godina: 2026, mjesec: 6, postotak: 19 },
    { godina: 2026, mjesec: 7, postotak: 17.5 },
    { godina: 2026, mjesec: 8, postotak: 20.5 },
    { godina: 2026, mjesec: 9, postotak: 21.5 }
  ];
  podaci.forEach(function(p) {
    gorivoSpremiPostotakInterno_(p.godina, p.mjesec, p.postotak, '');
  });
  Logger.log('Gorivo — uneseno ' + podaci.length + ' početnih postotaka (siječanj–rujan 2026.).');
}

// ============================================================
// GORIVO — DNEVNE CIJENE (Eurodizel/Eurosuper95/Brent/WTI), automatski
// dohvat (Sašin izričit zahtjev, 25.9.2026.: "rekli smo cijene goriva da se
// skidaju sa web stranice HAK... gdje se obnavlja redovito na dnevnoj
// bazi... i da ćemo negdje na kartici gorivo imati skrivenu podkarticu ili
// button prema bazi kretanja cijena goriva u kojoj će se voditi dnevna
// vrijednost sve 4"). Izvori:
//   - Eurodizel/Eurosuper95: https://www.hak.hr/info/cijene-goriva/ — HAK
//     objavljuje tablicu SVIH ponuđača (INA, Petrol, Lukoil, Tifon...) sa
//     stupcem "Medijan" po proizvodu. Kako ne postoji JEDNA nacionalna
//     cijena, uzima se NAJČEŠĆA (mod) vrijednost stupca Medijan unutar
//     tablice tog goriva — u praksi se većina ponuđača drži iste
//     regulirane/uobičajene cijene, pa mod dobro predstavlja "trenutnu
//     cijenu na pumpi".
//   - Brent/WTI: Yahoo Finance (neslužben, ali javan i besplatan "chart"
//     API, bez API ključa) — GLAVNI izvor, simboli 'BZ=F' (Brent future),
//     'CL=F' (WTI future), vidi gorivoDohvatiYahooCijenu_ niže. NADOGRAĐENO
//     (26.9.2026., Sašin izričit zahtjev — "nisu baš ažurni, probaj naći
//     bolji izvor, bitno mi je da ovo bude točno"): ranije korišten FRED
//     (Federal Reserve Economic Data, fredgraph.csv, serije DCOILBRENTEU/
//     DCOILWTICO) svoje "dnevne" serije u praksi ažurira samo tjedno, pa je
//     kasnio i do tjedan dana za stvarnim tržištem. Yahoo vraća cijenu
//     zadnje trgovine (uživo dok tržište radi, zadnji zaključni tečaj kad
//     je zatvoreno) — provjereno unakrsno s tradingeconomics.com, poklapa
//     se. FRED OSTAJE kao automatski odstupni (fallback) izvor ako Yahoo
//     ikad zakaže (neslužben API, bez formalne garancije da se neće
//     promijeniti) — vidi gorivoDnevniDohvatCijena_ niže.
// Jedan redak dnevno u InTime_Gorivo_Cijene. Ako jedan izvor zakaže, ostali
// se svejedno spremaju (djelomičan uspjeh), a greška se upisuje u stupac
// "Napomena" tog retka i šalje na NOTIFY_EMAIL — isti obrazac "ne guši
// grešku" kao adminRestartPonudu (vidi zipUpozorenje_).
// ============================================================
var GORIVO_CIJENE_SHEET_NAME = 'InTime_Gorivo_Cijene';
var HAK_CIJENE_URL_ = 'https://www.hak.hr/info/cijene-goriva/';

function getOrCreateGorivoCijeneSheet_() {
  var files = DriveApp.getFilesByName(GORIVO_CIJENE_SHEET_NAME);
  var ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(GORIVO_CIJENE_SHEET_NAME);
    var sheet = ss.getSheets()[0];
    var header = ['Datum', 'Eurodizel', 'Eurosuper95', 'Brent', 'WTI', 'Napomena'];
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return ss.getSheets()[0];
}

// Izvlači sirovi HTML sadržaj JEDNOG <div id="div_XXX"> bloka na HAK
// stranici (sve do sljedećeg "<div id=\"div_" ili kraja dokumenta) — bez
// vanjskih knjižnica (Apps Script nema DOM parser), čistim regexom.
function gorivoIzvuciDivSadrzaj_(html, divId) {
  var re = new RegExp('<div id="' + divId + '">([\\s\\S]*?)(?=<div id="div_|$)', 'i');
  var m = html.match(re);
  return m ? m[1] : '';
}

// Iz jednog HAK div-bloka (tablica: Obveznik/Gorivo/Minimalna/Maksimalna/
// Medijan) izvlači SVE vrijednosti iz zadnjeg stupca (Medijan) kao brojeve
// — jedan po retku tablice (jedan po proizvodu/ponuđaču). Preskače red
// zaglavlja (ima <th>, ne <td>).
function gorivoIzvuciMedijaneIzDiv_(divHtml) {
  var medijani = [];
  var trRe = /<tr>([\s\S]*?)<\/tr>/gi;
  var trMatch;
  while ((trMatch = trRe.exec(divHtml)) !== null) {
    var trSadrzaj = trMatch[1];
    if (trSadrzaj.indexOf('<th') !== -1) { continue; }
    var tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    var tdovi = [];
    var tdMatch;
    while ((tdMatch = tdRe.exec(trSadrzaj)) !== null) { tdovi.push(tdMatch[1]); }
    if (tdovi.length < 5) { continue; }
    var medijanSirovo = String(tdovi[4]).replace(/<[^>]*>/g, '').replace(/&#160;/g, ' ').trim();
    var broj = parseFloat(medijanSirovo.replace(/[^0-9,.]/g, '').replace(',', '.'));
    if (!isNaN(broj)) { medijani.push(broj); }
  }
  return medijani;
}

// Najčešća (mod) vrijednost u nizu brojeva — vidi napomenu uz metodologiju
// iznad. Kod izjednačenja vraća prvu koja je dosegla najveću učestalost.
function gorivoNajcescaVrijednost_(brojevi) {
  if (!brojevi || !brojevi.length) { return null; }
  var brojac = {};
  var najcesca = brojevi[0], najvecaFrek = 0;
  brojevi.forEach(function(b) {
    var kljuc = b.toFixed(3);
    brojac[kljuc] = (brojac[kljuc] || 0) + 1;
    if (brojac[kljuc] > najvecaFrek) { najvecaFrek = brojac[kljuc]; najcesca = b; }
  });
  return najcesca;
}

function gorivoDohvatiHakCijene_() {
  var resp = UrlFetchApp.fetch(HAK_CIJENE_URL_, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) { throw new Error('HAK stranica vratila HTTP ' + resp.getResponseCode()); }
  var html = resp.getContentText();
  var eurosuper95 = gorivoNajcescaVrijednost_(gorivoIzvuciMedijaneIzDiv_(gorivoIzvuciDivSadrzaj_(html, 'div_eurosuper95')));
  var eurodizel = gorivoNajcescaVrijednost_(gorivoIzvuciMedijaneIzDiv_(gorivoIzvuciDivSadrzaj_(html, 'div_eurodizel')));
  if (eurosuper95 == null || eurodizel == null) {
    throw new Error('Nije uspjelo očitati cijene s HAK stranice (promijenjena struktura stranice?).');
  }
  return { eurodizel: eurodizel, eurosuper95: eurosuper95 };
}

// Zadnja BROJČANA vrijednost FRED serije (fredgraph.csv, javno, bez API
// ključa) — FRED prazne dane bilježi kao '.', pa se ide odozdo prema gore
// dok se ne nađe pravi broj.
// Cijena s Yahoo Finance (neslužben, ali javan i besplatan "chart" API, bez
// API ključa) — GLAVNI izvor za Brent/WTI od 26.9.2026. (vidi napomenu o
// metodologiji iznad). 'meta.regularMarketPrice' je cijena zadnje trgovine
// (uživo dok tržište radi, odnosno zadnji zaključni tečaj kad je
// zatvoreno); ako to polje ikad izostane, odstupno se uzima zadnji NE-null
// 'close' iz dnevnog niza (raspon 5 dana, dovoljno da uvijek ima bar jedan
// trgovinski dan). Simboli: 'BZ=F' (Brent future), 'CL=F' (WTI future).
// NAPOMENA — ovo je NESLUŽBENI/nedokumentirani Yahoo API (bez formalne
// garancije da se format neće promijeniti), zato gorivoDnevniDohvatCijena_
// niže ima FRED (gorivoDohvatiFredCijenu_) kao automatski odstupni izvor
// ako ovaj poziv zakaže.
function gorivoDohvatiYahooCijenu_(symbol) {
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=5d';
  var resp = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' }
  });
  if (resp.getResponseCode() !== 200) { throw new Error('Yahoo Finance (' + symbol + ') vratio HTTP ' + resp.getResponseCode()); }
  var podaci;
  try { podaci = JSON.parse(resp.getContentText()); } catch (errParse) { throw new Error('Yahoo Finance (' + symbol + ') vratio odgovor koji nije ispravan JSON.'); }
  var rezultat = podaci && podaci.chart && podaci.chart.result && podaci.chart.result[0];
  if (!rezultat) { throw new Error('Yahoo Finance (' + symbol + ') nije vratio očekivane podatke (možda je promijenio format).'); }
  var cijena = rezultat.meta && rezultat.meta.regularMarketPrice;
  if (typeof cijena === 'number' && !isNaN(cijena)) { return cijena; }
  var zatvaranja = rezultat.indicators && rezultat.indicators.quote && rezultat.indicators.quote[0] && rezultat.indicators.quote[0].close;
  if (Array.isArray(zatvaranja)) {
    for (var i = zatvaranja.length - 1; i >= 0; i--) {
      if (typeof zatvaranja[i] === 'number' && !isNaN(zatvaranja[i])) { return zatvaranja[i]; }
    }
  }
  throw new Error('Yahoo Finance (' + symbol + ') nije vratio niti jednu brojčanu cijenu.');
}

function gorivoDohvatiFredCijenu_(seriesId) {
  var url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + seriesId;
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) { throw new Error('FRED (' + seriesId + ') vratio HTTP ' + resp.getResponseCode()); }
  var linije = resp.getContentText().split('\n');
  for (var i = linije.length - 1; i >= 1; i--) {
    var dijelovi = linije[i].split(',');
    if (dijelovi.length < 2) { continue; }
    var vrijednost = parseFloat(dijelovi[1]);
    if (!isNaN(vrijednost)) { return vrijednost; }
  }
  throw new Error('FRED (' + seriesId + ') nije vratio niti jednu brojčanu vrijednost.');
}

// Dnevni dohvat — poziva ga vremenski triger (vidi
// postaviTrigerZaGorivoCijene niže). Upsert po datumu (jedan redak dnevno —
// ponovno pokretanje istog dana prepisuje isti redak, ne duplicira).
// NAMJERNO djelomično otporan na greške — ako npr. HAK promijeni izgled
// stranice, Brent/WTI se svejedno spremaju (i obrnuto), a greška ide u
// stupac Napomena + mail na NOTIFY_EMAIL, da se primijeti brzo.
function gorivoDnevniDohvatCijena_() {
  var danasKljuc = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Zagreb', 'yyyy-MM-dd');
  var greske = [];
  var eurodizel = null, eurosuper95 = null, brent = null, wti = null;
  try {
    var hak = gorivoDohvatiHakCijene_();
    eurodizel = hak.eurodizel; eurosuper95 = hak.eurosuper95;
  } catch (errHak) { greske.push('HAK: ' + errHak.message); }
  // NADOGRAĐENO (26.9.2026.) — Yahoo Finance je sad GLAVNI izvor (točniji,
  // vidi napomenu o metodologiji na vrhu ove cjeline), FRED je automatski
  // odstupni (fallback) izvor SAMO ako Yahoo zakaže (npr. neslužbeni API
  // promijenio format) — bolje kasniji podatak nego nikakav.
  try {
    brent = gorivoDohvatiYahooCijenu_('BZ=F');
  } catch (errBrentYahoo) {
    try {
      brent = gorivoDohvatiFredCijenu_('DCOILBRENTEU');
      greske.push('Brent: Yahoo Finance nije uspio (' + errBrentYahoo.message + ') — korišten odstupni izvor FRED (može kasniti).');
    } catch (errBrentFred) {
      greske.push('Brent (Yahoo): ' + errBrentYahoo.message + ' | Brent (FRED): ' + errBrentFred.message);
    }
  }
  try {
    wti = gorivoDohvatiYahooCijenu_('CL=F');
  } catch (errWtiYahoo) {
    try {
      wti = gorivoDohvatiFredCijenu_('DCOILWTICO');
      greske.push('WTI: Yahoo Finance nije uspio (' + errWtiYahoo.message + ') — korišten odstupni izvor FRED (može kasniti).');
    } catch (errWtiFred) {
      greske.push('WTI (Yahoo): ' + errWtiYahoo.message + ' | WTI (FRED): ' + errWtiFred.message);
    }
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getOrCreateGorivoCijeneSheet_();
    var lastRow = sheet.getLastRow();
    var foundRow = -1;
    if (lastRow >= 2) {
      var datumi = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < datumi.length; i++) {
        var d = datumi[i][0];
        var dKljuc = (d instanceof Date) ? Utilities.formatDate(d, Session.getScriptTimeZone() || 'Europe/Zagreb', 'yyyy-MM-dd') : String(d);
        if (dKljuc === danasKljuc) { foundRow = i + 2; break; }
      }
    }
    var redak = [new Date(), eurodizel, eurosuper95, brent, wti, greske.length ? greske.join(' | ') : ''];
    if (foundRow > -1) {
      sheet.getRange(foundRow, 1, 1, redak.length).setValues([redak]);
    } else {
      sheet.appendRow(redak);
    }
  } finally {
    lock.releaseLock();
  }

  if (greske.length) {
    try {
      posaljiMail_(NOTIFY_EMAIL, 'Gorivo — dnevni dohvat cijena: djelomična greška', greske.join('\n'));
    } catch (errMail) { /* obavijest o grešci nije kritična — glavni upis (što je uspjelo) je već spremljen */ }
  }
}

// Admin prikaz — cijela povijest dnevnih zapisa, najnoviji prvi.
function gorivoDohvatiCijene(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var sheet = getOrCreateGorivoCijeneSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'ok', redovi: [] }; }
  var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var tz = Session.getScriptTimeZone() || 'Europe/Zagreb';
  var redovi = data.map(function(r) {
    return {
      datum: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'dd.MM.yyyy') : String(r[0]),
      eurodizel: r[1] === '' ? null : r[1],
      eurosuper95: r[2] === '' ? null : r[2],
      brent: r[3] === '' ? null : r[3],
      wti: r[4] === '' ? null : r[4],
      napomena: r[5] || ''
    };
  }).reverse();
  return { status: 'ok', redovi: redovi };
}

// Admin gumb "Dohvati cijene sada (test)" — poziva dnevni dohvat odmah, bez
// čekanja na triger, da Saša može provjeriti da HAK/FRED dohvat radi.
function gorivoPokreniDohvatCijenaSada(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  try {
    gorivoDnevniDohvatCijena_();
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: 'Dohvat nije uspio: ' + err.message };
  }
}

// ---- JEDNOKRATNO POKRETANJE (ručno, jednom u editoru) — postavlja dnevni
// triger koji poziva gorivoDnevniDohvatCijena_() svaki dan (automatski
// dohvat Eurodizel/Eurosuper95/Brent/WTI). Isti obrazac kao
// postaviTrigerZaGorivoPodsjetnik iznad. Sigurno je pokrenuti više puta —
// prvo briše stari triger za istu funkciju ako postoji. ----
function postaviTrigerZaGorivoCijene() {
  var postojeci = ScriptApp.getProjectTriggers();
  for (var i = 0; i < postojeci.length; i++) {
    if (postojeci[i].getHandlerFunction() === 'gorivoDnevniDohvatCijena_') {
      ScriptApp.deleteTrigger(postojeci[i]);
    }
  }
  ScriptApp.newTrigger('gorivoDnevniDohvatCijena_')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .nearMinute(0)
    .create();
  Logger.log('Triger postavljen — gorivoDnevniDohvatCijena_() pokretat će se svaki dan oko 7:00.');
}

// ============================================================
// GORIVO — Događaji (crvene zastavice na grafu, npr. "Brent na vrhuncu
// krize") + JAVNI (bez tokena) kombinirani endpoint za naslovnicu — Faza 2,
// Sašin zahtjev 25.9.2026.: "napravi sad fazu 2 sve do spajanja
// kalkulatora... počni programirati". Jedan redak po događaju: Datum, Naziv.
// ============================================================

var GORIVO_DOGADJAJI_SHEET_NAME = 'InTime_Gorivo_Dogadjaji';
// "Vidljivo" stupac dodan 25.9.2026. (Sašin izričit zahtjev: mogućnost da se
// pojedini događaji sakriju s grafa — i u adminu i na naslovnici, odmah —
// bez da se stvarno obrišu, da ih se kasnije može opet otkriti). Self-healing
// (uskladiZaglavljeUpitiSheeta_) dodaje ovaj stupac i postojećem, već
// stvorenom Sheetu — stari zapisi imaju prazno polje, što se tumači kao
// VIDLJIVO (zadano), dok se eksplicitno ne sakriju.
var GORIVO_DOGADJAJI_HEADER = ['Datum', 'Naziv', 'Vidljivo'];

function getOrCreateGorivoDogadjajiSheet_() {
  var files = DriveApp.getFilesByName(GORIVO_DOGADJAJI_SHEET_NAME);
  var ss;
  var noviJe = false;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(GORIVO_DOGADJAJI_SHEET_NAME);
    noviJe = true;
  }
  var sheet = ss.getSheets()[0];
  if (noviJe) {
    sheet.appendRow(GORIVO_DOGADJAJI_HEADER);
    sheet.getRange(1, 1, 1, GORIVO_DOGADJAJI_HEADER.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    uskladiZaglavljeUpitiSheeta_(sheet, GORIVO_DOGADJAJI_HEADER);
  }
  return sheet;
}

// vidljivo: 'Da'/prazno (stari zapisi) = vidljivo; SAMO eksplicitno 'Ne' skriva.
function gorivoUcitajDogadjaje_() {
  var sheet = getOrCreateGorivoDogadjajiSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return []; }
  var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var tz = Session.getScriptTimeZone() || 'Europe/Zagreb';
  var rezultat = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (!row[0] && !row[1]) { continue; }
    rezultat.push({
      rowIndex: i + 2,
      datum: row[0] instanceof Date ? Utilities.formatDate(row[0], tz, 'yyyy-MM-dd') : String(row[0]).slice(0, 10),
      naziv: row[1] ? String(row[1]) : '',
      vidljivo: String(row[2] || '').trim() !== 'Ne'
    });
  }
  rezultat.sort(function(a, b) { return a.datum < b.datum ? -1 : (a.datum > b.datum ? 1 : 0); });
  return rezultat;
}

// SAMO vidljivi događaji — koristi ih javni gorivoJavniPodaci() (naslovnica)
// i admin-ov VLASTITI graf (gorivoDohvatiPodatkeZaGraf_ u InTime_Admin.html
// filtrira po istom 'vidljivo' polju koje ovo vraća), tako da sakrivanje
// djeluje ISTOVREMENO na oba mjesta ("kako u adminu tako i na glavnoj
// stranici odmah"). Admin-ova LISTA događaja (za uređivanje/CRUD) i dalje
// koristi gorivoDohvatiDogadjaje() (SVE, uklj. skrivene, sa značkom).
function gorivoUcitajDogadjajeVidljive_() {
  return gorivoUcitajDogadjaje_().filter(function(d) { return d.vidljivo; });
}

function gorivoDohvatiDogadjaje(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  return { status: 'ok', redovi: gorivoUcitajDogadjaje_() };
}

// Sakrij/otkrij OZNAČENE događaje (checkbox + traka masovnih akcija u
// InTime_Admin.html, isti obrazac kao adminSetUpitiSkriveno/
// adminSetAnketaSkriveno gore) — redak ostaje (i dalje se može ponovno
// otkriti), samo se postavlja zastavica.
function gorivoPostaviVidljivostDogadjaja(token, rowIndexes, vidljivo) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndexes = rowIndexes || [];
  var sheet = getOrCreateGorivoDogadjajiSheet_();
  var lastRow = sheet.getLastRow();
  var vrijednost = vidljivo ? 'Da' : 'Ne';
  var primijenjeno = 0;
  rowIndexes.forEach(function(rIdx) {
    var rowIndex = parseInt(rIdx, 10);
    if (!rowIndex || rowIndex < 2 || rowIndex > lastRow) { return; }
    sheet.getRange(rowIndex, 3).setValue(vrijednost);
    primijenjeno++;
  });
  return { status: 'ok', primijenjeno: primijenjeno };
}

// "Sakrij sve" (jedan gumb, 25.9.2026., Sašin izričit zahtjev) — postavlja
// SVE događaje na skriveno u JEDNOM Drive pozivu (brže i pouzdanije od
// slanja svih rowIndex-a s klijenta kroz gorivoPostaviVidljivostDogadjaja).
function gorivoSakrijSveDogadjaje(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var sheet = getOrCreateGorivoDogadjajiSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'ok', primijenjeno: 0 }; }
  var brojRedaka = lastRow - 1;
  var stupacC = [];
  for (var i = 0; i < brojRedaka; i++) { stupacC.push(['Ne']); }
  sheet.getRange(2, 3, brojRedaka, 1).setValues(stupacC);
  return { status: 'ok', primijenjeno: brojRedaka };
}

// "Učitaj početne događaje" — jednokratni gumb u adminu (Sašin izričit
// zahtjev, 25.9.2026.: "ubaci događaje koje smo jučer spominjali... sve ih
// stavi") — ubacuje unaprijed pripremljen popis od 11 stvarnih događaja iz
// krize s cijenama goriva 2026. (izvorno istražen i naveden u starom demo
// predlošku InTime_Gorivo_Graf.html, prije nego je admin CRUD za događaje
// uopće izgrađen). IDEMPOTENTNO — provjerava postojeći (datum, naziv) par
// prije umetanja, pa je sigurno kliknuti više puta (npr. slučajno dvaput),
// nikad ne stvara duplikate. Novi zapisi ulaze kao VIDLJIVI (Da).
function gorivoUcitajZadaneDogadjaje(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var ZADANI_DOGADJAJI_ = [
    { datum: '2026-01-23', naziv: 'Trump najavljuje vojnu "armadu" prema Bliskom istoku — početak eskalacije' },
    { datum: '2026-02-03', naziv: 'IRGC pokušava zaplijeniti američki tanker u Hormuzu; SAD obara iranski dron' },
    { datum: '2026-02-05', naziv: 'Iran zaplijenio dva strana tankera s naftom kod otoka Farsi' },
    { datum: '2026-02-17', naziv: 'Hormuški tjesnac zatvoren zbog vojne vježbe' },
    { datum: '2026-02-28', naziv: 'SAD i Izrael napali Iran — prvi izvještaji o pogibiji Khameneija' },
    { datum: '2026-03-01', naziv: 'Iran uzvraća raketama/dronovima na Izrael, UAE, Katar i dr. — otvoreni rat' },
    { datum: '2026-03-09', naziv: 'Vlada RH uvodi tjedno reguliranje max. cijena goriva (rat SAD/Izrael–Iran)' },
    { datum: '2026-03-18', naziv: 'Napad na katarski LNG kompleks Ras Laffan (−17% proizvodnje)' },
    { datum: '2026-03-31', naziv: 'Brent na vrhuncu krize — 118,35 $/barel' },
    { datum: '2026-07-01', naziv: 'Deeskalacija — Brent pada na 71,57 $/barel' },
    { datum: '2026-09-21', naziv: 'Novi skok cijena — Vlada intervenirala trošarinama' }
  ];
  var sheet = getOrCreateGorivoDogadjajiSheet_();
  var postojeci = gorivoUcitajDogadjaje_();
  var postojeciKljucevi = {};
  postojeci.forEach(function(d) { postojeciKljucevi[d.datum + '|' + d.naziv] = true; });
  var dodano = 0, preskoceno = 0;
  ZADANI_DOGADJAJI_.forEach(function(d) {
    var kljuc = d.datum + '|' + d.naziv;
    if (postojeciKljucevi[kljuc]) { preskoceno++; return; }
    sheet.appendRow([d.datum, d.naziv, 'Da']);
    dodano++;
  });
  return { status: 'ok', dodano: dodano, preskoceno: preskoceno };
}

// Datum se šalje kao 'yyyy-MM-dd' (iz <input type="date"> u adminu).
function gorivoSpremiDogadjaj(token, datum, naziv) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  datum = String(datum || '').trim();
  naziv = String(naziv || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) { return { status: 'error', message: 'Neispravan datum.' }; }
  if (!naziv) { return { status: 'error', message: 'Naziv događaja je obavezan.' }; }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getOrCreateGorivoDogadjajiSheet_();
    sheet.appendRow([datum, naziv]);
  } finally {
    lock.releaseLock();
  }
  return { status: 'ok' };
}

function gorivoObrisiDogadjaj(token, rowIndex) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  rowIndex = parseInt(rowIndex, 10);
  if (!rowIndex || rowIndex < 2) { return { status: 'error', message: 'Neispravan redak.' }; }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getOrCreateGorivoDogadjajiSheet_();
    if (rowIndex <= sheet.getLastRow()) { sheet.deleteRow(rowIndex); }
  } finally {
    lock.releaseLock();
  }
  return { status: 'ok' };
}

// Ista lista podataka kao gorivoDohvatiCijene(token) (admin), ali BEZ
// provjere tokena i bez 'napomena' polja (interna napomena o grešci dohvata
// nije za javni prikaz) — koristi je gorivoJavniPodaci() niže.
function gorivoJavneCijene_() {
  var sheet = getOrCreateGorivoCijeneSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return []; }
  var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var tz = Session.getScriptTimeZone() || 'Europe/Zagreb';
  return data.map(function(r) {
    return {
      datum: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'dd.MM.yyyy') : String(r[0]),
      eurodizel: r[1] === '' ? null : r[1],
      eurosuper95: r[2] === '' ? null : r[2],
      brent: r[3] === '' ? null : r[3],
      wti: r[4] === '' ? null : r[4]
    };
  });
}

// ---- Test-pregled dodatka na gorivo za kalkulator cijena (25.9.2026.,
// Sašin izričit zahtjev: "napravi tipku za testiranje...ako ukucam nešto da
// vidim hoće li se to promijeniti na glavnom kalkulatoru...testiranje se
// automatski gasi ako ga ja ne ugasim u roku 5 minuta"). Sprema se u Script
// Properties (kratkog vijeka, ne treba poseban stupac/list) — kalkulator ga
// preuzima preko gorivoJavniPodaci() (javna ruta, bez tokena) kao
// 'testPregled', i dok je aktivan prikazuje TAJ postotak umjesto stvarnog.
var GORIVO_TEST_POSTOTAK_KEY_ = 'GORIVO_TEST_POSTOTAK';
var GORIVO_TEST_ISTICE_KEY_ = 'GORIVO_TEST_ISTICE';
var GORIVO_TEST_TRAJANJE_MS_ = 5 * 60 * 1000;

function gorivoPostaviTestPregled(token, postotak) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var p = parseFloat(String(postotak).replace(',', '.'));
  if (isNaN(p) || p < 0 || p > 100) { return { status: 'error', message: 'Neispravan postotak (mora biti broj 0–100).' }; }
  var props = PropertiesService.getScriptProperties();
  var istice = Date.now() + GORIVO_TEST_TRAJANJE_MS_;
  props.setProperty(GORIVO_TEST_POSTOTAK_KEY_, String(p));
  props.setProperty(GORIVO_TEST_ISTICE_KEY_, String(istice));
  return { status: 'ok', istice: istice };
}

function gorivoUgasiTestPregled(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(GORIVO_TEST_POSTOTAK_KEY_);
  props.deleteProperty(GORIVO_TEST_ISTICE_KEY_);
  return { status: 'ok' };
}

// Interno — vraća {postotak, istice} ako je test-pregled aktivan i još nije
// istekao, inače null (i uzgredno pospremi Script Properties ako je već
// istekao, da se ne provjerava iznova svaki put).
function gorivoDohvatiAktivniTestPregled_() {
  var props = PropertiesService.getScriptProperties();
  var isticeStr = props.getProperty(GORIVO_TEST_ISTICE_KEY_);
  var istice = isticeStr ? parseInt(isticeStr, 10) : 0;
  if (!istice || Date.now() > istice) {
    if (isticeStr !== null) {
      props.deleteProperty(GORIVO_TEST_POSTOTAK_KEY_);
      props.deleteProperty(GORIVO_TEST_ISTICE_KEY_);
    }
    return null;
  }
  var postotak = parseFloat(props.getProperty(GORIVO_TEST_POSTOTAK_KEY_));
  if (isNaN(postotak)) { return null; }
  return { postotak: postotak, istice: istice };
}

// Javni (bez tokena) kombinirani endpoint za naslovnicu i kalkulator
// (InTime_KalkulatorCijena.html, dodatak na gorivo + read-only graf ispod
// kalkulatora) — vraća sve što treba (postotci, događaji, cijene, aktivni
// test-pregled) BEZ prijave u admin. Namjerno ne sadrži ništa osjetljivo
// (nema podataka o klijentima/ponudama) — sve su javno objavljeni podaci o
// cijeni goriva i In Time postotku.

// ============================================================
// BRZI MODUL (4.10.2026., Sašin zahtjev) — InTime_Brzi.html
//
// Brzi pristup s mobitela, prijava PIN-om (zadano 6205 — mijenja se u
// samom brzom modulu I u glavnom adminu, kartica "Promijeni PIN"). Nije
// zamjena za admin: samo pregled stanja, ručni unos klijenta (upitnik
// otvoren s tokenom, vidi saveUpit — brzi_token), unos u telefonski imenik
// (automatski i u Google Contacts), pretraga te bilješke s podsjetnicima.
//
// SIGURNOST: PIN se sprema SAMO kao salted SHA-256 (BRZI_PIN_HASH/SALT, Script
// Properties); dok ga nitko ne promijeni, vrijedi zadani. Nakon 5 uzastopnih
// pogrešnih unosa prijava je zaključana 15 minuta (računa se na razini cijele
// aplikacije, ne po uređaju). Sesija (token) vrijedi 30 dana. Preporuka:
// promijeniti zadani PIN čim se modul pusti u rad.
// ============================================================
var BRZI_PIN_ZADANI_ = '6205';
var BRZI_SESSION_DURATION_MS_ = 30 * 24 * 60 * 60 * 1000;
var BRZI_MAX_POGRESAKA_ = 5;
var BRZI_ZAKLJUCAVANJE_MS_ = 15 * 60 * 1000;
var BRZI_BILJESKE_SHEET_NAME = 'InTime_Brzi_Biljeske';
var BRZI_BILJESKE_HEADER = ['ID', 'Datum unosa', 'Tip', 'Referenca (redak upita / naziv)', 'Naziv', 'Bilješka', 'Podsjetnik (yyyy-MM-dd)', 'Riješeno', 'Datum rješavanja', 'Vrijeme podsjetnika (HH:mm)', 'Primatelji maila', 'Mail poslan', 'Telefon', 'Kalendar događaj ID', 'Boja (1-11)'];

function brziPinTocan_(pin) {
  var props = PropertiesService.getScriptProperties();
  var hash = props.getProperty('BRZI_PIN_HASH');
  var salt = props.getProperty('BRZI_PIN_SALT');
  var p = String(pin == null ? '' : pin).trim();
  if (!hash || !salt) { return p === BRZI_PIN_ZADANI_; }
  return sha256Hex_(salt + p) === hash;
}

function brziPinJeZadani_() {
  return !PropertiesService.getScriptProperties().getProperty('BRZI_PIN_HASH');
}

function getBrziSessions_() {
  var raw = PropertiesService.getScriptProperties().getProperty('BRZI_SESSIONS');
  return raw ? JSON.parse(raw) : {};
}

function isValidBrziToken_(token) {
  if (!token) { return false; }
  if (isValidAdminToken_(token)) { return true; }   // admin sesija vrijedi i za brzi modul
  var sessions = getBrziSessions_();
  var now = Date.now();
  var changed = false;
  Object.keys(sessions).forEach(function(t) { if (sessions[t] < now) { delete sessions[t]; changed = true; } });
  var ok = Object.prototype.hasOwnProperty.call(sessions, String(token));
  if (changed) { PropertiesService.getScriptProperties().setProperty('BRZI_SESSIONS', JSON.stringify(sessions)); }
  return ok;
}

function brziLogin(pin) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var st = JSON.parse(props.getProperty('BRZI_POGRESKE') || '{"n":0,"do":0}');
    if (st.do && Date.now() < st.do) {
      var min = Math.ceil((st.do - Date.now()) / 60000);
      return { status: 'error', message: 'Previše pogrešnih unosa. Pokušaj ponovno za ' + min + ' min.' };
    }
    if (!brziPinTocan_(pin)) {
      st.n = (st.n || 0) + 1;
      if (st.n >= BRZI_MAX_POGRESAKA_) { st = { n: 0, do: Date.now() + BRZI_ZAKLJUCAVANJE_MS_ }; props.setProperty('BRZI_POGRESKE', JSON.stringify(st)); return { status: 'error', message: 'Previše pogrešnih unosa. Prijava je zaključana 15 minuta.' }; }
      props.setProperty('BRZI_POGRESKE', JSON.stringify(st));
      return { status: 'error', message: 'Pogrešan PIN. Preostalo pokušaja: ' + (BRZI_MAX_POGRESAKA_ - st.n) + '.' };
    }
    props.setProperty('BRZI_POGRESKE', JSON.stringify({ n: 0, do: 0 }));
    var token = Utilities.getUuid() + Utilities.getUuid();
    var sessions = getBrziSessions_();
    var now = Date.now();
    Object.keys(sessions).forEach(function(t) { if (sessions[t] < now) { delete sessions[t]; } });
    sessions[token] = now + BRZI_SESSION_DURATION_MS_;
    props.setProperty('BRZI_SESSIONS', JSON.stringify(sessions));
    return { status: 'ok', token: token, pinZadani: brziPinJeZadani_() };
  } finally {
    lock.releaseLock();
  }
}

function brziPostaviPin_(noviPin) {
  var p = String(noviPin == null ? '' : noviPin).trim();
  if (!/^\d{4,8}$/.test(p)) { return { status: 'error', message: 'PIN mora imati 4 do 8 znamenki.' }; }
  var props = PropertiesService.getScriptProperties();
  var salt = Utilities.getUuid();
  props.setProperty('BRZI_PIN_SALT', salt);
  props.setProperty('BRZI_PIN_HASH', sha256Hex_(salt + p));
  return { status: 'ok' };
}

// Promjena PIN-a iz samog brzog modula — traži važeći brzi token I stari PIN.
function brziPromijeniPin(token, stariPin, noviPin) {
  if (!isValidBrziToken_(token)) { return { status: 'error', code: 'auth', message: 'Sesija je istekla — prijavi se ponovno.' }; }
  if (!brziPinTocan_(stariPin)) { return { status: 'error', message: 'Stari PIN nije točan.' }; }
  return brziPostaviPin_(noviPin);
}

// Promjena PIN-a iz glavnog admina — dovoljna je admin sesija (bez starog PIN-a).
function adminBrziPromijeniPin(token, noviPin) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var r = brziPostaviPin_(noviPin);
  if (r.status === 'ok') {
    // Nakon promjene PIN-a iz admina odjavljuju se sve postojeće brze sesije.
    PropertiesService.getScriptProperties().setProperty('BRZI_SESSIONS', '{}');
  }
  return r;
}

function brziAuthGreska_() { return { status: 'error', code: 'auth', message: 'Sesija je istekla — prijavi se ponovno.' }; }

function brziNormaliziraj_(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/č|ć/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z').replace(/đ/g, 'd')
    .replace(/\s+/g, ' ').trim();
}

// Čita sve retke InTime_Upiti kao pomoćne objekte (samo polja potrebna brzom modulu).
function brziCitajUpite_() {
  var sheet = getOrCreateUpitiSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return []; }
  var ocekivano = izracunajOcekivanoZaglavljeUpiti_();
  var lastCol = Math.min(sheet.getLastColumn(), ocekivano.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var tz = Session.getScriptTimeZone();
  function idx(l) { return header.indexOf(l); }
  var I = {
    naziv: idx('Naziv tvrtke'), oib: idx('OIB'), grad: idx('Mjesto'), kontakt: idx('Kontakt osoba'),
    mobitel: idx('Mobitel'), email: idx('Email kontakt osobe'), odgovorna: idx('Ime i prezime'),
    odgTel: idx('Telefon odgovorne osobe'), telCentrale: idx('Telefon centrale'),
    otvoren: idx('Datum otvaranja klijenta u sustavu (admin)'),
    ponude: idx('Datum prebacivanja u ponude (admin)'), arhiva: idx('Datum prebacivanja u arhivu (admin)'),
    napomena: idx('Interna napomena (admin)'), arhKat: idx('Kategorija arhiviranja (admin)'), odustajanje: idx('Datum odustajanja od klijenta - mi (admin)')
  };
  var out = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (r[1] !== 'Interes') { continue; }
    function g(k) { return I[k] === -1 ? '' : r[I[k]]; }
    var ts = r[0];
    var fazaKljuc, faza;
    if (g('arhiva')) { fazaKljuc = 'arhiva'; faza = 'Arhiva'; }
    else if (g('otvoren')) { fazaKljuc = 'klijent'; faza = 'Klijent'; }
    else if (g('ponude')) {
      fazaKljuc = 'ponuda';
      var sp = izracunajStatusPonude_(header, r);
      var opisi = { nije_poslano: 'Ponuda — nije poslana', na_cekanju: 'Ponuda — čeka odgovor', istekla: 'Ponuda — istekla', potvrdjena: 'Ponuda — prihvaćena', odbijena: 'Ponuda — odbijena', ponistena: 'Ponuda — poništena', ponistena_nakon_prihvata: 'Ponuda — poništena' };
      faza = opisi[sp] || 'Ponuda';
      fazaKljuc = 'ponuda_' + sp;
    } else { fazaKljuc = 'interes'; faza = 'Zainteresirani'; }
    out.push({
      rowIndex: i + 2,
      datum: (ts instanceof Date) ? Utilities.formatDate(ts, tz, 'dd.MM.yyyy. HH:mm') : String(ts || ''),
      datumMs: (ts instanceof Date) ? ts.getTime() : 0,
      naziv: String(g('naziv') || ''), oib: String(g('oib') || ''), grad: String(g('grad') || ''),
      kontakt: String(g('kontakt') || g('odgovorna') || ''),
      telefon: String(g('mobitel') || g('odgTel') || g('telCentrale') || ''),
      email: String(g('email') || ''),
      faza: faza, fazaKljuc: fazaKljuc,
      arhivaKat: (fazaKljuc === 'arhiva') ? (String(g('arhKat') || '') || (g('odustajanje') ? 'ABANDON' : 'OSTALO')) : '',
      rucni: /ručni unos/i.test(String(g('napomena') || ''))
    });
  }
  return out;
}

function brziPregled(token) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  var upiti = brziCitajUpite_();
  var brojke = { zainteresirani: 0, ponude: 0, naCekanju: 0, istekle: 0, klijenti: 0, arhiva: 0 };
  upiti.forEach(function(u) {
    if (u.fazaKljuc === 'interes') { brojke.zainteresirani++; }
    else if (u.fazaKljuc.indexOf('ponuda_') === 0) {
      brojke.ponude++;
      if (u.fazaKljuc === 'ponuda_na_cekanju') { brojke.naCekanju++; }
      if (u.fazaKljuc === 'ponuda_istekla') { brojke.istekle++; }
    }
    else if (u.fazaKljuc === 'klijent') { brojke.klijenti++; }
    else if (u.fazaKljuc === 'arhiva') { brojke.arhiva++; }
  });
  var zadnji = upiti.slice().sort(function(a, b) { return b.datumMs - a.datumMs; }).slice(0, 5);
  var kontakata = 0;
  try { kontakata = brziImenikCitaj_().length; } catch (eIm) { kontakata = 0; }
  var biljeske = brziBiljeskeCitaj_();
  var danas = Utilities.formatDate(new Date(), BRZI_TZ_, 'yyyy-MM-dd');
  var podsjetnici = biljeske.filter(function(b) { return !b.rijeseno && b.podsjetnik; })
    .sort(function(a, b) { return a.podsjetnik < b.podsjetnik ? -1 : 1; });
  var dospjeli = podsjetnici.filter(function(b) { return b.podsjetnik <= danas; });
  try { brojke.ankete = brziAnketeCitajSve_().length; } catch (e1) { brojke.ankete = 0; }
  try { brojke.odbijenice = brziOdbijeniceCitaj_().length; } catch (e2) { brojke.odbijenice = 0; }
  return { status: 'ok', brojke: brojke, kontakata: kontakata, zadnji: zadnji, dospjeli: dospjeli, nadolazeci: podsjetnici.filter(function(b) { return b.podsjetnik > danas; }).slice(0, 5), danas: danas, pinZadani: brziPinJeZadani_() };
}

// ---- ANKETE KVALITETE i ODBIJENICE ("Nisu zainteresirani") za mobitel (4.10.2026.) — samo čitanje.
// Skriveni zapisi (Skriveno (admin) = Da) se ne prikazuju, isto kao u adminu zadano.
function brziFormatDatum_(v) {
  return (v instanceof Date) ? Utilities.formatDate(v, BRZI_TZ_, 'dd.MM.yyyy. HH:mm') : String(v || '');
}

function brziAnketeCitajSve_() {
  var sheet = getOrCreateAnketaSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return []; }
  var oc = izracunajOcekivanoZaglavljeAnkete_();
  var lastCol = Math.min(sheet.getLastColumn(), oc.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var out = [];
  for (var i = 0; i < data.length; i++) {
    var obj = {};
    for (var c = 0; c < header.length; c++) { obj[header[c]] = data[i][c]; }
    if (String(obj['Skriveno (admin)'] || '') === 'Da') { continue; }
    out.push({ rowIndex: i + 2, obj: obj });
  }
  return out;
}

function brziAnketeLista(token) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  var sve = brziAnketeCitajSve_();
  var lista = sve.map(function(r) {
    var o = r.obj, d = {};
    ANKETA_FIELDS.forEach(function(f) { if (!f.sec) { d[f[0]] = o[f[1]]; } });
    return {
      rowIndex: r.rowIndex, broj: String(o['Broj'] || ''), datum: brziFormatDatum_(o['Timestamp']), datumMs: (o['Timestamp'] instanceof Date) ? o['Timestamp'].getTime() : 0,
      naziv: String(o['Naziv poslovnog subjekta'] || ''), oib: String(o['OIB poslovnog subjekta'] || ''),
      osoba: String(o['Ime i prezime osobe koja ispunjava anketu'] || ''), telefon: String(o['Broj telefona osobe koja ispunjava anketu'] || ''),
      email: String(o['E-mail adresa osobe koja ispunjava anketu'] || ''), prosjek: izracunajProsjekOcjenaAnkete_(d)
    };
  });
  lista.sort(function(a, b) { return b.datumMs - a.datumMs; });
  var suma = 0, n = 0;
  lista.forEach(function(a) { if (a.prosjek !== null) { suma += a.prosjek; n++; } });
  return { status: 'ok', ukupno: lista.length, prosjek: n ? Math.round((suma / n) * 10) / 10 : null, ankete: lista.slice(0, 300) };
}

// Detalj jedne ankete: prosjek po kategorijama + sve ocjene, komentari i završni komentari.
function brziAnketaDetalj(token, rowIndex) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  var ri = parseInt(rowIndex, 10);
  var nadjena = brziAnketeCitajSve_().filter(function(r) { return r.rowIndex === ri; })[0];
  if (!nadjena) { return { status: 'error', message: 'Anketa nije pronađena.' }; }
  var o = nadjena.obj, d = {}, lab = {};
  ANKETA_FIELDS.forEach(function(f) { if (!f.sec) { d[f[0]] = o[f[1]]; lab[f[0]] = f[1]; } });
  function kratkaOznaka(l) { return String(l || '').replace(/\s*\((0-10[^)]*)\)\s*$/, ''); }
  var kategorije = ANKETA_KATEGORIJE.map(function(k) {
    var suma = 0, n = 0, pitanja = [];
    k.pitanja.forEach(function(q) {
      var v = d[q];
      var num = parseFloat(v);
      var ok = !isNaN(num) && String(v).trim() !== '' && String(v) !== 'Ne mogu procijeniti';
      if (ok) { suma += num; n++; }
      var kom = String(d[q + '_komentar'] || '').trim();
      if (String(v == null ? '' : v).trim() !== '' || kom) {
        pitanja.push({ pitanje: kratkaOznaka(lab[q]), ocjena: String(v == null ? '' : v), komentar: kom });
      }
    });
    return { naziv: k.naziv, prosjek: n ? Math.round((suma / n) * 10) / 10 : null, pitanja: pitanja };
  });
  return {
    status: 'ok', broj: String(o['Broj'] || ''), datum: brziFormatDatum_(o['Timestamp']),
    naziv: String(o['Naziv poslovnog subjekta'] || ''), oib: String(o['OIB poslovnog subjekta'] || ''),
    osoba: String(o['Ime i prezime osobe koja ispunjava anketu'] || ''), telefon: String(o['Broj telefona osobe koja ispunjava anketu'] || ''),
    email: String(o['E-mail adresa osobe koja ispunjava anketu'] || ''), prosjek: izracunajProsjekOcjenaAnkete_(d), kategorije: kategorije,
    prednost: String(d.anketa_prednost || ''), poboljsati: String(d.anketa_poboljsati || ''), komentar: String(d.anketa_komentar || '')
  };
}

function brziOdbijeniceCitaj_() {
  var sheet = getOrCreateUpitiSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return []; }
  var oc = izracunajOcekivanoZaglavljeUpiti_();
  var lastCol = Math.min(sheet.getLastColumn(), oc.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  function idx(l) { return header.indexOf(l); }
  var I = {
    naziv: idx('Naziv tvrtke'), oib: idx('OIB'), ime: idx('Kontakt ime (odbijenica)'), prezime: idx('Kontakt prezime (odbijenica)'),
    tel: idx('Telefon (odbijenica)'), email: idx('Email (odbijenica)'), razlog: idx('Razlog (odbijenica)'), razlogOstalo: idx('Razlog – Ostalo, tekst (odbijenica)'),
    news: idx('Newsletter pristanak (odbijenica)'), skriveno: idx('Skriveno (admin)'), napomena: idx('Interna napomena (admin)')
  };
  var out = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (r[1] !== 'Odbijenica') { continue; }
    function g(k) { return I[k] === -1 ? '' : r[I[k]]; }
    if (String(g('skriveno')) === 'Da') { continue; }
    var razlog = String(g('razlog') || '');
    var ost = String(g('razlogOstalo') || '');
    out.push({
      rowIndex: i + 2, broj: String(r[2] || ''), datum: brziFormatDatum_(r[0]), datumMs: (r[0] instanceof Date) ? r[0].getTime() : 0,
      naziv: String(g('naziv') || ''), oib: String(g('oib') || ''),
      kontakt: [g('ime'), g('prezime')].filter(function(x) { return String(x || '').trim(); }).join(' '),
      telefon: String(g('tel') || ''), email: String(g('email') || ''),
      razlog: razlog + (ost ? (razlog ? ' — ' : '') + ost : ''), newsletter: String(g('news') || ''),
      napomena: String(g('napomena') || '')
    });
  }
  out.sort(function(a, b) { return b.datumMs - a.datumMs; });
  return out;
}

function brziOdbijeniceLista(token) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  var l = brziOdbijeniceCitaj_();
  return { status: 'ok', ukupno: l.length, odbijenice: l.slice(0, 300) };
}

function brziImenikCitaj_() {
  var sheet = getOrCreateImenikSheet();
  var lastRow = sheet.getLastRow();
  var out = [];
  if (lastRow < 2) { return out; }
  var podaci = sheet.getRange(2, 1, lastRow - 1, IMENIK_HEADER.length).getValues();
  for (var i = podaci.length - 1; i >= 0; i--) {
    var r = podaci[i];
    if (r[IMENIK_COL.SKRIVENO - 1] === 'Da') { continue; }
    var dat = r[IMENIK_COL.DATUM_UNOSA - 1];
    out.push({
      rowIndex: i + 2, ime: String(r[IMENIK_COL.IME - 1] || ''), tvrtka: String(r[IMENIK_COL.PREZIME - 1] || ''),
      telefoni: String(r[IMENIK_COL.TELEFONI - 1] || ''), emailovi: String(r[IMENIK_COL.EMAILOVI - 1] || ''),
      napomena: String(r[IMENIK_COL.NAPOMENA - 1] || ''), tagovi: String(r[IMENIK_COL.TAGOVI - 1] || ''),
      datum: brziFormatDatum_(dat)
    });
  }
  return out;
}

function brziImenikLista(token) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  var l = brziImenikCitaj_();
  return { status: 'ok', ukupno: l.length, kontakti: l.slice(0, 500) };
}

// Popis SVIH klijenata/upita (najnoviji prvi, najviše 500) — "Prikaži sve" na Početnoj brzog modula.
function brziKlijentiLista(token) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  var sve = brziCitajUpite_().sort(function(a, b) { return b.datumMs - a.datumMs; });
  return { status: 'ok', ukupno: sve.length, klijenti: sve.slice(0, 500) };
}

function brziPretraga(token, q) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  var upit = brziNormaliziraj_(q);
  if (upit.length < 2) { return { status: 'ok', klijenti: [], kontakti: [] }; }
  var znamenke = upit.replace(/\D/g, '');
  var klijenti = brziCitajUpite_().filter(function(u) {
    var hay = brziNormaliziraj_([u.naziv, u.oib, u.kontakt, u.grad, u.email].join(' '));
    if (hay.indexOf(upit) !== -1) { return true; }
    return znamenke.length >= 4 && String(u.telefon).replace(/\D/g, '').indexOf(znamenke) !== -1;
  }).sort(function(a, b) { return b.datumMs - a.datumMs; }).slice(0, 20);
  var kontakti = [];
  var sheet = getOrCreateImenikSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var podaci = sheet.getRange(2, 1, lastRow - 1, IMENIK_HEADER.length).getValues();
    for (var i = podaci.length - 1; i >= 0 && kontakti.length < 20; i--) {
      var r = podaci[i];
      if (r[IMENIK_COL.SKRIVENO - 1] === 'Da') { continue; }
      var hay = brziNormaliziraj_([r[IMENIK_COL.IME - 1], r[IMENIK_COL.PREZIME - 1], r[IMENIK_COL.OIB - 1], r[IMENIK_COL.GRAD - 1], r[IMENIK_COL.EMAILOVI - 1], r[IMENIK_COL.NAPOMENA - 1]].join(' '));
      var tel = String(r[IMENIK_COL.TELEFONI - 1] || '');
      var ok = hay.indexOf(upit) !== -1 || (znamenke.length >= 4 && tel.replace(/\D/g, '').indexOf(znamenke) !== -1);
      if (ok) {
        kontakti.push({ rowIndex: i + 2, ime: r[IMENIK_COL.IME - 1], tvrtka: r[IMENIK_COL.PREZIME - 1], telefoni: tel, emailovi: String(r[IMENIK_COL.EMAILOVI - 1] || ''), napomena: String(r[IMENIK_COL.NAPOMENA - 1] || ''), tagovi: String(r[IMENIK_COL.TAGOVI - 1] || '') });
      }
    }
  }
  return { status: 'ok', klijenti: klijenti, kontakti: kontakti };
}

// Ručni unos kontakta u telefonski imenik — upisuje se u InTime_Imenik s tagom
// "Ručni unos" i ODMAH prenosi u Google Contacts (pa ga mobitel povuče ako je
// prijavljen istim Google računom). Bez obzira na postavku auto-prijenosa u adminu.
function brziImenikUnos(token, ime, tvrtka, telefon, email, napomena) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  var imeT = String(ime || '').trim();
  var telT = String(telefon || '').trim();
  if (!imeT) { return { status: 'error', message: 'Upiši ime i prezime.' }; }
  if (!telT) { return { status: 'error', message: 'Upiši broj telefona.' }; }
  var kandidat = { ime: imeT, prezime: String(tvrtka || '').trim(), oib: '', grad: '', telefon: telT, email: String(email || '').trim(), funkcija: '', napomena: String(napomena || '').trim() };
  var rowIndex = spremiKontaktUImenik_(kandidat, 'Ručni unos', '');
  if (rowIndex === -1) { return { status: 'error', message: 'Spremanje u imenik nije uspjelo.' }; }
  spremiKontaktCsv_(rowIndex);
  var g = { status: 'error', message: 'nije pokušano' };
  try { g = sinkronizirajKontaktGoogle_(rowIndex); } catch (err) { g = { status: 'error', message: String(err && err.message || err) }; }
  return { status: 'ok', rowIndex: rowIndex, googleOk: g.status === 'ok', googlePoruka: g.status === 'ok' ? '' : (g.message || '') };
}

function getOrCreateBrziBiljeskeSheet_() {
  var files = DriveApp.getFilesByName(BRZI_BILJESKE_SHEET_NAME);
  var ss = files.hasNext() ? SpreadsheetApp.open(files.next()) : SpreadsheetApp.create(BRZI_BILJESKE_SHEET_NAME);
  var sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(BRZI_BILJESKE_HEADER);
    sheet.getRange(1, 1, 1, BRZI_BILJESKE_HEADER.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else if (sheet.getLastColumn() < BRZI_BILJESKE_HEADER.length) {
    // Starija tablica (prije podsjetnika s mailom) — dopuni zaglavlje novim stupcima.
    sheet.getRange(1, 1, 1, BRZI_BILJESKE_HEADER.length).setValues([BRZI_BILJESKE_HEADER]).setFontWeight('bold');
  }
  try { sheet.getRange(2, 10, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('@'); } catch (fmtErr) {}
  return sheet;
}

function brziBiljeskeCitaj_() {
  var sheet = getOrCreateBrziBiljeskeSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return []; }
  var tz = BRZI_TZ_;
  var podaci = sheet.getRange(2, 1, lastRow - 1, BRZI_BILJESKE_HEADER.length).getValues();
  return podaci.map(function(r, i) {
    var pod = r[6];
    if (pod instanceof Date) { pod = Utilities.formatDate(pod, tz, 'yyyy-MM-dd'); }
    var dat = r[1];
    return {
      id: String(r[0]), rowIndex: i + 2,
      datum: (dat instanceof Date) ? Utilities.formatDate(dat, tz, 'dd.MM.yyyy. HH:mm') : String(dat || ''),
      tip: String(r[2] || ''), ref: String(r[3] || ''), naziv: String(r[4] || ''), tekst: String(r[5] || ''),
      podsjetnik: String(pod || ''), rijeseno: r[7] === 'Da',
      vrijeme: brziVrijemeStr_(r[9]), primatelji: String(r[10] || ''),
      mailPoslan: (r[11] instanceof Date) ? Utilities.formatDate(r[11], BRZI_TZ_, 'dd.MM.yyyy. HH:mm') : String(r[11] || ''),
      telefon: String(r[12] || ''), boja: brziBoja_(r[14])
    };
  });
}

function brziBiljeskaDodaj(token, tip, ref, naziv, tekst, podsjetnik, vrijeme, primatelji, telefon, boja) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  var t = String(tekst || '').trim();
  if (!t) { return { status: 'error', message: 'Upiši bilješku.' }; }
  var pod = String(podsjetnik || '').trim();
  if (pod && !/^\d{4}-\d{2}-\d{2}$/.test(pod)) { return { status: 'error', message: 'Neispravan datum podsjetnika.' }; }
  var vr = brziNormalizirajVrijeme_(vrijeme);
  if (vr === null) { return { status: 'error', message: 'Neispravno vrijeme podsjetnika (HH:mm).' }; }
  if (vr && !pod) { return { status: 'error', message: 'Za vrijeme podsjetnika upiši i datum.' }; }
  var prim = '';
  if (pod) {
    var pv = brziProcistiPrimatelje_(primatelji, true);
    if (!pv.ok) { return { status: 'error', message: pv.poruka }; }
    prim = pv.lista.join(', ');
  }
  var sheet = getOrCreateBrziBiljeskeSheet_();
  var id = Utilities.getUuid().slice(0, 8);
  sheet.appendRow([id, new Date(), String(tip || 'slobodno'), String(ref || ''), String(naziv || ''), t, pod, '', '', vr || '', prim, '', String(telefon || '').trim(), '', brziBoja_(boja)]);
  var trig = null, kal = null;
  if (pod) {
    try { trig = brziPodsjetniciTrigerOsiguraj_(); } catch (trErr) { trig = { status: 'error', message: String(trErr && trErr.message || trErr) }; }
    kal = brziKalendarZaRed_(sheet, sheet.getLastRow(), false);
  }
  return { status: 'ok', id: id, trigger: trig, kalendar: kal };
}

// Uređivanje podsjetnika/bilješke (iz admina ili s mobitela). Promjena datuma, vremena ili
// primatelja briše oznaku "Mail poslan" pa će mail ponovno stići u novo vrijeme.
function brziBiljeskaUredi(token, id, tekst, podsjetnik, vrijeme, primatelji, telefon, boja) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  var t = String(tekst || '').trim();
  if (!t) { return { status: 'error', message: 'Upiši bilješku.' }; }
  var pod = String(podsjetnik || '').trim();
  if (pod && !/^\d{4}-\d{2}-\d{2}$/.test(pod)) { return { status: 'error', message: 'Neispravan datum podsjetnika.' }; }
  var vr = brziNormalizirajVrijeme_(vrijeme);
  if (vr === null) { return { status: 'error', message: 'Neispravno vrijeme podsjetnika (HH:mm).' }; }
  if (vr && !pod) { return { status: 'error', message: 'Za vrijeme podsjetnika upiši i datum.' }; }
  var prim = '';
  if (pod) {
    var pv = brziProcistiPrimatelje_(primatelji, true);
    if (!pv.ok) { return { status: 'error', message: pv.poruka }; }
    prim = pv.lista.join(', ');
  }
  var sheet = getOrCreateBrziBiljeskeSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'error', message: 'Bilješka nije pronađena.' }; }
  var redovi = sheet.getRange(2, 1, lastRow - 1, BRZI_BILJESKE_HEADER.length).getValues();
  for (var i = 0; i < redovi.length; i++) {
    if (String(redovi[i][0]) !== String(id)) { continue; }
    var r = redovi[i];
    var staroPod = r[6] instanceof Date ? Utilities.formatDate(r[6], BRZI_TZ_, 'yyyy-MM-dd') : String(r[6] || '');
    var promijenjeno = staroPod !== pod || brziVrijemeStr_(r[9]) !== (vr || '') || String(r[10] || '') !== prim;
    var red = i + 2;
    sheet.getRange(red, 6).setValue(t);
    sheet.getRange(red, 7).setValue(pod);
    sheet.getRange(red, 10).setValue(vr || '');
    sheet.getRange(red, 11).setValue(prim);
    sheet.getRange(red, 13).setValue(String(telefon || '').trim());
    sheet.getRange(red, 15).setValue(brziBoja_(boja));
    if (promijenjeno) { sheet.getRange(red, 12).setValue(''); }
    var trig = null;
    if (pod) { try { trig = brziPodsjetniciTrigerOsiguraj_(); } catch (trErr) { trig = { status: 'error', message: String(trErr && trErr.message || trErr) }; } }
    var kal = brziKalendarZaRed_(sheet, red, false);
    return { status: 'ok', trigger: trig, kalendar: kal };
  }
  return { status: 'error', message: 'Bilješka nije pronađena.' };
}

function brziBiljeskeLista(token, ref, sve_) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  var sve = brziBiljeskeCitaj_();
  if (ref) { sve = sve.filter(function(b) { return b.ref === String(ref); }); }
  sve.reverse();
  return { status: 'ok', biljeske: sve.slice(0, sve_ ? 1000 : 100), danas: Utilities.formatDate(new Date(), BRZI_TZ_, 'yyyy-MM-dd'), primatelji: brziDohvatiPrimatelje_() };
}

function brziBiljeskaRijeseno(token, id, rijeseno) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  var sheet = getOrCreateBrziBiljeskeSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'error', message: 'Bilješka nije pronađena.' }; }
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      var da = (rijeseno === true || rijeseno === 'true');
      sheet.getRange(i + 2, 8).setValue(da ? 'Da' : '');
      sheet.getRange(i + 2, 9).setValue(da ? new Date() : '');
      var kalR = brziKalendarZaRed_(sheet, i + 2, false);
      return { status: 'ok', kalendar: kalR };
    }
  }
  return { status: 'error', message: 'Bilješka nije pronađena.' };
}

function brziBiljeskaObrisi(token, id) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  var sheet = getOrCreateBrziBiljeskeSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { status: 'error', message: 'Bilješka nije pronađena.' }; }
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) { brziKalendarZaRed_(sheet, i + 2, true); sheet.deleteRow(i + 2); return { status: 'ok' }; }
  }
  return { status: 'error', message: 'Bilješka nije pronađena.' };
}

// ---- PODSJETNICI S MAILOM (4.10.2026.) -------------------------------------
// Podsjetnik = bilješka s datumom (i po želji vremenom). Triger svakih 5 minuta šalje mail
// na popis adresa čim nastupi zadano vrijeme (bez vremena: 08:00). Tip 'poziv' = podsjetnik
// na telefonski poziv (u mailu je telefon kao poveznica za poziv). Ne šalje se za riješene.
var BRZI_TZ_ = 'Europe/Zagreb';
var BRZI_PRIMATELJI_KEY_ = 'BRZI_PODSJETNIK_PRIMATELJI';
var BRZI_PRIMATELJ_ZADANI_ = 'sasa.batinac@in-time.hr';
var BRZI_PODSJETNIK_ZADANO_VRIJEME_ = '08:00';
var BRZI_PODSJETNIK_NAJVISE_ZAKASNJENJE_MS_ = 3 * 24 * 60 * 60 * 1000;

// ---- GOOGLE KALENDAR (push obavijest na mobitel) --------------------------------------
// Svaki podsjetnik s datumom upisuje se kao događaj u zadani Google Kalendar vlasnika skripte,
// uz skočnu obavijest (u trenutku podsjetnika + 10 min ranije). Android aplikacija Kalendar tada
// pokaže push obavijest. Mijenjanje/rješavanje/brisanje podsjetnika ažurira ili briše događaj.
// Greška kalendara NIKAD ne smije srušiti spremanje podsjetnika — vraća se samo status.
var BRZI_KALENDAR_TRAJANJE_MIN_ = 15;
var BRZI_KALENDAR_PRIJE_MIN_ = 10;

// Boje podsjetnika = 11 boja Google Kalendara (1 Lavanda, 2 Kadulja, 3 Grožđe, 4 Flamingo, 5 Banana,
// 6 Mandarina, 7 Paun, 8 Grafit, 9 Borovnica, 10 Bosiljak, 11 Rajčica). Prazno = zadano po vrsti.
function brziBoja_(v) {
  var n = parseInt(v, 10);
  return (n >= 1 && n <= 11) ? String(n) : '';
}

function brziKalendarZaRed_(sheet, red, ukloni) {
  try {
    var r = sheet.getRange(red, 1, 1, BRZI_BILJESKE_HEADER.length).getValues()[0];
    var evId = String(r[13] || '');
    var pod = r[6] instanceof Date ? Utilities.formatDate(r[6], BRZI_TZ_, 'yyyy-MM-dd') : String(r[6] || '');
    var vr = brziVrijemeStr_(r[9]) || BRZI_PODSJETNIK_ZADANO_VRIJEME_;
    var rijeseno = r[7] === 'Da';
    var cal = CalendarApp.getDefaultCalendar();
    var ev = null;
    if (evId) { try { ev = cal.getEventById(evId); } catch (e1) { ev = null; } }
    if (ukloni || !pod || rijeseno) {
      if (ev) { try { ev.deleteEvent(); } catch (e2) {} }
      if (evId) { sheet.getRange(red, 14).setValue(''); }
      return { status: 'ok', radnja: 'uklonjeno' };
    }
    var start = Utilities.parseDate(pod + ' ' + vr, BRZI_TZ_, 'yyyy-MM-dd HH:mm');
    var end = new Date(start.getTime() + BRZI_KALENDAR_TRAJANJE_MIN_ * 60000);
    var poziv = String(r[2]) === 'poziv';
    var naziv = String(r[4] || '');
    var tekst = String(r[5] || '');
    var tel = String(r[12] || '').trim();
    var telHref = tel.split(',')[0].replace(/[^\d+]/g, '');
    var naslov = (poziv ? '📞 Nazvati: ' : '⏰ ') + (naziv || tekst.slice(0, 60));
    var opis = tekst + (tel ? '\n\nTelefon: ' + (telHref ? '<a href="tel:' + telHref + '">' + tel + '</a>' : tel) : '') + '\n\n(In Time — brzi modul)';
    if (ev) {
      ev.setTitle(naslov); ev.setTime(start, end); ev.setDescription(opis);
    } else {
      ev = cal.createEvent(naslov, start, end, { description: opis });
    }
    try { ev.setColor(brziBoja_(r[14]) || (poziv ? '11' : '1')); } catch (e3) {}
    ev.removeAllReminders();
    ev.addPopupReminder(0);
    ev.addPopupReminder(BRZI_KALENDAR_PRIJE_MIN_);
    sheet.getRange(red, 14).setValue(ev.getId());
    return { status: 'ok', radnja: 'uneseno' };
  } catch (err) {
    var poruka = String(err && err.message || err);
    try { PropertiesService.getScriptProperties().setProperty('BRZI_KALENDAR_ZADNJA_GRESKA', new Date() + ' — ' + poruka); } catch (e4) {}
    return { status: 'error', message: poruka };
  }
}

// Jednokratno ručno pokretanje u Apps Script editoru: traži dozvolu za Google Kalendar.
function brziAutorizirajKalendar() {
  var cal = CalendarApp.getDefaultCalendar();
  Logger.log('Kalendar OK: ' + cal.getName() + ' (' + cal.getId() + ')');
}

function brziVrijemeStr_(v) {
  if (v instanceof Date) { return Utilities.formatDate(v, BRZI_TZ_, 'HH:mm'); }
  var m = String(v == null ? '' : v).match(/^(\d{1,2}):(\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}

// '' = nije zadano; null = neispravno; inače 'HH:mm'
function brziNormalizirajVrijeme_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) { return ''; }
  var m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || parseInt(m[1], 10) > 23 || parseInt(m[2], 10) > 59) { return null; }
  return ('0' + m[1]).slice(-2) + ':' + m[2];
}

function brziDohvatiPrimatelje_() {
  var raw = PropertiesService.getScriptProperties().getProperty(BRZI_PRIMATELJI_KEY_);
  var lista = String(raw || '').split(/[,;\s]+/).map(function(x) { return x.trim(); }).filter(function(x) { return x; });
  return lista.length ? lista : [BRZI_PRIMATELJ_ZADANI_];
}

// Čisti popis adresa (odvojene zarezom/razmakom/točka-zarezom). Prazno + zadanoAkoPrazno = globalni popis.
function brziProcistiPrimatelje_(unos, zadanoAkoPrazno) {
  var lista = String(unos == null ? '' : unos).split(/[,;\s]+/).map(function(x) { return x.trim().toLowerCase(); }).filter(function(x) { return x; });
  if (!lista.length) {
    if (zadanoAkoPrazno) { return { ok: true, lista: brziDohvatiPrimatelje_() }; }
    return { ok: false, poruka: 'Upiši barem jednu e-mail adresu.' };
  }
  var vidjeno = {}, out = [];
  for (var i = 0; i < lista.length; i++) {
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(lista[i])) { return { ok: false, poruka: 'Neispravna e-mail adresa: ' + lista[i] }; }
    if (!vidjeno[lista[i]]) { vidjeno[lista[i]] = true; out.push(lista[i]); }
  }
  if (out.length > 10) { return { ok: false, poruka: 'Najviše 10 adresa.' }; }
  return { ok: true, lista: out };
}

function brziPostavkePodsjetnika(token) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  var trigAktivan = false;
  try {
    trigAktivan = ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === 'brziPodsjetniciSlanje_'; });
  } catch (e) {}
  return { status: 'ok', primatelji: brziDohvatiPrimatelje_(), trigerAktivan: trigAktivan, zadnjaGreska: PropertiesService.getScriptProperties().getProperty('BRZI_PODSJETNIK_ZADNJA_GRESKA') || '', kalendarGreska: PropertiesService.getScriptProperties().getProperty('BRZI_KALENDAR_ZADNJA_GRESKA') || '' };
}

function brziPostaviPrimatelje(token, popis) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  var pv = brziProcistiPrimatelje_(popis, false);
  if (!pv.ok) { return { status: 'error', message: pv.poruka }; }
  PropertiesService.getScriptProperties().setProperty(BRZI_PRIMATELJI_KEY_, pv.lista.join(', '));
  return { status: 'ok', primatelji: pv.lista };
}

// Osigurava triger (svakih 5 min). Poziva se samo pri dodavanju/uređivanju podsjetnika s datumom.
function brziPodsjetniciTrigerOsiguraj_() {
  var postoji = ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === 'brziPodsjetniciSlanje_'; });
  if (postoji) { return { status: 'ok', novo: false }; }
  ScriptApp.newTrigger('brziPodsjetniciSlanje_').timeBased().everyMinutes(5).create();
  return { status: 'ok', novo: true };
}

// Ručno pokretanje u editoru (ako automatsko stvaranje trigera ne uspije zbog dozvola).
function postaviTrigerZaBrzePodsjetnike() {
  var postojeci = ScriptApp.getProjectTriggers();
  for (var i = 0; i < postojeci.length; i++) {
    if (postojeci[i].getHandlerFunction() === 'brziPodsjetniciSlanje_') { ScriptApp.deleteTrigger(postojeci[i]); }
  }
  ScriptApp.newTrigger('brziPodsjetniciSlanje_').timeBased().everyMinutes(5).create();
  Logger.log('Triger postavljen — brziPodsjetniciSlanje_() svakih 5 minuta.');
}

function brziPodsjetnikHtml_(b) {
  function e(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var pozivTip = b.tip === 'poziv';
  var datum = b.podsjetnik ? b.podsjetnik.split('-').reverse().join('.') + '.' : '';
  var tel = String(b.telefon || '').trim();
  var telHref = tel.split(',')[0].replace(/[^\d+]/g, '');
  var h = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;border:1px solid #d7e3e1;border-radius:12px;overflow:hidden;">' +
    '<div style="background:#135450;color:#fff;padding:14px 18px;font-size:18px;font-weight:bold;">' + (pozivTip ? '📞 Podsjetnik: nazvati' : '⏰ Podsjetnik') + '</div>' +
    '<div style="padding:16px 18px;color:#1a2b2a;font-size:15px;line-height:1.5;">';
  if (b.naziv) { h += '<div style="font-size:18px;font-weight:bold;margin-bottom:4px;">' + e(b.naziv) + '</div>'; }
  h += '<div style="color:#5b6b69;margin-bottom:10px;">' + e(datum) + (b.vrijeme ? ' u ' + e(b.vrijeme) : '') + '</div>';
  h += '<div style="white-space:pre-wrap;background:#f2fbfa;border-left:4px solid #135450;padding:10px 12px;border-radius:6px;">' + e(b.tekst) + '</div>';
  if (tel) {
    h += '<div style="margin-top:14px;"><a href="tel:' + e(telHref) + '" style="display:inline-block;background:#1fa864;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;">📞 Nazovi ' + e(tel) + '</a></div>';
  }
  h += '</div><div style="background:#f4f7f7;color:#7a8a88;font-size:12px;padding:10px 18px;">In Time d.o.o. — brzi modul · automatski podsjetnik</div></div>';
  return h;
}

function brziPosaljiPodsjetnikMail_(b, primatelji) {
  var pozivTip = b.tip === 'poziv';
  var datum = b.podsjetnik ? b.podsjetnik.split('-').reverse().join('.') + '.' : '';
  var predmet = (pozivTip ? '📞 Nazvati: ' : '⏰ Podsjetnik: ') + (b.naziv || String(b.tekst).slice(0, 50)) + (b.vrijeme ? ' (' + b.vrijeme + ')' : ' (' + datum + ')');
  var tijelo = (pozivTip ? 'Podsjetnik — nazvati' : 'Podsjetnik') + (b.naziv ? ': ' + b.naziv : '') + '\n' + datum + (b.vrijeme ? ' ' + b.vrijeme : '') + '\n\n' + b.tekst + (b.telefon ? '\n\nTelefon: ' + b.telefon : '');
  posaljiMail_({ to: primatelji.join(','), subject: predmet, body: tijelo, htmlBody: brziPodsjetnikHtml_(b), name: 'In Time — podsjetnik' });
}

// Handler trigera (svakih 5 min).
function brziPodsjetniciSlanje_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) { return; }
  try {
    var sheet = getOrCreateBrziBiljeskeSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) { return; }
    var redovi = sheet.getRange(2, 1, lastRow - 1, BRZI_BILJESKE_HEADER.length).getValues();
    var sada = Date.now();
    var props = PropertiesService.getScriptProperties();
    var biljeske = brziBiljeskeCitaj_();
    for (var i = 0; i < biljeske.length; i++) {
      var b = biljeske[i];
      if (!b.podsjetnik || b.rijeseno || b.mailPoslan) { continue; }
      var vr = b.vrijeme || BRZI_PODSJETNIK_ZADANO_VRIJEME_;
      var dospijece;
      try { dospijece = Utilities.parseDate(b.podsjetnik + ' ' + vr, BRZI_TZ_, 'yyyy-MM-dd HH:mm').getTime(); } catch (pe) { continue; }
      if (dospijece > sada) { continue; }
      if (sada - dospijece > BRZI_PODSJETNIK_NAJVISE_ZAKASNJENJE_MS_) {
        sheet.getRange(b.rowIndex, 12).setValue('Preskočeno (zastarjelo)');
        continue;
      }
      var prim = brziProcistiPrimatelje_(b.primatelji, true);
      try {
        brziPosaljiPodsjetnikMail_(b, prim.ok ? prim.lista : brziDohvatiPrimatelje_());
        sheet.getRange(b.rowIndex, 12).setValue(new Date());
        props.deleteProperty('BRZI_PODSJETNIK_ZADNJA_GRESKA');
      } catch (err) {
        props.setProperty('BRZI_PODSJETNIK_ZADNJA_GRESKA', new Date() + ' — ' + String(err && err.message || err));
      }
    }
  } finally {
    lock.releaseLock();
  }
}

// Probni mail na trenutni popis primatelja (gumb u postavkama) — provjera da mail uopće stiže.
// Probna push obavijest: događaj u Kalendaru za 2 minute (skočna obavijest na mobitelu), briše se sam kroz 10 min.
function brziProbniKalendar(token) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  try {
    var cal = CalendarApp.getDefaultCalendar();
    var start = new Date(Date.now() + 2 * 60000);
    var ev = cal.createEvent('📞 Probna obavijest — In Time brzi modul', start, new Date(start.getTime() + 5 * 60000), { description: 'Ako vidiš ovu obavijest na mobitelu, push podsjetnici rade. Događaj možeš obrisati.' });
    ev.removeAllReminders(); ev.addPopupReminder(0);
    try { PropertiesService.getScriptProperties().deleteProperty('BRZI_KALENDAR_ZADNJA_GRESKA'); } catch (e0) {}
    return { status: 'ok', kalendar: cal.getName(), vrijeme: Utilities.formatDate(start, BRZI_TZ_, 'HH:mm') };
  } catch (err) {
    var poruka = String(err && err.message || err);
    try { PropertiesService.getScriptProperties().setProperty('BRZI_KALENDAR_ZADNJA_GRESKA', new Date() + ' — ' + poruka); } catch (e4) {}
    return { status: 'error', message: 'Kalendar nije dostupan: ' + poruka + ' — u Apps Script editoru jednom pokreni brziAutorizirajKalendar i odobri dozvolu.' };
  }
}

function brziProbniMail(token) {
  if (!isValidBrziToken_(token)) { return brziAuthGreska_(); }
  var prim = brziDohvatiPrimatelje_();
  try {
    brziPosaljiPodsjetnikMail_({ tip: 'poziv', naziv: 'Probni podsjetnik', podsjetnik: Utilities.formatDate(new Date(), BRZI_TZ_, 'yyyy-MM-dd'), vrijeme: Utilities.formatDate(new Date(), BRZI_TZ_, 'HH:mm'), tekst: 'Ovo je probni mail iz brzog modula. Ako ga vidiš, podsjetnici stižu na ovu adresu.', telefon: '' }, prim);
    var trig = null;
    try { trig = brziPodsjetniciTrigerOsiguraj_(); } catch (trErr) { trig = { status: 'error', message: String(trErr && trErr.message || trErr) }; }
    return { status: 'ok', primatelji: prim, trigger: trig };
  } catch (err) {
    return { status: 'error', message: 'Slanje nije uspjelo: ' + String(err && err.message || err) };
  }
}

// Prekidač "balončić s trendovima goriva na naslovnici" (3.10.2026., Sašin
// zahtjev) — ZADANO UGAŠEN. Uključuje/gasi ga admin (kartica Gorivo); javna
// naslovnica stanje čita iz gorivoJavniPodaci() (polje fabUkljucen).
var GORIVO_FAB_UKLJUCEN_KEY_ = 'GORIVO_FAB_UKLJUCEN';

function gorivoFabUkljucen_() {
  return PropertiesService.getScriptProperties().getProperty(GORIVO_FAB_UKLJUCEN_KEY_) === '1';
}

function adminGorivoFabPostavi(token, ukljucen) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var uklj = (ukljucen === true || ukljucen === 'true' || ukljucen === 1 || ukljucen === '1');
  PropertiesService.getScriptProperties().setProperty(GORIVO_FAB_UKLJUCEN_KEY_, uklj ? '1' : '0');
  return { status: 'ok', fabUkljucen: uklj };
}

function gorivoJavniPodaci() {
  var postotci = gorivoUcitajSveRedove_();
  postotci.sort(function(a, b) { return (a.godina - b.godina) || (a.mjesec - b.mjesec); });
  return {
    status: 'ok',
    postotci: postotci,
    dogadjaji: gorivoUcitajDogadjajeVidljive_(),
    cijene: gorivoJavneCijene_(),
    testPregled: gorivoDohvatiAktivniTestPregled_(),
    fabUkljucen: gorivoFabUkljucen_()
  };
}

// ---- Automatska obavijest klijentu kad ponudi istekne rok (Sašin izričit
// zahtjev, 23.9.2026. — "možeš li napraviti template koje će dobiti na mail
// kad ponuda istekne"). Za razliku od poništenja/odbijanja/prihvaćanja
// (koji su svi rezultat jednog konkretnog klika), istek je samo prolazak
// vremena — nema akcije koja bi "u tom trenutku" pozvala funkciju. Zato ovo
// prolazi kroz SVE retke svaki put kad ga triger pokrene (vidi
// postaviTrigerZaProvjeruIsteklihPonuda niže — satni triger), traži retke
// čiji je izracunajStatusPonude_() upravo 'istekla', i šalje mail SAMO ako
// ADMIN_ONLY_FIELDS.mail_istek_poslan još nije popunjen za taj redak (da se
// ista obavijest ne pošalje ponovno svaki sat). Sigurno za ponovno
// pokretanje — retci koji su već obrađeni se jednostavno preskaču. ----
function provjeriIIzvijestiIsteklePonude_() {
  var sheet = getOrCreateUpitiSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }
  var ocekivanoZaglavlje = izracunajOcekivanoZaglavljeUpiti_();
  var lastCol = Math.min(sheet.getLastColumn(), ocekivanoZaglavlje.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var istekPoslanCol = header.indexOf(ADMIN_ONLY_FIELDS.mail_istek_poslan);
  if (istekPoslanCol === -1) { return; }
  var mailAdreseCol = header.indexOf(ADMIN_ONLY_FIELDS.mail_adrese_ponude);
  var sifraCol = header.indexOf(ADMIN_ONLY_FIELDS.sifra_ponude);
  var verzijaCol = header.indexOf(ADMIN_ONLY_FIELDS.ponuda_verzija);
  var nazivCol = header.indexOf('Naziv tvrtke');
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var poslanoBroj = 0;
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    try {
      if (row[istekPoslanCol]) { continue; } // već obavijestili za ovu verziju
      if (izracunajStatusPonude_(header, row) !== 'istekla') { continue; }
      var mailAdreseSirovo = mailAdreseCol !== -1 ? String(row[mailAdreseCol] || '').trim() : '';
      var primatelji = mailAdreseSirovo
        ? mailAdreseSirovo.split(',').map(function(a) { return a.trim(); }).filter(function(a) { return EMAIL_REGEX_.test(a); })
        : [];
      // Bez ijedne ispravne adrese nema koga obavijestiti — retak se ipak
      // označava kao "obrađen" (upisom sadašnjeg datuma), da sweep svaki sat
      // ne pokušava iznova unedogled istu ponudu bez adrese.
      var rowIndex = i + 2;
      if (primatelji.length) {
        var sifraSirova = sifraCol !== -1 ? String(row[sifraCol] || '').trim() : '';
        var verzija = (verzijaCol !== -1 && parseInt(row[verzijaCol], 10)) || 1;
        var sifraPonude = sifraSirova ? (sifraSirova + '-P' + verzija) : '(bez broja ponude)';
        var tijeloTekst = 'Poštovani,\n\n' +
          'Obavještavamo Vas da je rok važenja naše ponude istekao, a kako do sada nismo zaprimili Vaš odgovor, ponuda je automatski deaktivirana.\n\n' +
          'Ukoliko i dalje postoji interes za suradnju s IN TIME d.o.o., rado ćemo Vam pripremiti novu ponudu s ažuriranim rokom — dovoljno je da nam se javite, ili ćemo Vas mi ponovno kontaktirati u dogledno vrijeme.\n\n' +
          'Zahvaljujemo Vam na dosadašnjem interesu i stojimo Vam na raspolaganju za sva pitanja.\n\n' +
          'Srdačan pozdrav / Kind regards,\nSaša Batinac';
        posaljiMail_(primatelji.join(','), 'PONUDA ISTEKLA: ' + sifraPonude, tijeloTekst, { bcc: NOTIFY_EMAIL, htmlBody: MAIL_PREDLOZAK_HTML_ISTEKLA_PONUDA_ });
        poslanoBroj++;
      }
      sheet.getRange(rowIndex, istekPoslanCol + 1).setValue(new Date());
    } catch (errRedak) {
      // Jedan redak koji zakaže (npr. neispravan email) ne smije zaustaviti
      // obradu ostatka popisa — jednostavno se preskače, pokušat će se
      // ponovno sljedeći put kad triger pokrene (mail_istek_poslan ostaje
      // prazan jer greška prekida PRIJE upisa datuma).
    }
  }
  if (poslanoBroj) { Logger.log('Obavijest o isteku poslana za ' + poslanoBroj + ' ponuda.'); }
}

// ---- JEDNOKRATNO POKRETANJE (ručno, jednom u editoru) — postavlja satni
// vremenski triger koji poziva provjeriIIzvijestiIsteklePonude_() svaki sat.
// Isti obrazac kao postaviTrigerZaDnevnoCiscenjeKante iznad — briše stari
// triger za istu funkciju prije stvaranja novog, da se ne gomilaju
// duplikati. Sat (ne dan) je odabran jer rok ponude može isteći u bilo koje
// doba dana (uklj. prilagođeni satni rok) — klijent tako čeka najviše sat
// vremena na obavijest, ne do 24h. ----
function postaviTrigerZaProvjeruIsteklihPonuda() {
  var postojeci = ScriptApp.getProjectTriggers();
  for (var i = 0; i < postojeci.length; i++) {
    if (postojeci[i].getHandlerFunction() === 'provjeriIIzvijestiIsteklePonude_') {
      ScriptApp.deleteTrigger(postojeci[i]);
    }
  }
  ScriptApp.newTrigger('provjeriIIzvijestiIsteklePonude_')
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log('Triger postavljen — provjeriIIzvijestiIsteklePonude_() pokretat će se svaki sat.');
}

// ============================================================
// CENTRI — KLIJENTI PO DISTRIBUCIJSKIM CENTRIMA (3.10.2026.)
// Sašin izričit zahtjev (kartica "Osnovni logistički podaci"): razvrstati
// klijente po distribucijskim centrima (prema polju "Nadležna poslovnica
// (admin)") i svakom centru dati SAMO NJEGOVE klijente — na DVA načina:
//   (A) MAIL: Excel (.xlsx) s klijentima centra šalje se na mail centra —
//       ručno gumbom, ILI automatski svakih N dana (N upisuje admin po
//       centru; dnevni triger centriAutoSlanjeDnevno_).
//   (B) PORTAL: centar se prijavljuje (e-mail + lozinka) na
//       InTime_CentarPortal.html i vidi SAMO svoje klijente (centarPrijava).
// Klijenti se izvode UŽIVO iz "InTime_Upiti" (isti uvjet kao kartica
// "Klijenti": Tip = Interes + popunjen "Datum otvaranja klijenta u sustavu
// (admin)"); skriveni klijenti ("Skriveno (admin)" = Da) NE idu centrima.
// OB lozinka se NIKAD ne šalje centrima (ni u mailu ni u portalu).
// Postavke po centru (portal e-mail, hash lozinke, primatelji, broj dana,
// zadnje slanje) žive u zasebnom Sheetu InTime_Centri_Pristup.
// ============================================================
var CENTRI_PRISTUP_SHEET_NAME = 'InTime_Centri_Pristup';
var CENTRI_PRISTUP_HEADER_ = ['Naziv centra', 'Email za prijavu u portal', 'Hash lozinke', 'Salt', 'Portal aktivan (Da/Ne)', 'Primatelji maila (zarezom)', 'Automatsko slanje (svakih N dana, 0 = isključeno)', 'Zadnje slanje', 'Zadnja prijava', 'Datum izmjene', 'Lozinka (vidljiva adminu)'];
var CENTRI_EXPORT_STUPCI_ = [
  ['Naziv klijenta', 'naziv'], ['OIB', 'oib'], ['TM broj', 'tm'], ['OB korisničko ime', 'obUser'],
  ['Adresa prikupa (ulica i broj)', 'adresa'], ['Poštanski broj', 'pbr'], ['Grad / mjesto', 'grad'],
  ['Adresa sjedišta (ako se razlikuje)', 'sjedisteRazlicito'], ['Vrijeme prikupa', 'vrijemePrikupa'],
  ['Zadnji termin za unos naloga', 'zadnjiTermin'], ['Osoba za logistiku', 'osoba'], ['Telefon', 'telefon'],
  ['E-mail', 'email'], ['Nadležne poslovnice', 'poslovniceTekst'], ['Klijent u sustavu od', 'otvorenoTekst']
];

function getOrCreateCentriPristupSheet_() {
  var files = DriveApp.getFilesByName(CENTRI_PRISTUP_SHEET_NAME);
  if (files.hasNext()) {
    var postojeci = SpreadsheetApp.open(files.next()).getSheets()[0];
    // Self-heal: stupac "Lozinka (vidljiva adminu)" (3.10.2026.) dopisuje se na kraj postojećeg Sheeta.
    if (postojeci.getLastColumn() < CENTRI_PRISTUP_HEADER_.length) { uskladiZaglavljeUpitiSheeta_(postojeci, CENTRI_PRISTUP_HEADER_); }
    return postojeci;
  }
  var ss = SpreadsheetApp.create(CENTRI_PRISTUP_SHEET_NAME);
  var sheet = ss.getSheets()[0];
  sheet.appendRow(CENTRI_PRISTUP_HEADER_);
  sheet.getRange(1, 1, 1, CENTRI_PRISTUP_HEADER_.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

function centriVrijemeUDatum_(v) {
  if (v instanceof Date) { return v; }
  if (!v) { return null; }
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function centriPristupCitaj_() {
  var sheet = getOrCreateCentriPristupSheet_();
  var lastRow = sheet.getLastRow();
  var redci = [];
  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, CENTRI_PRISTUP_HEADER_.length).getValues();
    for (var i = 0; i < data.length; i++) {
      if (!String(data[i][0] || '').trim()) { continue; }
      redci.push({
        rowIndex: i + 2,
        naziv: String(data[i][0]).trim(),
        loginEmail: String(data[i][1] || '').trim().toLowerCase(),
        hash: String(data[i][2] || ''),
        salt: String(data[i][3] || ''),
        aktivan: String(data[i][4] || '').trim() === 'Da',
        primatelji: String(data[i][5] || '').trim(),
        autoDana: parseInt(data[i][6], 10) || 0,
        zadnjeSlanje: centriVrijemeUDatum_(data[i][7]),
        zadnjaPrijava: centriVrijemeUDatum_(data[i][8]),
        lozinka: String(data[i][10] || '')
      });
    }
  }
  return { sheet: sheet, redci: redci };
}

function centriPristupRedak_(pristup, naziv) {
  var n = String(naziv || '').trim().toLowerCase();
  for (var i = 0; i < pristup.redci.length; i++) {
    if (pristup.redci[i].naziv.toLowerCase() === n) { return pristup.redci[i]; }
  }
  return null;
}

// Vraća redak postavki za centar; ako ga nema, stvara prazan (portal isključen, bez automatike).
function centriPristupOsiguraj_(naziv) {
  var pristup = centriPristupCitaj_();
  var r = centriPristupRedak_(pristup, naziv);
  if (r) { return { sheet: pristup.sheet, redak: r, pristup: pristup }; }
  pristup.sheet.appendRow([String(naziv).trim(), '', '', '', 'Ne', '', 0, '', '', new Date(), '']);
  pristup = centriPristupCitaj_();
  return { sheet: pristup.sheet, redak: centriPristupRedak_(pristup, naziv), pristup: pristup };
}

function centriFmtDatum_(d) {
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm') : '';
}

// Distribucijski centri = redci u "Logistički centri i servisi" vrste centar ili vanjski (servisi se ne računaju).
function centriDistribucijskiPopis_() {
  var sheet = getOrCreateLogistickiCentriSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return []; }
  var data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  var out = [];
  for (var i = 0; i < data.length; i++) {
    var naziv = String(data[i][0] || '').trim();
    var vrsta = String(data[i][7] || 'centar').trim() || 'centar';
    if (!naziv || vrsta === 'servis') { continue; }
    out.push({ naziv: naziv, email: String(data[i][3] || '').trim(), vrsta: vrsta });
  }
  out.sort(function(a, b) { return a.naziv.localeCompare(b.naziv, 'hr'); });
  return out;
}

function centriPomakniVrijeme_(hhmm, deltaMin) {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(String(hhmm))) { return ''; }
  var d = String(hhmm).split(':');
  var uk = parseInt(d[0], 10) * 60 + parseInt(d[1], 10) + deltaMin;
  uk = ((uk % 1440) + 1440) % 1440;
  function dv(n) { return (n < 10 ? '0' : '') + n; }
  return dv(Math.floor(uk / 60)) + ':' + dv(uk % 60);
}

// Svi KLIJENTI (kartica "Klijenti") s osnovnim logističkim podacima — isti redoslijed prednosti kao
// InTime_Admin.html logPodaciZaEntry_ (admin ispravak > upitnik). Bez OB lozinke.
function centriKlijentiSvi_() {
  var sheet = getOrCreateUpitiSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return []; }
  var oc = izracunajOcekivanoZaglavljeUpiti_();
  var lastCol = Math.min(sheet.getLastColumn(), oc.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var out = [];
  var rawOtv = header.indexOf('Datum otvaranja klijenta u sustavu (admin)');
  if (rawOtv === -1) { return []; }
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (String(row[1] || '') !== 'Interes') { continue; }
    if (!row[rawOtv]) { continue; }
    var g = function(l) {
      var ix = header.indexOf(l);
      if (ix === -1) { return ''; }
      var v = row[ix];
      if (v instanceof Date) { return String(formatirajSheetVrijednost_(v)).trim(); }
      return String(v == null ? '' : v).trim();
    };
    if (g('Skriveno (admin)') === 'Da') { continue; }
    var adresa = g('Ispravljena adresa prikupa (admin)') || g('Adresa mjesta prikupa pošiljaka') || g('Adresa sjedišta');
    var pbr = g('Ispravljeni poštanski broj prikupa (admin)') || g('Poštanski broj mjesta prikupa') || g('Poštanski broj');
    var grad = g('Ispravljeno mjesto prikupa (admin)') || g('Mjesto prikupa pošiljaka') || g('Mjesto');
    var sjedisteSvi = [g('Adresa sjedišta'), g('Poštanski broj'), g('Mjesto')].filter(function(x) { return x; }).join(', ');
    var prikupSvi = [adresa, pbr, grad].filter(function(x) { return x; }).join(', ');
    var vrijemeKlijent = g('Vrijeme prikupa pošiljaka (dolazak vozila)');
    var poslovnice = g('Nadležna poslovnica (admin)').split(',').map(function(x) { return x.trim(); }).filter(function(x) { return x; });
    out.push({
      naziv: g('Naziv tvrtke') || g('Naziv poslovnog subjekta'),
      oib: g('OIB') || g('OIB poslovnog subjekta'),
      tm: g('Identifikacijski TM broj klijenta (admin)'),
      obUser: g('OB korisničko ime (admin)') || g('Preferirana e-mail adresa za prijavu u Online Booking (OB)'),
      adresa: adresa, pbr: pbr, grad: grad,
      sjedisteRazlicito: (sjedisteSvi && prikupSvi && sjedisteSvi !== prikupSvi) ? sjedisteSvi : '',
      vrijemePrikupa: g('Vrijeme prikupa — ručno uređeno (admin)') || vrijemeKlijent,
      zadnjiTermin: g('Zadnje vrijeme unosa naloga (admin)') || centriPomakniVrijeme_(vrijemeKlijent, -30),
      osoba: g('Ispravljena osoba zadužena za prikup (admin)') || g('Osoba za organizaciju slanja/primanja pošiljaka – ime i prezime'),
      telefon: g('Ispravljeni telefon prikupa (admin)') || g('Osoba za organizaciju slanja/primanja pošiljaka – telefon'),
      email: g('Ispravljeni email prikupa (admin)') || g('Osoba za organizaciju slanja/primanja pošiljaka – email'),
      poslovnice: poslovnice,
      poslovniceTekst: poslovnice.join(', '),
      otvoreno: (row[rawOtv] instanceof Date) ? row[rawOtv] : null,
      otvorenoTekst: g('Datum otvaranja klijenta u sustavu (admin)')
    });
  }
  return out;
}

function centriKlijentiZaCentar_(klijenti, naziv) {
  var n = String(naziv || '').trim().toLowerCase();
  return klijenti.filter(function(k) {
    return k.poslovnice.some(function(p) { return p.toLowerCase() === n; });
  });
}

function centriHash_(salt, lozinka) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + lozinka, Utilities.Charset.UTF_8);
  return bytes.map(function(b) { var x = (b < 0 ? b + 256 : b).toString(16); return (x.length === 1 ? '0' : '') + x; }).join('');
}

function centriSlucajan_(n) {
  return Math.floor(parseInt(Utilities.getUuid().replace(/-/g, '').substring(0, 8), 16) / 4294967296 * n);
}

// vrsta: 'jaka' = SUPER JAKA (16 znakova: velika + mala slova + brojevi + točno JEDAN poseban znak);
// inače obična (12 znakova: slova i brojevi, bez zbunjujućih O/0/I/l/1).
function centriNovaLozinka_(vrsta) {
  var mala = 'abcdefghjkmnpqrstuvwxyz', velika = 'ABCDEFGHJKLMNPQRSTUVWXYZ', brojevi = '23456789', poseban = '!@#$%&*?';
  var iz = function(skup) { return skup.charAt(centriSlucajan_(skup.length)); };
  var znakovi = [];
  if (vrsta === 'jaka') {
    znakovi.push(iz(velika), iz(mala), iz(brojevi), iz(poseban));
    var sve = mala + velika + brojevi;
    while (znakovi.length < 16) { znakovi.push(iz(sve)); }
  } else {
    var sve2 = mala + velika + brojevi;
    while (znakovi.length < 12) { znakovi.push(iz(sve2)); }
  }
  for (var i = znakovi.length - 1; i > 0; i--) {
    var j = centriSlucajan_(i + 1), t = znakovi[i]; znakovi[i] = znakovi[j]; znakovi[j] = t;
  }
  return znakovi.join('');
}

function centriPortalUrl_() {
  return PropertiesService.getScriptProperties().getProperty('CENTRI_PORTAL_URL') || '';
}

function centriPrimateljiMaila_(redak, centar) {
  var sirovo = (redak && redak.primatelji) ? redak.primatelji : (centar ? centar.email : '');
  return String(sirovo || '').split(/[,;\s]+/).filter(function(m) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m); });
}

// Excel (.xlsx) s klijentima jednog centra. Privremeni Google Sheet se pretvara u .xlsx i odmah baca u smeće.
function centriXlsxBlob_(naziv, klijenti, zadnjeSlanje) {
  var ss = SpreadsheetApp.create('TMP_InTime_centar_' + Utilities.getUuid());
  var id = ss.getId();
  try {
    var sh = ss.getSheets()[0];
    sh.setName('Klijenti');
    var header = CENTRI_EXPORT_STUPCI_.map(function(c) { return c[0]; }).concat(['Novo od zadnjeg slanja']);
    var vals = [header].concat(klijenti.map(function(k) {
      var novo = (zadnjeSlanje && k.otvoreno && k.otvoreno.getTime() > zadnjeSlanje.getTime()) ? 'Da' : '';
      return CENTRI_EXPORT_STUPCI_.map(function(c) { return k[c[1]] || ''; }).concat([novo]);
    }));
    var rng = sh.getRange(1, 1, vals.length, header.length);
    rng.setNumberFormat('@');
    rng.setValues(vals);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#e8f4f3');
    sh.setFrozenRows(1);
    for (var c = 1; c <= header.length; c++) { sh.autoResizeColumn(c); }
    SpreadsheetApp.flush();
    var blob = DriveApp.getFileById(id).getAs(MimeType.MICROSOFT_EXCEL);
    var datum = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    blob.setName('InTime_klijenti_' + String(naziv).replace(/[^A-Za-z0-9ČčĆćŽžŠšĐđ_-]+/g, '_') + '_' + datum + '.xlsx');
    return blob;
  } finally {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (eT) { /* ignorira */ }
  }
}

function centriNadjiCentar_(naziv) {
  var n = String(naziv || '').trim().toLowerCase();
  var popis = centriDistribucijskiPopis_();
  for (var i = 0; i < popis.length; i++) { if (popis[i].naziv.toLowerCase() === n) { return popis[i]; } }
  return null;
}

// Pošalje mail centru: Excel + sažetak. izvor = 'ručno' | 'automatski'. NE baca — vraća {status, message}.
function centarPosaljiMailInterno_(naziv, izvor) {
  var centar = centriNadjiCentar_(naziv);
  if (!centar) { return { status: 'error', message: 'Centar "' + naziv + '" nije pronađen među distribucijskim centrima.' }; }
  var os = centriPristupOsiguraj_(centar.naziv);
  var redak = os.redak;
  var primatelji = centriPrimateljiMaila_(redak, centar);
  if (!primatelji.length) { return { status: 'error', message: 'Centar nema ispravnu e-mail adresu primatelja (upišite je u postavkama centra ili u kartici "Logistički centri").' }; }
  var klijenti = centriKlijentiZaCentar_(centriKlijentiSvi_(), centar.naziv);
  if (!klijenti.length) { return { status: 'error', message: 'Za centar "' + centar.naziv + '" trenutno nema nijednog klijenta — mail nije poslan.' }; }
  var zadnje = redak.zadnjeSlanje;
  var noviNazivi = klijenti.filter(function(k) { return zadnje && k.otvoreno && k.otvoreno.getTime() > zadnje.getTime(); }).map(function(k) { return k.naziv; });
  var blob = centriXlsxBlob_(centar.naziv, klijenti, zadnje);
  var portal = (redak.aktivan && redak.loginEmail && centriPortalUrl_()) ? centriPortalUrl_() : '';
  var predmet = 'In Time — popis klijenata za ' + centar.naziv + ' (' + klijenti.length + ')';
  var tekst = 'Poštovani,\n\nu prilogu (Excel) šaljemo ažurirani popis klijenata za koje je nadležan ' + centar.naziv + ' — ukupno ' + klijenti.length + '.' +
    (noviNazivi.length ? '\n\nNovi klijenti od zadnjeg slanja (' + centriFmtDatum_(zadnje).split(' ')[0] + '): ' + noviNazivi.join(', ') + '.' : '') +
    '\n\nPopis sadrži OIB, TM broj, adresu i vrijeme prikupa te osobu zaduženu za logistiku s kontaktom.' +
    (portal ? '\n\nAžuriran popis uvijek možete pogledati i u portalu: ' + portal : '') +
    '\n\nLijep pozdrav,\nIn Time d.o.o.';
  var html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5;">' +
    '<p>Poštovani,</p>' +
    '<p>u prilogu (Excel) šaljemo ažurirani popis klijenata za koje je nadležan <strong>' + centar.naziv + '</strong> — ukupno <strong>' + klijenti.length + '</strong>.</p>' +
    (noviNazivi.length ? '<p><strong>Novi klijenti od zadnjeg slanja (' + centriFmtDatum_(zadnje).split(' ')[0] + '):</strong> ' + noviNazivi.join(', ') + '.</p>' : '') +
    '<p>Popis sadrži OIB, TM broj, adresu i vrijeme prikupa te osobu zaduženu za logistiku s kontaktom.</p>' +
    (portal ? '<p>Ažuriran popis uvijek možete pogledati i u portalu: <a href="' + portal + '">' + portal + '</a></p>' : '') +
    '<p>Lijep pozdrav,<br>In Time d.o.o.</p></div>';
  try {
    posaljiMail_({ to: primatelji.join(','), subject: predmet, body: tekst, htmlBody: html, attachments: [blob], name: 'In Time d.o.o.' });
  } catch (eMail) {
    return { status: 'error', message: 'Slanje maila nije uspjelo: ' + eMail };
  }
  os.sheet.getRange(redak.rowIndex, 8).setValue(new Date());
  return { status: 'ok', message: 'Poslano (' + izvor + ') na ' + primatelji.join(', ') + ' — ' + klijenti.length + ' klijenata.', brojKlijenata: klijenti.length, primatelji: primatelji };
}

// ---- Dnevni triger: svakom centru kojem je uključeno automatsko slanje i prošlo je N dana šalje popis ----
function centriAutoSlanjeDnevno_() {
  var pristup = centriPristupCitaj_();
  var sada = new Date();
  var izvjestaj = [];
  pristup.redci.forEach(function(r) {
    if (!(r.autoDana > 0)) { return; }
    var proslo = r.zadnjeSlanje ? (sada.getTime() - r.zadnjeSlanje.getTime()) : Infinity;
    if (proslo < r.autoDana * 86400000 - 2 * 3600000) { return; }
    var res;
    try { res = centarPosaljiMailInterno_(r.naziv, 'automatski'); } catch (e) { res = { status: 'error', message: String(e) }; }
    izvjestaj.push(r.naziv + ': ' + (res.status === 'ok' ? 'OK — ' : 'NIJE POSLANO — ') + res.message);
  });
  if (izvjestaj.length) {
    try { posaljiMail_(NOTIFY_EMAIL, 'In Time — automatsko slanje popisa klijenata centrima', izvjestaj.join('\n'), {}); } catch (eN) { /* ignorira */ }
  }
  Logger.log(izvjestaj.join('\n') || 'Nijedan centar danas nije na redu.');
}

function centriAutoTrigerPostoji_() {
  var t = ScriptApp.getProjectTriggers();
  for (var i = 0; i < t.length; i++) { if (t[i].getHandlerFunction() === 'centriAutoSlanjeDnevno_') { return true; } }
  return false;
}

// Može se pokrenuti ručno u editoru ILI iz admina (gumb "Uključi automatsko slanje"). Sigurno za višekratno pokretanje.
function postaviTrigerZaCentriAutoSlanje() {
  var postojeci = ScriptApp.getProjectTriggers();
  for (var i = 0; i < postojeci.length; i++) {
    if (postojeci[i].getHandlerFunction() === 'centriAutoSlanjeDnevno_') { ScriptApp.deleteTrigger(postojeci[i]); }
  }
  ScriptApp.newTrigger('centriAutoSlanjeDnevno_').timeBased().everyDays(1).atHour(7).nearMinute(30).create();
  Logger.log('Triger postavljen — centriAutoSlanjeDnevno_() pokretat će se svaki dan oko 7:30.');
}

// ---- ADMIN akcije ----
function centriPristupZaPrikaz_(r) {
  return {
    loginEmail: r ? r.loginEmail : '',
    imaLozinku: !!(r && r.hash),
    lozinka: r ? r.lozinka : '',
    aktivan: !!(r && r.aktivan),
    primatelji: r ? r.primatelji : '',
    autoDana: r ? r.autoDana : 0,
    zadnjeSlanje: r ? centriFmtDatum_(r.zadnjeSlanje) : '',
    zadnjaPrijava: r ? centriFmtDatum_(r.zadnjaPrijava) : ''
  };
}

function adminCentriKlijentiPregled(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var centri = centriDistribucijskiPopis_();
  var pristup = centriPristupCitaj_();
  var klijenti = centriKlijentiSvi_();
  var poznati = {};
  var out = centri.map(function(c) {
    poznati[c.naziv.toLowerCase()] = true;
    return {
      naziv: c.naziv, vrsta: c.vrsta, email: c.email,
      brojKlijenata: centriKlijentiZaCentar_(klijenti, c.naziv).length,
      pristup: centriPristupZaPrikaz_(centriPristupRedak_(pristup, c.naziv))
    };
  });
  return { status: 'ok', centri: out, triger: centriAutoTrigerPostoji_(), portalUrl: centriPortalUrl_() };
}

function adminCentarPostavkeSpremi(token, naziv, p) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var centar = centriNadjiCentar_(naziv);
  if (!centar) { return { status: 'error', message: 'Centar nije pronađen.' }; }
  p = p || {};
  var loginEmail = String(p.loginEmail || '').trim().toLowerCase();
  if (loginEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(loginEmail)) { return { status: 'error', message: 'E-mail za prijavu u portal nije ispravan.' }; }
  var primateljiSirovo = String(p.primatelji || '').trim();
  if (primateljiSirovo) {
    var lose = primateljiSirovo.split(/[,;\s]+/).filter(function(m) { return m && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m); });
    if (lose.length) { return { status: 'error', message: 'Neispravna adresa primatelja: ' + lose.join(', ') }; }
  }
  var autoDana = parseInt(p.autoDana, 10) || 0;
  if (autoDana < 0 || autoDana > 365) { return { status: 'error', message: 'Broj dana za automatsko slanje mora biti između 0 i 365 (0 = isključeno).' }; }
  var os = centriPristupOsiguraj_(centar.naziv);
  if (loginEmail) {
    for (var i = 0; i < os.pristup.redci.length; i++) {
      var r = os.pristup.redci[i];
      if (r.rowIndex !== os.redak.rowIndex && r.loginEmail === loginEmail) { return { status: 'error', message: 'Taj e-mail za prijavu već koristi centar "' + r.naziv + '".' }; }
    }
  }
  var sh = os.sheet, row = os.redak.rowIndex;
  sh.getRange(row, 2).setValue(loginEmail);
  sh.getRange(row, 5).setValue(p.aktivan ? 'Da' : 'Ne');
  sh.getRange(row, 6).setValue(primateljiSirovo);
  sh.getRange(row, 7).setValue(autoDana);
  sh.getRange(row, 10).setValue(new Date());
  if (p.portalUrl) { PropertiesService.getScriptProperties().setProperty('CENTRI_PORTAL_URL', String(p.portalUrl).trim()); }
  return { status: 'ok', pristup: centriPristupZaPrikaz_(centriPristupRedak_(centriPristupCitaj_(), centar.naziv)) };
}

// Generira NOVU lozinku (vrsta 'jaka' = super jaka + 1 poseban znak) ILI postavlja lozinku koju je admin sam upisao (rucnaLozinka).
// Stara prestaje važiti. Za prijavu se koristi hash; čitljiva lozinka se dodatno bilježi u Sheet (stupac 11) da je admin uvijek može vidjeti/promijeniti.
function adminCentarLozinkaNova(token, naziv, posaljiMail, portalUrl, vrsta, rucnaLozinka) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var centar = centriNadjiCentar_(naziv);
  if (!centar) { return { status: 'error', message: 'Centar nije pronađen.' }; }
  var os = centriPristupOsiguraj_(centar.naziv);
  if (!os.redak.loginEmail) { return { status: 'error', message: 'Prvo upišite i spremite e-mail za prijavu u portal.' }; }
  if (portalUrl) { PropertiesService.getScriptProperties().setProperty('CENTRI_PORTAL_URL', String(portalUrl).trim()); }
  var lozinka;
  if (rucnaLozinka !== undefined && rucnaLozinka !== null && String(rucnaLozinka) !== '') {
    lozinka = String(rucnaLozinka);
    if (lozinka.length < 8 || lozinka.length > 64 || /\s/.test(lozinka)) { return { status: 'error', message: 'Lozinka mora imati 8–64 znakova, bez razmaka.' }; }
  } else {
    lozinka = centriNovaLozinka_(vrsta);
  }
  var salt = Utilities.getUuid();
  os.sheet.getRange(os.redak.rowIndex, 3).setValue(centriHash_(salt, lozinka));
  os.sheet.getRange(os.redak.rowIndex, 4).setValue(salt);
  os.sheet.getRange(os.redak.rowIndex, 5).setValue('Da');
  os.sheet.getRange(os.redak.rowIndex, 10).setValue(new Date());
  os.sheet.getRange(os.redak.rowIndex, 11).setValue(lozinka);
  var mailPoruka = '';
  if (posaljiMail) {
    var primatelji = centriPrimateljiMaila_(os.redak, centar);
    if (primatelji.indexOf(os.redak.loginEmail) === -1) { primatelji.push(os.redak.loginEmail); }
    var url = centriPortalUrl_();
    var tekst = 'Poštovani,\n\notvoren Vam je pristup portalu s popisom klijenata za ' + centar.naziv + '.' +
      (url ? '\n\nAdresa: ' + url : '') +
      '\nKorisničko ime (e-mail): ' + os.redak.loginEmail + '\nLozinka: ' + lozinka +
      '\n\nU portalu vidite samo klijente za koje je nadležan ' + centar.naziv + '.\n\nLijep pozdrav,\nIn Time d.o.o.';
    try {
      posaljiMail_({ to: primatelji.join(','), subject: 'In Time — pristup portalu s popisom klijenata (' + centar.naziv + ')', body: tekst, name: 'In Time d.o.o.' });
      mailPoruka = 'Pristupni podaci poslani na: ' + primatelji.join(', ') + '.';
    } catch (eM) { mailPoruka = 'Lozinka je generirana, ali mail nije poslan: ' + eM; }
  }
  return { status: 'ok', lozinka: lozinka, loginEmail: os.redak.loginEmail, mailPoruka: mailPoruka };
}

function adminCentarPosaljiMail(token, naziv) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var res = centarPosaljiMailInterno_(naziv, 'ručno');
  if (res.status === 'ok') { res.pristup = centriPristupZaPrikaz_(centriPristupRedak_(centriPristupCitaj_(), naziv)); }
  return res;
}

// Vraća .xlsx kao base64 (admin ga preuzima u pregledniku).
function adminCentarXlsx(token, naziv) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var centar = centriNadjiCentar_(naziv);
  if (!centar) { return { status: 'error', message: 'Centar nije pronađen.' }; }
  var klijenti = centriKlijentiZaCentar_(centriKlijentiSvi_(), centar.naziv);
  if (!klijenti.length) { return { status: 'error', message: 'Za centar "' + centar.naziv + '" trenutno nema nijednog klijenta.' }; }
  var os = centriPristupOsiguraj_(centar.naziv);
  var blob = centriXlsxBlob_(centar.naziv, klijenti, os.redak.zadnjeSlanje);
  return { status: 'ok', filename: blob.getName(), base64: Utilities.base64Encode(blob.getBytes()) };
}

function adminCentriAutoTrigerPostavi(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  try { postaviTrigerZaCentriAutoSlanje(); } catch (e) { return { status: 'error', message: 'Triger nije postavljen: ' + e }; }
  return { status: 'ok', triger: centriAutoTrigerPostoji_() };
}

// ---- JAVNO: prijava centra u portal (e-mail + lozinka) → SAMO klijenti tog centra ----
function centarPrijava(emailUneseno, lozinkaUnesena) {
  var email = String(emailUneseno || '').trim().toLowerCase();
  var lozinka = String(lozinkaUnesena || '');
  var neispravno = { status: 'error', message: 'Neispravan e-mail ili lozinka.' };
  if (!email || !lozinka) { return neispravno; }
  var cache = CacheService.getScriptCache();
  var kljuc = 'centar_fail_' + email.replace(/[^a-z0-9]/g, '_').substring(0, 80);
  var neuspjeli = parseInt(cache.get(kljuc) || '0', 10);
  if (neuspjeli >= 5) { return { status: 'error', message: 'Previše neuspjelih pokušaja — pokušajte ponovno za 15 minuta.' }; }
  var pristup = centriPristupCitaj_();
  var redak = null;
  for (var i = 0; i < pristup.redci.length; i++) {
    if (pristup.redci[i].loginEmail === email) { redak = pristup.redci[i]; break; }
  }
  if (!redak || !redak.aktivan || !redak.hash || centriHash_(redak.salt, lozinka) !== redak.hash) {
    cache.put(kljuc, String(neuspjeli + 1), 900);
    return neispravno;
  }
  cache.remove(kljuc);
  pristup.sheet.getRange(redak.rowIndex, 9).setValue(new Date());
  var klijenti = centriKlijentiZaCentar_(centriKlijentiSvi_(), redak.naziv);
  var lagano = klijenti.map(function(k) {
    var o = {};
    CENTRI_EXPORT_STUPCI_.forEach(function(c) { o[c[1]] = k[c[1]] || ''; });
    return o;
  });
  return {
    status: 'ok',
    centar: redak.naziv,
    stupci: CENTRI_EXPORT_STUPCI_.map(function(c) { return { kljuc: c[1], naziv: c[0] }; }),
    klijenti: lagano,
    azurirano: centriFmtDatum_(new Date())
  };
}

// ============================================================
// ARHIVA CJENIKA (3.10.2026.)
// Sašin izričit zahtjev: svi cjenici koje admin učita u KALKULACIJE bilježe se
// u arhivu (uz ime koje admin sam zada), a u svakom kalkulatoru može otvoriti
// popis arhive i jednim klikom učitati bilo koji zabilježeni cjenik.
// Datoteke (.xlsx) žive u Drive direktoriju "InTime_Arhiva_cjenika_datoteke",
// popis (naziv, datum, hash, ID datoteke) u Sheetu "InTime_Arhiva_cjenika".
// Isti sadržaj (SHA-256) ne sprema se dvaput. Brisanje je "meko": zapis se
// označi obrisanim, a Drive datoteka ide u smeće (može se vratiti s Drivea).
// ============================================================
var CJENIK_ARHIVA_SHEET_NAME = 'InTime_Arhiva_cjenika';
var CJENIK_ARHIVA_FOLDER_NAME = 'InTime_Arhiva_cjenika_datoteke';
var CJENIK_ARHIVA_HEADER_ = ['ID', 'Naziv', 'Izvorna datoteka', 'Datum spremanja', 'Hash (SHA-256)', 'Drive datoteka ID', 'Veličina (B)', 'Obrisano (Da)'];
var CJENIK_ARHIVA_MAX_B_ = 8 * 1024 * 1024;

function getOrCreateCjenikArhivaSheet_() {
  var files = DriveApp.getFilesByName(CJENIK_ARHIVA_SHEET_NAME);
  if (files.hasNext()) { return SpreadsheetApp.open(files.next()).getSheets()[0]; }
  var ss = SpreadsheetApp.create(CJENIK_ARHIVA_SHEET_NAME);
  var sheet = ss.getSheets()[0];
  sheet.appendRow(CJENIK_ARHIVA_HEADER_);
  sheet.getRange(1, 1, 1, CJENIK_ARHIVA_HEADER_.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

function getOrCreateCjenikArhivaFolder_() {
  var f = DriveApp.getFoldersByName(CJENIK_ARHIVA_FOLDER_NAME);
  if (f.hasNext()) { return f.next(); }
  return DriveApp.createFolder(CJENIK_ARHIVA_FOLDER_NAME);
}

function cjenikArhivaCitaj_() {
  var sheet = getOrCreateCjenikArhivaSheet_();
  var lastRow = sheet.getLastRow();
  var out = [];
  if (lastRow < 2) { return { sheet: sheet, redci: out }; }
  var data = sheet.getRange(2, 1, lastRow - 1, CJENIK_ARHIVA_HEADER_.length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (!data[i][0]) { continue; }
    var dat = data[i][3];
    out.push({
      rowIndex: i + 2,
      id: String(data[i][0]),
      naziv: String(data[i][1] || ''),
      datoteka: String(data[i][2] || ''),
      datumMs: (dat instanceof Date) ? dat.getTime() : (new Date(dat)).getTime() || 0,
      datum: (dat instanceof Date) ? Utilities.formatDate(dat, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm') : String(dat || ''),
      hash: String(data[i][4] || ''),
      driveId: String(data[i][5] || ''),
      velicina: parseInt(data[i][6], 10) || 0,
      obrisano: String(data[i][7] || '').trim() === 'Da'
    });
  }
  return { sheet: sheet, redci: out };
}

function cjenikArhivaZaPrikaz_(r) {
  return { id: r.id, naziv: r.naziv, datoteka: r.datoteka, datum: r.datum, hash: r.hash, velicina: r.velicina };
}

function cjenikArhivaNaziv_(naziv) {
  return String(naziv || '').replace(/[\r\n\t]+/g, ' ').trim().substring(0, 120);
}

function adminCjenikArhivaPopis(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var c = cjenikArhivaCitaj_();
  var lista = c.redci.filter(function(r) { return !r.obrisano; }).sort(function(a, b) { return b.datumMs - a.datumMs; }).map(cjenikArhivaZaPrikaz_);
  return { status: 'ok', lista: lista };
}

function adminCjenikArhivaSpremi(token, naziv, nazivDatoteke, base64, hash) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  naziv = cjenikArhivaNaziv_(naziv);
  if (!naziv) { return { status: 'error', message: 'Upišite naziv cjenika.' }; }
  if (!base64) { return { status: 'error', message: 'Nema sadržaja datoteke.' }; }
  var bytes;
  try { bytes = Utilities.base64Decode(base64); } catch (eB) { return { status: 'error', message: 'Datoteka nije ispravno kodirana.' }; }
  if (!bytes.length || bytes.length > CJENIK_ARHIVA_MAX_B_) { return { status: 'error', message: 'Datoteka je prazna ili veća od 8 MB.' }; }
  var hashSrv = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function(b) { var x = (b < 0 ? b + 256 : b).toString(16); return (x.length === 1 ? '0' : '') + x; }).join('');
  var c = cjenikArhivaCitaj_();
  for (var i = 0; i < c.redci.length; i++) {
    if (!c.redci[i].obrisano && c.redci[i].hash === hashSrv) {
      return { status: 'ok', vecPostoji: true, zapis: cjenikArhivaZaPrikaz_(c.redci[i]) };
    }
  }
  var ime = String(nazivDatoteke || 'cjenik.xlsx').replace(/[\\\/:*?"<>|]+/g, '_').substring(0, 100);
  var id = Utilities.getUuid();
  var blob = Utilities.newBlob(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', naziv.replace(/[\\\/:*?"<>|]+/g, '_') + ' — ' + ime);
  var file = getOrCreateCjenikArhivaFolder_().createFile(blob);
  var sada = new Date();
  c.sheet.appendRow([id, naziv, ime, sada, hashSrv, file.getId(), bytes.length, '']);
  return { status: 'ok', vecPostoji: false, zapis: { id: id, naziv: naziv, datoteka: ime, datum: Utilities.formatDate(sada, Session.getScriptTimeZone(), 'dd.MM.yyyy. HH:mm'), hash: hashSrv, velicina: bytes.length } };
}

function cjenikArhivaNadji_(c, id) {
  for (var i = 0; i < c.redci.length; i++) { if (c.redci[i].id === String(id) && !c.redci[i].obrisano) { return c.redci[i]; } }
  return null;
}

function adminCjenikArhivaDohvati(token, id) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var r = cjenikArhivaNadji_(cjenikArhivaCitaj_(), id);
  if (!r) { return { status: 'error', message: 'Cjenik nije pronađen u arhivi.' }; }
  var blob;
  try { blob = DriveApp.getFileById(r.driveId).getBlob(); } catch (eD) { return { status: 'error', message: 'Datoteka cjenika više nije na Driveu (možda je obrisana).' }; }
  return { status: 'ok', naziv: r.naziv, datoteka: r.datoteka, base64: Utilities.base64Encode(blob.getBytes()) };
}

function adminCjenikArhivaPreimenuj(token, id, naziv) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  naziv = cjenikArhivaNaziv_(naziv);
  if (!naziv) { return { status: 'error', message: 'Upišite naziv cjenika.' }; }
  var c = cjenikArhivaCitaj_();
  var r = cjenikArhivaNadji_(c, id);
  if (!r) { return { status: 'error', message: 'Cjenik nije pronađen u arhivi.' }; }
  c.sheet.getRange(r.rowIndex, 2).setValue(naziv);
  r.naziv = naziv;
  return { status: 'ok', zapis: cjenikArhivaZaPrikaz_(r) };
}

function adminCjenikArhivaObrisi(token, id) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var c = cjenikArhivaCitaj_();
  var r = cjenikArhivaNadji_(c, id);
  if (!r) { return { status: 'error', message: 'Cjenik nije pronađen u arhivi.' }; }
  c.sheet.getRange(r.rowIndex, 8).setValue('Da');
  try { DriveApp.getFileById(r.driveId).setTrashed(true); } catch (eT) { /* ignorira */ }
  return { status: 'ok' };
}

// ============================================================
// KORISNICI KALKULACIJA — radne kolege (3.10.2026.)
// Sašin izričit zahtjev: u KALKULACIJE nova pod-kartica "Korisnici" — admin
// dodaje kolege (ime, prezime, e-mail, telefon, funkcija), generira im lozinku
// (superjunaci) i daje link na posebnu stranicu (InTime_Kalkulacije.html) s
// prijavom, nakon koje kolega dobiva KALKULACIJE (max 3 kalkulatora istovremeno).
// Korisničko ime = e-mail (prijava prolazi i s brojem mobitela). Evidencija:
// prijave, izračuni (IP + unesene vrijednosti + rezultat) i učitani cjenici.
// Svaki cjenik koji kolega učita TIHO se sprema na Drive — direktorij
// "InTime_Kalkulacije_cjenici_korisnika" pokraj Sašine arhive cjenika, podmapa
// po korisniku, naziv datoteke "Ime Prezime - datum - vrijeme.xlsx". Kolega o
// tome ništa ne vidi (bez poruka, bez traženja naziva).
// ============================================================
var KOLEGE_SHEET_NAME = 'InTime_Kalkulacije_Korisnici';
var KOLEGE_HEADER_ = ['ID', 'Ime', 'Prezime', 'E-mail', 'Telefon', 'Funkcija', 'Korisničko ime', 'Lozinka', 'Zamrznuto (Da)', 'Kreirano', 'Zadnja prijava', 'Broj kalkulatora'];
var KOLEGE_EVID_SHEET_NAME = 'InTime_Kalkulacije_Evidencija';
var KOLEGE_CJENICI_FOLDER_NAME = 'InTime_Kalkulacije_cjenici_korisnika';
var KOLEGE_SESIJA_TTL_S_ = 21600;
var KOLEGE_CJENIK_MAX_B_ = 8 * 1024 * 1024;

// Broj kalkulatora za usporedbu koje korisnik smije otvoriti istovremeno
// (3.10.2026., Sašin zahtjev): 2–5, zadano 3. Čuva se u 12. stupcu.
var KOLEGE_KALK_MIN_ = 2, KOLEGE_KALK_MAX_ = 5, KOLEGE_KALK_ZADANO_ = 3;
function kolegeBrojKalk_(v) {
  var n = parseInt(v, 10);
  if (!n || isNaN(n)) { return KOLEGE_KALK_ZADANO_; }
  return Math.max(KOLEGE_KALK_MIN_, Math.min(KOLEGE_KALK_MAX_, n));
}

function getOrCreateKolegeSheet_() {
  var files = DriveApp.getFilesByName(KOLEGE_SHEET_NAME);
  if (files.hasNext()) {
    var shExist = SpreadsheetApp.open(files.next()).getSheets()[0];
    // Postojeća tablica (prije 3.10.2026.) nema stupac "Broj kalkulatora" — dodaj ga.
    try {
      if (shExist.getMaxColumns() < KOLEGE_HEADER_.length) { shExist.insertColumnsAfter(shExist.getMaxColumns(), KOLEGE_HEADER_.length - shExist.getMaxColumns()); }
      if (String(shExist.getRange(1, KOLEGE_HEADER_.length).getValue() || '') !== KOLEGE_HEADER_[KOLEGE_HEADER_.length - 1]) {
        shExist.getRange(1, KOLEGE_HEADER_.length).setValue(KOLEGE_HEADER_[KOLEGE_HEADER_.length - 1]).setFontWeight('bold');
      }
    } catch (eCol) { /* ignorira */ }
    return shExist;
  }
  var ss = SpreadsheetApp.create(KOLEGE_SHEET_NAME);
  var sheet = ss.getSheets()[0];
  sheet.appendRow(KOLEGE_HEADER_);
  sheet.getRange(1, 1, 1, KOLEGE_HEADER_.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange(2, 5, 999, 1).setNumberFormat('@');
  return sheet;
}

function getOrCreateKolegeEvidencijaSheet_() {
  var header = ['Datum', 'Vrsta', 'Funkcija', 'Ime i prezime', 'Korisničko ime', 'IP adresa', 'Ulazni podaci (JSON)', 'Rezultat sažetak', 'Rezultat HTML'];
  var files = DriveApp.getFilesByName(KOLEGE_EVID_SHEET_NAME);
  if (files.hasNext()) { return SpreadsheetApp.open(files.next()).getSheets()[0]; }
  var ss = SpreadsheetApp.create(KOLEGE_EVID_SHEET_NAME);
  var sheet = ss.getSheets()[0];
  sheet.appendRow(header);
  sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

function kolegeNormTel_(t) {
  var d = String(t || '').replace(/\D/g, '');
  if (d.indexOf('00') === 0) { d = d.substring(2); }
  if (d.indexOf('385') === 0) { d = '0' + d.substring(3); }
  return d;
}

function kolegeFmt_(v) {
  if (v instanceof Date) { return Utilities.formatDate(v, 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm'); }
  return v ? String(v) : '';
}

function kolegeCitaj_() {
  var sheet = getOrCreateKolegeSheet_();
  var lastRow = sheet.getLastRow();
  var redci = [];
  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, KOLEGE_HEADER_.length).getDisplayValues();
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      if (!r[0]) { continue; }
      redci.push({
        rowIndex: i + 2, id: String(r[0]), ime: r[1], prezime: r[2], email: String(r[3] || '').trim().toLowerCase(),
        telefon: r[4], funkcija: r[5], username: String(r[6] || '').trim().toLowerCase(), lozinka: String(r[7] || ''),
        zamrznuto: String(r[8] || '').trim() === 'Da', kreirano: r[9], zadnjaPrijava: r[10], brojKalk: kolegeBrojKalk_(r[11])
      });
    }
  }
  return { sheet: sheet, redci: redci };
}

function kolegaZaPrikaz_(r, sazetak) {
  var s = (sazetak && sazetak[r.username]) || {};
  return {
    id: r.id, ime: r.ime, prezime: r.prezime, email: r.email, telefon: r.telefon, funkcija: r.funkcija,
    korisnickoIme: r.username, lozinka: r.lozinka, zamrznuto: r.zamrznuto, kreirano: r.kreirano, zadnjaPrijava: r.zadnjaPrijava,
    brojPrijava: s.brojPrijava || 0, brojIzracuna: s.brojIzracuna || 0, brojCjenika: s.brojCjenika || 0, zadnjaAktivnost: s.zadnjaAktivnost || '',
    brojSlanja: s.brojSlanja || 0, zadnjeSlanje: s.zadnjeSlanje || '', brojKalkulatora: r.brojKalk || KOLEGE_KALK_ZADANO_
  };
}

function kolegeSazetakEvidencije_() {
  var out = {};
  var sheet = getOrCreateKolegeEvidencijaSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return out; }
  var data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  for (var i = 0; i < data.length; i++) {
    var u = String(data[i][4] || '').trim().toLowerCase();
    if (!u) { continue; }
    var o = out[u] || (out[u] = { brojPrijava: 0, brojIzracuna: 0, brojCjenika: 0, zadnjaAktivnost: '' });
    var v = data[i][1];
    if (v === 'Prijava') { o.brojPrijava++; } else if (v === 'Izračun') { o.brojIzracuna++; } else if (v === 'Učitan cjenik') { o.brojCjenika++; }
    else if (v === 'Poslan pristup') { o.brojSlanja = (o.brojSlanja || 0) + 1; o.zadnjeSlanje = data[i][0] ? String(data[i][0]) : o.zadnjeSlanje; continue; }
    o.zadnjaAktivnost = data[i][0] ? String(data[i][0]) : o.zadnjaAktivnost;
  }
  return out;
}

function kolegeZabiljezi_(k, vrsta, ulazni, sazetak, html, ip) {
  var sheet = getOrCreateKolegeEvidencijaSheet_();
  var LIM = 20000;
  sheet.appendRow([
    Utilities.formatDate(new Date(), 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm:ss'),
    vrsta, k.funkcija || '', (k.ime + ' ' + k.prezime).trim(), k.username, String(ip || '').trim(),
    String(ulazni || '').substring(0, LIM), String(sazetak || '').trim(), String(html || '').substring(0, LIM)
  ]);
}

function kolegeProvjeriPodatke_(ime, prezime, email, telefon, redci, ignorirajId) {
  ime = String(ime || '').trim(); prezime = String(prezime || '').trim();
  email = String(email || '').trim().toLowerCase(); telefon = String(telefon || '').trim();
  if (!ime || !prezime) { return { poruka: 'Upišite ime i prezime.' }; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { return { poruka: 'E-mail adresa nije ispravna (ona je korisničko ime).' }; }
  var tel = kolegeNormTel_(telefon);
  if (telefon && tel.length < 6) { return { poruka: 'Broj telefona nije ispravan.' }; }
  for (var i = 0; i < redci.length; i++) {
    if (redci[i].id === ignorirajId) { continue; }
    if (redci[i].username === email) { return { poruka: 'Korisnik s ovom e-mail adresom već postoji.' }; }
    if (tel && kolegeNormTel_(redci[i].telefon) === tel) { return { poruka: 'Korisnik s ovim brojem telefona već postoji.' }; }
  }
  return { ime: ime, prezime: prezime, email: email, telefon: telefon };
}

function kolegeLozinkaOk_(l) {
  l = String(l || '');
  return l.length >= 8 && !/\s/.test(l);
}

function adminKolegeList(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  try {
    var c = kolegeCitaj_();
    var sazetak = kolegeSazetakEvidencije_();
    return { status: 'ok', korisnici: c.redci.map(function(r) { return kolegaZaPrikaz_(r, sazetak); }) };
  } catch (err) { return { status: 'error', message: 'Dohvat korisnika nije uspio: ' + err.message }; }
}

function adminKolegaSpremi(token, id, ime, prezime, email, telefon, funkcija, lozinka) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = kolegeCitaj_();
    id = String(id || '');
    var p = kolegeProvjeriPodatke_(ime, prezime, email, telefon, c.redci, id);
    if (p.poruka) { return { status: 'error', message: p.poruka }; }
    funkcija = String(funkcija || '').trim().substring(0, 120);
    if (id) {
      var r = null;
      for (var i = 0; i < c.redci.length; i++) { if (c.redci[i].id === id) { r = c.redci[i]; break; } }
      if (!r) { return { status: 'error', message: 'Korisnik nije pronađen.' }; }
      c.sheet.getRange(r.rowIndex, 5).setNumberFormat('@');
      c.sheet.getRange(r.rowIndex, 2, 1, 6).setValues([[p.ime, p.prezime, p.email, p.telefon, funkcija, p.email]]);
      var c2 = kolegeCitaj_();
      var nov = c2.redci.filter(function(x) { return x.id === id; })[0];
      return { status: 'ok', korisnik: kolegaZaPrikaz_(nov, kolegeSazetakEvidencije_()) };
    }
    lozinka = String(lozinka || '').trim();
    if (!lozinka) { lozinka = centriNovaLozinka_('jaka'); }
    if (!kolegeLozinkaOk_(lozinka)) { return { status: 'error', message: 'Lozinka mora imati najmanje 8 znakova, bez razmaka.' }; }
    var noviId = Utilities.getUuid();
    c.sheet.appendRow([noviId, p.ime, p.prezime, p.email, '', funkcija, p.email, lozinka, '', Utilities.formatDate(new Date(), 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm'), '']);
    var zadnji = c.sheet.getLastRow();
    c.sheet.getRange(zadnji, 5).setNumberFormat('@').setValue(p.telefon);
    var c3 = kolegeCitaj_();
    var n = c3.redci.filter(function(x) { return x.id === noviId; })[0];
    return { status: 'ok', korisnik: kolegaZaPrikaz_(n, {}) };
  } catch (err) {
    return { status: 'error', message: 'Spremanje nije uspjelo: ' + err.message };
  } finally { lock.releaseLock(); }
}

function kolegeNadji_(c, id) {
  for (var i = 0; i < c.redci.length; i++) { if (c.redci[i].id === String(id)) { return c.redci[i]; } }
  return null;
}

function adminKolegaLozinkaNova(token, id, lozinka) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var c = kolegeCitaj_();
  var r = kolegeNadji_(c, id);
  if (!r) { return { status: 'error', message: 'Korisnik nije pronađen.' }; }
  lozinka = String(lozinka || '').trim();
  if (!lozinka) { lozinka = centriNovaLozinka_('jaka'); }
  if (!kolegeLozinkaOk_(lozinka)) { return { status: 'error', message: 'Lozinka mora imati najmanje 8 znakova, bez razmaka.' }; }
  c.sheet.getRange(r.rowIndex, 8).setValue(lozinka);
  return { status: 'ok', lozinka: lozinka };
}

function adminKolegaZamrzni(token, id, zamrznuto) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var c = kolegeCitaj_();
  var r = kolegeNadji_(c, id);
  if (!r) { return { status: 'error', message: 'Korisnik nije pronađen.' }; }
  c.sheet.getRange(r.rowIndex, 9).setValue(zamrznuto ? 'Da' : '');
  return { status: 'ok', zamrznuto: !!zamrznuto };
}

function adminKolegaObrisi(token, id) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var c = kolegeCitaj_();
  var r = kolegeNadji_(c, id);
  if (!r) { return { status: 'error', message: 'Korisnik nije pronađen (možda je već obrisan).' }; }
  c.sheet.deleteRow(r.rowIndex);
  return { status: 'ok' };
}

// Evidencija svih korisnika ili samo jednog (username): zadnjih `limit` (maks. 500), najnoviji prvi.
function adminKolegeEvidencija(token, limit, username) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  try {
    var sheet = getOrCreateKolegeEvidencijaSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) { return { status: 'ok', zapisi: [] }; }
    var maxLimit = Math.min(parseInt(limit, 10) || 200, 500);
    username = username ? String(username).trim().toLowerCase() : '';
    var svi = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
    if (username) { svi = svi.filter(function(r) { return String(r[4] || '').trim().toLowerCase() === username; }); }
    var zapisi = svi.slice(Math.max(0, svi.length - maxLimit)).map(mapKalkulatorEvidencijaRedak_).reverse();
    return { status: 'ok', zapisi: zapisi };
  } catch (err) { return { status: 'error', message: 'Dohvat evidencije nije uspio: ' + err.message }; }
}

// ---- JAVNO: prijava kolege (korisničko ime = e-mail ili broj mobitela) → sesijski token ----
function kalkulatorKolegaPrijava(usernameUneseno, lozinkaUnesena, ip) {
  var u = String(usernameUneseno || '').trim().toLowerCase();
  var lozinka = String(lozinkaUnesena || '').trim();
  var neispravno = { status: 'error', message: 'Neispravno korisničko ime ili lozinka.' };
  if (!u || !lozinka) { return { status: 'error', message: 'Unesite korisničko ime i lozinku.' }; }
  var cache = CacheService.getScriptCache();
  var kljuc = 'kolega_fail_' + u.replace(/[^a-z0-9]/g, '_').substring(0, 80);
  var neuspjeli = parseInt(cache.get(kljuc) || '0', 10);
  if (neuspjeli >= 5) { return { status: 'error', message: 'Previše neuspjelih pokušaja — pokušajte ponovno za 15 minuta.' }; }
  try {
    var c = kolegeCitaj_();
    var tel = u.indexOf('@') === -1 ? kolegeNormTel_(u) : '';
    var r = null;
    for (var i = 0; i < c.redci.length; i++) {
      var x = c.redci[i];
      if ((u.indexOf('@') !== -1 && x.username === u) || (tel && kolegeNormTel_(x.telefon) === tel)) { r = x; break; }
    }
    if (!r || !r.lozinka || r.lozinka !== lozinka) { cache.put(kljuc, String(neuspjeli + 1), 900); return neispravno; }
    if (r.zamrznuto) { return { status: 'error', message: 'Vaš pristup je privremeno onemogućen. Obratite se administratoru.' }; }
    cache.remove(kljuc);
    var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    cache.put('kolega_tok_' + token, r.id, KOLEGE_SESIJA_TTL_S_);
    c.sheet.getRange(r.rowIndex, 11).setValue(Utilities.formatDate(new Date(), 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm'));
    try { kolegeZabiljezi_(r, 'Prijava', '', '', '', ip); } catch (eL) { /* best-effort */ }
    return { status: 'ok', token: token, ime: r.ime, prezime: r.prezime, funkcija: r.funkcija, brojKalkulatora: r.brojKalk || KOLEGE_KALK_ZADANO_ };
  } catch (err) { return { status: 'error', message: 'Prijava trenutno nije moguća.' }; }
}

function kolegaIzTokena_(token) {
  token = String(token || '');
  if (!token) { return null; }
  var id = CacheService.getScriptCache().get('kolega_tok_' + token);
  if (!id) { return null; }
  var r = kolegeNadji_(kolegeCitaj_(), id);
  if (!r || r.zamrznuto) { return null; }
  return r;
}

function kalkulatorKolegaToken(token) {
  var r = kolegaIzTokena_(token);
  if (!r) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  return { status: 'ok', ime: r.ime, prezime: r.prezime, funkcija: r.funkcija, brojKalkulatora: r.brojKalk || KOLEGE_KALK_ZADANO_ };
}

// Zapis izračuna (fire-and-forget iz kalkulatora u iframeu).
function kalkulatorKolegaZabiljezi(token, slot, ulazniJson, sazetak, html, ip) {
  try {
    var r = kolegaIzTokena_(token);
    if (!r) { return { status: 'error' }; }
    var pref = '[Kalkulator ' + (parseInt(slot, 10) || 1) + '] ';
    kolegeZabiljezi_(r, 'Izračun', ulazniJson, pref + String(sazetak || ''), html, ip);
    return { status: 'ok' };
  } catch (err) { return { status: 'error' }; }
}

// Tiho spremanje učitanog cjenika na Drive + zapis u evidenciju.
function kalkulatorKolegaCjenikZabiljezi(token, slot, nazivDatoteke, base64, ip) {
  try {
    var r = kolegaIzTokena_(token);
    if (!r) { return { status: 'error' }; }
    var bytes = Utilities.base64Decode(String(base64 || ''));
    if (!bytes.length || bytes.length > KOLEGE_CJENIK_MAX_B_) { return { status: 'error' }; }
    var orig = String(nazivDatoteke || 'cjenik.xlsx').replace(/[\\\/:*?"<>|]+/g, '_').substring(0, 100);
    var m = /\.[A-Za-z0-9]+$/.exec(orig);
    var ext = m ? m[0] : '.xlsx';
    var imePrez = (r.ime + ' ' + r.prezime).trim().replace(/[\\\/:*?"<>|]+/g, '_');
    var sada = new Date();
    var nazivSpremljeno = imePrez + ' - ' + Utilities.formatDate(sada, 'Europe/Zagreb', 'dd.MM.yyyy. HH-mm-ss') + ext;
    var arhivaFolder = getOrCreateCjenikArhivaFolder_();
    var roditelji = arhivaFolder.getParents();
    var korijen = null;
    var it = roditelji.hasNext() ? roditelji.next() : null;
    var imena = it ? it.getFoldersByName(KOLEGE_CJENICI_FOLDER_NAME) : DriveApp.getFoldersByName(KOLEGE_CJENICI_FOLDER_NAME);
    if (imena.hasNext()) { korijen = imena.next(); }
    else { korijen = it ? it.createFolder(KOLEGE_CJENICI_FOLDER_NAME) : DriveApp.createFolder(KOLEGE_CJENICI_FOLDER_NAME); }
    var podmape = korijen.getFoldersByName(imePrez);
    var folderKorisnika = podmape.hasNext() ? podmape.next() : korijen.createFolder(imePrez);
    var blob = Utilities.newBlob(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', nazivSpremljeno);
    var file = folderKorisnika.createFile(blob);
    var pref = '[Kalkulator ' + (parseInt(slot, 10) || 1) + '] ';
    kolegeZabiljezi_(r, 'Učitan cjenik', JSON.stringify({ datoteka: orig, spremljeno: nazivSpremljeno, driveId: file.getId() }), pref + 'Učitan cjenik „' + orig + '“ (' + Math.max(1, Math.round(bytes.length / 1024)) + ' KB)', file.getUrl(), ip);
    return { status: 'ok' };
  } catch (err) { return { status: 'error' }; }
}

// Admin: postavlja koliko kalkulatora za usporedbu korisnik smije otvoriti (2–5).
function adminKolegaBrojKalkulatora(token, id, broj) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var n = parseInt(broj, 10);
  if (!n || n < KOLEGE_KALK_MIN_ || n > KOLEGE_KALK_MAX_) { return { status: 'error', message: 'Broj kalkulatora mora biti od ' + KOLEGE_KALK_MIN_ + ' do ' + KOLEGE_KALK_MAX_ + '.' }; }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var c = kolegeCitaj_();
    var r = c.redci.filter(function(x) { return String(x.id) === String(id); })[0];
    if (!r) { return { status: 'error', message: 'Korisnik nije pronađen.' }; }
    c.sheet.getRange(r.rowIndex, KOLEGE_HEADER_.length).setValue(n);
    return { status: 'ok', brojKalkulatora: n };
  } finally { lock.releaseLock(); }
}

// ---- SLANJE PRISTUPA KOLEGI MAILOM (3.10.2026.) ----
// Sašin zahtjev: na kartici korisnika kalkulacija panel "Pošalji" (kao kod
// obavijesti poslovnicama): tekst maila s linkom + korisničkim imenom +
// lozinkom + napomenom o osnovnom cjeniku, polje za prilog (cjenik) i gumb
// Pošalji. Tekst sastavlja admin stranica iz podataka kolege; ovdje se samo
// provjeri da kolega postoji, validiraju adrese/prilozi i pošalje mail
// (običan tekst + HTML s klikabilnim linkom). testAdresa → samo probno slanje.
var KOLEGE_MAIL_PRILOZI_MAX_B_ = 15 * 1024 * 1024;
var KOLEGE_MAIL_PRILOZI_FOLDER_NAME = 'InTime_Kalkulacije_mail_prilozi';

function kolegeMailHtml_(tekst) {
  var e = String(tekst || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  e = e.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2933;">' + e.replace(/\r?\n/g, '<br>') + '</div>';
}

// ZAPAMĆENI PRILOZI (3.10.2026.): Saša jednom priloži osnovni cjenik i on ostaje
// zapamćen (Drive mapa pokraj mape s cjenicima korisnika) — pri sljedećem slanju
// bilo kojem korisniku već je ponuđen (označen) i ne mora se ponovno unositi.
function kolegeMailPriloziFolder_() {
  var arhivaFolder = getOrCreateCjenikArhivaFolder_();
  var roditelji = arhivaFolder.getParents();
  var it = roditelji.hasNext() ? roditelji.next() : null;
  var imena = it ? it.getFoldersByName(KOLEGE_MAIL_PRILOZI_FOLDER_NAME) : DriveApp.getFoldersByName(KOLEGE_MAIL_PRILOZI_FOLDER_NAME);
  if (imena.hasNext()) { return imena.next(); }
  return it ? it.createFolder(KOLEGE_MAIL_PRILOZI_FOLDER_NAME) : DriveApp.createFolder(KOLEGE_MAIL_PRILOZI_FOLDER_NAME);
}

function kolegeMailPrilogUMapi_(fileId) {
  if (!fileId) { return null; }
  var folder = kolegeMailPriloziFolder_();
  var file;
  try { file = DriveApp.getFileById(String(fileId)); } catch (e) { return null; }
  if (file.isTrashed()) { return null; }
  var pr = file.getParents();
  while (pr.hasNext()) { if (pr.next().getId() === folder.getId()) { return file; } }
  return null;
}

function adminKolegeMailPriloziPopis(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var lista = [];
  var it = kolegeMailPriloziFolder_().getFiles();
  while (it.hasNext()) {
    var f = it.next();
    lista.push({ id: f.getId(), naziv: f.getName(), velicina: f.getSize(), datumMs: f.getDateCreated().getTime(),
      datum: Utilities.formatDate(f.getDateCreated(), 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm') });
  }
  lista.sort(function(a, b) { return b.datumMs - a.datumMs; });
  return { status: 'ok', lista: lista };
}

function adminKolegeMailPrilogObrisi(token, id) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var f = kolegeMailPrilogUMapi_(id);
  if (!f) { return { status: 'error', message: 'Prilog nije pronađen.' }; }
  f.setTrashed(true);
  return { status: 'ok' };
}

// htmlTijelo = gotov HTML mail (isti izgled kao ostali mailovi — banner, kućice
// s korisničkim imenom i lozinkom, gumb), sastavlja ga admin stranica iz podataka
// kolege u trenutku slanja. tijelo = običan tekst (rezervna verzija).
// zapamceniIds = ID-ovi zapamćenih priloga koje treba priložiti; zapamtiNove =
// spremi i novo priložene datoteke za sljedeća slanja.
// Pravo (ne probno) slanje bilježi se u evidenciju korisnika s točnim datumom i
// vremenom ('Poslan pristup'); testAdresa → samo probno slanje (ne bilježi se).
function adminKolegaPosaljiPristup(token, id, primatelji, predmet, tijelo, kopijaSebi, testAdresa, prilozi, htmlTijelo, zapamceniIds, zapamtiNove) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  if (!tijelo || !String(tijelo).trim()) { return { status: 'error', message: 'Tekst maila je prazan.' }; }
  var kolega = kolegeCitaj_().redci.filter(function(r) { return String(r.id) === String(id); })[0];
  if (!kolega) { return { status: 'error', message: 'Korisnik nije pronađen (možda je uklonjen).' }; }
  var jeTest = !!String(testAdresa || '').trim();
  var adrese;
  if (jeTest) {
    var t = String(testAdresa).trim();
    if (!EMAIL_REGEX_.test(t)) { return { status: 'error', message: 'Upišite ispravnu e-mail adresu za probno slanje.' }; }
    adrese = [t];
  } else {
    adrese = validirajViseMailova_(primatelji);
    if (!adrese) { return { status: 'error', message: 'Upišite barem jednu ispravnu adresu primatelja (odvojene zarezom).' }; }
  }
  var blobovi = [];
  var nazivi = [];
  var ukupno = 0;
  // 1) zapamćeni prilozi (već na Driveu)
  var zId = (zapamceniIds && zapamceniIds.length) ? zapamceniIds : [];
  for (var z = 0; z < zId.length && z < 10; z++) {
    var zf = kolegeMailPrilogUMapi_(zId[z]);
    if (!zf) { return { status: 'error', message: 'Zapamćeni prilog više nije dostupan — osvježite panel.' }; }
    var zb = zf.getBlob();
    ukupno += zf.getSize();
    if (ukupno > KOLEGE_MAIL_PRILOZI_MAX_B_) { return { status: 'error', message: 'Prilozi su veći od 15 MB ukupno.' }; }
    blobovi.push(zb); nazivi.push(zf.getName());
  }
  // 2) novo priloženi
  var novi = [];
  var lista = (prilozi && prilozi.length) ? prilozi : [];
  for (var i = 0; i < lista.length && i < 10; i++) {
    var p = lista[i] || {};
    var bytes;
    try { bytes = Utilities.base64Decode(String(p.base64 || '')); } catch (eB) { return { status: 'error', message: 'Prilog nije ispravno kodiran.' }; }
    if (!bytes.length) { continue; }
    ukupno += bytes.length;
    if (ukupno > KOLEGE_MAIL_PRILOZI_MAX_B_) { return { status: 'error', message: 'Prilozi su veći od 15 MB ukupno.' }; }
    var ime = String(p.naziv || ('prilog' + (i + 1))).replace(/[\\\/:*?"<>|]+/g, '_').substring(0, 120);
    var bl = Utilities.newBlob(bytes, String(p.mime || 'application/octet-stream'), ime);
    blobovi.push(bl); nazivi.push(ime); novi.push(bl);
  }
  try {
    var html = String(htmlTijelo || '').trim();
    if (!html || html.length > 200000) { html = kolegeMailHtml_(tijelo); }
    var opcije = { htmlBody: html };
    if (blobovi.length) { opcije.attachments = blobovi; }
    if (kopijaSebi && !jeTest) { opcije.bcc = NOTIFY_EMAIL; }
    var subj = String(predmet || '').trim() || 'In Time — pristup alatu KALKULACIJE';
    posaljiMail_(adrese.join(','), jeTest ? ('- TEST - ' + subj) : subj, String(tijelo), opcije);
    var vrijeme = Utilities.formatDate(new Date(), 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm:ss');
    if (!jeTest) {
      // Bilježenje (i pamćenje priloga) NIKAD ne poništava već poslan mail.
      try {
        kolegeZabiljezi_(kolega, 'Poslan pristup', JSON.stringify({ primatelji: adrese, predmet: subj, prilozi: nazivi }),
          'Poslan mail s pristupom na ' + adrese.join(', ') + (nazivi.length ? ' (prilozi: ' + nazivi.join(', ') + ')' : ' (bez priloga)'), '', '');
      } catch (eZ) { /* ignorira */ }
    }
    if (zapamtiNove && novi.length) {
      try {
        var folder = kolegeMailPriloziFolder_();
        novi.forEach(function(bl) {
          var stari = folder.getFilesByName(bl.getName());
          while (stari.hasNext()) { stari.next().setTrashed(true); }
          folder.createFile(bl);
        });
      } catch (eP) { /* ignorira */ }
    }
    return { status: 'ok', poslanoNa: adrese, test: jeTest, brojPriloga: blobovi.length, vrijeme: vrijeme };
  } catch (err) {
    return { status: 'error', message: 'Slanje maila nije uspjelo: ' + err.message };
  }
}

// ---- CJENICI DRUGIH KORISNIKA u adminu (3.10.2026.) ----
// Sašin zahtjev: u Arhivi cjenika gumb "Cjenici drugih korisnika" — popis
// cjenika koje su kolege učitali (tiho spremljeni u
// InTime_Kalkulacije_cjenici_korisnika/<Ime Prezime>/), s mogućnošću
// učitavanja u kalkulator i spremanja u Sašinu arhivu pod zadanim imenom.
// Sve je samo za čitanje (kolegine datoteke se ne mijenjaju niti brišu).
function kolegeCjeniciKorijen_() {
  var arhivaFolder = getOrCreateCjenikArhivaFolder_();
  var roditelji = arhivaFolder.getParents();
  var it = roditelji.hasNext() ? roditelji.next() : null;
  var imena = it ? it.getFoldersByName(KOLEGE_CJENICI_FOLDER_NAME) : DriveApp.getFoldersByName(KOLEGE_CJENICI_FOLDER_NAME);
  return imena.hasNext() ? imena.next() : null;
}

// Datoteka smije biti dohvaćena samo ako leži u podmapi korijena kolegskih cjenika.
function kolegeCjenikDatotekaProvjeri_(fileId) {
  var korijen = kolegeCjeniciKorijen_();
  if (!korijen || !fileId) { return null; }
  var file;
  try { file = DriveApp.getFileById(String(fileId)); } catch (e) { return null; }
  if (file.isTrashed()) { return null; }
  var p1 = file.getParents();
  while (p1.hasNext()) {
    var podmapa = p1.next();
    var p2 = podmapa.getParents();
    while (p2.hasNext()) {
      if (p2.next().getId() === korijen.getId()) { return { file: file, korisnik: podmapa.getName() }; }
    }
  }
  return null;
}

function adminKolegeCjeniciPopis(token) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var korijen = kolegeCjeniciKorijen_();
  var lista = [];
  if (korijen) {
    var podmape = korijen.getFolders();
    while (podmape.hasNext()) {
      var pm = podmape.next();
      var datoteke = pm.getFiles();
      while (datoteke.hasNext()) {
        var f = datoteke.next();
        var d = f.getDateCreated();
        lista.push({
          id: f.getId(),
          korisnik: pm.getName(),
          datoteka: f.getName(),
          datumMs: d.getTime(),
          datum: Utilities.formatDate(d, 'Europe/Zagreb', 'dd.MM.yyyy. HH:mm'),
          velicina: f.getSize()
        });
      }
    }
  }
  lista.sort(function(a, b) { return b.datumMs - a.datumMs; });
  return { status: 'ok', lista: lista.slice(0, 500) };
}

function adminKolegeCjenikDohvati(token, fileId) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var r = kolegeCjenikDatotekaProvjeri_(fileId);
  if (!r) { return { status: 'error', message: 'Datoteka cjenika nije pronađena (možda je obrisana s Drivea).' }; }
  return { status: 'ok', korisnik: r.korisnik, datoteka: r.file.getName(), base64: Utilities.base64Encode(r.file.getBlob().getBytes()) };
}

// Sprema kopiju kolegina cjenika u Sašinu arhivu cjenika pod zadanim imenom.
function adminKolegeCjenikUArhivu(token, fileId, naziv) {
  if (!isValidAdminToken_(token)) { return { status: 'error', message: 'Sesija je istekla — prijavite se ponovno.' }; }
  var r = kolegeCjenikDatotekaProvjeri_(fileId);
  if (!r) { return { status: 'error', message: 'Datoteka cjenika nije pronađena (možda je obrisana s Drivea).' }; }
  var bytes = r.file.getBlob().getBytes();
  var ime = r.file.getName();
  return adminCjenikArhivaSpremi(token, naziv, ime, Utilities.base64Encode(bytes), '');
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
