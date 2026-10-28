//! GPTCode workbench filesystem. The native picker/launcher owns the root.
use serde::Serialize;
use std::{fs, io::Write, path::{Path, PathBuf}, sync::Mutex};
use tauri::State;

const LIMIT: u64 = 4 * 1024 * 1024;
#[derive(Default)]
pub struct Workspace(pub Mutex<Option<PathBuf>>);
#[derive(Default)]
pub struct EditorDirty(pub Mutex<bool>);

pub fn ordinary_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") { PathBuf::from(format!(r"\\{unc}")) }
    else { PathBuf::from(text.trim_start_matches(r"\\?\")) }
}

pub fn cli_path() -> Result<PathBuf, String> {
    let path = std::env::var_os("GPTCODE_CLI_PATH").map(PathBuf::from).or_else(|| {
        std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))
            .map(|home| PathBuf::from(home).join(".cline/data/workspaces/chat/gptcode/bin/gptcode.mjs"))
    }).ok_or("Collega l’installazione GPTCode tramite il launcher")?;
    let path = fs::canonicalize(path).map_err(|_| "GPTCode CLI non trovato: usa il launcher con -CliPath")?;
    let manifest = path.parent().and_then(Path::parent).ok_or("Percorso CLI non valido")?.join("package.json");
    let package: serde_json::Value = serde_json::from_slice(&fs::read(manifest).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if package.get("name").and_then(serde_json::Value::as_str) != Some("gptcode") { return Err("Il file scelto non appartiene a GPTCode".into()); }
    Ok(ordinary_path(&path))
}

#[tauri::command]
pub fn gptcode_dirty(state: State<EditorDirty>, dirty: bool) { *state.0.lock().unwrap_or_else(|e| e.into_inner()) = dirty; }
#[derive(Serialize)]
pub struct Entry { name: String, path: String, directory: bool }

fn checked(root: &Path, path: &str) -> Result<PathBuf, String> {
    let target = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !target.starts_with(root) { return Err("File fuori dal progetto".into()); }
    Ok(target)
}
fn read_text(path: &Path) -> Result<String, String> {
    if !path.is_file() || fs::metadata(path).map_err(|e| e.to_string())?.len() > LIMIT {
        return Err("Apri un file di testo inferiore a 4 MiB".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.contains(&0) { return Err("File binario: modifica non disponibile".into()); }
    String::from_utf8(bytes).map_err(|_| "Il file non usa UTF-8".into())
}
fn save_text(path: &Path, expected: &str, content: &str) -> Result<(), String> {
    if content.len() as u64 > LIMIT { return Err("File superiore a 4 MiB".into()); }
    if read_text(path)? != expected {
        return Err("CONFLICT: il file è cambiato su disco. Copia le tue modifiche, poi ricarica il file.".into());
    }
    let temporary = path.with_file_name(format!(".gptcode-save-{}-{}", std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
        file.set_permissions(fs::metadata(path).map_err(|e| e.to_string())?.permissions()).map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        // Recheck after writing the temporary copy, before replacing the original.
        if read_text(path)? != expected { return Err("CONFLICT: file modificato durante il salvataggio".into()); }
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

#[tauri::command]
pub fn gptcode_workspace(state: State<Workspace>, root: Option<String>) -> Result<String, String> {
    let mut active = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(root) = root {
        let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
        if !root.is_dir() { return Err("Scegli una cartella".into()); }
        *active = Some(root);
    }
    if active.is_none() {
        let Some(root) = std::env::var_os("GPTCODE_WORKSPACE_ROOT") else { return Ok(String::new()); };
        *active = Some(fs::canonicalize(root).map_err(|e| e.to_string())?);
    }
    Ok(ordinary_path(active.as_ref().unwrap()).to_string_lossy().to_string())
}
#[tauri::command]
pub fn gptcode_entries(state: State<Workspace>, path: String) -> Result<Vec<Entry>, String> {
    let active = state.0.lock().map_err(|e| e.to_string())?;
    let root = active.as_ref().ok_or("Apri un progetto")?;
    let path = checked(root, &path)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if matches!(name.as_str(), ".git" | "node_modules" | "target" | ".next") { continue; }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() { continue; }
        entries.push(Entry { name, path: entry.path().to_string_lossy().trim_start_matches(r"\\?\").to_string(), directory: kind.is_dir() });
        if entries.len() >= 5000 { return Err("Cartella troppo grande: oltre 5000 elementi".into()); }
    }
    entries.sort_by(|a, b| b.directory.cmp(&a.directory).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}
#[tauri::command]
pub fn gptcode_read(state: State<Workspace>, path: String) -> Result<String, String> {
    let active = state.0.lock().map_err(|e| e.to_string())?;
    read_text(&checked(active.as_ref().ok_or("Apri un progetto")?, &path)?)
}
#[tauri::command]
pub fn gptcode_save(state: State<Workspace>, path: String, expected: String, content: String) -> Result<(), String> {
    let active = state.0.lock().map_err(|e| e.to_string())?;
    save_text(&checked(active.as_ref().ok_or("Apri un progetto")?, &path)?, &expected, &content)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn converts_windows_resource_paths_for_node() {
        assert_eq!(ordinary_path(Path::new(r"\\?\D:\app\worker.mjs")), PathBuf::from(r"D:\app\worker.mjs"));
        assert_eq!(ordinary_path(Path::new(r"\\?\UNC\server\share\file")), PathBuf::from(r"\\server\share\file"));
    }
    #[test]
    fn saves_utf8_and_rejects_external_changes() {
        let dir = std::env::temp_dir().join(format!("gptcode-save-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("test.txt");
        fs::write(&file, "prima\r\n").unwrap();
        save_text(&file, "prima\r\n", "caffè\r\n").unwrap();
        assert_eq!(read_text(&file).unwrap(), "caffè\r\n");
        fs::write(&file, "agente").unwrap();
        assert!(save_text(&file, "caffè\r\n", "editor").unwrap_err().contains("CONFLICT"));
        assert_eq!(read_text(&file).unwrap(), "agente");
        let root = fs::canonicalize(&dir).unwrap();
        assert!(checked(&root, std::env::temp_dir().to_str().unwrap()).is_err());
        fs::write(&file, [0, 1, 2]).unwrap();
        assert!(read_text(&file).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
