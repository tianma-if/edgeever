<div align="center">
  <h1>
    <img src="assets/brand/edgeever-icon.svg" alt="Logo EdgeEver" width="48" align="absmiddle" /> EdgeEver
  </h1>
  <p>
    <b>Otwartoźródłowa, natywnie wspierająca AI baza wiedzy i przenośna alternatywa dla Evernote</b>
  </p>
  <p>
    <a href="https://github.com/tianma-if/edgeever/stargazers"><img src="https://img.shields.io/github/stars/tianma-if/edgeever?style=social" alt="Gwiazdki na GitHubie" /></a>
    <a href="https://github.com/tianma-if/edgeever/network/members"><img src="https://img.shields.io/github/forks/tianma-if/edgeever?style=social" alt="Forki na GitHubie" /></a>
    <a href="https://github.com/tianma-if/edgeever/pkgs/container/edgeever"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fghcr-badge.elias.eu.org%2Fapi%2Ftianma-if%2Fedgeever%2Fedgeever&query=downloadCount&style=social&logo=docker&label=Docker%20Pulls" alt="Pobrania obrazu Docker" /></a>
    <a href="https://www.producthunt.com/products/edgeever?utm_source=other&utm_medium=social"><img src="https://img.shields.io/badge/Product%20Hunt-ea532a?style=social&logo=product-hunt" alt="Product Hunt" /></a>
    <a href="https://hellogithub.com/repository/tianma-if/edgeever" target="_blank"><img src="https://api.hellogithub.com/v1/widgets/recommend.svg?rid=150fee4403f6433880bda91e9576ac06&claim_uid=TWNAjisURpnhL1l&theme=small" alt="Wyróżnienie HelloGitHub" /></a>
    <a href="#wsparcie-projektu"><img src="https://img.shields.io/badge/Sponsor-EdgeEver-ea4aaa?logo=github-sponsors" alt="Wsparcie projektu" /></a>
  </p>
  <p>
    <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <b>Polski</b>
  </p>
  <p>
    <a href="https://t.me/+wwUx1BYLrIdiZjY1"><img src="assets/readme/community/telegram.svg" alt="Telegram" width="16" height="16" align="absmiddle" /> Grupa na Telegramie</a> &nbsp;|&nbsp;
    <a href="https://demo.edgeever.org">🌐 Demo na żywo</a> &nbsp;|&nbsp;
    <a href="#pobierz-aplikacje">📱 Pobierz aplikacje</a> &nbsp;|&nbsp;
    <a href="#features">Najważniejsze funkcje i zastosowania</a>
  </p>
</div>

EdgeEver to nowoczesna, otwartoźródłowa przestrzeń do notatek i zarządzania wiedzą. Przywraca klasyczny układ trzech paneli znany z Evernote, a jednocześnie daje kontrolę nad danymi i bezpośrednią współpracę z agentami AI.

> 💡 **Bez serwera i bez opłat w ramach darmowego planu**
> EdgeEver może działać w darmowym planie Cloudflare, bez kupowania i utrzymywania serwera. Jeśli wolisz VPS, NAS lub serwer domowy, tę samą aplikację możesz wdrożyć przez Dockera.

> ⭐ Jeśli EdgeEver Ci się przydaje, zostaw gwiazdkę na GitHubie. Dzięki temu więcej osób znajdzie projekt.

## Dlaczego EdgeEver?

Wielu wieloletnich użytkowników **Evernote** szuka po prostu **niezawodnej, otwartej i szybkiej** osobistej bazy wiedzy. Popularne rozwiązania mają jednak swoje ograniczenia:

* **Evernote**: To aplikacja, która towarzyszyła autorowi przez niemal dekadę i do której ma największy sentyment. Z czasem stała się rozbudowanym komercyjnym pakietem: przybyło reklam i dodatków, wzrosło zużycie zasobów, ograniczono darmowy plan, a zaawansowane funkcje AI są kosztowne. Trudno też połączyć ją z samodzielnie hostowanymi usługami i prywatnymi procesami AI.
* **Obsidian**: Pliki są otwarte, ale sam program ma zamknięty kod. Oficjalna synchronizacja jest płatna, a konfiguracja innych metod wymaga pracy. Przy tysiącach notatek lub wielu wtyczkach skanowanie lokalnych plików spowalnia uruchamianie i wyszukiwanie. Obrazy i załączniki powiększają magazyn, utrudniają synchronizację mobilną i mogą pozostawać po usunięciu notatek.
* **Memos i notatki strumieniowe**: Są proste, ale interfejs przypominający oś czasu różni się od uporządkowanej pracy w trzech panelach.
* **SiYuan i systemy oparte na blokach**: Oferują wiele funkcji i własny hosting, lecz szczegółowa struktura bloków utrudnia szybkie zapisywanie myśli i pisanie dłuższego tekstu. Brakuje im również bezpłatnego wdrożenia bezserwerowego, a synchronizacja między urządzeniami wymaga płatnej subskrypcji lub dodatkowo płatnego dostępu do S3/WebDAV.

**EdgeEver wypełnia tę lukę**: cały stos, łącznie z synchronizacją i własnym hostingiem, ma otwarty kod. Zachowuje znany układ trzech paneli, działa sprawnie nawet przy ponad 10 000 notatek i oferuje natywną współpracę z agentami AI oraz możliwość bezpłatnego wdrożenia.

## Demo online

- Demo: [https://demo.edgeever.org](https://demo.edgeever.org)

Publiczne demo resetuje się codziennie o 3:00 czasu chińskiego (UTC+8) i przywraca przykładowe notatki. Nie zapisuj w nim prywatnych danych.

## Pobierz aplikacje

<p>
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/macos.svg" alt="Pobierz EdgeEver na macOS" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/windows.svg" alt="Pobierz EdgeEver na Windows" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/tux.svg" alt="Pobierz wersję Preview EdgeEver AppImage na Linux x86_64" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://play.google.com/store/apps/details?id=org.edgeever.mobile&hl=pl"><img src="assets/readme/platforms/google-play.svg" alt="Pobierz EdgeEver na Androida z Google Play" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://apps.apple.com/pl/app/edgeever/id6792625631"><img src="assets/readme/platforms/app-store.svg" alt="Pobierz EdgeEver na iOS z App Store" width="40" height="40" /></a>
</p>

> Aplikacja na iOS wymaga Apple ID spoza Chin kontynentalnych.

<a id="features"></a>
## Najważniejsze funkcje i zastosowania

EdgeEver łączy zbieranie materiałów z różnych źródeł, tworzenie treści wizualnych i współpracę w jednym środowisku:

### Zapisywanie treści i przechowywanie plików
- **Zapisywanie treści jednym kliknięciem na różnych platformach**: Rozszerzenie przeglądarki zapisuje [galerie Xiaohongshu](docs/best-practices.md#2-one-click-xiaohongshu-red-note-clipping), [wpisy i cytaty z X (Twittera)](docs/best-practices.md#3-one-click-x-twitter-post--quote-clipping), [pytania i odpowiedzi z Zhihu](docs/best-practices.md#4-one-click-zhihu-answer--column-article-clipping), [dyskusje na Reddicie](docs/best-practices.md#5-one-click-reddit-discussion-post-clipping) oraz [repozytoria GitHub](docs/best-practices.md#8-one-click-github-repository-metadata-clipping). Udostępnianie systemowe na telefonie pozwala szybko zapisać [zdjęcia](docs/best-practices.md#9-one-click-mobile-image-sharing-to-notes) i [artykuły z WeChat](docs/best-practices.md#10-one-click-wechat-article-clipping-on-mobile). Obsługa kolejnych serwisów jest planowana.
- **Archiwizacja rozmów WeChat**: Na macOS można zaimportować całą rozmowę przez „Forward to Other Apps → EdgeEver”, zachowując uczestników, znaczniki czasu, cytowane odpowiedzi i naklejki. Obrazy trafiają do notatki, a nagrania audio i wideo są zapisywane jako załączniki. Zobacz [przewodnik po archiwizacji rozmów](docs/best-practices.md#1-one-click-wechat-chat-history-archiving).
- **Załączniki i kompresja obrazów po stronie klienta**: Dodawaj pliki PDF, dokumenty Office, archiwa i multimedia. Przesyłanie strumieniowe w częściach obsługuje załączniki do 1 GiB. Cicha kompresja obrazów w przeglądarce zmniejsza rozmiar zrzutów ekranu i dużych zdjęć o 50–90%, przyspieszając ładowanie i oszczędzając miejsce.

### Notatki wizualne i współpraca z bazami danych
- **Diagramy i infografiki**: Poproś asystenta AI zwykłym językiem o interaktywne, edytowalne [mapy myśli, schematy blokowe lub diagramy architektury](docs/best-practices.md#11-ai-conversational-generation-of-mind-maps-flowcharts--architecture-diagrams). Zobacz [opis notatek z diagramami](docs/visual-diagram-notes.md); obsługiwane jest też renderowanie bloków Mermaid. Wbudowane szablony pozwalają tworzyć [infografiki, w tym osie czasu, porównania i wykresy kwadrantowe](docs/best-practices.md#12-ai-powered-generation-of-professional-infographics).
- **Wielowymiarowe tabele AI i publiczne formularze**: Na podstawie polecenia w języku naturalnym twórz [tabele do zarządzania projektami, treściami, zasobami i innymi procesami](docs/best-practices.md#13-instant-multi-dimensional-database-table-generation-via-ai-prompt), z odpowiednimi typami pól i przykładowymi rekordami. Jednym kliknięciem udostępnij [publiczny formularz](docs/best-practices.md#14-one-click-public-online-form-collection-from-database-tables), który zbiera odpowiedzi bez logowania bezpośrednio do tabeli.
- **Dwa widoki edycji i porządkowanie przestrzeni**: Na komputerze przełączaj się między edytorem tekstu sformatowanego a źródłem Markdown. Korzystaj z trzech paneli, trybu skupienia, dowolnie zagnieżdżonych notatników, zbiorczego łączenia i przenoszenia notatek oraz sortowania przez przeciąganie. Dostępne są historia wersji i udostępnianie notatek zabezpieczone hasłem.

### Publikowanie i udostępnianie
- **WeChat Official Account i kopiowanie ze stylami**: Twórz tekst sformatowany ze stylami CSS i [kopiuj notatki jednym kliknięciem do edytora WeChat Official Account](docs/best-practices.md#6-one-click-note-copy-to-wechat-official-account--blogs), newsletterów lub blogów.
- **Grafiki z notatek i eksport**: Zamień notatkę w [estetyczną grafikę do udostępniania](docs/best-practices.md#7-ai-rss-daily-digest--elegant-image-poster-sharing), wybierając spośród ośmiu motywów, krojów pisma i układów. Pojedyncze notatki można eksportować do Markdown, HTML lub PDF.
- **Codzienne podsumowania RSS tworzone przez AI**: Oficjalna wtyczka subskrypcji RSS zbiera wpisy z kanałów i blogów, filtruje szum przy użyciu AI i przygotowuje zwięzłe notatki z podsumowaniem dnia.

### Natywni agenci AI i otwarty ekosystem
- **Protokoły MCP i ACP**: Wbudowany Model Context Protocol (MCP) pozwala zewnętrznym agentom AI czytać i porządkować notatki. Aplikacja desktopowa używa Agent Client Protocol (ACP), aby współpracować bezpośrednio z lokalnymi agentami, takimi jak Codex, Antigravity, Claude Code i WorkBuddy.
- **Własne modele AI i API wtyczek**: Podłącz wielu dostawców zgodnych z OpenAI, Anthropic lub Gemini oraz własne serwery pośredniczące. AI może streszczać, wydobywać informacje, sprawdzać tekst, tłumaczyć i wspierać redakcję. Możliwości aplikacji rozszerzysz przez [API tworzenia wtyczek](docs/plugin-development.md).

### Otwarta architektura, wiele platform i bezpieczeństwo
- **Elastyczne wdrożenie i kontrola nad danymi**: Korzystaj z darmowego planu Cloudflare (około 150 tys. krótkich notatek i 50 tys. obrazów) albo wdróż aplikację przez Dockera na VPS, NAS lub serwerze domowym, aby przechowywać miliony notatek. Standardowa baza SQLite, REST API, narzędzia CLI i bezstratny eksport oraz import pełnego archiwum ZIP pomagają zachować niezależność danych.
- **Wiele platform i ochrona środowiska produkcyjnego**: Oficjalne aplikacje działają w [przeglądarce, na Androidzie](https://play.google.com/store/apps/details?id=org.edgeever.mobile&hl=pl), [macOS](https://github.com/tianma-if/edgeever/releases), [Windows](https://github.com/tianma-if/edgeever/releases/latest), [Linuksie](https://github.com/tianma-if/edgeever/releases/latest) i [iOS](https://apps.apple.com/pl/app/edgeever/id6792625631). Rozszerzenie Web Clipper jest dostępne dla [Chrome](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo), [Edge](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo) i [Firefox](https://addons.mozilla.org/firefox/addon/edgeever-web-clipper/). Synchronizacja we własnym środowisku nie ogranicza liczby urządzeń; aplikacja desktopowa ma niewielkie zużycie pamięci, a dostępne są wersje robocze offline, kolejki synchronizacji, ochrona serwera przed atakami siłowymi i odizolowane przestrzenie użytkowników.

👉 Wszystkie 14 scenariuszy ze zrzutami ekranu opisuje [pełny przewodnik po funkcjach i zastosowaniach](docs/best-practices.md).

## Wdrożenie

Cloudflare to zalecana opcja bez własnego serwera. Docker jest dostępny dla osób korzystających z VPS, NAS lub serwera domowego. Szczegółowe przewodniki wdrożenia są obecnie dostępne po angielsku.

W przypadku Cloudflare wybierz jedną z poniższych metod wdrożenia online:

### Opcja A: Wdrożenie z agentem AI (zalecane)

Skopiuj poniższe polecenie do agenta AI, na przykład Codex, Claude, Cursor, WorkBuddy, Antigravity, OpenClaw lub Hermes Agent. Gdy agent poprosi o dostęp do GitHuba lub Cloudflare, sprawdź żądane uprawnienia i postępuj zgodnie z instrukcjami autoryzacji.

```text
Wdróż EdgeEver przez GitHub i Cloudflare:
1. Utwórz Fork repozytorium https://github.com/tianma-if/edgeever.
2. Utwórz bazę D1 `edgeever` i zasobnik R2 `edgeever-resources` w Cloudflare.
3. W Workers & Pages utwórz Worker o nazwie `edgeever` z gałęzi `main` Forka.
   Użyj katalogu głównego repozytorium, zachowaj domyślne polecenie wdrożenia
   Workers Builds i upewnij się, że token API może odczytywać i modyfikować D1.
   Wybierz Save and Deploy.
4. Po utworzeniu Workera zapisz wybrane hasło jako sekret środowiska
   uruchomieniowego `EDGE_EVER_AUTH_PASSWORD` (najlepiej co najmniej 32 znaki).
   Domyślna nazwa użytkownika to `admin`. Aby ją zmienić, ustaw zmienną
   Workers Builds `EDGE_EVER_AUTH_USERNAME` przed kolejnym buildem.
5. Ponów build, sprawdź `/api/health` i `/api/openapi.json`, a następnie
   zaloguj się nazwą administratora i hasłem.
6. Włącz i ręcznie uruchom raz workflow GitHub Actions `Update deployed EdgeEver`,
   aby Fork automatycznie otrzymywał przyszłe stabilne wersje i poprawki.
```

> Szczegółowe wymagania: [wdrożenie Cloudflare z agentem AI](docs/agent-deploy-cloudflare.md).

### Opcja B: Ręczne wdrożenie online

Konfiguracja obejmuje sześć kroków w interfejsie przeglądarkowym:

1. **Utwórz Fork repozytorium**: Kliknij **Fork** w prawym górnym rogu strony GitHub, aby utworzyć kopię EdgeEver na swoim koncie.
2. **Utwórz zasoby Cloudflare**: Utwórz bazę D1 `edgeever` i zasobnik R2 `edgeever-resources`.
3. **Zaimportuj i skonfiguruj projekt**: W Cloudflare **Workers & Pages** utwórz Worker `edgeever` z gałęzi `main` swojego Forka. Użyj katalogu głównego repozytorium i zachowaj domyślne polecenie wdrożenia Workers Builds. Token API musi mieć prawo do odczytu i modyfikacji D1. Polecenie wdrożenia utworzy powiązania zasobów; nie edytuj plików Forka.
4. **Wybierz hasło administratora**: Ustaw hasło, najlepiej o długości co najmniej 32 znaków. Po utworzeniu Workera zapisz je jako sekret środowiska uruchomieniowego `EDGE_EVER_AUTH_PASSWORD`.
5. **Zbuduj i sprawdź aplikację**: **Save and Deploy** tworzy Workera i uruchamia build. Jeśli zakończy się błędem z powodu braku sekretu administratora, dodaj sekret z kroku 4 i ponów próbę. Domyślna nazwa użytkownika to `admin`; aby ją zmienić, ustaw zmienną Workers Builds `EDGE_EVER_AUTH_USERNAME` przed ponownym buildem. Po wdrożeniu sprawdź, czy `/api/health` zwraca `200`, i zaloguj się.
6. **Włącz automatyczne aktualizacje**: W zakładce **Actions** Forka kliknij **I understand my workflows, go ahead and enable them**, a następnie ręcznie uruchom raz workflow **Update deployed EdgeEver**.

> Pełne instrukcje i konfigurację znajdziesz w [przewodniku wdrożenia online](docs/deploy-cloudflare-button.md).

> 💡 **Domena i dostęp**: Możesz użyć domyślnej domeny `*.workers.dev` lub podłączyć własną w ustawieniach Workera: **Settings → Domains & Routes**.

> 💡 **Aktywacja Cloudflare R2**: Choć [darmowy limit przestrzeni R2](https://developers.cloudflare.com/r2/pricing/#free-tier) wystarcza na typowe notatki, najpierw trzeba aktywować subskrypcję R2 i dodać metodę płatności. Cloudflare [obsługuje](https://developers.cloudflare.com/billing/get-started/update-billing-info/#supported-payment-methods) karty UnionPay, Visa i Mastercard oraz PayPal, Apple Pay i Google Pay.

### Opcja C: Docker na VPS lub NAS

Użyj instalatora hostowanego w GitHubie i oficjalnego obrazu GHCR:

```sh
curl -fsSL https://edgeever.org/install.sh | bash
```

Polecenie pobiera najnowszy obraz, generuje hasło administratora i uruchamia EdgeEver przez Docker Compose.

Ręczne wdrożenie i konfigurację opisuje [przewodnik po Dockerze](docs/deploy-docker.md).

Po instalacji aktualizacje domyślnie uruchamiają się codziennie. Aby zaktualizować aplikację ręcznie, uruchom `~/edgeever/update.sh` na serwerze.

---

## Logowanie wielu użytkowników

Jedna instancja obsługuje wiele kont. Administrator może tworzyć i wyłączać konta oraz resetować ich hasła w **Profil → Członkowie**. Każdy użytkownik otrzymuje odizolowaną przestrzeń z notatnikami, notatkami, załącznikami, Koszem, importem i eksportem oraz tokenami MCP.

## Rozszerzenie Web Clipper

<p>
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/chrome/chrome.svg" alt="Zainstaluj EdgeEver Web Clipper w Chrome" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/edge/edge.svg" alt="Zainstaluj EdgeEver Web Clipper w Edge" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://addons.mozilla.org/firefox/addon/edgeever-web-clipper/"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/firefox/firefox.svg" alt="Zainstaluj EdgeEver Web Clipper w Firefoxie" width="36" height="36" /></a>
</p>

- **Wydobywanie treści artykułów**: Rozszerzenie pobiera tekst i przekształca go w przejrzysty Markdown, zachowując adres źródłowy oraz czas zapisania.
- **Zapisywanie zaznaczenia i obrazów z menu kontekstowego**: Dodawaj zaznaczony tekst lub obraz wskazany prawym przyciskiem myszy bez przechwytywania całej strony.
- **Obsługa serwisów społecznościowych**: Jednym kliknięciem zapisuj treści z X (Twittera), Xiaohongshu, Zhihu, Reddita i GitHuba.
- **Bezpośrednie prywatne połączenie**: Rozszerzenie wysyła materiały do Twojej instancji EdgeEver bez pośrednictwa zewnętrznych usług.

## Społeczność i opinie

- Błędy, propozycje funkcji i problemy z wdrożeniem zgłaszaj przez [GitHub Issues](https://github.com/tianma-if/edgeever/issues).
- Przed wniesieniem zmian przeczytaj [poradnik współtworzenia](CONTRIBUTING.md). Jeśli Twój Fork służy również do wdrożenia EdgeEver, pozostaw jego gałąź `main` wyłącznie do wdrożeń. Do synchronizacji, prac rozwojowych i pull requestów utwórz osobną gałąź od oficjalnego `upstream/main`; nie rozwijaj aplikacji ani nie używaj opcji Sync fork na wdrożeniowej gałęzi `main`.

### Społeczność na Telegramie

Zapraszamy do społeczności EdgeEver, skupiającej twórców i pasjonatów vibe codingu oraz AI. Rozmawiajmy o nowoczesnej produktywności opartej na AI i sprawdzonych praktykach budowania osobistej bazy wiedzy.

👉 [Dołącz do grupy na Telegramie](https://t.me/+wwUx1BYLrIdiZjY1)

## Wtyczki i motywy

Aplikacje Web i desktopowa obsługują wtyczki oraz własne motywy, instalowane z oficjalnego marketplace, GitHuba lub adresu manifestu i synchronizowane między urządzeniami. Programiści mogą rozszerzać aplikację przez `@edgeever/plugin-api`; zobacz [przewodnik tworzenia wtyczek](docs/plugin-development.md) i [zasady publikowania w marketplace](docs/plugin-marketplace-policy.md).

## Stos technologiczny

- Monorepo oparte na Bun z aplikacją Web, API, oficjalną stroną i pakietem współdzielonych typów.
- Interfejs: Vite, React, React Router, TanStack Query, Tailwind CSS, shadcn/ui i Radix UI.
- Edytor: TipTap / ProseMirror z obsługą Markdown; PWA korzysta z vite-plugin-pwa, Workbox i Dexie.
- Android: Expo + React Native w `apps/mobile`, lokalny SQLite i synchronizacja przyrostowa.
- iOS: natywny SwiftUI w `apps/ios` (iOS 17+), dołączony EditorBundle TipTap, lokalna kopia i kolejka zmian GRDB.
- Desktop: Electron + proces pomocniczy Rust, SQLite do edycji offline, synchronizacji przyrostowej i lokalnych kopii zapasowych.
- Web Clipper: Manifest V3, Mozilla Readability i Turndown dla Chrome, Edge i Firefox.
- Backend: jedna aplikacja biznesowa Hono/Zod z REST API i Remote MCP. Cloudflare używa Workers/D1/R2, a Docker używa Bun/SQLite oraz plików lokalnych lub S3.
- Oficjalna strona: statyczna witryna Astro w `apps/site`, wdrażana niezależnie na Cloudflare Pages.

## Szybki start

```sh
bun install
bun run dev
```

W lokalnym środowisku deweloperskim logowanie następuje automatycznie. Nowa baza używa danych `owner` / `edgeever-local-dev`. Wyloguj się, aby sprawdzić ekran logowania.

## Struktura projektu

```text
apps/web          Interfejs Vite + React, PWA, wersje robocze offline i kolejka synchronizacji
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

## Formaty treści

Treść notatki jest przechowywana w trzech postaciach:

```text
content_json      Dokument TipTap/ProseMirror, główne źródło dla edytora
content_markdown  Format API, agentów, importu i eksportu
content_text      Tekst do wyszukiwania, podsumowań i indeksowania
```

W **Profil → Import i eksport** można wyeksportować lub zaimportować archiwum ZIP EdgeEver. Katalog `notes/` zawiera czytelne pliki Markdown, a dane strukturalne pozwalają całkowicie odtworzyć instancję. Import zachowuje niezwiązane dane w instancji docelowej i nadpisuje rekordy o tych samych identyfikatorach EdgeEver.

## MCP

Utwórz token API w **Profil → API / MCP** i skopiuj konfigurację Remote MCP jednym kliknięciem. Agenci AI, tacy jak Claude Code, Cursor, Antigravity i OpenClaw, będą mogli bezpiecznie zarządzać Twoją bazą wiedzy w zakresie uprawnień konta. EdgeEver obsługuje pełne tworzenie, odczyt, edycję i usuwanie notatek tekstowych, diagramów (map myśli, schematów blokowych i diagramów architektury) oraz tabel strukturalnych. Agenci mogą też zarządzać strukturą notatników, tagami, załącznikami, historią wersji, szablonami i instrukcjami AI.

> 💡 **Inspiracja:**
> Użyj AI jako pomocnika w porządkowaniu wiedzy: zamieniaj pomysły w interaktywne mapy myśli, diagramy i tabele, dostarczając agentom własny kontekst. Edytor tekstu sformatowanego i typografia EdgeEver pomagają dopracować wynik do postaci gotowej do publikacji.

## Kompresja obrazów

Obrazy są kompresowane przed przesłaniem w aplikacji Web; steruje tym ustawienie **Kompresuj obrazy w notatkach**. Po włączeniu pliki PNG, JPEG, WebP i AVIF są konwertowane na WebP, jeśli zmniejsza to ich rozmiar. Najdłuższy bok jest ograniczony do `2560px`. Gdy kompresja nie daje oszczędności, aplikacja zachowuje oryginał.

EdgeEver nie przetwarza obrazów po stronie Workera, co ogranicza zużycie zasobów obliczeniowych i limitów przetwarzania. Przesyłanie przez REST API i MCP przechowuje plik otrzymany od klienta bez dodatkowej kompresji na serwerze.

## Zaawansowane przechowywanie plików

Właściciel instancji może skonfigurować magazyn zgodny z S3 w **Profil → Zaawansowane → Magazyn obiektów OSS**. Zmiana magazynu nie przenosi istniejących załączników ani ich nie modyfikuje.

## Migracja

Jeśli chcesz przenieść notatki z innej aplikacji do EdgeEver, skorzystaj z poniższych przewodników (obecnie po angielsku):

- **Evernote**: [docs/evernote-migration-guide.md](docs/evernote-migration-guide.md)
- **flomo**: [docs/flomo-migration-guide.md](docs/flomo-migration-guide.md)
- **Memos**: [docs/memos-migration-guide.md](docs/memos-migration-guide.md)
- **Notion**: [docs/notion-migration-guide.md](docs/notion-migration-guide.md)

## Wdrożenie przez Dockera

Wariant Docker używa tego samego interfejsu, tras API, usług, uwierzytelniania, implementacji MCP i migracji co Cloudflare. Kontener korzysta z SQLite oraz plików lokalnych lub magazynu zgodnego z S3 i obsługuje architektury `amd64` oraz `arm64`. Zobacz [wdrożenie EdgeEver przez Dockera](docs/deploy-docker.md) oraz [architekturę własnego hostingu](docs/self-hosting-architecture.md).

## Czas synchronizacji

Aplikacje Web, PWA i desktopowa przesyłają zmiany notatek po 30 sekundach bezczynności i sprawdzają zmiany zdalne co 5 minut, gdy są widoczne. Ponowne przejście do aplikacji i ręczne odświeżenie działają od razu. Parametry `DEFERRED_MEMO_SYNC_DELAY_MS` i `BACKGROUND_WORKSPACE_REFRESH_INTERVAL_MS` znajdują się w [`apps/web/src/lib/workspace-refresh.ts`](apps/web/src/lib/workspace-refresh.ts).

## Wsparcie projektu

EdgeEver jest darmowym projektem o otwartym kodzie. Rozwijanie aplikacji na różne platformy, testy na urządzeniach, podpisywanie kodu i utrzymywanie kilku środowisk uruchomieniowych wymagają czasu i środków.

- [Wesprzyj EdgeEver](docs/sponsor.md) — dobrowolne wpłaty przez WeChat Pay lub Alipay.
- [Sponsorzy i partnerzy](docs/partners.md) — wsparcie infrastruktury, narzędzi, usług i współpracy ze społecznością.

## Podziękowania

- Przy projektowaniu EdgeEver wzorowano się na publicznie dostępnych rozwiązaniach dojrzałych aplikacji do notatek, takich jak [Evernote](https://evernote.com/) i [Notion](https://www.notion.com/). Powiązane funkcje zostały zaprojektowane i zaimplementowane niezależnie przez EdgeEver.
- Inspiracją dla notatek z mapami myśli i diagramami były publicznie dostępne funkcje [XMind](https://xmind.com/) i [ProcessOn](https://www.processon.com/). Funkcje te zostały zaprojektowane i zaimplementowane niezależnie przez EdgeEver.
- Narzędzie do projektowania plakatów w EdgeEver czerpie inspirację z [Qiaomu Design](https://github.com/joeseesun/qiaomu-cover-design) autorstwa 向阳乔木 (joeseesun) i wykorzystuje dostosowane szablony oraz silnik typograficzny udostępnione na licencji MIT.

## Znak towarowy i użycie marki

Nazwa EdgeEver, logo i inne elementy identyfikacji wyróżniają oficjalny projekt. Forki i zmodyfikowane wersje mogą informować, że bazują na EdgeEver, ale nie mogą sugerować oficjalnego statusu ani wprowadzać użytkowników w błąd. Licencja otwartego oprogramowania nie przyznaje praw do znaków towarowych; ich inne użycie wymaga uprzedniej pisemnej zgody opiekunów projektu.

## Zastrzeżenie

EdgeEver to niezależna, otwartoźródłowa aplikacja do notatek rozwijana przez osoby prywatne i społeczność. Projekt nie jest powiązany z Evernote Corporation ani jej podmiotami zależnymi, nie jest przez nie autoryzowany, sponsorowany ani popierany.

EdgeEver jest oprogramowaniem do samodzielnego hostingu. Poza oficjalnymi instancjami demonstracyjnymi opiekunowie projektu nie hostują, nie kontrolują ani nie przeglądają treści użytkowników. Za treść przechowywaną lub wyświetlaną przez instancję odpowiadają jej użytkownicy lub operatorzy; nie reprezentuje ona poglądów opiekunów projektu.
