/** 标题或备注命中查询（大小写不敏感；空查询视为全命中） */
export function matchesQuery(t: { title: string; notes: string | null }, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return t.title.toLowerCase().includes(s) || (t.notes ?? '').toLowerCase().includes(s);
}
