import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../src/fractais.js';
import * as BF from '../src/bigfixed.js';

const out = new Float64Array(1);
const mandel = (cx, cy, maxIter = 1000, r2 = 4) => F.iterar('mandelbrot', 0, 0, cx, cy, maxIter, r2, out);

test('contagem de iterações em pontos conhecidos do Mandelbrot', () => {
  assert.equal(mandel(0, 0), -1); // centro da cardioide
  assert.equal(mandel(-1, 0), -1); // ciclo 0, -1, 0, -1
  assert.equal(mandel(-2, 0), -1); // 0, -2, 2, 2, 2... fica na borda
  assert.equal(mandel(0, 1), -1); // c = i: 0, i, -1 + i, -i, -1 + i... pré-periódico
  assert.equal(mandel(0.25, 0, 5000), -1); // ponta da cardioide: converge devagar para 1/2
  // c = 1: 0, 1, 2, 5, 26, 677. Com raio 2 escapa em z3; com raio 256, em z5.
  assert.equal(mandel(1, 0), 3);
  assert.equal(mandel(1, 0, 1000, F.R2_FUGA), 5);
  assert.equal(mandel(-2.1, 0), 1);
  assert.equal(mandel(2, 2), 1);
});

test('pi aparece no gargalo e na ponta do Mandelbrot', () => {
  // Dave Boll (1991): em c = -3/4 + i·e, o número de iterações até escapar vezes e
  // tende a pi. Em c = 1/4 + e, é o número de iterações vezes raiz(e).
  const n1 = mandel(-0.75, 1e-5, 1e7);
  assert.ok(Math.abs(n1 * 1e-5 - Math.PI) < 1e-4, String(n1));
  const n2 = mandel(0.25 + 1e-6, 0, 1e7);
  assert.ok(Math.abs(n2 * 1e-3 - Math.PI) < 0.01, String(n2));
});

test('testes da cardioide e do bulbo concordam com a iteração', () => {
  assert.ok(F.naCardioide(0, 0));
  assert.ok(F.naCardioide(-0.5, 0));
  assert.ok(F.naCardioide(0.2, 0));
  assert.ok(F.naCardioide(-0.75, 0)); // ponto onde a cardioide encosta no bulbo
  assert.ok(!F.naCardioide(0.3, 0));
  assert.ok(!F.naCardioide(-1, 0));
  assert.ok(F.noBulbo(-1, 0));
  assert.ok(F.noBulbo(-1.25, 0)); // borda do bulbo
  assert.ok(!F.noBulbo(-1.3, 0));
  assert.ok(!F.noBulbo(-0.5, 0.5));
  // Todo ponto marcado como interior não pode escapar.
  let marcados = 0;
  for (let i = 0; i <= 200; i++) {
    for (let j = 0; j <= 100; j++) {
      const x = -2 + (2.5 * i) / 200;
      const y = (1.2 * j) / 100;
      if (F.naCardioide(x, y) || F.noBulbo(x, y)) {
        marcados++;
        assert.equal(mandel(x, y, 3000, F.R2_FUGA), -1, `${x}, ${y}`);
      }
    }
  }
  assert.ok(marcados > 2500, String(marcados));
});

test('fórmula de suavização: vale n + 1 em |z| = R e n em |z| = R²', () => {
  assert.equal(F.suavizar(5, F.R2_FUGA), 6);
  assert.ok(Math.abs(F.suavizar(5, F.R2_FUGA ** 2) - 5) < 1e-12);
  assert.ok(F.suavizar(5, F.R2_FUGA * 10) < 6 && F.suavizar(5, F.R2_FUGA * 10) > 5);
  assert.equal(F.suavizar(0, 1e300), 0); // nunca negativo
});

test('a contagem suave é contínua onde a inteira dá saltos', () => {
  // Ao longo do eixo real fora do conjunto, n salta de 1 em 1; mu varia suavemente.
  let saltoInteiro = 0;
  let maiorSalto = 0;
  let anterior = null;
  for (let k = 0; k <= 4000; k++) {
    const c = 0.5 + (1.5 * k) / 4000;
    const n = F.iterar('mandelbrot', 0, 0, c, 0, 1000, F.R2_FUGA, out);
    const mu = F.suavizar(n, out[0]);
    if (anterior) {
      saltoInteiro = Math.max(saltoInteiro, Math.abs(n - anterior.n));
      maiorSalto = Math.max(maiorSalto, Math.abs(mu - anterior.mu));
    }
    anterior = { n, mu };
  }
  assert.equal(saltoInteiro, 1);
  assert.ok(maiorSalto < 0.02, String(maiorSalto));
});

test('as quatro fórmulas em double', () => {
  // Julia com c = 0: o disco unitário. Dentro não escapa; fora escapa.
  assert.equal(F.iterar('julia', 0.5, 0.5, 0, 0, 500, 4, out), -1);
  assert.ok(F.iterar('julia', 1.1, 0, 0, 0, 500, 4, out) > 0);
  // Tricorn: z' = conj(z)² + c. Com c = i: 0, i, -1 + i, -i... (igual ao Mandelbrot aqui? não)
  // 0 -> i -> conj(i)² + i = -1 + i -> conj(-1 + i)² + i = (-1 - i)² + i = 3i
  assert.equal(F.iterar('tricorn', 0, 0, 0, 1, 100, 4, out), 3);
  // Burning Ship: z' = (|x| + i|y|)² + c. Com c = -1 + i: 0 -> -1 + i -> (1 + i)² - 1 + i
  // = -1 + 3i -> |z|² = 10 > 4 no índice 2.
  assert.equal(F.iterar('burning-ship', 0, 0, -1, 1, 100, 4, out), 2);
  // Simetrias: Mandelbrot e Tricorn são simétricos em relação ao eixo real.
  for (const [x, y] of [[-0.7, 0.3], [0.3, 0.55], [-1.3, 0.07]]) {
    const a = F.iterar('mandelbrot', 0, 0, x, y, 2000, F.R2_FUGA, out);
    const b = F.iterar('mandelbrot', 0, 0, x, -y, 2000, F.R2_FUGA, out);
    assert.equal(a, b);
    const c = F.iterar('tricorn', 0, 0, x, y, 2000, F.R2_FUGA, out);
    const d = F.iterar('tricorn', 0, 0, x, -y, 2000, F.R2_FUGA, out);
    assert.equal(c, d);
  }
});

test('double-double concorda com double numa vista rasa', () => {
  let s = 99;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let iguais = 0;
  const total = 2000;
  for (let i = 0; i < total; i++) {
    const tipo = F.TIPOS[i % 4];
    const x = -2 + 2.5 * r();
    const y = -1.2 + 2.4 * r();
    let a;
    let b;
    if (tipo === 'julia') {
      a = F.iterar('julia', x, y, -0.4, 0.6, 500, F.R2_FUGA, out);
      b = F.iterarDD('julia', [x, 0], [y, 0], [-0.4, 0], [0.6, 0], 500, F.R2_FUGA, out);
    } else {
      a = F.iterar(tipo, 0, 0, x, y, 500, F.R2_FUGA, out);
      b = F.iterarDD(tipo, [0, 0], [0, 0], [x, 0], [y, 0], 500, F.R2_FUGA, out);
    }
    if (a === b) iguais++;
  }
  // Só pontos caóticos colados na borda podem divergir.
  assert.ok(iguais / total > 0.99, String(iguais));
});

test('órbita de referência em BigInt', () => {
  const P = 128;
  const um = 1n << 128n;
  const ciclo = F.orbitaReferencia('mandelbrot', 0n, 0n, -um, 0n, P, 10);
  assert.deepEqual(Array.from(ciclo.re), [0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0]);
  assert.equal(ciclo.length, 11);
  const fuga = F.orbitaReferencia('mandelbrot', 0n, 0n, um, 0n, P, 100);
  assert.deepEqual(Array.from(fuga.re), [0, 1, 2, 5, 26, 677]); // guarda o valor que escapou
  assert.equal(F.iterarBig('mandelbrot', 0n, 0n, um, 0n, P, 100), 5);
  assert.equal(F.iterarBig('mandelbrot', 0n, 0n, -um, 0n, P, 100), -1);
  assert.equal(F.bitsPrecisao(1e-20), Math.ceil(20 * Math.log2(10)) + 64);
  assert.equal(F.bitsPrecisao(0.1), 68);
  assert.equal(F.bitsPrecisao(4), 64);
});

test('diffabs calcula |c + d| - |c| sem cancelamento', () => {
  for (const [c, d] of [[3, 1], [3, -1], [3, -5], [-3, 1], [-3, 5], [-3, -1], [0, 2], [0, -2], [1e20, 1e-10]]) {
    const esperado = Math.abs(c + d) - Math.abs(c);
    if (Math.abs(c) < 1e10) assert.equal(F.diffabs(c, d), esperado);
  }
  // Onde a conta ingênua perde tudo (|c| enorme), diffabs mantém o valor pequeno.
  assert.equal(F.diffabs(1e20, 1e-10), 1e-10);
  assert.equal(F.diffabs(-1e20, -1e-10), 1e-10);
});

// ---------------------------------------------------------------------------
// Zoom profundo: perturbação contra cálculo direto em BigInt
// ---------------------------------------------------------------------------

// Bisseção em BigInt entre um ponto que não escapa e um que escapa: devolve os dois
// extremos finais, colados na borda do conjunto (para maxIter iterações).
function borda(tipo, dentro, fora, P, maxIter, jc) {
  const fuga = (p) =>
    tipo === 'julia'
      ? F.iterarBig('julia', p[0], p[1], jc[0], jc[1], P, maxIter)
      : F.iterarBig(tipo, 0n, 0n, p[0], p[1], P, maxIter);
  let a = dentro;
  let b = fora;
  assert.equal(fuga(a), -1);
  assert.ok(fuga(b) >= 0);
  for (let k = 0; k < 75; k++) {
    const m = [(a[0] + b[0]) >> 1n, (a[1] + b[1]) >> 1n];
    if (fuga(m) < 0) a = m;
    else b = m;
  }
  return [a, b];
}

// Compara uma grade de pixels: perturbação (double + referência) contra BigInt direto.
function comparar(tipo, centro, raio, P, maxIter, jc) {
  const L = 12;
  const A = 10;
  const esp = (2 * raio) / A;
  let ref;
  let crit = null;
  if (tipo === 'julia') {
    ref = F.orbitaReferencia('julia', centro[0], centro[1], jc[0], jc[1], P, maxIter);
    crit = F.orbitaReferencia('julia', 0n, 0n, jc[0], jc[1], P, maxIter);
  } else {
    ref = F.orbitaReferencia(tipo, 0n, 0n, centro[0], centro[1], P, maxIter);
  }
  const res = { iguais: 0, total: 0, maxDif: 0, escaparam: 0, contagens: new Set() };
  for (let j = 0; j < A; j++) {
    for (let i = 0; i < L; i++) {
      const dx = (i + 0.5 - L / 2) * esp;
      const dy = (j + 0.5 - A / 2) * esp;
      const px = centro[0] + BF.fromDouble(dx, P);
      const py = centro[1] + BF.fromDouble(dy, P);
      let nBig;
      let nPert;
      if (tipo === 'julia') {
        nBig = F.iterarBig('julia', px, py, jc[0], jc[1], P, maxIter);
        nPert = F.iterarPerturbado('julia', dx, dy, 0, 0, ref, crit, maxIter, F.R2_FUGA, out);
      } else {
        nBig = F.iterarBig(tipo, 0n, 0n, px, py, P, maxIter);
        nPert = F.iterarPerturbado(tipo, 0, 0, dx, dy, ref, null, maxIter, F.R2_FUGA, out);
      }
      res.total++;
      if (nBig === nPert) res.iguais++;
      if (nBig >= 0) res.escaparam++;
      res.contagens.add(nBig);
      const dif = nBig < 0 || nPert < 0 ? (nBig === nPert ? 0 : Infinity) : Math.abs(nBig - nPert);
      res.maxDif = Math.max(res.maxDif, dif);
    }
  }
  return res;
}

// No Burning Ship as órbitas longas perto da borda são caóticas: um erro de arredondamento
// cresce até virar a própria resposta, e nem o BigInt com 64 bits de folga concorda com
// outro de 464 bits. Por isso ali o teste usa até 300 iterações, onde a verdade é estável.
const casosProfundos = [
  { tipo: 'mandelbrot', dentro: ['-0.74', '0.03'], fora: ['-0.74', '0.2'], maxIter: 1500 },
  { tipo: 'mandelbrot', dentro: ['-1.3', '0'], fora: ['-1.3', '0.2'], maxIter: 1500 },
  { tipo: 'burning-ship', dentro: ['0', '0'], fora: ['0.9', '0.3'], maxIter: 300 },
  { tipo: 'tricorn', dentro: ['0', '0'], fora: ['0.4', '0.9'], maxIter: 1500 },
  { tipo: 'julia', dentro: ['0', '0'], fora: ['0.9', '0.9'], jc: ['-0.123', '0.745'], maxIter: 1500 },
];

for (const caso of casosProfundos) {
  test(`zoom profundo (raio 1e-20) no ${caso.tipo} perto de ${caso.fora}: perturbação = BigInt direto`, () => {
    const raio = 1e-20;
    const maxIter = caso.maxIter;
    const P = F.bitsPrecisao(raio / 10);
    const big = (p) => [BF.parseDecimal(p[0], P), BF.parseDecimal(p[1], P)];
    const jc = caso.jc ? big(caso.jc) : null;
    const [dentro, fora] = borda(caso.tipo, big(caso.dentro), big(caso.fora), P, maxIter, jc);
    // Centro do lado de dentro: referência longa. Centro do lado de fora: a referência
    // escapa antes de muitos pixels e o rebase entra em ação.
    for (const centro of [dentro, fora]) {
      const r = comparar(caso.tipo, centro, raio, P, maxIter, jc);
      assert.ok(r.contagens.size > 5, `vista sem detalhe: ${[...r.contagens]}`);
      assert.ok(r.iguais / r.total >= 0.98, `${r.iguais}/${r.total}`);
      assert.ok(r.maxDif <= 1, `diferença máxima ${r.maxDif}`);
    }
  });
}

// Perto de um ponto de Misiurewicz (c = i: 0, i, -1 + i, -i, -1 + i...) o conjunto tem
// detalhe em todas as escalas com poucas iterações, então dá para ir até o fundo.
for (const raio of [1e-100, 1e-250, 1e-300]) {
  for (const tipo of ['mandelbrot', 'julia']) {
    test(`zoom extremo (raio ${raio}) no ${tipo} em torno de i: perturbação = BigInt direto`, () => {
      const P = F.bitsPrecisao(raio / 5);
      const um = 1n << BigInt(P);
      const jc = [0n, um];
      const r = comparar(tipo, [0n, um], raio, P, 3000, jc);
      assert.ok(r.contagens.size > 8, String([...r.contagens]));
      assert.equal(r.iguais, r.total);
    });
  }
}

test('double-double direto também acerta em 1e-20, e o double sozinho não', () => {
  const P = 200;
  const maxIter = 1500;
  const big = (p) => [BF.parseDecimal(p[0], P), BF.parseDecimal(p[1], P)];
  const [centro] = borda('mandelbrot', big(['-0.74', '0.03']), big(['-0.74', '0.2']), P, maxIter, null);
  const raio = 1e-20;
  const esp = raio / 5;
  let iguaisDD = 0;
  let iguaisDouble = 0;
  let total = 0;
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      const px = centro[0] + BF.fromDouble((i - 3.5) * esp, P);
      const py = centro[1] + BF.fromDouble((j - 3.5) * esp, P);
      const nBig = F.iterarBig('mandelbrot', 0n, 0n, px, py, P, maxIter);
      const nDD = F.iterarDD('mandelbrot', [0, 0], [0, 0], BF.toDD(px, P), BF.toDD(py, P), maxIter, F.R2_FUGA, out);
      const nDouble = F.iterar('mandelbrot', 0, 0, BF.toDouble(px, P), BF.toDouble(py, P), maxIter, F.R2_FUGA, out);
      total++;
      if (nDD === nBig) iguaisDD++;
      if (nDouble === nBig) iguaisDouble++;
    }
  }
  assert.ok(iguaisDD / total >= 0.95, `${iguaisDD}/${total}`);
  // Em double, os 64 pixels caem em pouquíssimos valores distintos: a imagem vira blocos.
  assert.ok(iguaisDouble < iguaisDD, `${iguaisDouble} vs ${iguaisDD}`);
});

test('iterações e motor automáticos', () => {
  assert.equal(F.iteracoesAutomaticas(1.5), 250);
  let anterior = 0;
  for (let e = 0; e <= 290; e += 10) {
    const it = F.iteracoesAutomaticas(1.5 * 10 ** -e);
    assert.ok(it >= anterior);
    anterior = it;
  }
  assert.ok(F.iteracoesAutomaticas(1e-290) <= 200000);
  assert.equal(F.escolherMotor('auto', 1.25, 800, -0.6, 0), 'double');
  assert.equal(F.escolherMotor('auto', 1e-12, 800, -0.6, 0), 'perturbacao');
  assert.equal(F.escolherMotor('dd', 1.25, 800, -0.6, 0), 'dd');
});
