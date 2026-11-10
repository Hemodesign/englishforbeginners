# Punakynä – työenglannin kirjoitus- ja puhevalmentaja

Selainsovellus (PWA), joka mittaa englannin tasosi, valitsee päivittäiset tehtävät heikkouksiesi mukaan ja korjaa kirjoituksesi ja puheesi "punakynällä". Toimii puhelimella ja tietokoneella, asennettavissa kotinäytölle, ei palvelinta. Ilmainen.

## Julkaisu GitHub Pagesiin (5 min)

1. Luo GitHubissa uusi repo, esim. `punakyna`. Ilmaistilillä Pages vaatii julkisen repon – se on ok, koska repossa on vain koodi, ei sinun dataasi tai avaimiasi.
2. **Add file → Upload files** → raahaa tämän kansion *sisältö* (index.html, styles.css, js/, icons/, sw.js, manifest.webmanifest, supabase/, README.md). Kansio `.github` kannattaa lisätä vain jos käytät Supabasea (ks. alla); piilokansion voi joutua luomaan käsin tai pushaamaan gitillä.
3. **Settings → Pages → Source: Deploy from a branch → main / (root) → Save.**
4. Minuutin päästä sovellus on osoitteessa `https://<käyttäjä>.github.io/punakyna/`.
5. Puhelimessa: avaa osoite → Jaa / valikko → **Lisää kotivalikkoon**.

## Tekoäly (ilmainen)

Ilman tekoälyä kaikki toimii, mutta kirjoitus- ja puhetehtävät arvioit itse mallivastausta vasten. Tekoälyn kanssa saat virhekohtaiset korjaukset, CEFR-arvion jokaisesta tekstistä ja uusia, heikkouksiisi räätälöityjä tehtäviä.

- **Gemini (suositus):** aistudio.google.com → *Get API key* → kopioi avain sovelluksen **Asetukset → Tekoäly**. Paina *Hae mallit* ja valitse flash-malli, jos oletus ei toimi. Ilmaiskiintiö riittää päivittäiseen käyttöön (n. 3–10 kutsua/päivä).
- **Vaihtoehto:** mikä tahansa OpenAI-yhteensopiva rajapinta (esim. Groq:n ilmainen kiintiö). Tarkista mallinimi palvelun sivuilta.
- Avain tallentuu vain kyseisen laitteen selaimeen, ei repoon eikä synkronoitavaan dataan. Syötä se erikseen puhelimeen ja koneeseen.
- **Huom:** Googlen ilmaistasolla syötteitä voidaan käyttää tuotekehitykseen. Älä kirjoita tehtäviin luottamuksellisia asiakas- tai tuotetietoja.

## Synkronointi puhelimen ja koneen välillä

Data tallentuu aina ensin laitteelle. Synkronointi **yhdistää** historiat (tapahtumaloki), joten mikään ei katoa, vaikka harjoittelisit molemmilla offline-tilassa.

**GitHub Gist (yksinkertaisin, ei koskaan nukahda):**
GitHub → Settings → Developer settings → Personal access tokens → *Tokens (classic)* → Generate → rasti vain **gist** → kopioi token molempien laitteiden asetuksiin. Data menee yksityiseen gistiin.

**Supabase:**
1. supabase.com → New project (Free).
2. SQL Editor → liitä `supabase/schema.sql` → Run.
3. Project Settings → API: kopioi *Project URL* ja *publishable/anon key* sovelluksen asetuksiin → Luo tunnus → Kirjaudu (molemmilla laitteilla samalla tunnuksella).
4. Ilmaisprojekti pausettuu 7 päivän hiljaisuuden jälkeen (data säilyy, palautus hallintapaneelista). Päivittäinen harjoittelu pitää sen hereillä. Varmistukseksi: lisää repoon `.github/workflows/supabase-keepalive.yml` ja repon *Settings → Secrets → Actions* arvot `SUPABASE_URL` ja `SUPABASE_KEY`; GitHub pingaa tietokantaa 3 päivän välein.

Lisäksi **Asetukset → Vie varmuuskopio** tallentaa koko historian JSON-tiedostoon.

## Miten järjestelmä toimii

**Taitomalli.** Viisi taitoa (kielioppi, lauseenmuodostus, kirjoittaminen, puhuminen, sujuvuus) saavat kukin Elo-tyyppisen luokituksen, joka kuvataan CEFR-tasoksi (B1 = 1000–1200, B2 = 1200–1400, C1 = 1400–1600). Jokaisella tehtävällä on vaikeusluku samalla asteikolla. Vastaus päivittää luokitusta sen mukaan, kuinka yllättävä tulos oli: vaikean tehtävän onnistuminen nostaa enemmän kuin helpon. Päivitysaskel pienenee, kun dataa kertyy.

**Sujuvuus** mitataan ajasta: käännös- ja sanajärjestystehtävien vastausaika, kirjoitusnopeus (sanaa/min) ja puhenopeus.

**Tehtävien valinta.** Päivän suunnitelma kootaan näin:
1. Erääntyneet kertaukset (omat aiemmat virheesi ensin).
2. Tehtävät, joiden vaikeus on hieman tasosi yläpuolella (~70 % onnistumistodennäköisyys).
3. Painotus taitoihin, jotka ovat kauimpana tavoitteesta tai joiden trendi laskee. Kirjoittaminen ja puhuminen saavat lisäpainon.
4. Virhetyypit (artikkelit, prepositiot, he/she…), joissa tarkkuutesi on heikoin, saavat lisäpainoa.
5. Joka päivä vähintään yksi kirjoitus- ja yksi puhetehtävä – ne ovat pakollisia.

**Virhepankki.** Tekoälyn löytämät virheet omissa teksteissäsi muuttuvat henkilökohtaisiksi korjaustehtäviksi, jotka palaavat kertaukseen 1, 3, 7, 14 ja 30 päivän välein.

**Trendi.** Lineaarinen regressio viimeisen 4 viikon luokituksista → muutos pistettä/viikko ja arvio, milloin tavoitetaso saavutetaan.

**Tasotestit.** Lähtötesti ja sen jälkeen 14 päivän (tai 90 suorituksen) välein: 12 adaptiivista tehtävää (vaikeus seuraa vastauksia), yksi kirjoitus ja yksi puhe. Testitulos painaa tasoarviossa 65 %. Jos testi myöhästyy yli 3 päivää, harjoittelu lukittuu testiin asti.

**Puhe.** Selaimen puheentunnistus (Chrome, Edge, Safari) litteroi vastauksen; Firefoxissa vastaus kirjoitetaan aikarajan sisällä. Mallivastaukset voi kuunnella ja toistaa ääneen (shadowing).

## Tiedostot

| Tiedosto | Sisältö |
|---|---|
| `js/data.js` | Tehtäväpankki (166 tehtävää) ja virhetyypit |
| `js/engine.js` | Taitoluokitus, trendit, kertaus, suunnitelma, adaptiivinen testi |
| `js/ai.js` | Gemini / OpenAI-yhteensopiva arviointi ja tehtävägeneraattori |
| `js/sync.js` | Gist- ja Supabase-synkronointi, historian yhdistäminen |
| `js/app.js` | Käyttöliittymä |
| `sw.js` | Offline-tuki |

Omia tehtäviä voi lisätä `js/data.js`-tiedostoon samassa muodossa.
