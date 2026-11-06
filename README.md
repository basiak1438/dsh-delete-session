# dsh-delete-session

DeepSeek Harness (DSH) 插件：**彻底删除对话，而不是仅仅归档**。

DeepSeek Harness 原生界面中仅提供了“归档（Archive）”会话的功能，会话日志依然保留在本地磁盘与工作区记录中，无法从界面直接永久删除。
本插件在**完整保留原生归档功能**的前提下，额外增加了**彻底物理删除会话**的选项。

---

## ✨ 特性

- **保留原生归档**：原有的“归档（Archive）”按钮和菜单项不受任何影响，需要暂时隐藏对话时仍可自由使用。
- **新增彻底删除入口**：
  - **侧边栏悬停操作栏（Hover Actions）**：悬停在任意会话行时，新增红色垃圾桶图标按钮。
  - **会话「...」更多菜单**：菜单底部新增醒目的「彻底删除对话」操作项。
- **双重防误触提示**：点击删除会弹出二次确认窗口，明确告知将永久物理删除本地文件且不可恢复，避免手滑。
- **真正的物理级清除**：
  1. 安全停止会话活动（停止正在运行的 Runner 与 Agent）；
  2. 从所有 Workspace 登记表中解除绑定（`detachSession`）；
  3. 清理全局置顶（Pin）和归档（Archive）状态；
  4. 递归物理删除本地磁盘上的会话日志文件夹（`jsonl` / `zstd` 文件及对应目录）；
  5. 释放内存与查询缓存；
  6. 若当前正在查看被删除的会话，平滑切换至新会话。

---

## 📦 安装方法

### 方式一：在 DSH 插件市场中安装（推荐）
在 DSH 插件市场搜索 `dsh-delete-session` 点击一键安装即可。

### 方式二：通过 Git 本地安装
```bash
git clone https://github.com/basiak1438/dsh-delete-session.git
dsh plugin install ./dsh-delete-session
```

---

## 📄 开源许可

[MIT License](LICENSE) © 2026 [basiak1438](https://github.com/basiak1438)
