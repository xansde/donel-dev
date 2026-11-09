/* Variante B — UMA CARTA POR VEZ. O baralho puro: a carta da vez, o índice e os dorsos que restam.
   Arrastar para a direita segue a recomendação; para a esquerda, "Agora não" (volta amanhã cedo).
   Zero estado global: tudo vive no fechamento de cada montar(). */
window.VARIANTES.B = {
  nome: 'Uma carta por vez',
  sobre: 'O baralho puro, no PC e no celular: só a carta da vez, o índice e os dorsos do que resta, '
    + 'com o que trava tudo primeiro. Destravar é arrastar a carta para a direita (segue a recomendação) '
    + 'ou para a esquerda (agora não, volta amanhã cedo); no PC as setas fazem o mesmo e o espaço vira a carta.',
  montar: function (vista, cartas) {
    var O = window.Oraculo;
    var el = O.el, esc = O.esc;

    // Ordem: o que trava tudo primeiro (peso), depois o parado (urgente), depois a ordem de chegada.
    var fila = cartas.map(function (c, i) { return { c: c, i: i }; }).sort(function (a, b) {
      return (b.c.peso || 0) - (a.c.peso || 0) || (b.c.urgente ? 1 : 0) - (a.c.urgente ? 1 : 0) || a.i - b.i;
    }).map(function (x) { return x.c; });
    var total = fila.length;
    var pos = 0;          // quantas já saíram da mesa
    var saindo = false;   // trava enquanto uma carta voa
    var atual = null;     // { card, wrap, carta, carimbo }

    var mesa = el('div', 'vB-mesa');
    var dEsq = el('button', 'vB-dica esq', '<span class="seta">←</span><span class="txt"><b>Agora não</b><small>volta amanhã cedo</small></span><kbd>←</kbd>');
    var dDir = el('button', 'vB-dica dir', '<span class="seta">→</span><span class="txt"><b>Seguir a recomendação</b><small class="rec"></small></span><kbd>→</kbd>');
    dEsq.type = dDir.type = 'button';
    var pilha = el('div', 'vB-pilha');
    var espaco = el('div', 'vB-espaco', '<kbd>espaço</kbd> vira a carta');
    mesa.appendChild(dEsq);
    mesa.appendChild(pilha);
    mesa.appendChild(dDir);
    mesa.appendChild(espaco);
    vista.appendChild(mesa);

    dEsq.addEventListener('click', function () { dEsq.blur(); agoraNao('amanhã cedo'); });
    dDir.addEventListener('click', function () { dDir.blur(); seguir(); });

    // ---------------------------------------------------------------- a carta da vez
    function rom(i) { return O.ROMANOS[i] || String(i + 1); }  // a base só tem romanos até XII
    function indice() { return rom(pos) + ' · ' + rom(total - 1); }

    // Quando arrastar à direita NÃO basta: resposta que pede frase, ou recomendação sem volta.
    function bloqueio(card) {
      var r = card.resposta;
      if (r.tipo === 'livre') {
        var ta = atual && atual.wrap.querySelector('.oc-resp-livre textarea');
        if (!ta || !ta.value.trim()) return { cls: 'aviso', t: 'Falta sua frase', s: 'escreva na carta e arraste de novo', foco: ta };
      }
      if (r.tipo === 'segurar') {
        var rc = r.caminhos.filter(function (c) { return c.rec && c.segurar; })[0];
        if (rc) return { cls: 'nao', t: 'Não tem volta', s: 'segure o botão na carta', foco: atual && atual.wrap.querySelector('.oc-segurar') };
      }
      return null;
    }
    function dicaDireita(card) {
      var r = card.resposta;
      if (r.tipo === 'livre') return 'Escreva na carta o que mudou, depois arraste';
      if (r.tipo === 'segurar' && r.caminhos.some(function (c) { return c.rec && c.segurar; })) return 'Esta não tem volta: segure o botão na carta';
      return card.rec.rotulo;
    }

    function mostrar() {
      pilha.innerHTML = '';
      pilha.style.setProperty('--vB-sobe', '0');
      atual = null;
      saindo = false;
      var resta = total - pos;
      mesa.classList.toggle('vB-fim', resta <= 0);
      if (resta <= 0) {
        var v = el('div', 'oc-vazia vB-vazia');
        var inner = el('div');
        inner.appendChild(O.dorso());
        inner.appendChild(el('b', null, 'O baralho está vazio.'));
        inner.appendChild(el('span', null, 'Nada precisa de você agora.'));
        v.appendChild(inner);
        pilha.appendChild(v);
        return;
      }
      // dorsos do que resta, atrás da carta
      var n = Math.min(3, resta - 1);
      for (var k = n; k >= 1; k--) {
        var d = O.dorso();
        d.classList.add('vB-dorso', 'vB-d' + k);
        pilha.appendChild(d);
      }
      var card = fila[pos];
      var wrap = el('div', 'vB-atual vB-entra');
      var c = O.carta(card, {
        indice: indice(),
        aoDecidir: function (cd, res) { sair('direita', res); },
        aoAgoraNao: function (cd, quando) { sair('esquerda', { tipo: 'agora-nao', quando: quando }); },
      });
      wrap.appendChild(c);
      var carimbo = el('div', 'vB-carimbo');
      wrap.appendChild(carimbo);
      pilha.appendChild(wrap);
      atual = { card: card, wrap: wrap, carta: c, carimbo: carimbo };
      dDir.querySelector('.rec').textContent = dicaDireita(card);
      ligarGesto(wrap);
      setTimeout(function () { wrap.classList.remove('vB-entra'); }, 400);
    }

    function pintarCarimbo(dir, forca, quando) {
      if (!atual) return;
      var k = atual.carimbo, card = atual.card;
      if (!dir) { k.className = 'vB-carimbo'; k.style.opacity = 0; k.style.translate = ''; pilha.style.setProperty('--vB-sobe', '0'); return; }
      var b = dir === 'direita' ? bloqueio(card) : null;
      var cls = dir === 'esquerda' ? 'esq' : b ? 'dir ' + b.cls : 'dir';
      var html = dir === 'esquerda' ? 'Agora não<small>volta ' + esc(quando || 'amanhã cedo') + '</small>'
        : b ? esc(b.t) + '<small>' + esc(b.s) + '</small>'
          : 'Destravado<small>' + esc(card.destravaCurto) + '</small>';
      if (k.dataset.html !== cls + html) { k.innerHTML = html; k.dataset.html = cls + html; }
      k.className = 'vB-carimbo ' + cls + (forca >= 1 ? ' pronto' : '');
      k.style.opacity = forca >= 1 ? 1 : Math.max(0, (forca - 0.35) / 0.65) * 0.55;
      dEsq.classList.toggle('acesa', dir === 'esquerda' && forca >= 1);
      dDir.classList.toggle('acesa', dir === 'direita' && forca >= 1 && !b);
      // a próxima do baralho sobe enquanto a carta da vez sai
      pilha.style.setProperty('--vB-sobe', b ? '0' : String(Math.min(1, Math.max(0, forca || 0))));
    }

    // ---------------------------------------------------------------- sair da mesa
    function sair(dir, res) {
      if (saindo || !atual) return;
      saindo = true;
      var a = atual, card = a.card;
      pintarCarimbo(dir, 1, res.quando);
      var w = vista.clientWidth || 800;
      a.wrap.style.transition = 'transform .38s ease-in, opacity .38s ease-in';
      a.wrap.style.transform = 'translateX(' + (dir === 'direita' ? w : -w) + 'px) rotate(' + (dir === 'direita' ? 16 : -16) + 'deg)';
      a.wrap.style.opacity = '0';
      // no PC o aviso aparece do lado para onde a carta foi
      mesa.classList.toggle('vB-saiu-dir', dir === 'direita');
      mesa.classList.toggle('vB-saiu-esq', dir === 'esquerda');
      O.toast(vista, card, res);
      setTimeout(function () {
        dEsq.classList.remove('acesa');
        dDir.classList.remove('acesa');
        pos++;
        mostrar();
      }, 380);
    }
    function seguir() {
      if (saindo || !atual) return;
      var card = atual.card;
      var b = bloqueio(card);
      if (b) { recusar(b); return; }
      var r = card.resposta;
      if (r.tipo === 'livre') {
        var ta = atual.wrap.querySelector('.oc-resp-livre textarea');
        sair('direita', { caminho: r.enviar, texto: ta.value.trim(), rec: true, tipo: 'decidiu' });
        return;
      }
      if (r.tipo === 'lote' && atual.wrap.querySelector('.oc-item.trocando')) {
        // o dono mexeu em algum item: arrastar confirma o que está na carta, não as cinco
        atual.wrap.querySelector('.oc-resp-lote > .oc-btn.ouro').click();
        return;
      }
      if (r.tipo === 'texto') {
        var t = atual.wrap.querySelector('.oc-msg-edit');
        if (t && t.value !== card._textoOriginal) { sair('direita', { caminho: 'Enviar editado', texto: t.value, rec: false, tipo: 'decidiu' }); return; }
      }
      sair('direita', { caminho: card.rec.rotulo, rec: true, tipo: 'decidiu' });
    }
    function agoraNao(quando) {
      if (saindo || !atual) return;
      sair('esquerda', { tipo: 'agora-nao', quando: quando });
    }
    function recusar(b) {
      var a = atual;
      pintarCarimbo('direita', 1);
      a.carimbo.style.translate = '';  // a carta volta ao centro; o carimbo também
      a.wrap.style.transition = 'transform .3s cubic-bezier(.3,1.6,.5,1)';
      a.wrap.style.transform = '';
      a.wrap.classList.remove('vB-treme');
      void a.wrap.offsetWidth;
      a.wrap.classList.add('vB-treme');
      a.carta.classList.remove('virada');
      setTimeout(function () {
        if (atual !== a) return;
        pintarCarimbo(null);
        dDir.classList.remove('acesa');
        if (b.foco) {
          rolarAte(b.foco);
          b.foco.classList.add('vB-aponta');
          setTimeout(function () { b.foco.classList.remove('vB-aponta'); }, 1600);
          if (b.foco.tagName === 'TEXTAREA') b.foco.focus({ preventScroll: true });
        }
      }, 900);
    }

    // Rola só a carta até o alvo. scrollIntoView rolaria também a página e a vista (overflow hidden).
    function rolarAte(alvo) {
      var rol = alvo.closest('.oc-rolagem');
      if (!rol) return;
      var rr = rol.getBoundingClientRect(), ar = alvo.getBoundingClientRect();
      rol.scrollTo({ top: rol.scrollTop + (ar.top - rr.top) - Math.max(0, (rr.height - ar.height) / 2), behavior: 'smooth' });
    }

    // ---------------------------------------------------------------- o gesto (mouse e dedo)
    var INTERATIVO = 'button, textarea, input, select, label, a, summary, output, .oc-saidas-painel';
    function ligarGesto(wrap) {
      var ini = null, arrastando = false, dx = 0;
      function limiar() { return Math.max(80, wrap.clientWidth * 0.28); }
      wrap.addEventListener('pointerdown', function (e) {
        if (saindo || e.button > 0) return;
        if (e.target.closest(INTERATIVO)) return;
        ini = { x: e.clientX, y: e.clientY, id: e.pointerId };
        arrastando = false;
        dx = 0;
      });
      wrap.addEventListener('pointermove', function (e) {
        if (!ini || e.pointerId !== ini.id) return;
        var mx = e.clientX - ini.x, my = e.clientY - ini.y;
        if (!arrastando) {
          if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my) * 1.2) {
            arrastando = true;
            try { wrap.setPointerCapture(e.pointerId); } catch (_) { /* sem captura, segue */ }
            wrap.classList.add('vB-arrastando');
            wrap.style.transition = 'none';
            var s = window.getSelection && window.getSelection();
            if (s) s.removeAllRanges();
          } else if (Math.abs(my) > 12) { ini = null; return; }
          else return;
        }
        e.preventDefault();
        dx = mx;
        wrap.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx / 22) + 'deg)';
        pintarCarimbo(dx > 0 ? 'direita' : dx < 0 ? 'esquerda' : null, Math.abs(dx) / limiar());
        // o carimbo anda menos que a carta, para não sair da tela no celular
        if (atual) atual.carimbo.style.translate = Math.round(-dx * 0.55) + 'px 0';
      });
      function soltar(e) {
        if (!ini || (e && e.pointerId !== ini.id)) return;
        ini = null;
        if (!arrastando) return;
        arrastando = false;
        wrap.classList.remove('vB-arrastando');
        if (Math.abs(dx) >= limiar()) {
          if (dx > 0) seguir(); else agoraNao('amanhã cedo');
          return;
        }
        wrap.style.transition = 'transform .3s cubic-bezier(.3,1.5,.5,1)';
        wrap.style.transform = '';
        pintarCarimbo(null);
        dEsq.classList.remove('acesa');
        dDir.classList.remove('acesa');
      }
      wrap.addEventListener('pointerup', soltar);
      wrap.addEventListener('pointercancel', soltar);
    }

    // ---------------------------------------------------------------- teclado (só a primeira vista do PC)
    function donaDoTeclado() {
      if (!vista.isConnected) return false;
      if (!vista.getClientRects().length) return false;
      var primeira = document.querySelector('.pc .vista') || document.querySelector('.vista');
      return primeira === vista;
    }
    function tecla(e) {
      if (!vista.isConnected) { document.removeEventListener('keydown', tecla); return; }
      if (!donaDoTeclado() || e.altKey || e.ctrlKey || e.metaKey) return;
      var t = e.target;
      if ((t.matches && t.matches('input, textarea, select')) || t.isContentEditable) {
        // Esc devolve o teclado à mesa (depois de escrever a frase, → segue)
        if (e.key === 'Escape' && atual && atual.wrap.contains(t)) t.blur();
        return;
      }
      if (!atual || saindo) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); seguir(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); agoraNao('amanhã cedo'); }
      else if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); atual.carta.classList.toggle('virada'); }
    }
    document.addEventListener('keydown', tecla);

    mostrar();
  },
};
