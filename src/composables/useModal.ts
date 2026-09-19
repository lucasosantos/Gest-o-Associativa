import { ref, shallowRef, markRaw, type Component } from "vue";

interface ModalState {
  isOpen: boolean;
  title: string;
}

export const modalState = ref<ModalState>({ isOpen: false, title: "" });
export const modalComponent = shallowRef<Component | null>(null);
export const modalProps = ref<Record<string, unknown>>({});
export const modalKey = ref(0);

interface OpenModalOptions {
  title: string;
  component?: Component | null;
  props?: Record<string, unknown>;
}

export function openModal({ title, component = null, props = {} }: OpenModalOptions) {
  modalState.value = { isOpen: true, title };
  modalComponent.value = component ? markRaw(component) : null;
  modalProps.value = props;
  modalKey.value++; // força remontagem a cada abertura
}

export function closeModal() {
  modalState.value = { isOpen: false, title: "" };
  modalComponent.value = null;
  modalProps.value = {};
}
