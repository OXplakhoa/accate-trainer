import type { DealAnimationEndInfo } from './types';

export type DealAnimState = 'idle' | 'animating' | 'ready';

export type DealAnimationMetadata = Omit<DealAnimationEndInfo, 'outcome'>;

export interface PendingDealDescriptor {
  readonly key: string;
  readonly info: DealAnimationMetadata;
}

export interface DealAnimationRef<T> {
  current: T;
}

export interface DealAnimationLifecycleParams {
  readonly dealKey: string | null;
  readonly effectiveReducedMotion: boolean;
  readonly durationMs: number;
  readonly getDealInfo: () => DealAnimationMetadata | null;
  readonly pendingDealRef: DealAnimationRef<PendingDealDescriptor | null>;
  readonly completedDealKeyRef: DealAnimationRef<string | null>;
  readonly onDealAnimationEndRef: DealAnimationRef<
    ((info: DealAnimationEndInfo) => void) | undefined
  >;
  readonly setDealAnimState: (state: DealAnimState) => void;
}

/**
 * Reconciles the observable deal / reveal animation lifecycle (O3 readiness for P5 Tournament).
 *
 * Maintains the pending deal descriptor separately from the scheduled timeout so that:
 * - Superseding an in-flight deal with a new `dealKey` or hand end (`null`) emits the
 *   interrupted deal's notification once with `outcome: 'superseded'` and its original
 *   descriptor metadata, without marking the new key ready.
 * - The current scheduled deal emits `outcome: 'completed'` only when ready (including
 *   reduced motion).
 * - Strict Mode mount/cleanup, reduced-motion toggles, and callback identity changes do
 *   not emit duplicate notifications or drop the original descriptor.
 * - Stale timer callbacks cannot mark a newer key ready, and unmount never emits.
 */
export function syncDealAnimationLifecycle({
  dealKey,
  effectiveReducedMotion,
  durationMs,
  getDealInfo,
  pendingDealRef,
  completedDealKeyRef,
  onDealAnimationEndRef,
  setDealAnimState,
}: DealAnimationLifecycleParams): (() => void) | undefined {
  const pending = pendingDealRef.current;
  if (pending !== null && pending.key !== dealKey) {
    pendingDealRef.current = null;
    if (completedDealKeyRef.current !== pending.key) {
      completedDealKeyRef.current = pending.key;
      onDealAnimationEndRef.current?.({
        ...pending.info,
        outcome: 'superseded',
      });
    }
  }

  if (dealKey === null) {
    completedDealKeyRef.current = null;
    setDealAnimState('idle');
    return undefined;
  }

  if (completedDealKeyRef.current === dealKey) {
    setDealAnimState('ready');
    return undefined;
  }

  let descriptor: PendingDealDescriptor | null = null;
  if (pendingDealRef.current !== null && pendingDealRef.current.key === dealKey) {
    descriptor = pendingDealRef.current;
  } else {
    const info = getDealInfo();
    if (info !== null) {
      descriptor = {
        key: dealKey,
        info: {
          handNumber: info.handNumber,
          street: info.street,
          eventCount: info.eventCount,
        },
      };
    }
  }

  if (descriptor === null) {
    completedDealKeyRef.current = null;
    setDealAnimState('idle');
    return undefined;
  }

  pendingDealRef.current = descriptor;

  let cancelled = false;

  const completeCurrentDeal = () => {
    if (cancelled || pendingDealRef.current?.key !== dealKey) {
      return;
    }
    pendingDealRef.current = null;
    if (completedDealKeyRef.current === dealKey) {
      return;
    }
    completedDealKeyRef.current = dealKey;
    setDealAnimState('ready');
    onDealAnimationEndRef.current?.({
      ...descriptor.info,
      outcome: 'completed',
    });
  };

  if (effectiveReducedMotion) {
    completeCurrentDeal();
    return undefined;
  }

  setDealAnimState('animating');
  const timer = globalThis.setTimeout(completeCurrentDeal, durationMs);

  return () => {
    cancelled = true;
    globalThis.clearTimeout(timer);
  };
}
