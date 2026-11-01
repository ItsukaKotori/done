import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Input } from '@/components/ui/input';
import type { RecurrenceSpec, RepeatType, MonthlyMode } from '@shared/types';

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** 受控钳制值域：HTML min/max 不拦截手输/粘贴，非法值会持久化成永不发生的规则（审查 W1） */
const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.trunc(Number.isFinite(v) ? v : lo)));

const clampNum = (raw: string, lo: number, hi: number): number =>
  clamp(Number(raw) || lo, lo, hi);

/** 规格 §5.5：表单是重复规则唯一真相源，切换类型时重置子字段 */
export function RepeatField({ value, onChange }: {
  value: RecurrenceSpec;
  onChange: (v: RecurrenceSpec) => void;
}) {
  const set = (patch: Partial<RecurrenceSpec>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-2">
      <Select
        value={value.repeatType}
        onValueChange={(v) => {
          const rt = v as RepeatType;
          set(rt === 'weekly' ? { repeatType: rt, repeatWeekdays: [1] }
            : rt === 'monthly'
              ? { repeatType: rt, monthlyMode: value.monthlyMode ?? 'by_date', monthlyDay: value.monthlyDay ?? 1 }
              : rt === 'custom' ? { repeatType: rt, repeatInterval: 2 }
                : { repeatType: rt });
        }}
      >
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">不重复</SelectItem>
          <SelectItem value="daily">每天</SelectItem>
          <SelectItem value="weekly">每周</SelectItem>
          <SelectItem value="monthly">每月</SelectItem>
          <SelectItem value="custom">自定义间隔</SelectItem>
        </SelectContent>
      </Select>

      {value.repeatType === 'weekly' && (
        <ToggleGroup
          type="multiple"
          variant="outline"
          className="flex-wrap"
          value={(value.repeatWeekdays ?? []).map(String)}
          onValueChange={(v) => {
            // 至少保留一天（空选=永不发生，无意义规则）
            if (v.length > 0) set({ repeatWeekdays: v.map(Number) });
          }}
        >
          {WEEK_LABELS.map((l, i) => (
            <ToggleGroupItem key={i} value={String(i)} aria-label={`周${l}`}>周{l}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      {value.repeatType === 'monthly' && (
        <div className="space-y-2">
          <Select
            value={value.monthlyMode ?? 'by_date'}
            onValueChange={(v) => set({ monthlyMode: v as MonthlyMode })}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="by_date">每月几号</SelectItem>
              <SelectItem value="by_weekday">每月第 N 个周几</SelectItem>
            </SelectContent>
          </Select>
          {(value.monthlyMode ?? 'by_date') === 'by_date' ? (
            <div className="flex items-center gap-2 text-sm">
              <span>每月</span>
              <Input
                type="number" min={1} max={31} className="w-20"
                value={value.monthlyDay ?? 1}
                onChange={e => set({ monthlyDay: clampNum(e.target.value, 1, 31) })}
              />
              <span>号（当月无该日则跳过）</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Select
                value={String(value.monthlyWhich ?? 1)}
                onValueChange={v => set({ monthlyWhich: clampNum(v, 1, 5) })}
              >
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map(n => (
                    <SelectItem key={n} value={String(n)}>
                      {n === 5 ? '最后一个' : `第${'一二三四五'[n - 1]}个`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={String(value.monthlyWeekday ?? 1)}
                onValueChange={v => set({ monthlyWeekday: clampNum(v, 0, 6) })}
              >
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEK_LABELS.map((l, i) => <SelectItem key={i} value={String(i)}>周{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {value.repeatType === 'custom' && (
        <div className="flex items-center gap-2 text-sm">
          <span>每</span>
          <Input
            type="number" min={1} className="w-20" value={value.repeatInterval ?? 2}
            onChange={e => set({ repeatInterval: clampNum(e.target.value, 1, 3650) })}
          />
          <span>天</span>
        </div>
      )}
    </div>
  );
}
