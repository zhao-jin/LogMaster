import { open } from "@tauri-apps/plugin-dialog";

export async function openDialog(): Promise<string | null> {
  const res = await open({
    multiple: false,
    directory: false,
    filters: [
      { name: "Log files", extensions: ["log", "txt", "out", "err"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (!res) return null;
  return typeof res === "string" ? res : null;
}

export async function openFolderDialog(): Promise<string | null> {
  const res = await open({
    multiple: false,
    directory: true,
  });
  if (!res) return null;
  return typeof res === "string" ? res : null;
}
