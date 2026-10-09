// Paletas de gradiente: paradas (posição em [0, 1) e cor) que se repetem em ciclo.
// A cor de um pixel vem da contagem suave de iterações, então a paleta pode ser trocada
// sem recalcular o fractal.

export const PALETAS = {
  classica: {
    nome: 'Clássica',
    paradas: [[0, '#000764'], [0.16, '#206bcb'], [0.42, '#edffff'], [0.6425, '#ffaa00'], [0.8575, '#000200']],
  },
  fogo: {
    nome: 'Fogo',
    paradas: [[0, '#0b0405'], [0.2, '#5c0a0a'], [0.45, '#d9480f'], [0.7, '#ffd43b'], [0.85, '#fff9db']],
  },
  oceano: {
    nome: 'Oceano',
    paradas: [[0, '#03045e'], [0.25, '#0077b6'], [0.5, '#00b4d8'], [0.7, '#caf0f8'], [0.85, '#0096c7']],
  },
  ipe: {
    nome: 'Ipê',
    paradas: [[0, '#2b0a3d'], [0.3, '#c2185b'], [0.55, '#f8bbd0'], [0.75, '#ffd54f'], [0.9, '#6a1b9a']],
  },
  floresta: {
    nome: 'Floresta',
    paradas: [[0, '#081c15'], [0.3, '#2d6a4f'], [0.55, '#95d5b2'], [0.75, '#fefae0'], [0.9, '#bc6c25']],
  },
  arcoiris: {
    nome: 'Arco-íris',
    paradas: [[0, '#ff0000'], [0.17, '#ffa500'], [0.33, '#ffff00'], [0.5, '#00c000'], [0.67, '#0080ff'], [0.83, '#8000ff']],
  },
  cinza: {
    nome: 'Tons de cinza',
    paradas: [[0, '#000000'], [0.5, '#ffffff']],
  },
};

const HEX = /^#?([0-9a-f]{6})$/i;

export function hexParaRgb(hex) {
  const m = HEX.exec(String(hex).trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbParaHex([r, g, b]) {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

// Ordena, limita as posições a [0, 1) e descarta paradas inválidas. Precisa de 2 ou mais.
export function normalizarParadas(paradas) {
  if (!Array.isArray(paradas)) return null;
  const ok = [];
  for (const p of paradas) {
    if (!Array.isArray(p) || p.length !== 2) continue;
    const pos = Number(p[0]);
    const rgb = hexParaRgb(p[1]);
    if (!Number.isFinite(pos) || !rgb) continue;
    const posicao = Math.min(Math.max(pos, 0), 0.9999);
    ok.push([posicao, rgbParaHex(rgb)]);
  }
  ok.sort((a, b) => a[0] - b[0]);
  return ok.length >= 2 ? ok : null;
}

// Cor em t (qualquer real; só a parte fracionária importa). Entre a última parada e a
// primeira, o gradiente dá a volta.
export function corNaPaleta(paradas, t) {
  const f = t - Math.floor(t);
  const n = paradas.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) {
    if (paradas[k][0] > f) {
      i = k - 1;
      break;
    }
  }
  let a;
  let b;
  let pa;
  let pb;
  if (i < 0) {
    // antes da primeira parada: vem da última, que está "uma volta atrás"
    a = paradas[n - 1];
    b = paradas[0];
    pa = a[0] - 1;
    pb = b[0];
  } else if (i === n - 1) {
    a = paradas[n - 1];
    b = paradas[0];
    pa = a[0];
    pb = b[0] + 1;
  } else {
    a = paradas[i];
    b = paradas[i + 1];
    pa = a[0];
    pb = b[0];
  }
  const u = pb > pa ? (f - pa) / (pb - pa) : 0;
  const ca = hexParaRgb(a[1]);
  const cb = hexParaRgb(b[1]);
  return [0, 1, 2].map((k) => ca[k] + (cb[k] - ca[k]) * u);
}

// Tabela com n cores RGB pré-calculadas, para colorir milhões de pixels rapidamente.
export function construirTabela(paradas, n = 2048) {
  const tabela = new Uint8ClampedArray(n * 3);
  for (let i = 0; i < n; i++) {
    const c = corNaPaleta(paradas, i / n);
    tabela[3 * i] = c[0];
    tabela[3 * i + 1] = c[1];
    tabela[3 * i + 2] = c[2];
  }
  return tabela;
}

// Posição na paleta para um valor suave mu. densidade = ciclos a cada 40 iterações.
export function posicaoCor(mu, densidade, deslocamento, logaritmica) {
  const base = logaritmica ? Math.log(mu + 1) * 8 : mu;
  return (base * densidade) / 40 + deslocamento;
}

// Texto compacto para a URL: "0:000764,0.16:206bcb,..."
export function serializarPaleta(paradas) {
  return paradas
    .map(([p, c]) => `${Number(p.toFixed(4))}:${c.replace('#', '').toLowerCase()}`)
    .join(',');
}

export function lerPaleta(texto) {
  if (typeof texto !== 'string' || texto.length > 400) return null;
  if (Object.prototype.hasOwnProperty.call(PALETAS, texto)) return PALETAS[texto].paradas.map((p) => [...p]);
  const partes = texto.split(',').map((s) => s.split(':'));
  if (partes.some((p) => p.length !== 2)) return null;
  return normalizarParadas(partes.map(([pos, cor]) => [Number(pos), '#' + cor]));
}
