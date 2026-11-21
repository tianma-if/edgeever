<div align="center">
  <h1>
    <img src="assets/brand/edgeever-icon.svg" alt="Logo EdgeEver" width="48" align="absmiddle" /> EdgeEver
  </h1>
  <p>
    <b>Natywna dla AI aplikacja do notatek oraz alternatywa dla Evernote/Obsidian. Błyskawiczna synchronizacja na wszystkich platformach, bogate notatki (tabele, mapy myśli, diagramy, plakaty), web clipper i MCP. W 100% bezpłatnie na Cloudflare lub przez Docker.</b>
  </p>
  <p>
    <a href="https://github.com/tianma-if/edgeever/stargazers"><img src="https://img.shields.io/github/stars/tianma-if/edgeever?style=social" alt="Gwiazdki na GitHubie" /></a>
    <a href="https://github.com/tianma-if/edgeever/network/members"><img src="https://img.shields.io/github/forks/tianma-if/edgeever?style=social" alt="Forki na GitHubie" /></a>
    <a href="https://github.com/tianma-if/edgeever/releases"><img src="https://img.shields.io/github/downloads/tianma-if/edgeever/total?style=social&amp;logo=github&amp;label=Release%20Downloads" alt="Pobrania plików wydań z GitHuba" /></a>
    <a href="https://github.com/tianma-if/edgeever/pkgs/container/edgeever"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fghcr-badge.elias.eu.org%2Fapi%2Ftianma-if%2Fedgeever%2Fedgeever&query=downloadCount&style=social&logo=docker&label=Docker%20Pulls" alt="Pobrania obrazu Docker" /></a>
    <a href="https://www.producthunt.com/products/edgeever?utm_source=other&utm_medium=social"><img src="https://img.shields.io/badge/Product%20Hunt-ea532a?style=social&logo=product-hunt" alt="Product Hunt" /></a>
    <a href="https://hellogithub.com/repository/tianma-if/edgeever" target="_blank"><img src="https://api.hellogithub.com/v1/widgets/recommend.svg?rid=150fee4403f6433880bda91e9576ac06&claim_uid=TWNAjisURpnhL1l&theme=small" alt="Wyróżnienie HelloGitHub" /></a>
    <a href="#wsparcie-projektu"><img src="https://img.shields.io/badge/Sponsor-EdgeEver-ea4aaa?logo=github-sponsors" alt="Wsparcie projektu" /></a>
  </p>
  <p>
    <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a> | <a href="README.ja.md">日本語</a> | <b>Polski</b> | <a href="README.ru.md">Русский</a>
  </p>
  <p>
    <a href="https://t.me/+GvKYnL37feUwOTNl"><img src="assets/readme/community/telegram.svg" alt="Telegram" width="16" height="16" align="absmiddle" /> Grupa na Telegramie</a> &nbsp;|&nbsp;
    <a href="https://demo.edgeever.org">🌐 Demo na żywo</a> &nbsp;|&nbsp;
    <a href="https://github.com/users/tianma-if/projects/1">🗺️ Plan rozwoju</a> &nbsp;|&nbsp;
    <a href="#aplikacje-i-rozszerzenia">📱 Aplikacje i rozszerzenia</a> &nbsp;|&nbsp;
    <a href="#features">Macierz funkcji i zastosowań</a> &nbsp;|&nbsp;
    <a href="docs/note-migration-guide.en-US.md">📥 Migracja notatek</a>
  </p>
  <p align="center">
    <img src="assets/readme/edgeever-hero-v8-en.png" alt="Podgląd przestrzeni roboczej EdgeEver" width="800" />
  </p>
</div>

EdgeEver to nowoczesna, otwartoźródłowa przestrzeń do notatek i zarządzania wiedzą. Zachowuje wygodę klasycznego, wysoce efektywnego układu trzech paneli (drzewo katalogów · lista notatek · edytor), a jednocześnie daje kontrolę nad danymi i bezpośrednią współpracę z agentami AI.

> 💡 **Bez serwera i bez opłat w ramach darmowego planu**
> EdgeEver może działać w darmowym planie Cloudflare, bez kupowania i utrzymywania serwera. Jeśli wolisz VPS, NAS lub serwer domowy, tę samą aplikację możesz wdrożyć przez Dockera.

> ⭐ Jeśli EdgeEver Ci się przydaje, zostaw gwiazdkę na GitHubie. Dzięki temu więcej osób znajdzie projekt.

## Dlaczego EdgeEver?

Wielu użytkowników **aplikacji do notatek i osobistych baz wiedzy** szuka po prostu **niezawodnej, otwartej i szybkiej** osobistej bazy wiedzy. Popularne rozwiązania mają jednak swoje ograniczenia:

* **Evernote**: Oferuje najpłynniejszą i najbardziej bezproblemową synchronizację w chmurze między wieloma urządzeniami. Z czasem stało się jednak rozbudowanym komercyjnym pakietem: przybyło reklam i dodatków, wzrosło zużycie zasobów, ograniczono darmowy plan, a zaawansowane funkcje AI są kosztowne. Trudno też połączyć je z samodzielnie hostowanymi usługami i prywatnymi procesami AI.
* **Obsidian**: Otwarte pliki Markdown, lecz zamknięty kod rdzenia. Oficjalna synchronizacja wymaga stałej subskrypcji zależnej od pojemności i liczby skarbców, a rozwiązania zewnętrzne (iCloud, WebDAV, Git itp.) są żmudne i podatne na konflikty; ograniczona mechaniką synchronizacji lokalnych katalogów oraz restrykcjami tła na urządzeniach mobilnych, trudno jej dorównać płynności chmurowych aplikacji do notatek (brak też pełnej wersji webowej). Lokalne skanowanie powoduje wyraźne spowolnienia przy zimnym starcie i wyszukiwaniu przy tysiącach notatek lub wielu wtyczkach, a przechowywanie załączników razem z tekstem powiększa skarbiec, spowalnia synchronizację mobilną i zostawia osierocone pliki. W połączeniu z interfejsem przypominającym IDE i progiem wejścia związanym z dobieraniem wtyczek jest to rozwiązanie zbyt ciężkie do szybkiego, bezproblemowego notowania w dowolnym miejscu.
* **Joplin**: Zasłużona, otwartoźródłowa aplikacja z układem trzech paneli, jednak jej interfejs i wygoda edycji sprawiają wrażenie zatrzymanych kilkanaście lat temu, bez nowoczesnej lekkości i dopracowania. Szybka oficjalna synchronizacja (Joplin Cloud) wymaga płatnej subskrypcji; darmowa synchronizacja przez WebDAV lub dyski chmurowe odpytuje pliki pojedynczo i zwalnia na urządzeniach mobilnych wraz ze wzrostem liczby notatek i załączników, natomiast własny Joplin Server wymaga utrzymywania serwera bez darmowej opcji serverless. Brakuje też pełnej przestrzeni roboczej w przeglądarce oraz natywnej obsługi agentów AI (MCP/ACP).
* **Memos i notatki strumieniowe**: Są proste, ale interfejs przypominający oś czasu różni się od uporządkowanej pracy w trzech panelach.
* **SiYuan i systemy oparte na blokach**: Oferują wiele funkcji i własny hosting, jednak ich interfejs oraz interakcja przypominają bardziej rozbudowane bazy wiedzy w stylu Obsidiana niż intuicyjny układ trzech paneli znany z tradycyjnych komercyjnych notatników chmurowych, a szczegółowa struktura bloków dodatkowo utrudnia szybkie zapisywanie myśli i pisanie dłuższego tekstu. Brakuje im również bezpłatnego wdrożenia bezserwerowego, a synchronizacja między urządzeniami wymaga płatnej subskrypcji lub dodatkowo płatnego dostępu do S3/WebDAV.

**EdgeEver wypełnia tę lukę**: cały stos ma otwarty kod, zapewniając w pełni **płynną, błyskawiczną synchronizację w chmurze o niskim opóźnieniu między wieloma urządzeniami** oraz pełną swobodę bezpłatnego hostingu. Zachowuje znany układ trzech paneli, działa sprawnie nawet przy ponad 10 000 notatek i oferuje natywną współpracę z agentami AI oraz możliwość bezpłatnego wdrożenia.

## Demo online

- Demo: [https://demo.edgeever.org](https://demo.edgeever.org)

Publiczne demo resetuje się codziennie o 3:00 czasu chińskiego (UTC+8) i przywraca przykładowe notatki. Nie zapisuj w nim prywatnych danych.

## Aplikacje i rozszerzenia

### Pobierz aplikacje

<p>
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/macos.svg" alt="Pobierz EdgeEver na macOS" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/windows.svg" alt="Pobierz EdgeEver na Windows" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/tux.svg" alt="Pobierz wersję Preview EdgeEver AppImage na Linux x86_64" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://play.google.com/store/apps/details?id=org.edgeever.mobile&hl=pl"><img src="assets/readme/platforms/google-play.svg" alt="Pobierz EdgeEver na Androida z Google Play" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://apps.apple.com/pl/app/edgeever/id6792625631"><img src="assets/readme/platforms/app-store.svg" alt="Pobierz EdgeEver na iOS z App Store" width="40" height="40" /></a>
</p>

> Aplikacja na iOS wymaga Apple ID spoza Chin kontynentalnych.

### Rozszerzenie Web Clipper

<p>
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/chrome/chrome.svg" alt="Zainstaluj EdgeEver Web Clipper w Chrome" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/edge/edge.svg" alt="Zainstaluj EdgeEver Web Clipper w Edge" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://addons.mozilla.org/firefox/addon/edgeever-web-clipper/"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/firefox/firefox.svg" alt="Zainstaluj EdgeEver Web Clipper w Firefoxie" width="36" height="36" /></a>
</p>

- Przekształca artykuły w przejrzysty Markdown, zapisuje zaznaczony tekst i obrazy lub przechwytuje wybrane obszary stron bezpośrednio w Twojej instancji.
- Głębokie, ustrukturyzowane zapisywanie treści z ponad 20 platform: społecznościowych (X, Xiaohongshu, Instagram, WeChat, Jike, Douban, Threads, Bluesky), serwisów czytelniczych i technicznych (Zhihu, Reddit, GitHub, V2EX, Hacker News, Medium, Substack) oraz wideo i podcastów (Bilibili, YouTube, Xiaoyuzhou).

<a id="features"></a>
## Macierz funkcji i zastosowań

Wszechstronny obszar roboczy łączący zbieranie inspiracji, głębokie tworzenie i gromadzenie wiedzy (👉 **[Zobacz wszystkie 20 scenariuszy ze zrzutami ekranu](docs/best-practices.md)**):

| Moduł | Kluczowe możliwości i funkcje |
| :--- | :--- |
| **Pisanie, edycja i wyszukiwanie** | • **Imersyjny edytor dwutrybowy**: Układ 3 paneli z regulowaną szerokością, natychmiastowe przełączanie między edytorem wizualnym (WYSIWYG) a Markdownem, wbudowana galeria szablonów, wzory matematyczne i chemiczne, podświetlanie składni, zapamiętywanie zwijania konspektu oraz historia zmian<br>• **Własna typografia i personalizacja**: Dostosowuj okładki, nawigację po rozdziałach, palety kolorów tekstu, ramki obrazów typu Polaroid i odstępy dla notatnika lub pojedynczej notatki<br>• **Nieskończona hierarchia i wyszukiwanie w milisekundach**: Drzewa folderów bez limitu głębokości, tagi, sortowanie przeciąganiem, grupowe łączenie i przenoszenie notatek oraz natychmiastowe wyszukiwanie pełnotekstowe z filtrami historii<br>• **Wiele okien na desktopie i duże załączniki**: Edycja w wielu oknach i automatyczny zapis załączników edytowanych zewnętrznie; kompresja obrazów o 50–90% po stronie klienta oraz strumieniowe przesyłanie plików do 1 GiB |
| **Bogate notatki multimodalne i wizualizacje** | • **Wielowymiarowe tabele AI i formularze publiczne**: Tworzenie baz danych z promptu z nazwanymi widokami, wielowarunkowym filtrowaniem, sortowaniem po wielu polach i klikalnymi linkami w komórkach; publikowanie formularzy zbierania danych bez logowania jednym kliknięciem<br>• **Mapy myśli i diagramy architektury AI**: Interaktywne mapy myśli oraz diagramy Mermaid na żywo (schematy blokowe, sekwencji i architektury) generowane w rozmowie z AI<br>• **Infografiki AI**: Konwersacyjne generowanie jednym kliknięciem osi czasu, macierzy porównawczych, wykresów ćwiartkowych i kart wizualnych<br>• **Natywne notatki plakatowe na płótnie**: Wbudowany format wizualnych kart na płótnie edytowanych dwuklikiem do tworzenia okładek i grafik społecznościowych |
| **Wszechkanałowe zbieranie i migracja** | • **Web Clipper i 20+ platform**: Wyodrębnianie artykułów, wycinanie zaznaczeń tekstu/obrazów lub obszarów stron; dedykowane parsery dla Xiaohongshu, X, Instagrama, Zhihu, Reddita, GitHuba, YouTube, Bilibili i innych<br>• **Udostępnianie mobilne i szybkie zrzuty ekranu**: Zapisuj zdjęcia i artykuły z menu udostępniania w telefonie; przechwytuj wybrane obszary ekranu na desktopie skrótem globalnym wprost do notatki<br>• **Archiwizacja rozmów WeChat**: Importuj połączone rozmowy WeChat na telefonie lub komputerze jednym kliknięciem ze znacznikami czasu, cytatami, emotikonami i multimediami<br>• **Migracja jednym kliknięciem z innych aplikacji**: Natywny import przez GUI z Evernote, Obsidian, Notion, SiYuan, flomo, Joplin oraz folderów Markdown z zachowaniem struktury i załączników |
| **Stylowa publikacja i udostępnianie wiedzy** | • **Samodzielne witryny bazy wiedzy**: Publikuj całe notatniki jednym kliknięciem jako samodzielne statyczne strony z nawigacją drzewiastą i opcjonalną ochroną hasłem<br>• **Linki udostępniania pojedynczych notatek**: Udostępniaj notatki z własnym adresem, hasłem, datą wygaśnięcia, licznikiem wyświetleń, zwijanym konspektem, kodem QR i linkiem Raw Markdown<br>• **Kopiuj jako tekst sformatowany**: Zachowuje formatowanie i obrazy do bezpośredniego wklejenia w WeChat, Substack, Medium, na blogi i do innych edytorów<br>• **Eksport długich grafik i wielu formatów**: Dopracowane szablony długich grafik i awatary monogramowe; eksport do obrazów wysokiej rozdzielczości, kart kodu, MD, HTML i PDF |
| **AI i współpraca z agentami** | • **Towarzyszący asystent AI i BYOK**: AI w panelu bocznym do streszczeń, korekty, tłumaczeń i wieloczęściowego kontynuowania długich tekstów; zgodność z OpenAI, Anthropic, Gemini i własnymi endpointami z kontrolą budżetu wyjściowego<br>• **Natywne protokoły agentów (MCP i ACP)**: Wbudowany Remote MCP ze szczegółowymi uprawnieniami odczytu/zapisu dla poszczególnych notatników; ACP na desktopie do bezpośredniej współpracy z lokalnymi agentami, takimi jak Codex, Claude Code, Antigravity, CodeBuddy i WorkBuddy<br>• **Transkrypcja audio i wideo AI**: Wyodrębnianie i podział ścieżki dźwiękowej po stronie klienta oraz bezpośrednie połączenie z modelami mowy zgodnymi z OpenAI do transkrypcji i wstawiania tekstu do notatek |
| **Ekosystem wtyczek i motywów** | • **Oficjalny marketplace i synchronizacja między urządzeniami**: Instalacja rozszerzeń jednym kliknięciem z oficjalnego marketplace, repozytoriów GitHub lub adresu manifestu z automatyczną synchronizacją między przeglądarką a aplikacją desktopową<br>• **Pełne API wtyczek (`@edgeever/plugin-api`)**: Programowy dostęp do notatek, szablonów, załączników, zaznaczeń i bloków osadzonych (Embeds) edytora, paneli bocznych (Panels), poleceń globalnych, wbudowanego AI oraz zadań cyklicznych na desktopie<br>• **Motywy bez kodu i ustawienia zarządzane przez hosta**: Deklaratywne pakiety motywów JSON bez wykonywania skryptów, formularze ustawień renderowane przez aplikację, izolowany magazyn klucz-wartość i szyfrowane zarządzanie sekretami (Secrets) |
| **Synchronizacja i fundament self-hosted** | • **Natychmiastowa synchronizacja wieloplatformowa i offline-first**: Oficjalne aplikacje na Web, macOS, Windows, Linux, iOS i Android bez limitu urządzeń; płynne pisanie offline z synchronizacją przyrostową, oparte na SQLite i bezstratnym imporcie/eksporcie ZIP<br>• **Bezserwerowe zero kosztów i self-hosting Docker**: 100% darmowego działania w planie Cloudflare Free (~150 tys. krótkich notatek i ~50 tys. obrazów) lub wdrożenie tej samej bazy kodu jednym kliknięciem na VPS / NAS przez Dockera<br>• **Rozszerzenia pamięci i hosting obrazów**: Magazyn obiektowy zgodny z S3 (OSS) na instancję; bezpośrednie wysyłanie przez PicGo / PicList na desktopie oraz CloudFlare ImgBed w przeglądarce i na desktopie<br>• **Automatyczne kopie zapasowe i bezpieczeństwo enterprise**: Zaplanowane lokalne kopie (wiele migawek, szyfrowanie `.edgeever.enc` i replikacja WebDAV); fizyczna izolacja wielu kont, ochrona przed brute-force, TOTP 2FA i zarządzanie sesjami |

## Wdrożenie

Cloudflare to zalecana opcja bez własnego serwera. Docker jest dostępny dla osób korzystających z VPS, NAS lub serwera domowego. Szczegółowe przewodniki wdrożenia są obecnie dostępne po angielsku.

W przypadku Cloudflare wybierz jedną z poniższych metod wdrożenia online:

### Opcja A: Wdrożenie z agentem AI (zalecane)

Skopiuj poniższe polecenie do agenta AI, na przykład Codex, Claude Code, DeepSeek Harness, WorkBuddy lub Antigravity. Gdy agent poprosi o dostęp do GitHuba lub Cloudflare, sprawdź żądane uprawnienia i postępuj zgodnie z instrukcjami autoryzacji.

```text
Wdróż EdgeEver przez GitHub i Cloudflare:
1. Utwórz Fork repozytorium https://github.com/tianma-if/edgeever.
2. Utwórz bazę D1 `edgeever` i zasobnik R2 `edgeever-resources` w Cloudflare.
3. W Workers & Pages wybierz „Start with Hello World!” i utwórz Worker o nazwie `edgeever`.
4. W Settings → Variables and Secrets dodaj wybrane hasło jako sekret środowiska
   uruchomieniowego `EDGE_EVER_AUTH_PASSWORD` i kliknij Deploy (zalecane co najmniej
   32 znaki). Domyślna nazwa użytkownika to `admin`.
5. Po wdrożeniu sekretu otwórz Settings → Builds → Connect tego Workera i podłącz
   gałąź `main` Forka.
6. W Settings → Builds → API token tego Workera wybierz lub utwórz token API Cloudflare do wdrażania, z uprawnieniami do odczytu i edycji D1 na koncie docelowym.
7. W repozytorium Forka na GitHubie otwórz Actions → Update deployed EdgeEver, włącz workflow, jeśli pojawi się monit,
   i wybierz Run workflow dla gałęzi `main`. Po potwierdzeniu w Cloudflare, że odpowiedni build zakończył się sukcesem, a wdrożenie zostało ukończone, sprawdź `/api/health` i `/api/openapi.json`, a następnie
   zweryfikuj logowanie nazwą administratora i hasłem.
   Ten workflow będzie automatycznie synchronizować kolejne stabilne wersje i poprawki.
```

> Szczegółowe wymagania: [wdrożenie Cloudflare z agentem AI](docs/agent-deploy-cloudflare.md).

### Opcja B: Ręczne wdrożenie online

<details>
<summary>📖 Rozwiń: 7 kroków konfiguracji ręcznej w przeglądarce</summary>

Wykonaj poniższe siedem kroków w przeglądarce ściśle w podanej kolejności:

1. **Utwórz Fork repozytorium**: Kliknij **Fork** w prawym górnym rogu strony GitHub, aby utworzyć kopię EdgeEver na swoim koncie.
2. **Utwórz zasoby Cloudflare**: Utwórz bazę D1 `edgeever` i zasobnik R2 `edgeever-resources`.
3. **Utwórz Workera**: W Cloudflare Workers & Pages wybierz Create application → Start with Hello World!, nazwij Workera `edgeever` i wdróż go. To usługa tymczasowa; EdgeEver zostanie wdrożony w kroku 7.
4. **Ustaw hasło administratora**: W Settings → Variables and Secrets Workera dodaj `EDGE_EVER_AUTH_PASSWORD` jako typ Secret i kliknij Deploy. Wartością jest wybrane hasło logowania, najlepiej co najmniej 32 znaki. Zrób to przed podłączeniem Forka.
5. **Podłącz Fork**: W Settings → Builds → Connect istniejącego Workera wybierz Fork i gałąź produkcyjną `main`.
6. **Skonfiguruj uprawnienia wdrożenia**: W Settings → Builds → API token tego Workera wybierz lub utwórz token API Cloudflare do wdrażania, z uprawnieniami do odczytu i edycji D1 na koncie docelowym.
7. **Zbuduj i sprawdź**: W repozytorium Forka na GitHubie otwórz Actions → Update deployed EdgeEver, włącz workflow, jeśli pojawi się monit, i wybierz Run workflow dla gałęzi `main`. Po potwierdzeniu w Cloudflare, że odpowiedni build zakończył się sukcesem, a wdrożenie zostało ukończone, sprawdź, czy `/api/health` zwraca `200`, i zweryfikuj logowanie. Ten workflow będzie automatycznie synchronizować kolejne stabilne wersje i poprawki.

> Pełne instrukcje i konfigurację znajdziesz w [przewodniku wdrożenia online](docs/deploy-cloudflare-button.md).

</details>

<details>
<summary>📌 Uwagi dotyczące wdrożenia na Cloudflare (własna domena i darmowy limit R2)</summary>

> **Domena i dostęp**: Możesz użyć domyślnej domeny `*.workers.dev` lub podłączyć własną w ustawieniach Workera: **Settings → Domains & Routes**.
>
> **Aktywacja Cloudflare R2**: Choć [darmowy limit przestrzeni R2](https://developers.cloudflare.com/r2/pricing/#free-tier) wystarcza na typowe notatki, najpierw trzeba aktywować subskrypcję R2 i dodać metodę płatności. Cloudflare [obsługuje](https://developers.cloudflare.com/billing/get-started/update-billing-info/#supported-payment-methods) karty UnionPay, Visa i Mastercard oraz PayPal, Apple Pay i Google Pay.

</details>

### Opcja C: Docker na VPS lub NAS

Wariant Docker używa tego samego interfejsu, tras API, usług, uwierzytelniania, implementacji MCP i migracji co Cloudflare. Kontener korzysta z SQLite oraz plików lokalnych lub magazynu zgodnego z S3 i obsługuje architektury `amd64` oraz `arm64`. Zobacz [wdrożenie EdgeEver przez Dockera](docs/deploy-docker.md) oraz [architekturę własnego hostingu](docs/self-hosting-architecture.md).

Użyj instalatora hostowanego w GitHubie i oficjalnego obrazu GHCR:

```sh
curl -fsSL https://edgeever.org/install.sh | bash
```

Polecenie pobiera najnowszy obraz, generuje hasło administratora i uruchamia EdgeEver przez Docker Compose.

Ręczne wdrożenie i konfigurację opisuje [przewodnik po Dockerze](docs/deploy-docker.md).

Po instalacji aktualizacje domyślnie uruchamiają się codziennie. Aby zaktualizować aplikację ręcznie, uruchom `~/edgeever/update.sh` na serwerze.

---

## Zaawansowana konfiguracja i zarządzanie

### Kopia zapasowa, eksport i migracja danych

Zarówno przy codziennych kopiach zapasowych, bezproblemowej migracji między instancjami, jak i przenoszeniu notatek z innych platform, EdgeEver zapewnia niezawodny i pełny transfer danych:

- **Natywne kopie zapasowe i przywracanie EdgeEver**: W aplikacji w **Profil → Import i eksport** można w każdej chwili wyeksportować lub zaimportować archiwum ZIP EdgeEver. Rozpakowany katalog `notes/` zawiera bezpośrednio czytelne pliki Markdown oraz załączniki do lokalnego archiwizowania, a wewnętrzne dane strukturalne pozwalają na bezstratne i pełne odtworzenie bazy na innej instancji EdgeEver. Podczas importu zachowywane są istniejące, niezwiązane dane na instancji docelowej, a rekordy o tych samych identyfikatorach są automatycznie aktualizowane.
- **Automatyczne harmonogramowane kopie i replikacja WebDAV na desktopie**: W ustawieniach **Kopia zapasowa i import** aplikacji desktopowej możesz włączyć cykliczne lokalne kopie zapasowe (co tydzień lub co miesiąc) z własnym katalogiem i liczbą przechowywanych migawek — przy zmianie treści tworzone jest archiwum ZIP lub szyfrowane `.edgeever.enc`, które po zakończeniu lokalnej kopii może być automatycznie wysyłane przez WebDAV na serwer NAS lub kompatybilną przestrzeń.
- **Płynna migracja z innych platform**: Niezależnie od tego, czy importujesz jednym kliknięciem przez natywny interfejs graficzny w przeglądarce i aplikacji desktopowej (obsługujący pełne notatki, hierarchie i załączniki z Evernote, Obsidian, Notion, SiYuan, flomo, Joplin oraz plików i folderów Markdown), czy migrujesz z Memos i innych baz wiedzy za pomocą AI Agent & MCP, EdgeEver zapewnia bezproblemowy i weryfikowalny transfer danych. Zobacz [Przewodnik migracji notatek z innych platform](docs/note-migration-guide.en-US.md).

### Integracja z AI i protokołem MCP

Utwórz token API w **Profil → API / MCP** (z uprawnieniami dla całej przestrzeni lub szczegółowym dostępem do odczytu/zapisu dla wybranych notatników) i skopiuj konfigurację Remote MCP jednym kliknięciem. Agenci AI, tacy jak Claude Code, Codex, DeepSeek Harness i Antigravity, będą mogli bezpiecznie zarządzać Twoją bazą wiedzy w zakresie przyznanych uprawnień. EdgeEver obsługuje pełne tworzenie, odczyt, edycję i usuwanie notatek tekstowych, diagramów (map myśli, schematów blokowych i diagramów architektury), tabel strukturalnych oraz natywnych notatek plakatowych. Agenci mogą też zarządzać strukturą notatników, tagami, załącznikami, historią wersji, szablonami i instrukcjami AI.

Konfigurację klientów, poziomy dostępu tokenów, rozwiązywanie problemów i przykładowe reguły dla agentów opisuje [Using EdgeEver with MCP clients](docs/mcp-guide.md) (po angielsku).

> 💡 **Inspiracja:**
> Użyj AI jako pomocnika w porządkowaniu wiedzy: zamieniaj pomysły w interaktywne mapy myśli, diagramy i tabele, dostarczając agentom własny kontekst. Edytor tekstu sformatowanego i typografia EdgeEver pomagają dopracować wynik do postaci gotowej do publikacji.

### Logowanie wielu użytkowników i zarządzanie miejscem

Jedna instancja obsługuje wiele kont.

Administrator może tworzyć i wyłączać konta oraz resetować ich hasła w **Profil → Członkowie**. Każdy użytkownik otrzymuje odizolowaną przestrzeń z notatnikami, notatkami, załącznikami, Koszem, importem i eksportem oraz tokenami MCP. Przejrzysty panel zużycia miejsca pozwala na bieżąco monitorować przestrzeń zajmowaną przez załączniki w całej instancji i na poszczególnych kontach.

### Rozszerzenia pamięci masowej i zewnętrzny hosting obrazów

- **Magazyn obiektów OSS**: Właściciel instancji może skonfigurować magazyn zgodny z S3 w **Profil → Zaawansowane → Magazyn obiektów OSS**. Zmiana magazynu nie przenosi istniejących załączników ani ich nie modyfikuje.
- **Integracja z PicGo na komputerze**: Aplikacja desktopowa może przekazać wstawiane obrazy do PicGo lub PicList na tym komputerze albo na innej zaufanej maszynie, na przykład NAS. Serwer wysyła je do GitHuba, SM.MS, Upyun, Qiniu lub własnego hostingu. Adres musi tylko kończyć się na `/upload`, więc działa też PicList za odwrotnym proxy.
- **CloudFlare ImgBed na komputerze i w przeglądarce**: Przesyłaj obrazy bezpośrednio do własnego [CloudFlare ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) z tokenem API. Foldery obsługują `{Y}/{m}/{d}` i `{memoId}`. W przeglądarce wymagane są HTTPS i CORS zezwalający na origin EdgeEver oraz nagłówek `Authorization`. Dane uwierzytelniające pozostają w bieżącej przeglądarce lub aplikacji komputerowej; obrazy nie są objęte kopiami zapasowymi EdgeEver.

### Wtyczki i motywy

Aplikacje Web i desktopowa obsługują wtyczki oraz własne motywy, instalowane z oficjalnego marketplace, GitHuba lub adresu manifestu i synchronizowane między urządzeniami. Programiści mogą rozszerzać aplikację przez `@edgeever/plugin-api`; zobacz [przewodnik tworzenia wtyczek](docs/plugin-development.md) i [zasady publikowania w marketplace](docs/plugin-marketplace-policy.md).

---

## Przewodnik dla deweloperów i współtworzenie

### Szybki start

```sh
bun install
bun run dev
```

W lokalnym środowisku deweloperskim logowanie następuje automatycznie. Nowa baza używa danych `owner` / `edgeever-local-dev`. Wyloguj się, aby sprawdzić ekran logowania.

### Architektura i stos technologiczny

#### Stos technologiczny

- Monorepo oparte na Bun z aplikacją Web, API, oficjalną stroną i pakietem współdzielonych typów.
- Interfejs: Vite, React, React Router, TanStack Query, Tailwind CSS, shadcn/ui i Radix UI.
- Edytor: TipTap / ProseMirror z obsługą Markdown.
- Android: Expo + React Native w `apps/mobile`, lokalny SQLite i synchronizacja przyrostowa.
- iOS: natywny SwiftUI w `apps/ios` (iOS 17+), dołączony EditorBundle TipTap, lokalna kopia i kolejka zmian GRDB.
- Desktop: Electron + proces pomocniczy Rust, SQLite do edycji offline, synchronizacji przyrostowej i lokalnych kopii zapasowych.
- Web Clipper: Manifest V3, Mozilla Readability i Turndown dla Chrome, Edge i Firefox.
- Backend: jedna aplikacja biznesowa Hono/Zod z REST API i Remote MCP. Cloudflare używa Workers/D1/R2, a Docker używa Bun/SQLite oraz plików lokalnych lub S3.
- Oficjalna strona: statyczna witryna Astro w `apps/site`, wdrażana niezależnie na Cloudflare Pages.

#### Struktura projektu

<details>
<summary>📁 Rozwiń, aby zobaczyć: Struktura projektu monorepo</summary>

```text
apps/web          Interfejs Vite + React, wersje robocze offline i kolejka synchronizacji
apps/extension    Rozszerzenie Web Clipper Manifest V3 dla Chrome/Edge/Firefox
apps/api          Cloudflare Worker + Hono API, punkt końcowy MCP
apps/mobile       Aplikacja Android Expo + React Native
apps/ios          Natywna aplikacja iOS SwiftUI (EditorBundle TipTap, GRDB)
apps/desktop      Powłoka Electron, most preload i pakowanie aplikacji
apps/site         Oficjalna strona Astro, wdrażana niezależnie
packages/client   Współdzielony klient API dla aplikacji Web i mobilnej
packages/shared   Współdzielone typy, schematy Zod, konwersja TipTap / Markdown
crates/desktop-sidecar
                  Proces pomocniczy Rust dla lokalnego SQLite, pracy offline, kopii i plików
scripts           Wrapper Wrangler, haszowanie haseł, CLI, most MCP stdio, import Evernote ENEX
migrations        Wspólne migracje D1/SQLite dopisywane bez zmiany wcześniejszych plików
docs              Dokumentacja architektury, migracji i wdrażania
.github/workflows CI dla Web, mobile, iOS, pakietów desktopowych, wdrożeń i wydań
wrangler.toml     Konfiguracja Cloudflare Workers, Assets, D1 i R2
```

</details>

#### Model przechowywania danych

EdgeEver przechowuje treść notatki jednocześnie w trzech formatach, aby pogodzić wydajność edycji, otwartość danych i szybkość wyszukiwania pełnotekstowego:

```text
content_json      Dokument TipTap/ProseMirror, autorytatywny format dla edytora
content_markdown  Format API, agentów, eksportu i integracji z zewnętrznym ekosystemem
content_text      Format do wyszukiwania pełnotekstowego, podsumowań i indeksowania
```

### Kluczowe mechanizmy i decyzje projektowe

- **Cicha kompresja po stronie klienta**: Aby uniknąć zużywania limitów obliczeniowych na środowiskach Serverless (np. Cloudflare Workers), kompresja obrazów odbywa się w całości w kliencie Web przed wysłaniem (konwersja PNG/JPEG/WebP/AVIF na WebP, ograniczenie dłuższego boku do 2560px; brak powiększenia rozmiaru zachowuje oryginał). Punkty końcowe REST API i MCP zapisują bezpośrednio oryginalną treść otrzymaną od klienta.
- **Offline-first i harmonogram synchronizacji**: Aplikacje Web i desktopowe przesyłają zmiany automatycznie po 30 sekundach braku aktywności w pisaniu, a przy widocznym oknie sprawdzają zmiany w chmurze co 5 minut. Ponowne przejście do aplikacji lub ręczne odświeżenie natychmiast synchronizuje dane. Wartości te można konfigurować przez `DEFERRED_MEMO_SYNC_DELAY_MS` i `BACKGROUND_WORKSPACE_REFRESH_INTERVAL_MS` w [`apps/web/src/lib/workspace-refresh.ts`](apps/web/src/lib/workspace-refresh.ts).

### Współtworzenie kodu

Serdecznie zapraszamy społeczność do współtworzenia projektu! Przed przesłaniem kodu pamiętaj o poniższych zasadach:

- Przed wniesieniem zmian przeczytaj [poradnik współtworzenia](CONTRIBUTING.md).
- **Izolacja wdrożenia i gałęzi**: Jeśli Twój GitHub Fork służy również do wdrożenia EdgeEver online, pozostaw jego gałąź `main` wyłącznie do wdrożeń. Do prac rozwojowych i pull requestów utwórz osobną gałąź od oficjalnego `upstream/main`; nie twórz zmian bezpośrednio na gałęzi `main` ani nie wykonuj na niej opcji Sync fork.

---

## Społeczność i opinie

- **Zgłaszanie uwag i propozycji**: Błędy, propozycje funkcji i pytania dotyczące wdrożenia zgłaszaj przez [GitHub Issues](https://github.com/tianma-if/edgeever/issues).

### Społeczność na Telegramie

Zapraszamy do społeczności EdgeEver, skupiającej twórców i pasjonatów vibe codingu oraz AI. Rozmawiajmy o nowoczesnej produktywności opartej na AI i sprawdzonych praktykach budowania osobistej bazy wiedzy.

👉 [Dołącz do grupy na Telegramie](https://t.me/+GvKYnL37feUwOTNl)

## Przyjazne linki

- [LINUX DO](https://linux.do/) — Społeczność wymiany wiedzy technicznej i projektów open source.

## Wsparcie projektu

EdgeEver jest darmowym projektem o otwartym kodzie. Rozwijanie aplikacji na różne platformy, testy na urządzeniach, podpisywanie kodu i utrzymywanie kilku środowisk uruchomieniowych wymagają czasu i środków.

- [Wesprzyj EdgeEver](docs/sponsor.md) — dobrowolne wpłaty przez WeChat Pay lub Alipay.
- [Sponsorzy i partnerzy](docs/partners.md) — wsparcie infrastruktury, narzędzi, usług i współpracy ze społecznością.

## Podziękowania

- Przy projektowaniu EdgeEver wzorowano się na publicznie dostępnych rozwiązaniach dojrzałych aplikacji do notatek, takich jak [Evernote](https://evernote.com/) i [Notion](https://www.notion.com/). Powiązane funkcje zostały zaprojektowane i zaimplementowane niezależnie przez EdgeEver.
- Inspiracją dla notatek z mapami myśli i diagramami były publicznie dostępne funkcje [XMind](https://xmind.com/) i [ProcessOn](https://www.processon.com/). Funkcje te zostały zaprojektowane i zaimplementowane niezależnie przez EdgeEver.
- Narzędzie do projektowania plakatów w EdgeEver czerpie inspirację z [Qiaomu Design](https://github.com/joeseesun/qiaomu-cover-design) autorstwa 向阳乔木 (joeseesun) i wykorzystuje dostosowane szablony oraz silnik typograficzny udostępnione na licencji MIT.
- Motywy wizualne i typografia kart do udostępniania notatek jako obrazów w EdgeEver były inspirowane [Firefly Card (流光卡片)](https://fireflycard.shushiai.com/). Dziękujemy za inspirację projektową.
- Funkcja publikowania jednym kliknięciem dla WeChat oraz typografia wyróżnionych artykułów w EdgeEver czerpią inspirację z projektu [gzh-design-skill](https://github.com/isjiamu/gzh-design-skill) autorstwa isjiamu. Dziękujemy za inspirację w zakresie układu i estetyki artykułów.

## Znak towarowy i użycie marki

Nazwa EdgeEver, logo i inne elementy identyfikacji wyróżniają oficjalny projekt. Forki i zmodyfikowane wersje mogą informować, że bazują na EdgeEver, ale nie mogą sugerować oficjalnego statusu ani wprowadzać użytkowników w błąd. Licencja otwartego oprogramowania nie przyznaje praw do znaków towarowych; ich inne użycie wymaga uprzedniej pisemnej zgody opiekunów projektu.

## Zastrzeżenie

EdgeEver to niezależna, otwartoźródłowa aplikacja do notatek rozwijana przez osoby prywatne i społeczność. Projekt nie jest powiązany z Evernote Corporation ani jej podmiotami zależnymi, nie jest przez nie autoryzowany, sponsorowany ani popierany.

EdgeEver jest oprogramowaniem do samodzielnego hostingu. Poza oficjalnymi instancjami demonstracyjnymi opiekunowie projektu nie hostują, nie kontrolują ani nie przeglądają treści użytkowników. Za treść przechowywaną lub wyświetlaną przez instancję odpowiadają jej użytkownicy lub operatorzy; nie reprezentuje ona poglądów opiekunów projektu.

## Współtwórcy

<!-- readme-contributors:start -->
<p align="left">
  <a href="https://github.com/tianma-if"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/5895871?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@tianma-if" /></a>
  <a href="https://github.com/dkoryto"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/2572180?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@dkoryto" /></a>
  <a href="https://github.com/sivdead"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/27731043?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@sivdead" /></a>
  <a href="https://github.com/yulei666"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/7358439?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@yulei666" /></a>
  <a href="https://github.com/thorufur"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/55167?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@thorufur" /></a>
  <a href="https://github.com/arsaboo"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/18319734?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@arsaboo" /></a>
  <a href="https://github.com/alyyasser"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/16476111?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@alyyasser" /></a>
  <a href="https://github.com/MadlyFX"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/4896705?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@MadlyFX" /></a>
  <a href="https://github.com/claude"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/81847?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@claude" /></a>
  <a href="https://github.com/CottonChou"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/17818375?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@CottonChou" /></a>
  <a href="https://github.com/Z-DDV"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/122068983?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@Z-DDV" /></a>
  <a href="https://github.com/DavidPivert"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/61420909?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@DavidPivert" /></a>
  <a href="https://github.com/0xfelixli"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/81979996?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@0xfelixli" /></a>
  <a href="https://github.com/jayhemnani9910"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/193022578?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@jayhemnani9910" /></a>
  <a href="https://github.com/Sergmay911"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/304439776?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@Sergmay911" /></a>
  <a href="https://github.com/X77seven"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/171017641?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@X77seven" /></a>
  <a href="https://github.com/imgdown"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/348032096?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@imgdown" /></a>
  <a href="https://github.com/xinyang920"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/43229479?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@xinyang920" /></a>
  <a href="https://github.com/mookim-eth"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/97934198?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@mookim-eth" /></a>
  <a href="https://github.com/nzhdotme"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/9588882?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@nzhdotme" /></a>
  <a href="https://github.com/tankle0"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/63094764?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@tankle0" /></a>
  <a href="https://github.com/Shunamxiao"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/92215296?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@Shunamxiao" /></a>
  <a href="https://github.com/Crowszzz"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/75199133?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@Crowszzz" /></a>
</p>
<!-- readme-contributors:end -->
