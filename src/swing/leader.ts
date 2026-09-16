export type SwingSchedulerLeader = { tabId?: string; expiresAt?: number };

export function canClaimSwingScheduler(current: SwingSchedulerLeader | null, tabId: string, now: number) {
  return !current?.expiresAt || current.expiresAt <= now || current.tabId === tabId;
}
