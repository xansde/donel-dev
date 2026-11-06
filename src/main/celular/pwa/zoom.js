// Oráculo no celular — a prova em tela cheia. Um print abre por cima de tudo, com zoom de pinça (ou roda do
// mouse), arrastar para mover e toque duplo para alternar entre a tela inteira e os pixels; o protótipo abre
// num quadro do tamanho da tela, navegável. Quando o navegador deixa, pede a tela cheia do aparelho também.
// Sai pelo ✕, pelo Esc, pelo "voltar" do celular ou (no print sem zoom) arrastando para baixo.
//
// Fica fora da carta de propósito: a carta tem transform (o giro do verso), e um `position: fixed` dentro
// dela ocupava só a carta, não a tela. Este arquivo é servido como está, sem build.
'use strict';

(function (raiz) {
  // ---- a conta do zoom ----

  var ESCALA_MAXIMA_MINIMA = 4;

  function zoomFrame(viewport, natural) {
    var largura = Math.max(1, natural.width);
    var altura = Math.max(1, natural.height);
    var encaixe = Math.min(1, viewport.width / largura, viewport.height / altura);
    var base = { width: largura * encaixe, height: altura * encaixe };
    return { viewport: viewport, base: base, maxScale: Math.max(ESCALA_MAXIMA_MINIMA, (2 * largura) / base.width) };
  }

  function prenderEixo(deslocamento, conteudo, espaco) {
    if (conteudo <= espaco) return (espaco - conteudo) / 2;
    return Math.min(0, Math.max(espaco - conteudo, deslocamento));
  }

  function clampView(frame, view) {
    var scale = Math.min(frame.maxScale, Math.max(1, view.scale));
    return {
      scale: scale,
      x: prenderEixo(view.x, frame.base.width * scale, frame.viewport.width),
      y: prenderEixo(view.y, frame.base.height * scale, frame.viewport.height),
    };
  }

  function initialView(frame) {
    return clampView(frame, { scale: 1, x: 0, y: 0 });
  }

  function zoomAt(frame, view, fator, ponto) {
    var scale = Math.min(frame.maxScale, Math.max(1, view.scale * fator));
    var razao = scale / view.scale;
    return clampView(frame, { scale: scale, x: ponto.x - (ponto.x - view.x) * razao, y: ponto.y - (ponto.y - view.y) * razao });
  }

  function panBy(frame, view, dx, dy) {
    return clampView(frame, { scale: view.scale, x: view.x + dx, y: view.y + dy });
  }

  function distancia(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function pinchView(frame, inicio, de, para) {
    var antes = distancia(de[0], de[1]);
    var fator = antes > 0 ? distancia(para[0], para[1]) / antes : 1;
    var meio0 = { x: (de[0].x + de[1].x) / 2, y: (de[0].y + de[1].y) / 2 };
    var meio1 = { x: (para[0].x + para[1].x) / 2, y: (para[0].y + para[1].y) / 2 };
    var scale = Math.min(frame.maxScale, Math.max(1, inicio.scale * fator));
    var razao = scale / inicio.scale;
    return clampView(frame, {
      scale: scale,
      x: meio0.x - (meio0.x - inicio.x) * razao + (meio1.x - meio0.x),
      y: meio0.y - (meio0.y - inicio.y) * razao + (meio1.y - meio0.y),
    });
  }

  function toggleZoom(frame, view, ponto, natural) {
    if (view.scale > 1.05) return initialView(frame);
    var pixels = natural.width / frame.base.width;
    return zoomAt(frame, view, Math.min(frame.maxScale, Math.max(2.5, pixels)) / view.scale, ponto);
  }

  var conta = {
    zoomFrame: zoomFrame,
    clampView: clampView,
    initialView: initialView,
    zoomAt: zoomAt,
    panBy: panBy,
    pinchView: pinchView,
    toggleZoom: toggleZoom,
  };

  // ---- a tela cheia ----

  var aberta = null; // a que está aberta: { fechar }
  var LARGURA_PC = 1280;

  function el(tag, classe, texto) {
    var node = raiz.document.createElement(tag);
    if (classe) node.className = classe;
    if (texto !== undefined && texto !== null) node.textContent = texto;
    return node;
  }

  function botao(classe, texto, rotulo) {
    var b = el('button', classe, texto);
    b.type = 'button';
    if (rotulo) b.setAttribute('aria-label', rotulo);
    return b;
  }

  /**
   * O véu com a barra de cima (título e ✕) e o palco. Fecham: ✕, Esc, o "voltar" do aparelho (uma entrada no
   * histórico, para o voltar do Android fechar a prova em vez de sair do app) e sair da tela cheia do aparelho.
   */
  function veu(titulo, aoFechar) {
    if (aberta) aberta.fechar();
    var doc = raiz.document;
    var fundo = el('div', 'zoom-veu');
    fundo.setAttribute('role', 'dialog');
    fundo.setAttribute('aria-modal', 'true');
    fundo.setAttribute('aria-label', titulo);
    var barra = el('div', 'zoom-barra');
    barra.appendChild(el('span', 'zoom-titulo', titulo));
    var ferramentas = el('div', 'zoom-ferramentas');
    barra.appendChild(ferramentas);
    var fechar = botao('zoom-fechar', '✕', 'Fechar');
    barra.appendChild(fechar);
    var palco = el('div', 'zoom-palco');
    fundo.appendChild(palco);
    fundo.appendChild(barra);
    var rolagemAntes = doc.body.style.overflow;
    doc.body.style.overflow = 'hidden';
    function teclas(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        api.fechar();
      }
    }
    var noHistorico = false;
    var naTelaCheia = false;
    function voltou() { api.fechar('voltar'); }
    function mudouTela() {
      if (doc.fullscreenElement === fundo) naTelaCheia = true;
      else if (naTelaCheia) api.fechar('tela');
    }
    var api = {
      fechar: function (origem) {
        if (aberta !== api) return;
        aberta = null;
        raiz.removeEventListener('keydown', teclas, true);
        raiz.removeEventListener('popstate', voltou);
        doc.removeEventListener('fullscreenchange', mudouTela);
        if (doc.fullscreenElement === fundo && doc.exitFullscreen) doc.exitFullscreen().catch(function () { /* nada */ });
        if (noHistorico && origem !== 'voltar') raiz.history.back();
        doc.body.style.overflow = rolagemAntes;
        fundo.remove();
        if (aoFechar) aoFechar();
      },
    };
    fechar.addEventListener('click', function () { api.fechar(); });
    raiz.addEventListener('keydown', teclas, true);
    doc.body.appendChild(fundo);
    aberta = api;
    try {
      raiz.history.pushState({ donelZoom: true }, '');
      noHistorico = true;
      raiz.addEventListener('popstate', voltou);
    } catch (erro) { /* sem histórico: fecha pelo ✕ */ }
    // Tela cheia do aparelho (some a barra do navegador). O iPhone não deixa: lá o véu já cobre a página.
    if (fundo.requestFullscreen && doc.fullscreenEnabled) {
      doc.addEventListener('fullscreenchange', mudouTela);
      fundo.requestFullscreen({ navigationUI: 'hide' }).catch(function () { /* recusou: fica o véu */ });
    }
    setTimeout(function () { fechar.focus(); }, 0);
    return { fundo: fundo, palco: palco, ferramentas: ferramentas, api: api };
  }

  function abrirImagem(src, rotulo) {
    var v = veu(rotulo || 'Print', function () { raiz.removeEventListener('resize', medir); });
    var img = el('img', 'zoom-img');
    img.alt = rotulo || 'Print da entrega';
    img.draggable = false;
    var menos = botao('zoom-acao', '−', 'Menos zoom');
    var nivel = el('span', 'zoom-nivel', '');
    var mais = botao('zoom-acao', '+', 'Mais zoom');
    var ajustar = botao('zoom-acao', 'Ajustar', 'Voltar à tela inteira');
    [menos, nivel, mais, ajustar].forEach(function (n) { v.ferramentas.appendChild(n); });
    var dica = el('div', 'zoom-dica', 'Pinça ou roda do mouse: zoom · toque duplo: aproxima · arraste para baixo ou ✕: sai');
    v.fundo.appendChild(dica);
    v.palco.appendChild(img);

    var frame = null;
    var vista = null;
    var natural = { width: 1, height: 1 };

    function pintar() {
      if (!frame) return;
      img.style.width = frame.base.width + 'px';
      img.style.height = frame.base.height + 'px';
      img.style.transform = 'translate(' + vista.x + 'px,' + vista.y + 'px) scale(' + vista.scale + ')';
      // A porcentagem é dos pixels do print: 100% = 1:1.
      nivel.textContent = Math.round((vista.scale * frame.base.width * 100) / natural.width) + '%';
      v.palco.style.cursor = vista.scale > 1.001 ? 'grab' : 'zoom-in';
      // A dica some enquanto há zoom: ela ficaria por cima do que você quer ler.
      dica.hidden = vista.scale > 1.001;
    }

    function medir() {
      var caixa = v.palco.getBoundingClientRect();
      var escalaAntes = vista ? vista.scale : 1;
      frame = zoomFrame({ width: caixa.width, height: caixa.height }, natural);
      vista = clampView(frame, { scale: escalaAntes, x: vista ? vista.x : 0, y: vista ? vista.y : 0 });
      pintar();
    }

    function centro() {
      return { x: frame.viewport.width / 2, y: frame.viewport.height / 2 };
    }

    function ponto(e) {
      var caixa = v.palco.getBoundingClientRect();
      return { x: e.clientX - caixa.left, y: e.clientY - caixa.top };
    }

    img.addEventListener('load', function () {
      natural = { width: img.naturalWidth || 1, height: img.naturalHeight || 1 };
      vista = null;
      medir();
      vista = initialView(frame);
      pintar();
    });
    img.src = src;
    raiz.addEventListener('resize', medir);

    menos.addEventListener('click', function () { if (frame) { vista = zoomAt(frame, vista, 1 / 1.5, centro()); pintar(); } });
    mais.addEventListener('click', function () { if (frame) { vista = zoomAt(frame, vista, 1.5, centro()); pintar(); } });
    ajustar.addEventListener('click', function () { if (frame) { vista = initialView(frame); pintar(); } });

    v.palco.addEventListener(
      'wheel',
      function (e) {
        if (!frame) return;
        e.preventDefault();
        var passo = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        vista = zoomAt(frame, vista, Math.exp(-passo * 0.0015), ponto(e));
        pintar();
      },
      { passive: false },
    );

    // Dedos (ou o mouse) no palco: um arrasta, dois fazem a pinça; dois toques rápidos alternam o zoom.
    var dedos = {};
    var pinca = null;
    var ultimoToque = null;
    var andou = false;
    var inicioToque = null;
    var descida = 0;

    function lista() {
      return Object.keys(dedos).map(function (k) { return dedos[k]; });
    }

    v.palco.addEventListener('pointerdown', function (e) {
      if (!frame) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try { v.palco.setPointerCapture(e.pointerId); } catch (erro) { /* nada */ }
      dedos[e.pointerId] = ponto(e);
      andou = false;
      inicioToque = dedos[e.pointerId];
      var atuais = lista();
      if (atuais.length === 2) pinca = { inicio: vista, de: [atuais[0], atuais[1]] };
      if (vista.scale > 1.001) v.palco.style.cursor = 'grabbing';
    });

    v.palco.addEventListener('pointermove', function (e) {
      var antes = dedos[e.pointerId];
      if (!antes || !frame) return;
      var agora = ponto(e);
      dedos[e.pointerId] = agora;
      if (inicioToque && Math.hypot(agora.x - inicioToque.x, agora.y - inicioToque.y) > 8) andou = true;
      var atuais = lista();
      if (pinca && atuais.length >= 2) vista = pinchView(frame, pinca.inicio, pinca.de, [atuais[0], atuais[1]]);
      else if (atuais.length === 1 && vista.scale <= 1.001 && inicioToque) {
        // Sem zoom, arrastar para baixo puxa o print para fora (solto no meio do caminho, ele volta).
        descida = Math.max(0, agora.y - inicioToque.y);
        img.style.translate = '0 ' + descida + 'px';
        v.fundo.style.backgroundColor = 'rgba(11, 10, 16, ' + Math.max(0.35, 1 - descida / 400) + ')';
        return;
      } else if (atuais.length === 1) vista = panBy(frame, vista, agora.x - antes.x, agora.y - antes.y);
      pintar();
    });

    function soltar(e) {
      if (!dedos[e.pointerId]) return;
      var onde = dedos[e.pointerId];
      delete dedos[e.pointerId];
      if (descida > 0) {
        var saiu = descida > 110 && e.type === 'pointerup';
        descida = 0;
        img.style.translate = '';
        v.fundo.style.backgroundColor = '';
        if (saiu) {
          v.api.fechar();
          return;
        }
      }
      var restantes = lista();
      if (restantes.length < 2) pinca = null;
      if (restantes.length === 2) pinca = { inicio: vista, de: [restantes[0], restantes[1]] };
      pintar();
      if (e.type !== 'pointerup' || andou || restantes.length > 0) {
        ultimoToque = null;
        return;
      }
      var agora = Date.now();
      if (ultimoToque && agora - ultimoToque.em < 320 && Math.hypot(onde.x - ultimoToque.x, onde.y - ultimoToque.y) < 30) {
        vista = toggleZoom(frame, vista, onde, natural);
        pintar();
        ultimoToque = null;
      } else {
        ultimoToque = { em: agora, x: onde.x, y: onde.y };
      }
    }
    v.palco.addEventListener('pointerup', soltar);
    v.palco.addEventListener('pointercancel', soltar);
    return v.api;
  }

  /**
   * O protótipo do tamanho da tela, navegável, isolado como dentro da carta: `sandbox="allow-scripts"` sem
   * `allow-same-origin`. `obterUrl` devolve o endereço (no celular, um bilhete novo de uso único).
   */
  function abrirPrototipo(obterUrl, rotulo) {
    var v = veu(rotulo || 'Protótipo');
    v.fundo.classList.add('zoom-veu-proto');
    var espera = el('p', 'zoom-espera', 'Abrindo o protótipo…');
    v.palco.appendChild(espera);
    Promise.resolve()
      .then(obterUrl)
      .catch(function () { return null; })
      .then(function (url) {
        if (aberta !== v.api) return;
        if (!url) {
          espera.textContent = 'Não consegui abrir o protótipo. Feche e tente de novo.';
          return;
        }
        var frame = el('iframe', 'zoom-proto');
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.title = rotulo || 'Protótipo anexado à entrega';
        frame.src = url;
        v.palco.replaceChild(frame, espera);
        // Protótipo de tela de computador fica espremido no celular: "Como no PC" mostra a largura do PC inteira,
        // encolhida para caber (a pinça do navegador aproxima). Mudar o tamanho não recarrega o quadro.
        if (v.palco.getBoundingClientRect().width >= LARGURA_PC * 0.7) return;
        var modo = botao('zoom-acao', 'Como no PC', 'Mostrar na largura do computador');
        v.ferramentas.appendChild(modo);
        var comoPc = false;
        function ajustar() {
          var caixa = v.palco.getBoundingClientRect();
          var escala = caixa.width / LARGURA_PC;
          frame.style.width = comoPc ? LARGURA_PC + 'px' : '';
          frame.style.height = comoPc ? caixa.height / escala + 'px' : '';
          frame.style.transform = comoPc ? 'scale(' + escala + ')' : '';
          modo.textContent = comoPc ? 'Como no celular' : 'Como no PC';
        }
        modo.addEventListener('click', function () {
          comoPc = !comoPc;
          ajustar();
        });
        raiz.addEventListener('resize', ajustar);
      });
    return v.api;
  }

  raiz.DonelZoom = {
    conta: conta,
    abrirImagem: abrirImagem,
    abrirPrototipo: abrirPrototipo,
    aberto: function () { return aberta !== null; },
  };
})(typeof window !== 'undefined' ? window : this);
