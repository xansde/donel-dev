// Oráculo no celular — "Pedir": um pedido solto (sem carta) ao Líder único, por texto ou por voz. O áudio é
// gravado aqui, convertido aqui para WAV (16 kHz, mono) e transcrito no PC; o dono lê, corrige e envia. Se o
// Líder estiver fechado, o PC guarda o pedido e entrega quando ele abrir. A lista "Seus pedidos" diz onde cada
// um está. Arquivo à parte do app.js: o baralho (as cartas) não muda por causa disto.
'use strict';

(function () {
  var CHAVE_TOKEN = 'donel-ledger-token';
  var CHAVE_RASCUNHO = 'donel-pedido-rascunho';
  var MAX_TEXTO = 4000;
  var MAX_GRAVACAO_MS = 4 * 60 * 1000;
  var TAXA = 16000;

  var botaoAbrir = document.getElementById('pedir');
  var fundo = document.getElementById('pedir-folha');
  var form = document.getElementById('pedir-form');
  var texto = document.getElementById('pedir-texto');
  var contador = document.getElementById('pedir-contador');
  var microfone = document.getElementById('pedir-microfone');
  var microfoneRotulo = document.getElementById('pedir-microfone-rotulo');
  var arquivo = document.getElementById('pedir-arquivo');
  var estadoVoz = document.getElementById('pedir-voz');
  var enviar = document.getElementById('pedir-enviar');
  var lista = document.getElementById('pedir-lista');
  var aviso = document.getElementById('aviso');

  var pedidoId = null; // o mesmo enquanto o texto não muda: um reenvio não entra duas vezes
  var audioId = null; // o áudio guardado no PC, quando o pedido foi falado
  var gravacao = null; // { recorder, stream, partes, inicio, timer }
  var transcrevendo = false;

  function token() {
    try { return localStorage.getItem(CHAVE_TOKEN); } catch (e) { return null; }
  }

  function guardarRascunho() {
    try {
      if (texto.value) localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ texto: texto.value, audioId: audioId }));
      else localStorage.removeItem(CHAVE_RASCUNHO);
    } catch (e) { /* sem armazenamento: o rascunho vale enquanto a folha está aberta */ }
  }

  function lerRascunho() {
    try {
      var r = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) || 'null');
      if (r && typeof r.texto === 'string') {
        texto.value = r.texto.slice(0, MAX_TEXTO);
        audioId = typeof r.audioId === 'string' ? r.audioId : null;
      }
    } catch (e) { /* rascunho ilegível: começa vazio */ }
  }

  var avisoTimer = null;
  function avisar(frase) {
    aviso.textContent = frase;
    aviso.hidden = false;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(function () { aviso.hidden = true; }, 4000);
  }

  function chamar(caminho, opcoes) {
    opcoes = opcoes || {};
    var headers = { Authorization: 'Bearer ' + (token() || '') };
    if (opcoes.tipo) headers['Content-Type'] = opcoes.tipo;
    return fetch(caminho, { method: opcoes.method || 'GET', headers: headers, body: opcoes.body, cache: 'no-store' }).then(function (resposta) {
      if (resposta.status === 401) throw new Error('nao-pareado');
      return resposta.json().catch(function () { return {}; }).then(function (dados) { return { ok: resposta.ok, dados: dados }; });
    });
  }

  function idAleatorio() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function el(tag, classe, conteudo) {
    var node = document.createElement(tag);
    if (classe) node.className = classe;
    if (conteudo !== undefined && conteudo !== null) node.textContent = conteudo;
    return node;
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

  // ---- a folha ----

  function atualizarContador() {
    contador.textContent = texto.value.length + ' / ' + MAX_TEXTO;
    enviar.disabled = transcrevendo || !texto.value.trim();
  }

  function abrir() {
    if (!token()) {
      avisar('Pareie este celular primeiro (Preferências → Celular no Donel Dev).');
      return;
    }
    if (!texto.value) lerRascunho();
    atualizarContador();
    fundo.hidden = false;
    setTimeout(function () { texto.focus(); }, 60);
    carregarLista();
  }

  function fechar() {
    if (gravacao) pararGravacao(false);
    guardarRascunho();
    fundo.hidden = true;
  }

  botaoAbrir.addEventListener('click', abrir);
  document.getElementById('pedir-fechar').addEventListener('click', fechar);
  fundo.addEventListener('click', function (e) { if (e.target === fundo) fechar(); });
  texto.addEventListener('input', function () {
    pedidoId = null;
    if (!texto.value) audioId = null;
    atualizarContador();
    guardarRascunho();
  });

  // ---- "Seus pedidos" ----

  var ROTULOS = { 'na-fila': 'Na fila: o Líder está fechado', entregue: 'Entregue ao Líder', tarefa: 'Virou tarefa' };
  var ESTADOS_TAREFA = { aberta: 'aberta', 'em-execucao': 'em execução', entregue: 'entregue', aceita: 'aceita', rejeitada: 'rejeitada' };

  function linhaDoPedido(p) {
    var li = el('li', 'meu-pedido meu-pedido-' + p.estado);
    li.appendChild(el('p', 'meu-pedido-texto', p.texto));
    var pe = el('div', 'meu-pedido-pe');
    var selo = el('span', 'meu-pedido-estado', ROTULOS[p.estado] || p.estado);
    pe.appendChild(selo);
    pe.appendChild(el('span', 'meu-pedido-hora', (p.falado ? 'falado · ' : '') + haQuanto(p.criadoEm)));
    li.appendChild(pe);
    if (p.tarefa) {
      var t = el('p', 'meu-pedido-nome-tarefa', '« ' + p.tarefa.titulo + ' »');
      if (p.tarefa.estado) t.appendChild(el('span', null, ' · ' + (ESTADOS_TAREFA[p.tarefa.estado] || p.tarefa.estado)));
      li.appendChild(t);
    }
    return li;
  }

  function carregarLista() {
    return chamar('/api/pedidos')
      .then(function (r) {
        lista.textContent = '';
        var itens = r.ok && Array.isArray(r.dados.itens) ? r.dados.itens : [];
        if (itens.length === 0) {
          lista.appendChild(el('li', 'meu-pedido-vazio', 'Nenhum pedido ainda.'));
          return;
        }
        itens.forEach(function (p) { lista.appendChild(linhaDoPedido(p)); });
      })
      .catch(function () { /* sem conexão: a lista fica como estava */ });
  }

  // ---- enviar ----

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var valor = texto.value.trim();
    if (!valor || transcrevendo) return;
    if (!pedidoId) pedidoId = idAleatorio();
    enviar.disabled = true;
    enviar.textContent = 'Enviando…';
    var corpo = { pedidoId: pedidoId, texto: valor };
    if (audioId) corpo.audioId = audioId;
    chamar('/api/pedidos', { method: 'POST', tipo: 'application/json', body: JSON.stringify(corpo) })
      .then(function (r) {
        if (!r.ok) {
          avisar('Não enviou: ' + ((r.dados && r.dados.mensagem) || 'tente de novo.'));
          return;
        }
        texto.value = '';
        pedidoId = null;
        audioId = null;
        guardarRascunho();
        mostrarVoz('');
        avisar(r.dados.pedido && r.dados.pedido.estado === 'na-fila' ? 'Guardado no PC: o Líder recebe quando abrir.' : 'Pedido enviado ao Líder.');
        carregarLista();
      })
      .catch(function (erro) {
        avisar(erro && erro.message === 'nao-pareado' ? 'Este celular não está mais pareado.' : 'Sem conexão com o PC. Tente de novo (não sai duas vezes).');
      })
      .then(function () {
        enviar.textContent = 'Enviar ao Líder';
        atualizarContador();
      });
  });

  // ---- voz: grava aqui, converte aqui para WAV 16 kHz mono, transcreve no PC ----

  var podeGravarAoVivo = !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  microfoneRotulo.textContent = podeGravarAoVivo ? 'Gravar' : 'Gravar áudio';

  function mostrarVoz(frase, classe) {
    estadoVoz.textContent = frase || '';
    estadoVoz.className = 'pedir-voz' + (classe ? ' ' + classe : '');
    estadoVoz.hidden = !frase;
  }

  function wavDe(amostras) {
    var buffer = new ArrayBuffer(44 + amostras.length * 2);
    var v = new DataView(buffer);
    function txt(pos, s) { for (var i = 0; i < s.length; i++) v.setUint8(pos + i, s.charCodeAt(i)); }
    txt(0, 'RIFF'); v.setUint32(4, 36 + amostras.length * 2, true); txt(8, 'WAVE');
    txt(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, TAXA, true); v.setUint32(28, TAXA * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    txt(36, 'data'); v.setUint32(40, amostras.length * 2, true);
    for (var i = 0; i < amostras.length; i++) {
      var s = Math.max(-1, Math.min(1, amostras[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  function paraWav(blob) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    return blob.arrayBuffer().then(function (bytes) {
      var ctx = new Ctx();
      return new Promise(function (ok, falha) { ctx.decodeAudioData(bytes, ok, falha); }).then(function (audio) {
        if (ctx.close) ctx.close();
        var off = new Offline(1, Math.max(1, Math.ceil(audio.duration * TAXA)), TAXA);
        var fonte = off.createBufferSource();
        fonte.buffer = audio;
        fonte.connect(off.destination);
        fonte.start(0);
        return off.startRendering();
      });
    }).then(function (pronto) { return wavDe(pronto.getChannelData(0)); });
  }

  function esperarTranscricao(id, tentativas) {
    return new Promise(function (r) { setTimeout(r, 2000); })
      .then(function () { return chamar('/api/pedidos/audio?id=' + id); })
      .then(function (r) {
        if (!r.ok) throw new Error('O PC perdeu esta transcrição (o app reiniciou?). O áudio ficou guardado; escreva o pedido.');
        if (r.dados.estado === 'transcrevendo') {
          if (tentativas > 210) throw new Error('A transcrição está demorando demais. Escreva o pedido.');
          return esperarTranscricao(id, tentativas + 1);
        }
        if (r.dados.estado === 'falhou') throw new Error(r.dados.mensagem || 'A transcrição falhou.');
        return r.dados.texto;
      });
  }

  function transcrever(blob) {
    transcrevendo = true;
    atualizarContador();
    microfone.disabled = true;
    mostrarVoz('Convertendo o áudio…', 'ocupado');
    paraWav(blob)
      .catch(function () { throw new Error('Não consegui ler este áudio aqui no celular. Grave de novo ou escreva.'); })
      .then(function (wav) {
        mostrarVoz('Transcrevendo no PC… pode levar um minuto ou dois.', 'ocupado');
        return fetch('/api/pedidos/audio', { method: 'POST', headers: { Authorization: 'Bearer ' + (token() || ''), 'Content-Type': 'audio/wav' }, body: wav, cache: 'no-store' })
          .then(function (resposta) {
            return resposta.json().catch(function () { return {}; }).then(function (dados) {
              if (!resposta.ok) throw new Error(dados.mensagem || 'O PC não aceitou o áudio.');
              return dados.audioId;
            });
          }, function () { throw new Error('Sem conexão com o PC para mandar o áudio.'); });
      })
      .then(function (id) {
        return esperarTranscricao(id, 0).then(function (frase) {
          audioId = id;
          var atual = texto.value.trim();
          texto.value = (atual ? atual + ' ' : '') + frase;
          if (texto.value.length > MAX_TEXTO) texto.value = texto.value.slice(0, MAX_TEXTO);
          pedidoId = null;
          guardarRascunho();
          mostrarVoz('Transcrito. Confira e corrija o texto antes de enviar.', 'pronto');
          texto.focus();
        });
      })
      .catch(function (erro) {
        mostrarVoz((erro && erro.message) || 'A transcrição falhou.', 'erro');
      })
      .then(function () {
        transcrevendo = false;
        microfone.disabled = false;
        atualizarContador();
      });
  }

  function tempo(ms) {
    var s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function comecarGravacao() {
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var recorder = new MediaRecorder(stream);
      var g = { recorder: recorder, stream: stream, partes: [], inicio: Date.now(), timer: null, usar: true };
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) g.partes.push(e.data); };
      recorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (!g.usar || g.partes.length === 0) { mostrarVoz(''); return; }
        transcrever(new Blob(g.partes, { type: recorder.mimeType || 'audio/webm' }));
      };
      recorder.start();
      g.timer = setInterval(function () {
        var passou = Date.now() - g.inicio;
        mostrarVoz('● Gravando ' + tempo(passou) + ' · toque para parar', 'gravando');
        if (passou >= MAX_GRAVACAO_MS) pararGravacao(true);
      }, 250);
      gravacao = g;
      microfone.classList.add('gravando');
      microfoneRotulo.textContent = 'Parar';
      mostrarVoz('● Gravando 0:00 · toque para parar', 'gravando');
    }, function () {
      avisar('Sem acesso ao microfone. Libere nas configurações do navegador.');
    });
  }

  function pararGravacao(usar) {
    var g = gravacao;
    if (!g) return;
    gravacao = null;
    g.usar = usar;
    clearInterval(g.timer);
    microfone.classList.remove('gravando');
    microfoneRotulo.textContent = 'Gravar';
    if (g.recorder.state !== 'inactive') g.recorder.stop();
  }

  // Tocar começa e outro toque para; segurar grava enquanto o dedo está no botão.
  var apertouEm = 0;
  var iniciou = null;
  microfone.addEventListener('pointerdown', function (e) {
    if (microfone.disabled) return;
    if (!podeGravarAoVivo) return; // o clique abre o gravador do celular
    e.preventDefault();
    if (gravacao) { pararGravacao(true); return; }
    apertouEm = Date.now();
    iniciou = comecarGravacao();
  });
  microfone.addEventListener('pointerup', function () {
    if (!podeGravarAoVivo || !iniciou) return;
    var segurou = Date.now() - apertouEm > 600;
    var p = iniciou;
    iniciou = null;
    if (segurou) p.then(function () { pararGravacao(true); });
  });
  microfone.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  microfone.addEventListener('click', function () {
    // Endereço http (sem https da Tailscale): o navegador não libera o microfone para a página; o celular grava
    // pelo app de gravação dele e devolve o arquivo.
    if (!podeGravarAoVivo && !microfone.disabled) arquivo.click();
  });
  arquivo.addEventListener('change', function () {
    var f = arquivo.files && arquivo.files[0];
    arquivo.value = '';
    if (f) transcrever(f);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !fundo.hidden) carregarLista();
  });
})();
