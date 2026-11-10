import { rm, stat as statPath } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

export const inject = ['workspaceRegistry', 'webServer', 'sessionPersistence'];

export function apply(ctx) {
  const logger = ctx.logger || console;

  /**
   * 由持久化快照解析出该会话独占的物理目录。
   *
   * `sessionPersistence.stat()` 返回的 `location.path` 是会话日志文件本身，
   * 它所在的目录（同名于会话 id）才是整条会话的全部落盘内容。
   * 目录名与会话 id 不一致时不删除：那种结构说明路径推导前提已不成立，
   * 递归删除可能误伤别的会话。
   */
  function resolveSessionDir(sessionId, snapshot) {
    const logPath = snapshot?.location?.path;
    if (!logPath) {
      throw new Error('persistence reported no physical location for this session');
    }
    const dir = dirname(logPath);
    if (basename(dir) !== sessionId) {
      throw new Error(`refusing to delete unexpected session directory: ${dir}`);
    }
    return dir;
  }

  /**
   * 从所有工作区解除绑定，并回读登记表确认解绑已经持久化。
   *
   * 只调用 `detachSession()` 而不校验是不够的：登记表若被后续写入覆盖，
   * 会话会在重启后重新出现在侧边栏，而磁盘上的日志其实还在。
   */
  async function detachFromWorkspaces(sessionId) {
    for (const workspace of ctx.workspaceRegistry.list()) {
      if (!workspace.sessionIds?.includes(sessionId)) continue;
      await workspace.detachSession(sessionId);
      logger.info(`[dsh-delete-session] Detached session ${sessionId} from workspace ${workspace.id}`);
    }

    const remaining = ctx.workspaceRegistry
      .list()
      .filter((workspace) => workspace.sessionIds?.includes(sessionId));
    if (remaining.length > 0) {
      throw new Error(
        `session is still attached to workspace(s): ${remaining.map((workspace) => workspace.id).join(', ')}`,
      );
    }
  }

  async function deleteSession(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid sessionId');
    }

    logger.info(`[dsh-delete-session] Starting permanent deletion for session: ${sessionId}`);

    // 1. 停止会话内正在运行的任务与 Agent。
    try {
      await ctx.workspaceRegistry.archiveSession(sessionId, { stopActivity: true });
    } catch (err) {
      logger.warn(`[dsh-delete-session] archiveSession notice: ${err?.message || err}`);
    }

    // 2. 先记下物理位置：日志一旦删除，persistence 就再也解析不出它了。
    const snapshot = await ctx.sessionPersistence.stat(sessionId);
    const sessionDir = snapshot === undefined ? undefined : resolveSessionDir(sessionId, snapshot);

    // 3. 解绑所有工作区，并回读校验。
    await detachFromWorkspaces(sessionId);

    // 4. 移出全局归档与置顶集合（两者都幂等）。
    for (const method of ['unarchiveSession', 'unpinSession']) {
      try {
        await ctx.workspaceRegistry[method](sessionId);
      } catch (err) {
        logger.warn(`[dsh-delete-session] ${method} notice: ${err?.message || err}`);
      }
    }

    // 5. 物理删除会话目录。没有落盘日志时视为已经干净，不报错。
    if (sessionDir === undefined) {
      logger.info(`[dsh-delete-session] No stored log for ${sessionId}; nothing to remove from disk`);
      return { success: true, sessionId, filesDeleted: false };
    }

    await rm(sessionDir, { recursive: true, force: true });

    // 6. 校验目录确实消失了，避免把被文件锁拦下的删除报成成功。
    try {
      await statPath(sessionDir);
      throw new Error(`session directory survived deletion: ${sessionDir}`);
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }

    logger.info(`[dsh-delete-session] Removed physical directory: ${sessionDir}`);
    logger.info(`[dsh-delete-session] Successfully deleted session: ${sessionId}`);
    return { success: true, sessionId, filesDeleted: true };
  }

  // 使用 ctx.effect 包装路由注册，确保生命周期正确清理
  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'exact',
      path: '/api/session-delete-v1',
      handler: async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method Not Allowed' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', async () => {
          try {
            const payload = JSON.parse(body || '{}');
            const sessionId = payload.sessionId;
            if (!sessionId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing sessionId parameter' }));
              return;
            }

            const result = await deleteSession(sessionId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err) {
            logger.error(`[dsh-delete-session] Failed to delete session: ${err?.message || err}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err?.message || err) }));
          }
        });
      },
    });

    return () => {
      disposeRoute?.();
    };
  }, 'dsh-delete-session: route lifecycle');
}
