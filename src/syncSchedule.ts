export const TRAINING_SYNC_DEBOUNCE_MS = 10_000;
export const SPACE_SYNC_PULL_INTERVAL_MS = 120_000;

type SyncScheduleOptions = {
  upload: () => unknown;
  pull: () => Promise<boolean>;
  now?: () => number;
  timers?: {
    setTimeout: (callback: () => void, delay: number) => number;
    clearTimeout: (id: number) => void;
  };
};

export function createTrainingSyncSchedule({
  upload,
  pull,
  now = Date.now,
  timers = {
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (id) => window.clearTimeout(id)
  }
}: SyncScheduleOptions) {
  let uploadTimer: number | null = null;
  let lastSuccessfulPull: number | null = null;
  let pulling = false;

  function queueUpload(resetDebounce = true) {
    if (uploadTimer !== null) {
      if (!resetDebounce) return;
      timers.clearTimeout(uploadTimer);
    }
    uploadTimer = timers.setTimeout(() => {
      uploadTimer = null;
      void upload();
    }, TRAINING_SYNC_DEBOUNCE_MS);
  }

  async function pullIfDue(force = false) {
    if (pulling) return false;
    if (!force && lastSuccessfulPull !== null && now() - lastSuccessfulPull < SPACE_SYNC_PULL_INTERVAL_MS) return false;
    pulling = true;
    try {
      const success = await pull();
      if (success) lastSuccessfulPull = now();
      return success;
    } catch {
      return false;
    } finally {
      pulling = false;
    }
  }

  function onBackground(hasPendingChanges: boolean) {
    if (hasPendingChanges) queueUpload(false);
    else void pullIfDue(false);
  }

  function cancelUpload() {
    if (uploadTimer === null) return;
    timers.clearTimeout(uploadTimer);
    uploadTimer = null;
  }

  function resetPullInterval() {
    lastSuccessfulPull = null;
  }

  return {
    scheduleUpload: () => queueUpload(true),
    ensureUploadScheduled: () => queueUpload(false),
    cancelUpload,
    resetPullInterval,
    pullIfDue,
    onBackground,
    dispose: cancelUpload
  };
}
