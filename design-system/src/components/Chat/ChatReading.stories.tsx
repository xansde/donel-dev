import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { ActionGroup } from '../ActionGroup';
import { ActionLine } from '../ActionLine';
import { AnnotationTag } from '../AnnotationTag';
import { Banner } from '../Banner';
import { Button } from '../Button';
import { CodeBlock } from '../CodeBlock';
import { CommandOutput } from '../CommandOutput';
import { DiffBlock } from '../DiffBlock';
import type { DiffLine } from '../DiffBlock';
import { Kbd } from '../Kbd';
import { MessageHeader } from '../MessageHeader';
import { NoticeLine } from '../NoticeLine';
import { OwnerMessage } from '../OwnerMessage';
import { StateDot } from '../StateDot';
import { SubagentRow } from '../SubagentRow';
import { WorkFold } from '../WorkFold';

// 014-chat, T050 — catálogo das peças de leitura do chat (design/chat-verificacao.md §4).
const meta: Meta = {
  title: 'Chat/Peças de leitura',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj;

const column = { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 } as const;

const diffLines: DiffLine[] = [
  { kind: 'del', number: 19, text: 'const installment = Number((total / count).toFixed(2));' },
  { kind: 'add', number: 19, text: 'const base = rate === 0' },
  { kind: 'add', number: 20, text: '  ? Math.floor((total / count) * 100) / 100' },
  { kind: 'ctx', number: 21, text: '  : pmt(total, count, rate);' },
];

export const MensagemDoDono: Story = {
  render: () => (
    <div style={column}>
      <OwnerMessage time="14:02">Corrige e roda os testes.</OwnerMessage>
      <OwnerMessage time="14:09" sendState="sent">Troca o cálculo para usar decimal.js.</OwnerMessage>
      <OwnerMessage sendState="sending">Mais uma coisa…</OwnerMessage>
      <OwnerMessage time="14:10" sendState="queued" queuedReason="entra na próxima pausa do Claude">
        Depois olha o relatório.
      </OwnerMessage>
      <OwnerMessage
        sendState="failed"
        failedReason="o Claude não ficou pronto"
        onRetry={() => undefined}
      >
        Tenta de novo, por favor.
      </OwnerMessage>
      <OwnerMessage mono time="14:11">
        /model sonnet
      </OwnerMessage>
      <OwnerMessage variant="task">Mapear os usos de Math.round no simulador e no relatório.</OwnerMessage>
    </div>
  ),
};

export const RespostaDoClaude: Story = {
  render: () => {
    const [copied, setCopied] = useState(false);
    return (
      <div style={column}>
        <MessageHeader time="14:05" copied={copied} onCopy={() => setCopied(true)} />
        <CodeBlock language="typescript" path="src/simulador/parcelas.ts" onCopy={() => undefined}>
          {`export function splitInstallments(total: number) {\n  return total;\n}`}
        </CodeBlock>
      </div>
    );
  },
};

export const LinhasEGrupos: Story = {
  render: () => {
    const [group, setGroup] = useState(false);
    const [diff, setDiff] = useState(true);
    const failed = <ActionLine category="command" verb="Rodou" object="npm test" status="failed" statusText="— falhou" />;
    return (
      <div style={column}>
        <ActionLine category="thinking" verb="Pensou" duration="6 s" />
        <ActionLine category="command" verb="Rodando" object="npm test" status="running" />
        <ActionGroup
          summary="6 ações — rodou 3, editou 2, leu 1"
          duration="2 min 41 s"
          expanded={group}
          onToggle={() => setGroup(!group)}
          failures={[failed]}
        >
          <ActionLine category="read" verb="Leu" object="src/simulador/parcelas.ts" duration="0,3 s" />
          <ActionLine
            category="edit"
            verb="Editou"
            object="src/simulador/parcelas.ts"
            added={12}
            removed={3}
            expanded={diff}
            onToggle={() => setDiff(!diff)}
          >
            <DiffBlock path="src/simulador/parcelas.ts" hunk="@@ −18,9 +18,18 @@" lines={diffLines} />
          </ActionLine>
          {failed}
        </ActionGroup>
        <AnnotationTag tone="muted">usou a skill tdd</AnnotationTag>
      </div>
    );
  },
};

export const DobraDoModoFoco: Story = {
  render: () => (
    <div style={column}>
      <WorkFold state="done" label="trabalhou — 9 ações, 2 notas" elapsed="2 min 41 s" onToggle={() => undefined} badge={<AnnotationTag tone="warn">tem pergunta aqui</AnnotationTag>} />
      <WorkFold state="working" label="trabalhando — 5 ações, 1 nota" elapsed="0 min 42 s" onToggle={() => undefined} />
      <WorkFold state="waiting" label="esperando você — 3 ações" elapsed="1 min 02 s" onToggle={() => undefined} />
    </div>
  ),
};

export const SaidaDeComando: Story = {
  render: () => (
    <div style={column}>
      <CommandOutput
        title="$ npm test"
        exitCode={1}
        onCopy={() => undefined}
        onViewAll={() => undefined}
        maxLines={3}
        lines={[
          { text: 'FAIL  src/simulador/parcelas.test.ts', tone: 'error' },
          'AssertionError: expected 1000.01 to be 1000',
          { text: '  - Expected  1000   + Received  1000.01', tone: 'muted' },
          'mais uma linha',
          'e outra',
        ]}
      />
    </div>
  ),
};

export const Faixas: Story = {
  render: () => (
    <div style={column}>
      <Banner tone="permission" role="alert" title="O terminal precisa de você" actions={<Button variant="secondary">Abrir terminal</Button>}>
        O Claude abriu uma tela que só funciona lá. Responda no terminal e a conversa continua aqui.
      </Banner>
      <Banner tone="waiting" role="alert" title="Não estou recebendo a conversa" actions={<Button variant="secondary">Abrir terminal</Button>}>
        O chat não vê nada novo desde 14:09.
      </Banner>
      <Banner variant="compact" tone="accent" title="Conversa nova — a anterior está em Sessões anteriores" actions={<Button variant="link">abrir</Button>} />
      <Banner
        variant="live"
        tone="muted"
        icon={<StateDot state="working" />}
        title="trabalhando — Rodando npm test"
        actions={<><Kbd>Esc</Kbd><Button variant="secondary">Parar</Button></>}
      />
      <NoticeLine>Conversa compactada — 180 mil → 12 mil tokens</NoticeLine>
      <NoticeLine tone="warn" action={<Button variant="link">abrir</Button>}>Limite da conta atingido</NoticeLine>
    </div>
  ),
};

export const Subagentes: Story = {
  render: () => (
    <div style={column}>
      <SubagentRow name="Mapear usos de Math.round" type="Explore" model="sonnet" state="running" detail="Buscou 'Math.round'" onOpen={() => undefined} selected />
      <SubagentRow name="Revisar testes" type="general-purpose" model="opus" state="completed" detail="resultado: 42 passaram" onOpen={() => undefined} />
      <SubagentRow name="Atualizar relatório" model="sonnet" state="failed" stateText="Falhou em 12 s" />
      <SubagentRow name="Subagente antigo" state="unknown" />
    </div>
  ),
};
