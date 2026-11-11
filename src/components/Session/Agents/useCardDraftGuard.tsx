import { registerWorkspaceConfigurationNavigationGuard } from '@/lib/workspaceConfigurationNavigationGuard';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

type DraftState = { dirty: boolean; busy: boolean };
type DraftSource = () => DraftState;

function createDraftScope(confirmDiscard: () => boolean) {
  const sources = new Set<DraftSource>();
  const pending = () =>
    [...sources].some((source) => {
      const state = source();
      return state.dirty || state.busy;
    });
  return {
    pending,
    busy: () => [...sources].some((source) => source().busy),
    register(source: DraftSource) {
      sources.add(source);
      return () => {
        sources.delete(source);
      };
    },
    confirm() {
      const states = [...sources].map((source) => source());
      if (states.some((state) => state.busy)) return false;
      return !states.some((state) => state.dirty) || confirmDiscard();
    },
  };
}

type DraftScope = ReturnType<typeof createDraftScope>;
const DraftContext = createContext<DraftScope | null>(null);

function useNavigationProtection(scope: DraftScope, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const unregister = registerWorkspaceConfigurationNavigationGuard({
      hasPendingChanges: scope.pending,
      flushSave: async () => scope.confirm(),
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!scope.pending()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      unregister();
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [scope, enabled]);
}

/** A node owns one navigation guard; its independent drafts contribute to it. */
export function CardDraftScope({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const scope = useMemo(
    () =>
      createDraftScope(() =>
        window.confirm(t('layout.workspace-discard-confirm-title'))
      ),
    [t]
  );
  useNavigationProtection(scope, true);
  return (
    <DraftContext.Provider value={scope}>{children}</DraftContext.Provider>
  );
}

export function useCardDraftGuard(
  value: unknown,
  { busy = false, message = 'layout.workspace-discard-confirm-title' } = {}
) {
  const { t } = useTranslation();
  const parentScope = useContext(DraftContext);
  const localScope = useMemo(
    () => createDraftScope(() => window.confirm(t(message))),
    [t, message]
  );
  const scope = parentScope ?? localScope;
  const serialized = JSON.stringify(value);
  const [baseline, setBaseline] = useState(serialized);
  const dirty = serialized !== baseline;
  const latest = useRef({ dirty, busy });
  useLayoutEffect(() => {
    latest.current = { dirty, busy };
  }, [dirty, busy]);
  useLayoutEffect(() => scope.register(() => latest.current), [scope]);
  useNavigationProtection(scope, !parentScope);
  const markSaved = useCallback(
    (savedValue: unknown = value) => {
      setBaseline(JSON.stringify(savedValue));
    },
    [value]
  );
  const confirmSelf = useCallback(() => {
    if (scope.busy()) return false;
    return !latest.current.dirty || window.confirm(t(message));
  }, [scope, t, message]);
  return { dirty, confirm: scope.confirm, confirmSelf, markSaved };
}
