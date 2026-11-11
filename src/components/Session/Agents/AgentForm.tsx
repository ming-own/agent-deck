import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { ConfiguredModelChoice } from '@/lib/configuredModels';
import type {
  AgentBehavior,
  AgentToolPolicy,
  SessionAgent,
  sessionAgentApi,
} from '@/service/sessionAgentApi';
import { useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NodeInspector } from './NodeInspector';
import { SkillPicker } from './SkillPicker';
import { ToolPermissions } from './ToolPermissions';
import { CardDraftScope, useCardDraftGuard } from './useCardDraftGuard';
const harnessLabels: Record<string, string> = {
  standard: 'chat.node-harness-standard',
  plan_execute: 'chat.node-harness-plan-execute',
};
export type AgentInspectorView =
  'general' | 'capabilities' | 'conversation' | 'references';

type AgentFormProps = {
  docked?: boolean;
  inline?: boolean;
  actions?: ReactNode;
  references?: ReactNode;
  view?: AgentInspectorView;
  onViewChange?: (view: AgentInspectorView) => void;
  conversation?: ReactNode;
  restoreFocus: () => void;
  node?: SessionAgent;
  loadSkills: ReturnType<typeof sessionAgentApi>['skills'];
  choices: ConfiguredModelChoice[];
  onSave: (
    name: string,
    choice: ConfiguredModelChoice,
    behavior: AgentBehavior
  ) => Promise<void>;
  onCancel: () => void;
};
export function AgentForm(props: AgentFormProps) {
  return (
    <CardDraftScope>
      <AgentFormContent {...props} />
    </CardDraftScope>
  );
}

function AgentFormContent({
  docked,
  conversation,
  references,
  actions,
  inline,
  view: selectedView,
  onViewChange,
  restoreFocus,
  loadSkills,
  node,
  choices,
  onSave,
  onCancel,
}: AgentFormProps) {
  const { t } = useTranslation();
  const [localView, setLocalView] = useState<AgentInspectorView>('general');
  const view = selectedView ?? localView;
  const setView = (next: string) => {
    const value = next as AgentInspectorView;
    setLocalView(value);
    onViewChange?.(value);
  };
  const [harnessId, setHarnessId] = useState(node?.harness_id ?? 'standard');
  const [name, setName] = useState(node?.name ?? '');
  const [model, setModel] = useState(node?.model.id ?? '');
  const [role, setRole] = useState(node?.role ?? '');
  const [instructions, setInstructions] = useState(node?.instructions ?? '');
  const [toolPolicy, setToolPolicy] = useState<AgentToolPolicy>(
    node?.tool_policy ?? {}
  );
  const [skillIds, setSkillIds] = useState(node?.skill_ids ?? []);
  const helpId = useId();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const savingRef = useRef(false);
  const choice = choices.find((item) => item.id === model);
  const draft = {
    name,
    model,
    harnessId,
    role,
    instructions,
    toolPolicy,
    skillIds,
  };
  const guard = useCardDraftGuard(draft, { busy: saving });
  const close = () => {
    if (guard.confirm()) onCancel();
  };
  return (
    <NodeInspector
      docked={docked}
      inline={inline}
      actions={actions}
      title={
        docked && node
          ? node.name
          : t(node ? 'chat.session-agents-edit' : 'chat.session-agents-add')
      }
      subtitle={docked && node ? node.model.name : undefined}
      busy={saving}
      close={close}
      restoreFocus={restoreFocus}
    >
      <Tabs
        value={view}
        onValueChange={setView}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 px-ds-panel-inset">
          <TabsList
            appearance={docked ? 'border' : 'outline'}
            aria-label={t(
              node ? 'chat.session-agents-edit' : 'chat.session-agents-add'
            )}
          >
            <TabsTrigger value="general">{t('layout.general')}</TabsTrigger>
            <TabsTrigger value="capabilities">
              {t('layout.capabilities')}
            </TabsTrigger>
            {conversation && (
              <TabsTrigger value="conversation">
                {t('chat.workspace-conversation')}
              </TabsTrigger>
            )}
            {references && (
              <TabsTrigger value="references">
                {t('chat.workspace-references')}
              </TabsTrigger>
            )}
          </TabsList>
        </div>
        {conversation && (
          <TabsContent
            forceMount
            value="conversation"
            hidden={view !== 'conversation'}
            contentClassName="min-h-0 flex-1 overflow-y-auto p-ds-panel-inset scrollbar-always-visible"
            className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          >
            {guard.dirty && (
              <DsText
                role="meta"
                className="text-ds-ink-muted-default"
                aria-live="polite"
              >
                {t('chat.node-task-saved-config')}
              </DsText>
            )}
            {conversation}
          </TabsContent>
        )}
        {references && (
          <TabsContent
            forceMount
            value="references"
            hidden={view !== 'references'}
            className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
            contentClassName="min-h-0 flex-1 gap-0"
          >
            {references}
          </TabsContent>
        )}
        {(view === 'general' || view === 'capabilities') && (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!choice || !name.trim() || savingRef.current) return;
              savingRef.current = true;
              setSaving(true);
              setFailed(false);
              try {
                await onSave(name.trim(), choice, {
                  harness_id: harnessId,
                  tool_policy: toolPolicy,
                  skill_ids: skillIds,
                  role: role.trim(),
                  instructions: instructions.trim(),
                });
                guard.markSaved(draft);
              } catch {
                setFailed(true);
              } finally {
                savingRef.current = false;
                setSaving(false);
              }
            }}
          >
            <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto p-ds-panel-inset">
              <TabsContent value="general" className="m-0">
                <Input
                  title={t('chat.session-agents-name')}
                  aria-label={t('chat.session-agents-name')}
                  value={name}
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                  disabled={saving}
                />
                <div
                  className={
                    docked
                      ? 'grid grid-cols-1 gap-ds-control-gap'
                      : 'grid grid-cols-1 gap-ds-control-gap sm:grid-cols-2'
                  }
                >
                  <Select
                    value={model}
                    onValueChange={setModel}
                    disabled={saving || !choices.length}
                  >
                    <SelectTrigger
                      title={t('chat.session-agents-model')}
                      aria-label={t('chat.session-agents-model')}
                      wrapperClassName="w-full"
                    >
                      <SelectValue
                        placeholder={t('chat.session-agents-select-model')}
                      />
                    </SelectTrigger>
                    <SelectContent fitTrigger>
                      {node &&
                        !choices.some((item) => item.id === node.model.id) && (
                          <SelectItem value={node.model.id} disabled>
                            {node.model.name} · {t('layout.unavailable')}
                          </SelectItem>
                        )}
                      {choices.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name} · {item.group}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={harnessId}
                    onValueChange={setHarnessId}
                    disabled={saving}
                  >
                    <SelectTrigger
                      title={t('chat.node-harness')}
                      aria-label={t('chat.node-harness')}
                      wrapperClassName="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent fitTrigger>
                      {Object.entries(harnessLabels).map(([id, label]) => (
                        <SelectItem key={id} value={id}>
                          {t(label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {!choices.length && (
                  <DsText role="base">
                    {t('chat.session-agents-no-models')}
                  </DsText>
                )}
                <Input
                  title={t('chat.session-agents-role-label')}
                  aria-label={t('chat.session-agents-role-label')}
                  placeholder={t('chat.session-agents-role-placeholder')}
                  value={role}
                  maxLength={200}
                  onChange={(event) => setRole(event.target.value)}
                  disabled={saving}
                />
                <Textarea
                  variant="outlined"
                  title={t('chat.session-agents-instructions-label')}
                  aria-label={t('chat.session-agents-instructions-label')}
                  aria-describedby={helpId}
                  placeholder={t(
                    'chat.session-agents-instructions-placeholder'
                  )}
                  value={instructions}
                  rows={3}
                  maxLength={12000}
                  onChange={(event) => setInstructions(event.target.value)}
                  disabled={saving}
                />
                <DsText
                  as="p"
                  id={helpId}
                  role="meta"
                  className="text-ds-ink-muted-default"
                >
                  {t('chat.session-agents-instructions-help')}
                </DsText>
              </TabsContent>
              <TabsContent value="capabilities" className="m-0">
                <SkillPicker
                  load={loadSkills}
                  selected={skillIds}
                  onChange={setSkillIds}
                  disabled={saving}
                />
                <ToolPermissions
                  policy={toolPolicy}
                  onChange={setToolPolicy}
                  disabled={saving}
                />
              </TabsContent>
            </div>
            {failed && (
              <DsText role="base" aria-live="assertive">
                {t('chat.session-agents-save-error')}
              </DsText>
            )}
            <div className="flex shrink-0 items-center justify-end gap-ds-control-gap border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default px-ds-panel-inset py-ds-12">
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={close}
              >
                {t('chat.session-agents-cancel')}
              </Button>
              <Button
                type="submit"
                disabled={!name.trim() || !choice || saving}
              >
                {t('chat.session-agents-save')}
              </Button>
            </div>
          </form>
        )}
      </Tabs>
    </NodeInspector>
  );
}
