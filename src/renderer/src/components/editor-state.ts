import type { Todo } from '@shared/types';
import type { ParsedTask } from '@shared/parse';

export interface EditorState {
  open: boolean;
  todo?: Todo;          // 编辑既有
  dueDate?: string;     // 新建时预填日期（日历 Sheet）
  draftTitle?: string;  // 快添窗 Ctrl+Enter 预填标题
  parsed?: ParsedTask;  // 快添窗 Ctrl+Enter 全字段预填（AI/规则解析结果）
  focusTodoId?: number; // 通知点击定位（规格 §4.2）：视图消费后自行高亮
  focusDate?: string;
}
