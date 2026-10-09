// Web Worker: calcula blocos da imagem (contagem suave de iterações por pixel) e a
// órbita de referência do zoom profundo. Não toca no DOM.
import * as BF from './bigfixed.js';
import {
  R2_FUGA,
  iterar,
  iterarDD,
  iterarPerturbado,
  naCardioide,
  noBulbo,
  orbitaReferencia,
  suavizar,
} from './fractais.js';

const configs = new Map(); // geração -> configuração da vista na tela
let configExportacao = null; // a exportação usa gerações negativas e fica guardada à parte
const saida = new Float64Array(1);

function guardarConfig(c) {
  if (c.geracao < 0) {
    configExportacao = c;
    return;
  }
  configs.set(c.geracao, c);
  while (configs.size > 4) configs.delete(configs.keys().next().value);
}

function buscarConfig(geracao) {
  if (geracao < 0) return configExportacao && configExportacao.geracao === geracao ? configExportacao : null;
  return configs.get(geracao);
}

// Soma double-double + double, sem alocar.
function somaDD(par, x) {
  const s = par[0] + x;
  const bb = s - par[0];
  const e = (par[0] - (s - bb)) + (x - bb) + par[1];
  const hi = s + e;
  return [hi, e - (hi - s)];
}

// Valor suave de um pixel cujo deslocamento em relação ao centro é (dx, dy).
function calcularPixel(c, dx, dy) {
  const julia = c.fractal === 'julia';
  let n;
  if (c.motor === 'perturbacao') {
    n = julia
      ? iterarPerturbado('julia', dx, dy, 0, 0, c.ref, c.crit, c.maxIter, R2_FUGA, saida)
      : iterarPerturbado(c.fractal, 0, 0, dx, dy, c.ref, null, c.maxIter, R2_FUGA, saida);
  } else if (c.motor === 'dd') {
    const re = somaDD(c.cxDD, dx);
    const im = somaDD(c.cyDD, dy);
    if (julia) {
      n = iterarDD('julia', re, im, [c.jr, 0], [c.ji, 0], c.maxIter, R2_FUGA, saida);
    } else {
      if (c.fractal === 'mandelbrot' && (naCardioide(re[0], im[0]) || noBulbo(re[0], im[0]))) return -1;
      n = iterarDD(c.fractal, [0, 0], [0, 0], re, im, c.maxIter, R2_FUGA, saida);
    }
  } else {
    const re = c.cx + dx;
    const im = c.cy + dy;
    if (julia) {
      n = iterar('julia', re, im, c.jr, c.ji, c.maxIter, R2_FUGA, saida);
    } else {
      if (c.fractal === 'mandelbrot' && (naCardioide(re, im) || noBulbo(re, im))) return -1;
      n = iterar(c.fractal, 0, 0, re, im, c.maxIter, R2_FUGA, saida);
    }
  }
  return n < 0 ? -1 : suavizar(n, saida[0]);
}

function calcularBloco(c, m) {
  const passo = m.passo;
  const cols = Math.ceil(m.w / passo);
  const linhas = Math.ceil(m.h / passo);
  const mu = new Float32Array(cols * linhas);
  const limite = c.maxIter * 0.75;
  let escaparam = 0;
  let pertoDoLimite = 0;
  for (let j = 0; j < linhas; j++) {
    const py = m.y0 + j * passo + passo / 2;
    const dy = c.sinalY * (py - c.altura / 2) * c.espacamento;
    for (let i = 0; i < cols; i++) {
      const px = m.x0 + i * passo + passo / 2;
      const dx = (px - c.largura / 2) * c.espacamento;
      const v = calcularPixel(c, dx, dy);
      mu[j * cols + i] = v;
      if (v >= 0) {
        escaparam++;
        if (v > limite) pertoDoLimite++;
      }
    }
  }
  return { mu, escaparam, pertoDoLimite };
}

self.onmessage = (ev) => {
  const m = ev.data;
  if (m.tipo === 'config') {
    guardarConfig(m);
    return;
  }
  if (m.tipo === 'referencia') {
    const inicio = performance.now();
    const P = m.P;
    const cx = BF.parseDecimal(m.cx, P);
    const cy = BF.parseDecimal(m.cy, P);
    let ref;
    let crit = null;
    if (m.fractal === 'julia') {
      const jr = BF.fromDouble(m.jr, P);
      const ji = BF.fromDouble(m.ji, P);
      ref = orbitaReferencia('julia', cx, cy, jr, ji, P, m.maxIter);
      crit = orbitaReferencia('julia', 0n, 0n, jr, ji, P, m.maxIter);
    } else {
      ref = orbitaReferencia(m.fractal, 0n, 0n, cx, cy, P, m.maxIter);
    }
    const transferir = [ref.re.buffer, ref.im.buffer];
    if (crit) transferir.push(crit.re.buffer, crit.im.buffer);
    self.postMessage({ tipo: 'referencia', id: m.id, ref, crit, ms: performance.now() - inicio }, transferir);
    return;
  }
  if (m.tipo === 'bloco') {
    const c = buscarConfig(m.geracao);
    if (!c) {
      self.postMessage({ tipo: 'bloco', id: m.id, geracao: m.geracao, descartado: true });
      return;
    }
    const r = calcularBloco(c, m);
    self.postMessage(
      { tipo: 'bloco', id: m.id, geracao: m.geracao, x0: m.x0, y0: m.y0, w: m.w, h: m.h, passo: m.passo, ...r },
      [r.mu.buffer],
    );
  }
};
