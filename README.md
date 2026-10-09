# Explorador de Fractais

Explore os conjuntos de Mandelbrot e Julia, o Burning Ship e o Tricorn direto no navegador, com zoom profundo até um raio de 10<sup>-300</sup>: a teoria da perturbação, com uma órbita de referência em BigInt, leva o zoom muito além do ponto em que o `double` vira um mosaico de blocos.

**Acesse online:** https://micdog22.github.io/explorador-de-fractais/

## Recursos

- **Quatro fractais**: Mandelbrot, Julia (o c vem de um clique no Mandelbrot ou dos campos numéricos), Burning Ship e Tricorn.
- **Zoom profundo** por perturbação, com rebase automático: a órbita de referência é calculada em ponto fixo com BigInt e cada pixel só guarda a diferença em `double`. Funciona até um raio de 10<sup>-300</sup>.
- **Três motores de precisão**: `double` (rápido), double-double (cerca de 106 bits) e perturbação. O modo automático escolhe; forçar um deles mostra na prática onde cada um quebra.
- **Renderização em paralelo** com até 8 Web Workers, em blocos que saem do centro para as bordas, e **progressiva**: primeiro uma prévia em 1/4 da resolução, depois a imagem final.
- **Coloração suave** (contagem normalizada de iterações) com **paletas editáveis**: predefinições, paradas com cor e posição, densidade, deslocamento, escala logarítmica e cor do interior. Trocar a paleta não recalcula nada.
- **Iterações adaptativas**: o limite cresce com o zoom e o programa ainda sobe sozinho quando a prévia não tem nenhum ponto escapando ou quando muitos pixels escapam perto do limite.
- **Navegação**: roda do mouse, pinça, arrastar, retângulo (Shift + arrastar ou o botão), duplo clique e teclado.
- **Histórico e URL**: a vista inteira (centro com todos os dígitos, raio, fractal, cores) fica no endereço. O voltar do navegador funciona e um link copiado abre exatamente a mesma vista.
- **Exportação em PNG** em até 3840 x 2160, calculada nos mesmos workers.

## Como usar

Abra a página e explore. Alguns pontos de partida (clique para abrir):

- [O vale dos cavalos-marinhos a 10<sup>13</sup>](https://micdog22.github.io/explorador-de-fractais/#f=mandelbrot&x=-0.743643887037158704752191506114774&y=0.131825904205311970493132056385139&r=3e-14): já além do `double`, e o programa sobe as iterações sozinho até a imagem aparecer.
- [O mesmo lugar com o `double` forçado](https://micdog22.github.io/explorador-de-fractais/#f=mandelbrot&x=-0.743643887037158704752191506114774&y=0.131825904205311970493132056385139&r=1e-15&m=double&it=9000): blocos, porque pixels vizinhos viram o mesmo número.
- [O ponto de Misiurewicz c = i a 10<sup>100</sup>](https://micdog22.github.io/explorador-de-fractais/#f=mandelbrot&x=0&y=1&r=1e-100): o mesmo galho se repete em qualquer escala.
- [O coelho de Douady](https://micdog22.github.io/explorador-de-fractais/#f=julia&cr=-0.123&ci=0.745&p=ipe): a Julia de um c dentro do bulbo de período 3.
- [O navio do Burning Ship](https://micdog22.github.io/explorador-de-fractais/#f=burning-ship&x=-1.762&y=-0.028&r=0.05): mastros e velas perto de c = -1,762 - 0,028i.

| Gesto | O que faz |
|---|---|
| Roda do mouse, pinça | zoom no ponto sob o cursor (ou entre os dedos) |
| Arrastar | move a vista |
| Shift + arrastar, botão "Zoom por retângulo" | o retângulo desenhado vira a nova vista |
| Duplo clique (com Shift) | aproxima 2x (afasta) |
| Setas, `+` e `-` | movem e fazem zoom com o fractal em foco |
| Alt + clique no Mandelbrot | abre a Julia daquele c |

## Como rodar localmente

Os workers são módulos ES, então a página precisa de um servidor (abrir o `index.html` direto do disco não funciona):

```
python3 -m http.server 8000
```

e abra http://localhost:8000.

## Testes

```
node --test
```

Node 18 ou mais novo, sem dependências. São 45 testes:

- **Pontos conhecidos**: c = 0, -1, -2, i e 1/4 não escapam; c = 1 escapa em z<sub>3</sub> com raio 2 e em z<sub>5</sub> com raio 256 (0, 1, 2, 5, 26, 677).
- **Pi escondido no Mandelbrot** (Dave Boll, 1991): em c = -3/4 + i·e, o número de iterações vezes e tende a pi; com e = 10<sup>-5</sup> dá 3,1416. Na ponta, c = 1/4 + e, é o número vezes raiz(e).
- **Cardioide e bulbo**: todo ponto que o teste rápido marca como interior não escapa em 3000 iterações.
- **Suavização**: vale n + 1 em |z| = R e n em |z| = R²; ao longo do eixo real a contagem inteira salta de 1 em 1 e a suave varia menos de 0,02 entre vizinhos.
- **Double-double**: `twoSum` e `twoProd` conferidos como exatos com BigInt; soma e produto com erro relativo abaixo de 2<sup>-103</sup> e 2<sup>-101</sup>.
- **BigInt em ponto fixo**: leitura e escrita de decimais, conversão exata de e para `double` (com arredondamento ao par, inclusive acima de 1000 bits).
- **Zoom profundo contra cálculo direto**: em 1e-20, para Mandelbrot, Burning Ship, Tricorn e Julia, a perturbação dá a mesma contagem que iterar cada pixel em BigInt. Perto de c = i, a igualdade vale pixel a pixel em 10<sup>-100</sup>, 10<sup>-250</sup> e 10<sup>-300</sup>.
- **URL**: a vista vai para o endereço e volta igual (inclusive com centros de 400 dígitos); parâmetros inválidos caem no padrão; o zoom mantém parado o ponto sob o cursor em 300 passos seguidos até 10<sup>-300</sup>.
- **Paletas**: interpolação, a volta do fim para o começo e a serialização compacta.

## Como funciona

### Números complexos e tempo de escape

Um número complexo é `z = x + i·y`, um ponto do plano. Elevar ao quadrado é `z² = (x² - y²) + i·(2xy)` e o módulo `|z|` é a distância até a origem. O conjunto de Mandelbrot são os valores de c para os quais a sequência

```
z₀ = 0,   z_{n+1} = z_n² + c
```

fica limitada. Se em algum momento `|z_n| > 2`, a sequência foge para o infinito (de um certo ponto em diante, `|z²|` cresce mais rápido do que c consegue puxar de volta). Então cada pixel é um c, e a pergunta é **em que iteração ele escapa**. Pontos que não escapam dentro do limite de iterações são o "interior" e ficam pretos; os outros recebem uma cor pelo tempo de escape. Os outros fractais mudam só a regra:

| Fractal | z inicial | passo |
|---|---|---|
| Mandelbrot | 0 | `z² + c` |
| Julia | o pixel | `z² + c`, com c fixo |
| Burning Ship | 0 | `(abs(x) + i·abs(y))² + c` (desenhado com o eixo imaginário para baixo, como de costume) |
| Tricorn | 0 | `conj(z)² + c` |

Cada c do Mandelbrot tem a sua Julia: se c está dentro do Mandelbrot, a Julia é conexa (um bloco só); se está fora, vira poeira. Por isso escolher c clicando no Mandelbrot é tão natural.

Dois atalhos poupam a parte mais cara, o interior: a **cardioide principal** (`q·(q + x - 1/4) <= y²/4`, com `q = (x - 1/4)² + y²`) e o **bulbo de período 2** (o disco de raio 1/4 em torno de -1) são testados antes de iterar.

### Coloração suave

Colorir pelo número inteiro de iterações desenha faixas. A **contagem normalizada** troca n por

```
mu = n + 1 - log2( ln|z_n| / ln R )
```

com raio de fuga `R = 256`. Perto do infinito, cada passo eleva `|z|` ao quadrado, ou seja, dobra `ln|z|`; o `log2` desse logaritmo mede que fração de passo faltava. Quando `|z_n|` vale exatamente R, `mu = n + 1`; quando vale R², `mu = n`: as faixas se emendam sem degrau. O raio grande (256 em vez de 2) deixa a aproximação boa.

A cor vem de uma paleta cíclica: `t = mu · densidade / 40 + deslocamento`, e só a parte fracionária de t importa. Como os workers devolvem `mu` e não a cor, o navegador guarda esses valores e repinta tudo na hora quando a paleta muda.

### Por que a precisão acaba

O `double` tem 53 bits de mantissa, uns 16 dígitos. Num zoom em que a tela inteira mede `10^-14` em torno de um ponto como -0,7436, dois pixels vizinhos diferem na 17ª casa decimal: o `double` arredonda os dois para o **mesmo número**, e a imagem vira blocos (veja o segundo link acima). Não adianta ter mais iterações: a informação sumiu antes da primeira.

Há ainda um segundo efeito: a iteração é caótica perto da borda, e um erro de arredondamento pode crescer a cada passo até virar a própria resposta. No Burning Ship isso é tão forte que, em órbitas longas, nem BigInt com 64 bits de folga concorda com BigInt de 464 bits sobre a iteração exata de fuga de cada pixel; a imagem continua certa no todo, mas pixels caóticos isolados não têm resposta estável.

O primeiro remédio é o **double-double**: guardar cada número como a soma de dois doubles, `hi + lo`, com uns 106 bits. As operações usam transformações sem erro: a soma de Knuth (`twoSum`) e o produto de Dekker (`twoProd`, que divide cada fator em metades de 26 bits porque o JavaScript não tem FMA) devolvem o resultado arredondado mais o erro exato. Funciona até uns `10^-30`, mas cada iteração custa umas 10 vezes mais.

### Perturbação: o zoom profundo

Um zoom de `10^-100` pediria 350 bits por número, e iterar milhões de pixels em BigInt seria lentíssimo. A **teoria da perturbação** (K. I. Martin, 2013) resolve com uma ideia simples: calcular uma única órbita em alta precisão e descrever cada pixel como um desvio pequeno dela.

1. **Órbita de referência**: no centro da tela, `Z_{n+1} = Z_n² + C` é iterada em **ponto fixo com BigInt**, com `log2(1/espaçamento do pixel) + 64` bits. Cada `Z_n` é guardado já arredondado para `double` (o valor é da ordem de 1, então cabe).
2. **Desvio de cada pixel**: escrevendo `z_n = Z_n + d_n` e `c = C + dc`,

   ```
   z_{n+1} = (Z_n + d_n)² + C + dc
           = Z_{n+1} + 2·Z_n·d_n + d_n² + dc
   ```

   então `d_{n+1} = 2·Z_n·d_n + d_n² + dc`. O desvio é minúsculo (da ordem do pixel), mas é um número pequeno **com todos os seus 53 bits de precisão relativa**: o expoente do `double` vai até `10^-308`. O pixel só junta `Z_n + d_n` para testar a fuga.
3. **Rebase** (Zhuoran, 2021): quando a órbita do pixel passa perto do zero, `|z_n|` fica menor que `|d_n|` e somar a referência destrói a precisão (os antigos "glitches"). Nesse momento o programa troca o desvio pelo próprio z (`d = z`) e recomeça a referência do início, o que vale porque `Z_0 = 0`. O mesmo vale quando a referência acaba antes do pixel (por exemplo, se o centro escapou). Na Julia a referência começa no centro, então o recomeço usa a órbita do ponto crítico 0, calculada também em BigInt.
4. **Outras fórmulas**: no Tricorn o desvio é conjugado; no Burning Ship, o módulo vira `diffabs(c, d) = |c + d| - |c|`, calculado por casos para não subtrair números quase iguais.

**Até onde vai**: o desvio precisa continuar um `double` normal, então o limite prático é um raio de cerca de `10^-300`, que é o mínimo aceito aqui. Além disso seria preciso um formato com expoente estendido (um `double` com um inteiro separado para o expoente). Antes desse limite, quem manda é o tempo: zooms profundos pedem dezenas de milhares de iterações, e a órbita de referência custa um produto de BigInt de mil bits por passo.

Os testes conferem a perturbação contra a iteração direta em BigInt, pixel a pixel, inclusive em `10^-300`.

### Workers e renderização progressiva

A tela é dividida em blocos de 64 x 64, ordenados do centro para fora, e distribuídos entre até 8 Web Workers. Antes, uma prévia calcula um ponto a cada 4 x 4 pixels (1/16 do trabalho), que aparece quase na hora. Cada vista tem um número de geração: resultados de uma vista antiga, que ainda chegam depois de um zoom, são descartados. Enquanto os blocos novos não chegam, a imagem anterior é redesenhada já com o novo zoom e deslocamento, então a navegação não pisca.

### Iterações adaptativas

O limite automático cresce com a profundidade (`250 + 60·log10(zoom)^1,25`), e dois sinais da própria imagem o ajustam: se **nenhum** ponto da prévia escapou, o limite dobra e a prévia é refeita (até 16 vezes o valor inicial); se mais de 1% dos pixels que escaparam o fizeram nos últimos 25% do limite, ele sobe 60% e a imagem é refinada.

### A URL guarda tudo

O centro vai para o endereço como texto decimal com tantos dígitos quanto o zoom pede (mais de 300 no fundo). A cada gesto de navegação o programa grava a vista com `history.pushState` (uma entrada por gesto, não por evento da roda), e o `popstate` do botão voltar devolve a vista anterior.

## Contribuindo

Issues e pull requests são bem-vindos.

## Licença

MIT. Veja [LICENSE](LICENSE).
