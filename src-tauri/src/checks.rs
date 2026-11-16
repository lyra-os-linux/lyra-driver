//! Teste após reiniciar: verificações sem privilégio que confirmam que o
//! driver NVIDIA está em uso.

use std::path::Path;

use serde::Serialize;

use crate::detect::run;

#[derive(Debug, Clone, Serialize)]
pub struct Check {
    id: &'static str,
    title: &'static str,
    /// "pass", "fail" ou "warn" (não impede o uso).
    state: &'static str,
    detail: String,
}

fn check(id: &'static str, title: &'static str, ok: bool, pass: String, fail: &str) -> Check {
    Check { id, title, state: if ok { "pass" } else { "fail" }, detail: if ok { pass } else { fail.to_owned() } }
}

/// O driver ligado à placa NVIDIA no barramento PCI (vendor 0x10de, classe 0x03).
fn nvidia_bound_driver() -> Option<String> {
    for entry in std::fs::read_dir("/sys/bus/pci/devices").ok()?.flatten() {
        let path = entry.path();
        let read = |name: &str| std::fs::read_to_string(path.join(name)).unwrap_or_default();
        if read("vendor").trim() == "0x10de" && read("class").trim().starts_with("0x03") {
            return std::fs::read_link(path.join("driver"))
                .ok()
                .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()));
        }
    }
    None
}

pub fn run_checks() -> Vec<Check> {
    let module = std::fs::read_to_string("/sys/module/nvidia/version").map(|v| v.trim().to_owned()).ok();
    let smi = run("nvidia-smi", &["--query-gpu=name,memory.total,temperature.gpu", "--format=csv,noheader"]);
    let bound = nvidia_bound_driver();
    let modeset = std::fs::read_to_string("/sys/module/nvidia_drm/parameters/modeset").map(|v| v.trim() == "Y").unwrap_or(false);
    let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();

    let mut checks = vec![
        check("module", "Módulo do kernel carregado", module.is_some(), format!("nvidia {}", module.clone().unwrap_or_default()), "O módulo nvidia não está carregado"),
        check("smi", "Placa responde ao nvidia-smi", smi.is_some(), smi.clone().unwrap_or_default().replace(", ", " · "), "Sem resposta: a placa não está usando o driver"),
        check(
            "bound",
            "Placa usando o driver NVIDIA",
            bound.as_deref() == Some("nvidia"),
            "Driver nvidia ligado à placa".into(),
            match bound.as_deref() {
                Some("nouveau") => "A placa ainda usa o driver livre nouveau",
                _ => "Nenhum driver ligado à placa",
            },
        ),
        check("session", "Sessão Wayland com modeset", modeset && session == "wayland", "Ativa, com modeset do DRM ligado".into(), "Modeset do DRM desligado ou sessão fora do Wayland"),
    ];
    if crate::detect::secure_boot() {
        checks.push(check("secureboot", "Secure Boot", module.is_some(), "Ligado, e o módulo assinado foi aceito".into(), "Ligado, e o módulo não carregou"));
    } else {
        checks.push(Check { id: "secureboot", title: "Secure Boot", state: "warn", detail: "Desligado".into() });
    }
    // A sessão sem modeset não impede o uso do driver.
    if let Some(c) = checks.iter_mut().find(|c| c.id == "session" && c.state == "fail") {
        c.state = "warn";
    }
    checks
}

/// O helper grava em PENDING_TEST o boot_id da instalação. O teste fica
/// pendente depois de um reinício (boot_id diferente) até o usuário rodá-lo;
/// a marca de "testado" fica no estado do próprio usuário, sem privilégio.
fn state_file() -> Option<std::path::PathBuf> {
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| Path::new(&h).join(".local/state")))?;
    Some(base.join("lyra-driver/last-tested"))
}

fn boot_id() -> String {
    std::fs::read_to_string("/proc/sys/kernel/random/boot_id").unwrap_or_default().trim().to_owned()
}

pub fn pending() -> bool {
    let Ok(stamp) = std::fs::read_to_string(crate::detect::PENDING_TEST) else { return false };
    let stamp = stamp.trim();
    let tested = state_file().and_then(|f| std::fs::read_to_string(f).ok()).unwrap_or_default();
    !stamp.is_empty() && stamp != boot_id() && tested.trim() != stamp
}

pub fn mark_tested() {
    let (Ok(stamp), Some(file)) = (std::fs::read_to_string(crate::detect::PENDING_TEST), state_file()) else { return };
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(file, stamp.trim());
}
