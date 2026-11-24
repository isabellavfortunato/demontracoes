// Firebase simulado para a demonstração: entra sozinho, sem login, e guarda os dados só na memória desta página.
// Nada vai para a internet e tudo volta ao exemplo quando a página é recarregada.
const banco = new Map();
const assinaturas = new Set();
let contador = 0;
const chave = (p) => p.join("/");
const copia = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const avisar = () => assinaturas.forEach((f) => f());

const usuario = { uid: "demonstracao", email: "demonstracao@exemplo.com" };
let aoMudarLogin = null;

export const initializeApp = () => ({});
export const getAuth = () => ({});
export const getFirestore = () => ({});
export const browserLocalPersistence = {};
export const browserSessionPersistence = {};
export const setPersistence = async () => {};
export const onAuthStateChanged = (a, f) => { aoMudarLogin = f; setTimeout(() => f(usuario), 0); return () => {}; };
export const signInWithEmailAndPassword = async () => { setTimeout(() => aoMudarLogin && aoMudarLogin(usuario), 0); return { user: usuario }; };
export const createUserWithEmailAndPassword = signInWithEmailAndPassword;
export const sendPasswordResetEmail = async () => {};
export const signOut = async () => { setTimeout(() => aoMudarLogin && aoMudarLogin(null), 0); };

export const collection = (db, ...p) => ({ tipo: "col", path: p });
export const doc = (a, ...p) => {
  if (a && a.tipo === "col" && !p.length) {
    const id = "d" + (++contador).toString(36) + Math.random().toString(36).slice(2, 8);
    return { tipo: "doc", path: [...a.path, id], id };
  }
  const path = a && a.tipo === "col" ? [...a.path, ...p] : p;
  return { tipo: "doc", path, id: path[path.length - 1] };
};

function docsDaColecao(path) {
  const pre = chave(path) + "/";
  const docs = [];
  for (const [k, v] of banco) {
    if (k.startsWith(pre) && !k.slice(pre.length).includes("/")) {
      const id = k.slice(pre.length);
      docs.push({ id, data: () => copia(v), exists: () => true });
    }
  }
  return docs;
}

export const onSnapshot = (r, f) => {
  const rodar = () => {
    if (r.tipo === "col") { const docs = docsDaColecao(r.path); f({ docs, size: docs.length, empty: !docs.length }); }
    else { const v = banco.get(chave(r.path)); f({ id: r.id, data: () => copia(v), exists: () => v !== undefined }); }
  };
  assinaturas.add(rodar);
  setTimeout(rodar, 0);
  return () => assinaturas.delete(rodar);
};

function gravarUm(r, d, opcoes) {
  const k = chave(r.path);
  banco.set(k, opcoes && opcoes.merge ? { ...(banco.get(k) || {}), ...copia(d) } : copia(d));
}
export const setDoc = async (r, d, opcoes) => { gravarUm(r, d, opcoes); avisar(); };
export const updateDoc = async (r, d) => { gravarUm(r, d, { merge: true }); avisar(); };
export const deleteDoc = async (r) => { banco.delete(chave(r.path)); avisar(); };
export const writeBatch = () => {
  const ops = [];
  const lote = {
    set: (r, d, o) => { ops.push(() => gravarUm(r, d, o)); return lote; },
    update: (r, d) => { ops.push(() => gravarUm(r, d, { merge: true })); return lote; },
    delete: (r) => { ops.push(() => banco.delete(chave(r.path))); return lote; },
    commit: async () => { ops.forEach((f) => f()); avisar(); }
  };
  return lote;
};

// Selo da demonstração e botão Restaurar exemplo, no topo da página
function colocarSelo() {
  if (document.getElementById("selo-demonstracao")) return;
  const estilo = document.createElement("style");
  estilo.textContent = `#selo-demonstracao{position:sticky;top:0;z-index:9999;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px 14px;padding:7px 14px;padding-top:calc(7px + env(safe-area-inset-top,0px));background:#14213d;color:#f2c44e;font:600 14px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center}
#selo-demonstracao button{border:1px solid #f2c44e;background:transparent;color:#f2c44e;border-radius:8px;min-height:32px;padding:0 12px;font:600 13px system-ui,-apple-system,sans-serif;cursor:pointer}
#selo-demonstracao button:hover{background:#f2c44e;color:#14213d}`;
  document.head.appendChild(estilo);
  const selo = document.createElement("div");
  selo.id = "selo-demonstracao";
  selo.innerHTML = '<span>Demonstração com dados fictícios</span><button type="button">Restaurar exemplo</button>';
  selo.querySelector("button").addEventListener("click", () => {
    if (confirm("Restaurar o exemplo? Tudo o que você mudou nesta demonstração será desfeito.")) location.reload();
  });
  document.body.prepend(selo);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", colocarSelo);
else colocarSelo();
