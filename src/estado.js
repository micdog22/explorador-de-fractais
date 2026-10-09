// Estado da vista (fractal, centro em alta precisão, raio, cores) e a URL que o guarda.
// O centro fica como texto decimal: um double não chega perto dos dígitos que um zoom
// profundo exige. As contas de navegação passam por ponto fixo com BigInt.
import * as BF from './bigfixed.js';
import { FRACTAIS, TIPOS } from './fractais.js';
import { PALETAS, lerPaleta } from './paletas.js';

export const RAIO_MIN = 1e-300;
export const RAIO_MAX = 8;
export const MOTORES = ['auto', 'double', 'dd', 'perturbacao'];

export function estadoPadrao(tipo = 'mandelbrot') {
  const f = FRACTAIS[tipo] || FRACTAIS.mandelbrot;
  return {
    tipo: FRACTAIS[tipo] ? tipo : 'mandelbrot',
    cx: f.cx,
    cy: f.cy,
    raio: f.raio,
    jr: -0.8,
    ji: 0.156,
    iter: 0, // 0 = automático
    motor: 'auto',
    paleta: 'classica',
    densidade: 1,
    deslocamento: 0,
    log: false,
  };
}

// Dígitos decimais suficientes para o centro num certo raio (com folga).
export function digitosParaRaio(raio) {
  return Math.max(6, Math.ceil(-Math.log10(raio)) + 8);
}

function numeroEm(texto, min, max) {
  if (texto === null || texto.trim() === '') return null;
  const v = Number(texto);
  return Number.isFinite(v) && v >= min && v <= max ? v : null;
}

function decimalValido(texto) {
  if (texto === null) return null;
  const t = texto.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) || t.length > 1200) return null;
  if (Math.abs(Number(t)) > 4) return null;
  return t.replace(/^\+/, '');
}

export function lerHash(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const tipo = TIPOS.includes(p.get('f')) ? p.get('f') : 'mandelbrot';
  const e = estadoPadrao(tipo);
  const x = decimalValido(p.get('x'));
  const y = decimalValido(p.get('y'));
  if (x !== null && y !== null) {
    e.cx = x;
    e.cy = y;
  }
  const r = numeroEm(p.get('r'), RAIO_MIN, RAIO_MAX);
  if (r !== null) e.raio = r;
  const jr = numeroEm(p.get('cr'), -4, 4);
  const ji = numeroEm(p.get('ci'), -4, 4);
  if (jr !== null && ji !== null) {
    e.jr = jr;
    e.ji = ji;
  }
  const it = numeroEm(p.get('it'), 10, 1000000);
  if (it !== null) e.iter = Math.round(it);
  if (MOTORES.includes(p.get('m'))) e.motor = p.get('m');
  const pal = p.get('p');
  if (pal !== null && lerPaleta(pal)) e.paleta = pal;
  const d = numeroEm(p.get('d'), 0.05, 20);
  if (d !== null) e.densidade = d;
  const o = numeroEm(p.get('o'), 0, 1);
  if (o !== null) e.deslocamento = o;
  e.log = p.get('l') === '1';
  return e;
}

export function escreverHash(e) {
  const p = new URLSearchParams();
  p.set('f', e.tipo);
  p.set('x', e.cx);
  p.set('y', e.cy);
  p.set('r', String(Number(e.raio.toPrecision(6))));
  if (e.tipo === 'julia') {
    p.set('cr', String(e.jr));
    p.set('ci', String(e.ji));
  }
  if (e.iter) p.set('it', String(e.iter));
  if (e.motor !== 'auto') p.set('m', e.motor);
  if (e.paleta !== 'classica') p.set('p', e.paleta);
  if (e.densidade !== 1) p.set('d', String(e.densidade));
  if (e.deslocamento !== 0) p.set('o', String(e.deslocamento));
  if (e.log) p.set('l', '1');
  return '#' + p.toString();
}

export function paradasDoEstado(e) {
  return lerPaleta(e.paleta) || PALETAS.classica.paradas.map((p) => [...p]);
}

// ---------------------------------------------------------------------------
// Geometria da vista
// ---------------------------------------------------------------------------

// No Burning Ship o eixo imaginário cresce para baixo; nos outros, para cima.
export function sinalY(tipo) {
  return FRACTAIS[tipo] && FRACTAIS[tipo].eixoInvertido ? 1 : -1;
}

export function espacamento(e, altura) {
  return (2 * e.raio) / altura;
}

export function bitsDaVista(e, altura) {
  return Math.max(64, Math.ceil(-Math.log2(espacamento(e, altura))) + 64);
}

export function centroFixo(e, P) {
  return { x: BF.parseDecimal(e.cx, P), y: BF.parseDecimal(e.cy, P) };
}

// Diferença (em unidades do plano) entre o ponto (px, py) da tela e o centro.
export function deslocamentoTela(e, largura, altura, px, py) {
  const esp = espacamento(e, altura);
  return { dx: (px - largura / 2) * esp, dy: sinalY(e.tipo) * (py - altura / 2) * esp };
}

// Soma (dx, dy) ao centro em ponto fixo e regrava o texto com dígitos suficientes.
export function moverCentro(e, dx, dy, altura) {
  const P = bitsDaVista(e, altura) + 16;
  const c = centroFixo(e, P);
  const nx = c.x + BF.fromDouble(dx, P);
  const ny = c.y + BF.fromDouble(dy, P);
  const dig = digitosParaRaio(e.raio);
  return { ...e, cx: BF.formatDecimal(nx, P, dig), cy: BF.formatDecimal(ny, P, dig) };
}

function limitarRaio(r) {
  return Math.min(Math.max(r, RAIO_MIN), RAIO_MAX);
}

// Zoom por um fator mantendo parado o ponto do plano que está sob (px, py).
export function zoomNoPonto(e, largura, altura, px, py, fator) {
  const novoRaio = limitarRaio(e.raio / fator);
  const real = e.raio / novoRaio;
  const { dx, dy } = deslocamentoTela(e, largura, altura, px, py);
  const k = 1 - 1 / real;
  return moverCentro({ ...e, raio: novoRaio }, dx * k, dy * k, altura);
}

// O retângulo (x0, y0)-(x1, y1) da tela passa a ocupar a vista inteira.
export function zoomRetangulo(e, largura, altura, x0, y0, x1, y1) {
  const { dx, dy } = deslocamentoTela(e, largura, altura, (x0 + x1) / 2, (y0 + y1) / 2);
  const esp = espacamento(e, altura);
  const meiaAltura = (Math.max(Math.abs(y1 - y0), (Math.abs(x1 - x0) * altura) / largura) * esp) / 2;
  return moverCentro({ ...e, raio: limitarRaio(meiaAltura) }, dx, dy, altura);
}

// Arrastar a imagem (dxPix, dyPix) pixels move o centro no sentido contrário.
export function arrastar(e, largura, altura, dxPix, dyPix) {
  const esp = espacamento(e, altura);
  return moverCentro(e, -dxPix * esp, -sinalY(e.tipo) * dyPix * esp, altura);
}

// Ponto do plano sob (px, py), como texto decimal.
export function pontoNaTela(e, largura, altura, px, py) {
  const { dx, dy } = deslocamentoTela(e, largura, altura, px, py);
  const m = moverCentro(e, dx, dy, altura);
  return { re: m.cx, im: m.cy };
}

// "2,4 × 10^15" para o zoom em relação à vista inicial.
export function formatarZoom(e) {
  const base = (FRACTAIS[e.tipo] || FRACTAIS.mandelbrot).raio;
  const z = base / e.raio;
  if (z < 1e4) return z.toLocaleString('pt-BR', { maximumFractionDigits: z < 10 ? 2 : 0 }) + '×';
  let exp = Math.floor(Math.log10(z));
  let mant = z / 10 ** exp;
  if (Number(mant.toFixed(1)) >= 10) {
    mant /= 10;
    exp += 1;
  }
  return `${mant.toFixed(1).replace('.', ',')} × 10^${exp}`;
}
