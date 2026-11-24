import {initializeApp,getAuth,onAuthStateChanged,signInWithEmailAndPassword,createUserWithEmailAndPassword,sendPasswordResetEmail,signOut,setPersistence,browserLocalPersistence,browserSessionPersistence,getFirestore,collection,doc,setDoc,deleteDoc,onSnapshot,writeBatch} from './firebase-demo.js';
const firebaseConfig={};
const fbApp=initializeApp(firebaseConfig),auth=getAuth(fbApp),fdb=getFirestore(fbApp);
{
const $=id=>document.getElementById(id);
const TRANSP=['Mercado Livre','TikTok Shop','Shopee','Amazon','Shein','Magalu','Correios','Jadlog','Loggi','Total Express','Outra'];
const LS='controle-encomendas-v1';
let itens=[],clientes=[],valorPadrao=10,modo='nuvem',UID=null,subs=[],filtro='todas',editId=null,carregado=false,aba='bus',tela='reg',rTipo='enc',rOrdem='cli';
let F={chPre:'tudo',chDe:'',chAte:'',enPre:'tudo',enDe:'',enAte:'',bairro:''};

const iso=d=>new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10);
const parse=s=>{const[y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const hoje=()=>iso(new Date());
const somaDias=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return iso(d)};
const br=s=>s?s.split('-').reverse().join('/'):'';
const brl=v=>(+v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
const novoId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const esperar=ms=>new Promise(r=>setTimeout(r,ms));
const MESES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const soma=a=>a.reduce((s,x)=>s+(+x.valor||0),0);

function toast(t){const e=$('toast');e.textContent=t;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),2800)}

/* ---------- armazenamento (Firebase) ---------- */
function gravarLocal(){}
function gravarFiltros(){try{localStorage.setItem(LS+'-filtros',JSON.stringify(F))}catch(e){}}
const CAMPOS_DB={encomendas:{rastreio:'t80',transportadora:'t60',chegada:'d',destinatario:'t150',endereco:'t300',bairro:'t100',telefone:'t40',valor:'n',entregue:'b',entregueEm:'d',pago:'b',pagoEm:'d',forma:'t30',obs:'t1000',criadoEm:'n'},
 clientes:{nome:'t150',endereco:'t300',bairro:'t100',telefone:'t40',obs:'t1000',criadoEm:'n'}};
function limpo(c,o){const S=CAMPOS_DB[c],r={};
 for(const[k,tp]of Object.entries(S)){let v=o[k];if(v===undefined||v===null)continue;
  if(tp[0]==='t')r[k]=String(v).trim().slice(0,+tp.slice(1));
  else if(tp==='d'){v=String(v);r[k]=/^\d{4}-\d{2}-\d{2}$/.test(v)?v:''}
  else if(tp==='b')r[k]=!!v;
  else{const n=+v;r[k]=isFinite(n)?Math.min(Math.max(n,0),k==='valor'?100000:99999999999999):0}}
 return r}
const ref=(c,id)=>doc(fdb,'usuarios',UID,c,String(id).replace(/\//g,'-').slice(0,40));
async function gravar(c,o,lote){
 for(let t=0;t<2;t++){try{await setDoc(ref(c,o.id),limpo(c,o));return true}
  catch(e){if(e&&e.code==='unavailable'&&!t){await esperar(800);continue}if(!lote)toast(e&&e.code==='permission-denied'?'Sem permissão para salvar. Entre de novo na sua conta.':'Não foi possível salvar. Tente de novo.');return false}}
 return false;
}
async function gravarVarios(c,L,aviso){
 let ok=0;
 for(let i=0;i<L.length;i+=400){const b=writeBatch(fdb),P=L.slice(i,i+400);for(const o of P)b.set(ref(c,String(o.id).slice(0,40)),limpo(c,o));
  try{await b.commit();ok+=P.length}catch(e){}aviso&&aviso(Math.min(i+400,L.length))}
 return ok;
}
async function remover(c,id){try{await deleteDoc(ref(c,id))}catch(e){toast('Não foi possível apagar.')}}
async function salvarValor(v){valorPadrao=v;try{await setDoc(doc(fdb,'usuarios',UID,'config','geral'),{valorPadrao:v})}catch(e){toast('Não foi possível salvar o valor.')}render()}
const acharCliente=n=>{const k=norm(n);return k?clientes.find(c=>norm(c.nome)===k):null};
async function garantirCliente(nome,endereco,telefone,bairro){if(!nome)return;const c=acharCliente(nome);if(c){if(bairro&&!c.bairro)await gravar('clientes',{...c,bairro});return}await gravar('clientes',{id:novoId(),nome,endereco:endereco||'',bairro:bairro||'',telefone:telefone||'',obs:'',criadoEm:Date.now()})}

/* ---------- bairros ---------- */
function bairros(){const m=new Map();for(const x of[...itens,...clientes]){const b=String(x.bairro||'').trim();if(!b)continue;const k=norm(b);const o=m.get(k)||{k,nomes:{},n:0};o.nomes[b]=(o.nomes[b]||0)+1;if(x.destinatario!==undefined)o.n++;m.set(k,o)}
 return[...m.values()].map(o=>({k:o.k,nome:Object.entries(o.nomes).sort((a,b)=>b[1]-a[1])[0][0],n:o.n})).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'))}
const nomeBairro=k=>(bairros().find(b=>b.k===k)||{}).nome||k;

/* ---------- datas e filtros ---------- */
const PERIODOS=[['tudo','Qualquer data'],['hoje','Hoje'],['ontem','Ontem'],['semana','Esta semana'],['semanaPassada','Semana passada'],['mes','Este mês'],['mesPassado','Mês passado'],['pers','Escolher as datas']];
function faixa(p){
 const h=hoje(),d=parse(h),ini=somaDias(h,-((d.getDay()+6)%7)),Y=d.getFullYear(),M=d.getMonth();
 return({tudo:['',''],hoje:[h,h],ontem:[somaDias(h,-1),somaDias(h,-1)],semana:[ini,somaDias(ini,6)],semanaPassada:[somaDias(ini,-7),somaDias(ini,-1)],
  mes:[iso(new Date(Y,M,1)),iso(new Date(Y,M+1,0))],mesPassado:[iso(new Date(Y,M-1,1)),iso(new Date(Y,M,0))]})[p];
}
function aplicarPresets(){for(const k of['ch','en']){const p=F[k+'Pre'];if(p!=='pers'){const[a,b]=faixa(p);F[k+'De']=a;F[k+'Ate']=b}}}
const dentro=(v,a,b)=>(!a||(v&&v>=a))&&(!b||(v&&v<=b));
function filtrar(m){
 let L=itens;
 if(m==='pai')L=L.filter(x=>filtro==='todas'||(filtro==='aentregar'&&!x.entregue)||(filtro==='entregues'&&x.entregue)||(filtro==='pagas'&&x.pago)||(filtro==='naopagas'&&!x.pago));
 if(m==='fil'){
  if(F.chDe||F.chAte)L=L.filter(x=>dentro(x.chegada,F.chDe,F.chAte));
  if(F.enDe||F.enAte)L=L.filter(x=>x.entregue&&dentro(x.entregueEm,F.enDe,F.enAte));
  if(F.bairro)L=L.filter(x=>F.bairro==='__sem'?!String(x.bairro||'').trim():norm(x.bairro)===F.bairro)}
 if(m==='bus'){const q=norm($('q').value);L=q?L.filter(x=>norm([x.rastreio,x.destinatario,x.endereco,x.bairro,x.transportadora,x.telefone,x.obs].join(' ')).includes(q)):[]}
 return L;
}
const filtroDatas=()=>!!(F.chDe||F.chAte||F.enDe||F.enAte||F.bairro);
function descFiltro(){const p=[];
 if(F.chDe||F.chAte)p.push('chegada '+(F.chDe===F.chAte?'em '+br(F.chDe):(F.chDe?'de '+br(F.chDe):'')+(F.chAte?' até '+br(F.chAte):'')));
 if(F.enDe||F.enAte)p.push('entrega '+(F.enDe===F.enAte?'em '+br(F.enDe):(F.enDe?'de '+br(F.enDe):'')+(F.enAte?' até '+br(F.enAte):'')));
 if(F.bairro)p.push(F.bairro==='__sem'?'sem bairro':'bairro '+nomeBairro(F.bairro));
 return p.join(', ')}

/* ---------- cálculos ---------- */
function numeros(L){
 const h=hoje(),ini=somaDias(h,-((parse(h).getDay()+6)%7)),fim=somaDias(ini,6),mes=h.slice(0,7);
 const pagos=L.filter(x=>x.pago&&x.pagoEm),ent=L.filter(x=>x.entregue),naoPg=L.filter(x=>!x.pago);
 return{total:L.length,aEnt:L.filter(x=>!x.entregue).length,ent:ent.length,pg:L.filter(x=>x.pago).length,naoPg:naoPg.length,aberto:soma(naoPg),recebido:soma(L.filter(x=>x.pago)),
  entHoje:ent.filter(x=>x.entregueEm===h).length,dia:soma(pagos.filter(x=>x.pagoEm===h)),sem:soma(pagos.filter(x=>x.pagoEm>=ini&&x.pagoEm<=fim)),
  mes:soma(pagos.filter(x=>x.pagoEm.slice(0,7)===mes)),ini,fim,mesNome:MESES[+mes.slice(5)-1]};
}
const pl=n=>n+(n===1?' encomenda':' encomendas');
const card=(c,l,v,s)=>`<div class="c ${c}"><div class="l">${l}</div><div class="num">${v}</div><div class="s">${esc(s)}</div></div>`;

/* ---------- tela ---------- */
function render(){
 aplicarPresets();
 const n=numeros(itens);
 $('cards').innerHTML=card('k','A entregar',n.aEnt,'encomendas aguardando')+card('','Entregues',n.ent,n.entHoje+' hoje')+card('','Pagas',n.pg,'encomendas')+card('a','Não pagas',n.naoPg,brl(n.aberto)+' a receber');
 $('money').innerHTML=card('k','Recebido hoje',brl(n.dia),br(hoje()))+card('','Recebido na semana',brl(n.sem),br(n.ini).slice(0,5)+' a '+br(n.fim).slice(0,5))+card('','Recebido no mês',brl(n.mes),n.mesNome)+card('a','A receber',brl(n.aberto),pl(n.naoPg)+(n.naoPg===1?' não paga':' não pagas'));
 {const M={};for(const x of itens)if(x.pago&&x.pagoEm){const k=x.pagoEm.slice(0,7);(M[k]=M[k]||{q:0,v:0}).q++;M[k].v+=+x.valor||0}
  const K=Object.keys(M).sort().reverse().slice(0,12);
  $('meses').innerHTML=K.length?K.map(k=>card('',MESES[+k.slice(5)-1]+' de '+k.slice(0,4),brl(M[k].v),M[k].q+' encomenda'+(M[k].q>1?'s':'')+' paga'+(M[k].q>1?'s':''))).join(''):'<div class="empty" style="grid-column:1/-1">Nenhum pagamento registrado ainda.</div>'}
 $('mReg').setAttribute('aria-pressed',tela==='reg');$('mCon').setAttribute('aria-pressed',tela==='con');$('hdCon').hidden=tela!=='con';$('hdPad').hidden=tela==='con';$('vReg').hidden=tela!=='reg';$('vCon').hidden=tela!=='con';renderReg();
 document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected',t.dataset.aba===aba));for(const[k,id]of[['bus','vBus'],['fil','vFil'],['pai','vPai'],['fin','vFin'],['cli','vCli']])$(id).hidden=aba!==k;
 for(const k of['ch','en']){$(k+'Pre').value=F[k+'Pre'];$(k+'De').value=F[k+'De'];$(k+'Ate').value=F[k+'Ate']}
 const BA=bairros();$('bairroF').innerHTML='<option value="">Todos os bairros</option>'+BA.map(b=>`<option value="${esc(b.k)}">${esc(b.nome)} (${b.n})</option>`).join('')+(itens.some(x=>!String(x.bairro||'').trim())?'<option value="__sem">Sem bairro informado</option>':'');$('bairroF').value=F.bairro;
 const bc=$('bairroC').value;$('bairroC').innerHTML='<option value="">Todos os bairros</option>'+BA.map(b=>`<option value="${esc(b.k)}">${esc(b.nome)}</option>`).join('');$('bairroC').value=bc;
 $('bairros').innerHTML=BA.map(b=>`<option value="${esc(b.nome)}">`).join('');

 const FL=[['todas','Todas',itens.length],['aentregar','A entregar',n.aEnt],['naopagas','Não pagas',n.naoPg],['entregues','Entregues',n.ent],['pagas','Pagas',n.pg]];
 $('chips').innerHTML=FL.map(([k,l,c])=>`<button class="chip" data-f="${k}" aria-pressed="${filtro===k}">${l}<b>${c}</b></button>`).join('');
 const ordem=L=>L.sort((a,b)=>(a.entregue-b.entregue)||(b.chegada||'').localeCompare(a.chegada||'')||(b.criadoEm||0)-(a.criadoEm||0));
 $('list').innerHTML=listaHTML(ordem(filtrar('pai')),'Nenhuma encomenda nessa situação.');
 const q=$('q').value.trim();
 if(q){const L=ordem(filtrar('bus'));$('busInfo').textContent=L.length?(L.length===1?'1 encomenda encontrada.':L.length+' encomendas encontradas.'):'';$('listBus').innerHTML=listaHTML(L,'Nenhuma encomenda com esse código ou nome.')}
 else{$('busInfo').textContent='Digite o código de rastreio, ou parte dele, ou o nome do cliente.';$('listBus').innerHTML=''}
 const fa=filtroDatas();$('bLimparF').hidden=!fa;
 if(fa){const L=ordem(filtrar('fil')),m=numeros(L);$('fres').innerHTML=`<div class="t">Resultado: ${esc(descFiltro())}</div>`+card('','Encomendas',m.total,'no filtro')+card('','A entregar',m.aEnt,'')+card('','Entregues',m.ent,'')+card('','Já pagas',brl(m.recebido),pl(m.pg))+card('','A receber',brl(m.aberto),pl(m.naoPg));$('listFil').innerHTML=listaHTML(L,'Nenhuma encomenda nesse período ou bairro.')}
 else{$('fres').innerHTML='<div class="t">Escolha um período de chegada, de entrega ou um bairro para ver as encomendas.</div>';$('listFil').innerHTML=''}

 renderClientes();
 const temEx=itens.some(x=>x.exemplo)||clientes.some(x=>x.exemplo);$('bEx').hidden=!temEx;$('exNote').hidden=!temEx;
 $('status').innerHTML='<span class="e">'+esc(auth.currentUser?auth.currentUser.email:'')+'</span><span class="r"> · '+itens.length+' encomendas · '+clientes.length+' clientes · '+brl(valorPadrao)+' por encomenda</span>';
 const nomes=[...new Set([...clientes.map(c=>c.nome),...itens.map(x=>x.destinatario)])].sort((a,b)=>a.localeCompare(b,'pt-BR'));
 $('nomes').innerHTML=nomes.map(v=>`<option value="${esc(v)}">`).join('');
}
const itemHTML=x=>`<article class="it ${x.entregue?(x.pago?'done':'owe'):''}">
  <div><div class="who">${esc(x.destinatario)}</div>
   <div class="addr">${esc(x.endereco)}${x.bairro?`<span class="bt">${esc(x.bairro)}</span>`:''}${x.telefone?' · '+esc(x.telefone):''}</div>
   <div class="meta"><span class="tag">${esc(x.transportadora)}</span>${x.rastreio?`<span class="trk">${esc(x.rastreio)}</span>`:''}<span>chegou em ${br(x.chegada)}</span>${x.entregue&&x.entregueEm?`<span>entregue em ${br(x.entregueEm)}</span>`:''}${x.pago&&x.pagoEm?`<span>pago em ${br(x.pagoEm)}${x.forma?' ('+esc(x.forma)+')':''}</span>`:''}</div>
   ${x.obs?`<div class="meta">${esc(x.obs)}</div>`:''}</div>
  <div class="side"><div class="val">${brl(x.valor)}</div>
   <div class="tgs"><button class="tg ${x.entregue?'on':'pend'}" data-t="ent" data-id="${x.id}">${x.entregue?'Entregue':'Marcar entregue'}</button><button class="tg ${x.pago?'on':'owe'}" data-t="pg" data-id="${x.id}">${x.pago?'Pago':'Marcar pago'}</button></div>
   <div class="mini"><button data-t="ed" data-id="${x.id}">editar</button><button data-t="del" data-id="${x.id}">excluir</button></div></div>
 </article>`;
function listaHTML(L,vazio){const MAX=300;
 if(!L.length)return`<div class="empty">${!carregado?'Carregando as encomendas.':itens.length?vazio:'Nenhuma encomenda cadastrada ainda. Use o Registro ou o botão Importar planilha, no fim desta página.'}</div>`;
 return L.slice(0,MAX).map(itemHTML).join('')+(L.length>MAX?`<p class="note">Mostrando as ${MAX} primeiras de ${L.length} encomendas. Use a busca ou os filtros para encontrar as outras.</p>`:'')}
function renderClientes(){
 const q=norm($('qc').value),st={};
 for(const x of itens){const k=norm(x.destinatario);const s=st[k]||(st[k]={n:0,a:0,ab:0});s.n++;if(!x.entregue)s.a++;if(!x.pago)s.ab+=+x.valor||0}
 $('kTit').textContent='Clientes cadastrados: '+clientes.length;
 const bc=$('bairroC').value;let C=clientes.filter(c=>(!bc||norm(c.bairro)===bc)&&(!q||norm([c.nome,c.endereco,c.bairro,c.telefone,c.obs].join(' ')).includes(q))).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
 $('listCli').innerHTML=C.length?C.map(c=>{const s=st[norm(c.nome)]||{n:0,a:0,ab:0};return`<article class="it cli">
  <div><div class="who">${esc(c.nome)}${c.exemplo?' <span class="tag">exemplo</span>':''}</div><div class="addr">${esc(c.endereco)}${c.bairro?`<span class="bt">${esc(c.bairro)}</span>`:''}${c.telefone?' · '+esc(c.telefone):''}</div>
  <div class="meta"><span>${s.n} encomendas</span><span>${s.a} a entregar</span>${s.ab?`<span style="color:var(--alert)">${brl(s.ab)} em aberto</span>`:''}</div>${c.obs?`<div class="meta">${esc(c.obs)}</div>`:''}</div>
  <div class="side"><div class="mini"><button data-c="ver" data-id="${c.id}">ver encomendas</button><button data-c="ed" data-id="${c.id}">editar</button><button data-c="del" data-id="${c.id}">excluir</button></div></div></article>`}).join('')
 :`<div class="empty">${clientes.length?'Nenhum cliente encontrado.':'Nenhum cliente cadastrado. Os destinatários entram aqui quando você cadastra uma encomenda ou importa a planilha de clientes.'}</div>`;
}

/* ---------- formulário de encomenda ---------- */
$('iTr').innerHTML=TRANSP.map(t=>`<option>${t}</option>`).join('');
for(const k of['ch','en'])$(k+'Pre').innerHTML=PERIODOS.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
function syncForm(){$('lOutra').hidden=$('iTr').value!=='Outra';$('lEntD').hidden=!$('iEnt').checked;$('lPg').hidden=!$('iPg').checked;
 if($('iEnt').checked&&!$('iEntD').value)$('iEntD').value=hoje();if($('iPg').checked&&!$('iPgD').value)$('iPgD').value=hoje()}
function abrirForm(x){
 editId=x?x.id:null;$('fTit').textContent=x?'Editar encomenda':'Nova encomenda';$('wTrk').textContent='';
 const t=x?.transportadora||'Mercado Livre',conhecida=TRANSP.includes(t);
 $('iTrk').value=x?.rastreio||'';$('iTr').value=conhecida?t:'Outra';$('iOutra').value=conhecida?'':t;
 $('iCh').value=x?.chegada||hoje();$('iNome').value=x?.destinatario||'';$('iEnd').value=x?.endereco||'';$('iBai').value=x?.bairro||'';$('iTel').value=x?.telefone||'';
 $('iVal').value=x?x.valor:valorPadrao;$('iEnt').checked=!!x?.entregue;$('iEntD').value=x?.entregueEm||'';
 $('iPg').checked=!!x?.pago;$('iPgD').value=x?.pagoEm||'';$('iForma').value=x?.forma||'Pix';$('iObs').value=x?.obs||'';
 syncForm();$('ovForm').classList.add('show');setTimeout(()=>$('iTrk').focus(),30);
}
const fechar=id=>$(id).classList.remove('show');
['iTr','iEnt','iPg'].forEach(i=>$(i).addEventListener('change',syncForm));
$('iTrk').addEventListener('input',()=>{const v=norm($('iTrk').value);const d=v&&itens.find(x=>x.id!==editId&&norm(x.rastreio)===v);
 $('wTrk').textContent=d?'Esse código já está cadastrado para '+d.destinatario+' (chegou em '+br(d.chegada)+').':''});
$('iNome').addEventListener('change',()=>{const c=acharCliente($('iNome').value);const p=c?{endereco:c.endereco,telefone:c.telefone,bairro:c.bairro}:[...itens].sort((a,b)=>(b.criadoEm||0)-(a.criadoEm||0)).find(x=>norm(x.destinatario)===norm($('iNome').value));
 if(p){if(!$('iEnd').value)$('iEnd').value=p.endereco||'';if(!$('iBai').value)$('iBai').value=p.bairro||'';if(!$('iTel').value)$('iTel').value=p.telefone||''}});
$('form').addEventListener('submit',async e=>{
 e.preventDefault();
 const old=itens.find(x=>x.id===editId)||{};
 const tr=$('iTr').value==='Outra'?($('iOutra').value.trim()||'Outra'):$('iTr').value;
 const it={...old,id:editId||novoId(),rastreio:$('iTrk').value.trim(),transportadora:tr,chegada:$('iCh').value,destinatario:$('iNome').value.trim(),
  endereco:$('iEnd').value.trim(),bairro:$('iBai').value.trim(),telefone:$('iTel').value.trim(),valor:Math.round((parseFloat($('iVal').value)||0)*100)/100,
  entregue:$('iEnt').checked,entregueEm:$('iEnt').checked?($('iEntD').value||hoje()):'',pago:$('iPg').checked,pagoEm:$('iPg').checked?($('iPgD').value||hoje()):'',
  forma:$('iPg').checked?$('iForma').value:'',obs:$('iObs').value.trim(),criadoEm:old.criadoEm||Date.now()};
 delete it.exemplo;
 fechar('ovForm');const ok=await gravar('encomendas',it);if(ok){await garantirCliente(it.destinatario,it.endereco,it.telefone,it.bairro);toast(editId?'Encomenda atualizada.':'Encomenda cadastrada.')}
});
$('bCanc').addEventListener('click',()=>fechar('ovForm'));

/* ---------- caixa de mensagem ---------- */
function caixa(tit,html,botoes){$('mTit').textContent=tit;$('mBody').innerHTML=html;
 $('mBtns').innerHTML=botoes.map((b,i)=>`<button class="btn ${b.cls||''}" data-i="${i}">${b.t}</button>`).join('');
 $('mBtns').onclick=e=>{const b=botoes[e.target.dataset.i];if(!b)return;if(b.f&&b.f()===false)return;fechar('ovMsg')};$('ovMsg').classList.add('show')}

/* ---------- clientes ---------- */
function abrirCliente(c){
 caixa(c?'Editar cliente':'Novo cliente',`<label>Nome<input id="cNome" value="${esc(c?.nome)}"></label><label>Endereço de entrega (rua, número e complemento)<input id="cEnd" value="${esc(c?.endereco)}"></label><label>Bairro<input id="cBai" list="bairros" value="${esc(c?.bairro)}"></label><label>Telefone<input id="cTel" type="tel" value="${esc(c?.telefone)}"></label><label>Observação<textarea id="cObs">${esc(c?.obs)}</textarea></label><div class="warn" id="cErr"></div>`,
 [{t:'Cancelar'},{t:'Salvar',cls:'main',f:()=>{const nome=$('cNome').value.trim();if(!nome){$('cErr').textContent='Preencha o nome.';return false}
  const dup=acharCliente(nome);if(dup&&dup.id!==c?.id){$('cErr').textContent='Já existe um cliente com esse nome.';return false}
  const o={...(c||{}),id:c?.id||novoId(),nome,endereco:$('cEnd').value.trim(),bairro:$('cBai').value.trim(),telefone:$('cTel').value.trim(),obs:$('cObs').value.trim(),criadoEm:c?.criadoEm||Date.now()};delete o.exemplo;
  gravar('clientes',o).then(ok=>ok&&toast('Cliente salvo.'))}}]);
 setTimeout(()=>$('cNome').focus(),30);
}
$('kForm').addEventListener('submit',async e=>{
 e.preventDefault();const nome=$('kNome').value.trim();$('kErr').textContent='';if(!nome)return;
 const d=acharCliente(nome);if(d){$('kErr').textContent='Já existe um cliente com esse nome. Para mudar os dados, toque em editar na lista abaixo.';return}
 const o={id:novoId(),nome,endereco:$('kEnd').value.trim(),bairro:$('kBai').value.trim(),telefone:$('kTel').value.trim(),obs:$('kObs').value.trim(),criadoEm:Date.now()};
 if(await gravar('clientes',o)){toast(nome+' cadastrado.');for(const i of['kNome','kEnd','kBai','kTel','kObs'])$(i).value='';$('kNome').focus()}
});
$('qc').addEventListener('input',renderClientes);$('bairroC').addEventListener('change',renderClientes);
$('bairroF').addEventListener('change',()=>{F.bairro=$('bairroF').value;gravarFiltros();render()});
$('listCli').addEventListener('click',e=>{const b=e.target.closest('[data-c]');if(!b)return;const c=clientes.find(x=>x.id===b.dataset.id);if(!c)return;
 if(b.dataset.c==='ver'){aba='bus';$('q').value=c.nome;render();window.scrollTo(0,0)}
 if(b.dataset.c==='ed')abrirCliente(c);
 if(b.dataset.c==='del')caixa('Excluir cliente?',`<p style="margin:0">${esc(c.nome)}. As encomendas dela continuam cadastradas.</p>`,[{t:'Cancelar'},{t:'Excluir',cls:'del',f:()=>{remover('clientes',c.id)}}]);
});

/* ---------- lista e filtros: ações ---------- */
document.querySelector('.tabs').addEventListener('click',e=>{const b=e.target.closest('.tab');if(!b)return;aba=b.dataset.aba;render();window.scrollTo(0,0);if(aba==='bus')setTimeout(()=>$('q').focus(),30)});
$('bLimparF').addEventListener('click',()=>{F={chPre:'tudo',chDe:'',chAte:'',enPre:'tudo',enDe:'',enAte:'',bairro:''};gravarFiltros();render()});
$('chips').addEventListener('click',e=>{
 const b=e.target.closest('.chip');if(b){filtro=b.dataset.f;render()}});
$('q').addEventListener('input',render);
for(const k of['ch','en']){
 $(k+'Pre').addEventListener('change',()=>{F[k+'Pre']=$(k+'Pre').value;if(F[k+'Pre']==='pers'&&!F[k+'De']&&!F[k+'Ate']){F[k+'De']=hoje();F[k+'Ate']=hoje()}gravarFiltros();render()});
 for(const s of['De','Ate'])$(k+s).addEventListener('change',()=>{F[k+'Pre']='pers';F[k+s]=$(k+s).value;gravarFiltros();render()});
}
$('vCon').addEventListener('click',e=>{
 const b=e.target.closest('[data-t]');if(!b)return;const x=itens.find(i=>i.id===b.dataset.id);if(!x)return;const t=b.dataset.t;
 if(t==='ed')return abrirForm(x);
 if(t==='del')return caixa('Excluir encomenda?',`<p style="margin:0">${esc(x.destinatario)}${x.rastreio?', rastreio '+esc(x.rastreio):''}. Essa ação não pode ser desfeita.</p>`,[{t:'Cancelar'},{t:'Excluir',cls:'del',f:()=>{remover('encomendas',x.id)}}]);
 const y={...x};
 if(t==='ent'){y.entregue=!x.entregue;y.entregueEm=y.entregue?hoje():''}
 if(t==='pg'){y.pago=!x.pago;y.pagoEm=y.pago?hoje():'';y.forma=y.pago?(x.forma||'Pix'):''}
 gravar('encomendas',y);
});
['ovForm','ovMsg'].forEach(id=>$(id).addEventListener('click',e=>{if(e.target.id===id)fechar(id)}));
document.addEventListener('keydown',e=>{if(e.key==='Escape'){fechar('ovForm');fechar('ovMsg')}});

$('bCfg').addEventListener('click',()=>caixa('Valor por encomenda',`<label>Valor cobrado em cada nova encomenda (R$)<input id="iCfg" type="number" min="0" step="0.01" value="${valorPadrao}"></label><p class="note" style="margin:0">As encomendas já cadastradas mantêm o valor que tinham.</p>`,
 [{t:'Cancelar'},{t:'Salvar',cls:'main',f:()=>{const v=parseFloat($('iCfg').value);if(v>=0){salvarValor(Math.round(v*100)/100);toast('Valor atualizado.')}}}]));
$('bEx').addEventListener('click',()=>caixa('Apagar exemplos?','<p style="margin:0">As encomendas e os clientes fictícios de exemplo serão apagados. O que você cadastrou ou importou continua.</p>',[{t:'Cancelar'},{t:'Apagar',cls:'del',f:()=>{(async()=>{
 for(const x of itens.filter(i=>i.exemplo))await remover('encomendas',x.id);for(const c of clientes.filter(i=>i.exemplo))await remover('clientes',c.id);toast('Exemplos apagados.')})()}}]));

/* ---------- arquivos ---------- */
async function baixar(nome,blob){
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=nome;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500);
}
$('bBk').addEventListener('click',()=>caixa('Baixar cópia de segurança','<p class="note" style="margin:0">A cópia tem todos os dados dos clientes. Guarde o arquivo num lugar com senha.</p>',[{t:'Cancelar'},{t:'Baixar cópia',cls:'main',f:()=>{baixar('Encomendas cópia de segurança '+hoje()+'.json',new Blob([JSON.stringify({itens,clientes,valorPadrao},null,1)],{type:'application/json'}))}}]));
$('fBk').addEventListener('change',async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;
 try{const d=JSON.parse(await f.text());const L=Array.isArray(d)?d:d.itens,C=Array.isArray(d.clientes)?d.clientes:[];if(!Array.isArray(L))throw 0;
  toast('Restaurando a cópia.');
  const n=await gravarVarios('encomendas',L.filter(x=>x&&x.destinatario).map(x=>({...x,id:String(x.id||novoId())})));
  const m=await gravarVarios('clientes',C.filter(c=>c&&c.nome).map(c=>({...c,id:String(c.id||novoId())})));
  toast(n+' encomendas e '+m+' clientes restaurados.')}
 catch(err){toast('Esse arquivo não é uma cópia de segurança válida.')}});

/* ---------- gerar .xlsx ---------- */
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
const crc=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=CRC[(c^b[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0};
function zip(files){
 const enc=new TextEncoder(),parts=[],cd=[];let off=0;
 for(const[name,str]of files){
  const n=enc.encode(name),d=enc.encode(str),c=crc(d),h=new DataView(new ArrayBuffer(30)),e=new DataView(new ArrayBuffer(46));
  h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(12,0x21,true);h.setUint32(14,c,true);h.setUint32(18,d.length,true);h.setUint32(22,d.length,true);h.setUint16(26,n.length,true);
  e.setUint32(0,0x02014b50,true);e.setUint16(4,20,true);e.setUint16(6,20,true);e.setUint16(14,0x21,true);e.setUint32(16,c,true);e.setUint32(20,d.length,true);e.setUint32(24,d.length,true);e.setUint16(28,n.length,true);e.setUint32(42,off,true);
  parts.push(new Uint8Array(h.buffer),n,d);cd.push(new Uint8Array(e.buffer),n);off+=30+n.length+d.length;
 }
 const sz=cd.reduce((s,a)=>s+a.length,0),z=new DataView(new ArrayBuffer(22));
 z.setUint32(0,0x06054b50,true);z.setUint16(8,files.length,true);z.setUint16(10,files.length,true);z.setUint32(12,sz,true);z.setUint32(16,off,true);
 return new Blob([...parts,...cd,new Uint8Array(z.buffer)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
const xe=s=>String(s??'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const colL=i=>{let s='';i++;while(i){const m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26)}return s};
const serial=s=>{const[y,m,d]=s.split('-').map(Number);return(Date.UTC(y,m-1,d)-Date.UTC(1899,11,30))/864e5};
function sheetXml(rows,widths){
 const cell=(v,r,c)=>{const ref=colL(c)+r;if(v==null||v==='')return'';
  if(typeof v==='object'){if(v.d)return`<c r="${ref}" s="3"><v>${serial(v.d)}</v></c>`;if(v.m!=null)return`<c r="${ref}" s="2"><v>${v.m}</v></c>`;if(v.b!=null)return`<c r="${ref}" s="1" t="inlineStr"><is><t xml:space="preserve">${xe(v.b)}</t></is></c>`}
  if(typeof v==='number')return`<c r="${ref}"><v>${v}</v></c>`;
  return`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xe(v)}</t></is></c>`};
 return`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((row,ri)=>`<row r="${ri+1}">${row.map((v,ci)=>cell(v,ri+1,ci)).join('')}</row>`).join('')}</sheetData></worksheet>`;
}
function xlsx(sheets){
 const ns='http://schemas.openxmlformats.org/',ws=sheets.map((s,i)=>i+1);
 return zip([
  ['[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${ws.map(i=>`<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
  ['_rels/.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="rId1" Type="${ns}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
  ['xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}spreadsheetml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xe(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}package/2006/relationships">${ws.map(i=>`<Relationship Id="rId${i}" Type="${ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="${ns}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
  ['xl/styles.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
  ...sheets.map((s,i)=>[`xl/worksheets/sheet${i+1}.xml`,sheetXml(s.rows,s.widths)])
 ]);
}
const HE=['Chegada','Rastreio','Transportadora','Destinatário','Endereço','Bairro','Telefone','Valor','Entregue','Data da entrega','Pago','Data do pagamento','Forma de pagamento','Observação'];
const WE=[12,20,16,24,36,20,16,11,10,15,8,17,18,30];
const HC=['Nome','Endereço','Bairro','Telefone','Observação'];
const linhaEnc=x=>[x.chegada?{d:x.chegada}:'',x.rastreio||'',x.transportadora||'',x.destinatario,x.endereco||'',x.bairro||'',x.telefone||'',{m:+x.valor||0},x.entregue?'Sim':'Não',x.entregueEm?{d:x.entregueEm}:'',x.pago?'Sim':'Não',x.pagoEm?{d:x.pagoEm}:'',x.forma||'',x.obs||''];
function porBairro(L){const m=new Map();for(const x of L){const b=String(x.bairro||'').trim(),k=norm(b)||'~';const o=m.get(k)||{nome:b||'Sem bairro informado',t:0,a:0,np:0,v:0};o.t++;if(!x.entregue)o.a++;if(!x.pago){o.np++;o.v+=+x.valor||0}m.set(k,o)}
 return[...m.entries()].sort((a,b)=>a[0].localeCompare(b[0],'pt-BR')).map(([,o])=>[o.nome,o.t,o.a,o.np,{m:o.v}])}
function planilha(L,titulo){
 const n=numeros(L),meses={};
 L.filter(x=>x.pago&&x.pagoEm).forEach(x=>{const k=x.pagoEm.slice(0,7);meses[k]=meses[k]||{q:0,v:0};meses[k].q++;meses[k].v+=+x.valor||0});
 const res=[[{b:'Indicador'},{b:'Valor'}],['Conteúdo da planilha',titulo],['Encomendas',n.total],['A entregar',n.aEnt],['Entregues',n.ent],['Pagas',n.pg],['Não pagas',n.naoPg],['Valor já pago',{m:n.recebido}],['Valor a receber',{m:n.aberto}],
  ['Recebido hoje ('+br(hoje())+')',{m:n.dia}],['Recebido na semana ('+br(n.ini)+' a '+br(n.fim)+')',{m:n.sem}],['Recebido no mês ('+n.mesNome+')',{m:n.mes}],[],
  [{b:'Mês do pagamento'},{b:'Encomendas pagas'},{b:'Total recebido'}],...Object.keys(meses).sort().map(k=>[MESES[+k.slice(5)-1]+' de '+k.slice(0,4),meses[k].q,{m:meses[k].v}]),[],
  [{b:'Bairro'},{b:'Encomendas'},{b:'A entregar'},{b:'Não pagas'},{b:'Valor a receber'}],...porBairro(L)];
 const L2=[...L].sort((a,b)=>(a.chegada||'').localeCompare(b.chegada||''));
 const C=[...clientes].sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
 return xlsx([{name:'Encomendas',rows:[HE.map(h=>({b:h})),...L2.map(linhaEnc)],widths:WE},{name:'Resumo',rows:res,widths:[44,22,16,14,18]},
  {name:'Clientes',rows:[HC.map(h=>({b:h})),...C.map(c=>[c.nome,c.endereco||'',c.bairro||'',c.telefone||'',c.obs||''])],widths:[28,40,20,18,30]}]);
}
$('bExp').addEventListener('click',()=>{
 if(!itens.length)return toast('Ainda não há encomendas para exportar.');
 const tudo=()=>baixar('Encomendas '+hoje()+'.xlsx',planilha(itens,'Todas as encomendas'));
 const aviso='<p class="note" style="margin:0">A planilha tem nomes, endereços e telefones dos clientes. Guarde o arquivo num lugar com senha e evite mandar por grupos.</p>';
 const ST={aentregar:'a entregar',naopagas:'não pagas',entregues:'entregues',pagas:'pagas'};
 const at=aba==='bus'&&$('q').value.trim()?{L:filtrar('bus'),d:'busca "'+$('q').value.trim()+'"'}:aba==='fil'&&filtroDatas()?{L:filtrar('fil'),d:descFiltro()}:aba==='pai'&&filtro!=='todas'?{L:filtrar('pai'),d:ST[filtro]}:null;
 if(!at)return caixa('Exportar planilha',aviso,[{t:'Cancelar'},{t:'Baixar planilha',cls:'main',f:()=>{tudo()}}]);
 caixa('Exportar planilha',`<p style="margin:0">Esta aba está mostrando: ${esc(at.d)}.</p>`+aviso,[{t:'Cancelar'},{t:'Tudo ('+itens.length+')',f:()=>{tudo()}},{t:'Só esta lista ('+at.L.length+')',cls:'main',f:()=>{baixar('Encomendas filtradas '+hoje()+'.xlsx',planilha(at.L,'Filtro: '+at.d))}}]);
});

/* ---------- importar planilha ---------- */
const CAMPOS={
 encomendas:[['destinatario','Destinatário',['destinatario','nome','cliente','morador']],['bairro','Bairro',['bairro','localidade','comunidade']],['endereco','Endereço',['endereco','logradouro','rua']],['telefone','Telefone',['telefone','celular','whatsapp','fone','tel','contato']],
  ['rastreio','Código de rastreio',['rastreio','rastreamento','codigo','tracking','objeto']],['transportadora','Transportadora ou plataforma',['transportadora','plataforma','empresa','loja','marketplace','origem']],
  ['entregueEm','Data da entrega',['data da entrega','data de entrega','data entrega','entregue em','dt entrega']],['pagoEm','Data do pagamento',['data do pagamento','data de pagamento','data pagamento','pago em','dt pagamento']],
  ['forma','Forma de pagamento',['forma','meio de pagamento','meio']],['chegada','Data de chegada',['chegada','chegou','recebid','entrada','data']],
  ['entregue','Entregue (sim ou não)',['entregue','entrega','status']],['pago','Pago (sim ou não)',['pago','pagamento','pagou','paga']],
  ['valor','Valor cobrado',['valor','preco','taxa','cobrado','r$']],['obs','Observação',['observ','obs','nota','coment']]],
 clientes:[['nome','Nome',['nome','cliente','destinatario','morador']],['bairro','Bairro',['bairro','localidade','comunidade']],['endereco','Endereço',['endereco','logradouro','rua']],['telefone','Telefone',['telefone','celular','whatsapp','fone','tel','contato']],['obs','Observação',['observ','obs','nota','coment']]]
};
const ORDEM={encomendas:['destinatario','bairro','endereco','telefone','rastreio','transportadora','entregueEm','pagoEm','forma','chegada','entregue','pago','valor','obs'],clientes:['nome','bairro','endereco','telefone','obs']};
let IMP=null;
function carregarXLSX(){if(window.XLSX)return Promise.resolve(window.XLSX);return new Promise((ok,no)=>{const s=document.createElement('script');s.src='vendor/xlsx.full.min.js';s.onload=()=>window.XLSX?ok(window.XLSX):no();s.onerror=no;document.head.appendChild(s)})}
const pDate=v=>{
 if(v instanceof Date&&!isNaN(v)){const d=new Date(v.getTime()+12*36e5);return iso(new Date(d.getFullYear(),d.getMonth(),d.getDate()))}
 if(typeof v==='number'&&v>20000&&v<80000){const d=new Date(Date.UTC(1899,11,30)+Math.round(v)*864e5);return d.toISOString().slice(0,10)}
 const s=String(v??'').trim();let m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
 if(m){let[,d,mo,y]=m.map(Number);if(y<100)y+=2000;if(mo>=1&&mo<=12&&d>=1&&d<=31)return`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`}
 m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;return'';
};
const pBool=v=>{if(typeof v==='boolean')return v;if(typeof v==='number')return v>0;const s=norm(v);if(!s)return null;
 if(/^(nao|n|no|false|0|-|pendente|aguardando|em aberto|aberto|falta|a entregar|a pagar)$/.test(s)||s.startsWith('nao '))return false;
 if(/^(sim|s|x|ok|yes|y|true|v|feito|feita|entregue|pago|paga|recebido|quitado|✓|✔)$/.test(s)||s.startsWith('sim'))return true;
 return pDate(v)?true:null};
const pVal=v=>{if(typeof v==='number')return Math.round(v*100)/100;let s=String(v??'').replace(/r\$|\s/gi,'');if(!s)return null;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');const n=parseFloat(s);return isNaN(n)?null:Math.round(n*100)/100};
const ALIAS=[['Mercado Livre',/^(ml|meli)$|mercado ?livre|mercadolivre/],['TikTok Shop',/tik ?tok/],['Shopee',/shopee/],['Amazon',/amazon/],['Shein',/shein/],['Magalu',/magalu|magazine/],['Correios',/correio|sedex|^pac$/],['Jadlog',/jadlog/],['Loggi',/loggi/],['Total Express',/total ?express/]];
const pTr=v=>{const s=norm(v);if(!s)return'';const a=ALIAS.find(([,r])=>r.test(s));return a?a[0]:String(v).trim()};
const txt=v=>v instanceof Date?br(pDate(v)):String(v??'').trim();
function lerAba(nome){
 const ws=IMP.wb.Sheets[nome];const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''});
 let hi=rows.findIndex(r=>r.filter(c=>String(c).trim()!=='').length>=2);if(hi<0)hi=0;
 const head=(rows[hi]||[]).map((h,i)=>String(h).trim()||'Coluna '+colL(i));
 const dados=rows.slice(hi+1).filter(r=>r.some(c=>String(c).trim()!==''));
 return{head,dados};
}
function adivinhar(tipo,head){
 const H=head.map(norm),usado=new Set(),map={};
 for(const k of ORDEM[tipo]){const kw=CAMPOS[tipo].find(c=>c[0]===k)[2];let idx=-1;
  for(const w of kw){idx=H.findIndex((h,i)=>!usado.has(i)&&h.includes(w));if(idx>=0)break}
  if(idx>=0){usado.add(idx);map[k]=idx}else map[k]=-1}
 return map;
}
function tipoProvavel(nomeAba,head){const t=norm(nomeAba+' '+head.join(' '));return /rastre|transportad|entreg|chegad|plataforma/.test(t)?'encomendas':'clientes'}
function prepararAba(){
 const nome=$('impAba').value;const{head,dados}=lerAba(nome);IMP.head=head;IMP.dados=dados;
 IMP.tipo=tipoProvavel(nome,head);$('impTipo').value=IMP.tipo;IMP.map=adivinhar(IMP.tipo,head);desenharMapa();
}
function desenharMapa(){
 const t=IMP.tipo,ex=IMP.dados[0]||[];
 $('impMap').innerHTML=CAMPOS[t].map(([k,l])=>`<tr><td>${l}${(t==='encomendas'&&k==='destinatario')||(t==='clientes'&&k==='nome')?' *':''}</td><td><select data-k="${k}"><option value="-1">Não tem na planilha</option>${IMP.head.map((h,i)=>`<option value="${i}" ${IMP.map[k]===i?'selected':''}>${esc(h)}</option>`).join('')}</select></td><td class="ex">${IMP.map[k]>=0?esc(txt(ex[IMP.map[k]])):''}</td></tr>`).join('');
 $('lImpCli').hidden=t!=='encomendas';previa();
}
function converter(){
 const t=IMP.tipo,m=IMP.map,g=(r,k)=>m[k]>=0?r[m[k]]:'',out=[],ign=[];let rep=0;
 if(t==='clientes'){const vistos=new Set(clientes.map(c=>norm(c.nome)));
  IMP.dados.forEach((r,i)=>{const nome=txt(g(r,'nome'));if(!nome){ign.push(i);return}const k=norm(nome);if(vistos.has(k)){rep++;return}vistos.add(k);
   out.push({id:novoId(),nome,endereco:txt(g(r,'endereco')),bairro:txt(g(r,'bairro')),telefone:txt(g(r,'telefone')),obs:txt(g(r,'obs')),criadoEm:Date.now()})});
  return{out,ign,rep}}
 const vistos=new Set(itens.filter(x=>x.rastreio).map(x=>norm(x.rastreio)));
 IMP.dados.forEach((r,i)=>{
  const dest=txt(g(r,'destinatario'));if(!dest){ign.push(i);return}
  const rastreio=txt(g(r,'rastreio'));if(rastreio){const k=norm(rastreio);if(vistos.has(k)){rep++;return}vistos.add(k)}
  let entregueEm=pDate(g(r,'entregueEm')),pagoEm=pDate(g(r,'pagoEm'));
  const chegada=pDate(g(r,'chegada'))||entregueEm||pagoEm||hoje();
  let entregue=pBool(g(r,'entregue'));if(entregue===null)entregue=!!entregueEm;if(entregue&&!entregueEm)entregueEm=pDate(g(r,'entregue'))||chegada;if(!entregue)entregueEm='';
  let pago=pBool(g(r,'pago'));if(pago===null)pago=!!pagoEm;if(pago&&!pagoEm)pagoEm=pDate(g(r,'pago'))||entregueEm||chegada;if(!pago)pagoEm='';
  const val=pVal(g(r,'valor'));const tr=pTr(txt(g(r,'transportadora')));const fm=txt(g(r,'forma'));
  const cli=acharCliente(dest);
  out.push({id:novoId(),rastreio,transportadora:tr||'Não informada',chegada,destinatario:dest,endereco:txt(g(r,'endereco'))||cli?.endereco||'',bairro:txt(g(r,'bairro'))||cli?.bairro||'',telefone:txt(g(r,'telefone'))||cli?.telefone||'',
   valor:val==null?valorPadrao:val,entregue,entregueEm,pago,pagoEm,forma:pago?(fm||''):'',obs:txt(g(r,'obs')),criadoEm:Date.now()-i,importado:true});
 });
 return{out,ign,rep};
}
function previa(){
 const{out,ign,rep}=converter(),t=IMP.tipo,obr=t==='encomendas'?'destinatario':'nome';IMP.res=out;
 if(IMP.map[obr]<0){$('impPrev').innerHTML=`<div class="warn">Escolha a coluna que tem o ${t==='encomendas'?'nome do destinatário':'nome do cliente'}. Sem ela não dá para importar.</div>`;$('bImpOk').hidden=true;return}
 let h=`<div class="ic">${card('','Linhas na aba',IMP.dados.length,'')}${card('','Serão importadas',out.length,t)}${card('','Já cadastradas',rep,t==='encomendas'?'mesmo rastreio':'mesmo nome')}${card('','Sem nome',ign.length,'serão ignoradas')}</div>`;
 if(t==='encomendas'&&out.length){const n=numeros(out);h+=`<div class="ic">${card('','Entregues',n.ent,'')}${card('','A entregar',n.aEnt,'')}${card('','Pagas',brl(n.recebido),n.pg+' encomendas')}${card('','Não pagas',brl(n.aberto),n.naoPg+' encomendas')}</div>`;
  h+=`<p class="note" style="margin:0">Quando a linha diz que foi pago ou entregue mas não traz a data, o sistema usa a data de entrega ou, se não houver, a de chegada. Sem data de chegada, usa a de entrega, a de pagamento ou a de hoje. Sem valor, usa ${brl(valorPadrao)}.</p>`}
 if(out.length){const P=out.slice(0,5);
  h+=t==='encomendas'?`<h3>Como as 5 primeiras vão ficar</h3><div class="scroll"><table><thead><tr><th>Destinatário</th><th>Bairro</th><th>Rastreio</th><th>Transportadora</th><th>Chegada</th><th>Entrega</th><th>Pagamento</th><th>Valor</th></tr></thead><tbody>${P.map(x=>`<tr><td>${esc(x.destinatario)}</td><td>${esc(x.bairro)}</td><td>${esc(x.rastreio)}</td><td>${esc(x.transportadora)}</td><td>${br(x.chegada)}</td><td>${x.entregue?br(x.entregueEm):'não'}</td><td>${x.pago?br(x.pagoEm):'não'}</td><td style="text-align:right;white-space:nowrap">${brl(x.valor)}</td></tr>`).join('')}</tbody></table></div>`
  :`<h3>Como os 5 primeiros vão ficar</h3><div class="scroll"><table><thead><tr><th>Nome</th><th>Endereço</th><th>Bairro</th><th>Telefone</th></tr></thead><tbody>${P.map(c=>`<tr><td>${esc(c.nome)}</td><td>${esc(c.endereco)}</td><td>${esc(c.bairro)}</td><td>${esc(c.telefone)}</td></tr>`).join('')}</tbody></table></div>`}
 $('impPrev').innerHTML=h;$('bImpOk').hidden=!out.length;$('bImpOk').textContent='Importar '+out.length+' '+t;
}
function abrirImp(){IMP=null;$('imp1').hidden=false;$('imp2').hidden=true;$('bImpOk').hidden=true;$('bImpOutro').hidden=true;$('impErr').textContent='';$('ovImp').classList.add('show')}
$('bImp').addEventListener('click',abrirImp);
$('bImpCanc').addEventListener('click',()=>{if(!$('bImpOk').disabled)fechar('ovImp')});
$('bImpOutro').addEventListener('click',abrirImp);
$('fImp').addEventListener('change',async e=>{
 const f=e.target.files[0];e.target.value='';if(!f)return;$('impErr').textContent='Lendo o arquivo.';
 try{await carregarXLSX()}catch(err){$('impErr').textContent='Não foi possível carregar o leitor de planilhas. Recarregue a página e tente de novo.';return}
 try{
  const buf=await f.arrayBuffer();let wb;
  if(/\.csv$/i.test(f.name)||f.type==='text/csv'){
   let t=new TextDecoder('utf-8').decode(buf);if(t.includes('\uFFFD'))t=new TextDecoder('windows-1252').decode(buf);
   const l1=t.split(/\r?\n/)[0]||'';const fs=(l1.split(';').length>l1.split(',').length)?';':(l1.split('\t').length>l1.split(',').length?'\t':',');
   wb=XLSX.read(t.replace(/^﻿/,''),{type:'string',FS:fs,raw:true});
  }else wb=XLSX.read(new Uint8Array(buf),{type:'array',cellDates:true});
  if(!wb.SheetNames.length)throw 0;
  IMP={wb,nome:f.name};$('impErr').textContent='';$('impAba').innerHTML=wb.SheetNames.map(n=>`<option>${esc(n)}</option>`).join('');
  $('impArq').textContent='Arquivo: '+f.name+(wb.SheetNames.length>1?' · '+wb.SheetNames.length+' abas. Importe uma aba de cada vez.':'');
  $('imp1').hidden=true;$('imp2').hidden=false;$('bImpOutro').hidden=false;prepararAba();
 }catch(err){$('impErr').textContent='Não consegui ler esse arquivo. Confira se é uma planilha .xlsx, .xls ou .csv.'}
});
$('impAba').addEventListener('change',prepararAba);
$('impTipo').addEventListener('change',()=>{IMP.tipo=$('impTipo').value;IMP.map=adivinhar(IMP.tipo,IMP.head);desenharMapa()});
$('impMap').addEventListener('change',e=>{const s=e.target.closest('select');if(!s)return;IMP.map[s.dataset.k]=+s.value;desenharMapa()});
$('impCli').addEventListener('change',previa);
$('bImpOk').addEventListener('click',async()=>{
 const L=IMP.res||[],t=IMP.tipo,b=$('bImpOk');if(!L.length)return;b.disabled=true;$('bImpCanc').disabled=true;let ok=0,falha=0,novosCli=0;
 const col=t==='encomendas'?'encomendas':'clientes';
 ok=await gravarVarios(col,L,n=>{b.textContent='Importando '+n+' de '+L.length});falha=L.length-ok;
 if(t==='encomendas'&&$('impCli').checked){const vistos=new Set(clientes.map(c=>norm(c.nome)));
  const N=[];for(const x of L){const k=norm(x.destinatario);if(vistos.has(k))continue;vistos.add(k);N.push({id:novoId(),nome:x.destinatario,endereco:x.endereco,bairro:x.bairro,telefone:x.telefone,obs:'',criadoEm:Date.now()})}
  b.textContent='Cadastrando clientes';novosCli=await gravarVarios('clientes',N)}
 gravarLocal();render();b.disabled=false;$('bImpCanc').disabled=false;fechar('ovImp');
 caixa('Importação concluída',`<div class="ic">${card('','Importadas',ok,t)}${t==='encomendas'?card('','Clientes novos',novosCli,'cadastrados'):''}${falha?card('a','Não gravadas',falha,'tente de novo'):''}</div>`,[{t:'Fechar',cls:'main'}]);
});
$('bModelo').addEventListener('click',()=>{const h=hoje();
 baixar('Modelo de importação.xlsx',xlsx([{name:'Encomendas',rows:[HE.map(x=>({b:x})),linhaEnc({chegada:h,rastreio:'MLB0000000000',transportadora:'Mercado Livre',destinatario:'Nome do morador',endereco:'Rua, número, complemento',bairro:'Nome do bairro',telefone:'(21) 90000-0000',valor:10,entregue:true,entregueEm:h,pago:false,pagoEm:'',forma:'',obs:''})],widths:WE},
  {name:'Clientes',rows:[HC.map(x=>({b:x})),['Nome do morador','Rua, número, complemento','Nome do bairro','(21) 90000-0000','']],widths:[28,40,20,18,30]}]))});

/* ---------- registro ---------- */
$('rTr').innerHTML=TRANSP.map(t=>`<option>${t}</option>`).join('');
function irPara(t){tela=t;try{localStorage.setItem(LS+'-tela',t)}catch(e){}render();window.scrollTo(0,0);if(t==='reg')setTimeout(()=>$(rTipo==='enc'?(rOrdem==='cli'?'rNome':'rTrk'):'cNomeR').focus(),30)}
document.querySelector('.modos').addEventListener('click',e=>{const b=e.target.closest('.modo');if(b)irPara(b.dataset.tela)});
$('rOrdem').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;rOrdem=b.dataset.o;try{localStorage.setItem(LS+'-ordem',rOrdem)}catch(err){}renderReg();setTimeout(()=>$(rOrdem==='cli'?'rNome':'rTrk').focus(),30)});
document.querySelector('.seg').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;rTipo=b.dataset.r;renderReg();setTimeout(()=>$(rTipo==='enc'?(rOrdem==='cli'?'rNome':'rTrk'):'cNomeR').focus(),30)});
function infoCliente(){
 const nome=$('rNome').value.trim(),c=acharCliente(nome);
 if(!nome){$('rInfo').innerHTML='';$('rNovo').hidden=true;return null}
 if(c){$('rNovo').hidden=true;const n=itens.filter(x=>norm(x.destinatario)===norm(c.nome)&&!x.entregue).length;
  $('rInfo').innerHTML=`<div class="rcli"><b>${esc(c.nome)}</b><br>${esc(c.endereco||'Sem endereço cadastrado')}${c.bairro?' · '+esc(c.bairro):''}${c.telefone?' · '+esc(c.telefone):''}${n?`<br>Já tem ${n} encomenda${n>1?'s':''} esperando entrega.`:''}${rOrdem==='cli'?'<br>Depois de registrar, o cliente continua selecionado para você lançar outro rastreio dele.':''}</div>`;return c}
 const q=norm(nome),temSug=clientes.some(x=>norm([x.nome,x.endereco,x.bairro,x.telefone].join(' ')).includes(q));
 $('rNovo').hidden=false;$('rInfo').innerHTML=`<div class="rcli novo">${temSug?'Toque num dos clientes acima ou, se for alguém novo, preencha o endereço abaixo.':'Cliente novo. Preencha o endereço e ele fica cadastrado junto com a encomenda.'}</div>`;return null;
}
function renderReg(){
 if(tela!=='reg')return;
 $('sEnc').setAttribute('aria-pressed',rTipo==='enc');$('sCli').setAttribute('aria-pressed',rTipo==='cli');$('rEnc').hidden=rTipo!=='enc';$('rCliF').hidden=rTipo!=='cli';
 $('rOrdem').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.o===rOrdem));
 {const f=$('rEnc'),bc=$('rBlocoCli'),bt=$('rBlocoTrk');if(rOrdem==='trk'&&bc.previousElementSibling!==bt)f.insertBefore(bt,bc);if(rOrdem==='cli'&&bt.previousElementSibling!==bc)f.insertBefore(bc,bt)}
 if(!$('rCh').value)$('rCh').value=hoje();if($('rVal').value==='')$('rVal').value=valorPadrao;$('rOutraW').hidden=$('rTr').value!=='Outra';
 const h=hoje();
 if(rTipo==='enc'){const L=itens.filter(x=>x.chegada===h).sort((a,b)=>(b.criadoEm||0)-(a.criadoEm||0));
  $('hojeT').textContent=L.length?'Chegaram hoje: '+L.length:'Nenhuma encomenda registrada hoje';
  $('hojeL').innerHTML=L.slice(0,50).map(x=>`<div class="r"><span><b>${esc(x.destinatario)}</b>${x.bairro?`<span class="bt">${esc(x.bairro)}</span>`:''}</span><span class="meta" style="margin:0"><span class="tag">${esc(x.transportadora)}</span>${x.rastreio?`<span class="trk">${esc(x.rastreio)}</span>`:''}<span>${x.entregue?'entregue':'a entregar'}</span><button class="lnk" data-ed="${x.id}">editar</button></span></div>`).join('')}
 else{const L=clientes.filter(c=>c.criadoEm&&iso(new Date(c.criadoEm))===h).sort((a,b)=>b.criadoEm-a.criadoEm);
  $('hojeT').textContent=L.length?'Clientes cadastrados hoje: '+L.length:'Nenhum cliente cadastrado hoje';
  $('hojeL').innerHTML=L.slice(0,50).map(c=>`<div class="r"><span><b>${esc(c.nome)}</b>${c.bairro?`<span class="bt">${esc(c.bairro)}</span>`:''}</span><span class="addr">${esc(c.endereco)}</span></div>`).join('')}
}
$('hojeL').addEventListener('click',e=>{const b=e.target.closest('[data-ed]');if(!b)return;const x=itens.find(i=>i.id===b.dataset.ed);if(x)abrirForm(x)});
function sugestoes(){
 const q=norm($('rNome').value),c=acharCliente($('rNome').value);
 if(!q||c){$('rSug').innerHTML='';return}
 const L=clientes.filter(x=>norm([x.nome,x.endereco,x.bairro,x.telefone].join(' ')).includes(q)).sort((a,b)=>(norm(a.nome).startsWith(q)?0:1)-(norm(b.nome).startsWith(q)?0:1)||a.nome.localeCompare(b.nome,'pt-BR')).slice(0,6);
 $('rSug').innerHTML=L.map(x=>`<button type="button" data-n="${esc(x.nome)}"><b>${esc(x.nome)}</b><br><span>${esc(x.endereco||'')}${x.bairro?' · '+esc(x.bairro):''}</span></button>`).join('');
}
$('rNome').addEventListener('input',()=>{infoCliente();sugestoes()});
$('rSug').addEventListener('click',e=>{const b=e.target.closest('[data-n]');if(!b)return;$('rNome').value=b.dataset.n;$('rSug').innerHTML='';infoCliente();
 if(rOrdem==='cli')$('rTrk').focus();else $('rOk').focus()});
$('rTr').addEventListener('change',()=>{$('rOutraW').hidden=$('rTr').value!=='Outra'});
$('rTrk').addEventListener('input',()=>{const v=norm($('rTrk').value);const d=v&&itens.find(x=>norm(x.rastreio)===v);$('rWTrk').textContent=d?'Esse código já está cadastrado para '+d.destinatario+' (chegou em '+br(d.chegada)+').':''});
$('rEnc').addEventListener('submit',async e=>{
 e.preventDefault();$('rErr').textContent='';
 const nome=$('rNome').value.trim(),c=acharCliente(nome);
 if(!c&&!$('rEnd').value.trim()){$('rErr').textContent='Cliente novo: preencha o endereço de entrega.';$('rEnd').focus();return}
 const tr=$('rTr').value==='Outra'?($('rOutra').value.trim()||'Outra'):$('rTr').value;
 const it={id:novoId(),rastreio:$('rTrk').value.trim(),transportadora:tr,chegada:$('rCh').value||hoje(),destinatario:c?c.nome:nome,
  endereco:c?(c.endereco||''):$('rEnd').value.trim(),bairro:c?(c.bairro||''):$('rBai').value.trim(),telefone:c?(c.telefone||''):$('rTel').value.trim(),
  valor:Math.round((parseFloat($('rVal').value)||0)*100)/100,entregue:false,entregueEm:'',pago:false,pagoEm:'',forma:'',obs:$('rObs').value.trim(),criadoEm:Date.now()};
 $('rOk').disabled=true;const ok=await gravar('encomendas',it);
 if(ok){if(!c)await garantirCliente(it.destinatario,it.endereco,it.telefone,it.bairro);
  toast('Encomenda de '+it.destinatario+' registrada.');
  const limpar=rOrdem==='cli'?['rTrk','rObs']:['rNome','rTrk','rEnd','rBai','rTel','rObs'];for(const i of limpar)$(i).value='';$('rWTrk').textContent='';
  if(rOrdem==='cli'&&!c){$('rNome').value=it.destinatario;for(const i of['rEnd','rBai','rTel'])$(i).value=''}
  infoCliente();sugestoes();$(rOrdem==='cli'?'rTrk':'rTrk').focus()}
 $('rOk').disabled=false;
});
$('rCliF').addEventListener('submit',async e=>{
 e.preventDefault();const nome=$('cNomeR').value.trim();$('cErrR').textContent='';if(!nome)return;
 if(acharCliente(nome)){$('cErrR').textContent='Já existe um cliente com esse nome. Para mudar os dados dele, use a aba Clientes no Controle.';return}
 const o={id:novoId(),nome,endereco:$('cEndR').value.trim(),bairro:$('cBaiR').value.trim(),telefone:$('cTelR').value.trim(),obs:$('cObsR').value.trim(),criadoEm:Date.now()};
 if(await gravar('clientes',o)){toast(nome+' cadastrado.');for(const i of['cNomeR','cEndR','cBaiR','cTelR','cObsR'])$(i).value='';$('cNomeR').focus()}
});

/* ---------- login ---------- */
let criando=false;
const ERROS={'auth/invalid-credential':'E-mail ou senha incorretos.','auth/wrong-password':'E-mail ou senha incorretos.','auth/user-not-found':'E-mail ou senha incorretos.','auth/invalid-email':'Esse e-mail não é válido.',
 'auth/email-already-in-use':'Já existe uma conta com esse e-mail. Use Entrar.','auth/weak-password':'A senha precisa ter pelo menos 6 caracteres.','auth/too-many-requests':'Muitas tentativas. Espere alguns minutos e tente de novo.','auth/network-request-failed':'Sem conexão com a internet.'};
const msgErro=e=>ERROS[e&&e.code]||'Não foi possível entrar. Tente de novo.';
function modoLogin(c){criando=c;$('lConfW').hidden=!c;$('lOk').textContent=c?'Criar conta':'Entrar';$('lModo').textContent=c?'Já tenho conta':'Criar uma conta';
 $('lSub').textContent=c?'Crie a sua conta com e-mail e senha. Os seus dados ficam visíveis só para quem entrar com essa conta.':'Entre com o seu e-mail e a sua senha.';$('lSenha').autocomplete=c?'new-password':'current-password';$('lErr').textContent=''}
$('lModo').addEventListener('click',()=>modoLogin(!criando));
$('fLogin').addEventListener('submit',async e=>{e.preventDefault();const em=$('lEmail').value.trim(),se=$('lSenha').value;$('lErr').textContent='';
 if(criando&&se.length<8){$('lErr').textContent='Use uma senha com pelo menos 8 caracteres.';return}
 if(criando&&se!==$('lConf').value){$('lErr').textContent='As 2 senhas estão diferentes.';return}
 $('lOk').disabled=true;try{await setPersistence(auth,$('lManter').checked?browserLocalPersistence:browserSessionPersistence);criando?await createUserWithEmailAndPassword(auth,em,se):await signInWithEmailAndPassword(auth,em,se)}catch(err){$('lErr').textContent=msgErro(err)}$('lOk').disabled=false});
$('lEsq').addEventListener('click',async()=>{const em=$('lEmail').value.trim();if(!em){$('lErr').textContent='Digite o seu e-mail acima e toque de novo em Esqueci a senha.';return}
 try{await sendPasswordResetEmail(auth,em);$('lErr').textContent='Se esse e-mail tiver conta, chegará uma mensagem para criar uma senha nova. Confira também o spam.'}catch(err){$('lErr').textContent=msgErro(err)}});
$('bSair').addEventListener('click',()=>caixa('Sair da conta?','<p style="margin:0">Para ver as encomendas de novo, será preciso entrar com e-mail e senha.</p>',[{t:'Cancelar'},{t:'Sair',cls:'main',f:()=>{signOut(auth)}}]));


/* ---------- demonstração: clientes e encomendas fictícios, recriados a cada carregamento da página ---------- */
let demoSemeado=false;
async function semearDemo(){
 if(demoSemeado)return;demoSemeado=true;
 let s=7;const rnd=()=>((s=(s*1103515245+12345)%2147483648)/2147483648);
 const dig=n=>Array.from({length:n},()=>Math.floor(rnd()*10)).join('');
 const CLI=[
  ['Heloísa Dantas','Rua das Acácias, 120, casa 2','Jardim Primavera','(21) 99000-0101'],
  ['Marcos Vilela','Rua das Acácias, 245','Jardim Primavera','(21) 99000-0102'],
  ['Sofia Albuquerque','Travessa do Sol, 18','Jardim Primavera','(21) 99000-0103'],
  ['Clara Montenegro','Rua Pedro Lessa, 77, apto 301','Vila Serena','(21) 99000-0104'],
  ['Rafael Cordeiro','Rua Pedro Lessa, 90','Vila Serena','(21) 99000-0105'],
  ['Lívia Bastos','Estrada da Colina, 1500, casa 14','Vila Serena','(21) 99000-0106'],
  ['Otávio Prado','Rua do Mirante, 33','Morada do Lago','(21) 99000-0107'],
  ['Isis Carvalhal','Rua do Mirante, 58, fundos','Morada do Lago','(21) 99000-0108'],
  ['Bernardo Tavares','Avenida das Palmeiras, 410','Morada do Lago','(21) 99000-0109'],
  ['Yasmin Furtado','Rua Nova Esperança, 12','Centro','(21) 99000-0110'],
  ['Gael Monteiro','Rua Nova Esperança, 64, loja','Centro','(21) 99000-0111'],
  ['Valéria Sampaio','Praça da Matriz, 5, sala 2','Centro','(21) 99000-0112']
 ];
 const t0=Date.now();
 const clientes=CLI.map(([nome,endereco,bairro,telefone],i)=>({id:'cli'+(i+1),nome,endereco,bairro,telefone,obs:i===3?'Deixar com o porteiro se não houver ninguém.':'',criadoEm:t0-(60-i)*864e5}));
 const codigo=tr=>({'Correios':()=>'Q'+'ABCDEFGHJKLMNPRSTUVWXYZ'[Math.floor(rnd()*23)]+dig(9)+'BR','Mercado Livre':()=>'4'+dig(10),'Shopee':()=>'BR'+dig(13),'Amazon':()=>'TBA'+dig(12),'Shein':()=>'SH'+dig(12),'Jadlog':()=>dig(14),'Magalu':()=>'MG'+dig(11),'TikTok Shop':()=>'TT'+dig(13),'Loggi':()=>'LG'+dig(10)}[tr]||(()=>dig(12)))();
 const TR=['Mercado Livre','Shopee','Correios','Amazon','Mercado Livre','Shein','Shopee','Jadlog','Magalu','TikTok Shop','Correios','Loggi'];
 const FORMAS=['Pix','Pix','Pix','Dinheiro','Cartão'];
 const encomendas=[];
 for(let k=0;k<34;k++){
  const dias=Math.floor(k*1.1);
  const chegada=somaDias(hoje(),-dias);
  const c=clientes[Math.floor(rnd()*clientes.length)];
  const tr=TR[Math.floor(rnd()*TR.length)];
  const valor=rnd()<0.8?10:15;
  let entregue=false,entregueEm='',pago=false,pagoEm='',forma='';
  if(dias>=3||(dias>=1&&rnd()<0.5)){entregue=true;entregueEm=somaDias(chegada,Math.min(dias,Math.floor(rnd()*3)))}
  if(entregue&&(dias>=6?rnd()<0.92:rnd()<0.6)){pago=true;pagoEm=entregueEm;forma=FORMAS[Math.floor(rnd()*FORMAS.length)]}
  if(!entregue&&rnd()<0.2){pago=true;pagoEm=chegada;forma='Pix'}
  encomendas.push({id:'enc'+(k+1),rastreio:codigo(tr),transportadora:tr,chegada,destinatario:c.nome,endereco:c.endereco,bairro:c.bairro,telefone:c.telefone,valor,entregue,entregueEm,pago,pagoEm,forma,obs:k===2?'Caixa grande, frágil.':'',criadoEm:t0-dias*864e5-k*6e4});
 }
 await setDoc(doc(fdb,'usuarios',UID,'config','geral'),{valorPadrao:10});
 await gravarVarios('clientes',clientes);
 await gravarVarios('encomendas',encomendas);
}

/* ---------- início ---------- */
try{const f=JSON.parse(localStorage.getItem(LS+'-filtros')||'null');if(f)F={...F,...f}}catch(e){}
try{localStorage.removeItem(LS);const o=localStorage.getItem(LS+'-ordem');if(o==='cli'||o==='trk')rOrdem=o}catch(e){}
onAuthStateChanged(auth,u=>{
 subs.forEach(f=>f());subs=[];itens=[];clientes=[];valorPadrao=10;carregado=false;
 if(!u){UID=null;$('vApp').hidden=true;$('vLogin').hidden=false;$('lSenha').value='';$('lConf').value='';['ovForm','ovMsg','ovImp'].forEach(fechar);render();return}
 UID=u.uid;tela='reg';$('rVal').value='';$('vLogin').hidden=true;$('vApp').hidden=false;render();
 const tm=setTimeout(()=>{$('status').textContent='Os dados ainda não chegaram. Verifique a conexão.'},10000);
 const erro=()=>{clearTimeout(tm);carregado=true;render();$('status').textContent='Não foi possível acessar os dados. Saia e entre de novo.'};
 subs.push(onSnapshot(collection(fdb,'usuarios',UID,'encomendas'),s=>{itens=s.docs.map(d=>({...d.data(),id:d.id}));carregado=true;clearTimeout(tm);render()},erro));
 subs.push(onSnapshot(collection(fdb,'usuarios',UID,'clientes'),s=>{clientes=s.docs.map(d=>({...d.data(),id:d.id}));render()},erro));
 semearDemo();
 subs.push(onSnapshot(doc(fdb,'usuarios',UID,'config','geral'),s=>{if(s.exists()){valorPadrao=+s.data().valorPadrao||10;render()}},()=>{}));
});
}
