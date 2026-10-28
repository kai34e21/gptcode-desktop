# Verifica GPTCode Desktop 0.2.0

Base upstream: f817e59f698f01487920c00ede2dbecad5c0fa50.

## Prove

- Build SDK, frontend statico e installer Windows riuscite.
- check:gptcode: TypeScript del workbench e delle sue dipendenze superato.
- Vitest: 18 test su editor, chat, permessi, URI e diff; 7 sono del diff upstream.
  I test dei pannelli usano IPC simulato: non sono da soli prova della GUI nativa.
- Runtime: 12 test passati anche con worker e Node copiati fuori dal repository.
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


## Verifica aggiuntiva live 0.2.0

- Stream HTTP trattenuto a metà: proposta nel codice, nel diff e nell'anteprima prima
  dell'evento finale e della richiesta di permesso. Il file non esiste ancora su disco.
- Completamento dello stream: seconda parte visibile, file ancora assente fino al consenso.
- Consenso nella chat: file scritto dal vero agente e anteprima interattiva, non una foto.
- Modifica successiva al file: codice, diff e anteprima aggiornati senza Ricarica.
- Modifica non salvata dell'utente: conservata anche quando il file su disco e la preview cambiano.
- Frame con script abilitati: tentativo innocuo di cambiare il progetto nativo rifiutato,
  verificando lo stato dall'IPC del frame principale, non solo cercando un oggetto JavaScript.
- Tap trasporto: bytes/header conservati e nessuna richiesta modello aggiuntiva nel test.
- Casi unitari per JSON parziale/escape, tre dialetti SSE, permesso negato, file sensibili,
  traversal, token di anteprima e URL locali.

Il collaudo usa il motore GPTCode reale e un provider locale simulato. Le prove dei tre
parser di protocollo non equivalgono a verifiche live con tre servizi cloud distinti.
L'anteprima automatica è HTML; per un'app con server è necessario avviarlo e collegarne
l'URL locale. Nessuna animazione di digitazione viene presentata come stream reale.
