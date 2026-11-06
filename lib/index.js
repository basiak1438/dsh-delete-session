import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const inject = ['workspaceRegistry', 'webServer'];

function encodeSegment(raw) {
  if (!raw || raw.length === 0) return '';
  if (raw === '.') return '~002E';
  if (raw === '..') return '~002E~002E';
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch;
    } else {
      out += '~' + code.toString(16).toUpperCase().padStart(4, '0');
    }
  }
  return out;
}

export function apply(ctx) {
  const logger = ctx.logger || console;

  async function deleteSession(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid sessionId');
    }

    logger.info(`[dsh-delete-session] Starting permanent deletion for session: ${sessionId}`);

    // 1. 先尝试安全停止会话内正在运行的任务与 Agent
    try {
      if (ctx.workspaceRegistry?.archiveSession) {
        await ctx.workspaceRegistry.archiveSession(sessionId, { stopActivity: true });
      }
    } catch (err) {
      logger.warn(`[dsh-delete-session] archiveSession notice: ${err?.message || err}`);
    }

    // 2. 从所有工作区解除绑定 (detachSession)
    try {
      const workspaces = ctx.workspaceRegistry?.list?.() || [];
      for (const ws of workspaces) {
        if (ws.sessionIds && ws.sessionIds.includes(sessionId)) {
          await ws.detachSession(sessionId);
          logger.info(`[dsh-delete-session] Detached session ${sessionId} from workspace ${ws.id}`);
        }
      }
    } catch (err) {
      logger.warn(`[dsh-delete-session] Error detaching session from workspaces: ${err?.message || err}`);
    }

    // 3. 从全局归档与置顶状态中移除
    try {
      await ctx.workspaceRegistry?.unarchiveSession?.(sessionId);
      await ctx.workspaceRegistry?.unpinSession?.(sessionId);
    } catch (err) {
      logger.warn(`[dsh-delete-session] Error removing from archive/pin state: ${err?.message || err}`);
    }

    // 4. 清理内存中挂载的会话对象
    try {
      const liveSession = ctx.sessions?.get?.(sessionId);
      if (liveSession) {
        ctx.emit?.('session/disposed', liveSession);
      }
    } catch (err) {
      logger.warn(`[dsh-delete-session] Error disposing in-memory session: ${err?.message || err}`);
    }

    // 5. 物理删除磁盘上的会话日志文件夹
    let filesDeleted = false;
    try {
      const persistence = ctx.sessionPersistence || ctx.get?.('sessionPersistence');
      const root = persistence?.root;
      if (root) {
        const seg = encodeSegment(sessionId);
        const projects = await readdir(root, { withFileTypes: true });
        for (const project of projects) {
          if (project.isDirectory()) {
            const targetDir = join(root, project.name, seg);
            try {
              await rm(targetDir, { recursive: true, force: true });
              filesDeleted = true;
              logger.info(`[dsh-delete-session] Removed physical directory: ${targetDir}`);
            } catch (rmErr) {
              // 忽略不存在的文件/目录
            }
          }
        }
        persistence.coldLogMemo?.delete?.(sessionId);
      }
    } catch (err) {
      logger.warn(`[dsh-delete-session] Error removing physical session files: ${err?.message || err}`);
    }

    logger.info(`[dsh-delete-session] Successfully deleted session: ${sessionId}`);
    return {
      success: true,
      sessionId,
      filesDeleted,
    };
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
