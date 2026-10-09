import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/paletas.js';

const paradas = [[0, '#000000'], [0.5, '#ff0000'], [0.75, '#ffffff']];

test('cor nas paradas, entre elas e dando a volta', () => {
  assert.deepEqual(P.corNaPaleta(paradas, 0), [0, 0, 0]);
  assert.deepEqual(P.corNaPaleta(paradas, 0.5), [255, 0, 0]);
  assert.deepEqual(P.corNaPaleta(paradas, 0.25), [127.5, 0, 0]);
  assert.deepEqual(P.corNaPaleta(paradas, 0.625), [255, 127.5, 127.5]);
  // De 0,75 (branco) até 1,0 (= 0, preto): metade do caminho em 0,875.
  assert.deepEqual(P.corNaPaleta(paradas, 0.875), [127.5, 127.5, 127.5]);
  // Só a parte fracionária importa.
  assert.deepEqual(P.corNaPaleta(paradas, 3.5), [255, 0, 0]);
  assert.deepEqual(P.corNaPaleta(paradas, -0.5), [255, 0, 0]);
  // Primeira parada depois de 0: antes dela a cor vem da última.
  const deslocada = [[0.2, '#000000'], [0.6, '#ffffff']];
  assert.deepEqual(P.corNaPaleta(deslocada, 0), P.corNaPaleta(deslocada, 1));
  const meio = P.corNaPaleta(deslocada, 0); // de 0,6 (branco) até 1,2 (preto): 2/3 do caminho
  assert.ok(Math.abs(meio[0] - 85) < 1e-9);
});

test('tabela pré-calculada', () => {
  const t = P.construirTabela(paradas, 8);
  assert.equal(t.length, 24);
  assert.deepEqual([...t.slice(0, 3)], [0, 0, 0]);
  assert.deepEqual([...t.slice(12, 15)], [255, 0, 0]); // posição 4/8 = 0,5
});

test('posição da cor a partir da contagem suave', () => {
  assert.equal(P.posicaoCor(40, 1, 0, false), 1);
  assert.equal(P.posicaoCor(40, 2, 0.25, false), 2.25);
  assert.ok(Math.abs(P.posicaoCor(Math.E - 1, 1, 0, true) - 0.2) < 1e-12);
});

test('paleta personalizada vai para texto e volta', () => {
  const texto = P.serializarPaleta(paradas);
  assert.equal(texto, '0:000000,0.5:ff0000,0.75:ffffff');
  assert.deepEqual(P.lerPaleta(texto), paradas);
  assert.deepEqual(P.lerPaleta('fogo'), P.PALETAS.fogo.paradas);
  assert.notEqual(P.lerPaleta('fogo'), P.PALETAS.fogo.paradas); // cópia, não a original
  for (const ruim of ['', 'x', '0:zzzzzz,1:000000', '0:000000', 'a:b:c', '0.5', 'toString', '__proto__']) {
    assert.equal(P.lerPaleta(ruim), null, ruim);
  }
  assert.equal(P.lerPaleta('0:000000,'.repeat(60)), null);
});

test('normalização das paradas', () => {
  assert.deepEqual(P.normalizarParadas([[0.9, '#FFFFFF'], [0.1, '000000'], ['x', '#123456'], [0.5, 'azul']]), [
    [0.1, '#000000'],
    [0.9, '#ffffff'],
  ]);
  assert.deepEqual(P.normalizarParadas([[-1, '#000000'], [2, '#ffffff']]), [[0, '#000000'], [0.9999, '#ffffff']]);
  assert.equal(P.normalizarParadas([[0, '#000000']]), null);
  assert.equal(P.normalizarParadas('nada'), null);
  assert.deepEqual(P.hexParaRgb('#0a0B0c'), [10, 11, 12]);
  assert.equal(P.hexParaRgb('#abc'), null);
  assert.equal(P.rgbParaHex([10, 11, 12.4]), '#0a0b0c');
  for (const id of Object.keys(P.PALETAS)) assert.ok(P.normalizarParadas(P.PALETAS[id].paradas), id);
});
