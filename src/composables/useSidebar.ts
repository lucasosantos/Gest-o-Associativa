import { ref } from "vue";

export interface SidebarToolItem {
  id: string;
  label: string;
  icon: string;
  onClick?: () => void;
}

export interface SidebarToolGroup {
  group?: string;
  items: SidebarToolItem[];
}

export const sidebarTools = ref<SidebarToolGroup[]>([]);

export function setSidebarTools(groups: SidebarToolGroup[]) {
  sidebarTools.value = groups;
}

export function clearSidebarTools() {
  sidebarTools.value = [];
}
