import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AI_PROVIDERS } from '@shared/ai-providers';
import { HotkeyRecorder } from '@/components/HotkeyRecorder';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { useSettings } from '@/hooks/useSettings';
import { applyTheme, type ThemeMode } from '@/lib/theme';

const isThemeMode = (v: unknown): v is ThemeMode =>
  v === 'light' || v === 'dark' || v === 'system';

export default function SettingsView() {
  // 开机自启：真相来自系统（规格 §5.4 回显真实状态）
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => {
    void window.api.autostart.get().then(setAutostart);
  }, []);
  const toggleAuto = async (v: boolean) => {
    try {
      await window.api.autostart.set(v);
      setAutostart(await window.api.autostart.get()); // 再读一次防系统侧失败
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    }
  };

  // 主题
  const [theme, setTheme] = useSettings<string>('theme', 'system');
  const changeTheme = (m: string) => {
    const t: ThemeMode = isThemeMode(m) ? m : 'system';
    void setTheme(t);
    applyTheme(t);
  };

  // 通知
  const [sound, setSound] = useSettings<boolean>('notify_sound', true);
  const [notifyOk, setNotifyOk] = useState(true);
  useEffect(() => {
    void window.api.notifySupported().then(setNotifyOk);
  }, []);

  // 快捷键（三个全局热键）
  const [hotkeys, setHotkeys] = useState({
    quickadd: 'Ctrl+Alt+A',
    showMain: 'Ctrl+Alt+W',
    toggleStrip: 'Ctrl+Alt+S',
  });
  useEffect(() => {
    void window.api.settings.get<string>('quickadd_shortcut')
      .then(v => { if (v) setHotkeys(h => ({ ...h, quickadd: v })); });
    void window.api.settings.get<string>('show_main_shortcut')
      .then(v => { if (v) setHotkeys(h => ({ ...h, showMain: v })); });
    void window.api.settings.get<string>('toggle_strip_shortcut')
      .then(v => { if (v) setHotkeys(h => ({ ...h, toggleStrip: v })); });
  }, []);

  // 数据
  const [dbPath, setDbPath] = useState('');
  useEffect(() => {
    void window.api.dbPath().then(setDbPath);
  }, []);

  const exportData = async () => {
    try {
      const r = await window.api.exportData();
      if (r.saved && r.path) toast.success(`已导出到 ${r.path}`);
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    }
  };

  const exportLogs = async () => {
    try {
      const r = await window.api.exportLogs();
      if (r.saved && r.path) toast.success(`日志已导出到 ${r.path}`);
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    }
  };

  // 智能快添（AI）
  const [aiEnabled, setAiEnabled] = useSettings<boolean>('ai_enabled', false);
  const [aiProvider, setAiProvider] = useSettings<string>('ai_provider', 'deepseek');
  const [aiModel, setAiModel] = useSettings<string>('ai_model', '');
  const [aiBaseUrl, setAiBaseUrl] = useSettings<string>('ai_base_url', '');
  const [keyInput, setKeyInput] = useState('');
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    void window.api.ai.keyHint().then(setKeyHint);
  }, []);

  const preset = AI_PROVIDERS.find((p) => p.id === aiProvider) ?? AI_PROVIDERS[0];
  const aiEnabledBadge = aiEnabled ? <Badge>开</Badge> : null;

  const saveKey = async () => {
    try {
      await window.api.ai.setKey(keyInput.trim());
      setKeyInput('');
      setKeyHint(await window.api.ai.keyHint());
      toast.success('API Key 已加密保存');
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    }
  };

  const testConn = async () => {
    setTesting(true);
    try {
      await window.api.ai.testConnection();
      toast.success('连接成功');
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6 overflow-y-auto p-6">
      <h1 className="font-display text-xl font-semibold tracking-tight">设置</h1>

      <Card>
        <CardHeader><CardTitle>开机自启</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">登录后静默启动到系统托盘，保证提醒随时送达</p>
          <Switch checked={!!autostart} onCheckedChange={v => void toggleAuto(v)} disabled={autostart === null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>外观</CardTitle></CardHeader>
        <CardContent>
          <Tabs value={isThemeMode(theme) ? theme : 'system'} onValueChange={changeTheme}>
            <TabsList>
              <TabsTrigger value="light">浅色</TabsTrigger>
              <TabsTrigger value="dark">深色</TabsTrigger>
              <TabsTrigger value="system">跟随系统</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>通知</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!notifyOk && (
            <div className="flex items-center gap-3 rounded-md border border-due/60 bg-due/10 p-3 text-sm">
              <Badge variant="outline" className="border-due text-due">已关闭</Badge>
              <span>系统通知权限已关闭，提醒无法送达</span>
              <Button size="sm" variant="outline" onClick={() => void window.api.openNotifySettings()}>
                打开 Windows 通知设置
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm">通知声音</span>
            <Switch checked={sound} onCheckedChange={v => void setSound(v)} />
          </div>
          <Button
            variant="outline"
            onClick={() => window.api.notifyTest()
              .then(() => toast.success('测试通知已发送'))
              .catch(e => {
                setNotifyOk(false);
                toast.error(String((e as Error)?.message ?? e));
              })}
          >
            发送测试通知
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">智能快添 {aiEnabledBadge}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            启用后，快添输入文本将发送至所选模型服务商；未启用时本地规则解析仍然可用。
          </p>
          <div className="flex items-center justify-between">
            <span>启用 AI 增强</span>
            <Switch checked={aiEnabled ?? false} onCheckedChange={(v) => void setAiEnabled(v)} />
          </div>
          <div className="grid gap-2">
            <span className="text-sm">服务商</span>
            <Select value={aiProvider} onValueChange={(v) => { void setAiProvider(v); void setAiModel(''); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {AI_PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <span className="text-sm">模型名（留空用默认 {preset.defaultModel || '—'}）</span>
            <Input value={aiModel} onChange={(e) => void setAiModel(e.target.value)} placeholder={preset.defaultModel || '模型名'} />
          </div>
          {aiProvider === 'custom' && (
            <div className="grid gap-2">
              <span className="text-sm">Base URL（OpenAI 兼容）</span>
              <Input value={aiBaseUrl} onChange={(e) => void setAiBaseUrl(e.target.value)} placeholder="https://example.com/v1" />
            </div>
          )}
          <div className="grid gap-2">
            <span className="text-sm">API Key {keyHint ? `（已保存 ${keyHint}）` : '（未保存）'}</span>
            <div className="flex gap-2">
              <Input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="sk-…" />
              <Button variant="outline" disabled={!keyInput.trim()} onClick={() => void saveKey()}>保存</Button>
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" disabled={testing} onClick={() => void testConn()}>
              {testing ? '测试中…' : '测试连接'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>快捷键</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">快速添加窗口（任意界面下唤起）</p>
            <HotkeyRecorder
              value={hotkeys.quickadd}
              onSave={async (a) => {
                await window.api.hotkey.set(a);
                setHotkeys(h => ({ ...h, quickadd: a }));
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">呼出主界面</p>
            <HotkeyRecorder
              value={hotkeys.showMain}
              onSave={async (a) => {
                await window.api.hotkey.setShowMain(a);
                setHotkeys(h => ({ ...h, showMain: a }));
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">呼出/收起长条</p>
            <HotkeyRecorder
              value={hotkeys.toggleStrip}
              onSave={async (a) => {
                await window.api.hotkey.setToggleStrip(a);
                setHotkeys(h => ({ ...h, toggleStrip: a }));
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>数据</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="break-all text-sm text-muted-foreground">{dbPath}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void window.api.openDbFolder()}>打开所在文件夹</Button>
            <Button variant="outline" onClick={() => void exportData()}>导出数据…</Button>
            <Button variant="outline" onClick={() => void exportLogs()}>导出日志…</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            数据库损坏时将自动备份为 todo.db.corrupt.&lt;时间戳&gt; 并重建空库
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
