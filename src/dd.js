// Aritmética double-double: um número é a soma não avaliada hi + lo de dois doubles,
// com |lo| <= meio ulp de hi. São uns 106 bits de mantissa (cerca de 32 dígitos), o
// bastante para ir além do zoom em que o double sozinho vira um mosaico de pixels.
//
// Os blocos básicos são transformações sem erro (error-free transformations): a soma e o
// produto de dois doubles podem ser escritos exatamente como resultado arredondado + erro.

const SPLITTER = 134217729; // 2^27 + 1, para dividir um double em duas metades de 26 bits

// Soma exata de Knuth: s + e == a + b exatamente.
export function twoSum(a, b) {
  const s = a + b;
  const bb = s - a;
  const e = (a - (s - bb)) + (b - bb);
  return [s, e];
}

// Versão mais barata, válida quando |a| >= |b|.
export function quickTwoSum(a, b) {
  const s = a + b;
  return [s, b - (s - a)];
}

// Divisão de Veltkamp: a == hi + lo, cada metade com no máximo 26 bits significativos.
export function split(a) {
  const t = SPLITTER * a;
  const hi = t - (t - a);
  return [hi, a - hi];
}

// Produto exato de Dekker: p + e == a * b exatamente (JavaScript não tem FMA).
export function twoProd(a, b) {
  const p = a * b;
  const [ah, al] = split(a);
  const [bh, bl] = split(b);
  const e = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
  return [p, e];
}

export function fromNumber(x) {
  return [x, 0];
}

export function toNumber(a) {
  return a[0] + a[1];
}

export function neg(a) {
  return [-a[0], -a[1]];
}

export function add(a, b) {
  let [s1, s2] = twoSum(a[0], b[0]);
  const [t1, t2] = twoSum(a[1], b[1]);
  s2 += t1;
  [s1, s2] = quickTwoSum(s1, s2);
  s2 += t2;
  return quickTwoSum(s1, s2);
}

export function sub(a, b) {
  return add(a, neg(b));
}

export function addNumber(a, x) {
  let [s1, s2] = twoSum(a[0], x);
  s2 += a[1];
  return quickTwoSum(s1, s2);
}

export function mul(a, b) {
  let [p1, p2] = twoProd(a[0], b[0]);
  p2 += a[0] * b[1] + a[1] * b[0];
  return quickTwoSum(p1, p2);
}

export function mulNumber(a, x) {
  let [p1, p2] = twoProd(a[0], x);
  p2 += a[1] * x;
  return quickTwoSum(p1, p2);
}

export function sqr(a) {
  let [p1, p2] = twoProd(a[0], a[0]);
  p2 += 2 * a[0] * a[1];
  p2 += a[1] * a[1];
  return quickTwoSum(p1, p2);
}

export function compare(a, b) {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  return 0;
}
