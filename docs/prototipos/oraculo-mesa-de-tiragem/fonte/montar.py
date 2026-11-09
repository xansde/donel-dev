#!/usr/bin/env python3
"""Junta base + TODAS as variantes existentes num index.html autocontido (um arquivo, sem rede).
Cada variante vai num <script> próprio: erro numa não derruba as outras. Os argumentos são ignorados
(várias sessões montam ao mesmo tempo; todas geram o mesmo arquivo). Escrita atômica."""
import os, pathlib, tempfile
aqui = pathlib.Path(__file__).resolve().parent
saida = aqui.parent / 'index.html'
letras = sorted(p.stem.split('-')[1] for p in aqui.glob('variante-*.js'))
css = '\n'.join((aqui / f'variante-{l}.css').read_text() for l in letras if (aqui / f'variante-{l}.css').exists())
js = '\n'.join('<script>\n/* variante %s */\n%s\n</script>' % (l, (aqui / f'variante-{l}.js').read_text()) for l in letras)
h = (aqui / 'casca.html').read_text()
h = h.replace('/*BASE_CSS*/', (aqui / 'base.css').read_text()).replace('/*VARIANTES_CSS*/', css)
h = h.replace('/*BASE_JS*/', (aqui / 'base.js').read_text()).replace('/*VARIANTES_JS*/', js)
fd, tmp = tempfile.mkstemp(dir=saida.parent, suffix='.tmp')
with os.fdopen(fd, 'w') as f:
    f.write(h)
os.replace(tmp, saida)
print(saida, len(h.encode()), 'bytes', letras)
