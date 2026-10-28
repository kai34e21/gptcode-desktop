# GPTCode Desktop 0.1.0

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

Installer: apps/examples/desktop-app/src-tauri/target/release/bundle/nsis/GPTCode Desktop_0.1.0_x64-setup.exe
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
Le modifiche dell'agente a un file aperto sono visibili dopo Ricarica.
La chat è stata verificata con provider locale simulato: nessuna inferenza esterna durante
il collaudo. Nell'uso normale continua a usare il provider configurato dall'utente nel CLI.

Licenza Apache-2.0 e attribuzioni upstream mantenute. Le licenze dei runtime inclusi sono
nelle risorse del pacchetto. Vedere GPTCODE-VALIDATION.md per prove e limiti.
