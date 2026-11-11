import { useCardDraftGuard } from '@/components/Session/Agents/useCardDraftGuard';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  createMemoryEntry,
  updateMemoryEntry,
  type MemoryEntry,
} from '@/service/memoryApi';
import type { ContextDocument } from '@/service/workspaceGraphApi';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkspaceAgent, WorkspaceData } from './useWorkspaceGraph';

function useResourceDraft(value: unknown) {
  const [busy, setBusy] = useState(false);
  return { ...useCardDraftGuard(value, { busy }), busy, setBusy };
}

function SaveForm({
  children,
  state,
  save,
  onSaved,
}: {
  children: React.ReactNode;
  state: ReturnType<typeof useResourceDraft>;
  save: () => Promise<unknown>;
  onSaved: () => void;
}) {
  const { t } = useTranslation(),
    [error, setError] = useState(false);
  const { busy, setBusy, markSaved } = state;
  return (
    <form
      className="flex min-w-0 flex-col gap-ds-16"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(false);
        try {
          await save();
          markSaved();
          onSaved();
        } catch {
          setError(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset
        disabled={busy}
        className="flex min-w-0 flex-col gap-ds-16 border-0 border-x-0 border-y-0 p-0"
      >
        {children}
      </fieldset>
      {error && (
        <DsText
          role="base"
          as="p"
          aria-live="assertive"
          className="text-ds-text-error-strong-default"
        >
          {t('chat.workspace-save-error')}
        </DsText>
      )}
      <Button size="sm" className="self-end" type="submit" disabled={busy}>
        {t('layout.save')}
      </Button>
    </form>
  );
}
export function ContextEditor({
  data,
  document,
  onSaved,
}: {
  data: WorkspaceData;
  document?: ContextDocument;
  onSaved: () => void;
}) {
  const { t } = useTranslation(),
    [name, setName] = useState(document?.name ?? ''),
    [content, setContent] = useState(document?.content ?? '');
  const form = useResourceDraft({ name, content });
  return (
    <SaveForm
      state={form}
      onSaved={onSaved}
      save={() =>
        document
          ? data.api.updateContext(document.id, {
              name,
              content,
              enabled: document.enabled,
              expected_revision: document.revision,
            })
          : data.api.createContext({ name, content })
      }
    >
      <Input
        aria-label={t('chat.workspace-name')}
        placeholder={t('chat.workspace-name')}
        required
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Textarea
        variant="outlined"
        aria-label={t('chat.workspace-context')}
        rows={10}
        required
        maxLength={32000}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
    </SaveForm>
  );
}
export function MemoryEditor({
  account,
  spaceId,
  entry,
  onSaved,
}: {
  spaceId: string;
  account: string;
  entry?: MemoryEntry;
  onSaved: () => void;
}) {
  const { t } = useTranslation(),
    [content, setContent] = useState(entry?.content ?? '');
  const form = useResourceDraft({ content });
  return (
    <SaveForm
      state={form}
      onSaved={onSaved}
      save={() =>
        entry
          ? updateMemoryEntry(
              entry,
              {
                content,
                kind: entry.kind,
                reason: 'Edited in workspace canvas',
              },
              account
            )
          : createMemoryEntry(
              'space',
              spaceId,
              {
                content,
                kind: 'fact',
                reason: 'Created in workspace canvas',
              },
              account
            )
      }
    >
      <DsText role="base" className="text-ds-ink-muted-default">
        {t('chat.workspace-memory-help')}
      </DsText>
      <Textarea
        variant="outlined"
        aria-label={t('chat.workspace-memory')}
        rows={8}
        required
        maxLength={8192}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
    </SaveForm>
  );
}
export function ReferenceEditor({
  data,
  agent,
  onSaved,
}: {
  data: WorkspaceData;
  agent: WorkspaceAgent;
  onSaved: () => void;
}) {
  const { t } = useTranslation(),
    ref = data.graph?.agent_references.find((r) => r.agent_id === agent.id);
  const [contexts, setContexts] = useState(ref?.context_ids ?? []),
    [memories, setMemories] = useState(ref?.memory_ids ?? []);
  const [revision, setRevision] = useState(ref?.revision ?? 0);
  const form = useResourceDraft({ contexts, memories });
  const { dirty, busy, markSaved } = form;
  useEffect(() => {
    if (dirty || busy || !ref || ref.revision <= revision) return;
    const snapshot = { contexts: ref.context_ids, memories: ref.memory_ids };
    setContexts(snapshot.contexts);
    setMemories(snapshot.memories);
    setRevision(ref.revision);
    markSaved(snapshot);
  }, [ref, revision, dirty, busy, markSaved]);
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((v) => v !== id) : [...list, id];
  return (
    <SaveForm
      state={form}
      onSaved={onSaved}
      save={async () => {
        const updated = await data.api.setAgentReferences(
          agent.projectId,
          agent.id,
          {
            context_ids: contexts,
            memory_ids: memories,
            expected_revision: revision,
          }
        );
        setRevision(updated.revision);
      }}
    >
      <DsText role="base" className="text-ds-ink-muted-default">
        {t('chat.workspace-reference-help')}
      </DsText>
      {(['context', 'memory'] as const).map((kind) => (
        <fieldset
          key={kind}
          className="min-w-0 border-0 border-x-0 border-y-0 p-0"
        >
          <legend className="pb-ds-8 text-ds-text-base font-semibold">
            {t('chat.workspace-' + kind)}
          </legend>
          {[
            ...(kind === 'context'
              ? (data.graph?.contexts ?? [])
                  .filter((c) => c.enabled)
                  .map((c) => ({ id: c.id, text: c.name }))
              : data.memories.map((m) => ({
                  id: m.memory_id,
                  text: m.content,
                }))),
            ...(kind === 'context' ? contexts : memories)
              .filter((id) =>
                kind === 'context'
                  ? !data.graph?.contexts.some((c) => c.id === id && c.enabled)
                  : !data.memories.some((m) => m.memory_id === id)
              )
              .map((id) => ({
                id,
                text: t('chat.workspace-unavailable-reference') + ' · ' + id,
              })),
          ].map((r) => (
            <label
              key={r.id}
              className="flex items-start gap-ds-control-gap py-ds-6"
            >
              <Checkbox
                checked={(kind === 'context' ? contexts : memories).includes(
                  r.id
                )}
                onCheckedChange={() =>
                  kind === 'context'
                    ? setContexts(toggle(contexts, r.id))
                    : setMemories(toggle(memories, r.id))
                }
              />
              <DsText role="base" className="min-w-0 break-words">
                {r.text}
              </DsText>
            </label>
          ))}
        </fieldset>
      ))}
    </SaveForm>
  );
}
