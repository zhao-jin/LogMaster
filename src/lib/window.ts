import { getCurrentWindow } from "@tauri-apps/api/window";

const win = () => getCurrentWindow();

export function minimizeWindow() {
  return win().minimize();
}
export function toggleMaximize() {
  return win().toggleMaximize();
}
export function closeWindow() {
  return win().close();
}
export async function isMaximized() {
  return win().isMaximized();
}
export function onResizeListen(cb: () => void) {
  return win().onResized(cb);
}
