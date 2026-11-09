/* ===================================================================================================
   PROTÓTIPO DESCARTÁVEL — base comum às variantes: as cartas reais, o molde modular da carta e a casca.
   Nada grava: decidir só tira a carta da mesa e mostra o que destrava.
   =================================================================================================== */
(function () {
  'use strict';

  // Glifos próprios do Oráculo (copiados de src/main/celular/pwa/app.js).
  var GLIFOS = {
    martelos: '<svg viewBox="0 0 24 24"><path d="M5.5 3.5l5 5-2.8 2.8-5-5z"/><path d="M8.2 6.2l3.3-3.3 2.6 2.6-3.3 3.3"/><path d="M10.4 11.2L20 20.8"/><path d="M14 4.5l1.5-1.5"/></svg>',
    escudos: '<svg viewBox="0 0 24 24"><path d="M12 2.8l7.5 3v5.4c0 5-3.6 8.6-7.5 10-3.9-1.4-7.5-5-7.5-10V5.8z"/><path d="M12 6.5v11M7.8 11h8.4"/></svg>',
    chaves: '<svg viewBox="0 0 24 24"><circle cx="7" cy="12" r="3.6"/><circle cx="7" cy="12" r="1.1"/><path d="M10.6 12H21.5M17.5 12v3.2M20.5 12v2.3"/></svg>',
    livros: '<svg viewBox="0 0 24 24"><path d="M3.5 5.2c3-1.1 6-1 8.5 1 2.5-2 5.5-2.1 8.5-1v13.6c-3-1.1-6-1-8.5 1-2.5-2-5.5-2.1-8.5-1z"/><path d="M12 6.2v13.6M6 9c1.5-.3 2.8-.1 4 .5M6 12c1.5-.3 2.8-.1 4 .5M14 9.5c1.2-.6 2.5-.8 4-.5"/></svg>',
    estrelas: '<svg viewBox="0 0 24 24"><path d="M12 2.2l1.9 6.3 6.2-2.2-3.6 5.7 3.6 5.7-6.2-2.2L12 21.8l-1.9-6.3-6.2 2.2 3.6-5.7-3.6-5.7 6.2 2.2z"/><circle cx="12" cy="12" r="1.6"/></svg>',
    coroas: '<svg viewBox="0 0 24 24"><path d="M3 8.2l4.6 4.1L12 4.8l4.4 7.5L21 8.2l-2 10.6H5z"/><path d="M5.6 15.6h12.8"/><circle cx="12" cy="4" r=".6"/></svg>',
  };
  var VERSO_SVG = '<svg viewBox="0 0 70 70"><circle cx="35" cy="35" r="30"/><circle cx="35" cy="35" r="20"/><path d="M35 5v60M5 35h60M14 14l42 42M56 14L14 56"/><circle cx="35" cy="35" r="5"/></svg>';

  // O naipe diz o TIPO DE DECISÃO (proposta deste protótipo; hoje o naipe sai do papel de quem entregou).
  var NAIPES = {
    chaves: 'Acesso só seu',
    escudos: 'Risco que não volta',
    livros: 'Palavra sua',
    estrelas: 'Forma do que você vê',
    martelos: 'Plano com várias decisões',
    coroas: 'Escolher o caminho',
  };
  var ROMANOS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

  /* ------------------------------------------------------------------------------------------------
     AS CARTAS REAIS. Fonte: Oráculo de 09/11 (tarefa_listar de todos os quadros + tarefa_ver).
     O texto é o das cartas reais, encurtado; "real" diz de onde veio cada uma.
     ------------------------------------------------------------------------------------------------ */
  var CARTAS = [
    {
      id: 'aihub', naipe: 'chaves', quadro: 'Homologação', desde: 'parada desde sáb, 07/11', urgente: true, peso: 3,
      real: 'De hoje. Esta carta nunca chegou a você: o pedido ficou num aviso ao Líder.',
      pergunta: 'A homologação está parada sem a chave do AI Hub. Você cria uma chave nova?',
      destrava: 'as rodadas de homologação voltam a ser julgadas e os selos voltam a sair',
      destravaCurto: 'Homologação volta a julgar',
      visual: {
        tipo: 'passos', titulo: 'O que só você faz', nota: 'uns 3 minutos',
        passos: [
          ['Criar uma chave nova no AI Hub', 'Só a sua conta pode. A antiga foi bloqueada em 07/11 e o chamado à plataforma não teve resposta.'],
          ['Guardar no cofre com o nome que a sessão pedir', 'Você não cola em lugar nenhum além do cofre.'],
          ['Tocar em "Fiz"', 'A sessão testa a chave e religa a rodada que parou.'],
        ],
        parado: 'nenhum selo sai há 2 dias',
      },
      rec: { rotulo: 'Criar a chave agora', porque: 'Sem ela nada da homologação anda, e esperar a plataforma já custou dois dias.' },
      resposta: {
        tipo: 'fiz',
        caminhos: [
          { rotulo: 'Fiz', efeito: 'A sessão confere a chave e religa a rodada. Se a chave não funcionar, a carta volta para você com o erro.', rec: true },
          { rotulo: 'Não consigo agora', efeito: 'A carta volta amanhã cedo. A homologação segue parada até lá.' },
        ],
      },
      risco: { nivel: 'alto', texto: 'A chave dá acesso pago ao AI Hub. Ela fica só no cofre e só a homologação usa.' },
      verso: {
        pedido: '"E, em paralelo, na VPS de homologação, o fluxo de homologação. Quero ver apps com o selo"',
        quem: 'Você, ao pedir o fluxo de homologação na VPS',
        caminhos: [['Fiz', 'A rodada parada é retomada na hora.'], ['Não consigo agora', 'Nenhum selo sai até a chave existir.']],
        tecnico: 'Avaliador da homologação recebe "chave bloqueada" desde 07/11.\nChamado aberto na plataforma, sem resposta.\nA rodada mais recente parou na etapa de avaliar.',
      },
    },
    {
      id: 'token', naipe: 'escudos', quadro: 'BizOps', desde: 'esperando desde hoje, 00:56', peso: 2,
      real: 'De hoje. Carta real, ainda aberta.',
      pergunta: 'O token do Google na VPS faz mais do que ler. Tiro de lá e a reposição de contas fica por pessoa?',
      destrava: 'a reposição de contas do pool, hoje com 16 de 56 contas com cota',
      destravaCurto: 'Reposição de contas',
      visual: {
        tipo: 'checagens', titulo: 'Como está agora',
        itens: [
          ['ok', 'Chave do pool no lugar', 'Está na VPS e no cofre.'],
          ['ok', 'Token guardado no cofre', 'Cópia segura existe.'],
          ['nao', 'Token só de leitura', 'Não: ele envia e-mail e mexe no seu Drive.'],
          ['nao', 'Conta nova entrou', 'Não: o site barra o login vindo da VPS.'],
          ['ok', 'Ninguém usa o token', 'Parado até você decidir.'],
        ],
      },
      rec: { rotulo: 'Tirar o token, login por pessoa', porque: 'Sem login pela VPS o token lá não serve para nada e só traz risco.' },
      resposta: {
        tipo: 'caminhos',
        caminhos: [
          { rotulo: 'Tirar o token, login por pessoa', efeito: 'O token sai da VPS e fica só no cofre. Uma pessoa faz os logins num navegador normal quando precisar repor.', rec: true },
          { rotulo: 'Trocar por um só de leitura', efeito: 'Você autoriza um token novo que só lê o Gmail. A reposição segue parada até o site deixar o login passar.' },
          { rotulo: 'Deixar como está', efeito: 'O token amplo fica na VPS sem uso. A tarefa fecha sem conta nova.' },
        ],
      },
      risco: { nivel: 'alto', texto: 'Não revogue o token no Google: é o mesmo do PC, e o Google do PC cairia. Apagar o arquivo da VPS não afeta o PC.' },
      verso: {
        pedido: '"Libero as duas" — você, na carta que liberava duas chaves para a VPS cadastrar contas sozinha.',
        quem: 'Você liberou; a sessão de contas descobriu que o token era amplo demais.',
        caminhos: [['Tirar o token', 'Nenhum acesso amplo fica fora do PC.'], ['Só leitura', 'Mais uma autorização sua, sem efeito até o site liberar o login.'], ['Deixar', 'Risco parado na VPS.']],
        tecnico: 'O token tem 29 permissões (enviar e-mail, alterar Gmail, Drive, Planilhas, Documentos, Agenda).\nCinco tentativas de login pela VPS em 08/11, todas barradas antes da tela de autorizar.',
      },
    },
    {
      id: 'oneonone', naipe: 'livros', quadro: 'BizOps', desde: 'conversa de hoje, 10h, já passou', urgente: true, peso: 2,
      real: 'De hoje. Carta real; voltou com risco baixo e não chegou à sua mesa a tempo.',
      pergunta: 'Você disse que o planejamento mudou. O que mudou?',
      destrava: 'os convites das conversas 1:1 desta semana com seus liderados e os JTs',
      destravaCurto: 'Convites das 1:1',
      visual: {
        tipo: 'grade', titulo: 'A grade proposta', nota: 'ilustração; a grade real está no verso',
        dias: ['seg', 'ter', 'qua', 'qui'],
        blocos: [[['Raiza · 10h', 'sem']], [['1:1'], ['1:1'], ['1:1']], [['1:1'], ['1:1']], [['1:1'], ['1:1'], ['1:1']]],
      },
      citacao: { texto: 'o planejamento mudou', de: 'você, ao recusar a primeira grade' },
      rec: { rotulo: 'Dizer em uma frase o que mudou', porque: 'A mudança não está escrita em nenhuma agenda, recesso, Slack ou roadmap que o time alcança. Marcar 9 pessoas sem saber seria chutar.' },
      resposta: {
        tipo: 'livre', rotulo: 'O que mudou?', placeholder: 'Ex.: os JTs saem desta semana; só liderados.',
        enviar: 'Refazer a grade com isto', efeito: 'A grade é refeita antes de qualquer convite.',
        alternativa: { rotulo: 'Manter a grade', efeito: 'Os horários ficam como estão e os convites saem.' },
      },
      risco: { nivel: 'baixo', texto: 'O período dos JTs com você acaba na sexta: cada dia sem resposta é uma conversa a menos.' },
      verso: {
        pedido: '"Prepara 1:1s pra mim na semana que vem com meus liderados e com os JTs (Somente os que não estão de recesso."',
        quem: 'Você, na quinta, 05/11',
        caminhos: [['Dizer o que mudou', 'Grade refeita e convites na sequência.'], ['Manter', 'Convites saem com a grade de antes.']],
        tecnico: 'Conferidos: agenda livre dos 9 horários, recessos da semana, Slack e as iniciativas do roadmap.\nNenhuma mudança de planejamento escrita.',
      },
    },
    {
      id: 'telas', naipe: 'estrelas', quadro: 'Donel Dev', desde: 'entregue domingo, 22:40', peso: 1,
      real: 'Carta real de domingo à noite, já decidida por você às 23:14.',
      pergunta: 'Qual destas três telas vira o seu Progresso, com a fila de cada quadro?',
      destrava: 'a construção da fila priorizada por quadro',
      destravaCurto: 'Fila por quadro',
      visual: {
        tipo: 'comparacao', titulo: 'As três telas, com os dados de hoje', nota: 'toque para abrir cada uma',
        telas: [
          { rotulo: 'Uma lista só dos seus pedidos', forma: 'lista', rec: true },
          { rotulo: 'Colunas por quadro', forma: 'colunas' },
          { rotulo: 'Faxina e faixas', forma: 'faixas' },
        ],
      },
      rec: { rotulo: 'Uma lista só dos seus pedidos', porque: 'Responde ao seu pedido de priorizar no Progresso; a fila de cada quadro sai dela.' },
      resposta: {
        tipo: 'variante',
        caminhos: [
          { rotulo: 'Uma lista só dos seus pedidos', efeito: 'Você ordena seus pedidos numa lista; cada quadro puxa o primeiro que é dele.', rec: true },
          { rotulo: 'Colunas por quadro', efeito: 'Cada quadro vira uma coluna com limite e fila; você reordena dentro de cada uma.' },
          { rotulo: 'Faxina e faixas', efeito: 'Aceita a faxina de uma vez e põe cada pedido numa faixa: Agora, Próximas, Depois.' },
        ],
        misturar: true,
      },
      risco: { nivel: 'baixo', texto: 'Ligar a puxada antes da faxina faria o app puxar tarefas sem dono; por isso a faxina vem antes, e nada é apagado.' },
      verso: {
        pedido: '"A tela de \\"progresso - Seus pedidos\\" deve ser bem alinhada com o ledger, para eu conseguir priorizar pontualmente ali, inclusive"',
        quem: 'Você, no sábado, 08/11',
        caminhos: [['Lista única', 'Uma ordem só, sua.'], ['Colunas', 'Uma ordem por quadro.'], ['Faixas', 'Três faixas em vez de ordem.']],
        tecnico: 'Montado com 406 tarefas reais: 56 vivas, 74 sem dono, 58 pedidos repetidos.\nTestado a 1400 e a 390 pixels de largura.',
      },
    },
    {
      id: 'fila5', naipe: 'martelos', quadro: 'Donel Dev', desde: 'veio junto com a carta das telas', peso: 1,
      real: 'Da mesma carta de domingo à noite. Estas cinco decisões estavam escondidas atrás de um botão dentro do protótipo.',
      pergunta: 'Sigo as cinco recomendações para ligar a fila por quadro?',
      destrava: 'ligar a puxada: cada quadro passa a buscar a próxima demanda sozinho',
      destravaCurto: 'Puxada por quadro',
      visual: null,
      rec: { rotulo: 'Aceitar as cinco', porque: 'Nenhuma apaga nada, e cada uma você ajusta depois no próprio quadro.' },
      resposta: {
        tipo: 'lote', tudo: 'Aceitar as cinco recomendações',
        itens: [
          { t: 'O que conta como trabalho em andamento', r: 'Tarefa assumida por uma sessão viva, mais as entregues esperando o Revisor.', alt: 'Ou: contar sessões abertas, ou contar seus pedidos abertos.' },
          { t: 'Limite por quadro', r: 'Começar com estes números; você ajusta no quadro, o Líder só propõe.', num: [['Donel Dev', 4], ['BizOps', 4], ['Homologação', 3]] },
          { t: 'Prioridade', r: 'Numa lista só, em Seus pedidos; pedidos repetidos viram partes de um.', alt: 'Ou: uma ordem por quadro.' },
          { t: 'Faxina antes de ligar', r: 'Uma faxina única: sem dono e vencida é arquivada, o resto volta ao Líder do quadro. Nada é apagado.' },
          { t: 'Fila do Líder único', r: 'A soma das filas dos quadros, na mesma ordem; quem puxa é o Líder de cada quadro.' },
        ],
      },
      risco: { nivel: 'baixo', texto: 'Uma versão antiga do app aberta ao lado passa a só ler as tarefas.' },
      verso: {
        pedido: '"A tela de \\"progresso - Seus pedidos\\" deve ser bem alinhada com o ledger, para eu conseguir priorizar pontualmente ali, inclusive"',
        quem: 'Você, no sábado, 08/11',
        caminhos: [['Aceitar as cinco', 'A puxada liga depois da faxina.'], ['Trocar uma', 'Só aquela espera a sua resposta; as outras seguem.']],
        tecnico: 'Memória: cada sessão usa uns 354 MB numa VPS de 31 GB; o limite real é a cota das contas e a revisão.\nA memória do PC e a cota ainda não foram medidas.',
      },
    },
    {
      id: 'marta', naipe: 'livros', quadro: 'BizOps', desde: 'a Marta perguntou na quinta, 05/11', peso: 2,
      real: 'Carta real de 06/11, já decidida. Aqui as duas cartas que ela virou (liberar e aprovar o texto) são uma só.',
      pergunta: 'Libero a Marta para desligar o app antigo, com esta resposta?',
      destrava: 'a Marta desliga o app antigo e liga o redirecionamento',
      destravaCurto: 'Marta segue',
      visual: {
        tipo: 'texto', titulo: 'A mensagem que sai em seu nome',
        pedidoDe: { texto: 'Podemos descomissionar o stop-crescimento do Coolify? Junto com o desligamento, ligo o redirecionamento. Do seu lado está tudo ok, ou ainda falta algo antes?', de: 'Marta, por mensagem direta, quinta 05/11 15:32' },
        para: 'Marta · conversa direta, na mesma conversa',
        texto: 'Marta, show! Do meu lado está tudo no endereço novo, pode desligar e ligar o redirecionamento. Só deixa o app antigo parado, sem apagar, por uma semana, pra gente ter volta se aparecer alguém esquecido. A lista dos projetos Supabase pra revogar te mando até segunda.',
      },
      rec: { rotulo: 'Enviar como está', porque: 'Nada mais depende do app antigo; parado uma semana dá volta se aparecer algum uso esquecido.' },
      resposta: {
        tipo: 'texto',
        caminhos: [
          { rotulo: 'Enviar como está', efeito: 'A mensagem sai agora, na conversa com a Marta.', rec: true },
          { rotulo: 'Enviar editado', efeito: 'Sai o texto como você deixou acima.' },
          { rotulo: 'Eu mesmo respondo', efeito: 'Nada sai; a carta fecha.' },
        ],
      },
      risco: { nivel: 'alto', texto: 'Fala por você com outra pessoa. A promessa da lista até segunda passa a ser sua.' },
      verso: {
        pedido: 'Marta: "Podemos descomissionar o stop-crescimento do Coolify? [...] Do seu lado está tudo ok, ou ainda falta algo antes?"',
        quem: 'Marta, por mensagem direta',
        caminhos: [['Enviar', 'Ela desliga e redireciona.'], ['Eu respondo', 'A conversa fica com você.']],
        tecnico: 'Todos os usos mapeados, inclusive os três seus, já usam o endereço novo.\nNa versão de hoje do app, a carta do texto foi aceita em 06/11 e a mensagem não saiu.',
      },
    },
    {
      id: 'tabela', naipe: 'escudos', quadro: 'Donel Dev', desde: 'entregue sábado, 07/11', peso: 1,
      real: 'Carta real de 07/11, já decidida. Aqui com a confirmação de segurar, porque não tem volta.',
      pergunta: 'Apago a tabela antiga de demandas?',
      destrava: 'acaba a tabela que fazia parecer que o registro tinha parado',
      destravaCurto: 'Uma tabela só',
      visual: {
        tipo: 'volta', titulo: 'O que tem e o que não tem volta',
        naoVolta: 'A tabela some da nuvem. Não existe desfazer.',
        volta: 'As 173 linhas ficam guardadas numa planilha; dá para recriar a tabela a partir dela.',
      },
      rec: { rotulo: 'Apagar', porque: 'Tudo o que ela tem também está na tabela nova, com mais informação, e ninguém escreve mais nela.' },
      resposta: {
        tipo: 'segurar',
        caminhos: [
          { rotulo: 'Apagar', efeito: 'Guardo as 173 linhas numa planilha e apago a tabela antiga.', rec: true, segurar: 'Segure para apagar' },
          { rotulo: 'Manter', efeito: 'Nada muda: as duas tabelas seguem lá.' },
        ],
      },
      risco: { nivel: 'alto', texto: 'Apagar não se desfaz na nuvem; a volta é recriar a partir da planilha guardada.' },
      verso: {
        pedido: '"Uma decisão do dono precisa virar carta no Oráculo, porque ele só decide por lá: apagar a tabela antiga."',
        quem: 'O Líder, depois de você abrir a tabela errada',
        caminhos: [['Apagar', 'Fica uma tabela só.'], ['Manter', 'As duas seguem.']],
        tecnico: 'Tabela antiga parada em 173 linhas; a nova recebe tudo desde 07/11.',
      },
    },
    {
      id: 'fabrica', naipe: 'coroas', quadro: 'BizOps', desde: 'entregue domingo, 08/11', peso: 2,
      real: 'Carta real de 08/11, já decidida. Aqui os números saem da prosa e viram medidor.',
      pergunta: 'A fábrica de casos gasta cota e ainda não gerou nenhuma ação. Mantenho ou fico só com o que gerou ação?',
      destrava: 'a cota do pool que a homologação divide com a fábrica',
      destravaCurto: 'Cota do pool',
      visual: {
        tipo: 'medidor', titulo: 'Custo × valor, medido na primeira hora',
        linhas: [
          { rot: 'Gasto por dia, no ritmo ligado', valor: '30 a 40 milhões de tokens', pct: 85, cls: 'ruim' },
          { rot: 'Contas do pool com cota', valor: '16 de 56', pct: 29, cls: 'ruim' },
          { rot: 'Contagem de rotinas até sexta', valor: 'passa de 400 (a sua meta)', pct: 100, cls: 'bom' },
        ],
        zero: { rot: 'Ações que os resumos geraram', valor: '0' },
      },
      rec: { rotulo: 'Ficar só com o que gerou ação', porque: 'O número sobe com o tamanho da lista, não com o valor; a conferência de crons e serviços é a única que achou problema real.' },
      resposta: {
        tipo: 'caminhos',
        caminhos: [
          { rotulo: 'Ficar só com o que gerou ação', efeito: 'Fica só a conferência diária de crons e serviços. O resto para.', rec: true },
          { rotulo: 'Manter tudo', efeito: 'As 12 rotinas seguem, com 150 a 200 casos por dia.' },
        ],
      },
      risco: { nivel: 'alto', texto: 'Manter tira cota da homologação, que usa as mesmas contas.' },
      verso: {
        pedido: '"A meta do dono é 400 workflows REAIS, e isso pode estar só enchendo o número."',
        quem: 'O Líder único, no domingo',
        caminhos: [['Podar', 'Sobra cota para a homologação.'], ['Manter', 'Número sobe, cota cai.']],
        tecnico: 'Primeira hora: 14 casos, cerca de 2,8 milhões de tokens, uns 120 mil por caso.',
      },
    },
  ];

  /* ------------------------------------------------------------------------------------------------
     utilidades
     ------------------------------------------------------------------------------------------------ */
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function copia(x) { return JSON.parse(JSON.stringify(x)); }

  /* ------------------------------------------------------------------------------------------------
     VISUAIS (um por carta, tipado)
     ------------------------------------------------------------------------------------------------ */
  function visual(v, card) {
    if (!v) return null;
    var box = el('div', 'oc-vis oc-vis-' + v.tipo);
    box.appendChild(el('h5', null, esc(v.titulo) + (v.nota ? '<i>' + esc(v.nota) + '</i>' : '')));
    if (v.tipo === 'checagens') {
      var ul = el('ul', 'oc-luzes');
      v.itens.forEach(function (it) {
        ul.appendChild(el('li', it[0], '<i>' + (it[0] === 'ok' ? '✓' : it[0] === 'nao' ? '✕' : '!') + '</i><b>' + esc(it[1]) + '</b><span>' + esc(it[2]) + '</span>'));
      });
      box.appendChild(ul);
    } else if (v.tipo === 'passos') {
      var ol = el('ol', 'oc-passos');
      v.passos.forEach(function (p) { ol.appendChild(el('li', null, '<div>' + esc(p[0]) + '<small>' + esc(p[1]) + '</small></div>')); });
      box.appendChild(ol);
      if (v.parado) box.appendChild(el('div', 'oc-parado', '<span class="trilho"></span><b>' + esc(v.parado) + '</b>'));
    } else if (v.tipo === 'grade') {
      var g = el('div', 'oc-grade');
      v.dias.forEach(function (d, i) {
        var col = el('div', 'col');
        col.appendChild(el('div', 'dia', esc(d)));
        v.blocos[i].forEach(function (b) { col.appendChild(el('div', 'bloco' + (b[1] ? ' ' + b[1] : ''), esc(b[0]))); });
        g.appendChild(col);
      });
      box.appendChild(g);
    } else if (v.tipo === 'comparacao') {
      var c = el('div', 'oc-comp');
      v.telas.forEach(function (t, i) {
        var f = el('figure');
        var b = el('button', 'ver');
        b.type = 'button';
        var tela = el('div', 'tela' + (t.rec ? ' rec' : ''));
        if (t.rec) tela.appendChild(el('span', 'selo-rec', 'recomendo'));
        if (t.forma === 'lista') {
          tela.innerHTML += '<span class="faixa">seus pedidos</span><div class="l o"></div><div class="l a"></div><div class="l"></div><div class="l a"></div><div class="l"></div><div class="l"></div>';
        } else if (t.forma === 'colunas') {
          tela.innerHTML += '<span class="faixa">por quadro</span><div class="cols"><div><div class="l a"></div><div class="l"></div></div><div><div class="l o"></div><div class="l"></div><div class="l"></div></div><div><div class="l v"></div></div></div>';
        } else {
          tela.innerHTML += '<span class="faixa">agora</span><div class="l o"></div><div class="l o"></div><span class="faixa">próximas</span><div class="l a"></div><span class="faixa">depois</span><div class="l"></div>';
        }
        b.appendChild(tela);
        b.addEventListener('click', function () { abrirTela(box, t, i); });
        f.appendChild(b);
        f.appendChild(el('figcaption', null, esc(t.rotulo)));
        c.appendChild(f);
      });
      box.appendChild(c);
    } else if (v.tipo === 'texto') {
      if (v.pedidoDe) box.appendChild(el('blockquote', 'oc-citacao', esc(v.pedidoDe.texto) + '<small>' + esc(v.pedidoDe.de) + '</small>'));
      box.appendChild(el('div', 'oc-msg-dest', 'Para <b>' + esc(v.para) + '</b> · você pode editar'));
      var ta = el('textarea', 'oc-msg oc-msg-edit');
      ta.value = v.texto;
      ta.rows = 5;
      ta.style.width = '100%';
      ta.style.font = 'inherit';
      ta.style.color = 'inherit';
      ta.setAttribute('aria-label', 'Mensagem a enviar');
      box.appendChild(ta);
      card._textoOriginal = v.texto;
    } else if (v.tipo === 'volta') {
      box.appendChild(el('div', 'oc-volta', '<div class="nao-volta"><b>Não volta</b>' + esc(v.naoVolta) + '</div><div class="volta"><b>Tem volta</b>' + esc(v.volta) + '</div>'));
    } else if (v.tipo === 'medidor') {
      var m = el('div', 'oc-medidor');
      v.linhas.forEach(function (l) {
        m.appendChild(el('div', 'linha', '<div class="rot"><span>' + esc(l.rot) + '</span><b>' + esc(l.valor) + '</b></div><div class="barra"><div class="' + l.cls + '" style="width:' + l.pct + '%"></div></div>'));
      });
      if (v.zero) m.appendChild(el('div', 'linha', '<div class="rot"><span>' + esc(v.zero.rot) + '</span><span class="zero">' + esc(v.zero.valor) + '</span></div>'));
      box.appendChild(m);
    }
    return box;
  }

  // Abrir uma das telas comparadas, grande, dentro da própria carta.
  function abrirTela(box, t, i) {
    var velho = box.querySelector('.oc-tela-aberta');
    if (velho) velho.remove();
    var a = el('div', 'oc-tela-aberta');
    a.style.cssText = 'margin-top:8px;border:1px solid var(--carta-borda);border-radius:8px;background:#151a21;color:#d7dde5;padding:10px;font:12px/1.4 var(--font-ui)';
    var linhas = {
      lista: '<b style="color:#e8b44c">Seus pedidos</b> · arraste para mudar a ordem<ol style="margin:6px 0 0;padding-left:18px"><li>Oráculo volta a ser mesa de tiragem <span style="color:#828d9c">· Donel Dev</span></li><li>Limpeza final da trava de carta <span style="color:#828d9c">· Theo</span></li><li>Ledger só registra <span style="color:#828d9c">· Donel Dev</span></li><li>Dono nunca entra em outra sessão <span style="color:#828d9c">· Donel Dev</span></li></ol>',
      colunas: '<b style="color:#e8b44c">Uma coluna por quadro</b><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:6px"><div>Donel Dev · 4<br><span style="color:#828d9c">mesa de tiragem<br>ledger só registra</span></div><div>BizOps · 4<br><span style="color:#828d9c">token da VPS<br>1:1s</span></div><div>Homologação · 3<br><span style="color:#828d9c">chave do AI Hub</span></div></div>',
      faixas: '<b style="color:#e8b44c">Agora</b> · mesa de tiragem, chave do AI Hub<br><b style="color:#4c9cf0">Próximas</b> · ledger só registra, âncora do proxy<br><b style="color:#828d9c">Depois</b> · faxina, gatilho de swap',
    };
    a.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:#828d9c">' + esc(t.rotulo) + '</span><button type="button" style="background:none;border:0;color:#828d9c">fechar</button></div>' + linhas[t.forma];
    a.querySelector('button').addEventListener('click', function () { a.remove(); });
    box.appendChild(a);
  }

  /* ------------------------------------------------------------------------------------------------
     RESPOSTAS (o jeito de responder muda com a decisão)
     ------------------------------------------------------------------------------------------------ */
  function resposta(card, decidir) {
    var r = card.resposta;
    var wrap = el('div', 'oc-resp oc-resp-' + r.tipo);

    function caminho(c, extraCls) {
      var b = el('button', 'oc-caminho' + (c.rec ? ' rec' : '') + (extraCls ? ' ' + extraCls : ''));
      b.type = 'button';
      b.innerHTML = '<b>' + esc(c.rotulo) + '</b>' + (c.rec ? '<em>recomendo</em>' : '<i></i>') + '<span>' + esc(c.efeito) + '</span>';
      return b;
    }

    if (r.tipo === 'caminhos' || r.tipo === 'fiz' || r.tipo === 'variante') {
      var lista = el('div', 'oc-caminhos');
      r.caminhos.forEach(function (c) {
        var b = caminho(c);
        // Dois toques: o primeiro arma, o segundo confirma (evita decisão por engano).
        b.addEventListener('click', function () {
          if (b.classList.contains('armado')) { decidir({ caminho: c.rotulo, rec: !!c.rec }); return; }
          lista.querySelectorAll('.armado').forEach(function (o) { o.classList.remove('armado'); var x = o.querySelector('.confirma'); if (x) x.remove(); });
          b.classList.add('armado');
          b.appendChild(el('span', 'confirma', 'Toque de novo para confirmar'));
        });
        lista.appendChild(b);
      });
      wrap.appendChild(lista);
    } else if (r.tipo === 'livre') {
      var campo = el('div', 'oc-campo');
      campo.appendChild(el('label', null, esc(r.rotulo)));
      var ta = el('textarea');
      ta.placeholder = r.placeholder;
      campo.appendChild(ta);
      var acoes = el('div', 'acoes');
      var env = el('button', 'oc-btn ouro', esc(r.enviar));
      env.type = 'button';
      env.disabled = true;
      ta.addEventListener('input', function () { env.disabled = !ta.value.trim(); });
      env.addEventListener('click', function () { decidir({ caminho: r.enviar, texto: ta.value.trim(), rec: true }); });
      acoes.appendChild(env);
      campo.appendChild(acoes);
      campo.appendChild(el('div', null, '<span style="font-size:.74rem;color:var(--tinta-suave)">' + esc(r.efeito) + '</span>'));
      wrap.appendChild(campo);
      var alt = caminho({ rotulo: r.alternativa.rotulo, efeito: r.alternativa.efeito });
      alt.style.marginTop = '8px';
      alt.addEventListener('click', function () {
        if (alt.classList.contains('armado')) { decidir({ caminho: r.alternativa.rotulo }); return; }
        alt.classList.add('armado');
        alt.appendChild(el('span', 'confirma', 'Toque de novo para confirmar'));
      });
      wrap.appendChild(alt);
    } else if (r.tipo === 'texto') {
      var l2 = el('div', 'oc-caminhos');
      var botoes = {};
      r.caminhos.forEach(function (c) {
        var b = caminho(c);
        botoes[c.rotulo] = b;
        b.addEventListener('click', function () {
          var t = card._raiz && card._raiz.querySelector('.oc-msg-edit');
          var editado = t && t.value !== card._textoOriginal;
          if (c.rotulo === 'Enviar editado' && !editado) { t && t.focus(); return; }
          if (b.classList.contains('armado')) { decidir({ caminho: c.rotulo, texto: t ? t.value : '', rec: !!c.rec }); return; }
          l2.querySelectorAll('.armado').forEach(function (o) { o.classList.remove('armado'); var x = o.querySelector('.confirma'); if (x) x.remove(); });
          b.classList.add('armado');
          b.appendChild(el('span', 'confirma', 'Toque de novo para enviar'));
        });
        l2.appendChild(b);
      });
      // "Enviar editado" só acende quando o texto muda.
      setTimeout(function () {
        var t = card._raiz && card._raiz.querySelector('.oc-msg-edit');
        var be = botoes['Enviar editado'];
        if (!t || !be) return;
        be.style.opacity = '.45';
        t.addEventListener('input', function () {
          var mudou = t.value !== card._textoOriginal;
          be.style.opacity = mudou ? '1' : '.45';
          botoes['Enviar como está'].style.opacity = mudou ? '.45' : '1';
        });
      }, 0);
      wrap.appendChild(l2);
    } else if (r.tipo === 'lote') {
      var itens = el('div', 'oc-itens');
      r.itens.forEach(function (it, i) {
        var d = el('div', 'oc-item');
        d.innerHTML = '<span class="t">' + (i + 1) + '. ' + esc(it.t) + '</span><span class="alterna"><button type="button" aria-pressed="true" class="ok">Aceito</button><button type="button" aria-pressed="false" class="troca">Mudar</button></span><span class="r"><b>Recomendo:</b> ' + esc(it.r) + '</span>' + (it.alt ? '<span class="alt">' + esc(it.alt) + '</span>' : '');
        if (it.num) {
          var n = el('div', 'oc-num');
          it.num.forEach(function (p) {
            var lab = el('label', null, esc(p[0]) + ' <button type="button" aria-label="menos">−</button><output>' + p[1] + '</output><button type="button" aria-label="mais">+</button>');
            var out = lab.querySelector('output');
            var bs = lab.querySelectorAll('button');
            bs[0].addEventListener('click', function () { out.textContent = Math.max(1, +out.textContent - 1); });
            bs[1].addEventListener('click', function () { out.textContent = +out.textContent + 1; });
            n.appendChild(lab);
          });
          d.appendChild(n);
        }
        var nota = el('span', 'nota', '<input type="text" placeholder="O que muda nesta? (as outras seguem)">');
        d.appendChild(nota);
        var bOk = d.querySelector('.alterna .ok');
        var bTr = d.querySelector('.alterna .troca');
        bOk.addEventListener('click', function () { bOk.setAttribute('aria-pressed', 'true'); bTr.setAttribute('aria-pressed', 'false'); d.classList.remove('trocando'); atualizar(); });
        bTr.addEventListener('click', function () { bTr.setAttribute('aria-pressed', 'true'); bOk.setAttribute('aria-pressed', 'false'); d.classList.add('trocando'); d.querySelector('input').focus(); atualizar(); });
        itens.appendChild(d);
      });
      wrap.appendChild(itens);
      var fim = el('button', 'oc-btn ouro');
      fim.type = 'button';
      fim.style.cssText = 'width:100%;margin-top:8px;padding:10px';
      function atualizar() {
        var mudando = itens.querySelectorAll('.trocando').length;
        fim.textContent = mudando ? 'Seguir com ' + (r.itens.length - mudando) + ' e mandar ' + mudando + ' de volta com a sua nota' : r.tudo;
      }
      atualizar();
      fim.addEventListener('click', function () {
        var mudando = itens.querySelectorAll('.trocando').length;
        decidir({ caminho: mudando ? 'Seguir com ' + (r.itens.length - mudando) + ', mudar ' + mudando : r.tudo, rec: !mudando });
      });
      wrap.appendChild(fim);
    } else if (r.tipo === 'segurar') {
      var l3 = el('div', 'oc-caminhos');
      r.caminhos.forEach(function (c) {
        var b = caminho(c, c.segurar ? 'oc-segurar' : '');
        if (c.segurar) {
          b.appendChild(el('span', 'confirma', esc(c.segurar)));
          b.appendChild(el('span', 'enchendo'));
          var timer = null;
          var ini = function (e) { e.preventDefault(); b.classList.add('segurando'); timer = setTimeout(function () { decidir({ caminho: c.rotulo, rec: !!c.rec }); }, 1200); };
          var fimS = function () { b.classList.remove('segurando'); clearTimeout(timer); };
          b.addEventListener('pointerdown', ini);
          b.addEventListener('pointerup', fimS);
          b.addEventListener('pointerleave', fimS);
        } else {
          b.addEventListener('click', function () {
            if (b.classList.contains('armado')) { decidir({ caminho: c.rotulo }); return; }
            b.classList.add('armado');
            b.appendChild(el('span', 'confirma', 'Toque de novo para confirmar'));
          });
        }
        l3.appendChild(b);
      });
      wrap.appendChild(l3);
    }
    return wrap;
  }

  /* ------------------------------------------------------------------------------------------------
     A CARTA INTEIRA
     ctx: { indice: 'I · VIII', aoDecidir(card, res), aoAgoraNao(card, quando), aoDecidaVoce(card) }
     res = { caminho, rec, texto?, tipo: 'decidiu' | 'decida-voce' }
     ------------------------------------------------------------------------------------------------ */
  function carta(card, ctx) {
    ctx = ctx || {};
    var raiz = el('article', 'oc-carta naipe-' + card.naipe);
    raiz.dataset.carta = card.id;
    card._raiz = raiz;
    var giro = el('div', 'oc-giro');
    raiz.appendChild(giro);

    function decidir(res) {
      res.tipo = res.tipo || 'decidiu';
      if (ctx.aoDecidir) ctx.aoDecidir(card, res);
    }

    // ---- frente
    var frente = el('div', 'oc-face frente');
    var mf = el('div', 'oc-moldura');
    var fi = el('div', 'oc-interna');
    mf.appendChild(fi);
    frente.appendChild(mf);
    fi.appendChild(el('div', 'oc-cabeca', '<span class="glifo">' + GLIFOS[card.naipe] + '</span><span class="tipo">' + esc(NAIPES[card.naipe]) + '</span><span class="idx">' + esc(ctx.indice || '') + '</span>'));
    var rol = el('div', 'oc-rolagem');
    fi.appendChild(rol);
    rol.appendChild(el('div', 'oc-meta', '<span>' + esc(card.quadro) + '</span><span class="' + (card.urgente ? 'urgente' : '') + '">' + esc(card.desde) + '</span>'));
    // 1. o que você decide
    rol.appendChild(el('h3', 'oc-pergunta', esc(card.pergunta)));
    rol.appendChild(el('div', 'oc-destrava', '<b>Destrava:</b> ' + esc(card.destrava)));
    // visual primeiro
    if (card.citacao) rol.appendChild(el('blockquote', 'oc-citacao', '"' + esc(card.citacao.texto) + '"<small>' + esc(card.citacao.de) + '</small>'));
    var vis = visual(card.visual, card);
    if (vis) rol.appendChild(vis);
    // 2. recomendação e porquê
    rol.appendChild(el('div', 'oc-rec', 'Recomendo <b>' + esc(card.rec.rotulo) + '</b>: ' + esc(card.rec.porque)));
    // 3. o que acontece em cada caminho (a resposta)
    rol.appendChild(resposta(card, decidir));
    // 4. risco
    rol.appendChild(el('div', 'oc-risco ' + card.risco.nivel, '<i>risco ' + esc(card.risco.nivel) + '</i><span>' + esc(card.risco.texto) + '</span>'));
    rol.appendChild(el('div', 'oc-real', esc(card.real)));

    // saídas de sempre
    var saidas = el('div', 'oc-saidas');
    var g = el('div', 'grupo');
    var bDecida = el('button', null, 'Decida você');
    var bPerg = el('button', null, 'Perguntar');
    var bDepois = el('button', null, 'Agora não');
    [bDecida, bPerg, bDepois].forEach(function (b) { b.type = 'button'; g.appendChild(b); });
    saidas.appendChild(g);
    var bVirar = el('button', 'virar', '↻ Virar');
    bVirar.type = 'button';
    saidas.appendChild(bVirar);
    var painel = el('div', 'oc-saidas-painel');
    fi.appendChild(painel);
    fi.appendChild(saidas);

    bDecida.addEventListener('click', function () {
      painel.className = 'oc-saidas-painel on';
      painel.innerHTML = 'A sessão segue a recomendação (<b>' + esc(card.rec.rotulo) + '</b>) e só volta se algo sair do previsto. <div class="chips"><button type="button" data-ok>Sim, decida você</button><button type="button" data-x>Cancelar</button></div>';
      painel.querySelector('[data-ok]').onclick = function () { decidir({ caminho: card.rec.rotulo, rec: true, tipo: 'decida-voce' }); };
      painel.querySelector('[data-x]').onclick = function () { painel.className = 'oc-saidas-painel'; };
    });
    bPerg.addEventListener('click', function () {
      painel.className = 'oc-saidas-painel on';
      painel.innerHTML = '<textarea placeholder="Sua pergunta. A carta fica na mesa e a resposta volta nela."></textarea><div class="chips"><button type="button" data-ok>Perguntar</button><button type="button" data-x>Cancelar</button></div>';
      painel.querySelector('[data-ok]').onclick = function () {
        var t = painel.querySelector('textarea').value.trim();
        if (!t) return;
        painel.className = 'oc-saidas-painel';
        var e = el('div', 'oc-esperando', '<b>Você perguntou:</b> ' + esc(t) + '<br><span style="color:var(--tinta-suave)">A resposta volta nesta carta. Ela fica na mesa.</span>');
        rol.appendChild(e);
        e.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
      painel.querySelector('[data-x]').onclick = function () { painel.className = 'oc-saidas-painel'; };
    });
    bDepois.addEventListener('click', function () {
      painel.className = 'oc-saidas-painel on';
      painel.innerHTML = 'Tirar da mesa sem decidir. Volta: <div class="chips"><button type="button" data-q="em 2 horas">em 2 horas</button><button type="button" data-q="amanhã cedo">amanhã cedo</button><button type="button" data-q="segunda">segunda</button><button type="button" data-x>Cancelar</button></div>';
      painel.querySelectorAll('[data-q]').forEach(function (b) { b.onclick = function () { if (ctx.aoAgoraNao) ctx.aoAgoraNao(card, b.dataset.q); }; });
      painel.querySelector('[data-x]').onclick = function () { painel.className = 'oc-saidas-painel'; };
    });

    // ---- verso
    var verso = el('div', 'oc-face verso');
    var mv = el('div', 'oc-moldura');
    var vi = el('div', 'oc-interna');
    mv.appendChild(vi);
    verso.appendChild(mv);
    vi.appendChild(el('div', 'oc-cabeca', '<span class="glifo">' + GLIFOS[card.naipe] + '</span><span class="tipo">O verso</span><span class="idx">' + esc(ctx.indice || '') + '</span>'));
    var vc = el('div', 'oc-verso-corpo');
    var html = '<h4>Por que recomendo</h4><p>' + esc(card.rec.porque) + '</p>';
    html += '<h4>Cada caminho</h4><dl>' + card.verso.caminhos.map(function (c) { return '<dt>' + esc(c[0]) + '</dt><dd>' + esc(c[1]) + '</dd>'; }).join('') + '</dl>';
    html += '<h4>Quem pediu</h4><p>' + esc(card.verso.quem) + '</p>';
    html += '<details><summary>O pedido, nas palavras de quem pediu</summary><blockquote>' + esc(card.verso.pedido) + '</blockquote></details>';
    html += '<details><summary>Detalhe técnico</summary><div class="tec">' + esc(card.verso.tecnico) + '</div></details>';
    vc.innerHTML = html;
    vi.appendChild(vc);
    var sv = el('div', 'oc-saidas');
    var bVolta = el('button', 'virar', '↻ Frente');
    bVolta.type = 'button';
    sv.appendChild(el('span', null, ''));
    sv.appendChild(bVolta);
    vi.appendChild(sv);

    bVirar.addEventListener('click', function () { raiz.classList.add('virada'); });
    bVolta.addEventListener('click', function () { raiz.classList.remove('virada'); });

    giro.appendChild(frente);
    giro.appendChild(verso);
    return raiz;
  }

  // A carta fechada (miniatura): naipe, pergunta curta e o que destrava.
  function mini(card, opts) {
    opts = opts || {};
    var b = el(opts.tag || 'button', 'oc-mini naipe-' + card.naipe);
    if (b.tagName === 'BUTTON') b.type = 'button';
    b.dataset.carta = card.id;
    b.innerHTML = '<span class="topo"><span class="glifo">' + GLIFOS[card.naipe] + '</span><small>' + esc(NAIPES[card.naipe]) + '</small>' + (card.urgente ? '<span class="urg">parado</span>' : '') + '</span><b>' + esc(card.pergunta) + '</b><span class="dest"><em>Destrava:</em> ' + esc(card.destravaCurto) + '</span>';
    return b;
  }
  function dorso() { return el('div', 'oc-dorso', VERSO_SVG); }

  // Aviso que mostra o que a decisão destravou.
  function toast(vista, card, res) {
    var t = vista.querySelector('.oc-toast');
    if (!t) { t = el('div', 'oc-toast'); vista.appendChild(t); }
    var o = res.tipo === 'decida-voce' ? 'A sessão segue a recomendação.' : res.tipo === 'agora-nao' ? 'Volta ' + esc(res.quando) + '.' : 'Você escolheu: ' + esc(res.caminho) + '.';
    t.innerHTML = res.tipo === 'agora-nao' ? '<span>Fora da mesa. ' + o + '</span>' : '<b>Destravado</b><span>' + esc(card.destravaCurto) + '. ' + o + '</span>';
    t.classList.add('on');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }

  window.Oraculo = { CARTAS: CARTAS, GLIFOS: GLIFOS, NAIPES: NAIPES, ROMANOS: ROMANOS, carta: carta, mini: mini, dorso: dorso, toast: toast, el: el, esc: esc, copia: copia };

  /* ------------------------------------------------------------------------------------------------
     CASCA: escolhe variante, tela (PC, celular, os dois) e tema; monta cada variante em cada moldura.
     Cada variante registra-se em window.VARIANTES[letra] = { nome, sobre, montar(vista, cartas) }.
     ------------------------------------------------------------------------------------------------ */
  window.VARIANTES = window.VARIANTES || {};
  document.addEventListener('DOMContentLoaded', function () {
    var letras = Object.keys(window.VARIANTES).sort();
    var estado = { v: (location.hash.replace('#', '') || letras[0]), tela: window.innerWidth < 700 ? 'cel-solo' : 'os-dois', tema: 'escuro' };
    if (letras.indexOf(estado.v) < 0) estado.v = letras[0];
    var barra = document.querySelector('.casca-barra');
    var gv = barra.querySelector('[data-grupo=variante]');
    letras.forEach(function (l) {
      var b = el('button', null, l + ' · ' + esc(window.VARIANTES[l].nome));
      b.type = 'button';
      b.dataset.v = l;
      b.onclick = function () { estado.v = l; desenhar(); };
      gv.appendChild(b);
    });
    barra.querySelectorAll('[data-tela]').forEach(function (b) { b.onclick = function () { estado.tela = b.dataset.tela; desenhar(); }; });
    barra.querySelectorAll('[data-tema]').forEach(function (b) { b.onclick = function () { estado.tema = b.dataset.tema; desenhar(); }; });
    var rb = barra.querySelector('[data-recomecar]');
    if (rb) rb.onclick = function () { desenhar(); };

    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if ((t.matches && t.matches('input, textarea, select')) || t.isContentEditable) return;
      if (!e.altKey) return;
      var i = letras.indexOf(estado.v);
      if (e.key === 'ArrowRight') { estado.v = letras[(i + 1) % letras.length]; desenhar(); }
      if (e.key === 'ArrowLeft') { estado.v = letras[(i - 1 + letras.length) % letras.length]; desenhar(); }
    });

    function moldura(tipo) {
      var w = el('div');
      var vista = el('div', 'vista tema-' + (tipo === 'pc' ? 'escuro' : estado.tema));
      if (tipo === 'pc') {
        w.appendChild(el('div', 'casca-rotulo', 'PC · Donel Dev, Uso geral'));
        var pc = el('div', 'pc');
        pc.appendChild(el('div', 'pc-titulo', '<i></i><i></i><i></i><span>Donel Dev Alfa · Uso geral</span><span class="troca"><b>Oráculo</b><span>Terminais</span></span>'));
        var tela = el('div', 'pc-tela');
        tela.appendChild(vista);
        pc.appendChild(tela);
        w.appendChild(pc);
        if (estado.tema === 'claro') vista.className = 'vista tema-claro';
      } else {
        w.appendChild(el('div', 'casca-rotulo', 'Celular · Oráculo Harrow'));
        var cel = el('div', 'cel');
        var ct = el('div', 'cel-tela tema-' + estado.tema);
        ct.appendChild(el('div', 'cel-status', '<span>16:20</span><span>Tailscale · 82%</span>'));
        ct.appendChild(vista);
        cel.appendChild(ct);
        w.appendChild(cel);
      }
      return { w: w, vista: vista };
    }

    function desenhar() {
      location.hash = estado.v;
      gv.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === estado.v)); });
      barra.querySelectorAll('[data-tela]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.tela === estado.tela || (estado.tela === 'cel-solo' && b.dataset.tela === 'cel'))); });
      barra.querySelectorAll('[data-tema]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.tema === estado.tema)); });
      var V = window.VARIANTES[estado.v];
      document.querySelector('.casca-sobre').innerHTML = '<b>' + esc(estado.v + ' · ' + V.nome) + '.</b> ' + V.sobre;
      var palco = document.querySelector('.casca-palco');
      palco.innerHTML = '';
      var telas = estado.tela === 'os-dois' ? ['cel', 'pc'] : estado.tela === 'cel-solo' ? ['cel'] : [estado.tela];
      telas.forEach(function (t) {
        var m = moldura(t);
        palco.appendChild(m.w);
        V.montar(m.vista, copia(CARTAS));
      });
      // celular de verdade (tela estreita): a moldura some e a vista ocupa a tela
      document.body.classList.toggle('no-celular', window.innerWidth < 700);
    }
    desenhar();
  });
})();
