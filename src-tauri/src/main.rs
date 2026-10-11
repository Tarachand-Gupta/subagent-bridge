#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{io::Write, path::PathBuf, process::{Command, Stdio}};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

fn environment() -> (PathBuf, std::ffi::OsString) {
    let mut dirs: Vec<PathBuf> = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        dirs.insert(0,home.join(".local/bin"));
        dirs.push(home.join(".volta/bin"));
        if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            let mut versions: Vec<_> = entries.flatten().map(|e| e.path().join("bin")).collect();
            versions.sort(); versions.reverse(); dirs.extend(versions);
        }
    }
    dirs.extend([PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin"), PathBuf::from("/usr/bin"), PathBuf::from("/bin")]);
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
        let mut child = Command::new(node).arg(script).env("PATH",paths)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .spawn().map_err(|e|format!("Cannot start Node.js. Install Node 22+ or set HARNESS_BRIDGE_NODE. {e}"))?;
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
fn main(){
 tauri::Builder::default().plugin(tauri_plugin_dialog::init())
 .invoke_handler(tauri::generate_handler![bridge,pick_workspace])
 .run(tauri::generate_context!()).expect("Failed to start Harness Bridge");
}
