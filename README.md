# Lyra Driver

Instala, testa e mantém drivers de terceiros no Lyra OS, começando pelo driver
NVIDIA (pacotes oficiais da NVIDIA para o openSUSE Leap 16.1).

**Estado:** em desenvolvimento; a versão 0.1.0 é publicada no OBS como RPM
(`home:rodrigosbrito:lyra`).

- `src-tauri/src/detect.rs`: detecção sem privilégio (placa, ramo G07/G06,
  Secure Boot, notebook híbrido, integração antiga `lyra-nvidia`).
- `src-tauri/src/checks.rs`: teste após reiniciar.
- `helper/lyra-driver-helper`: ações privilegiadas (install, update,
  reinstall, remove), chamadas por `pkexec`; detecta a placa sozinho e confere
  a chave da NVIDIA antes de importá-la.
- `data/org.lyraos.driver.policy`: ação polkit `org.lyraos.driver.manage`
  (`auth_admin`, só sessão ativa).

## Testes

```bash
cd src-tauri && cargo test     # tabela de gerações e parser do lspci
bash tests/helper.sh           # helper sem root: gerações, recusas e polkit
```

## Executar em desenvolvimento

```bash
cd src-tauri
LYRA_DRIVER_HELPER=$PWD/../helper/lyra-driver-helper cargo run
```

As ações são reais: o helper roda como root depois da senha de
administrador. `LYRA_DRIVER_HELPER` só vale em compilação de desenvolvimento;
a de release usa sempre `/usr/libexec/lyra-driver/lyra-driver-helper`.
