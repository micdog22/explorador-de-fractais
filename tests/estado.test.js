import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/estado.js';
import * as BF from '../src/bigfixed.js';

test('estado vai para a URL e volta igual', () => {
  const longo = '-0.' + '7436438870371587047521915061147749993852'.repeat(10);
  const casos = [
    E.estadoPadrao('mandelbrot'),
    { ...E.estadoPadrao('julia'), jr: -0.123, ji: 0.745, cx: '0.25', cy: '-0.125', raio: 0.003 },
    { ...E.estadoPadrao('burning-ship'), cx: longo, cy: '0.0000001', raio: 1.5e-250, iter: 50000, motor: 'perturbacao' },
    { ...E.estadoPadrao('tricorn'), paleta: 'fogo', densidade: 2.5, deslocamento: 0.3, log: true, motor: 'dd' },
    { ...E.estadoPadrao('mandelbrot'), paleta: '0:000000,0.5:ff8800,0.75:ffffff' },
  ];
  for (const e of casos) {
    const volta = E.lerHash(E.escreverHash(e));
    assert.deepEqual(volta, e);
  }
  // O hash é legível e curto no caso padrão.
  assert.equal(E.escreverHash(E.estadoPadrao()), '#f=mandelbrot&x=-0.6&y=0&r=1.25');
});

test('parâmetros inválidos caem no padrão', () => {
  const p = E.estadoPadrao('mandelbrot');
  assert.deepEqual(E.lerHash(''), p);
  assert.deepEqual(E.lerHash('#f=xyz'), p);
  assert.deepEqual(E.lerHash('#x=abc&y=1'), p);
  assert.deepEqual(E.lerHash('#x=1'), p); // sem y não muda o centro
  assert.deepEqual(E.lerHash('#r=-1'), p);
  assert.deepEqual(E.lerHash('#r=1e-400'), p);
  assert.deepEqual(E.lerHash('#it=5'), p);
  assert.deepEqual(E.lerHash('#m=quantico'), p);
  assert.deepEqual(E.lerHash('#p=nada'), p);
  assert.deepEqual(E.lerHash('#d=1000&o=7'), p);
  assert.deepEqual(E.lerHash('#x=99&y=0'), p); // longe demais de qualquer fractal
  assert.deepEqual(E.lerHash('#x=' + '1'.repeat(1300) + '&y=0'), p);
  assert.equal(E.lerHash('#f=julia&cr=9&ci=0').jr, -0.8);
  assert.equal(E.lerHash('#it=2000.4').iter, 2000);
  assert.equal(E.lerHash('#x=%2B0.5&y=-.25').cx, '0.5');
});

// Ponto do plano sob (px, py) em ponto fixo, para comparar com folga mínima.
function sob(e, w, h, px, py, P) {
  const { re, im } = E.pontoNaTela(e, w, h, px, py);
  return [BF.parseDecimal(re, P), BF.parseDecimal(im, P)];
}

test('zoom no ponto mantém parado o ponto sob o cursor, até o fundo', () => {
  const w = 800;
  const h = 500;
  let e = E.estadoPadrao('mandelbrot');
  const px = 613.25;
  const py = 120.5;
  for (let passo = 0; passo < 300; passo++) {
    const P = E.bitsDaVista(e, h) + 40;
    const antes = sob(e, w, h, px, py, P);
    const depois = E.zoomNoPonto(e, w, h, px, py, 10);
    if (depois.raio === e.raio) break; // chegou ao limite
    const ponto = sob(depois, w, h, px, py, P);
    const esp = BF.fromDouble(E.espacamento(depois, h), P);
    for (const k of [0, 1]) {
      const d = ponto[k] - antes[k];
      assert.ok((d < 0n ? -d : d) * 1000n < esp, `passo ${passo}`);
    }
    e = depois;
  }
  assert.ok(e.raio < 1e-295, String(e.raio));
  // O centro guardou dígitos suficientes para o raio.
  assert.ok(e.cx.length > 300, String(e.cx.length));
  // Mais zoom não passa do mínimo.
  const fim = E.zoomNoPonto({ ...e, raio: E.RAIO_MIN }, w, h, 10, 10, 10);
  assert.equal(fim.raio, E.RAIO_MIN);
});

test('arrastar, zoom por retângulo e eixo invertido do Burning Ship', () => {
  const w = 1000;
  const h = 500;
  const e = { ...E.estadoPadrao('mandelbrot'), cx: '0', cy: '0', raio: 1 };
  const esp = E.espacamento(e, h); // 0,004
  const a = E.arrastar(e, w, h, 100, 50); // imagem foi para a direita e para baixo
  assert.equal(Number(a.cx), -0.4);
  assert.equal(Number(a.cy), 0.2); // eixo imaginário para cima
  const b = E.arrastar({ ...e, tipo: 'burning-ship' }, w, h, 100, 50);
  assert.equal(Number(b.cy), -0.2); // no Burning Ship o eixo cresce para baixo
  // Retângulo de 100 x 50 pixels com centro em (600, 300): vira a vista toda.
  const r = E.zoomRetangulo(e, w, h, 550, 275, 650, 325);
  assert.equal(Number(r.cx), 100 * esp);
  assert.equal(Number(r.cy), -50 * esp);
  assert.ok(Math.abs(r.raio - 25 * esp) < 1e-15);
  // Retângulo largo: a largura manda (proporção da tela 2:1).
  const r2 = E.zoomRetangulo(e, w, h, 0, 240, 400, 260);
  assert.ok(Math.abs(r2.raio - 100 * esp) < 1e-15);
});

test('formatação do zoom e dígitos do centro', () => {
  assert.equal(E.formatarZoom(E.estadoPadrao('mandelbrot')), '1×');
  assert.equal(E.formatarZoom({ ...E.estadoPadrao('mandelbrot'), raio: 1.25e-15 }), '1,0 × 10^15');
  assert.equal(E.formatarZoom({ ...E.estadoPadrao('mandelbrot'), raio: 1.25 / 99999 }), '1,0 × 10^5');
  assert.equal(E.formatarZoom({ ...E.estadoPadrao('mandelbrot'), raio: 1.25 / 2.5 }), '2,5×');
  assert.equal(E.digitosParaRaio(1), 8);
  assert.equal(E.digitosParaRaio(1e-100), 108);
});
