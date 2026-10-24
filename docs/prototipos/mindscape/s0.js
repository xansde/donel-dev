
/* ============================ Dados mockados ============================ */
var STATE = {
  working:    { label: 'Trabalhando',            icon: '▶' },
  waiting:    { label: 'Aguardando resposta',    icon: '◐' },
  permission: { label: 'Permissão pendente',     icon: '!' },
  done:       { label: 'Encerrada',              icon: '■' },
  error:      { label: 'Falha ou quota esgotada', icon: '✕' }
};
var TABCOLOR = { none: 'Sem cor', accent: 'Azul', 'donel-accent': 'Dourado', permission: 'Vermelho' };
var ESTEIRAS = {
  dev: { name: 'Esteira dev', phases: [
    { id: 'discovery', label: 'Discovery', tok: '--phase-discovery' },
    { id: 'plano', label: 'Plano', tok: '--phase-plano' },
    { id: 'design', label: 'Design', tok: '--phase-design' },
    { id: 'implementar', label: 'Implementar', tok: '--phase-implementar' },
    { id: 'validar', label: 'Validar', tok: '--phase-validar' },
    { id: 'concluir', label: 'Concluir', tok: '--phase-concluir' } ] },
  hom: { name: 'Esteira de homologação', phases: [
    { id: 'triagem', label: 'Triagem' },
    { id: 'preparar', label: 'Preparar repo' },
    { id: 'conferir', label: 'Conferir técnico' },
    { id: 'atesto', label: 'Atesto do dono' },
    { id: 'subir', label: 'Subir pra produção' } ] }
};
var PROJECTS = ['atlas', 'beacon', 'vega'];
var FLOWS = {
  'atlas-rel':     { project: 'atlas',  esteira: 'dev', name: 'relatórios mensais' },
  'beacon-login':  { project: 'beacon', esteira: 'dev', name: 'login social' },
  'beacon-hotfix': { project: 'beacon', esteira: 'dev', name: 'hotfix do token' },
  'beacon-hom':    { project: 'beacon', esteira: 'hom', name: 'homologação' },
  'vega-painel':   { project: 'vega',   esteira: 'dev', name: 'painel de aprovações' },
  'vega-hom':      { project: 'vega',   esteira: 'hom', name: 'homologação' }
};
var SESSIONS = [
  { id: 's1',  name: 'atlas/discovery-relatorios', flow: 'atlas-rel', phase: 'discovery', state: 'done', model: 'fable', ago: 'há 2 dias', mins: 2880, color: 'accent' },
  { id: 's2',  name: 'atlas/plano-relatorios', flow: 'atlas-rel', phase: 'plano', state: 'done', model: 'fable', ago: 'ontem, 17:40', mins: 1260, color: 'accent', after: ['s1'] },
  { id: 's3',  name: 'atlas/revisao-fatia-2', flow: 'atlas-rel', phase: 'validar', state: 'done', model: 'opus', ago: 'hoje, 11:05', mins: 220, color: 'accent', after: ['s2'] },
  { id: 's4',  name: 'atlas/fatia-3-exportar-csv', flow: 'atlas-rel', phase: 'implementar', state: 'working', model: 'sonnet', ago: 'há 14 min', mins: 14, color: 'accent', after: ['s2'] },
  { id: 's5',  name: 'atlas/fatia-4-filtros', flow: 'atlas-rel', phase: 'implementar', state: 'permission', model: 'sonnet', ago: 'há 6 min', mins: 6, color: 'accent', after: ['s2'] },
  { id: 's6',  name: 'beacon/discovery-login-social', flow: 'beacon-login', phase: 'discovery', state: 'waiting', model: 'fable', ago: 'há 22 min', mins: 22, color: 'donel-accent' },
  { id: 's7',  name: 'beacon/hotfix-token', flow: 'beacon-hotfix', phase: 'implementar', state: 'error', model: 'sonnet', ago: 'há 48 min', mins: 48, color: 'permission' },
  { id: 's8',  name: 'beacon/validar-pr-77', flow: 'beacon-hotfix', phase: 'validar', state: 'waiting', model: 'opus', ago: 'há 1h10', mins: 70, color: 'permission', after: ['s7'] },
  { id: 's9',  name: 'beacon/triagem', flow: 'beacon-hom', phase: 'triagem', state: 'working', model: 'sonnet', ago: 'há 3 min', mins: 3, color: 'donel-accent' },
  { id: 's10', name: 'vega/preparar-repo', flow: 'vega-hom', phase: 'preparar', state: 'done', model: 'sonnet', ago: 'hoje, 09:20', mins: 330, color: 'none' },
  { id: 's11', name: 'vega/conferir-tecnico', flow: 'vega-hom', phase: 'conferir', state: 'permission', model: 'opus', ago: 'há 2 min', mins: 2, color: 'none', after: ['s10'] },
  { id: 's12', name: 'vega/plano-painel', flow: 'vega-painel', phase: 'plano', state: 'working', model: 'fable', ago: 'há 31 min', mins: 31, color: 'none', after: ['s13'] },
  { id: 's13', name: 'vega/discovery-painel', flow: 'vega-painel', phase: 'discovery', state: 'done', model: 'fable', ago: 'ontem, 15:12', mins: 1380, color: 'none' }
];
var NOTES = [
  { id: 'n1',  by: 's4',  when: 'hoje, 14:32', text: 'Fatia 3 pronta: exportar CSV. Testes verdes (42/42). PR #81 aberto contra staging; agora escrevendo o teste de ponta a ponta.' },
  { id: 'n2',  by: 's1',  when: 'há 2 dias', text: 'Spec de produto fechada: relatórios mensais por projeto. 3 pendências viraram itens do plano.' },
  { id: 'n3',  by: 's2',  when: 'ontem, 17:38', text: 'Plano com 5 fatias. A 3 e a 4 podem rodar em paralelo; a 5 depende das duas.' },
  { id: 'n4',  by: 's3',  when: 'hoje, 11:04', text: 'Fatia 2 validada no produto real. 1 achado menor: rótulo do filtro truncado. PR #79 pronto para merge.' },
  { id: 'n5',  by: 's5',  when: 'hoje, 14:40', text: 'Parei antes da migração local: pedi permissão para rodar npm run db:migrate.' },
  { id: 'n6',  by: 's7',  when: 'hoje, 13:58', text: 'Quota esgotada no meio do fix. Último commit: teste de regressão do token expirado (ainda vermelho).' },
  { id: 'n7',  by: 's8',  when: 'hoje, 13:36', text: 'Roteiro de validação do PR #77 pronto: 6 passos. Falta você rodar o passo 4 (login com conta nova).' },
  { id: 'n8',  by: 's6',  when: 'hoje, 14:24', text: 'Três hipóteses de dor levantadas. Preciso que você escolha uma antes de seguir.' },
  { id: 'n9',  by: 's10', when: 'hoje, 09:18', text: 'Branch protection e sast-caller configurados. PR #12 aberto no repo do vega.' },
  { id: 'n10', by: 's11', when: 'hoje, 14:44', text: 'RLS conferida em 9 de 11 tabelas. Pedi permissão para consultar o catálogo das 2 restantes.' },
  { id: 'n11', by: 's13', when: 'ontem, 15:10', text: 'Discovery fechado: a dor é acompanhar a fila de aprovações. Spec em docs/produto/painel.spec.md.' },
  { id: 'u1', by: 'user', link: 's3',  color: 'permission',   when: 'hoje, 12:10', text: 'Falta revisar o PR #79 antes de sexta.' },
  { id: 'u2', by: 'user', project: 'atlas', color: 'none',    when: 'ontem', text: 'Ideia: o relatório mensal podia sair também em PDF.' },
  { id: 'u3', by: 'user', link: 's6',  color: 'donel-accent', when: 'hoje, 10:02', text: 'Perguntar se o login social entra na V1.' },
  { id: 'u4', by: 'user', color: 'accent',                    when: 'hoje, 13:45', text: 'Trocar de conta antes do lote noturno.' },
  { id: 'u5', by: 'user', link: 's11', color: 'donel-accent', when: 'ontem', text: 'O atesto do dono no vega depende da reunião de quinta.' },
  { id: 'u6', by: 'user', link: 's5',  color: 'permission',   when: 'hoje, 14:05', text: 'Bug no teste manual: o filtro some ao voltar da aba.' },
  { id: 'u7', by: 'user', link: 's8',  color: 'accent',       when: 'hoje, 13:20', text: 'Quero o roteiro de teste mais curto desta vez.' },
  { id: 'u8', by: 'user', color: 'none',                      when: 'há 3 dias', text: 'Depois: comparar o tempo de CI entre atlas e beacon.' }
];

/* Derivações */
var S = {}; SESSIONS.forEach(function (s) { S[s.id] = s; s.project = FLOWS[s.flow].project; s.esteira = FLOWS[s.flow].esteira; });
NOTES.forEach(function (n) {
  n.session = n.by !== 'user' ? n.by : (n.link || null);
  var s = n.session ? S[n.session] : null;
  n.flow = s ? s.flow : null;
  n.project = s ? s.project : (n.project || null);
  n.esteira = s ? s.esteira : null;
  n.phase = s ? s.phase : null;
  if (n.by !== 'user') n.color = S[n.by].color;
});
var STOPPED = ['permission', 'error', 'waiting'];
function isStopped(s) { return STOPPED.indexOf(s.state) >= 0; }
function notesOf(sid) { return NOTES.filter(function (n) { return n.session === sid; }); }
function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function phaseOf(est, pid) { return ESTEIRAS[est].phases.filter(function (p) { return p.id === pid; })[0]; }

/* ============================ Peças compartilhadas ============================ */
function chip(est, pid) {
  var p = phaseOf(est, pid);
  var c = p.tok ? 'var(' + p.tok + ')' : 'var(--text-muted)';
  return '<span class="chip" style="--phase-color:' + c + '">' + p.label + '</span>';
}
function sessCard(s, opt) {
  opt = opt || {};
  return '<div class="sess st-' + s.state + '" data-open="s:' + s.id + '" data-sid="' + s.id + '" style="--stripe:var(--tabc-' + s.color + ')">' +
    '<span class="seal">Sessão</span>' +
    '<div class="sess-head"><span class="glyph">' + STATE[s.state].icon + '</span><span class="sess-name" title="' + s.name + '">' + (opt.short ? s.name.split('/')[1] : s.name) + '</span><span class="sess-model">' + s.model + '</span></div>' +
    '<div class="sess-row"><span class="dot"></span><span class="sess-state">' + STATE[s.state].label + '</span><span class="sess-ago">' + s.ago + '</span></div>' +
    (opt.noChip ? '' : '<div class="sess-row">' + chip(s.esteira, s.phase) + '<span class="sess-ago">' + notesOf(s.id).length + ' post-its</span></div>') +
    '</div>';
}
function noteCard(n, opt) {
  opt = opt || {};
  var rot = opt.tilt && n.by === 'user' ? ' style="--stripe:var(--tabc-' + n.color + ');transform:rotate(' + ((n.id.charCodeAt(1) % 5) - 2) * 0.7 + 'deg)"' : ' style="--stripe:var(--tabc-' + n.color + ')"';
  var head = n.by === 'user' ? '' :
    '<span class="note-author st-' + S[n.by].state + '"><span class="glyph">' + STATE[S[n.by].state].icon + '</span>' + (opt.short ? S[n.by].name.split('/')[1] : S[n.by].name) + '</span>';
  var who = n.by === 'user' ? '<span class="you">✎ você</span>' : '<span>escrito pela sessão</span>';
  return '<div class="note ' + (n.by === 'user' ? 'by-user' : 'by-session') + '" data-open="n:' + n.id + '"' + rot + '>' +
    head + '<p>' + esc(n.text) + '</p><div class="note-meta">' + who + '<span>' + n.when + (n.project && opt.showProject ? ' · ' + n.project : '') + '</span></div></div>';
}
function legendHTML() {
  return '<span>Cor (paleta da aba):</span>' + Object.keys(TABCOLOR).map(function (k) {
    return '<span><span class="sw" style="background:var(--tabc-' + k + ')"></span>' + TABCOLOR[k] + '</span>';
  }).join('') + '<span>· <b style="color:var(--text-primary)">SESSÃO</b> = a sessão · <span style="font-family:var(--font-mono)">▶ nome</span> = escrito pela sessão · <span style="color:var(--donel-accent)">✎ você</span> = seu</span>';
}

/* Casco: sidebar + abas + statusbar */
(function shell() {
  var h = '<div><p class="section-title">Projetos</p>';
  PROJECTS.forEach(function (p) {
    h += '<div class="proj-root">▾ ~/seazone/' + p + '</div>';
    SESSIONS.filter(function (s) { return s.project === p && s.state !== 'done'; }).forEach(function (s) {
      h += '<div class="srow st-' + s.state + '"><span class="dot"></span><span class="nm">' + s.name.split('/')[1] + '</span><span class="ago">' + s.ago.replace('há ', '') + '</span></div>';
    });
  });
  h += '</div><div><p class="section-title">Encerradas hoje</p>';
  SESSIONS.filter(function (s) { return s.state === 'done'; }).slice(0, 3).forEach(function (s) {
    h += '<div class="srow st-done"><span class="dot"></span><span class="nm">' + s.name + '</span></div>';
  });
  document.getElementById('sidebar').innerHTML = h + '</div>';
  var tabs = ['s4', 's5', 's11', 's8'].map(function (id) {
    var s = S[id];
    return '<div class="tab st-' + s.state + '" style="--stripe:var(--tabc-' + s.color + ')"><span class="glyph">' + STATE[s.state].icon + '</span><span class="tn">' + s.name + '</span><span class="tm">' + s.model + '</span></div>';
  }).join('') + '<div class="tab"><span class="glyph" style="color:var(--text-muted)">❯</span><span class="tn">zsh</span></div>';
  document.getElementById('tabbar').innerHTML = tabs + '<span class="tabhint">o Mindscape ocupa o lugar do terminal</span>';
  var nStop = SESSIONS.filter(isStopped).length;
  document.getElementById('sb-count').textContent = SESSIONS.filter(function (s) { return s.state !== 'done'; }).length + ' sessões vivas · ' + nStop + ' paradas · ' + NOTES.length + ' post-its';
})();

/* Gaveta de detalhe + toast */
var drawer = document.getElementById('drawer');
function toast(msg) { var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._h); toast._h = setTimeout(function () { t.classList.remove('show'); }, 2200); }
function detailHTML(key) {
  var kind = key[0], id = key.slice(2), h = '';
  if (kind === 's') {
    var s = S[id], f = FLOWS[s.flow];
    h += sessCard(s);
    h += '<dl class="kv"><dt>Projeto</dt><dd class="mono">' + s.project + '</dd><dt>Esteira</dt><dd>' + ESTEIRAS[s.esteira].name + ' · ' + f.name + '</dd><dt>Fase</dt><dd>' + chip(s.esteira, s.phase) + '</dd><dt>Estado</dt><dd>' + STATE[s.state].label + ' · ' + s.ago + '</dd></dl>';
    h += '<div class="actions"><button type="button" class="tb-btn" data-toast="Abriria a aba ' + s.name + '">Abrir aba</button><button type="button" class="tb-btn ghost" data-toast="Abriria um post-it ligado a esta sessão">＋ Post-it nesta sessão</button></div>';
    var ns = notesOf(id);
    h += '<p class="section-title">Post-its desta sessão (' + ns.length + ')</p>' + ns.map(function (n) { return noteCard(n); }).join('');
    return { title: 'Sessão', html: h };
  }
  var n = NOTES.filter(function (x) { return x.id === id; })[0];
  h += noteCard(n, { showProject: true });
  h += '<dl class="kv"><dt>Autor</dt><dd>' + (n.by === 'user' ? 'você' : '<span class="mono">' + S[n.by].name + '</span>') + '</dd><dt>Projeto</dt><dd class="mono">' + (n.project || '— (geral)') + '</dd><dt>Ligado a</dt><dd class="mono">' + (n.session ? S[n.session].name : '— (solto)') + '</dd><dt>Cor</dt><dd>' + TABCOLOR[n.color] + (n.by === 'user' ? '' : ' (herdada da aba da sessão)') + '</dd></dl>';
  h += '<div class="actions"><button type="button" class="tb-btn" data-toast="Abriria o seletor de sessão">Enviar para sessão…</button><button type="button" class="tb-btn ghost" data-toast="Copiado (de mentira)">Copiar</button><button type="button" class="tb-btn ghost" data-toast="Arquivado (de mentira)">Arquivar</button></div>';
  if (n.session) h += '<p class="section-title">Sessão</p>' + sessCard(S[n.session]);
  return { title: n.by === 'user' ? 'Post-it seu' : 'Post-it da sessão', html: h };
}
function openDetail(key) {
  var d = detailHTML(key);
  document.getElementById('drawer-title').textContent = d.title;
  document.getElementById('drawer-body').innerHTML = d.html;
  drawer.classList.add('open');
}
document.getElementById('drawer-x').addEventListener('click', function () { drawer.classList.remove('open'); });
document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-toast]'); if (t) { toast(t.getAttribute('data-toast')); return; }
  var o = e.target.closest('[data-open]');
  if (o && !e.target.closest('#a-view') && !e.target.closest('#d-world') && !e.target.closest('.drawer')) openDetail(o.getAttribute('data-open'));
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') drawer.classList.remove('open'); });
window.addEventListener('hashchange', function () { drawer.classList.remove('open'); });

/* ============================ A — Canvas livre ============================ */
(function variantA() {
  var MS = [
    { id: 'atlas', kind: 'projeto', label: 'atlas' },
    { id: 'beacon', kind: 'projeto', label: 'beacon' },
    { id: 'vega', kind: 'projeto', label: 'vega' },
    { id: 'dev', kind: 'esteira', label: 'Esteira dev' },
    { id: 'hom', kind: 'esteira', label: 'Homologação' }
  ];
  var cur = 'atlas', pos = {}, view = { x: 20, y: 10, z: 0.85 }, worldSize = { w: 0, h: 0 }, groupsCache = [];
  var vEl = document.getElementById('a-view'), wEl = document.getElementById('a-world'), mini = document.getElementById('a-mini');
  document.getElementById('a-legend').innerHTML = legendHTML();

  function tabs() {
    document.getElementById('a-tabs').innerHTML = MS.map(function (m) {
      var n = SESSIONS.filter(function (s) { return (m.kind === 'projeto' ? s.project : s.esteira) === m.id && isStopped(s); }).length;
      return '<button type="button" class="a-tab' + (m.id === cur ? ' on' : '') + '" data-ms="' + m.id + '"><span class="kind">' + m.kind + '</span>' + m.label + (n ? ' <span class="count hot">' + n + '</span>' : '') + '</button>';
    }).join('') + '<button type="button" class="a-tab new" data-toast="Criaria um mindscape novo (por projeto ou por esteira)">＋ Mindscape</button>';
  }
  function layout() {
    var m = MS.filter(function (x) { return x.id === cur; })[0];
    var flows = Object.keys(FLOWS).filter(function (f) { return m.kind === 'projeto' ? FLOWS[f].project === cur : FLOWS[f].esteira === cur; });
    var groups = [], items = [], x = 40;
    flows.forEach(function (f) {
      var ss = SESSIONS.filter(function (s) { return s.flow === f; });
      var gx = x, gy = 40, rowH = 168, w = 760, h = 56 + ss.length * rowH;
      groups.push({ x: gx, y: gy, w: w, h: h, label: m.kind === 'projeto' ? FLOWS[f].name : FLOWS[f].project + ' · ' + FLOWS[f].name, sub: ESTEIRAS[FLOWS[f].esteira].name });
      ss.forEach(function (s, i) {
        var ry = gy + 60 + i * rowH;
        items.push({ key: 's:' + s.id, x: gx + 20, y: ry, html: sessCard(s) });
        notesOf(s.id).forEach(function (n, j) { items.push({ key: 'n:' + n.id, x: gx + 280 + j * 236, y: ry - 6 + (j % 2) * 10, html: noteCard(n, { tilt: true }) }); });
      });
      x += w + 60;
    });
    var loose = NOTES.filter(function (n) { return !n.session && (m.kind === 'projeto' ? (n.project === cur || !n.project) : false); });
    if (loose.length) {
      groups.push({ x: x, y: 40, w: 520, h: 56 + Math.ceil(loose.length / 2) * 150, label: 'Soltos', sub: 'post-its sem sessão' });
      loose.forEach(function (n, i) { items.push({ key: 'n:' + n.id, x: x + 20 + (i % 2) * 245, y: 100 + Math.floor(i / 2) * 150, html: noteCard(n, { tilt: true, showProject: true }) }); });
      x += 580;
    }
    groupsCache = groups;
    var maxH = groups.reduce(function (a, g) { return Math.max(a, g.y + g.h); }, 0);
    worldSize = { w: x + 200, h: maxH + 200 };
    pos[cur] = pos[cur] || {};
    wEl.style.width = worldSize.w + 'px'; wEl.style.height = worldSize.h + 'px';
    wEl.innerHTML = groups.map(function (g) {
      return '<div class="a-group" style="left:' + g.x + 'px;top:' + g.y + 'px;width:' + g.w + 'px;height:' + g.h + 'px"><div class="a-group-label">' + esc(g.label) + ' <span class="sub">' + g.sub + '</span></div></div>';
    }).join('') + items.map(function (it, i) {
      var p = pos[cur][it.key] || { x: it.x, y: it.y };
      return '<div class="a-item" data-key="' + it.key + '" style="left:' + p.x + 'px;top:' + p.y + 'px;z-index:' + (i + 1) + '">' + it.html + '</div>';
    }).join('');
    apply(); drawMini();
  }
  function apply() {
    wEl.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.z + ')';
    vEl.style.backgroundPosition = view.x + 'px ' + view.y + 'px';
    vEl.style.backgroundSize = (22 * view.z) + 'px ' + (22 * view.z) + 'px';
    document.getElementById('a-zl').textContent = Math.round(view.z * 100) + '%';
    drawMini();
  }
  function drawMini() {
    var mw = 220, mh = 130, k = Math.min(mw / worldSize.w, (mh - 14) / worldSize.h);
    var h = '<span class="a-mini-label">minimapa</span>';
    groupsCache.forEach(function (g) { h += '<span class="m" style="left:' + g.x * k + 'px;top:' + (14 + g.y * k) + 'px;width:' + g.w * k + 'px;height:' + g.h * k + 'px;border:1px dashed var(--border)"></span>'; });
    Array.prototype.forEach.call(wEl.querySelectorAll('.a-item'), function (el) {
      var key = el.getAttribute('data-key'), isS = key[0] === 's';
      var bg = isS ? 'var(--state-' + S[key.slice(2)].state + ')' : 'var(--postit-bg)';
      h += '<span class="m" style="left:' + parseFloat(el.style.left) * k + 'px;top:' + (14 + parseFloat(el.style.top) * k) + 'px;width:' + (isS ? 230 : 220) * k + 'px;height:' + (isS ? 86 : 110) * k + 'px;background:' + bg + '"></span>';
    });
    var vw = vEl.clientWidth || 900, vh = vEl.clientHeight || 600;
    h += '<span class="mv" style="left:' + (-view.x / view.z) * k + 'px;top:' + (14 + (-view.y / view.z) * k) + 'px;width:' + (vw / view.z) * k + 'px;height:' + (vh / view.z) * k + 'px"></span>';
    mini.innerHTML = h; mini._k = k;
  }
  document.getElementById('a-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ms]'); if (!b) return;
    cur = b.getAttribute('data-ms'); view = { x: 20, y: 10, z: 0.85 }; tabs(); layout();
  });
  document.querySelector('.a-zoom').addEventListener('click', function (e) {
    var b = e.target.closest('[data-zoom]'); if (!b) return;
    var d = +b.getAttribute('data-zoom'); view.z = d === 0 ? 1 : Math.max(0.35, Math.min(1.6, view.z + d * 0.15)); apply();
  });
  mini.addEventListener('pointerdown', function (e) {
    e.stopPropagation();
    var r = mini.getBoundingClientRect(), k = mini._k;
    var wx = (e.clientX - r.left) / k, wy = (e.clientY - r.top - 14) / k;
    view.x = -(wx * view.z) + vEl.clientWidth / 2; view.y = -(wy * view.z) + vEl.clientHeight / 2; apply();
  });
  vEl.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = vEl.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    var nz = Math.max(0.35, Math.min(1.6, view.z * (e.deltaY < 0 ? 1.1 : 0.9)));
    view.x = mx - (mx - view.x) * nz / view.z; view.y = my - (my - view.y) * nz / view.z; view.z = nz; apply();
  }, { passive: false });
  var st = null, zTop = 1000;
  vEl.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.a-zoom') || e.target.closest('.a-mini')) return;
    var it = e.target.closest('.a-item');
    st = { x: e.clientX, y: e.clientY, moved: false, it: it };
    if (it) { st.ox = parseFloat(it.style.left); st.oy = parseFloat(it.style.top); it.style.zIndex = ++zTop; }
    else { st.vx = view.x; st.vy = view.y; vEl.classList.add('panning'); }
    vEl.setPointerCapture(e.pointerId);
  });
  vEl.addEventListener('pointermove', function (e) {
    if (!st) return;
    var dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) st.moved = true;
    if (st.it) { if (st.moved) { st.it.classList.add('dragging'); st.it.style.left = (st.ox + dx / view.z) + 'px'; st.it.style.top = (st.oy + dy / view.z) + 'px'; } }
    else { view.x = st.vx + dx; view.y = st.vy + dy; apply(); }
  });
  vEl.addEventListener('pointerup', function () {
    if (!st) return;
    vEl.classList.remove('panning');
    if (st.it) {
      st.it.classList.remove('dragging');
      var key = st.it.getAttribute('data-key');
      if (st.moved) { pos[cur][key] = { x: parseFloat(st.it.style.left), y: parseFloat(st.it.style.top) }; drawMini(); }
      else openDetail(key);
    }
    st = null;
  });
  window.addEventListener('hashchange', drawMini);
  window.addEventListener('resize', drawMini);
  tabs(); layout();
})();

/* ============================ B — Trilhas da esteira ============================ */
(function variantB() {
  var filter = 'todos';
  document.getElementById('b-legend').innerHTML = legendHTML();
  function render() {
    document.getElementById('b-filter').innerHTML = ['todos'].concat(PROJECTS).map(function (p) {
      return '<button type="button" class="' + (p === filter ? 'on' : '') + '" data-pf="' + p + '">' + (p === 'todos' ? 'Todos os projetos' : p) + '</button>';
    }).join('');
    var h = '';
    Object.keys(ESTEIRAS).forEach(function (ek) {
      var E = ESTEIRAS[ek], cols = E.phases.length + 1;
      var projs = PROJECTS.filter(function (p) { return (filter === 'todos' || filter === p) && SESSIONS.some(function (s) { return s.project === p && s.esteira === ek; }); });
      if (!projs.length) return;
      var laneS = SESSIONS.filter(function (s) { return s.esteira === ek && projs.indexOf(s.project) >= 0; });
      var stop = laneS.filter(isStopped).length;
      h += '<div class="lane"><div class="lane-head"><h3>' + E.name + '</h3><span class="sub">' + laneS.length + ' sessões · ' + projs.length + ' projetos</span>' + (stop ? '<span class="count hot">' + stop + ' paradas</span>' : '') + '<span class="spacer"></span><button type="button" class="tb-btn ghost" data-toast="Mudaria a ordem/nome das fases desta esteira">Fases…</button></div>';
      h += '<div class="lane-grid" style="grid-template-columns:120px repeat(' + E.phases.length + ', minmax(180px, 1fr))">';
      h += '<div class="colh" style="background:var(--bg-panel)"><span class="legend">projeto</span></div>';
      E.phases.forEach(function (p) {
        var ns = laneS.filter(function (s) { return s.phase === p.id; });
        var stp = ns.filter(isStopped).length;
        h += '<div class="colh">' + chip(ek, p.id) + (ns.length ? '<span class="count' + (stp ? ' hot' : '') + '">' + ns.length + '</span>' : '') + '</div>';
      });
      projs.forEach(function (p) {
        var fl = Object.keys(FLOWS).filter(function (f) { return FLOWS[f].project === p && FLOWS[f].esteira === ek; }).map(function (f) { return FLOWS[f].name; });
        h += '<div class="rowh"><b>' + p + '</b><span>' + fl.join(' · ') + '</span></div>';
        var ps = SESSIONS.filter(function (s) { return s.project === p && s.esteira === ek; });
        var front = ps.filter(function (s) { return s.state !== 'done'; }).map(function (s) { return s.phase; });
        E.phases.forEach(function (ph) {
          var ss = ps.filter(function (s) { return s.phase === ph.id; });
          var nn = NOTES.filter(function (n) { return n.project === p && n.esteira === ek && n.phase === ph.id; });
          var inner = ss.map(function (s) { return sessCard(s, { noChip: true, short: true }); }).join('') + nn.map(function (n) { return noteCard(n, { short: true }); }).join('');
          h += '<div class="cell' + (inner ? '' : ' empty') + (front.indexOf(ph.id) >= 0 ? ' frontier' : '') + '">' + inner + '</div>';
        });
      });
      h += '</div></div>';
    });
    var loose = NOTES.filter(function (n) { return !n.session && (filter === 'todos' || n.project === filter || !n.project); });
    if (loose.length) {
      h += '<div class="lane"><div class="lane-head"><h3>Fora de esteira</h3><span class="sub">post-its seus sem sessão nem fase</span></div><div class="loose">' + loose.map(function (n) { return noteCard(n, { showProject: true }); }).join('') + '</div></div>';
    }
    document.getElementById('b-scroll').innerHTML = h;
  }
  document.getElementById('b-filter').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pf]'); if (!b) return; filter = b.getAttribute('data-pf'); render();
  });
  render();
})();

/* ============================ C — Mural por projeto + "Precisa de você" ============================ */
(function variantC() {
  var ms = 'all';
  var OPTS = [
    { id: 'all', label: 'Mural geral', grp: 'Mindscapes' },
    { id: 'dev', label: 'Esteira dev', grp: 'Por esteira' },
    { id: 'hom', label: 'Esteira de homologação', grp: 'Por esteira' }
  ];
  var dd = document.getElementById('c-dd'), menu = document.getElementById('c-menu');
  function inMs(s) { return ms === 'all' || s.esteira === ms; }
  function render() {
    var lastG = '';
    menu.innerHTML = OPTS.map(function (o) {
      var g = o.grp !== lastG ? '<div class="grp">' + o.grp + '</div>' : ''; lastG = o.grp;
      return g + '<button type="button" data-ms="' + o.id + '">' + (o.id === ms ? '✓ ' : '<span style="width:12px;display:inline-block"></span>') + o.label + '</button>';
    }).join('') + '<div class="grp">Novo</div><button type="button" data-toast="Criaria um mindscape novo">＋ Mindscape…</button>';
    document.getElementById('c-ddl').textContent = OPTS.filter(function (o) { return o.id === ms; })[0].label;
    var ss = SESSIONS.filter(inMs);
    var cnt = {}; ss.forEach(function (s) { cnt[s.state] = (cnt[s.state] || 0) + 1; });
    document.getElementById('c-summary').innerHTML = ['permission', 'error', 'waiting', 'working', 'done'].filter(function (k) { return cnt[k]; }).map(function (k) {
      return '<span class="st-' + k + '" style="display:inline-flex;gap:5px;align-items:center"><span class="dot"></span>' + cnt[k] + ' ' + STATE[k].label.toLowerCase() + '</span>';
    }).join('');
    var h = '';
    var zones = PROJECTS.filter(function (p) { return ss.some(function (s) { return s.project === p; }); });
    zones.forEach(function (p, i) {
      var ps = ss.filter(function (s) { return s.project === p; });
      var stopped = ps.filter(isStopped).sort(order), working = ps.filter(function (s) { return s.state === 'working'; }), done = ps.filter(function (s) { return s.state === 'done'; });
      var notes = NOTES.filter(function (n) { return n.project === p && (ms === 'all' || n.esteira === ms || (!n.esteira && ms === 'all')); });
      h += '<div class="zone dimmed-working' + (i === 0 ? ' wide' : '') + '" id="zone-' + p + '"><div class="zone-head"><h3>' + p + '</h3>' +
        (stopped.length ? '<span class="count hot">' + stopped.length + ' parada' + (stopped.length > 1 ? 's' : '') + '</span>' : '<span class="count">nada parado</span>') +
        '<span class="spacer"></span><span class="legend">' + ps.length + ' sessões · ' + notes.length + ' post-its</span></div>';
      if (stopped.length) h += '<div><div class="zone-sub">Parado, esperando você</div><div class="zone-row">' + stopped.map(function (s) { return sessCard(s); }).join('') + '</div></div>';
      if (working.length) h += '<div><div class="zone-sub">Trabalhando</div><div class="working-row">' + working.map(function (s) {
        var ln = notesOf(s.id).filter(function (n) { return n.by === s.id; })[0];
        return '<div class="wline st-working" data-open="s:' + s.id + '" data-sid="' + s.id + '"><span class="glyph">▶</span><span class="nm">' + s.name + '</span>' + chip(s.esteira, s.phase) + '<span>' + s.ago + '</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (ln ? '— ' + esc(ln.text) : '') + '</span></div>';
      }).join('') + '</div></div>';
      if (notes.length) h += '<div><div class="zone-sub">Post-its</div><div class="zone-row">' + notes.map(function (n) { return noteCard(n); }).join('') + '</div></div>';
      if (done.length) h += '<div><div class="zone-sub">Encerradas (' + done.length + ')</div><div class="shelf">' + done.map(function (s) {
        return '<button type="button" class="st-done" data-open="s:' + s.id + '" data-sid="' + s.id + '"><span class="dot"></span>' + s.name + ' · ' + s.ago + '</button>';
      }).join('') + '</div></div>';
      h += '</div>';
    });
    var gen = NOTES.filter(function (n) { return !n.project; });
    if (ms === 'all' && gen.length) h += '<div class="zone" id="zone-geral"><div class="zone-head"><h3>geral</h3><span class="legend">post-its sem projeto</span></div><div class="zone-row">' + gen.map(function (n) { return noteCard(n); }).join('') + '</div></div>';
    document.getElementById('c-zones').innerHTML = h;
    var rail = ss.filter(isStopped).sort(order);
    document.getElementById('c-n').textContent = rail.length;
    var r = '', g = '';
    rail.forEach(function (s) {
      if (s.state !== g) { g = s.state; r += '<div class="r-grp st-' + g + '"><span class="dot"></span>' + STATE[g].label + '</div>'; }
      var ln = notesOf(s.id).filter(function (n) { return n.by === s.id; })[0];
      r += '<button type="button" class="r-item st-' + s.state + '" data-goto="' + s.id + '"><span class="l1"><span class="glyph">' + STATE[s.state].icon + '</span><span class="nm">' + s.name + '</span></span>' +
        '<span class="l2">' + chip(s.esteira, s.phase) + '<span style="color:var(--st);font-weight:600">' + s.ago + '</span></span>' + (ln ? '<span class="l3">“' + esc(ln.text) + '”</span>' : '') + '</button>';
    });
    var dn = ss.filter(function (s) { return s.state === 'done'; });
    r += '<div class="r-grp st-done"><span class="dot"></span>Encerradas (' + dn.length + ')</div>' + dn.map(function (s) {
      return '<button type="button" class="r-item st-done" data-goto="' + s.id + '"><span class="l1"><span class="glyph">■</span><span class="nm">' + s.name + '</span></span><span class="l2"><span style="color:var(--text-muted)">' + s.ago + '</span></span></button>';
    }).join('');
    r += '<div style="margin-top:14px" class="legend">' + legendHTML() + '</div>';
    document.getElementById('c-rail').innerHTML = r;
  }
  function order(a, b) {
    var pr = { permission: 0, error: 1, waiting: 2 };
    return pr[a.state] - pr[b.state] || b.mins - a.mins;
  }
  dd.addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('open'); });
  menu.addEventListener('click', function (e) { var b = e.target.closest('[data-ms]'); if (!b) return; ms = b.getAttribute('data-ms'); menu.classList.remove('open'); render(); });
  document.addEventListener('click', function (e) { if (!e.target.closest('#c-menu') && !e.target.closest('#c-dd')) menu.classList.remove('open'); });
  document.getElementById('c-rail').addEventListener('click', function (e) {
    var b = e.target.closest('[data-goto]'); if (!b) return;
    var el = document.querySelector('#c-zones [data-sid="' + b.getAttribute('data-goto') + '"]'); if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  });
  render();
})();

/* ============================ D — Mapa de nós ============================ */
(function variantD() {
  /* Layout manual por fluxo (coordenadas relativas ao bloco). */
  var BLOCKS = [
    { id: 'atlas-rel', h: 330, nodes: { s1: [0, 120], s2: [224, 120], s3: [448, 0], s4: [448, 120], s5: [448, 240], n2: [20, 200], n3: [244, 200], n4: [660, -4], u1: [812, -4], n1: [660, 116], n5: [660, 236], u6: [812, 236] } },
    { id: 'beacon-login', h: 90, nodes: { s6: [0, 0], n8: [224, -4], u3: [376, -4] } },
    { id: 'beacon-hotfix', h: 170, nodes: { s7: [0, 0], s8: [224, 0], n6: [20, 82], n7: [448, -4], u7: [600, -4] } },
    { id: 'beacon-hom', h: 70, nodes: { s9: [0, 0] } },
    { id: 'vega-painel', h: 170, nodes: { s13: [0, 0], s12: [224, 0], n11: [20, 82] } },
    { id: 'vega-hom', h: 170, nodes: { s10: [0, 0], s11: [224, 0], n9: [20, 82], n10: [448, -4], u5: [600, -4] } },
    { id: 'soltos', h: 90, nodes: { u4: [0, 0], u8: [160, 0], u2: [320, 0] } }
  ];
  var LIST = [
    { id: 'all', label: 'Tudo', grp: 'Mindscapes' },
    { id: 'p:atlas', label: 'atlas', grp: 'Por projeto' }, { id: 'p:beacon', label: 'beacon', grp: 'Por projeto' }, { id: 'p:vega', label: 'vega', grp: 'Por projeto' },
    { id: 'e:dev', label: 'Esteira dev', grp: 'Por esteira' }, { id: 'e:hom', label: 'Esteira de homologação', grp: 'Por esteira' }
  ];
  var cur = 'all', sel = null, onlyStopped = false;
  var NB = {}; NOTES.forEach(function (n) { NB[n.id] = n; });
  function blockVisible(b) {
    if (cur === 'all') return true;
    if (b.id === 'soltos') return cur === 'p:atlas';
    var f = FLOWS[b.id];
    return cur[0] === 'p' ? f.project === cur.slice(2) : f.esteira === cur.slice(2);
  }
  function list() {
    var g = '', h = '';
    LIST.forEach(function (l) {
      if (l.grp !== g) { g = l.grp; h += '<p class="section-title" style="margin-top:10px">' + g + '</p>'; }
      var ss = SESSIONS.filter(function (s) { return l.id === 'all' || (l.id[0] === 'p' ? s.project === l.id.slice(2) : s.esteira === l.id.slice(2)); });
      var n = ss.filter(isStopped).length;
      h += '<button type="button" class="' + (l.id === cur ? 'on' : '') + '" data-l="' + l.id + '"><span' + (l.grp === 'Por projeto' ? ' class="mono"' : '') + '>' + l.label + '</span><span class="count' + (n ? ' hot' : '') + '">' + (n || ss.length) + '</span></button>';
    });
    h += '<button type="button" data-toast="Criaria um mindscape novo" style="color:var(--text-muted)">＋ Mindscape</button>';
    h += '<div class="legend" style="margin-top:16px">' + legendHTML() + '</div>';
    document.getElementById('d-list').innerHTML = h;
  }
  function render() {
    var y = 30, X0 = 28, nodes = {}, html = '', w = 0;
    BLOCKS.filter(blockVisible).forEach(function (b) {
      var lab = b.id === 'soltos' ? 'Soltos <span class="sub">post-its sem sessão</span>' : '<span class="mono">' + FLOWS[b.id].project + '</span> · ' + FLOWS[b.id].name + ' <span class="sub">' + ESTEIRAS[FLOWS[b.id].esteira].name + '</span>';
      html += '<div class="d-block-label" style="left:' + X0 + 'px;top:' + y + 'px">' + lab + '</div>';
      var by = y + 34;
      Object.keys(b.nodes).forEach(function (k) {
        var p = b.nodes[k], nx = X0 + p[0], ny = by + p[1] + 6;
        var isS = k[0] === 's';
        nodes[k] = { x: nx, y: ny, w: isS ? 184 : 140, h: isS ? 58 : 70 };
        w = Math.max(w, nx + 220);
        if (isS) {
          var s = S[k];
          html += '<div class="d-node" data-k="' + k + '" style="left:' + nx + 'px;top:' + ny + 'px"><div class="d-sess st-' + s.state + '" style="--stripe:var(--tabc-' + s.color + ')"><div class="l1"><span class="glyph">' + STATE[s.state].icon + '</span><span class="nm">' + s.name + '</span></div><div class="l2"><span class="dot"></span><span style="color:var(--st);font-weight:600">' + STATE[s.state].label + '</span><span style="color:var(--text-muted);margin-left:auto">' + s.ago.replace('há ', '') + '</span></div></div></div>';
        } else {
          var n = NB[k];
          html += '<div class="d-node" data-k="' + k + '" style="left:' + nx + 'px;top:' + ny + 'px"><div class="d-note ' + (n.by === 'user' ? 'by-user' : 'by-session') + '" style="--stripe:var(--tabc-' + n.color + ')"><div class="who">' + (n.by === 'user' ? '✎ você' : '▸ ' + S[n.by].name.split('/')[1]) + '</div><div class="t">' + esc(n.text) + '</div></div></div>';
        }
      });
      y = by + b.h + 50;
    });
    var edges = [];
    SESSIONS.forEach(function (s) { (s.after || []).forEach(function (a) { if (nodes[a] && nodes[s.id]) edges.push({ a: a, b: s.id, cls: 'edge' }); }); });
    NOTES.forEach(function (n) { if (n.session && nodes[n.session] && nodes[n.id]) edges.push({ a: n.session, b: n.id, cls: n.by === 'user' ? 'edge user-edge' : 'edge note-edge' }); });
    var svg = '<svg width="' + (w + 100) + '" height="' + y + '"><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--text-muted)"/></marker></defs>';
    edges.forEach(function (e) {
      var A = nodes[e.a], B = nodes[e.b], d;
      if (B.x >= A.x + A.w - 10) {
        var x1 = A.x + A.w, y1 = A.y + A.h / 2, x2 = B.x, y2 = B.y + B.h / 2, mx = (x1 + x2) / 2;
        d = 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
      } else {
        var vx1 = A.x + 40, vy1 = A.y + A.h, vx2 = B.x + 40, vy2 = B.y;
        d = 'M' + vx1 + ',' + vy1 + ' L' + vx2 + ',' + vy2;
      }
      svg += '<path class="' + e.cls + '" data-a="' + e.a + '" data-b="' + e.b + '" d="' + d + '"' + (e.cls === 'edge' ? ' marker-end="url(#arr)"' : '') + '/>';
    });
    svg += '</svg>';
    var world = document.getElementById('d-world');
    world.style.width = (w + 100) + 'px'; world.style.height = y + 'px';
    world.innerHTML = svg + html;
    world._edges = edges;
    paint();
  }
  function component(k) {
    var set = {}; set[k] = 1;
    var edges = document.getElementById('d-world')._edges, grew = true;
    while (grew) { grew = false; edges.forEach(function (e) { if (set[e.a] && !set[e.b]) { set[e.b] = 1; grew = true; } if (set[e.b] && !set[e.a] && e.cls === 'edge') { set[e.a] = 1; grew = true; } }); }
    return set;
  }
  function stoppedKey(k) { if (k[0] === 's') return isStopped(S[k]); var n = NB[k]; return n.session ? isStopped(S[n.session]) : false; }
  function paint() {
    var keep = sel ? component(sel) : null;
    Array.prototype.forEach.call(document.querySelectorAll('#d-world .d-node'), function (el) {
      var k = el.getAttribute('data-k');
      var fade = (keep && !keep[k]) || (onlyStopped && !stoppedKey(k));
      el.classList.toggle('fade', !!fade); el.classList.toggle('sel', k === sel);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#d-world path'), function (p) {
      var a = p.getAttribute('data-a'), b = p.getAttribute('data-b');
      var fade = (keep && !(keep[a] && keep[b])) || (onlyStopped && !(stoppedKey(a) && stoppedKey(b)));
      p.classList.toggle('fade', !!fade);
    });
    var panel = document.getElementById('d-panel');
    if (!sel) {
      var st = SESSIONS.filter(isStopped);
      panel.innerHTML = '<p class="section-title">Nada selecionado</p><p class="legend">Clique num nó para ver a cadeia dele (sessão → post-its → próxima etapa). Clique no fundo para limpar.</p><p class="section-title">Parados agora (' + st.length + ')</p>' +
        st.map(function (s) { return '<div class="srow st-' + s.state + '" style="cursor:pointer" data-pick="' + s.id + '"><span class="glyph">' + STATE[s.state].icon + '</span><span class="nm mono" style="font-size:12px">' + s.name + '</span><span class="ago">' + s.ago.replace('há ', '') + '</span></div>'; }).join('');
      return;
    }
    panel.innerHTML = detailHTML((sel[0] === 's' ? 's:' : 'n:') + sel).html;
  }
  document.getElementById('d-list').addEventListener('click', function (e) { var b = e.target.closest('[data-l]'); if (!b) return; cur = b.getAttribute('data-l'); sel = null; list(); render(); });
  document.getElementById('d-world').addEventListener('click', function (e) {
    var n = e.target.closest('.d-node'); sel = n ? n.getAttribute('data-k') : null; paint();
  });
  document.getElementById('d-panel').addEventListener('click', function (e) {
    var p = e.target.closest('[data-pick]'); if (!p) return; sel = p.getAttribute('data-pick'); paint();
    var el = document.querySelector('#d-world [data-k="' + sel + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  });
  document.getElementById('d-stopped').addEventListener('click', function (e) { onlyStopped = !onlyStopped; e.currentTarget.textContent = onlyStopped ? 'Mostrar tudo' : 'Destacar o que está parado'; paint(); });
  list(); render();
})();
