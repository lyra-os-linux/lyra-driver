#!/bin/bash
# Testes do helper sem root: tabela de gerações e recusas (teste negativo de
# autorização). Rodar como usuário comum: bash tests/helper.sh
set -uo pipefail
cd "$(dirname "$0")/.."
helper=helper/lyra-driver-helper
policy=data/org.lyraos.driver.policy
failures=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

expect() { # descrição, esperado, obtido
  if [[ $2 == "$3" ]]; then echo "ok   $1"; else echo "FALHA $1: esperado '$2', obtido '$3'"; failures=$((failures + 1)); fi
}

if [[ $EUID -eq 0 ]]; then echo "rode como usuário comum" >&2; exit 2; fi

# Tabela de gerações (mesmos casos de src-tauri/src/detect.rs)
while IFS='|' read -r want line; do
  printf '%s\n' "$line" >"$tmp/lspci"
  got=$(LYRA_DRIVER_LSPCI_FILE="$tmp/lspci" "$helper" plan | cut -d' ' -f1)
  expect "geração $want: ${line:40:40}" "$want" "$got"
done <<'CASES'
g07|01:00.0 VGA compatible controller [0300]: NVIDIA Corporation TU106 [GeForce RTX 2060] [10de:1f08] (rev a1)
g07|01:00.0 VGA compatible controller [0300]: NVIDIA Corporation GA106 [GeForce RTX 3060] [10de:2504] (rev a1)
g07|01:00.0 VGA compatible controller [0300]: NVIDIA Corporation AD107M [GeForce RTX 4060 Max-Q / Mobile] [10de:28e0] (rev a1)
g06|01:00.0 3D controller [0302]: NVIDIA Corporation GP107M [GeForce GTX 1050 Mobile] [10de:1c8d] (rev a1)
g06|01:00.0 VGA compatible controller [0300]: NVIDIA Corporation GM107 [GeForce GTX 750 Ti] [10de:1380] (rev a2)
legacy|01:00.0 VGA compatible controller [0300]: NVIDIA Corporation GK104 [GeForce GTX 680] [10de:1180] (rev a1)
none|01:00.1 Audio device [0403]: NVIDIA Corporation TU106 High Definition Audio Controller [10de:10f9]
CASES

# Recusas: sem root, toda ação privilegiada para antes de mexer no sistema.
for action in install update reinstall remove; do
  out=$("$helper" "$action" 2>&1); code=$?
  expect "sem root recusa $action (código)" 4 "$code"
  expect "sem root recusa $action (mensagem)" "@error Precisa ser executado como root, pelo pkexec." "$out"
done

# Uso inválido: ação fora da lista, argumentos extras, nenhum argumento.
for args in "rm-rf" "install extra" "" "--help" "install;id"; do
  # shellcheck disable=SC2086
  "$helper" $args >/dev/null 2>&1; code=$?
  expect "uso inválido '$args'" 2 "$code"
done

# Política polkit: só sessão ativa, sempre com senha de administrador.
expect "polkit allow_any" "no" "$(grep -oP '(?<=<allow_any>)[^<]+' "$policy")"
expect "polkit allow_inactive" "no" "$(grep -oP '(?<=<allow_inactive>)[^<]+' "$policy")"
expect "polkit allow_active" "auth_admin" "$(grep -oP '(?<=<allow_active>)[^<]+' "$policy")"
expect "polkit exec.path" "/usr/libexec/lyra-driver/lyra-driver-helper" "$(grep -oP '(?<=exec.path">)[^<]+' "$policy")"
if command -v xmllint >/dev/null; then
  xmllint --noout "$policy" 2>/dev/null; expect "polkit XML válido" 0 $?
fi

# Nunca confiar em chave sem conferir.
grep -v '^\s*#' "$helper" | grep -q -- '--gpg-auto-import-keys'; expect "sem --gpg-auto-import-keys" 1 $?

echo
[[ $failures -eq 0 ]] && echo "todos os testes passaram" || { echo "$failures falha(s)"; exit 1; }
