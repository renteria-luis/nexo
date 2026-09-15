// Spec 17.3: each module declares a navigation slot and a feature flag, and
// turning one off has to leave the rest fully working. This is that declaration,
// in one list.
//
// Deleting a module is deleting its screen file and its entry here. Spec 17.4
// rule 3 asks for no edits anywhere else, and one line in a registry is as close
// as a list of tabs can get to that.

import type { ComponentType } from 'react';

export type ModuleId = 'today' | 'training' | 'nutrition' | 'deals' | 'finance';

export type ModuleTab = {
  id: ModuleId;
  label: string;
  /** Off means the tab is not rendered and nothing else changes. */
  enabled: boolean;
  screen: ComponentType;
  /** Shown in place of the module while it does not exist yet. */
  pending?: string;
};

export type ModuleRegistry = {
  tabs: ModuleTab[];
};

export function enabledTabs(registry: ModuleRegistry): ModuleTab[] {
  return registry.tabs.filter((tab) => tab.enabled);
}
