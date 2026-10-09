import test from 'node:test';
import assert from 'node:assert/strict';
import * as BF from '../src/bigfixed.js';

test('lê e escreve decimais sem perder dígitos', () => {
  const P = 400;
  const casos = [
    '0.5',
    '-1.25',
    '3',
    '-0.7436438870371587047521915061147749993852',
    '0.000000000000000000000000000000123',
    '1.5',
  ];
  for (const c of casos) {
    const v = BF.parseDecimal(c, P);
    assert.equal(BF.formatDecimal(v, P, 60), c);
  }
  assert.equal(BF.formatDecimal(BF.parseDecimal('1e-30', P), P, 40), '0.000000000000000000000000000001');
  assert.equal(BF.formatDecimal(BF.parseDecimal('.5', P), P, 5), '0.5');
  assert.equal(BF.formatDecimal(BF.parseDecimal('+2.0', P), P, 5), '2');
  assert.equal(BF.formatDecimal(BF.parseDecimal('-12.5e1', P), P, 5), '-125');
});

test('rejeita texto inválido', () => {
  for (const t of ['', '-', '.', 'abc', '1.2.3', '1e', '1e999', '0x10', '1,5', ' ', '--1']) {
    assert.equal(BF.parseDecimal(t, 64), null, t);
  }
  assert.equal(BF.parseDecimal('9'.repeat(2001), 64), null);
});

test('arredonda ao formatar, inclusive com vai-um', () => {
  const P = 200;
  assert.equal(BF.formatDecimal(BF.parseDecimal('0.123456789', P), P, 5), '0.12346');
  assert.equal(BF.formatDecimal(BF.parseDecimal('0.9999996', P), P, 6), '1');
  assert.equal(BF.formatDecimal(BF.parseDecimal('-0.0000001', P), P, 3), '0');
  assert.equal(BF.formatDecimal(BF.parseDecimal('-2.5', P), P, 0), '-3');
  assert.equal(BF.formatDecimal(0n, P, 10), '0');
});

test('fromDouble é exato e toDouble devolve o mesmo double', () => {
  let s = 12345;
  const r = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 3000; i++) {
    const x = (r() - 0.5) * 2 ** Math.floor(r() * 400 - 300);
    for (const P of [1100, 1300]) {
      assert.equal(BF.toDouble(BF.fromDouble(x, P), P), x);
    }
  }
  assert.equal(BF.fromDouble(0.75, 1), 2n); // 1,5 arredonda para 2
  assert.equal(BF.fromDouble(-0.75, 1), -2n);
  assert.equal(BF.fromDouble(1, 0), 1n);
  assert.equal(BF.fromDouble(5e-324, 1074), 1n); // menor subnormal
  assert.throws(() => BF.fromDouble(Infinity, 10));
});

test('toDouble acima de 1000 bits: atalho e caminho exato concordam', () => {
  let s = 777;
  const r = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  for (const P of [1001, 1100, 1500]) {
    for (let i = 0; i < 500; i++) {
      // valores entre 2^-990 e 2^20 (faixa normal do double), com bits aleatórios até o fim
      const e = Math.floor(r() * 1010) - 990;
      let v = 0n;
      for (let k = 0; k < 6; k++) v = (v << 30n) | BigInt(Math.floor(r() * 2 ** 30));
      v = e + P - 180 >= 0 ? v << BigInt(e + P - 180) : v >> BigInt(180 - e - P);
      if (r() < 0.5) v = -v;
      const x = BF.toDouble(v, P);
      // confere com a conversão exata de ida: o erro tem que ser menor que meio ulp
      if (x !== 0 && Number.isFinite(x)) {
        const back = BF.fromDouble(x, P);
        const erro = back > v ? back - v : v - back;
        const ulp = BF.fromDouble(Math.abs(x) * 2 ** -52, P);
        assert.ok(erro * 2n <= ulp + 1n, `P=${P} e=${e}`);
      }
    }
  }
});

test('toDouble arredonda ao mais próximo, com empate para o par, acima de 1000 bits', () => {
  const P = 1200;
  const um = 1n << BigInt(P);
  const meioUlp = 1n << BigInt(P - 53); // metade do ulp de 1
  assert.equal(BF.toDouble(um + 1n, P), 1);
  assert.equal(BF.toDouble(um + meioUlp, P), 1); // empate: fica no par
  assert.equal(BF.toDouble(um + meioUlp + 1n, P), 1 + 2 ** -52); // passou da metade
  assert.equal(BF.toDouble(-(um + meioUlp + 1n), P), -(1 + 2 ** -52));
  assert.equal(BF.toDouble(1n << 200n, P), 2 ** -1000);
  assert.equal(BF.toDouble(1n, P), 0); // 2^-1200 está abaixo do menor double
  assert.equal(BF.toDouble(0n, P), 0);
});

test('bitLength, mul, rescale e ldexp', () => {
  assert.equal(BF.bitLength(1n), 1);
  assert.equal(BF.bitLength(255n), 8);
  assert.equal(BF.bitLength(256n), 9);
  assert.equal(BF.bitLength(-(1n << 100n)), 101);
  const P = 80;
  const a = BF.parseDecimal('1.5', P);
  const b = BF.parseDecimal('2.25', P);
  assert.equal(BF.formatDecimal(BF.mul(a, b, P), P, 10), '3.375');
  assert.equal(BF.rescale(a, P, P + 10), a << 10n);
  assert.equal(BF.rescale(a << 10n, P + 10, P), a);
  assert.equal(BF.ldexp(1, 1023), 2 ** 1023);
  assert.equal(BF.ldexp(2 ** -600, 1500), 2 ** 900);
  assert.equal(BF.ldexp(3, -1030), 3 * 2 ** -1030);
  assert.equal(BF.ldexp(2 ** 500, -1600), 0); // 2^-1100 está abaixo do menor subnormal
});

test('toDD guarda uns 106 bits de um decimal longo', () => {
  const P = 500;
  const v = BF.parseDecimal('-0.743643887037158704752191506114774', P);
  const [hi, lo] = BF.toDD(v, P);
  const back = BF.fromDouble(hi, P) + BF.fromDouble(lo, P);
  const erro = back > v ? back - v : v - back;
  assert.ok(erro < (1n << BigInt(P)) >> 105n);
  assert.ok(Math.abs(lo) <= Math.abs(hi) * 2 ** -52);
});
