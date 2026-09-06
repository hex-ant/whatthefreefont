# What the Free Font

Rozpoznawanie fontów z obrazów, wyłącznie w katalogu Google Fonts. Nuxt 4 / Vue 3,
TypeScript, pnpm. Całe przetwarzanie obrazu, OCR i dopasowanie odbywa się w
przeglądarce. Build zawiera wyłącznie pliki statyczne.

## Uruchomienie

Wymagane: Node.js 22+ i pnpm.

```sh
pnpm install
pnpm dev
```

Produkcja:

```sh
pnpm build
pnpm preview
```

Na dowolny hosting statyczny/CDN wgraj **wyłącznie `.output/public`**. Nie potrzeba
Node.js na hostingu, konta, kluczy, API, funkcji serwerowych ani bazy danych.
`nuxt generate` wykonuje pracę serwera jedynie podczas budowania projektu.

Dla hostingu w podkatalogu ustaw `NUXT_APP_BASE_URL=/nazwa/` podczas budowania.
Wymagane jest HTTP(S), nie otwieranie pliku `index.html` przez `file://`.

## Funkcje

- Upload, drag & drop, wklejanie obrazu ze schowka; przykłady gotowe do sprawdzenia.
- Wykrywanie i odczyt tekstu: PaddleOCR PP-OCRv6 small przez ONNX Runtime Web,
  z Tesseract.js (angielski + polski) jako alternatywą i automatycznym fallbackiem.
- Wybór wykrytego napisu; rysowanie, przesuwanie i skalowanie ramki myszą lub
  dotykiem. Strzałki przesuwają ramkę, Alt + strzałki zmieniają rozmiar, Shift
  zwiększa krok. Shift + przeciągnięcie rysuje nową ramkę.
- Ręczna korekta tekstu, obrotu, sposobu oddzielenia tła i progu kontrastu.
- Automatyczne prostowanie, sprawdzanie orientacji 180°, normalizacja skali i koloru.
- Porównanie napisów z tolerancją na tracking, kerning i odstępy między słowami.
- Osiem propozycji z podglądem własnego tekstu, względnymi prawdopodobieństwami,
  podobnymi rodzinami, kopiowaniem nazwy i linkiem do Google Fonts.
- Postęp i częściowe wyniki, zatrzymanie analizy, obsługa błędów pobierania;
  zmiana parametrów unieważnia poprzednie wyniki.

## Architektura

```text
obraz → ramka → OCR / potwierdzony tekst
                ↓
       maska koloru + korekta kąta
                ↓
       statyczne indeksy użytych znaków
                ↓
       ranking rodzin / odmian
                ↓
       renderowanie kandydatów w przeglądarce
                ↓
       elastyczne porównanie + kształt liter
                ↓
       dodatkowe odmiany najlepszych rodzin → wyniki
```

**Katalog:** snapshot `google-font-metadata@6.0.8`, 1908 rodzin, 7543 rzeczywiste
kombinacje grubości i stylu. Manifest zawiera wersjonowane adresy statycznych
plików Google `fonts.gstatic.com`. Aplikacja nie odpytuje Google Fonts API,
Fontsource API ani Hugging Face Inference API.

**Indeks:** 137 znaków (ASCII, polskie znaki i często używane znaki rozszerzonego
alfabetu łacińskiego), osobny plik `.bin.gz` na znak. Każdy rekord zawiera siatkę
16 × 24, proporcje glifu i wysokość. Pobierane są tylko indeksy potrzebne dla
napisu, maksymalnie 14 różnych znaków. Wszystkie odmiany są oceniane w indeksie;
do droższego renderowania trafia lista kandydatów. Dla tekstów poza indeksem
uruchamiane jest szersze porównanie fontów odpowiedniego alfabetu, bez oceny
fontów, które go nie obsługują. Statyczna, skompresowana mapa `cmap` każdej
odmiany weryfikuje obecność wszystkich wpisanych znaków, żeby fallback
przeglądarki nie udawał dopasowania do fontu.

**Dopasowanie:** normalizacja względem dominującego koloru tła, projekcyjna
estymacja kąta, redukcja pustych kolumn i dynamic time warping (DTW). Dodatkowe
porównanie kształtów liter jest używane, kiedy można je wiarygodnie rozdzielić.
Kandydaci są renderowani na kolorach próbki, co ogranicza różnice wygładzania.
Porównujemy tekst z naturalnym składem oraz rozdzielonymi znakami. Przy
połączonych literach przeszukiwana jest też szersza pula krojów pisankowych i
ozdobnych. Najlepsze rodziny są sprawdzane w dodatkowych grubościach i stylach.
Najsilniejsi kandydaci są ponownie renderowani w rozmiarach zbliżonych do próbki,
ponieważ hinting i wygładzanie zmieniają się wraz z fizycznym rozmiarem liter.

**Wydajność:** dopasowanie działa w Web Workerze z OffscreenCanvas. OCR również
wykorzystuje worker. WASM działa jednowątkowo, więc hosting nie wymaga nagłówków
COOP/COEP. Dla alfabetu łacińskiego pobieramy małe podzbiory WOFF2; kompletne TTF
są używane, gdy potrzebny jest inny alfabet. Pierwsze użycie pobiera więcej
zasobów; kolejne mogą korzystać ze zwykłego cache HTTP przeglądarki/CDN.

**Zasoby:** indeksy są w `public/catalog`, modele OCR w `public/models`.
Wagi modeli, ich źródła, licencja i SHA-256 są opisane obok plików. Silniki OCR i
WASM są przypięte do konkretnych wersji. Obraz jest przekazywany wyłącznie
wewnętrznym workerom przez `postMessage`, nigdy do serwera.

## Co oznaczają procenty

To względne prawdopodobieństwa **wśród wyświetlonych propozycji**, uzyskane z
odległości wizualnych przez softmax. To nie jest skalibrowana, absolutna pewność
identyfikacji ani ocena prawdopodobieństwa, że font w ogóle znajduje się w
Google Fonts. Krótkie napisy mogą być nierozróżnialne w wielu rodzinach.
Rodziny o identycznych deskryptorach badanych znaków mogą być grupowane w
jednej propozycji, z linkami do podobnych krojów.

Aplikacja zgłasza niewielkie podobieństwo i niepełne wyniki pobierania. Nie
obiecuje skuteczności dla dowolnego obrazu: perspektywa, mocne rozmycie,
zasłonięte znaki, skomplikowane tło, skrajnie nachodzące litery, osie variable
fontów inne niż sprawdzane odmiany oraz fonty spoza snapshotu pozostają
ograniczeniami. Najlepsze wejście to jedna czytelna linia jednego kroju pisma
z poprawnie wpisaną treścią. Maksymalna długość próbki wynosi 80 znaków.

## Testy i eksperymenty

```sh
pnpm test
pnpm typecheck
pnpm test:assets
pnpm benchmark
pnpm exec tsx scripts/check-index.ts
```

Testy przeglądarkowe wymagają Chrome. Najpierw zbuduj i udostępnij `.output/public`
na porcie 4173, np. `python3 -m http.server 4173 --directory .output/public`:

```sh
pnpm exec tsx scripts/browser-check.ts
pnpm exec tsx scripts/ocr-check.ts
pnpm exec tsx scripts/heldout-check.ts
pnpm test:interactions
```

Testy UI i OCR można uruchomić także z `BROWSER=webkit` po zainstalowaniu
silnika przez `pnpm exec playwright install webkit`.

Wyniki i opis metod znajdują się w `docs/benchmarks`. PoC porównuje zwykłą
odległość obrazów, dopasowanie pojedynczych glifów, DTW i ich połączenie.
Osobny zestaw sprawdza cały statyczny pipeline na rodzinach i napisach innych
niż w pierwszym PoC. Test OCR celowo czyści pole tekstowe przed odczytem.
To testy syntetyczne; nie należy przedstawiać ich jako skuteczności na dowolnych
zdjęciach użytkowników. Przeglądarkowe testy potwierdzają również brak żądań
wysyłających dane oraz mobilny układ strony.

## Aktualizacja katalogu

```sh
pnpm catalog
```

Ten **skrypt budowania**, uruchamiany lokalnie, pobiera fonty Google, weryfikuje
obecność znaków przez fontkit i renderuje indeks. Pełne TTF są cache'owane w
`.cache/fonts` (poza Gitem; kilka GB). Nie są potrzebne do uruchomienia gotowej
strony. Niekompletne pliki cache są pobierane ponownie. Przykład naprawy wpisów:

```sh
CATALOG_REPAIR=1004,1005 pnpm catalog
```

Po aktualizacji wersji `google-font-metadata` wykonaj **pełną** przebudowę.
Nie mieszaj manifestu i indeksów z różnych generacji. Wgraj kompletny katalog
atomowo lub do nowego prefiksu wersji CDN. `public/catalog/build-report.json`
musi mieć pustą listę błędów. Testowe `CATALOG_LIMIT` służy wyłącznie do małych
lokalnych PoC i zastępuje katalog — nie używaj go w buildzie produkcyjnym.

## Najważniejsze pliki

- `app/lib/image.ts` — przetwarzanie obrazu i metryki podobieństwa.
- `app/lib/ranking.ts` — wstępny ranking i względne prawdopodobieństwa.
- `app/workers/matcher.worker.ts` — cały pipeline wyszukiwania.
- `app/lib/ocr.ts` — detekcja, OCR i grupowanie słów w linie.
- `app/components/CropEditor.vue` — edytor ramki z obsługą klawiatury i dotyku.
- `scripts/build-catalog.ts` — odtwarzalna budowa zasobów statycznych.

Google Fonts: https://github.com/google/fonts
PaddleOCR: https://github.com/PaddlePaddle/PaddleOCR
Tesseract.js: https://github.com/naptha/tesseract.js
