// Núcleo matemático: as quatro fórmulas, a iteração em double, em double-double e por
// perturbação, a órbita de referência em BigInt e a coloração suave. Sem DOM: é usado
// pelos Web Workers e pelos testes.
import * as BF from './bigfixed.js';

export const RAIO_FUGA = 256;
export const R2_FUGA = RAIO_FUGA * RAIO_FUGA;
const LOG_RAIO = Math.log(RAIO_FUGA);

export const TIPOS = ['mandelbrot', 'julia', 'burning-ship', 'tricorn'];

// Vista inicial de cada fractal. raio = metade da altura visível no plano complexo.
// O Burning Ship é desenhado com o eixo imaginário para baixo, como na literatura,
// para o "navio" aparecer em pé.
export const FRACTAIS = {
  mandelbrot: { nome: 'Mandelbrot', formula: 'z² + c', cx: '-0.6', cy: '0', raio: 1.25 },
  julia: { nome: 'Julia', formula: 'z² + c, com c fixo', cx: '0', cy: '0', raio: 1.6 },
  'burning-ship': {
    nome: 'Burning Ship',
    formula: '(|Re z| + i·|Im z|)² + c',
    cx: '-0.4',
    cy: '-0.55',
    raio: 1.3,
    eixoInvertido: true,
  },
  tricorn: { nome: 'Tricorn', formula: 'conj(z)² + c', cx: '-0.3', cy: '0', raio: 1.5 },
};

// ---------------------------------------------------------------------------
// Testes rápidos de interior do Mandelbrot
// ---------------------------------------------------------------------------

// Cardioide principal: q(q + (x - 1/4)) <= y²/4, com q = (x - 1/4)² + y².
export function naCardioide(x, y) {
  const xq = x - 0.25;
  const q = xq * xq + y * y;
  return q * (q + xq) <= 0.25 * y * y;
}

// Bulbo de período 2: disco de raio 1/4 centrado em -1.
export function noBulbo(x, y) {
  const xb = x + 1;
  return xb * xb + y * y <= 0.0625;
}

// ---------------------------------------------------------------------------
// Coloração suave
// ---------------------------------------------------------------------------

// Contagem normalizada de iterações: mu = n + 1 - log2(ln|z_n| / ln R).
// Vale n + 1 quando |z_n| = R e n quando |z_n| = R², então não dá saltos entre faixas.
export function suavizar(n, r2) {
  const mu = n + 1 - Math.log2((0.5 * Math.log(r2)) / LOG_RAIO);
  return mu > 0 ? mu : 0;
}

// ---------------------------------------------------------------------------
// Iteração em double
// ---------------------------------------------------------------------------

// Itera z -> f(z) + c a partir de z0. Devolve o índice n do primeiro z_n com
// |z_n|² > r2max, ou -1 se não escapar em maxIter passos. out[0] recebe |z_n|².
export function iterar(tipo, zx, zy, cx, cy, maxIter, r2max, out) {
  let x = zx;
  let y = zy;
  if (tipo === 'mandelbrot' || tipo === 'julia') {
    for (let n = 0; n < maxIter; n++) {
      const x2 = x * x;
      const y2 = y * y;
      if (x2 + y2 > r2max) {
        out[0] = x2 + y2;
        return n;
      }
      y = 2 * x * y + cy;
      x = x2 - y2 + cx;
    }
  } else if (tipo === 'tricorn') {
    for (let n = 0; n < maxIter; n++) {
      const x2 = x * x;
      const y2 = y * y;
      if (x2 + y2 > r2max) {
        out[0] = x2 + y2;
        return n;
      }
      y = -2 * x * y + cy;
      x = x2 - y2 + cx;
    }
  } else {
    for (let n = 0; n < maxIter; n++) {
      const x2 = x * x;
      const y2 = y * y;
      if (x2 + y2 > r2max) {
        out[0] = x2 + y2;
        return n;
      }
      y = 2 * Math.abs(x * y) + cy;
      x = x2 - y2 + cx;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Iteração em double-double (cerca de 32 dígitos)
// ---------------------------------------------------------------------------

const SPLITTER = 134217729;
let H = 0;
let L = 0;

function ddAdd(ah, al, bh, bl) {
  const s = ah + bh;
  const bb = s - ah;
  let e = (ah - (s - bb)) + (bh - bb);
  const t = al + bl;
  const tb = t - al;
  const f = (al - (t - tb)) + (bl - tb);
  e += t;
  const s2 = s + e;
  e = e - (s2 - s);
  e += f;
  H = s2 + e;
  L = e - (H - s2);
}

function ddMul(ah, al, bh, bl) {
  const p = ah * bh;
  let t = SPLITTER * ah;
  const ahh = t - (t - ah);
  const ahl = ah - ahh;
  t = SPLITTER * bh;
  const bhh = t - (t - bh);
  const bhl = bh - bhh;
  let e = ((ahh * bhh - p) + ahh * bhl + ahl * bhh) + ahl * bhl;
  e += ah * bl + al * bh;
  H = p + e;
  L = e - (H - p);
}

// Igual a iterar(), mas com z0 e c como pares double-double [hi, lo].
export function iterarDD(tipo, zx, zy, cx, cy, maxIter, r2max, out) {
  let xh = zx[0];
  let xl = zx[1];
  let yh = zy[0];
  let yl = zy[1];
  const [cxh, cxl] = cx;
  const [cyh, cyl] = cy;
  const fator = tipo === 'tricorn' ? -2 : 2;
  const absoluto = tipo === 'burning-ship';
  for (let n = 0; n < maxIter; n++) {
    ddMul(xh, xl, xh, xl);
    const x2h = H;
    const x2l = L;
    ddMul(yh, yl, yh, yl);
    const y2h = H;
    const y2l = L;
    const r2 = x2h + y2h;
    if (r2 > r2max) {
      out[0] = r2;
      return n;
    }
    ddMul(xh, xl, yh, yl);
    let xyh = H;
    let xyl = L;
    if (absoluto && xyh < 0) {
      xyh = -xyh;
      xyl = -xyl;
    }
    ddAdd(fator * xyh, fator * xyl, cyh, cyl); // multiplicar por 2 é exato
    const nyh = H;
    const nyl = L;
    ddAdd(x2h, x2l, -y2h, -y2l);
    ddAdd(H, L, cxh, cxl);
    xh = H;
    xl = L;
    yh = nyh;
    yl = nyl;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Precisão arbitrária com BigInt
// ---------------------------------------------------------------------------

// Bits de ponto fixo para um espaçamento de pixel: o bastante para o pixel e mais 64
// bits de folga para os erros que a iteração amplifica.
export function bitsPrecisao(espacamento) {
  return Math.max(64, Math.ceil(-Math.log2(espacamento)) + 64);
}

function passoBig(tipo, x, y, cx, cy, bp) {
  const xx = x * x;
  const yy = y * y;
  let xy = x * y;
  if (tipo === 'burning-ship' && xy < 0n) xy = -xy;
  if (tipo === 'tricorn') xy = -xy;
  return [((xx - yy) >> bp) + cx, ((xy << 1n) >> bp) + cy, xx + yy];
}

// Órbita de referência: itera em ponto fixo com P bits e guarda cada Z_n arredondado
// para double. Para Mandelbrot, Burning Ship e Tricorn começa em z0 = 0 com c = centro;
// para Julia começa no centro com c fixo. Para quando |Z_n|² passa de r2max (o Z_n que
// escapou fica guardado) ou em maxIter.
export function orbitaReferencia(tipo, z0x, z0y, cx, cy, P, maxIter, r2max = R2_FUGA) {
  const bp = BigInt(P);
  const limite = BigInt(Math.ceil(r2max)) << (2n * bp);
  const re = new Float64Array(maxIter + 1);
  const im = new Float64Array(maxIter + 1);
  let x = z0x;
  let y = z0y;
  let n = 0;
  for (;;) {
    re[n] = BF.toDouble(x, P);
    im[n] = BF.toDouble(y, P);
    if (n === maxIter) break;
    const [nx, ny, r2] = passoBig(tipo, x, y, cx, cy, bp);
    if (r2 > limite) break;
    x = nx;
    y = ny;
    n++;
  }
  return { re: re.slice(0, n + 1), im: im.slice(0, n + 1), length: n + 1 };
}

// Iteração direta em ponto fixo, sem atalhos: lenta, mas exata até os P bits. Serve de
// gabarito nos testes do zoom profundo.
export function iterarBig(tipo, zx, zy, cx, cy, P, maxIter, r2max = R2_FUGA) {
  const bp = BigInt(P);
  const limite = BigInt(Math.ceil(r2max)) << (2n * bp);
  let x = zx;
  let y = zy;
  for (let n = 0; n < maxIter; n++) {
    const [nx, ny, r2] = passoBig(tipo, x, y, cx, cy, bp);
    if (r2 > limite) return n;
    x = nx;
    y = ny;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Perturbação
// ---------------------------------------------------------------------------

// |c + d| - |c| sem cancelamento, para a dobra do valor absoluto no Burning Ship.
export function diffabs(c, d) {
  const cd = c + d;
  if (c >= 0) return cd >= 0 ? d : -(2 * c + d);
  return cd > 0 ? 2 * c + d : -d;
}

// Zoom profundo por perturbação. Cada pixel é escrito como z_n = Z_m + delta_n, onde
// Z é a órbita de referência (calculada uma vez, em alta precisão) e delta é pequeno o
// bastante para caber num double. No Mandelbrot:
//   delta' = 2·Z·delta + delta² + delta_c
// Quando |z| fica menor que |delta| (ou a referência acaba), o pixel é "rebaseado"
// (Zhuoran, 2021): delta passa a ser o próprio z e a referência recomeça do início.
// Para a Julia, o recomeço usa a órbita do ponto crítico 0 (crit), que é onde z passa.
//   d0x, d0y: delta inicial (Julia: pixel menos centro; demais: 0)
//   dcx, dcy: delta_c (demais: pixel menos centro; Julia: 0)
export function iterarPerturbado(tipo, d0x, d0y, dcx, dcy, ref, crit, maxIter, r2max, out) {
  let Zr = ref.re;
  let Zi = ref.im;
  let ultimo = ref.length - 1;
  let dx = d0x;
  let dy = d0y;
  let m = 0;
  for (let n = 0; n < maxIter; n++) {
    let X = Zr[m];
    let Y = Zi[m];
    const zx = X + dx;
    const zy = Y + dy;
    const r2 = zx * zx + zy * zy;
    if (r2 > r2max) {
      out[0] = r2;
      return n;
    }
    // Normas L1: os quadrados poderiam virar zero (underflow) nos zooms mais fundos.
    if (Math.abs(zx) + Math.abs(zy) < Math.abs(dx) + Math.abs(dy) || m === ultimo) {
      if (crit) {
        Zr = crit.re;
        Zi = crit.im;
        ultimo = crit.length - 1;
      }
      m = 0;
      X = Zr[0];
      Y = Zi[0];
      dx = zx - X;
      dy = zy - Y;
    }
    const a = dx;
    const b = dy;
    const nx = 2 * (X * a - Y * b) + a * a - b * b + dcx;
    if (tipo === 'mandelbrot' || tipo === 'julia') {
      dy = 2 * (X * b + Y * a + a * b) + dcy;
    } else if (tipo === 'tricorn') {
      dy = -2 * (X * b + Y * a + a * b) + dcy;
    } else {
      dy = 2 * diffabs(X * Y, X * b + a * Y + a * b) + dcy;
    }
    dx = nx;
    m++;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Iterações e motor automáticos
// ---------------------------------------------------------------------------

// Mais zoom pede mais iterações: perto da borda os pontos demoram mais para escapar.
export function iteracoesAutomaticas(raio, raioInicial = 1.5) {
  const profundidade = Math.max(0, Math.log10(raioInicial / raio));
  return Math.round(Math.min(200000, 250 + 60 * profundidade ** 1.25));
}

// double enquanto o pixel for bem maior que a precisão do double; depois, perturbação.
export function escolherMotor(preferido, raio, altura, cx, cy) {
  if (preferido && preferido !== 'auto') return preferido;
  const espacamento = (2 * raio) / altura;
  const escala = Math.max(1, Math.abs(cx), Math.abs(cy));
  return espacamento > 1e-13 * escala ? 'double' : 'perturbacao';
}

// Menor espaçamento de pixel (relativo à escala das coordenadas) em que cada motor
// ainda separa pixels vizinhos: o double tem 53 bits e o double-double, uns 106.
export const LIMITE_MOTOR = { double: 1e-15, dd: 1e-30 };
