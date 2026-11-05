// Ledger no celular — a PWA. Uma entrega por tela (rolagem vertical que encaixa); arrastar a carta para a
// direita aceita, para a esquerda rejeita com motivo. Os botões embaixo fazem o mesmo. Fala só com o
// servidor do Donel Dev no PC, pela Tailscale; o token de sessão fica no localStorage deste celular.
'use strict';

(function () {
  var CHAVE_TOKEN = 'donel-ledger-token';
  var LIMIAR = 0.28; // fração da largura que confirma o gesto

  // Glifos próprios (traço simples, sem copiar arte de baralho nenhum).
  var GLIFOS = {
    martelos: '<svg viewBox="0 0 24 24"><path d="M5.5 3.5l5 5-2.8 2.8-5-5z"/><path d="M8.2 6.2l3.3-3.3 2.6 2.6-3.3 3.3"/><path d="M10.4 11.2L20 20.8"/><path d="M14 4.5l1.5-1.5"/></svg>',
    escudos: '<svg viewBox="0 0 24 24"><path d="M12 2.8l7.5 3v5.4c0 5-3.6 8.6-7.5 10-3.9-1.4-7.5-5-7.5-10V5.8z"/><path d="M12 6.5v11M7.8 11h8.4"/></svg>',
    chaves: '<svg viewBox="0 0 24 24"><circle cx="7" cy="12" r="3.6"/><circle cx="7" cy="12" r="1.1"/><path d="M10.6 12H21.5M17.5 12v3.2M20.5 12v2.3"/></svg>',
    livros: '<svg viewBox="0 0 24 24"><path d="M3.5 5.2c3-1.1 6-1 8.5 1 2.5-2 5.5-2.1 8.5-1v13.6c-3-1.1-6-1-8.5 1-2.5-2-5.5-2.1-8.5-1z"/><path d="M12 6.2v13.6M6 9c1.5-.3 2.8-.1 4 .5M6 12c1.5-.3 2.8-.1 4 .5M14 9.5c1.2-.6 2.5-.8 4-.5"/></svg>',
    estrelas: '<svg viewBox="0 0 24 24"><path d="M12 2.2l1.9 6.3 6.2-2.2-3.6 5.7 3.6 5.7-6.2-2.2L12 21.8l-1.9-6.3-6.2 2.2 3.6-5.7-3.6-5.7 6.2 2.2z"/><circle cx="12" cy="12" r="1.6"/></svg>',
    coroas: '<svg viewBox="0 0 24 24"><path d="M3 8.2l4.6 4.1L12 4.8l4.4 7.5L21 8.2l-2 10.6H5z"/><path d="M5.6 15.6h12.8"/><circle cx="12" cy="4" r=".6"/></svg>',
  };
  var NOMES = { martelos: 'Martelos', escudos: 'Escudos', chaves: 'Chaves', livros: 'Livros', estrelas: 'Estrelas', coroas: 'Coroas' };
  var CANTO = '<svg viewBox="0 0 26 26"><path d="M2 14V4a2 2 0 0 1 2-2h10"/><path d="M6 10c0-2.2 1.8-4 4-4"/><circle cx="12.5" cy="12.5" r="1.4"/><path d="M2 20c3 0 5-1 6.5-3M20 2c0 3-1 5-3 6.5"/></svg>';
  var VERSO = '<svg viewBox="0 0 70 70"><circle cx="35" cy="35" r="30"/><circle cx="35" cy="35" r="20"/><path d="M35 5v60M5 35h60M14 14l42 42M56 14L14 56"/><circle cx="35" cy="35" r="5"/></svg>';
  var ICONE_SIM = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var ICONE_NAO = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICONE_ALERTA = '<svg viewBox="0 0 24 24"><path d="M12 5v9M12 18.5v.5"/></svg>';

  var baralho = document.getElementById('baralho');
  var contagem = document.getElementById('contagem');
  var aviso = document.getElementById('aviso');
  var folha = document.getElementById('folha');
  var folhaForm = document.getElementById('folha-form');
  var motivo = document.getElementById('motivo');
  var folhaPendente = null;
  var total = 0;
  var urlsDeBlob = [];

  document.querySelector('.marca-glifo').innerHTML = GLIFOS.estrelas;

  // ---- utilidades ----

  function el(tag, classe, texto) {
    var node = document.createElement(tag);
    if (classe) node.className = classe;
    if (texto !== undefined && texto !== null) node.textContent = texto;
    return node;
  }

  function token() {
    try {
      return localStorage.getItem(CHAVE_TOKEN);
    } catch (e) {
      return null;
    }
  }

  function guardarToken(valor) {
    try {
      if (valor) localStorage.setItem(CHAVE_TOKEN, valor);
      else localStorage.removeItem(CHAVE_TOKEN);
    } catch (e) {
      /* sem armazenamento: o pareamento vale só nesta aba */
    }
  }

  function idAleatorio() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function romano(n) {
    var tabela = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    var saida = '';
    tabela.forEach(function (par) {
      while (n >= par[0]) { saida += par[1]; n -= par[0]; }
    });
    return saida;
  }

  function haQuanto(iso) {
    var ms = Date.now() - Date.parse(iso);
    if (!isFinite(ms)) return '';
    var min = Math.round(ms / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return 'há ' + min + ' min';
    var h = Math.round(min / 60);
    if (h < 24) return 'há ' + h + ' h';
    var d = Math.round(h / 24);
    return d === 1 ? 'há 1 dia' : 'há ' + d + ' dias';
  }

  var avisoTimer = null;
  function avisar(texto) {
    aviso.textContent = texto;
    aviso.hidden = false;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(function () { aviso.hidden = true; }, 3500);
  }

  function api(caminho, opcoes) {
    opcoes = opcoes || {};
    var headers = { Authorization: 'Bearer ' + (token() || '') };
    if (opcoes.body) headers['Content-Type'] = 'application/json';
    return fetch(caminho, { method: opcoes.method || 'GET', headers: headers, body: opcoes.body, cache: 'no-store' }).then(function (resposta) {
      if (resposta.status === 401) {
        guardarToken(null);
        mostrarPareamento();
        throw new Error('nao-pareado');
      }
      return resposta;
    });
  }

  // ---- pareamento ----

  function nomeDoAparelho() {
    var ua = navigator.userAgent || '';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    return 'Celular';
  }

  function parearPeloLink() {
    var m = /[#&]parear=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m) return Promise.resolve(false);
    history.replaceState(null, '', location.pathname);
    return fetch('/api/parear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo: m[1], aparelho: nomeDoAparelho() }),
    }).then(function (resposta) {
      if (!resposta.ok) {
        avisar('Este link de pareamento já foi usado ou venceu. Gere outro no Donel Dev.');
        return false;
      }
      return resposta.json().then(function (dados) {
        guardarToken(dados.token);
        avisar('Celular pareado.');
        return true;
      });
    }, function () {
      avisar('Sem conexão com o PC. A Tailscale está ligada neste celular?');
      return false;
    });
  }

  function mostrarPareamento() {
    limparBaralho();
    contagem.textContent = 'Celular não pareado';
    var vazio = el('div', 'vazio');
    var verso = el('div', 'carta-verso');
    verso.innerHTML = VERSO;
    vazio.appendChild(verso);
    vazio.appendChild(el('h2', null, 'Pareie este celular'));
    var passos = el('ol');
    ['No Donel Dev, abra Preferências e depois Celular.', 'Toque em "Parear um celular".', 'Aponte a câmera para o QR que aparece lá.'].forEach(function (texto) {
      passos.appendChild(el('li', null, texto));
    });
    vazio.appendChild(passos);
    baralho.appendChild(vazio);
  }

  // ---- o baralho ----

  function limparBaralho() {
    urlsDeBlob.forEach(function (url) { URL.revokeObjectURL(url); });
    urlsDeBlob = [];
    baralho.textContent = '';
  }

  function atualizarContagem() {
    contagem.textContent = total === 0 ? 'Nada esperando você' : total === 1 ? '1 esperando você' : total + ' esperando você';
  }

  function mostrarVazio() {
    var vazio = el('div', 'vazio');
    var verso = el('div', 'carta-verso');
    verso.innerHTML = VERSO;
    vazio.appendChild(verso);
    vazio.appendChild(el('h2', null, 'O baralho está vazio'));
    vazio.appendChild(el('p', null, 'Nenhuma entrega esperando você agora.'));
    baralho.appendChild(vazio);
  }

  function carregar() {
    if (!token()) {
      mostrarPareamento();
      return Promise.resolve();
    }
    return api('/api/fila')
      .then(function (resposta) {
        if (!resposta.ok) throw new Error('falhou');
        return resposta.json();
      })
      .then(function (dados) {
        limparBaralho();
        var itens = Array.isArray(dados.itens) ? dados.itens : [];
        total = itens.length;
        atualizarContagem();
        if (itens.length === 0) {
          mostrarVazio();
          return;
        }
        itens.forEach(function (item, i) {
          baralho.appendChild(montarSlot(item, i + 1, itens.length));
        });
      })
      .catch(function (erro) {
        if (erro && erro.message === 'nao-pareado') return;
        avisar('Não consegui falar com o PC. O Donel Dev está aberto e a Tailscale ligada?');
      });
  }

  function montarProva(item, prova) {
    var bloco = el('div', 'prova');
    bloco.appendChild(el('div', 'prova-rotulo', prova.rotulo));
    var caminho = '/api/prova?item=' + encodeURIComponent(item.id) + '&prova=' + encodeURIComponent(prova.id);
    if (prova.tipo === 'comando') {
      var saida = el('pre', null, prova.texto || '');
      bloco.appendChild(saida);
      if (prova.cortado) {
        var inteira = el('button', 'prova-carregar', 'Ver a saída inteira');
        inteira.type = 'button';
        inteira.addEventListener('click', function () {
          inteira.disabled = true;
          inteira.textContent = 'Carregando…';
          api(caminho)
            .then(function (resposta) { return resposta.ok ? resposta.text() : null; })
            .catch(function () { return null; })
            .then(function (texto) {
              if (texto === null) { inteira.disabled = false; inteira.textContent = 'Ver a saída inteira'; return; }
              saida.textContent = texto;
              bloco.removeChild(inteira);
            });
        });
        bloco.appendChild(inteira);
      }
    } else if (prova.tipo === 'link') {
      if (prova.url && /^https?:\/\//i.test(prova.url)) {
        var a = el('a', null, prova.url);
        a.href = prova.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        bloco.appendChild(a);
      }
    } else if (prova.tipo === 'imagem') {
      var img = el('img');
      img.alt = prova.rotulo;
      img.addEventListener('click', function () { img.classList.toggle('ampliada'); });
      bloco.appendChild(img);
      baixar(caminho).then(function (url) { if (url) img.src = url; });
    } else if (prova.tipo === 'video') {
      var botao = el('button', 'prova-carregar', 'Ver o vídeo');
      botao.type = 'button';
      botao.addEventListener('click', function () {
        botao.disabled = true;
        botao.textContent = 'Carregando…';
        baixar(caminho).then(function (url) {
          if (!url) { botao.disabled = false; botao.textContent = 'Ver o vídeo'; return; }
          var video = el('video');
          video.controls = true;
          video.setAttribute('playsinline', '');
          video.src = url;
          bloco.replaceChild(video, botao);
        });
      });
      bloco.appendChild(botao);
    }
    return bloco;
  }

  function baixar(caminho) {
    return api(caminho)
      .then(function (resposta) { return resposta.ok ? resposta.blob() : null; })
      .then(function (blob) {
        if (!blob) return null;
        var url = URL.createObjectURL(blob);
        urlsDeBlob.push(url);
        return url;
      })
      .catch(function () { return null; });
  }

  // ---- carta forma A: a frente decide, o verso explica ----

  function cabecaCarta(naipe, nome, extra) {
    var topo = el('header', 'carta-topo');
    var glifo = el('span', 'glifo');
    glifo.innerHTML = GLIFOS[naipe];
    glifo.setAttribute('aria-hidden', 'true');
    topo.appendChild(glifo);
    topo.appendChild(el('span', 'naipe-nome', nome));
    if (extra) topo.appendChild(extra);
    return topo;
  }

  function face(classe, naipe) {
    var f = el('div', 'A-face ' + classe);
    var moldura = el('div', 'moldura');
    var interna = el('div', 'moldura-interna');
    moldura.appendChild(interna);
    f.appendChild(moldura);
    return { face: f, interna: interna };
  }

  function provaPorId(item, id) {
    for (var i = 0; i < item.provas.length; i++) if (item.provas[i].id === id) return item.provas[i];
    return null;
  }

  /** Print (amplia ao tocar) ou vídeo (toca dentro da carta). */
  function midia(item, prova) {
    var caminho = '/api/prova?item=' + encodeURIComponent(item.id) + '&prova=' + encodeURIComponent(prova.id);
    if (prova.tipo === 'video') {
      var video = el('video', 'A-midia');
      video.controls = true;
      video.setAttribute('playsinline', '');
      baixar(caminho).then(function (url) { if (url) video.src = url; });
      return video;
    }
    var img = el('img', 'A-midia');
    img.alt = prova.rotulo;
    img.addEventListener('click', function () { img.classList.toggle('ampliada'); });
    baixar(caminho).then(function (url) { if (url) img.src = url; });
    return img;
  }

  function montarVisual(item, visual) {
    var caixa = el('div', 'vis');
    if (visual.tipo === 'checagens') {
      var ok = visual.itens.filter(function (i) { return i.ok; }).length;
      var h = el('h5');
      h.appendChild(el('span', null, 'Checagens'));
      h.appendChild(el('span', null, ok + ' de ' + visual.itens.length + ' ok'));
      caixa.appendChild(h);
      var lista = el('ul', 'luzes');
      visual.itens.forEach(function (i) {
        var li = el('li', i.ok ? 'ok' : 'aviso');
        var luz = el('i');
        luz.innerHTML = i.ok ? ICONE_SIM : ICONE_ALERTA;
        li.appendChild(luz);
        li.appendChild(el('b', null, i.nome));
        // A frase só aparece no que não passou: o que está ok não pede leitura.
        if (!i.ok) li.appendChild(el('span', null, i.frase));
        lista.appendChild(li);
      });
      caixa.appendChild(lista);
      return caixa;
    }
    if (visual.tipo === 'antes-depois') {
      var antes = provaPorId(item, visual.antes);
      var depois = provaPorId(item, visual.depois);
      if (!antes || !depois) return null;
      var par = el('div', 'ad');
      [['Antes', antes], ['Depois', depois]].forEach(function (lado) {
        var col = el('div');
        col.appendChild(el('div', 'leg', lado[0]));
        col.appendChild(midia(item, lado[1]));
        par.appendChild(col);
      });
      caixa.appendChild(par);
      return caixa;
    }
    var prova = provaPorId(item, visual.prova);
    if (!prova || (prova.tipo !== 'imagem' && prova.tipo !== 'video')) return null;
    caixa.appendChild(midia(item, prova));
    return caixa;
  }

  function recolhido(titulo, conteudo) {
    var d = el('details', 'recolhido');
    d.appendChild(el('summary', null, titulo));
    conteudo.forEach(function (c) { d.appendChild(c); });
    return d;
  }

  function montarCartaA(item, posicao, quantas) {
    var naipe = GLIFOS[item.naipe] ? item.naipe : 'martelos';
    var c = item.carta;
    var rec = null;
    c.opcoes.forEach(function (o) { if (o.recomendada) rec = o; });
    var slot = el('section', 'slot');
    slot.setAttribute('aria-label', item.titulo);
    var carta = el('article', 'A-carta naipe-' + naipe);
    var ctx = { item: item, slot: slot, carta: carta, botoes: [] };

    // Frente
    var frente = face('A-frente', naipe);
    var indice = el('span', 'indice', romano(posicao) + ' · ' + romano(quantas));
    indice.setAttribute('aria-label', 'Carta ' + posicao + ' de ' + quantas);
    frente.interna.appendChild(cabecaCarta(naipe, NOMES[naipe], indice));
    var titulo = el('div', 'A-titulo');
    titulo.appendChild(el('div', 'A-nome', item.titulo));
    titulo.appendChild(el('h2', null, c.pergunta));
    frente.interna.appendChild(titulo);
    var rolagem = el('div', 'A-rola');
    var visual = c.visual ? montarVisual(item, c.visual) : null;
    if (visual) rolagem.appendChild(visual);
    if (rec) {
      var faixa = el('p', 'A-rec');
      faixa.appendChild(document.createTextNode('Recomendo '));
      faixa.appendChild(el('b', null, rec.rotulo));
      faixa.appendChild(document.createTextNode(': ' + c.porque));
      rolagem.appendChild(faixa);
    }
    var opcoes = el('div', 'opcoes');
    c.opcoes.forEach(function (o) {
      var b = el('button', 'opcao' + (o.recomendada ? ' rec' : ''));
      b.type = 'button';
      b.appendChild(el('b', null, o.rotulo));
      if (o.recomendada) b.appendChild(el('em', null, 'recomendo'));
      b.appendChild(el('span', 'efeito', o.efeito));
      b.addEventListener('click', function () { escolher(ctx, o, b); });
      ctx.botoes.push(b);
      opcoes.appendChild(b);
    });
    rolagem.appendChild(opcoes);
    frente.interna.appendChild(rolagem);
    var pe = el('footer', 'A-pe');
    var selo = el('span', 'A-selo ' + item.risco);
    selo.appendChild(el('i', null, 'risco ' + item.risco));
    selo.appendChild(el('span', null, c.risco));
    pe.appendChild(selo);
    var virar = el('button', 'A-virar', '↻ Virar');
    virar.type = 'button';
    pe.appendChild(virar);
    frente.interna.appendChild(pe);

    // Verso
    var verso = face('A-verso', naipe);
    var botaoFrente = el('button', 'A-virar', '↻ Frente');
    botaoFrente.type = 'button';
    verso.interna.appendChild(cabecaCarta(naipe, 'O verso', botaoFrente));
    var corpo = el('div', 'A-verso-corpo');
    corpo.appendChild(el('h4', null, 'O que aconteceu'));
    corpo.appendChild(el('p', null, c.resumo));
    if (rec) {
      corpo.appendChild(el('h4', null, 'Por que eu recomendo ' + rec.rotulo.toLowerCase()));
      corpo.appendChild(el('p', null, c.porque));
    }
    corpo.appendChild(el('h4', null, 'Cada caminho'));
    var dl = el('dl');
    c.opcoes.forEach(function (o) {
      dl.appendChild(el('dt', null, o.rotulo));
      dl.appendChild(el('dd', null, o.efeito));
      if (o.risco) dl.appendChild(el('dd', 'r', 'Risco: ' + o.risco));
    });
    corpo.appendChild(dl);
    corpo.appendChild(el('h4', null, 'Risco ' + item.risco));
    corpo.appendChild(el('p', null, c.risco));
    corpo.appendChild(el('h4', null, 'Quem fez'));
    corpo.appendChild(el('p', null, item.quemEntregou + ', no quadro ' + item.quadro + ' · ' + haQuanto(item.entregueEm) + ' · prazo ' + item.prazo));
    corpo.appendChild(recolhido('O que você pediu, nas suas palavras', [el('blockquote', null, '“' + item.pedido + '”')]));
    var tecnico = [el('h3', null, 'Pronto quando'), el('p', null, item.criterio)];
    if (item.nota) tecnico.push(el('h3', null, 'Nota de quem entregou'), el('p', null, item.nota));
    if (Array.isArray(item.provas) && item.provas.length > 0) {
      tecnico.push(el('h3', null, item.provas.length === 1 ? 'Prova' : 'Provas'));
      item.provas.forEach(function (prova) { tecnico.push(montarProva(item, prova)); });
    }
    (item.ids || []).forEach(function (id) { tecnico.push(el('div', 'id', id)); });
    corpo.appendChild(recolhido('Detalhes técnicos', tecnico));
    verso.interna.appendChild(corpo);

    function alternar() { carta.classList.toggle('virada'); }
    virar.addEventListener('click', alternar);
    botaoFrente.addEventListener('click', alternar);

    carta.appendChild(frente.face);
    carta.appendChild(verso.face);
    var mesa = el('div', 'A-mesa');
    mesa.appendChild(carta);
    slot.appendChild(mesa);
    return slot;
  }

  /** Um toque marca a opção; o segundo, na mesma, decide (um esbarrão não fecha tarefa). */
  function escolher(ctx, opcao, botao) {
    if (ctx.ocupado) return;
    if (ctx.marcada !== botao) {
      ctx.botoes.forEach(function (b) { b.classList.remove('marcada'); });
      ctx.marcada = botao;
      botao.classList.add('marcada');
      avisar('Toque de novo em "' + opcao.rotulo + '" para confirmar.');
      return;
    }
    decidir(ctx, opcao.fecha === 'rejeitada' ? 'rejeitar' : 'aceitar', null, opcao.rotulo);
  }

  function montarSlot(item, posicao, quantas) {
    if (item.carta && item.origem !== 'amostra-revisor') return montarCartaA(item, posicao, quantas);
    var naipe = GLIFOS[item.naipe] ? item.naipe : 'martelos';
    var amostra = item.origem === 'amostra-revisor';
    var slot = el('section', 'slot');
    slot.setAttribute('aria-label', item.titulo);

    var carta = el('article', 'carta naipe-' + naipe);
    var moldura = el('div', 'moldura');
    var interna = el('div', 'moldura-interna');
    ['se', 'sd', 'ie', 'id'].forEach(function (lado) {
      var canto = el('span', 'canto canto-' + lado);
      canto.innerHTML = CANTO;
      canto.setAttribute('aria-hidden', 'true');
      moldura.appendChild(canto);
    });

    var topo = el('header', 'carta-topo');
    var glifo = el('span', 'glifo');
    glifo.innerHTML = GLIFOS[naipe];
    glifo.setAttribute('aria-hidden', 'true');
    topo.appendChild(glifo);
    topo.appendChild(el('span', 'naipe-nome', NOMES[naipe]));
    interna.appendChild(topo);
    var indice = el('span', 'indice', romano(posicao) + ' · ' + romano(quantas));
    indice.setAttribute('aria-label', 'Carta ' + posicao + ' de ' + quantas);
    interna.appendChild(indice);
    interna.appendChild(
      el('p', amostra ? 'faixa faixa-amostra' : 'faixa', amostra ? 'Amostra do dia · aceita por ' + (item.aceitoPor || 'Revisor') : item.risco === 'alto' ? 'Risco alto · esperando você' : 'Esperando você'),
    );

    var corpo = el('div', 'carta-corpo');
    corpo.appendChild(el('h2', 'titulo', item.titulo));
    var blocoPedido = el('section', 'bloco');
    blocoPedido.appendChild(el('h3', null, 'O pedido'));
    blocoPedido.appendChild(el('blockquote', 'pedido', '“' + item.pedido + '”'));
    corpo.appendChild(blocoPedido);
    var blocoCriterio = el('section', 'bloco');
    blocoCriterio.appendChild(el('h3', null, 'Pronto quando'));
    blocoCriterio.appendChild(el('p', null, item.criterio));
    corpo.appendChild(blocoCriterio);
    if (item.nota) {
      var blocoNota = el('section', 'bloco');
      blocoNota.appendChild(el('h3', null, 'Nota de quem entregou'));
      blocoNota.appendChild(el('p', null, item.nota));
      corpo.appendChild(blocoNota);
    }
    if (Array.isArray(item.provas) && item.provas.length > 0) {
      var provas = el('section', 'provas');
      provas.appendChild(el('h3', null, item.provas.length === 1 ? 'Prova' : 'Provas'));
      item.provas.forEach(function (prova) { provas.appendChild(montarProva(item, prova)); });
      corpo.appendChild(provas);
    }
    interna.appendChild(corpo);
    interna.appendChild(el('footer', 'carta-pe', 'Entregue por ' + item.quemEntregou + ' · ' + haQuanto(item.entregueEm)));
    moldura.appendChild(interna);
    carta.appendChild(moldura);

    var carimboSim = el('div', 'carimbo carimbo-sim', amostra ? 'Confirmo' : 'Aceita');
    var carimboNao = el('div', 'carimbo carimbo-nao', 'Rejeita');
    carimboSim.setAttribute('aria-hidden', 'true');
    carimboNao.setAttribute('aria-hidden', 'true');
    carta.appendChild(carimboSim);
    carta.appendChild(carimboNao);
    slot.appendChild(carta);

    var acoes = el('div', 'acoes');
    var nao = el('button', 'botao botao-nao');
    nao.type = 'button';
    nao.innerHTML = ICONE_NAO;
    nao.appendChild(document.createTextNode('Rejeitar'));
    var sim = el('button', 'botao botao-sim');
    sim.type = 'button';
    sim.innerHTML = ICONE_SIM;
    sim.appendChild(document.createTextNode(amostra ? 'Confirmo' : 'Aceitar'));
    acoes.appendChild(nao);
    acoes.appendChild(sim);
    slot.appendChild(acoes);

    var ctx = { item: item, slot: slot, carta: carta, botoes: [nao, sim] };
    sim.addEventListener('click', function () { aceitar(ctx); });
    nao.addEventListener('click', function () { pedirMotivo(ctx); });
    ligarGesto(ctx);
    return slot;
  }

  // ---- gesto ----

  function pintarArraste(carta, dx) {
    var largura = carta.offsetWidth || 1;
    carta.style.transform = 'translateX(' + dx + 'px) rotate(' + dx / 22 + 'deg)';
    var forca = Math.min(1, Math.abs(dx) / (largura * LIMIAR));
    carta.style.setProperty('--forca-sim', dx > 0 ? String(forca) : '0');
    carta.style.setProperty('--forca-nao', dx < 0 ? String(forca) : '0');
  }

  function voltar(carta) {
    carta.classList.remove('arrastando');
    carta.style.transform = '';
    carta.style.setProperty('--forca-sim', '0');
    carta.style.setProperty('--forca-nao', '0');
  }

  function voar(carta, lado) {
    carta.classList.remove('arrastando');
    carta.style.transform = 'translateX(' + lado * 130 + 'vw) rotate(' + lado * 24 + 'deg)';
  }

  function ligarGesto(ctx) {
    var carta = ctx.carta;
    var inicio = null;
    var modo = null;
    var dx = 0;
    carta.addEventListener('pointerdown', function (e) {
      if (ctx.ocupado) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest && e.target.closest('a, button, pre, video, img.ampliada')) return;
      inicio = { x: e.clientX, y: e.clientY, id: e.pointerId };
      modo = null;
      dx = 0;
    });
    carta.addEventListener('pointermove', function (e) {
      if (!inicio || e.pointerId !== inicio.id) return;
      var mx = e.clientX - inicio.x;
      var my = e.clientY - inicio.y;
      if (!modo) {
        if (Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.3) {
          modo = 'h';
          carta.classList.add('arrastando');
          try { carta.setPointerCapture(e.pointerId); } catch (erro) { /* nada */ }
        } else if (Math.abs(my) > 12) {
          inicio = null;
          return;
        } else {
          return;
        }
      }
      dx = mx;
      pintarArraste(carta, dx);
    });
    function soltar(e) {
      if (!inicio || e.pointerId !== inicio.id) return;
      inicio = null;
      if (modo !== 'h') return;
      modo = null;
      var limite = (carta.offsetWidth || 300) * LIMIAR;
      if (e.type === 'pointerup' && dx > limite) aceitar(ctx);
      else if (e.type === 'pointerup' && dx < -limite) pedirMotivo(ctx);
      else voltar(carta);
    }
    carta.addEventListener('pointerup', soltar);
    carta.addEventListener('pointercancel', soltar);
  }

  // ---- decidir ----

  function travar(ctx, travado) {
    ctx.ocupado = travado;
    ctx.botoes.forEach(function (b) { b.disabled = travado; });
  }

  function enviarDecisao(corpo, tentativa) {
    return api('/api/decidir', { method: 'POST', body: JSON.stringify(corpo) }).catch(function (erro) {
      // Rede caiu no meio: reenvia uma vez o MESMO pedido; o PC não grava duas vezes.
      if (erro && erro.message !== 'nao-pareado' && tentativa === 0) {
        return new Promise(function (r) { setTimeout(r, 1500); }).then(function () { return enviarDecisao(corpo, 1); });
      }
      throw erro;
    });
  }

  function decidir(ctx, decisao, textoMotivo, opcao) {
    travar(ctx, true);
    voar(ctx.carta, decisao === 'aceitar' ? 1 : -1);
    var corpo = { pedidoId: idAleatorio(), itemId: ctx.item.id, decisao: decisao };
    if (textoMotivo) corpo.motivo = textoMotivo;
    if (opcao) corpo.opcao = opcao;
    enviarDecisao(corpo, 0)
      .then(function (resposta) {
        if (resposta.ok || resposta.status === 404) {
          if (resposta.ok) avisar(opcao ? 'Decidido: ' + opcao + '.' : decisao === 'aceitar' ? 'Aceita.' : 'Rejeitada. O motivo foi para quem entregou.');
          remover(ctx);
          return;
        }
        if (resposta.status === 409) {
          // O ledger recusou (já decidida, só leitura…): nada foi gravado. Mostra o motivo dele e refaz a fila.
          return resposta.json().then(function (dados) {
            avisar(dados && dados.mensagem ? 'Não gravou: ' + dados.mensagem : 'Não gravou.');
            carregar();
          });
        }
        throw new Error('falhou');
      })
      .catch(function (erro) {
        if (erro && erro.message === 'nao-pareado') return;
        voltar(ctx.carta);
        travar(ctx, false);
        avisar('Não gravou: sem conexão com o PC. Tente de novo.');
      });
  }

  function remover(ctx) {
    var proximo = ctx.slot.nextElementSibling;
    setTimeout(function () {
      ctx.slot.remove();
      total = Math.max(0, total - 1);
      atualizarContagem();
      if (total === 0) mostrarVazio();
      else if (proximo) proximo.scrollIntoView({ block: 'start' });
    }, 260);
  }

  function aceitar(ctx) {
    if (ctx.ocupado) return;
    decidir(ctx, 'aceitar', null);
  }

  function pedirMotivo(ctx) {
    if (ctx.ocupado) return;
    folhaPendente = ctx;
    pintarArraste(ctx.carta, -24);
    motivo.value = '';
    folha.hidden = false;
    setTimeout(function () { motivo.focus(); }, 50);
  }

  function fecharFolha() {
    folha.hidden = true;
    if (folhaPendente) voltar(folhaPendente.carta);
    folhaPendente = null;
  }

  document.getElementById('folha-cancelar').addEventListener('click', fecharFolha);
  folha.addEventListener('click', function (e) { if (e.target === folha) fecharFolha(); });
  folhaForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var texto = motivo.value.trim();
    if (!texto) {
      motivo.focus();
      return;
    }
    var ctx = folhaPendente;
    folhaPendente = null;
    folha.hidden = true;
    if (ctx) decidir(ctx, 'rejeitar', texto);
  });

  document.getElementById('atualizar').addEventListener('click', function () { carregar(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !folhaPendente) carregar();
  });

  parearPeloLink().then(carregar);
})();
