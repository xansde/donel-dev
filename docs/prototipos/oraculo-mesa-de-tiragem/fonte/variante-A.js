/* Variante A — TIRAGEM EM TRÊS CASAS. A mesa é um spread com posições que têm significado:
   "Trava tudo", "Hoje" e "Pode esperar" são pilhas; a carta da vez fica virada e grande no centro;
   o que você decide cai na casa "Destravado", deixando à vista só o que destravou (rastro desta tiragem).
   Destravar: arrastar a carta até "Destravado" (ou o botão dourado) segue a recomendação.
   Celular: faixa de pilhas no alto; arrastar à direita segue, à esquerda "Agora não" (volta amanhã cedo).
   Zero estado global: tudo vive no fechamento de cada montar(). */
window.VARIANTES.A = {
  nome: 'Três casas',
  sobre: 'A mesa é uma tiragem com três casas que dizem a pressa: Trava tudo, Hoje e Pode esperar. '
    + 'A carta de cima da primeira casa com cartas fica virada no centro; clicar numa casa traz a dela. '
    + 'Destravar é arrastar a carta até a casa Destravado (ou o botão dourado): segue a recomendação e deixa ali só o que destravou. '
    + 'No celular, arrastar à direita segue e à esquerda volta amanhã cedo.',
  montar: function (vista, cartas) {
    var O = window.Oraculo;
    var el = O.el, esc = O.esc;

    var CASAS = [
      { k: 'trava', nome: 'Trava tudo', tecla: '1' },
      { k: 'hoje', nome: 'Hoje', tecla: '2' },
      { k: 'espera', nome: 'Pode esperar', tecla: '3' },
    ];
    function casaDe(c) { return (c.urgente || c.peso >= 3) ? 'trava' : c.peso === 2 ? 'hoje' : 'espera'; }

    var pilhas = { trava: [], hoje: [], espera: [] };
    cartas.forEach(function (c) { pilhas[casaDe(c)].push(c); });
    var total = cartas.length;
    var centro = null;      // { card, casa, wrap, raiz }
    var destravados = [];   // { card, res }, o mais novo primeiro
    var adiadas = [];       // { card, quando }
    var saindo = false;     // trava enquanto uma carta voa

    // ------------------------------------------------------------------ estrutura da mesa
    var mesa = el('div', 'vA-mesa');
    var faixa = el('div', 'vA-faixa');
    var lead = el('div', 'vA-lead');
    faixa.appendChild(lead);
    var botoesCasa = {};
    CASAS.forEach(function (c) {
      var b = el('button', 'vA-casa vA-casa-' + c.k);
      b.type = 'button';
      b.title = 'Tirar a carta de cima de "' + c.nome + '" para o centro';
      b.addEventListener('click', function () { b.blur(); tirar(c.k); });
      botoesCasa[c.k] = b;
      faixa.appendChild(b);
    });
    var casaDest = el('button', 'vA-casa vA-casa-dest');
    casaDest.type = 'button';
    casaDest.title = 'Ver o que esta tiragem já destravou';
    casaDest.addEventListener('click', function () { mesa.classList.toggle('vA-rastro-aberto'); });
    faixa.appendChild(casaDest);

    var centroEl = el('div', 'vA-centro');

    var pe = el('div', 'vA-pe');
    var dica = el('div', 'vA-dica');
    var seguirBtn = el('button', 'vA-seguir');
    seguirBtn.type = 'button';
    var teclas = el('div', 'vA-teclas', '<span><kbd>→</kbd> segue</span><span><kbd>←</kbd> agora não</span><span><kbd>espaço</kbd> vira</span><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> casas</span>');
    pe.appendChild(dica);
    pe.appendChild(seguirBtn);
    pe.appendChild(teclas);

    var dest = el('aside', 'vA-destravado');
    var destCab = el('div', 'vA-dest-cab');
    var destFechar = el('button', 'vA-dest-fechar', 'Voltar à carta');
    destFechar.type = 'button';
    destFechar.addEventListener('click', function () { mesa.classList.remove('vA-rastro-aberto'); });
    var slot = el('div', 'vA-slot', '<span class="vA-slot-seta">→</span><span>Solte aqui a carta do centro para <b>seguir a recomendação</b></span>');
    var rastro = el('ol', 'vA-rastro');
    var adiadasEl = el('div', 'vA-adiadas');
    dest.appendChild(destCab);
    dest.appendChild(destFechar);
    dest.appendChild(slot);
    dest.appendChild(rastro);
    dest.appendChild(adiadasEl);

    var aviso = el('div', 'vA-aviso');

    mesa.appendChild(faixa);
    mesa.appendChild(centroEl);
    mesa.appendChild(pe);
    mesa.appendChild(dest);
    mesa.appendChild(aviso);
    vista.appendChild(mesa);

    // ------------------------------------------------------------------ utilidades
    function estreita() { return vista.clientWidth <= 640; }
    function naMesa() { return pilhas.trava.length + pilhas.hoje.length + pilhas.espera.length + (centro ? 1 : 0); }
    function cartasTxt(n) { return n === 1 ? '1 carta' : n + ' cartas'; }
    function indice() { return O.ROMANOS[destravados.length + adiadas.length] + ' · ' + O.ROMANOS[total - 1]; }
    function precisaSegurar(card) {
      return card.resposta.tipo === 'segurar' && card.resposta.caminhos.some(function (c) { return c.rec && c.segurar; });
    }
    function clamp(x) { return Math.max(0, Math.min(1, x)); }
    function avisar(txt) {
      aviso.textContent = txt;
      aviso.classList.add('on');
      clearTimeout(aviso._h);
      aviso._h = setTimeout(function () { aviso.classList.remove('on'); }, 3200);
    }
    // Rola só a carta (scrollIntoView rolaria também a vista, que tem overflow escondido).
    function rolarAte(alvo) {
      var rol = alvo && alvo.closest('.oc-rolagem');
      if (!rol) return;
      rol.scrollTop += alvo.getBoundingClientRect().top - rol.getBoundingClientRect().top - rol.clientHeight / 3;
    }

    // ------------------------------------------------------------------ desenho
    function desenharLead() {
      var n = naMesa();
      lead.innerHTML = '<span class="vA-titulo">A tiragem</span>'
        + (n ? '<span class="vA-conta"><b>' + n + '</b> ' + (n === 1 ? 'carta' : 'cartas') + ' na mesa</span>'
             : '<span class="vA-conta"><b>Mesa limpa</b></span>')
        + '<span class="vA-sub">' + destravados.length + ' de ' + total + ' destravadas</span>';
    }

    function pilhaHtml(n, max) {
      var h = '<span class="vA-pilha' + (n ? '' : ' vazia') + '">';
      for (var i = Math.min(max, n) - 1; i >= 0; i--) h += '<span class="vA-dorso" style="--k:' + i + '">' + O.dorso().innerHTML + '</span>';
      if (n) h += '<b class="vA-n">' + n + '</b>';
      return h + '</span>';
    }

    function desenharCasas() {
      CASAS.forEach(function (c) {
        var b = botoesCasa[c.k];
        var p = pilhas[c.k];
        var ativa = centro && centro.casa === c.k;
        var topo = p[0];
        b.className = 'vA-casa vA-casa-' + c.k + (ativa ? ' vA-ativa' : '') + (p.length ? '' : ' vA-vazia') + (topo ? ' naipe-' + topo.naipe : '');
        b.disabled = !p.length;
        var estado = p.length
          ? (ativa ? 'a da vez saiu daqui · mais ' + cartasTxt(p.length) : cartasTxt(p.length))
          : (ativa ? 'a última está no centro' : 'vazia');
        b.innerHTML = '<span class="vA-casa-nome">' + esc(c.nome) + '</span>'
          + pilhaHtml(p.length, 3)
          + '<span class="vA-casa-topo">' + (topo ? '<span class="vA-glifo">' + O.GLIFOS[topo.naipe] + '</span><span class="vA-casa-perg">' + esc(topo.pergunta) + '</span>' : '') + '</span>'
          + '<span class="vA-casa-estado">' + esc(estado) + '</span>';
      });
      var nd = destravados.length;
      casaDest.className = 'vA-casa vA-casa-dest' + (nd ? '' : ' vA-vazia');
      casaDest.innerHTML = '<span class="vA-casa-nome">Destravado</span><span class="vA-pilha vA-pilha-dest"><i>✓</i>' + (nd ? '<b class="vA-n">' + nd + '</b>' : '') + '</span><span class="vA-casa-topo"></span>';
    }

    function desenharDestravado(novo) {
      destCab.innerHTML = '<h3>Destravado' + (destravados.length ? '<b>' + destravados.length + '</b>' : '') + '</h3><p>O que esta tiragem já destravou.</p>';
      rastro.innerHTML = '';
      destravados.forEach(function (d, i) {
        var li = el('li', 'vA-slip naipe-' + d.card.naipe + (novo && i === 0 ? ' vA-cai' : ''));
        li.innerHTML = '<span class="vA-glifo">' + O.GLIFOS[d.card.naipe] + '</span><span>' + esc(d.card.destravaCurto) + '</span><i>✓</i>';
        li.addEventListener('animationend', function () { li.classList.remove('vA-cai'); });
        rastro.appendChild(li);
      });
      slot.classList.toggle('vA-slot-fim', !centro);
      adiadasEl.innerHTML = adiadas.length
        ? '<b>Fora da mesa sem decidir:</b> ' + adiadas.map(function (a) { return esc(a.card.destravaCurto) + ' <i>(volta ' + esc(a.quando) + ')</i>'; }).join(' · ')
        : '';
    }

    function desenharPe() {
      var n = naMesa();
      if (!centro) {
        pe.classList.add('vA-pe-fim');
        dica.innerHTML = '<span class="vA-pc">Nada mais espera por você.</span><span class="vA-cel">Mesa limpa. Nada mais espera por você.</span>';
        return;
      }
      pe.classList.remove('vA-pe-fim');
      dica.innerHTML = '<span class="vA-pc">Arraste a carta até <b>Destravado</b> →</span>'
        + '<span class="vA-cel"><b>' + cartasTxt(n) + ' na mesa</b> · arraste → segue · ← volta amanhã</span>';
      var pl = plano();
      seguirBtn.className = 'vA-seguir' + (pl.segurar ? ' vA-segurar' : '') + (pl.falta ? ' vA-falta' : '');
      seguirBtn.innerHTML = '<span class="vA-enche"></span><span class="vA-seguir-txt"><small>'
        + esc(pl.topo) + '</small><b>' + esc(pl.rotulo) + '</b></span><span class="vA-seta">→</span>';
    }

    // O que o gesto de destravar faz AGORA com a carta do centro. Segue a recomendação, a menos que
    // você já tenha mexido na carta: item do lote em "Mudar", texto editado, frase escrita.
    // Assim o botão dourado e o arrastar nunca jogam fora o que você mudou.
    function plano() {
      var card = centro.card, r = card.resposta, raiz = centro.raiz;
      if (raiz && r.tipo === 'lote') {
        var m = raiz.querySelectorAll('.oc-item.trocando').length;
        if (m) {
          var cam = 'Seguir com ' + (r.itens.length - m) + ', mudar ' + m;
          return { topo: 'Seguir com a sua mudança', rotulo: cam, res: { caminho: cam, rec: false } };
        }
      }
      if (raiz && r.tipo === 'texto') {
        var t = raiz.querySelector('.oc-msg-edit');
        if (t && t.value !== card._textoOriginal) {
          return { topo: 'Seguir com o seu texto', rotulo: 'Enviar editado', res: { caminho: 'Enviar editado', texto: t.value, rec: false } };
        }
        return { topo: 'Seguir a recomendação', rotulo: card.rec.rotulo, res: { caminho: card.rec.rotulo, texto: t ? t.value : '', rec: true } };
      }
      if (r.tipo === 'livre') {
        var ta = raiz && raiz.querySelector('.oc-resp-livre textarea');
        if (ta && ta.value.trim()) {
          return { topo: 'Seguir com a sua frase', rotulo: r.enviar, res: { caminho: r.enviar, texto: ta.value.trim(), rec: true } };
        }
        return { topo: 'Escreva na carta e siga', rotulo: card.rec.rotulo, falta: true, campo: ta };
      }
      var segurar = precisaSegurar(card);
      return { topo: segurar ? 'Não tem volta · segure até encher' : 'Seguir a recomendação', rotulo: card.rec.rotulo, segurar: segurar, res: { caminho: card.rec.rotulo, rec: true } };
    }

    function desenharCentro(origem) {
      centroEl.innerHTML = '';
      if (!centro) {
        var v = el('div', 'oc-vazia vA-vazia');
        var inner = el('div');
        inner.appendChild(O.dorso());
        inner.appendChild(el('b', null, 'O baralho está vazio.'));
        inner.appendChild(el('span', null, destravados.length
          ? 'Mesa limpa. Você destravou ' + (destravados.length === 1 ? '1 coisa' : destravados.length + ' coisas') + ' nesta tiragem.'
          : 'Mesa limpa. Nada precisa de você agora.'));
        v.appendChild(inner);
        centroEl.appendChild(v);
        return;
      }
      var card = centro.card;
      var wrap = el('div', 'vA-carta');
      var raiz = O.carta(card, {
        indice: indice(),
        aoDecidir: function (c, res) { decidir(c, res); },
        aoAgoraNao: function (c, quando) { agoraNao(quando); },
      });
      wrap.appendChild(raiz);
      wrap.appendChild(el('div', 'vA-carimbo sim', 'Destravado'));
      wrap.appendChild(el('div', 'vA-carimbo nao', 'Agora não'));
      centroEl.appendChild(wrap);
      centro.wrap = wrap;
      centro.raiz = raiz;
      desenharPe();   // o plano lê a carta montada (texto original, campos)
      // o botão dourado acompanha o que você muda dentro da carta
      raiz.addEventListener('input', function () { if (centro && centro.raiz === raiz) desenharPe(); });
      raiz.addEventListener('click', function () { setTimeout(function () { if (centro && centro.raiz === raiz && !saindo) desenharPe(); }, 0); });
      ligarArrasto(wrap);
      // a carta sai da casa de onde veio e vem para o centro
      if (origem && origem.getClientRects().length) {
        var r = wrap.getBoundingClientRect(), t = origem.getBoundingClientRect();
        if (r.width) {
          var s = Math.max(0.1, t.height / r.height);
          wrap.style.transition = 'none';
          wrap.style.opacity = '0.2';
          wrap.style.transform = 'translate(' + (t.left + t.width / 2 - r.left - r.width / 2) + 'px,' + (t.top + t.height / 2 - r.top - r.height / 2) + 'px) scale(' + s + ')';
          void wrap.offsetWidth;
          wrap.style.transition = 'transform .42s cubic-bezier(.2,.8,.3,1), opacity .3s ease';
          wrap.style.transform = '';
          wrap.style.opacity = '';
          setTimeout(function () { if (wrap.isConnected) wrap.style.transition = ''; }, 450);
        }
      }
    }

    function desenhar(opts) {
      opts = opts || {};
      desenharLead();
      desenharCasas();
      desenharPe();
      desenharDestravado(opts.novo);
      if (opts.centro !== false) desenharCentro(opts.casa ? botoesCasa[opts.casa].querySelector('.vA-pilha') : null);
    }

    // ------------------------------------------------------------------ tirar, decidir, adiar
    function puxarProxima() {
      for (var i = 0; i < CASAS.length; i++) {
        var k = CASAS[i].k;
        if (pilhas[k].length) { centro = { card: pilhas[k].shift(), casa: k }; return k; }
      }
      centro = null;
      return null;
    }

    function tirar(k) {
      if (saindo || !pilhas[k].length) return;
      if (centro) {
        if (centro.casa === k) pilhas[k].push(centro.card);     // mesma casa: a da vez vai para o fundo
        else pilhas[centro.casa].unshift(centro.card);          // outra casa: volta para o topo da dela
      }
      centro = { card: pilhas[k].shift(), casa: k };
      mesa.classList.remove('vA-rastro-aberto');
      desenhar({ casa: k });
    }

    function proxima() {
      var k = puxarProxima();
      desenhar({ novo: true, casa: k });
    }

    function voar(wrap, alvo, depois) {
      var r = wrap.getBoundingClientRect(), t = alvo.getBoundingClientRect(), c = centroEl.getBoundingClientRect();
      // centro da carta sem transformação (posição de layout) e centro de onde ela está agora
      var ux = c.left + wrap.offsetLeft + wrap.offsetWidth / 2, uy = c.top + wrap.offsetTop + wrap.offsetHeight / 2;
      var vx = r.left + r.width / 2, vy = r.top + r.height / 2;
      var s0 = (r.width && wrap._dx !== undefined && (wrap._dx || wrap._dy) && !estreita()) ? 0.45 : 1;
      var rot0 = (wrap._dx || 0) * (estreita() ? 0.05 : 0.02);
      wrap.style.transition = 'none';
      wrap.style.transformOrigin = '50% 50%';
      wrap.style.transform = 'translate(' + (vx - ux) + 'px,' + (vy - uy) + 'px) rotate(' + rot0 + 'deg) scale(' + s0 + ')';
      void wrap.offsetWidth;
      var s = Math.max(0.08, Math.min(0.4, t.height / (wrap.offsetHeight || 1)));
      wrap.classList.add('vA-voando');
      wrap.style.transition = 'transform .55s cubic-bezier(.45,0,.25,1), opacity .55s ease-in';
      wrap.style.transform = 'translate(' + (t.left + t.width / 2 - ux) + 'px,' + (t.top + t.height / 2 - uy) + 'px) rotate(8deg) scale(' + s + ')';
      wrap.style.opacity = '0.15';
      setTimeout(function () {
        alvo.classList.add('vA-recebe');
        setTimeout(function () { alvo.classList.remove('vA-recebe'); }, 500);
        depois();
      }, 560);
    }

    function decidir(card, res) {
      if (saindo || !centro || centro.card !== card) return;
      saindo = true;
      res.tipo = res.tipo || 'decidiu';
      var alvo = estreita() ? casaDest.querySelector('.vA-pilha') : slot;
      voar(centro.wrap, alvo, function () {
        destravados.unshift({ card: card, res: res });
        centro = null;
        saindo = false;
        O.toast(vista, card, res);
        proxima();
      });
    }

    function agoraNao(quando) {
      if (saindo || !centro) return;
      saindo = true;
      var card = centro.card, wrap = centro.wrap;
      wrap.style.transition = 'none';
      wrap.classList.add('oc-sai-esquerda');
      setTimeout(function () {
        adiadas.push({ card: card, quando: quando });
        centro = null;
        saindo = false;
        O.toast(vista, card, { tipo: 'agora-nao', quando: quando });
        proxima();
      }, 460);
    }

    // Seguir a recomendação num gesto só. Devolve false quando o gesto não basta (a carta volta ao centro).
    function seguir(opts) {
      opts = opts || {};
      if (!centro || saindo) return false;
      var card = centro.card, pl = plano();
      if (pl.falta) {
        avisar('Esta pede uma frase sua: escreva na carta o que mudou e siga de novo.');
        if (pl.campo) { rolarAte(pl.campo); pl.campo.focus({ preventScroll: true }); }
        return false;
      }
      if (pl.segurar && !opts.segurou) {
        avisar('Esta não tem volta: segure o botão dourado até ele encher.');
        seguirBtn.classList.remove('vA-pulsa');
        void seguirBtn.offsetWidth;
        seguirBtn.classList.add('vA-pulsa');
        return false;
      }
      pl.res.tipo = 'decidiu';
      decidir(card, pl.res);
      return true;
    }

    // ------------------------------------------------------------------ botão dourado (clique ou segurar)
    var holdTimer = null, segurou = false;
    seguirBtn.addEventListener('pointerdown', function (e) {
      if (!centro || !precisaSegurar(centro.card)) return;
      e.preventDefault();
      segurou = false;
      seguirBtn.classList.add('vA-segurando');
      holdTimer = setTimeout(function () { segurou = true; seguirBtn.classList.remove('vA-segurando'); seguir({ segurou: true }); }, 1200);
    });
    function soltarBotao() { clearTimeout(holdTimer); seguirBtn.classList.remove('vA-segurando'); }
    seguirBtn.addEventListener('pointerup', soltarBotao);
    seguirBtn.addEventListener('pointerleave', soltarBotao);
    seguirBtn.addEventListener('click', function () {
      seguirBtn.blur();
      if (segurou) { segurou = false; return; }
      seguir();
    });

    // ------------------------------------------------------------------ arrastar a carta
    function sobreAlvo(x, y) {
      var r = dest.getBoundingClientRect();
      return x >= r.left - 30 && x <= r.right + 30 && y >= r.top - 30 && y <= r.bottom + 30;
    }
    function limite(wrap) { return Math.min(120, wrap.offsetWidth * 0.28); }
    function voltarAoCentro(wrap) {
      wrap.style.transition = 'transform .3s cubic-bezier(.2,.9,.3,1.2)';
      wrap.style.transform = '';
      wrap._dx = wrap._dy = 0;
      setTimeout(function () { if (!wrap.style.transform) wrap.style.transformOrigin = ''; }, 320);
      wrap.querySelectorAll('.vA-carimbo').forEach(function (c) { c.style.opacity = ''; });
    }

    function ligarArrasto(wrap) {
      var d = null;
      var sim = wrap.querySelector('.vA-carimbo.sim'), nao = wrap.querySelector('.vA-carimbo.nao');
      wrap.addEventListener('pointerdown', function (e) {
        if (saindo || e.button > 0) return;
        if (e.target.closest('button, textarea, input, select, label, summary, a, output, .oc-tela-aberta')) return;
        d = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, on: false, swipe: estreita() };
      });
      wrap.addEventListener('pointermove', function (e) {
        if (!d || e.pointerId !== d.id) return;
        d.dx = e.clientX - d.x;
        d.dy = e.clientY - d.y;
        if (!d.on) {
          if (Math.abs(d.dx) < 8 && Math.abs(d.dy) < 8) return;
          if (d.swipe && Math.abs(d.dy) > Math.abs(d.dx)) { d = null; return; }   // vertical: é rolar a carta
          d.on = true;
          try { wrap.setPointerCapture(d.id); } catch (_) { /* sem captura */ }
          if (!d.swipe) {   // no PC a carta encolhe em volta do ponto onde você a pegou
            var rr = wrap.getBoundingClientRect();
            wrap.style.transformOrigin = (d.x - rr.left) + 'px ' + (d.y - rr.top) + 'px';
          }
          var sel = window.getSelection && window.getSelection();
          if (sel) sel.removeAllRanges();
          mesa.classList.add('vA-arrastando');
        }
        e.preventDefault();
        var dy = d.swipe ? d.dy * 0.12 : d.dy;
        wrap._dx = d.dx;
        wrap._dy = dy;
        wrap.style.transition = 'none';
        wrap.style.transform = 'translate(' + d.dx + 'px,' + dy + 'px) rotate(' + (d.dx * (d.swipe ? 0.05 : 0.02)) + 'deg)' + (d.swipe ? '' : ' scale(.45)');
        if (d.swipe) {
          var lim = limite(wrap);
          sim.style.opacity = clamp(d.dx / lim);
          nao.style.opacity = clamp(-d.dx / lim);
        } else {
          var over = sobreAlvo(e.clientX, e.clientY);
          dest.classList.toggle('vA-alvo', over);
          sim.style.opacity = over ? 1 : clamp(d.dx / 500) * 0.5;
          nao.style.opacity = 0;
        }
      });
      function soltar(e, cancelou) {
        if (!d || e.pointerId !== d.id) return;
        var x = d;
        d = null;
        mesa.classList.remove('vA-arrastando');
        dest.classList.remove('vA-alvo');
        if (!x.on) return;
        if (!cancelou) {
          if (x.swipe) {
            var lim = limite(wrap);
            if (x.dx > lim && seguir()) return;
            if (x.dx < -lim) { agoraNao('amanhã cedo'); return; }
          } else if (sobreAlvo(e.clientX, e.clientY) && seguir()) {
            return;
          }
        }
        voltarAoCentro(wrap);
      }
      wrap.addEventListener('pointerup', function (e) { soltar(e, false); });
      wrap.addEventListener('pointercancel', function (e) { soltar(e, true); });
    }

    // ------------------------------------------------------------------ teclado (só a primeira vista PC, visível)
    function minhaVez() {
      if (!vista.isConnected || !vista.getClientRects().length) return false;
      var primeira = document.querySelector('.pc .vista') || document.querySelector('.vista');
      return primeira === vista;
    }
    function tecla(e) {
      if (!vista.isConnected) { document.removeEventListener('keydown', tecla); return; }
      if (!minhaVez() || e.altKey || e.ctrlKey || e.metaKey) return;
      var t = e.target;
      if ((t.matches && t.matches('input, textarea, select, button')) || t.isContentEditable) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); seguir(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); agoraNao('amanhã cedo'); }
      else if (e.key === ' ' && centro) { e.preventDefault(); centro.raiz.classList.toggle('virada'); }
      else if (e.key === '1' || e.key === '2' || e.key === '3') { tirar(CASAS[+e.key - 1].k); }
    }
    document.addEventListener('keydown', tecla);

    // ------------------------------------------------------------------ dar as cartas
    puxarProxima();
    desenhar({});
  },
};
