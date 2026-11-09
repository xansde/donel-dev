/* Variante D — O QUE DESTRAVA. A mesa organizada pelo que está parado esperando o dono.
   Cada coisa parada é uma trava: o nome do que parou, a barra listrada "parado" e, sobre ela, a carta fechada
   que a destrava. O botão dourado da carta segue a recomendação num toque (com Desfazer por 4 s); tocar na
   carta abre ela inteira numa folha (lateral no PC, de baixo para cima no celular).
   Zero estado global: tudo vive no fechamento de cada montar(). */
window.VARIANTES = window.VARIANTES || {};
window.VARIANTES.D = {
  nome: 'O que destrava',
  sobre: 'A mesa mostra o que está parado esperando você, por quadro: cada coisa parada tem a barra listrada e, '
    + 'sobre ela, a carta que a destrava; a que trava tudo vem primeiro e maior. Destravar é o botão dourado da '
    + 'carta (segue a recomendação num toque, com Desfazer por 4 segundos): a barra fica verde e a coisa sai da mesa. '
    + 'Tocar na carta abre ela inteira ao lado (no celular, de baixo para cima) para ler, virar ou escolher outro caminho.',
  montar: function (vista, cartas) {
    var O = window.Oraculo;
    var el = O.el, esc = O.esc;
    var ESPERA = 4000;

    // O que trava tudo primeiro (peso), depois o que já está atrasado (urgente), depois a ordem de chegada.
    var ordem = cartas.map(function (c, i) { return { c: c, i: i }; }).sort(function (a, b) {
      return (b.c.peso || 0) - (a.c.peso || 0) || (b.c.urgente ? 1 : 0) - (a.c.urgente ? 1 : 0) || a.i - b.i;
    }).map(function (x) { return x.c; });
    var total = ordem.length;

    var travas = {};      // id -> { card, pos, no, poe, estado: 'parado' | 'andando' | 'fora', grupo, removida }
    var grupos = [];      // { nome, sec, conta, ids }
    var pendente = null;  // { id, timer } — a última destravada, que ainda pode ser desfeita
    var aberta = null;    // id da carta aberta na folha

    // ------------------------------------------------------------------ esqueleto
    var raiz = el('div', 'vD-raiz');
    var mesa = el('section', 'vD-mesa');
    var topo = el('header', 'vD-topo');
    var titulo = el('h2', 'vD-titulo');
    var sub = el('p', 'vD-sub', 'Uma carta destrava cada uma. O botão dourado segue a minha recomendação num toque; '
      + 'toque na carta para ler inteira ou responder de outro jeito.');
    var leg = el('div', 'vD-legenda', '<span class="p"><i></i>parado</span><span class="a"><i></i>andando</span>');
    topo.appendChild(titulo);
    topo.appendChild(leg);
    topo.appendChild(sub);
    var corpo = el('div', 'vD-corpo');
    var aviso = el('div', 'vD-aviso', '<div class="vD-aviso-txt"></div><button type="button" class="vD-desfazer">Desfazer</button><i class="vD-tempo"></i>');
    aviso.setAttribute('role', 'status');
    mesa.appendChild(topo);
    mesa.appendChild(corpo);
    mesa.appendChild(aviso);

    var folha = el('aside', 'vD-folha', '<div class="vD-folha-in">'
      + '<div class="vD-alca"><button type="button" aria-label="Fechar a carta"><i></i></button></div>'
      + '<div class="vD-folha-topo"><span class="vD-folha-rot"></span><button type="button" class="vD-fechar">Fechar ✕</button></div>'
      + '<div class="vD-folha-carta"></div></div>');
    folha.inert = true;
    var veu = el('div', 'vD-veu');
    raiz.appendChild(mesa);
    raiz.appendChild(folha);
    raiz.appendChild(veu);
    vista.appendChild(raiz);

    var caixaCarta = folha.querySelector('.vD-folha-carta');
    var rotFolha = folha.querySelector('.vD-folha-rot');
    folha.querySelector('.vD-fechar').addEventListener('click', fechar);
    folha.querySelector('.vD-alca button').addEventListener('click', fechar);
    veu.addEventListener('click', fechar);
    aviso.querySelector('.vD-desfazer').addEventListener('click', desfazer);
    ligarAlca(folha.querySelector('.vD-alca'));

    // ------------------------------------------------------------------ as travas, por quadro
    var heroi = ordem.filter(function (c) { return (c.peso || 0) >= 3; });
    var resto = ordem.filter(function (c) { return (c.peso || 0) < 3; });

    heroi.forEach(function (c) {
      var g = novoGrupo(c.quadro, 'vD-heroi', '<span class="vD-tudo">Trava tudo</span>');
      corpo.appendChild(g.sec);
      g.lista.appendChild(novaTrava(c, g, true));
    });
    var colunas = el('div', 'vD-grupos');
    corpo.appendChild(colunas);
    var porNome = {};
    resto.forEach(function (c) {
      var g = porNome[c.quadro];
      if (!g) { g = porNome[c.quadro] = novoGrupo(c.quadro); colunas.appendChild(g.sec); }
      g.lista.appendChild(novaTrava(c, g, false));
    });
    contar();

    function novoGrupo(nome, cls, antes) {
      var sec = el('section', 'vD-grupo' + (cls ? ' ' + cls : ''));
      var h = el('h3', null, (antes || '') + '<span class="vD-quadro">' + esc(nome) + '</span><small></small>');
      var lista = el('div', 'vD-lista');
      sec.appendChild(h);
      sec.appendChild(lista);
      var g = { nome: nome, sec: sec, conta: h.querySelector('small'), lista: lista, ids: [] };
      grupos.push(g);
      return g;
    }

    // Como a carta destrava num toque depende da resposta que ela pede.
    function modoDe(card) {
      var r = card.resposta;
      if (r.tipo === 'fiz') return 'fiz';          // só o dono faz (ex.: criar a chave): abre os passos
      if (r.tipo === 'livre') return 'livre';      // pede uma frase dele: abre a carta no campo
      if (r.tipo === 'segurar' && r.caminhos.some(function (c) { return c.rec && c.segurar; })) return 'segurar'; // sem volta
      return 'toque';
    }

    function novaTrava(card, g, grande) {
      var pos = ordem.indexOf(card);
      var no = el('div', 'vD-trava' + (grande ? ' vD-grande' : '') + (card.urgente ? ' vD-atrasada' : ''));
      no.dataset.id = card.id;
      var dentro = el('div', 'vD-trava-in');
      var coisa = el('div', 'vD-coisa',
        '<div class="vD-cima"><b class="vD-nome">' + esc(card.destravaCurto) + '</b></div>'
        + '<div class="vD-baixo"><span class="vD-estado">parado</span><small class="vD-desde">' + esc(card.desde) + '</small></div>');
      var trilho = el('div', 'vD-trilho');
      var poe = el('div', 'vD-poe');

      var m = O.mini(card, { tag: 'div' });
      m.tabIndex = 0;
      m.setAttribute('role', 'button');
      m.setAttribute('aria-label', 'Abrir a carta inteira: ' + card.pergunta);

      var modo = modoDe(card);
      var pe = el('div', 'vD-pe');
      var b = el('button', 'vD-btn');
      b.type = 'button';
      var segue;
      if (modo === 'fiz') {
        b.textContent = 'Fazer agora';
        segue = 'Só você faz' + (card.visual && card.visual.nota ? ' · ' + esc(card.visual.nota) : '');
      } else if (modo === 'livre') {
        b.textContent = 'Responder';
        segue = 'Precisa de uma frase sua';
      } else if (modo === 'segurar') {
        var cs = card.resposta.caminhos.filter(function (c) { return c.rec && c.segurar; })[0];
        b.className = 'vD-btn vD-segurar';
        b.innerHTML = '<span class="vD-enche"></span><span class="vD-btn-txt">' + esc(cs.segurar) + '</span>';
        segue = '<b>Não tem volta</b>: segure até encher';
      } else {
        b.textContent = 'Destravar';
        segue = 'Segue: <b>' + esc(card.rec.rotulo) + '</b>';
      }
      pe.appendChild(b);
      pe.appendChild(el('span', 'vD-segue', segue));
      m.appendChild(pe);
      poe.appendChild(m);

      dentro.appendChild(coisa);
      dentro.appendChild(trilho);
      dentro.appendChild(poe);
      no.appendChild(dentro);

      var T = { card: card, pos: pos, no: no, poe: poe, estadoTxt: coisa.querySelector('.vD-estado'), estado: 'parado', grupo: g };
      travas[card.id] = T;
      g.ids.push(card.id);

      m.addEventListener('click', function (e) {
        if (e.target.closest('.vD-btn')) return;
        abrir(card.id);
      });
      m.addEventListener('keydown', function (e) {
        if (e.target !== m) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(card.id); }
      });

      if (modo === 'toque') {
        b.addEventListener('click', function () { destravar(card.id, { caminho: card.rec.rotulo, rec: true, tipo: 'decidiu' }); });
      } else if (modo === 'fiz') {
        b.addEventListener('click', function () { abrir(card.id, '.oc-vis'); });
      } else if (modo === 'livre') {
        b.addEventListener('click', function () { abrir(card.id, '.oc-resp-livre textarea'); });
      } else {
        // Segurar 1,2 s para confirmar o que não tem volta.
        var timer = null;
        var cs2 = card.resposta.caminhos.filter(function (c) { return c.rec && c.segurar; })[0];
        var ini = function (e) {
          e.preventDefault();
          b.classList.add('segurando');
          timer = setTimeout(function () { b.classList.remove('segurando'); destravar(card.id, { caminho: cs2.rotulo, rec: true, tipo: 'decidiu' }); }, 1200);
        };
        var fim = function () { b.classList.remove('segurando'); clearTimeout(timer); };
        b.addEventListener('pointerdown', ini);
        b.addEventListener('pointerup', fim);
        b.addEventListener('pointerleave', fim);
        b.addEventListener('pointercancel', fim);
        b.addEventListener('contextmenu', function (e) { e.preventDefault(); }); // segurar no celular não abre o menu
      }
      return no;
    }

    // ------------------------------------------------------------------ destravar, desfazer, sair da mesa
    function destravar(id, res) {
      var T = travas[id];
      if (!T || T.estado !== 'parado') return;
      if (aberta === id) fechar();
      if (pendente) confirmar(pendente.id, false);
      var adiada = res.tipo === 'agora-nao';
      T.estado = adiada ? 'fora' : 'andando';
      T.no.classList.add(adiada ? 'adiada' : 'andando');
      T.estadoTxt.textContent = adiada ? 'volta ' + res.quando : 'andando';
      T.poe.classList.remove('vD-volta');
      T.poe.classList.add('vD-sai-carta');
      contar();
      mostrarAviso(T, res);
      setTimeout(function () { if (T.estado !== 'parado') T.no.classList.add('vD-sem-carta'); }, 420);
      pendente = { id: id, timer: setTimeout(function () { confirmar(id, true); }, ESPERA) };
    }

    function desfazer() {
      if (!pendente) return;
      var T = travas[pendente.id];
      clearTimeout(pendente.timer);
      pendente = null;
      T.estado = 'parado';
      T.no.classList.remove('andando', 'adiada', 'vD-sem-carta');
      T.estadoTxt.textContent = 'parado';
      T.poe.classList.remove('vD-sai-carta');
      T.poe.classList.add('vD-volta');
      esconderAviso();
      contar();
    }

    // Passado o Desfazer, a trava sai da mesa: aqui só fica o que ainda espera você.
    function confirmar(id, doTempo) {
      if (pendente && pendente.id === id) { clearTimeout(pendente.timer); pendente = null; if (doTempo) esconderAviso(); }
      var T = travas[id];
      var no = T.no;
      no.style.height = no.offsetHeight + 'px';
      void no.offsetHeight;
      no.classList.add('vD-sai');
      no.style.height = '0px';
      setTimeout(function () {
        no.remove();
        T.removida = true;
        var g = T.grupo;
        var vivos = g.ids.filter(function (x) { return !travas[x].removida; });
        if (!vivos.length) g.sec.remove();
        contar();
        if (Object.keys(travas).every(function (x) { return travas[x].removida; })) vazia();
      }, 380);
    }

    function contar() {
      var n = 0;
      Object.keys(travas).forEach(function (id) { if (travas[id].estado === 'parado') n++; });
      titulo.innerHTML = n
        ? '<span class="vD-n">' + n + '</span> ' + (n === 1 ? 'coisa parada esperando você' : 'coisas paradas esperando você')
          + '<small>' + (n === 1 ? '1 carta na mesa' : n + ' cartas na mesa') + '</small>'
        : 'Nada parado esperando você<small>0 cartas na mesa</small>';
      grupos.forEach(function (g) {
        var k = g.ids.filter(function (x) { return travas[x].estado === 'parado'; }).length;
        g.conta.textContent = k ? (k === 1 ? '1 parada' : k + ' paradas') : 'andando';
        g.sec.classList.toggle('vD-grupo-livre', !k);
      });
    }

    function vazia() {
      corpo.innerHTML = '';
      sub.remove();
      leg.remove();
      var v = el('div', 'oc-vazia vD-vazia');
      var d = el('div');
      d.appendChild(O.dorso());
      d.appendChild(el('b', null, 'Mesa limpa'));
      d.appendChild(el('span', null, 'O baralho está vazio. Nada parado esperando você.'));
      v.appendChild(d);
      corpo.appendChild(v);
    }

    function mostrarAviso(T, res) {
      var txt = aviso.querySelector('.vD-aviso-txt');
      if (res.tipo === 'agora-nao') {
        txt.innerHTML = '<span>Fora da mesa: <b class="neutro">' + esc(T.card.destravaCurto) + '</b>. Volta ' + esc(res.quando) + '.</span>';
      } else {
        var o = res.tipo === 'decida-voce' ? 'A sessão segue a recomendação.' : 'Você escolheu: ' + esc(res.caminho) + '.';
        txt.innerHTML = '<span><b>Destravado</b> ' + esc(T.card.destravaCurto) + ' volta a andar. ' + o + '</span>';
      }
      var tempo = aviso.querySelector('.vD-tempo');
      tempo.style.animation = 'none';
      void tempo.offsetWidth;
      tempo.style.animation = '';
      aviso.classList.add('on');
    }
    function esconderAviso() { aviso.classList.remove('on'); }

    // ------------------------------------------------------------------ a carta inteira, na folha
    function abrir(id, foco) {
      var T = travas[id];
      if (!T || T.estado !== 'parado') return;
      if (aberta && travas[aberta]) travas[aberta].no.classList.remove('aberta');
      aberta = id;
      T.no.classList.add('aberta');
      caixaCarta.innerHTML = '';
      caixaCarta.appendChild(O.carta(T.card, {
        indice: O.ROMANOS[T.pos] + ' · ' + O.ROMANOS[total - 1],
        aoDecidir: function (c, res) { destravar(id, res); },
        aoAgoraNao: function (c, quando) { destravar(id, { tipo: 'agora-nao', quando: quando }); },
      }));
      rotFolha.textContent = T.card.quadro + ' · destrava: ' + T.card.destravaCurto;
      folha.inert = false;
      folha.style.transform = '';
      raiz.classList.add('com-folha');
      setTimeout(function () { if (aberta === id) revelar(corpo, T.no, false); }, 340);
      if (foco) {
        setTimeout(function () {
          var x = caixaCarta.querySelector(foco);
          if (!x) return;
          revelar(x.closest('.oc-rolagem'), x, false);
          if (x.focus) x.focus({ preventScroll: true });
        }, 380);
      }
    }

    // Rola só o contêiner certo: scrollIntoView rolaria também a vista (overflow hidden) e deslocaria a mesa.
    function revelar(caixa, alvo, centro) {
      if (!caixa || !alvo) return;
      var c = caixa.getBoundingClientRect(), r = alvo.getBoundingClientRect(), d = 0;
      if (centro) d = (r.top + r.height / 2) - (c.top + c.height / 2);
      else if (r.top < c.top) d = r.top - c.top - 10;
      else if (r.bottom > c.bottom - 30) d = r.bottom - c.bottom + 40;
      if (d) caixa.scrollBy({ top: d, behavior: 'smooth' });
    }

    function fechar() {
      if (aberta && travas[aberta]) travas[aberta].no.classList.remove('aberta');
      aberta = null;
      raiz.classList.remove('com-folha');
      folha.inert = true;
      folha.style.transform = '';
    }

    // No celular, puxar a alça para baixo fecha a folha.
    function ligarAlca(alca) {
      var y0 = null, dy = 0;
      alca.addEventListener('pointerdown', function (e) { y0 = e.clientY; dy = 0; folha.classList.add('arrastando'); alca.setPointerCapture(e.pointerId); });
      alca.addEventListener('pointermove', function (e) {
        if (y0 == null) return;
        dy = Math.max(0, e.clientY - y0);
        folha.style.transform = 'translateY(' + dy + 'px)';
      });
      var solta = function () {
        if (y0 == null) return;
        y0 = null;
        folha.classList.remove('arrastando');
        if (dy > 90) fechar(); else folha.style.transform = '';
      };
      alca.addEventListener('pointerup', solta);
      alca.addEventListener('pointercancel', solta);
    }

    // Teclado: só a primeira vista de PC (ou a única vista) responde, e só enquanto está na tela.
    function aoTeclar(e) {
      if (!vista.isConnected) { document.removeEventListener('keydown', aoTeclar); return; }
      var dona = document.querySelector('.pc .vista') || document.querySelector('.vista');
      if (dona !== vista || !vista.getClientRects().length) return;
      if (e.key === 'Escape' && aberta) { e.preventDefault(); fechar(); }
    }
    document.addEventListener('keydown', aoTeclar);
  },
};
