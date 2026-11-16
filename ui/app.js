// Lyra Driver: interface. A detecção e o teste rodam sem privilégio
// (comandos overview e run_checks); instalar, atualizar, reinstalar e remover
// passam pelo helper com pkexec (run_action), que manda o progresso no
// evento "helper".

const $ = (id) => document.getElementById(id);
const tauri = window.__TAURI__;
const invoke = tauri.core.invoke;
const win = tauri.window.getCurrentWindow();

const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const icon = (name, cls = "") => `<svg class="i ${cls}"><use href="#i-${name}"/></svg>`;

// ---------- Tema: segue a preferência do sistema, como o Vega ----------
const dark = matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => (document.documentElement.dataset.theme = dark.matches ? "dark" : "light");
applyTheme();
dark.addEventListener("change", applyTheme);

// ---------- Janela (barra de título própria) ----------
const winActions = { min: () => win.minimize(), max: () => win.toggleMaximize(), close: () => win.close() };
for (const button of document.querySelectorAll("[data-wc]")) button.addEventListener("click", winActions[button.dataset.wc]);
document.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || !e.target.closest("[data-drag]") || e.target.closest("button, input, a")) return;
  if (e.detail === 2) win.toggleMaximize();
  else win.startDragging();
});
for (const dir of ["North", "South", "East", "West", "NorthEast", "NorthWest", "SouthEast", "SouthWest"]) {
  const edge = document.createElement("div");
  edge.className = "resize";
  edge.dataset.dir = dir;
  edge.addEventListener("mousedown", (e) => { e.preventDefault(); win.startResizeDragging(dir); });
  document.body.append(edge);
}

// ---------- Avisos ----------
function toast(text, kind = "check") {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span class="t-ic">${icon(kind)}</span>`;
  el.append(text);
  $("toasts").append(el);
  setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 200); }, 3200);
}

// ---------- Linhas que expandem ----------
document.addEventListener("click", (e) => {
  const row = e.target.closest("[data-expand]");
  if (!row) return;
  const open = row.getAttribute("aria-expanded") !== "true";
  row.setAttribute("aria-expanded", open);
  $(row.dataset.expand).hidden = !open;
});

// ---------- Estado ----------
let state = null;
let busy = false;
const BRANCH = { g07: "G07", g06: "G06" };

async function refresh() {
  try {
    state = await invoke("overview");
  } catch (err) {
    toast(`Não foi possível verificar os dispositivos: ${err}`, "alert");
    return;
  }
  renderSidebar();
  renderHome();
  renderInstall();
  renderManage();
}

function renderSidebar() {
  const nv = state.nvidia;
  $("host-name").textContent = state.host || "Este computador";
  const attention = nv.generation.startsWith("g0") && !nv.installed;
  $("nav-count").hidden = !attention;
  $("host-dot").className = "status-dot" + (attention || nv.pending_test ? " off" : "");
  $("host-status").textContent = nv.installed
    ? `NVIDIA ${nv.installed_version}`
    : attention ? "1 driver recomendado" : "Nada a instalar";
}

// ---------- Visão geral ----------
function deviceRow(d, nv) {
  const kindIcon = d.kind === "wifi" ? "wifi" : "gpu";
  if (d.status === "nvidia") {
    if (nv.generation === "legacy") {
      return row("", kindIcon, d.model, "Kepler ou anterior: sem driver NVIDIA para o Leap 16.1. Fica com o nouveau.", `<span class="badge outline">Sem driver</span>`);
    }
    if (nv.installed) {
      const active = nv.loaded_version ? `em uso: nvidia ${nv.loaded_version}` : "instalado, aguardando reinício";
      return row(nv.loaded_version ? "green" : "yellow", kindIcon, d.model, `Driver NVIDIA ${BRANCH[nv.generation]} · ${active}`,
        `<span class="badge ${nv.loaded_version ? "green" : "yellow"}">${nv.loaded_version ? "Em uso" : "Reinicie"}</span>${icon("chevron", "chev")}`, "#gerenciar");
    }
    return row("yellow", kindIcon, d.model, `Recomendado: NVIDIA ${BRANCH[nv.generation]} · em uso: ${d.driver || "nenhum driver"}`,
      `<span class="badge yellow">Recomendado</span>${icon("chevron", "chev")}`, "#instalar");
  }
  if (d.status === "soon") {
    return row("", kindIcon, d.model, "Precisa do driver proprietário broadcom-wl, que entra numa versão futura.", `<span class="badge outline">Em breve</span>`);
  }
  return row("green", kindIcon, d.model, `Driver livre do kernel${d.driver ? ` (${d.driver})` : ""}. Nada a fazer.`, `<span class="badge green">Em uso</span>`);
}

function row(tone, iconName, title, subtitle, suffix, href) {
  const tag = href ? `a class="list-row clickable" href="${href}"` : `div class="list-row"`;
  return `<${tag}><span class="lead ${tone}">${icon(iconName)}</span>
    <span class="body"><span class="title">${esc(title)}</span><span class="subtitle wrap">${esc(subtitle)}</span></span>
    <span class="suffix">${suffix}</span></${href ? "a" : "div"}>`;
}

function renderHome() {
  const nv = state.nvidia;
  const page = $("inicio");
  page.dataset.crumb = `${state.devices.length} dispositivo(s) verificado(s)`;
  if (!location.hash || location.hash === "#inicio") $("page-crumb").textContent = page.dataset.crumb;

  let hero = "";
  if (nv.pending_test) {
    hero = heroHtml("attention", "pulse", "Teste pendente", "Confirme que o driver está funcionando", "O driver foi instalado ou mudou desde o último reinício.", "#teste", "Testar agora");
  } else if (nv.generation.startsWith("g0") && !nv.installed) {
    const blocked = nv.blocked_by_secure_boot;
    hero = heroHtml("attention", "gpu", "1 driver recomendado", "Instale o driver da NVIDIA",
      blocked
        ? `Sua ${nv.model} usa o driver G06, que exige desligar o Secure Boot no Lyra OS. Veja os detalhes antes de instalar.`
        : `Sua ${nv.model} está sem aceleração completa. A instalação usa os pacotes oficiais da NVIDIA e pede um reinício.`,
      "#instalar", "Ver instalação");
  } else {
    const text = nv.installed ? `Driver NVIDIA ${nv.installed_version} instalado.` : "Os drivers livres do kernel já cuidam deste computador.";
    hero = heroHtml("", "check", "Tudo certo", "Nenhum driver a instalar", text, nv.installed ? "#gerenciar" : "", nv.installed ? "Gerenciar" : "");
  }
  $("home-hero").innerHTML = hero;

  const groups = { attention: [], ok: [], soon: [] };
  for (const d of state.devices) {
    const needs = d.status === "nvidia" && nv.generation.startsWith("g0") && (!nv.installed || !nv.loaded_version);
    groups[d.status === "soon" ? "soon" : needs ? "attention" : "ok"].push(deviceRow(d, nv));
  }
  const titles = { attention: "Precisa de atenção", ok: "Funcionando", soon: "Suporte em breve" };
  $("home-groups").innerHTML = Object.entries(groups)
    .filter(([, rows]) => rows.length)
    .map(([key, rows]) => `<div class="section"><div class="section-head"><h3>${titles[key]}</h3></div><div class="list">${rows.join("")}</div></div>`)
    .join("") || `<div class="section"><div class="empty"><h3>Nenhuma placa de vídeo encontrada</h3></div></div>`;

  $("lspci").innerHTML = state.lspci.split("\n").map((l) => `<div>${esc(l)}</div>`).join("");
}

function heroHtml(tone, iconName, eyebrow, title, text, href, label) {
  return `<div class="hero ${tone}"><div class="hero-ic">${icon(iconName, "lg")}</div>
    <div class="hero-body"><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(title)}</h2><p>${esc(text)}</p></div>
    ${href ? `<a class="btn pill" href="${href}">${esc(label)}</a>` : ""}</div>`;
}

// ---------- Instalar ----------
function stage(name) {
  const order = ["review", "progress", "done"];
  for (const s of document.querySelectorAll("#instalar .stage")) s.hidden = s.dataset.stage !== name;
  document.querySelectorAll(".stage-steps span").forEach((chip) => {
    const diff = order.indexOf(chip.dataset.stage) - order.indexOf(name);
    chip.className = diff < 0 ? "past" : diff === 0 ? "now" : "";
  });
}

function banner(kind, iconName, title, text) {
  return `<div class="banner ${kind}"><span class="ic">${icon(iconName)}</span><div class="body"><strong>${esc(title)}</strong><span>${esc(text)}</span></div></div>`;
}

function renderInstall() {
  if (busy) return;
  const nv = state.nvidia;
  const page = $("instalar");
  page.dataset.crumb = nv.model || "Nenhuma placa NVIDIA";
  $("install-sub").textContent = nv.generation.startsWith("g0")
    ? `${nv.model} · ramo ${BRANCH[nv.generation]} · pacotes oficiais da NVIDIA para o openSUSE Leap 16.1, seguindo o guia do fórum.`
    : "Pacotes oficiais da NVIDIA para o openSUSE Leap 16.1, seguindo o guia do fórum.";
  $("install-pkg-title").textContent = nv.package ? `Instalar o driver ${BRANCH[nv.generation]}` : "Instalar o driver";
  $("install-pkg").textContent = nv.package;

  const notes = [];
  let blocked = "";
  if (nv.generation === "none") blocked = "Nenhuma placa NVIDIA encontrada neste computador.";
  else if (nv.generation === "legacy") blocked = "Placas Kepler ou anteriores não têm driver NVIDIA para o Leap 16.1. Elas continuam com o nouveau.";
  else if (nv.installed) blocked = `O driver ${nv.installed_version} já está instalado. Use Gerenciar para atualizar, reinstalar ou remover.`;
  else if (nv.blocked_by_secure_boot) blocked = "O driver G06 registraria a chave no MOK com a senha de root, que é bloqueada no Lyra OS. Desligue o Secure Boot no firmware e abra o app de novo.";

  if (blocked) notes.push(banner("danger", "alert", nv.blocked_by_secure_boot ? "Desligue o Secure Boot antes" : "Não há o que instalar", blocked));
  else {
    if (nv.secure_boot) notes.push(banner("success", "shield", "Secure Boot ligado: tudo certo", "O driver G07 vem assinado pelo openSUSE. Não há senha nem tela azul do MOK."));
    if (nv.lyra_nvidia) notes.push(banner("warn", "refresh", "Migração da integração antiga do Vega", "O lyra-nvidia e o repositório antigo saem na mesma transação que instala o driver do guia."));
    if (nv.hybrid_pre_ampere) notes.push(banner("", "gpu", "Notebook com duas placas", "A instalação liga o gerenciamento de energia dinâmico da NVIDIA (NVreg_DynamicPowerManagement=0x02)."));
  }
  $("install-notes").innerHTML = notes.join("");
  $("install-start").disabled = Boolean(blocked);
}

// ---------- Ações pelo helper ----------
const ACTION_TEXT = {
  install: { busy: "Instalando", done: "Driver instalado", doneText: "Reinicie para começar a usar. Depois do login, o teste abre sozinho.", steps: 6 },
  update: { busy: "Atualizando", done: "Driver atualizado", doneText: "Reinicie para usar a versão nova. Depois do login, o teste abre sozinho.", steps: 4 },
  reinstall: { busy: "Reinstalando", done: "Driver reinstalado", doneText: "Reinicie para carregar o driver de novo. Depois do login, o teste abre sozinho.", steps: 3 },
  remove: { busy: "Removendo", done: "Driver removido", doneText: "Reinicie para voltar ao driver livre nouveau.", steps: 3 },
};
let current = null;

tauri.event.listen("helper", ({ payload: line }) => {
  if (!current) return;
  const step = /^@step (\d+) (.*)$/.exec(line);
  if (step) {
    const n = Number(step[1]);
    document.querySelectorAll("#action-steps .step.now").forEach((el) => {
      el.classList.replace("now", "done");
      el.querySelector(".suffix").innerHTML = icon("check");
    });
    $("action-steps").insertAdjacentHTML("beforeend",
      `<div class="list-row step now"><span class="lead">${icon("chevron")}</span><span class="body"><span class="title">${esc(step[2])}</span></span><span class="suffix"><span class="spinner"></span></span></div>`);
    $("progress-title").textContent = step[2] + "…";
    $("progress-hint").textContent = "Não desligue o computador. Dá para usar outros apps.";
    const pct = Math.round(((n - 1) / ACTION_TEXT[current].steps) * 100);
    $("progress-meter").classList.remove("indeterminate");
    $("progress-bar").style.width = pct + "%";
    $("progress-pct").textContent = pct + "%";
    return;
  }
  if (line === "@done" || line.startsWith("@error ")) return;
  const div = document.createElement("div");
  div.textContent = line;
  $("action-log").append(div);
  $("action-log").scrollTop = $("action-log").scrollHeight;
});

async function runAction(action) {
  if (busy) return;
  busy = true;
  current = action;
  location.hash = "#instalar";
  $("instalar").dataset.title = { install: "Instalar", update: "Atualizar", reinstall: "Reinstalar", remove: "Remover" }[action];
  show("instalar");
  stage("progress");
  $("action-steps").innerHTML = "";
  $("action-log").innerHTML = "";
  $("action-error").innerHTML = "";
  $("action-retry").hidden = true;
  $("progress-spinner").hidden = false;
  $("progress-title").textContent = "Aguardando autorização…";
  $("progress-hint").textContent = "Digite a senha de administrador na janela que abrir.";
  $("progress-pct").textContent = "";
  $("progress-bar").style.width = "";
  $("progress-meter").classList.add("indeterminate");

  try {
    await invoke("run_action", { action });
    document.querySelectorAll("#action-steps .step.now").forEach((el) => {
      el.classList.replace("now", "done");
      el.querySelector(".suffix").innerHTML = icon("check");
    });
    $("progress-meter").classList.remove("indeterminate");
    $("progress-bar").style.width = "100%";
    $("progress-pct").textContent = "100%";
    $("done-title").textContent = ACTION_TEXT[action].done;
    $("done-text").textContent = ACTION_TEXT[action].doneText;
    setTimeout(() => stage("done"), 500);
  } catch (err) {
    document.querySelectorAll("#action-steps .step.now").forEach((el) => {
      el.classList.replace("now", "failed");
      el.querySelector(".lead").className = "lead red";
      el.querySelector(".suffix").innerHTML = icon("x");
    });
    $("progress-meter").classList.remove("indeterminate");
    $("progress-spinner").hidden = true;
    $("progress-title").textContent = "Não foi concluído";
    $("progress-hint").textContent = "Nada foi desfeito automaticamente. Se a falha veio depois do ponto de restauração, você pode voltar a ele pelo Vega.";
    $("action-error").innerHTML = banner("danger", "alert", "A ação falhou", String(err));
    $("action-retry").hidden = false;
  } finally {
    busy = false;
    current = null;
    refresh();
  }
}

$("install-start").addEventListener("click", () => runAction("install"));
$("action-back").addEventListener("click", () => { stage("review"); history.back(); });
$("install-reboot").addEventListener("click", async () => {
  try { await invoke("reboot"); } catch (err) { toast(String(err), "alert"); }
});
$("install-later").addEventListener("click", () => {
  toast("Reinicie quando puder. O teste abre sozinho depois do login.");
  stage("review");
  location.hash = "#inicio";
});

// ---------- Teste ----------
async function runChecks() {
  $("test-banner").className = "banner";
  $("test-ic").innerHTML = `<span class="spinner"></span>`;
  $("test-title").textContent = "Testando…";
  $("test-text").textContent = "";
  $("test-again").disabled = true;
  let checks = [];
  try {
    checks = await invoke("run_checks");
  } catch (err) {
    toast(String(err), "alert");
  }
  $("test-again").disabled = false;
  const tone = { pass: "green", fail: "red", warn: "yellow" };
  const mark = { pass: "check", fail: "x", warn: "alert" };
  $("checks").innerHTML = checks.map((c) =>
    `<div class="list-row"><span class="lead ${tone[c.state]}">${icon(mark[c.state])}</span>
      <span class="body"><span class="title">${esc(c.title)}</span><span class="subtitle wrap">${esc(c.detail)}</span></span></div>`).join("");
  const failed = checks.filter((c) => c.state === "fail").length;
  const ok = checks.length && !failed;
  $("test-banner").className = "banner " + (ok ? "success" : "danger");
  $("test-ic").innerHTML = icon(ok ? "check" : "alert");
  $("test-title").textContent = ok ? "O driver NVIDIA está funcionando" : "O driver NVIDIA não está em uso";
  $("test-text").textContent = ok
    ? `Todas as verificações passaram em ${new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.`
    : `${failed} de ${checks.length} verificações falharam. Veja abaixo o que fazer.`;
  $("test-fix").hidden = ok;
  if (state?.nvidia.pending_test) refresh();
}
$("test-again").addEventListener("click", runChecks);

// ---------- Gerenciar ----------
function renderManage() {
  const nv = state.nvidia;
  const page = $("gerenciar");
  page.dataset.crumb = nv.installed ? nv.model : "";
  $("manage-empty").hidden = nv.installed;
  $("manage-body").hidden = !nv.installed;
  if (!nv.installed) {
    const can = nv.generation.startsWith("g0");
    $("manage-empty-text").textContent = can ? `A ${nv.model} pode usar o driver ${BRANCH[nv.generation]}.` : "Este computador não tem placa NVIDIA com driver para o Leap 16.1.";
    $("manage-empty-btn").hidden = !can;
    return;
  }
  $("manage-title").textContent = `Driver NVIDIA ${BRANCH[nv.generation] ?? ""}`;
  $("m-version").textContent = nv.installed_version;
  $("m-loaded").textContent = nv.loaded_version ? `Em uso: ${nv.loaded_version}` : "Não carregado: reinicie ou reinstale";
  $("m-branch").textContent = BRANCH[nv.generation] ?? "—";
  $("m-branch-foot").textContent = nv.generation === "g07" ? "Turing ou mais nova" : "Maxwell, Pascal ou Volta";
  $("m-sb").textContent = nv.secure_boot ? "Ligado" : "Desligado";
  $("m-sb-foot").textContent = nv.repo_configured ? "Repositório repo-nvidia ativo" : "Repositório repo-nvidia ausente";
}

// ---------- Confirmação ----------
const confirmTexts = {
  update: ["Atualizar o driver?", "Um ponto de restauração é criado antes. Será preciso reiniciar.", "Atualizar", "primary", ""],
  reinstall: ["Reinstalar o driver?", "Um ponto de restauração é criado antes e os mesmos pacotes são instalados de novo. Será preciso reiniciar.", "Reinstalar", "primary", ""],
  remove: ["Remover o driver NVIDIA?", "Um ponto de restauração é criado antes. O sistema volta ao driver livre nouveau e o repositório da NVIDIA é removido. Será preciso reiniciar.", "Remover", "danger", "danger"],
};
const overlay = $("confirm");
let pending = "";
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-confirm]");
  if (!b) return;
  pending = b.dataset.confirm;
  const [title, text, label, kind, tone] = confirmTexts[pending];
  $("confirm-title").textContent = title;
  $("confirm-text").textContent = text;
  $("confirm-ok").textContent = label;
  $("confirm-ok").className = "btn " + kind;
  $("confirm-ic").className = "d-ic " + tone;
  overlay.hidden = false;
});
const closeDialog = () => (overlay.hidden = true);
overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest("[data-close]")) closeDialog(); });
addEventListener("keydown", (e) => { if (e.key === "Escape") closeDialog(); });
$("confirm-ok").addEventListener("click", () => { closeDialog(); runAction(pending); });

// ---------- Busca nos problemas ----------
$("issue-search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll("#issues .issue").forEach((r) => {
    const detail = $(r.dataset.expand);
    const match = !q || (r.textContent + detail.textContent).toLowerCase().includes(q);
    r.hidden = !match;
    detail.hidden = !match || r.getAttribute("aria-expanded") !== "true";
    if (match) shown += 1;
  });
  $("issues").hidden = shown === 0;
  $("issues-empty").hidden = shown !== 0;
});

// ---------- Navegação ----------
const pages = [...document.querySelectorAll(".page")];
const scroller = $("scroller");

function show(id) {
  const page = pages.find((p) => p.id === id) ?? pages[0];
  for (const p of pages) p.hidden = p !== page;
  page.classList.remove("enter");
  void page.offsetWidth;
  page.classList.add("enter");
  for (const link of document.querySelectorAll(".nav-item")) {
    if (link.dataset.page === page.id) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  $("page-title").textContent = page.dataset.title;
  $("page-crumb").textContent = page.dataset.crumb ?? "";
  scroller.scrollTop = 0;
  if (page.id === "teste") runChecks();
  if (page.id === "instalar" && !busy) {
    page.dataset.title = "Instalar";
    $("page-title").textContent = "Instalar";
    if (document.querySelector('#instalar .stage[data-stage="done"]').hidden) stage("review");
  }
}

addEventListener("hashchange", () => show(location.hash.slice(1)));
scroller.addEventListener("scroll", () => $("headerbar").classList.toggle("scrolled", scroller.scrollTop > 4));
$("rescan").addEventListener("click", async () => { await refresh(); toast("Dispositivos verificados."); });

stage("review");
refresh().then(() => {
  // Aberto pelo autostart com teste pendente: vai direto ao teste.
  if (state?.nvidia.pending_test && !location.hash) location.hash = "#teste";
  else show(location.hash.slice(1));
});
