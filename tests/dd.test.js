import test from 'node:test';
import assert from 'node:assert/strict';
import * as DD from '../src/dd.js';
import * as BF from '../src/bigfixed.js';

// Gerador pseudoaleatório com semente (xorshift32), para testes reproduzíveis.
function gerador(semente) {
  let s = semente >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// Valor exato de um double-double como inteiro em escala 2^P.
const P = 1300;
const exato = (a) => BF.fromDouble(a[0], P) + BF.fromDouble(a[1], P);
const abs = (v) => (v < 0n ? -v : v);

function aleatorioDD(r) {
  const hi = (r() - 0.5) * 2 ** Math.floor(r() * 40 - 20);
  // lo abaixo de meio ulp de hi
  const lo = (r() - 0.5) * Math.abs(hi) * 2 ** -53;
  return DD.quickTwoSum(hi, lo);
}

test('twoSum e twoProd são exatos', () => {
  const r = gerador(1);
  for (let i = 0; i < 2000; i++) {
    const a = (r() - 0.5) * 2 ** Math.floor(r() * 60 - 30);
    const b = (r() - 0.5) * 2 ** Math.floor(r() * 60 - 30);
    const [s, e] = DD.twoSum(a, b);
    assert.equal(BF.fromDouble(s, P) + BF.fromDouble(e, P), BF.fromDouble(a, P) + BF.fromDouble(b, P));
    const [p, f] = DD.twoProd(a, b);
    // O produto exato precisa do dobro da escala.
    assert.equal(BF.fromDouble(p, 2 * P) + BF.fromDouble(f, 2 * P), BF.fromDouble(a, P) * BF.fromDouble(b, P));
  }
});

test('split divide em duas metades que somam o original', () => {
  for (const x of [Math.PI, -1 / 3, 1e300 / 7, 123456789.123]) {
    const [hi, lo] = DD.split(x);
    assert.equal(hi + lo, x);
    // cada metade tem no máximo 26 bits significativos: hi * 2^k é inteiro de até 2^26
    assert.ok(Math.abs(lo) <= Math.abs(x) * 2 ** -26);
  }
});

test('soma e produto double-double têm uns 104 bits de precisão', () => {
  const r = gerador(7);
  let falhasSoma = 0;
  let falhasProd = 0;
  for (let i = 0; i < 3000; i++) {
    const a = aleatorioDD(r);
    const b = aleatorioDD(r);
    // erro relativo <= 2^-k  <=>  |obtido - exato| * 2^k <= |exato|
    const soma = DD.add(a, b);
    const ve = exato(a) + exato(b);
    if (abs(exato(soma) - ve) << 103n > abs(ve)) falhasSoma++;
    const prod = DD.mul(a, b);
    const vp = exato(a) * exato(b); // escala 2^(2P)
    const obtido = BF.fromDouble(prod[0], 2 * P) + BF.fromDouble(prod[1], 2 * P);
    if (abs(obtido - vp) << 101n > abs(vp)) falhasProd++;
  }
  assert.equal(falhasSoma, 0);
  assert.equal(falhasProd, 0);
});

test('quadrado, subtração, produto por double e comparação', () => {
  // 3 vezes 0,333... (30 dígitos) fica a 1e-30 de 1: invisível em double, visível em double-double.
  const terco = BF.toDD(BF.parseDecimal('0.' + '3'.repeat(30), 400), 400);
  const quase = DD.mulNumber(terco, 3);
  const falta = DD.sub(DD.fromNumber(1), quase);
  assert.equal(DD.toNumber(quase), 1);
  assert.ok(falta[0] > 0 && Math.abs(falta[0] - 1e-30) < 1e-32, String(falta));
  const x = DD.add(DD.fromNumber(1), DD.fromNumber(2 ** -60));
  const q = DD.sqr(x); // 1 + 2^-59 + 2^-120
  assert.equal(q[0], 1);
  assert.equal(q[1], 2 ** -59);
  assert.deepEqual(DD.sub(x, x), [0, 0]);
  assert.deepEqual(DD.mulNumber(x, 2), [2, 2 ** -59]);
  assert.deepEqual(DD.addNumber(x, -1), [2 ** -60, 0]);
  assert.equal(DD.compare(x, DD.fromNumber(1)), 1);
  assert.equal(DD.compare(DD.fromNumber(1), x), -1);
  assert.equal(DD.compare(x, x), 0);
  assert.deepEqual(DD.neg(x), [-1, -(2 ** -60)]);
});

test('1/10 em double-double é muito mais fiel que em double', () => {
  // 0,1 não tem representação binária finita: o par (hi, lo) guarda o resto.
  const v = BF.parseDecimal('0.1', 400);
  const d = BF.toDD(v, 400);
  assert.equal(d[0], 0.1);
  assert.notEqual(d[1], 0);
  const erroDD = abs(BF.fromDouble(d[0], 400) + BF.fromDouble(d[1], 400) - v);
  const erroDouble = abs(BF.fromDouble(0.1, 400) - v);
  assert.ok(erroDD * 2n ** 50n < erroDouble);
});
