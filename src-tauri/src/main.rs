#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod checks;
mod detect;

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

use tauri::{AppHandle, Emitter};

const HELPER: &str = "/usr/libexec/lyra-driver/lyra-driver-helper";
const ACTIONS: [&str; 4] = ["install", "update", "reinstall", "remove"];

#[tauri::command]
async fn overview() -> Result<detect::Overview, String> {
    tauri::async_runtime::spawn_blocking(detect::overview).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn run_checks() -> Result<Vec<checks::Check>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let result = checks::run_checks();
        checks::mark_tested();
        result
    })
    .await
    .map_err(|e| e.to_string())
}

/// Roda uma ação pelo helper com pkexec e repassa cada linha da saída à
/// interface no evento "helper". A lista de ações é fechada aqui e no helper.
#[tauri::command]
async fn run_action(app: AppHandle, action: String) -> Result<(), String> {
    if !ACTIONS.contains(&action.as_str()) {
        return Err(format!("ação desconhecida: {action}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        // Só em compilação de desenvolvimento dá para apontar outro helper.
        let helper = if cfg!(debug_assertions) {
            std::env::var("LYRA_DRIVER_HELPER").unwrap_or_else(|_| HELPER.to_owned())
        } else {
            HELPER.to_owned()
        };
        let mut child = Command::new("pkexec")
            .args([helper.as_str(), action.as_str()])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("não foi possível iniciar o pkexec: {e}"))?;
        let stderr = child.stderr.take().map(|err| {
            let app = app.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(err).lines().map_while(Result::ok) {
                    let _ = app.emit("helper", line);
                }
            })
        });
        let mut error = None;
        if let Some(out) = child.stdout.take() {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                if let Some(message) = line.strip_prefix("@error ") {
                    error = Some(message.to_owned());
                }
                let _ = app.emit("helper", line);
            }
        }
        if let Some(handle) = stderr {
            let _ = handle.join();
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        match status.code() {
            Some(0) => Ok(()),
            // pkexec: 126 = autenticação cancelada ou negada; 127 = não autorizado.
            Some(126) | Some(127) if error.is_none() => Err("Autenticação cancelada ou não autorizada.".into()),
            _ => Err(error.unwrap_or_else(|| "A ação falhou. Veja os detalhes técnicos.".into())),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn reboot() -> Result<(), String> {
    Command::new("systemctl")
        .arg("reboot")
        .status()
        .map_err(|e| e.to_string())?
        .success()
        .then_some(())
        .ok_or_else(|| "Não foi possível reiniciar.".into())
}

fn main() {
    // Chamado pelo autostart depois do login: só abre se há teste pendente.
    if std::env::args().any(|a| a == "--check-pending") && !checks::pending() {
        return;
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![overview, run_checks, run_action, reboot])
        .run(tauri::generate_context!())
        .expect("error while running Lyra Driver");
}
