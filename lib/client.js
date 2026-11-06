window.__ModuleLoader__.load({
  id: 'dsh-delete-session',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    // 垃圾桶矢量图标
    function TrashIcon({ size = 14, color = 'currentColor' }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: color,
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { display: 'block', flexShrink: 0 },
        },
        h('path', { d: 'M2 4h12' }),
        h('path', { d: 'M5.5 4V2.5A1.5 1.5 0 0 1 7 1h2a1.5 1.5 0 0 1 1.5 1.5V4' }),
        h('path', { d: 'M3.5 4l.8 9.2A1.5 1.5 0 0 0 5.8 14.5h4.4a1.5 1.5 0 0 0 1.5-1.3L12.5 4' }),
        h('path', { d: 'M6.5 7v4.5' }),
        h('path', { d: 'M9.5 7v4.5' })
      );
    }

    // 执行删除操作公用逻辑
    async function performDelete(sessionId, displayTitle, ctx) {
      const title = displayTitle ? `“${displayTitle}”` : '此对话';
      const confirmed = window.confirm(`确定要彻底删除${title}吗？\n\n注意：此操作将永久删除该会话记录及本地文件，无法撤销与恢复！\n（若只想隐藏，请使用“归档”功能）`);
      if (!confirmed) {
        return false;
      }

      try {
        const response = await fetch('/api/session-delete-v1', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sessionId }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${response.status}`);
        }

        // 检查当前页面是否正处于被删除的会话
        const currentUrl = window.location.href;
        if (currentUrl.includes(sessionId)) {
          if (ctx?.uiWorkspace?.startSession) {
            ctx.uiWorkspace.startSession();
          } else {
            window.location.hash = '';
          }
        }
        return true;
      } catch (err) {
        alert(`删除失败: ${err?.message || err}`);
        return false;
      }
    }

    // 侧边栏行内悬停操作按钮（新增删除按钮，归档与置顶原样保留）
    function DeleteRowAction(props) {
      const { sessionId, displayTitle } = props;
      const [hovered, setHovered] = React.useState(false);
      const [loading, setLoading] = React.useState(false);

      const handleClick = async (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (loading) return;
        setLoading(true);
        try {
          await performDelete(sessionId, displayTitle, window.__DSH_CLIENT_CTX__);
        } finally {
          setLoading(false);
        }
      };

      return h(
        'button',
        {
          type: 'button',
          title: '彻底删除对话（不可恢复）',
          'aria-label': '彻底删除对话',
          onClick: handleClick,
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            padding: 0,
            margin: '0 1px',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'wait' : 'pointer',
            background: hovered ? 'var(--dsw-alias-bg-layer-2, rgba(239, 68, 68, 0.12))' : 'transparent',
            color: hovered ? 'var(--dsw-alias-state-error-primary, #ef4444)' : 'var(--dsw-alias-label-secondary, #888)',
            transition: 'all 0.15s ease',
            outline: 'none',
          },
        },
        h(TrashIcon, {
          size: 13,
          color: hovered ? 'var(--dsw-alias-state-error-primary, #ef4444)' : 'currentColor',
        })
      );
    }

    // 侧边栏 "..." 菜单项（新增删除菜单项，归档原样保留）
    function DeleteMenuItem(props) {
      const { sessionId, displayTitle } = props;
      const [hovered, setHovered] = React.useState(false);

      const handleClick = async (e) => {
        e.stopPropagation();
        await performDelete(sessionId, displayTitle, window.__DSH_CLIENT_CTX__);
      };

      return h(
        'button',
        {
          role: 'menuitem',
          type: 'button',
          onClick: handleClick,
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
            padding: '7px 12px',
            border: 'none',
            borderRadius: '4px',
            background: hovered ? 'var(--dsw-alias-bg-layer-2, rgba(239, 68, 68, 0.08))' : 'transparent',
            color: 'var(--dsw-alias-state-error-primary, #ef4444)',
            fontSize: '13px',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'background-color 0.1s ease',
            outline: 'none',
          },
        },
        h(TrashIcon, { size: 14, color: 'var(--dsw-alias-state-error-primary, #ef4444)' }),
        h('span', { style: { fontWeight: 500 } }, '彻底删除对话')
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        window.__DSH_CLIENT_CTX__ = ctx;

        // 1. 在会话行悬停操作栏中新增删除按钮（保留原有的 archive 与 pin）
        ctx.slots.inject('sidebar.workspaces.session.row.action', () => {
          return ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.row.action',
              id: 'dsh-delete-session-row-action',
              order: 250, // 置于归档(100)与置顶(200)之后
            },
            DeleteRowAction
          );
        });

        // 2. 在会话 "..." 菜单中新增删除菜单项（保留原有的归档等所有菜单项）
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => {
          return ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: 'dsh-delete-session-menu-item',
              order: 500, // 置于原归档(400)与会话ID(450)之后，作为底部警示危险项
            },
            DeleteMenuItem
          );
        });
      },
    };
  },
});
