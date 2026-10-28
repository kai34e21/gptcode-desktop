# GPTCode Desktop 0.2.0

Fork di cline/cline, base f817e59f698f01487920c00ede2dbecad5c0fa50.
Riusa finestra Tauri, tema, terminale ConPTY/xterm e diff di Cline.
La modalità GPTCode usa il CLI installato e non avvia Cline Hub.

## Funzioni

- Editor a schede, sintassi, ricerca/sostituzione, undo/redo, Ctrl+S e diff del buffer.
- Chat grafica GPTCode: streaming, tool, domande, permessi per azione, Stop, pianificazione,
  selezione modello e ripresa delle sessioni. Il file corrente è incluso solo selezionandolo.
- LSP TypeScript/JavaScript reale: diagnostica, completamenti, hover e F12 nel progetto.
- Debug Node: breakpoint nel margine, pausa/continua, step over/into/out, call stack,
  variabili, valutazione senza effetti collaterali e output. I breakpoint sono applicati all'avvio.
- Terminali shell e GPTCode CLI separati, con login e plugin del CLI originale.

## Avvio Windows

Installer: apps/examples/desktop-app/src-tauri/target/release/bundle/nsis/GPTCode Desktop_0.2.0_x64-setup.exe
Include Node, worker e TypeScript: non serve un server di sviluppo aperto.
Richiede l'installazione GPTCode originale, esterna al pacchetto e verificata dal manifest.
Per un percorso diverso usare il launcher con -CliPath o impostare GPTCODE_CLI_PATH.
Credenziali e sorgenti del CLI non vengono copiati nel pacchetto.

Per sviluppare usare Avvia-GPTCode-Desktop.cmd o Avvia-GPTCode-Desktop.ps1.
-Workspace seleziona il progetto iniziale; -CheckOnly verifica i percorsi.
La versione di sviluppo usa un identificatore distinto da app distribuita e Cline.

## Build

Bun 1.4.2, Node >=22.22.2, Rust/MSVC e WebView2. Non usare npm/yarn/pnpm.
Su questa macchina Bun è isolato in ../.gptcode-desktop-tools/bun-1.4.2/bun-windows-x64.

    bun install --frozen-lockfile
    bun run build:sdk
    cd apps/examples/desktop-app
    bun run check:gptcode
    bun run test:gptcode
    bun run package:gptcode

Impostare GPTCODE_CLI_PATH per includere i test del CLI installato.
I test runtime usano servizi reali e un provider locale simulato, senza inferenze esterne.
Il collaudo della vera finestra usa scripts/native-gptcode-e2e.mjs e una build separata
con feature qa-webview. Non scarica browser e non inietta input Windows.
L'installer normale non abilita la feature QA.

## Salvataggio e limiti

Testo UTF-8 fino a 4 MiB; LF/CRLF preservati. Il salvataggio confronta il contenuto
originale e sostituisce il file tramite copia temporanea. I conflitti conservano il buffer.
Ricaricamento e chiusura di schede modificate richiedono conferma; anche l'uscita dall'app
avverte delle modifiche non salvate. Diff confronta con l'ultima lettura, non con Git HEAD.
Esplorazione e salvataggio sono confinati alla cartella scelta.

Il supporto semantico è TS/JS. Il debugger è Node, non Python/Rust; TypeScript deve essere
eseguibile da Node. Creazione/rinomina file restano disponibili tramite terminale o agente.
Le modifiche su disco aggiornano automaticamente i buffer puliti. I buffer non salvati sono conservati e mostrano un conflitto.
La chat è stata verificata con provider locale simulato: nessuna inferenza esterna durante
il collaudo. Nell'uso normale continua a usare il provider configurato dall'utente nel CLI.

Licenza Apache-2.0 e attribuzioni upstream mantenute. Le licenze dei runtime inclusi sono
nelle risorse del pacchetto. Vedere GPTCODE-VALIDATION.md per prove e limiti.


## Codice, diff e anteprima dal vivo

La chat osserva i veri delta degli argomenti Write/Edit negli stream SSE Responses,
Chat Completions e Anthropic. Non simula una digitazione e non duplica le richieste.
Se il provider consegna solo il tool completo, compare la proposta completa quando arriva.
Il CLI installato non viene modificato: l'osservatore agisce solo nel processo desktop.

Il file si apre automaticamente, con codice e diff della proposta aggiornati dal vivo.
Il badge distingue codice in arrivo, proposta in attesa, salvato, negato o interrotto.
La proposta è separata dal buffer utente e non viene scritta prima dei permessi del CLI.
Segui agente controlla il cambio di file e lo scorrimento; Il mio buffer permette di
continuare a vedere le proprie modifiche. Un conflitto non sostituisce il buffer sporco.
Il monitoraggio su disco aggiorna anche editor, albero e anteprima dopo scritture esterne.
Per i comandi che non producono delta Write/Edit, gli aggiornamenti riflettono i file
quando vengono effettivamente scritti, senza inventare uno stato precedente sconosciuto.

L'HTML generato apre un'anteprima automatica in un pannello ridimensionabile. Può mostrare
la proposta parziale prima che esista il file. Gli script della proposta sono disabilitati;
dopo il salvataggio la pagina diventa interattiva. CSS/JS locali e modifiche successive
aggiornano la vista. Le risorse sono servite su loopback con URL casuale, da un'origine
separata dall'IDE; file riservati e percorsi esterni al progetto non sono serviti.
Il collaudo verifica che il frame generato non possa cambiare il progetto nativo.

Per Vite, Next o altre app con server, avvia il server dal terminale e inserisci il suo
URL localhost/127.0.0.1 nel pannello Anteprima. Non vengono eseguiti automaticamente
script del progetto. L'anteprima HTML statica usa risorse locali; per CDN o backend usa
un server locale adeguato. I linguaggi/app non visualizzabili in un browser richiedono
il proprio runtime, come in un normale IDE.
