// Ponto fixo binário com BigInt: o inteiro v representa o número real v / 2^P.
// É a precisão arbitrária usada para guardar o centro da vista e calcular a órbita de
// referência do zoom profundo. P cresce com o zoom: cada fator 2 de zoom pede mais um bit.

const MAX_DIGITOS = 2000;
const MAX_EXPOENTE = 400;
const LIMITE_RAPIDO = 1n << 1000n;
const MIN_ATALHO = 1n << 54n;

// Converte texto decimal ("-0.7436", "1e-30", ".5") para ponto fixo, arredondando.
// Devolve null se o texto não for um número válido.
export function parseDecimal(texto, P) {
  if (typeof texto !== 'string') return null;
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(texto.trim());
  if (!m) return null;
  const inteira = m[2] || '';
  const fracao = m[3] || '';
  if (!inteira && !fracao) return null;
  if (inteira.length + fracao.length > MAX_DIGITOS) return null;
  const expoente = m[4] ? Number(m[4]) : 0;
  if (!Number.isFinite(expoente) || Math.abs(expoente) > MAX_EXPOENTE) return null;
  const N = BigInt((inteira + fracao) || '0');
  const e10 = expoente - fracao.length;
  const bp = BigInt(P);
  let v;
  if (e10 >= 0) {
    v = (N * 10n ** BigInt(e10)) << bp;
  } else {
    const den = 10n ** BigInt(-e10);
    v = ((N << bp) + den / 2n) / den;
  }
  return m[1] === '-' ? -v : v;
}

// Formata com no máximo `digitos` casas decimais (arredondando), sem zeros sobrando.
export function formatDecimal(v, P, digitos) {
  const negativo = v < 0n;
  const a = negativo ? -v : v;
  const bp = BigInt(P);
  let inteira = a >> bp;
  const resto = a - (inteira << bp);
  const escala = 10n ** BigInt(digitos);
  let f = P > 0 ? (resto * escala + (1n << (bp - 1n))) >> bp : 0n;
  if (f >= escala) {
    inteira += 1n;
    f -= escala;
  }
  let s = inteira.toString();
  if (digitos > 0 && f !== 0n) {
    s += '.' + f.toString().padStart(digitos, '0').replace(/0+$/, '');
  }
  if (negativo && (inteira !== 0n || f !== 0n)) s = '-' + s;
  return s;
}

// Conversão exata de um double (arredonda só se o double tiver bits abaixo de 2^-P).
export function fromDouble(x, P) {
  if (!Number.isFinite(x)) throw new RangeError('número não finito');
  if (x === 0) return 0n;
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e;
  if (exp === 0) {
    e = -1074; // subnormal
  } else {
    mant |= 1n << 52n;
    e = exp - 1075;
  }
  const deslocamento = e + P;
  let v;
  if (deslocamento >= 0) {
    v = mant << BigInt(deslocamento);
  } else {
    const s = BigInt(-deslocamento);
    v = (mant + (1n << (s - 1n))) >> s;
  }
  return hi >>> 31 ? -v : v;
}

export function bitLength(a) {
  if (a < 0n) a = -a;
  if (a === 0n) return 0;
  const h = a.toString(16);
  return (h.length - 1) * 4 + (32 - Math.clz32(parseInt(h[0], 16)));
}

// x * 2^e sem estourar nos passos intermediários.
export function ldexp(x, e) {
  while (e > 1000) {
    x *= 2 ** 1000;
    e -= 1000;
  }
  while (e < -1000) {
    x *= 2 ** -1000;
    e += 1000;
  }
  return x * 2 ** e;
}

// Para double com arredondamento correto (ao mais próximo).
export function toDouble(v, P) {
  if (v === 0n) return 0;
  if (P <= 1000 && v < LIMITE_RAPIDO && v > -LIMITE_RAPIDO) {
    // Number(BigInt) já arredonda corretamente, e dividir por 2^P é exato aqui.
    return Number(v) / 2 ** P;
  }
  const negativo = v < 0n;
  const a = negativo ? -v : v;
  if (P > 1000) {
    // Atalho para valores não muito pequenos: guarda 1000 bits fracionários e marca no
    // bit mais baixo se algo foi descartado, o que preserva o arredondamento.
    const s = BigInt(P - 1000);
    let m = a >> s;
    if (m >= MIN_ATALHO && m < LIMITE_RAPIDO) {
      if ((a & ((1n << s) - 1n)) !== 0n) m |= 1n;
      const x = Number(m) / 2 ** 1000;
      return negativo ? -x : x;
    }
  }
  let deslocamento = bitLength(a) - 64;
  let m = a;
  if (deslocamento > 0) {
    const s = BigInt(deslocamento);
    m = a >> s;
    if ((a & ((1n << s) - 1n)) !== 0n) m |= 1n; // bit "pegajoso" preserva o arredondamento
  } else {
    deslocamento = 0;
  }
  const x = ldexp(Number(m), deslocamento - P);
  return negativo ? -x : x;
}

// Produto em ponto fixo.
export function mul(a, b, P) {
  return (a * b) >> BigInt(P);
}

// Muda a escala de P1 para P2 bits.
export function rescale(v, P1, P2) {
  if (P2 >= P1) return v << BigInt(P2 - P1);
  const s = BigInt(P1 - P2);
  return (v + (1n << (s - 1n))) >> s;
}

// Par double-double (hi, lo) mais próximo de v / 2^P.
export function toDD(v, P) {
  const hi = toDouble(v, P);
  const lo = toDouble(v - fromDouble(hi, P), P);
  return [hi, lo];
}
