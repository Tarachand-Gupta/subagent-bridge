#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}, process::{Command, Stdio}, sync::atomic::{AtomicU64, Ordering}, time::{SystemTime, UNIX_EPOCH}};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

fn environment() -> (PathBuf, std::ffi::OsString) {
    let mut dirs: Vec<PathBuf> = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    if let Some(home) = std::env::var_os("HOME").or_else(||std::env::var_os("USERPROFILE")) {
        let home = PathBuf::from(home);
        dirs.insert(0,home.join(".local/bin"));
        dirs.push(home.join(".volta/bin"));
        if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            let mut versions: Vec<_> = entries.flatten().map(|e| e.path().join("bin")).collect();
            versions.sort(); versions.reverse(); dirs.extend(versions);
        }
    }
    if !cfg!(windows) { dirs.extend([PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin"), PathBuf::from("/usr/bin"), PathBuf::from("/bin")]); }
    if cfg!(windows) {
        for key in ["APPDATA", "LOCALAPPDATA", "ProgramFiles", "NVM_SYMLINK", "VOLTA_HOME"] {
            if let Some(value)=std::env::var_os(key) {
                let base=PathBuf::from(value);
                match key {
                    "APPDATA" => dirs.push(base.join("npm")),
                    "LOCALAPPDATA" => { dirs.push(base.join("Programs/nodejs")); dirs.push(base.join("Volta/bin")); },
                    "ProgramFiles" => dirs.push(base.join("nodejs")),
                    "VOLTA_HOME" => dirs.push(base.join("bin")),
                    _ => dirs.push(base),
                }
            }
        }
    }
    dirs.retain(|p| !p.as_os_str().is_empty());
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    let node = std::env::var_os("HARNESS_BRIDGE_NODE").map(PathBuf::from)
        .or_else(|| dirs.iter().map(|d| d.join(node_name)).find(|p| p.is_file()))
        .unwrap_or_else(|| PathBuf::from(node_name));
    if let Some(parent) = node.parent() { dirs.push(parent.to_path_buf()); }
    (node, std::env::join_paths(dirs).unwrap_or_default())
}
#[tauri::command]
async fn bridge(app: tauri::AppHandle, method: String, path: String, body: Option<serde_json::Value>) -> Result<serde_json::Value,String> {
    let resource = app.path().resource_dir().map_err(|e|e.to_string())?.join("backend/desktop-bridge.mjs");
    let script = if resource.exists() {resource} else {PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../desktop-bridge.mjs")};
    tauri::async_runtime::spawn_blocking(move || {
        let (node, paths) = environment();
        let mut command = Command::new(node);
        command.arg(script).env("PATH",paths).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn().map_err(|e|format!("Cannot start Node.js. Install Node 22+ or set HARNESS_BRIDGE_NODE. {e}"))?;
        let data=serde_json::json!({"method":method,"path":path,"body":body});
        child.stdin.take().ok_or("Missing child input")?.write_all(data.to_string().as_bytes()).map_err(|e|e.to_string())?;
        let output=child.wait_with_output().map_err(|e|e.to_string())?;
        let response:serde_json::Value=serde_json::from_slice(&output.stdout).map_err(|_|"Backend returned no valid response; check Node.js version".to_string())?;
        if let Some(error)=response.get("error"){return Err(error.as_str().unwrap_or("Backend error").to_string());}
        Ok(response["result"].clone())
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn pick_workspace(app:tauri::AppHandle)->Result<Option<String>,String>{
    tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder().map(|p|p.to_string())).await.map_err(|e|e.to_string())
}

const MAX_CONFIGURATION_BYTES: usize = 262144;
static EXPORT_COUNTER: AtomicU64 = AtomicU64::new(0);

fn read_configuration_file(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|_| "Could not open the selected configuration file.".to_string())?;
    let metadata = file.metadata().map_err(|_| "Could not inspect the selected configuration file.".to_string())?;
    if !metadata.is_file() { return Err("Select a regular JSON file.".into()); }
    if metadata.len() > MAX_CONFIGURATION_BYTES as u64 { return Err("Configuration exceeds the 256 KiB limit.".into()); }
    let mut bytes = Vec::new();
    file.take((MAX_CONFIGURATION_BYTES + 1) as u64).read_to_end(&mut bytes)
        .map_err(|_| "Could not read the selected configuration file.".to_string())?;
    if bytes.len() > MAX_CONFIGURATION_BYTES { return Err("Configuration exceeds the 256 KiB limit.".into()); }
    let text = String::from_utf8(bytes).map_err(|_| "Configuration must be a UTF-8 JSON file.".to_string())?;
    Ok(text.trim_start_matches('\u{feff}').to_string())
}

fn write_configuration_export(destination: &Path, text: &str) -> Result<(), String> {
    if text.len() > MAX_CONFIGURATION_BYTES { return Err("Configuration exceeds the 256 KiB limit.".into()); }
    let parent = destination.parent().ok_or("Choose a file in an existing folder.")?;
    let serial = EXPORT_COUNTER.fetch_add(1, Ordering::Relaxed);
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Could not prepare the export.".to_string())?.as_nanos();
    let temporary = parent.join(format!(".subagent-bridge-export-{}-{stamp}-{serial}.tmp", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|_| "Could not create the export in the selected folder.".to_string())?;
    let result = (|| {
        file.write_all(text.as_bytes()).map_err(|_| "Could not write the export. The previous file has not changed.".to_string())?;
        file.sync_all().map_err(|_| "Could not finish writing the export. The previous file has not changed.".to_string())?;
        drop(file);
        fs::rename(&temporary, destination).map_err(|_| "Could not replace the selected file. The previous file has not changed.".to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

fn same_file_path(left: &Path, right: &Path) -> bool {
    let resolved = |path: &Path| fs::canonicalize(path).unwrap_or_else(|_| {
        path.parent().and_then(|parent| fs::canonicalize(parent).ok())
            .and_then(|parent| path.file_name().map(|name| parent.join(name)))
            .unwrap_or_else(|| path.to_path_buf())
    });
    resolved(left) == resolved(right)
}

#[tauri::command]
async fn import_configuration(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app.dialog().file().set_title("Import Subagent Bridge rules")
            .add_filter("JSON configuration", &["json"]).blocking_pick_file() else { return Ok(None); };
        let path = selected.into_path().map_err(|_| "Choose a local JSON file.".to_string())?;
        let text = read_configuration_file(&path)?;
        let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| "configuration.json".into());
        Ok(Some(serde_json::json!({"text": text, "name": name})))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_configuration(app: tauri::AppHandle, text: String) -> Result<Option<String>, String> {
    if text.len() > MAX_CONFIGURATION_BYTES { return Err("Configuration exceeds the 256 KiB limit.".into()); }
    let config: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| "Configuration must contain valid JSON.".to_string())?;
    let validated = bridge(app.clone(), "POST".into(), "/api/configuration/validate".into(), Some(serde_json::json!({"config": config}))).await?;
    let output = serde_json::to_string_pretty(&validated["config"]).map_err(|_| "Could not prepare the export.".to_string())? + "\n";
    if output.len() > MAX_CONFIGURATION_BYTES { return Err("Configuration exceeds the 256 KiB limit.".into()); }
    let paths = bridge(app.clone(), "GET".into(), "/api/configuration-path".into(), None).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app.dialog().file().set_title("Export Subagent Bridge rules")
            .add_filter("JSON configuration", &["json"]).set_file_name("subagent-bridge-rules.json")
            .blocking_save_file() else { return Ok(None); };
        let path = selected.into_path().map_err(|_| "Choose a local destination file.".to_string())?;
        for key in ["path", "draftPath"] {
            if let Some(known) = paths[key].as_str() {
                if same_file_path(&path, Path::new(known)) {
                    return Err("Choose an export location outside the active configuration files. Use Save Rules or Apply Rules to update those files.".into());
                }
            }
        }
        // Native save dialogs confirm overwrites before returning this destination.
        write_configuration_export(&path, &output)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|e| e.to_string())?
}

fn open_configuration_file(path: &Path) -> Result<(), String> {
    if !path.is_file() { return Err("The applied configuration file does not exist yet. Apply your rules first.".into()); }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "shell32")]
        extern "system" {
            fn ShellExecuteW(window: *mut std::ffi::c_void, operation: *const u16, file: *const u16, parameters: *const u16, directory: *const u16, show: i32) -> isize;
        }
        let operation: Vec<u16> = "open\0".encode_utf16().collect();
        let file: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        // ShellExecute opens the associated application; no command string is built.
        let status = unsafe { ShellExecuteW(std::ptr::null_mut(), operation.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), 1) };
        if status <= 32 { return Err("Could not open configuration.json. Set a default application for JSON files.".into()); }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let executable = if cfg!(target_os = "macos") { "/usr/bin/open" } else { "xdg-open" };
        let status = Command::new(executable).arg(path).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .status().map_err(|_| "Could not launch the default application for JSON files.".to_string())?;
        if !status.success() { return Err("Could not open config.json. Set a default application for JSON files.".into()); }
        Ok(())
    }
}

#[tauri::command]
async fn open_configuration(app: tauri::AppHandle) -> Result<(), String> {
    let paths = bridge(app, "GET".into(), "/api/configuration-path".into(), None).await?;
    let path = PathBuf::from(paths["path"].as_str().ok_or("Could not locate the active configuration.")?);
    tauri::async_runtime::spawn_blocking(move || open_configuration_file(&path)).await.map_err(|e| e.to_string())?
}

fn main(){
 tauri::Builder::default().plugin(tauri_plugin_dialog::init())
 .invoke_handler(tauri::generate_handler![bridge,pick_workspace,import_configuration,export_configuration,open_configuration])
 .run(tauri::generate_context!()).expect("Failed to start Subagent Bridge");
}

#[cfg(test)]
mod configuration_tests {
    use super::*;

    fn temporary_directory() -> PathBuf {
        let serial = EXPORT_COUNTER.fetch_add(1, Ordering::Relaxed);
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let directory = std::env::temp_dir().join(format!("bridge-config-transfer-{}-{stamp}-{serial}", std::process::id()));
        fs::create_dir(&directory).unwrap();
        directory
    }

    #[test]
    fn bounded_utf8_import_accepts_bom_and_rejects_invalid_or_oversized_files() {
        let directory = temporary_directory();
        let file = directory.join("rules.json");
        fs::write(&file, "\u{feff}{\"routes\":[],\"task\":\"研究\"}").unwrap();
        assert_eq!(read_configuration_file(&file).unwrap(), "{\"routes\":[],\"task\":\"研究\"}");
        fs::write(&file, vec![b' '; MAX_CONFIGURATION_BYTES]).unwrap();
        assert_eq!(read_configuration_file(&file).unwrap().len(), MAX_CONFIGURATION_BYTES);
        fs::write(&file, vec![b' '; MAX_CONFIGURATION_BYTES + 1]).unwrap();
        assert!(read_configuration_file(&file).unwrap_err().contains("256 KiB"));
        fs::write(&file, [0xff, 0xfe]).unwrap();
        assert!(read_configuration_file(&file).unwrap_err().contains("UTF-8"));
        assert_eq!(fs::read(&file).unwrap(), [0xff, 0xfe]);
        assert!(read_configuration_file(&directory).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn export_roundtrip_is_private_and_failed_exports_preserve_previous_files() {
        let directory = temporary_directory();
        let file = directory.join("rules.json");
        let text = "{\"routes\":[]}\n";
        write_configuration_export(&file, text).unwrap();
        assert_eq!(read_configuration_file(&file).unwrap(), text);
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
        }
        write_configuration_export(&file, "{\"routes\":[],\"version\":1}\n").unwrap();
        let before = fs::read(&file).unwrap();
        assert!(write_configuration_export(&file, &"x".repeat(MAX_CONFIGURATION_BYTES + 1)).is_err());
        assert_eq!(fs::read(&file).unwrap(), before);
        let existing_directory = directory.join("occupied.json");
        fs::create_dir(&existing_directory).unwrap();
        fs::write(existing_directory.join("keep.txt"), "preserved").unwrap();
        assert!(write_configuration_export(&existing_directory, text).is_err());
        assert_eq!(fs::read_to_string(existing_directory.join("keep.txt")).unwrap(), "preserved");
        assert!(fs::read_dir(&directory).unwrap().all(|entry| !entry.unwrap().file_name().to_string_lossy().contains(".tmp")));
        assert!(same_file_path(&file, &directory.join(".").join("rules.json")));
        assert!(open_configuration_file(&directory.join("missing.json")).unwrap_err().contains("does not exist"));
        fs::remove_dir_all(directory).unwrap();
    }
}
