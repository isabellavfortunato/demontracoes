// Sistema de nutrição: consultas de clientes e mentorias.
// Dados no Firestore em usuarios/{uid}/..., cada conta vê só os próprios dados.
import {
  initializeApp, getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, setPersistence, browserLocalPersistence, browserSessionPersistence,
  getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch
} from "./firebase-demo.js";
const firebaseConfig = {};

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

// ------------------------------------------------------------------ esquema
// Lista branca de campos por coleção. Precisa bater exatamente com firestore.rules.
const AREAS = { clinica: "Consultas de clientes", mentoria: "Mentorias" };
const STATUS_PACIENTE = { ativo: "Em acompanhamento", manutencao: "Manutenção", encerrado: "Encerrado" };
const TIPOS_CONSULTA = ["Primeira consulta", "Reavaliação", "Desfecho", "Manutenção"];
const COLECOES = ["pacotes", "etapas", "contatos", "consultas", "modelos", "mensagens", "cobrancas"];
const MAX_TS = 99999999999999;

const ESQUEMA = {
  pacotes: {
    area: ["area", true], nome: ["texto", 120, true], duracaoMeses: ["num", 0, 120], valor: ["num", 0, 10000000],
    criadoEm: ["num", 0, MAX_TS]
  },
  etapas: { nome: ["texto", 80, true], ordem: ["num", 0, 1000], modeloId: ["texto", 40], criadoEm: ["num", 0, MAX_TS] },
  contatos: {
    area: ["area", true], nome: ["texto", 160, true], telefone: ["texto", 30], email: ["texto", 160],
    nascimento: ["dia"], origem: ["texto", 80], pacoteId: ["texto", 40], inicio: ["dia"], status: ["texto", 20],
    etapaId: ["texto", 40], autoriza: ["bool"], obs: ["texto", 2000], criadoEm: ["num", 0, MAX_TS]
  },
  consultas: {
    contatoId: ["texto", 40, true], data: ["dia", true], hora: ["hora", true], tipo: ["texto", 40],
    status: ["texto", 20], criadoEm: ["num", 0, MAX_TS]
  },
  modelos: { area: ["area", true], titulo: ["texto", 120, true], texto: ["texto", 2000, true], criadoEm: ["num", 0, MAX_TS] },
  mensagens: {
    contatoId: ["texto", 40, true], data: ["dia", true], titulo: ["texto", 120], texto: ["texto", 2000, true],
    status: ["texto", 20], enviadaEm: ["num", 0, MAX_TS], criadoEm: ["num", 0, MAX_TS]
  },
  cobrancas: {
    contatoId: ["texto", 40, true], descricao: ["texto", 160], valor: ["num", 0, 10000000], vencimento: ["dia", true],
    status: ["texto", 20], criadoEm: ["num", 0, MAX_TS]
  },
  config: {
    nomeNegocio: ["texto", 120], linkAgenda: ["texto", 500], prazoHoras: ["num", 1, 720],
    textoAniversario: ["texto", 2000], textoConfirmacao: ["texto", 2000], textoLinkAgenda: ["texto", 2000],
    textoSemRetornoClinica: ["texto", 2000], textoSemRetornoMentoria: ["texto", 2000],
    assuntoCobranca: ["texto", 200], textoCobranca: ["texto", 2000]
  }
};

class ErroDados extends Error {}

function limpar(nome, obj) {
  const regras = ESQUEMA[nome];
  const saida = {};
  for (const [campo, regra] of Object.entries(regras)) {
    let v = obj[campo];
    const [tipo] = regra;
    const obrigatorio = tipo === "texto" ? regra[2] : (tipo === "num" ? false : regra[1]);
    if (tipo === "texto") {
      if (v === undefined || v === null) v = "";
      v = String(v).trim().slice(0, regra[1]);
      if (obrigatorio && !v) throw new ErroDados("Preencha o campo obrigatório.");
      saida[campo] = v;
    } else if (tipo === "area") {
      if (!(v in AREAS)) throw new ErroDados("Área inválida.");
      saida[campo] = v;
    } else if (tipo === "dia") {
      v = v ? String(v) : "";
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) v = "";
      if (obrigatorio && !v) throw new ErroDados("Informe a data.");
      saida[campo] = v;
    } else if (tipo === "hora") {
      v = v ? String(v).slice(0, 5) : "";
      if (!/^\d{2}:\d{2}$/.test(v)) throw new ErroDados("Informe a hora.");
      saida[campo] = v;
    } else if (tipo === "bool") {
      saida[campo] = !!v;
    } else if (tipo === "num") {
      if (v === undefined || v === null || v === "") continue;
      v = Number(v);
      if (!Number.isFinite(v)) continue;
      v = Math.min(regra[2], Math.max(regra[1], v));
      saida[campo] = v;
    }
  }
  return saida;
}

// ------------------------------------------------------------------ estado
const S = {
  authPronto: false,
  uid: null,
  dados: {},
  ajustes: null,
  carregado: {},
  assinaturas: [],
  iniciando: false,
  filtros: {},
  modoLogin: "entrar"
};
function zerarEstado() {
  S.dados = Object.fromEntries(COLECOES.map((c) => [c, []]));
  S.ajustes = null;
  S.carregado = {};
  S.iniciando = false;
  S.filtros = {};
}
zerarEstado();

const PADRAO = {
  nomeNegocio: "Meu consultório",
  linkAgenda: "",
  prazoHoras: 48,
  textoAniversario: "Feliz aniversário, {nome}! Que o seu novo ano seja leve e cheio de saúde.",
  textoConfirmacao: "Oi, {nome}! Passando para confirmar a sua consulta de {data_consulta}. Posso confirmar?",
  textoLinkAgenda: "Oi, {nome}! Para marcar o seu horário, é só escolher aqui: {link_agenda}",
  textoSemRetornoClinica: "Oi, {nome}, tudo bem? Não tive o seu retorno da última mensagem e queria saber como você está.",
  textoSemRetornoMentoria: "Oi, {nome}, tudo bem? Não tive o seu retorno e queria saber se ficou alguma dúvida sobre a mentoria.",
  assuntoCobranca: "Mentoria: lembrete de pagamento",
  textoCobranca: "Olá, {nome}! Este é um lembrete da parcela de {valor} da mentoria, com vencimento em {vencimento}. Qualquer dúvida, é só responder este e-mail."
};
const cfg = (k) => {
  const v = S.ajustes && S.ajustes[k];
  return v === undefined || v === null || v === "" ? PADRAO[k] : v;
};

const lista = (nome) => S.dados[nome] || [];
const porId = (nome, id) => lista(nome).find((x) => x.id === id);

// ------------------------------------------------------------------ Firestore
const colRef = (nome) => collection(db, "usuarios", S.uid, nome);
const docRef = (nome, id) => doc(db, "usuarios", S.uid, nome, id);
const novoId = (nome) => doc(colRef(nome)).id;

async function salvar(nome, id, obj) {
  const dados = limpar(nome, obj);
  const r = id ? docRef(nome, id) : doc(colRef(nome));
  await setDoc(r, dados);
  return r.id;
}
async function atualizar(nome, id, parcial) {
  const atual = porId(nome, id);
  if (!atual) return;
  const { id: _ignorado, ...resto } = atual;
  await salvar(nome, id, { ...resto, ...parcial });
}
async function apagar(nome, id) {
  await deleteDoc(docRef(nome, id));
}
// ops: [{ tipo: "set" | "del", nome, id, dados }]
async function emLote(ops) {
  const prontas = ops.map((o) => ({ ...o, dados: o.tipo === "del" ? null : limpar(o.nome, o.dados) }));
  for (let i = 0; i < prontas.length; i += 400) {
    const b = writeBatch(db);
    for (const o of prontas.slice(i, i + 400)) {
      const r = o.id ? docRef(o.nome, o.id) : doc(colRef(o.nome));
      if (o.tipo === "del") b.delete(r);
      else b.set(r, o.dados);
    }
    await b.commit();
  }
}

function assinar() {
  pararAssinaturas();
  for (const nome of COLECOES) {
    S.assinaturas.push(onSnapshot(colRef(nome), (snap) => {
      S.dados[nome] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      S.carregado[nome] = true;
      agendarRender();
    }, () => aviso("Não foi possível ler os dados. Confira a conexão e entre de novo.", "erro")));
  }
  S.assinaturas.push(onSnapshot(docRef("config", "ajustes"), (snap) => {
    S.carregado.config = true;
    if (snap.exists()) {
      S.ajustes = snap.data();
    } else if (!S.iniciando) {
      S.iniciando = true;
      criarPadroes().catch(() => aviso("Não foi possível preparar a conta.", "erro"));
    }
    agendarRender();
  }, () => aviso("Não foi possível ler os ajustes.", "erro")));
}
function pararAssinaturas() {
  for (const parar of S.assinaturas) { try { parar(); } catch (e) { /* já encerrada */ } }
  S.assinaturas = [];
}
const tudoCarregado = () => COLECOES.every((c) => S.carregado[c]) && S.carregado.config && S.ajustes;

// ------------------------------------------------------------------ utilidades
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const FUSO = "America/Sao_Paulo";
const hoje = () => new Date().toLocaleDateString("sv-SE", { timeZone: FUSO });
const agora = () => new Date().toLocaleString("sv-SE", { timeZone: FUSO }).replace(" ", "T").slice(0, 16);
function somarDias(dia, n) {
  const d = new Date(dia + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function somarMeses(dia, n) {
  const [a, m, d] = dia.split("-").map(Number);
  const t = (m - 1) + n;
  const ano = a + Math.floor(t / 12);
  const mes = ((t % 12) + 12) % 12 + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(Math.min(d, 28)).padStart(2, "0")}`;
}
const difDias = (a, b) => Math.round((new Date(a + "T12:00:00Z") - new Date(b + "T12:00:00Z")) / 86400000);
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const diaSemana = (dia) => DIAS[new Date(dia + "T12:00:00Z").getUTCDay()];
const fmtData = (dia) => (dia ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}` : "");
const fmtCurta = (dia) => (dia ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}` : "");
function fmtTs(ts) {
  if (!ts) return "";
  const s = new Date(ts).toLocaleString("sv-SE", { timeZone: FUSO });
  return `${fmtData(s.slice(0, 10))} às ${s.slice(11, 16)}`;
}
function dinheiro(v) {
  if (v === undefined || v === null || v === "") return "";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function paraValor(t) {
  if (t === undefined || t === null || t === "") return null;
  let v = String(t).replace(/R\$/g, "").trim();
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function paraDia(t) {
  if (!t) return "";
  t = String(t).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return "";
  let ano = Number(m[3]);
  if (ano < 100) ano += ano > 40 ? 1900 : 2000;
  return `${ano}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
function soDigitos(tel) {
  let d = String(tel || "").replace(/\D/g, "");
  if (d && !d.startsWith("55") && d.length <= 11) d = "55" + d;
  return d;
}
const primeiroNome = (c) => String(c?.nome || "").split(" ")[0];
function idade(c) {
  if (!c?.nascimento) return null;
  const h = hoje();
  const [a, m, d] = c.nascimento.split("-").map(Number);
  const [ha, hm, hd] = h.split("-").map(Number);
  return ha - a - ((hm < m || (hm === m && hd < d)) ? 1 : 0);
}
function fimPacote(c) {
  const p = porId("pacotes", c.pacoteId);
  if (!c.inicio || !p || !p.duracaoMeses) return "";
  return somarDias(c.inicio, Math.round(p.duracaoMeses * 30.4));
}
const quando = (x) => `${x.data}T${x.hora}`;
function consultasDe(c) {
  return lista("consultas").filter((x) => x.contatoId === c.id).sort((a, b) => quando(a).localeCompare(quando(b)));
}
function proximaConsulta(c) {
  const ag = agora();
  return consultasDe(c).find((x) => quando(x) >= ag && (x.status === "agendada" || x.status === "confirmada"));
}
function preencher(texto, c, consulta) {
  consulta = consulta || (c ? proximaConsulta(c) : null);
  const pacote = c ? porId("pacotes", c.pacoteId) : null;
  const trocas = {
    "{nome}": primeiroNome(c),
    "{nome_completo}": c?.nome || "",
    "{pacote}": pacote ? pacote.nome : "",
    "{link_agenda}": cfg("linkAgenda"),
    "{data_consulta}": consulta ? `${fmtCurta(consulta.data)} às ${consulta.hora}` : ""
  };
  let t = String(texto || "");
  for (const [k, v] of Object.entries(trocas)) t = t.split(k).join(v || "");
  return t;
}
const linkWhats = (c, texto) => `https://wa.me/${soDigitos(c.telefone)}?text=${encodeURIComponent(texto)}`;
const contatosDa = (area) => lista("contatos").filter((c) => c.area === area);
const contatoDe = (x) => porId("contatos", x.contatoId);
const etapasOrdenadas = () => [...lista("etapas")].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
const porNome = (a, b) => a.nome.localeCompare(b.nome, "pt-BR");

function filaDe(area) {
  const h = hoje();
  return lista("mensagens")
    .filter((m) => m.status === "programada" && m.data <= h && contatoDe(m)?.area === area)
    .sort((a, b) => a.data.localeCompare(b.data) || contatoDe(a).nome.localeCompare(contatoDe(b).nome, "pt-BR"));
}
function semRetorno(area) {
  const limite = Date.now() - Number(cfg("prazoHoras")) * 3600000;
  return lista("mensagens")
    .filter((m) => m.status === "enviada" && m.enviadaEm && m.enviadaEm <= limite && contatoDe(m)?.area === area)
    .sort((a, b) => a.enviadaEm - b.enviadaEm);
}
function aniversariantes(area, dias) {
  const h = hoje();
  const ano = Number(h.slice(0, 4));
  const saida = [];
  for (const c of lista("contatos")) {
    if (!c.nascimento || (area && c.area !== area)) continue;
    for (const a of [ano, ano + 1]) {
      let niver = `${a}${c.nascimento.slice(4)}`;
      if (niver.endsWith("02-29")) niver = `${a}-03-01`;
      const dif = difDias(niver, h);
      if (dif >= 0 && dif <= dias) { saida.push({ dia: niver, c }); break; }
    }
  }
  return saida.sort((x, y) => x.dia.localeCompare(y.dia));
}

// ------------------------------------------------------------------ avisos
function aviso(msg, tipo = "ok") {
  const caixa = document.getElementById("avisos");
  const el = document.createElement("div");
  el.className = `flash ${tipo}`;
  el.setAttribute("role", tipo === "erro" ? "alert" : "status");
  el.textContent = msg;
  caixa.appendChild(el);
  while (caixa.children.length > 2) caixa.firstElementChild.remove();
  setTimeout(() => el.remove(), tipo === "erro" ? 6000 : 3500);
}

// ------------------------------------------------------------------ ilustrações
function citrico() {
  let gomos = "";
  for (let i = 0; i < 12; i++) {
    const a1 = (i * 30 - 4) * Math.PI / 180, a2 = (i * 30 + 26) * Math.PI / 180;
    const p = (a) => `${(118 * Math.cos(a)).toFixed(1)} ${(118 * Math.sin(a)).toFixed(1)}`;
    gomos += `<path d="M0 0 L${p(a1)} A118 118 0 0 1 ${p(a2)} Z" fill="#f08a5d" stroke="#f9e2d2" stroke-width="5"/>`;
  }
  return `<svg viewBox="0 0 300 220" aria-hidden="true"><g transform="translate(150 215)">
    <circle r="150" fill="#e8955f"/><circle r="136" fill="#f6dccb"/><circle r="126" fill="#e46f45"/>${gomos}<circle r="16" fill="#f9e2d2"/></g>
    <g fill="#3b5240"><path d="M40 120 C 40 70, 90 50, 112 60 C 100 100, 70 120, 40 120 Z"/>
    <path d="M232 92 C 250 50, 290 52, 296 64 C 280 96, 258 100, 232 92 Z" opacity=".85"/></g></svg>`;
}
function folhas() {
  return `<svg viewBox="0 0 300 220" aria-hidden="true">
    <rect x="96" y="150" width="108" height="70" rx="6" fill="#d2703a"/><rect x="88" y="140" width="124" height="18" rx="4" fill="#b85d2c"/>
    <g stroke="#2f4334" stroke-width="3" fill="none"><path d="M150 140 C 150 100, 148 70, 150 30"/></g>
    <g fill="#3b5240"><path d="M150 112 C 110 110, 86 84, 84 58 C 116 58, 146 78, 150 112 Z"/>
    <path d="M150 92 C 186 92, 212 70, 216 42 C 182 42, 154 62, 150 92 Z"/>
    <path d="M150 64 C 124 60, 110 38, 112 18 C 136 22, 150 40, 150 64 Z" opacity=".9"/>
    <path d="M151 46 C 170 42, 182 26, 182 10 C 164 12, 152 26, 151 46 Z" opacity=".8"/></g>
    <circle cx="232" cy="176" r="22" fill="#e3ad24"/><circle cx="64" cy="186" r="14" fill="#e3ad24" opacity=".7"/></svg>`;
}

// ------------------------------------------------------------------ pedaços de tela
const bola = (b, s) => `<div class="data-bola"><b>${esc(b)}</b><span>${esc(s)}</span></div>`;
const vazio = (t) => `<div class="vazio">${esc(t)}</div>`;
const badge = (t, c = "") => `<span class="badge ${c}">${esc(t)}</span>`;
const card = (rotulo, num, sub, href, cor = "") =>
  `<${href ? `a href="${href}"` : "div"} class="card-num ${cor}"><span class="rotulo">${esc(rotulo)}</span><b>${esc(num)}</b><span>${esc(sub)}</span></${href ? "a" : "div"}>`;
const linkContato = (c) => `<a class="nome" href="#/contato/${esc(c.id)}">${esc(c.nome)}</a>`;
const opcoes = (itens, sel, vazioTxt) =>
  (vazioTxt !== undefined ? `<option value="">${esc(vazioTxt)}</option>` : "") +
  itens.map(([v, t]) => `<option value="${esc(v)}"${String(sel ?? "") === String(v) ? " selected" : ""}>${esc(t)}</option>`).join("");

function moldura(area, rota, conteudo) {
  const nav = area === "clinica"
    ? [["#/clinica", "Visão geral", ["clinica"]], ["#/fila/clinica", "Fila do dia", ["fila"]], ["#/contatos/clinica", "Pacientes", ["contatos", "contato", "contato-novo", "contato-editar", "importar"]], ["#/agenda", "Agenda", ["agenda"]], ["#/mensagens/clinica", "Mensagens", ["mensagens"]]]
    : area === "mentoria"
      ? [["#/mentoria", "Quadro", ["mentoria"]], ["#/fila/mentoria", "Fila do dia", ["fila"]], ["#/contatos/mentoria", "Contatos", ["contatos", "contato", "contato-novo", "contato-editar", "importar"]], ["#/mensagens/mentoria", "Mensagens", ["mensagens"]], ["#/cobrancas", "Cobranças", ["cobrancas"]]]
      : [["#/", "Início", ["inicio"]], ["#/aniversarios", "Aniversários", ["aniversarios"]], ["#/ajustes", "Ajustes", ["ajustes"]]];
  const links = nav.map(([h, t, rotas]) => `<a href="${h}" class="${rotas.includes(rota) ? "ativo" : ""}">${esc(t)}</a>`).join("");
  return `
  <header class="topo"><div class="topo-in">
    <a class="marca" href="#/"><b>${esc(cfg("nomeNegocio"))}</b><span>Consultas e mentorias</span></a>
    <nav class="nav">${links}<a href="#/sair" data-acao="sair">Sair</a></nav>
  </div></header>
  ${area ? `<div class="faixa-area"><div class="trilha"><a href="#/">Início</a> &nbsp;/&nbsp; ${esc(AREAS[area])}</div></div>` : ""}
  <main>${conteudo}</main>`;
}

// ------------------------------------------------------------------ telas
function telaLogin() {
  const criar = S.modoLogin === "criar";
  return `<div class="entrar">
    <div class="lado-cor"><div class="arco-deco">${citrico()}</div>
      <div class="rotulo">Consultas e mentorias</div>
      <h1>Cuidar de quem você acompanha, sem precisar lembrar de tudo.</h1></div>
    <div class="lado-form">
      <form data-form="login" novalidate>
        <span class="marca"><b>Sistema de nutrição</b><span>Consultas e mentorias</span></span>
        <h2 style="margin-top:34px">${criar ? "Criar conta" : "Entrar"}</h2>
        <div class="campo"><label for="email">E-mail</label>
          <input type="email" id="email" name="email" autocomplete="email" inputmode="email" required></div>
        <div class="campo"><label for="senha">Senha</label>
          <input type="password" id="senha" name="senha" autocomplete="${criar ? "new-password" : "current-password"}" required minlength="${criar ? 8 : 1}">
          ${criar ? `<div class="dica">Pelo menos 8 caracteres.</div>` : ""}</div>
        <div class="campo"><label class="check"><input type="checkbox" name="manter" value="1" checked> Manter conectado neste aparelho</label></div>
        <button class="btn primario" style="width:100%">${criar ? "Criar conta" : "Entrar"}</button>
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:8px">
          <button type="button" class="link-botao" data-acao="modo-login">${criar ? "Já tenho conta" : "Criar conta"}</button>
          ${criar ? "" : `<button type="button" class="link-botao" data-acao="esqueci">Esqueci a senha</button>`}
        </div>
      </form>
    </div></div>`;
}

function telaInicio() {
  const h = hoje();
  const ag = agora();
  const resumo = (area) => ({
    contatos: contatosDa(area).filter((c) => c.status !== "encerrado").length,
    fila: filaDe(area).length,
    sem: semRetorno(area).length
  });
  const rc = resumo("clinica"), rm = resumo("mentoria");
  const cob = lista("cobrancas").filter((x) => x.status === "pendente").length;
  const fim = `${somarDias(h, 7)}T00:00`;
  const proximas = lista("consultas").filter((x) => quando(x) >= ag && quando(x) < fim && ["agendada", "confirmada"].includes(x.status)).length;
  return moldura(null, "inicio", `
  <section class="abertura">
    <div class="rotulo">${esc(diaSemana(h))}, ${fmtData(h)}</div>
    <h1>Por onde vamos começar hoje?</h1>
    <p>Escolha a área. Cada uma tem a própria fila de mensagens, os próprios cadastros e o próprio acompanhamento.</p>
  </section>
  <div class="portas">
    <a class="porta clinica" href="#/clinica"><div class="arco">${citrico()}</div><div class="painel">
      <div class="rotulo">Atendimento nutricional</div><h2>Consultas de clientes</h2>
      <p>Pacientes por pacote, agenda das consultas, mensagens semanais de acompanhamento e quem ainda não respondeu.</p>
      <div class="numeros"><div><b>${rc.contatos}</b><span>Pacientes</span></div><div><b>${rc.fila}</b><span>Na fila hoje</span></div><div><b>${rc.sem}</b><span>Sem retorno</span></div></div>
      <div class="seguir">Entrar &rarr;</div></div></a>
    <a class="porta mentoria" href="#/mentoria"><div class="arco">${folhas()}</div><div class="painel">
      <div class="rotulo">Profissionais de saúde</div><h2>Mentorias</h2>
      <p>Contatos dos eventos, quadro das etapas até a matrícula, mensagens de cada etapa e cobranças da mentoria.</p>
      <div class="numeros"><div><b>${rm.contatos}</b><span>Contatos</span></div><div><b>${rm.fila}</b><span>Na fila hoje</span></div><div><b>${cob}</b><span>Cobranças em aberto</span></div></div>
      <div class="seguir">Entrar &rarr;</div></div></a>
  </div>
  <div class="atalhos">
    <a class="atalho" href="#/agenda"><span class="rotulo">Próximos 7 dias</span><b>${proximas}</b><span class="muted pequeno">consultas marcadas</span></a>
    <a class="atalho" href="#/aniversarios"><span class="rotulo">Aniversários</span><b>&rarr;</b><span class="muted pequeno">quem faz aniversário este mês</span></a>
    <a class="atalho" href="#/ajustes"><span class="rotulo">Ajustes</span><b>&rarr;</b><span class="muted pequeno">pacotes, etapas, textos e cópia de segurança</span></a>
  </div>`);
}

function telaClinica() {
  const h = hoje(), ag = agora();
  const pac = contatosDa("clinica");
  const ativos = pac.filter((c) => c.status === "ativo");
  const fim = `${somarDias(h, 7)}T00:00`;
  const consultas = lista("consultas")
    .filter((x) => quando(x) >= `${h}T00:00` && quando(x) < fim && ["agendada", "confirmada"].includes(x.status) && contatoDe(x))
    .sort((a, b) => quando(a).localeCompare(quando(b)));
  const terminando = ativos.filter((c) => { const f = fimPacote(c); return f && difDias(f, h) >= 0 && difDias(f, h) <= 21; });
  const semProxima = ativos.filter((c) => !proximaConsulta(c)).sort(porNome);
  const nivers = aniversariantes("clinica", 7);
  const sr = semRetorno("clinica");
  return moldura("clinica", "clinica", `
  <div class="cab"><div><div class="rotulo">Atendimento nutricional</div><h1>Consultas de clientes</h1></div>
    <div class="acoes"><a class="btn leve" href="#/contato-novo/clinica">Novo paciente</a><a class="btn primario" href="#/fila/clinica">Abrir a fila do dia</a></div></div>
  <div class="cards">
    ${card("Fila de hoje", filaDe("clinica").length, "mensagens para enviar", "#/fila/clinica", "t")}
    ${card("Sem retorno", sr.length, "pacientes para chamar", "#/fila/clinica", "t")}
    ${card("Em acompanhamento", ativos.length, "pacientes", "#/contatos/clinica?status=ativo")}
    ${card("Manutenção", pac.filter((c) => c.status === "manutencao").length, "pacientes", "#/contatos/clinica?status=manutencao")}
    ${card("Próximos 7 dias", consultas.length, "consultas", "#/agenda", "m")}
  </div>
  <div class="grade-2"><div>
    <section class="bloco"><header><h3>Consultas da semana</h3><a class="rotulo" href="#/agenda">Ver agenda</a></header>
      ${consultas.length ? `<ul class="lista">${consultas.map((x) => {
        const c = contatoDe(x), p = porId("pacotes", c.pacoteId);
        return `<li>${bola(Number(x.data.slice(8)), diaSemana(x.data).slice(0, 3))}<div class="info">${linkContato(c)}
          <div class="det">${esc(x.hora)} · ${esc(x.tipo)}${p ? ` · ${esc(p.nome)}` : ""}</div></div>
          <div class="lado">${x.status === "confirmada" ? badge("Confirmada", "v") : badge("A confirmar", "m")}</div></li>`;
      }).join("")}</ul>` : vazio("Nenhuma consulta nos próximos 7 dias.")}</section>
    <section class="bloco"><header><h3>Sem próxima consulta marcada</h3><span class="rotulo">${semProxima.length}</span></header>
      ${semProxima.length ? `<ul class="lista">${semProxima.map((c) => {
        const p = porId("pacotes", c.pacoteId);
        return `<li><div class="info">${linkContato(c)}<div class="det">${esc(p ? p.nome : "Sem pacote")}${c.inicio ? ` · início em ${fmtData(c.inicio)}` : ""}</div></div>
          <div class="lado"><a class="btn mini leve" href="#/contato/${esc(c.id)}">Marcar</a></div></li>`;
      }).join("")}</ul>` : vazio("Todos os pacientes em acompanhamento já têm o retorno marcado.")}</section>
  </div><div>
    <section class="bloco verde"><header><h3>Pacote terminando</h3><span class="rotulo">Próximas 3 semanas</span></header>
      ${terminando.length ? `<ul class="lista">${terminando.map((c) => `<li style="border-color:rgba(255,255,255,.18)"><div class="info">${linkContato(c)}
        <div class="det muted">${esc(porId("pacotes", c.pacoteId).nome)} · termina em ${fmtData(fimPacote(c))}</div></div></li>`).join("")}</ul>`
        : `<div class="vazio" style="color:rgba(255,255,255,.85)">Nenhum pacote terminando nas próximas 3 semanas.</div>`}</section>
    <section class="bloco"><header><h3>Aniversários da semana</h3><a class="rotulo" href="#/aniversarios">Ver todos</a></header>
      ${nivers.length ? `<ul class="lista">${nivers.map(({ dia, c }) => `<li>${bola(Number(dia.slice(8)), diaSemana(dia).slice(0, 3))}
        <div class="info">${linkContato(c)}<div class="det">Faz ${(idade(c) || 0) + (dia === h ? 0 : 1)} anos</div></div></li>`).join("")}</ul>`
        : vazio("Nenhum aniversário nesta semana.")}</section>
  </div></div>`);
}

function telaFila(area) {
  const h = hoje();
  const itens = filaDe(area);
  const sr = semRetorno(area);
  const txtSem = cfg(area === "clinica" ? "textoSemRetornoClinica" : "textoSemRetornoMentoria");
  const nivers = aniversariantes(area, 0);
  const amanha = somarDias(h, 1);
  const confirmar = area === "clinica"
    ? lista("consultas").filter((x) => x.data === amanha && x.status === "agendada" && contatoDe(x)).sort((a, b) => a.hora.localeCompare(b.hora))
    : [];
  const prox = lista("mensagens")
    .filter((m) => m.status === "programada" && m.data > h && m.data <= somarDias(h, 7) && contatoDe(m)?.area === area)
    .sort((a, b) => a.data.localeCompare(b.data));
  return moldura(area, "fila", `
  <div class="cab"><div><div class="rotulo">${esc(diaSemana(h))}, ${fmtData(h)}</div><h1>Fila do dia</h1></div>
    <div class="acoes"><a class="btn leve" href="#/mensagens/${area}">Programar mensagens</a></div></div>
  <p class="muted" style="max-width:720px;margin-top:-8px">Toque em <b>Abrir no WhatsApp</b>: a conversa abre com o texto pronto, é só enviar. A mensagem sai da fila e, se a pessoa não responder em ${esc(cfg("prazoHoras"))} horas, aparece em <b>Sem retorno</b> para você falar diretamente.</p>
  <section class="bloco"><header><h3>Mensagens programadas para hoje</h3><span class="rotulo">${itens.length}</span></header><div class="corpo">
    ${itens.length ? itens.map((m) => {
      const c = contatoDe(m), p = porId("pacotes", c.pacoteId), texto = preencher(m.texto, c);
      return `<article class="msg-card ${m.data < h ? "atrasada" : ""}">
        <div class="topo-msg">${linkContato(c)} ${badge(m.titulo || "Mensagem", "t")} ${p ? badge(p.nome) : ""} ${m.data < h ? badge(`Atrasada desde ${fmtCurta(m.data)}`, "r") : ""}</div>
        <p class="texto">${esc(texto)}</p>
        <div class="botoes">
          <a class="btn whats" href="${esc(linkWhats(c, texto))}" target="_blank" rel="noopener" data-acao="msg" data-op="enviada" data-id="${esc(m.id)}">Abrir no WhatsApp</a>
          <button class="btn leve" data-acao="msg" data-op="adiar" data-id="${esc(m.id)}">Deixar para amanhã</button>
          <button class="btn leve" data-acao="msg" data-op="excluir" data-id="${esc(m.id)}">Não enviar</button>
        </div></article>`;
    }).join("") : vazio("Nenhuma mensagem para hoje. A fila está em dia.")}
  </div></section>
  <section class="bloco"><header><h3>Sem retorno</h3><span class="rotulo">Para falar diretamente</span></header>
    ${sr.length ? `<ul class="lista">${sr.map((m) => { const c = contatoDe(m); return `<li><div class="info">${linkContato(c)}
      <div class="det">“${esc(m.titulo)}” enviada em ${fmtTs(m.enviadaEm)}</div></div><div class="lado">
      <a class="btn mini whats" href="${esc(linkWhats(c, preencher(txtSem, c)))}" target="_blank" rel="noopener">Chamar</a>
      <button class="btn mini verde" data-acao="msg" data-op="respondeu" data-id="${esc(m.id)}">Respondeu</button>
      <button class="btn mini leve" data-acao="msg" data-op="sem_resposta" data-id="${esc(m.id)}">Encerrar</button></div></li>`; }).join("")}</ul>`
      : vazio("Ninguém sem retorno no momento.")}</section>
  ${confirmar.length ? `<section class="bloco"><header><h3>Confirmar consultas de amanhã</h3><span class="rotulo">${confirmar.length}</span></header>
    <ul class="lista">${confirmar.map((x) => { const c = contatoDe(x); return `<li>${bola(x.hora.slice(0, 2) + "h", x.hora.slice(3))}
      <div class="info">${linkContato(c)}<div class="det">${esc(x.tipo)}</div></div><div class="lado">
      <a class="btn mini whats" href="${esc(linkWhats(c, preencher(cfg("textoConfirmacao"), c, x)))}" target="_blank" rel="noopener">Pedir confirmação</a>
      <button class="btn mini verde" data-acao="consulta" data-op="confirmada" data-id="${esc(x.id)}">Confirmou</button></div></li>`; }).join("")}</ul></section>` : ""}
  ${nivers.length ? `<section class="bloco"><header><h3>Aniversário hoje</h3></header><ul class="lista">${nivers.map(({ c }) => `<li>
    <div class="info">${linkContato(c)}<div class="det">Faz ${idade(c)} anos hoje</div></div>
    <div class="lado"><a class="btn mini whats" href="${esc(linkWhats(c, preencher(cfg("textoAniversario"), c)))}" target="_blank" rel="noopener">Dar parabéns</a></div></li>`).join("")}</ul></section>` : ""}
  <section class="bloco"><header><h3>Nos próximos 7 dias</h3><span class="rotulo">${prox.length}</span></header>
    ${prox.length ? `<ul class="lista">${prox.map((m) => `<li>${bola(Number(m.data.slice(8)), diaSemana(m.data).slice(0, 3))}
      <div class="info"><span class="nome">${esc(contatoDe(m).nome)}</span><div class="det">${esc(m.titulo)}</div></div></li>`).join("")}</ul>`
      : vazio("Nada programado para a próxima semana.")}</section>`);
}

function telaContatos(area, q) {
  const f = S.filtros[area] || (S.filtros[area] = { busca: "", pacote: "", status: "" });
  if (q.status !== undefined) f.status = q.status;
  const pacotes = lista("pacotes").filter((p) => p.area === area);
  const busca = f.busca.toLocaleLowerCase("pt-BR");
  const itens = contatosDa(area)
    .filter((c) => !busca || c.nome.toLocaleLowerCase("pt-BR").includes(busca))
    .filter((c) => !f.pacote || c.pacoteId === f.pacote)
    .filter((c) => !f.status || c.status === f.status)
    .sort(porNome);
  const clinica = area === "clinica";
  return moldura(area, "contatos", `
  <div class="cab"><div><div class="rotulo">${esc(AREAS[area])}</div><h1>${clinica ? "Pacientes" : "Contatos da mentoria"}</h1></div>
    <div class="acoes"><a class="btn leve" href="#/importar/${area}">Importar planilha</a>
    <a class="btn primario" href="#/contato-novo/${area}">${clinica ? "Novo paciente" : "Novo contato"}</a></div></div>
  <form class="filtros" data-form="filtro" data-area="${area}">
    <input type="search" name="busca" value="${esc(f.busca)}" placeholder="Buscar pelo nome" aria-label="Buscar pelo nome">
    ${pacotes.length ? `<select name="pacote" data-filtro aria-label="Pacote">${opcoes(pacotes.map((p) => [p.id, p.nome]), f.pacote, "Todos os pacotes")}</select>` : ""}
    ${clinica ? `<select name="status" data-filtro aria-label="Situação">${opcoes(Object.entries(STATUS_PACIENTE), f.status, "Todas as situações")}</select>` : ""}
    <button class="btn leve">Filtrar</button>
  </form>
  <section class="bloco rolagem">${itens.length ? `<table class="tabela"><thead><tr><th>Nome</th><th>Telefone</th>
    ${clinica ? "<th>Pacote</th><th>Próxima consulta</th><th>Situação</th>" : "<th>Origem</th><th>Etapa</th>"}</tr></thead><tbody>
    ${itens.map((c) => {
      const p = porId("pacotes", c.pacoteId);
      if (clinica) {
        const pc = proximaConsulta(c);
        const cor = c.status === "ativo" ? "v" : c.status === "manutencao" ? "m" : "";
        return `<tr><td>${linkContato(c)}${c.autoriza ? "" : " " + badge("Sem autorização", "r")}</td><td>${esc(c.telefone)}</td>
          <td>${esc(p ? p.nome : "")}</td><td>${pc ? `${fmtData(pc.data)} às ${esc(pc.hora)}` : ""}</td><td>${badge(STATUS_PACIENTE[c.status] || "", cor)}</td></tr>`;
      }
      const e = porId("etapas", c.etapaId);
      return `<tr><td>${linkContato(c)}</td><td>${esc(c.telefone)}</td><td>${esc(c.origem)}</td><td>${e ? badge(e.nome, "v") : ""}</td></tr>`;
    }).join("")}</tbody></table>` : vazio("Nenhum cadastro encontrado.")}</section>
  <p class="muted pequeno">${itens.length} ${itens.length === 1 ? "cadastro" : "cadastros"}</p>`);
}

function telaContatoForm(area, id) {
  const c = id ? porId("contatos", id) : { area, autoriza: true, status: "ativo" };
  if (!c) return telaNaoEncontrado();
  area = c.area;
  const pacotes = lista("pacotes").filter((p) => p.area === area);
  const clinica = area === "clinica";
  return moldura(area, id ? "contato-editar" : "contato-novo", `
  <div class="cab"><div><div class="rotulo">${esc(AREAS[area])}</div><h1>${id ? "Editar cadastro" : (clinica ? "Novo paciente" : "Novo contato")}</h1></div></div>
  <form class="bloco" data-form="contato" data-id="${esc(id || "")}" data-area="${area}"><div class="corpo">
    <div class="linha-campos">
      <div class="campo"><label for="f-nome">Nome completo</label><input type="text" id="f-nome" name="nome" value="${esc(c.nome)}" required autocomplete="off"></div>
      <div class="campo"><label for="f-tel">WhatsApp</label><input type="tel" id="f-tel" name="telefone" value="${esc(c.telefone)}" inputmode="tel" placeholder="(21) 99999-0000"></div>
    </div>
    <div class="linha-campos">
      <div class="campo"><label for="f-email">E-mail</label><input type="email" id="f-email" name="email" value="${esc(c.email)}" inputmode="email"></div>
      <div class="campo"><label for="f-nasc">Data de nascimento</label><input type="date" id="f-nasc" name="nascimento" value="${esc(c.nascimento)}"></div>
      <div class="campo"><label for="f-origem">Origem</label><input type="text" id="f-origem" name="origem" value="${esc(c.origem)}" list="origens" placeholder="Indicação, Instagram, evento">
        <datalist id="origens"><option value="Indicação"><option value="Captação direta"><option value="Instagram"><option value="Evento presencial"><option value="Evento online"></datalist></div>
    </div>
    ${clinica ? `<div class="linha-campos">
      <div class="campo"><label for="f-pac">Pacote</label><select id="f-pac" name="pacoteId">${opcoes(pacotes.map((p) => [p.id, p.nome]), c.pacoteId, "Sem pacote")}</select></div>
      <div class="campo"><label for="f-ini">Data da primeira consulta</label><input type="date" id="f-ini" name="inicio" value="${esc(c.inicio)}"></div>
      <div class="campo"><label for="f-st">Situação</label><select id="f-st" name="status">${opcoes(Object.entries(STATUS_PACIENTE), c.status)}</select></div>
    </div>` : `<div class="linha-campos">
      <div class="campo"><label for="f-et">Etapa</label><select id="f-et" name="etapaId">${opcoes(etapasOrdenadas().map((e) => [e.id, e.nome]), c.etapaId)}</select></div>
      <div class="campo"><label for="f-prog">Programa</label><select id="f-prog" name="pacoteId">${opcoes(pacotes.map((p) => [p.id, p.nome]), c.pacoteId, "Ainda não definido")}</select></div>
    </div>`}
    <div class="campo"><label for="f-obs">Observações</label><textarea id="f-obs" name="obs">${esc(c.obs)}</textarea></div>
    <div class="campo"><label class="check"><input type="checkbox" name="autoriza" value="1"${c.autoriza ? " checked" : ""}> Autorizou receber mensagens pelo WhatsApp</label>
      <div class="dica">Sem essa autorização, a pessoa não entra nas mensagens programadas.</div></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primario">Salvar</button>
      <a class="btn leve" href="${id ? `#/contato/${esc(id)}` : `#/contatos/${area}`}">Cancelar</a></div>
  </div></form>`);
}

function telaContato(id) {
  const c = porId("contatos", id);
  if (!c) return telaNaoEncontrado();
  const h = hoje();
  const p = porId("pacotes", c.pacoteId), e = porId("etapas", c.etapaId);
  const msgs = lista("mensagens").filter((m) => m.contatoId === id).sort((a, b) => a.data.localeCompare(b.data));
  const consultas = consultasDe(c);
  const modelos = lista("modelos").filter((m) => m.area === c.area);
  const clinica = c.area === "clinica";
  const cobrancas = lista("cobrancas").filter((x) => x.contatoId === id).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const statusMsg = (m) => m.status === "programada" ? badge("Programada", "m") : m.status === "enviada" ? badge("Aguardando resposta", "t")
    : m.status === "respondeu" ? badge("Respondeu", "v") : badge("Sem resposta");
  const statusCons = (x) => ({ agendada: badge("Agendada", "m"), confirmada: badge("Confirmada", "v"), realizada: badge("Realizada"), faltou: badge("Faltou", "r") }[x.status] || "");
  return moldura(c.area, "contato", `
  <div class="ficha-topo"><div class="avatar ${c.area}">${esc(c.nome.slice(0, 1))}</div>
    <div><div class="rotulo">${clinica ? "Paciente" : "Contato da mentoria"}</div><h1 style="margin:0">${esc(c.nome)}</h1>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        ${clinica ? badge(STATUS_PACIENTE[c.status] || "", c.status === "ativo" ? "v" : "m") : ""}
        ${p ? badge(p.nome, "t") : ""}${e ? badge(e.nome, "v") : ""}${c.autoriza ? "" : badge("Não recebe mensagens", "r")}</div></div>
    <div class="acoes cab-acoes-ficha">
      ${c.telefone ? `<a class="btn whats" href="https://wa.me/${esc(soDigitos(c.telefone))}" target="_blank" rel="noopener">Conversa</a>
      <a class="btn leve" href="${esc(linkWhats(c, preencher(cfg("textoLinkAgenda"), c)))}" target="_blank" rel="noopener">Mandar link da agenda</a>` : ""}
      <a class="btn leve" href="#/contato-editar/${esc(c.id)}">Editar</a></div></div>
  <div class="grade-2"><div>
    <section class="bloco"><header><h3>Dados</h3></header><div class="dados">
      <div><span>WhatsApp</span>${esc(c.telefone)}</div><div><span>E-mail</span>${esc(c.email)}</div>
      <div><span>Nascimento</span>${fmtData(c.nascimento)}${idade(c) !== null ? ` · ${idade(c)} anos` : ""}</div><div><span>Origem</span>${esc(c.origem)}</div>
      ${clinica ? `<div><span>Primeira consulta</span>${fmtData(c.inicio)}</div><div><span>Fim do pacote</span>${fmtData(fimPacote(c))}</div>` : ""}
    </div>${c.obs ? `<div class="corpo" style="white-space:pre-wrap">${esc(c.obs)}</div>` : ""}</section>
    <section class="bloco"><header><h3>Mensagens</h3><a class="rotulo" href="#/mensagens/${c.area}?contato=${esc(c.id)}">Programar várias</a></header>
      ${msgs.length ? `<ul class="lista">${msgs.map((m) => { const t = preencher(m.texto, c); return `<li>${bola(Number(m.data.slice(8)), m.data.slice(5, 7) + "/" + m.data.slice(2, 4))}
        <div class="info"><span class="nome">${esc(m.titulo)}</span><div class="det" style="white-space:pre-wrap">${esc(t.slice(0, 140))}${t.length > 140 ? "…" : ""}</div></div>
        <div class="lado">${statusMsg(m)}${m.status === "programada" ? `<button class="btn mini leve" data-acao="msg" data-op="excluir" data-id="${esc(m.id)}">Excluir</button>` : ""}</div></li>`; }).join("")}</ul>`
        : vazio("Nenhuma mensagem programada.")}
      ${c.autoriza ? `<form class="corpo" style="border-top:1px solid var(--linha)" data-form="programar" data-area="${c.area}" data-voltar="#/contato/${esc(c.id)}">
        <input type="hidden" name="destino" value="contato:${esc(c.id)}"><input type="hidden" name="intervalo" value="7">
        <div class="linha-campos">
          <div class="campo"><label for="p-mod">Modelo</label><select id="p-mod" name="modeloId">${opcoes(modelos.map((m) => [m.id, m.titulo]), "", "Escrever abaixo")}</select></div>
          <div class="campo"><label for="p-pri">Primeiro envio</label><input type="date" id="p-pri" name="primeira" value="${h}"></div>
          <div class="campo"><label for="p-vez">Repetir</label><select id="p-vez" name="vezes"><option value="1">Só uma vez</option>${[4, 6, 8, 12, 13, 26].map((n) => `<option value="${n}">${n} semanas</option>`).join("")}</select></div>
        </div>
        <div class="campo"><label for="p-txt">Texto (opcional se escolher um modelo)</label><textarea id="p-txt" name="texto" placeholder="Oi, {nome}! Como foi a sua semana com a rotina nova?"></textarea>
          <div class="dica">Use <code>{nome}</code> para o primeiro nome e <code>{data_consulta}</code> para a próxima consulta.</div></div>
        <button class="btn verde">Programar</button></form>` : ""}
    </section>
  </div><div>
    ${clinica ? `<section class="bloco"><header><h3>Consultas</h3></header>
      ${consultas.length ? `<ul class="lista">${consultas.map((x) => `<li>${bola(Number(x.data.slice(8)), x.data.slice(5, 7) + "/" + x.data.slice(2, 4))}
        <div class="info"><span class="nome">${esc(x.tipo)}</span><div class="det">${fmtData(x.data)} às ${esc(x.hora)}</div></div>
        <div class="lado">${statusCons(x)}${["agendada", "confirmada"].includes(x.status) ? `<button class="btn mini leve" data-acao="consulta" data-op="realizada" data-id="${esc(x.id)}">Realizada</button>
          <button class="btn mini leve" data-acao="consulta" data-op="faltou" data-id="${esc(x.id)}">Faltou</button>` : ""}
          <button class="btn mini leve" data-acao="consulta" data-op="excluir" data-id="${esc(x.id)}" aria-label="Excluir consulta">Excluir</button></div></li>`).join("")}</ul>`
        : vazio("Nenhuma consulta registrada.")}
      <form class="corpo" style="border-top:1px solid var(--linha)" data-form="consulta" data-contato="${esc(c.id)}">
        <div class="linha-campos"><div class="campo"><label for="c-dia">Data</label><input type="date" id="c-dia" name="dia" required></div>
          <div class="campo"><label for="c-hora">Hora</label><input type="time" id="c-hora" name="hora" value="09:00" required></div></div>
        <div class="campo"><label for="c-tipo">Tipo</label><select id="c-tipo" name="tipo">${opcoes(TIPOS_CONSULTA.map((t) => [t, t]), "")}</select></div>
        <button class="btn primario">Marcar consulta</button></form></section>`
    : `<section class="bloco"><header><h3>Cobranças</h3><a class="rotulo" href="#/cobrancas">Ver todas</a></header>
      ${cobrancas.length ? `<ul class="lista">${cobrancas.map((x) => `<li><div class="info"><span class="nome">${esc(x.descricao)}</span>
        <div class="det">${esc(dinheiro(x.valor))} · vence em ${fmtData(x.vencimento)}</div></div><div class="lado">
        ${x.status === "paga" ? badge("Paga", "v") : x.vencimento < h ? badge("Vencida", "r") : badge("Em aberto", "m")}</div></li>`).join("")}</ul>`
        : vazio("Nenhuma cobrança cadastrada.")}</section>`}
    <button class="btn mini perigo" data-acao="excluir-contato" data-id="${esc(c.id)}">Excluir cadastro</button>
  </div></div>`);
}

function telaAgenda(q) {
  const h = hoje();
  const semana = Number(q.s || 0) || 0;
  const dow = new Date(h + "T12:00:00Z").getUTCDay();
  const ini = somarDias(h, -((dow + 6) % 7) + 7 * semana);
  const dias = Array.from({ length: 7 }, (_, i) => somarDias(ini, i));
  const doDia = (d) => lista("consultas").filter((x) => x.data === d && contatoDe(x)).sort((a, b) => a.hora.localeCompare(b.hora));
  return moldura("clinica", "agenda", `
  <div class="cab"><div><div class="rotulo">Semana de ${fmtCurta(dias[0])} a ${fmtCurta(dias[6])}</div><h1>Agenda</h1></div>
    <div class="acoes"><a class="btn leve" href="#/agenda?s=${semana - 1}">&larr; Anterior</a>
    ${semana !== 0 ? `<a class="btn leve" href="#/agenda">Esta semana</a>` : ""}
    <a class="btn leve" href="#/agenda?s=${semana + 1}">Próxima &rarr;</a></div></div>
  <div class="semana">${dias.map((d) => `<div class="dia ${d === h ? "hoje" : ""}"><header><b>${Number(d.slice(8))}</b><span class="rotulo">${esc(diaSemana(d))}</span></header>
    ${doDia(d).map((x) => `<a class="evento ${esc(x.status)}" href="#/contato/${esc(x.contatoId)}"><b>${esc(x.hora)}</b>${esc(contatoDe(x).nome)}<br><span class="pequeno">${esc(x.tipo)}</span></a>`).join("")}
  </div>`).join("")}</div>
  <p class="dica" style="margin-top:16px">Verde-claro: agendada · verde: confirmada · bege: realizada · rosado: faltou. Para marcar uma consulta, abra a ficha do paciente.</p>`);
}

function telaMensagens(area, q) {
  const h = hoje();
  const modelos = lista("modelos").filter((m) => m.area === area);
  const contatos = contatosDa(area).filter((c) => c.status !== "encerrado").sort(porNome);
  const pacotes = lista("pacotes").filter((p) => p.area === area);
  const etapas = area === "mentoria" ? etapasOrdenadas() : [];
  const daArea = lista("mensagens").filter((m) => contatoDe(m)?.area === area);
  const programadas = daArea.filter((m) => m.status === "programada")
    .sort((a, b) => a.data.localeCompare(b.data) || contatoDe(a).nome.localeCompare(contatoDe(b).nome, "pt-BR")).slice(0, 200);
  const historico = daArea.filter((m) => m.status !== "programada").sort((a, b) => (b.enviadaEm || 0) - (a.enviadaEm || 0)).slice(0, 50);
  const pre = q.contato ? `contato:${q.contato}` : "";
  return moldura(area, "mensagens", `
  <div class="cab"><div><div class="rotulo">${esc(AREAS[area])}</div><h1>Mensagens programadas</h1></div></div>
  <div class="grade-2"><div>
    <form class="bloco" data-form="programar" data-area="${area}"><header><h3>Programar envio</h3></header><div class="corpo">
      <div class="campo"><label for="m-dest">Quem recebe</label><select id="m-dest" name="destino" required><option value="">Escolha</option>
        <optgroup label="Grupos"><option value="todos">Todos os ${area === "clinica" ? "pacientes ativos" : "contatos"}</option>
          ${pacotes.map((p) => `<option value="pacote:${esc(p.id)}">Pacote ${esc(p.nome)}</option>`).join("")}
          ${etapas.map((e) => `<option value="etapa:${esc(e.id)}">Etapa ${esc(e.nome)}</option>`).join("")}</optgroup>
        <optgroup label="Uma pessoa">${contatos.map((c) => `<option value="contato:${esc(c.id)}"${pre === `contato:${c.id}` ? " selected" : ""}>${esc(c.nome)}</option>`).join("")}</optgroup>
      </select></div>
      <div class="campo"><label for="m-mod">Usar um modelo</label><select id="m-mod" name="modeloId" data-preenche-modelo>${opcoes(modelos.map((m) => [m.id, m.titulo]), "", "Não, vou escrever")}</select></div>
      <div class="campo"><label for="m-tit">Título (só para você)</label><input type="text" id="m-tit" name="titulo" placeholder="Checklist da rotina"></div>
      <div class="campo"><label for="m-txt">Texto</label><textarea id="m-txt" name="texto" placeholder="Oi, {nome}! Como está sendo a sua semana?"></textarea>
        <div class="dica">Use <code>{nome}</code> para o primeiro nome, <code>{data_consulta}</code> para a próxima consulta e <code>{link_agenda}</code> para o link de agendamento.</div></div>
      <div class="linha-campos">
        <div class="campo"><label for="m-pri">Primeiro envio</label><input type="date" id="m-pri" name="primeira" value="${h}"></div>
        <div class="campo"><label for="m-vez">Quantas vezes</label><input type="number" id="m-vez" name="vezes" min="1" max="52" value="1" inputmode="numeric"></div>
        <div class="campo"><label for="m-int">A cada</label><select id="m-int" name="intervalo"><option value="7">1 semana</option><option value="14">2 semanas</option><option value="30">30 dias</option><option value="45">45 dias</option></select></div>
      </div>
      <button class="btn primario">Programar</button>
      <p class="dica">Só recebe quem autorizou mensagens no cadastro. As mensagens entram na fila do dia na data programada.</p>
    </div></form>
    <section class="bloco"><header><h3>Próximos envios</h3><span class="rotulo">${programadas.length}</span></header>
      ${programadas.length ? `<ul class="lista">${programadas.map((m) => `<li>${bola(Number(m.data.slice(8)), m.data.slice(5, 7) + "/" + m.data.slice(2, 4))}
        <div class="info">${linkContato(contatoDe(m))}<div class="det">${esc(m.titulo)}</div></div>
        <div class="lado"><button class="btn mini leve" data-acao="msg" data-op="excluir" data-id="${esc(m.id)}">Excluir</button></div></li>`).join("")}</ul>`
        : vazio("Nenhuma mensagem programada.")}</section>
  </div><div>
    <section class="bloco"><header><h3>Modelos</h3><span class="rotulo">Textos prontos</span></header>
      ${modelos.map((m) => `<details class="corpo" style="border-bottom:1px solid var(--linha)"><summary style="cursor:pointer;font-weight:500;min-height:32px">${esc(m.titulo)}</summary>
        <form data-form="modelo" data-area="${area}" data-id="${esc(m.id)}" style="margin-top:12px">
          <div class="campo"><label>Título</label><input type="text" name="titulo" value="${esc(m.titulo)}"></div>
          <div class="campo"><label>Texto</label><textarea name="texto">${esc(m.texto)}</textarea></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn mini verde">Salvar</button>
          <button type="button" class="btn mini perigo" data-acao="excluir-modelo" data-id="${esc(m.id)}">Excluir</button></div></form></details>`).join("")}
      <form class="corpo" data-form="modelo" data-area="${area}" data-id="">
        <div class="campo"><label for="n-tit">Novo modelo</label><input type="text" id="n-tit" name="titulo" placeholder="Título"></div>
        <div class="campo"><textarea name="texto" placeholder="Texto do modelo" aria-label="Texto do modelo"></textarea></div>
        <button class="btn mini verde">Adicionar modelo</button></form>
    </section>
    <section class="bloco"><header><h3>Últimos envios</h3></header>
      ${historico.length ? `<ul class="lista">${historico.map((m) => `<li><div class="info"><span class="nome">${esc(contatoDe(m).nome)}</span>
        <div class="det">${esc(m.titulo)}${m.enviadaEm ? ` · ${fmtTs(m.enviadaEm)}` : ""}</div></div>
        <div class="lado">${m.status === "respondeu" ? badge("Respondeu", "v") : m.status === "enviada" ? badge("Aguardando", "t") : badge("Sem resposta")}</div></li>`).join("")}</ul>`
        : vazio("Nenhum envio ainda.")}</section>
  </div></div>`);
}

function telaMentoria() {
  const etapas = etapasOrdenadas();
  const pessoas = contatosDa("mentoria");
  return moldura("mentoria", "mentoria", `
  <div class="cab"><div><div class="rotulo">Profissionais de saúde</div><h1>Mentorias</h1></div>
    <div class="acoes"><a class="btn leve" href="#/fila/mentoria">Fila do dia${filaDe("mentoria").length ? ` · ${filaDe("mentoria").length}` : ""}</a>
    <a class="btn verde" href="#/contato-novo/mentoria">Novo contato</a></div></div>
  <div class="cards">
    ${card("Contatos", pessoas.length, "no quadro")}
    ${card("Fila de hoje", filaDe("mentoria").length, "mensagens para enviar", "#/fila/mentoria", "t")}
    ${card("Cobranças", lista("cobrancas").filter((x) => x.status === "pendente").length, "em aberto", "#/cobrancas", "m")}
  </div>
  <p class="muted pequeno" style="margin-top:-12px">Use os botões para mudar a pessoa de etapa. Quando a etapa tem uma mensagem definida em Ajustes, ela entra na fila do dia automaticamente.</p>
  <div class="quadro">${etapas.map((e, i) => {
    const daqui = pessoas.filter((c) => c.etapaId === e.id).sort(porNome);
    const mod = porId("modelos", e.modeloId);
    return `<section class="coluna"><h4>${esc(e.nome)}</h4>
      <div class="sub">${daqui.length} ${daqui.length === 1 ? "pessoa" : "pessoas"}${mod ? ` · envia “${esc(mod.titulo)}”` : ""}</div>
      ${daqui.length ? daqui.map((c) => { const p = porId("pacotes", c.pacoteId); return `<div class="cartao">${linkContato(c)}
        <div class="det">${esc(c.origem || "Sem origem")}${p ? ` · ${esc(p.nome)}` : ""}</div>
        <div class="mov">${i > 0 ? `<button class="btn mini leve" data-acao="mover" data-dir="-1" data-id="${esc(c.id)}" aria-label="Etapa anterior">&larr;</button>` : "<span></span>"}
        ${i < etapas.length - 1 ? `<button class="btn mini verde" data-acao="mover" data-dir="1" data-id="${esc(c.id)}">Avançar &rarr;</button>` : ""}</div></div>`; }).join("")
        : `<div class="muted pequeno" style="padding:6px 4px">Ninguém nesta etapa.</div>`}</section>`;
  }).join("")}</div>
  ${pessoas.some((c) => !porId("etapas", c.etapaId)) ? `<section class="bloco" style="margin-top:20px"><header><h3>Sem etapa</h3></header><ul class="lista">
    ${pessoas.filter((c) => !porId("etapas", c.etapaId)).map((c) => `<li><div class="info">${linkContato(c)}</div><div class="lado"><a class="btn mini leve" href="#/contato-editar/${esc(c.id)}">Escolher etapa</a></div></li>`).join("")}</ul></section>` : ""}`);
}

function telaCobrancas() {
  const h = hoje();
  const itens = lista("cobrancas").filter((x) => contatoDe(x))
    .sort((a, b) => (a.status === "paga") - (b.status === "paga") || a.vencimento.localeCompare(b.vencimento));
  const pend = itens.filter((x) => x.status === "pendente");
  const soma = (xs) => xs.reduce((t, x) => t + (Number(x.valor) || 0), 0);
  const mail = (x) => {
    const c = contatoDe(x);
    const corpo = preencher(cfg("textoCobranca"), c).split("{valor}").join(dinheiro(x.valor)).split("{vencimento}").join(fmtData(x.vencimento));
    return `mailto:${encodeURIComponent(c.email || "")}?subject=${encodeURIComponent(cfg("assuntoCobranca"))}&body=${encodeURIComponent(corpo)}`;
  };
  const pessoas = contatosDa("mentoria").sort(porNome);
  return moldura("mentoria", "cobrancas", `
  <div class="cab"><div><div class="rotulo">Mentorias</div><h1>Cobranças</h1></div></div>
  <div class="cards">${card("Em aberto", dinheiro(soma(pend)), "a receber", "", "t")}
    ${card("Vencidas", pend.filter((x) => x.vencimento < h).length, "parcelas", "", "m")}
    ${card("Recebido", dinheiro(soma(itens.filter((x) => x.status === "paga"))), "marcado como pago")}</div>
  <div class="grade-2">
    <section class="bloco rolagem">${itens.length ? `<table class="tabela"><thead><tr><th>Pessoa</th><th>Parcela</th><th>Valor</th><th>Vencimento</th><th>Situação</th><th></th></tr></thead><tbody>
      ${itens.map((x) => `<tr><td>${linkContato(contatoDe(x))}</td><td>${esc(x.descricao)}</td><td>${esc(dinheiro(x.valor))}</td><td>${fmtData(x.vencimento)}</td>
        <td>${x.status === "paga" ? badge("Paga", "v") : x.vencimento < h ? badge("Vencida", "r") : badge("Em aberto", "m")}</td>
        <td style="white-space:nowrap">${x.status !== "paga" ? `<a class="btn mini leve" href="${esc(mail(x))}">E-mail</a>
          <button class="btn mini verde" data-acao="cobranca" data-op="paga" data-id="${esc(x.id)}">Paga</button>`
          : `<button class="btn mini leve" data-acao="cobranca" data-op="pendente" data-id="${esc(x.id)}">Reabrir</button>`}
          <button class="btn mini leve" data-acao="cobranca" data-op="excluir" data-id="${esc(x.id)}" aria-label="Excluir cobrança">Excluir</button></td></tr>`).join("")}
      </tbody></table>` : vazio("Nenhuma cobrança cadastrada.")}</section>
    <form class="bloco" data-form="cobranca"><header><h3>Nova cobrança</h3></header><div class="corpo">
      <div class="campo"><label for="b-pes">Pessoa</label><select id="b-pes" name="contatoId" required>${opcoes(pessoas.map((c) => [c.id, c.nome]), "", "Escolha")}</select></div>
      <div class="campo"><label for="b-desc">Descrição</label><input type="text" id="b-desc" name="descricao" value="Mentoria"></div>
      <div class="linha-campos"><div class="campo"><label for="b-val">Valor de cada parcela</label><input type="text" id="b-val" name="valor" inputmode="decimal" placeholder="497,00"></div>
        <div class="campo"><label for="b-par">Parcelas</label><input type="number" id="b-par" name="parcelas" min="1" max="24" value="1" inputmode="numeric"></div></div>
      <div class="campo"><label for="b-venc">Primeiro vencimento</label><input type="date" id="b-venc" name="vencimento" required></div>
      <button class="btn primario">Cadastrar</button>
      <p class="dica">O botão E-mail abre o seu e-mail com o lembrete pronto. O texto fica em Ajustes.</p>
    </div></form>
  </div>`);
}

function telaAniversarios() {
  const h = hoje();
  const itens = aniversariantes(null, 31);
  return moldura(null, "aniversarios", `
  <div class="cab"><div><div class="rotulo">Próximos 31 dias</div><h1>Aniversários</h1></div></div>
  <section class="bloco">${itens.length ? `<ul class="lista">${itens.map(({ dia, c }) => `<li>${bola(Number(dia.slice(8)), dia.slice(5, 7))}
    <div class="info">${linkContato(c)}<div class="det">${esc(AREAS[c.area])} · faz ${(idade(c) || 0) + (dia === h ? 0 : 1)} anos${dia === h ? " hoje" : ` na ${esc(diaSemana(dia))}`}</div></div>
    <div class="lado">${dia === h ? `<a class="btn mini whats" href="${esc(linkWhats(c, preencher(cfg("textoAniversario"), c)))}" target="_blank" rel="noopener">Dar parabéns</a>` : badge(`Em ${difDias(dia, h)} dias`)}</div></li>`).join("")}</ul>`
    : vazio("Nenhum aniversário nos próximos 31 dias.")}</section>`);
}

function telaImportar(area) {
  return moldura(area, "importar", `
  <div class="cab"><div><div class="rotulo">${esc(AREAS[area])}</div><h1>Importar planilha</h1></div></div>
  <div class="grade-2">
    <form class="bloco" data-form="importar" data-area="${area}"><div class="corpo">
      <div class="campo"><label for="i-arq">Arquivo .csv</label><input type="file" id="i-arq" name="arquivo" accept=".csv,text/csv" required></div>
      <button class="btn primario">Importar</button></div></form>
    <section class="bloco"><header><h3>Como preparar</h3></header><div class="corpo">
      <p>No Google Planilhas, abra a planilha de contatos e use <b>Arquivo &rsaquo; Fazer download &rsaquo; Valores separados por vírgula (.csv)</b>.</p>
      <p>A primeira linha precisa ter o nome das colunas. A ferramenta reconhece colunas com estes nomes:</p>
      <table class="tabela"><thead><tr><th>Coluna</th><th>Exemplo</th></tr></thead><tbody>
        <tr><td>Nome</td><td>Mariana Souza</td></tr><tr><td>Telefone ou WhatsApp</td><td>(21) 99999-1111</td></tr>
        <tr><td>E-mail</td><td>mariana@email.com</td></tr><tr><td>Nascimento</td><td>14/03/1990</td></tr>
        <tr><td>Origem</td><td>Indicação</td></tr><tr><td>Primeira consulta</td><td>02/11/2026</td></tr></tbody></table>
      <p class="dica">Depois de importar, abra cada ficha para escolher o pacote.</p></div></section>
  </div>`);
}

function telaAjustes() {
  const v = (k) => esc(S.ajustes?.[k] ?? "");
  const pacotes = [...lista("pacotes")].sort((a, b) => a.area.localeCompare(b.area) || a.nome.localeCompare(b.nome, "pt-BR"));
  const modelosM = lista("modelos").filter((m) => m.area === "mentoria");
  const area = (k, rotulo, ph) => `<div class="campo"><label for="a-${k}">${rotulo}</label><textarea id="a-${k}" name="${k}" placeholder="${esc(ph || PADRAO[k])}">${v(k)}</textarea></div>`;
  return moldura(null, "ajustes", `
  <div class="cab"><div><div class="rotulo">Configuração</div><h1>Ajustes</h1></div></div>
  <div class="grade-2"><div>
    <form class="bloco" data-form="textos"><header><h3>Dados e textos padrão</h3></header><div class="corpo">
      <div class="linha-campos"><div class="campo"><label for="a-nome">Nome do consultório (aparece no topo)</label><input type="text" id="a-nome" name="nomeNegocio" value="${v("nomeNegocio")}" placeholder="${esc(PADRAO.nomeNegocio)}"></div>
        <div class="campo"><label for="a-prazo">Horas para considerar sem retorno</label><input type="number" id="a-prazo" name="prazoHoras" min="1" max="720" value="${esc(cfg("prazoHoras"))}" inputmode="numeric"></div></div>
      <div class="campo"><label for="a-link">Link de agendamento</label><input type="url" id="a-link" name="linkAgenda" value="${v("linkAgenda")}" placeholder="https://calendar.app.google/..." inputmode="url"></div>
      ${area("textoLinkAgenda", "Mensagem com o link da agenda")}${area("textoConfirmacao", "Confirmação de consulta")}${area("textoAniversario", "Aniversário")}
      ${area("textoSemRetornoClinica", "Paciente sem retorno")}${area("textoSemRetornoMentoria", "Contato da mentoria sem retorno")}
      <div class="campo"><label for="a-ass">Assunto do e-mail de cobrança</label><input type="text" id="a-ass" name="assuntoCobranca" value="${v("assuntoCobranca")}" placeholder="${esc(PADRAO.assuntoCobranca)}"></div>
      ${area("textoCobranca", "Texto do e-mail de cobrança")}
      <p class="dica">Campos em branco usam o texto de exemplo. Use <code>{nome}</code>, <code>{data_consulta}</code>, <code>{link_agenda}</code>, <code>{valor}</code> e <code>{vencimento}</code>.</p>
      <button class="btn primario">Salvar textos</button></div></form>
  </div><div>
    <section class="bloco"><header><h3>Pacotes e programas</h3></header>
      ${pacotes.length ? `<div class="rolagem"><table class="tabela"><thead><tr><th>Nome</th><th>Área</th><th>Duração</th><th>Valor</th><th></th></tr></thead><tbody>
        ${pacotes.map((p) => `<tr><td>${esc(p.nome)}</td><td>${p.area === "clinica" ? "Clínica" : "Mentoria"}</td><td>${p.duracaoMeses ? `${p.duracaoMeses} meses` : ""}</td>
          <td>${esc(dinheiro(p.valor))}</td><td><button class="btn mini leve" data-acao="excluir-pacote" data-id="${esc(p.id)}">Excluir</button></td></tr>`).join("")}</tbody></table></div>` : vazio("Nenhum pacote cadastrado.")}
      <form class="corpo" style="border-top:1px solid var(--linha)" data-form="pacote">
        <div class="linha-campos"><div class="campo"><label for="pk-nome">Nome</label><input type="text" id="pk-nome" name="nome" placeholder="Acompanhamento 3 meses" required></div>
          <div class="campo"><label for="pk-area">Área</label><select id="pk-area" name="area"><option value="clinica">Clínica</option><option value="mentoria">Mentoria</option></select></div></div>
        <div class="linha-campos"><div class="campo"><label for="pk-dur">Duração em meses</label><input type="number" id="pk-dur" name="duracaoMeses" min="0" max="120" inputmode="numeric"></div>
          <div class="campo"><label for="pk-val">Valor</label><input type="text" id="pk-val" name="valor" inputmode="decimal"></div></div>
        <button class="btn mini verde">Adicionar pacote</button></form></section>
    <section class="bloco"><header><h3>Etapas da mentoria</h3></header><ul class="lista">
      ${etapasOrdenadas().map((e, i) => `<li><form data-form="etapa" data-id="${esc(e.id)}" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;width:100%">
        <div style="flex:1 1 140px"><label>${i + 1}ª etapa</label><input type="text" name="nome" value="${esc(e.nome)}" required></div>
        <div style="flex:1 1 160px"><label>Mensagem ao entrar</label><select name="modeloId">${opcoes(modelosM.map((m) => [m.id, m.titulo]), e.modeloId, "Nenhuma")}</select></div>
        <button class="btn mini verde">Salvar</button><button type="button" class="btn mini leve" data-acao="excluir-etapa" data-id="${esc(e.id)}">Excluir</button></form></li>`).join("")}</ul>
      <form class="corpo" style="border-top:1px solid var(--linha);display:flex;gap:8px;align-items:flex-end" data-form="etapa" data-id="">
        <div style="flex:1"><label for="et-nova">Nova etapa</label><input type="text" id="et-nova" name="nome" required></div>
        <button class="btn mini verde">Adicionar</button></form></section>
    <section class="bloco"><header><h3>Cópia de segurança</h3></header><div class="corpo">
      <p class="pequeno">A cópia guarda todos os cadastros, consultas, mensagens e cobranças num arquivo. Ele tem nomes, telefones e dados de saúde: guarde num lugar com senha e não mande por grupos.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn mini verde" data-acao="exportar">Baixar cópia</button></div>
      <form data-form="restaurar" style="margin-top:14px"><div class="campo"><label for="r-arq">Restaurar a partir de uma cópia</label>
        <input type="file" id="r-arq" name="arquivo" accept=".json,application/json" required></div><button class="btn mini leve">Restaurar</button></form>
    </div></section>
    <section class="bloco bloco-perigo"><header><h3>Dados de exemplo</h3></header><div class="corpo">
      ${lista("contatos").length ? `<p class="pequeno">Para apagar tudo desta conta (por exemplo, depois de testar com os dados de exemplo), use o botão abaixo. Não dá para desfazer.</p>
        <button class="btn mini perigo" data-acao="apagar-tudo">Apagar todos os dados</button>`
      : `<p class="pequeno">A conta está vazia. Para conhecer a ferramenta, carregue pacientes e contatos fictícios. Depois é só apagar.</p>
        <button class="btn mini verde" data-acao="exemplo">Carregar dados de exemplo</button>`}
    </div></section>
  </div></div>`);
}

function telaNaoEncontrado() {
  return moldura(null, "", `<div class="vazio">Este cadastro não existe mais.</div><p><a class="link-seta" href="#/">Voltar ao início &rarr;</a></p>`);
}

// ------------------------------------------------------------------ roteador
function rotaAtual() {
  const h = location.hash.replace(/^#\/?/, "");
  const [caminho, busca] = h.split("?");
  const partes = caminho.split("/").filter(Boolean).map(decodeURIComponent);
  const q = Object.fromEntries(new URLSearchParams(busca || ""));
  return { partes, q };
}

let pedido = 0;
function agendarRender() {
  if (pedido) return;
  pedido = requestAnimationFrame(() => {
    pedido = 0;
    // Não redesenha por cima de um formulário que a pessoa está preenchendo.
    if (document.querySelector("#app form[data-sujo]")) return;
    render();
  });
}

function render() {
  const app = document.getElementById("app");
  if (!S.authPronto) {
    app.innerHTML = `<div class="carregando">Carregando…</div>`;
    return;
  }
  if (!S.uid) {
    app.innerHTML = telaLogin();
    return;
  }
  if (!tudoCarregado()) {
    app.innerHTML = `<div class="carregando">Carregando…</div>`;
    return;
  }
  document.title = cfg("nomeNegocio");
  const { partes, q } = rotaAtual();
  const [r, a] = partes;
  const area = a in AREAS ? a : null;
  let html;
  switch (r) {
    case undefined: html = telaInicio(); break;
    case "clinica": html = telaClinica(); break;
    case "mentoria": html = telaMentoria(); break;
    case "fila": html = area ? telaFila(area) : telaInicio(); break;
    case "contatos": html = area ? telaContatos(area, q) : telaInicio(); break;
    case "contato": html = telaContato(a); break;
    case "contato-novo": html = area ? telaContatoForm(area, null) : telaInicio(); break;
    case "contato-editar": html = telaContatoForm(null, a); break;
    case "agenda": html = telaAgenda(q); break;
    case "mensagens": html = area ? telaMensagens(area, q) : telaInicio(); break;
    case "cobrancas": html = telaCobrancas(); break;
    case "aniversarios": html = telaAniversarios(); break;
    case "importar": html = area ? telaImportar(area) : telaInicio(); break;
    case "ajustes": html = telaAjustes(); break;
    default: html = telaInicio();
  }
  app.innerHTML = html;
}

window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

// ------------------------------------------------------------------ ações
const ACOES = {
  async "modo-login"() { S.modoLogin = S.modoLogin === "criar" ? "entrar" : "criar"; render(); },
  async esqueci() {
    const email = document.querySelector('[data-form="login"] [name=email]')?.value.trim();
    if (!email) { aviso("Digite o seu e-mail e toque de novo em Esqueci a senha.", "erro"); return; }
    try { await sendPasswordResetEmail(auth, email); } catch (e) { /* resposta genérica */ }
    aviso("Se houver uma conta com esse e-mail, você vai receber o link para criar uma senha nova.");
  },
  async sair() { await sairDaConta(); },
  async msg(el) {
    const id = el.dataset.id, op = el.dataset.op;
    if (op === "enviada") await atualizar("mensagens", id, { status: "enviada", enviadaEm: Date.now() });
    else if (op === "respondeu") await atualizar("mensagens", id, { status: "respondeu" });
    else if (op === "sem_resposta") await atualizar("mensagens", id, { status: "sem_resposta" });
    else if (op === "adiar") await atualizar("mensagens", id, { data: somarDias(hoje(), 1) });
    else if (op === "excluir") await apagar("mensagens", id);
  },
  async consulta(el) {
    const id = el.dataset.id, op = el.dataset.op;
    if (op === "excluir") { if (confirm("Excluir esta consulta?")) await apagar("consultas", id); return; }
    await atualizar("consultas", id, { status: op });
  },
  async mover(el) {
    const c = porId("contatos", el.dataset.id);
    const etapas = etapasOrdenadas();
    const i = Math.max(0, etapas.findIndex((e) => e.id === c.etapaId));
    const j = i + Number(el.dataset.dir);
    if (j < 0 || j >= etapas.length) return;
    const nova = etapas[j];
    const { id, ...resto } = c;
    const ops = [{ tipo: "set", nome: "contatos", id, dados: { ...resto, etapaId: nova.id } }];
    const mod = porId("modelos", nova.modeloId);
    if (mod && j > i && c.autoriza) {
      ops.push({ tipo: "set", nome: "mensagens", dados: { contatoId: id, data: hoje(), titulo: mod.titulo, texto: mod.texto, status: "programada", criadoEm: Date.now() } });
    }
    await emLote(ops);
    if (ops.length > 1) aviso(`${primeiroNome(c)} foi para ${nova.nome} e a mensagem dessa etapa entrou na fila de hoje.`);
  },
  async cobranca(el) {
    const id = el.dataset.id, op = el.dataset.op;
    if (op === "excluir") { if (confirm("Excluir esta cobrança?")) await apagar("cobrancas", id); return; }
    await atualizar("cobrancas", id, { status: op });
  },
  async "excluir-contato"(el) {
    const c = porId("contatos", el.dataset.id);
    if (!c || !confirm(`Excluir ${c.nome} e todo o histórico? Não dá para desfazer.`)) return;
    const ops = [{ tipo: "del", nome: "contatos", id: c.id }];
    for (const n of ["consultas", "mensagens", "cobrancas"]) {
      for (const x of lista(n).filter((x) => x.contatoId === c.id)) ops.push({ tipo: "del", nome: n, id: x.id });
    }
    await emLote(ops);
    location.hash = `#/contatos/${c.area}`;
    aviso("Cadastro excluído.");
  },
  async "excluir-pacote"(el) {
    if (!confirm("Excluir este pacote? Os pacientes continuam cadastrados, sem pacote.")) return;
    const id = el.dataset.id;
    const ops = [{ tipo: "del", nome: "pacotes", id }];
    for (const c of lista("contatos").filter((c) => c.pacoteId === id)) { const { id: cid, ...r } = c; ops.push({ tipo: "set", nome: "contatos", id: cid, dados: { ...r, pacoteId: "" } }); }
    await emLote(ops);
  },
  async "excluir-etapa"(el) {
    const id = el.dataset.id;
    if (lista("contatos").some((c) => c.etapaId === id)) { aviso("Essa etapa ainda tem pessoas. Mova as pessoas antes de excluir.", "erro"); return; }
    if (confirm("Excluir esta etapa?")) await apagar("etapas", id);
  },
  async "excluir-modelo"(el) {
    if (!confirm("Excluir este modelo?")) return;
    const id = el.dataset.id;
    const ops = [{ tipo: "del", nome: "modelos", id }];
    for (const e of lista("etapas").filter((e) => e.modeloId === id)) { const { id: eid, ...r } = e; ops.push({ tipo: "set", nome: "etapas", id: eid, dados: { ...r, modeloId: "" } }); }
    await emLote(ops);
  },
  async exportar() {
    if (!confirm("O arquivo tem nomes, telefones e dados de saúde. Guarde num lugar com senha e evite mandar por grupos. Baixar agora?")) return;
    const copia = { versao: 1, geradoEm: new Date().toISOString(), ajustes: S.ajustes };
    for (const n of COLECOES) copia[n] = lista(n);
    const blob = new Blob([JSON.stringify(copia, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `copia sistema nutricao ${hoje()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
  async exemplo() {
    if (lista("contatos").length) return;
    await emLote(dadosExemplo());
    aviso("Dados de exemplo carregados.");
    location.hash = "#/";
  },
  async "apagar-tudo"() {
    const resp = prompt("Isso apaga todos os cadastros, consultas, mensagens, cobranças e pacotes desta conta. Para confirmar, digite APAGAR");
    if (resp !== "APAGAR") return;
    const ops = [];
    for (const n of ["pacotes", "contatos", "consultas", "mensagens", "cobrancas"]) for (const x of lista(n)) ops.push({ tipo: "del", nome: n, id: x.id });
    await emLote(ops);
    aviso("Todos os dados foram apagados.");
  }
};

document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-acao]");
  if (!el) return;
  const fn = ACOES[el.dataset.acao];
  if (!fn) return;
  // O botão Abrir no WhatsApp segue o link normalmente e marca a mensagem como enviada.
  if (!(el.tagName === "A" && el.target === "_blank")) ev.preventDefault();
  try { await fn(el); } catch (e) { erroGravar(e); }
});

document.addEventListener("input", (ev) => {
  const f = ev.target.closest("#app form[data-form]");
  if (f && !["login", "filtro"].includes(f.dataset.form)) f.dataset.sujo = "1";
});
document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.matches("[data-filtro]")) el.form.requestSubmit();
  if (el.matches("[data-preenche-modelo]")) {
    const m = porId("modelos", el.value);
    if (m) { el.form.texto.value = m.texto; el.form.titulo.value = m.titulo; }
  }
  const f = el.closest("#app form[data-form]");
  if (f && !["login", "filtro"].includes(f.dataset.form)) f.dataset.sujo = "1";
});

function erroGravar(e) {
  if (e instanceof ErroDados) aviso(e.message, "erro");
  else aviso("Não foi possível salvar. Confira a conexão e tente de novo.", "erro");
}

// ------------------------------------------------------------------ formulários
const FORMS = {
  async login(f) {
    const email = f.email.value.trim(), senha = f.senha.value;
    if (!email || !senha) { aviso("Preencha o e-mail e a senha.", "erro"); return; }
    await setPersistence(auth, f.manter.checked ? browserLocalPersistence : browserSessionPersistence);
    if (S.modoLogin === "criar") {
      if (senha.length < 8) { aviso("A senha precisa ter pelo menos 8 caracteres.", "erro"); return; }
      try { await createUserWithEmailAndPassword(auth, email, senha); }
      catch (e) { aviso("Não foi possível criar a conta com esses dados. Se você já tem conta, toque em Já tenho conta.", "erro"); }
      return;
    }
    try { await signInWithEmailAndPassword(auth, email, senha); }
    catch (e) { aviso("E-mail ou senha incorretos.", "erro"); }
  },
  async filtro(f) {
    S.filtros[f.dataset.area] = { busca: f.busca.value.trim(), pacote: f.pacote ? f.pacote.value : "", status: f.status ? f.status.value : "" };
    if (location.hash.includes("?")) location.hash = `#/contatos/${f.dataset.area}`;
    else render();
  },
  async contato(f) {
    const id = f.dataset.id || null;
    const area = f.dataset.area || porId("contatos", id)?.area;
    const atual = id ? porId("contatos", id) : {};
    const dados = {
      ...atual, area,
      nome: f.nome.value, telefone: f.telefone.value, email: f.email.value, nascimento: f.nascimento.value,
      origem: f.origem.value, obs: f.obs.value, autoriza: f.autoriza.checked,
      pacoteId: f.pacoteId ? f.pacoteId.value : (atual.pacoteId || ""),
      criadoEm: atual.criadoEm || Date.now()
    };
    if (area === "clinica") { dados.inicio = f.inicio.value; dados.status = f.status.value; }
    else { dados.etapaId = f.etapaId.value || etapasOrdenadas()[0]?.id || ""; dados.status = dados.status || "ativo"; }
    delete dados.id;
    if (!String(dados.nome).trim()) { aviso("O nome é obrigatório.", "erro"); return; }
    const novo = await salvar("contatos", id, dados);
    delete f.dataset.sujo;
    aviso("Cadastro salvo.");
    location.hash = `#/contato/${novo}`;
  },
  async consulta(f) {
    if (!f.dia.value) { aviso("Informe a data da consulta.", "erro"); return; }
    await salvar("consultas", null, { contatoId: f.dataset.contato, data: f.dia.value, hora: f.hora.value || "09:00", tipo: f.tipo.value, status: "agendada", criadoEm: Date.now() });
    delete f.dataset.sujo;
    aviso("Consulta marcada.");
    render();
  },
  async programar(f) {
    const area = f.dataset.area;
    let texto = f.texto.value.trim();
    let titulo = f.titulo ? f.titulo.value.trim() : "";
    const mod = porId("modelos", f.modeloId.value);
    if (mod && !texto) texto = mod.texto;
    if (mod && !titulo) titulo = mod.titulo;
    const primeira = f.primeira.value || hoje();
    const vezes = Math.max(1, Math.min(52, Number(f.vezes.value) || 1));
    const intervalo = Number(f.intervalo.value) || 7;
    const destino = f.destino.value;
    let alvos = [];
    const [tipo, valor] = destino.split(":");
    if (tipo === "contato") alvos = [porId("contatos", valor)];
    else if (tipo === "pacote") alvos = contatosDa(area).filter((c) => c.pacoteId === valor && c.status === "ativo");
    else if (tipo === "etapa") alvos = contatosDa(area).filter((c) => c.etapaId === valor);
    else if (tipo === "todos") alvos = contatosDa(area).filter((c) => c.status !== "encerrado" && (area === "mentoria" || c.status === "ativo"));
    alvos = alvos.filter((c) => c && c.autoriza);
    if (!texto || !alvos.length) { aviso("Escolha quem recebe e escreva a mensagem (ou escolha um modelo). Só recebe quem autorizou mensagens.", "erro"); return; }
    const ops = [];
    for (const c of alvos) for (let i = 0; i < vezes; i++) {
      ops.push({ tipo: "set", nome: "mensagens", dados: { contatoId: c.id, data: somarDias(primeira, intervalo * i), titulo: titulo || "Mensagem", texto, status: "programada", criadoEm: Date.now() } });
    }
    await emLote(ops);
    delete f.dataset.sujo;
    aviso(`${ops.length} ${ops.length === 1 ? "mensagem programada" : "mensagens programadas"} para ${alvos.length} ${alvos.length === 1 ? "pessoa" : "pessoas"}.`);
    if (f.dataset.voltar) render(); else { f.reset(); render(); }
  },
  async modelo(f) {
    const id = f.dataset.id || null;
    if (!f.titulo.value.trim() || !f.texto.value.trim()) { aviso("Preencha o título e o texto do modelo.", "erro"); return; }
    const atual = id ? porId("modelos", id) : null;
    await salvar("modelos", id, { area: f.dataset.area, titulo: f.titulo.value, texto: f.texto.value, criadoEm: atual?.criadoEm || Date.now() });
    delete f.dataset.sujo;
    aviso("Modelo salvo.");
    render();
  },
  async cobranca(f) {
    const valor = paraValor(f.valor.value);
    const venc = f.vencimento.value;
    const parcelas = Math.max(1, Math.min(24, Number(f.parcelas.value) || 1));
    if (!f.contatoId.value || !venc || valor === null) { aviso("Preencha a pessoa, o valor e o primeiro vencimento.", "erro"); return; }
    const ops = [];
    for (let i = 0; i < parcelas; i++) {
      const desc = (f.descricao.value.trim() || "Mentoria") + (parcelas > 1 ? ` (${i + 1}/${parcelas})` : "");
      ops.push({ tipo: "set", nome: "cobrancas", dados: { contatoId: f.contatoId.value, descricao: desc, valor, vencimento: i ? somarMeses(venc, i) : venc, status: "pendente", criadoEm: Date.now() } });
    }
    await emLote(ops);
    delete f.dataset.sujo;
    aviso("Cobrança cadastrada.");
    render();
  },
  async textos(f) {
    const dados = {};
    for (const k of Object.keys(ESQUEMA.config)) if (f[k]) dados[k] = f[k].value;
    await salvar("config", "ajustes", { ...S.ajustes, ...dados });
    delete f.dataset.sujo;
    aviso("Ajustes salvos.");
  },
  async pacote(f) {
    await salvar("pacotes", null, { area: f.area.value, nome: f.nome.value, duracaoMeses: f.duracaoMeses.value, valor: paraValor(f.valor.value), criadoEm: Date.now() });
    delete f.dataset.sujo;
    aviso("Pacote adicionado.");
    render();
  },
  async etapa(f) {
    const id = f.dataset.id || null;
    const atual = id ? porId("etapas", id) : null;
    const ordem = atual ? atual.ordem : Math.max(0, ...lista("etapas").map((e) => e.ordem || 0)) + 1;
    await salvar("etapas", id, { nome: f.nome.value, ordem, modeloId: f.modeloId ? f.modeloId.value : (atual?.modeloId || ""), criadoEm: atual?.criadoEm || Date.now() });
    delete f.dataset.sujo;
    aviso("Etapa salva.");
    render();
  },
  async importar(f) {
    const arq = f.arquivo.files[0];
    if (!arq) { aviso("Escolha um arquivo .csv.", "erro"); return; }
    if (arq.size > 5 * 1024 * 1024) { aviso("O arquivo é grande demais (limite de 5 MB).", "erro"); return; }
    const area = f.dataset.area;
    const linhas = lerCsv(await lerTexto(arq));
    if (linhas.length < 2) { aviso("A planilha está vazia ou sem cabeçalho.", "erro"); return; }
    const mapa = linhas[0].map((col) => {
      const k = col.trim().toLocaleLowerCase("pt-BR");
      if (k.includes("nome")) return "nome";
      if (k.includes("tel") || k.includes("celular") || k.includes("whats")) return "telefone";
      if (k.includes("mail")) return "email";
      if (k.includes("nasc") || k.includes("anivers")) return "nascimento";
      if (k.includes("origem") || k.includes("indica")) return "origem";
      if (k.includes("consulta") || k.includes("inicio") || k.includes("início")) return "inicio";
      return null;
    });
    const primeira = etapasOrdenadas()[0]?.id || "";
    const ops = [];
    for (const linha of linhas.slice(1)) {
      const d = {};
      mapa.forEach((campo, i) => { if (campo && linha[i] !== undefined) d[campo] = String(linha[i]).trim(); });
      if (!d.nome) continue;
      ops.push({ tipo: "set", nome: "contatos", dados: {
        area, nome: d.nome, telefone: d.telefone, email: d.email, nascimento: paraDia(d.nascimento), origem: d.origem || "Importação",
        inicio: paraDia(d.inicio), status: "ativo", autoriza: true, etapaId: area === "mentoria" ? primeira : "", criadoEm: Date.now()
      } });
    }
    if (!ops.length) { aviso("Nenhuma linha com nome foi encontrada.", "erro"); return; }
    await emLote(ops);
    delete f.dataset.sujo;
    aviso(`${ops.length} ${ops.length === 1 ? "contato importado" : "contatos importados"}.`);
    location.hash = `#/contatos/${area}`;
  },
  async restaurar(f) {
    const arq = f.arquivo.files[0];
    if (!arq) return;
    let copia;
    try { copia = JSON.parse(await lerTexto(arq)); } catch (e) { aviso("Este arquivo não é uma cópia de segurança válida.", "erro"); return; }
    if (!copia || copia.versao !== 1) { aviso("Este arquivo não é uma cópia de segurança válida.", "erro"); return; }
    if (!confirm("Restaurar a cópia? Os registros da cópia substituem os que tiverem o mesmo código. Os demais continuam.")) return;
    const ops = [];
    for (const n of COLECOES) {
      for (const x of Array.isArray(copia[n]) ? copia[n] : []) {
        if (!x || typeof x.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(x.id)) continue;
        try { limpar(n, x); } catch (e) { continue; }
        ops.push({ tipo: "set", nome: n, id: x.id, dados: x });
      }
    }
    if (copia.ajustes) ops.push({ tipo: "set", nome: "config", id: "ajustes", dados: copia.ajustes });
    await emLote(ops);
    delete f.dataset.sujo;
    aviso(`Cópia restaurada com ${ops.length} registros.`);
    render();
  }
};

document.addEventListener("submit", async (ev) => {
  const f = ev.target.closest("form[data-form]");
  if (!f) return;
  ev.preventDefault();
  const fn = FORMS[f.dataset.form];
  if (!fn) return;
  const botao = f.querySelector("button:not([type=button])");
  if (botao) botao.disabled = true;
  try { await fn(f); } catch (e) { erroGravar(e); }
  finally { if (botao && botao.isConnected) botao.disabled = false; }
});

function lerTexto(arq) {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => {
      const buf = new Uint8Array(r.result);
      let t;
      try { t = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { t = new TextDecoder("windows-1252").decode(buf); }
      ok(t.replace(/^﻿/, ""));
    };
    r.onerror = falha;
    r.readAsArrayBuffer(arq);
  });
}
function lerCsv(texto) {
  const primeira = texto.split(/\r?\n/)[0] || "";
  const sep = (primeira.match(/;/g) || []).length > (primeira.match(/,/g) || []).length ? ";" : ",";
  const linhas = [];
  let linha = [], campo = "", aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      if (linha.some((x) => x.trim())) linhas.push(linha);
      linha = [];
    } else campo += ch;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim())) linhas.push(linha);
  return linhas;
}

// ------------------------------------------------------------------ padrões e exemplo
const MODELOS_PADRAO = {
  clinica: [
    ["Checklist da rotina", "Oi, {nome}! Passando para saber como está a implementação da rotina nesta primeira semana. Conseguiu fazer o mercado com a lista? E a programação dos treinos da semana, como ficou? Me conta como está sendo."],
    ["Como está o corpo", "Oi, {nome}, tudo bem? Já faz uns dias que começamos e queria saber como o seu corpo está respondendo. Como estão o sono, o intestino, a disposição no dia a dia e o rendimento no treino?"],
    ["Acompanhamento da semana", "Oi, {nome}! Como foi a sua semana com a rotina? Teve algum momento mais difícil ou alguma conquista que queira me contar?"],
    ["Lembrete da consulta", "Oi, {nome}! A nossa próxima consulta está marcada para {data_consulta}. Até lá, anote o que quiser conversar comigo."],
    ["Como foi o processo", "Oi, {nome}! Chegamos ao fim deste ciclo e eu queria muito saber de você: como foi o processo? O que mudou na sua rotina e o que achou mais desafiador?"]
  ],
  mentoria: [
    ["Obrigada pelo evento", "Oi, {nome}! Foi muito bom ter você no evento. Fico à disposição para conversar sobre a sua carreira e sobre como você constrói a relação com os seus pacientes e alunos."],
    ["Convite para conversa", "Oi, {nome}! Que bom que você quer conversar sobre a mentoria. Escolha o melhor horário para você aqui: {link_agenda}"],
    ["Proposta enviada", "Oi, {nome}! Acabei de te mandar a proposta da mentoria. Qualquer dúvida, me chama por aqui."],
    ["Boas-vindas à mentoria", "Oi, {nome}! Seja muito bem-vinda à mentoria. Em breve te mando os próximos passos e o calendário dos encontros."]
  ]
};

async function criarPadroes() {
  const agoraTs = Date.now();
  const ops = [];
  const ids = {};
  for (const area of Object.keys(MODELOS_PADRAO)) {
    for (const [titulo, texto] of MODELOS_PADRAO[area]) {
      ids[titulo] = novoId("modelos");
      ops.push({ tipo: "set", nome: "modelos", id: ids[titulo], dados: { area, titulo, texto, criadoEm: agoraTs } });
    }
  }
  const etapas = [["Contato do evento", ""], ["Conversa marcada", "Convite para conversa"], ["Proposta enviada", "Proposta enviada"], ["Matriculada", "Boas-vindas à mentoria"], ["Não seguiu", ""]];
  etapas.forEach(([nome, mod], i) => ops.push({ tipo: "set", nome: "etapas", dados: { nome, ordem: i + 1, modeloId: mod ? ids[mod] : "", criadoEm: agoraTs } }));
  ops.push({ tipo: "set", nome: "config", id: "ajustes", dados: { nomeNegocio: PADRAO.nomeNegocio, prazoHoras: PADRAO.prazoHoras } });
  await emLote(ops);
}

function dadosExemplo() {
  let semente = 42;
  const rnd = () => ((semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648);
  const escolha = (xs) => xs[Math.floor(rnd() * xs.length)];
  const h = hoje(), ag = agora(), agoraTs = Date.now();
  const ops = [];
  const add = (nome, dados, id) => { id = id || novoId(nome); ops.push({ tipo: "set", nome, id, dados: { ...dados, criadoEm: agoraTs } }); return id; };
  const p3 = add("pacotes", { area: "clinica", nome: "Acompanhamento 3 meses", duracaoMeses: 3, valor: 1350 });
  const p6 = add("pacotes", { area: "clinica", nome: "Acompanhamento 6 meses", duracaoMeses: 6, valor: 2400 });
  const pm = add("pacotes", { area: "clinica", nome: "Manutenção", valor: 280 });
  const pmen = add("pacotes", { area: "mentoria", nome: "Mentoria para profissionais de saúde", duracaoMeses: 6, valor: 2980 });
  const pac = { "3m": p3, "6m": p6, man: pm };
  const mod = (area, t) => (lista("modelos").find((m) => m.area === area && m.titulo === t)?.texto) || MODELOS_PADRAO[area].find((x) => x[0] === t)[1];
  const pacientes = [
    ["Mariana Albuquerque", 7, "3m", "Indicação"], ["Carolina Peixoto", 14, "3m", "Instagram"], ["Beatriz Moraes", 35, "3m", "Indicação"],
    ["Juliana Teixeira", 52, "3m", "Captação direta"], ["Fernanda Lacerda", 44, "3m", "Indicação"], ["Renata Siqueira", 88, "3m", "Instagram"],
    ["Patrícia Gouveia", 21, "6m", "Indicação"], ["Luciana Barreto", 43, "6m", "Captação direta"], ["Camila Rezende", 135, "6m", "Indicação"],
    ["Daniela Fontes", 178, "6m", "Instagram"], ["Rodrigo Valente", 28, "3m", "Indicação"], ["Thiago Monteiro", 89, "6m", "Captação direta"],
    ["Vanessa Coutinho", 200, "man", "Indicação"], ["Aline Furtado", 260, "man", "Instagram"]
  ];
  const idsPac = {};
  pacientes.forEach(([nome, dias, pc, origem], i) => {
    const inicio = somarDias(h, -dias);
    let nasc = `${1972 + Math.floor(rnd() * 28)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`;
    if (i === 2) nasc = nasc.slice(0, 4) + h.slice(4);
    if (i === 5 || i === 9) { const alvo = somarDias(h, i === 5 ? 3 : 6); nasc = nasc.slice(0, 4) + alvo.slice(4, 8) + String(Math.min(Number(alvo.slice(8)), 28)).padStart(2, "0"); }
    const autoriza = i !== 11;
    const id = add("contatos", {
      area: "clinica", nome, telefone: `2198765${String(101 + i).padStart(4, "0")}`, email: `${nome.split(" ")[0].toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "")}@exemplo.com`,
      nascimento: nasc, origem, pacoteId: pac[pc], inicio, status: pc === "man" ? "manutencao" : "ativo", autoriza, etapaId: "", obs: ""
    });
    idsPac[nome] = id;
    const n = { "3m": 3, "6m": 5, man: 8 }[pc];
    for (let k = 0; k < n; k++) {
      let dia = somarDias(inicio, 45 * k);
      while ([0, 6].includes(new Date(dia + "T12:00:00Z").getUTCDay())) dia = somarDias(dia, 1);
      const hora = `${String(escolha([8, 9, 10, 11, 14, 15, 16, 17])).padStart(2, "0")}:${escolha(["00", "30"])}`;
      const q = `${dia}T${hora}`;
      let status;
      if (q < ag) status = rnd() > 0.07 ? "realizada" : "faltou";
      else if (difDias(dia, h) > 60) break;
      else status = (difDias(dia, h) >= 2 && difDias(dia, h) < 5) ? "confirmada" : "agendada";
      if (i === 3 && q >= ag) continue;
      const tipo = pc === "man" ? "Manutenção" : k === 0 ? "Primeira consulta" : k === n - 1 ? "Desfecho" : "Reavaliação";
      add("consultas", { contatoId: id, data: dia, hora, tipo, status });
    }
    if (!autoriza) return;
    const semanas = { "3m": 13, "6m": 26, man: 0 }[pc];
    for (let s = 1; s <= semanas; s++) {
      const dia = somarDias(inicio, 7 * s);
      const titulo = s === 1 ? "Checklist da rotina" : (s % 6 === 2) ? "Como está o corpo" : s === semanas ? "Como foi o processo" : "Acompanhamento da semana";
      const dados = { contatoId: id, data: dia, titulo, texto: mod("clinica", titulo), status: "programada" };
      if (dia < somarDias(h, -1)) { dados.status = rnd() > 0.15 ? "respondeu" : "sem_resposta"; dados.enviadaEm = new Date(dia + "T12:10:00Z").getTime(); }
      else if (dia < h && i % 2 === 0) { dados.status = "enviada"; dados.enviadaEm = new Date(dia + "T12:10:00Z").getTime(); }
      add("mensagens", dados);
    }
  });
  for (const nome of ["Juliana Teixeira", "Luciana Barreto"]) {
    const ts = Date.now() - 3 * 86400000;
    add("mensagens", { contatoId: idsPac[nome], data: somarDias(h, -3), titulo: "Acompanhamento da semana", texto: mod("clinica", "Acompanhamento da semana"), status: "enviada", enviadaEm: ts });
  }
  const etapas = etapasOrdenadas();
  const mentoria = [["Larissa Campos", "Evento presencial", 0], ["Gustavo Lemos", "Evento presencial", 0], ["Isadora Pinheiro", "Evento online", 0],
    ["Natália Brandão", "Evento online", 1], ["Felipe Arruda", "Evento presencial", 1], ["Bruna Carvalho", "Indicação", 2], ["Tatiane Rocha", "Evento online", 2],
    ["Priscila Andrade", "Evento presencial", 3], ["Leonardo Batista", "Evento online", 3], ["Mônica Vieira", "Evento presencial", 4]];
  mentoria.forEach(([nome, origem, col], i) => {
    const id = add("contatos", {
      area: "mentoria", nome, telefone: `2199988${String(1000 + i * 37)}`, email: `${nome.split(" ")[0].toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "")}@exemplo.com`,
      nascimento: `${1980 + (i * 7) % 18}-${String(1 + (i * 5) % 12).padStart(2, "0")}-${String(1 + (i * 11) % 28).padStart(2, "0")}`, origem,
      pacoteId: col >= 2 ? pmen : "", inicio: "", status: "ativo", autoriza: true, etapaId: etapas[Math.min(col, etapas.length - 1)]?.id || "",
      obs: i % 2 ? "Nutricionista" : "Educador físico"
    });
    if (col === 0) add("mensagens", { contatoId: id, data: h, titulo: "Obrigada pelo evento", texto: mod("mentoria", "Obrigada pelo evento"), status: "programada" });
    if (col === 3) {
      for (let k = 0; k < 6; k++) {
        const venc = somarMeses(h.slice(0, 8) + "10", k - 2);
        add("cobrancas", { contatoId: id, descricao: `Mentoria (${k + 1}/6)`, valor: 496.67, vencimento: venc, status: venc < somarDias(h, -5) ? "paga" : "pendente" });
      }
    }
  });
  return ops;
}

// ------------------------------------------------------------------ sessão
const limparAvisos = () => { const c = document.getElementById("avisos"); if (c) c.innerHTML = ""; };

async function sairDaConta() {
  limparAvisos();
  pararAssinaturas();
  zerarEstado();
  S.uid = null;
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  try { await signOut(auth); } catch (e) { /* já saiu */ }
  location.hash = "#/";
  render();
}

// Demonstração: espera os modelos e as etapas padrão e carrega os dados de exemplo uma vez por carregamento da página
let demoCarregada = false;
async function carregarDemonstracao() {
  if (demoCarregada) return;
  demoCarregada = true;
  for (let i = 0; i < 100 && !lista("etapas").length; i++) await new Promise((r) => setTimeout(r, 30));
  if (!lista("contatos").length) await emLote(dadosExemplo());
}

onAuthStateChanged(auth, (usuario) => {
  S.authPronto = true;
  if (usuario) {
    if (S.uid === usuario.uid) return;
    zerarEstado();
    limparAvisos();
    S.uid = usuario.uid;
    render();
    assinar();
    carregarDemonstracao();
  } else {
    pararAssinaturas();
    zerarEstado();
    S.uid = null;
    S.modoLogin = "entrar";
    render();
  }
});

render();
