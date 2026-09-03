/**
 * Settings from the `attachments` key of Pi's settings.json
 * (~/.pi/agent/settings.json, or PI_CODING_AGENT_DIR). Non-secret only.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AttachmentsSettings {
  /**
   * When true, text-file attachments are inlined as <file> blocks (Claude Code
   * @file style — content dumped into context, re-read every turn).
   * When false (default), they resolve to a 📎 path the model reads on demand.
   */
  inlineTextFiles: boolean;
  /** Max bytes for text-file inlining (inlineTextFiles mode only). Default 100_000. */
  maxInlineBytes: number;
  /** Keybinding for paste-file-from-clipboard. Default "alt+shift+v". */
  pasteFileShortcut: string;
}

export const DEFAULTS: AttachmentsSettings = {
  inlineTextFiles: false,
  maxInlineBytes: 100_000,
  pasteFileShortcut: "alt+shift+v",
};

export function loadSettings(): AttachmentsSettings {
  const dir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const p = join(dir, "settings.json");
  if (!existsSync(p)) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8"))?.attachments ?? {};
    return {
      inlineTextFiles: typeof raw.inlineTextFiles === "boolean" ? raw.inlineTextFiles : DEFAULTS.inlineTextFiles,
      maxInlineBytes: typeof raw.maxInlineBytes === "number" && raw.maxInlineBytes > 0 ? raw.maxInlineBytes : DEFAULTS.maxInlineBytes,
      pasteFileShortcut: typeof raw.pasteFileShortcut === "string" && raw.pasteFileShortcut ? raw.pasteFileShortcut : DEFAULTS.pasteFileShortcut,
    };
  } catch {
    return { ...DEFAULTS };
  }
}
