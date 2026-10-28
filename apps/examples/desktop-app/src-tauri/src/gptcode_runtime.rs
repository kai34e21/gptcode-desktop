//! A supervised stdio worker: no local HTTP listener and no credentials in IPC.
use serde_json::{json, Value};
use std::{collections::HashMap, io::{BufRead, BufReader, Write}, path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio}, sync::{Arc, Mutex, mpsc}, time::Duration};
use tauri::{AppHandle, Emitter, State, Manager};

type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>;
struct Worker { child: Child, input: Option<ChildStdin>, pending: Pending, next: u64, root: PathBuf,
    #[cfg(windows)]
    _job: ProcessJob,
}
#[cfg(windows)]
struct ProcessJob(isize);
#[cfg(windows)]
impl ProcessJob {
    fn attach(child: &Child) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() { return Err(std::io::Error::last_os_error().to_string()); }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits as *const _ as *const _, std::mem::size_of_val(&limits) as u32) == 0
                || AssignProcessToJobObject(job, child.as_raw_handle()) == 0 {
                let error = std::io::Error::last_os_error().to_string(); CloseHandle(job); return Err(error);
            }
            Ok(Self(job as isize))
        }
    }
}
#[cfg(windows)]
impl Drop for ProcessJob { fn drop(&mut self) { unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0 as _); } } }
#[derive(Default)]
pub struct Runtime(Mutex<Option<Worker>>);

#[cfg(windows)]
fn hidden(command: &mut Command) { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
#[cfg(not(windows))]
fn hidden(_: &mut Command) {}

impl Worker {
    fn start(app: AppHandle, root: PathBuf) -> Result<Self, String> {
        let resource = crate::gptcode::ordinary_path(&app.path().resource_dir().map_err(|e| e.to_string())?).join("bin/gptcode-runtime");
        let node = std::env::var_os("GPTCODE_NODE_PATH").map(PathBuf::from)
            .unwrap_or_else(|| if resource.join("node.exe").is_file() { resource.join("node.exe") } else { PathBuf::from("node") });
        let script = std::env::var("GPTCODE_DESKTOP_RUNTIME").ok().map(PathBuf::from)
            .or_else(|| if cfg!(debug_assertions) { std::env::current_exe().ok().and_then(|exe| exe.ancestors().nth(4).map(|dir| dir.join("gptcode-runtime/worker.mjs"))) } else { None })
            .or_else(|| Some(resource.join("worker.mjs")))
            .ok_or("Runtime GPTCode non configurato dal launcher")?;
        if !std::path::Path::new(&script).is_file() { return Err("Runtime GPTCode non trovato".into()); }
        let script = crate::gptcode::ordinary_path(&script);
        let mut command = Command::new(node);
        command.arg(script).current_dir(&root).env("GPTCODE_WORKSPACE_ROOT", crate::gptcode::ordinary_path(&root))
            .env("GPTCODE_CLI_PATH", crate::gptcode::cli_path()?)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        if let Some(profile) = std::env::var_os("GPTCODE_PROFILE_ROOT") {
            command.env("HOME", &profile).env("USERPROFILE", profile);
        }
        if cfg!(feature = "qa-webview") && std::env::var_os("GPTCODE_QA_HIDDEN").is_some() { command.stderr(Stdio::inherit()); }
        hidden(&mut command);
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        #[cfg(windows)]
        let job = match ProcessJob::attach(&child) { Ok(job) => job, Err(error) => { let _ = child.kill(); let _ = child.wait(); return Err(format!("Impossibile sorvegliare i processi GPTCode: {error}")); } };
        let input = child.stdin.take();
        let stdout = child.stdout.take().ok_or("Runtime senza stdout")?;
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let reader_pending = pending.clone();
        let event_root = crate::gptcode::ordinary_path(&root).to_string_lossy().to_string();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(mut value) = serde_json::from_str::<Value>(&line) else { continue };
                if let Some(id) = value.get("id").and_then(Value::as_u64) {
                    if let Some(sender) = reader_pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
                        let result = if let Some(error) = value.get("error").and_then(Value::as_str) { Err(error.to_string()) }
                            else { Ok(value.get("result").cloned().unwrap_or(Value::Null)) };
                        let _ = sender.send(result);
                    }
                } else if value.get("event").and_then(Value::as_str).is_some() {
                    value["root"] = Value::String(event_root.clone());
                    let _ = app.emit("gptcode-runtime-event", value);
                }
            }
            for (_, sender) in reader_pending.lock().unwrap_or_else(|e| e.into_inner()).drain() {
                let _ = sender.send(Err("Runtime GPTCode disconnesso".into()));
            }
            let _ = app.emit("gptcode-runtime-event", json!({"event":"runtime.closed","payload":{},"root":event_root}));
        });
        Ok(Self { child, input, pending, next: 1, root,
            #[cfg(windows)]
            _job: job,
        })
    }
    fn request(&mut self, method: String, data: Value) -> Result<(u64, mpsc::Receiver<Result<Value, String>>), String> {
        let id = self.next; self.next += 1;
        let (tx, rx) = mpsc::channel();
        self.pending.lock().map_err(|e| e.to_string())?.insert(id, tx);
        let bytes = serde_json::to_vec(&json!({"id":id,"method":method,"data":data})).map_err(|e| e.to_string())?;
        let result = (|| {
            let input = self.input.as_mut().ok_or("Runtime chiuso")?;
            input.write_all(&bytes).map_err(|e| e.to_string())?;
            input.write_all(b"\n").map_err(|e| e.to_string())?;
            input.flush().map_err(|e| e.to_string())
        })();
        if let Err(error) = result { self.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id); return Err(error); }
        Ok((id, rx))
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        // Closing stdin requests a graceful stop of chat, LSP and Inspector children.
        drop(self.input.take());
        for _ in 0..20 {
            if self.child.try_wait().ok().flatten().is_some() { return; }
            std::thread::sleep(Duration::from_millis(100));
        }
        #[cfg(windows)]
        if self.child.try_wait().ok().flatten().is_none() {
            let mut command = Command::new("taskkill.exe");
            command.args(["/PID", &self.child.id().to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
            hidden(&mut command); let _ = command.status();
        }
        let _ = self.child.kill(); let _ = self.child.wait();
    }
}
impl Runtime { pub fn stop(&self) { self.0.lock().unwrap_or_else(|e| e.into_inner()).take(); } }

#[tauri::command]
pub async fn gptcode_runtime(app: AppHandle, workspace: State<'_, crate::gptcode::Workspace>, state: State<'_, Arc<Runtime>>, method: String, data: Option<Value>) -> Result<Value, String> {
    let root = workspace.0.lock().map_err(|e| e.to_string())?.clone().ok_or("Apri un progetto")?;
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (id, rx, pending) = {
            let mut guard = runtime.0.lock().map_err(|e| e.to_string())?;
            if guard.as_mut().is_some_and(|worker| worker.child.try_wait().ok().flatten().is_some()) { guard.take(); }
            if guard.as_ref().is_some_and(|worker| worker.root != root) { guard.take(); }
            if guard.is_none() { *guard = Some(Worker::start(app, root)?); }
            let worker = guard.as_mut().unwrap();
            let (id, rx) = worker.request(method, data.unwrap_or_else(|| json!({})))?;
            (id, rx, worker.pending.clone())
        };
        match rx.recv_timeout(Duration::from_secs(60)) {
            Ok(value) => value,
            Err(_) => { pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id); Err("Timeout del runtime GPTCode".into()) }
        }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn gptcode_runtime_stop(state: State<'_, Arc<Runtime>>) -> Result<(), String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.stop()).await.map_err(|e| e.to_string())
}
