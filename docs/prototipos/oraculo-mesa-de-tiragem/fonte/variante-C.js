/* Variante C — MÃO E MESA. Um jogo de cartas: o dono segura a mão inteira (todas as cartas fechadas, em leque)
   e joga UMA na mesa. Na mesa, dois lugares marcados: o dourado (seguir a recomendação) e "Mais tarde".
   Arrastar a carta aberta para o dourado destrava; para "Mais tarde", ela volta ao fim da mão, esmaecida.
   No celular: a mão vira uma fileira no rodapé e o gesto único é o botão dourado no pé da carta.
   Zero estado global: tudo vive no fechamento de cada montar(). */
window.VARIANTES.C = {
  nome: 'Mão e mesa',
  sobre: 'Um jogo de cartas: você vê a mão inteira o tempo todo (quantas e quais decisões tem) e escolhe a ordem, '
    + 'jogando uma carta na mesa. Destravar é arrastar a carta aberta para o lugar dourado, que segue a recomendação; '
    + '"Mais tarde" devolve a carta ao fim da mão, esmaecida. No celular a mão é a fileira do rodapé e o gesto é o botão dourado.',
  montar: function (vista, cartas) {
    var O = window.Oraculo;
    var el = O.el, esc = O.esc;

    // ---------------------------------------------------------------- estado (só deste montar)
    var ordem = cartas.map(function (c, i) { return { c: c, i: i }; }).sort(function (a, b) {
      return (b.c.peso || 0) - (a.c.peso || 0) || (b.c.urgente ? 1 : 0) - (a.c.urgente ? 1 : 0) || a.i - b.i;
    }).map(function (x) { return x.c; });
    var pos = {};
    ordem.forEach(function (c, i) { pos[c.id] = i; });
    var total = ordem.length;
    var mao = ordem.slice();     // cartas na mão, na ordem em que aparecem
    var tarde = {};              // id -> quando (cartas adiadas: ficam no fim da mão, esmaecidas)
    var feitas = 0;              // quantas saíram da mesa decididas
    var jogada = null;           // { card, wrap }
    var ocupado = false;         // trava enquanto uma carta voa

    // ---------------------------------------------------------------- esqueleto
    var raiz = el('div', 'vC-raiz');
    var mesa = el('div', 'vC-mesa');
    var topo = el('div', 'vC-topo');
    var lTarde = el('button', 'vC-lugar vC-lugar-tarde',
      '<span class="vC-lugar-ic">☾</span><b>Mais tarde</b><small>volta amanhã cedo, no fim da sua mão</small>'
      + '<span class="vC-lugar-dica">arraste a carta aqui<kbd>←</kbd></span>');
    var lSeguir = el('button', 'vC-lugar vC-lugar-seguir',
      '<span class="vC-lugar-ic">✓</span><b class="vC-seg-tit">Seguir a recomendação</b><small class="vC-seg-sub"></small>'
      + '<span class="vC-lugar-dica"><span class="vC-seg-dica">arraste a carta aqui</span><kbd>→</kbd></span>');
    lTarde.type = lSeguir.type = 'button';
    var centro = el('div', 'vC-centro');
    var alvo = el('div', 'vC-alvo');
    centro.appendChild(alvo);
    var bSeguir = el('button', 'vC-seguir-btn', '<b class="vC-seg-tit">Seguir a recomendação</b><small class="vC-seg-sub"></small>');
    bSeguir.type = 'button';
    var pe = el('div', 'vC-pe');
    pe.appendChild(bSeguir);

    mesa.appendChild(topo);
    mesa.appendChild(lTarde);
    mesa.appendChild(centro);
    mesa.appendChild(lSeguir);
    mesa.appendChild(pe);

    var maoBox = el('div', 'vC-mao');
    var maoRot = el('div', 'vC-mao-rot');
    var leque = el('div', 'vC-leque');
    var devolver = el('div', 'vC-devolver', 'Solte para devolver à mão');
    maoBox.appendChild(maoRot);
    maoBox.appendChild(leque);
    maoBox.appendChild(devolver);

    raiz.appendChild(mesa);
    raiz.appendChild(maoBox);
    vista.appendChild(raiz);

    function celular() { return vista.clientWidth <= 640; }
    function ativas() { return mao.filter(function (c) { return !tarde[c.id]; }); }

    // ---------------------------------------------------------------- contagem
    function contar() {
      var at = ativas().length + (jogada ? 1 : 0);
      var nt = Object.keys(tarde).length;
      topo.innerHTML = '<span class="vC-topo-n"><b>' + at + '</b> ' + (at === 1 ? 'carta espera' : 'cartas esperam') + ' você</span>'
        + '<span class="vC-topo-x">' + (feitas ? feitas + (feitas === 1 ? ' destravada' : ' destravadas') : 'nenhuma destravada ainda')
        + (nt ? ' · ' + nt + ' para mais tarde' : '') + '</span>';
      var nm = mao.length;
      maoRot.innerHTML = '<b>Sua mão</b> · ' + (nm ? nm + (nm === 1 ? ' carta' : ' cartas') : 'vazia')
        + (nm ? '<span class="vC-mao-dica"> · ' + (celular() ? 'toque para abrir' : 'arraste uma para a mesa, ou clique') + '</span>' : '');
    }

    // ---------------------------------------------------------------- a mão
    function desenharMao() {
      // Mede ANTES de inserir: uma leitura de layout depois de inserir pinta as cartas novas com --vC-x: 0,
      // e o leque inteiro fechava no centro e reabria (0,22 s) a cada jogada.
      var cel = celular();
      var W = leque.clientWidth;
      leque.innerHTML = '';
      mao.forEach(function (card, i) {
        var w = el('div', 'vC-namao' + (tarde[card.id] ? ' vC-adiada' : ''));
        w.dataset.carta = card.id;
        var m = O.mini(card);
        m.setAttribute('aria-label', 'Abrir: ' + card.pergunta);
        w.appendChild(m);
        if (tarde[card.id]) w.appendChild(el('span', 'vC-volta', 'volta ' + esc(tarde[card.id])));
        if (!cel && i < 9) w.appendChild(el('kbd', 'vC-num', String(i + 1)));
        arrastarDaMao(w, card);
        leque.appendChild(w);
      });
      leque.classList.toggle('vC-vazio', !mao.length);
      if (!mao.length) leque.appendChild(el('div', 'vC-mao-vazia', 'Nenhuma carta na mão.'));
      leque_(W);
      contar();
    }

    // Leque: posição, giro e curva de cada carta (só vale no PC; no celular a CSS ignora estas variáveis).
    function leque_(largLeque) {
      var itens = leque.querySelectorAll('.vC-namao');
      var n = itens.length;
      if (!n) return;
      var W = largLeque || leque.clientWidth || 1000;
      var cw = 190;
      var passo = n > 1 ? Math.min(cw * 0.9, (W - cw - 40) / (n - 1)) : 0;
      var meio = (n - 1) / 2;
      var giro = Math.min(3, 14 / n);
      itens.forEach(function (it, i) {
        var d = i - meio;
        it.style.setProperty('--vC-x', (d * passo).toFixed(1) + 'px');
        it.style.setProperty('--vC-rot', (d * giro).toFixed(2) + 'deg');
        it.style.setProperty('--vC-y', (meio ? (d * d) * (9 / (meio * meio)) : 0).toFixed(1) + 'px');
        it.style.zIndex = String(10 + i);
      });
    }

    function arrastarDaMao(w, card) {
      var btn = w.querySelector('.oc-mini');
      var ini = null, arrastou = false;
      btn.addEventListener('click', function (e) {
        if (arrastou) { arrastou = false; e.preventDefault(); return; }
        jogar(card);
      });
      w.addEventListener('pointerdown', function (e) {
        if (celular() || ocupado || e.button > 0) return;
        ini = { x: e.clientX, y: e.clientY, id: e.pointerId };
        arrastou = false;
      });
      w.addEventListener('pointermove', function (e) {
        if (!ini || e.pointerId !== ini.id) return;
        var dx = e.clientX - ini.x, dy = e.clientY - ini.y;
        if (!arrastou && Math.hypot(dx, dy) < 7) return;
        if (!arrastou) { arrastou = true; try { w.setPointerCapture(e.pointerId); } catch (x) { /* ponteiro sintético */ } w.classList.add('vC-arrastando'); raiz.classList.add('vC-jogando'); }
        w.style.setProperty('--vC-dx', dx + 'px');
        w.style.setProperty('--vC-dy', dy + 'px');
        centro.classList.toggle('vC-quente', dentro(e, mesa) && !dentro(e, maoBox));
      });
      function soltar(e) {
        if (!ini || e.pointerId !== ini.id) return;
        ini = null;
        raiz.classList.remove('vC-jogando');
        centro.classList.remove('vC-quente');
        if (!arrastou) return;
        var naMesa = dentro(e, mesa) && !dentro(e, maoBox);
        w.classList.remove('vC-arrastando');
        if (naMesa) { jogar(card); return; }
        w.style.setProperty('--vC-dx', '0px');
        w.style.setProperty('--vC-dy', '0px');
      }
      w.addEventListener('pointerup', soltar);
      w.addEventListener('pointercancel', soltar);
    }

    function dentro(e, alvoEl) {
      var r = alvoEl.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    }

    // ---------------------------------------------------------------- a mesa
    function indice() { return O.ROMANOS[Math.min(feitas, total - 1)] + ' · ' + O.ROMANOS[total - 1]; }

    function jogar(card) {
      if (ocupado) return;
      if (jogada && jogada.card.id === card.id) return;
      if (jogada) voltarParaMao(jogada.card, false);
      mao = mao.filter(function (c) { return c.id !== card.id; });
      delete tarde[card.id];
      var wrap = el('div', 'vC-jogada vC-entra');
      var c = O.carta(card, {
        indice: indice(),
        aoDecidir: function (cd, res) { sair(cd, res); },
        aoAgoraNao: function (cd, quando) { adiar(cd, quando); },
      });
      wrap.appendChild(c);
      centro.querySelectorAll('.vC-jogada').forEach(function (x) { x.remove(); });
      centro.appendChild(wrap);
      jogada = { card: card, wrap: wrap };
      arrastarJogada(wrap, card);
      wrap.addEventListener('input', atualizarRec);
      wrap.addEventListener('click', function () { setTimeout(atualizarRec, 0); });
      setTimeout(function () { wrap.classList.remove('vC-entra'); }, 420);
      desenharMao();
      estadoMesa();
    }

    function voltarParaMao(card, comAnim) {
      mao.push(card);
      mao.sort(function (a, b) { return (tarde[a.id] ? 1000 : 0) + pos[a.id] - ((tarde[b.id] ? 1000 : 0) + pos[b.id]); });
      if (jogada && jogada.card.id === card.id) { jogada.wrap.remove(); jogada = null; }
      if (comAnim) {
        desenharMao();
        var it = leque.querySelector('[data-carta="' + card.id + '"]');
        if (it) it.classList.add('vC-chega');
        estadoMesa();
      }
    }

    // O que o lugar dourado faz com a carta da vez (às vezes ele não basta: falta a frase, ou não tem volta).
    function avaliar(card) {
      var r = card.resposta;
      var cr = card._raiz;
      if (r.tipo === 'livre') {
        var ta = cr && cr.querySelector('.oc-resp-livre textarea');
        var txt = ta && ta.value.trim();
        if (!txt) return { ok: false, cls: 'aviso', tit: 'Falta a sua frase', sub: 'Escreva na carta o que mudou', dica: 'depois arraste aqui', foco: ta };
        return { ok: true, sub: r.enviar, res: { caminho: r.enviar, texto: txt, rec: true } };
      }
      if (r.tipo === 'segurar') {
        var rc = r.caminhos.filter(function (c) { return c.rec && c.segurar; })[0];
        if (rc) return { ok: false, cls: 'nao', tit: 'Esta não tem volta', sub: 'Segure “' + rc.rotulo + '” na carta', dica: 'o lugar dourado não decide o que não se desfaz', foco: cr && cr.querySelector('.oc-segurar') };
      }
      if (r.tipo === 'texto') {
        var t = cr && cr.querySelector('.oc-msg-edit');
        if (t && t.value !== card._textoOriginal) return { ok: true, sub: 'Enviar o texto que você editou', res: { caminho: 'Enviar editado', texto: t.value, rec: false } };
      }
      if (r.tipo === 'lote') {
        var m = cr ? cr.querySelectorAll('.oc-item.trocando').length : 0;
        if (m) { var s = 'Seguir com ' + (r.itens.length - m) + ', mudar ' + m; return { ok: true, sub: s, res: { caminho: s, rec: false } }; }
      }
      return { ok: true, sub: card.rec.rotulo, res: { caminho: card.rec.rotulo, rec: true } };
    }

    function atualizarRec() {
      var a = jogada ? avaliar(jogada.card) : null;
      [lSeguir, bSeguir].forEach(function (b) {
        b.classList.toggle('vC-bloq', !!(a && !a.ok));
        b.classList.toggle('vC-bloq-nao', !!(a && a.cls === 'nao'));
        b.querySelector('.vC-seg-tit').textContent = a && !a.ok ? a.tit : 'Seguir a recomendação';
        b.querySelector('.vC-seg-sub').textContent = a ? a.sub : '';
        var d = b.querySelector('.vC-seg-dica');
        if (d) d.textContent = a && !a.ok ? a.dica : 'arraste a carta aqui';
      });
    }

    function estadoMesa() {
      var vazia = !jogada;
      mesa.classList.toggle('vC-sem-carta', vazia);
      alvo.innerHTML = '';
      if (vazia) {
        if (ativas().length) {
          alvo.className = 'vC-alvo vC-alvo-jogue';
          alvo.innerHTML = '<span class="vC-alvo-ic">' + (celular() ? '↓' : '↑') + '</span><b>Jogue uma carta aqui</b><span>'
            + (celular() ? 'Toque numa carta da sua mão, logo abaixo.' : 'Arraste uma carta da sua mão até a mesa, ou clique nela.') + '</span>';
        } else {
          alvo.className = 'vC-alvo oc-vazia';
          var inner = el('div');
          inner.appendChild(O.dorso());
          var nt = Object.keys(tarde).length;
          inner.appendChild(el('b', null, nt ? 'Mesa limpa.' : 'O baralho está vazio.'));
          inner.appendChild(el('span', null, nt
            ? 'Nada precisa de você agora. ' + (nt === 1 ? 'Uma carta volta' : nt + ' cartas voltam') + ' mais tarde; ' + (nt === 1 ? 'está esmaecida' : 'estão esmaecidas') + ' na sua mão.'
            : 'Nada precisa de você agora. Você destravou ' + feitas + (feitas === 1 ? ' decisão.' : ' decisões.')));
          alvo.appendChild(inner);
        }
      } else {
        alvo.className = 'vC-alvo';
      }
      atualizarRec();
      contar();
    }

    // ---------------------------------------------------------------- arrastar a carta aberta
    var INTERATIVO = 'button, textarea, input, select, a, summary, label, output, .oc-tela-aberta, .oc-saidas-painel';
    function arrastarJogada(wrap, card) {
      var ini = null, arr = false;
      wrap.addEventListener('pointerdown', function (e) {
        if (ocupado || e.button > 0) return;
        var t = e.target;
        if (t.closest(INTERATIVO)) return;
        if (e.pointerType !== 'mouse' && !t.closest('.oc-cabeca')) return; // no toque, só pela cabeça (o resto rola)
        if ((t.classList.contains('oc-rolagem') || t.classList.contains('oc-verso-corpo')) && e.offsetX > t.clientWidth) return; // barra de rolagem
        ini = { x: e.clientX, y: e.clientY, id: e.pointerId };
        arr = false;
        if (e.pointerType === 'mouse') e.preventDefault();
      });
      wrap.addEventListener('pointermove', function (e) {
        if (!ini || e.pointerId !== ini.id) return;
        var dx = e.clientX - ini.x, dy = e.clientY - ini.y;
        if (!arr && Math.hypot(dx, dy) < 8) return;
        if (!arr) { arr = true; try { wrap.setPointerCapture(e.pointerId); } catch (x) { /* ponteiro sintético */ } wrap.classList.add('vC-arrastando'); raiz.classList.add('vC-movendo'); }
        if (celular()) dx = dx * 0.35;
        wrap.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + (dx * 0.03).toFixed(2) + 'deg) scale(' + (celular() ? 1 : 0.92) + ')';
        var onde = alvoDe(e);
        lSeguir.classList.toggle('vC-quente', onde === 'seguir');
        lTarde.classList.toggle('vC-quente', onde === 'tarde');
        maoBox.classList.toggle('vC-quente', onde === 'mao');
      });
      function soltar(e) {
        if (!ini || e.pointerId !== ini.id) return;
        ini = null;
        raiz.classList.remove('vC-movendo');
        [lSeguir, lTarde, maoBox].forEach(function (x) { x.classList.remove('vC-quente'); });
        if (!arr) return;
        wrap.classList.remove('vC-arrastando');
        var onde = e.type === 'pointercancel' ? null : alvoDe(e);
        if (onde === 'seguir') { if (!seguir()) voltaAoLugar(wrap); return; }
        if (onde === 'tarde') { adiar(card, 'amanhã cedo'); return; }
        if (onde === 'mao') { devolver_(card); return; }
        voltaAoLugar(wrap);
      }
      wrap.addEventListener('pointerup', soltar);
      wrap.addEventListener('pointercancel', soltar);
    }
    function alvoDe(e) {
      if (!celular() && dentro(e, lSeguir)) return 'seguir';
      if (!celular() && dentro(e, lTarde)) return 'tarde';
      if (dentro(e, maoBox)) return 'mao';
      return null;
    }
    function voltaAoLugar(wrap) {
      wrap.classList.add('vC-volta-lugar');
      wrap.style.transform = '';
      setTimeout(function () { wrap.classList.remove('vC-volta-lugar'); }, 320);
    }

    // Voo da carta aberta até um lugar da mesa (ou para cima/baixo no celular).
    function voar(wrap, destino, depois) {
      ocupado = true;
      var r = wrap.getBoundingClientRect();
      var tr;
      if (destino && typeof destino !== 'string' && !celular()) {
        var d = destino.getBoundingClientRect();
        tr = 'translate(' + (d.left + d.width / 2 - (r.left + r.width / 2)) + 'px,' + (d.top + d.height / 2 - (r.top + r.height / 2)) + 'px) scale(.28) rotate(' + (destino === lSeguir ? 8 : -8) + 'deg)';
      } else {
        tr = destino === 'baixo' ? 'translateY(70%) scale(.5)' : 'translateY(-90%) scale(.7)';
      }
      wrap.classList.add('vC-voando');
      // força o estilo atual antes de animar
      void wrap.offsetWidth;
      wrap.style.transform = tr;
      wrap.style.opacity = '0';
      setTimeout(function () { wrap.remove(); ocupado = false; depois(); }, 460);
    }

    function seguir() {
      if (!jogada || ocupado) return false;
      var a = avaliar(jogada.card);
      if (!a.ok) {
        var w = jogada.wrap;
        w.classList.remove('vC-treme'); void w.offsetWidth; w.classList.add('vC-treme');
        [lSeguir, bSeguir].forEach(function (b) { b.classList.remove('vC-pulsa'); void b.offsetWidth; b.classList.add('vC-pulsa'); });
        if (a.foco) { rolarAte(a.foco); if (a.foco.focus) a.foco.focus({ preventScroll: true }); }
        return false;
      }
      var res = a.res;
      res.tipo = 'decidiu';
      sair(jogada.card, res);
      return true;
    }

    // Rola só a carta (scrollIntoView rolaria também a vista e a página).
    function rolarAte(alvoEl) {
      var rol = alvoEl.closest('.oc-rolagem');
      if (!rol) return;
      var a = alvoEl.getBoundingClientRect(), r = rol.getBoundingClientRect();
      rol.scrollTo({ top: rol.scrollTop + (a.top - r.top) - (rol.clientHeight - a.height) / 2, behavior: 'smooth' });
    }

    function sair(card, res) {
      if (!jogada || jogada.card.id !== card.id || ocupado) return;
      var w = jogada.wrap;
      jogada = null;
      lSeguir.classList.add('vC-aceso');
      bSeguir.classList.add('vC-aceso');
      voar(w, lSeguir, function () {
        lSeguir.classList.remove('vC-aceso');
        bSeguir.classList.remove('vC-aceso');
        feitas++;
        O.toast(vista, card, res);
        proxima();
      });
      estadoMesa();
    }

    function adiar(card, quando) {
      if (!jogada || jogada.card.id !== card.id || ocupado) return;
      var w = jogada.wrap;
      jogada = null;
      voar(w, celular() ? 'baixo' : lTarde, function () {
        tarde[card.id] = quando;
        voltarParaMao(card, true);
        O.toast(vista, card, { tipo: 'agora-nao', quando: quando });
        proxima();
      });
      estadoMesa();
    }

    function devolver_(card) {
      if (!jogada || ocupado) return;
      var w = jogada.wrap;
      jogada = null;
      voar(w, 'baixo', function () { voltarParaMao(card, true); });
      estadoMesa();
    }

    // Depois de uma decisão, a próxima carta da mão (a que mais trava) vem para a mesa. O dono troca quando quiser.
    function proxima() {
      var at = ativas();
      if (at.length) jogar(at[0]);
      else { desenharMao(); estadoMesa(); }
    }

    // ---------------------------------------------------------------- botões, teclado, tamanho
    lSeguir.addEventListener('click', function () { seguir(); });
    bSeguir.addEventListener('click', function () { seguir(); });
    lTarde.addEventListener('click', function () { if (jogada) adiar(jogada.card, 'amanhã cedo'); });

    function principal() {
      var pc = document.querySelector('.pc-tela .vista');
      return (pc || document.querySelector('.vista')) === vista;
    }
    function tecla(e) {
      if (!vista.isConnected) { document.removeEventListener('keydown', tecla); return; }
      if (!principal() || !vista.offsetParent) return;
      var t = e.target;
      if ((t.matches && t.matches('input, textarea, select')) || t.isContentEditable) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); seguir(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (jogada) adiar(jogada.card, 'amanhã cedo'); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (jogada) devolver_(jogada.card); }
      else if (/^[1-9]$/.test(e.key)) { var c = mao[+e.key - 1]; if (c) jogar(c); }
    }
    document.addEventListener('keydown', tecla);

    var largura = vista.clientWidth;
    if (window.ResizeObserver) {
      var espera = null;
      var ro = new ResizeObserver(function () {
        if (!vista.isConnected) { ro.disconnect(); return; }
        // espera o tamanho assentar (um print de página inteira muda a janela por um instante)
        clearTimeout(espera);
        espera = setTimeout(function () {
          var w = vista.clientWidth;
          if (!w || w === largura) return;
          var mudouForma = (largura <= 640) !== (w <= 640);
          largura = w;
          if (mudouForma) { desenharMao(); estadoMesa(); } else leque_();
        }, 160);
      });
      ro.observe(vista);
    }

    // dar as cartas: a que mais trava já vem jogada
    jogar(ordem[0]);
  },
};
