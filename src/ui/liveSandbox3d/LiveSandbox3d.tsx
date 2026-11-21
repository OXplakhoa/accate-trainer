import { DrillScene } from '../drill3d/scene/DrillScene';
import { SandboxApp } from '../sandbox/SandboxApp';
import { toLiveSceneSnapshot } from './snapshot';

export function LiveSandbox3d({ initialSeed }: { readonly initialSeed?: string }) {
  return (
    <SandboxApp
      initialSeed={initialSeed}
      initialSettings={{ playerCount: 4, enabledRivalIds: ['ca', 'cao', 'nong'] }}
      storage={null}
      hideTableSettings
      renderTableView={(view) => (
        <DrillScene
          phase="decision"
          highlight={null}
          spot={toLiveSceneSnapshot(view)}
          reducedMotion={view.reducedMotion}
        />
      )}
    />
  );
}
