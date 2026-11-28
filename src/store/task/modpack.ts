// 整合包安装入口（薄封装 install_modpack）：后端按来源分流——local 直读用户选定文件，online 走多源下载并缓存到 config_dir()/modpacks；格式由后端嗅探（Modrinth / CurseForge / MultiMC / HMCL / MCBBS / PCL / 完整目录），前端不询问。
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { errMsg } from "../../utils/error";
import { showToast } from "../../utils/toast";
import { activePath } from "../config/gameDirs";
import { registerTaskName, registerTaskScope } from "./download";
import { t } from "../../i18n";

/** 与领域层 `sanitize_fs_name` 同规则：非法字符替换、去尾部点、保留名/空名回退。 */
const RESERVED_NAMES = [
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];
const INVALID_NAME_CHARS = "<>:\"/\\|?*";

function sanitizeFsName(name: string, fallback: string): string {
  let cleaned = "";
  for (const c of name) {
    const code = c.codePointAt(0) ?? 0;
    cleaned += INVALID_NAME_CHARS.includes(c) || code < 0x20 || (code >= 0x7f && code <= 0x9f)
      ? "_"
      : c;
  }
  const trimmed = cleaned.trim();
  const noTailDot = trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
  if (!noTailDot || /^_+$/.test(noTailDot)) return fallback;
  if (RESERVED_NAMES.some(r => r.toLowerCase() === noTailDot.toLowerCase())) return fallback;
  return noTailDot;
}

/** 整合包来源（镜像 Rust `game::modpack::PackSource`，serde tag = "type"）。 */
export type ModpackSource =
  | { type: "local"; path: string }
  | { type: "online"; url: string; sha1?: string; size?: number };

export interface ModpackInstallRequest {
  name: string;
  source: ModpackSource;
  icon_url?: string | null;
}

export async function installModpack(request: ModpackInstallRequest): Promise<string> {
  const taskId = await invoke<string>("install_modpack", { request });
  registerTaskName(taskId, request.name);
  // 版本目录在包解析前未知：领域层固定为 `{净化包名}-{mc}`（冲突 `_{n}`）。
  registerTaskScope(taskId, {
    gameDir: activePath.value,
    version: sanitizeFsName(request.name, "modpack"),
    prefix: true,
  });
  return taskId;
}

export async function importLocalModpack(): Promise<string | null> {
  try {
    const path = await open({
      multiple: false,
      filters: [{ name: t("task.modpack.filter"), extensions: ["mrpack", "zip"] }],
    });
    if (!path) return null;
    // 展示名取文件名去扩展名（后端计划/任务卡同用该名称）
    const fileName = String(path).split(/[\\/]/).pop() ?? t("task.modpack.defaultName");
    const name = fileName.replace(/\.(mrpack|zip)$/i, "") || t("task.modpack.defaultName");
    await installModpack({ name, source: { type: "local", path: String(path) } });
    showToast(t("task.modpack.submitted"));
    return name;
  } catch (e) {
    showToast(errMsg(e));
    return null;
  }
}
