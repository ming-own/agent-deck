import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AgentTask, sessionAgentApi } from '@/service/sessionAgentApi';
import { Plus, Workflow } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const defaultTask: AgentTask = { id: 'default', name: '' };

export function AgentTasks({
  agentId,
  api,
  storageKey,
  initialTaskId,
  openRouter,
  refreshKey,
  children,
}: {
  agentId: string;
  api: ReturnType<typeof sessionAgentApi>;
  storageKey: string;
  initialTaskId?: string;
  refreshKey: number;
  openRouter: (taskId: string, name: string, opener: HTMLButtonElement) => void;
  children: (id: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<AgentTask[]>([defaultTask]);
  const [selected, setSelected] = useState(() => {
    if (initialTaskId) return initialTaskId;
    try {
      return localStorage.getItem(storageKey) || defaultTask.id;
    } catch {
      return defaultTask.id;
    }
  });
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const request = useRef('');
  useEffect(() => {
    let current = true;
    api
      .tasks(agentId)
      .then((tasks) => {
        if (!current) return;
        setItems(tasks);
        setSelected((id) =>
          tasks.some((task) => task.id === id) ? id : defaultTask.id
        );
        setLoaded(true);
        setLoadFailed(false);
      })
      .catch(() => {
        if (current) setLoadFailed(true);
      });
    return () => {
      current = false;
    };
  }, [api, agentId, reload, refreshKey]);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(storageKey, selected);
    } catch {
      /* Device preference only. */
    }
  }, [storageKey, selected, loaded]);
  return (
    <>
      <div className="mx-auto flex w-full max-w-[736px] min-w-0 shrink-0 items-center gap-ds-control-gap px-ds-panel-inset py-ds-8">
        <Select value={selected} onValueChange={setSelected} disabled={!loaded}>
          <SelectTrigger
            size="xs"
            variant="secondary"
            wrapperClassName="min-w-0"
            className="max-w-full"
            aria-label={t('chat.node-task-select')}
          >
            <SelectValue
              title={
                selected === defaultTask.id
                  ? t('chat.node-task-default')
                  : items.find((task) => task.id === selected)?.name
              }
            />
          </SelectTrigger>
          <SelectContent>
            {items.map((task) => (
              <SelectItem key={task.id} value={task.id}>
                {task.id === defaultTask.id
                  ? t('chat.node-task-default')
                  : task.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (pending.current) return;
            if (next) {
              setName('');
              setFailed(false);
              request.current = crypto.randomUUID();
            }
            setOpen(next);
          }}
        >
          <DialogTrigger asChild>
            <Button size="xs" variant="ghost" disabled={!loaded}>
              <DsIcon icon={Plus} recipe="main-compact" />
              {t('chat.node-task-new')}
            </Button>
          </DialogTrigger>
          <DialogContent
            size="sm"
            overlayVariant="dimmed"
            showCloseButton={!saving}
            aria-describedby={undefined}
          >
            <DialogHeader title={t('chat.node-task-new')} />
            <form
              className="flex flex-col gap-ds-stack-related p-ds-panel-inset"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!name.trim() || pending.current) return;
                pending.current = true;
                setSaving(true);
                setFailed(false);
                try {
                  const task = await api.createTask(
                    agentId,
                    request.current,
                    name.trim()
                  );
                  setItems((previous) => [
                    ...previous.filter((item) => item.id !== task.id),
                    task,
                  ]);
                  setSelected(task.id);
                  setOpen(false);
                } catch {
                  setFailed(true);
                } finally {
                  pending.current = false;
                  setSaving(false);
                }
              }}
            >
              <Input
                title={t('chat.node-task-name')}
                aria-label={t('chat.node-task-name')}
                value={name}
                maxLength={100}
                disabled={saving}
                onChange={(event) => {
                  setName(event.target.value);
                  request.current = crypto.randomUUID();
                }}
              />
              {failed && (
                <DsText role="base" aria-live="assertive">
                  {t('chat.session-agents-save-error')}
                </DsText>
              )}
              <div className="flex justify-end gap-ds-control-gap">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => setOpen(false)}
                >
                  {t('chat.session-agents-cancel')}
                </Button>
                <Button type="submit" disabled={saving || !name.trim()}>
                  {t('chat.node-task-new')}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        <Button
          size="xs"
          variant="ghost"
          disabled={!loaded}
          onClick={(e) =>
            openRouter(
              selected,
              items.find((x) => x.id === selected)?.name ||
                t('chat.node-task-default'),
              e.currentTarget
            )
          }
        >
          <DsIcon icon={Workflow} recipe="main-compact" />
          {t('chat.route-messages')}
        </Button>
        {loadFailed && (
          <Button
            variant="text"
            size="xs"
            onClick={() => setReload((n) => n + 1)}
          >
            {t('chat.session-agents-load-error')} ·{' '}
            {t('chat.session-agents-retry')}
          </Button>
        )}
      </div>
      {(loaded || selected === defaultTask.id) && children(selected)}
    </>
  );
}
