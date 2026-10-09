// Interface: canvas, navegação (roda, pinça, arrastar, retângulo, teclado), histórico na
// URL, paletas, pool de Web Workers com renderização progressiva e exportação em PNG.
import * as BF from './bigfixed.js';
import * as E from './estado.js';
import { FRACTAIS, LIMITE_MOTOR, escolherMotor, iteracoesAutomaticas } from './fractais.js';
import * as PAL from './paletas.js';

const $ = (id) => document.getElementById(id);
const el = {
  tela: $('tela'),
  moldura: $('moldura'),
  selecao: $('selecao'),
  avisoEscolha: $('aviso-escolha'),
  progressoBarra: $('progresso-barra'),
  status: $('status'),
  fractal: $('fractal'),
  voltar: $('voltar'),
  avancar: $('avancar'),
  inicio: $('inicio'),
  aproximar: $('aproximar'),
  afastar: $('afastar'),
  modoRetangulo: $('modo-retangulo'),
  infoCentro: $('info-centro'),
  infoZoom: $('info-zoom'),
  infoIteracoes: $('info-iteracoes'),
  infoPrecisao: $('info-precisao'),
  infoTempo: $('info-tempo'),
  avisoPrecisao: $('aviso-precisao'),
  iteracoes: $('iteracoes'),
  iterAuto: $('iter-auto'),
  motor: $('motor'),
  painelJulia: $('painel-julia'),
  juliaRe: $('julia-re'),
  juliaIm: $('julia-im'),
  juliaAplicar: $('julia-aplicar'),
  juliaEscolher: $('julia-escolher'),
  paleta: $('paleta'),
  gradiente: $('gradiente'),
  paradas: $('paradas'),
  adicionarParada: $('adicionar-parada'),
  densidade: $('densidade'),
  densidadeValor: $('densidade-valor'),
  deslocamento: $('deslocamento'),
  deslocamentoValor: $('deslocamento-valor'),
  escalaLog: $('escala-log'),
  corInterior: $('cor-interior'),
  tamanho: $('tamanho'),
  exportar: $('exportar'),
  cancelarExportacao: $('cancelar-exportacao'),
  copiarLink: $('copiar-link'),
  exportacaoProgresso: $('exportacao-progresso'),
  exportacaoStatus: $('exportacao-status'),
};
const ctx = el.tela.getContext('2d', { alpha: false });

function lerPreferencia(chave, padrao) {
  try {
    const v = localStorage.getItem(chave);
    return v === null ? padrao : v;
  } catch {
    return padrao;
  }
}
function gravarPreferencia(chave, valor) {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    // armazenamento indisponível (modo privado): a preferência só vale nesta visita
  }
}

const numero = (v, casas = 2) => v.toLocaleString('pt-BR', { maximumFractionDigits: casas });

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

let estado = E.lerHash(location.hash);
let exibido = estado; // geometria do que está desenhado no canvas
let paradas = E.paradasDoEstado(estado);
let tabela = PAL.construirTabela(paradas);
let corInterior = PAL.hexParaRgb(lerPreferencia('fractais.interior', '#000000')) || [0, 0, 0];
let reforco = 1; // multiplicador adaptativo das iterações automáticas
let escolhendoC = null; // estado da Julia guardado enquanto o usuário escolhe c
let modoRetangulo = false;

// ---------------------------------------------------------------------------
// Pool de Web Workers
// ---------------------------------------------------------------------------

const NUM_WORKERS = Math.max(2, Math.min(navigator.hardwareConcurrency || 4, 8));
const workers = [];
let filaInterativa = [];
let filaExportacao = [];
let proximoId = 1;
const emAndamento = new Map();
const referenciasPendentes = new Map();
let workersOk = true;

function criarWorkers() {
  try {
    for (let i = 0; i < NUM_WORKERS; i++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      const slot = { w, ocupado: false };
      w.onmessage = (ev) => aoMensagem(slot, ev.data);
      w.onerror = (ev) => {
        ev.preventDefault();
        mostrarStatus('Um worker de cálculo falhou: ' + (ev.message || 'erro desconhecido') + '.');
      };
      workers.push(slot);
    }
  } catch (erro) {
    workersOk = false;
    mostrarStatus('Não foi possível iniciar os Web Workers. Abra a página por um servidor local (python3 -m http.server).');
  }
}

function enviarParaTodos(msg) {
  for (const s of workers) s.w.postMessage(msg);
}

function despachar() {
  for (const s of workers) {
    if (s.ocupado) continue;
    const job = filaInterativa.length ? filaInterativa.shift() : filaExportacao.shift();
    if (!job) break;
    s.ocupado = true;
    emAndamento.set(job.msg.id, job);
    s.w.postMessage(job.msg);
  }
}

function aoMensagem(slot, m) {
  if (m.tipo === 'referencia') {
    const resolver = referenciasPendentes.get(m.id);
    referenciasPendentes.delete(m.id);
    if (resolver) resolver(m);
    return;
  }
  if (m.tipo === 'bloco') {
    slot.ocupado = false;
    const job = emAndamento.get(m.id);
    emAndamento.delete(m.id);
    if (job && !m.descartado) job.aoTerminar(m);
    despachar();
  }
}

// Órbitas de referência recentes, para não recalcular ao trocar só as cores ou o motor.
const cacheReferencias = new Map();
function obterReferencia(e, P, maxIter) {
  const chave = [e.tipo, e.cx, e.cy, P, maxIter, e.tipo === 'julia' ? `${e.jr},${e.ji}` : ''].join('|');
  if (cacheReferencias.has(chave)) return Promise.resolve(cacheReferencias.get(chave));
  return new Promise((resolve) => {
    const id = proximoId++;
    referenciasPendentes.set(id, (m) => {
      cacheReferencias.set(chave, m);
      while (cacheReferencias.size > 3) cacheReferencias.delete(cacheReferencias.keys().next().value);
      resolve(m);
    });
    const livre = workers.find((s) => !s.ocupado) || workers[0];
    livre.w.postMessage({ tipo: 'referencia', id, fractal: e.tipo, cx: e.cx, cy: e.cy, P, maxIter, jr: e.jr, ji: e.ji });
  });
}

// Blocos ordenados do centro para fora: o meio da tela aparece primeiro.
function gerarBlocos(w, h, tam, passo) {
  const blocos = [];
  for (let y = 0; y < h; y += tam) {
    for (let x = 0; x < w; x += tam) {
      blocos.push({ x0: x, y0: y, w: Math.min(tam, w - x), h: Math.min(tam, h - y), passo });
    }
  }
  const cx = w / 2;
  const cy = h / 2;
  const d = (b) => (b.x0 + b.w / 2 - cx) ** 2 + (b.y0 + b.h / 2 - cy) ** 2;
  return blocos.sort((a, b) => d(a) - d(b));
}

function configurarVista(e, geracao, largura, altura, maxIter, motor, P, ref, crit) {
  const c = E.centroFixo(e, P);
  return {
    tipo: 'config',
    geracao,
    fractal: e.tipo,
    motor,
    largura,
    altura,
    espacamento: (2 * e.raio) / altura,
    sinalY: E.sinalY(e.tipo),
    cx: BF.toDouble(c.x, P),
    cy: BF.toDouble(c.y, P),
    cxDD: BF.toDD(c.x, P),
    cyDD: BF.toDD(c.y, P),
    maxIter,
    jr: e.jr,
    ji: e.ji,
    ref,
    crit,
  };
}

function maxIteracoes(e) {
  if (e.iter) return e.iter;
  const base = iteracoesAutomaticas(e.raio, FRACTAIS[e.tipo].raio);
  return Math.min(1000000, Math.round(base * reforco));
}

// ---------------------------------------------------------------------------
// Canvas e renderização progressiva
// ---------------------------------------------------------------------------

let largura = 0;
let altura = 0;
let mu = new Float32Array(0);
let nivel = new Uint8Array(0); // 0: nada, 1: prévia grossa, 2: resolução final
let imagem = null;
let geracao = 0;
let info = null;
let timerRender = 0;
const snapshot = document.createElement('canvas');

function ajustarTamanho() {
  const r = el.tela.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = Math.max(1, Math.round(r.width * dpr));
  let h = Math.max(1, Math.round(r.height * dpr));
  const maxPixels = 3.2e6;
  if (w * h > maxPixels) {
    const k = Math.sqrt(maxPixels / (w * h));
    w = Math.round(w * k);
    h = Math.round(h * k);
  }
  if (w === largura && h === altura) return false;
  largura = w;
  altura = h;
  el.tela.width = w;
  el.tela.height = h;
  mu = new Float32Array(w * h).fill(NaN);
  nivel = new Uint8Array(w * h);
  imagem = ctx.createImageData(w, h);
  return true;
}

function colorirRegiao(x0, y0, w, h) {
  const dados = imagem.data;
  const n = tabela.length / 3;
  const { densidade, deslocamento, log } = estado;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = y * largura + x;
      const v = mu[i];
      const k = i * 4;
      if (!(v >= 0)) {
        // interior (ou ainda sem valor)
        dados[k] = corInterior[0];
        dados[k + 1] = corInterior[1];
        dados[k + 2] = corInterior[2];
      } else {
        let t = PAL.posicaoCor(v, densidade, deslocamento, log);
        t -= Math.floor(t);
        const j = Math.min(n - 1, (t * n) | 0) * 3;
        dados[k] = tabela[j];
        dados[k + 1] = tabela[j + 1];
        dados[k + 2] = tabela[j + 2];
      }
      dados[k + 3] = 255;
    }
  }
  ctx.putImageData(imagem, 0, 0, x0, y0, w, h);
}

function recolorirTudo() {
  if (!imagem) return;
  colorirRegiao(0, 0, largura, altura);
}

function salvarSnapshot() {
  snapshot.width = largura;
  snapshot.height = altura;
  snapshot.getContext('2d').drawImage(el.tela, 0, 0);
}

// Desenha a imagem guardada (geometria `de`) já transformada para a geometria `para`.
function desenharSnapshot(de, para) {
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, largura, altura);
  if (de.tipo === para.tipo && de.jr === para.jr && de.ji === para.ji && snapshot.width === largura) {
    const P = Math.max(E.bitsDaVista(de, altura), E.bitsDaVista(para, altura)) + 8;
    const a = E.centroFixo(de, P);
    const b = E.centroFixo(para, P);
    const esp = E.espacamento(para, altura);
    const X = largura / 2 + BF.toDouble(a.x - b.x, P) / esp;
    const Y = altura / 2 + (E.sinalY(para.tipo) * BF.toDouble(a.y - b.y, P)) / esp;
    const s = de.raio / para.raio;
    if (Number.isFinite(X) && Number.isFinite(Y) && s < 1e6) {
      ctx.imageSmoothingEnabled = true;
      ctx.setTransform(s, 0, 0, s, X - (s * largura) / 2, Y - (s * altura) / 2);
      ctx.drawImage(snapshot, 0, 0);
    }
  }
  ctx.restore();
}

function agendarRender(atraso = 40, previa = true) {
  clearTimeout(timerRender);
  timerRender = setTimeout(() => renderizar({ previa }), atraso);
}

async function renderizar({ previa }) {
  if (!workersOk || !largura) return;
  const g = ++geracao;
  filaInterativa = [];
  const e = estado;
  const maxIter = maxIteracoes(e);
  const motor = escolherMotor(e.motor, e.raio, altura, Number(e.cx), Number(e.cy));
  const P = E.bitsDaVista(e, altura);
  info = {
    inicio: performance.now(),
    motor,
    maxIter,
    P,
    refLen: 0,
    total: 0,
    feitos: 0,
    escaparam: 0,
    perto: 0,
    previaTotal: 0,
    previaFeitos: 0,
    previaEscaparam: 0,
    fim: 0,
  };
  atualizarInfo();
  el.progressoBarra.style.width = '0';
  let ref = null;
  let crit = null;
  if (motor === 'perturbacao') {
    mostrarStatus(`Calculando a órbita de referência com ${P} bits...`);
    const r = await obterReferencia(e, P, maxIter);
    if (g !== geracao) return;
    ref = r.ref;
    crit = r.crit;
    info.refLen = ref.length;
  }
  mostrarStatus('Renderizando...');
  enviarParaTodos(configurarVista(e, g, largura, altura, maxIter, motor, P, ref, crit));
  const blocosPrevia = previa ? gerarBlocos(largura, altura, 128, 4) : [];
  const blocos = [...blocosPrevia, ...gerarBlocos(largura, altura, 64, 1)];
  info.total = blocos.length;
  info.previaTotal = blocosPrevia.length;
  filaInterativa = blocos.map((b) => ({
    msg: { tipo: 'bloco', id: proximoId++, geracao: g, ...b },
    aoTerminar: (m) => receberBloco(g, m),
  }));
  despachar();
}

function receberBloco(g, m) {
  if (g !== geracao) return;
  const { x0, y0, w, h, passo } = m;
  if (passo === 1) {
    for (let j = 0; j < h; j++) {
      const linha = (y0 + j) * largura + x0;
      mu.set(m.mu.subarray(j * w, j * w + w), linha);
      nivel.fill(2, linha, linha + w);
    }
    info.escaparam += m.escaparam;
    info.perto += m.pertoDoLimite;
  } else {
    info.previaFeitos++;
    info.previaEscaparam += m.escaparam;
    const cols = Math.ceil(w / passo);
    for (let j = 0; j < h; j++) {
      const base = ((j / passo) | 0) * cols;
      for (let i = 0; i < w; i++) {
        const k = (y0 + j) * largura + x0 + i;
        if (nivel[k] === 2) continue;
        mu[k] = m.mu[base + ((i / passo) | 0)];
        nivel[k] = 1;
      }
    }
  }
  colorirRegiao(x0, y0, w, h);
  info.feitos++;
  el.progressoBarra.style.width = `${(100 * info.feitos) / info.total}%`;
  if (passo > 1 && info.previaFeitos === info.previaTotal && avaliarPrevia(g)) return;
  if (info.feitos === info.total) terminarRender(g);
}

// Sonda barata: se nenhum ponto da prévia escapou, o limite de iterações provavelmente
// é baixo demais para esta profundidade (no vale dos cavalos-marinhos, por exemplo).
// Dobra e tenta de novo antes de gastar tempo com a resolução final.
function avaliarPrevia(g) {
  if (estado.iter || info.previaEscaparam > 0 || reforco >= 16 || g !== geracao) return false;
  reforco *= 2;
  mostrarStatus(`Nenhum ponto escapou em ${numero(info.maxIter, 0)} iterações: tentando ${numero(maxIteracoes(estado), 0)}...`);
  renderizar({ previa: true });
  return true;
}

function terminarRender(g) {
  info.fim = performance.now();
  el.progressoBarra.style.width = '0';
  atualizarInfo();
  // Iterações adaptativas: se muitos pixels só escapam perto do limite, é provável que
  // outros, pintados como interior, escapariam com mais iterações. Aumenta e refaz.
  const e = estado;
  if (!e.iter && info.escaparam > 0 && info.perto / info.escaparam > 0.01 && reforco < 8 && g === geracao) {
    reforco = Math.min(8, reforco * 1.6);
    mostrarStatus(`Muitos pixels escapam perto do limite: subindo as iterações para ${maxIteracoes(e)}...`);
    renderizar({ previa: false });
    return;
  }
  const segundos = (info.fim - info.inicio) / 1000;
  mostrarStatus(`Pronto em ${numero(segundos, 2)} s.`);
}

// ---------------------------------------------------------------------------
// Informações e controles
// ---------------------------------------------------------------------------

function mostrarStatus(texto) {
  el.status.textContent = texto;
}

function textoCentro(e) {
  const corta = (s) => {
    const p = s.indexOf('.');
    return p >= 0 && s.length - p > 61 ? s.slice(0, p + 61) + '…' : s;
  };
  const im = e.cy.startsWith('-') ? `- ${corta(e.cy.slice(1))}` : `+ ${corta(e.cy)}`;
  return `${corta(e.cx)} ${im}i`;
}

function atualizarInfo() {
  const e = estado;
  el.infoCentro.textContent = textoCentro(e);
  const z = E.formatarZoom(e);
  const m = /^(.*) × 10\^(\d+)$/.exec(z);
  el.infoZoom.replaceChildren();
  if (m) {
    el.infoZoom.append(`${m[1]} × 10`);
    const sup = document.createElement('sup');
    sup.textContent = m[2];
    el.infoZoom.append(sup);
  } else {
    el.infoZoom.textContent = z;
  }
  el.tela.setAttribute('aria-label', `${FRACTAIS[e.tipo].nome}, centro ${textoCentro(e)}, zoom ${z}`);
  if (!info) return;
  el.infoIteracoes.textContent = `${numero(info.maxIter, 0)} ${e.iter ? '(manual)' : '(automático)'}`;
  if (!e.iter) el.iteracoes.value = String(info.maxIter);
  const nomes = {
    double: 'double (53 bits)',
    dd: 'double-double (cerca de 106 bits)',
    perturbacao: `perturbação: referência com ${info.P} bits${info.refLen ? ` e ${numero(info.refLen, 0)} pontos` : ''}`,
  };
  el.infoPrecisao.textContent = nomes[info.motor];
  el.infoTempo.textContent = info.fim
    ? `${numero((info.fim - info.inicio) / 1000, 2)} s · ${numero((largura * altura) / 1e6, 1)} Mpx · ${NUM_WORKERS} workers`
    : 'calculando...';
  // Aviso quando o motor escolhido à mão não tem bits para este zoom.
  const escala = Math.max(1, Math.abs(Number(e.cx)), Math.abs(Number(e.cy)));
  const esp = E.espacamento(e, altura) / escala;
  let aviso = '';
  if (info.motor === 'double' && esp < LIMITE_MOTOR.double * 100) {
    aviso = 'Neste zoom o double já não separa pixels vizinhos e a imagem vira blocos. A precisão automática troca para perturbação.';
  } else if (info.motor === 'dd' && esp < LIMITE_MOTOR.dd * 100) {
    aviso = 'Neste zoom nem o double-double separa os pixels. Use a perturbação.';
  }
  el.avisoPrecisao.textContent = aviso;
  el.avisoPrecisao.hidden = !aviso;
}

function atualizarControles() {
  const e = estado;
  el.fractal.value = e.tipo;
  el.iterAuto.checked = !e.iter;
  el.iteracoes.disabled = !e.iter;
  el.iteracoes.value = String(e.iter || maxIteracoes(e));
  el.motor.value = e.motor;
  el.juliaRe.value = String(e.jr);
  el.juliaIm.value = String(e.ji);
  el.painelJulia.classList.toggle('ativo', e.tipo === 'julia');
  el.densidade.value = String(Math.log2(e.densidade));
  el.densidadeValor.textContent = `${numero(e.densidade, 2)}x`;
  el.deslocamento.value = String(e.deslocamento);
  el.deslocamentoValor.textContent = numero(e.deslocamento, 3);
  el.escalaLog.checked = e.log;
  el.paleta.value = PAL.PALETAS[e.paleta] ? e.paleta : 'personalizada';
  desenharParadas();
}

// ---------------------------------------------------------------------------
// Histórico e URL
// ---------------------------------------------------------------------------

let indiceHistorico = 0;
let maiorIndice = 0;
let ultimaMudanca = -Infinity;
let timerUrl = 0;
let urlPendenteNova = false;

function agendarUrl(modo) {
  if (modo === 'nenhum') return;
  const agora = performance.now();
  if (modo === 'novo' || (modo === 'agrupar' && agora - ultimaMudanca > 800)) urlPendenteNova = true;
  ultimaMudanca = agora;
  clearTimeout(timerUrl);
  timerUrl = setTimeout(gravarUrl, 250);
}

function gravarUrl() {
  const hash = E.escreverHash(estado);
  const nova = urlPendenteNova;
  urlPendenteNova = false;
  if (hash === location.hash) return;
  try {
    if (nova) {
      indiceHistorico++;
      maiorIndice = indiceHistorico;
      history.pushState({ i: indiceHistorico }, '', hash);
    } else {
      history.replaceState({ i: indiceHistorico }, '', hash);
    }
  } catch {
    // alguns navegadores limitam a frequência de mudanças no histórico
  }
  atualizarBotoesHistorico();
}

function atualizarBotoesHistorico() {
  el.voltar.disabled = indiceHistorico <= 0;
  el.avancar.disabled = indiceHistorico >= maiorIndice;
}

window.addEventListener('popstate', (ev) => {
  clearTimeout(timerUrl);
  indiceHistorico = ev.state && Number.isInteger(ev.state.i) ? ev.state.i : 0;
  const novo = E.lerHash(location.hash);
  if (novo.paleta !== estado.paleta) definirParadas(E.paradasDoEstado(novo), false);
  navegar(novo, { historico: 'nenhum' });
  atualizarBotoesHistorico();
});

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------

// Troca a vista. A imagem atual é reaproveitada, transformada, até os blocos novos chegarem.
function navegar(novo, { historico = 'agrupar', jaDesenhado = false } = {}) {
  const mesmaGeometria =
    novo.tipo === exibido.tipo && novo.cx === exibido.cx && novo.cy === exibido.cy && novo.raio === exibido.raio &&
    novo.jr === exibido.jr && novo.ji === exibido.ji;
  if (!jaDesenhado) {
    salvarSnapshot();
    desenharSnapshot(exibido, novo);
  }
  // O reforço adaptativo acompanha o mergulho; volta a 1 ao trocar de fractal ou subir.
  if (novo.tipo !== estado.tipo || novo.raio > FRACTAIS[novo.tipo].raio / 10) reforco = 1;
  estado = novo;
  exibido = novo;
  mu.fill(NaN);
  nivel.fill(0);
  geracao++; // descarta o que ainda chegar da vista anterior
  filaInterativa = [];
  info = null;
  atualizarControles();
  atualizarInfo();
  agendarUrl(historico);
  // Só mudou um parâmetro (iterações, precisão): a imagem atual fica até a nova chegar.
  agendarRender(40, !mesmaGeometria);
}

function centroTela() {
  return { x: largura / 2, y: altura / 2 };
}

function pontoNoCanvas(ev) {
  const r = el.tela.getBoundingClientRect();
  return { x: ((ev.clientX - r.left) * largura) / r.width, y: ((ev.clientY - r.top) * altura) / r.height };
}

function zoomCentro(fator) {
  const c = centroTela();
  navegar(E.zoomNoPonto(exibido, largura, altura, c.x, c.y, fator));
}

function vistaInicial(tipo) {
  const p = E.estadoPadrao(tipo);
  return { ...p, jr: estado.jr, ji: estado.ji, paleta: estado.paleta, densidade: estado.densidade, deslocamento: estado.deslocamento, log: estado.log, motor: estado.motor };
}

function escolherC(ponto) {
  const jr = Number(Number(ponto.re).toFixed(10));
  const ji = Number(Number(ponto.im).toFixed(10));
  escolhendoC = null;
  el.avisoEscolha.hidden = true;
  el.tela.classList.remove('escolhendo');
  navegar({ ...vistaInicial('julia'), jr, ji }, { historico: 'novo' });
  mostrarStatus(`c = ${jr} ${ji < 0 ? '-' : '+'} ${Math.abs(ji)}i`);
}

function cancelarEscolha() {
  if (!escolhendoC) return;
  const volta = escolhendoC;
  escolhendoC = null;
  el.avisoEscolha.hidden = true;
  el.tela.classList.remove('escolhendo');
  navegar(volta, { historico: 'novo' });
}

// Gestos com Pointer Events: arrastar, pinça com dois dedos e retângulo.
const ponteiros = new Map();
let gesto = null;

function mostrarSelecao(a, b) {
  const r = el.tela.getBoundingClientRect();
  const kx = r.width / largura;
  const ky = r.height / altura;
  Object.assign(el.selecao.style, {
    left: `${Math.min(a.x, b.x) * kx}px`,
    top: `${Math.min(a.y, b.y) * ky}px`,
    width: `${Math.abs(b.x - a.x) * kx}px`,
    height: `${Math.abs(b.y - a.y) * ky}px`,
  });
  el.selecao.hidden = false;
}

el.tela.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 && ev.pointerType === 'mouse') return;
  try {
    el.tela.setPointerCapture(ev.pointerId);
  } catch {
    // ponteiro já liberado: o gesto continua sem captura
  }
  const p = pontoNoCanvas(ev);
  ponteiros.set(ev.pointerId, p);
  if (ponteiros.size === 1) {
    const retangulo = ev.shiftKey || modoRetangulo;
    gesto = { tipo: retangulo ? 'retangulo' : 'arrastar', base: exibido, inicio: p, atual: null, alt: ev.altKey };
    if (!retangulo) salvarSnapshot();
  } else if (ponteiros.size === 2) {
    el.selecao.hidden = true;
    const [a, b] = [...ponteiros.values()];
    if (!gesto || gesto.tipo !== 'arrastar') salvarSnapshot();
    const base = gesto && gesto.tipo === 'arrastar' ? gesto.base : exibido;
    gesto = {
      tipo: 'pinca',
      base,
      d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      atual: null,
    };
  }
});

el.tela.addEventListener('pointermove', (ev) => {
  if (!ponteiros.has(ev.pointerId) || !gesto) return;
  const p = pontoNoCanvas(ev);
  ponteiros.set(ev.pointerId, p);
  if (gesto.tipo === 'arrastar') {
    const dx = p.x - gesto.inicio.x;
    const dy = p.y - gesto.inicio.y;
    if (Math.hypot(dx, dy) < 3 && !gesto.atual) return;
    gesto.atual = E.arrastar(gesto.base, largura, altura, dx, dy);
    desenharSnapshot(gesto.base, gesto.atual);
  } else if (gesto.tipo === 'pinca' && ponteiros.size >= 2) {
    const [a, b] = [...ponteiros.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let novo = E.zoomNoPonto(gesto.base, largura, altura, gesto.m0.x, gesto.m0.y, d / gesto.d0);
    novo = E.arrastar(novo, largura, altura, m.x - gesto.m0.x, m.y - gesto.m0.y);
    gesto.atual = novo;
    desenharSnapshot(gesto.base, novo);
  } else if (gesto.tipo === 'retangulo') {
    mostrarSelecao(gesto.inicio, p);
  }
});

function fimDoPonteiro(ev) {
  if (!ponteiros.has(ev.pointerId)) return;
  const p = pontoNoCanvas(ev);
  ponteiros.delete(ev.pointerId);
  if (!gesto) return;
  if (gesto.tipo === 'pinca') {
    if (ponteiros.size < 2) {
      const final = gesto.atual;
      gesto = null;
      if (final) navegar(final, { jaDesenhado: true });
    }
    return;
  }
  if (ponteiros.size > 0) return;
  const g = gesto;
  gesto = null;
  if (g.tipo === 'retangulo') {
    el.selecao.hidden = true;
    const w = Math.abs(p.x - g.inicio.x);
    const h = Math.abs(p.y - g.inicio.y);
    if (modoRetangulo) definirModoRetangulo(false);
    if (w > 6 && h > 6 && ev.type === 'pointerup') {
      navegar(E.zoomRetangulo(exibido, largura, altura, g.inicio.x, g.inicio.y, p.x, p.y), { historico: 'novo' });
    }
    return;
  }
  if (g.atual) {
    navegar(g.atual, { jaDesenhado: true });
    return;
  }
  // Clique simples: escolher c para a Julia (modo de escolha ou Alt + clique no Mandelbrot).
  if (ev.type === 'pointerup' && (escolhendoC || (g.alt && exibido.tipo === 'mandelbrot'))) {
    escolherC(E.pontoNaTela(exibido, largura, altura, p.x, p.y));
  }
}
el.tela.addEventListener('pointerup', fimDoPonteiro);
el.tela.addEventListener('pointercancel', fimDoPonteiro);

el.tela.addEventListener(
  'wheel',
  (ev) => {
    ev.preventDefault();
    const p = pontoNoCanvas(ev);
    let d = ev.deltaY;
    if (ev.deltaMode === 1) d *= 33;
    else if (ev.deltaMode === 2) d *= 400;
    const fator = Math.exp(-Math.max(-600, Math.min(600, d)) * 0.0022);
    navegar(E.zoomNoPonto(exibido, largura, altura, p.x, p.y, fator));
  },
  { passive: false },
);

el.tela.addEventListener('dblclick', (ev) => {
  const p = pontoNoCanvas(ev);
  navegar(E.zoomNoPonto(exibido, largura, altura, p.x, p.y, ev.shiftKey ? 0.5 : 2), { historico: 'novo' });
});

el.tela.addEventListener('keydown', (ev) => {
  const passo = 0.1;
  let novo = null;
  if (ev.key === 'ArrowLeft') novo = E.arrastar(exibido, largura, altura, largura * passo, 0);
  else if (ev.key === 'ArrowRight') novo = E.arrastar(exibido, largura, altura, -largura * passo, 0);
  else if (ev.key === 'ArrowUp') novo = E.arrastar(exibido, largura, altura, 0, altura * passo);
  else if (ev.key === 'ArrowDown') novo = E.arrastar(exibido, largura, altura, 0, -altura * passo);
  else if (ev.key === '+' || ev.key === '=') novo = E.zoomNoPonto(exibido, largura, altura, largura / 2, altura / 2, 1.5);
  else if (ev.key === '-' || ev.key === '_') novo = E.zoomNoPonto(exibido, largura, altura, largura / 2, altura / 2, 1 / 1.5);
  else if (ev.key === 'Escape') {
    cancelarEscolha();
    if (modoRetangulo) definirModoRetangulo(false);
    return;
  } else return;
  ev.preventDefault();
  navegar(novo);
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && escolhendoC) cancelarEscolha();
});

function definirModoRetangulo(ativo) {
  modoRetangulo = ativo;
  el.modoRetangulo.setAttribute('aria-pressed', String(ativo));
}

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------

el.fractal.addEventListener('change', () => {
  cancelarEscolhaSilencioso();
  navegar(vistaInicial(el.fractal.value), { historico: 'novo' });
});
el.inicio.addEventListener('click', () => navegar(vistaInicial(estado.tipo), { historico: 'novo' }));
el.voltar.addEventListener('click', () => history.back());
el.avancar.addEventListener('click', () => history.forward());
el.aproximar.addEventListener('click', () => zoomCentro(2));
el.afastar.addEventListener('click', () => zoomCentro(0.5));
el.modoRetangulo.addEventListener('click', () => definirModoRetangulo(!modoRetangulo));

el.iterAuto.addEventListener('change', () => {
  const iter = el.iterAuto.checked ? 0 : Math.max(10, Math.round(Number(el.iteracoes.value) || maxIteracoes(estado)));
  navegar({ ...estado, iter }, { historico: 'substituir', jaDesenhado: true });
});
el.iteracoes.addEventListener('change', () => {
  const v = Math.round(Number(el.iteracoes.value));
  if (!Number.isFinite(v) || v < 10 || v > 1000000) {
    mostrarStatus('Use entre 10 e 1.000.000 iterações.');
    return;
  }
  navegar({ ...estado, iter: v }, { historico: 'substituir', jaDesenhado: true });
});
el.motor.addEventListener('change', () => {
  navegar({ ...estado, motor: el.motor.value }, { historico: 'substituir', jaDesenhado: true });
});

function lerJulia() {
  const jr = Number(el.juliaRe.value);
  const ji = Number(el.juliaIm.value);
  if (!Number.isFinite(jr) || !Number.isFinite(ji) || Math.abs(jr) > 4 || Math.abs(ji) > 4) {
    mostrarStatus('O c da Julia precisa de partes real e imaginária entre -4 e 4.');
    return null;
  }
  return { jr, ji };
}
el.juliaAplicar.addEventListener('click', () => {
  const c = lerJulia();
  if (!c) return;
  const base = estado.tipo === 'julia' ? estado : vistaInicial('julia');
  navegar({ ...base, ...c }, { historico: 'novo' });
});
el.juliaEscolher.addEventListener('click', () => {
  escolhendoC = estado.tipo === 'julia' ? estado : vistaInicial('julia');
  el.avisoEscolha.hidden = false;
  el.tela.classList.add('escolhendo');
  if (estado.tipo !== 'mandelbrot') navegar(vistaInicial('mandelbrot'), { historico: 'novo' });
  el.tela.focus();
});
function cancelarEscolhaSilencioso() {
  escolhendoC = null;
  el.avisoEscolha.hidden = true;
  el.tela.classList.remove('escolhendo');
}

// ---------------------------------------------------------------------------
// Paleta
// ---------------------------------------------------------------------------

function gradienteCss(ps) {
  const partes = ps.map(([p, c]) => `${c} ${(p * 100).toFixed(2)}%`);
  partes.push(`${ps[0][1]} 100%`);
  return `linear-gradient(to right, ${partes.join(', ')})`;
}

function desenharParadas() {
  el.gradiente.style.background = gradienteCss(paradas);
  el.paradas.replaceChildren();
  paradas.forEach(([pos, cor], i) => {
    const li = document.createElement('li');
    const corInput = document.createElement('input');
    corInput.type = 'color';
    corInput.value = cor;
    corInput.setAttribute('aria-label', `Cor da parada ${i + 1}`);
    corInput.addEventListener('input', () => {
      paradas[i] = [paradas[i][0], corInput.value];
      definirParadas(paradas, true);
    });
    const posInput = document.createElement('input');
    posInput.type = 'range';
    posInput.min = '0';
    posInput.max = '0.999';
    posInput.step = '0.001';
    posInput.value = String(pos);
    posInput.setAttribute('aria-label', `Posição da parada ${i + 1}`);
    const saida = document.createElement('output');
    saida.textContent = `${Math.round(pos * 100)}%`;
    posInput.addEventListener('input', () => {
      saida.textContent = `${Math.round(Number(posInput.value) * 100)}%`;
      const copia = paradas.map((p) => [...p]);
      copia[i][0] = Number(posInput.value);
      aplicarParadas(copia);
    });
    posInput.addEventListener('change', () => definirParadas(paradas, true));
    const remover = document.createElement('button');
    remover.type = 'button';
    remover.className = 'btn secundario pequeno remover';
    remover.textContent = 'Remover';
    remover.disabled = paradas.length <= 2;
    remover.setAttribute('aria-label', `Remover a parada ${i + 1}`);
    remover.addEventListener('click', () => {
      definirParadas(paradas.filter((_, k) => k !== i), true);
    });
    li.append(corInput, posInput, saida, remover);
    el.paradas.append(li);
  });
}

// Aplica sem reconstruir a lista (enquanto o controle deslizante está sendo arrastado).
function aplicarParadas(ps) {
  const ok = PAL.normalizarParadas(ps);
  if (!ok) return;
  tabela = PAL.construirTabela(ok);
  el.gradiente.style.background = gradienteCss(ok);
  recolorirTudo();
}

function definirParadas(ps, gravar) {
  const ok = PAL.normalizarParadas(ps);
  if (!ok) return;
  paradas = ok;
  tabela = PAL.construirTabela(paradas);
  if (gravar) {
    const texto = PAL.serializarPaleta(paradas);
    const preset = Object.keys(PAL.PALETAS).find((id) => PAL.serializarPaleta(PAL.PALETAS[id].paradas) === texto);
    estado = { ...estado, paleta: preset || texto };
    exibido = { ...exibido, paleta: estado.paleta };
    agendarUrl('substituir');
  }
  el.paleta.value = PAL.PALETAS[estado.paleta] ? estado.paleta : 'personalizada';
  desenharParadas();
  recolorirTudo();
}

function preencherPaletas() {
  for (const [id, p] of Object.entries(PAL.PALETAS)) {
    const op = document.createElement('option');
    op.value = id;
    op.textContent = p.nome;
    el.paleta.append(op);
  }
  const op = document.createElement('option');
  op.value = 'personalizada';
  op.textContent = 'Personalizada';
  op.disabled = true;
  el.paleta.append(op);
}

el.paleta.addEventListener('change', () => {
  const id = el.paleta.value;
  if (!PAL.PALETAS[id]) return;
  definirParadas(PAL.PALETAS[id].paradas.map((p) => [...p]), true);
});
el.adicionarParada.addEventListener('click', () => {
  // Nova parada no meio do maior intervalo, com a cor que o gradiente já tem ali.
  let melhor = 0;
  let pos = 0.5;
  for (let i = 0; i < paradas.length; i++) {
    const a = paradas[i][0];
    const b = i + 1 < paradas.length ? paradas[i + 1][0] : paradas[0][0] + 1;
    if (b - a > melhor) {
      melhor = b - a;
      pos = (a + (b - a) / 2) % 1;
    }
  }
  const cor = PAL.rgbParaHex(PAL.corNaPaleta(paradas, pos));
  definirParadas([...paradas, [pos, cor]], true);
});
el.densidade.addEventListener('input', () => {
  const d = Number((2 ** Number(el.densidade.value)).toFixed(3));
  estado = { ...estado, densidade: d };
  el.densidadeValor.textContent = `${numero(d, 2)}x`;
  recolorirTudo();
  agendarUrl('substituir');
});
el.deslocamento.addEventListener('input', () => {
  estado = { ...estado, deslocamento: Number(el.deslocamento.value) };
  el.deslocamentoValor.textContent = numero(estado.deslocamento, 3);
  recolorirTudo();
  agendarUrl('substituir');
});
el.escalaLog.addEventListener('change', () => {
  estado = { ...estado, log: el.escalaLog.checked };
  recolorirTudo();
  agendarUrl('substituir');
});
el.corInterior.addEventListener('input', () => {
  corInterior = PAL.hexParaRgb(el.corInterior.value) || [0, 0, 0];
  gravarPreferencia('fractais.interior', el.corInterior.value);
  recolorirTudo();
});

// ---------------------------------------------------------------------------
// Exportação em PNG e link
// ---------------------------------------------------------------------------

let exportacao = null;

async function exportar() {
  if (exportacao || !workersOk) return;
  const [W, H] = el.tamanho.value.split('x').map(Number);
  gravarPreferencia('fractais.tamanho', el.tamanho.value);
  const e = estado;
  const g = -(proximoId++); // gerações negativas não colidem com as da tela
  const maxIter = maxIteracoes(e);
  const motor = escolherMotor(e.motor, e.raio, H, Number(e.cx), Number(e.cy));
  const P = E.bitsDaVista(e, H);
  const atual = { cancelado: false };
  exportacao = atual;
  el.exportar.disabled = true;
  el.cancelarExportacao.hidden = false;
  el.exportacaoProgresso.hidden = false;
  el.exportacaoProgresso.value = 0;
  el.exportacaoStatus.textContent = `Exportando ${W} x ${H}...`;
  let ref = null;
  let crit = null;
  if (motor === 'perturbacao') {
    const r = await obterReferencia(e, P, maxIter);
    ref = r.ref;
    crit = r.crit;
  }
  if (atual.cancelado) return;
  enviarParaTodos(configurarVista(e, g, W, H, maxIter, motor, P, ref, crit));
  const muExp = new Float32Array(W * H);
  const blocos = gerarBlocos(W, H, 128, 1);
  let feitos = 0;
  await new Promise((resolve) => {
    atual.resolver = resolve;
    filaExportacao = blocos.map((b) => ({
      msg: { tipo: 'bloco', id: proximoId++, geracao: g, ...b },
      aoTerminar: (m) => {
        if (atual.cancelado) return;
        for (let j = 0; j < m.h; j++) muExp.set(m.mu.subarray(j * m.w, (j + 1) * m.w), (m.y0 + j) * W + m.x0);
        feitos++;
        el.exportacaoProgresso.value = feitos / blocos.length;
        if (feitos === blocos.length) resolve();
      },
    }));
    despachar();
  });
  if (atual.cancelado) return;
  const tela = document.createElement('canvas');
  tela.width = W;
  tela.height = H;
  const c2 = tela.getContext('2d');
  const img = c2.createImageData(W, H);
  const n = tabela.length / 3;
  for (let i = 0; i < W * H; i++) {
    const v = muExp[i];
    const k = i * 4;
    if (v < 0) {
      img.data[k] = corInterior[0];
      img.data[k + 1] = corInterior[1];
      img.data[k + 2] = corInterior[2];
    } else {
      let t = PAL.posicaoCor(v, e.densidade, e.deslocamento, e.log);
      t -= Math.floor(t);
      const j = Math.min(n - 1, (t * n) | 0) * 3;
      img.data[k] = tabela[j];
      img.data[k + 1] = tabela[j + 1];
      img.data[k + 2] = tabela[j + 2];
    }
    img.data[k + 3] = 255;
  }
  c2.putImageData(img, 0, 0);
  tela.toBlob((blob) => {
    finalizarExportacao();
    if (!blob) {
      el.exportacaoStatus.textContent = 'O navegador não conseguiu gerar o PNG (tamanho grande demais?).';
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fractal-${e.tipo}-${W}x${H}.png`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    el.exportacaoStatus.textContent = `PNG de ${W} x ${H} pronto (${numero(blob.size / 1e6, 1)} MB).`;
  }, 'image/png');
}

function finalizarExportacao() {
  exportacao = null;
  filaExportacao = [];
  el.exportar.disabled = false;
  el.cancelarExportacao.hidden = true;
  el.exportacaoProgresso.hidden = true;
}

el.exportar.addEventListener('click', () => {
  exportar().catch((erro) => {
    finalizarExportacao();
    el.exportacaoStatus.textContent = 'Falha ao exportar: ' + erro.message;
  });
});
el.cancelarExportacao.addEventListener('click', () => {
  if (!exportacao) return;
  exportacao.cancelado = true;
  if (exportacao.resolver) exportacao.resolver();
  finalizarExportacao();
  el.exportacaoStatus.textContent = 'Exportação cancelada.';
});
el.copiarLink.addEventListener('click', async () => {
  clearTimeout(timerUrl);
  gravarUrl();
  try {
    await navigator.clipboard.writeText(location.href);
    el.exportacaoStatus.textContent = 'Link copiado. Quem abrir verá exatamente esta vista.';
  } catch {
    el.exportacaoStatus.textContent = 'Não deu para copiar automaticamente. O link está na barra de endereço.';
  }
});

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------

function iniciar() {
  preencherPaletas();
  const tamanho = lerPreferencia('fractais.tamanho', '1920x1080');
  if ([...el.tamanho.options].some((o) => o.value === tamanho)) el.tamanho.value = tamanho;
  el.corInterior.value = PAL.rgbParaHex(corInterior);
  try {
    history.replaceState({ i: 0 }, '', E.escreverHash(estado));
  } catch {
    // sem histórico, a navegação continua funcionando
  }
  atualizarBotoesHistorico();
  criarWorkers();
  ajustarTamanho();
  atualizarControles();
  atualizarInfo();
  agendarRender(0);
  new ResizeObserver(() => {
    if (ajustarTamanho()) {
      mu.fill(NaN);
      nivel.fill(0);
      agendarRender(120);
    }
  }).observe(el.moldura);
}

iniciar();
