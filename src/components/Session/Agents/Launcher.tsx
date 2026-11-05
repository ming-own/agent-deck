import { Button } from '@/components/ui/button';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import {
  proxyCreateSpaceProject,
  proxyUpdateSpaceProject,
} from '@/service/spaceApi';
import { getAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

export function SessionAgentsLauncher({
  projectId,
  onOpen,
}: {
  projectId: string | null;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const open = async () => {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    const account = getAccountEnvironmentKey(getAuthStore());
    const spaceStore = useSpaceStore.getState();
    const meta = projectId ? spaceStore.getProjectMeta(projectId) : null;
    const spaceId = meta?.spaceId ?? spaceStore.activeSpaceId;
    try {
      if (!spaceId) throw new Error('Space is required');
      if (projectId) {
        if (meta?.metadata?.agentSession !== true) {
          await proxyUpdateSpaceProject(
            spaceId,
            projectId,
            { metadata: { agentSession: true } },
            { expectedAccountKey: account }
          );
          if (account !== getAccountEnvironmentKey(getAuthStore())) return;
          spaceStore.updateProjectMeta(projectId, {
            metadata: { ...meta?.metadata, agentSession: true },
          });
        }
        onOpen();
      } else {
        const project = await proxyCreateSpaceProject(
          spaceId,
          {
            name: t('chat.session-agents-new-session'),
            metadata: { agentSession: true, spaceModelDefaultPending: false },
          },
          { expectedAccountKey: account }
        );
        if (account !== getAccountEnvironmentKey(getAuthStore())) return;
        useProjectRuntimeStore
          .getState()
          .createProject(
            project.name,
            undefined,
            project.id,
            undefined,
            undefined,
            true,
            {
              spaceId,
              metadata: project.metadata ?? {},
            }
          );
        spaceStore.setLastVisitedProject(spaceId, project.id);
        usePageTabStore.getState().setActiveWorkspaceTab('project');
      }
    } catch {
      toast.error(t('chat.session-agents-load-error'));
    } finally {
      locked.current = false;
      setPending(false);
    }
  };
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() => void open()}
    >
      {t('chat.session-agents-title')}
    </Button>
  );
}
