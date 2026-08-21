export const PROJECT_SWITCH_EVENT = "narracut:project-switch";

export function requestProjectSwitch(destination: string): void {
  window.dispatchEvent(new CustomEvent(PROJECT_SWITCH_EVENT, {
    detail: { destination },
  }));
}
