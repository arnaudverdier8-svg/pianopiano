import { createContext, useContext, useSyncExternalStore } from 'react';
import type { PracticeController } from './controller';

export const ControllerContext = createContext<PracticeController | null>(null);

export function useController(): PracticeController {
  const c = useContext(ControllerContext);
  if (!c) throw new Error('ControllerContext missing');
  return c;
}

/** Re-renders on controller notifications (throttled there to ~10 Hz, immediate for state changes). */
export function useControllerState(): PracticeController {
  const c = useController();
  useSyncExternalStore(
    (fn) => c.subscribe(fn),
    () => c.snap,
  );
  return c;
}
