# Verifica GPTCode Desktop 0.1.0

Base upstream: f817e59f698f01487920c00ede2dbecad5c0fa50.

## Prove

- Build SDK, frontend statico e installer Windows riuscite.
- check:gptcode: TypeScript del workbench e delle sue dipendenze superato.
- Vitest: 15 test su editor, chat, permessi, URI e diff; 7 sono del diff upstream.
  I test dei pannelli usano IPC simulato: non sono da soli prova della GUI nativa.
- Runtime: 4 test passati anche con worker e Node copiati fuori dal repository.
  LSP: diagnostica, completamenti, hover e definizioni reali su buffer non salvati.
  Inspector: breakpoint, scope, valutazione e arresto di un programma Node reale.
  Chat: agente GPTCode reale, provider HTTP locale simulato, permessi negati/autorizzati,
  file e sessioni reali in profilo temporaneo. Nessuna inferenza esterna.
- Rust: filesystem, conflitti, UTF-8, percorsi e terminale; regressione sui namespace Windows.
- Biome mirato e git diff --check superati. Gitleaks sul diff preparato: nessuna credenziale.

## Collaudo nativo completo: superato

Eseguibile Tauri release con feature qa-webview collegato via CDP alla sua vera WebView2.
Eseguibile e risorse copiati fuori dal repository, senza dipendenze di sviluppo disponibili.
Istanza QA con identificatore separato, senza prendere mouse/tastiera dell'utente.
Profilo Windows della WebView preservato; solo il motore usa un profilo sintetico isolato.

1. Apri file, modifica e salva dalla GUI: contenuto reale su disco e CRLF verificati.
2. Apri TypeScript: diagnostica del language server visibile nell'editor.
3. Messaggio in chat, richiesta Write, file assente prima del consenso, click Consenti
   una volta: file scritto dal vero agente e risposta ricevuta nella GUI.
4. Click nel margine, breakpoint, avvio Node, stop alla riga 3: value=40 e answer=42;
   valutazione grafica di answer restituisce 42; arresto del debugger.

La feature di ispezione QA è esclusa dall'installer normale.

## Difetti trovati e corretti

- Export Next incorporato dalla cartella sbagliata: selezionati export e route corretti.
- Percorsi risorsa Windows con prefisso namespace rifiutati da Node: normalizzati.
- TypeScript incluso senza manifest/struttura attesa: preservati package.json e lib/.
- URI LSP con drive codificato: confronto tramite percorsi decodificati.
- Margine senza celle nelle righe non marcate: abilitate le celle interattive.
- Lettura concorrente e conflitto su disco: buffer preservato.

## Limiti verificati

Il typecheck generale Cline restituisce 108 errori anche su codice upstream pulito con
le stesse dipendenze. Il controllo dedicato del workbench passa. I difetti dell'intera
applicazione Cline non vengono presentati come risolti.
Supporto LSP TS/JS, debugger Node. Nessun provider esterno interrogato nel collaudo.
Installer generato, ma non installato nel profilo utente: prova eseguita sull'eseguibile
con le risorse del pacchetto. La prova QA abilita l'ispezione WebView, non presente in release.

## SKILL ORCHESTRATOR

Selected: quality-sentinel, frontend-design, computer-use.
Verified: controlli mirati e percorso completo nella WebView2 nativa.
Rejected: sostituzione del CLI, provider Cline e input automatico che contende quello manuale.
Unknown: inferenza esterna e installazione nel profilo utente.

## QUALITY SENTINEL

Outcome: editor, chat GPTCode, LSP TS/JS, debugger Node e pacchetto Windows integrati.
Regression guard: salvataggio/concorrenza, permessi, URI, percorsi e runtime distribuito.
Ledger: incidenti di packaging registrati nella memoria locale del progetto.
