//! Detecção sem privilégio: placas, geração do driver NVIDIA, Secure Boot e o
//! que já está instalado. As regras vêm do guia do fórum (Discussions #234 e
//! #366) e do cartão NVIDIA do Vega (vega-gtk/src/backend/nvidia.rs); o
//! helper privilegiado repete a mesma tabela e não confia no que a interface
//! manda.

use std::path::Path;
use std::process::{Command, Stdio};

use serde::Serialize;

pub const G07: &str = "nvidia-open-driver-G07-signed-kmp-meta";
pub const G06: &str = "nvidia-driver-G06-kmp-meta";
pub const REPO_FILE: &str = "/etc/zypp/repos.d/repo-nvidia.repo";
pub const PENDING_TEST: &str = "/var/lib/lyra-driver/pending-test";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Device {
    /// "gpu" ou "wifi".
    kind: String,
    vendor: String,
    model: String,
    /// "nvidia" (o app cuida), "ok" (driver livre basta) ou "soon" (suporte futuro).
    status: String,
    /// Driver do kernel em uso, quando há.
    driver: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NvidiaPlan {
    /// "g07", "g06", "legacy" (sem driver para o Leap 16) ou "none".
    generation: String,
    chip: String,
    model: String,
    package: String,
    secure_boot: bool,
    /// G06 com Secure Boot: o pacote registra a chave MOK com a senha de
    /// root, bloqueada no Lyra; o guia manda desligar o Secure Boot antes.
    blocked_by_secure_boot: bool,
    /// Notebook híbrido anterior à Ampere: recebe NVreg_DynamicPowerManagement.
    hybrid_pre_ampere: bool,
    /// Sobrou a integração antiga do Vega: a instalação faz a migração.
    lyra_nvidia: bool,
    installed: bool,
    installed_version: String,
    repo_configured: bool,
    /// Módulo carregado agora (/sys/module/nvidia).
    loaded_version: String,
    pending_test: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Overview {
    host: String,
    devices: Vec<Device>,
    nvidia: NvidiaPlan,
    lspci: String,
}

/// Geração do driver pela família do chip (TU/GA/AD/GH/GB: G07 aberto;
/// GM/GP/GV: G06; GK, GF e anteriores: sem driver no Leap 16).
pub fn generation(chip: &str) -> &'static str {
    match chip.get(..2) {
        Some("TU" | "GA" | "AD" | "GH" | "GB") => "g07",
        Some("GM" | "GP" | "GV") => "g06",
        _ => "legacy",
    }
}

fn is_display(line: &str) -> bool {
    line.contains("VGA compatible controller") || line.contains("3D controller") || line.contains("Display controller")
}

/// Primeira placa NVIDIA de vídeo do `lspci -nn`: (chip, modelo, é 3D controller).
pub fn parse_nvidia(out: &str) -> Option<(String, String, bool)> {
    out.lines()
        .filter(|line| line.contains("NVIDIA") && is_display(line))
        .find_map(|line| {
            let after = line.split("NVIDIA Corporation").nth(1)?.trim();
            let chip = after.split_whitespace().next().filter(|word| {
                let bytes = word.as_bytes();
                bytes.len() >= 4 && bytes[..2].iter().all(u8::is_ascii_uppercase) && bytes[2].is_ascii_digit()
            })?;
            Some((chip.to_owned(), bracket_name(after).unwrap_or_else(|| chip.to_owned()), line.contains("3D controller")))
        })
}

/// Texto do primeiro `[...]` que não seja o código de classe nem o ID.
fn bracket_name(text: &str) -> Option<String> {
    text.split('[')
        .skip(1)
        .filter_map(|part| part.split_once(']').map(|(name, _)| name))
        .find(|name| !name.chars().all(|c| c.is_ascii_hexdigit() || c == ':'))
        .map(str::to_owned)
}

/// Lista de dispositivos que interessam ao app: vídeo e Wi-Fi Broadcom.
pub fn parse_devices(out: &str) -> Vec<Device> {
    let mut devices = Vec::new();
    for line in out.lines() {
        let Some((_, desc)) = line.split_once("]: ") else { continue };
        let name = desc.rsplit_once(" [").map_or(desc, |(name, _)| name);
        let name = name.split(" (rev").next().unwrap_or(name).trim();
        let (vendor, model) = split_vendor(name);
        if is_display(line) {
            let status = if vendor == "NVIDIA" { "nvidia" } else { "ok" };
            devices.push(Device { kind: "gpu".into(), vendor, model, status: status.into(), driver: String::new() });
        } else if line.contains("[0280]") && line.contains("[14e4:") {
            devices.push(Device { kind: "wifi".into(), vendor, model, status: "soon".into(), driver: String::new() });
        }
    }
    devices
}

fn split_vendor(name: &str) -> (String, String) {
    let vendors = [
        ("NVIDIA Corporation", "NVIDIA"),
        ("Intel Corporation", "Intel"),
        ("Advanced Micro Devices, Inc. [AMD/ATI]", "AMD"),
        ("Broadcom Inc. and subsidiaries", "Broadcom"),
    ];
    for (long, short) in vendors {
        if let Some(rest) = name.strip_prefix(long) {
            let rest = rest.trim();
            let model = bracket_name(rest).unwrap_or_else(|| rest.to_owned());
            return (short.into(), format!("{short} {model}"));
        }
    }
    let vendor = name.split_whitespace().next().unwrap_or("").to_owned();
    (vendor, name.to_owned())
}

/// Driver do kernel ligado a cada placa, na ordem do lspci (endereço curto).
fn kernel_driver(slot: &str) -> String {
    let slot = if slot.matches(':').count() == 2 { slot.to_owned() } else { format!("0000:{slot}") };
    std::fs::read_link(format!("/sys/bus/pci/devices/{slot}/driver"))
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_default()
}

pub fn secure_boot() -> bool {
    std::fs::read_dir("/sys/firmware/efi/efivars")
        .ok()
        .and_then(|entries| entries.flatten().find(|e| e.file_name().to_string_lossy().starts_with("SecureBoot-")))
        .and_then(|entry| std::fs::read(entry.path()).ok())
        .is_some_and(|data| data.last() == Some(&1))
}

pub fn run(program: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(program).args(args).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned())
}

fn rpm_version(name: &str) -> Option<String> {
    run("rpm", &["-q", "--qf", "%{VERSION}", name])
}

pub fn lspci() -> String {
    run("lspci", &["-nn"]).unwrap_or_default()
}

pub fn plan_from(lspci: &str) -> NvidiaPlan {
    let (chip, model, is_3d) = parse_nvidia(lspci).unwrap_or_default();
    let generation = if chip.is_empty() { "none" } else { generation(&chip) };
    let package = match generation {
        "g07" => G07,
        "g06" => G06,
        _ => "",
    };
    let secure_boot = secure_boot();
    let other_gpu = lspci.lines().any(|l| is_display(l) && !l.contains("NVIDIA"));
    let pre_ampere = matches!(chip.get(..2), Some("TU" | "GM" | "GP" | "GV"));
    let installed_version = [G07, G06].iter().find_map(|p| rpm_version(p)).unwrap_or_default();
    NvidiaPlan {
        generation: generation.into(),
        chip,
        model,
        package: package.into(),
        secure_boot,
        blocked_by_secure_boot: generation == "g06" && secure_boot,
        hybrid_pre_ampere: pre_ampere && (is_3d || other_gpu),
        lyra_nvidia: rpm_version("lyra-nvidia").is_some() || Path::new("/etc/zypp/repos.d/lyra-nvidia.repo").exists(),
        installed: !installed_version.is_empty(),
        installed_version,
        repo_configured: Path::new(REPO_FILE).exists(),
        loaded_version: std::fs::read_to_string("/sys/module/nvidia/version").map(|v| v.trim().to_owned()).unwrap_or_default(),
        pending_test: crate::checks::pending(),
    }
}

pub fn overview() -> Overview {
    let lspci = lspci();
    let mut devices = parse_devices(&lspci);
    let slots: Vec<&str> = lspci
        .lines()
        .filter(|l| is_display(l) || (l.contains("[0280]") && l.contains("[14e4:")))
        .filter_map(|l| l.split_whitespace().next())
        .collect();
    for (device, slot) in devices.iter_mut().zip(slots) {
        device.driver = kernel_driver(slot);
    }
    let host = std::fs::read_to_string("/etc/hostname").map(|h| h.trim().to_owned()).unwrap_or_default();
    Overview { host, nvidia: plan_from(&lspci), devices, lspci }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generations_follow_the_forum_guide() {
        let cases = [
            ("01:00.0 VGA compatible controller [0300]: NVIDIA Corporation TU106 [GeForce RTX 2060] [10de:1f08] (rev a1)", "g07", "GeForce RTX 2060"),
            ("01:00.0 VGA compatible controller [0300]: NVIDIA Corporation GA106 [GeForce RTX 3060] [10de:2504] (rev a1)", "g07", "GeForce RTX 3060"),
            ("01:00.0 VGA compatible controller [0300]: NVIDIA Corporation AD107M [GeForce RTX 4060 Max-Q / Mobile] [10de:28e0] (rev a1)", "g07", "GeForce RTX 4060 Max-Q / Mobile"),
            ("01:00.0 VGA compatible controller [0300]: NVIDIA Corporation TU117 [GeForce GTX 1650] [10de:1f82] (rev a1)", "g07", "GeForce GTX 1650"),
            ("01:00.0 3D controller [0302]: NVIDIA Corporation GP107M [GeForce GTX 1050 Mobile] [10de:1c8d] (rev a1)", "g06", "GeForce GTX 1050 Mobile"),
            ("01:00.0 VGA compatible controller [0300]: NVIDIA Corporation GM107 [GeForce GTX 750 Ti] [10de:1380] (rev a2)", "g06", "GeForce GTX 750 Ti"),
            ("01:00.0 VGA compatible controller [0300]: NVIDIA Corporation GK104 [GeForce GTX 680] [10de:1180] (rev a1)", "legacy", "GeForce GTX 680"),
        ];
        for (line, want, model) in cases {
            let (chip, got_model, _) = parse_nvidia(line).expect(line);
            assert_eq!(generation(&chip), want, "{line}");
            assert_eq!(got_model, model);
        }
    }

    #[test]
    fn ignores_audio_and_other_vendors() {
        let out = "00:02.0 VGA compatible controller [0300]: Intel Corporation Alder Lake-P GT2 [8086:46a6]\n\
                   01:00.1 Audio device [0403]: NVIDIA Corporation TU106 High Definition Audio Controller [10de:10f9]\n";
        assert_eq!(parse_nvidia(out), None);
    }

    #[test]
    fn hybrid_laptop_is_3d_controller() {
        let (_, _, is_3d) = parse_nvidia("01:00.0 3D controller [0302]: NVIDIA Corporation TU117M [GeForce GTX 1650 Mobile / Max-Q] [10de:1f9d] (rev a1)").unwrap();
        assert!(is_3d);
    }

    #[test]
    fn lists_gpus_and_broadcom_wifi() {
        let out = "00:02.0 VGA compatible controller [0300]: Intel Corporation CoffeeLake-S GT2 [UHD Graphics 630] [8086:3e92]\n\
                   01:00.0 VGA compatible controller [0300]: NVIDIA Corporation GA106 [GeForce RTX 3060] [10de:2504] (rev a1)\n\
                   01:00.1 Audio device [0403]: NVIDIA Corporation GA106 High Definition Audio Controller [10de:228e] (rev a1)\n\
                   03:00.0 Network controller [0280]: Broadcom Inc. and subsidiaries BCM4360 802.11ac Dual Band Wireless Network Adapter [14e4:43a0] (rev 03)\n\
                   04:00.0 Network controller [0280]: Intel Corporation Wi-Fi 6 AX200 [8086:2723] (rev 1a)\n";
        let devices = parse_devices(out);
        let names: Vec<(&str, &str)> = devices.iter().map(|d| (d.model.as_str(), d.status.as_str())).collect();
        assert_eq!(
            names,
            [
                ("Intel UHD Graphics 630", "ok"),
                ("NVIDIA GeForce RTX 3060", "nvidia"),
                ("Broadcom BCM4360 802.11ac Dual Band Wireless Network Adapter", "soon"),
            ]
        );
    }
}
