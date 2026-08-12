// cytoscape-dagre não publica tipos e @types/cytoscape-dagre não existe no
// npm — declaração mínima só para o import funcionar sob strict mode.
declare module 'cytoscape-dagre' {
  import type { Ext } from 'cytoscape';
  const register: Ext;
  export default register;
}
